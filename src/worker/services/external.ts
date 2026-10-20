// Chế độ external: Claude (trong phiên làm việc, dùng gói subscription) tìm tin, chạy các agent, rồi GHI kết quả vào
// bảng external_outputs. Hệ thống nhập từng bản ghi qua đúng quy trình như chế độ live:
//   tin  → hộp tin mới (BR-26 nguồn công khai, BR-27 danh sách hạn chế)
//   sự kiện → lập từ tin đã nhập
//   nhận định → đồ thị Agent CIO với đầu ra của Claude, kiểm tra schema Mục 7.3, phản biện, chờ CIO duyệt
//   tóm tắt chính sách → kiểm tra trích dẫn điều khoản, khớp gia đình (BR-30)
// Con người vẫn quyết định: không bản ghi nào của Claude tự đi tới áp dụng hay tới khách.
import { HttpError, makeCtx, requireRole, type AppCtx, type Env, type User } from '../ctx'
import { ConflictError } from '../db'
import { createEventFromNews, getEvent, type EventRec } from './events'
import { addToInbox, type IncomingItem } from './ingest'
import { completeWaiting, type JobRec } from './jobs'
import { addPolicy, analyzePolicy } from './policy'
import { runCioAgent, type ExternalCio, type ViewRec } from './views'
import { currentSnapshot, type SnapshotRecord } from './portfolio'
import { importMarketData } from './quality'
import { importGoldenRun } from './golden'
import { AGENTS, agentControls, importRunLog, KIND_AGENT } from './ops'
import { scoreCanary } from './canary'
import { canonical, hashOf } from '../../engine/hash'
import { runPreChallenge, runReChallenge, getView, viewChallenges } from './views'
import type { PricePoint } from '../../shared/types'

export interface ExternalRec {
  id: string; kind: 'news' | 'event' | 'cio_view' | 'challenge' | 'policy_doc' | 'policy_summary' | 'prices' | 'market_data' | 'golden_view' | 'run_log' | 'scan_log'; subject?: string
  status: 'READY' | 'PROCESSING' | 'IMPORTED' | 'REJECTED'; created_at: string
  data: any; result?: Record<string, unknown>; error?: string; note?: string; rev?: number
}

export interface ExternalPricePoint { key: string; price: string; date: string; currency?: string; source: string; source_ref?: string; note?: string }

export const CLAUDE_USER: User = { id: 'CLAUDE', name: 'Claude (phiên làm việc)', role: 'ADMIN', families: [] }
const MAX_WAIT_DAYS = 3

// Claude ghi bằng một câu INSERT với cột data là nội dung kết quả; sau khi hệ thống xử lý, cột data chứa cả bản ghi.
// Hàm này đọc được cả hai dạng.
async function loadRows(ctx: AppCtx, where = '', params: unknown[] = []): Promise<ExternalRec[]> {
  const r = await ctx.env.DB.prepare(`SELECT id, kind, subject, status, created_at, data FROM external_outputs${where ? ' WHERE ' + where : ''} ORDER BY created_at, id`).bind(...params).all<{ id: string; kind: string; subject: string | null; status: string; created_at: string; data: string }>()
  return (r.results ?? []).map(row => {
    let d: any = null
    try { d = JSON.parse(row.data) } catch { d = { _unparsed: row.data } }
    const full = d && typeof d === 'object' && d.id === row.id && 'data' in d && 'kind' in d
    return full ? { ...d, status: row.status } : { id: row.id, kind: row.kind as ExternalRec['kind'], subject: row.subject ?? undefined, status: row.status as ExternalRec['status'], created_at: row.created_at, data: d }
  })
}

async function mark(ctx: AppCtx, r: ExternalRec, patch: Partial<ExternalRec>) {
  const cur = (await loadRows(ctx, 'id = ?', [r.id]))[0] ?? r
  const u = ctx.uow(); u.update('external_outputs', { ...cur, ...patch } as never); await u.commit()
}

// Giữ chỗ một bản ghi để hai lần nhập chạy song song (cron và nút bấm) không xử lý trùng
async function claim(ctx: AppCtx, r: ExternalRec): Promise<boolean> {
  try { const u = ctx.uow(); u.update('external_outputs', { ...r, status: 'PROCESSING' } as never); await u.commit(); return true }
  catch (e) { if (e instanceof ConflictError) return false; throw e }
}

// Chữ ký của vùng AI (F01): EXTERNAL_HMAC_KEY đặt trên Worker và trong máy chạy agent. Có khóa thì mọi bản ghi phải mang
// data._sig = HMAC-SHA-256(khóa, JSON chuẩn hóa của data bỏ _sig); sai hoặc thiếu chữ ký thì từ chối. Không có khóa (bản demo
// hiện tại) thì nhận nhưng ghi rõ "chưa ký".
async function hmacHex(key: string, text: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('')
}
export async function signExternal(key: string, data: Record<string, unknown>) { const { _sig, ...rest } = data; return hmacHex(key, canonical(rest)) }
export async function signatureOk(env: Env, data: unknown): Promise<{ ok: boolean; signed: boolean; reason?: string }> {
  const key = typeof env.EXTERNAL_HMAC_KEY === 'string' ? env.EXTERNAL_HMAC_KEY : ''
  if (!key) return { ok: true, signed: false }
  const d = (data ?? {}) as Record<string, unknown>
  if (typeof d._sig !== 'string') return { ok: false, signed: false, reason: 'Thiếu chữ ký _sig (EXTERNAL_HMAC_KEY đang bật)' }
  return (await signExternal(key, d)) === d._sig ? { ok: true, signed: true } : { ok: false, signed: false, reason: 'Chữ ký _sig không khớp nội dung' }
}

// Vùng AI gửi kết quả qua API có chữ ký thay cho quyền ghi thẳng cơ sở dữ liệu (đích kiến trúc: vùng AI không có quyền D1)
export async function submitExternal(env: Env, body: unknown, now: string) {
  if (typeof env.EXTERNAL_HMAC_KEY !== 'string' || !env.EXTERNAL_HMAC_KEY) throw new HttpError(503, 'Chưa bật EXTERNAL_HMAC_KEY: kênh gửi có chữ ký đang tắt')
  const b = (body ?? {}) as { id?: string; kind?: string; subject?: string; data?: Record<string, unknown> }
  if (!b.id || !/^[A-Za-z0-9._:-]{3,80}$/.test(b.id)) throw new HttpError(422, 'id không hợp lệ')
  if (!['news', 'event', 'cio_view', 'challenge', 'policy_doc', 'policy_summary', 'prices', 'market_data', 'golden_view', 'run_log', 'scan_log'].includes(String(b.kind))) throw new HttpError(422, 'kind không hợp lệ')
  const sig = await signatureOk(env, b.data)
  if (!sig.ok) throw new HttpError(401, sig.reason ?? 'Chữ ký không hợp lệ')
  await env.DB.prepare('INSERT INTO external_outputs (id, kind, subject, status, created_at, data) VALUES (?, ?, ?, ?, ?, ?)').bind(b.id, b.kind, b.subject ?? null, 'READY', now, JSON.stringify(b.data)).run()
  return { id: b.id, status: 'READY' }
}

function tooOld(ctx: AppCtx, r: ExternalRec) { return Date.parse(ctx.now()) - Date.parse(r.created_at) > MAX_WAIT_DAYS * 864e5 }

async function resolveEvent(ctx: AppCtx, ref: string | undefined): Promise<EventRec | null> {
  if (!ref) return null
  if (ref.startsWith('EV-')) return await ctx.repo.get<EventRec>('events', ref)
  const ev = (await loadRows(ctx, "kind = 'event' AND status = 'IMPORTED'")).find(x => x.data?.ref === ref)
  return ev?.result?.event_id ? await ctx.repo.get<EventRec>('events', String(ev.result.event_id)) : null
}

export async function importExternal(env: Env, opts: { now?: () => string; fetchFn?: typeof fetch; accessEmail?: string; trigger?: 'cron' | 'manual' } = {}) {
  const ctx = makeCtx(env, CLAUDE_USER, opts)
  const n = await env.DB.prepare('SELECT count(*) AS n FROM config_versions').first<{ n: number }>().catch(() => null)
  if (!n?.n) return { skipped: 'Chưa nạp dữ liệu' }
  const all = await loadRows(ctx, "status = 'READY'")
  const rows: ExternalRec[] = []
  const unsigned: string[] = []
  for (const r of all) {
    const sig = await signatureOk(env, r.data)
    if (!sig.ok) { await mark(ctx, r, { status: 'REJECTED', error: sig.reason }); continue }
    if (!sig.signed) unsigned.push(r.id)
    rows.push(r)
  }
  const report = { trigger: opts.trigger ?? 'manual', news: { rows: 0, created: 0, duplicate: 0, rejected: 0, too_old: 0, irrelevant: 0 }, events: [] as string[], views: [] as { view_id: string; status: string }[], policies: [] as string[], policy_docs: [] as string[], prices: [] as string[], market: [] as string[], golden: [] as string[], run_logs: [] as string[], scan_logs: [] as string[], challenges: [] as { view_id: string; challenge: string }[], unsigned, rejected: [] as { id: string; reason: string }[], waiting: [] as { id: string; reason: string }[] }
  if (!rows.length) return report

  // 0. Agent đang tạm dừng (sổ sự cố): không nhận đầu ra của agent đó, ghi rõ lý do để chạy lại sau khi xử lý xong
  const controls = await agentControls(ctx)
  for (const r of [...rows]) {
    const ag = KIND_AGENT[r.kind]
    const c = ag ? controls[ag] : undefined
    if (c?.paused) { await mark(ctx, r, { status: 'REJECTED', error: `${AGENTS[ag]} đang tạm dừng: ${c.reason}${c.incident_id ? ` (sự cố ${c.incident_id})` : ''}` }); report.rejected.push({ id: r.id, reason: `${ag} tạm dừng` }); rows.splice(rows.indexOf(r), 1) }
  }

  // 1. Tin
  for (const r of rows.filter(x => x.kind === 'news')) {
    if (!await claim(ctx, r)) continue
    const items: IncomingItem[] = (Array.isArray(r.data?.items) ? r.data.items : [r.data]).filter((x: any) => x?.url && x?.title).map((x: any) => ({ feed: x.feed ?? `Claude tìm trên web (${x.source_name ?? new URL(x.url).hostname})`, item: { title: String(x.title), url: String(x.url), published_at: new Date(x.published_at).toISOString(), summary: String(x.summary ?? '').slice(0, 800) }, ...(x.suggested_type ? { suggested_type: x.suggested_type } : {}) }))
    try {
      const out = await addToInbox(ctx, items, { trigger: 'claude', minRelevance: 0, maxAgeDays: 7 })
      report.news.rows++; for (const k of ['created', 'duplicate', 'rejected', 'too_old', 'irrelevant'] as const) report.news[k] += out.report[k]
      // Tin bị từ chối chỉ vì miền chưa có trong danh sách nguồn công khai: giữ chờ tối đa 3 ngày để Tuân thủ xem xét bổ sung
      const onlyDomain = !out.report.created && !out.report.duplicate && out.report.rejected > 0 && out.report.rejected_items.every(x => x.errors.every(e => e.startsWith('Miền ')))
      if (onlyDomain && !tooOld(ctx, r)) { await mark(ctx, r, { status: 'READY', note: 'Chờ Tuân thủ bổ sung miền vào danh sách nguồn công khai', result: out.report }); report.waiting.push({ id: r.id, reason: 'miền chưa thuộc danh sách nguồn công khai' }); continue }
      await mark(ctx, r, { status: out.report.created || out.report.duplicate ? 'IMPORTED' : 'REJECTED', result: { ids_by_url: out.ids_by_url, ...out.report } })
    } catch (e) { await mark(ctx, r, { status: 'REJECTED', error: String((e as Error).message ?? e) }); report.rejected.push({ id: r.id, reason: String((e as Error).message ?? e) }) }
  }

  // 2. Sự kiện (gom tin theo đường dẫn)
  for (const r of rows.filter(x => x.kind === 'event')) {
    const urls: string[] = r.data?.news_urls ?? []
    const found = urls.length ? ((await env.DB.prepare(`SELECT id, json_extract(data, '$.url') AS u, event_id FROM news_items WHERE json_extract(data, '$.url') IN (${urls.map(() => '?').join(',')})`).bind(...urls).all<{ id: string; u: string; event_id: string | null }>()).results ?? []) : []
    const free = found.filter(f => !f.event_id)
    if (!free.length) {
      if (tooOld(ctx, r) || found.length) { await mark(ctx, r, { status: 'REJECTED', error: found.length ? 'Các tin đã thuộc sự kiện khác' : 'Không có tin nào của sự kiện qua được kiểm soát nguồn công khai (BR-26)' }); report.rejected.push({ id: r.id, reason: 'không có tin hợp lệ' }) }
      else report.waiting.push({ id: r.id, reason: 'chờ nhập tin' })
      continue
    }
    if (!await claim(ctx, r)) continue
    try {
      const { event } = await createEventFromNews(ctx, { news_ids: free.map(f => f.id), type: r.data.type, title: r.data.title, ...(r.data.origin === 'global' || r.data.origin === 'local' ? { origin: r.data.origin } : {}) })
      await mark(ctx, r, { status: 'IMPORTED', result: { event_id: event.id, news_ids: free.map(f => f.id), missing_urls: urls.filter(u => !found.some(f => f.u === u)) } })
      report.events.push(event.id)
    } catch (e) { await mark(ctx, r, { status: 'REJECTED', error: String((e as Error).message ?? e) }); report.rejected.push({ id: r.id, reason: String((e as Error).message ?? e) }) }
  }

  // 3. Nhận định của Agent CIO (kèm phản biện) → qua đồ thị, schema, phản biện; chờ CIO duyệt
  for (const r of rows.filter(x => x.kind === 'cio_view')) {
    const ev = await resolveEvent(ctx, r.subject ?? r.data?.event_ref)
    if (!ev) { if (tooOld(ctx, r)) { await mark(ctx, r, { status: 'REJECTED', error: 'Không tìm thấy sự kiện' }); report.rejected.push({ id: r.id, reason: 'không tìm thấy sự kiện' }) } else report.waiting.push({ id: r.id, reason: 'chờ sự kiện' }); continue }
    if (ev.hold?.status === 'PENDING') { report.waiting.push({ id: r.id, reason: `${ev.id} chờ Tuân thủ cho phép (BR-27)` }); continue }
    const views = await ctx.repo.list<ViewRec>('views', 'event_id = ?', [ev.id])
    const waiting = (await ctx.repo.list<JobRec>('jobs', "status = 'WAITING_EXTERNAL' AND kind = 'cio_run' AND subject = ?", [ev.id]))[0]
    if (views.length && !waiting && !r.data?.rework) { await mark(ctx, r, { status: 'REJECTED', error: `${ev.id} đã có nhận định; muốn lập phiên bản mới thì CIO yêu cầu Làm lại` }); report.rejected.push({ id: r.id, reason: 'đã có nhận định' }); continue }
    if (!await claim(ctx, r)) continue
    try {
      const ext: ExternalCio = { view: r.data.view, nodes: r.data.nodes, challenger: r.data.challenger, meta: r.data.meta }
      if (!ext.view || !Array.isArray(ext.view.impacts)) throw new HttpError(422, 'Thiếu view.impacts')
      const v = await runCioAgent(ctx, ev.id, { skipRole: true, external: ext, ...(waiting?.params.instructions ? { instructions: waiting.params.instructions } : {}) })
      await mark(ctx, r, { status: 'IMPORTED', result: { event_id: ev.id, view_id: v.id, view_status: v.status, ...(v.errors?.length ? { errors: v.errors } : {}) } })
      await completeWaiting(ctx, 'cio_run', ev.id, { view_id: v.id, status: v.status })
      report.views.push({ view_id: v.id, status: v.status })
    } catch (e) { await mark(ctx, r, { status: 'REJECTED', error: String((e as Error).message ?? e).slice(0, 1000) }); report.rejected.push({ id: r.id, reason: String((e as Error).message ?? e).slice(0, 200) }) }
  }

  // 3b. Phản biện độc lập (F11): bản ghi riêng, từ phiên làm việc khác với phiên soạn nhận định và mô hình khác.
  //     data = { view_id, findings, counter_scenario?, meta: { model, session } }
  for (const r of rows.filter(x => x.kind === 'challenge')) {
    const viewId = r.subject ?? r.data?.view_id
    let v: ViewRec | null = null
    try { v = viewId ? await getView(ctx, viewId) : null } catch { v = null }
    if (!v) { if (tooOld(ctx, r)) { await mark(ctx, r, { status: 'REJECTED', error: 'Không tìm thấy nhận định' }); report.rejected.push({ id: r.id, reason: 'không tìm thấy nhận định' }) } else report.waiting.push({ id: r.id, reason: 'chờ nhận định' }); continue }
    if (!['PENDING_APPROVAL', 'PENDING_CHALLENGE'].includes(v.status)) { await mark(ctx, r, { status: 'REJECTED', error: `Nhận định ở trạng thái ${v.status}` }); report.rejected.push({ id: r.id, reason: 'nhận định không còn ở bàn duyệt' }); continue }
    if (!await claim(ctx, r)) continue
    try {
      const agentRun = v.agent_run_id ? await ctx.repo.get<{ external_meta?: { model?: string; session?: string }; model?: { model?: string } }>('agent_runs', v.agent_run_id) : null
      const cioModel = agentRun?.external_meta?.model ?? agentRun?.model?.model ?? ''
      const meta = (r.data?.meta ?? {}) as { model?: string; session?: string }
      if (!meta.session || !meta.model) throw new HttpError(422, 'Phản biện độc lập phải ghi meta.model và meta.session')
      const sep = { session: String(meta.session), cio_session: agentRun?.external_meta?.session, cio_model: cioModel }
      const label = `Claude – phiên phản biện riêng (${meta.model})`
      const before = (await viewChallenges(ctx, v.id)).length
      const nv = v.status === 'PENDING_CHALLENGE' && v.unchallenged.length
        ? await runReChallenge(ctx, v.id, { findings: r.data.findings ?? [], model: label, session: sep.session, cio_session: sep.cio_session, cio_model: sep.cio_model })
        : await runPreChallenge(ctx, v.id, { findings: r.data.findings ?? [], counter_scenario: r.data.counter_scenario, model: label, separate: sep })
      const chs = await viewChallenges(ctx, v.id)
      const ch = chs[chs.length - 1]
      // Bài kiểm tra phản biện: chấm ngay, không ghi gì về bài kiểm tra vào kết quả bản ghi (phiên phản biện đọc được bảng này)
      await scoreCanary(ctx, v.id)
      await mark(ctx, r, { status: 'IMPORTED', result: { view_id: v.id, challenge_id: ch?.id, independence: ch?.independence, view_status: nv.status, added: chs.length - before } })
      report.challenges.push({ view_id: v.id, challenge: ch?.id ?? '' })
    } catch (e) { await mark(ctx, r, { status: 'REJECTED', error: String((e as Error).message ?? e).slice(0, 1000) }); report.rejected.push({ id: r.id, reason: String((e as Error).message ?? e).slice(0, 200) }) }
  }

  // 3c. Agent Rà soát pháp luật: văn bản mới (dự thảo hoặc đã ban hành) kèm đánh giá mức quan trọng.
  //     Vào radar ở trạng thái chờ Tuân thủ xác nhận nguồn; không tự chạy phân tích hay tới khách.
  //     data = { doc: {title, agency, kind, status, published_at, effective_expected?, url, topics, content}, assessment, meta }
  for (const r of rows.filter(x => x.kind === 'policy_doc')) {
    if (!await claim(ctx, r)) continue
    try {
      const d = r.data?.doc ?? {}
      const a = { ...(r.data?.assessment ?? {}), model: r.data?.meta?.model, session: r.data?.meta?.session, prepared_at: r.data?.meta?.prepared_at }
      const doc = await addPolicy(ctx, { title: String(d.title ?? ''), agency: String(d.agency ?? ''), kind: d.kind, status: String(d.status ?? ''), published_at: d.published_at ? new Date(d.published_at).toISOString() : '', ...(d.effective_expected ? { effective_expected: String(d.effective_expected) } : {}), url: String(d.url ?? ''), topics: Array.isArray(d.topics) ? d.topics : [], content: String(d.content ?? '').slice(0, 20000), simulated: false, ai_assessment: a })
      await mark(ctx, r, { status: 'IMPORTED', result: { doc_id: doc.id, importance: a.importance, score: a.score } })
      report.policy_docs.push(doc.id)
    } catch (e) {
      const det = (e as HttpError).details as string[] | undefined
      await mark(ctx, r, { status: 'REJECTED', error: (String((e as Error).message ?? e) + (det ? ': ' + det.join('; ') : '')).slice(0, 1500) }); report.rejected.push({ id: r.id, reason: String((e as Error).message ?? e).slice(0, 200) })
    }
  }

  // 4. Tóm tắt văn bản chính sách
  for (const r of rows.filter(x => x.kind === 'policy_summary')) {
    const docId = r.subject ?? r.data?.doc_id
    const doc = docId ? await ctx.repo.get<{ state: string }>('policy_documents', docId) : null
    if (!doc || doc.state !== 'SOURCE_CONFIRMED') { if (tooOld(ctx, r) || (doc && doc.state === 'ANALYZED')) { await mark(ctx, r, { status: 'REJECTED', error: doc ? `Văn bản ở trạng thái ${doc.state}` : 'Không có văn bản' }); report.rejected.push({ id: r.id, reason: 'văn bản không hợp lệ' }) } else report.waiting.push({ id: r.id, reason: 'chờ Tuân thủ xác nhận nguồn' }); continue }
    if (!await claim(ctx, r)) continue
    try {
      const out = await analyzePolicy(ctx, docId, { external: { summary: r.data.summary, meta: r.data.meta } })
      await mark(ctx, r, { status: 'IMPORTED', result: { doc_id: docId, event_id: out.event_id, matched: out.matched } })
      await completeWaiting(ctx, 'policy_analyze', docId, { doc_id: docId, event_id: out.event_id })
      report.policies.push(docId)
    } catch (e) { await mark(ctx, r, { status: 'REJECTED', error: String((e as Error).message ?? e).slice(0, 1000) }); report.rejected.push({ id: r.id, reason: String((e as Error).message ?? e).slice(0, 200) }) }
  }

  // 5. Giá thật: tạo ảnh chụp giá mới từ ảnh chụp hiện tại, thay giá các mã có nguồn thật (ghi nguồn, ngày giá từng mã)
  for (const r of rows.filter(x => x.kind === 'prices')) {
    if (!await claim(ctx, r)) continue
    try {
      const rec = await importPrices(ctx, r.data)
      await mark(ctx, r, { status: 'IMPORTED', result: { snapshot_id: rec.id, price_date: rec.price_date, updated: rec.updated } })
      report.prices.push(rec.id)
    } catch (e) {
      // Mọi mã đều chưa có trong ảnh chụp giá (ví dụ cơ sở dữ liệu chưa nạp lại danh mục công cụ mới): giữ chờ tối đa 3 ngày
      const det = (e as HttpError).details as string[] | undefined
      if (Array.isArray(det) && det.length && det.every(x => x.includes('mã không có trong ảnh chụp giá')) && !tooOld(ctx, r)) { await mark(ctx, r, { status: 'READY', note: 'Chờ danh mục công cụ khớp với bảng giá (nạp lại dữ liệu mẫu)' }); report.waiting.push({ id: r.id, reason: 'mã giá chưa có trong danh mục công cụ' }); continue }
      await mark(ctx, r, { status: 'REJECTED', error: String((e as Error).message ?? e).slice(0, 1000) + (det ? ': ' + JSON.stringify(det).slice(0, 800) : '') }); report.rejected.push({ id: r.id, reason: String((e as Error).message ?? e).slice(0, 200) })
    }
  }

  // 6. Số liệu thị trường (nguồn thứ hai để chấm sổ dự báo và xem "đã phản ánh vào giá"), bộ sự kiện chuẩn, nhịp tim lượt chạy
  for (const r of rows.filter(x => x.kind === 'market_data')) {
    if (!await claim(ctx, r)) continue
    try { const out = await importMarketData(ctx, r.data); await mark(ctx, r, { status: 'IMPORTED', result: out }); report.market.push(...out.saved) }
    catch (e) { const det = (e as HttpError).details; await mark(ctx, r, { status: 'REJECTED', error: String((e as Error).message ?? e).slice(0, 500) + (det ? ': ' + JSON.stringify(det).slice(0, 1200) : '') }); report.rejected.push({ id: r.id, reason: String((e as Error).message ?? e).slice(0, 200) }) }
  }
  for (const r of rows.filter(x => x.kind === 'golden_view')) {
    if (!await claim(ctx, r)) continue
    try { const g = await importGoldenRun(ctx, r.data); await mark(ctx, r, { status: 'IMPORTED', result: { run_id: g.id, drift: g.drift ?? null, analog: g.analog_check?.agreement ?? null } }); report.golden.push(g.id) }
    catch (e) { const det = (e as HttpError).details; await mark(ctx, r, { status: 'REJECTED', error: String((e as Error).message ?? e).slice(0, 500) + (det ? ': ' + JSON.stringify(det).slice(0, 1200) : '') }); report.rejected.push({ id: r.id, reason: String((e as Error).message ?? e).slice(0, 200) }) }
  }
  for (const r of rows.filter(x => x.kind === 'run_log')) {
    if (!await claim(ctx, r)) continue
    try { const l = await importRunLog(ctx, r.data); await mark(ctx, r, { status: 'IMPORTED', result: { run_log_id: l.id } }); report.run_logs.push(l.id) }
    catch (e) { await mark(ctx, r, { status: 'REJECTED', error: String((e as Error).message ?? e).slice(0, 500) }); report.rejected.push({ id: r.id, reason: String((e as Error).message ?? e).slice(0, 200) }) }
  }

  // Chỉ ghi nhật ký khi có thay đổi (tránh một bản ghi mỗi 10 phút khi các bản ghi chỉ đang chờ)
  const changed = report.news.created + report.events.length + report.views.length + report.challenges.length + report.policies.length + report.policy_docs.length + report.prices.length + report.market.length + report.golden.length + report.run_logs.length + report.rejected.length
  if (changed || report.trigger !== 'cron') { const u = ctx.uow(); u.audit({ actor: report.trigger === 'cron' ? 'SYSTEM:cron' : 'ADMIN:CLAUDE', action: 'external.imported', object: 'external_outputs', data: report }); await u.commit() }
  return report
}

export async function listExternal(ctx: AppCtx, limit = 50) {
  requireRole(ctx, 'CIO', 'ADMIN', 'COMPLIANCE')
  const rows = (await loadRows(ctx)).reverse()
  return rows.slice(0, limit).map(r => ({ id: r.id, kind: r.kind, subject: r.subject ?? null, status: r.status, created_at: r.created_at, result: r.result ?? null, error: r.error ?? null, title: r.data?.title ?? r.data?.view?.summary ?? (Array.isArray(r.data?.items) ? `${r.data.items.length} tin` : null) }))
}

// Ảnh chụp giá thật: mỗi mã ghi nguồn (ví dụ "TCBS (MCP)", "fmarket.vn"), đường dẫn hoặc công cụ, ngày giá của mã.
// Mã không có trong lần đẩy giữ nguyên giá của ảnh chụp trước (nhãn nguồn cũ, ví dụ "Mẫu"), để người xem phân biệt được.
export async function importPrices(ctx: AppCtx, d: { price_date: string; points: ExternalPricePoint[]; meta?: unknown }): Promise<SnapshotRecord & { updated: number }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d?.price_date ?? '')) throw new HttpError(422, 'price_date phải có dạng YYYY-MM-DD')
  if (d.price_date > ctx.now().slice(0, 10)) throw new HttpError(422, 'price_date không được ở tương lai')
  const base = await currentSnapshot(ctx)
  const known = new Set(base.points.map(p => p.key))
  const errors: string[] = []
  const ov = new Map<string, ExternalPricePoint>()
  for (const p of d.points ?? []) {
    if (!known.has(p.key)) { errors.push(`${p.key}: mã không có trong ảnh chụp giá`); continue }
    if (!/^\d+(\.\d+)?$/.test(String(p.price)) || Number(p.price) <= 0) { errors.push(`${p.key}: giá không hợp lệ (${p.price})`); continue }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date ?? '') || p.date > d.price_date) { errors.push(`${p.key}: ngày giá không hợp lệ (${p.date})`); continue }
    if (!p.source) { errors.push(`${p.key}: thiếu nguồn`); continue }
    ov.set(p.key, p)
  }
  if (errors.length || !ov.size) throw new HttpError(422, 'Bảng giá không hợp lệ', errors.length ? errors : ['Không có giá nào'])
  const now = ctx.now()
  const points: PricePoint[] = base.points.map(bp => {
    const p = ov.get(bp.key)
    if (!p) return bp
    return { key: bp.key, date: p.date, price: String(p.price), currency: bp.currency, source: p.source, source_ref: p.source_ref ?? p.source, fetched_at: now, flag: 'external_ai' }
  })
  const fx = { ...base.fx }
  for (const [k, p] of ov) if (k.startsWith('FX:')) fx[k.slice(3)] = String(p.price)
  const missing = base.missing.filter(k => !ov.has(k)), fallbacks = base.fallbacks.filter(k => !ov.has(k))
  const hash = await hashOf({ price_date: d.price_date, points: points.map(({ fetched_at, ...p }) => p), fx, missing, fallbacks })
  const seq = await ctx.repo.nextSeq(`PS-${d.price_date}`)
  const sources = [...new Set([...ov.values()].map(p => p.source))]
  const rec: SnapshotRecord = { id: `PS-${d.price_date.replace(/-/g, '')}-${seq}`, price_date: d.price_date, points, fx, missing, fallbacks, hash, created_at: now, mode: 'external', confirmation: { required: true, status: 'PENDING' },
    status: [{ id: 'EXTERNAL', label: `Giá thật do Claude lấy (${sources.join(', ')})`, requested: ov.size, ok: ov.size, fallback: 0, missing: 0, last_fetch: now }] }
  const u = ctx.uow()
  u.put('price_snapshots', rec as never)
  for (const [k, p] of ov) u.put('price_points', { id: `${k}|${p.date}`, key: k, date: p.date, price: String(p.price), source_ref: p.source_ref ?? p.source } as never)
  u.audit({ actor: 'ADMIN:CLAUDE', action: 'pricing.snapshot', object: rec.id, data: { price_date: rec.price_date, hash, mode: 'external', base_snapshot: base.id, updated: [...ov.values()].map(p => ({ key: p.key, price: p.price, date: p.date, source: p.source, source_ref: p.source_ref })), kept_from_base: points.filter(p => !ov.has(p.key)).map(p => p.key), meta: d.meta ?? null } })
  await u.commit()
  return { ...rec, updated: ov.size }
}

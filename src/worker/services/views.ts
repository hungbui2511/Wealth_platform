// Agent CIO (M3), phản biện (M4) và bàn duyệt của CIO (M5).
import { ASSET_CLASSES, FX_CURRENCIES, SECTORS } from '../../shared/catalog'
import type { Finding, ImpactLine, ViewBody } from '../../shared/types'
import { lineKey, validateView, type ViewContext } from '../../shared/schemas'
import { buildCioGraph, ANALYSTS, type NodeRun } from '../../agents/cioGraph'
import { keywordView } from '../../agents/keywordView'
import { citationChecks, diffLines, normalizeLlmFindings, ruleChecks, scenarioRuleChecks, sourceRuleChecks, type RawFinding } from '../../agents/challenger'
import { callJson } from '../../agents/llm'
import { wrapData, type ModelSet, type PromptSet } from '../../agents/prompts'
import { MOCK } from '../../data/mock'
import { SAMPLE_STORE } from '../../data/seed'
import { assertViewTransition } from '../../engine/states'
import { recordForecast } from './quality'
import { assertAgentActive } from './ops'
import { actor, HttpError, minReason, requireRole, type AppCtx } from '../ctx'
import type { UnitOfWork } from '../db'
import { activeConfig, activeRestricted, loadConfigs, loadFactorModel } from './config'
import { keywordScenarios, scenariosFromImpacts } from '../../agents/keywordView'
import { eventNews, getEvent, withTimestamp, type EventRec, type NewsItem } from './events'
import { currentSnapshot, loadInstruments } from './portfolio'
import { evNum, nextChallengeNo, nextViewVersion } from '../ids'

export interface ViewRec {
  id: string; event_id: string; version: number; status: string; origin: 'agent' | 'manual'
  body: ViewBody; ai_body: ViewBody | null; agent_run_id?: string; challenge_error?: string
  unchallenged: string[]; cio_edits: { at: string; by: string; key: string; kind: string; before?: ImpactLine; after?: ImpactLine; note?: string }[]
  removed_restricted: ImpactLine[]; errors?: string[]; instructions?: string; manual_bypass?: boolean; analysts_derived?: boolean
  created_at: string; view_ready_at?: string; approved_at?: string
  history: { at: string; from: string; to: string; by: string; note?: string }[]
}

export interface ChallengeRec {
  id: string; view_id: string; stage: 'pre_approval' | 're_challenge' | 'post_check'; created_at: string
  findings: Finding[]; counter_scenario?: string; summary?: string; lines?: string[]; run_id?: string
  input_package: unknown; model: string; prompt_version: string | null; dropped?: string[]
  // Phản biện có độc lập với bên soạn nhận định không: khác mô hình VÀ khác phiên/lượt gọi. Thiếu trường này (bản ghi cũ) coi như chưa độc lập.
  independence?: { independent: boolean; reason: string; self_declared?: boolean }
}

// Đánh giá độc lập của phản biện
// Mã mô hình chuẩn hoá từ chuỗi bất kỳ (mã API, tên hiển thị, nhãn bọc): "Claude Opus 5.5", "claude-opus-5-5", "Claude – phiên … (claude-sonnet-5-5)"
export function modelId(x: string | undefined | null): string | null {
  const m = String(x ?? '').toLowerCase().match(/claude[\s_-]*(opus|sonnet|haiku|fable|mythos)[\s_-]*(\d+)(?:[.\s_-]+(\d+))?/)
  return m ? `claude-${m[1]}-${m[2]}${m[3] ? `-${m[3]}` : ''}` : null
}

export function independenceOf(mode: 'mock' | 'live' | 'external' | 'external_challenge' | 'external_same', cioModel: string, challengerModel: string, sessions?: { cio?: string; challenger?: string }): { independent: boolean; reason: string; self_declared?: boolean } {
  if (mode === 'external_same') return { independent: false, reason: 'Phản biện nằm trong cùng bản ghi với nhận định (cùng phiên Claude vừa soạn vừa phản biện): cần bản ghi phản biện riêng từ phiên khác, mô hình khác' }
  if (mode === 'external') return { independent: false, reason: 'Chế độ hộp chờ: chưa có phản biện từ phiên độc lập' }
  if (mode === 'mock') return { independent: true, reason: 'Chế độ mô phỏng (demo, kiểm thử): coi như độc lập' }
  // So trên mã mô hình đã chuẩn hoá (claude-opus-5-5), không so nhãn hiển thị: nhãn bọc tên mô hình khiến phép so luôn khác
  const a = modelId(cioModel), b = modelId(challengerModel)
  if (!a || !b) return { independent: false, reason: `Không xác định được mã mô hình (soạn: "${cioModel}", phản biện: "${challengerModel}"): không coi là độc lập` }
  if (a === b) return { independent: false, reason: `Agent Phản biện dùng cùng mô hình với Agent CIO (${a})` }
  if (mode === 'external_challenge') {
    if (!sessions?.challenger || !sessions.cio || sessions.challenger === sessions.cio) return { independent: false, reason: 'Bản ghi phản biện không ghi phiên làm việc, hoặc trùng phiên với bên soạn nhận định' }
    return { independent: true, reason: `Độc lập theo khai báo của bản ghi (tự khai, hệ thống không xác minh được): phiên phản biện ${sessions.challenger} khác phiên soạn ${sessions.cio}; mô hình ${b} khác ${a}`, self_declared: true }
  }
  return { independent: true, reason: `Lượt gọi riêng, mô hình ${challengerModel} khác ${cioModel}; chỉ nhận đầu ra cuối (BR-05)` }
}

export interface FindingResponse { id: string; view_id: string; finding_id: string; response: 'accepted_fixed' | 'disagree' | 'out_of_scope'; fixed_line?: string; comment: string; by: string; at: string }


export async function getView(ctx: AppCtx, id: string): Promise<ViewRec> {
  const v = await ctx.repo.get<ViewRec>('views', id)
  if (!v) throw new HttpError(404, `Không có nhận định ${id}`)
  return v
}

export function transition(ctx: AppCtx, v: ViewRec, to: string, note?: string): ViewRec {
  assertViewTransition(v.status, to)
  return { ...v, status: to, history: [...v.history, { at: ctx.now(), from: v.status, to, by: actor(ctx), ...(note ? { note } : {}) }] }
}

async function viewContext(ctx: AppCtx, e: EventRec, news: NewsItem[]): Promise<ViewContext> {
  const [cfg, instruments, fm] = await Promise.all([loadConfigs(ctx), loadInstruments(ctx), loadFactorModel(ctx)])
  return { newsIds: new Set(news.map(n => n.id)), instruments, restricted: new Set(activeRestricted(cfg, ctx.now()).flatMap(r => r.instruments)), factorIds: fm.model.factors.map(f => f.id) }
}

// Gói dữ liệu thị trường (FR-311): lấy qua lớp adapter, không chứa dữ liệu danh mục gia đình
async function marketPack(ctx: AppCtx) {
  const snap = await currentSnapshot(ctx)
  const series = SAMPLE_STORE.sample.series
  const tail = (k: string) => { const s = series[k] ?? []; const last = s[s.length - 1]; const first = s[Math.max(0, s.length - 20)]; return last ? { date: last.date, value: last.value, change_20_sessions_pct: first ? Math.round((last.value / first.value - 1) * 10000) / 100 : null } : null }
  const listed = snap.points.filter(p => !p.key.includes('-') && !p.key.startsWith('FX:')).map(p => ({ key: p.key, price: p.price, date: p.date, source: p.source }))
  return { price_date: snap.price_date, snapshot_id: snap.id, index: tail('IDX:VNINDEX'), gold_world_usd: tail('GOLD:WORLD_USD'), policy_rate: tail('RATE:POLICY'), deposit_rate_12m: tail('RATE:DEPOSIT_12M'), fx: snap.fx, listed }
}

function fillSources(v: unknown, news: NewsItem[]): unknown {
  return JSON.parse(JSON.stringify(v).replace(/\{\{SRC(\d)\}\}/g, (_m, i) => news[Number(i) - 1]?.id ?? news[0]?.id ?? ''))
}

function mockKey(e: EventRec) { return e.policy_doc_id ? `policy-${e.policy_doc_id}` : e.id }

// Chạy Agent CIO cho một sự kiện, tạo phiên bản nhận định mới
// Kết quả do Claude lập trong phiên làm việc (chế độ external): đầu ra từng nút, nhận định cuối, phản biện.
// source_ids có thể ghi bằng đường dẫn tin (URL) hoặc {{SRCn}}; hệ thống đổi sang mã tin của sự kiện.
export interface ExternalCio {
  view: { summary?: string; impacts: unknown[]; scenarios?: unknown }
  nodes?: Record<string, unknown>
  challenger?: { findings: unknown[]; counter_scenario?: string }
  meta?: { model?: string; session?: string; note?: string; prepared_at?: string }
}
export function externalLabel(meta?: ExternalCio['meta']) { return `Claude – phiên làm việc (${meta?.model ?? 'gói subscription'})` }
function mapSources(v: unknown, news: NewsItem[]): unknown {
  const byUrl = new Map(news.map(n => [n.url, n.id]))
  return JSON.parse(JSON.stringify(v ?? null), (k, val) => k === 'source_ids' && Array.isArray(val)
    ? val.map((s: string) => byUrl.get(s) ?? (/^\{\{SRC(\d+)\}\}$/.test(s) ? news[Number(s.slice(5, -2)) - 1]?.id ?? s : s))
    : val)
}

export async function runCioAgent(ctx: AppCtx, eventId: string, opts: { instructions?: string; skipRole?: boolean; external?: ExternalCio } = {}): Promise<ViewRec> {
  if (!opts.skipRole) requireRole(ctx, 'CIO', 'ADMIN')
  const e = await getEvent(ctx, eventId)
  if (e.hold?.status === 'PENDING') {
    const u = ctx.uow(); u.audit({ actor: actor(ctx), action: 'agent.blocked_restricted', object: e.id, data: { entries: e.hold.entries } }); await u.commit()
    throw new HttpError(409, 'Sự kiện nhắc tới tổ chức trong danh sách hạn chế: chờ Tuân thủ cho phép trước khi chạy agent (BR-27)')
  }
  if (!opts.external) await assertAgentActive(ctx, 'cio')
  const news = await eventNews(ctx, e)
  const version = await nextViewVersion(ctx, e.id)
  const viewId = `VW-${evNum(e.id)}-v${version}`
  const instruments = await loadInstruments(ctx)
  const vctx = await viewContext(ctx, e, news)
  const fm = await loadFactorModel(ctx)
  const prompts = (await activeConfig<PromptSet>(ctx, 'PROMPT'))
  const models = (await activeConfig<ModelSet>(ctx, 'MODEL'))
  // Rào chắn thông tin (BR-28): chỉ tin đã qua BR-26, gói thị trường qua adapter, danh mục cấu hình
  const input = {
    event: { id: e.id, type: e.type, title: e.title },
    news: news.map(n => ({ id: n.id, title: n.title, summary: n.summary, url: n.url, published_at: n.published_at })),
    catalog: { asset_classes: ASSET_CLASSES, sectors: SECTORS, fx: FX_CURRENCIES, instruments: Object.values(instruments).filter(i => i.price_source !== 'FIXED' && !i.id.includes('-') && !vctx.restricted.has(i.id)).map(i => ({ id: i.id, name: i.name, asset_class: i.asset_class, ...(i.sector ? { sector: i.sector } : {}) })) },
    // Danh mục yếu tố rủi ro và thư viện cú sốc do CIO duyệt: agent chỉ được chọn trong danh mục này
    factors: fm.model.factors.map(f => ({ id: f.id, label: f.label, unit: f.unit, origin: f.origin, library: f.library })),
    ...(opts.instructions ? { instructions: opts.instructions } : {}),
  }
  // Đầu ra ghi sẵn chỉ dành cho sự kiện của gói mẫu (tin giả lập); tin thật dùng nhận định mô phỏng theo từ khóa
  const mock = news.every(n => n.simulated) ? MOCK.cio[mockKey(e)] : undefined
  const mockVer = version >= 2 && mock?.v2 ? mock.v2 : mock?.v1
  const pv = prompts.version.id
  const exec = {
    async run(node: string, payload: unknown, attempt: number) {
      const promptText = node.startsWith('analyst_') ? prompts.content.cio.analyst.replace('{{GROUP}}', ANALYSTS[node as keyof typeof ANALYSTS].name).replace('{{CLASSES}}', ANALYSTS[node as keyof typeof ANALYSTS].classes.join(', ')) : node === 'debate' ? prompts.content.cio.debate : prompts.content.cio.synthesize
      if (opts.external) {
        const ext = mapSources(opts.external, news) as ExternalCio
        let output: unknown
        if (node === 'synthesize') output = { summary: ext.view.summary || e.title, impacts: ext.view.impacts, ...(ext.view.scenarios ? { scenarios: ext.view.scenarios } : {}) }
        else if (ext.nodes?.[node]) output = ext.nodes[node]
        else if (node === 'debate') output = { topics: [] }
        else { const cls = ANALYSTS[node as keyof typeof ANALYSTS]; output = { lines: (ext.view.impacts as ImpactLine[]).filter(l => (l.scope === 'asset_class' && (cls.classes as readonly string[]).includes(l.target)) || (l.scope === 'fx' && cls.fx)), notes: 'Trích từ nhận định cuối do Claude lập' } }
        return { output, prompt: promptText, prompt_version: `${pv}:${prompts.content.version}`, model: externalLabel(opts.external.meta) }
      }
      if (ctx.agentMode !== 'live') {
        let output: unknown
        // Sự kiện mẫu: đầu ra ghi sẵn. Tin mới: nhận định mô phỏng theo từ khóa (ghi rõ không phải AI)
        const kw = mockVer ? null : keywordView(e.title, news)
        if (node === 'synthesize') {
          const v = mockVer ? (fillSources(mockVer.view, news) as ViewBody) : kw!
          const sc = mockVer ? scenariosFromImpacts(v.impacts, news.map(n => n.id)) : keywordScenarios(news) ?? scenariosFromImpacts(v.impacts, news.map(n => n.id))
          output = { summary: v.summary || e.title, impacts: v.impacts, ...(sc ? { scenarios: sc } : {}) }
        } else if (mockVer) output = fillSources(mockVer.nodes[node], news)
        else if (node === 'debate') output = { topics: [] }
        else { const cls = ANALYSTS[node as keyof typeof ANALYSTS]; output = { lines: kw!.impacts.filter(l => (l.scope === 'asset_class' && (cls.classes as readonly string[]).includes(l.target)) || (l.scope === 'fx' && cls.fx)), notes: 'Chế độ mô phỏng theo từ khóa (không phải AI)' } }
        return { output, prompt: promptText, prompt_version: `${pv}:${prompts.content.version}`, model: `mock (${models.content.cio.model})` }
      }
      await ctx.progress?.(attempt > 0 ? `${node}#${attempt + 1}` : node)
      const r = await callJson(ctx.env, models.content.cio, promptText, wrapData(`nút ${node}, lần ${attempt + 1}`, payload), ctx.fetchFn)
      return { output: r.json, prompt: promptText, prompt_version: `${pv}:${prompts.content.version}`, model: r.model }
    },
  }
  const graph = buildCioGraph(exec, { viewContext: vctx, marketPack: () => marketPack(ctx), now: ctx.now, viewMeta: { event_id: e.id, view_id: viewId, event_type: e.type } })
  const runId = `RUN-CIO-${evNum(e.id)}-v${version}-${await ctx.repo.nextSeq('RUN-CIO')}`
  let final: { result: { ok: boolean; view?: ViewBody; errors: string[]; removed_restricted: ImpactLine[] } | null; nodeRuns: NodeRun[] }
  let fatal: string | null = null
  try { final = await graph.invoke({ input }) as never }
  catch (err) { fatal = String((err as Error).message ?? err); final = { result: null, nodeRuns: [] } }
  // Thứ tự lưu xác định: bốn nút phân tích chạy song song được xếp theo thứ tự khai báo
  const order = (n: NodeRun) => n.node.startsWith('analyst_') ? Object.keys(ANALYSTS).indexOf(n.node) : -1
  const firstAnalyst = Math.min(...final.nodeRuns.filter(n => order(n) >= 0).map(n => n.seq))
  final.nodeRuns = [...final.nodeRuns].sort((a, b) => (order(a) >= 0 ? firstAnalyst + order(a) / 10 : a.seq) - (order(b) >= 0 ? firstAnalyst + order(b) / 10 : b.seq)).map((n, i) => ({ ...n, seq: i + 1 }))
  const now = ctx.now()
  let v: ViewRec = {
    id: viewId, event_id: e.id, version, status: 'DRAFTING', origin: 'agent', body: final.result?.view ?? { event_id: e.id, view_id: viewId, event_type: e.type, summary: e.title, impacts: [] },
    ai_body: final.result?.view ?? null, agent_run_id: runId, unchallenged: [], cio_edits: [], removed_restricted: final.result?.removed_restricted ?? [],
    created_at: now, history: [{ at: now, from: '', to: 'DRAFTING', by: actor(ctx) }], ...(opts.instructions ? { instructions: opts.instructions } : {}),
    // Bản ghi ngoài không gửi kèm đầu ra riêng của 4 nhà phân tích: các nút này chỉ là phần cắt từ nhận định cuối, tranh luận rỗng
    ...(opts.external && !opts.external.nodes ? { analysts_derived: true } : {}),
  }
  const uow = ctx.uow()
  uow.insert('agent_runs', { id: runId, agent: 'cio', subject_id: viewId, created_at: now, event_id: e.id, mode: opts.external ? 'external' : ctx.agentMode, ...(opts.external?.meta ? { external_meta: opts.external.meta } : {}), model: models.content.cio, prompt_version: pv, input_package: input, ok: !!final.result?.ok, errors: final.result?.errors ?? (fatal ? [fatal] : []), params: { max_retries: 2 } } as never)
  final.nodeRuns.forEach(n => uow.insert('agent_node_runs', { id: `${runId}-N${String(n.seq).padStart(2, '0')}`, run_id: runId, ...n } as never))
  uow.audit({ actor: 'AGENT:cio', action: 'agent.cio_run', object: viewId, data: { run_id: runId, mode: opts.external ? 'external' : ctx.agentMode, model: models.content.cio.model, prompt_version: pv, input_package: input, nodes: final.nodeRuns.map(n => n.node), ok: !!final.result?.ok, errors: final.result?.errors ?? [fatal] } })
  if (!final.result?.ok) {
    v = transition(ctx, { ...v, errors: final.result?.errors ?? [fatal ?? 'Lỗi không xác định'] }, 'AGENT_ERROR', 'Sai schema sau 2 lần thử lại')
    uow.insert('views', v as never)
    uow.audit({ actor: 'SYSTEM', action: 'view.status', object: viewId, data: { to: 'AGENT_ERROR', errors: v.errors } })
    await uow.commit()
    return v
  }
  v = transition(ctx, v, 'PENDING_CHALLENGE', 'Đầu ra hợp lệ theo schema')
  uow.insert('views', v as never)
  if (v.removed_restricted.length) uow.audit({ actor: 'SYSTEM', action: 'restricted.line_removed', object: viewId, data: { lines: v.removed_restricted.map(lineKey) } })
  await uow.commit()
  // FR-401: phản biện chạy tự động khi nhận định qua kiểm tra schema. Agent Phản biện lỗi (chế độ live) thì nhận định
  // giữ trạng thái chờ phản biện, ghi nhật ký và CIO chạy lại bằng /api/views/:id/challenge; không mất nhận định.
  try { return await runPreChallenge(ctx, viewId, opts.external ? { ...(mapSources(opts.external.challenger ?? { findings: [] }, news) as { findings: unknown[]; counter_scenario?: string }), model: externalLabel(opts.external.meta) } : undefined) }
  catch (err) {
    if (!(err instanceof ChallengerError)) throw err
    return { ...(await getView(ctx, viewId)), challenge_error: err.message }
  }
}

// Agent Phản biện (LLM) lỗi: mạng, hết thời gian, đầu ra không đọc được
export class ChallengerError extends HttpError {
  constructor(cause: unknown) { super(502, `Agent Phản biện lỗi, nhận định giữ nguyên trạng thái, chạy lại sau: ${String((cause as Error)?.message ?? cause).slice(0, 300)}`) }
}
async function callChallenger(ctx: AppCtx, viewId: string, stage: string, run: () => Promise<{ json: unknown; model: string }>) {
  try { return await run() }
  catch (err) {
    const u = ctx.uow(); u.audit({ actor: 'AGENT:challenger', action: 'agent.challenge_failed', object: viewId, data: { stage, error: String((err as Error)?.message ?? err).slice(0, 1000) } }); await u.commit()
    throw new ChallengerError(err)
  }
}

// Chạy lại phản biện trước duyệt cho nhận định đang chờ phản biện (sau khi Agent Phản biện lỗi)
export async function retryPreChallenge(ctx: AppCtx, viewId: string): Promise<ViewRec> {
  requireRole(ctx, 'CIO', 'ADMIN')
  const v = await getView(ctx, viewId)
  if (v.status !== 'PENDING_CHALLENGE' || v.unchallenged.length) throw new HttpError(409, 'Nhận định không chờ phản biện trước duyệt')
  if ((await viewChallenges(ctx, viewId)).some(c => c.stage === 'pre_approval')) throw new HttpError(409, 'Nhận định đã có báo cáo phản biện trước duyệt')
  return runPreChallenge(ctx, viewId)
}

async function recentApproved(ctx: AppCtx, excludeEvent: string) {
  const rows = await ctx.repo.list<ViewRec>('views', "status IN ('APPROVED','SUPERSEDED') AND event_id != ?", [excludeEvent], 'id DESC')
  return rows.slice(0, 5).map(v => ({ view_id: v.id, summary: v.body.summary, impacts: v.body.impacts.filter(l => l.level !== 0).map(l => ({ scope: l.scope, asset_class: l.asset_class, target: l.target, level: l.level })) }))
}

function numberFindings(prefix: string, stage: Finding['stage'], rule: RawFinding[], llm: RawFinding[]): Finding[] {
  return [...rule.map(f => ({ ...f, origin: 'rule' as const })), ...llm.map(f => ({ ...f, origin: 'llm' as const }))].map((f, i) => ({ ...f, stage, finding_id: `${prefix}-F${i + 1}` }))
}

async function policyCitationFindings(ctx: AppCtx, e: EventRec, news: NewsItem[]): Promise<RawFinding[]> {
  if (!e.policy_doc_id) return []
  const doc = await ctx.repo.get<{ content: string; kind: string }>('policy_documents', e.policy_doc_id)
  if (!doc) return []
  const changes = news.map(n => n.policy_change).filter(Boolean) as { change_id: string; article_refs: string[]; certainty: string }[]
  return citationChecks(changes, doc.content, doc.kind)
}

// Phản biện trước duyệt (FR-401 đến FR-404)
export async function runPreChallenge(ctx: AppCtx, viewId: string, external?: { findings: unknown[]; counter_scenario?: string; model: string; separate?: { session: string; cio_session?: string; cio_model: string } }): Promise<ViewRec> {
  let v = await getView(ctx, viewId)
  // Phản biện độc lập bổ sung (bản ghi riêng từ phiên khác) được nhận cả khi nhận định đã ở bàn duyệt
  if (v.status !== 'PENDING_CHALLENGE' && !(external?.separate && v.status === 'PENDING_APPROVAL')) throw new HttpError(409, 'Nhận định không ở trạng thái chờ phản biện')
  const e = await getEvent(ctx, v.event_id)
  const news = await eventNews(ctx, e)
  const vctx = await viewContext(ctx, e, news)
  const rule = ruleChecks(v.body, vctx)
  for (const l of v.removed_restricted) rule.push({ check: 'restricted_instrument', severity: 'medium', target: lineKey(l), issue: `Dòng cấp mã ${l.target} thuộc danh sách hạn chế đã bị loại ở bước kiểm tra schema (BR-27)`, suggestion: 'Không đưa nhận định cấp mã cho mã hạn chế; dòng loại tài sản và dòng ngành vẫn áp dụng bình thường' })
  rule.push(...await policyCitationFindings(ctx, e, news))
  rule.push(...scenarioRuleChecks(v.body, v.body.scenarios ? (await loadFactorModel(ctx)).model as never : null))
  rule.push(...sourceRuleChecks(v.body, news))
  const recent = await recentApproved(ctx, e.id)
  // BR-05: chỉ đầu ra cuối, tiêu đề và tóm tắt tin, danh mục, ≤ 5 nhận định đã duyệt, kết quả quy tắc
  const pkg = { view: v.body, news: news.map(n => ({ id: n.id, title: n.title, summary: n.summary })), catalog: { asset_classes: ASSET_CLASSES, sectors: SECTORS, fx: FX_CURRENCIES }, recent_approved: recent, rule_results: rule }
  const models = await activeConfig<ModelSet>(ctx, 'MODEL')
  const prompts = await activeConfig<PromptSet>(ctx, 'PROMPT')
  let llmRaw: unknown[] = [], counter = '', model = `mock (${models.content.challenger.model})`
  let independence = independenceOf(ctx.agentMode, models.content.cio.model, models.content.challenger.model)
  if (external) {
    llmRaw = external.findings ?? []; counter = external.counter_scenario ?? ''; model = external.model
    independence = external.separate ? independenceOf('external_challenge', external.separate.cio_model, model, { cio: external.separate.cio_session, challenger: external.separate.session }) : independenceOf('external_same', '', '')
  } else if (ctx.agentMode !== 'live') {
    const m = news.every(n => n.simulated) ? MOCK.challenger[mockKey(e)] : undefined
    const part = v.version >= 2 && m?.pre_v2 ? m.pre_v2 : m?.pre
    llmRaw = part?.findings ?? []; counter = part?.counter_scenario ?? ''
  } else {
    await ctx.progress?.('challenger_pre')
    const r = await callChallenger(ctx, v.id, 'pre_approval', () => callJson(ctx.env, models.content.challenger, prompts.content.challenger.pre, wrapData('gói phản biện trước duyệt', pkg), ctx.fetchFn))
    const j = r.json as { findings?: unknown[]; counter_scenario?: string }
    llmRaw = j.findings ?? []; counter = j.counter_scenario ?? ''; model = r.model
  }
  const norm = normalizeLlmFindings(llmRaw, vctx.newsIds)
  const n = await nextChallengeNo(ctx, v.id, 'pre_approval')
  const id = `CH-${evNum(v.event_id)}-v${v.version}-pre-${n}`
  const ch: ChallengeRec = { id, view_id: v.id, stage: 'pre_approval', created_at: ctx.now(), findings: numberFindings(id, 'pre_approval', rule, norm.findings), counter_scenario: counter, input_package: pkg, model, prompt_version: prompts.version.id, dropped: norm.dropped, independence }
  if (v.status === 'PENDING_CHALLENGE') v = transition(ctx, v, 'PENDING_APPROVAL', 'Có báo cáo phản biện')
  v.view_ready_at = v.view_ready_at ?? ctx.now()
  const uow = ctx.uow()
  uow.insert('challenges', ch as never).update('views', v as never)
  if (!e.timestamps.view_ready_at) uow.update('events', withTimestamp(e, 'view_ready_at', v.view_ready_at) as never)
  uow.audit({ actor: 'AGENT:challenger', action: 'agent.challenge', object: id, data: { view_id: v.id, stage: 'pre_approval', model, input_package: pkg, findings: ch.findings.map(f => ({ id: f.finding_id, check: f.check, severity: f.severity, origin: f.origin })) } })
  await uow.commit()
  return v
}

// CIO sửa dòng (FR-503); sửa hướng, mức, thêm hoặc bớt dòng thì phải phản biện lại (FR-405)
export async function editView(ctx: AppCtx, viewId: string, impacts: ImpactLine[], note?: string): Promise<{ view: ViewRec; rechallenge_required: boolean }> {
  requireRole(ctx, 'CIO')
  let v = await getView(ctx, viewId)
  if (!['PENDING_APPROVAL', 'PENDING_CHALLENGE'].includes(v.status)) throw new HttpError(409, `Không sửa được nhận định ở trạng thái ${v.status}`)
  if (v.status === 'PENDING_CHALLENGE' && !v.unchallenged.length) throw new HttpError(409, 'Nhận định đang chờ phản biện trước duyệt')
  const e = await getEvent(ctx, v.event_id)
  const news = await eventNews(ctx, e)
  const vctx = await viewContext(ctx, e, news)
  const prepared = impacts.map(l => {
    const line = { ...l, source_ids: l.source_ids ?? [] }
    if (line.level !== 0 && line.source_ids.length === 0) {
      if (!line.cio_note || line.cio_note.trim().length < 1) throw new HttpError(422, `Dòng ${lineKey(line)} có mức khác 0 mà không có nguồn: cần ghi chú của CIO (FR-503)`)
      line.cio_judgment = true
    }
    return line
  })
  const val = validateView({ ...v.body, impacts: prepared }, vctx)
  if (val.removed_restricted.length) throw new HttpError(422, 'Không được thêm dòng cấp mã cho mã trong danh sách hạn chế (BR-27)')
  if (!val.ok) throw new HttpError(422, 'Nhận định sau khi sửa không đúng schema Mục 7.3', val.errors)
  const diff = diffLines(v.body.impacts, val.view!.impacts)
  if (!diff.length) return { view: v, rechallenge_required: false }
  const material = diff.filter(d => d.kind !== 'rationale')
  const now = ctx.now()
  v = { ...v, body: val.view!, cio_edits: [...v.cio_edits, ...diff.map(d => ({ at: now, by: actor(ctx), key: d.key, kind: d.kind, before: d.before, after: d.after, note }))] }
  if (material.length) {
    v.unchallenged = [...new Set([...v.unchallenged, ...material.map(d => d.key)])]
    if (v.status === 'PENDING_APPROVAL') v = transition(ctx, v, 'PENDING_CHALLENGE', 'CIO sửa hướng, mức hoặc thêm bớt dòng')
  }
  const uow = ctx.uow()
  uow.update('views', v as never)
  uow.audit({ actor: actor(ctx), action: 'view.cio_edit', object: v.id, data: { diff, note } })
  await uow.commit()
  return { view: v, rechallenge_required: material.length > 0 }
}

// CIO duyệt nhánh kịch bản: sửa xác suất, cỡ cú sốc, chế độ (thiết kế v2). Ghi lại bản trước/sau và lý do.
export async function editScenarios(ctx: AppCtx, viewId: string, scenarios: unknown, noteRaw: unknown): Promise<ViewRec> {
  requireRole(ctx, 'CIO')
  const note = minReason(noteRaw, 'Lý do sửa kịch bản')
  let v = await getView(ctx, viewId)
  if (!['PENDING_APPROVAL', 'PENDING_CHALLENGE'].includes(v.status)) throw new HttpError(409, `Không sửa được kịch bản ở trạng thái ${v.status}`)
  const e = await getEvent(ctx, v.event_id)
  const vctx = await viewContext(ctx, e, await eventNews(ctx, e))
  const val = validateView({ ...v.body, scenarios }, vctx)
  if (!val.ok) throw new HttpError(422, 'Kịch bản sau khi sửa không hợp lệ', val.errors)
  const now = ctx.now()
  const before = v.body.scenarios
  v = { ...v, body: val.view!, cio_edits: [...v.cio_edits, { at: now, by: actor(ctx), key: 'scenarios', kind: 'scenarios', before: v.body.scenarios as never, after: val.view!.scenarios as never, note }] }
  // Sửa kịch bản là sửa trọng yếu (đổi con số tới khách): phải phản biện lại như sửa dòng (FR-405)
  if (JSON.stringify(before ?? null) !== JSON.stringify(val.view!.scenarios ?? null)) {
    v.unchallenged = [...new Set([...v.unchallenged, 'scenarios'])]
    if (v.status === 'PENDING_APPROVAL') v = transition(ctx, v, 'PENDING_CHALLENGE', 'CIO sửa nhánh kịch bản')
  }
  const uow = ctx.uow()
  uow.update('views', v as never)
  uow.audit({ actor: actor(ctx), action: 'view.cio_edit_scenarios', object: v.id, data: { before, after: val.view!.scenarios, note } })
  await uow.commit()
  return v
}

// Phản biện lại chỉ các dòng đã đổi (FR-405)
export async function runReChallenge(ctx: AppCtx, viewId: string, external?: { findings: unknown[]; model: string; session: string; cio_session?: string; cio_model: string }): Promise<ViewRec> {
  if (!external) requireRole(ctx, 'CIO')
  let v = await getView(ctx, viewId)
  if (v.status !== 'PENDING_CHALLENGE' || !v.unchallenged.length) throw new HttpError(409, 'Không có dòng nào chờ phản biện lại')
  const e = await getEvent(ctx, v.event_id)
  const news = await eventNews(ctx, e)
  const vctx = await viewContext(ctx, e, news)
  const keys = new Set(v.unchallenged)
  const rule = ruleChecks(v.body, vctx, keys)
  rule.push(...scenarioRuleChecks(v.body, v.body.scenarios ? (await loadFactorModel(ctx)).model as never : null, keys))
  rule.push(...sourceRuleChecks(v.body, news, keys))
  const recent = await recentApproved(ctx, e.id)
  const edits = v.cio_edits.filter(x => keys.has(x.key))
  const pkg = { view: v.body, changed_lines: [...keys], diff: edits.map(x => ({ key: x.key, kind: x.kind, before: x.before, after: x.after })), cio_notes: edits.map(x => x.note).filter(Boolean), news: news.map(n => ({ id: n.id, title: n.title, summary: n.summary })), catalog: { asset_classes: ASSET_CLASSES, sectors: SECTORS, fx: FX_CURRENCIES }, recent_approved: recent, rule_results: rule }
  const models = await activeConfig<ModelSet>(ctx, 'MODEL')
  const prompts = await activeConfig<PromptSet>(ctx, 'PROMPT')
  let llmRaw: unknown[] = [], model = `mock (${models.content.challenger.model})`
  let independence = independenceOf(ctx.agentMode, models.content.cio.model, models.content.challenger.model)
  if (external) { llmRaw = external.findings ?? []; model = external.model; independence = independenceOf('external_challenge', external.cio_model, model, { cio: external.cio_session, challenger: external.session }) }
  else if (ctx.agentMode !== 'live') llmRaw = news.every(n => n.simulated) ? [...keys].flatMap(k => MOCK.challenger[mockKey(e)]?.re_challenge?.[k] ?? []) : []
  else { await ctx.progress?.('challenger_re'); const r = await callChallenger(ctx, v.id, 're_challenge', () => callJson(ctx.env, models.content.challenger, prompts.content.challenger.re_challenge, wrapData('gói phản biện lại', pkg), ctx.fetchFn)); llmRaw = (r.json as { findings?: unknown[] }).findings ?? []; model = r.model }
  const norm = normalizeLlmFindings(llmRaw.map(f => ({ ...(f as object), stage: 're_challenge' })), vctx.newsIds)
  const n = await nextChallengeNo(ctx, v.id, 're_challenge')
  const id = `CH-${evNum(v.event_id)}-v${v.version}-re-${n}`
  const ch: ChallengeRec = { id, view_id: v.id, stage: 're_challenge', created_at: ctx.now(), findings: numberFindings(id, 're_challenge', rule, norm.findings), lines: [...keys], input_package: pkg, model, prompt_version: prompts.version.id, dropped: norm.dropped, independence }
  v = transition(ctx, { ...v, unchallenged: [] }, 'PENDING_APPROVAL', 'Đã phản biện lại các dòng CIO sửa')
  const uow = ctx.uow()
  uow.insert('challenges', ch as never).update('views', v as never)
  uow.audit({ actor: 'AGENT:challenger', action: 'agent.challenge', object: id, data: { view_id: v.id, stage: 're_challenge', lines: [...keys], model, input_package: pkg, findings: ch.findings.map(f => ({ id: f.finding_id, severity: f.severity })) } })
  await uow.commit()
  return v
}

export async function viewChallenges(ctx: AppCtx, viewId: string): Promise<ChallengeRec[]> {
  return ctx.repo.list<ChallengeRec>('challenges', 'view_id = ?', [viewId], 'created_at, id')
}
export async function viewResponses(ctx: AppCtx, viewId: string): Promise<FindingResponse[]> {
  return ctx.repo.list<FindingResponse>('finding_responses', 'view_id = ?', [viewId], 'id')
}

// Phản hồi của CIO cho phát hiện (Mục 7.3)
export async function respondFinding(ctx: AppCtx, viewId: string, findingId: string, body: { response: string; fixed_line?: string; comment: string }) {
  requireRole(ctx, 'CIO')
  const v = await getView(ctx, viewId)
  if (!['PENDING_APPROVAL', 'PENDING_CHALLENGE'].includes(v.status)) throw new HttpError(409, 'Nhận định không còn ở bàn duyệt')
  const chs = await viewChallenges(ctx, viewId)
  const f = chs.filter(c => c.stage !== 'post_check').flatMap(c => c.findings).find(x => x.finding_id === findingId)
  if (!f) throw new HttpError(404, `Không có phát hiện ${findingId} trong nhận định này`)
  if (!['accepted_fixed', 'disagree', 'out_of_scope'].includes(body.response)) throw new HttpError(422, 'Lựa chọn phản hồi không hợp lệ')
  const comment = minReason(body.comment, 'Ghi chú')
  // Không đồng ý hoặc coi là ngoài phạm vi với phát hiện Nghiêm trọng phải nêu căn cứ cụ thể, tránh cổng duyệt thành con dấu
  if (f.severity === 'critical' && body.response !== 'accepted_fixed' && comment.length < 60) throw new HttpError(422, 'Không đồng ý với phát hiện Nghiêm trọng phải nêu căn cứ cụ thể (tối thiểu 60 ký tự): nguồn nào, vì sao phát hiện không đúng')
  if (body.response === 'accepted_fixed') {
    if (!body.fixed_line) throw new HttpError(422, 'Chấp nhận – đã sửa phải chỉ rõ dòng đã sửa')
    const scenarioFix = body.fixed_line === 'scenarios' && !!v.body.scenarios
    if (!scenarioFix && !v.body.impacts.some(l => lineKey(l) === body.fixed_line)) throw new HttpError(422, `Dòng ${body.fixed_line} không có trong nhận định`)
  }
  const r: FindingResponse = { id: `${findingId}-R`, view_id: viewId, finding_id: findingId, response: body.response as FindingResponse['response'], ...(body.fixed_line ? { fixed_line: body.fixed_line } : {}), comment, by: actor(ctx), at: ctx.now() }
  const uow = ctx.uow()
  uow.put('finding_responses', r as never)
  uow.audit({ actor: actor(ctx), action: 'finding.response', object: findingId, data: r })
  await uow.commit()
  return r
}

// BR-02: điều kiện để duyệt
export async function approvalConditions(ctx: AppCtx, v: ViewRec, reason?: string): Promise<{ ok: boolean; missing: string[] }> {
  const chs = await viewChallenges(ctx, v.id)
  const resp = await viewResponses(ctx, v.id)
  const missing: string[] = []
  if (!chs.some(c => c.stage === 'pre_approval')) missing.push('(a) Chưa có báo cáo phản biện cho phiên bản này')
  if (v.unchallenged.length || v.status === 'PENDING_CHALLENGE') missing.push(`(b) Còn dòng CIO đã đổi chưa được phản biện lại: ${v.unchallenged.join(', ') || 'đang chờ phản biện'}`)
  const crit = chs.filter(c => c.stage !== 'post_check').flatMap(c => c.findings).filter(f => f.severity === 'critical')
  const unresolved = crit.filter(f => !resp.some(r => r.finding_id === f.finding_id))
  if (unresolved.length) missing.push(`(c) Phát hiện Nghiêm trọng chưa được phản hồi: ${unresolved.map(f => f.finding_id).join(', ')}`)
  if (reason !== undefined && reason.trim().length < 20) missing.push('(d) Lý do duyệt tối thiểu 20 ký tự')
  // (e) Một bộ máy tính: không có nhánh kịch bản thì không duyệt (con số tới khách chỉ đến từ lớp kịch bản)
  const sc = v.body.scenarios as { branches?: unknown[] } | undefined
  if (!sc?.branches || sc.branches.length < 2) missing.push('(e) Chưa có nhánh kịch bản (tối thiểu 2 nhánh): CIO bổ sung kịch bản trước khi duyệt')
  // (f) Phản biện độc lập: báo cáo phản biện trước duyệt mới nhất và mọi lượt phản biện lại phải độc lập với bên soạn
  const pre = chs.filter(c => c.stage === 'pre_approval')
  const lastPre = pre[pre.length - 1]
  const anyIndependentPre = pre.some(c => c.independence?.independent)
  const notIndep = chs.filter(c => c.stage === 're_challenge' && !c.independence?.independent)
  if (lastPre && !anyIndependentPre) missing.push(`(f) Phản biện chưa độc lập: ${lastPre.independence?.reason ?? 'bản ghi không có đánh giá độc lập'}`)
  if (notIndep.length) missing.push(`(f) Lượt phản biện lại chưa độc lập: ${notIndep.map(c => c.id).join(', ')}`)
  if (v.status !== 'PENDING_APPROVAL' && v.status !== 'PENDING_CHALLENGE') missing.push(`Trạng thái hiện tại ${v.status} không cho phép duyệt`)
  // (g) Bài kiểm tra phản biện có gài lỗi: không bao giờ duyệt được
  if ((await ctx.repo.list('canaries', 'view_id = ?', [v.id])).length) missing.push('(g) Đây là bài kiểm tra phản biện có gài lỗi (Tuân thủ tạo), không duyệt được')
  return { ok: missing.length === 0, missing }
}

export interface DecisionRec { id: string; view_id: string; action: 'APPROVE' | 'REWORK' | 'REJECT' | 'WITHDRAW'; idem_key: string; reason: string; by: string; at: string; include_challenge?: boolean; run_id?: string; new_view_id?: string }

// queueRework (tùy chọn): ở chế độ live, đưa lượt Agent CIO làm lại vào hàng chạy nền thay vì chạy trong yêu cầu
export async function decide(ctx: AppCtx, viewId: string, body: { action: string; reason: string; idempotency_key?: string; include_challenge?: boolean }, apply: (v: ViewRec, uow: UnitOfWork) => Promise<{ run_id: string }>, opts: { queueRework?: (eventId: string, instructions: string) => Promise<unknown | null> } = {}): Promise<{ decision: DecisionRec; view: ViewRec; idempotent?: boolean; run_id?: string; new_view?: ViewRec; job?: unknown }> {
  requireRole(ctx, 'CIO')
  const action = body.action as DecisionRec['action']
  if (!['APPROVE', 'REWORK', 'REJECT'].includes(action)) throw new HttpError(422, 'Hành động không hợp lệ')
  const idem = body.idempotency_key ?? `${viewId}:${action}`
  const prior = (await ctx.repo.list<DecisionRec>('decisions', 'idem_key = ?', [idem]))[0]
  if (prior) return { decision: prior, view: await getView(ctx, viewId), idempotent: true, run_id: prior.run_id }
  let v = await getView(ctx, viewId)
  if (action === 'APPROVE') {
    const cond = await approvalConditions(ctx, v, body.reason ?? '')
    if (!cond.ok) throw new HttpError(409, 'Chưa đủ điều kiện duyệt (BR-02)', cond.missing)
  }
  const reason = minReason(body.reason)
  const now = ctx.now()
  const d: DecisionRec = { id: `DC-${viewId}-${action}-${await ctx.repo.nextSeq('DC')}`, view_id: viewId, action, idem_key: idem, reason, by: actor(ctx), at: now, ...(action === 'REWORK' ? { include_challenge: !!body.include_challenge } : {}) }
  const uow = ctx.uow()
  if (action === 'APPROVE') {
    v = transition(ctx, v, 'APPROVED', reason)
    v.approved_at = now
    const r = await apply(v, uow)
    d.run_id = r.run_id
    // Sổ dự báo: lưu phân phối dự báo của các nhánh để Agent Chấm điểm đối chiếu với thực tế khi đến hạn
    await recordForecast(ctx, v, uow, now)
  } else if (action === 'REWORK') v = transition(ctx, v, 'REWORK_REQUESTED', reason)
  else v = transition(ctx, v, 'REJECTED', reason)
  uow.insert('decisions', d as never)
  uow.update('views', v as never)
  uow.audit({ actor: actor(ctx), action: `decision.${action.toLowerCase()}`, object: viewId, data: { reason, idempotency_key: idem, run_id: d.run_id } })
  await uow.commit()
  if (action === 'REWORK') {
    // Làm lại: gửi chỉ dẫn của CIO (kèm phản biện nếu chọn) về Agent CIO để tạo phiên bản mới
    let instructions = reason
    if (body.include_challenge) {
      const chs = await viewChallenges(ctx, viewId)
      instructions += '\nPhản biện kèm theo:\n' + chs.flatMap(c => c.findings).map(f => `- [${f.severity}] ${f.target}: ${f.issue} → ${f.suggestion}`).join('\n')
    }
    const job = opts.queueRework ? await opts.queueRework(v.event_id, instructions) : null
    if (job) return { decision: d, view: v, job }
    const nv = await runCioAgent(ctx, v.event_id, { instructions, skipRole: true })
    return { decision: { ...d, new_view_id: nv.id }, view: v, new_view: nv }
  }
  return { decision: d, view: v, run_id: d.run_id }
}

// AC-05a: áp dụng một nhận định JSON nhập tay, bỏ qua phản biện và điều kiện duyệt (chỉ dùng ở bước xây dựng 2).
// Tắt trên bản deploy; bật bằng MANUAL_APPLY=on khi kiểm thử. Chỉ CIO (người có quyền duyệt) được dùng.
export async function createManualView(ctx: AppCtx, raw: unknown, eventId: string, apply: (v: ViewRec, uow: UnitOfWork) => Promise<{ run_id: string }>) {
  if (ctx.env.MANUAL_APPLY !== 'on') throw new HttpError(403, 'Áp dụng nhận định nhập tay đã tắt trên bản này (chỉ dùng khi kiểm thử, MANUAL_APPLY=on)')
  requireRole(ctx, 'CIO')
  const e = await getEvent(ctx, eventId)
  const news = await eventNews(ctx, e)
  const vctx = await viewContext(ctx, e, news)
  const version = await nextViewVersion(ctx, e.id)
  const viewId = `VW-${evNum(e.id)}-v${version}`
  const val = validateView({ ...(raw as object), event_id: e.id, view_id: viewId, event_type: e.type }, vctx)
  if (!val.ok) throw new HttpError(422, 'Nhận định nhập tay không đúng schema Mục 7.3', val.errors)
  const now = ctx.now()
  let v: ViewRec = { id: viewId, event_id: e.id, version, status: 'DRAFTING', origin: 'manual', body: val.view!, ai_body: null, unchallenged: [], cio_edits: [], removed_restricted: val.removed_restricted, manual_bypass: true, created_at: now, history: [{ at: now, from: '', to: 'DRAFTING', by: actor(ctx) }] }
  const note = 'Nhận định nhập tay, bỏ qua điều kiện duyệt (AC-05a)'
  v = transition(ctx, v, 'PENDING_CHALLENGE', note); v = transition(ctx, v, 'PENDING_APPROVAL', note); v.view_ready_at = now
  v = transition(ctx, v, 'APPROVED', note); v.approved_at = now
  const uow = ctx.uow()
  const r = await apply(v, uow)
  uow.insert('views', v as never)
  uow.audit({ actor: actor(ctx), action: 'view.manual_apply', object: viewId, data: { note, run_id: r.run_id } })
  await uow.commit()
  return { view: v, run_id: r.run_id }
}

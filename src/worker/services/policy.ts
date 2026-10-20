// Radar chính sách (M10): nạp văn bản, Tuân thủ xác nhận nguồn, Agent Chính sách, khớp đối tượng (BR-30), sự kiện policy.
import { POLICY_TOPICS, type PolicyTopic } from '../../shared/catalog'
import type { Family, PolicyChange, PolicyPrivateBrief } from '../../shared/types'
import { validatePolicySummary } from '../../shared/schemas'
import { checkPublicSource } from '../../compliance/controls'
import { sha256 } from '../../engine/hash'
import { sourceTier } from '../../news/sources'
import { matchFamily } from '../../engine/policyMatch'
import { buildPositions, netWorth, liabilityExposure } from '../../engine/positions'
import { sum } from '../../engine/dec'
import { bookFromSnapshot } from '../../pricing/snapshot'
import { callJson } from '../../agents/llm'
import { wrapData, type ModelSet, type PromptSet } from '../../agents/prompts'
import { MOCK } from '../../data/mock'
import { SEED, PROVIDED_POLICIES } from '../../data/seed'
import { actor, HttpError, requireRole, type AppCtx } from '../ctx'
import { activeConfig, loadConfigs } from './config'
import { createEvent, type EventRec } from './events'
import { currentSnapshot, loadInstruments } from './portfolio'
import { reactionMs } from '../../compliance/controls'

export interface PolicyDoc {
  id: string; title: string; agency: string; kind: 'draft' | 'final'; status: string; published_at: string; effective_expected?: string
  url: string; topics: PolicyTopic[]; content: string; simulated: boolean
  state: 'PENDING_SOURCE_CONFIRM' | 'SOURCE_CONFIRMED' | 'ANALYZED' | 'ERROR'
  source_confirmed_by?: string; source_confirmed_at?: string; ingested_at: string
  summary?: { changes: PolicyChange[]; private_brief?: PolicyPrivateBrief; run_id: string; model: string }; event_id?: string; errors?: string[]
  // Agent Rà soát pháp luật (AI, ngoài TCB) tìm và chấm điểm văn bản; chỉ là gợi ý ưu tiên, người quyết định có phân tích tiếp hay không
  origin?: 'manual' | 'ai_scan'; ai_assessment?: PolicyAssessment
  // Đợt 3: mã băm nội dung đã lưu (Tuân thủ xác nhận đúng bản này), văn bản bị cắt, phiên bản mới của cùng đường dẫn, nguồn thứ cấp
  content_hash?: string; truncated?: boolean; original_length?: number; version?: number; previous_id?: string; superseded_by?: string; secondary_source?: boolean
  source_confirm_hash?: string
}

export const DOC_TYPES = ['luat', 'nghi_quyet', 'nghi_dinh', 'thong_tu', 'quyet_dinh', 'khac'] as const
export const STAGES = ['lay_y_kien', 'tham_dinh', 'trinh_quoc_hoi', 'thao_luan_quoc_hoi', 'thong_qua', 'ban_hanh', 'co_hieu_luc'] as const
export interface PolicyAssessment {
  importance: 'high' | 'medium' | 'low'; score: number
  doc_type: typeof DOC_TYPES[number]; stage: typeof STAGES[number]
  comment_deadline?: string; expected_adoption?: string
  why_changed: string                      // vì sao cơ quan soạn thảo thay đổi (bất cập, mục tiêu chính sách)
  key_points: string[]                     // điểm mới chính, mỗi điểm nêu điều khoản
  impact_private: string                   // tác động tới khách Private: tài sản, thuế, mục tiêu, thủ tục
  impact_tcb: string                       // tác động tới hoạt động ngân hàng: sản phẩm, quy trình, tuân thủ
  recommended_action: 'analyze_now' | 'monitor' | 'ignore'
  sources: string[]
  model?: string; session?: string; prepared_at?: string
}

export function assessmentErrors(a: Partial<PolicyAssessment> | undefined): string[] {
  const e: string[] = []
  if (!a) return ['Thiếu đánh giá của agent']
  if (!['high', 'medium', 'low'].includes(String(a.importance))) e.push('importance phải là high, medium hoặc low')
  if (!(Number.isInteger(a.score) && a.score! >= 1 && a.score! <= 10)) e.push('score phải là số nguyên 1–10')
  if (!DOC_TYPES.includes(a.doc_type as never)) e.push(`doc_type phải thuộc ${DOC_TYPES.join(', ')}`)
  if (!STAGES.includes(a.stage as never)) e.push(`stage phải thuộc ${STAGES.join(', ')}`)
  for (const k of ['comment_deadline', 'expected_adoption'] as const) if (a[k] && Number.isNaN(Date.parse(a[k]!))) e.push(`${k} không phải ngày hợp lệ`)
  if (!a.why_changed || a.why_changed.trim().length < 40) e.push('why_changed tối thiểu 40 ký tự')
  if (!Array.isArray(a.key_points) || !a.key_points.length || a.key_points.some(x => typeof x !== 'string' || x.trim().length < 15)) e.push('key_points cần ít nhất một điểm, mỗi điểm ≥ 15 ký tự')
  if (!a.impact_private || a.impact_private.trim().length < 30) e.push('impact_private tối thiểu 30 ký tự')
  if (!a.impact_tcb || a.impact_tcb.trim().length < 30) e.push('impact_tcb tối thiểu 30 ký tự')
  if (!['analyze_now', 'monitor', 'ignore'].includes(String(a.recommended_action))) e.push('recommended_action phải là analyze_now, monitor hoặc ignore')
  if (!Array.isArray(a.sources) || !a.sources.length) e.push('Cần ít nhất một đường dẫn nguồn')
  return e
}

export async function addPolicy(ctx: AppCtx, input: Omit<PolicyDoc, 'state' | 'ingested_at' | 'id'> & { id?: string; original_length?: number }) {
  requireRole(ctx, 'ADMIN')
  const cfg = await loadConfigs(ctx)
  const now = ctx.now()
  const errs = checkPublicSource(input, cfg.whitelist, now)
  if (input.ai_assessment) {
    errs.push(...assessmentErrors(input.ai_assessment))
    for (const u of input.ai_assessment.sources ?? []) errs.push(...checkPublicSource({ url: u, published_at: input.published_at }, cfg.whitelist, now).filter(x => x.startsWith('Miền')).map(x => `Nguồn đánh giá: ${x}`))
  }
  // Cùng đường dẫn: nội dung giống hệt thì là trùng; nội dung khác (dự thảo vòng mới, bản sửa) thì nhận là phiên bản mới
  const hash = await sha256(String(input.content ?? ''))
  const sameUrl = input.url ? await ctx.repo.list<PolicyDoc>('policy_documents', "json_extract(data, '$.url') = ?", [input.url], 'id') : []
  const prevDoc = sameUrl.filter(d => !d.superseded_by).at(-1)
  if (sameUrl.some(d => (d.content_hash ?? '') === hash)) errs.push('Văn bản cùng đường dẫn và cùng nội dung đã có trên radar')
  if (!input.title || !input.content) errs.push('Thiếu tiêu đề hoặc nội dung')
  if (!['draft', 'final'].includes(input.kind)) errs.push('Loại văn bản phải là dự thảo (draft) hoặc đã ban hành (final)')
  const topics = (input.topics ?? []).filter(t => POLICY_TOPICS.includes(t))
  if (errs.length) {
    const u = ctx.uow(); u.audit({ actor: actor(ctx), action: 'policy.rejected', object: input.title, data: { errors: errs } }); await u.commit()
    throw new HttpError(422, 'Văn bản không qua kiểm soát nguồn công khai (BR-26)', errs)
  }
  const year = now.slice(0, 4)
  const id = input.id ?? await ctx.repo.nextId('policy_documents', `PD-${year}-`, 3)
  if (await ctx.repo.get('policy_documents', id)) throw new HttpError(409, `Văn bản ${id} đã tồn tại`)
  const orig = Number(input.original_length ?? input.content.length)
  const meta = { content_hash: hash, ...(orig > input.content.length ? { truncated: true, original_length: orig } : {}), version: (prevDoc?.version ?? (prevDoc ? 1 : 0)) + 1, ...(prevDoc ? { previous_id: prevDoc.id } : {}), ...(sourceTier(input.url) === 'T4' ? { secondary_source: true } : {}) }
  const doc: PolicyDoc = { ...meta, id, title: input.title, agency: input.agency, kind: input.kind, status: input.status, published_at: input.published_at, effective_expected: input.effective_expected, url: input.url, topics, content: input.content, simulated: !!input.simulated, state: 'PENDING_SOURCE_CONFIRM', ingested_at: now, origin: input.ai_assessment ? 'ai_scan' : 'manual', ...(input.ai_assessment ? { ai_assessment: input.ai_assessment } : {}) }
  const u = ctx.uow(); u.insert('policy_documents', doc as never)
  if (prevDoc) { u.update('policy_documents', { ...prevDoc, superseded_by: id } as never); u.audit({ actor: actor(ctx), action: 'policy.new_version', object: id, data: { previous_id: prevDoc.id, version: doc.version } }) }
  u.audit({ actor: actor(ctx), action: 'policy.added', object: id, data: { content_hash: hash, truncated: !!doc.truncated, version: doc.version, title: doc.title, url: doc.url, published_at: doc.published_at, origin: doc.origin, ...(doc.ai_assessment ? { importance: doc.ai_assessment.importance, score: doc.ai_assessment.score, recommended_action: doc.ai_assessment.recommended_action } : {}) } }); await u.commit()
  return doc
}

// FR-1002: gói do người yêu cầu cung cấp; gói trống thì dùng gói giả lập
export async function loadSamplePolicies(ctx: AppCtx) {
  requireRole(ctx, 'ADMIN')
  const pack = PROVIDED_POLICIES.length ? PROVIDED_POLICIES : SEED.policies
  const out: string[] = []
  for (const p of pack) {
    if (await ctx.repo.get('policy_documents', p.id)) continue
    await addPolicy(ctx, { ...p, topics: p.topics as PolicyTopic[] })
    out.push(p.id)
  }
  return { loaded: out, source: PROVIDED_POLICIES.length ? 'provided' : 'sample' }
}

async function getDoc(ctx: AppCtx, id: string): Promise<PolicyDoc> {
  const d = await ctx.repo.get<PolicyDoc>('policy_documents', id)
  if (!d) throw new HttpError(404, `Không có văn bản ${id}`)
  return d
}
const save = (u: ReturnType<AppCtx['uow']>, d: PolicyDoc) => u.update('policy_documents', d as never)

// Tuân thủ xác nhận cả nguồn và nội dung: đã đối chiếu nội dung lưu trên radar với bản gốc tại đường dẫn, gửi kèm mã băm của
// đúng bản đã xem (nội dung đổi sau đó thì mã băm không khớp). Trích dẫn của Agent Chính sách chỉ được kiểm trên nội dung này.
export async function confirmSource(ctx: AppCtx, id: string, body: { note?: string; content_checked?: boolean; content_hash?: string }) {
  requireRole(ctx, 'COMPLIANCE')
  const d = await getDoc(ctx, id)
  if (d.state !== 'PENDING_SOURCE_CONFIRM') throw new HttpError(409, 'Văn bản không ở trạng thái chờ xác nhận nguồn')
  if (d.superseded_by) throw new HttpError(409, `Đã có phiên bản mới ${d.superseded_by}: xác nhận phiên bản mới`)
  const note = String(body.note ?? '')
  const hash = d.content_hash ?? await sha256(d.content)
  if (body.content_checked !== true) throw new HttpError(422, 'Cần xác nhận đã đối chiếu nội dung lưu trên radar với bản gốc tại đường dẫn (content_checked)')
  if (body.content_hash !== hash) throw new HttpError(409, 'Mã băm nội dung không khớp bản đang lưu: tải lại văn bản và đối chiếu lại')
  if (d.secondary_source && note.trim().length < 20) throw new HttpError(422, 'Nguồn là trang tra cứu thứ cấp: ghi rõ đã đối chiếu với bản gốc nào (tối thiểu 20 ký tự)')
  const nd: PolicyDoc = { ...d, content_hash: hash, source_confirm_hash: hash, state: 'SOURCE_CONFIRMED', source_confirmed_by: actor(ctx), source_confirmed_at: ctx.now() }
  const u = ctx.uow(); save(u, nd); u.audit({ actor: actor(ctx), action: 'policy.source_confirmed', object: id, data: { url: d.url, note, content_hash: hash, truncated: !!d.truncated } }); await u.commit()
  return nd
}

// Agent Chính sách (FR-1003) + khớp đối tượng (FR-1004) + tạo sự kiện policy (FR-1005)
export async function analyzePolicy(ctx: AppCtx, id: string, opts: { external?: { summary: unknown; meta?: { model?: string } } } = {}) {
  requireRole(ctx, 'ADMIN', 'CIO')
  const d = await getDoc(ctx, id)
  if (d.state !== 'SOURCE_CONFIRMED') throw new HttpError(409, 'Agent Chính sách chỉ đọc văn bản đã được Tuân thủ xác nhận nguồn công khai (BR-26)')
  const prompts = await activeConfig<PromptSet>(ctx, 'PROMPT'); const models = await activeConfig<ModelSet>(ctx, 'MODEL')
  const promptText = prompts.content.policy.replace('{{TOPICS}}', POLICY_TOPICS.join(', '))
  // Rào chắn (BR-28): agent chỉ nhận văn bản đã qua BR-26 và danh mục chủ đề, không nhận dữ liệu danh mục
  const pkg = { title: d.title, agency: d.agency, kind: d.kind, published_at: d.published_at, url: d.url, content: d.content, topics_catalog: POLICY_TOPICS }
  let raw: unknown, model: string
  if (opts.external) { raw = opts.external.summary; model = `Claude – phiên làm việc (${opts.external.meta?.model ?? 'gói subscription'})` }
  else if (ctx.agentMode !== 'live') {
    raw = MOCK.policy[d.id]
    model = `mock (${models.content.policy.model})`
    if (!raw) throw new HttpError(409, 'Chưa có tóm tắt ghi sẵn cho văn bản này: chạy AGENT_MODE=live hoặc thêm tóm tắt đã duyệt vào data/mock_agent/policy/')
  } else { await ctx.progress?.('policy'); const r = await callJson(ctx.env, models.content.policy, promptText, wrapData('văn bản chính sách', pkg), ctx.fetchFn); raw = r.json; model = r.model }
  const runId = `RUN-POL-${d.id}-${await ctx.repo.nextSeq('RUN-POL')}`
  const val = validatePolicySummary(raw, d.content, d.kind, (await loadConfigs(ctx)).banned)
  const u = ctx.uow()
  u.insert('agent_runs', { id: runId, agent: 'policy', subject_id: d.id, created_at: ctx.now(), mode: opts.external ? 'external' : ctx.agentMode, model, prompt_version: prompts.version.id, prompt: promptText, input_package: pkg, output: raw, ok: val.ok, errors: val.errors } as never)
  u.audit({ actor: 'AGENT:policy', action: 'agent.policy_run', object: d.id, data: { run_id: runId, model, ok: val.ok, errors: val.errors } })
  if (!val.ok) { const nd = { ...d, state: 'ERROR' as const, errors: val.errors }; save(u, nd); await u.commit(); throw new HttpError(422, 'Tóm tắt chính sách không đúng schema hoặc trích dẫn sai', val.errors) }
  // Khớp đối tượng xác định (BR-30)
  const [fams, instruments, snap] = await Promise.all([ctx.repo.list<Family>('families', '', [], 'id'), loadInstruments(ctx), currentSnapshot(ctx)])
  const book = bookFromSnapshot(snap)
  const topics = [...new Set(val.changes.flatMap(c => c.topics))] as PolicyTopic[]
  let matched = 0
  for (const f of fams) {
    const pos = buildPositions(f, instruments, book)
    const m = matchFamily(f, pos, netWorth(f, pos, book), sum(liabilityExposure(f, book).map(l => l.exposure)), topics)
    if (m) { matched++; u.put('policy_matches', { ...m, id: `${d.id}|${f.id}`, doc_id: d.id, rm_id: f.rm_id } as never) }
  }
  await u.commit()
  // Tóm tắt và các điều trích dẫn là tin của sự kiện policy
  const items = val.changes.map(c => ({ title: `${d.simulated ? '[VĂN BẢN GIẢ LẬP] ' : ''}${c.article_refs.join(', ')}: ${c.summary}`, url: d.url, published_at: d.published_at, summary: `${c.summary} Trích: "${c.quote}" (${c.certainty === 'draft' ? 'dự thảo' : 'chính thức'})`, simulated: d.simulated, policy_change: c }))
  const { event } = await createEvent(ctx, { type: 'policy', title: d.title.replace(/^\[VĂN BẢN GIẢ LẬP\]\s*/, ''), items, policy_doc_id: d.id }, { skipRole: true })
  const nd: PolicyDoc = { ...d, state: 'ANALYZED', summary: { changes: val.changes, private_brief: val.brief, run_id: runId, model }, event_id: event.id }
  const u2 = ctx.uow(); save(u2, nd); u2.audit({ actor: actor(ctx), action: 'policy.analyzed', object: d.id, data: { matched_families: matched, topics, event_id: event.id } }); await u2.commit()
  return { doc: nd, matched, event_id: event.id }
}

// FR-1006: Radar chính sách; RM chỉ thấy gia đình mình phụ trách
export async function radar(ctx: AppCtx) {
  const docs = await ctx.repo.list<PolicyDoc>('policy_documents', '', [], 'id')
  const matches = await ctx.repo.list<{ doc_id: string; family_id: string }>('policy_matches')
  const events = await ctx.repo.list<EventRec>('events')
  const own = (fid: string) => ctx.user.role !== 'RM' || ctx.user.families.includes(fid)
  const allEvents = events.map(e => ({ id: e.id, title: e.title, type: e.type, timestamps: e.timestamps, reaction_ms: reactionMs(e.timestamps), hold: e.hold?.status ?? null }))
  return {
    documents: docs.map(d => {
      const ev = events.find(e => e.id === d.event_id)
      return { id: d.id, title: d.title, agency: d.agency, kind: d.kind, status: d.status, state: d.state, origin: d.origin ?? 'manual', content_hash: d.content_hash ?? null, truncated: !!d.truncated, original_length: d.original_length ?? null, version: d.version ?? 1, previous_id: d.previous_id ?? null, superseded_by: d.superseded_by ?? null, secondary_source: !!d.secondary_source, content_length: d.content.length, ai_assessment: d.ai_assessment ?? null, published_at: d.published_at, effective_expected: d.effective_expected, url: d.url, topics: d.topics, simulated: d.simulated, changes: d.summary?.changes ?? [], private_brief: d.summary?.private_brief ?? null, event_id: d.event_id, matched_total: matches.filter(m => m.doc_id === d.id).length, matched_mine: matches.filter(m => m.doc_id === d.id && own(m.family_id)).length, reaction_ms: ev ? reactionMs(ev.timestamps) : null, timestamps: ev?.timestamps ?? null }
    }),
    events: allEvents,
  }
}

export async function policyDetail(ctx: AppCtx, id: string) {
  const d = await getDoc(ctx, id)
  const matches = (await ctx.repo.list<{ family_id: string }>('policy_matches', 'doc_id = ?', [id])).filter(m => ctx.user.role !== 'RM' || ctx.user.families.includes(m.family_id))
  return { doc: d, matches }
}

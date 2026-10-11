// Radar chính sách (M10): nạp văn bản, Tuân thủ xác nhận nguồn, Agent Chính sách, khớp đối tượng (BR-30), sự kiện policy.
import { POLICY_TOPICS, type PolicyTopic } from '../../shared/catalog'
import type { Family, PolicyChange } from '../../shared/types'
import { validatePolicySummary } from '../../shared/schemas'
import { checkPublicSource } from '../../compliance/controls'
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
  summary?: { changes: PolicyChange[]; run_id: string; model: string }; event_id?: string; errors?: string[]
}

export async function addPolicy(ctx: AppCtx, input: Omit<PolicyDoc, 'state' | 'ingested_at' | 'id'> & { id?: string }) {
  requireRole(ctx, 'ADMIN')
  const cfg = await loadConfigs(ctx)
  const now = ctx.now()
  const errs = checkPublicSource(input, cfg.whitelist, now)
  if (!input.title || !input.content) errs.push('Thiếu tiêu đề hoặc nội dung')
  if (!['draft', 'final'].includes(input.kind)) errs.push('Loại văn bản phải là dự thảo (draft) hoặc đã ban hành (final)')
  const topics = (input.topics ?? []).filter(t => POLICY_TOPICS.includes(t))
  if (errs.length) {
    const u = ctx.uow(); u.audit({ actor: actor(ctx), action: 'policy.rejected', object: input.title, data: { errors: errs } }); await u.commit()
    throw new HttpError(422, 'Văn bản không qua kiểm soát nguồn công khai (BR-26)', errs)
  }
  const year = now.slice(0, 4)
  const id = input.id ?? `PD-${year}-${String(await ctx.repo.nextSeq(`PD-${year}`)).padStart(3, '0')}`
  if (await ctx.repo.get('policy_documents', id)) throw new HttpError(409, `Văn bản ${id} đã tồn tại`)
  const doc: PolicyDoc = { id, title: input.title, agency: input.agency, kind: input.kind, status: input.status, published_at: input.published_at, effective_expected: input.effective_expected, url: input.url, topics, content: input.content, simulated: !!input.simulated, state: 'PENDING_SOURCE_CONFIRM', ingested_at: now }
  const u = ctx.uow(); u.insert('policy_documents', doc as never); u.audit({ actor: actor(ctx), action: 'policy.added', object: id, data: { title: doc.title, url: doc.url, published_at: doc.published_at } }); await u.commit()
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

export async function confirmSource(ctx: AppCtx, id: string, note: string) {
  requireRole(ctx, 'COMPLIANCE')
  const d = await getDoc(ctx, id)
  if (d.state !== 'PENDING_SOURCE_CONFIRM') throw new HttpError(409, 'Văn bản không ở trạng thái chờ xác nhận nguồn')
  const nd: PolicyDoc = { ...d, state: 'SOURCE_CONFIRMED', source_confirmed_by: actor(ctx), source_confirmed_at: ctx.now() }
  const u = ctx.uow(); save(u, nd); u.audit({ actor: actor(ctx), action: 'policy.source_confirmed', object: id, data: { url: d.url, note } }); await u.commit()
  return nd
}

// Agent Chính sách (FR-1003) + khớp đối tượng (FR-1004) + tạo sự kiện policy (FR-1005)
export async function analyzePolicy(ctx: AppCtx, id: string) {
  requireRole(ctx, 'ADMIN', 'CIO')
  const d = await getDoc(ctx, id)
  if (d.state !== 'SOURCE_CONFIRMED') throw new HttpError(409, 'Agent Chính sách chỉ đọc văn bản đã được Tuân thủ xác nhận nguồn công khai (BR-26)')
  const prompts = await activeConfig<PromptSet>(ctx, 'PROMPT'); const models = await activeConfig<ModelSet>(ctx, 'MODEL')
  const promptText = prompts.content.policy.replace('{{TOPICS}}', POLICY_TOPICS.join(', '))
  // Rào chắn (BR-28): agent chỉ nhận văn bản đã qua BR-26 và danh mục chủ đề, không nhận dữ liệu danh mục
  const pkg = { title: d.title, agency: d.agency, kind: d.kind, published_at: d.published_at, url: d.url, content: d.content, topics_catalog: POLICY_TOPICS }
  let raw: unknown, model: string
  if (ctx.agentMode === 'mock') {
    raw = MOCK.policy[d.id]
    model = `mock (${models.content.policy.model})`
    if (!raw) throw new HttpError(409, 'Chưa có tóm tắt ghi sẵn cho văn bản này: chạy AGENT_MODE=live hoặc thêm tóm tắt đã duyệt vào data/mock_agent/policy/')
  } else { const r = await callJson(ctx.env, models.content.policy, promptText, wrapData('văn bản chính sách', pkg)); raw = r.json; model = r.model }
  const runId = `RUN-POL-${d.id}-${await ctx.repo.nextSeq('RUN-POL')}`
  const val = validatePolicySummary(raw, d.content, d.kind)
  const u = ctx.uow()
  u.insert('agent_runs', { id: runId, agent: 'policy', subject_id: d.id, created_at: ctx.now(), mode: ctx.agentMode, model, prompt_version: prompts.version.id, prompt: promptText, input_package: pkg, output: raw, ok: val.ok, errors: val.errors } as never)
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
  const nd: PolicyDoc = { ...d, state: 'ANALYZED', summary: { changes: val.changes, run_id: runId, model }, event_id: event.id }
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
      return { id: d.id, title: d.title, agency: d.agency, kind: d.kind, status: d.status, state: d.state, published_at: d.published_at, effective_expected: d.effective_expected, url: d.url, topics: d.topics, simulated: d.simulated, changes: d.summary?.changes ?? [], event_id: d.event_id, matched_total: matches.filter(m => m.doc_id === d.id).length, matched_mine: matches.filter(m => m.doc_id === d.id && own(m.family_id)).length, reaction_ms: ev ? reactionMs(ev.timestamps) : null, timestamps: ev?.timestamps ?? null }
    }),
    events: allEvents,
  }
}

export async function policyDetail(ctx: AppCtx, id: string) {
  const d = await getDoc(ctx, id)
  const matches = (await ctx.repo.list<{ family_id: string }>('policy_matches', 'doc_id = ?', [id])).filter(m => ctx.user.role !== 'RM' || ctx.user.families.includes(m.family_id))
  return { doc: d, matches }
}

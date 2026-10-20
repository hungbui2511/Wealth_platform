// Bài kiểm tra phản biện (gài lỗi có chủ đích). Tuân thủ hoặc Quản trị tạo từ một nhận định có sẵn: hệ thống tạo phiên bản mới
// của cùng sự kiện với 1–3 lỗi đã biết, đưa vào hàng chờ phản biện như mọi nhận định. Agent Phản biện không được báo đây là bài
// kiểm tra (đánh dấu nằm ở bảng canaries, không nằm trong nhận định). Khi có phản biện, hệ thống đếm lỗi được phát hiện (chỉ tính
// phát hiện của agent, không tính phát hiện theo quy tắc) rồi đóng bài kiểm tra; nhận định này không bao giờ duyệt được.
import type { ImpactLine } from '../../shared/types'
import { lineKey } from '../../shared/schemas'
import { actor, HttpError, requireRole, type AppCtx } from '../ctx'
import { nextViewVersion, evNum } from '../ids'
import { getView, runPreChallenge, transition, viewChallenges, type ViewRec } from './views'

export type PlantType = 'sign_flip' | 'overconfidence' | 'prob_concentration'
export const PLANT_LABELS: Record<PlantType, string> = {
  sign_flip: 'Đảo hướng một dòng nhưng giữ nguyên lập luận và nguồn (lập luận mâu thuẫn với hướng)',
  overconfidence: 'Nâng một dòng lên mức ±3, độ tin cậy cao, trong khi nguồn chỉ hỗ trợ mức nhẹ',
  prob_concentration: 'Dồn 90% xác suất vào một nhánh kịch bản, bỏ qua nhánh ngược chiều',
}
export interface CanaryRec {
  id: string; view_id: string; base_view_id: string; status: 'OPEN' | 'CLOSED' | 'EXPIRED'; created_at: string; created_by: string
  plants: { type: PlantType; target: string; description: string }[]
  result?: { challenge_id: string; detected: string[]; missed: string[]; rate: number; closed_at: string }
}

const flip = (l: ImpactLine): ImpactLine => ({ ...l, level: -l.level, direction: l.level > 0 ? 'negative' : 'positive' })

export async function createCanary(ctx: AppCtx, body: { view_id: string; plants?: PlantType[] }): Promise<CanaryRec> {
  requireRole(ctx, 'COMPLIANCE', 'ADMIN')
  const base = await getView(ctx, body.view_id)
  const types = (body.plants?.length ? body.plants : ['sign_flip', 'overconfidence']).filter((t): t is PlantType => t in PLANT_LABELS).slice(0, 3)
  if (!types.length) throw new HttpError(422, 'Cần ít nhất một loại lỗi gài')
  const impacts = base.body.impacts.map(l => ({ ...l }))
  const plants: CanaryRec['plants'] = []
  // Chọn dòng loại tài sản có mức khác 0 và có nguồn; mỗi loại lỗi dùng một dòng khác nhau
  const candidates = impacts.map((l, i) => ({ l, i })).filter(x => x.l.scope === 'asset_class' && x.l.level !== 0 && x.l.source_ids.length > 0)
  let used = new Set<number>()
  for (const t of types) {
    if (t === 'prob_concentration') continue
    const c = candidates.find(x => !used.has(x.i) && (t !== 'overconfidence' || Math.abs(x.l.level) < 3))
    if (!c) continue
    used = new Set([...used, c.i])
    if (t === 'sign_flip') impacts[c.i] = flip(c.l)
    else impacts[c.i] = { ...c.l, level: c.l.level > 0 ? 3 : -3, confidence: 'high' }
    plants.push({ type: t, target: lineKey(impacts[c.i]), description: PLANT_LABELS[t] })
  }
  let scenarios = base.body.scenarios
  if (types.includes('prob_concentration') && scenarios && (scenarios as { branches: { probability: number }[] }).branches.length >= 2) {
    const s = JSON.parse(JSON.stringify(scenarios)) as { branches: { id: string; probability: number }[] }
    const n = s.branches.length
    s.branches = s.branches.map((b, i) => ({ ...b, probability: i === 0 ? 0.9 : Math.round(0.1 / (n - 1) * 1000) / 1000 }))
    const sum = s.branches.reduce((a, b) => a + b.probability, 0)
    s.branches[n - 1].probability = Math.round((s.branches[n - 1].probability + 1 - sum) * 1000) / 1000
    scenarios = s as never
    plants.push({ type: 'prob_concentration', target: `scenario:${s.branches[0].id}`, description: PLANT_LABELS.prob_concentration })
  }
  if (!plants.length) throw new HttpError(422, 'Nhận định gốc không có dòng phù hợp để gài lỗi (cần dòng loại tài sản có mức khác 0 và có nguồn)')
  const version = await nextViewVersion(ctx, base.event_id)
  const id = `VW-${evNum(base.event_id)}-v${version}`
  const now = ctx.now()
  const body2 = { ...base.body, view_id: id, impacts, ...(scenarios ? { scenarios } : {}) }
  const v: ViewRec = { id, event_id: base.event_id, version, status: 'PENDING_CHALLENGE', origin: 'agent', body: body2, ai_body: body2, unchallenged: [], cio_edits: [], removed_restricted: [], created_at: now, history: [{ at: now, from: '', to: 'PENDING_CHALLENGE', by: 'SYSTEM' }] }
  const cid = await ctx.repo.nextId('canaries', `CN-${now.slice(0, 4)}-`, 3)
  const rec: CanaryRec = { id: cid, view_id: id, base_view_id: base.id, status: 'OPEN', created_at: now, created_by: actor(ctx), plants }
  const u = ctx.uow()
  u.insert('views', v as never).insert('canaries', rec as never)
  u.audit({ actor: actor(ctx), action: 'canary.created', object: cid, data: { view_id: id, base_view_id: base.id, plants } })
  await u.commit()
  // Chế độ external: chỉ chạy kiểm tra theo quy tắc, chờ phiên phản biện độc lập; mock/live: phản biện chạy ngay và chấm luôn
  if (ctx.agentMode === 'external') await runPreChallenge(ctx, id, { findings: [], model: 'Kiểm tra theo quy tắc (chờ phản biện độc lập)' })
  else { await runPreChallenge(ctx, id); await scoreCanary(ctx, id) }
  return (await ctx.repo.get<CanaryRec>('canaries', cid))!
}

export async function canaryOf(ctx: AppCtx, viewId: string): Promise<CanaryRec | null> {
  return (await ctx.repo.list<CanaryRec>('canaries', 'view_id = ?', [viewId]))[0] ?? null
}

// Chấm khi có báo cáo phản biện có phát hiện của agent (origin llm). Lỗi được tính là phát hiện khi có phát hiện của agent
// trỏ đúng dòng gài lỗi (hoặc đúng nhánh kịch bản với lỗi dồn xác suất).
export async function scoreCanary(ctx: AppCtx, viewId: string): Promise<CanaryRec | null> {
  const c = await canaryOf(ctx, viewId)
  if (!c || c.status !== 'OPEN') return c
  const chs = (await viewChallenges(ctx, viewId)).filter(x => x.stage === 'pre_approval')
  const withAgent = chs.filter(x => x.findings.some(f => f.origin === 'llm') || !/quy tắc/.test(x.model))
  const last = withAgent[withAgent.length - 1]
  if (!last) return c
  const llm = last.findings.filter(f => f.origin === 'llm')
  const hit = (p: CanaryRec['plants'][number]) => llm.some(f => p.type === 'prob_concentration' ? f.target.startsWith('scenario') : f.target === p.target)
  const detected = c.plants.filter(hit).map(p => p.target), missed = c.plants.filter(p => !hit(p)).map(p => p.target)
  const now = ctx.now()
  const nc: CanaryRec = { ...c, status: 'CLOSED', result: { challenge_id: last.id, detected, missed, rate: c.plants.length ? detected.length / c.plants.length : 0, closed_at: now } }
  let v = await getView(ctx, viewId)
  const u = ctx.uow()
  u.update('canaries', nc as never)
  if (v.status === 'PENDING_APPROVAL') { v = transition({ ...ctx, user: { id: 'SYSTEM', name: 'Hệ thống', role: 'ADMIN', families: [] } } as AppCtx, v, 'REJECTED', `Bài kiểm tra phản biện ${c.id} kết thúc: phát hiện ${detected.length}/${c.plants.length} lỗi gài`); u.update('views', v as never) }
  u.audit({ actor: 'SYSTEM:canary', action: 'canary.scored', object: c.id, data: nc.result })
  await u.commit()
  return nc
}

export async function canarySummary(ctx: AppCtx) {
  const rows = await ctx.repo.list<CanaryRec>('canaries', '', [], 'created_at DESC')
  const closed = rows.filter(r => r.status === 'CLOSED' && r.result)
  const planted = closed.reduce((a, r) => a + r.plants.length, 0), detected = closed.reduce((a, r) => a + r.result!.detected.length, 0)
  const byType: Record<string, { planted: number; detected: number }> = {}
  for (const r of closed) for (const p of r.plants) { const t = byType[p.type] ??= { planted: 0, detected: 0 }; t.planted++; if (r.result!.detected.includes(p.target)) t.detected++ }
  return { total: rows.length, open: rows.filter(r => r.status === 'OPEN').length, detection_rate: planted ? detected / planted : null, planted, detected, by_type: byType, rows: rows.slice(0, 50), labels: PLANT_LABELS }
}

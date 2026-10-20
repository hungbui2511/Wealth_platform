// Bộ sự kiện chuẩn (đợt 2 sau phản biện độc lập): chạy lại hằng tháng và mỗi lần đổi mô hình hoặc prompt, so với lượt tham chiếu
// để phát hiện trôi; với sự kiện có giai đoạn tương tự (analog) thì so hướng với biến động thực tế đã biết.
import GOLDEN from '../../../data/golden/events.json'
import { ASSET_CLASSES } from '../../shared/catalog'
import { validateScenarios } from '../../shared/schemas'
import { scenarioPreview, type FactorModel, type ScenarioSet } from '../../engine/scenario'
import { HttpError, actor, minReason, requireRole, type AppCtx } from '../ctx'
import { loadFactorModel } from './config'
import { modelId } from './views'

export interface GoldenEvent { id: string; date: string; type: string; title: string; analog_id?: string; news: { id: string; title: string; summary: string }[] }
export const GOLDEN_EVENTS = (GOLDEN as unknown as { events: GoldenEvent[] }).events

export interface GoldenRun {
  id: string; golden_id: string; created_at: string; model: string | null; session?: string; prompt_note?: string
  levels: Record<string, number>; expected: Record<string, number>; branches: { id: string; probability: number }[]
  reference?: boolean
  drift?: { reference_id: string; direction_agreement: number | null; mean_abs_level_diff: number | null; expected_distance: number | null; drift: boolean; reasons: string[] }
  analog_check?: { analog_id: string; agreement: number | null; detail: Record<string, { expected: number; actual: number; same_sign: boolean }> }
}

// Ngưỡng trôi: đồng thuận hướng < 80%, lệch mức trung bình > 0,75, khoảng cách cú sốc kỳ vọng (chuẩn hoá theo biến động) > 1
const T = { agreement: 0.8, level: 0.75, distance: 1 }

function compare(cur: GoldenRun, ref: GoldenRun, model: FactorModel) {
  const keys = ASSET_CLASSES.filter(k => (cur.levels[k] ?? 0) !== 0 || (ref.levels[k] ?? 0) !== 0)
  const agree = keys.filter(k => Math.sign(cur.levels[k] ?? 0) === Math.sign(ref.levels[k] ?? 0)).length
  const diffs = ASSET_CLASSES.map(k => Math.abs((cur.levels[k] ?? 0) - (ref.levels[k] ?? 0)))
  const fids = Object.keys({ ...cur.expected, ...ref.expected })
  const dist = fids.length ? fids.reduce((a, k) => { const f = model.factors.find(x => x.id === k); const vol = f ? f.vol.calm : 1; return a + Math.abs((cur.expected[k] ?? 0) - (ref.expected[k] ?? 0)) / vol }, 0) / fids.length : null
  const r = { reference_id: ref.id, direction_agreement: keys.length ? agree / keys.length : null, mean_abs_level_diff: diffs.reduce((a, b) => a + b, 0) / diffs.length, expected_distance: dist === null ? null : Math.round(dist * 100) / 100, drift: false, reasons: [] as string[] }
  if (r.direction_agreement !== null && r.direction_agreement < T.agreement) r.reasons.push(`Đồng thuận hướng ${(r.direction_agreement * 100).toFixed(0)}% < ${T.agreement * 100}%`)
  if (r.mean_abs_level_diff > T.level) r.reasons.push(`Lệch mức trung bình ${r.mean_abs_level_diff.toFixed(2)} > ${T.level}`)
  if (r.expected_distance !== null && r.expected_distance > T.distance) r.reasons.push(`Khoảng cách cú sốc kỳ vọng ${r.expected_distance} > ${T.distance} (theo biến động tháng)`)
  r.drift = r.reasons.length > 0
  return r
}

export async function importGoldenRun(ctx: AppCtx, d: { golden_id?: string; view?: { impacts?: { scope: string; target: string; level: number }[]; scenarios?: unknown }; meta?: { model?: string; session?: string; prompt_note?: string } }): Promise<GoldenRun> {
  const g = GOLDEN_EVENTS.find(x => x.id === d?.golden_id)
  if (!g) throw new HttpError(422, `golden_id không thuộc bộ sự kiện chuẩn (${GOLDEN_EVENTS.map(x => x.id).join(', ')})`)
  const fm = await loadFactorModel(ctx)
  const sc = validateScenarios(d.view?.scenarios, fm.model.factors.map(f => f.id), new Set(g.news.map(n => n.id)))
  if (!sc.ok) throw new HttpError(422, 'Nhánh kịch bản không hợp lệ', sc.errors)
  const levels: Record<string, number> = {}
  for (const l of d.view?.impacts ?? []) if (l.scope === 'asset_class' && (ASSET_CLASSES as readonly string[]).includes(l.target) && Number.isInteger(l.level) && Math.abs(l.level) <= 3) levels[l.target] = l.level
  if (Object.keys(levels).length < ASSET_CLASSES.length) throw new HttpError(422, 'Cần đủ dòng mức cho 11 loại tài sản')
  const prev = scenarioPreview(fm.model, sc.set as unknown as ScenarioSet)
  const now = ctx.now()
  const id = await ctx.repo.nextId('golden_runs', `GR-${g.id}-${now.slice(0, 7).replace('-', '')}-`, 2)
  const runs = await ctx.repo.list<GoldenRun>('golden_runs', 'golden_id = ?', [g.id], 'created_at')
  const ref = runs.find(r => r.reference) ?? runs[0]
  const rec: GoldenRun = { id, golden_id: g.id, created_at: now, model: modelId(d.meta?.model) ?? (d.meta?.model ? String(d.meta.model) : null), ...(d.meta?.session ? { session: String(d.meta.session) } : {}), ...(d.meta?.prompt_note ? { prompt_note: String(d.meta.prompt_note).slice(0, 300) } : {}), levels, expected: prev.expected, branches: sc.set!.branches.map(b => ({ id: b.id, probability: b.probability })), ...(ref ? {} : { reference: true }) }
  if (ref) rec.drift = compare(rec, ref, fm.model)
  const analog = g.analog_id ? (fm.model.analogs as { id: string; moves?: Record<string, number> }[] | undefined)?.find(a => a.id === g.analog_id) : undefined
  if (analog?.moves) {
    const detail: NonNullable<GoldenRun['analog_check']>['detail'] = {}
    for (const [k, actual] of Object.entries(analog.moves)) if (k in prev.expected && prev.expected[k] !== 0) detail[k] = { expected: prev.expected[k], actual, same_sign: Math.sign(prev.expected[k]) === Math.sign(actual) }
    const vals = Object.values(detail)
    rec.analog_check = { analog_id: analog.id, agreement: vals.length ? vals.filter(x => x.same_sign).length / vals.length : null, detail }
  }
  const u = ctx.uow(); u.insert('golden_runs', rec as never); u.audit({ actor: 'ADMIN:CLAUDE', action: 'golden.run', object: id, data: { golden_id: g.id, model: rec.model, drift: rec.drift ?? null, analog: rec.analog_check?.agreement ?? null } }); await u.commit()
  return rec
}

export async function setGoldenReference(ctx: AppCtx, runId: string, reasonRaw: unknown) {
  requireRole(ctx, 'CIO')
  const reason = minReason(reasonRaw, 'Lý do đổi lượt tham chiếu')
  const r = await ctx.repo.get<GoldenRun>('golden_runs', runId)
  if (!r) throw new HttpError(404, `Không có lượt ${runId}`)
  const u = ctx.uow()
  for (const o of await ctx.repo.list<GoldenRun>('golden_runs', 'golden_id = ?', [r.golden_id])) if (o.reference && o.id !== r.id) u.put('golden_runs', { ...o, reference: false } as never)
  u.put('golden_runs', { ...r, reference: true } as never)
  u.audit({ actor: actor(ctx), action: 'golden.reference_set', object: runId, data: { golden_id: r.golden_id, reason } })
  await u.commit()
  return { ...r, reference: true }
}

export async function goldenSummary(ctx: AppCtx) {
  const runs = await ctx.repo.list<GoldenRun>('golden_runs', '', [], 'created_at DESC')
  const latest = GOLDEN_EVENTS.map(g => ({ event: g, latest: runs.find(r => r.golden_id === g.id) ?? null, reference: runs.find(r => r.golden_id === g.id && r.reference) ?? null, n: runs.filter(r => r.golden_id === g.id).length }))
  const drifted = latest.filter(x => x.latest?.drift?.drift)
  return { events: latest, drifted: drifted.map(x => x.event.id), last_run_at: runs[0]?.created_at ?? null, thresholds: T }
}

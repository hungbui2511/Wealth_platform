// Gộp tác động của các sự kiện đang hiệu lực theo yếu tố (đợt 5 sau phản biện độc lập).
// Mỗi sự kiện được áp riêng; khi nhiều sự kiện cùng tác động lên một yếu tố thì cộng thẳng dễ đếm hai lần (cùng một nguyên nhân
// được tin tức kể lại) hoặc bỏ sót phần bù trừ. Ở đây: cú sốc kỳ vọng của từng sự kiện giảm dần theo thời gian bán rã,
// cộng theo yếu tố, nêu yếu tố có nhiều sự kiện cùng chiều (nguy cơ đếm hai lần) và yếu tố bị bù trừ.
import type { FamilyImpactResult } from '../../engine/apply'
import { canSeeRun, assertFamily, requireRole, type AppCtx } from '../ctx'
import type { RunRec } from './apply'
import type { EventRec } from './events'
import { loadFactorModel } from './config'

export const DEFAULT_HALF_LIFE_DAYS = 30
export const decay = (ageDays: number, halfLife: number) => Math.pow(0.5, Math.max(0, ageDays) / halfLife)

async function activeRuns(ctx: AppCtx) {
  const runs = (await ctx.repo.list<RunRec>('application_runs', "status = 'EFFECTIVE'", [], 'created_at')).filter(r => canSeeRun(ctx, r))
  const fm = await loadFactorModel(ctx)
  const hl = (fm.model as { event_half_life_days?: number }).event_half_life_days ?? DEFAULT_HALF_LIFE_DAYS
  const now = Date.parse(ctx.now())
  return { runs: runs.map(r => ({ run: r, age_days: (now - Date.parse(r.effective_at ?? r.created_at)) / 864e5 })).map(x => ({ ...x, weight: decay(x.age_days, hl) })), half_life: hl, model: fm.model }
}

export async function bookNetting(ctx: AppCtx) {
  requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN')
  const { runs, half_life, model } = await activeRuns(ctx)
  const events = new Map((await ctx.repo.list<EventRec>('events')).map(e => [e.id, e]))
  const factors: Record<string, { net: number; gross: number; contributors: { event_id: string; title: string; shock: number; weighted: number }[] }> = {}
  for (const { run, weight } of runs) {
    const exp = run.scenario_summary?.preview.expected ?? {}
    for (const [k, v] of Object.entries(exp)) {
      if (!v) continue
      const f = (factors[k] ??= { net: 0, gross: 0, contributors: [] })
      f.net += v * weight; f.gross += Math.abs(v) * weight
      f.contributors.push({ event_id: run.event_id, title: events.get(run.event_id)?.title ?? run.event_id, shock: v, weighted: Math.round(v * weight * 100) / 100 })
    }
  }
  const lib = (k: string) => model.factors.find(f => f.id === k)?.library.M ?? 1
  const warnings: { factor: string; kind: 'double_count' | 'offset'; text: string }[] = []
  for (const [k, f] of Object.entries(factors)) {
    // Chỉ xét sự kiện có tác động đáng kể (≥ 25% cú sốc cỡ vừa) sau khi đã giảm theo thời gian
    const big = f.contributors.filter(c => Math.abs(c.weighted) >= 0.25 * Math.abs(lib(k)))
    const pos = big.filter(c => c.weighted > 0), neg = big.filter(c => c.weighted < 0)
    if (pos.length >= 2 || neg.length >= 2) warnings.push({ factor: k, kind: 'double_count', text: `${(pos.length >= 2 ? pos : neg).length} sự kiện cùng đẩy ${k} ${pos.length >= 2 ? 'tăng' : 'giảm'}: CIO xác nhận đây là các cú sốc khác nhau, không phải một nguyên nhân được kể lại` })
    if (pos.length && neg.length) warnings.push({ factor: k, kind: 'offset', text: `Các sự kiện tác động ngược chiều lên ${k}: tổng ròng ${f.net.toFixed(2)} nhỏ hơn tổng tuyệt đối ${f.gross.toFixed(2)}` })
  }
  const book = runs.reduce((a, x) => ({ base: a.base + (x.run.scenario_summary?.book_base_3m ?? 0) * x.weight, bad: a.bad + (x.run.scenario_summary?.book_bad_3m_sum ?? 0) * x.weight, undecayed: a.undecayed + (x.run.scenario_summary?.book_base_3m ?? 0) }), { base: 0, bad: 0, undecayed: 0 })
  return {
    half_life_days: half_life,
    runs: runs.map(x => ({ run_id: x.run.id, event_id: x.run.event_id, title: events.get(x.run.event_id)?.title ?? x.run.event_id, effective_at: x.run.effective_at, age_days: Math.round(x.age_days * 10) / 10, weight: Math.round(x.weight * 1000) / 1000 })),
    factors: Object.fromEntries(Object.entries(factors).map(([k, f]) => [k, { net: Math.round(f.net * 100) / 100, gross: Math.round(f.gross * 100) / 100, contributors: f.contributors }])),
    warnings,
    book: { base_3m: Math.round(book.base), bad_3m_sum: Math.round(book.bad), base_3m_undecayed: Math.round(book.undecayed) },
    note: 'Tác động của mỗi sự kiện giảm một nửa sau mỗi chu kỳ bán rã kể từ ngày có hiệu lực. Tổng theo yếu tố là cộng tuyến tính, không tính lại tương quan giữa các sự kiện.',
  }
}

// Gộp cho một gia đình: tổng tác động kỳ vọng 3 tháng của các sự kiện đang hiệu lực sau khi giảm theo thời gian
export async function familyNetting(ctx: AppCtx, familyId: string) {
  assertFamily(ctx, familyId)
  const { runs, half_life } = await activeRuns(ctx)
  const ids = new Set(runs.map(r => r.run.id))
  const rows = (await ctx.repo.list<FamilyImpactResult & { run_id: string; scenario?: { by_factor: Record<string, number> } }>('family_impacts', 'family_id = ?', [familyId])).filter(r => ids.has(r.run_id))
  const byFactor: Record<string, number> = {}
  let total = 0, undecayed = 0
  for (const r of rows) {
    const w = runs.find(x => x.run.id === r.run_id)!.weight
    total += Number(r.impact) * w; undecayed += Number(r.impact)
    for (const [k, v] of Object.entries(r.scenario?.by_factor ?? {})) byFactor[k] = (byFactor[k] ?? 0) + v * w
  }
  return { half_life_days: half_life, events: rows.length, impact_net: Math.round(total), impact_undecayed: Math.round(undecayed), by_factor: Object.fromEntries(Object.entries(byFactor).map(([k, v]) => [k, Math.round(v)])) }
}

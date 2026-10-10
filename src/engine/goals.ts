// Tỷ lệ đáp ứng mục tiêu (BR-24) và tác động của sự kiện lên mục tiêu (BR-25).
import type { Goal } from '../shared/types'
import { D, Decimal, ONE, ZERO, sum, vnd, s } from './dec'
import type { Position } from './positions'
import { earmarkComponents, goalMonthK, goalPayments, liquidL, type Assumptions } from './cashflow'

export type GoalLevel = 'ON_TRACK' | 'WATCH' | 'SHORT'
export const GOAL_LEVEL_LABELS: Record<GoalLevel, string> = { ON_TRACK: 'Đạt', WATCH: 'Theo dõi', SHORT: 'Thiếu' }
export interface GoalThresholds { on_track: string; watch: string; drop_alert_pts: string }

export interface GoalCoverage {
  goal_id: string; n_years: string; projected: string; target: string; ratio: string | null; level: GoalLevel
  components: { value: string; r: string; fv: string }[]; contributions_fv: string; earmarked_value: string; has_earmark: boolean
}

export function levelOf(ratio: Decimal | null, t: GoalThresholds): GoalLevel {
  if (ratio === null) return 'SHORT'
  if (ratio.gte(D(t.on_track))) return 'ON_TRACK'
  if (ratio.gte(D(t.watch))) return 'WATCH'
  return 'SHORT'
}

export function goalCoverage(g: Goal, positions: Position[], allGoals: Goal[], a: Assumptions, priceDate: string, t: GoalThresholds, shockByPos?: Map<string, Decimal>): GoalCoverage {
  const n = D(goalMonthK(g, priceDate)).div(12)
  const nPos = Decimal.max(n, ZERO)
  const comps = earmarkComponents(g, positions, a, shockByPos)
  const fvs = comps.map(c => c.value.times(ONE.plus(c.r).pow(nPos)))
  const { rL } = liquidL(positions, allGoals, a)
  const years = Math.floor(nPos.toNumber())
  const c = D(g.annual_contribution)
  const contribFv = c.isZero() ? ZERO : rL.isZero() ? c.times(years) : c.times(ONE.plus(rL).pow(years).minus(1)).div(rL)
  const projected = sum(fvs).plus(contribFv)
  const pays = goalPayments(g, priceDate)
  // Chi một lần: đích = số tiền (hoặc quy theo tăng chi phí). Chi đều nhiều năm: chiết khấu về năm bắt đầu bằng r_L
  const target = sum(pays.map((p, j) => p.amount.div(ONE.plus(rL).pow(j))))
  const ratio = target.gt(0) ? projected.div(target) : null
  return {
    goal_id: g.id, n_years: s(n, 6), projected: vnd(projected), target: vnd(target), ratio: ratio ? s(ratio, 10) : null,
    level: levelOf(ratio, t),
    components: comps.map((c, i) => ({ value: vnd(c.value), r: s(c.r), fv: vnd(fvs[i]) })),
    contributions_fv: vnd(contribFv), earmarked_value: vnd(sum(comps.map(c => c.value))), has_earmark: g.earmarks.length > 0,
  }
}

export interface GoalImpactResult {
  goal_id: string; family_id: string; before: GoalCoverage; after: GoalCoverage
  ratio_before: string | null; ratio_after: string | null; delta_pts: string
  level_before: GoalLevel; level_after: GoalLevel; alert: boolean
}

// BR-25: giá trị dành riêng sau sốc = giá trị dành riêng + % dành riêng × tác động M6 của vị thế; cú sốc coi là vĩnh viễn
export function goalImpact(g: Goal, positions: Position[], allGoals: Goal[], a: Assumptions, priceDate: string, t: GoalThresholds, positionImpacts: { holding_id: string; part: string | null; impact: string }[]): GoalImpactResult {
  const shocks = new Map<string, Decimal>()
  for (const pi of positionImpacts) shocks.set(`${pi.holding_id}|${pi.part ?? ''}`, D(pi.impact))
  const before = goalCoverage(g, positions, allGoals, a, priceDate, t)
  const after = goalCoverage(g, positions, allGoals, a, priceDate, t, shocks)
  const rb = before.ratio ? D(before.ratio) : ZERO
  const ra = after.ratio ? D(after.ratio) : ZERO
  const delta = ra.minus(rb).times(100)
  const alert = before.level !== after.level || delta.lte(D(t.drop_alert_pts).neg())
  return { goal_id: g.id, family_id: g.family_id, before, after, ratio_before: before.ratio, ratio_after: after.ratio, delta_pts: s(delta, 6), level_before: before.level, level_after: after.level, alert }
}

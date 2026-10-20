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

// Thiết kế v2: tác động lên mục tiêu từ lớp kịch bản. Mục tiêu còn hơn 12 tháng dùng tác động kỳ hạn 12 tháng (không dùng
// cú sốc 3 tháng như thể vĩnh viễn); mục tiêu gần dùng 3 tháng. Kèm kịch bản xấu (P10 cùng kỳ hạn): phần chênh giữa P10 và kỳ
// vọng của cả gia đình được phân bổ cho từng vị thế theo độ lớn giá trị chịu tác động (xấp xỉ, ghi rõ trong giả định).
export interface ScenarioGoalInput {
  positions: { holding_id: string; part: string | null; mean_3m: number; mean_12m?: number; exposure?: number }[]
  ranges: { bad: number }[]
}
export type GoalScenarioImpact = GoalImpactResult & {
  basis: '3M' | '12M'; assumption: string
  stress: { ratio_after: string | null; level_after: GoalLevel; delta_pts: string; alert: boolean }
}

export function goalImpactScenario(g: Goal, positions: Position[], allGoals: Goal[], a: Assumptions, priceDate: string, t: GoalThresholds, sc: ScenarioGoalInput): GoalScenarioImpact {
  const long = goalMonthK(g, priceDate) > 12
  const h = long && sc.ranges.length > 2 ? 2 : 1
  const meanOf = (p: ScenarioGoalInput['positions'][number]) => long ? (p.mean_12m ?? p.mean_3m) : p.mean_3m
  const exp = sc.positions.map(p => ({ holding_id: p.holding_id, part: p.part, impact: String(Math.round(meanOf(p))) }))
  const totalMean = sc.positions.reduce((s, p) => s + meanOf(p), 0)
  const gap = Math.min(0, (sc.ranges[h]?.bad ?? totalMean) - totalMean)
  const wSum = sc.positions.reduce((s, p) => s + Math.abs(p.exposure ?? 0), 0)
  const stressRows = sc.positions.map(p => ({ holding_id: p.holding_id, part: p.part, impact: String(Math.round(meanOf(p) + (wSum > 0 ? gap * Math.abs(p.exposure ?? 0) / wSum : 0))) }))
  const base = goalImpact(g, positions, allGoals, a, priceDate, t, exp)
  const st = goalImpact(g, positions, allGoals, a, priceDate, t, stressRows)
  return {
    ...base, alert: base.alert || st.alert, basis: long ? '12M' : '3M',
    assumption: long
      ? 'Mục tiêu còn hơn 12 tháng: dùng tác động kỳ vọng kỳ hạn 12 tháng và coi là vĩnh viễn (chưa tính hồi phục sau đó). Kịch bản xấu: P10 12 tháng của gia đình, phần chênh so với kỳ vọng phân bổ cho vị thế theo giá trị chịu tác động.'
      : 'Mục tiêu trong 12 tháng: dùng tác động kỳ vọng kỳ hạn 3 tháng. Kịch bản xấu: P10 3 tháng của gia đình, phần chênh so với kỳ vọng phân bổ cho vị thế theo giá trị chịu tác động.',
    stress: { ratio_after: st.ratio_after, level_after: st.level_after, delta_pts: st.delta_pts, alert: st.alert },
  }
}

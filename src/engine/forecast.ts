// Sổ dự báo và chấm điểm (đợt 2 sau phản biện độc lập). Không gọi LLM, tính tất định.
// Khi CIO duyệt một nhận định có nhánh kịch bản, lưu phân phối dự báo của từng yếu tố quan sát được (theo nhánh, theo kỳ hạn).
// Đến hạn (1 tuần, 3 tháng, 12 tháng), so với biến động thực tế lấy từ market_series:
// - Brier nhiều lớp: nhánh "trúng" là nhánh có cú sốc gần biến động thực tế nhất (khoảng cách chuẩn hoá theo độ lệch chuẩn của nhánh).
//   Mốc so sánh: xác suất đều giữa các nhánh (Brier = 1 − 1/K).
// - Độ phủ dải 80%: biến động thực tế có nằm trong [P10, P90] của hỗn hợp các nhánh không.
// - Đúng hướng: dấu của biến động thực tế so với dấu của kỳ vọng (chỉ xét khi kỳ vọng đủ lớn).
import { horizonMonths, mixtureQuantile, propagate, type FactorModel, type ScenarioSet } from './scenario'

// Yếu tố quan sát được và chuỗi số liệu tương ứng. pct: % thay đổi; bp: thay đổi × 100 (chuỗi tính bằng %); pts: chênh lệch điểm %.
export const FACTOR_SERIES: Record<string, { key: string; kind: 'pct' | 'bp' | 'pts' }> = {
  VN_EQ: { key: 'VNINDEX', kind: 'pct' },
  GLOBAL_EQ: { key: 'SPX', kind: 'pct' },
  OIL: { key: 'BRENT', kind: 'pct' },
  GOLD_W: { key: 'GOLD_SPOT_USD', kind: 'pct' },
  CRYPTO: { key: 'BTC', kind: 'pct' },
  DXY: { key: 'DXY', kind: 'pct' },
  USDVND: { key: 'USDVND_CENTRAL', kind: 'pct' },
  US10Y: { key: 'US10Y', kind: 'bp' },
  VN_RATE: { key: 'VN_INTERBANK_1M', kind: 'bp' },
  VN_GOV: { key: 'VN_GOV10Y', kind: 'bp' },
  SJC_PREM: { key: 'SJC_PREM', kind: 'pts' },
}

export const CHECKPOINTS = [
  { horizon: '1 tuần', index: 0, days: 7 },
  { horizon: '3 tháng', index: 1, days: 91 },
  { horizon: '12 tháng', index: 2, days: 365 },
] as const

export interface FactorDist { mean: number[]; sd: number[] }      // theo kỳ hạn, đơn vị của yếu tố
export interface ForecastBranch { id: string; name: string; probability: number; factors: Record<string, FactorDist> }
export interface ForecastBody { model_version: string; priced_in: string; horizons: string[]; branches: ForecastBranch[]; expected: Record<string, number[]> }

// Phân phối của chính yếu tố k trong nhánh b (như familyScenario với vị thế 1 đơn vị yếu tố k)
export function buildForecast(model: FactorModel, set: ScenarioSet): ForecastBody {
  const months = horizonMonths(model)
  const cu = model.core_shock_uncertainty ?? 0.4
  const ids = model.factors.map(f => f.id)
  const keys = Object.keys(FACTOR_SERIES).filter(k => ids.includes(k))
  const branches = set.branches.map(b => {
    const pb = propagate(model, b, set.priced_in)
    const factors: Record<string, FactorDist> = {}
    for (const k of keys) {
      const i = ids.indexOf(k)
      const prof = model.factors[i].profile
      const mean = prof.map(p => pb.shocks[k] * p)
      const sd = prof.map((p, h) => {
        const vRes = Math.max(0, pb.cond_cov[i][i]) * months[h] * p * p
        const vCore = pb.core_grad.reduce((a, g) => a + Math.pow(cu * g.value * (g.grad[k] ?? 0) * p, 2), 0)
        return Math.sqrt(vRes + vCore)
      })
      factors[k] = { mean, sd }
    }
    return { id: b.id, name: b.name, probability: b.probability, factors }
  })
  const expected: Record<string, number[]> = {}
  for (const k of keys) expected[k] = model.horizons.map((_, h) => branches.reduce((a, b) => a + b.probability * b.factors[k].mean[h], 0))
  return { model_version: model.version, priced_in: set.priced_in, horizons: [...model.horizons], branches, expected }
}

// Biến động thực tế giữa hai quan sát theo loại chuỗi
export function realizedMove(kind: 'pct' | 'bp' | 'pts', v0: number, v1: number): number {
  if (kind === 'pct') return v0 !== 0 ? (v1 / v0 - 1) * 100 : NaN
  if (kind === 'bp') return (v1 - v0) * 100
  return v1 - v0
}

export interface CheckpointScore {
  horizon: string; scored_at: string; observed: Record<string, number>
  outcome_branch: string | null; brier: number | null; brier_uniform: number | null
  coverage: Record<string, boolean>; direction: Record<string, boolean>
}

export function scoreCheckpoint(fc: ForecastBody, h: number, observed: Record<string, number>, scoredAt: string): CheckpointScore {
  const ks = Object.keys(observed).filter(k => Number.isFinite(observed[k]) && fc.branches.every(b => b.factors[k]))
  const coverage: Record<string, boolean> = {}, direction: Record<string, boolean> = {}
  for (const k of ks) {
    const parts = fc.branches.map(b => ({ w: b.probability, m: b.factors[k].mean[h], s: b.factors[k].sd[h] }))
    const lo = mixtureQuantile(parts, 0.1), hi = mixtureQuantile(parts, 0.9)
    coverage[k] = observed[k] >= lo && observed[k] <= hi
    const e = fc.expected[k]?.[h] ?? 0
    const sdMix = Math.sqrt(parts.reduce((a, p) => a + p.w * (p.s * p.s + (p.m - e) * (p.m - e)), 0))
    if (Math.abs(e) >= 0.1 * sdMix && Math.abs(e) > 1e-9) direction[k] = Math.sign(observed[k]) === Math.sign(e)
  }
  let outcome: string | null = null, brier: number | null = null, brierU: number | null = null
  if (ks.length && fc.branches.length >= 2) {
    const dist = fc.branches.map(b => ks.reduce((a, k) => { const f = b.factors[k]; const s = Math.max(f.sd[h], 1e-6); return a + Math.pow((observed[k] - f.mean[h]) / s, 2) }, 0))
    const best = dist.indexOf(Math.min(...dist))
    outcome = fc.branches[best].id
    brier = fc.branches.reduce((a, b, i) => a + Math.pow(b.probability - (i === best ? 1 : 0), 2), 0)
    brierU = 1 - 1 / fc.branches.length
  }
  return { horizon: fc.horizons[h], scored_at: scoredAt, observed, outcome_branch: outcome, brier, brier_uniform: brierU, coverage, direction }
}

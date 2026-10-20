// Lớp tính kịch bản (tầng 5–6 của thiết kế đã duyệt). Không gọi LLM, tính tất định từ cấu hình FACTOR_MODEL.
// Agent chỉ chọn: nhánh kịch bản, xác suất, 1–5 yếu tố lõi và cỡ cú sốc trong thư viện CIO duyệt.
// Máy làm phần còn lại: suy ra các yếu tố khác theo tương quan (kỳ vọng có điều kiện, hai chế độ bình thường/căng thẳng),
// đổi ra tác động lên từng vị thế qua độ nhạy, rồi gộp các nhánh thành dải P5/P10/P50/P90 cho ba kỳ hạn (độ rộng theo độ dài kỳ hạn).
import type { Family, Instrument } from '../shared/types'
import type { Position, PriceBook } from './positions'
import { liabilityExposure } from './positions'
import { monthsBetween } from './dec'

export type Regime = 'calm' | 'stress'
export type Size = 'S' | 'M' | 'L'
export interface FactorDef { id: string; label: string; unit: string; origin: string; vol: { calm: number; stress: number }; library: Record<Size, number>; profile: readonly number[] }
export interface FactorModel {
  version: string; horizons: readonly string[]
  factors: readonly FactorDef[]
  corr: { calm: readonly (readonly number[])[]; stress: readonly (readonly number[])[] }
  equity: Record<string, { beta_calm: number; beta_stress: number; r2?: number }>
  sector_beta: Record<string, { beta_calm: number; beta_stress: number }>
  usd_revenue: Record<string, number>
  intl_beta: Record<string, number>
  credit_factor: Record<string, string>
  proxy: Record<string, { factor: string; loading: number; note?: string }>
  fund_duration: Record<string, number>
  uncertainty_weeks?: number              // không còn dùng (thay bằng horizon_months); giữ để đọc cấu hình cũ
  horizon_months?: readonly number[]      // độ dài từng kỳ hạn theo tháng; mặc định 0,25 / 3 / 12
  core_shock_uncertainty?: number         // độ bất định của chính cỡ cú sốc lõi (tỷ lệ của cú sốc); mặc định 0,4
  idio_default_r2?: number                // R² mặc định khi chưa ước lượng riêng cho mã cổ phiếu; mặc định 0,35
  quantiles: { bad: number; base: number; good: number; severe?: number }
  priced_in: Record<string, number>
  lane2_route_rm_pct: number
  analogs?: readonly unknown[]; sources?: readonly string[]
}

export interface CoreShock { factor: string; size: Size; direction: 'up' | 'down' }
export interface Branch { id: string; name: string; probability: number; regime: Regime; core_shocks: CoreShock[]; rationale: string; source_ids: string[] }
export interface ScenarioSet { priced_in: 'none' | 'partial' | 'full'; branches: Branch[]; notes?: string }

export interface PropagatedBranch {
  id: string; name: string; probability: number; regime: Regime
  shocks: Record<string, number>        // cú sốc đầy đủ của mọi yếu tố (đơn vị của yếu tố)
  core: string[]                        // yếu tố do agent chọn
  cond_cov: number[][]                  // hiệp phương sai có điều kiện cho 1 tháng (0 ở hàng/cột yếu tố lõi)
  core_grad: { value: number; grad: Record<string, number> }[] // mỗi yếu tố lõi: cỡ cú sốc và ảnh hưởng lên mọi yếu tố trên 1 đơn vị
}

// ---------- đại số tuyến tính nhỏ (≤ 15 chiều) ----------
function solve(A: number[][], B: number[][]): number[][] {
  // Giải A·X = B bằng khử Gauss có chọn trụ
  const n = A.length, m = B[0].length
  const M = A.map((r, i) => [...r, ...B[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('Ma trận tương quan suy biến với tập yếu tố lõi này')
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k < n + m; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((r, i) => r.slice(n).map(v => v / M[i][i]))
}

export function covariance(model: FactorModel, regime: Regime): number[][] {
  const v = model.factors.map(f => f.vol[regime])
  return model.corr[regime].map((row, i) => row.map((c, j) => c * v[i] * v[j]))
}

export const DEFAULT_HORIZON_MONTHS = [0.25, 3, 12]
export const horizonMonths = (m: FactorModel) => m.horizon_months?.length === m.horizons.length ? [...m.horizon_months] : m.horizons.map((_, i) => DEFAULT_HORIZON_MONTHS[i] ?? 12)

// Kiểm tra mô hình yếu tố trước khi lưu cấu hình: ma trận tương quan đối xứng, đường chéo 1, hệ số trong [−1, 1],
// xác định dương (phân rã Cholesky được); biến động dương; xác suất phân vị hợp lệ.
export function factorModelErrors(m: FactorModel): string[] {
  const e: string[] = []
  const n = m.factors?.length ?? 0
  if (!n) return ['Mô hình không có yếu tố nào']
  if (!Array.isArray(m.horizons) || !m.horizons.length) e.push('Thiếu danh sách kỳ hạn')
  if (m.horizon_months && (m.horizon_months.length !== m.horizons.length || m.horizon_months.some(x => !(x > 0)))) e.push('horizon_months phải dương và cùng số phần tử với horizons')
  for (const f of m.factors) {
    if (!(f.vol?.calm > 0 && f.vol?.stress > 0)) e.push(`Biến động của ${f.id} phải dương ở cả hai chế độ`)
    if (!Array.isArray(f.profile) || f.profile.length !== m.horizons.length) e.push(`Hồ sơ thời gian của ${f.id} phải có ${m.horizons.length} phần tử`)
  }
  for (const reg of ['calm', 'stress'] as const) {
    const C = m.corr?.[reg]
    if (!C || C.length !== n || C.some(r => r.length !== n)) { e.push(`Ma trận tương quan ${reg} phải là ${n}×${n}`); continue }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = C[i][j]
      if (!Number.isFinite(v) || v < -1 || v > 1) e.push(`Tương quan ${reg}[${m.factors[i].id},${m.factors[j].id}] = ${v} ngoài [−1, 1]`)
      if (i === j && Math.abs(v - 1) > 1e-9) e.push(`Đường chéo tương quan ${reg} tại ${m.factors[i].id} phải bằng 1`)
      if (j > i && Math.abs(v - C[j][i]) > 1e-9) e.push(`Ma trận tương quan ${reg} không đối xứng tại ${m.factors[i].id},${m.factors[j].id}`)
    }
    if (!isPositiveDefinite(C)) e.push(`Ma trận tương quan ${reg} không xác định dương: lan truyền có thể cho kết quả vô nghĩa`)
  }
  const q = m.quantiles
  if (!q || !(q.bad > 0 && q.bad < q.base && q.base < q.good && q.good < 1)) e.push('Phân vị phải thỏa 0 < xấu < cơ sở < tốt < 1')
  if (q?.severe !== undefined && !(q.severe > 0 && q.severe < q.bad)) e.push('Phân vị rất xấu phải nhỏ hơn phân vị xấu')
  if (m.core_shock_uncertainty !== undefined && !(m.core_shock_uncertainty >= 0 && m.core_shock_uncertainty <= 2)) e.push('core_shock_uncertainty phải trong [0, 2]')
  if (m.idio_default_r2 !== undefined && !(m.idio_default_r2 > 0 && m.idio_default_r2 <= 1)) e.push('idio_default_r2 phải trong (0, 1]')
  return e
}
export function isPositiveDefinite(A: readonly (readonly number[])[]): boolean {
  const n = A.length, L = A.map(() => new Array(n).fill(0))
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j]
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]
    if (i === j) { if (s <= 1e-10) return false; L[i][i] = Math.sqrt(s) } else L[i][j] = s / L[j][j]
  }
  return true
}

export function coreValue(model: FactorModel, s: CoreShock, mult: number): number {
  const f = model.factors.find(x => x.id === s.factor)
  if (!f) throw new Error(`Yếu tố ${s.factor} không có trong mô hình`)
  return (s.direction === 'up' ? 1 : -1) * f.library[s.size] * mult
}

// Kỳ vọng có điều kiện: Δn = Σnc Σcc⁻¹ Δc ; bất định còn lại Σn|c = Σnn − Σnc Σcc⁻¹ Σcn
export function propagate(model: FactorModel, b: Branch, pricedIn: ScenarioSet['priced_in']): PropagatedBranch {
  const ids = model.factors.map(f => f.id)
  const mult = model.priced_in[pricedIn] ?? 1
  const S = covariance(model, b.regime)
  const core = b.core_shocks.map(s => s.factor)
  const ci = core.map(c => ids.indexOf(c))
  const ni = ids.map((_, i) => i).filter(i => !ci.includes(i))
  const dc = b.core_shocks.map(s => [coreValue(model, s, mult)])
  const Scc = ci.map(i => ci.map(j => S[i][j]))
  const Scn = ci.map(i => ni.map(j => S[i][j]))
  const W = ni.length ? solve(Scc, Scn) : ci.map(() => [] as number[]) // Σcc⁻¹ Σcn  (|c| × |n|)
  const shocks: Record<string, number> = {}
  ci.forEach((i, k) => { shocks[ids[i]] = dc[k][0] })
  ni.forEach((i, r) => { shocks[ids[i]] = ci.reduce((acc, _, k) => acc + W[k][r] * dc[k][0], 0) })
  const cond = ids.map(() => ids.map(() => 0))
  ni.forEach((i, r) => ni.forEach((j, q) => {
    let v = S[i][j]
    for (let k = 0; k < ci.length; k++) v -= S[i][ci[k]] * W[k][q]
    cond[i][j] = v
  }))
  // Ảnh hưởng của 1 đơn vị cú sốc lõi k lên mọi yếu tố (dùng cho bất định của chính cỡ cú sốc)
  const core_grad = ci.map((i, k) => {
    const grad: Record<string, number> = { [ids[i]]: 1 }
    ni.forEach((j, r) => { grad[ids[j]] = W[k][r] })
    return { value: dc[k][0], grad }
  })
  return { id: b.id, name: b.name, probability: b.probability, regime: b.regime, shocks, core, cond_cov: cond, core_grad }
}

// ---------- độ nhạy của từng vị thế: VND thay đổi trên 1 đơn vị yếu tố ----------
export function bondDuration(inst: Instrument, priceDate: string): number {
  if (!inst.bond) return 0
  const years = Math.max(0, monthsBetween(priceDate, inst.bond.maturity) / 12)
  const c = Number(inst.bond.coupon_rate), f = inst.bond.freq || 1
  if (years <= 0) return 0
  // Duration Macaulay với lợi suất ≈ lãi coupon, đổi sang duration điều chỉnh
  const y = c / f, n = Math.max(1, Math.round(years * f))
  let pv = 0, t = 0
  for (let k = 1; k <= n; k++) { const cf = (k === n ? 1 : 0) + c / f; const d = cf / Math.pow(1 + y, k); pv += d; t += d * (k / f) }
  return (t / pv) / (1 + y)
}

const pctLoad = (exposure: number, loading: number) => exposure * loading / 100
const bpLoad = (exposure: number, duration: number) => -exposure * duration / 10000

export interface PosLoad { holding_id: string; instrument_id: string; instrument_name: string; part: string | null; asset_class: string; currency: string; exposure: number; loadings: Record<string, number>; model_based: boolean; note?: string; idio_var_month: number }

export function positionLoadings(p: Position, inst: Instrument, model: FactorModel, regime: Regime, priceDate: string): PosLoad {
  const e = p.exposure.toNumber()
  const L: Record<string, number> = {}
  const add = (f: string, v: number) => { if (v) L[f] = (L[f] ?? 0) + v }
  let model_based = false, note: string | undefined
  const beta = (sector?: string) => {
    const eq = p.part === null ? model.equity[p.instrument_id] : undefined
    const sb = model.sector_beta[sector ?? 'OTHER'] ?? model.sector_beta.OTHER
    return regime === 'stress' ? (eq?.beta_stress ?? sb.beta_stress) : (eq?.beta_calm ?? sb.beta_calm)
  }
  const credit = () => model.credit_factor[p.instrument_id] ?? model.credit_factor[p.sector ?? ''] ?? model.credit_factor.DEFAULT
  let idio = 0
  switch (p.asset_class) {
    case 'EQ_VN': {
      const b = beta(p.sector)
      add('VN_EQ', pctLoad(e, b))
      // Rủi ro riêng của từng mã (phần biến động không giải thích bởi VN-Index): σε² = β²σm²(1−R²)/R², theo tháng.
      // Chỉ áp cho cổ phiếu nắm trực tiếp; quỹ đã đa dạng hóa nên bỏ qua.
      if (p.part === null) {
        const r2 = Math.min(0.95, Math.max(0.05, model.equity[p.instrument_id]?.r2 ?? model.idio_default_r2 ?? 0.35))
        const vm = model.factors.find(f => f.id === 'VN_EQ')?.vol[regime] ?? 0
        idio = Math.pow(e / 100, 2) * b * b * vm * vm * (1 - r2) / r2
      }
      if (p.part === null && model.usd_revenue[p.instrument_id]) add('USDVND', pctLoad(e, model.usd_revenue[p.instrument_id]))
      break
    }
    case 'EQ_INTL': add('GLOBAL_EQ', pctLoad(e, model.intl_beta[p.instrument_id] ?? 1)); break
    case 'GOV_BOND': {
      const d = p.part === null ? bondDuration(inst, priceDate) : model.fund_duration[p.gov_tenor ?? 'long']
      add('VN_GOV', bpLoad(e, d)); break
    }
    case 'CORP_BOND': {
      const d = p.part === null ? bondDuration(inst, priceDate) : model.fund_duration.CORP_BOND
      add('VN_GOV', bpLoad(e, d)); add(credit(), bpLoad(e, d)); break
    }
    case 'GOLD': add('GOLD_W', pctLoad(e, 1)); add('USDVND', pctLoad(e, 1)); add('SJC_PREM', pctLoad(e, 0.9)); break
    case 'CRYPTO': add('CRYPTO', pctLoad(e, 1)); add('USDVND', pctLoad(e, 1)); break
    case 'REAL_ESTATE': case 'PRIVATE_EQ': {
      const px = model.proxy[p.asset_class]
      if (px) { add(px.factor, pctLoad(e, px.loading)); model_based = true; note = px.note ?? 'Ước tính theo mô hình, không phải giá thị trường' }
      break
    }
    default: break
  }
  // Tài sản định giá bằng ngoại tệ: thêm biến động tỷ giá khi quy ra VND (SGD, AUD tạm dùng USD/VND làm đại diện)
  if (p.currency !== 'VND') add('USDVND', pctLoad(e, 1))
  return { holding_id: p.holding_id, instrument_id: p.instrument_id, instrument_name: p.instrument_name, part: p.part, asset_class: p.asset_class, currency: p.currency, exposure: e, loadings: L, model_based, ...(note ? { note } : {}), idio_var_month: idio }
}

// ---------- gộp nhánh: hỗn hợp phân phối chuẩn ----------
function erf(x: number) { // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return x >= 0 ? y : -y
}
const ncdf = (x: number, m: number, s: number) => s <= 0 ? (x >= m ? 1 : 0) : 0.5 * (1 + erf((x - m) / (s * Math.SQRT2)))
export function mixtureQuantile(parts: { w: number; m: number; s: number }[], q: number): number {
  const lo0 = Math.min(...parts.map(p => p.m - 6 * p.s)), hi0 = Math.max(...parts.map(p => p.m + 6 * p.s))
  let lo = lo0, hi = hi0
  if (hi - lo < 1e-9) return lo
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    const c = parts.reduce((a, p) => a + p.w * ncdf(mid, p.m, p.s), 0)
    if (c < q) lo = mid; else hi = mid
  }
  return (lo + hi) / 2
}

// bad = P10, base = P50, good = P90, severe = P5 (theo phân vị cấu hình). Phân phối giả định chuẩn trong từng nhánh nên
// đuôi có thể mỏng hơn thực tế: severe là mốc tham khảo, không phải mức tổn thất tối đa.
export interface HorizonRange { horizon: string; months: number; severe: number; bad: number; base: number; good: number; severe_pct: number | null; bad_pct: number | null; base_pct: number | null; good_pct: number | null }
export interface FamilyScenarioResult {
  model_version: string; net_worth: number
  ranges: HorizonRange[]
  branches: { id: string; name: string; probability: number; regime: Regime; mean: number[]; sd: number[] }[]
  by_factor: Record<string, number>          // đóng góp trung bình theo xác suất, kỳ hạn 3 tháng
  by_asset_class: Record<string, number>     // như trên, theo loại tài sản
  positions: { holding_id: string; part: string | null; instrument_id: string; name: string; asset_class: string; exposure: number; mean_3m: number; mean_12m: number; model_based: boolean; loadings: Record<string, number> }[]
  loan_cost_annual: number                   // chi phí lãi vay VND thả nổi thay đổi/năm (trung bình theo xác suất)
  model_based_share: number                  // phần tác động đến từ tài sản định giá theo mô hình (BĐS, CP chưa niêm yết)
  lane2: { route: 'AUTO' | 'RM_REVIEW'; reason: string }
  // Phân rã phương sai 3 tháng (trung bình theo xác suất): tương quan còn lại, cỡ cú sốc lõi, rủi ro riêng từng mã
  variance_share_3m: { residual: number; core: number; idio: number }
}

const round = (x: number) => Math.round(x)

export function familyScenario(f: Family, positions: Position[], book: PriceBook, instruments: Record<string, Instrument>, model: FactorModel, set: ScenarioSet, netWorth: number): FamilyScenarioResult {
  const ids = model.factors.map(x => x.id)
  const prof = (fid: string, h: number) => model.factors.find(x => x.id === fid)!.profile[h]
  const branches = set.branches.map(b => propagate(model, b, set.priced_in))
  const H = model.horizons.length
  const months = horizonMonths(model)
  const cu = model.core_shock_uncertainty ?? 0.4
  const vs = { residual: 0, core: 0, idio: 0 }
  const liab = liabilityExposure(f, book)
  const bOut: FamilyScenarioResult['branches'] = []
  const byFactor: Record<string, number> = {}, byClass: Record<string, number> = {}
  const posMean = new Map<string, { row: PosLoad; v: number; v12: number }>()
  let loanCost = 0, modelBased = 0, totalAbs = 0
  for (const pb of branches) {
    const loads = positions.map(p => positionLoadings(p, instruments[p.instrument_id], model, pb.regime, book.price_date))
    // Nợ ngoại tệ: tỷ giá tăng làm nợ quy đổi tăng (tác động âm lên tài sản ròng)
    const liabLoad: Record<string, number> = {}
    for (const l of liab) if (l.currency !== 'VND') liabLoad.USDVND = (liabLoad.USDVND ?? 0) - l.exposure.toNumber() / 100
    const fam: Record<string, number> = { ...liabLoad }
    for (const r of loads) for (const [k, v] of Object.entries(r.loadings)) fam[k] = (fam[k] ?? 0) + v
    const mean: number[] = [], sd: number[] = []
    const idioMonth = loads.reduce((a, r) => a + r.idio_var_month, 0)
    for (let h = 0; h < H; h++) {
      let m = 0
      for (const k of ids) m += (fam[k] ?? 0) * pb.shocks[k] * prof(k, h)
      const lh = ids.map(k => (fam[k] ?? 0) * prof(k, h))
      // (1) bất định của các yếu tố được suy ra, theo tháng, nhân độ dài kỳ hạn
      let vRes = 0
      for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) vRes += lh[i] * pb.cond_cov[i][j] * lh[j]
      vRes = Math.max(0, vRes) * months[h]
      // (2) bất định của chính cỡ cú sốc lõi do agent chọn (S/M/L chỉ là mốc): độ lệch chuẩn = cu × |cú sốc|, lan qua tương quan
      let vCore = 0
      for (const g of pb.core_grad) { const d = ids.reduce((a, k, i) => a + lh[i] * (g.grad[k] ?? 0), 0); vCore += Math.pow(cu * g.value * d, 2) }
      // (3) rủi ro riêng của từng mã cổ phiếu, độc lập giữa các mã, theo tháng
      const vIdio = idioMonth * months[h]
      mean.push(m); sd.push(Math.sqrt(vRes + vCore + vIdio))
      if (h === 1) { vs.residual += pb.probability * vRes; vs.core += pb.probability * vCore; vs.idio += pb.probability * vIdio }
    }
    bOut.push({ id: pb.id, name: pb.name, probability: pb.probability, regime: pb.regime, mean: mean.map(round), sd: sd.map(round) })
    // Đóng góp kỳ hạn 3 tháng (chỉ số 1), trung bình theo xác suất
    for (const k of ids) { const c = (fam[k] ?? 0) * pb.shocks[k] * prof(k, 1) * pb.probability; if (c) byFactor[k] = (byFactor[k] ?? 0) + c }
    for (const r of loads) {
      const v = Object.entries(r.loadings).reduce((a, [k, x]) => a + x * pb.shocks[k] * prof(k, 1), 0) * pb.probability
      const v12 = Object.entries(r.loadings).reduce((a, [k, x]) => a + x * pb.shocks[k] * prof(k, H - 1), 0) * pb.probability
      byClass[r.asset_class] = (byClass[r.asset_class] ?? 0) + v
      const key = `${r.holding_id}|${r.part ?? ''}`
      const cur = posMean.get(key); posMean.set(key, { row: cur?.row ?? r, v: (cur?.v ?? 0) + v, v12: (cur?.v12 ?? 0) + v12 })
      if (r.model_based) modelBased += Math.abs(v)
      totalAbs += Math.abs(v)
    }
    const lv = (liabLoad.USDVND ?? 0) * pb.shocks.USDVND * prof('USDVND', 1) * pb.probability
    if (lv) byClass.LIABILITY = (byClass.LIABILITY ?? 0) + lv
    totalAbs += Math.abs(lv)
    // Vay VND lãi thả nổi: chi phí lãi/năm thay đổi theo lãi suất VND
    for (const l of f.liabilities.filter(x => x.currency === 'VND' && x.rate_type === 'floating')) {
      const e = liab.find(x => x.id === l.id)!.exposure.toNumber()
      loanCost += e * (pb.shocks.VN_RATE ?? 0) / 10000 * pb.probability
    }
  }
  const qs = model.quantiles
  const ranges: HorizonRange[] = model.horizons.map((h, i) => {
    const parts = bOut.map(b => ({ w: b.probability, m: b.mean[i], s: b.sd[i] }))
    const [severe, bad, base, good] = [qs.severe ?? 0.05, qs.bad, qs.base, qs.good].map(q => round(mixtureQuantile(parts, q)))
    const pct = (x: number) => netWorth > 0 ? x / netWorth : null
    return { horizon: h, months: months[i], severe, bad, base, good, severe_pct: pct(severe), bad_pct: pct(bad), base_pct: pct(base), good_pct: pct(good) }
  })
  const bad3 = ranges[1].bad_pct
  const lane2 = bad3 !== null && bad3 <= model.lane2_route_rm_pct
    ? { route: 'RM_REVIEW' as const, reason: `Mốc P10 (xấu) 3 tháng ${(bad3 * 100).toFixed(1)}% vượt ngưỡng ${(model.lane2_route_rm_pct * 100).toFixed(0)}%: chuyển RM xem trước, không gửi tự động` }
    : { route: 'AUTO' as const, reason: 'Trong ngưỡng: được gửi theo mẫu đã duyệt (luồng 2), RM có thể tạm dừng' }
  return {
    model_version: model.version, net_worth: round(netWorth), ranges, branches: bOut,
    by_factor: Object.fromEntries(Object.entries(byFactor).map(([k, v]) => [k, round(v)])),
    by_asset_class: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, round(v)])),
    positions: [...posMean.values()].map(({ row, v, v12 }) => ({ holding_id: row.holding_id, part: row.part, instrument_id: row.instrument_id, name: row.instrument_name, asset_class: row.asset_class, exposure: round(row.exposure), mean_3m: round(v), mean_12m: round(v12), model_based: row.model_based, loadings: Object.fromEntries(Object.entries(row.loadings).map(([k, x]) => [k, Math.round(x)])) }))
      .sort((a, b) => Math.abs(b.mean_3m) - Math.abs(a.mean_3m)),
    loan_cost_annual: round(loanCost), model_based_share: totalAbs > 0 ? modelBased / totalAbs : 0, lane2,
    variance_share_3m: (() => { const t = vs.residual + vs.core + vs.idio; return t > 0 ? { residual: vs.residual / t, core: vs.core / t, idio: vs.idio / t } : { residual: 0, core: 0, idio: 0 } })(),
  }
}

// Kết quả cấp nhận định: cú sốc của từng nhánh và cú sốc kỳ vọng theo xác suất (để CIO xem trước khi duyệt)
export function scenarioPreview(model: FactorModel, set: ScenarioSet) {
  const br = set.branches.map(b => propagate(model, b, set.priced_in))
  const expected: Record<string, number> = {}
  for (const b of br) for (const [k, v] of Object.entries(b.shocks)) expected[k] = (expected[k] ?? 0) + v * b.probability
  const r4 = (x: number) => Math.round(x * 100) / 100
  return {
    model_version: model.version,
    branches: br.map(b => ({ id: b.id, name: b.name, probability: b.probability, regime: b.regime, core: b.core, shocks: Object.fromEntries(Object.entries(b.shocks).map(([k, v]) => [k, r4(v)])) })),
    expected: Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, r4(v)])),
  }
}

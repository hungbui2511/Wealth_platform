// Dòng tiền ngắn hạn (BR-18) và dài hạn (BR-23). Xác định, dùng Decimal, không gọi LLM.
import { LIQUID_FOR_L, ILLIQUID } from '../shared/catalog'
import type { CashflowItem, Family, Goal, Instrument } from '../shared/types'
import { D, Decimal, ZERO, ONE, sum, vnd, s, monthIndex, ymOfIndex } from './dec'
import { accountEffOwn, fxRate, ownerShare, type PriceBook, type Position } from './positions'

export interface CfLine {
  item_id: string; label: string; category: string; direction: 'in' | 'out'
  k: number // tháng thứ k kể từ tháng sau price_date (1-based)
  amount: Decimal; expected: boolean; origin: 'auto' | 'manual'; once: boolean
  conversion?: boolean // gốc trái phiếu đáo hạn: chuyển đổi tài sản trong L (không cộng thêm vào L)
}

export interface LiquidityThresholds { large_outflow_pct: string; coverage_min: string }

function growthOf(item: CashflowItem, inflation: string): Decimal {
  if (item.growth !== undefined) return D(item.growth)
  return item.direction === 'out' && item.category === 'living' ? D(inflation) : ZERO
}

// Lịch dòng tiền theo tháng cho k = 1..nMonths
export function schedule(f: Family, instruments: Record<string, Instrument>, book: PriceBook, nMonths: number, inflation: string): CfLine[] {
  const base = monthIndex(book.price_date)
  const out: CfLine[] = []
  const yearOf = (k: number) => Math.ceil(k / 12)

  // Trái phiếu: coupon và gốc đáo hạn
  for (const h of f.holdings) {
    const inst = instruments[h.instrument_id]
    if (!inst?.bond) continue
    const eff = accountEffOwn(f, h.account_id)
    const fx = fxRate(book, inst.currency)
    const face = D(h.quantity).times(D(inst.bond.par))
    const mi = monthIndex(inst.bond.maturity)
    const step = 12 / inst.bond.freq
    const coupon = face.times(D(inst.bond.coupon_rate)).div(inst.bond.freq)
    for (let k = 1; k <= nMonths; k++) {
      const idx = base + k
      if (idx > mi) break
      if ((mi - idx) % step === 0) out.push({ item_id: `AUTO-CPN-${h.id}`, label: `Coupon ${inst.id}`, category: 'coupon', direction: 'in', k, amount: coupon.times(eff).times(fx), expected: false, origin: 'auto', once: false })
      if (idx === mi) out.push({ item_id: `AUTO-PRN-${h.id}`, label: `Gốc đáo hạn ${inst.id}`, category: 'principal', direction: 'in', k, amount: face.times(eff).times(fx), expected: false, origin: 'auto', once: true, conversion: true })
    }
  }

  // Tiền gửi có kỳ hạn: lãi khi đáo hạn, giả định tái tục cùng kỳ hạn
  for (const h of f.holdings) {
    if (!h.deposit) continue
    const inst = instruments[h.instrument_id]
    const eff = accountEffOwn(f, h.account_id)
    const fx = fxRate(book, inst.currency)
    const term = Math.max(1, monthIndex(h.deposit.maturity) - monthIndex(h.deposit.start))
    const interest = D(h.quantity).times(D(h.deposit.rate)).times(term).div(12)
    for (let idx = monthIndex(h.deposit.maturity); idx <= base + nMonths; idx += term) {
      const k = idx - base
      if (k >= 1) out.push({ item_id: `AUTO-DEP-${h.id}`, label: `Lãi tiền gửi đáo hạn ${inst.id}`, category: 'deposit_interest', direction: 'in', k, amount: interest.times(eff).times(fx), expected: false, origin: 'auto', once: false })
    }
  }

  // Khoản nợ: gốc đều hoặc gốc cuối kỳ; lãi thả nổi dùng lãi suất hiện hành
  for (const l of f.liabilities) {
    const eff = ownerShare(f, l.borrower.kind, l.borrower.id)
    const fx = fxRate(book, l.currency)
    const mi = monthIndex(l.maturity)
    let bal = D(l.balance)
    const rate = D(l.rate).div(12)
    for (let k = 1; k <= nMonths && bal.gt(0); k++) {
      const idx = base + k
      if (idx > mi) break
      out.push({ item_id: `AUTO-INT-${l.id}`, label: `Lãi vay ${l.name}`, category: 'loan_interest', direction: 'out', k, amount: bal.times(rate).times(eff).times(fx), expected: false, origin: 'auto', once: false })
      let principal = l.repayment === 'amortizing' ? Decimal.min(D(l.principal_per_month), bal) : ZERO
      if (idx === mi) principal = bal
      if (principal.gt(0)) out.push({ item_id: `AUTO-PRN-${l.id}`, label: `Gốc vay ${l.name}`, category: 'loan_principal', direction: 'out', k, amount: principal.times(eff).times(fx), expected: false, origin: 'auto', once: idx === mi && l.repayment === 'bullet' })
      bal = bal.minus(principal)
    }
  }

  // Khoản nhập tay
  for (const it of f.cashflows) {
    const eff = ownerShare(f, it.subject.kind, it.subject.id)
    const fx = fxRate(book, it.currency)
    const g = growthOf(it, inflation)
    const si = monthIndex(it.start)
    const ei = it.end ? monthIndex(it.end) : Infinity
    const step = it.frequency === 'monthly' ? 1 : it.frequency === 'quarterly' ? 3 : it.frequency === 'annual' ? 12 : 0
    for (let k = 1; k <= nMonths; k++) {
      const idx = base + k
      if (idx < si || idx > ei) continue
      const hit = step === 0 ? idx === si : (idx - si) % step === 0
      if (!hit) continue
      const amt = D(it.amount).times(ONE.plus(g).pow(yearOf(k) - 1)).times(eff).times(fx)
      out.push({ item_id: it.id, label: it.label, category: it.category, direction: it.direction, k, amount: amt, expected: it.expected, origin: it.origin, once: step === 0 })
    }
  }
  return out
}

const signed = (l: CfLine) => (l.direction === 'in' ? l.amount : l.amount.neg())

export function cashExposure(positions: Position[]): Decimal {
  return sum(positions.filter(p => p.asset_class === 'CASH').map(p => p.exposure))
}

export interface ShortTermResult {
  price_date: string; start_cash: string
  months: { k: number; ym: string; inflow: string; outflow: string; net: string; cumulative: string; expected_in: string }[]
  by_category: { category: string; direction: string; total: string; expected: boolean }[]
  items: { item_id: string; label: string; category: string; direction: string; k: number; ym: string; amount: string; expected: boolean; origin: string }[]
  totals: { inflow: string; outflow: string; net: string }
  coverage: string | null
  alerts: { code: 'cash_shortfall' | 'large_outflow' | 'low_coverage'; level: 'RED' | 'YELLOW'; message: string; k?: number; ym?: string; item_id?: string }[]
}

export function shortTerm(f: Family, instruments: Record<string, Instrument>, book: PriceBook, positions: Position[], inflation: string, t: LiquidityThresholds, filter?: (l: CfLine) => boolean): ShortTermResult {
  const base = monthIndex(book.price_date)
  let lines = schedule(f, instruments, book, 12, inflation)
  if (filter) lines = lines.filter(filter)
  const startCash = cashExposure(positions)
  let cum = startCash
  const months = []
  for (let k = 1; k <= 12; k++) {
    const ls = lines.filter(l => l.k === k)
    const inflow = sum(ls.filter(l => l.direction === 'in').map(l => l.amount))
    const outflow = sum(ls.filter(l => l.direction === 'out').map(l => l.amount))
    cum = cum.plus(inflow).minus(outflow)
    months.push({ k, ym: ymOfIndex(base + k), inflow: vnd(inflow), outflow: vnd(outflow), net: vnd(inflow.minus(outflow)), cumulative: vnd(cum), expected_in: vnd(sum(ls.filter(l => l.expected && l.direction === 'in').map(l => l.amount))) })
  }
  const cats: Record<string, { category: string; direction: string; total: Decimal; expected: boolean }> = {}
  for (const l of lines) {
    const key = `${l.category}|${l.direction}`
    cats[key] ??= { category: l.category, direction: l.direction, total: ZERO, expected: false }
    cats[key].total = cats[key].total.plus(l.amount)
    cats[key].expected ||= l.expected
  }
  const tin = sum(lines.filter(l => l.direction === 'in').map(l => l.amount))
  const tout = sum(lines.filter(l => l.direction === 'out').map(l => l.amount))
  const net = tin.minus(tout)
  const alerts: ShortTermResult['alerts'] = []
  const firstNeg = months.find(m => D(m.cumulative).isNegative())
  if (firstNeg) alerts.push({ code: 'cash_shortfall', level: 'RED', k: firstNeg.k, ym: firstNeg.ym, message: `Số dư tiền lũy kế âm lần đầu ở tháng ${firstNeg.ym}` })
  for (const l of lines.filter(l => l.once && l.direction === 'out')) {
    if (startCash.gt(0) && l.amount.gt(startCash.times(D(t.large_outflow_pct))))
      alerts.push({ code: 'large_outflow', level: 'YELLOW', k: l.k, ym: ymOfIndex(base + l.k), item_id: l.item_id, message: `Khoản chi một lần "${l.label}" lớn hơn ${D(t.large_outflow_pct).times(100).toString()}% tiền đầu kỳ` })
  }
  let coverage: Decimal | null = null
  if (net.isNegative()) {
    coverage = startCash.div(net.abs())
    if (coverage.lt(D(t.coverage_min))) alerts.push({ code: 'low_coverage', level: 'YELLOW', message: 'Hệ số bao phủ tiền đầu kỳ trên dòng tiền thuần âm 12 tháng nhỏ hơn ngưỡng' })
  }
  return {
    price_date: book.price_date, start_cash: vnd(startCash), months,
    by_category: Object.values(cats).map(c => ({ ...c, total: vnd(c.total) })),
    items: lines.sort((a, b) => a.k - b.k).map(l => ({ item_id: l.item_id, label: l.label, category: l.category, direction: l.direction, k: l.k, ym: ymOfIndex(base + l.k), amount: vnd(l.amount), expected: l.expected, origin: l.origin })),
    totals: { inflow: vnd(tin), outflow: vnd(tout), net: vnd(net) },
    coverage: coverage ? s(coverage, 6) : null, alerts,
  }
}

// ---------- Dài hạn (BR-23) ----------

export interface PoolComponent { value: Decimal; r: Decimal }
export interface GoalFlow { goal_id: string; name: string; spend: Map<number, Decimal>; components: PoolComponent[]; contribution: Decimal; contribUntil: number }

export interface ProjectLInput { L0: Decimal; rL: Decimal; years: number; netByYear: Decimal[]; conversionByYear: Decimal[]; goals: GoalFlow[] }
export interface ProjectLYear { t: number; L: Decimal; net: Decimal; goal_from_L: Decimal; goal_spend: Decimal; pools: Decimal; contributions: Decimal }

// Lõi đệ quy: L_t = L_{t−1}(1 + r_L) + dòng tiền thuần năm t − phần chi mục tiêu tài sản dành riêng không đủ
export function projectL(inp: ProjectLInput): ProjectLYear[] {
  let L = inp.L0
  const pools = inp.goals.map(g => g.components.map(c => ({ ...c })))
  const out: ProjectLYear[] = []
  for (let t = 1; t <= inp.years; t++) {
    const net = inp.netByYear[t - 1] ?? ZERO
    let fromL = ZERO, spendTotal = ZERO, contrib = ZERO
    inp.goals.forEach((g, gi) => {
      const comps = pools[gi]
      for (const c of comps) c.value = c.value.times(ONE.plus(c.r))
      if (t <= g.contribUntil && g.contribution.gt(0)) { comps.push({ value: g.contribution, r: inp.rL }); contrib = contrib.plus(g.contribution) }
      const spend = g.spend.get(t) ?? ZERO
      if (spend.gt(0)) {
        spendTotal = spendTotal.plus(spend)
        const poolVal = sum(comps.map(c => c.value))
        const fromPool = Decimal.min(poolVal, spend)
        const ratio = poolVal.gt(0) ? fromPool.div(poolVal) : ZERO
        for (const c of comps) c.value = c.value.times(ONE.minus(ratio))
        fromL = fromL.plus(spend.minus(fromPool))
      }
    })
    L = L.times(ONE.plus(inp.rL)).plus(net).minus(inp.conversionByYear[t - 1] ?? ZERO).minus(fromL).minus(contrib)
    out.push({ t, L, net, goal_from_L: fromL, goal_spend: spendTotal, pools: sum(pools.flat().map(c => c.value)), contributions: contrib })
  }
  return out
}

export interface Assumptions { inflation: string; r: Record<string, string> }

export function rOf(assetClass: string, a: Assumptions): Decimal { return D(a.r[assetClass] ?? 0) }

export function earmarkPct(goals: Goal[], holdingId: string): Decimal {
  return sum(goals.filter(g => g.status === 'active').flatMap(g => g.earmarks.filter(e => e.holding_id === holdingId).map(e => D(e.pct))))
}

export function liquidL(positions: Position[], goals: Goal[], a: Assumptions): { L0: Decimal; rL: Decimal } {
  let L0 = ZERO, w = ZERO
  for (const p of positions) {
    if (!LIQUID_FOR_L.has(p.asset_class)) continue
    const free = p.exposure.times(ONE.minus(earmarkPct(goals, p.holding_id)))
    L0 = L0.plus(free); w = w.plus(free.times(rOf(p.asset_class, a)))
  }
  return { L0, rL: L0.gt(0) ? w.div(L0) : ZERO }
}

export function goalMonthK(g: Goal, priceDate: string): number {
  return monthIndex(`${g.year}-${String(g.month).padStart(2, '0')}-01`) - monthIndex(priceDate)
}

export function goalPayments(g: Goal, priceDate: string): { yearIdx: number; amount: Decimal; n: Decimal }[] {
  const k = goalMonthK(g, priceDate)
  const n0 = D(k).div(12)
  const t0 = Math.max(1, Math.ceil(k / 12))
  const count = g.spend.kind === 'multi' ? g.spend.years : 1
  const out = []
  for (let j = 0; j < count; j++) {
    const n = n0.plus(j)
    const amt = g.basis === 'today' ? D(g.amount).times(ONE.plus(D(g.cost_growth)).pow(n)) : D(g.amount)
    out.push({ yearIdx: t0 + j, amount: amt, n })
  }
  return out
}

export function earmarkComponents(g: Goal, positions: Position[], a: Assumptions, shockByPos?: Map<string, Decimal>): PoolComponent[] {
  const comps: PoolComponent[] = []
  for (const e of g.earmarks) {
    for (const p of positions.filter(p => p.holding_id === e.holding_id)) {
      const pct = D(e.pct)
      const shock = shockByPos?.get(`${p.holding_id}|${p.part ?? ''}`) ?? ZERO
      comps.push({ value: p.exposure.plus(shock).times(pct), r: rOf(p.asset_class, a) })
    }
  }
  return comps
}

export interface LongTermResult {
  years: number; L0: string; rL: string; inflation: string
  rows: { t: number; year: number; inflow: string; outflow: string; net: string; goal_spend: string; goal_from_L: string; L: string; pools: string; illiquid: string; debt: string; net_worth: string; deflator: string }[]
  goals: { goal_id: string; name: string; year_idx: number; amount: string }[]
  alerts: { code: 'long_term_shortfall'; level: 'RED'; t: number; year: number; goals: string[]; message: string }[]
  year1_net: string
}

export function longTerm(f: Family, instruments: Record<string, Instrument>, book: PriceBook, positions: Position[], goals: Goal[], a: Assumptions): LongTermResult {
  const active = goals.filter(g => g.status === 'active')
  const lastGoalYear = Math.max(0, ...active.flatMap(g => goalPayments(g, book.price_date).map(p => p.yearIdx)))
  const H = Math.min(30, Math.max(10, lastGoalYear))
  const lines = schedule(f, instruments, book, H * 12, a.inflation)
  const netByYear: Decimal[] = [], convByYear: Decimal[] = [], inByYear: Decimal[] = [], outByYear: Decimal[] = []
  for (let t = 1; t <= H; t++) {
    const ls = lines.filter(l => Math.ceil(l.k / 12) === t)
    inByYear.push(sum(ls.filter(l => l.direction === 'in').map(l => l.amount)))
    outByYear.push(sum(ls.filter(l => l.direction === 'out').map(l => l.amount)))
    netByYear.push(sum(ls.map(signed)))
    convByYear.push(sum(ls.filter(l => l.conversion).map(l => l.amount)))
  }
  const { L0, rL } = liquidL(positions, active, a)
  const flows: GoalFlow[] = active.map(g => {
    const pays = goalPayments(g, book.price_date)
    return {
      goal_id: g.id, name: g.name, spend: new Map(pays.map(p => [p.yearIdx, p.amount])),
      components: earmarkComponents(g, positions, a), contribution: D(g.annual_contribution),
      contribUntil: Math.max(0, pays[0].yearIdx - 1),
    }
  })
  const proj = projectL({ L0, rL, years: H, netByYear, conversionByYear: convByYear, goals: flows })
  // Tài sản kém thanh khoản và bảo hiểm (không dành riêng) tăng theo r của loại, không dùng để chi trả
  const nonLiquid = positions.filter(p => !LIQUID_FOR_L.has(p.asset_class)).map(p => ({ v: p.exposure.times(ONE.minus(earmarkPct(active, p.holding_id))), r: rOf(p.asset_class, a), illiquid: ILLIQUID.has(p.asset_class) }))
  // Dư nợ cuối mỗi năm theo lịch trả
  const debtEnd = (t: number) => {
    let total = ZERO
    for (const l of f.liabilities) {
      const eff = ownerShare(f, l.borrower.kind, l.borrower.id)
      const paid = sum(lines.filter(x => x.item_id === `AUTO-PRN-${l.id}` && x.k <= t * 12).map(x => x.amount))
      total = total.plus(D(l.balance).times(fxRate(book, l.currency)).times(eff).minus(paid))
    }
    return total
  }
  const g = D(a.inflation)
  const baseYear = Number(book.price_date.slice(0, 4))
  const rows = proj.map(p => {
    const il = sum(nonLiquid.map(x => x.v.times(ONE.plus(x.r).pow(p.t))))
    const debt = debtEnd(p.t)
    return {
      t: p.t, year: baseYear + p.t, inflow: vnd(inByYear[p.t - 1]), outflow: vnd(outByYear[p.t - 1]), net: vnd(p.net),
      goal_spend: vnd(p.goal_spend), goal_from_L: vnd(p.goal_from_L), L: vnd(p.L), pools: vnd(p.pools), illiquid: vnd(il), debt: vnd(debt),
      net_worth: vnd(p.L.plus(p.pools).plus(il).minus(debt)), deflator: s(ONE.plus(g).pow(p.t), 12),
    }
  })
  const alerts: LongTermResult['alerts'] = []
  const first = proj.find(p => p.L.isNegative())
  if (first) {
    const related = flows.filter(fl => [...fl.spend.keys()].some(y => y <= first.t)).map(fl => fl.goal_id)
    alerts.push({ code: 'long_term_shortfall', level: 'RED', t: first.t, year: baseYear + first.t, goals: related, message: `Tài sản thanh khoản tự do dự phóng âm lần đầu ở năm thứ ${first.t}` })
  }
  return {
    years: H, L0: vnd(L0), rL: s(rL, 8), inflation: a.inflation, rows,
    goals: active.flatMap(gl => goalPayments(gl, book.price_date).map(p => ({ goal_id: gl.id, name: gl.name, year_idx: p.yearIdx, amount: vnd(p.amount) }))),
    alerts, year1_net: vnd(netByYear[0] ?? ZERO),
  }
}

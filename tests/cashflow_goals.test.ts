// AC-23, AC-30, AC-31, AC-32: ví dụ tính tay Mục 6.5 (dòng tiền) và Mục 6.6 (mục tiêu, LT-1)
import { describe, expect, it } from 'vitest'
import { shortTerm, projectL, longTerm } from '../src/engine/cashflow'
import { goalCoverage, goalImpact } from '../src/engine/goals'
import { buildPositions, netWorth } from '../src/engine/positions'
import { computeFamilyImpact } from '../src/engine/apply'
import { D, ONE } from '../src/engine/dec'
import { DEFAULT_ASSUMPTIONS, DEFAULT_THRESHOLDS } from '../src/shared/catalog'
import type { Family, Goal } from '../src/shared/types'
import { book, exampleFamily, exampleView, instruments, unitCfg } from './fixtures'

function cfFamily(): Family {
  const f = exampleFamily()
  // Tiền đầu kỳ 4 tỷ: 1,2 tỷ USD qua pháp nhân + 2,8 tỷ VND
  f.holdings = f.holdings.filter(h => h.id !== 'H-VND')
  f.holdings.push({ id: 'H-VND', account_id: 'A3', instrument_id: 'CASH-VND', quantity: '2800000000' })
  const m = (id: string, label: string, category: string, direction: 'in' | 'out', amount: string, frequency: 'once' | 'monthly' | 'annual', start: string, expected = false) =>
    ({ id, label, category, direction, amount, currency: 'VND' as const, frequency, start, subject: { kind: 'member' as const, id: 'M1' }, origin: 'manual' as const, expected })
  f.cashflows = [
    m('CF-F01-0001', 'Cổ tức DMNGA (dự kiến)', 'dividend', 'in', '400000000', 'once', '2027-05-15', true),
    m('CF-F01-0002', 'Tiền thuê căn hộ', 'rent', 'in', '40000000', 'monthly', '2026-11-01'),
    m('CF-F01-0003', 'Phí bảo hiểm', 'insurance_premium', 'out', '200000000', 'annual', '2027-01-15'),
    m('CF-F01-0004', 'Chi sinh hoạt', 'living', 'out', '150000000', 'monthly', '2026-11-01'),
    m('CF-F01-0005', 'Gọi vốn cổ phần tư nhân', 'capital_call', 'out', '1000000000', 'once', '2027-03-10'),
  ]
  return f
}

describe('Mục 6.5 – dòng tiền 12 tháng', () => {
  const f = cfFamily()
  const pos = buildPositions(f, instruments, book)
  const r = shortTerm(f, instruments, book, pos, DEFAULT_ASSUMPTIONS.inflation, DEFAULT_THRESHOLDS.liquidity)
  it('AC-23: vào 1.330, ra 4.115,25, thuần −2.785,25 triệu', () => {
    expect(r.start_cash).toBe('4000000000')
    expect(r.totals.inflow).toBe('1330000000')
    expect(r.totals.outflow).toBe('4115250000')
    expect(r.totals.net).toBe('-2785250000')
    const interest = r.by_category.find(c => c.category === 'loan_interest')!
    expect(interest.total).toBe('515250000')
    expect(D(r.coverage!).toFixed(2)).toBe('1.44')
  })
  it('gọi vốn tháng thứ 5 gắn large_outflow, không có cash_shortfall', () => {
    const lo = r.alerts.filter(a => a.code === 'large_outflow')
    expect(lo).toHaveLength(1)
    expect(lo[0].k).toBe(5)
    expect(r.alerts.some(a => a.code === 'cash_shortfall')).toBe(false)
    expect(r.alerts.some(a => a.code === 'low_coverage')).toBe(false)
  })
  it('coupon DMBDA 2 lần × 225 triệu', () => {
    const c = r.items.filter(i => i.category === 'coupon')
    expect(c.map(i => i.amount)).toEqual(['225000000', '225000000'])
  })
})

function eduGoal(): Goal {
  return {
    id: 'GL-F01-01', family_id: 'DEMO-F01', name: 'Du học', type: 'education', year: 2030, month: 10,
    amount: '8000000000', currency: 'VND', basis: 'nominal', cost_growth: '0', spend: { kind: 'once' }, priority: 'essential',
    annual_contribution: '0', source_note: 'Ví dụ Mục 6.6', status: 'active',
    earmarks: [{ holding_id: 'H-QCP', pct: '1' }, { holding_id: 'H-BDA', pct: '0.4' }],
  }
}

describe('Mục 6.6 – mục tiêu du học', () => {
  const f = exampleFamily()
  const pos = buildPositions(f, instruments, book)
  const g = eduGoal()
  const t = DEFAULT_THRESHOLDS.goals
  it('AC-30: dự phóng 7.966.909.760, 99,59%, Theo dõi', () => {
    const c = goalCoverage(g, pos, [g], DEFAULT_ASSUMPTIONS, book.price_date, t)
    expect(c.n_years).toBe('4')
    expect(c.projected).toBe('7966909760')
    expect(D(c.ratio!).times(100).toFixed(2)).toBe('99.59')
    expect(c.level).toBe('WATCH')
  })
  it('AC-31: sau EV-2026-0002 còn 95,87% (7.669.562.429), giảm 3,72 điểm, không cảnh báo', () => {
    const imp = computeFamilyImpact(f.id, pos, netWorth(f, pos, book), exampleView(), unitCfg, DEFAULT_THRESHOLDS.alert)
    const gi = goalImpact(g, pos, [g], DEFAULT_ASSUMPTIONS, book.price_date, t, imp.positions)
    expect(gi.after.projected).toBe('7669562429')
    expect(D(gi.ratio_after!).times(100).toFixed(2)).toBe('95.87')
    expect(D(gi.delta_pts).toFixed(2)).toBe('-3.72')
    expect(gi.level_after).toBe('WATCH')
    expect(gi.alert).toBe(false)
  })
})

describe('Mục 6.6 – LT-1', () => {
  it('AC-32: L năm 1, 2, 3 = 10; 9,96; 9,258432 tỷ', () => {
    const B = (x: string) => D(x).times(1e9)
    const net = [1, 2, 3].map(t => B('0.5').minus(B('1').times(D('1.04').pow(t - 1))))
    const rows = projectL({
      L0: B('10'), rL: D('0.05'), years: 3, netByYear: net, conversionByYear: [],
      goals: [{ goal_id: 'G', name: 'G', spend: new Map([[3, B('3')]]), components: [{ value: B('2'), r: D('0.06') }], contribution: D(0), contribUntil: 0 }],
    })
    expect(rows.map(r => r.L.div(1e9).toFixed(6))).toEqual(['10.000000', '9.960000', '9.258432'])
    expect(rows[2].goal_from_L.div(1e9).toFixed(6)).toBe('0.617968')
  })
  it('năm 1 dài hạn khớp dòng tiền thuần ngắn hạn', () => {
    const f = cfFamily()
    const pos = buildPositions(f, instruments, book)
    const st = shortTerm(f, instruments, book, pos, DEFAULT_ASSUMPTIONS.inflation, DEFAULT_THRESHOLDS.liquidity)
    const lt = longTerm(f, instruments, book, pos, [eduGoal()], DEFAULT_ASSUMPTIONS)
    expect(lt.year1_net).toBe(st.totals.net)
    expect(lt.years).toBe(10)
    expect(D(lt.rows[1].deflator).toFixed(4)).toBe(ONE.plus('0.04').pow(2).toFixed(4))
  })
})

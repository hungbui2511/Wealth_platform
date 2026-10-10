// AC-21, AC-22: ví dụ tính tay Mục 6.5 (BR-19, BR-20)
import { describe, expect, it } from 'vitest'
import { holdingPnl, summarize } from '../src/engine/pnl'
import { book, exampleFamily, instruments } from './fixtures'
import type { Family } from '../src/shared/types'

function famWithTx(): Family {
  const f = exampleFamily()
  f.transactions = [
    { id: 'TX-F01-0001', holding_id: 'H-NGA', type: 'BUY', date: '2024-03-01', quantity: '300000', price: '20000', fee: '9000000', currency: 'VND', fx_rate: '1' },
    { id: 'TX-F01-0002', holding_id: 'H-NGA', type: 'BUY', date: '2024-09-01', quantity: '200000', price: '23000', fee: '6900000', currency: 'VND', fx_rate: '1' },
    { id: 'TX-F01-0003', holding_id: 'H-NGA', type: 'DIVIDEND_CASH', date: '2025-06-01', amount: '500000000', currency: 'VND', fx_rate: '1' },
    { id: 'TX-F01-0004', holding_id: 'H-NGA', type: 'SELL', date: '2026-02-01', quantity: '100000', price: '26000', fee: '2600000', tax: '2600000', currency: 'VND', fx_rate: '1' },
    { id: 'TX-F01-0005', holding_id: 'H-USD', type: 'BUY', date: '2025-01-10', quantity: '80000', price: '1', currency: 'USD', fx_rate: '24000' },
    { id: 'TX-F01-0006', holding_id: 'H-INT', type: 'BUY', date: '2025-02-10', quantity: '1000', price: '100', currency: 'USD', fx_rate: '24000' },
  ]
  f.accounts.push({ id: 'A4', custodian: 'Lưu ký nước ngoài Demo', currency: 'USD', owners: [{ kind: 'member', id: 'M1', pct: '1' }] })
  f.holdings.push({ id: 'H-INT', account_id: 'A4', instrument_id: 'DMINT', quantity: '1000' })
  return f
}

describe('Mục 6.5 – lãi/lỗ', () => {
  const rows = holdingPnl(famWithTx(), instruments, book)
  const r = (id: string) => rows.find(x => x.holding_id === id)!

  it('AC-21: chuỗi giao dịch DMNGA', () => {
    const n = r('H-NGA')
    expect(n.cost_vnd).toBe('8492720000')
    expect(n.realized_vnd).toBe('471620000')
    expect(n.unrealized_vnd).toBe('1507280000')
    expect((Number(n.unrealized_pct) * 100).toFixed(2)).toBe('17.75')
    expect(n.income_vnd).toBe('500000000')
    expect(n.total_vnd).toBe('2478900000')
  })

  it('AC-22: tách hiệu ứng giá và tỷ giá', () => {
    const i = r('H-INT')
    expect(i.price_effect_vnd).toBe('240000000')
    expect(i.fx_effect_vnd).toBe('110000000')
    expect(i.unrealized_vnd).toBe('350000000')
    const u = r('H-USD')
    expect(u.fx_effect_vnd).toBe('80000000')
    expect(u.eff_own).toBe('0.6')
    expect(summarize([u]).fx_effect).toBe('48000000')
  })

  it('FR-120: vị thế thiếu giao dịch mua bị loại khỏi tổng', () => {
    expect(r('H-BDA').insufficient_cost).toBe(true)
    expect(summarize(rows).excluded).toBe(2) // DMBDA, DMQCP
  })
})

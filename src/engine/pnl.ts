// Lãi/lỗ theo giá vốn bình quân gia quyền di động (BR-19) và tách hiệu ứng tỷ giá (BR-20).
import type { Family, Instrument, Transaction } from '../shared/types'
import { D, Decimal, ZERO, sum, vnd, s } from './dec'
import { accountEffOwn, priceKey, fxRate, type PriceBook } from './positions'

export interface HoldingPnl {
  holding_id: string; instrument_id: string; name: string; asset_class: string; currency: string; account_id: string
  eff_own: string; insufficient_cost: boolean
  quantity: string; cost_native: string; cost_vnd: string; avg_cost_native: string | null
  value_native: string; value_vnd: string
  realized_vnd: string; unrealized_vnd: string; income_vnd: string; total_vnd: string
  unrealized_pct: string | null
  price_effect_vnd: string | null; fx_effect_vnd: string | null
  price_source?: string; price_date?: string
}

interface Acc { qty: Decimal; costN: Decimal; costV: Decimal; realizedV: Decimal; incomeV: Decimal; hasBuy: boolean }

export function runLedger(txs: Transaction[]): Acc {
  const a: Acc = { qty: ZERO, costN: ZERO, costV: ZERO, realizedV: ZERO, incomeV: ZERO, hasBuy: false }
  const sorted = [...txs].sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id))
  for (const t of sorted) {
    const fx = D(t.fx_rate)
    const q = D(t.quantity), p = D(t.price), fee = D(t.fee), tax = D(t.tax), amt = D(t.amount)
    switch (t.type) {
      case 'BUY': {
        const costN = q.times(p).plus(fee)
        a.qty = a.qty.plus(q); a.costN = a.costN.plus(costN); a.costV = a.costV.plus(costN.times(fx)); a.hasBuy = true
        break
      }
      case 'SELL': {
        if (a.qty.isZero()) break
        const ratio = q.div(a.qty)
        const redN = a.costN.times(ratio), redV = a.costV.times(ratio)
        const proceedsN = q.times(p).minus(fee).minus(tax)
        a.realizedV = a.realizedV.plus(proceedsN.times(fx).minus(redV))
        a.qty = a.qty.minus(q); a.costN = a.costN.minus(redN); a.costV = a.costV.minus(redV)
        break
      }
      case 'DIVIDEND_STOCK': a.qty = a.qty.plus(q); break
      case 'CAPITAL_CALL': a.costN = a.costN.plus(amt); a.costV = a.costV.plus(amt.times(fx)); a.hasBuy = true; break
      case 'FEE': a.incomeV = a.incomeV.minus(amt.times(fx)); break
      case 'DIVIDEND_CASH': case 'COUPON': case 'RENT': case 'INTEREST': case 'DISTRIBUTION':
        a.incomeV = a.incomeV.plus(amt.minus(tax).times(fx)); break
    }
  }
  return a
}

export function holdingPnl(f: Family, instruments: Record<string, Instrument>, book: PriceBook): HoldingPnl[] {
  return f.holdings.map(h => {
    const inst = instruments[h.instrument_id]
    const txs = f.transactions.filter(t => t.holding_id === h.id)
    const a = runLedger(txs)
    const pp = book.points[priceKey(h)]
    const price = inst.price_source === 'FIXED' ? D(1) : pp ? D(pp.price) : null
    const valueN = price ? D(h.quantity).times(price) : ZERO
    const fxNow = fxRate(book, inst.currency)
    const valueV = valueN.times(fxNow)
    // Tiền gửi VND không có lãi/lỗ vốn; tiền gửi ngoại tệ không có giao dịch thì coi giá vốn = giá trị (chỉ có hiệu ứng tỷ giá khi có giao dịch)
    const isCash = inst.asset_class === 'CASH'
    const insufficient = !isCash && !a.hasBuy
    let costN = a.costN, costV = a.costV
    if (isCash && !a.hasBuy) { costN = valueN; costV = valueV }
    const unrealized = insufficient ? ZERO : valueV.minus(costV)
    const total = insufficient ? ZERO : a.realizedV.plus(unrealized).plus(a.incomeV)
    let priceEff: Decimal | null = null, fxEff: Decimal | null = null
    if (!insufficient && inst.currency !== 'VND' && costN.gt(0)) {
      const costFx = costV.div(costN)
      priceEff = valueN.minus(costN).times(costFx)
      fxEff = valueN.times(fxNow.minus(costFx))
    }
    return {
      holding_id: h.id, instrument_id: inst.id, name: inst.name, asset_class: inst.asset_class, currency: inst.currency,
      account_id: h.account_id, eff_own: s(accountEffOwn(f, h.account_id)), insufficient_cost: insufficient,
      quantity: s(D(h.quantity)), cost_native: s(costN, 4), cost_vnd: vnd(costV),
      avg_cost_native: a.qty.gt(0) && !insufficient ? s(costN.div(a.qty), 4) : null,
      value_native: s(valueN, 4), value_vnd: vnd(valueV),
      realized_vnd: vnd(insufficient ? ZERO : a.realizedV), unrealized_vnd: vnd(unrealized), income_vnd: vnd(insufficient ? ZERO : a.incomeV),
      total_vnd: vnd(total), unrealized_pct: !insufficient && costV.gt(0) ? s(unrealized.div(costV), 8) : null,
      price_effect_vnd: priceEff ? vnd(priceEff) : null, fx_effect_vnd: fxEff ? vnd(fxEff) : null,
      price_source: pp?.source, price_date: pp?.date,
    }
  })
}

export interface PnlSummary { realized: string; unrealized: string; income: string; total: string; price_effect: string; fx_effect: string; excluded: number }

// Tổng hợp theo tỷ lệ sở hữu hiệu dụng (FR-117)
export function aggregatePnl(rows: HoldingPnl[], key: (r: HoldingPnl) => string): Record<string, PnlSummary> {
  const groups: Record<string, HoldingPnl[]> = {}
  for (const r of rows) (groups[key(r)] ??= []).push(r)
  return Object.fromEntries(Object.entries(groups).map(([k, rs]) => [k, summarize(rs)]))
}

export function summarize(rows: HoldingPnl[]): PnlSummary {
  const ok = rows.filter(r => !r.insufficient_cost)
  const w = (f: (r: HoldingPnl) => string | null) => sum(ok.map(r => D(f(r) ?? 0).times(D(r.eff_own))))
  return {
    realized: vnd(w(r => r.realized_vnd)), unrealized: vnd(w(r => r.unrealized_vnd)), income: vnd(w(r => r.income_vnd)),
    total: vnd(w(r => r.total_vnd)), price_effect: vnd(w(r => r.price_effect_vnd)), fx_effect: vnd(w(r => r.fx_effect_vnd)),
    excluded: rows.length - ok.length,
  }
}

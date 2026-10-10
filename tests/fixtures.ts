// Bộ dữ liệu riêng của các ví dụ tính tay (Mục 6.2, 6.5, 6.6)
import type { Family, Instrument, ViewBody, ImpactLine } from '../src/shared/types'
import { ASSET_CLASSES } from '../src/shared/catalog'
import type { PriceBook } from '../src/engine/positions'
import { DEFAULT_UNIT_TABLE } from '../src/shared/catalog'

export const PRICE_DATE = '2026-10-09'

export const instruments: Record<string, Instrument> = {
  DMNGA: { id: 'DMNGA', name: 'Ngân hàng Demo NGA', asset_class: 'EQ_VN', sector: 'BANK', currency: 'VND', listed: true, price_source: 'TCBS_STOCK' },
  DMBDA: { id: 'DMBDA', name: 'Trái phiếu BĐS Demo A', asset_class: 'CORP_BOND', sector: 'REAL_ESTATE', currency: 'VND', listed: true, price_source: 'TCBS_BOND', bond: { par: '100000', coupon_rate: '0.09', freq: 2, maturity: '2029-03-15' } },
  DMQCP: { id: 'DMQCP', name: 'Quỹ cổ phiếu Demo QCP', asset_class: 'FUND', currency: 'VND', listed: false, price_source: 'SAMPLE', allocations: [
    { asset_class: 'EQ_VN', sector: 'BANK', weight: '0.5' }, { asset_class: 'EQ_VN', sector: 'REAL_ESTATE', weight: '0.5' }] },
  'CASH-USD': { id: 'CASH-USD', name: 'Tiền gửi USD', asset_class: 'CASH', currency: 'USD', listed: false, price_source: 'FIXED' },
  'CASH-VND': { id: 'CASH-VND', name: 'Tiền gửi VND', asset_class: 'CASH', currency: 'VND', listed: false, price_source: 'FIXED' },
  DMINT: { id: 'DMINT', name: 'Cổ phiếu quốc tế Demo', asset_class: 'EQ_INTL', currency: 'USD', listed: true, price_source: 'SAMPLE' },
}

const pp = (key: string, price: string, currency: 'VND' | 'USD' = 'VND') => ({ key, date: PRICE_DATE, price, currency, source: 'Mẫu', fetched_at: '2026-10-09T10:00:00Z', flag: 'sample' as const })

export const book: PriceBook = {
  price_date: PRICE_DATE,
  points: { DMNGA: pp('DMNGA', '25000'), DMBDA: pp('DMBDA', '100000'), DMQCP: pp('DMQCP', '20000'), DMINT: pp('DMINT', '110', 'USD') },
  fx: { USD: '25000', SGD: '18500', AUD: '16500' },
}

// Gia đình của ví dụ Mục 6.2: tài sản ròng 50 tỷ
export function exampleFamily(): Family {
  return {
    id: 'DEMO-F01', name: 'Gia đình ví dụ', rm_id: 'RM1', persona: 'P1', currency: 'VND',
    members: [{ id: 'M1', name: 'A', generation: 1, role: 'Chủ hộ' }, { id: 'M2', name: 'B', generation: 2, role: 'Con' }],
    entities: [{ id: 'E1', name: 'Holding Demo', type: 'holding' }],
    ownerships: [{ entity_id: 'E1', member_id: 'M1', pct: '0.6' }],
    accounts: [
      { id: 'A1', custodian: 'Ngân hàng Demo A', currency: 'VND', owners: [{ kind: 'member', id: 'M1', pct: '1' }] },
      { id: 'A2', custodian: 'Ngân hàng Demo A', currency: 'USD', owners: [{ kind: 'entity', id: 'E1', pct: '1' }] },
      { id: 'A3', custodian: 'Ngân hàng Demo B', currency: 'VND', owners: [{ kind: 'member', id: 'M1', pct: '1' }] },
    ],
    holdings: [
      { id: 'H-NGA', account_id: 'A1', instrument_id: 'DMNGA', quantity: '400000' },
      { id: 'H-BDA', account_id: 'A1', instrument_id: 'DMBDA', quantity: '50000' },
      { id: 'H-QCP', account_id: 'A1', instrument_id: 'DMQCP', quantity: '200000' },
      { id: 'H-USD', account_id: 'A2', instrument_id: 'CASH-USD', quantity: '80000' },
      // Phần còn lại để tài sản ròng đúng 50 tỷ: tiền VND 41 tỷ − nợ 6 tỷ... (ví dụ chỉ cần tổng)
      { id: 'H-VND', account_id: 'A3', instrument_id: 'CASH-VND', quantity: '35800000000' },
    ],
    liabilities: [{ id: 'L1', name: 'Vay thế chấp', borrower: { kind: 'member', id: 'M1' }, balance: '6000000000', currency: 'VND', rate: '0.09', rate_type: 'fixed', repayment: 'amortizing', principal_per_month: '50000000', maturity: '2036-10-31' }],
    transactions: [], cashflows: [],
  }
}

function line(scope: ImpactLine['scope'], target: string, level: number, asset_class?: string): ImpactLine {
  const direction = level > 0 ? 'positive' : level < 0 ? 'negative' : 'neutral'
  return { scope, asset_class: asset_class as never, target, level, direction, rationale: 'Lập luận ví dụ đủ hai mươi ký tự', source_ids: level !== 0 ? ['NW-0004'] : [], ...(level !== 0 ? { horizon: '1-3 tháng', confidence: 'medium' } : {}) }
}

export function exampleView(): ViewBody {
  const levels: Record<string, number> = { EQ_VN: -1, CORP_BOND: -1 }
  return {
    event_id: 'EV-2026-0002', view_id: 'VW-0002-v1', event_type: 'sector_regulation', summary: 'Ví dụ Mục 6.2',
    impacts: [
      ...ASSET_CLASSES.map(ac => line('asset_class', ac, levels[ac] ?? 0, ac)),
      line('sector', 'REAL_ESTATE', -3, 'EQ_VN'),
      line('fx', 'USD', 1), line('fx', 'SGD', 0), line('fx', 'AUD', 0),
    ],
  }
}

export const unitCfg = DEFAULT_UNIT_TABLE

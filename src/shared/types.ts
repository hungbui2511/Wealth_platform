// Thực thể dữ liệu (BRD Mục 7.2). Số tiền và tỷ lệ lưu dạng chuỗi thập phân để giữ chính xác.
import type { AssetClass, Currency, PolicyTopic, Sector } from './catalog'

export type Dec = string

export interface Member { id: string; name: string; generation: 1 | 2 | 3; role: string }
export interface Entity { id: string; name: string; type: string }
export interface EntityOwnership { entity_id: string; member_id: string; pct: Dec }
export interface Owner { kind: 'member' | 'entity'; id: string; pct: Dec }
export interface Account { id: string; custodian: string; currency: Currency; owners: Owner[] }

export interface PropertyDetail {
  type: 'apartment' | 'townhouse' | 'villa' | 'residential_land' | 'commercial'
  project: string; building?: string; floor?: number; unit?: string
  area_m2: Dec; bedrooms?: number; supported: boolean
  purchase_price: Dec; capitalized_costs: Dec
}

export interface Holding {
  id: string; account_id: string; instrument_id: string; quantity: Dec
  // Khóa giá riêng cho tài sản định giá theo từng vị thế (bất động sản, cổ phần tư nhân, bảo hiểm)
  price_key?: string
  property?: PropertyDetail
  deposit?: { rate: Dec; start: string; maturity: string }
  // Giá nhập tay kèm ngày định giá (bất động sản không được hỗ trợ, cổ phần tư nhân, bảo hiểm)
  manual?: { price: Dec; valuation_date: string }
}

export interface Liability {
  id: string; name: string; borrower: { kind: 'member' | 'entity'; id: string }
  balance: Dec; currency: Currency; rate: Dec; rate_type: 'fixed' | 'floating'
  repayment: 'amortizing' | 'bullet'; principal_per_month: Dec; maturity: string; collateral?: string
}

export type TxType = 'BUY' | 'SELL' | 'DIVIDEND_CASH' | 'DIVIDEND_STOCK' | 'COUPON' | 'RENT' | 'INTEREST' | 'FEE' | 'CAPITAL_CALL' | 'DISTRIBUTION'
export interface Transaction {
  id: string; holding_id: string; type: TxType; date: string
  quantity?: Dec; price?: Dec; amount?: Dec; fee?: Dec; tax?: Dec
  currency: Currency; fx_rate: Dec
}

export type Frequency = 'once' | 'monthly' | 'quarterly' | 'annual'
export interface CashflowItem {
  id: string; label: string; category: string
  subject: { kind: 'member' | 'entity' | 'account'; id: string }
  direction: 'in' | 'out'; amount: Dec; currency: Currency; frequency: Frequency
  start: string; end?: string; growth?: Dec; link?: string
  origin: 'auto' | 'manual'; expected: boolean
}

export interface Family {
  id: string; name: string; rm_id: string; persona: 'P1' | 'P2' | 'P3' | 'P4'; currency: 'VND'
  members: Member[]; entities: Entity[]; ownerships: EntityOwnership[]
  accounts: Account[]; holdings: Holding[]; liabilities: Liability[]
  transactions: Transaction[]; cashflows: CashflowItem[]
}

export interface FundAllocation { asset_class: AssetClass; sector?: Sector; weight: Dec; tenor?: 'short' | 'long' }
export interface Instrument {
  id: string; name: string; asset_class: AssetClass; sector?: Sector; currency: Currency
  listed: boolean; price_source: 'TCBS_STOCK' | 'TCBS_BOND' | 'ONEMOUNT' | 'SAMPLE' | 'MANUAL' | 'FIXED'
  market_symbol?: string
  bond?: { par: Dec; coupon_rate: Dec; freq: number; maturity: string }
  allocations?: FundAllocation[]
  issuer?: string
}

export type PriceFlag = 'primary' | 'fallback' | 'sample' | 'manual'
export interface PricePoint {
  key: string; date: string; price: Dec; currency: Currency
  source: string; source_ref?: string; fetched_at: string; flag: PriceFlag
  range?: [Dec, Dec]; valuation_date?: string
}
export interface PriceSnapshot { id: string; price_date: string; points: PricePoint[]; fx: Record<string, Dec>; hash: string; missing: string[]; fallbacks: string[] }

export interface Goal {
  id: string; family_id: string; name: string
  type: 'education' | 'retirement' | 'purchase' | 'succession' | 'charity' | 'other'
  beneficiary?: string; year: number; month: number; amount: Dec; currency: Currency
  basis: 'nominal' | 'today'; cost_growth: Dec
  spend: { kind: 'once' } | { kind: 'multi'; years: number }
  priority: 'essential' | 'important' | 'aspirational'
  annual_contribution: Dec; source_note: string; status: 'active' | 'closed'
  earmarks: { holding_id: string; pct: Dec }[]
}

// Nhận định (Mục 7.3)
export type Scope = 'asset_class' | 'sector' | 'instrument' | 'fx'
export interface ImpactLine {
  scope: Scope; asset_class?: AssetClass; target: string; level: number
  direction: 'positive' | 'negative' | 'neutral' | 'insufficient_evidence'
  horizon?: '<1 tháng' | '1-3 tháng' | '3-6 tháng' | '>6 tháng'
  confidence?: 'low' | 'medium' | 'high'
  rationale: string; source_ids: string[]
  cio_judgment?: boolean; cio_note?: string
}
export interface ScenarioBranch { id: string; name: string; probability: number; regime: 'calm' | 'stress'; core_shocks: { factor: string; size: 'S' | 'M' | 'L'; direction: 'up' | 'down' }[]; rationale: string; source_ids: string[] }
export interface ScenarioSetBody { priced_in: 'none' | 'partial' | 'full'; branches: ScenarioBranch[]; notes?: string }
export interface ViewBody { event_id: string; view_id: string; event_type: string; summary: string; impacts: ImpactLine[]; scenarios?: ScenarioSetBody }

export interface Finding {
  finding_id: string; stage: 'pre_approval' | 're_challenge' | 'post_check'; origin: 'rule' | 'llm'
  check: string; severity: 'critical' | 'medium' | 'low'; target: string
  issue: string; suggestion: string; source_ids?: string[]
  value?: string; threshold?: string
}

export interface PolicyChange {
  change_id: string; article_refs: string[]; quote: string; summary: string
  topics: PolicyTopic[]; affected_parties: string; effective_from?: string; certainty: 'draft' | 'final'
}

export interface UnitConfig { u: Record<string, Dec>; u_fx: Record<string, Dec> }

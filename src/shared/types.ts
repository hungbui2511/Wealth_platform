// Thực thể dữ liệu (BRD Mục 7.2). Số tiền và tỷ lệ lưu dạng chuỗi thập phân để giữ chính xác.
import type { AssetClass, Currency, PolicyTopic, Sector } from './catalog'

export type Dec = string

// Trường cấu trúc liên thế hệ (đợt 4 sau phản biện độc lập): đều tuỳ chọn để dữ liệu cũ vẫn hợp lệ
export interface Member {
  id: string; name: string; generation: 1 | 2 | 3; role: string
  birth_year?: number
  tax_residency?: string   // mã quốc gia cư trú thuế, ví dụ 'VN', 'SG', 'US'
  nationality?: string[]
  marital_status?: 'single' | 'married' | 'divorced' | 'widowed'
  spouse_id?: string; parent_ids?: string[]
  has_will?: boolean
}
export interface Entity { id: string; name: string; type: string; jurisdiction?: string; legal_form?: 'llc' | 'jsc' | 'trust' | 'foundation' | 'holdco_offshore' | 'other' }
// Sở hữu pháp nhân: chủ sở hữu là thành viên (member_id) hoặc pháp nhân khác (owner_entity_id) để mô tả nhiều tầng
export interface EntityOwnership { entity_id: string; member_id?: string; owner_entity_id?: string; pct: Dec }
export interface Owner { kind: 'member' | 'entity'; id: string; pct: Dec }
export interface Account { id: string; custodian: string; currency: Currency; owners: Owner[]; legal_layer?: 'personal' | 'joint' | 'entity' | 'trust' | 'nominee' }

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
  // Cam kết góp vốn còn lại (quỹ tư nhân): số tiền và lịch gọi vốn dự kiến
  commitment?: { total: Dec; called: Dec; currency: Currency; schedule?: { date: string; amount: Dec }[] }
  // Người thụ hưởng chỉ định (bảo hiểm, tài khoản có chỉ định)
  beneficiaries?: { member_id: string; pct: Dec }[]
  // Tài sản riêng của người đứng tên (có trước hôn nhân, được thừa kế, tặng riêng): không vào khối tài sản chung vợ chồng
  separate_property?: boolean
}

export interface Liability {
  id: string; name: string; borrower: { kind: 'member' | 'entity'; id: string }
  balance: Dec; currency: Currency; rate: Dec; rate_type: 'fixed' | 'floating'
  repayment: 'amortizing' | 'bullet'; principal_per_month: Dec; maturity: string; collateral?: string
  // Cầm cố tài sản: tỷ lệ dư nợ/tài sản bảo đảm tối đa và ngưỡng gọi ký quỹ, danh sách vị thế bảo đảm
  ltv_max?: Dec; margin_call_ltv?: Dec; collateral_holdings?: string[]
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

// external_ai: giá do Claude tự lấy từ nguồn công khai, chưa phải nguồn chính thức có thỏa thuận dữ liệu
export type PriceFlag = 'primary' | 'fallback' | 'sample' | 'manual' | 'external_ai'
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
  // Mục tiêu có dòng tiền ra nước ngoài (du học, định cư, đầu tư nước ngoài…): dùng cho nhánh tác động thủ tục, không dùng dữ liệu chống rửa tiền
  cross_border?: { purpose: CrossBorderPurpose; country?: string }
}
export type CrossBorderPurpose = 'study' | 'emigration' | 'overseas_invest' | 'overseas_property' | 'family_support' | 'other'
// Ghi chú quy định (nhánh tác động lên mục tiêu): Pháp chế/Nghiên cứu soạn, Tuân thủ cho phát hành; máy chỉ khớp theo mục tiêu của gia đình
export interface ProceduralNote {
  regulation: string; status: 'draft' | 'issued' | 'effective'; effective_date?: string
  applies_to: CrossBorderPurpose[]; lead_time_weeks: number; documents: string[]
  client_message: string; rm_talking_points: string
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

// Một nhận định của Agent Chính sách: gắn nhãn căn cứ (dẫn điều khoản hoặc trích nguyên văn có trong văn bản)
// hoặc suy luận (bắt buộc nêu lập luận), kèm mức tin cậy. Cao: hệ quả trực tiếp của câu chữ; vừa: phụ thuộc giả định
// hoặc còn cách hiểu khác; thấp: dự báo hành vi tương lai hoặc phụ thuộc dữ liệu chưa có.
export interface PolicyClaim {
  text: string; basis: 'evidence' | 'inference'; confidence: 'high' | 'medium' | 'low'
  reasoning?: string; evidence?: { article_ref?: string; quote?: string }
}

// Năm câu hỏi cho mỗi thay đổi (theo phương pháp phân tích tác động VBPL): thay đổi gì nằm ở before + summary + quote
export interface PolicyChangeAnalysis {
  why: PolicyClaim             // vì sao cơ quan ban hành thay đổi
  goal: PolicyClaim            // cơ quan muốn hành vi nào thay đổi
  next_signal: PolicyClaim     // tín hiệu, bước tiếp theo nên theo dõi
  private_impact: PolicyClaim  // hàm ý cho khách Private (theo nhóm khách, không theo gia đình cụ thể)
  second_order?: PolicyClaim   // tác động bậc hai: thị trường, giá, hành vi của các bên khác
  opportunity?: PolicyClaim    // cơ hội tư vấn hoặc sản phẩm
}

export interface PolicyChange {
  change_id: string; article_refs: string[]; quote: string; summary: string
  topics: PolicyTopic[]; affected_parties: string; effective_from?: string; certainty: 'draft' | 'final'
  before?: string                               // quy định trước đây, để đặt cũ và mới cạnh nhau
  materiality?: 'high' | 'medium' | 'low'       // mức trọng yếu với khách Private
  analysis?: PolicyChangeAnalysis
}

// Phân tích trọng yếu đối với khách Private: phần đầu của tóm tắt, đọc trong một màn hình
export interface PolicyPrivateBrief {
  headline: string
  key_findings: (PolicyClaim & { title: string; change_ids: string[] })[]
  segments: { segment: string; why: string; change_ids: string[] }[]
  milestones: { date: string; label: string; article_ref?: string }[]
  open_questions: { issue: string; reading_1: string; reading_2: string; consequence: string }[]
  advisor_message: string
}

export interface UnitConfig { u: Record<string, Dec>; u_fx: Record<string, Dec> }

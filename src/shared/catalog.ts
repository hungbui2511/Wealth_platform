// Danh mục cố định (BRD Mục 7.1). Giá trị khởi tạo chỉ để minh họa; CIO cấu hình lại.

export const ASSET_CLASSES = [
  'CASH', 'GOV_BOND', 'CORP_BOND', 'EQ_VN', 'EQ_INTL', 'FUND',
  'GOLD', 'REAL_ESTATE', 'PRIVATE_EQ', 'CRYPTO', 'INSURANCE',
] as const
export type AssetClass = (typeof ASSET_CLASSES)[number]

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  CASH: 'Tiền gửi và tương đương tiền',
  GOV_BOND: 'Trái phiếu Chính phủ',
  CORP_BOND: 'Trái phiếu doanh nghiệp',
  EQ_VN: 'Cổ phiếu niêm yết Việt Nam',
  EQ_INTL: 'Cổ phiếu quốc tế',
  FUND: 'Chứng chỉ quỹ',
  GOLD: 'Vàng',
  REAL_ESTATE: 'Bất động sản',
  PRIVATE_EQ: 'Cổ phần tư nhân',
  CRYPTO: 'Tài sản mã hóa',
  INSURANCE: 'Bảo hiểm tích lũy',
}

export const ILLIQUID: ReadonlySet<AssetClass> = new Set<AssetClass>(['REAL_ESTATE', 'PRIVATE_EQ'])

// Tài sản thanh khoản tự do L (BR-23)
export const LIQUID_FOR_L: ReadonlySet<AssetClass> = new Set<AssetClass>([
  'CASH', 'GOV_BOND', 'CORP_BOND', 'EQ_VN', 'EQ_INTL', 'FUND', 'GOLD', 'CRYPTO',
])

export const FX_CURRENCIES = ['USD', 'SGD', 'AUD'] as const
export type FxCurrency = (typeof FX_CURRENCIES)[number]
export type Currency = 'VND' | FxCurrency

export const SECTORS = [
  'BANK', 'REAL_ESTATE', 'SECURITIES', 'STEEL_MATERIALS', 'RETAIL', 'TECH',
  'ENERGY', 'CONSUMER', 'INDUSTRIAL', 'UTILITIES', 'OTHER',
] as const
export type Sector = (typeof SECTORS)[number]

export const SECTOR_LABELS: Record<Sector, string> = {
  BANK: 'Ngân hàng', REAL_ESTATE: 'Bất động sản', SECURITIES: 'Chứng khoán',
  STEEL_MATERIALS: 'Thép và vật liệu', RETAIL: 'Bán lẻ', TECH: 'Công nghệ',
  ENERGY: 'Năng lượng', CONSUMER: 'Tiêu dùng', INDUSTRIAL: 'Công nghiệp',
  UTILITIES: 'Tiện ích', OTHER: 'Khác',
}

export const EVENT_TYPES = [
  'monetary_policy', 'fiscal_tax', 'sector_regulation', 'corporate', 'global_macro',
  'commodity', 'fx', 'geopolitical', 'policy',
] as const
export type EventType = (typeof EVENT_TYPES)[number]
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  monetary_policy: 'Chính sách tiền tệ', fiscal_tax: 'Tài khóa và thuế',
  sector_regulation: 'Quy định ngành', corporate: 'Doanh nghiệp', global_macro: 'Vĩ mô quốc tế',
  commodity: 'Hàng hóa', fx: 'Tỷ giá', geopolitical: 'Địa chính trị', policy: 'Văn bản chính sách',
}

export const POLICY_TOPICS = [
  'TAX_SECURITIES', 'PROPERTY_LAND', 'INHERITANCE_GIFT', 'CORPORATE_HOLDING', 'FX_OFFSHORE',
  'GOLD', 'DIGITAL_ASSET', 'CREDIT', 'INSURANCE',
] as const
export type PolicyTopic = (typeof POLICY_TOPICS)[number]
export const POLICY_TOPIC_LABELS: Record<PolicyTopic, string> = {
  TAX_SECURITIES: 'Thuế chứng khoán, thu nhập từ vốn',
  PROPERTY_LAND: 'Thuế, đất đai, bất động sản',
  INHERITANCE_GIFT: 'Thừa kế, tặng cho',
  CORPORATE_HOLDING: 'Doanh nghiệp, công ty holding',
  FX_OFFSHORE: 'Ngoại hối, đầu tư ra nước ngoài',
  GOLD: 'Vàng',
  DIGITAL_ASSET: 'Tài sản mã hóa',
  CREDIT: 'Tín dụng, vay',
  INSURANCE: 'Bảo hiểm',
}

// Cấu hình CIO khởi tạo (BR-07, BR-12, BR-17, BR-18, BR-23, BR-24, FR-904)
export const DEFAULT_UNIT_TABLE = {
  u: {
    CASH: '0', GOV_BOND_SHORT: '0.003', GOV_BOND_LONG: '0.008', CORP_BOND: '0.01', EQ_VN: '0.025',
    EQ_INTL: '0.02', FUND: '0.015', GOLD: '0.02', REAL_ESTATE: '0.015', PRIVATE_EQ: '0.02',
    CRYPTO: '0.05', INSURANCE: '0.003',
  } as Record<string, string>,
  u_fx: { USD: '0.01', SGD: '0.01', AUD: '0.015' } as Record<string, string>,
}

export const DEFAULT_THRESHOLDS = {
  alert: {
    red_pct: '-0.02', red_abs: '-5000000000',
    yellow_pct: '-0.005', yellow_abs: '-1000000000',
    positive_pct: '0.005', positive_abs: '1000000000',
  },
  postcheck: {
    stale_months: 12, outlier_z: '2.5', outlier_min_families: 10,
    concentration_pct: '0.25', fallback_max_sessions: 5,
  },
  liquidity: { large_outflow_pct: '0.2', coverage_min: '1' },
  goals: { on_track: '1', watch: '0.8', drop_alert_pts: '5' },
}

export const DEFAULT_ASSUMPTIONS = {
  inflation: '0.04',
  r: {
    CASH: '0.04', GOV_BOND: '0.05', CORP_BOND: '0.06', EQ_VN: '0.08', EQ_INTL: '0.07', FUND: '0.06',
    GOLD: '0.04', REAL_ESTATE: '0.05', PRIVATE_EQ: '0.10', CRYPTO: '0', INSURANCE: '0.03',
  } as Record<AssetClass, string>,
}

export const DEFAULT_BANNED_PHRASES = [
  'nên mua', 'nên bán', 'khuyến nghị mua', 'khuyến nghị bán', 'mua vào ngay', 'bán ra ngay',
  'chốt lời', 'cắt lỗ', 'gia tăng tỷ trọng', 'giảm tỷ trọng', 'thời điểm vàng để', 'cam kết lợi nhuận',
  'chắc chắn tăng', 'chắc chắn giảm',
]

export const VIEW_STATUS_LABELS: Record<string, string> = {
  DRAFTING: 'Đang lập', AGENT_ERROR: 'Lỗi agent', PENDING_CHALLENGE: 'Chờ phản biện',
  PENDING_APPROVAL: 'Chờ duyệt', APPROVED: 'Đã duyệt', REWORK_REQUESTED: 'Yêu cầu làm lại',
  REJECTED: 'Bị bác', SUPERSEDED: 'Đã thay thế', WITHDRAWN: 'Đã thu hồi',
}

export const RUN_STATUS_LABELS: Record<string, string> = {
  COMPUTING: 'Đang tính', FAILED: 'Lỗi', POST_CHECKING: 'Đang hậu kiểm',
  NEEDS_CIO_REVIEW: 'Chờ CIO xem', EFFECTIVE: 'Đang hiệu lực', SUPERSEDED: 'Đã thay thế',
  WITHDRAWN: 'Đã thu hồi',
}

// 1.1.0: thêm cú sốc nhảy bậc tín dụng BĐS ở nhánh căng thẳng và dải căng thẳng lịch sử; lần áp dụng cũ tính lại theo đúng phiên bản của nó
export const ENGINE_VERSION = 'engine-1.1.0'
export const DISCLAIMER_SHOCK = 'Cú sốc giá tức thời giả định theo cấu hình minh họa. Không theo thời gian, không phải dự báo'

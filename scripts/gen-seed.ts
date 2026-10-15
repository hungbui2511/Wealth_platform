// Sinh dữ liệu giả lập xác định (BRD Mục 7.4). Chạy: npm run seed:gen
// Mọi tên người, doanh nghiệp, mã công cụ, tổ chức lưu ký, cơ quan và chỉ số đều hư cấu (BR-16).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PUBLIC_DOMAINS } from '../src/news/sources'
import type { Account, CashflowItem, Family, Goal, Holding, Instrument, Liability, Member, Entity, EntityOwnership, Transaction, PropertyDetail } from '../src/shared/types'

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..')
const out = (rel: string, data: unknown) => {
  const p = join(ROOT, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n')
}

export const PRICE_DATE = '2026-10-09'
let seed = 20261009
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }

// ---------- Phiên giao dịch ----------
function sessions(end: string, n: number): string[] {
  const out: string[] = []
  const d = new Date(end + 'T00:00:00Z')
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const SESSIONS = sessions(PRICE_DATE, 60)

function walk(target: number, vol: number, decimals = 0): { date: string; value: number }[] {
  const vals: number[] = [target]
  for (let i = 1; i < SESSIONS.length; i++) vals.unshift(vals[0] / (1 + (rnd() - 0.5) * 2 * vol))
  const k = Math.pow(10, decimals)
  return SESSIONS.map((date, i) => ({ date, value: i === SESSIONS.length - 1 ? target : Math.round(vals[i] * k) / k }))
}

// ---------- Công cụ ----------
const I: Record<string, Instrument> = {}
const eq = (id: string, name: string, sector: Instrument['sector'], price: number, issuer?: string) => { I[id] = { id, name, asset_class: 'EQ_VN', sector, currency: 'VND', listed: true, price_source: 'TCBS_STOCK', ...(issuer ? { issuer } : {}) }; PRICES[id] = price }
const PRICES: Record<string, number> = {}
// Mã chứng khoán, chứng chỉ quỹ, trái phiếu là mã thật đang lưu hành; GIÁ là giá mẫu gần mặt bằng thị trường, không phải giá thật.
// Trái phiếu doanh nghiệp lấy điều khoản theo tin công bố (lãi suất, ngày đáo hạn, mệnh giá); kỳ trả lãi là giả định.
eq('MBB', 'Ngân hàng TMCP Quân đội (MB)', 'BANK', 25000)
eq('VPB', 'Ngân hàng TMCP Việt Nam Thịnh Vượng (VPBank)', 'BANK', 32000)
eq('SHB', 'Ngân hàng TMCP Sài Gòn – Hà Nội (SHB)', 'BANK', 18500)
eq('NLG', 'CTCP Đầu tư Nam Long', 'REAL_ESTATE', 41000)
eq('DXG', 'CTCP Tập đoàn Đất Xanh', 'REAL_ESTATE', 15200)
eq('KDH', 'CTCP Đầu tư và Kinh doanh Nhà Khang Điền', 'REAL_ESTATE', 28000)
eq('SSI', 'CTCP Chứng khoán SSI', 'SECURITIES', 22000)
eq('HPG', 'CTCP Tập đoàn Hòa Phát', 'STEEL_MATERIALS', 27000)
eq('MWG', 'CTCP Đầu tư Thế Giới Di Động', 'RETAIL', 60000)
eq('FPT', 'CTCP FPT', 'TECH', 95000)
eq('PLX', 'Tập đoàn Xăng dầu Việt Nam (Petrolimex)', 'ENERGY', 35000)
eq('VNM', 'CTCP Sữa Việt Nam (Vinamilk)', 'CONSUMER', 70000)
eq('GMD', 'CTCP Gemadept', 'INDUSTRIAL', 45000)
eq('NT2', 'CTCP Điện lực Dầu khí Nhơn Trạch 2', 'UTILITIES', 22000)
// Mã duy nhất còn hư cấu: dùng cho kịch bản danh sách hạn chế, để không ngụ ý ngân hàng có thông tin nội bộ về một doanh nghiệp thật
eq('DMXYZ', 'Công ty Demo X (hư cấu, kịch bản danh sách hạn chế)', 'INDUSTRIAL', 12000, 'Công ty Demo X')
const bond = (id: string, name: string, ac: 'CORP_BOND' | 'GOV_BOND', sector: Instrument['sector'] | undefined, rate: string, freq: number, maturity: string, par: number, price: number) => {
  I[id] = { id, name, asset_class: ac, ...(sector ? { sector } : {}), currency: 'VND', listed: true, price_source: 'TCBS_BOND', bond: { par: String(par), coupon_rate: rate, freq, maturity } }; PRICES[id] = price
}
bond('VHM12613', 'Trái phiếu Vinhomes VHM12613 (12,5%/năm, đáo hạn 10/07/2029)', 'CORP_BOND', 'REAL_ESTATE', '0.125', 2, '2029-07-10', 100000000, 100000000)
bond('VIB12508', 'Trái phiếu VIB VIB12508 (6,9%/năm, đáo hạn 05/12/2028)', 'CORP_BOND', 'BANK', '0.069', 1, '2028-12-05', 1000000000, 1010000000)
bond('VIC12510', 'Trái phiếu Vingroup VIC12510 (11%/năm, đáo hạn 30/09/2027)', 'CORP_BOND', 'INDUSTRIAL', '0.11', 1, '2027-09-30', 100000000, 99500000)
bond('TPCP5N', 'Trái phiếu Chính phủ kỳ hạn 5 năm (đấu thầu qua HNX)', 'GOV_BOND', undefined, '0.045', 1, '2028-09-30', 100000, 102000)
bond('TPCP10N', 'Trái phiếu Chính phủ kỳ hạn 10 năm (đấu thầu qua HNX)', 'GOV_BOND', undefined, '0.052', 1, '2033-09-30', 100000, 105000)
const fund = (id: string, name: string, nav: number, allocations?: Instrument['allocations']) => { I[id] = { id, name, asset_class: 'FUND', currency: 'VND', listed: false, price_source: 'SAMPLE', ...(allocations ? { allocations } : {}) }; PRICES[id] = nav }
// Bảng phân bổ của quỹ là phân bổ mẫu để nhìn xuyên quỹ, không phải danh mục công bố của quỹ
fund('VEOF', 'Quỹ Đầu tư Cổ phiếu Hưng Thịnh VinaCapital (VEOF)', 20000, [{ asset_class: 'EQ_VN', sector: 'BANK', weight: '0.5' }, { asset_class: 'EQ_VN', sector: 'REAL_ESTATE', weight: '0.5' }])
fund('VFF', 'Quỹ Đầu tư Trái phiếu Bảo Thịnh VinaCapital (VFF)', 15000, [{ asset_class: 'CORP_BOND', sector: 'BANK', weight: '0.7' }, { asset_class: 'GOV_BOND', weight: '0.3', tenor: 'short' }])
fund('VIBF', 'Quỹ Đầu tư Cân bằng Tuệ Sáng VinaCapital (VIBF)', 12000, [{ asset_class: 'EQ_VN', sector: 'TECH', weight: '0.4' }, { asset_class: 'EQ_VN', sector: 'CONSUMER', weight: '0.2' }, { asset_class: 'CORP_BOND', sector: 'ENERGY', weight: '0.4' }])
fund('SSISCA', 'Quỹ Đầu tư Lợi thế Cạnh tranh Bền vững SSI (SSISCA)', 10000)
I.VT = { id: 'VT', name: 'Vanguard Total World Stock ETF (VT)', asset_class: 'EQ_INTL', sector: 'OTHER', currency: 'USD', listed: true, price_source: 'SAMPLE' }; PRICES.VT = 110
I.AAPL = { id: 'AAPL', name: 'Apple Inc. (AAPL)', asset_class: 'EQ_INTL', sector: 'TECH', currency: 'USD', listed: true, price_source: 'SAMPLE' }; PRICES.AAPL = 250
I.SJC = { id: 'SJC', name: 'Vàng miếng SJC (lượng)', asset_class: 'GOLD', currency: 'VND', listed: false, price_source: 'SAMPLE' }; PRICES.SJC = 125000000
I.BTC = { id: 'BTC', name: 'Bitcoin (BTC)', asset_class: 'CRYPTO', currency: 'VND', listed: false, price_source: 'SAMPLE' }; PRICES.BTC = 1500000000
for (const c of ['VND', 'USD', 'SGD', 'AUD'] as const) I[`CASH-${c}`] = { id: `CASH-${c}`, name: `Tiền gửi ${c}`, asset_class: 'CASH', currency: c, listed: false, price_source: 'FIXED' }
I['BDS-CANHO'] = { id: 'BDS-CANHO', name: 'Căn hộ', asset_class: 'REAL_ESTATE', sector: 'REAL_ESTATE', currency: 'VND', listed: false, price_source: 'ONEMOUNT' }
I['BDS-NHAPHO'] = { id: 'BDS-NHAPHO', name: 'Nhà liền kề', asset_class: 'REAL_ESTATE', sector: 'REAL_ESTATE', currency: 'VND', listed: false, price_source: 'MANUAL' }
I['BDS-BIETTHU'] = { id: 'BDS-BIETTHU', name: 'Biệt thự', asset_class: 'REAL_ESTATE', sector: 'REAL_ESTATE', currency: 'VND', listed: false, price_source: 'MANUAL' }
I['BDS-DATO'] = { id: 'BDS-DATO', name: 'Đất ở', asset_class: 'REAL_ESTATE', sector: 'REAL_ESTATE', currency: 'VND', listed: false, price_source: 'MANUAL' }
I['BDS-THUONGMAI'] = { id: 'BDS-THUONGMAI', name: 'Bất động sản thương mại', asset_class: 'REAL_ESTATE', sector: 'REAL_ESTATE', currency: 'VND', listed: false, price_source: 'MANUAL' }
I['CPTN'] = { id: 'CPTN', name: 'Cổ phần doanh nghiệp chưa niêm yết', asset_class: 'PRIVATE_EQ', sector: 'OTHER', currency: 'VND', listed: false, price_source: 'MANUAL' }
I['BH-TICHLUY'] = { id: 'BH-TICHLUY', name: 'Hợp đồng bảo hiểm liên kết', asset_class: 'INSURANCE', currency: 'VND', listed: false, price_source: 'MANUAL' }

const FX_NOW: Record<string, number> = { USD: 25000, SGD: 18500, AUD: 16500 }
const FX_BUY: Record<string, number> = { USD: 24000, SGD: 17800, AUD: 16100 }

// ---------- Gia đình ----------
type Alias = 'm1' | 'm2' | 'j' | 'e1' | 'fx1' | 'efx' | 'sg' | 'au'
interface PosSpec { inst: string; ty: number; acct?: Alias; key?: string; prop?: Partial<PropertyDetail> & { type: PropertyDetail['type']; project: string }; valDate?: string; noBuy?: boolean; sell?: boolean; qty?: number; deposit?: Holding['deposit'] }
interface FamSpec {
  id: string; name: string; rm: string; persona: Family['persona']
  members: [string, 1 | 2 | 3, string][]
  entity?: { name: string; type: string; owners: [number, string][] }
  pos: PosSpec[]
  liab?: (Omit<Liability, 'id' | 'borrower'> & { borrower: 'm1' | 'e1' })[]
  living: number // triệu VND mỗi tháng
  cf?: { label: string; category: string; direction: 'in' | 'out'; amount: string; currency?: 'VND' | 'USD' | 'SGD' | 'AUD'; frequency: CashflowItem['frequency']; start: string; end?: string; expected?: boolean; subject?: 'm1' | 'e1'; growth?: string }[]
}

const T = 1e9
const FAMS: FamSpec[] = [
  {
    id: 'DEMO-F01', name: 'Gia đình Nguyễn Văn An (giả lập)', rm: 'RM1', persona: 'P1',
    members: [['Nguyễn Văn An', 1, 'Nhà sáng lập'], ['Lê Thị Bình', 1, 'Vợ'], ['Nguyễn Minh Châu', 2, 'Con']],
    entity: { name: 'Công ty Holding An Gia', type: 'Công ty holding', owners: [[0, '0.6']] },
    pos: [
      { inst: 'MBB', ty: 0, qty: 400000 }, { inst: 'VHM12613', ty: 0, qty: 50 }, { inst: 'VEOF', ty: 0, qty: 200000 },
      { inst: 'CASH-USD', ty: 0, qty: 80000, acct: 'efx' }, { inst: 'CASH-VND', ty: 2.8 },
      { inst: 'BDS-CANHO', ty: 15, key: 'RE-F01-1', prop: { type: 'apartment', project: 'Vinhomes Ocean Park (Gia Lâm, Hà Nội)', building: 'Tòa S2.02', floor: 18, unit: '1806', area_m2: '120', bedrooms: 3 } },
      { inst: 'CPTN', ty: 14, key: 'PE-F01-1', valDate: '2026-06-30' }, { inst: 'SJC', ty: 0, qty: 16 }, { inst: 'BH-TICHLUY', ty: 2, key: 'INS-F01-1', valDate: '2026-09-30' },
    ],
    liab: [{ name: 'Vay thế chấp căn hộ', borrower: 'm1', balance: '6000000000', currency: 'VND', rate: '0.09', rate_type: 'fixed', repayment: 'amortizing', principal_per_month: '50000000', maturity: '2036-10-31', collateral: 'Căn hộ Tòa S2' }],
    living: 150,
    cf: [
      { label: 'Cổ tức MBB (dự kiến)', category: 'dividend', direction: 'in', amount: '400000000', frequency: 'once', start: '2027-05-15', expected: true },
      { label: 'Tiền thuê căn hộ Tòa S2', category: 'rent', direction: 'in', amount: '40000000', frequency: 'monthly', start: '2026-11-01' },
      { label: 'Phí bảo hiểm', category: 'insurance_premium', direction: 'out', amount: '200000000', frequency: 'annual', start: '2027-01-15' },
      { label: 'Gọi vốn cổ phần tư nhân', category: 'capital_call', direction: 'out', amount: '1000000000', frequency: 'once', start: '2027-03-10' },
    ],
  },
  {
    id: 'DEMO-F02', name: 'Gia đình Trần Quốc Bảo (giả lập)', rm: 'RM1', persona: 'P1',
    members: [['Trần Quốc Bảo', 1, 'Nhà sáng lập'], ['Phạm Thu Cúc', 1, 'Vợ'], ['Trần Đức Duy', 2, 'Con'], ['Trần Mai Em', 2, 'Con']],
    entity: { name: 'Công ty Holding Bảo Tín', type: 'Công ty holding', owners: [[0, '0.5'], [2, '0.3']] },
    pos: [
      { inst: 'CPTN', ty: 120, acct: 'e1', key: 'PE-F02-1', valDate: '2026-06-30' },
      { inst: 'BDS-BIETTHU', ty: 45, key: 'RE-F02-1', valDate: '2026-03-31', prop: { type: 'villa', project: 'Biệt thự Ecopark (Văn Giang, Hưng Yên)' } },
      { inst: 'BDS-THUONGMAI', ty: 30, acct: 'e1', key: 'RE-F02-2', valDate: '2026-06-30', prop: { type: 'commercial', project: 'Tòa văn phòng phố Lý Thường Kiệt, Hà Nội' } },
      { inst: 'CASH-VND', ty: 28 }, { inst: 'CASH-VND', ty: 10, acct: 'e1', deposit: { rate: '0.055', start: '2026-06-15', maturity: '2027-06-15' } },
      { inst: 'SJC', ty: 0, qty: 144 }, { inst: 'VPB', ty: 8, sell: true }, { inst: 'SSI', ty: 6 }, { inst: 'HPG', ty: 5 },
    ],
    liab: [{ name: 'Vay vốn công ty holding', borrower: 'e1', balance: '40000000000', currency: 'VND', rate: '0.085', rate_type: 'floating', repayment: 'bullet', principal_per_month: '0', maturity: '2028-12-31' }],
    living: 400,
    cf: [{ label: 'Gọi vốn dự án tư nhân', category: 'capital_call', direction: 'out', amount: '5000000000', frequency: 'once', start: '2027-06-20', subject: 'e1' }, { label: 'Cổ tức từ doanh nghiệp gia đình', category: 'distribution', direction: 'in', amount: '6000000000', frequency: 'annual', start: '2027-04-30', expected: true, subject: 'e1' }],
  },
  {
    id: 'DEMO-F03', name: 'Gia đình Lê Hoàng Cường (giả lập)', rm: 'RM1', persona: 'P2',
    members: [['Lê Hoàng Cường', 1, 'Chủ hộ'], ['Vũ Thị Dung', 1, 'Vợ'], ['Lê Hoàng Giang', 2, 'Con, đồng quản lý tài sản']],
    pos: [
      { inst: 'BDS-CANHO', ty: 18, key: 'RE-F03-1', acct: 'j', prop: { type: 'apartment', project: 'Vinhomes Ocean Park (Gia Lâm, Hà Nội)', building: 'Tòa S1.05', floor: 25, unit: '2508', area_m2: '150', bedrooms: 3 } },
      { inst: 'VPB', ty: 5.5, sell: true }, { inst: 'SHB', ty: 5.5 }, { inst: 'VFF', ty: 8 }, { inst: 'VIB12508', ty: 8 }, { inst: 'TPCP10N', ty: 4 },
      { inst: 'CASH-VND', ty: 8 }, { inst: 'BH-TICHLUY', ty: 4, key: 'INS-F03-1', valDate: '2026-09-30' },
      { inst: 'BDS-NHAPHO', ty: 10, key: 'RE-F03-2', valDate: '2026-04-30', prop: { type: 'townhouse', project: 'Nhà phố khu Cầu Giấy, Hà Nội' } },
    ],
    living: 120,
    cf: [{ label: 'Lương hưu và thu nhập khác', category: 'other_income', direction: 'in', amount: '60000000', frequency: 'monthly', start: '2026-11-01' }, { label: 'Phí bảo hiểm', category: 'insurance_premium', direction: 'out', amount: '300000000', frequency: 'annual', start: '2027-02-10' }],
  },
  {
    id: 'DEMO-F04', name: 'Gia đình Phạm Minh Đức (giả lập)', rm: 'RM1', persona: 'P4',
    members: [['Phạm Minh Đức', 1, 'Chủ hộ'], ['Hoàng Thu Hà', 1, 'Vợ'], ['Phạm Gia Huy', 2, 'Con, sống ở nước ngoài']],
    pos: [
      { inst: 'AAPL', ty: 0, qty: 1920, acct: 'fx1' }, { inst: 'CASH-USD', ty: 0, qty: 240000, acct: 'fx1' }, { inst: 'CASH-SGD', ty: 0, qty: 216000, acct: 'sg' }, { inst: 'CASH-AUD', ty: 0, qty: 120000, acct: 'au' },
      { inst: 'BDS-NHAPHO', ty: 15, key: 'RE-F04-1', valDate: '2026-05-31', prop: { type: 'townhouse', project: 'Nhà phố khu Phú Mỹ Hưng, TP.HCM' } },
      { inst: 'BH-TICHLUY', ty: 6, key: 'INS-F04-1', valDate: '2026-09-30' }, { inst: 'MBB', ty: 3 }, { inst: 'VNM', ty: 3 }, { inst: 'CASH-VND', ty: 3 },
    ],
    living: 200,
    cf: [{ label: 'Chi phí sinh hoạt của con ở nước ngoài', category: 'living', direction: 'out', amount: '3000', currency: 'SGD', frequency: 'monthly', start: '2026-11-01', subject: 'm1' }],
  },
  {
    id: 'DEMO-F05', name: 'Gia đình Võ Thành Phát (giả lập)', rm: 'RM1', persona: 'P1',
    members: [['Võ Thành Phát', 1, 'Nhà sáng lập'], ['Đặng Thị Lan', 1, 'Vợ'], ['Võ Thành Long', 2, 'Con']],
    entity: { name: 'Công ty TNHH Thành Phát', type: 'Doanh nghiệp gia đình', owners: [[0, '1']] },
    pos: [
      { inst: 'BDS-DATO', ty: 25, key: 'RE-F05-1', valDate: '2025-06-30', prop: { type: 'residential_land', project: 'Đất ở ven sông Sài Gòn, TP Thủ Đức' } },
      { inst: 'CPTN', ty: 40, acct: 'e1', key: 'PE-F05-1', valDate: '2026-06-30' }, { inst: 'CASH-VND', ty: 8 }, { inst: 'SJC', ty: 0, qty: 48 },
      { inst: 'PLX', ty: 4 }, { inst: 'NT2', ty: 3 },
    ],
    living: 180,
  },
  {
    id: 'DEMO-F06', name: 'Gia đình Đỗ Hữu Nghĩa (giả lập)', rm: 'RM1', persona: 'P2',
    members: [['Đỗ Hữu Nghĩa', 1, 'Chủ hộ'], ['Bùi Thị Oanh', 1, 'Vợ'], ['Đỗ Hữu Phúc', 2, 'Con']],
    pos: [
      { inst: 'BDS-NHAPHO', ty: 20, key: 'RE-F06-1', valDate: '2026-02-28', prop: { type: 'townhouse', project: 'Nhà phố khu Cầu Giấy, Hà Nội' } },
      { inst: 'MWG', ty: 6 }, { inst: 'DMXYZ', ty: 4 }, { inst: 'MBB', ty: 3 }, { inst: 'SSISCA', ty: 8 }, { inst: 'VIC12510', ty: 8 }, { inst: 'TPCP5N', ty: 5 },
      { inst: 'CASH-VND', ty: 9 }, { inst: 'BH-TICHLUY', ty: 4, key: 'INS-F06-1', valDate: '2026-09-30' },
    ],
    living: 130,
  },
  {
    id: 'DEMO-F07', name: 'Gia đình Ngô Thanh Quân (giả lập)', rm: 'RM1', persona: 'P3',
    members: [['Ngô Thanh Quân', 1, 'Doanh nhân'], ['Trịnh Mỹ Linh', 1, 'Vợ']],
    pos: [
      { inst: 'FPT', ty: 12, sell: true }, { inst: 'SSI', ty: 6 }, { inst: 'MWG', ty: 4 }, { inst: 'CPTN', ty: 15, key: 'PE-F07-1', valDate: '2026-06-30' },
      { inst: 'VT', ty: 0, qty: 2540, acct: 'fx1' }, { inst: 'BTC', ty: 0, qty: 2 }, { inst: 'CASH-VND', ty: 10 }, { inst: 'SJC', ty: 0, qty: 16 },
      { inst: 'BDS-CANHO', ty: 10, key: 'RE-F07-1', valDate: '2026-05-31', prop: { type: 'apartment', project: 'Chung cư Royal City (Thanh Xuân, Hà Nội)', building: 'Tòa R1', floor: 9, unit: '0905', area_m2: '95', bedrooms: 2, supported: false } },
    ],
    living: 160,
  },
  {
    id: 'DEMO-F08', name: 'Gia đình Hồ Văn Sơn (giả lập)', rm: 'RM2', persona: 'P2',
    members: [['Hồ Văn Sơn', 1, 'Chủ hộ'], ['Lý Thị Tâm', 1, 'Vợ'], ['Hồ Văn Tùng', 2, 'Con, đồng quản lý tài sản']],
    pos: [
      { inst: 'BDS-CANHO', ty: 16, key: 'RE-F08-1', prop: { type: 'apartment', project: 'Vinhomes Ocean Park (Gia Lâm, Hà Nội)', building: 'Tòa S2.09', floor: 12, unit: '1203', area_m2: '110', bedrooms: 3 } },
      { inst: 'BDS-NHAPHO', ty: 10, key: 'RE-F08-2', valDate: '2026-06-30', prop: { type: 'townhouse', project: 'Nhà phố khu Phú Mỹ Hưng, TP.HCM' } },
      { inst: 'NLG', ty: 6, sell: true }, { inst: 'KDH', ty: 5 }, { inst: 'VFF', ty: 7 }, { inst: 'VHM12613', ty: 7 }, { inst: 'TPCP5N', ty: 4 },
      { inst: 'CASH-VND', ty: 8 }, { inst: 'BH-TICHLUY', ty: 4, key: 'INS-F08-1', valDate: '2026-09-30' },
    ],
    living: 120,
  },
  {
    id: 'DEMO-F09', name: 'Gia đình Mai Xuân Uy (giả lập)', rm: 'RM2', persona: 'P1',
    members: [['Mai Xuân Uy', 1, 'Nhà sáng lập'], ['Cao Thị Vân', 1, 'Vợ'], ['Mai Xuân Vinh', 2, 'Con']],
    entity: { name: 'Công ty Cổ phần Mai Uy', type: 'Doanh nghiệp gia đình', owners: [[0, '0.9']] },
    pos: [
      { inst: 'CPTN', ty: 35, acct: 'e1', key: 'PE-F09-1', valDate: '2026-06-30' },
      { inst: 'BDS-NHAPHO', ty: 20, key: 'RE-F09-1', valDate: '2026-06-30', prop: { type: 'townhouse', project: 'Nhà phố khu Phú Mỹ Hưng, TP.HCM' } },
      { inst: 'CASH-VND', ty: 1.5 }, { inst: 'SJC', ty: 0, qty: 40 }, { inst: 'HPG', ty: 4 },
    ],
    liab: [{ name: 'Vay kinh doanh', borrower: 'm1', balance: '8000000000', currency: 'VND', rate: '0.10', rate_type: 'floating', repayment: 'amortizing', principal_per_month: '100000000', maturity: '2033-06-30' }],
    living: 120,
    cf: [{ label: 'Gọi vốn mở rộng doanh nghiệp', category: 'capital_call', direction: 'out', amount: '3000000000', frequency: 'once', start: '2027-01-15' }],
  },
  {
    id: 'DEMO-F10', name: 'Gia đình Châu Minh Xuyên (giả lập)', rm: 'RM2', persona: 'P2',
    members: [['Châu Minh Xuyên', 1, 'Chủ hộ'], ['Tạ Thị Yến', 1, 'Vợ'], ['Châu Minh Khoa', 2, 'Con']],
    pos: [
      { inst: 'BDS-BIETTHU', ty: 30, key: 'RE-F10-1', valDate: '2026-03-31', prop: { type: 'villa', project: 'Biệt thự Ecopark (Văn Giang, Hưng Yên)' } },
      { inst: 'VPB', ty: 10 }, { inst: 'FPT', ty: 8 }, { inst: 'VNM', ty: 6, sell: true }, { inst: 'VFF', ty: 10 }, { inst: 'VEOF', ty: 6 },
      { inst: 'VIB12508', ty: 10 }, { inst: 'TPCP10N', ty: 6 }, { inst: 'CASH-VND', ty: 12, deposit: { rate: '0.05', start: '2026-08-01', maturity: '2027-02-01' } }, { inst: 'BH-TICHLUY', ty: 6, key: 'INS-F10-1', valDate: '2026-09-30' },
    ],
    living: 200,
    cf: [{ label: 'Thu nhập cho thuê biệt thự', category: 'rent', direction: 'in', amount: '90000000', frequency: 'monthly', start: '2026-11-01' }],
  },
  {
    id: 'DEMO-F11', name: 'Gia đình Kiều Anh Tuấn (giả lập)', rm: 'RM2', persona: 'P3',
    members: [['Kiều Anh Tuấn', 1, 'Doanh nhân'], ['Lâm Ngọc Diệp', 1, 'Vợ']],
    pos: [
      { inst: 'FPT', ty: 20, noBuy: true }, { inst: 'DMXYZ', ty: 5 }, { inst: 'SSI', ty: 8, sell: true }, { inst: 'CPTN', ty: 25, key: 'PE-F11-1', valDate: '2026-06-30' },
      { inst: 'AAPL', ty: 0, qty: 1600, acct: 'fx1' }, { inst: 'BTC', ty: 0, qty: 3 }, { inst: 'CASH-VND', ty: 12 },
    ],
    living: 180,
  },
  {
    id: 'DEMO-F12', name: 'Gia đình Quách Bảo Ngọc (giả lập)', rm: 'RM2', persona: 'P3',
    members: [['Quách Bảo Ngọc', 1, 'Doanh nhân'], ['Hà Minh Trí', 1, 'Chồng'], ['Quách Hà My', 2, 'Con']],
    pos: [
      { inst: 'MWG', ty: 10 }, { inst: 'GMD', ty: 8 }, { inst: 'CPTN', ty: 20, key: 'PE-F12-1', valDate: '2026-06-30' }, { inst: 'VT', ty: 0, qty: 2180, acct: 'fx1' },
      { inst: 'BTC', ty: 0, qty: 2 }, { inst: 'CASH-VND', ty: 8 },
      { inst: 'BDS-CANHO', ty: 12, key: 'RE-F12-1', valDate: '2026-04-30', prop: { type: 'apartment', project: 'Chung cư Royal City (Thanh Xuân, Hà Nội)', building: 'Tòa R2', floor: 20, unit: '2001', area_m2: '130', bedrooms: 3, supported: false } },
    ],
    living: 400,
    cf: [{ label: 'Thu nhập từ cổ tức doanh nghiệp', category: 'distribution', direction: 'in', amount: '1200000000', frequency: 'annual', start: '2027-04-30', expected: true }],
  },
  {
    id: 'DEMO-F13', name: 'Gia đình Đinh Công Hiển (giả lập)', rm: 'RM2', persona: 'P1',
    members: [['Đinh Công Hiển', 1, 'Nhà sáng lập'], ['Phan Thị Hoa', 1, 'Vợ'], ['Đinh Công Khải', 2, 'Con'], ['Đinh Bảo An', 3, 'Cháu']],
    entity: { name: 'Tập đoàn Hiển Vinh', type: 'Công ty holding', owners: [[0, '0.4'], [2, '0.3']] },
    pos: [
      { inst: 'CPTN', ty: 200, acct: 'e1', key: 'PE-F13-1', valDate: '2026-06-30' },
      { inst: 'BDS-THUONGMAI', ty: 80, acct: 'e1', key: 'RE-F13-1', valDate: '2026-06-30', prop: { type: 'commercial', project: 'Mặt bằng thương mại trung tâm TP.HCM' } },
      { inst: 'BDS-BIETTHU', ty: 60, key: 'RE-F13-2', valDate: '2026-03-31', prop: { type: 'villa', project: 'Biệt thự Ecopark (Văn Giang, Hưng Yên)' } },
      { inst: 'CASH-VND', ty: 40 }, { inst: 'SJC', ty: 0, qty: 240 }, { inst: 'MBB', ty: 20, sell: true }, { inst: 'NLG', ty: 15 },
    ],
    liab: [{ name: 'Vay hợp vốn tập đoàn', borrower: 'e1', balance: '100000000000', currency: 'VND', rate: '0.08', rate_type: 'floating', repayment: 'bullet', principal_per_month: '0', maturity: '2029-12-31' }],
    living: 600,
    cf: [{ label: 'Gọi vốn quỹ đầu tư tư nhân', category: 'capital_call', direction: 'out', amount: '10000000000', frequency: 'once', start: '2027-08-15', subject: 'e1' }],
  },
  {
    id: 'DEMO-F14', name: 'Gia đình Lương Thế Vinh (giả lập)', rm: 'RM2', persona: 'P2',
    members: [['Lương Thế Vinh', 1, 'Chủ hộ'], ['Mạc Thị Xoan', 1, 'Vợ'], ['Lương Thế Bách', 2, 'Con']],
    pos: [
      { inst: 'BDS-CANHO', ty: 25, key: 'RE-F14-1', valDate: '2026-06-30', prop: { type: 'apartment', project: 'Chung cư Royal City (Thanh Xuân, Hà Nội)', building: 'Tòa R3', floor: 30, unit: '3002', area_m2: '160', bedrooms: 4, supported: false } },
      { inst: 'SHB', ty: 8 }, { inst: 'VNM', ty: 7 }, { inst: 'GMD', ty: 5 }, { inst: 'VIBF', ty: 10 }, { inst: 'VHM12613', ty: 10 }, { inst: 'TPCP5N', ty: 5 },
      { inst: 'CASH-VND', ty: 10 }, { inst: 'BH-TICHLUY', ty: 5, key: 'INS-F14-1', valDate: '2026-09-30' },
    ],
    living: 150,
  },
  {
    id: 'DEMO-F15', name: 'Gia đình Tôn Nữ Thảo (giả lập)', rm: 'RM3', persona: 'P4',
    members: [['Tôn Nữ Thảo', 1, 'Chủ hộ'], ['James Tôn (giả lập)', 1, 'Chồng'], ['Tôn Minh Anh', 2, 'Con, du học']],
    pos: [
      { inst: 'VT', ty: 0, qty: 7270, acct: 'fx1' }, { inst: 'AAPL', ty: 0, qty: 1600, acct: 'fx1' }, { inst: 'CASH-USD', ty: 0, qty: 400000, acct: 'fx1' },
      { inst: 'CASH-SGD', ty: 0, qty: 432000, acct: 'sg' }, { inst: 'CASH-AUD', ty: 0, qty: 364000, acct: 'au' },
      { inst: 'BDS-CANHO', ty: 30, key: 'RE-F15-1', prop: { type: 'apartment', project: 'Vinhomes Ocean Park (Gia Lâm, Hà Nội)', building: 'Tòa S1.01', floor: 35, unit: '3501', area_m2: '200', bedrooms: 4 } },
      { inst: 'BH-TICHLUY', ty: 12, key: 'INS-F15-1', valDate: '2026-09-30' }, { inst: 'MBB', ty: 6 }, { inst: 'FPT', ty: 6 },
    ],
    living: 250,
    cf: [{ label: 'Học phí du học', category: 'education', direction: 'out', amount: '30000', currency: 'AUD', frequency: 'annual', start: '2027-01-10', subject: 'm1' }],
  },
  {
    id: 'DEMO-F16', name: 'Gia đình Văn Khánh Linh (giả lập)', rm: 'RM3', persona: 'P3',
    members: [['Văn Khánh Linh', 1, 'Doanh nhân'], ['Âu Đức Mạnh', 1, 'Chồng']],
    pos: [
      { inst: 'SSI', ty: 10 }, { inst: 'PLX', ty: 8 }, { inst: 'DXG', ty: 6 }, { inst: 'CPTN', ty: 20, key: 'PE-F16-1', valDate: '2026-06-30' },
      { inst: 'AAPL', ty: 0, qty: 1280, acct: 'fx1' }, { inst: 'BTC', ty: 0, qty: 3, noBuy: true }, { inst: 'CASH-VND', ty: 10 },
      { inst: 'BDS-NHAPHO', ty: 10, key: 'RE-F16-1', valDate: '2026-06-30', prop: { type: 'townhouse', project: 'Nhà phố khu Cầu Giấy, Hà Nội' } },
    ],
    living: 170,
  },
  {
    id: 'DEMO-F17', name: 'Gia đình Lục Gia Bảo (giả lập)', rm: 'RM3', persona: 'P4',
    members: [['Lục Gia Bảo', 1, 'Chủ hộ'], ['Ông Thị Ngân', 1, 'Vợ'], ['Lục Gia Phong', 2, 'Con, sống ở nước ngoài']],
    pos: [
      { inst: 'VT', ty: 0, qty: 1000, acct: 'fx1' }, { inst: 'AAPL', ty: 0, qty: 2400, acct: 'fx1', sell: true }, { inst: 'CASH-USD', ty: 0, qty: 320000, acct: 'fx1' },
      { inst: 'CASH-AUD', ty: 0, qty: 303000, acct: 'au' },
      { inst: 'BDS-CANHO', ty: 20, key: 'RE-F17-1', prop: { type: 'apartment', project: 'Vinhomes Ocean Park (Gia Lâm, Hà Nội)', building: 'Tòa S2.15', floor: 22, unit: '2205', area_m2: '140', bedrooms: 3 } },
      { inst: 'BH-TICHLUY', ty: 8, key: 'INS-F17-1', valDate: '2026-09-30' }, { inst: 'NLG', ty: 4 }, { inst: 'VPB', ty: 4 },
    ],
    living: 180,
  },
  {
    id: 'DEMO-F18', name: 'Gia đình Thái Hoàng Long (giả lập)', rm: 'RM3', persona: 'P4',
    members: [['Thái Hoàng Long', 1, 'Chủ hộ'], ['Diệp Thị Quyên', 1, 'Vợ'], ['Thái Hoàng Nam', 2, 'Con, sống ở nước ngoài'], ['Thái Hoàng Mi', 2, 'Con']],
    entity: { name: 'Công ty Đầu tư Long Hải', type: 'Công ty holding', owners: [[0, '0.5'], [1, '0.5']] },
    pos: [
      { inst: 'BDS-THUONGMAI', ty: 700, acct: 'e1', key: 'RE-F18-1', valDate: '2026-06-30', prop: { type: 'commercial', project: 'Khu phức hợp ven biển Hạ Long, Quảng Ninh' } },
      { inst: 'VT', ty: 0, qty: 72700, acct: 'fx1' }, { inst: 'AAPL', ty: 0, qty: 48000, acct: 'fx1' },
      { inst: 'CASH-USD', ty: 0, qty: 6000000, acct: 'fx1' }, { inst: 'CASH-SGD', ty: 0, qty: 4320000, acct: 'sg' },
      { inst: 'BH-TICHLUY', ty: 150, key: 'INS-F18-1', valDate: '2026-09-30' }, { inst: 'MBB', ty: 100 }, { inst: 'FPT', ty: 100 },
    ],
    living: 1500,
  },
  {
    id: 'DEMO-F19', name: 'Gia đình Bạch Văn Thịnh (giả lập)', rm: 'RM3', persona: 'P1',
    members: [['Bạch Văn Thịnh', 1, 'Nhà sáng lập'], ['Chu Thị Uyên', 1, 'Vợ'], ['Bạch Văn Vũ', 2, 'Con']],
    pos: [
      { inst: 'CPTN', ty: 50, key: 'PE-F19-1', valDate: '2026-06-30' },
      { inst: 'BDS-BIETTHU', ty: 25, key: 'RE-F19-1', valDate: '2026-06-30', prop: { type: 'villa', project: 'Biệt thự Ecopark (Văn Giang, Hưng Yên)' } },
      { inst: 'CASH-VND', ty: 8 }, { inst: 'SJC', ty: 0, qty: 48 }, { inst: 'NT2', ty: 4, sell: true },
    ],
    liab: [{ name: 'Vay mua biệt thự', borrower: 'm1', balance: '10000000000', currency: 'VND', rate: '0.095', rate_type: 'fixed', repayment: 'amortizing', principal_per_month: '80000000', maturity: '2037-06-30' }],
    living: 140,
  },
  {
    id: 'DEMO-F20', name: 'Gia đình Từ Minh Khang (giả lập)', rm: 'RM3', persona: 'P3',
    members: [['Từ Minh Khang', 1, 'Doanh nhân trẻ'], ['La Thị Hằng', 1, 'Vợ']],
    pos: [
      { inst: 'FPT', ty: 5 }, { inst: 'MWG', ty: 4 }, { inst: 'CPTN', ty: 6, key: 'PE-F20-1', valDate: '2026-06-30' }, { inst: 'VT', ty: 0, qty: 1090, acct: 'fx1' },
      { inst: 'BTC', ty: 0, qty: 1 }, { inst: 'CASH-VND', ty: 4 },
      { inst: 'BDS-CANHO', ty: 6.5, key: 'RE-F20-1', valDate: '2026-05-31', prop: { type: 'apartment', project: 'Chung cư Royal City (Thanh Xuân, Hà Nội)', building: 'Tòa R4', floor: 7, unit: '0712', area_m2: '70', bedrooms: 2, supported: false } },
    ],
    living: 70,
  },
]

// ---------- Dựng gia đình ----------
const ONEMOUNT_VALUATIONS: { request: Record<string, unknown>; result: Record<string, unknown> }[] = []
const allFamilies: Family[] = []

function pastDate(yearsBack: number, extraDays: number): string {
  const d = new Date(PRICE_DATE + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - Math.round(yearsBack * 365 + extraDays))
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1)
  if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 2)
  return d.toISOString().slice(0, 10)
}

for (const s of FAMS) {
  const n = s.id.slice(-2)
  const members: Member[] = s.members.map(([name, gen, role], i) => ({ id: `M-F${n}-${i + 1}`, name, generation: gen, role }))
  const entities: Entity[] = s.entity ? [{ id: `E-F${n}-1`, name: s.entity.name, type: s.entity.type }] : []
  const ownerships: EntityOwnership[] = s.entity ? s.entity.owners.map(([mi, pct]) => ({ entity_id: `E-F${n}-1`, member_id: members[mi].id, pct })) : []
  const accounts: Account[] = []
  const acct = (alias: Alias): string => {
    const id = `A-F${n}-${alias.toUpperCase()}`
    if (accounts.some(a => a.id === id)) return id
    const m1 = members[0].id, m2 = (members[1] ?? members[0]).id
    const map: Record<Alias, Account> = {
      m1: { id, custodian: 'Techcombank', currency: 'VND', owners: [{ kind: 'member', id: m1, pct: '1' }] },
      m2: { id, custodian: 'Vietcombank', currency: 'VND', owners: [{ kind: 'member', id: m2, pct: '1' }] },
      j: { id, custodian: 'Techcombank', currency: 'VND', owners: [{ kind: 'member', id: m1, pct: '0.5' }, { kind: 'member', id: m2, pct: '0.5' }] },
      e1: { id, custodian: 'Vietcombank', currency: 'VND', owners: [{ kind: 'entity', id: `E-F${n}-1`, pct: '1' }] },
      fx1: { id, custodian: 'Lưu ký nước ngoài (Singapore)', currency: 'USD', owners: [{ kind: 'member', id: m1, pct: '1' }] },
      efx: { id, custodian: 'Techcombank', currency: 'USD', owners: [{ kind: 'entity', id: `E-F${n}-1`, pct: '1' }] },
      sg: { id, custodian: 'Lưu ký nước ngoài (Singapore)', currency: 'SGD', owners: [{ kind: 'member', id: (members[2] ?? members[0]).id, pct: '1' }] },
      au: { id, custodian: 'Lưu ký nước ngoài (Singapore)', currency: 'AUD', owners: [{ kind: 'member', id: (members[2] ?? members[0]).id, pct: '1' }] },
    }
    accounts.push(map[alias])
    return id
  }
  const holdings: Holding[] = []
  const txs: Transaction[] = []
  let txn = 0
  const tx = (t: Omit<Transaction, 'id'>) => txs.push({ id: `TX-F${n}-${String(++txn).padStart(4, '0')}`, ...t })
  s.pos.forEach((p, i) => {
    const inst = I[p.inst]
    const alias: Alias = p.acct ?? (inst.currency === 'USD' ? 'fx1' : 'm1')
    const hid = `H-F${n}-${String(i + 1).padStart(2, '0')}`
    const h: Holding = { id: hid, account_id: acct(alias), instrument_id: inst.id, quantity: '0' }
    const cur = inst.currency
    const fxNow = cur === 'VND' ? 1 : FX_NOW[cur]
    const fxBuy = cur === 'VND' ? 1 : FX_BUY[cur]
    if (inst.price_source === 'FIXED') {
      const qty = p.qty ?? Math.round(p.ty * T / fxNow)
      h.quantity = String(qty)
      if (p.deposit) h.deposit = p.deposit
      if (cur !== 'VND') tx({ holding_id: hid, type: 'BUY', date: pastDate(1 + rnd(), 0), quantity: String(qty), price: '1', currency: cur, fx_rate: String(fxBuy) })
    } else if (p.key) {
      h.price_key = p.key; h.quantity = '1'
      const value = Math.round(p.ty * T)
      if (p.prop) {
        const supported = p.prop.supported ?? p.prop.type === 'apartment'
        const purchase = Math.round(value * (0.62 + rnd() * 0.2) / 1e6) * 1e6
        h.property = { type: p.prop.type, project: p.prop.project, building: p.prop.building, floor: p.prop.floor, unit: p.prop.unit, area_m2: p.prop.area_m2 ?? String(Math.round(value / 1e8)), bedrooms: p.prop.bedrooms, supported, purchase_price: String(purchase), capitalized_costs: String(Math.round(purchase * 0.02)) }
        if (supported) {
          ONEMOUNT_VALUATIONS.push({ request: { project: p.prop.project, building: p.prop.building, floor: p.prop.floor, unit: p.prop.unit, area_m2: p.prop.area_m2, bedrooms: p.prop.bedrooms }, result: { price: value, priceMin: Math.round(value * 0.95), priceMax: Math.round(value * 1.05), valuationDate: '2026-09-30', modelVersion: 'avm-mau-1' } })
          // Giá nhập tay cũ làm dự phòng khi nguồn lỗi
          h.manual = { price: String(Math.round(value * 0.97)), valuation_date: '2026-03-31' }
        } else h.manual = { price: String(value), valuation_date: p.valDate ?? '2026-06-30' }
        tx({ holding_id: hid, type: 'BUY', date: pastDate(3 + rnd() * 3, 0), quantity: '1', price: String(purchase), fee: h.property.capitalized_costs, currency: 'VND', fx_rate: '1' })
      } else if (inst.asset_class === 'INSURANCE') {
        h.manual = { price: String(value), valuation_date: p.valDate ?? '2026-09-30' }
        const premium = Math.round(value / 6 / 1e6) * 1e6
        for (let y = 5; y >= 1; y--) tx({ holding_id: hid, type: 'CAPITAL_CALL', date: pastDate(y, 0), amount: String(premium), currency: 'VND', fx_rate: '1' })
      } else {
        h.manual = { price: String(value), valuation_date: p.valDate ?? '2026-06-30' }
        const cost = Math.round(value * (0.4 + rnd() * 0.4) / 1e6) * 1e6
        tx({ holding_id: hid, type: 'BUY', date: pastDate(4 + rnd() * 3, 0), quantity: '1', price: String(cost), currency: 'VND', fx_rate: '1' })
      }
    } else {
      const price = PRICES[inst.id]
      const lot = inst.asset_class === 'EQ_VN' ? 100 : 1
      const qty = p.qty ?? Math.max(lot, Math.round(p.ty * T / fxNow / price / lot) * lot)
      h.quantity = String(qty)
      if (!p.noBuy && !(s.id === 'DEMO-F01' && inst.id === 'MBB')) {
        const buyPx = inst.bond ? Number(inst.bond.par) : Math.round(price * (0.75 + rnd() * 0.35) * (cur === 'VND' ? 1 : 100)) / (cur === 'VND' ? 1 : 100)
        const fee = cur === 'VND' ? Math.round(qty * buyPx * 0.0015) : 0
        if (p.sell) {
          const sold = Math.round(qty * 0.25 / lot) * lot || lot
          tx({ holding_id: hid, type: 'BUY', date: pastDate(2.5, rnd() * 100), quantity: String(qty + sold), price: String(buyPx), fee: String(fee), currency: cur, fx_rate: String(fxBuy) })
          const sellPx = cur === 'VND' ? Math.round(price * (0.95 + rnd() * 0.15)) : Math.round(price * (0.95 + rnd() * 0.15) * 100) / 100
          const sv = sold * sellPx
          tx({ holding_id: hid, type: 'SELL', date: pastDate(0.6, rnd() * 60), quantity: String(sold), price: String(sellPx), fee: String(cur === 'VND' ? Math.round(sv * 0.0015) : 0), tax: String(cur === 'VND' ? Math.round(sv * 0.001) : 0), currency: cur, fx_rate: String(cur === 'VND' ? 1 : FX_NOW[cur] - 300) })
        } else {
          tx({ holding_id: hid, type: 'BUY', date: pastDate(1.5 + rnd() * 2, 0), quantity: String(qty), price: String(buyPx), fee: String(fee), currency: cur, fx_rate: String(fxBuy) })
        }
        if (inst.asset_class === 'EQ_VN' && rnd() < 0.5) tx({ holding_id: hid, type: 'DIVIDEND_CASH', date: pastDate(0.4, 0), amount: String(qty * 800), currency: 'VND', fx_rate: '1' })
        if (inst.bond) tx({ holding_id: hid, type: 'COUPON', date: pastDate(0.3, 0), amount: String(Math.round(qty * Number(inst.bond.par) * Number(inst.bond.coupon_rate) / inst.bond.freq)), currency: 'VND', fx_rate: '1' })
      }
    }
    holdings.push(h)
  })
  // Chuỗi giao dịch MBB của DEMO-F01 đúng ví dụ Mục 6.5
  if (s.id === 'DEMO-F01') {
    const hNga = holdings.find(h => h.instrument_id === 'MBB')!.id
    const hUsd = holdings.find(h => h.instrument_id === 'CASH-USD')!.id
    txs.splice(0, txs.length, ...txs.filter(t => t.holding_id !== hUsd))
    tx({ holding_id: hNga, type: 'BUY', date: '2024-03-01', quantity: '300000', price: '20000', fee: '9000000', currency: 'VND', fx_rate: '1' })
    tx({ holding_id: hNga, type: 'BUY', date: '2024-09-03', quantity: '200000', price: '23000', fee: '6900000', currency: 'VND', fx_rate: '1' })
    tx({ holding_id: hNga, type: 'DIVIDEND_CASH', date: '2025-06-02', amount: '500000000', currency: 'VND', fx_rate: '1' })
    tx({ holding_id: hNga, type: 'SELL', date: '2026-02-02', quantity: '100000', price: '26000', fee: '2600000', tax: '2600000', currency: 'VND', fx_rate: '1' })
    tx({ holding_id: hUsd, type: 'BUY', date: '2025-01-10', quantity: '80000', price: '1', currency: 'USD', fx_rate: '24000' })
  }
  // Ví dụ tách tỷ giá Mục 6.5: 1.000 cổ VT mua 100 USD khi tỷ giá 24.000 (DEMO-F17)
  if (s.id === 'DEMO-F17') {
    const hGla = holdings.find(h => h.instrument_id === 'VT')!.id
    txs.splice(0, txs.length, ...txs.filter(t => t.holding_id !== hGla))
    tx({ holding_id: hGla, type: 'BUY', date: '2025-02-10', quantity: '1000', price: '100', currency: 'USD', fx_rate: '24000' })
  }
  const liabilities: Liability[] = (s.liab ?? []).map((l, i) => ({ ...l, id: `L-F${n}-${i + 1}`, borrower: l.borrower === 'e1' ? { kind: 'entity' as const, id: `E-F${n}-1` } : { kind: 'member' as const, id: members[0].id } }))
  let cfn = 0
  const cfs: CashflowItem[] = []
  const cf = (c: Omit<CashflowItem, 'id'>) => cfs.push({ id: `CF-F${n}-${String(++cfn).padStart(4, '0')}`, ...c })
  cf({ label: 'Chi sinh hoạt', category: 'living', direction: 'out', amount: String(s.living * 1e6), currency: 'VND', frequency: 'monthly', start: '2026-11-01', subject: { kind: 'member', id: members[0].id }, origin: 'manual', expected: false })
  for (const c of s.cf ?? []) {
    const ccy = c.currency ?? 'VND'
    cf({ label: c.label, category: c.category, direction: c.direction, amount: c.amount, currency: ccy, frequency: c.frequency, start: c.start, end: c.end, growth: c.growth, subject: c.subject === 'e1' ? { kind: 'entity', id: `E-F${n}-1` } : { kind: 'member', id: members[0].id }, origin: 'manual', expected: c.expected ?? false })
  }
  allFamilies.push({ id: s.id, name: s.name, rm_id: s.rm, persona: s.persona, currency: 'VND', members, entities, ownerships, accounts, holdings, liabilities, transactions: txs, cashflows: cfs })
}

// ---------- Mục tiêu ----------
const hOf = (fid: string, inst: string, nth = 0) => allFamilies.find(f => f.id === fid)!.holdings.filter(h => h.instrument_id === inst)[nth].id
const goal = (g: Omit<Goal, 'currency' | 'status' | 'annual_contribution' | 'cost_growth' | 'basis' | 'spend' | 'source_note'> & Partial<Goal>): Goal => ({
  currency: 'VND', status: 'active', annual_contribution: '0', cost_growth: '0', basis: 'nominal', spend: { kind: 'once' }, source_note: 'Theo trao đổi với khách ngày 15/09/2026 (giả lập)', ...g,
})
const GOALS: Goal[] = [
  goal({ id: 'GL-F01-01', family_id: 'DEMO-F01', name: 'Du học cho Minh Châu', type: 'education', beneficiary: 'M-F01-3', year: 2030, month: 10, amount: '8000000000', priority: 'essential', earmarks: [{ holding_id: hOf('DEMO-F01', 'VEOF'), pct: '1' }, { holding_id: hOf('DEMO-F01', 'VHM12613'), pct: '0.4' }] }),
  goal({ id: 'GL-F02-01', family_id: 'DEMO-F02', name: 'Chuyển giao doanh nghiệp cho thế hệ 2', type: 'succession', year: 2035, month: 1, amount: '150000000000', priority: 'essential', earmarks: [{ holding_id: hOf('DEMO-F02', 'CPTN'), pct: '0.6' }] }),
  goal({ id: 'GL-F03-01', family_id: 'DEMO-F03', name: 'Nghỉ hưu của ông bà', type: 'retirement', year: 2029, month: 1, amount: '1500000000', basis: 'today', cost_growth: '0.04', spend: { kind: 'multi', years: 15 }, priority: 'essential', earmarks: [{ holding_id: hOf('DEMO-F03', 'VFF'), pct: '1' }, { holding_id: hOf('DEMO-F03', 'VIB12508'), pct: '1' }, { holding_id: hOf('DEMO-F03', 'TPCP10N'), pct: '1' }] }),
  goal({ id: 'GL-F04-01', family_id: 'DEMO-F04', name: 'Học thạc sĩ cho Gia Huy', type: 'education', beneficiary: 'M-F04-3', year: 2028, month: 8, amount: '3000000000', basis: 'today', cost_growth: '0.05', priority: 'important', earmarks: [{ holding_id: hOf('DEMO-F04', 'CASH-USD'), pct: '0.5' }] }),
  goal({ id: 'GL-F06-01', family_id: 'DEMO-F06', name: 'Mua nhà cho con', type: 'purchase', beneficiary: 'M-F06-3', year: 2029, month: 6, amount: '12000000000', priority: 'important', earmarks: [] }),
  goal({ id: 'GL-F07-01', family_id: 'DEMO-F07', name: 'Mua căn hộ nghỉ dưỡng', type: 'purchase', year: 2030, month: 3, amount: '9000000000', priority: 'aspirational', earmarks: [{ holding_id: hOf('DEMO-F07', 'VT'), pct: '1' }, { holding_id: hOf('DEMO-F07', 'SSI'), pct: '0.5' }] }),
  goal({ id: 'GL-F08-01', family_id: 'DEMO-F08', name: 'Mua nhà cho con trai', type: 'purchase', beneficiary: 'M-F08-3', year: 2029, month: 9, amount: '14000000000', priority: 'important', earmarks: [{ holding_id: hOf('DEMO-F08', 'NLG'), pct: '1' }, { holding_id: hOf('DEMO-F08', 'KDH'), pct: '1' }] }),
  goal({ id: 'GL-F10-01', family_id: 'DEMO-F10', name: 'Nghỉ hưu', type: 'retirement', year: 2031, month: 1, amount: '1200000000', basis: 'today', cost_growth: '0.04', spend: { kind: 'multi', years: 20 }, priority: 'essential', earmarks: [{ holding_id: hOf('DEMO-F10', 'VFF'), pct: '1' }, { holding_id: hOf('DEMO-F10', 'VIB12508'), pct: '1' }, { holding_id: hOf('DEMO-F10', 'VPB'), pct: '0.5' }] }),
  goal({ id: 'GL-F12-01', family_id: 'DEMO-F12', name: 'Mua biệt thự', type: 'purchase', year: 2031, month: 6, amount: '25000000000', priority: 'aspirational', earmarks: [{ holding_id: hOf('DEMO-F12', 'GMD'), pct: '1' }] }),
  goal({ id: 'GL-F13-01', family_id: 'DEMO-F13', name: 'Quỹ dự phòng gia đình', type: 'other', year: 2027, month: 12, amount: '10000000000', priority: 'important', earmarks: [{ holding_id: hOf('DEMO-F13', 'CASH-VND'), pct: '0.3' }] }),
  goal({ id: 'GL-F14-01', family_id: 'DEMO-F14', name: 'Nghỉ hưu', type: 'retirement', year: 2032, month: 1, amount: '1000000000', basis: 'today', cost_growth: '0.04', spend: { kind: 'multi', years: 20 }, priority: 'essential', annual_contribution: '300000000', earmarks: [{ holding_id: hOf('DEMO-F14', 'VIBF'), pct: '1' }, { holding_id: hOf('DEMO-F14', 'VHM12613'), pct: '0.6' }] }),
  goal({ id: 'GL-F15-01', family_id: 'DEMO-F15', name: 'Đại học cho Minh Anh', type: 'education', beneficiary: 'M-F15-3', year: 2031, month: 9, amount: '10000000000', priority: 'essential', earmarks: [{ holding_id: hOf('DEMO-F15', 'CASH-SGD'), pct: '1' }] }),
  goal({ id: 'GL-F17-01', family_id: 'DEMO-F17', name: 'Nghỉ hưu ở nước ngoài', type: 'retirement', year: 2033, month: 1, amount: '2000000000', basis: 'today', cost_growth: '0.03', spend: { kind: 'multi', years: 15 }, priority: 'important', earmarks: [{ holding_id: hOf('DEMO-F17', 'CASH-USD'), pct: '1' }, { holding_id: hOf('DEMO-F17', 'AAPL'), pct: '0.5' }] }),
  goal({ id: 'GL-F19-01', family_id: 'DEMO-F19', name: 'Quỹ từ thiện gia đình', type: 'charity', year: 2032, month: 12, amount: '5000000000', priority: 'aspirational', earmarks: [] }),
  goal({ id: 'GL-F20-01', family_id: 'DEMO-F20', name: 'Mua nhà phố', type: 'purchase', year: 2028, month: 12, amount: '8000000000', priority: 'important', earmarks: [{ holding_id: hOf('DEMO-F20', 'FPT'), pct: '1' }, { holding_id: hOf('DEMO-F20', 'VT'), pct: '1' }] }),
]

// ---------- Giá mẫu ----------
const NOTE = 'DỮ LIỆU MẪU – không phải giá thật. Mã chứng khoán, trái phiếu, chứng chỉ quỹ là mã thật; giá là giá mẫu gần mặt bằng thị trường. Cấu trúc đặt theo dữ liệu của nguồn tương ứng.'
const tcbsStocks: Record<string, unknown[]> = {}
const tcbsBonds: Record<string, unknown[]> = {}
const series: Record<string, { date: string; value: number }[]> = {}
for (const inst of Object.values(I)) {
  const target = PRICES[inst.id]
  if (target === undefined) continue
  if (inst.price_source === 'TCBS_STOCK') tcbsStocks[inst.id] = walk(target, 0.018).map(b => ({ tradingDate: b.date, open: Math.round(b.value * 0.995), high: Math.round(b.value * 1.01), low: Math.round(b.value * 0.99), close: b.value, volume: Math.round(1e5 + rnd() * 2e6) }))
  else if (inst.price_source === 'TCBS_BOND') tcbsBonds[inst.id] = walk(target, 0.002).map(b => ({ tradingDate: b.date, cleanPrice: b.value, dirtyPrice: b.value + 800 }))
  else series[inst.id] = walk(target, inst.asset_class === 'CRYPTO' ? 0.04 : inst.currency === 'USD' ? 0.012 : 0.006, inst.currency === 'USD' ? 2 : 0)
}
series['FX:USD'] = walk(25000, 0.002); series['FX:SGD'] = walk(18500, 0.002); series['FX:AUD'] = walk(16500, 0.003)
series['IDX:VNINDEX'] = walk(1650.2, 0.01, 2)
series['RATE:POLICY'] = SESSIONS.map(date => ({ date, value: 4.5 }))
series['RATE:DEPOSIT_12M'] = SESSIONS.map(date => ({ date, value: 5.2 }))
series['GOLD:WORLD_USD'] = walk(3920, 0.01, 1)

out('data/seed/prices/tcbs_sample/stocks.json', { _note: NOTE, data: tcbsStocks })
out('data/seed/prices/tcbs_sample/bonds.json', { _note: NOTE, data: tcbsBonds })
out('data/seed/prices/onemount_sample/valuations.json', { _note: NOTE + ' Định giá căn hộ theo cấu trúc kết quả định giá tự động.', valuations: ONEMOUNT_VALUATIONS })
out('data/seed/prices/sample/series.json', { _note: NOTE, series })

// ---------- Người dùng ----------
out('data/seed/users.json', [
  { id: 'CIO1', name: 'Giám đốc đầu tư (demo)', role: 'CIO', families: [] },
  { id: 'RM1', name: 'RM Nguyễn Thị Hạnh (demo)', role: 'RM', families: allFamilies.filter(f => f.rm_id === 'RM1').map(f => f.id) },
  { id: 'RM2', name: 'RM Trần Văn Khôi (demo)', role: 'RM', families: allFamilies.filter(f => f.rm_id === 'RM2').map(f => f.id) },
  { id: 'RM3', name: 'RM Lê Minh Phương (demo)', role: 'RM', families: allFamilies.filter(f => f.rm_id === 'RM3').map(f => f.id) },
  { id: 'CMP1', name: 'Chuyên viên Tuân thủ (demo)', role: 'COMPLIANCE', families: [] },
  { id: 'CMP2', name: 'Trưởng nhóm Tuân thủ (demo, người xác nhận thứ hai)', role: 'COMPLIANCE', families: [] },
  { id: 'ADM1', name: 'Quản trị hệ thống (demo)', role: 'ADMIN', families: [] },
])
out('data/seed/instruments.json', Object.values(I))
out('data/seed/families.json', allFamilies)
out('data/seed/goals.json', GOALS)

// ---------- Tin và sự kiện mẫu ----------
const news = (id: string, title: string, domain: string, path: string, published_at: string, summary: string) =>
  ({ id, title: `[TIN GIẢ LẬP] ${title}`, source: domain, url: `https://${domain}/${path}`, published_at, summary, language: 'vi', simulated: true })
const NEWS = [
  news('NW-0001', 'Ngân hàng Trung ương (giả lập) tăng lãi suất điều hành thêm 0,5 điểm %', 'tintuc-gialap.example', 'vi-mo/ntw-tang-lai-suat', '2026-10-08T08:00:00+07:00', 'Ngân hàng Trung ương (giả lập) công bố tăng lãi suất điều hành từ 4,5% lên 5%, có hiệu lực từ tuần sau, nhằm kiểm soát lạm phát.'),
  news('NW-0002', 'Lãi suất huy động kỳ hạn 12 tháng dự kiến tăng theo', 'baotaichinh-demo.example', 'ngan-hang/lai-suat-huy-dong', '2026-10-08T10:30:00+07:00', 'Một số ngân hàng hư cấu cho biết sẽ điều chỉnh lãi suất huy động; chi phí vốn của doanh nghiệp vay có thể tăng.'),
  news('NW-0003', 'Thị trường trái phiếu phản ứng với quyết định lãi suất', 'tintuc-gialap.example', 'trai-phieu/phan-ung', '2026-10-08T14:00:00+07:00', 'Lợi suất trái phiếu Chính phủ giả lập kỳ hạn dài tăng; giá trái phiếu kỳ hạn dài giảm mạnh hơn kỳ hạn ngắn.'),
  news('NW-0004', 'Cơ quan quản lý (giả lập) siết tín dụng cho lĩnh vực bất động sản', 'tintuc-gialap.example', 'chinh-sach/siet-tin-dung-bds', '2026-10-08T09:00:00+07:00', 'Quy định giả lập yêu cầu ngân hàng giảm hạn mức cho vay kinh doanh bất động sản và nâng hệ số rủi ro, áp dụng từ quý tới.'),
  news('NW-0005', 'Nhà đầu tư thận trọng sau thông tin siết tín dụng', 'baotaichinh-demo.example', 'chung-khoan/than-trong', '2026-10-08T15:00:00+07:00', 'Chỉ số VNINDEX giảm trong phiên chiều; thanh khoản thị trường thấp hơn trung bình 20 phiên.'),
  news('NW-0006', 'Doanh nghiệp địa ốc (giả lập) đối mặt áp lực dòng tiền', 'tintuc-gialap.example', 'doanh-nghiep/dia-oc-dong-tien', '2026-10-09T08:30:00+07:00', 'Các doanh nghiệp địa ốc hư cấu có tỷ lệ nợ vay cao được dự báo khó huy động vốn mới; cổ phiếu nhóm này chịu áp lực bán.'),
  news('NW-0007', 'Giá vàng thế giới tăng mạnh lên mức cao mới', 'baotaichinh-demo.example', 'hang-hoa/vang-tang', '2026-10-08T21:00:00+07:00', 'Giá vàng thế giới tăng do nhu cầu trú ẩn; giá vàng miếng trong nước giả lập tăng theo.'),
  news('NW-0008', 'Dòng tiền trú ẩn chảy vào vàng và đồng USD', 'tintuc-gialap.example', 'hang-hoa/dong-tien-tru-an', '2026-10-09T07:00:00+07:00', 'Các quỹ hư cấu tăng nắm giữ vàng; tài sản rủi ro như tài sản mã hóa biến động mạnh.'),
  news('NW-0009', 'Tổ chức xếp hạng chỉ số (giả lập) đưa thị trường vào danh sách xem xét nâng hạng', 'baotaichinh-demo.example', 'chung-khoan/nang-hang', '2026-10-08T22:00:00+07:00', 'Thị trường chứng khoán giả lập được đưa vào danh sách xem xét nâng hạng; quyết định chính thức dự kiến trong 6 tháng.'),
  news('NW-0010', 'Khối ngoại (giả lập) mua ròng mạnh sau thông tin nâng hạng', 'tintuc-gialap.example', 'chung-khoan/khoi-ngoai', '2026-10-09T15:00:00+07:00', 'Nhóm cổ phiếu ngân hàng và chứng khoán hư cấu được mua ròng; công ty chứng khoán hưởng lợi từ thanh khoản.'),
  news('NW-0011', 'Quỹ ETF quốc tế (giả lập) chuẩn bị tái cơ cấu danh mục', 'baotaichinh-demo.example', 'quy/etf-tai-co-cau', '2026-10-09T09:00:00+07:00', 'Dòng vốn ngoại có thể đổ vào cổ phiếu vốn hóa lớn; tâm lý thị trường chung tích cực.'),
  news('NW-0012', 'Tỷ giá USD/VND tăng mạnh trên thị trường liên ngân hàng (giả lập)', 'tintuc-gialap.example', 'ty-gia/usd-tang', '2026-10-08T16:00:00+07:00', 'Tỷ giá USD/VND giả lập tăng do đồng USD mạnh lên toàn cầu; áp lực lên các doanh nghiệp vay nợ ngoại tệ.'),
  news('NW-0013', 'Đồng SGD và AUD diễn biến trái chiều so với VND', 'baotaichinh-demo.example', 'ty-gia/sgd-aud', '2026-10-09T10:00:00+07:00', 'SGD tăng nhẹ theo USD; AUD gần như đi ngang do giá hàng hóa giảm.'),
  news('NW-0014', 'Công ty Demo X công bố kế hoạch phát hành cổ phiếu riêng lẻ', 'tintuc-gialap.example', 'doanh-nghiep/demo-x-phat-hanh', '2026-10-09T11:00:00+07:00', 'Công ty Demo X (hư cấu) công bố trên cổng thông tin kế hoạch phát hành riêng lẻ; cổ đông hiện hữu có thể bị pha loãng.'),
  news('NW-0015', 'Ngành công nghiệp (giả lập) kỳ vọng đơn hàng quý tới', 'baotaichinh-demo.example', 'nganh/cong-nghiep', '2026-10-09T13:00:00+07:00', 'Các doanh nghiệp công nghiệp hư cấu kỳ vọng đơn hàng xuất khẩu tăng; Công ty Demo X là một trong các doanh nghiệp được nhắc tới.'),
]
const EVENTS = [
  { id: 'EV-2026-0001', type: 'monetary_policy', title: 'Ngân hàng Trung ương (giả lập) tăng lãi suất điều hành', news: ['NW-0001', 'NW-0002', 'NW-0003'] },
  { id: 'EV-2026-0002', type: 'sector_regulation', title: 'Quy định giả lập siết tín dụng bất động sản', news: ['NW-0004', 'NW-0005', 'NW-0006'] },
  { id: 'EV-2026-0003', type: 'commodity', title: 'Giá vàng thế giới tăng mạnh', news: ['NW-0007', 'NW-0008'] },
  { id: 'EV-2026-0004', type: 'global_macro', title: 'Thông tin nâng hạng thị trường chứng khoán (giả lập)', news: ['NW-0009', 'NW-0010', 'NW-0011'] },
  { id: 'EV-2026-0005', type: 'fx', title: 'Tỷ giá USD/VND tăng mạnh', news: ['NW-0012', 'NW-0013'] },
  { id: 'EV-2026-0006', type: 'corporate', title: 'Công ty Demo X phát hành riêng lẻ', news: ['NW-0014', 'NW-0015'] },
]
out('data/seed/events/news.json', NEWS)
out('data/seed/events/events.json', EVENTS)
// Bộ kiểm thử AC-35: một tin không có đường dẫn công khai và một tin có miền ngoài danh sách
out('data/seed/events/invalid_news_test.json', [
  { title: '[TIN GIẢ LẬP] Tin đồn chưa công bố về sáp nhập', source: 'nguon-noi-bo', url: '', published_at: '2026-10-09T09:00:00+07:00', summary: 'Tin không có đường dẫn công khai.' },
  { title: '[TIN GIẢ LẬP] Bài viết từ diễn đàn không được phép', source: 'dien-dan-khong-ro.example', url: 'https://dien-dan-khong-ro.example/bai-viet', published_at: '2026-10-09T09:00:00+07:00', summary: 'Tin có miền ngoài danh sách nguồn công khai.' },
])

// ---------- Kiểm soát thông tin ----------
out('data/seed/compliance/sources_whitelist.json', [
  { domain: 'tintuc-gialap.example', name: 'Cổng tin giả lập', note: 'Miền giả lập của gói tin mẫu' },
  { domain: 'baotaichinh-demo.example', name: 'Báo tài chính giả lập', note: 'Miền giả lập của gói tin mẫu' },
  { domain: 'congbao-gialap.example', name: 'Công báo giả lập', note: 'Nguồn văn bản chính sách giả lập' },
  { domain: 'duthao-gialap.example', name: 'Cổng lấy ý kiến dự thảo giả lập', note: 'Nguồn văn bản dự thảo giả lập' },
  ...PUBLIC_DOMAINS.map(d => ({ ...d, note: 'Nguồn công khai thật (báo chính thống, cơ quan nhà nước, sở giao dịch)' })),
])
out('data/seed/compliance/restricted_list.json', [
  { id: 'RL-001', issuer: 'Công ty Demo X', instruments: ['DMXYZ'], keywords: ['Công ty Demo X', 'Demo X'], valid_from: '2026-01-01', valid_to: '2026-12-31', reason: 'Tổ chức hư cấu dùng để kiểm thử: giả định ngân hàng đang có quan hệ tư vấn phát hành (chỉ Tuân thủ xem).' },
])

// ---------- Văn bản chính sách giả lập ----------
out('data/seed/policies/sample/PD-2026-001.json', {
  id: 'PD-2026-001', title: '[VĂN BẢN GIẢ LẬP] Dự thảo Luật sửa đổi thuế thu nhập từ chuyển nhượng bất động sản',
  agency: 'Bộ Tài chính (giả lập)', kind: 'draft', status: 'Lấy ý kiến', published_at: '2026-10-07T09:00:00+07:00', effective_expected: '2027-07-01',
  url: 'https://duthao-gialap.example/du-thao/thue-chuyen-nhuong-bds', topics: ['PROPERTY_LAND'], simulated: true,
  content: [
    'Điều 1. Phạm vi điều chỉnh',
    'Dự thảo này sửa đổi cách tính thuế thu nhập đối với cá nhân chuyển nhượng bất động sản.',
    'Điều 3. Căn cứ tính thuế',
    '1. Thuế suất 2% trên giá chuyển nhượng được thay bằng thuế suất 20% trên phần chênh lệch giữa giá bán và giá mua có chứng từ.',
    '2. Trường hợp không xác định được giá mua, áp dụng thuế suất 2% trên giá chuyển nhượng như hiện hành.',
    'Điều 5. Chuyển nhượng nhiều lần',
    '1. Cá nhân chuyển nhượng từ bất động sản thứ hai trở lên trong cùng năm chịu thêm thuế suất bổ sung theo thời gian nắm giữ.',
    '2. Bất động sản nắm giữ dưới 2 năm chịu thuế suất bổ sung 10% trên phần chênh lệch.',
    'Điều 9. Hiệu lực thi hành',
    'Dự kiến có hiệu lực từ ngày 01/07/2027.',
  ].join('\n'),
})
out('data/seed/policies/sample/PD-2026-002.json', {
  id: 'PD-2026-002', title: '[VĂN BẢN GIẢ LẬP] Nghị định hướng dẫn tặng cho, thừa kế cổ phần trong công ty gia đình',
  agency: 'Chính phủ (giả lập)', kind: 'final', status: 'Đã ban hành', published_at: '2026-10-06T16:00:00+07:00', effective_expected: '2026-12-01',
  url: 'https://congbao-gialap.example/nghi-dinh/tang-cho-co-phan', topics: ['INHERITANCE_GIFT', 'CORPORATE_HOLDING'], simulated: true,
  content: [
    'Điều 1. Đối tượng áp dụng',
    'Nghị định áp dụng với cá nhân tặng cho, thừa kế cổ phần, phần vốn góp tại công ty mà các thành viên gia đình nắm quyền chi phối.',
    'Điều 4. Xác định giá trị cổ phần tặng cho',
    '1. Giá trị cổ phần tặng cho được xác định theo giá trị sổ sách tại báo cáo tài chính năm gần nhất đã kiểm toán.',
    '2. Công ty holding phải công bố danh sách thành viên gia đình nắm giữ từ 10% vốn trở lên trong vòng 30 ngày kể từ ngày tặng cho.',
    'Điều 6. Miễn thuế',
    '1. Tặng cho, thừa kế cổ phần giữa cha mẹ và con được miễn thuế thu nhập cá nhân nếu bên nhận cam kết nắm giữ tối thiểu 3 năm.',
    'Điều 8. Hiệu lực thi hành',
    'Nghị định có hiệu lực từ ngày 01/12/2026.',
  ].join('\n'),
})
out('data/seed/policies/provided/README.md', '# Văn bản do người yêu cầu cung cấp\n\nĐặt văn bản chính sách công khai thật vào thư mục này theo cùng cấu trúc JSON với `../sample/PD-2026-001.json`\n(gồm `url` công khai và `published_at`). Khi thư mục có văn bản, demo dùng văn bản thật thay cho văn bản giả lập.\n')

console.log(`Đã sinh ${allFamilies.length} gia đình, ${Object.keys(I).length} công cụ, ${GOALS.length} mục tiêu, ${NEWS.length} tin, ${SESSIONS.length} phiên.`)

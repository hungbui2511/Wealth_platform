// Chế độ mock cho tin mới (không có đầu ra ghi sẵn): lập nhận định theo luật từ khóa, ghi rõ không phải AI.
// Mục đích: bản demo chưa có khóa API vẫn chạy được trọn quy trình với tin thật. Mức tối đa ±2, độ tin cậy thấp.
import { ASSET_CLASSES, ASSET_CLASS_LABELS } from '../shared/catalog'
import type { ImpactLine } from '../shared/types'

type Target = string // mã loại tài sản, hoặc "FX:USD"
const RULES: { phrases: string[]; effects: Record<Target, number>; label: string }[] = [
  { phrases: ['tăng lãi suất', 'lãi suất tăng', 'nâng lãi suất', 'lãi suất huy động tăng', 'hút ròng'], effects: { CASH: 1, GOV_BOND: -1, CORP_BOND: -1, EQ_VN: -1, FUND: -1, REAL_ESTATE: -1 }, label: 'lãi suất tăng' },
  { phrases: ['giảm lãi suất', 'hạ lãi suất', 'lãi suất giảm', 'bơm ròng', 'nới lỏng tiền tệ'], effects: { CASH: -1, GOV_BOND: 1, CORP_BOND: 1, EQ_VN: 1, FUND: 1, REAL_ESTATE: 1 }, label: 'lãi suất giảm' },
  { phrases: ['fed giảm lãi suất', 'fed hạ lãi suất'], effects: { EQ_INTL: 1, 'FX:USD': -1 }, label: 'Fed nới lỏng' },
  { phrases: ['fed tăng lãi suất'], effects: { EQ_INTL: -1, 'FX:USD': 1 }, label: 'Fed thắt chặt' },
  { phrases: ['giá vàng tăng', 'vàng tăng', 'vàng lập đỉnh', 'vàng lên đỉnh', 'vàng tăng mạnh'], effects: { GOLD: 1 }, label: 'giá vàng tăng' },
  { phrases: ['giá vàng giảm', 'vàng giảm', 'vàng lao dốc', 'vàng đảo chiều giảm'], effects: { GOLD: -1 }, label: 'giá vàng giảm' },
  { phrases: ['tỷ giá tăng', 'usd tăng', 'đồng usd mạnh', 'vnd mất giá', 'tỷ giá lập đỉnh'], effects: { 'FX:USD': 1 }, label: 'tỷ giá USD/VND tăng' },
  { phrases: ['tỷ giá giảm', 'usd giảm', 'usd suy yếu', 'đồng usd yếu'], effects: { 'FX:USD': -1 }, label: 'tỷ giá USD/VND giảm' },
  { phrases: ['nâng hạng'], effects: { EQ_VN: 1, FUND: 1 }, label: 'thông tin nâng hạng thị trường' },
  { phrases: ['mua ròng'], effects: { EQ_VN: 1 }, label: 'khối ngoại mua ròng' },
  { phrases: ['bán ròng', 'bán tháo'], effects: { EQ_VN: -1 }, label: 'bán ròng, bán tháo' },
  { phrases: ['vn-index tăng', 'vnindex tăng', 'tăng điểm mạnh'], effects: { EQ_VN: 1 }, label: 'thị trường cổ phiếu tăng điểm' },
  { phrases: ['vn-index giảm', 'vnindex giảm', 'giảm điểm mạnh'], effects: { EQ_VN: -1 }, label: 'thị trường cổ phiếu giảm điểm' },
  { phrases: ['siết tín dụng', 'siết cho vay', 'hạn chế tín dụng bất động sản'], effects: { REAL_ESTATE: -1, CORP_BOND: -1 }, label: 'siết tín dụng' },
  { phrases: ['chậm trả lãi', 'vỡ nợ', 'không trả được nợ', 'gia hạn trái phiếu'], effects: { CORP_BOND: -1 }, label: 'rủi ro trả nợ trái phiếu' },
  { phrases: ['bitcoin tăng', 'tiền số tăng', 'tài sản mã hóa tăng'], effects: { CRYPTO: 1 }, label: 'tài sản mã hóa tăng giá' },
  { phrases: ['bitcoin giảm', 'tiền số giảm', 'tài sản mã hóa giảm'], effects: { CRYPTO: -1 }, label: 'tài sản mã hóa giảm giá' },
]

export interface NewsLite { id: string; title: string; summary: string }

export function keywordView(title: string, news: NewsLite[]): { summary: string; impacts: ImpactLine[] } {
  const acc = new Map<Target, { level: number; why: string[]; src: Set<string> }>()
  for (const r of RULES) {
    const src = news.filter(n => { const t = `${n.title} ${n.summary}`.normalize('NFC').toLowerCase(); return r.phrases.some(p => t.includes(p)) }).map(n => n.id)
    if (!src.length) continue
    for (const [t, lv] of Object.entries(r.effects)) {
      const a = acc.get(t) ?? { level: 0, why: [], src: new Set<string>() }
      a.level += lv; a.why.push(r.label); src.forEach(s => a.src.add(s)); acc.set(t, a)
    }
  }
  const line = (scope: 'asset_class' | 'fx', target: string, label: string): ImpactLine => {
    const a = acc.get(scope === 'fx' ? `FX:${target}` : target)
    const level = a ? Math.max(-2, Math.min(2, a.level)) : 0
    if (!a || level === 0) return { scope, ...(scope === 'asset_class' ? { asset_class: target as never } : {}), target, level: 0, direction: 'insufficient_evidence', rationale: `Chế độ mô phỏng (không phải AI): tin không có từ khóa đủ rõ về ${label}`, source_ids: [] }
    return { scope, ...(scope === 'asset_class' ? { asset_class: target as never } : {}), target, level, direction: level > 0 ? 'positive' : 'negative', horizon: '1-3 tháng', confidence: 'low', rationale: `Chế độ mô phỏng theo từ khóa (không phải AI): tin nhắc tới ${[...new Set(a.why)].join(', ')}; cần CIO kiểm tra lại mức độ`, source_ids: [...a.src].sort() }
  }
  const impacts = [...ASSET_CLASSES.map(ac => line('asset_class', ac, ASSET_CLASS_LABELS[ac].toLowerCase())), ...['USD', 'SGD', 'AUD'].map(c => line('fx', c, `tỷ giá ${c}/VND`))]
  return { summary: `${title} (nhận định mô phỏng theo từ khóa, chưa có AI)`, impacts }
}

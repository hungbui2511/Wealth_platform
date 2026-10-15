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

// Nhánh kịch bản mô phỏng theo từ khóa (không phải AI): mỗi nhóm từ khóa ứng với yếu tố lõi và hướng.
// Nhánh cơ sở (xác suất 0,7, cỡ vừa) và nhánh mạnh hơn dự kiến (0,3, cỡ lớn, chế độ căng thẳng).
const FACTOR_RULES: { phrases: string[]; factor: string; direction: 'up' | 'down' }[] = [
  { phrases: ['tăng lãi suất', 'lãi suất tăng', 'nâng lãi suất', 'lãi suất huy động tăng', 'hút ròng'], factor: 'VN_RATE', direction: 'up' },
  { phrases: ['giảm lãi suất', 'hạ lãi suất', 'lãi suất giảm', 'bơm ròng', 'nới lỏng tiền tệ'], factor: 'VN_RATE', direction: 'down' },
  { phrases: ['fed tăng lãi suất', 'fed giữ lãi suất cao', 'lợi suất trái phiếu mỹ tăng'], factor: 'US10Y', direction: 'up' },
  { phrases: ['fed giảm lãi suất', 'fed hạ lãi suất'], factor: 'US10Y', direction: 'down' },
  { phrases: ['giá vàng tăng', 'vàng tăng', 'vàng lập đỉnh', 'vàng lên đỉnh', 'vàng tăng mạnh'], factor: 'GOLD_W', direction: 'up' },
  { phrases: ['giá vàng giảm', 'vàng giảm', 'vàng lao dốc', 'vàng đảo chiều giảm'], factor: 'GOLD_W', direction: 'down' },
  { phrases: ['tỷ giá tăng', 'usd tăng', 'đồng usd mạnh', 'vnd mất giá', 'tỷ giá lập đỉnh'], factor: 'USDVND', direction: 'up' },
  { phrases: ['tỷ giá giảm', 'usd giảm', 'usd suy yếu', 'đồng usd yếu', 'tỷ giá hạ nhiệt'], factor: 'USDVND', direction: 'down' },
  { phrases: ['mua ròng', 'nâng hạng'], factor: 'FOREIGN_FLOW', direction: 'up' },
  { phrases: ['bán ròng', 'bán tháo'], factor: 'FOREIGN_FLOW', direction: 'down' },
  { phrases: ['vn-index tăng', 'vnindex tăng', 'tăng điểm mạnh'], factor: 'VN_EQ', direction: 'up' },
  { phrases: ['vn-index giảm', 'vnindex giảm', 'giảm điểm mạnh', 'suy yếu'], factor: 'VN_EQ', direction: 'down' },
  { phrases: ['siết tín dụng', 'siết cho vay', 'hạn chế tín dụng bất động sản', 'chậm trả lãi', 'vỡ nợ'], factor: 'CREDIT_RE', direction: 'up' },
  { phrases: ['giá dầu tăng', 'dầu tăng'], factor: 'OIL', direction: 'up' },
  { phrases: ['giá dầu giảm', 'dầu giảm'], factor: 'OIL', direction: 'down' },
  { phrases: ['bitcoin tăng', 'tiền số tăng'], factor: 'CRYPTO', direction: 'up' },
  { phrases: ['bitcoin giảm', 'tiền số giảm'], factor: 'CRYPTO', direction: 'down' },
]

export function keywordScenarios(news: NewsLite[]) {
  const hits = new Map<string, { up: number; down: number; src: Set<string> }>()
  for (const r of FACTOR_RULES) {
    const src = news.filter(n => { const t = `${n.title} ${n.summary}`.normalize('NFC').toLowerCase(); return r.phrases.some(p => t.includes(p)) }).map(n => n.id)
    if (!src.length) continue
    const h = hits.get(r.factor) ?? { up: 0, down: 0, src: new Set<string>() }
    h[r.direction] += src.length; src.forEach(s => h.src.add(s)); hits.set(r.factor, h)
  }
  const core = [...hits.entries()].filter(([, h]) => h.up !== h.down)
    .sort((a, b) => (b[1].up + b[1].down) - (a[1].up + a[1].down) || a[0].localeCompare(b[0])).slice(0, 4)
    .map(([factor, h]) => ({ factor, direction: (h.up > h.down ? 'up' : 'down') as 'up' | 'down', src: [...h.src].sort() }))
  if (!core.length) return undefined
  const src = [...new Set(core.flatMap(c => c.src))]
  const names = core.map(c => `${c.factor} ${c.direction === 'up' ? 'tăng' : 'giảm'}`).join(', ')
  return {
    priced_in: 'partial' as const,
    branches: [
      { id: 'B1', name: 'Cơ sở: diễn biến như tin mô tả', probability: 0.7, regime: 'calm' as const, core_shocks: core.map(c => ({ factor: c.factor, size: 'M' as const, direction: c.direction })), rationale: `Mô phỏng theo từ khóa (không phải AI): tin nhắc tới ${names}`, source_ids: src },
      { id: 'B2', name: 'Bất lợi: diễn biến mạnh hơn dự kiến', probability: 0.3, regime: 'stress' as const, core_shocks: core.map(c => ({ factor: c.factor, size: 'L' as const, direction: c.direction })), rationale: `Mô phỏng theo từ khóa (không phải AI): cùng hướng nhưng cỡ lớn, chế độ căng thẳng`, source_ids: src },
    ],
    notes: 'Nhánh kịch bản mô phỏng theo từ khóa, chưa có AI; CIO cần xem lại xác suất và cỡ cú sốc',
  }
}

// Chế độ mô phỏng cho sự kiện của gói mẫu (đầu ra ghi sẵn chỉ có dòng nhận định): dựng nhánh kịch bản từ dòng nhận định,
// để mọi con số đi qua cùng một bộ máy kịch bản. Ghi rõ không phải AI; CIO xem lại trước khi duyệt.
const LINE_FACTOR: Record<string, { factor: string; sign: 1 | -1 }> = {
  EQ_VN: { factor: 'VN_EQ', sign: 1 }, FUND: { factor: 'VN_EQ', sign: 1 }, EQ_INTL: { factor: 'GLOBAL_EQ', sign: 1 },
  GOLD: { factor: 'GOLD_W', sign: 1 }, GOV_BOND: { factor: 'VN_GOV', sign: -1 }, CORP_BOND: { factor: 'CREDIT_FIN', sign: -1 },
  REAL_ESTATE: { factor: 'VN_RE', sign: 1 }, CRYPTO: { factor: 'CRYPTO', sign: 1 }, 'FX:USD': { factor: 'USDVND', sign: 1 },
}
export function scenariosFromImpacts(impacts: ImpactLine[], sourceIds: string[]) {
  const best = new Map<string, { dir: 'up' | 'down'; mag: number; label: string }>()
  for (const l of impacts) {
    if (l.level === 0 || l.scope === 'instrument') continue
    const key = l.scope === 'fx' ? `FX:${l.target}` : l.scope === 'sector' ? String(l.asset_class) : l.target
    const m = LINE_FACTOR[key]
    if (!m) continue
    const mag = Math.abs(l.level)
    const dir = (Math.sign(l.level) * m.sign) > 0 ? 'up' as const : 'down' as const
    const cur = best.get(m.factor)
    if (!cur || mag > cur.mag) best.set(m.factor, { dir, mag, label: key })
  }
  const core = [...best.entries()].sort((a, b) => b[1].mag - a[1].mag || a[0].localeCompare(b[0])).slice(0, 4)
  if (!core.length || !sourceIds.length) return undefined
  const size = (mag: number, bump: number) => (['S', 'M', 'L'] as const)[Math.min(2, Math.max(0, (mag >= 3 ? 2 : mag >= 2 ? 1 : 0) + bump))]
  const names = core.map(([f, c]) => `${f} ${c.dir === 'up' ? 'tăng' : 'giảm'}`).join(', ')
  return {
    priced_in: 'partial' as const,
    branches: [
      { id: 'B1', name: 'Cơ sở: theo các dòng nhận định', probability: 0.7, regime: 'calm' as const, core_shocks: core.map(([factor, c]) => ({ factor, size: size(c.mag, 0), direction: c.dir })), rationale: `Mô phỏng từ dòng nhận định (không phải AI): ${names}`, source_ids: sourceIds },
      { id: 'B2', name: 'Bất lợi: cùng hướng, mạnh hơn', probability: 0.3, regime: 'stress' as const, core_shocks: core.map(([factor, c]) => ({ factor, size: size(c.mag, 1), direction: c.dir })), rationale: 'Mô phỏng từ dòng nhận định (không phải AI): cỡ lớn hơn một bậc, chế độ căng thẳng', source_ids: sourceIds },
    ],
    notes: 'Nhánh kịch bản dựng từ dòng nhận định của gói mẫu, chưa có AI; CIO cần xem lại xác suất và cỡ cú sốc',
  }
}

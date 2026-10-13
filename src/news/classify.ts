// Phân loại tin theo từ khóa: độ liên quan, loại sự kiện gợi ý, mã chứng khoán được nhắc.
// Dùng khi lấy tin tự động (cả hai chế độ). Không phải phân tích tác động: việc đó do Agent CIO và CIO làm.
import type { EventType } from '../shared/catalog'

const norm = (s: string) => s.normalize('NFC').toLowerCase()

export const TYPE_KEYWORDS: Partial<Record<EventType, string[]>> = {
  monetary_policy: ['lãi suất', 'ngân hàng nhà nước', 'nhnn', 'tín dụng', 'huy động', 'tín phiếu', 'thanh khoản hệ thống', 'cung tiền', 'room tín dụng'],
  fx: ['tỷ giá', 'usd/vnd', 'đồng usd', 'ngoại tệ', 'đô la', 'chỉ số dxy', 'đồng nhân dân tệ'],
  commodity: ['giá vàng', 'vàng miếng', 'vàng sjc', 'giá dầu', 'dầu thô', 'giá thép', 'giá cà phê', 'hàng hóa'],
  fiscal_tax: ['thuế', 'ngân sách', 'đầu tư công', 'giải ngân', 'bộ tài chính'],
  sector_regulation: ['dự thảo', 'nghị định', 'thông tư', 'luật', 'quy định mới', 'ủy ban chứng khoán', 'ubcknn', 'siết'],
  global_macro: ['fed', 'cục dự trữ liên bang', 'kinh tế mỹ', 'trung quốc', 'nâng hạng', 'ftse', 'msci', 'thuế quan', 'lạm phát mỹ', 'ecb', 'federal open market committee', 'fomc', 'monetary policy', 'federal funds', 'interest rate', 'opec', 'kinh tế thế giới'],
  corporate: ['phát hành', 'cổ tức', 'lợi nhuận', 'kết quả kinh doanh', 'trái phiếu doanh nghiệp', 'sáp nhập', 'mua lại', 'đại hội cổ đông', 'chào bán'],
  geopolitical: ['xung đột', 'chiến tranh', 'căng thẳng địa chính trị', 'lệnh trừng phạt'],
}
// Từ khóa chung về thị trường tài chính: tăng độ liên quan nhưng không quyết định loại sự kiện
const MARKET = ['chứng khoán', 'cổ phiếu', 'vn-index', 'vnindex', 'trái phiếu', 'bất động sản', 'ngân hàng', 'quỹ', 'khối ngoại', 'thị trường', 'lạm phát', 'gdp', 'xuất khẩu', 'bitcoin', 'tài sản số', 'tài sản mã hóa']

export interface Classification { relevance: number; suggested_type: EventType; keywords: string[]; tickers: string[] }

export function classifyNews(item: { title: string; summary: string }, tickers: string[] = []): Classification {
  const text = norm(`${item.title} ${item.summary}`)
  const raw = `${item.title} ${item.summary}`
  const hits: string[] = []
  let best: { type: EventType; n: number } = { type: 'corporate', n: 0 }
  for (const [type, kws] of Object.entries(TYPE_KEYWORDS) as [EventType, string[]][]) {
    // Tiêu đề quan trọng gấp đôi phần tóm tắt
    const n = kws.reduce((a, k) => a + (text.includes(k) ? (norm(item.title).includes(k) ? 2 : 1) : 0), 0)
    for (const k of kws) if (text.includes(k)) hits.push(k)
    if (n > best.n) best = { type, n }
  }
  const market = MARKET.filter(k => text.includes(k))
  const found = tickers.filter(t => new RegExp(`(^|[^A-Z0-9])${t}([^A-Z0-9]|$)`).test(raw))
  return { relevance: best.n + market.length + found.length, suggested_type: best.n ? best.type : found.length ? 'corporate' : 'global_macro', keywords: [...new Set([...hits, ...market])].slice(0, 8), tickers: found }
}

// Loại nguồn tin theo thiết kế ba nguồn: quốc tế, trong nước (độc quyền do Khối Nghiên cứu nạp riêng, không qua đây)
export type NewsOrigin = 'global' | 'local' | 'exclusive'
const GLOBAL_HINTS = ['fed', 'mỹ', 'trung quốc', 'châu âu', 'nhật bản', 'thế giới', 'toàn cầu', 'quốc tế', 'ecb', 'opec', 'brent', 'dxy', 'phố wall', 'federal', 'fomc', 'ấn độ', 'eu ', ' nga ', 'trump']
const LOCAL_HINTS = ['việt nam', 'nhnn', 'ngân hàng nhà nước', 'vn-index', 'vnindex', 'hose', 'hnx', 'tp.hcm', 'hà nội', 'trong nước', 'chính phủ', 'bộ tài chính', 'sjc']
export function classifyOrigin(item: { title: string; summary: string }, feedOrigin?: NewsOrigin): NewsOrigin {
  if (feedOrigin === 'global' || feedOrigin === 'exclusive') return feedOrigin
  const t = norm(item.title), all = norm(`${item.title} ${item.summary}`)
  if (LOCAL_HINTS.some(k => all.includes(k))) return 'local'
  return GLOBAL_HINTS.some(k => t.includes(k)) ? 'global' : 'local'
}

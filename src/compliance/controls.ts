// Kiểm soát thông tin BR-26 đến BR-29: chỉ nguồn công khai, danh sách hạn chế, rào chắn, dấu thời gian.

export interface WhitelistEntry { domain: string }
export interface RestrictedEntry { id: string; issuer: string; instruments: string[]; keywords: string[] }

// BR-26: đường dẫn công khai thuộc danh sách nguồn công khai, thời điểm công bố không muộn hơn thời điểm nạp
export function checkPublicSource(item: { url?: string; published_at?: string }, whitelist: WhitelistEntry[], ingestedAt: string): string[] {
  const errs: string[] = []
  let host = ''
  if (!item.url || !item.url.trim()) errs.push('Thiếu đường dẫn công khai')
  else {
    try {
      const u = new URL(item.url)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') errs.push('Đường dẫn phải là http(s)')
      host = u.hostname.toLowerCase()
    } catch { errs.push('Đường dẫn không hợp lệ') }
    if (host && !whitelist.some(w => host === w.domain.toLowerCase() || host.endsWith('.' + w.domain.toLowerCase()))) errs.push(`Miền ${host} không thuộc danh sách nguồn công khai`)
  }
  if (!item.published_at) errs.push('Thiếu thời điểm công bố')
  else if (Number.isNaN(Date.parse(item.published_at))) errs.push('Thời điểm công bố không hợp lệ')
  else if (Date.parse(item.published_at) > Date.parse(ingestedAt)) errs.push('Thời điểm công bố muộn hơn thời điểm nạp')
  return errs
}

// BR-28: nguồn mới chỉ thêm được khi thuộc danh sách nguồn công khai
export function isWhitelistedUrl(url: string, whitelist: WhitelistEntry[]): boolean {
  try { const h = new URL(url).hostname.toLowerCase(); return whitelist.some(w => h === w.domain.toLowerCase() || h.endsWith('.' + w.domain.toLowerCase())) } catch { return false }
}

// BR-27 (1): tin nhắc tới tổ chức trong danh sách hạn chế
export function restrictedHits(texts: string[], entries: RestrictedEntry[]): RestrictedEntry[] {
  const t = texts.join('\n').normalize('NFC').toLowerCase()
  return entries.filter(e => [e.issuer, ...e.keywords, ...e.instruments].some(k => k && t.includes(k.normalize('NFC').toLowerCase())))
}

// BR-27 (3)(4): nội dung nhắc mã hoặc tổ chức hạn chế
export function mentionsRestricted(text: string, entries: RestrictedEntry[]): string[] {
  return restrictedHits([text], entries).map(e => e.id)
}

// BR-29: các mốc phải tăng dần
export const TIMESTAMP_ORDER = ['published_at', 'ingested_at', 'event_created_at', 'view_ready_at', 'approved_at', 'effective_at'] as const
export type TimestampField = (typeof TIMESTAMP_ORDER)[number]

export function checkTimestamp(ts: Partial<Record<TimestampField, string>>, field: TimestampField, value: string): string | null {
  const i = TIMESTAMP_ORDER.indexOf(field)
  const v = Date.parse(value)
  if (Number.isNaN(v)) return `Mốc ${field} không hợp lệ`
  for (let j = 0; j < i; j++) { const p = ts[TIMESTAMP_ORDER[j]]; if (p && Date.parse(p) > v) return `Mốc ${field} (${value}) sớm hơn ${TIMESTAMP_ORDER[j]} (${p})` }
  for (let j = i + 1; j < TIMESTAMP_ORDER.length; j++) { const n = ts[TIMESTAMP_ORDER[j]]; if (n && Date.parse(n) < v) return `Mốc ${field} (${value}) muộn hơn ${TIMESTAMP_ORDER[j]} (${n})` }
  return null
}

export function reactionMs(ts: Partial<Record<TimestampField, string>>): number | null {
  return ts.published_at && ts.effective_at ? Date.parse(ts.effective_at) - Date.parse(ts.published_at) : null
}

// BR-27 (3): che tên tổ chức và mã hạn chế trong nội dung cho RM và bản tin
// So khớp không phân biệt hoa thường, sau chuẩn hóa Unicode NFC (cùng cách với restrictedHits)
export function redactRestricted(text: string, entries: RestrictedEntry[]): string {
  const terms = entries.flatMap(e => [e.issuer, ...e.keywords, ...e.instruments]).filter(Boolean).map(t => t.normalize('NFC')).sort((a, b) => b.length - a.length)
  if (!terms.length) return text
  const re = new RegExp(terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu')
  return text.normalize('NFC').replace(re, '[tổ chức trong danh sách hạn chế]')
}

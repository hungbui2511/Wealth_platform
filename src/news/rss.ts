// Đọc RSS 2.0 và Atom thành danh sách tin (không phụ thuộc thư viện; đủ cho các báo Việt Nam).
export interface FeedItem { title: string; url: string; published_at: string; summary: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}
const unCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
export function stripHtml(s: string): string {
  return decodeEntities(unCdata(s).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}
function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? unCdata(m[1]).trim() : null
}
function toIso(d: string | null): string | null {
  if (!d) return null
  const t = Date.parse(d.trim())
  if (Number.isNaN(t)) {
    // Một số báo dùng dạng "dd/MM/yyyy HH:mm" (giờ Việt Nam)
    const m = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
    if (!m) return null
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] ?? '00').padStart(2, '0')}:${m[5] ?? '00'}:00+07:00`
    return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString()
  }
  return new Date(t).toISOString()
}

export function parseFeed(xml: string, maxSummary = 600): FeedItem[] {
  const out: FeedItem[] = []
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []
  for (const b of blocks) {
    const title = stripHtml(tag(b, 'title') ?? '')
    let url = tag(b, 'link') ?? ''
    if (!url) { const m = b.match(/<link[^>]*href=["']([^"']+)["']/i); url = m?.[1] ?? '' }
    if (!url) url = tag(b, 'guid') ?? ''
    url = decodeEntities(url.trim())
    const published = toIso(tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date'))
    const summary = stripHtml(tag(b, 'description') ?? tag(b, 'summary') ?? tag(b, 'content') ?? '').slice(0, maxSummary)
    if (title && /^https?:\/\//i.test(url) && published) out.push({ title, url, published_at: published, summary })
  }
  return out
}

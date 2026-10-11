// Lấy tin tự động từ nguồn công khai (RSS), theo lịch (cron) hoặc khi CIO/Quản trị bấm "Lấy tin ngay".
// Tin đi qua cùng kiểm soát nguồn công khai (BR-26) như tin dán tay; tin trùng đường dẫn bị bỏ qua.
// Tin vào "hộp tin mới" (chưa thuộc sự kiện). CIO hoặc Quản trị chọn tin để lập sự kiện; agent chỉ chạy trên sự kiện.
import { checkPublicSource, restrictedHits } from '../../compliance/controls'
import { classifyNews } from '../../news/classify'
import { parseFeed } from '../../news/rss'
import { HttpError, makeCtx, requireRole, type AppCtx, type Env } from '../ctx'
import { activeConfig, activeRestricted, loadConfigs } from './config'
import type { NewsItem } from './events'
import { loadInstruments } from './portfolio'

export interface InboxItem extends NewsItem { auto: true; relevance: number; suggested_type: string; keywords: string[]; tickers: string[]; restricted_hit?: boolean; dismissed?: boolean; feed: string }

const MAX_NEW_PER_RUN = 40
const MAX_AGE_DAYS = 3

export async function ingestNews(ctx: AppCtx, opts: { trigger: 'cron' | 'manual' } = { trigger: 'manual' }) {
  const [cfg, sourcesCfg, instruments] = await Promise.all([loadConfigs(ctx), activeConfig<{ name: string; url: string }[]>(ctx, 'NEWS_SOURCES'), loadInstruments(ctx)])
  const sources = sourcesCfg.content ?? []
  const tickers = Object.values(instruments).filter(i => i.listed && /^[A-Z0-9]{3,10}$/.test(i.id) && !i.id.startsWith('DM')).map(i => i.id)
  const now = ctx.now()
  // Đường dẫn đã có (trùng thì bỏ qua): một truy vấn
  const seen = new Set(((await ctx.env.DB.prepare("SELECT json_extract(data, '$.url') AS u FROM news_items ORDER BY id DESC LIMIT 3000").all<{ u: string }>()).results ?? []).map(r => r.u))
  const report = { trigger: opts.trigger, sources: sources.length, fetched: 0, created: 0, duplicate: 0, irrelevant: 0, too_old: 0, rejected: 0, errors: [] as { source: string; error: string }[] }
  const fresh: { feed: string; item: ReturnType<typeof parseFeed>[number] }[] = []
  const results = await Promise.allSettled(sources.map(async s => {
    const res = await ctx.fetchFn(s.url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; WealthPlatformDemo/1.0; +internal demo)', accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return { s, items: parseFeed(await res.text()) }
  }))
  results.forEach((r, i) => {
    if (r.status === 'rejected') { report.errors.push({ source: sources[i].name, error: String((r.reason as Error)?.message ?? r.reason).slice(0, 200) }); return }
    report.fetched += r.value.items.length
    for (const it of r.value.items) fresh.push({ feed: r.value.s.name, item: it })
  })
  const restricted = activeRestricted(cfg, now)
  const candidates: { feed: string; item: ReturnType<typeof parseFeed>[number]; cls: ReturnType<typeof classifyNews> }[] = []
  for (const f of fresh) {
    if (seen.has(f.item.url)) { report.duplicate++; continue }
    seen.add(f.item.url)
    if (Date.parse(now) - Date.parse(f.item.published_at) > MAX_AGE_DAYS * 864e5) { report.too_old++; continue }
    // BR-26: miền thuộc danh sách nguồn công khai, có thời điểm công bố, không muộn hơn lúc nạp
    if (checkPublicSource({ url: f.item.url, published_at: f.item.published_at < now ? f.item.published_at : now }, cfg.whitelist, now).length) { report.rejected++; continue }
    const cls = classifyNews(f.item, tickers)
    if (cls.relevance < 2) { report.irrelevant++; continue }
    candidates.push({ ...f, cls })
  }
  candidates.sort((a, b) => b.cls.relevance - a.cls.relevance || Date.parse(b.item.published_at) - Date.parse(a.item.published_at))
  const take = candidates.slice(0, MAX_NEW_PER_RUN)
  if (take.length) {
    const ids = await ctx.repo.nextIds('news_items', 'NW-', 4, take.length)
    const u = ctx.uow()
    take.forEach((c, i) => {
      const published = c.item.published_at < now ? c.item.published_at : now
      const hit = restrictedHits([c.item.title, c.item.summary], restricted).length > 0
      const n: InboxItem = { id: ids[i], event_id: null as never, title: c.item.title, source: new URL(c.item.url).hostname, url: c.item.url, published_at: published, ingested_at: now, summary: c.item.summary, language: 'vi', simulated: false, auto: true, feed: c.feed, relevance: c.cls.relevance, suggested_type: c.cls.suggested_type, keywords: c.cls.keywords, tickers: c.cls.tickers, ...(hit ? { restricted_hit: true } : {}) }
      u.insert('news_items', n as never)
    })
    report.created = take.length
    u.audit({ actor: opts.trigger === 'cron' ? 'SYSTEM:cron' : `${ctx.user.role}:${ctx.user.id}`, action: 'news.ingested', object: 'NEWS_SOURCES', data: { ...report, news_ids: ids } })
    await u.commit()
  } else if (report.errors.length) {
    const u = ctx.uow(); u.audit({ actor: opts.trigger === 'cron' ? 'SYSTEM:cron' : `${ctx.user.role}:${ctx.user.id}`, action: 'news.ingest_errors', object: 'NEWS_SOURCES', data: report }); await u.commit()
  }
  return report
}

// Cron: chạy với tác nhân hệ thống; bỏ qua nếu cơ sở dữ liệu chưa nạp dữ liệu
export async function scheduledIngest(env: Env) {
  const ctx = makeCtx(env, { id: 'SYSTEM', name: 'Lấy tin tự động', role: 'ADMIN', families: [] })
  const n = await env.DB.prepare('SELECT count(*) AS n FROM config_versions').first<{ n: number }>().catch(() => null)
  if (!n?.n) return { skipped: 'Chưa nạp dữ liệu' }
  try { return await ingestNews(ctx, { trigger: 'cron' }) } catch (err) { console.error('ingest', err); return { error: String(err) } }
}

export async function newsInbox(ctx: AppCtx, opts: { all?: boolean } = {}) {
  requireRole(ctx, 'CIO', 'ADMIN', 'COMPLIANCE')
  const rows = await ctx.repo.list<InboxItem>('news_items', 'event_id IS NULL', [], 'id DESC')
  return rows.filter(r => opts.all || !r.dismissed).slice(0, 150)
}

export async function dismissNews(ctx: AppCtx, ids: string[], dismissed = true) {
  requireRole(ctx, 'CIO', 'ADMIN')
  if (!ids?.length) throw new HttpError(422, 'Chọn ít nhất một tin')
  const u = ctx.uow()
  for (const id of ids) {
    const n = await ctx.repo.get<InboxItem>('news_items', id)
    if (!n || n.event_id) continue
    u.update('news_items', { ...n, dismissed } as never)
  }
  await u.commit()
  return { ok: true }
}

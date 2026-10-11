// Sự kiện, tin tức (M2) và kiểm soát thông tin trên sự kiện (BR-26, BR-27, BR-29).
import { EVENT_TYPES } from '../../shared/catalog'
import { SEED } from '../../data/seed'
import { checkPublicSource, checkTimestamp, restrictedHits, type TimestampField } from '../../compliance/controls'
import { actor, HttpError, requireRole, type AppCtx } from '../ctx'
import type { UnitOfWork } from '../db'
import { activeRestricted, loadConfigs, type Configs } from './config'

export interface NewsItem { id: string; event_id: string; title: string; source: string; url: string; published_at: string; ingested_at: string; summary: string; language: string; simulated: boolean; policy_change?: unknown }
export interface EventRec {
  id: string; type: string; title: string; summary: string; news_ids: string[]; created_by: string; created_at: string
  timestamps: Partial<Record<TimestampField, string>>
  hold?: { status: 'PENDING' | 'ALLOWED'; entries: { id: string; issuer: string }[]; allowed_by?: string; allowed_at?: string; note?: string }
  policy_doc_id?: string
}

export interface NewsInput { title: string; source?: string; url?: string; published_at?: string; summary: string; language?: string; simulated?: boolean; policy_change?: unknown }

export async function createEvent(ctx: AppCtx, input: { type: string; title?: string; items: NewsInput[]; id?: string; newsIds?: string[]; policy_doc_id?: string }, opts: { uow?: UnitOfWork; skipRole?: boolean; cfg?: Configs; fixedId?: string } = {}): Promise<{ event: EventRec; news: NewsItem[] }> {
  if (!opts.skipRole) requireRole(ctx, 'ADMIN')
  if (!EVENT_TYPES.includes(input.type as never)) throw new HttpError(422, `Loại sự kiện không hợp lệ: ${input.type}`)
  if (!input.items?.length) throw new HttpError(422, 'Cần ít nhất một tin')
  const cfg = opts.cfg ?? await loadConfigs(ctx)
  const now = ctx.now()
  // BR-26: thiếu đường dẫn công khai hoặc thời điểm công bố thì không tạo được sự kiện, kể cả tin dán tay
  const problems = input.items.map((it, i) => ({ i, title: it.title, errors: checkPublicSource(it, cfg.whitelist, now) })).filter(p => p.errors.length)
  if (problems.length) {
    const u = ctx.uow()
    u.audit({ actor: actor(ctx), action: 'event.rejected', object: 'BR-26', data: { reason: 'Nguồn không công khai hoặc không hợp lệ', problems } })
    await u.commit()
    throw new HttpError(422, 'Không tạo được sự kiện: tin không qua kiểm soát nguồn công khai (BR-26)', problems)
  }
  const year = now.slice(0, 4)
  const id = opts.fixedId ?? input.id ?? await ctx.repo.nextId('events', `EV-${year}-`, 4)
  if (input.id && await ctx.repo.get('events', id)) throw new HttpError(409, `Sự kiện ${id} đã tồn tại`)
  const news: NewsItem[] = []
  const newsIds = input.newsIds ?? await ctx.repo.nextIds('news_items', 'NW-', 4, input.items.length)
  for (const [i, it] of input.items.entries()) {
    const nid = newsIds[i]
    news.push({ id: nid, event_id: id, title: it.title, source: it.source ?? new URL(it.url!).hostname, url: it.url!, published_at: it.published_at!, ingested_at: now, summary: it.summary, language: it.language ?? 'vi', simulated: it.simulated ?? false, ...(it.policy_change ? { policy_change: it.policy_change } : {}) })
  }
  const published = news.map(n => n.published_at).sort((a, b) => Date.parse(a) - Date.parse(b))[0]
  const hits = restrictedHits(news.flatMap(n => [n.title, n.summary]), activeRestricted(cfg, now))
  const ev: EventRec = {
    id, type: input.type, title: input.title ?? news[0].title.replace(/^\[TIN GIẢ LẬP\]\s*/, ''), summary: news.map(n => n.summary).join(' '),
    news_ids: news.map(n => n.id), created_by: actor(ctx), created_at: now,
    timestamps: { published_at: new Date(published).toISOString(), ingested_at: now, event_created_at: now },
    ...(hits.length ? { hold: { status: 'PENDING' as const, entries: hits.map(h => ({ id: h.id, issuer: h.issuer })) } } : {}),
    ...(input.policy_doc_id ? { policy_doc_id: input.policy_doc_id } : {}),
  }
  const uow = opts.uow ?? ctx.uow()
  for (const n of news) uow.insert('news_items', n as never)
  uow.insert('events', ev as never)
  uow.audit({ actor: actor(ctx), action: 'event.created', object: id, data: { type: ev.type, news: news.map(n => ({ id: n.id, url: n.url, published_at: n.published_at })), restricted_hold: ev.hold ?? null } })
  if (!opts.uow) await uow.commit()
  return { event: ev, news }
}

// Gói sự kiện mẫu (FR-201): tạo sự kiện với mã cố định của gói
export async function loadSampleEvents(ctx: AppCtx) {
  requireRole(ctx, 'ADMIN')
  const created: string[] = []
  const existing = new Set((await ctx.repo.list<EventRec>('events')).map(e => e.id))
  const skipped = SEED.events.filter(e => existing.has(e.id)).map(e => e.id)
  const cfg = await loadConfigs(ctx)
  const uow = ctx.uow()
  // Một lô ghi cho cả gói (NFR-22)
  for (const e of SEED.events.filter(e => !existing.has(e.id))) {
    const items = e.news.map(nid => SEED.news.find(n => n.id === nid)!)
    await createEvent(ctx, { type: e.type, title: e.title, items, newsIds: e.news }, { skipRole: true, uow, cfg, fixedId: e.id })
    created.push(e.id)
  }
  await uow.commit()
  return { created, skipped }
}

export async function getEvent(ctx: AppCtx, id: string): Promise<EventRec> {
  const e = await ctx.repo.get<EventRec>('events', id)
  if (!e) throw new HttpError(404, `Không có sự kiện ${id}`)
  return e
}
export async function eventNews(ctx: AppCtx, e: EventRec): Promise<NewsItem[]> {
  return (await ctx.repo.list<NewsItem>('news_items', 'event_id = ?', [e.id], 'id'))
}

// BR-27 (1): Tuân thủ cho phép sự kiện liên quan danh sách hạn chế
export async function allowEvent(ctx: AppCtx, id: string, note: string) {
  requireRole(ctx, 'COMPLIANCE')
  const e = await getEvent(ctx, id)
  if (!e.hold || e.hold.status !== 'PENDING') throw new HttpError(409, 'Sự kiện không ở trạng thái chờ Tuân thủ cho phép')
  const ne: EventRec = { ...e, hold: { ...e.hold, status: 'ALLOWED', allowed_by: actor(ctx), allowed_at: ctx.now(), note } }
  const u = ctx.uow()
  u.update('events', ne as never)
  u.audit({ actor: actor(ctx), action: 'event.compliance_allowed', object: id, data: { note, entries: e.hold.entries } })
  await u.commit()
  return ne
}

// BR-29: ghi một mốc thời gian; sai thứ tự thì từ chối
export function withTimestamp(e: EventRec, field: TimestampField, value: string): EventRec {
  const err = checkTimestamp(e.timestamps, field, value)
  if (err) throw new HttpError(422, `Mốc thời gian sai thứ tự (BR-29): ${err}`)
  return { ...e, timestamps: { ...e.timestamps, [field]: value } }
}

export async function setTimestamp(ctx: AppCtx, id: string, field: TimestampField, value: string) {
  requireRole(ctx, 'ADMIN', 'COMPLIANCE')
  const e = await getEvent(ctx, id)
  let ne: EventRec
  try { ne = withTimestamp(e, field, value) } catch (err) {
    const u = ctx.uow(); u.audit({ actor: actor(ctx), action: 'event.timestamp_rejected', object: id, data: { field, value, error: (err as Error).message } }); await u.commit()
    throw err
  }
  const u = ctx.uow(); u.update('events', ne as never); u.audit({ actor: actor(ctx), action: 'event.timestamp_set', object: id, data: { field, value } }); await u.commit()
  return ne
}

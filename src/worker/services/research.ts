// Nguồn tin độc quyền (thiết kế v2): báo cáo nghiên cứu và house view của Techcombank/TCBS đã phát hành chính thức.
// Khối Nghiên cứu (vai trò CIO hoặc Quản trị trong demo) nạp báo cáo → Tuân thủ cho phát hành → tin vào hộp tin với nhãn "độc quyền".
// Rào chắn: bản nháp và báo cáo chưa tới giờ phát hành không vào hộp tin và không được gắn vào sự kiện; agent không đọc được.
import { restrictedHits } from '../../compliance/controls'
import { actor, HttpError, minReason, requireRole, type AppCtx } from '../ctx'
import { activeRestricted, loadConfigs } from './config'
import type { NewsItem } from './events'

export interface ResearchInput { doc_no: string; title: string; summary: string; unit?: string; kind?: 'research' | 'house_view'; published_at: string; conflict_disclosure?: string }

export async function listResearch(ctx: AppCtx) {
  requireRole(ctx, 'CIO', 'ADMIN', 'COMPLIANCE')
  return (await ctx.repo.list<NewsItem>('news_items', '', [], 'id DESC')).filter(n => n.origin === 'exclusive')
}

export async function submitResearch(ctx: AppCtx, b: ResearchInput) {
  requireRole(ctx, 'CIO', 'ADMIN')
  const doc = String(b.doc_no ?? '').trim()
  if (!/^[A-Za-z0-9._\-/]{3,40}$/.test(doc)) throw new HttpError(422, 'Số báo cáo không hợp lệ (3–40 ký tự chữ, số, - _ . /)')
  if (!b.title || b.title.trim().length < 10) throw new HttpError(422, 'Tiêu đề tối thiểu 10 ký tự')
  if (!b.summary || b.summary.trim().length < 40) throw new HttpError(422, 'Tóm tắt luận điểm tối thiểu 40 ký tự')
  if (Number.isNaN(Date.parse(b.published_at))) throw new HttpError(422, 'Thiếu giờ phát hành chính thức')
  const url = `tcb-research:${doc}`
  if ((await ctx.repo.list<NewsItem>('news_items', "json_extract(data, '$.url') = ?", [url])).length) throw new HttpError(409, `Báo cáo ${doc} đã được nạp`)
  const now = ctx.now()
  const [id] = await ctx.repo.nextIds('news_items', 'NW-', 4, 1)
  const n: NewsItem & { auto: true; relevance: number; suggested_type: string; keywords: string[]; tickers: string[]; feed: string } = {
    id, event_id: null as never, title: b.title.trim().slice(0, 300), source: b.unit?.trim() || 'Khối Nghiên cứu Techcombank', url,
    published_at: new Date(b.published_at).toISOString(), ingested_at: now, summary: b.summary.trim().slice(0, 3000), language: 'vi', simulated: false,
    origin: 'exclusive', auto: true, relevance: 99, suggested_type: 'global_macro', keywords: [], tickers: [], feed: 'Nghiên cứu nội bộ',
    research: { doc_no: doc, unit: b.unit?.trim() || 'Khối Nghiên cứu Techcombank', kind: b.kind === 'house_view' ? 'house_view' : 'research', status: 'PENDING_RELEASE', submitted_by: actor(ctx), submitted_at: now, ...(b.conflict_disclosure ? { conflict_disclosure: b.conflict_disclosure.slice(0, 500) } : {}) },
  }
  const u = ctx.uow(); u.insert('news_items', n as never); u.audit({ actor: actor(ctx), action: 'research.submitted', object: id, data: { doc_no: doc, published_at: n.published_at, kind: n.research!.kind } }); await u.commit()
  return n
}

// Tuân thủ cho phát hành: xác nhận báo cáo đã phát hành chính thức, không chứa thông tin nội bộ chưa công bố, có công bố xung đột lợi ích khi cần
export async function releaseResearch(ctx: AppCtx, id: string, approve: boolean, noteRaw: unknown) {
  requireRole(ctx, 'COMPLIANCE')
  const note = minReason(noteRaw, 'Ghi chú của Tuân thủ')
  const n = await ctx.repo.get<NewsItem>('news_items', id)
  if (!n || n.origin !== 'exclusive' || !n.research) throw new HttpError(404, `Không có báo cáo nghiên cứu ${id}`)
  if (n.research.status !== 'PENDING_RELEASE') throw new HttpError(409, 'Báo cáo không ở trạng thái chờ phát hành')
  if (n.research.submitted_by.endsWith(`:${ctx.user.id}`)) throw new HttpError(409, 'Người cho phát hành phải khác người nạp báo cáo')
  if (approve) {
    const hits = restrictedHits([n.title, n.summary], activeRestricted(await loadConfigs(ctx), ctx.now()))
    if (hits.length) throw new HttpError(409, 'Báo cáo nhắc tổ chức trong danh sách hạn chế: không cho phát hành vào hệ thống (BR-27)')
  }
  const nn: NewsItem = { ...n, research: { ...n.research, status: approve ? 'RELEASED' : 'REJECTED', released_by: actor(ctx), released_at: ctx.now(), note } }
  const u = ctx.uow(); u.update('news_items', nn as never); u.audit({ actor: actor(ctx), action: approve ? 'research.released' : 'research.rejected', object: id, data: { doc_no: n.research.doc_no, note, published_at: n.published_at } }); await u.commit()
  return nn
}

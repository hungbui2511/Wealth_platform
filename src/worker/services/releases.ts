// Bản tin CIO (FR-1008): nội dung chung, hai mốc phát hành (Private sớm hơn đại chúng), Tuân thủ duyệt; MVP1 không gửi.
import { ASSET_CLASS_LABELS, SECTOR_LABELS } from '../../shared/catalog'
import { checkText, extractNumbers } from '../../engine/numbercheck'
import { mentionsRestricted, redactRestricted, type RestrictedEntry } from '../../compliance/controls'
import { actor, HttpError, minReason, requireRole, type AppCtx } from '../ctx'
import { activeRestricted, loadConfigs } from './config'
import { getView, type ViewRec } from './views'

export interface ReleaseRec {
  id: string; view_id: string; status: 'DRAFT' | 'PENDING_COMPLIANCE' | 'APPROVED' | 'REJECTED'
  content: string; release_private_at: string; release_public_at: string
  created_by: string; created_at: string; reviewed_by?: string; reviewed_at?: string; review_note?: string; checks?: ReturnType<typeof releaseChecks> extends Promise<infer T> ? T : never
}

const label = (t: string) => (ASSET_CLASS_LABELS as Record<string, string>)[t] ?? (SECTOR_LABELS as Record<string, string>)[t] ?? t
const dirWord = (lv: number) => lv > 0 ? 'tích cực' : 'tiêu cực'

export function draftContent(v: ViewRec, restricted: RestrictedEntry[] = []): string {
  const lines = v.body.impacts.filter(l => l.level !== 0 && !(l.scope === 'instrument' && restricted.some(r => r.instruments.includes(l.target))))
  return redactRestricted([
    `Quan điểm CIO: ${v.body.summary}.`,
    ...lines.map(l => `- ${l.scope === 'sector' ? `${label(l.asset_class!)} – ngành ${label(l.target)}` : l.scope === 'fx' ? `Tỷ giá ${l.target}/VND` : l.scope === 'instrument' ? `Mã ${l.target}` : label(l.target)}: tác động ${dirWord(l.level)} (mức ${l.level}), ${l.horizon ?? ''}. ${l.rationale}.`),
    'Nội dung mang tính thông tin chung về thị trường, không phải khuyến nghị đầu tư cho cá nhân.',
  ].join('\n'), restricted)
}

// Bản tin qua BR-13 (số chỉ từ nhận định đã duyệt), BR-14 (cụm từ cấm), BR-27 (không nhắc mã hạn chế); không chứa dữ liệu gia đình
export async function releaseChecks(ctx: AppCtx, v: ViewRec, content: string) {
  const cfg = await loadConfigs(ctx)
  const fromView = extractNumbers([v.body.summary, ...v.body.impacts.map(l => l.rationale)].join('\n'))
  const allowed = { money: fromView.filter(n => n.kind === 'money').map(n => n.value), pct: fromView.filter(n => n.kind === 'pct').map(n => n.value), plain: [...v.body.impacts.flatMap(l => [l.level, Math.abs(l.level)]), ...fromView.filter(n => n.kind === 'plain').map(n => n.value)] }
  const num = checkText(content, allowed, cfg.banned)
  const restricted = mentionsRestricted(content, activeRestricted(cfg, ctx.now()))
  const familyData = /DEMO-F\d{2}|tài sản ròng của gia đình|Gia đình [A-ZĐ]/.test(content)
  return { ok: num.ok && !restricted.length && !familyData, violations: num.violations, restricted, family_data: familyData }
}

function checkTimes(v: ViewRec, priv: string, pub: string) {
  if (Number.isNaN(Date.parse(priv)) || Number.isNaN(Date.parse(pub))) throw new HttpError(422, 'Mốc phát hành không hợp lệ')
  if (Date.parse(priv) >= Date.parse(pub)) throw new HttpError(422, 'Mốc phát hành cho khách Private phải sớm hơn mốc đại chúng')
  if (v.approved_at && Date.parse(priv) < Date.parse(v.approved_at)) throw new HttpError(422, 'Mốc phát hành không được sớm hơn thời điểm CIO duyệt (BR-29)')
}

export async function createRelease(ctx: AppCtx, body: { view_id: string; release_private_at: string; release_public_at: string; content?: string }) {
  requireRole(ctx, 'CIO')
  const v = await getView(ctx, body.view_id)
  if (!['APPROVED', 'SUPERSEDED'].includes(v.status)) throw new HttpError(409, 'Chỉ tạo bản tin từ nhận định đã duyệt')
  checkTimes(v, body.release_private_at, body.release_public_at)
  const n = (await ctx.repo.list('research_releases', 'view_id = ?', [v.id])).length
  const content = body.content ?? draftContent(v, activeRestricted(await loadConfigs(ctx), ctx.now()))
  const r: ReleaseRec = { id: `RR-${v.event_id.slice(-4)}-v${v.version}${n ? `-${n + 1}` : ''}`, view_id: v.id, status: 'DRAFT', content, release_private_at: new Date(body.release_private_at).toISOString(), release_public_at: new Date(body.release_public_at).toISOString(), created_by: actor(ctx), created_at: ctx.now() }
  r.checks = await releaseChecks(ctx, v, content)
  const u = ctx.uow(); u.put('research_releases', r as never); u.audit({ actor: actor(ctx), action: 'release.created', object: r.id, data: { view_id: v.id, release_private_at: r.release_private_at, release_public_at: r.release_public_at, checks: r.checks } }); await u.commit()
  return r
}

async function getRelease(ctx: AppCtx, id: string) {
  const r = await ctx.repo.get<ReleaseRec>('research_releases', id)
  if (!r) throw new HttpError(404, `Không có bản tin ${id}`)
  return r
}

export async function updateRelease(ctx: AppCtx, id: string, body: { content?: string; release_private_at?: string; release_public_at?: string }) {
  requireRole(ctx, 'CIO')
  const r = await getRelease(ctx, id)
  if (r.status !== 'DRAFT' && r.status !== 'REJECTED') throw new HttpError(409, 'Chỉ sửa bản tin ở trạng thái nháp hoặc bị từ chối')
  const v = await getView(ctx, r.view_id)
  const nr = { ...r, status: 'DRAFT' as const, content: body.content ?? r.content, release_private_at: body.release_private_at ?? r.release_private_at, release_public_at: body.release_public_at ?? r.release_public_at }
  checkTimes(v, nr.release_private_at, nr.release_public_at)
  nr.checks = await releaseChecks(ctx, v, nr.content)
  const u = ctx.uow(); u.put('research_releases', nr as never); u.audit({ actor: actor(ctx), action: 'release.updated', object: id, data: { checks: nr.checks } }); await u.commit()
  return nr
}

export async function submitRelease(ctx: AppCtx, id: string) {
  requireRole(ctx, 'CIO')
  const r = await getRelease(ctx, id)
  if (r.status !== 'DRAFT') throw new HttpError(409, 'Chỉ gửi duyệt bản tin nháp')
  const nr = { ...r, status: 'PENDING_COMPLIANCE' as const }
  const u = ctx.uow(); u.put('research_releases', nr as never); u.audit({ actor: actor(ctx), action: 'release.submitted', object: id, data: {} }); await u.commit()
  return nr
}

export async function reviewRelease(ctx: AppCtx, id: string, approve: boolean, noteRaw: unknown) {
  requireRole(ctx, 'COMPLIANCE')
  const note = minReason(noteRaw, 'Ghi chú duyệt')
  const r = await getRelease(ctx, id)
  if (r.status !== 'PENDING_COMPLIANCE') throw new HttpError(409, 'Bản tin không ở trạng thái chờ Tuân thủ')
  const v = await getView(ctx, r.view_id)
  const checks = await releaseChecks(ctx, v, r.content)
  if (approve && !checks.ok) throw new HttpError(409, 'Bản tin vi phạm BR-13, BR-14 hoặc nhắc mã hạn chế (BR-27): không được duyệt phát hành', checks)
  const nr = { ...r, status: approve ? 'APPROVED' as const : 'REJECTED' as const, reviewed_by: actor(ctx), reviewed_at: ctx.now(), review_note: note, checks }
  const u = ctx.uow(); u.put('research_releases', nr as never); u.audit({ actor: actor(ctx), action: approve ? 'release.approved' : 'release.rejected', object: id, data: { note, checks } }); await u.commit()
  return nr
}

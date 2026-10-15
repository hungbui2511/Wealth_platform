// Quản trị cấu hình có phiên bản (BR-06): không sửa đè, lý do ≥ 20 ký tự, ghi nhật ký; prompt và mô hình cần hai người.
import { DEFAULT_ASSUMPTIONS, DEFAULT_BANNED_PHRASES, DEFAULT_THRESHOLDS, DEFAULT_UNIT_TABLE } from '../../shared/catalog'
import { SEED } from '../../data/seed'
import { DEFAULT_MODELS, DEFAULT_PROMPTS } from '../../agents/prompts'
import { DEFAULT_NEWS_SOURCES, PUBLIC_DOMAINS } from '../../news/sources'
import { DEFAULT_FACTOR_MODEL } from '../../data/factorModel'
import type { FactorModel } from '../../engine/scenario'
import { actor, HttpError, minReason, requireRole, samePerson, type AppCtx, type Role } from '../ctx'
import { factorModelErrors } from '../../engine/scenario'
import type { UnitOfWork } from '../db'

// twoPerson: phiên bản mới chỉ có hiệu lực khi người có vai trò confirmer (và khác người đề xuất) xác nhận.
// Các cấu hình làm đổi con số tới khách hoặc quyết định cho AI xem gì đều cần hai người.
export const CONFIG_KINDS = {
  UNIT: { label: 'Bảng đơn vị cú sốc u, u_fx (chỉ còn dùng để đối chiếu)', owner: 'CIO', twoPerson: false },
  THRESHOLD: { label: 'Ngưỡng cảnh báo, hậu kiểm, thanh khoản, mục tiêu', owner: 'CIO', twoPerson: true, confirmer: 'COMPLIANCE' },
  ASSUMPTION: { label: 'Giả định dài hạn (lợi suất, lạm phát)', owner: 'CIO', twoPerson: false },
  BANNED: { label: 'Danh sách cụm từ cấm', owner: 'COMPLIANCE', twoPerson: false },
  WHITELIST: { label: 'Danh sách nguồn công khai', owner: 'COMPLIANCE', twoPerson: false },
  RESTRICTED: { label: 'Danh sách hạn chế', owner: 'COMPLIANCE', twoPerson: true, confirmer: 'COMPLIANCE' },
  PROMPT: { label: 'Prompt của agent', owner: 'ADMIN', twoPerson: true, confirmer: 'COMPLIANCE' },
  MODEL: { label: 'Mô hình AI của agent', owner: 'ADMIN', twoPerson: true, confirmer: 'COMPLIANCE' },
  PRICE_SOURCE: { label: 'Cấu hình nguồn giá (mã thỏa thuận dữ liệu)', owner: 'ADMIN', twoPerson: false },
  ONEMOUNT_CONFIRM: { label: 'Tuân thủ xác nhận căn cứ chia sẻ dữ liệu với One Mount (BR-22)', owner: 'COMPLIANCE', twoPerson: false },
  SYMBOL_MAP: { label: 'Bảng ánh xạ mã công cụ sang mã thị trường', owner: 'ADMIN', twoPerson: false },
  NEWS_SOURCES: { label: 'Nguồn tin cấu hình', owner: 'ADMIN', twoPerson: false },
  // Xác nhận thứ hai: bản demo dùng vai trò Tuân thủ; bản thật là bộ phận Rủi ro mô hình (độc lập với CIO)
  FACTOR_MODEL: { label: 'Mô hình yếu tố rủi ro: thư viện cú sốc, tương quan, độ nhạy', owner: 'CIO', twoPerson: true, confirmer: 'COMPLIANCE' },
} as const satisfies Record<string, { label: string; owner: Role; twoPerson: boolean; confirmer?: Role }>
export type ConfigKind = keyof typeof CONFIG_KINDS

export interface ConfigVersion {
  id: string; kind: ConfigKind; seq: number; status: 'ACTIVE' | 'SUPERSEDED' | 'PENDING_CONFIRM' | 'REJECTED'
  created_at: string; content: unknown; proposed_by: string; confirmed_by?: string; confirmed_at?: string
  reason: string; effective_at?: string
}

function mergedWhitelist(): { domain: string; name: string }[] {
  const list = [...(SEED.whitelist as { domain: string; name: string }[])]
  for (const d of PUBLIC_DOMAINS) if (!list.some(x => x.domain === d.domain)) list.push(d)
  return list
}

export function initialConfigs(now: string): ConfigVersion[] {
  const base = (kind: ConfigKind, content: unknown): ConfigVersion => ({ id: `CFG-${kind}-1`, kind, seq: 1, status: 'ACTIVE', created_at: now, effective_at: now, content, proposed_by: 'SYSTEM:seed', reason: 'Giá trị khởi tạo minh họa từ BRD Mục 7.1' })
  return [
    base('UNIT', DEFAULT_UNIT_TABLE), base('THRESHOLD', DEFAULT_THRESHOLDS), base('ASSUMPTION', DEFAULT_ASSUMPTIONS),
    base('BANNED', DEFAULT_BANNED_PHRASES), base('WHITELIST', mergedWhitelist()), base('RESTRICTED', SEED.restricted),
    base('PROMPT', DEFAULT_PROMPTS), base('MODEL', DEFAULT_MODELS),
    base('PRICE_SOURCE', { agreements: { TCBS_STOCK: null, TCBS_BOND: null, ONEMOUNT: null } }),
    base('ONEMOUNT_CONFIRM', { confirmed: false }),
    base('SYMBOL_MAP', {}), base('NEWS_SOURCES', DEFAULT_NEWS_SOURCES),
    { ...base('FACTOR_MODEL', DEFAULT_FACTOR_MODEL), reason: 'Mô hình yếu tố mặc định: beta cổ phiếu ước lượng từ giá tuần TCBS 2022–2026; các yếu tố khác là giả định minh họa chờ CIO hiệu chỉnh' },
  ]
}

export async function activeConfig<T = unknown>(ctx: AppCtx, kind: ConfigKind): Promise<{ version: ConfigVersion; content: T }> {
  const rows = await ctx.repo.list<ConfigVersion>('config_versions', "kind = ? AND status = 'ACTIVE'", [kind], 'seq DESC')
  if (!rows.length) throw new HttpError(500, `Chưa có cấu hình ${kind}`)
  return { version: rows[0], content: rows[0].content as T }
}

export async function configById(ctx: AppCtx, id: string): Promise<ConfigVersion> {
  const v = await ctx.repo.get<ConfigVersion>('config_versions', id)
  if (!v) throw new HttpError(404, `Không có phiên bản cấu hình ${id}`)
  return v
}

export interface Configs {
  unit: { u: Record<string, string>; u_fx: Record<string, string> }
  thresholds: typeof DEFAULT_THRESHOLDS
  assumptions: { inflation: string; r: Record<string, string> }
  banned: string[]
  restricted: { id: string; issuer: string; instruments: string[]; keywords: string[]; valid_from: string; valid_to: string; reason: string }[]
  whitelist: { domain: string; name: string }[]
  ids: Record<string, string>
}

export async function loadConfigs(ctx: AppCtx): Promise<Configs> {
  const kinds: ConfigKind[] = ['UNIT', 'THRESHOLD', 'ASSUMPTION', 'BANNED', 'RESTRICTED', 'WHITELIST']
  const all = await ctx.repo.list<ConfigVersion>('config_versions', "status = 'ACTIVE'")
  const pick = (k: ConfigKind) => all.filter(v => v.kind === k).sort((a, b) => b.seq - a.seq)[0]
  for (const k of kinds) if (!pick(k)) throw new HttpError(500, `Chưa có cấu hình ${k}`)
  return {
    unit: pick('UNIT').content as Configs['unit'], thresholds: pick('THRESHOLD').content as Configs['thresholds'],
    assumptions: pick('ASSUMPTION').content as Configs['assumptions'], banned: pick('BANNED').content as string[],
    restricted: pick('RESTRICTED').content as Configs['restricted'], whitelist: pick('WHITELIST').content as Configs['whitelist'],
    ids: Object.fromEntries(kinds.map(k => [k, pick(k).id])),
  }
}

// Mô hình yếu tố đang hiệu lực; cơ sở dữ liệu cũ chưa có thì dùng bản mặc định (ghi rõ id)
export async function loadFactorModel(ctx: AppCtx): Promise<{ id: string; model: FactorModel }> {
  const rows = await ctx.repo.list<ConfigVersion>('config_versions', "kind = 'FACTOR_MODEL' AND status = 'ACTIVE'", [], 'seq DESC')
  if (rows.length) return { id: rows[0].id, model: rows[0].content as FactorModel }
  return { id: 'DEFAULT-FACTOR_MODEL', model: DEFAULT_FACTOR_MODEL as unknown as FactorModel }
}

export function activeRestricted(cfg: Configs, date: string) {
  const d = date.slice(0, 10)
  return cfg.restricted.filter(r => r.valid_from <= d && d <= r.valid_to)
}

function validateContent(kind: ConfigKind, content: unknown) {
  const bad = (m: string) => { throw new HttpError(422, `Nội dung cấu hình ${kind} không hợp lệ: ${m}`) }
  const isNum = (v: unknown) => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)
  if (kind === 'UNIT') {
    const c = content as Configs['unit']
    if (!c?.u || !c?.u_fx) bad('cần u và u_fx')
    for (const [k, v] of [...Object.entries(c.u), ...Object.entries(c.u_fx)]) if (!isNum(v) || Number(v) < 0) bad(`${k} phải là số thập phân không âm (ví dụ "0.025")`)
  }
  if (kind === 'FACTOR_MODEL') {
    const c = content as FactorModel
    if (!Array.isArray(c?.factors) || !c.corr?.calm || !c.corr?.stress) bad('cần factors, corr.calm, corr.stress')
    const n = c.factors.length
    for (const r of ['calm', 'stress'] as const) if (c.corr[r].length !== n || c.corr[r].some(row => row.length !== n)) bad(`ma trận tương quan ${r} phải ${n}×${n}`)
    for (const f of c.factors) if (!f.library || !['S', 'M', 'L'].every(k => typeof f.library[k as 'S'] === 'number')) bad(`yếu tố ${f.id} thiếu thư viện cú sốc S/M/L`)
    const errs = factorModelErrors(c)
    if (errs.length) throw new HttpError(422, `Nội dung cấu hình ${kind} không hợp lệ`, errs)
  }
  if (kind === 'BANNED' && !(Array.isArray(content) && content.every(x => typeof x === 'string'))) bad('cần danh sách chuỗi')
  if (kind === 'WHITELIST' && !(Array.isArray(content) && content.every(x => typeof (x as { domain?: unknown }).domain === 'string'))) bad('mỗi mục cần domain')
  if (kind === 'RESTRICTED' && !(Array.isArray(content) && content.every(x => Array.isArray((x as { instruments?: unknown }).instruments)))) bad('mỗi mục cần danh sách mã công cụ')
  if (kind === 'PRICE_SOURCE' && (typeof content !== 'object' || content === null || typeof (content as { agreements?: unknown }).agreements !== 'object')) bad('cần agreements')
  if (kind === 'PRICE_SOURCE' && 'onemount_compliance_confirmed' in (content as object)) bad('cờ xác nhận One Mount do Tuân thủ đặt trong ONEMOUNT_CONFIRM (BR-22)')
  if (kind === 'ONEMOUNT_CONFIRM' && typeof (content as { confirmed?: unknown })?.confirmed !== 'boolean') bad('cần confirmed: true hoặc false')
}

// Đề xuất (và với loại một người: áp dụng ngay) một phiên bản mới
export async function proposeConfig(ctx: AppCtx, kind: ConfigKind, content: unknown, reasonRaw: unknown, uowIn?: UnitOfWork): Promise<ConfigVersion> {
  const meta = CONFIG_KINDS[kind]
  if (!meta) throw new HttpError(404, `Loại cấu hình không tồn tại: ${kind}`)
  requireRole(ctx, meta.owner)
  const reason = minReason(reasonRaw)
  validateContent(kind, content)
  const seq = await ctx.repo.nextSeq(`config:${kind}`, 'SELECT max(seq) FROM config_versions WHERE kind = ?', [kind])
  const now = ctx.now()
  const v: ConfigVersion = { id: `CFG-${kind}-${seq}`, kind, seq, status: meta.twoPerson ? 'PENDING_CONFIRM' : 'ACTIVE', created_at: now, content, proposed_by: actor(ctx), reason, ...(meta.twoPerson ? {} : { effective_at: now }) }
  const uow = uowIn ?? ctx.uow()
  if (!meta.twoPerson) for (const old of await ctx.repo.list<ConfigVersion>('config_versions', "kind = ? AND status = 'ACTIVE'", [kind])) uow.update('config_versions', { ...old, status: 'SUPERSEDED' } as never)
  uow.insert('config_versions', v as never)
  uow.audit({ actor: actor(ctx), action: meta.twoPerson ? 'config.proposed' : 'config.changed', object: v.id, data: { kind, reason, content } })
  if (!uowIn) await uow.commit()
  return v
}

// Người thứ hai xác nhận (quy trình hai người): prompt, mô hình AI, mô hình yếu tố, ngưỡng, danh sách hạn chế
export async function decideConfig(ctx: AppCtx, id: string, approve: boolean, reasonRaw: unknown): Promise<ConfigVersion> {
  const reason = minReason(reasonRaw)
  const v = await configById(ctx, id)
  const meta = CONFIG_KINDS[v.kind] as { confirmer?: Role }
  requireRole(ctx, meta.confirmer ?? 'COMPLIANCE')
  if (v.status !== 'PENDING_CONFIRM') throw new HttpError(409, `Phiên bản ${id} không ở trạng thái chờ xác nhận`)
  if (samePerson(ctx, v.proposed_by)) throw new HttpError(409, 'Người xác nhận phải khác người đề xuất')
  const uow = ctx.uow()
  const now = ctx.now()
  if (approve) for (const old of await ctx.repo.list<ConfigVersion>('config_versions', "kind = ? AND status = 'ACTIVE'", [v.kind])) uow.update('config_versions', { ...old, status: 'SUPERSEDED' } as never)
  const nv: ConfigVersion = { ...v, status: approve ? 'ACTIVE' : 'REJECTED', confirmed_by: actor(ctx), confirmed_at: now, ...(approve ? { effective_at: now } : {}) }
  uow.update('config_versions', nv as never)
  uow.audit({ actor: actor(ctx), action: approve ? 'config.confirmed' : 'config.rejected', object: id, data: { kind: v.kind, reason } })
  await uow.commit()
  return nv
}

// Lý do đưa vào danh sách hạn chế chỉ Tuân thủ xem được (FR-1009)
export function redactConfig(ctx: AppCtx, v: ConfigVersion): ConfigVersion {
  // RM không được biết tổ chức nào nằm trong danh sách hạn chế (BR-27)
  if (v.kind === 'RESTRICTED' && ctx.user.role === 'RM') return { ...v, content: [] }
  if (v.kind === 'RESTRICTED' && ctx.user.role !== 'COMPLIANCE') return { ...v, content: (v.content as Configs['restricted']).map(({ reason, ...r }) => r) }
  return v
}

// Bản đề xuất từ mặc định mới nhất (để chủ sở hữu xem rồi tự lưu kèm lý do): gộp phần mới vào cấu hình đang hiệu lực
export async function defaultProposal(ctx: AppCtx, kind: ConfigKind): Promise<unknown> {
  const meta = CONFIG_KINDS[kind]
  if (!meta) throw new HttpError(404, `Loại cấu hình không tồn tại: ${kind}`)
  requireRole(ctx, meta.owner)
  const cur = (await ctx.repo.list<ConfigVersion>('config_versions', "kind = ? AND status = 'ACTIVE'", [kind], 'seq DESC'))[0]?.content
  if (kind === 'NEWS_SOURCES') {
    const list = [...((cur as { name: string; url: string; origin?: string }[]) ?? [])]
    for (const d of DEFAULT_NEWS_SOURCES) { const i = list.findIndex(x => x.url === d.url); if (i < 0) list.push(d); else if (d.origin && !list[i].origin) list[i] = { ...list[i], origin: d.origin } }
    return list
  }
  if (kind === 'WHITELIST') {
    const list = [...((cur as { domain: string; name: string }[]) ?? [])]
    for (const d of mergedWhitelist()) if (!list.some(x => x.domain === d.domain)) list.push(d)
    return list
  }
  if (kind === 'FACTOR_MODEL') return DEFAULT_FACTOR_MODEL
  throw new HttpError(422, `Không có bản mặc định đề xuất cho ${kind}`)
}

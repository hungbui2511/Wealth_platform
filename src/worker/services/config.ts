// Quản trị cấu hình có phiên bản (BR-06): không sửa đè, lý do ≥ 20 ký tự, ghi nhật ký; prompt và mô hình cần hai người.
import { DEFAULT_ASSUMPTIONS, DEFAULT_BANNED_PHRASES, DEFAULT_THRESHOLDS, DEFAULT_UNIT_TABLE } from '../../shared/catalog'
import { SEED } from '../../data/seed'
import { DEFAULT_MODELS, DEFAULT_PROMPTS } from '../../agents/prompts'
import { actor, HttpError, minReason, requireRole, type AppCtx, type Role } from '../ctx'
import type { UnitOfWork } from '../db'

export const CONFIG_KINDS = {
  UNIT: { label: 'Bảng đơn vị cú sốc u, u_fx', owner: 'CIO', twoPerson: false },
  THRESHOLD: { label: 'Ngưỡng cảnh báo, hậu kiểm, thanh khoản, mục tiêu', owner: 'CIO', twoPerson: false },
  ASSUMPTION: { label: 'Giả định dài hạn (lợi suất, lạm phát)', owner: 'CIO', twoPerson: false },
  BANNED: { label: 'Danh sách cụm từ cấm', owner: 'COMPLIANCE', twoPerson: false },
  WHITELIST: { label: 'Danh sách nguồn công khai', owner: 'COMPLIANCE', twoPerson: false },
  RESTRICTED: { label: 'Danh sách hạn chế', owner: 'COMPLIANCE', twoPerson: false },
  PROMPT: { label: 'Prompt của agent', owner: 'ADMIN', twoPerson: true },
  MODEL: { label: 'Mô hình AI của agent', owner: 'ADMIN', twoPerson: true },
  PRICE_SOURCE: { label: 'Cấu hình nguồn giá (mã thỏa thuận dữ liệu)', owner: 'ADMIN', twoPerson: false },
  SYMBOL_MAP: { label: 'Bảng ánh xạ mã công cụ sang mã thị trường', owner: 'ADMIN', twoPerson: false },
  NEWS_SOURCES: { label: 'Nguồn tin cấu hình', owner: 'ADMIN', twoPerson: false },
} as const satisfies Record<string, { label: string; owner: Role; twoPerson: boolean }>
export type ConfigKind = keyof typeof CONFIG_KINDS

export interface ConfigVersion {
  id: string; kind: ConfigKind; seq: number; status: 'ACTIVE' | 'SUPERSEDED' | 'PENDING_CONFIRM' | 'REJECTED'
  created_at: string; content: unknown; proposed_by: string; confirmed_by?: string; confirmed_at?: string
  reason: string; effective_at?: string
}

export function initialConfigs(now: string): ConfigVersion[] {
  const base = (kind: ConfigKind, content: unknown): ConfigVersion => ({ id: `CFG-${kind}-1`, kind, seq: 1, status: 'ACTIVE', created_at: now, effective_at: now, content, proposed_by: 'SYSTEM:seed', reason: 'Giá trị khởi tạo minh họa từ BRD Mục 7.1' })
  return [
    base('UNIT', DEFAULT_UNIT_TABLE), base('THRESHOLD', DEFAULT_THRESHOLDS), base('ASSUMPTION', DEFAULT_ASSUMPTIONS),
    base('BANNED', DEFAULT_BANNED_PHRASES), base('WHITELIST', SEED.whitelist), base('RESTRICTED', SEED.restricted),
    base('PROMPT', DEFAULT_PROMPTS), base('MODEL', DEFAULT_MODELS),
    base('PRICE_SOURCE', { agreements: { TCBS_STOCK: null, TCBS_BOND: null, ONEMOUNT: null }, onemount_compliance_confirmed: false }),
    base('SYMBOL_MAP', {}), base('NEWS_SOURCES', []),
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
  if (kind === 'BANNED' && !(Array.isArray(content) && content.every(x => typeof x === 'string'))) bad('cần danh sách chuỗi')
  if (kind === 'WHITELIST' && !(Array.isArray(content) && content.every(x => typeof (x as { domain?: unknown }).domain === 'string'))) bad('mỗi mục cần domain')
  if (kind === 'RESTRICTED' && !(Array.isArray(content) && content.every(x => Array.isArray((x as { instruments?: unknown }).instruments)))) bad('mỗi mục cần danh sách mã công cụ')
}

// Đề xuất (và với loại một người: áp dụng ngay) một phiên bản mới
export async function proposeConfig(ctx: AppCtx, kind: ConfigKind, content: unknown, reasonRaw: unknown, uowIn?: UnitOfWork): Promise<ConfigVersion> {
  const meta = CONFIG_KINDS[kind]
  if (!meta) throw new HttpError(404, `Loại cấu hình không tồn tại: ${kind}`)
  requireRole(ctx, meta.owner)
  const reason = minReason(reasonRaw)
  validateContent(kind, content)
  const seq = (await ctx.repo.list<ConfigVersion>('config_versions', 'kind = ?', [kind], 'seq DESC'))[0]?.seq ?? 0
  const now = ctx.now()
  const v: ConfigVersion = { id: `CFG-${kind}-${seq + 1}`, kind, seq: seq + 1, status: meta.twoPerson ? 'PENDING_CONFIRM' : 'ACTIVE', created_at: now, content, proposed_by: actor(ctx), reason, ...(meta.twoPerson ? {} : { effective_at: now }) }
  const uow = uowIn ?? ctx.uow()
  if (!meta.twoPerson) for (const old of await ctx.repo.list<ConfigVersion>('config_versions', "kind = ? AND status = 'ACTIVE'", [kind])) uow.put('config_versions', { ...old, status: 'SUPERSEDED' } as never)
  uow.put('config_versions', v as never)
  uow.audit({ actor: actor(ctx), action: meta.twoPerson ? 'config.proposed' : 'config.changed', object: v.id, data: { kind, reason, content } })
  if (!uowIn) await uow.commit()
  return v
}

// Tuân thủ xác nhận thay đổi prompt và mô hình (quy trình hai người)
export async function decideConfig(ctx: AppCtx, id: string, approve: boolean, reasonRaw: unknown): Promise<ConfigVersion> {
  requireRole(ctx, 'COMPLIANCE')
  const reason = minReason(reasonRaw)
  const v = await configById(ctx, id)
  if (v.status !== 'PENDING_CONFIRM') throw new HttpError(409, `Phiên bản ${id} không ở trạng thái chờ xác nhận`)
  if (v.proposed_by.includes(`:${ctx.user.id}`)) throw new HttpError(409, 'Người xác nhận phải khác người đề xuất')
  const uow = ctx.uow()
  const now = ctx.now()
  if (approve) for (const old of await ctx.repo.list<ConfigVersion>('config_versions', "kind = ? AND status = 'ACTIVE'", [v.kind])) uow.put('config_versions', { ...old, status: 'SUPERSEDED' } as never)
  const nv: ConfigVersion = { ...v, status: approve ? 'ACTIVE' : 'REJECTED', confirmed_by: actor(ctx), confirmed_at: now, ...(approve ? { effective_at: now } : {}) }
  uow.put('config_versions', nv as never)
  uow.audit({ actor: actor(ctx), action: approve ? 'config.confirmed' : 'config.rejected', object: id, data: { kind: v.kind, reason } })
  await uow.commit()
  return nv
}

// Lý do đưa vào danh sách hạn chế chỉ Tuân thủ xem được (FR-1009)
export function redactConfig(ctx: AppCtx, v: ConfigVersion): ConfigVersion {
  if (v.kind === 'RESTRICTED' && ctx.user.role !== 'COMPLIANCE') return { ...v, content: (v.content as Configs['restricted']).map(({ reason, ...r }) => r) }
  return v
}

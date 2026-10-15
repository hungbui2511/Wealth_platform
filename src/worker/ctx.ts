// Ngữ cảnh của một yêu cầu: người dùng, cơ sở dữ liệu, biến môi trường.
import { Repo, UnitOfWork } from './db'

export type Role = 'CIO' | 'RM' | 'COMPLIANCE' | 'ADMIN'
export interface User { id: string; name: string; role: Role; families: string[] }

export interface Env {
  DB: D1Database
  ASSETS?: Fetcher
  // mock | live | external | auto. external: Claude chạy agent trong phiên làm việc (gói subscription) rồi đẩy kết quả vào
  // bảng external_outputs; hệ thống nhập qua cùng kiểm tra như chế độ live. auto: live khi có ANTHROPIC_API_KEY, ngược lại external
  AGENT_MODE?: string
  PRICE_MODE?: string // sample | live
  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string
  TCBS_BASE_URL?: string
  TCBS_TOKEN?: string
  ONEMOUNT_BASE_URL?: string
  ONEMOUNT_API_KEY?: string
  // Cloudflare Workflows: chạy nền các lượt agent dài ở chế độ live (không bị ngắt theo yêu cầu HTTP)
  AGENT_JOBS?: { create(opts: { id?: string; params?: unknown }): Promise<unknown> }
  [k: string]: unknown
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message) }
}

export interface AppCtx {
  repo: Repo
  env: Env
  user: User
  accessEmail?: string
  now: () => string
  uow: () => UnitOfWork
  agentMode: 'mock' | 'live' | 'external'
  priceMode: 'sample' | 'live'
  fetchFn: typeof fetch
  background?: (p: Promise<unknown>) => void
  // Báo tiến độ của tác vụ chạy nền (bước đang chạy); không có khi chạy trực tiếp trong yêu cầu
  progress?: (step: string) => Promise<void>
}

export function resolveAgentMode(env: Env): 'mock' | 'live' | 'external' {
  if (env.AGENT_MODE === 'live' || (env.AGENT_MODE === 'auto' && !!env.ANTHROPIC_API_KEY)) return 'live'
  if (env.AGENT_MODE === 'external' || env.AGENT_MODE === 'auto') return 'external'
  return 'mock'
}

export function makeCtx(env: Env, user: User, opts: { now?: () => string; fetchFn?: typeof fetch; accessEmail?: string; background?: (p: Promise<unknown>) => void; progress?: (step: string) => Promise<void> } = {}): AppCtx {
  const repo = new Repo(env.DB, typeof env.AUDIT_HMAC_KEY === 'string' && env.AUDIT_HMAC_KEY ? env.AUDIT_HMAC_KEY : undefined)
  const now = opts.now ?? (() => new Date().toISOString())
  return {
    repo, env, user, now, accessEmail: opts.accessEmail,
    uow: () => new UnitOfWork(repo, now),
    agentMode: resolveAgentMode(env),
    priceMode: env.PRICE_MODE === 'live' ? 'live' : 'sample',
    // Gói lại fetch gốc: gọi như phương thức của đối tượng khác (ctx.fetchFn(...)) gây lỗi Illegal invocation trên workerd
    fetchFn: opts.fetchFn ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)),
    background: opts.background,
    progress: opts.progress,
  }
}

export function requireRole(ctx: AppCtx, ...roles: Role[]): void {
  if (!roles.includes(ctx.user.role)) throw new HttpError(403, `Vai trò ${ctx.user.role} không được thực hiện thao tác này`)
}

export function canSeeFamily(ctx: AppCtx, familyId: string): boolean {
  return ctx.user.role !== 'RM' || ctx.user.families.includes(familyId)
}
export function assertFamily(ctx: AppCtx, familyId: string): void {
  if (!canSeeFamily(ctx, familyId)) throw new HttpError(403, 'RM chỉ xem được gia đình mình phụ trách')
}

// RM chỉ thấy lần áp dụng đã qua hậu kiểm (đang hiệu lực, hoặc đã thay thế, thu hồi kèm nhãn)
export const RM_VISIBLE_RUN_STATUSES = ['EFFECTIVE', 'SUPERSEDED', 'WITHDRAWN']
export function canSeeRun(ctx: AppCtx, run: { status: string }): boolean {
  return ctx.user.role !== 'RM' || RM_VISIBLE_RUN_STATUSES.includes(run.status)
}

// Tách bạch nhiệm vụ: so người thực hiện hiện tại với chuỗi actor đã lưu ("VAI_TRÒ:MÃ <email>").
// Mặc định so theo mã người dùng demo. SOD_STRICT=on: so thêm theo email đã xác minh qua Cloudflare Access, để một người
// vận hành chuyển vai trò demo không tự làm cả hai bước.
export const sodStrict = (env: Env) => env.SOD_STRICT === 'on'
export function samePerson(ctx: AppCtx, actorStr: string | undefined): boolean {
  const m = /^[A-Z_]+:([^\s<]+)(?:\s<([^>]+)>)?/.exec(actorStr ?? '')
  if (!m) return false
  if (m[1] === ctx.user.id) return true
  return sodStrict(ctx.env) && !!m[2] && !!ctx.accessEmail && m[2].toLowerCase() === ctx.accessEmail.toLowerCase()
}

export const actor = (ctx: AppCtx) => `${ctx.user.role}:${ctx.user.id}${ctx.accessEmail ? ` <${ctx.accessEmail}>` : ''}`

export function minReason(reason: unknown, label = 'Lý do'): string {
  const r = typeof reason === 'string' ? reason.trim() : ''
  if (r.length < 20) throw new HttpError(422, `${label} tối thiểu 20 ký tự`)
  return r
}

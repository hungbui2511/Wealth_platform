// Ngữ cảnh của một yêu cầu: người dùng, cơ sở dữ liệu, biến môi trường.
import { Repo, UnitOfWork } from './db'

export type Role = 'CIO' | 'RM' | 'COMPLIANCE' | 'ADMIN'
export interface User { id: string; name: string; role: Role; families: string[] }

export interface Env {
  DB: D1Database
  ASSETS?: Fetcher
  AGENT_MODE?: string // mock | live
  PRICE_MODE?: string // sample | live
  ANTHROPIC_API_KEY?: string
  OPENAI_API_KEY?: string
  TCBS_BASE_URL?: string
  TCBS_TOKEN?: string
  ONEMOUNT_BASE_URL?: string
  ONEMOUNT_API_KEY?: string
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
  agentMode: 'mock' | 'live'
  priceMode: 'sample' | 'live'
  fetchFn: typeof fetch
  background?: (p: Promise<unknown>) => void
}

export function makeCtx(env: Env, user: User, opts: { now?: () => string; fetchFn?: typeof fetch; accessEmail?: string; background?: (p: Promise<unknown>) => void } = {}): AppCtx {
  const repo = new Repo(env.DB)
  const now = opts.now ?? (() => new Date().toISOString())
  return {
    repo, env, user, now, accessEmail: opts.accessEmail,
    uow: () => new UnitOfWork(repo, now),
    agentMode: env.AGENT_MODE === 'live' ? 'live' : 'mock',
    priceMode: env.PRICE_MODE === 'live' ? 'live' : 'sample',
    fetchFn: opts.fetchFn ?? fetch,
    background: opts.background,
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

export const actor = (ctx: AppCtx) => `${ctx.user.role}:${ctx.user.id}${ctx.accessEmail ? ` <${ctx.accessEmail}>` : ''}`

export function minReason(reason: unknown, label = 'Lý do'): string {
  const r = typeof reason === 'string' ? reason.trim() : ''
  if (r.length < 20) throw new HttpError(422, `${label} tối thiểu 20 ký tự`)
  return r
}

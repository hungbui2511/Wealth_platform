// Tác vụ agent chạy nền. Ở chế độ live, một lượt Agent CIO gồm nhiều lần gọi mô hình (có thể vài phút):
// yêu cầu HTTP chỉ tạo tác vụ và trả về ngay, Cloudflare Workflows chạy tác vụ, giao diện theo dõi tiến độ.
// Ở chế độ mock (hoặc khi chưa có binding AGENT_JOBS), tác vụ chạy trực tiếp trong yêu cầu như trước.
import { actor, HttpError, makeCtx, requireRole, type AppCtx, type Env, type User } from '../ctx'
import { analyzePolicy } from './policy'
import { retryPreChallenge, runCioAgent, runReChallenge } from './views'

export type JobKind = 'cio_run' | 'challenge_retry' | 'rechallenge' | 'policy_analyze'
export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'

export interface JobRec {
  id: string; kind: JobKind; status: JobStatus; subject: string; created_at: string
  started_at?: string; ended_at?: string
  user: User; access_email?: string
  params: { event_id?: string; view_id?: string; doc_id?: string; instructions?: string }
  result?: Record<string, unknown>; error?: string
  rev?: number
}

export const JOB_LABEL: Record<JobKind, string> = {
  cio_run: 'Agent CIO lập nhận định', challenge_retry: 'Agent Phản biện (chạy lại)', rechallenge: 'Agent Phản biện lại các dòng đã sửa', policy_analyze: 'Agent Chính sách đọc văn bản',
}

// Tác vụ chạy nền khi: chế độ live và đã cấu hình Workflows
export function backgroundEnabled(ctx: AppCtx): boolean {
  return ctx.agentMode === 'live' && !!ctx.env.AGENT_JOBS
}

export async function getJob(ctx: AppCtx, id: string): Promise<JobRec & { steps: { at: string; step: string }[] }> {
  const j = await ctx.repo.get<JobRec>('jobs', id)
  if (!j) throw new HttpError(404, `Không có tác vụ ${id}`)
  if (ctx.user.role === 'RM') throw new HttpError(403, 'RM không xem tác vụ agent')
  const steps = await ctx.env.DB.prepare('SELECT at, step FROM job_steps WHERE job_id = ? ORDER BY id').bind(id).all<{ at: string; step: string }>()
  return { ...j, steps: steps.results ?? [] }
}

export async function listJobs(ctx: AppCtx, opts: { active?: boolean; limit?: number } = {}) {
  requireRole(ctx, 'CIO', 'ADMIN', 'COMPLIANCE')
  const rows = await ctx.repo.list<JobRec>('jobs', opts.active ? "status IN ('QUEUED','RUNNING')" : '', [], 'created_at DESC')
  const out = rows.slice(0, opts.limit ?? 20)
  const steps = out.length ? await ctx.env.DB.prepare(`SELECT job_id, at, step FROM job_steps WHERE job_id IN (${out.map(() => '?').join(',')}) ORDER BY id`).bind(...out.map(j => j.id)).all<{ job_id: string; at: string; step: string }>() : { results: [] }
  return out.map(j => ({ ...j, steps: (steps.results ?? []).filter(s => s.job_id === j.id).map(s => ({ at: s.at, step: s.step })) }))
}

// Tạo tác vụ và giao cho Workflows. Đang có tác vụ cùng loại, cùng đối tượng chưa xong thì trả lại tác vụ đó (bấm hai lần).
export async function startJob(ctx: AppCtx, kind: JobKind, subject: string, params: JobRec['params']): Promise<JobRec> {
  if (!ctx.env.AGENT_JOBS) throw new HttpError(503, 'Chưa cấu hình Workflows (AGENT_JOBS) để chạy agent nền')
  const running = (await ctx.repo.list<JobRec>('jobs', "status IN ('QUEUED','RUNNING') AND kind = ? AND subject = ?", [kind, subject]))[0]
  if (running) return running
  const id = `JOB-${ctx.now().slice(0, 10).replace(/-/g, '')}-${String(await ctx.repo.nextSeq('JOB')).padStart(4, '0')}`
  const job: JobRec = { id, kind, status: 'QUEUED', subject, created_at: ctx.now(), user: ctx.user, ...(ctx.accessEmail ? { access_email: ctx.accessEmail } : {}), params }
  const u = ctx.uow()
  u.insert('jobs', job as never)
  u.audit({ actor: actor(ctx), action: 'agent.job_queued', object: id, data: { kind, subject, params } })
  await u.commit()
  try { await ctx.env.AGENT_JOBS.create({ id, params: { jobId: id } }) }
  catch (err) {
    await finish(ctx, job, 'FAILED', { error: `Không khởi động được tác vụ nền: ${String((err as Error).message ?? err).slice(0, 300)}` })
    throw new HttpError(502, 'Không khởi động được tác vụ chạy nền; thử lại sau')
  }
  return job
}

async function finish(ctx: AppCtx, job: JobRec, status: 'DONE' | 'FAILED', extra: { result?: Record<string, unknown>; error?: string }) {
  const cur = (await ctx.repo.get<JobRec>('jobs', job.id)) ?? job
  const done: JobRec = { ...cur, status, ended_at: ctx.now(), ...extra }
  const u = ctx.uow()
  u.update('jobs', done as never)
  u.audit({ actor: 'SYSTEM', action: status === 'DONE' ? 'agent.job_done' : 'agent.job_failed', object: job.id, data: { kind: job.kind, subject: job.subject, ...extra } })
  await u.commit()
  return done
}

// Chạy một tác vụ (gọi từ Workflows, hoặc trực tiếp trong kiểm thử). Chạy đúng một lần: tác vụ không ở trạng thái chờ thì bỏ qua.
export async function executeJob(env: Env, jobId: string, opts: { now?: () => string; fetchFn?: typeof fetch } = {}): Promise<JobRec> {
  const boot = makeCtx(env, { id: 'SYSTEM', name: 'Tác vụ nền', role: 'ADMIN', families: [] }, opts)
  const job = await boot.repo.get<JobRec>('jobs', jobId)
  if (!job) throw new Error(`Không có tác vụ ${jobId}`)
  if (job.status !== 'QUEUED') return job
  const startedAt = boot.now()
  const u = boot.uow(); u.update('jobs', { ...job, status: 'RUNNING', started_at: startedAt } as never); await u.commit()
  const progress = async (step: string) => {
    try { await env.DB.prepare('INSERT INTO job_steps (job_id, at, step) VALUES (?, ?, ?)').bind(jobId, boot.now(), step).run() } catch { /* tiến độ chỉ để hiển thị */ }
  }
  // Tác vụ chạy với đúng người dùng đã yêu cầu: quyền và tác nhân trong nhật ký giữ nguyên
  const ctx = makeCtx(env, job.user, { ...opts, accessEmail: job.access_email, progress })
  try {
    let result: Record<string, unknown>
    if (job.kind === 'cio_run') {
      const v = await runCioAgent(ctx, job.params.event_id!, { skipRole: true, ...(job.params.instructions ? { instructions: job.params.instructions } : {}) })
      result = { view_id: v.id, status: v.status, ...(v.challenge_error ? { challenge_error: v.challenge_error } : {}), ...(v.errors?.length ? { errors: v.errors } : {}) }
    } else if (job.kind === 'challenge_retry') {
      const v = await retryPreChallenge(ctx, job.params.view_id!); result = { view_id: v.id, status: v.status }
    } else if (job.kind === 'rechallenge') {
      const v = await runReChallenge(ctx, job.params.view_id!); result = { view_id: v.id, status: v.status }
    } else {
      const r = await analyzePolicy(ctx, job.params.doc_id!); result = { doc_id: r.doc.id, event_id: r.event_id, matched: r.matched }
    }
    await progress('done')
    return await finish(boot, { ...job, status: 'RUNNING', started_at: startedAt, rev: (job.rev ?? 0) + 1 }, 'DONE', { result })
  } catch (err) {
    const msg = err instanceof HttpError ? err.message + (err.details ? `: ${JSON.stringify(err.details).slice(0, 500)}` : '') : String((err as Error).message ?? err)
    return await finish(boot, { ...job, status: 'RUNNING', started_at: startedAt, rev: (job.rev ?? 0) + 1 }, 'FAILED', { error: msg.slice(0, 1500) })
  }
}

// Dùng ở route: chạy nền nếu được, nếu không chạy trực tiếp
export async function runOrQueue<T>(ctx: AppCtx, kind: JobKind, subject: string, params: JobRec['params'], inline: () => Promise<T>): Promise<T | { job: JobRec }> {
  if (!backgroundEnabled(ctx)) return inline()
  return { job: await startJob(ctx, kind, subject, params) }
}

// API theo module M1–M10. Phân quyền theo vai trò kiểm tra ở phía máy chủ (NFR-08).
import { Hono, type Context } from 'hono'
import { ASSET_CLASS_LABELS, EVENT_TYPE_LABELS, POLICY_TOPIC_LABELS, RUN_STATUS_LABELS, SECTOR_LABELS, VIEW_STATUS_LABELS, DISCLAIMER_SHOCK } from '../shared/catalog'
import { isWhitelistedUrl } from '../compliance/controls'
import { TransitionError } from '../engine/states'
import { actor, HttpError, makeCtx, requireRole, type AppCtx, type Env, type User } from './ctx'
import { reseed } from './services/admin'
import { authenticate, authMode, verifiedEmail, roleMap } from './auth'
import { CONFIG_KINDS, decideConfig, loadConfigs, proposeConfig, redactConfig, activeConfig, type ConfigKind, type ConfigVersion } from './services/config'
import { createEvent, loadSampleEvents, allowEvent, getEvent, eventNews, setTimestamp, type EventRec } from './services/events'
import { createPriceSnapshot, currentSnapshot, familyCashflow, familyGoals, familyOverview, familyPnl, PRICE_DATE } from './services/portfolio'
import { approvalConditions, createManualView, decide, editView, getView, respondFinding, runCioAgent, runReChallenge, viewChallenges, viewResponses, type ViewRec } from './services/views'
import { confirmRun, createApplication, getRun, recompute, withdrawRun, withdrawView, type RunRec } from './services/apply'
import { addNote, familyImpacts, familyList, interpretation } from './services/rm'
import { closeGoal, createGoal, updateGoal } from './services/goals'
import { addPolicy, analyzePolicy, confirmSource, loadSamplePolicies, policyDetail, radar } from './services/policy'
import { createRelease, reviewRelease, submitRelease, updateRelease } from './services/releases'
import { agentCatalog, agentRunTrace, auditExport, auditList, traceFamily, verifyChain } from './services/trace'
import type { FamilyImpactResult } from '../engine/apply'
import type { TimestampField } from '../compliance/controls'

type Vars = { ctx: AppCtx; operator: boolean }
export interface AppOptions { now?: () => string; fetchFn?: typeof fetch }

export function createApp(opts: AppOptions = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>()

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, details: err.details ?? null }, err.status as 400)
    if (err instanceof TransitionError) return c.json({ error: err.message }, 409)
    console.error(err)
    return c.json({ error: 'Lỗi máy chủ', message: String((err as Error).message ?? err) }, 500)
  })

  // Không cần đăng nhập: danh sách người dùng demo và danh mục cố định
  app.get('/api/health', c => c.json({ ok: true, agent_mode: c.env.AGENT_MODE ?? 'mock', price_mode: c.env.PRICE_MODE ?? 'sample', price_date: PRICE_DATE }))
  const fetchFn = () => opts.fetchFn ?? fetch
  // Danh sách vai trò được chọn: người vận hành demo thấy tất cả; người được gán cố định chỉ thấy vai trò của mình
  app.get('/api/users', async c => {
    const who = await verifiedEmail(c.req.raw, c.env, fetchFn())
    const r = await c.env.DB.prepare('SELECT data FROM users ORDER BY id').all<{ data: string }>().catch(() => ({ results: [] as { data: string }[] }))
    const users = r.results.map(x => JSON.parse(x.data) as User)
    if (who.operator) return c.json(users)
    const own = roleMap(c.env).get(who.email!)
    return c.json(users.filter(u => u.id === own))
  })
  app.get('/api/catalog', c => c.json({ asset_classes: ASSET_CLASS_LABELS, sectors: SECTOR_LABELS, event_types: EVENT_TYPE_LABELS, policy_topics: POLICY_TOPIC_LABELS, view_status: VIEW_STATUS_LABELS, run_status: RUN_STATUS_LABELS, disclaimer: DISCLAIMER_SHOCK, price_date: PRICE_DATE }))
  // Khởi tạo lần đầu khi cơ sở dữ liệu còn trống (chưa có người dùng)
  app.post('/api/bootstrap', async c => {
    const who = await verifiedEmail(c.req.raw, c.env, fetchFn())
    if (!who.operator) throw new HttpError(403, 'Chỉ người vận hành demo (DEMO_OPERATORS) được nạp dữ liệu lần đầu')
    const n = await c.env.DB.prepare('SELECT count(*) AS n FROM users').first<{ n: number }>()
    if (n && n.n > 0) throw new HttpError(409, 'Dữ liệu đã được nạp; dùng chức năng Nạp lại dữ liệu mẫu của Quản trị')
    const ctx = makeCtx(c.env, { id: 'SYSTEM', name: 'Khởi tạo', role: 'ADMIN', families: [] }, { ...opts, accessEmail: who.email })
    return c.json(await reseed(ctx, { skipAuth: true }))
  })

  app.use('/api/*', async (c, next) => {
    const { user, email: accessEmail, operator } = await authenticate(c.req.raw, c.env, fetchFn())
    c.set('operator', operator)
    let background: ((p: Promise<unknown>) => void) | undefined
    try { const ec = c.executionCtx; background = p => ec.waitUntil(p) } catch { background = undefined }
    c.set('ctx', makeCtx(c.env, user, { ...opts, accessEmail, background }))
    await next()
  })
  const X = (c: Context<{ Bindings: Env; Variables: Vars }>) => c.get('ctx')
  const body = async <T = Record<string, unknown>>(c: Context) => (await c.req.json().catch(() => ({}))) as T

  app.get('/api/me', c => c.json({ ...X(c).user, email: X(c).accessEmail ?? null, can_switch: c.get('operator'), auth_mode: authMode(c.env) }))

  // ----- Quản trị -----
  app.post('/api/admin/reseed', async c => c.json(await reseed(X(c))))
  app.post('/api/admin/load-sample-events', async c => c.json(await loadSampleEvents(X(c))))
  app.post('/api/admin/load-sample-policies', async c => c.json(await loadSamplePolicies(X(c))))

  // ----- M1: bản đồ tài sản -----
  app.get('/api/families', async c => c.json(await familyList(X(c), { event: c.req.query('event'), alert: c.req.query('alert') })))
  app.get('/api/families/:id', async c => c.json(await familyOverview(X(c), c.req.param('id'))))
  app.get('/api/families/:id/pnl', async c => c.json(await familyPnl(X(c), c.req.param('id'))))
  app.get('/api/families/:id/cashflow', async c => c.json(await familyCashflow(X(c), c.req.param('id'), { member: c.req.query('member'), entity: c.req.query('entity') })))
  app.get('/api/families/:id/goals', async c => c.json(await familyGoals(X(c), c.req.param('id'))))
  app.get('/api/families/:id/impacts', async c => c.json(await familyImpacts(X(c), c.req.param('id'))))
  app.post('/api/families/:id/goals', async c => c.json(await createGoal(X(c), c.req.param('id'), await body(c))))
  app.put('/api/goals/:id', async c => c.json(await updateGoal(X(c), c.req.param('id'), await body(c))))
  app.post('/api/goals/:id/close', async c => c.json(await closeGoal(X(c), c.req.param('id'), String((await body(c)).note ?? ''))))
  app.post('/api/families/:id/notes', async c => c.json(await addNote(X(c), c.req.param('id'), await body(c))))
  app.get('/api/families/:id/notes', async c => { const ctx = X(c); if (ctx.user.role !== 'RM' || !ctx.user.families.includes(c.req.param('id'))) throw new HttpError(403, 'Chỉ RM phụ trách xem ghi chú'); return c.json(await ctx.repo.list('rm_notes', 'family_id = ? AND user_id = ?', [c.req.param('id'), ctx.user.id], 'id DESC')) })

  // ----- M2: giá -----
  app.get('/api/prices/status', async c => { const s = await currentSnapshot(X(c)); return c.json({ snapshot_id: s.id, price_date: s.price_date, created_at: s.created_at, mode: s.mode, hash: s.hash, status: s.status, missing: s.missing, fallbacks: s.fallbacks, points: s.points }) })
  app.post('/api/prices/refresh', async c => { requireRole(X(c), 'ADMIN'); return c.json(await createPriceSnapshot(X(c))) })

  // ----- M2/M10: sự kiện -----
  app.get('/api/events', async c => {
    const ctx = X(c)
    const events = await ctx.repo.list<EventRec>('events', '', [], 'id')
    const views = await ctx.repo.list<ViewRec>('views')
    const runs = await ctx.repo.list<RunRec>('application_runs')
    const hide = ctx.user.role === 'RM'
    return c.json(events.map(e => ({ ...e, views: hide ? [] : views.filter(v => v.event_id === e.id).map(v => ({ id: v.id, version: v.version, status: v.status })), runs: runs.filter(r => r.event_id === e.id && (!hide || ['EFFECTIVE', 'SUPERSEDED', 'WITHDRAWN'].includes(r.status))).map(r => ({ id: r.id, status: r.status, view_id: r.view_id })) })))
  })
  app.post('/api/events', async c => { const b = await body<{ type: string; title?: string; items: never[] }>(c); return c.json(await createEvent(X(c), b)) })
  app.get('/api/events/:id', async c => { const ctx = X(c); const e = await getEvent(ctx, c.req.param('id')); return c.json({ event: e, news: await eventNews(ctx, e), views: ctx.user.role === 'RM' ? [] : await ctx.repo.list('views', 'event_id = ?', [e.id], 'version') }) })
  app.post('/api/events/:id/run-agent', async c => c.json(await runCioAgent(X(c), c.req.param('id'))))
  app.post('/api/events/:id/allow', async c => c.json(await allowEvent(X(c), c.req.param('id'), String((await body(c)).note ?? ''))))
  app.post('/api/events/:id/timestamps', async c => { const b = await body<{ field: TimestampField; value: string }>(c); return c.json(await setTimestamp(X(c), c.req.param('id'), b.field, b.value)) })
  // FR-202, FR-1010: nguồn tin cấu hình; từ chối miền ngoài danh sách nguồn công khai (BR-28)
  app.post('/api/sources', async c => {
    const ctx = X(c); requireRole(ctx, 'ADMIN')
    const b = await body<{ name: string; url: string; reason: string }>(c)
    const cfg = await loadConfigs(ctx)
    if (!b.url || !isWhitelistedUrl(b.url, cfg.whitelist)) {
      const u = ctx.uow(); u.audit({ actor: actor(ctx), action: 'source.rejected', object: b.url ?? '', data: { reason: 'Miền ngoài danh sách nguồn công khai (BR-28)' } }); await u.commit()
      throw new HttpError(422, 'Nguồn tin không thuộc danh sách nguồn công khai (BR-28)')
    }
    const cur = (await activeConfig<{ name: string; url: string }[]>(ctx, 'NEWS_SOURCES')).content
    return c.json(await proposeConfig(ctx, 'NEWS_SOURCES', [...cur, { name: b.name, url: b.url }], b.reason ?? `Thêm nguồn tin ${b.name} thuộc danh sách công khai`))
  })

  // ----- M3/M4/M5: nhận định, phản biện, bàn duyệt -----
  app.get('/api/views', async c => { const ctx = X(c); requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN'); return c.json(await ctx.repo.list<ViewRec>('views', '', [], 'id')) })
  app.get('/api/views/:id', async c => {
    const ctx = X(c); requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN')
    const v = await getView(ctx, c.req.param('id'))
    const e = await getEvent(ctx, v.event_id)
    return c.json({ view: v, event: e, news: await eventNews(ctx, e), challenges: await viewChallenges(ctx, v.id), responses: await viewResponses(ctx, v.id), conditions: await approvalConditions(ctx, v), runs: await ctx.repo.list('application_runs', 'view_id = ?', [v.id]), decisions: await ctx.repo.list('decisions', 'view_id = ?', [v.id]) })
  })
  app.put('/api/views/:id/lines', async c => { const b = await body<{ impacts: never[]; note?: string }>(c); return c.json(await editView(X(c), c.req.param('id'), b.impacts, b.note)) })
  app.post('/api/views/:id/rechallenge', async c => c.json(await runReChallenge(X(c), c.req.param('id'))))
  app.post('/api/views/:id/findings/:fid/response', async c => c.json(await respondFinding(X(c), c.req.param('id'), c.req.param('fid'), await body(c))))
  app.post('/api/views/:id/decision', async c => { const ctx = X(c); return c.json(await decide(ctx, c.req.param('id'), await body(c), (v, uow) => createApplication(ctx, v, uow))) })
  app.post('/api/views/:id/withdraw', async c => c.json(await withdrawView(X(c), c.req.param('id'), (await body(c)).reason)))
  app.post('/api/manual-apply', async c => { const ctx = X(c); const b = await body<{ event_id: string; view: unknown }>(c); return c.json(await createManualView(ctx, b.view, b.event_id, (v, uow) => createApplication(ctx, v, uow))) })
  app.get('/api/agent-runs/:id', async c => c.json(await agentRunTrace(X(c), c.req.param('id'))))

  // ----- M6: lần áp dụng -----
  app.get('/api/runs', async c => { const ctx = X(c); requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN'); return c.json((await ctx.repo.list<RunRec>('application_runs', '', [], 'created_at DESC')).map(r => ({ ...r, view_body: undefined }))) })
  app.get('/api/runs/:id', async c => {
    const ctx = X(c); requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN')
    const r = await getRun(ctx, c.req.param('id'))
    const impacts = await ctx.repo.list<FamilyImpactResult>('family_impacts', 'run_id = ?', [r.id])
    const post = r.post_check ? await ctx.repo.get('challenges', r.post_check.challenge_id) : null
    const goals = await ctx.repo.list('goal_impacts', 'run_id = ?', [r.id])
    const fams = await ctx.repo.list<{ id: string; name: string; rm_id: string }>('families')
    return c.json({ run: r, impacts: impacts.map(i => ({ ...i, positions: undefined, family_name: fams.find(f => f.id === i.family_id)?.name })), post_check: post, goal_impacts: goals })
  })
  app.get('/api/runs/:id/families/:fid', async c => {
    const ctx = X(c)
    const r = await getRun(ctx, c.req.param('id'))
    if (ctx.user.role === 'RM' && (!ctx.user.families.includes(c.req.param('fid')) || !['EFFECTIVE', 'SUPERSEDED', 'WITHDRAWN'].includes(r.status))) throw new HttpError(403, 'Không xem được kết quả này')
    return c.json({ run: { ...r, view_body: undefined }, view_body: r.view_body, result: await ctx.repo.get('family_impacts', `${r.id}|${c.req.param('fid')}`) })
  })
  app.get('/api/runs/:id/families/:fid/interpretation', async c => c.json(await interpretation(X(c), c.req.param('id'), c.req.param('fid'))))
  app.post('/api/runs/:id/confirm', async c => c.json(await confirmRun(X(c), c.req.param('id'), (await body(c)).reason)))
  app.post('/api/runs/:id/withdraw', async c => c.json(await withdrawRun(X(c), c.req.param('id'), (await body(c)).reason)))
  app.post('/api/runs/:id/recompute', async c => c.json(await recompute(X(c), c.req.param('id'))))

  // ----- M8: cấu hình, nhật ký, truy vết, danh mục agent -----
  app.get('/api/config', async c => {
    const ctx = X(c)
    const all = await ctx.repo.list<ConfigVersion>('config_versions', '', [], 'kind, seq DESC')
    return c.json({ kinds: CONFIG_KINDS, versions: all.map(v => redactConfig(ctx, v)) })
  })
  app.post('/api/config/:kind', async c => { const b = await body<{ content: unknown; reason: string }>(c); return c.json(redactConfig(X(c), await proposeConfig(X(c), c.req.param('kind') as ConfigKind, b.content, b.reason))) })
  app.post('/api/config/versions/:id/decision', async c => { const b = await body<{ approve: boolean; reason: string }>(c); return c.json(await decideConfig(X(c), c.req.param('id'), !!b.approve, b.reason)) })
  app.get('/api/audit', async c => c.json(await auditList(X(c), { object: c.req.query('object'), action: c.req.query('action'), limit: Number(c.req.query('limit') ?? 200) })))
  app.get('/api/audit/verify', async c => c.json(await verifyChain(X(c))))
  app.get('/api/audit/export', async c => {
    const fmt = c.req.query('format') === 'json' ? 'json' : 'csv'
    const out = await auditExport(X(c), fmt)
    return new Response(out, { headers: { 'content-type': fmt === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="audit_log.${fmt}"` } })
  })
  app.get('/api/trace/runs/:id/families/:fid', async c => c.json(await traceFamily(X(c), c.req.param('id'), c.req.param('fid'))))
  app.get('/api/agents', async c => c.json(await agentCatalog(X(c))))

  // ----- M10: radar chính sách, bản tin CIO -----
  app.get('/api/policies', async c => c.json(await radar(X(c))))
  app.post('/api/policies', async c => c.json(await addPolicy(X(c), await body(c))))
  app.get('/api/policies/:id', async c => c.json(await policyDetail(X(c), c.req.param('id'))))
  app.post('/api/policies/:id/confirm-source', async c => c.json(await confirmSource(X(c), c.req.param('id'), String((await body(c)).note ?? ''))))
  app.post('/api/policies/:id/analyze', async c => c.json(await analyzePolicy(X(c), c.req.param('id'))))
  app.get('/api/releases', async c => { const ctx = X(c); requireRole(ctx, 'CIO', 'COMPLIANCE'); return c.json(await ctx.repo.list('research_releases', '', [], 'id')) })
  app.post('/api/releases', async c => c.json(await createRelease(X(c), await body(c))))
  app.put('/api/releases/:id', async c => c.json(await updateRelease(X(c), c.req.param('id'), await body(c))))
  app.post('/api/releases/:id/submit', async c => c.json(await submitRelease(X(c), c.req.param('id'))))
  app.post('/api/releases/:id/review', async c => { const b = await body<{ approve: boolean; note: string }>(c); return c.json(await reviewRelease(X(c), c.req.param('id'), !!b.approve, b.note)) })

  app.all('/api/*', c => c.json({ error: 'Không có endpoint này' }, 404))
  return app
}

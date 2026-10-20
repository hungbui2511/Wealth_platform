// API theo module M1–M10. Phân quyền theo vai trò kiểm tra ở phía máy chủ (NFR-08).
import { scenarioPreview, type ScenarioSet } from '../engine/scenario'
import { listResearch, releaseResearch, submitResearch } from './services/research'
import { bookProcedural, familyProcedural } from './services/procedural'
import { Hono, type Context } from 'hono'
import { ASSET_CLASS_LABELS, EVENT_TYPE_LABELS, POLICY_TOPIC_LABELS, RUN_STATUS_LABELS, SECTOR_LABELS, VIEW_STATUS_LABELS, DISCLAIMER_SHOCK } from '../shared/catalog'
import { isWhitelistedUrl } from '../compliance/controls'
import { TransitionError } from '../engine/states'
import { actor, canSeeFamily, canSeeRun, HttpError, makeCtx, requireRole, resolveAgentMode, type AppCtx, type Env, type User } from './ctx'
import { familyImpactId } from './ids'
import { redactForRm } from './services/redact'
import { reseed } from './services/admin'
import { ConflictError } from './db'
import { authenticate, authMode, verifiedEmail, roleMap } from './auth'
import { CONFIG_KINDS, decideConfig, defaultProposal, loadConfigs, loadFactorModel, proposeConfig, redactConfig, activeConfig, type ConfigKind, type ConfigVersion } from './services/config'
import { createEvent, createEventFromNews, loadSampleEvents, allowEvent, getEvent, eventNews, setTimestamp, type EventRec } from './services/events'
import { dismissNews, ingestNews, newsInbox } from './services/ingest'
import { viewsMateriality } from './services/fastlane'
import { bookNetting, familyNetting } from './services/netting'
import { rmDigest } from './services/digest'
import { createPriceSnapshot, currentSnapshot, familyCashflow, familyGoals, familyOverview, familyPnl, familyStructure, PRICE_DATE } from './services/portfolio'
import { approvalConditions, createManualView, decide, editScenarios, editView, getView, respondFinding, retryPreChallenge, runCioAgent, runReChallenge, viewChallenges, viewResponses, type ViewRec } from './services/views'
import { confirmRun, createApplication, getRun, recompute, withdrawRun, withdrawView, type RunRec } from './services/apply'
import { addNote, familyImpacts, familyList, interpretation } from './services/rm'
import { closeGoal, createGoal, updateGoal } from './services/goals'
import { addPolicy, analyzePolicy, confirmSource, loadSamplePolicies, policyDetail, radar } from './services/policy'
import { createRelease, reviewRelease, submitRelease, updateRelease } from './services/releases'
import { backgroundEnabled, getJob, listJobs, requestExternal, runOrQueue, startJob } from './services/jobs'
import { importExternal, listExternal, submitExternal } from './services/external'
import { agentCatalog, agentRunTrace, auditExport, auditList, traceFamily, verifyChain } from './services/trace'
import type { FamilyImpactResult } from '../engine/apply'
import type { TimestampField } from '../compliance/controls'
import { calibrationSummary, forecastFor, marketMoves, reviewMetrics, scheduledQuality, seriesList } from './services/quality'
import { agentControls, AGENTS, calendarStatus, heartbeat, latestScanLogs, openIncident, setAgentPaused, updateIncident, type IncidentRec } from './services/ops'
import { canarySummary, createCanary } from './services/canary'
import { goldenSummary, setGoldenReference, GOLDEN_EVENTS } from './services/golden'
import { confirmSnapshot, pendingSnapshots } from './services/portfolio'

type Vars = { ctx: AppCtx; operator: boolean }
export interface AppOptions { now?: () => string; fetchFn?: typeof fetch }

export function createApp(opts: AppOptions = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>()

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, details: err.details ?? null }, err.status as 400)
    if (err instanceof TransitionError || err instanceof ConflictError) return c.json({ error: err.message }, 409)
    console.error(err)
    return c.json({ error: 'Lỗi máy chủ', message: String((err as Error).message ?? err) }, 500)
  })

  // Không cần đăng nhập: danh sách người dùng demo và danh mục cố định
  app.get('/api/health', c => c.json({ ok: true, agent_mode: resolveAgentMode(c.env), agent_mode_setting: c.env.AGENT_MODE ?? 'mock', price_mode: c.env.PRICE_MODE ?? 'sample', price_date: PRICE_DATE, background_jobs: !!c.env.AGENT_JOBS, llm_key: !!c.env.ANTHROPIC_API_KEY,
    // Tư thế kiểm soát: các khóa và cờ bảo vệ đang bật hay chưa (không lộ giá trị)
    controls: { access_aud: !!c.env.ACCESS_AUD, sod_strict: c.env.SOD_STRICT === 'on', external_signed: !!c.env.EXTERNAL_HMAC_KEY, audit_hmac: !!c.env.AUDIT_HMAC_KEY, manual_apply: c.env.MANUAL_APPLY === 'on', interpretation_llm: c.env.INTERPRETATION_LLM === 'internal' ? 'internal' : 'off', auth_mode: c.env.AUTH_MODE === 'dev' ? 'dev' : 'access' },
    warnings: [
      ...(!c.env.ACCESS_AUD && c.env.AUTH_MODE !== 'dev' ? ['ACCESS_AUD chưa đặt: chấp nhận JWT của mọi ứng dụng Access trong team'] : []),
      ...(c.env.SOD_STRICT !== 'on' ? ['SOD_STRICT tắt: một người vận hành chuyển vai trò demo có thể làm cả hai bước của quy trình hai người'] : []),
      ...(!c.env.EXTERNAL_HMAC_KEY ? ['EXTERNAL_HMAC_KEY chưa đặt: bản ghi của vùng AI chưa ký'] : []),
      ...(!c.env.AUDIT_HMAC_KEY ? ['AUDIT_HMAC_KEY chưa đặt: nhật ký dùng SHA-256 thường, người có quyền ghi cơ sở dữ liệu có thể tính lại chuỗi'] : []),
      ...(c.env.MANUAL_APPLY === 'on' ? ['MANUAL_APPLY bật: có đường áp dụng bỏ qua phản biện (chỉ dùng khi kiểm thử)'] : []),
    ] }))
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

  // Vùng AI gửi kết quả có chữ ký (không cần đăng nhập vai trò; chỉ nhận khi chữ ký HMAC đúng). Trước tầng xác thực.
  app.post('/api/external/submit', async c => c.json(await submitExternal(c.env, await c.req.json().catch(() => null), (opts.now ?? (() => new Date().toISOString()))())))

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
  app.get('/api/families/:id/structure', async c => c.json(await familyStructure(X(c), c.req.param('id'))))
  app.get('/api/families/:id/pnl', async c => c.json(await familyPnl(X(c), c.req.param('id'))))
  app.get('/api/families/:id/cashflow', async c => c.json(await familyCashflow(X(c), c.req.param('id'), { member: c.req.query('member'), entity: c.req.query('entity') })))
  app.get('/api/families/:id/goals', async c => c.json(await familyGoals(X(c), c.req.param('id'))))
  app.get('/api/families/:id/impacts', async c => c.json(await familyImpacts(X(c), c.req.param('id'))))
  app.post('/api/families/:id/goals', async c => c.json(await createGoal(X(c), c.req.param('id'), await body(c))))
  app.put('/api/goals/:id', async c => c.json(await updateGoal(X(c), c.req.param('id'), await body(c))))
  app.post('/api/goals/:id/close', async c => c.json(await closeGoal(X(c), c.req.param('id'), String((await body(c)).note ?? ''))))
  app.post('/api/families/:id/notes', async c => c.json(await addNote(X(c), c.req.param('id'), await body(c))))
  app.get('/api/families/:id/notes', async c => { const ctx = X(c); if (ctx.user.role !== 'RM' || !canSeeFamily(ctx, c.req.param('id'))) throw new HttpError(403, 'Chỉ RM phụ trách xem ghi chú'); return c.json(await ctx.repo.list('rm_notes', 'family_id = ? AND user_id = ?', [c.req.param('id'), ctx.user.id], 'id DESC')) })

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
    return c.json(await redactForRm(ctx, events.map(e => ({ ...e, views: hide ? [] : views.filter(v => v.event_id === e.id).map(v => ({ id: v.id, version: v.version, status: v.status })), runs: runs.filter(r => r.event_id === e.id && canSeeRun(ctx, r)).map(r => ({ id: r.id, status: r.status, view_id: r.view_id })) }))))
  })
  app.post('/api/events', async c => { const b = await body<{ type: string; title?: string; items: never[] }>(c); return c.json(await createEvent(X(c), b)) })
  // Tin lấy tự động: hộp tin mới, lấy tin ngay, ẩn tin, lập sự kiện từ tin đã chọn
  app.get('/api/news/inbox', async c => c.json(await newsInbox(X(c), { all: c.req.query('all') === '1' })))
  app.post('/api/news/ingest', async c => { const ctx = X(c); requireRole(ctx, 'CIO', 'ADMIN'); return c.json(await ingestNews(ctx, { trigger: 'manual' })) })
  app.post('/api/news/dismiss', async c => { const b = await body<{ ids: string[]; dismissed?: boolean }>(c); return c.json(await dismissNews(X(c), b.ids, b.dismissed ?? true)) })
  app.get('/api/research', async c => c.json(await listResearch(X(c))))
  app.get('/api/procedural', async c => c.json(await bookProcedural(X(c))))
  app.get('/api/families/:id/procedural', async c => c.json(await familyProcedural(X(c), c.req.param('id'))))
  app.post('/api/research', async c => c.json(await submitResearch(X(c), await body(c))))
  app.post('/api/research/:id/release', async c => { const b = await body<{ approve: boolean; note: string }>(c); return c.json(await releaseResearch(X(c), c.req.param('id'), !!b.approve, b.note)) })
  app.post('/api/events/from-news', async c => c.json(await createEventFromNews(X(c), await body(c))))
  app.get('/api/events/:id', async c => { const ctx = X(c); const e = await getEvent(ctx, c.req.param('id')); return c.json(await redactForRm(ctx, { event: e, news: await eventNews(ctx, e), views: ctx.user.role === 'RM' ? [] : await ctx.repo.list('views', 'event_id = ?', [e.id], 'version') })) })
  app.post('/api/events/:id/run-agent', async c => {
    const ctx = X(c); requireRole(ctx, 'CIO', 'ADMIN')
    const id = c.req.param('id')
    if (backgroundEnabled(ctx) || ctx.agentMode === 'external') {
      // Kiểm tra ngay những điều kiện chặn (BR-27) để người dùng biết liền, không phải chờ tác vụ nền
      const e = await getEvent(ctx, id)
      if (e.hold?.status === 'PENDING') return c.json(await runCioAgent(ctx, id)) // ném lỗi 409 và ghi nhật ký như chạy trực tiếp
      // Chế độ external: sự kiện từ tin thật chờ Claude phân tích trong phiên làm việc; sự kiện của gói mẫu chạy ngay
      if (ctx.agentMode === 'external' && !(await eventNews(ctx, e)).every(n => n.simulated)) return c.json({ job: await requestExternal(ctx, 'cio_run', id, { event_id: id }) })
    }
    return c.json(await runOrQueue(ctx, 'cio_run', id, { event_id: id }, () => runCioAgent(ctx, id)))
  })
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
  app.get('/api/views/materiality', async c => c.json(await viewsMateriality(X(c))))
  app.get('/api/book/netting', async c => c.json(await bookNetting(X(c))))
  app.get('/api/families/:id/netting', async c => c.json(await familyNetting(X(c), c.req.param('id'))))
  app.get('/api/rm/digest', async c => c.json(await rmDigest(X(c), Number(c.req.query('days') ?? 7))))
  app.get('/api/views', async c => { const ctx = X(c); requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN'); return c.json(await ctx.repo.list<ViewRec>('views', '', [], 'id')) })
  app.get('/api/views/:id', async c => {
    const ctx = X(c); requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN')
    const v = await getView(ctx, c.req.param('id'))
    const e = await getEvent(ctx, v.event_id)
    const fm = v.body.scenarios ? await loadFactorModel(ctx) : null
    let scenario_preview: unknown = null
    try { scenario_preview = fm ? { ...scenarioPreview(fm.model, v.body.scenarios as ScenarioSet), factors: fm.model.factors.map(f => ({ id: f.id, label: f.label, unit: f.unit, origin: f.origin, library: f.library })), model_id: fm.id } : null } catch (err) { scenario_preview = { error: String((err as Error).message) } }
    return c.json({ view: v, event: e, scenario_preview, news: await eventNews(ctx, e), challenges: await viewChallenges(ctx, v.id), responses: await viewResponses(ctx, v.id), conditions: await approvalConditions(ctx, v), runs: await ctx.repo.list('application_runs', 'view_id = ?', [v.id]), decisions: await ctx.repo.list('decisions', 'view_id = ?', [v.id]) })
  })
  app.put('/api/views/:id/scenarios', async c => { const b = await body<{ scenarios: unknown; note: string }>(c); return c.json(await editScenarios(X(c), c.req.param('id'), b.scenarios, b.note)) })
  app.put('/api/views/:id/lines', async c => { const b = await body<{ impacts: never[]; note?: string }>(c); return c.json(await editView(X(c), c.req.param('id'), b.impacts, b.note)) })
  app.post('/api/views/:id/challenge', async c => { const ctx = X(c); requireRole(ctx, 'CIO', 'ADMIN'); const id = c.req.param('id'); return c.json(await runOrQueue(ctx, 'challenge_retry', id, { view_id: id }, () => retryPreChallenge(ctx, id))) })
  app.post('/api/views/:id/rechallenge', async c => { const ctx = X(c); requireRole(ctx, 'CIO'); const id = c.req.param('id'); return c.json(await runOrQueue(ctx, 'rechallenge', id, { view_id: id }, () => runReChallenge(ctx, id))) })
  app.post('/api/views/:id/findings/:fid/response', async c => c.json(await respondFinding(X(c), c.req.param('id'), c.req.param('fid'), await body(c))))
  app.post('/api/views/:id/decision', async c => { const ctx = X(c); return c.json(await decide(ctx, c.req.param('id'), await body(c), (v, uow) => createApplication(ctx, v, uow), { queueRework: async (eventId, instructions) => backgroundEnabled(ctx) ? startJob(ctx, 'cio_run', eventId, { event_id: eventId, instructions }) : ctx.agentMode === 'external' && !(await eventNews(ctx, await getEvent(ctx, eventId))).every(n => n.simulated) ? requestExternal(ctx, 'cio_run', eventId, { event_id: eventId, instructions }) : null })) })
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
    if (!canSeeFamily(ctx, c.req.param('fid')) || !canSeeRun(ctx, r)) throw new HttpError(403, 'Không xem được kết quả này')
    return c.json(await redactForRm(ctx, { run: { ...r, view_body: undefined }, view_body: r.view_body, result: await ctx.repo.get('family_impacts', familyImpactId(r.id, c.req.param('fid'))) }))
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
  app.get('/api/config/defaults/:kind', async c => c.json(await defaultProposal(X(c), c.req.param('kind') as ConfigKind)))
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
  app.post('/api/policies/:id/confirm-source', async c => c.json(await confirmSource(X(c), c.req.param('id'), await body(c))))
  app.post('/api/policies/:id/analyze', async c => {
    const ctx = X(c); requireRole(ctx, 'ADMIN', 'CIO'); const id = c.req.param('id')
    if (ctx.agentMode === 'external') {
      const d = await ctx.repo.get<{ simulated?: boolean; state: string }>('policy_documents', id)
      if (!d) throw new HttpError(404, `Không có văn bản ${id}`)
      if (d.state !== 'SOURCE_CONFIRMED') return c.json(await analyzePolicy(ctx, id)) // ném lỗi 409 như chạy trực tiếp
      if (!d.simulated) return c.json({ job: await requestExternal(ctx, 'policy_analyze', id, { doc_id: id }) })
    }
    return c.json(await runOrQueue(ctx, 'policy_analyze', id, { doc_id: id }, () => analyzePolicy(ctx, id)))
  })

  // ----- Kết quả do Claude lập trong phiên làm việc (chế độ external) -----
  // ----- Chất lượng và vận hành (đợt 2 sau phản biện độc lập) -----
  app.get('/api/quality', async c => {
    const ctx = X(c); requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN')
    const [calibration, review, canaries, golden, controls, incidents, schedules, pending, calendar, scans] = await Promise.all([calibrationSummary(ctx), reviewMetrics(ctx), canarySummary(ctx), goldenSummary(ctx), agentControls(ctx), ctx.repo.list<IncidentRec>('incidents', '', [], 'created_at DESC'), heartbeat(ctx), pendingSnapshots(ctx), calendarStatus(ctx), latestScanLogs(ctx)])
    return c.json({ calibration, review, canaries, golden, agents: AGENTS, controls, incidents, schedules, calendar, scans, pending_prices: pending.map(p => ({ id: p.id, price_date: p.price_date, created_at: p.created_at, points: p.points.filter(x => x.flag === 'external_ai') })) })
  })
  // Nhãn hiệu chỉnh cho mọi vai trò (hiển thị cạnh xác suất nhánh): không lộ chi tiết
  app.get('/api/quality/calibration-label', async c => { const s = await calibrationSummary(X(c)); return c.json({ calibrated: s.calibrated, label: s.label }) })
  app.get('/api/quality/series', async c => c.json(await seriesList(X(c), c.req.query('key'))))
  app.get('/api/views/:id/forecast', async c => { const ctx = X(c); requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN'); return c.json(await forecastFor(ctx, c.req.param('id'))) })
  app.post('/api/quality/score', async c => { const ctx = X(c); requireRole(ctx, 'CIO', 'ADMIN'); return c.json(await scheduledQuality(c.env, { now: opts.now })) })
  app.get('/api/events/:id/market-moves', async c => {
    const ctx = X(c); requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN')
    const e = await getEvent(ctx, c.req.param('id'))
    const news = await eventNews(ctx, e)
    const first = news.map(n => n.published_at).filter(Boolean).sort()[0] ?? e.created_at
    return c.json(await marketMoves(ctx, first))
  })
  app.post('/api/canaries', async c => c.json(await createCanary(X(c), await body(c))))
  app.get('/api/golden', async c => { requireRole(X(c), 'CIO', 'COMPLIANCE', 'ADMIN'); return c.json({ golden_events: GOLDEN_EVENTS, ...(await goldenSummary(X(c))) }) })
  app.post('/api/golden/runs/:id/reference', async c => c.json(await setGoldenReference(X(c), c.req.param('id'), (await body<{ reason?: string }>(c)).reason)))
  // Cảnh báo vận hành ngắn cho trang Tổng quan: lượt chạy theo lịch bị lỡ, agent tạm dừng, giá AI chờ xác nhận, sự cố đang mở
  app.get('/api/ops/alerts', async c => {
    const ctx = X(c); requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN')
    const [hb, controls, pending, inc, cal] = await Promise.all([heartbeat(ctx), agentControls(ctx), pendingSnapshots(ctx), ctx.repo.list<IncidentRec>('incidents', "status = 'OPEN'"), calendarStatus(ctx)])
    return c.json({ calendar_missed: cal.filter(x => x.status === 'MISSED'), calendar_upcoming: cal.filter(x => x.status === 'UPCOMING'), schedules: hb.filter(s => s.status === 'MISSING' || s.status === 'FAILED'), paused: Object.values(controls).filter(x => x.paused).map(x => ({ id: x.id, label: AGENTS[x.id], reason: x.reason })), pending_prices: pending.length, open_incidents: inc.length })
  })
  app.post('/api/ops/incidents', async c => c.json(await openIncident(X(c), await body(c))))
  app.put('/api/ops/incidents/:id', async c => c.json(await updateIncident(X(c), c.req.param('id'), await body(c))))
  app.post('/api/ops/agents/:agent/pause', async c => c.json(await setAgentPaused(X(c), c.req.param('agent'), true, await body(c))))
  app.post('/api/ops/agents/:agent/resume', async c => c.json(await setAgentPaused(X(c), c.req.param('agent'), false, await body(c))))
  app.post('/api/prices/snapshots/:id/confirm', async c => c.json(await confirmSnapshot(X(c), c.req.param('id'), await body(c))))

  app.get('/api/external', async c => c.json(await listExternal(X(c))))
  app.post('/api/external/import', async c => { const ctx = X(c); requireRole(ctx, 'CIO', 'ADMIN'); return c.json(await importExternal(c.env, { now: opts.now, fetchFn: opts.fetchFn, accessEmail: ctx.accessEmail, trigger: 'manual' })) })

  // ----- Tác vụ agent chạy nền -----
  app.get('/api/jobs', async c => c.json(await listJobs(X(c), { active: c.req.query('active') === '1', limit: Number(c.req.query('limit') ?? 20) })))
  app.get('/api/jobs/:id', async c => c.json(await getJob(X(c), c.req.param('id'))))
  app.get('/api/releases', async c => { const ctx = X(c); requireRole(ctx, 'CIO', 'COMPLIANCE'); return c.json(await ctx.repo.list('research_releases', '', [], 'id')) })
  app.post('/api/releases', async c => c.json(await createRelease(X(c), await body(c))))
  app.put('/api/releases/:id', async c => c.json(await updateRelease(X(c), c.req.param('id'), await body(c))))
  app.post('/api/releases/:id/submit', async c => c.json(await submitRelease(X(c), c.req.param('id'))))
  app.post('/api/releases/:id/review', async c => { const b = await body<{ approve: boolean; note: string }>(c); return c.json(await reviewRelease(X(c), c.req.param('id'), !!b.approve, b.note)) })

  app.all('/api/*', c => c.json({ error: 'Không có endpoint này' }, 404))
  return app
}

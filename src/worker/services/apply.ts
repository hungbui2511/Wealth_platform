// Bộ máy áp dụng (M6), hậu kiểm (BR-17), tác động lên mục tiêu (BR-25), tính lại từ ảnh chụp (FR-606), thu hồi (BR-04).
import { ENGINE_VERSION } from '../../shared/catalog'
import type { Family, Finding, Goal, Instrument, ViewBody } from '../../shared/types'
import { computeFamilyImpact, fromScenario, rankFamilies, type EngineResult, type FamilyImpactResult } from '../../engine/apply'
import { runPostcheck, postcheckSummaryTemplate } from '../../engine/postcheck'
import { goalImpact, goalImpactScenario } from '../../engine/goals'
import { buildPositions, netWorth } from '../../engine/positions'
import { hashOf } from '../../engine/hash'
import { assertRunTransition } from '../../engine/states'
import { bookFromSnapshot } from '../../pricing/snapshot'
import { callJson } from '../../agents/llm'
import { wrapData, type ModelSet, type PromptSet } from '../../agents/prompts'
import { actor, HttpError, minReason, requireRole, type AppCtx } from '../ctx'
import type { UnitOfWork } from '../db'
import { activeConfig, loadConfigs, loadFactorModel, type Configs } from './config'
import { analogBands } from '../../engine/structure'
import { familyScenario, scenarioPreview, type FactorModel, type FamilyScenarioResult, type ScenarioSet } from '../../engine/scenario'
import { getEvent, withTimestamp, type EventRec } from './events'
import { currentSnapshot, loadGoals, loadInstruments, snapshotById, type SnapshotRecord } from './portfolio'
import { getView, transition, type ChallengeRec, type ViewRec } from './views'
import { evNum, familyImpactId, nextRunNo } from '../ids'

export interface RunRec {
  id: string; view_id: string; event_id: string; status: string; idem_key: string; created_at: string
  config_version_id: string; config_version_ids: Record<string, string>
  price_date: string; price_snapshot_id: string; price_snapshot_hash: string
  engine_version: string; portfolio_snapshot_id: string; portfolio_snapshot_hash: string
  view_body: ViewBody; ranking: { family_id: string; impact: string; pct: string | null; alert: string; alert_basis?: string; alert_mean?: string; p10_3m?: string; scen_bad_3m_pct?: number | null; lane2?: string }[]
  scenario_summary?: ScenarioSummary
  post_check?: { challenge_id: string; critical: number; medium: number; low: number }
  history: { at: string; from: string; to: string; by: string; note?: string }[]
  effective_at?: string; error?: string; elapsed_ms?: number
}

export interface PortfolioSnapshot { families: Family[]; instruments: Record<string, Instrument>; goals: Goal[]; configs: Pick<Configs, 'unit' | 'thresholds' | 'assumptions'> & { factor_model?: FactorModel; factor_model_id?: string } }

export interface ScenarioSummary {
  model_id: string; model_version: string
  preview: ReturnType<typeof scenarioPreview>
  families_rm_review: number; families: number
  worst_bad_3m_pct: number | null
  // Giám sát tập trung toàn ngân hàng: tổng đóng góp theo yếu tố của mọi gia đình (kỳ hạn 3 tháng, trung bình theo xác suất)
  book_by_factor: Record<string, number>; book_base_3m: number; book_bad_3m_sum: number
}


function runTransition(ctx: AppCtx, r: RunRec, to: string, note?: string): RunRec {
  assertRunTransition(r.status, to)
  return { ...r, status: to, history: [...r.history, { at: ctx.now(), from: r.status, to, by: actor(ctx), ...(note ? { note } : {}) }] }
}

// Tính thuần từ ảnh chụp: dùng cho cả lần áp dụng và tính lại (NFR-05)
export function computeAll(ps: PortfolioSnapshot, snap: SnapshotRecord, view: ViewBody, engineVersion: string = ENGINE_VERSION) {
  const legacy = engineVersion === 'engine-1.0.0'
  const book = bookFromSnapshot(snap)
  return ps.families.map(f => {
    const pos = buildPositions(f, ps.instruments, book)
    const nw = netWorth(f, pos, book)
    const unit = computeFamilyImpact(f.id, pos, nw, view, ps.configs.unit, ps.configs.thresholds.alert)
    const scenario: FamilyScenarioResult | undefined = view.scenarios && ps.configs.factor_model
      ? familyScenario(f, pos, book, ps.instruments, ps.configs.factor_model, view.scenarios as ScenarioSet, nw.toNumber(), { creditJump: !legacy }) : undefined
    if (scenario && ps.configs.factor_model && !legacy) {
      const worst = Math.min(...scenario.ranges.map(r => r.severe))
      const bands = analogBands(pos, ps.instruments, ps.configs.factor_model, book, nw.toNumber(), worst)
      scenario.analog_bands = bands
      const beyond = bands.filter(b => b.beyond_model)
      scenario.tail_note = beyond.length ? `Nếu lặp lại ${beyond.map(b => b.label).join('; ')}, tổn thất lớn hơn mốc nặng nhất của mô hình: đuôi phân phối của mô hình mỏng hơn lịch sử, xem cả hai con số` : null
    }
    // Một bộ máy: có kịch bản thì mọi con số lấy từ lớp kịch bản; không có (chỉ còn ở áp dụng nhập tay khi kiểm thử) thì ghi rõ bộ máy cũ
    const result: EngineResult = scenario ? { ...fromScenario(unit, scenario, nw, ps.configs.thresholds.alert), scenario } as EngineResult : { ...unit, engine: 'unit_legacy' }
    return { family: f, positions: pos, result }
  })
}

export function scenarioSummary(ps: PortfolioSnapshot, view: ViewBody, computed: ReturnType<typeof computeAll>): ScenarioSummary | undefined {
  if (!view.scenarios || !ps.configs.factor_model) return undefined
  const sc = computed.map(c => (c.result as { scenario?: FamilyScenarioResult }).scenario).filter((x): x is FamilyScenarioResult => !!x)
  const book: Record<string, number> = {}
  for (const r of sc) for (const [k, v] of Object.entries(r.by_factor)) book[k] = (book[k] ?? 0) + v
  const bads = sc.map(r => r.ranges[1].bad_pct).filter((x): x is number => x !== null)
  return {
    model_id: ps.configs.factor_model_id ?? '', model_version: ps.configs.factor_model.version,
    preview: scenarioPreview(ps.configs.factor_model, view.scenarios as ScenarioSet),
    families_rm_review: sc.filter(r => r.lane2.route === 'RM_REVIEW').length, families: sc.length,
    worst_bad_3m_pct: bads.length ? Math.min(...bads) : null,
    book_by_factor: book, book_base_3m: sc.reduce((a, r) => a + r.ranges[1].base, 0), book_bad_3m_sum: sc.reduce((a, r) => a + r.ranges[1].bad, 0),
  }
}

export async function createApplication(ctx: AppCtx, view: ViewRec, uow: UnitOfWork, opts: { snapshot?: SnapshotRecord } = {}): Promise<{ run_id: string; run: RunRec }> {
  const idem = `${view.id}:apply`
  const prior = (await ctx.repo.list<RunRec>('application_runs', 'idem_key = ?', [idem]))[0]
  if (prior) return { run_id: prior.id, run: prior }
  const t0 = Date.now()
  const [families, instruments, goals, cfg, snap, fm] = await Promise.all([ctx.repo.list<Family>('families', '', [], 'id'), loadInstruments(ctx), loadGoals(ctx), loadConfigs(ctx), opts.snapshot ? Promise.resolve(opts.snapshot) : currentSnapshot(ctx), view.body.scenarios ? loadFactorModel(ctx) : Promise.resolve(null)])
  const m = await nextRunNo(ctx, view.id)
  const id = `AR-${evNum(view.event_id)}-v${view.version}-${m}`
  const ps: PortfolioSnapshot = { families, instruments, goals, configs: { unit: cfg.unit, thresholds: cfg.thresholds, assumptions: cfg.assumptions, ...(fm ? { factor_model: fm.model, factor_model_id: fm.id } : {}) } }
  const psHash = await hashOf(ps)
  const now = ctx.now()
  let run: RunRec = {
    id, view_id: view.id, event_id: view.event_id, status: 'COMPUTING', idem_key: idem, created_at: now,
    config_version_id: cfg.ids.UNIT, config_version_ids: cfg.ids, price_date: snap.price_date, price_snapshot_id: snap.id, price_snapshot_hash: snap.hash,
    engine_version: ENGINE_VERSION, portfolio_snapshot_id: `${id}-PF`, portfolio_snapshot_hash: psHash, view_body: view.body, ranking: [],
    history: [{ at: now, from: '', to: 'COMPUTING', by: actor(ctx) }],
  }
  let computed: ReturnType<typeof computeAll>
  try { computed = computeAll(ps, snap, view.body) }
  catch (e) {
    run = runTransition(ctx, { ...run, error: String((e as Error).message) }, 'FAILED')
    uow.insert('application_runs', run as never)
    uow.audit({ actor: 'SYSTEM:engine', action: 'run.failed', object: id, data: { error: run.error } })
    return { run_id: id, run }
  }
  const ranked = rankFamilies(computed.map(c => c.result))
  const scOf = (r: FamilyImpactResult) => (r as { scenario?: FamilyScenarioResult }).scenario
  const scenSum = scenarioSummary(ps, view.body, computed)
  run = runTransition(ctx, { ...run, ranking: ranked.map(r => ({ family_id: r.family_id, impact: r.impact, pct: r.pct, alert: r.alert, ...((r as EngineResult).alert_basis ? { alert_basis: (r as EngineResult).alert_basis, alert_mean: (r as EngineResult).alert_mean, p10_3m: (r as EngineResult).p10_3m } : {}), ...(scOf(r) ? { scen_bad_3m_pct: scOf(r)!.ranges[1].bad_pct, lane2: scOf(r)!.lane2.route } : {}) })), ...(scenSum ? { scenario_summary: scenSum } : {}) }, 'POST_CHECKING')
  uow.put('run_snapshots', { id: run.portfolio_snapshot_id, hash: psHash, ...ps } as never)
  for (const c of computed) uow.put('family_impacts', { ...c.result, id: familyImpactId(id, c.family.id), run_id: id } as never)

  // Hậu kiểm theo quy tắc (BR-17); agent chỉ viết tóm tắt từ danh sách phát hiện
  const chId = `CH-${evNum(view.event_id)}-v${view.version}-post-${m}`
  const findings: Finding[] = runPostcheck(chId, { price_date: snap.price_date, families: computed.map(c => ({ family_id: c.family.id, positions: c.positions, result: c.result })) }, cfg.thresholds.postcheck)
  const pkg = { findings: findings.map(f => ({ id: f.finding_id, family: f.target, check: f.check, severity: f.severity, value: f.value, threshold: f.threshold })) }
  let summary = postcheckSummaryTemplate(findings), model = 'mẫu cố định (mock)'
  // Phát hiện hậu kiểm có mã gia đình và con số của gia đình: chỉ gửi LLM khi mô hình chạy trong hạ tầng ngân hàng
  if (ctx.agentMode === 'live' && ctx.env.INTERPRETATION_LLM === 'internal' && findings.length) {
    const models = await activeConfig<ModelSet>(ctx, 'MODEL'); const prompts = await activeConfig<PromptSet>(ctx, 'PROMPT')
    try { const r = await callJson(ctx.env, models.content.challenger, prompts.content.challenger.post_summary, wrapData('phát hiện hậu kiểm', pkg), ctx.fetchFn); summary = String((r.json as { summary?: string }).summary ?? summary); model = r.model }
    catch { model = 'mẫu cố định (LLM lỗi)' }
  }
  const count = (s: string) => findings.filter(f => f.severity === s).length
  const ch: ChallengeRec = { id: chId, view_id: view.id, stage: 'post_check', created_at: ctx.now(), findings, summary, run_id: id, input_package: pkg, model, prompt_version: null }
  uow.insert('challenges', ch as never)
  run.post_check = { challenge_id: chId, critical: count('critical'), medium: count('medium'), low: count('low') }
  uow.audit({ actor: 'SYSTEM:engine', action: 'run.computed', object: id, data: { view_id: view.id, config_version_ids: cfg.ids, price_snapshot: snap.id, price_snapshot_hash: snap.hash, portfolio_snapshot_hash: psHash, engine_version: ENGINE_VERSION, families: computed.length } })
  uow.audit({ actor: 'SYSTEM:postcheck', action: 'run.postcheck', object: chId, data: { run_id: id, ...run.post_check } })
  if (run.post_check.critical > 0) run = runTransition(ctx, run, 'NEEDS_CIO_REVIEW', 'Có phát hiện Nghiêm trọng khi hậu kiểm')
  else run = await makeEffective(ctx, runTransition(ctx, run, 'EFFECTIVE', 'Không có phát hiện Nghiêm trọng'), view, computed, ps, uow)
  run.elapsed_ms = Date.now() - t0
  uow.insert('application_runs', run as never)
  return { run_id: id, run }
}

// Khi một lần áp dụng có hiệu lực: thay thế lần cũ của cùng sự kiện, tính tác động lên mục tiêu, ghi dấu thời gian
async function makeEffective(ctx: AppCtx, run: RunRec, view: ViewRec, computed: ReturnType<typeof computeAll>, ps: PortfolioSnapshot, uow: UnitOfWork): Promise<RunRec> {
  const now = ctx.now()
  run = { ...run, effective_at: now }
  for (const old of await ctx.repo.list<RunRec>('application_runs', "event_id = ? AND status = 'EFFECTIVE' AND id != ?", [run.event_id, run.id])) {
    uow.update('application_runs', runTransition(ctx, old, 'SUPERSEDED', `Thay bằng ${run.id}`) as never)
    uow.audit({ actor: 'SYSTEM', action: 'run.superseded', object: old.id, data: { by: run.id } })
    if (old.view_id !== view.id) {
      const ov = await getView(ctx, old.view_id)
      if (ov.status === 'APPROVED') { uow.update('views', transition(ctx, ov, 'SUPERSEDED', `Lần áp dụng ${run.id} của phiên bản mới có hiệu lực`) as never); uow.audit({ actor: 'SYSTEM', action: 'view.superseded', object: ov.id, data: { by: view.id } }) }
    }
  }
  // FR-905: tính lại tỷ lệ đáp ứng mục tiêu sau mỗi lần áp dụng có hiệu lực
  for (const c of computed) {
    const goals = ps.goals.filter(g => g.family_id === c.family.id && g.status === 'active')
    for (const g of goals) {
      const sc = (c.result as { scenario?: FamilyScenarioResult }).scenario
      const gi = sc ? goalImpactScenario(g, c.positions, goals, ps.configs.assumptions, run.price_date, ps.configs.thresholds.goals, sc)
        : goalImpact(g, c.positions, goals, ps.configs.assumptions, run.price_date, ps.configs.thresholds.goals, c.result.positions)
      uow.put('goal_impacts', { ...gi, id: `${run.id}|${g.id}`, run_id: run.id, event_id: run.event_id, goal_name: g.name } as never)
    }
  }
  const e = await getEvent(ctx, run.event_id)
  let ne: EventRec = { ...e, timestamps: { ...e.timestamps, view_ready_at: undefined, approved_at: undefined, effective_at: undefined } }
  ne = withTimestamp(ne, 'view_ready_at', view.view_ready_at ?? view.approved_at ?? now)
  ne = withTimestamp(ne, 'approved_at', view.approved_at ?? now)
  ne = withTimestamp(ne, 'effective_at', now)
  uow.update('events', ne as never)
  uow.audit({ actor: 'SYSTEM', action: 'run.effective', object: run.id, data: { event_id: run.event_id, reaction_ms: Date.parse(now) - Date.parse(ne.timestamps.published_at!) } })
  return run
}

export async function getRun(ctx: AppCtx, id: string): Promise<RunRec> {
  const r = await ctx.repo.get<RunRec>('application_runs', id)
  if (!r) throw new HttpError(404, `Không có lần áp dụng ${id}`)
  return r
}

// FR-507: CIO cho hiệu lực (kèm lý do) hoặc thu hồi lần áp dụng đang chờ xem
export async function confirmRun(ctx: AppCtx, id: string, reasonRaw: unknown) {
  requireRole(ctx, 'CIO')
  const reason = minReason(reasonRaw)
  let run = await getRun(ctx, id)
  const view = await getView(ctx, run.view_id)
  const ps = await ctx.repo.get<PortfolioSnapshot>('run_snapshots', run.portfolio_snapshot_id)
  const snap = await snapshotById(ctx, run.price_snapshot_id)
  const uow = ctx.uow()
  run = runTransition(ctx, run, 'EFFECTIVE', reason)
  run = await makeEffective(ctx, run, view, computeAll(ps!, snap, run.view_body), ps!, uow)
  uow.update('application_runs', run as never)
  uow.audit({ actor: actor(ctx), action: 'run.cio_confirmed', object: id, data: { reason } })
  await uow.commit()
  return run
}

export async function withdrawRun(ctx: AppCtx, id: string, reasonRaw: unknown) {
  requireRole(ctx, 'CIO')
  const run = await getRun(ctx, id)
  return withdrawView(ctx, run.view_id, reasonRaw)
}

// BR-04: thu hồi không xóa dữ liệu; tạo bản ghi thu hồi kèm lý do
export async function withdrawView(ctx: AppCtx, viewId: string, reasonRaw: unknown) {
  requireRole(ctx, 'CIO')
  const reason = minReason(reasonRaw)
  const v = await getView(ctx, viewId)
  const uow = ctx.uow()
  const nv = transition(ctx, v, 'WITHDRAWN', reason)
  uow.update('views', nv as never)
  const runs = await ctx.repo.list<RunRec>('application_runs', 'view_id = ?', [viewId])
  for (const r of runs.filter(r => ['EFFECTIVE', 'NEEDS_CIO_REVIEW'].includes(r.status))) {
    uow.update('application_runs', runTransition(ctx, r, 'WITHDRAWN', reason) as never)
    uow.audit({ actor: actor(ctx), action: 'run.withdrawn', object: r.id, data: { reason } })
  }
  uow.insert('decisions', { id: `DC-${viewId}-WITHDRAW-${await ctx.repo.nextSeq('DC')}`, view_id: viewId, action: 'WITHDRAW', idem_key: `${viewId}:WITHDRAW`, reason, by: actor(ctx), at: ctx.now() } as never)
  uow.audit({ actor: actor(ctx), action: 'view.withdrawn', object: viewId, data: { reason } })
  await uow.commit()
  return nv
}

// FR-606: tính lại từ ảnh chụp với đúng cấu hình và dữ liệu đã lưu, so kết quả
export async function recompute(ctx: AppCtx, id: string) {
  requireRole(ctx, 'COMPLIANCE', 'ADMIN')
  const run = await getRun(ctx, id)
  const ps = await ctx.repo.get<PortfolioSnapshot & { hash: string }>('run_snapshots', run.portfolio_snapshot_id)
  if (!ps) throw new HttpError(404, 'Không có ảnh chụp dữ liệu của lần áp dụng')
  const { hash, id: _id, ...body } = ps as PortfolioSnapshot & { hash: string; id: string }
  const hashOk = (await hashOf(body)) === run.portfolio_snapshot_hash
  const snap = await snapshotById(ctx, run.price_snapshot_id)
  const stored = await ctx.repo.list<FamilyImpactResult>('family_impacts', 'run_id = ?', [id])
  const fresh = computeAll(body, snap, run.view_body, run.engine_version)
  const rows = fresh.map(f => {
    const s = stored.find(x => x.family_id === f.family.id)
    const sOld = (s as { scenario?: FamilyScenarioResult } | undefined)?.scenario, sNew = (f.result as { scenario?: FamilyScenarioResult }).scenario
    const scenEqual = JSON.stringify(sOld?.ranges ?? null) === JSON.stringify(sNew?.ranges ?? null)
    return { family_id: f.family.id, stored: s?.impact ?? null, recomputed: f.result.impact, equal: s?.impact === f.result.impact && s?.pct === f.result.pct && scenEqual, ...(sNew ? { scenario_equal: scenEqual } : {}) }
  })
  const res = { run_id: id, portfolio_hash_ok: hashOk, price_snapshot_hash_ok: snap.hash === run.price_snapshot_hash, all_equal: rows.every(r => r.equal), rows }
  const u = ctx.uow(); u.audit({ actor: actor(ctx), action: 'run.recomputed', object: id, data: { all_equal: res.all_equal, portfolio_hash_ok: hashOk } }); await u.commit()
  return res
}

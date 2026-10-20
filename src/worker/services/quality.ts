// Đo chất lượng dự báo (đợt 2 sau phản biện độc lập): số liệu thị trường, sổ dự báo, Agent Chấm điểm (tất định), tổng hợp.
import { checkPublicSource } from '../../compliance/controls'
import { buildForecast, CHECKPOINTS, FACTOR_SERIES, realizedMove, scoreCheckpoint, type CheckpointScore, type ForecastBody } from '../../engine/forecast'
import type { ScenarioSet } from '../../engine/scenario'
import { HttpError, makeCtx, requireRole, type AppCtx, type Env } from '../ctx'
import type { UnitOfWork } from '../db'
import { loadConfigs, loadFactorModel } from './config'
import type { ViewRec } from './views'

// ---------- số liệu thị trường ----------
// Khoá, đơn vị và khoảng hợp lý (chặn nhầm đơn vị, ví dụ ghi tỷ giá theo nghìn đồng)
export const MARKET_KEYS: Record<string, { label: string; unit: string; min: number; max: number }> = {
  VNINDEX: { label: 'VN-Index', unit: 'điểm', min: 300, max: 6000 },
  SPX: { label: 'S&P 500', unit: 'điểm', min: 1000, max: 30000 },
  BRENT: { label: 'Dầu Brent', unit: 'USD/thùng', min: 5, max: 400 },
  GOLD_SPOT_USD: { label: 'Vàng thế giới', unit: 'USD/ounce', min: 500, max: 20000 },
  BTC: { label: 'Bitcoin', unit: 'USD', min: 1000, max: 2000000 },
  DXY: { label: 'Chỉ số USD (DXY)', unit: 'điểm', min: 50, max: 200 },
  USDVND_CENTRAL: { label: 'Tỷ giá trung tâm NHNN', unit: 'đồng/USD', min: 15000, max: 50000 },
  USDVND_VCB_SELL: { label: 'Tỷ giá bán Vietcombank', unit: 'đồng/USD', min: 15000, max: 50000 },
  US10Y: { label: 'Lợi suất TPCP Mỹ 10 năm', unit: '%/năm', min: -2, max: 25 },
  VN_INTERBANK_ON: { label: 'Lãi suất liên ngân hàng VND qua đêm', unit: '%/năm', min: 0, max: 40 },
  VN_INTERBANK_1M: { label: 'Lãi suất liên ngân hàng VND 1 tháng', unit: '%/năm', min: 0, max: 40 },
  VN_POLICY_RATE: { label: 'Lãi suất tái cấp vốn NHNN', unit: '%/năm', min: 0, max: 30 },
  VN_GOV10Y: { label: 'Lợi suất TPCP Việt Nam 10 năm', unit: '%/năm', min: 0, max: 30 },
  VN_CPI_YOY: { label: 'CPI Việt Nam so với cùng kỳ', unit: '%', min: -10, max: 50 },
  SJC_SELL: { label: 'Giá bán vàng miếng SJC', unit: 'triệu đồng/lượng', min: 10, max: 1000 },
  SJC_PREM: { label: 'Chênh lệch SJC so với thế giới (tính)', unit: 'điểm %', min: -50, max: 100 },
}
// Miền của cơ quan, sở giao dịch: số liệu gắn nhãn chính thức; còn lại là báo trong danh sách nguồn
const OFFICIAL = ['sbv.gov.vn', 'gso.gov.vn', 'nso.gov.vn', 'hnx.vn', 'hsx.vn', 'mof.gov.vn', 'chinhphu.vn', 'federalreserve.gov', 'treasury.gov', 'bls.gov', 'bea.gov', 'eia.gov', 'ecb.europa.eu', 'imf.org', 'sjc.com.vn']
const isOfficial = (url: string) => { try { const h = new URL(url).hostname.toLowerCase(); return OFFICIAL.some(d => h === d || h.endsWith('.' + d)) } catch { return false } }
const LUONG_OZ = 1.20565 // 1 lượng = 37,5 g = 1,20565 ounce troy

export interface SeriesPoint { id: string; key: string; date: string; value: number; source: string; url: string; origin: 'official' | 'press' | 'derived'; created_at: string; note?: string }

export async function importMarketData(ctx: AppCtx, d: { points?: { key: string; date: string; value: number | string; source?: string; url?: string; note?: string }[] }): Promise<{ saved: string[]; skipped: string[] }> {
  const cfg = await loadConfigs(ctx)
  const now = ctx.now()
  const errors: string[] = [], saved: string[] = [], skipped: string[] = []
  const rows: SeriesPoint[] = []
  for (const p of d?.points ?? []) {
    const spec = MARKET_KEYS[p.key]
    const v = Number(p.value)
    if (!spec || p.key === 'SJC_PREM') { errors.push(`${p.key}: khoá không có trong danh mục (SJC_PREM do hệ thống tự tính)`); continue }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date ?? '') || p.date > now.slice(0, 10)) { errors.push(`${p.key}: ngày không hợp lệ (${p.date})`); continue }
    if (!Number.isFinite(v) || v < spec.min || v > spec.max) { errors.push(`${p.key}: giá trị ${p.value} ngoài khoảng hợp lý ${spec.min}–${spec.max} ${spec.unit}`); continue }
    const src = checkPublicSource({ url: p.url, published_at: `${p.date}T00:00:00Z` }, cfg.whitelist, now)
    if (src.length) { errors.push(`${p.key}: ${src.join('; ')}`); continue }
    rows.push({ id: `${p.key}|${p.date}`, key: p.key, date: p.date, value: v, source: String(p.source ?? new URL(p.url!).hostname), url: p.url!, origin: isOfficial(p.url!) ? 'official' : 'press', created_at: now, ...(p.note ? { note: String(p.note).slice(0, 300) } : {}) })
  }
  if (errors.length) throw new HttpError(422, 'Số liệu thị trường không hợp lệ', errors)
  const u = ctx.uow()
  for (const r of rows) {
    const old = await ctx.repo.get<SeriesPoint>('market_series', r.id)
    // Số liệu chính thức không bị số liệu báo chí ghi đè
    if (old && old.origin === 'official' && r.origin !== 'official') { skipped.push(r.id); continue }
    u.put('market_series', r as never); saved.push(r.id)
  }
  // Chênh lệch SJC: giá bán SJC so với vàng thế giới quy đổi theo tỷ giá bán Vietcombank (hoặc tỷ giá trung tâm)
  const dates = [...new Set(rows.map(r => r.date))]
  for (const date of dates) {
    const get = async (k: string) => rows.find(r => r.key === k && r.date === date) ?? await ctx.repo.get<SeriesPoint>('market_series', `${k}|${date}`)
    const [sjc, gold, fx] = [await get('SJC_SELL'), await get('GOLD_SPOT_USD'), (await get('USDVND_VCB_SELL')) ?? (await get('USDVND_CENTRAL'))]
    if (sjc && gold && fx) {
      const prem = (sjc.value * 1e6 / (gold.value * fx.value * LUONG_OZ) - 1) * 100
      u.put('market_series', { id: `SJC_PREM|${date}`, key: 'SJC_PREM', date, value: Math.round(prem * 100) / 100, source: `Tính từ ${sjc.source}, ${gold.source}, ${fx.source}`, url: sjc.url, origin: 'derived', created_at: now } as never)
      saved.push(`SJC_PREM|${date}`)
    }
  }
  u.audit({ actor: 'ADMIN:CLAUDE', action: 'market_data.imported', object: 'market_series', data: { saved, skipped } })
  await u.commit()
  return { saved, skipped }
}

// Quan sát gần nhất không muộn hơn ngày cho trước, trong vòng maxLag ngày
export async function valueAt(ctx: AppCtx, key: string, date: string, maxLag = 5): Promise<SeriesPoint | null> {
  const from = new Date(Date.parse(date) - maxLag * 864e5).toISOString().slice(0, 10)
  const rows = await ctx.repo.list<SeriesPoint>('market_series', 'key = ? AND date <= ? AND date >= ?', [key, date.slice(0, 10), from], 'date DESC')
  return rows[0] ?? null
}

export async function seriesList(ctx: AppCtx, key?: string) {
  requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN')
  const rows = key ? await ctx.repo.list<SeriesPoint>('market_series', 'key = ?', [key], 'date DESC') : await ctx.repo.list<SeriesPoint>('market_series', '', [], 'date DESC, key')
  return { keys: MARKET_KEYS, points: rows.slice(0, 500) }
}

// ---------- sổ dự báo ----------
export interface ForecastRec {
  id: string; view_id: string; event_id: string; status: 'OPEN' | 'DONE'; created_at: string; approved_at: string
  body: ForecastBody
  checkpoints: { horizon: string; index: number; due: string; status: 'PENDING' | 'SCORED' | 'UNSCORABLE'; score?: CheckpointScore; note?: string }[]
}

export async function recordForecast(ctx: AppCtx, v: ViewRec, uow: UnitOfWork, approvedAt: string): Promise<void> {
  if (!v.body.scenarios) return
  const fm = await loadFactorModel(ctx)
  const body = buildForecast(fm.model, v.body.scenarios as unknown as ScenarioSet)
  const rec: ForecastRec = {
    id: `FC-${v.id}`, view_id: v.id, event_id: v.event_id, status: 'OPEN', created_at: ctx.now(), approved_at: approvedAt, body,
    checkpoints: CHECKPOINTS.filter(c => c.index < body.horizons.length).map(c => ({ horizon: body.horizons[c.index], index: c.index, due: new Date(Date.parse(approvedAt) + c.days * 864e5).toISOString(), status: 'PENDING' as const })),
  }
  uow.put('forecasts', rec as never)
}

// Agent Chấm điểm (tất định): chấm các mốc đã đến hạn. Thiếu số liệu thì chờ; quá hạn 30 ngày mà vẫn thiếu thì ghi không chấm được.
export async function scoreDueForecasts(ctx: AppCtx): Promise<{ scored: string[]; waiting: string[]; unscorable: string[] }> {
  const now = ctx.now()
  const out = { scored: [] as string[], waiting: [] as string[], unscorable: [] as string[] }
  const open = await ctx.repo.list<ForecastRec>('forecasts', "status = 'OPEN'")
  for (const fc of open) {
    let changed = false
    const cps = []
    for (const cp of fc.checkpoints) {
      if (cp.status !== 'PENDING' || cp.due > now) { cps.push(cp); continue }
      const observed: Record<string, number> = {}
      for (const [factor, s] of Object.entries(FACTOR_SERIES)) {
        if (!fc.body.expected[factor]) continue
        const [a, b] = [await valueAt(ctx, s.key, fc.approved_at), await valueAt(ctx, s.key, cp.due)]
        if (a && b && b.date > a.date) { const m = realizedMove(s.kind, a.value, b.value); if (Number.isFinite(m)) observed[factor] = Math.round(m * 100) / 100 }
      }
      if (Object.keys(observed).length) { cps.push({ ...cp, status: 'SCORED' as const, score: scoreCheckpoint(fc.body, cp.index, observed, now) }); out.scored.push(`${fc.id}@${cp.horizon}`); changed = true }
      else if (Date.parse(now) - Date.parse(cp.due) > 30 * 864e5) { cps.push({ ...cp, status: 'UNSCORABLE' as const, note: 'Không có số liệu thị trường ở đầu và cuối kỳ' }); out.unscorable.push(`${fc.id}@${cp.horizon}`); changed = true }
      else { cps.push(cp); out.waiting.push(`${fc.id}@${cp.horizon}`) }
    }
    if (changed) {
      const done = cps.every(c => c.status !== 'PENDING')
      const u = ctx.uow(); u.update('forecasts', { ...fc, checkpoints: cps, status: done ? 'DONE' : 'OPEN' } as never)
      u.audit({ actor: 'SYSTEM:scorer', action: 'forecast.scored', object: fc.id, data: { checkpoints: cps.filter(c => c.status !== 'PENDING').map(c => ({ horizon: c.horizon, status: c.status, brier: c.score?.brier ?? null })) } })
      await u.commit()
    }
  }
  return out
}

// Đủ dữ liệu để gọi là "đã hiệu chỉnh": ít nhất 12 mốc 3 tháng đã chấm, Brier tốt hơn xác suất đều, độ phủ dải 80% trong 70–90%
export const CALIBRATION_MIN_N = 12

export async function calibrationSummary(ctx: AppCtx) {
  const all = await ctx.repo.list<ForecastRec>('forecasts', '', [], 'created_at DESC')
  const byH = CHECKPOINTS.map(c => {
    const sc = all.flatMap(f => f.checkpoints.filter(x => x.index === c.index && x.status === 'SCORED' && x.score).map(x => x.score!))
    const br = sc.filter(s => s.brier !== null)
    const cov = sc.flatMap(s => Object.values(s.coverage)), dir = sc.flatMap(s => Object.values(s.direction))
    const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
    const brier = mean(br.map(s => s.brier!)), uniform = mean(br.map(s => s.brier_uniform!))
    const perFactor: Record<string, { n: number; covered: number; direction_n: number; direction_hit: number }> = {}
    for (const s of sc) for (const [k, ok] of Object.entries(s.coverage)) {
      const p = perFactor[k] ??= { n: 0, covered: 0, direction_n: 0, direction_hit: 0 }
      p.n++; if (ok) p.covered++
      if (k in s.direction) { p.direction_n++; if (s.direction[k]) p.direction_hit++ }
    }
    return { horizon: c.horizon, n: sc.length, brier, brier_uniform: uniform, skill: brier !== null && uniform ? 1 - brier / uniform : null, coverage_80: cov.length ? cov.filter(Boolean).length / cov.length : null, coverage_n: cov.length, direction_hit: dir.length ? dir.filter(Boolean).length / dir.length : null, direction_n: dir.length, per_factor: perFactor }
  })
  const m3 = byH[1]
  const calibrated = m3.n >= CALIBRATION_MIN_N && (m3.skill ?? -1) > 0 && m3.coverage_80 !== null && m3.coverage_80 >= 0.7 && m3.coverage_80 <= 0.9
  return {
    calibrated, min_n: CALIBRATION_MIN_N, horizons: byH,
    label: calibrated ? 'Xác suất nhánh đã được kiểm chứng trên dữ liệu thực' : `Xác suất nhánh là giả định, chưa hiệu chỉnh (mới chấm ${m3.n}/${CALIBRATION_MIN_N} mốc 3 tháng)`,
    forecasts: all.slice(0, 100).map(f => ({ id: f.id, view_id: f.view_id, approved_at: f.approved_at, status: f.status, checkpoints: f.checkpoints.map(c => ({ horizon: c.horizon, due: c.due, status: c.status, brier: c.score?.brier ?? null, outcome: c.score?.outcome_branch ?? null, observed: c.score?.observed ?? null, coverage: c.score?.coverage ?? null, direction: c.score?.direction ?? null, note: c.note ?? null })) })),
  }
}

// ---------- chỉ số bàn duyệt: cổng duyệt có thật sự lọc hay thành con dấu ----------
export async function reviewMetrics(ctx: AppCtx) {
  const views = await ctx.repo.list<ViewRec>('views', "status IN ('APPROVED','SUPERSEDED','WITHDRAWN','REJECTED','REWORK_REQUESTED')")
  const canaryViews = new Set((await ctx.repo.list<{ view_id: string }>('canaries')).map(c => c.view_id))
  const real = views.filter(v => !canaryViews.has(v.id))
  const chs = await ctx.repo.list<{ view_id: string; stage: string; findings: { finding_id: string; severity: string; origin: string }[] }>('challenges')
  const resp = await ctx.repo.list<{ view_id: string; finding_id: string; response: string }>('finding_responses')
  const decs = await ctx.repo.list<{ view_id: string; action: string }>('decisions')
  const approved = real.filter(v => ['APPROVED', 'SUPERSEDED', 'WITHDRAWN'].includes(v.status))
  const crit = chs.filter(c => c.stage !== 'post_check' && real.some(v => v.id === c.view_id)).flatMap(c => c.findings.filter(f => f.severity === 'critical'))
  const rmap = new Map(resp.map(r => [r.finding_id, r.response]))
  const counts = { accepted_fixed: 0, disagree: 0, out_of_scope: 0, none: 0 }
  for (const f of crit) counts[(rmap.get(f.finding_id) ?? 'none') as keyof typeof counts]++
  const edited = approved.filter(v => v.cio_edits.length > 0).length
  const asIs = approved.length - edited
  return {
    views_decided: real.length, approved: approved.length,
    rework: decs.filter(d => d.action === 'REWORK').length, rejected: decs.filter(d => d.action === 'REJECT').length,
    critical_findings: crit.length, critical_responses: counts,
    critical_accept_rate: crit.length ? counts.accepted_fixed / crit.length : null,
    approved_with_edits_rate: approved.length ? edited / approved.length : null,
    approved_as_is_rate: approved.length ? asIs / approved.length : null,
    note: 'Tỷ lệ duyệt nguyên trạng cao kèm tỷ lệ chấp nhận phát hiện Nghiêm trọng thấp là dấu hiệu cổng duyệt có thể đang thành con dấu.',
  }
}

export async function forecastFor(ctx: AppCtx, viewId: string) {
  return ctx.repo.get<ForecastRec>('forecasts', `FC-${viewId}`)
}


// Chạy theo cron cùng lượt nhập: chấm sổ dự báo đến hạn, đóng bài kiểm tra phản biện quá 14 ngày chưa có phản biện
export async function scheduledQuality(env: Env, opts: { now?: () => string } = {}) {
  const n = await env.DB.prepare('SELECT count(*) AS n FROM config_versions').first<{ n: number }>().catch(() => null)
  if (!n?.n) return { skipped: 'Chưa nạp dữ liệu' }
  const ctx = makeCtx(env, { id: 'SYSTEM', name: 'Agent Chấm điểm', role: 'ADMIN', families: [] }, opts)
  const scored = await scoreDueForecasts(ctx)
  const expired: string[] = []
  for (const c of await ctx.repo.list<{ id: string; view_id: string; status: string; created_at: string }>('canaries', "status = 'OPEN'")) {
    if (Date.parse(ctx.now()) - Date.parse(c.created_at) < 14 * 864e5) continue
    const u = ctx.uow(); u.update('canaries', { ...(await ctx.repo.get<Record<string, unknown>>('canaries', c.id))!, status: 'EXPIRED' } as never); u.audit({ actor: 'SYSTEM:canary', action: 'canary.expired', object: c.id, data: { view_id: c.view_id } }); await u.commit()
    expired.push(c.id)
  }
  return { ...scored, canaries_expired: expired }
}

// Biến động thị trường từ trước khi có tin tới quan sát mới nhất: căn cứ để CIO và phản biện xem "tin đã phản ánh vào giá chưa"
// (priced_in). Chỉ dùng số liệu thị trường đã nhập (market_series), không dùng dữ liệu gia đình.
const MOVE_KEYS = ['VNINDEX', 'USDVND_CENTRAL', 'US10Y', 'DXY', 'SPX', 'BRENT', 'GOLD_SPOT_USD', 'SJC_PREM', 'VN_INTERBANK_1M'] as const
export async function marketMoves(ctx: AppCtx, firstPublishedAt: string) {
  const d0 = new Date(Date.parse(firstPublishedAt) - 864e5).toISOString().slice(0, 10)
  const out: { key: string; label: string; unit: string; from: { date: string; value: number } | null; to: { date: string; value: number } | null; move: number | null; move_unit: string }[] = []
  for (const k of MOVE_KEYS) {
    const from = await valueAt(ctx, k, d0, 7)
    const to = (await ctx.repo.list<SeriesPoint>('market_series', 'key = ? AND date >= ?', [k, d0], 'date DESC'))[0] ?? null
    const kind = ['US10Y', 'VN_INTERBANK_1M'].includes(k) ? 'bp' : k === 'SJC_PREM' ? 'pts' : 'pct'
    const move = from && to && to.date > from.date ? Math.round(realizedMove(kind, from.value, to.value) * 100) / 100 : null
    out.push({ key: k, label: MARKET_KEYS[k].label, unit: MARKET_KEYS[k].unit, from: from ? { date: from.date, value: from.value } : null, to: to && (!from || to.date > from.date) ? { date: to.date, value: to.value } : null, move, move_unit: kind === 'bp' ? 'điểm cơ bản' : kind === 'pts' ? 'điểm %' : '%' })
  }
  return { since: d0, moves: out.filter(m => m.from || m.to) }
}

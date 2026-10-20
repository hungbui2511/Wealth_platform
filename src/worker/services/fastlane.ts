// Làn ưu tiên cho CIO theo mức trọng yếu (đợt 5 sau phản biện độc lập).
// Trước khi duyệt, chạy thử bộ máy kịch bản trên ảnh chụp danh mục hiện tại (không ghi gì) để biết nhận định này
// có làm gia đình nào giảm sâu ở mốc xấu P10 hay không. Chỉ trả số tổng hợp, không trả mã hay tên gia đình:
// giữ bức tường thông tin giữa người ra nhận định và dữ liệu từng khách hàng.
import type { Family } from '../../shared/types'
import { requireRole, type AppCtx } from '../ctx'
import { computeAll, type PortfolioSnapshot } from './apply'
import { loadConfigs, loadFactorModel } from './config'
import { currentSnapshot, loadInstruments } from './portfolio'
import type { ViewRec } from './views'
import type { FamilyScenarioResult } from '../../engine/scenario'

export const FAST_LANE = { family_p10_pct: -0.05, book_p10_pct: -0.01, fast_hours: 2, normal_hours: 24 }

export interface Materiality { view_id: string; lane: 'FAST' | 'NORMAL' | 'NA'; families: number; over_threshold: number; worst_p10_3m_pct: number | null; book_p10_3m_pct: number | null; due_by: string | null; reasons: string[] }

export async function viewsMateriality(ctx: AppCtx): Promise<Materiality[]> {
  requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN')
  const views = (await ctx.repo.list<ViewRec>('views', "status IN ('PENDING_CHALLENGE', 'PENDING_APPROVAL')", [], 'id'))
  if (!views.length) return []
  const [families, instruments, cfg, snap, fm] = await Promise.all([ctx.repo.list<Family>('families', '', [], 'id'), loadInstruments(ctx), loadConfigs(ctx), currentSnapshot(ctx), loadFactorModel(ctx)])
  const ps: PortfolioSnapshot = { families, instruments, goals: [], configs: { unit: cfg.unit, thresholds: cfg.thresholds, assumptions: cfg.assumptions, factor_model: fm.model, factor_model_id: fm.id } }
  const famTh = fm.model.lane2_route_rm_pct ?? FAST_LANE.family_p10_pct
  return views.map(v => {
    if (!v.body.scenarios) return { view_id: v.id, lane: 'NA' as const, families: 0, over_threshold: 0, worst_p10_3m_pct: null, book_p10_3m_pct: null, due_by: null, reasons: ['Nhận định chưa có nhánh kịch bản'] }
    let computed
    try { computed = computeAll(ps, snap, v.body) } catch { return { view_id: v.id, lane: 'NA' as const, families: 0, over_threshold: 0, worst_p10_3m_pct: null, book_p10_3m_pct: null, due_by: null, reasons: ['Không chạy thử được bộ máy kịch bản'] } }
    const sc = computed.map(c => (c.result as { scenario?: FamilyScenarioResult }).scenario).filter((x): x is FamilyScenarioResult => !!x)
    const pcts = sc.map(s => s.ranges[1].bad_pct).filter((x): x is number => x !== null)
    const over = pcts.filter(p => p <= famTh).length
    const nw = sc.reduce((a, s) => a + Math.max(0, s.net_worth), 0)
    const bookBad = sc.reduce((a, s) => a + s.ranges[1].bad, 0)
    const bookPct = nw > 0 ? bookBad / nw : null
    const reasons: string[] = []
    if (over) reasons.push(`${over} gia đình có mốc xấu P10 3 tháng giảm từ ${(Math.abs(famTh) * 100).toFixed(0)}% tài sản ròng trở lên`)
    if (bookPct !== null && bookPct <= FAST_LANE.book_p10_pct) reasons.push(`Tổng mốc xấu P10 của cả sổ ${(bookPct * 100).toFixed(1)}% tài sản ròng`)
    const lane = reasons.length ? 'FAST' as const : 'NORMAL' as const
    const since = [...(v.history ?? [])].reverse().find(h => h.to === v.status)?.at ?? v.created_at
    const due = new Date(Date.parse(since) + (lane === 'FAST' ? FAST_LANE.fast_hours : FAST_LANE.normal_hours) * 3600e3).toISOString()
    if (!reasons.length) reasons.push('Không gia đình nào vượt ngưỡng ở mốc xấu P10')
    return { view_id: v.id, lane, families: sc.length, over_threshold: over, worst_p10_3m_pct: pcts.length ? Math.min(...pcts) : null, book_p10_3m_pct: bookPct, due_by: due, reasons }
  })
}

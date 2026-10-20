// Vận hành agent (đợt 2 sau phản biện độc lập): tạm dừng từng agent, sổ sự cố, nhịp tim lượt chạy theo lịch, xác nhận giá do AI lấy.
import { actor, HttpError, minReason, requireRole, samePerson, type AppCtx } from '../ctx'

export const AGENTS: Record<string, string> = {
  news: 'Quét tin và tạo sự kiện', cio: 'Agent CIO', challenger: 'Agent Phản biện', policy_scan: 'Agent Rà soát pháp luật',
  policy: 'Agent Chính sách', prices: 'Lấy giá', market_data: 'Số liệu thị trường', golden: 'Bộ sự kiện chuẩn',
}
// Loại bản ghi ngoài → agent chịu trách nhiệm
export const KIND_AGENT: Record<string, string> = {
  news: 'news', event: 'news', scan_log: 'news', cio_view: 'cio', challenge: 'challenger', policy_doc: 'policy_scan',
  policy_summary: 'policy', prices: 'prices', market_data: 'market_data', golden_view: 'golden',
}

export interface AgentControl { id: string; paused: boolean; reason: string; by: string; at: string; incident_id?: string; history: { paused: boolean; reason: string; by: string; at: string }[] }

export async function agentControls(ctx: AppCtx): Promise<Record<string, AgentControl>> {
  const rows = await ctx.repo.list<AgentControl>('agent_controls')
  return Object.fromEntries(rows.map(r => [r.id, r]))
}
export async function pausedReason(ctx: AppCtx, agent: string): Promise<string | null> {
  const c = await ctx.repo.get<AgentControl>('agent_controls', agent)
  return c?.paused ? `${AGENTS[agent] ?? agent} đang tạm dừng: ${c.reason}${c.incident_id ? ` (sự cố ${c.incident_id})` : ''}` : null
}
export async function assertAgentActive(ctx: AppCtx, agent: string): Promise<void> {
  const r = await pausedReason(ctx, agent)
  if (r) throw new HttpError(423, r)
}

// Tạm dừng: CIO, Tuân thủ hoặc Quản trị, một người là đủ (giảm rủi ro). Chạy lại: Tuân thủ hoặc Quản trị, người khác người tạm dừng.
export async function setAgentPaused(ctx: AppCtx, agent: string, paused: boolean, body: { reason?: string; incident_id?: string }) {
  if (!AGENTS[agent]) throw new HttpError(404, `Không có agent ${agent}`)
  if (paused) requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN'); else requireRole(ctx, 'COMPLIANCE', 'ADMIN')
  const reason = minReason(body.reason, paused ? 'Lý do tạm dừng' : 'Lý do chạy lại')
  const cur = await ctx.repo.get<AgentControl>('agent_controls', agent)
  if (!paused && !cur?.paused) throw new HttpError(409, 'Agent không ở trạng thái tạm dừng')
  if (!paused && cur && samePerson(ctx, cur.by)) throw new HttpError(403, 'Người cho chạy lại phải khác người đã tạm dừng')
  const now = ctx.now()
  const rec: AgentControl = { id: agent, paused, reason, by: actor(ctx), at: now, ...(body.incident_id ? { incident_id: body.incident_id } : {}), history: [...(cur?.history ?? []), { paused, reason, by: actor(ctx), at: now }] }
  const u = ctx.uow(); u.put('agent_controls', rec as never); u.audit({ actor: actor(ctx), action: paused ? 'agent.paused' : 'agent.resumed', object: agent, data: { reason, incident_id: body.incident_id ?? null } }); await u.commit()
  return rec
}

// ---------- sổ sự cố ----------
export interface IncidentRec {
  id: string; agent: string; status: 'OPEN' | 'CLOSED'; created_at: string; opened_by: string; severity: 'high' | 'medium' | 'low'
  what: string; why?: string; fix?: string; rerun_done?: boolean; objects?: string[]; closed_by?: string; closed_at?: string
  history: { at: string; by: string; note: string }[]
}
export async function openIncident(ctx: AppCtx, body: { agent: string; severity?: string; what?: string; objects?: string[]; pause?: boolean }) {
  requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN')
  if (!AGENTS[body.agent]) throw new HttpError(422, 'Agent không hợp lệ')
  const what = minReason(body.what, 'Mô tả sự cố')
  const now = ctx.now()
  const id = await ctx.repo.nextId('incidents', `INC-${now.slice(0, 4)}-`, 3)
  const rec: IncidentRec = { id, agent: body.agent, status: 'OPEN', created_at: now, opened_by: actor(ctx), severity: (['high', 'medium', 'low'].includes(String(body.severity)) ? body.severity : 'medium') as IncidentRec['severity'], what, objects: (body.objects ?? []).slice(0, 20).map(String), history: [{ at: now, by: actor(ctx), note: 'Mở sự cố' }] }
  const u = ctx.uow(); u.insert('incidents', rec as never); u.audit({ actor: actor(ctx), action: 'incident.opened', object: id, data: { agent: rec.agent, severity: rec.severity, what } }); await u.commit()
  if (body.pause) await setAgentPaused(ctx, body.agent, true, { reason: `Sự cố ${id}: ${what}`.slice(0, 300), incident_id: id })
  return rec
}
export async function updateIncident(ctx: AppCtx, id: string, body: { why?: string; fix?: string; rerun_done?: boolean; close?: boolean; note?: string }) {
  requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN')
  const r = await ctx.repo.get<IncidentRec>('incidents', id)
  if (!r) throw new HttpError(404, `Không có sự cố ${id}`)
  if (r.status === 'CLOSED') throw new HttpError(409, 'Sự cố đã đóng')
  const now = ctx.now()
  const nr: IncidentRec = { ...r, ...(body.why ? { why: String(body.why).slice(0, 2000) } : {}), ...(body.fix ? { fix: String(body.fix).slice(0, 2000) } : {}), ...(body.rerun_done !== undefined ? { rerun_done: !!body.rerun_done } : {}), history: [...r.history, { at: now, by: actor(ctx), note: String(body.note ?? (body.close ? 'Đóng sự cố' : 'Cập nhật')).slice(0, 500) }] }
  if (body.close) {
    // Đóng phải đủ: vì sao sai, đã sửa gì, đã chạy lại chưa
    if (!nr.why || !nr.fix || nr.rerun_done === undefined) throw new HttpError(422, 'Đóng sự cố cần ghi đủ: vì sao sai, đã sửa gì, đã chạy lại hay chưa')
    nr.status = 'CLOSED'; nr.closed_by = actor(ctx); nr.closed_at = now
  }
  const u = ctx.uow(); u.update('incidents', nr as never); u.audit({ actor: actor(ctx), action: body.close ? 'incident.closed' : 'incident.updated', object: id, data: { why: nr.why ?? null, fix: nr.fix ?? null, rerun_done: nr.rerun_done ?? null } }); await u.commit()
  return nr
}

// ---------- nhịp tim lượt chạy theo lịch ----------
export interface RunLog { id: string; schedule: string; created_at: string; started_at?: string; finished_at?: string; status: 'ok' | 'partial' | 'failed'; counts?: Record<string, number>; notes?: string; model?: string; session?: string }
// Lịch chạy (giờ Việt Nam). Hạn báo: sau giờ này mà chưa có nhật ký lượt chạy thì báo đỏ.
export const SCHEDULES = [
  { id: 'daily_news', label: 'Quét tin và nhận định (17:22, thứ 2–6)', days: [1, 2, 3, 4, 5], start: '17:00', deadline: '18:30' },
  { id: 'legal_scan', label: 'Rà soát dự thảo pháp luật (7:49, thứ 2 và 5)', days: [1, 4], start: '07:30', deadline: '09:30' },
] as const
const VN = 7 * 3600e3

export async function importRunLog(ctx: AppCtx, d: Partial<RunLog>): Promise<RunLog> {
  if (!SCHEDULES.some(s => s.id === d.schedule) && d.schedule !== 'golden_monthly' && d.schedule !== 'manual') throw new HttpError(422, 'schedule không hợp lệ')
  const now = ctx.now()
  const id = await ctx.repo.nextId('run_logs', `RL-${now.slice(0, 10).replace(/-/g, '')}-`, 3)
  const rec: RunLog = { id, schedule: String(d.schedule), created_at: now, status: (['ok', 'partial', 'failed'].includes(String(d.status)) ? d.status : 'ok') as RunLog['status'], ...(d.started_at ? { started_at: String(d.started_at) } : {}), ...(d.finished_at ? { finished_at: String(d.finished_at) } : {}), ...(d.counts && typeof d.counts === 'object' ? { counts: d.counts } : {}), ...(d.notes ? { notes: String(d.notes).slice(0, 2000) } : {}), ...(d.model ? { model: String(d.model) } : {}), ...(d.session ? { session: String(d.session) } : {}) }
  const u = ctx.uow(); u.insert('run_logs', rec as never); await u.commit()
  return rec
}

// Lần đến hạn gần nhất (đã qua hạn báo) của một lịch, theo giờ Việt Nam
export function lastDueSlot(s: typeof SCHEDULES[number], nowIso: string): { start: string; deadline: string } | null {
  const now = Date.parse(nowIso)
  for (let back = 0; back < 8; back++) {
    const local = new Date(now + VN - back * 864e5)
    const day = local.getUTCDay()
    if (!(s.days as readonly number[]).includes(day)) continue
    const ymd = local.toISOString().slice(0, 10)
    const at = (hm: string) => Date.parse(`${ymd}T${hm}:00Z`) - VN
    if (at(s.deadline) > now) continue
    return { start: new Date(at(s.start)).toISOString(), deadline: new Date(at(s.deadline)).toISOString() }
  }
  return null
}

export async function heartbeat(ctx: AppCtx) {
  const now = ctx.now()
  const logs = await ctx.repo.list<RunLog>('run_logs', '', [], 'created_at DESC')
  return SCHEDULES.map(s => {
    const slot = lastDueSlot(s, now)
    const last = logs.find(l => l.schedule === s.id)
    const inSlot = slot ? logs.find(l => l.schedule === s.id && l.created_at >= slot.start) : undefined
    const status = !slot ? 'NOT_DUE' : inSlot ? (inSlot.status === 'ok' ? 'OK' : inSlot.status === 'partial' ? 'PARTIAL' : 'FAILED') : 'MISSING'
    return { id: s.id, label: s.label, due: slot?.deadline ?? null, status, last: last ?? null, message: status === 'MISSING' ? `Chưa có nhật ký lượt chạy sau ${slot!.start}: lượt chạy theo lịch có thể đã không chạy (hết hạn mức, phiên lỗi)` : null }
  })
}

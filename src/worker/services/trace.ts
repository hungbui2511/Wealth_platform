// Truy vết (FR-802), nhật ký (FR-801, FR-803) và danh mục agent (FR-805).
import { actor, HttpError, requireRole, type AppCtx } from '../ctx'
import { verifyAuditChain, type AuditRow } from '../db'
import { activeConfig, configById, redactConfig } from './config'
import { getRun } from './apply'
import { getView, viewChallenges, viewResponses } from './views'
import type { ModelSet, PromptSet } from '../../agents/prompts'
import { GRAPH_NODES } from '../../agents/cioGraph'
import type { FamilyImpactResult } from '../../engine/apply'
import type { EventRec, NewsItem } from './events'
import { assertFamily, canSeeRun } from '../ctx'
import { familyImpactId } from '../ids'
import { redactForRm } from './redact'

export async function traceFamily(ctx: AppCtx, runId: string, familyId: string) {
  requireRole(ctx, 'COMPLIANCE', 'CIO', 'ADMIN', 'RM')
  assertFamily(ctx, familyId)
  const run = await getRun(ctx, runId)
  if (!canSeeRun(ctx, run)) throw new HttpError(403, 'Kết quả chưa qua hậu kiểm')
  const fi = await ctx.repo.get<FamilyImpactResult>('family_impacts', familyImpactId(runId, familyId))
  const view = await getView(ctx, run.view_id)
  const event = await ctx.repo.get<EventRec>('events', run.event_id)
  const news = await ctx.repo.list<NewsItem>('news_items', 'event_id = ?', [run.event_id], 'id')
  const challenges = ctx.user.role === 'RM' ? [] : await viewChallenges(ctx, view.id)
  const responses = ctx.user.role === 'RM' ? [] : await viewResponses(ctx, view.id)
  const decisions = await ctx.repo.list('decisions', 'view_id = ?', [view.id])
  const configs = await Promise.all(Object.values(run.config_version_ids).map(id => configById(ctx, id).then(v => redactConfig(ctx, v))))
  const agentRun = view.agent_run_id ? await ctx.repo.get<{ id: string; model: unknown; prompt_version: string }>('agent_runs', view.agent_run_id) : null
  const objects = [runId, view.id, run.event_id, ...challenges.map(c => c.id), familyImpactId(runId, familyId)]
  const audit = ctx.user.role === 'COMPLIANCE' ? (await ctx.env.DB.prepare(`SELECT * FROM audit_log WHERE object IN (${objects.map(() => '?').join(',')}) ORDER BY seq`).bind(...objects).all<AuditRow>()).results : []
  return redactForRm(ctx, { family_impact: fi, run: { ...run, view_body: undefined }, view: { id: view.id, version: view.version, status: view.status, body: view.body, ai_body: view.ai_body, cio_edits: view.cio_edits, history: view.history, origin: view.origin, manual_bypass: view.manual_bypass }, challenges, responses, decisions, event, news, configs, agent_run: agentRun ? { id: agentRun.id, model: agentRun.model, prompt_version: agentRun.prompt_version } : null, audit })
}

export async function agentRunTrace(ctx: AppCtx, runId: string) {
  requireRole(ctx, 'CIO', 'COMPLIANCE', 'ADMIN')
  const run = await ctx.repo.get('agent_runs', runId)
  if (!run) throw new HttpError(404, `Không có lượt chạy ${runId}`)
  const nodes = await ctx.repo.list('agent_node_runs', 'run_id = ?', [runId], 'seq')
  return { run, nodes }
}

export async function auditList(ctx: AppCtx, q: { object?: string; action?: string; limit?: number; after?: number }) {
  requireRole(ctx, 'COMPLIANCE', 'CIO', 'ADMIN')
  const where: string[] = [], params: unknown[] = []
  if (q.object) { where.push('object = ?'); params.push(q.object) }
  if (q.action) { where.push('action LIKE ?'); params.push(q.action + '%') }
  if (q.after) { where.push('seq > ?'); params.push(q.after) }
  // CIO và Quản trị không thấy chi tiết gói đầu vào; Tuân thủ xem toàn bộ
  const r = await ctx.env.DB.prepare(`SELECT * FROM audit_log${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY seq DESC LIMIT ?`).bind(...params, Math.min(q.limit ?? 200, 2000)).all<AuditRow>()
  return r.results.map(x => ctx.user.role === 'COMPLIANCE' ? x : { ...x, data: x.data.length > 400 ? x.data.slice(0, 400) + '…' : x.data })
}

export async function auditExport(ctx: AppCtx, format: 'csv' | 'json') {
  requireRole(ctx, 'COMPLIANCE')
  const r = await ctx.env.DB.prepare('SELECT * FROM audit_log ORDER BY seq').all<AuditRow>()
  const u = ctx.uow(); u.audit({ actor: actor(ctx), action: 'audit.exported', object: 'audit_log', data: { format, count: r.results.length } }); await u.commit()
  if (format === 'json') return JSON.stringify(r.results, null, 1)
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return ['seq,ts,actor,action,object,data,prev_hash,hash', ...r.results.map(x => [x.seq, x.ts, x.actor, x.action, x.object, x.data, x.prev_hash, x.hash].map(esc).join(','))].join('\n')
}

export async function verifyChain(ctx: AppCtx) {
  requireRole(ctx, 'COMPLIANCE', 'ADMIN')
  return verifyAuditChain(ctx.env.DB, ctx.repo.auditKey)
}

// FR-805: danh mục agent – tên, mục đích, chủ sở hữu, mức rủi ro, mô hình, phiên bản prompt, ngày đánh giá gần nhất
export async function agentCatalog(ctx: AppCtx) {
  const models = await activeConfig<ModelSet>(ctx, 'MODEL')
  const prompts = await activeConfig<PromptSet>(ctx, 'PROMPT')
  const last = async (agent: string) => (await ctx.repo.list<{ created_at: string }>('agent_runs', 'agent = ?', [agent], 'created_at DESC'))[0]?.created_at ?? null
  // Agent Phản biện chạy ngoài agent_runs: mỗi lượt là một báo cáo phản biện
  const lastChallenge = async () => (await ctx.repo.list<{ created_at: string }>('challenges', '', [], 'created_at DESC'))[0]?.created_at ?? null
  const base = { prompt_version: prompts.version.id, prompt_set: prompts.content.version, model_version: models.version.id, mode: ctx.agentMode, last_evaluated: '2026-10-10 (bộ kiểm thử mock, AC-02, AC-03, AC-28, AC-34)' }
  return [
    { id: 'cio', name: 'Agent CIO', purpose: 'Lập nhận định có cấu trúc về tác động của một sự kiện theo loại tài sản, ngành, mã và tỷ giá; chỉ chọn mức độ −3..+3, không đưa con số %', owner: 'CIO (Giám đốc đầu tư)', risk: 'Cao – đầu vào cho quyết định đầu tư; có cổng duyệt của CIO và phản biện độc lập', model: models.content.cio, ...base, last_run: await last('cio'),
      graph: { nodes: GRAPH_NODES, description: 'dữ liệu (xác định) → 4 nhóm phân tích song song → tranh luận tăng/giảm (|mức| ≥ 2 hoặc ngược hướng, tối đa 2 vòng) → tổng hợp → kiểm tra schema (thử lại tối đa 2 lần)' },
      references: [{ repo: 'TauricResearch/TradingAgents', license: 'Apache-2.0', use: 'Tham khảo kiến trúc (đội phân tích, tranh luận, người tổng hợp); tự viết mã, không fork; bỏ trader, quản lý danh mục và nguồn dữ liệu Mỹ' }, { repo: 'langchain-ai/langgraphjs (@langchain/langgraph)', license: 'MIT', use: 'Thư viện điều phối đồ thị' }] },
    { id: 'challenger', name: 'Agent Phản biện', purpose: 'Kiểm tra nhận định trước khi CIO duyệt, phản biện lại chỗ CIO sửa, viết tóm tắt hậu kiểm từ phát hiện quy tắc', owner: 'Tuân thủ (tuyến 2)', risk: 'Trung bình – không chặn duyệt; chạy ngoài đồ thị, khác mô hình với Agent CIO', model: models.content.challenger, ...base, last_run: await lastChallenge() },
    { id: 'policy', name: 'Agent Chính sách', purpose: 'Tóm tắt có cấu trúc văn bản chính sách công khai đã được xác nhận nguồn, trích đúng điều khoản', owner: 'Tuân thủ (tuyến 2)', risk: 'Trung bình – không xem dữ liệu danh mục, không kết luận cho gia đình cụ thể', model: models.content.policy, ...base, last_run: await last('policy') },
  ]
}

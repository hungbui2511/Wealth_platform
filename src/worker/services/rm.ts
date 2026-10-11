// Màn hình RM (M7): chỉ kết quả đang hiệu lực (và đã thay thế, thu hồi kèm nhãn); diễn giải nội bộ kiểm tra BR-13, BR-14, BR-27.
import type { FamilyImpactResult } from '../../engine/apply'
import { allowedFromResult, checkText, templateInterpretation } from '../../engine/numbercheck'
import { fmtPct, fmtVndShort } from '../../shared/format'
import { ASSET_CLASS_LABELS } from '../../shared/catalog'
import { mentionsRestricted, redactRestricted } from '../../compliance/controls'
import { callJson } from '../../agents/llm'
import { wrapData, type ModelSet, type PromptSet } from '../../agents/prompts'
import { MOCK } from '../../data/mock'
import { actor, assertFamily, HttpError, type AppCtx } from '../ctx'
import { activeConfig, activeRestricted, loadConfigs } from './config'
import { getRun, type RunRec } from './apply'
import type { EventRec } from './events'
import type { Family } from '../../shared/types'

export const RM_VISIBLE = ['EFFECTIVE', 'SUPERSEDED', 'WITHDRAWN']
const visibleTo = (ctx: AppCtx, status: string) => ctx.user.role !== 'RM' || RM_VISIBLE.includes(status)

export async function familyImpacts(ctx: AppCtx, familyId: string) {
  assertFamily(ctx, familyId)
  const rows = await ctx.repo.list<FamilyImpactResult & { run_id: string }>('family_impacts', 'family_id = ?', [familyId])
  const runs = new Map<string, RunRec>()
  for (const r of rows) if (!runs.has(r.run_id)) runs.set(r.run_id, await getRun(ctx, r.run_id))
  const events = new Map<string, EventRec>()
  const out = []
  for (const r of rows) {
    const run = runs.get(r.run_id)!
    if (!visibleTo(ctx, run.status)) continue
    if (!events.has(run.event_id)) events.set(run.event_id, (await ctx.repo.get<EventRec>('events', run.event_id))!)
    out.push({ run: { id: run.id, status: run.status, view_id: run.view_id, event_id: run.event_id, price_date: run.price_date, effective_at: run.effective_at, config_version_id: run.config_version_id }, event: { id: run.event_id, title: events.get(run.event_id)!.title, type: events.get(run.event_id)!.type }, result: r })
  }
  out.sort((a, b) => (b.run.effective_at ?? '').localeCompare(a.run.effective_at ?? ''))
  const goalImpacts = (await ctx.repo.list<Record<string, unknown> & { run_id: string }>('goal_impacts', 'family_id = ?', [familyId])).filter(g => runs.has(g.run_id) && visibleTo(ctx, runs.get(g.run_id)!.status)).map(g => ({ ...g, run_status: runs.get(g.run_id)!.status }))
  return { impacts: out, goal_impacts: goalImpacts }
}

// FR-701: danh sách gia đình RM phụ trách kèm kết quả theo sự kiện
export async function familyList(ctx: AppCtx, filter: { event?: string; alert?: string }) {
  let fams = await ctx.repo.list<Family>('families', '', [], 'id')
  if (ctx.user.role === 'RM') fams = fams.filter(f => ctx.user.families.includes(f.id))
  const runs = await ctx.repo.list<RunRec>('application_runs')
  const visible = runs.filter(r => visibleTo(ctx, r.status))
  const runIds = new Set(visible.map(r => r.id))
  const impacts = (await ctx.repo.list<FamilyImpactResult & { run_id: string }>('family_impacts')).filter(i => runIds.has(i.run_id))
  const gis = (await ctx.repo.list<{ run_id: string; family_id: string; alert: boolean; delta_pts: string; goal_name: string; level_after: string }>('goal_impacts')).filter(g => runIds.has(g.run_id))
  const events = await ctx.repo.list<EventRec>('events')
  return fams.map(f => {
    const rows = impacts.filter(i => i.family_id === f.id).map(i => {
      const r = visible.find(x => x.id === i.run_id)!
      return { run_id: r.id, status: r.status, event_id: r.event_id, event_title: events.find(e => e.id === r.event_id)?.title, impact: i.impact, pct: i.pct, alert: i.alert, illiquid: i.illiquid_impact, net_worth: i.net_worth, effective_at: r.effective_at }
    }).filter(x => (!filter.event || x.event_id === filter.event) && (!filter.alert || x.alert === filter.alert))
    return {
      id: f.id, name: f.name, rm_id: f.rm_id, persona: f.persona, results: rows,
      goal_alerts: gis.filter(g => g.family_id === f.id && g.alert && visible.find(r => r.id === g.run_id)?.status === 'EFFECTIVE').map(g => ({ goal: g.goal_name, delta_pts: g.delta_pts, level_after: g.level_after })),
    }
  })
}

function mockInterpretation(familyName: string, familyId: string, r: FamilyImpactResult, summary: string, restricted: Set<string>): string {
  const dir = Number(r.impact) < 0 ? 'giảm' : 'tăng'
  const top = Object.entries(r.by_asset_class).filter(([, v]) => Number(v) !== 0).sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1])))[0]
  const parts = [`Sau nhận định "${summary}", danh mục của ${familyName} ước tính ${dir} khoảng ${fmtVndShort(String(Math.abs(Number(r.impact))))} đồng, tức ${r.pct === null ? 'không xác định' : fmtPct(String(Math.abs(Number(r.pct))))} tài sản ròng.`]
  if (top) parts.push(`Nhóm chịu tác động lớn nhất là ${ASSET_CLASS_LABELS[top[0] as keyof typeof ASSET_CLASS_LABELS]} (${fmtVndShort(top[1])}).`)
  const t = r.top_instruments.filter(x => !restricted.has(x.instrument_id))[0]
  if (t) parts.push(`Đóng góp lớn nhất đến từ ${t.name} (${fmtVndShort(t.impact)}).`)
  if (MOCK.interpretation.inject[familyId]) parts.push(MOCK.interpretation.inject[familyId])
  parts.push('Con số là cú sốc giả định theo cấu hình minh họa, không phải dự báo.')
  return parts.join(' ')
}

// FR-703: diễn giải nội bộ; sai thì thay bằng đoạn mẫu xác định và ghi nhật ký
export async function interpretation(ctx: AppCtx, runId: string, familyId: string) {
  assertFamily(ctx, familyId)
  const run = await getRun(ctx, runId)
  if (!visibleTo(ctx, run.status)) throw new HttpError(403, 'RM chỉ xem được kết quả đã qua hậu kiểm')
  const r = await ctx.repo.get<FamilyImpactResult>('family_impacts', `${runId}|${familyId}`)
  if (!r) throw new HttpError(404, 'Không có kết quả của gia đình trong lần áp dụng này')
  const fam = (await ctx.repo.get<Family>('families', familyId))!
  const cfg = await loadConfigs(ctx)
  const restrictedEntries = activeRestricted(cfg, ctx.now())
  const restricted = new Set(restrictedEntries.flatMap(e => e.instruments))
  let text: string, model: string
  if (ctx.agentMode === 'mock') { text = mockInterpretation(fam.name, familyId, r, redactRestricted(run.view_body.summary, restrictedEntries), restricted); model = 'mock' }
  else {
    const models = await activeConfig<ModelSet>(ctx, 'MODEL'); const prompts = await activeConfig<PromptSet>(ctx, 'PROMPT')
    const pkg = { family_name: fam.name, result: { ...r, top_instruments: r.top_instruments.filter(t => !restricted.has(t.instrument_id)), positions: undefined }, view: { summary: run.view_body.summary, impacts: run.view_body.impacts.filter(l => l.level !== 0) } }
    try { const res = await callJson(ctx.env, models.content.interpretation, prompts.content.interpretation, wrapData('kết quả M6', pkg)); text = String((res.json as { text?: string }).text ?? ''); model = res.model }
    catch (e) { text = ''; model = `lỗi: ${(e as Error).message}` }
  }
  const check = checkText(text, allowedFromResult(r, run.view_body), cfg.banned)
  const restrictedHits = mentionsRestricted(text, restrictedEntries)
  const blocked = !check.ok || restrictedHits.length > 0 || !text
  const safeView = { ...run.view_body, summary: redactRestricted(run.view_body.summary, restrictedEntries) }
  const shown = blocked ? templateInterpretation(fam.name, r, safeView, restricted) : text
  const now = ctx.now()
  const u = ctx.uow()
  if (blocked) u.audit({ actor: 'SYSTEM:numbercheck', action: 'interpretation.blocked', object: `${runId}|${familyId}`, data: { violations: check.violations, restricted: restrictedHits, model, llm_text: text } })
  u.audit({ actor: actor(ctx), action: 'interpretation.viewed', object: `${runId}|${familyId}`, data: { blocked } })
  await u.commit()
  return { text: shown, source: blocked ? 'template' : 'llm', blocked, violations: check.violations, restricted_hits: restrictedHits, label: 'Nội bộ – không gửi khách hàng', watermark: { viewer: ctx.user.name, viewer_id: ctx.user.id, at: now } }
}

export async function addNote(ctx: AppCtx, familyId: string, body: { run_id?: string; text: string; seen?: boolean }) {
  assertFamily(ctx, familyId)
  if (ctx.user.role !== 'RM') throw new HttpError(403, 'Chỉ RM ghi chú')
  const note = { id: `NOTE-${familyId}-${await ctx.repo.nextSeq('NOTE')}`, family_id: familyId, user_id: ctx.user.id, run_id: body.run_id, text: String(body.text ?? '').slice(0, 2000), seen: !!body.seen, at: ctx.now() }
  const u = ctx.uow(); u.insert('rm_notes', note as never); u.audit({ actor: actor(ctx), action: 'rm.note', object: familyId, data: note }); await u.commit()
  return note
}

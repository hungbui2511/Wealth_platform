// Bản tin tuần cho RM (đợt 5 sau phản biện độc lập): gom việc cần làm trong 7 ngày cho các gia đình RM phụ trách.
// Chỉ RM xem được và chỉ gia đình của mình; nội dung qua bộ che danh sách hạn chế như mọi màn hình RM.
import type { FamilyImpactResult } from '../../engine/apply'
import type { Family } from '../../shared/types'
import { fmtPct, fmtVndShort } from '../../shared/format'
import { HttpError, canSeeRun, type AppCtx } from '../ctx'
import type { RunRec } from './apply'
import type { EventRec } from './events'
import type { PolicyDoc } from './policy'
import { familyStructure } from './portfolio'
import { familyNetting } from './netting'
import { redactForRm } from './redact'

export interface DigestItem { kind: 'impact' | 'goal' | 'policy' | 'leverage' | 'liquidity' | 'succession' | 'data'; level: 'RED' | 'YELLOW' | 'INFO'; text: string; link: string; unseen?: boolean }

export async function rmDigest(ctx: AppCtx, daysRaw = 7) {
  const days = Math.min(31, Math.max(1, Number.isFinite(daysRaw) ? daysRaw : 7))
  if (ctx.user.role !== 'RM') throw new HttpError(403, 'Bản tin tuần dành cho RM')
  const to = ctx.now(), from = new Date(Date.parse(to) - days * 864e5).toISOString()
  const fams = (await ctx.repo.list<Family>('families', '', [], 'id')).filter(f => ctx.user.families.includes(f.id))
  const runs = (await ctx.repo.list<RunRec>('application_runs')).filter(r => canSeeRun(ctx, r) && r.status === 'EFFECTIVE' && (r.effective_at ?? '') >= from)
  const runIds = new Set(runs.map(r => r.id))
  const events = new Map((await ctx.repo.list<EventRec>('events')).map(e => [e.id, e]))
  const impacts = (await ctx.repo.list<FamilyImpactResult & { run_id: string }>('family_impacts')).filter(i => runIds.has(i.run_id))
  const goals = (await ctx.repo.list<{ run_id: string; family_id: string; alert: boolean; goal_name: string; delta_pts: string; level_after: string }>('goal_impacts')).filter(g => runIds.has(g.run_id) && g.alert)
  const notes = await ctx.repo.list<{ family_id: string; run_id?: string; seen: boolean }>('rm_notes', 'user_id = ?', [ctx.user.id])
  const docs = new Map((await ctx.repo.list<PolicyDoc>('policy_documents')).map(d => [d.id, d]))
  const matches = (await ctx.repo.list<{ doc_id: string; family_id: string; reasons: string[] }>('policy_matches')).filter(m => {
    const d = docs.get(m.doc_id); const ev = d?.event_id ? events.get(d.event_id) : undefined
    return d?.state === 'ANALYZED' && (ev?.timestamps?.event_created_at ?? d.ingested_at) >= from
  })
  const out = []
  for (const f of fams) {
    const items: DigestItem[] = []
    for (const i of impacts.filter(x => x.family_id === f.id)) {
      const r = runs.find(x => x.id === i.run_id)!
      if (i.alert !== 'RED' && i.alert !== 'YELLOW') continue
      const unseen = !notes.some(n => n.family_id === f.id && n.run_id === r.id && n.seen)
      items.push({ kind: 'impact', level: i.alert, unseen, link: `/families/${f.id}`, text: `${events.get(r.event_id)?.title ?? r.event_id}: ước tính ${fmtVndShort(i.impact)}${i.pct ? ` (${fmtPct(i.pct)})` : ''}${(i as { p10_3m?: string }).p10_3m ? `, mốc xấu P10 3 tháng ${fmtVndShort((i as { p10_3m?: string }).p10_3m!)}` : ''}${unseen ? '. Chưa đánh dấu đã xem' : ''}` })
    }
    for (const g of goals.filter(x => x.family_id === f.id)) items.push({ kind: 'goal', level: 'YELLOW', link: `/families/${f.id}`, text: `Mục tiêu "${g.goal_name}" đổi mức sang ${g.level_after} hoặc giảm ${g.delta_pts} điểm` })
    for (const m of matches.filter(x => x.family_id === f.id)) items.push({ kind: 'policy', level: 'INFO', link: '/policy', text: `Văn bản mới khớp gia đình: ${docs.get(m.doc_id)?.title ?? m.doc_id}. ${m.reasons[0] ?? ''}` })
    try {
      const s = await familyStructure(ctx, f.id)
      for (const l of s.leverage.filter(x => x.status === 'MARGIN_CALL_NOW' || x.status === 'MARGIN_CALL_STRESS' || x.status === 'ABOVE_MAX')) items.push({ kind: 'leverage', level: l.status === 'MARGIN_CALL_NOW' ? 'RED' : 'YELLOW', link: `/families/${f.id}`, text: `${l.name}: ${l.message}` })
      for (const r of s.ladder.rows.filter(x => x.status !== 'OK')) items.push({ kind: 'liquidity', level: r.status as 'RED' | 'YELLOW', link: `/families/${f.id}`, text: `Thanh khoản khi căng thẳng ${r.label.toLowerCase()}: ${r.status === 'RED' ? 'thiếu' : 'mỏng'} (chênh lệch ${fmtVndShort(r.gap)})` })
      for (const e of s.succession.events) for (const x of e.findings.filter(y => y.level === 'RED')) items.push({ kind: 'succession', level: 'RED', link: `/families/${f.id}`, text: `${e.title}: ${x.text}` })
      if (s.missing.length || s.succession.data_gaps.length) items.push({ kind: 'data', level: 'INFO', link: `/families/${f.id}`, text: `Cần bổ sung dữ liệu: ${[...s.missing, ...s.succession.data_gaps].join('; ')}` })
    } catch { /* thiếu giá hoặc mô hình: bỏ phần cấu trúc, không chặn bản tin */ }
    const net = await familyNetting(ctx, f.id)
    const rank = { RED: 0, YELLOW: 1, INFO: 2 }
    items.sort((a, b) => rank[a.level] - rank[b.level])
    out.push({ family_id: f.id, name: f.name, items, net_active: net.events ? { events: net.events, impact_net: net.impact_net, impact_undecayed: net.impact_undecayed } : null })
  }
  out.sort((a, b) => b.items.filter(i => i.level === 'RED').length - a.items.filter(i => i.level === 'RED').length || b.items.length - a.items.length)
  const all = out.flatMap(x => x.items)
  return redactForRm(ctx, { period: { from, to }, counts: { red: all.filter(i => i.level === 'RED').length, yellow: all.filter(i => i.level === 'YELLOW').length, unseen: all.filter(i => i.unseen).length }, families: out })
}

// Nhánh tác động lên mục tiêu: ghi chú quy định đã phát hành × mục tiêu có dòng tiền ra nước ngoài của gia đình.
// Chỉ đọc bảng goals và news_items (ghi chú đã phát hành). Không đọc và không có dữ liệu chống rửa tiền.
import { matchProcedural, type NoteRef, type ProceduralAlert } from '../../engine/procedural'
import type { Goal } from '../../shared/types'
import { assertFamily, canSeeFamily, requireRole, type AppCtx } from '../ctx'
import type { NewsItem } from './events'
import { loadGoals } from './portfolio'

export async function releasedNotes(ctx: AppCtx): Promise<NoteRef[]> {
  const now = Date.parse(ctx.now())
  return (await ctx.repo.list<NewsItem>('news_items', '', [], 'id'))
    .filter(n => n.origin === 'exclusive' && n.research?.kind === 'regulatory_note' && n.research.status === 'RELEASED' && n.research.procedural && Date.parse(n.published_at) <= now)
    .map(n => ({ id: n.id, doc_no: n.research!.doc_no, title: n.title, published_at: n.published_at, procedural: n.research!.procedural! }))
}

export async function familyProcedural(ctx: AppCtx, familyId: string): Promise<ProceduralAlert[]> {
  requireRole(ctx, 'RM', 'CIO', 'COMPLIANCE', 'ADMIN')
  assertFamily(ctx, familyId)
  return matchProcedural(await releasedNotes(ctx), await loadGoals(ctx, familyId), ctx.now())
}

// Toàn bộ khách (CIO, Tuân thủ, Quản trị) hoặc khách mình phụ trách (RM)
export async function bookProcedural(ctx: AppCtx) {
  requireRole(ctx, 'RM', 'CIO', 'COMPLIANCE', 'ADMIN')
  const goals = (await loadGoals(ctx)).filter((g: Goal) => canSeeFamily(ctx, g.family_id))
  const notes = await releasedNotes(ctx)
  const alerts = matchProcedural(notes, goals, ctx.now())
  return {
    notes: notes.map(n => ({ ...n, families: new Set(alerts.filter(a => a.note_id === n.id).map(a => a.family_id)).size, contact: alerts.filter(a => a.note_id === n.id && a.tier === 'contact').length })),
    alerts,
  }
}

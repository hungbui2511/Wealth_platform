// Mục tiêu dài hạn (M9): RM nhập thay khách, dành riêng tài sản (FR-901 đến FR-903).
import type { Goal } from '../../shared/types'
import { D, sum } from '../../engine/dec'
import { actor, assertFamily, HttpError, requireRole, type AppCtx } from '../ctx'
import { loadFamily, loadGoals } from './portfolio'

const TYPES = ['education', 'retirement', 'purchase', 'succession', 'charity', 'other']
const PRIORITIES = ['essential', 'important', 'aspirational']

function validate(g: Goal, holdingIds: Set<string>, others: Goal[]) {
  const err = (m: string) => { throw new HttpError(422, m) }
  if (!g.name || g.name.length < 3) err('Tên mục tiêu tối thiểu 3 ký tự')
  if (!TYPES.includes(g.type)) err('Loại mục tiêu không hợp lệ')
  if (!PRIORITIES.includes(g.priority)) err('Mức ưu tiên không hợp lệ')
  if (!(g.month >= 1 && g.month <= 12) || !(g.year >= 2026 && g.year <= 2060)) err('Tháng/năm cần tiền không hợp lệ')
  if (!/^\d+(\.\d+)?$/.test(String(g.amount)) || Number(g.amount) <= 0) err('Số tiền phải dương')
  if (!['nominal', 'today'].includes(g.basis)) err('Cơ sở số tiền không hợp lệ')
  if (!g.source_note || g.source_note.length < 5) err('Cần ghi nguồn thông tin (ví dụ "theo trao đổi với khách ngày …")')
  if (g.spend.kind === 'multi' && !(g.spend.years >= 2 && g.spend.years <= 40)) err('Số năm chi đều từ 2 đến 40')
  for (const e of g.earmarks) {
    if (!holdingIds.has(e.holding_id)) err(`Vị thế ${e.holding_id} không thuộc gia đình`)
    const pct = D(e.pct)
    if (pct.lte(0) || pct.gt(1)) err('% dành riêng phải trong (0, 100%]')
    // FR-903: tổng % dành riêng của mỗi vị thế ≤ 100%
    const total = sum(others.filter(o => o.status === 'active' && o.id !== g.id).flatMap(o => o.earmarks.filter(x => x.holding_id === e.holding_id).map(x => D(x.pct)))).plus(pct)
    if (total.gt(1)) err(`Tổng % dành riêng của vị thế ${e.holding_id} vượt 100%`)
  }
}

function normalize(input: Partial<Goal>, familyId: string, id: string, prev?: Goal): Goal {
  return {
    id, family_id: familyId, name: String(input.name ?? prev?.name ?? ''), type: (input.type ?? prev?.type) as Goal['type'],
    beneficiary: input.beneficiary ?? prev?.beneficiary, year: Number(input.year ?? prev?.year), month: Number(input.month ?? prev?.month),
    amount: String(input.amount ?? prev?.amount), currency: 'VND', basis: (input.basis ?? prev?.basis ?? 'nominal') as Goal['basis'],
    cost_growth: String(input.cost_growth ?? prev?.cost_growth ?? '0'), spend: input.spend ?? prev?.spend ?? { kind: 'once' },
    priority: (input.priority ?? prev?.priority ?? 'important') as Goal['priority'], annual_contribution: String(input.annual_contribution ?? prev?.annual_contribution ?? '0'),
    source_note: String(input.source_note ?? prev?.source_note ?? ''), status: prev?.status ?? 'active',
    earmarks: (input.earmarks ?? prev?.earmarks ?? []).map(e => ({ holding_id: e.holding_id, pct: String(e.pct) })),
  }
}

export async function createGoal(ctx: AppCtx, familyId: string, input: Partial<Goal>) {
  requireRole(ctx, 'RM'); assertFamily(ctx, familyId)
  const f = await loadFamily(ctx, familyId)
  const others = await loadGoals(ctx, familyId)
  const draft = normalize(input, familyId, '')
  validate(draft, new Set(f.holdings.map(h => h.id)), others)
  // Cấp mã sau khi hợp lệ để mục tiêu bị từ chối không chiếm số
  const n = String(await ctx.repo.nextSeq(`goal:${familyId}`, 'SELECT max(CAST(substr(id, -2) AS INTEGER)) FROM goals WHERE family_id = ?', [familyId])).padStart(2, '0')
  const g = { ...draft, id: `GL-F${familyId.slice(-2)}-${n}` }
  const u = ctx.uow(); u.insert('goals', g as never); u.audit({ actor: actor(ctx), action: 'goal.created', object: g.id, data: g }); await u.commit()
  return g
}

export async function updateGoal(ctx: AppCtx, id: string, input: Partial<Goal>) {
  requireRole(ctx, 'RM')
  const prev = await ctx.repo.get<Goal>('goals', id)
  if (!prev) throw new HttpError(404, `Không có mục tiêu ${id}`)
  assertFamily(ctx, prev.family_id)
  const f = await loadFamily(ctx, prev.family_id)
  const g = normalize(input, prev.family_id, id, prev)
  validate(g, new Set(f.holdings.map(h => h.id)), await loadGoals(ctx, prev.family_id))
  const u = ctx.uow(); u.update('goals', g as never); u.audit({ actor: actor(ctx), action: 'goal.updated', object: id, data: { before: prev, after: g } }); await u.commit()
  return g
}

export async function closeGoal(ctx: AppCtx, id: string, note: string) {
  requireRole(ctx, 'RM')
  const prev = await ctx.repo.get<Goal>('goals', id)
  if (!prev) throw new HttpError(404, `Không có mục tiêu ${id}`)
  assertFamily(ctx, prev.family_id)
  const g = { ...prev, status: 'closed' as const }
  const u = ctx.uow(); u.update('goals', g as never); u.audit({ actor: actor(ctx), action: 'goal.closed', object: id, data: { note } }); await u.commit()
  return g
}

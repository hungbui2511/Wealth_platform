// Nạp lại dữ liệu mẫu từ đầu (NFR-10).
import { SEED } from '../../data/seed'
import { actor, requireRole, type AppCtx } from '../ctx'
import { TABLES, verifyAuditChain } from '../db'
import { initialConfigs } from './config'
import { createPriceSnapshot } from './portfolio'

export async function reseed(ctx: AppCtx, opts: { skipAuth?: boolean } = {}) {
  if (!opts.skipAuth) requireRole(ctx, 'ADMIN')
  const prev = await verifyAuditChain(ctx.env.DB).catch(() => ({ ok: false, count: 0 }))
  // Xóa dữ liệu nghiệp vụ và nạp lại trong cùng một lô nguyên tử. Nhật ký không bị xóa (NFR-13):
  // chuỗi mã băm nối tiếp, bản ghi system.reseed ghi lại tình trạng chuỗi trước khi nạp lại.
  const uow = ctx.uow()
  for (const t of [...Object.keys(TABLES), 'counters']) uow.raw(ctx.env.DB.prepare(`DELETE FROM ${t}`))
  for (const u of SEED.users) uow.put('users', { ...u })
  for (const f of SEED.families) uow.put('families', f as never)
  for (const g of SEED.goals) uow.put('goals', g as never)
  for (const i of SEED.instruments) uow.put('instruments', i as never)
  for (const c of initialConfigs(ctx.now())) uow.put('config_versions', c as never)
  uow.audit({ actor: actor(ctx), action: 'system.reseed', object: 'demo', data: { families: SEED.families.length, previous_chain: prev } })
  await uow.commit()
  const snap = await createPriceSnapshot(ctx)
  return { ok: true, families: SEED.families.length, goals: SEED.goals.length, instruments: SEED.instruments.length, snapshot: snap.id, previous_chain: prev }
}

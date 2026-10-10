// Nạp lại dữ liệu mẫu từ đầu (NFR-10).
import { SEED } from '../../data/seed'
import { actor, requireRole, type AppCtx } from '../ctx'
import { TABLES, verifyAuditChain } from '../db'
import { initialConfigs } from './config'
import { createPriceSnapshot } from './portfolio'

// Bản sao DDL nhật ký trong migrations/0001_schema.sql (dùng khi đặt lại toàn bộ demo)
export const AUDIT_DDL = `CREATE TABLE audit_log (seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, object TEXT, data TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_object ON audit_log(object);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log chỉ ghi thêm: không được UPDATE'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log chỉ ghi thêm: không được DELETE'); END;`

export async function reseed(ctx: AppCtx, opts: { skipAuth?: boolean } = {}) {
  if (!opts.skipAuth) requireRole(ctx, 'ADMIN')
  const prev = await verifyAuditChain(ctx.env.DB).catch(() => ({ ok: false, count: 0 }))
  const stmts = [...Object.keys(TABLES), 'counters'].map(t => ctx.env.DB.prepare(`DELETE FROM ${t}`))
  stmts.push(ctx.env.DB.prepare('DROP TABLE IF EXISTS audit_log'))
  await ctx.env.DB.batch(stmts)
  // Đặt lại nhật ký là thao tác ở mức schema (xóa bảng rồi tạo lại kèm trigger); bản ghi đầu của chuỗi mới ghi lại đầu chuỗi cũ
  for (const s of AUDIT_DDL.split(';\n')) await ctx.env.DB.prepare(s.trim().replace(/;$/, '')).run()
  const uow = ctx.uow()
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

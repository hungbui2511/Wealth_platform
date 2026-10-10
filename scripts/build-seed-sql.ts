// Sinh data/seed.sql: chạy đúng thủ tục nạp lại dữ liệu mẫu trên SQLite cục bộ rồi xuất ra lệnh SQL,
// để nạp cùng một bộ dữ liệu cho D1 cục bộ hoặc từ xa bằng một lệnh (NFR-10).
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createD1 } from '../tests/support/d1shim'
import { makeCtx } from '../src/worker/ctx'
import { reseed, AUDIT_DDL } from '../src/worker/services/admin'
import { TABLES } from '../src/worker/db'

const DB = createD1()
const ctx = makeCtx({ DB } as never, { id: 'SYSTEM', name: 'Nạp dữ liệu mẫu (CLI)', role: 'ADMIN', families: [] })
await reseed(ctx, { skipAuth: true })
const raw = (DB as unknown as { _raw: import('node:sqlite').DatabaseSync })._raw
const q = (v: unknown) => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
const lines: string[] = ['-- Sinh bởi scripts/build-seed-sql.ts – dữ liệu giả lập, không phải dữ liệu thật']
for (const t of [...Object.keys(TABLES), 'counters']) lines.push(`DELETE FROM ${t};`)
lines.push('DROP TABLE IF EXISTS audit_log;', ...AUDIT_DDL.split('\n'))
for (const t of [...Object.keys(TABLES), 'counters', 'audit_log']) {
  for (const row of raw.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]) {
    lines.push(`INSERT INTO ${t} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`)
  }
}
const out = join(dirname(new URL(import.meta.url).pathname), '..', 'data', 'seed.sql')
writeFileSync(out, lines.join('\n') + '\n')
console.log(`Đã ghi ${out} (${lines.length} dòng)`)

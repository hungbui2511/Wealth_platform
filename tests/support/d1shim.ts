// Shim D1 trên node:sqlite để chạy kiểm thử tích hợp API mà không cần workerd.
// Cùng SQL migration (kể cả trigger nhật ký) được áp dụng như trên D1.
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

class Stmt {
  constructor(private db: DatabaseSync, public sql: string, public params: unknown[] = []) {}
  bind(...p: unknown[]) { return new Stmt(this.db, this.sql, p) }
  private norm() { return this.params.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)) as never[] }
  async first<T>(col?: string): Promise<T | null> {
    const r = this.db.prepare(this.sql).get(...this.norm()) as Record<string, unknown> | undefined
    if (!r) return null
    return (col ? r[col] : { ...r }) as T
  }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...this.norm()).map(r => ({ ...r })) as T[], success: true, meta: {} } }
  async run() { const r = this.db.prepare(this.sql).run(...this.norm()); return { success: true, meta: { changes: r.changes } } }
  async raw() { return this.db.prepare(this.sql).all(...this.norm()).map(r => Object.values(r as object)) }
  runSync() {
    const st = this.db.prepare(this.sql)
    if (/\bRETURNING\b/i.test(this.sql) || /^\s*SELECT/i.test(this.sql)) return st.all(...this.norm())
    return st.run(...this.norm())
  }
}

export function createD1(): D1Database {
  const db = new DatabaseSync(':memory:')
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'))
  const api = {
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      db.exec('BEGIN')
      try {
        const out = stmts.map(s => ({ results: s.runSync(), success: true, meta: {} }))
        db.exec('COMMIT')
        return out
      } catch (e) { db.exec('ROLLBACK'); throw new Error('D1_ERROR: ' + (e as Error).message) }
    },
    async exec(sql: string) { db.exec(sql); return { count: 1, duration: 0 } },
    _raw: db,
  }
  return api as unknown as D1Database
}

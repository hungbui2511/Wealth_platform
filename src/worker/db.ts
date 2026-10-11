// Lớp truy vấn SQL mỏng qua binding D1. Ghi theo lô (batch) để vừa giới hạn truy vấn của D1 (NFR-22).
import { canonical, sha256 } from '../engine/hash'

export const TABLES: Record<string, string[]> = {
  users: ['id', 'role'],
  families: ['id', 'rm_id'],
  goals: ['id', 'family_id', 'status'],
  instruments: ['id'],
  price_points: ['id', 'key', 'date'],
  price_snapshots: ['id', 'price_date', 'hash', 'created_at'],
  news_items: ['id', 'event_id'],
  events: ['id', 'type', 'created_at'],
  views: ['id', 'event_id', 'version', 'status'],
  agent_runs: ['id', 'agent', 'subject_id', 'created_at'],
  agent_node_runs: ['id', 'run_id', 'seq'],
  challenges: ['id', 'view_id', 'stage', 'created_at'],
  finding_responses: ['id', 'view_id', 'finding_id'],
  decisions: ['id', 'view_id', 'action', 'idem_key'],
  application_runs: ['id', 'view_id', 'event_id', 'status', 'idem_key', 'created_at'],
  run_snapshots: ['id', 'hash'],
  family_impacts: ['id', 'run_id', 'family_id'],
  goal_impacts: ['id', 'run_id', 'family_id'],
  config_versions: ['id', 'kind', 'seq', 'status', 'created_at'],
  policy_documents: ['id', 'status'],
  policy_matches: ['id', 'doc_id', 'family_id'],
  research_releases: ['id', 'view_id', 'status'],
  rm_notes: ['id', 'family_id', 'user_id'],
}

export type Doc = Record<string, unknown> & { id: string }

export class Repo {
  constructor(public db: D1Database) {}

  async get<T = Doc>(table: string, id: string): Promise<T | null> {
    const r = await this.db.prepare(`SELECT data FROM ${table} WHERE id = ?`).bind(id).first<{ data: string }>()
    return r ? JSON.parse(r.data) as T : null
  }

  async list<T = Doc>(table: string, where = '', params: unknown[] = [], order = ''): Promise<T[]> {
    const sql = `SELECT data FROM ${table}${where ? ' WHERE ' + where : ''}${order ? ' ORDER BY ' + order : ''}`
    const r = await this.db.prepare(sql).bind(...params).all<{ data: string }>()
    return (r.results ?? []).map(x => JSON.parse(x.data) as T)
  }

  // Mã tiếp theo theo số lớn nhất đang có (tránh trùng với mã cố định của gói mẫu); một truy vấn
  async nextId(table: string, prefix: string, width: number): Promise<string> {
    const r = await this.db.prepare(`SELECT id FROM ${table} WHERE id LIKE ? ORDER BY id DESC LIMIT 1`).bind(prefix + '%').first<{ id: string }>()
    const n = r ? Number(r.id.slice(prefix.length)) + 1 : 1
    return prefix + String(n).padStart(width, '0')
  }

  async nextSeq(name: string): Promise<number> {
    const r = await this.db.prepare('INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value').bind(name).first<{ value: number }>()
    return r!.value
  }
}

export interface AuditInput { actor: string; action: string; object?: string; data?: unknown }

// Đơn vị công việc: gom mọi lệnh ghi và bản ghi nhật ký của một yêu cầu vào một lô nguyên tử
export class UnitOfWork {
  private writes: { table: string; doc: Doc; mode: 'upsert' | 'insert' }[] = []
  private audits: AuditInput[] = []
  private pre: D1PreparedStatement[] = []
  constructor(private repo: Repo, private now: () => string) {}

  put(table: string, doc: Doc) { this.writes.push({ table, doc, mode: 'upsert' }); return this }
  insert(table: string, doc: Doc) { this.writes.push({ table, doc, mode: 'insert' }); return this }
  audit(a: AuditInput) { this.audits.push(a); return this }
  // Câu lệnh chạy đầu lô, cùng giao dịch với phần ghi (ví dụ xóa dữ liệu khi nạp lại)
  raw(stmt: D1PreparedStatement) { this.pre.push(stmt); return this }
  get pending() { return this.writes.length + this.audits.length }

  private statements(): D1PreparedStatement[] {
    const db = this.repo.db
    const out: D1PreparedStatement[] = [...this.pre]
    // Gom theo bảng/chế độ: một lệnh INSERT ... SELECT FROM json_each(?) cho nhiều bản ghi
    const groups = new Map<string, Doc[]>()
    for (const w of this.writes) {
      const k = `${w.table}|${w.mode}`
      groups.set(k, [...(groups.get(k) ?? []), w.doc])
    }
    for (const [k, docs] of groups) {
      const [table, mode] = k.split('|')
      const cols = TABLES[table]
      if (!cols) throw new Error(`Bảng không được khai báo: ${table}`)
      const verb = mode === 'insert' ? 'INSERT' : 'INSERT OR REPLACE'
      // Bản ghi sau cùng với cùng id thắng
      const dedup = new Map<string, Doc>()
      for (const d of docs) dedup.set(d.id, d)
      const rows = [...dedup.values()].map(d => ({ ...Object.fromEntries(cols.map(c => [c, d[c] ?? null])), data: JSON.stringify(d) }))
      const select = [...cols, 'data'].map(c => `json_extract(value, '$.${c}')`).join(', ')
      out.push(db.prepare(`${verb} INTO ${table} (${[...cols, 'data'].join(', ')}) SELECT ${select} FROM json_each(?)`).bind(JSON.stringify(rows)))
    }
    return out
  }

  async commit(): Promise<{ audit: { seq: number; hash: string }[] }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const stmts = this.statements()
      const auditRows: { seq: number; ts: string; actor: string; action: string; object: string | null; data: string; prev_hash: string; hash: string }[] = []
      if (this.audits.length) {
        const last = await this.repo.db.prepare('SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1').first<{ seq: number; hash: string }>()
        let seq = last?.seq ?? 0
        let prev = last?.hash ?? 'GENESIS'
        for (const a of this.audits) {
          seq += 1
          const ts = this.now()
          const data = canonical(a.data ?? {})
          const hash = await sha256(prev + canonical({ seq, ts, actor: a.actor, action: a.action, object: a.object ?? null, data }))
          auditRows.push({ seq, ts, actor: a.actor, action: a.action, object: a.object ?? null, data, prev_hash: prev, hash })
          prev = hash
        }
        stmts.push(this.repo.db.prepare(`INSERT INTO audit_log (seq, ts, actor, action, object, data, prev_hash, hash)
          SELECT json_extract(value,'$.seq'), json_extract(value,'$.ts'), json_extract(value,'$.actor'), json_extract(value,'$.action'),
                 json_extract(value,'$.object'), json_extract(value,'$.data'), json_extract(value,'$.prev_hash'), json_extract(value,'$.hash')
          FROM json_each(?)`).bind(JSON.stringify(auditRows)))
      }
      if (!stmts.length) return { audit: [] }
      try {
        await this.repo.db.batch(stmts)
        this.writes = []; this.audits = []; this.pre = []
        return { audit: auditRows.map(r => ({ seq: r.seq, hash: r.hash })) }
      } catch (e) {
        // Xung đột số thứ tự nhật ký khi có yêu cầu song song: thử lại với đầu chuỗi mới
        if (attempt < 2 && /UNIQUE|PRIMARY KEY|constraint/i.test(String(e)) && this.audits.length) continue
        throw e
      }
    }
    throw new Error('Không ghi được lô dữ liệu')
  }
}

export interface AuditRow { seq: number; ts: string; actor: string; action: string; object: string | null; data: string; prev_hash: string; hash: string }

// Lệnh kiểm tra tính toàn vẹn của chuỗi mã băm (NFR-13)
export async function verifyAuditChain(db: D1Database): Promise<{ ok: boolean; count: number; broken_at?: number; head?: string }> {
  const r = await db.prepare('SELECT * FROM audit_log ORDER BY seq').all<AuditRow>()
  let prev = 'GENESIS'
  let expectedSeq = (r.results[0]?.seq) ?? 1
  for (const row of r.results) {
    const h = await sha256(prev + canonical({ seq: row.seq, ts: row.ts, actor: row.actor, action: row.action, object: row.object, data: row.data }))
    if (row.prev_hash !== prev || row.hash !== h || row.seq !== expectedSeq) return { ok: false, count: r.results.length, broken_at: row.seq }
    prev = row.hash; expectedSeq++
  }
  return { ok: true, count: r.results.length, head: prev }
}

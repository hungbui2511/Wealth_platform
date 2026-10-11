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
  policy_documents: ['id', 'state'],
  policy_matches: ['id', 'doc_id', 'family_id'],
  research_releases: ['id', 'view_id', 'status'],
  rm_notes: ['id', 'family_id', 'user_id'],
  jobs: ['id', 'kind', 'status', 'subject', 'created_at'],
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

  // Cấp số tăng dần nguyên tử (một câu lệnh, D1 chạy tuần tự nên hai yêu cầu song song không nhận trùng số).
  // floorSql (tùy chọn) trả về số lớn nhất đang có, để không trùng với mã cố định của gói mẫu.
  // step > 1 giữ chỗ một khối số liên tiếp; trả về số cuối của khối.
  async nextSeq(name: string, floorSql?: string, floorParams: unknown[] = [], step = 1): Promise<number> {
    const n = Math.max(1, Math.trunc(step))
    const floor = floorSql ? `COALESCE((${floorSql}), 0) + ${n}` : String(n)
    const r = await this.db.prepare(`INSERT INTO counters (name, value) VALUES (?, ${floor}) ON CONFLICT(name) DO UPDATE SET value = max(counters.value + ${n}, excluded.value) RETURNING value`).bind(name, ...floorParams).first<{ value: number }>()
    return r!.value
  }

  // Mã kế tiếp dạng <prefix><số> (ví dụ EV-2026-0008)
  async nextId(table: string, prefix: string, width: number): Promise<string> {
    return (await this.nextIds(table, prefix, width, 1))[0]
  }
  async nextIds(table: string, prefix: string, width: number, count: number): Promise<string[]> {
    const last = await this.nextSeq(`id:${prefix}`, `SELECT CAST(substr(id, ${prefix.length + 1}) AS INTEGER) FROM ${table} WHERE id LIKE ? ORDER BY id DESC LIMIT 1`, [prefix + '%'], count)
    return Array.from({ length: count }, (_, i) => prefix + String(last - count + 1 + i).padStart(width, '0'))
  }
}

// Bản ghi đã bị yêu cầu khác thay đổi sau khi đọc (khóa lạc quan theo trường rev) → HTTP 409
export class ConflictError extends Error {
  constructor() { super('Dữ liệu vừa được người khác thay đổi; tải lại rồi thử lại') }
}
const CONFLICT_GUARD = "INSERT INTO counters (name, value) SELECT '__conflict__', NULL WHERE changes() = 0"
const isConflict = (e: unknown) => /NOT NULL constraint failed: counters\.value/i.test(String(e))

export interface AuditInput { actor: string; action: string; object?: string; data?: unknown }

// Đơn vị công việc: gom mọi lệnh ghi và bản ghi nhật ký của một yêu cầu vào một lô nguyên tử.
// put: ghi đè (dữ liệu tham chiếu, kết quả tính lại được). insert: bản ghi mới, trùng mã thì lỗi.
// update: sửa bản ghi đã đọc, chỉ thành công nếu rev chưa đổi kể từ lúc đọc; ghi rev + 1.
type WriteMode = 'upsert' | 'insert' | 'update'
export class UnitOfWork {
  private writes = new Map<string, { table: string; doc: Doc; mode: WriteMode; rev?: number }>()
  private audits: AuditInput[] = []
  private pre: D1PreparedStatement[] = []
  constructor(private repo: Repo, private now: () => string) {}

  private add(table: string, doc: Doc, mode: WriteMode) {
    const key = `${table}|${doc.id}`
    const prev = this.writes.get(key)
    if (!prev) {
      const rev = mode === 'update' ? Number(doc.rev ?? 0) : undefined
      this.writes.set(key, { table, doc: mode === 'update' ? { ...doc, rev: rev! + 1 } : doc, mode, rev })
    } else if (prev.mode === 'update') {
      // Ghi lần nữa trong cùng yêu cầu: giữ rev lúc đọc ban đầu
      this.writes.set(key, { ...prev, doc: { ...doc, rev: prev.rev! + 1 } })
    } else this.writes.set(key, { ...prev, doc })
    return this
  }
  put(table: string, doc: Doc) { return this.add(table, doc, 'upsert') }
  insert(table: string, doc: Doc) { return this.add(table, doc, 'insert') }
  update(table: string, doc: Doc) { return this.add(table, doc, 'update') }
  audit(a: AuditInput) { this.audits.push(a); return this }
  // Câu lệnh chạy đầu lô, cùng giao dịch với phần ghi (ví dụ xóa dữ liệu khi nạp lại)
  raw(stmt: D1PreparedStatement) { this.pre.push(stmt); return this }
  get pending() { return this.writes.size + this.audits.length }

  private statements(): D1PreparedStatement[] {
    const db = this.repo.db
    const out: D1PreparedStatement[] = [...this.pre]
    const colsOf = (table: string) => { const c = TABLES[table]; if (!c) throw new Error(`Bảng không được khai báo: ${table}`); return c }
    // Gom theo bảng/chế độ: một lệnh INSERT ... SELECT FROM json_each(?) cho nhiều bản ghi
    const groups = new Map<string, Doc[]>()
    for (const w of this.writes.values()) {
      if (w.mode === 'update') continue
      const k = `${w.table}|${w.mode}`
      groups.set(k, [...(groups.get(k) ?? []), w.doc])
    }
    for (const [k, docs] of groups) {
      const [table, mode] = k.split('|')
      const cols = colsOf(table)
      const verb = mode === 'insert' ? 'INSERT' : 'INSERT OR REPLACE'
      const rows = docs.map(d => ({ ...Object.fromEntries(cols.map(c => [c, d[c] ?? null])), data: JSON.stringify(d) }))
      const select = [...cols, 'data'].map(c => `json_extract(value, '$.${c}')`).join(', ')
      out.push(db.prepare(`${verb} INTO ${table} (${[...cols, 'data'].join(', ')}) SELECT ${select} FROM json_each(?)`).bind(JSON.stringify(rows)))
    }
    // Sửa có điều kiện: mỗi bản ghi một câu UPDATE, theo sau là câu chặn làm hỏng cả lô nếu không sửa được dòng nào
    for (const w of this.writes.values()) {
      if (w.mode !== 'update') continue
      const cols = colsOf(w.table).filter(c => c !== 'id')
      const set = [...cols.map(c => `${c} = json_extract(?1, '$.${c}')`), 'data = ?1'].join(', ')
      out.push(db.prepare(`UPDATE ${w.table} SET ${set} WHERE id = ?2 AND COALESCE(json_extract(data, '$.rev'), 0) = ?3`).bind(JSON.stringify(w.doc), w.doc.id, w.rev))
      out.push(db.prepare(CONFLICT_GUARD))
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
        this.writes.clear(); this.audits = []; this.pre = []
        return { audit: auditRows.map(r => ({ seq: r.seq, hash: r.hash })) }
      } catch (e) {
        if (isConflict(e)) throw new ConflictError()
        // Xung đột số thứ tự nhật ký khi có yêu cầu song song: thử lại với đầu chuỗi mới
        if (/audit_log/i.test(String(e)) && this.audits.length) { if (attempt < 2) continue; throw e }
        // Bản ghi mới trùng mã hoặc trùng khóa chống lặp: yêu cầu khác đã ghi trước
        if (/UNIQUE constraint failed/i.test(String(e))) throw new ConflictError()
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

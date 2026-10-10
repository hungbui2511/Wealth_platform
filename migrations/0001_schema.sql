-- Schema MVP1 trên Cloudflare D1 (SQLite). Mỗi bảng có cột khóa/chỉ mục và cột data (JSON) chứa toàn bộ bản ghi.

CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, role TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS families (id TEXT PRIMARY KEY, rm_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS goals_family ON goals(family_id);
CREATE TABLE IF NOT EXISTS instruments (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS price_points (id TEXT PRIMARY KEY, key TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS price_points_key ON price_points(key, date);
CREATE TABLE IF NOT EXISTS price_snapshots (id TEXT PRIMARY KEY, price_date TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS news_items (id TEXT PRIMARY KEY, event_id TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, type TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS views (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS views_event ON views(event_id);
CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, agent TEXT NOT NULL, subject_id TEXT, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_node_runs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS node_runs_run ON agent_node_runs(run_id);
CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, view_id TEXT NOT NULL, stage TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS challenges_view ON challenges(view_id);
CREATE TABLE IF NOT EXISTS finding_responses (id TEXT PRIMARY KEY, view_id TEXT NOT NULL, finding_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, view_id TEXT NOT NULL, action TEXT NOT NULL, idem_key TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS application_runs (id TEXT PRIMARY KEY, view_id TEXT NOT NULL, event_id TEXT NOT NULL, status TEXT NOT NULL, idem_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS runs_event ON application_runs(event_id);
CREATE TABLE IF NOT EXISTS run_snapshots (id TEXT PRIMARY KEY, hash TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS family_impacts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, family_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS fi_run ON family_impacts(run_id);
CREATE INDEX IF NOT EXISTS fi_family ON family_impacts(family_id);
CREATE TABLE IF NOT EXISTS goal_impacts (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, family_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS gi_family ON goal_impacts(family_id);
CREATE TABLE IF NOT EXISTS config_versions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, seq INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS cfg_kind ON config_versions(kind, seq);
CREATE TABLE IF NOT EXISTS policy_documents (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS policy_matches (id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, family_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research_releases (id TEXT PRIMARY KEY, view_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rm_notes (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);

-- Nhật ký chỉ ghi thêm (NFR-13): trigger từ chối UPDATE và DELETE; chuỗi mã băm nối các bản ghi
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  object TEXT,
  data TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_object ON audit_log(object);
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log chỉ ghi thêm: không được UPDATE'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log chỉ ghi thêm: không được DELETE'); END;

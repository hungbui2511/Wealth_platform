-- Tác vụ agent chạy nền (chế độ live, Cloudflare Workflows) và các bước tiến độ của từng tác vụ.
-- Tác vụ là dữ liệu vận hành; kết quả nghiệp vụ và nhật ký kiểm toán vẫn ghi ở các bảng nghiệp vụ và audit_log.
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, subject TEXT, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
CREATE TABLE IF NOT EXISTS job_steps (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, at TEXT NOT NULL, step TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS job_steps_job ON job_steps(job_id);

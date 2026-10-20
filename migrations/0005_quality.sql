-- Đợt 2 sau phản biện độc lập: đo chất lượng và vận hành.
-- forecasts: sổ dự báo (mỗi nhận định được duyệt có nhánh kịch bản), chấm điểm khi đến hạn 1 tuần / 3 tháng / 12 tháng.
-- market_series: số liệu thị trường theo ngày (nguồn chính thức hoặc báo trong danh sách nguồn) để chấm điểm và xem "đã phản ánh vào giá".
-- golden_runs: kết quả chạy lại bộ sự kiện chuẩn (phát hiện trôi khi đổi mô hình hoặc prompt).
-- canaries: bài kiểm tra phản biện có gài lỗi. incidents: sổ sự cố agent. agent_controls: tạm dừng từng agent. run_logs: nhịp tim lượt chạy theo lịch.
CREATE TABLE IF NOT EXISTS forecasts (id TEXT PRIMARY KEY, view_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS market_series (id TEXT PRIMARY KEY, key TEXT NOT NULL, date TEXT NOT NULL, origin TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS market_series_key_date ON market_series(key, date);
CREATE TABLE IF NOT EXISTS golden_runs (id TEXT PRIMARY KEY, golden_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS canaries (id TEXT PRIMARY KEY, view_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, agent TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_controls (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS run_logs (id TEXT PRIMARY KEY, schedule TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);

-- Kết quả do Claude lập ngoài hệ thống (chế độ external: Claude chạy agent trong phiên làm việc, gói subscription).
-- Claude chỉ GHI vào bảng này. Hệ thống nhập từng bản ghi qua đúng các kiểm soát như chế độ live (BR-26 nguồn công khai,
-- BR-27 danh sách hạn chế, schema Mục 7.3, phản biện, CIO duyệt) và ghi nhật ký chuỗi mã băm.
-- kind: news | event | cio_view | policy_summary. status: READY | IMPORTED | REJECTED.
CREATE TABLE IF NOT EXISTS external_outputs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS external_outputs_status ON external_outputs(status, kind, created_at);

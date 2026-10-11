-- Cột chỉ mục của policy_documents lưu trạng thái quy trình (state), không trùng tên với trạng thái pháp lý
-- của văn bản (status trong JSON, ví dụ "Lấy ý kiến"), để không ghi đè trường nghiệp vụ.
ALTER TABLE policy_documents RENAME COLUMN status TO state;

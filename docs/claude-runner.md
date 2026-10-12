# Claude chạy agent trong phiên làm việc (chế độ external)

Claude (gói subscription, trong phiên làm việc hoặc tác vụ định kỳ) tìm tin, chạy các agent, rồi **chỉ ghi** kết quả vào bảng
`external_outputs` của D1 `wealth-mvp1` (id `792b4d3a-39fc-498c-b6a2-4d3d7ebe234c`). Hệ thống nhập mỗi 10 phút (hoặc khi
CIO/Quản trị bấm **Nhập kết quả Claude** ở trang Sự kiện) qua đúng các kiểm soát: BR-26 nguồn công khai, BR-27 danh sách hạn
chế, schema Mục 7.3 (sai thì nhận định thành `AGENT_ERROR`), phản biện, và CIO duyệt. Mọi bước ghi nhật ký chuỗi mã băm với
tác nhân `ADMIN:CLAUDE`; lượt chạy ghi `mode: external` và tên mô hình trong `meta.model`.

## Rào chắn thông tin (BR-28): Claude được đọc gì

| Được đọc | Không đọc |
|---|---|
| `jobs` có `status = 'WAITING_EXTERNAL'` (yêu cầu của CIO) | `families`, `goals`, `family_impacts`, `goal_impacts`, `rm_notes` |
| `events`, `news_items` của sự kiện cần phân tích | `config_versions` loại `RESTRICTED` (danh sách hạn chế chỉ Tuân thủ xem) |
| `instruments` (chỉ cột mã, tên, loại tài sản, ngành) | `audit_log` |
| `views` đã duyệt gần nhất (để giữ nhất quán) | |

Quyền D1 của phiên hiện là quyền toàn cơ sở dữ liệu: rào chắn này là **cam kết quy trình**, chưa phải chặn kỹ thuật. Bản
thật cần một tài khoản dịch vụ chỉ được ghi `external_outputs` và đọc các bảng ở cột trái.

## Quy trình một lần chạy

1. Đọc yêu cầu đang chờ:
   `SELECT id, kind, subject, json_extract(data,'$.params') AS params FROM jobs WHERE status='WAITING_EXTERNAL'`
2. Tìm tin trong 1–3 ngày gần nhất trên nguồn công khai thuộc danh sách (vnexpress.net, vneconomy.vn, baodautu.vn,
   vietstock.vn, nhandan.vn, vtv.vn, chinhphu.vn, baochinhphu.vn, sbv.gov.vn, mof.gov.vn, ssc.gov.vn, quochoi.vn, hnx.vn,
   hsx.vn). Mở trang để lấy đúng tiêu đề, thời điểm công bố, tóm tắt. Không dùng thông tin chưa công bố.
3. Gom tin cùng một diễn biến thành sự kiện; chạy Agent CIO theo vai: 4 nhóm phân tích (Vĩ mô và lãi suất; Cổ phiếu và quỹ;
   Tín dụng và bất động sản; Hàng hóa và tài sản khác), tranh luận tăng/giảm cho dòng |mức| ≥ 2 hoặc ngược hướng, tổng hợp;
   rồi Agent Phản biện độc lập rà lại.
4. Ghi kết quả (mỗi bản ghi một câu, tham số theo thứ tự id, kind, subject, created_at, data):
   `INSERT INTO external_outputs (id, kind, subject, status, created_at, data) VALUES (?, ?, ?, 'READY', ?, ?)`
   Mã bản ghi: `EXT-<yyyymmdd>-<hhmm>-<số>`.
5. Bấm **Nhập kết quả Claude** (hoặc chờ cron), kiểm tra `SELECT id, status, json_extract(data,'$.error') FROM external_outputs ORDER BY created_at DESC LIMIT 20`.

## Dạng dữ liệu

**`news`** (subject để trống): `{"items":[{"title","url","published_at":"ISO 8601 +07:00","summary","source_name","suggested_type"}]}`

**`event`**: `{"ref":"CL-20261012-01","type":"monetary_policy|fiscal_tax|sector_regulation|corporate|global_macro|commodity|fx|geopolitical","title","news_urls":["…"]}`

**`cio_view`** (subject = `ref` của sự kiện vừa đẩy, hoặc mã `EV-…` của yêu cầu đang chờ; thêm `"rework": true` khi trả lời yêu cầu Làm lại):

```json
{
  "view": { "summary": "…", "impacts": [ImpactLine] },
  "nodes": { "analyst_macro": {"lines": [ImpactLine], "notes": "…"}, "analyst_equity": {…}, "analyst_credit_re": {…},
             "analyst_commodity": {…}, "debate": {"topics": [{"key":"asset_class:GOLD:GOLD","rounds":[{"bull":"…","bear":"…"}],"conclusion":"…","agreed":true}]} },
  "challenger": { "findings": [{"check","severity","target","issue","suggestion","source_ids"}], "counter_scenario": "…" },
  "meta": { "model": "Claude Opus 5.5", "session": "…", "prepared_at": "ISO 8601" }
}
```

ImpactLine: `scope` (`asset_class` | `sector` | `instrument` | `fx`), `asset_class`, `target`, `level` (số nguyên −3..+3),
`direction` (`positive` | `negative` | `neutral` | `insufficient_evidence`, khớp dấu của mức), `horizon`
(`<1 tháng` | `1-3 tháng` | `3-6 tháng` | `>6 tháng`, bắt buộc khi mức ≠ 0), `confidence` (`low` | `medium` | `high`, bắt
buộc khi mức ≠ 0), `rationale` (≥ 20 ký tự), `source_ids` (**đường dẫn tin**; hệ thống đổi sang mã tin; bắt buộc khi mức ≠ 0).
Nhận định cuối phải có đủ 11 dòng loại tài sản (CASH, GOV_BOND, CORP_BOND, EQ_VN, EQ_INTL, FUND, GOLD, REAL_ESTATE,
PRIVATE_EQ, CRYPTO, INSURANCE) và 3 dòng tỷ giá (USD, SGD, AUD). Không phần trăm, không giá mục tiêu, không khuyến nghị mua bán.

Phản biện: `check` thuộc `source_support`, `opposite_direction`, `overconfidence`, `inconsistency_with_past_view`,
`second_order_effect`; `severity` `critical` (tối đa 3, chỉ khi có thể đảo hướng hoặc lệch ≥ 2 mức) | `medium` | `low`;
`target` dạng `asset_class:GOLD:GOLD`; `issue`, `suggestion` ≥ 20 ký tự.

**`policy_summary`** (subject = mã văn bản `PD-…`, văn bản phải được Tuân thủ xác nhận nguồn trước):
`{"summary":{"changes":[{"change_id","article_refs":["Điều 3 khoản 1"],"quote","summary","topics":[…],"affected_parties","effective_from","certainty":"draft|final"}]},"meta":{…}}`

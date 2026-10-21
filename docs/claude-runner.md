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

**Kênh có chữ ký (đích kiến trúc, đã có trong mã):** khi đặt secret `EXTERNAL_HMAC_KEY` trên Worker, vùng AI không cần quyền
D1: gửi `POST /api/external/submit` với `{"id","kind","subject","data"}`, trong đó `data._sig` = HMAC-SHA-256(khóa, JSON chuẩn
hóa của `data` bỏ `_sig`, khóa sắp xếp). Khi khóa đang bật, mọi bản ghi không ký hoặc ký sai (kể cả ghi thẳng vào bảng) bị từ
chối khi nhập. Chưa đặt khóa thì báo cáo nhập liệt kê các bản ghi "chưa ký" và `/api/health` cảnh báo.

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

**`event`**: `{"ref":"CL-20261012-01","origin":"global|local (tùy chọn)","type":"monetary_policy|fiscal_tax|sector_regulation|corporate|global_macro|commodity|fx|geopolitical","title","news_urls":["…"]}`

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

**Nhánh kịch bản (thiết kế v2, nên có trong mọi `cio_view`)**: thêm `"scenarios"` vào `view`:
`{"priced_in":"none|partial|full","branches":[{"id":"B1","name":"…","probability":0.6,"regime":"calm|stress","core_shocks":[{"factor":"US10Y","size":"S|M|L","direction":"up|down"}],"rationale":"≥ 20 ký tự","source_ids":["đường dẫn tin"]}],"notes":"…"}`.
2–4 nhánh, tổng xác suất = 1, mỗi nhánh 1–5 yếu tố lõi lấy trong mô hình yếu tố (`src/data/factorModel.ts` hoặc cấu hình
`FACTOR_MODEL`): US10Y, DXY, GLOBAL_EQ, OIL, GOLD_W, CRYPTO, USDVND, VN_RATE, VN_GOV, CREDIT_RE, CREDIT_FIN, VN_EQ,
FOREIGN_FLOW, SJC_PREM, VN_RE. Chỉ chọn yếu tố là kênh truyền dẫn trực tiếp và cỡ trong thư viện; KHÔNG tự đặt con số.
Hệ thống tự suy ra các yếu tố còn lại theo tương quan và tính dải P5/P10/P50/P90 cho từng gia đình. **Bắt buộc**: nhận
định không có ít nhất 2 nhánh kịch bản thì CIO không duyệt được (điều kiện (e)); mọi con số tới RM và khách chỉ đến từ lớp kịch bản. Với tin quốc tế, nêu kênh
về Việt Nam (USDVND, VN_RATE, FOREIGN_FLOW) khi có căn cứ; VND là tiền tệ có quản lý. `priced_in` = mức thị trường đã phản ánh. Kiểm chứng 2022: tương quan chỉ suy ra khoảng 60% mức giảm VN-Index, nên nhánh căng thẳng phải đưa VN_EQ (và CREDIT_RE khi có rủi ro tín dụng) vào yếu tố lõi.

**Nguồn tin**: mỗi tin mang `origin` (`global` | `local`; hệ thống tự gắn). Tin `exclusive` (nghiên cứu Techcombank/TCBS)
chỉ do Khối Nghiên cứu nạp ở trang "Nghiên cứu & mô hình" và Tuân thủ cho phát hành; Claude không tạo tin độc quyền.

ImpactLine: `scope` (`asset_class` | `sector` | `instrument` | `fx`), `asset_class`, `target`, `level` (số nguyên −3..+3),
`direction` (`positive` | `negative` | `neutral` | `insufficient_evidence`, khớp dấu của mức), `horizon`
(`<1 tháng` | `1-3 tháng` | `3-6 tháng` | `>6 tháng`, bắt buộc khi mức ≠ 0), `confidence` (`low` | `medium` | `high`, bắt
buộc khi mức ≠ 0), `rationale` (≥ 20 ký tự), `source_ids` (**đường dẫn tin**; hệ thống đổi sang mã tin; bắt buộc khi mức ≠ 0).
Nhận định cuối phải có đủ 11 dòng loại tài sản (CASH, GOV_BOND, CORP_BOND, EQ_VN, EQ_INTL, FUND, GOLD, REAL_ESTATE,
PRIVATE_EQ, CRYPTO, INSURANCE) và 3 dòng tỷ giá (USD, SGD, AUD). Không phần trăm, không giá mục tiêu, không khuyến nghị mua bán.

Phản biện: `check` thuộc `source_support`, `opposite_direction`, `overconfidence`, `inconsistency_with_past_view`,
`second_order_effect`; `severity` `critical` (chỉ khi có thể đảo hướng hoặc lệch ≥ 2 mức; không bị hạ mức tự động) | `medium` | `low`;
`target` dạng `asset_class:GOLD:GOLD`; `issue`, `suggestion` ≥ 20 ký tự.

**`challenge`** (phản biện độc lập, subject = mã nhận định `VW-…`): `{"findings":[…],"counter_scenario":"…","meta":{"model":"…","session":"…"}}`.
Phản biện đi kèm trong `cio_view` do **cùng phiên** soạn nên hệ thống đánh dấu *chưa độc lập* và CIO **không duyệt được**
(điều kiện (f)). Phải có một bản ghi `challenge` từ **phiên làm việc khác** (`meta.session` khác phiên soạn) và **mô hình khác**
(`meta.model` khác mô hình soạn), chỉ đọc nhận định cuối, tin và danh mục (BR-05). Nếu nhận định đang chờ phản biện lại (CIO
đã sửa dòng hoặc nhánh kịch bản), bản ghi này được dùng làm lượt phản biện lại.

Phát hiện Nghiêm trọng không còn bị tự hạ mức: mọi phát hiện `critical` đều phải được CIO phản hồi trước khi duyệt.

**`policy_doc`** (Agent Rà soát pháp luật, subject để trống): văn bản mới (dự thảo hoặc đã ban hành) kèm đánh giá mức quan trọng.
`{"doc":{"title","agency","kind":"draft|final","status","published_at":"ISO 8601","effective_expected":"(tùy chọn)","url":"đường dẫn chính thức thuộc danh sách nguồn","topics":[POLICY_TOPICS],"content":"nguyên văn các điều khoản chính, tối đa 20.000 ký tự"},"assessment":{"importance":"high|medium|low","score":1-10,"doc_type":"luat|nghi_quyet|nghi_dinh|thong_tu|quyet_dinh|khac","stage":"lay_y_kien|tham_dinh|trinh_quoc_hoi|thao_luan_quoc_hoi|thong_qua|ban_hanh|co_hieu_luc","comment_deadline":"YYYY-MM-DD (tùy chọn)","expected_adoption":"YYYY-MM-DD (tùy chọn)","why_changed":"≥ 40 ký tự: bất cập và mục tiêu chính sách","key_points":["điểm mới, nêu điều khoản"],"impact_private":"≥ 30 ký tự","impact_tcb":"≥ 30 ký tự","recommended_action":"analyze_now|monitor|ignore","sources":["đường dẫn thuộc danh sách nguồn"]},"meta":{"model","session","prepared_at"}}`.
Văn bản vào Radar chính sách ở trạng thái chờ Tuân thủ xác nhận nguồn; trùng đường dẫn bị từ chối. Đánh giá là gợi ý ưu tiên của AI; trích dẫn
điều khoản chỉ được kiểm chứng khi Agent Chính sách phân tích (policy_summary) sau khi Tuân thủ xác nhận nguồn và CIO/Quản trị bấm chạy.
POLICY_TOPICS: TAX_SECURITIES, PROPERTY_LAND, INHERITANCE_GIFT, CORPORATE_HOLDING, FX_OFFSHORE, GOLD, DIGITAL_ASSET, CREDIT, INSURANCE.

**`policy_summary`** (subject = mã văn bản `PD-…`, văn bản phải được Tuân thủ xác nhận nguồn trước). Từ 18/10/2026 dùng
khung phân tích tác động VBPL (skill `vbpl-impact-analysis`) nhìn từ phía khách Private; tóm tắt kiểu cũ chỉ có `changes` bị từ chối.
```json
{"summary":{
  "changes":[{"change_id":"C1","article_refs":["Điều 3 khoản 1"],"quote":"<nguyên văn ≤400 ký tự>","summary":"…","before":"<quy định cũ | Chưa có quy định tương ứng>",
    "topics":["PROPERTY_LAND"],"affected_parties":"…","effective_from":"2027-07-01","certainty":"draft","materiality":"high",
    "analysis":{"why":CLAIM,"goal":CLAIM,"next_signal":CLAIM,"private_impact":CLAIM,"second_order":CLAIM?,"opportunity":CLAIM?}}],
  "private_brief":{"headline":"…","key_findings":[{"title":"…","text":"…","change_ids":["C1"],…CLAIM}],
    "segments":[{"segment":"…","why":"…","change_ids":["C1"]}],"milestones":[{"date":"2027-07-01","label":"…","article_ref":"Điều 9"}],
    "open_questions":[{"issue":"…","reading_1":"…","reading_2":"…","consequence":"…"}],"advisor_message":"…"}},
 "meta":{…}}
```
CLAIM = `{"text","basis":"evidence|inference","confidence":"high|medium|low","reasoning"?,"evidence"?:{"article_ref"?,"quote"?}}`.
Hệ thống kiểm tra và từ chối khi:
- `quote` hoặc `evidence.quote` không khớp nguyên văn với nội dung đã lưu. Khi so, hệ thống bỏ qua khác biệt khoảng trắng và kiểu dấu ngoặc.
- Điều khoản được dẫn không có trong văn bản.
- Nhận định `evidence` không dẫn điều khoản hoặc câu trích.
- Nhận định `inference` thiếu `reasoning` (≥ 30 ký tự).
- Dự báo (`next_signal`, `second_order`) là suy luận nhưng đặt `high`.
- Thay đổi `materiality: high` không có mặt trong `key_findings`.
- `change_ids` trỏ tới thay đổi không có.
- Có cụm từ trong danh sách cấm (BANNED) hoặc cụm từ kế hoạch hành động ("chủ trì", "đơn vị đầu mối", "giao cho khối/phòng"). Riêng câu trích nguyên văn không bị quét cụm từ.

Agent không nhận dữ liệu danh mục, nên tác động chỉ được viết theo nhóm khách, không theo gia đình. Hệ thống tự khớp gia đình bị chạm bằng quy tắc xác định. Mẫu đầy đủ: `data/mock_agent/policy/PD-2026-001.json`.

**`prices`** (subject để trống): tạo ảnh chụp giá mới từ ảnh chụp hiện tại, thay giá các mã có nguồn thật.
`{"price_date":"YYYY-MM-DD","points":[{"key":"MBB","price":"26150","date":"2026-10-09","source":"TCBS (MCP)","source_ref":"getTickerOverview"}],"meta":{…}}`
Giá do Claude lấy được gắn cờ `external_ai` (không phải nguồn chính thức có thỏa thuận dữ liệu); hậu kiểm ghi phát hiện mức Thấp
`price_external_ai` để người xem biết cần đối soát.

Tin có thời điểm công bố ở tương lai (lệch quá 10 phút so với lúc nhập) bị từ chối, không còn bị kéo về giờ nhập.
Khóa giá: mã công cụ (MBB, VHM12613, VEOF, SJC, BTC, AAPL…) hoặc `FX:USD`, `FX:SGD`, `FX:AUD`. Giá theo đơn vị của công cụ
(cổ phiếu VND/cổ phiếu, vàng VND/lượng, AAPL và VT USD/chứng chỉ). Mã không có trong lần đẩy giữ giá và nhãn nguồn của ảnh chụp
trước. Cổ phiếu niêm yết lấy từ kết nối TCBS (MCP) khi đã bật; không lấy giá bằng cách sao chép trang web của sở giao dịch.

## Bổ sung sau hai vòng phản biện độc lập (20/10/2026)

**Đổi cách xử lý loại cũ**
- `prices`: ảnh chụp giá do Claude lấy **chưa được dùng** cho tới khi CIO hoặc Tuân thủ xác nhận (ghi chú ≥ 20 ký tự) ở trang Giá.
  Trước khi xác nhận, mọi tính toán vẫn dùng ảnh chụp đã xác nhận gần nhất.
- `policy_doc`: hệ thống lưu mã băm nội dung, cờ `truncated` khi nội dung bị cắt ở 20.000 ký tự. Cùng đường dẫn mà nội dung khác
  thì thành **phiên bản mới** (`version`, `previous_id`), bản cũ được đánh dấu `superseded_by`; cùng nội dung bị từ chối. Tuân thủ
  xác nhận nguồn phải tick đã đối chiếu nội dung và gửi đúng mã băm; trang tra cứu thứ cấp (thuvienphapluat, luatvietnam…) phải ghi
  đã đối chiếu với bản gốc nào.
- `challenge`: phản biện **phải rà cả nhánh kịch bản** (check `scenario_consistency`: mức dòng ngược hướng với kịch bản;
  `scenario_balance`: một nhánh ≥ 80%, mọi nhánh cùng chiều, không có nhánh căng thẳng). Hệ thống cũng tự chạy các kiểm tra này.
- Tin dùng cho dòng mức ±2 trở lên cần nguồn chính thức (hạng T1) hoặc ít nhất hai báo khác nhau; trang tra cứu (T4) không tính.

**Loại mới**

`market_data` (subject để trống): số liệu thị trường để chấm điểm dự báo sau 7, 91, 365 ngày.
`{"points":[{"key":"VNINDEX","date":"YYYY-MM-DD","value":1666.2,"url":"đường dẫn thuộc danh sách nguồn","source":"HOSE","note":"(tùy chọn)"}]}`.
Khoá: VNINDEX, SPX, BRENT, GOLD_SPOT_USD, BTC, DXY, USDVND_CENTRAL, USDVND_VCB_SELL, US10Y, VN_INTERBANK_ON, VN_INTERBANK_1M,
VN_POLICY_RATE, VN_GOV10Y, VN_CPI_YOY, SJC_SELL. SJC_PREM do hệ thống tự tính. Giá trị ngoài khoảng hợp lý hoặc ngày tương lai bị
từ chối cả lô. Số liệu từ trang chính thức không bị số liệu báo chí ghi đè.

`scan_log` (subject để trống): nhật ký quét tin của mỗi lượt chạy, để biết nhóm nào chưa quét và tin nào bị bỏ vì sao.
`{"date":"YYYY-MM-DD","groups":[{"group":"Vĩ mô Mỹ","searched":true,"found":6,"used":2,"note":"(tùy chọn)"}],"dropped":[{"title","url","reason"}],"model","session"}`.

`run_log` (subject để trống): mỗi lượt chạy theo lịch đẩy đúng một bản ghi khi kết thúc, kể cả khi không có gì mới.
`{"schedule":"daily_news|legal_scan|golden_monthly|manual","status":"ok|partial|failed","started_at","finished_at","counts":{"news":12,"events":2},"notes","model","session"}`.
Lượt hằng ngày phải có `run_log` trước 18:30 (giờ Việt Nam), lượt rà soát pháp luật trước 09:30 thứ Hai và thứ Năm; thiếu thì trang
Tổng quan báo.

`golden_view` (hằng tháng, và mỗi lần đổi mô hình hoặc prompt): chạy lại Agent CIO trên bộ sự kiện chuẩn `data/golden/events.json`
(G01–G10) để đo độ trôi. `{"golden_id":"G01","view":{"impacts":[đủ 11 dòng loại tài sản],"scenarios":{…}},"meta":{"model","session","prompt_note"}}`.
`source_ids` trong nhánh kịch bản là mã tin của sự kiện chuẩn (ví dụ `G01-N1`). Lượt đầu tiên của mỗi sự kiện là tham chiếu; CIO có
thể đổi tham chiếu kèm lý do.

**Tạm dừng agent**: khi CIO, Tuân thủ hoặc Quản trị tạm dừng một agent ở trang Chất lượng, bản ghi của agent đó bị từ chối khi nhập
cho tới khi Tuân thủ hoặc Quản trị (người khác người tạm dừng) cho chạy lại.

**Không đổi**: Claude không đọc dữ liệu gia đình (BR-28). Cấu trúc gia đình, đòn bẩy, thang thanh khoản, kế thừa và bản tin RM
đều do hệ thống tính bằng quy tắc xác định trên dữ liệu trong ngân hàng.

## Mở rộng độ phủ tin (21/10/2026)

**`event_update`** (subject = mã sự kiện `EV-…`): bổ sung tin mới cùng chủ đề vào sự kiện đã có, thay vì bỏ tin hoặc lập sự kiện trùng.
`{"news_urls":["…"],"note":"≥ 20 ký tự: diễn biến mới là gì","material":true|false}`. Tin phải được đẩy trước bằng bản ghi `news`
(hoặc đã có trong Hộp tin, chưa thuộc sự kiện nào). Một sự kiện tối đa 25 tin. `material: true` khi diễn biến đủ để thay đổi mức
hoặc nhánh kịch bản: trang nhận định hiện cảnh báo để CIO cân nhắc yêu cầu Làm lại. Agent **không** tự đẩy `cio_view` mới cho sự
kiện đã có nhận định khi CIO chưa yêu cầu Làm lại. Tin mới nhắc tổ chức trong danh sách hạn chế đưa sự kiện về chờ Tuân thủ.

**Hộp tin RSS**: hệ thống tự lấy tin từ khoảng 25 nguồn RSS mỗi 10 phút (cấu hình `NEWS_SOURCES`). Lượt chạy nên đọc tin trong Hộp tin
48 giờ gần nhất (`SELECT id, json_extract(data,'$.title'), json_extract(data,'$.url'), json_extract(data,'$.published_at') FROM news_items
WHERE json_extract(data,'$.event_id') IS NULL AND json_extract(data,'$.ingested_at') >= ?`) và dùng chúng khi lập sự kiện bằng đường dẫn
đã lưu, không cần đẩy lại.

**Lượt buổi sáng** (`run_log` schedule `morning_news`, hạn 09:00 thứ 2–6): diễn biến quốc tế qua đêm và tin Việt Nam đầu ngày.

**Nguồn quốc tế**: khi Tuân thủ đã nạp danh sách nguồn mới, được đưa tin trực tiếp từ Reuters, AP, Bloomberg, CNBC, MarketWatch, FT,
WSJ, BBC, Nikkei Asia và trang chính thức (Fed, ECB, BoJ, BLS, BEA, EIA, IMF, OPEC, CME FedWatch). Chỉ ghi tiêu đề, đường dẫn và tóm
tắt do agent viết (≤ 3 câu), không chép nguyên văn bài báo.

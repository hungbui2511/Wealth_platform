# Wealth Platform 2036 – MVP1 (bản demo)

Bản đồ tài sản gia đình và AI Agent CIO, dựng theo **BRD v0.5** (09–10/10/2026). Công cụ hỗ trợ ra quyết định **nội bộ**: không có kênh nào gửi nội dung tới khách hàng, và **chỉ dùng dữ liệu giả lập** (20 gia đình hư cấu, mã công cụ `DM…`, tổ chức lưu ký "Ngân hàng Demo A/B").

> Demo – dữ liệu giả lập · Nội bộ – không gửi khách hàng

## 1. Nền tảng đã chọn (D17)

| Kiểm tra ở bước 1 (Mục 11.3) | Kết quả trong môi trường xây dựng |
|---|---|
| FastAPI trên Python Workers (`pywrangler dev`) | **Không kiểm chứng được.** Chính sách mạng chặn `index.pyodide.org` (gói Pyodide) và `workers.cloudflare.com`, nên Python Worker không khởi động được. |
| D1 binding đọc, ghi được | Đạt (Python không chạy được; TypeScript đạt trên `wrangler dev`) |
| Trigger D1 chặn UPDATE, DELETE trên `audit_log` | **Đạt** (`SQLITE_CONSTRAINT_TRIGGER`, cả D1 cục bộ lẫn shim kiểm thử) |
| LangGraph cài và chạy được | **Đạt** với LangGraph.js (`@langchain/langgraph`, MIT) trên workerd, gồm cả rẽ nhánh song song |

Vì không xác nhận được Python Workers, demo theo **phương án B của D17: TypeScript (Hono + D1)**, dùng `decimal.js` thay cho `Decimal`, `zod` thay cho Pydantic, `vitest` thay cho pytest. Mọi quy tắc nghiệp vụ giữ nguyên. Riêng phần engine là hàm thuần (`src/engine/`), kiểm thử chạy trong Node mà không cần Workers.

## 2. Chạy trên máy (một lệnh)

Yêu cầu: Node.js 20+.

```bash
npm install
npm run dev            # build giao diện + migration D1 cục bộ + wrangler dev → http://localhost:8787
```

Lần đầu mở trình duyệt, màn hình đăng nhập có nút **Nạp dữ liệu mẫu** (khi cơ sở dữ liệu còn trống). Cách khác: `npm run seed:local` nạp lại toàn bộ dữ liệu mẫu từ đầu bằng một lệnh. Sau đó đăng nhập vai trò **Quản trị** → **Nạp gói sự kiện mẫu**.

Phát triển giao diện có hot reload: chạy `wrangler dev` ở một terminal và `npm run dev:ui` (Vite, proxy `/api` sang cổng 8787) ở terminal khác.

| Lệnh | Việc |
|---|---|
| `npm test` | Kiểm thử: ví dụ tính tay, engine, schema, máy trạng thái, và tiêu chí chấp nhận AC-01..AC-39 ở chế độ mock |
| `npm run typecheck` | Kiểm tra kiểu cho Worker và giao diện |
| `npm run seed:gen` | Sinh lại dữ liệu giả lập, đầu ra agent mock và `data/seed.sql` (xác định, có hạt giống cố định) |
| `npm run seed:local` / `seed:remote` | Nạp lại dữ liệu mẫu từ đầu vào D1 cục bộ hoặc từ xa |
| `npm run smoke -- <url> [EV-…]` | Kiểm tra khói: chạy Agent CIO, kiểm tra schema và mã nguồn. Bản deploy sau Access: đặt `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` của một service token |

## 3. Triển khai lên Cloudflare (Mục 11.7)

```bash
npx wrangler login
npx wrangler d1 create wealth-mvp1          # chép database_id vào wrangler.toml
npm run deploy                              # build + migration D1 từ xa + wrangler deploy
npm run seed:remote                         # nạp dữ liệu mẫu (hoặc bấm "Nạp dữ liệu mẫu" trên giao diện)
```

- **Cloudflare Access và phân quyền (NFR-08, NFR-21):** bản deploy chạy `AUTH_MODE=access`: Worker chỉ tin JWT trong header `Cf-Access-Jwt-Assertion`, tự kiểm chữ ký bằng khóa công khai của team, kiểm `aud`, `iss`, hạn dùng. Header `x-demo-user` chỉ là lựa chọn vai trò, không phải định danh. Thiếu cấu hình thì API trả 503 (đóng, không mở).
  1. Worker → **Settings → Domains & Routes** → `workers.dev` → **Enable Cloudflare Access**, chính sách *Allow* theo danh sách email được mời. Kiểm tra bằng cửa sổ ẩn danh rằng người ngoài danh sách bị chặn.
  2. Trong Zero Trust → Access → Applications, mở ứng dụng vừa tạo, chép **Application Audience (AUD) Tag**; tên team ở Zero Trust → Settings (dạng `<team>.cloudflareaccess.com`).
  3. Worker → **Settings → Variables and Secrets** (giữ lại khi deploy nhờ `keep_vars = true`):

     | Biến | Giá trị |
     |---|---|
     | `ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` (bản này đã đặt sẵn trong `wrangler.toml`) |
     | `ACCESS_AUD` | Tùy chọn, nên đặt: AUD tag ở bước 2. Bỏ trống thì nhận JWT của mọi ứng dụng Access trong team (vẫn kiểm chữ ký, iss, hạn dùng) |
     | `DEMO_OPERATORS` | Tùy chọn. Bỏ trống: mọi email qua được chính sách Access đều chuyển vai trò và nạp dữ liệu lần đầu được. Đặt danh sách email (cách nhau dấu phẩy) để chỉ những người này được; thêm `service:<Client ID>` nếu chạy kiểm tra khói bằng service token |
     | `ROLE_MAP` | Tùy chọn: gán cố định `email=CIO1,email2=RM1`; người này chỉ dùng được đúng vai trò đó |

  Email Access đã xác minh được ghi kèm tác nhân trong nhật ký. `AUTH_MODE=dev` (chọn vai trò không cần Access) chỉ dùng trên máy: `npm run dev` tự bật, hoặc đặt trong `.dev.vars`.
- **Bí mật (NFR-02, NFR-16):** `wrangler secret put ANTHROPIC_API_KEY` (chỉ khi `AGENT_MODE=live`); `TCBS_*`, `ONEMOUNT_*` chỉ khi đã có thỏa thuận dữ liệu. Mẫu biến khi chạy trên máy: `.dev.vars.example`.
- **Tắt hoặc xóa toàn bộ demo bằng một lệnh:** `npm run demo:delete` (xóa Worker và cơ sở dữ liệu D1).
- **Giới hạn D1 (NFR-22):** mọi lệnh ghi của một yêu cầu gom vào một lô (`INSERT … SELECT FROM json_each(?)`, một câu lệnh cho mỗi bảng). Số truy vấn đo được lớn nhất là 30/yêu cầu (chạy Agent CIO), áp dụng cho 20 gia đình là 25, nên vừa giới hạn 50 truy vấn của gói miễn phí.

## 4. Chế độ chạy

| Biến (`wrangler.toml` → `[vars]`) | Mặc định | Ý nghĩa |
|---|---|---|
| `AGENT_MODE` | `mock` | `mock`: mỗi nút của đồ thị trả đầu ra ghi sẵn trong `data/mock_agent/`, nên kết quả xác định. `live`: gọi Claude qua SDK chính thức `@anthropic-ai/sdk`. |
| `PRICE_MODE` | `sample` | `sample`: adapter đọc file mẫu theo cấu trúc của nguồn (`data/seed/prices/`). `live`: adapter chỉ chạy khi có thông tin truy cập **và** mã thỏa thuận dữ liệu trong cấu hình `PRICE_SOURCE`; thiếu thì từ chối, ghi nhật ký và dùng dự phòng. |

Mô hình mặc định (cấu hình `MODEL`, thay theo quy trình hai người): Agent CIO và Agent Chính sách dùng `claude-opus-5-5`; Agent Phản biện dùng `claude-sonnet-5-5` để khác mô hình với Agent CIO (NFR-03). Mọi lời gọi bật suy luận thích ứng và cơ chế dự phòng phía máy chủ (`fallbacks: "default"`).

## 5. Kiến trúc

```text
src/
  shared/      danh mục cố định (Mục 7.1), kiểu thực thể (7.2), schema zod đầu ra agent (7.3), định dạng số tiếng Việt
  engine/      hàm thuần, Decimal, không gọi LLM:
               positions (BR-09 sở hữu hiệu dụng, nhìn xuyên quỹ) · apply (BR-07..BR-12) · postcheck (BR-17)
               numbercheck (BR-13, BR-14) · pnl (BR-19, BR-20) · cashflow (BR-18, BR-23) · goals (BR-24, BR-25)
               policyMatch (BR-30) · states (Mục 6.4) · hash (JSON chuẩn hóa + SHA-256)
  pricing/     adapter TCBS cổ phiếu, TCBS trái phiếu, One Mount, Mẫu, Thủ công; chọn nguồn và dự phòng (BR-21), ảnh chụp giá
  agents/      đồ thị Agent CIO (LangGraph.js), Agent Phản biện (quy tắc + LLM), prompt có phiên bản, lớp gọi mô hình
  compliance/  nguồn công khai, danh sách hạn chế, rào chắn, dấu thời gian (BR-26..BR-29)
  worker/      Hono API, lớp truy vấn D1 mỏng + đơn vị công việc + chuỗi mã băm nhật ký, dịch vụ theo module M1..M10
frontend/      React + Vite + Tailwind, theo design-system/MASTER.md
migrations/    schema D1 và trigger nhật ký
data/seed/     dữ liệu giả lập (sinh bởi scripts/gen-seed.ts); data/mock_agent/ đầu ra ghi sẵn
tests/         vitest; tests/support/d1shim.ts chạy cùng migration trên node:sqlite
```

**Đồ thị Agent CIO (FR-309):** `data` (xác định, gói thị trường qua adapter) → 4 nhóm phân tích song song (Vĩ mô và lãi suất; Cổ phiếu và quỹ; Tín dụng và bất động sản; Hàng hóa và tài sản khác) → `debate` (chỉ cho dòng có |mức| ≥ 2 hoặc hai nhóm ngược hướng, tối đa 2 vòng) → `synthesize` → `validate` (schema Mục 7.3, loại dòng mã hạn chế; sai thì chạy lại tổng hợp tối đa 2 lần, sau đó `AGENT_ERROR`). Mỗi nút lưu đầu vào, đầu ra, prompt và mô hình (`agent_node_runs`). Đồ thị không nhận dữ liệu danh mục của gia đình nào. Agent Phản biện chạy ngoài đồ thị.

**Nhật ký (NFR-13):** bảng `audit_log` chỉ ghi thêm. Trigger D1 từ chối UPDATE và DELETE, mỗi bản ghi chứa mã băm của bản ghi trước. Kiểm tra chuỗi: màn hình Nhật ký → *Kiểm tra chuỗi mã băm*, hoặc `GET /api/audit/verify`.

## 6. Tiêu chí chấp nhận (chấm ở `AGENT_MODE=mock`, `PRICE_MODE=sample`)

| AC | Kiểm thử |
|---|---|
| AC-01, AC-25 | `tests/acceptance.test.ts` › M1 |
| AC-02, AC-28, AC-03, AC-04, AC-14, AC-05, AC-15, AC-07, AC-08, AC-31 | `tests/acceptance.test.ts` › M3/M4/M5 |
| AC-09, AC-10 | `tests/acceptance.test.ts` › M7 |
| AC-11, AC-13, AC-15 (v2), AC-12, AC-16, AC-18, AC-19 | `tests/acceptance.test.ts` › M8 |
| AC-20 | `tests/acceptance.test.ts` › Tỷ giá |
| AC-05a, AC-06, AC-25 (hai lần áp dụng) | `tests/acceptance2.test.ts` › Áp dụng nhập tay |
| AC-21, AC-22, AC-23, AC-24, AC-30, AC-33, FR-120, FR-903 | `tests/acceptance2.test.ts` › Lãi/lỗ, dòng tiền, mục tiêu |
| AC-17, AC-26, AC-27, AC-29 | `tests/acceptance2.test.ts` › Nguồn giá |
| AC-34 đến AC-39 | `tests/acceptance2.test.ts` › M10 |
| AC-06, AC-21, AC-22, AC-23, AC-30, AC-31, AC-32 (ví dụ tính tay trên bộ dữ liệu riêng) | `tests/worked_example.test.ts`, `tests/pnl.test.ts`, `tests/cashflow_goals.test.ts` |
| BR-13 (các cách viết số hợp lệ) | `tests/numbercheck.test.ts` |
| Mục 6.4 (chuyển trạng thái hợp lệ và bị từ chối), BR-22 (gói gửi TCBS) | `tests/states.test.ts` |

Chế độ live **chưa được chạy** trong môi trường xây dựng vì không có khóa API. Cách kiểm tra khói khi có khóa: đặt `AGENT_MODE=live`, `wrangler secret put ANTHROPIC_API_KEY`, rồi chạy `npm run smoke -- <url>`.

## 7. Giả định đã dùng (khi BRD chưa nói rõ)

1. **Lưu trữ:** mỗi bảng D1 có cột khóa và cột chỉ mục, toàn bộ bản ghi lưu ở cột `data` (JSON). Số tiền lưu dạng chuỗi thập phân. Ngày giá là phiên cuối của dữ liệu mẫu: **09/10/2026**.
2. **EV-2026-0002, đầu ra mock v1:** dòng `CORP_BOND` để mức 0 (ví dụ ở Mục 7.3 để −1). Như vậy phát hiện Nghiêm trọng về trái phiếu doanh nghiệp bất động sản có ý nghĩa, và khi CIO thêm dòng ngành (CORP_BOND, REAL_ESTATE) mức −1 trong kịch bản demo thì mục tiêu du học của DEMO-F01 ra đúng 99,59% → 95,87%. Ví dụ Mục 6.2 (−488 triệu) được chấm bằng nhận định JSON nhập tay (AC-05a, AC-06), trên cả bộ dữ liệu riêng lẫn dữ liệu mẫu của DEMO-F01.
3. **DEMO-F01** có đúng các vị thế của Mục 6.2, cộng thêm căn hộ cho thuê 15 tỷ, cổ phần tư nhân 14 tỷ, vàng 2 tỷ và bảo hiểm 2 tỷ, để tài sản ròng đúng 50 tỷ và dòng tiền khớp Mục 6.5.
4. **Dòng tiền:** gốc trái phiếu đáo hạn là tiền vào trong dòng tiền ngắn hạn. Trong đệ quy L dài hạn, gốc này được trừ khỏi L để không đếm hai lần, vì trái phiếu đã nằm trong L. Tiền gửi có kỳ hạn chỉ ghi phần lãi khi đáo hạn, giả định tái tục cùng kỳ hạn. Chi sinh hoạt tăng theo lạm phát, các khoản khác không tăng trừ khi có tỷ lệ riêng.
5. **Mục tiêu:** năm dự phóng *t* chứa tháng thứ *k* tính từ tháng sau ngày giá là ⌈k/12⌉. Tài sản dành riêng tăng tới cuối năm mục tiêu. Đóng góp hàng năm lấy từ L, tích lũy theo r_L cho tới năm trước năm mục tiêu. Mục tiêu chi đều nhiều năm: mỗi năm chi số tiền nhập (theo giá trị năm mục tiêu) hoặc số tiền × (1 + tăng chi phí)^(n+j) (theo giá trị hôm nay).
6. **Lãi/lỗ:** giao dịch `FEE` riêng lẻ là thu nhập âm. `CAPITAL_CALL` cộng vào giá vốn; phí bảo hiểm ghi dạng `CAPITAL_CALL`. Tiền gửi VND không có lãi/lỗ vốn. Tiền gửi ngoại tệ có giao dịch nạp thì tính hiệu ứng tỷ giá.
7. **Quỹ có phần trái phiếu Chính phủ** trong bảng phân bổ dùng kỳ hạn ghi trong phân bổ (mặc định dài hạn).
8. **Kiểm tra số (BR-13):** số không kèm đơn vị chỉ được phép khi trùng mức độ, số đếm hoặc số có trong chính nhận định đã duyệt. Có dấu trừ hoặc chữ "giảm/tăng" thì so có dấu, không có thì so trị tuyệt đối. Bỏ qua cả số trong "Mục 6.2", "Điều 3 khoản 1".
9. **Danh sách hạn chế:** mọi nội dung văn bản trả cho RM (sự kiện, tin, nhận định, diễn giải, truy vết) và bản tin CIO che tên tổ chức và mã hạn chế, không phân biệt hoa thường; RM không xem được nội dung danh sách hạn chế. Vị thế khách đang nắm giữ (tên mã trong bảng vị thế) vẫn hiển thị vì là dữ kiện danh mục, không phải nhận định. Diễn giải LLM có nhắc tới thì bị chặn như BR-13.
10. **Quyền xem:** CIO, Tuân thủ, Quản trị xem được mọi gia đình (chỉ đọc). RM chỉ xem gia đình mình phụ trách, chỉ kết quả đã qua hậu kiểm, và không thấy nội dung phản biện trong truy vết.
11. **Dấu thời gian sự kiện (BR-29)** phản ánh chuỗi đang hiệu lực. Khi một phiên bản mới có hiệu lực, ba mốc *view_ready_at, approved_at, effective_at* được ghi lại theo phiên bản đó, và vẫn kiểm tra thứ tự tăng dần.
12. **Hậu kiểm `concentration`** bỏ qua tiền gửi.
13. **Nạp lại dữ liệu mẫu từ đầu** xóa dữ liệu nghiệp vụ và nạp lại trong một lô nguyên tử, **không** xóa nhật ký: chuỗi mã băm nối tiếp và bản ghi `system.reseed` lưu số bản ghi, mã băm đầu chuỗi trước đó. `npm run seed:remote` (người có quyền wrangler) không chạm vào nhật ký nên không để lại bản ghi; nạp qua giao diện để có vết. Áp dụng nhận định nhập tay (AC-05a, bỏ qua phản biện) chỉ bật khi `MANUAL_APPLY=on` (kiểm thử), chỉ CIO dùng được.
14. **Lượt agent dài (chế độ live):** Agent CIO chạy đồng bộ trong yêu cầu HTTP. Ở chế độ mock mất dưới 1 giây. Với chế độ live (tới 180 giây, NFR-06), nên chuyển sang Cloudflare Workflows hoặc Queues; phần này chưa làm trong demo.
15. **Văn bản do người yêu cầu cung cấp:** đặt JSON vào `data/seed/policies/provided/` rồi chạy `npm run build` (gom vào `index.json`). Văn bản thật cần chạy ở chế độ live, hoặc thêm tóm tắt đã duyệt vào `data/mock_agent/policy/<mã>.json`.
16. **lucide-react** dùng giấy phép ISC (tương đương MIT/BSD-2), được coi là phù hợp NFR-18.

## 8. Mã tái sử dụng và giấy phép

Xem `NOTICE`. Agent CIO chỉ tham khảo **kiến trúc** của TradingAgents (Apache-2.0), không sao chép mã. Hệ thống thiết kế sinh bằng skill UI UX Pro Max (MIT). Mọi thư viện dùng giấy phép MIT, Apache-2.0, BSD hoặc ISC.

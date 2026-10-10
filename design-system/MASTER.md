# Hệ thống thiết kế – Wealth MVP1

Sinh bằng skill **UI UX Pro Max** (MIT) với mô tả: *công cụ nội bộ của ngân hàng tư nhân và quản lý tài sản; người dùng là CIO, RM, Tuân thủ; tối giản, đáng tin cậy, nhiều dữ liệu; tránh giao diện kiểu ứng dụng giao dịch* (dial: variance 2, motion 1, density 8). Bản gốc skill sinh ra: [`GENERATED-ui-ux-pro-max.md`](GENERATED-ui-ux-pro-max.md).

File này là nguồn duy nhất cho mọi màn hình. Những điểm dưới đây **ghi đè** bản gốc theo BRD Mục 11.8.

## Ghi đè so với bản gốc

| Bản gốc | Ghi đè | Lý do |
|---|---|---|
| Màu nhấn xanh lá `#22C55E` cho nút chính | Nút chính dùng chàm `--primary #818CF8` | BRD: màu mang nghĩa phải thống nhất; xanh lá đã dành cho mức **Xanh** và **Đạt** |
| Mẫu trang "Enterprise Gateway" (hero, logo khách hàng) | Bố cục ứng dụng: thanh trên + điều hướng trái + nội dung | Đây là công cụ nội bộ, không phải trang giới thiệu |
| Hiệu ứng cuộn GSAP, thẻ nâng lên khi hover | Không dùng; chỉ đổi màu nền/viền 150 ms | Mật độ dữ liệu cao, không trang trí; tôn trọng `prefers-reduced-motion` |
| Modal nền trắng | Modal theo token tối | Thống nhất chế độ tối |

## Token màu (chế độ tối mặc định)

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--bg` | `#020617` | Nền trang |
| `--card` | `#0E1223` | Thẻ, bảng |
| `--muted` | `#1A1E2F` | Nền phụ, hàng xen kẽ |
| `--border` | `#334155` | Viền |
| `--fg` | `#F8FAFC` | Chữ chính |
| `--fg-muted` | `#94A3B8` | Chữ phụ (tương phản ≥ 4.5:1 trên `--bg`) |
| `--primary` | `#818CF8` | Nút chính, liên kết, focus |

## Màu mang nghĩa (chỉ dùng đúng nghĩa, không trang trí)

| Ý nghĩa (BRD) | Màu | Token |
|---|---|---|
| Cảnh báo **Đỏ** (BR-12), thiếu hụt tiền (BR-18, BR-23), phát hiện **Nghiêm trọng**, mục tiêu **Thiếu** | `#EF4444` | `--sev-red` |
| Cảnh báo **Vàng**, phát hiện **Trung bình**, mục tiêu **Theo dõi**, giá dự phòng/định giá cũ | `#F59E0B` | `--sev-amber` |
| Mức **Xanh** (không cảnh báo), mục tiêu **Đạt** | `#22C55E` | `--sev-green` |
| Nhãn **Tích cực** (tác động dương) | `#38BDF8` | `--sev-positive` |
| Phát hiện **Thấp**, thông tin | `#94A3B8` | `--sev-low` |

Mỗi màu mang nghĩa luôn đi kèm chữ (ví dụ "Vàng", "Theo dõi"), không chỉ dựa vào màu.

## Chữ

- **IBM Plex Sans** (Google Fonts, có bộ ký tự tiếng Việt) cho toàn bộ giao diện; **IBM Plex Mono** cho mã định danh.
- Số tiền: `font-variant-numeric: tabular-nums`, căn phải trong bảng; định dạng Việt Nam (dấu chấm nghìn, dấu phẩy thập phân, dấu trừ "−").
- Cỡ chữ: 13 px cho bảng dày, 14 px nội dung, 18–20 px tiêu đề trang.

## Thành phần cố định của bố cục (không ẩn được)

- Dải nhãn trên cùng: **"Demo – dữ liệu giả lập"** và **"Nội bộ – không gửi khách hàng"** (NFR-11).
- Màn hình có tỷ lệ đáp ứng mục tiêu: nhãn **"Nội bộ – giả định minh họa, không phải cam kết lợi nhuận"** (FR-908).
- Màn hình tác động: **"Cú sốc giá tức thời giả định theo cấu hình minh họa. Không theo thời gian, không phải dự báo"** (FR-608).
- Diễn giải cho RM: nhãn nội bộ và watermark tên người xem kèm thời điểm (FR-703).

## Quy tắc UX

- Biểu tượng SVG từ Lucide (ISC); không dùng emoji làm biểu tượng.
- Mọi phần tử bấm được có `cursor: pointer` và trạng thái focus nhìn thấy được (vòng `--primary`).
- Mỗi giá trị giá có nguồn và ngày (tooltip hoặc cột riêng, FR-210).
- Nút bị khóa phải nói rõ vì sao (ví dụ điều kiện BR-02 còn thiếu).
- Bảng dày: hàng 32 px, tiêu đề dính khi cuộn; không cuộn ngang trên 1024 px trở lên; dưới đó cho phép cuộn ngang trong vùng bảng.
- Biểu đồ (recharts): lưới mờ, trục số định dạng gọn ("tỷ", "triệu"), chú giải bằng chữ.

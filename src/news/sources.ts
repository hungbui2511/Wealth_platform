// Nguồn tin công khai mặc định (RSS của báo chính thống). Danh sách có phiên bản trong cấu hình NEWS_SOURCES;
// mọi miền phải thuộc danh sách nguồn công khai (WHITELIST) do Tuân thủ quản lý (BR-26, BR-28).
export const DEFAULT_NEWS_SOURCES = [
  { name: 'VnExpress – Kinh doanh', url: 'https://vnexpress.net/rss/kinh-doanh.rss' },
  { name: 'VnEconomy – Chứng khoán', url: 'https://vneconomy.vn/chung-khoan.rss' },
  { name: 'Báo Đầu tư – Đầu tư tài chính', url: 'https://baodautu.vn/dau-tu-tai-chinh.rss' },
  { name: 'Báo Đầu tư – Ngân hàng, Bảo hiểm', url: 'https://baodautu.vn/ngan-hang--bao-hiem.rss' },
  { name: 'Báo Đầu tư – Thị trường địa ốc', url: 'https://baodautu.vn/thi-truong-dia-oc.rss' },
  { name: 'Vietstock – Cổ phiếu', url: 'https://vietstock.vn/830/chung-khoan/co-phieu.rss' },
  { name: 'Nhân Dân – Chứng khoán', url: 'https://nhandan.vn/rss/chungkhoan-1191.rss' },
  { name: 'VTV – Kinh tế', url: 'https://vtv.vn/rss/kinh-te.rss' },
]

// Miền công khai thật được thêm vào danh sách nguồn công khai mặc định (bên cạnh các miền giả lập của gói tin mẫu)
export const PUBLIC_DOMAINS = [
  { domain: 'vnexpress.net', name: 'VnExpress' }, { domain: 'vneconomy.vn', name: 'VnEconomy' }, { domain: 'baodautu.vn', name: 'Báo Đầu tư' },
  { domain: 'vietstock.vn', name: 'Vietstock' }, { domain: 'nhandan.vn', name: 'Báo Nhân Dân' }, { domain: 'vtv.vn', name: 'VTV' },
  { domain: 'chinhphu.vn', name: 'Cổng TTĐT Chính phủ' }, { domain: 'baochinhphu.vn', name: 'Báo Điện tử Chính phủ' },
  { domain: 'sbv.gov.vn', name: 'Ngân hàng Nhà nước Việt Nam' }, { domain: 'mof.gov.vn', name: 'Bộ Tài chính' },
  { domain: 'ssc.gov.vn', name: 'Ủy ban Chứng khoán Nhà nước' }, { domain: 'vbpl.vn', name: 'CSDL quốc gia về văn bản pháp luật' },
  { domain: 'quochoi.vn', name: 'Quốc hội (cổng dự thảo)' }, { domain: 'hnx.vn', name: 'Sở GDCK Hà Nội' }, { domain: 'hsx.vn', name: 'Sở GDCK TP.HCM' },
]

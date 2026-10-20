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
  // Tin quốc tế (nguồn công khai): bản tin kinh tế thế giới tiếng Việt và thông cáo gốc của Fed
  { name: 'VnEconomy – Kinh tế thế giới', url: 'https://vneconomy.vn/kinh-te-the-gioi.rss', origin: 'global' },
  { name: 'Federal Reserve – Press releases', url: 'https://www.federalreserve.gov/feeds/press_all.xml', origin: 'global' },
] as { name: string; url: string; origin?: 'global' | 'local' }[]

// Miền công khai thật được thêm vào danh sách nguồn công khai mặc định (bên cạnh các miền giả lập của gói tin mẫu)
export const PUBLIC_DOMAINS = [
  { domain: 'vnexpress.net', name: 'VnExpress' }, { domain: 'vneconomy.vn', name: 'VnEconomy' }, { domain: 'baodautu.vn', name: 'Báo Đầu tư' },
  { domain: 'vietstock.vn', name: 'Vietstock' }, { domain: 'nhandan.vn', name: 'Báo Nhân Dân' }, { domain: 'vtv.vn', name: 'VTV' },
  { domain: 'chinhphu.vn', name: 'Cổng TTĐT Chính phủ' }, { domain: 'baochinhphu.vn', name: 'Báo Điện tử Chính phủ' },
  { domain: 'sbv.gov.vn', name: 'Ngân hàng Nhà nước Việt Nam' }, { domain: 'mof.gov.vn', name: 'Bộ Tài chính' },
  { domain: 'ssc.gov.vn', name: 'Ủy ban Chứng khoán Nhà nước' }, { domain: 'vbpl.vn', name: 'CSDL quốc gia về văn bản pháp luật' },
  { domain: 'quochoi.vn', name: 'Quốc hội (cổng dự thảo)' }, { domain: 'federalreserve.gov', name: 'Federal Reserve (Mỹ)' }, { domain: 'hnx.vn', name: 'Sở GDCK Hà Nội' }, { domain: 'hsx.vn', name: 'Sở GDCK TP.HCM' },
  // Văn bản pháp luật và dự thảo (cho Agent Rà soát pháp luật)
  { domain: 'moj.gov.vn', name: 'Bộ Tư pháp' }, { domain: 'moit.gov.vn', name: 'Bộ Công Thương' }, { domain: 'moc.gov.vn', name: 'Bộ Xây dựng' },
  { domain: 'mae.gov.vn', name: 'Bộ Nông nghiệp và Môi trường' }, { domain: 'mps.gov.vn', name: 'Bộ Công an' },
  { domain: 'thuvienphapluat.vn', name: 'Thư viện Pháp luật (tra cứu văn bản)' }, { domain: 'luatvietnam.vn', name: 'LuatVietnam (tra cứu văn bản)' },
  // Tin và số liệu quốc tế: hãng tin, báo tài chính lớn và nguồn số liệu chính thức
  { domain: 'reuters.com', name: 'Reuters' }, { domain: 'apnews.com', name: 'Associated Press' }, { domain: 'bloomberg.com', name: 'Bloomberg' },
  { domain: 'cnbc.com', name: 'CNBC' }, { domain: 'ft.com', name: 'Financial Times' }, { domain: 'wsj.com', name: 'The Wall Street Journal' },
  { domain: 'bbc.com', name: 'BBC' }, { domain: 'euronews.com', name: 'Euronews' }, { domain: 'aljazeera.com', name: 'Al Jazeera' },
  { domain: 'scmp.com', name: 'South China Morning Post' }, { domain: 'asia.nikkei.com', name: 'Nikkei Asia' }, { domain: 'finance.yahoo.com', name: 'Yahoo Finance (đăng lại Reuters, AP)' },
  { domain: 'bls.gov', name: 'Cục Thống kê Lao động Mỹ (CPI, PPI, việc làm)' }, { domain: 'bea.gov', name: 'Cục Phân tích Kinh tế Mỹ (GDP, PCE)' },
  { domain: 'census.gov', name: 'Cục Điều tra Dân số Mỹ (bán lẻ)' }, { domain: 'treasury.gov', name: 'Bộ Tài chính Mỹ' }, { domain: 'eia.gov', name: 'Cơ quan Thông tin Năng lượng Mỹ' },
  { domain: 'ecb.europa.eu', name: 'Ngân hàng Trung ương châu Âu' }, { domain: 'ec.europa.eu', name: 'Ủy ban châu Âu, Eurostat' }, { domain: 'bankofengland.co.uk', name: 'Ngân hàng Trung ương Anh' },
  { domain: 'boj.or.jp', name: 'Ngân hàng Trung ương Nhật Bản' }, { domain: 'imf.org', name: 'IMF' }, { domain: 'worldbank.org', name: 'Ngân hàng Thế giới' },
  { domain: 'oecd.org', name: 'OECD' }, { domain: 'bis.org', name: 'Ngân hàng Thanh toán Quốc tế' }, { domain: 'opec.org', name: 'OPEC' },
  // Số liệu chính thức làm nguồn thứ hai cho sổ dự báo (đợt 2–3 sau phản biện độc lập): thống kê, giá vàng, tỷ giá niêm yết
  { domain: 'gso.gov.vn', name: 'Tổng cục Thống kê' }, { domain: 'nso.gov.vn', name: 'Cục Thống kê' }, { domain: 'sjc.com.vn', name: 'Công ty Vàng bạc Đá quý Sài Gòn (SJC)' }, { domain: 'vietcombank.com.vn', name: 'Vietcombank (tỷ giá niêm yết)' },
]

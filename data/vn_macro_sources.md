# Vietnam macro monthly series: definitions and sources

File: `vn_macro_monthly.csv`, 57 months (2022-01 to 2026-09). Collected 2026-10-13 via WebFetch. Nothing is interpolated: a blank cell means no value was found. Every value was extracted from page text by a summarising fetch tool, so spot-check before production use. USD/VND was spot-checked on 3 daily pages and matched the yearly tables.

## 1. usdvnd: USD/VND market mid rate, last listed day of month
- Definition: exchange-rates.org daily USD/VND rate (market mid rate, not the SBV central rate or the Vietcombank rate) on the last date listed in each month. That is usually the last weekday. Exceptions: 2024-11 = 29 Nov, 2025-11 = 28 Nov. Values from day pages keep 2 decimals.
- Yearly tables: https://www.exchange-rates.org/exchange-rate-history/usd-vnd-2022 , -2023, -2024, -2025, -2026
- Day pages (used where the yearly table was cut off, or to spot-check):
  - https://www.exchange-rates.org/exchange-rate-history/usd-vnd-2024-11-29 (25,346.50)
  - https://www.exchange-rates.org/exchange-rate-history/usd-vnd-2024-12-31 (25,484.60)
  - https://www.exchange-rates.org/exchange-rate-history/usd-vnd-2025-11-28 (26,360.88)
  - https://www.exchange-rates.org/exchange-rate-history/usd-vnd-2025-12-31 (26,299.24)
  - Spot-checks that matched: 2022-10-31, 2026-01-30, 2026-09-30
- Filled: 57/57.

## 2. vn10y: Vietnam 10-year government bond yield (%), month-end
- Filled: 4/57. Most months are blank. No public page reachable from here offered a monthly history: worldgovernmentbonds loads its data with JavaScript, investing.com only shows the last month of daily data, and countryeconomy, MarketWatch, Wayback, econdb and CEIC were blocked or empty after 2018.
- The 4 values come from 2 different sources, so treat them with caution in a correlation estimate:
  - 2022-06 = 3.24 (as of 30 Jun 2022). VBMA monthly highlight: https://vbma.org.vn/en/activities/tinh-hinh-thi-truong-trai-phieu-thang-6-2022
  - 2022-07 = 3.50 (as of 29 Jul 2022). VBMA: https://vbma.org.vn/en/activities/tinh-hinh-thi-truong-trai-phieu-thang-7-2022
  - 2026-08 = 4.565 (31 Aug 2026 close) and 2026-09 = 4.581 (30 Sep 2026 close). Investing.com daily table: https://www.investing.com/rates-bonds/vietnam-10-year-bond-yield-historical-data
- Suggested next step: download the investing.com monthly history manually (it needs a login and the Monthly time frame), or pull HNX/VBMA yield-curve data.

## 3. refi_rate: SBV refinancing rate (%), level in force at month-end
| Effective date | Level | Source |
|---|---|---|
| before 2022 (set 1 Oct 2020) | 4.0 | Implied by the +1pp move to 5.0 in Sep 2022 (vietnamnews below) |
| 2022-09-23 | 5.0 | https://vietnamnews.vn/economy/1337529/state-bank-revises-up-interest-rates-by-1-per-cent-from-september-23.html (QĐ 1606/QĐ-NHNN) |
| 2022-10-25 | 6.0 | https://en.vietstock.vn/2022/10/the-state-bank-of-vietnam-adjusts-operating-interest-rates-37-492625.htm (QĐ 1809/QĐ-NHNN) |
| 2023-04-03 | 5.5 | https://en.vneconomy.vn/sbv-decides-to-cut-refinancing-rate-from-april-3.htm |
| 2023-05-25 | 5.0 | https://div.gov.vn/nhnn-tiep-tuc-ha-lai-suat-dieu-hanh-lan-thu-3-lien-tiep (QĐ 950/QĐ-NHNN) |
| 2023-06-19 | 4.5 | https://div.gov.vn/ngan-hang-nha-nuoc-giam-lai-suat-dieu-hanh-lan-thu-4-trong-nam-2023 (QĐ 1123/QĐ-NHNN) |
- Evidence that the rate stayed at 4.5 after June 2023:
  - TradingView shows 4.5% as of Sep 2025: https://in.tradingview.com/symbols/ECONOMICS-VNINTR
  - DBS (Jul 2026) says it was "unchanged at 4.50% in 1H26": https://www.fxstreet.com/news/vietnam-supportive-stance-as-inflation-risks-recede-dbs-202607071949
  - No change was found for Jul to Sep 2026. The cafef refinancing tag page (https://cafef.vn/tai-cap-von.html) lists no rate change through Aug 2026. MUFG (Dec 2025) had forecast a 25bp hike in 2H26, so 2026-07 to 2026-09 = 4.5 rests on finding no announcement rather than on a positive confirmation.
- Expanded to monthly as the level in force at month-end. Filled: 57/57.

## 4. sjc_sell_mil: SJC gold bar sell price, VND million per tael (lượng)
- Definition: SJC Vietnam (HCMC) "bán ra" price at the last intraday update, on the last weekday of the month that has data on webgia.com. Page pattern: `https://webgia.com/gia-vang/sjc/DD-MM-YYYY.html`
- Dates that are not the last weekday (because of holidays or missing data): 2022-01 = 28 Jan (Tet), 2022-06 = 24 Jun, 2024-04 = 26 Apr, 2024-08 = 29 Aug, 2024-09 = 27 Sep, 2025-01 = 24 Jan (Tet), 2025-04 = 29 Apr, 2025-10 = 30 Oct, 2026-04 = 29 Apr, 2026-08 = 28 Aug.
- Some "last updates" were in the morning, because webgia logs only the updates it captured (for example 2024-06-28 at 08:25, 2024-10-31 at 08:35).
- Filled: 57/57.

## 5. interbank_on: interbank overnight rate
- Not collected (optional). Left blank: 0/57.

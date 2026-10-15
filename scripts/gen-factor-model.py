"""Sinh mô hình yếu tố rủi ro mặc định (CIO duyệt lại trước khi dùng thật).
Nguồn: data/equity_estimates.json (giá tuần TCBS, 01/2022–10/2026) cho cổ phiếu VN; các phần còn lại là giả định có ghi chú.
Chạy: python3 scripts/gen-factor-model.py  → src/data/factorModel.ts"""
import json, numpy as np, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
est = json.load(open(root / 'data/equity_estimates.json'))

# id, nhãn, đơn vị, nhóm nguồn, vol tuần (bình thường, căng thẳng), thư viện cú sốc S/M/L, hồ sơ thời gian [1 tuần, 3 tháng, 12 tháng]
F = [
 ('US10Y',  'Lợi suất trái phiếu Mỹ 10 năm', 'bp', 'global', 9, 15, [15, 30, 60], [0.8, 1, 1]),
 ('DXY',    'Chỉ số đồng USD (DXY)',          '%', 'global', 0.9, 1.4, [1, 2, 4], [0.8, 1, 1]),
 ('GLOBAL_EQ','Cổ phiếu toàn cầu (USD)',      '%', 'global', 2.0, 3.2, [3, 7, 15], [0.8, 1, 1]),
 ('OIL',    'Giá dầu Brent',                  '%', 'global', 4.0, 6.0, [5, 12, 25], [0.8, 1, 1]),
 ('GOLD_W', 'Giá vàng thế giới (USD)',        '%', 'global', 1.8, 2.6, [2, 5, 10], [0.8, 1, 1]),
 ('CRYPTO', 'Bitcoin (USD)',                  '%', 'global', 8.0, 12.0, [8, 20, 40], [0.9, 1, 1]),
 ('USDVND', 'Tỷ giá USD/VND',                 '%', 'local', 0.3, 0.6, [0.5, 1.5, 3], [0.4, 0.9, 1]),
 ('VN_RATE','Lãi suất VND (điều hành, liên ngân hàng)', 'bp', 'local', 15, 40, [25, 50, 100], [0.3, 0.8, 1]),
 ('VN_GOV', 'Lợi suất trái phiếu Chính phủ VN', 'bp', 'local', 10, 20, [15, 30, 60], [0.3, 0.8, 1]),
 ('CREDIT_RE','Chênh lệch tín dụng DN bất động sản', 'bp', 'local', 40, 100, [50, 150, 300], [0.2, 0.7, 1]),
 ('CREDIT_FIN','Chênh lệch tín dụng DN tài chính, ngân hàng', 'bp', 'local', 15, 40, [20, 50, 100], [0.2, 0.7, 1]),
 ('VN_EQ',  'Thị trường cổ phiếu VN (VN-Index)', '%', 'local', est['index']['vol_weekly_full']*100, est['index']['vol_weekly_stress']*100, [3, 7, 15], [0.7, 1, 1]),
 ('FOREIGN_FLOW','Dòng vốn ngoại trên HOSE', 'σ', 'local', 1.0, 1.5, [1, 2, 3], [0.7, 1, 1]),
 ('SJC_PREM','Chênh lệch giá vàng SJC so với thế giới', 'điểm %', 'local', 1.0, 2.0, [2, 4, 8], [0.6, 1, 1]),
 ('VN_RE',  'Giá bất động sản nhà ở VN',      '%', 'local', 1.0, 2.0, [1, 3, 6], [0.0, 0.3, 1]),
]

# ---------- Ước lượng từ dữ liệu tháng thật (01/2022–09/2026) ----------
import csv
G = root / 'data/global'
def monthly_last(rows):  # rows: (date 'YYYY-MM..', value) -> {YYYY-MM: last value}
    out = {}
    for d, v in sorted(rows):
        if v not in (None, ''): out[d[:7]] = float(v)
    return out
def read_csv(path, dcol, vcol, filt=None):
    with open(path) as f:
        r = csv.DictReader(f)
        return monthly_last([(row[dcol], row[vcol]) for row in r if (filt is None or filt(row))])
us10y = read_csv(G/'us10y.csv', 'Date', 'Rate') if 'Rate' in open(G/'us10y.csv').readline() else read_csv(G/'us10y.csv', open(G/'us10y.csv').readline().split(',')[0].strip(), open(G/'us10y.csv').readline().split(',')[1].strip())
gold = read_csv(G/'gold.csv', 'Date', 'Price')
brent = read_csv(G/'brent.csv', open(G/'brent.csv').readline().split(',')[0].strip(), open(G/'brent.csv').readline().split(',')[1].strip())
spx = read_csv(G/'spx.csv', 'Date', 'SP500')
W = {'Euro': .576, 'Japan': .136, 'United Kingdom': .119, 'Canada': .091, 'Sweden': .042, 'Switzerland': .036}
fx = {}
with open(G/'fx.csv') as f:
    for row in csv.DictReader(f):
        if row['Country'] in W and row['Exchange rate']:
            fx.setdefault(row['Date'][:7], {})[row['Country']] = float(row['Exchange rate'])
dxy = {m: float(np.exp(sum(w * np.log(v[c]) for c, w in W.items()))) for m, v in fx.items() if len(v) == len(W)}
vn = {}
with open(root/'data/vn_macro_monthly.csv') as f:
    for row in csv.DictReader(f): vn[row['month']] = row
usdvnd = {m: float(r['usdvnd']) for m, r in vn.items() if r['usdvnd']}
refi = {m: float(r['refi_rate']) for m, r in vn.items() if r['refi_rate']}
sjc = {m: float(r['sjc_sell_mil']) for m, r in vn.items() if r['sjc_sell_mil']}
vni = monthly_last([(d, v) for d, v in json.load(open(G/'vnindex_weekly_tcbs.json'))])
months = [f'{y}-{m:02d}' for y in range(2022, 2027) for m in range(1, 13) if f'{y}-{m:02d}' <= '2026-09']
TAEL_OZ = 37.5 / 31.1035
prem = {m: (sjc[m] * 1e6 / (gold[m] * usdvnd[m] * TAEL_OZ) - 1) * 100 for m in months if m in sjc and m in gold and m in usdvnd}
pct = lambda s, a, b: (s[b] / s[a] - 1) * 100
series = {
 'US10Y': lambda a, b: (us10y[b] - us10y[a]) * 100, 'DXY': lambda a, b: pct(dxy, a, b), 'GLOBAL_EQ': lambda a, b: pct(spx, a, b),
 'OIL': lambda a, b: pct(brent, a, b), 'GOLD_W': lambda a, b: pct(gold, a, b), 'USDVND': lambda a, b: pct(usdvnd, a, b),
 'VN_RATE': lambda a, b: (refi[b] - refi[a]) * 100, 'VN_EQ': lambda a, b: pct(vni, a, b), 'SJC_PREM': lambda a, b: prem[b] - prem[a],
}
R = {k: {} for k in series}
for a, b in zip(months, months[1:]):
    for k, fn in series.items():
        try: R[k][b] = fn(a, b)
        except KeyError: pass
common = [m for m in months[1:] if all(m in R[k] for k in R)]
X = np.array([[R[k][m] for k in R] for m in common]); keys = list(R)
est_corr = np.corrcoef(X.T); est_vol = X.std(axis=0, ddof=1)
sw = [i for i, m in enumerate(common) if '2022-03' <= m <= '2022-12']
est_vol_stress = X[sw].std(axis=0, ddof=1)
print('tháng dùng để ước lượng:', len(common), common[0], '→', common[-1])
for i, k in enumerate(keys): print(f'  {k:10s} vol tháng {est_vol[i]:8.2f}  2022 {est_vol_stress[i]:8.2f}')
EST = {'n': len(common), 'start': common[0], 'end': common[-1], 'keys': keys, 'corr': est_corr, 'vol': est_vol, 'vol_stress': est_vol_stress}

# Đổi sang biến động THÁNG: lấy ước lượng thật nếu có; yếu tố chưa có dữ liệu dùng giả định theo tháng
MONTHLY_ASSUMED = {'CRYPTO': (15, 25), 'VN_GOV': (15, 30), 'CREDIT_RE': (40, 100), 'CREDIT_FIN': (15, 40), 'FOREIGN_FLOW': (1.0, 1.5), 'VN_RE': (1.0, 2.0)}
F2 = []
for f in F:
    fid = f[0]
    if fid in EST['keys']:
        k = EST['keys'].index(fid); c = float(EST['vol'][k]); st = max(float(EST['vol_stress'][k]), 1.2 * c)
        F2.append((*f[:4], round(c, 3), round(st, 3), *f[6:]))
    else:
        c, st = MONTHLY_ASSUMED[fid]; F2.append((*f[:4], c, st, *f[6:]))
F = F2
ids = [f[0] for f in F]; n = len(F); ix = {k: i for i, k in enumerate(ids)}
C = np.eye(n)
pairs = {  # tương quan chế độ bình thường (giả định có lý do; CIO hiệu chỉnh)
 ('US10Y','DXY'): .40, ('US10Y','GLOBAL_EQ'): -.20, ('DXY','GLOBAL_EQ'): -.30, ('DXY','GOLD_W'): -.40, ('US10Y','GOLD_W'): -.30,
 ('DXY','USDVND'): .40, ('US10Y','USDVND'): .25, ('USDVND','VN_RATE'): .30, ('VN_RATE','VN_GOV'): .50, ('VN_GOV','CREDIT_RE'): .30,
 ('VN_GOV','CREDIT_FIN'): .30, ('CREDIT_RE','CREDIT_FIN'): .50, ('VN_EQ','FOREIGN_FLOW'): .50, ('VN_EQ','USDVND'): -.30,
 ('VN_EQ','VN_RATE'): -.25, ('VN_EQ','GLOBAL_EQ'): .35, ('VN_EQ','CREDIT_RE'): -.30, ('VN_EQ','CREDIT_FIN'): -.20,
 ('CRYPTO','GLOBAL_EQ'): .40, ('OIL','GLOBAL_EQ'): .20, ('SJC_PREM','USDVND'): .20, ('VN_RE','VN_RATE'): -.20,
 ('VN_RE','CREDIT_RE'): -.30, ('VN_RE','VN_EQ'): .20, ('FOREIGN_FLOW','USDVND'): -.40, ('FOREIGN_FLOW','DXY'): -.30,
 ('FOREIGN_FLOW','GLOBAL_EQ'): .25, ('FOREIGN_FLOW','US10Y'): -.30, ('FOREIGN_FLOW','VN_RATE'): -.10, ('US10Y','VN_GOV'): .20, ('VN_EQ','US10Y'): -.15, ('OIL','US10Y'): .15, ('GLOBAL_EQ','CREDIT_RE'): -.10, ('GLOBAL_EQ','CREDIT_FIN'): -.10,
}
# Cặp có dữ liệu thật: tương quan ước lượng, co 20% về giả định ban đầu (55 tháng là mẫu nhỏ)
SHRINK = 0.2
for i, a in enumerate(EST['keys']):
    for j, b in enumerate(EST['keys']):
        if i < j:
            prior = pairs.get((a, b), pairs.get((b, a), 0.0))
            pairs.pop((b, a), None)
            pairs[(a, b)] = round(float((1 - SHRINK) * EST['corr'][i, j] + SHRINK * prior), 3)
# Dòng vốn ngoại: TCBS chỉ trả 1 năm dữ liệu ngày (10/2025–10/2026) → ước lượng tương quan với VN-Index theo tuần
import datetime as _dt
ff = {}
with open(G/'foreign_flow_hose_daily_tcbs.csv') as f:
    for row in csv.DictReader(f):
        d = _dt.date.fromisoformat(row['date']); wk = d - _dt.timedelta(days=d.weekday())
        ff[wk] = ff.get(wk, 0) + float(row['value_vnd'])
vw = {}
for d, v in json.load(open(G/'vnindex_weekly_tcbs.json')): vw[_dt.date.fromisoformat(d)] = v
wks = sorted(w for w in vw if w in ff)
pairs_ff = [(ff[w], (vw[w] / vw[p] - 1)) for p, w in zip(wks, wks[1:]) if (w - p).days == 7]
if len(pairs_ff) >= 30:
    a = np.array(pairs_ff); c_ff = float(np.corrcoef(a.T)[0, 1])
    pairs[('VN_EQ', 'FOREIGN_FLOW')] = round(0.8 * c_ff + 0.2 * pairs.get(('VN_EQ', 'FOREIGN_FLOW'), 0.5), 3)
    EST['ff'] = {'weeks': len(pairs_ff), 'corr_vn_eq': round(c_ff, 3)}
    print('dòng vốn ngoại – VN-Index (tuần):', len(pairs_ff), 'tuần, tương quan', round(c_ff, 3))
print('tương quan ước lượng (đã co):', {f'{a}-{b}': v for (a, b), v in pairs.items() if a in EST['keys'] and b in EST['keys'] and abs(v) >= 0.15})
def build(scale, override):
    M = np.eye(n)
    for (a, b), v in pairs.items():
        x = max(-.85, min(.85, v * scale)); x = override.get((a, b), x)
        M[ix[a], ix[b]] = M[ix[b], ix[a]] = x
    return M
calm = build(1.0, {})
stress = build(1.4, {('VN_EQ','FOREIGN_FLOW'): .65, ('VN_EQ','USDVND'): -.45, ('VN_EQ','GLOBAL_EQ'): .55, ('VN_EQ','CREDIT_RE'): -.5})
def near_pd(M, floor=0.03):
    w, V = np.linalg.eigh(M); w = np.maximum(w, floor); X = V @ np.diag(w) @ V.T
    d = np.sqrt(np.diag(X)); return X / np.outer(d, d)
stress = near_pd(stress)  # ép xác định dương: giữ cấu trúc, co nhẹ các tương quan quá lớn
for name, M in (('calm', calm), ('stress', stress)):
    w = np.linalg.eigvalsh(M); assert w.min() > 0.02, (name, w.min())
    print(name, 'min eigen', round(w.min(), 3))

# ---------- Kiểm tra với giai đoạn 2022: cho biết các yếu tố lõi, mô hình suy ra phần còn lại ra sao ----------
def implied(M, vols, core):
    Sg = M * np.outer(vols, vols)
    ci = [ix[k] for k in core]; ni = [i for i in range(n) if i not in ci]
    W = np.linalg.solve(Sg[np.ix_(ci, ci)], Sg[np.ix_(ci, ni)])
    dc = np.array([core[k] for k in core])
    out = dict(core); out.update({ids[j]: float(dc @ W[:, r]) for r, j in enumerate(ni)})
    return out
vol_st = np.array([f[5] for f in F])
chk = implied(stress, vol_st, {'US10Y': 230, 'DXY': 8, 'VN_RATE': 200})
CHECK_2022 = {'conditioned_on': {'US10Y': 230, 'DXY': 8, 'VN_RATE': 200}, 'regime': 'stress',
              'predicted': {k: round(chk[k], 2) for k in ['VN_EQ', 'USDVND', 'GOLD_W', 'GLOBAL_EQ', 'FOREIGN_FLOW']},
              'actual': {'VN_EQ': -37.05, 'USDVND': 8.8}}
CHECK_2022['note'] = f"Chỉ biết lợi suất Mỹ, DXY và lãi suất NHNN, mô hình suy ra VN-Index {CHECK_2022['predicted']['VN_EQ']:.0f}% so với thực tế −37%, tức khoảng {CHECK_2022['predicted']['VN_EQ'] / -37.05 * 100:.0f}% mức giảm; USD/VND {CHECK_2022['predicted']['USDVND']:.1f}% so với thực tế +8,8% (3–10/2022). Kết luận: tương quan bắt đúng hướng và tỷ giá, nhưng thiếu phần khuếch đại trong nước (margin, trái phiếu DN, tâm lý). Khi kịch bản căng thẳng, agent phải đưa VN_EQ và CREDIT_RE vào yếu tố lõi thay vì để máy suy ra."
print('kiểm tra 2022:', CHECK_2022)
S = est['stocks']
avg = lambda ks, k: round(float(np.mean([S[t][k] for t in ks])), 4)
sector_beta = {
 'BANK': (avg(['MBB','VPB','SHB'], 'beta_ewma'), avg(['MBB','VPB','SHB'], 'beta_stress')),
 'REAL_ESTATE': (avg(['NLG','DXG','KDH'], 'beta_ewma'), avg(['NLG','DXG','KDH'], 'beta_stress')),
 'SECURITIES': (S['SSI']['beta_ewma'], S['SSI']['beta_stress']), 'STEEL_MATERIALS': (S['HPG']['beta_ewma'], S['HPG']['beta_stress']),
 'RETAIL': (S['MWG']['beta_ewma'], S['MWG']['beta_stress']), 'TECH': (S['FPT']['beta_ewma'], S['FPT']['beta_stress']),
 'ENERGY': (S['PLX']['beta_ewma'], S['PLX']['beta_stress']), 'CONSUMER': (S['VNM']['beta_ewma'], S['VNM']['beta_stress']),
 'INDUSTRIAL': (S['GMD']['beta_ewma'], S['GMD']['beta_stress']), 'UTILITIES': (S['NT2']['beta_ewma'], S['NT2']['beta_stress']),
 'OTHER': (1.0, 1.0),
}
model = {
 'version': 'FM-2026-10', 'horizons': ['1 tuần', '3 tháng', '12 tháng'], 'size_labels': {'S': 'nhỏ', 'M': 'vừa', 'L': 'lớn'},
 'factors': [{'id': f[0], 'label': f[1], 'unit': f[2], 'origin': f[3], 'vol': {'calm': round(f[4], 4), 'stress': round(f[5], 4)}, 'library': {'S': f[6][0], 'M': f[6][1], 'L': f[6][2]}, 'profile': f[7]} for f in F],
 'corr': {'calm': np.round(calm, 3).tolist(), 'stress': np.round(stress, 3).tolist()},
 'equity': {t: {'beta_calm': S[t]['beta_ewma'], 'beta_stress': S[t]['beta_stress'], 'r2': S[t]['r2_full']} for t in S},
 'sector_beta': {k: {'beta_calm': v[0], 'beta_stress': v[1]} for k, v in sector_beta.items()},
 'usd_revenue': {'FPT': 0.5},
 'intl_beta': {'AAPL': 1.2, 'VT': 1.0},
 'credit_factor': {'VHM12613': 'CREDIT_RE', 'VIC12510': 'CREDIT_RE', 'VIB12508': 'CREDIT_FIN', 'BANK': 'CREDIT_FIN', 'REAL_ESTATE': 'CREDIT_RE', 'ENERGY': 'CREDIT_FIN', 'DEFAULT': 'CREDIT_FIN'},
 'proxy': {'PRIVATE_EQ': {'factor': 'VN_EQ', 'loading': 0.5, 'note': 'Cổ phần chưa niêm yết: ánh xạ qua VN-Index hệ số 0,5, ghi nhận chậm'}, 'REAL_ESTATE': {'factor': 'VN_RE', 'loading': 1.0}},
 'fund_duration': {'short': 2.0, 'long': 7.0, 'CORP_BOND': 2.5},
 'horizon_months': [0.25, 3, 12], 'core_shock_uncertainty': 0.4, 'idio_default_r2': 0.35, 'vol_frequency': 'tháng',
 'estimation': {'months': EST['n'], 'start': EST['start'], 'end': EST['end'], 'factors': EST['keys'], 'shrink_to_prior': SHRINK, 'foreign_flow': EST.get('ff')},
 'quantiles': {'severe': 0.05, 'bad': 0.1, 'base': 0.5, 'good': 0.9},
 'priced_in': {'none': 1.0, 'partial': 0.5, 'full': 0.0},
 'lane2_route_rm_pct': -0.05,
 'analogs': [
  {'id': 'VN-2022', 'check': CHECK_2022, 'label': 'Fed tăng lãi suất mạnh, NHNN bảo vệ tỷ giá (4–11/2022)', 'moves': {'VN_EQ': -37.05, 'VN_RATE': 200, 'USDVND': 8.8, 'US10Y': 230, 'DXY': 8},
   'sources': {'VN_EQ': 'TCBS giá tuần VNINDEX 01/04–11/11/2022', 'USDVND': 'exchange-rates.org 31/3→31/10/2022 (22.839 → 24.848); cả năm 2022 chỉ +3,5% theo IMF vì VND hồi lại cuối năm', 'VN_RATE': 'NHNN tăng lãi suất điều hành 2 lần 9–10/2022 (FocusEconomics)', 'US10Y': 'xấp xỉ, cần kiểm chứng', 'DXY': 'xấp xỉ, cần kiểm chứng'}},
  {'id': 'VN-2025-04', 'label': 'Cú sốc thuế quan Mỹ (28/3–11/4/2025)', 'moves': {'VN_EQ': -7.21}, 'sources': {'VN_EQ': 'TCBS giá tuần VNINDEX'}},
 ],
 'sources': ['Biến động và tương quan tháng của US10Y, DXY (rổ 6 đồng tiền theo trọng số DXY), cổ phiếu toàn cầu (S&P 500), dầu Brent, vàng thế giới, USD/VND, lãi suất tái cấp vốn NHNN, VN-Index, chênh lệch SJC: ước lượng từ dữ liệu tháng 02/2022–08/2026 (bộ dữ liệu công khai FRED/datasets trên GitHub; USD/VND exchange-rates.org; lãi suất NHNN theo quyết định; SJC webgia.com; VN-Index TCBS), co 20% về giả định ban đầu',
             'Cổ phiếu VN: hồi quy giá tuần TCBS (tcinvest getLongTermCandleChart) 01/2022–10/2026; beta bình thường = trọng số mũ nửa đời 52 tuần, beta căng thẳng = 4–12/2022',
             'Dòng vốn ngoại: tương quan với VN-Index ước lượng theo tuần từ dữ liệu TCBS 10/2025–10/2026; tương quan với yếu tố khác vẫn là giả định',
             'Chưa có dữ liệu, vẫn là giả định: Bitcoin, lợi suất TPCP VN, chênh lệch tín dụng DN, dòng vốn ngoại, giá BĐS VN'],
}
out = root / 'src/data/factorModel.ts'
out.write_text('// Sinh bởi scripts/gen-factor-model.py. Mô hình yếu tố rủi ro mặc định; CIO duyệt và hiệu chỉnh qua cấu hình FACTOR_MODEL.\n'
               'export const DEFAULT_FACTOR_MODEL = ' + json.dumps(model, ensure_ascii=False, indent=1) + ' as const\n')
print('ok', out)

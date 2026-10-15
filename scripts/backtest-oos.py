"""Kiểm định NGOÀI MẪU cho lớp lan truyền theo tương quan (trả lời phát hiện F05, F06 của agent phản biện độc lập).
Cách làm: với mỗi tháng t (từ tháng thứ 25 trở đi), ước lượng biến động và tương quan CHỈ từ các tháng trước t
(không nhìn trước), coi biến động trong tháng t của các yếu tố toàn cầu là "cú sốc lõi đã biết", để máy suy ra các
yếu tố trong nước (USD/VND, lãi suất NHNN, VN-Index, chênh lệch SJC) kèm khoảng tin cậy, rồi so với thực tế tháng t.
Đo: tỷ lệ thực tế rơi vào khoảng 80% (mục tiêu ≈ 80%), đúng chiều, và mức giảm sai số so với dự báo "không đổi".
Thêm phép thử sự kiện 04/2025 (thuế quan Mỹ) với mô hình ước lượng đến 03/2025.
Chạy: python3 scripts/backtest-oos.py → reports/backtest_oos.json"""
import json, numpy as np, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
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
keys = list(R)
X = np.array([[R[k][m] for k in keys] for m in common])
GLOBAL = ['US10Y', 'DXY', 'GLOBAL_EQ', 'OIL', 'GOLD_W']
LOCAL = ['USDVND', 'VN_RATE', 'VN_EQ', 'SJC_PREM']
SHRINK = 0.2
Z80, Z90 = 1.2816, 1.6449

def fit(rows):
    vol = rows.std(axis=0, ddof=1)
    C = np.corrcoef(rows.T)
    C = (1 - SHRINK) * C + SHRINK * np.eye(len(keys))   # co về 0 (không dùng giả định có thể đã nhìn dữ liệu)
    return vol, C

def predict(vol, C, core, targets, obs):
    S = C * np.outer(vol, vol)
    ci = [keys.index(k) for k in core]; ti = [keys.index(k) for k in targets]
    W = np.linalg.solve(S[np.ix_(ci, ci)], S[np.ix_(ci, ti)])
    mean = np.array([obs[k] for k in core]) @ W
    cov = S[np.ix_(ti, ti)] - S[np.ix_(ti, ci)] @ np.linalg.solve(S[np.ix_(ci, ci)], S[np.ix_(ci, ti)])
    return mean, np.sqrt(np.maximum(np.diag(cov), 1e-12))

def run(core, targets, min_train=24):
    rec = {k: [] for k in targets}
    for t in range(min_train, len(common)):
        vol, C = fit(X[:t])
        obs = {k: X[t, keys.index(k)] for k in keys}
        mean, sd = predict(vol, C, core, targets, obs)
        for j, k in enumerate(targets):
            rec[k].append((common[t], float(obs[k]), float(mean[j]), float(sd[j])))
    out = {}
    for k, rows in rec.items():
        a = np.array([[r[1], r[2], r[3]] for r in rows])
        z = (a[:, 0] - a[:, 1]) / a[:, 2]
        mse_m = float(np.mean((a[:, 0] - a[:, 1]) ** 2)); mse_0 = float(np.mean(a[:, 0] ** 2))
        nz = np.abs(a[:, 1]) > 1e-9
        out[k] = {
            'months': len(rows), 'from': rows[0][0], 'to': rows[-1][0],
            'coverage_80': round(float(np.mean(np.abs(z) <= Z80)), 3), 'coverage_90': round(float(np.mean(np.abs(z) <= Z90)), 3),
            'direction_hit': round(float(np.mean(np.sign(a[nz & (np.abs(a[:, 0]) > 1e-9), 0]) == np.sign(a[nz & (np.abs(a[:, 0]) > 1e-9), 1]))), 3) if np.any(nz & (np.abs(a[:, 0]) > 1e-9)) else None,
            'skill_vs_no_change': round(1 - mse_m / mse_0, 3) if mse_0 > 0 else None,
            'actual_nonzero_months': int(np.sum(np.abs(a[:, 0]) > 1e-9)),
            'mean_abs_z': round(float(np.mean(np.abs(z))), 3),
        }
    return out

res = {
    'design': 'Ngoài mẫu, cửa sổ mở rộng (ước lượng chỉ từ dữ liệu trước tháng dự báo), tối thiểu 24 tháng huấn luyện, tương quan co 20% về 0, chế độ bình thường, khung tháng',
    'data_months': {'n': len(common), 'from': common[0], 'to': common[-1]},
    'global_only': run(GLOBAL, LOCAL),
    'global_plus_rate': run(GLOBAL + ['VN_RATE'], ['USDVND', 'VN_EQ', 'SJC_PREM']),
}
# Phép thử sự kiện 04/2025: mô hình ước lượng đến 03/2025
if '2025-04' in common:
    t = common.index('2025-04')
    vol, C = fit(X[:t])
    obs = {k: X[t, keys.index(k)] for k in keys}
    mean, sd = predict(vol, C, GLOBAL, LOCAL, obs)
    res['event_2025_04'] = {
        'trained_through': common[t - 1], 'conditioned_on': {k: round(float(obs[k]), 2) for k in GLOBAL},
        'predicted': {k: {'mean': round(float(mean[j]), 2), 'band80': [round(float(mean[j] - Z80 * sd[j]), 2), round(float(mean[j] + Z80 * sd[j]), 2)]} for j, k in enumerate(LOCAL)},
        'actual': {k: round(float(obs[k]), 2) for k in LOCAL},
    }
# Ghi chú trung thực về kiểm tra 2022 trong mô hình: dùng tương quan ước lượng trên chính giai đoạn có 2022 → TRONG mẫu
res['note_2022_in_sample'] = 'Phép kiểm tra 2022 trong FACTOR_MODEL dùng tương quan ước lượng 2022–2026, tức có nhìn trước; chỉ là minh họa, không phải bằng chứng kiểm định. Dữ liệu bắt đầu 2022 nên không kiểm định ngoài mẫu được cho 2022.'
pathlib.Path(root / 'reports').mkdir(exist_ok=True)
json.dump(res, open(root / 'reports/backtest_oos.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1))

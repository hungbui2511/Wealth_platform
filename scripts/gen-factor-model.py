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
ids = [f[0] for f in F]; n = len(F); ix = {k: i for i, k in enumerate(ids)}
C = np.eye(n)
pairs = {  # tương quan chế độ bình thường (giả định có lý do; CIO hiệu chỉnh)
 ('US10Y','DXY'): .40, ('US10Y','GLOBAL_EQ'): -.20, ('DXY','GLOBAL_EQ'): -.30, ('DXY','GOLD_W'): -.40, ('US10Y','GOLD_W'): -.30,
 ('DXY','USDVND'): .40, ('US10Y','USDVND'): .25, ('USDVND','VN_RATE'): .30, ('VN_RATE','VN_GOV'): .50, ('VN_GOV','CREDIT_RE'): .30,
 ('VN_GOV','CREDIT_FIN'): .30, ('CREDIT_RE','CREDIT_FIN'): .50, ('VN_EQ','FOREIGN_FLOW'): .50, ('VN_EQ','USDVND'): -.30,
 ('VN_EQ','VN_RATE'): -.25, ('VN_EQ','GLOBAL_EQ'): .35, ('VN_EQ','CREDIT_RE'): -.30, ('VN_EQ','CREDIT_FIN'): -.20,
 ('CRYPTO','GLOBAL_EQ'): .40, ('OIL','GLOBAL_EQ'): .20, ('SJC_PREM','USDVND'): .20, ('VN_RE','VN_RATE'): -.20,
 ('VN_RE','CREDIT_RE'): -.30, ('VN_RE','VN_EQ'): .20, ('FOREIGN_FLOW','USDVND'): -.40, ('FOREIGN_FLOW','DXY'): -.30,
 ('FOREIGN_FLOW','GLOBAL_EQ'): .25, ('US10Y','VN_GOV'): .20, ('VN_EQ','US10Y'): -.15, ('OIL','US10Y'): .15, ('GLOBAL_EQ','CREDIT_RE'): -.10, ('GLOBAL_EQ','CREDIT_FIN'): -.10,
}
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
 'uncertainty_weeks': 4,
 'quantiles': {'bad': 0.1, 'base': 0.5, 'good': 0.9},
 'priced_in': {'none': 1.0, 'partial': 0.5, 'full': 0.0},
 'lane2_route_rm_pct': -0.05,
 'analogs': [
  {'id': 'VN-2022', 'label': 'Fed tăng lãi suất mạnh, NHNN bảo vệ tỷ giá (4–11/2022)', 'moves': {'VN_EQ': -37.05, 'VN_RATE': 200, 'USDVND': 3.5, 'US10Y': 230, 'DXY': 8},
   'sources': {'VN_EQ': 'TCBS giá tuần VNINDEX 01/04–11/11/2022', 'USDVND': 'IMF Article IV 2025 (22.826 → 23.633, cả năm 2022)', 'VN_RATE': 'NHNN tăng lãi suất điều hành 2 lần 9–10/2022 (FocusEconomics)', 'US10Y': 'xấp xỉ, cần kiểm chứng', 'DXY': 'xấp xỉ, cần kiểm chứng'}},
  {'id': 'VN-2025-04', 'label': 'Cú sốc thuế quan Mỹ (28/3–11/4/2025)', 'moves': {'VN_EQ': -7.21}, 'sources': {'VN_EQ': 'TCBS giá tuần VNINDEX'}},
 ],
 'sources': ['Cổ phiếu VN: hồi quy giá tuần TCBS (tcinvest getLongTermCandleChart) 01/2022–10/2026; beta bình thường = trọng số mũ nửa đời 52 tuần, beta căng thẳng = 4–12/2022',
             'Các yếu tố còn lại: độ biến động và tương quan là giả định minh họa có lý do, chờ ước lượng từ dữ liệu NHNN, lợi suất, tỷ giá, vàng',
             'Yếu tố biến động chậm (lãi suất VND, lợi suất TPCP, chênh lệch tín dụng, giá BĐS) dùng biến động quy về khung khoảng 1 tháng để cùng thang với thư viện cú sốc'],
}
out = root / 'src/data/factorModel.ts'
out.write_text('// Sinh bởi scripts/gen-factor-model.py. Mô hình yếu tố rủi ro mặc định; CIO duyệt và hiệu chỉnh qua cấu hình FACTOR_MODEL.\n'
               'export const DEFAULT_FACTOR_MODEL = ' + json.dumps(model, ensure_ascii=False, indent=1) + ' as const\n')
print('ok', out)

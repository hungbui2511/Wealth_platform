// Sinh bởi scripts/gen-factor-model.py. Mô hình yếu tố rủi ro mặc định; CIO duyệt và hiệu chỉnh qua cấu hình FACTOR_MODEL.
export const DEFAULT_FACTOR_MODEL = {
 "version": "FM-2026-10",
 "horizons": [
  "1 tuần",
  "3 tháng",
  "12 tháng"
 ],
 "size_labels": {
  "S": "nhỏ",
  "M": "vừa",
  "L": "lớn"
 },
 "factors": [
  {
   "id": "US10Y",
   "label": "Lợi suất trái phiếu Mỹ 10 năm",
   "unit": "bp",
   "origin": "global",
   "vol": {
    "calm": 22.404,
    "stress": 32.549
   },
   "library": {
    "S": 15,
    "M": 30,
    "L": 60
   },
   "profile": [
    0.8,
    1,
    1
   ]
  },
  {
   "id": "DXY",
   "label": "Chỉ số đồng USD (DXY)",
   "unit": "%",
   "origin": "global",
   "vol": {
    "calm": 1.691,
    "stress": 2.474
   },
   "library": {
    "S": 1,
    "M": 2,
    "L": 4
   },
   "profile": [
    0.8,
    1,
    1
   ]
  },
  {
   "id": "GLOBAL_EQ",
   "label": "Cổ phiếu toàn cầu (USD)",
   "unit": "%",
   "origin": "global",
   "vol": {
    "calm": 3.514,
    "stress": 4.662
   },
   "library": {
    "S": 3,
    "M": 7,
    "L": 15
   },
   "profile": [
    0.8,
    1,
    1
   ]
  },
  {
   "id": "OIL",
   "label": "Giá dầu Brent",
   "unit": "%",
   "origin": "global",
   "vol": {
    "calm": 9.887,
    "stress": 11.864
   },
   "library": {
    "S": 5,
    "M": 12,
    "L": 25
   },
   "profile": [
    0.8,
    1,
    1
   ]
  },
  {
   "id": "GOLD_W",
   "label": "Giá vàng thế giới (USD)",
   "unit": "%",
   "origin": "global",
   "vol": {
    "calm": 4.1,
    "stress": 4.92
   },
   "library": {
    "S": 2,
    "M": 5,
    "L": 10
   },
   "profile": [
    0.8,
    1,
    1
   ]
  },
  {
   "id": "CRYPTO",
   "label": "Bitcoin (USD)",
   "unit": "%",
   "origin": "global",
   "vol": {
    "calm": 15,
    "stress": 25
   },
   "library": {
    "S": 8,
    "M": 20,
    "L": 40
   },
   "profile": [
    0.9,
    1,
    1
   ]
  },
  {
   "id": "USDVND",
   "label": "Tỷ giá USD/VND",
   "unit": "%",
   "origin": "local",
   "vol": {
    "calm": 1.223,
    "stress": 2.046
   },
   "library": {
    "S": 0.5,
    "M": 1.5,
    "L": 3
   },
   "profile": [
    0.4,
    0.9,
    1
   ]
  },
  {
   "id": "VN_RATE",
   "label": "Lãi suất VND (điều hành, liên ngân hàng)",
   "unit": "bp",
   "origin": "local",
   "vol": {
    "calm": 22.548,
    "stress": 42.164
   },
   "library": {
    "S": 25,
    "M": 50,
    "L": 100
   },
   "profile": [
    0.3,
    0.8,
    1
   ]
  },
  {
   "id": "VN_GOV",
   "label": "Lợi suất trái phiếu Chính phủ VN",
   "unit": "bp",
   "origin": "local",
   "vol": {
    "calm": 15,
    "stress": 30
   },
   "library": {
    "S": 15,
    "M": 30,
    "L": 60
   },
   "profile": [
    0.3,
    0.8,
    1
   ]
  },
  {
   "id": "CREDIT_RE",
   "label": "Chênh lệch tín dụng DN bất động sản",
   "unit": "bp",
   "origin": "local",
   "vol": {
    "calm": 40,
    "stress": 100
   },
   "library": {
    "S": 50,
    "M": 150,
    "L": 300
   },
   "profile": [
    0.2,
    0.7,
    1
   ]
  },
  {
   "id": "CREDIT_FIN",
   "label": "Chênh lệch tín dụng DN tài chính, ngân hàng",
   "unit": "bp",
   "origin": "local",
   "vol": {
    "calm": 15,
    "stress": 40
   },
   "library": {
    "S": 20,
    "M": 50,
    "L": 100
   },
   "profile": [
    0.2,
    0.7,
    1
   ]
  },
  {
   "id": "VN_EQ",
   "label": "Thị trường cổ phiếu VN (VN-Index)",
   "unit": "%",
   "origin": "local",
   "vol": {
    "calm": 5.696,
    "stress": 7.237
   },
   "library": {
    "S": 3,
    "M": 7,
    "L": 15
   },
   "profile": [
    0.7,
    1,
    1
   ]
  },
  {
   "id": "FOREIGN_FLOW",
   "label": "Dòng vốn ngoại trên HOSE",
   "unit": "σ",
   "origin": "local",
   "vol": {
    "calm": 1.0,
    "stress": 1.5
   },
   "library": {
    "S": 1,
    "M": 2,
    "L": 3
   },
   "profile": [
    0.7,
    1,
    1
   ]
  },
  {
   "id": "SJC_PREM",
   "label": "Chênh lệch giá vàng SJC so với thế giới",
   "unit": "điểm %",
   "origin": "local",
   "vol": {
    "calm": 4.311,
    "stress": 5.174
   },
   "library": {
    "S": 2,
    "M": 4,
    "L": 8
   },
   "profile": [
    0.6,
    1,
    1
   ]
  },
  {
   "id": "VN_RE",
   "label": "Giá bất động sản nhà ở VN",
   "unit": "%",
   "origin": "local",
   "vol": {
    "calm": 1.0,
    "stress": 2.0
   },
   "library": {
    "S": 1,
    "M": 3,
    "L": 6
   },
   "profile": [
    0.0,
    0.3,
    1
   ]
  }
 ],
 "corr": {
  "calm": [
   [
    1.0,
    0.592,
    -0.286,
    0.185,
    -0.292,
    0.0,
    0.481,
    0.296,
    0.2,
    0.0,
    0.0,
    -0.373,
    -0.3,
    0.078,
    0.0
   ],
   [
    0.592,
    1.0,
    -0.268,
    0.131,
    -0.473,
    0.0,
    0.446,
    0.182,
    0.0,
    0.0,
    0.0,
    -0.314,
    -0.3,
    0.026,
    0.0
   ],
   [
    -0.286,
    -0.268,
    1.0,
    -0.084,
    0.101,
    0.4,
    -0.187,
    -0.295,
    0.0,
    -0.1,
    -0.1,
    0.555,
    0.25,
    -0.302,
    0.0
   ],
   [
    0.185,
    0.131,
    -0.084,
    1.0,
    0.038,
    0.0,
    0.158,
    -0.034,
    0.0,
    0.0,
    0.0,
    -0.087,
    0.0,
    -0.108,
    0.0
   ],
   [
    -0.292,
    -0.473,
    0.101,
    0.038,
    1.0,
    0.0,
    -0.177,
    -0.12,
    0.0,
    0.0,
    0.0,
    0.176,
    0.0,
    -0.096,
    0.0
   ],
   [
    0.0,
    0.0,
    0.4,
    0.0,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0
   ],
   [
    0.481,
    0.446,
    -0.187,
    0.158,
    -0.177,
    0.0,
    1.0,
    0.356,
    0.0,
    0.0,
    0.0,
    -0.269,
    -0.4,
    -0.008,
    0.0
   ],
   [
    0.296,
    0.182,
    -0.295,
    -0.034,
    -0.12,
    0.0,
    0.356,
    1.0,
    0.5,
    0.0,
    0.0,
    -0.354,
    -0.1,
    0.036,
    -0.2
   ],
   [
    0.2,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.5,
    1.0,
    0.3,
    0.3,
    0.0,
    0.0,
    0.0,
    0.0
   ],
   [
    0.0,
    0.0,
    -0.1,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.3,
    1.0,
    0.5,
    -0.3,
    0.0,
    0.0,
    -0.3
   ],
   [
    0.0,
    0.0,
    -0.1,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.3,
    0.5,
    1.0,
    -0.2,
    0.0,
    0.0,
    0.0
   ],
   [
    -0.373,
    -0.314,
    0.555,
    -0.087,
    0.176,
    0.0,
    -0.269,
    -0.354,
    0.0,
    -0.3,
    -0.2,
    1.0,
    0.475,
    -0.054,
    0.2
   ],
   [
    -0.3,
    -0.3,
    0.25,
    0.0,
    0.0,
    0.0,
    -0.4,
    -0.1,
    0.0,
    0.0,
    0.0,
    0.475,
    1.0,
    0.0,
    0.0
   ],
   [
    0.078,
    0.026,
    -0.302,
    -0.108,
    -0.096,
    0.0,
    -0.008,
    0.036,
    0.0,
    0.0,
    0.0,
    -0.054,
    0.0,
    1.0,
    0.0
   ],
   [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    -0.2,
    0.0,
    -0.3,
    0.0,
    0.2,
    0.0,
    0.0,
    1.0
   ]
  ],
  "stress": [
   [
    1.0,
    0.817,
    -0.393,
    0.261,
    -0.409,
    0.002,
    0.647,
    0.422,
    0.247,
    0.019,
    0.003,
    -0.473,
    -0.428,
    0.106,
    0.006
   ],
   [
    0.817,
    1.0,
    -0.348,
    0.183,
    -0.654,
    -0.009,
    0.616,
    0.244,
    0.003,
    -0.006,
    0.0,
    -0.44,
    -0.408,
    0.042,
    0.002
   ],
   [
    -0.393,
    -0.348,
    1.0,
    -0.11,
    0.15,
    0.516,
    -0.262,
    -0.37,
    -0.011,
    -0.136,
    -0.133,
    0.696,
    0.344,
    -0.392,
    0.013
   ],
   [
    0.261,
    0.183,
    -0.11,
    1.0,
    0.053,
    -0.002,
    0.211,
    -0.034,
    -0.011,
    0.007,
    0.002,
    -0.111,
    -0.005,
    -0.149,
    0.004
   ],
   [
    -0.409,
    -0.654,
    0.15,
    0.053,
    1.0,
    -0.006,
    -0.243,
    -0.164,
    0.003,
    -0.005,
    -0.0,
    0.223,
    0.005,
    -0.129,
    0.002
   ],
   [
    0.002,
    -0.009,
    0.516,
    -0.002,
    -0.006,
    1.0,
    0.005,
    -0.01,
    0.006,
    0.001,
    -0.002,
    0.017,
    -0.003,
    -0.01,
    -0.007
   ],
   [
    0.647,
    0.616,
    -0.262,
    0.211,
    -0.243,
    0.005,
    1.0,
    0.435,
    0.036,
    -0.025,
    -0.006,
    -0.385,
    -0.53,
    -0.014,
    -0.012
   ],
   [
    0.422,
    0.244,
    -0.37,
    -0.034,
    -0.164,
    -0.01,
    0.435,
    1.0,
    0.593,
    0.044,
    0.01,
    -0.416,
    -0.165,
    0.054,
    -0.248
   ],
   [
    0.247,
    0.003,
    -0.011,
    -0.011,
    0.003,
    0.006,
    0.036,
    0.593,
    1.0,
    0.36,
    0.399,
    -0.046,
    0.03,
    -0.003,
    -0.018
   ],
   [
    0.019,
    -0.006,
    -0.136,
    0.007,
    -0.005,
    0.001,
    -0.025,
    0.044,
    0.36,
    1.0,
    0.694,
    -0.432,
    -0.024,
    -0.001,
    -0.401
   ],
   [
    0.003,
    0.0,
    -0.133,
    0.002,
    -0.0,
    -0.002,
    -0.006,
    0.01,
    0.399,
    0.694,
    1.0,
    -0.264,
    -0.004,
    0.001,
    0.003
   ],
   [
    -0.473,
    -0.44,
    0.696,
    -0.111,
    0.223,
    0.017,
    -0.385,
    -0.416,
    -0.046,
    -0.432,
    -0.264,
    1.0,
    0.585,
    -0.085,
    0.275
   ],
   [
    -0.428,
    -0.408,
    0.344,
    -0.005,
    0.005,
    -0.003,
    -0.53,
    -0.165,
    0.03,
    -0.024,
    -0.004,
    0.585,
    1.0,
    0.003,
    -0.007
   ],
   [
    0.106,
    0.042,
    -0.392,
    -0.149,
    -0.129,
    -0.01,
    -0.014,
    0.054,
    -0.003,
    -0.001,
    0.001,
    -0.085,
    0.003,
    1.0,
    0.005
   ],
   [
    0.006,
    0.002,
    0.013,
    0.004,
    0.002,
    -0.007,
    -0.012,
    -0.248,
    -0.018,
    -0.401,
    0.003,
    0.275,
    -0.007,
    0.005,
    1.0
   ]
  ]
 },
 "equity": {
  "MBB": {
   "beta_calm": 0.9892,
   "beta_stress": 1.5218,
   "r2": 0.5476
  },
  "VPB": {
   "beta_calm": 1.0959,
   "beta_stress": 1.209,
   "r2": 0.514
  },
  "SHB": {
   "beta_calm": 0.8401,
   "beta_stress": 1.7916,
   "r2": 0.4516
  },
  "NLG": {
   "beta_calm": 0.986,
   "beta_stress": 1.6759,
   "r2": 0.3621
  },
  "DXG": {
   "beta_calm": 1.2415,
   "beta_stress": 2.2304,
   "r2": 0.432
  },
  "KDH": {
   "beta_calm": 0.9577,
   "beta_stress": 1.5065,
   "r2": 0.4664
  },
  "SSI": {
   "beta_calm": 1.272,
   "beta_stress": 1.7091,
   "r2": 0.5299
  },
  "HPG": {
   "beta_calm": 0.9392,
   "beta_stress": 1.7229,
   "r2": 0.4993
  },
  "MWG": {
   "beta_calm": 1.0804,
   "beta_stress": 1.5484,
   "r2": 0.4482
  },
  "FPT": {
   "beta_calm": 0.6644,
   "beta_stress": 0.7064,
   "r2": 0.2539
  },
  "PLX": {
   "beta_calm": 0.7502,
   "beta_stress": 1.1972,
   "r2": 0.2559
  },
  "VNM": {
   "beta_calm": 0.4424,
   "beta_stress": 0.4512,
   "r2": 0.1919
  },
  "GMD": {
   "beta_calm": 0.7258,
   "beta_stress": 0.4507,
   "r2": 0.1995
  },
  "NT2": {
   "beta_calm": 0.3795,
   "beta_stress": 0.8431,
   "r2": 0.1784
  }
 },
 "sector_beta": {
  "BANK": {
   "beta_calm": 0.9751,
   "beta_stress": 1.5075
  },
  "REAL_ESTATE": {
   "beta_calm": 1.0617,
   "beta_stress": 1.8043
  },
  "SECURITIES": {
   "beta_calm": 1.272,
   "beta_stress": 1.7091
  },
  "STEEL_MATERIALS": {
   "beta_calm": 0.9392,
   "beta_stress": 1.7229
  },
  "RETAIL": {
   "beta_calm": 1.0804,
   "beta_stress": 1.5484
  },
  "TECH": {
   "beta_calm": 0.6644,
   "beta_stress": 0.7064
  },
  "ENERGY": {
   "beta_calm": 0.7502,
   "beta_stress": 1.1972
  },
  "CONSUMER": {
   "beta_calm": 0.4424,
   "beta_stress": 0.4512
  },
  "INDUSTRIAL": {
   "beta_calm": 0.7258,
   "beta_stress": 0.4507
  },
  "UTILITIES": {
   "beta_calm": 0.3795,
   "beta_stress": 0.8431
  },
  "OTHER": {
   "beta_calm": 1.0,
   "beta_stress": 1.0
  }
 },
 "usd_revenue": {
  "FPT": 0.5
 },
 "intl_beta": {
  "AAPL": 1.2,
  "VT": 1.0
 },
 "credit_factor": {
  "VHM12613": "CREDIT_RE",
  "VIC12510": "CREDIT_RE",
  "VIB12508": "CREDIT_FIN",
  "BANK": "CREDIT_FIN",
  "REAL_ESTATE": "CREDIT_RE",
  "ENERGY": "CREDIT_FIN",
  "DEFAULT": "CREDIT_FIN"
 },
 "proxy": {
  "PRIVATE_EQ": {
   "factor": "VN_EQ",
   "loading": 0.5,
   "note": "Cổ phần chưa niêm yết: ánh xạ qua VN-Index hệ số 0,5, ghi nhận chậm"
  },
  "REAL_ESTATE": {
   "factor": "VN_RE",
   "loading": 1.0
  }
 },
 "fund_duration": {
  "short": 2.0,
  "long": 7.0,
  "CORP_BOND": 2.5
 },
 "horizon_months": [
  0.25,
  3,
  12
 ],
 "core_shock_uncertainty": 0.4,
 "idio_default_r2": 0.35,
 "vol_frequency": "tháng",
 "estimation": {
  "months": 55,
  "start": "2022-02",
  "end": "2026-08",
  "factors": [
   "US10Y",
   "DXY",
   "GLOBAL_EQ",
   "OIL",
   "GOLD_W",
   "USDVND",
   "VN_RATE",
   "VN_EQ",
   "SJC_PREM"
  ],
  "shrink_to_prior": 0.2,
  "foreign_flow": {
   "weeks": 46,
   "corr_vn_eq": 0.468
  }
 },
 "quantiles": {
  "severe": 0.05,
  "bad": 0.1,
  "base": 0.5,
  "good": 0.9
 },
 "priced_in": {
  "none": 1.0,
  "partial": 0.5,
  "full": 0.0
 },
 "lane2_route_rm_pct": -0.05,
 "analogs": [
  {
   "id": "VN-2022",
   "check": {
    "conditioned_on": {
     "US10Y": 230,
     "DXY": 8,
     "VN_RATE": 200
    },
    "regime": "stress",
    "predicted": {
     "VN_EQ": -23.34,
     "USDVND": 8.48,
     "GOLD_W": -2.8,
     "GLOBAL_EQ": -13.21,
     "FOREIGN_FLOW": -3.87
    },
    "actual": {
     "VN_EQ": -37.05,
     "USDVND": 8.8
    },
    "note": "Chỉ biết lợi suất Mỹ, DXY và lãi suất NHNN, mô hình suy ra VN-Index -23% so với thực tế −37%, tức khoảng 63% mức giảm; USD/VND 8.5% so với thực tế +8,8% (3–10/2022). Kết luận: tương quan bắt đúng hướng và tỷ giá, nhưng thiếu phần khuếch đại trong nước (margin, trái phiếu DN, tâm lý). Khi kịch bản căng thẳng, agent phải đưa VN_EQ và CREDIT_RE vào yếu tố lõi thay vì để máy suy ra."
   },
   "label": "Fed tăng lãi suất mạnh, NHNN bảo vệ tỷ giá (4–11/2022)",
   "moves": {
    "VN_EQ": -37.05,
    "VN_RATE": 200,
    "USDVND": 8.8,
    "US10Y": 230,
    "DXY": 8
   },
   "sources": {
    "VN_EQ": "TCBS giá tuần VNINDEX 01/04–11/11/2022",
    "USDVND": "exchange-rates.org 31/3→31/10/2022 (22.839 → 24.848); cả năm 2022 chỉ +3,5% theo IMF vì VND hồi lại cuối năm",
    "VN_RATE": "NHNN tăng lãi suất điều hành 2 lần 9–10/2022 (FocusEconomics)",
    "US10Y": "xấp xỉ, cần kiểm chứng",
    "DXY": "xấp xỉ, cần kiểm chứng"
   }
  },
  {
   "id": "VN-2025-04",
   "label": "Cú sốc thuế quan Mỹ (28/3–11/4/2025)",
   "moves": {
    "VN_EQ": -7.21
   },
   "sources": {
    "VN_EQ": "TCBS giá tuần VNINDEX"
   }
  }
 ],
 "sources": [
  "Biến động và tương quan tháng của US10Y, DXY (rổ 6 đồng tiền theo trọng số DXY), cổ phiếu toàn cầu (S&P 500), dầu Brent, vàng thế giới, USD/VND, lãi suất tái cấp vốn NHNN, VN-Index, chênh lệch SJC: ước lượng từ dữ liệu tháng 02/2022–08/2026 (bộ dữ liệu công khai FRED/datasets trên GitHub; USD/VND exchange-rates.org; lãi suất NHNN theo quyết định; SJC webgia.com; VN-Index TCBS), co 20% về giả định ban đầu",
  "Cổ phiếu VN: hồi quy giá tuần TCBS (tcinvest getLongTermCandleChart) 01/2022–10/2026; beta bình thường = trọng số mũ nửa đời 52 tuần, beta căng thẳng = 4–12/2022",
  "Dòng vốn ngoại: tương quan với VN-Index ước lượng theo tuần từ dữ liệu TCBS 10/2025–10/2026; tương quan với yếu tố khác vẫn là giả định",
  "Chưa có dữ liệu, vẫn là giả định: Bitcoin, lợi suất TPCP VN, chênh lệch tín dụng DN, dòng vốn ngoại, giá BĐS VN"
 ]
} as const

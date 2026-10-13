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
    "calm": 9,
    "stress": 15
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
    "calm": 0.9,
    "stress": 1.4
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
    "calm": 2.0,
    "stress": 3.2
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
    "calm": 4.0,
    "stress": 6.0
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
    "calm": 1.8,
    "stress": 2.6
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
    "calm": 8.0,
    "stress": 12.0
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
    "calm": 0.3,
    "stress": 0.6
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
    "calm": 15,
    "stress": 40
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
    "calm": 10,
    "stress": 20
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
    "calm": 2.65,
    "stress": 3.81
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
    "calm": 1.0,
    "stress": 2.0
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
    0.4,
    -0.2,
    0.15,
    -0.3,
    0.0,
    0.25,
    0.0,
    0.2,
    0.0,
    0.0,
    -0.15,
    0.0,
    0.0,
    0.0
   ],
   [
    0.4,
    1.0,
    -0.3,
    0.0,
    -0.4,
    0.0,
    0.4,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    -0.3,
    0.0,
    0.0
   ],
   [
    -0.2,
    -0.3,
    1.0,
    0.2,
    0.0,
    0.4,
    0.0,
    0.0,
    0.0,
    -0.1,
    -0.1,
    0.35,
    0.25,
    0.0,
    0.0
   ],
   [
    0.15,
    0.0,
    0.2,
    1.0,
    0.0,
    0.0,
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
    -0.3,
    -0.4,
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
    0.0,
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
    0.25,
    0.4,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
    0.3,
    0.0,
    0.0,
    0.0,
    -0.3,
    -0.4,
    0.2,
    0.0
   ],
   [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.3,
    1.0,
    0.5,
    0.0,
    0.0,
    -0.25,
    0.0,
    0.0,
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
    -0.15,
    0.0,
    0.35,
    0.0,
    0.0,
    0.0,
    -0.3,
    -0.25,
    0.0,
    -0.3,
    -0.2,
    1.0,
    0.5,
    0.0,
    0.2
   ],
   [
    0.0,
    -0.3,
    0.25,
    0.0,
    0.0,
    0.0,
    -0.4,
    0.0,
    0.0,
    0.0,
    0.0,
    0.5,
    1.0,
    0.0,
    0.0
   ],
   [
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
    0.2,
    0.0,
    0.0,
    0.0,
    0.0,
    0.0,
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
    0.533,
    -0.259,
    0.199,
    -0.403,
    -0.004,
    0.31,
    0.042,
    0.227,
    0.026,
    0.006,
    -0.172,
    -0.03,
    0.006,
    0.012
   ],
   [
    0.533,
    1.0,
    -0.348,
    -0.011,
    -0.518,
    -0.024,
    0.494,
    -0.008,
    0.011,
    -0.019,
    0.0,
    -0.056,
    -0.385,
    0.009,
    0.005
   ],
   [
    -0.259,
    -0.348,
    1.0,
    0.258,
    0.027,
    0.517,
    -0.047,
    0.011,
    -0.007,
    -0.141,
    -0.133,
    0.472,
    0.338,
    0.011,
    0.011
   ],
   [
    0.199,
    -0.011,
    0.258,
    1.0,
    -0.008,
    0.007,
    0.016,
    -0.01,
    0.009,
    -0.003,
    -0.002,
    0.006,
    0.004,
    -0.004,
    -0.005
   ],
   [
    -0.403,
    -0.518,
    0.027,
    -0.008,
    1.0,
    -0.013,
    -0.026,
    0.011,
    -0.009,
    0.0,
    0.002,
    -0.017,
    -0.002,
    0.006,
    0.007
   ],
   [
    -0.004,
    -0.024,
    0.517,
    0.007,
    -0.013,
    1.0,
    0.023,
    -0.005,
    0.004,
    0.003,
    -0.001,
    0.02,
    -0.001,
    -0.005,
    -0.005
   ],
   [
    0.31,
    0.494,
    -0.047,
    0.016,
    -0.026,
    0.023,
    1.0,
    0.361,
    0.031,
    -0.011,
    -0.006,
    -0.404,
    -0.519,
    0.259,
    -0.016
   ],
   [
    0.042,
    -0.008,
    0.011,
    -0.01,
    0.011,
    -0.005,
    0.361,
    1.0,
    0.601,
    0.038,
    0.009,
    -0.286,
    -0.043,
    0.008,
    -0.253
   ],
   [
    0.227,
    0.011,
    -0.007,
    0.009,
    -0.009,
    0.004,
    0.031,
    0.601,
    1.0,
    0.363,
    0.399,
    -0.043,
    0.043,
    -0.007,
    -0.017
   ],
   [
    0.026,
    -0.019,
    -0.141,
    -0.003,
    0.0,
    0.003,
    -0.011,
    0.038,
    0.363,
    1.0,
    0.695,
    -0.433,
    -0.031,
    0.003,
    -0.403
   ],
   [
    0.006,
    0.0,
    -0.133,
    -0.002,
    0.002,
    -0.001,
    -0.006,
    0.009,
    0.399,
    0.695,
    1.0,
    -0.264,
    -0.006,
    0.001,
    0.003
   ],
   [
    -0.172,
    -0.056,
    0.472,
    0.006,
    -0.017,
    0.02,
    -0.404,
    -0.286,
    -0.043,
    -0.433,
    -0.264,
    1.0,
    0.574,
    -0.004,
    0.273
   ],
   [
    -0.03,
    -0.385,
    0.338,
    0.004,
    -0.002,
    -0.001,
    -0.519,
    -0.043,
    0.043,
    -0.031,
    -0.006,
    0.574,
    1.0,
    -0.004,
    -0.011
   ],
   [
    0.006,
    0.009,
    0.011,
    -0.004,
    0.006,
    -0.005,
    0.259,
    0.008,
    -0.007,
    0.003,
    0.001,
    -0.004,
    -0.004,
    1.0,
    0.004
   ],
   [
    0.012,
    0.005,
    0.011,
    -0.005,
    0.007,
    -0.005,
    -0.016,
    -0.253,
    -0.017,
    -0.403,
    0.003,
    0.273,
    -0.011,
    0.004,
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
 "uncertainty_weeks": 4,
 "quantiles": {
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
   "label": "Fed tăng lãi suất mạnh, NHNN bảo vệ tỷ giá (4–11/2022)",
   "moves": {
    "VN_EQ": -37.05,
    "VN_RATE": 200,
    "USDVND": 3.5,
    "US10Y": 230,
    "DXY": 8
   },
   "sources": {
    "VN_EQ": "TCBS giá tuần VNINDEX 01/04–11/11/2022",
    "USDVND": "IMF Article IV 2025 (22.826 → 23.633, cả năm 2022)",
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
  "Cổ phiếu VN: hồi quy giá tuần TCBS (tcinvest getLongTermCandleChart) 01/2022–10/2026; beta bình thường = trọng số mũ nửa đời 52 tuần, beta căng thẳng = 4–12/2022",
  "Các yếu tố còn lại: độ biến động và tương quan là giả định minh họa có lý do, chờ ước lượng từ dữ liệu NHNN, lợi suất, tỷ giá, vàng",
  "Yếu tố biến động chậm (lãi suất VND, lợi suất TPCP, chênh lệch tín dụng, giá BĐS) dùng biến động quy về khung khoảng 1 tháng để cùng thang với thư viện cú sốc"
 ]
} as const

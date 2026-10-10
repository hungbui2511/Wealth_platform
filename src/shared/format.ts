// Định dạng số kiểu tiếng Việt: dấu chấm nghìn, dấu phẩy thập phân.

export function groupVi(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function fmtNumber(v: string | number, dp = 0): string {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '—'
  const neg = n < 0
  const fixed = Math.abs(n).toFixed(dp)
  const [i, f] = fixed.split('.')
  return (neg ? '−' : '') + groupVi(i) + (f ? ',' + f : '')
}

// Số tiền đầy đủ: 488.000.000
export function fmtVnd(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  const str = String(v)
  const neg = str.startsWith('-')
  const digits = neg ? str.slice(1) : str
  const [i] = digits.split('.')
  return (neg ? '−' : '') + groupVi(i)
}

// Số tiền gọn: 488 triệu, 2,48 tỷ
export function fmtVndShort(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 1e9) return `${sign}${fmtNumber(a / 1e9, a >= 1e11 ? 0 : 2)} tỷ`
  if (a >= 1e6) return `${sign}${fmtNumber(a / 1e6, a >= 1e8 ? 0 : 2)} triệu`
  return `${sign}${fmtNumber(a, 0)}`
}

// Tỷ lệ dạng phân số (0.00976) → "0,98%"
export function fmtPct(frac: string | number | null | undefined, dp = 2): string {
  if (frac === null || frac === undefined || frac === '') return 'không xác định'
  return `${fmtNumber(Number(frac) * 100, dp)}%`
}

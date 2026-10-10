import Decimal from 'decimal.js'

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export const D = (v: Decimal.Value | undefined | null): Decimal => new Decimal(v ?? 0)
export const ZERO = new Decimal(0)
export const ONE = new Decimal(1)
export { Decimal }

export const sum = (xs: Decimal[]): Decimal => xs.reduce((a, b) => a.plus(b), ZERO)
// Làm tròn tới đồng ở bước cuối (NFR-05)
export const vnd = (x: Decimal): string => x.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)
export const s = (x: Decimal, dp = 10): string => x.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toString()

export function monthIndex(date: string): number {
  const [y, m] = date.split('-').map(Number)
  return y * 12 + (m - 1)
}
export function monthsBetween(from: string, to: string): number {
  return monthIndex(to) - monthIndex(from)
}
export function ymOfIndex(idx: number): string {
  const y = Math.floor(idx / 12)
  const m = (idx % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-${String(d ?? 1).padStart(2, '0')}`
}

// Lớp kết nối nguồn giá (FR-207). Mọi adapter dùng chung một giao diện; thêm nguồn mới không cần sửa M6.
import type { Currency } from '../shared/catalog'
import type { PropertyDetail } from '../shared/types'

export interface PriceRequest {
  key: string
  instrument_id?: string
  market_symbol?: string
  currency: Currency
  property?: PropertyDetail
  manual?: { price: string; valuation_date: string }
}

export interface Bar { date: string; price: string; source_ref: string; valuation_date?: string; range?: [string, string] }

export interface AdapterContext {
  mode: 'sample' | 'live'
  env: Record<string, string | undefined>
  agreements: Record<string, string | undefined> // adapter id → agreement_ref (ConfigVersion)
  fetchFn: typeof fetch
  logOutbound: (adapter: string, payload: unknown) => void
  logEvent: (adapter: string, message: string) => void
}

export interface PriceAdapter {
  id: 'TCBS_STOCK' | 'TCBS_BOND' | 'ONEMOUNT' | 'SAMPLE' | 'MANUAL'
  label: string
  // Lịch sử giá trong [from, to] cho từng khóa; ném lỗi nếu cả nguồn lỗi
  history(reqs: PriceRequest[], from: string, to: string, ctx: AdapterContext): Promise<Record<string, Bar[]>>
}

export class AdapterRefused extends Error {}

export function sourceLabel(id: PriceAdapter['id'], mode: 'sample' | 'live'): string {
  const base: Record<string, string> = { TCBS_STOCK: 'TCBS', TCBS_BOND: 'TCBS', ONEMOUNT: 'One Mount', SAMPLE: 'Mẫu', MANUAL: 'Thủ công' }
  if (id === 'SAMPLE' || id === 'MANUAL') return base[id]
  return mode === 'sample' ? `${base[id]} (mẫu)` : base[id]
}

// FR-209: adapter live chỉ chạy khi có thông tin truy cập và mã thỏa thuận dữ liệu
export function requireLive(id: string, ctx: AdapterContext, envKeys: string[]): void {
  const missing = envKeys.filter(k => !ctx.env[k])
  if (missing.length || !ctx.agreements[id]) {
    const msg = `Adapter ${id} từ chối chạy live: ${missing.length ? 'thiếu biến môi trường ' + missing.join(', ') : ''}${!ctx.agreements[id] ? ' thiếu agreement_ref' : ''}`.trim()
    ctx.logEvent(id, msg)
    throw new AdapterRefused(msg)
  }
}

// NFR-17: chờ tối đa 10 giây, thử lại tối đa 2 lần
export async function fetchWithRetry(ctx: AdapterContext, url: string, init: RequestInit, retries = 2): Promise<Response> {
  let last: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 10_000)
      try {
        const res = await ctx.fetchFn(url, { ...init, signal: ctrl.signal })
        if (res.ok) return res
        last = new Error(`HTTP ${res.status}`)
      } finally { clearTimeout(timer) }
    } catch (e) { last = e }
  }
  throw last
}

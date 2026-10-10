// Năm adapter: TCBS cổ phiếu, TCBS trái phiếu, One Mount (định giá bất động sản), Mẫu, Thủ công.
// Chế độ sample đọc file mẫu đặt theo cấu trúc dữ liệu của nguồn; chế độ live chỉ chạy khi có thỏa thuận (FR-209).
import type { PropertyDetail } from '../shared/types'
import { requireLive, fetchWithRetry, type AdapterContext, type Bar, type PriceAdapter, type PriceRequest } from './base'

export interface SampleStore {
  tcbsStocks: { _note: string; data: Record<string, { tradingDate: string; open: number; high: number; low: number; close: number; volume: number }[]> }
  tcbsBonds: { _note: string; data: Record<string, { tradingDate: string; cleanPrice: number; dirtyPrice: number }[]> }
  onemount: { _note: string; valuations: { request: OneMountRequest; result: { price: number; priceMin: number; priceMax: number; valuationDate: string; modelVersion: string } }[] }
  sample: { _note: string; series: Record<string, { date: string; value: number }[]> }
}

// BR-22: gói gửi tới One Mount chỉ gồm thuộc tính tài sản
export interface OneMountRequest { project: string; building?: string; floor?: number; unit?: string; area_m2: string; bedrooms?: number }
export function oneMountPayload(p: PropertyDetail): OneMountRequest {
  return { project: p.project, building: p.building, floor: p.floor, unit: p.unit, area_m2: p.area_m2, bedrooms: p.bedrooms }
}
// BR-22: gói gửi tới TCBS chỉ gồm mã thị trường và ngày
export function tcbsPayload(symbol: string, from: string, to: string) { return { symbol, from, to } }

const inRange = (d: string, from: string, to: string) => d >= from && d <= to

export function makeAdapters(store: SampleStore): Record<PriceAdapter['id'], PriceAdapter> {
  const tcbsStock: PriceAdapter = {
    id: 'TCBS_STOCK', label: 'TCBS – cổ phiếu',
    async history(reqs, from, to, ctx) {
      const out: Record<string, Bar[]> = {}
      if (ctx.mode === 'sample') {
        for (const r of reqs) out[r.key] = (store.tcbsStocks.data[r.instrument_id!] ?? []).filter(b => inRange(b.tradingDate, from, to)).map(b => ({ date: b.tradingDate, price: String(b.close), source_ref: r.instrument_id! }))
        return out
      }
      requireLive('TCBS_STOCK', ctx, ['TCBS_BASE_URL', 'TCBS_TOKEN'])
      for (const r of reqs) {
        const symbol = r.market_symbol
        if (!symbol) { ctx.logEvent('TCBS_STOCK', `Không có mã thị trường cho ${r.instrument_id} trong bảng ánh xạ`); out[r.key] = []; continue }
        const payload = tcbsPayload(symbol, from, to)
        ctx.logOutbound('TCBS_STOCK', payload)
        try {
          const res = await fetchWithRetry(ctx, `${ctx.env.TCBS_BASE_URL}/stock-prices?${new URLSearchParams(payload)}`, { headers: { Authorization: `Bearer ${ctx.env.TCBS_TOKEN}` } })
          const j = await res.json() as { data: { tradingDate: string; close: number }[] }
          out[r.key] = j.data.map(b => ({ date: b.tradingDate.slice(0, 10), price: String(b.close), source_ref: symbol }))
        } catch (e) { ctx.logEvent('TCBS_STOCK', `Lỗi lấy giá ${symbol}: ${String(e)}`); throw e }
      }
      return out
    },
  }
  const tcbsBond: PriceAdapter = {
    id: 'TCBS_BOND', label: 'TCBS – trái phiếu',
    async history(reqs, from, to, ctx) {
      const out: Record<string, Bar[]> = {}
      if (ctx.mode === 'sample') {
        for (const r of reqs) out[r.key] = (store.tcbsBonds.data[r.instrument_id!] ?? []).filter(b => inRange(b.tradingDate, from, to)).map(b => ({ date: b.tradingDate, price: String(b.cleanPrice), source_ref: r.instrument_id! }))
        return out
      }
      requireLive('TCBS_BOND', ctx, ['TCBS_BASE_URL', 'TCBS_TOKEN'])
      for (const r of reqs) {
        const symbol = r.market_symbol
        if (!symbol) { out[r.key] = []; continue }
        const payload = tcbsPayload(symbol, from, to)
        ctx.logOutbound('TCBS_BOND', payload)
        const res = await fetchWithRetry(ctx, `${ctx.env.TCBS_BASE_URL}/bond-prices?${new URLSearchParams(payload)}`, { headers: { Authorization: `Bearer ${ctx.env.TCBS_TOKEN}` } })
        const j = await res.json() as { data: { tradingDate: string; cleanPrice: number }[] }
        out[r.key] = j.data.map(b => ({ date: b.tradingDate.slice(0, 10), price: String(b.cleanPrice), source_ref: symbol }))
      }
      return out
    },
  }
  const oneMount: PriceAdapter = {
    id: 'ONEMOUNT', label: 'One Mount – định giá OneHousing',
    async history(reqs, _from, to, ctx) {
      const out: Record<string, Bar[]> = {}
      for (const r of reqs) {
        // FR-212: chỉ gọi cho tài sản được hỗ trợ
        if (!r.property || !r.property.supported) { out[r.key] = []; continue }
        const payload = oneMountPayload(r.property)
        if (ctx.mode === 'sample') {
          const hit = store.onemount.valuations.find(v => v.request.project === payload.project && v.request.building === payload.building && v.request.unit === payload.unit)
          out[r.key] = hit && hit.result.valuationDate <= to ? [{ date: to, price: String(hit.result.price), source_ref: `${payload.project}/${payload.building}/${payload.unit}`, valuation_date: hit.result.valuationDate, range: [String(hit.result.priceMin), String(hit.result.priceMax)] }] : []
          continue
        }
        requireLive('ONEMOUNT', ctx, ['ONEMOUNT_BASE_URL', 'ONEMOUNT_API_KEY'])
        ctx.logOutbound('ONEMOUNT', payload)
        const res = await fetchWithRetry(ctx, `${ctx.env.ONEMOUNT_BASE_URL}/avm/valuations`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': ctx.env.ONEMOUNT_API_KEY! }, body: JSON.stringify(payload) })
        const j = await res.json() as { price: number; price_min?: number; price_max?: number; valuation_date: string; model_version?: string }
        out[r.key] = [{ date: to, price: String(j.price), source_ref: j.model_version ?? 'onemount', valuation_date: j.valuation_date, range: j.price_min ? [String(j.price_min), String(j.price_max)] : undefined }]
      }
      return out
    },
  }
  const sample: PriceAdapter = {
    id: 'SAMPLE', label: 'Mẫu',
    async history(reqs, from, to) {
      const out: Record<string, Bar[]> = {}
      for (const r of reqs) out[r.key] = (store.sample.series[r.key] ?? []).filter(b => inRange(b.date, from, to)).map(b => ({ date: b.date, price: String(b.value), source_ref: r.key }))
      return out
    },
  }
  const manual: PriceAdapter = {
    id: 'MANUAL', label: 'Thủ công',
    async history(reqs, _from, to) {
      const out: Record<string, Bar[]> = {}
      for (const r of reqs) out[r.key] = r.manual && r.manual.valuation_date <= to ? [{ date: to, price: r.manual.price, source_ref: 'nhập tay', valuation_date: r.manual.valuation_date }] : []
      return out
    },
  }
  return { TCBS_STOCK: tcbsStock, TCBS_BOND: tcbsBond, ONEMOUNT: oneMount, SAMPLE: sample, MANUAL: manual }
}

export type { AdapterContext, PriceRequest }

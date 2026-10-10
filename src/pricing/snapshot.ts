// Chọn nguồn theo loại tài sản và dự phòng (BR-21), chụp ảnh giá (FR-211).
import { FX_CURRENCIES } from '../shared/catalog'
import type { Family, Instrument, PricePoint, PriceSnapshot } from '../shared/types'
import { hashOf } from '../engine/hash'
import { sourceLabel, type AdapterContext, type Bar, type PriceAdapter, type PriceRequest } from './base'

export interface AdapterStatus { id: string; label: string; requested: number; ok: number; fallback: number; missing: number; error?: string; refused?: boolean; last_fetch: string }

export interface LoadOptions {
  price_date: string
  instruments: Record<string, Instrument>
  families: Family[]
  adapters: Record<PriceAdapter['id'], PriceAdapter>
  ctx: AdapterContext
  sessions: string[] // các phiên giao dịch, tăng dần
  stored?: Record<string, Bar[]> // lịch sử đã lưu, dùng khi nguồn chính lỗi
  maxSessions?: number
  now?: string
  snapshotId: string
}

interface Routed { adapter: PriceAdapter['id']; req: PriceRequest; fallbackManual?: PriceRequest['manual']; isFx?: boolean }

export function routeRequests(opts: Pick<LoadOptions, 'instruments' | 'families'>): Routed[] {
  const out: Routed[] = []
  const seen = new Set<string>()
  for (const inst of Object.values(opts.instruments)) {
    if (inst.price_source === 'FIXED' || inst.price_source === 'MANUAL' || inst.price_source === 'ONEMOUNT') continue
    const adapter = inst.price_source === 'TCBS_STOCK' || inst.price_source === 'TCBS_BOND' ? inst.price_source : 'SAMPLE'
    out.push({ adapter, req: { key: inst.id, instrument_id: inst.id, market_symbol: inst.market_symbol, currency: inst.currency } })
    seen.add(inst.id)
  }
  for (const f of opts.families) for (const h of f.holdings) {
    if (!h.price_key || seen.has(h.price_key)) continue
    seen.add(h.price_key)
    const inst = opts.instruments[h.instrument_id]
    const base: PriceRequest = { key: h.price_key, instrument_id: inst.id, currency: inst.currency, property: h.property, manual: h.manual }
    if (h.property?.supported) out.push({ adapter: 'ONEMOUNT', req: base, fallbackManual: h.manual })
    else out.push({ adapter: 'MANUAL', req: base })
  }
  for (const c of FX_CURRENCIES) out.push({ adapter: 'SAMPLE', req: { key: `FX:${c}`, currency: 'VND' }, isFx: true })
  return out
}

export async function loadPriceSnapshot(o: LoadOptions): Promise<{ snapshot: PriceSnapshot; status: AdapterStatus[] }> {
  const max = o.maxSessions ?? 5
  const now = o.now ?? new Date().toISOString()
  const sessions = o.sessions.filter(d => d <= o.price_date)
  const from = sessions.length > max ? sessions[sessions.length - 1 - max] : sessions[0] ?? o.price_date
  const routed = routeRequests(o)
  const points: PricePoint[] = []
  const missing: string[] = [], fallbacks: string[] = []
  const status: AdapterStatus[] = []
  const fx: Record<string, string> = {}

  const byAdapter = new Map<PriceAdapter['id'], Routed[]>()
  for (const r of routed) byAdapter.set(r.adapter, [...(byAdapter.get(r.adapter) ?? []), r])

  for (const [id, rs] of byAdapter) {
    const adapter = o.adapters[id]
    const st: AdapterStatus = { id, label: adapter.label, requested: rs.length, ok: 0, fallback: 0, missing: 0, last_fetch: now }
    let bars: Record<string, Bar[]> = {}
    let failed = false
    try { bars = await adapter.history(rs.map(r => r.req), from, o.price_date, o.ctx) }
    catch (e) { failed = true; st.error = String((e as Error).message ?? e); st.refused = (e as Error).constructor?.name === 'AdapterRefused' }
    for (const r of rs) {
      const label = sourceLabel(id, o.ctx.mode)
      const list = (failed ? [] : bars[r.req.key] ?? []).filter(b => b.date >= from && b.date <= o.price_date).sort((a, b) => a.date.localeCompare(b.date))
      let pick: Bar | undefined = list.find(b => b.date === o.price_date)
      let flag: PricePoint['flag'] = id === 'MANUAL' ? 'manual' : o.ctx.mode === 'sample' ? 'sample' : 'primary'
      let source = label
      if (!pick) {
        // Dự phòng: giá phiên gần nhất trong tối đa `max` phiên trước price_date (từ nguồn hoặc lịch sử đã lưu)
        const hist = (list.length ? list : (o.stored?.[r.req.key] ?? []).filter(b => b.date >= from && b.date <= o.price_date)).sort((a, b) => a.date.localeCompare(b.date))
        const prev = hist.filter(b => b.date < o.price_date || failed).pop()
        if (prev) { pick = prev; flag = 'fallback'; source = `${label} – dự phòng` }
      }
      if (!pick && r.fallbackManual) {
        pick = { date: o.price_date, price: r.fallbackManual.price, source_ref: 'nhập tay', valuation_date: r.fallbackManual.valuation_date }
        flag = 'manual'; source = sourceLabel('MANUAL', o.ctx.mode)
      }
      if (!pick) { missing.push(r.req.key); st.missing++; continue }
      if (flag === 'fallback') { fallbacks.push(r.req.key); st.fallback++ } else st.ok++
      if (r.isFx) { fx[r.req.key.slice(3)] = pick.price; }
      points.push({ key: r.req.key, date: pick.date, price: pick.price, currency: r.req.currency, source, source_ref: pick.source_ref, fetched_at: now, flag, valuation_date: pick.valuation_date, range: pick.range })
    }
    status.push(st)
  }
  points.sort((a, b) => a.key.localeCompare(b.key))
  const body = { price_date: o.price_date, points, fx, missing: missing.sort(), fallbacks: fallbacks.sort() }
  const hash = await hashOf({ ...body, points: points.map(({ fetched_at, ...p }) => p) })
  return { snapshot: { id: o.snapshotId, ...body, hash }, status }
}

export function bookFromSnapshot(s: PriceSnapshot) {
  return { price_date: s.price_date, points: Object.fromEntries(s.points.map(p => [p.key, p])), fx: s.fx }
}

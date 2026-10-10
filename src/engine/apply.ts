// Bộ máy áp dụng (M6): BR-07 đến BR-12. Không gọi LLM.
import { ILLIQUID } from '../shared/catalog'
import type { ImpactLine, UnitConfig, ViewBody } from '../shared/types'
import { D, Decimal, ZERO, sum, vnd, s } from './dec'
import type { Position } from './positions'

export type AlertLevel = 'RED' | 'YELLOW' | 'GREEN' | 'POSITIVE'
export const ALERT_LABELS: Record<AlertLevel, string> = { RED: 'Đỏ', YELLOW: 'Vàng', GREEN: 'Xanh', POSITIVE: 'Tích cực' }

export interface AlertThresholds { red_pct: string; red_abs: string; yellow_pct: string; yellow_abs: string; positive_pct: string; positive_abs: string }

export interface PositionImpact {
  holding_id: string; instrument_id: string; instrument_name: string; part: string | null
  asset_class: string; sector?: string; currency: string
  value_vnd: string; eff_own: string; exposure: string
  line_used: { scope: string; asset_class?: string; target: string; level: number } | null
  rule: 'instrument' | 'sector' | 'asset_class' | 'none'
  u: string; asset_shock: string
  fx_line: { target: string; level: number } | null; u_fx: string; fx_shock: string
  asset_impact: string; fx_impact: string; impact: string
}

export interface FamilyImpactResult {
  family_id: string; impact: string; net_worth: string; pct: string | null
  alert: AlertLevel; illiquid_impact: string
  by_asset_class: Record<string, string>; by_fx: Record<string, string>; by_instrument: Record<string, string>
  top_instruments: { instrument_id: string; name: string; impact: string }[]
  positions: PositionImpact[]
}

export function unitFor(p: Pick<Position, 'asset_class' | 'gov_tenor'>, cfg: UnitConfig): Decimal {
  if (p.asset_class === 'GOV_BOND') return D(cfg.u[p.gov_tenor === 'short' ? 'GOV_BOND_SHORT' : 'GOV_BOND_LONG'])
  return D(cfg.u[p.asset_class] ?? 0)
}

// BR-08: dòng mã > dòng ngành (cùng loại tài sản) > dòng loại tài sản
export function selectLine(view: ViewBody, p: Pick<Position, 'instrument_id' | 'asset_class' | 'sector'>): { line: ImpactLine | null; rule: PositionImpact['rule'] } {
  const inst = view.impacts.find(l => l.scope === 'instrument' && l.target === p.instrument_id)
  if (inst) return { line: inst, rule: 'instrument' }
  if (p.sector) {
    const sec = view.impacts.find(l => l.scope === 'sector' && l.asset_class === p.asset_class && l.target === p.sector)
    if (sec) return { line: sec, rule: 'sector' }
  }
  const ac = view.impacts.find(l => l.scope === 'asset_class' && l.target === p.asset_class)
  if (ac) return { line: ac, rule: 'asset_class' }
  return { line: null, rule: 'none' }
}

export function alertLevel(impact: Decimal, pct: Decimal | null, t: AlertThresholds): AlertLevel {
  if (impact.isNegative()) {
    if ((pct && pct.lte(D(t.red_pct))) || impact.lte(D(t.red_abs))) return 'RED'
    if ((pct && pct.lte(D(t.yellow_pct))) || impact.lte(D(t.yellow_abs))) return 'YELLOW'
    return 'GREEN'
  }
  if ((pct && pct.gte(D(t.positive_pct))) || impact.gte(D(t.positive_abs))) return 'POSITIVE'
  return 'GREEN'
}

export function computeFamilyImpact(familyId: string, positions: Position[], netWorth: Decimal, view: ViewBody, cfg: UnitConfig, thresholds: AlertThresholds): FamilyImpactResult {
  const rows: (PositionImpact & { _impact: Decimal; _asset: Decimal; _fx: Decimal })[] = []
  for (const p of positions) {
    const { line, rule } = selectLine(view, p)
    const u = unitFor(p, cfg)
    const assetShock = line ? u.times(line.level) : ZERO
    let fxLine: ImpactLine | undefined
    let uFx = ZERO
    if (p.currency !== 'VND') {
      fxLine = view.impacts.find(l => l.scope === 'fx' && l.target === p.currency)
      uFx = D(cfg.u_fx[p.currency] ?? 0)
    }
    const fxShock = fxLine ? uFx.times(fxLine.level) : ZERO
    const assetImpact = p.exposure.times(assetShock)
    const fxImpact = p.exposure.times(fxShock)
    const impact = assetImpact.plus(fxImpact)
    rows.push({
      holding_id: p.holding_id, instrument_id: p.instrument_id, instrument_name: p.instrument_name, part: p.part,
      asset_class: p.asset_class, sector: p.sector, currency: p.currency,
      value_vnd: vnd(p.value_vnd), eff_own: s(p.eff_own), exposure: vnd(p.exposure),
      line_used: line ? { scope: line.scope, asset_class: line.asset_class, target: line.target, level: line.level } : null,
      rule, u: s(u), asset_shock: s(assetShock),
      fx_line: fxLine ? { target: fxLine.target, level: fxLine.level } : null, u_fx: s(uFx), fx_shock: s(fxShock),
      asset_impact: vnd(assetImpact), fx_impact: vnd(fxImpact), impact: vnd(impact),
      _impact: impact, _asset: assetImpact, _fx: fxImpact,
    })
  }
  const total = sum(rows.map(r => r._impact))
  const pct = netWorth.gt(0) ? total.div(netWorth) : null
  const group = (key: (r: typeof rows[number]) => string | null, val: (r: typeof rows[number]) => Decimal) => {
    const m: Record<string, Decimal> = {}
    for (const r of rows) { const k = key(r); if (k) m[k] = (m[k] ?? ZERO).plus(val(r)) }
    return m
  }
  const byClass = group(r => r.asset_class, r => r._asset)
  const byFx = group(r => r.currency === 'VND' ? null : r.currency, r => r._fx)
  const byInst = group(r => r.instrument_id, r => r._impact)
  const names: Record<string, string> = Object.fromEntries(rows.map(r => [r.instrument_id, r.instrument_name]))
  const top = Object.entries(byInst).filter(([, v]) => !v.isZero())
    .sort((a, b) => b[1].abs().comparedTo(a[1].abs()) || a[0].localeCompare(b[0])).slice(0, 5)
    .map(([id, v]) => ({ instrument_id: id, name: names[id], impact: vnd(v) }))
  const illiquid = sum(rows.filter(r => ILLIQUID.has(r.asset_class as never)).map(r => r._impact))
  const toStr = (m: Record<string, Decimal>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, vnd(v)]))
  return {
    family_id: familyId, impact: vnd(total), net_worth: vnd(netWorth), pct: pct ? s(pct, 12) : null,
    alert: alertLevel(D(vnd(total)), pct, thresholds), illiquid_impact: vnd(illiquid),
    by_asset_class: toStr(byClass), by_fx: toStr(byFx), by_instrument: toStr(byInst), top_instruments: top,
    positions: rows.map(({ _impact, _asset, _fx, ...r }) => r),
  }
}

export function rankFamilies(results: FamilyImpactResult[]): FamilyImpactResult[] {
  return [...results].sort((a, b) => D(b.impact).abs().comparedTo(D(a.impact).abs()) || a.family_id.localeCompare(b.family_id))
}

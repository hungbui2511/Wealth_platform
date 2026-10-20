// Phơi nhiễm hợp nhất (BR-09, FR-105, FR-107): tỷ lệ sở hữu hiệu dụng và nhìn xuyên quỹ.
import type { AssetClass, Currency, Sector } from '../shared/catalog'
import type { Family, Holding, Instrument, PricePoint } from '../shared/types'
import { D, Decimal, ZERO, sum, monthsBetween } from './dec'

export interface PriceBook {
  price_date: string
  points: Record<string, PricePoint>
  fx: Record<string, string> // USD -> "25000"; VND -> "1"
}

export interface Position {
  family_id: string; holding_id: string; account_id: string; instrument_id: string; instrument_name: string
  part: string | null // null = vị thế trực tiếp; nếu là quỹ: chỉ số phần phân bổ
  asset_class: AssetClass; sector?: Sector; currency: Currency
  gov_tenor?: 'short' | 'long'
  quantity: Decimal; price: Decimal | null; price_point: PricePoint | null
  value_native: Decimal; fx_rate: Decimal; value_vnd: Decimal
  weight: Decimal // tỷ trọng phần quỹ (1 với vị thế trực tiếp)
  eff_own: Decimal; exposure: Decimal
  listed: boolean; missing_price: boolean
}

// Tỷ lệ gia đình sở hữu một pháp nhân, nhìn xuyên nhiều tầng: phần do thành viên giữ trực tiếp cộng phần qua pháp nhân mẹ.
// Chặn vòng sở hữu chéo và độ sâu quá 6 tầng (trả về phần đã tính được, không lặp vô hạn).
export const MAX_OWNERSHIP_DEPTH = 6
export function entityFamilyShare(f: Family, entityId: string, seen: ReadonlySet<string> = new Set(), depth = 0): Decimal {
  if (seen.has(entityId) || depth > MAX_OWNERSHIP_DEPTH) return ZERO
  const next = new Set(seen); next.add(entityId)
  return sum(f.ownerships.filter(o => o.entity_id === entityId).map(o => {
    if (o.owner_entity_id) return D(o.pct).times(entityFamilyShare(f, o.owner_entity_id, next, depth + 1))
    return o.member_id && f.members.some(m => m.id === o.member_id) ? D(o.pct) : ZERO
  }))
}

// Lỗi cấu trúc sở hữu: vòng sở hữu chéo, vượt độ sâu, tổng tỷ lệ một pháp nhân vượt 100%
export function ownershipIssues(f: Family): string[] {
  const out: string[] = []
  const parents = (id: string) => f.ownerships.filter(o => o.entity_id === id && o.owner_entity_id).map(o => o.owner_entity_id!)
  for (const e of f.entities) {
    const tot = sum(f.ownerships.filter(o => o.entity_id === e.id).map(o => D(o.pct)))
    if (tot.gt(1)) out.push(`${e.name}: tổng tỷ lệ sở hữu ${tot.times(100).toFixed(1)}% vượt 100%`)
    const stack: { id: string; path: string[] }[] = parents(e.id).map(p => ({ id: p, path: [e.id] }))
    while (stack.length) {
      const { id, path } = stack.pop()!
      if (id === e.id) { out.push(`${e.name}: sở hữu vòng tròn qua ${path.join(' → ')}`); break }
      if (path.length > MAX_OWNERSHIP_DEPTH) { out.push(`${e.name}: chuỗi sở hữu vượt ${MAX_OWNERSHIP_DEPTH} tầng`); break }
      if (path.includes(id)) continue
      for (const p of parents(id)) stack.push({ id: p, path: [...path, id] })
    }
  }
  return [...new Set(out)]
}

export function ownerShare(f: Family, kind: 'member' | 'entity' | 'account', id: string): Decimal {
  if (kind === 'member') return f.members.some(m => m.id === id) ? D(1) : ZERO
  if (kind === 'entity') return entityFamilyShare(f, id)
  return accountEffOwn(f, id)
}

// Tỷ lệ sở hữu hiệu dụng của một tài khoản = Σ chủ sở hữu (BR-09)
export function accountEffOwn(f: Family, accountId: string): Decimal {
  const acc = f.accounts.find(a => a.id === accountId)
  if (!acc) return ZERO
  return sum(acc.owners.map(o => o.kind === 'member'
    ? (f.members.some(m => m.id === o.id) ? D(o.pct) : ZERO)
    : D(o.pct).times(entityFamilyShare(f, o.id))))
}

export const priceKey = (h: Holding) => h.price_key ?? h.instrument_id

export function fxRate(book: PriceBook, ccy: string): Decimal {
  if (ccy === 'VND') return D(1)
  const r = book.fx[ccy]
  if (r === undefined) throw new Error(`Thiếu tỷ giá ${ccy}/VND tại ${book.price_date}`)
  return D(r)
}

export function govTenor(inst: Instrument, priceDate: string): 'short' | 'long' {
  if (!inst.bond) return 'long'
  return monthsBetween(priceDate, inst.bond.maturity) <= 36 ? 'short' : 'long'
}

export function buildPositions(f: Family, instruments: Record<string, Instrument>, book: PriceBook): Position[] {
  const out: Position[] = []
  for (const h of f.holdings) {
    const inst = instruments[h.instrument_id]
    if (!inst) throw new Error(`Không có công cụ ${h.instrument_id}`)
    const pp = inst.price_source === 'FIXED' ? null : book.points[priceKey(h)] ?? null
    const price = inst.price_source === 'FIXED' ? D(1) : pp ? D(pp.price) : null
    const qty = D(h.quantity)
    const valueNative = price ? qty.times(price) : ZERO
    const fx = fxRate(book, inst.currency)
    const valueVnd = valueNative.times(fx)
    const eff = accountEffOwn(f, h.account_id)
    const base = {
      family_id: f.id, holding_id: h.id, account_id: h.account_id, instrument_id: inst.id, instrument_name: inst.name,
      currency: inst.currency, quantity: qty, price, price_point: pp, fx_rate: fx, eff_own: eff,
      listed: inst.listed, missing_price: price === null,
    }
    if (inst.allocations && inst.allocations.length > 0) {
      inst.allocations.forEach((a, i) => {
        const w = D(a.weight)
        out.push({
          ...base, part: String(i), asset_class: a.asset_class, sector: a.sector,
          gov_tenor: a.asset_class === 'GOV_BOND' ? (a.tenor ?? 'long') : undefined,
          weight: w, value_native: valueNative.times(w), value_vnd: valueVnd.times(w), exposure: valueVnd.times(w).times(eff),
        })
      })
    } else {
      out.push({
        ...base, part: null, asset_class: inst.asset_class, sector: inst.sector,
        gov_tenor: inst.asset_class === 'GOV_BOND' ? govTenor(inst, book.price_date) : undefined,
        weight: D(1), value_native: valueNative, value_vnd: valueVnd, exposure: valueVnd.times(eff),
      })
    }
  }
  return out
}

export function liabilityExposure(f: Family, book: PriceBook): { id: string; name: string; balance_vnd: Decimal; eff: Decimal; exposure: Decimal; currency: string }[] {
  return f.liabilities.map(l => {
    const eff = ownerShare(f, l.borrower.kind, l.borrower.id)
    const bal = D(l.balance).times(fxRate(book, l.currency))
    return { id: l.id, name: l.name, balance_vnd: bal, eff, exposure: bal.times(eff), currency: l.currency }
  })
}

export interface FamilyOverview {
  total_assets: Decimal; total_liabilities: Decimal; net_worth: Decimal
  by_asset_class: Record<string, Decimal>; by_currency: Record<string, Decimal>
  by_member: Record<string, Decimal>; by_entity: Record<string, Decimal>
}

// Tổng quan gia đình (FR-103). Phân bổ theo thành viên/pháp nhân dựa trên chủ sở hữu trực tiếp của tài khoản;
// phần pháp nhân được chia tiếp cho thành viên theo tỷ lệ sở hữu pháp nhân để tổng khớp.
export function overview(f: Family, positions: Position[], book: PriceBook): FamilyOverview {
  const add = (m: Record<string, Decimal>, k: string, v: Decimal) => { m[k] = (m[k] ?? ZERO).plus(v) }
  const byClass: Record<string, Decimal> = {}, byCcy: Record<string, Decimal> = {}
  const byMember: Record<string, Decimal> = {}, byEntity: Record<string, Decimal> = {}
  for (const p of positions) {
    add(byClass, p.asset_class, p.exposure)
    add(byCcy, p.currency, p.exposure)
    const acc = f.accounts.find(a => a.id === p.account_id)!
    for (const o of acc.owners) {
      if (o.kind === 'member') add(byMember, o.id, p.value_vnd.times(D(o.pct)))
      else {
        const viaEntity = p.value_vnd.times(D(o.pct)).times(entityFamilyShare(f, o.id))
        add(byEntity, o.id, viaEntity)
      }
    }
  }
  const liab = liabilityExposure(f, book)
  const totalAssets = sum(positions.map(p => p.exposure))
  const totalLiab = sum(liab.map(l => l.exposure))
  return { total_assets: totalAssets, total_liabilities: totalLiab, net_worth: totalAssets.minus(totalLiab), by_asset_class: byClass, by_currency: byCcy, by_member: byMember, by_entity: byEntity }
}

export function netWorth(f: Family, positions: Position[], book: PriceBook): Decimal {
  return sum(positions.map(p => p.exposure)).minus(sum(liabilityExposure(f, book).map(l => l.exposure)))
}

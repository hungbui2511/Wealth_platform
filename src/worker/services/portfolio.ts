// Bản đồ tài sản (M1), ảnh chụp giá (FR-211), lãi/lỗ (BR-19/20), dòng tiền (BR-18/23).
import type { Family, Goal, Instrument, PriceSnapshot } from '../../shared/types'
import { SAMPLE_STORE, SESSIONS, PRICE_DATE } from '../../data/seed'
import { makeAdapters } from '../../pricing/adapters'
import { loadPriceSnapshot, bookFromSnapshot, type AdapterStatus } from '../../pricing/snapshot'
import type { Bar, PriceAdapter } from '../../pricing/base'
import { buildPositions, overview, liabilityExposure, netWorth, type PriceBook, type Position } from '../../engine/positions'
import { holdingPnl, summarize, aggregatePnl } from '../../engine/pnl'
import { shortTerm, longTerm } from '../../engine/cashflow'
import { goalCoverage } from '../../engine/goals'
import { vnd } from '../../engine/dec'
import { actor, assertFamily, HttpError, minReason, requireRole, type AppCtx } from '../ctx'
import { activeConfig, loadConfigs } from './config'

export { PRICE_DATE }

export async function loadInstruments(ctx: AppCtx): Promise<Record<string, Instrument>> {
  const list = await ctx.repo.list<Instrument>('instruments')
  return Object.fromEntries(list.map(i => [i.id, i]))
}
export async function loadFamilies(ctx: AppCtx): Promise<Family[]> {
  const fams = await ctx.repo.list<Family>('families', '', [], 'id')
  return fams
}
export async function loadFamily(ctx: AppCtx, id: string): Promise<Family> {
  assertFamily(ctx, id)
  const f = await ctx.repo.get<Family>('families', id)
  if (!f) throw new HttpError(404, `Không có gia đình ${id}`)
  return f
}
export async function loadGoals(ctx: AppCtx, familyId?: string): Promise<Goal[]> {
  return familyId ? ctx.repo.list<Goal>('goals', 'family_id = ?', [familyId], 'id') : ctx.repo.list<Goal>('goals', '', [], 'id')
}

export interface SnapshotRecord extends PriceSnapshot {
  created_at: string; status: AdapterStatus[]; mode: string
  // Giá do AI lấy (external) phải được người xác nhận trước khi dùng cho lần áp dụng và màn hình gia đình
  confirmation?: { required: boolean; status: 'PENDING' | 'CONFIRMED' | 'REJECTED'; by?: string; at?: string; note?: string }
}
export const snapshotUsable = (s: SnapshotRecord) => !s.confirmation?.required || s.confirmation.status === 'CONFIRMED'

// Tải giá qua lớp adapter, chụp ảnh và lưu lịch sử giá để làm dự phòng khi nguồn lỗi
export async function createPriceSnapshot(ctx: AppCtx, opts: { adapters?: Record<PriceAdapter['id'], PriceAdapter>; priceDate?: string } = {}): Promise<SnapshotRecord> {
  const priceDate = opts.priceDate ?? PRICE_DATE
  const [instruments, families] = await Promise.all([loadInstruments(ctx), ctx.repo.list<Family>('families')])
  const src = await activeConfig<{ agreements: Record<string, string | null> }>(ctx, 'PRICE_SOURCE')
  // Cơ sở dữ liệu nạp trước khi có loại cấu hình này: coi như chưa xác nhận
  const omConfirmed = await activeConfig<{ confirmed: boolean }>(ctx, 'ONEMOUNT_CONFIRM').then(c => c.content.confirmed === true, () => false)
  const symbolMap = (await activeConfig<Record<string, string>>(ctx, 'SYMBOL_MAP')).content
  for (const [id, sym] of Object.entries(symbolMap)) if (instruments[id]) instruments[id] = { ...instruments[id], market_symbol: sym }
  const stored: Record<string, Bar[]> = {}
  for (const p of await ctx.repo.list<{ key: string; date: string; price: string; source_ref: string }>('price_points')) (stored[p.key] ??= []).push({ date: p.date, price: p.price, source_ref: p.source_ref })
  const seq = await ctx.repo.nextSeq(`PS-${priceDate}`)
  const uow = ctx.uow()
  const agreements = { ...src.content.agreements } as Record<string, string | undefined>
  // BR-22: One Mount live chỉ bật khi Tuân thủ đã xác nhận căn cứ chia sẻ dữ liệu
  if (!omConfirmed) agreements.ONEMOUNT = undefined
  const { snapshot, status } = await loadPriceSnapshot({
    price_date: priceDate, instruments, families, adapters: opts.adapters ?? makeAdapters(SAMPLE_STORE),
    ctx: {
      mode: ctx.priceMode, env: ctx.env as Record<string, string | undefined>, agreements, fetchFn: ctx.fetchFn,
      logOutbound: (adapter, payload) => uow.audit({ actor: 'SYSTEM:pricing', action: 'pricing.outbound', object: adapter, data: payload }),
      logEvent: (adapter, message) => uow.audit({ actor: 'SYSTEM:pricing', action: 'pricing.adapter_event', object: adapter, data: { message } }),
    },
    sessions: SESSIONS, stored, snapshotId: `PS-${priceDate.replace(/-/g, '')}-${seq}`, now: ctx.now(),
  })
  const rec: SnapshotRecord = { ...snapshot, created_at: ctx.now(), status, mode: ctx.priceMode }
  uow.put('price_snapshots', rec as never)
  for (const p of snapshot.points) if (p.flag !== 'fallback') uow.put('price_points', { id: `${p.key}|${p.date}`, key: p.key, date: p.date, price: p.price, source_ref: p.source_ref ?? '' } as never)
  uow.audit({ actor: actor(ctx), action: 'pricing.snapshot', object: rec.id, data: { price_date: priceDate, hash: rec.hash, missing: rec.missing, fallbacks: rec.fallbacks, status } })
  await uow.commit()
  return rec
}

// Ảnh chụp giá mới nhất: giá thật do Claude đẩy lên (ngày giá mới) hoặc giá mẫu ngày PRICE_DATE
// Ảnh chụp mới nhất đã dùng được (không tính ảnh chụp giá AI đang chờ hoặc đã bị từ chối xác nhận)
export async function currentSnapshot(ctx: AppCtx): Promise<SnapshotRecord> {
  const rows = await ctx.repo.list<SnapshotRecord>('price_snapshots', '', [], 'created_at DESC, id DESC')
  return rows.find(snapshotUsable) ?? createPriceSnapshot(ctx)
}
export async function pendingSnapshots(ctx: AppCtx) {
  const rows = await ctx.repo.list<SnapshotRecord>('price_snapshots', '', [], 'created_at DESC, id DESC')
  return rows.filter(s => s.confirmation?.required && s.confirmation.status === 'PENDING')
}
export async function confirmSnapshot(ctx: AppCtx, id: string, body: { decision?: string; note?: string }) {
  requireRole(ctx, 'CIO', 'COMPLIANCE')
  const s = await snapshotById(ctx, id)
  if (!s.confirmation?.required || s.confirmation.status !== 'PENDING') throw new HttpError(409, 'Ảnh chụp không chờ xác nhận')
  const ok = body.decision === 'confirm'
  if (!ok && body.decision !== 'reject') throw new HttpError(422, 'decision phải là confirm hoặc reject')
  const note = minReason(body.note, ok ? 'Ghi chú đối soát' : 'Lý do từ chối')
  const ns: SnapshotRecord = { ...s, confirmation: { required: true, status: ok ? 'CONFIRMED' : 'REJECTED', by: actor(ctx), at: ctx.now(), note } }
  const u = ctx.uow(); u.put('price_snapshots', ns as never); u.audit({ actor: actor(ctx), action: ok ? 'pricing.snapshot_confirmed' : 'pricing.snapshot_rejected', object: id, data: { note, external_points: s.points.filter(p => p.flag === 'external_ai').map(p => ({ key: p.key, price: p.price, date: p.date, source: p.source })) } }); await u.commit()
  return ns
}
export async function snapshotById(ctx: AppCtx, id: string): Promise<SnapshotRecord> {
  const s = await ctx.repo.get<SnapshotRecord>('price_snapshots', id)
  if (!s) throw new HttpError(404, `Không có ảnh chụp giá ${id}`)
  return s
}

const ser = (p: Position) => ({
  holding_id: p.holding_id, account_id: p.account_id, instrument_id: p.instrument_id, name: p.instrument_name, part: p.part,
  asset_class: p.asset_class, sector: p.sector, currency: p.currency, quantity: p.quantity.toString(),
  price: p.price?.toString() ?? null, value_native: p.value_native.toString(), fx_rate: p.fx_rate.toString(), value_vnd: vnd(p.value_vnd),
  eff_own: p.eff_own.toString(), exposure: vnd(p.exposure), weight: p.weight.toString(),
  price_source: p.price_point?.source ?? (p.price ? 'Cố định (tiền gửi)' : null), price_date: p.price_point?.date ?? null,
  price_flag: p.price_point?.flag ?? null, valuation_date: p.price_point?.valuation_date ?? null, range: p.price_point?.range ?? null, missing_price: p.missing_price,
})

export async function familyOverview(ctx: AppCtx, id: string) {
  const [f, instruments, snap] = await Promise.all([loadFamily(ctx, id), loadInstruments(ctx), currentSnapshot(ctx)])
  const book = bookFromSnapshot(snap)
  const pos = buildPositions(f, instruments, book)
  const o = overview(f, pos, book)
  const s = (m: Record<string, { toString(): string }>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, vnd(v as never)]))
  return {
    family: { id: f.id, name: f.name, rm_id: f.rm_id, persona: f.persona, members: f.members, entities: f.entities, ownerships: f.ownerships, accounts: f.accounts },
    price_date: book.price_date, snapshot_id: snap.id, fx: book.fx,
    totals: { total_assets: vnd(o.total_assets), total_liabilities: vnd(o.total_liabilities), net_worth: vnd(o.net_worth) },
    by_asset_class: s(o.by_asset_class), by_currency: s(o.by_currency), by_member: s(o.by_member), by_entity: s(o.by_entity),
    positions: pos.map(ser),
    liabilities: liabilityExposure(f, book).map(l => ({ id: l.id, name: l.name, currency: l.currency, balance_vnd: vnd(l.balance_vnd), eff_own: l.eff.toString(), exposure: vnd(l.exposure), detail: f.liabilities.find(x => x.id === l.id) })),
  }
}

export async function familyPnl(ctx: AppCtx, id: string) {
  const [f, instruments, snap] = await Promise.all([loadFamily(ctx, id), loadInstruments(ctx), currentSnapshot(ctx)])
  const book = bookFromSnapshot(snap)
  const rows = holdingPnl(f, instruments, book)
  const memberOf = (accId: string) => f.accounts.find(a => a.id === accId)?.owners.map(o => o.id).join('+') ?? ''
  return {
    price_date: book.price_date, snapshot_id: snap.id, rows,
    total: summarize(rows),
    by_asset_class: aggregatePnl(rows, r => r.asset_class),
    by_owner: aggregatePnl(rows, r => memberOf(r.account_id)),
    transactions: f.transactions,
  }
}

export interface CashflowFilter { member?: string; entity?: string }
export async function familyCashflow(ctx: AppCtx, id: string, filter: CashflowFilter = {}) {
  const [f, instruments, snap, cfg] = await Promise.all([loadFamily(ctx, id), loadInstruments(ctx), currentSnapshot(ctx), loadConfigs(ctx)])
  const book = bookFromSnapshot(snap)
  const pos = buildPositions(f, instruments, book)
  const goals = await loadGoals(ctx, id)
  let fam = f
  if (filter.member || filter.entity) {
    // Lọc theo chủ thể: giữ khoản của thành viên/pháp nhân đã chọn
    const subj = filter.member ?? filter.entity!
    const accs = new Set(f.accounts.filter(a => a.owners.some(o => o.id === subj)).map(a => a.id))
    fam = { ...f, holdings: f.holdings.filter(h => accs.has(h.account_id)), liabilities: f.liabilities.filter(l => l.borrower.id === subj), cashflows: f.cashflows.filter(c => c.subject.id === subj || (c.subject.kind === 'account' && accs.has(c.subject.id))) }
  }
  const st = shortTerm(fam, instruments, book, filter.member || filter.entity ? buildPositions(fam, instruments, book) : pos, cfg.assumptions.inflation, cfg.thresholds.liquidity)
  const lt = longTerm(f, instruments, book, pos, goals, cfg.assumptions)
  return { price_date: book.price_date, snapshot_id: snap.id, short: st, long: lt, assumptions: cfg.assumptions, assumption_version: cfg.ids.ASSUMPTION }
}

export async function familyGoals(ctx: AppCtx, id: string) {
  const [f, instruments, snap, cfg] = await Promise.all([loadFamily(ctx, id), loadInstruments(ctx), currentSnapshot(ctx), loadConfigs(ctx)])
  const book = bookFromSnapshot(snap)
  const pos = buildPositions(f, instruments, book)
  const goals = await loadGoals(ctx, id)
  const active = goals.filter(g => g.status === 'active')
  const impacts = await ctx.repo.list<Record<string, unknown>>('goal_impacts', 'family_id = ?', [id])
  return {
    price_date: book.price_date, assumptions: cfg.assumptions, thresholds: cfg.thresholds.goals, assumption_version: cfg.ids.ASSUMPTION,
    goals: goals.map(g => ({ goal: g, coverage: g.status === 'active' ? goalCoverage(g, pos, active, cfg.assumptions, book.price_date, cfg.thresholds.goals) : null })),
    holdings: f.holdings.map(h => ({ id: h.id, instrument_id: h.instrument_id, name: instruments[h.instrument_id]?.name, asset_class: instruments[h.instrument_id]?.asset_class })),
    impacts,
  }
}

export function positionsFor(f: Family, instruments: Record<string, Instrument>, book: PriceBook) {
  const pos = buildPositions(f, instruments, book)
  return { pos, nw: netWorth(f, pos, book) }
}

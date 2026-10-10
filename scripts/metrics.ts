// Kiểm tra nhanh các chỉ số của dữ liệu mẫu (không phải kiểm thử chính thức)
import { SEED, SAMPLE_STORE, SESSIONS, PRICE_DATE } from '../src/data/seed'
import { makeAdapters } from '../src/pricing/adapters'
import { loadPriceSnapshot, bookFromSnapshot } from '../src/pricing/snapshot'
import { buildPositions, netWorth, overview } from '../src/engine/positions'
import { shortTerm, longTerm } from '../src/engine/cashflow'
import { goalCoverage } from '../src/engine/goals'
import { DEFAULT_ASSUMPTIONS, DEFAULT_THRESHOLDS } from '../src/shared/catalog'
const inst = Object.fromEntries(SEED.instruments.map(i => [i.id, i]))
const { snapshot } = await loadPriceSnapshot({ price_date: PRICE_DATE, instruments: inst, families: SEED.families, adapters: makeAdapters(SAMPLE_STORE), ctx: { mode: 'sample', env: {}, agreements: {}, fetchFn: fetch, logOutbound() {}, logEvent() {} }, sessions: SESSIONS, snapshotId: 'PS-x' })
console.log('missing', snapshot.missing, 'fallbacks', snapshot.fallbacks, 'fx', snapshot.fx)
const book = bookFromSnapshot(snapshot)
for (const f of SEED.families) {
  const pos = buildPositions(f, inst, book)
  const o = overview(f, pos, book)
  const goals = SEED.goals.filter(g => g.family_id === f.id)
  const st = shortTerm(f, inst, book, pos, DEFAULT_ASSUMPTIONS.inflation, DEFAULT_THRESHOLDS.liquidity)
  const lt = longTerm(f, inst, book, pos, goals, DEFAULT_ASSUMPTIONS)
  const classes = Object.entries(o.by_asset_class).map(([k, v]) => `${k}:${(Number(v) / Number(o.total_assets) * 100).toFixed(0)}`).join(' ')
  console.log(f.id, 'NW', (Number(o.net_worth) / 1e9).toFixed(2), 'tỷ |', classes)
  console.log('   ST net', (Number(st.totals.net) / 1e9).toFixed(2), 'alerts', st.alerts.map(a => a.code + (a.ym ? '@' + a.ym : '')).join(','), '| LT alerts', lt.alerts.map(a => `${a.code}@t${a.t}`).join(','), 'L0', (Number(lt.L0) / 1e9).toFixed(1))
  for (const g of goals) { const c = goalCoverage(g, pos, goals, DEFAULT_ASSUMPTIONS, PRICE_DATE, DEFAULT_THRESHOLDS.goals); console.log('   goal', g.id, c.ratio ? (Number(c.ratio) * 100).toFixed(2) : '-', c.level) }
}

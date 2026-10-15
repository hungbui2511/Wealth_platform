// Tiêu chí chấp nhận: nguồn giá, lãi/lỗ, dòng tiền, mục tiêu, áp dụng nhập tay, radar chính sách và kiểm soát thông tin
import { beforeAll, describe, expect, it } from 'vitest'
import { harness } from './support/harness'
import { D } from '../src/engine/dec'
import { makeCtx } from '../src/worker/ctx'
import { createPriceSnapshot } from '../src/worker/services/portfolio'
import { makeAdapters, oneMountPayload } from '../src/pricing/adapters'
import { routeRequests } from '../src/pricing/snapshot'
import { AdapterRefused, type PriceAdapter } from '../src/pricing/base'
import { SAMPLE_STORE, SEED, SESSIONS } from '../src/data/seed'
import { exampleView } from './fixtures'
import invalidNews from '../data/seed/events/invalid_news_test.json'

async function boot() {
  const h = harness()
  const r = await h.call(null, 'POST', '/api/bootstrap')
  if (r.status >= 400) throw new Error(JSON.stringify(r.data))
  await h.ok('ADM1', 'POST', '/api/admin/load-sample-events')
  return h
}
const adminCtx = (h: ReturnType<typeof harness>) => makeCtx(h.env, { id: 'ADM1', name: 'Quản trị', role: 'ADMIN', families: [] }, { now: h.now })

describe('Áp dụng nhập tay và ví dụ Mục 6.2 trên dữ liệu mẫu', () => {
  let h: ReturnType<typeof harness>
  beforeAll(async () => { h = await boot() })
  it('AC-05a, AC-06: nhận định JSON nhập tay → 20 gia đình; DEMO-F01 ra −488.000.000, −0,976%, Vàng', async () => {
    const { event_id: _e, view_id: _v, event_type: _t, ...view } = exampleView()
    const r = await h.ok('CIO1', 'POST', '/api/manual-apply', { event_id: 'EV-2026-0002', view })
    const run = await h.ok('CIO1', 'GET', `/api/runs/${r.run_id}`)
    expect(run.impacts).toHaveLength(20)
    const f1 = (await h.ok('CIO1', 'GET', `/api/runs/${r.run_id}/families/DEMO-F01`)).result
    expect(f1.impact).toBe('-488000000')
    expect(D(f1.pct).times(100).toFixed(3)).toBe('-0.976')
    expect(f1.alert).toBe('YELLOW')
    const qcp = f1.positions.filter((p: any) => p.instrument_id === 'VEOF')
    expect(qcp.map((p: any) => [p.rule, p.impact])).toEqual([['asset_class', '-50000000'], ['sector', '-150000000']])
    const v = await h.ok('CIO1', 'GET', `/api/views/${r.view.id}`)
    expect(v.view.manual_bypass).toBe(true)
    expect(v.view.history.map((x: any) => x.to)).toEqual(['DRAFTING', 'PENDING_CHALLENGE', 'PENDING_APPROVAL', 'APPROVED'])
  })
  it('AC-31 (nhận định của ví dụ Mục 6.2): mục tiêu du học 95,87%', async () => {
    const g = await h.ok('RM1', 'GET', '/api/families/DEMO-F01/impacts')
    expect(D(g.goal_impacts[0].ratio_after).times(100).toFixed(2)).toBe('95.87')
  })
  it('AC-25: hai lần áp dụng cùng ảnh chụp giá cho kết quả trùng từng đồng', async () => {
    const { event_id: _e, view_id: _v, event_type: _t, ...view } = exampleView()
    const r2 = await h.ok('CIO1', 'POST', '/api/manual-apply', { event_id: 'EV-2026-0002', view })
    const a = await h.ok('CIO1', 'GET', '/api/runs/AR-0002-v1-1')
    const b = await h.ok('CIO1', 'GET', `/api/runs/${r2.run_id}`)
    expect(b.run.price_snapshot_id).toBe(a.run.price_snapshot_id)
    expect(b.run.ranking).toEqual(a.run.ranking)
  })
})

describe('Lãi/lỗ, dòng tiền, mục tiêu trên dữ liệu mẫu', () => {
  let h: ReturnType<typeof harness>
  beforeAll(async () => { h = await boot() })
  it('AC-21: lãi/lỗ MBB của DEMO-F01 đúng từng đồng', async () => {
    const p = await h.ok('RM1', 'GET', '/api/families/DEMO-F01/pnl')
    const n = p.rows.find((r: any) => r.instrument_id === 'MBB')
    expect([n.realized_vnd, n.unrealized_vnd, n.income_vnd, n.total_vnd]).toEqual(['471620000', '1507280000', '500000000', '2478900000'])
    expect((Number(n.unrealized_pct) * 100).toFixed(2)).toBe('17.75')
  })
  it('AC-22: tách hiệu ứng giá và tỷ giá; tiền gửi USD qua pháp nhân cho phần gia đình 48.000.000', async () => {
    const p17 = await h.ok('RM3', 'GET', '/api/families/DEMO-F17/pnl')
    const g = p17.rows.find((r: any) => r.instrument_id === 'VT')
    expect([g.price_effect_vnd, g.fx_effect_vnd, g.unrealized_vnd]).toEqual(['240000000', '110000000', '350000000'])
    const p1 = await h.ok('RM1', 'GET', '/api/families/DEMO-F01/pnl')
    expect(p1.rows.find((r: any) => r.instrument_id === 'CASH-USD').fx_effect_vnd).toBe('80000000')
    expect(p1.total.fx_effect).toBe('48000000')
  })
  it('FR-120: vị thế thiếu giao dịch mua được loại khỏi tổng và ghi rõ', async () => {
    const p = await h.ok('RM2', 'GET', '/api/families/DEMO-F11/pnl')
    expect(p.rows.find((r: any) => r.instrument_id === 'FPT').insufficient_cost).toBe(true)
    expect(p.total.excluded).toBe(1)
  })
  it('AC-23: dòng tiền 12 tháng của DEMO-F01', async () => {
    const c = await h.ok('RM1', 'GET', '/api/families/DEMO-F01/cashflow')
    // Trái phiếu VHM12613 (5 tỷ, 12,5%/năm, trả lãi 6 tháng/lần): hai kỳ coupon 312,5 triệu; Mục 6.5 của BRD dùng trái phiếu mẫu 9% (1.330 triệu)
    expect(c.short.totals).toEqual({ inflow: '1505000000', outflow: '4115250000', net: '-2610250000' })
    expect(c.short.by_category.find((x: any) => x.category === 'loan_interest').total).toBe('515250000')
    expect(D(c.short.coverage).toFixed(2)).toBe('1.53') // tiền đầu kỳ ÷ |dòng tiền thuần âm|
    const lo = c.short.alerts.filter((a: any) => a.code === 'large_outflow')
    expect(lo.map((a: any) => a.k)).toEqual([5])
  })
  it('AC-24: DEMO-F09 có cash_shortfall mức Đỏ đúng tháng đầu tiên bị âm', async () => {
    const c = await h.ok('RM2', 'GET', '/api/families/DEMO-F09/cashflow')
    const a = c.short.alerts.find((x: any) => x.code === 'cash_shortfall')
    expect(a.level).toBe('RED')
    const first = c.short.months.find((m: any) => D(m.cumulative).isNegative())
    expect(a.ym).toBe(first.ym)
    expect(c.short.months.filter((m: any) => m.k < first.k).every((m: any) => !D(m.cumulative).isNegative())).toBe(true)
    const list = await h.ok('RM2', 'GET', '/api/families')
    expect(list.find((f: any) => f.id === 'DEMO-F09')).toBeTruthy()
  })
  it('AC-30: mục tiêu du học DEMO-F01 – 7.966.909.760, 99,59%, Theo dõi', async () => {
    const g = await h.ok('RM1', 'GET', '/api/families/DEMO-F01/goals')
    const c = g.goals.find((x: any) => x.goal.id === 'GL-F01-01').coverage
    expect(c.projected).toBe('7966909760')
    expect(D(c.ratio).times(100).toFixed(2)).toBe('99.59')
    expect(c.level).toBe('WATCH')
  })
  it('Dữ liệu mẫu: mỗi mức Đạt, Theo dõi, Thiếu có ít nhất một mục tiêu; ≥ 2 mục tiêu chưa dành riêng', async () => {
    const levels = new Set<string>(); let noEarmark = 0
    for (const f of SEED.families) {
      const user = f.rm_id
      const g = await h.ok(user, 'GET', `/api/families/${f.id}/goals`)
      for (const x of g.goals) { levels.add(x.coverage.level); if (!x.goal.earmarks.length) noEarmark++ }
    }
    expect(levels).toEqual(new Set(['ON_TRACK', 'WATCH', 'SHORT']))
    expect(noEarmark).toBeGreaterThanOrEqual(2)
  })
  it('AC-33: DEMO-F12 có long_term_shortfall ở năm đầu tiên L < 0 (từ năm 6), giá trị hôm nay chia (1 + g)^t', async () => {
    const c = await h.ok('RM2', 'GET', '/api/families/DEMO-F12/cashflow')
    const a = c.long.alerts[0]
    expect(a.code).toBe('long_term_shortfall')
    expect(a.t).toBeGreaterThanOrEqual(6)
    expect(a.goals).toContain('GL-F12-01')
    const first = c.long.rows.find((r: any) => D(r.L).isNegative())
    expect(first.t).toBe(a.t)
    const row = c.long.rows[a.t - 1]
    expect(D(row.deflator).toFixed(6)).toBe(D(1.04).pow(a.t).toFixed(6))
  })
  it('FR-902/903: RM nhập mục tiêu thay khách; tổng % dành riêng mỗi vị thế ≤ 100%', async () => {
    const holdings = (await h.ok('RM1', 'GET', '/api/families/DEMO-F01/goals')).holdings
    const qcp = holdings.find((x: any) => x.instrument_id === 'VEOF').id
    const bad = await h.call('RM1', 'POST', '/api/families/DEMO-F01/goals', { name: 'Nghỉ hưu', type: 'retirement', year: 2040, month: 1, amount: '20000000000', basis: 'today', cost_growth: '0.04', spend: { kind: 'multi', years: 20 }, priority: 'essential', source_note: 'Theo trao đổi với khách ngày 01/10/2026', earmarks: [{ holding_id: qcp, pct: '0.5' }] })
    expect(bad.status).toBe(422)
    const g = await h.ok('RM1', 'POST', '/api/families/DEMO-F01/goals', { name: 'Nghỉ hưu', type: 'retirement', year: 2040, month: 1, amount: '20000000000', basis: 'today', cost_growth: '0.04', spend: { kind: 'multi', years: 20 }, priority: 'essential', source_note: 'Theo trao đổi với khách ngày 01/10/2026', earmarks: [] })
    expect(g.id).toBe('GL-F01-02')
    expect((await h.call('RM2', 'POST', '/api/families/DEMO-F01/goals', {})).status).toBe(403)
  })
})

describe('Nguồn giá', () => {
  it('AC-26, AC-17: giá dự phòng 2 phiên trước → price_fallback; giá 7 phiên trước → missing_price, NEEDS_CIO_REVIEW, RM chưa thấy', async () => {
    const h = await boot()
    const base = makeAdapters(SAMPLE_STORE)
    const s2 = SESSIONS[SESSIONS.length - 3], s7 = SESSIONS[SESSIONS.length - 8]
    const failing: PriceAdapter = {
      ...base.TCBS_STOCK,
      async history(reqs, from, to, ctx) {
        const out = await base.TCBS_STOCK.history(reqs, from, to, ctx)
        out.MBB = (out.MBB ?? []).filter(b => b.date <= s2)
        out.NLG = []
        return out
      },
    }
    // Ca kiểm thử riêng: NLG chỉ có giá 7 phiên trước trong lịch sử đã lưu
    await h.DB.prepare("DELETE FROM price_points WHERE key = 'NLG'").run()
    await h.DB.prepare('INSERT INTO price_points (id, key, date, data) VALUES (?, ?, ?, ?)').bind(`NLG|${s7}`, 'NLG', s7, JSON.stringify({ key: 'NLG', date: s7, price: '40000', source_ref: 'NLG' })).run()
    const snap = await createPriceSnapshot(adminCtx(h), { adapters: { ...base, TCBS_STOCK: failing } })
    expect(snap.fallbacks).toContain('MBB')
    expect(snap.missing).toContain('NLG')
    expect(snap.points.find(p => p.key === 'MBB')!.date).toBe(s2)
    const { event_id: _e, view_id: _v, event_type: _t, ...view } = exampleView()
    const r = await h.ok('CIO1', 'POST', '/api/manual-apply', { event_id: 'EV-2026-0002', view })
    const run = await h.ok('CIO1', 'GET', `/api/runs/${r.run_id}`)
    expect(run.run.status).toBe('NEEDS_CIO_REVIEW')
    const checks = run.post_check.findings.map((f: any) => `${f.check}:${f.target}`)
    expect(checks).toContain('price_fallback:DEMO-F01')
    expect(checks).toContain('missing_price:DEMO-F08')
    const rmView = await h.ok('RM1', 'GET', '/api/families/DEMO-F01/impacts')
    expect(rmView.impacts).toHaveLength(0)
    expect((await h.call('RM1', 'GET', `/api/runs/${r.run_id}/families/DEMO-F01/interpretation`)).status).toBe(403)
    await h.ok('CIO1', 'POST', `/api/runs/${r.run_id}/confirm`, { reason: 'Đã kiểm tra giá thiếu, cho hiệu lực để minh họa' })
    expect((await h.ok('RM1', 'GET', '/api/families/DEMO-F01/impacts')).impacts).toHaveLength(1)
  })
  it('AC-27: đất ở của DEMO-F05 không gọi One Mount; căn hộ được hỗ trợ hiển thị One Mount (mẫu)', async () => {
    const instruments = Object.fromEntries(SEED.instruments.map(i => [i.id, i]))
    const routed = routeRequests({ instruments, families: SEED.families })
    expect(routed.find(r => r.req.key === 'RE-F05-1')!.adapter).toBe('MANUAL')
    expect(routed.filter(r => r.adapter === 'ONEMOUNT').length).toBeGreaterThanOrEqual(4)
    const h = await boot()
    const o5 = await h.ok('RM1', 'GET', '/api/families/DEMO-F05')
    const land = o5.positions.find((p: any) => p.instrument_id === 'BDS-DATO')
    expect(land).toMatchObject({ price_source: 'Thủ công', valuation_date: '2025-06-30' })
    const o1 = await h.ok('RM1', 'GET', '/api/families/DEMO-F01')
    expect(o1.positions.find((p: any) => p.instrument_id === 'BDS-CANHO').price_source).toBe('One Mount (mẫu)')
  })
  it('AC-29: One Mount live với máy chủ giả chỉ gửi thuộc tính BR-22; thiếu agreement_ref thì từ chối', async () => {
    const sent: unknown[] = [], logged: unknown[] = [], events: string[] = []
    const fake: typeof fetch = async (_url, init) => { sent.push(JSON.parse(String(init!.body))); return new Response(JSON.stringify({ price: 15000000000, price_min: 14e9, price_max: 16e9, valuation_date: '2026-10-09', model_version: 'avm-x' })) }
    const fam = SEED.families.find(f => f.id === 'DEMO-F01')!
    const h1 = fam.holdings.find(x => x.price_key === 'RE-F01-1')!
    const om = makeAdapters(SAMPLE_STORE).ONEMOUNT
    const ctx = { mode: 'live' as const, env: { ONEMOUNT_BASE_URL: 'https://onemount.fake', ONEMOUNT_API_KEY: 'k' }, agreements: { ONEMOUNT: 'AGR-OM-1' }, fetchFn: fake, logOutbound: (_a: string, p: unknown) => logged.push(p), logEvent: (_a: string, m: string) => events.push(m) }
    const out = await om.history([{ key: 'RE-F01-1', currency: 'VND', property: h1.property }], '2026-10-01', '2026-10-09', ctx)
    expect(out['RE-F01-1'][0].price).toBe('15000000000')
    expect(Object.keys(sent[0] as object).sort()).toEqual(['area_m2', 'bedrooms', 'building', 'floor', 'project', 'unit'])
    expect(JSON.stringify(sent[0])).not.toMatch(/DEMO-F|M-F|A-F|H-F|Nguyễn|quantity/)
    expect(logged).toEqual([oneMountPayload(h1.property!)])
    await expect(om.history([{ key: 'RE-F01-1', currency: 'VND', property: h1.property }], '2026-10-01', '2026-10-09', { ...ctx, agreements: {} })).rejects.toBeInstanceOf(AdapterRefused)
    expect(events.join(' ')).toMatch(/agreement_ref/)
  })
})

describe('M10 – radar chính sách và kiểm soát thông tin', () => {
  let h: ReturnType<typeof harness>
  beforeAll(async () => { h = await boot() })
  it('AC-34: văn bản thuế chuyển nhượng BĐS → tóm tắt đúng schema, gia đình bị chạm đúng bằng tập có REAL_ESTATE > 0', async () => {
    await h.ok('ADM1', 'POST', '/api/admin/load-sample-policies')
    expect((await h.call('ADM1', 'POST', '/api/policies/PD-2026-001/analyze')).status).toBe(409)
    await h.ok('CMP1', 'POST', '/api/policies/PD-2026-001/confirm-source', { note: 'Đã kiểm tra đường dẫn công khai' })
    const r = await h.ok('ADM1', 'POST', '/api/policies/PD-2026-001/analyze')
    expect(r.doc.summary.changes.map((c: any) => c.article_refs).flat()).toEqual(['Điều 3 khoản 1', 'Điều 5 khoản 1', 'Điều 5 khoản 2'])
    const withRe: string[] = []
    for (const f of SEED.families) { const o = await h.ok('CIO1', 'GET', `/api/families/${f.id}`); if (D(o.by_asset_class.REAL_ESTATE ?? 0).gt(0)) withRe.push(f.id) }
    const d = await h.ok('CIO1', 'GET', '/api/policies/PD-2026-001')
    expect(d.matches.map((m: any) => m.family_id).sort()).toEqual(withRe.sort())
    expect(d.matches.every((m: any) => m.reasons[0].startsWith('Thuế, đất đai, bất động sản: Có'))).toBe(true)
    const rm = await h.ok('RM1', 'GET', '/api/policies/PD-2026-001')
    expect(rm.matches.every((m: any) => m.family_id <= 'DEMO-F07')).toBe(true)
    const v = await h.ok('CIO1', 'POST', `/api/events/${r.event_id}/run-agent`)
    expect(v.status).toBe('PENDING_APPROVAL')
    const vv = await h.ok('CIO1', 'GET', `/api/views/${v.id}`)
    expect(vv.challenges[0].findings.some((f: any) => f.check === 'citation_check')).toBe(false)
  })
  it('AC-35: tin không có đường dẫn công khai hoặc miền ngoài danh sách bị từ chối; nhật ký ghi lý do', async () => {
    const before = (await h.ok('ADM1', 'GET', '/api/events')).length
    for (const item of invalidNews) {
      const r = await h.call('ADM1', 'POST', '/api/events', { type: 'corporate', items: [item] })
      expect(r.status).toBe(422)
    }
    expect((await h.ok('ADM1', 'GET', '/api/events')).length).toBe(before)
    const a = await h.ok('CMP1', 'GET', '/api/audit?action=event.rejected')
    expect(a).toHaveLength(2)
    expect(a.map((x: any) => JSON.parse(x.data).problems[0].errors.join(' ')).join(' ')).toMatch(/Thiếu đường dẫn công khai.*|không thuộc danh sách/)
  })
  it('AC-36: EV-2026-0006 chặn chờ Tuân thủ; sau khi cho phép dòng DMXYZ bị loại, dòng ngành vẫn áp dụng; diễn giải và bản tin không nhắc DMXYZ', async () => {
    const r = await h.call('CIO1', 'POST', '/api/events/EV-2026-0006/run-agent')
    expect(r.status).toBe(409)
    await h.ok('CMP1', 'POST', '/api/events/EV-2026-0006/allow', { note: 'Thông tin đã công bố công khai' })
    const v = await h.ok('CIO1', 'POST', '/api/events/EV-2026-0006/run-agent')
    expect(v.removed_restricted.map((l: any) => l.target)).toEqual(['DMXYZ'])
    expect(v.body.impacts.some((l: any) => l.target === 'DMXYZ')).toBe(false)
    expect(v.body.impacts.some((l: any) => l.scope === 'sector' && l.target === 'INDUSTRIAL')).toBe(true)
    const d = await h.ok('CIO1', 'GET', `/api/views/${v.id}`)
    expect(d.challenges[0].findings.some((f: any) => f.check === 'restricted_instrument')).toBe(true)
    const dec = await h.ok('CIO1', 'POST', `/api/views/${v.id}/decision`, { action: 'APPROVE', reason: 'Duyệt nhận định ngành công nghiệp' })
    const res = (await h.ok('CIO1', 'GET', `/api/runs/${dec.run_id}/families/DEMO-F06`)).result
    const xyz = res.positions.find((p: any) => p.instrument_id === 'DMXYZ')
    // Dòng cấp mã bị loại; mã vẫn chịu tác động qua kịch bản ngành (VN-Index × beta ngành)
    expect(res.engine).toBe('scenario')
    expect(Number(xyz.impact)).not.toBe(0)
    const it6 = await h.ok('RM1', 'GET', `/api/runs/${dec.run_id}/families/DEMO-F06/interpretation`)
    expect(it6.text).not.toMatch(/DMXYZ|Demo X/)
    const rel = await h.ok('CIO1', 'POST', '/api/releases', { view_id: v.id, release_private_at: '2026-10-11T01:00:00Z', release_public_at: '2026-10-11T05:00:00Z', early_access_basis: 'Bản tin tư vấn theo hợp đồng dịch vụ Private, Tuân thủ xem căn cứ' })
    expect(rel.content).not.toMatch(/DMXYZ|Demo X/)
    const bad = await h.ok('CIO1', 'PUT', `/api/releases/${rel.id}`, { content: rel.content + '\nCông ty Demo X có thể bị pha loãng.' })
    expect(bad.checks.restricted).toEqual(['RL-001'])
    await h.ok('CIO1', 'POST', `/api/releases/${rel.id}/submit`)
    expect((await h.call('CMP1', 'POST', `/api/releases/${rel.id}/review`, { approve: true, note: 'Duyệt thử bản tin có mã hạn chế' })).status).toBe(409)
  })
  it('AC-37: mọi sự kiện có hiệu lực có đủ mốc BR-29 và thời gian phản ứng; mốc sai thứ tự bị từ chối', async () => {
    const rad = await h.ok('CIO1', 'GET', '/api/policies')
    const ev = rad.events.find((e: any) => e.id === 'EV-2026-0006')
    for (const k of ['published_at', 'ingested_at', 'event_created_at', 'view_ready_at', 'approved_at', 'effective_at']) expect(ev.timestamps[k]).toBeTruthy()
    expect(ev.reaction_ms).toBeGreaterThan(0)
    const r = await h.call('ADM1', 'POST', '/api/events/EV-2026-0006/timestamps', { field: 'approved_at', value: '2026-10-01T00:00:00Z' })
    expect(r.status).toBe(422)
    expect(r.data.error).toMatch(/BR-29/)
  })
  it('AC-38: bản tin từ VW-0002 – mốc Private sớm hơn đại chúng, không dữ liệu gia đình, vi phạm BR-14 không duyệt được, không có nút gửi', async () => {
    const { event_id: _e, view_id: _v, event_type: _t, ...view } = exampleView()
    const m = await h.ok('CIO1', 'POST', '/api/manual-apply', { event_id: 'EV-2026-0002', view })
    expect((await h.call('CIO1', 'POST', '/api/releases', { view_id: m.view.id, release_private_at: '2026-10-11T05:00:00Z', release_public_at: '2026-10-11T01:00:00Z' })).status).toBe(422)
    // Phân phối công bằng: Private sớm hơn mà không ghi căn cứ thì bị từ chối; cùng lúc thì được
    expect((await h.call('CIO1', 'POST', '/api/releases', { view_id: m.view.id, release_private_at: '2026-10-11T01:00:00Z', release_public_at: '2026-10-11T05:00:00Z' })).status).toBe(422)
    const rel = await h.ok('CIO1', 'POST', '/api/releases', { view_id: m.view.id, release_private_at: '2026-10-11T01:00:00Z', release_public_at: '2026-10-11T05:00:00Z', early_access_basis: 'Bản tin tư vấn theo hợp đồng dịch vụ Private, Tuân thủ xem căn cứ' })
    expect(rel.early_access_basis).toContain('hợp đồng')
    expect(rel.checks.ok).toBe(true)
    expect(rel.content).not.toMatch(/DEMO-F|tài sản ròng/)
    const bad = await h.ok('CIO1', 'PUT', `/api/releases/${rel.id}`, { content: rel.content + '\nKhách nên bán cổ phiếu bất động sản.' })
    expect(bad.checks.ok).toBe(false)
    await h.ok('CIO1', 'POST', `/api/releases/${rel.id}/submit`)
    expect((await h.call('CMP1', 'POST', `/api/releases/${rel.id}/review`, { approve: true, note: 'Thử duyệt bản tin vi phạm BR-14' })).status).toBe(409)
    await h.ok('CMP1', 'POST', `/api/releases/${rel.id}/review`, { approve: false, note: 'Từ chối vì có ngôn ngữ khuyến nghị' })
    const fixed = await h.ok('CIO1', 'PUT', `/api/releases/${rel.id}`, { content: rel.content })
    await h.ok('CIO1', 'POST', `/api/releases/${fixed.id}/submit`)
    const ok = await h.ok('CMP1', 'POST', `/api/releases/${rel.id}/review`, { approve: true, note: 'Nội dung chung, không vi phạm, đồng ý lịch' })
    expect(ok.status).toBe('APPROVED')
    expect((await h.call('CIO1', 'POST', `/api/releases/${rel.id}/send`)).status).toBe(404)
  })
  it('AC-39: nguồn tin ngoài danh sách bị từ chối; gói đầu vào của ba agent chỉ chứa nguồn hợp lệ', async () => {
    expect((await h.call('ADM1', 'POST', '/api/sources', { name: 'Diễn đàn', url: 'https://dien-dan-khong-ro.example/rss', reason: 'Thử thêm nguồn ngoài danh sách' })).status).toBe(422)
    const okSrc = await h.ok('ADM1', 'POST', '/api/sources', { name: 'Cổng tin giả lập', url: 'https://tintuc-gialap.example/rss', reason: 'Thêm nguồn tin thuộc danh sách công khai' })
    expect(okSrc.status).toBe('ACTIVE')
    const wl = SEED.whitelist.map(w => w.domain)
    const runs = await h.DB.prepare('SELECT data FROM agent_runs').all<{ data: string }>()
    expect(runs.results.length).toBeGreaterThanOrEqual(2)
    for (const r of runs.results) {
      const d = JSON.parse(r.data)
      const urls = JSON.stringify(d.input_package).match(/https?:\/\/[^"\s]+/g) ?? []
      for (const u of urls) expect(wl).toContain(new URL(u).hostname)
      expect(JSON.stringify(d.input_package)).not.toMatch(/DEMO-F\d\d|H-F\d\d/)
    }
    const chs = await h.DB.prepare('SELECT data FROM challenges WHERE stage != ?').bind('post_check').all<{ data: string }>()
    for (const c of chs.results) expect(JSON.stringify(JSON.parse(c.data).input_package)).not.toMatch(/DEMO-F\d\d|H-F\d\d|"nodes"/)
  })
})

// Đợt 4 sau phản biện độc lập: cấu trúc liên thế hệ — sở hữu nhiều tầng, đòn bẩy khi căng thẳng, thang thanh khoản,
// kế thừa theo bảng quy tắc có phiên bản, khớp chính sách theo cấu trúc.
import { describe, expect, it } from 'vitest'
import SEED_FAMILIES from '../data/seed/families.json'
import { DEFAULT_FACTOR_MODEL } from '../src/data/factorModel'
import { buildPositions, entityFamilyShare, netWorth, ownershipIssues, type PriceBook } from '../src/engine/positions'
import { conditionalShocks, type FactorModel } from '../src/engine/scenario'
import { DEFAULT_SUCCESSION_RULES, analogStress, inheritanceTaxableBase, leverageCheck, liquidityLadder, memberAssets, succession, worstAnalog } from '../src/engine/structure'
import { matchFamily } from '../src/engine/policyMatch'
import { D } from '../src/engine/dec'
import type { Family, Instrument } from '../src/shared/types'
import INSTR from '../data/seed/instruments.json'
import { harness } from './support/harness'

const families = SEED_FAMILIES as unknown as Family[]
const fam = (id: string) => JSON.parse(JSON.stringify(families.find(f => f.id === id)!)) as Family
const instruments = Object.fromEntries((INSTR as unknown as Instrument[]).map(i => [i.id, i]))
const model = DEFAULT_FACTOR_MODEL as unknown as FactorModel

describe('Sở hữu nhiều tầng', () => {
  it('DEMO-F13: chuyển 40% qua holding nước ngoài 100% của nhà sáng lập, tỷ lệ hiệu dụng giữ 70%', () => {
    const f = fam('DEMO-F13')
    expect(f.ownerships.some(o => o.owner_entity_id === 'E-F13-2')).toBe(true)
    expect(entityFamilyShare(f, 'E-F13-1').toString()).toBe('0.7')
    expect(ownershipIssues(f)).toEqual([])
  })
  it('vòng sở hữu chéo không lặp vô hạn và được báo lỗi; tổng vượt 100% bị nêu', () => {
    const f = fam('DEMO-F13')
    f.entities.push({ id: 'E-X', name: 'Công ty X', type: 'holding' })
    f.ownerships.push({ entity_id: 'E-X', owner_entity_id: 'E-F13-1', pct: '0.5' }, { entity_id: 'E-F13-1', owner_entity_id: 'E-X', pct: '0.5' })
    // Vòng chéo bị cắt khi gặp lại pháp nhân đã đi qua: phần qua E-X tính bằng 0, giữ nguyên 40% + 30% của gia đình
    expect(Number(entityFamilyShare(f, 'E-F13-1'))).toBeCloseTo(0.7, 9)
    const issues = ownershipIssues(f)
    expect(issues.some(x => /vòng tròn/.test(x))).toBe(true)
    expect(issues.some(x => /vượt 100%/.test(x))).toBe(true)
  })
})

describe('Cú sốc theo giai đoạn lịch sử', () => {
  it('yếu tố đã biết giữ nguyên, yếu tố còn lại suy ra theo tương quan', () => {
    const s = conditionalShocks(model, 'stress', { VN_EQ: -37.05 })
    expect(s.VN_EQ).toBe(-37.05)
    expect(Object.keys(s).length).toBe(model.factors.length)
    expect(s.FOREIGN_FLOW).toBeLessThan(0)
  })
})

describe('Đòn bẩy, thang thanh khoản, kế thừa (bộ máy)', () => {
  const book: PriceBook = { price_date: '2026-10-09', points: {}, fx: { USD: '25000', SGD: '19000', AUD: '16500' } }
  // Giá mẫu tối giản: mọi khoá giá = 1 đơn vị × số lượng (đủ cho kiểm tra cấu trúc)
  const priced = (f: Family): PriceBook => ({ ...book, points: Object.fromEntries(f.holdings.map(h => [h.price_key ?? h.instrument_id, { key: h.price_key ?? h.instrument_id, price: instruments[h.instrument_id]?.bond ? '100000' : h.instrument_id.startsWith('BDS') || h.instrument_id === 'CPTN' || h.instrument_id === 'BH-TICHLUY' ? '10000000000' : '30000', date: '2026-10-09', source: 'test', flag: 'sample' } as never])) })

  it('gọi ký quỹ: tỷ lệ cho vay khi căng thẳng vượt ngưỡng thì báo và tính số cần nộp thêm', () => {
    const f = fam('DEMO-F09'); const b = priced(f)
    const l = f.liabilities[0]
    l.collateral_holdings = [f.holdings.find(h => h.instrument_id === 'HPG')!.id]
    l.ltv_max = '0.5'; l.margin_call_ltv = '0.7'
    l.balance = String(Math.round(148100 * 30000 * 0.62)) // 62% hiện tại
    const pos = buildPositions(f, instruments, b)
    const st = analogStress(pos, instruments, model, b, 'VN-2022', netWorth(f, pos, b).toNumber())!
    const r = leverageCheck(f, pos, b, st)[0]
    expect(r.ltv_now).toBeCloseTo(0.62, 2)
    expect(r.ltv_stress!).toBeGreaterThan(0.7)
    expect(r.status).toBe('MARGIN_CALL_STRESS')
    expect(Number(r.top_up_vnd)).toBeGreaterThan(0)
    // Thang thanh khoản tính khoản nộp ký quỹ vào tháng đầu
    const lad = liquidityLadder(f, instruments, b, pos, '0.035', st, [r])
    expect(lad.outflows.some(o => o.kind === 'margin_call')).toBe(true)
    expect(lad.rows.map(x => x.id)).toEqual(['d7', 'm1', 'm3', 'm12'])
    // Khoản nộp ký quỹ nằm ngay trong mốc 7 ngày; cổ phiếu đang cầm cố không được tính là bán được
    expect(Number(lad.rows[0].outflow)).toBeGreaterThanOrEqual(Number(lad.outflows.find(o => o.kind === 'margin_call')!.amount) - 1)
    expect(Number(lad.illiquid_after_12m)).toBeGreaterThanOrEqual(148100 * 30000 - 1)
  })

  it('khoản vay chưa gắn vị thế bảo đảm thì không đoán, ghi rõ chưa kiểm tra được', () => {
    const f = fam('DEMO-F02'); const b = priced(f)
    const pos = buildPositions(f, instruments, b)
    expect(leverageCheck(f, pos, b, null)[0].status).toBe('NOT_LINKED')
  })

  it('cam kết góp vốn còn lại xuất hiện trong nghĩa vụ chi theo lịch', () => {
    const f = fam('DEMO-F19'); const b = priced(f)
    const pos = buildPositions(f, instruments, b)
    const lad = liquidityLadder(f, instruments, b, pos, '0.035', worstAnalog(pos, instruments, model, b, netWorth(f, pos, b).toNumber()), [])
    expect(lad.outflows.filter(o => o.kind === 'capital_call').map(o => o.k)).toEqual([3, 9])
    // Đợt đã qua bị bỏ; tổng không vượt phần còn lại
    const h = f.holdings.find(x => x.commitment)!
    h.commitment = { ...h.commitment!, called: '5000000000', schedule: [{ date: '2026-01-15', amount: '3000000000' }, ...h.commitment!.schedule!] }
    const lad2 = liquidityLadder(f, instruments, b, pos, '0.035', null, [])
    const calls = lad2.outflows.filter(o => o.kind === 'capital_call')
    expect(calls.reduce((x, o) => x + Number(o.amount), 0)).toBeCloseTo(1_000_000_000, -1)
  })

  it('khoản vay chỉ có tỷ lệ tối đa: vượt khi căng thẳng thì báo', () => {
    const f = fam('DEMO-F09'); const b = priced(f)
    const l = f.liabilities[0]
    l.collateral_holdings = [f.holdings.find(h => h.instrument_id === 'HPG')!.id]; l.margin_call_ltv = undefined; l.ltv_max = '0.6'
    l.balance = String(Math.round(148100 * 30000 * 0.58))
    const pos = buildPositions(f, instruments, b)
    const st = analogStress(pos, instruments, model, b, 'VN-2022', netWorth(f, pos, b).toNumber())!
    expect(leverageCheck(f, pos, b, st)[0].status).toBe('ABOVE_MAX_STRESS')
  })

  // Gia đình tự dựng, số tính tay: chồng (H) và vợ (W), con (C). Tài khoản chung 50/50 có căn hộ 10 tỷ;
  // H đứng tên 100.000 MBB (3 tỷ) và 2 tỷ tiền gửi; W đứng tên 50.000 MBB (1,5 tỷ)
  const hand = (): Family => ({
    id: 'T', name: 'T', rm_id: 'RM1', persona: 'P2', currency: 'VND',
    members: [
      { id: 'H', name: 'Chồng', generation: 1, role: 'x', marital_status: 'married', spouse_id: 'W', has_will: false, tax_residency: 'VN' },
      { id: 'W', name: 'Vợ', generation: 1, role: 'x', marital_status: 'married', spouse_id: 'H', has_will: false, tax_residency: 'VN' },
      { id: 'C', name: 'Con', generation: 2, role: 'x', parent_ids: ['H', 'W'], marital_status: 'single', has_will: false, tax_residency: 'VN' },
    ],
    entities: [], ownerships: [],
    accounts: [
      { id: 'AJ', custodian: 'x', currency: 'VND', owners: [{ kind: 'member', id: 'H', pct: '0.5' }, { kind: 'member', id: 'W', pct: '0.5' }] },
      { id: 'AH', custodian: 'x', currency: 'VND', owners: [{ kind: 'member', id: 'H', pct: '1' }] },
      { id: 'AW', custodian: 'x', currency: 'VND', owners: [{ kind: 'member', id: 'W', pct: '1' }] },
    ],
    holdings: [
      { id: 'h1', account_id: 'AJ', instrument_id: 'BDS-CANHO', quantity: '1' },
      { id: 'h2', account_id: 'AH', instrument_id: 'MBB', quantity: '100000' },
      { id: 'h3', account_id: 'AH', instrument_id: 'CASH-VND', quantity: '2000000000' },
      { id: 'h4', account_id: 'AW', instrument_id: 'MBB', quantity: '50000' },
    ],
    liabilities: [], transactions: [], cashflows: [],
  })

  it('thừa kế: di sản = một nửa khối chung của cả hai vợ chồng; bất động sản đứng tên cá nhân được miễn, cổ phiếu chịu 10% phần vượt 20 triệu', () => {
    const f = hand(); const b = priced(f)
    const pos = buildPositions(f, instruments, b)
    const ev = succession(f, pos, b, DEFAULT_SUCCESSION_RULES).events.find(e => e.event === 'g1_death' && e.member_id === 'H')!
    // Khối chung: H 10 tỷ (5 căn hộ + 3 MBB + 2 tiền) + W 6,5 tỷ (5 căn hộ + 1,5 MBB) = 16,5 tỷ → di sản 8,25 tỷ
    expect(ev.estate).toBe('8250000000')
    expect(ev.heirs.map(h => h.relation)).toEqual(['Vợ/chồng', 'Con'])
    // Mỗi người: 4,125 tỷ; phần chịu thuế = MBB (3 + 1,5) / 2 / 2 = 1,125 tỷ; thuế = (1,125 tỷ − 20 triệu) × 10%
    expect(ev.heirs[0].receives).toBe('4125000000')
    expect(ev.heirs[0].taxable).toBe('1125000000')
    expect(ev.heirs[0].tax).toBe('110500000')
  })

  it('tài sản riêng không vào khối chung; ly hôn: một sự kiện mỗi cặp, chuyển ≈ chênh lệch với nửa khối chung', () => {
    const f = hand(); f.holdings.find(h => h.id === 'h4')!.separate_property = true
    const b = priced(f); const pos = buildPositions(f, instruments, b)
    const r = succession(f, pos, b, DEFAULT_SUCCESSION_RULES)
    // Khối chung 15 tỷ (MBB của W là tài sản riêng) → di sản của H 7,5 tỷ
    expect(r.events.find(e => e.event === 'g1_death' && e.member_id === 'H')!.estate).toBe('7500000000')
    // Di sản của W = nửa khối chung 7,5 tỷ + tài sản riêng 1,5 tỷ
    expect(r.events.find(e => e.event === 'g1_death' && e.member_id === 'W')!.estate).toBe('9000000000')
    const dv = r.events.filter(e => e.event === 'divorce')
    expect(dv).toHaveLength(1)
    // Chung của H 10 tỷ, nửa khối chung 7,5 tỷ → khoảng 2,5 tỷ chuyển từ H sang W
    expect(dv[0].estate).toBe('2500000000')
    expect(dv[0].findings[0].text).toMatch(/từ Chồng sang Vợ/)
    expect(dv[0].findings[0].text).not.toMatch(/tối đa/)
  })

  it('vợ/chồng đã ly hôn không còn là người thừa kế; bảng quy tắc quyết định hàng thừa kế', () => {
    const f = hand(); f.members[0].marital_status = 'divorced'
    const b = priced(f); const pos = buildPositions(f, instruments, b)
    const ev = succession(f, pos, b, DEFAULT_SUCCESSION_RULES).events.find(e => e.event === 'g1_death' && e.member_id === 'H')!
    expect(ev.heirs.map(h => h.relation)).toEqual(['Con'])
    const ev2 = succession(hand(), pos, b, { ...DEFAULT_SUCCESSION_RULES, intestate_first_tier: ['child'] }).events.find(e => e.event === 'g1_death' && e.member_id === 'H')!
    expect(ev2.heirs.map(h => h.relation)).toEqual(['Con'])
  })

  it('DEMO-F01: bảo hiểm có người thụ hưởng chỉ định không vào di sản; phần vốn qua pháp nhân được nêu', () => {
    const f = fam('DEMO-F01'); const b = priced(f)
    const pos = buildPositions(f, instruments, b)
    const a = memberAssets(f, pos, 'M-F01-1', b)
    expect(a.beneficiary_out.gt(0)).toBe(true)
    expect(a.direct.INSURANCE).toBeUndefined()
    const ev = succession(f, pos, b, DEFAULT_SUCCESSION_RULES).events.find(e => e.event === 'g1_death')!
    expect(ev.findings.some(x => /phần vốn/.test(x.text))).toBe(true)
  })

  it('thừa kế DEMO-F13: phần vốn qua holding nước ngoài được nêu; nợ của pháp nhân trừ vào phần vốn', () => {
    const f = fam('DEMO-F13'); const b = priced(f)
    const pos = buildPositions(f, instruments, b)
    const ev = succession(f, pos, b, DEFAULT_SUCCESSION_RULES).events.find(e => e.event === 'g1_death')!
    expect(ev.findings.some(x => /nước ngoài/.test(x.text) && /SG/.test(x.text))).toBe(true)
    const gross = pos.filter(p => p.account_id === 'A-F13-E1').reduce((x, p) => x + p.value_vnd.toNumber(), 0) * 0.4
    expect(Number(memberAssets(f, pos, 'M-F13-1', b).via_entity)).toBeCloseTo(Math.max(0, gross - 100_000_000_000 * 0.4), -3)
  })

  it('người thừa kế cư trú ở nước ngoài được gắn cờ; sự kiện ra nước ngoài và ly hôn có mặt', () => {
    const f = fam('DEMO-F18'); const b = priced(f)
    const pos = buildPositions(f, instruments, b)
    const r = succession(f, pos, b, DEFAULT_SUCCESSION_RULES)
    const d = r.events.find(e => e.event === 'g1_death')!
    expect(d.heirs.some(h => h.non_resident)).toBe(true)
    expect(r.events.some(e => e.event === 'g2_emigration' && e.findings.some(x => /Đang cư trú/.test(x.text)))).toBe(true)
    expect(r.events.some(e => e.event === 'divorce')).toBe(true)
  })

  it('dữ liệu cũ không có trường cấu trúc vẫn chạy và báo thiếu dữ liệu', () => {
    const f = fam('DEMO-F06'); const b = priced(f)
    for (const m of f.members) for (const k of ['birth_year', 'tax_residency', 'nationality', 'marital_status', 'spouse_id', 'parent_ids', 'has_will'] as const) delete m[k]
    const pos = buildPositions(f, instruments, b)
    const r = succession(f, pos, b, DEFAULT_SUCCESSION_RULES)
    expect(r.data_gaps.length).toBeGreaterThanOrEqual(3)
    expect(r.events.find(e => e.event === 'g1_death')!.heirs.length).toBeGreaterThan(0)
  })

  it('khớp chính sách: thừa kế chỉ tính phần chịu thuế; chứng khoán dưới 5% tài sản ròng không khớp', () => {
    const f = fam('DEMO-F01'); const b = priced(f)
    const pos = buildPositions(f, instruments, b)
    const nw = netWorth(f, pos, b)
    const m = matchFamily(f, pos, nw, D(0), ['INHERITANCE_GIFT'])!
    expect(m.relevant).toBe(inheritanceTaxableBase(f, pos, DEFAULT_SUCCESSION_RULES).toFixed(0))
    expect(Number(m.relevant)).toBeLessThan(nw.toNumber())
    const tiny = fam('DEMO-F06'); const tb = priced(tiny)
    tiny.holdings = tiny.holdings.filter(h => !['EQ_VN', 'EQ_INTL', 'FUND', 'GOV_BOND', 'CORP_BOND'].includes(instruments[h.instrument_id].asset_class))
    tiny.holdings.push({ id: 'H-T', account_id: tiny.accounts[0].id, instrument_id: 'MBB', quantity: '10' })
    const tp = buildPositions(tiny, instruments, tb)
    expect(matchFamily(tiny, tp, netWorth(tiny, tp, tb), D(0), ['TAX_SECURITIES'])).toBeNull()
  })
})

describe('API cấu trúc và bảng quy tắc', () => {
  const h = harness()
  it('RM chỉ xem gia đình mình; kết quả có đủ các phần', async () => {
    await h.call(null, 'POST', '/api/bootstrap')
    const s = await h.ok('CMP1', 'GET', '/api/families/DEMO-F13/structure')
    expect(s.multi_layer).toBe(true)
    expect(s.analog_stress.length).toBe(2)
    expect(s.ladder.rows).toHaveLength(4)
    expect(s.succession.events.length).toBeGreaterThan(0)
    expect(s.legal_confirmed).toBe(false)
    const me = await h.ok('RM1', 'GET', '/api/me')
    expect((await h.ok('RM1', 'GET', `/api/families/${me.families[0]}/structure`)).ladder.rows).toHaveLength(4)
    const other = families.find(f => !me.families.includes(f.id))!
    expect((await h.call('RM1', 'GET', `/api/families/${other.id}/structure`)).status).toBe(403)
    // Dữ liệu kế thừa nhạy cảm: CIO và Quản trị không xem
    expect((await h.call('CIO1', 'GET', '/api/families/DEMO-F13/structure')).status).toBe(403)
    expect((await h.call('ADM1', 'GET', '/api/families/DEMO-F13/structure')).status).toBe(403)
  })
  it('bảng quy tắc kế thừa: Tuân thủ đề xuất, người thứ hai xác nhận; nội dung sai bị từ chối', async () => {
    expect((await h.call('CMP1', 'POST', '/api/config/SUCCESSION_RULES', { content: { ...DEFAULT_SUCCESSION_RULES, inheritance_tax: { ...DEFAULT_SUCCESSION_RULES.inheritance_tax, rate: 2 } }, reason: 'Thử nội dung sai thuế suất' })).status).toBe(422)
    expect((await h.call('CIO1', 'POST', '/api/config/SUCCESSION_RULES', { content: DEFAULT_SUCCESSION_RULES, reason: 'CIO không sở hữu bảng quy tắc này' })).status).toBe(403)
    const p = await h.ok('CMP1', 'POST', '/api/config/SUCCESSION_RULES', { content: { ...DEFAULT_SUCCESSION_RULES, legal_confirmed: true, version: '2026-10-21' }, reason: 'Pháp chế đã xác nhận căn cứ Luật 109/2025/QH15' })
    expect(p.status).toBe('PENDING_CONFIRM')
    expect([403, 409]).toContain((await h.call('CMP1', 'POST', `/api/config/versions/${p.id}/decision`, { approve: true, reason: 'Tự xác nhận không được phép' })).status)
    await h.ok('CMP2', 'POST', `/api/config/versions/${p.id}/decision`, { approve: true, reason: 'Đã đối chiếu điều khoản với văn bản gốc' })
    const s = await h.ok('CMP1', 'GET', '/api/families/DEMO-F01/structure')
    expect(s).toMatchObject({ legal_confirmed: true, rules_version: '2026-10-21' })
    expect(s.rules_confirmed_by).toMatch(/CMP2/)
    expect(s.rules_proposed_by).toMatch(/CMP1/)
  })
  it('cơ sở dữ liệu chưa có bảng quy tắc (như bản đang chạy): dùng bảng mặc định, ghi rõ chưa ai xác nhận', async () => {
    const h2 = harness()
    await h2.call(null, 'POST', '/api/bootstrap')
    await h2.DB.prepare("DELETE FROM config_versions WHERE kind = 'SUCCESSION_RULES'").run()
    const s = await h2.ok('CMP1', 'GET', '/api/families/DEMO-F06/structure')
    expect(s).toMatchObject({ rules_config: null, legal_confirmed: false, rules_confirmed_by: null })
    expect(s.succession.events.length).toBeGreaterThan(0)
  })
})

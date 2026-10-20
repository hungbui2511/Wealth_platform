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
    expect(Number(entityFamilyShare(f, 'E-F13-1'))).toBeLessThanOrEqual(1.2)
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
    for (let i = 1; i < lad.rows.length; i++) expect(Number(lad.rows[i].assets)).toBeGreaterThanOrEqual(Number(lad.rows[i - 1].assets))
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
  })

  it('thừa kế DEMO-F01: bất động sản đứng tên cá nhân được miễn giữa người thân, phần vốn qua pháp nhân chịu 10% trên phần vượt 20 triệu', () => {
    const f = fam('DEMO-F01'); const b = priced(f)
    const pos = buildPositions(f, instruments, b)
    const res = succession(f, pos, b, DEFAULT_SUCCESSION_RULES)
    const ev = res.events.find(e => e.event === 'g1_death')!
    expect(ev.member_id).toBe('M-F01-1')
    const a = memberAssets(f, pos, 'M-F01-1', b)
    // Bảo hiểm có người thụ hưởng chỉ định không vào di sản
    expect(a.beneficiary_out.gt(0)).toBe(true)
    expect(a.direct.INSURANCE).toBeUndefined()
    // Chia đều vợ và con; phần chịu thuế không gồm bất động sản, tiền, vàng
    expect(ev.heirs.map(h => h.relation)).toEqual(['Vợ/chồng', 'Con'])
    const share = 0.5 // tài sản chung vợ chồng
    const expectTaxable = ['EQ_VN', 'CORP_BOND', 'FUND', 'PRIVATE_EQ', 'EQ_INTL', 'GOV_BOND'].reduce((x, k) => x + Number(a.direct[k] ?? 0), 0) + Number(a.via_entity)
    const ratio = (Number(a.total) * share - 3_000_000_000) / (Number(a.total) * share) // trừ nửa khoản vay thế chấp
    const per = expectTaxable * share * ratio / 2
    expect(Number(ev.heirs[0].taxable)).toBeCloseTo(per, -3)
    expect(Number(ev.heirs[0].tax)).toBeCloseTo((per - 20_000_000) * 0.1, -3)
    expect(ev.findings.some(x => /phần vốn/.test(x.text))).toBe(true)
    expect(res.legal_confirmed).toBe(false)
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
    for (const m of f.members) { delete m.has_will; delete m.marital_status; delete m.tax_residency; delete m.parent_ids }
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
    const s = await h.ok('CIO1', 'GET', '/api/families/DEMO-F13/structure')
    expect(s.multi_layer).toBe(true)
    expect(s.analog_stress.length).toBe(2)
    expect(s.ladder.rows).toHaveLength(4)
    expect(s.succession.events.length).toBeGreaterThan(0)
    expect(s.legal_confirmed).toBe(false)
    const me = await h.ok('RM1', 'GET', '/api/me')
    const other = families.find(f => !me.families.includes(f.id))!
    expect((await h.call('RM1', 'GET', `/api/families/${other.id}/structure`)).status).toBe(403)
  })
  it('bảng quy tắc kế thừa: Tuân thủ đề xuất, người thứ hai xác nhận; nội dung sai bị từ chối', async () => {
    expect((await h.call('CMP1', 'POST', '/api/config/SUCCESSION_RULES', { content: { ...DEFAULT_SUCCESSION_RULES, inheritance_tax: { ...DEFAULT_SUCCESSION_RULES.inheritance_tax, rate: 2 } }, reason: 'Thử nội dung sai thuế suất' })).status).toBe(422)
    expect((await h.call('CIO1', 'POST', '/api/config/SUCCESSION_RULES', { content: DEFAULT_SUCCESSION_RULES, reason: 'CIO không sở hữu bảng quy tắc này' })).status).toBe(403)
    const p = await h.ok('CMP1', 'POST', '/api/config/SUCCESSION_RULES', { content: { ...DEFAULT_SUCCESSION_RULES, legal_confirmed: true, version: '2026-10-21' }, reason: 'Pháp chế đã xác nhận căn cứ Luật 109/2025/QH15' })
    expect(p.status).toBe('PENDING_CONFIRM')
    expect([403, 409]).toContain((await h.call('CMP1', 'POST', `/api/config/versions/${p.id}/decision`, { approve: true, reason: 'Tự xác nhận không được phép' })).status)
    await h.ok('CMP2', 'POST', `/api/config/versions/${p.id}/decision`, { approve: true, reason: 'Đã đối chiếu điều khoản với văn bản gốc' })
    const s = await h.ok('CIO1', 'GET', '/api/families/DEMO-F01/structure')
    expect(s).toMatchObject({ legal_confirmed: true, rules_version: '2026-10-21' })
  })
})

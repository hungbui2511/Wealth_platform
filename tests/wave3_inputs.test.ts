// Đợt 3 sau phản biện độc lập: hạng nguồn và quy tắc hai nguồn, nhật ký quét tin, lịch sự kiện, biến động thị trường từ khi có tin,
// văn bản luật (mã băm, xác nhận nội dung, cờ cắt, phiên bản mới cùng đường dẫn, nguồn thứ cấp).
import { describe, expect, it } from 'vitest'
import { rootDomain, sourceTier } from '../src/news/sources'
import { sourceRuleChecks } from '../src/agents/challenger'
import type { ImpactLine } from '../src/shared/types'
import { harness } from './support/harness'

describe('Hạng nguồn và quy tắc hai nguồn', () => {
  it('phân hạng theo miền', () => {
    expect(sourceTier('https://www.sbv.gov.vn/a')).toBe('T1')
    expect(sourceTier('https://www.reuters.com/x')).toBe('T2')
    expect(sourceTier('https://vneconomy.vn/x')).toBe('T3')
    expect(sourceTier('https://thuvienphapluat.vn/x')).toBe('T4')
    expect(rootDomain('https://finance.yahoo.com/x')).toBe('yahoo.com')
    expect(rootDomain('https://www.vietcombank.com.vn/x')).toBe('vietcombank.com.vn')
  })
  const line = (level: number, ids: string[]): ImpactLine => ({ scope: 'asset_class', asset_class: 'EQ_VN', target: 'EQ_VN', level, direction: level < 0 ? 'negative' : 'positive', horizon: '1-3 tháng', confidence: 'medium', rationale: 'x', source_ids: ids } as ImpactLine)
  const news = [{ id: 'N1', url: 'https://vneconomy.vn/a' }, { id: 'N2', url: 'https://vneconomy.vn/b' }, { id: 'N3', url: 'https://vietstock.vn/c' }, { id: 'N4', url: 'https://www.sbv.gov.vn/d' }, { id: 'N5', url: 'https://luatvietnam.vn/e' }]
  const body = (l: ImpactLine) => ({ impacts: [l] } as never)
  it('mức ±2 với hai tin cùng một báo bị nêu; có nguồn chính thức hoặc hai báo khác nhau thì qua; mức ±1 không xét', () => {
    expect(sourceRuleChecks(body(line(-2, ['N1', 'N2'])), news)).toHaveLength(1)
    expect(sourceRuleChecks(body(line(-2, ['N1', 'N5'])), news)).toHaveLength(1) // trang tra cứu thứ cấp không tính
    expect(sourceRuleChecks(body(line(-2, ['N1', 'N3'])), news)).toHaveLength(0)
    expect(sourceRuleChecks(body(line(-3, ['N4'])), news)).toHaveLength(0)
    expect(sourceRuleChecks(body(line(-1, ['N1'])), news)).toHaveLength(0)
  })
})

describe('Đầu vào (tích hợp)', () => {
  let clock = Date.parse('2026-10-10T02:00:00.000Z')
  const h = harness({ env: { AGENT_MODE: 'external' }, now: () => new Date((clock += 1000)).toISOString() })
  const push = (id: string, kind: string, data: unknown) => h.DB.prepare("INSERT INTO external_outputs (id, kind, subject, status, created_at, data) VALUES (?, ?, NULL, 'READY', ?, ?)").bind(id, kind, new Date(clock).toISOString(), JSON.stringify(data)).run()
  const assessment = { importance: 'high', score: 8, doc_type: 'thong_tu', stage: 'lay_y_kien', why_changed: 'Thể chế hoá luật mới về phòng, chống rửa tiền, khắc phục bất cập giám sát hiện hành', key_points: ['Điều 2: đối tượng giám sát là đối tượng báo cáo'], impact_private: 'Khách Private không bị giám sát riêng, có thể phải cập nhật hồ sơ định kỳ', impact_tcb: 'Ngân hàng phải thống kê số khách theo nhóm và gắn nhãn dữ liệu khách hàng', recommended_action: 'analyze_now', sources: ['https://www.sbv.gov.vn/du-thao'] }
  const doc = (content: string, url = 'https://www.sbv.gov.vn/du-thao') => ({ title: 'Dự thảo Thông tư giám sát phòng, chống rửa tiền', agency: 'NHNN', kind: 'draft', status: 'Lấy ý kiến', published_at: '2026-10-01T08:00:00+07:00', url, topics: ['FX_OFFSHORE'], content })

  it('văn bản luật: mã băm, cờ cắt, xác nhận cần đối chiếu nội dung và đúng mã băm; nội dung mới cùng đường dẫn là phiên bản mới', async () => {
    await h.call(null, 'POST', '/api/bootstrap')
    const long = 'Điều 1. Phạm vi điều chỉnh\n' + 'Nội dung điều khoản dài. '.repeat(1200)
    await push('L1', 'policy_doc', { doc: doc(long), assessment })
    await h.ok('ADM1', 'POST', '/api/external/import')
    let d = (await h.ok('CMP1', 'GET', '/api/policies')).documents[0]
    expect(d).toMatchObject({ truncated: true, version: 1 })
    expect(d.original_length).toBeGreaterThan(20000)
    expect((await h.call('CMP1', 'POST', `/api/policies/${d.id}/confirm-source`, { note: 'ok', content_hash: d.content_hash })).status).toBe(422)
    expect((await h.call('CMP1', 'POST', `/api/policies/${d.id}/confirm-source`, { note: 'ok', content_checked: true, content_hash: 'sai' })).status).toBe(409)
    // Vòng dự thảo mới cùng đường dẫn, nội dung khác → phiên bản 2, bản cũ được đánh dấu đã có bản mới
    await push('L2', 'policy_doc', { doc: doc('Điều 1. Phạm vi điều chỉnh\nDự thảo lần 2 sửa phạm vi.'), assessment })
    await push('L3', 'policy_doc', { doc: doc('Điều 1. Phạm vi điều chỉnh\nDự thảo lần 2 sửa phạm vi.'), assessment })
    const imp = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(imp.policy_docs).toHaveLength(1)
    expect(imp.rejected.length).toBe(1)
    const docs = (await h.ok('CMP1', 'GET', '/api/policies')).documents
    const v1 = docs.find((x: any) => x.id === d.id), v2 = docs.find((x: any) => x.id !== d.id)
    expect(v1.superseded_by).toBe(v2.id)
    expect(v2).toMatchObject({ version: 2, previous_id: d.id })
    expect((await h.call('CMP1', 'POST', `/api/policies/${v1.id}/confirm-source`, { note: 'ok', content_checked: true, content_hash: v1.content_hash })).status).toBe(409)
    await h.ok('CMP1', 'POST', `/api/policies/${v2.id}/confirm-source`, { note: 'Đã đối chiếu với cổng NHNN', content_checked: true, content_hash: v2.content_hash })
    d = (await h.ok('CMP1', 'GET', '/api/policies')).documents.find((x: any) => x.id === v2.id)
    expect(d.state).toBe('SOURCE_CONFIRMED')
  })

  it('nguồn thứ cấp phải ghi đã đối chiếu bản gốc nào', async () => {
    await push('L4', 'policy_doc', { doc: doc('Điều 1. Nội dung tra cứu', 'https://thuvienphapluat.vn/van-ban/abc'), assessment: { ...assessment, sources: ['https://thuvienphapluat.vn/van-ban/abc'] } })
    await h.ok('ADM1', 'POST', '/api/external/import')
    const d = (await h.ok('CMP1', 'GET', '/api/policies')).documents.find((x: any) => x.url.includes('thuvienphapluat'))
    expect(d.secondary_source).toBe(true)
    expect((await h.call('CMP1', 'POST', `/api/policies/${d.id}/confirm-source`, { note: '', content_checked: true, content_hash: d.content_hash })).status).toBe(422)
  })

  it('nhật ký quét tin và lịch sự kiện; biến động thị trường từ khi có tin', async () => {
    await push('S1', 'scan_log', { date: '2026-10-10', groups: [{ group: 'Vĩ mô Mỹ', searched: true, found: 6, used: 2 }, { group: 'Trung Đông, dầu', searched: false, found: 0, used: 0, note: 'hết thời gian' }], dropped: [{ title: 'Tin trùng nội dung', url: 'https://vneconomy.vn/x', reason: 'trùng với tin đã dùng' }] })
    await h.ok('ADM1', 'POST', '/api/external/import')
    const q = await h.ok('CIO1', 'GET', '/api/quality')
    expect(q.scans[0].groups).toHaveLength(2)
    expect(q.scans[0].dropped[0].reason).toMatch(/trùng/)
    expect(q.calendar.find((c: any) => c.id === 'FOMC-2026-10').status).toBe('SCHEDULED')
    // Sau ngày họp Fed 3 ngày mà không có sự kiện → báo thiếu trên Tổng quan
    clock = Date.parse('2026-10-31T03:00:00Z')
    const a = await h.ok('CIO1', 'GET', '/api/ops/alerts')
    expect(a.calendar_missed.map((c: any) => c.id)).toContain('FOMC-2026-10')
  })

  it('biến động thị trường từ trước khi có tin tới quan sát mới nhất', async () => {
    await h.ok('ADM1', 'POST', '/api/admin/load-sample-events')
    const ev = (await h.ok('CIO1', 'GET', '/api/events'))[0]
    const first = ev.news?.[0]?.published_at ?? '2026-10-07T00:00:00Z'
    const d0 = new Date(Date.parse(first) - 3 * 864e5).toISOString().slice(0, 10)
    await push('M1', 'market_data', { points: [{ key: 'VNINDEX', date: d0, value: 1700, url: 'https://hsx.vn/a' }, { key: 'VNINDEX', date: '2026-10-20', value: 1666, url: 'https://hsx.vn/b' }] })
    await h.ok('ADM1', 'POST', '/api/external/import')
    const m = await h.ok('CIO1', 'GET', `/api/events/${ev.id}/market-moves`)
    expect(m.moves.find((x: any) => x.key === 'VNINDEX').move).toBe(-2)
  })
})

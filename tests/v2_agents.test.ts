// Thiết kế v2: tin theo ba nguồn, nghiên cứu độc quyền có cổng phát hành, nhánh kịch bản, dải tác động, luồng 2
import { beforeAll, describe, expect, it } from 'vitest'
import { harness } from './support/harness'
import { classifyOrigin } from '../src/news/classify'
import { keywordScenarios } from '../src/agents/keywordView'
import { exampleView } from './fixtures'

describe('Phân loại nguồn tin', () => {
  it('quốc tế, trong nước', () => {
    expect(classifyOrigin({ title: 'Fed giữ lãi suất, phát tín hiệu thắt chặt', summary: '' })).toBe('global')
    expect(classifyOrigin({ title: 'NHNN giữ lãi suất điều hành', summary: '' })).toBe('local')
    expect(classifyOrigin({ title: 'Tin bất kỳ', summary: '' }, 'global')).toBe('global')
    expect(classifyOrigin({ title: 'Giá vàng ngày 10/10 tăng mạnh', summary: 'SJC giữ giá' })).toBe('local')
  })
  it('nhánh kịch bản mô phỏng theo từ khóa', () => {
    const s = keywordScenarios([{ id: 'NW-1', title: 'NHNN tăng lãi suất', summary: '' }, { id: 'NW-2', title: 'Khối ngoại bán ròng', summary: '' }])!
    expect(s.branches.map(b => b.probability)).toEqual([0.7, 0.3])
    expect(s.branches[0].core_shocks).toEqual(expect.arrayContaining([{ factor: 'VN_RATE', size: 'M', direction: 'up' }, { factor: 'FOREIGN_FLOW', size: 'M', direction: 'down' }]))
    expect(keywordScenarios([{ id: 'NW-3', title: 'Đội tuyển thắng', summary: '' }])).toBeUndefined()
  })
})

describe('Nghiên cứu độc quyền: chỉ vào hệ thống sau khi Tuân thủ cho phát hành và tới giờ công bố', () => {
  const h = harness()
  beforeAll(async () => { const r = await h.call(null, 'POST', '/api/bootstrap'); if (r.status >= 400) throw new Error(JSON.stringify(r.data)) })
  let id = '', future = ''
  it('nạp báo cáo: chưa phát hành thì không hiện trong hộp tin, không lập được sự kiện', async () => {
    const r = await h.ok('CIO1', 'POST', '/api/research', { doc_no: 'TCB-RS-2026-118', title: 'Triển vọng lãi suất quý IV/2026', summary: 'House view: lãi suất điều hành đi ngang đến cuối năm, áp lực tỷ giá giảm nhờ USD suy yếu; ưu tiên trái phiếu chất lượng cao.', kind: 'house_view', published_at: '2026-01-01T02:00:00Z' })
    id = r.id
    expect(r).toMatchObject({ origin: 'exclusive', research: { status: 'PENDING_RELEASE' } })
    expect((await h.ok('CIO1', 'GET', '/api/news/inbox')).some((n: any) => n.id === id)).toBe(false)
    expect((await h.call('CIO1', 'POST', '/api/events/from-news', { news_ids: [id], type: 'monetary_policy' })).status).toBe(422)
    expect((await h.call('CIO1', 'POST', '/api/research', { doc_no: 'TCB-RS-2026-118', title: 'Trùng số báo cáo', summary: 'x'.repeat(50), published_at: '2026-01-01T02:00:00Z' })).status).toBe(409)
  })
  it('RM không nạp, không xem; người nạp không tự cho phát hành', async () => {
    expect((await h.call('RM1', 'GET', '/api/research')).status).toBe(403)
    expect((await h.call('CIO1', 'POST', `/api/research/${id}/release`, { approve: true, note: 'Tự duyệt báo cáo của mình không được phép' })).status).toBe(403)
  })
  it('Tuân thủ cho phát hành → hiện trong hộp tin nhãn độc quyền → lập sự kiện được', async () => {
    const r = await h.ok('CMP1', 'POST', `/api/research/${id}/release`, { approve: true, note: 'Đã phát hành chính thức, không chứa thông tin nội bộ chưa công bố' })
    expect(r.research.status).toBe('RELEASED')
    const inbox = await h.ok('CIO1', 'GET', '/api/news/inbox')
    expect(inbox.find((n: any) => n.id === id)).toMatchObject({ origin: 'exclusive' })
    const ev = await h.ok('CIO1', 'POST', '/api/events/from-news', { news_ids: [id], type: 'monetary_policy', title: 'House view lãi suất quý IV' })
    expect(ev.news[0].origin).toBe('exclusive')
  })
  it('đã phát hành nhưng giờ công bố còn ở tương lai: vẫn bị chặn', async () => {
    const r = await h.ok('ADM1', 'POST', '/api/research', { doc_no: 'TCB-RS-2030-001', title: 'Báo cáo phát hành năm 2030', summary: 'Báo cáo có giờ phát hành trong tương lai, không được đọc trước giờ công bố.', published_at: '2030-01-01T00:00:00Z' })
    future = r.id
    await h.ok('CMP1', 'POST', `/api/research/${future}/release`, { approve: true, note: 'Cho phát hành đúng giờ công bố chính thức' })
    expect((await h.ok('CIO1', 'GET', '/api/news/inbox')).some((n: any) => n.id === future)).toBe(false)
    expect((await h.call('CIO1', 'POST', '/api/events/from-news', { news_ids: [future], type: 'monetary_policy' })).status).toBe(422)
  })
})

describe('Nhánh kịch bản trong nhận định → dải tác động cho 20 gia đình', () => {
  const h = harness()
  beforeAll(async () => { const r = await h.call(null, 'POST', '/api/bootstrap'); if (r.status >= 400) throw new Error(JSON.stringify(r.data)); await h.ok('ADM1', 'POST', '/api/admin/load-sample-events') })
  let runId = ''
  it('nhận định có kịch bản: lần áp dụng có tóm tắt kịch bản, mỗi gia đình có dải ba kỳ hạn', async () => {
    const ev = await h.ok('CIO1', 'GET', '/api/events/EV-2026-0002')
    const src = ev.news[0].id
    const { event_id: _e, view_id: _v, event_type: _t, ...view } = exampleView()
    const scenarios = { priced_in: 'partial', branches: [
      { id: 'B1', name: 'Cơ sở: siết tín dụng như dự thảo', probability: 0.6, regime: 'calm', core_shocks: [{ factor: 'CREDIT_RE', size: 'M', direction: 'up' }, { factor: 'VN_EQ', size: 'S', direction: 'down' }], rationale: 'Dự thảo siết tín dụng bất động sản, tác động trước hết lên trái phiếu và cổ phiếu ngành', source_ids: [src] },
      { id: 'B2', name: 'Xấu: lan sang ngân hàng và thanh khoản', probability: 0.4, regime: 'stress', core_shocks: [{ factor: 'CREDIT_RE', size: 'L', direction: 'up' }, { factor: 'VN_EQ', size: 'M', direction: 'down' }, { factor: 'VN_RATE', size: 'S', direction: 'up' }], rationale: 'Nếu nợ xấu tăng, ngân hàng thận trọng hơn và lãi suất liên ngân hàng nhích lên', source_ids: [src] },
    ] }
    const r = await h.ok('CIO1', 'POST', '/api/manual-apply', { event_id: 'EV-2026-0002', view: { ...view, scenarios } })
    runId = r.run_id
    const run = await h.ok('CIO1', 'GET', `/api/runs/${runId}`)
    const s = (run.run ?? run).scenario_summary
    expect(s.families).toBe(20)
    expect(s.preview.branches).toHaveLength(2)
    expect(s.preview.expected.CREDIT_RE).toBeCloseTo((0.6 * 150 + 0.4 * 300) * 0.5, 6)
    const f1 = (await h.ok('CIO1', 'GET', `/api/runs/${runId}/families/DEMO-F01`)).result
    expect(f1.scenario.ranges).toHaveLength(3)
    expect(f1.scenario.ranges[1].bad).toBeLessThanOrEqual(f1.scenario.ranges[1].base)
    expect(['AUTO', 'RM_REVIEW']).toContain(f1.scenario.lane2.route)
  })
  it('tính lại từ ảnh chụp ra đúng dải', async () => {
    const r = await h.ok('CMP1', 'POST', `/api/runs/${runId}/recompute`)
    expect(r.all_equal).toBe(true)
  })
  it('kịch bản sai (tổng xác suất ≠ 1) bị từ chối', async () => {
    const { event_id: _e, view_id: _v, event_type: _t, ...view } = exampleView()
    const ev = await h.ok('CIO1', 'GET', '/api/events/EV-2026-0002')
    const bad = { priced_in: 'none', branches: [0.5, 0.2].map((p, i) => ({ id: `B${i}`, name: 'Nhánh thử', probability: p, regime: 'calm', core_shocks: [{ factor: 'VN_EQ', size: 'S', direction: 'down' }], rationale: 'Lập luận đủ dài để qua kiểm tra độ dài', source_ids: [ev.news[0].id] })) }
    expect((await h.call('CIO1', 'POST', '/api/manual-apply', { event_id: 'EV-2026-0002', view: { ...view, scenarios: bad } })).status).toBe(422)
  })
})

// Agent Rà soát pháp luật: văn bản mới kèm đánh giá vào radar, chờ Tuân thủ xác nhận nguồn
import { beforeAll, describe, expect, it } from 'vitest'
import { harness } from './support/harness'
import { confirmPolicy } from './support/policy'

const h = harness({ env: { AGENT_MODE: 'external' } })
let seq = 0
const push = (kind: string, data: unknown) => h.DB.prepare("INSERT INTO external_outputs (id, kind, subject, status, created_at, data) VALUES (?, ?, NULL, 'READY', ?, ?)").bind(`LS-${++seq}`, kind, '2026-10-10T01:00:00.000Z', JSON.stringify(data)).run()
const assessment = {
  importance: 'high', score: 8, doc_type: 'luat', stage: 'thao_luan_quoc_hoi', expected_adoption: '2026-12-10',
  why_changed: 'Luật hiện hành chưa đánh thuế thu nhập từ chuyển nhượng vốn theo lãi thực, gây bất công giữa các loại tài sản',
  key_points: ['Điều 9: thuế chuyển nhượng chứng khoán theo thu nhập tính thuế thay cho 0,1% giá bán'],
  impact_private: 'Khách có danh mục cổ phiếu lớn có thể chịu thuế cao hơn khi chốt lãi; cần xem lại kế hoạch bán',
  impact_tcb: 'Công ty chứng khoán và ngân hàng lưu ký phải điều chỉnh hệ thống khấu trừ thuế và báo cáo',
  recommended_action: 'analyze_now', sources: ['https://quochoi.vn/du-thao-luat-thue-tncn'],
}
const doc = { title: 'Dự thảo Luật Thuế thu nhập cá nhân (sửa đổi)', agency: 'Bộ Tài chính', kind: 'draft', status: 'Trình Quốc hội', published_at: '2026-10-09T08:00:00+07:00', url: 'https://quochoi.vn/du-thao-luat-thue-tncn', topics: ['TAX_SECURITIES'], content: 'Điều 9. Thu nhập từ chuyển nhượng chứng khoán ...' }

beforeAll(async () => { const r = await h.call(null, 'POST', '/api/bootstrap'); if (r.status >= 400) throw new Error(JSON.stringify(r.data)) })

describe('Văn bản do Agent Rà soát pháp luật tìm', () => {
  it('vào radar ở trạng thái chờ Tuân thủ xác nhận, có đánh giá; trùng đường dẫn hoặc thiếu đánh giá bị từ chối', async () => {
    await push('policy_doc', { doc, assessment, meta: { model: 'claude-opus-5-5', session: 'S1' } })
    await push('policy_doc', { doc, assessment, meta: { model: 'claude-opus-5-5', session: 'S1' } })
    await push('policy_doc', { doc: { ...doc, url: 'https://quochoi.vn/khac' }, assessment: { ...assessment, why_changed: 'ngắn' } })
    await push('policy_doc', { doc: { ...doc, url: 'https://blog-ca-nhan.example/x' }, assessment: { ...assessment, sources: ['https://blog-ca-nhan.example/x'] } })
    const r = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(r.policy_docs.length).toBe(1)
    expect(r.rejected.length).toBe(3)
    const radar = await h.ok('CMP1', 'GET', '/api/policies')
    const d = radar.documents.find((x: any) => x.id === r.policy_docs[0])
    expect(d).toMatchObject({ state: 'PENDING_SOURCE_CONFIRM', origin: 'ai_scan', ai_assessment: { importance: 'high', score: 8, model: 'claude-opus-5-5' } })
    // Agent Chính sách chưa chạy được khi Tuân thủ chưa xác nhận nguồn
    expect((await h.call('CIO1', 'POST', `/api/policies/${d.id}/analyze`)).status).toBe(409)
    await confirmPolicy(h, d.id, 'Đã kiểm tra trên cổng Quốc hội')
    const list = await h.ok('CIO1', 'GET', '/api/external')
    expect(list.filter((x: any) => x.status === 'REJECTED').map((x: any) => x.error).join(' ')).toMatch(/đã có trên radar|why_changed|không thuộc danh sách/)
  })

  it('đánh số tiếp theo mã lớn nhất đã có, kể cả khi văn bản mẫu được nạp với mã cố định', async () => {
    const loaded = await h.ok('ADM1', 'POST', '/api/admin/load-sample-policies')
    await push('policy_doc', { doc: { ...doc, url: 'https://quochoi.vn/van-ban-moi' }, assessment: { ...assessment, sources: ['https://quochoi.vn/van-ban-moi'] }, meta: { model: 'claude-opus-5-5', session: 'S2' } })
    const r = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(r.rejected).toEqual([])
    expect(r.policy_docs.length).toBe(1)
    const ids = (await h.ok('CMP1', 'GET', '/api/policies')).documents.map((x: any) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(loaded.loaded.every((id: string) => ids.includes(id))).toBe(true)
  })
})

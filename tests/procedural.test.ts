// Nhánh tác động lên mục tiêu: quy định không đổi giá tài sản nhưng ảnh hưởng mục tiêu có dòng tiền ra nước ngoài
import { beforeAll, describe, expect, it } from 'vitest'
import { harness } from './support/harness'
import { crossBorderOf, matchProcedural, proceduralErrors } from '../src/engine/procedural'
import type { Goal, ProceduralNote } from '../src/shared/types'

const goal = (p: Partial<Goal>): Goal => ({ id: 'GL-X', family_id: 'DEMO-F01', name: 'Mục tiêu', type: 'other', year: 2027, month: 3, amount: '1', currency: 'VND', basis: 'nominal', cost_growth: '0', spend: { kind: 'once' }, priority: 'important', annual_contribution: '0', source_note: 'x', status: 'active', earmarks: [], ...p })
const NOTE: ProceduralNote = {
  regulation: 'Dự thảo Thông tư về giám sát phòng, chống rửa tiền trong lĩnh vực tiền tệ, ngân hàng', status: 'draft',
  applies_to: ['study', 'emigration', 'overseas_invest'], lead_time_weeks: 8, documents: ['Chứng minh nguồn tiền', 'Hồ sơ mục đích chuyển tiền'],
  client_message: 'Quy định về chuyển tiền ra nước ngoài có thể thay đổi. Anh/chị nên chuẩn bị sớm hồ sơ nguồn tiền để khoản chi không bị chậm.',
  rm_talking_points: 'Hẹn khách rà soát hồ sơ nguồn tiền trước khoản chuyển gần nhất; văn bản còn là dự thảo.',
}

describe('Khớp mục tiêu có dòng tiền ra nước ngoài', () => {
  it('suy từ tên khi RM chưa khai báo, không nhầm tên người', () => {
    expect(crossBorderOf(goal({ name: 'Du học Úc cho Minh Châu', type: 'education' }))).toEqual({ purpose: 'study', country: 'Úc', inferred: true })
    expect(crossBorderOf(goal({ name: 'Nghỉ hưu ở nước ngoài', type: 'retirement' }))).toMatchObject({ purpose: 'emigration', inferred: true })
    expect(crossBorderOf(goal({ name: 'Đại học cho Minh Đức', type: 'education' }))).toBeNull()
    expect(crossBorderOf(goal({ name: 'Mua nhà cho con', type: 'purchase' }))).toBeNull()
    expect(crossBorderOf(goal({ name: 'Quỹ', cross_border: { purpose: 'overseas_invest', country: 'Singapore' } }))).toEqual({ purpose: 'overseas_invest', country: 'Singapore', inferred: false })
  })
  it('mức khẩn theo khoảng cách tới khoản chi; dự thảo không yêu cầu liên hệ ngay', () => {
    const notes = [{ id: 'NW-1', doc_no: 'D1', title: 't', published_at: '2026-10-01T00:00:00Z', procedural: NOTE }]
    const goals = [goal({ id: 'G1', name: 'Du học Úc', type: 'education', year: 2027, month: 3 }), goal({ id: 'G2', name: 'Định cư Canada', year: 2028, month: 6 }), goal({ id: 'G3', name: 'Nghỉ hưu ở nước ngoài', type: 'retirement', year: 2033, month: 1 }), goal({ id: 'G4', name: 'Mua nhà', type: 'purchase' })]
    const a = matchProcedural(notes, goals, '2026-10-10T00:00:00Z')
    expect(a.map(x => [x.goal_id, x.tier])).toEqual([['G1', 'remind'], ['G2', 'remind'], ['G3', 'note']])
    expect(a[0].reason).toContain('dự thảo')
    const issued = matchProcedural([{ ...notes[0], procedural: { ...NOTE, status: 'issued' } }], goals, '2026-10-10T00:00:00Z')
    expect(issued[0]).toMatchObject({ goal_id: 'G1', tier: 'contact', prepare_by: '2026-12-07' })
    // khoản chi trước ngày hiệu lực → chỉ ghi chú
    expect(matchProcedural([{ ...notes[0], procedural: { ...NOTE, status: 'issued', effective_date: '2027-07-01' } }], goals, '2026-10-10T00:00:00Z').find(x => x.goal_id === 'G1')).toMatchObject({ tier: 'note' })
  })
  it('thông điệp cho khách không được nhắc tới hồ sơ rủi ro rửa tiền', () => {
    expect(proceduralErrors(NOTE)).toEqual([])
    expect(proceduralErrors({ ...NOTE, client_message: 'Anh/chị thuộc nhóm khách hàng PEP nên giao dịch chuyển tiền sẽ bị giám sát tăng cường.' }).join()).toContain('không được nhắc PEP')
    expect(proceduralErrors({ ...NOTE, applies_to: [] }).length).toBe(1)
  })
})

describe('Ghi chú quy định qua cổng phát hành tới thẻ mục tiêu', () => {
  const h = harness()
  beforeAll(async () => { const r = await h.call(null, 'POST', '/api/bootstrap'); if (r.status >= 400) throw new Error(JSON.stringify(r.data)) })
  let id = ''
  it('nạp, Tuân thủ phát hành; không vào hộp tin giá, không lập được sự kiện giá', async () => {
    expect((await h.call('ADM1', 'POST', '/api/research', { doc_no: 'TCB-LG-2026-07', title: 'Ghi chú quy định: giám sát phòng, chống rửa tiền', summary: 'Dự thảo Thông tư của NHNN về giám sát phòng, chống rửa tiền; tác động gián tiếp tới hồ sơ chuyển tiền ra nước ngoài.', kind: 'regulatory_note', published_at: '2026-10-01T00:00:00Z', procedural: { ...NOTE, documents: [] } })).status).toBe(422)
    const r = await h.ok('ADM1', 'POST', '/api/research', { doc_no: 'TCB-LG-2026-07', title: 'Ghi chú quy định: giám sát phòng, chống rửa tiền', summary: 'Dự thảo Thông tư của NHNN về giám sát phòng, chống rửa tiền; tác động gián tiếp tới hồ sơ chuyển tiền ra nước ngoài.', kind: 'regulatory_note', published_at: '2026-10-01T00:00:00Z', procedural: NOTE })
    id = r.id
    expect((await h.ok('RM1', 'GET', '/api/families/DEMO-F01/procedural'))).toEqual([])
    await h.ok('CMP1', 'POST', `/api/research/${id}/release`, { approve: true, note: 'Đã rà soát: thông điệp chung, không nhắc hồ sơ rủi ro của khách' })
    const inbox = await h.ok('CIO1', 'GET', '/api/news/inbox').catch(() => null)
    if (inbox) expect(JSON.stringify(inbox)).not.toContain(id)
    expect((await h.call('CIO1', 'POST', '/api/events/from-news', { news_ids: [id], type: 'policy' })).status).toBe(422)
  })
  it('RM thấy cảnh báo trên mục tiêu của gia đình mình; khách khác không', async () => {
    await h.ok('RM1', 'POST', '/api/families/DEMO-F01/goals', { name: 'Du học Úc cho con', type: 'education', year: 2027, month: 3, amount: '1800000000', source_note: 'Theo trao đổi với khách ngày 14/10', cross_border: { purpose: 'study', country: 'Úc' } })
    const a = await h.ok('RM1', 'GET', '/api/families/DEMO-F01/procedural')
    expect(a.map((x: any) => x.goal_name)).toEqual(['Du học Úc cho con', 'Du học cho Minh Châu'])
    expect(a[0]).toMatchObject({ tier: 'remind', inferred: false, country: 'Úc' })
    expect(a[1]).toMatchObject({ inferred: true })
    expect((await h.call('RM1', 'GET', '/api/families/DEMO-F17/procedural')).status).toBe(403)
    const book = await h.ok('RM1', 'GET', '/api/procedural')
    expect(new Set(book.alerts.map((x: any) => x.family_id))).toEqual(new Set(['DEMO-F01']))
    const all = await h.ok('CIO1', 'GET', '/api/procedural')
    expect(all.notes[0]).toMatchObject({ id, families: 2 })
  })
})

// Agent Chính sách v2: năm câu cho mỗi thay đổi, nhãn căn cứ/suy luận + tin cậy, phân tích trọng yếu cho khách Private
import { beforeAll, describe, expect, it } from 'vitest'
import { quoteInText, validatePolicySummary } from '../src/shared/schemas'
import { DEFAULT_BANNED_PHRASES } from '../src/shared/catalog'
import p1 from '../data/mock_agent/policy/PD-2026-001.json'
import sample1 from '../data/seed/policies/sample/PD-2026-001.json'
import { harness } from './support/harness'

const clone = () => JSON.parse(JSON.stringify(p1))
const run = (raw: unknown) => validatePolicySummary(raw, sample1.content, 'draft', DEFAULT_BANNED_PHRASES)

describe('Kiểm tra tóm tắt chính sách v2', () => {
  it('bản mẫu hợp lệ và trả về phân tích trọng yếu cho khách Private', () => {
    const r = run(p1)
    expect(r.errors).toEqual([])
    expect(r.brief?.key_findings.length).toBeGreaterThan(0)
  })

  it('tóm tắt kiểu cũ (chỉ có changes) bị từ chối', () => {
    const r = run({ changes: p1.changes.map(({ analysis, before, materiality, ...c }) => c) })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/private_brief|analysis/)
  })

  it('trích dẫn không có nguyên văn trong văn bản bị từ chối, kể cả trích dẫn làm căn cứ', () => {
    const a = clone(); a.changes[0].quote = 'Thuế suất 25% trên phần chênh lệch.'
    expect(run(a).errors.join(' ')).toMatch(/C1: quote không khớp nguyên văn/)
    const b = clone()
    b.changes[0].analysis.goal = { ...b.changes[0].analysis.goal, basis: 'evidence', confidence: 'high', evidence: { quote: 'áp dụng thuế suất 3% trên giá chuyển nhượng' } }
    expect(run(b).errors.join(' ')).toMatch(/C1\.goal: câu trích không khớp/)
    const c = clone(); c.changes[0].analysis.private_impact.evidence = { quote: '2%' }
    expect(run(c).errors.join(' ')).toMatch(/C1\.private_impact: câu trích làm căn cứ quá ngắn/)
    const e = clone(); e.changes[0].analysis.private_impact.evidence = { quote: '...' }
    expect(run(e).ok).toBe(false)
  })

  it('so nguyên văn bỏ qua khác biệt khoảng trắng và kiểu dấu ngoặc, nhưng không bỏ qua chữ', () => {
    expect(quoteInText('“Bất động sản nắm giữ  dưới 2 năm”', 'Bất động sản nắm giữ dưới 2 năm chịu thuế')).toBe(true)
    expect(quoteInText('Bất động sản nắm giữ dưới 3 năm', 'Bất động sản nắm giữ dưới 2 năm chịu thuế')).toBe(false)
  })

  it('suy luận phải có lập luận; căn cứ phải dẫn điều khoản có thật; dự báo không được tin cậy cao', () => {
    const a = clone(); delete a.changes[0].analysis.why.reasoning
    expect(run(a).errors.join(' ')).toMatch(/C1\.why: nhận định "suy luận" phải nêu lập luận/)
    const b = clone(); b.changes[0].analysis.private_impact.evidence = { article_ref: 'Điều 12 khoản 4' }
    expect(run(b).errors.join(' ')).toMatch(/Điều 12 khoản 4" không có trong văn bản/)
    const c = clone(); c.changes[0].analysis.next_signal.confidence = 'high'
    expect(run(c).errors.join(' ')).toMatch(/next_signal: dự báo .* không thể có độ tin cậy cao/)
  })

  it('thay đổi trọng yếu cao phải nằm trong phát hiện chính; phát hiện phải trỏ tới thay đổi có thật', () => {
    const a = clone(); a.private_brief.key_findings = a.private_brief.key_findings.filter((k: any) => !k.change_ids.includes('C1'))
    expect(run(a).errors.join(' ')).toMatch(/C1: thay đổi trọng yếu cao phải có trong phát hiện chính/)
    const b = clone(); b.private_brief.segments[0].change_ids = ['C9']
    expect(run(b).errors.join(' ')).toMatch(/segments\[0\]: không có thay đổi C9/)
  })

  it('cụm từ khuyến nghị mua bán hoặc giao việc bị chặn, trừ khi nằm trong câu trích nguyên văn', () => {
    const a = clone(); a.private_brief.advisor_message = 'Khách nên bán bất động sản trước khi luật có hiệu lực để khoá mức 2%, RM chủ trì liên hệ.'
    const e = run(a).errors.join(' ')
    expect(e).toMatch(/"nên bán"/)
    expect(e).toMatch(/"chủ trì"/)
    const b = clone(); b.private_brief.advisor_message = 'Khách nên bán'.normalize('NFD') + ' bất động sản trước khi luật có hiệu lực, đây là thông điệp mẫu.'
    expect(run(b).errors.join(' ')).toMatch(/"nên bán"/)
  })
})

describe('Radar hiển thị phân tích trọng yếu', () => {
  const h = harness()
  beforeAll(async () => { const r = await h.call(null, 'POST', '/api/bootstrap'); if (r.status >= 400) throw new Error(JSON.stringify(r.data)) })

  it('sau khi phân tích, radar trả private_brief và năm câu cho mỗi thay đổi', async () => {
    await h.ok('ADM1', 'POST', '/api/admin/load-sample-policies')
    await h.ok('CMP1', 'POST', '/api/policies/PD-2026-002/confirm-source', { note: 'Đã kiểm tra' })
    await h.ok('ADM1', 'POST', '/api/policies/PD-2026-002/analyze')
    const d = (await h.ok('RM1', 'GET', '/api/policies')).documents.find((x: any) => x.id === 'PD-2026-002')
    expect(d.private_brief.headline).toMatch(/giữa cha mẹ và con/)
    expect(d.changes.every((c: any) => c.analysis?.why && c.analysis?.private_impact && c.materiality)).toBe(true)
  })
})

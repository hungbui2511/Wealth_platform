// Chế độ external: Claude lập kết quả trong phiên làm việc, ghi vào external_outputs; hệ thống nhập qua đúng kiểm soát.
import { beforeAll, describe, expect, it } from 'vitest'
import { harness } from './support/harness'
import { ASSET_CLASSES } from '../src/shared/catalog'

const h = harness({ env: { AGENT_MODE: 'external' } })
let seq = 0
async function push(kind: string, subject: string | null, data: unknown) {
  // Đúng câu lệnh Claude dùng khi đẩy kết quả lên D1
  await h.DB.prepare("INSERT INTO external_outputs (id, kind, subject, status, created_at, data) VALUES (?, ?, ?, 'READY', ?, ?)").bind(`EXT-T-${++seq}`, kind, subject, '2026-10-10T01:00:00.000Z', JSON.stringify(data)).run()
}
const U1 = 'https://vnexpress.net/nhnn-giu-nguyen-lai-suat-1.html', U2 = 'https://baodautu.vn/lai-suat-huy-dong-2.html', U3 = 'https://vneconomy.vn/gia-vang-3.html', BAD = 'https://dien-dan.example/x'
const view = (src: string, cashLevel = 1) => ({
  summary: 'Lãi suất huy động nhích lên, lợi thế cho tiền gửi',
  impacts: [...ASSET_CLASSES.map(ac => ac === 'CASH'
    ? { scope: 'asset_class', asset_class: 'CASH', target: 'CASH', level: cashLevel, direction: cashLevel > 0 ? 'positive' : 'negative', horizon: '1-3 tháng', confidence: 'medium', rationale: 'Nhiều ngân hàng tăng lãi suất huy động kỳ hạn 12 tháng theo tin', source_ids: [src] }
    : { scope: 'asset_class', asset_class: ac, target: ac, level: 0, direction: 'insufficient_evidence', rationale: 'Tin không đủ căn cứ cho loại tài sản này', source_ids: [] }),
    ...['USD', 'SGD', 'AUD'].map(c => ({ scope: 'fx', target: c, level: 0, direction: 'neutral', rationale: 'Tin không nhắc tới tỷ giá trong kỳ này', source_ids: [] }))],
})

beforeAll(async () => { const r = await h.call(null, 'POST', '/api/bootstrap'); if (r.status >= 400) throw new Error(JSON.stringify(r.data)); await h.ok('ADM1', 'POST', '/api/admin/load-sample-events') })

describe('Nhập kết quả Claude', () => {
  it('tin → hộp tin (lọc nguồn công khai), sự kiện, nhận định qua schema và phản biện, chờ CIO duyệt', async () => {
    await push('news', null, { items: [
      { title: 'NHNN giữ nguyên lãi suất điều hành', url: U1, published_at: '2026-10-09T08:00:00+07:00', summary: 'Ngân hàng Nhà nước giữ nguyên lãi suất', suggested_type: 'monetary_policy' },
      { title: 'Nhiều ngân hàng tăng lãi suất huy động', url: U2, published_at: '2026-10-09T09:00:00+07:00', summary: 'Lãi suất kỳ hạn 12 tháng tăng 0,2 điểm %' },
      { title: 'Tin diễn đàn', url: BAD, published_at: '2026-10-09T09:00:00+07:00', summary: 'Không thuộc nguồn công khai' },
    ] })
    await push('event', null, { ref: 'CL-1', type: 'monetary_policy', title: 'Lãi suất huy động tăng', news_urls: [U1, U2] })
    await push('cio_view', 'CL-1', { view: view(U2), nodes: { debate: { topics: [] } }, challenger: { findings: [{ check: 'overconfidence', severity: 'medium', target: 'asset_class:CASH:CASH', issue: 'Mức +1 dựa trên một nhóm ngân hàng, có thể chưa đại diện', suggestion: 'Giữ +1 nhưng hạ độ tin cậy xuống thấp', source_ids: [U2] }], counter_scenario: 'Lãi suất huy động quay đầu giảm' }, meta: { model: 'Claude Opus 5.5', session: 'test' } })
    const r = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(r.news).toMatchObject({ created: 2, rejected: 1 })
    expect(r.events.length).toBe(1)
    expect(r.views).toEqual([{ view_id: expect.stringMatching(/^VW-/), status: 'PENDING_APPROVAL' }])
    const d = await h.ok('CIO1', 'GET', `/api/views/${r.views[0].view_id}`)
    const cash = d.view.body.impacts.find((l: any) => l.target === 'CASH')
    expect(cash.source_ids[0]).toMatch(/^NW-/) // đường dẫn đã đổi sang mã tin của sự kiện
    expect(d.challenges[0].model).toContain('Claude – phiên làm việc')
    expect(d.challenges[0].findings.some((f: any) => f.origin === 'llm' && f.check === 'overconfidence')).toBe(true)
    const trace = await h.ok('CIO1', 'GET', `/api/agent-runs/${d.view.agent_run_id}`)
    expect(trace.run.mode).toBe('external')
    const list = await h.ok('CIO1', 'GET', '/api/external')
    expect(list.every((x: any) => x.status === 'IMPORTED' || x.status === 'REJECTED')).toBe(true)
    // Nhập lại không tạo trùng
    const again = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(again.views ?? []).toEqual([])
  })

  it('CIO yêu cầu Làm lại: hệ thống chờ Claude; Claude đẩy phiên bản mới, tác vụ hoàn tất', async () => {
    const vid = (await h.ok('CIO1', 'GET', '/api/external')).find((x: any) => x.kind === 'cio_view').result.view_id
    const r = await h.ok('CIO1', 'POST', `/api/views/${vid}/decision`, { action: 'REWORK', reason: 'Cần đánh giá thêm tác động lên trái phiếu Chính phủ' })
    expect(r.job.status).toBe('WAITING_EXTERNAL')
    const active = await h.ok('CIO1', 'GET', '/api/jobs?active=1')
    expect(active.some((j: any) => j.id === r.job.id)).toBe(true)
    await push('cio_view', r.job.subject, { rework: true, view: view(U2, 1), meta: { model: 'Claude Opus 5.5' } })
    const imp = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(imp.views[0].view_id).toBe(vid.replace('-v1', '-v2'))
    const j = await h.ok('CIO1', 'GET', `/api/jobs/${r.job.id}`)
    expect(j.status).toBe('DONE')
    expect((await h.ok('CIO1', 'GET', `/api/views/${imp.views[0].view_id}`)).view.instructions).toContain('trái phiếu Chính phủ')
  })

  it('Bấm Chạy Agent CIO trên sự kiện tin thật: tạo yêu cầu chờ Claude; sự kiện mẫu vẫn chạy ngay', async () => {
    await push('news', null, { items: [{ title: 'Giá vàng tăng mạnh', url: U3, published_at: '2026-10-09T10:00:00+07:00', summary: 'Vàng miếng SJC tăng' }] })
    await h.ok('ADM1', 'POST', '/api/external/import')
    const inbox = await h.ok('CIO1', 'GET', '/api/news/inbox')
    const ev = await h.ok('CIO1', 'POST', '/api/events/from-news', { news_ids: inbox.map((n: any) => n.id), type: 'commodity' })
    const r = await h.ok('CIO1', 'POST', `/api/events/${ev.event.id}/run-agent`)
    expect(r.job).toMatchObject({ status: 'WAITING_EXTERNAL', kind: 'cio_run' })
    const sample = await h.ok('CIO1', 'POST', '/api/events/EV-2026-0003/run-agent')
    expect(sample.status).toBe('PENDING_APPROVAL')
  })

  it('Kết quả sai schema (thiếu dòng bắt buộc): nhận định thành AGENT_ERROR, không tới bàn duyệt', async () => {
    const inbox = await h.ok('CIO1', 'GET', '/api/jobs?active=1')
    const job = inbox.find((j: any) => j.kind === 'cio_run')
    const v = view(U3); v.impacts = v.impacts.filter((l: any) => l.target !== 'GOLD')
    await push('cio_view', job.subject, { view: v, meta: { model: 'Claude Opus 5.5' } })
    const imp = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(imp.views[0].status).toBe('AGENT_ERROR')
    const a = await h.ok('CMP1', 'GET', '/api/audit?action=external.imported')
    expect(a.length).toBeGreaterThan(0)
  })
})

describe('Miền chưa thuộc danh sách nguồn công khai', () => {
  it('giữ chờ (không hủy) để Tuân thủ xem xét; tin vẫn không vào hệ thống', async () => {
    await push('news', null, { items: [{ title: 'Lãi suất liên ngân hàng tăng', url: 'https://cafef.vn/lai-suat-lnh.chn', published_at: '2026-10-09T08:00:00+07:00', summary: 'Lãi suất liên ngân hàng tăng' }] })
    const r = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(r.news.created).toBe(0)
    expect(r.waiting.some((w: any) => w.reason.includes('danh sách nguồn công khai'))).toBe(true)
    const row = (await h.ok('CIO1', 'GET', '/api/external')).find((x: any) => x.id === `EXT-T-${seq}`)
    expect(row.status).toBe('READY')
  })
})

describe('Giá thật do Claude đẩy lên', () => {
  it('tạo ảnh chụp giá mới, thay giá có nguồn, giữ nguyên mã chưa có giá thật; từ chối mã lạ', async () => {
    const before = await h.ok('CIO1', 'GET', '/api/families/DEMO-F01')
    await push('prices', null, { price_date: '2026-10-09', points: [
      { key: 'MBB', price: '26150', date: '2026-10-09', source: 'TCBS (MCP)', source_ref: 'getTickerOverview' },
      { key: 'SJC', price: '141800000', date: '2026-10-09', source: 'SJC qua Báo Nhân Dân', source_ref: 'https://nhandan.vn/x' },
      { key: 'FX:USD', price: '25690', date: '2026-10-09', source: 'Vietcombank' },
    ] })
    const r = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(r.prices.length).toBe(1)
    // Giá do AI lấy chưa được dùng cho tới khi người xác nhận
    const pending = await h.ok('CIO1', 'GET', '/api/families/DEMO-F01')
    expect(pending.positions.find((p: any) => p.instrument_id === 'MBB').price).toBe(before.positions.find((p: any) => p.instrument_id === 'MBB').price)
    expect((await h.call('RM1', 'POST', `/api/prices/snapshots/${r.prices[0]}/confirm`, { decision: 'confirm', note: 'Đã đối chiếu giá với TCBS và Vietcombank' })).status).toBe(403)
    await h.ok('CIO1', 'POST', `/api/prices/snapshots/${r.prices[0]}/confirm`, { decision: 'confirm', note: 'Đã đối chiếu giá với TCBS và Vietcombank' })
    const after = await h.ok('CIO1', 'GET', '/api/families/DEMO-F01')
    const mbb = after.positions.find((p: any) => p.instrument_id === 'MBB')
    expect(mbb.price).toBe('26150')
    expect(mbb.price_source).toBe('TCBS (MCP)')
    expect(after.positions.find((p: any) => p.instrument_id === 'VEOF').price_source).toBe(before.positions.find((p: any) => p.instrument_id === 'VEOF').price_source)
    expect(after.totals.net_worth).not.toBe(before.totals.net_worth)
    await push('prices', null, { price_date: '2026-10-09', points: [{ key: 'KHONGCO', price: '1', date: '2026-10-09', source: 'x' }] })
    const bad = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(bad.waiting.some((w: any) => w.reason.includes('danh mục công cụ'))).toBe(true)
    await push('prices', null, { price_date: '2026-10-09', points: [{ key: 'MBB', price: 'abc', date: '2026-10-09', source: 'x' }] })
    expect((await h.ok('ADM1', 'POST', '/api/external/import')).rejected.length).toBe(1)
  })
})

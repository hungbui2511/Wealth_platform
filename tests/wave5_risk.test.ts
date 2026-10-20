// Đợt 5 sau phản biện độc lập: dải căng thẳng lịch sử cạnh dải mô hình, gộp sự kiện đang hiệu lực theo yếu tố có bán rã,
// làn ưu tiên cho CIO theo mức trọng yếu P10, bản tin tuần cho RM.
import { describe, expect, it } from 'vitest'
import { decay } from '../src/worker/services/netting'
import { harness } from './support/harness'

describe('Bán rã', () => {
  it('sau một chu kỳ còn một nửa, không âm khi tuổi âm', () => {
    expect(decay(30, 30)).toBeCloseTo(0.5)
    expect(decay(60, 30)).toBeCloseTo(0.25)
    expect(decay(-5, 30)).toBe(1)
  })
})

describe('Rủi ro (tích hợp)', () => {
  let clock = Date.parse('2026-10-10T02:00:00.000Z')
  const h = harness({ now: () => new Date((clock += 1000)).toISOString() })
  let viewId = ''

  it('làn ưu tiên: chạy thử trước khi duyệt, chỉ trả số tổng hợp, không lộ gia đình', async () => {
    await h.call(null, 'POST', '/api/bootstrap')
    await h.ok('ADM1', 'POST', '/api/admin/load-sample-events')
    const v = await h.ok('CIO1', 'POST', '/api/events/EV-2026-0005/run-agent')
    viewId = v.id
    const m = await h.ok('CIO1', 'GET', '/api/views/materiality')
    const x = m.find((y: any) => y.view_id === viewId)
    expect(x).toBeTruthy()
    expect(['FAST', 'NORMAL']).toContain(x.lane)
    expect(x.families).toBe(20)
    expect(x.due_by).toBeTruthy()
    expect(JSON.stringify(m)).not.toMatch(/DEMO-F\d/)
    expect((await h.call('RM1', 'GET', '/api/views/materiality')).status).toBe(403)
  })

  it('dải căng thẳng lịch sử đi kèm kết quả từng gia đình', async () => {
    const r = await h.ok('CIO1', 'POST', `/api/views/${viewId}/decision`, { action: 'APPROVE', reason: 'Duyệt nhận định tỷ giá USD tăng mạnh' })
    const res = (await h.ok('CIO1', 'GET', `/api/runs/${r.run_id}/families/DEMO-F01`)).result
    expect(res.scenario.analog_bands.map((b: any) => b.analog_id)).toEqual(['VN-2022', 'VN-2025-04'])
    const worst = Math.min(...res.scenario.ranges.map((x: any) => x.severe))
    for (const b of res.scenario.analog_bands) expect(b.beyond_model).toBe(b.total < worst)
    if (res.scenario.analog_bands.some((b: any) => b.beyond_model)) expect(res.scenario.tail_note).toMatch(/đuôi/)
  })

  it('gộp theo yếu tố: hai sự kiện cùng đẩy một yếu tố bị nêu nguy cơ đếm hai lần; bán rã theo tuổi', async () => {
    const n1 = await h.ok('CIO1', 'GET', '/api/book/netting')
    expect(n1.runs).toHaveLength(1)
    expect(n1.runs[0].weight).toBeCloseTo(1, 2)
    // Thêm một lần áp dụng giả cùng cú sốc, có hiệu lực 30 ngày trước
    const row = (await h.DB.prepare("SELECT data FROM application_runs WHERE status = 'EFFECTIVE'").first<{ data: string }>())!
    const run = JSON.parse(row.data)
    const old = { ...run, id: 'AR-TEST-OLD', event_id: 'EV-TEST', idem_key: 'test:old', effective_at: new Date(clock - 30 * 864e5).toISOString() }
    await h.DB.prepare('INSERT INTO application_runs (id, view_id, event_id, status, idem_key, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(old.id, old.view_id, old.event_id, 'EFFECTIVE', old.idem_key, old.created_at, JSON.stringify(old)).run()
    const n2 = await h.ok('CIO1', 'GET', '/api/book/netting')
    expect(n2.runs.find((x: any) => x.run_id === 'AR-TEST-OLD').weight).toBeCloseTo(0.5, 2)
    const usd = n2.factors.USDVND
    expect(usd.net).toBeCloseTo(n1.factors.USDVND.net * 1.5, 1)
    expect(n2.warnings.some((w: any) => w.factor === 'USDVND' && w.kind === 'double_count')).toBe(true)
    expect((await h.call('RM1', 'GET', '/api/book/netting')).status).toBe(403)
    await h.DB.prepare("DELETE FROM application_runs WHERE id = 'AR-TEST-OLD'").run()
  })

  it('bản tin tuần RM: chỉ gia đình của mình, có tác động và mục chưa xem; vai trò khác bị chặn', async () => {
    const me = await h.ok('RM1', 'GET', '/api/me')
    const d = await h.ok('RM1', 'GET', '/api/rm/digest')
    expect(d.families.map((f: any) => f.family_id).sort()).toEqual([...me.families].sort())
    const items = d.families.flatMap((f: any) => f.items)
    expect(items.every((i: any) => ['impact', 'goal', 'policy', 'leverage', 'liquidity', 'succession', 'data'].includes(i.kind))).toBe(true)
    if (items.some((i: any) => i.kind === 'impact')) expect(d.counts.unseen).toBeGreaterThan(0)
    expect((await h.call('CIO1', 'GET', '/api/rm/digest')).status).toBe(403)
    // Gia đình RM: kết quả gộp sau bán rã
    const n = await h.ok('RM1', 'GET', `/api/families/${me.families[0]}/netting`)
    expect(n.events).toBe(1)
    expect((await h.call('RM1', 'GET', `/api/families/DEMO-F99/netting`)).status).toBeGreaterThanOrEqual(403)
  })
})

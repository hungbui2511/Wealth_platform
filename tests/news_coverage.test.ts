// Mở rộng độ phủ tin (21/10/2026): nguồn RSS mới, tin tiếng Anh, bổ sung tin vào sự kiện đã có, lượt quét buổi sáng.
import { describe, expect, it } from 'vitest'
import { classifyNews, detectLanguage } from '../src/news/classify'
import { DEFAULT_NEWS_SOURCES, RETIRED_NEWS_SOURCES } from '../src/news/sources'
import { heartbeat } from '../src/worker/services/ops'
import { harness } from './support/harness'

describe('Phân loại tin tiếng Anh', () => {
  it('tin thị trường tiếng Anh đủ độ liên quan; tin đời sống thì không', () => {
    const fed = classifyNews({ title: 'Fed officials signal rate cut as inflation cools', summary: 'Treasury yields fell and stocks rallied on Wall Street.' })
    expect(fed.relevance).toBeGreaterThanOrEqual(2)
    expect(fed.suggested_type).toBe('global_macro')
    expect(classifyNews({ title: 'Best hiking boots for fall', summary: 'Our picks for comfortable trails.' }).relevance).toBeLessThan(2)
    expect(detectLanguage('Gold price slips')).toBe('en')
    expect(detectLanguage('Giá vàng giảm')).toBe('vi')
  })
  it('nguồn đã gỡ không còn trong danh sách mặc định', () => {
    for (const u of RETIRED_NEWS_SOURCES) expect(DEFAULT_NEWS_SOURCES.some(s => s.url === u)).toBe(false)
    expect(DEFAULT_NEWS_SOURCES.length).toBeGreaterThanOrEqual(20)
  })
})

describe('Bổ sung tin và lịch buổi sáng (tích hợp)', () => {
  let clock = Date.parse('2026-10-21T10:00:00.000Z')
  const h = harness({ env: { AGENT_MODE: 'external' }, now: () => new Date((clock += 1000)).toISOString() })
  const push = (id: string, kind: string, subject: string | null, data: unknown) => h.DB.prepare("INSERT INTO external_outputs (id, kind, subject, status, created_at, data) VALUES (?, ?, ?, 'READY', ?, ?)").bind(id, kind, subject, new Date(clock).toISOString(), JSON.stringify(data)).run()
  const item = (n: number) => ({ title: `Bán tháo trái phiếu Pháp tiếp diễn, lợi suất 10 năm lên cao (${n})`, url: `https://vietstock.vn/2026/10/trai-phieu-phap-${n}.htm`, published_at: '2026-10-21T08:00:00+07:00', summary: 'Lợi suất trái phiếu chính phủ Pháp tăng, chênh lệch với Đức nới rộng, nhà đầu tư lo ngại ngân sách.', source_name: 'Vietstock', suggested_type: 'global_macro' })

  it('Quản trị đề xuất từ bản mặc định: nguồn hỏng bị gỡ, nguồn mới được thêm', async () => {
    await h.call(null, 'POST', '/api/bootstrap')
    const d = await h.ok('ADM1', 'GET', '/api/config/defaults/NEWS_SOURCES')
    expect(d.some((x: any) => RETIRED_NEWS_SOURCES.includes(x.url))).toBe(false)
    expect(d.some((x: any) => x.url.includes('mw_topstories'))).toBe(true)
    const w = await h.ok('CMP1', 'GET', '/api/config/defaults/WHITELIST')
    expect(w.some((x: any) => x.domain === 'marketwatch.com')).toBe(true)
  })

  it('event_update: tin mới cùng chủ đề vào sự kiện cũ, ghi chú và cờ diễn biến lớn; tin đã thuộc sự kiện khác bị từ chối', async () => {
    await push('N1', 'news', null, { items: [item(1), item(2)] })
    await push('E1', 'event', null, { ref: 'CL-1', type: 'global_macro', title: 'Bán tháo trái phiếu Pháp', news_urls: [item(1).url] })
    await h.ok('ADM1', 'POST', '/api/external/import')
    const ev = (await h.ok('CIO1', 'GET', '/api/events')).find((e: any) => e.title === 'Bán tháo trái phiếu Pháp')
    await push('N2', 'news', null, { items: [item(3)] })
    await push('U1', 'event_update', ev.id, { news_urls: [item(2).url, item(3).url], note: 'Lợi suất Pháp lên đỉnh mới, chênh lệch với Đức nới thêm 10 điểm cơ bản', material: true })
    const imp = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(imp.event_updates).toEqual([ev.id])
    const e2 = await h.ok('CIO1', 'GET', `/api/events/${ev.id}`)
    const e = e2.event ?? e2
    expect(e.news_ids).toHaveLength(3)
    expect(e.updates[0]).toMatchObject({ material: true })
    await push('U2', 'event_update', ev.id, { news_urls: [item(3).url], note: 'Lặp lại tin đã có trong sự kiện này rồi nhé' })
    const imp2 = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(imp2.rejected.some((x: any) => x.id === 'U2')).toBe(true)
  })

  it('lịch buổi sáng chỉ được theo dõi từ 22/10', async () => {
    const hb = await heartbeat({ now: () => '2026-10-21T15:00:00.000Z', repo: { list: async () => [] } } as never)
    expect(hb.find(x => x.id === 'morning_news')!.status).toBe('NOT_DUE')
    const hb2 = await heartbeat({ now: () => '2026-10-22T03:00:00.000Z', repo: { list: async () => [] } } as never)
    expect(hb2.find(x => x.id === 'morning_news')!.status).toBe('MISSING')
  })
})

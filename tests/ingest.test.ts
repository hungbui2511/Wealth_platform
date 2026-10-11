// Lấy tin tự động (RSS) và lập sự kiện từ hộp tin mới; nhận định mô phỏng theo từ khóa ở chế độ mock.
import { beforeAll, describe, expect, it } from 'vitest'
import { harness } from './support/harness'
import { parseFeed } from '../src/news/rss'
import { classifyNews } from '../src/news/classify'
import { keywordView } from '../src/agents/keywordView'

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Kinh doanh</title>
<item><title><![CDATA[NHNN tăng lãi suất điều hành, lãi suất huy động tăng theo]]></title><link>https://vnexpress.net/nhnn-tang-lai-suat-1.html</link><pubDate>Fri, 09 Oct 2026 08:00:00 +0700</pubDate><description><![CDATA[<a href="x"><img src="y"></a>Ngân hàng Nhà nước tăng lãi suất; cổ phiếu ngân hàng như MBB, VPB biến động &amp; thanh khoản giảm.]]></description></item>
<item><title>Giá vàng tăng mạnh lên đỉnh mới</title><link>https://vnexpress.net/gia-vang-tang-2.html</link><pubDate>Fri, 09 Oct 2026 21:00:00 +0700</pubDate><description>Giá vàng thế giới tăng, vàng miếng SJC tăng theo.</description></item>
<item><title>Đội tuyển bóng đá thắng trận giao hữu</title><link>https://vnexpress.net/bong-da-3.html</link><pubDate>Fri, 09 Oct 2026 20:00:00 +0700</pubDate><description>Tin thể thao.</description></item>
<item><title>Lãi suất tiết kiệm tháng trước</title><link>https://vnexpress.net/cu-4.html</link><pubDate>Mon, 01 Sep 2026 08:00:00 +0700</pubDate><description>Tin cũ về lãi suất ngân hàng.</description></item>
</channel></rss>`
const RSS_OUTSIDE = `<rss><channel><item><title>Lãi suất ngân hàng tăng</title><link>https://dien-dan.example/lai-suat</link><pubDate>Fri, 09 Oct 2026 09:00:00 +0700</pubDate><description>Diễn đàn: lãi suất ngân hàng tăng</description></item></channel></rss>`

describe('Đọc RSS và phân loại tin', () => {
  it('đọc CDATA, bỏ thẻ HTML, giải mã ký tự, chuẩn hóa giờ', () => {
    const items = parseFeed(RSS)
    expect(items.length).toBe(4)
    expect(items[0].title).toBe('NHNN tăng lãi suất điều hành, lãi suất huy động tăng theo')
    expect(items[0].summary).toContain('MBB, VPB biến động & thanh khoản')
    expect(items[0].published_at).toBe('2026-10-09T01:00:00.000Z')
  })
  it('đọc Atom', () => {
    const atom = `<feed><entry><title>Tỷ giá USD/VND tăng</title><link href="https://vneconomy.vn/ty-gia.htm"/><updated>2026-10-09T03:00:00Z</updated><summary>Tỷ giá tăng.</summary></entry></feed>`
    expect(parseFeed(atom)).toEqual([{ title: 'Tỷ giá USD/VND tăng', url: 'https://vneconomy.vn/ty-gia.htm', published_at: '2026-10-09T03:00:00.000Z', summary: 'Tỷ giá tăng.' }])
  })
  it('gợi ý loại sự kiện và nhận ra mã chứng khoán', () => {
    const c = classifyNews({ title: 'NHNN tăng lãi suất điều hành', summary: 'Cổ phiếu MBB giảm' }, ['MBB', 'VPB'])
    expect(c.suggested_type).toBe('monetary_policy')
    expect(c.tickers).toEqual(['MBB'])
    expect(classifyNews({ title: 'Đội tuyển thắng', summary: 'Thể thao' }).relevance).toBe(0)
  })
  it('nhận định mô phỏng theo từ khóa: đủ 11 loại tài sản và 3 cặp tiền, có nguồn, ghi rõ không phải AI', () => {
    const v = keywordView('Lãi suất', [{ id: 'NW-1', title: 'NHNN tăng lãi suất', summary: '' }, { id: 'NW-2', title: 'Giá vàng tăng mạnh', summary: '' }])
    expect(v.impacts.length).toBe(14)
    const by = (t: string) => v.impacts.find(l => l.target === t)!
    expect(by('CASH')).toMatchObject({ level: 1, source_ids: ['NW-1'], confidence: 'low' })
    expect(by('GOV_BOND').level).toBe(-1)
    expect(by('GOLD')).toMatchObject({ level: 1, source_ids: ['NW-2'] })
    expect(by('CRYPTO').level).toBe(0)
    expect(by('CASH').rationale).toContain('không phải AI')
  })
})

describe('Lấy tin tự động vào hộp tin mới, lập sự kiện, chạy Agent CIO (mock)', () => {
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url)
    if (url.startsWith('https://vnexpress.net/')) return new Response(RSS, { status: 200 })
    if (url.startsWith('https://vneconomy.vn/')) return new Response(RSS_OUTSIDE, { status: 200 })
    return new Response('lỗi', { status: 503 })
  }) as typeof fetch
  const h = harness({ fetchFn })
  beforeAll(async () => { const r = await h.call(null, 'POST', '/api/bootstrap'); if (r.status >= 400) throw new Error(JSON.stringify(r.data)) })

  let ids: string[] = []
  it('chỉ giữ tin liên quan, mới, thuộc nguồn công khai; nguồn lỗi được ghi lại', async () => {
    const r = await h.ok('CIO1', 'POST', '/api/news/ingest')
    expect(r.created).toBe(2)
    expect(r.irrelevant).toBe(1)
    expect(r.too_old).toBe(1)
    expect(r.rejected).toBe(1)
    expect(r.errors.length).toBe(6)
    const inbox = await h.ok('CIO1', 'GET', '/api/news/inbox')
    expect(inbox.length).toBe(2)
    const rate = inbox.find((n: any) => n.title.startsWith('NHNN'))
    expect(rate).toMatchObject({ suggested_type: 'monetary_policy', auto: true, simulated: false })
    expect(rate.tickers).toEqual(expect.arrayContaining(['MBB', 'VPB']))
    ids = inbox.map((n: any) => n.id)
    // RM không xem hộp tin; RM không lấy tin được
    expect((await h.call('RM1', 'GET', '/api/news/inbox')).status).toBe(403)
    expect((await h.call('RM1', 'POST', '/api/news/ingest')).status).toBe(403)
  })
  it('lấy lại không tạo trùng', async () => {
    const r = await h.ok('ADM1', 'POST', '/api/news/ingest')
    expect(r.created).toBe(0)
    expect(r.duplicate).toBeGreaterThanOrEqual(2)
  })
  it('CIO lập sự kiện từ hai tin; tin rời hộp tin mới; Agent CIO cho nhận định mô phỏng có nguồn', async () => {
    const r = await h.ok('CIO1', 'POST', '/api/events/from-news', { news_ids: ids, type: 'monetary_policy', title: 'NHNN tăng lãi suất, vàng tăng' })
    expect(r.event.news_ids.sort()).toEqual([...ids].sort())
    expect(await h.ok('CIO1', 'GET', '/api/news/inbox')).toEqual([])
    expect((await h.call('CIO1', 'POST', '/api/events/from-news', { news_ids: ids, type: 'monetary_policy' })).status).toBe(409)
    const v = await h.ok('CIO1', 'POST', `/api/events/${r.event.id}/run-agent`)
    expect(v.status).toBe('PENDING_APPROVAL')
    const cash = v.body.impacts.find((l: any) => l.target === 'CASH')
    expect(cash.level).toBe(1)
    expect(cash.source_ids.length).toBe(1)
    expect(v.body.impacts.find((l: any) => l.target === 'GOLD').level).toBe(1)
  })
  it('nhật ký ghi lần lấy tin', async () => {
    const a = await h.ok('CMP1', 'GET', '/api/audit?action=news.ingested')
    expect(a.length).toBe(1)
    expect(a[0].data ?? a[0]).toBeTruthy()
  })
})

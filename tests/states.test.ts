// NFR-12: chuyển trạng thái hợp lệ và bị từ chối (Mục 6.4); gói yêu cầu gửi ra nguồn giá (BR-22)
import { describe, expect, it } from 'vitest'
import { assertRunTransition, assertViewTransition, RUN_TRANSITIONS, VIEW_TRANSITIONS } from '../src/engine/states'
import { makeAdapters, tcbsPayload } from '../src/pricing/adapters'
import { SAMPLE_STORE } from '../src/data/seed'
import { checkTimestamp } from '../src/compliance/controls'

const VIEW_STATES = Object.keys(VIEW_TRANSITIONS), RUN_STATES = Object.keys(RUN_TRANSITIONS)

describe('Máy trạng thái', () => {
  it('nhận định: đúng các cạnh trong sơ đồ, mọi cạnh khác bị từ chối', () => {
    const allowed = new Set(['DRAFTING>AGENT_ERROR', 'DRAFTING>PENDING_CHALLENGE', 'PENDING_CHALLENGE>PENDING_APPROVAL', 'PENDING_APPROVAL>PENDING_CHALLENGE', 'PENDING_APPROVAL>APPROVED', 'PENDING_APPROVAL>REWORK_REQUESTED', 'PENDING_APPROVAL>REJECTED', 'APPROVED>SUPERSEDED', 'APPROVED>WITHDRAWN'])
    for (const a of VIEW_STATES) for (const b of VIEW_STATES) {
      if (allowed.has(`${a}>${b}`)) expect(() => assertViewTransition(a, b)).not.toThrow()
      else expect(() => assertViewTransition(a, b)).toThrow(/không hợp lệ/)
    }
  })
  it('lần áp dụng: đúng các cạnh trong sơ đồ, mọi cạnh khác bị từ chối', () => {
    const allowed = new Set(['COMPUTING>FAILED', 'COMPUTING>POST_CHECKING', 'POST_CHECKING>EFFECTIVE', 'POST_CHECKING>NEEDS_CIO_REVIEW', 'NEEDS_CIO_REVIEW>EFFECTIVE', 'NEEDS_CIO_REVIEW>WITHDRAWN', 'EFFECTIVE>SUPERSEDED', 'EFFECTIVE>WITHDRAWN'])
    for (const a of RUN_STATES) for (const b of RUN_STATES) {
      if (allowed.has(`${a}>${b}`)) expect(() => assertRunTransition(a, b)).not.toThrow()
      else expect(() => assertRunTransition(a, b)).toThrow(/không hợp lệ/)
    }
  })
  it('BR-29: mốc thời gian phải tăng dần', () => {
    const ts = { published_at: '2026-10-08T00:00:00Z', ingested_at: '2026-10-09T00:00:00Z' }
    expect(checkTimestamp(ts, 'event_created_at', '2026-10-09T01:00:00Z')).toBeNull()
    expect(checkTimestamp(ts, 'event_created_at', '2026-10-08T12:00:00Z')).toMatch(/sớm hơn ingested_at/)
  })
})

describe('BR-22: gói gửi TCBS chỉ gồm mã thị trường và ngày', () => {
  it('chế độ live gửi đúng tham số, có ghi nhật ký; thiếu thỏa thuận thì từ chối', async () => {
    const urls: string[] = [], logged: unknown[] = []
    const fake: typeof fetch = async (u) => { urls.push(String(u)); return new Response(JSON.stringify({ data: [{ tradingDate: '2026-10-09T00:00:00', close: 25100 }] })) }
    const ctx = { mode: 'live' as const, env: { TCBS_BASE_URL: 'https://tcbs.fake', TCBS_TOKEN: 't' }, agreements: { TCBS_STOCK: 'AGR-TCBS-1' }, fetchFn: fake, logOutbound: (_a: string, p: unknown) => logged.push(p), logEvent: () => {} }
    const out = await makeAdapters(SAMPLE_STORE).TCBS_STOCK.history([{ key: 'MBB', instrument_id: 'MBB', market_symbol: 'MKT1', currency: 'VND' }], '2026-10-01', '2026-10-09', ctx)
    expect(out.MBB[0]).toMatchObject({ date: '2026-10-09', price: '25100' })
    expect([...new URL(urls[0]).searchParams.keys()].sort()).toEqual(['from', 'symbol', 'to'])
    expect(logged).toEqual([tcbsPayload('MKT1', '2026-10-01', '2026-10-09')])
    await expect(makeAdapters(SAMPLE_STORE).TCBS_STOCK.history([], '2026-10-01', '2026-10-09', { ...ctx, agreements: {} })).rejects.toThrow(/agreement_ref/)
  })
})

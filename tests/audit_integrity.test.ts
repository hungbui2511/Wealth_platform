// Nhật ký chỉ ghi thêm (NFR-13): nạp lại dữ liệu không xóa nhật ký; áp dụng tay bị khóa ngoài kiểm thử
import { beforeAll, describe, expect, it } from 'vitest'
import { harness } from './support/harness'

const h = harness()

beforeAll(async () => {
  const r = await h.call(null, 'POST', '/api/bootstrap')
  if (r.status >= 400) throw new Error(JSON.stringify(r.data))
  await h.ok('ADM1', 'POST', '/api/admin/load-sample-events')
})

describe('Nạp lại dữ liệu mẫu', () => {
  it('giữ nguyên nhật ký cũ, nối tiếp chuỗi mã băm và ghi lại tình trạng chuỗi trước', async () => {
    const before = await h.ok('CMP1', 'GET', '/api/audit/verify')
    expect(before.ok).toBe(true)
    const r = await h.ok('ADM1', 'POST', '/api/admin/reseed')
    expect(r.previous_chain).toMatchObject({ ok: true, count: before.count, head: before.head })
    const after = await h.ok('CMP1', 'GET', '/api/audit/verify')
    expect(after.ok).toBe(true)
    expect(after.count).toBeGreaterThan(before.count)
    const all = await h.ok('CMP1', 'GET', '/api/audit?limit=1000')
    expect(all.some((x: any) => x.action === 'event.created' || x.action === 'event.loaded' || String(x.action).startsWith('event.'))).toBe(true)
  })
  it('xóa dữ liệu nghiệp vụ: sự kiện mẫu phải nạp lại', async () => {
    expect(await h.ok('CIO1', 'GET', '/api/events')).toEqual([])
  })
  it('chỉ ADMIN được nạp lại', async () => {
    expect((await h.call('CIO1', 'POST', '/api/admin/reseed')).status).toBe(403)
  })
})

describe('Áp dụng nhận định nhập tay (AC-05a)', () => {
  it('bị tắt khi không bật MANUAL_APPLY', async () => {
    const off = harness({ env: { MANUAL_APPLY: undefined } })
    await off.call(null, 'POST', '/api/bootstrap')
    await off.ok('ADM1', 'POST', '/api/admin/load-sample-events')
    const r = await off.call('CIO1', 'POST', '/api/manual-apply', { event_id: 'EV-2026-0002', view: {} })
    expect(r.status).toBe(403)
  })
  it('ADMIN không được dùng kể cả khi bật', async () => {
    await h.ok('ADM1', 'POST', '/api/admin/load-sample-events')
    expect((await h.call('ADM1', 'POST', '/api/manual-apply', { event_id: 'EV-2026-0002', view: {} })).status).toBe(403)
  })
})

// Các lỗi sau rà soát kiến trúc: trạng thái văn bản chính sách, che dữ liệu hạn chế cho RM,
// cờ One Mount thuộc Tuân thủ, Agent Phản biện lỗi không làm kẹt nhận định, danh mục agent
import { beforeAll, describe, expect, it } from 'vitest'
import { harness } from './support/harness'
import { redactRestricted } from '../src/compliance/controls'

const h = harness()
const RESTRICTED = [{ id: 'RL-001', issuer: 'Công ty Demo X', instruments: ['DMXYZ'], keywords: ['Công ty Demo X', 'Demo X'] }]

beforeAll(async () => {
  const r = await h.call(null, 'POST', '/api/bootstrap')
  if (r.status >= 400) throw new Error(JSON.stringify(r.data))
  await h.ok('ADM1', 'POST', '/api/admin/load-sample-events')
})

describe('Văn bản chính sách', () => {
  it('giữ trạng thái pháp lý của văn bản, trạng thái quy trình nằm ở state', async () => {
    await h.ok('ADM1', 'POST', '/api/admin/load-sample-policies')
    const d = await h.ok('CIO1', 'GET', '/api/policies/PD-2026-001')
    const doc = d.doc ?? d
    expect(doc.status).toBe('Lấy ý kiến')
    expect(doc.state).toBe('PENDING_SOURCE_CONFIRM')
    await h.ok('CMP1', 'POST', '/api/policies/PD-2026-001/confirm-source', { note: 'Đã kiểm tra đường dẫn công khai' })
    const after = await h.ok('CIO1', 'GET', '/api/policies/PD-2026-001')
    expect((after.doc ?? after).status).toBe('Lấy ý kiến')
    expect((after.doc ?? after).state).toBe('SOURCE_CONFIRMED')
  })
})

describe('Che dữ liệu hạn chế cho RM (BR-27)', () => {
  it('che không phân biệt hoa thường', () => {
    expect(redactRestricted('công ty demo x và CÔNG TY DEMO X phát hành; mã dmxyz', RESTRICTED)).not.toMatch(/demo x|dmxyz/i)
  })

  it('mọi endpoint RM gọi được không lộ tên tổ chức hạn chế', async () => {
    await h.ok('CMP1', 'POST', '/api/events/EV-2026-0006/allow', { note: 'Thông tin đã công bố công khai' })
    const v = await h.ok('CIO1', 'POST', '/api/events/EV-2026-0006/run-agent')
    const dec = await h.ok('CIO1', 'POST', `/api/views/${v.id}/decision`, { action: 'APPROVE', reason: 'Duyệt nhận định ngành công nghiệp' })
    // CIO vẫn thấy dữ liệu gốc
    expect(JSON.stringify(await h.ok('CIO1', 'GET', '/api/events/EV-2026-0006'))).toMatch(/Demo X/)
    const paths = ['/api/events', '/api/events/EV-2026-0006', `/api/runs/${dec.run_id}/families/DEMO-F06`, '/api/families/DEMO-F06/impacts', '/api/families', `/api/trace/runs/${dec.run_id}/families/DEMO-F06`]
    // Vị thế của chính khách hàng (tên mã đang nắm giữ) vẫn hiển thị; nội dung, tin, nhận định, cấu hình thì che
    const holdingsKeys = new Set(['positions', 'top_instruments'])
    const strip = (v: any): any => Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !holdingsKeys.has(k)).map(([k, x]) => [k, strip(x)])) : v
    for (const p of paths) {
      const body = JSON.stringify(strip(await h.ok('RM1', 'GET', p)))
      expect(body, p).not.toMatch(/demo x/i)
    }
  })
})

describe('Cờ xác nhận One Mount (BR-22)', () => {
  it('ADMIN không tự bật được; chỉ Tuân thủ đặt ONEMOUNT_CONFIRM', async () => {
    const bad = await h.call('ADM1', 'POST', '/api/config/PRICE_SOURCE', { content: { agreements: { ONEMOUNT: 'AGR-1' }, onemount_compliance_confirmed: true }, reason: 'Bật One Mount live cho bản demo nội bộ' })
    expect(bad.status).toBe(422)
    expect((await h.call('ADM1', 'POST', '/api/config/ONEMOUNT_CONFIRM', { content: { confirmed: true }, reason: 'Quản trị tự xác nhận căn cứ chia sẻ dữ liệu' })).status).toBe(403)
    const ok = await h.call('CMP1', 'POST', '/api/config/ONEMOUNT_CONFIRM', { content: { confirmed: true }, reason: 'Tuân thủ đã xem thỏa thuận chia sẻ dữ liệu' })
    expect(ok.status).toBe(200)
  })
})

describe('Agent Phản biện lỗi (chế độ live)', () => {
  it('phản biện lại lỗi trả 502, nhận định giữ nguyên, nhật ký ghi lỗi; chạy lại được', async () => {
    const v = await h.ok('CIO1', 'POST', '/api/events/EV-2026-0002/run-agent')
    const lines = v.body.impacts.map((l: any) => ({ ...l }))
    const i = lines.findIndex((l: any) => Math.abs(l.level) >= 2)
    lines[i] = { ...lines[i], level: lines[i].level > 0 ? lines[i].level - 1 : lines[i].level + 1 }
    const edited = await h.ok('CIO1', 'PUT', `/api/views/${v.id}/lines`, { impacts: lines, note: 'Giảm mức một dòng' })
    expect(edited.view.status).toBe('PENDING_CHALLENGE')
    h.env.AGENT_MODE = 'live' // không có ANTHROPIC_API_KEY nên lời gọi LLM lỗi
    try {
      const r = await h.call('CIO1', 'POST', `/api/views/${v.id}/rechallenge`)
      expect(r.status).toBe(502)
    } finally { h.env.AGENT_MODE = 'mock' }
    const same = await h.ok('CIO1', 'GET', `/api/views/${v.id}`)
    expect(same.view.status).toBe('PENDING_CHALLENGE')
    expect(same.view.unchallenged.length).toBeGreaterThan(0)
    const audit = await h.ok('CMP1', 'GET', `/api/audit?object=${v.id}&action=agent.challenge_failed`)
    expect(audit).toHaveLength(1)
    const again = await h.ok('CIO1', 'POST', `/api/views/${v.id}/rechallenge`)
    expect(again.status).toBe('PENDING_APPROVAL')
  })

  it('route chạy lại phản biện trước duyệt từ chối khi đã có báo cáo', async () => {
    const views = await h.ok('CIO1', 'GET', '/api/views')
    const pending = views.find((x: any) => x.status === 'PENDING_APPROVAL')
    expect((await h.call('CIO1', 'POST', `/api/views/${pending.id}/challenge`)).status).toBe(409)
  })
})

describe('Danh mục agent', () => {
  it('lượt gần nhất của Agent Phản biện lấy từ báo cáo phản biện, không phải của Agent CIO', async () => {
    const agents = await h.ok('CIO1', 'GET', '/api/agents')
    const ch = agents.find((a: any) => a.id === 'challenger')
    const views = await h.ok('CIO1', 'GET', '/api/views')
    const challenges = (await Promise.all(views.map((v: any) => h.ok('CIO1', 'GET', `/api/views/${v.id}`)))).flatMap((d: any) => d.challenges)
    const latest = challenges.map((c: any) => c.created_at).sort().at(-1)
    expect(ch.last_run).toBe(latest)
  })
})

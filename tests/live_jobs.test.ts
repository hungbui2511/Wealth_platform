// Chế độ live (mô hình giả qua fetch) và tác vụ chạy nền (Workflows giả): Agent CIO, phản biện, làm lại, Agent Chính sách.
import { beforeAll, describe, expect, it } from 'vitest'
import { harness } from './support/harness'
import { fakeLlmFetch } from './support/fakeLlm'
import { executeJob } from '../src/worker/services/jobs'

const boot = async (h: ReturnType<typeof harness>) => {
  const r = await h.call(null, 'POST', '/api/bootstrap'); if (r.status >= 400) throw new Error(JSON.stringify(r.data))
  await h.ok('ADM1', 'POST', '/api/admin/load-sample-events')
}

describe('Chế độ live chạy trực tiếp (chưa cấu hình Workflows)', () => {
  const requests: { system: string; model: string }[] = []
  const h = harness({ fetchFn: fakeLlmFetch({ requests }), env: { AGENT_MODE: 'live', ANTHROPIC_API_KEY: 'sk-test' } })
  beforeAll(() => boot(h))

  it('Agent CIO gọi mô hình cho 4 nhóm, tổng hợp, rồi Agent Phản biện; nhận định chờ duyệt', async () => {
    const v = await h.ok('CIO1', 'POST', '/api/events/EV-2026-0001/run-agent')
    expect(v.id).toBe('VW-0001-v1')
    expect(v.status).toBe('PENDING_APPROVAL')
    expect(v.body.impacts.find((l: any) => l.target === 'CASH').level).toBe(1)
    const trace = await h.ok('CIO1', 'GET', `/api/agent-runs/${v.agent_run_id}`)
    expect(trace.run.mode).toBe('live')
    expect(trace.nodes.map((n: any) => n.node)).toEqual(expect.arrayContaining(['data', 'analyst_macro', 'analyst_equity', 'analyst_credit_re', 'analyst_commodity', 'synthesize', 'validate']))
    // Agent Phản biện dùng mô hình khác Agent CIO (NFR-03)
    const models = new Set(requests.map(r => r.model))
    expect(models.has('claude-opus-5-5')).toBe(true)
    expect(models.has('claude-sonnet-5-5')).toBe(true)
    const d = await h.ok('CIO1', 'GET', `/api/views/${v.id}`)
    expect(d.challenges[0].findings.some((f: any) => f.origin === 'llm' && f.check === 'overconfidence')).toBe(true)
  })
})

describe('Tác vụ chạy nền (Workflows) ở chế độ live', () => {
  const queued: string[] = []
  const fetchFn = fakeLlmFetch()
  const AGENT_JOBS = { create: async (o: { id?: string }) => { queued.push(o.id!); return {} } }
  const h = harness({ fetchFn, env: { AGENT_MODE: 'live', ANTHROPIC_API_KEY: 'sk-test', AGENT_JOBS } })
  beforeAll(() => boot(h))

  it('Chạy Agent CIO trả về tác vụ ngay; bấm lần hai trả lại đúng tác vụ đó', async () => {
    const r = await h.ok('CIO1', 'POST', '/api/events/EV-2026-0003/run-agent')
    expect(r.job.status).toBe('QUEUED')
    expect(queued).toEqual([r.job.id])
    const again = await h.ok('CIO1', 'POST', '/api/events/EV-2026-0003/run-agent')
    expect(again.job.id).toBe(r.job.id)
    expect(queued.length).toBe(1)
    // RM không xem được tác vụ
    expect((await h.call('RM1', 'GET', `/api/jobs/${r.job.id}`)).status).toBe(403)
  })

  it('Workflows chạy tác vụ: ghi tiến độ từng bước, kết quả là nhận định chờ duyệt, nhật ký có tác nhân CIO', async () => {
    const id = queued[0]
    const done = await executeJob(h.env, id, { now: h.now, fetchFn })
    expect(done.status).toBe('DONE')
    expect(done.result!.status).toBe('PENDING_APPROVAL')
    const j = await h.ok('CIO1', 'GET', `/api/jobs/${id}`)
    const steps = j.steps.map((s: any) => s.step)
    for (const s of ['analyst_macro', 'analyst_equity', 'analyst_credit_re', 'analyst_commodity', 'synthesize', 'challenger_pre', 'done']) expect(steps).toContain(s)
    // Chạy lại cùng tác vụ không gọi lại mô hình (chỉ chạy một lần)
    const again = await executeJob(h.env, id, { now: h.now, fetchFn })
    expect(again.status).toBe('DONE')
    const audit = await h.ok('CMP1', 'GET', `/api/audit?object=${done.result!.view_id}`)
    expect(audit.some((a: any) => a.action === 'agent.cio_run')).toBe(true)
    const q = await h.ok('CMP1', 'GET', `/api/audit?object=${id}`)
    expect(q.map((a: any) => a.action)).toEqual(expect.arrayContaining(['agent.job_queued', 'agent.job_done']))
    expect(q.find((a: any) => a.action === 'agent.job_queued').actor).toContain('CIO:CIO1')
  })

  it('Yêu cầu làm lại (REWORK) ở chế độ live đưa lượt Agent CIO mới vào hàng chạy nền', async () => {
    const vid = (await h.ok('CIO1', 'GET', `/api/jobs/${queued[0]}`)).result.view_id
    const r = await h.ok('CIO1', 'POST', `/api/views/${vid}/decision`, { action: 'REWORK', reason: 'Cần xem lại tác động lên tiền gửi kỳ hạn ngắn' })
    expect(r.job.kind).toBe('cio_run')
    expect(r.job.params.instructions).toContain('tiền gửi')
    const done = await executeJob(h.env, r.job.id, { now: h.now, fetchFn })
    expect(done.result!.view_id).toBe(vid.replace('-v1', '-v2'))
  })

  it('Mô hình trả lỗi: tác vụ vẫn xong, nhận định chuyển AGENT_ERROR (không mất dấu)', async () => {
    const bad = harness({ fetchFn: fakeLlmFetch({ failWith: 400 }), env: { AGENT_MODE: 'live', ANTHROPIC_API_KEY: 'sk-test', AGENT_JOBS } })
    await boot(bad)
    const r = await bad.ok('CIO1', 'POST', '/api/events/EV-2026-0005/run-agent')
    const done = await executeJob(bad.env, r.job.id, { now: bad.now, fetchFn: fakeLlmFetch({ failWith: 400 }) })
    expect(done.status).toBe('DONE')
    expect(done.result!.status).toBe('AGENT_ERROR')
  })

  it('Sự kiện bị chặn bởi danh sách hạn chế: báo lỗi ngay, không tạo tác vụ', async () => {
    const n = queued.length
    const r = await h.call('CIO1', 'POST', '/api/events/EV-2026-0006/run-agent')
    expect(r.status).toBe(409)
    expect(queued.length).toBe(n)
  })

  it('Agent Chính sách chạy nền: văn bản được tóm tắt, tạo sự kiện chính sách', async () => {
    await h.ok('ADM1', 'POST', '/api/admin/load-sample-policies')
    await h.ok('CMP1', 'POST', '/api/policies/PD-2026-002/confirm-source', { note: 'Đã kiểm tra đường dẫn công khai' })
    const r = await h.ok('ADM1', 'POST', '/api/policies/PD-2026-002/analyze')
    expect(r.job.kind).toBe('policy_analyze')
    const done = await executeJob(h.env, r.job.id, { now: h.now, fetchFn })
    expect(done.status).toBe('DONE')
    expect(String(done.result!.event_id)).toMatch(/^EV-/)
  })
})

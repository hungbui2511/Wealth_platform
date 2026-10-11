// Ghi đồng thời: hai yêu cầu song song không được nhận trùng mã hay ghi đè nhau im lặng
import { beforeAll, describe, expect, it } from 'vitest'
import { harness } from './support/harness'

const h = harness()
const mk = (t: string) => ({ type: 'global_macro', items: [{ title: t, url: 'https://tintuc-gialap.example/x', published_at: '2026-10-09T01:00:00Z', summary: 'Tóm tắt ' + t }, { title: t + ' (2)', url: 'https://tintuc-gialap.example/y', published_at: '2026-10-09T01:00:00Z', summary: 'Tóm tắt thêm ' + t }] })

beforeAll(async () => {
  const r = await h.call(null, 'POST', '/api/bootstrap')
  if (r.status >= 400) throw new Error(JSON.stringify(r.data))
  await h.ok('ADM1', 'POST', '/api/admin/load-sample-events')
})

describe('Ghi đồng thời', () => {
  it('hai sự kiện tạo cùng lúc nhận mã sự kiện và mã tin khác nhau, không mất sự kiện nào', async () => {
    const [a, b] = await Promise.all([h.ok('ADM1', 'POST', '/api/events', mk('Sự kiện A')), h.ok('ADM1', 'POST', '/api/events', mk('Sự kiện B'))])
    expect(a.event.id).not.toBe(b.event.id)
    const newsIds = [...a.news, ...b.news].map((n: any) => n.id)
    expect(new Set(newsIds).size).toBe(4)
    const events = await h.ok('CIO1', 'GET', '/api/events')
    expect(events.find((e: any) => e.id === a.event.id).title).toBe('Sự kiện A')
    expect(events.find((e: any) => e.id === b.event.id).title).toBe('Sự kiện B')
  })

  it('hai lượt Agent CIO song song tạo hai phiên bản khác nhau', async () => {
    const [r1, r2] = await Promise.all([h.ok('CIO1', 'POST', '/api/events/EV-2026-0003/run-agent'), h.ok('CIO1', 'POST', '/api/events/EV-2026-0003/run-agent')])
    expect(r1.id).not.toBe(r2.id)
    const views = (await h.ok('CIO1', 'GET', '/api/views')).filter((v: any) => v.event_id === 'EV-2026-0003')
    expect(views.map((v: any) => v.id).sort()).toEqual([r1.id, r2.id].sort())
  })

  it('Duyệt và Từ chối gửi cùng lúc: chỉ một bên thành công, bên kia nhận 409', async () => {
    const v = await h.ok('CIO1', 'POST', '/api/events/EV-2026-0001/run-agent')
    const det = await h.ok('CIO1', 'GET', `/api/views/${v.id}`)
    for (const f of det.challenges.flatMap((c: any) => c.findings).filter((f: any) => f.severity === 'critical'))
      await h.ok('CIO1', 'POST', `/api/views/${v.id}/findings/${f.finding_id}/response`, { response: 'disagree', comment: 'Không đồng ý với phát hiện này vì lý do đã nêu' })
    const [ap, rj] = await Promise.all([
      h.call('CIO1', 'POST', `/api/views/${v.id}/decision`, { action: 'APPROVE', reason: 'Đồng ý nhận định sau khi xử lý phản biện' }),
      h.call('CIO1', 'POST', `/api/views/${v.id}/decision`, { action: 'REJECT', reason: 'Từ chối nhận định vì chưa đủ căn cứ dữ liệu' }),
    ])
    expect([ap.status, rj.status].sort()).toEqual([200, 409])
    const after = await h.ok('CIO1', 'GET', `/api/views/${v.id}`)
    expect(after.decisions).toHaveLength(1)
    if (ap.status === 200) {
      expect(after.view.status).toBe('APPROVED')
      expect(after.decisions[0].action).toBe('APPROVE')
    } else {
      expect(after.view.status).toBe('REJECTED')
      expect(after.runs).toHaveLength(0)
    }
  })

  it('hai đề xuất cấu hình cùng lúc nhận hai phiên bản khác nhau', async () => {
    const cfg = await h.ok('CIO1', 'GET', '/api/config')
    const unit = cfg.versions.find((x: any) => x.kind === 'UNIT' && x.status === 'ACTIVE').content
    const [c1, c2] = await Promise.all([
      h.call('CIO1', 'POST', '/api/config/UNIT', { content: unit, reason: 'Đề xuất A giữ nguyên bảng đơn vị cú sốc' }),
      h.call('CIO1', 'POST', '/api/config/UNIT', { content: unit, reason: 'Đề xuất B giữ nguyên bảng đơn vị cú sốc lần hai' }),
    ])
    const ok = [c1, c2].filter(r => r.status === 200)
    expect(ok.length).toBeGreaterThanOrEqual(1)
    for (const r of [c1, c2]) expect([200, 409]).toContain(r.status)
    if (ok.length === 2) expect(c1.data.id).not.toBe(c2.data.id)
    const active = (await h.ok('CIO1', 'GET', '/api/config')).versions.filter((x: any) => x.kind === 'UNIT' && x.status === 'ACTIVE')
    expect(active).toHaveLength(1)
  })

  it('cập nhật dựa trên bản đã cũ bị từ chối (khóa lạc quan)', async () => {
    const { ConflictError, UnitOfWork, Repo } = await import('../src/worker/db')
    const repo = new Repo(h.DB)
    const g = await repo.get<any>('goals', 'GL-F01-01')
    await new UnitOfWork(repo, h.now).update('goals', { ...g, name: 'Bản 1' }).commit()
    await expect(new UnitOfWork(repo, h.now).update('goals', { ...g, name: 'Bản 2' }).commit()).rejects.toBeInstanceOf(ConflictError)
    expect((await repo.get<any>('goals', 'GL-F01-01')).name).toBe('Bản 1')
  })
})

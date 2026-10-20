// Đợt 2 sau phản biện độc lập: sổ dự báo và chấm điểm, số liệu thị trường, tạm dừng agent, sổ sự cố, nhịp tim lượt chạy,
// bài kiểm tra phản biện, bộ sự kiện chuẩn, xác nhận giá AI, cú sốc nhảy bậc trái phiếu BĐS, nhãn tham số giả định.
import { describe, expect, it } from 'vitest'
import { DEFAULT_FACTOR_MODEL } from '../src/data/factorModel'
import { familyScenario, type FactorModel, type ScenarioSet } from '../src/engine/scenario'
import { buildForecast, scoreCheckpoint } from '../src/engine/forecast'
import { lastDueSlot, SCHEDULES } from '../src/worker/services/ops'
import { buildPositions, netWorth } from '../src/engine/positions'
import { book, exampleFamily, instruments } from './fixtures'
import { harness } from './support/harness'

const M = DEFAULT_FACTOR_MODEL as unknown as FactorModel
const SET: ScenarioSet = {
  priced_in: 'none',
  branches: [
    { id: 'B1', name: 'Cổ phiếu giảm vừa', probability: 0.6, regime: 'calm', core_shocks: [{ factor: 'VN_EQ', size: 'M', direction: 'down' }], rationale: 'r', source_ids: ['N1'] },
    { id: 'B2', name: 'Cổ phiếu tăng', probability: 0.4, regime: 'calm', core_shocks: [{ factor: 'VN_EQ', size: 'M', direction: 'up' }], rationale: 'r', source_ids: ['N1'] },
  ],
}

describe('Sổ dự báo: chấm điểm tất định', () => {
  const fc = buildForecast(M, SET)
  it('nhánh gần thực tế nhất là kết quả; Brier so với mốc xác suất đều', () => {
    const s = scoreCheckpoint(fc, 1, { VN_EQ: 7 }, '2027-01-10T00:00:00Z')
    expect(s.outcome_branch).toBe('B2')
    expect(s.brier).toBeCloseTo((0.6 - 0) ** 2 + (0.4 - 1) ** 2, 6)
    expect(s.brier_uniform).toBeCloseTo(0.5, 6)
    expect(typeof s.coverage.VN_EQ).toBe('boolean')
  })
  it('biến động rất xa ngoài dải 80% bị ghi là không phủ; đúng hướng xét theo kỳ vọng', () => {
    const s = scoreCheckpoint(fc, 1, { VN_EQ: -60 }, '2027-01-10T00:00:00Z')
    expect(s.coverage.VN_EQ).toBe(false)
    expect(s.direction.VN_EQ).toBe(true) // kỳ vọng âm (0,6 × giảm + 0,4 × tăng), thực tế giảm
  })
})

describe('Nhịp tim: lần đến hạn gần nhất theo giờ Việt Nam', () => {
  it('thứ Ba 20/10/2026 lúc 19:00 giờ VN: lượt 17:22 hôm nay đã quá hạn báo; lượt pháp luật gần nhất là thứ Hai 19/10', () => {
    const now = '2026-10-20T12:00:00Z' // 19:00 giờ VN
    expect(lastDueSlot(SCHEDULES[0], now)!.start).toBe('2026-10-20T10:00:00.000Z')
    expect(lastDueSlot(SCHEDULES[1], now)!.start).toBe('2026-10-19T00:30:00.000Z')
  })
})

describe('Cú sốc nhảy bậc trái phiếu DN bất động sản và nhãn tham số giả định', () => {
  const f = exampleFamily()
  const pos = buildPositions(f, instruments, book)
  const nw = netWorth(f, pos, book).toNumber()
  const stress: ScenarioSet = { priced_in: 'none', branches: [{ ...SET.branches[0], regime: 'stress', probability: 0.5 }, { ...SET.branches[1], probability: 0.5 }] }
  it('có trái phiếu BĐS thì nhánh căng thẳng có thêm thành phần nhảy bậc, mốc xấu thấp hơn khi bỏ nhảy bậc', () => {
    const r = familyScenario(f, pos, book, instruments, M, stress, nw)
    const noJump = familyScenario(f, pos, book, instruments, { ...M, credit_jump: { CREDIT_RE: { q: [0, 0, 0], lgd: 0.6 } } }, stress, nw)
    if (r.credit_jump) {
      expect(r.ranges[1].severe).toBeLessThan(noJump.ranges[1].severe)
      expect(r.by_factor.CREDIT_RE_JUMP).toBeLessThan(0)
    } else expect(r.by_factor.CREDIT_RE_JUMP).toBeUndefined()
    expect(r.assumption_share_3m).toBeGreaterThanOrEqual(0)
    expect(r.assumption_share_3m).toBeLessThanOrEqual(1)
  })
})

describe('Đo chất lượng và vận hành (tích hợp)', () => {
  let clock = Date.parse('2026-10-10T02:00:00.000Z')
  const h = harness({ now: () => new Date((clock += 1000)).toISOString() })
  const U = 'https://www.sbv.gov.vn/tygia'
  const push = (id: string, kind: string, data: unknown, subject: string | null = null) => h.DB.prepare("INSERT INTO external_outputs (id, kind, subject, status, created_at, data) VALUES (?, ?, ?, 'READY', ?, ?)").bind(id, kind, subject, new Date(clock).toISOString(), JSON.stringify(data)).run()
  let viewId = ''

  it('duyệt nhận định có kịch bản → lưu sổ dự báo; số liệu thị trường đến hạn → Agent Chấm điểm chấm mốc 1 tuần', async () => {
    await h.call(null, 'POST', '/api/bootstrap')
    await h.ok('ADM1', 'POST', '/api/admin/load-sample-events')
    const v = await h.ok('CIO1', 'POST', '/api/events/EV-2026-0002/run-agent')
    viewId = v.id
    const d = await h.ok('CIO1', 'GET', `/api/views/${v.id}`)
    for (const f of d.challenges.flatMap((c: any) => c.findings).filter((f: any) => f.severity === 'critical'))
      await h.ok('CIO1', 'POST', `/api/views/${v.id}/findings/${f.finding_id}/response`, { response: 'disagree', comment: 'Không đồng ý: tin nguồn chỉ nói về trái phiếu doanh nghiệp bất động sản, chưa đủ căn cứ cho cả loại tài sản' })
    await h.ok('CIO1', 'POST', `/api/views/${v.id}/decision`, { action: 'APPROVE', reason: 'Duyệt để kiểm thử sổ dự báo và chấm điểm' })
    const fc = await h.ok('CIO1', 'GET', `/api/views/${v.id}/forecast`)
    expect(fc.checkpoints.map((c: any) => c.status)).toEqual(['PENDING', 'PENDING', 'PENDING'])
    const day0 = fc.approved_at.slice(0, 10)
    // Số liệu thị trường: sai khoảng giá trị bị từ chối cả bản ghi; hợp lệ thì lưu, SJC_PREM tự tính
    await push('MD-BAD', 'market_data', { points: [{ key: 'USDVND_CENTRAL', date: day0, value: 25.6, url: U }] })
    await push('MD-1', 'market_data', { points: [{ key: 'VNINDEX', date: day0, value: 1700, url: 'https://hsx.vn/x' }, { key: 'USDVND_CENTRAL', date: day0, value: 25600, url: U }, { key: 'USDVND_VCB_SELL', date: day0, value: 26000, url: 'https://www.vietcombank.com.vn/tygia' }, { key: 'GOLD_SPOT_USD', date: day0, value: 4000, url: 'https://finance.yahoo.com/q' }, { key: 'SJC_SELL', date: day0, value: 140, url: 'https://sjc.com.vn/gia' }] })
    const imp = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(imp.rejected.some((r: any) => r.id === 'MD-BAD')).toBe(true)
    expect(imp.market).toEqual(expect.arrayContaining([`VNINDEX|${day0}`, `SJC_PREM|${day0}`]))
    const prem = (await h.ok('CIO1', 'GET', '/api/quality/series?key=SJC_PREM')).points[0]
    expect(prem.value).toBeCloseTo((140e6 / (4000 * 26000 * 1.20565) - 1) * 100, 1)
    // Sang ngày thứ 8: VN-Index tăng 5% → mốc 1 tuần được chấm
    clock = Date.parse(fc.approved_at) + 8 * 864e5
    const day8 = fc.checkpoints[0].due.slice(0, 10) // quan sát đúng ngày đến hạn mốc 1 tuần
    await push('MD-2', 'market_data', { points: [{ key: 'VNINDEX', date: day8, value: 1785, url: 'https://hsx.vn/x' }] })
    await h.ok('ADM1', 'POST', '/api/external/import')
    await h.ok('CIO1', 'POST', '/api/quality/score')
    const q = await h.ok('CIO1', 'GET', '/api/quality')
    expect(q.calibration.horizons[0].n).toBe(1)
    expect(q.calibration.forecasts[0].checkpoints[0]).toMatchObject({ status: 'SCORED', observed: { VN_EQ: 5 } })
    expect(q.calibration.calibrated).toBe(false)
    expect((await h.ok('RM1', 'GET', '/api/quality/calibration-label')).label).toMatch(/chưa hiệu chỉnh/)
    expect(q.review.approved).toBe(1)
    expect(q.review.critical_responses.disagree).toBeGreaterThan(0)
  })

  it('tạm dừng agent: bản ghi của agent bị từ chối kèm lý do; người cho chạy lại phải khác người tạm dừng; sự cố đóng cần đủ thông tin', async () => {
    const inc = await h.ok('CMP1', 'POST', '/api/ops/incidents', { agent: 'market_data', severity: 'high', what: 'Số liệu tỷ giá đẩy lên sai đơn vị nhiều ngày liền', pause: true })
    await push('MD-3', 'market_data', { points: [{ key: 'VNINDEX', date: new Date(clock).toISOString().slice(0, 10), value: 1790, url: 'https://hsx.vn/x' }] })
    const imp = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(imp.rejected.find((r: any) => r.id === 'MD-3').reason).toMatch(/tạm dừng/)
    expect((await h.call('CMP1', 'POST', '/api/ops/agents/market_data/resume', { reason: 'Đã sửa quy trình lấy số liệu tỷ giá' })).status).toBe(403)
    expect((await h.call('CMP1', 'PUT', `/api/ops/incidents/${inc.id}`, { close: true })).status).toBe(422)
    await h.ok('CMP1', 'PUT', `/api/ops/incidents/${inc.id}`, { why: 'Lấy nhầm cột nghìn đồng', fix: 'Thêm kiểm tra khoảng giá trị', rerun_done: true, close: true })
    await h.ok('ADM1', 'POST', '/api/ops/agents/market_data/resume', { reason: 'Đã sửa quy trình lấy số liệu tỷ giá' })
    const q = await h.ok('CIO1', 'GET', '/api/quality')
    expect(q.controls.market_data.paused).toBe(false)
    expect(q.incidents[0].status).toBe('CLOSED')
  })

  it('nhịp tim: có nhật ký lượt chạy thì báo đã chạy', async () => {
    await push('RL-1', 'run_log', { schedule: 'daily_news', status: 'ok', counts: { news: 12 }, notes: 'Quét đủ 7 nhóm' })
    await h.ok('ADM1', 'POST', '/api/external/import')
    const q = await h.ok('CIO1', 'GET', '/api/quality')
    const daily = q.schedules.find((s: any) => s.id === 'daily_news')
    expect(daily.last.counts.news).toBe(12)
  })

  it('bài kiểm tra phản biện: chỉ Tuân thủ/Quản trị tạo; chấm phát hiện của agent; nhận định không duyệt được', async () => {
    expect((await h.call('CIO1', 'POST', '/api/canaries', { view_id: viewId })).status).toBe(403)
    const c = await h.ok('CMP1', 'POST', '/api/canaries', { view_id: viewId, plants: ['sign_flip', 'prob_concentration'] })
    expect(c.status).toBe('CLOSED')
    expect(c.result.detected.length + c.result.missed.length).toBe(c.plants.length)
    const v = await h.ok('CIO1', 'GET', `/api/views/${c.view_id}`)
    expect(v.view.status).toBe('REJECTED')
    const q = await h.ok('CMP1', 'GET', '/api/quality')
    expect(q.canaries.planted).toBe(c.plants.length)
    expect(q.review.views_decided).toBe(1) // bài kiểm tra không tính vào chỉ số bàn duyệt
  })

  it('bộ sự kiện chuẩn: lượt đầu là tham chiếu, lượt lệch nhiều bị báo trôi, sự kiện có giai đoạn tương tự được so hướng thực tế', async () => {
    const levels = (s: number) => ['CASH', 'GOV_BOND', 'CORP_BOND', 'EQ_VN', 'EQ_INTL', 'FUND', 'GOLD', 'REAL_ESTATE', 'PRIVATE_EQ', 'CRYPTO', 'INSURANCE'].map(t => ({ scope: 'asset_class', target: t, level: ['EQ_VN', 'EQ_INTL', 'FUND'].includes(t) ? -2 * s : 0 }))
    const sc = (dir: 'up' | 'down') => ({ priced_in: 'none', branches: [{ id: 'B1', name: 'Bán tháo', probability: 0.7, regime: 'stress', core_shocks: [{ factor: 'VN_EQ', size: 'L', direction: dir }], rationale: 'Thuế quan làm xuất khẩu sụt giảm mạnh', source_ids: ['G08-N1'] }, { id: 'B2', name: 'Đàm phán', probability: 0.3, regime: 'calm', core_shocks: [{ factor: 'VN_EQ', size: 'S', direction: 'down' }], rationale: 'Thị trường kỳ vọng đàm phán giảm thuế', source_ids: ['G08-N1'] }] })
    await push('GV-1', 'golden_view', { golden_id: 'G08', view: { impacts: levels(1), scenarios: sc('down') }, meta: { model: 'claude-opus-5-5' } })
    await h.ok('ADM1', 'POST', '/api/external/import')
    await push('GV-2', 'golden_view', { golden_id: 'G08', view: { impacts: levels(-1), scenarios: sc('up') }, meta: { model: 'claude-opus-5-6' } })
    await h.ok('ADM1', 'POST', '/api/external/import')
    const g = await h.ok('CIO1', 'GET', '/api/golden')
    const g8 = g.events.find((x: any) => x.event.id === 'G08')
    expect(g8.reference).toBeTruthy()
    expect(g8.latest.drift.drift).toBe(true)
    expect(g.drifted).toContain('G08')
    expect(g8.reference.analog_check.detail.VN_EQ.same_sign).toBe(true)
  })

  it('giá AI chờ xác nhận hiện trong cảnh báo vận hành', async () => {
    await push('PR-1', 'prices', { price_date: '2026-10-09', points: [{ key: 'MBB', price: '26150', date: '2026-10-09', source: 'TCBS (MCP)' }] })
    await h.ok('ADM1', 'POST', '/api/external/import')
    const a = await h.ok('CIO1', 'GET', '/api/ops/alerts')
    expect(a.pending_prices).toBe(1)
  })
})

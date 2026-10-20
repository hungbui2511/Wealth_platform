// Đợt 1 sau phản biện độc lập vòng 1–2: cổng độc lập, phản biện soi kịch bản, bản tin dựng từ kịch bản, cảnh báo theo P10,
// mục tiêu dài hạn, khớp danh sách hạn chế theo ranh giới từ, miền giả lập.
import { describe, expect, it } from 'vitest'
import { DEFAULT_FACTOR_MODEL } from '../src/data/factorModel'
import type { FactorModel, ScenarioSet } from '../src/engine/scenario'
import { branchIssues, levelScenarioConflicts, scenarioDirections } from '../src/engine/consistency'
import { scenarioRuleChecks } from '../src/agents/challenger'
import { independenceOf, modelId } from '../src/worker/services/views'
import { fromScenario } from '../src/engine/apply'
import { D } from '../src/engine/dec'
import { DEFAULT_THRESHOLDS } from '../src/shared/catalog'
import { checkPublicSource, restrictedHits } from '../src/compliance/controls'
import { draftContent } from '../src/worker/services/releases'
import type { ImpactLine } from '../src/shared/types'

const M = DEFAULT_FACTOR_MODEL as unknown as FactorModel
const down: ScenarioSet = {
  priced_in: 'none',
  branches: [
    { id: 'B1', name: 'Cổ phiếu điều chỉnh', probability: 0.6, regime: 'calm', core_shocks: [{ factor: 'VN_EQ', size: 'M', direction: 'down' }], rationale: 'Bán ròng của khối ngoại kéo dài', source_ids: ['N1'] },
    { id: 'B2', name: 'Bán tháo', probability: 0.4, regime: 'stress', core_shocks: [{ factor: 'VN_EQ', size: 'L', direction: 'down' }], rationale: 'Lan sang toàn thị trường', source_ids: ['N1'] },
  ],
}
const line = (target: string, level: number): ImpactLine => ({ scope: 'asset_class', asset_class: target as never, target, level, direction: level > 0 ? 'positive' : level < 0 ? 'negative' : 'neutral', horizon: '1-3 tháng', confidence: 'medium', rationale: 'Lập luận mẫu cho kiểm thử', source_ids: ['N1'] } as ImpactLine)

describe('B1: cổng phản biện độc lập so trên mã mô hình', () => {
  it('chuẩn hoá mã mô hình từ tên hiển thị, mã API và nhãn bọc', () => {
    expect(modelId('Claude Opus 5.5')).toBe('claude-opus-5-5')
    expect(modelId('claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
    expect(modelId('Claude – phiên phản biện riêng (claude-opus-5-5)')).toBe('claude-opus-5-5')
    expect(modelId('gói subscription')).toBeNull()
  })
  it('cùng mô hình ở hai phiên khác nhau là không độc lập; không rõ mô hình cũng không độc lập', () => {
    const r = independenceOf('external_challenge', 'claude-opus-5-5', 'Claude – phiên phản biện riêng (Claude Opus 5.5)', { cio: 'S1', challenger: 'S2' })
    expect(r.independent).toBe(false)
    expect(independenceOf('external_challenge', 'claude-opus-5-5', 'Claude – phiên phản biện riêng (một mô hình nào đó)', { cio: 'S1', challenger: 'S2' }).independent).toBe(false)
    const ok = independenceOf('external_challenge', 'claude-opus-5-5', 'Claude – phiên phản biện riêng (claude-sonnet-5-5)', { cio: 'S1', challenger: 'S2' })
    expect(ok).toMatchObject({ independent: true, self_declared: true })
  })
})

describe('B2: phản biện soi nhánh kịch bản và đối chiếu dấu với mức', () => {
  it('mức dương cho cổ phiếu VN trong khi kịch bản đẩy giảm là mâu thuẫn Nghiêm trọng (mức ≥ 2)', () => {
    const c = levelScenarioConflicts([line('EQ_VN', 2), line('GOLD', 0)], M, down)
    expect(c.map(x => x.key)).toEqual(['asset_class:EQ_VN'])
    const f = scenarioRuleChecks({ event_id: 'E', view_id: 'V', event_type: 'x', summary: 's', impacts: [line('EQ_VN', 2)], scenarios: down } as never, M)
    expect(f.find(x => x.check === 'scenario_consistency')).toMatchObject({ severity: 'critical', target: 'asset_class:EQ_VN:EQ_VN' })
  })
  it('mức cùng hướng với kịch bản thì không có phát hiện mâu thuẫn', () => {
    expect(levelScenarioConflicts([line('EQ_VN', -2)], M, down)).toEqual([])
  })
  it('mọi nhánh cùng chiều và một nhánh chiếm ≥ 80% bị nêu; phản biện lại chỉ xét dòng đổi hoặc khi sửa kịch bản', () => {
    const lop: ScenarioSet = { ...down, branches: [{ ...down.branches[0], probability: 0.85 }, { ...down.branches[1], probability: 0.15 }] }
    const iss = branchIssues(M, lop)
    expect(iss.map(i => i.check)).toEqual(expect.arrayContaining(['overconfidence', 'scenario_balance']))
    const body = { event_id: 'E', view_id: 'V', event_type: 'x', summary: 's', impacts: [line('EQ_VN', 2), line('GOLD', 0)], scenarios: lop } as never
    expect(scenarioRuleChecks(body, M, new Set(['asset_class:GOLD:GOLD']))).toEqual([])
    expect(scenarioRuleChecks(body, M, new Set(['scenarios'])).length).toBeGreaterThan(1)
  })
})

describe('B2: bản tin dựng từ kịch bản', () => {
  it('hướng trong bản tin theo kịch bản, không theo mức trái dấu; có xác suất các nhánh', () => {
    const v = { id: 'VW-1', event_id: 'E', version: 1, body: { summary: 'Khối ngoại bán ròng', impacts: [line('EQ_VN', 2)], scenarios: down } } as never
    const t = draftContent(v, [], M)
    expect(t).toMatch(/Cổ phiếu niêm yết Việt Nam: theo kịch bản kỳ vọng, tác động tiêu cực/)
    expect(t).toMatch(/xác suất 60%/)
    expect(t).not.toMatch(/Lập luận mẫu/) // lập luận của dòng trái dấu không được dùng
    expect(scenarioDirections(M, down).some(d => d.key === 'asset_class:EQ_VN' && d.move < 0)).toBe(true)
  })
})

describe('B3: cảnh báo theo đuôi rủi ro', () => {
  it('trung bình nhẹ nhưng P10 nặng → Đỏ theo P10; giữ màu theo trung bình để đối chiếu', () => {
    const unit = { family_id: 'F', impact: '0', net_worth: '100000000000', pct: '0', alert: 'GREEN', illiquid_impact: '0', by_asset_class: {}, by_fx: {}, by_instrument: {}, top_instruments: [], positions: [] } as never
    const sc = { ranges: [{ horizon: '1w', bad: 0, base: 0, good: 0, bad_pct: 0, base_pct: 0 }, { horizon: '3m', bad: -3_000_000_000, base: -100_000_000, good: 0, bad_pct: -0.03, base_pct: -0.001 }], branches: [], by_factor: {}, by_asset_class: {}, positions: [{ holding_id: 'H', part: null, instrument_id: 'X', name: 'X', asset_class: 'EQ_VN', mean_3m: -200_000_000 }] }
    const r = fromScenario(unit, sc, D('100000000000'), DEFAULT_THRESHOLDS.alert)
    expect(r).toMatchObject({ alert: 'RED', alert_basis: 'P10_3M', alert_mean: 'GREEN', p10_3m: '-3000000000' })
  })
})

describe('Vệ sinh kiểm soát', () => {
  const entry = { id: 'R1', issuer: 'Công ty Demo X', instruments: ['VIB'], keywords: [] }
  it('danh sách hạn chế khớp theo ranh giới từ', () => {
    expect(restrictedHits(['Cổ phiếu VIB tăng'], [entry])).toHaveLength(1)
    expect(restrictedHits(['(VIB),'], [entry])).toHaveLength(1)
    expect(restrictedHits(['Phong cách VIBE mới'], [entry])).toHaveLength(0)
  })
  it('miền .example chỉ dùng cho tin giả lập', () => {
    const wl = [{ domain: 'tintuc-gialap.example' }]
    expect(checkPublicSource({ url: 'https://tintuc-gialap.example/a', published_at: '2026-10-01T00:00:00Z' }, wl, '2026-10-02T00:00:00Z').join()).toMatch(/giả lập/)
    expect(checkPublicSource({ url: 'https://tintuc-gialap.example/a', published_at: '2026-10-01T00:00:00Z', simulated: true }, wl, '2026-10-02T00:00:00Z')).toEqual([])
  })
})

import { harness } from './support/harness'
describe('Phát hiện Nghiêm trọng và mục tiêu theo kịch bản (tích hợp)', () => {
  const h = harness()
  it('không đồng ý với phát hiện Nghiêm trọng cần căn cứ ≥ 60 ký tự; mục tiêu ghi kỳ hạn dùng và kịch bản xấu', async () => {
    await h.call(null, 'POST', '/api/bootstrap')
    await h.ok('ADM1', 'POST', '/api/admin/load-sample-events')
    const v = await h.ok('CIO1', 'POST', '/api/events/EV-2026-0002/run-agent')
    const d = await h.ok('CIO1', 'GET', `/api/views/${v.id}`)
    const crit = d.challenges.flatMap((c: any) => c.findings).find((f: any) => f.severity === 'critical')
    const short = await h.call('CIO1', 'POST', `/api/views/${v.id}/findings/${crit.finding_id}/response`, { response: 'disagree', comment: 'Không đồng ý với phát hiện này nhé' })
    expect(short.status).toBe(422)
    await h.ok('CIO1', 'POST', `/api/views/${v.id}/findings/${crit.finding_id}/response`, { response: 'disagree', comment: 'Không đồng ý: hai tin nguồn chỉ nói về trái phiếu doanh nghiệp bất động sản, không đủ căn cứ hạ cả loại tài sản' })
    const r = await h.ok('CIO1', 'POST', `/api/views/${v.id}/decision`, { action: 'APPROVE', reason: 'Duyệt sau khi đã phản hồi phát hiện Nghiêm trọng' })
    const run = await h.ok('CIO1', 'GET', `/api/runs/${r.run_id}`)
    expect(run.goal_impacts.length).toBeGreaterThan(0)
    for (const g of run.goal_impacts) {
      expect(['3M', '12M']).toContain(g.basis)
      expect(g.stress.level_after).toBeTruthy()
      expect(Number(g.stress.delta_pts)).toBeLessThanOrEqual(Number(g.delta_pts) + 1e-9)
    }
  })
})

// Kiểm thử các sửa đổi theo báo cáo của agent phản biện độc lập (F01–F27).
import { beforeAll, describe, expect, it } from 'vitest'
import { harness } from './support/harness'
import { ASSET_CLASSES } from '../src/shared/catalog'
import { DEFAULT_FACTOR_MODEL } from '../src/data/factorModel'
import { factorModelErrors, familyScenario, isPositiveDefinite, type FactorModel, type ScenarioSet } from '../src/engine/scenario'
import { buildPositions, netWorth } from '../src/engine/positions'
import { normalizeLlmFindings } from '../src/agents/challenger'
import { auditHash, verifyAuditChain } from '../src/worker/db'
import { signExternal } from '../src/worker/services/external'
import { independenceOf } from '../src/worker/services/views'
import { callJson } from '../src/agents/llm'
import { book, exampleFamily, instruments } from './fixtures'

const M = DEFAULT_FACTOR_MODEL as unknown as FactorModel
const SET: ScenarioSet = {
  priced_in: 'none',
  branches: [
    { id: 'B1', name: 'Cơ sở', probability: 0.7, regime: 'calm', core_shocks: [{ factor: 'VN_EQ', size: 'M', direction: 'down' }], rationale: 'Thị trường cổ phiếu điều chỉnh vừa phải', source_ids: ['N1'] },
    { id: 'B2', name: 'Bất lợi', probability: 0.3, regime: 'stress', core_shocks: [{ factor: 'VN_EQ', size: 'L', direction: 'down' }], rationale: 'Điều chỉnh mạnh, chế độ căng thẳng', source_ids: ['N1'] },
  ],
}

describe('F07–F09: dải theo kỳ hạn, bất định cú sốc lõi, rủi ro riêng, mốc P5', () => {
  const f = exampleFamily()
  const pos = buildPositions(f, instruments, book)
  const nw = netWorth(f, pos, book).toNumber()
  const r = familyScenario(f, pos, book, instruments, M, SET, nw)
  it('độ rộng dải tăng theo kỳ hạn (1 tuần < 3 tháng < 12 tháng)', () => {
    const w = r.ranges.map(x => x.good - x.bad)
    expect(w[0]).toBeLessThan(w[1]); expect(w[1]).toBeLessThan(w[2])
    expect(r.ranges.map(x => x.months)).toEqual([0.25, 3, 12])
  })
  it('có mốc P5 (rất xấu) thấp hơn hoặc bằng P10', () => {
    for (const x of r.ranges) expect(x.severe).toBeLessThanOrEqual(x.bad)
  })
  it('phương sai gồm ba phần: tương quan còn lại, cỡ cú sốc lõi, rủi ro riêng từng mã', () => {
    const v = r.variance_share_3m
    expect(v.core).toBeGreaterThan(0)
    expect(v.residual + v.core + v.idio).toBeCloseTo(1, 6)
    const hasStock = pos.some(p => p.asset_class === 'EQ_VN' && p.part === null)
    if (hasStock) expect(v.idio).toBeGreaterThan(0)
  })
  it('cú sốc lõi không còn có độ lệch chuẩn bằng 0', () => {
    const noCore = familyScenario(f, pos, book, instruments, { ...M, core_shock_uncertainty: 0 }, SET, nw)
    expect(r.branches[0].sd[1]).toBeGreaterThan(noCore.branches[0].sd[1])
  })
})

describe('F14: kiểm tra mô hình yếu tố trước khi lưu', () => {
  it('mô hình mặc định hợp lệ, xác định dương', () => {
    expect(factorModelErrors(M)).toEqual([])
    expect(isPositiveDefinite(M.corr.calm as number[][])).toBe(true)
  })
  it('hệ số ngoài [−1, 1] và ma trận không xác định dương bị từ chối', () => {
    const bad = JSON.parse(JSON.stringify(M)) as FactorModel & { corr: { calm: number[][] } }
    bad.corr.calm[0][1] = 1.4; bad.corr.calm[1][0] = 1.4
    const e = factorModelErrors(bad)
    expect(e.join(' ')).toMatch(/ngoài \[−1, 1\]/)
    expect(e.join(' ')).toMatch(/không xác định dương/)
  })
})

describe('F12: không tự hạ mức phát hiện Nghiêm trọng', () => {
  it('giữ đủ 4 phát hiện Nghiêm trọng', () => {
    const raw = [1, 2, 3, 4].map(i => ({ check: 'source_support', severity: 'critical', target: `asset_class:EQ_VN:EQ_VN`, issue: `Vấn đề thứ ${i} cần CIO xem xét kỹ`, suggestion: 'Xem lại căn cứ của dòng nhận định' }))
    const n = normalizeLlmFindings(raw, new Set())
    expect(n.findings.filter(f => f.severity === 'critical').length).toBe(4)
  })
})

describe('F11: độc lập của phản biện', () => {
  it('cùng bản ghi với nhận định là không độc lập; phiên khác + mô hình khác là độc lập', () => {
    expect(independenceOf('external_same', '', '').independent).toBe(false)
    expect(independenceOf('live', 'claude-opus-5-5', 'claude-opus-5-5').independent).toBe(false)
    expect(independenceOf('live', 'claude-opus-5-5', 'claude-sonnet-5-5').independent).toBe(true)
    expect(independenceOf('external_challenge', 'Claude Opus 5.5', 'Claude Sonnet 5.5', { cio: 'S1', challenger: 'S1' }).independent).toBe(false)
    expect(independenceOf('external_challenge', 'Claude Opus 5.5', 'Claude Sonnet 5.5', { cio: 'S1', challenger: 'S2' }).independent).toBe(true)
  })
})

describe('F23: nhật ký có khóa HMAC', () => {
  it('chuỗi HMAC kiểm được với khóa; không có khóa thì báo lỗi; dòng thường sau dòng HMAC bị phát hiện', async () => {
    const h = harness({ env: { AUDIT_HMAC_KEY: 'k-test' } })
    await h.call(null, 'POST', '/api/bootstrap')
    const ok = await verifyAuditChain(h.DB, 'k-test')
    expect(ok.ok).toBe(true)
    expect(ok.hmac_from_seq).toBe(1)
    expect((await verifyAuditChain(h.DB)).ok).toBe(false)
    expect((await verifyAuditChain(h.DB, 'khóa-sai')).ok).toBe(false)
    const h2 = await auditHash('k', 'GENESIS', { seq: 1, ts: 't', actor: 'a', action: 'x', object: null, data: '{}' })
    expect(h2.startsWith('hmac:')).toBe(true)
  })
})

describe('F24: không dùng mô hình dự phòng', () => {
  it('mô hình trả lời khác mô hình đã duyệt thì báo lỗi', async () => {
    const fake = (async () => new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: '{"a":1}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    await expect(callJson({ ANTHROPIC_API_KEY: 'x' }, { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', max_tokens: 100 }, 's', 'u', fake)).rejects.toThrow(/khác mô hình đã duyệt/)
  })
})

describe('Bàn duyệt, cấu hình hai người, nguồn tin (chạy qua API)', () => {
  const h = harness()
  beforeAll(async () => { const r = await h.call(null, 'POST', '/api/bootstrap'); if (r.status >= 400) throw new Error(JSON.stringify(r.data)); await h.ok('ADM1', 'POST', '/api/admin/load-sample-events') })

  it('F12: CIO sửa nhánh kịch bản → phải phản biện lại trước khi duyệt', async () => {
    const v = await h.ok('CIO1', 'POST', '/api/events/EV-2026-0002/run-agent')
    expect(v.status).toBe('PENDING_APPROVAL')
    const sc = JSON.parse(JSON.stringify(v.body.scenarios))
    sc.branches[0].probability = 0.6; sc.branches[1].probability = 0.4
    const e = await h.ok('CIO1', 'PUT', `/api/views/${v.id}/scenarios`, { scenarios: sc, note: 'Tăng xác suất nhánh bất lợi theo đánh giá rủi ro' })
    expect(e.status).toBe('PENDING_CHALLENGE')
    expect(e.unchallenged).toContain('scenarios')
    const d = await h.call('CIO1', 'POST', `/api/views/${v.id}/decision`, { action: 'APPROVE', reason: 'Duyệt sau khi sửa kịch bản bất lợi' })
    expect(d.status).toBe(409)
    expect(JSON.stringify(d.data)).toContain('(b)')
    const re = await h.ok('CIO1', 'POST', `/api/views/${v.id}/rechallenge`)
    expect(re.status).toBe('PENDING_APPROVAL')
  })

  it('F04: nhận định không có nhánh kịch bản thì không duyệt được', async () => {
    const v = await h.ok('CIO1', 'POST', '/api/events/EV-2026-0005/run-agent')
    const u = h.env.DB.prepare('UPDATE views SET data = json_remove(data, \'$.body.scenarios\') WHERE id = ?').bind(v.id)
    await u.run()
    const d = await h.call('CIO1', 'POST', `/api/views/${v.id}/decision`, { action: 'APPROVE', reason: 'Duyệt thử nhận định không có kịch bản' })
    expect(d.status).toBe(409)
    expect(JSON.stringify(d.data)).toContain('(e)')
  })

  it('F14: mô hình yếu tố cần người thứ hai xác nhận; người đề xuất không tự xác nhận', async () => {
    const p = await h.ok('CIO1', 'POST', '/api/config/FACTOR_MODEL', { content: DEFAULT_FACTOR_MODEL, reason: 'Hiệu chỉnh mô hình yếu tố theo dữ liệu tháng mới' })
    expect(p.status).toBe('PENDING_CONFIRM')
    expect((await h.call('CIO1', 'POST', `/api/config/versions/${p.id}/decision`, { approve: true, reason: 'CIO tự xác nhận mô hình của mình' })).status).toBe(403)
    const c = await h.ok('CMP1', 'POST', `/api/config/versions/${p.id}/decision`, { approve: true, reason: 'Đã rà soát tương quan và thư viện cú sốc' })
    expect(c.status).toBe('ACTIVE')
    const bad = JSON.parse(JSON.stringify(DEFAULT_FACTOR_MODEL))
    bad.corr.stress[0][1] = 2; bad.corr.stress[1][0] = 2
    expect((await h.call('CIO1', 'POST', '/api/config/FACTOR_MODEL', { content: bad, reason: 'Đề xuất ma trận tương quan sai để thử' })).status).toBe(422)
    const t = await h.ok('CIO1', 'GET', '/api/config')
    const thr = t.versions.find((x: any) => x.kind === 'THRESHOLD' && x.status === 'ACTIVE')
    expect((await h.ok('CIO1', 'POST', '/api/config/THRESHOLD', { content: thr.content, reason: 'Giữ nguyên ngưỡng, thử quy trình hai người' })).status).toBe('PENDING_CONFIRM')
  })

  it('F20: tin có giờ công bố ở tương lai bị từ chối', async () => {
    const { addToInbox } = await import('../src/worker/services/ingest')
    const { makeCtx } = await import('../src/worker/ctx')
    const ctx = makeCtx(h.env, { id: 'ADM1', name: 'a', role: 'ADMIN', families: [] }, { now: () => '2026-10-10T03:00:00.000Z' })
    const out = await addToInbox(ctx, [{ feed: 'thử', item: { title: 'NHNN tăng lãi suất điều hành', url: 'https://vnexpress.net/tuong-lai-1.html', published_at: '2026-10-11T03:00:00.000Z', summary: 'Ngân hàng Nhà nước tăng lãi suất điều hành' } }], { trigger: 'manual', minRelevance: 0 })
    expect(out.report.created).toBe(0)
    expect(out.report.rejected_items[0].errors[0]).toMatch(/tương lai/)
  })

  it('F02: diễn giải không gọi mô hình AI bên ngoài', async () => {
    const health = await h.call(null, 'GET', '/api/health')
    expect(health.data.controls.interpretation_llm).toBe('off')
    expect(health.data.warnings.length).toBeGreaterThan(0)
  })
})

describe('F01 + F11: kênh vùng AI có chữ ký và phản biện từ phiên riêng', () => {
  const KEY = 'ext-key'
  const h = harness({ env: { AGENT_MODE: 'external', EXTERNAL_HMAC_KEY: KEY } })
  let seq = 0
  const U1 = 'https://vnexpress.net/ls-1.html', U2 = 'https://baodautu.vn/ls-2.html'
  const lines = (src: string) => [...ASSET_CLASSES.map(ac => ac === 'CASH'
    ? { scope: 'asset_class', asset_class: 'CASH', target: 'CASH', level: 1, direction: 'positive', horizon: '1-3 tháng', confidence: 'medium', rationale: 'Nhiều ngân hàng tăng lãi suất huy động kỳ hạn 12 tháng', source_ids: [src] }
    : { scope: 'asset_class', asset_class: ac, target: ac, level: 0, direction: 'insufficient_evidence', rationale: 'Tin không đủ căn cứ cho loại tài sản này', source_ids: [] }),
    ...['USD', 'SGD', 'AUD'].map(c => ({ scope: 'fx', target: c, level: 0, direction: 'neutral', rationale: 'Tin không nhắc tới tỷ giá trong kỳ này', source_ids: [] }))]
  const scen = (src: string) => ({ priced_in: 'partial', branches: [
    { id: 'B1', name: 'Cơ sở', probability: 0.7, regime: 'calm', core_shocks: [{ factor: 'VN_RATE', size: 'S', direction: 'up' }], rationale: 'Lãi suất huy động nhích nhẹ theo tin', source_ids: [src] },
    { id: 'B2', name: 'Bất lợi', probability: 0.3, regime: 'stress', core_shocks: [{ factor: 'VN_RATE', size: 'M', direction: 'up' }], rationale: 'Lãi suất tăng mạnh hơn dự kiến', source_ids: [src] }] })
  async function submit(kind: string, subject: string | null, data: Record<string, unknown>, sign = true) {
    const body = { ...data, ...(sign ? { _sig: await signExternal(KEY, data) } : {}) }
    return h.call(null, 'POST', '/api/external/submit', { id: `EXT-S-${++seq}`, kind, subject, data: body })
  }
  beforeAll(async () => { const r = await h.call(null, 'POST', '/api/bootstrap'); if (r.status >= 400) throw new Error(JSON.stringify(r.data)) })

  it('bản ghi không ký bị từ chối ngay ở cổng gửi; ghi thẳng vào bảng mà không ký thì bị từ chối khi nhập', async () => {
    expect((await submit('news', null, { items: [] }, false)).status).toBe(401)
    await h.DB.prepare("INSERT INTO external_outputs (id, kind, subject, status, created_at, data) VALUES ('RAW-1', 'news', NULL, 'READY', '2026-10-10T01:00:00.000Z', ?)").bind(JSON.stringify({ items: [] })).run()
    await h.ok('ADM1', 'POST', '/api/external/import')
    const row = (await h.ok('CIO1', 'GET', '/api/external')).find((x: any) => x.id === 'RAW-1')
    expect(row.status).toBe('REJECTED')
    expect(row.error).toMatch(/chữ ký/)
  })

  it('nhận định kèm phản biện cùng phiên: chưa duyệt được (f); phản biện từ phiên khác, mô hình khác: duyệt được', async () => {
    expect((await submit('news', null, { items: [
      { title: 'NHNN giữ nguyên lãi suất điều hành', url: U1, published_at: '2026-10-09T08:00:00+07:00', summary: 'Ngân hàng Nhà nước giữ nguyên lãi suất' },
      { title: 'Nhiều ngân hàng tăng lãi suất huy động', url: U2, published_at: '2026-10-09T09:00:00+07:00', summary: 'Lãi suất kỳ hạn 12 tháng tăng 0,2 điểm %' }] })).status).toBe(200)
    await submit('event', null, { ref: 'S-1', type: 'monetary_policy', title: 'Lãi suất huy động tăng', news_urls: [U1, U2] })
    await submit('cio_view', 'S-1', { view: { summary: 'Lãi suất huy động nhích lên', impacts: lines(U2), scenarios: scen(U2) }, challenger: { findings: [] }, meta: { model: 'Claude Opus 5.5', session: 'SES-A' } })
    const imp = await h.ok('ADM1', 'POST', '/api/external/import')
    const vid = imp.views[0].view_id
    expect(imp.unsigned).toEqual([])
    const d1 = await h.call('CIO1', 'POST', `/api/views/${vid}/decision`, { action: 'APPROVE', reason: 'Duyệt nhận định lãi suất huy động' })
    expect(d1.status).toBe(409)
    expect(JSON.stringify(d1.data)).toContain('(f)')
    // Cùng phiên → vẫn không độc lập
    await submit('challenge', vid, { findings: [], meta: { model: 'Claude Sonnet 5.5', session: 'SES-A' } })
    await h.ok('ADM1', 'POST', '/api/external/import')
    expect((await h.call('CIO1', 'POST', `/api/views/${vid}/decision`, { action: 'APPROVE', reason: 'Duyệt nhận định lãi suất huy động' })).status).toBe(409)
    // Phiên khác nhưng cùng mô hình với bên soạn → không độc lập (trước đây lọt vì so nhãn bọc thay vì mã mô hình)
    await submit('challenge', vid, { findings: [], meta: { model: 'Claude Opus 5.5', session: 'SES-C' } })
    await h.ok('ADM1', 'POST', '/api/external/import')
    const dSame = await h.ok('CIO1', 'GET', `/api/views/${vid}`)
    const last = dSame.challenges.filter((c: any) => c.stage === 'pre_approval').at(-1)
    expect(last.independence).toMatchObject({ independent: false })
    expect(last.independence.reason).toMatch(/cùng mô hình.*claude-opus-5-5/)
    expect((await h.call('CIO1', 'POST', `/api/views/${vid}/decision`, { action: 'APPROVE', reason: 'Duyệt nhận định lãi suất huy động' })).status).toBe(409)
    // Phiên khác, mô hình khác → độc lập
    await submit('challenge', vid, { findings: [{ check: 'source_support', severity: 'medium', target: 'asset_class:CASH:CASH', issue: 'Chỉ một nhóm ngân hàng tăng lãi suất, có thể chưa đại diện', suggestion: 'Hạ độ tin cậy xuống thấp' }], meta: { model: 'Claude Sonnet 5.5', session: 'SES-B' } })
    const imp2 = await h.ok('ADM1', 'POST', '/api/external/import')
    expect(imp2.challenges.length).toBe(1)
    const d = await h.ok('CIO1', 'GET', `/api/views/${vid}`)
    expect(d.challenges.some((c: any) => c.independence?.independent && c.independence.self_declared)).toBe(true)
    const ok = await h.ok('CIO1', 'POST', `/api/views/${vid}/decision`, { action: 'APPROVE', reason: 'Duyệt nhận định lãi suất huy động' })
    expect(ok.run_id).toMatch(/^AR-/)
  })
})

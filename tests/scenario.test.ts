// Thiết kế v2: nhánh kịch bản → lan truyền theo tương quan → dải xấu/cơ sở/tốt cho từng gia đình
import { describe, expect, it } from 'vitest'
import { DEFAULT_FACTOR_MODEL } from '../src/data/factorModel'
import { familyScenario, mixtureQuantile, propagate, scenarioPreview, type FactorModel, type ScenarioSet } from '../src/engine/scenario'
import { buildPositions, netWorth } from '../src/engine/positions'
import { validateScenarios, DEFAULT_FACTOR_IDS } from '../src/shared/schemas'
import { book, exampleFamily, instruments } from './fixtures'

const M = DEFAULT_FACTOR_MODEL as unknown as FactorModel
const fedHike: ScenarioSet = {
  priced_in: 'none',
  branches: [
    { id: 'B1', name: 'Fed diều hâu bất ngờ', probability: 0.3, regime: 'stress', core_shocks: [{ factor: 'US10Y', size: 'M', direction: 'up' }, { factor: 'DXY', size: 'M', direction: 'up' }], rationale: 'Fed tăng lãi suất ngoài dự kiến, USD mạnh lên', source_ids: ['N1'] },
    { id: 'B2', name: 'Đúng kỳ vọng', probability: 0.7, regime: 'calm', core_shocks: [{ factor: 'US10Y', size: 'S', direction: 'up' }], rationale: 'Thị trường đã phản ánh phần lớn thông tin', source_ids: ['N1'] },
  ],
}

describe('Lan truyền cú sốc theo tương quan', () => {
  it('yếu tố lõi giữ nguyên cỡ trong thư viện; yếu tố khác suy ra cùng chiều tương quan', () => {
    const b = propagate(M, fedHike.branches[0] as never, 'none')
    expect(b.shocks.US10Y).toBe(30)
    expect(b.shocks.DXY).toBe(2)
    expect(b.shocks.USDVND).toBeGreaterThan(0)      // USD mạnh → áp lực tỷ giá
    expect(b.shocks.VN_EQ).toBeLessThan(0)          // cổ phiếu VN giảm
    expect(b.shocks.GOLD_W).toBeLessThan(0)         // vàng giảm khi USD và lợi suất tăng
    expect(b.cond_cov[0][0]).toBe(0)                // yếu tố lõi không còn bất định
  })
  it('thị trường đã phản ánh một phần: cú sốc giảm một nửa', () => {
    expect(propagate(M, fedHike.branches[0] as never, 'partial').shocks.US10Y).toBe(15)
  })
  it('phân vị của hỗn hợp chuẩn', () => {
    expect(mixtureQuantile([{ w: 1, m: 0, s: 1 }], 0.5)).toBeCloseTo(0, 6)
    expect(mixtureQuantile([{ w: 1, m: 0, s: 1 }], 0.1)).toBeCloseTo(-1.2816, 3)
  })
  it('xem trước: cú sốc kỳ vọng theo xác suất', () => {
    const p = scenarioPreview(M, fedHike)
    expect(p.expected.US10Y).toBeCloseTo(0.3 * 30 + 0.7 * 15, 6)
  })
})

describe('Kiểm tra hợp lệ nhánh kịch bản', () => {
  const news = new Set(['N1'])
  it('hợp lệ', () => expect(validateScenarios(fedHike, DEFAULT_FACTOR_IDS, news).ok).toBe(true))
  it('tổng xác suất khác 1, yếu tố lạ, nguồn lạ', () => {
    const bad = { ...fedHike, branches: [{ ...fedHike.branches[0], probability: 0.5, core_shocks: [{ factor: 'XYZ', size: 'M', direction: 'up' }], source_ids: ['N9'] }, fedHike.branches[1]] }
    const r = validateScenarios(bad, DEFAULT_FACTOR_IDS, news)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/Tổng xác suất/)
    expect(r.errors.join(' ')).toMatch(/XYZ/)
    expect(r.errors.join(' ')).toMatch(/N9/)
  })
  it('chỉ một nhánh là không đủ', () => expect(validateScenarios({ ...fedHike, branches: [fedHike.branches[0]] }, DEFAULT_FACTOR_IDS, news).ok).toBe(false))
})

describe('Dải tác động cho gia đình', () => {
  const f = exampleFamily()
  const pos = buildPositions(f, instruments, book)
  const nw = netWorth(f, pos, book).toNumber()
  const r = familyScenario(f, pos, book, instruments, M, fedHike, nw)
  it('ba kỳ hạn, xấu ≤ cơ sở ≤ tốt', () => {
    expect(r.ranges.map(x => x.horizon)).toEqual(['1 tuần', '3 tháng', '12 tháng'])
    for (const x of r.ranges) { expect(x.bad).toBeLessThanOrEqual(x.base); expect(x.base).toBeLessThanOrEqual(x.good) }
  })
  it('tổng đóng góp theo yếu tố bằng tác động trung bình 3 tháng', () => {
    const mean3 = r.branches.reduce((a, b) => a + b.probability * b.mean[1], 0)
    const sum = Object.values(r.by_factor).reduce((a, b) => a + b, 0)
    expect(Math.abs(sum - mean3)).toBeLessThan(5)
  })
  it('tính lại cho cùng kết quả (tất định)', () => {
    expect(familyScenario(f, pos, book, instruments, M, fedHike, nw)).toEqual(r)
  })
  it('có quyết định luồng 2', () => expect(['AUTO', 'RM_REVIEW']).toContain(r.lane2.route))
})

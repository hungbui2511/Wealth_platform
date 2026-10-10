// AC-10 (phần đơn vị), BR-13, BR-14
import { describe, expect, it } from 'vitest'
import { allowedFromResult, checkText, extractNumbers, templateInterpretation } from '../src/engine/numbercheck'
import { computeFamilyImpact } from '../src/engine/apply'
import { buildPositions, netWorth } from '../src/engine/positions'
import { DEFAULT_BANNED_PHRASES, DEFAULT_THRESHOLDS } from '../src/shared/catalog'
import { book, exampleFamily, exampleView, instruments, unitCfg } from './fixtures'

const f = exampleFamily()
const pos = buildPositions(f, instruments, book)
const view = exampleView()
const r = computeFamilyImpact(f.id, pos, netWorth(f, pos, book), view, unitCfg, DEFAULT_THRESHOLDS.alert)
const allowed = allowedFromResult(r, view)

describe('BR-13 – kiểm tra số', () => {
  it('chấp nhận các cách viết hợp lệ', () => {
    for (const t of [
      'Danh mục giảm 488 triệu, tương đương 0,98% tài sản ròng.',
      'Tác động −488.000.000 VND (−0,976%).',
      'Tác động là -488 triệu đồng.',
      'Tài sản ròng 50 tỷ; tiền gửi USD tăng 12 triệu.',
      'Khung thời gian 1-3 tháng, thế hệ 2, sự kiện EV-2026-0002 của DEMO-F01 ngày 09/10/2026, năm 2030.',
      '1. Cổ phiếu ngân hàng DMNGA giảm 250 triệu\n2. Quỹ DMQCP giảm 200 triệu',
      'Mức −3 cho cổ phiếu bất động sản, cú sốc −7,5%.',
    ]) {
      const c = checkText(t, allowed, DEFAULT_BANNED_PHRASES)
      expect(c.violations, t).toEqual([])
    }
  })
  it('chặn số lạ', () => {
    const c = checkText('Danh mục có thể giảm tới 1,2 tỷ, tức 2,4% tài sản ròng.', allowed, DEFAULT_BANNED_PHRASES)
    expect(c.ok).toBe(false)
    expect(c.violations.map(v => v.text)).toEqual(['1,2 tỷ', '2,4%'])
  })
  it('chặn sai dấu khi có chữ "tăng"', () => {
    expect(checkText('Danh mục tăng 488 triệu.', allowed, []).ok).toBe(false)
  })
  it('BR-14 chặn cụm từ khuyến nghị', () => {
    expect(checkText('Khách nên bán cổ phiếu bất động sản.', allowed, DEFAULT_BANNED_PHRASES).ok).toBe(false)
  })
  it('đoạn mẫu xác định luôn qua kiểm tra', () => {
    const t = templateInterpretation('Gia đình ví dụ', r, view)
    expect(checkText(t, allowed, DEFAULT_BANNED_PHRASES).violations).toEqual([])
  })
  it('trích số kèm đơn vị', () => {
    expect(extractNumbers('giảm 2,48 tỷ').map(n => n.value)).toEqual([-2.48e9])
  })
})

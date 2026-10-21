// Sửa theo đánh giá độc lập 21/10/2026: nguồn phản biện dẫn bằng URL, kiểm tra đổi chiều so với nhận định gần đây.
import { describe, expect, it } from 'vitest'
import { flipChecks, normalizeLlmFindings } from '../src/agents/challenger'
import { mapSources, urlKey } from '../src/worker/services/views'
import type { ViewBody } from '../src/shared/types'

describe('Nguồn của phản biện ghi bằng đường dẫn', () => {
  const news = [{ id: 'NW-0001', url: 'http://vneconomy.vn/a.htm' }, { id: 'NW-0002', url: 'https://www.vietstock.vn/b.htm' }] as never
  it('đổi URL sang mã tin, không phân biệt http/https, www, dấu / cuối', () => {
    expect(urlKey('https://www.Vietstock.vn/b.htm/')).toBe('vietstock.vn/b.htm')
    const f = mapSources([{ check: 'source_support', severity: 'medium', target: 'asset_class:GOLD:GOLD', issue: 'Nguồn không nói về giá vàng trong nước', suggestion: 'Bổ sung nguồn về giá vàng SJC trong nước', source_ids: ['https://vneconomy.vn/a.htm', 'https://vietstock.vn/b.htm/', 'NW-0001'] }], news) as any[]
    expect(f[0].source_ids).toEqual(['NW-0001', 'NW-0002', 'NW-0001'])
    const n = normalizeLlmFindings(f, new Set(['NW-0001', 'NW-0002']))
    expect(n.dropped).toEqual([])
    expect(n.findings[0].source_ids).toEqual(['NW-0001', 'NW-0002', 'NW-0001'])
  })
})

describe('Đổi chiều so với nhận định gần đây', () => {
  const line = (level: number, rationale: string) => ({ scope: 'asset_class', asset_class: 'EQ_VN', target: 'EQ_VN', level, direction: level < 0 ? 'negative' : 'positive', horizon: '1-3 tháng', confidence: 'low', rationale, source_ids: ['NW-1'] })
  const prior = [{ view_id: 'VW-0017-v1', created_at: '2026-10-20T10:00:00Z', impacts: [{ scope: 'asset_class', target: 'EQ_VN', level: 1 }] }]
  it('đổi dấu mà không giải thích thì nêu phát hiện; có giải thích hoặc cùng chiều thì không', () => {
    const f = flipChecks({ impacts: [line(-1, 'Khối ngoại bán ròng mạnh trở lại, thanh khoản giảm')] } as unknown as ViewBody, prior)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ check: 'inconsistency_with_past_view', severity: 'medium' })
    expect(flipChecks({ impacts: [line(-1, 'Đảo chiều so với VW-0017 vì khối ngoại bán ròng mạnh trở lại')] } as unknown as ViewBody, prior)).toHaveLength(0)
    expect(flipChecks({ impacts: [line(1, 'Dòng tiền tiếp tục vào')] } as unknown as ViewBody, prior)).toHaveLength(0)
  })
})

// AC-06: ví dụ tính tay Mục 6.2
import { describe, expect, it } from 'vitest'
import { buildPositions, netWorth, overview } from '../src/engine/positions'
import { computeFamilyImpact, alertLevel } from '../src/engine/apply'
import { DEFAULT_THRESHOLDS } from '../src/shared/catalog'
import { D } from '../src/engine/dec'
import { book, exampleFamily, exampleView, instruments, unitCfg } from './fixtures'

describe('Mục 6.2 – ví dụ tính tay', () => {
  const f = exampleFamily()
  const pos = buildPositions(f, instruments, book)
  const nw = netWorth(f, pos, book)

  it('tài sản ròng 50 tỷ sau tỷ lệ sở hữu và nợ', () => {
    expect(nw.toFixed(0)).toBe('50000000000')
    const o = overview(f, pos, book)
    expect(o.total_assets.minus(o.total_liabilities).toFixed(0)).toBe('50000000000')
  })

  it('ra đúng −488.000.000 VND, −0,976%, mức Vàng', () => {
    const r = computeFamilyImpact(f.id, pos, nw, exampleView(), unitCfg, DEFAULT_THRESHOLDS.alert)
    expect(r.impact).toBe('-488000000')
    expect(D(r.pct!).times(100).toFixed(3)).toBe('-0.976')
    expect(r.alert).toBe('YELLOW')
  })

  it('dòng được chọn và cú sốc của từng vị thế (nút Cách tính)', () => {
    const r = computeFamilyImpact(f.id, pos, nw, exampleView(), unitCfg, DEFAULT_THRESHOLDS.alert)
    const by = (h: string, part: string | null = null) => r.positions.find(p => p.holding_id === h && p.part === part)!
    expect(by('H-NGA')).toMatchObject({ rule: 'asset_class', asset_shock: '-0.025', impact: '-250000000' })
    expect(by('H-BDA')).toMatchObject({ rule: 'asset_class', asset_shock: '-0.01', impact: '-50000000' })
    expect(by('H-QCP', '0')).toMatchObject({ rule: 'asset_class', impact: '-50000000' })
    expect(by('H-QCP', '1')).toMatchObject({ rule: 'sector', asset_shock: '-0.075', impact: '-150000000' })
    const usd = by('H-USD')
    expect(usd.exposure).toBe('1200000000')
    expect(usd).toMatchObject({ asset_shock: '0', fx_shock: '0.01', impact: '12000000' })
    expect(by('H-VND').impact).toBe('0')
    expect(r.illiquid_impact).toBe('0')
  })

  it('ngưỡng cảnh báo BR-12', () => {
    const t = DEFAULT_THRESHOLDS.alert
    expect(alertLevel(D(-100), D('-0.02'), t)).toBe('RED')
    expect(alertLevel(D('-5000000000'), D('-0.001'), t)).toBe('RED')
    expect(alertLevel(D('-1000000000'), D('-0.001'), t)).toBe('YELLOW')
    expect(alertLevel(D('-10'), D('-0.001'), t)).toBe('GREEN')
    expect(alertLevel(D('10'), D('0.005'), t)).toBe('POSITIVE')
    expect(alertLevel(D('-6000000000'), null, t)).toBe('RED')
  })
})

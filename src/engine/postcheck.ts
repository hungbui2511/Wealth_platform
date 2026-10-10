// Hậu kiểm theo quy tắc xác định (BR-17). Không dùng LLM.
import type { Finding } from '../shared/types'
import { D, Decimal, sum, monthsBetween } from './dec'
import type { Position } from './positions'
import type { FamilyImpactResult } from './apply'

export interface PostcheckThresholds { stale_months: number; outlier_z: string; outlier_min_families: number; concentration_pct: string; fallback_max_sessions: number }

export interface PostcheckInput {
  price_date: string
  families: { family_id: string; positions: Position[]; result: FamilyImpactResult }[]
}

export function runPostcheck(prefix: string, inp: PostcheckInput, t: PostcheckThresholds): Finding[] {
  const out: Omit<Finding, 'finding_id'>[] = []
  const f = (check: string, severity: Finding['severity'], target: string, issue: string, suggestion: string, value?: string, threshold?: string) =>
    out.push({ stage: 'post_check', origin: 'rule', check, severity, target, issue, suggestion, value, threshold })

  for (const fam of inp.families) {
    const seenMissing = new Set<string>(), seenFallback = new Set<string>(), seenStale = new Set<string>()
    for (const p of fam.positions) {
      if (p.listed && p.missing_price && !seenMissing.has(p.instrument_id)) {
        seenMissing.add(p.instrument_id)
        f('missing_price', 'critical', fam.family_id, `Công cụ niêm yết ${p.instrument_id} không có giá tại ${inp.price_date} (quá ${t.fallback_max_sessions} phiên)`, 'Bổ sung giá hoặc xác nhận cách xử lý trước khi cho kết quả hiệu lực', p.instrument_id)
      }
      if (p.listed && p.price_point?.flag === 'fallback' && !seenFallback.has(p.instrument_id)) {
        seenFallback.add(p.instrument_id)
        f('price_fallback', 'medium', fam.family_id, `Công cụ ${p.instrument_id} dùng giá dự phòng ngày ${p.price_point.date} thay cho nguồn chính`, 'Kiểm tra nguồn chính và tải lại giá khi có', p.price_point.date, String(t.fallback_max_sessions))
      }
      const vd = p.price_point?.valuation_date
      if (vd && !seenStale.has(p.holding_id) && monthsBetween(vd, inp.price_date) > t.stale_months) {
        seenStale.add(p.holding_id)
        f('stale_valuation', 'medium', fam.family_id, `Tài sản ${p.instrument_name} có ngày định giá ${vd}, cũ hơn ${t.stale_months} tháng tính tới ${inp.price_date}`, 'Cập nhật định giá mới cho tài sản này', vd, `${t.stale_months} tháng`)
      }
    }
    const nw = D(fam.result.net_worth)
    if (nw.lte(0)) f('non_positive_net_worth', 'critical', fam.family_id, `Tài sản ròng của ${fam.family_id} không dương (${fam.result.net_worth} VND); % tác động không xác định`, 'Kiểm tra dữ liệu nợ và tài sản của gia đình trước khi cho hiệu lực', fam.result.net_worth, '0')
    else {
      const byInst: Record<string, Decimal> = {}
      for (const p of fam.positions) byInst[p.instrument_id] = (byInst[p.instrument_id] ?? D(0)).plus(p.exposure)
      for (const [id, v] of Object.entries(byInst)) {
        const share = v.div(nw)
        if (share.gt(D(t.concentration_pct)) && !id.startsWith('CASH-'))
          f('concentration', 'low', fam.family_id, `Công cụ ${id} chiếm ${share.times(100).toFixed(1)}% tài sản ròng của gia đình`, 'Lưu ý mức tập trung khi đọc kết quả tác động', share.toFixed(4), t.concentration_pct)
      }
    }
  }
  // Ngoại lai theo z-score của % tác động, chỉ xét khi có đủ số gia đình có tác động khác 0
  const pcts = inp.families.filter(x => x.result.pct !== null && !D(x.result.impact).isZero()).map(x => ({ id: x.family_id, v: D(x.result.pct!) }))
  if (pcts.length >= t.outlier_min_families) {
    const mean = sum(pcts.map(p => p.v)).div(pcts.length)
    const sd = sum(pcts.map(p => p.v.minus(mean).pow(2))).div(pcts.length).sqrt()
    if (sd.gt(0)) for (const p of pcts) {
      const z = p.v.minus(mean).div(sd)
      if (z.abs().gt(D(t.outlier_z))) f('outlier_family', 'medium', p.id, `% tác động của ${p.id} lệch ${z.toFixed(2)} độ lệch chuẩn so với trung bình`, 'Rà lại cơ cấu tài sản và các dòng nhận định áp cho gia đình này', z.toFixed(4), t.outlier_z)
    }
  }
  return out.map((x, i) => ({ ...x, finding_id: `${prefix}-F${i + 1}` }))
}

// Tóm tắt hậu kiểm từ mẫu cố định (chế độ mock). Chỉ dùng danh sách phát hiện đã có.
export function postcheckSummaryTemplate(findings: Finding[]): string {
  if (findings.length === 0) return 'Hậu kiểm không ghi nhận phát hiện nào theo quy tắc BR-17.'
  const count = (sev: string) => findings.filter(x => x.severity === sev).length
  const checks = [...new Set(findings.map(x => x.check))].join(', ')
  return `Hậu kiểm ghi nhận ${findings.length} phát hiện theo quy tắc (Nghiêm trọng: ${count('critical')}, Trung bình: ${count('medium')}, Thấp: ${count('low')}). Loại kiểm tra: ${checks}.`
}

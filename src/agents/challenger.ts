// Agent Phản biện (M4): kiểm tra theo quy tắc trước (origin = rule), sau đó kiểm tra nội dung (origin = llm).
import type { Finding, ImpactLine, ViewBody } from '../shared/types'
import { coverageErrors, lineErrors, lineKey, validateFindings, articleRefExists, type ViewContext } from '../shared/schemas'

export type RawFinding = Omit<Finding, 'finding_id' | 'stage' | 'origin'>

// FR-402: thiếu dòng bắt buộc, mã nguồn không tồn tại, dấu mức độ mâu thuẫn với hướng, dòng trùng
export function ruleChecks(view: ViewBody, ctx: ViewContext, onlyKeys?: Set<string>): RawFinding[] {
  const out: RawFinding[] = []
  for (const l of view.impacts) {
    if (onlyKeys && !onlyKeys.has(lineKey(l))) continue
    for (const e of lineErrors(l, ctx)) {
      const check = ['sign_mismatch', 'source_exists'].includes(e.check) ? e.check : 'schema'
      out.push({ check, severity: check === 'schema' ? 'medium' : 'critical', target: lineKey(l), issue: `${e.msg} (dòng ${lineKey(l)})`, suggestion: 'Sửa dòng cho đúng schema Mục 7.3 và quy tắc nguồn BR-15 trước khi duyệt' })
    }
  }
  if (!onlyKeys) for (const e of coverageErrors(view.impacts)) out.push({ check: e.check, severity: e.check === 'missing_line' ? 'critical' : 'medium', target: e.target, issue: `${e.msg}; nhận định phải phủ đủ 11 loại tài sản và 3 cặp tiền`, suggestion: 'Bổ sung hoặc gộp dòng để mỗi đối tượng chỉ có đúng một dòng' })
  return out
}

// FR-1005: với sự kiện chính sách, mọi trích dẫn điều khoản có trong văn bản và độ chắc chắn khớp loại văn bản
export function citationChecks(changes: { change_id: string; article_refs: string[]; certainty: string }[], docText: string, docKind: string): RawFinding[] {
  const out: RawFinding[] = []
  for (const c of changes) {
    for (const ref of c.article_refs) if (!articleRefExists(ref, docText)) out.push({ check: 'citation_check', severity: 'critical', target: c.change_id, issue: `Trích dẫn "${ref}" không có trong văn bản chính sách`, suggestion: 'Sửa trích dẫn theo đúng điều, khoản của văn bản hoặc bỏ thay đổi này' })
    if (c.certainty !== docKind) out.push({ check: 'citation_check', severity: 'critical', target: c.change_id, issue: `Độ chắc chắn ${c.certainty} không khớp loại văn bản ${docKind}`, suggestion: 'Đặt độ chắc chắn draft cho dự thảo và final cho văn bản đã ban hành' })
  }
  return out
}

// Chuẩn hóa phát hiện của agent: đúng schema, nguồn thuộc sự kiện, tối đa 3 phát hiện Nghiêm trọng (FR-403)
export function normalizeLlmFindings(raw: unknown[], newsIds: Set<string>): { findings: RawFinding[]; dropped: string[] } {
  const dropped: string[] = []
  let critical = 0
  const out: RawFinding[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const candidate = { finding_id: 'x', stage: 'pre_approval', origin: 'llm', ...r, source_ids: ((r.source_ids as string[]) ?? []).filter(s => { const ok = newsIds.has(s); if (!ok) dropped.push(`nguồn ${s} không thuộc sự kiện`); return ok }) }
    const v = validateFindings([candidate])
    if (!v.ok) { dropped.push(...v.errors); continue }
    const f = v.findings[0]
    let severity = f.severity
    if (severity === 'critical' && ++critical > 3) { severity = 'medium'; dropped.push('Hạ mức phát hiện Nghiêm trọng thứ tư trở đi (tối đa 3)') }
    out.push({ check: f.check, severity, target: f.target, issue: f.issue, suggestion: f.suggestion, ...(f.source_ids?.length ? { source_ids: f.source_ids } : {}) })
  }
  return { findings: out, dropped }
}

export function diffLines(before: ImpactLine[], after: ImpactLine[]): { key: string; kind: 'added' | 'removed' | 'changed' | 'rationale'; before?: ImpactLine; after?: ImpactLine }[] {
  const b = new Map(before.map(l => [lineKey(l), l])), a = new Map(after.map(l => [lineKey(l), l]))
  const out: ReturnType<typeof diffLines> = []
  for (const [k, l] of a) {
    const p = b.get(k)
    if (!p) out.push({ key: k, kind: 'added', after: l })
    else if (p.level !== l.level || p.direction !== l.direction) out.push({ key: k, kind: 'changed', before: p, after: l })
    else if (p.rationale !== l.rationale || p.horizon !== l.horizon || p.confidence !== l.confidence || (p.source_ids ?? []).join() !== (l.source_ids ?? []).join() || p.cio_note !== l.cio_note) out.push({ key: k, kind: 'rationale', before: p, after: l })
  }
  for (const [k, l] of b) if (!a.has(k)) out.push({ key: k, kind: 'removed', before: l })
  return out
}

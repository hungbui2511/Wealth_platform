// Agent Phản biện (M4): kiểm tra theo quy tắc trước (origin = rule), sau đó kiểm tra nội dung (origin = llm).
import type { Finding, ImpactLine, ViewBody } from '../shared/types'
import { coverageErrors, lineErrors, lineKey, validateFindings, articleRefExists, type ViewContext } from '../shared/schemas'
import { branchIssues, levelScenarioConflicts } from '../engine/consistency'
import type { FactorModel, ScenarioSet } from '../engine/scenario'
import { rootDomain, sourceTier } from '../news/sources'

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

// Kiểm tra theo quy tắc trên nhánh kịch bản (nguồn của mọi con số tới gia đình) và đối chiếu dấu với mức −3..+3.
// onlyKeys: khi phản biện lại, chỉ xét dòng đã đổi; khóa "scenarios" nghĩa là CIO đã sửa nhánh kịch bản.
export function scenarioRuleChecks(view: ViewBody, model: FactorModel | null, onlyKeys?: Set<string>): RawFinding[] {
  if (!view.scenarios || !model) return []
  const set = view.scenarios as unknown as ScenarioSet
  const out: RawFinding[] = []
  const all = !onlyKeys || onlyKeys.has('scenarios')
  try {
    for (const c of levelScenarioConflicts(view.impacts, model, set)) {
      if (!all && !onlyKeys!.has(c.line_key)) continue
      out.push({ check: 'scenario_consistency', severity: Math.abs(c.level) >= 2 ? 'critical' : 'medium', target: c.line_key, issue: `Dòng ${c.key} ghi mức ${c.level} nhưng nhánh kịch bản kỳ vọng đẩy theo hướng ngược lại (${c.move > 0 ? '+' : ''}${c.move}${c.unit === 'bp' ? ' điểm cơ bản' : '%'} với vị thế đại diện). Con số tới gia đình lấy từ kịch bản, bản tin lấy hướng từ kịch bản`, suggestion: 'Sửa mức của dòng cho cùng hướng với kịch bản, hoặc sửa nhánh kịch bản (xác suất, cú sốc lõi) nếu mức mới là nhận định đúng' })
    }
    if (all) for (const b of branchIssues(model, set)) out.push({ check: b.check, severity: b.severity, target: b.target, issue: b.issue, suggestion: b.suggestion })
  } catch (e) {
    out.push({ check: 'schema', severity: 'medium', target: 'scenarios', issue: `Không tính được kịch bản để đối chiếu: ${String((e as Error).message ?? e).slice(0, 200)}`, suggestion: 'Kiểm tra lại yếu tố lõi và cỡ cú sốc của các nhánh' })
  }
  return out
}

// Đổi chiều so với nhận định gần đây (đánh giá độc lập 21/10: cổ phiếu VN +1/−1/+1 trong ba ngày): dòng loại tài sản đổi dấu so với
// nhận định gần nhất trong 7 ngày (đã duyệt hoặc đang chờ duyệt) mà lý do không nêu vì sao đổi thì nêu phát hiện mức Trung bình.
const FLIP_WORDS = ['so với', 'đảo chiều', 'đổi chiều', 'đổi hướng', 'ngược với', 'thay đổi so', 'trước đó', 'hôm trước', 'nhận định trước']
export function flipChecks(view: ViewBody, prior: { view_id: string; created_at: string; impacts: { scope: string; target: string; level: number }[] }[], onlyKeys?: Set<string>): RawFinding[] {
  const out: RawFinding[] = []
  for (const l of view.impacts) {
    if (l.scope !== 'asset_class' || l.level === 0) continue
    const key = `asset_class:${l.asset_class ?? l.target}:${l.target}`
    if (onlyKeys && !onlyKeys.has(key)) continue
    const p = prior.map(v => ({ v, line: v.impacts.find(x => x.scope === 'asset_class' && x.target === l.target) })).find(x => x.line && x.line.level !== 0)
    if (!p || Math.sign(p.line!.level) === Math.sign(l.level)) continue
    const text = (l.rationale ?? '').normalize('NFC').toLowerCase()
    if (FLIP_WORDS.some(w => text.includes(w))) continue
    out.push({ check: 'inconsistency_with_past_view', severity: 'medium', target: key, issue: `Mức ${l.level > 0 ? '+' : ''}${l.level} ngược chiều với ${p.line!.level > 0 ? '+' : ''}${p.line!.level} ở ${p.v.view_id} (${p.v.created_at.slice(0, 10)}) mà lý do không giải thích vì sao đổi`, suggestion: 'Nêu rõ diễn biến mới nào làm đổi chiều so với nhận định trước, hoặc giữ mức 0 nếu chưa đủ căn cứ' })
  }
  return out
}

// Quy tắc hai nguồn (đợt 3): dòng có mức từ ±2 phải có ít nhất một nguồn chính thức (T1) hoặc hai nguồn độc lập (khác miền gốc).
// Nguồn trang tra cứu thứ cấp (T4) không tính. Tin nghiên cứu độc quyền không có đường dẫn công khai thì bỏ qua quy tắc này.
export function sourceRuleChecks(view: ViewBody, news: { id: string; url?: string; origin?: string }[], onlyKeys?: Set<string>): RawFinding[] {
  const byId = new Map(news.map(n => [n.id, n]))
  const out: RawFinding[] = []
  for (const l of view.impacts) {
    if (Math.abs(l.level) < 2 || (onlyKeys && !onlyKeys.has(lineKey(l)))) continue
    const srcs = (l.source_ids ?? []).map(id => byId.get(id)).filter((n): n is NonNullable<typeof n> => !!n)
    if (srcs.some(n => n.origin === 'exclusive' || !n.url)) continue
    const tiers = srcs.map(n => sourceTier(n.url!))
    if (tiers.includes('T1')) continue
    const roots = new Set(srcs.filter(n => sourceTier(n.url!) !== 'T4').map(n => rootDomain(n.url!)))
    if (roots.size >= 2) continue
    out.push({ check: 'source_support', severity: 'medium', target: lineKey(l), issue: `Dòng mức ${l.level} chỉ dựa trên ${roots.size || 0} nguồn độc lập (${[...new Set(tiers)].join(', ') || 'không có nguồn'}), không có nguồn chính thức`, suggestion: 'Bổ sung nguồn thứ hai khác miền hoặc nguồn chính thức, hoặc hạ mức xuống ±1' })
  }
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

// Chuẩn hóa phát hiện của agent: đúng schema, nguồn thuộc sự kiện. Không tự hạ mức phát hiện Nghiêm trọng:
// mọi phát hiện Nghiêm trọng đều phải được CIO phản hồi trước khi duyệt (trước đây hạ từ cái thứ tư, đã bỏ theo phản biện độc lập).
export function normalizeLlmFindings(raw: unknown[], newsIds: Set<string>): { findings: RawFinding[]; dropped: string[] } {
  const dropped: string[] = []
  const out: RawFinding[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const candidate = { finding_id: 'x', stage: 'pre_approval', origin: 'llm', ...r, source_ids: ((r.source_ids as string[]) ?? []).filter(s => { const ok = newsIds.has(s); if (!ok) dropped.push(`nguồn ${s} không thuộc sự kiện`); return ok }) }
    const v = validateFindings([candidate])
    if (!v.ok) { dropped.push(...v.errors); continue }
    const f = v.findings[0]
    const severity = f.severity
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

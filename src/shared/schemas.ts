// Schema đầu ra của agent (Mục 7.3), kiểm tra bằng zod (tương đương Pydantic).
import { z } from 'zod'
import { ASSET_CLASSES, FX_CURRENCIES, POLICY_TOPICS, SECTORS } from './catalog'
import type { Finding, ImpactLine, Instrument, PolicyChange, ViewBody } from './types'

export const ImpactLineSchema = z.object({
  scope: z.enum(['asset_class', 'sector', 'instrument', 'fx']),
  asset_class: z.enum(ASSET_CLASSES).optional(),
  target: z.string().min(1),
  level: z.number().int().min(-3).max(3),
  direction: z.enum(['positive', 'negative', 'neutral', 'insufficient_evidence']),
  horizon: z.enum(['<1 tháng', '1-3 tháng', '3-6 tháng', '>6 tháng']).optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  rationale: z.string().min(20, 'Lập luận tối thiểu 20 ký tự'),
  source_ids: z.array(z.string()),
  cio_judgment: z.boolean().optional(),
  cio_note: z.string().optional(),
})

export const ViewBodySchema = z.object({
  event_id: z.string(), view_id: z.string(), event_type: z.string(), summary: z.string().min(1),
  impacts: z.array(ImpactLineSchema),
})

export const FindingSchema = z.object({
  finding_id: z.string(),
  stage: z.enum(['pre_approval', 're_challenge', 'post_check']),
  origin: z.enum(['rule', 'llm']),
  check: z.enum(['schema', 'source_exists', 'missing_line', 'sign_mismatch', 'duplicate_line', 'restricted_instrument',
    'source_support', 'opposite_direction', 'overconfidence', 'inconsistency_with_past_view', 'second_order_effect', 'citation_check',
    'missing_price', 'non_positive_net_worth', 'stale_valuation', 'outlier_family', 'concentration', 'price_fallback']),
  severity: z.enum(['critical', 'medium', 'low']),
  target: z.string().min(1),
  issue: z.string().min(20),
  suggestion: z.string().min(20),
  source_ids: z.array(z.string()).optional(),
})

export const PolicyChangeSchema = z.object({
  change_id: z.string().min(1),
  article_refs: z.array(z.string().min(1)).min(1),
  quote: z.string().min(1).max(400),
  summary: z.string().min(1).max(300),
  topics: z.array(z.enum(POLICY_TOPICS)).min(1),
  affected_parties: z.string().min(1),
  effective_from: z.string().optional(),
  certainty: z.enum(['draft', 'final']),
})
export const PolicySummarySchema = z.object({ changes: z.array(PolicyChangeSchema).min(1) })

export const lineKey = (l: Pick<ImpactLine, 'scope' | 'asset_class' | 'target'>) => `${l.scope}:${l.asset_class ?? ''}:${l.target}`

export interface ViewContext { newsIds: Set<string>; instruments: Record<string, Instrument>; restricted: Set<string> }

// Lỗi theo từng dòng (dùng cho cả kiểm tra schema và kiểm tra theo quy tắc của phản biện)
export function lineErrors(l: ImpactLine, ctx: ViewContext): { check: string; msg: string }[] {
  const e: { check: string; msg: string }[] = []
  const expected = l.level > 0 ? ['positive'] : l.level < 0 ? ['negative'] : ['neutral', 'insufficient_evidence']
  if (!expected.includes(l.direction)) e.push({ check: 'sign_mismatch', msg: `Hướng ${l.direction} mâu thuẫn với mức ${l.level}` })
  if (l.level !== 0 && (!l.horizon || !l.confidence)) e.push({ check: 'schema', msg: 'Thiếu khung thời gian hoặc độ tin cậy khi mức khác 0' })
  if (l.level !== 0 && l.source_ids.length === 0 && !l.cio_judgment) e.push({ check: 'source_exists', msg: 'Dòng có mức khác 0 phải có ít nhất một mã nguồn (BR-15)' })
  for (const sid of l.source_ids) if (!ctx.newsIds.has(sid)) e.push({ check: 'source_exists', msg: `Mã nguồn ${sid} không thuộc sự kiện` })
  if (l.cio_judgment && !(l.cio_note && l.cio_note.length >= 1)) e.push({ check: 'schema', msg: 'Dòng nhận định của CIO phải có ghi chú' })
  if (l.scope === 'asset_class') {
    if (l.asset_class !== l.target || !ASSET_CLASSES.includes(l.target as never)) e.push({ check: 'schema', msg: 'Dòng loại tài sản phải có asset_class trùng target' })
  } else if (l.scope === 'sector') {
    if (!l.asset_class) e.push({ check: 'schema', msg: 'Dòng ngành phải ghi loại tài sản' })
    if (!SECTORS.includes(l.target as never)) e.push({ check: 'schema', msg: `Ngành ${l.target} không có trong danh mục` })
  } else if (l.scope === 'instrument') {
    const inst = ctx.instruments[l.target]
    if (!inst) e.push({ check: 'schema', msg: `Mã công cụ ${l.target} không có trong hệ thống` })
    else if (l.asset_class !== inst.asset_class) e.push({ check: 'schema', msg: `Loại tài sản của dòng mã ${l.target} phải là ${inst.asset_class}` })
  } else if (l.scope === 'fx') {
    if (!FX_CURRENCIES.includes(l.target as never)) e.push({ check: 'schema', msg: `Cặp tiền ${l.target} không hợp lệ` })
  }
  return e
}

export function coverageErrors(impacts: ImpactLine[]): { check: string; msg: string; target: string }[] {
  const e: { check: string; msg: string; target: string }[] = []
  for (const ac of ASSET_CLASSES) {
    const n = impacts.filter(l => l.scope === 'asset_class' && l.target === ac).length
    if (n === 0) e.push({ check: 'missing_line', msg: `Thiếu dòng loại tài sản ${ac}`, target: ac })
  }
  for (const c of FX_CURRENCIES) {
    if (!impacts.some(l => l.scope === 'fx' && l.target === c)) e.push({ check: 'missing_line', msg: `Thiếu dòng tỷ giá ${c}`, target: c })
  }
  const seen = new Map<string, number>()
  for (const l of impacts) seen.set(lineKey(l), (seen.get(lineKey(l)) ?? 0) + 1)
  for (const [k, n] of seen) if (n > 1) e.push({ check: 'duplicate_line', msg: `Dòng trùng ${k}`, target: k })
  return e
}

export interface ValidationResult { ok: boolean; errors: string[]; view?: ViewBody; removed_restricted: ImpactLine[] }

// Kiểm tra schema Mục 7.3 và loại dòng mã hạn chế (BR-27 (2))
export function validateView(raw: unknown, ctx: ViewContext): ValidationResult {
  const parsed = ViewBodySchema.safeParse(raw)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`), removed_restricted: [] }
  const view = parsed.data as ViewBody
  const removed = view.impacts.filter(l => l.scope === 'instrument' && ctx.restricted.has(l.target))
  view.impacts = view.impacts.filter(l => !(l.scope === 'instrument' && ctx.restricted.has(l.target)))
  const errors: string[] = []
  view.impacts.forEach((l, i) => lineErrors(l, ctx).forEach(x => errors.push(`impacts[${i}] ${lineKey(l)}: ${x.msg}`)))
  coverageErrors(view.impacts).forEach(x => errors.push(x.msg))
  const acLines = view.impacts.filter(l => l.scope === 'asset_class').length
  const fxLines = view.impacts.filter(l => l.scope === 'fx').length
  if (acLines !== 11) errors.push(`Phải có đúng 11 dòng loại tài sản, có ${acLines}`)
  if (fxLines !== 3) errors.push(`Phải có đúng 3 dòng tỷ giá, có ${fxLines}`)
  return { ok: errors.length === 0, errors, view, removed_restricted: removed }
}

export function validateFindings(raw: unknown[]): { ok: boolean; errors: string[]; findings: Finding[] } {
  const errors: string[] = []
  const out: Finding[] = []
  raw.forEach((f, i) => {
    const r = FindingSchema.safeParse(f)
    if (r.success) out.push(r.data as Finding)
    else errors.push(`findings[${i}]: ${r.error.issues.map(x => `${x.path.join('.')} ${x.message}`).join('; ')}`)
  })
  return { ok: errors.length === 0, errors, findings: out }
}

// Trích dẫn điều, khoản phải có trong văn bản (FR-1005)
export function articleRefExists(ref: string, text: string): boolean {
  const norm = (x: string) => x.normalize('NFC').toLowerCase().replace(/\s+/g, ' ')
  const t = norm(text)
  const m = ref.match(/Điều\s+(\d+)(?:\s+khoản\s+(\d+))?/i)
  if (!m) return t.includes(norm(ref))
  const art = new RegExp(`điều ${m[1]}\\b`)
  if (!art.test(t)) return false
  if (!m[2]) return true
  // Khoản nằm trong phần của điều đó
  const start = t.search(art)
  const rest = t.slice(start + 5)
  const next = rest.search(/điều \d+\b/)
  const section = next >= 0 ? rest.slice(0, next) : rest
  return new RegExp(`(^|\\s|\\n)${m[2]}\\.\\s`).test(section) || section.includes(`khoản ${m[2]}`)
}

export function validatePolicySummary(raw: unknown, docText: string, docKind: 'draft' | 'final'): { ok: boolean; errors: string[]; changes: PolicyChange[] } {
  const r = PolicySummarySchema.safeParse(raw)
  if (!r.success) return { ok: false, errors: r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`), changes: [] }
  const errors: string[] = []
  const ids = new Set<string>()
  for (const c of r.data.changes) {
    if (ids.has(c.change_id)) errors.push(`change_id trùng ${c.change_id}`)
    ids.add(c.change_id)
    for (const ref of c.article_refs) if (!articleRefExists(ref, docText)) errors.push(`${c.change_id}: trích dẫn "${ref}" không có trong văn bản`)
    if (c.certainty !== docKind) errors.push(`${c.change_id}: độ chắc chắn ${c.certainty} không khớp loại văn bản ${docKind}`)
  }
  return { ok: errors.length === 0, errors, changes: r.data.changes as PolicyChange[] }
}

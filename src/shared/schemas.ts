// Schema đầu ra của agent (Mục 7.3), kiểm tra bằng zod (tương đương Pydantic).
import { z } from 'zod'
import { ASSET_CLASSES, FX_CURRENCIES, POLICY_TOPICS, SECTORS } from './catalog'
import type { Finding, ImpactLine, Instrument, PolicyChange, PolicyClaim, PolicyPrivateBrief, ScenarioSetBody, ViewBody } from './types'
import { DEFAULT_FACTOR_MODEL } from '../data/factorModel'
export const DEFAULT_FACTOR_IDS: readonly string[] = DEFAULT_FACTOR_MODEL.factors.map(f => f.id)

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
  scenarios: z.unknown().optional(),
})

export const FindingSchema = z.object({
  finding_id: z.string(),
  stage: z.enum(['pre_approval', 're_challenge', 'post_check']),
  origin: z.enum(['rule', 'llm']),
  check: z.enum(['schema', 'source_exists', 'missing_line', 'sign_mismatch', 'duplicate_line', 'restricted_instrument',
    'source_support', 'opposite_direction', 'overconfidence', 'inconsistency_with_past_view', 'second_order_effect', 'citation_check',
    'missing_price', 'non_positive_net_worth', 'stale_valuation', 'outlier_family', 'concentration', 'price_fallback', 'price_external_ai']),
  severity: z.enum(['critical', 'medium', 'low']),
  target: z.string().min(1),
  issue: z.string().min(20),
  suggestion: z.string().min(20),
  source_ids: z.array(z.string()).optional(),
})

const CONFIDENCE = ['high', 'medium', 'low'] as const
export const PolicyClaimSchema = z.object({
  text: z.string().min(20, 'Nhận định tối thiểu 20 ký tự').max(900),
  basis: z.enum(['evidence', 'inference']),
  confidence: z.enum(CONFIDENCE),
  reasoning: z.string().optional(),
  evidence: z.object({ article_ref: z.string().optional(), quote: z.string().max(400).optional() }).optional(),
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
  before: z.string().min(5, 'before: nêu quy định trước đây hoặc "Chưa có quy định tương ứng"'),
  materiality: z.enum(['high', 'medium', 'low']),
  analysis: z.object({
    why: PolicyClaimSchema, goal: PolicyClaimSchema, next_signal: PolicyClaimSchema, private_impact: PolicyClaimSchema,
    second_order: PolicyClaimSchema.optional(), opportunity: PolicyClaimSchema.optional(),
  }),
})
export const PolicyPrivateBriefSchema = z.object({
  headline: z.string().min(60, 'headline tối thiểu 60 ký tự').max(700),
  key_findings: z.array(PolicyClaimSchema.extend({ title: z.string().min(5).max(120), change_ids: z.array(z.string().min(1)).min(1) })).min(1).max(5),
  segments: z.array(z.object({ segment: z.string().min(5), why: z.string().min(20), change_ids: z.array(z.string().min(1)).min(1) })).min(1).max(6),
  milestones: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date dạng YYYY-MM-DD'), label: z.string().min(5), article_ref: z.string().optional() })),
  open_questions: z.array(z.object({ issue: z.string().min(10), reading_1: z.string().min(10), reading_2: z.string().min(10), consequence: z.string().min(10) })).max(6),
  advisor_message: z.string().min(40).max(800),
})
export const PolicySummarySchema = z.object({ changes: z.array(PolicyChangeSchema).min(1), private_brief: PolicyPrivateBriefSchema })

export const lineKey = (l: Pick<ImpactLine, 'scope' | 'asset_class' | 'target'>) => `${l.scope}:${l.asset_class ?? ''}:${l.target}`

export interface ViewContext { newsIds: Set<string>; instruments: Record<string, Instrument>; restricted: Set<string>; factorIds?: readonly string[] }

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
  if (view.scenarios === undefined || view.scenarios === null) delete view.scenarios
  else {
    const sc = validateScenarios(view.scenarios, ctx.factorIds ?? DEFAULT_FACTOR_IDS, ctx.newsIds)
    errors.push(...sc.errors)
    if (sc.set) view.scenarios = sc.set as ScenarioSetBody
  }
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

// Trích nguyên văn: so sau khi chuẩn hoá khoảng trắng và dấu ngoặc kép, giữ nguyên chữ hoa thường
export function quoteInText(quote: string, text: string): boolean {
  const norm = (x: string) => x.normalize('NFC').replace(/[“”„«»]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
  const q = norm(quote).replace(/^["']|["']$/g, '').replace(/\s*(\.\.\.|…)\s*$/, '').trim()
  return q.length > 0 && norm(text).includes(q)
}

// Cụm từ ngoài phạm vi: kế hoạch hành động giao việc (thuộc ngân hàng quyết định) và lời khẳng định chắc chắn về tương lai
export const POLICY_OUT_OF_SCOPE = ['chủ trì', 'đơn vị đầu mối', 'giao cho khối', 'giao cho phòng', 'chắc chắn sẽ', 'không định lượng được']

export interface PolicySummaryResult { ok: boolean; errors: string[]; changes: PolicyChange[]; brief?: PolicyPrivateBrief }

export function validatePolicySummary(raw: unknown, docText: string, docKind: 'draft' | 'final', banned: readonly string[] = []): PolicySummaryResult {
  const r = PolicySummarySchema.safeParse(raw)
  if (!r.success) return { ok: false, errors: r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`), changes: [] }
  const errors: string[] = []
  const ids = new Set<string>()
  const claim = (where: string, c: PolicyClaim, forecast = false) => {
    if (c.basis === 'evidence') {
      const ev = c.evidence
      if (!ev || (!ev.article_ref && !ev.quote)) errors.push(`${where}: nhận định "căn cứ" phải dẫn điều khoản hoặc trích nguyên văn`)
      if (ev?.article_ref && !articleRefExists(ev.article_ref, docText)) errors.push(`${where}: điều khoản "${ev.article_ref}" không có trong văn bản`)
      if (ev?.quote && ev.quote.replace(/[\s"'“”.…]/g, '').length < 15) errors.push(`${where}: câu trích làm căn cứ quá ngắn (tối thiểu 15 ký tự)`)
      else if (ev?.quote && !quoteInText(ev.quote, docText)) errors.push(`${where}: câu trích không khớp nguyên văn văn bản`)
    } else {
      if (!c.reasoning || c.reasoning.trim().length < 30) errors.push(`${where}: nhận định "suy luận" phải nêu lập luận (tối thiểu 30 ký tự)`)
      if (forecast && c.confidence === 'high') errors.push(`${where}: dự báo bước tiếp theo là suy luận thì không thể có độ tin cậy cao`)
    }
  }
  for (const c of r.data.changes) {
    if (ids.has(c.change_id)) errors.push(`change_id trùng ${c.change_id}`)
    ids.add(c.change_id)
    for (const ref of c.article_refs) if (!articleRefExists(ref, docText)) errors.push(`${c.change_id}: trích dẫn "${ref}" không có trong văn bản`)
    if (!quoteInText(c.quote, docText)) errors.push(`${c.change_id}: quote không khớp nguyên văn văn bản`)
    if (c.certainty !== docKind) errors.push(`${c.change_id}: độ chắc chắn ${c.certainty} không khớp loại văn bản ${docKind}`)
    const a = c.analysis
    claim(`${c.change_id}.why`, a.why); claim(`${c.change_id}.goal`, a.goal); claim(`${c.change_id}.next_signal`, a.next_signal, true)
    claim(`${c.change_id}.private_impact`, a.private_impact)
    if (a.second_order) claim(`${c.change_id}.second_order`, a.second_order, true)
    if (a.opportunity) claim(`${c.change_id}.opportunity`, a.opportunity)
  }
  const b = r.data.private_brief
  b.key_findings.forEach((k, i) => {
    claim(`private_brief.key_findings[${i}]`, k)
    for (const id of k.change_ids) if (!ids.has(id)) errors.push(`private_brief.key_findings[${i}]: không có thay đổi ${id}`)
  })
  b.segments.forEach((g, i) => { for (const id of g.change_ids) if (!ids.has(id)) errors.push(`private_brief.segments[${i}]: không có thay đổi ${id}`) })
  b.milestones.forEach((m, i) => {
    if (Number.isNaN(Date.parse(m.date))) errors.push(`private_brief.milestones[${i}]: ngày không hợp lệ`)
    if (m.article_ref && !articleRefExists(m.article_ref, docText)) errors.push(`private_brief.milestones[${i}]: điều khoản "${m.article_ref}" không có trong văn bản`)
  })
  const covered = new Set(b.key_findings.flatMap(k => k.change_ids))
  for (const c of r.data.changes) if (c.materiality === 'high' && !covered.has(c.change_id)) errors.push(`${c.change_id}: thay đổi trọng yếu cao phải có trong phát hiện chính của private_brief`)
  // Quét cụm từ cấm trên toàn bộ chữ do agent viết (trừ câu trích nguyên văn)
  const strip = (x: unknown): unknown => Array.isArray(x) ? x.map(strip) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'quote').map(([k, v]) => [k, strip(v)])) : x
  const nfc = (x: string) => x.normalize('NFC').toLowerCase()
  const written = nfc(JSON.stringify(strip(r.data)))
  for (const p of [...banned, ...POLICY_OUT_OF_SCOPE]) if (written.includes(nfc(p))) errors.push(`Có cụm từ ngoài phạm vi hoặc bị cấm: "${p}"`)
  return { ok: errors.length === 0, errors, changes: r.data.changes as PolicyChange[], brief: r.data.private_brief as PolicyPrivateBrief }
}

// Nhánh kịch bản do agent đề xuất (thiết kế v2): 2–4 nhánh có xác suất, mỗi nhánh 1–5 yếu tố lõi với cỡ cú sốc trong thư viện CIO
export const CoreShockSchema = z.object({ factor: z.string().min(1), size: z.enum(['S', 'M', 'L']), direction: z.enum(['up', 'down']) })
export const BranchSchema = z.object({
  id: z.string().min(1), name: z.string().min(3), probability: z.number().min(0.05).max(0.95),
  regime: z.enum(['calm', 'stress']), core_shocks: z.array(CoreShockSchema).min(1).max(5),
  rationale: z.string().min(20, 'Lập luận tối thiểu 20 ký tự'), source_ids: z.array(z.string()).min(1, 'Mỗi nhánh phải trích ít nhất một tin'),
})
export const ScenarioSetSchema = z.object({ priced_in: z.enum(['none', 'partial', 'full']), branches: z.array(BranchSchema).min(2).max(4), notes: z.string().optional() })

export function validateScenarios(raw: unknown, factorIds: readonly string[], newsIds: Set<string>): { ok: boolean; errors: string[]; set?: z.infer<typeof ScenarioSetSchema> } {
  const r = ScenarioSetSchema.safeParse(raw)
  if (!r.success) return { ok: false, errors: r.error.issues.map(i => `scenarios.${i.path.join('.')}: ${i.message}`) }
  const errors: string[] = []
  const sum = r.data.branches.reduce((a, b) => a + b.probability, 0)
  if (Math.abs(sum - 1) > 0.011) errors.push(`Tổng xác suất các nhánh phải bằng 1 (đang là ${sum.toFixed(2)})`)
  const bids = new Set<string>()
  r.data.branches.forEach((b, i) => {
    if (bids.has(b.id)) errors.push(`scenarios.branches[${i}]: mã nhánh ${b.id} bị trùng`)
    bids.add(b.id)
    const fs = new Set<string>()
    for (const s of b.core_shocks) {
      if (!factorIds.includes(s.factor)) errors.push(`scenarios.branches[${i}]: yếu tố ${s.factor} không có trong mô hình yếu tố`)
      if (fs.has(s.factor)) errors.push(`scenarios.branches[${i}]: yếu tố ${s.factor} lặp lại`)
      fs.add(s.factor)
    }
    for (const sid of b.source_ids) if (!newsIds.has(sid)) errors.push(`scenarios.branches[${i}]: mã nguồn ${sid} không thuộc sự kiện`)
  })
  return { ok: errors.length === 0, errors, set: r.data }
}

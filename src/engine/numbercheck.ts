// BR-13: không có số lạ trong diễn giải. BR-14: không dùng ngôn ngữ khuyến nghị mua bán.
import { ASSET_CLASS_LABELS } from '../shared/catalog'
import { fmtPct, fmtVndShort } from '../shared/format'
import type { ViewBody } from '../shared/types'
import type { FamilyImpactResult } from './apply'

export interface AllowedNumbers { money: number[]; pct: number[]; plain: number[] }
export interface ExtractedNumber { raw: string; value: number; kind: 'money' | 'pct' | 'plain'; signed: boolean }
export interface CheckResult { ok: boolean; violations: { text: string; reason: string }[]; numbers: ExtractedNumber[] }

const MONEY_UNITS: Record<string, number> = { 'nghìn tỷ': 1e12, 'tỷ': 1e9, 'triệu': 1e6, 'nghìn': 1e3, 'đồng': 1, 'vnd': 1 }

// Loại bỏ các số được bỏ qua: khung thời gian, thế hệ, ngày tháng, năm, mã định danh, số thứ tự đầu dòng
export function stripIgnored(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\b[A-Za-z]{1,6}(?:-[A-Za-z0-9]+)+\b/g, ' ')            // DEMO-F07, EV-2026-0002, NW-0004, VW-0002-v1
    .replace(/\bDM[A-Z]{3}\b/g, ' ')                                  // mã công cụ hư cấu
    .replace(/[<>]\s?\d+\s*tháng/g, ' ')                              // <1 tháng, >6 tháng
    .replace(/\d+\s*[-–]\s*\d+\s*tháng/g, ' ')                        // 1-3 tháng
    .replace(/thế hệ(?: thứ)?\s*\d+/gi, ' ')
    .replace(/(Mục|Điều|khoản|điểm|bước|phiên bản|vòng)\s+\d+(?:\.\d+)*/gi, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g, ' ')                     // ngày
    .replace(/\b\d{1,2}\/\d{4}\b/g, ' ')                              // tháng/năm
    .replace(/(tháng|quý|ngày)\s+\d{1,2}\b/gi, ' ')
    .replace(/năm\s+(19|20)\d{2}\b/gi, ' ')
    .replace(/\b(19|20)\d{2}\b(?!\s*(%|tỷ|triệu|nghìn|đồng|VND))/g, ' ')
    .replace(/^\s*\d+[.)]\s/gm, ' ')                                 // số thứ tự đầu dòng
}

export function extractNumbers(text: string): ExtractedNumber[] {
  const t = stripIgnored(text)
  const re = /([−-]\s?)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s*(%|điểm phần trăm|điểm %|điểm|nghìn tỷ|tỷ|triệu|nghìn|đồng|VND)?/gi
  const out: ExtractedNumber[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    if (!m[2]) continue
    const before = t.slice(Math.max(0, m.index - 24), m.index)
    // Bỏ qua chữ số dính liền chữ cái (mã định danh còn sót)
    if (/[A-Za-zÀ-ỹ]$/.test(before)) continue
    let v = Number(m[2].replace(/\./g, '') + (m[3] ? '.' + m[3] : ''))
    const unit = (m[4] ?? '').toLowerCase()
    let kind: ExtractedNumber['kind'] = 'plain'
    if (unit === '%' || unit.startsWith('điểm')) kind = 'pct'
    else if (unit in MONEY_UNITS) { kind = 'money'; v *= MONEY_UNITS[unit] }
    else if (v >= 1000) kind = 'money'
    const lastNum = before.search(/\d[^\d]*$/)
    const window = lastNum >= 0 ? before.slice(lastNum + 1) : before
    let signed = false
    if (m[1]) { v = -v; signed = true }
    else if (/giảm|lỗ|âm/i.test(window)) { v = -v; signed = true }
    else if (/tăng|lãi|dương/i.test(window)) signed = true
    out.push({ raw: m[0].trim(), value: v, kind, signed })
  }
  return out
}

function matches(n: ExtractedNumber, allowed: AllowedNumbers): boolean {
  const cmp = (a: number, tol: (a: number) => number) => {
    const t = tol(a)
    if (n.signed) return Math.abs(n.value - a) <= t
    return Math.abs(Math.abs(n.value) - Math.abs(a)) <= t
  }
  if (n.kind === 'money') return allowed.money.some(a => cmp(a, a => Math.max(Math.abs(a) * 0.005, 1e6)))
  if (n.kind === 'pct') return allowed.pct.some(a => cmp(a, () => 0.01 + 1e-9))
  return allowed.plain.some(a => cmp(a, () => 1e-9)) || allowed.pct.some(a => cmp(a, () => 1e-9))
}

export function allowedFromResult(r: FamilyImpactResult, view: ViewBody): AllowedNumbers {
  const money = new Set<number>(), pct = new Set<number>(), plain = new Set<number>()
  const addM = (v?: string | null) => { if (v !== undefined && v !== null) money.add(Number(v)) }
  const addP = (frac?: string | null) => { if (frac !== undefined && frac !== null) pct.add(Number(frac) * 100) }
  addM(r.impact); addM(r.net_worth); addM(r.illiquid_impact); addP(r.pct)
  Object.values(r.by_asset_class).forEach(addM); Object.values(r.by_fx).forEach(addM); Object.values(r.by_instrument).forEach(addM)
  r.top_instruments.forEach(t => addM(t.impact))
  const sc = (r as { scenario?: { ranges: { bad: number; base: number; good: number; severe?: number; bad_pct: number | null; base_pct: number | null }[] } }).scenario
  for (const x of sc?.ranges ?? []) { addM(String(x.bad)); addM(String(x.base)); addM(String(x.good)); if (x.severe !== undefined) addM(String(x.severe)); addP(x.bad_pct === null ? null : String(x.bad_pct)); addP(x.base_pct === null ? null : String(x.base_pct)) }
  for (const p of r.positions) {
    addM(p.value_vnd); addM(p.exposure); addM(p.impact); addM(p.asset_impact); addM(p.fx_impact)
    addP(p.asset_shock); addP(p.fx_shock); addP(p.u); addP(p.u_fx); addP(p.eff_own)
  }
  for (const l of view.impacts) plain.add(Math.abs(l.level)), plain.add(l.level)
  plain.add(r.top_instruments.length); plain.add(r.positions.length)
  // Số xuất hiện trong chính nhận định đã duyệt (tóm tắt, lập luận)
  for (const n of extractNumbers([view.summary, ...view.impacts.map(l => l.rationale)].join('\n'))) {
    (n.kind === 'money' ? money : n.kind === 'pct' ? pct : plain).add(n.value)
  }
  return { money: [...money], pct: [...pct], plain: [...plain] }
}

export function checkText(text: string, allowed: AllowedNumbers, banned: string[]): CheckResult {
  const numbers = extractNumbers(text)
  const violations: CheckResult['violations'] = []
  for (const n of numbers) if (!matches(n, allowed)) violations.push({ text: n.raw, reason: 'Số không có trong kết quả M6 hoặc nhận định đã duyệt (BR-13)' })
  const lower = text.normalize('NFC').toLowerCase()
  for (const b of banned) if (lower.includes(b.normalize('NFC').toLowerCase())) violations.push({ text: b, reason: 'Cụm từ khuyến nghị mua bán bị cấm (BR-14)' })
  return { ok: violations.length === 0, violations, numbers }
}

// Đoạn mẫu xác định sinh từ số liệu M6 (dùng khi bản LLM bị chặn)
export function templateInterpretation(familyName: string, r: FamilyImpactResult, view: ViewBody, restricted: Set<string> = new Set()): string {
  const dir = Number(r.impact) < 0 ? 'giảm' : 'tăng'
  const parts = [
    `Theo nhận định đã duyệt "${view.summary}", danh mục của ${familyName} ước tính ${dir} ${fmtVndShort(String(Math.abs(Number(r.impact))))} đồng, tương đương ${r.pct === null ? 'không xác định' : fmtPct(String(Math.abs(Number(r.pct))))} tài sản ròng.`,
  ]
  const classes = Object.entries(r.by_asset_class).filter(([, v]) => Number(v) !== 0).sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1])))
  if (classes.length) parts.push('Đóng góp theo loại tài sản: ' + classes.map(([k, v]) => `${ASSET_CLASS_LABELS[k as keyof typeof ASSET_CLASS_LABELS]} ${fmtVndShort(v)}`).join('; ') + '.')
  const fx = Object.entries(r.by_fx).filter(([, v]) => Number(v) !== 0)
  if (fx.length) parts.push('Yếu tố tỷ giá: ' + fx.map(([k, v]) => `${k} ${fmtVndShort(v)}`).join('; ') + '.')
  const top = r.top_instruments.filter(t => !restricted.has(t.instrument_id))
  if (top.length) parts.push('Các công cụ đóng góp lớn nhất: ' + top.map(t => `${t.name} ${fmtVndShort(t.impact)}`).join('; ') + '.')
  if (Number(r.illiquid_impact) !== 0) parts.push(`Phần tác động lên tài sản kém thanh khoản là ước tính trên giấy: ${fmtVndShort(r.illiquid_impact)}.`)
  const sc = (r as { scenario?: { ranges: { horizon: string; bad: number; good: number }[] } }).scenario
  if (sc?.ranges?.[1]) parts.push(`Kỳ hạn ${sc.ranges[1].horizon}: mốc P10 (xấu) ${fmtVndShort(String(sc.ranges[1].bad))}, mốc P90 (tốt) ${fmtVndShort(String(sc.ranges[1].good))}; con số chính ở trên là mức kỳ vọng theo xác suất các nhánh.`)
  parts.push(sc ? 'Đây là dải ước tính theo các nhánh kịch bản CIO đã duyệt và mô hình yếu tố, không phải dự báo và không phải khuyến nghị.' : 'Đây là cú sốc giá tức thời giả định theo cấu hình minh họa, không phải dự báo và không phải khuyến nghị.')
  return parts.join(' ')
}

// Cấu trúc gia đình liên thế hệ (đợt 4 sau phản biện độc lập). Xác định, không gọi LLM.
// (1) Kiểm tra đòn bẩy và gọi ký quỹ khi tài sản bảo đảm giảm theo giai đoạn căng thẳng lịch sử
// (2) Thang thanh khoản khi căng thẳng: tài sản bán được theo từng mốc thời gian so với nghĩa vụ chi
// (3) Kế thừa: ước tính thuế và vấn đề cấu trúc khi xảy ra sự kiện gia đình, theo bảng quy tắc có phiên bản
import type { AssetClass } from '../shared/catalog'
import type { Family, Instrument } from '../shared/types'
import { schedule } from './cashflow'
import { D, Decimal, ZERO, sum, vnd, monthIndex } from './dec'
import { MAX_OWNERSHIP_DEPTH, accountEffOwn, fxRate, liabilityExposure, type PriceBook, type Position } from './positions'
import { conditionalShocks, positionLoadings, DEFAULT_CREDIT_JUMP, type FactorModel } from './scenario'

// ---------- Căng thẳng theo giai đoạn lịch sử ----------
export interface AnalogStress {
  analog_id: string; label: string
  shocks: Record<string, number>
  by_position: Map<string, number> // holding_id|part → VND thay đổi (theo phần gia đình sở hữu)
  by_holding_pct: Map<string, number> // holding_id → % thay đổi giá trị cả vị thế
  total: number; pct: number | null
  note: string
}

// Áp biến động thực tế của một giai đoạn (yếu tố đã biết) và kỳ vọng có điều kiện cho yếu tố còn lại, chế độ căng thẳng.
// Trái phiếu DN bất động sản thêm tổn thất vỡ nợ theo xác suất 12 tháng của mô hình.
export function analogStress(positions: Position[], instruments: Record<string, Instrument>, model: FactorModel, book: PriceBook, analogId: string, netWorth: number): AnalogStress | null {
  const a = (model.analogs as { id: string; label?: string; moves?: Record<string, number> }[] | undefined)?.find(x => x.id === analogId)
  if (!a?.moves) return null
  const known = Object.fromEntries(Object.entries(a.moves).filter(([k]) => model.factors.some(f => f.id === k)))
  const shocks = conditionalShocks(model, 'stress', known)
  const cj = (model.credit_jump ?? DEFAULT_CREDIT_JUMP).CREDIT_RE
  const byPos = new Map<string, number>(), hv = new Map<string, { v: number; d: number }>()
  let total = 0
  for (const p of positions) {
    const r = positionLoadings(p, instruments[p.instrument_id], model, 'stress', book.price_date)
    let d = Object.entries(r.loadings).reduce((acc, [k, x]) => acc + x * (shocks[k] ?? 0), 0)
    const credit = model.credit_factor[p.instrument_id] ?? model.credit_factor[p.sector ?? ''] ?? model.credit_factor.DEFAULT
    if (p.asset_class === 'CORP_BOND' && p.part === null && credit === 'CREDIT_RE' && cj) d -= r.exposure * cj.lgd * (cj.q[cj.q.length - 1] ?? 0)
    // Không để giảm quá giá trị vị thế
    d = Math.max(d, -r.exposure)
    byPos.set(`${p.holding_id}|${p.part ?? ''}`, d)
    total += d
    const cur = hv.get(p.holding_id) ?? { v: 0, d: 0 }
    hv.set(p.holding_id, { v: cur.v + p.exposure.toNumber(), d: cur.d + d })
  }
  const pctBy = new Map([...hv].map(([k, x]) => [k, x.v > 0 ? x.d / x.v : 0]))
  return {
    analog_id: a.id, label: a.label ?? a.id, shocks, by_position: byPos, by_holding_pct: pctBy, total: Math.round(total), pct: netWorth > 0 ? total / netWorth : null,
    note: `Biến động thực tế giai đoạn ${a.label ?? a.id} cho ${Object.keys(known).join(', ')}; yếu tố còn lại suy ra theo tương quan chế độ căng thẳng. Không phải mức tệ nhất có thể xảy ra.`,
  }
}

// Chọn giai đoạn gây tổn thất lớn nhất cho gia đình làm kịch bản căng thẳng chuẩn
export function worstAnalog(positions: Position[], instruments: Record<string, Instrument>, model: FactorModel, book: PriceBook, netWorth: number): AnalogStress | null {
  const ids = ((model.analogs ?? []) as { id: string }[]).map(a => a.id)
  const all = ids.map(id => analogStress(positions, instruments, model, book, id, netWorth)).filter((x): x is AnalogStress => !!x)
  return all.sort((a, b) => a.total - b.total)[0] ?? null
}

// ---------- (1) Đòn bẩy và gọi ký quỹ ----------
export interface LeverageRow {
  liability_id: string; name: string; balance_vnd: string
  collateral_vnd: string | null; ltv_now: number | null; ltv_stress: number | null
  ltv_max: number | null; margin_call_ltv: number | null
  status: 'OK' | 'MARGIN_CALL_NOW' | 'MARGIN_CALL_STRESS' | 'ABOVE_MAX' | 'NOT_LINKED'
  top_up_vnd: string | null; message: string
}

export function leverageCheck(f: Family, positions: Position[], book: PriceBook, stress: AnalogStress | null): LeverageRow[] {
  return f.liabilities.map(l => {
    const bal = D(l.balance).times(fxRate(book, l.currency))
    const base = { liability_id: l.id, name: l.name, balance_vnd: vnd(bal), ltv_max: l.ltv_max ? Number(l.ltv_max) : null, margin_call_ltv: l.margin_call_ltv ? Number(l.margin_call_ltv) : null }
    const ids = l.collateral_holdings ?? []
    if (!ids.length) return { ...base, collateral_vnd: null, ltv_now: null, ltv_stress: null, status: 'NOT_LINKED' as const, top_up_vnd: null, message: l.collateral ? `Tài sản bảo đảm "${l.collateral}" chưa gắn với vị thế cụ thể nên chưa kiểm tra được tỷ lệ cho vay` : 'Khoản vay tín chấp hoặc chưa ghi tài sản bảo đảm' }
    // Giá trị toàn bộ vị thế bảo đảm (không nhân tỷ lệ gia đình sở hữu: ngân hàng nhận cầm cố cả vị thế)
    const coll = sum(positions.filter(p => ids.includes(p.holding_id)).map(p => p.value_vnd))
    const pctDrop = ids.length && stress ? sum(ids.map(id => { const hp = positions.filter(p => p.holding_id === id); const v = sum(hp.map(p => p.value_vnd)); return v.times(stress.by_holding_pct.get(id) ?? 0) })) : ZERO
    const collStress = coll.plus(pctDrop)
    const ltvNow = coll.gt(0) ? bal.div(coll).toNumber() : null
    const ltvStress = collStress.gt(0) ? bal.div(collStress).toNumber() : null
    const mc = base.margin_call_ltv, mx = base.ltv_max
    let status: LeverageRow['status'] = 'OK', topUp: Decimal | null = null, message = 'Trong ngưỡng kể cả khi căng thẳng'
    // Số tiền phải nộp thêm để đưa tỷ lệ về mức tối đa cho phép: dư nợ − ltv_max × tài sản bảo đảm
    const need = (c: Decimal) => mx ? Decimal.max(ZERO, bal.minus(c.times(mx))) : null
    if (mc !== null && ltvNow !== null && ltvNow >= mc) { status = 'MARGIN_CALL_NOW'; topUp = need(coll); message = `Tỷ lệ cho vay hiện tại ${(ltvNow * 100).toFixed(1)}% đã chạm ngưỡng gọi ký quỹ ${(mc * 100).toFixed(0)}%` }
    else if (mc !== null && (ltvStress === null || ltvStress >= mc)) { status = 'MARGIN_CALL_STRESS'; topUp = need(collStress); message = `Nếu lặp lại ${stress?.label ?? 'giai đoạn căng thẳng'}, tỷ lệ cho vay lên ${ltvStress === null ? 'không xác định' : (ltvStress * 100).toFixed(1) + '%'}, vượt ngưỡng gọi ký quỹ ${(mc * 100).toFixed(0)}%` }
    else if (mx !== null && ltvNow !== null && ltvNow > mx) { status = 'ABOVE_MAX'; topUp = need(coll); message = `Tỷ lệ cho vay hiện tại ${(ltvNow * 100).toFixed(1)}% vượt mức tối đa ${(mx * 100).toFixed(0)}%` }
    else if (mc === null) message = 'Chưa nhập ngưỡng gọi ký quỹ nên chỉ hiển thị tỷ lệ cho vay'
    return { ...base, collateral_vnd: vnd(coll), ltv_now: ltvNow, ltv_stress: ltvStress, status, top_up_vnd: topUp ? vnd(topUp) : null, message }
  })
}

// ---------- (2) Thang thanh khoản khi căng thẳng ----------
export const LADDER_BUCKETS = [
  { id: 'd7', label: 'Trong 7 ngày', months: 0.25 },
  { id: 'm1', label: 'Trong 1 tháng', months: 1 },
  { id: 'm3', label: 'Trong 3 tháng', months: 3 },
  { id: 'm12', label: 'Trong 12 tháng', months: 12 },
] as const
type BucketId = (typeof LADDER_BUCKETS)[number]['id'] | 'gt12'

// Giả định minh hoạ chờ CIO hiệu chỉnh: thời gian bán được khi thị trường căng thẳng và chiết khấu bán gấp (ngoài biến động giá)
export const LIQUIDATION: Record<AssetClass, { bucket: BucketId; haircut: number; note: string }> = {
  CASH: { bucket: 'd7', haircut: 0, note: 'Tiền gửi có kỳ hạn rút trước hạn mất phần lãi' },
  GOV_BOND: { bucket: 'd7', haircut: 0.01, note: 'Thị trường thứ cấp mỏng, chiết khấu nhỏ' },
  EQ_VN: { bucket: 'm1', haircut: 0.05, note: 'Bán khối lượng lớn khi thị trường giảm sàn nhiều phiên' },
  EQ_INTL: { bucket: 'd7', haircut: 0.01, note: 'Thanh khoản tốt, cần thời gian chuyển ngoại tệ' },
  FUND: { bucket: 'm1', haircut: 0.02, note: 'Quỹ mở giao dịch theo kỳ, có thể giãn kỳ khi rút ồ ạt' },
  GOLD: { bucket: 'd7', haircut: 0.03, note: 'Chênh lệch mua bán vàng miếng nới rộng khi biến động' },
  CRYPTO: { bucket: 'd7', haircut: 0.05, note: 'Biến động mạnh, rủi ro sàn' },
  CORP_BOND: { bucket: 'm12', haircut: 0.15, note: 'Năm 2022 nhiều trái phiếu DN mất thanh khoản, nhà phát hành giãn mua lại' },
  INSURANCE: { bucket: 'm3', haircut: 0.2, note: 'Huỷ hợp đồng trước hạn mất phí huỷ và quyền lợi' },
  REAL_ESTATE: { bucket: 'gt12', haircut: 0.15, note: 'Bán gấp bất động sản khi thị trường đóng băng' },
  PRIVATE_EQ: { bucket: 'gt12', haircut: 0.3, note: 'Cần người mua, thường kèm điều khoản hạn chế chuyển nhượng' },
}

export interface LadderRow { id: string; label: string; assets: string; outflow: string; gap: string; coverage: number | null; status: 'OK' | 'YELLOW' | 'RED' }
export interface LadderResult {
  stress_label: string | null
  rows: LadderRow[]
  illiquid_after_12m: string
  outflows: { label: string; k: number; amount: string; kind: 'cashflow' | 'capital_call' | 'margin_call' }[]
  assumptions: string[]
}

export function liquidityLadder(f: Family, instruments: Record<string, Instrument>, book: PriceBook, positions: Position[], inflation: string, stress: AnalogStress | null, leverage: LeverageRow[]): LadderResult {
  const avail: Record<BucketId, Decimal> = { d7: ZERO, m1: ZERO, m3: ZERO, m12: ZERO, gt12: ZERO }
  const pledged = new Set(f.liabilities.flatMap(l => l.collateral_holdings ?? []))
  for (const p of positions) {
    // Chứng chỉ quỹ bán theo quỹ, không theo tài sản bên trong
    const cls: AssetClass = p.part !== null ? 'FUND' : p.asset_class
    const rule = LIQUIDATION[cls]
    // Tài sản đang cầm cố không bán tự do được
    if (pledged.has(p.holding_id)) { avail.gt12 = avail.gt12.plus(p.exposure); continue }
    const move = stress?.by_position.get(`${p.holding_id}|${p.part ?? ''}`) ?? 0
    const v = Decimal.max(ZERO, p.exposure.plus(move)).times(1 - rule.haircut)
    let b = rule.bucket
    // Trái phiếu DN niêm yết vẫn khó bán khi căng thẳng; không niêm yết thì để quá 12 tháng
    if (p.asset_class === 'CORP_BOND' && !p.listed && p.part === null) b = 'gt12'
    avail[b] = avail[b].plus(v)
  }
  // Nghĩa vụ chi: dòng tiền ra theo hợp đồng và kế hoạch; dòng vào chỉ tính phần chắc chắn (không phải dự kiến)
  const lines = schedule(f, instruments, book, 12, inflation)
  const out: LadderResult['outflows'] = []
  const netByMonth = new Map<number, Decimal>()
  for (const l of lines) {
    if (l.conversion) continue
    if (l.direction === 'in' && l.expected) continue
    const sign = l.direction === 'out' ? 1 : -1
    netByMonth.set(l.k, (netByMonth.get(l.k) ?? ZERO).plus(l.amount.times(sign)))
    if (l.direction === 'out' && l.once) out.push({ label: l.label, k: l.k, amount: vnd(l.amount), kind: 'cashflow' })
  }
  // Gọi vốn cam kết còn lại của quỹ tư nhân
  const base = monthIndex(book.price_date)
  for (const h of f.holdings) {
    if (!h.commitment) continue
    const eff = accountEffOwn(f, h.account_id), fx = fxRate(book, h.commitment.currency)
    const remaining = Decimal.max(ZERO, D(h.commitment.total).minus(D(h.commitment.called)))
    const sched = h.commitment.schedule?.length ? h.commitment.schedule : [{ date: book.price_date, amount: remaining.toString() }]
    for (const c of sched) {
      const k = Math.max(1, monthIndex(c.date) - base)
      if (k > 12) continue
      const amt = D(c.amount).times(fx).times(eff)
      netByMonth.set(k, (netByMonth.get(k) ?? ZERO).plus(amt))
      out.push({ label: `Gọi vốn cam kết ${instruments[h.instrument_id]?.name ?? h.instrument_id}`, k, amount: vnd(amt), kind: 'capital_call' })
    }
  }
  // Nộp thêm ký quỹ khi căng thẳng: coi như phát sinh ngay trong tháng đầu
  for (const r of leverage) if (r.top_up_vnd && (r.status === 'MARGIN_CALL_NOW' || r.status === 'MARGIN_CALL_STRESS')) {
    const liab = liabilityExposure(f, book).find(x => x.id === r.liability_id)
    const amt = D(r.top_up_vnd).times(liab?.eff ?? 1)
    netByMonth.set(0, (netByMonth.get(0) ?? ZERO).plus(amt))
    out.push({ label: `Nộp thêm ký quỹ ${r.name}`, k: 0, amount: vnd(amt), kind: 'margin_call' })
  }
  const rows: LadderRow[] = []
  let cumA = ZERO
  for (const b of LADDER_BUCKETS) {
    cumA = cumA.plus(avail[b.id])
    const need = sum([...netByMonth].filter(([k]) => k <= Math.max(0, Math.floor(b.months))).map(([, v]) => v))
    const outflow = Decimal.max(ZERO, need)
    const gap = cumA.minus(outflow)
    const cov = outflow.gt(0) ? cumA.div(outflow).toNumber() : null
    const status: LadderRow['status'] = gap.isNegative() ? (b.months <= 3 ? 'RED' : 'YELLOW') : cov !== null && cov < 1.2 ? 'YELLOW' : 'OK'
    rows.push({ id: b.id, label: b.label, assets: vnd(cumA), outflow: vnd(outflow), gap: vnd(gap), coverage: cov, status })
  }
  return {
    stress_label: stress?.label ?? null, rows, illiquid_after_12m: vnd(avail.gt12), outflows: out.sort((a, b) => a.k - b.k),
    assumptions: [
      stress ? `Giá tài sản theo giai đoạn ${stress.label}` : 'Không có giai đoạn căng thẳng trong mô hình: dùng giá hiện tại',
      'Chiết khấu bán gấp và thời gian bán theo bảng giả định minh hoạ (chờ CIO hiệu chỉnh)',
      'Dòng tiền vào dự kiến (chưa chắc chắn) không được tính; tài sản đang cầm cố không bán tự do',
    ],
  }
}

// ---------- (3) Kế thừa ----------
export interface SuccessionRules {
  version: string
  sources: string[]
  legal_confirmed: boolean
  inheritance_tax: { rate: number; threshold_vnd: number; taxable_classes: AssetClass[]; entity_shares_taxable: boolean; exempt_classes_close_relatives: AssetClass[] }
  marital_common_share: number
  intestate_first_tier: string[]
  notes: string[]
}

export const DEFAULT_SUCCESSION_RULES: SuccessionRules = {
  version: '2026-10-20',
  sources: [
    'Luật Thuế thu nhập cá nhân số 109/2025/QH15 (hiệu lực 01/07/2026): Điều 3 khoản 9 (thu nhập từ nhận thừa kế, quà tặng là chứng khoán, phần vốn, bất động sản, tài sản phải đăng ký), Điều 4 khoản 1 (miễn thuế bất động sản giữa vợ chồng, cha mẹ và con, ông bà và cháu, anh chị em ruột), Điều 18 (10% trên phần vượt 20 triệu đồng mỗi lần nhận), Điều 26 (cá nhân không cư trú 10%)',
    'Luật Hôn nhân và gia đình 2014: Điều 33 (tài sản chung vợ chồng), Điều 59 (chia tài sản khi ly hôn), Điều 66 (tài sản chung khi một bên chết)',
    'Bộ luật Dân sự 2015: Điều 651 (hàng thừa kế thứ nhất)',
  ],
  legal_confirmed: false,
  inheritance_tax: {
    rate: 0.1, threshold_vnd: 20_000_000,
    taxable_classes: ['EQ_VN', 'EQ_INTL', 'FUND', 'GOV_BOND', 'CORP_BOND', 'PRIVATE_EQ', 'REAL_ESTATE'],
    entity_shares_taxable: true,
    exempt_classes_close_relatives: ['REAL_ESTATE'],
  },
  marital_common_share: 0.5,
  intestate_first_tier: ['spouse', 'parent', 'child'],
  notes: [
    'Tiền gửi, vàng, tài sản mã hoá, bảo hiểm không thuộc nhóm phải nộp thuế thừa kế theo Điều 3 khoản 9 (trừ tài sản phải đăng ký quyền sở hữu)',
    'Bất động sản nắm qua pháp nhân được chuyển dưới dạng phần vốn nên không hưởng miễn thuế bất động sản giữa người thân',
    'Bảo hiểm có người thụ hưởng chỉ định không đi qua di sản',
    'Thành viên cư trú thuế ở nước khác có thể chịu thuế thừa kế, quà tặng nước sở tại: cần tư vấn thuế nước ngoài',
  ],
}

export function successionRulesErrors(r: SuccessionRules): string[] {
  const e: string[] = []
  const t = r?.inheritance_tax
  if (!t || typeof t.rate !== 'number' || t.rate < 0 || t.rate > 1) e.push('inheritance_tax.rate phải trong khoảng 0–1')
  if (!t || typeof t.threshold_vnd !== 'number' || t.threshold_vnd < 0) e.push('inheritance_tax.threshold_vnd phải là số không âm')
  if (!Array.isArray(t?.taxable_classes)) e.push('inheritance_tax.taxable_classes phải là danh sách loại tài sản')
  if (!Array.isArray(t?.exempt_classes_close_relatives)) e.push('inheritance_tax.exempt_classes_close_relatives phải là danh sách')
  if (typeof r?.marital_common_share !== 'number' || r.marital_common_share < 0 || r.marital_common_share > 1) e.push('marital_common_share phải trong khoảng 0–1')
  if (!Array.isArray(r?.sources) || !r.sources.length) e.push('cần ít nhất một căn cứ pháp lý trong sources')
  if (typeof r?.legal_confirmed !== 'boolean') e.push('legal_confirmed phải là true hoặc false')
  return e
}

// Phần một thành viên sở hữu (trực tiếp hoặc qua pháp nhân nhiều tầng) trong một pháp nhân
export function memberEntityShare(f: Family, entityId: string, memberId: string, seen: ReadonlySet<string> = new Set(), depth = 0): Decimal {
  if (seen.has(entityId) || depth > MAX_OWNERSHIP_DEPTH) return ZERO
  const next = new Set(seen); next.add(entityId)
  return sum(f.ownerships.filter(o => o.entity_id === entityId).map(o => o.owner_entity_id
    ? D(o.pct).times(memberEntityShare(f, o.owner_entity_id, memberId, next, depth + 1))
    : o.member_id === memberId ? D(o.pct) : ZERO))
}

// Tỷ giá: từ bảng giá nếu có, nếu không lấy từ vị thế cùng loại tiền; không tìm được thì trả null (bỏ qua, không đoán)
function fxOf(ccy: string, positions: Position[], book?: PriceBook): Decimal | null {
  if (ccy === 'VND') return D(1)
  if (book?.fx[ccy]) return D(book.fx[ccy])
  return positions.find(p => p.currency === ccy)?.fx_rate ?? null
}

export interface MemberAssets { member_id: string; direct: Record<string, Decimal>; via_entity: Decimal; total: Decimal; frozen_sole: Decimal; beneficiary_out: Decimal; liquid: Decimal }

// Tài sản quy cho một thành viên: phần trực tiếp theo loại tài sản và phần vốn qua pháp nhân
export function memberAssets(f: Family, positions: Position[], memberId: string, book?: PriceBook): MemberAssets {
  const direct: Record<string, Decimal> = {}
  let via = ZERO, frozen = ZERO, benef = ZERO, liquid = ZERO
  for (const p of positions) {
    const acc = f.accounts.find(a => a.id === p.account_id)
    if (!acc) continue
    const h = f.holdings.find(x => x.id === p.holding_id)
    for (const o of acc.owners) {
      if (o.kind === 'member' && o.id === memberId) {
        const v = p.value_vnd.times(D(o.pct))
        // Có người thụ hưởng chỉ định: không vào di sản
        if (h?.beneficiaries?.length) { benef = benef.plus(v); continue }
        // Chứng chỉ quỹ là chứng khoán: xếp theo quỹ, không theo tài sản bên trong
        const cls: AssetClass = p.part !== null ? 'FUND' : p.asset_class
        direct[cls] = (direct[cls] ?? ZERO).plus(v)
        if (acc.owners.length === 1) frozen = frozen.plus(v)
        if (LIQUIDATION[cls].bucket !== 'gt12' && LIQUIDATION[cls].bucket !== 'm12') liquid = liquid.plus(v)
      } else if (o.kind === 'entity') {
        via = via.plus(p.value_vnd.times(D(o.pct)).times(memberEntityShare(f, o.id, memberId)))
      }
    }
  }
  // Phần vốn tính trên tài sản ròng của pháp nhân: trừ nợ do pháp nhân đứng tên vay theo tỷ lệ thành viên sở hữu
  for (const l of f.liabilities) {
    if (l.borrower.kind !== 'entity') continue
    const fx = fxOf(l.currency, positions, book)
    if (fx) via = via.minus(D(l.balance).times(fx).times(memberEntityShare(f, l.borrower.id, memberId)))
  }
  via = Decimal.max(ZERO, via)
  const total = sum(Object.values(direct)).plus(via)
  return { member_id: memberId, direct, via_entity: via, total, frozen_sole: frozen, beneficiary_out: benef, liquid }
}

export interface SuccessionHeir { member_id: string; name: string; relation: string; share: number; receives: string; taxable: string; tax: string; non_resident: boolean }
export interface SuccessionEvent {
  event: 'g1_death' | 'g2_emigration' | 'divorce'
  member_id: string; member_name: string
  title: string
  estate: string | null
  heirs: SuccessionHeir[]
  tax_total: string
  liquid_for_tax: string | null
  findings: { level: 'RED' | 'YELLOW' | 'INFO'; text: string }[]
  basis: string[]
}
export interface SuccessionResult { rules_version: string; legal_confirmed: boolean; events: SuccessionEvent[]; data_gaps: string[]; notes: string[] }

const isNonResident = (m: { tax_residency?: string }) => !!m.tax_residency && m.tax_residency !== 'VN'

export function succession(f: Family, positions: Position[], book: PriceBook, rules: SuccessionRules): SuccessionResult {
  const t = rules.inheritance_tax
  const name = (id: string) => f.members.find(m => m.id === id)?.name ?? id
  const gaps: string[] = []
  if (f.members.some(m => m.has_will === undefined)) gaps.push('Chưa ghi nhận thành viên nào đã lập di chúc')
  if (f.members.some(m => m.marital_status === undefined)) gaps.push('Thiếu tình trạng hôn nhân của một số thành viên')
  if (f.members.some(m => m.tax_residency === undefined)) gaps.push('Thiếu nơi cư trú thuế của một số thành viên')
  if (f.members.filter(m => m.generation > 1).some(m => !m.parent_ids?.length)) gaps.push('Thiếu quan hệ cha mẹ – con giữa các thế hệ: người thừa kế được suy theo thế hệ')
  const liab = liabilityExposure(f, book)
  const debtOf = (mid: string) => sum(liab.filter(l => f.liabilities.find(x => x.id === l.id)?.borrower.kind === 'member' && f.liabilities.find(x => x.id === l.id)?.borrower.id === mid).map(l => l.balance_vnd))
  const events: SuccessionEvent[] = []

  // Tính thuế một người nhận: theo loại tài sản; bất động sản trực tiếp được miễn giữa người thân gần; phần vốn qua pháp nhân chịu thuế
  const taxFor = (gross: Record<string, Decimal>, viaEntity: Decimal, close: boolean) => {
    let taxable = ZERO
    for (const [cls, v] of Object.entries(gross)) {
      if (!t.taxable_classes.includes(cls as AssetClass)) continue
      if (close && t.exempt_classes_close_relatives.includes(cls as AssetClass)) continue
      taxable = taxable.plus(v)
    }
    if (t.entity_shares_taxable) taxable = taxable.plus(viaEntity)
    const tax = Decimal.max(ZERO, taxable.minus(t.threshold_vnd)).times(t.rate)
    return { taxable, tax }
  }

  // Sự kiện 1: thành viên thế hệ 1 qua đời
  for (const m of f.members.filter(x => x.generation === 1)) {
    const a = memberAssets(f, positions, m.id, book)
    if (a.total.lte(0)) continue
    const findings: SuccessionEvent['findings'] = []
    const spouse = m.spouse_id ? f.members.find(x => x.id === m.spouse_id) : undefined
    // Tài sản chung vợ chồng: một nửa thuộc người còn sống, không phải di sản
    const share = spouse && m.marital_status !== 'divorced' ? 1 - rules.marital_common_share : 1
    const debt = debtOf(m.id)
    const estateScale = (x: Decimal) => x.times(share)
    const estateGross = estateScale(a.total)
    const estate = Decimal.max(ZERO, estateGross.minus(debt.times(share)))
    // Người thừa kế theo pháp luật (hàng thứ nhất): vợ/chồng, cha mẹ, con. Thiếu quan hệ thì suy theo thế hệ
    const children = f.members.filter(x => x.parent_ids?.includes(m.id)).length ? f.members.filter(x => x.parent_ids?.includes(m.id)) : f.members.filter(x => x.generation === 2)
    const parents = f.members.filter(x => m.parent_ids?.includes(x.id))
    const heirs = [...(spouse ? [{ m: spouse, rel: 'Vợ/chồng' }] : []), ...parents.map(x => ({ m: x, rel: 'Cha/mẹ' })), ...children.map(x => ({ m: x, rel: 'Con' }))]
    if (m.has_will) findings.push({ level: 'INFO', text: 'Đã có di chúc: phân chia theo di chúc, bảng dưới chỉ minh hoạ chia theo pháp luật' })
    else findings.push({ level: 'YELLOW', text: `${m.has_will === false ? 'Không có' : 'Chưa ghi nhận'} di chúc: di sản chia đều cho hàng thừa kế thứ nhất theo Điều 651 Bộ luật Dân sự` })
    const n = heirs.length || 1
    const heirRows: SuccessionHeir[] = heirs.map(h => {
      const ratio = estate.gt(0) && estateGross.gt(0) ? estate.div(estateGross) : ZERO
      const gross: Record<string, Decimal> = Object.fromEntries(Object.entries(a.direct).map(([k, v]) => [k, estateScale(v).times(ratio).div(n)]))
      const via = estateScale(a.via_entity).times(ratio).div(n)
      const { taxable, tax } = taxFor(gross, via, true)
      return { member_id: h.m.id, name: h.m.name, relation: h.rel, share: 1 / n, receives: vnd(estate.div(n)), taxable: vnd(taxable), tax: vnd(tax), non_resident: isNonResident(h.m) }
    })
    const taxTotal = sum(heirRows.map(r => D(r.tax)))
    const liquid = estateScale(a.liquid)
    if (taxTotal.gt(0) && liquid.lt(taxTotal)) findings.push({ level: 'RED', text: `Thuế ước tính ${vnd(taxTotal)} đồng lớn hơn tài sản thanh khoản trong di sản ${vnd(liquid)} đồng: người thừa kế có thể phải bán tài sản hoặc vay để nộp thuế` })
    if (a.via_entity.gt(0)) findings.push({ level: 'YELLOW', text: `${vnd(estateScale(a.via_entity))} đồng tài sản nắm qua pháp nhân được chuyển dưới dạng phần vốn: chịu thuế 10% kể cả khi bên trong là bất động sản` })
    const offshore = f.entities.filter(e => e.jurisdiction && e.jurisdiction !== 'VN' && memberEntityShare(f, e.id, m.id).gt(0))
    if (offshore.length) findings.push({ level: 'YELLOW', text: `Nắm phần vốn qua pháp nhân nước ngoài (${offshore.map(e => `${e.name}, ${e.jurisdiction}`).join('; ')}): thủ tục thừa kế cổ phần theo luật nơi thành lập, cần tư vấn pháp lý nước ngoài` })
    if (a.frozen_sole.gt(0)) findings.push({ level: 'YELLOW', text: `${vnd(a.frozen_sole)} đồng ở tài khoản đứng tên riêng: cần thủ tục khai nhận di sản trước khi giao dịch` })
    if (a.beneficiary_out.gt(0)) findings.push({ level: 'INFO', text: `${vnd(a.beneficiary_out)} đồng có người thụ hưởng chỉ định, chuyển ngoài di sản` })
    if (heirRows.some(r => r.non_resident)) findings.push({ level: 'YELLOW', text: 'Có người thừa kế cư trú thuế ở nước ngoài: chịu 10% theo Điều 26 và có thể chịu thuế nước sở tại' })
    if (debt.gt(0)) findings.push({ level: 'INFO', text: `Đã trừ phần nợ ${vnd(debt.times(share))} đồng do thành viên này đứng tên vay` })
    events.push({ event: 'g1_death', member_id: m.id, member_name: m.name, title: `${m.name} qua đời`, estate: vnd(estate), heirs: heirRows, tax_total: vnd(taxTotal), liquid_for_tax: vnd(liquid), findings, basis: rules.sources })
  }

  // Sự kiện 2: thành viên thế hệ 2 chuyển cư trú thuế ra nước ngoài
  for (const m of f.members.filter(x => x.generation === 2)) {
    const findings: SuccessionEvent['findings'] = []
    const a = memberAssets(f, positions, m.id, book)
    const already = isNonResident(m)
    findings.push({ level: 'YELLOW', text: `${already ? 'Đang' : 'Nếu'} cư trú thuế ngoài Việt Nam: khoản thừa kế, quà tặng nhận từ Việt Nam vẫn chịu 10% (Điều 26) và có thể chịu thuế nước sở tại` })
    if ((m.nationality ?? []).length > 1) findings.push({ level: 'YELLOW', text: `Nhiều quốc tịch (${m.nationality!.join(', ')}): có thể phát sinh nghĩa vụ khai báo tài sản ở nước khác` })
    if (a.via_entity.gt(0)) findings.push({ level: 'INFO', text: `${vnd(a.via_entity)} đồng phần vốn qua pháp nhân: cần rà điều lệ về chuyển nhượng cho người không cư trú` })
    const expected = f.members.filter(x => x.generation === 1).map(g1 => memberAssets(f, positions, g1.id, book).total).reduce((x, y) => x.plus(y), ZERO).div(Math.max(1, f.members.filter(x => x.generation === 2).length))
    events.push({ event: 'g2_emigration', member_id: m.id, member_name: m.name, title: `${m.name} chuyển cư trú ra nước ngoài`, estate: vnd(expected), heirs: [], tax_total: '0', liquid_for_tax: null, findings, basis: [rules.sources[0]] })
  }

  // Sự kiện 3: ly hôn của thành viên đã kết hôn có tài sản đáng kể
  for (const m of f.members.filter(x => x.marital_status === 'married')) {
    const a = memberAssets(f, positions, m.id, book)
    if (a.total.lte(0)) continue
    const findings: SuccessionEvent['findings'] = []
    const spouseIn = m.spouse_id && f.members.some(x => x.id === m.spouse_id)
    const atStake = a.total.times(rules.marital_common_share)
    findings.push({ level: spouseIn ? 'INFO' : 'YELLOW', text: `Tài sản tạo lập trong hôn nhân được coi là tài sản chung (Điều 33), chia theo Điều 59: tối đa ${vnd(atStake)} đồng có thể chuyển cho ${spouseIn ? 'vợ/chồng trong gia đình' : 'vợ/chồng ngoài phạm vi gia đình quản lý'}` })
    if (a.via_entity.gt(0)) findings.push({ level: 'YELLOW', text: `Phần vốn qua pháp nhân ${vnd(a.via_entity)} đồng có thể bị chia: kiểm tra quyền kiểm soát pháp nhân sau khi chia` })
    events.push({ event: 'divorce', member_id: m.id, member_name: m.name, title: `${m.name} ly hôn`, estate: vnd(atStake), heirs: [], tax_total: '0', liquid_for_tax: null, findings, basis: [rules.sources[1]] })
  }
  return { rules_version: rules.version, legal_confirmed: rules.legal_confirmed, events, data_gaps: gaps, notes: rules.notes }
}

// Cơ sở chịu thuế thừa kế của cả gia đình (dùng cho khớp chính sách): chứng khoán, phần vốn, bất động sản (không tính phần được miễn giữa người thân)
export function inheritanceTaxableBase(f: Family, positions: Position[], rules: SuccessionRules): Decimal {
  const t = rules.inheritance_tax
  let x = ZERO
  for (const m of f.members.filter(y => y.generation === 1)) {
    const a = memberAssets(f, positions, m.id)
    for (const [cls, v] of Object.entries(a.direct)) if (t.taxable_classes.includes(cls as AssetClass) && !t.exempt_classes_close_relatives.includes(cls as AssetClass)) x = x.plus(v)
    if (t.entity_shares_taxable) x = x.plus(a.via_entity)
  }
  return x
}

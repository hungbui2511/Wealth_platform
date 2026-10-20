// Khớp đối tượng chính sách (BR-30). Xác định, không dùng LLM.
import { POLICY_TOPIC_LABELS, type PolicyTopic } from '../shared/catalog'
import type { Family } from '../shared/types'
import { fmtNumber, fmtVndShort } from '../shared/format'
import { D, Decimal, ZERO, sum, s } from './dec'
import { entityFamilyShare, type Position } from './positions'
import { DEFAULT_SUCCESSION_RULES, inheritanceTaxableBase, type SuccessionRules } from './structure'

// Ngưỡng trọng yếu cho chủ đề rộng: chứng khoán dưới 5% tài sản ròng thì không coi là chịu tác động
export const SECURITIES_MIN_SHARE = 0.05

export interface PolicyMatchResult { family_id: string; topics: PolicyTopic[]; reasons: string[]; touch: string; relevant: string }

function relevantFor(topic: PolicyTopic, f: Family, positions: Position[], debt: Decimal, netWorth: Decimal, rules: SuccessionRules): { hit: boolean; amount: Decimal; reason: (nw: Decimal) => string } {
  const exp = (pred: (p: Position) => boolean) => sum(positions.filter(pred).map(p => p.exposure))
  const pctOf = (a: Decimal, nw: Decimal) => nw.gt(0) ? `${fmtNumber(a.div(nw).times(100).toNumber(), 0)}% tài sản ròng` : 'tài sản ròng không dương'
  switch (topic) {
    case 'TAX_SECURITIES': {
      const a = exp(p => ['EQ_VN', 'EQ_INTL', 'FUND', 'GOV_BOND', 'CORP_BOND'].includes(p.asset_class) || p.part !== null)
      return { hit: a.gt(0) && (netWorth.lte(0) || a.div(netWorth).gte(SECURITIES_MIN_SHARE)), amount: a, reason: nw => `Có ${fmtVndShort(a.toFixed(0))} chứng khoán, trái phiếu, quỹ, ${pctOf(a, nw)}` }
    }
    case 'PROPERTY_LAND': {
      const a = exp(p => p.asset_class === 'REAL_ESTATE')
      return { hit: a.gt(0), amount: a, reason: nw => `Có ${fmtVndShort(a.toFixed(0))} bất động sản, ${pctOf(a, nw)}` }
    }
    case 'INHERITANCE_GIFT': {
      // Chỉ phần chịu thuế khi chuyển giao: chứng khoán, phần vốn qua pháp nhân, bất động sản không thuộc diện miễn giữa người thân
      const hit = f.members.some(m => m.generation === 1) && f.members.some(m => m.generation === 2)
      const a = inheritanceTaxableBase(f, positions, rules)
      return { hit: hit && a.gt(0), amount: a, reason: nw => `Có thành viên thế hệ 1 và thế hệ 2; phần tài sản chịu thuế khi chuyển giao (chứng khoán, phần vốn qua pháp nhân) ${fmtVndShort(a.toFixed(0))}, ${pctOf(a, nw)}; bất động sản đứng tên cá nhân chuyển cho người thân được miễn` }
    }
    case 'CORPORATE_HOLDING': {
      // Nhìn xuyên nhiều tầng pháp nhân: phần tài sản gia đình nắm qua pháp nhân theo tỷ lệ sở hữu hiệu dụng
      const viaEntity = sum(positions.map(p => {
        const acc = f.accounts.find(a => a.id === p.account_id)
        return sum((acc?.owners ?? []).filter(o => o.kind === 'entity').map(o => p.value_vnd.times(D(o.pct)).times(entityFamilyShare(f, o.id))))
      }))
      const entityAccounts = new Set(f.accounts.filter(a => a.owners.some(o => o.kind === 'entity')).map(a => a.id))
      const a = viaEntity.plus(exp(p => p.asset_class === 'PRIVATE_EQ' && !entityAccounts.has(p.account_id)))
      const layers = f.ownerships.some(o => o.owner_entity_id) ? ', có sở hữu nhiều tầng' : ''
      return { hit: f.entities.length > 0, amount: a, reason: nw => `Có ${f.entities.length} pháp nhân${layers}; tài sản qua pháp nhân và cổ phần tư nhân ${fmtVndShort(a.toFixed(0))}, ${pctOf(a, nw)}` }
    }
    case 'FX_OFFSHORE': {
      const a = exp(p => p.currency !== 'VND' || p.asset_class === 'EQ_INTL')
      return { hit: a.gt(0), amount: a, reason: nw => `Có ${fmtVndShort(a.toFixed(0))} tài sản ngoại tệ hoặc cổ phiếu quốc tế, ${pctOf(a, nw)}` }
    }
    case 'GOLD': {
      const a = exp(p => p.asset_class === 'GOLD')
      return { hit: a.gt(0), amount: a, reason: nw => `Có ${fmtVndShort(a.toFixed(0))} vàng, ${pctOf(a, nw)}` }
    }
    case 'DIGITAL_ASSET': {
      const a = exp(p => p.asset_class === 'CRYPTO')
      return { hit: a.gt(0), amount: a, reason: nw => `Có ${fmtVndShort(a.toFixed(0))} tài sản mã hóa, ${pctOf(a, nw)}` }
    }
    case 'CREDIT':
      return { hit: f.liabilities.length > 0, amount: debt, reason: nw => `Có ${f.liabilities.length} khoản nợ, dư nợ ${fmtVndShort(debt.toFixed(0))}, ${pctOf(debt, nw)}` }
    case 'INSURANCE': {
      const a = exp(p => p.asset_class === 'INSURANCE')
      return { hit: a.gt(0), amount: a, reason: nw => `Có ${fmtVndShort(a.toFixed(0))} bảo hiểm tích lũy, ${pctOf(a, nw)}` }
    }
  }
}

export function matchFamily(f: Family, positions: Position[], netWorth: Decimal, debt: Decimal, topics: PolicyTopic[], rules: SuccessionRules = DEFAULT_SUCCESSION_RULES): PolicyMatchResult | null {
  const hits: PolicyTopic[] = [], reasons: string[] = []
  let maxAmt = ZERO
  for (const t of topics) {
    const r = relevantFor(t, f, positions, debt, netWorth, rules)
    if (!r.hit) continue
    hits.push(t); reasons.push(`${POLICY_TOPIC_LABELS[t]}: ${r.reason(netWorth)}`)
    if (r.amount.gt(maxAmt)) maxAmt = r.amount
  }
  if (!hits.length) return null
  return { family_id: f.id, topics: hits, reasons, relevant: maxAmt.toFixed(0), touch: netWorth.gt(0) ? s(maxAmt.div(netWorth), 8) : '0' }
}

export { D }

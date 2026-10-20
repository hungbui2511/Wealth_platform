// Bổ sung trường cấu trúc liên thế hệ cho gia đình mẫu (đợt 4). Không đổi số lượng, giá trị hay tỷ lệ sở hữu hiệu dụng:
// chỉ thêm thông tin thành viên, quan hệ, tầng pháp lý, liên kết tài sản bảo đảm, cam kết góp vốn, người thụ hưởng.
// Riêng DEMO-F13: phần 40% của nhà sáng lập trong tập đoàn chuyển sang nắm qua một công ty holding nước ngoài 100% của ông,
// để minh hoạ sở hữu nhiều tầng; tỷ lệ hiệu dụng vẫn 40%.
import type { Family, Member } from '../src/shared/types'

const ABROAD: Record<string, string> = { 'DEMO-F04': 'SG', 'DEMO-F17': 'AU', 'DEMO-F18': 'SG' }
const WILL = new Set(['DEMO-F01', 'DEMO-F13'])

export function enrichStructure(families: Family[]): Family[] {
  return families.map(f0 => {
    const f: Family = JSON.parse(JSON.stringify(f0))
    const n = Number(f.id.slice(-2))
    const g1 = f.members.filter(m => m.generation === 1), g2 = f.members.filter(m => m.generation === 2), g3 = f.members.filter(m => m.generation === 3)
    f.members = f.members.map((m, i): Member => {
      const base: Member = { ...m, birth_year: m.generation === 1 ? 1960 + ((n * 3 + i) % 12) : m.generation === 2 ? 1988 + ((n + i) % 10) : 2016 + (n % 5), tax_residency: 'VN', nationality: ['VN'] }
      if (m.generation === 2 && /nước ngoài/.test(m.role)) { base.tax_residency = ABROAD[f.id] ?? 'SG'; base.nationality = ['VN', ABROAD[f.id] ?? 'SG'] }
      if (/James/.test(m.name)) { base.tax_residency = 'US'; base.nationality = ['US'] }
      if (m.generation === 1 && g1.length === 2) { base.marital_status = 'married'; base.spouse_id = g1.find(x => x.id !== m.id)!.id }
      else if (m.generation === 1) base.marital_status = 'married'
      else base.marital_status = m.generation === 3 ? 'single' : (n % 3 === 0 ? 'married' : 'single')
      if (m.generation === 2) base.parent_ids = g1.map(x => x.id)
      if (m.generation === 3) base.parent_ids = g2.map(x => x.id).slice(0, 1)
      base.has_will = m.generation === 1 ? WILL.has(f.id) && i === 0 : false
      return base
    })
    void g3
    f.entities = f.entities.map(e => ({ ...e, jurisdiction: 'VN', legal_form: /TNHH/.test(e.name) ? 'llc' as const : 'jsc' as const }))
    f.accounts = f.accounts.map(a => ({ ...a, legal_layer: a.owners.some(o => o.kind === 'entity') ? 'entity' as const : a.owners.length > 1 ? 'joint' as const : 'personal' as const }))
    // Sở hữu nhiều tầng (giữ nguyên tỷ lệ hiệu dụng)
    if (f.id === 'DEMO-F13') {
      const founder = f.members[0].id
      f.entities.push({ id: 'E-F13-2', name: 'Hien Vinh Holdings Pte. Ltd. (giả lập)', type: 'Công ty holding nước ngoài', jurisdiction: 'SG', legal_form: 'holdco_offshore' })
      f.ownerships = f.ownerships.map(o => o.entity_id === 'E-F13-1' && o.member_id === founder ? { entity_id: 'E-F13-1', owner_entity_id: 'E-F13-2', pct: o.pct } : o)
      f.ownerships.push({ entity_id: 'E-F13-2', member_id: founder, pct: '1' })
    }
    // Liên kết tài sản bảo đảm với vị thế cụ thể
    const byInst = (inst: string) => f.holdings.find(h => h.instrument_id === inst)?.id
    for (const l of f.liabilities) {
      if (l.id === 'L-F01-1') { const h = byInst('BDS-CANHO'); if (h) { l.collateral_holdings = [h]; l.ltv_max = '0.7' } }
      if (l.id === 'L-F09-1') { const hs = [byInst('HPG'), byInst('BDS-NHAPHO')].filter((x): x is string => !!x); l.collateral = 'Cổ phiếu HPG và nhà phố'; l.collateral_holdings = hs; l.ltv_max = '0.6'; l.margin_call_ltv = '0.75' }
      if (l.id === 'L-F19-1') { const h = byInst('BDS-BIETTHU'); if (h) { l.collateral = 'Biệt thự'; l.collateral_holdings = [h]; l.ltv_max = '0.7' } }
    }
    // Cam kết góp vốn tăng vốn điều lệ còn lại
    if (f.id === 'DEMO-F19') {
      const h = f.holdings.find(x => x.instrument_id === 'CPTN')
      if (h) h.commitment = { total: '6000000000', called: '2000000000', currency: 'VND', schedule: [{ date: '2027-01-15', amount: '2000000000' }, { date: '2027-07-15', amount: '2000000000' }] }
    }
    // Bảo hiểm có người thụ hưởng chỉ định là con
    for (const h of f.holdings) if (h.instrument_id === 'BH-TICHLUY' && g2[0]) h.beneficiaries = [{ member_id: g2[0].id, pct: '1' }]
    return f
  })
}

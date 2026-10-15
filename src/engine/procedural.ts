// Nhánh tác động lên mục tiêu (thủ tục, hồ sơ, thời gian) — không phải tác động giá.
// Quy định mới không làm đổi giá tài sản nhưng có thể làm chậm mục tiêu có dòng tiền ra nước ngoài
// (du học, định cư, đầu tư nước ngoài…). Máy chỉ khớp ghi chú quy định đã phát hành với MỤC TIÊU của gia đình.
// Rào chắn: không bao giờ chọn khách theo xếp hạng rủi ro rửa tiền, PEP hay giao dịch đáng ngờ — tránh để lộ việc khách
// đang bị theo dõi (tipping-off). Thông điệp là thông điệp chung theo loại mục tiêu.
import type { CrossBorderPurpose, Goal, ProceduralNote } from '../shared/types'

export const PURPOSE_LABEL: Record<CrossBorderPurpose, string> = {
  study: 'Du học', emigration: 'Định cư, nghỉ hưu ở nước ngoài', overseas_invest: 'Đầu tư ra nước ngoài',
  overseas_property: 'Mua bất động sản nước ngoài', family_support: 'Chu cấp người thân ở nước ngoài', other: 'Chuyển tiền ra nước ngoài khác',
}
export const PURPOSES = Object.keys(PURPOSE_LABEL) as CrossBorderPurpose[]

// Ranh giới từ theo chữ Unicode (\b của JS không hiểu chữ có dấu)
const w = (x: string) => new RegExp(`(?<![\\p{L}])(?:${x})(?![\\p{L}])`, 'u')
const COUNTRIES: [RegExp, string][] = [
  [w('úc|australia'), 'Úc'], [w('mỹ|hoa kỳ|usa|us'), 'Mỹ'], [w('canada'), 'Canada'], [w('singapore'), 'Singapore'],
  [w('anh quốc|vương quốc anh|uk'), 'Anh'], [w('nhật|nhật bản'), 'Nhật Bản'], [w('hàn quốc'), 'Hàn Quốc'], [w('cộng hòa liên bang đức|nước đức'), 'Đức'],
  [w('pháp'), 'Pháp'], [w('new zealand'), 'New Zealand'], [w('châu âu'), 'Châu Âu'],
]

export interface CrossBorder { purpose: CrossBorderPurpose; country?: string; inferred: boolean }

// RM khai báo thì dùng khai báo; chưa khai báo thì suy từ tên mục tiêu (gắn nhãn "suy từ tên", RM cần xác nhận)
export function crossBorderOf(g: Goal): CrossBorder | null {
  if (g.cross_border) return { ...g.cross_border, inferred: false }
  const s = ` ${g.name.toLowerCase()} `
  const country = COUNTRIES.find(([re]) => re.test(s))?.[1]
  const abroad = /nước ngoài|quốc tế/.test(s) || !!country
  let purpose: CrossBorderPurpose | null = null
  if (/du học/.test(s) || (g.type === 'education' && abroad)) purpose = 'study'
  else if (/định cư/.test(s) || (g.type === 'retirement' && abroad)) purpose = 'emigration'
  else if (/đầu tư/.test(s) && abroad) purpose = 'overseas_invest'
  else if (/(mua|nhà|căn hộ|bất động sản)/.test(s) && abroad) purpose = 'overseas_property'
  else if (/(chu cấp|hỗ trợ|gửi tiền)/.test(s) && abroad) purpose = 'family_support'
  return purpose ? { purpose, ...(country ? { country } : {}), inferred: true } : null
}

export interface NoteRef { id: string; doc_no: string; title: string; published_at: string; procedural: ProceduralNote }
// confirm: mục tiêu chỉ SUY từ tên (chưa được RM khai báo) — chỉ báo RM xác nhận, chưa có thông điệp nào tới khách,
// vì suy từ tên có thể nhầm (tên người như "Nhật Minh", "Mỹ Linh").
export type Tier = 'contact' | 'remind' | 'confirm' | 'note'
export const TIER_LABEL: Record<Tier, string> = { contact: 'RM liên hệ ngay', remind: 'Nhắc trên thẻ mục tiêu', confirm: 'RM xác nhận mục tiêu', note: 'Ghi chú' }

export interface ProceduralAlert {
  note_id: string; doc_no: string; title: string; regulation: string; status: ProceduralNote['status']; effective_date?: string
  family_id: string; goal_id: string; goal_name: string; purpose: CrossBorderPurpose; country?: string; inferred: boolean
  goal_month: string; prepare_by: string; weeks_to_goal: number; tier: Tier; reason: string
  documents: string[]; client_message: string; rm_talking_points: string
}

const WEEK = 7 * 864e5
const BUFFER_WEEKS = 4 // dự phòng cho ngân hàng xử lý hồ sơ sau khi khách nộp đủ

export function matchProcedural(notes: NoteRef[], goals: Goal[], nowIso: string): ProceduralAlert[] {
  const now = Date.parse(nowIso)
  const out: ProceduralAlert[] = []
  for (const g of goals) {
    if (g.status !== 'active') continue
    const cb = crossBorderOf(g)
    if (!cb) continue
    const goalAt = Date.UTC(g.year, g.month - 1, 1)
    if (goalAt <= now) continue
    for (const n of notes) {
      const p = n.procedural
      if (!p.applies_to.includes(cb.purpose)) continue
      const weeksTo = Math.floor((goalAt - now) / WEEK)
      const prepareBy = goalAt - (p.lead_time_weeks + BUFFER_WEEKS) * WEEK
      const monthsToPrepare = (prepareBy - now) / (30.4 * 864e5)
      let tier: Tier = monthsToPrepare <= 3 ? 'contact' : weeksTo <= 104 ? 'remind' : 'note'
      const why: string[] = [`${PURPOSE_LABEL[cb.purpose]}${cb.country ? ` (${cb.country})` : ''}, cần tiền ${String(g.month).padStart(2, '0')}/${g.year}`]
      why.push(prepareBy <= now ? 'đã quá mốc nên bắt đầu chuẩn bị hồ sơ' : `nên chuẩn bị hồ sơ trước ${new Date(prepareBy).toISOString().slice(0, 10)}`)
      if (p.effective_date && goalAt < Date.parse(p.effective_date)) { tier = 'note'; why.push('khoản chi trước ngày hiệu lực dự kiến') }
      if (p.status === 'draft' && tier === 'contact') { tier = 'remind'; why.push('văn bản còn là dự thảo nên chưa yêu cầu RM liên hệ ngay') }
      if (cb.inferred && tier !== 'note') { tier = 'confirm'; why.push('mục tiêu suy từ tên: RM xác nhận và khai báo trước, chưa hiện thông điệp cho khách') }
      out.push({
        note_id: n.id, doc_no: n.doc_no, title: n.title, regulation: p.regulation, status: p.status, ...(p.effective_date ? { effective_date: p.effective_date } : {}),
        family_id: g.family_id, goal_id: g.id, goal_name: g.name, purpose: cb.purpose, ...(cb.country ? { country: cb.country } : {}), inferred: cb.inferred,
        goal_month: `${g.year}-${String(g.month).padStart(2, '0')}`, prepare_by: new Date(Math.max(prepareBy, now)).toISOString().slice(0, 10), weeks_to_goal: weeksTo,
        tier, reason: why.join('; '), documents: p.documents, client_message: cb.inferred ? '' : p.client_message, rm_talking_points: p.rm_talking_points,
      })
    }
  }
  const rank: Record<Tier, number> = { contact: 0, remind: 1, confirm: 2, note: 3 }
  return out.sort((a, b) => rank[a.tier] - rank[b.tier] || a.weeks_to_goal - b.weeks_to_goal)
}

// Cụm từ có thể làm lộ việc khách đang bị giám sát chống rửa tiền (tipping-off). Áp cho cả thông điệp cho khách và
// gợi ý cho RM (RM có thể đọc lại nguyên văn cho khách). Cộng thêm danh sách cụm từ cấm của Tuân thủ (cấu hình BANNED).
export const TIPPING_OFF = /(?<![\p{L}])(pep|người có ảnh hưởng chính trị|rủi ro cao|rủi ro rửa tiền|xếp hạng rủi ro|đáng ngờ|nghi vấn|bị theo dõi|theo dõi đặc biệt|giám sát tăng cường|giám sát đặc biệt|báo cáo giao dịch|str|danh sách đen|danh sách theo dõi|phong tỏa|bị điều tra|cơ quan điều tra|tài trợ khủng bố)(?![\p{L}])/iu

// Kiểm tra nội dung ghi chú quy định trước khi nạp
export function proceduralErrors(p: Partial<ProceduralNote> | undefined, banned: string[] = []): string[] {
  const e: string[] = []
  if (!p) return ['Thiếu nội dung ghi chú quy định']
  if (!p.regulation || p.regulation.trim().length < 10) e.push('Tên văn bản tối thiểu 10 ký tự')
  if (!['draft', 'issued', 'effective'].includes(String(p.status))) e.push('Trạng thái văn bản phải là dự thảo, đã ban hành hoặc đã có hiệu lực')
  if (p.effective_date && Number.isNaN(Date.parse(p.effective_date))) e.push('Ngày hiệu lực không hợp lệ')
  if (!Array.isArray(p.applies_to) || !p.applies_to.length || p.applies_to.some(x => !PURPOSES.includes(x))) e.push('Chọn ít nhất một loại mục tiêu bị ảnh hưởng')
  if (!(Number.isInteger(p.lead_time_weeks) && p.lead_time_weeks! >= 0 && p.lead_time_weeks! <= 52)) e.push('Thời gian chuẩn bị thêm phải là số tuần từ 0 đến 52')
  if (!Array.isArray(p.documents) || !p.documents.length) e.push('Liệt kê ít nhất một loại hồ sơ khách cần chuẩn bị')
  if (!p.client_message || p.client_message.trim().length < 40) e.push('Thông điệp cho khách tối thiểu 40 ký tự')
  if (!p.rm_talking_points || p.rm_talking_points.trim().length < 20) e.push('Gợi ý cho RM tối thiểu 20 ký tự')
  // Thông điệp chung: không được nói về hồ sơ rủi ro của riêng khách
  if (TIPPING_OFF.test(p.client_message ?? '')) e.push('Thông điệp cho khách không được nhắc PEP, xếp hạng rủi ro, giao dịch đáng ngờ hay việc giám sát (tránh tiết lộ thông tin chống rửa tiền)')
  if (TIPPING_OFF.test(p.rm_talking_points ?? '')) e.push('Gợi ý cho RM không được nhắc PEP, xếp hạng rủi ro, giao dịch đáng ngờ hay việc giám sát (RM có thể đọc lại cho khách)')
  const low = (x?: string) => (x ?? '').normalize('NFC').toLowerCase()
  for (const b of banned) {
    const k = low(b).trim()
    if (!k) continue
    if (low(p.client_message).includes(k)) e.push(`Thông điệp cho khách chứa cụm từ cấm "${b}"`)
    if (low(p.rm_talking_points).includes(k)) e.push(`Gợi ý cho RM chứa cụm từ cấm "${b}"`)
  }
  return e
}

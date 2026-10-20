// Đối chiếu hai lớp số của một nhận định: mức −3..+3 (lời giải thích, bản tin cũ) và nhánh kịch bản (nguồn của mọi con số
// tới gia đình). Không gọi LLM. Dùng cho phản biện theo quy tắc trước duyệt và cho bản tin dựng từ kịch bản.
import type { ImpactLine } from '../shared/types'
import { lineKey } from '../shared/schemas'
import type { FactorModel, ScenarioSet } from './scenario'
import { scenarioPreview } from './scenario'

// Biến động % (với tiền gửi: điểm cơ bản lãi suất) của một vị thế đại diện cho từng loại tài sản và cặp tiền, từ cú sốc kỳ vọng.
// Vị thế đại diện: cổ phiếu beta 1; trái phiếu Chính phủ duration 5 năm; trái phiếu doanh nghiệp duration 2,5 năm cộng chênh lệch
// tín dụng trung bình hai nhóm; vàng SJC = vàng thế giới + tỷ giá + 0,9 × chênh lệch SJC; BĐS và cổ phần tư nhân theo hệ số đại diện.
// Quỹ và bảo hiểm tích lũy phụ thuộc tài sản bên dưới nên không đối chiếu.
export function representativeMoves(model: FactorModel, expected: Record<string, number>): Record<string, { move: number; unit: '%' | 'bp' }> {
  const x = (k: string) => expected[k] ?? 0
  const proxy = (ac: string) => { const p = model.proxy[ac]; return p ? x(p.factor) * p.loading : 0 }
  return {
    'asset_class:EQ_VN': { move: x('VN_EQ'), unit: '%' },
    'asset_class:EQ_INTL': { move: x('GLOBAL_EQ') + x('USDVND'), unit: '%' },
    'asset_class:GOV_BOND': { move: -x('VN_GOV') * 5 / 100, unit: '%' },
    'asset_class:CORP_BOND': { move: -(x('VN_GOV') + (x('CREDIT_RE') + x('CREDIT_FIN')) / 2) * 2.5 / 100, unit: '%' },
    'asset_class:GOLD': { move: x('GOLD_W') + x('USDVND') + 0.9 * x('SJC_PREM'), unit: '%' },
    'asset_class:CRYPTO': { move: x('CRYPTO') + x('USDVND'), unit: '%' },
    'asset_class:REAL_ESTATE': { move: proxy('REAL_ESTATE'), unit: '%' },
    'asset_class:PRIVATE_EQ': { move: proxy('PRIVATE_EQ'), unit: '%' },
    'asset_class:CASH': { move: x('VN_RATE'), unit: 'bp' },
    'fx:USD': { move: x('USDVND'), unit: '%' },
  }
}

// Ngưỡng coi là có hướng rõ: 0,3% với tài sản, 10 điểm cơ bản với lãi suất tiền gửi
const MIN_MOVE = { '%': 0.3, bp: 10 }

export interface ConsistencyIssue { key: string; line_key: string; level: number; move: number; unit: '%' | 'bp' }

// Dòng có mức khác 0 nhưng kịch bản kỳ vọng đẩy theo hướng ngược lại (và đủ lớn) là mâu thuẫn giữa hai lớp số
export function levelScenarioConflicts(impacts: ImpactLine[], model: FactorModel, set: ScenarioSet): ConsistencyIssue[] {
  const moves = representativeMoves(model, scenarioPreview(model, set).expected)
  const out: ConsistencyIssue[] = []
  for (const l of impacts) {
    if (l.level === 0 || l.scope === 'sector' || l.scope === 'instrument') continue
    const key = `${l.scope}:${l.target}`
    const m = moves[key]
    if (!m || Math.abs(m.move) < MIN_MOVE[m.unit]) continue
    if (Math.sign(m.move) !== Math.sign(l.level)) out.push({ key, line_key: lineKey(l), level: l.level, move: Math.round(m.move * 100) / 100, unit: m.unit })
  }
  return out
}

// Hướng và độ lớn kỳ vọng theo kịch bản cho từng loại tài sản (dùng cho bản tin): bỏ qua mục quá nhỏ
export function scenarioDirections(model: FactorModel, set: ScenarioSet): { key: string; move: number; unit: '%' | 'bp' }[] {
  const moves = representativeMoves(model, scenarioPreview(model, set).expected)
  return Object.entries(moves).filter(([, m]) => Math.abs(m.move) >= MIN_MOVE[m.unit]).map(([key, m]) => ({ key, move: Math.round(m.move * 10) / 10, unit: m.unit }))
}

// Kiểm tra cấu trúc nhánh kịch bản (phần quyết định con số tới gia đình, trước đây chỉ được kiểm schema)
export interface BranchIssue { check: 'scenario_balance' | 'overconfidence'; severity: 'medium' | 'low'; target: string; issue: string; suggestion: string }
export function branchIssues(model: FactorModel, set: ScenarioSet): BranchIssue[] {
  const out: BranchIssue[] = []
  const prev = scenarioPreview(model, set)
  const top = [...set.branches].sort((a, b) => b.probability - a.probability)[0]
  if (top && top.probability >= 0.8) out.push({ check: 'overconfidence', severity: 'medium', target: `scenario:${top.id}`, issue: `Nhánh "${top.name}" chiếm ${Math.round(top.probability * 100)}% xác suất: gần như chỉ còn một kịch bản, dải tác động tới gia đình sẽ hẹp giả tạo`, suggestion: 'Xem lại xác suất, thêm nhánh ngược chiều hoặc nhánh căng thẳng có xác suất hợp lý' })
  // Mọi nhánh cùng đẩy yếu tố chính theo một hướng: thiếu kịch bản ngược chiều
  const main = Object.entries(prev.expected).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0]
  if (main && set.branches.length >= 2) {
    const signs = prev.branches.map(b => Math.sign(b.shocks[main] ?? 0))
    if (signs.every(x => x === signs[0]) && signs[0] !== 0) out.push({ check: 'scenario_balance', severity: 'medium', target: `scenario:${main}`, issue: `Mọi nhánh đều đẩy ${main} cùng chiều: chưa có kịch bản tin không tác động hoặc tác động ngược chiều`, suggestion: 'Thêm một nhánh "tin đã phản ánh vào giá" hoặc nhánh ngược chiều với xác suất phù hợp' })
  }
  if (!set.branches.some(b => b.regime === 'stress')) out.push({ check: 'scenario_balance', severity: 'low', target: 'scenario:regime', issue: 'Không có nhánh nào ở chế độ căng thẳng: tương quan và biến động dùng toàn chế độ bình thường', suggestion: 'Cân nhắc một nhánh căng thẳng xác suất nhỏ nếu sự kiện có thể lan rộng' })
  return out
}

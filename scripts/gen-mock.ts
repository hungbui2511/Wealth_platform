// Sinh đầu ra ghi sẵn cho AGENT_MODE=mock (BRD Mục 11.4). Chạy: npm run seed:gen
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ASSET_CLASSES } from '../src/shared/catalog'
import type { ImpactLine } from '../src/shared/types'

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..')
const out = (rel: string, data: unknown) => { const p = join(ROOT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(data, null, 2) + '\n') }

type H = ImpactLine['horizon']; type C = ImpactLine['confidence']
type L = [ImpactLine['scope'], string | undefined, string, number, string, string[], H?, C?, ImpactLine['direction']?]

const NEUTRAL: Record<string, string> = {
  CASH: 'Không ảnh hưởng trực tiếp tới giá trị tiền gửi', GOV_BOND: 'Không liên quan trực tiếp tới trái phiếu Chính phủ',
  CORP_BOND: 'Chưa thấy tác động trực tiếp lên trái phiếu doanh nghiệp nói chung', EQ_VN: 'Không có tác động đáng kể tới mặt bằng cổ phiếu trong nước',
  EQ_INTL: 'Sự kiện trong nước, không tác động tới cổ phiếu quốc tế', FUND: 'Quỹ được nhìn xuyên qua bảng phân bổ',
  GOLD: 'Nguồn không đề cập tới vàng', REAL_ESTATE: 'Nguồn không đề cập tác động tới giá bất động sản',
  PRIVATE_EQ: 'Phụ thuộc ngành của từng doanh nghiệp, nguồn không đủ', CRYPTO: 'Không có liên hệ trực tiếp với tài sản mã hóa',
  INSURANCE: 'Không ảnh hưởng đáng kể tới bảo hiểm tích lũy', USD: 'Không tác động tới tỷ giá USD/VND', SGD: 'Không tác động tới tỷ giá SGD/VND', AUD: 'Không tác động tới tỷ giá AUD/VND',
}
const INSUFF = new Set(['GOLD', 'PRIVATE_EQ'])

function mkLine([scope, ac, target, level, rationale, src, horizon, confidence, dir]: L): ImpactLine {
  const direction = dir ?? (level > 0 ? 'positive' : level < 0 ? 'negative' : 'neutral')
  return { scope, ...(ac ? { asset_class: ac as never } : {}), target, level, direction, ...(level !== 0 ? { horizon: horizon ?? '1-3 tháng', confidence: confidence ?? 'medium' } : {}), rationale, source_ids: src }
}

// Dựng đủ 11 dòng loại tài sản và 3 dòng tỷ giá; dòng không nêu là trung tính
function fullView(specific: L[]): ImpactLine[] {
  const lines: ImpactLine[] = []
  for (const ac of ASSET_CLASSES) {
    const s = specific.find(x => x[0] === 'asset_class' && x[2] === ac)
    lines.push(s ? mkLine(s) : mkLine(['asset_class', ac, ac, 0, NEUTRAL[ac], [], undefined, undefined, INSUFF.has(ac) ? 'insufficient_evidence' : 'neutral']))
  }
  for (const s of specific.filter(x => x[0] === 'sector' || x[0] === 'instrument')) lines.push(mkLine(s))
  for (const c of ['USD', 'SGD', 'AUD']) {
    const s = specific.find(x => x[0] === 'fx' && x[2] === c)
    lines.push(s ? mkLine(s) : mkLine(['fx', undefined, c, 0, NEUTRAL[c], []]))
  }
  return lines
}

const GROUPS: Record<string, { name: string; classes: string[]; fx: boolean; sectorFor: string[] }> = {
  analyst_macro: { name: 'Vĩ mô và lãi suất', classes: ['CASH', 'GOV_BOND'], fx: true, sectorFor: ['GOV_BOND'] },
  analyst_equity: { name: 'Cổ phiếu và quỹ', classes: ['EQ_VN', 'EQ_INTL', 'FUND'], fx: false, sectorFor: ['EQ_VN', 'EQ_INTL', 'FUND'] },
  analyst_credit_re: { name: 'Tín dụng và bất động sản', classes: ['CORP_BOND', 'REAL_ESTATE', 'PRIVATE_EQ'], fx: false, sectorFor: ['CORP_BOND', 'REAL_ESTATE', 'PRIVATE_EQ'] },
  analyst_commodity: { name: 'Hàng hóa và tài sản khác', classes: ['GOLD', 'CRYPTO', 'INSURANCE'], fx: false, sectorFor: ['GOLD', 'CRYPTO', 'INSURANCE'] },
}

interface EvSpec {
  id: string; summary: string; lines: L[]
  analystOverride?: Record<string, number> // khóa dòng → mức mà agent phân tích đề xuất trước tranh luận
  debate?: { key: string; rounds: { bull: string; bear: string }[]; conclusion: string; agreed: boolean }[]
  pre: { check: string; severity: 'critical' | 'medium' | 'low'; target: string; issue: string; suggestion: string; source_ids?: string[] }[]
  counter: string
}

const k = (l: L | ImpactLine) => Array.isArray(l) ? `${l[0]}:${l[1] ?? ''}:${l[2]}` : `${l.scope}:${l.asset_class ?? ''}:${l.target}`

const EVS: EvSpec[] = [
  {
    id: 'EV-2026-0001', summary: 'Ngân hàng Trung ương (giả lập) tăng lãi suất điều hành 0,5 điểm %',
    lines: [
      ['asset_class', 'CASH', 'CASH', 0, 'Lãi suất tiền gửi tăng nhưng giá trị danh nghĩa của tiền gửi không đổi', []],
      ['asset_class', 'GOV_BOND', 'GOV_BOND', -2, 'Lợi suất tăng làm giá trái phiếu giảm; kỳ hạn dài chịu tác động lớn hơn', ['NW-0001', 'NW-0003'], '1-3 tháng', 'high'],
      ['asset_class', 'CORP_BOND', 'CORP_BOND', -1, 'Chi phí vốn tăng làm giá trái phiếu doanh nghiệp giảm nhẹ', ['NW-0002'], '3-6 tháng', 'medium'],
      ['asset_class', 'EQ_VN', 'EQ_VN', -1, 'Chi phí vốn cao hơn gây áp lực lên định giá cổ phiếu', ['NW-0001', 'NW-0002'], '1-3 tháng', 'medium'],
      ['asset_class', 'REAL_ESTATE', 'REAL_ESTATE', -1, 'Lãi vay mua nhà tăng làm giảm sức mua bất động sản', ['NW-0002'], '3-6 tháng', 'low'],
      ['sector', 'EQ_VN', 'BANK', 1, 'Ngân hàng có thể cải thiện biên lãi ròng khi lãi suất tăng', ['NW-0002'], '3-6 tháng', 'low'],
      ['sector', 'EQ_VN', 'REAL_ESTATE', -2, 'Doanh nghiệp địa ốc nhạy cảm với chi phí vay', ['NW-0002'], '1-3 tháng', 'medium'],
      ['fx', undefined, 'USD', -1, 'Chênh lệch lãi suất có lợi cho VND, USD có thể giảm nhẹ so với VND', ['NW-0001'], '1-3 tháng', 'low'],
    ],
    analystOverride: { 'asset_class:GOV_BOND:GOV_BOND': -3 },
    debate: [{ key: 'asset_class:GOV_BOND:GOV_BOND', rounds: [{ bull: 'Mức tăng 0,5 điểm % đã được thị trường dự đoán một phần; giá trái phiếu kỳ hạn ngắn ít biến động.', bear: 'NW-0003 cho thấy lợi suất kỳ hạn dài tăng mạnh; giá trái phiếu dài hạn giảm rõ.' }], conclusion: 'Chọn mức −2: tác động rõ với kỳ hạn dài nhưng kỳ hạn ngắn ít hơn; bảng u đã tách theo kỳ hạn.', agreed: true }],
    pre: [{ check: 'opposite_direction', severity: 'medium', target: 'sector:EQ_VN:BANK', issue: 'Lãi suất tăng cũng làm tăng chi phí huy động và rủi ro nợ xấu, có thể triệt tiêu lợi ích biên lãi của ngân hàng', suggestion: 'Cân nhắc đặt mức 0 hoặc ghi rõ giả định về chi phí huy động trong lập luận' }],
    counter: 'Nếu lạm phát hạ nhiệt nhanh, ngân hàng trung ương giả lập có thể đảo chiều trong 6 tháng, khi đó trái phiếu hồi phục.',
  },
  {
    id: 'EV-2026-0002', summary: 'Quy định giả lập siết tín dụng cho bất động sản',
    lines: [
      ['asset_class', 'EQ_VN', 'EQ_VN', -1, 'Tâm lý thị trường chung kém đi sau thông tin siết tín dụng', ['NW-0004', 'NW-0005'], '1-3 tháng', 'medium'],
      ['asset_class', 'REAL_ESTATE', 'REAL_ESTATE', -2, 'Nguồn vốn vay mua bất động sản bị thu hẹp', ['NW-0004'], '3-6 tháng', 'medium'],
      ['sector', 'EQ_VN', 'REAL_ESTATE', -3, 'Cổ phiếu bất động sản chịu tác động trực tiếp từ hạn mức tín dụng', ['NW-0004', 'NW-0006'], '1-3 tháng', 'high'],
    ],
    analystOverride: { 'asset_class:REAL_ESTATE:REAL_ESTATE': -2, 'sector:EQ_VN:REAL_ESTATE': -3 },
    debate: [
      { key: 'asset_class:REAL_ESTATE:REAL_ESTATE', rounds: [
        { bull: 'Quy định áp dụng từ quý tới, nhu cầu ở thực vẫn còn; giá giao dịch thứ cấp thường giảm chậm.', bear: 'NW-0004 cho thấy hạn mức cho vay kinh doanh bất động sản giảm và hệ số rủi ro tăng; thanh khoản thị trường sẽ yếu đi rõ.' },
        { bull: 'Mức −3 là quá mạnh cho tài sản định giá thủ công, vốn phản ánh chậm.', bear: 'Đồng ý không lên −3, nhưng −1 đánh giá thấp tác động tới dòng tiền mua bán.' },
      ], conclusion: 'Chọn mức −2 cho bất động sản trực tiếp, độ tin cậy trung bình.', agreed: true },
      { key: 'sector:EQ_VN:REAL_ESTATE', rounds: [
        { bull: 'Một phần tin đã phản ánh vào giá trong phiên NW-0005.', bear: 'NW-0006 cho thấy doanh nghiệp địa ốc nợ vay cao khó huy động vốn mới; áp lực bán còn tiếp diễn.' },
      ], conclusion: 'Giữ mức −3 cho cổ phiếu ngành bất động sản.', agreed: true },
    ],
    pre: [
      { check: 'second_order_effect', severity: 'critical', target: 'asset_class:CORP_BOND:CORP_BOND', issue: 'Nhận định để trái phiếu doanh nghiệp ở mức 0, nhưng NW-0004 và NW-0006 cho thấy doanh nghiệp địa ốc khó huy động vốn mới; trái phiếu do doanh nghiệp bất động sản phát hành chịu rủi ro tái tài trợ trực tiếp', suggestion: 'Thêm dòng ngành (CORP_BOND, REAL_ESTATE) với mức âm; giữ dòng CORP_BOND chung ở 0 nếu không có căn cứ cho các ngành khác', source_ids: ['NW-0004', 'NW-0006'] },
      { check: 'overconfidence', severity: 'medium', target: 'sector:EQ_VN:REAL_ESTATE', issue: 'Mức −3 với độ tin cậy cao dựa trên các tin trong khoảng một ngày, chưa có dữ liệu giao dịch xác nhận', suggestion: 'Cân nhắc hạ độ tin cậy xuống trung bình hoặc nêu thêm căn cứ định lượng' },
      { check: 'source_support', severity: 'low', target: 'asset_class:EQ_VN:EQ_VN', issue: 'NW-0005 chỉ mô tả diễn biến một phiên, chưa đủ để kết luận tâm lý thị trường chung kém đi', suggestion: 'Ghi rõ đây là phản ứng ngắn hạn hoặc bổ sung nguồn khác cho dòng EQ_VN' },
    ],
    counter: 'Nếu cơ quan quản lý giả lập giãn lộ trình áp dụng, cổ phiếu bất động sản có thể hồi phục nhanh do đã giảm mạnh.',
  },
  {
    id: 'EV-2026-0003', summary: 'Giá vàng thế giới tăng mạnh do nhu cầu trú ẩn',
    lines: [
      ['asset_class', 'GOLD', 'GOLD', 2, 'Giá vàng miếng trong nước giả lập tăng theo giá thế giới', ['NW-0007', 'NW-0008'], '<1 tháng', 'high'],
      ['asset_class', 'CRYPTO', 'CRYPTO', -1, 'Tài sản rủi ro biến động mạnh khi dòng tiền tìm nơi trú ẩn', ['NW-0008'], '<1 tháng', 'low'],
      ['fx', undefined, 'USD', 1, 'Dòng tiền trú ẩn vào đồng USD', ['NW-0008'], '1-3 tháng', 'low'],
    ],
    analystOverride: { 'asset_class:GOLD:GOLD': 3 },
    debate: [{ key: 'asset_class:GOLD:GOLD', rounds: [{ bull: 'Nhu cầu trú ẩn mạnh, giá vàng thế giới lập đỉnh mới.', bear: 'Chênh lệch giá vàng trong nước và thế giới có thể thu hẹp, hạn chế mức tăng trong nước.' }], conclusion: 'Chọn mức +2 thay vì +3 do chênh lệch giá trong nước.', agreed: true }],
    pre: [{ check: 'source_support', severity: 'medium', target: 'fx::USD', issue: 'NW-0008 nói dòng tiền vào USD trên thị trường quốc tế, chưa nói về tỷ giá USD/VND', suggestion: 'Đặt mức 0 cho dòng tỷ giá USD hoặc bổ sung nguồn về thị trường trong nước' }],
    counter: 'Nếu căng thẳng địa chính trị giảm, giá vàng có thể điều chỉnh nhanh.',
  },
  {
    id: 'EV-2026-0004', summary: 'Thị trường chứng khoán giả lập được đưa vào danh sách xem xét nâng hạng',
    lines: [
      ['asset_class', 'EQ_VN', 'EQ_VN', 2, 'Kỳ vọng dòng vốn ngoại vào thị trường sau thông tin nâng hạng', ['NW-0009', 'NW-0011'], '3-6 tháng', 'medium'],
      ['sector', 'EQ_VN', 'SECURITIES', 3, 'Công ty chứng khoán hưởng lợi trực tiếp từ thanh khoản tăng', ['NW-0010'], '1-3 tháng', 'medium'],
      ['sector', 'EQ_VN', 'BANK', 1, 'Cổ phiếu ngân hàng vốn hóa lớn được khối ngoại mua ròng', ['NW-0010'], '1-3 tháng', 'low'],
      ['fx', undefined, 'USD', -1, 'Dòng vốn ngoại vào giúp VND vững hơn so với USD', ['NW-0010'], '3-6 tháng', 'low'],
    ],
    debate: [{ key: 'sector:EQ_VN:SECURITIES', rounds: [{ bull: 'Thanh khoản tăng mạnh ngay sau thông tin; doanh thu môi giới cải thiện.', bear: 'Quyết định chính thức còn 6 tháng; kỳ vọng có thể đã phản ánh vào giá.' }], conclusion: 'Giữ +3 nhưng độ tin cậy trung bình.', agreed: true }],
    pre: [{ check: 'overconfidence', severity: 'medium', target: 'asset_class:EQ_VN:EQ_VN', issue: 'NW-0009 nói mới ở danh sách xem xét, quyết định chính thức còn khoảng 6 tháng; mức +2 có thể quá tự tin', suggestion: 'Cân nhắc mức +1 hoặc khung thời gian dài hơn 6 tháng' }],
    counter: 'Nếu tổ chức xếp hạng giả lập hoãn quyết định, dòng vốn có thể rút ra nhanh.',
  },
  {
    id: 'EV-2026-0005', summary: 'Tỷ giá USD/VND tăng mạnh',
    lines: [
      ['asset_class', 'EQ_VN', 'EQ_VN', -1, 'Doanh nghiệp vay nợ ngoại tệ chịu áp lực, tâm lý thị trường kém', ['NW-0012'], '1-3 tháng', 'low'],
      ['fx', undefined, 'USD', 2, 'Tỷ giá USD/VND giả lập tăng mạnh do USD mạnh lên toàn cầu', ['NW-0012'], '1-3 tháng', 'high'],
      ['fx', undefined, 'SGD', 1, 'SGD tăng nhẹ theo USD so với VND', ['NW-0013'], '1-3 tháng', 'medium'],
      ['fx', undefined, 'AUD', 0, 'AUD gần như đi ngang so với VND do giá hàng hóa giảm', ['NW-0013']],
    ],
    debate: [{ key: 'fx::USD', rounds: [{ bull: 'USD mạnh lên toàn cầu, tỷ giá liên ngân hàng giả lập tăng rõ.', bear: 'Ngân hàng trung ương giả lập có thể can thiệp bán ngoại tệ.' }], conclusion: 'Chọn +2: chưa có tín hiệu can thiệp trong nguồn.', agreed: true }],
    pre: [{ check: 'second_order_effect', severity: 'medium', target: 'asset_class:CORP_BOND:CORP_BOND', issue: 'Doanh nghiệp phát hành có nợ ngoại tệ lớn có thể chịu rủi ro tín dụng, nhận định để trái phiếu doanh nghiệp ở mức 0', suggestion: 'Cân nhắc dòng ngành cho nhóm phát hành có nợ ngoại tệ lớn nếu có căn cứ' }],
    counter: 'Nếu USD suy yếu toàn cầu trở lại, tỷ giá có thể giảm nhanh.',
  },
  {
    id: 'EV-2026-0006', summary: 'Công ty Demo X công bố kế hoạch phát hành riêng lẻ',
    lines: [
      ['instrument', 'EQ_VN', 'DMXYZ', -2, 'Cổ đông hiện hữu của Công ty Demo X có thể bị pha loãng', ['NW-0014'], '1-3 tháng', 'medium'],
      ['sector', 'EQ_VN', 'INDUSTRIAL', 1, 'Ngành công nghiệp kỳ vọng đơn hàng quý tới tăng', ['NW-0015'], '3-6 tháng', 'low'],
    ],
    pre: [{ check: 'source_support', severity: 'low', target: 'sector:EQ_VN:INDUSTRIAL', issue: 'NW-0015 chỉ nêu kỳ vọng của doanh nghiệp, chưa có số liệu đơn hàng', suggestion: 'Giữ độ tin cậy thấp và ghi rõ đây là kỳ vọng' }],
    counter: 'Nếu đợt phát hành được bán cho nhà đầu tư chiến lược với giá cao, tác động pha loãng không đáng kể.',
  },
]

function nodesFor(e: EvSpec, finalLines: ImpactLine[]) {
  const nodes: Record<string, unknown> = {}
  for (const [node, g] of Object.entries(GROUPS)) {
    const lines = finalLines.filter(l => (l.scope === 'fx' && g.fx) || (l.scope !== 'fx' && l.asset_class && (l.scope === 'asset_class' ? g.classes.includes(l.target) : g.sectorFor.includes(l.asset_class))))
      .map(l => { const ov = e.analystOverride?.[k(l)]; return ov !== undefined ? { ...l, level: ov, direction: ov > 0 ? 'positive' : ov < 0 ? 'negative' : l.direction } : l })
    nodes[node] = { analyst: g.name, lines, notes: `Nhóm ${g.name} đánh giá ${lines.filter(l => l.level !== 0).length} dòng có tác động.` }
  }
  nodes.debate = { topics: e.debate ?? [] }
  nodes.synthesize = { summary: e.summary, reasons: Object.fromEntries((e.debate ?? []).map(d => [d.key, d.conclusion])) }
  return nodes
}

for (const e of EVS) {
  const lines = fullView(e.lines)
  const n = e.id.slice(-4)
  const view = { event_id: e.id, view_id: `VW-${n}-v1`, event_type: '', summary: e.summary, impacts: lines }
  const file: Record<string, unknown> = { v1: { view, nodes: nodesFor(e, lines) } }
  if (e.id === 'EV-2026-0002') {
    const v2Lines = fullView([...e.lines, ['sector', 'CORP_BOND', 'REAL_ESTATE', -1, 'Trái phiếu do doanh nghiệp bất động sản phát hành chịu rủi ro tái tài trợ khi tín dụng bị siết', ['NW-0004', 'NW-0006'], '3-6 tháng', 'medium']])
    file.v2 = { view: { ...view, view_id: `VW-${n}-v2`, impacts: v2Lines, summary: e.summary + ' (bản làm lại theo chỉ dẫn của CIO)' }, nodes: nodesFor(e, v2Lines) }
  }
  out(`data/mock_agent/cio/${e.id}.json`, file)
  const ch: Record<string, unknown> = { pre: { findings: e.pre, counter_scenario: e.counter } }
  if (e.id === 'EV-2026-0002') {
    ch.re_challenge = { 'sector:CORP_BOND:REAL_ESTATE': [{ check: 'source_support', severity: 'low', target: 'sector:CORP_BOND:REAL_ESTATE', issue: 'NW-0006 hỗ trợ trực tiếp dòng mới nhưng không nêu quy mô trái phiếu đến hạn của nhóm phát hành', suggestion: 'Ghi rõ phạm vi áp dụng là trái phiếu do doanh nghiệp bất động sản phát hành', source_ids: ['NW-0006'] }] }
    ch.pre_v2 = { findings: [e.pre[1], e.pre[2]], counter_scenario: e.counter }
  }
  out(`data/mock_agent/challenger/${e.id}.json`, ch)
}

// Sự kiện chính sách: nguồn là tin do hệ thống tạo khi lập sự kiện, dùng chỗ giữ {{SRC1}}
const policyViews: Record<string, L[]> = {
  'PD-2026-001': [['asset_class', 'REAL_ESTATE', 'REAL_ESTATE', -1, 'Thuế trên phần chênh lệch làm giảm lợi nhuận đầu tư bất động sản ngắn hạn, có thể giảm thanh khoản', ['{{SRC1}}'], '>6 tháng', 'low']],
  'PD-2026-002': [['asset_class', 'PRIVATE_EQ', 'PRIVATE_EQ', 0, 'Văn bản chủ yếu thay đổi thủ tục và thuế khi chuyển giao, không tác động tới giá cổ phần', []]],
}
for (const [pd, ls] of Object.entries(policyViews)) {
  const lines = fullView(ls)
  out(`data/mock_agent/cio/policy-${pd}.json`, { v1: { view: { event_id: '', view_id: '', event_type: 'policy', summary: '', impacts: lines }, nodes: nodesFor({ id: pd, summary: '', lines: ls, pre: [], counter: '' }, lines) } })
  out(`data/mock_agent/challenger/policy-${pd}.json`, { pre: { findings: [{ check: 'source_support', severity: 'low', target: 'asset_class:REAL_ESTATE:REAL_ESTATE', issue: 'Văn bản còn ở dạng dự thảo hoặc mới ban hành; tác động tới giá phụ thuộc lộ trình áp dụng', suggestion: 'Giữ độ tin cậy thấp và theo dõi bản chính thức' }], counter_scenario: 'Nếu dự thảo được điều chỉnh khi lấy ý kiến, tác động có thể nhỏ hơn.' } })
}

out('data/mock_agent/policy/PD-2026-001.json', { changes: [
  { change_id: 'C1', article_refs: ['Điều 3 khoản 1'], quote: 'Thuế suất 2% trên giá chuyển nhượng được thay bằng thuế suất 20% trên phần chênh lệch giữa giá bán và giá mua có chứng từ.', summary: 'Đổi cách tính thuế chuyển nhượng bất động sản từ 2% giá bán sang 20% phần chênh lệch có chứng từ.', topics: ['PROPERTY_LAND'], affected_parties: 'Cá nhân chuyển nhượng bất động sản', effective_from: '2027-07-01', certainty: 'draft' },
  { change_id: 'C2', article_refs: ['Điều 5 khoản 1', 'Điều 5 khoản 2'], quote: 'Bất động sản nắm giữ dưới 2 năm chịu thuế suất bổ sung 10% trên phần chênh lệch.', summary: 'Thêm thuế suất bổ sung khi chuyển nhượng nhiều bất động sản trong năm hoặc nắm giữ dưới 2 năm.', topics: ['PROPERTY_LAND'], affected_parties: 'Cá nhân chuyển nhượng từ bất động sản thứ hai trong năm', effective_from: '2027-07-01', certainty: 'draft' },
] })
out('data/mock_agent/policy/PD-2026-002.json', { changes: [
  { change_id: 'C1', article_refs: ['Điều 4 khoản 2'], quote: 'Công ty holding phải công bố danh sách thành viên gia đình nắm giữ từ 10% vốn trở lên trong vòng 30 ngày kể từ ngày tặng cho.', summary: 'Công ty holding phải công bố thành viên gia đình nắm từ 10% vốn sau khi tặng cho.', topics: ['CORPORATE_HOLDING'], affected_parties: 'Công ty holding của gia đình', effective_from: '2026-12-01', certainty: 'final' },
  { change_id: 'C2', article_refs: ['Điều 6 khoản 1'], quote: 'Tặng cho, thừa kế cổ phần giữa cha mẹ và con được miễn thuế thu nhập cá nhân nếu bên nhận cam kết nắm giữ tối thiểu 3 năm.', summary: 'Miễn thuế thu nhập cá nhân khi tặng cho, thừa kế cổ phần giữa cha mẹ và con nếu nắm giữ tối thiểu 3 năm.', topics: ['INHERITANCE_GIFT'], affected_parties: 'Cha mẹ và con tặng cho, thừa kế cổ phần', effective_from: '2026-12-01', certainty: 'final' },
] })

// Diễn giải cho RM: bản hợp lệ cho mọi gia đình; riêng DEMO-F07 chèn một con số không có trong kết quả (AC-10)
out('data/mock_agent/interpretation.json', {
  inject: { 'DEMO-F07': 'Ngoài ra, danh mục có thể chịu thêm áp lực khoảng 3,7 tỷ đồng từ các yếu tố khác.' },
})
console.log('Đã sinh đầu ra mock cho', EVS.length, 'sự kiện, 2 văn bản chính sách')

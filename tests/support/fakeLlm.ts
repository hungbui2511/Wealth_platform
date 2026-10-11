// Máy chủ Messages API giả để kiểm thử chế độ live mà không cần khóa API thật.
// Nhận diện agent theo prompt hệ thống, đọc gói dữ liệu giữa hai mốc <<<DỮ_LIỆU>>>, trả JSON đúng dạng mà agent cần.
import { ASSET_CLASSES } from '../../src/shared/catalog'

export interface FakeLlmOptions { failWith?: number; requests?: { system: string; model: string }[] }

function payloadOf(user: string): any {
  const start = user.indexOf('\n') + 1, end = user.lastIndexOf('\n<<<HẾT_DỮ_LIỆU>>>')
  try { return JSON.parse(user.slice(start, end)) } catch { return {} }
}

function line(ac: string, level: number, src: string[]) {
  return level === 0
    ? { scope: 'asset_class', asset_class: ac, target: ac, level: 0, direction: 'insufficient_evidence', rationale: 'Mô hình giả: chưa đủ căn cứ cho loại tài sản này', source_ids: [] }
    : { scope: 'asset_class', asset_class: ac, target: ac, level, direction: level > 0 ? 'positive' : 'negative', horizon: '1-3 tháng', confidence: 'medium', rationale: 'Mô hình giả: tin nói lãi suất tăng nên tiền gửi hưởng lợi', source_ids: src }
}

export function answer(system: string, user: string): unknown {
  const p = payloadOf(user)
  const newsIds: string[] = (p.news ?? []).map((n: { id: string }) => n.id)
  if (system.includes('chuyên viên phân tích trong phòng CIO')) {
    return { lines: (p.analyst?.classes ?? []).map((ac: string) => line(ac, ac === 'CASH' ? 1 : 0, newsIds.slice(0, 1))), notes: 'Nhóm giả' }
  }
  if (system.includes('điều phối một vòng tranh luận')) {
    return { topics: (p.selected ?? []).map((k: string) => ({ key: k, rounds: [{ bull: 'Phía tăng giả', bear: 'Phía giảm giả' }], conclusion: 'Giữ mức', agreed: true })) }
  }
  if (system.includes('người tổng hợp nhận định')) {
    return { summary: 'Nhận định giả lập từ mô hình giả', impacts: [...ASSET_CLASSES.map(ac => line(ac, ac === 'CASH' ? 1 : 0, newsIds.slice(0, 1))), ...['USD', 'SGD', 'AUD'].map(c => ({ scope: 'fx', target: c, level: 0, direction: 'neutral', rationale: 'Mô hình giả: không tác động tới tỷ giá', source_ids: [] }))] }
  }
  if (system.includes('kiểm tra lại CHỈ các dòng')) return { findings: [] }
  if (system.includes('Agent Phản biện độc lập')) {
    return { findings: [{ check: 'overconfidence', severity: 'medium', target: 'asset_class:CASH:CASH', issue: 'Mức +1 cho tiền gửi có thể quá tự tin so với nguồn', suggestion: 'Cân nhắc giữ mức +1 nhưng hạ độ tin cậy xuống thấp' }], counter_scenario: 'Lãi suất huy động không tăng theo' }
  }
  if (system.includes('tóm tắt ngắn bằng tiếng Việt cho CIO')) return { summary: 'Tóm tắt hậu kiểm giả' }
  if (system.includes('Agent Chính sách')) {
    const firstArticle = String(p.content ?? '').match(/Điều \d+/)?.[0] ?? 'Điều 1'
    return { changes: [{ change_id: 'C1', article_refs: [firstArticle], quote: String(p.content ?? '').split('\n')[1]?.slice(0, 300) || 'Trích dẫn', summary: 'Thay đổi giả lập', topics: [p.topics_catalog?.[1] ?? 'PROPERTY_LAND'], affected_parties: 'Cá nhân', certainty: p.kind === 'final' ? 'final' : 'draft' }] }
  }
  if (system.includes('diễn giải nội bộ')) return { text: 'Diễn giải giả cho RM; đây là cú sốc giả định, không phải dự báo.' }
  return {}
}

export function fakeLlmFetch(opts: FakeLlmOptions = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.includes('/v1/messages')) return new Response('not found', { status: 404 })
    const body = JSON.parse(String(init?.body ?? '{}'))
    const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system)
    opts.requests?.push({ system, model: body.model })
    if (opts.failWith) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Lỗi giả' } }), { status: opts.failWith, headers: { 'content-type': 'application/json' } })
    const user = typeof body.messages?.[0]?.content === 'string' ? body.messages[0].content : ''
    const out = answer(system, user)
    return new Response(JSON.stringify({ id: 'msg_fake', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_fake' } })
  }) as typeof fetch
}

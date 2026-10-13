// Agent CIO là đồ thị nhiều bước (FR-309, Mục 11.6), dựng lại theo kiến trúc TradingAgents (Apache-2.0) bằng LangGraph.js:
// dữ liệu (xác định) → bốn nhóm phân tích song song → tranh luận tăng/giảm (có điều kiện) → tổng hợp → kiểm tra schema (thử lại tối đa 2 lần).
// Bỏ trader, quản lý danh mục ra lệnh và sàn mô phỏng; đồ thị không nhận dữ liệu danh mục của gia đình nào (FR-301).
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { ASSET_CLASSES } from '../shared/catalog'
import type { ImpactLine, ViewBody } from '../shared/types'
import { lineKey, validateView, type ViewContext } from '../shared/schemas'

export const ANALYSTS = {
  analyst_macro: { name: 'Vĩ mô và lãi suất', classes: ['CASH', 'GOV_BOND'], fx: true },
  analyst_equity: { name: 'Cổ phiếu và quỹ', classes: ['EQ_VN', 'EQ_INTL', 'FUND'], fx: false },
  analyst_credit_re: { name: 'Tín dụng và bất động sản', classes: ['CORP_BOND', 'REAL_ESTATE', 'PRIVATE_EQ'], fx: false },
  analyst_commodity: { name: 'Hàng hóa và tài sản khác', classes: ['GOLD', 'CRYPTO', 'INSURANCE'], fx: false },
} as const
export type AnalystId = keyof typeof ANALYSTS

export const GRAPH_NODES = ['data', ...Object.keys(ANALYSTS), 'debate', 'synthesize', 'validate'] as const

export interface NodeRun { node: string; seq: number; input: unknown; output: unknown; prompt_version: string | null; prompt: string | null; model: string | null; started_at: string; ended_at: string }

export interface GraphInput {
  event: { id: string; type: string; title: string }
  news: { id: string; title: string; summary: string; url: string; published_at: string }[]
  catalog: { asset_classes: readonly string[]; sectors: readonly string[]; fx: readonly string[]; instruments: { id: string; name: string; asset_class: string; sector?: string }[] }
  factors?: { id: string; label: string; unit: string; origin: string; library: Record<string, number> }[]
  instructions?: string
}

export interface NodeExecutor {
  // Trả về đầu ra của nút; với chế độ live gọi mô hình theo prompt của nút
  run(node: string, payload: unknown, attempt: number): Promise<{ output: unknown; prompt: string | null; prompt_version: string | null; model: string | null }>
}

const State = Annotation.Root({
  input: Annotation<GraphInput>(),
  market: Annotation<unknown>(),
  analysts: Annotation<Record<string, { lines: ImpactLine[]; notes?: string }>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  debateOut: Annotation<{ topics: unknown[]; selected: string[] } | null>({ reducer: (_a, b) => b, default: () => null }),
  draft: Annotation<unknown>({ reducer: (_a, b) => b, default: () => null }),
  attempts: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  result: Annotation<{ ok: boolean; view?: ViewBody; errors: string[]; removed_restricted: ImpactLine[] } | null>({ reducer: (_a, b) => b, default: () => null }),
  nodeRuns: Annotation<NodeRun[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
})
type S = typeof State.State

// Chọn dòng cần tranh luận (FR-310): |mức| ≥ 2 hoặc hai nhóm cho hướng ngược nhau trên cùng đối tượng
export function selectDebate(analysts: Record<string, { lines: ImpactLine[] }>): string[] {
  const byKey = new Map<string, number[]>()
  for (const a of Object.values(analysts)) for (const l of a.lines ?? []) byKey.set(lineKey(l), [...(byKey.get(lineKey(l)) ?? []), l.level])
  const out: string[] = []
  for (const [k, levels] of byKey) if (levels.some(v => Math.abs(v) >= 2) || (levels.some(v => v > 0) && levels.some(v => v < 0))) out.push(k)
  return out.sort()
}

export function buildCioGraph(exec: NodeExecutor, ctx: { viewContext: ViewContext; marketPack: () => Promise<unknown>; now: () => string; viewMeta: { event_id: string; view_id: string; event_type: string } }) {
  let seq = 0
  const record = (node: string, input: unknown, r: { output: unknown; prompt: string | null; prompt_version: string | null; model: string | null }, started: string): NodeRun =>
    ({ node, seq: ++seq, input, output: r.output, prompt: r.prompt, prompt_version: r.prompt_version, model: r.model, started_at: started, ended_at: ctx.now() })

  const g = new StateGraph(State)
    .addNode('data', async (s: S) => {
      const started = ctx.now()
      const market = await ctx.marketPack()
      return { market, nodeRuns: [record('data', { event: s.input.event, news_ids: s.input.news.map(n => n.id) }, { output: market, prompt: null, prompt_version: null, model: 'xác định (không dùng LLM)' }, started)] }
    })
  for (const id of Object.keys(ANALYSTS) as AnalystId[]) {
    g.addNode(id, async (s: S) => {
      const started = ctx.now()
      const payload = { analyst: ANALYSTS[id], event: s.input.event, news: s.input.news, catalog: s.input.catalog, market: s.market, instructions: s.input.instructions }
      const r = await exec.run(id, payload, 0)
      const out = (r.output ?? { lines: [] }) as { lines: ImpactLine[]; notes?: string }
      return { analysts: { [id]: out }, nodeRuns: [record(id, payload, r, started)] }
    })
  }
  g.addNode('debate', async (s: S) => {
    const started = ctx.now()
    const selected = selectDebate(s.analysts)
    if (!selected.length) return { debateOut: { topics: [], selected }, nodeRuns: [record('debate', { selected }, { output: { skipped: true, reason: 'Không có dòng nào đủ điều kiện tranh luận' }, prompt: null, prompt_version: null, model: null }, started)] }
    const payload = { selected, analysts: s.analysts, news: s.input.news, max_rounds: 2 }
    const r = await exec.run('debate', payload, 0)
    const topics = ((r.output as { topics?: { key: string; rounds: unknown[] }[] })?.topics ?? []).filter(t => selected.includes(t.key)).map(t => ({ ...t, rounds: (t.rounds ?? []).slice(0, 2) }))
    return { debateOut: { topics, selected }, nodeRuns: [record('debate', payload, { ...r, output: { topics } }, started)] }
  })
  g.addNode('synthesize', async (s: S) => {
    const started = ctx.now()
    const payload = { analysts: s.analysts, debate: s.debateOut, news: s.input.news, catalog: s.input.catalog, factors: s.input.factors, previous_errors: s.result?.errors ?? [], attempt: s.attempts, instructions: s.input.instructions }
    const r = await exec.run('synthesize', payload, s.attempts)
    return { draft: r.output, nodeRuns: [record('synthesize', payload, r, started)] }
  })
  g.addNode('validate', async (s: S) => {
    const started = ctx.now()
    const d = (s.draft ?? {}) as { summary?: string; impacts?: unknown; scenarios?: unknown }
    const raw = { ...ctx.viewMeta, summary: d.summary ?? s.input.event.title, impacts: d.impacts, ...(d.scenarios ? { scenarios: d.scenarios } : {}) }
    const v = validateView(raw, ctx.viewContext)
    const result = { ok: v.ok, view: v.view, errors: v.errors, removed_restricted: v.removed_restricted }
    return { result, attempts: s.attempts + 1, nodeRuns: [record('validate', { attempt: s.attempts }, { output: { ok: v.ok, errors: v.errors, removed_restricted: v.removed_restricted.map(lineKey) }, prompt: null, prompt_version: null, model: 'xác định (schema Mục 7.3)' }, started)] }
  })
  g.addEdge(START, 'data' as never)
  for (const id of Object.keys(ANALYSTS)) { g.addEdge('data' as never, id as never); g.addEdge(id as never, 'debate' as never) }
  g.addEdge('debate' as never, 'synthesize' as never)
  g.addEdge('synthesize' as never, 'validate' as never)
  // Sai schema: chạy lại bước tổng hợp tối đa 2 lần, sau đó dừng (AGENT_ERROR)
  g.addConditionalEdges('validate' as never, (s: S) => (s.result?.ok || s.attempts >= 3 ? END : 'synthesize') as never)
  return g.compile()
}

export function neutralView(title: string): { summary: string; impacts: ImpactLine[] } {
  const z = (scope: ImpactLine['scope'], target: string, ac?: string): ImpactLine => ({ scope, ...(ac ? { asset_class: ac as never } : {}), target, level: 0, direction: 'insufficient_evidence', rationale: 'Chưa có đầu ra ghi sẵn cho sự kiện này ở chế độ mock; chưa đủ căn cứ', source_ids: [] })
  return { summary: title, impacts: [...ASSET_CLASSES.map(a => z('asset_class', a, a)), ...['USD', 'SGD', 'AUD'].map(c => z('fx', c))] }
}

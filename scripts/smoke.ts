// Kiểm tra khói (BRD Mục 9.1): chạy Agent CIO cho một sự kiện trên một bản demo đang chạy và kiểm tra schema, mã nguồn.
// Dùng: npm run smoke -- http://localhost:8787 [EV-2026-0002]
// Bản deploy sau Cloudflare Access: đặt CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET (service token) và thêm
// service:<Client ID> vào DEMO_OPERATORS của Worker.
const base = process.argv[2] ?? 'http://localhost:8787'
const ev = process.argv[3] ?? 'EV-2026-0002'
const access: Record<string, string> = process.env.CF_ACCESS_CLIENT_ID ? { 'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET ?? '' } : {}
const call = async (user: string, method: string, path: string) => {
  const r = await fetch(base + path, { method, headers: { 'x-demo-user': user, 'content-type': 'application/json', ...access } })
  const d = await r.json() as any
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(d)}`)
  return d
}
const health = await call('CIO1', 'GET', '/api/health')
console.log('Chế độ:', health)
await call('ADM1', 'POST', '/api/admin/load-sample-events')
const view = await call('CIO1', 'POST', `/api/events/${ev}/run-agent`)
const detail = await call('CIO1', 'GET', `/api/views/${view.id}`)
const newsIds = new Set(detail.news.map((n: any) => n.id))
const ac = view.body.impacts.filter((l: any) => l.scope === 'asset_class').length
const fx = view.body.impacts.filter((l: any) => l.scope === 'fx').length
const badSources = view.body.impacts.flatMap((l: any) => l.source_ids).filter((s: string) => !newsIds.has(s))
const ok = view.status !== 'AGENT_ERROR' && ac === 11 && fx === 3 && badSources.length === 0
console.log({ view: view.id, status: view.status, asset_class_lines: ac, fx_lines: fx, unknown_sources: badSources, challenge_findings: detail.challenges[0]?.findings.length })
console.log(ok ? 'KIỂM TRA KHÓI: ĐẠT' : 'KIỂM TRA KHÓI: KHÔNG ĐẠT')
process.exit(ok ? 0 : 1)
export {}

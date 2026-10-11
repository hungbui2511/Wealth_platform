// Bộ chạy API trên shim D1 (node:sqlite), AGENT_MODE=mock, PRICE_MODE=sample.
import { createApp, type AppOptions } from '../../src/worker/app'
import { createD1 } from './d1shim'
import type { Env } from '../../src/worker/ctx'

export function harness(opts: AppOptions & { env?: Partial<Env> } = {}) {
  const DB = createD1()
  // Đồng hồ tăng dần để dấu thời gian xác định và đơn điệu
  let t = Date.parse('2026-10-10T02:00:00.000Z')
  const now = opts.now ?? (() => new Date((t += 1000)).toISOString())
  const app = createApp({ now, fetchFn: opts.fetchFn })
  const env = { DB, AGENT_MODE: 'mock', PRICE_MODE: 'sample', AUTH_MODE: 'dev', ...opts.env } as Env
  async function call<T = any>(user: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-demo-user': user } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env)
    const text = await res.text()
    let data: unknown = text
    try { data = JSON.parse(text) } catch { /* văn bản thuần */ }
    return { status: res.status, data: data as T }
  }
  const ok = async <T = any>(user: string, method: string, path: string, body?: unknown): Promise<T> => {
    const r = await call<T>(user, method, path, body)
    if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(r.data)}`)
    return r.data
  }
  return { DB, env, app, call, ok, now }
}

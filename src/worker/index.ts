// Điểm vào của Worker: /api/* do Hono xử lý, còn lại phục vụ giao diện từ Workers static assets.
// scheduled: lấy tin tự động theo lịch (cron trong wrangler.toml). AgentJobs: Workflows chạy agent nền.
import { createApp } from './app'
import type { Env } from './ctx'
import { scheduledIngest } from './services/ingest'
import { importExternal } from './services/external'

export { AgentJobs } from './workflow'

const app = createApp()

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) return app.fetch(request, env, ctx)
    if (env.ASSETS) return env.ASSETS.fetch(request)
    return new Response('Giao diện chưa được build (npm run build)', { status: 404 })
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Lấy tin RSS, rồi nhập kết quả Claude đã đẩy lên (chế độ external)
    ctx.waitUntil(scheduledIngest(env).then(() => importExternal(env, { trigger: 'cron' })).catch(err => console.error('scheduled', err)))
  },
}

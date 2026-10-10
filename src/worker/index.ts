// Điểm vào của Worker: /api/* do Hono xử lý, còn lại phục vụ giao diện từ Workers static assets.
import { createApp } from './app'
import type { Env } from './ctx'

const app = createApp()

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) return app.fetch(request, env, ctx)
    if (env.ASSETS) return env.ASSETS.fetch(request)
    return new Response('Giao diện chưa được build (npm run build)', { status: 404 })
  },
}

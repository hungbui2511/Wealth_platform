// Xác thực danh tính (NFR-08). Bản deploy: chỉ tin JWT Cloudflare Access trong header Cf-Access-Jwt-Assertion,
// kiểm chữ ký RS256 bằng khóa công khai của team, kiểm aud, iss, exp. Worker có static assets nên ctx.access
// không được chuyển vào Worker; phải tự xác minh JWT.
// AUTH_MODE=dev (chỉ dùng khi chạy trên máy và trong kiểm thử): chọn người dùng demo qua header x-demo-user.
import { HttpError, type Env, type User } from './ctx'

export interface Identity {
  user: User
  email?: string
  operator: boolean // được chuyển vai trò demo (DEMO_OPERATORS)
}

const b64urlBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0))
const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlBytes(s))) as Record<string, unknown>

export const normalizeTeamDomain = (d: string) => (/^https?:\/\//.test(d) ? d : `https://${d}`).replace(/\/+$/, '')

// Bộ nhớ đệm khóa theo team; làm mới khi gặp kid lạ (Access xoay khóa định kỳ) hoặc sau 1 giờ
let keyCache: { domain: string; at: number; keys: Map<string, CryptoKey> } | null = null
async function signingKey(domain: string, kid: string, fetchFn: typeof fetch): Promise<CryptoKey | undefined> {
  const fresh = keyCache && keyCache.domain === domain && Date.now() - keyCache.at < 3_600_000
  if (fresh && keyCache!.keys.has(kid)) return keyCache!.keys.get(kid)
  const res = await fetchFn(`${domain}/cdn-cgi/access/certs`)
  if (!res.ok) throw new HttpError(503, `Không lấy được khóa Cloudflare Access (${res.status})`)
  const { keys = [] } = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] }
  const map = new Map<string, CryptoKey>()
  for (const k of keys) {
    if (!k.kid || k.kty !== 'RSA') continue
    map.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']))
  }
  keyCache = { domain, at: Date.now(), keys: map }
  return map.get(kid)
}

export async function verifyAccessJwt(token: string, o: { teamDomain: string; aud: string; fetchFn: typeof fetch; nowSec?: number }): Promise<{ email: string }> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new HttpError(401, 'JWT Cloudflare Access không hợp lệ')
  let header: Record<string, unknown>, payload: Record<string, unknown>
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]) } catch { throw new HttpError(401, 'JWT Cloudflare Access không đọc được') }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new HttpError(401, 'JWT Cloudflare Access sai thuật toán')
  const domain = normalizeTeamDomain(o.teamDomain)
  const key = await signingKey(domain, header.kid, o.fetchFn)
  if (!key) throw new HttpError(401, 'JWT Cloudflare Access ký bằng khóa không xác định')
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  if (!ok) throw new HttpError(401, 'Chữ ký JWT Cloudflare Access không hợp lệ')
  const now = o.nowSec ?? Math.floor(Date.now() / 1000)
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!auds.includes(o.aud)) throw new HttpError(401, 'JWT không dành cho ứng dụng này (aud)')
  if (payload.iss !== domain) throw new HttpError(401, 'JWT không do team Cloudflare Access này phát hành (iss)')
  if (typeof payload.exp !== 'number' || payload.exp + 60 < now) throw new HttpError(401, 'Phiên Cloudflare Access đã hết hạn')
  if (typeof payload.nbf === 'number' && payload.nbf - 60 > now) throw new HttpError(401, 'JWT Cloudflare Access chưa có hiệu lực')
  // Service token (cho kiểm tra khói tự động) không có email: định danh bằng service:<Client ID>
  if (typeof payload.email === 'string' && payload.email) return { email: payload.email.toLowerCase() }
  if (typeof payload.common_name === 'string' && payload.common_name) return { email: `service:${payload.common_name.toLowerCase()}` }
  throw new HttpError(401, 'JWT không có email người dùng')
}

const csv = (s: unknown) => (typeof s === 'string' ? s : '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)

// ROLE_MAP: "email=USER_ID,email2=USER_ID2" – gắn cố định email với một người dùng demo
export function roleMap(env: Env): Map<string, string> {
  const m = new Map<string, string>()
  for (const pair of csv(env.ROLE_MAP)) { const [email, id] = pair.split('='); if (email && id) m.set(email.trim(), id.trim().toUpperCase()) }
  return m
}

export const authMode = (env: Env): 'access' | 'dev' => (env.AUTH_MODE === 'dev' ? 'dev' : 'access')

async function loadUser(env: Env, id: string): Promise<User | null> {
  const row = await env.DB.prepare('SELECT data FROM users WHERE id = ?').bind(id).first<{ data: string }>()
  return row ? (JSON.parse(row.data) as User) : null
}

// Danh tính đã xác minh (chưa chọn người dùng): dùng cho /api/users và /api/bootstrap
export async function verifiedEmail(req: Request, env: Env, fetchFn: typeof fetch): Promise<{ email?: string; operator: boolean }> {
  if (authMode(env) === 'dev') return { operator: true }
  const teamDomain = typeof env.ACCESS_TEAM_DOMAIN === 'string' ? env.ACCESS_TEAM_DOMAIN : ''
  const aud = typeof env.ACCESS_AUD === 'string' ? env.ACCESS_AUD : ''
  if (!teamDomain || !aud) throw new HttpError(503, 'Chưa cấu hình Cloudflare Access (ACCESS_TEAM_DOMAIN, ACCESS_AUD); xem README mục Deploy')
  const token = req.headers.get('cf-access-jwt-assertion')
  if (!token) throw new HttpError(401, 'Yêu cầu không đi qua Cloudflare Access')
  const { email } = await verifyAccessJwt(token, { teamDomain, aud, fetchFn })
  return { email, operator: csv(env.DEMO_OPERATORS).includes(email) }
}

export async function authenticate(req: Request, env: Env, fetchFn: typeof fetch): Promise<Identity> {
  const { email, operator } = await verifiedEmail(req, env, fetchFn)
  const requested = req.headers.get('x-demo-user')
  let id: string | null | undefined
  if (operator) id = requested ?? (email ? roleMap(env).get(email) : undefined)
  else {
    id = roleMap(env).get(email!)
    if (!id) throw new HttpError(403, `Email ${email} chưa được gán vai trò (ROLE_MAP) hay quyền chuyển vai trò (DEMO_OPERATORS)`)
    if (requested && requested !== id) throw new HttpError(403, 'Không được chuyển sang vai trò khác với vai trò được gán')
  }
  if (!id) throw new HttpError(401, 'Chưa chọn vai trò đăng nhập')
  const user = await loadUser(env, id)
  if (!user) throw new HttpError(401, `Không có người dùng ${id}`)
  return { user, email, operator }
}

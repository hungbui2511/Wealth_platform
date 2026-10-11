// Xác thực bằng JWT Cloudflare Access (NFR-08): không tin định danh do trình duyệt tự khai
import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/worker/app'
import { createD1 } from './support/d1shim'
import type { Env } from '../src/worker/ctx'

const TEAM = 'https://demo-team.cloudflareaccess.com'
const AUD = 'aud-wealth-mvp1'
const b64url = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url')

let keys: CryptoKeyPair
let otherKeys: CryptoKeyPair
let certs: unknown
async function sign(payload: Record<string, unknown>, kp = keys, kid = 'k1') {
  const h = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })))
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`))
  return `${h}.${p}.${b64url(sig)}`
}
const nowSec = () => Math.floor(Date.now() / 1000)
const claims = (email: string, extra: Record<string, unknown> = {}) => ({ aud: [AUD], iss: TEAM, email, exp: nowSec() + 600, iat: nowSec(), ...extra })

const fetchFn = (async (url: string) => {
  if (String(url) === `${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify(certs), { headers: { 'content-type': 'application/json' } })
  return new Response('not found', { status: 404 })
}) as typeof fetch

const app = createApp({ fetchFn })
const env = {
  DB: createD1(), AGENT_MODE: 'mock', PRICE_MODE: 'sample', AUTH_MODE: 'access',
  ACCESS_TEAM_DOMAIN: 'demo-team.cloudflareaccess.com', ACCESS_AUD: AUD,
  DEMO_OPERATORS: 'operator@example.com, service:smoke.access', ROLE_MAP: 'rm@example.com=RM1,cio@example.com=CIO1',
} as unknown as Env
const req = (path: string, headers: Record<string, string> = {}, method = 'GET') => app.request(path, { method, headers }, env)

beforeAll(async () => {
  const gen = () => crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>
  keys = await gen(); otherKeys = await gen()
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  certs = { keys: [{ kid: 'k1', kty: 'RSA', alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e }] }
  const r = await req('/api/bootstrap', { 'cf-access-jwt-assertion': await sign(claims('operator@example.com')) }, 'POST')
  expect(r.status).toBe(200)
})

describe('Xác thực Cloudflare Access', () => {
  it('từ chối header x-demo-user và ?as= khi không có JWT', async () => {
    expect((await req('/api/me', { 'x-demo-user': 'ADM1' })).status).toBe(401)
    expect((await req('/api/me?as=ADM1')).status).toBe(401)
    expect((await req('/api/users')).status).toBe(401)
  })
  it('từ chối header email Access tự khai mà không có JWT', async () => {
    expect((await req('/api/me', { 'cf-access-authenticated-user-email': 'operator@example.com', 'x-demo-user': 'ADM1' })).status).toBe(401)
  })
  it('từ chối JWT ký sai khóa, sai aud, sai iss, hết hạn', async () => {
    const bad = [
      await sign(claims('operator@example.com'), otherKeys),
      await sign(claims('operator@example.com', { aud: ['khac'] })),
      await sign(claims('operator@example.com', { iss: 'https://evil.cloudflareaccess.com' })),
      await sign(claims('operator@example.com', { exp: nowSec() - 3600 })),
    ]
    for (const t of bad) expect((await req('/api/me', { 'cf-access-jwt-assertion': t, 'x-demo-user': 'ADM1' })).status).toBe(401)
  })
  it('người vận hành demo chuyển được vai trò', async () => {
    const t = await sign(claims('Operator@Example.com'))
    const r = await req('/api/me', { 'cf-access-jwt-assertion': t, 'x-demo-user': 'ADM1' })
    expect(r.status).toBe(200)
    const me = await r.json() as any
    expect(me).toMatchObject({ id: 'ADM1', role: 'ADMIN', email: 'operator@example.com', can_switch: true })
    expect(((await (await req('/api/users', { 'cf-access-jwt-assertion': t })).json()) as any[]).length).toBeGreaterThan(3)
  })
  it('email được gán cố định chỉ dùng vai trò của mình', async () => {
    const t = await sign(claims('rm@example.com'))
    const me = await (await req('/api/me', { 'cf-access-jwt-assertion': t })).json() as any
    expect(me).toMatchObject({ id: 'RM1', role: 'RM', can_switch: false })
    expect((await req('/api/me', { 'cf-access-jwt-assertion': t, 'x-demo-user': 'ADM1' })).status).toBe(403)
    expect((await (await req('/api/users', { 'cf-access-jwt-assertion': t })).json() as any[]).map(u => u.id)).toEqual(['RM1'])
    expect((await req('/api/bootstrap', { 'cf-access-jwt-assertion': t }, 'POST')).status).toBe(403)
  })
  it('email không có trong danh sách bị từ chối', async () => {
    expect((await req('/api/me', { 'cf-access-jwt-assertion': await sign(claims('la@example.com')), 'x-demo-user': 'ADM1' })).status).toBe(403)
  })
  it('service token có trong DEMO_OPERATORS dùng được cho kiểm tra khói', async () => {
    const t = await sign({ aud: AUD, iss: TEAM, common_name: 'smoke.access', exp: nowSec() + 600, sub: '' })
    expect((await req('/api/me', { 'cf-access-jwt-assertion': t, 'x-demo-user': 'CIO1' })).status).toBe(200)
  })
  it('không đặt DEMO_OPERATORS: người đã qua Access được chuyển vai trò, trừ email gắn cố định', async () => {
    const env2 = { ...env, DEMO_OPERATORS: undefined } as unknown as Env
    const r = await app.request('/api/me', { headers: { 'cf-access-jwt-assertion': await sign(claims('khach@example.com')), 'x-demo-user': 'CIO1' } }, env2)
    expect(r.status).toBe(200)
    const fixed = await app.request('/api/me', { headers: { 'cf-access-jwt-assertion': await sign(claims('rm@example.com')), 'x-demo-user': 'ADM1' } }, env2)
    expect(fixed.status).toBe(403)
  })
  it('thiếu cấu hình Access thì đóng (503), không mở', async () => {
    const r = await app.request('/api/me', { headers: { 'x-demo-user': 'ADM1' } }, { ...env, ACCESS_AUD: '' } as Env)
    expect(r.status).toBe(503)
  })
  it('nhật ký ghi email thật của người thao tác', async () => {
    const t = await sign(claims('operator@example.com'))
    const rows = await (await req('/api/audit?limit=5', { 'cf-access-jwt-assertion': t, 'x-demo-user': 'CMP1' })).json() as any[]
    expect(rows.some(r => String(r.actor).includes('<operator@example.com>'))).toBe(true)
  })
})

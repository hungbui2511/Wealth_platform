// BR-27 (3): mọi nội dung văn bản trả cho RM được che tên tổ chức và mã trong danh sách hạn chế đang hiệu lực.
// Chỉ che các trường văn bản tự do; mã định danh (id, instrument_id…) giữ nguyên để giao diện liên kết được.
import { redactRestricted, type RestrictedEntry } from '../../compliance/controls'
import type { AppCtx } from '../ctx'
import { activeRestricted, loadConfigs } from './config'

const TEXT_FIELDS = new Set(['title', 'issuer', 'summary', 'event_title', 'rationale', 'text', 'issue', 'suggestion', 'note', 'cio_note', 'content', 'counter_scenario', 'instructions', 'reason', 'quote'])

function walk(v: unknown, entries: RestrictedEntry[], key?: string): unknown {
  if (typeof v === 'string') return key && TEXT_FIELDS.has(key) ? redactRestricted(v, entries) : v
  if (Array.isArray(v)) return v.map(x => walk(x, entries, key))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, entries, k)]))
  return v
}

export async function redactForRm<T>(ctx: AppCtx, value: T): Promise<T> {
  if (ctx.user.role !== 'RM') return value
  const entries = activeRestricted(await loadConfigs(ctx), ctx.now())
  return entries.length ? (walk(value, entries) as T) : value
}

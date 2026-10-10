// Lớp gọi mô hình (NFR-03): nhà cung cấp và mô hình cấu hình cho từng agent. Chỉ dùng ở AGENT_MODE=live.
import Anthropic from '@anthropic-ai/sdk'
import type { ModelCfg } from './prompts'

export interface LlmResult { json: unknown; raw: string; model: string; usage?: unknown }

export class LlmError extends Error {}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try { return JSON.parse(body) } catch { throw new LlmError('Đầu ra của mô hình không phải JSON hợp lệ') }
}

export async function callJson(env: { ANTHROPIC_API_KEY?: string }, cfg: ModelCfg, system: string, user: string): Promise<LlmResult> {
  if (cfg.provider !== 'anthropic') throw new LlmError(`Nhà cung cấp ${cfg.provider} chưa được cài đặt trong bản demo`)
  if (!env.ANTHROPIC_API_KEY) throw new LlmError('Thiếu ANTHROPIC_API_KEY cho AGENT_MODE=live')
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const res = await client.beta.messages.create({
    model: cfg.model,
    max_tokens: cfg.max_tokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: cfg.effort as 'low' | 'medium' | 'high' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: user }],
  } as never) as unknown as { content: { type: string; text?: string }[]; stop_reason: string; model: string; usage: unknown }
  if (res.stop_reason === 'refusal') throw new LlmError('Mô hình từ chối yêu cầu')
  const raw = res.content.filter(b => b.type === 'text').map(b => b.text).join('')
  return { json: extractJson(raw), raw, model: res.model, usage: res.usage }
}

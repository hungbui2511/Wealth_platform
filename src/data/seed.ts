// Gói dữ liệu mẫu được đóng gói cùng Worker (chế độ PRICE_MODE=sample, AGENT_MODE=mock).
import families from '../../data/seed/families.json'
import goals from '../../data/seed/goals.json'
import instruments from '../../data/seed/instruments.json'
import users from '../../data/seed/users.json'
import news from '../../data/seed/events/news.json'
import events from '../../data/seed/events/events.json'
import whitelist from '../../data/seed/compliance/sources_whitelist.json'
import restricted from '../../data/seed/compliance/restricted_list.json'
import pd1 from '../../data/seed/policies/sample/PD-2026-001.json'
import pd2 from '../../data/seed/policies/sample/PD-2026-002.json'
import provided from '../../data/seed/policies/provided/index.json'
import tcbsStocks from '../../data/seed/prices/tcbs_sample/stocks.json'
import tcbsBonds from '../../data/seed/prices/tcbs_sample/bonds.json'
import onemount from '../../data/seed/prices/onemount_sample/valuations.json'
import sample from '../../data/seed/prices/sample/series.json'
import type { Family, Goal, Instrument } from '../shared/types'
import type { SampleStore } from '../pricing/adapters'

export const SEED = {
  families: families as unknown as Family[],
  goals: goals as unknown as Goal[],
  instruments: instruments as unknown as Instrument[],
  users: users as { id: string; name: string; role: string; families: string[] }[],
  news: news as { id: string; title: string; source: string; url: string; published_at: string; summary: string; language: string; simulated: boolean }[],
  events: events as { id: string; type: string; title: string; news: string[] }[],
  whitelist: whitelist as { domain: string; name: string; note: string }[],
  restricted: restricted as { id: string; issuer: string; instruments: string[]; keywords: string[]; valid_from: string; valid_to: string; reason: string }[],
  policies: [pd1, pd2] as unknown as PolicyDocSeed[],
}

export interface PolicyDocSeed { id: string; title: string; agency: string; kind: 'draft' | 'final'; status: string; published_at: string; effective_expected?: string; url: string; topics: string[]; content: string; simulated: boolean }

export const PROVIDED_POLICIES = provided as unknown as PolicyDocSeed[]

export const SAMPLE_STORE = { tcbsStocks, tcbsBonds, onemount, sample } as unknown as SampleStore

export const SESSIONS: string[] = (sample as unknown as SampleStore['sample']).series['IDX:DEMO-INDEX'].map(b => b.date)
export const PRICE_DATE = SESSIONS[SESSIONS.length - 1]

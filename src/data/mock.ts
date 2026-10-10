// Đầu ra ghi sẵn cho AGENT_MODE=mock (BRD Mục 11.4)
import c1 from '../../data/mock_agent/cio/EV-2026-0001.json'
import c2 from '../../data/mock_agent/cio/EV-2026-0002.json'
import c3 from '../../data/mock_agent/cio/EV-2026-0003.json'
import c4 from '../../data/mock_agent/cio/EV-2026-0004.json'
import c5 from '../../data/mock_agent/cio/EV-2026-0005.json'
import c6 from '../../data/mock_agent/cio/EV-2026-0006.json'
import cp1 from '../../data/mock_agent/cio/policy-PD-2026-001.json'
import cp2 from '../../data/mock_agent/cio/policy-PD-2026-002.json'
import h1 from '../../data/mock_agent/challenger/EV-2026-0001.json'
import h2 from '../../data/mock_agent/challenger/EV-2026-0002.json'
import h3 from '../../data/mock_agent/challenger/EV-2026-0003.json'
import h4 from '../../data/mock_agent/challenger/EV-2026-0004.json'
import h5 from '../../data/mock_agent/challenger/EV-2026-0005.json'
import h6 from '../../data/mock_agent/challenger/EV-2026-0006.json'
import hp1 from '../../data/mock_agent/challenger/policy-PD-2026-001.json'
import hp2 from '../../data/mock_agent/challenger/policy-PD-2026-002.json'
import p1 from '../../data/mock_agent/policy/PD-2026-001.json'
import p2 from '../../data/mock_agent/policy/PD-2026-002.json'
import interp from '../../data/mock_agent/interpretation.json'

export interface MockCio { v1: { view: Record<string, unknown>; nodes: Record<string, unknown> }; v2?: { view: Record<string, unknown>; nodes: Record<string, unknown> } }
export interface MockChallenger { pre: { findings: Record<string, unknown>[]; counter_scenario: string }; pre_v2?: { findings: Record<string, unknown>[]; counter_scenario: string }; re_challenge?: Record<string, Record<string, unknown>[]> }

export const MOCK = {
  cio: { 'EV-2026-0001': c1, 'EV-2026-0002': c2, 'EV-2026-0003': c3, 'EV-2026-0004': c4, 'EV-2026-0005': c5, 'EV-2026-0006': c6, 'policy-PD-2026-001': cp1, 'policy-PD-2026-002': cp2 } as unknown as Record<string, MockCio>,
  challenger: { 'EV-2026-0001': h1, 'EV-2026-0002': h2, 'EV-2026-0003': h3, 'EV-2026-0004': h4, 'EV-2026-0005': h5, 'EV-2026-0006': h6, 'policy-PD-2026-001': hp1, 'policy-PD-2026-002': hp2 } as unknown as Record<string, MockChallenger>,
  policy: { 'PD-2026-001': p1, 'PD-2026-002': p2 } as Record<string, unknown>,
  interpretation: interp as { inject: Record<string, string> },
}

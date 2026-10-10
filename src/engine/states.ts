// Máy trạng thái (Mục 6.4). Mọi chuyển trạng thái không có trong bảng đều bị từ chối.

export const VIEW_TRANSITIONS: Record<string, string[]> = {
  DRAFTING: ['AGENT_ERROR', 'PENDING_CHALLENGE'],
  PENDING_CHALLENGE: ['PENDING_APPROVAL'],
  PENDING_APPROVAL: ['PENDING_CHALLENGE', 'APPROVED', 'REWORK_REQUESTED', 'REJECTED'],
  APPROVED: ['SUPERSEDED', 'WITHDRAWN'],
  AGENT_ERROR: [], REWORK_REQUESTED: [], REJECTED: [], SUPERSEDED: [], WITHDRAWN: [],
}

export const RUN_TRANSITIONS: Record<string, string[]> = {
  COMPUTING: ['FAILED', 'POST_CHECKING'],
  POST_CHECKING: ['EFFECTIVE', 'NEEDS_CIO_REVIEW'],
  NEEDS_CIO_REVIEW: ['EFFECTIVE', 'WITHDRAWN'],
  EFFECTIVE: ['SUPERSEDED', 'WITHDRAWN'],
  FAILED: [], SUPERSEDED: [], WITHDRAWN: [],
}

export class TransitionError extends Error {
  status = 409
  constructor(kind: string, from: string, to: string) { super(`Chuyển trạng thái ${kind} không hợp lệ: ${from} → ${to}`) }
}

export function assertTransition(table: Record<string, string[]>, kind: string, from: string, to: string): void {
  if (!(table[from] ?? []).includes(to)) throw new TransitionError(kind, from, to)
}
export const assertViewTransition = (from: string, to: string) => assertTransition(VIEW_TRANSITIONS, 'nhận định', from, to)
export const assertRunTransition = (from: string, to: string) => assertTransition(RUN_TRANSITIONS, 'lần áp dụng', from, to)

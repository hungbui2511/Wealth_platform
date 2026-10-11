// Cấp mã cho bản ghi mới. Mọi số thứ tự đi qua bộ đếm nguyên tử (Repo.nextSeq), không đếm-rồi-cộng-một,
// để hai yêu cầu song song không nhận trùng mã (bản ghi mới ghi bằng insert nên trùng mã thì lỗi, không ghi đè).
import type { AppCtx } from './ctx'

export const evNum = (eventId: string) => eventId.slice(-4)

export const nextViewVersion = (ctx: AppCtx, eventId: string) =>
  ctx.repo.nextSeq(`view:${eventId}`, 'SELECT max(version) FROM views WHERE event_id = ?', [eventId])

export const nextChallengeNo = (ctx: AppCtx, viewId: string, stage: string) =>
  ctx.repo.nextSeq(`challenge:${viewId}:${stage}`, 'SELECT count(*) FROM challenges WHERE view_id = ? AND stage = ?', [viewId, stage])

export const nextRunNo = (ctx: AppCtx, viewId: string) =>
  ctx.repo.nextSeq(`run:${viewId}`, 'SELECT count(*) FROM application_runs WHERE view_id = ?', [viewId])

export const familyImpactId = (runId: string, familyId: string) => `${runId}|${familyId}`

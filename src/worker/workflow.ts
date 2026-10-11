// Cloudflare Workflows: chạy một tác vụ agent (chế độ live) ngoài vòng đời yêu cầu HTTP.
// Mỗi tác vụ là một bước duy nhất, không tự thử lại: bản thân tác vụ ghi trạng thái lỗi (FAILED, AGENT_ERROR)
// để CIO quyết định chạy lại, tránh gọi mô hình hai lần cho cùng một yêu cầu.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import type { Env } from './ctx'
import { executeJob } from './services/jobs'

export class AgentJobs extends WorkflowEntrypoint<Env, { jobId: string }> {
  async run(event: Readonly<WorkflowEvent<{ jobId: string }>>, step: WorkflowStep) {
    return await step.do('chạy tác vụ agent', { retries: { limit: 0, delay: '1 second' }, timeout: '20 minutes' }, async () => {
      const j = await executeJob(this.env, event.payload.jobId)
      return { id: j.id, status: j.status }
    })
  }
}

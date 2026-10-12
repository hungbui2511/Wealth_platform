// Gọi API kèm người dùng demo đã chọn (localStorage bọc try/catch)
export function getUserId(): string | null { try { return localStorage.getItem('demo-user') } catch { return null } }
export function setUserId(id: string | null) { try { id ? localStorage.setItem('demo-user', id) : localStorage.removeItem('demo-user') } catch { /* trình duyệt chặn lưu trữ */ } }

export class ApiError extends Error { constructor(public status: number, message: string, public details?: unknown) { super(message) } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const uid = getUserId()
  const res = await fetch(path, { method: opts.method ?? 'GET', headers: { 'content-type': 'application/json', ...(uid ? { 'x-demo-user': uid } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  const text = await res.text()
  let data: any = text
  try { data = JSON.parse(text) } catch { /* văn bản */ }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Lỗi ${res.status}`, data?.details)
  return data as T
}

// Tải file qua API (gửi kèm header vai trò; không đưa định danh lên URL)
export async function download(path: string, filename: string) {
  const uid = getUserId()
  const res = await fetch(path, { headers: uid ? { 'x-demo-user': uid } : {} })
  if (!res.ok) throw new ApiError(res.status, `Lỗi ${res.status}`)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Thao tác chạy agent: ở chế độ live máy chủ trả về tác vụ chạy nền ({ job }); hàm này theo dõi tới khi xong
// rồi trả kết quả của tác vụ. Ở chế độ mock máy chủ trả kết quả ngay, hàm trả nguyên kết quả đó.
export const STEP_LABEL: Record<string, string> = {
  analyst_macro: 'Nhóm Vĩ mô và lãi suất', analyst_equity: 'Nhóm Cổ phiếu và quỹ', analyst_credit_re: 'Nhóm Tín dụng và bất động sản', analyst_commodity: 'Nhóm Hàng hóa và tài sản khác',
  debate: 'Tranh luận tăng/giảm', synthesize: 'Tổng hợp nhận định', challenger_pre: 'Agent Phản biện', challenger_re: 'Agent Phản biện lại', policy: 'Agent Chính sách đọc văn bản', done: 'Hoàn tất',
}
export function stepLabel(s: string) { const [k, n] = s.split('#'); return (STEP_LABEL[k] ?? k) + (n ? ` (lần ${n})` : '') }
export async function apiJob<T = any>(path: string, opts: { method?: string; body?: unknown } = {}, onProgress?: (job: any) => void): Promise<T> {
  const first = await api<any>(path, opts)
  if (!first?.job) return first as T
  let job = first.job
  // Chế độ external: yêu cầu đã ghi, Claude phân tích ở lần đồng bộ kế tiếp; không chờ trên trình duyệt
  if (job.status === 'WAITING_EXTERNAL') return { job, waiting: true } as T
  const startedAt = Date.now()
  while (job.status === 'QUEUED' || job.status === 'RUNNING') {
    onProgress?.(job)
    if (Date.now() - startedAt > 25 * 60 * 1000) throw new ApiError(504, 'Tác vụ chạy quá lâu; xem lại ở mục Tác vụ AI')
    await new Promise(r => setTimeout(r, 3000))
    job = await api(`/api/jobs/${job.id}`)
  }
  onProgress?.(job)
  if (job.status === 'FAILED') throw new ApiError(500, job.error ?? 'Tác vụ agent lỗi')
  return { ...(first.decision ? { decision: first.decision, view: first.view } : {}), ...job.result, job } as T
}

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

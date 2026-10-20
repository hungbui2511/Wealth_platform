// Tuân thủ xác nhận nguồn và nội dung văn bản: lấy mã băm của bản đang lưu trên radar rồi gửi kèm (đợt 3)
export async function confirmPolicy(h: { ok: (u: string, m: string, p: string, b?: unknown) => Promise<any> }, id: string, note: string, user = 'CMP1') {
  const d = (await h.ok(user, 'GET', '/api/policies')).documents.find((x: any) => x.id === id)
  return h.ok(user, 'POST', `/api/policies/${id}/confirm-source`, { note, content_checked: true, content_hash: d.content_hash })
}

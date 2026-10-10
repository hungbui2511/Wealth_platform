import { useState } from 'react'
import { api } from '../api'
import { useUser } from '../App'
import { Badge, Btn, Card, ErrorBox, Loading, Note, ts, useApi } from '../ui'

const ST: Record<string, [string, string]> = { DRAFT: ['low', 'Nháp'], PENDING_COMPLIANCE: ['amber', 'Chờ Tuân thủ'], APPROVED: ['green', 'Đã duyệt phát hành'], REJECTED: ['red', 'Bị từ chối'] }
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

export default function Releases() {
  const user = useUser()
  const { data, error, reload } = useApi<any[]>('/api/releases')
  const views = useApi<any[]>(user.role === 'CIO' ? '/api/views' : null)
  const [err, setErr] = useState<unknown>(null)
  const [form, setForm] = useState<any>(null)
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const act = (fn: () => Promise<unknown>) => async () => { setErr(null); try { await fn(); reload() } catch (e) { setErr(e) } }
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const approved = (views.data ?? []).filter(v => ['APPROVED', 'SUPERSEDED'].includes(v.status))
  return (
    <>
      <div className="flex justify-between items-center flex-wrap gap-2"><h1 className="text-xl font-semibold">Bản tin CIO</h1>{user.role === 'CIO' && <Btn onClick={() => setForm({ view_id: approved[0]?.id ?? '', release_private_at: local(new Date(Date.now() + 3600e3)), release_public_at: local(new Date(Date.now() + 5 * 3600e3)) })}>Tạo bản tin</Btn>}</div>
      <Note>Nội dung chung, không chứa dữ liệu gia đình. Hai mốc phát hành: khách Private sớm hơn đại chúng. Bản tin qua kiểm tra số (BR-13), cụm từ cấm (BR-14), danh sách hạn chế (BR-27) và cần Tuân thủ duyệt. MVP1 chỉ lưu lịch và xem trước – không có chức năng gửi.</Note>
      <ErrorBox error={err} />
      {form && <Card title="Tạo bản tin từ nhận định đã duyệt">
        <div className="grid md:grid-cols-3 gap-3 text-sm">
          <label className="flex flex-col gap-1">Nhận định<select value={form.view_id} onChange={e => setForm({ ...form, view_id: e.target.value })}>{approved.map(v => <option key={v.id} value={v.id}>{v.id} – {v.body.summary}</option>)}</select></label>
          <label className="flex flex-col gap-1">Phát hành cho khách Private<input type="datetime-local" value={form.release_private_at} onChange={e => setForm({ ...form, release_private_at: e.target.value })} /></label>
          <label className="flex flex-col gap-1">Phát hành đại chúng<input type="datetime-local" value={form.release_public_at} onChange={e => setForm({ ...form, release_public_at: e.target.value })} /></label>
        </div>
        <div className="flex gap-2 mt-3"><Btn disabled={!form.view_id} onClick={act(async () => { await api('/api/releases', { method: 'POST', body: { ...form, release_private_at: new Date(form.release_private_at).toISOString(), release_public_at: new Date(form.release_public_at).toISOString() } }); setForm(null) })}>Tạo bản nháp</Btn><Btn kind="secondary" onClick={() => setForm(null)}>Hủy</Btn></div>
      </Card>}
      {data.map(r => (
        <Card key={r.id} title={<span className="flex items-center gap-2"><span className="mono">{r.id}</span><Badge tone={ST[r.status][0]}>{ST[r.status][1]}</Badge><span className="text-fgm text-sm mono">{r.view_id}</span></span>}>
          <div className="text-[13px] text-fgm mb-2">Private: <b className="text-fg">{ts(r.release_private_at)}</b> · Đại chúng: <b className="text-fg">{ts(r.release_public_at)}</b>{r.reviewed_by && ` · ${r.reviewed_by}: ${r.review_note}`}</div>
          {user.role === 'CIO' && ['DRAFT', 'REJECTED'].includes(r.status) ? <textarea rows={6} className="w-full mono" value={edit[r.id] ?? r.content} onChange={e => setEdit({ ...edit, [r.id]: e.target.value })} /> : <pre className="whitespace-pre-wrap text-[13px] bg-muted rounded p-3">{r.content}</pre>}
          {r.checks && <div className="mt-2 text-[13px]">{r.checks.ok ? <Badge tone="green">Qua kiểm tra BR-13, BR-14, BR-27</Badge> : <Badge tone="red">Vi phạm: {[...r.checks.violations.map((v: any) => `"${v.text}"`), ...(r.checks.restricted.length ? ['nhắc tổ chức hạn chế'] : []), ...(r.checks.family_data ? ['có dữ liệu gia đình'] : [])].join(', ')}</Badge>}</div>}
          <div className="flex flex-wrap gap-2 mt-3">
            {user.role === 'CIO' && ['DRAFT', 'REJECTED'].includes(r.status) && <Btn kind="secondary" onClick={act(() => api(`/api/releases/${r.id}`, { method: 'PUT', body: { content: edit[r.id] ?? r.content } }))}>Lưu và kiểm tra</Btn>}
            {user.role === 'CIO' && r.status === 'DRAFT' && <Btn onClick={act(() => api(`/api/releases/${r.id}/submit`, { method: 'POST' }))}>Gửi Tuân thủ duyệt</Btn>}
            {user.role === 'COMPLIANCE' && r.status === 'PENDING_COMPLIANCE' && <><input className="flex-1" placeholder="Ghi chú duyệt (tối thiểu 20 ký tự)" value={note} onChange={e => setNote(e.target.value)} /><Btn onClick={act(() => api(`/api/releases/${r.id}/review`, { method: 'POST', body: { approve: true, note } }))}>Duyệt phát hành</Btn><Btn kind="danger" onClick={act(() => api(`/api/releases/${r.id}/review`, { method: 'POST', body: { approve: false, note } }))}>Từ chối</Btn></>}
          </div>
        </Card>
      ))}
    </>
  )
}

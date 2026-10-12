import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, apiJob } from '../api'
import { useNavigate } from 'react-router-dom'
import NewsInbox from './NewsInbox'
import { useUser } from '../App'
import { Badge, Btn, Card, ErrorBox, Loading, Note, StatusBadge, ts, useApi } from '../ui'

const TYPES: Record<string, string> = { monetary_policy: 'Chính sách tiền tệ', fiscal_tax: 'Tài khóa và thuế', sector_regulation: 'Quy định ngành', corporate: 'Doanh nghiệp', global_macro: 'Vĩ mô quốc tế', commodity: 'Hàng hóa', fx: 'Tỷ giá', geopolitical: 'Địa chính trị', policy: 'Văn bản chính sách' }

export default function Events() {
  const user = useUser()
  const { data, error, reload } = useApi<any[]>('/api/events')
  const [open, setOpen] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [form, setForm] = useState<any>(null)
  const [info, setInfo] = useState<string | null>(null)
  const navigate = useNavigate()
  const act = (fn: () => Promise<unknown>) => async () => { setErr(null); try { await fn(); reload() } catch (e) { setErr(e) } }
  return (
    <>
      <div className="flex justify-between items-center flex-wrap gap-2"><h1 className="text-xl font-semibold">Sự kiện, tin tức</h1>
        {user.role === 'ADMIN' && <div className="flex gap-2"><Btn kind="secondary" onClick={act(() => api('/api/admin/load-sample-events', { method: 'POST' }))}>Nạp gói sự kiện mẫu</Btn><Btn onClick={() => setForm({ type: 'corporate', title: '', items: [{ title: '[TIN GIẢ LẬP] ', url: 'https://', published_at: new Date().toISOString().slice(0, 16), summary: '' }] })}>Dán tin thủ công</Btn></div>}
      </div>
      {(user.role === 'CIO' || user.role === 'ADMIN' || user.role === 'COMPLIANCE') && <NewsInbox onCreated={reload} />}
      <Note>Sự kiện được lập từ tin lấy tự động (hộp tin mới), gói mẫu hoặc tin dán tay. Mọi tin phải có đường dẫn công khai thuộc danh sách nguồn công khai và thời điểm công bố không muộn hơn lúc nạp (BR-26). Tin nhắc tới tổ chức trong danh sách hạn chế phải chờ Tuân thủ cho phép (BR-27).</Note>
      <ErrorBox error={err} />
      {info && <Note>{info}</Note>}
      {form && (
        <Card title="Dán tin thủ công">
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-3"><label className="flex flex-col gap-1">Loại sự kiện<select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>{Object.entries(TYPES).filter(([k]) => k !== 'policy').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label className="flex flex-col gap-1 flex-1">Tiêu đề sự kiện (tùy chọn)<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label></div>
            {form.items.map((it: any, i: number) => (
              <div key={i} className="border border-border rounded-md p-2 grid md:grid-cols-2 gap-2">
                {(['title', 'url', 'published_at', 'summary'] as const).map(k => <label key={k} className={`flex flex-col gap-1 ${k === 'summary' ? 'md:col-span-2' : ''}`}>{{ title: 'Tiêu đề', url: 'Đường dẫn công khai', published_at: 'Thời điểm công bố', summary: 'Tóm tắt (chỉ lưu tóm tắt và đường dẫn)' }[k]}{k === 'summary' ? <textarea rows={2} value={it[k]} onChange={e => { const a = [...form.items]; a[i] = { ...it, [k]: e.target.value }; setForm({ ...form, items: a }) }} /> : <input type={k === 'published_at' ? 'datetime-local' : 'text'} value={it[k]} onChange={e => { const a = [...form.items]; a[i] = { ...it, [k]: e.target.value }; setForm({ ...form, items: a }) }} />}</label>)}
              </div>
            ))}
            <div className="flex gap-2"><Btn small kind="ghost" onClick={() => setForm({ ...form, items: [...form.items, { title: '', url: 'https://', published_at: new Date().toISOString().slice(0, 16), summary: '' }] })}>+ Thêm tin</Btn></div>
            <div className="flex gap-2"><Btn onClick={act(async () => { await api('/api/events', { method: 'POST', body: { ...form, items: form.items.map((x: any) => ({ ...x, published_at: x.published_at ? new Date(x.published_at).toISOString() : '' })) } }); setForm(null) })}>Tạo sự kiện</Btn><Btn kind="secondary" onClick={() => setForm(null)}>Hủy</Btn></div>
          </div>
        </Card>
      )}
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : (
        <Card>
          <table className="t">
            <thead><tr><th>Sự kiện</th><th>Loại</th><th>Công bố / tạo</th><th>Nhận định</th><th>Lần áp dụng</th><th /></tr></thead>
            <tbody>{data.map(e => (
              <Fragment key={e.id}>
                <tr>
                  <td><button className="text-primary hover:underline mono" onClick={() => setOpen(open === e.id ? null : e.id)}>{e.id}</button><div>{e.title}</div>{e.hold && <Badge tone={e.hold.status === 'PENDING' ? 'amber' : 'green'}>{e.hold.status === 'PENDING' ? 'Chờ Tuân thủ cho phép (danh sách hạn chế)' : 'Tuân thủ đã cho phép'}</Badge>}</td>
                  <td>{TYPES[e.type]}</td>
                  <td className="text-xs">{ts(e.timestamps.published_at)}<div className="text-fgm">{ts(e.timestamps.event_created_at)}</div></td>
                  <td>{e.views.map((v: any) => <div key={v.id}><Link to={`/views/${v.id}`} className="text-primary mono hover:underline">{v.id}</Link> <StatusBadge s={v.status} /></div>)}</td>
                  <td>{e.runs.map((r: any) => <div key={r.id}><Link to={`/runs/${r.id}`} className="text-primary mono hover:underline">{r.id}</Link> <StatusBadge s={r.status} /></div>)}</td>
                  <td><div className="flex flex-col gap-1 items-start">
                    {(user.role === 'CIO' || user.role === 'ADMIN') && <Btn small onClick={act(async () => { const v: any = await apiJob(`/api/events/${e.id}/run-agent`, { method: 'POST' }); if (v?.waiting) { setInfo(`Đã gửi yêu cầu phân tích ${e.id} cho Claude (${v.job.id}). Kết quả vào hệ thống ở lần đồng bộ kế tiếp, CIO sẽ thấy nhận định ở Bàn duyệt.`); return } const id = v?.view_id ?? v?.id; if (id) navigate(`/views/${id}`) })}>Chạy Agent CIO</Btn>}
                    {user.role === 'COMPLIANCE' && e.hold?.status === 'PENDING' && <Btn small onClick={act(() => api(`/api/events/${e.id}/allow`, { method: 'POST', body: { note: 'Thông tin đã được công bố công khai' } }))}>Cho phép chạy agent</Btn>}
                  </div></td>
                </tr>
                {open === e.id && <tr><td colSpan={6}><EventNews id={e.id} /></td></tr>}
              </Fragment>
            ))}</tbody>
          </table>
        </Card>
      )}
    </>
  )
}

function EventNews({ id }: { id: string }) {
  const { data } = useApi(`/api/events/${id}`)
  if (!data) return <Loading />
  return <ul className="space-y-2 py-1">{data.news.map((n: any) => <li key={n.id} className="text-[13px]"><span className="mono text-fgm">{n.id}</span> <b>{n.title}</b> <a className="text-primary hover:underline" href={n.url} target="_blank" rel="noreferrer">{n.source}</a> <span className="text-fgm">· công bố {ts(n.published_at)} · nạp {ts(n.ingested_at)}</span><div className="text-fgm">{n.summary}</div></li>)}</ul>
}

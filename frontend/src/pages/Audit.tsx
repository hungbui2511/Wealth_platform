import { Fragment, useState } from 'react'
import { api, download } from '../api'
import { useUser } from '../App'
import { Badge, Btn, Card, ErrorBox, Loading, ts, useApi } from '../ui'

export default function Audit() {
  const user = useUser()
  const [action, setAction] = useState('')
  const [object, setObject] = useState('')
  const q = new URLSearchParams({ limit: '300', ...(action ? { action } : {}), ...(object ? { object } : {}) }).toString()
  const { data, error } = useApi<any[]>(`/api/audit?${q}`)
  const [verify, setVerify] = useState<any>(null)
  const [open, setOpen] = useState<number | null>(null)
  return (
    <>
      <h1 className="text-xl font-semibold">Nhật ký chỉ ghi thêm</h1>
      <p className="text-fgm text-[13px]">Trigger D1 từ chối UPDATE và DELETE; mỗi bản ghi chứa mã băm của bản ghi trước. {user.role !== 'COMPLIANCE' && 'Chi tiết đầy đủ chỉ Tuân thủ xem được.'}</p>
      <div className="flex flex-wrap gap-2 items-center">
        <input placeholder="Lọc hành động (ví dụ decision., agent., run.)" value={action} onChange={e => setAction(e.target.value)} />
        <input placeholder="Đối tượng (ví dụ VW-0002-v1)" value={object} onChange={e => setObject(e.target.value)} />
        {(user.role === 'COMPLIANCE' || user.role === 'ADMIN') && <Btn kind="secondary" onClick={async () => setVerify(await api('/api/audit/verify'))}>Kiểm tra chuỗi mã băm</Btn>}
        {user.role === 'COMPLIANCE' && <><Btn kind="secondary" onClick={() => download('/api/audit/export?format=csv', 'audit_log.csv')}>Xuất CSV</Btn><Btn kind="secondary" onClick={() => download('/api/audit/export?format=json', 'audit_log.json')}>Xuất JSON</Btn></>}
        {verify && (verify.ok ? <Badge tone="green">Chuỗi hợp lệ – {verify.count} bản ghi</Badge> : <Badge tone="red">Chuỗi bị phá ở bản ghi {verify.broken_at}</Badge>)}
      </div>
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : (
        <Card><div className="overflow-x-auto"><table className="t"><thead><tr><th>#</th><th>Thời điểm</th><th>Tác nhân</th><th>Hành động</th><th>Đối tượng</th><th>Mã băm</th></tr></thead>
          <tbody>{data.map(r => <Fragment key={r.seq}>
            <tr onClick={() => setOpen(open === r.seq ? null : r.seq)} className="cursor-pointer"><td className="num">{r.seq}</td><td className="text-xs">{ts(r.ts)}</td><td className="text-xs">{r.actor}</td><td className="mono">{r.action}</td><td className="mono text-xs">{r.object}</td><td className="mono text-xs text-fgm" title={`trước: ${r.prev_hash}`}>{r.hash.slice(0, 12)}…</td></tr>
            {open === r.seq && <tr><td colSpan={6}><pre className="text-xs whitespace-pre-wrap bg-muted p-2 rounded max-h-80 overflow-auto">{(() => { try { return JSON.stringify(JSON.parse(r.data), null, 1) } catch { return r.data } })()}</pre></td></tr>}
          </Fragment>)}</tbody></table></div></Card>
      )}
    </>
  )
}

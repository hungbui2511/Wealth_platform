// Quản lý cấu hình có phiên bản (BR-06, FR-508, FR-804, FR-1009)
import { useState } from 'react'
import { api } from '../api'
import { ROLE_LABEL, useUser } from '../App'
import { Badge, Btn, Card, ErrorBox, Loading, Note, ts, useApi } from '../ui'

const ST: Record<string, [string, string]> = { ACTIVE: ['green', 'Đang hiệu lực'], SUPERSEDED: ['low', 'Đã thay'], PENDING_CONFIRM: ['amber', 'Chờ Tuân thủ xác nhận'], REJECTED: ['red', 'Bị từ chối'] }

export default function Config() {
  const user = useUser()
  const { data, error, reload } = useApi('/api/config')
  const [kind, setKind] = useState('UNIT')
  const [draft, setDraft] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<unknown>(null)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const meta = data.kinds[kind]
  const versions = data.versions.filter((v: any) => v.kind === kind)
  const active = versions.find((v: any) => v.status === 'ACTIVE')
  const canEdit = user.role === meta.owner
  const act = (fn: () => Promise<unknown>) => async () => { setErr(null); try { await fn(); setDraft(null); setReason(''); reload() } catch (e) { setErr(e) } }
  return (
    <>
      <h1 className="text-xl font-semibold">Cấu hình có phiên bản</h1>
      <Note>Mọi thay đổi tạo phiên bản mới, không sửa đè, lý do tối thiểu 20 ký tự và được ghi nhật ký. CIO sở hữu bảng u, ngưỡng và giả định dài hạn; Tuân thủ sở hữu cụm từ cấm, nguồn công khai, danh sách hạn chế; Quản trị đề xuất prompt và mô hình, chỉ có hiệu lực sau khi Tuân thủ xác nhận.</Note>
      <ErrorBox error={err} />
      <div className="flex flex-wrap gap-1">{Object.entries(data.kinds).map(([k, m]: any) => <button key={k} onClick={() => { setKind(k); setDraft(null) }} className={`px-2.5 py-1 rounded-md text-[13px] border ${kind === k ? 'border-primary text-fg' : 'border-border text-fgm'}`}>{m.label}</button>)}</div>
      <Card title={meta.label} actions={<><Badge>Chủ sở hữu: {ROLE_LABEL[meta.owner]}</Badge>{meta.twoPerson && <Badge tone="amber">Quy trình hai người</Badge>}{canEdit && draft === null && <Btn small onClick={() => setDraft(JSON.stringify(active?.content ?? null, null, 2))}>Đề xuất phiên bản mới</Btn>}</>}>
        {kind === 'UNIT' && active && draft === null && <UnitTable c={active.content} />}
        {draft !== null ? (
          <div className="space-y-2">
            <textarea rows={18} className="w-full mono" value={draft} onChange={e => setDraft(e.target.value)} />
            <input className="w-full" placeholder="Lý do thay đổi (tối thiểu 20 ký tự)" value={reason} onChange={e => setReason(e.target.value)} />
            <div className="flex gap-2"><Btn onClick={act(async () => { let content; try { content = JSON.parse(draft) } catch { throw { message: 'JSON không hợp lệ' } } await api(`/api/config/${kind}`, { method: 'POST', body: { content, reason } }) })}>{meta.twoPerson ? 'Gửi đề xuất' : 'Lưu phiên bản mới'}</Btn><Btn kind="secondary" onClick={() => setDraft(null)}>Hủy</Btn></div>
          </div>
        ) : kind !== 'UNIT' && <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-96 whitespace-pre-wrap">{JSON.stringify(active?.content, null, 2)}</pre>}
      </Card>
      <Card title="Lịch sử phiên bản">
        <table className="t"><thead><tr><th>Phiên bản</th><th>Trạng thái</th><th>Đề xuất</th><th>Xác nhận</th><th>Lý do</th><th /></tr></thead>
          <tbody>{versions.map((v: any) => <tr key={v.id}><td className="mono">{v.id}</td><td><Badge tone={ST[v.status][0]}>{ST[v.status][1]}</Badge></td><td className="text-xs">{v.proposed_by}<div className="text-fgm">{ts(v.created_at)}</div></td><td className="text-xs">{v.confirmed_by ?? '—'}<div className="text-fgm">{ts(v.confirmed_at)}</div></td><td className="text-xs">{v.reason}</td>
            <td>{user.role === 'COMPLIANCE' && v.status === 'PENDING_CONFIRM' && <div className="flex flex-col gap-1"><input placeholder="Lý do xác nhận (≥ 20 ký tự)" value={reason} onChange={e => setReason(e.target.value)} /><div className="flex gap-1"><Btn small onClick={act(() => api(`/api/config/versions/${v.id}/decision`, { method: 'POST', body: { approve: true, reason } }))}>Xác nhận</Btn><Btn small kind="danger" onClick={act(() => api(`/api/config/versions/${v.id}/decision`, { method: 'POST', body: { approve: false, reason } }))}>Từ chối</Btn></div></div>}</td></tr>)}</tbody></table>
      </Card>
    </>
  )
}

function UnitTable({ c }: { c: any }) {
  return <div className="grid md:grid-cols-2 gap-4 text-[13px]"><table className="t"><thead><tr><th>Loại tài sản</th><th className="num">u</th></tr></thead><tbody>{Object.entries(c.u).map(([k, v]: any) => <tr key={k}><td className="mono">{k}</td><td className="num">{(Number(v) * 100).toFixed(1).replace('.', ',')}%</td></tr>)}</tbody></table><table className="t"><thead><tr><th>Cặp tiền</th><th className="num">u_fx</th></tr></thead><tbody>{Object.entries(c.u_fx).map(([k, v]: any) => <tr key={k}><td className="mono">{k}/VND</td><td className="num">{(Number(v) * 100).toFixed(1).replace('.', ',')}%</td></tr>)}</tbody></table><p className="text-fgm md:col-span-2">Cú sốc = mức độ × đơn vị. Giá trị khởi tạo chỉ để minh họa, không dựa trên dữ liệu lịch sử và không phải quan điểm đầu tư.</p></div>
}

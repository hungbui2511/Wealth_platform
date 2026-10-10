import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '../App'
import { AlertBadge, Badge, Card, DISCLAIMER, ErrorBox, fmtPct, Loading, Money, Note, StatusBadge, useApi } from '../ui'

export default function Families() {
  const user = useUser()
  const [event, setEvent] = useState('')
  const [alert, setAlert] = useState('')
  const q = new URLSearchParams({ ...(event ? { event } : {}), ...(alert ? { alert } : {}) }).toString()
  const { data, error, loading } = useApi<any[]>(`/api/families${q ? '?' + q : ''}`)
  const all = useApi<any[]>('/api/families')
  const events = [...new Map<string, string>((all.data ?? []).flatMap(f => f.results.map((r: any) => [r.event_id, r.event_title] as [string, string]))).entries()]
  return (
    <>
      <h1 className="text-xl font-semibold">Gia đình {user.role === 'RM' && <span className="text-fgm text-base font-normal">– {user.name}</span>}</h1>
      <Note>{DISCLAIMER}. {user.role === 'RM' ? 'RM chỉ thấy kết quả đã qua hậu kiểm (đang hiệu lực; đã thay thế hoặc thu hồi hiển thị kèm nhãn).' : ''} Không cộng dồn tác động nhiều sự kiện.</Note>
      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-fgm text-sm">Sự kiện <select value={event} onChange={e => setEvent(e.target.value)}><option value="">Tất cả</option>{events.map(([id, t]) => <option key={id} value={id}>{id} – {t}</option>)}</select></label>
        <label className="text-fgm text-sm">Mức cảnh báo <select value={alert} onChange={e => setAlert(e.target.value)}><option value="">Tất cả</option><option value="RED">Đỏ</option><option value="YELLOW">Vàng</option><option value="GREEN">Xanh</option><option value="POSITIVE">Tích cực</option></select></label>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="t">
              <thead><tr><th>Gia đình</th><th>Chân dung</th><th>RM</th><th>Kết quả theo sự kiện</th><th>Mục tiêu</th></tr></thead>
              <tbody>
                {(data ?? []).map(f => (
                  <tr key={f.id}>
                    <td><Link className="text-primary hover:underline" to={`/families/${f.id}`}><span className="mono">{f.id}</span></Link><div className="text-fgm text-xs">{f.name}</div></td>
                    <td>{f.persona}</td><td>{f.rm_id}</td>
                    <td>
                      {f.results.length === 0 ? <span className="text-fgm">Chưa có kết quả hiệu lực</span> : (
                        <div className="space-y-1">{f.results.map((r: any) => (
                          <div key={r.run_id} className="flex flex-wrap items-center gap-2">
                            <span className="mono text-fgm">{r.event_id}</span><AlertBadge level={r.alert} />
                            <Money v={r.impact} short /><span className="num text-fgm">{fmtPct(r.pct, 3)}</span>
                            {r.status !== 'EFFECTIVE' && <StatusBadge s={r.status} />}
                          </div>
                        ))}</div>
                      )}
                    </td>
                    <td>{f.goal_alerts.length ? f.goal_alerts.map((g: any, i: number) => <Badge key={i} tone="amber">{g.goal}: {Number(g.delta_pts).toFixed(2).replace('.', ',')} điểm</Badge>) : <span className="text-fgm">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}

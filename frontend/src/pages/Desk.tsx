import { Link } from 'react-router-dom'
import { Card, ErrorBox, Loading, StatusBadge, ts, useApi } from '../ui'

const ORDER = ['PENDING_CHALLENGE', 'PENDING_APPROVAL', 'AGENT_ERROR', 'APPROVED', 'REWORK_REQUESTED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN', 'DRAFTING']

export default function Desk() {
  const { data, error } = useApi<any[]>('/api/views')
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const sorted = [...data].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.created_at.localeCompare(a.created_at))
  return (
    <>
      <h1 className="text-xl font-semibold">Bàn duyệt của CIO – hàng đợi nhận định</h1>
      <Card>
        <table className="t">
          <thead><tr><th>Phiên bản</th><th>Trạng thái</th><th>Tóm tắt</th><th>Dòng có tác động</th><th>Tạo lúc</th></tr></thead>
          <tbody>{sorted.map(v => (
            <tr key={v.id}>
              <td><Link className="text-primary hover:underline mono" to={`/views/${v.id}`}>{v.id}</Link>{v.origin === 'manual' && <div className="text-fgm text-xs">nhập tay</div>}</td>
              <td><StatusBadge s={v.status} />{v.unchallenged.length > 0 && <div className="text-amber text-xs">{v.unchallenged.length} dòng chờ phản biện lại</div>}</td>
              <td>{v.body.summary}</td>
              <td className="num">{v.body.impacts.filter((l: any) => l.level !== 0).length}</td>
              <td className="text-xs">{ts(v.created_at)}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </>
  )
}

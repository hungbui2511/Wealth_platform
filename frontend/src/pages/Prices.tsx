// Màn hình Nguồn giá (FR-214)
import { api } from '../api'
import { useUser } from '../App'
import { Badge, Btn, Card, ErrorBox, fmtVnd, Loading, Note, ts, useApi } from '../ui'

export default function Prices() {
  const user = useUser()
  const { data, error, reload } = useApi('/api/prices/status')
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  return (
    <>
      <div className="flex justify-between items-center flex-wrap gap-2"><h1 className="text-xl font-semibold">Nguồn giá</h1>{user.role === 'ADMIN' && <Btn onClick={async () => { await api('/api/prices/refresh', { method: 'POST' }); reload() }}>Tải lại giá (ảnh chụp mới)</Btn>}</div>
      <Note>Chế độ <b>{data.mode}</b>. Ở chế độ mẫu, mỗi adapter đọc file mẫu theo cấu trúc dữ liệu của nguồn (không phải giá thật). Chế độ live chỉ chạy khi có thông tin truy cập và mã thỏa thuận dữ liệu; thiếu thì từ chối, ghi nhật ký và dùng dự phòng. Không gọi đầu API không chính thức.</Note>
      <Card title={`Ảnh chụp ${data.snapshot_id} · ngày giá ${data.price_date}`}>
        <table className="t"><thead><tr><th>Adapter</th><th className="num">Yêu cầu</th><th className="num">Có giá</th><th className="num">Dự phòng</th><th className="num">Thiếu</th><th>Lần lấy</th><th>Lỗi</th></tr></thead>
          <tbody>{data.status.map((s: any) => <tr key={s.id}><td>{s.label} <span className="mono text-fgm">{s.id}</span></td><td className="num">{s.requested}</td><td className="num">{s.ok}</td><td className="num">{s.fallback ? <Badge tone="amber">{s.fallback}</Badge> : 0}</td><td className="num">{s.missing ? <Badge tone="red">{s.missing}</Badge> : 0}</td><td className="text-xs">{ts(s.last_fetch)}</td><td className="text-xs">{s.error ?? '—'}</td></tr>)}</tbody></table>
        <p className="text-fgm text-xs mt-2 mono">Mã băm ảnh chụp: {data.hash}</p>
      </Card>
      <Card title="Giá trong ảnh chụp"><div className="max-h-[480px] overflow-y-auto"><table className="t"><thead><tr><th>Khóa</th><th className="num">Giá</th><th>Nguồn</th><th>Ngày</th><th>Cờ</th></tr></thead>
        <tbody>{data.points.map((p: any) => <tr key={p.key}><td className="mono">{p.key}</td><td className="num">{fmtVnd(p.price.split('.')[0])}{p.price.includes('.') ? ',' + p.price.split('.')[1] : ''} {p.currency !== 'VND' ? p.currency : ''}</td><td className="text-xs">{p.source}</td><td className="text-xs">{p.date}{p.valuation_date ? ` · định giá ${p.valuation_date}` : ''}</td><td><Badge tone={p.flag === 'fallback' ? 'amber' : 'low'}>{{ primary: 'chính', fallback: 'dự phòng', sample: 'mẫu', manual: 'thủ công' }[p.flag as string]}</Badge></td></tr>)}</tbody></table></div></Card>
    </>
  )
}

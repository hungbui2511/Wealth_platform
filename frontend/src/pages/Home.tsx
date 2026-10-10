import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useUser } from '../App'
import { Btn, Card, ErrorBox, Note, StatusBadge, useApi } from '../ui'

const SCRIPT = [
  ['Quản trị', 'Nạp dữ liệu mẫu và gói sự kiện mẫu (nút bên dưới).'],
  ['CIO / RM', 'Mở Bản đồ tài sản DEMO-F03 và DEMO-F08: cùng khoảng 15% cổ phiếu nhưng khác ngành.'],
  ['CIO / RM', 'DEMO-F01: tab Lãi/lỗ (DMNGA lãi 2,48 tỷ; tiền gửi USD tách hiệu ứng tỷ giá), tab Dòng tiền (gọi vốn tháng thứ 5). DEMO-F09: thiếu hụt tiền mức Đỏ.'],
  ['CIO', 'Sự kiện → chạy Agent CIO cho EV-2026-0002; mở vết chạy (bốn nhóm phân tích, tranh luận, tổng hợp).'],
  ['CIO', 'Bàn duyệt: Agent Phản biện chỉ ra tác động bậc hai lên trái phiếu doanh nghiệp bất động sản (Nghiêm trọng).'],
  ['CIO', 'Thử Duyệt → bị chặn. Thêm dòng ngành (CORP_BOND, REAL_ESTATE), phản biện lại, phản hồi "Chấp nhận – đã sửa", rồi Duyệt.'],
  ['CIO', 'Lần áp dụng: bảng xếp hạng 20 gia đình, "Cách tính"; tab Mục tiêu DEMO-F01: 99,59% → 95,87%; Dòng tiền dài hạn DEMO-F12.'],
  ['CIO', 'Hậu kiểm: DEMO-F05 có giá bất động sản quá cũ (Trung bình, kết quả vẫn hiệu lực).'],
  ['RM', 'Danh sách gia đình của mình, chi tiết, diễn giải nội bộ có watermark.'],
  ['Tuân thủ', 'Truy vết một con số về tin nguồn; Danh mục agent.'],
  ['CIO', 'Thu hồi nhận định; RM thấy nhãn "Đã thu hồi".'],
  ['Quản trị / Tuân thủ', 'Radar chính sách: nạp văn bản, xác nhận nguồn, Agent Chính sách, gia đình bị chạm, thời gian phản ứng.'],
  ['CIO / Tuân thủ', 'EV-2026-0006 nhắc Công ty Demo X: bị chặn chờ Tuân thủ; sau khi cho phép, dòng DMXYZ bị loại. Dán tin không có đường dẫn công khai: bị từ chối.'],
  ['CIO / Tuân thủ', 'Bản tin CIO từ VW-0002: mốc Private sớm hơn đại chúng; Tuân thủ duyệt; xem trước, không gửi.'],
]

export default function Home() {
  const user = useUser()
  const health = useApi('/api/health')
  const events = useApi<any[]>(user.role === 'RM' ? null : '/api/events')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const run = (path: string, label: string) => async () => { setErr(null); try { const r = await api(path, { method: 'POST' }); setMsg(`${label}: ${JSON.stringify(r).slice(0, 240)}`); events.reload() } catch (e) { setErr(e) } }
  const pending = (events.data ?? []).flatMap(e => e.views.filter((v: any) => ['PENDING_APPROVAL', 'PENDING_CHALLENGE'].includes(v.status)).map((v: any) => ({ ...v, event: e })))
  return (
    <>
      <h1 className="text-xl font-semibold">Tổng quan</h1>
      <Note>Chế độ agent: <b>{health.data?.agent_mode}</b> · chế độ giá: <b>{health.data?.price_mode}</b> · ngày giá: <b>{health.data?.price_date}</b>. Mọi tiêu chí chấp nhận chấm ở chế độ mock và giá mẫu.</Note>
      <ErrorBox error={err} />
      {msg && <Note>{msg}</Note>}
      {user.role === 'ADMIN' && (
        <Card title="Quản trị dữ liệu demo">
          <div className="flex flex-wrap gap-2">
            <Btn kind="danger" onClick={run('/api/admin/reseed', 'Nạp lại dữ liệu mẫu từ đầu')}>Nạp lại dữ liệu mẫu từ đầu</Btn>
            <Btn onClick={run('/api/admin/load-sample-events', 'Nạp gói sự kiện mẫu')}>Nạp gói sự kiện mẫu</Btn>
            <Btn kind="secondary" onClick={run('/api/admin/load-sample-policies', 'Nạp gói văn bản chính sách')}>Nạp gói văn bản chính sách</Btn>
          </div>
          <p className="text-fgm text-[13px] mt-2">Nạp lại từ đầu xóa toàn bộ dữ liệu demo và tạo lại bảng nhật ký; bản ghi đầu tiên của chuỗi mới lưu đầu chuỗi cũ.</p>
        </Card>
      )}
      {user.role === 'RM' && <Card title="Gia đình phụ trách"><p className="text-fgm mb-2">{user.families.join(', ')}</p><Link className="text-primary hover:underline" to="/families">Mở danh sách gia đình</Link></Card>}
      {(user.role === 'CIO' || user.role === 'COMPLIANCE') && (
        <Card title={`Nhận định chờ xử lý (${pending.length})`}>
          {pending.length === 0 ? <p className="text-fgm">Không có nhận định nào chờ duyệt.</p> :
            <ul className="space-y-1">{pending.map(v => <li key={v.id} className="flex gap-2 items-center"><Link className="text-primary hover:underline mono" to={`/views/${v.id}`}>{v.id}</Link><StatusBadge s={v.status} /><span className="text-fgm">{v.event.title}</span></li>)}</ul>}
        </Card>
      )}
      <Card title="Kịch bản demo khoảng 12 phút (BRD Mục 9.2)">
        <ol className="list-decimal ml-5 space-y-1 text-[13px]">{SCRIPT.map(([who, what], i) => <li key={i}><span className="text-primary">{who}:</span> {what}</li>)}</ol>
      </Card>
    </>
  )
}

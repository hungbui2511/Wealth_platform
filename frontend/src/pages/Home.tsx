import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useUser } from '../App'
import { Badge, Btn, Card, ErrorBox, fmtVndShort, Note, StatusBadge, useApi } from '../ui'
import { PURPOSE_LABEL, TIER_LABEL } from '../../../src/engine/procedural'

const SCRIPT = [
  ['Quản trị', 'Nạp dữ liệu mẫu và gói sự kiện mẫu (nút bên dưới).'],
  ['CIO / RM', 'Mở Bản đồ tài sản DEMO-F03 và DEMO-F08: cùng khoảng 15% cổ phiếu nhưng khác ngành.'],
  ['CIO / RM', 'DEMO-F01: tab Lãi/lỗ (MBB lãi 2,48 tỷ; tiền gửi USD tách hiệu ứng tỷ giá), tab Dòng tiền (gọi vốn tháng thứ 5). DEMO-F09: thiếu hụt tiền mức Đỏ.'],
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
  ['Quản trị → Tuân thủ → RM', 'Nghiên cứu & mô hình: nạp "Ghi chú quy định" (ví dụ dự thảo thông tư phòng, chống rửa tiền), Tuân thủ phát hành; RM1 mở DEMO-F01 → Mục tiêu: lưu ý thủ tục cho mục tiêu du học.'],
]

export default function Home() {
  const user = useUser()
  const health = useApi('/api/health')
  const events = useApi<any[]>(user.role === 'RM' ? null : '/api/events')
  const proc = useApi<any>(user.role === 'RM' ? '/api/procedural' : null)
  const alerts = useApi<any>(user.role === 'RM' ? null : '/api/ops/alerts')
  const digest = useApi<any>(user.role === 'RM' ? '/api/rm/digest' : null)
  const netting = useApi<any>(user.role === 'CIO' || user.role === 'COMPLIANCE' ? '/api/book/netting' : null)
  const mat = useApi<any[]>(user.role === 'CIO' || user.role === 'COMPLIANCE' ? '/api/views/materiality' : null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const run = (path: string, label: string) => async () => { setErr(null); try { const r = await api(path, { method: 'POST' }); setMsg(`${label}: ${JSON.stringify(r).slice(0, 240)}`); events.reload() } catch (e) { setErr(e) } }
  const pending = (events.data ?? []).flatMap(e => e.views.filter((v: any) => ['PENDING_APPROVAL', 'PENDING_CHALLENGE'].includes(v.status)).map((v: any) => ({ ...v, event: e })))
  return (
    <>
      <h1 className="text-xl font-semibold">Tổng quan</h1>
      <Note>Chế độ agent: <b>{health.data?.agent_mode}</b> · chế độ giá: <b>{health.data?.price_mode}</b> · ngày giá: <b>{health.data?.price_date}</b>. Mọi tiêu chí chấp nhận chấm ở chế độ mock và giá mẫu.</Note>
      {alerts.data && (alerts.data.schedules.length > 0 || alerts.data.paused.length > 0 || alerts.data.pending_prices > 0 || alerts.data.open_incidents > 0 || alerts.data.calendar_missed?.length > 0 || alerts.data.calendar_upcoming?.length > 0) && (
        <Note tone="warn">
          {alerts.data.schedules.map((s: any) => <div key={s.id}>{s.label}: {s.message ?? 'lượt chạy lỗi'}</div>)}
          {alerts.data.paused.length > 0 && <div>Agent tạm dừng: {alerts.data.paused.map((p: any) => p.label).join(', ')}</div>}
          {alerts.data.pending_prices > 0 && <div>{alerts.data.pending_prices} ảnh chụp giá do AI lấy chờ xác nhận</div>}
          {alerts.data.open_incidents > 0 && <div>{alerts.data.open_incidents} sự cố agent đang mở</div>}
          {alerts.data.calendar_missed?.map((c: any) => <div key={c.id}>Lịch {c.date}: {c.title} đã qua mà chưa có sự kiện</div>)}
          {alerts.data.calendar_upcoming?.map((c: any) => <div key={c.id}>Sắp tới {c.date}: {c.title}</div>)}
          <Link className="text-primary hover:underline" to="/quality">Mở trang Chất lượng, vận hành</Link>
        </Note>
      )}
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
      {user.role === 'RM' && proc.data?.alerts?.length > 0 && <Card title="Lưu ý thủ tục cho mục tiêu của khách">
        <ul className="text-[13px] divide-y divide-border">{proc.data.alerts.map((a: any) => <li key={a.note_id + a.goal_id} className="py-1.5 flex flex-wrap gap-1.5 items-center"><Badge tone={a.tier === 'contact' ? 'red' : a.tier === 'remind' ? 'amber' : a.tier === 'confirm' ? 'primary' : undefined}>{TIER_LABEL[a.tier as keyof typeof TIER_LABEL]}</Badge><Link className="text-primary hover:underline mono" to={`/families/${a.family_id}`}>{a.family_id}</Link><span>{a.goal_name}</span><span className="text-fgm">· {PURPOSE_LABEL[a.purpose as keyof typeof PURPOSE_LABEL]} · cần tiền {a.goal_month} · chuẩn bị trước {a.prepare_by}</span></li>)}</ul>
      </Card>}
      {user.role === 'RM' && digest.data && <RmDigest d={digest.data} />}
      {user.role === 'RM' && <Card title="Gia đình phụ trách"><p className="text-fgm mb-2">{user.families.join(', ')}</p><Link className="text-primary hover:underline" to="/families">Mở danh sách gia đình</Link></Card>}
      {(user.role === 'CIO' || user.role === 'COMPLIANCE') && (
        <Card title={`Nhận định chờ xử lý (${pending.length})`}>
          {pending.length === 0 ? <p className="text-fgm">Không có nhận định nào chờ duyệt.</p> :
            <ul className="space-y-1">{[...pending].sort((a, b) => laneRank(mat.data, a.id) - laneRank(mat.data, b.id)).map(v => { const m = mat.data?.find(x => x.view_id === v.id); return <li key={v.id} className="flex flex-wrap gap-2 items-center"><Link className="text-primary hover:underline mono" to={`/views/${v.id}`}>{v.id}</Link><StatusBadge s={v.status} />{m && <LaneBadge m={m} />}<span className="text-fgm">{v.event.title}</span></li> })}</ul>}
        </Card>
      )}
      {(user.role === 'CIO' || user.role === 'COMPLIANCE') && netting.data && netting.data.runs.length > 0 && <NettingCard d={netting.data} />}
      <Card title="Kịch bản demo khoảng 12 phút (BRD Mục 9.2)">
        <ol className="list-decimal ml-5 space-y-1 text-[13px]">{SCRIPT.map(([who, what], i) => <li key={i}><span className="text-primary">{who}:</span> {what}</li>)}</ol>
      </Card>
    </>
  )
}

const laneRank = (m: any[] | null | undefined, id: string) => { const x = m?.find(y => y.view_id === id); return x?.lane === 'FAST' ? 0 : x?.lane === 'NORMAL' ? 1 : 2 }
export function LaneBadge({ m }: { m: any }) {
  if (m.lane === 'NA') return <span title={m.reasons.join('; ')} className="text-fgm text-xs">chưa chạy thử</span>
  const due = m.due_by ? new Date(m.due_by).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : ''
  return <span title={m.reasons.join('; ')}><Badge tone={m.lane === 'FAST' ? 'red' : 'low'}>{m.lane === 'FAST' ? 'Làn ưu tiên' : 'Làn thường'}</Badge> <span className="text-fgm text-xs">xử lý trước {due}{m.worst_p10_3m_pct !== null ? ` · P10 xấu nhất ${(m.worst_p10_3m_pct * 100).toFixed(1).replace('.', ',')}%` : ''}</span></span>
}

function NettingCard({ d }: { d: any }) {
  const rows = Object.entries(d.factors as Record<string, any>).sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net))
  return (
    <Card title={`Gộp các sự kiện đang hiệu lực theo yếu tố (bán rã ${d.half_life_days} ngày)`}>
      <div className="text-[13px] mb-2">{d.runs.length} lần áp dụng đang hiệu lực. Tác động kỳ vọng 3 tháng của cả sổ sau khi giảm theo thời gian: <b>{fmtVndShort(String(d.book.base_3m))}</b> (chưa giảm: {fmtVndShort(String(d.book.base_3m_undecayed))}).</div>
      {d.warnings.length > 0 && <Note tone="warn">{d.warnings.map((w: any, i: number) => <div key={i}>{w.text}</div>)}</Note>}
      <div className="overflow-x-auto"><table className="t"><thead><tr><th>Yếu tố</th><th className="num">Ròng</th><th className="num">Tuyệt đối</th><th>Sự kiện đóng góp</th></tr></thead>
        <tbody>{rows.map(([k, f]) => <tr key={k}><td className="mono">{k}</td><td className="num">{String(f.net).replace('.', ',')}</td><td className="num">{String(f.gross).replace('.', ',')}</td><td className="text-xs">{f.contributors.map((c: any) => `${c.title} (${String(c.weighted).replace('.', ',')})`).join('; ')}</td></tr>)}</tbody></table></div>
      <p className="text-fgm text-xs mt-2">{d.note}</p>
    </Card>
  )
}

function RmDigest({ d }: { d: any }) {
  const tone = (l: string) => l === 'RED' ? 'red' : l === 'YELLOW' ? 'amber' : 'low'
  const fams = d.families.filter((f: any) => f.items.length > 0)
  return (
    <Card title={`Bản tin tuần: ${d.counts.red} Đỏ, ${d.counts.yellow} Vàng, ${d.counts.unseen} chưa xem`}>
      {fams.length === 0 ? <p className="text-fgm">Không có việc cần làm trong 7 ngày qua.</p> :
        <div className="space-y-3">{fams.map((f: any) => <div key={f.family_id}>
          <div className="font-semibold text-[13px]"><Link className="text-primary hover:underline" to={`/families/${f.family_id}`}>{f.family_id}</Link> {f.name}{f.net_active && <span className="text-fgm font-normal"> · {f.net_active.events} sự kiện đang hiệu lực, gộp sau giảm theo thời gian {fmtVndShort(String(f.net_active.impact_net))}</span>}</div>
          <ul className="text-[13px] space-y-0.5 mt-1">{f.items.map((x: any, i: number) => <li key={i}><Badge tone={tone(x.level)}>{x.level === 'RED' ? 'Đỏ' : x.level === 'YELLOW' ? 'Vàng' : 'Lưu ý'}</Badge> {x.text}</li>)}</ul>
        </div>)}</div>}
      <p className="text-fgm text-xs mt-2">Từ {new Date(d.period.from).toLocaleDateString('vi-VN')} đến {new Date(d.period.to).toLocaleDateString('vi-VN')}. Gồm tác động sự kiện mức Đỏ/Vàng, mục tiêu đổi mức, văn bản pháp luật mới khớp, gọi ký quỹ, thanh khoản khi căng thẳng, vấn đề kế thừa.</p>
    </Card>
  )
}

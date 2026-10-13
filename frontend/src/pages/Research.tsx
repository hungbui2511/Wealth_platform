// Nguồn tin độc quyền: Khối Nghiên cứu nạp báo cáo đã phát hành → Tuân thủ cho phát hành → tin vào hộp tin với nhãn "Độc quyền TCB".
// Cùng trang: mô hình yếu tố rủi ro (thư viện cú sốc CIO duyệt) mà agent dùng để lập nhánh kịch bản.
import { useState } from 'react'
import { DEFAULT_FACTOR_MODEL } from '../../../src/data/factorModel'
import { api } from '../api'
import { useUser } from '../App'
import { Badge, Btn, Card, ErrorBox, Loading, Note, ts, useApi } from '../ui'

const ST: Record<string, [string, string]> = { PENDING_RELEASE: ['amber', 'Chờ Tuân thủ'], RELEASED: ['green', 'Đã phát hành vào hệ thống'], REJECTED: ['red', 'Bị từ chối'] }

export default function Research() {
  const user = useUser()
  const { data, error, reload } = useApi<any[]>('/api/research')
  const [f, setF] = useState({ doc_no: '', title: '', summary: '', kind: 'research', unit: 'Khối Nghiên cứu Techcombank', published_at: new Date().toISOString().slice(0, 16), conflict_disclosure: '' })
  const [note, setNote] = useState<Record<string, string>>({})
  const [err, setErr] = useState<unknown>(null)
  const act = (fn: () => Promise<unknown>) => async () => { setErr(null); try { await fn(); reload() } catch (e) { setErr(e) } }
  const canSubmit = user.role === 'CIO' || user.role === 'ADMIN'
  return (
    <>
      <h1 className="text-xl font-semibold">Nghiên cứu độc quyền và mô hình yếu tố</h1>
      <Note>"Độc quyền" là phân tích riêng của Techcombank trên thông tin công khai, không phải thông tin nội bộ chưa công bố. Chỉ báo cáo đã phát hành chính thức, được Tuân thủ cho phát hành và đã tới giờ công bố mới vào hộp tin; agent không đọc được bản nháp. Người cho phát hành phải khác người nạp.</Note>
      <ErrorBox error={err ?? error} />
      {canSubmit && <Card title="Nạp báo cáo đã phát hành">
        <div className="grid md:grid-cols-3 gap-2 text-sm">
          <label className="flex flex-col gap-1">Số báo cáo<input value={f.doc_no} placeholder="TCB-RS-2026-118" onChange={e => setF({ ...f, doc_no: e.target.value })} /></label>
          <label className="flex flex-col gap-1">Loại<select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="research">Báo cáo nghiên cứu</option><option value="house_view">House view của CIO</option></select></label>
          <label className="flex flex-col gap-1">Giờ phát hành chính thức<input type="datetime-local" value={f.published_at} onChange={e => setF({ ...f, published_at: e.target.value })} /></label>
          <label className="flex flex-col gap-1 md:col-span-2">Tiêu đề<input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
          <label className="flex flex-col gap-1">Đơn vị<input value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} /></label>
          <label className="flex flex-col gap-1 md:col-span-3">Tóm tắt luận điểm (agent chỉ đọc phần này)<textarea rows={3} value={f.summary} onChange={e => setF({ ...f, summary: e.target.value })} /></label>
          <label className="flex flex-col gap-1 md:col-span-3">Công bố xung đột lợi ích (nếu báo cáo nói về tổ chức phát hành mà hệ sinh thái tư vấn, phân phối)<input value={f.conflict_disclosure} onChange={e => setF({ ...f, conflict_disclosure: e.target.value })} /></label>
        </div>
        <div className="mt-2"><Btn onClick={act(async () => { await api('/api/research', { method: 'POST', body: { ...f, published_at: new Date(f.published_at).toISOString() } }); setF({ ...f, doc_no: '', title: '', summary: '', conflict_disclosure: '' }) })}>Nạp, chờ Tuân thủ</Btn></div>
      </Card>}
      <Card title="Báo cáo đã nạp">
        {!data ? <Loading /> : data.length === 0 ? <p className="text-fgm text-sm">Chưa có báo cáo.</p> : <ul className="divide-y divide-border">{data.map(n => (
          <li key={n.id} className="py-2 text-[13px]">
            <div className="flex flex-wrap gap-1.5 items-center"><span className="mono text-fgm">{n.id}</span><b>{n.title}</b><Badge tone={ST[n.research.status]?.[0]}>{ST[n.research.status]?.[1]}</Badge><Badge>{n.research.kind === 'house_view' ? 'House view' : 'Nghiên cứu'}</Badge>{n.event_id && <Badge tone="primary">thuộc {n.event_id}</Badge>}</div>
            <div className="text-fgm">{n.summary}</div>
            <div className="text-fgm text-xs">Số {n.research.doc_no} · {n.research.unit} · phát hành {ts(n.published_at)} · nạp bởi {n.research.submitted_by}{n.research.released_by ? ` · ${n.research.status === 'RELEASED' ? 'cho phát hành' : 'từ chối'} bởi ${n.research.released_by} (${n.research.note})` : ''}</div>
            {n.research.conflict_disclosure && <div className="text-amber text-xs">Xung đột lợi ích: {n.research.conflict_disclosure}</div>}
            {user.role === 'COMPLIANCE' && n.research.status === 'PENDING_RELEASE' && <div className="flex flex-wrap gap-2 mt-1"><input className="flex-1 min-w-60" placeholder="Xác nhận: đã phát hành chính thức, không chứa thông tin nội bộ chưa công bố (≥ 20 ký tự)" value={note[n.id] ?? ''} onChange={e => setNote({ ...note, [n.id]: e.target.value })} /><Btn small onClick={act(() => api(`/api/research/${n.id}/release`, { method: 'POST', body: { approve: true, note: note[n.id] } }))}>Cho phát hành</Btn><Btn small kind="danger" onClick={act(() => api(`/api/research/${n.id}/release`, { method: 'POST', body: { approve: false, note: note[n.id] } }))}>Từ chối</Btn></div>}
          </li>))}</ul>}
      </Card>
      <Card title={<span>Mô hình yếu tố rủi ro <span className="mono text-fgm text-xs">{DEFAULT_FACTOR_MODEL.version}</span></span>}>
        <p className="text-[13px] mb-2">Ước lượng từ {DEFAULT_FACTOR_MODEL.estimation.months} tháng dữ liệu thật ({DEFAULT_FACTOR_MODEL.estimation.start} → {DEFAULT_FACTOR_MODEL.estimation.end}) cho {DEFAULT_FACTOR_MODEL.estimation.factors.length} yếu tố; dòng vốn ngoại – VN-Index ước lượng từ {DEFAULT_FACTOR_MODEL.estimation.foreign_flow?.weeks} tuần dữ liệu TCBS. Tương quan co 20% về giả định ban đầu vì mẫu nhỏ.</p>
        <p className="text-[13px] text-fgm mb-2">Agent chỉ được chọn yếu tố trong danh mục này và cỡ cú sốc trong thư viện (nhỏ / vừa / lớn). Bản đang hiệu lực nằm ở Cấu hình → FACTOR_MODEL (CIO sửa, có phiên bản).</p>
        <div className="overflow-x-auto"><table className="t"><thead><tr><th>Yếu tố</th><th>Nguồn</th><th>Đơn vị</th><th className="num">Nhỏ</th><th className="num">Vừa</th><th className="num">Lớn</th><th className="num">Biến động tháng (bình thường / căng thẳng)</th><th>Tác động theo thời gian (1 tuần · 3 tháng · 12 tháng)</th></tr></thead>
          <tbody>{DEFAULT_FACTOR_MODEL.factors.map(x => <tr key={x.id}><td><div>{x.label}</div><div className="mono text-fgm text-xs">{x.id}</div></td><td><Badge tone={x.origin === 'global' ? 'primary' : 'green'}>{x.origin === 'global' ? 'Quốc tế' : 'Trong nước'}</Badge></td><td>{x.unit}</td><td className="num">{x.library.S}</td><td className="num">{x.library.M}</td><td className="num">{x.library.L}</td><td className="num">{x.vol.calm} / {x.vol.stress} {(DEFAULT_FACTOR_MODEL.estimation.factors as readonly string[]).includes(x.id) ? <Badge tone="green">ước lượng</Badge> : <Badge>giả định</Badge>}</td><td className="text-xs">{x.profile.map(p => `${Math.round(p * 100)}%`).join(' · ')}</td></tr>)}</tbody></table></div>
        <div className="grid md:grid-cols-2 gap-4 mt-3 text-[13px]">
          <div><b>Độ nhạy cổ phiếu (beta với VN-Index)</b><div className="text-fgm text-xs mb-1">Ước lượng từ giá tuần TCBS 01/2022–10/2026; "căng thẳng" = 4–12/2022</div>
            <table className="t"><thead><tr><th>Mã</th><th className="num">Bình thường</th><th className="num">Căng thẳng</th><th className="num">R²</th></tr></thead><tbody>{Object.entries(DEFAULT_FACTOR_MODEL.equity).map(([k, v]: any) => <tr key={k}><td className="mono">{k}</td><td className="num">{v.beta_calm.toFixed(2)}</td><td className="num">{v.beta_stress.toFixed(2)}</td><td className="num">{v.r2.toFixed(2)}</td></tr>)}</tbody></table></div>
          <div><b>Giai đoạn lịch sử tương tự (để CIO đối chiếu cỡ cú sốc)</b>
            {DEFAULT_FACTOR_MODEL.analogs.map((a: any) => <div key={a.id} className="border border-border rounded p-2 mt-2"><div className="font-medium">{a.label}</div>
              {a.check && <div className="text-xs my-1 p-2 rounded bg-muted"><b>Kiểm chứng mô hình:</b> cho biết {Object.entries(a.check.conditioned_on).map(([k, v]: any) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ')} → mô hình suy ra {Object.entries(a.check.predicted).map(([k, v]: any) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ')}. Thực tế: {Object.entries(a.check.actual).map(([k, v]: any) => `${k} ${v > 0 ? '+' : ''}${v}`).join(', ')}.<div className="text-amber mt-1">{a.check.note}</div></div>}{Object.entries(a.moves).map(([k, v]: any) => <div key={k} className="flex justify-between text-xs py-0.5"><span>{k}</span><span className="num">{v > 0 ? '+' : ''}{v}</span><span className="text-fgm text-right max-w-[55%]">{a.sources[k]}</span></div>)}</div>)}
            <ul className="list-disc ml-5 text-xs text-fgm mt-2">{DEFAULT_FACTOR_MODEL.sources.map((s: string) => <li key={s}>{s}</li>)}</ul>
          </div>
        </div>
      </Card>
    </>
  )
}

// Chất lượng và vận hành agent (đợt 2 sau phản biện độc lập): hiệu chỉnh dự báo, chỉ số bàn duyệt, bài kiểm tra phản biện,
// bộ sự kiện chuẩn, sổ sự cố và tạm dừng agent, nhịp tim lượt chạy, giá do AI lấy chờ xác nhận.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useUser } from '../App'
import { Badge, Btn, Card, ErrorBox, Kv, Loading, Note, Tabs, ts, useApi } from '../ui'

const pct = (x: number | null | undefined, d = 0) => x === null || x === undefined ? '—' : `${(x * 100).toFixed(d).replace('.', ',')}%`
const num = (x: number | null | undefined, d = 3) => x === null || x === undefined ? '—' : x.toFixed(d).replace('.', ',')
const HB: Record<string, [string, string]> = { OK: ['green', 'Đã chạy'], PARTIAL: ['amber', 'Chạy một phần'], FAILED: ['red', 'Lỗi'], MISSING: ['red', 'Chưa thấy lượt chạy'], NOT_DUE: ['low', 'Chưa đến hạn'] }

export default function Quality() {
  const user = useUser()
  const { data, error, reload } = useApi('/api/quality')
  const [tab, setTab] = useState('calibration')
  const [err, setErr] = useState<unknown>(null)
  const act = (fn: () => Promise<unknown>) => async () => { setErr(null); try { await fn(); reload() } catch (e) { setErr(e) } }
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const missing = data.schedules.filter((s: any) => s.status === 'MISSING' || s.status === 'FAILED')
  const paused = Object.values(data.controls).filter((c: any) => c.paused)
  return (
    <>
      <h1 className="text-xl font-semibold">Chất lượng và vận hành agent</h1>
      {missing.length > 0 && <Note tone="warn">{missing.map((s: any) => `${s.label}: ${HB[s.status][1]}`).join(' · ')}</Note>}
      {paused.length > 0 && <Note tone="warn">Đang tạm dừng: {paused.map((c: any) => data.agents[c.id]).join(', ')}</Note>}
      {data.pending_prices.length > 0 && <Note tone="warn">{data.pending_prices.length} ảnh chụp giá do AI lấy đang chờ xác nhận, chưa được dùng cho tính toán.</Note>}
      <ErrorBox error={err} />
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'calibration', label: 'Hiệu chỉnh dự báo' }, { id: 'review', label: 'Bàn duyệt và phản biện' }, { id: 'golden', label: 'Bộ sự kiện chuẩn' }, { id: 'ops', label: 'Sự cố, tạm dừng, lượt chạy' }, { id: 'prices', label: `Giá chờ xác nhận (${data.pending_prices.length})` }]} />
      {tab === 'calibration' && <Calibration c={data.calibration} />}
      {tab === 'review' && <Review r={data.review} cn={data.canaries} canCreate={user.role === 'COMPLIANCE' || user.role === 'ADMIN'} act={act} />}
      {tab === 'golden' && <Golden g={data.golden} isCio={user.role === 'CIO'} act={act} />}
      {tab === 'ops' && <Ops d={data} role={user.role} act={act} />}
      {tab === 'prices' && <Prices list={data.pending_prices} canConfirm={user.role === 'CIO' || user.role === 'COMPLIANCE'} act={act} />}
    </>
  )
}

function Calibration({ c }: { c: any }) {
  return (
    <>
      <Note tone={c.calibrated ? 'info' : 'warn'}>{c.label}. Mỗi nhận định được duyệt có nhánh kịch bản được lưu vào sổ dự báo; Agent Chấm điểm (tất định, không dùng AI) đối chiếu với số liệu thị trường khi đến hạn 1 tuần, 3 tháng, 12 tháng. Brier thấp hơn mốc "xác suất đều" nghĩa là xác suất các nhánh có giá trị; độ phủ dải 80% nên nằm khoảng 70–90%.</Note>
      <Card title="Tổng hợp theo kỳ hạn">
        <div className="overflow-x-auto"><table className="t"><thead><tr><th>Kỳ hạn</th><th className="num">Số mốc đã chấm</th><th className="num">Brier</th><th className="num">Mốc xác suất đều</th><th className="num">Kỹ năng</th><th className="num">Độ phủ dải 80%</th><th className="num">Đúng hướng</th></tr></thead>
          <tbody>{c.horizons.map((h: any) => <tr key={h.horizon}><td>{h.horizon}</td><td className="num">{h.n}</td><td className="num">{num(h.brier)}</td><td className="num">{num(h.brier_uniform)}</td><td className="num">{h.skill === null ? '—' : <span className={h.skill > 0 ? 'text-green' : 'text-red'}>{pct(h.skill, 1)}</span>}</td><td className="num">{pct(h.coverage_80)} <span className="text-fgm text-xs">({h.coverage_n})</span></td><td className="num">{pct(h.direction_hit)} <span className="text-fgm text-xs">({h.direction_n})</span></td></tr>)}</tbody></table></div>
      </Card>
      <Card title="Sổ dự báo">
        {c.forecasts.length === 0 ? <p className="text-fgm text-[13px]">Chưa có nhận định nào được duyệt kể từ khi có sổ dự báo.</p> :
          <div className="overflow-x-auto"><table className="t"><thead><tr><th>Dự báo</th><th>Duyệt lúc</th>{['1 tuần', '3 tháng', '12 tháng'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{c.forecasts.map((f: any) => <tr key={f.id}><td><Link className="text-primary hover:underline mono" to={`/views/${f.view_id}`}>{f.view_id}</Link></td><td className="text-xs">{ts(f.approved_at)}</td>
              {f.checkpoints.map((cp: any) => <td key={cp.horizon} className="text-xs">{cp.status === 'SCORED' ? <>Brier {num(cp.brier)}<div className="text-fgm">nhánh gần nhất {cp.outcome}</div><div className="text-fgm">{Object.entries(cp.observed ?? {}).map(([k, v]: any) => `${k} ${v > 0 ? '+' : ''}${String(v).replace('.', ',')}${cp.coverage?.[k] === false ? ' (ngoài dải)' : ''}`).join(' · ')}</div></> : cp.status === 'UNSCORABLE' ? <Badge tone="amber">không chấm được</Badge> : <span className="text-fgm">hạn {ts(cp.due)}</span>}</td>)}</tr>)}</tbody></table></div>}
      </Card>
    </>
  )
}

function Review({ r, cn, canCreate, act }: { r: any; cn: any; canCreate: boolean; act: (fn: () => Promise<unknown>) => () => void }) {
  const [vid, setVid] = useState('')
  const [plants, setPlants] = useState<string[]>(['sign_flip', 'overconfidence'])
  return (
    <>
      <Card title="Bàn duyệt CIO: cổng duyệt có thật sự lọc không">
        <div className="grid md:grid-cols-2 gap-x-6">
          <Kv k="Nhận định đã quyết định" v={r.views_decided} /><Kv k="Đã duyệt" v={r.approved} />
          <Kv k="Yêu cầu làm lại / từ chối" v={`${r.rework} / ${r.rejected}`} /><Kv k="Phát hiện Nghiêm trọng" v={r.critical_findings} />
          <Kv k="Chấp nhận và sửa" v={`${r.critical_responses.accepted_fixed} (${pct(r.critical_accept_rate)})`} /><Kv k="Không đồng ý / ngoài phạm vi" v={`${r.critical_responses.disagree} / ${r.critical_responses.out_of_scope}`} />
          <Kv k="Duyệt có sửa của CIO" v={pct(r.approved_with_edits_rate)} /><Kv k="Duyệt nguyên trạng" v={pct(r.approved_as_is_rate)} />
        </div>
        <p className="text-fgm text-xs mt-2">{r.note}</p>
      </Card>
      <Card title="Bài kiểm tra phản biện (gài lỗi có chủ đích)">
        <p className="text-[13px]">Tỷ lệ Agent Phản biện phát hiện lỗi gài: <b>{pct(cn.detection_rate)}</b> ({cn.detected}/{cn.planted} lỗi, {cn.total} bài, {cn.open} đang mở). Chỉ tính phát hiện của agent, không tính kiểm tra theo quy tắc.</p>
        {Object.keys(cn.by_type).length > 0 && <table className="t mt-2"><thead><tr><th>Loại lỗi gài</th><th className="num">Gài</th><th className="num">Phát hiện</th></tr></thead><tbody>{Object.entries(cn.by_type).map(([k, v]: any) => <tr key={k}><td className="text-[13px]">{cn.labels[k]}</td><td className="num">{v.planted}</td><td className="num">{v.detected}</td></tr>)}</tbody></table>}
        {canCreate && <div className="mt-3 flex flex-col gap-2 text-[13px] max-w-xl">
          <input placeholder="Mã nhận định gốc, ví dụ VW-0011-v1" value={vid} onChange={e => setVid(e.target.value)} />
          <div className="flex flex-wrap gap-3">{Object.entries(cn.labels).map(([k, l]: any) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={plants.includes(k)} onChange={e => setPlants(e.target.checked ? [...plants, k] : plants.filter(x => x !== k))} />{l}</label>)}</div>
          <div><Btn small onClick={act(() => api('/api/canaries', { method: 'POST', body: { view_id: vid.trim(), plants } }))}>Tạo bài kiểm tra</Btn></div>
          <p className="text-fgm text-xs">Hệ thống tạo phiên bản mới của cùng sự kiện với lỗi đã biết, đưa vào hàng chờ phản biện như mọi nhận định. Phiên phản biện không được báo đây là bài kiểm tra. Nhận định này không duyệt được và tự đóng khi có phản biện.</p>
        </div>}
        {cn.rows.length > 0 && <table className="t mt-3"><thead><tr><th>Bài</th><th>Nhận định</th><th>Trạng thái</th><th>Kết quả</th></tr></thead><tbody>{cn.rows.map((x: any) => <tr key={x.id}><td className="mono">{x.id}</td><td><Link className="text-primary hover:underline mono" to={`/views/${x.view_id}`}>{x.view_id}</Link></td><td>{x.status}</td><td className="text-xs">{x.result ? `${x.result.detected.length}/${x.plants.length} lỗi được phát hiện${x.result.missed.length ? `; bỏ sót ${x.result.missed.join(', ')}` : ''}` : x.plants.map((p: any) => p.target).join(', ')}</td></tr>)}</tbody></table>}
      </Card>
    </>
  )
}

function Golden({ g, isCio, act }: { g: any; isCio: boolean; act: (fn: () => Promise<unknown>) => () => void }) {
  return (
    <Card title="Bộ sự kiện chuẩn: phát hiện trôi khi đổi mô hình hoặc prompt">
      <p className="text-fgm text-[13px] mb-2">Lượt chạy theo lịch hằng tháng chạy lại {g.events.length} sự kiện lịch sử cố định. Lượt đầu là tham chiếu; các lượt sau so với tham chiếu (đồng thuận hướng ≥ {g.thresholds.agreement * 100}%, lệch mức ≤ {String(g.thresholds.level).replace('.', ',')}, khoảng cách cú sốc kỳ vọng ≤ {g.thresholds.distance}). Sự kiện có giai đoạn tương tự thì so hướng với biến động thực tế. Lần chạy gần nhất: {ts(g.last_run_at)}.</p>
      <div className="overflow-x-auto"><table className="t"><thead><tr><th>Sự kiện</th><th>Lượt gần nhất</th><th>Trôi</th><th>Khớp thực tế</th>{isCio && <th></th>}</tr></thead>
        <tbody>{g.events.map((x: any) => <tr key={x.event.id}><td><span className="mono">{x.event.id}</span> {x.event.title}<div className="text-fgm text-xs">{x.event.date}</div></td>
          <td className="text-xs">{x.latest ? <><span className="mono">{x.latest.id}</span> · {x.latest.model ?? '?'} · {ts(x.latest.created_at)}{x.latest.reference && <> <Badge tone="primary">tham chiếu</Badge></>}</> : <span className="text-fgm">chưa chạy</span>}</td>
          <td className="text-xs">{x.latest?.drift ? (x.latest.drift.drift ? <><Badge tone="red">có trôi</Badge> {x.latest.drift.reasons.join('; ')}</> : <Badge tone="green">ổn định</Badge>) : '—'}</td>
          <td className="text-xs">{x.latest?.analog_check ? `${pct(x.latest.analog_check.agreement)} yếu tố đúng hướng (${x.latest.analog_check.analog_id})` : '—'}</td>
          {isCio && <td>{x.latest && !x.latest.reference && <Btn small kind="secondary" onClick={act(() => api(`/api/golden/runs/${x.latest.id}/reference`, { method: 'POST', body: { reason: 'CIO chọn lượt này làm tham chiếu mới sau khi xem xét thay đổi mô hình' } }))}>Đặt làm tham chiếu</Btn>}</td>}
        </tr>)}</tbody></table></div>
    </Card>
  )
}

function Ops({ d, role, act }: { d: any; role: string; act: (fn: () => Promise<unknown>) => () => void }) {
  const [form, setForm] = useState({ agent: 'cio', severity: 'medium', what: '', pause: true })
  const [close, setClose] = useState<Record<string, { why: string; fix: string; rerun_done: boolean }>>({})
  const canPause = ['CIO', 'COMPLIANCE', 'ADMIN'].includes(role), canResume = ['COMPLIANCE', 'ADMIN'].includes(role)
  return (
    <>
      <Card title="Nhịp tim lượt chạy theo lịch">
        <table className="t"><thead><tr><th>Lịch</th><th>Trạng thái</th><th>Hạn báo</th><th>Lượt gần nhất</th></tr></thead>
          <tbody>{d.schedules.map((s: any) => <tr key={s.id}><td>{s.label}</td><td><Badge tone={HB[s.status][0]}>{HB[s.status][1]}</Badge>{s.message && <div className="text-xs text-fgm">{s.message}</div>}</td><td className="text-xs">{ts(s.due)}</td><td className="text-xs">{s.last ? `${ts(s.last.created_at)} · ${s.last.status}${s.last.notes ? ` · ${s.last.notes}` : ''}` : '—'}</td></tr>)}</tbody></table>
      </Card>
      <Card title="Trạng thái agent">
        <table className="t"><thead><tr><th>Agent</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>{Object.entries(d.agents).map(([id, label]: any) => { const c = d.controls[id]; return <tr key={id}><td>{label} <span className="mono text-fgm">{id}</span></td><td>{c?.paused ? <><Badge tone="red">Tạm dừng</Badge> <span className="text-xs">{c.reason} ({c.by}, {ts(c.at)})</span></> : <Badge tone="green">Đang chạy</Badge>}</td>
            <td>{c?.paused ? canResume && <Btn small kind="secondary" onClick={act(() => api(`/api/ops/agents/${id}/resume`, { method: 'POST', body: { reason: 'Đã xử lý sự cố, kiểm tra lại đầu ra và cho chạy tiếp' } }))}>Cho chạy lại</Btn> : canPause && <Btn small kind="danger" onClick={act(() => api(`/api/ops/agents/${id}/pause`, { method: 'POST', body: { reason: 'Tạm dừng để kiểm tra đầu ra bất thường của agent' } }))}>Tạm dừng</Btn>}</td></tr> })}</tbody></table>
        <p className="text-fgm text-xs mt-2">Khi tạm dừng, hệ thống từ chối bản ghi của agent đó và ghi rõ lý do. Người cho chạy lại phải là Tuân thủ hoặc Quản trị và khác người đã tạm dừng.</p>
      </Card>
      <Card title="Sổ sự cố">
        {canPause && <div className="flex flex-col gap-2 text-[13px] max-w-xl mb-3">
          <div className="flex gap-2 flex-wrap"><select value={form.agent} onChange={e => setForm({ ...form, agent: e.target.value })}>{Object.entries(d.agents).map(([id, l]: any) => <option key={id} value={id}>{l}</option>)}</select>
            <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}><option value="high">Cao</option><option value="medium">Vừa</option><option value="low">Thấp</option></select>
            <label className="flex items-center gap-1"><input type="checkbox" checked={form.pause} onChange={e => setForm({ ...form, pause: e.target.checked })} />Tạm dừng agent ngay</label></div>
          <input placeholder="Agent sai gì (tối thiểu 20 ký tự)" value={form.what} onChange={e => setForm({ ...form, what: e.target.value })} />
          <div><Btn small onClick={act(() => api('/api/ops/incidents', { method: 'POST', body: form }))}>Mở sự cố</Btn></div>
        </div>}
        {d.incidents.length === 0 ? <p className="text-fgm text-[13px]">Chưa có sự cố.</p> : <div className="space-y-2">{d.incidents.map((i: any) => { const f = close[i.id] ?? { why: i.why ?? '', fix: i.fix ?? '', rerun_done: !!i.rerun_done }; return (
          <div key={i.id} className="border border-border rounded-md p-2 text-[13px]">
            <div className="flex flex-wrap gap-2 items-center"><span className="mono">{i.id}</span><Badge tone={i.status === 'OPEN' ? 'red' : 'green'}>{i.status === 'OPEN' ? 'Đang mở' : 'Đã đóng'}</Badge><Badge>{d.agents[i.agent]}</Badge><span className="text-fgm">{ts(i.created_at)} · {i.opened_by}</span></div>
            <p className="mt-1">{i.what}</p>
            {i.why && <p><span className="text-fgm">Vì sao: </span>{i.why}</p>}{i.fix && <p><span className="text-fgm">Đã sửa: </span>{i.fix}</p>}{i.rerun_done !== undefined && <p><span className="text-fgm">Đã chạy lại: </span>{i.rerun_done ? 'Có' : 'Chưa'}</p>}
            {i.status === 'OPEN' && canPause && <div className="mt-2 flex flex-col gap-1 max-w-xl">
              <input placeholder="Vì sao sai" value={f.why} onChange={e => setClose({ ...close, [i.id]: { ...f, why: e.target.value } })} />
              <input placeholder="Đã sửa gì" value={f.fix} onChange={e => setClose({ ...close, [i.id]: { ...f, fix: e.target.value } })} />
              <label className="flex items-center gap-1"><input type="checkbox" checked={f.rerun_done} onChange={e => setClose({ ...close, [i.id]: { ...f, rerun_done: e.target.checked } })} />Đã chạy lại</label>
              <div className="flex gap-2"><Btn small kind="secondary" onClick={act(() => api(`/api/ops/incidents/${i.id}`, { method: 'PUT', body: f }))}>Lưu</Btn><Btn small onClick={act(() => api(`/api/ops/incidents/${i.id}`, { method: 'PUT', body: { ...f, close: true } }))}>Đóng sự cố</Btn></div>
            </div>}
          </div>) })}</div>}
      </Card>
    </>
  )
}

function Prices({ list, canConfirm, act }: { list: any[]; canConfirm: boolean; act: (fn: () => Promise<unknown>) => () => void }) {
  const [note, setNote] = useState('')
  if (!list.length) return <Card><p className="text-fgm text-[13px]">Không có ảnh chụp giá nào chờ xác nhận.</p></Card>
  return <>{list.map(s => (
    <Card key={s.id} title={<span className="mono">{s.id} · ngày giá {s.price_date}</span>}>
      <table className="t"><thead><tr><th>Mã</th><th className="num">Giá</th><th>Ngày</th><th>Nguồn</th></tr></thead><tbody>{s.points.map((p: any) => <tr key={p.key}><td className="mono">{p.key}</td><td className="num">{p.price}</td><td>{p.date}</td><td className="text-xs">{p.source}</td></tr>)}</tbody></table>
      {canConfirm && <div className="mt-2 flex flex-col gap-1 max-w-xl text-[13px]">
        <input placeholder="Ghi chú đối soát (tối thiểu 20 ký tự)" value={note} onChange={e => setNote(e.target.value)} />
        <div className="flex gap-2"><Btn small onClick={act(() => api(`/api/prices/snapshots/${s.id}/confirm`, { method: 'POST', body: { decision: 'confirm', note } }))}>Xác nhận dùng</Btn><Btn small kind="danger" onClick={act(() => api(`/api/prices/snapshots/${s.id}/confirm`, { method: 'POST', body: { decision: 'reject', note } }))}>Từ chối</Btn></div>
      </div>}
      <p className="text-fgm text-xs mt-2">Giá do AI lấy từ nguồn công khai, chưa có thỏa thuận dữ liệu. Chỉ sau khi xác nhận, ảnh chụp này mới được dùng cho lần áp dụng và màn hình gia đình.</p>
    </Card>
  ))}</>
}

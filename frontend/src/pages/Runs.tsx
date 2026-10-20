import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { useUser } from '../App'
import { HowCalcModal } from '../HowCalc'
import { AlertBadge, Badge, Btn, Card, DISCLAIMER, ErrorBox, fmtPct, Kv, Loading, Money, Note, SevBadge, StatusBadge, ts, useApi } from '../ui'
import { GoalImpactTable } from './FamilyDetail'
import { RunScenarioSummary } from '../scenario'

export default function Runs() {
  const { data, error } = useApi<any[]>('/api/runs')
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  return (
    <>
      <h1 className="text-xl font-semibold">Lần áp dụng</h1>
      <Card><table className="t"><thead><tr><th>Lần áp dụng</th><th>Trạng thái</th><th>Nhận định</th><th>Cấu hình</th><th>Ảnh chụp giá</th><th>Hậu kiểm</th><th>Tạo lúc</th></tr></thead>
        <tbody>{data.map(r => <tr key={r.id}><td><Link className="text-primary hover:underline mono" to={`/runs/${r.id}`}>{r.id}</Link></td><td><StatusBadge s={r.status} /></td><td className="mono">{r.view_id}</td><td className="mono text-xs">{r.config_version_id}</td><td className="mono text-xs">{r.price_snapshot_id}</td><td className="text-xs">{r.post_check ? `${r.post_check.critical} NT · ${r.post_check.medium} TB · ${r.post_check.low} T` : '—'}</td><td className="text-xs">{ts(r.created_at)}</td></tr>)}</tbody></table></Card>
    </>
  )
}

export function RunDetail() {
  const { id } = useParams()
  const user = useUser()
  const { data, error, reload } = useApi(`/api/runs/${id}`)
  const [how, setHow] = useState<any>(null)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [rc, setRc] = useState<any>(null)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const r = data.run
  const byFam = new Map(data.impacts.map((i: any) => [i.family_id, i]))
  const act = (fn: () => Promise<any>) => async () => { setErr(null); try { await fn(); reload() } catch (e) { setErr(e) } }
  return (
    <>
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-semibold mono">{r.id}</h1><StatusBadge s={r.status} /><Link className="text-primary hover:underline mono text-sm" to={`/views/${r.view_id}`}>{r.view_id}</Link><span className="text-fgm text-sm">{r.view_body.summary}</span></div>
      <Note>{DISCLAIMER}. Cú sốc tài sản và cú sốc tỷ giá được cộng (xấp xỉ bậc một). Không gọi LLM trong bộ máy áp dụng.</Note>
      <ErrorBox error={err} />
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Ảnh chụp và phiên bản">
          <Kv k="Phiên bản cấu hình (bảng u)" v={<span className="mono">{r.config_version_id}</span>} />
          <Kv k="Cấu hình khác" v={<span className="mono text-xs">{Object.values(r.config_version_ids).join(', ')}</span>} />
          <Kv k="Ngày giá / ảnh chụp giá" v={<span className="mono">{r.price_date} · {r.price_snapshot_id}</span>} />
          <Kv k="Mã băm ảnh chụp dữ liệu" v={<span className="mono text-xs" title={r.portfolio_snapshot_hash}>{r.portfolio_snapshot_hash.slice(0, 16)}…</span>} />
          <Kv k="Phiên bản engine" v={<span className="mono">{r.engine_version}</span>} />
          <Kv k="Thời gian tính" v={`${r.elapsed_ms ?? '—'} ms`} />
          <Kv k="Hiệu lực lúc" v={ts(r.effective_at)} />
        </Card>
        <Card title="Hậu kiểm (quy tắc BR-17)" className="lg:col-span-2">
          {data.post_check ? <>
            <p className="text-[13px] mb-2">{data.post_check.summary} <span className="text-fgm">({data.post_check.model})</span></p>
            <div className="max-h-64 overflow-y-auto"><table className="t"><thead><tr><th>Mức</th><th>Kiểm tra</th><th>Gia đình</th><th>Vấn đề</th></tr></thead><tbody>{data.post_check.findings.map((f: any) => <tr key={f.finding_id}><td><SevBadge s={f.severity} /></td><td className="mono text-xs">{f.check}</td><td className="mono">{f.target}</td><td className="text-xs">{f.issue}</td></tr>)}</tbody></table></div>
          </> : <span className="text-fgm">—</span>}
          {user.role === 'CIO' && r.status === 'NEEDS_CIO_REVIEW' && <div className="mt-3 space-y-2"><Note tone="warn">Có phát hiện Nghiêm trọng: RM chưa thấy kết quả cho tới khi CIO cho hiệu lực.</Note><textarea rows={2} className="w-full" placeholder="Lý do (tối thiểu 20 ký tự)" value={reason} onChange={e => setReason(e.target.value)} /><div className="flex gap-2"><Btn onClick={act(() => api(`/api/runs/${r.id}/confirm`, { method: 'POST', body: { reason } }))}>Cho hiệu lực</Btn><Btn kind="danger" onClick={act(() => api(`/api/runs/${r.id}/withdraw`, { method: 'POST', body: { reason } }))}>Thu hồi</Btn></div></div>}
          {(user.role === 'COMPLIANCE' || user.role === 'ADMIN') && <div className="mt-3"><Btn kind="secondary" onClick={act(async () => setRc(await api(`/api/runs/${r.id}/recompute`, { method: 'POST' })))}>Tính lại từ ảnh chụp</Btn>{rc && <span className="ml-2 text-[13px]">{rc.all_equal && rc.portfolio_hash_ok ? <Badge tone="green">Trùng từng đồng với kết quả đã lưu ({rc.rows.length} gia đình), mã băm khớp</Badge> : <Badge tone="red">Có chênh lệch</Badge>}</span>}</div>}
        </Card>
      </div>
      <RunScenarioSummary s={r.scenario_summary} />
      <Card title="Xếp hạng gia đình theo độ lớn tác động">
        <div className="overflow-x-auto"><table className="t"><thead><tr><th>#</th><th>Gia đình</th><th className="num">Tác động kỳ vọng 3 tháng</th><th className="num">% tài sản ròng</th><th>Mức</th><th className="num">Kém thanh khoản (ước tính trên giấy)</th><th className="num">Tài sản ròng</th>{r.scenario_summary && <th className="num">P10 3 tháng</th>}<th /></tr></thead>
          <tbody>{r.ranking.map((x: any, i: number) => { const fi: any = byFam.get(x.family_id); return (
            <tr key={x.family_id}><td className="text-fgm">{i + 1}</td><td><Link to={`/families/${x.family_id}`} className="text-primary hover:underline mono">{x.family_id}</Link><div className="text-fgm text-xs">{fi?.family_name}</div></td><td><Money v={x.impact} /></td><td className="num">{fmtPct(x.pct, 3)}</td><td><AlertBadge level={x.alert} />{x.alert_basis && <div className="text-fgm text-xs">{x.alert_basis === 'P10_3M' ? 'theo kịch bản xấu (P10)' : 'theo kỳ vọng'}{x.alert_mean && x.alert_mean !== x.alert ? `; kỳ vọng: ${({ RED: 'Đỏ', YELLOW: 'Vàng', GREEN: 'Xanh', POSITIVE: 'Tích cực' } as any)[x.alert_mean]}` : ''}</div>}</td><td><Money v={fi?.illiquid_impact} short /></td><td><Money v={fi?.net_worth} short /></td>{r.scenario_summary && <td className="num">{fmtPct(x.scen_bad_3m_pct, 2)}{x.lane2 === 'RM_REVIEW' && <div><Badge tone="red">chuyển RM</Badge></div>}</td>}
              <td><div className="flex gap-1"><Btn small kind="secondary" onClick={async () => setHow((await api(`/api/runs/${r.id}/families/${x.family_id}`)).result)}>Cách tính</Btn><Link to={`/trace/${r.id}/${x.family_id}`}><Btn small kind="ghost">Truy vết</Btn></Link></div></td></tr>
          ) })}</tbody></table></div>
      </Card>
      {data.goal_impacts.length > 0 && <Card title="Tác động lên mục tiêu (sau khi có hiệu lực)"><GoalImpactTable rows={data.goal_impacts} /></Card>}
      {how && <HowCalcModal result={how} onClose={() => setHow(null)} />}
    </>
  )
}

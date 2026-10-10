// Truy vết (FR-802): từ một con số của một gia đình đi ngược tới tin nguồn
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { HowCalcModal } from '../HowCalc'
import { AlertBadge, Badge, Btn, Card, ErrorBox, fmtPct, Kv, Loading, Money, SevBadge, StatusBadge, ts, useApi } from '../ui'

export default function Trace() {
  const { runId, familyId } = useParams()
  const { data, error } = useApi(`/api/trace/runs/${runId}/families/${familyId}`)
  const [how, setHow] = useState(false)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const fi = data.family_impact
  const Step = ({ n, title, children }: any) => <Card title={<span><span className="text-primary">{n}.</span> {title}</span>}>{children}</Card>
  return (
    <>
      <h1 className="text-xl font-semibold">Truy vết <span className="mono">{familyId}</span> · <span className="mono">{runId}</span></h1>
      <Step n={1} title="Con số của gia đình">
        <div className="flex flex-wrap gap-4 items-center"><span className="text-xl font-semibold"><Money v={fi.impact} /></span><span className="num">{fmtPct(fi.pct, 3)}</span><AlertBadge level={fi.alert} /><Btn small kind="secondary" onClick={() => setHow(true)}>Cách tính từng vị thế</Btn></div>
      </Step>
      <Step n={2} title="Lần áp dụng và ảnh chụp">
        <Kv k="Lần áp dụng" v={<span className="mono">{data.run.id} <StatusBadge s={data.run.status} /></span>} />
        <Kv k="Ảnh chụp giá" v={<span className="mono">{data.run.price_snapshot_id} · {data.run.price_snapshot_hash.slice(0, 16)}…</span>} />
        <Kv k="Ảnh chụp dữ liệu danh mục" v={<span className="mono">{data.run.portfolio_snapshot_hash.slice(0, 16)}…</span>} />
        <Kv k="Engine" v={data.run.engine_version} />
      </Step>
      <Step n={3} title="Phiên bản cấu hình">{data.configs.map((c: any) => <Kv key={c.id} k={<span className="mono">{c.id}</span>} v={<span className="text-xs">{c.proposed_by} · {ts(c.created_at)} · {c.reason}</span>} />)}</Step>
      <Step n={4} title="Nhận định đã duyệt và khác biệt so với bản AI">
        <p className="mb-2"><Link className="text-primary hover:underline mono" to={`/views/${data.view.id}`}>{data.view.id}</Link> <StatusBadge s={data.view.status} /> {data.view.manual_bypass && <Badge tone="amber">nhập tay</Badge>} {data.agent_run && <Link className="text-primary hover:underline text-sm" to={`/agent-runs/${data.agent_run.id}`}>vết Agent CIO ({data.agent_run.model?.model}, prompt {data.agent_run.prompt_version})</Link>}</p>
        {data.view.cio_edits.length > 0 ? <ul className="text-[13px] space-y-0.5">{data.view.cio_edits.map((e: any, i: number) => <li key={i}><span className="mono">{e.key}</span> · {e.kind}{e.before ? ` · mức ${e.before.level}` : ''}{e.after ? ` → ${e.after.level}` : ''} · {e.by}{e.note ? ` · ${e.note}` : ''}</li>)}</ul> : <p className="text-fgm text-[13px]">CIO không sửa dòng nào.</p>}
      </Step>
      <Step n={5} title="Phản biện và phản hồi của CIO">
        {data.challenges.map((c: any) => <div key={c.id} className="mb-2"><div className="mono text-fgm text-xs">{c.id} · {c.stage}</div><ul className="text-[13px]">{c.findings.map((f: any) => { const r = data.responses.find((x: any) => x.finding_id === f.finding_id); return <li key={f.finding_id} className="py-0.5"><SevBadge s={f.severity} /> <span className="mono">{f.check}</span> {f.target}: {f.issue}{r && <span className="text-green"> → {r.response}: {r.comment}</span>}</li> })}</ul></div>)}
        {data.challenges.length === 0 && <p className="text-fgm">Không hiển thị cho vai trò này.</p>}
      </Step>
      <Step n={6} title="Quyết định của CIO">{data.decisions.map((d: any) => <Kv key={d.id} k={<b>{d.action}</b>} v={<span className="text-xs">{d.by} · {ts(d.at)} · {d.reason}</span>} />)}</Step>
      <Step n={7} title="Sự kiện và tin nguồn">
        <p className="mb-1"><span className="mono">{data.event.id}</span> {data.event.title}</p>
        <ul className="text-[13px] space-y-1">{data.news.map((n: any) => <li key={n.id}><span className="mono text-fgm">{n.id}</span> {n.title} · <a className="text-primary hover:underline" href={n.url} target="_blank" rel="noreferrer">{n.url}</a> · công bố {ts(n.published_at)}</li>)}</ul>
      </Step>
      {data.audit.length > 0 && <Step n={8} title="Bản ghi nhật ký liên quan"><ul className="text-xs space-y-0.5">{data.audit.map((a: any) => <li key={a.seq}><span className="num">#{a.seq}</span> {ts(a.ts)} · <span className="mono">{a.action}</span> · {a.actor} · <span className="mono text-fgm">{a.hash.slice(0, 10)}…</span></li>)}</ul></Step>}
      {how && <HowCalcModal result={fi} onClose={() => setHow(false)} />}
    </>
  )
}

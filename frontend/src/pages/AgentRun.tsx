// Vết các bước của một lượt chạy Agent CIO (FR-312)
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge, Card, ErrorBox, Loading, ts, useApi } from '../ui'

const NODE: Record<string, string> = { data: 'Dữ liệu thị trường (xác định)', analyst_macro: 'Phân tích: Vĩ mô và lãi suất', analyst_equity: 'Phân tích: Cổ phiếu và quỹ', analyst_credit_re: 'Phân tích: Tín dụng và bất động sản', analyst_commodity: 'Phân tích: Hàng hóa và tài sản khác', debate: 'Tranh luận tăng/giảm', synthesize: 'Tổng hợp', validate: 'Kiểm tra schema' }

export default function AgentRun() {
  const { id } = useParams()
  const { data, error } = useApi(`/api/agent-runs/${id}`)
  const [open, setOpen] = useState<string | null>(null)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const r = data.run
  return (
    <>
      <h1 className="text-xl font-semibold">Vết chạy <span className="mono">{r.id}</span></h1>
      <p className="text-fgm text-[13px]">Chế độ {r.mode} · mô hình {r.model?.model} · prompt {r.prompt_version} · {ts(r.created_at)} · {r.ok ? <Badge tone="green">hợp lệ</Badge> : <Badge tone="red">lỗi</Badge>}</p>
      <div className="flex flex-wrap items-center gap-1 text-xs text-fgm">dữ liệu → [4 nhóm phân tích song song] → tranh luận → tổng hợp → kiểm tra schema (thử lại ≤ 2 lần)</div>
      <div className="space-y-2">{data.nodes.map((n: any) => (
        <Card key={n.id} title={<span className="flex items-center gap-2"><span className="text-fgm">{n.seq}.</span>{NODE[n.node] ?? n.node}<span className="mono text-fgm text-xs">{n.model}</span></span>} actions={<button className="text-primary text-sm" onClick={() => setOpen(open === n.id ? null : n.id)}>{open === n.id ? 'Thu gọn' : 'Xem đầu vào, đầu ra, prompt'}</button>}>
          {n.node === 'debate' && n.output?.topics?.length > 0 && <div className="space-y-2">{n.output.topics.map((t: any) => <div key={t.key} className="text-[13px] border border-border rounded-md p-2"><div className="mono text-fgm">{t.key}</div>{t.rounds.map((rd: any, i: number) => <div key={i} className="mt-1"><div><b className="text-green">Tăng:</b> {rd.bull}</div><div><b className="text-red">Giảm:</b> {rd.bear}</div></div>)}<div className="mt-1"><b>Kết luận:</b> {t.conclusion} {t.agreed === false && <Badge tone="amber">không thống nhất – độ tin cậy thấp</Badge>}</div></div>)}</div>}
          {n.node === 'debate' && n.output?.skipped && <p className="text-fgm text-[13px]">{n.output.reason}</p>}
          {n.node.startsWith('analyst_') && <ul className="text-[13px] space-y-0.5">{(n.output?.lines ?? []).filter((l: any) => l.level !== 0).map((l: any, i: number) => <li key={i}><span className="mono">{l.scope}:{l.asset_class ?? ''}:{l.target}</span> mức {l.level} – {l.rationale}</li>)}{(n.output?.lines ?? []).every((l: any) => l.level === 0) && <li className="text-fgm">Không có dòng có tác động</li>}</ul>}
          {n.node === 'validate' && <p className="text-[13px]">{n.output.ok ? 'Đúng schema Mục 7.3' : `Sai: ${n.output.errors.join('; ')}`}{n.output.removed_restricted?.length ? ` · loại dòng hạn chế ${n.output.removed_restricted.join(', ')}` : ''}</p>}
          {open === n.id && <div className="grid lg:grid-cols-2 gap-2 mt-2">
            <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-96 whitespace-pre-wrap">{'ĐẦU VÀO\n' + JSON.stringify(n.input, null, 1)}</pre>
            <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-96 whitespace-pre-wrap">{'ĐẦU RA\n' + JSON.stringify(n.output, null, 1)}{n.prompt ? `\n\nPROMPT (${n.prompt_version})\n${n.prompt}` : ''}</pre>
          </div>}
        </Card>
      ))}</div>
    </>
  )
}

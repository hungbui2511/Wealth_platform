import { Badge, Card, ErrorBox, Kv, Loading, ts, useApi } from '../ui'

export default function Agents() {
  const { data, error } = useApi<any[]>('/api/agents')
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  return (
    <>
      <h1 className="text-xl font-semibold">Danh mục agent</h1>
      <p className="text-fgm text-[13px]">Kiểm kê ứng dụng AI: mỗi agent có chủ sở hữu, mức rủi ro và giám sát của con người (tham khảo hướng dẫn quản trị rủi ro AI của MAS; nghĩa vụ theo pháp luật Việt Nam cần pháp chế xác minh).</p>
      {data.map(a => (
        <Card key={a.id} title={<span className="flex items-center gap-2">{a.name}<Badge>{a.mode}</Badge></span>}>
          <Kv k="Mục đích" v={a.purpose} /><Kv k="Chủ sở hữu" v={a.owner} /><Kv k="Mức rủi ro" v={a.risk} />
          <Kv k="Mô hình đang dùng" v={<span className="mono">{a.model.provider}/{a.model.model} (effort {a.model.effort}) · {a.model_version}</span>} />
          <Kv k="Phiên bản prompt" v={<span className="mono">{a.prompt_version} ({a.prompt_set})</span>} />
          <Kv k="Ngày đánh giá gần nhất" v={a.last_evaluated} /><Kv k="Lượt chạy gần nhất" v={ts(a.last_run)} />
          {a.graph && <div className="mt-2 text-[13px]"><div className="text-fgm">Các nút của đồ thị</div><div className="flex flex-wrap gap-1 mt-1">{a.graph.nodes.map((n: string) => <Badge key={n} tone="primary">{n}</Badge>)}</div><p className="text-fgm mt-1">{a.graph.description}</p></div>}
          {a.references && <div className="mt-2 text-[13px]"><div className="text-fgm">Mã nguồn tham chiếu</div>{a.references.map((r: any) => <div key={r.repo}><span className="mono">{r.repo}</span> <Badge>{r.license}</Badge> – {r.use}</div>)}</div>}
        </Card>
      ))}
    </>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, apiJob } from '../api'
import { useUser } from '../App'
import { Badge, Btn, Card, duration, ErrorBox, Loading, Note, ts, useApi } from '../ui'

const TOPIC: Record<string, string> = { TAX_SECURITIES: 'Thuế chứng khoán', PROPERTY_LAND: 'Thuế, đất đai, BĐS', INHERITANCE_GIFT: 'Thừa kế, tặng cho', CORPORATE_HOLDING: 'Doanh nghiệp, holding', FX_OFFSHORE: 'Ngoại hối', GOLD: 'Vàng', DIGITAL_ASSET: 'Tài sản mã hóa', CREDIT: 'Tín dụng', INSURANCE: 'Bảo hiểm' }
const IMP: Record<string, [string, string]> = { high: ['red', 'Quan trọng cao'], medium: ['amber', 'Quan trọng vừa'], low: ['primary', 'Quan trọng thấp'] }
const ACTION: Record<string, string> = { analyze_now: 'Đề xuất phân tích ngay', monitor: 'Đề xuất theo dõi', ignore: 'Đề xuất bỏ qua' }
const STAGE: Record<string, string> = { lay_y_kien: 'Đang lấy ý kiến', tham_dinh: 'Đang thẩm định', trinh_quoc_hoi: 'Trình Quốc hội', thao_luan_quoc_hoi: 'Quốc hội thảo luận', thong_qua: 'Đã thông qua', ban_hanh: 'Đã ban hành', co_hieu_luc: 'Đã có hiệu lực' }
const DOCT: Record<string, string> = { luat: 'Luật', nghi_quyet: 'Nghị quyết', nghi_dinh: 'Nghị định', thong_tu: 'Thông tư', quyet_dinh: 'Quyết định', khac: 'Văn bản khác' }
const rank = (d: any) => d.ai_assessment ? ({ high: 0, medium: 1, low: 2 } as Record<string, number>)[d.ai_assessment.importance] * 100 - d.ai_assessment.score : 300

const STATE: Record<string, [string, string]> = { PENDING_SOURCE_CONFIRM: ['amber', 'Chờ Tuân thủ xác nhận nguồn'], SOURCE_CONFIRMED: ['primary', 'Đã xác nhận nguồn'], ANALYZED: ['green', 'Đã phân tích'], ERROR: ['red', 'Lỗi tóm tắt'] }

export default function PolicyRadar() {
  const user = useUser()
  const { data, error, reload } = useApi('/api/policies')
  const [open, setOpen] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const act = (fn: () => Promise<unknown>) => async () => { setErr(null); try { await fn(); reload() } catch (e) { setErr(e) } }
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  return (
    <>
      <div className="flex justify-between flex-wrap gap-2 items-center"><h1 className="text-xl font-semibold">Radar chính sách</h1>{user.role === 'ADMIN' && <Btn onClick={act(() => api('/api/admin/load-sample-policies', { method: 'POST' }))}>Nạp gói văn bản</Btn>}</div>
      <Note>Lợi thế đến từ tốc độ và chiều sâu phân tích trên nguồn công khai. Agent Chính sách chỉ đọc văn bản đã được Tuân thủ xác nhận nguồn, không nhận dữ liệu danh mục; khớp gia đình bị chạm bằng quy tắc xác định (BR-30). {user.role === 'RM' && 'RM chỉ thấy gia đình mình phụ trách.'}</Note>
      <ErrorBox error={err} />
      {data.documents.length === 0 && <p className="text-fgm">Chưa có văn bản. Quản trị nạp gói văn bản do người yêu cầu cung cấp (hoặc gói giả lập).</p>}
      {[...data.documents].sort((a: any, b: any) => (a.state === 'ANALYZED' ? 1 : 0) - (b.state === 'ANALYZED' ? 1 : 0) || rank(a) - rank(b)).map((d: any) => (
        <Card key={d.id} title={<span className="flex flex-wrap items-center gap-2"><span className="mono text-fgm">{d.id}</span>{d.title}</span>} actions={<>
          {d.ai_assessment && <Badge tone={IMP[d.ai_assessment.importance][0]}>{IMP[d.ai_assessment.importance][1]} · {d.ai_assessment.score}/10</Badge>}
          <Badge tone={STATE[d.state][0]}>{STATE[d.state][1]}</Badge>
          {user.role === 'COMPLIANCE' && d.state === 'PENDING_SOURCE_CONFIRM' && <Btn small onClick={act(() => api(`/api/policies/${d.id}/confirm-source`, { method: 'POST', body: { note: 'Đã kiểm tra đường dẫn công khai và ngày công bố' } }))}>Xác nhận nguồn công khai</Btn>}
          {(user.role === 'ADMIN' || user.role === 'CIO') && d.state === 'SOURCE_CONFIRMED' && <Btn small onClick={act(() => apiJob(`/api/policies/${d.id}/analyze`, { method: 'POST' }))}>Chạy Agent Chính sách</Btn>}
        </>}>
          <div className="grid md:grid-cols-4 gap-3 text-[13px]">
            <div><div className="text-fgm">Cơ quan</div>{d.agency}</div>
            <div><div className="text-fgm">Loại, trạng thái</div>{d.kind === 'draft' ? 'Dự thảo' : 'Đã ban hành'} · {d.status}</div>
            <div><div className="text-fgm">Công bố / hiệu lực dự kiến</div>{ts(d.published_at)} · {d.effective_expected ?? '—'}</div>
            <div><div className="text-fgm">Đường dẫn công khai</div><a className="text-primary hover:underline break-all" href={d.url} target="_blank" rel="noreferrer">{new URL(d.url).hostname}</a></div>
          </div>
          <div className="flex flex-wrap gap-1 mt-2">{d.topics.map((t: string) => <Badge key={t}>{TOPIC[t]}</Badge>)}</div>
          {d.ai_assessment && <AiAssessment a={d.ai_assessment} />}
          {d.changes.length > 0 && <div className="mt-3 space-y-2">{d.changes.map((c: any) => <div key={c.change_id} className="border border-border rounded-md p-2 text-[13px]"><div className="flex flex-wrap gap-2 items-center"><b>{c.article_refs.join(', ')}</b><Badge tone={c.certainty === 'draft' ? 'amber' : 'green'}>{c.certainty === 'draft' ? 'dự thảo' : 'chính thức'}</Badge>{c.topics.map((t: string) => <Badge key={t}>{TOPIC[t]}</Badge>)}{c.effective_from && <span className="text-fgm">hiệu lực {c.effective_from}</span>}</div><p className="mt-1">{c.summary}</p><p className="text-fgm italic">“{c.quote}”</p><p className="text-fgm">Đối tượng: {c.affected_parties}</p></div>)}</div>}
          {d.state === 'ANALYZED' && <div className="mt-3 flex flex-wrap gap-4 items-center text-[13px]">
            <span>Gia đình bị chạm: <b>{user.role === 'RM' ? d.matched_mine : d.matched_total}</b>{user.role === 'RM' && <span className="text-fgm"> (của bạn)</span>}</span>
            <span>Thời gian từ công bố tới có hiệu lực: <b>{duration(d.reaction_ms)}</b></span>
            {d.event_id && user.role !== 'RM' && <Link className="text-primary hover:underline" to="/events">Sự kiện {d.event_id}</Link>}
            <button className="text-primary" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? 'Ẩn danh sách' : 'Xem gia đình bị chạm và lý do'}</button>
          </div>}
          {open === d.id && <Matches id={d.id} />}
        </Card>
      ))}
      <Card title="Dấu thời gian và thời gian phản ứng của mọi sự kiện (BR-29)">
        <div className="overflow-x-auto"><table className="t"><thead><tr><th>Sự kiện</th><th>Công bố</th><th>Nạp</th><th>Tạo sự kiện</th><th>Có nhận định</th><th>CIO duyệt</th><th>Hiệu lực</th><th>Thời gian phản ứng</th></tr></thead>
          <tbody>{data.events.map((e: any) => <tr key={e.id}><td><span className="mono">{e.id}</span><div className="text-fgm text-xs">{e.title}</div></td>{['published_at', 'ingested_at', 'event_created_at', 'view_ready_at', 'approved_at', 'effective_at'].map(k => <td key={k} className="text-xs">{ts(e.timestamps?.[k])}</td>)}<td className="num">{duration(e.reaction_ms)}</td></tr>)}</tbody></table></div>
      </Card>
    </>
  )
}

// Đánh giá của Agent Rà soát pháp luật: gợi ý ưu tiên do AI lập, chưa phải phân tích đã kiểm chứng trích dẫn
function AiAssessment({ a }: { a: any }) {
  return (
    <div className="mt-3 border border-border rounded-md p-3 text-[13px] space-y-1.5">
      <div className="flex flex-wrap gap-2 items-center"><b>Đánh giá của Agent Rà soát pháp luật</b><Badge>{DOCT[a.doc_type]}</Badge><Badge>{STAGE[a.stage]}</Badge>{a.comment_deadline && <span className="text-fgm">Hạn góp ý {a.comment_deadline}</span>}{a.expected_adoption && <span className="text-fgm">Dự kiến thông qua/ban hành {a.expected_adoption}</span>}<Badge tone={a.recommended_action === 'analyze_now' ? 'red' : undefined}>{ACTION[a.recommended_action]}</Badge></div>
      <div><span className="text-fgm">Vì sao thay đổi: </span>{a.why_changed}</div>
      <ul className="list-disc pl-5">{a.key_points.map((k: string, i: number) => <li key={i}>{k}</li>)}</ul>
      <div><span className="text-fgm">Tác động tới khách Private: </span>{a.impact_private}</div>
      <div><span className="text-fgm">Tác động tới ngân hàng: </span>{a.impact_tcb}</div>
      <div className="text-fgm text-xs">Nguồn: {a.sources.map((u: string, i: number) => <a key={i} className="text-primary hover:underline mr-2" href={u} target="_blank" rel="noreferrer">{new URL(u).hostname}</a>)} · AI lập ({a.model ?? 'không rõ mô hình'}), là gợi ý ưu tiên; trích dẫn điều khoản chỉ được kiểm chứng khi Agent Chính sách phân tích sau khi Tuân thủ xác nhận nguồn.</div>
    </div>
  )
}

function Matches({ id }: { id: string }) {
  const { data } = useApi(`/api/policies/${id}`)
  if (!data) return <Loading />
  return <table className="t mt-2"><thead><tr><th>Gia đình</th><th>Chủ đề khớp</th><th>Lý do</th><th className="num">Mức chạm</th></tr></thead><tbody>{data.matches.map((m: any) => <tr key={m.family_id}><td><Link className="text-primary hover:underline mono" to={`/families/${m.family_id}`}>{m.family_id}</Link></td><td>{m.topics.map((t: string) => <Badge key={t}>{TOPIC[t]}</Badge>)}</td><td className="text-xs">{m.reasons.join(' · ')}</td><td className="num">{(Number(m.touch) * 100).toFixed(0)}%</td></tr>)}</tbody></table>
}

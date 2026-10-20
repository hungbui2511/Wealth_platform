// Bàn duyệt (FR-502): nhận định bên trái, phản biện bên phải, tin nguồn bên dưới; tô nổi dòng CIO đã sửa và dòng chưa phản biện
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ASSET_CLASSES, ASSET_CLASS_LABELS, SECTORS } from '../../../src/shared/catalog'
import { api, apiJob } from '../api'
import { useUser } from '../App'
import { Badge, Btn, Card, ErrorBox, Loading, Note, SevBadge, StatusBadge, ts, useApi } from '../ui'
import { MarketMoves, OriginBadge, ScenarioPanel } from '../scenario'

const key = (l: any) => `${l.scope}:${l.asset_class ?? ''}:${l.target}`
const dirOf = (lv: number, cur?: string) => lv > 0 ? 'positive' : lv < 0 ? 'negative' : cur === 'insufficient_evidence' ? 'insufficient_evidence' : 'neutral'
const DIR: Record<string, string> = { positive: 'Tích cực', negative: 'Tiêu cực', neutral: 'Trung tính', insufficient_evidence: 'Thiếu căn cứ' }
const RESP: Record<string, string> = { accepted_fixed: 'Chấp nhận – đã sửa', disagree: 'Không đồng ý', out_of_scope: 'Ngoài phạm vi' }

export default function ViewDetail() {
  const { id } = useParams()
  const user = useUser()
  const nav = useNavigate()
  const { data, error, reload } = useApi(`/api/views/${id}`)
  const [lines, setLines] = useState<any[] | null>(null)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [includeCh, setIncludeCh] = useState(true)
  const [err, setErr] = useState<unknown>(null)
  const [resp, setResp] = useState<Record<string, any>>({})
  useEffect(() => { if (data) setLines(data.view.body.impacts.map((l: any) => ({ ...l }))) }, [data])
  if (error) return <ErrorBox error={error} />
  if (!data || !lines) return <Loading />
  const v = data.view
  const isCio = user.role === 'CIO'
  const editable = isCio && (v.status === 'PENDING_APPROVAL' || (v.status === 'PENDING_CHALLENGE' && v.unchallenged.length > 0))
  const aiKeys = new Map((v.ai_body?.impacts ?? []).map((l: any) => [key(l), l]))
  const edited = new Set(v.cio_edits.map((e: any) => e.key))
  const dirty = JSON.stringify(lines) !== JSON.stringify(v.body.impacts)
  const newsIds = data.news.map((n: any) => n.id)
  const act = (fn: () => Promise<any>) => async () => { setErr(null); try { const r = await fn(); reload(); return r } catch (e) { setErr(e) } }
  const set = (i: number, patch: any) => setLines(lines.map((l, j) => j === i ? { ...l, ...patch } : l))
  const preFindings = data.challenges.filter((c: any) => c.stage !== 'post_check')
  return (
    <>
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-semibold mono">{v.id}</h1><StatusBadge s={v.status} />{v.origin === 'manual' && <Badge tone="amber">Nhập tay, bỏ qua điều kiện duyệt (AC-05a)</Badge>}<span className="text-fgm">{data.event.title}</span>
        {v.agent_run_id && <Link className="text-primary hover:underline text-sm" to={`/agent-runs/${v.agent_run_id}`}>Xem vết chạy Agent CIO</Link>}
        {data.runs.map((r: any) => <Link key={r.id} className="text-primary hover:underline text-sm mono" to={`/runs/${r.id}`}>{r.id} <StatusBadge s={r.status} /></Link>)}
      </div>
      <ErrorBox error={err} />
      {v.status === 'AGENT_ERROR' && <ErrorBox error={{ message: 'Đầu ra sai schema sau 2 lần thử lại', details: v.errors }} />}
      {v.analysts_derived && <Note tone="warn">Nhận định được lập trong một bước: bản ghi không gửi kèm đầu ra riêng của 4 nhà phân tích, nên các nút phân tích trong vết chạy chỉ là phần cắt từ nhận định cuối và vòng tranh luận để trống.</Note>}
      {v.removed_restricted.length > 0 && <Note tone="warn">Dòng cấp mã {v.removed_restricted.map((l: any) => l.target).join(', ')} thuộc danh sách hạn chế đã bị loại ở bước kiểm tra schema (BR-27).</Note>}
      <div className="grid xl:grid-cols-[1.4fr_1fr] gap-4">
        <Card title={`Nhận định – ${v.body.summary}`} actions={editable && <><Btn small kind="secondary" onClick={() => setLines([...lines, { scope: 'sector', asset_class: 'EQ_VN', target: 'BANK', level: 0, direction: 'neutral', rationale: '', source_ids: [] }])}>+ Dòng ngành</Btn><Btn small kind="secondary" onClick={() => setLines([...lines, { scope: 'instrument', asset_class: 'EQ_VN', target: '', level: 0, direction: 'neutral', rationale: '', source_ids: [] }])}>+ Dòng mã</Btn></>}>
          <div className="overflow-x-auto"><table className="t">
            <thead><tr><th>Dòng</th><th>Mức</th><th>Hướng</th><th>Khung / tin cậy</th><th>Lập luận, nguồn</th></tr></thead>
            <tbody>{lines.map((l, i) => {
              const k = key(l), unch = v.unchallenged.includes(k), ed = edited.has(k) || !aiKeys.has(k)
              return (
                <tr key={i} className={unch ? 'bg-amber/10' : ed && v.ai_body ? 'bg-primary/10' : ''}>
                  <td className="text-xs min-w-40">
                    {editable && l.scope === 'sector' && !v.body.impacts.some((x: any) => key(x) === k) ? (
                      <div className="flex flex-col gap-1"><select value={l.asset_class} onChange={e => set(i, { asset_class: e.target.value })}>{ASSET_CLASSES.map(a => <option key={a}>{a}</option>)}</select><select value={l.target} onChange={e => set(i, { target: e.target.value })}>{SECTORS.map(s => <option key={s}>{s}</option>)}</select></div>
                    ) : editable && l.scope === 'instrument' && !v.body.impacts.some((x: any) => key(x) === k) ? (
                      <div className="flex flex-col gap-1"><select value={l.asset_class} onChange={e => set(i, { asset_class: e.target.value })}>{ASSET_CLASSES.map(a => <option key={a}>{a}</option>)}</select><input placeholder="Mã công cụ" value={l.target} onChange={e => set(i, { target: e.target.value.toUpperCase() })} /></div>
                    ) : <><div>{l.scope === 'asset_class' ? (ASSET_CLASS_LABELS as any)[l.target] : l.scope === 'fx' ? `Tỷ giá ${l.target}/VND` : l.scope === 'sector' ? `Ngành ${l.target} (${l.asset_class})` : `Mã ${l.target}`}</div><div className="mono text-fgm">{k}</div></>}
                    {unch && <Badge tone="amber">chờ phản biện lại</Badge>}{ed && v.ai_body && <Badge tone="primary">CIO sửa</Badge>}{l.cio_judgment && <Badge tone="primary">Nhận định của CIO</Badge>}
                  </td>
                  <td>{editable ? <select value={l.level} onChange={e => { const lv = Number(e.target.value); set(i, { level: lv, direction: dirOf(lv, l.direction), ...(lv !== 0 ? { horizon: l.horizon ?? '1-3 tháng', confidence: l.confidence ?? 'medium' } : {}) }) }}>{[-3, -2, -1, 0, 1, 2, 3].map(x => <option key={x} value={x}>{x > 0 ? `+${x}` : x}</option>)}</select> : <span className="num font-medium">{l.level > 0 ? `+${l.level}` : l.level}</span>}</td>
                  <td className="text-xs">{editable && l.level === 0 ? <select value={l.direction} onChange={e => set(i, { direction: e.target.value })}><option value="neutral">Trung tính</option><option value="insufficient_evidence">Thiếu căn cứ</option></select> : DIR[l.direction]}</td>
                  <td className="text-xs">{l.level !== 0 ? (editable ? <div className="flex flex-col gap-1"><select value={l.horizon} onChange={e => set(i, { horizon: e.target.value })}>{['<1 tháng', '1-3 tháng', '3-6 tháng', '>6 tháng'].map(x => <option key={x}>{x}</option>)}</select><select value={l.confidence} onChange={e => set(i, { confidence: e.target.value })}><option value="low">thấp</option><option value="medium">trung bình</option><option value="high">cao</option></select></div> : <>{l.horizon}<div className="text-fgm">{{ low: 'thấp', medium: 'trung bình', high: 'cao' }[l.confidence as string]}</div></>) : '—'}</td>
                  <td className="text-xs min-w-64">{editable ? <div className="flex flex-col gap-1">
                    <textarea rows={2} value={l.rationale} onChange={e => set(i, { rationale: e.target.value })} />
                    <div className="flex flex-wrap gap-2">{newsIds.map((n: string) => <label key={n} className="flex items-center gap-1"><input type="checkbox" checked={l.source_ids.includes(n)} onChange={e => set(i, { source_ids: e.target.checked ? [...l.source_ids, n] : l.source_ids.filter((x: string) => x !== n) })} /><span className="mono">{n}</span></label>)}</div>
                    {l.level !== 0 && l.source_ids.length === 0 && <input placeholder="Ghi chú của CIO (bắt buộc khi không có nguồn)" value={l.cio_note ?? ''} onChange={e => set(i, { cio_note: e.target.value })} />}
                    {(l.scope === 'sector' || l.scope === 'instrument') && !v.body.impacts.some((x: any) => key(x) === k) && <Btn small kind="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Bỏ dòng</Btn>}
                  </div> : <>{l.rationale}<div className="mono text-fgm">{l.source_ids.join(', ') || 'không nguồn'}</div>{l.cio_note && <div className="text-primary">CIO: {l.cio_note}</div>}</>}</td>
                </tr>
              )
            })}</tbody>
          </table></div>
          {editable && <div className="flex flex-wrap gap-2 items-center mt-3"><input className="flex-1 min-w-60" placeholder="Ghi chú khi sửa (gửi kèm cho phản biện lại)" value={note} onChange={e => setNote(e.target.value)} /><Btn disabled={!dirty} onClick={act(() => api(`/api/views/${v.id}/lines`, { method: 'PUT', body: { impacts: lines, note } }))}>Lưu chỉnh sửa</Btn><Btn kind="secondary" disabled={!dirty} onClick={() => setLines(v.body.impacts)}>Hoàn tác</Btn></div>}
          <p className="text-fgm text-xs mt-2">Agent chỉ chọn mức −3..+3; tỷ lệ % cú sốc lấy từ bảng u do CIO cấu hình. Sửa hướng, mức, thêm hoặc bớt dòng phải phản biện lại; sửa lập luận thì không.</p>
        </Card>
        <div className="space-y-4">
          {preFindings.map((c: any) => (
            <Card key={c.id} title={<span>{c.stage === 'pre_approval' ? 'Phản biện trước duyệt' : `Phản biện lại (${c.lines?.join(', ')})`} <span className="mono text-fgm text-xs">{c.id}</span></span>}>
              <div className="text-fgm text-xs mb-2">Mô hình: {c.model} · {ts(c.created_at)}</div>
              {c.findings.length === 0 && <p className="text-fgm">Không có phát hiện.</p>}
              <ul className="space-y-3">{c.findings.map((f: any) => {
                const r = data.responses.find((x: any) => x.finding_id === f.finding_id)
                const form = resp[f.finding_id] ?? { response: 'accepted_fixed', fixed_line: '', comment: '' }
                return (
                  <li key={f.finding_id} className="border border-border rounded-md p-2 text-[13px]">
                    <div className="flex flex-wrap gap-1.5 items-center"><SevBadge s={f.severity} /><Badge>{f.origin === 'rule' ? 'quy tắc' : 'agent'}</Badge><span className="mono text-fgm">{f.check}</span><span className="mono text-fgm">→ {f.target}</span></div>
                    <p className="mt-1">{f.issue}</p><p className="text-fgm mt-1">Đề xuất: {f.suggestion}</p>{f.source_ids?.length > 0 && <p className="mono text-fgm">Nguồn: {f.source_ids.join(', ')}</p>}
                    {r ? <div className="mt-1 text-green">Phản hồi: {RESP[r.response]}{r.fixed_line ? ` (${r.fixed_line})` : ''} – {r.comment}</div> : isCio && f.severity === 'critical' && ['PENDING_APPROVAL', 'PENDING_CHALLENGE'].includes(v.status) && (
                      <div className="mt-2 flex flex-col gap-1">
                        <select value={form.response} onChange={e => setResp({ ...resp, [f.finding_id]: { ...form, response: e.target.value } })}>{Object.entries(RESP).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select>
                        {form.response === 'accepted_fixed' && <select value={form.fixed_line} onChange={e => setResp({ ...resp, [f.finding_id]: { ...form, fixed_line: e.target.value } })}><option value="">Chọn dòng đã sửa</option>{v.body.scenarios && <option value="scenarios">Nhánh kịch bản (scenarios)</option>}{v.body.impacts.map((l: any) => <option key={key(l)} value={key(l)}>{key(l)}</option>)}</select>}
                        <input placeholder={form.response === 'accepted_fixed' ? 'Ghi chú tối thiểu 20 ký tự' : 'Căn cứ không đồng ý, tối thiểu 60 ký tự'} value={form.comment} onChange={e => setResp({ ...resp, [f.finding_id]: { ...form, comment: e.target.value } })} />
                        <Btn small onClick={act(() => api(`/api/views/${v.id}/findings/${f.finding_id}/response`, { method: 'POST', body: form }))}>Gửi phản hồi</Btn>
                      </div>
                    )}
                  </li>
                )
              })}</ul>
              {c.counter_scenario && <p className="text-[13px] mt-3"><b>Kịch bản phản đề:</b> {c.counter_scenario}</p>}
              {c.independence && <p className="text-[12px] mt-2 text-fgm"><Badge tone={c.independence.independent ? (c.independence.self_declared ? 'amber' : 'green') : 'red'}>{c.independence.independent ? (c.independence.self_declared ? 'Độc lập (tự khai)' : 'Độc lập') : 'Chưa độc lập'}</Badge> {c.independence.reason}</p>}
            </Card>
          ))}
          {isCio && ['PENDING_APPROVAL', 'PENDING_CHALLENGE'].includes(v.status) && (
            <Card title="Quyết định của CIO">
              {v.status === 'PENDING_CHALLENGE' && v.unchallenged.length === 0 && !data.challenges.some((c: any) => c.stage === 'pre_approval') && <div className="mb-3"><Note tone="warn">Chưa có báo cáo phản biện (Agent Phản biện lỗi hoặc chưa chạy). Nút Duyệt chỉ mở khi có báo cáo.</Note><div className="mt-2"><Btn onClick={act(() => apiJob(`/api/views/${v.id}/challenge`, { method: 'POST' }))}>Chạy lại phản biện</Btn></div></div>}
              {v.status === 'PENDING_CHALLENGE' && v.unchallenged.length > 0 && <div className="mb-3"><Note tone="warn">Các dòng {v.unchallenged.join(', ')} phải được phản biện lại trước khi nút Duyệt mở.</Note><div className="mt-2"><Btn onClick={act(() => apiJob(`/api/views/${v.id}/rechallenge`, { method: 'POST' }))}>Chạy phản biện lại</Btn></div></div>}
              {!data.conditions.ok && <div className="mb-2"><div className="text-[13px] text-amber mb-1">Điều kiện duyệt còn thiếu (BR-02):</div><ul className="list-disc ml-5 text-[13px] text-amber">{data.conditions.missing.map((m: string) => <li key={m}>{m}</li>)}</ul></div>}
              <textarea rows={2} className="w-full" placeholder="Lý do (tối thiểu 20 ký tự)" value={reason} onChange={e => setReason(e.target.value)} />
              <label className="flex items-center gap-2 text-[13px] my-2"><input type="checkbox" checked={includeCh} onChange={e => setIncludeCh(e.target.checked)} />Khi Làm lại: gửi kèm phản biện cho Agent CIO</label>
              <div className="flex flex-wrap gap-2">
                <Btn disabled={!data.conditions.ok || reason.trim().length < 20} title={!data.conditions.ok ? data.conditions.missing.join('; ') : undefined} onClick={act(async () => { const r = await api(`/api/views/${v.id}/decision`, { method: 'POST', body: { action: 'APPROVE', reason } }); if (r.run_id) nav(`/runs/${r.run_id}`) })}>Duyệt và áp dụng</Btn>
                <Btn kind="secondary" onClick={act(async () => { const r: any = await apiJob(`/api/views/${v.id}/decision`, { method: 'POST', body: { action: 'REWORK', reason, include_challenge: includeCh } }); const nid = r.new_view?.id ?? r.view_id; if (nid && nid !== v.id) nav(`/views/${nid}`) })}>Làm lại</Btn>
                <Btn kind="danger" onClick={act(() => api(`/api/views/${v.id}/decision`, { method: 'POST', body: { action: 'REJECT', reason } }))}>Bác</Btn>
              </div>
              <p className="text-fgm text-xs mt-2">Thử bấm Duyệt khi điều kiện chưa đủ: máy chủ từ chối và liệt kê điều kiện thiếu.</p>
              {!data.conditions.ok && <Btn small kind="ghost" onClick={act(() => api(`/api/views/${v.id}/decision`, { method: 'POST', body: { action: 'APPROVE', reason: reason || 'Thử duyệt khi chưa đủ điều kiện' } }))}>Thử duyệt (để xem máy chủ từ chối)</Btn>}
            </Card>
          )}
          {isCio && v.status === 'APPROVED' && <Card title="Thu hồi"><textarea rows={2} className="w-full" placeholder="Lý do thu hồi (tối thiểu 20 ký tự)" value={reason} onChange={e => setReason(e.target.value)} /><div className="mt-2"><Btn kind="danger" onClick={act(() => api(`/api/views/${v.id}/withdraw`, { method: 'POST', body: { reason } }))}>Thu hồi nhận định</Btn></div></Card>}
          {data.decisions.length > 0 && <Card title="Quyết định">{data.decisions.map((d: any) => <div key={d.id} className="text-[13px] py-1 border-b border-[#1e2537]"><b>{d.action}</b> · {d.by} · {ts(d.at)}<div className="text-fgm">{d.reason}</div></div>)}</Card>}
        </div>
      </div>
      <MarketMoves eventId={v.event_id} />
      <ScenarioPanel viewId={v.id} scenarios={v.body.scenarios} preview={data.scenario_preview} editable={isCio && ['PENDING_APPROVAL', 'PENDING_CHALLENGE'].includes(v.status)} newsIds={newsIds} onSaved={reload} />
      <Card title="Tin nguồn của sự kiện">
        <ul className="space-y-2">{data.news.map((n: any) => <li key={n.id} className="text-[13px]"><span className="mono text-fgm">{n.id}</span> <OriginBadge o={n.origin} /> <b>{n.title}</b> · <a className="text-primary hover:underline" href={n.url} target="_blank" rel="noreferrer">{n.source}</a> · {ts(n.published_at)}<div className="text-fgm">{n.summary}</div></li>)}</ul>
      </Card>
      <Card title="Lịch sử trạng thái"><ul className="text-[13px] space-y-0.5">{v.history.map((h: any, i: number) => <li key={i}>{ts(h.at)} · {h.from || '∅'} → <b>{h.to}</b> · {h.by}{h.note ? ` · ${h.note}` : ''}</li>)}</ul></Card>
    </>
  )
}

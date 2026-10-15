// Thiết kế v2: nhánh kịch bản (agent đề xuất, CIO duyệt) và dải tác động P5/P10/P50/P90 cho từng gia đình
import { useEffect, useState } from 'react'
import { DEFAULT_FACTOR_MODEL } from '../../src/data/factorModel'
import { ASSET_CLASS_LABELS } from '../../src/shared/catalog'
import { api } from './api'
import { Badge, Btn, Card, ErrorBox, fmtPct, Money, Note } from './ui'

export const FACTOR: Record<string, { label: string; unit: string; origin: string }> = Object.fromEntries(DEFAULT_FACTOR_MODEL.factors.map(f => [f.id, { label: f.label, unit: f.unit, origin: f.origin }]))
const ORIGIN: Record<string, [string, string]> = { global: ['primary', 'Quốc tế'], local: ['green', 'Trong nước'], exclusive: ['amber', 'Độc quyền TCB'] }
export function OriginBadge({ o }: { o?: string }) { if (!o) return null; const a = ORIGIN[o] ?? ['low', o]; return <Badge tone={a[0]}>{a[1]}</Badge> }
const SIZE: Record<string, string> = { S: 'nhỏ', M: 'vừa', L: 'lớn' }
const fmtShock = (v: number, unit: string) => `${v > 0 ? '+' : ''}${Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2).replace(/\.?0+$/, '')} ${unit === '%' ? '%' : unit}`
const ACL: Record<string, string> = { ...ASSET_CLASS_LABELS, LIABILITY: 'Khoản vay ngoại tệ' }

// Hiển thị cú sốc: thanh ngang theo độ lệch chuẩn của yếu tố để so được các đơn vị khác nhau
function ShockBars({ shocks, core }: { shocks: Record<string, number>; core: string[] }) {
  const rows = DEFAULT_FACTOR_MODEL.factors.map(f => ({ f, v: shocks[f.id] ?? 0, z: (shocks[f.id] ?? 0) / (f.vol.calm || 1) })).filter(r => Math.abs(r.z) >= 0.05)
  const max = Math.max(1, ...rows.map(r => Math.abs(r.z)))
  return (
    <div className="space-y-1">{rows.map(({ f, v, z }) => (
      <div key={f.id} className="grid grid-cols-[minmax(0,13rem)_1fr_5.5rem] gap-2 items-center text-[12.5px]">
        <span className="truncate" title={f.label}>{core.includes(f.id) ? <b>{f.label}</b> : f.label} {core.includes(f.id) && <Badge tone="primary">lõi</Badge>}</span>
        <div className="relative h-3 bg-muted rounded"><div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
          <div className={`absolute top-0 bottom-0 rounded ${v < 0 ? 'bg-red/70' : 'bg-green/70'}`} style={z < 0 ? { right: '50%', width: `${Math.abs(z) / max * 50}%` } : { left: '50%', width: `${Math.abs(z) / max * 50}%` }} /></div>
        <span className="num text-right">{fmtShock(v, f.unit)}</span>
      </div>))}
    </div>
  )
}

export function ScenarioPanel({ viewId, scenarios, preview, editable, newsIds, onSaved }: { viewId: string; scenarios: any; preview: any; editable: boolean; newsIds: string[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<any>(scenarios)
  const [note, setNote] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [sel, setSel] = useState<string>('expected')
  useEffect(() => setDraft(scenarios), [scenarios])
  if (!scenarios) return <Card title="Nhánh kịch bản"><Note>Nhận định này chưa có nhánh kịch bản (thiết kế cũ, chỉ có thang −3…+3). Kết quả chỉ tính theo bảng đơn vị u.</Note></Card>
  const dirty = JSON.stringify(draft) !== JSON.stringify(scenarios)
  const sum = draft.branches.reduce((a: number, b: any) => a + Number(b.probability), 0)
  const setB = (i: number, patch: any) => setDraft({ ...draft, branches: draft.branches.map((b: any, j: number) => j === i ? { ...b, ...patch } : b) })
  const setS = (i: number, k: number, patch: any) => setB(i, { core_shocks: draft.branches[i].core_shocks.map((s: any, j: number) => j === k ? { ...s, ...patch } : s) })
  const shown = sel === 'expected' ? { shocks: preview?.expected ?? {}, core: [...new Set(preview?.branches?.flatMap((b: any) => b.core) ?? [])] as string[] } : preview?.branches?.find((b: any) => b.id === sel)
  return (
    <Card title={<span className="flex items-center gap-2">Nhánh kịch bản <Badge tone="primary">thiết kế v2</Badge><span className="text-fgm text-xs font-normal">Thị trường đã phản ánh: {{ none: 'chưa', partial: 'một phần (cú sốc ×0,5)', full: 'toàn bộ (cú sốc ×0)' }[draft.priced_in as string]}</span></span>}>
      <div className="overflow-x-auto"><table className="t">
        <thead><tr><th>Nhánh</th><th className="num">Xác suất</th><th>Chế độ</th><th>Yếu tố lõi (cỡ trong thư viện CIO)</th><th>Lập luận, nguồn</th></tr></thead>
        <tbody>{draft.branches.map((b: any, i: number) => (
          <tr key={b.id}>
            <td className="text-[13px] min-w-40"><b className="mono">{b.id}</b> {b.name}</td>
            <td className="num">{editable ? <input type="number" step="0.05" min="0.05" max="0.95" className="w-20" value={b.probability} onChange={e => setB(i, { probability: Number(e.target.value) })} /> : `${Math.round(b.probability * 100)}%`}</td>
            <td className="text-xs">{editable ? <select value={b.regime} onChange={e => setB(i, { regime: e.target.value })}><option value="calm">bình thường</option><option value="stress">căng thẳng</option></select> : b.regime === 'stress' ? <Badge tone="red">căng thẳng</Badge> : <Badge>bình thường</Badge>}</td>
            <td className="text-xs min-w-64">{b.core_shocks.map((s: any, k: number) => {
              const f = DEFAULT_FACTOR_MODEL.factors.find(x => x.id === s.factor)
              const val = f ? (s.direction === 'up' ? 1 : -1) * (f.library as any)[s.size] : 0
              return <div key={k} className="flex items-center gap-1 py-0.5"><span className={s.direction === 'up' ? 'text-green' : 'text-red'}>{s.direction === 'up' ? '▲' : '▼'}</span><span>{FACTOR[s.factor]?.label ?? s.factor}</span>
                {editable ? <select value={s.size} onChange={e => setS(i, k, { size: e.target.value })}>{['S', 'M', 'L'].map(z => <option key={z} value={z}>{SIZE[z]}</option>)}</select> : <span className="text-fgm">cỡ {SIZE[s.size]}</span>}
                {f && <span className="num text-fgm">({fmtShock(val, f.unit)})</span>}</div>
            })}</td>
            <td className="text-xs min-w-56">{b.rationale}<div className="mono text-fgm">{b.source_ids.join(', ')}</div></td>
          </tr>))}</tbody>
      </table></div>
      {scenarios.notes && <p className="text-fgm text-xs mt-1">{scenarios.notes}</p>}
      {editable && <div className="flex flex-wrap gap-2 items-center mt-2">
        <span className={`text-xs ${Math.abs(sum - 1) > 0.011 ? 'text-red' : 'text-fgm'}`}>Tổng xác suất {sum.toFixed(2)}</span>
        <input className="flex-1 min-w-60" placeholder="Lý do sửa kịch bản (tối thiểu 20 ký tự)" value={note} onChange={e => setNote(e.target.value)} />
        <Btn disabled={!dirty} onClick={async () => { setErr(null); try { await api(`/api/views/${viewId}/scenarios`, { method: 'PUT', body: { scenarios: draft, note } }); onSaved() } catch (e) { setErr(e) } }}>Lưu kịch bản</Btn>
        <Btn kind="secondary" disabled={!dirty} onClick={() => setDraft(scenarios)}>Hoàn tác</Btn>
      </div>}
      <ErrorBox error={err} />
      {preview && !preview.error && <div className="mt-4">
        <div className="flex flex-wrap gap-2 items-center mb-2 text-[13px]"><span className="text-fgm">Cú sốc lan truyền theo tương quan (máy tính, không phải AI):</span>
          {[{ id: 'expected', label: 'Kỳ vọng theo xác suất' }, ...preview.branches.map((b: any) => ({ id: b.id, label: `${b.id} – ${b.name}` }))].map(o => <button key={o.id} onClick={() => setSel(o.id)} className={`border rounded px-2 py-0.5 ${sel === o.id ? 'border-primary text-fg' : 'border-border text-fgm'}`}>{o.label}</button>)}</div>
        {shown && <ShockBars shocks={shown.shocks} core={shown.core} />}
        <p className="text-fgm text-xs mt-2">Yếu tố lõi do agent chọn, cỡ cú sốc lấy từ thư viện CIO duyệt. Các yếu tố còn lại suy ra bằng kỳ vọng có điều kiện trên ma trận tương quan {preview.model_id} (ước lượng từ dữ liệu tháng 2022–2026 cho lợi suất Mỹ, USD, cổ phiếu, dầu, vàng, tỷ giá, lãi suất NHNN, VN-Index, chênh lệch SJC; beta cổ phiếu từ giá tuần TCBS; phần còn lại là giả định). Độ dài thanh tính theo độ lệch chuẩn tháng của từng yếu tố.</p>
      </div>}
      {preview?.error && <ErrorBox error={{ message: preview.error }} />}
    </Card>
  )
}

export function FamilyScenarioCard({ s }: { s: any }) {
  if (!s) return null
  const factors = Object.entries(s.by_factor as Record<string, number>).filter(([, v]) => Math.abs(v) >= 1).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  const maxF = Math.max(1, ...factors.map(([, v]) => Math.abs(v)))
  const classes = Object.entries(s.by_asset_class as Record<string, number>).filter(([, v]) => Math.abs(v) >= 1).sort((a, b) => a[1] - b[1])
  return (
    <Card title={<span className="flex flex-wrap items-center gap-2">Dải tác động theo kịch bản <Badge tone="primary">thiết kế v2</Badge>{s.lane2.route === 'RM_REVIEW' ? <Badge tone="red">Luồng 2: chuyển RM xem trước</Badge> : <Badge tone="green">Luồng 2: gửi theo mẫu đã duyệt</Badge>}</span>}>
      <div className="overflow-x-auto"><table className="t">
        <thead><tr><th>Kỳ hạn</th><th className="num">P5 (rất xấu)</th><th className="num">P10 (xấu)</th><th className="num">P50 (trung vị)</th><th className="num">P90 (tốt)</th></tr></thead>
        <tbody>{s.ranges.map((r: any) => <tr key={r.horizon}><td>{r.horizon}</td>
          {(r.severe !== undefined ? ['severe', 'bad', 'base', 'good'] as const : ['bad', 'base', 'good'] as const).map(k => <td key={k} className="num"><Money v={r[k]} short /><div className="text-fgm text-xs">{fmtPct(r[`${k}_pct`], 2)}</div></td>)}</tr>)}</tbody>
      </table></div>
      <p className="text-fgm text-xs mt-1">{s.lane2.reason}</p>
      <div className="grid md:grid-cols-2 gap-4 mt-3">
        <div><div className="text-[13px] font-medium mb-1">Đóng góp theo yếu tố (kỳ vọng, 3 tháng)</div>
          {factors.map(([k, v]) => <div key={k} className="grid grid-cols-[minmax(0,12rem)_1fr_5rem] gap-2 items-center text-[12.5px] py-0.5"><span className="truncate" title={FACTOR[k]?.label}>{FACTOR[k]?.label ?? k}</span>
            <div className="h-2.5 bg-muted rounded relative"><div className={`absolute top-0 bottom-0 left-0 rounded ${v < 0 ? 'bg-red/70' : 'bg-green/70'}`} style={{ width: `${Math.abs(v) / maxF * 100}%` }} /></div><span className="num text-right"><Money v={v} short /></span></div>)}
          {!factors.length && <span className="text-fgm text-xs">Không đáng kể</span>}</div>
        <div><div className="text-[13px] font-medium mb-1">Theo loại tài sản (kỳ vọng, 3 tháng)</div>
          {classes.map(([k, v]) => <div key={k} className="flex justify-between text-[12.5px] py-0.5 border-b border-[#1e2537]"><span>{ACL[k] ?? k}</span><Money v={v} short /></div>)}
          {s.loan_cost_annual !== 0 && <div className="flex justify-between text-[12.5px] py-0.5"><span>Chi phí lãi vay VND thả nổi thay đổi/năm</span><Money v={s.loan_cost_annual} short /></div>}
          {s.model_based_share > 0.05 && <div className="mt-2"><Badge tone="amber">{Math.round(s.model_based_share * 100)}% tác động đến từ tài sản định giá theo mô hình (BĐS, CP chưa niêm yết)</Badge></div>}
        </div>
      </div>
      {s.variance_share_3m && <p className="text-fgm text-xs mt-2">Độ bất định 3 tháng gồm: tương quan còn lại {Math.round(s.variance_share_3m.residual * 100)}% · cỡ cú sốc lõi {Math.round(s.variance_share_3m.core * 100)}% · rủi ro riêng từng mã {Math.round(s.variance_share_3m.idio * 100)}%.</p>}
      <p className="text-fgm text-xs mt-1">Dải phản ánh xác suất các nhánh, độ bất định của cỡ cú sốc, cách cú sốc lan truyền theo độ dài kỳ hạn và rủi ro riêng từng mã ({s.model_version}). Trong mỗi nhánh giả định phân phối chuẩn nên đuôi có thể mỏng hơn thực tế: P5 là mốc tham khảo, không phải tổn thất tối đa. Tính tất định, không dùng AI, tính lại được từ ảnh chụp. Nội bộ – không phải dự báo hay khuyến nghị.</p>
    </Card>
  )
}

export function RunScenarioSummary({ s }: { s: any }) {
  if (!s) return null
  const book = Object.entries(s.book_by_factor as Record<string, number>).filter(([, v]) => Math.abs(v) >= 1).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6)
  return (
    <Card title={<span className="flex items-center gap-2">Kịch bản trên toàn bộ khách Private <Badge tone="primary">thiết kế v2</Badge></span>}>
      <div className="grid md:grid-cols-4 gap-3 mb-3">
        <div><div className="text-fgm text-[13px]">P50 3 tháng (tổng)</div><div className="text-lg font-semibold"><Money v={s.book_base_3m} short /></div></div>
        <div><div className="text-fgm text-[13px]">P10 3 tháng (cộng các gia đình)</div><div className="text-lg font-semibold"><Money v={s.book_bad_3m_sum} short /></div></div>
        <div><div className="text-fgm text-[13px]">Gia đình có P10 thấp nhất (3 tháng)</div><div className="text-lg font-semibold num text-left">{fmtPct(s.worst_bad_3m_pct, 2)}</div></div>
        <div><div className="text-fgm text-[13px]">Luồng 2 chuyển RM xem trước</div><div className="text-lg font-semibold">{s.families_rm_review}/{s.families}</div></div>
      </div>
      <div className="text-[13px] font-medium mb-1">Giám sát tập trung: yếu tố chi phối toàn bộ sổ khách (cơ sở, 3 tháng)</div>
      {book.map(([k, v]) => <div key={k} className="flex justify-between text-[12.5px] py-0.5 border-b border-[#1e2537]"><span>{FACTOR[k]?.label ?? k}</span><Money v={v} short /></div>)}
      <p className="text-fgm text-xs mt-2">Dùng để phát hiện khi nhiều gia đình cùng chịu một yếu tố (nguy cơ phản ứng bầy đàn nếu gửi cập nhật cùng lúc). Mô hình {s.model_id}.</p>
    </Card>
  )
}

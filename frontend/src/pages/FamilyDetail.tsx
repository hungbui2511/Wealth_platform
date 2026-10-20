import { FamilyScenarioCard } from '../scenario'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ASSET_CLASS_LABELS } from '../../../src/shared/catalog'
import { api } from '../api'
import { useUser } from '../App'
import { HowCalcModal } from '../HowCalc'
import { crossBorderOf, PURPOSE_LABEL, TIER_LABEL } from '../../../src/engine/procedural'
import { AlertBadge, Badge, Btn, Card, DISCLAIMER, ErrorBox, fmtPct, fmtVnd, fmtVndShort, GOAL_DISCLAIMER, GoalBadge, Kv, Loading, Money, Note, StatusBadge, Tabs, ts, useApi } from '../ui'

const ACL = ASSET_CLASS_LABELS as Record<string, string>
// Bảng màu phân loại chế độ tối (dataviz reference palette, thứ tự cố định)
const S1 = '#3987e5', S2 = '#d95926', S3 = '#199e70', S7 = '#9085e9'
const axisFmt = (v: number) => fmtVndShort(v).replace(' triệu', 'tr').replace(' tỷ', ' tỷ')

export default function FamilyDetail() {
  const { id } = useParams()
  const [tab, setTab] = useState('overview')
  const ov = useApi(`/api/families/${id}`)
  if (ov.error) return <ErrorBox error={ov.error} />
  if (!ov.data) return <Loading />
  const f = ov.data.family
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-3"><h1 className="text-xl font-semibold"><span className="mono text-base text-fgm">{f.id}</span> {f.name}</h1><Badge>Chân dung {f.persona}</Badge><Badge>RM {f.rm_id}</Badge></div>
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Bản đồ tài sản' }, { id: 'impacts', label: 'Tác động sự kiện' }, { id: 'pnl', label: 'Lãi/lỗ' }, { id: 'cashflow', label: 'Dòng tiền' }, { id: 'goals', label: 'Mục tiêu' }, { id: 'structure', label: 'Cấu trúc, kế thừa' }]} />
      {tab === 'overview' && <Overview d={ov.data} />}
      {tab === 'impacts' && <Impacts familyId={id!} />}
      {tab === 'pnl' && <Pnl familyId={id!} />}
      {tab === 'cashflow' && <Cashflow familyId={id!} members={f.members} entities={f.entities} />}
      {tab === 'goals' && <Goals familyId={id!} />}
      {tab === 'structure' && <Structure familyId={id!} family={f} />}
    </>
  )
}

function Bars({ data, total }: { data: Record<string, string>; total: string }) {
  const rows = Object.entries(data).sort((a, b) => Number(b[1]) - Number(a[1]))
  return <div className="space-y-1.5">{rows.map(([k, v]) => {
    const pct = Number(v) / Number(total)
    return <div key={k} className="grid grid-cols-[minmax(110px,180px)_1fr_auto] gap-2 items-center text-[13px]"><span className="truncate" title={k}>{ACL[k] ?? k}</span><div className="h-3 bg-muted rounded"><div className="h-3 rounded-r bg-[#3987e5]" style={{ width: `${Math.max(0.5, pct * 100)}%` }} /></div><span className="num w-36">{fmtVndShort(v)} · {fmtPct(pct, 1)}</span></div>
  })}</div>
}

function Overview({ d }: { d: any }) {
  const name = (id: string) => d.family.members.find((m: any) => m.id === id)?.name ?? d.family.entities.find((e: any) => e.id === id)?.name ?? id
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        {[['Tổng tài sản', d.totals.total_assets], ['Nợ', d.totals.total_liabilities], ['Tài sản ròng', d.totals.net_worth]].map(([k, v]) => <Card key={k}><div className="text-fgm text-[13px]">{k}</div><div className="text-xl font-semibold num text-left" title={`${fmtVnd(v)} VND`}>{fmtVndShort(v)}</div><div className="text-fgm text-xs num text-left">{fmtVnd(v)} VND</div></Card>)}
      </div>
      <p className="text-fgm text-[13px]">Đã tính tỷ lệ sở hữu hiệu dụng và nhìn xuyên quỹ. Ngày giá {d.price_date}, ảnh chụp <span className="mono">{d.snapshot_id}</span>. Tỷ giá: {Object.entries(d.fx).map(([k, v]) => `${k}/VND ${fmtVnd(v as string)}`).join(' · ')}.</p>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Phân bổ theo loại tài sản"><Bars data={d.by_asset_class} total={d.totals.total_assets} /></Card>
        <Card title="Theo tiền tệ, thành viên, pháp nhân">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>{Object.entries(d.by_currency).map(([k, v]) => <Kv key={k} k={k} v={<Money v={v as string} short />} />)}</div>
            <div>{Object.entries(d.by_member).map(([k, v]) => <Kv key={k} k={name(k)} v={<Money v={v as string} short />} />)}{Object.entries(d.by_entity).map(([k, v]) => <Kv key={k} k={<span>{name(k)} <Badge>pháp nhân</Badge></span>} v={<Money v={v as string} short />} />)}</div>
          </div>
          <div className="mt-3 text-[13px] text-fgm">Sở hữu pháp nhân: {d.family.ownerships.length ? d.family.ownerships.map((o: any) => `${name(o.owner_entity_id ?? o.member_id)} ${fmtPct(o.pct, 0)} ${name(o.entity_id)}`).join('; ') : 'không có'}</div>
        </Card>
      </div>
      <Card title="Vị thế (tới từng mã, ngành, tài khoản, chủ sở hữu)">
        <div className="overflow-x-auto max-h-[520px]">
          <table className="t">
            <thead><tr><th>Công cụ</th><th>Loại / ngành</th><th>Tài khoản</th><th className="num">Số lượng</th><th className="num">Giá</th><th>Nguồn, ngày giá</th><th className="num">Giá trị VND</th><th className="num">Sở hữu</th><th className="num">Phơi nhiễm</th></tr></thead>
            <tbody>{d.positions.map((p: any, i: number) => {
              const acc = d.family.accounts.find((a: any) => a.id === p.account_id)
              const stale = p.valuation_date && (Date.parse(d.price_date) - Date.parse(p.valuation_date)) / 86400000 > 365
              return (
                <tr key={i}>
                  <td><span className="mono">{p.instrument_id}</span>{p.part !== null && <span className="text-fgm"> · phần {Number(p.part) + 1} ({fmtPct(p.weight, 0)})</span>}<div className="text-fgm text-xs">{p.name}</div></td>
                  <td className="text-xs">{ACL[p.asset_class]}{p.sector ? ` · ${p.sector}` : ''}</td>
                  <td className="text-xs">{acc?.custodian}<div className="text-fgm">{acc?.owners.map((o: any) => `${name(o.id)} ${fmtPct(o.pct, 0)}`).join(', ')}</div></td>
                  <td className="num">{fmtVnd(p.quantity)}</td><td className="num">{p.price ? `${fmtVnd(p.price)}${p.currency !== 'VND' ? ' ' + p.currency : ''}` : <Badge tone="red">thiếu giá</Badge>}</td>
                  <td className="text-xs" title={p.range ? `Khoảng giá ${fmtVnd(p.range[0])}–${fmtVnd(p.range[1])}` : undefined}>{p.price_source}{p.price_date && <div className="text-fgm">{p.price_date}{p.valuation_date ? ` · định giá ${p.valuation_date}` : ''}</div>}{p.price_flag === 'fallback' && <Badge tone="amber">dự phòng</Badge>}{p.price_flag === 'external_ai' && <Badge tone="amber">AI lấy, chưa đối soát</Badge>}{stale && <Badge tone="amber">định giá cũ</Badge>}</td>
                  <td><Money v={p.value_vnd} /></td><td className="num">{fmtPct(p.eff_own, 0)}</td><td><Money v={p.exposure} /></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      </Card>
      {d.liabilities.length > 0 && <Card title="Khoản nợ"><table className="t"><thead><tr><th>Khoản nợ</th><th>Bên vay</th><th>Lãi suất</th><th>Cách trả</th><th>Đáo hạn</th><th className="num">Dư nợ VND</th><th className="num">Phần gia đình</th></tr></thead><tbody>{d.liabilities.map((l: any) => <tr key={l.id}><td>{l.name}</td><td>{name(l.detail.borrower.id)}</td><td>{fmtPct(l.detail.rate, 2)} {l.detail.rate_type === 'floating' ? 'thả nổi' : 'cố định'}</td><td>{l.detail.repayment === 'amortizing' ? 'gốc đều' : 'gốc cuối kỳ'}</td><td>{l.detail.maturity}</td><td><Money v={l.balance_vnd} /></td><td><Money v={l.exposure} /></td></tr>)}</tbody></table></Card>}
    </div>
  )
}

function Impacts({ familyId }: { familyId: string }) {
  const user = useUser()
  const { data, error } = useApi(`/api/families/${familyId}/impacts`)
  const [sel, setSel] = useState<string | null>(null)
  const [how, setHow] = useState(false)
  const [interp, setInterp] = useState<any>(null)
  const [ierr, setIerr] = useState<unknown>(null)
  const [note, setNote] = useState('')
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const cur = data.impacts.find((x: any) => x.run.id === sel) ?? data.impacts[0]
  if (!cur) return <Note>Chưa có kết quả áp dụng {user.role === 'RM' ? 'đã qua hậu kiểm ' : ''}cho gia đình này.</Note>
  const r = cur.result
  const goals = data.goal_impacts.filter((g: any) => g.run_id === cur.run.id)
  return (
    <div className="space-y-4">
      <Note>{DISCLAIMER}.</Note>
      <div className="flex flex-wrap gap-2">{data.impacts.map((x: any) => <button key={x.run.id} onClick={() => { setSel(x.run.id); setInterp(null) }} className={`border rounded-md px-2 py-1 text-[13px] ${x.run.id === cur.run.id ? 'border-primary' : 'border-border'}`}><span className="mono">{x.event.id}</span> <StatusBadge s={x.run.status} /></button>)}</div>
      {cur.run.status !== 'EFFECTIVE' && <Note tone="warn">Kết quả này {cur.run.status === 'WITHDRAWN' ? 'đã bị CIO thu hồi' : 'đã được thay thế bởi phiên bản mới'}; chỉ giữ để tham chiếu.</Note>}
      <div className="grid md:grid-cols-4 gap-3">
        <Card><div className="text-fgm text-[13px]">Tác động</div><div className="text-xl font-semibold"><Money v={r.impact} short /></div><div className="text-fgm text-xs num text-left">{fmtVnd(r.impact)} VND</div></Card>
        <Card><div className="text-fgm text-[13px]">% tài sản ròng</div><div className="text-xl font-semibold num text-left">{fmtPct(r.pct, 3)}</div><AlertBadge level={r.alert} /></Card>
        <Card><div className="text-fgm text-[13px]">Phần trên tài sản kém thanh khoản</div><div className="text-xl font-semibold"><Money v={r.illiquid_impact} short /></div><Badge tone="amber">ước tính trên giấy</Badge></Card>
        <Card><div className="text-fgm text-[13px]">Sự kiện</div><div className="text-[13px]">{cur.event.title}</div><div className="text-fgm text-xs mono">{cur.run.id}</div></Card>
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Theo loại tài sản">{Object.entries(r.by_asset_class).filter(([, v]) => Number(v) !== 0).map(([k, v]) => <Kv key={k} k={ACL[k]} v={<Money v={v as string} short />} />)}{Object.values(r.by_asset_class).every((v: any) => Number(v) === 0) && <span className="text-fgm">Không có</span>}</Card>
        <Card title="Theo yếu tố tỷ giá">{Object.entries(r.by_fx).map(([k, v]) => <Kv key={k} k={`${k}/VND`} v={<Money v={v as string} short />} />)}{Object.keys(r.by_fx).length === 0 && <span className="text-fgm">Không có tài sản ngoại tệ</span>}</Card>
        <Card title="Năm mã đóng góp lớn nhất">{r.top_instruments.map((t: any) => <Kv key={t.instrument_id} k={<span><span className="mono">{t.instrument_id}</span> <span className="text-fgm text-xs">{t.name}</span></span>} v={<Money v={t.impact} short />} />)}</Card>
      </div>
      <FamilyScenarioCard s={r.scenario} />
      {goals.length > 0 && <Card title="Tác động lên mục tiêu"><GoalImpactTable rows={goals} /></Card>}
      <div className="flex flex-wrap gap-2">
        <Btn kind="secondary" onClick={() => setHow(true)}>Cách tính</Btn>
        <Btn onClick={async () => { setIerr(null); try { setInterp(await api(`/api/runs/${cur.run.id}/families/${familyId}/interpretation`)) } catch (e) { setIerr(e) } }}>Diễn giải nội bộ</Btn>
        {user.role !== 'RM' && <Link to={`/trace/${cur.run.id}/${familyId}`}><Btn kind="secondary">Truy vết</Btn></Link>}
      </div>
      <ErrorBox error={ierr} />
      {interp && (
        <Card title={<span className="flex items-center gap-2">Diễn giải <Badge tone="red">{interp.label}</Badge>{interp.blocked && <Badge tone="amber">Bản LLM bị chặn – hiển thị đoạn mẫu xác định</Badge>}</span>}>
          <div className="relative overflow-hidden">
            <p className="leading-relaxed relative z-10">{interp.text}</p>
            <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-wrap content-center justify-center gap-10 opacity-[0.08] -rotate-12 select-none text-lg">{Array.from({ length: 6 }).map((_, i) => <span key={i}>{interp.watermark.viewer} · {ts(interp.watermark.at)}</span>)}</div>
          </div>
          <div className="text-fgm text-xs mt-2">Người xem: {interp.watermark.viewer} · {ts(interp.watermark.at)}. Không có chức năng gửi hay xuất cho khách hàng.</div>
          {interp.blocked && <div className="text-xs text-amber mt-1">Lý do chặn: {interp.violations.map((v: any) => `"${v.text}" – ${v.reason}`).join('; ')}{interp.restricted_hits.length ? ' · nhắc tổ chức trong danh sách hạn chế' : ''}</div>}
        </Card>
      )}
      {user.role === 'RM' && (
        <Card title="Ghi chú nội bộ của RM">
          <div className="flex gap-2"><input className="flex-1" value={note} onChange={e => setNote(e.target.value)} placeholder="Ghi chú (không gửi khách hàng)" /><Btn onClick={async () => { await api(`/api/families/${familyId}/notes`, { method: 'POST', body: { run_id: cur.run.id, text: note, seen: true } }); setNote('') }} disabled={!note.trim()}>Lưu, đánh dấu đã xem</Btn></div>
        </Card>
      )}
      {how && <HowCalcModal result={r} onClose={() => setHow(false)} />}
    </div>
  )
}

export function GoalImpactTable({ rows }: { rows: any[] }) {
  return (
    <>
      <div className="overflow-x-auto"><table className="t"><thead><tr><th>Mục tiêu</th><th className="num">Trước</th><th className="num">Sau (kỳ vọng)</th><th className="num">Chênh lệch (điểm %)</th><th className="num">Sau (kịch bản xấu)</th><th>Mức</th><th>Cảnh báo</th></tr></thead>
        <tbody>{rows.map((g: any) => <tr key={g.id}><td>{g.goal_name} <span className="mono text-fgm">{g.goal_id}</span>{g.basis && <div className="text-fgm text-xs">dùng tác động {g.basis === '12M' ? '12 tháng' : '3 tháng'}</div>}</td><td className="num">{fmtPct(g.ratio_before, 2)}</td><td className="num">{fmtPct(g.ratio_after, 2)}</td><td className="num">{Number(g.delta_pts).toFixed(2).replace('.', ',')}</td><td className="num">{g.stress ? <>{fmtPct(g.stress.ratio_after, 2)}<div className="text-fgm text-xs">{Number(g.stress.delta_pts).toFixed(2).replace('.', ',')} điểm</div></> : '—'}</td><td><GoalBadge level={g.level_before} /> → <GoalBadge level={g.level_after} />{g.stress && g.stress.level_after !== g.level_after && <div className="text-xs">xấu: <GoalBadge level={g.stress.level_after} /></div>}</td><td>{g.alert ? <Badge tone="amber">Đổi mức hoặc giảm ≥ 5 điểm</Badge> : <span className="text-fgm">—</span>}</td></tr>)}</tbody></table></div>
      <p className="text-fgm text-xs mt-2">{GOAL_DISCLAIMER}. Chỉ tài sản dành riêng ảnh hưởng tới tỷ lệ đáp ứng. {rows[0]?.assumption ?? 'Cú sốc coi là vĩnh viễn.'}</p>
    </>
  )
}

function Pnl({ familyId }: { familyId: string }) {
  const { data, error } = useApi(`/api/families/${familyId}/pnl`)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const t = data.total
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-5 gap-3">{[['Đã thực hiện', t.realized], ['Chưa thực hiện', t.unrealized], ['Thu nhập', t.income], ['Tổng lãi/lỗ', t.total], ['Trong đó hiệu ứng tỷ giá', t.fx_effect]].map(([k, v]) => <Card key={k}><div className="text-fgm text-[13px]">{k}</div><div className="text-lg font-semibold"><Money v={v} short /></div></Card>)}</div>
      <p className="text-fgm text-[13px]">Giá vốn bình quân gia quyền di động (BR-19); tổng hợp theo tỷ lệ sở hữu hiệu dụng. {t.excluded > 0 && <Badge tone="amber">{t.excluded} vị thế bị loại vì chưa đủ dữ liệu giá vốn</Badge>} Lãi/lỗ không đi vào công thức tác động.</p>
      <Card title="Theo vị thế">
        <div className="overflow-x-auto"><table className="t">
          <thead><tr><th>Công cụ</th><th className="num">Số lượng</th><th className="num">Giá vốn còn lại</th><th className="num">Giá trị</th><th className="num">Đã thực hiện</th><th className="num">Chưa thực hiện</th><th className="num">%</th><th className="num">Thu nhập</th><th className="num">Tổng</th><th className="num">Hiệu ứng giá / tỷ giá</th></tr></thead>
          <tbody>{data.rows.map((r: any) => <tr key={r.holding_id}><td><span className="mono">{r.instrument_id}</span><div className="text-fgm text-xs">{r.name}{r.price_source ? ` · ${r.price_source} ${r.price_date}` : ''}</div>{r.insufficient_cost && <Badge tone="amber">chưa đủ dữ liệu giá vốn</Badge>}{Number(r.eff_own) < 1 && <Badge>sở hữu {fmtPct(r.eff_own, 0)}</Badge>}</td>
            <td className="num">{fmtVnd(r.quantity)}</td><td><Money v={r.cost_vnd} /></td><td><Money v={r.value_vnd} /></td><td><Money v={r.realized_vnd} /></td><td><Money v={r.unrealized_vnd} /></td><td className="num">{r.unrealized_pct ? fmtPct(r.unrealized_pct, 2) : '—'}</td><td><Money v={r.income_vnd} /></td><td className="font-medium"><Money v={r.total_vnd} /></td>
            <td className="num text-xs">{r.price_effect_vnd !== null ? <>{fmtVndShort(r.price_effect_vnd)} / {fmtVndShort(r.fx_effect_vnd)}</> : '—'}</td></tr>)}</tbody>
        </table></div>
      </Card>
      <Card title="Theo loại tài sản">{Object.entries(data.by_asset_class).map(([k, v]: any) => <Kv key={k} k={ACL[k]} v={<span><Money v={v.total} short /> {v.excluded ? <Badge tone="amber">loại {v.excluded}</Badge> : null}</span>} />)}</Card>
    </div>
  )
}

const CAT: Record<string, string> = { coupon: 'Coupon trái phiếu', principal: 'Gốc trái phiếu đáo hạn', loan_interest: 'Lãi vay', loan_principal: 'Gốc vay', living: 'Chi sinh hoạt', rent: 'Tiền thuê', dividend: 'Cổ tức (dự kiến)', insurance_premium: 'Phí bảo hiểm', capital_call: 'Gọi vốn cổ phần tư nhân', distribution: 'Phân phối từ doanh nghiệp', deposit_interest: 'Lãi tiền gửi đáo hạn', other_income: 'Thu nhập khác', education: 'Học phí' }

function Cashflow({ familyId, members, entities }: { familyId: string; members: any[]; entities: any[] }) {
  const [mode, setMode] = useState<'short' | 'long'>('short')
  const [real, setReal] = useState(false)
  const [subj, setSubj] = useState('')
  const q = subj ? `?${subj.startsWith('E-') ? 'entity' : 'member'}=${subj}` : ''
  const { data, error } = useApi(`/api/families/${familyId}/cashflow${q}`)
  const longRows = useMemo(() => (data?.long.rows ?? []).map((r: any) => { const k = real ? Number(r.deflator) : 1; return { year: r.year, t: r.t, L: Number(r.L) / k, net_worth: Number(r.net_worth) / k, net: Number(r.net) / k, goal: Number(r.goal_spend) / k } }), [data, real])
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const st = data.short
  const lt = data.long
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex border border-border rounded-md overflow-hidden">{(['short', 'long'] as const).map(m => <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 text-sm ${mode === m ? 'bg-primary text-[#0b1020]' : ''}`}>{m === 'short' ? 'Ngắn hạn (12 tháng)' : `Dài hạn (${lt.years} năm)`}</button>)}</div>
        {mode === 'short' && <label className="text-sm text-fgm">Lọc chủ thể <select value={subj} onChange={e => setSubj(e.target.value)}><option value="">Cả gia đình</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}
        {mode === 'long' && <label className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={real} onChange={e => setReal(e.target.checked)} />Giá trị hôm nay (chia (1 + lạm phát)^t)</label>}
      </div>
      {mode === 'short' ? (
        <>
          <div className="flex flex-wrap gap-2">{st.alerts.length === 0 ? <Badge tone="green">Không có cảnh báo thanh khoản</Badge> : st.alerts.map((a: any, i: number) => <Badge key={i} tone={a.level === 'RED' ? 'red' : 'amber'}>{a.code === 'cash_shortfall' ? 'Thiếu hụt tiền' : a.code === 'large_outflow' ? 'Khoản chi lớn' : 'Hệ số bao phủ thấp'}: {a.message}</Badge>)}</div>
          <div className="grid md:grid-cols-5 gap-3">{[['Tiền đầu kỳ', st.start_cash], ['Tiền vào 12 tháng', st.totals.inflow], ['Tiền ra 12 tháng', st.totals.outflow], ['Thuần 12 tháng', st.totals.net]].map(([k, v]) => <Card key={k}><div className="text-fgm text-[13px]">{k}</div><div className="text-lg font-semibold"><Money v={v} short /></div></Card>)}<Card><div className="text-fgm text-[13px]">Hệ số bao phủ</div><div className="text-lg font-semibold num text-left">{st.coverage ? Number(st.coverage).toFixed(2).replace('.', ',') : 'không áp dụng'}</div></Card></div>
          <Card title="Tiền vào, tiền ra theo tháng và số dư lũy kế (VND)">
            <div className="h-72"><ResponsiveContainer><ComposedChart data={st.months.map((m: any) => ({ ym: m.ym, in: Number(m.inflow), out: -Number(m.outflow), cum: Number(m.cumulative) }))} margin={{ left: 10, right: 10 }} barGap={2}>
              <CartesianGrid stroke="#1e2537" vertical={false} /><XAxis dataKey="ym" stroke="#94A3B8" fontSize={12} /><YAxis stroke="#94A3B8" fontSize={12} tickFormatter={axisFmt} width={70} />
              <Tooltip contentStyle={{ background: '#0E1223', border: '1px solid #334155' }} formatter={(v: number, n: string) => [`${fmtVnd(Math.round(v))} VND`, n]} />
              <Legend /><ReferenceLine y={0} stroke="#94A3B8" />
              <Bar isAnimationActive={false} dataKey="in" name="Tiền vào" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={22} /><Bar isAnimationActive={false} dataKey="out" name="Tiền ra" fill={S2} radius={[0, 0, 4, 4]} maxBarSize={22} />
              <Line isAnimationActive={false} dataKey="cum" name="Số dư lũy kế" stroke={S3} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart></ResponsiveContainer></div>
          </Card>
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Theo loại khoản">{st.by_category.map((c: any) => <Kv key={c.category + c.direction} k={<span>{CAT[c.category] ?? c.category} {c.expected && <Badge>dự kiến</Badge>}</span>} v={<span className={c.direction === 'out' ? '' : ''}>{c.direction === 'out' ? '−' : '+'}<Money v={c.total} short /></span>} />)}</Card>
            <Card title="Các khoản theo tháng"><div className="max-h-80 overflow-y-auto"><table className="t"><thead><tr><th>Tháng</th><th>Khoản</th><th className="num">Số tiền</th></tr></thead><tbody>{st.items.map((it: any, i: number) => <tr key={i} className={it.expected ? 'italic text-fgm' : ''}><td>{it.ym}</td><td>{it.label} {it.expected && <Badge>dự kiến</Badge>}{it.origin === 'auto' && <span className="text-fgm text-xs"> (tự động)</span>}</td><td className="num">{it.direction === 'out' ? '−' : '+'}{fmtVnd(it.amount)}</td></tr>)}</tbody></table></div></Card>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">{lt.alerts.length === 0 ? <Badge tone="green">Không có thiếu hụt dài hạn</Badge> : lt.alerts.map((a: any, i: number) => <Badge key={i} tone="red">Thiếu hụt dài hạn năm {a.year} (năm thứ {a.t}); mục tiêu liên quan: {a.goals.join(', ') || '—'}</Badge>)}</div>
          <Card title={`Dự phóng theo năm ${real ? '(giá trị hôm nay)' : '(danh nghĩa)'}`}>
            <div className="h-80"><ResponsiveContainer><ComposedChart data={longRows} margin={{ left: 10, right: 10 }}>
              <CartesianGrid stroke="#1e2537" vertical={false} /><XAxis dataKey="year" stroke="#94A3B8" fontSize={12} /><YAxis stroke="#94A3B8" fontSize={12} tickFormatter={axisFmt} width={70} />
              <Tooltip contentStyle={{ background: '#0E1223', border: '1px solid #334155' }} formatter={(v: number, n: string) => [`${fmtVnd(Math.round(v))} VND`, n]} />
              <Legend /><ReferenceLine y={0} stroke="#94A3B8" />
              <Bar isAnimationActive={false} dataKey="net" name="Dòng tiền thuần" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={18} />
              <Line isAnimationActive={false} dataKey="L" name="Tài sản thanh khoản tự do (L)" stroke={S3} strokeWidth={2} dot={false} />
              <Line isAnimationActive={false} dataKey="net_worth" name="Tài sản ròng dự phóng" stroke={S7} strokeWidth={2} dot={false} />
              {lt.goals.map((g: any, i: number) => <ReferenceLine key={i} x={Number(data.price_date.slice(0, 4)) + g.year_idx} stroke="#F59E0B" strokeDasharray="4 3" label={{ value: g.name, fill: '#94A3B8', fontSize: 11, position: 'insideTopLeft' }} />)}
            </ComposedChart></ResponsiveContainer></div>
            <p className="text-fgm text-xs mt-2">Giả định ({data.assumption_version}): lạm phát {fmtPct(data.assumptions.inflation, 1)}; r_L = {fmtPct(lt.rL, 2)} theo cơ cấu L tại ngày giá; L₀ = {fmtVndShort(lt.L0)}. Đường đứt nét: mốc chi của mục tiêu. Năm 1 trùng cửa sổ 12 tháng ngắn hạn. {GOAL_DISCLAIMER}.</p>
          </Card>
          <Card title="Bảng dự phóng"><div className="overflow-x-auto max-h-96"><table className="t"><thead><tr><th>Năm</th><th className="num">Tiền vào</th><th className="num">Tiền ra</th><th className="num">Thuần</th><th className="num">Chi mục tiêu</th><th className="num">Phần lấy từ L</th><th className="num">L cuối năm</th><th className="num">Tài sản ròng</th></tr></thead><tbody>{lt.rows.map((r: any) => { const k = real ? Number(r.deflator) : 1; const v = (x: string) => fmtVndShort(Number(x) / k); return <tr key={r.t} className={Number(r.L) < 0 ? 'text-red' : ''}><td>{r.year} ({r.t})</td><td className="num">{v(r.inflow)}</td><td className="num">{v(r.outflow)}</td><td className="num">{v(r.net)}</td><td className="num">{v(r.goal_spend)}</td><td className="num">{v(r.goal_from_L)}</td><td className="num">{v(r.L)}</td><td className="num">{v(r.net_worth)}</td></tr> })}</tbody></table></div></Card>
        </>
      )}
    </div>
  )
}

const GTYPE: Record<string, string> = { education: 'Du học, học tập', retirement: 'Nghỉ hưu', purchase: 'Mua tài sản', succession: 'Chuyển giao', charity: 'Từ thiện', other: 'Khác' }
const PRIO: Record<string, string> = { essential: 'Thiết yếu', important: 'Quan trọng', aspirational: 'Mong muốn' }

function Goals({ familyId }: { familyId: string }) {
  const user = useUser()
  const { data, error, reload } = useApi(`/api/families/${familyId}/goals`)
  const imp = useApi(`/api/families/${familyId}/impacts`)
  const proc = useApi<any[]>(`/api/families/${familyId}/procedural`)
  const [edit, setEdit] = useState<any>(null)
  const [ferr, setFerr] = useState<unknown>(null)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const hname = (id: string) => { const h = data.holdings.find((x: any) => x.id === id); return h ? `${h.instrument_id} – ${h.name}` : id }
  const save = async () => {
    setFerr(null)
    try {
      const { cb_purpose, cb_country, ...rest } = edit
      const body = { ...rest, cross_border: cb_purpose ? { purpose: cb_purpose, country: cb_country } : null, earmarks: edit.earmarks.filter((e: any) => e.holding_id).map((e: any) => ({ holding_id: e.holding_id, pct: String(Number(e.pct) / 100) })), spend: edit.multi ? { kind: 'multi', years: Number(edit.years) } : { kind: 'once' } }
      if (edit.id) await api(`/api/goals/${edit.id}`, { method: 'PUT', body }); else await api(`/api/families/${familyId}/goals`, { method: 'POST', body })
      setEdit(null); reload()
    } catch (e) { setFerr(e) }
  }
  const effective = (imp.data?.goal_impacts ?? []).filter((g: any) => g.run_status === 'EFFECTIVE')
  return (
    <div className="space-y-4">
      <Note tone="warn">{GOAL_DISCLAIMER}. Lợi suất giả định cố định theo loại tài sản ({data.assumption_version}), không mô phỏng xác suất. Ngưỡng: Đạt ≥ {fmtPct(data.thresholds.on_track, 0)}, Theo dõi ≥ {fmtPct(data.thresholds.watch, 0)}.</Note>
      {(proc.data ?? []).length > 0 && <Card title="Lưu ý thủ tục cho mục tiêu (từ ghi chú quy định của TCB)">
        <p className="text-[13px] text-fgm mb-2">Quy định mới không đổi giá tài sản nhưng có thể làm chậm mục tiêu có dòng tiền ra nước ngoài. Khớp theo mục tiêu của gia đình, không theo hồ sơ rủi ro của khách.</p>
        <div className="space-y-2">{proc.data!.map((a: any) => <div key={a.note_id + a.goal_id} className="border border-border rounded p-2 text-[13px]">
          <div className="flex flex-wrap gap-1.5 items-center"><Badge tone={a.tier === 'contact' ? 'red' : a.tier === 'remind' ? 'amber' : a.tier === 'confirm' ? 'primary' : undefined}>{TIER_LABEL[a.tier as keyof typeof TIER_LABEL]}</Badge><b>{a.goal_name}</b><span className="mono text-fgm">{a.goal_id}</span><span className="text-fgm">· {PURPOSE_LABEL[a.purpose as keyof typeof PURPOSE_LABEL]}{a.country ? ` · ${a.country}` : ''} · cần tiền {a.goal_month}</span>{a.inferred && <Badge>suy từ tên, RM xác nhận</Badge>}</div>
          <div className="mt-1">Nên chuẩn bị hồ sơ trước <b>{a.prepare_by}</b>: {a.documents.join('; ')}.</div>
          <div className="text-fgm text-xs">{a.reason}</div>
          {a.client_message ? <div className="mt-1 p-2 rounded bg-muted text-xs"><b>Khách thấy trên thẻ mục tiêu:</b> "{a.client_message}"</div> : <div className="mt-1 p-2 rounded bg-muted text-xs">Mục tiêu suy từ tên: chưa hiện thông điệp cho khách. RM khai báo "ra nước ngoài" trên mục tiêu nếu đúng.</div>}
          {user.role === 'RM' && <div className="text-xs mt-1"><b>Gợi ý trao đổi:</b> {a.rm_talking_points}</div>}
          <div className="text-fgm text-xs mt-1">Nguồn: {a.doc_no} – {a.regulation} ({a.status === 'draft' ? 'dự thảo' : a.status === 'issued' ? 'đã ban hành' : 'đã có hiệu lực'}{a.effective_date ? `, hiệu lực ${a.effective_date}` : ''})</div>
        </div>)}</div>
      </Card>}
      <Card title="Dòng thời gian mục tiêu" actions={user.role === 'RM' && <Btn small onClick={() => setEdit({ name: '', type: 'education', year: 2030, month: 9, amount: '', basis: 'nominal', cost_growth: '0', priority: 'important', annual_contribution: '0', source_note: 'Theo trao đổi với khách ngày ', earmarks: [], multi: false, years: 10 })}>Thêm mục tiêu</Btn>}>
        <div className="overflow-x-auto"><table className="t">
          <thead><tr><th>Thời điểm</th><th>Mục tiêu</th><th>Loại / ưu tiên</th><th className="num">Đích</th><th className="num">Dự phóng</th><th className="num">Tỷ lệ đáp ứng</th><th>Tài sản dành riêng</th><th /></tr></thead>
          <tbody>{[...data.goals].sort((a: any, b: any) => a.goal.year * 12 + a.goal.month - b.goal.year * 12 - b.goal.month).map(({ goal: g, coverage: c }: any) => (
            <tr key={g.id} className={g.status === 'closed' ? 'opacity-50' : ''}>
              <td>{String(g.month).padStart(2, '0')}/{g.year}{g.spend.kind === 'multi' && <div className="text-fgm text-xs">chi đều {g.spend.years} năm</div>}</td>
              <td>{g.name} <span className="mono text-fgm">{g.id}</span>{(() => { const cb = crossBorderOf(g); return cb && <div><Badge tone="primary">Ra nước ngoài: {PURPOSE_LABEL[cb.purpose]}{cb.country ? ` · ${cb.country}` : ''}{cb.inferred ? ' (suy từ tên)' : ''}</Badge></div> })()}<div className="text-fgm text-xs">{g.source_note}</div></td>
              <td className="text-xs">{GTYPE[g.type]}<div className="text-fgm">{PRIO[g.priority]}</div></td>
              <td><Money v={c?.target ?? g.amount} short /><div className="text-fgm text-xs">{g.basis === 'today' ? `giá trị hôm nay, tăng ${fmtPct(g.cost_growth, 1)}/năm` : 'giá trị năm mục tiêu'}</div></td>
              <td><Money v={c?.projected} short /></td>
              <td className="num">{c ? <><span>{fmtPct(c.ratio, 2)}</span> <GoalBadge level={c.level} /></> : 'đã đóng'}</td>
              <td className="text-xs">{g.earmarks.length ? g.earmarks.map((e: any) => <div key={e.holding_id}>{fmtPct(e.pct, 0)} {hname(e.holding_id)}</div>) : <Badge tone="amber">chưa có tài sản dành riêng</Badge>}</td>
              <td>{user.role === 'RM' && g.status === 'active' && <div className="flex gap-1"><Btn small kind="secondary" onClick={() => { const cb = crossBorderOf(g); setEdit({ ...g, earmarks: g.earmarks.map((e: any) => ({ ...e, pct: Number(e.pct) * 100 })), multi: g.spend.kind === 'multi', years: g.spend.years ?? 10, cb_purpose: cb?.purpose ?? '', cb_country: cb?.country ?? '' }) }}>Sửa</Btn><Btn small kind="danger" onClick={async () => { await api(`/api/goals/${g.id}/close`, { method: 'POST', body: { note: 'RM đóng mục tiêu' } }); reload() }}>Đóng</Btn></div>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <details className="mt-3 text-[13px]"><summary className="text-primary">Cách tính tỷ lệ đáp ứng</summary><p className="text-fgm mt-1">n = số tháng từ ngày giá tới tháng cần tiền / 12. Dự phóng = Σ phần giá trị dành riêng × (1 + r của loại tài sản)^n (quỹ có bảng phân bổ dùng r của từng phần) + đóng góp hàng năm tích lũy theo r_L. Đích = số tiền (theo năm mục tiêu) hoặc số tiền × (1 + tăng chi phí)^n; chi đều nhiều năm thì chiết khấu các khoản về năm bắt đầu bằng r_L. Tỷ lệ = dự phóng / đích.</p>
          {data.goals.filter((x: any) => x.coverage).map(({ goal: g, coverage: c }: any) => <div key={g.id} className="mt-1 mono text-fgm">{g.id}: n = {c.n_years}; {c.components.map((p: any) => `${fmtVndShort(p.value)} × (1 + ${fmtPct(p.r, 0)})^n = ${fmtVndShort(p.fv)}`).join(' + ') || 'không có tài sản dành riêng'}{Number(c.contributions_fv) ? ` + đóng góp ${fmtVndShort(c.contributions_fv)}` : ''}</div>)}
        </details>
      </Card>
      {effective.length > 0 && <Card title="Tác động của sự kiện đang hiệu lực lên mục tiêu"><GoalImpactTable rows={effective} /></Card>}
      {edit && (
        <Card title={edit.id ? `Sửa ${edit.id}` : 'Thêm mục tiêu (RM nhập thay khách)'}>
          <ErrorBox error={ferr} />
          <div className="grid md:grid-cols-3 gap-3 text-sm mt-2">
            <label className="flex flex-col gap-1">Tên<input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="flex flex-col gap-1">Loại<select value={edit.type} onChange={e => setEdit({ ...edit, type: e.target.value })}>{Object.entries(GTYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="flex flex-col gap-1">Mức ưu tiên<select value={edit.priority} onChange={e => setEdit({ ...edit, priority: e.target.value })}>{Object.entries(PRIO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="flex flex-col gap-1">Tháng cần tiền<input type="number" min={1} max={12} value={edit.month} onChange={e => setEdit({ ...edit, month: Number(e.target.value) })} /></label>
            <label className="flex flex-col gap-1">Năm cần tiền<input type="number" value={edit.year} onChange={e => setEdit({ ...edit, year: Number(e.target.value) })} /></label>
            <label className="flex flex-col gap-1">Số tiền (VND)<input value={edit.amount} onChange={e => setEdit({ ...edit, amount: e.target.value.replace(/\D/g, '') })} /></label>
            <label className="flex flex-col gap-1">Cơ sở số tiền<select value={edit.basis} onChange={e => setEdit({ ...edit, basis: e.target.value })}><option value="nominal">Giá trị tại năm mục tiêu</option><option value="today">Giá trị hôm nay</option></select></label>
            <label className="flex flex-col gap-1">Tăng chi phí/năm (thập phân)<input value={edit.cost_growth} onChange={e => setEdit({ ...edit, cost_growth: e.target.value })} /></label>
            <label className="flex flex-col gap-1">Đóng góp hàng năm (VND)<input value={edit.annual_contribution} onChange={e => setEdit({ ...edit, annual_contribution: e.target.value.replace(/\D/g, '') })} /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={edit.multi} onChange={e => setEdit({ ...edit, multi: e.target.checked })} />Chi đều nhiều năm</label>
            {edit.multi && <label className="flex flex-col gap-1">Số năm<input type="number" value={edit.years} onChange={e => setEdit({ ...edit, years: e.target.value })} /></label>}
            <label className="flex flex-col gap-1">Dòng tiền ra nước ngoài<select value={edit.cb_purpose ?? ''} onChange={e => setEdit({ ...edit, cb_purpose: e.target.value })}><option value="">Không</option>{Object.entries(PURPOSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            {edit.cb_purpose && <label className="flex flex-col gap-1">Nước đến<input value={edit.cb_country ?? ''} onChange={e => setEdit({ ...edit, cb_country: e.target.value })} /></label>}
            <label className="flex flex-col gap-1 md:col-span-3">Nguồn thông tin<input value={edit.source_note} onChange={e => setEdit({ ...edit, source_note: e.target.value })} /></label>
          </div>
          <div className="mt-3 text-sm">Tài sản dành riêng (% của vị thế; tổng mỗi vị thế ≤ 100%)
            {edit.earmarks.map((e: any, i: number) => <div key={i} className="flex gap-2 mt-1"><select value={e.holding_id} onChange={ev => { const a = [...edit.earmarks]; a[i] = { ...e, holding_id: ev.target.value }; setEdit({ ...edit, earmarks: a }) }}><option value="">Chọn vị thế</option>{data.holdings.map((h: any) => <option key={h.id} value={h.id}>{h.instrument_id} – {h.name}</option>)}</select><input type="number" className="w-24" value={e.pct} onChange={ev => { const a = [...edit.earmarks]; a[i] = { ...e, pct: ev.target.value }; setEdit({ ...edit, earmarks: a }) }} />%<Btn small kind="ghost" onClick={() => setEdit({ ...edit, earmarks: edit.earmarks.filter((_: any, j: number) => j !== i) })}>Bỏ</Btn></div>)}
            <Btn small kind="ghost" onClick={() => setEdit({ ...edit, earmarks: [...edit.earmarks, { holding_id: '', pct: 100 }] })}>+ Thêm tài sản dành riêng</Btn>
          </div>
          <div className="flex gap-2 mt-3"><Btn onClick={save}>Lưu</Btn><Btn kind="secondary" onClick={() => setEdit(null)}>Hủy</Btn></div>
        </Card>
      )}
    </div>
  )
}

const REL: Record<string, string> = { OK: 'Trong ngưỡng', MARGIN_CALL_NOW: 'Đang chạm ngưỡng gọi ký quỹ', MARGIN_CALL_STRESS: 'Gọi ký quỹ khi căng thẳng', ABOVE_MAX: 'Vượt tỷ lệ tối đa', NOT_LINKED: 'Chưa gắn tài sản bảo đảm' }
const EV: Record<string, string> = { g1_death: 'Thế hệ 1 qua đời', g2_emigration: 'Thế hệ 2 ra nước ngoài', divorce: 'Ly hôn' }
const lvTone = (s: string) => s === 'RED' || s === 'MARGIN_CALL_NOW' ? 'red' : s === 'YELLOW' || s === 'MARGIN_CALL_STRESS' || s === 'ABOVE_MAX' ? 'amber' : s === 'NOT_LINKED' || s === 'INFO' ? 'gray' : 'green'

// Đợt 4: cấu trúc liên thế hệ — đòn bẩy khi căng thẳng, thang thanh khoản, kế thừa
function Structure({ familyId, family }: { familyId: string; family: any }) {
  const r = useApi(`/api/families/${familyId}/structure`)
  if (r.error) return <ErrorBox error={r.error} />
  if (!r.data) return <Loading />
  const d = r.data
  const name = (id: string) => family.members.find((m: any) => m.id === id)?.name ?? family.entities.find((e: any) => e.id === id)?.name ?? id
  return (
    <div className="space-y-4">
      {d.missing.length > 0 && <Note tone="warn">{d.missing.join('. ')}. Các phần dưới chỉ đầy đủ khi có thông tin này.</Note>}
      {d.ownership_issues.length > 0 && <ErrorBox error={new Error(`Lỗi cấu trúc sở hữu: ${d.ownership_issues.join('; ')}`)} />}
      <Card title="Thành viên và cấu trúc pháp lý">
        <div className="overflow-x-auto"><table className="t"><thead><tr><th>Thành viên</th><th>Thế hệ</th><th>Năm sinh</th><th>Cư trú thuế</th><th>Quốc tịch</th><th>Hôn nhân</th><th>Di chúc</th></tr></thead>
          <tbody>{family.members.map((m: any) => <tr key={m.id}><td>{m.name} <span className="text-fgm text-xs">{m.role}</span></td><td>{m.generation}</td><td>{m.birth_year ?? '—'}</td><td>{m.tax_residency ?? '—'}</td><td>{(m.nationality ?? []).join(', ') || '—'}</td><td>{({ single: 'độc thân', married: 'đã kết hôn', divorced: 'đã ly hôn', widowed: 'goá' } as any)[m.marital_status] ?? '—'}{m.spouse_id ? ` với ${name(m.spouse_id)}` : ''}</td><td>{m.has_will === undefined ? '—' : m.has_will ? 'Có' : 'Không'}</td></tr>)}</tbody></table></div>
        {family.ownerships.length > 0 && <div className="mt-3 text-[13px]">Chuỗi sở hữu{d.multi_layer && <Badge tone="amber">nhiều tầng</Badge>}: {family.ownerships.map((o: any) => `${name(o.owner_entity_id ?? o.member_id)} → ${fmtPct(o.pct, 0)} ${name(o.entity_id)}`).join('; ')}. {family.entities.filter((e: any) => e.jurisdiction && e.jurisdiction !== 'VN').map((e: any) => `${e.name} đăng ký tại ${e.jurisdiction}`).join('; ')}</div>}
      </Card>

      <Card title="Căng thẳng theo giai đoạn lịch sử">
        <table className="t"><thead><tr><th>Giai đoạn</th><th className="num">Thay đổi tài sản ròng</th><th className="num">%</th></tr></thead>
          <tbody>{d.analog_stress.map((a: any) => <tr key={a.analog_id} className={d.stress_used?.analog_id === a.analog_id ? 'font-semibold' : ''}><td>{a.label}{d.stress_used?.analog_id === a.analog_id && <Badge>dùng cho kiểm tra dưới</Badge>}</td><td className="num"><Money v={String(a.total)} short /></td><td className="num">{a.pct === null ? '—' : fmtPct(a.pct, 1)}</td></tr>)}</tbody></table>
        <p className="text-fgm text-xs mt-2">Áp biến động thực tế của giai đoạn cho các yếu tố đã biết, yếu tố còn lại suy ra theo tương quan khi căng thẳng; trái phiếu DN bất động sản cộng thêm tổn thất vỡ nợ giả định. Đây là mốc tham khảo, không phải mức tệ nhất.</p>
      </Card>

      <Card title="Đòn bẩy và gọi ký quỹ">
        {d.leverage.length === 0 ? <p className="text-fgm">Không có khoản vay.</p> :
          <div className="overflow-x-auto"><table className="t"><thead><tr><th>Khoản vay</th><th className="num">Dư nợ</th><th className="num">Tài sản bảo đảm</th><th className="num">Tỷ lệ cho vay hiện tại</th><th className="num">Khi căng thẳng</th><th className="num">Ngưỡng gọi ký quỹ</th><th>Trạng thái</th><th className="num">Cần nộp thêm</th></tr></thead>
            <tbody>{d.leverage.map((l: any) => <tr key={l.liability_id}><td>{l.name}<div className="text-fgm text-xs">{l.message}</div></td><td className="num"><Money v={l.balance_vnd} short /></td><td className="num">{l.collateral_vnd ? <Money v={l.collateral_vnd} short /> : '—'}</td><td className="num">{l.ltv_now === null ? '—' : fmtPct(l.ltv_now, 1)}</td><td className="num">{l.ltv_stress === null ? '—' : fmtPct(l.ltv_stress, 1)}</td><td className="num">{l.margin_call_ltv === null ? '—' : fmtPct(l.margin_call_ltv, 0)}</td><td><Badge tone={lvTone(l.status)}>{REL[l.status]}</Badge></td><td className="num">{l.top_up_vnd ? <Money v={l.top_up_vnd} short /> : '—'}</td></tr>)}</tbody></table></div>}
      </Card>

      <Card title={`Thang thanh khoản khi căng thẳng${d.ladder.stress_label ? ` (${d.ladder.stress_label})` : ''}`}>
        <table className="t"><thead><tr><th>Mốc</th><th className="num">Tài sản bán được (lũy kế)</th><th className="num">Nghĩa vụ chi (lũy kế)</th><th className="num">Chênh lệch</th><th className="num">Hệ số bao phủ</th><th>Mức</th></tr></thead>
          <tbody>{d.ladder.rows.map((x: any) => <tr key={x.id}><td>{x.label}</td><td className="num"><Money v={x.assets} short /></td><td className="num"><Money v={x.outflow} short /></td><td className={`num ${Number(x.gap) < 0 ? 'text-red' : ''}`}><Money v={x.gap} short /></td><td className="num">{x.coverage === null ? '—' : x.coverage.toFixed(2).replace('.', ',')}</td><td><Badge tone={lvTone(x.status)}>{x.status === 'OK' ? 'Đủ' : x.status === 'RED' ? 'Thiếu' : 'Mỏng'}</Badge></td></tr>)}</tbody></table>
        <div className="text-[13px] mt-2">Tài sản cần trên 12 tháng mới bán được hoặc đang cầm cố: <Money v={d.ladder.illiquid_after_12m} short /></div>
        {d.ladder.outflows.length > 0 && <div className="text-[13px] mt-2">Khoản chi lớn: {d.ladder.outflows.map((o: any, i: number) => <span key={i}>{i > 0 && '; '}{o.label} (tháng {o.k}) {fmtVndShort(o.amount)}</span>)}</div>}
        <ul className="text-fgm text-xs mt-2 list-disc pl-5">{d.ladder.assumptions.map((a: string) => <li key={a}>{a}</li>)}</ul>
      </Card>

      <Card title="Kế thừa và sự kiện gia đình">
        <div className="flex flex-wrap gap-2 items-center mb-2 text-[13px]">Bảng quy tắc phiên bản <span className="mono">{d.rules_version}</span> {d.legal_confirmed ? <Badge tone="green">Pháp chế đã xác nhận</Badge> : <Badge tone="amber">Chờ Pháp chế xác nhận</Badge>}</div>
        {d.succession.data_gaps.length > 0 && <Note>Thiếu dữ liệu: {d.succession.data_gaps.join('; ')}.</Note>}
        <div className="space-y-3">{d.succession.events.map((e: any) => <div key={e.event + e.member_id} className="border border-border rounded p-3">
          <div className="flex flex-wrap gap-2 items-baseline"><Badge>{EV[e.event]}</Badge><span className="font-semibold">{e.title}</span>{e.estate && <span className="text-fgm text-[13px]">{e.event === 'g1_death' ? 'Di sản ước tính' : e.event === 'divorce' ? 'Giá trị có thể bị chia' : 'Giá trị thừa kế dự kiến'}: {fmtVndShort(e.estate)}</span>}</div>
          {e.heirs.length > 0 && <div className="overflow-x-auto mt-2"><table className="t"><thead><tr><th>Người thừa kế (theo pháp luật)</th><th className="num">Nhận</th><th className="num">Phần chịu thuế</th><th className="num">Thuế ước tính</th></tr></thead>
            <tbody>{e.heirs.map((h: any) => <tr key={h.member_id}><td>{h.name} <span className="text-fgm text-xs">{h.relation}{h.non_resident ? ', không cư trú' : ''}</span></td><td className="num"><Money v={h.receives} short /></td><td className="num"><Money v={h.taxable} short /></td><td className="num"><Money v={h.tax} short /></td></tr>)}</tbody></table>
            <div className="text-[13px] mt-1">Tổng thuế ước tính {fmtVndShort(e.tax_total)}; tài sản thanh khoản trong di sản {e.liquid_for_tax ? fmtVndShort(e.liquid_for_tax) : '—'}</div></div>}
          <ul className="mt-2 space-y-1 text-[13px]">{e.findings.map((x: any, i: number) => <li key={i}><Badge tone={lvTone(x.level)}>{x.level === 'RED' ? 'Đỏ' : x.level === 'YELLOW' ? 'Vàng' : 'Lưu ý'}</Badge> {x.text}</li>)}</ul>
        </div>)}</div>
        <ul className="text-fgm text-xs mt-3 list-disc pl-5">{d.succession.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
        <p className="text-fgm text-xs mt-2">Ước tính để RM chuẩn bị trao đổi, không phải tư vấn pháp lý hay thuế. Căn cứ: Luật Thuế TNCN 109/2025/QH15, Luật Hôn nhân và gia đình 2014, Bộ luật Dân sự 2015 (xem cấu hình SUCCESSION_RULES).</p>
      </Card>
    </div>
  )
}

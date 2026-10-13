// Hộp tin mới: tin lấy tự động từ nguồn công khai (RSS), chờ CIO hoặc Quản trị gom thành sự kiện.
import { useMemo, useState } from 'react'
import { api } from '../api'
import { useUser } from '../App'
import { Badge, Btn, Card, ErrorBox, Loading, ts, useApi } from '../ui'
import { OriginBadge } from '../scenario'

const TYPES: Record<string, string> = { monetary_policy: 'Chính sách tiền tệ', fiscal_tax: 'Tài khóa và thuế', sector_regulation: 'Quy định ngành', corporate: 'Doanh nghiệp', global_macro: 'Vĩ mô quốc tế', commodity: 'Hàng hóa', fx: 'Tỷ giá', geopolitical: 'Địa chính trị' }

export default function NewsInbox({ onCreated }: { onCreated: () => void }) {
  const user = useUser()
  const canAct = user.role === 'CIO' || user.role === 'ADMIN'
  const { data, error, reload } = useApi<any[]>('/api/news/inbox')
  const [sel, setSel] = useState<string[]>([])
  const [type, setType] = useState<string>('')
  const [title, setTitle] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [origin, setOrigin] = useState<string>('all')
  const chosen = useMemo(() => (data ?? []).filter(n => sel.includes(n.id)), [data, sel])
  const suggested = [...chosen].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))[0]?.suggested_type ?? 'corporate'
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const run = (fn: () => Promise<unknown>) => async () => { setErr(null); setMsg(null); try { await fn() } catch (e) { setErr(e) } }
  return (
    <Card title={<span>Hộp tin mới <span className="text-fgm font-normal text-[13px]">· tin báo chính thống (RSS) và tin Claude tìm, đồng bộ mỗi 10 phút</span></span>}
      actions={canAct && <div className="flex gap-2"><Btn small kind="secondary" onClick={run(async () => { const r: any = await api('/api/external/import', { method: 'POST' }); setMsg(r.skipped ? r.skipped : `Nhập kết quả Claude: ${r.news.created} tin mới, ${r.events.length} sự kiện, ${r.views.length} nhận định${r.views.length ? ` (${r.views.map((v: any) => v.view_id).join(', ')})` : ''}${r.rejected.length ? `; ${r.rejected.length} bản bị từ chối` : ''}${r.waiting.length ? `; ${r.waiting.length} bản đang chờ` : ''}`); reload(); onCreated() })}>Nhập kết quả Claude</Btn><Btn small kind="secondary" onClick={run(async () => { const r: any = await api('/api/news/ingest', { method: 'POST' }); setMsg(`Đã lấy ${r.created} tin mới (đọc ${r.fetched} tin từ ${r.sources} nguồn; trùng ${r.duplicate}, không liên quan ${r.irrelevant}, quá cũ ${r.too_old}, ngoài danh sách nguồn ${r.rejected}${r.errors.length ? `; ${r.errors.length} nguồn lỗi: ${r.errors.map((e: any) => e.source).join(', ')}` : ''})`); reload() })}>Lấy tin ngay</Btn></div>}>
      <ErrorBox error={err ?? error} />
      {msg && <p className="text-[13px] text-fgm mb-2">{msg}</p>}
      {!data ? <Loading /> : data.length === 0 ? <p className="text-fgm text-sm">Chưa có tin mới. {canAct && 'Bấm "Lấy tin ngay" hoặc chờ lần lấy tin tự động kế tiếp.'}</p> : (
        <>
          <div className="flex flex-wrap gap-1.5 mb-2 text-[13px]">{[['all', 'Tất cả'], ['global', 'Quốc tế'], ['local', 'Trong nước'], ['exclusive', 'Độc quyền TCB']].map(([k, l]) => <button key={k} onClick={() => setOrigin(k)} className={`border rounded px-2 py-0.5 ${origin === k ? 'border-primary text-fg' : 'border-border text-fgm'}`}>{l} ({k === 'all' ? data.length : data.filter(n => (n.origin ?? 'local') === k).length})</button>)}</div>
          <ul className="divide-y divide-border max-h-[420px] overflow-y-auto">
            {data.filter(n => origin === 'all' || (n.origin ?? 'local') === origin).map(n => (
              <li key={n.id} className="py-2 flex gap-3 items-start">
                {canAct && <input type="checkbox" className="mt-1" checked={sel.includes(n.id)} onChange={() => toggle(n.id)} aria-label={`Chọn tin ${n.id}`} />}
                <div className="min-w-0 flex-1 text-[13px]">
                  <div className="flex flex-wrap items-center gap-1.5"><b className="text-[14px]">{n.title}</b>{n.restricted_hit && <Badge tone="amber">Nhắc tổ chức trong danh sách hạn chế</Badge>}</div>
                  <div className="text-fgm">{n.summary}</div>
                  <div className="flex flex-wrap gap-1.5 mt-1 items-center text-fgm"><OriginBadge o={n.origin ?? 'local'} />{n.by_claude && <Badge tone="primary">Claude tìm</Badge>}{n.origin === 'exclusive' ? <span>{n.source} · số {n.research?.doc_no}</span> : <a className="text-primary hover:underline" href={n.url} target="_blank" rel="noreferrer">{n.feed ?? n.source}</a>}<span>· công bố {ts(n.published_at)}</span><Badge>{TYPES[n.suggested_type] ?? n.suggested_type}</Badge>{(n.tickers ?? []).map((t: string) => <Badge key={t} tone="primary">{t}</Badge>)}</div>
                </div>
              </li>
            ))}
          </ul>
          {canAct && (
            <div className="border-t border-border mt-2 pt-3 flex flex-wrap gap-2 items-end text-sm">
              <span className="text-fgm">{sel.length ? `Đã chọn ${sel.length} tin` : 'Chọn tin cùng một diễn biến để lập sự kiện'}</span>
              <label className="flex flex-col gap-1">Loại sự kiện<select value={type || suggested} onChange={e => setType(e.target.value)}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="flex flex-col gap-1 flex-1 min-w-48">Tiêu đề sự kiện<input value={title} placeholder={chosen[0]?.title ?? ''} onChange={e => setTitle(e.target.value)} /></label>
              <Btn disabled={!sel.length} onClick={run(async () => { await api('/api/events/from-news', { method: 'POST', body: { news_ids: sel, type: type || suggested, title } }); setSel([]); setTitle(''); setType(''); reload(); onCreated() })}>Lập sự kiện</Btn>
              <Btn kind="ghost" disabled={!sel.length} onClick={run(async () => { await api('/api/news/dismiss', { method: 'POST', body: { ids: sel } }); setSel([]); reload() })}>Ẩn tin đã chọn</Btn>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

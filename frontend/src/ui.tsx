// Thành phần dùng chung theo design-system/MASTER.md
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Info, Loader2, X } from 'lucide-react'
import { fmtPct, fmtVnd, fmtVndShort } from '../../src/shared/format'
import { api, ApiError } from './api'

export { fmtPct, fmtVnd, fmtVndShort }

export function useApi<T = any>(path: string | null, deps: unknown[] = []): { data: T | null; error: ApiError | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!path) return
    let alive = true
    setLoading(true)
    api<T>(path).then(d => { if (alive) { setData(d); setError(null) } }).catch(e => { if (alive) setError(e) }).finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [path, tick, ...deps])
  return { data, error, loading, reload: () => setTick(t => t + 1) }
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`bg-card border border-border rounded-lg ${className}`}>
      {(title || actions) && <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border"><h2 className="text-[15px] font-semibold">{title}</h2><div className="flex gap-2 flex-wrap">{actions}</div></header>}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Btn({ children, onClick, kind = 'primary', disabled, title, type = 'button', small }: { children: ReactNode; onClick?: () => void | Promise<void>; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; title?: string; type?: 'button' | 'submit'; small?: boolean }) {
  const [busy, setBusy] = useState(false)
  const cls = { primary: 'bg-primary text-[#0b1020] hover:bg-[#a5b4fc]', secondary: 'border border-border hover:bg-muted', danger: 'border border-red text-red hover:bg-red/10', ghost: 'text-primary hover:underline' }[kind]
  return (
    <button type={type} title={title} disabled={disabled || busy} onClick={async () => { if (!onClick) return; setBusy(true); try { await onClick() } finally { setBusy(false) } }}
      className={`${cls} ${small ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5 text-sm'} rounded-md font-medium transition-colors duration-150 disabled:opacity-40 inline-flex items-center gap-1.5`}>
      {busy && <Loader2 size={14} className="animate-spin" />}{children}
    </button>
  )
}

const TONES: Record<string, string> = {
  red: 'bg-red/15 text-red border-red/40', amber: 'bg-amber/15 text-amber border-amber/40', green: 'bg-green/15 text-green border-green/40',
  positive: 'bg-positive/15 text-positive border-positive/40', low: 'bg-low/10 text-fgm border-border', primary: 'bg-primary/15 text-primary border-primary/40',
}
export function Badge({ tone = 'low', children, title }: { tone?: keyof typeof TONES | string; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone] ?? TONES.low}`}>{children}</span>
}

export const ALERT = { RED: ['red', 'Đỏ'], YELLOW: ['amber', 'Vàng'], GREEN: ['green', 'Xanh'], POSITIVE: ['positive', 'Tích cực'] } as const
export function AlertBadge({ level }: { level: string }) { const a = ALERT[level as keyof typeof ALERT] ?? ['low', level]; return <Badge tone={a[0]}>{a[1]}</Badge> }
export const GOAL = { ON_TRACK: ['green', 'Đạt'], WATCH: ['amber', 'Theo dõi'], SHORT: ['red', 'Thiếu'] } as const
export function GoalBadge({ level }: { level: string }) { const a = GOAL[level as keyof typeof GOAL] ?? ['low', level]; return <Badge tone={a[0]}>{a[1]}</Badge> }
export const SEV = { critical: ['red', 'Nghiêm trọng'], medium: ['amber', 'Trung bình'], low: ['low', 'Thấp'] } as const
export function SevBadge({ s }: { s: string }) { const a = SEV[s as keyof typeof SEV] ?? ['low', s]; return <Badge tone={a[0]}>{a[1]}</Badge> }

const STATUS_TONE: Record<string, string> = { EFFECTIVE: 'green', APPROVED: 'green', PENDING_APPROVAL: 'primary', PENDING_CHALLENGE: 'amber', NEEDS_CIO_REVIEW: 'amber', DRAFTING: 'low', SUPERSEDED: 'low', WITHDRAWN: 'red', REJECTED: 'red', AGENT_ERROR: 'red', FAILED: 'red', REWORK_REQUESTED: 'low', COMPUTING: 'low', POST_CHECKING: 'low' }
export const STATUS_LABEL: Record<string, string> = {
  DRAFTING: 'Đang lập', AGENT_ERROR: 'Lỗi agent', PENDING_CHALLENGE: 'Chờ phản biện', PENDING_APPROVAL: 'Chờ duyệt', APPROVED: 'Đã duyệt', REWORK_REQUESTED: 'Yêu cầu làm lại', REJECTED: 'Bị bác', SUPERSEDED: 'Đã thay thế', WITHDRAWN: 'Đã thu hồi',
  COMPUTING: 'Đang tính', FAILED: 'Lỗi', POST_CHECKING: 'Đang hậu kiểm', NEEDS_CIO_REVIEW: 'Chờ CIO xem', EFFECTIVE: 'Đang hiệu lực',
}
export function StatusBadge({ s }: { s: string }) { return <Badge tone={STATUS_TONE[s] ?? 'low'} title={s}>{STATUS_LABEL[s] ?? s}</Badge> }

export function Money({ v, short, signed = true }: { v: string | number | null | undefined; short?: boolean; signed?: boolean }) {
  if (v === null || v === undefined) return <span className="text-fgm">—</span>
  const n = Number(v)
  return <span className={`num ${signed && n < 0 ? 'text-fg' : ''}`} title={`${fmtVnd(v)} VND`}>{short ? fmtVndShort(v) : fmtVnd(v)}</span>
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null
  const e = error as ApiError
  const details = Array.isArray(e.details) ? e.details : e.details ? [JSON.stringify(e.details)] : []
  return (
    <div role="alert" className="border border-red/50 bg-red/10 text-red rounded-md px-3 py-2 text-sm">
      <div className="flex items-center gap-2 font-medium"><AlertTriangle size={16} />{e.message ?? String(error)}</div>
      {details.length > 0 && <ul className="list-disc ml-6 mt-1 text-[13px]">{details.map((d: any, i) => <li key={i}>{typeof d === 'string' ? d : JSON.stringify(d)}</li>)}</ul>}
    </div>
  )
}

export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return <div className={`flex gap-2 items-start text-[13px] rounded-md px-3 py-2 border ${tone === 'warn' ? 'border-amber/40 bg-amber/10 text-amber' : 'border-border bg-muted text-fgm'}`}><Info size={15} className="mt-0.5 shrink-0" /><div>{children}</div></div>
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div role="dialog" aria-label={title} className={`bg-card border border-border rounded-lg w-full ${wide ? 'max-w-5xl' : 'max-w-2xl'} mt-10`} onClick={e => e.stopPropagation()}>
        <header className="flex justify-between items-center px-4 py-2.5 border-b border-border"><h3 className="font-semibold">{title}</h3><button aria-label="Đóng" onClick={onClose} className="text-fgm hover:text-fg"><X size={18} /></button></header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return <div role="tablist" className="flex gap-1 border-b border-border mb-4 overflow-x-auto">{tabs.map(t => <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => onChange(t.id)} className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${active === t.id ? 'border-primary text-fg' : 'border-transparent text-fgm hover:text-fg'}`}>{t.label}</button>)}</div>
}

export function Loading() { return <div className="text-fgm flex items-center gap-2 p-4"><Loader2 className="animate-spin" size={16} />Đang tải…</div> }
export function Kv({ k, v }: { k: ReactNode; v: ReactNode }) { return <div className="flex justify-between gap-4 py-1 border-b border-[#1e2537] text-[13px]"><span className="text-fgm">{k}</span><span className="text-right">{v}</span></div> }
export const ts = (s?: string | null) => s ? new Date(s).toLocaleString('vi-VN', { hour12: false }) : '—'
export function duration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return '—'
  const m = Math.round(ms / 60000); const h = Math.floor(m / 60); const d = Math.floor(h / 24)
  return d > 0 ? `${d} ngày ${h % 24} giờ` : h > 0 ? `${h} giờ ${m % 60} phút` : `${m} phút`
}
export const DISCLAIMER = 'Cú sốc giá tức thời giả định theo cấu hình minh họa. Không theo thời gian, không phải dự báo'
export const GOAL_DISCLAIMER = 'Nội bộ – giả định minh họa, không phải cam kết lợi nhuận'

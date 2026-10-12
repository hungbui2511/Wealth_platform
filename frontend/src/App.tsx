import { createContext, useContext, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { BookOpen, Bot, ClipboardCheck, Database, FileText, Gauge, Landmark, LogOut, Newspaper, Radar, ScrollText, Settings, Users } from 'lucide-react'
import { api, getUserId, setUserId, stepLabel } from './api'
import { Badge, Btn, Card, ErrorBox, Loading } from './ui'
import Home from './pages/Home'
import Families from './pages/Families'
import FamilyDetail from './pages/FamilyDetail'
import Events from './pages/Events'
import Desk from './pages/Desk'
import ViewDetail from './pages/ViewDetail'
import Runs, { RunDetail } from './pages/Runs'
import AgentRun from './pages/AgentRun'
import PolicyRadar from './pages/PolicyRadar'
import Releases from './pages/Releases'
import Config from './pages/Config'
import Audit from './pages/Audit'
import Trace from './pages/Trace'
import Agents from './pages/Agents'
import Prices from './pages/Prices'

export interface User { id: string; name: string; role: 'CIO' | 'RM' | 'COMPLIANCE' | 'ADMIN'; families: string[] }
const Ctx = createContext<{ user: User; logout: () => void }>(null as never)
export const useUser = () => useContext(Ctx).user
export const ROLE_LABEL: Record<string, string> = { CIO: 'CIO', RM: 'RM', COMPLIANCE: 'Tuân thủ', ADMIN: 'Quản trị' }

const NAV: { to: string; label: string; icon: typeof Gauge; roles: string[] }[] = [
  { to: '/', label: 'Tổng quan', icon: Gauge, roles: ['CIO', 'RM', 'COMPLIANCE', 'ADMIN'] },
  { to: '/families', label: 'Gia đình', icon: Users, roles: ['CIO', 'RM', 'COMPLIANCE', 'ADMIN'] },
  { to: '/events', label: 'Sự kiện', icon: Newspaper, roles: ['CIO', 'COMPLIANCE', 'ADMIN'] },
  { to: '/desk', label: 'Bàn duyệt CIO', icon: ClipboardCheck, roles: ['CIO', 'COMPLIANCE'] },
  { to: '/runs', label: 'Lần áp dụng', icon: Landmark, roles: ['CIO', 'COMPLIANCE', 'ADMIN'] },
  { to: '/radar', label: 'Radar chính sách', icon: Radar, roles: ['CIO', 'RM', 'COMPLIANCE', 'ADMIN'] },
  { to: '/releases', label: 'Bản tin CIO', icon: FileText, roles: ['CIO', 'COMPLIANCE'] },
  { to: '/prices', label: 'Nguồn giá', icon: Database, roles: ['CIO', 'COMPLIANCE', 'ADMIN'] },
  { to: '/config', label: 'Cấu hình', icon: Settings, roles: ['CIO', 'COMPLIANCE', 'ADMIN'] },
  { to: '/audit', label: 'Nhật ký', icon: ScrollText, roles: ['CIO', 'COMPLIANCE', 'ADMIN'] },
  { to: '/agents', label: 'Danh mục agent', icon: Bot, roles: ['CIO', 'COMPLIANCE', 'ADMIN'] },
]

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [users, setUsers] = useState<User[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const load = () => api<User[]>('/api/users').then(setUsers).catch(setErr)
  useEffect(() => { load() }, [])
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">Wealth Platform 2036 – MVP1</h1>
      <p className="text-fgm">Bản đồ tài sản gia đình và AI Agent CIO. Chọn vai trò để đăng nhập (bản demo, chỉ dữ liệu giả lập).</p>
      <ErrorBox error={err} />
      {!users ? <Loading /> : users.length === 0 ? (
        <Card title="Chưa có dữ liệu">
          <p className="mb-3 text-fgm">Cơ sở dữ liệu còn trống. Nạp dữ liệu mẫu lần đầu (20 gia đình giả lập, công cụ, giá mẫu).</p>
          <Btn onClick={async () => { try { await api('/api/bootstrap', { method: 'POST' }); await load() } catch (e) { setErr(e) } }}>Nạp dữ liệu mẫu</Btn>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {users.map(u => (
            <button key={u.id} onClick={() => onLogin(u)} className="text-left bg-card border border-border rounded-lg p-4 hover:border-primary transition-colors">
              <div className="flex items-center justify-between"><span className="font-medium">{u.name}</span><Badge tone="primary">{ROLE_LABEL[u.role]}</Badge></div>
              <div className="text-fgm text-[13px] mt-1">{u.role === 'RM' ? `Phụ trách ${u.families.length} gia đình: ${u.families.join(', ')}` : { CIO: 'Duyệt nhận định, cấu hình bảng u và ngưỡng', COMPLIANCE: 'Nhật ký, truy vết, danh sách hạn chế, xác nhận prompt', ADMIN: 'Nạp dữ liệu, tạo sự kiện, nguồn giá, đề xuất prompt' }[u.role]}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Trạng thái AI và tác vụ agent đang chạy nền (chế độ live); làm mới mỗi 5 giây khi có tác vụ
function AgentStatus({ user }: { user: User }) {
  const [health, setHealth] = useState<any>(null)
  const [jobs, setJobs] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const staff = user.role !== 'RM'
  useEffect(() => { api('/api/health').then(setHealth).catch(() => {}) }, [])
  useEffect(() => {
    if (!staff) return
    let alive = true
    const tick = () => api<any[]>('/api/jobs?active=1').then(j => { if (alive) setJobs(j) }).catch(() => {})
    tick(); const t = setInterval(tick, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [staff])
  if (!health) return null
  const live = health.agent_mode === 'live'
  return (
    <div className="relative flex items-center gap-2">
      {health.agent_mode === 'external'
        ? <Badge tone="green" title="Claude chạy các agent trong phiên làm việc rồi đẩy kết quả lên; hệ thống nhập mỗi 10 phút qua cùng các kiểm soát">AI: Claude (đồng bộ theo phiên)</Badge>
        : <Badge tone={live ? (health.llm_key ? 'green' : 'red') : 'low'} title={live ? 'Agent gọi Claude qua API' : 'Chưa bật AI thật: sự kiện mẫu dùng đầu ra ghi sẵn, tin mới dùng luật từ khóa'}>{live ? (health.llm_key ? 'AI: Claude (live)' : 'AI live: thiếu khóa API') : 'AI: mô phỏng'}</Badge>}
      {staff && jobs.length > 0 && <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-primary"><Bot size={14} className="animate-pulse" />{jobs.length} tác vụ AI đang chờ/chạy</button>}
      {open && jobs.length > 0 && (
        <div className="absolute right-0 top-7 z-50 w-80 bg-card border border-border rounded-md p-3 shadow-lg text-[13px] space-y-2">
          {jobs.map(j => <div key={j.id}><div className="font-medium">{({ cio_run: 'Agent CIO', challenge_retry: 'Agent Phản biện', rechallenge: 'Phản biện lại', policy_analyze: 'Agent Chính sách' } as Record<string, string>)[j.kind] ?? j.kind} · <span className="mono">{j.subject}</span></div><div className="text-fgm">{j.status === 'WAITING_EXTERNAL' ? 'Chờ Claude phân tích (lần đồng bộ kế tiếp)' : j.status === 'QUEUED' ? 'Đang chờ chạy' : j.steps.length ? `Đang: ${stepLabel(j.steps[j.steps.length - 1].step)} (${j.steps.length} bước)` : 'Đang chuẩn bị dữ liệu'}</div></div>)}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checked, setChecked] = useState(false)
  const nav = useNavigate()
  useEffect(() => {
    if (!getUserId()) { setChecked(true); return }
    api<User>('/api/me').then(setUser).catch(() => setUserId(null)).finally(() => setChecked(true))
  }, [])
  const logout = () => { setUserId(null); setUser(null); nav('/') }
  return (
    <div className="min-h-screen flex flex-col">
      {/* Nhãn cố định NFR-11 – không ẩn được */}
      <div className="sticky top-0 z-40 flex flex-wrap items-center gap-2 justify-between px-4 py-1.5 bg-[#1a1408] border-b border-amber/40 text-[12px]">
        <div className="flex gap-2"><Badge tone="amber">Demo – khách hư cấu, mã thật, giá mẫu</Badge><Badge tone="red">Nội bộ – không gửi khách hàng</Badge></div>
        {user && <div className="flex items-center gap-3 text-fgm"><AgentStatus user={user} /><span>{user.name}</span><Badge tone="primary">{ROLE_LABEL[user.role]}</Badge><button onClick={logout} className="inline-flex items-center gap-1 hover:text-fg"><LogOut size={14} />Đổi vai trò</button></div>}
      </div>
      {!checked ? <Loading /> : !user ? <Login onLogin={u => { setUserId(u.id); setUser(u); nav('/') }} /> : (
        <Ctx.Provider value={{ user, logout }}>
          <div className="flex flex-1 min-h-0">
            <nav aria-label="Điều hướng" className="w-52 shrink-0 border-r border-border bg-card hidden md:block">
              <div className="px-4 py-3 font-semibold flex items-center gap-2"><BookOpen size={16} className="text-primary" />Wealth MVP1</div>
              {NAV.filter(n => n.roles.includes(user.role)).map(n => (
                <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `flex items-center gap-2 px-4 py-2 text-sm border-l-2 transition-colors ${isActive ? 'border-primary bg-muted text-fg' : 'border-transparent text-fgm hover:text-fg hover:bg-muted'}`}><n.icon size={16} />{n.label}</NavLink>
              ))}
            </nav>
            <div className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border flex overflow-x-auto">
              {NAV.filter(n => n.roles.includes(user.role)).map(n => <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `px-3 py-2 text-xs whitespace-nowrap ${isActive ? 'text-primary' : 'text-fgm'}`}>{n.label}</NavLink>)}
            </div>
            <main className="flex-1 min-w-0 p-4 md:p-6 pb-16 space-y-4">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/families" element={<Families />} />
                <Route path="/families/:id" element={<FamilyDetail />} />
                <Route path="/events" element={<Events />} />
                <Route path="/desk" element={<Desk />} />
                <Route path="/views/:id" element={<ViewDetail />} />
                <Route path="/runs" element={<Runs />} />
                <Route path="/runs/:id" element={<RunDetail />} />
                <Route path="/agent-runs/:id" element={<AgentRun />} />
                <Route path="/radar" element={<PolicyRadar />} />
                <Route path="/releases" element={<Releases />} />
                <Route path="/config" element={<Config />} />
                <Route path="/audit" element={<Audit />} />
                <Route path="/trace/:runId/:familyId" element={<Trace />} />
                <Route path="/agents" element={<Agents />} />
                <Route path="/prices" element={<Prices />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </main>
          </div>
        </Ctx.Provider>
      )}
    </div>
  )
}

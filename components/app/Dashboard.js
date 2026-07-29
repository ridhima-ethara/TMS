'use client'
import { useEffect, useState } from 'react'
import { api, PRIORITY_META, statusClass } from '@/lib/appapi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import TicketCalendar from '@/components/app/TicketCalendar'
import { Ticket, AlertTriangle, CheckCircle2, Clock, FileCheck2, Timer, Gauge, Server, Building2, Users, ClipboardCheck, XCircle, CircleAlert } from 'lucide-react'

const PIE_COLORS = { Critical: '#991b1b', High: '#f97316', Medium: '#facc15', Low: '#10b981' }

function Stat({ label, value, icon: Icon, tone = 'default', suffix = '' }) {
  const tones = { default: 'text-foreground', red: 'text-red-600', amber: 'text-amber-600', green: 'text-green-600', blue: 'text-blue-600' }
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-semibold ${tones[tone]}`}>{value ?? 0}{suffix}</p>
        </div>
        {Icon && <Icon className={`h-8 w-8 opacity-20 ${tones[tone]}`} />}
      </CardContent>
    </Card>
  )
}

function slaTone(pct) { return pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600' }

function Charts({ s, stacked }) {
  const pdata = (s.by_priority || []).filter((x) => x.value > 0)
  return (
    <div className={`grid gap-4 ${stacked ? 'grid-cols-1' : 'md:grid-cols-2'}`}>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">By Priority</CardTitle></CardHeader>
        <CardContent>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pdata} dataKey="value" nameKey="name" innerRadius={38} outerRadius={68} paddingAngle={2}>
                  {pdata.map((e, i) => <Cell key={i} fill={PIE_COLORS[e.name] || '#64748b'} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
            {(s.by_priority || []).map((e) => (
              <span key={e.name} className="flex items-center gap-1.5 text-xs">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[e.name] || '#64748b' }} />
                <span className="text-foreground font-medium">{e.name}</span>
                <span className="text-muted-foreground">{e.value}</span>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">By Category</CardTitle></CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={(s.by_category || []).slice(0, 8)}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#0d9488" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}

function MemberSla({ rows }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" />Member SLA Performance</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Member</TableHead><TableHead className="text-center">Assigned</TableHead><TableHead className="text-center">Open</TableHead>
            <TableHead className="text-center">Resolved</TableHead><TableHead className="text-center">Avg Response</TableHead>
            <TableHead className="text-center">Avg Resolution</TableHead><TableHead className="text-center">SLA Met</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(rows || []).map((m) => (
              <TableRow key={m.member_id}>
                <TableCell><div className="font-medium">{m.member_name}</div><div className="text-xs text-muted-foreground">{m.location}</div></TableCell>
                <TableCell className="text-center">{m.assigned}</TableCell>
                <TableCell className="text-center">{m.open}</TableCell>
                <TableCell className="text-center">{m.resolved}</TableCell>
                <TableCell className="text-center">{m.avg_response_hours}h</TableCell>
                <TableCell className="text-center">{m.avg_resolution_hours}h</TableCell>
                <TableCell className={`text-center font-semibold ${slaTone(m.sla_compliance)}`}>{m.sla_compliance}%</TableCell>
              </TableRow>
            ))}
            {(!rows || rows.length === 0) && <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No members</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function DeptPanel({ department, onOpenTicket, refresh }) {
  const [s, setS] = useState(null)
  const [sla, setSla] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    Promise.all([
      api(`/dashboard?department=${department}`),
      api(`/reports/member-sla?department=${department}`),
    ]).then(([d, m]) => { setS(d); setSla(m) }).catch(() => {}).finally(() => setLoading(false))
  }, [department, refresh])

  const Icon = department === 'IT' ? Server : Building2
  const accent = department === 'IT' ? 'from-indigo-600 to-blue-500' : 'from-teal-600 to-emerald-500'

  if (loading || !s) return <Skeleton className="h-96 w-full" />
  return (
    <div className="space-y-4">
      <div className={`rounded-lg bg-gradient-to-r ${accent} text-white p-4 flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex items-center gap-2"><Icon className="h-6 w-6" /><div><p className="text-base font-semibold">{department} Service Desk</p><p className="text-xs opacity-90">Live analytics & SLA</p></div></div>
        <div className="flex gap-4 text-center">
          <div><p className="text-xl font-bold">{s.total}</p><p className="text-[10px] opacity-90">Tickets</p></div>
          <div><p className="text-xl font-bold">{s.escalated}</p><p className="text-[10px] opacity-90">Escalated</p></div>
          <div><p className="text-xl font-bold">{s.sla_compliance}%</p><p className="text-[10px] opacity-90">SLA Met</p></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Today (per day)" value={s.today} icon={Ticket} tone="blue" />
        <Stat label="In Progress" value={s.in_progress} icon={Timer} tone="blue" />
        <Stat label="Pending Approval" value={s.pending_approval} icon={FileCheck2} tone="amber" />
        <Stat label="Approved Ready" value={s.approved_ready} icon={CheckCircle2} tone="green" />
        <Stat label="Resolved" value={s.resolved} icon={CheckCircle2} tone="green" />
        <Stat label="Escalated (>24h)" value={s.escalated} icon={AlertTriangle} tone="red" />
        <Stat label="Avg Response" value={s.avg_response_hours} suffix="h" icon={Gauge} />
        <Stat label="Avg Resolution" value={s.avg_resolution_hours} suffix="h" icon={Gauge} />
      </div>
      <Charts s={s} stacked />
      <MemberSla rows={sla?.members} />
    </div>
  )
}

function DailyKra({ refresh }) {
  const [data, setData] = useState(null)
  useEffect(() => { api('/reports/daily-kra').then(setData).catch(() => {}) }, [refresh])
  const meta = {
    Completed: { cls: 'border-green-300 bg-green-50', badge: 'bg-green-100 text-green-700', icon: CheckCircle2, tone: 'text-green-600' },
    Partial: { cls: 'border-amber-300 bg-amber-50', badge: 'bg-amber-100 text-amber-700', icon: CircleAlert, tone: 'text-amber-600' },
    'Not Submitted': { cls: 'border-red-300 bg-red-50', badge: 'bg-red-100 text-red-700', icon: XCircle, tone: 'text-red-600' },
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-teal-600" />Daily KRA Compliance
          <span className="text-xs font-normal text-muted-foreground ml-1">{data?.date}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(data?.members || []).map((m) => {
            const mt = meta[m.status] || meta['Not Submitted']
            const Icon = mt.icon
            return (
              <div key={m.member_id} className={`rounded-lg border p-3 ${mt.cls}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{m.member_name}</p>
                    <p className="text-[11px] text-muted-foreground uppercase">{m.member_role === 'it' ? 'IT Team' : 'Admin Team'}</p>
                  </div>
                  <Icon className={`h-5 w-5 ${mt.tone}`} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${mt.badge}`}>{m.status}</span>
                  <span className="text-xs text-muted-foreground">{m.done_items}/{m.total_items} tasks</span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div className={`h-full ${m.status === 'Completed' ? 'bg-green-500' : m.status === 'Partial' ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${m.pct}%` }} />
                </div>
              </div>
            )
          })}
          {(!data || data.members.length === 0) && <p className="text-sm text-muted-foreground">No KRA assigned yet.</p>}
        </div>
      </CardContent>
    </Card>
  )
}

function MyKra({ refresh }) {
  const [lists, setLists] = useState([])
  useEffect(() => { api('/member-checklists').then(setLists).catch(() => {}) }, [refresh])
  if (!lists.length) return null
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-teal-600" />My KRA — Today</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {lists.map((l) => {
          const sub = l.today_submission
          const done = sub ? (sub.responses || []).filter((r) => r.done).length : 0
          const total = l.items.length
          const complete = sub && sub.status === 'Completed'
          return (
            <div key={l.id} className={`rounded-md border p-3 ${!sub ? 'border-red-300 bg-red-50' : complete ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{l.title}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${!sub ? 'bg-red-100 text-red-700' : complete ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {!sub ? 'Not submitted' : complete ? 'Completed' : 'In progress'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {l.items.map((it) => {
                  const r = sub?.responses?.find((x) => x.item === it.label)
                  const isDone = r?.done
                  return (
                    <span key={it.key} className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${isDone ? 'bg-green-100 text-green-700 border-green-300' : 'bg-muted text-muted-foreground border-border'}`}>
                      {isDone ? <CheckCircle2 className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}{it.label}
                    </span>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">{done}/{total} done · complete & submit in <span className="font-medium">My Checklist</span></p>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function SuperDash({ onOpenTicket, refresh }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <DeptPanel department="IT" onOpenTicket={onOpenTicket} refresh={refresh} />
        <DeptPanel department="Admin" onOpenTicket={onOpenTicket} refresh={refresh} />
      </div>
      <DailyKra refresh={refresh} />
    </div>
  )
}

function StaffDash({ user, onOpenTicket, refresh }) {
  const [s, setS] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    api('/dashboard').then(setS).catch(() => {}).finally(() => setLoading(false))
  }, [refresh])

  if (loading) return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
  if (!s) return null

  const cards = [{ label: 'Total', value: s.total, icon: Ticket }, { label: 'Open', value: s.open, icon: Clock, tone: 'blue' }, { label: 'In Progress', value: s.in_progress, icon: Timer, tone: 'blue' }]
  if (user.role === 'employee') {
    cards.push({ label: 'Pending Approval', value: s.pending_approval, icon: FileCheck2, tone: 'amber' }, { label: 'Resolved', value: s.resolved, icon: CheckCircle2, tone: 'green' }, { label: 'Closed', value: s.closed, icon: CheckCircle2, tone: 'green' })
  } else {
    cards.push({ label: 'Pending Approval', value: s.pending_approval, icon: FileCheck2, tone: 'amber' }, { label: 'Resolved', value: s.resolved, icon: CheckCircle2, tone: 'green' }, { label: 'Overdue / SLA Breach', value: s.overdue, icon: AlertTriangle, tone: 'red' }, { label: 'Avg Response', value: s.avg_response_hours, suffix: 'h', icon: Gauge }, { label: 'Avg Resolution', value: s.avg_resolution_hours, suffix: 'h', icon: Gauge }, { label: 'SLA Met', value: s.sla_compliance, suffix: '%', icon: Gauge, tone: 'green' })
  }
  const isStaff = user.role === 'it' || user.role === 'admin'

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{cards.map((c) => <Stat key={c.label} {...c} />)}</div>
      <Charts s={s} />
      {isStaff ? (
        <>
          <MyKra refresh={refresh} />
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Ticket Calendar</CardTitle></CardHeader>
            <CardContent><TicketCalendar tickets={s.calendar || []} onOpenTicket={onOpenTicket} /></CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent Tickets</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {(s.recent || []).map((t) => (
              <button key={t.id} onClick={() => onOpenTicket(t.id)} className="w-full flex items-center justify-between gap-2 rounded-md border p-2 text-left hover:bg-muted/50">
                <div className="flex items-center gap-2 min-w-0"><span className="font-mono text-xs text-muted-foreground shrink-0">{t.human_id}</span><span className="truncate text-sm">{t.title}</span></div>
                <div className="flex items-center gap-2 shrink-0"><Badge className={PRIORITY_META[t.priority]?.badge}>{t.priority}</Badge><Badge variant="outline" className={statusClass(t.status)}>{t.status}</Badge></div>
              </button>
            ))}
            {(!s.recent || s.recent.length === 0) && <p className="text-sm text-muted-foreground">No tickets yet.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function Dashboard({ user, onOpenTicket, refresh }) {
  if (user.role === 'super_admin') return <SuperDash onOpenTicket={onOpenTicket} refresh={refresh} />
  return <StaffDash user={user} onOpenTicket={onOpenTicket} refresh={refresh} />
}

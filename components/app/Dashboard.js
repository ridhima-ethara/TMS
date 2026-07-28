'use client'
import { useEffect, useState } from 'react'
import { api, PRIORITY_META, statusClass } from '@/lib/appapi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import TicketCalendar from '@/components/app/TicketCalendar'
import { Ticket, AlertTriangle, CheckCircle2, Clock, FileCheck2, Timer, Gauge, Server, Building2, Users } from 'lucide-react'

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
  return (
    <div className={`grid gap-4 ${stacked ? 'grid-cols-1' : 'md:grid-cols-2'}`}>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">By Priority</CardTitle></CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={(s.by_priority || []).filter((x) => x.value > 0)} dataKey="value" nameKey="name" innerRadius={40} outerRadius={75} label>
                {(s.by_priority || []).map((e, i) => <Cell key={i} fill={PIE_COLORS[e.name] || '#64748b'} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
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
          <div><p className="text-xl font-bold">{s.overdue}</p><p className="text-[10px] opacity-90">SLA Breach</p></div>
          <div><p className="text-xl font-bold">{s.sla_compliance}%</p><p className="text-[10px] opacity-90">SLA Met</p></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Open" value={s.open} icon={Clock} tone="blue" />
        <Stat label="In Progress" value={s.in_progress} icon={Timer} tone="blue" />
        <Stat label="Pending Approval" value={s.pending_approval} icon={FileCheck2} tone="amber" />
        <Stat label="Resolved" value={s.resolved} icon={CheckCircle2} tone="green" />
        <Stat label="Avg Response" value={s.avg_response_hours} suffix="h" icon={Gauge} />
        <Stat label="Avg Resolution" value={s.avg_resolution_hours} suffix="h" icon={Gauge} />
        <Stat label="Clarification" value={s.clarification} icon={AlertTriangle} tone="amber" />
        <Stat label="Overdue" value={s.overdue} icon={AlertTriangle} tone="red" />
      </div>
      <Charts s={s} stacked />
      <MemberSla rows={sla?.members} />
    </div>
  )
}

function SuperDash({ onOpenTicket, refresh }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <DeptPanel department="IT" onOpenTicket={onOpenTicket} refresh={refresh} />
      <DeptPanel department="Admin" onOpenTicket={onOpenTicket} refresh={refresh} />
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
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Ticket Calendar</CardTitle></CardHeader>
          <CardContent><TicketCalendar tickets={s.calendar || []} onOpenTicket={onOpenTicket} /></CardContent>
        </Card>
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

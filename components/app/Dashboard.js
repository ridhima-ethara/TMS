'use client'
import { useEffect, useState } from 'react'
import { api, fmtDateTime, PRIORITY_META, statusClass } from '@/lib/appapi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import TicketCalendar from '@/components/app/TicketCalendar'
import { Ticket, AlertTriangle, CheckCircle2, Clock, FileCheck2, Timer, Gauge, Server, Building2, Users, ClipboardCheck, XCircle, CircleAlert, ArrowRight, MapPin, UserRound, Inbox } from 'lucide-react'

const PIE_COLORS = { Critical: '#b91c1c', High: '#f97316', Medium: '#eab308', Low: '#16a34a' }

function Stat({ label, value, icon: Icon, tone = 'default', suffix = '' }) {
  const tones = { default: 'text-foreground', red: 'text-red-600', amber: 'text-amber-600', green: 'text-green-600', blue: 'text-blue-600' }
  return (
    <Card className="border-[#e4e6ef] bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-fuchsia-200 hover:shadow-[0_12px_32px_rgba(238,0,238,.08)]">
      <CardContent className="p-4 min-h-24 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-[#697087]">{label}</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${tones[tone]}`}>{value ?? 0}{suffix}</p>
        </div>
        {Icon && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f7f8fc]"><Icon className={`h-5 w-5 opacity-55 ${tones[tone]}`} /></span>}
      </CardContent>
    </Card>
  )
}

function slaTone(pct) { return pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600' }

function Charts({ s, stacked }) {
  const pdata = (s.by_priority || []).filter((x) => x.value > 0)
  return (
    <div className={`grid gap-4 ${stacked ? 'grid-cols-1' : 'md:grid-cols-2'}`}>
      <Card className="border-[#e4e6ef] overflow-hidden">
        <CardHeader className="pb-2"><CardTitle className="text-sm">By Priority</CardTitle></CardHeader>
        <CardContent>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pdata} dataKey="value" nameKey="name" innerRadius={38} outerRadius={68} paddingAngle={2}>
                  {pdata.map((e, i) => <Cell key={i} fill={PIE_COLORS[e.name] || '#64748b'} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e4e6ef', boxShadow: '0 10px 28px rgba(11,14,20,.12)' }} />
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
      <Card className="border-[#e4e6ef] overflow-hidden">
        <CardHeader className="pb-2"><CardTitle className="text-sm">By Category</CardTitle></CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={(s.by_category || []).slice(0, 8)}>
              <CartesianGrid stroke="#e8eaf2" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-25} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e4e6ef', boxShadow: '0 10px 28px rgba(11,14,20,.12)' }} />
              <Bar dataKey="value" fill="#ee00ee" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}

function MemberSla({ rows }) {
  return (
    <Card className="border-[#e4e6ef] overflow-hidden">
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" />Member SLA Performance</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table className="min-w-[760px]">
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
  const accent = department === 'IT' ? 'from-[#151a28] via-[#252b42] to-[#435987]' : 'from-[#6d006d] via-[#b000b0] to-[#ee00ee]'

  if (loading || !s) return <Skeleton className="h-96 w-full" />
  return (
    <div className="space-y-4">
      <div className={`relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-r ${accent} p-4 text-white shadow-[0_14px_35px_rgba(11,14,20,.16)] sm:p-5`}>
        <div className="pointer-events-none absolute -right-10 -top-20 h-44 w-44 rounded-full border border-white/15" />
        <div className="flex items-center gap-2"><Icon className="h-6 w-6" /><div><p className="text-base font-semibold">{department} Service Desk</p><p className="text-xs opacity-90">Live analytics & SLA</p></div></div>
        <div className="relative flex w-full justify-between gap-4 text-center sm:w-auto sm:gap-5">
          <div><p className="text-xl font-bold tabular-nums">{s.total}</p><p className="text-[10px] uppercase tracking-wider opacity-80">Tickets</p></div>
          <div><p className="text-xl font-bold tabular-nums">{s.escalated}</p><p className="text-[10px] uppercase tracking-wider opacity-80">Escalated</p></div>
          <div><p className="text-xl font-bold tabular-nums">{s.sla_compliance}%</p><p className="text-[10px] uppercase tracking-wider opacity-80">SLA Met</p></div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Stat label="Today (per day)" value={s.today} icon={Ticket} tone="blue" />
        <Stat label="In Progress" value={s.in_progress} icon={Timer} tone="blue" />
        <Stat label="Pending Approval" value={s.pending_approval} icon={FileCheck2} tone="amber" />
        <Stat label="Approved Ready" value={s.approved_ready} icon={CheckCircle2} tone="green" />
        <Stat label="Resolved" value={(s.resolved || 0) + (s.closed || 0)} icon={CheckCircle2} tone="green" />
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
    Issue: { cls: 'border-red-400 bg-red-50', badge: 'bg-red-600 text-white', icon: XCircle, tone: 'text-red-600' },
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-fuchsia-600" />Daily KRA Compliance
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
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-fuchsia-600" />My KRA — Today</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {lists.map((l) => {
          const sub = l.today_submission
          const done = sub ? (sub.responses || []).filter((r) => r.done).length : 0
          const total = l.items.length
          const complete = sub && sub.status === 'Completed'
          const issue = l.overdue || sub?.status === 'Late'
          return (
            <div key={l.id} className={`rounded-md border p-3 ${issue ? 'border-red-400 bg-red-50' : !sub ? 'border-slate-200 bg-slate-50' : complete ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{l.title}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${issue ? 'bg-red-600 text-white' : !sub ? 'bg-slate-100 text-slate-700' : complete ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {issue ? 'Issue · overdue' : !sub ? 'Not submitted' : complete ? 'Completed' : 'In progress'}
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
    <div className="space-y-7">
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-7">
        <DeptPanel department="IT" onOpenTicket={onOpenTicket} refresh={refresh} />
        <DeptPanel department="Admin" onOpenTicket={onOpenTicket} refresh={refresh} />
      </div>
      <DailyKra refresh={refresh} />
    </div>
  )
}

function EmployeeDash({ user, onOpenTicket, onGoTickets, onGoAcknowledgements, refresh }) {
  const [s, setS] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const load = async (showLoading = false) => {
      if (showLoading) setLoading(true)
      try {
        const dashboard = await api('/dashboard')
        if (active) {
          setS(dashboard)
          setError('')
        }
      } catch (requestError) {
        if (active) setError(requestError.message || 'Dashboard data could not be loaded.')
      } finally {
        if (active && showLoading) setLoading(false)
      }
    }
    load(true)
    const timer = window.setInterval(() => load(), 30_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [refresh])

  if (loading) return <div className="space-y-5"><Skeleton className="h-44 w-full rounded-2xl" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-72 w-full" /></div>
  if (!s) return <Card className="border-red-200"><CardContent className="flex min-h-52 flex-col items-center justify-center gap-3 p-6 text-center"><CircleAlert className="h-8 w-8 text-red-500" /><p className="font-medium">Employee dashboard is temporarily unavailable</p><p className="text-sm text-muted-foreground">{error || 'Please refresh and try again.'}</p></CardContent></Card>

  const cards = [
    { label: 'All requests', value: s.total, icon: Ticket },
    { label: 'Awaiting allocation', value: s.unallocated, icon: Inbox, tone: 'amber' },
    { label: 'In progress', value: s.in_progress, icon: Timer, tone: 'blue' },
    { label: 'Awaiting acknowledgement', value: s.resolved, icon: FileCheck2, tone: 'green' },
    { label: 'Completed', value: s.closed, icon: CheckCircle2, tone: 'green' },
  ]

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-[#252b42] bg-gradient-to-br from-[#111522] via-[#1d2336] to-[#333c5d] p-5 text-white shadow-[0_18px_45px_rgba(17,21,34,.18)] sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-20 h-56 w-56 rounded-full border border-fuchsia-300/20" />
        <div className="pointer-events-none absolute -bottom-24 right-24 h-48 w-48 rounded-full bg-fuchsia-500/10 blur-2xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-fuchsia-200">Employee service centre</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Welcome, {user.name?.split(' ')[0] || 'there'}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">Raise a request, follow every update, and confirm completed work from one clear workspace.</p>
          </div>
          <Button onClick={onGoTickets} className="w-full bg-[#ee00ee] text-white shadow-lg shadow-fuchsia-950/30 hover:bg-[#cf00cf] sm:w-auto">
            View my requests <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </section>

      {error && <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Latest refresh failed; showing the most recent dashboard data.</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{cards.map((c) => <Stat key={c.label} {...c} />)}</div>

      <Card className={`overflow-hidden ${s.resolved ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-white' : 'border-[#e4e6ef]'}`}>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${s.resolved ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}><FileCheck2 className="h-5 w-5" /></span>
            <div>
              <p className="font-semibold text-[#111827]">Resolution acknowledgements</p>
              <p className="mt-1 text-sm leading-5 text-[#697087]">{s.resolved ? `${s.resolved} resolved ${s.resolved === 1 ? 'issue is' : 'issues are'} ready for your review.` : 'You have no resolutions waiting for confirmation.'}</p>
            </div>
          </div>
          <Button variant={s.resolved ? 'default' : 'outline'} onClick={onGoAcknowledgements} className={s.resolved ? 'bg-emerald-700 text-white hover:bg-emerald-800' : ''}>Open acknowledgement centre <ArrowRight className="ml-2 h-4 w-4" /></Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-[#e4e6ef]">
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-[#edf0f4] bg-[#fbfcfe] py-4">
          <div><CardTitle className="text-base">Recent requests</CardTitle><p className="mt-1 text-xs text-muted-foreground">Your latest service activity and ownership</p></div>
          <Button variant="ghost" size="sm" onClick={onGoTickets}>View all <ArrowRight className="ml-1 h-4 w-4" /></Button>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {(s.recent || []).map((t) => (
            <button key={t.id} onClick={() => onOpenTicket(t.id)} className="group grid w-full gap-3 p-4 text-left transition-colors hover:bg-[#faf7ff] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[11px] font-medium text-fuchsia-700">{t.human_id}</span><Badge className={PRIORITY_META[t.priority]?.badge}>{t.priority}</Badge></div>
                <p className="mt-2 truncate text-sm font-semibold text-[#111827] group-hover:text-fuchsia-800">{t.title}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#697087]"><span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{t.assignee_name || 'Awaiting allocation'}</span><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{t.location || 'Location not set'}</span><span>{t.category || 'General'}</span><span>Updated {fmtDateTime(t.updated_at)}</span></div>
              </div>
              <Badge variant="outline" className={`${statusClass(t.status)} w-fit`}>{t.status}</Badge>
            </button>
          ))}
          {(!s.recent || s.recent.length === 0) && <div className="flex min-h-40 flex-col items-center justify-center p-6 text-center"><Inbox className="h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-medium">No requests raised yet</p><p className="mt-1 text-xs text-muted-foreground">Your submitted issues will appear here.</p></div>}
        </CardContent>
      </Card>
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
  if (loading) return <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
  if (!s) return null
  const cards = [{ label: 'Total', value: s.total, icon: Ticket }, { label: 'Open', value: s.open, icon: Clock, tone: 'blue' }, { label: 'In Progress', value: s.in_progress, icon: Timer, tone: 'blue' }, { label: 'Pending Approval', value: s.pending_approval, icon: FileCheck2, tone: 'amber' }, { label: 'Resolved', value: (s.resolved || 0) + (s.closed || 0), icon: CheckCircle2, tone: 'green' }, { label: 'Overdue / SLA Breach', value: s.overdue, icon: AlertTriangle, tone: 'red' }, { label: 'Avg Response', value: s.avg_response_hours, suffix: 'h', icon: Gauge }, { label: 'Avg Resolution', value: s.avg_resolution_hours, suffix: 'h', icon: Gauge }, { label: 'SLA Met', value: s.sla_compliance, suffix: '%', icon: Gauge, tone: 'green' }]
  return <div className="space-y-6"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map((c) => <Stat key={c.label} {...c} />)}</div><Charts s={s} /><MyKra refresh={refresh} /><Card><CardHeader className="pb-2"><CardTitle className="text-base">Ticket Calendar</CardTitle></CardHeader><CardContent><TicketCalendar tickets={s.calendar || []} onOpenTicket={onOpenTicket} /></CardContent></Card></div>
}

export default function Dashboard({ user, onOpenTicket, onGoTickets, onGoAcknowledgements, refresh }) {
  if (user.role === 'super_admin') return <SuperDash onOpenTicket={onOpenTicket} refresh={refresh} />
  if (user.role === 'employee') return <EmployeeDash user={user} onOpenTicket={onOpenTicket} onGoTickets={onGoTickets} onGoAcknowledgements={onGoAcknowledgements} refresh={refresh} />
  return <StaffDash user={user} onOpenTicket={onOpenTicket} refresh={refresh} />
}

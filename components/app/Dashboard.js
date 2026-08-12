'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, fmtDateTime, PRIORITY_META, statusClass } from '@/lib/appapi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import TicketCalendar from '@/components/app/TicketCalendar'
import { toast } from 'sonner'
import { Ticket, AlertTriangle, CheckCircle2, Clock, FileCheck2, Timer, Gauge, Server, Building2, Users, ClipboardCheck, XCircle, CircleAlert } from 'lucide-react'

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

function ResolutionAcknowledgements({
  tickets,
  onOpenTicket,
  onAcknowledge,
  busyId,
  confirmingId,
  onConfirmingChange,
}) {
  if (!tickets.length) return null

  return (
    <Card className="overflow-hidden border-emerald-200 bg-emerald-50/50 shadow-none">
      <CardHeader className="border-b border-emerald-200/80 bg-white/70 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-base text-emerald-950">
                Resolution awaiting your acknowledgement
              </CardTitle>
              <p className="mt-1 text-xs leading-5 text-emerald-800/80">
                Review the resolution and confirm when your issue has been fixed.
              </p>
            </div>
          </div>
          <Badge className="border border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
            {tickets.length} pending
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="max-h-[34rem] space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-4">
        {tickets.map((ticket) => {
          const confirming = confirmingId === ticket.id
          const busy = busyId === ticket.id
          return (
            <div key={ticket.id} className="rounded-lg border border-emerald-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-[11px]">
                  {ticket.human_id}
                </Badge>
                <Badge className={PRIORITY_META[ticket.priority]?.badge}>
                  {ticket.priority}
                </Badge>
                <span className="text-xs text-muted-foreground sm:ml-auto">
                  Resolved {fmtDateTime(ticket.resolved_at || ticket.resolution?.resolved_date)}
                </span>
              </div>
              <p className="mt-3 font-semibold text-[#111827]">{ticket.title}</p>
              <p className="mt-1 text-sm leading-6 text-[#4B5563]">
                {ticket.resolution?.summary || 'The service team has marked this issue as resolved.'}
              </p>

              {confirming ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs leading-5 text-amber-900">
                    Confirm only if the issue is fixed. This will permanently close the ticket.
                  </p>
                  <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onConfirmingChange(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => onAcknowledge(ticket)}
                      className="bg-emerald-700 text-white hover:bg-emerald-800"
                    >
                      {busy ? 'Closing ticket...' : 'Confirm & close'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenTicket(ticket.id)}
                  >
                    Review resolution
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => onConfirmingChange(ticket.id)}
                    className="bg-emerald-700 text-white hover:bg-emerald-800"
                  >
                    Acknowledge resolution
                  </Button>
                </div>
              )}
            </div>
          )
        })}
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
    <div className="space-y-7">
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-7">
        <DeptPanel department="IT" onOpenTicket={onOpenTicket} refresh={refresh} />
        <DeptPanel department="Admin" onOpenTicket={onOpenTicket} refresh={refresh} />
      </div>
      <DailyKra refresh={refresh} />
    </div>
  )
}

function StaffDash({ user, onOpenTicket, refresh, onRefresh }) {
  const [s, setS] = useState(null)
  const [loading, setLoading] = useState(true)
  const [resolvedTickets, setResolvedTickets] = useState([])
  const [confirmingTicketId, setConfirmingTicketId] = useState(null)
  const [acknowledgingTicketId, setAcknowledgingTicketId] = useState(null)

  const load = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true)
    try {
      const [dashboard, pendingAcknowledgements] = await Promise.all([
        api('/dashboard'),
        user.role === 'employee'
          ? api('/tickets?status=Resolved&page=1&limit=20')
          : Promise.resolve({ items: [] }),
      ])
      setS(dashboard)
      setResolvedTickets(
        (pendingAcknowledgements.items || []).filter(
          (ticket) => ticket.status === 'Resolved' && !ticket.confirmation?.confirmed,
        ),
      )
    } catch (error) {
      // Keep the last successful dashboard state during a transient refresh failure.
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [user.role])

  useEffect(() => {
    load({ showLoading: true })
    if (user.role !== 'employee') return undefined
    const timer = window.setInterval(() => load(), 30_000)
    return () => window.clearInterval(timer)
  }, [load, refresh, user.role])

  const acknowledgeResolution = async (ticket) => {
    setAcknowledgingTicketId(ticket.id)
    try {
      await api(`/tickets/${ticket.id}/confirm`, {
        method: 'POST',
        body: { action: 'confirm' },
      })
      setResolvedTickets((current) => current.filter((item) => item.id !== ticket.id))
      setConfirmingTicketId(null)
      setS((current) => current ? {
        ...current,
        resolved: Math.max(0, (current.resolved || 0) - 1),
        closed: (current.closed || 0) + 1,
      } : current)
      toast.success(`${ticket.human_id} acknowledged and closed`)
      onRefresh?.()
    } catch (error) {
      toast.error(error.message)
      await load()
    } finally {
      setAcknowledgingTicketId(null)
    }
  }

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
      {user.role === 'employee' && (
        <ResolutionAcknowledgements
          tickets={resolvedTickets}
          onOpenTicket={onOpenTicket}
          onAcknowledge={acknowledgeResolution}
          busyId={acknowledgingTicketId}
          confirmingId={confirmingTicketId}
          onConfirmingChange={setConfirmingTicketId}
        />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">{cards.map((c) => <Stat key={c.label} {...c} />)}</div>
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
              <button key={t.id} onClick={() => onOpenTicket(t.id)} className="flex w-full flex-col gap-2 rounded-md border p-2 text-left hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
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

export default function Dashboard({ user, onOpenTicket, refresh, onRefresh }) {
  if (user.role === 'super_admin') return <SuperDash onOpenTicket={onOpenTicket} refresh={refresh} />
  return <StaffDash user={user} onOpenTicket={onOpenTicket} refresh={refresh} onRefresh={onRefresh} />
}

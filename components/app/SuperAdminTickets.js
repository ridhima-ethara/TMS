'use client'

import { useEffect, useMemo, useState } from 'react'
import { api, slaRemaining } from '@/lib/appapi'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Building2, Filter, Laptop } from 'lucide-react'

const DONE = ['Resolved', 'Closed', 'Cancelled']
// Status mapping used across every KPI, column and panel in this view.
const isDone = (ticket) => DONE.includes(ticket.status)
// Board stages. Unallocated = raised but nobody has picked it up; Open =
// claimed by a member but work has not started; In progress = work started.
const isUnallocated = (ticket) => !isDone(ticket) && !ticket.assignee_id
const isOpen = (ticket) => !isDone(ticket) && Boolean(ticket.assignee_id) && ticket.status === 'Open'
const isInProgress = (ticket) => !isDone(ticket) && Boolean(ticket.assignee_id) && ticket.status !== 'Open'
const isOverdue = (ticket) => !isDone(ticket) && ticket.sla_resolution_due && new Date(ticket.sla_resolution_due) < new Date()
// An approval request is tracked in the Approvals section, not as service-desk
// ticket volume. Keeping it out of the ticket counts stops one item being
// reported twice under two different headings.
const isApprovalRequest = (ticket) => ticket.approval_required === true
const CHART_COLORS = ['#7C72DA', '#388AD9', '#20A377', '#F4A021', '#B2B0A8']
const fmtShort = (date) => new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
const initials = (name = '') => name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()
const inputDate = (date) => { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

function Kpi({ label, value, detail, tone = 'default' }) {
  const colors = { default: 'text-[#111827]', red: 'text-[#A32D2D]', green: 'text-[#087017]', blue: 'text-[#1D4ED8]', amber: 'text-[#B45309]' }
  const detailColors = { default: 'text-[#85817D]', red: 'text-[#A32D2D]', green: 'text-[#087017]', blue: 'text-[#1D4ED8]', amber: 'text-[#B45309]' }
  return <div><p className="text-base text-[#4B5563]">{label}</p><p className={`mt-1 text-3xl font-bold tabular-nums ${colors[tone]}`}>{value}</p><p className={`mt-1 text-sm ${detailColors[tone]}`}>{detail}</p></div>
}

function AgentWorkload({ tickets }) {
  const rows = useMemo(() => {
    const grouped = {}
    tickets.filter((ticket) => ticket.assignee_name).forEach((ticket) => {
      const item = grouped[ticket.assignee_name] || { name: ticket.assignee_name, total: 0, open: 0, inProgress: 0, resolved: 0, overdue: 0 }
      item.total++
      if (isDone(ticket)) item.resolved++
      else {
        if (isOpen(ticket)) item.open++
        else item.inProgress++
        if (isOverdue(ticket)) item.overdue++
      }
      grouped[ticket.assignee_name] = item
    })
    return Object.values(grouped).sort((a, b) => b.total - a.total)
  }, [tickets])
  const max = Math.max(...rows.map((row) => row.total), 1)
  return (
    <Card className="border-[#E5E9EF] p-4 shadow-none sm:p-6">
      <h3 className="mb-4 font-bold">Agent workload <span className="ml-1 text-xs font-normal text-[#8B93A1]">agents with assigned tickets matching the current filters</span></h3>
      <div className="space-y-4">{rows.map((row, index) => (
        <div key={row.name} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[44px_170px_1fr_auto]">
          <span className={`grid h-10 w-10 place-items-center rounded-full text-sm font-semibold ${index % 2 ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>{initials(row.name)}</span>
          <span className="font-medium">{row.name}</span>
          <div className="col-span-2 col-start-2 h-3 overflow-hidden rounded-full bg-[#F4F6F8] sm:col-auto"><div className={index % 2 ? 'h-full bg-[#20A377]' : 'h-full bg-[#388AD9]'} style={{ width: `${(row.total / max) * 100}%` }} /></div>
          <span className="col-start-3 row-start-1 whitespace-nowrap text-xs text-[#4B5563] sm:col-auto sm:row-auto sm:text-sm">{row.total} total · {row.open} open · {row.inProgress} in progress · {row.resolved} done{row.overdue ? ` · ${row.overdue} overdue` : ''}</span>
        </div>
      ))}{rows.length === 0 && <p className="text-sm text-[#8B93A1]">No assigned tickets match the current filters.</p>}</div>
    </Card>
  )
}

function TicketCard({ ticket, onOpenTicket }) {
  const sla = slaRemaining(ticket.sla_resolution_due)
  const done = isDone(ticket)
  return (
    <button onClick={() => onOpenTicket(ticket.id)} className={`w-full rounded-xl border bg-white p-4 text-left transition hover:shadow-md ${sla.breach && !done ? 'border-red-300' : 'border-[#E5E9EF]'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-xs text-[#85817D]">{ticket.human_id}</p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ticket.priority === 'Critical' ? 'bg-red-800 text-white' : ticket.priority === 'High' ? 'bg-orange-100 text-orange-800' : ticket.priority === 'Medium' ? 'bg-yellow-100 text-yellow-800' : 'bg-emerald-100 text-emerald-800'}`}>{ticket.priority}</span>
      </div>
      <p className="mt-1 truncate font-semibold">{ticket.title}</p>
      <p className="mt-0.5 truncate text-xs text-[#4B5563]">{ticket.assignee_name || 'Unassigned'} · raised {fmtShort(ticket.created_at)}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 ${done ? 'bg-green-100 text-green-800' : sla.breach ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{done ? `✓ Closed ${fmtShort(ticket.updated_at)}` : sla.text}</span>
        <span className="text-[#85817D]">{ticket.status}</span>
      </div>
    </button>
  )
}

function DepartmentPanel({ department, tickets, onOpenTicket }) {
  const isIt = department === 'IT'
  const unallocated = tickets.filter(isUnallocated)
  const open = tickets.filter(isOpen)
  const inProgress = tickets.filter(isInProgress)
  const overdue = tickets.filter(isOverdue)
  const resolved = tickets.filter(isDone)
  const active = [...unallocated, ...open, ...inProgress]
  const Icon = isIt ? Laptop : Building2
  return (
    <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#E5E9EF] px-4 py-4 sm:px-5"><Icon className={`h-5 w-5 ${isIt ? 'text-blue-600' : 'text-indigo-600'}`} /><h3 className="text-lg font-bold">{department} department</h3><span className="w-full text-sm text-[#4B5563] sm:ml-auto sm:w-auto">{unallocated.length} unallocated · {open.length} open · {inProgress.length} in progress · <b className="text-red-700">{overdue.length} overdue</b></span></div>
      <div className="grid grid-cols-5 border-b border-[#E5E9EF] text-center">{[['Unallocated', unallocated.length], ['Open', open.length], ['In progress', inProgress.length], ['Overdue', overdue.length], ['Closed', resolved.length]].map(([label, value], index) => <div key={label} className={`py-4 ${index < 4 ? 'border-r border-[#E5E9EF]' : ''}`}><p className={`text-2xl font-bold ${label === 'Overdue' ? 'text-red-700' : label === 'Closed' ? 'text-green-700' : label === 'In progress' ? 'text-blue-700' : ''}`}>{value}</p><p className="text-sm text-[#85817D]">{label}</p></div>)}</div>
      <div>{active.slice(0, 3).map((ticket) => <button key={ticket.id} onClick={() => onOpenTicket(ticket.id)} className="block w-full border-b border-[#E5E9EF] px-5 py-4 text-left last:border-0 hover:bg-[#FAFBFC]"><p className="font-semibold">{ticket.title}</p><p className="mt-1 text-sm text-[#4B5563]">{ticket.priority} · {ticket.status} · {ticket.assignee_name || 'Unassigned'} · <span className={slaRemaining(ticket.sla_resolution_due).breach ? 'text-red-700' : ''}>{slaRemaining(ticket.sla_resolution_due).text}</span></p></button>)}</div>
    </Card>
  )
}

export default function SuperAdminTickets({ onOpenTicket }) {
  const [tickets, setTickets] = useState(null)
  const [status, setStatus] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [period, setPeriod] = useState('week')
  const [category, setCategory] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  useEffect(() => {
    const load = () => api('/tickets?limit=1000').then((result) => setTickets(result.items)).catch(() => {})
    load()
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [])

  const periodTickets = useMemo(() => {
    if (!tickets) return []
    // Explicit date range takes precedence over the rolling period.
    if (fromDate || toDate) {
      const start = fromDate ? new Date(`${fromDate}T00:00:00`) : new Date(0)
      const end = toDate ? new Date(`${toDate}T23:59:59.999`) : new Date(8640000000000000)
      return tickets.filter((ticket) => { const created = new Date(ticket.created_at); return created >= start && created <= end })
    }
    if (period === 'all') return tickets
    const start = new Date(); start.setHours(0, 0, 0, 0)
    if (period === 'week') start.setDate(start.getDate() - start.getDay())
    if (period === '30') start.setDate(start.getDate() - 29)
    if (period === '90') start.setDate(start.getDate() - 89)
    return tickets.filter((ticket) => new Date(ticket.created_at) >= start)
  }, [tickets, period, fromDate, toDate])

  // Status filter groups match the board columns: "In Progress" covers every
  // active status after Open (Assigned, Acknowledged, Pending…), not just the
  // literal "In Progress" status, so filtering never hides board tickets.
  const filtered = useMemo(() => {
    if (!tickets) return []
    const matchesStatus = (ticket) => {
      if (status === 'all') return true
      if (status === 'Unallocated') return isUnallocated(ticket)
      if (status === 'Open') return isOpen(ticket)
      if (status === 'In Progress') return isInProgress(ticket)
      return ticket.status === status
    }
    return periodTickets.filter((ticket) => !isApprovalRequest(ticket) && matchesStatus(ticket) && (category === 'all' || ticket.category === category) && (!overdueOnly || isOverdue(ticket)))
  }, [tickets, periodTickets, status, category, overdueOnly])

  // Approval requests for the same period, reported on their own.
  const periodApprovals = useMemo(() => periodTickets.filter(isApprovalRequest), [periodTickets])

  const stats = useMemo(() => {
    if (!tickets) return null
    const open = filtered.filter(isOpen)
    const inProgress = filtered.filter(isInProgress)
    const overdue = filtered.filter(isOverdue)
    const resolved = filtered.filter(isDone)
    const response = filtered.filter((ticket) => (ticket.acknowledged_at || ticket.first_response_at) && ticket.created_at).map((ticket) => (new Date(ticket.acknowledged_at || ticket.first_response_at) - new Date(ticket.created_at)) / 3600000)
    const inProgressBreakdown = Object.entries(inProgress.reduce((map, ticket) => { map[ticket.status] = (map[ticket.status] || 0) + 1; return map }, {})).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${count}`).join(' · ')
    return { open, inProgress, inProgressBreakdown, overdue, resolved, avgResponse: response.length ? (response.reduce((a, b) => a + b, 0) / response.length).toFixed(1) : 0 }
  }, [tickets, filtered])

  // Trend follows the selected period / date range so past data is visible.
  const trend = useMemo(() => {
    if (!tickets) return []
    const today = new Date(); today.setHours(0, 0, 0, 0)
    let end = toDate ? new Date(`${toDate}T00:00:00`) : today
    if (end > today) end = today
    let start
    if (fromDate) start = new Date(`${fromDate}T00:00:00`)
    else if (toDate) { start = new Date(end); start.setDate(start.getDate() - 13) }
    else if (period === 'week') { start = new Date(today); start.setDate(start.getDate() - today.getDay()) }
    else if (period === '30') { start = new Date(today); start.setDate(start.getDate() - 29) }
    else if (period === '90') { start = new Date(today); start.setDate(start.getDate() - 89) }
    else {
      const firsts = filtered.map((ticket) => new Date(ticket.created_at).getTime())
      start = firsts.length ? new Date(Math.min(...firsts)) : new Date(today)
      start.setHours(0, 0, 0, 0)
    }
    let days = Math.round((end - start) / 86400000) + 1
    if (days < 1) days = 1
    if (days > 120) { days = 120; start = new Date(end); start.setDate(start.getDate() - 119) }
    return Array.from({ length: days }, (_, index) => {
      const day = new Date(start); day.setDate(day.getDate() + index)
      const next = new Date(day); next.setDate(next.getDate() + 1)
      const resolvedAt = (ticket) => ticket.resolved_at || ticket.resolution?.resolved_date
      return {
        day: fmtShort(day),
        Raised: filtered.filter((ticket) => new Date(ticket.created_at) >= day && new Date(ticket.created_at) < next).length,
        Resolved: filtered.filter((ticket) => resolvedAt(ticket) && new Date(resolvedAt(ticket)) >= day && new Date(resolvedAt(ticket)) < next).length,
      }
    })
  }, [tickets, filtered, period, fromDate, toDate])

  const categories = useMemo(() => {
    if (!tickets) return []
    const grouped = {}; filtered.forEach((ticket) => { grouped[ticket.category || 'Other'] = (grouped[ticket.category || 'Other'] || 0) + 1 })
    return Object.entries(grouped).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5)
  }, [tickets, filtered])

  const categoryOptions = useMemo(() => tickets ? [...new Set(tickets.map((ticket) => ticket.category).filter(Boolean))].sort() : [], [tickets])

  if (!tickets || !stats) return <Skeleton className="h-[620px] w-full rounded-xl" />
  const columns = [
    { title: 'Unallocated', rows: filtered.filter(isUnallocated) },
    { title: 'Open', rows: filtered.filter(isOpen) },
    { title: 'In progress', rows: filtered.filter(isInProgress) },
    { title: 'Closed', rows: filtered.filter(isDone) },
  ]
  const todayInput = inputDate(new Date())

  return (
    <div className="space-y-5 text-[#111827]">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E5E9EF] bg-[#FAFBFC] px-4 py-3"><Filter className="h-5 w-5 text-[#4B5563]" /><span className="font-semibold text-[#4B5563]">Filters (apply to everything below):</span><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full bg-white sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="Unallocated">Unallocated</SelectItem><SelectItem value="Open">Open</SelectItem><SelectItem value="In Progress">In progress</SelectItem><SelectItem value="Closed">Closed</SelectItem><SelectItem value="Cancelled">Cancelled</SelectItem></SelectContent></Select><Select value={category} onValueChange={setCategory}><SelectTrigger className="w-full bg-white sm:w-48"><SelectValue placeholder="Category" /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categoryOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><button onClick={() => setOverdueOnly((value) => !value)} className={`w-full rounded-full border px-4 py-2 text-sm sm:w-auto ${overdueOnly ? 'border-red-200 bg-red-100 text-red-800' : 'bg-white text-[#4B5563]'}`}>Overdue only {overdueOnly ? '×' : ''}</button><label className="flex items-center gap-1 text-sm text-[#4B5563]">From<input type="date" value={fromDate} max={toDate || todayInput} onChange={(event) => setFromDate(event.target.value)} className="h-9 rounded-lg border border-[#DDE2EA] bg-white px-2 text-sm" /></label><label className="flex items-center gap-1 text-sm text-[#4B5563]">To<input type="date" value={toDate} min={fromDate || undefined} max={todayInput} onChange={(event) => setToDate(event.target.value)} className="h-9 rounded-lg border border-[#DDE2EA] bg-white px-2 text-sm" /></label>{(fromDate || toDate) && <button onClick={() => { setFromDate(''); setToDate('') }} className="rounded-full border px-3 py-2 text-sm text-[#4B5563]">Clear dates ×</button>}<Select value={period} onValueChange={setPeriod} disabled={Boolean(fromDate || toDate)}><SelectTrigger className="w-full rounded-full bg-white sm:w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="week">This week</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="all">All time</SelectItem></SelectContent></Select></div>

      <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-6">
        <Kpi label="Open" value={stats.open.length} detail="not yet picked up" tone="amber" />
        <Kpi label="In progress" value={stats.inProgress.length} detail={stats.inProgressBreakdown || 'active work after pickup'} tone="blue" />
        <Kpi label="SLA breached" value={stats.overdue.length} detail="active tickets past resolution SLA" tone="red" />
        <Kpi label="Closed" value={stats.resolved.length} detail="completed in selected period" tone="green" />
        <Kpi label="Avg first response" value={`${stats.avgResponse}h`} detail="measured on first response" tone="green" />
        <Kpi label="Approvals" value={periodApprovals.length} detail="counted separately — see Approvals" tone="default" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <Card className="border-[#E5E9EF] p-4 shadow-none sm:p-6"><h3 className="mb-3 font-bold">Tickets raised vs resolved <span className="ml-1 text-xs font-normal text-[#8B93A1]">selected period · approval requests excluded</span></h3><div className="h-60"><ResponsiveContainer width="100%" height="100%"><LineChart data={trend}><CartesianGrid stroke="#E5E9EF" /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Line type="monotone" dataKey="Raised" stroke="#388AD9" strokeWidth={2.5} dot={false} /><Line type="monotone" dataKey="Resolved" stroke="#20A377" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer></div></Card>
        <Card className="border-[#E5E9EF] p-4 shadow-none sm:p-6"><h3 className="mb-3 font-bold">By category</h3><div className="h-60"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categories} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90}>{categories.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip /><Legend layout="vertical" align="right" verticalAlign="middle" /></PieChart></ResponsiveContainer></div></Card>
      </div>

      <AgentWorkload tickets={filtered} />

      <div className="grid gap-6 lg:grid-cols-3">{columns.map((column) => <div key={column.title}><h3 className="mb-3 text-base font-semibold text-[#4B5563]">{column.title} <span className="ml-1 rounded-full border px-2 py-0.5 text-xs">{column.rows.length}</span></h3><div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">{column.rows.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} onOpenTicket={onOpenTicket} />)}</div></div>)}</div>

      <div className="grid gap-5 xl:grid-cols-2"><DepartmentPanel department="IT" tickets={filtered.filter((ticket) => ticket.department === 'IT')} onOpenTicket={onOpenTicket} /><DepartmentPanel department="Admin" tickets={filtered.filter((ticket) => ticket.department === 'Admin')} onOpenTicket={onOpenTicket} /></div>
    </div>
  )
}

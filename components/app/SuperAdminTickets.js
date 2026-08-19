'use client'

import { useEffect, useMemo, useState } from 'react'
import { api, slaRemaining } from '@/lib/appapi'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Building2, Filter, Laptop } from 'lucide-react'

const DONE = ['Resolved', 'Closed', 'Cancelled']
const CHART_COLORS = ['#7C72DA', '#388AD9', '#20A377', '#F4A021', '#B2B0A8']
const fmtShort = (date) => new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
const initials = (name = '') => name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()

function Kpi({ label, value, detail, tone = 'default' }) {
  const colors = { default: 'text-[#111827]', red: 'text-[#A32D2D]', green: 'text-[#087017]' }
  return <div><p className="text-base text-[#4B5563]">{label}</p><p className={`mt-1 text-3xl font-bold tabular-nums ${colors[tone]}`}>{value}</p><p className={`mt-1 text-sm ${tone === 'red' ? 'text-[#A32D2D]' : tone === 'green' ? 'text-[#087017]' : 'text-[#85817D]'}`}>{detail}</p></div>
}

function AgentWorkload({ tickets }) {
  const rows = useMemo(() => {
    const grouped = {}
    tickets.filter((ticket) => ticket.assignee_name).forEach((ticket) => {
      const item = grouped[ticket.assignee_name] || { name: ticket.assignee_name, total: 0, open: 0, resolved: 0, overdue: 0 }
      item.total++
      if (DONE.includes(ticket.status)) item.resolved++
      else {
        item.open++
        if (ticket.sla_resolution_due && new Date(ticket.sla_resolution_due) < new Date()) item.overdue++
      }
      grouped[ticket.assignee_name] = item
    })
    return Object.values(grouped).sort((a, b) => b.total - a.total)
  }, [tickets])
  const max = Math.max(...rows.map((row) => row.total), 1)
  return (
    <Card className="border-[#E5E9EF] p-4 shadow-none sm:p-6">
      <h3 className="mb-4 font-bold">Agent workload <span className="ml-1 text-xs font-normal text-[#8B93A1]">every agent with assigned tickets in the selected period</span></h3>
      <div className="space-y-4">{rows.map((row, index) => (
        <div key={row.name} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[44px_170px_1fr_auto]">
          <span className={`grid h-10 w-10 place-items-center rounded-full text-sm font-semibold ${index % 2 ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>{initials(row.name)}</span>
          <span className="font-medium">{row.name}</span>
          <div className="col-span-2 col-start-2 h-3 overflow-hidden rounded-full bg-[#F4F6F8] sm:col-auto"><div className={index % 2 ? 'h-full bg-[#20A377]' : 'h-full bg-[#388AD9]'} style={{ width: `${(row.total / max) * 100}%` }} /></div>
          <span className="col-start-3 row-start-1 whitespace-nowrap text-xs text-[#4B5563] sm:col-auto sm:row-auto sm:text-sm">{row.total} total · {row.open} open · {row.resolved} done{row.overdue ? ` · ${row.overdue} overdue` : ''}</span>
        </div>
      ))}{rows.length === 0 && <p className="text-sm text-[#8B93A1]">No assigned tickets in the selected period.</p>}</div>
    </Card>
  )
}

function TicketCard({ ticket, onOpenTicket }) {
  const sla = slaRemaining(ticket.sla_resolution_due)
  const done = DONE.includes(ticket.status)
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
  const open = tickets.filter((ticket) => !DONE.includes(ticket.status))
  const overdue = open.filter((ticket) => ticket.sla_resolution_due && new Date(ticket.sla_resolution_due) < new Date())
  const resolved = tickets.filter((ticket) => DONE.includes(ticket.status))
  const Icon = isIt ? Laptop : Building2
  return (
    <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#E5E9EF] px-4 py-4 sm:px-5"><Icon className={`h-5 w-5 ${isIt ? 'text-blue-600' : 'text-indigo-600'}`} /><h3 className="text-lg font-bold">{department} department</h3><span className="w-full text-sm text-[#4B5563] sm:ml-auto sm:w-auto">{open.length} open · <b className="text-red-700">{overdue.length} overdue</b></span></div>
      <div className="grid grid-cols-3 border-b border-[#E5E9EF] text-center">{[['Open', open.length], ['Overdue', overdue.length], ['Resolved', resolved.length]].map(([label, value], index) => <div key={label} className={`py-4 ${index < 2 ? 'border-r border-[#E5E9EF]' : ''}`}><p className={`text-2xl font-bold ${label === 'Overdue' ? 'text-red-700' : label === 'Resolved' ? 'text-green-700' : ''}`}>{value}</p><p className="text-sm text-[#85817D]">{label}</p></div>)}</div>
      <div>{open.slice(0, 3).map((ticket) => <button key={ticket.id} onClick={() => onOpenTicket(ticket.id)} className="block w-full border-b border-[#E5E9EF] px-5 py-4 text-left last:border-0 hover:bg-[#FAFBFC]"><p className="font-semibold">{ticket.title}</p><p className="mt-1 text-sm text-[#4B5563]">{ticket.priority} · {ticket.assignee_name || 'Unassigned'} · <span className={slaRemaining(ticket.sla_resolution_due).breach ? 'text-red-700' : ''}>{slaRemaining(ticket.sla_resolution_due).text}</span></p></button>)}</div>
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
    const load = () => api('/tickets?limit=200').then((result) => setTickets(result.items)).catch(() => {})
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

  const stats = useMemo(() => {
    if (!tickets) return null
    const active = periodTickets.filter((ticket) => !DONE.includes(ticket.status))
    const overdue = active.filter((ticket) => ticket.sla_resolution_due && new Date(ticket.sla_resolution_due) < new Date())
    const resolved = periodTickets.filter((ticket) => DONE.includes(ticket.status))
    const response = periodTickets.filter((ticket) => ticket.first_response_at && ticket.created_at).map((ticket) => (new Date(ticket.first_response_at) - new Date(ticket.created_at)) / 3600000)
    return { active, overdue, resolved, avgResponse: response.length ? (response.reduce((a, b) => a + b, 0) / response.length).toFixed(1) : 0 }
  }, [tickets, periodTickets])

  const trend = useMemo(() => {
    if (!tickets) return []
    return Array.from({ length: 14 }, (_, index) => {
      const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (13 - index))
      const next = new Date(day); next.setDate(next.getDate() + 1)
      return { day: day.getDate(), Raised: periodTickets.filter((ticket) => new Date(ticket.created_at) >= day && new Date(ticket.created_at) < next).length, Resolved: periodTickets.filter((ticket) => ticket.resolution?.resolved_date && new Date(ticket.resolution.resolved_date) >= day && new Date(ticket.resolution.resolved_date) < next).length }
    })
  }, [tickets, periodTickets])

  const categories = useMemo(() => {
    if (!tickets) return []
    const grouped = {}; periodTickets.forEach((ticket) => { grouped[ticket.category || 'Other'] = (grouped[ticket.category || 'Other'] || 0) + 1 })
    return Object.entries(grouped).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5)
  }, [tickets, periodTickets])

  const categoryOptions = useMemo(() => tickets ? [...new Set(tickets.map((ticket) => ticket.category).filter(Boolean))].sort() : [], [tickets])

  const filtered = useMemo(() => {
    if (!tickets) return []
    return periodTickets.filter((ticket) => (status === 'all' || ticket.status === status) && (category === 'all' || ticket.category === category) && (!overdueOnly || (!DONE.includes(ticket.status) && new Date(ticket.sla_resolution_due) < new Date())))
  }, [tickets, periodTickets, status, category, overdueOnly])

  if (!tickets || !stats) return <Skeleton className="h-[620px] w-full rounded-xl" />
  const columns = [
    { title: 'Open', rows: filtered.filter((ticket) => ticket.status === 'Open') },
    { title: 'In progress', rows: filtered.filter((ticket) => !DONE.includes(ticket.status) && ticket.status !== 'Open') },
    { title: 'Resolved / Closed', rows: filtered.filter((ticket) => DONE.includes(ticket.status)) },
  ]

  return (
    <div className="space-y-5 text-[#111827]">
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
        <Kpi label="Open tickets" value={stats.active.length} detail="active in selected period" tone="red" />
        <Kpi label="SLA breached" value={stats.overdue.length} detail="active tickets past resolution SLA" tone="red" />
        <Kpi label="Resolved / Closed" value={stats.resolved.length} detail="completed in selected period" tone="green" />
        <Kpi label="Avg first response" value={`${stats.avgResponse}h`} detail="measured on first response" tone="green" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <Card className="border-[#E5E9EF] p-4 shadow-none sm:p-6"><h3 className="mb-3 font-bold">Tickets raised vs resolved (14 days)</h3><div className="h-60"><ResponsiveContainer width="100%" height="100%"><LineChart data={trend}><CartesianGrid stroke="#E5E9EF" /><XAxis dataKey="day" /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Line type="monotone" dataKey="Raised" stroke="#388AD9" strokeWidth={2.5} dot={false} /><Line type="monotone" dataKey="Resolved" stroke="#20A377" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer></div></Card>
        <Card className="border-[#E5E9EF] p-4 shadow-none sm:p-6"><h3 className="mb-3 font-bold">By category</h3><div className="h-60"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categories} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90}>{categories.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip /><Legend layout="vertical" align="right" verticalAlign="middle" /></PieChart></ResponsiveContainer></div></Card>
      </div>

      <AgentWorkload tickets={periodTickets} />

      <div className="grid gap-6 lg:grid-cols-3">{columns.map((column) => <div key={column.title}><h3 className="mb-3 text-base font-semibold text-[#4B5563]">{column.title} <span className="ml-1 rounded-full border px-2 py-0.5 text-xs">{column.rows.length}</span></h3><div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">{column.rows.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} onOpenTicket={onOpenTicket} />)}</div></div>)}</div>

      <div className="flex flex-wrap items-center gap-3 py-2"><Filter className="h-5 w-5 text-[#4B5563]" /><span className="font-semibold text-[#4B5563]">Shared filters:</span><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full bg-white sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="Open">Open</SelectItem><SelectItem value="In Progress">In progress</SelectItem><SelectItem value="Resolved">Resolved</SelectItem><SelectItem value="Closed">Closed</SelectItem></SelectContent></Select><Select value={category} onValueChange={setCategory}><SelectTrigger className="w-full bg-white sm:w-48"><SelectValue placeholder="Category" /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categoryOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><button onClick={() => setOverdueOnly((value) => !value)} className={`w-full rounded-full border px-4 py-2 text-sm sm:w-auto ${overdueOnly ? 'border-red-200 bg-red-100 text-red-800' : 'bg-white text-[#4B5563]'}`}>Overdue only {overdueOnly ? '×' : ''}</button><label className="flex items-center gap-1 text-sm text-[#4B5563]">From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="h-9 rounded-lg border border-[#DDE2EA] bg-white px-2 text-sm" /></label><label className="flex items-center gap-1 text-sm text-[#4B5563]">To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="h-9 rounded-lg border border-[#DDE2EA] bg-white px-2 text-sm" /></label>{(fromDate || toDate) && <button onClick={() => { setFromDate(''); setToDate('') }} className="rounded-full border px-3 py-2 text-sm text-[#4B5563]">Clear dates ×</button>}<Select value={period} onValueChange={setPeriod}><SelectTrigger className="w-full rounded-full bg-white sm:w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="week">This week</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="all">All time</SelectItem></SelectContent></Select></div>

      <div className="grid gap-5 xl:grid-cols-2"><DepartmentPanel department="IT" tickets={filtered.filter((ticket) => ticket.department === 'IT')} onOpenTicket={onOpenTicket} /><DepartmentPanel department="Admin" tickets={filtered.filter((ticket) => ticket.department === 'Admin')} onOpenTicket={onOpenTicket} /></div>
    </div>
  )
}

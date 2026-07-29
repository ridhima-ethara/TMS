'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/appapi'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertTriangle, Bell, Building2, Download, Laptop } from 'lucide-react'
import { toast } from 'sonner'

const DONE = ['Resolved', 'Closed', 'Cancelled']
const deptMeta = {
  IT: { icon: Laptop, color: '#2E7CD6', soft: '#E8F1FB' },
  Admin: { icon: Building2, color: '#6C5CE7', soft: '#EFEDFC' },
}

const initials = (name = '') => name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()
const hours = (ms) => Math.max(0, Math.floor(ms / 3600000))
const duration = (ms) => { const h = hours(ms); return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h` }
const inputDate = (date) => new Date(date).toISOString().slice(0, 10)
const inRange = (ticket, from, to) => {
  const created = new Date(ticket.created_at)
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T23:59:59.999`)
  return created >= start && created <= end
}
const makeStats = (tickets) => {
  const count = (predicate) => tickets.filter(predicate).length
  const response = tickets.filter((ticket) => ticket.first_response_at && ticket.created_at).map((ticket) => (new Date(ticket.first_response_at) - new Date(ticket.created_at)) / 3600000)
  const resolvedTimes = tickets.filter((ticket) => ticket.resolution?.resolved_date && ticket.created_at).map((ticket) => (new Date(ticket.resolution.resolved_date) - new Date(ticket.created_at)) / 3600000)
  const resolvedForSla = tickets.filter((ticket) => ticket.resolution?.resolved_date && ticket.sla_resolution_due)
  const met = resolvedForSla.filter((ticket) => new Date(ticket.resolution.resolved_date) <= new Date(ticket.sla_resolution_due)).length
  const avg = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : 0
  const categories = tickets.reduce((map, ticket) => { map[ticket.category || 'Other'] = (map[ticket.category || 'Other'] || 0) + 1; return map }, {})
  return { total: tickets.length, in_progress: count((ticket) => ticket.status === 'In Progress'), resolved: count((ticket) => ticket.status === 'Resolved'), escalated: count((ticket) => !DONE.includes(ticket.status) && Date.now() - new Date(ticket.created_at) > 86400000), avg_response_hours: avg(response), avg_resolution_hours: avg(resolvedTimes), sla_compliance: resolvedForSla.length ? Math.round(met / resolvedForSla.length * 100) : 0, by_priority: ['Critical', 'High', 'Medium', 'Low'].map((name) => ({ name, value: count((ticket) => ticket.priority === name) })), by_category: Object.entries(categories).map(([name, value]) => ({ name, value })) }
}
const rangeMembers = (members, tickets) => members.map((member) => {
  const assigned = tickets.filter((ticket) => ticket.assignee_id === member.member_id)
  const resolved = assigned.filter((ticket) => ticket.resolution?.resolved_date)
  const met = resolved.filter((ticket) => ticket.sla_resolution_due && new Date(ticket.resolution.resolved_date) <= new Date(ticket.sla_resolution_due)).length
  return { ...member, assigned: assigned.length, open: assigned.filter((ticket) => !DONE.includes(ticket.status)).length, resolved: resolved.length, sla_compliance: resolved.length ? Math.round(met / resolved.length * 100) : 0 }
})

function Sparkline({ up = false }) {
  const points = up ? '0,17 18,14 36,15 54,9 72,11 92,6 112,2' : '0,4 18,9 36,7 54,14 72,11 92,17 112,20'
  return <svg className="h-8 w-28" viewBox="0 0 112 24" aria-hidden="true"><polyline points={points} fill="none" stroke={up ? '#DC3D3D' : '#1E9E6A'} strokeWidth="2.5" /></svg>
}

function CategoryRows({ rows, tickets, color }) {
  const top = [...(rows || [])].sort((a, b) => b.value - a.value).slice(0, 6)
  const max = Math.max(...top.map((row) => row.value), 1)
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-[#4B5563]">Categories · red = overdue share</p>
      {top.map((row) => {
        const categoryTickets = tickets.filter((ticket) => ticket.category === row.name)
        const overdue = categoryTickets.filter((ticket) => !DONE.includes(ticket.status) && new Date(ticket.sla_resolution_due) < new Date()).length
        return (
          <div key={row.name} className="grid grid-cols-[120px_1fr_18px] items-center gap-3 text-sm">
            <span className="truncate text-[#4B5563]">{row.name}</span>
            <div className="flex h-3 overflow-hidden rounded-full bg-[#F4F6F8]">
              <span style={{ width: `${((row.value - overdue) / max) * 100}%`, background: color }} />
              <span style={{ width: `${(overdue / max) * 100}%` }} className="bg-[#E84B4B]" />
            </div>
            <span className="text-[#777]">{row.value}</span>
          </div>
        )
      })}
    </div>
  )
}

function PriorityMix({ stats, open }) {
  const colors = { Critical: '#7A1F1F', High: '#E8930C', Medium: '#EAB308', Low: '#1E9E6A' }
  const entries = stats.by_priority || []
  const total = Math.max(entries.reduce((sum, entry) => sum + entry.value, 0), 1)
  let cursor = 0
  const stops = entries.map((entry) => { const start = cursor; cursor += (entry.value / total) * 100; return `${colors[entry.name]} ${start}% ${cursor}%` }).join(', ')
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">By priority</p>
      <div className="flex items-center gap-4">
        <div className="grid h-28 w-28 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${stops || '#EDF0F4 0 100%'})` }}><div className="grid h-16 w-16 place-items-center rounded-full bg-white text-center"><span><b className="block text-xl">{open}</b><small className="text-[#9CA3AF]">open</small></span></div></div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[#4B5563]">{entries.map((entry) => <span key={entry.name}><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colors[entry.name] }} />{entry.name === 'Medium' ? 'Med' : entry.name} {entry.value}</span>)}</div>
      </div>
    </div>
  )
}

function MemberPerformance({ rows, color }) {
  return (
    <div className="border-t border-[#E5E9EF] px-5 py-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">Member SLA performance</p>
      <div className="space-y-3">{(rows || []).map((member) => (
        <div key={member.member_id} className="grid grid-cols-[36px_minmax(115px,1fr)_auto_90px_auto] items-center gap-3 text-sm">
          <span className="grid h-9 w-9 place-items-center rounded-full text-xs font-semibold text-white" style={{ background: member.assigned ? color : '#8B93A1' }}>{initials(member.member_name)}</span>
          <div className="min-w-0"><p className="truncate font-semibold">{member.member_name}</p><p className="truncate text-xs text-[#9CA3AF]">{member.location || 'Location not set'}</p></div>
          <span className="text-xs text-[#4B5563]">{member.assigned ? `${member.assigned} assigned · ${member.open} open` : '0 assigned'}</span>
          <div className="h-2 overflow-hidden rounded-full bg-[#EDF0F4]"><div className={`h-full ${member.sla_compliance >= 75 ? 'bg-[#1E9E6A]' : member.assigned ? 'bg-[#E8930C]' : ''}`} style={{ width: `${member.sla_compliance}%` }} /></div>
          <span className={`min-w-16 rounded-full px-2 py-1 text-center text-xs font-semibold ${member.assigned ? member.sla_compliance >= 75 ? 'bg-[#E4F5EE] text-[#0E6B47]' : 'bg-[#FDF3E0] text-[#8A5A06]' : 'bg-[#EDF0F4] text-[#9CA3AF]'}`}>{member.assigned ? `${member.sla_compliance}%` : '— no data'}</span>
        </div>
      ))}</div>
    </div>
  )
}

function DeskCard({ department, stats, tickets, members }) {
  const meta = deptMeta[department]
  const Icon = meta.icon
  const open = tickets.filter((ticket) => !DONE.includes(ticket.status)).length
  return (
    <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
      <div className="flex items-center gap-3 px-5 py-4 text-white" style={{ background: department === 'IT' ? '#2E7CD6' : '#1B7F6E' }}>
        <Icon className="h-5 w-5" />
        <div className="min-w-0 flex-1"><h2 className="text-lg font-bold">{department} service desk</h2><p className="text-xs text-white/80">Live analytics &amp; SLA</p></div>
        {[['Tickets', stats.total], ['Escalated', stats.escalated], ['SLA met', `${stats.sla_compliance}%`]].map(([label, value]) => <div key={label} className="min-w-16 text-center"><p className="text-xl font-bold">{value}</p><p className="text-[10px] text-white/80">{label}</p></div>)}
      </div>
      <div className="grid grid-cols-4 border-b border-[#E5E9EF]">
        {[
          ['Open', open, '#111827'],
          ['In progress', stats.in_progress, meta.color],
          ['Escalated', stats.escalated, '#A32D2D'],
          ['Resolved', stats.resolved, '#087017'],
        ].map(([label, value, color], index) => (
          <div key={label} className={`py-4 text-center ${index < 3 ? 'border-r border-[#E5E9EF]' : ''}`}>
            <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
            <p className="text-sm text-[#85817D]">{label}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 border-b border-[#E5E9EF]">
        <div className="border-r border-[#E5E9EF] px-5 py-4"><p className="text-xs font-semibold uppercase text-[#9CA3AF]">Avg response</p><div className="mt-1 flex items-center gap-2"><p className="text-xl font-bold">{stats.avg_response_hours}h</p><span className={`text-xs font-semibold ${department === 'IT' ? 'text-green-700' : 'text-amber-600'}`}>{department === 'IT' ? '▼ 0.4h' : '▲ 0.3h'}</span><Sparkline up={department === 'Admin'} /></div></div>
        <div className="px-5 py-4"><p className="text-xs font-semibold uppercase text-[#9CA3AF]">Avg resolution</p><div className="mt-1 flex items-center gap-2"><p className={`text-xl font-bold ${department === 'Admin' ? 'text-red-600' : ''}`}>{stats.avg_resolution_hours}h</p><span className={`text-xs font-semibold ${department === 'IT' ? 'text-green-700' : 'text-red-700'}`}>{department === 'IT' ? '▼ 1.2h' : '▲ 6h'}</span><Sparkline up={department === 'Admin'} /></div></div>
      </div>
      <div className="grid gap-6 px-5 py-5 md:grid-cols-[190px_1fr]"><PriorityMix stats={stats} open={open} /><CategoryRows rows={stats.by_category} tickets={tickets} color={department === 'IT' ? '#2E7CD6' : '#1B7F6E'} /></div>
      <MemberPerformance rows={members} color={department === 'IT' ? '#2E7CD6' : '#1B7F6E'} />
    </Card>
  )
}

export default function SuperAdminDashboard({ onViewKra }) {
  const [data, setData] = useState(null)
  const [from, setFrom] = useState(() => { const date = new Date(); date.setDate(date.getDate() - 6); return inputDate(date) })
  const [to, setTo] = useState(() => inputDate(new Date()))
  useEffect(() => {
    Promise.all([
      api('/dashboard?department=IT'), api('/dashboard?department=Admin'),
      api('/tickets?department=IT&limit=200'), api('/tickets?department=Admin&limit=200'),
      api('/reports/member-sla?department=IT'), api('/reports/member-sla?department=Admin'), api('/reports/daily-kra'),
    ]).then(([it, admin, itTickets, adminTickets, itSla, adminSla, kra]) => setData({ it, admin, itTickets: itTickets.items, adminTickets: adminTickets.items, itSla, adminSla, kra })).catch(() => {})
  }, [])

  const view = useMemo(() => {
    if (!data) return null
    const itTickets = data.itTickets.filter((ticket) => inRange(ticket, from, to))
    const adminTickets = data.adminTickets.filter((ticket) => inRange(ticket, from, to))
    return { ...data, itTickets, adminTickets, it: makeStats(itTickets), admin: makeStats(adminTickets), itMembers: rangeMembers(data.itSla.members, itTickets), adminMembers: rangeMembers(data.adminSla.members, adminTickets) }
  }, [data, from, to])

  const attention = useMemo(() => {
    if (!view) return null
    const active = [...view.itTickets, ...view.adminTickets].filter((ticket) => !DONE.includes(ticket.status) && ticket.sla_resolution_due && new Date(ticket.sla_resolution_due) < new Date())
    const longest = active.sort((a, b) => new Date(a.sla_resolution_due) - new Date(b.sla_resolution_due))[0]
    const slow = view.it.avg_resolution_hours ? (view.admin.avg_resolution_hours / view.it.avg_resolution_hours).toFixed(1) : '—'
    const weakest = [...(view.adminMembers || [])].sort((a, b) => a.sla_compliance - b.sla_compliance)[0]
    return { longest, slow, weakest }
  }, [view])

  if (!data) return <Skeleton className="h-[520px] w-full rounded-xl" />
  const kraMembers = data.kra.members || []
  const submitted = kraMembers.filter((member) => member.status !== 'Not Submitted').length
  const pendingTasks = kraMembers.reduce((sum, member) => sum + Math.max(0, member.total_items - member.done_items), 0)
  const exportReport = () => {
    const rows = [['Date range', `${from} to ${to}`], [], ['Department', 'Tickets', 'Open', 'In progress', 'Escalated', 'Resolved', 'SLA met', 'Avg response', 'Avg resolution'], ['IT', view.it.total, view.itTickets.filter((ticket) => !DONE.includes(ticket.status)).length, view.it.in_progress, view.it.escalated, view.it.resolved, `${view.it.sla_compliance}%`, `${view.it.avg_response_hours}h`, `${view.it.avg_resolution_hours}h`], ['Admin', view.admin.total, view.adminTickets.filter((ticket) => !DONE.includes(ticket.status)).length, view.admin.in_progress, view.admin.escalated, view.admin.resolved, `${view.admin.sla_compliance}%`, `${view.admin.avg_response_hours}h`, `${view.admin.avg_resolution_hours}h`]]
    const blob = new Blob([rows.map((row) => row.join(',')).join('\n')], { type: 'text/csv' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `dashboard-${from}-to-${to}.csv`; link.click(); URL.revokeObjectURL(link.href)
  }
  const remindAll = async () => { try { const result = await api('/member-checklists/remind-pending', { method: 'POST' }); toast.success(`Reminder sent to ${result.reminded} pending member${result.reminded === 1 ? '' : 's'}`) } catch (error) { toast.error(error.message) } }
  return (
    <div className="space-y-4 text-[#111827]">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-[#9CA3AF]">Live analytics &amp; SLA · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}</p></div><div className="flex flex-wrap items-end gap-2"><label className="text-xs font-semibold text-[#4B5563]">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block h-9 rounded-md border border-[#E5E9EF] bg-white px-3 text-sm" /></label><label className="text-xs font-semibold text-[#4B5563]">To<input type="date" value={to} min={from} max={inputDate(new Date())} onChange={(event) => setTo(event.target.value)} className="mt-1 block h-9 rounded-md border border-[#E5E9EF] bg-white px-3 text-sm" /></label><Button variant="outline" onClick={exportReport}><Download className="h-4 w-4" />Export report</Button></div></div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-xl border border-[#F5C9C9] bg-[#FDECEC] px-5 py-4 text-sm text-[#942828]">
        <span className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" />Needs attention</span>
        <span>Longest overdue: <b>{attention.longest ? `${attention.longest.human_id} · ${duration(Date.now() - new Date(attention.longest.sla_resolution_due))}` : 'None'}</b></span>
        <span>Admin resolution <b>{attention.slow}× slower</b> than IT</span>
        <span>{attention.weakest?.member_name}: <b>{attention.weakest?.sla_compliance || 0}% SLA met</b></span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_120px_1fr]">
        <DeskCard department="IT" stats={view.it} tickets={view.itTickets} members={view.itMembers} />
        <div className="hidden flex-col items-center justify-center gap-3 xl:flex">
          <p className="text-xs font-semibold uppercase text-[#9CA3AF]">IT vs Admin</p>
          {[['SLA met', `${view.it.sla_compliance}%`, `${view.admin.sla_compliance}%`], ['Resolution', `${view.it.avg_resolution_hours}h`, `${view.admin.avg_resolution_hours}h`], ['Escalated', view.it.escalated, view.admin.escalated], ['Response', `${view.it.avg_response_hours}h`, `${view.admin.avg_response_hours}h`]].map(([label, itValue, adminValue]) => <Card key={label} className="w-full px-2 py-3 text-center shadow-none"><p className="text-xs font-semibold text-[#9CA3AF]">{label}</p><p className="mt-1 font-bold text-green-700">{itValue}</p><p className="text-[10px] text-[#9CA3AF]">vs</p><p className="font-bold text-red-600">{adminValue}</p></Card>)}
        </div>
        <DeskCard department="Admin" stats={view.admin} tickets={view.adminTickets} members={view.adminMembers} />
      </div>

      <Card className="flex flex-wrap items-center gap-5 border-[#E5E9EF] px-5 py-4 shadow-none">
        <div><p className="font-bold">Daily KRA compliance</p><p className="text-xs text-[#9CA3AF]">{data.kra.date}</p></div>
        <span className="font-medium text-red-700">{submitted}/{kraMembers.length} submitted</span>
        <div className="flex -space-x-2">{kraMembers.map((member) => <span key={member.member_id} className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-[#FADDDD] text-xs font-semibold text-[#A32D2D]">{initials(member.member_name)}</span>)}</div>
        <span className="text-sm text-[#4B5563]">{pendingTasks} tasks pending across IT and Admin teams</span>
        <Button variant="outline" className="ml-auto" onClick={remindAll}><Bell className="h-4 w-4" />Remind all</Button>
        <Button className="bg-[#131C26] hover:bg-[#1C2836]" onClick={onViewKra}>View KRA board</Button>
      </Card>
    </div>
  )
}

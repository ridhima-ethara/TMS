'use client'
import { useEffect, useState } from 'react'
import { api, PRIORITY_META, statusClass, fmtDate, ROLE_LABEL } from '@/lib/appapi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { Ticket, AlertTriangle, CheckCircle2, Clock, FileCheck2, Timer } from 'lucide-react'

const PIE_COLORS = ['#991b1b', '#f97316', '#facc15', '#10b981', '#6366f1', '#06b6d4']

function Stat({ label, value, icon: Icon, tone = 'default' }) {
  const tones = { default: 'text-foreground', red: 'text-red-600', amber: 'text-amber-600', green: 'text-green-600', blue: 'text-blue-600' }
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-semibold ${tones[tone]}`}>{value ?? 0}</p>
        </div>
        {Icon && <Icon className={`h-8 w-8 opacity-20 ${tones[tone]}`} />}
      </CardContent>
    </Card>
  )
}

export default function Dashboard({ user, onOpenTicket, refresh }) {
  const [s, setS] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    api('/dashboard').then(setS).catch(() => {}).finally(() => setLoading(false))
  }, [refresh])

  if (loading) return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
  if (!s) return null

  const cards = []
  cards.push({ label: 'Total', value: s.total, icon: Ticket })
  cards.push({ label: 'Open', value: s.open, icon: Clock, tone: 'blue' })
  cards.push({ label: 'In Progress', value: s.in_progress, icon: Timer, tone: 'blue' })
  if (user.role === 'employee') {
    cards.push({ label: 'Waiting Response', value: s.pending_user, icon: Clock, tone: 'amber' })
    cards.push({ label: 'Pending Approval', value: s.pending_approval, icon: FileCheck2, tone: 'amber' })
    cards.push({ label: 'Resolved', value: s.resolved, icon: CheckCircle2, tone: 'green' })
    cards.push({ label: 'Closed', value: s.closed, icon: CheckCircle2, tone: 'green' })
  } else if (user.role === 'it') {
    cards.push({ label: 'Assigned', value: s.assigned, icon: Ticket })
    cards.push({ label: 'Pending User', value: s.pending_user, icon: Clock, tone: 'amber' })
    cards.push({ label: 'Resolved', value: s.resolved, icon: CheckCircle2, tone: 'green' })
    cards.push({ label: 'Overdue / SLA Breach', value: s.overdue, icon: AlertTriangle, tone: 'red' })
  } else if (user.role === 'admin') {
    cards.push({ label: 'Pending Approval', value: s.pending_approval, icon: FileCheck2, tone: 'amber' })
    cards.push({ label: 'Clarification', value: s.clarification, icon: AlertTriangle, tone: 'amber' })
    cards.push({ label: 'Approved Ready', value: s.approved_ready, icon: CheckCircle2, tone: 'green' })
    cards.push({ label: 'Tasks Overdue', value: s.tasks_overdue, icon: AlertTriangle, tone: 'red' })
  } else {
    cards.push({ label: 'Pending Approval', value: s.pending_approval, icon: FileCheck2, tone: 'amber' })
    cards.push({ label: 'Clarification', value: s.clarification, icon: AlertTriangle, tone: 'amber' })
    cards.push({ label: 'Approved Ready', value: s.approved_ready, icon: CheckCircle2, tone: 'green' })
    cards.push({ label: 'Overdue / SLA Breach', value: s.overdue, icon: AlertTriangle, tone: 'red' })
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => <Stat key={c.label} {...c} />)}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">By Priority</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={(s.by_priority || []).filter((x) => x.value > 0)} dataKey="value" nameKey="name" outerRadius={80} label>
                  {(s.by_priority || []).map((e, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">By Category</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(s.by_category || []).slice(0, 8)}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#0d9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recent Tickets</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {(s.recent || []).map((t) => (
            <button key={t.id} onClick={() => onOpenTicket(t.id)} className="w-full flex items-center justify-between gap-2 rounded-md border p-2 text-left hover:bg-muted/50">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs text-muted-foreground shrink-0">{t.human_id}</span>
                <span className="truncate text-sm">{t.title}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge className={PRIORITY_META[t.priority]?.badge}>{t.priority}</Badge>
                <Badge variant="outline" className={statusClass(t.status)}>{t.status}</Badge>
              </div>
            </button>
          ))}
          {(!s.recent || s.recent.length === 0) && <p className="text-sm text-muted-foreground">No tickets yet.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

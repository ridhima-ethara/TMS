'use client'
import { useMemo, useState } from 'react'
import { PRIORITY_META, statusClass } from '@/lib/appapi'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

const PRIO_RANK = { Critical: 4, High: 3, Medium: 2, Low: 1 }
const DAY_TINT = {
  Critical: 'bg-red-50 border-red-300 hover:bg-red-100',
  High: 'bg-orange-50 border-orange-300 hover:bg-orange-100',
  Medium: 'bg-yellow-50 border-yellow-300 hover:bg-yellow-100',
  Low: 'bg-emerald-50 border-emerald-300 hover:bg-emerald-100',
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function TicketCalendar({ tickets = [], onOpenTicket }) {
  const [cursor, setCursor] = useState(() => new Date())
  const [selected, setSelected] = useState(null)
  const year = cursor.getFullYear()
  const month = cursor.getMonth()

  const byDay = useMemo(() => {
    const map = {}
    for (const t of tickets) {
      if (!t.created_at) continue
      const d = new Date(t.created_at)
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate()
        ;(map[day] = map[day] || []).push(t)
      }
    }
    return map
  }, [tickets, year, month])

  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const topPriority = (list) => list.reduce((top, t) => (PRIO_RANK[t.priority] > PRIO_RANK[top] ? t.priority : top), 'Low')
  const selList = selected ? (byDay[selected] || []) : []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-teal-600" />
          <span className="font-medium">{cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => { setCursor(new Date(year, month - 1, 1)); setSelected(null) }}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" className="h-7" onClick={() => { setCursor(new Date()); setSelected(null) }}>Today</Button>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => { setCursor(new Date(year, month + 1, 1)); setSelected(null) }}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {WD.map((w) => <div key={w} className="py-1 font-medium">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />
          const list = byDay[d] || []
          const has = list.length > 0
          const tint = has ? DAY_TINT[topPriority(list)] : 'bg-card border-border hover:bg-muted/50'
          const isToday = new Date().getDate() === d && new Date().getMonth() === month && new Date().getFullYear() === year
          return (
            <button key={i} onClick={() => setSelected(selected === d ? null : d)}
              className={`min-h-[68px] rounded-md border p-1.5 text-left transition ${tint} ${selected === d ? 'ring-2 ring-teal-500' : ''}`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs ${isToday ? 'bg-teal-600 text-white rounded-full h-5 w-5 flex items-center justify-center' : 'text-foreground'}`}>{d}</span>
                {has && <span className="text-[10px] font-semibold text-muted-foreground">{list.length}</span>}
              </div>
              {has && (
                <div className="mt-1 flex flex-wrap gap-0.5">
                  {list.slice(0, 4).map((t) => <span key={t.id} className={`h-1.5 w-1.5 rounded-full ${PRIORITY_META[t.priority]?.dot}`} />)}
                </div>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">
        {['Critical', 'High', 'Medium', 'Low'].map((p) => (
          <span key={p} className="flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${PRIORITY_META[p]?.dot}`} />{p}</span>
        ))}
      </div>

      {selected && (
        <div className="rounded-md border p-3 space-y-1">
          <p className="text-sm font-medium mb-1">{selList.length} ticket(s) on {new Date(year, month, selected).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</p>
          {selList.length === 0 && <p className="text-sm text-muted-foreground">No tickets.</p>}
          {selList.map((t) => (
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
        </div>
      )}
    </div>
  )
}

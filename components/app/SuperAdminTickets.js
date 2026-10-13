'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/appapi'
import { Skeleton } from '@/components/ui/skeleton'
import { AppSelect } from '@/components/ui/select'
import { RaiseTicket } from '@/components/app/TicketsView'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { toast } from 'sonner'

const DAY = 86400000
const HOUR = 3600000
const PAGE = 1000
// Timeline window: 08:00 → 21:00.
const W0 = 8 * HOUR
const WSPAN = 13 * HOUR
const DESK = {
  IT: { key: 'IT', label: 'IT', color: '#2f6bd0', soft: '#e8f0fc', rgb: '47,107,208' },
  Admin: { key: 'Admin', label: 'Admin', color: '#12795a', soft: '#e4f3ec', rgb: '18,121,90' },
}
const ST_CLS = {
  Open: 'bg-[#fdf3dc] text-[#8a5a00]',
  'In progress': 'bg-[#e8f0fc] text-[#1d4f9e]',
  Closed: 'bg-[#e4f3ec] text-[#12795a]',
  Cancelled: 'bg-[#f1f0ec] text-[#55555e]',
}
const LOG_COLS = '116px minmax(200px,2fr) 140px 78px 86px 78px minmax(150px,1fr) 96px'
const DONE = ['Resolved', 'Closed']

const pad = (n) => String(n).padStart(2, '0')
const clock = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const wd = (ts) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short' })
const dm = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
const dur = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), r = m % 60
  if (h < 24) return r ? `${h}h ${r}m` : `${h}h`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2 }
const barC = (p) => (p >= 100 ? '#b42318' : p >= 60 ? '#c8871b' : '#12795a')
const initials = (name = '') => name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '—'
const seg = (on) => (on ? 'bg-white text-[#17171c] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'bg-transparent text-[#6b6b76]')

function weekStartOf(offset) {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay() + offset * 7)
  return d
}

// One flat, timestamp-based shape per ticket so every panel below measures the
// same thing. Picked up = first move to In Progress, or — when the member
// resolved straight from Open — the moment the ticket was assigned to them
// (for a self-raised ticket that is when it was raised); closed = closed/resolved.
function normalize(t) {
  const raised = +new Date(t.raised_at || t.created_at)
  const status = DONE.includes(t.status) ? 'Closed' : t.status === 'Cancelled' ? 'Cancelled' : t.status === 'Open' || !t.assignee_id ? 'Open' : 'In progress'
  const closedRaw = status === 'Closed' ? t.closed_at || t.resolved_at || t.resolution?.resolved_date || t.updated_at : null
  const closed = closedRaw ? +new Date(closedRaw) : null
  const startedRaw = t.status_timestamps?.in_progress || t.work_started_at
  const assignedRaw = t.assignee_id ? t.last_assigned_at || t.assigned_at || t.acknowledged_at : null
  const inRange = (v) => v != null && v >= raised && (closed == null || v <= closed)
  let picked = startedRaw ? +new Date(startedRaw) : null
  let pickedBy = 'start'
  if (!inRange(picked)) {
    picked = assignedRaw ? +new Date(assignedRaw) : null
    pickedBy = 'assign'
    if (!inRange(picked)) picked = null
  }
  const due = t.sla_resolution_due ? +new Date(t.sla_resolution_due) : null
  const target = due ? Math.max(HOUR, due - raised) : (t.sla_policy?.resolution_hours || 48) * HOUR
  const ended = status === 'Cancelled' ? +new Date(t.updated_at || raised) : null
  return {
    id: t.id, hid: t.human_id, title: t.title, cat: t.category || 'Other', prio: t.priority || 'Medium',
    desk: t.department === 'Admin' ? 'Admin' : 'IT', m: t.assignee_id || '', who: t.assignee_name || 'Unassigned',
    raised, picked, pickedBy, closed, ended, status, target, live: status === 'Open' || status === 'In progress',
  }
}

async function fetchTickets(since) {
  const all = []
  for (let page = 1; page <= 20; page++) {
    const result = await api(`/tickets?limit=${PAGE}&page=${page}`)
    all.push(...result.items)
    if (result.items.length < PAGE) break
    const oldest = result.items[result.items.length - 1]
    if (new Date(oldest.created_at) < since) break
  }
  // Active tickets older than the window still belong in the live queue.
  const active = await Promise.all(['Open', 'In Progress'].map((s) => api(`/tickets?status=${encodeURIComponent(s)}&limit=${PAGE}`).then((r) => r.items).catch(() => [])))
  const byId = new Map(all.map((t) => [t.id, t]))
  active.flat().forEach((t) => byId.set(t.id, t))
  return [...byId.values()]
}

function downloadCsv(rows) {
  const csv = [
    ['Ticket', 'Title', 'Category', 'Priority', 'Desk', 'Handled by', 'Raised', 'Picked up', 'Closed', 'Time to close', 'SLA target', 'Status'],
    ...rows.map((t) => [t.hid, t.title, t.cat, t.prio, t.desk, t.who, new Date(t.raised).toLocaleString('en-GB'), t.picked ? new Date(t.picked).toLocaleString('en-GB') : '', t.closed ? new Date(t.closed).toLocaleString('en-GB') : '', t.closed ? dur(t.closed - t.raised) : '', dur(t.target), t.status]),
  ].map((line) => line.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  link.download = 'tickets.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}

const Card = ({ className = '', children }) => <section className={`rounded-xl border border-[#e8e7e3] bg-white ${className}`}>{children}</section>
const Avatar = ({ ini, color, soft, size = 22 }) => <span className="grid shrink-0 place-items-center rounded-full font-semibold" style={{ width: size, height: size, background: soft, color, fontSize: size > 22 ? 10 : 9.5 }}>{ini}</span>
const Pill = ({ status, className = '' }) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${ST_CLS[status]} ${className}`}>{status}</span>

export default function SuperAdminTickets({ user, onOpenTicket }) {
  const [raw, setRaw] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [weekOffset, setWeekOffset] = useState(0)
  const [desk, setDesk] = useState('all')
  const [day, setDay] = useState(undefined)
  const [member, setMember] = useState('')
  const [status, setStatus] = useState('')
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('raised')
  const [limit, setLimit] = useState(15)
  const [openId, setOpenId] = useState(null)

  const weekStart = useMemo(() => weekStartOf(weekOffset), [weekOffset])
  const load = useCallback(() => {
    const since = new Date(+weekStart - 30 * DAY)
    return fetchTickets(since).then((items) => { setRaw(items); setNow(Date.now()) }).catch((error) => toast.error(error.message))
  }, [weekStart])
  useEffect(() => {
    load()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 60000)
    return () => clearInterval(timer)
  }, [load])
  useEffect(() => {
    if (!openId) return undefined
    const onKey = (event) => { if (event.key === 'Escape') setOpenId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId])

  // Approval requests live in the Approval inbox, so they are kept out of
  // ticket volume here (one item is never reported under two headings).
  const ALL = useMemo(() => (raw || []).filter((t) => t.approval_required !== true).map(normalize), [raw])

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const s = new Date(weekStart); s.setDate(s.getDate() + i); const e = new Date(s); e.setDate(e.getDate() + 1); return { start: +s, end: +e } }), [weekStart])
  const weekEnd = days[6].end
  const dayIdx = useCallback((ts) => (ts == null || ts < days[0].start || ts >= weekEnd ? null : days.findIndex((d) => ts >= d.start && ts < d.end)), [days, weekEnd])
  const TODAY = weekOffset === 0 ? new Date(now).getDay() : weekOffset < 0 ? 7 : -1
  const lastDay = Math.min(6, TODAY)

  if (!raw) return <Skeleton className="h-[720px] w-full rounded-xl" />

  const defaultDay = weekOffset === 0 ? (TODAY > 0 ? TODAY - 1 : TODAY) : null
  const selDay = day !== undefined ? day : defaultDay
  const inDesk = (t) => desk === 'all' || t.desk === desk
  const tagged = ALL.filter(inDesk).map((t) => ({ ...t, day: dayIdx(t.raised), cDay: dayIdx(t.closed), taken: (t.closed ?? t.ended ?? now) - t.raised }))
  const base = tagged.filter((t) => t.day != null || t.cDay != null)
  const liveAll = tagged.filter((t) => t.live)
  const set = (fn) => { fn(); setLimit(15) }

  const memberMap = new Map()
  ;[...base, ...liveAll].forEach((t) => { if (t.m && !memberMap.has(t.m)) memberMap.set(t.m, { id: t.m, name: t.who, desk: t.desk }) })
  const members = [...memberMap.values()].sort((a, b) => (a.desk === b.desk ? a.name.localeCompare(b.name) : a.desk === 'IT' ? -1 : 1))
  const memberName = (id) => memberMap.get(id)?.name || ALL.find((t) => t.m === id)?.who || 'Member'

  const dayLabel = (i) => (weekOffset === 0 && i === TODAY ? 'Today' : wd(days[i].start))
  const dayName = selDay === null ? (weekOffset === 0 ? 'this week' : 'that week') : weekOffset === 0 && selDay === TODAY ? 'today' : `${wd(days[selDay].start)} ${dm(days[selDay].start)}`
  const weekLabel = `${dm(days[0].start)} – ${dm(days[6].start)} ${new Date(days[6].start).getFullYear()}`

  // ---- day cards
  const dayCards = [{ key: 'week', label: 'Whole week', date: `${dm(days[0].start)} – ${dm(days[6].start)}`, raised: base.filter((t) => t.day != null).length, closed: base.filter((t) => t.cDay != null).length, sub: `${liveAll.length} still active`, future: false, on: selDay === null, pick: () => set(() => setDay(null)) }]
    .concat(days.map((d, i) => {
      const fut = i > TODAY
      const r = base.filter((t) => t.day === i).length, c = base.filter((t) => t.cDay === i)
      const m = med(c.map((t) => t.closed - t.raised))
      return { key: i, label: dayLabel(i), date: dm(d.start), raised: fut ? '—' : r, closed: fut ? '—' : c.length, sub: fut ? 'Upcoming' : c.length ? `median ${dur(m)} to close` : r ? 'nothing closed yet' : 'no activity', future: fut, on: selDay === i, pick: () => set(() => setDay(i)) }
    }))

  // ---- insight
  const raisedD = base.filter((t) => (selDay === null ? t.day != null : t.day === selDay))
  const closedD = base.filter((t) => (selDay === null ? t.cDay != null : t.cDay === selDay))
  let dayInsight
  {
    const by = {}; closedD.forEach((t) => { if (t.m) by[t.m] = (by[t.m] || 0) + 1 })
    const top = Object.entries(by).sort((a, b) => b[1] - a[1])
    const hrs = {}; raisedD.forEach((t) => { const h = new Date(t.raised).getHours(); hrs[h] = (hrs[h] || 0) + 1 })
    const bh = Object.entries(hrs).sort((a, b) => b[1] - a[1])[0]
    if (!raisedD.length && !closedD.length) dayInsight = `No tickets ${dayName}.`
    else {
      const tops = top.filter((x) => x[1] === top[0][1]).map((x) => memberName(x[0]).split(' ')[0])
      dayInsight = `${dayName[0].toUpperCase() + dayName.slice(1)}: ${raisedD.length} raised, ${closedD.length} closed.` +
        (top.length ? ` ${tops.join(' & ')} closed the most (${top[0][1]}${tops.length > 1 ? ' each' : ''}).` : '') +
        (bh && selDay !== null ? ` Busiest hour ${pad(bh[0])}:00–${pad(+bh[0] + 1)}:00 with ${bh[1]} new ticket${bh[1] === 1 ? '' : 's'}.` : '') +
        (weekOffset === 0 && selDay === TODAY ? ' Day in progress.' : '')
    }
  }

  // ---- KPIs
  const scopeM = (t) => !member || t.m === member
  const rD = raisedD.filter(scopeM), cD = closedD.filter(scopeM)
  const mClose = med(cD.map((t) => t.closed - t.raised))
  const picks = cD.filter((t) => t.picked != null)
  const mPick = med(picks.map((t) => t.picked - t.raised))
  const inSla = cD.filter((t) => t.closed - t.raised <= t.target).length
  const kpis = [
    { l: 'Raised', v: rD.length, s: dayName, c: 'text-[#17171c]' },
    { l: 'Closed', v: cD.length, s: dayName, c: 'text-[#b3177f]' },
    { l: 'Active right now', v: liveAll.length, s: `${liveAll.filter((t) => t.status === 'Open').length} open · ${liveAll.filter((t) => t.status === 'In progress').length} in progress`, c: 'text-[#17171c]' },
    { l: 'Median time to close', v: mClose == null ? '—' : dur(mClose), s: 'raised → closed', c: 'text-[#17171c]' },
    { l: 'Median pick-up time', v: mPick == null ? '—' : dur(mPick), s: picks.length === cD.length ? 'raised → picked up (in progress or assigned)' : `raised → picked up · ${picks.length} of ${cD.length} tracked`, c: 'text-[#17171c]' },
    { l: 'Closed within SLA', v: cD.length ? `${Math.round((inSla / cD.length) * 100)}%` : '—', s: `${inSla} of ${cD.length}`, c: 'text-[#12795a]' },
  ]

  // ---- timeline
  const tlRows = []
  const isTodaySel = weekOffset === 0 && selDay === TODAY
  if (selDay !== null) {
    const w0 = days[selDay].start + W0, w1 = w0 + WSPAN
    members.filter((m) => !member || m.id === member).forEach((M) => {
      const D = DESK[M.desk]
      const ts = tagged.filter((t) => t.m === M.id && t.status !== 'Cancelled')
        .map((t) => ({ t, st: t.picked ?? t.raised, en: t.closed ?? now }))
        .filter((x) => x.en > w0 && x.st < w1 && x.st <= (isTodaySel ? now : w1))
        .sort((a, b) => a.st - b.st)
      if (!ts.length) return
      const lanes = []
      const blocks = ts.map((x) => {
        let L = lanes.findIndex((e) => e <= x.st); if (L < 0) { L = lanes.length; lanes.push(0) }
        lanes[L] = x.en
        const a = Math.max(x.st, w0), b = Math.min(x.en, w1), act = x.t.closed == null
        return { key: x.t.id, top: 5 + L * 18, left: ((a - w0) / WSPAN) * 100, w: Math.max(0.4, ((b - a) / WSPAN) * 100), act, color: D.color, tip: `${x.t.hid} · ${x.t.title}\n${clock(x.st)} → ${act ? 'still active' : clock(x.en)} (${dur(x.en - x.st)})`, open: () => setOpenId(x.t.id) }
      })
      const closedHere = ts.filter((x) => x.t.cDay === selDay)
      tlRows.push({ id: M.id, name: M.name, ini: initials(M.name), D, h: Math.max(1, lanes.length) * 18 + 10, blocks, closed: closedHere.length, handled: dur(closedHere.reduce((acc, x) => acc + (x.t.closed - (x.t.picked ?? x.t.raised)), 0)) })
    })
  }
  const nowLeft = isTodaySel ? ((now - (days[selDay].start + W0)) / WSPAN) * 100 : -1

  // ---- matrix
  const mxDays = Array.from({ length: lastDay + 1 }, (_, i) => i)
  const mx = members.map((M) => { const c = base.filter((t) => t.m === M.id && t.cDay != null); return { M, D: DESK[M.desk], c, counts: mxDays.map((i) => c.filter((t) => t.cDay === i).length) } })
  const mxMax = Math.max(1, ...mx.flatMap((r) => r.counts))

  // ---- live queue (ignores day filter)
  const live = [...liveAll].sort((a, b) => a.raised + a.target - (b.raised + b.target))
  const q0 = { unalloc: liveAll.filter((t) => !t.m).length, open: liveAll.filter((t) => t.status === 'Open').length, prog: liveAll.filter((t) => t.status === 'In progress').length }

  // ---- log
  const qq = q.trim().toLowerCase()
  const L = base.filter((t) => (selDay === null || t.day === selDay || t.cDay === selDay) && scopeM(t) &&
    (!status || (status === 'Overdue' ? t.live && t.raised + t.target < now : t.status === status)) &&
    (!cat || t.cat === cat) && (!qq || `${t.hid} ${t.title} ${t.who}`.toLowerCase().includes(qq)))
  const sk = { raised: (t) => -t.raised, taken: (t) => -(t.taken / t.target), pickup: (t) => -((t.picked ?? (t.live ? now : t.closed ?? t.raised)) - t.raised) }[sort]
  L.sort((a, b) => sk(a) - sk(b))
  const logScope = `${selDay === null ? `Raised or closed ${dayName}` : `Raised or closed on ${dayName}`}${member ? ` · ${memberName(member)}` : ''}`
  const catOpts = [...new Set(base.map((t) => t.cat))].sort()

  const chips = []
  if (member) chips.push({ label: memberName(member), clear: () => setMember('') })
  if (status) chips.push({ label: status, clear: () => setStatus('') })
  if (cat) chips.push({ label: cat, clear: () => setCat('') })
  if (q) chips.push({ label: `“${q}”`, clear: () => setQ('') })

  // ---- drawer
  const ot = openId && tagged.find((t) => t.id === openId)
  let dt = null
  if (ot) {
    const p = Math.round((ot.taken / ot.target) * 100)
    const sameDay = ALL.filter((t) => t.m && t.m === ot.m && t.closed != null && dayKey(t.closed) === dayKey(ot.raised))
    const steps = [{ l: 'Raised', t: `${wd(ot.raised)} ${dm(ot.raised)}, ${clock(ot.raised)}`, gap: '', dot: '#9a9aa3' }]
    if (ot.picked != null) steps.push({ l: `Picked up by ${ot.who}`, t: `${wd(ot.picked)}, ${clock(ot.picked)}`, gap: `+${dur(ot.picked - ot.raised)}`, dot: '#2f6bd0' })
    if (ot.closed != null) steps.push({ l: 'Closed', t: `${wd(ot.closed)} ${dm(ot.closed)}, ${clock(ot.closed)}`, gap: `+${dur(ot.closed - (ot.picked ?? ot.raised))}`, dot: '#12795a' })
    else if (ot.status === 'Cancelled') steps.push({ l: 'Cancelled', t: `${wd(ot.ended)} ${dm(ot.ended)}, ${clock(ot.ended)}`, gap: '', dot: '#9a9aa3' })
    else steps.push({ l: 'Not closed yet', t: `Open for ${dur(now - ot.raised)}`, gap: '', dot: '#b3177f' })
    const due = ot.raised + ot.target
    dt = {
      ...ot, whoFirst: ot.m ? ot.who.split(' ')[0] : 'Unassigned', steps, pct: Math.min(100, Math.max(2, p)), barColor: barC(p),
      verdict: ot.closed != null ? (p <= 100 ? `Closed with ${dur(ot.target - ot.taken)} to spare (${p}% of SLA used).` : `Breached SLA by ${dur(ot.taken - ot.target)}.`) : ot.status === 'Cancelled' ? 'Cancelled before closing.' : due > now ? `${dur(due - now)} left before breach.` : `Overdue by ${dur(now - due)}.`,
      dayCtx: ot.m ? `Closed ${sameDay.length} ticket${sameDay.length === 1 ? '' : 's'} on ${wd(ot.raised)} ${dm(ot.raised)} · median ${sameDay.length ? dur(med(sameDay.map((t) => t.closed - t.raised))) : '—'} each.` : 'Not picked up by a member yet.',
    }
  }

  const selectCls = 'h-auto w-auto rounded-lg border-[#e0dfdb] px-2.5 py-1.5 text-[12.5px] text-[#17171c]'

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4 text-[13px] text-[#17171c]">
      <header className="flex flex-wrap items-end justify-between gap-3.5">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[22px] font-semibold tracking-[-.01em]">All tickets</h2>
          <div className="flex flex-wrap items-center gap-2 text-[#6b6b76]">
            <span className="inline-flex items-center gap-1">
              <button onClick={() => { setWeekOffset((w) => w - 1); setDay(null); setLimit(15) }} className="grid h-6 w-6 place-items-center rounded-md border border-[#e0dfdb] bg-white text-[#55555e] hover:bg-[#f5f5f2]" aria-label="Previous week"><ChevronLeft className="h-3.5 w-3.5" /></button>
              <button onClick={() => { setWeekOffset((w) => w + 1); setDay(weekOffset + 1 === 0 ? undefined : null); setLimit(15) }} disabled={weekOffset >= 0} className="grid h-6 w-6 place-items-center rounded-md border border-[#e0dfdb] bg-white text-[#55555e] hover:bg-[#f5f5f2] disabled:opacity-40" aria-label="Next week"><ChevronRight className="h-3.5 w-3.5" /></button>
            </span>
            <span>Week of {weekLabel} · live as of {wd(now)} {dm(now)}, {clock(now)}</span>
            {weekOffset < 0 && <button onClick={() => { setWeekOffset(0); setDay(undefined); setLimit(15) }} className="text-[#b3177f] underline">Back to this week</button>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(15) }} placeholder="Search ID, title or member…" className="w-60 max-w-full rounded-[9px] border border-[#e0dfdb] bg-white px-3 py-2 text-[12.5px] text-[#17171c] outline-none" />
          <button onClick={() => { downloadCsv(L); toast.success(`Exported ${L.length} tickets`) }} className="rounded-[9px] border border-[#e0dfdb] bg-white px-3 py-2 text-[12.5px] text-[#17171c]">Export CSV</button>
          {user && <RaiseTicket user={user} onCreated={load} trigger={<button className="rounded-[9px] bg-[#17171c] px-3.5 py-2 text-[12.5px] font-medium text-white">New ticket</button>} />}
        </div>
      </header>

      <Card className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <div className="flex gap-0.5 rounded-[9px] bg-[#efeeea] p-[3px]">
          {[['all', 'All desks'], ['IT', 'IT'], ['Admin', 'Admin']].map(([k, l]) => <button key={k} onClick={() => { setDesk(k); setMember(''); setLimit(15) }} className={`rounded-[7px] px-[11px] py-[5px] text-[12.5px] font-medium ${seg(desk === k)}`}>{l}</button>)}
        </div>
        <AppSelect value={status} onValueChange={(v) => { setStatus(v); setLimit(15) }} options={[['', 'All statuses'], ['Open', 'Open'], ['In progress', 'In progress'], ['Closed', 'Closed'], ['Cancelled', 'Cancelled'], ['Overdue', 'Overdue (active, past SLA)']]} aria-label="Status" className={selectCls} />
        <AppSelect value={cat} onValueChange={(v) => { setCat(v); setLimit(15) }} options={[['', 'All categories'], ...catOpts.map((c) => [c, c])]} aria-label="Category" className={`${selectCls} max-w-[200px]`} />
        <AppSelect value={member} onValueChange={(v) => { setMember(v); setLimit(15) }} options={[['', 'All members'], ...members.filter((m) => desk === 'all' || m.desk === desk).map((m) => [m.id, m.name])]} aria-label="Member" className={selectCls} />
        {chips.map((c) => <button key={c.label} onClick={c.clear} className="rounded-full bg-[#fbe9f4] px-2.5 py-[5px] text-xs font-medium text-[#8a0f61]">{c.label} ✕</button>)}
        {chips.length > 0 && <button onClick={() => { setMember(''); setStatus(''); setCat(''); setQ('') }} className="bg-transparent text-xs text-[#6b6b76] underline">Clear all</button>}
      </Card>

      <section className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-4 lg:grid-cols-8">
        {dayCards.map((d) => (
          <button key={d.key} onClick={d.pick} disabled={d.future} className={`flex flex-col gap-1.5 rounded-[11px] border px-3 py-[11px] text-left text-[#17171c] ${d.on ? 'border-[#b3177f] bg-[#fdf5fa]' : 'border-[#e8e7e3] bg-white'} ${d.future ? 'cursor-default opacity-45' : 'cursor-pointer'}`}>
            <div className="flex items-baseline justify-between gap-1.5"><span className="font-semibold">{d.label}</span><span className="text-[11.5px] text-[#6b6b76]">{d.date}</span></div>
            <div className="flex items-baseline gap-2.5 tabular-nums">
              <span className="flex flex-col leading-tight"><span className="text-lg font-semibold">{d.raised}</span><span className="text-[10.5px] text-[#6b6b76]">raised</span></span>
              <span className="flex flex-col leading-tight"><span className="text-lg font-semibold text-[#b3177f]">{d.closed}</span><span className="text-[10.5px] text-[#6b6b76]">closed</span></span>
            </div>
            <span className="text-[11.5px] text-[#55555e]">{d.sub}</span>
          </button>
        ))}
      </section>

      <div className="flex items-start gap-2.5 rounded-[10px] border border-[#e8e7e3] bg-white px-3.5 py-2.5 text-[12.5px] leading-normal text-[#3b3b44]"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#b3177f]" /><span>{dayInsight}</span></div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
          {kpis.map((k) => (
            <div key={k.l} className="flex flex-col gap-[5px] border-r border-[#efeeea] px-[18px] py-3.5">
              <span className="text-xs text-[#6b6b76]">{k.l}</span>
              <span className={`text-[22px] font-semibold tracking-[-.02em] ${k.c}`}>{k.v}</span>
              <span className="text-[11.5px] text-[#6b6b76]">{k.s}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-[18px]">
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Who worked on what · {selDay === null ? 'pick a day' : isTodaySel ? `today, ${wd(now)} ${dm(now)}` : `${wd(days[selDay].start)} ${dm(days[selDay].start)}`}</h3><span className="text-xs text-[#6b6b76]">Each bar runs from pick-up to close. Stacked bars = tickets handled in parallel. Click a bar for details.</span></div>
          <div className="flex flex-wrap items-center gap-3.5 text-xs text-[#55555e]">
            <span className="flex items-center gap-1.5"><span className="h-2 w-3.5 rounded-sm" style={{ background: DESK.IT.color }} />IT closed</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-3.5 rounded-sm" style={{ background: DESK.Admin.color }} />Admin closed</span>
            <span className="flex items-center gap-1.5"><span className="box-border h-2 w-3.5 rounded-sm border-[1.5px] border-dashed border-[#b3177f] bg-white" />Still active</span>
          </div>
        </div>
        {(selDay === null || !tlRows.length) && <div className="rounded-lg bg-[#f7f6f3] p-6 text-center text-[#6b6b76]">{selDay === null ? 'Select a single day above to see the hour-by-hour timeline.' : 'No one worked on tickets this day.'}</div>}
        {selDay !== null && tlRows.length > 0 && (
          <div className="overflow-x-auto">
            <div className="grid min-w-[860px] gap-x-3.5" style={{ gridTemplateColumns: '170px minmax(0,1fr) 150px' }}>
              <span />
              <div className="relative h-[18px] border-b border-[#e8e7e3]">
                {Array.from({ length: 14 }, (_, h) => <span key={h} className="absolute -translate-x-1/2 text-[10.5px] text-[#8a8a93]" style={{ left: `${(h / 13) * 100}%` }}>{pad(8 + h)}</span>)}
              </div>
              <span className="self-end text-right text-[11px] text-[#8a8a93]">Closed · hands-on time</span>
              {tlRows.map((r) => [
                <button key={`${r.id}-n`} onClick={() => { setMember(r.id); setLimit(15) }} className="flex min-w-0 items-center gap-2 border-b border-[#f4f3f0] py-1.5 text-left">
                  <Avatar ini={r.ini} color={r.D.color} soft={r.D.soft} size={24} />
                  <span className="truncate font-medium">{r.name}</span>
                </button>,
                <div key={`${r.id}-t`} className="relative border-b border-[#f4f3f0]" style={{ height: r.h, background: 'repeating-linear-gradient(90deg,transparent 0,transparent calc(100%/13 - 1px),rgba(128,128,128,.12) calc(100%/13 - 1px),rgba(128,128,128,.12) calc(100%/13))' }}>
                  {r.blocks.map((b) => <div key={b.key} onClick={b.open} title={b.tip} className="absolute box-border h-3.5 min-w-1 cursor-pointer rounded-[3px] hover:brightness-110" style={{ top: b.top, left: `${b.left}%`, width: `${b.w}%`, background: b.act ? 'rgba(179,23,127,.10)' : b.color, border: b.act ? '1.5px dashed #b3177f' : 0 }} />)}
                  {nowLeft >= 0 && nowLeft <= 100 && <div className="absolute inset-y-0 w-0.5 bg-[#b3177f]" style={{ left: `${nowLeft}%` }} />}
                </div>,
                <div key={`${r.id}-s`} className="flex flex-col items-end justify-center border-b border-[#f4f3f0] leading-snug tabular-nums">
                  <span className="font-semibold">{r.closed} closed</span>
                  <span className="text-[11.5px] text-[#6b6b76]">{r.handled} hands-on</span>
                </div>,
              ])}
            </div>
          </div>
        )}
      </Card>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card className="flex min-w-0 flex-col gap-3 p-[18px]">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Closed per member per day</h3><span className="text-xs text-[#6b6b76]">Click a cell to see exactly those tickets below</span></div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[440px] items-center gap-1 tabular-nums" style={{ gridTemplateColumns: `minmax(130px,1.6fr) repeat(${mxDays.length},minmax(46px,1fr)) 56px 70px` }}>
              <span className="text-[11px] text-[#8a8a93]">Member</span>
              {mxDays.map((i) => <span key={i} className={`text-center text-[11px] ${selDay === i ? 'font-semibold text-[#b3177f]' : 'text-[#8a8a93]'}`}>{weekOffset === 0 && i === TODAY ? 'Today' : `${wd(days[i].start)} ${new Date(days[i].start).getDate()}`}</span>)}
              <span className="text-right text-[11px] text-[#8a8a93]">Week</span>
              <span className="text-right text-[11px] text-[#8a8a93]">Avg close</span>
              {mx.map(({ M, D, c, counts }) => {
                const avg = c.length ? c.reduce((a, t) => a + t.closed - t.raised, 0) / c.length : null
                return [
                  <button key={`${M.id}-n`} onClick={() => { setMember(member === M.id ? '' : M.id); setLimit(15) }} className="flex min-w-0 items-center gap-2 py-[3px] text-left">
                    <Avatar ini={initials(M.name)} color={D.color} soft={D.soft} />
                    <span className={`truncate ${member === M.id ? 'font-semibold' : ''}`}>{M.name}</span>
                  </button>,
                  ...counts.map((v, i) => {
                    const a = v ? 0.12 + (v / mxMax) * 0.78 : 0, on = member === M.id && selDay === i
                    return <button key={`${M.id}-${i}`} onClick={() => { setMember(M.id); setDay(i); setLimit(15) }} className={`h-8 rounded-md text-[12.5px] font-semibold ${v ? '' : 'bg-[#f7f6f3] text-[#b9b7b0]'}`} style={{ border: on ? '2px solid #b3177f' : 0, ...(v ? { background: `rgba(${D.rgb},${a.toFixed(2)})`, color: a > 0.5 ? '#fff' : 'inherit' } : {}) }}>{v || '·'}</button>
                  }),
                  <span key={`${M.id}-t`} className="text-right font-semibold">{c.length}</span>,
                  <span key={`${M.id}-a`} className={`text-right ${avg > 4 * HOUR ? 'text-[#b42318]' : 'text-[#3b3b44]'}`}>{avg == null ? '—' : dur(avg)}</span>,
                ]
              })}
            </div>
            {!mx.length && <p className="py-6 text-center text-[#6b6b76]">No member activity this week.</p>}
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-[18px]">
          <div className="flex items-start justify-between gap-2.5">
            <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Live queue</h3><span className="text-xs text-[#6b6b76]">Not closed yet — ignores the day filter</span></div>
            <div className="flex flex-wrap justify-end gap-1.5 text-[11.5px]">
              <span className="rounded-full bg-[#f1f0ec] px-2 py-[3px] text-[#3b3b44]">{q0.unalloc} unallocated</span>
              <span className="rounded-full bg-[#fdf3dc] px-2 py-[3px] text-[#8a5a00]">{q0.open} open</span>
              <span className="rounded-full bg-[#e8f0fc] px-2 py-[3px] text-[#1d4f9e]">{q0.prog} in progress</span>
            </div>
          </div>
          <div className="flex max-h-[420px] flex-col overflow-y-auto">
            {live.map((t) => {
              const left = t.raised + t.target - now
              return (
                <button key={t.id} onClick={() => setOpenId(t.id)} className="grid gap-x-3.5 gap-y-1.5 border-b border-[#f1f0ec] py-3 text-left" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                  <div className="flex min-w-0 flex-col gap-[3px]">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[11.5px] text-[#6b6b76]">{t.hid}</span><Pill status={t.status} /></div>
                    <span className="font-medium">{t.title}</span>
                    <span className="text-xs text-[#6b6b76]">{t.who} · waiting {dur(now - t.raised)}</span>
                  </div>
                  <div className="flex flex-col items-end justify-center gap-[3px]">
                    <span className="text-[11px] text-[#6b6b76]">SLA</span>
                    <span className="whitespace-nowrap font-semibold" style={{ color: left < 0 ? '#b42318' : left < 2 * HOUR ? '#c8871b' : '#12795a' }}>{left < 0 ? `${dur(-left)} over` : `${dur(left)} left`}</span>
                  </div>
                </button>
              )
            })}
            {!live.length && <p className="py-6 text-center font-medium text-[#12795a]">Queue clear — nothing active.</p>}
          </div>
        </Card>
      </section>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-2.5 px-[18px] pb-3 pt-4">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Ticket log · {L.length}</h3><span className="text-xs text-[#6b6b76]">{logScope}</span></div>
          <div className="flex gap-0.5 rounded-[9px] bg-[#efeeea] p-[3px]">
            {[['raised', 'Newest'], ['taken', 'Slowest vs SLA'], ['pickup', 'Longest wait']].map(([k, l]) => <button key={k} onClick={() => setSort(k)} className={`rounded-[7px] px-2.5 py-[5px] text-xs font-medium ${seg(sort === k)}`}>{l}</button>)}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[980px]">
            <div className="grid gap-3 border-y border-[#efeeea] bg-[#f7f6f3] px-[18px] py-[9px] text-[11.5px] text-[#6b6b76]" style={{ gridTemplateColumns: LOG_COLS }}>
              <span>Ticket</span><span>Title · category</span><span>Handled by</span><span>Raised</span><span>Picked up</span><span>Closed</span><span>Time to close vs SLA</span><span>Status</span>
            </div>
            {L.slice(0, limit).map((t) => {
              const D = DESK[t.desk], p = Math.round((t.taken / t.target) * 100), bc = barC(p)
              return (
                <div key={t.id} onClick={() => setOpenId(t.id)} className="grid cursor-pointer items-center gap-3 border-b border-[#f1f0ec] px-[18px] py-2.5 hover:bg-[#fbfaf8]" style={{ gridTemplateColumns: LOG_COLS }}>
                  <span className="font-mono text-[11.5px] text-[#55555e]">{t.hid}</span>
                  <div className="flex min-w-0 flex-col leading-snug"><span className="truncate font-medium">{t.title}</span><span className="text-[11.5px] text-[#8a8a93]">{t.cat} · {t.prio}</span></div>
                  <div className="flex min-w-0 items-center gap-[7px]"><Avatar ini={t.m ? initials(t.who) : '—'} color={D.color} soft={D.soft} /><span className="truncate">{t.who}</span></div>
                  <div className="flex flex-col leading-tight tabular-nums"><span>{clock(t.raised)}</span><span className="text-[11px] text-[#8a8a93]">{wd(t.raised)} {new Date(t.raised).getDate()}</span></div>
                  <div className="flex flex-col leading-tight tabular-nums"><span>{t.picked != null ? clock(t.picked) : '—'}</span><span className="text-[11px] text-[#8a8a93]" title={t.picked != null && t.pickedBy === 'assign' ? 'Resolved without moving to In Progress — pick-up time is when it was assigned' : undefined}>{t.picked != null ? `${t.pickedBy === 'assign' ? 'assigned · ' : ''}${t.picked === t.raised ? 'on raising' : `after ${dur(t.picked - t.raised)}`}` : t.live ? `waiting ${dur(now - t.raised)}` : 'not recorded'}</span></div>
                  <div className="flex flex-col leading-tight tabular-nums"><span>{t.closed != null ? clock(t.closed) : '—'}</span><span className="text-[11px] text-[#8a8a93]">{t.closed != null ? `${wd(t.closed)} ${new Date(t.closed).getDate()}` : t.status === 'Cancelled' ? 'cancelled' : 'open'}</span></div>
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs tabular-nums"><span className="font-semibold" style={{ color: bc }}>{dur(t.taken)}{t.live ? ' so far' : ''}</span><span className="text-[#8a8a93]">of {dur(t.target)}</span></div>
                    <div className="h-[5px] overflow-hidden rounded-[3px] bg-[#f1f0ec]"><div className="h-full rounded-[3px]" style={{ width: `${Math.min(100, Math.max(2, p))}%`, background: bc }} /></div>
                  </div>
                  <span><Pill status={t.status} className="px-2 py-[3px] text-[11.5px]" /></span>
                </div>
              )
            })}
            {!L.length && <div className="p-7 text-center text-[#6b6b76]">No tickets match these filters.</div>}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-[18px] py-3">
          <span className="text-xs text-[#6b6b76]">Showing {Math.min(limit, L.length)} of {L.length}</span>
          {L.length > limit && <button onClick={() => setLimit((n) => n + 15)} className="rounded-lg border border-[#e0dfdb] bg-white px-3 py-1.5 text-[12.5px]">Show 15 more</button>}
        </div>
      </Card>

      <div className="text-[11.5px] leading-normal text-[#8a8a93]">Picked up = first status change to In progress; tickets closed without that step show no pick-up time. SLA target = raised → resolution due (working hours). Ages use real elapsed time. Approval requests are tracked in the Approval inbox and excluded here.</div>

      {dt && (
        <>
          <div onClick={() => setOpenId(null)} className="fixed inset-0 z-40 bg-[rgba(23,23,28,.28)]" />
          <aside className="fixed inset-y-0 right-0 z-[41] flex w-[min(440px,100vw)] flex-col bg-white text-[13px] shadow-[-12px_0_40px_rgba(0,0,0,.12)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#efeeea] px-[22px] pb-4 pt-5">
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex items-center gap-2"><span className="font-mono text-xs text-[#6b6b76]">{dt.hid}</span><Pill status={dt.status} /></div>
                <span className="text-base font-semibold">{dt.title}</span>
              </div>
              <button onClick={() => setOpenId(null)} className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-[#e0dfdb] bg-white text-[#55555e]" aria-label="Close"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="flex flex-1 flex-col gap-[18px] overflow-auto px-[22px] py-[18px]">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {[['Handled by', dt.who], ['Desk', DESK[dt.desk].label], ['Category', dt.cat], ['Priority', dt.prio]].map(([l, v]) => <div key={l} className="flex flex-col gap-[3px]"><span className="text-[11.5px] text-[#6b6b76]">{l}</span><span className="font-medium">{v}</span></div>)}
              </div>
              <div className="flex flex-col">
                <span className="mb-2.5 font-semibold">Lifecycle</span>
                {dt.steps.map((s) => (
                  <div key={s.l} className="grid gap-3" style={{ gridTemplateColumns: '14px minmax(0,1fr) auto' }}>
                    <div className="flex flex-col items-center"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.dot }} /><span className="min-h-[22px] w-0.5 flex-1 bg-[#ecebe7]" /></div>
                    <div className="flex flex-col gap-0.5 pb-3.5"><span className="font-medium">{s.l}</span><span className="text-xs text-[#6b6b76]">{s.t}</span></div>
                    <span className="pt-0.5 text-xs text-[#55555e]">{s.gap}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 rounded-[10px] border border-[#efeeea] p-3">
                <div className="flex justify-between"><span className="text-xs text-[#6b6b76]">Time to close vs SLA</span><span className="font-semibold" style={{ color: dt.barColor }}>{dur(dt.taken)} / {dur(dt.target)}</span></div>
                <div className="h-2 overflow-hidden rounded bg-[#f1f0ec]"><div className="h-full" style={{ width: `${dt.pct}%`, background: dt.barColor }} /></div>
                <span className="text-xs text-[#55555e]">{dt.verdict}</span>
              </div>
              <div className="flex flex-col gap-1 rounded-[10px] border border-[#efeeea] p-3">
                <span className="text-xs text-[#6b6b76]">{dt.whoFirst}’s day</span>
                <span>{dt.dayCtx}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#efeeea] px-[22px] py-3.5">
              {dt.m && <button onClick={() => { setMember(dt.m); setOpenId(null); setDay(null); setLimit(15) }} className="rounded-lg border border-[#e0dfdb] bg-white px-3 py-2 text-[12.5px]">All tickets by {dt.whoFirst}</button>}
              <button onClick={() => { const id = dt.id; setOpenId(null); onOpenTicket?.(id) }} className="rounded-lg bg-[#17171c] px-3.5 py-2 text-[12.5px] text-white">Open ticket</button>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}

'use client'

// "My dashboard" for IT and Admin members who are not team heads: their own
// queue, unallocated tickets they can claim, today's checklist, their output and an
// SLA calendar for themselves or the whole team. Team heads keep AgentDashboard.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, formatWorkingMinutes, slaRemaining } from '@/lib/appapi'
import { workingMinutesBetween } from '@/lib/sla'
import { Skeleton } from '@/components/ui/skeleton'
import { RaiseTicket } from '@/components/app/TicketsView'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  addDays,
  clearDraft,
  cutoffAt,
  dayFromSubmission,
  dowMon,
  emptyDay,
  fmtLeft,
  istKey,
  istTime,
  pl,
  readDraft,
  runsOn,
  writeDraft,
} from '@/components/app/MyKraView'

const RED = '#b42318', AMB = '#8a5a00', GRN = '#12795a', MAG = '#b3177f', TEAL = '#0f7c86'
const SLA = { over: ['#fdeaea', RED, '#d4553a'], soon: ['#fdf3dc', AMB, '#e0b44a'], ok: ['#e4f3ec', GRN, '#9fd0b8'] }
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY = 86400000

const isActive = (t) => !['Closed', 'Cancelled', 'Resolved'].includes(t.status)
const resolvedAt = (t) => t.resolved_at || t.resolution?.resolved_date || t.closed_at || null
const closedAt = (t) => (t.status === 'Closed' || t.status === 'Resolved' ? resolvedAt(t) || t.updated_at : null)
const metSla = (t) => {
  const r = resolvedAt(t)
  return t.sla_resolution_due && r ? new Date(r) <= new Date(t.sla_resolution_due) : null
}
const siteOf = (value) => (/\blotus\b/i.test(value || '') ? 'Lotus' : /\btulip\b/i.test(value || '') ? 'Tulip' : null)
const keyDate = (key) => new Date(`${key}T12:00:00Z`)
const fmtKey = (key, opts) => keyDate(key).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts })
const seg = (on) => (on ? 'bg-white text-[#17171c] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'bg-transparent text-[#6b6b76]')
const card = 'min-w-0 rounded-[13px] border border-[#e8e7e3] bg-white px-[18px] py-4'
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : null)
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

function slaState(t, now) {
  if (!t.sla_resolution_due) return 'ok'
  const due = new Date(t.sla_resolution_due)
  if (due < now) return 'over'
  return istKey(due) === istKey(now) ? 'soon' : 'ok'
}

// Last `n` Mon–Fri day keys ending today (oldest first).
function workingDays(today, n) {
  const out = []
  for (let k = today; out.length < n; k = addDays(k, -1)) if (dowMon(k) < 5) out.unshift(k)
  return out
}

function slaStats(tickets, from, to) {
  const closed = tickets.filter((t) => {
    const c = closedAt(t)
    return c && new Date(c) >= from && new Date(c) < to
  })
  const judged = closed.filter((t) => metSla(t) !== null)
  const minutes = closed.filter((t) => t.created_at && resolvedAt(t)).map((t) => workingMinutesBetween(t.created_at, resolvedAt(t)))
  return { sla: pct(judged.filter(metSla).length, judged.length), avgMin: avg(minutes), closed }
}

export default function MemberDashboard({ user, onGoTickets, onGoKra, onGoApprovals, onOpenTicket }) {
  const dept = user.role === 'admin' ? 'Admin' : 'IT'
  const [data, setData] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const [busyId, setBusyId] = useState(null)
  const [scope, setScope] = useState('mine')
  const [month, setMonth] = useState(() => istKey().slice(0, 7))
  const [sel, setSel] = useState(() => istKey())

  const load = useCallback(async () => {
    const [t, a, l, s] = await Promise.allSettled([
      api('/tickets?limit=1000'),
      api('/approvals'),
      api('/member-checklists'),
      api('/member-checklist-submissions?limit=200'),
    ])
    if (t.status === 'rejected') toast.error(t.reason?.message || 'Could not load tickets')
    setData((prev) => ({
      tickets: t.status === 'fulfilled' ? t.value.items || [] : prev?.tickets || [],
      approvals: a.status === 'fulfilled' ? a.value : prev?.approvals || [],
      lists: l.status === 'fulfilled' ? l.value : prev?.lists || [],
      subs: s.status === 'fulfilled' ? s.value : prev?.subs || [],
    }))
    setNow(new Date())
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [load])

  const today = istKey(now)
  const tickets = data?.tickets || []
  const team = useMemo(() => tickets.filter((t) => t.department === dept), [tickets, dept])
  const mine = useMemo(() => team.filter((t) => t.assignee_id === user.id), [team, user.id])
  const pendingApproval = useMemo(
    () => new Set((data?.approvals || []).filter((a) => a.status === 'Pending').map((a) => a.ticket_id)),
    [data],
  )

  const act = async (t, body, message) => {
    setBusyId(t.id)
    try {
      await api(`/tickets/${t.id}`, { method: 'PATCH', body })
      toast.success(message)
      await load()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusyId(null)
    }
  }

  if (!data)
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3">
        <Skeleton className="h-12 w-80" />
        <Skeleton className="h-24 w-full rounded-[11px]" />
        <Skeleton className="h-[360px] w-full rounded-[13px]" />
      </div>
    )

  // ---- KPIs ----
  const active = mine.filter(isActive)
  const overdue = active.filter((t) => slaState(t, now) === 'over')
  const dueToday = active.filter((t) => slaState(t, now) === 'soon').sort((a, b) => new Date(a.sla_resolution_due) - new Date(b.sla_resolution_due))
  const closedOn = (key, pool = mine) => pool.filter((t) => closedAt(t) && istKey(closedAt(t)) === key)
  const closedToday = closedOn(today).length
  const prevDays = workingDays(today, 11).slice(0, 10).filter((k) => k !== today)
  const usual = avg(prevDays.map((k) => closedOn(k).length)) || 0
  const t30 = new Date(now.getTime() - 30 * DAY), t60 = new Date(now.getTime() - 60 * DAY)
  const me30 = slaStats(mine, t30, now), mePrev = slaStats(mine, t60, t30), team30 = slaStats(team, t30, now)
  const delta = (a, b, unit, lowerIsBetter) => {
    if (a == null || b == null) return ['', GRN]
    const diff = a - b
    if (Math.abs(diff) < (unit === 'h' ? 0.05 : 1)) return ['', GRN]
    const good = lowerIsBetter ? diff < 0 : diff > 0
    const v = unit === 'h' ? `${Math.abs(diff / 60).toFixed(1)}h` : `${Math.abs(Math.round(diff))} pts`
    return [`${diff > 0 ? '▲' : '▼'} ${v}`, good ? GRN : RED]
  }
  const [slaD, slaDc] = delta(me30.sla, mePrev.sla, 'pts')
  const [avgD, avgDc] = delta(me30.avgMin, mePrev.avgMin, 'h', true)
  const kpis = [
    { l: 'My active tickets', v: active.length, d: overdue.length ? `${overdue.length} overdue` : '', dc: RED, s: active.length ? 'in progress, open or waiting' : 'queue clear', c: '#17171c' },
    { l: 'Due today', v: dueToday.length, d: '', dc: AMB, s: dueToday.length ? `next at ${istTime(dueToday[0].sla_resolution_due)}` : 'nothing due today', c: dueToday.length ? AMB : '#17171c' },
    { l: 'Closed today', v: closedToday, d: usual && closedToday > usual ? '▲ above usual' : '', dc: GRN, s: `you usually close ${usual ? usual.toFixed(1) : 0} a day`, c: '#17171c' },
    { l: 'Resolution SLA · 30 days', v: me30.sla == null ? '—' : `${me30.sla}%`, d: slaD, dc: slaDc, s: team30.sla == null ? 'no closed tickets yet' : `${dept} team ${team30.sla}%`, c: me30.sla == null ? '#17171c' : me30.sla >= (team30.sla ?? 0) ? GRN : AMB },
    {
      l: 'Avg resolution',
      v: me30.avgMin == null ? '—' : formatWorkingMinutes(me30.avgMin),
      d: avgD,
      dc: avgDc,
      s: team30.avgMin == null ? 'working time, 30 days' : `${me30.avgMin == null ? '' : me30.avgMin < team30.avgMin ? 'faster than ' : me30.avgMin > team30.avgMin ? 'slower than ' : 'same as '}team avg ${formatWorkingMinutes(team30.avgMin)}`,
      c: '#17171c',
    },
  ]

  // ---- queue ----
  const rank = { over: 0, soon: 1, ok: 2 }
  const queue = active
    .map((t) => ({ t, st: slaState(t, now), locked: pendingApproval.has(t.id) }))
    .sort((a, b) => rank[a.st] - rank[b.st] || new Date(a.t.sla_resolution_due || 8.64e15) - new Date(b.t.sla_resolution_due || 8.64e15))
  const slaLabel = (t, st) => {
    if (!t.sla_resolution_due) return 'No SLA'
    if (st === 'over') return slaRemaining(t.sla_resolution_due).text
    if (st === 'soon') return `Due ${istTime(t.sla_resolution_due)} · ${slaRemaining(t.sla_resolution_due).text}`
    return `Due ${fmtKey(istKey(t.sla_resolution_due), { weekday: 'short', day: 'numeric', month: 'short' })}`
  }
  const mySite = siteOf(user.location)
  const grabs = team
    .filter((t) => isActive(t) && !t.assignee_id && (dept === 'Admin' || !siteOf(t.routing_site || t.location) || siteOf(t.routing_site || t.location) === mySite))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const age = (t) => {
    const ms = now - new Date(t.created_at)
    return ms >= DAY ? `${Math.floor(ms / DAY)}d` : `${Math.max(1, Math.floor(ms / 3600000))}h`
  }

  // ---- output ----
  const barDays = workingDays(today, 10)
  const counts = barDays.map((k) => closedOn(k).length)
  const mx = Math.max(1, ...counts)
  const mixMap = new Map()
  for (const t of me30.closed) mixMap.set(t.category || 'Other', (mixMap.get(t.category || 'Other') || 0) + 1)
  const mix = [...mixMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  const firstName = user.name.split(' ')[0]
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(now))
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const kraList = data.lists.find((l) => l.active !== false) || data.lists[0]

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-3 text-[13px] text-[#17171c]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[3px]">
          <h2 className="m-0 text-[22px] font-semibold tracking-[-.01em]">{greeting}, {firstName}</h2>
          <div className="text-[12.5px] text-[#6b6b76]">
            {fmtKey(today, { weekday: 'long' })}, {fmtKey(today, { day: 'numeric', month: 'short' })} · {active.length} active · {dueToday.length} due today
            <KraHeadline list={kraList} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onGoTickets} className="rounded-[9px] border border-[#e0dfdb] bg-white px-3 py-2 text-[12.5px] text-[#17171c]">Open my board</button>
          <RaiseTicket user={user} onCreated={load} trigger={<button className="rounded-[9px] bg-[#b3177f] px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-[#8a0f61]">+ Raise ticket</button>} />
        </div>
      </header>

      <section className="flex flex-wrap gap-2">
        {kpis.map((k) => (
          <div key={k.l} className="flex min-w-0 flex-[1_1_160px] flex-col gap-1 rounded-[11px] border border-[#e8e7e3] bg-white px-[15px] py-3">
            <span className="text-[11.5px] text-[#6b6b76]">{k.l}</span>
            <div className="flex items-baseline gap-[7px]">
              <span className="text-[22px] font-semibold tracking-[-.02em]" style={{ color: k.c }}>{k.v}</span>
              {k.d && <span className="text-[11.5px] font-semibold" style={{ color: k.dc }}>{k.d}</span>}
            </div>
            <span className="text-[11.5px] leading-[1.35] text-[#8a8a93]">{k.s}</span>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap items-stretch gap-3">
        <div className={`${card} flex flex-[1_1_420px] flex-col gap-2.5`}>
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex flex-col gap-0.5"><h3 className="m-0 text-sm font-semibold">My queue</h3><span className="text-xs text-[#6b6b76]">Most urgent first</span></div>
            <button onClick={onGoTickets} className="bg-transparent text-[12.5px] text-[#b3177f] hover:underline">Board →</button>
          </div>
          {queue.slice(0, 6).map(({ t, st, locked }) => {
            const [bg, fg, edge] = SLA[st]
            const start = t.status === 'Open'
            return (
              <div key={t.id} className="grid grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-[11px] rounded-[9px] border border-[#efeeea] px-2.5 py-[9px]">
                <span className="self-stretch rounded-sm" style={{ background: edge }} />
                <button onClick={() => onOpenTicket(t.id)} className="flex min-w-0 flex-col gap-0.5 bg-transparent text-left">
                  <span className="truncate font-semibold">{t.title}</span>
                  <span className="truncate text-[11.5px] text-[#8a8a93]"><span className="font-mono">{t.human_id}</span> · {t.category} · {locked ? 'Waiting approval' : t.status}</span>
                </button>
                <div className="flex flex-col items-end gap-[5px]">
                  <span className="whitespace-nowrap rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold" style={{ background: bg, color: fg }}>{slaLabel(t, st)}</span>
                  {locked ? (
                    <button onClick={onGoApprovals} className="bg-transparent text-[11.5px] text-[#b3177f] hover:underline">Waiting approval</button>
                  ) : (
                    <button
                      disabled={busyId === t.id}
                      onClick={() =>
                        start
                          ? act(t, { status: 'In Progress' }, `${t.human_id} moved to In progress`)
                          : act(t, { resolution: { summary: 'Resolved from my dashboard', action_taken: 'Issue completed by assigned member', root_cause: '' } }, `${t.human_id} resolved`)
                      }
                      className="rounded-md border border-[#e0dfdb] bg-white px-[9px] py-[3px] text-[11.5px] disabled:opacity-50"
                    >
                      {start ? 'Start' : 'Resolve'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {queue.length > 6 && <button onClick={onGoTickets} className="bg-transparent text-left text-xs text-[#6b6b76] hover:underline">+ {queue.length - 6} more on your board</button>}
          {!queue.length && <div className="rounded-[9px] border border-dashed border-[#d6d4ce] p-3.5 text-center font-medium text-[#12795a]">Queue clear — nice work.</div>}
          <div className="flex flex-col gap-1.5 border-t border-[#f1f0ec] pt-2.5">
            <span className="text-[11.5px] text-[#6b6b76]">Up for grabs · unallocated{grabs.length > 4 ? ` · ${grabs.length}` : ''}</span>
            {grabs.slice(0, 4).map((t) => {
              const sla = t.sla_resolution_due ? slaRemaining(t.sla_resolution_due) : null
              return (
                <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2.5">
                  <button onClick={() => onOpenTicket(t.id)} className="flex min-w-0 flex-col bg-transparent text-left">
                    <span className="truncate">{t.title}</span>
                    <span className="text-[11px] text-[#8a8a93]">{t.category} · waiting {age(t)}</span>
                  </button>
                  {sla ? (
                    <span className="whitespace-nowrap rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold" style={sla.breach ? { background: '#fdeaea', color: RED } : { background: '#fdf3dc', color: AMB }}>{sla.text}</span>
                  ) : <span />}
                  <button
                    disabled={busyId === t.id}
                    onClick={() => act(t, { assignee_id: user.id }, `${t.human_id} claimed · now in your queue`)}
                    className="rounded-md border border-dashed border-[#b9a7ee] bg-[#f6f3fe] px-2.5 py-1 text-[11.5px] font-medium text-[#5b3fc4] disabled:opacity-50"
                  >
                    Claim
                  </button>
                </div>
              )
            })}
            {!grabs.length && <span className="text-xs text-[#9a9aa3]">Nothing unallocated.</span>}
          </div>
        </div>

        <KraCard list={kraList} subs={data.subs} now={now} onGoKra={onGoKra} onSaved={load} />

        <div className={`${card} flex flex-[1_1_330px] flex-col gap-3`}>
          <div className="flex flex-col gap-0.5"><h3 className="m-0 text-sm font-semibold">My output</h3><span className="text-xs text-[#6b6b76]">Tickets closed · last 10 working days</span></div>
          <div className="flex h-[92px] items-end gap-[5px] border-b border-[#e8e7e3]">
            {barDays.map((k, i) => {
              const isToday = k === today
              return (
                <div key={k} title={`${fmtKey(k, { weekday: 'short', day: 'numeric', month: 'short' })} · ${counts[i]} closed`} className="flex h-full flex-1 flex-col items-center justify-end gap-[3px]">
                  <span className="text-[10.5px] font-semibold" style={{ color: isToday ? MAG : '#3b3b44' }}>{counts[i]}</span>
                  <div className="w-full rounded-t" style={{ height: Math.round((counts[i] / mx) * 66) + 4, background: isToday ? MAG : TEAL }} />
                </div>
              )
            })}
          </div>
          <div className="-mt-1.5 flex gap-[5px]">
            {barDays.map((k) => <span key={k} className="min-w-0 flex-1 whitespace-nowrap text-center text-[10px]" style={k === today ? { color: MAG, fontWeight: 600 } : { color: '#9a9aa3' }}>{k === today ? <><span className="sm:hidden">Now</span><span className="hidden sm:inline">Today</span></> : Number(k.slice(8))}</span>)}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11.5px] text-[#6b6b76]">What I closed · 30 days</span>
            {mix.map(([l, v]) => (
              <div key={l} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_26px] items-center gap-2.5">
                <span className="truncate text-xs">{l}</span>
                <div className="h-[7px] overflow-hidden rounded bg-[#f1f0ec]"><div className="h-full rounded bg-[#0f7c86]" style={{ width: `${(v / mix[0][1]) * 100}%` }} /></div>
                <span className="text-right text-xs font-semibold">{v}</span>
              </div>
            ))}
            {!mix.length && <span className="text-xs text-[#9a9aa3]">Nothing closed in the last 30 days.</span>}
          </div>
        </div>
      </section>

      <SlaCalendar
        dept={dept}
        mine={mine}
        team={team}
        now={now}
        today={today}
        scope={scope}
        setScope={setScope}
        month={month}
        setMonth={setMonth}
        sel={sel}
        setSel={setSel}
        pendingApproval={pendingApproval}
        onOpenTicket={onOpenTicket}
      />
    </div>
  )
}

function KraHeadline({ list }) {
  if (!list) return null
  const sub = list.today_submission
  const due = (list.items || []).filter((it) => (list.due_item_keys ? list.due_item_keys.includes(it.key) : true))
  if (sub) return <> · Checklist {sub.applicable_done ?? sub.done_count}/{sub.applicable_total ?? sub.total} submitted</>
  const day = readDraft(list) || emptyDay()
  const applicable = due.filter((it) => !day.na[it.key])
  return <> · Checklist {applicable.filter((it) => day.ticks[it.key]).length}/{applicable.length}</>
}

function KraCard({ list, subs, now, onGoKra, onSaved }) {
  const [day, setDay] = useState(emptyDay)
  const [needReason, setNeedReason] = useState(false)
  const [busy, setBusy] = useState(false)
  const sub = list?.today_submission || null
  const seedKey = `${list?.id}|${sub?.submitted_at || ''}`
  useEffect(() => {
    if (!list) return
    setDay(sub ? dayFromSubmission(list, sub) : readDraft(list) || emptyDay())
    setNeedReason(false)
  }, [seedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the shared draft in sync with My Checklist (same storage key).
  useEffect(() => {
    if (list && !sub) writeDraft(list, day)
  }, [day]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!list)
    return (
      <div className={`${card} flex flex-[1_1_330px] flex-col items-start gap-3`}>
        <h3 className="m-0 text-sm font-semibold">My Checklist · today</h3>
        <span className="leading-normal text-[#55555e]">You haven’t set up a daily checklist yet. List the work you do every working day and tick it off here.</span>
        <button onClick={onGoKra} className="rounded-lg bg-[#17171c] px-3.5 py-2 text-[12.5px] text-white">Set up my checklist</button>
      </div>
    )

  const today = list.today || istKey(now)
  const deadline = cutoffAt(today)
  const past = now > deadline
  const due = (list.items || []).filter((it) => (list.due_item_keys ? list.due_item_keys.includes(it.key) : true))
  const applicable = due.filter((it) => !day.na[it.key])
  const doneN = applicable.filter((it) => day.ticks[it.key]).length
  const total = applicable.length
  const full = total > 0 && doneN === total
  const left = applicable.filter((it) => !day.ticks[it.key])
  const locked = !!sub

  // Streak of consecutive submitted working days for this checklist.
  const submitted = new Set(subs.filter((s) => s.checklist_id === list.id).map((s) => s.date))
  if (sub) submitted.add(today)
  const start = list.created_at ? istKey(list.created_at) : today
  let streak = 0
  for (let k = today, i = 0; k >= start && i < 400; k = addDays(k, -1), i++) {
    if (!runsOn(list, k)) continue
    if (submitted.has(k)) streak++
    else if (k === today && !past) continue
    else break
  }

  const st = sub
    ? [`Submitted · ${sub.status === 'Completed' ? 'Complete' : sub.status}`, '#e4f3ec', GRN]
    : past
      ? ['Missed cut-off', '#fdeaea', RED]
      : full
        ? ['Ready', '#e4f3ec', GRN]
        : doneN
          ? ['Partial', '#fdf3dc', AMB]
          : ['Not started', '#f1f0ec', '#55555e']
  const pctDone = total ? doneN / total : 0
  const streakText = streak ? `You’re on a ${streak}-day streak.` : 'Submit today to start a streak.'

  const submit = async () => {
    if (!total && !day.extras.length) return toast.error('Nothing applicable to submit')
    if (!full && !day.remark.trim()) {
      setNeedReason(true)
      return toast.error('Add a short reason for the unticked items')
    }
    setBusy(true)
    try {
      const responses = due.map((it) => ({ key: it.key, item: it.label, done: !!day.ticks[it.key] && !day.na[it.key], na: !!day.na[it.key], remark: day.notes[it.key] || '' }))
      const result = await api(`/member-checklists/${list.id}/submit`, {
        method: 'POST',
        body: { responses, extra_items: day.extras.map((item) => ({ item, done: true })), remark: full ? '' : day.remark.trim() },
      })
      clearDraft(list)
      toast.success(`Checklist submitted · ${result.status === 'Completed' ? 'Complete' : result.status}`)
      await onSaved()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${card} flex flex-[1_1_330px] flex-col gap-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <h3 className="m-0 text-sm font-semibold">My Checklist · today</h3>
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: st[1], color: st[2] }}>{st[0]}</span>
        </div>
        <span className="text-xs text-[#6b6b76]">{past ? 'Cut-off 7 PM passed' : `Cut-off 7 PM · ${fmtLeft(deadline - now)}`}</span>
      </div>
      <div className="flex items-center gap-3.5">
        <div className="grid h-[70px] w-[70px] flex-none place-items-center rounded-full" style={{ background: `conic-gradient(${full ? GRN : MAG} ${Math.round(pctDone * 360)}deg,var(--ring-track) 0)` }}>
          <div className="flex h-[54px] w-[54px] flex-col items-center justify-center rounded-full bg-white leading-[1.1]">
            <span className="text-[15px] font-semibold">{doneN}</span>
            <span className="text-[10px] text-[#8a8a93]">of {total}</span>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="font-semibold">{sub ? `Submitted at ${istTime(sub.submitted_at)}` : full ? 'All items ticked' : `${pl(left.length, 'item')} left`}</span>
          <span className="text-xs leading-[1.4] text-[#55555e]">
            {sub ? streakText : full ? `Submit before 7:00 PM. ${streakText}` : `Tick them or mark N/A in My Checklist, then submit. ${streakText}`}
          </span>
        </div>
      </div>
      {!locked && (
        <div className="flex flex-col gap-1">
          {left.slice(0, 4).map((it) => (
            <button
              key={it.key}
              onClick={() => setDay((d) => ({ ...d, ticks: { ...d.ticks, [it.key]: true } }))}
              className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-[9px] rounded-lg bg-[#fbfaf8] px-[9px] py-[7px] text-left"
            >
              <span className="mt-px box-border h-4 w-4 rounded border-[1.5px] border-[#cfcdc6]" />
              <span className="leading-[1.4]">{it.label}</span>
            </button>
          ))}
          {left.length > 4 && <button onClick={onGoKra} className="bg-transparent px-[9px] py-0.5 text-left text-xs text-[#8a8a93] hover:underline">+ {left.length - 4} more unticked — open My Checklist</button>}
          {doneN > 0 && (
            <button onClick={() => setDay((d) => ({ ...d, ticks: {} }))} className="bg-transparent px-[9px] py-0.5 text-left text-xs text-[#8a8a93]" title="Untick all">
              + {pl(doneN, 'item')} already ticked
            </button>
          )}
        </div>
      )}
      {due.length > 12 && !locked && (
        <span className="rounded-lg bg-[#fdf7e8] px-2.5 py-2 text-xs leading-[1.45] text-[#8a5a00]">You have {due.length} items due today. A shorter list makes “Complete” easier to reach — move occasional ones to weekly in My Checklist.</span>
      )}
      {needReason && !locked && !full && (
        <textarea
          value={day.remark}
          onChange={(e) => { const v = e.target.value; setDay((d) => ({ ...d, remark: v })) }}
          rows={2}
          placeholder={`Why ${left.length === 1 ? 'is 1 item' : `are ${left.length} items`} not done? Your manager sees this.`}
          className="resize-y rounded-lg border border-[#e0dfdb] bg-white px-2.5 py-2 text-[12.5px] text-[#17171c] outline-none"
        />
      )}
      <div className="mt-auto flex gap-2">
        <button
          onClick={submit}
          disabled={locked || busy}
          className="flex-1 rounded-lg px-3 py-[9px] text-[12.5px] font-medium text-white disabled:cursor-default"
          style={{ background: locked ? '#9fd0b8' : '#17171c' }}
        >
          {locked ? 'Submitted ✓' : full ? `Submit checklist${past ? ' (late)' : ''}` : `Submit as partial · ${doneN}/${total}`}
        </button>
        <button onClick={onGoKra} className="rounded-lg border border-[#e0dfdb] bg-white px-3 py-2 text-[12.5px] text-[#17171c]">Open</button>
      </div>
    </div>
  )
}

function SlaCalendar({ dept, mine, team, now, today, scope, setScope, month, setMonth, sel, setSel, pendingApproval, onOpenTicket }) {
  const pool = scope === 'team' ? team : mine
  // Index tickets by the IST day their SLA fell due / they were closed.
  const byDay = useMemo(() => {
    const map = new Map()
    const add = (key, kind, t) => {
      if (!map.has(key)) map.set(key, { breached: [], due: [], met: [] })
      map.get(key)[kind].push(t)
    }
    for (const t of pool) {
      if (t.status === 'Cancelled') continue
      const dueAt = t.sla_resolution_due ? new Date(t.sla_resolution_due) : null
      const met = metSla(t)
      if (dueAt) {
        const k = istKey(dueAt)
        if (isActive(t)) add(k, dueAt < now ? 'breached' : 'due', t)
        else if (met === false) add(k, 'breached', t)
      }
      if (met === true) add(istKey(closedAt(t)), 'met', t)
    }
    return map
  }, [pool, now])

  const first = `${month}-01`
  const startKey = addDays(first, -dowMon(first))
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)
  const endKey = addDays(lastDay, 6 - dowMon(lastDay))
  const cells = []
  for (let k = startKey; k <= endKey; k = addDays(k, 1)) cells.push(k)
  const thisMonth = today.slice(0, 7)
  const monthBreaches = [...byDay.entries()].filter(([k]) => k.startsWith(month)).flatMap(([k, v]) => v.breached.map(() => dowMon(k)))

  const d = byDay.get(sel) || { breached: [], due: [], met: [] }
  const items = [
    ...d.breached.map((t) => ({ t, s: 'Breached', bg: '#fdeaea', fg: RED })),
    ...d.due.map((t) => ({ t, s: `Due ${istTime(t.sla_resolution_due)}`, bg: '#fdf3dc', fg: AMB })),
    ...(scope === 'mine' ? d.met.map((t) => ({ t, s: 'On time', bg: '#e4f3ec', fg: GRN })) : []),
  ]
  const sub = scope === 'team'
    ? `${d.breached.length} breached · ${d.due.length} due · ${d.met.length} closed on time`
    : d.met.length && !d.breached.length && !d.due.length
      ? `You closed ${pl(d.met.length, 'ticket')}, all within SLA`
      : `${d.breached.length} breached · ${d.due.length} due · ${d.met.length} closed on time`
  let note = ''
  if (scope === 'mine' && sel === today) {
    const blocked = mine.filter((t) => isActive(t) && pendingApproval.has(t.id) && t.sla_resolution_due && new Date(t.sla_resolution_due) < now)
    if (blocked.length) note = `${blocked.map((t) => t.human_id).join(', ')} ${blocked.length === 1 ? 'is' : 'are'} overdue but waiting on an approval, not on you.`
  } else if (scope === 'team' && monthBreaches.length >= 3) {
    const tally = DOW.map((_, i) => monthBreaches.filter((x) => x === i).length)
    const top = tally.indexOf(Math.max(...tally))
    note = `${tally[top]} of ${monthBreaches.length} breaches this month fell due on a ${DOW[top]}.`
  }

  return (
    <section className="flex flex-wrap items-stretch gap-3">
      <div className={`${card} flex flex-[1_1_620px] flex-col gap-3`}>
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <button disabled={month <= addDays(`${thisMonth}-01`, -330).slice(0, 7)} onClick={() => setMonth(addDays(`${month}-01`, -1).slice(0, 7))} aria-label="Previous month" className="grid h-7 w-7 place-items-center rounded-md border border-[#e0dfdb] bg-white disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <div className="flex flex-col gap-0.5">
              <h3 className="m-0 text-sm font-semibold">SLA calendar · {fmtKey(first, { month: 'long' })}</h3>
              <span className="text-xs text-[#6b6b76]">{scope === 'team' ? `All ${dept} tickets — where SLAs were breached and what’s due` : 'Your tickets — closed on time, and what’s coming due'}</span>
            </div>
            <button disabled={month >= addDays(`${thisMonth}-28`, 35).slice(0, 7)} onClick={() => setMonth(addDays(lastDay, 1).slice(0, 7))} aria-label="Next month" className="grid h-7 w-7 place-items-center rounded-md border border-[#e0dfdb] bg-white disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2.5 text-[11px] text-[#55555e]">
              {[['Breached', '#d4553a'], ['Due', '#e0b44a'], ['Closed on time', '#9fd0b8']].map(([l, c]) => (
                <span key={l} className="flex items-center gap-[5px]"><span className="h-[9px] w-[9px] rounded-sm" style={{ background: c }} />{l}</span>
              ))}
            </div>
            <div className="flex gap-0.5 rounded-lg bg-[#efeeea] p-[3px]">
              {[['mine', 'Mine'], ['team', `${dept} team`]].map(([k, l]) => (
                <button key={k} onClick={() => setScope(k)} className={`rounded-md px-[11px] py-[5px] text-xs font-medium ${seg(scope === k)}`}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="grid grid-cols-7 gap-[3px] sm:min-w-[520px] sm:grid-cols-[repeat(5,minmax(0,1fr))_repeat(2,minmax(0,.75fr))] sm:gap-[5px]">
            {DOW.map((h) => <span key={h} className="pl-1 text-[10.5px] text-[#9a9aa3]">{h}</span>)}
            {cells.map((k) => {
              const inMonth = k.startsWith(month)
              const weekend = dowMon(k) >= 5
              const isToday = k === today
              const v = byDay.get(k) || { breached: [], due: [], met: [] }
              const pills = []
              if (v.breached.length) pills.push([`${v.breached.length} breached`, '#d4553a', '#fff', `${v.breached.length}!`])
              if (v.due.length) pills.push([`${v.due.length} due`, '#e0b44a', '#fff', `${v.due.length}`])
              if (scope === 'mine' && v.met.length) pills.push([`${v.met.length} ✓`, '#e4f3ec', GRN, `${v.met.length}✓`])
              const n = Number(k.slice(8))
              return (
                <button
                  key={k}
                  onClick={() => setSel(k)}
                  title={fmtKey(k, { weekday: 'short', day: 'numeric', month: 'short' })}
                  className={`box-border flex h-12 min-w-0 flex-col items-start justify-between overflow-hidden rounded-lg px-1 py-1 text-left sm:h-[54px] sm:px-[7px] sm:py-[5px] ${isToday ? 'border-[1.5px] border-[#b3177f] bg-[#fdf5fa]' : weekend ? 'border border-[#efeeea] bg-[#fafaf8]' : 'border border-[#efeeea] bg-white'}`}
                  style={{ opacity: inMonth ? 1 : 0.5, outline: sel === k && !isToday ? '2px solid #17171c' : 'none', outlineOffset: 1 }}
                >
                  <span className="max-w-full truncate text-[11px] sm:text-[11.5px]" style={{ fontWeight: isToday ? 700 : 500, color: isToday ? MAG : inMonth ? '#3b3b44' : '#9a9aa3' }}>
                    {isToday ? <>{n}<span className="hidden sm:inline"> · Today</span></> : n === 1 ? <>{n}<span className="hidden sm:inline"> {fmtKey(k, { month: 'short' })}</span></> : n}
                  </span>
                  <span className="flex flex-wrap gap-[3px]">
                    {pills.map(([label, bg, fg, short]) => <span key={label} title={label} className="max-w-full truncate whitespace-nowrap rounded px-[3px] py-px text-[10px] font-semibold sm:px-[5px] sm:text-[10.5px]" style={{ background: bg, color: fg }}><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></span>)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className={`${card} flex flex-[1_1_320px] flex-col gap-2.5`}>
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">{fmtKey(sel, { weekday: 'short', day: 'numeric', month: 'short' })}{sel === today ? ' · today' : ''}</span>
          <span className="text-xs text-[#6b6b76]">{sub}</span>
        </div>
        {items.slice(0, 12).map(({ t, s, bg, fg }) => (
          <button key={`${t.id}-${s}`} onClick={() => onOpenTicket(t.id)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-b border-[#f4f3f0] bg-transparent py-2 text-left">
            <div className="flex min-w-0 flex-col gap-px">
              <span className="truncate font-medium">{t.title}</span>
              <span className="text-[11.5px] text-[#8a8a93]"><span className="font-mono">{t.human_id}</span> · {t.assignee_name || (t.assignee_id ? 'Assigned' : 'Unallocated')}</span>
            </div>
            <span className="whitespace-nowrap rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold" style={{ background: bg, color: fg }}>{s}</span>
          </button>
        ))}
        {items.length > 12 && <span className="text-xs text-[#8a8a93]">+ {items.length - 12} more</span>}
        {!items.length && <span className="py-2.5 text-[12.5px] text-[#9a9aa3]">{d.met.length ? 'Nothing breached or due — every ticket closed on time.' : 'Nothing due or breached this day.'}</span>}
        {note && <span className="mt-auto rounded-lg bg-[#f7f6f3] px-2.5 py-2 text-xs leading-normal text-[#3b3b44]">{note}</span>}
      </div>
    </section>
  )
}

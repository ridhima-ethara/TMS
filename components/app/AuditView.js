'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/appapi'
import { Skeleton } from '@/components/ui/skeleton'
import { AppSelect } from '@/components/ui/select'
import { toast } from 'sonner'
import { compareText } from '@/lib/sort'

const TZ = 'Asia/Kolkata'
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
const ROWS_STEP = 300
const COLS = '70px minmax(170px,1.2fr) 80px minmax(220px,2fr) 170px'
const ROLE_C = { it: ['#2f6bd0', '#e8f0fc'], admin: ['#12795a', '#e4f3ec'], super_admin: ['#8a0f61', '#fbe9f4'], employee: ['#55555e', '#f1f0ec'], system: ['#55555e', '#f1f0ec'] }
const KIND_C = { Tickets: '#2f6bd0', Checklist: '#12795a', Approvals: '#c8871b', 'Sign-ins': '#9a9894', 'Settings & access': '#8a0f61', System: '#d4553a', Other: '#b9b7b0' }
const KNOWN = {
  'ticket.create': 'Created ticket',
  'ticket.update': 'Updated ticket',
  'ticket.delete': 'Deleted ticket',
  'ticket.sla.resolution.breached': 'Resolution SLA breached',
  'ticket.sla.response.breached': 'Response SLA breached',
  'member_checklist.submit': 'Submitted daily checklist',
  'member_checklist.create': 'Created checklist',
  'member_checklist.overdue': 'Marked checklist overdue',
  'member_checklist.remind_pending': 'Sent checklist reminders',
  login: 'Signed in',
  register: 'Registered account',
  'user.settings.update': 'Changed member settings',
  'category.create': 'Added category',
  'category.update': 'Changed category',
  'category.merge': 'Merged categories',
  'settings.sla.update': 'Changed SLA rules',
  'settings.access_review': 'Recorded access review',
  'approval.submit': 'Submitted approval request',
  'approval.decision': 'Decided approval',
  'approval.email_decision': 'Decided approval by email',
  'attachment.upload': 'Uploaded attachment',
}
const labelOf = (action) => KNOWN[action] || action.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const kindOf = (action) =>
  /^ticket\.sla|overdue|breach/.test(action) ? 'System'
    : /^(ticket|attachment)\./.test(action) ? 'Tickets'
      : /^member_checklist\./.test(action) ? 'Checklist'
        : /^approval\./.test(action) ? 'Approvals'
          : /^(login|logout|register|auth\.)/.test(action) ? 'Sign-ins'
            : /^(user|settings|category)\./.test(action) ? 'Settings & access'
              : /^(firewall|system|sla)\./.test(action) ? 'System'
                : 'Other'
const colorOf = (action) => (action === 'ticket.update' ? '#7aa3e6' : KIND_C[kindOf(action)])
const isSensitive = (item) =>
  /delete|merge|export|settings\.|role/.test(item.action) || (item.action === 'user.settings.update' && (item.details?.role !== undefined || item.details?.active !== undefined))
const istDay = (value) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
const istHour = (value) => Number(new Date(value).toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }))
const clock = (value) => new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const dayLabel = (key, today) => {
  const d = new Date(`${key}T12:00:00+05:30`)
  const text = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })
  return key === today ? `Today · ${text}` : text
}
const initials = (name = '') => (name === 'system' ? 'SY' : name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase())
const PERIODS = [['2', 'Last 2 days'], ['7', 'Last 7 days'], ['30', 'Last 30 days']]

export default function AuditView({ onOpenTicket }) {
  const [period, setPeriod] = useState('2')
  const [data, setData] = useState(null)
  const [accounts, setAccounts] = useState(null)
  const [q, setQ] = useState('')
  const [actor, setActor] = useState('')
  const [kind, setKind] = useState('')
  const [limit, setLimit] = useState(ROWS_STEP)
  const today = istDay(new Date())
  const from = useMemo(() => {
    const d = new Date(`${today}T12:00:00+05:30`)
    d.setUTCDate(d.getUTCDate() - (Number(period) - 1))
    return istDay(d)
  }, [period, today])

  const load = useCallback(() => {
    setData(null)
    // The API's date bounds are server-local (UTC); fetch a day early so the
    // first IST morning is included, then trim to IST days below.
    const early = new Date(`${from}T12:00:00+05:30`)
    early.setUTCDate(early.getUTCDate() - 1)
    api(`/audit?from=${istDay(early)}&to=${today}&limit=5000`)
      .then(setData)
      .catch((error) => toast.error(error.message))
  }, [from, today])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    api('/users').then((users) => setAccounts(users.filter((u) => u.active !== false).length)).catch(() => {})
  }, [])
  useEffect(() => { setLimit(ROWS_STEP) }, [q, actor, kind, period])

  const model = useMemo(() => {
    if (!data) return null
    // The API filters by server-local dates; re-scope to IST days here.
    const items = (data.items || []).filter((item) => istDay(item.created_at) >= from).map((item) => ({ ...item, day: istDay(item.created_at), kind: kindOf(item.action) }))
    const todayItems = items.filter((item) => item.day === today)
    // Merge create + update on the same ticket by the same person within 2 min.
    const merged = []
    const absorbed = new Set()
    const byTicket = new Map()
    items.forEach((item) => {
      if (item.action === 'ticket.create' && item.ticket_id) byTicket.set(`${item.ticket_id}|${item.actor_id}`, item)
    })
    items.forEach((item) => {
      if (item.action === 'ticket.update' && item.ticket_id) {
        const created = byTicket.get(`${item.ticket_id}|${item.actor_id}`)
        if (created && Math.abs(new Date(item.created_at) - new Date(created.created_at)) <= 2 * 60000) {
          absorbed.add(created.id)
          return
        }
      }
      merged.push(item)
    })
    // Sign-ins followed by nothing else that day.
    const laterWork = new Map()
    items.forEach((item) => {
      if (item.kind === 'Sign-ins') return
      const key = `${item.actor_id}|${item.day}`
      const t = new Date(item.created_at).getTime()
      laterWork.set(key, Math.max(laterWork.get(key) || 0, t))
    })
    const creates = todayItems.filter((i) => i.action === 'ticket.create')
    const byAgents = creates.filter((i) => ['it', 'admin', 'super_admin'].includes(i.actor_role))
    const overdue = items.filter((i) => i.action === 'member_checklist.overdue')
    const lastOverdue = overdue[0]
    const sensitive = items.filter(isSensitive)
    const peopleToday = new Set(todayItems.filter((i) => i.actor_id !== 'system').map((i) => i.actor_id))
    const actors = [...new Set(items.filter((i) => i.actor_name && i.actor_name !== 'system').map((i) => i.actor_name))].sort(compareText)
    const superLogins = items.filter((i) => i.action === 'login' && i.actor_role === 'super_admin')
    return { items, merged, absorbed, laterWork, todayItems, creates, byAgents, overdue, lastOverdue, sensitive, peopleToday, actors, superLogins }
  }, [data, from, today])

  if (!model) return <Skeleton className="h-[640px] w-full rounded-xl" />
  const { items, merged, absorbed, laterWork, todayItems, creates, byAgents, overdue, lastOverdue, sensitive, peopleToday, actors, superLogins } = model
  const periodLabel = `${dayLabel(from, '').replace(/^\w+ /, '')} – ${dayLabel(today, '').replace(/^\w+ /, '')} ${today.slice(0, 4)}`

  const kpis = [
    { l: 'Events today', v: todayItems.length, s: `${items.length} across ${period} days`, c: '#17171c' },
    { l: 'People active today', v: peopleToday.size, s: accounts != null ? `of ${accounts} accounts` : 'signed-in members', c: '#17171c' },
    { l: 'Tickets logged by agents', v: `${byAgents.length} of ${creates.length}`, s: creates.length ? `${Math.round((byAgents.length / creates.length) * 100)}% raised by IT/Admin staff, not requesters` : 'no tickets created today', c: creates.length && byAgents.length === creates.length ? '#8a5a00' : '#17171c' },
    { l: 'Checklist overdue flags', v: overdue.length, s: lastOverdue ? `auto-raised ${dayLabel(lastOverdue.day, today).replace('Today · ', '')} ${clock(lastOverdue.created_at)}` : 'none in this period', c: overdue.length ? '#b42318' : '#12795a' },
    { l: 'Sensitive changes', v: sensitive.length, s: 'roles, deletions, merges, settings', c: sensitive.length ? '#8a5a00' : '#12795a' },
  ]

  // Heatmap: today, per person, per hour.
  const nowHour = istHour(new Date())
  const heatActors = [...new Set(todayItems.filter((i) => i.actor_name !== 'system').map((i) => i.actor_name))]
  const heat = heatActors
    .map((name) => {
      const mine = todayItems.filter((i) => i.actor_name === name)
      return {
        name,
        total: mine.length,
        cells: HOURS.map((h) => {
          const n = mine.filter((i) => istHour(i.created_at) === h).length
          const future = h > nowHour
          return { h, n, future }
        }),
      }
    })
    .sort((a, b) => b.total - a.total)

  const base = items.filter((i) => !actor || i.actor_name === actor)
  const kindCounts = Object.keys(KIND_C).map((k) => ({ k, n: base.filter((i) => i.kind === k).length })).filter((x) => x.n || x.k === kind)
  const mixMax = Math.max(1, ...kindCounts.map((x) => x.n))
  const sensitiveNote = sensitive.length
    ? `${sensitive.length} sensitive change${sensitive.length === 1 ? '' : 's'} in this period: ${[...new Set(sensitive.map((i) => labelOf(i.action)))].slice(0, 3).join(', ')}.`
    : 'No role changes, deletions or exports in this period.'
  const loginNote = superLogins.length
    ? ` ${superLogins.length} super-admin sign-in${superLogins.length === 1 ? '' : 's'}${superLogins.length <= 3 ? ` (${superLogins.map((i) => `${i.actor_name.split(' ')[0]}, ${clock(i.created_at)}`).join('; ')})` : ''}.`
    : ' No super-admin sign-ins.'

  const query = q.trim().toLowerCase()
  const visible = merged.filter((i) =>
    (!actor || i.actor_name === actor) && (!kind || i.kind === kind) &&
    (!query || `${i.actor_name} ${i.action} ${labelOf(i.action)} ${i.ticket_human_id || ''} ${i.details?.human_id || ''} ${i.entity_id || ''}`.toLowerCase().includes(query)))
  const shown = visible.slice(0, limit)
  const days = [...new Set(shown.map((i) => i.day))]
  const chips = []
  if (actor) chips.push({ l: actor, clear: () => setActor('') })
  if (kind) chips.push({ l: kind, clear: () => setKind('') })

  const exportCsv = () => {
    const cell = (value) => { const text = String(value ?? ''); return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"` }
    const lines = [['Time (IST)', 'Who', 'Role', 'Action', 'What happened', 'Record', 'Details'], ...visible.map((i) => [new Date(i.created_at).toLocaleString('en-GB', { timeZone: TZ }), i.actor_name, i.actor_role, i.action, labelOf(i.action), i.ticket_human_id || i.details?.human_id || i.entity_id || '', JSON.stringify(i.details || {})])]
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob(['﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    link.download = `audit-log-${from}-to-${today}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
    toast.success(`Audit log exported (${visible.length} events)`)
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-3.5 text-[13px] text-[#17171c]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[3px]"><h2 className="m-0 text-[21px] font-semibold tracking-[-.01em]">Audit logs</h2><div className="text-[12.5px] text-[#6b6b76]">Who did what in Service Hub · {periodLabel}</div></div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticket ID, person, action…" className="w-[220px] max-w-full rounded-[9px] border border-[#e0dfdb] bg-white px-[11px] py-[7px] text-[12.5px] text-[#17171c] outline-none" />
          <AppSelect value={actor} onValueChange={setActor} options={[["", "Everyone"], ...actors.map((a) => [a, a])]} aria-label="Filter by person" className="h-auto w-auto max-w-[220px] rounded-[9px] border-[#e0dfdb] px-2.5 py-[7px] text-[12.5px] text-[#17171c]" />
          <AppSelect value={period} onValueChange={setPeriod} options={PERIODS} aria-label="Period" className="h-auto w-auto rounded-[9px] border-[#e0dfdb] px-2.5 py-[7px] text-[12.5px] text-[#17171c]" />
          <button onClick={exportCsv} className="rounded-[9px] bg-[#17171c] px-3.5 py-2 text-[12.5px] font-medium text-white">Export</button>
        </div>
      </header>

      <section className="flex flex-wrap gap-2">
        {kpis.map((k) => (
          <div key={k.l} className="flex min-w-0 flex-[1_1_150px] flex-col gap-1 rounded-[10px] border border-[#e8e7e3] bg-white px-3.5 py-3"><span className="text-[11.5px] text-[#6b6b76]">{k.l}</span><span className="text-xl font-semibold tracking-[-.02em]" style={{ color: k.c }}>{k.v}</span><span className="text-[11.5px] leading-snug text-[#6b6b76]">{k.s}</span></div>
        ))}
      </section>

      <section className="flex flex-wrap gap-3">
        <div className="flex min-w-0 flex-[1_1_600px] flex-col gap-2.5 rounded-xl border border-[#e8e7e3] bg-white px-[18px] py-4">
          <div className="flex flex-wrap justify-between gap-2.5">
            <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">When each person was active · today</h3><span className="text-xs text-[#6b6b76]">Actions per hour · click a name to filter the log</span></div>
            <div className="flex items-center gap-2.5 text-[11.5px] text-[#55555e]"><span className="flex items-center gap-[5px]"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: 'rgba(179,23,127,.25)' }} />1</span><span className="flex items-center gap-[5px]"><span className="h-2.5 w-2.5 rounded-[3px] bg-[#b3177f]" />4+</span></div>
          </div>
          <div className="overflow-x-auto"><div className="grid min-w-[560px] items-center gap-[3px]" style={{ gridTemplateColumns: `130px repeat(${HOURS.length},minmax(0,1fr)) 44px` }}>
            <span />{HOURS.map((h) => <span key={h} className="text-center text-[10.5px] text-[#8a8a93]">{String(h).padStart(2, '0')}</span>)}<span className="text-right text-[10.5px] text-[#8a8a93]">Total</span>
            {heat.map((r) => [
              <button key={`${r.name}-n`} onClick={() => setActor(actor === r.name ? '' : r.name)} className={`truncate py-0.5 text-left ${actor === r.name ? 'font-semibold' : ''}`}>{r.name}</button>,
              ...r.cells.map((c) => (
                <div key={`${r.name}-${c.h}`} title={c.future ? 'later today' : `${c.n} action${c.n === 1 ? '' : 's'} at ${String(c.h).padStart(2, '0')}:00`} className={`grid h-6 place-items-center rounded-[5px] text-[10.5px] font-semibold ${c.future ? 'bg-[#fafaf8]' : c.n ? '' : 'bg-[#f4f3f0]'}`} style={!c.future && c.n ? { background: `rgba(179,23,127,${Math.min(1, 0.2 + c.n * 0.2).toFixed(2)})`, color: c.n >= 3 ? '#fff' : '#17171c' } : undefined}>{c.n || ''}</div>
              )),
              <span key={`${r.name}-t`} className="text-right font-semibold tabular-nums">{r.total}</span>,
            ])}
          </div></div>
          {!heat.length && <span className="py-3 text-[#8a8a93]">No activity recorded today yet.</span>}
        </div>
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-2.5 rounded-xl border border-[#e8e7e3] bg-white px-[18px] py-4">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">What people did</h3><span className="text-xs text-[#6b6b76]">{actor ? `${actor} · ${period} days` : `Everyone · ${period} days · click to filter`}</span></div>
          {kindCounts.map((m) => (
            <button key={m.k} onClick={() => setKind(kind === m.k ? '' : m.k)} className={`grid items-center gap-2.5 rounded-md px-1.5 py-[3px] text-left ${kind === m.k ? 'bg-[#fdf5fa]' : ''}`} style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 34px' }}>
              <span className="flex min-w-0 items-center gap-[7px]"><span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: KIND_C[m.k] }} /><span className="truncate">{m.k}</span></span>
              <div className="h-2 overflow-hidden rounded bg-[#f1f0ec]"><div className="h-full rounded" style={{ width: `${(m.n / mixMax) * 100}%`, background: KIND_C[m.k] }} /></div>
              <span className="text-right font-semibold tabular-nums">{m.n}</span>
            </button>
          ))}
          <span className="rounded-[7px] bg-[#f7f6f3] px-2.5 py-2 text-xs leading-normal text-[#3b3b44]">{sensitiveNote}{loginNote}</span>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[#e8e7e3] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-[18px] pb-2.5 pt-3.5">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Activity · {visible.length} events</h3><span className="text-xs text-[#6b6b76]">Create + update on the same ticket within 2 minutes are merged into one line</span></div>
          <div className="flex flex-wrap items-center gap-1.5">{chips.map((c) => <button key={c.l} onClick={c.clear} className="rounded-full bg-[#fbe9f4] px-2.5 py-1 text-xs font-medium text-[#8a0f61]">{c.l} ✕</button>)}</div>
        </div>
        <div className="overflow-x-auto"><div className="min-w-[820px]">
          <div className="grid gap-3 border-y border-[#efeeea] bg-[#f7f6f3] px-[18px] py-2 text-[11.5px] text-[#6b6b76]" style={{ gridTemplateColumns: COLS }}><span>Time</span><span>Who</span><span>Role</span><span>What happened</span><span>Ticket / record</span></div>
          {days.map((day) => {
            const rows = shown.filter((i) => i.day === day)
            return [
              <div key={`${day}-h`} className="border-b border-[#f1f0ec] bg-[#fbfaf8] px-[18px] py-2 text-[11.5px] font-semibold tracking-[.02em] text-[#55555e]">{dayLabel(day, today)} · {visible.filter((i) => i.day === day).length} events</div>,
              ...rows.map((i) => {
                const [color, soft] = ROLE_C[i.actor_role] || ROLE_C.system
                const isMerged = absorbed.has(i.id)
                let flag = ''
                if (isMerged) flag = 'created & updated by same person'
                if (i.kind === 'Sign-ins' && i.action === 'login' && (laterWork.get(`${i.actor_id}|${i.day}`) || 0) < new Date(i.created_at).getTime()) flag = 'no activity after sign-in'
                const ref = i.ticket_human_id || i.details?.human_id || (i.entity && i.entity !== 'ticket' && i.entity_id ? `${i.entity.replace(/_/g, ' ')}` : '') || '—'
                const clickable = Boolean(i.ticket_id)
                return (
                  <div key={i.id} className="grid items-center gap-3 border-b border-[#f1f0ec] px-[18px] py-2" style={{ gridTemplateColumns: COLS }}>
                    <span className="tabular-nums text-[#55555e]">{clock(i.created_at)}</span>
                    <div className="flex min-w-0 items-center gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9.5px] font-semibold" style={{ background: soft, color }}>{initials(i.actor_name)}</span><span className="truncate">{i.actor_name === 'system' ? 'System' : i.actor_name}</span></div>
                    <span><span className="rounded-[5px] border border-[#e0dfdb] px-[7px] py-0.5 text-[11px] text-[#55555e]">{String(i.actor_role || 'system').replace('_', ' ')}</span></span>
                    <div className="flex min-w-0 items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: colorOf(i.action) }} /><span>{isMerged ? 'Logged ticket (created + updated)' : labelOf(i.action)}</span>{flag && <span className="whitespace-nowrap rounded bg-[#fdf3dc] px-1.5 py-px text-[10.5px] font-medium text-[#8a5a00]">{flag}</span>}</div>
                    {clickable ? <button onClick={() => onOpenTicket?.(i.ticket_id)} className="truncate text-left font-mono text-[11.5px] text-[#b3177f] hover:underline">{ref}</button> : <span className="truncate font-mono text-[11.5px] text-[#8a8a93]">{ref}</span>}
                  </div>
                )
              }),
            ]
          })}
          {!visible.length && <div className="p-7 text-center text-[#6b6b76]">No events match.</div>}
        </div></div>
        {visible.length > limit && (
          <div className="flex items-center justify-between gap-2.5 px-[18px] py-3"><span className="text-xs text-[#6b6b76]">Showing {limit} of {visible.length}</span><button onClick={() => setLimit((n) => n + ROWS_STEP)} className="rounded-lg border border-[#e0dfdb] bg-white px-3 py-1.5 text-[12.5px]">Show {Math.min(ROWS_STEP, visible.length - limit)} more</button></div>
        )}
      </section>
    </div>
  )
}

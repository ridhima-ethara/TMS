'use client'

// "Team dashboard" for IT and Admin team heads: what needs attention (with
// one-click assignment, rebalancing and reminders), live workload, team
// performance, the team SLA calendar and category hotspots.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/appapi'
import { workingMinutesBetween } from '@/lib/sla'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import CategoryManager from '@/components/app/CategoryManager'
import { DownloadReportButton, monthRange } from '@/components/app/ChecklistReport'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { addDays, cutoffAt, dowMon, istKey, istTime, pl } from '@/components/app/MyKraView'

const RED = '#b42318', AMB = '#8a5a00', GRN = '#12795a', MAG = '#b3177f'
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY = 86400000
const COLORS = ['#6d4ed8', '#2f6bd0', '#0f7c86', '#c2410c', '#a21caf', '#12795a', '#475569', '#0e7490', '#b45309', '#be185d']

const isActive = (t) => !['Closed', 'Cancelled', 'Resolved'].includes(t.status)
const resolvedAt = (t) => t.resolved_at || t.resolution?.resolved_date || t.closed_at || null
const closedAt = (t) => (t.status === 'Closed' || t.status === 'Resolved' ? resolvedAt(t) || t.updated_at : null)
const metSla = (t) => {
  const r = resolvedAt(t)
  return t.sla_resolution_due && r ? new Date(r) <= new Date(t.sla_resolution_due) : null
}
const siteOf = (value) => (/\blotus\b/i.test(value || '') ? 'Lotus' : /\btulip\b/i.test(value || '') ? 'Tulip' : null)
const ticketSite = (t) => siteOf(t.routing_site || t.location)
const keyDate = (key) => new Date(`${key}T12:00:00Z`)
const fmtKey = (key, opts) => keyDate(key).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts })
const seg = (on) => (on ? 'bg-white text-[#17171c] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'bg-transparent text-[#6b6b76]')
const card = 'min-w-0 rounded-[13px] border border-[#e8e7e3] bg-white'
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null)
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
const colorOf = (id) => COLORS[[...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length]
// Working minutes → "40m", "2.5h" or "3.1wd" (9-hour working days).
const fmtH = (min) => (min == null ? '—' : min < 60 ? `${Math.round(min)}m` : min < 1080 ? `${(min / 60).toFixed(1)}h` : `${(min / 540).toFixed(1)}wd`)
const resMinutes = (t) => (resolvedAt(t) && (t.raised_at || t.created_at) ? workingMinutesBetween(t.raised_at || t.created_at, resolvedAt(t)) : null)

function workingDays(today, n) {
  const out = []
  for (let k = today; out.length < n; k = addDays(k, -1)) if (dowMon(k) < 5) out.unshift(k)
  return out
}

function downloadCsv(name, rows) {
  const esc = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''))
  // BOM so Excel reads ticket titles (₹, –, non-English names) as UTF-8.
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function HeadDashboard({ user, onGoTickets, onGoApprovals, onOpenTicket }) {
  const dept = user.role === 'admin' ? 'Admin' : 'IT'
  const [data, setData] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const [busy, setBusy] = useState(null)
  const [done, setDone] = useState([])
  const [sort, setSort] = useState('res')
  const [hl, setHl] = useState('')
  const [month, setMonth] = useState(() => istKey().slice(0, 7))
  const [sel, setSel] = useState(() => istKey())
  const [catsOpen, setCatsOpen] = useState(false)

  const load = useCallback(async () => {
    const from = workingDays(istKey(), 9)[0]
    const [t, m, a, k, s] = await Promise.allSettled([
      api('/tickets?limit=1000'),
      api('/reports/member-sla'),
      api('/approvals'),
      api('/reports/daily-kra'),
      api(`/member-checklist-submissions?team=1&from=${from}&limit=2000`),
    ])
    if (t.status === 'rejected') toast.error(t.reason?.message || 'Could not load team tickets')
    setData((prev) => ({
      tickets: t.status === 'fulfilled' ? t.value.items || [] : prev?.tickets || [],
      members: m.status === 'fulfilled' ? m.value.members || [] : prev?.members || [],
      approvals: a.status === 'fulfilled' ? a.value : prev?.approvals || [],
      kra: k.status === 'fulfilled' ? k.value.members || [] : prev?.kra || [],
      subs: s.status === 'fulfilled' ? s.value : prev?.subs || [],
    }))
    setNow(new Date())
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 60000)
    return () => clearInterval(timer)
  }, [load])

  const today = istKey(now)
  const team = useMemo(() => (data?.tickets || []).filter((t) => t.department === dept), [data, dept])
  const managedSites = useMemo(() => {
    const sites = (user.managed_locations || []).map(siteOf).filter(Boolean)
    return sites.length ? sites : [siteOf(user.location)].filter(Boolean)
  }, [user])
  const canManage = (t) => dept === 'Admin' || !ticketSite(t) || managedSites.includes(ticketSite(t))

  // Per-member figures, all computed from the team's tickets.
  const people = useMemo(() => {
    if (!data) return []
    const days8 = workingDays(today, 8)
    const days7 = workingDays(today, 7)
    const subDays = new Map()
    for (const s of data.subs) {
      if (!subDays.has(s.member_id)) subDays.set(s.member_id, new Set())
      subDays.get(s.member_id).add(s.date)
    }
    const hasKra = new Set(data.kra.map((k) => k.member_id))
    return data.members.map((m) => {
      const mine = team.filter((t) => t.assignee_id === m.member_id)
      const active = mine.filter(isActive)
      const closed = mine.filter((t) => closedAt(t))
      const judged = closed.filter((t) => metSla(t) !== null)
      const mins = closed.map(resMinutes).filter((x) => x != null)
      return {
        id: m.member_id,
        name: m.member_name,
        site: siteOf(m.location) || m.location || '',
        head: !!m.is_team_head,
        assigned: mine.length,
        open: active.length,
        ov: active.filter((t) => t.sla_resolution_due && new Date(t.sla_resolution_due) < now).length,
        res: closed.length,
        avgMin: avg(mins),
        sla: judged.length ? Math.round((judged.filter(metSla).length / judged.length) * 100) : null,
        kra: days8.map((k) => (subDays.get(m.member_id)?.has(k) ? GRN : hasKra.has(m.member_id) ? '#ebe9e4' : '#f4f3f0')),
        spark: days7.map((k) => closed.filter((t) => istKey(closedAt(t)) === k).length),
      }
    })
  }, [data, team, today, now])

  if (!data)
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3">
        <Skeleton className="h-12 w-80" />
        <Skeleton className="h-24 w-full rounded-[11px]" />
        <Skeleton className="h-[360px] w-full rounded-[13px]" />
      </div>
    )

  const ranked = people.filter((p) => !(p.head && p.assigned === 0))
  const hiddenHeads = people.filter((p) => p.head && p.assigned === 0)
  const engineers = people.filter((p) => !p.head)
  const active = team.filter(isActive)
  const overdue = active.filter((t) => t.sla_resolution_due && new Date(t.sla_resolution_due) < now)
  const unalloc = active.filter((t) => !t.assignee_id)
  const oldest = [...overdue].sort((a, b) => new Date(a.sla_resolution_due) - new Date(b.sla_resolution_due))[0]

  // ---- KPIs ----
  const weekStart = addDays(today, -dowMon(today))
  const closedBetween = (fromKey, toKey) => team.filter((t) => closedAt(t) && istKey(closedAt(t)) >= fromKey && istKey(closedAt(t)) <= toKey)
  const thisWeek = closedBetween(weekStart, today).length
  const lastWeek = closedBetween(addDays(weekStart, -7), addDays(today, -7)).length
  const weekDelta = lastWeek ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null
  const t30 = new Date(now - 30 * DAY), t60 = new Date(now - 60 * DAY)
  const closedIn = (from, to) => team.filter((t) => closedAt(t) && new Date(closedAt(t)) >= from && new Date(closedAt(t)) < to)
  const c30 = closedIn(t30, now), cPrev = closedIn(t60, t30)
  const judged30 = c30.filter((t) => metSla(t) !== null)
  const teamSla = pct(judged30.filter(metSla).length, judged30.length)
  const perfect = ranked.filter((p) => {
    const mine = judged30.filter((t) => t.assignee_id === p.id)
    return mine.length && mine.every(metSla)
  }).length
  const withClosed30 = ranked.filter((p) => judged30.some((t) => t.assignee_id === p.id)).length
  const med30 = median(c30.map(resMinutes).filter((x) => x != null))
  const medPrev = median(cPrev.map(resMinutes).filter((x) => x != null))
  const teamAvg = avg(team.filter((t) => closedAt(t)).map(resMinutes).filter((x) => x != null))
  const outlier = [...ranked].filter((p) => p.avgMin != null && p.res > 0).sort((a, b) => b.avgMin - a.avgMin)[0]
  const kraDue = data.kra.length
  const kraSent = data.kra.filter((k) => k.submitted_lists > 0).length
  const pastCutoff = now > cutoffAt(today)
  const kpis = [
    { l: 'Open tickets', v: active.length, d: unalloc.length ? `${unalloc.length} unallocated` : '', dc: RED, s: `across ${pl(engineers.length, 'member')}`, c: '#17171c' },
    { l: 'Overdue', v: overdue.length, d: '', dc: RED, s: oldest ? `oldest ${Math.max(1, Math.floor((now - new Date(oldest.sla_resolution_due)) / DAY))} days · ${oldest.title}` : 'nothing overdue', c: overdue.length ? RED : GRN },
    { l: 'Resolved this week', v: thisWeek, d: weekDelta == null || weekDelta === 0 ? '' : `${weekDelta > 0 ? '▲' : '▼'} ${Math.abs(weekDelta)}%`, dc: weekDelta > 0 ? GRN : RED, s: `${lastWeek} by this point last week`, c: '#17171c' },
    { l: 'Team resolution SLA', v: teamSla == null ? '—' : `${teamSla}%`, d: '', dc: GRN, s: withClosed30 ? `30 days · ${perfect} of ${withClosed30} at 100%` : 'no tickets closed in 30 days', c: teamSla == null ? '#17171c' : teamSla >= 90 ? GRN : teamSla >= 75 ? AMB : RED },
    {
      l: 'Median resolution',
      v: fmtH(med30),
      d: med30 != null && medPrev != null && Math.abs(med30 - medPrev) >= 6 ? `${med30 < medPrev ? '▼' : '▲'} ${fmtH(Math.abs(med30 - medPrev))}` : '',
      dc: med30 != null && medPrev != null && med30 < medPrev ? GRN : RED,
      s: outlier && teamAvg && outlier.avgMin > teamAvg * 3 ? `${outlier.name.split(' ')[0]}’s ${fmtH(outlier.avgMin)} avg is the outlier` : 'working time · 30 days',
      c: '#17171c',
    },
    { l: 'Checklist submitted today', v: kraDue ? `${kraSent}/${kraDue}` : '—', d: '', dc: AMB, s: kraDue ? (pastCutoff ? 'cut-off 7:00 PM passed' : 'cut-off 7:00 PM') : 'no checklists due today', c: kraSent < kraDue ? AMB : GRN },
  ]

  // ---- needs attention ----
  const load0 = new Map(people.map((p) => [p.id, p.open]))
  const pickTarget = (t, exclude = []) => {
    let pool = engineers.filter((p) => !exclude.includes(p.id))
    const site = ticketSite(t)
    if (dept === 'IT' && site && pool.some((p) => p.site === site)) pool = pool.filter((p) => p.site === site)
    return pool.sort((a, b) => load0.get(a.id) - load0.get(b.id) || (a.avgMin ?? 1e9) - (b.avgMin ?? 1e9))[0]
  }
  const assign = async (key, moves, message) => {
    setBusy(key)
    try {
      for (const [t, p] of moves) await api(`/tickets/${t.id}`, { method: 'PATCH', body: { assignee_id: p.id } })
      toast.success(message)
      return true
    } catch (error) {
      toast.error(error.message)
      return false
    } finally {
      await load()
      setBusy(null)
    }
  }
  const items = []
  const assignable = unalloc.filter(canManage).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  for (const t of assignable.slice(0, 2)) {
    const p = pickTarget(t)
    if (!p) break
    const days = Math.max(0, Math.floor((now - new Date(t.created_at)) / DAY))
    const first = p.name.split(' ')[0]
    items.push({
      key: `un:${t.id}`,
      sev: 'c',
      t: `${t.title} unallocated for ${days ? pl(days, 'day') : 'under a day'}`,
      d: `${t.human_id} · ${t.category} · ${load0.get(p.id) === 0 ? `${first} has no open tickets` : `${first} has the lightest load (${load0.get(p.id)} open)`}${p.avgMin != null ? ` and resolves in ${fmtH(p.avgMin)}` : ''}`,
      btns: [{ l: `Assign to ${first}`, primary: true, on: (key) => assign(key, [[t, p]], `${t.human_id} assigned to ${p.name}`) }],
    })
    load0.set(p.id, load0.get(p.id) + 1)
  }
  if (assignable.length > 2)
    items.push({ key: 'un:more', sev: 'c', t: `${pl(assignable.length - 2, 'more ticket')} waiting for allocation`, d: 'Oldest first on the team board.', btns: [{ l: 'Team board', on: () => onGoTickets() }] })
  const heavy = [...people].filter((p) => p.ov >= 3).sort((a, b) => b.ov - a.ov)[0]
  if (heavy) {
    const pending = new Set(data.approvals.filter((a) => a.status === 'Pending').map((a) => a.ticket_id))
    const movable = overdue
      .filter((t) => t.assignee_id === heavy.id && canManage(t) && !pending.has(t.id))
      .sort((a, b) => new Date(a.sla_resolution_due) - new Date(b.sla_resolution_due))
      .slice(0, 3)
    const moves = []
    for (const t of movable) {
      const p = pickTarget(t, [heavy.id])
      if (!p) break
      moves.push([t, p])
      load0.set(p.id, load0.get(p.id) + 1)
    }
    const names = [...new Set(moves.map(([, p]) => p.name.split(' ')[0]))]
    items.push({
      key: `rebal:${heavy.id}:${heavy.ov}`,
      sev: 'c',
      t: `${heavy.name} has ${heavy.open} open, ${heavy.ov} overdue`,
      d: `${heavy.avgMin != null && teamAvg ? `Avg resolution ${fmtH(heavy.avgMin)} vs team ${fmtH(teamAvg)}. ` : ''}${moves.length ? `Moving the ${pl(moves.length, 'oldest overdue ticket')} to ${names.join(' and ')} clears ${Math.round((moves.length / overdue.length) * 100)}% of the overdue list.` : 'None of these can be moved from here (outside your sites or waiting on approval).'}`,
      btns: moves.length
        ? [{ l: `Rebalance ${moves.length}`, primary: true, on: (key) => assign(key, moves, `${pl(moves.length, 'ticket')} moved: ${names.map((n) => `${moves.filter(([, p]) => p.name.split(' ')[0] === n).length} → ${n}`).join(', ')}`) }]
        : [{ l: 'Team board', on: () => onGoTickets() }],
    })
  }
  const teamIds = new Set(team.map((t) => t.id))
  const blocking = data.approvals.filter((a) => a.status === 'Pending' && teamIds.has(a.ticket_id) && a.ticket && isActive(a.ticket))
  if (blocking.length) {
    const past = blocking.filter((a) => a.ticket.sla_resolution_due && new Date(a.ticket.sla_resolution_due) < now).length
    items.push({
      key: 'appr',
      sev: 'h',
      t: `${pl(blocking.length, 'approval')} ${blocking.length === 1 ? 'is' : 'are'} blocking tickets`,
      d: `${blocking.slice(0, 2).map((a) => `${a.ticket.title} (${Math.max(0, Math.floor((now - new Date(a.created_at || a.ticket.created_at)) / DAY))} days)`).join(' and ')}${blocking.length > 2 ? ` and ${blocking.length - 2} more` : ''}. ${past ? `${past} past SLA.` : 'None past SLA yet.'}`,
      btns: [{ l: 'Open approvals', on: () => onGoApprovals() }],
    })
  }
  const notSent = data.kra.filter((k) => !k.submitted_lists)
  if (notSent.length) {
    const ids = new Set(notSent.map((k) => k.member_id))
    const closedTodayBy = team.filter((t) => ids.has(t.assignee_id) && closedAt(t) && istKey(closedAt(t)) === today).length
    const names = notSent.map((k) => k.member_name.split(' ')[0])
    items.push({
      key: `kra:${notSent.length}`,
      sev: 'h',
      t: `${notSent.length} of ${kraDue} haven’t submitted today’s checklist`,
      d: `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}${closedTodayBy ? ` — they closed ${pl(closedTodayBy, 'ticket')} between them today` : ''}.`,
      btns: [{
        l: `Remind ${notSent.length}`,
        on: async (key) => {
          setBusy(key)
          try {
            const r = await api('/member-checklists/remind-pending', { method: 'POST', body: { member_ids: [...ids] } })
            toast.success(`Reminder sent to ${pl(r.reminded ?? notSent.length, 'member')}`)
            return true
          } catch (error) {
            toast.error(error.message)
            return false
          } finally {
            setBusy(null)
          }
        },
      }],
    })
  }
  const live = items.filter((i) => !done.some((d) => d.key === i.key))
  const act = async (item, b) => {
    const ok = await b.on(item.key)
    if (ok) setDone((d) => [...d, { ...item, btns: [] }])
  }

  // ---- workload ----
  const loadRows = [...people].filter((p) => p.open > 0 || !p.head).sort((a, b) => b.open - a.open)
  const mxOpen = Math.max(1, unalloc.length, ...loadRows.map((p) => p.open))
  const top = loadRows[0]
  const idle = loadRows.filter((p) => !p.head && p.open === 0)
  const loadNote = !active.length
    ? 'No open tickets — the team is clear.'
    : top && top.open / active.length >= 0.3 && idle.length
      ? `${top.name.split(' ')[0]} holds ${Math.round((top.open / active.length) * 100)}% of all open tickets while ${idle[0].name.split(' ')[0]} has none. Rebalancing is the fastest way to cut overdue.`
      : overdue.length && top?.ov / overdue.length >= 0.5
        ? `${top.name.split(' ')[0]} owns ${top.ov} of ${overdue.length} overdue tickets — check in on what’s blocking them.`
        : 'Load is spread evenly across the team.'

  // ---- spotlights ----
  const withRes = ranked.filter((p) => p.res > 0)
  const most = [...withRes].sort((a, b) => b.res - a.res)[0]
  const fastest = [...withRes].filter((p) => p.res >= 5 && p.avgMin != null).sort((a, b) => a.avgMin - b.avgMin)[0]
  const support = [...ranked].filter((p) => p.ov > 0 || (p.sla != null && p.sla < 90)).sort((a, b) => b.ov - a.ov || (a.sla ?? 100) - (b.sla ?? 100))[0]
  const spots = [
    most && { tag: 'Most resolved', tc: GRN, border: '#cfe6da', p: most, why: `${most.res} resolved · ${most.sla ?? '—'}% SLA · ${fmtH(most.avgMin)} average` },
    fastest && { tag: 'Fastest', tc: '#1d4f9e', border: '#d6e2f5', p: fastest, why: `${fmtH(fastest.avgMin)} average resolution · ${fastest.res} resolved` },
    support && { tag: 'Needs support', tc: RED, border: '#f1d3d0', p: support, why: `${support.sla ?? '—'}% SLA · ${fmtH(support.avgMin)} average · ${support.ov} overdue of ${support.open} open` },
  ].filter(Boolean)

  // ---- performance table ----
  const totRes = ranked.reduce((a, p) => a + p.res, 0)
  const mxRes = Math.max(1, ...ranked.map((p) => p.res))
  const sorters = {
    res: (a, b) => b.res - a.res,
    speed: (a, b) => (a.avgMin ?? 1e9) - (b.avgMin ?? 1e9),
    sla: (a, b) => (b.sla ?? -1) - (a.sla ?? -1) || (a.avgMin ?? 1e9) - (b.avgMin ?? 1e9),
    load: (a, b) => b.open - a.open,
  }
  const perf = [...ranked].sort(sorters[sort])

  const weeklyReport = () => {
    const stamp = (v) => (v ? new Date(v).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '')
    const resolvedWeek = closedBetween(weekStart, today).sort((a, b) => new Date(resolvedAt(b)) - new Date(resolvedAt(a)))
    // Open tickets someone touched this week: assigned, started, remarked or updated.
    const touched = (t) => [t.last_assigned_at, t.work_started_at, t.updated_at, t.last_remark?.at].some((v) => v && istKey(v) >= weekStart)
    const workedWeek = active.filter((t) => t.assignee_id && touched(t)).sort((a, b) => (a.assignee_name || '').localeCompare(b.assignee_name || '') || new Date(a.raised_at || a.created_at) - new Date(b.raised_at || b.created_at))
    const rows = [
      [`${dept} team weekly report`, `Week of ${fmtKey(weekStart, { day: 'numeric', month: 'short', year: 'numeric' })}`],
      ['Open tickets', active.length], ['Overdue', overdue.length], ['Unallocated', unalloc.length],
      ['Resolved this week', thisWeek], ['Resolved by this point last week', lastWeek],
      ['Team resolution SLA (30 days)', teamSla == null ? '' : `${teamSla}%`], ['Median resolution (30 days)', fmtH(med30)],
      ['Checklist submitted today', kraDue ? `${kraSent}/${kraDue}` : ''],
      [],
      ['Member', 'Site', 'Resolved this week', 'Resolved (all time)', 'Open', 'Overdue', 'Resolution SLA', 'Avg resolution'],
      ...ranked.map((p) => [p.name, p.site, closedBetween(weekStart, today).filter((t) => t.assignee_id === p.id).length, p.res, p.open, p.ov, p.sla == null ? '' : `${p.sla}%`, fmtH(p.avgMin)]),
      [],
      [`TICKETS RESOLVED THIS WEEK (${resolvedWeek.length})`],
      ['Ticket', 'Title', 'Category', 'Priority', 'Location', 'Raised for', 'Resolved by', 'Resolved on', 'Resolution time', 'SLA', 'Status', 'What was done', 'Root cause'],
      ...resolvedWeek.map((t) => [
        t.human_id, t.title, t.category || '', t.priority, t.location || '',
        t.issue_user_name || t.raised_for_name || t.raised_by_name || '',
        t.resolved_by_name || t.resolution?.resolved_by || t.assignee_name || '',
        stamp(resolvedAt(t)), fmtH(resMinutes(t)),
        metSla(t) == null ? '' : metSla(t) ? 'Met' : 'Breached',
        t.status === 'Resolved' ? 'Resolved · awaiting acknowledgement' : t.status,
        t.resolution?.action_taken || t.resolution?.summary || '', t.resolution?.root_cause || '',
      ]),
      ...(resolvedWeek.length ? [] : [['—', 'No tickets resolved yet this week']]),
      [],
      [`WORKED ON THIS WEEK — STILL OPEN (${workedWeek.length})`],
      ['Ticket', 'Title', 'Category', 'Priority', 'Location', 'Raised for', 'Assigned to', 'Status', 'Raised on', 'Age (days)', 'SLA', 'Latest daily remark'],
      ...workedWeek.map((t) => [
        t.human_id, t.title, t.category || '', t.priority, t.location || '',
        t.issue_user_name || t.raised_for_name || t.raised_by_name || '',
        t.assignee_name || 'Unallocated', t.status, stamp(t.raised_at || t.created_at),
        Math.max(0, Math.floor((now - new Date(t.raised_at || t.created_at)) / DAY)),
        t.sla_resolution_due ? (new Date(t.sla_resolution_due) < now ? 'Overdue' : `Due ${stamp(t.sla_resolution_due)}`) : '',
        t.last_remark ? `${t.last_remark.date} · ${t.last_remark.by_name}: ${t.last_remark.remark}` : '',
      ]),
      ...(workedWeek.length ? [] : [['—', 'No open tickets were worked on this week']]),
      [],
      [`NOT YET PICKED UP (${unalloc.length})`],
      ['Ticket', 'Title', 'Category', 'Priority', 'Location', 'Raised for', 'Raised on', 'Age (days)'],
      ...unalloc.map((t) => [
        t.human_id, t.title, t.category || '', t.priority, t.location || '',
        t.issue_user_name || t.raised_for_name || t.raised_by_name || '',
        stamp(t.raised_at || t.created_at), Math.max(0, Math.floor((now - new Date(t.raised_at || t.created_at)) / DAY)),
      ]),
    ]
    downloadCsv(`${dept.toLowerCase()}-weekly-report-${today}.csv`, rows)
    toast.success('Weekly report downloaded')
  }

  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(now))
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const SEV = { c: ['#fdeaea', RED], h: ['#fdf3dc', AMB] }

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-3 text-[13px] text-[#17171c]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[3px]">
          <h2 className="m-0 text-[22px] font-semibold tracking-[-.01em]">{greeting}, {user.name.split(' ')[0]}</h2>
          <div className="text-[12.5px] text-[#6b6b76]">
            {fmtKey(today, { weekday: 'long' })}, {fmtKey(today, { day: 'numeric', month: 'short' })} · {dept} team · {pl(engineers.length, 'member')} · {active.length} open, {overdue.length} overdue
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onGoTickets} className="rounded-[9px] border border-[#e0dfdb] bg-white px-3 py-2 text-[12.5px] text-[#17171c]">Team board</button>
          <DownloadReportButton scope="team" {...monthRange(today.slice(0, 7))} label="Team checklist report (Excel)" className="py-2" />
          <button onClick={weeklyReport} className="rounded-[9px] bg-[#17171c] px-3.5 py-2 text-[12.5px] font-medium text-white">Weekly report</button>
        </div>
      </header>

      <section className="flex flex-wrap gap-2">
        {kpis.map((k) => (
          <div key={k.l} className="flex min-w-0 flex-[1_1_150px] flex-col gap-1 rounded-[11px] border border-[#e8e7e3] bg-white px-[15px] py-3">
            <span className="text-[11.5px] text-[#6b6b76]">{k.l}</span>
            <div className="flex items-baseline gap-[7px]">
              <span className="text-[22px] font-semibold tracking-[-.02em]" style={{ color: k.c }}>{k.v}</span>
              {k.d && <span className="text-[11.5px] font-semibold" style={{ color: k.dc }}>{k.d}</span>}
            </div>
            <span className="truncate text-[11.5px] leading-[1.35] text-[#8a8a93]" title={k.s}>{k.s}</span>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap items-stretch gap-3">
        <div className={`${card} flex flex-[1_1_480px] flex-col overflow-hidden`}>
          <div className="flex items-center justify-between gap-2.5 px-[18px] pb-2.5 pt-3.5">
            <div className="flex flex-col gap-0.5"><h3 className="m-0 text-sm font-semibold">Needs your attention</h3><span className="text-xs text-[#6b6b76]">Ranked by impact · one click to act</span></div>
            <span className="text-[11.5px] font-semibold" style={{ color: live.length ? RED : GRN }}>{live.length ? `${live.length} to do` : 'All clear'}</span>
          </div>
          {[...live.map((i) => ({ ...i, isDone: false })), ...done.map((i) => ({ ...i, isDone: true }))].map((a, idx) => (
            <div key={a.key} className="grid grid-cols-[26px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-[#f1f0ec] px-[18px] py-[11px] sm:grid-cols-[26px_minmax(0,1fr)_auto]" style={{ opacity: a.isDone ? 0.55 : 1 }}>
              <span className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold" style={a.isDone ? { background: '#e4f3ec', color: GRN } : { background: SEV[a.sev][0], color: SEV[a.sev][1] }}>{a.isDone ? '✓' : idx + 1}</span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold" style={{ textDecoration: a.isDone ? 'line-through' : 'none' }}>{a.t}</span>
                <span className="text-xs leading-[1.4] text-[#55555e]">{a.d}</span>
              </div>
              {!a.isDone && (
                <div className="col-start-2 flex flex-wrap justify-end gap-1.5 sm:col-start-3">
                  {a.btns.map((b) => (
                    <button
                      key={b.l}
                      disabled={!!busy}
                      onClick={() => act(a, b)}
                      className={`whitespace-nowrap rounded-[7px] border px-[11px] py-1.5 text-xs font-medium disabled:opacity-50 ${b.primary ? 'border-[#17171c] bg-[#17171c] text-white' : 'border-[#e0dfdb] bg-white text-[#17171c]'}`}
                    >
                      {busy === a.key ? 'Working…' : b.l}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!live.length && !done.length && <div className="border-t border-[#f1f0ec] px-[18px] py-4 font-medium text-[#12795a]">Nothing needs you right now — unallocated, overdue, approvals and checklist are all on track.</div>}
        </div>

        <div className={`${card} flex flex-[1_1_420px] flex-col gap-2.5 px-[18px] py-3.5`}>
          <div className="flex flex-wrap items-start justify-between gap-2.5">
            <div className="flex flex-col gap-0.5"><h3 className="m-0 text-sm font-semibold">Workload right now</h3><span className="text-xs text-[#6b6b76]">Open tickets per person</span></div>
            <div className="flex gap-2.5 text-[11px] text-[#55555e]">
              <span className="flex items-center gap-[5px]"><span className="h-[9px] w-[9px] rounded-sm bg-[#d4553a]" />Overdue</span>
              <span className="flex items-center gap-[5px]"><span className="h-[9px] w-[9px] rounded-sm bg-[#6f9ce6]" />On track</span>
            </div>
          </div>
          {unalloc.length > 0 && <LoadRow name="Unallocated" ini="?" color="#9a9aa3" open={unalloc.length} ov={unalloc.filter((t) => t.sla_resolution_due && new Date(t.sla_resolution_due) < now).length} mx={mxOpen} />}
          {loadRows.map((p) => <LoadRow key={p.id} name={p.name} ini={initials(p.name)} color={colorOf(p.id)} open={p.open} ov={p.ov} mx={mxOpen} />)}
          <span className="mt-auto rounded-lg bg-[#f7f6f3] px-2.5 py-2 text-xs leading-normal text-[#3b3b44]">{loadNote}</span>
        </div>
      </section>

      {spots.length > 0 && (
        <section className="flex flex-wrap gap-2.5">
          {spots.map((s) => (
            <button key={s.tag} onClick={() => setHl(hl === s.p.id ? '' : s.p.id)} className="flex min-w-0 flex-[1_1_260px] items-center gap-3 rounded-xl bg-white px-[15px] py-[13px] text-left text-[#17171c]" style={{ border: `1px solid ${s.border}` }}>
              <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-full text-xs font-semibold text-white" style={{ background: colorOf(s.p.id) }}>{initials(s.p.name)}</span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-[.05em]" style={{ color: s.tc }}>{s.tag}</span>
                <span className="font-semibold">{s.p.name}</span>
                <span className="text-xs leading-[1.35] text-[#55555e]">{s.why}</span>
              </div>
            </button>
          ))}
        </section>
      )}

      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-[18px] pb-2.5 pt-3.5">
          <div className="flex flex-col gap-0.5"><h3 className="m-0 text-sm font-semibold">Team performance</h3><span className="text-xs text-[#6b6b76]">Since tracking began · click a person to highlight</span></div>
          <div className="flex gap-0.5 rounded-lg bg-[#efeeea] p-[3px]">
            {[['res', 'Most resolved'], ['speed', 'Fastest'], ['sla', 'SLA'], ['load', 'Open load']].map(([k, l]) => (
              <button key={k} onClick={() => setSort(k)} className={`rounded-md px-[11px] py-[5px] text-xs font-medium ${seg(sort === k)}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1000px]">
            <div className="grid grid-cols-[minmax(170px,1.3fr)_minmax(170px,1.4fr)_60px_150px_70px_110px_90px_130px] gap-3.5 border-y border-[#efeeea] bg-[#f7f6f3] px-[18px] py-2 text-[11.5px] text-[#6b6b76]">
              <span>Member</span><span>Resolved</span><span className="text-right">Share</span><span>Avg resolution vs team</span><span>SLA</span><span>Open · overdue</span><span>Checklist · 8 days</span><span>Closed · last 7 days</span>
            </div>
            {perf.map((p) => {
              const r = p.avgMin != null && teamAvg ? p.avgMin / teamAvg : null
              const speedC = r == null ? '#8a8a93' : r > 4 ? RED : r > 1.5 ? AMB : GRN
              const vsBg = r == null ? '#f1f0ec' : r > 4 ? '#fdeaea' : r > 1.5 ? '#fdf3dc' : '#e4f3ec'
              const vs = r == null ? 'no data' : r < 0.6 ? 'faster' : r <= 1.2 ? '≈ team' : `${r.toFixed(r >= 10 ? 0 : 1)}× slower`
              const slaC = p.sla == null ? ['#f1f0ec', '#6b6b76'] : p.sla >= 95 ? ['#e4f3ec', GRN] : p.sla >= 85 ? ['#fdf3dc', AMB] : ['#fdeaea', RED]
              const mxS = Math.max(1, ...p.spark)
              return (
                <button
                  key={p.id}
                  onClick={() => setHl(hl === p.id ? '' : p.id)}
                  className={`box-border grid w-full grid-cols-[minmax(170px,1.3fr)_minmax(170px,1.4fr)_60px_150px_70px_110px_90px_130px] items-center gap-3.5 border-b border-[#f1f0ec] px-[18px] py-[9px] text-left ${hl === p.id ? 'bg-[#fdf5fa]' : 'bg-white'}`}
                >
                  <span className="flex min-w-0 items-center gap-[9px]">
                    <span className="grid h-7 w-7 flex-none place-items-center rounded-full text-[10px] font-semibold text-white" style={{ background: colorOf(p.id) }}>{initials(p.name)}</span>
                    <span className="flex min-w-0 flex-col leading-[1.3]"><span className="truncate font-medium">{p.name}</span><span className="text-[11px] text-[#8a8a93]">{p.site}{p.head ? ' · head' : ''}</span></span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-2 flex-1 overflow-hidden rounded bg-[#f1f0ec]"><span className="block h-full rounded bg-[#2f6bd0]" style={{ width: `${(p.res / mxRes) * 100}%` }} /></span>
                    <span className="w-[34px] text-right font-semibold tabular-nums">{p.res}</span>
                  </span>
                  <span className="text-right tabular-nums text-[#55555e]">{totRes ? `${Math.round((p.res / totRes) * 100)}%` : '—'}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-semibold tabular-nums" style={{ color: speedC }}>{fmtH(p.avgMin)}</span>
                    <span className="rounded px-1.5 py-px text-[11px] font-semibold" style={{ background: vsBg, color: speedC }}>{vs}</span>
                  </span>
                  <span><span className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: slaC[0], color: slaC[1] }}>{p.sla == null ? '—' : `${p.sla}%`}</span></span>
                  <span className="tabular-nums"><strong className="font-semibold">{p.open}</strong> <span style={{ color: p.ov ? RED : '#9a9aa3' }}>· {p.ov ? `${p.ov} overdue` : 'none late'}</span></span>
                  <span className="flex gap-0.5" title="Green: checklist submitted that working day">{p.kra.map((c, i) => <span key={i} className="h-3.5 w-2 rounded-sm" style={{ background: c }} />)}</span>
                  <span className="flex h-[22px] items-end gap-[3px]" title={`Closed per working day: ${p.spark.join(', ')}`}>{p.spark.map((v, i) => <span key={i} className="flex-1 rounded-t-sm bg-[#9bb8ec]" style={{ height: Math.round((v / mxS) * 20) + 2 }} />)}</span>
                </button>
              )
            })}
          </div>
        </div>
        {hiddenHeads.length > 0 && (
          <div className="px-[18px] py-2.5 text-xs text-[#6b6b76]">
            {hiddenHeads.map((p) => p.name).join(', ')} (0 tickets) hidden — team heads without assigned tickets don’t count toward rankings.
          </div>
        )}
      </section>

      <section className="flex flex-wrap items-stretch gap-3">
        <TeamCalendar team={team} now={now} today={today} month={month} setMonth={setMonth} sel={sel} setSel={setSel} onOpenTicket={onOpenTicket} />
        <Hotspots team={team} now={now} onManage={() => setCatsOpen(true)} />
      </section>

      <Dialog open={catsOpen} onOpenChange={setCatsOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>Manage {dept} categories</DialogTitle></DialogHeader>
          <CategoryManager departments={[dept]} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LoadRow({ name, ini, color, open, ov, mx }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)_64px] items-center gap-2.5">
      <span className="flex min-w-0 items-center gap-[7px]">
        <span className="grid h-5 w-5 flex-none place-items-center rounded-full text-[8.5px] font-semibold text-white" style={{ background: color }}>{ini}</span>
        <span className="truncate text-[12.5px]">{name}</span>
      </span>
      <div className="flex h-3 overflow-hidden rounded-md bg-[#f4f3f0]">
        <div className="bg-[#d4553a]" style={{ width: `${(ov / mx) * 100}%` }} />
        <div className="bg-[#6f9ce6]" style={{ width: `${((open - ov) / mx) * 100}%` }} />
      </div>
      <span className="text-right text-xs tabular-nums"><strong className="font-semibold">{open}</strong>{ov ? <span style={{ color: RED }}> · {ov}!</span> : null}</span>
    </div>
  )
}

function TeamCalendar({ team, now, today, month, setMonth, sel, setSel, onOpenTicket }) {
  const byDay = useMemo(() => {
    const map = new Map()
    const add = (key, kind, t) => {
      if (!map.has(key)) map.set(key, { breached: [], due: [] })
      map.get(key)[kind].push(t)
    }
    for (const t of team) {
      if (t.status === 'Cancelled' || !t.sla_resolution_due) continue
      const dueAt = new Date(t.sla_resolution_due)
      const k = istKey(dueAt)
      if (isActive(t)) add(k, dueAt < now ? 'breached' : 'due', t)
      else if (metSla(t) === false) add(k, 'breached', t)
    }
    return map
  }, [team, now])
  const first = `${month}-01`
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)
  const cells = []
  for (let k = addDays(first, -dowMon(first)); k <= addDays(lastDay, 6 - dowMon(lastDay)); k = addDays(k, 1)) cells.push(k)
  const thisMonth = today.slice(0, 7)
  const d = byDay.get(sel) || { breached: [], due: [] }
  const rows = [
    ...d.breached.map((t) => ({ t, s: 'Breached', bg: '#fdeaea', fg: RED })),
    ...d.due.map((t) => ({ t, s: `Due ${istTime(t.sla_resolution_due)}`, bg: '#fdf3dc', fg: AMB })),
  ]
  return (
    <div className={`${card} flex flex-[1_1_600px] flex-col gap-2.5 px-[18px] py-3.5`}>
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <button disabled={month <= addDays(`${thisMonth}-01`, -330).slice(0, 7)} onClick={() => setMonth(addDays(first, -1).slice(0, 7))} aria-label="Previous month" className="grid h-7 w-7 place-items-center rounded-md border border-[#e0dfdb] bg-white disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
          <div className="flex flex-col gap-0.5">
            <h3 className="m-0 text-sm font-semibold">SLA calendar · {fmtKey(first, { month: 'long' })}</h3>
            <span className="text-xs text-[#6b6b76]">When team tickets breached and what’s coming due · click a day</span>
          </div>
          <button disabled={month >= addDays(`${thisMonth}-28`, 35).slice(0, 7)} onClick={() => setMonth(addDays(lastDay, 1).slice(0, 7))} aria-label="Next month" className="grid h-7 w-7 place-items-center rounded-md border border-[#e0dfdb] bg-white disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="flex gap-2.5 text-[11px] text-[#55555e]">
          <span className="flex items-center gap-[5px]"><span className="h-[9px] w-[9px] rounded-sm bg-[#d4553a]" />Breached</span>
          <span className="flex items-center gap-[5px]"><span className="h-[9px] w-[9px] rounded-sm bg-[#e0b44a]" />Due</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[520px] grid-cols-[repeat(5,minmax(0,1fr))_repeat(2,minmax(0,.5fr))] gap-[5px]">
          {DOW.map((h) => <span key={h} className="pl-1 text-[10.5px] text-[#9a9aa3]">{h}</span>)}
          {cells.map((k) => {
            const inMonth = k.startsWith(month)
            const weekend = dowMon(k) >= 5
            const isToday = k === today
            const v = byDay.get(k) || { breached: [], due: [] }
            const n = Number(k.slice(8))
            return (
              <button
                key={k}
                onClick={() => setSel(k)}
                title={fmtKey(k, { weekday: 'short', day: 'numeric', month: 'short' })}
                className={`box-border flex h-[50px] min-w-0 flex-col items-start justify-between rounded-lg px-[7px] py-[5px] text-left ${isToday ? 'border-[1.5px] border-[#b3177f] bg-[#fdf5fa]' : weekend ? 'border border-[#efeeea] bg-[#fafaf8]' : 'border border-[#efeeea] bg-white'}`}
                style={{ opacity: inMonth ? 1 : 0.5, outline: sel === k && !isToday ? '2px solid #17171c' : 'none', outlineOffset: 1 }}
              >
                <span className="text-[11.5px]" style={{ fontWeight: isToday ? 700 : 500, color: isToday ? MAG : inMonth ? '#3b3b44' : '#9a9aa3' }}>{isToday ? `${n} · Today` : n === 1 ? `${n} ${fmtKey(k, { month: 'short' })}` : n}</span>
                <span className="flex flex-wrap gap-[3px]">
                  {v.breached.length > 0 && <span className="rounded bg-[#d4553a] px-[5px] py-px text-[10.5px] font-semibold text-white">{v.breached.length} breached</span>}
                  {v.due.length > 0 && <span className="rounded bg-[#e0b44a] px-[5px] py-px text-[10.5px] font-semibold text-white">{v.due.length} due</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-[#f1f0ec] pt-2.5">
        <span className="font-semibold">{fmtKey(sel, { weekday: 'short', day: 'numeric', month: 'short' })}{sel === today ? ' · today' : ''} <span className="font-normal text-[#6b6b76]">· {d.breached.length} breached · {d.due.length} due</span></span>
        {rows.slice(0, 10).map(({ t, s, bg, fg }) => (
          <button key={t.id} onClick={() => onOpenTicket(t.id)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 bg-transparent text-left">
            <span className="truncate"><span className="font-mono text-[11.5px] text-[#8a8a93]">{t.human_id}</span> {t.title} <span className="text-[#8a8a93]">· {t.assignee_name || (t.assignee_id ? 'Assigned' : 'Unallocated')}</span></span>
            <span className="whitespace-nowrap rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold" style={{ background: bg, color: fg }}>{s}</span>
          </button>
        ))}
        {rows.length > 10 && <span className="text-xs text-[#8a8a93]">+ {rows.length - 10} more</span>}
        {!rows.length && <span className="text-[12.5px] text-[#9a9aa3]">No breaches or due tickets this day.</span>}
      </div>
    </div>
  )
}

function Hotspots({ team, now, onManage }) {
  const since = new Date(now - 30 * DAY)
  const groups = new Map()
  for (const t of team) {
    if (t.status === 'Cancelled' || new Date(t.created_at) < since) continue
    const g = groups.get(t.category || 'Other') || { l: t.category || 'Other', n: 0, b: 0, mins: [], who: new Map() }
    g.n++
    const breached = (isActive(t) && t.sla_resolution_due && new Date(t.sla_resolution_due) < now) || metSla(t) === false
    if (breached) {
      g.b++
      const who = t.assignee_name || 'Unallocated'
      g.who.set(who, (g.who.get(who) || 0) + 1)
    }
    const m = resMinutes(t)
    if (m != null) g.mins.push(m)
    groups.set(g.l, g)
  }
  const all = [...groups.values()].map((g) => ({ ...g, r: g.b / g.n, avgMin: avg(g.mins) }))
  const breaching = all.filter((g) => g.b > 0).sort((a, b) => b.r - a.r || b.n - a.n).slice(0, 5)
  const volume = all.filter((g) => !breaching.includes(g)).sort((a, b) => b.n - a.n).slice(0, 7 - breaching.length)
  const rows = [...breaching, ...volume]
  const mxR = Math.max(0.01, ...rows.map((g) => g.r))
  let note = 'No tickets raised in the last 30 days.'
  if (breaching.length) {
    const owners = new Map()
    for (const g of breaching.slice(0, 2)) for (const [w, c] of g.who) owners.set(w, (owners.get(w) || 0) + c)
    const owner = [...owners.entries()].sort((a, b) => b[1] - a[1])[0]
    const busiest = volume[0]
    note = `${breaching.slice(0, 2).map((g) => g.l).join(' and ')} breach most${owner ? ` — mostly with ${owner[0]}` : ''}.${busiest ? ` ${busiest.l} is high volume (${busiest.n}) but ${busiest.b ? 'rarely' : 'never'} late.` : ''}`
  } else if (rows.length) note = 'No category breached its SLA in the last 30 days.'
  return (
    <div className={`${card} flex flex-[1_1_340px] flex-col gap-2.5 px-[18px] py-3.5`}>
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex flex-col gap-0.5"><h3 className="m-0 text-sm font-semibold">Category hotspots · 30 days</h3><span className="text-xs text-[#6b6b76]">Where SLAs break, not where volume is</span></div>
        <button onClick={onManage} className="whitespace-nowrap bg-transparent text-xs text-[#b3177f] hover:underline">Manage categories</button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_44px_64px_56px] gap-2.5 text-[11px] text-[#8a8a93]"><span>Category</span><span className="text-right">Tickets</span><span>Breached</span><span className="text-right">Avg</span></div>
      {rows.map((h) => {
        const bc = h.r >= 0.4 ? RED : h.r > 0 ? AMB : GRN
        return (
          <div key={h.l} className="grid grid-cols-[minmax(0,1fr)_44px_64px_56px] items-center gap-2.5 py-[3px]">
            <span className="truncate" title={h.l}>{h.l}</span>
            <span className="text-right tabular-nums">{h.n}</span>
            <span className="flex items-center gap-[5px]">
              <span className="h-[7px] flex-1 overflow-hidden rounded bg-[#f1f0ec]"><span className="block h-full" style={{ width: `${Math.max(2, (h.r / mxR) * 100)}%`, background: bc }} /></span>
              <span className="w-[26px] text-right text-[11.5px] font-semibold" style={{ color: bc }}>{h.b}</span>
            </span>
            <span className="text-right text-xs tabular-nums" style={{ color: h.avgMin != null && h.avgMin >= 1080 ? RED : '#55555e' }}>{fmtH(h.avgMin)}</span>
          </div>
        )
      })}
      <span className="mt-auto rounded-lg bg-[#f7f6f3] px-2.5 py-2 text-xs leading-normal text-[#3b3b44]">{note}</span>
    </div>
  )
}

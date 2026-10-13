'use client'

// IT / Admin tickets board for members and team heads: six workflow columns
// (Unallocated → Open → In progress → Waiting on approval → Awaiting
// acknowledgement → Closed today),
// drag to move, quick filters, a load strip and a quick-view side drawer.
// Super Admin keeps SuperAdminTickets.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, fetchAllTickets, fmtWorkingDuration, PRIORITIES, slaRemaining } from '@/lib/appapi'
import { AppSelect } from '@/components/ui/select'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { RaiseTicket } from '@/components/app/TicketsView'
import DateRangeMenu from '@/components/app/DateRangeMenu'
import { toast } from 'sonner'
import { istKey, istTime } from '@/components/app/MyKraView'
import { compareText } from '@/lib/sort'

const RED = '#b42318', AMB = '#8a5a00', GRN = '#12795a', MAG = '#b3177f'
const DAY = 86400000
const DONE = ['Closed', 'Resolved', 'Cancelled']
const COLS = [
  { k: 'unalloc', l: 'Unallocated', color: '#6d4ed8', bg: 'bg-[#f6f4fd]' },
  { k: 'open', l: 'Open', color: '#2f6bd0', bg: 'bg-[#f3f6fb]' },
  { k: 'prog', l: 'In progress', color: '#d9a13a', bg: 'bg-[#fbf8f0]' },
  { k: 'appr', l: 'Waiting on approval', color: MAG, bg: 'bg-[#fbf4f8]' },
  { k: 'ack', l: 'Awaiting acknowledgement', color: '#0f7c86', bg: 'bg-[#f0f7f8]' },
  { k: 'closed', l: 'Closed today', color: GRN, bg: 'bg-[#f2f7f4]' },
]
const SLA = { over: ['#fdeaea', RED, '#d4553a'], soon: ['#fdf3dc', AMB, '#e0b44a'], ok: ['#e4f3ec', GRN, '#d8e9df'], done: ['#f1f0ec', '#55555e', '#d6d4ce'] }
const PRIOC = { Critical: RED, High: '#e0822f', Medium: '#c08a1c', Low: GRN }
const SEV = { over: 0, soon: 1, ok: 2, done: 3 }
const COLORS = ['#6d4ed8', '#2f6bd0', '#0f7c86', '#c2410c', '#a21caf', '#12795a', '#475569', '#0e7490', '#b45309', '#be185d']

const resolvedAt = (t) => t.resolved_at || t.resolution?.resolved_date || t.closed_at || null
const closedAt = (t) => (DONE.includes(t.status) ? t.closed_at || resolvedAt(t) || t.updated_at : null)
const siteOf = (v) => (/\blotus\b/i.test(v || '') ? 'Lotus' : /\btulip\b/i.test(v || '') ? 'Tulip' : null)
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
const colorOf = (id) => COLORS[[...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length]
const seg = (on) => (on ? 'bg-white text-[#17171c] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'bg-transparent text-[#6b6b76]')
const ageDays = (t, now) => Math.max(0, Math.floor((now - new Date(t.created_at)) / DAY))
const raisedKey = (t) => istKey(t.raised_at || t.created_at)
const shiftKey = (key, days) => istKey(new Date(Date.parse(`${key}T12:00:00+05:30`) + days * DAY))
const shortKey = (key) => new Date(`${key}T12:00:00+05:30`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
const DATE_PRESETS = [['all', 'All dates'], ['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month']]
const EMPTY_RES = { root_cause: '', impact: '', action_taken: '', preventive_action: '' }

function exportCsv(rows, dept) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [
    ['ID', 'Title', 'Category', 'Priority', 'Status', 'Assignee', 'Location', 'Seat', 'Raised', 'SLA', 'Latest daily remark'],
    ...rows.map((t) => [t.human_id, t.title, t.category, t.priority, t.status, t.assignee_name || 'Unallocated', t.location, t.seat_number || '', t.created_at ? new Date(t.created_at).toISOString() : '', t.status === 'Resolved' ? 'Resolved · awaiting acknowledgement' : closedAt(t) ? 'Closed' : slaRemaining(t.sla_resolution_due).text, t.last_remark ? `${t.last_remark.date} · ${t.last_remark.by_name}: ${t.last_remark.remark}` : '']),
  ].map((r) => r.map(esc).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${dept.toLowerCase()}-tickets-${istKey()}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function TicketBoard({ user, onOpenTicket, onGoApprovals }) {
  const dept = user.role === 'admin' ? 'Admin' : 'IT'
  const head = !!user.is_team_head
  const [tickets, setTickets] = useState(null)
  const [approvals, setApprovals] = useState([])
  const [members, setMembers] = useState([])
  const [now, setNow] = useState(() => new Date())
  const [scope, setScope] = useState(head ? 'team' : 'mine')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [prio, setPrio] = useState('')
  const [chip, setChip] = useState('')
  const [person, setPerson] = useState('')
  const [loc, setLoc] = useState('')
  const [dates, setDates] = useState({ preset: 'all', from: '', to: '' })
  const [allClosed, setAllClosed] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [hover, setHover] = useState(null)
  const [moving, setMoving] = useState(null)
  const [openId, setOpenId] = useState(null)
  // Pending action awaiting the user's final confirmation.
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [res, setRes] = useState(EMPTY_RES)
  const dragGuard = useRef(null)

  const load = useCallback(async () => {
    const [t, a, m] = await Promise.allSettled([
      fetchAllTickets(),
      api('/approvals'),
      head ? api('/reports/member-sla') : Promise.resolve(null),
    ])
    if (t.status === 'fulfilled') setTickets(t.value.items.filter((x) => x.department === dept))
    else {
      setTickets((prev) => prev || [])
      toast.error(t.reason?.message || 'Could not load tickets')
    }
    if (a.status === 'fulfilled') setApprovals(a.value)
    if (m.status === 'fulfilled' && m.value) setMembers(m.value.members || [])
    setNow(new Date())
  }, [dept, head])
  useEffect(() => {
    load()
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [load])
  useEffect(() => {
    if (!openId || confirm) return undefined
    const onKey = (e) => e.key === 'Escape' && setOpenId(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId, confirm])
  // Keep the board behind the drawer from scrolling while it is open.
  useEffect(() => {
    if (!openId) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [openId])

  const today = istKey(now)
  const pendingApr = useMemo(() => {
    const map = new Map()
    for (const a of approvals) if (a.status === 'Pending') map.set(a.ticket_id, a)
    return map
  }, [approvals])
  const mySite = siteOf(user.location)
  const managedSites = useMemo(() => {
    const s = (user.managed_locations || []).map(siteOf).filter(Boolean)
    return s.length ? s : [mySite].filter(Boolean)
  }, [user, mySite])

  const all = useMemo(
    () =>
      (tickets || []).map((t) => {
        const done = DONE.includes(t.status)
        const apr = !done ? pendingApr.get(t.id) : null
        const col = t.status === 'Resolved' ? 'ack' : done ? 'closed' : apr ? 'appr' : !t.assignee_id ? 'unalloc' : t.status === 'Open' ? 'open' : 'prog'
        let sk = 'ok'
        if (done) sk = 'done'
        else if (t.sla_resolution_due) {
          const due = new Date(t.sla_resolution_due)
          sk = due < now ? 'over' : istKey(due) === today ? 'soon' : 'ok'
        }
        return { ...t, col, sk, apr }
      }),
    [tickets, pendingApr, now, today],
  )
  const active = all.filter((t) => t.col !== 'closed' && t.col !== 'ack')

  // Who may move a ticket: unallocated ones you can claim, your own, or (team
  // heads) any ticket at a site they manage. The server enforces the same.
  const headFor = (t) => head && (dept === 'Admin' || !siteOf(t.routing_site || t.location) || managedSites.includes(siteOf(t.routing_site || t.location)))
  const canClaim = (t) => {
    const site = siteOf(t.routing_site || t.location)
    return dept === 'Admin' || !site || (head ? managedSites.includes(site) : site === mySite)
  }
  const canMove = (t) => t.col !== 'closed' && t.col !== 'appr' && (t.assignee_id === user.id || headFor(t) || (!t.assignee_id && canClaim(t)))

  const patch = async (t, body, message) => {
    setMoving(t.id)
    try {
      await api(`/tickets/${t.id}`, { method: 'PATCH', body })
      toast.success(message)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setMoving(null)
      load()
    }
  }
  const move = (t, to, note = '', fields = EMPTY_RES) => {
    if (t.col === to) return
    if (t.col === 'ack') {
      if (to !== 'closed') return toast('Resolved — waiting for the employee to acknowledge. You can only close it.')
      if (!canMove(t)) return toast.error('Only the assignee or team head can close this ticket')
      return patch(t, { status: 'Closed', note: note.trim() || 'Closed without employee acknowledgement' }, `${t.human_id} closed`)
    }
    if (t.col === 'appr') return toast(`Locked until ${t.apr?.human_id || 'the approval'} is decided — review it in Approvals`)
    if (to === 'appr') return toast('Raise an approval from the full ticket to move it here')
    if (t.col === 'closed') return toast('Closed tickets can’t be moved from the board')
    if (!canMove(t)) return toast.error('You can only move unallocated tickets or tickets assigned to you')
    const assignee = t.assignee_id || user.id
    if (to === 'unalloc') return patch(t, { assignee_id: null }, `${t.human_id} returned to Unallocated`)
    if (to === 'open') return patch(t, { assignee_id: assignee, status: 'Open' }, t.assignee_id ? `${t.human_id} moved to Open` : `${t.human_id} claimed by you · moved to Open`)
    if (to === 'prog') return patch(t, { assignee_id: assignee, status: 'In Progress' }, t.assignee_id ? `${t.human_id} moved to In progress` : `${t.human_id} claimed by you · moved to In progress`)
    const action = fields.action_taken.trim()
    return patch(
      t,
      {
        assignee_id: assignee,
        resolution: {
          summary: action || note.trim() || 'Resolved from the tickets board',
          action_taken: action,
          root_cause: fields.root_cause.trim(),
          impact: fields.impact.trim(),
          preventive_action: fields.preventive_action.trim(),
        },
      },
      `${t.human_id} resolved`,
    )
  }

  // What each move does, spelled out for the confirmation dialog.
  const requestMove = (t, to) => {
    const name = COLS.find((c) => c.k === to)?.l
    const claims = !t.assignee_id && to !== 'unalloc'
    const owner = t.assignee_id === user.id ? 'you' : t.assignee_name || 'the current assignee'
    if (t.col === 'ack') {
      setConfirm({
        title: `Close ${t.human_id} without acknowledgement?`,
        body: `${t.issue_user_name || t.raised_for_name || 'The employee'} hasn't acknowledged the resolution yet. Closing is final — the ticket can't be reopened or changed afterwards.`,
        label: 'Close ticket',
        tone: GRN,
        withNote: true,
        run: (text) => move(t, 'closed', text),
      })
      setNote('')
      return
    }
    const body = {
      unalloc: `${owner === 'you' ? 'You are' : `${owner} is`} removed as assignee and the ticket returns to the team queue with status Open.`,
      open: claims ? 'The ticket is assigned to you and stays Open — the SLA clock is not started by assignment alone.' : 'The ticket goes back to Open and stays with its assignee.',
      prog: claims ? 'The ticket is assigned to you and moved to In Progress.' : `The ticket moves to In Progress with ${owner}.`,
      closed: `The ticket is marked resolved${claims ? ' under your name' : ''} and the requester is notified. A ticket raised by an employee waits in Awaiting acknowledgement until they confirm the fix, then closes; internal tickets close straight away. The details below form the ticket's incident report.`,
    }[to]
    setConfirm({
      title: to === 'closed' ? `Resolve ${t.human_id}?` : `Move ${t.human_id} to ${name}?`,
      body,
      label: to === 'closed' ? 'Resolve ticket' : `Move to ${name}`,
      tone: to === 'closed' ? GRN : '#17171c',
      withResolution: to === 'closed',
      run: (text, fields) => move(t, to, text, fields),
    })
    setNote('')
    setRes(EMPTY_RES)
  }
  const requestDelete = (t) =>
    setConfirm({
      title: `Delete ${t.human_id}?`,
      body: `"${t.title}" and its history, comments and approvals are permanently removed. This cannot be undone.`,
      label: 'Delete ticket',
      tone: RED,
      run: async () => {
        try {
          await api(`/tickets/${t.id}`, { method: 'DELETE' })
          toast.success(`${t.human_id} deleted`)
          setOpenId(null)
        } catch (error) {
          toast.error(error.message)
        } finally {
          load()
        }
      },
    })
  const runConfirm = async () => {
    const action = confirm?.run
    setBusy(true)
    try {
      await action?.(note, res)
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  if (!tickets)
    return <div className="mx-auto h-[70vh] max-w-[1600px] animate-pulse rounded-[13px] bg-[#ebeae6]" />

  const scoped = all.filter((t) => scope === 'team' || t.assignee_id === user.id)
  const dateFrom = dates.preset === 'all' ? '' : dates.preset === 'today' ? today : dates.preset === '7d' ? shiftKey(today, -6) : dates.preset === '30d' ? shiftKey(today, -29) : dates.preset === 'month' ? `${today.slice(0, 7)}-01` : dates.from
  const dateTo = dates.preset === 'all' ? '' : dates.preset === 'custom' ? dates.to : today
  const dateLabel = dates.preset === 'custom' ? `${dateFrom ? shortKey(dateFrom) : 'Any'} – ${dateTo ? shortKey(dateTo) : 'today'}` : DATE_PRESETS.find((p) => p[0] === dates.preset)?.[1]
  const locOpts = [...new Set(all.map((t) => t.location).filter(Boolean))].sort(compareText)
  const ql = q.trim().toLowerCase()
  const chipDefs = [
    ['over', 'Overdue', '#d4553a', (t) => t.sk === 'over'],
    ['soon', 'Due today', '#e0b44a', (t) => t.sk === 'soon'],
    ['high', 'High priority', '#e0822f', (t) => ['High', 'Critical'].includes(t.priority) && t.col !== 'closed'],
    ['unassigned', 'Unallocated', '#6d4ed8', (t) => t.col === 'unalloc'],
    ['locked', 'Waiting approval', MAG, (t) => t.col === 'appr'],
  ]
  const chipFn = chipDefs.find((c) => c[0] === chip)?.[3]
  const vis = scoped.filter(
    (t) =>
      (!chipFn || chipFn(t)) &&
      (!person || t.assignee_id === person) &&
      (!cat || t.category === cat) &&
      (!prio || t.priority === prio) &&
      (!loc || t.location === loc) &&
      (!dateFrom || raisedKey(t) >= dateFrom) &&
      (!dateTo || raisedKey(t) <= dateTo) &&
      (!ql || `${t.human_id} ${t.title} ${t.assignee_name || ''} ${t.category || ''} ${t.issue_user_name || t.raised_for_name || ''} ${t.issue_user_email || ''} ${t.issue_user_employee_code || ''}`.toLowerCase().includes(ql)),
  )
  const catOpts = [...new Set(all.map((t) => t.category).filter(Boolean))].sort(compareText)
  const loadMap = new Map()
  for (const t of active) {
    if (!t.assignee_id) continue
    const e = loadMap.get(t.assignee_id) || { id: t.assignee_id, name: t.assignee_name || 'Member', n: 0, ov: 0 }
    e.n++
    if (t.sk === 'over') e.ov++
    loadMap.set(t.assignee_id, e)
  }
  const people = [...loadMap.values()].sort((a, b) => b.n - a.n)
  const hasFilter = !!(chip || person || cat || prio || q || loc || dates.preset !== 'all')
  const closedAll = vis.filter((t) => t.col === 'closed')
  const openTicket = all.find((t) => t.id === openId)

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-3 text-[13px] text-[#17171c]">
      <header className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-3.5">
          <h2 className="m-0 text-[21px] font-semibold tracking-[-.01em]">{dept} tickets</h2>
          <div className="flex gap-0.5 rounded-[9px] bg-[#ebeae6] p-[3px]">
            {[['mine', `My tickets · ${all.filter((t) => t.assignee_id === user.id && t.col !== 'closed').length}`], ['team', `Team tickets · ${all.length.toLocaleString('en-IN')}`]].map(([k, l]) => (
              <button key={k} onClick={() => setScope(k)} className={`rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium ${seg(scope === k)}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, title, person…" className="w-[210px] max-w-full rounded-[9px] border border-[#e0dfdb] bg-white px-[11px] py-[7px] text-[12.5px] text-[#17171c] outline-none" />
          <AppSelect value={cat} onValueChange={setCat} options={[['', 'All categories'], ...catOpts.map((c) => [c, c])]} aria-label="Category" className="h-auto w-auto max-w-[190px] rounded-[9px] border-[#e0dfdb] px-2.5 py-[7px] text-[12.5px]" />
          <AppSelect value={prio} onValueChange={setPrio} options={[['', 'All priorities'], ...PRIORITIES.map((p) => [p, p])]} aria-label="Priority" className="h-auto w-auto rounded-[9px] border-[#e0dfdb] px-2.5 py-[7px] text-[12.5px]" />
          <AppSelect value={loc} onValueChange={setLoc} options={[['', 'All locations'], ...locOpts.map((l) => [l, l])]} aria-label="Location" className="h-auto w-auto max-w-[210px] rounded-[9px] border-[#e0dfdb] px-2.5 py-[7px] text-[12.5px]" />
          <DateRangeMenu
            from={dateFrom}
            to={dateTo}
            max={today}
            label={`Raised · ${dateLabel}`}
            summary="Filters by the date a ticket was raised"
            presets={DATE_PRESETS.map(([key, label]) => ({ key, label, active: dates.preset === key }))}
            onPreset={(key) => setDates({ preset: key, from: '', to: '' })}
            onFrom={(v) => setDates({ preset: 'custom', from: v, to: dateTo || today })}
            onTo={(v) => setDates({ preset: 'custom', from: dateFrom, to: v })}
          />
          <button onClick={() => { exportCsv(vis, dept); toast.success(`Exported ${vis.length} tickets`) }} className="rounded-[9px] border border-[#e0dfdb] bg-white px-3 py-[7px] text-[12.5px] text-[#17171c]">Export</button>
          <RaiseTicket user={user} onCreated={load} trigger={<button className="rounded-[9px] bg-[#b3177f] px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-[#8a0f61]">+ Raise ticket</button>} />
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[11.5px] text-[#6b6b76]">Show</span>
          {chipDefs.map(([k, l, dot, fn]) => {
            const on = chip === k
            return (
              <button key={k} onClick={() => setChip(on ? '' : k)} className={`flex items-center gap-1.5 rounded-full border px-[11px] py-[5px] text-xs font-medium ${on ? 'border-[#17171c] bg-[#17171c] text-white' : 'border-[#e0dfdb] bg-white text-[#3b3b44]'}`}>
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot }} />
                {l}
                <span className="font-semibold">{scoped.filter(fn).length}</span>
              </button>
            )
          })}
          {hasFilter && <button onClick={() => { setChip(''); setPerson(''); setCat(''); setPrio(''); setQ(''); setLoc(''); setDates({ preset: 'all', from: '', to: '' }) }} className="bg-transparent text-xs text-[#6b6b76] underline">Clear</button>}
        </div>
        {people.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11.5px] text-[#6b6b76]">Active load</span>
            {people.map((p) => {
              const on = person === p.id
              return (
                <button key={p.id} onClick={() => setPerson(on ? '' : p.id)} title={`${p.name} · ${p.n} active · ${p.ov} overdue`} className={`flex items-center gap-[5px] rounded-full border py-0.5 pl-0.5 pr-2 ${on ? 'border-[#b3177f] bg-[#fbe9f4]' : 'border-[#e8e7e3] bg-white'}`}>
                  <span className="grid h-[22px] w-[22px] place-items-center rounded-full text-[9.5px] font-semibold text-white" style={{ background: colorOf(p.id) }}>{initials(p.name)}</span>
                  <span className="text-xs font-semibold text-[#17171c]">{p.n}</span>
                  {p.ov > 0 && <span className="text-[10.5px] font-semibold text-[#b42318]">{p.ov}!</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <section className="flex h-[calc(100dvh-235px)] min-h-[300px] snap-x gap-2.5 overflow-x-auto pb-1 [@media(max-height:700px)]:h-[calc(100dvh-150px)]">
        {COLS.map((c) => {
          const rows = (c.k === 'closed' ? closedAll.filter((t) => allClosed || istKey(closedAt(t)) === today) : vis.filter((t) => t.col === c.k))
            .sort((a, b) => (c.k === 'closed' ? new Date(closedAt(b)) - new Date(closedAt(a)) : SEV[a.sk] - SEV[b.sk] || new Date(a.created_at) - new Date(b.created_at)))
          const ov = rows.filter((t) => t.sk === 'over').length
          const oldest = rows.length ? Math.max(...rows.map((t) => ageDays(t, now))) : 0
          const sub = {
            unalloc: rows.length ? `Oldest waiting ${oldest}d — needs an owner` : 'Everything has an owner',
            open: ov ? `${ov} overdue · oldest ${oldest}d` : 'Nothing overdue',
            prog: ov ? `${ov} overdue` : 'All within SLA',
            appr: rows.length ? 'Locked until Super Admin decides' : 'Nothing waiting',
            ack: rows.length ? 'Closes when the employee acknowledges' : 'Nothing waiting on employees',
            closed: `${closedAll.filter((t) => istKey(closedAt(t)) === today).length} today · ${closedAll.length.toLocaleString('en-IN')} all time`,
          }[c.k]
          const isHover = hover === c.k && dragId
          const shown = rows.slice(0, c.k === 'closed' && allClosed ? 150 : 400)
          return (
            <div
              key={c.k}
              onDragOver={(e) => { if (!dragId) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; if (hover !== c.k) setHover(c.k) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHover(null) }}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer?.getData('text/plain') || dragId
                setHover(null)
                setDragId(null)
                const t = all.find((x) => x.id === id)
                if (t) move(t, c.k)
              }}
              className={`flex min-h-0 min-w-[82%] sm:min-w-[188px] max-w-[340px] flex-[1_1_0] snap-start flex-col rounded-[13px] border-[1.5px] ${isHover ? 'border-dashed bg-white' : `border-transparent ${c.bg}`}`}
              style={isHover ? { borderColor: c.color } : undefined}
            >
              <div className="flex flex-col gap-[3px] border-b border-[#ebeae6] px-3 pb-[9px] pt-[11px]">
                <div className="flex items-center gap-2">
                  <span className="h-[9px] w-[9px] rounded-full" style={{ background: c.color }} />
                  <span className="flex-1 text-[13.5px] font-semibold">{c.k === 'closed' && allClosed ? 'Closed' : c.l}</span>
                  <span className="rounded-full border border-[#e8e7e3] bg-white px-2 py-px text-[11.5px] font-semibold">{rows.length}</span>
                </div>
                <span className="pl-[17px] text-[11.5px]" style={{ color: ov && c.k !== 'closed' ? RED : '#6b6b76' }}>{sub}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-[7px] overflow-y-auto p-2 scrollbar-hidden">
                {shown.map((t) => {
                  const [sb, sf, edge] = SLA[t.sk]
                  const drag = canMove(t) && moving !== t.id
                  const sla = t.col === 'ack'
                    ? `Resolved ${resolvedAt(t) && istKey(resolvedAt(t)) === today ? istTime(resolvedAt(t)) : resolvedAt(t) ? new Date(resolvedAt(t)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : ''}`
                    : t.sk === 'done'
                    ? `Closed ${istKey(closedAt(t)) === today ? istTime(closedAt(t)) : new Date(closedAt(t)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}${resolvedAt(t) ? ` · ${fmtWorkingDuration(t.raised_at || t.created_at, resolvedAt(t))}` : ''}`
                    : t.sla_resolution_due ? (t.sk === 'over' ? slaRemaining(t.sla_resolution_due).text : `${slaRemaining(t.sla_resolution_due).text} left`) : 'No SLA'
                  return (
                    <div
                      key={t.id}
                      draggable={drag}
                      onDragStart={(e) => {
                        if (!drag) return e.preventDefault()
                        dragGuard.current = t.id
                        try { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' } catch { /* older browsers */ }
                        setDragId(t.id)
                      }}
                      onDragEnd={() => { setDragId(null); setHover(null); setTimeout(() => { dragGuard.current = null }, 0) }}
                      onClick={() => { if (dragGuard.current !== t.id) setOpenId(t.id) }}
                      title={drag ? 'Drag to another column' : t.col === 'appr' ? 'Locked until the approval is decided' : t.col === 'closed' ? 'Closed' : 'Only the assignee or team head can move this ticket'}
                      className={`flex flex-col gap-[7px] rounded-[9px] border border-l-[3px] border-[#e8e7e3] bg-white px-[11px] py-2.5 shadow-[0_1px_1px_rgba(0,0,0,.03)] transition-shadow hover:border-[#cfcdc6] hover:shadow-[0_3px_10px_rgba(0,0,0,.06)] ${drag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${moving === t.id ? 'pointer-events-none opacity-50' : ''}`}
                      style={{ borderLeftColor: t.col === 'closed' ? '#d6d4ce' : edge, opacity: dragId === t.id ? 0.4 : undefined }}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-mono text-[11px] text-[#8a8a93]">{t.human_id}</span>
                        <span className="flex items-center gap-[5px] text-[11px] font-semibold" style={{ color: PRIOC[t.priority] || '#55555e' }}>
                          <span className="h-[7px] w-[7px] rounded-sm" style={{ background: PRIOC[t.priority] || '#9a9aa3' }} />{t.priority}
                        </span>
                      </div>
                      <span className="text-[13px] font-semibold leading-[1.35]">{t.title}</span>
                      <span className="text-[11.5px] leading-[1.35] text-[#6b6b76]">{t.category || 'No category'} · {t.location || 'No location'}{t.seat_number ? ` · Seat ${t.seat_number}` : ''}</span>
                      {t.last_remark && t.col !== 'closed' && (
                        <span className="truncate rounded-md bg-[#f7f6f3] px-[7px] py-1 text-[11px] text-[#55555e]" title={`${t.last_remark.by_name} · ${t.last_remark.date}: ${t.last_remark.remark}`}>
                          📝 {t.last_remark.date === today ? 'Today' : shortKey(t.last_remark.date)} · {t.last_remark.remark}
                        </span>
                      )}
                      {t.col === 'appr' && <span className="rounded-md bg-[#fbe9f4] px-[7px] py-1 text-[11px] font-medium text-[#8a0f61]">🔒 Locked · {t.apr?.human_id || 'pending approval'}</span>}
                      <div className="flex items-center justify-between gap-2 border-t border-[#f4f3f0] pt-2">
                        {t.assignee_id ? (
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="grid h-5 w-5 flex-none place-items-center rounded-full text-[8.5px] font-semibold text-white" style={{ background: colorOf(t.assignee_id) }}>{initials(t.assignee_name)}</span>
                            <span className="truncate text-xs text-[#3b3b44]">{t.assignee_id === user.id ? 'You' : t.assignee_name}</span>
                          </span>
                        ) : canClaim(t) && t.col === 'unalloc' ? (
                          <button onClick={(e) => { e.stopPropagation(); move(t, 'open') }} className="rounded-md border border-dashed border-[#b9a7ee] bg-[#f6f3fe] px-[9px] py-[3px] text-[11.5px] font-medium text-[#5b3fc4]">Claim</button>
                        ) : (
                          <span className="text-xs text-[#9a9aa3]">Unallocated</span>
                        )}
                        <span className="whitespace-nowrap rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold" style={{ background: sb, color: sf }}>{sla}</span>
                      </div>
                    </div>
                  )
                })}
                {!rows.length && <div className="rounded-[9px] border border-dashed border-[#d6d4ce] px-2.5 py-[18px] text-center text-xs text-[#9a9aa3]">{c.k === 'closed' ? (allClosed ? 'No closed tickets' : 'Nothing closed yet today') : 'No tickets here'}</div>}
                {rows.length > shown.length && <span className="py-1 text-center text-xs text-[#8a8a93]">Showing {shown.length} of {rows.length} — use search or filters to narrow</span>}
                {c.k === 'closed' && closedAll.length > 0 && (
                  <button onClick={() => setAllClosed(!allClosed)} className="bg-transparent p-1.5 text-center text-xs text-[#b3177f] hover:underline">
                    {allClosed ? 'Show only today →' : `View all ${closedAll.length.toLocaleString('en-IN')} closed →`}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </section>
      <div className="text-[11.5px] text-[#8a8a93]">Drag a card to move it. Unallocated → Open claims it for you. Tickets waiting on approval stay locked until the request is decided.</div>

      {openTicket && (
        <QuickView
          t={openTicket}
          user={user}
          headFor={headFor}
          canMove={canMove}
          members={members}
          active={active}
          now={now}
          onClose={() => setOpenId(null)}
          onMove={(to) => requestMove(openTicket, to)}
          onDelete={openTicket.department === dept ? () => requestDelete(openTicket) : null}
          onAssign={(v) => {
            const name = v ? members.find((m) => m.member_id === v)?.member_name || (v === user.id ? 'you' : 'member') : null
            patch(openTicket, { assignee_id: v || null }, v ? `${openTicket.human_id} assigned to ${v === user.id ? 'you' : name}` : `${openTicket.human_id} unassigned`)
          }}
          onFull={() => { setOpenId(null); onOpenTicket(openTicket.id) }}
          today={today}
          onRemarkSaved={load}
          onGoApprovals={onGoApprovals}
        />
      )}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && !busy && setConfirm(null)}>
        <AlertDialogContent className="z-[60] max-w-[420px] rounded-xl border-[#e8e7e3] bg-white p-5 text-[#17171c]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px]">{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-[1.5] text-[#55555e]">{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          {confirm?.withResolution && (
            <div className="flex max-h-[46vh] flex-col gap-2.5 overflow-y-auto pr-0.5">
              {[
                ['root_cause', 'Root cause (RCA)', 'e.g. LAN cable of the access point was unplugged'],
                ['impact', 'Impact', 'Who and what was affected'],
                ['action_taken', 'Resolution / action taken', 'What was done to fix it'],
                ['preventive_action', 'Preventive action / key learning', 'How to stop it happening again · optional'],
              ].map(([key, label, ph]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-[11.5px] text-[#6b6b76]">{label}</span>
                  <textarea
                    value={res[key]}
                    onChange={(e) => setRes((r) => ({ ...r, [key]: e.target.value }))}
                    disabled={busy}
                    maxLength={5000}
                    rows={2}
                    placeholder={ph}
                    className="resize-y rounded-lg border border-[#e0dfdb] px-[10px] py-2 text-[13px] text-[#17171c] outline-none focus:border-[#12795a]"
                  />
                </label>
              ))}
            </div>
          )}
          {confirm?.withNote && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] text-[#6b6b76]">Closing comment <span className="text-[#9a9aa3]">· optional</span></span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
                maxLength={5000}
                rows={3}
                placeholder="What was done, or anything the requester should know…"
                className="resize-y rounded-lg border border-[#e0dfdb] px-[10px] py-2 text-[13px] text-[#17171c] outline-none focus:border-[#12795a]"
              />
              <span className="text-[11px] text-[#9a9aa3]">Saved as the resolution note on the ticket and shown in its activity.</span>
            </label>
          )}
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={busy} className="mt-0 rounded-lg border-[#e0dfdb] px-3 py-2 text-[12.5px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); runConfirm() }}
              className="rounded-lg px-3.5 py-2 text-[12.5px] text-white hover:opacity-90"
              style={{ background: confirm?.tone }}
            >
              {busy ? 'Working…' : confirm?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function QuickView({ t, user, headFor, canMove, members, active, now, today, onClose, onMove, onDelete, onAssign, onFull, onGoApprovals, onRemarkSaved }) {
  const [history, setHistory] = useState(null)
  const [remarks, setRemarks] = useState([])
  const [remark, setRemark] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let alive = true
    setHistory(null)
    api(`/tickets/${t.id}`)
      .then((d) => {
        if (!alive) return
        setHistory(d.history || [])
        const list = d.remarks || []
        setRemarks(list)
        setRemark(list.find((r) => r.by_id === user.id && r.date === today)?.remark || '')
      })
      .catch(() => alive && setHistory([]))
    return () => { alive = false }
  }, [t.id, t.status, t.assignee_id, user.id, today])
  const saveRemark = async () => {
    if (!remark.trim()) return toast.error('Write a remark first')
    setSaving(true)
    try {
      const saved = await api(`/tickets/${t.id}/remarks`, { method: 'POST', body: { remark } })
      setRemarks((list) => [saved, ...list.filter((r) => r.id !== saved.id)])
      toast.success('Daily remark saved')
      onRemarkSaved?.()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }
  const canRemark = t.col !== 'closed'
  const myToday = remarks.find((r) => r.by_id === user.id && r.date === today)
  const col = COLS.find((c) => c.k === t.col)
  const [sb, sf] = SLA[t.sk]
  const days = ageDays(t, now)
  const loadOf = (id) => active.filter((x) => x.assignee_id === id).length
  const manage = headFor(t)
  // Heads pick anyone on the team; members can take a ticket for themselves or
  // hand back their own (the server enforces the same rules).
  const options = manage
    ? [['', 'Unallocated'], ...members.map((m) => [m.member_id, `${m.member_name} · ${loadOf(m.member_id)} active`])]
    : [
        ['', 'Unallocated', !!t.assignee_id && t.assignee_id !== user.id],
        [user.id, `${user.name} (you) · ${loadOf(user.id)} active`],
        ...(t.assignee_id && t.assignee_id !== user.id ? [[t.assignee_id, t.assignee_name || 'Assigned member', true]] : []),
      ]
  if (manage && t.assignee_id && !members.some((m) => m.member_id === t.assignee_id)) options.push([t.assignee_id, t.assignee_name || 'Assigned member'])
  const editable = t.col !== 'closed' && t.col !== 'appr' && t.col !== 'ack'
  const canResolve = editable && canMove(t)
  // Only offer moves this member may make; approvals are raised from the full ticket.
  const moves = canResolve ? COLS.filter((c) => c.k !== t.col && c.k !== 'appr' && c.k !== 'ack') : []
  const sla = t.sk === 'done' ? `Closed${resolvedAt(t) ? ` in ${fmtWorkingDuration(t.raised_at || t.created_at, resolvedAt(t))}` : ''}` : t.sla_resolution_due ? (t.sk === 'over' ? slaRemaining(t.sla_resolution_due).text : `${slaRemaining(t.sla_resolution_due).text} left`) : 'No SLA'
  const events = (history || []).slice(-5).reverse()
  return (
    <>
      <div onClick={onClose} className="board-drawer-backdrop fixed inset-0 z-40 bg-[rgba(23,23,28,.28)]" />
      <aside role="dialog" aria-label={`Ticket ${t.human_id}`} className="board-drawer-panel fixed bottom-0 right-0 top-0 z-[41] flex w-[min(460px,100vw)] flex-col bg-white text-[13px] text-[#17171c] shadow-[-12px_0_40px_rgba(0,0,0,.14)]">
        <div className="flex flex-col gap-2.5 border-b border-[#efeeea] px-[22px] pb-3.5 pt-[18px]">
          <div className="flex justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-[#e0dfdb] px-2 py-[3px] font-mono text-[11.5px]">{t.human_id}</span>
              <span className="rounded-full px-[9px] py-[3px] text-[11.5px] font-semibold" style={{ background: '#f4f3f0', color: col.color }}>{t.col === 'closed' ? 'Closed' : t.col === 'ack' ? 'Resolved · awaiting acknowledgement' : col.l}</span>
              <span className="rounded-md border border-[#e0dfdb] px-2 py-[3px] text-[11.5px] font-semibold" style={{ color: PRIOC[t.priority] || '#55555e' }}>{t.priority}</span>
            </div>
            <button onClick={onClose} aria-label="Close" className="h-[30px] w-[30px] flex-none rounded-lg border border-[#e0dfdb] bg-white text-sm text-[#55555e]">✕</button>
          </div>
          <span className="text-[17px] font-semibold leading-[1.3]">{t.title}</span>
          <span className="text-[#6b6b76]">{t.category || 'No category'} · {t.location || 'No location'}{t.seat_number ? ` · Seat ${t.seat_number}` : ''}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-[22px] py-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5 rounded-[9px] px-3 py-2.5" style={{ background: sb }}>
              <span className="text-[11px] text-[#6b6b76]">Resolution SLA{t.sla_resolution_due ? ` · target ${fmtWorkingDuration(t.raised_at || t.created_at, t.sla_resolution_due)}` : ''}</span>
              <span className="text-[15px] font-semibold" style={{ color: sf }}>{sla}</span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-[9px] bg-[#f7f6f3] px-3 py-2.5">
              <span className="text-[11px] text-[#6b6b76]">Raised</span>
              <span className="text-[15px] font-semibold">{days ? `${days} day${days === 1 ? '' : 's'} ago` : 'Today'}</span>
              <span className="text-[11px] text-[#8a8a93]">by {t.raised_by_name || t.issue_user_name || 'Unknown'}{t.issue_user_name && t.issue_user_name !== t.raised_by_name ? ` for ${t.issue_user_name}` : ''}</span>
            </div>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] text-[#6b6b76]">Assignee</span>
            <AppSelect value={t.assignee_id || ''} onValueChange={onAssign} options={options} disabled={!editable} aria-label="Assignee" className="h-auto rounded-lg border-[#e0dfdb] px-[9px] py-2 text-[13px]" />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-[11.5px] text-[#6b6b76]">Move to</span>
            {moves.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {moves.map((c) => (
                  <button key={c.k} onClick={() => onMove(c.k)} className="flex items-center gap-1.5 rounded-lg border border-[#e0dfdb] bg-white px-3 py-[7px] text-[12.5px]">
                    <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.k === 'closed' ? 'Closed' : c.l}
                  </button>
                ))}
              </div>
            )}
            {t.col === 'appr' && (
              <div className="flex items-center justify-between gap-2.5 rounded-[9px] bg-[#fbe9f4] px-3 py-2.5">
                <span className="leading-[1.4] text-[#8a0f61]">Locked until {t.apr?.human_id || 'the approval'} is decided.</span>
                <button onClick={onGoApprovals} className="whitespace-nowrap bg-transparent font-semibold text-[#b3177f] hover:underline">Open approval →</button>
              </div>
            )}
            {t.col === 'ack' && (
              <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[9px] bg-[#e8f4f5] px-3 py-2.5">
                <span className="leading-[1.4] text-[#0b5f67]">Resolved — waiting for {t.issue_user_name || t.raised_for_name || 'the employee'} to acknowledge. It closes when they do.</span>
                {canMove(t) && <button onClick={() => onMove('closed')} className="whitespace-nowrap rounded-lg border border-[#b8dade] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#0b5f67]">Close without ack</button>}
              </div>
            )}
            {t.col === 'closed' && <span className="text-xs text-[#8a8a93]">Closed tickets are final and cannot be moved.</span>}
            {editable && !canResolve && <span className="text-xs text-[#8a8a93]">Only the assignee or a team head can move this ticket.</span>}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[11.5px] text-[#6b6b76]">Daily remarks{remarks.length ? ` · ${remarks.length}` : ''}</span>
            {canRemark && (
              <div className="flex flex-col gap-1.5 rounded-[9px] border border-[#e8e7e3] p-2.5">
                <textarea
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Today's update on this ticket — progress, blockers, next step…"
                  className="resize-y rounded-md border border-[#e0dfdb] px-2.5 py-2 text-[13px] text-[#17171c] outline-none focus:border-[#b3177f]"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[#8a8a93]">{myToday ? 'You added a remark today — saving updates it.' : 'One remark per person per day.'}</span>
                  <button onClick={saveRemark} disabled={saving} className="rounded-lg bg-[#17171c] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60">{saving ? 'Saving…' : myToday ? 'Update remark' : 'Add remark'}</button>
                </div>
              </div>
            )}
            {remarks.slice(0, 6).map((r) => (
              <div key={r.id} className="flex flex-col gap-0.5 rounded-lg bg-[#f7f6f3] px-2.5 py-2">
                <span className="whitespace-pre-wrap text-[12.5px] text-[#2b2b33]">{r.remark}</span>
                <span className="text-[11px] text-[#8a8a93]">{r.by_name} · {r.date === today ? 'Today' : shortKey(r.date)}</span>
              </div>
            ))}
            {!remarks.length && !canRemark && <span className="text-xs text-[#9a9aa3]">No daily remarks were added.</span>}
          </div>
          <div className="flex flex-col">
            <span className="mb-1.5 text-[11.5px] text-[#6b6b76]">Recent activity</span>
            {history === null && <span className="text-xs text-[#9a9aa3]">Loading…</span>}
            {history && !events.length && <span className="text-xs text-[#9a9aa3]">No activity recorded yet.</span>}
            {events.map((e, i) => (
              <div key={e.id || i} className="grid grid-cols-[12px_minmax(0,1fr)] gap-2.5">
                <div className="flex flex-col items-center"><span className="mt-[5px] h-2 w-2 rounded-full bg-[#b3177f]" />{i < events.length - 1 && <span className="min-h-2.5 w-0.5 flex-1 bg-[#efeeea]" />}</div>
                <div className="flex flex-col pb-2.5">
                  <span>{String(e.type || 'update').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}{e.to ? `: ${e.to}` : ''}</span>
                  {e.note && <span className="text-xs text-[#55555e]">{e.note}</span>}
                  <span className="text-[11.5px] text-[#8a8a93]">{e.by_name || 'System'} · {new Date(e.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#efeeea] px-[22px] py-3.5">
          {onDelete && <button onClick={onDelete} className="mr-auto rounded-lg border border-[#f1d3d0] bg-white px-3 py-2 text-[12.5px] text-[#b42318] hover:bg-[#fdf5f4]">Delete ticket</button>}
          <button onClick={onFull} className="rounded-lg border border-[#e0dfdb] bg-white px-3 py-2 text-[12.5px] text-[#17171c]">Full ticket</button>
          {canResolve && <button onClick={() => onMove('closed')} className="rounded-lg bg-[#12795a] px-3.5 py-2 text-[12.5px] text-white">Resolve ticket</button>}
        </div>
      </aside>
    </>
  )
}

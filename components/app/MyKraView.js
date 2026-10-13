'use client'

// "My Checklist" for IT and Admin members (team heads included): set up a daily
// checklist, tick it off each working day before the 7:00 PM cut-off, and
// review past submissions. Checklist days are IST calendar days, matching the API.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/appapi'
import { AppSelect } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { compareText } from '@/lib/sort'
import TeamChecklists, { DownloadReportButton, monthRange } from '@/components/app/ChecklistReport'

const GRN = '#12795a', AMB = '#8a5a00', RED = '#b42318', MAG = '#b3177f'
const TZ = 'Asia/Kolkata'
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOWL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DONE_TICKET = ['Closed', 'Resolved', 'Cancelled']

const ST = {
  complete: { bg: GRN, fg: '#fff', l: 'Complete', p: ['#e4f3ec', GRN] },
  partial: { bg: '#d9a13a', fg: '#fff', l: 'Partial', p: ['#fdf3dc', AMB] },
  late: { bg: '#e0822f', fg: '#fff', l: 'Late', p: ['#fdeee0', '#a34d0e'] },
  missed: { bg: '#d4553a', fg: '#fff', l: 'Missed', p: ['#fdeaea', RED] },
  off: { bg: '#f7f6f3', fg: '#c4c2bb', l: 'Not due', p: ['#f1f0ec', '#6b6b76'] },
  pre: { bg: '#f1f0ec', fg: '#9a9aa3', l: 'Not set up', p: ['#f1f0ec', '#6b6b76'] },
  due: { bg: 'transparent', fg: MAG, l: 'Due today', border: '1.5px dashed #b3177f', p: ['#fbe9f4', '#8a0f61'] },
  upcoming: { bg: 'transparent', fg: '#c4c2bb', l: 'Upcoming', border: '1px solid #efeeea', p: ['#f1f0ec', '#6b6b76'] },
}
const SUBMITTED = ['complete', 'partial', 'late']

const TEMPLATES = {
  IT: {
    name: 'IT daily checklist',
    items: [
      ['Daily internet & Wi-Fi check', 'daily', 'Daily Operations'],
      ['VC room readiness', 'daily', 'Device Configuration'],
      ['Antivirus / endpoint status', 'daily', 'Endpoint Security'],
      ['Asset movements logged', 'daily', 'Asset Transfer'],
      ['User account changes', 'daily', 'Account & Access Management'],
      ['Open tickets reviewed', 'daily', null],
      ['Inventory spot-check', 'weekly', 'IT Asset Inventory'],
    ],
  },
  Admin: {
    name: 'Admin daily checklist',
    items: [
      ['Housekeeping & washroom round', 'daily', 'Housekeeping & Hygiene'],
      ['Pantry & cafeteria stock check', 'daily', 'Pantry & Cafeteria'],
      ['Security & access log review', 'daily', 'Access Control'],
      ['Facility issues logged', 'daily', 'Facilities & Maintenance'],
      ['Parking allocation check', 'daily', 'Parking Management'],
      ['Open tickets reviewed', 'daily', null],
      ['Office supplies stock count', 'weekly', 'Office Supplies & Stationery'],
    ],
  },
}

// ---- IST date helpers (keys are YYYY-MM-DD) ----
export const istKey = (value = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
export const istTime = (value) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
const keyDate = (key) => new Date(`${key}T12:00:00Z`)
export const dowMon = (key) => (keyDate(key).getUTCDay() + 6) % 7
export const addDays = (key, n) => {
  const d = keyDate(key)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const fmtDay = (key, opts) => keyDate(key).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts })
const daysInMonth = (month) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
const shiftMonth = (month, n) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}
export const cutoffAt = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 19, 0) - 330 * 60000)
}
export const runsOn = (list, key) => String(list.frequency || '').toLowerCase() !== 'weekdays' || dowMon(key) < 5
export const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
export const fmtLeft = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
const isExtra = (r) => r?.extra === true || r?.self_added === true || String(r?.key || '').startsWith('extra_')
const seg = (on) => (on ? 'bg-white text-[#17171c] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'bg-transparent text-[#6b6b76]')

export function emptyDay() {
  return { ticks: {}, na: {}, notes: {}, extras: [], remark: '' }
}

// Rebuild the editable day from a stored submission (used after "Edit").
export function dayFromSubmission(list, sub) {
  const day = emptyDay()
  for (const r of sub.responses || []) {
    if (isExtra(r)) {
      day.extras.push(r.item)
      continue
    }
    const item = (list.items || []).find((it) => it.key === r.key || it.label === r.item)
    if (!item) continue
    day.ticks[item.key] = !!r.done
    day.na[item.key] = !!r.na
    if (r.remark) day.notes[item.key] = r.remark
  }
  day.remark = sub.remark || ''
  return day
}

const draftKey = (list) => `kra-draft:${list.id}:${list.today}`
export function readDraft(list) {
  try {
    const raw = window.localStorage.getItem(draftKey(list))
    return raw ? { ...emptyDay(), ...JSON.parse(raw) } : null
  } catch {
    return null
  }
}
export function writeDraft(list, day) {
  try {
    window.localStorage.setItem(draftKey(list), JSON.stringify(day))
  } catch {
    // Drafts are a convenience; private windows may block storage.
  }
}
export function clearDraft(list) {
  try {
    window.localStorage.removeItem(draftKey(list))
  } catch {
    // ignore
  }
}

function downloadTemplate(dept) {
  const tpl = TEMPLATES[dept] || TEMPLATES.IT
  const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const csv = ['Task,Repeats,Linked category', ...tpl.items.map(([t, f, l]) => [t, f === 'weekly' ? 'Weekly' : 'Daily', l || ''].map(esc).join(','))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'kra_template.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const card = 'min-w-0 rounded-[14px] border border-[#e8e7e3] bg-white'

export default function MyKraView({ user }) {
  const dept = user.role === 'admin' ? 'Admin' : 'IT'
  const [lists, setLists] = useState(null)
  const [subs, setSubs] = useState([])
  const [cats, setCats] = useState([])
  const [tickets, setTickets] = useState([])
  const [team, setTeam] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const [tab, setTab] = useState('today')
  const [listId, setListId] = useState(null)
  const [editing, setEditing] = useState(false)
  const [setup, setSetup] = useState(null)
  const [day, setDay] = useState(emptyDay)
  const [noteOpen, setNoteOpen] = useState({})
  const [extraInput, setExtraInput] = useState('')
  const [remarkErr, setRemarkErr] = useState(false)
  const [reopened, setReopened] = useState(false)
  const [busy, setBusy] = useState(false)
  const [month, setMonth] = useState(() => istKey().slice(0, 7))
  const [selDay, setSelDay] = useState(null)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reasonText, setReasonText] = useState('')
  const fileRef = useRef(null)
  const importMode = useRef('replace')

  const load = useCallback(async () => {
    const thisMonth = istKey().slice(0, 7)
    const [l, s, c, t, tm] = await Promise.allSettled([
      api('/member-checklists'),
      api('/member-checklist-submissions?limit=1000'),
      api(`/categories?department=${dept}`),
      api(`/tickets?assignee_id=${user.id}&limit=1000`),
      api(`/member-checklists/team-compliance?from=${thisMonth}-01`),
    ])
    if (l.status === 'fulfilled') setLists(l.value)
    else {
      setLists((prev) => prev || [])
      toast.error(l.reason?.message || 'Could not load your checklist')
    }
    if (s.status === 'fulfilled') setSubs(s.value)
    if (c.status === 'fulfilled') setCats(c.value.map((x) => x.name))
    if (t.status === 'fulfilled') setTickets(t.value.items || [])
    if (tm.status === 'fulfilled') setTeam(tm.value)
  }, [dept, user.id])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  const list = lists?.find((l) => l.id === listId) || lists?.[0] || null
  const today = list?.today || istKey(now)
  const deadline = cutoffAt(today)
  const pastCutoff = now > deadline
  const sub = list?.today_submission || null
  const locked = !!sub && !reopened

  // Re-seed the editable day whenever the list or its stored submission changes.
  const seedKey = `${list?.id}|${sub?.submitted_at || ''}`
  useEffect(() => {
    if (!list) return
    setDay(sub ? dayFromSubmission(list, sub) : readDraft(list) || emptyDay())
    setReopened(false)
    setNoteOpen({})
    setRemarkErr(false)
  }, [seedKey])
  useEffect(() => {
    if (list && !sub) writeDraft(list, day)
  }, [day])

  const catOptions = useMemo(() => [['', 'No link — tick by hand'], ...cats.map((c) => [c, c])], [cats])
  const validLink = useCallback((link) => (link && cats.includes(link) ? link : ''), [cats])

  // ---- setup / edit ----
  const startSetup = (src, base) => {
    if (src === 'tpl') {
      const tpl = TEMPLATES[dept]
      setSetup({ src, name: tpl.name, rows: tpl.items.map(([t, freq, link]) => ({ t, freq, link: validLink(link) })), add: '' })
    } else if (src === 'blank') {
      setSetup((s) => ({ src, name: s?.src === 'edit' ? s.name : 'My daily checklist', rows: [0, 1, 2].map(() => ({ t: '', freq: 'daily', link: '' })), add: '' }))
    } else if (src === 'edit') {
      setSetup({ src, name: base.title, rows: (base.items || []).map((it) => ({ t: it.label, freq: it.freq === 'weekly' ? 'weekly' : 'daily', link: validLink(it.link) })), add: '' })
    }
  }
  const isSetup = tab === 'today' && (!list || editing)
  useEffect(() => {
    if (isSetup && !setup) startSetup('tpl')
  }, [isSetup, setup, cats])

  const editList = () => {
    startSetup('edit', list)
    setEditing(true)
    setTab('today')
  }
  const pickFile = (mode) => {
    importMode.current = mode
    fileRef.current?.click()
  }
  const onFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const data = new FormData()
    data.append('file', file)
    try {
      const result = await api('/member-checklists/import-preview', { method: 'POST', body: data, timeout: 30000 })
      const imported = (result.rows || (result.items || []).map((label) => ({ label }))).map((r) => ({
        t: r.label,
        freq: r.freq === 'weekly' ? 'weekly' : 'daily',
        link: validLink(r.link),
      }))
      const name = file.name.replace(/\.(xlsx|csv)$/i, '').replace(/[_-]+/g, ' ').trim()
      if (importMode.current === 'append' && list) {
        // From the header on an existing checklist: open the editor with the file's
        // rows added after the current ones, so nothing is lost until saved.
        const current = (list.items || []).map((it) => ({ t: it.label, freq: it.freq === 'weekly' ? 'weekly' : 'daily', link: validLink(it.link) }))
        const seen = new Set(current.map((r) => r.t.toLowerCase()))
        const added = imported.filter((r) => !seen.has(r.t.toLowerCase()))
        setSetup({ src: 'edit', name: list.title, rows: [...current, ...added], add: '' })
        setEditing(true)
        setTab('today')
        toast.success(`${pl(added.length, 'new item')} added from ${file.name} — review and save`)
      } else {
        setSetup({ src: 'csv', name: name || 'My daily checklist', rows: imported, add: '' })
        setTab('today')
        toast.success(`Imported ${pl(imported.length, 'item')} from ${file.name}`)
      }
    } catch (error) {
      toast.error(error.message)
    }
  }

  const saveSetup = async () => {
    const items = setup.rows.filter((r) => r.t.trim()).map((r) => ({ label: r.t.trim(), freq: r.freq, link: r.link || null }))
    if (!items.length) return toast.error('Add at least one item')
    const keys = items.map((i) => i.label.toLowerCase())
    if (new Set(keys).size !== keys.length) return toast.error('Remove the duplicate items first')
    setBusy(true)
    try {
      if (editing && list) {
        await api(`/member-checklists/${list.id}`, { method: 'PATCH', body: { title: setup.name.trim() || list.title, items } })
        toast.success('Checklist saved')
      } else {
        const created = await api('/member-checklists', { method: 'POST', body: { title: setup.name.trim() || 'My daily checklist', items, frequency: 'Weekdays' } })
        setListId(created.id)
        toast.success(`Daily checklist created · ${pl(items.length, 'item')}`)
      }
      setEditing(false)
      setSetup(null)
      await load()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  // ---- today ----
  const dueKeys = list?.due_item_keys
  const dueItems = useMemo(
    () => (list?.items || []).filter((it) => (dueKeys ? dueKeys.includes(it.key) : it.freq !== 'weekly' || dowMon(today) === 0)),
    [list, dueKeys, today],
  )
  const weeklyHidden = (list?.items || []).length - dueItems.length
  const closedToday = tickets.filter((t) => t.status === 'Closed' && istKey(t.closed_at || t.resolved_at || t.updated_at) === today)
  const openTickets = tickets.filter((t) => !DONE_TICKET.includes(t.status))
  const applicable = dueItems.filter((it) => !day.na[it.key])
  const doneN = applicable.filter((it) => day.ticks[it.key]).length
  const tot = applicable.length
  const naN = dueItems.length - tot
  const full = tot > 0 && doneN === tot
  const guard = (fn) => () => {
    if (locked) {
      toast(pastCutoff ? 'Today’s checklist is final after the 7:00 PM cut-off' : 'Click “Edit until 7:00 PM” to change your submission')
      return
    }
    fn()
  }
  const setTick = (key, value) => setDay((d) => ({ ...d, ticks: { ...d.ticks, [key]: value }, na: { ...d.na, [key]: false } }))
  const suggestions = dueItems.filter((it) => it.link && !day.ticks[it.key] && !day.na[it.key] && closedToday.some((t) => t.category === it.link))

  const submit = async () => {
    if (!tot && !day.extras.length) return toast.error('Nothing applicable to submit')
    if (!full && tot && !day.remark.trim()) {
      setRemarkErr(true)
      return toast.error('Add a short reason for the unticked items')
    }
    setBusy(true)
    try {
      const responses = dueItems.map((it) => ({ key: it.key, item: it.label, done: !!day.ticks[it.key] && !day.na[it.key], na: !!day.na[it.key], remark: day.notes[it.key] || '' }))
      const result = await api(`/member-checklists/${list.id}/submit`, {
        method: 'POST',
        body: { responses, extra_items: day.extras.map((item) => ({ item, done: true })), remark: full ? '' : day.remark.trim() },
      })
      clearDraft(list)
      toast.success(`Checklist submitted · ${result.status === 'Completed' ? 'Complete' : result.status}`)
      await load()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  // ---- history / compliance (per selected list) ----
  const subsByDate = useMemo(() => {
    const map = new Map()
    if (!list) return map
    for (const s of subs) if (s.checklist_id === list.id && !map.has(s.date)) map.set(s.date, s)
    if (list.today_submission) map.set(today, list.today_submission)
    return map
  }, [subs, list, today])
  const startKey = list?.created_at ? istKey(list.created_at) : today
  const status = useCallback(
    (key) => {
      if (!list) return key > today ? 'upcoming' : 'pre'
      if (key > today) return 'upcoming'
      const s = subsByDate.get(key)
      if (s) return s.status === 'Late' ? 'late' : s.status === 'Completed' ? 'complete' : 'partial'
      if (!runsOn(list, key)) return 'off'
      if (key < startKey) return 'pre'
      if (key === today) return pastCutoff ? 'missed' : 'due'
      return 'missed'
    },
    [list, today, subsByDate, startKey, pastCutoff],
  )
  const eligibleIn = (keys) => keys.filter((k) => SUBMITTED.includes(status(k)) || status(k) === 'missed')
  const monthKeys = (m) => Array.from({ length: daysInMonth(m) }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`)
  const curMonth = today.slice(0, 7)

  const compliance = useMemo(() => {
    const back = Array.from({ length: 120 }, (_, i) => addDays(today, -i)).filter((k) => k >= startKey)
    const elig = eligibleIn(back)
    const l7 = elig.slice(0, 7)
    const s7 = l7.filter((k) => SUBMITTED.includes(status(k))).length
    let streak = 0
    for (const k of elig) {
      if (!SUBMITTED.includes(status(k))) break
      streak++
    }
    const monthElig = eligibleIn(monthKeys(curMonth))
    const monthSub = monthElig.filter((k) => SUBMITTED.includes(status(k))).length
    return { l7: l7.length, s7, streak, monthElig: monthElig.length, monthSub, rate: monthElig.length ? Math.round((monthSub / monthElig.length) * 100) : null }
  }, [status, today, startKey, curMonth])

  const pickDay = (k) => {
    setSelDay(k)
    setReasonOpen(false)
    setReasonText('')
  }
  const goDay = (k) => {
    setMonth(k.slice(0, 7))
    pickDay(k)
    setTab('subs')
  }
  const sendReason = async (date) => {
    if (!reasonText.trim()) return toast.error('Add a short reason')
    setBusy(true)
    try {
      await api(`/member-checklists/${list.id}/missed-reason`, { method: 'POST', body: { date, reason: reasonText.trim() } })
      toast.success(list.reports_to?.length ? `Reason sent to ${list.reports_to.join(', ')}` : 'Reason sent to your manager')
      setReasonOpen(false)
      setReasonText('')
      await load()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  if (!lists)
    return (
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3.5">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-[420px] w-full rounded-[14px]" />
      </div>
    )

  const sd = sub
  const isHead = !!user.is_team_head
  const reportsTo = list?.reports_to?.length ? ` · reports to ${list.reports_to.join(', ')}` : ''
  const subtitle = list ? `${user.name} · ${dept} · ${pl((list.items || []).length, 'item')}${reportsTo}` : `${user.name} · no daily checklist yet`
  const tabs = [
    ['today', 'Today', sd ? '✓ Done' : !list ? 'Set up' : pastCutoff ? 'Missed' : 'Due', sd ? ['#e4f3ec', GRN] : pastCutoff && list ? ['#fdeaea', RED] : ['#fbe9f4', '#8a0f61']],
    ['subs', 'Submissions', compliance.rate == null ? '—' : `${compliance.rate}%`, ['#f1f0ec', '#55555e']],
    ...(isHead ? [['team', 'Team checklists', team?.members ?? '—', ['#f1f0ec', '#55555e']]] : []),
  ]
  const reportRange = monthRange(month)

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-3.5 text-[13px] text-[#17171c]">
      <input ref={fileRef} type="file" className="sr-only" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={onFile} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[3px]">
          <h2 className="m-0 text-[21px] font-semibold tracking-[-.01em]">My Checklist</h2>
          <div className="text-[12.5px] text-[#6b6b76]">{subtitle}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-[7px] rounded-full border border-[#e8e7e3] bg-white px-3 py-1.5 text-[12.5px] text-[#3b3b44]">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: pastCutoff ? RED : MAG }} />
            Cut-off 7:00 PM · <strong className="font-semibold">{pastCutoff ? 'passed' : `${fmtLeft(deadline - now)} left`}</strong>
          </span>
          <button onClick={() => pickFile(list ? 'append' : 'replace')} className="rounded-[9px] border border-[#e0dfdb] bg-white px-3 py-[7px] text-[12.5px] text-[#17171c]">Upload Excel / CSV</button>
          {isHead && <DownloadReportButton scope="team" from={reportRange.from} to={reportRange.to} label={`Export all members · ${fmtDay(`${month}-01`, { month: 'short', year: 'numeric' })}`} primary />}
          {list && <DownloadReportButton scope="me" from={reportRange.from} to={reportRange.to} label={`Download my report · ${fmtDay(`${month}-01`, { month: 'short', year: 'numeric' })}`} />}
          <button onClick={() => downloadTemplate(dept)} className="rounded-[9px] bg-transparent px-2 py-[7px] text-[12.5px] text-[#55555e] underline">Download template</button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex gap-0.5 self-start rounded-[10px] bg-[#ebeae6] p-[3px]">
          {tabs.map(([key, label, badge, b]) => (
            <button key={key} onClick={() => { setTab(key); if (key !== 'today') setEditing(false) }} className={`flex items-center gap-2 rounded-lg px-3.5 py-[7px] text-[13px] font-medium ${seg(tab === key)}`}>
              {label}
              <span className="rounded-full px-[7px] py-px text-[10.5px] font-semibold" style={{ background: b[0], color: b[1] }}>{badge}</span>
            </button>
          ))}
        </div>
        {lists.length > 1 && (
          <AppSelect
            value={list.id}
            onValueChange={(v) => { setListId(v); setEditing(false); setSetup(null); setSelDay(null) }}
            options={lists.map((l) => [l.id, l.title])}
            aria-label="Checklist"
            className="h-auto w-auto max-w-[260px] rounded-[9px] border-[#e0dfdb] px-3 py-[7px] text-[12.5px]"
          />
        )}
      </div>

      {tab === 'team' && isHead && <TeamChecklists user={user} />}

      {isSetup && setup && (
        <SetupView
          setup={setup}
          setSetup={setSetup}
          editing={editing && !!list}
          busy={busy}
          dept={dept}
          catOptions={catOptions}
          onSource={(k) => (k === 'csv' ? pickFile('replace') : startSetup(k))}
          onCancel={() => { setEditing(false); setSetup(null) }}
          onSave={saveSetup}
        />
      )}

      {tab === 'today' && !isSetup && list && (
        <section className="flex flex-wrap items-start gap-3">
          <div className={`${card} flex-[1_1_580px] overflow-hidden`}>
            <div className="flex flex-wrap items-center gap-4 border-b border-[#f1f0ec] px-5 py-[18px]">
              <Ring pct={tot ? doneN / tot : 0} color={full ? GRN : MAG} />
              <div className="flex min-w-[200px] flex-1 flex-col gap-[3px]">
                <span className="text-base font-semibold">{list.title}</span>
                <span className="text-[#55555e]">
                  {fmtDay(today, { weekday: 'short', day: 'numeric', month: 'short' })} · {doneN} of {tot} done{naN ? ` · ${naN} N/A` : ''} · {pastCutoff ? 'cut-off passed' : `${fmtLeft(deadline - now)} to cut-off`}
                  {!list.due_today ? ' · not a working day' : ''}
                </span>
              </div>
              <button onClick={editList} className="rounded-lg border border-[#e0dfdb] bg-white px-3 py-[7px] text-[12.5px]">Edit checklist</button>
            </div>
            {suggestions.length > 0 && !locked && (
              <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#dcece3] bg-[#f1f8f4] px-5 py-2.5">
                <span className="leading-[1.45] text-[#0f5c45]"><strong className="font-semibold">{pl(suggestions.length, 'item')} can be ticked for you.</strong> You closed matching tickets today.</span>
                <button
                  onClick={() => {
                    setDay((d) => {
                      const ticks = { ...d.ticks }
                      suggestions.forEach((it) => { ticks[it.key] = true })
                      return { ...d, ticks }
                    })
                    toast.success(`Ticked ${pl(suggestions.length, 'item')} from closed tickets`)
                  }}
                  className="rounded-[7px] bg-[#12795a] px-3 py-1.5 text-[12.5px] text-white"
                >
                  Tick from tickets
                </button>
              </div>
            )}
            <div className="flex flex-col">
              {dueItems.map((it) => {
                const k = it.key
                const tk = !!day.ticks[k]
                const na = !!day.na[k]
                const cl = it.link ? closedToday.filter((t) => t.category === it.link) : []
                const op = it.link ? openTickets.filter((t) => t.category === it.link) : []
                let ev = ''
                let evc = '#8a8a93'
                if (na) ev = 'Not applicable today — excluded from your score'
                else if (cl.length) { ev = `${pl(cl.length, 'ticket')} closed today · ${cl.map((t) => t.human_id).join(', ')}`; evc = GRN }
                else if (op.length) { ev = tk ? `Ticked, but ${op[0].human_id} is still open` : `${op[0].human_id} is still open — close it to tick from tickets`; evc = AMB }
                else if (it.link) ev = `Can be ticked when a ${it.link} ticket closes`
                return (
                  <div key={k} className={`grid grid-cols-[24px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 border-b border-[#f4f3f0] px-5 py-3 sm:grid-cols-[24px_minmax(0,1fr)_auto] ${tk ? 'bg-[#fbfdfc]' : ''}`}>
                    <button
                      onClick={guard(() => setTick(k, !tk))}
                      aria-label={tk ? `Untick ${it.label}` : `Tick ${it.label}`}
                      className="mt-px grid h-[22px] w-[22px] place-items-center rounded-md p-0 text-xs text-white"
                      style={{ background: tk ? GRN : 'transparent', border: tk ? '0' : '1.5px solid #cfcdc6' }}
                    >
                      {tk ? '✓' : ''}
                    </button>
                    <div className="flex min-w-0 flex-col gap-[3px]">
                      <span className="font-medium" style={{ textDecoration: na ? 'line-through' : 'none', color: na ? '#9a9aa3' : undefined }}>
                        {it.label}
                        {it.freq === 'weekly' && <span className="ml-2 rounded px-1.5 py-px text-[10px] font-semibold text-[#55555e] bg-[#f1f0ec]">Weekly</span>}
                      </span>
                      {ev && <span className="text-xs leading-[1.4]" style={{ color: evc }}>{ev}</span>}
                      {noteOpen[k] && (
                        <input
                          value={day.notes[k] || ''}
                          disabled={locked}
                          onChange={(e) => { const v = e.target.value; setDay((d) => ({ ...d, notes: { ...d.notes, [k]: v } })) }}
                          placeholder="Note for your manager"
                          className="mt-1 rounded-[7px] border border-[#e0dfdb] px-[9px] py-1.5 text-[12.5px] text-[#17171c] outline-none"
                        />
                      )}
                    </div>
                    <div className="col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-3 sm:justify-end">
                      {cl.length > 0 && !tk && !na && !locked && (
                        <button onClick={() => setTick(k, true)} className="rounded-md border border-[#bfe0cf] bg-[#f1f8f4] px-[9px] py-1 text-[11.5px] font-medium text-[#12795a]">Tick from tickets</button>
                      )}
                      <button
                        onClick={guard(() => setDay((d) => ({ ...d, na: { ...d.na, [k]: !na }, ticks: { ...d.ticks, [k]: false } })))}
                        className={`rounded-md border border-[#e0dfdb] px-2 py-1 text-[11.5px] ${na ? 'bg-[#17171c] text-white' : 'bg-white text-[#55555e]'}`}
                      >
                        N/A today
                      </button>
                      <button onClick={() => setNoteOpen((o) => ({ ...o, [k]: !o[k] }))} className="rounded-md border border-[#e0dfdb] bg-white px-2 py-1 text-[11.5px] text-[#55555e]">
                        {day.notes[k] ? 'Note ✓' : 'Note'}
                      </button>
                    </div>
                  </div>
                )
              })}
              {!dueItems.length && <div className="border-b border-[#f4f3f0] px-5 py-4 text-[#8a8a93]">No checklist items are due today.</div>}
              {weeklyHidden > 0 && <div className="border-b border-[#f4f3f0] px-5 py-2.5 text-xs text-[#8a8a93]">{pl(weeklyHidden, 'weekly item')} hidden today — due Monday</div>}
            </div>

            <div className="flex flex-col gap-[9px] border-b border-[#f1f0ec] px-5 py-3.5">
              <span className="font-semibold">Extra work today <span className="font-normal text-[#8a8a93]">· {day.extras.length}</span></span>
              {day.extras.map((t, i) => (
                <div key={`${t}-${i}`} className="flex items-center gap-[9px]">
                  <span className="h-1.5 w-1.5 flex-none rounded-full bg-[#b3177f]" />
                  <span className="flex-1">{t}</span>
                  {!locked && <button onClick={() => setDay((d) => ({ ...d, extras: d.extras.filter((_, j) => j !== i) }))} aria-label="Remove" className="bg-transparent text-sm text-[#9a9aa3]">×</button>}
                </div>
              ))}
              {!locked && (
                <div className="flex gap-2">
                  <input
                    value={extraInput}
                    onChange={(e) => setExtraInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && extraInput.trim()) {
                        setDay((d) => ({ ...d, extras: [...d.extras, extraInput.trim()] }))
                        setExtraInput('')
                      }
                    }}
                    placeholder="Anything outside your checklist, e.g. Set up VC for all-hands"
                    className="min-w-0 flex-1 rounded-lg border border-[#e0dfdb] bg-white px-2.5 py-[7px] text-[12.5px] text-[#17171c] outline-none"
                  />
                  <button
                    onClick={() => { if (extraInput.trim()) { setDay((d) => ({ ...d, extras: [...d.extras, extraInput.trim()] })); setExtraInput('') } }}
                    className="rounded-lg border border-[#e0dfdb] bg-white px-3 py-[7px] text-[12.5px]"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>

            {!locked && (
              <div className="flex flex-col gap-2.5 bg-[#fbfaf8] px-5 py-3.5">
                {!full && tot > 0 && (
                  <textarea
                    value={day.remark}
                    onChange={(e) => { const v = e.target.value; setDay((d) => ({ ...d, remark: v })); setRemarkErr(false) }}
                    rows={2}
                    placeholder={`Why ${tot - doneN === 1 ? 'is 1 item' : `are ${tot - doneN} items`} not done? Your manager sees this.`}
                    className="resize-y rounded-lg bg-white px-2.5 py-2 text-[12.5px] text-[#17171c] outline-none"
                    style={{ border: `1px solid ${remarkErr ? '#e3a29b' : '#e0dfdb'}` }}
                  />
                )}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <WillBe pastCutoff={pastCutoff} full={full} left={tot - doneN} />
                  <div className="flex gap-2">
                    {reopened && <button onClick={() => { setReopened(false); setDay(dayFromSubmission(list, sd)) }} className="rounded-[9px] border border-[#e0dfdb] bg-white px-3.5 py-2.5 text-[13px]">Cancel</button>}
                    <button onClick={submit} disabled={busy} className="rounded-[9px] bg-[#17171c] px-[18px] py-2.5 text-[13px] font-medium text-white disabled:opacity-60">
                      {reopened ? 'Update submission' : full ? `Submit · ${doneN}/${tot}` : `Submit as partial · ${doneN}/${tot}`}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {locked && (
              <div className="flex flex-wrap items-center justify-between gap-2.5 bg-[#f1f8f4] px-5 py-3.5">
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-[#0f5c45]">✓ Submitted at {istTime(sd.submitted_at)} · {ST[status(today)]?.l}</span>
                  <span className="text-xs text-[#3b3b44]">
                    {sd.applicable_done ?? sd.done_count}/{sd.applicable_total ?? sd.total} items{day.extras.length ? ` · ${pl(day.extras.length, 'extra task')}` : ''} · your manager can see it now
                  </span>
                </div>
                {!pastCutoff && <button onClick={() => setReopened(true)} className="rounded-lg border border-[#bfe0cf] bg-white px-3 py-[7px] text-[12.5px]">Edit until 7:00 PM</button>}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
            <div className={`${card} flex flex-col gap-3.5 p-[18px]`}>
              <div className="flex items-center justify-between">
                <h3 className="m-0 text-sm font-semibold">My compliance</h3>
                <button onClick={() => { setMonth(curMonth); setTab('subs') }} className="bg-transparent p-0 text-[12.5px] text-[#b3177f]">Full history →</button>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  ['7-day', compliance.l7 ? `${Math.round((compliance.s7 / compliance.l7) * 100)}%` : '—', compliance.l7 ? `${compliance.s7} of ${pl(compliance.l7, 'day')}` : 'no days yet', '#17171c'],
                  ['This month', compliance.rate == null ? '—' : `${compliance.rate}%`, compliance.monthElig ? `${compliance.monthSub} of ${pl(compliance.monthElig, 'day')}` : 'no days yet', '#17171c'],
                  ['Streak', pl(compliance.streak, 'day'), compliance.streak ? 'keep it going' : 'submit to start', GRN],
                ].map(([l, v, s, c]) => (
                  <div key={l} className="flex flex-col gap-0.5">
                    <span className="text-[10.5px] uppercase tracking-[.05em] text-[#6b6b76]">{l}</span>
                    <span className="text-[22px] font-semibold tracking-[-.02em]" style={{ color: c }}>{v}</span>
                    <span className="text-[11.5px] text-[#8a8a93]">{s}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                {[
                  ['You', compliance.rate, MAG],
                  ['Team avg', team?.rate ?? null, '#9a9894'],
                ].map(([l, v, c]) => (
                  <div key={l} className="grid grid-cols-[78px_minmax(0,1fr)_38px] items-center gap-2.5">
                    <span className="text-xs text-[#55555e]">{l}</span>
                    <div className="h-2 overflow-hidden rounded bg-[#f1f0ec]"><div className="h-full rounded" style={{ width: `${v || 0}%`, background: c }} /></div>
                    <span className="text-right text-xs font-semibold">{v == null ? '—' : `${v}%`}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[10.5px] uppercase tracking-[.05em] text-[#6b6b76]">{fmtDay(`${curMonth}-01`, { month: 'long' })} · click a day</span>
                <MonthGrid month={curMonth} status={status} sel={null} small onPick={goDay} />
                <Legend />
              </div>
            </div>
            <MyTicketsToday tickets={tickets} today={today} />
          </div>
        </section>
      )}

      {tab === 'subs' && (
        <Submissions
          list={list}
          month={month}
          setMonth={(m) => { setMonth(m); pickDay(null) }}
          minMonth={startKey.slice(0, 7)}
          maxMonth={curMonth}
          today={today}
          status={status}
          subsByDate={subsByDate}
          selDay={selDay}
          pickDay={pickDay}
          monthKeys={monthKeys}
          eligibleIn={eligibleIn}
          compliance={compliance}
          reasonOpen={reasonOpen}
          setReasonOpen={setReasonOpen}
          reasonText={reasonText}
          setReasonText={setReasonText}
          sendReason={sendReason}
          busy={busy}
          onGoToday={() => setTab('today')}
          onSetup={() => setTab('today')}
        />
      )}
    </div>
  )
}

function Ring({ pct, color }) {
  return (
    <div className="grid h-16 w-16 flex-none place-items-center rounded-full" style={{ background: `conic-gradient(${color} ${Math.round(pct * 360)}deg,var(--ring-track) 0)` }}>
      <div className="grid h-[50px] w-[50px] place-items-center rounded-full bg-white text-[13px] font-semibold">{Math.round(pct * 100)}%</div>
    </div>
  )
}

function WillBe({ pastCutoff, full, left }) {
  const w = pastCutoff
    ? { ...ST.late, d: '— after the 7:00 PM cut-off' }
    : full
      ? { ...ST.complete, d: '— all items ticked before cut-off' }
      : { ...ST.partial, d: `— ${pl(left, 'item')} unticked` }
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-[#55555e]">
      Will be recorded as <span className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: w.p[0], color: w.p[1] }}>{w.l}</span>
      {w.d}
    </span>
  )
}

function Legend() {
  return (
    <div className="mt-0.5 flex flex-wrap gap-2.5 text-[11px] text-[#55555e]">
      {['complete', 'partial', 'late', 'missed', 'due'].map((k) => (
        <span key={k} className="flex items-center gap-[5px]">
          <span className="h-[9px] w-[9px] rounded-sm" style={{ background: ST[k].bg === 'transparent' ? MAG : ST[k].bg }} />
          {ST[k].l}
        </span>
      ))}
    </div>
  )
}

// Monday-first month grid. `cellText` adds the second line on the big calendar.
function MonthGrid({ month, status, sel, onPick, small, cellText }) {
  const first = `${month}-01`
  const cells = [...Array(dowMon(first)).fill(null)]
  for (let d = 1; d <= daysInMonth(month); d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7) cells.push(null)
  return (
    <div className={`grid grid-cols-7 ${small ? 'gap-1' : 'gap-[5px]'}`}>
      {DOW.map((d) => <span key={d} className={`text-center text-[#9a9aa3] ${small ? 'text-[10px]' : 'text-[10.5px]'}`}>{small ? d[0] : d}</span>)}
      {cells.map((k, i) => {
        if (!k) return <span key={`b${i}`} />
        const st = ST[status(k)]
        const n = Number(k.slice(8))
        const style = { background: st.bg, color: st.fg, border: st.border || '0', outline: sel === k ? '2px solid #17171c' : 'none', outlineOffset: 2 }
        const tip = `${fmtDay(k, { day: 'numeric', month: 'short' })} · ${st.l}`
        return small ? (
          <button key={k} title={tip} onClick={() => onPick(k)} className="h-[26px] rounded-md p-0 text-[10.5px] font-semibold" style={style}>{n}</button>
        ) : (
          <button key={k} title={tip} onClick={() => onPick(k)} className="flex h-[60px] min-w-0 flex-col items-start justify-between rounded-[9px] px-2 py-1.5 text-left" style={style}>
            <span className="text-xs font-semibold">{n}</span>
            <span className="max-w-full truncate text-[11px] font-medium">{cellText?.(k)}</span>
          </button>
        )
      })}
    </div>
  )
}

function MyTicketsToday({ tickets, today }) {
  const rows = tickets
    .map((t) => {
      const closedKey = t.status === 'Closed' ? istKey(t.closed_at || t.resolved_at || t.updated_at) : null
      const when = closedKey === today ? t.closed_at || t.resolved_at || t.updated_at : istKey(t.created_at) === today ? t.created_at : null
      return when ? { ...t, when } : null
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.when) - new Date(a.when))
  return (
    <div className={`${card} flex flex-col gap-2.5 p-[18px]`}>
      <h3 className="m-0 text-sm font-semibold">My tickets today</h3>
      {rows.slice(0, 8).map((t) => (
        <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-b border-[#f4f3f0] py-1.5">
          <div className="flex min-w-0 flex-col gap-px">
            <span className="truncate font-medium">{t.title}</span>
            <span className="text-[11.5px] text-[#8a8a93]"><span className="font-mono">{t.human_id}</span> · {t.category} · {istTime(t.when)}</span>
          </div>
          <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={t.status === 'Closed' ? { background: '#e4f3ec', color: GRN } : DONE_TICKET.includes(t.status) ? { background: '#f1f0ec', color: '#55555e' } : { background: '#fdf3dc', color: AMB }}>{t.status}</span>
        </div>
      ))}
      {!rows.length && <span className="text-[12.5px] text-[#9a9aa3]">No tickets handled today.</span>}
    </div>
  )
}

function SetupView({ setup, setSetup, editing, busy, dept, catOptions, onSource, onCancel, onSave }) {
  const rows = setup.rows
  const keys = rows.map((r) => r.t.trim().toLowerCase())
  const daily = rows.filter((r) => r.t.trim() && r.freq === 'daily')
  const nD = daily.length
  const nAll = rows.filter((r) => r.t.trim()).length
  const wk = rows.filter((r) => r.t.trim() && r.freq === 'weekly').length
  const q =
    nD === 0 ? { label: 'No daily items yet', bg: '#f1f0ec', fg: '#55555e' }
      : nD < 3 ? { label: `${nD} daily · add at least 3`, bg: '#fdf3dc', fg: AMB }
        : nD <= 8 ? { label: `${nD} daily · good size`, bg: '#e4f3ec', fg: GRN }
          : nD <= 12 ? { label: `${nD} daily · a bit long`, bg: '#fdf3dc', fg: AMB }
            : { label: `${nD} daily · too many, move some to weekly`, bg: '#fdeaea', fg: RED }
  const setRow = (i, patch) => setSetup((s) => ({ ...s, rows: s.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))
  const addRow = () => setSetup((s) => ({ ...s, rows: [...s.rows, { t: s.add.trim(), freq: 'daily', link: '' }], add: '' }))
  const tpl = TEMPLATES[dept]
  const sources = [
    ['tpl', `${dept} standard template`, `${pl(tpl.items.length, 'item')} most ${dept} members do daily`, true],
    ['blank', 'Start blank', 'Write your own list', false],
    ['csv', 'Import Excel / CSV', 'One item per row', false],
  ]
  const preview = daily.map((r) => ({ t: r.t, sub: r.link ? `Ticks from ${r.link} tickets` : 'Tick by hand', c: r.link ? GRN : '#8a8a93' }))
  const rules = [
    ['Complete', 'Every item ticked before 7:00 PM.', GRN],
    ['Partial', 'Submitted on time with items unticked — add a short reason.', '#d9a13a'],
    ['Late', 'Submitted after the 7:00 PM cut-off.', '#e0822f'],
    ['Missed', 'No submission on a working day (Mon–Fri).', '#d4553a'],
    ['N/A', 'Mark an item not applicable today — it won’t count against you.', '#9a9894'],
  ]
  return (
    <section className="flex flex-wrap items-start gap-3">
      <div className={`${card} flex flex-[1_1_580px] flex-col gap-4 px-[22px] py-5`}>
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-base font-semibold">{editing ? 'Edit your daily checklist' : 'Set up your daily checklist'}</h3>
          <span className="max-w-[640px] leading-normal text-[#55555e]">List the work you do every working day. The list stays the same each day, and you can still log extra work before you submit.</span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[11.5px] text-[#6b6b76]">Start from</span>
          <div className="flex flex-wrap gap-2">
            {sources.map(([k, l, d, rec]) => (
              <button
                key={k}
                onClick={() => onSource(k)}
                className={`flex flex-[1_1_170px] flex-col gap-[3px] rounded-[10px] px-3 py-[11px] text-left text-[#17171c] ${setup.src === k ? 'border-[1.5px] border-[#b3177f] bg-[#fdf5fa]' : 'border border-[#e8e7e3] bg-white'}`}
              >
                <span className="flex items-center justify-between gap-1.5">
                  <span className="font-semibold">{l}</span>
                  {rec && <span className="rounded bg-[#fbe9f4] px-1.5 py-px text-[10px] font-semibold text-[#8a0f61]">Recommended</span>}
                </span>
                <span className="text-xs leading-[1.4] text-[#6b6b76]">{d}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] text-[#6b6b76]">Checklist name</span>
          <input value={setup.name} onChange={(e) => { const v = e.target.value; setSetup((s) => ({ ...s, name: v })) }} className="rounded-[9px] border border-[#e0dfdb] px-3 py-[9px] text-[13px] text-[#17171c] outline-none" />
        </label>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <span className="font-semibold">Checklist items</span>
            <span className="rounded-full px-[9px] py-[3px] text-[11.5px] font-medium" style={{ background: q.bg, color: q.fg }}>{q.label}</span>
          </div>
          <div className="overflow-x-auto">
            <div className="flex min-w-[560px] flex-col gap-2">
              <div className="grid grid-cols-[22px_minmax(0,1fr)_126px_190px_28px] gap-2 text-[11px] text-[#8a8a93]"><span /><span>What you do</span><span>Repeats</span><span>Tick from tickets</span><span /></div>
              {rows.map((r, i) => {
                const k = keys[i]
                const dup = k && keys.filter((x) => x === k).length > 1
                const words = k.split(/\s+/).filter(Boolean)
                const vague = k && words.length <= 2 && /support|operations|work|tasks|misc|other/.test(k)
                const warn = dup ? 'Duplicate of another item' : vague ? 'Be specific — what exactly do you check or do?' : ''
                return (
                  <div key={i} className="flex flex-col gap-[3px]">
                    <div className="grid grid-cols-[22px_minmax(0,1fr)_126px_190px_28px] items-center gap-2">
                      <span className="text-center text-xs tabular-nums text-[#8a8a93]">{i + 1}</span>
                      <input value={r.t} onChange={(e) => setRow(i, { t: e.target.value })} placeholder="e.g. Check backup job status" className="min-w-0 rounded-lg px-2.5 py-[7px] text-[13px] text-[#17171c] outline-none" style={{ border: `1px solid ${dup ? '#e8c98a' : '#e0dfdb'}` }} />
                      <div className="flex gap-0.5 rounded-[7px] bg-[#efeeea] p-0.5">
                        {[['daily', 'Daily'], ['weekly', 'Weekly']].map(([f, l]) => (
                          <button key={f} onClick={() => setRow(i, { freq: f })} className={`flex-1 rounded-[5px] py-[5px] text-xs font-medium ${r.freq === f ? 'bg-white text-[#17171c]' : 'bg-transparent text-[#6b6b76]'}`}>{l}</button>
                        ))}
                      </div>
                      <AppSelect
                        value={r.link}
                        onValueChange={(v) => setRow(i, { link: v })}
                        options={catOptions}
                        aria-label={`Ticket category for item ${i + 1}`}
                        className={`h-auto min-w-0 rounded-lg border-[#e0dfdb] px-2 py-[7px] text-[12.5px] ${r.link ? 'text-[#17171c]' : 'text-[#8a8a93]'}`}
                      />
                      <button onClick={() => setSetup((s) => ({ ...s, rows: s.rows.filter((_, j) => j !== i) }))} title="Remove item" className="h-7 w-7 rounded-md bg-transparent p-0 text-base text-[#9a9aa3] hover:bg-[#fdeaea] hover:text-[#b42318]">×</button>
                    </div>
                    {warn && <span className="ml-[30px] text-[11.5px] text-[#8a5a00]">{warn}</span>}
                  </div>
                )
              })}
              <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2">
                <span className="text-center text-[15px] font-semibold text-[#b3177f]">+</span>
                <input
                  value={setup.add}
                  onChange={(e) => { const v = e.target.value; setSetup((s) => ({ ...s, add: v })) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') addRow() }}
                  placeholder="Add an item and press Enter"
                  className="rounded-lg border border-dashed border-[#d6d4ce] bg-[#fbfaf8] px-2.5 py-[7px] text-[13px] text-[#17171c] outline-none"
                />
                <button onClick={addRow} className="rounded-lg border border-[#e0dfdb] bg-white px-3.5 py-[7px] text-[12.5px]">Add</button>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f1f0ec] pt-3.5">
          <span className="max-w-[420px] text-xs leading-[1.45] text-[#6b6b76]">Linked items can be ticked straight from the tickets you close, so you only tick the rest by hand.</span>
          <div className="flex gap-2">
            {editing && <button onClick={onCancel} className="rounded-[9px] border border-[#e0dfdb] bg-white px-3.5 py-[9px] text-[13px]">Cancel</button>}
            <button onClick={onSave} disabled={busy} className="rounded-[9px] bg-[#b3177f] px-4 py-[9px] text-[13px] font-medium text-white hover:bg-[#8a0f61] disabled:opacity-60">
              {editing ? `Save checklist · ${pl(nAll, 'item')}` : `Create daily checklist · ${pl(nAll, 'item')}`}
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
        <div className={`${card} flex flex-col gap-3 p-[18px]`}>
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex flex-col gap-0.5">
              <h3 className="m-0 text-sm font-semibold">Preview · {fmtDay(istKey(), { weekday: 'short', day: 'numeric', month: 'short' })}</h3>
              <span className="text-xs text-[#6b6b76]">What you’ll tick each working day</span>
            </div>
            <span className="text-xs font-semibold text-[#55555e]">0 / {nD}</span>
          </div>
          <div className="flex flex-col">
            {preview.map((p, i) => (
              <div key={`${p.t}-${i}`} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2.5 border-b border-[#f4f3f0] py-2">
                <span className="mt-px box-border h-4 w-4 rounded border-[1.5px] border-[#d6d4ce]" />
                <div className="flex min-w-0 flex-col gap-px">
                  <span className="truncate">{p.t}</span>
                  <span className="text-[11.5px]" style={{ color: p.c }}>{p.sub}</span>
                </div>
              </div>
            ))}
          </div>
          {!preview.length && <span className="text-[12.5px] text-[#9a9aa3]">Items you add appear here.</span>}
          {wk > 0 && <span className="text-xs text-[#6b6b76]">+ {pl(wk, 'weekly item')} — shows on Mondays</span>}
        </div>
        <div className={`${card} flex flex-col gap-3 p-[18px]`}>
          <h3 className="m-0 text-sm font-semibold">How your day is recorded</h3>
          {rules.map(([l, d, c]) => (
            <div key={l} className="grid grid-cols-[12px_minmax(0,1fr)] items-start gap-2.5">
              <span className="mt-[3px] h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
              <div className="flex flex-col gap-px"><span className="font-semibold">{l}</span><span className="text-[12.5px] leading-[1.4] text-[#55555e]">{d}</span></div>
            </div>
          ))}
          <span className="rounded-lg bg-[#f7f6f3] px-2.5 py-2 text-xs leading-normal text-[#3b3b44]">Days before your checklist is set up never count as missed.</span>
        </div>
      </div>
    </section>
  )
}

function Submissions({ list, month, setMonth, minMonth, maxMonth, today, status, subsByDate, selDay, pickDay, monthKeys, eligibleIn, compliance, reasonOpen, setReasonOpen, reasonText, setReasonText, sendReason, busy, onGoToday, onSetup }) {
  const keys = monthKeys(month).filter((k) => k <= today)
  const sel = selDay && selDay.startsWith(month) ? selDay : month === today.slice(0, 7) ? today : keys[keys.length - 1] || `${month}-01`
  const cnt = (k) => keys.filter((d) => status(d) === k).length
  const elig = eligibleIn(keys)
  const subd = elig.filter((k) => SUBMITTED.includes(status(k)))
  const rate = elig.length ? Math.round((subd.length / elig.length) * 100) : null
  const counts = (s) => [s.applicable_done ?? s.done_count ?? 0, s.applicable_total ?? s.total ?? 0]
  const monthSubs = keys.map((k) => subsByDate.get(k)).filter(Boolean)
  const ratios = monthSubs.map(counts).filter(([, t]) => t > 0)
  const avgC = ratios.length ? Math.round((ratios.reduce((a, [d, t]) => a + d / t, 0) / ratios.length) * 100) : null
  const stats = [
    ['Complete', cnt('complete'), 'all items, on time', GRN, GRN],
    ['Partial', cnt('partial'), 'on time, items missing', '#d9a13a', AMB],
    ['Late', cnt('late'), 'after 7:00 PM', '#e0822f', '#a34d0e'],
    ['Missed', cnt('missed'), list ? 'working days, no submission' : 'counting starts after setup', '#d4553a', RED],
    ['Submission rate', rate == null ? '—' : `${rate}%`, elig.length ? `${subd.length} of ${pl(elig.length, 'working day')}` : 'no working days yet', MAG, '#17171c'],
    ['Avg completion', avgC == null ? '—' : `${avgC}%`, 'items ticked per submission', '#9a9894', '#17171c'],
  ]
  const cellText = (k) => {
    const st = status(k)
    const s = subsByDate.get(k)
    if (st === 'missed') return 'Missed'
    if (st === 'due') return 'Due'
    if (!s) return ''
    const [d, t] = counts(s)
    return st === 'late' ? `${istTime(s.submitted_at)} · ${d}/${t}` : `${d}/${t} items`
  }
  const trend = keys
    .filter((k) => ['complete', 'partial', 'late', 'missed', 'due'].includes(status(k)))
    .map((k) => {
      const st = status(k)
      const s = subsByDate.get(k)
      const [d, t] = s ? counts(s) : [0, 0]
      return {
        k,
        l: dowMon(k) === 0 || k.endsWith('-01') ? String(Number(k.slice(8))) : '',
        h: s && t ? Math.max(4, Math.round((d / t) * 58)) : st === 'missed' ? 4 : 2,
        c: st === 'due' ? '#eadbe4' : ST[st].bg,
        tip: `${fmtDay(k, { day: 'numeric', month: 'short' })} · ${ST[st].l}${s ? ` · ${d}/${t}` : ''}`,
      }
    })
  const hasHistory = monthSubs.length > 0

  // Detail for the selected day.
  const k = status(sel)
  const stD = ST[k] || ST.off
  const s = subsByDate.get(sel)
  const reason = list?.missed_reasons?.find((r) => r.date === sel)
  let detail
  if (s) {
    const [d, t] = counts(s)
    const time = istTime(s.submitted_at)
    const [hh, mm] = time.split(':').map(Number)
    const over = hh * 60 + mm - 19 * 60
    const items = (s.responses || []).filter((r) => !isExtra(r))
    const extras = (s.responses || []).filter(isExtra)
    detail = (
      <>
        <DetailHead sel={sel} st={stD} sub={`Submitted ${time}${s.status === 'Late' && over > 0 ? ` · ${over} min after cut-off` : ''} · ${d}/${t} items`} />
        <div className="flex flex-col">
          {items.map((r, i) => (
            <div key={`${r.item}-${i}`} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2.5 border-b border-[#f4f3f0] py-[7px]">
              <span className="mt-px box-border grid h-4 w-4 place-items-center rounded text-[10px] text-white" style={r.done ? { background: GRN } : r.na ? { background: '#f1f0ec', border: '1.5px solid #d6d4ce' } : { background: 'transparent', border: '1.5px solid #e3a29b' }}>{r.done ? '✓' : ''}</span>
              <div className="flex min-w-0 flex-col gap-px">
                <span style={{ color: r.done ? undefined : r.na ? '#9a9aa3' : RED, textDecoration: r.na ? 'line-through' : 'none' }}>{r.item}{r.na ? ' · N/A' : ''}</span>
                {r.remark && <span className="text-[11.5px] text-[#6b6b76]">{r.remark}</span>}
              </div>
            </div>
          ))}
        </div>
        {extras.length > 0 && (
          <div className="flex flex-col gap-[5px]">
            <span className="text-[11.5px] text-[#6b6b76]">Extra work</span>
            {extras.map((e, i) => <span key={`${e.item}-${i}`} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#b3177f]" />{e.item}</span>)}
          </div>
        )}
        {s.remark && (
          <div className="flex flex-col gap-0.5 rounded-lg bg-[#f7f6f3] px-[11px] py-[9px]">
            <span className="text-[11px] text-[#6b6b76]">Your note</span>
            <span className="leading-[1.45]">{s.remark}</span>
          </div>
        )}
      </>
    )
  } else {
    const msg = {
      due: 'Not submitted yet — submit before the 7:00 PM cut-off.',
      missed: reason ? 'No submission on this working day.' : 'No submission on this working day. You can still tell your manager why.',
      off: 'No checklist due on this day.',
      pre: list ? 'Before your checklist started, so this day isn’t counted.' : 'Your checklist isn’t set up yet, so this day isn’t counted.',
      upcoming: 'This day hasn’t happened yet.',
    }[k] || ''
    detail = (
      <>
        <DetailHead sel={sel} st={stD} sub={k === 'due' ? 'Due by 7:00 PM' : ''} />
        <div className="flex flex-col items-start gap-2.5 py-2.5">
          <span className="leading-normal text-[#55555e]">{msg}</span>
          {reason && (
            <div className="flex w-full flex-col gap-0.5 rounded-lg bg-[#f7f6f3] px-[11px] py-[9px]">
              <span className="text-[11px] text-[#6b6b76]">Your reason · sent {istTime(reason.at)} {fmtDay(istKey(reason.at), { day: 'numeric', month: 'short' })}</span>
              <span className="leading-[1.45]">{reason.reason}</span>
            </div>
          )}
          {k === 'due' && <button onClick={onGoToday} className="rounded-lg bg-[#17171c] px-3.5 py-2 text-[12.5px] text-white">Go to today’s checklist</button>}
          {k === 'pre' && !list && <button onClick={onSetup} className="rounded-lg bg-[#17171c] px-3.5 py-2 text-[12.5px] text-white">Set up my checklist</button>}
          {k === 'missed' && list && !reason && !reasonOpen && <button onClick={() => setReasonOpen(true)} className="rounded-lg bg-[#17171c] px-3.5 py-2 text-[12.5px] text-white">Add a reason</button>}
          {k === 'missed' && list && !reason && reasonOpen && (
            <div className="flex w-full flex-col gap-2">
              <textarea value={reasonText} onChange={(e) => setReasonText(e.target.value)} rows={3} placeholder="Why was this day missed? Your manager sees this." className="resize-y rounded-lg border border-[#e0dfdb] bg-white px-2.5 py-2 text-[12.5px] text-[#17171c] outline-none" />
              <div className="flex gap-2">
                <button onClick={() => setReasonOpen(false)} className="rounded-lg border border-[#e0dfdb] bg-white px-3 py-[7px] text-[12.5px]">Cancel</button>
                <button onClick={() => sendReason(sel)} disabled={busy} className="rounded-lg bg-[#17171c] px-3.5 py-[7px] text-[12.5px] text-white disabled:opacity-60">Send reason</button>
              </div>
            </div>
          )}
        </div>
      </>
    )
  }

  // Item by item + patterns for the month.
  const itemStats = (list?.items || []).map((it) => {
    const seen = monthSubs.map((x) => (x.responses || []).find((r) => !isExtra(r) && (r.key === it.key || r.item === it.label))).filter((r) => r && !r.na)
    const p = seen.length ? Math.round((seen.filter((r) => r.done).length / seen.length) * 100) : null
    return {
      t: it.label,
      v: p == null ? '—' : `${p}%`,
      pct: p || 0,
      c: p >= 90 ? GRN : p >= 75 ? '#d9a13a' : '#d4553a',
      s: p != null && p < 80 ? 'Often skipped — make it weekly or “when needed”' : it.link ? `Can be ticked from ${it.link} tickets` : 'Ticked by hand',
      sc: p != null && p < 80 ? AMB : '#8a8a93',
    }
  })
  const times = monthSubs.map((x) => istTime(x.submitted_at)).sort(compareText)
  const medT = times[Math.floor(times.length / 2)] || '—'
  const lateD = keys.filter((d) => status(d) === 'late')
  const missD = keys.filter((d) => status(d) === 'missed')
  let best = 0
  let run = 0
  for (const d of elig) {
    if (SUBMITTED.includes(status(d))) {
      run++
      best = Math.max(best, run)
    } else run = 0
  }
  const patterns = [
    [medT, 'Usual submit time', medT !== '—' && medT <= '19:00' ? 'Before the 7:00 PM cut-off' : 'Aim to submit before 7:00 PM', '#17171c'],
    [String(lateD.length), 'Late submissions', lateD.map((d) => `${Number(d.slice(8))} ${fmtDay(d, { month: 'short' })} (${istTime(subsByDate.get(d).submitted_at)})`).join(' · ') || 'None this month', '#a34d0e'],
    [String(missD.length), 'Missed days', missD.length ? `${missD.map((d) => `${DOW[dowMon(d)]} ${Number(d.slice(8))}`).join(' · ')} — no submission` : 'None this month', RED],
    [pl(best, 'day'), 'Best streak this month', `Current streak ${pl(compliance.streak, 'day')}`, GRN],
  ]

  return (
    <>
      <section className="flex flex-wrap gap-2">
        {stats.map(([l, v, sub, dot, c]) => (
          <div key={l} className="flex min-w-0 flex-[1_1_140px] flex-col gap-1 rounded-[10px] border border-[#e8e7e3] bg-white px-3.5 py-3">
            <span className="flex items-center gap-1.5 text-[11.5px] text-[#6b6b76]"><span className="h-2 w-2 rounded-sm" style={{ background: dot }} />{l}</span>
            <span className="text-[22px] font-semibold tracking-[-.02em]" style={{ color: c }}>{v}</span>
            <span className="text-[11.5px] text-[#8a8a93]">{sub}</span>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap items-start gap-3">
        <div className={`${card} flex flex-[1_1_540px] flex-col gap-3 p-[18px]`}>
          <div className="flex flex-wrap items-start justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <button disabled={month <= minMonth} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" className="grid h-7 w-7 place-items-center rounded-md border border-[#e0dfdb] bg-white disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <div className="flex flex-col gap-0.5">
                <h3 className="m-0 text-sm font-semibold">{fmtDay(`${month}-01`, { month: 'long', year: 'numeric' })}</h3>
                <span className="text-xs text-[#6b6b76]">Click a day to see what you submitted</span>
              </div>
              <button disabled={month >= maxMonth} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" className="grid h-7 w-7 place-items-center rounded-md border border-[#e0dfdb] bg-white disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <Legend />
          </div>
          <MonthGrid month={month} status={status} sel={sel} onPick={pickDay} cellText={cellText} />
          {hasHistory && (
            <div className="flex flex-col gap-1.5 border-t border-[#f1f0ec] pt-3">
              <span className="text-xs text-[#55555e]">Items completed per working day</span>
              <div className="flex h-16 items-end gap-1 border-b border-[#e8e7e3]">
                {trend.map((b) => <div key={b.k} title={b.tip} className="flex-1 rounded-t-[3px]" style={{ height: b.h, background: b.c }} />)}
              </div>
              <div className="flex gap-1">{trend.map((b) => <span key={b.k} className="flex-1 text-center text-[9.5px] text-[#9a9aa3]">{b.l}</span>)}</div>
            </div>
          )}
        </div>

        <div className={`${card} flex flex-[1_1_360px] flex-col gap-3.5 p-[18px]`}>{detail}</div>
      </section>

      {hasHistory && (
        <section className="flex flex-wrap items-start gap-3">
          <div className={`${card} flex flex-[1_1_520px] flex-col gap-2.5 p-[18px]`}>
            <div className="flex flex-col gap-0.5">
              <h3 className="m-0 text-sm font-semibold">Item by item</h3>
              <span className="text-xs text-[#6b6b76]">How often you ticked each item on days you submitted</span>
            </div>
            {itemStats.map((i) => (
              <div key={i.t} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_44px] items-center gap-3 py-1">
                <div className="flex min-w-0 flex-col gap-px"><span className="truncate font-medium">{i.t}</span><span className="text-[11.5px]" style={{ color: i.sc }}>{i.s}</span></div>
                <div className="h-2 overflow-hidden rounded bg-[#f1f0ec]"><div className="h-full rounded" style={{ width: `${i.pct}%`, background: i.c }} /></div>
                <span className="text-right font-semibold tabular-nums">{i.v}</span>
              </div>
            ))}
          </div>
          <div className={`${card} flex flex-[1_1_340px] flex-col gap-3 p-[18px]`}>
            <h3 className="m-0 text-sm font-semibold">Your patterns</h3>
            {patterns.map(([v, l, d, c]) => (
              <div key={l} className="grid grid-cols-[92px_minmax(0,1fr)] items-baseline gap-3 border-b border-[#f4f3f0] pb-2.5">
                <span className="text-lg font-semibold tracking-[-.01em]" style={{ color: c }}>{v}</span>
                <div className="flex flex-col gap-px"><span className="font-medium">{l}</span><span className="text-xs leading-[1.4] text-[#6b6b76]">{d}</span></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function DetailHead({ sel, st, sub }) {
  return (
    <div className="flex items-start justify-between gap-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-semibold">{DOWL[dowMon(sel)]}, {fmtDay(sel, { day: 'numeric', month: 'short' })}</span>
        {sub && <span className="text-[12.5px] text-[#6b6b76]">{sub}</span>}
      </div>
      <span className="whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11.5px] font-semibold" style={{ background: st.p[0], color: st.p[1] }}>{st.l}</span>
    </div>
  )
}

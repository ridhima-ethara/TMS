'use client'

// Checklist reports for IT/Admin: a team head's view of every team member's
// daily checklist, and the Excel export (own record or the whole team) served
// by /member-checklists/report.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/appapi'
import { AppSelect } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { DateField } from '@/components/ui/date-field'

const GRN = '#12795a', AMB = '#8a5a00', RED = '#b42318'
const TZ = 'Asia/Kolkata'
const card = 'min-w-0 rounded-[14px] border border-[#e8e7e3] bg-white'
const PILL = {
  Completed: ['#e4f3ec', GRN],
  Partial: ['#fdf3dc', AMB],
  Late: ['#fdeee0', '#a34d0e'],
  Missed: ['#fdeaea', RED],
  Pending: ['#fbe9f4', '#8a0f61'],
}

export const istToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export const monthRange = (month) => {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const today = istToday()
  const end = `${month}-${String(last).padStart(2, '0')}`
  return { from: `${month}-01`, to: end > today ? today : end }
}

export async function downloadChecklistReport({ scope, from, to }) {
  const query = new URLSearchParams({ scope, from, to, format: 'xlsx' })
  const res = await fetch(`/api/member-checklists/report?${query}`, { credentials: 'include' })
  if (!res.ok) {
    let message = `Download failed (${res.status})`
    try { message = (await res.json()).error || message } catch {}
    throw new Error(message)
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'checklist-report.xlsx'
  const url = URL.createObjectURL(await res.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function DownloadReportButton({ scope, from, to, label = 'Download report', primary = false, className = '' }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      await downloadChecklistReport({ scope, from, to })
      toast.success('Report downloaded')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      onClick={go}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-[9px] border px-3 py-[7px] text-[12.5px] font-medium disabled:opacity-60 ${primary ? 'border-[#17171c] bg-[#17171c] text-white' : 'border-[#e0dfdb] bg-white text-[#17171c]'} ${className}`}
    >
      <Download className="h-3.5 w-3.5" />
      {busy ? 'Preparing…' : label}
    </button>
  )
}

const fmtDate = (date) =>
  new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short' })
const fmtTime = (value) =>
  value ? new Date(value).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }) : '—'

function Pill({ status }) {
  const [bg, fg] = PILL[status] || ['#f1f0ec', '#6b6b76']
  return <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: bg, color: fg }}>{status}</span>
}

export default function TeamChecklists({ user }) {
  const today = istToday()
  const [from, setFrom] = useState(() => monthRange(today.slice(0, 7)).from)
  const [to, setTo] = useState(today)
  const [member, setMember] = useState('all')
  const [status, setStatus] = useState('all')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!from || !to || from > to) return
    setLoading(true)
    try {
      setData(await api(`/member-checklists/report?scope=team&from=${from}&to=${to}`))
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [from, to])
  useEffect(() => { load() }, [load])

  const days = useMemo(
    () => (data?.days || []).filter((d) => (member === 'all' || d.member_id === member) && (status === 'all' || d.status === status)),
    [data, member, status],
  )
  const members = data?.members || []
  const totals = members.reduce(
    (acc, m) => ({ working: acc.working + m.working_days, submitted: acc.submitted + m.submitted, missed: acc.missed + m.missed, late: acc.late + m.late }),
    { working: 0, submitted: 0, missed: 0, late: 0 },
  )
  const teamRate = totals.working ? Math.round(((totals.submitted - totals.late) / totals.working) * 100) : null
  const presets = [
    ['This month', () => { const r = monthRange(today.slice(0, 7)); setFrom(r.from); setTo(r.to) }],
    ['Last 7 days', () => { const d = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400000); setFrom(d.toISOString().slice(0, 10)); setTo(today) }],
    ['Last month', () => {
      const [y, m] = today.split('-').map(Number)
      const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
      const r = monthRange(prev); setFrom(r.from); setTo(r.to)
    }],
  ]
  const dept = user.role === 'admin' ? 'Admin' : 'IT'

  return (
    <section className="flex flex-col gap-3">
      <div className={`${card} flex flex-wrap items-end gap-3 px-5 py-4`}>
        <div className="mr-auto flex flex-col gap-[3px]">
          <span className="text-base font-semibold">{dept} team checklists</span>
          <span className="text-[12.5px] text-[#6b6b76]">Every team member's daily checklist for the selected dates. Export downloads an Excel workbook with a summary, daily log and task detail.</span>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px] font-medium text-[#6b6b76]">
            From
            <DateField value={from} max={to} onChange={setFrom} aria-label="From date" className="h-[34px] rounded-[9px] px-2.5 text-[12.5px]" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-[#6b6b76]">
            To
            <DateField value={to} min={from} max={today} onChange={setTo} aria-label="To date" className="h-[34px] rounded-[9px] px-2.5 text-[12.5px]" />
          </label>
          <DownloadReportButton scope="team" from={from} to={to} label="Export all members to Excel" primary className="h-[34px]" />
        </div>
        <div className="flex w-full flex-wrap gap-1.5">
          {presets.map(([label, apply]) => (
            <button key={label} onClick={apply} className="rounded-full border border-[#e8e7e3] bg-[#fafaf8] px-2.5 py-1 text-[11.5px] text-[#55555e] hover:bg-[#f1f0ec]">{label}</button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <Skeleton className="h-[360px] w-full rounded-[14px]" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Team members', members.length, '#17171c'],
              ['On-time submission', teamRate == null ? '—' : `${teamRate}%`, teamRate == null ? '#17171c' : teamRate >= 80 ? GRN : teamRate >= 50 ? AMB : RED],
              ['Late submissions', totals.late, totals.late ? '#a34d0e' : '#17171c'],
              ['Missed days', totals.missed, totals.missed ? RED : '#17171c'],
            ].map(([label, value, color]) => (
              <div key={label} className={`${card} px-4 py-3`}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[#8a8a93]">{label}</div>
                <div className="mt-1 text-[22px] font-semibold" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>

          <div className={`${card} overflow-hidden`}>
            <div className="border-b border-[#f1f0ec] px-5 py-3 font-semibold">Member summary</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[12.5px]">
                <thead className="bg-[#fafaf8] text-[10.5px] uppercase tracking-wide text-[#8a8a93]">
                  <tr>
                    {['Member', 'Checklist', 'Working days', 'Submitted', 'On time', 'Partial', 'Late', 'Missed', 'On-time %', ''].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.member_id} className={`border-t border-[#f1f0ec] ${member === m.member_id ? 'bg-[#fbf9fb]' : ''}`}>
                      <td className="px-4 py-2.5 font-semibold">{m.member_name}{m.member_id === user.id ? <span className="ml-1.5 text-[11px] font-normal text-[#8a8a93]">(you)</span> : null}</td>
                      <td className="max-w-[220px] truncate px-4 py-2.5 text-[#55555e]">{m.checklists.join(', ')}</td>
                      <td className="px-4 py-2.5">{m.working_days}</td>
                      <td className="px-4 py-2.5">{m.submitted}</td>
                      <td className="px-4 py-2.5" style={{ color: GRN }}>{m.completed}</td>
                      <td className="px-4 py-2.5" style={{ color: m.partial ? AMB : undefined }}>{m.partial}</td>
                      <td className="px-4 py-2.5" style={{ color: m.late ? '#a34d0e' : undefined }}>{m.late}</td>
                      <td className="px-4 py-2.5" style={{ color: m.missed ? RED : undefined }}>{m.missed}</td>
                      <td className="px-4 py-2.5 font-semibold" style={{ color: m.compliance == null ? undefined : m.compliance >= 80 ? GRN : m.compliance >= 50 ? AMB : RED }}>{m.compliance == null ? '—' : `${m.compliance}%`}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => setMember(member === m.member_id ? 'all' : m.member_id)} className="text-[12px] text-[#b3177f] underline">{member === m.member_id ? 'Show all' : 'View days'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!members.length && <p className="px-5 py-8 text-center text-[#6b6b76]">No team member has a checklist set up yet.</p>}
            </div>
          </div>

          <div className={`${card} overflow-hidden`}>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#f1f0ec] px-5 py-3">
              <span className="mr-auto font-semibold">Daily log <span className="font-normal text-[#8a8a93]">· {days.length} day{days.length === 1 ? '' : 's'}</span></span>
              <AppSelect
                value={member}
                onValueChange={setMember}
                options={[['all', 'All members'], ...members.map((m) => [m.member_id, m.member_name])]}
                aria-label="Member"
                className="h-auto w-auto min-w-[160px] rounded-[9px] border-[#e0dfdb] px-3 py-[7px] text-[12.5px]"
              />
              <AppSelect
                value={status}
                onValueChange={setStatus}
                options={[['all', 'All statuses'], ...Object.keys(PILL).map((s) => [s, s])]}
                aria-label="Status"
                className="h-auto w-auto min-w-[140px] rounded-[9px] border-[#e0dfdb] px-3 py-[7px] text-[12.5px]"
              />
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[820px] text-left text-[12.5px]">
                <thead className="sticky top-0 bg-[#fafaf8] text-[10.5px] uppercase tracking-wide text-[#8a8a93]">
                  <tr>
                    {['Date', 'Member', 'Status', 'Tasks', 'Submitted at', 'Remark / reason'].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {days.slice(0, 500).map((d) => (
                    <tr key={`${d.member_id}|${d.checklist}|${d.date}`} className="border-t border-[#f1f0ec]">
                      <td className="whitespace-nowrap px-4 py-2.5">{fmtDate(d.date)}</td>
                      <td className="px-4 py-2.5 font-medium">{d.member_name}</td>
                      <td className="px-4 py-2.5"><Pill status={d.status} /></td>
                      <td className="whitespace-nowrap px-4 py-2.5">{d.tasks_done == null ? `— / ${d.tasks_total}` : `${d.tasks_done} / ${d.tasks_total}`}{d.na_count ? <span className="text-[#8a8a93]"> · {d.na_count} N/A</span> : null}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">{fmtTime(d.submitted_at)}</td>
                      <td className="max-w-[320px] px-4 py-2.5 text-[#55555e]">{d.remark || d.missed_reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!days.length && <p className="px-5 py-8 text-center text-[#6b6b76]">No checklist days match these filters.</p>}
              {days.length > 500 && <p className="border-t border-[#f1f0ec] px-5 py-3 text-center text-[12px] text-[#6b6b76]">Showing the latest 500 days. Export to Excel for the full log.</p>}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

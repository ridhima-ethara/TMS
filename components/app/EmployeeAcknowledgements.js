'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, fmtDateTime, PRIORITY_META, statusClass } from '@/lib/appapi'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle2, CircleAlert, Clock3, FileCheck2, Inbox, MapPin, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

const EMPTY = { pending: [], history: [] }

export default function EmployeeAcknowledgements({ onOpenTicket, refresh, onRefresh }) {
  const [data, setData] = useState(EMPTY)
  const [tab, setTab] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [confirmingId, setConfirmingId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoading(true)
    else setRefreshing(true)
    try {
      const [resolved, closed] = await Promise.all([
        api('/tickets?status=Resolved&page=1&limit=100'),
        api('/tickets?status=Closed&page=1&limit=100'),
      ])
      setData({
        pending: (resolved.items || []).filter((ticket) => !ticket.confirmation?.confirmed),
        history: (closed.items || []).filter((ticket) => ticket.confirmation?.confirmed),
      })
      setError('')
    } catch (requestError) {
      setError(requestError.message || 'Acknowledgements could not be loaded.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load({ initial: true })
  }, [load, refresh])

  const acknowledge = async (ticket) => {
    setBusyId(ticket.id)
    try {
      const closed = await api(`/tickets/${ticket.id}/confirm`, {
        method: 'POST',
        body: { action: 'confirm' },
      })
      setData((current) => ({
        pending: current.pending.filter((item) => item.id !== ticket.id),
        history: [closed, ...current.history],
      }))
      setConfirmingId(null)
      toast.success(`${ticket.human_id} acknowledged and permanently closed`)
      onRefresh?.()
    } catch (requestError) {
      toast.error(requestError.message)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <div className="space-y-4"><Skeleton className="h-36 rounded-2xl" /><Skeleton className="h-16" /><Skeleton className="h-72" /></div>

  const items = tab === 'pending' ? data.pending : data.history
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-[#dfe5ec] bg-gradient-to-r from-white via-[#fbfdff] to-emerald-50 p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><ShieldCheck className="h-6 w-6" /></span>
            <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">Final review</p><h2 className="mt-1 text-xl font-bold text-[#111827] sm:text-2xl">Resolution acknowledgement centre</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#697087]">Review the service team’s resolution before confirming. Confirmation permanently closes the issue and preserves it in your history.</p></div>
          </div>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={refreshing}><RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh</Button>
        </div>
      </section>

      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

      <div className="inline-flex w-full rounded-xl border border-[#e4e7ec] bg-white p-1 sm:w-auto" role="tablist" aria-label="Resolution acknowledgement views">
        <button type="button" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:flex-none ${tab === 'pending' ? 'bg-[#151a28] text-white shadow-sm' : 'text-[#697087] hover:bg-slate-50'}`}><Clock3 className="h-4 w-4" />Awaiting review <span className={`rounded-full px-2 py-0.5 text-[11px] ${tab === 'pending' ? 'bg-white/15' : 'bg-emerald-100 text-emerald-700'}`}>{data.pending.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:flex-none ${tab === 'history' ? 'bg-[#151a28] text-white shadow-sm' : 'text-[#697087] hover:bg-slate-50'}`}><FileCheck2 className="h-4 w-4" />Acknowledged <span className={`rounded-full px-2 py-0.5 text-[11px] ${tab === 'history' ? 'bg-white/15' : 'bg-slate-100 text-slate-600'}`}>{data.history.length}</span></button>
      </div>

      {items.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {items.map((ticket) => {
            const confirming = confirmingId === ticket.id
            const busy = busyId === ticket.id
            return (
              <Card key={ticket.id} className={`overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md ${tab === 'pending' ? 'border-emerald-200' : 'border-[#e4e6ef]'}`}>
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-center gap-2 border-b bg-[#fbfcfe] px-4 py-3 sm:px-5"><Badge variant="outline" className="font-mono text-[11px]">{ticket.human_id}</Badge><Badge className={PRIORITY_META[ticket.priority]?.badge}>{ticket.priority}</Badge><Badge variant="outline" className={statusClass(ticket.status)}>{ticket.status}</Badge><span className="ml-auto text-xs text-muted-foreground">{tab === 'pending' ? 'Resolved' : 'Confirmed'} {fmtDateTime(tab === 'pending' ? (ticket.resolved_at || ticket.resolution?.resolved_date) : ticket.confirmation?.at)}</span></div>
                  <div className="p-4 sm:p-5">
                    <h3 className="font-semibold text-[#111827]">{ticket.title}</h3>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{ticket.location || 'Location not set'}</span><span>{ticket.department} · {ticket.category}</span></div>
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Resolution summary</p><p className="mt-1 text-sm leading-6 text-slate-700">{ticket.resolution?.summary || ticket.resolution?.action_taken || 'The service team marked this issue as resolved.'}</p>{ticket.resolution?.resolved_by && <p className="mt-2 text-xs text-slate-500">Resolved by {ticket.resolution.resolved_by}</p>}</div>
                    {tab === 'pending' && (confirming ? (
                      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-sm font-medium text-amber-950">Confirm permanent closure?</p><p className="mt-1 text-xs leading-5 text-amber-800">Once acknowledged, this ticket cannot be reopened. Review the resolution details first.</p><div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmingId(null)}>Cancel</Button><Button size="sm" disabled={busy} onClick={() => acknowledge(ticket)} className="bg-emerald-700 text-white hover:bg-emerald-800">{busy ? 'Closing ticket…' : 'Acknowledge & close'}</Button></div></div>
                    ) : (
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end"><Button variant="outline" size="sm" onClick={() => onOpenTicket(ticket.id)}>Review full ticket</Button><Button size="sm" onClick={() => setConfirmingId(ticket.id)} className="bg-emerald-700 text-white hover:bg-emerald-800"><CheckCircle2 className="mr-2 h-4 w-4" />Acknowledge resolution</Button></div>
                    ))}
                    {tab === 'history' && <div className="mt-4 flex items-center justify-between gap-3"><p className="text-xs text-emerald-700"><CheckCircle2 className="mr-1 inline h-4 w-4" />Resolution acknowledged and archived</p><Button variant="outline" size="sm" onClick={() => onOpenTicket(ticket.id)}>View ticket</Button></div>}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        <Card className="border-dashed border-[#d9dee7]"><CardContent className="flex min-h-72 flex-col items-center justify-center p-6 text-center"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">{tab === 'pending' ? <Inbox className="h-6 w-6" /> : <FileCheck2 className="h-6 w-6" />}</span><p className="mt-4 font-semibold text-[#111827]">{tab === 'pending' ? 'Nothing awaiting acknowledgement' : 'No acknowledgement history yet'}</p><p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{tab === 'pending' ? 'Resolved issues will appear here when the service team completes them.' : 'Tickets you confirm will remain here as a permanent record.'}</p></CardContent></Card>
      )}
    </div>
  )
}

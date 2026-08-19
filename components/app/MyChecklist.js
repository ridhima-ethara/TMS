'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/appapi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { ClipboardCheck, CheckCircle2, Loader2, Plus, X } from 'lucide-react'

const isExtra = (response) =>
  response?.extra === true || String(response?.key || '').startsWith('extra_')

function ChecklistCard({ list, onSubmitted }) {
  const today = list.today_submission
  const init = list.items.map((it) => {
    const prev = today?.responses?.find((r) => !isExtra(r) && r.item === it.label)
    return { item: it.label, done: prev?.done || false, remark: prev?.remark || '' }
  })
  const [rows, setRows] = useState(init)
  const [extras, setExtras] = useState(
    (today?.responses || []).filter(isExtra).map((r) => ({ item: r.item, done: r.done !== false, remark: r.remark || '' })),
  )
  const [newExtra, setNewExtra] = useState('')
  const [busy, setBusy] = useState(false)
  const doneCount = rows.filter((r) => r.done).length + extras.filter((r) => r.done).length

  const addExtra = () => {
    const item = newExtra.trim()
    if (!item) return
    setExtras([...extras, { item, done: true, remark: '' }])
    setNewExtra('')
  }

  const submit = async () => {
    setBusy(true)
    try {
      const r = await api(`/member-checklists/${list.id}/submit`, { method: 'POST', body: { responses: rows, extra_items: extras } })
      toast.success(`Submitted — ${r.done_count}/${r.total} done`)
      onSubmitted?.()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-fuchsia-600" />{list.title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {today && <Badge variant="outline" className="text-green-700 border-green-300"><CheckCircle2 className="h-3 w-3 mr-1" />Submitted today ({today.status})</Badge>}
            <Badge variant="outline">{doneCount}/{rows.length + extras.length}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r, idx) => (
          <div key={idx} className={`flex flex-wrap items-center gap-3 rounded-md border p-2 ${r.done ? 'bg-green-50 border-green-200' : ''}`}>
            <Checkbox checked={r.done} onCheckedChange={(v) => setRows(rows.map((x, i) => i === idx ? { ...x, done: !!v } : x))} />
            <span className={`min-w-0 flex-1 text-sm sm:min-w-[160px] ${r.done ? 'line-through text-muted-foreground' : ''}`}>{r.item}</span>
            <Input className="h-8 w-full sm:w-56" placeholder="Remark (optional)" value={r.remark} onChange={(e) => setRows(rows.map((x, i) => i === idx ? { ...x, remark: e.target.value } : x))} />
          </div>
        ))}
        <div className="rounded-md border border-dashed border-[#D9DEE7] p-2">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Additional work done today (counted for today only)</p>
          {extras.map((r, idx) => (
            <div key={idx} className={`mb-2 flex flex-wrap items-center gap-3 rounded-md border p-2 ${r.done ? 'bg-blue-50 border-blue-200' : ''}`}>
              <Checkbox checked={r.done} onCheckedChange={(v) => setExtras(extras.map((x, i) => i === idx ? { ...x, done: !!v } : x))} />
              <span className="min-w-0 flex-1 text-sm sm:min-w-[160px]">{r.item}</span>
              <Input className="h-8 w-full sm:w-48" placeholder="Remark (optional)" value={r.remark} onChange={(e) => setExtras(extras.map((x, i) => i === idx ? { ...x, remark: e.target.value } : x))} />
              <button onClick={() => setExtras(extras.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-red-600"><X className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input className="h-8" placeholder="Describe additional work…" value={newExtra} onChange={(e) => setNewExtra(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addExtra() }} />
            <Button variant="outline" size="sm" onClick={addExtra}><Plus className="h-4 w-4 mr-1" />Add</Button>
          </div>
        </div>
        <div className="flex justify-end">
          <Button className="w-full sm:w-auto" size="sm" onClick={submit} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}{today ? 'Update submission' : 'Submit checklist'}</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function CreateOwnKra({ onCreated }) {
  const [title, setTitle] = useState('My Daily KRA')
  const [items, setItems] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const list = items.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!list.length) return toast.error('Add at least one daily work item (one per line)')
    setBusy(true)
    try {
      await api('/member-checklists', { method: 'POST', body: { title, items: list } })
      toast.success('Daily KRA created')
      onCreated?.()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Set up my daily KRA</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Define the work you do every day. These items stay constant each day; you can also log additional work on any day when submitting.</p>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <Textarea rows={6} value={items} onChange={(e) => setItems(e.target.value)} placeholder={'One daily work item per line, e.g.\nCheck backup job status\nReview firewall alerts\nClear pending tickets'} />
        <div className="flex justify-end"><Button size="sm" onClick={submit} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Create daily KRA</Button></div>
      </CardContent>
    </Card>
  )
}

export default function MyChecklist() {
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(true)
  const load = () => { setLoading(true); api('/member-checklists').then(setLists).catch((e) => toast.error(e.message)).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Complete and submit your daily KRA. Submissions are recorded and tracked by the Super Admin, and any additional work you add counts for that day.</p>
      {lists.map((l) => <ChecklistCard key={l.id} list={l} onSubmitted={load} />)}
      {lists.length === 0 && <CreateOwnKra onCreated={load} />}
    </div>
  )
}

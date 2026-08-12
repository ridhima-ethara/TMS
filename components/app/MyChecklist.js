'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/appapi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { ClipboardCheck, CheckCircle2, Loader2 } from 'lucide-react'

function ChecklistCard({ list, onSubmitted }) {
  const today = list.today_submission
  const init = list.items.map((it) => {
    const prev = today?.responses?.find((r) => r.item === it.label)
    return { item: it.label, done: prev?.done || false, remark: prev?.remark || '' }
  })
  const [rows, setRows] = useState(init)
  const [busy, setBusy] = useState(false)
  const doneCount = rows.filter((r) => r.done).length

  const submit = async () => {
    setBusy(true)
    try {
      const r = await api(`/member-checklists/${list.id}/submit`, { method: 'POST', body: { responses: rows } })
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
            <Badge variant="outline">{doneCount}/{rows.length}</Badge>
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
        <div className="flex justify-end">
          <Button className="w-full sm:w-auto" size="sm" onClick={submit} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}{today ? 'Update submission' : 'Submit checklist'}</Button>
        </div>
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
      <p className="text-sm text-muted-foreground">Complete and submit your assigned daily checklist. Submissions are recorded and tracked by the Super Admin.</p>
      {lists.map((l) => <ChecklistCard key={l.id} list={l} onSubmitted={load} />)}
      {lists.length === 0 && <Card><CardContent className="py-12 text-center text-muted-foreground">No checklists assigned to you yet.</CardContent></Card>}
    </div>
  )
}

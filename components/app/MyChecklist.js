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
import { ClipboardCheck, CheckCircle2, Loader2, Plus, X, FileSpreadsheet } from 'lucide-react'

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

function CreateOwnKra({ onCreated, collapsible = false }) {
  const [openForm, setOpenForm] = useState(!collapsible)
  const [title, setTitle] = useState('My Daily Checklist')
  const [items, setItems] = useState('')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importedFile, setImportedFile] = useState('')

  const importSpreadsheet = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const data = new FormData()
    data.append('file', file)
    setImporting(true)
    try {
      const result = await api('/member-checklists/import-preview', { method: 'POST', body: data, timeout: 30000 })
      // Merge with anything already typed, dropping blank/duplicate lines.
      setItems((current) => {
        const existing = current.split('\n').map((l) => l.trim()).filter(Boolean)
        const merged = [...new Set([...existing, ...(result.items || [])])]
        return merged.join('\n')
      })
      if (!title.trim() || title === 'My Daily Checklist') {
        const derived = file.name.replace(/\.(xlsx|csv)$/i, '').replace(/[_-]+/g, ' ').trim()
        if (derived) setTitle(derived)
      }
      setImportedFile(file.name)
      toast.success(`${result.rows_imported} daily work items imported`)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setImporting(false)
    }
  }

  const submit = async () => {
    const list = items.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!list.length) return toast.error('Add at least one daily work item (one per line)')
    setBusy(true)
    try {
      await api('/member-checklists', { method: 'POST', body: { title, items: list } })
      toast.success('Daily checklist created')
      setItems('')
      setImportedFile('')
      if (collapsible) setOpenForm(false)
      onCreated?.()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  if (!openForm)
    return (
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setOpenForm(true)}><Plus className="h-4 w-4 mr-1" />Add my own checklist</Button>
      </div>
    )
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Set up my daily checklist</CardTitle>
          {collapsible && <button onClick={() => setOpenForm(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Define the work you do every day. These items stay constant each day; you can also log additional work on any day when submitting.</p>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <div className="rounded-xl border border-dashed border-[#CFC8F8] bg-[#FAF9FF] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#ECE9FF] text-[#6C5CE7]">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Import daily tasks from Excel or CSV</p>
              <p className="text-xs text-muted-foreground">
                Upload .xlsx or .csv with a Task, Daily Work, Activity or Responsibility column. Rows are added to the list below.
              </p>
              {importedFile && (
                <p className="mt-1 truncate text-xs font-medium text-[#6C5CE7]">
                  {importedFile} · imported into the list below
                </p>
              )}
            </div>
            <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border bg-white px-3 text-xs font-semibold shadow-sm hover:bg-[#F7F7FA]">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              {importing ? 'Reading…' : 'Choose file'}
              <input
                type="file"
                className="sr-only"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                disabled={importing}
                onChange={importSpreadsheet}
              />
            </label>
          </div>
        </div>
        <Textarea rows={6} value={items} onChange={(e) => setItems(e.target.value)} placeholder={'One daily work item per line, e.g.\nCheck backup job status\nReview firewall alerts\nClear pending tickets'} />
        <div className="flex justify-end"><Button size="sm" onClick={submit} disabled={busy || importing}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Create daily checklist</Button></div>
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
      <p className="text-sm text-muted-foreground">Complete and submit your daily checklist. Submissions are recorded and tracked by the Super Admin, and any additional work you add counts for that day.</p>
      {lists.map((l) => <ChecklistCard key={l.id} list={l} onSubmitted={load} />)}
      <CreateOwnKra onCreated={load} collapsible={lists.length > 0} />
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { api, fmtDate } from '@/lib/appapi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { ClipboardList, Ticket } from 'lucide-react'

const ITEM_STATUS = ['Not Started', 'Checked - No Issue', 'Issue Identified', 'In Progress', 'Pending Approval', 'Completed', 'Not Applicable']
const itemColor = (s) => ({ 'Checked - No Issue': 'bg-green-100 text-green-700', 'Issue Identified': 'bg-red-100 text-red-700', 'Completed': 'bg-green-100 text-green-700', 'In Progress': 'bg-indigo-100 text-indigo-700', 'Pending Approval': 'bg-amber-100 text-amber-700' }[s] || 'bg-slate-100 text-slate-600')

export default function ChecklistsView({ user, onRefresh }) {
  const [templates, setTemplates] = useState([])
  const [executions, setExecutions] = useState([])
  const isAdmin = user.role === 'admin'

  const load = () => {
    api('/checklists/templates').then(setTemplates).catch(() => {})
    api('/checklists/executions').then(setExecutions).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const start = async (template_id) => { try { await api('/checklists/executions', { method: 'POST', body: { template_id } }); toast.success('Checklist started'); load() } catch (e) { toast.error(e.message) } }
  const setItem = async (exec, idx, patch) => {
    const responses = exec.responses.map((r, i) => i === idx ? { ...r, ...patch } : r)
    setExecutions((prev) => prev.map((e) => e.id === exec.id ? { ...e, responses } : e))
    try { await api(`/checklists/executions/${exec.id}`, { method: 'PATCH', body: { responses } }) } catch (e) { toast.error(e.message) }
  }
  const toTicket = async (exec, r) => {
    try { const t = await api('/checklists/to-ticket', { method: 'POST', body: { item: r.item, remarks: r.remarks, location: exec.location, priority: 'High' } }); toast.success(`Created ticket ${t.human_id}`); onRefresh?.() } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Checklist Templates</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {templates.map((tpl) => (
              <div key={tpl.id} className="flex items-center gap-2 rounded-md border p-2">
                <ClipboardList className="h-4 w-4 text-fuchsia-600" />
                <span className="text-sm">{tpl.name}</span>
                <Button size="sm" variant="outline" onClick={() => start(tpl.id)}>Start today</Button>
              </div>
            ))}
            {templates.length === 0 && <p className="text-sm text-muted-foreground">No templates.</p>}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {executions.map((exec) => (
          <Card key={exec.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-base">{exec.template_name} <span className="font-mono text-xs text-muted-foreground ml-2">{exec.human_id}</span></CardTitle>
                <Badge variant="outline">{fmtDate(exec.date)} · {exec.location}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              {exec.responses.map((r, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <span className="min-w-0 flex-1 text-sm sm:min-w-[160px]">{r.item}</span>
                  {isAdmin ? (
                    <>
                      <Select value={r.status} onValueChange={(v) => setItem(exec, idx, { status: v })}>
                        <SelectTrigger className="h-8 w-full sm:w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>{ITEM_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input className="h-8 w-full sm:w-48" placeholder="Remarks" value={r.remarks} onChange={(e) => setItem(exec, idx, { remarks: e.target.value })} />
                      {r.status === 'Issue Identified' && <Button size="sm" variant="outline" onClick={() => toTicket(exec, r)}><Ticket className="h-3.5 w-3.5 mr-1" />Create Ticket</Button>}
                    </>
                  ) : (
                    <><Badge className={itemColor(r.status)}>{r.status}</Badge>{r.remarks && <span className="text-xs text-muted-foreground">{r.remarks}</span>}</>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
        {executions.length === 0 && <p className="text-sm text-muted-foreground">No checklist runs yet.</p>}
      </div>
    </div>
  )
}

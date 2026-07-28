'use client'
import { useEffect, useState } from 'react'
import { api, fmtDate } from '@/lib/appapi'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'

const TASK_STATUS = ['Not Started', 'In Progress', 'Pending Approval', 'On Hold', 'Completed', 'Not Applicable']
const statusColor = (s) => ({ 'Completed': 'bg-green-100 text-green-700', 'In Progress': 'bg-indigo-100 text-indigo-700', 'Pending Approval': 'bg-amber-100 text-amber-700', 'Not Started': 'bg-slate-100 text-slate-600', 'On Hold': 'bg-yellow-100 text-yellow-700' }[s] || 'bg-slate-100 text-slate-600')

export default function TasksView({ user }) {
  const [tasks, setTasks] = useState([])
  const load = () => api('/tasks').then(setTasks).catch((e) => toast.error(e.message))
  useEffect(() => { load() }, [])
  const isAdmin = user.role === 'admin'

  const update = async (id, body) => { try { await api(`/tasks/${id}`, { method: 'PATCH', body }); load() } catch (e) { toast.error(e.message) } }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{tasks.length} operational tasks</p>
        {isAdmin && <NewTask onCreated={load} />}
      </div>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Task</TableHead><TableHead>Category</TableHead><TableHead>Location</TableHead><TableHead>Recurrence</TableHead><TableHead>Status</TableHead><TableHead>Remarks</TableHead></TableRow></TableHeader>
          <TableBody>
            {tasks.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.human_id}</TableCell>
                <TableCell className="max-w-[280px]">{t.title}</TableCell>
                <TableCell className="text-sm">{t.category}</TableCell>
                <TableCell className="text-sm">{t.location}</TableCell>
                <TableCell className="text-sm capitalize">{t.recurrence}</TableCell>
                <TableCell>
                  {isAdmin ? (
                    <Select value={t.status} onValueChange={(v) => update(t.id, { status: v })}>
                      <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>{TASK_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : <Badge className={statusColor(t.status)}>{t.status}</Badge>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{t.remarks || '-'}</TableCell>
              </TableRow>
            ))}
            {tasks.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">No tasks</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

function NewTask({ onCreated }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ title: '', category: 'Facilities', location: 'HQ1', recurrence: 'one-time', priority: 'Medium', remarks: '' })
  const submit = async () => {
    if (!f.title) return toast.error('Title required')
    try { await api('/tasks', { method: 'POST', body: f }); toast.success('Task created'); setOpen(false); setF({ ...f, title: '', remarks: '' }); onCreated() } catch (e) { toast.error(e.message) }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New Task</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Operational Task</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label className="text-xs">Title</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Category</Label><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Location</Label>
              <Select value={f.location} onValueChange={(v) => setF({ ...f, location: v })}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HQ1">HQ1</SelectItem><SelectItem value="HQ2">HQ2</SelectItem><SelectItem value="301">301</SelectItem></SelectContent></Select>
            </div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Recurrence</Label>
            <Select value={f.recurrence} onValueChange={(v) => setF({ ...f, recurrence: v })}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="one-time">One-time</SelectItem><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent></Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Remarks</Label><Textarea rows={2} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></div>
        </div>
        <DialogFooter><Button onClick={submit}>Create</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

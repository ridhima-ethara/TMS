'use client'
import { useEffect, useState } from 'react'
import { api, fmtDate } from '@/lib/appapi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Plus, Trash2, ClipboardList } from 'lucide-react'

export default function MemberChecklists() {
  const [members, setMembers] = useState([])
  const [lists, setLists] = useState([])
  const [subs, setSubs] = useState([])

  const load = () => {
    api('/users').then((u) => setMembers(u.filter((x) => x.role === 'it' || x.role === 'admin'))).catch(() => {})
    api('/member-checklists').then(setLists).catch((e) => toast.error(e.message))
    api('/member-checklist-submissions').then(setSubs).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const del = async (id) => { try { await api(`/member-checklists/${id}`, { method: 'DELETE' }); toast.success('Deleted'); load() } catch (e) { toast.error(e.message) } }

  return (
    <Tabs defaultValue="define" className="space-y-4">
      <TabsList className="h-auto max-w-full justify-start overflow-x-auto">
        <TabsTrigger value="define">Define Checklists</TabsTrigger>
        <TabsTrigger value="tracking">Submission Tracking</TabsTrigger>
      </TabsList>

      <TabsContent value="define" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Assign daily checklists to IT & Admin members.</p>
          <NewMemberChecklist members={members} onCreated={load} />
        </div>
        {['it', 'admin'].map((role) => (
          <div key={role} className="space-y-2">
            <h3 className="text-sm font-semibold uppercase text-muted-foreground">{role === 'it' ? 'IT Team' : 'Admin Team'}</h3>
            {lists.filter((l) => l.member_role === role).map((l) => (
              <Card key={l.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base flex items-center gap-2"><ClipboardList className="h-4 w-4 text-fuchsia-600" />{l.title} <span className="text-sm font-normal text-muted-foreground">— {l.member_name}</span></CardTitle>
                    <Button variant="ghost" size="icon" onClick={() => del(l.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                  </div>
                </CardHeader>
                <CardContent><ul className="list-disc pl-5 text-sm text-muted-foreground space-y-0.5">{l.items.map((it) => <li key={it.key}>{it.label}</li>)}</ul></CardContent>
              </Card>
            ))}
            {lists.filter((l) => l.member_role === role).length === 0 && <p className="text-sm text-muted-foreground">None defined.</p>}
          </div>
        ))}
      </TabsContent>

      <TabsContent value="tracking">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Daily Submissions</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table className="min-w-[680px]">
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Member</TableHead><TableHead>Checklist</TableHead><TableHead className="text-center">Completed</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {subs.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm">{s.date}</TableCell>
                    <TableCell>{s.member_name}</TableCell>
                    <TableCell className="text-sm">{s.checklist_title}</TableCell>
                    <TableCell className="text-center">{s.done_count}/{s.total}</TableCell>
                    <TableCell><Badge className={s.status === 'Completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>{s.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {subs.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No submissions yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}

function NewMemberChecklist({ members, onCreated }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ member_id: '', title: '', items: '' })
  const submit = async () => {
    if (!f.member_id || !f.title) return toast.error('Member and title required')
    const items = f.items.split('\n').map((x) => x.trim()).filter(Boolean)
    if (items.length === 0) return toast.error('Add at least one item')
    try { await api('/member-checklists', { method: 'POST', body: { member_id: f.member_id, title: f.title, items } }); toast.success('Checklist assigned'); setOpen(false); setF({ member_id: '', title: '', items: '' }); onCreated() } catch (e) { toast.error(e.message) }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Assign Checklist</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Assign Daily Checklist</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label className="text-xs">Member</Label>
            <Select value={f.member_id} onValueChange={(v) => setF({ ...f, member_id: v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select member" /></SelectTrigger>
              <SelectContent>{members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.role === 'it' ? 'IT' : 'Admin'})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Title</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. IT Daily Ops Checklist" /></div>
          <div className="space-y-1"><Label className="text-xs">Items (one per line)</Label><Textarea rows={5} value={f.items} onChange={(e) => setF({ ...f, items: e.target.value })} placeholder={'Verify server backups\nCheck network uptime\nRespond to pending tickets'} /></div>
        </div>
        <DialogFooter><Button onClick={submit}>Assign</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

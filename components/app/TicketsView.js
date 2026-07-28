'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, PRIORITY_META, statusClass, ALL_STATUSES, PRIORITIES, fmtDate, slaRemaining } from '@/lib/appapi'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { Plus, Search, Download, Inbox } from 'lucide-react'

function exportCsv(rows) {
  const cols = ['human_id', 'department', 'category', 'title', 'priority', 'status', 'raised_by_name', 'assignee_name', 'location', 'created_at']
  const esc = (v) => { const s = String(v ?? ''); return /^[=+\-@]/.test(s) ? `'${s}` : `"${s.replace(/"/g, '""')}"` }
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tickets.csv'; a.click()
}

export default function TicketsView({ user, onOpenTicket, refresh, onRefresh, preset }) {
  const [data, setData] = useState({ items: [], total: 0, page: 1, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [cats, setCats] = useState([])
  const isSuper = user.role === 'super_admin'
  const [filters, setFilters] = useState({ search: '', status: 'all', priority: 'all', category: 'all', department: isSuper ? 'IT' : 'all', page: 1 })

  // load categories for the active department
  useEffect(() => {
    const dept = filters.department !== 'all' ? `?department=${filters.department}` : ''
    api(`/categories${dept}`).then((c) => setCats([...new Set(c.map((x) => x.name))])).catch(() => {})
  }, [filters.department])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams()
      if (filters.search) p.set('search', filters.search)
      if (filters.status !== 'all') p.set('status', filters.status)
      if (filters.priority !== 'all') p.set('priority', filters.priority)
      if (filters.category !== 'all') p.set('category', filters.category)
      if (filters.department !== 'all') p.set('department', filters.department)
      p.set('page', String(filters.page)); p.set('limit', '15')
      let items = await api(`/tickets?${p.toString()}`)
      if (preset === 'approvals') {
        const APPR = ['Pending Super Admin Approval', 'Clarification Required', 'Approval On Hold', 'Approval Rejected', 'Approved - Ready for Action', 'Approval Preparation']
        items = { ...items, items: items.items.filter((t) => APPR.includes(t.status)) }
      }
      setData(items)
    } catch (e) { toast.error(e.message) } finally { setLoading(false) }
  }, [filters, preset])

  useEffect(() => { load() }, [load, refresh])

  return (
    <div className="space-y-4">
      {isSuper && (
        <Tabs value={filters.department} onValueChange={(v) => setFilters({ ...filters, department: v, category: 'all', page: 1 })}>
          <TabsList>
            <TabsTrigger value="IT">IT Department</TabsTrigger>
            <TabsTrigger value="Admin">Admin Department</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8 w-56" placeholder="Search id, title..." value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })} />
          </div>
          <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v, page: 1 })}>
            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All statuses</SelectItem>{ALL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filters.priority} onValueChange={(v) => setFilters({ ...filters, priority: v, page: 1 })}>
            <SelectTrigger className="w-32 h-9"><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All priority</SelectItem>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filters.category} onValueChange={(v) => setFilters({ ...filters, category: v, page: 1 })}>
            <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All categories</SelectItem>{cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCsv(data.items)}><Download className="h-4 w-4 mr-1" />Export</Button>
          {preset === 'approvals'
            ? (['it', 'admin'].includes(user.role) && <RaiseRequest user={user} onCreated={() => { onRefresh?.(); load() }} />)
            : <RaiseTicket user={user} onCreated={() => { onRefresh?.(); load() }} />}
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead>ID</TableHead><TableHead>Title</TableHead><TableHead>Category</TableHead>
              <TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead>Assignee</TableHead>
              <TableHead>SLA</TableHead><TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
            )) : data.items.length === 0 ? (
              <TableRow><TableCell colSpan={8}><div className="py-12 text-center text-muted-foreground"><Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />No tickets found</div></TableCell></TableRow>
            ) : data.items.map((t) => {
              const sla = slaRemaining(t.sla_resolution_due)
              const done = ['Resolved', 'Closed', 'Cancelled'].includes(t.status)
              return (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => onOpenTicket(t.id)}>
                  <TableCell className="font-mono text-xs">{t.human_id}</TableCell>
                  <TableCell className="max-w-[220px] truncate">{t.title}</TableCell>
                  <TableCell className="text-sm">{t.category}</TableCell>
                  <TableCell><Badge className={PRIORITY_META[t.priority]?.badge}>{t.priority}</Badge></TableCell>
                  <TableCell><Badge variant="outline" className={statusClass(t.status)}>{t.status}</Badge></TableCell>
                  <TableCell className="text-sm">{t.assignee_name || '-'}</TableCell>
                  <TableCell className="text-sm">{done ? '-' : <span className={sla.breach ? 'text-red-600 font-semibold' : 'text-emerald-600'}>{sla.text}</span>}</TableCell>
                  <TableCell className="text-sm">{fmtDate(t.created_at)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{data.total} tickets</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>Prev</Button>
          <span className="text-sm">Page {data.page} / {data.pages || 1}</span>
          <Button variant="outline" size="sm" disabled={filters.page >= (data.pages || 1)} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Next</Button>
        </div>
      </div>
    </div>
  )
}

function LocationSelect({ value, onChange, locs }) {
  const groups = locs.reduce((a, l) => { (a[l.building || 'Other'] = a[l.building || 'Other'] || []).push(l); return a }, {})
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9"><SelectValue placeholder="Select location" /></SelectTrigger>
      <SelectContent>
        {Object.entries(groups).map(([building, items]) => (
          <SelectGroup key={building}>
            <SelectLabel>{building}</SelectLabel>
            {items.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

function RaiseTicket({ user, onCreated }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cats, setCats] = useState([])
  const [locs, setLocs] = useState([])
  const [f, setF] = useState({ department: 'IT', category: '', title: '', description: '', priority: 'Medium', location: 'Tulip - Ground Floor', raised_for_name: '', employee_id: '', email: '' })

  useEffect(() => {
    if (!open) return
    api(`/categories?department=${f.department}`).then((c) => setCats(c.map((x) => x.name))).catch(() => {})
    api('/locations').then(setLocs).catch(() => {})
  }, [open, f.department])

  const submit = async () => {
    if (!f.title) return toast.error('Title required')
    setBusy(true)
    try { const t = await api('/tickets', { method: 'POST', body: f }); toast.success(`Raised ${t.human_id}`); setOpen(false); setF({ ...f, title: '', description: '', category: '' }); onCreated() }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const staff = ['it', 'admin', 'super_admin'].includes(user.role)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Raise Ticket</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Raise a Ticket</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Department</Label>
              <Select value={f.department} onValueChange={(v) => setF({ ...f, department: v, category: '' })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="IT">IT</SelectItem><SelectItem value="Admin">Admin</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Priority</Label>
              <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Category</Label>
              <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Location</Label>
              <LocationSelect value={f.location} onChange={(v) => setF({ ...f, location: v })} locs={locs} />
            </div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Title</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Brief summary" /></div>
          <div className="space-y-1"><Label className="text-xs">Description</Label><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Describe the issue" /></div>
          {staff && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">Raised for</Label><Input value={f.raised_for_name} onChange={(e) => setF({ ...f, raised_for_name: e.target.value })} placeholder="Employee name" /></div>
              <div className="space-y-1"><Label className="text-xs">Employee ID</Label><Input value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Email</Label><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            </div>
          )}
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy}>Submit</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RaiseRequest({ user, onCreated }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cats, setCats] = useState([])
  const [locs, setLocs] = useState([])
  const dept = user.role === 'admin' ? 'Admin' : 'IT'
  const [f, setF] = useState({ category: '', title: '', description: '', priority: 'High', location: 'Tulip - Ground Floor', justification: '', requested_amount: '', vendor: '', required_by: '' })

  useEffect(() => {
    if (!open) return
    api(`/categories?department=${dept}`).then((c) => setCats(c.map((x) => x.name))).catch(() => {})
    api('/locations').then(setLocs).catch(() => {})
  }, [open])

  const submit = async () => {
    if (!f.title || !f.justification) return toast.error('Title and justification are required')
    setBusy(true)
    try {
      const t = await api('/tickets', { method: 'POST', body: { department: dept, category: f.category, title: f.title, description: f.description, priority: f.priority, location: f.location } })
      await api(`/tickets/${t.id}/approval/submit`, { method: 'POST', body: { justification: f.justification, requested_amount: Number(f.requested_amount) || 0, vendor: f.vendor, required_by: f.required_by } })
      toast.success(`Request ${t.human_id} sent to Super Admin`)
      setOpen(false)
      setF({ ...f, title: '', description: '', justification: '', requested_amount: '', vendor: '' })
      onCreated()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Raise Request</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Raise Approval Request ({dept})</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">This request will be submitted to the Super Admin for approval before any execution.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Category</Label>
              <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-xs">Priority</Label>
              <Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Location</Label>
            <LocationSelect value={f.location} onChange={(v) => setF({ ...f, location: v })} locs={locs} />
          </div>
          <div className="space-y-1"><Label className="text-xs">Title</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="What is being requested" /></div>
          <div className="space-y-1"><Label className="text-xs">Justification</Label><Textarea rows={2} value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} placeholder="Why is this needed" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label className="text-xs">Amount (₹)</Label><Input type="number" value={f.requested_amount} onChange={(e) => setF({ ...f, requested_amount: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Vendor</Label><Input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Required by</Label><Input type="date" value={f.required_by} onChange={(e) => setF({ ...f, required_by: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy}>Submit to Super Admin</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

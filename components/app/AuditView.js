'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, fmtDateTime } from '@/lib/appapi'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Filter, RefreshCcw, Search } from 'lucide-react'
import { toast } from 'sonner'

const inputDate = (date) => new Date(date).toISOString().slice(0, 10)

export default function AuditView({ onOpenTicket }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState('all')
  const [entity, setEntity] = useState('all')
  const [actor, setActor] = useState('all')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const query = useMemo(() => {
    const p = new URLSearchParams()
    if (action !== 'all') p.set('action', action)
    if (entity !== 'all') p.set('entity', entity)
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    if (search.trim()) p.set('search', search.trim())
    p.set('limit', '500')
    return p.toString()
  }, [action, entity, from, to, search])

  const load = useCallback(() => {
    setLoading(true)
    api(`/audit?${query}`)
      .then(setData)
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false))
  }, [query])

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(load, 300)
    return () => clearTimeout(timer)
  }, [load])

  // Actor is filtered client-side: the API keys on id, the picker on name.
  const rows = useMemo(() => {
    const items = data?.items || []
    return actor === 'all' ? items : items.filter((item) => item.actor_name === actor)
  }, [data, actor])

  const filters = data?.filters || { actions: [], entities: [], actors: [] }
  const hasFilters = action !== 'all' || entity !== 'all' || actor !== 'all' || Boolean(search.trim() || from || to)
  const todayInput = inputDate(new Date())

  const clearAll = () => {
    setAction('all'); setEntity('all'); setActor('all'); setSearch(''); setFrom(''); setTo('')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E5E9EF] bg-[#FAFBFC] px-4 py-3">
        <Filter className="h-5 w-5 text-[#4B5563]" />
        <span className="font-semibold text-[#4B5563]">Filters:</span>

        <div className="flex w-full items-center gap-2 rounded-lg border border-[#E5E9EF] bg-white px-3 sm:w-64">
          <Search className="h-4 w-4 shrink-0 text-[#9CA3AF]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ticket ID, actor, action…"
            className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>

        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-full bg-white sm:w-52"><SelectValue placeholder="Action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {filters.actions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={entity} onValueChange={setEntity}>
          <SelectTrigger className="w-full bg-white sm:w-44"><SelectValue placeholder="Entity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entities</SelectItem>
            {filters.entities.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={actor} onValueChange={setActor}>
          <SelectTrigger className="w-full bg-white sm:w-48"><SelectValue placeholder="Actor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actors</SelectItem>
            {filters.actors.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-1 text-sm text-[#4B5563]">From
          <input type="date" value={from} max={to || todayInput} onChange={(event) => setFrom(event.target.value)} className="h-9 rounded-lg border border-[#DDE2EA] bg-white px-2 text-sm" />
        </label>
        <label className="flex items-center gap-1 text-sm text-[#4B5563]">To
          <input type="date" value={to} min={from || undefined} max={todayInput} onChange={(event) => setTo(event.target.value)} className="h-9 rounded-lg border border-[#DDE2EA] bg-white px-2 text-sm" />
        </label>

        {hasFilters && (
          <button onClick={clearAll} className="rounded-full border px-3 py-2 text-sm text-[#4B5563]">Clear filters ×</button>
        )}
        <Button variant="outline" size="sm" className="ml-auto" onClick={load} disabled={loading}>
          <RefreshCcw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card>
        {loading && !data ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Ticket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-sm">{fmtDateTime(log.created_at)}</TableCell>
                    <TableCell className="text-sm">{log.actor_name}</TableCell>
                    <TableCell><Badge variant="outline">{log.actor_role}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{log.action}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.entity} {log.entity_id ? log.entity_id.slice(0, 8) : ''}
                    </TableCell>
                    <TableCell>
                      {log.ticket_human_id ? (
                        <button
                          type="button"
                          onClick={() => onOpenTicket?.(log.ticket_id)}
                          disabled={!log.ticket_id || !onOpenTicket}
                          className="font-mono text-xs font-semibold text-[#2E7CD6] underline-offset-2 hover:underline disabled:cursor-default disabled:text-[#697087] disabled:no-underline"
                        >
                          {log.ticket_human_id}
                        </button>
                      ) : (
                        <span className="text-xs text-[#9CA3AF]">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      {hasFilters ? 'No audit entries match these filters.' : 'No audit entries'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {data && (
        <p className="text-xs text-[#9CA3AF]">
          Showing {rows.length}{rows.length === 500 ? '+' : ''} entr{rows.length === 1 ? 'y' : 'ies'}, newest first.
        </p>
      )}
    </div>
  )
}

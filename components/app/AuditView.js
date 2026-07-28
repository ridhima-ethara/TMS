'use client'
import { useEffect, useState } from 'react'
import { api, fmtDateTime } from '@/lib/appapi'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'

export default function AuditView() {
  const [logs, setLogs] = useState([])
  useEffect(() => { api('/audit').then(setLogs).catch((e) => toast.error(e.message)) }, [])
  return (
    <Card>
      <Table>
        <TableHeader className="sticky top-0 bg-card"><TableRow><TableHead>Time</TableHead><TableHead>Actor</TableHead><TableHead>Role</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead></TableRow></TableHeader>
        <TableBody>
          {logs.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="text-sm">{fmtDateTime(l.created_at)}</TableCell>
              <TableCell className="text-sm">{l.actor_name}</TableCell>
              <TableCell><Badge variant="outline">{l.actor_role}</Badge></TableCell>
              <TableCell className="font-mono text-xs">{l.action}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{l.entity} {l.entity_id ? l.entity_id.slice(0, 8) : ''}</TableCell>
            </TableRow>
          ))}
          {logs.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No audit entries</TableCell></TableRow>}
        </TableBody>
      </Table>
    </Card>
  )
}

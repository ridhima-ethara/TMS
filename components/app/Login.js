'use client'
import { useState } from 'react'
import { api, ROLE_LABEL } from '@/lib/appapi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Ticket, ShieldCheck, Loader2 } from 'lucide-react'

const DEMO = [
  { email: 'employee@demo.com', role: 'employee' },
  { email: 'it@demo.com', role: 'it' },
  { email: 'admin@demo.com', role: 'admin' },
  { email: 'superadmin@demo.com', role: 'super_admin' },
]

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('superadmin@demo.com')
  const [password, setPassword] = useState('Passw0rd!')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e?.preventDefault()
    setLoading(true)
    try {
      const { user } = await api('/auth/login', { method: 'POST', body: { email, password } })
      toast.success(`Welcome, ${user.name}`)
      onLogin(user)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const quick = async (em) => {
    setEmail(em); setPassword('Passw0rd!')
    setLoading(true)
    try {
      const { user } = await api('/auth/login', { method: 'POST', body: { email: em, password: 'Passw0rd!' } })
      toast.success(`Welcome, ${user.name}`)
      onLogin(user)
    } catch (err) { toast.error(err.message) } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-slate-900 text-white p-12">
        <div className="flex items-center gap-2 text-xl font-semibold">
          <Ticket className="h-6 w-6 text-teal-400" /> TicketFlow
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">IT & Admin Service Management</h1>
          <p className="mt-4 text-slate-300 max-w-md">Tickets, approvals, operational tasks and checklists — with SLA tracking, role-based access and immutable audit trails.</p>
          <div className="mt-8 grid grid-cols-2 gap-3 max-w-md">
            {['Ticket Lifecycle','Approval Workflow','SLA & Escalations','Audit Logs'].map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-slate-200"><ShieldCheck className="h-4 w-4 text-teal-400" />{f}</div>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500">Enterprise Service Desk Platform</p>
      </div>

      <div className="flex items-center justify-center p-6 bg-background">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">Sign in</CardTitle>
            <p className="text-sm text-muted-foreground">Use a demo account or your credentials.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sign in
              </Button>
            </form>
            <div className="mt-6">
              <p className="text-xs text-muted-foreground mb-2">Quick demo login (password: Passw0rd!)</p>
              <div className="grid grid-cols-2 gap-2">
                {DEMO.map((d) => (
                  <Button key={d.email} variant="outline" size="sm" onClick={() => quick(d.email)} disabled={loading}>
                    {ROLE_LABEL[d.role]}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

'use client'
import { useState } from 'react'
import { api } from '@/lib/appapi'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Ticket, ShieldCheck, Loader2 } from 'lucide-react'

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [loading, setLoading] = useState(false)
  const [login, setLoginState] = useState({ email: '', password: '' })
  const [reg, setReg] = useState({ name: '', email: '', password: '', role: 'employee' })

  const doLogin = async (e) => {
    e?.preventDefault()
    setLoading(true)
    try {
      const { user } = await api('/auth/login', { method: 'POST', body: login })
      toast.success(`Welcome, ${user.name}`)
      onLogin(user)
    } catch (err) { toast.error(err.message) } finally { setLoading(false) }
  }

  const doRegister = async (e) => {
    e?.preventDefault()
    if (!reg.email.toLowerCase().endsWith('@ethara.ai')) return toast.error('Please use your @ethara.ai email')
    setLoading(true)
    try {
      const { user } = await api('/auth/register', { method: 'POST', body: reg })
      toast.success(`Account created. Welcome, ${user.name}!`)
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
          <h1 className="text-4xl font-bold leading-tight">IT &amp; Admin Service Management</h1>
          <p className="mt-4 text-slate-300 max-w-md">Tickets, approvals, operational tasks and KRA checklists — with SLA tracking, role-based access and immutable audit trails.</p>
          <div className="mt-8 grid grid-cols-2 gap-3 max-w-md">
            {['Ticket Lifecycle', 'Approval Workflow', 'SLA &amp; Escalations', 'Daily KRA Tracking'].map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-slate-200"><ShieldCheck className="h-4 w-4 text-teal-400" />{f}</div>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500">Restricted to @ethara.ai accounts</p>
      </div>

      <div className="flex items-center justify-center p-6 bg-background">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader>
            <CardTitle className="text-2xl">{mode === 'login' ? 'Sign in' : 'Create account'}</CardTitle>
            <p className="text-sm text-muted-foreground">Use your company <span className="font-medium">@ethara.ai</span> email.</p>
          </CardHeader>
          <CardContent>
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList className="grid grid-cols-2 w-full mb-4">
                <TabsTrigger value="login">Login</TabsTrigger>
                <TabsTrigger value="register">Register</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form onSubmit={doLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input type="email" value={login.email} onChange={(e) => setLoginState({ ...login, email: e.target.value })} placeholder="you@ethara.ai" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Password</Label>
                    <Input type="password" value={login.password} onChange={(e) => setLoginState({ ...login, password: e.target.value })} placeholder="••••••••" />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sign in
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register">
                <form onSubmit={doRegister} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Full name</Label>
                    <Input value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} placeholder="Your name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Work email</Label>
                    <Input type="email" value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} placeholder="you@ethara.ai" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Register as</Label>
                    <Select value={reg.role} onValueChange={(v) => setReg({ ...reg, role: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="employee">Employee</SelectItem>
                        <SelectItem value="it">IT Team Member</SelectItem>
                        <SelectItem value="admin">Admin Team Member</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Password</Label>
                    <Input type="password" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} placeholder="Min 6 characters" />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create account
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="mt-6 rounded-md border bg-muted/40 p-3">
              <p className="text-xs font-medium text-center mb-2">Demo accounts <span className="text-muted-foreground font-normal">(password: Passw0rd!)</span></p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Employee: <span className="font-medium text-foreground">employee@ethara.ai</span></span>
                <span>IT Team: <span className="font-medium text-foreground">it@ethara.ai</span></span>
                <span>Admin Team: <span className="font-medium text-foreground">admin@ethara.ai</span></span>
                <span>Super Admin: <span className="font-medium text-foreground">superadmin@ethara.ai</span></span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { api } from '@/lib/appapi'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { ArrowRight, BarChart3, Building2, Check, ClipboardCheck, Eye, EyeOff, Loader2, LockKeyhole, Mail, ShieldCheck, Ticket, User, Wrench } from 'lucide-react'

const DEMOS = [
  { role: 'Employee', hint: 'raise tickets', initials: 'EM', email: 'employee@ethara.ai', color: 'bg-[#8B93A1]' },
  { role: 'IT team', hint: 'agent view', initials: 'IT', email: 'it@ethara.ai', color: 'bg-[#2E7CD6]' },
  { role: 'Admin team', hint: 'agent view', initials: 'AD', email: 'admin@ethara.ai', color: 'bg-[#1B7F6E]' },
  { role: 'Super admin', hint: 'full access', initials: 'SA', email: 'superadmin@ethara.ai', color: 'bg-[#151a28]' },
]

const ROLE_OPTIONS = [
  { value: 'employee', label: 'Employee', hint: 'raise tickets', icon: User },
  { value: 'it', label: 'IT team', hint: 'needs approval', icon: Wrench },
  { value: 'admin', label: 'Admin team', hint: 'needs approval', icon: Building2 },
]

function BrandMark() {
  return <div className="relative flex items-center gap-3 text-xl font-bold"><span className="grid h-10 w-10 place-items-center rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 shadow-[0_0_24px_rgba(238,0,238,.18)]"><Ticket className="h-5 w-5 text-[#ee00ee]" /></span><span>Ethara <span className="text-[#ee00ee]">Service Hub</span></span></div>
}

function Feature({ icon: Icon, title, children }) {
  return <div className="flex gap-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[.05]"><Icon className="h-4 w-4 text-[#ee00ee]" /></span><div><p className="text-sm font-semibold text-white">{title}</p><p className="mt-1 text-sm leading-6 text-[#8a8fa5]">{children}</p></div></div>
}

function SidePanel({ mode }) {
  const register = mode === 'register'
  return (
    <aside className="relative hidden min-h-screen overflow-hidden bg-[#0b0e14] px-12 py-10 text-white lg:flex lg:w-[42%] lg:flex-col xl:px-16 xl:py-14">
      <div className="pointer-events-none absolute -left-40 top-1/3 h-[28rem] w-[28rem] rounded-full bg-[#ee00ee]/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-48 -top-48 h-[36rem] w-[36rem] rounded-full border border-[#ee00ee]/15" />
      <BrandMark />
      <div className="relative my-auto max-w-md py-16">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[.24em] text-[#ee00ee]">{register ? 'Simple, secure onboarding' : 'Operations, intelligently connected'}</p>
        <h1 className="text-4xl font-bold leading-tight xl:text-5xl">{register ? <>Get set up<br />in under a minute</> : <>One desk for IT<br />and Admin services</>}</h1>
        <p className="mt-5 leading-7 text-[#c5cbe9]">{register ? 'Create your account with a company email and start raising tickets right away.' : 'Raise tickets, track SLAs, and keep daily KRAs on schedule across both departments.'}</p>
        {register ? <div className="mt-10 space-y-7">{[
          ['1', 'Create your account', 'Name, company email, and a strong password'],
          ['2', 'Verify your email', 'Confirm access through your @ethara.ai inbox'],
          ['3', 'Start raising tickets', 'Team roles are approved by the super admin'],
        ].map(([number, title, detail], index) => <div key={number} className="flex gap-4"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ${index === 0 ? 'bg-[#ee00ee] text-white shadow-[0_0_22px_rgba(238,0,238,.28)]' : 'bg-white/[.06] text-[#8a8fa5]'}`}>{number}</span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-sm text-[#8a8fa5]">{detail}</p></div></div>)}</div> : <div className="mt-10 space-y-7"><Feature icon={Ticket} title="Unified ticketing">IT and Admin queues with SLA timers and escalations</Feature><Feature icon={BarChart3} title="Live analytics">Role-specific dashboards and service-desk insights</Feature><Feature icon={ClipboardCheck} title="Daily KRA tracking">Checklists, submissions, and compliance streaks</Feature></div>}
      </div>
      <p className="relative text-xs text-[#5a6080]">© 2026 Ethara AI · Internal service management</p>
    </aside>
  )
}

function Field({ label, icon: Icon, right, children }) {
  return <div><div className="mb-2 flex items-center justify-between"><Label className="text-[13px] font-semibold text-[#111827]">{label}</Label>{right}</div><div className="relative"><Icon className="pointer-events-none absolute left-3.5 top-3.5 z-10 h-4 w-4 text-[#9CA3AF]" />{children}</div></div>
}

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [remember, setRemember] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [login, setLogin] = useState({ email: '', password: '' })
  const [reg, setReg] = useState({ name: '', email: '', password: '', confirm: '', role: 'employee' })

  const emailValid = reg.email.toLowerCase().endsWith('@ethara.ai')
  const passwordsMatch = Boolean(reg.confirm) && reg.password === reg.confirm
  const strength = useMemo(() => {
    let score = 0
    if (reg.password.length >= 8) score++
    if (/[A-Z]/.test(reg.password) && /[a-z]/.test(reg.password)) score++
    if (/\d/.test(reg.password)) score++
    if (/[^A-Za-z0-9]/.test(reg.password)) score++
    return score
  }, [reg.password])

  const doLogin = async (event) => {
    event?.preventDefault()
    setLoading(true)
    try { const { user } = await api('/auth/login', { method: 'POST', body: login }); toast.success(`Welcome, ${user.name}`); onLogin(user) }
    catch (error) { toast.error(error.message) } finally { setLoading(false) }
  }

  const doRegister = async (event) => {
    event?.preventDefault()
    if (!emailValid) return toast.error('Please use your @ethara.ai email')
    if (reg.password.length < 8) return toast.error('Password must be at least 8 characters')
    if (!passwordsMatch) return toast.error('Passwords do not match')
    if (!accepted) return toast.error('Please accept the acceptable use policy')
    setLoading(true)
    try { const { user } = await api('/auth/register', { method: 'POST', body: { name: reg.name, email: reg.email, password: reg.password, role: reg.role } }); toast.success(`Account created. Welcome, ${user.name}!`); onLogin(user) }
    catch (error) { toast.error(error.message) } finally { setLoading(false) }
  }

  const pickDemo = (demo) => setLogin({ email: demo.email, password: 'Passw0rd!' })
  const inputClass = 'h-11 rounded-[10px] border-[#E5E9EF] bg-[#FAFBFC] pl-10 pr-10 focus-visible:ring-[#ee00ee]'

  return (
    <div className="min-h-screen bg-white lg:flex">
      <SidePanel mode={mode} />
      <main className="flex min-h-screen flex-1 items-center justify-center bg-white px-6 py-10 sm:px-10">
        <div className={`w-full ${mode === 'login' ? 'max-w-[420px]' : 'max-w-[440px]'}`}>
          <div className="mb-10 lg:hidden"><BrandMark /></div>
          {mode === 'login' ? <>
            <h2 className="text-3xl font-bold text-[#111827]">Welcome back</h2>
            <p className="mt-2 text-sm text-[#4B5563]">Sign in with your company <b>@ethara.ai</b> email.</p>
            <form onSubmit={doLogin} className="mt-7 space-y-5">
              <Field label="Email" icon={Mail}><Input type="email" autoComplete="email" className={inputClass} value={login.email} onChange={(event) => setLogin({ ...login, email: event.target.value })} placeholder="you@ethara.ai" required /></Field>
              <Field label="Password" icon={LockKeyhole} right={<button type="button" onClick={() => toast.info('Contact your super admin to reset your password')} className="text-xs font-semibold text-[#b000b0] hover:text-[#ee00ee]">Forgot password?</button>}><Input type={showPassword ? 'text' : 'password'} autoComplete="current-password" className={inputClass} value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} placeholder="Enter your password" required /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-3 grid h-6 w-6 place-items-center text-[#9CA3AF]" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></Field>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[#4B5563]"><Checkbox checked={remember} onCheckedChange={(value) => setRemember(Boolean(value))} />Keep me signed in for 30 days</label>
              <Button type="submit" disabled={loading} className="h-12 w-full rounded-[10px] bg-[#ee00ee] font-semibold text-white shadow-[0_10px_28px_rgba(238,0,238,.18)] hover:bg-[#c900c9]">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign in <ArrowRight className="h-4 w-4" /></>}</Button>
            </form>
            <div className="my-6 flex items-center gap-3"><span className="h-px flex-1 bg-[#E5E9EF]" /><span className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Demo accounts · 1-click</span><span className="h-px flex-1 bg-[#E5E9EF]" /></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{DEMOS.map((demo) => <button key={demo.role} type="button" onClick={() => pickDemo(demo)} className={`rounded-[10px] border p-3 text-center transition hover:-translate-y-0.5 hover:border-fuchsia-300 hover:shadow-sm ${login.email === demo.email ? 'border-fuchsia-300 bg-fuchsia-50' : 'border-[#E5E9EF] bg-white'}`}><span className={`mx-auto grid h-8 w-8 place-items-center rounded-full text-[10px] font-semibold text-white ${demo.color}`}>{demo.initials}</span><b className="mt-2 block text-[11px] text-[#111827]">{demo.role}</b><span className="text-[10px] text-[#9CA3AF]">{demo.hint}</span></button>)}</div>
            <p className="mt-3 text-center text-[11px] text-[#9CA3AF]">Selecting a role fills credentials automatically · password Passw0rd!</p>
            <p className="mt-6 text-center text-sm text-[#4B5563]">New here? <button onClick={() => setMode('register')} className="font-semibold text-[#b000b0] hover:text-[#ee00ee]">Create an account</button></p>
          </> : <>
            <h2 className="text-3xl font-bold text-[#111827]">Create your account</h2>
            <p className="mt-2 text-sm text-[#4B5563]">Only <b>@ethara.ai</b> email addresses can register.</p>
            <form onSubmit={doRegister} className="mt-6 space-y-4">
              <Field label="Full name" icon={User}><Input className={inputClass} value={reg.name} onChange={(event) => setReg({ ...reg, name: event.target.value })} placeholder="Your full name" required /></Field>
              <Field label="Company email" icon={Mail}><Input type="email" className={inputClass} value={reg.email} onChange={(event) => setReg({ ...reg, email: event.target.value })} placeholder="you@ethara.ai" required />{reg.email && <span className={`absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full ${emailValid ? 'text-[#1E9E6A]' : 'text-red-500'}`}>{emailValid ? <Check className="h-4 w-4" /> : '×'}</span>}</Field>
              <div><Label className="text-[13px] font-semibold">I&apos;m joining as</Label><div className="mt-2 grid grid-cols-3 gap-2">{ROLE_OPTIONS.map((option) => { const Icon = option.icon; const active = reg.role === option.value; return <button key={option.value} type="button" onClick={() => setReg({ ...reg, role: option.value })} className={`rounded-[10px] border p-3 text-center transition ${active ? 'border-2 border-[#ee00ee] bg-fuchsia-50' : 'border-[#E5E9EF] hover:border-fuchsia-300'}`}><Icon className={`mx-auto h-5 w-5 ${active ? 'text-[#b000b0]' : 'text-[#4B5563]'}`} /><b className="mt-2 block text-xs">{option.label}</b><span className="text-[10px] text-[#9CA3AF]">{option.hint}</span></button>})}</div><p className="mt-2 text-[11px] text-[#9CA3AF]">Team roles are activated after super-admin approval. Employee access is instant.</p></div>
              <Field label="Password" icon={LockKeyhole}><Input type={showPassword ? 'text' : 'password'} className={inputClass} value={reg.password} onChange={(event) => setReg({ ...reg, password: event.target.value })} placeholder="Minimum 8 characters" required /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-3 text-[#9CA3AF]">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></Field>
              <div><div className="flex gap-1">{[1, 2, 3, 4].map((level) => <span key={level} className={`h-1 flex-1 rounded-full ${strength >= level ? strength < 3 ? 'bg-[#E8930C]' : 'bg-[#1E9E6A]' : 'bg-[#EDF0F4]'}`} />)}</div><p className="mt-1 text-[11px] text-[#4B5563]">{strength >= 4 ? 'Strong password' : 'Use 8+ characters, uppercase, a number, and a symbol.'}</p></div>
              <Field label="Confirm password" icon={LockKeyhole}><Input type={showConfirm ? 'text' : 'password'} className={inputClass} value={reg.confirm} onChange={(event) => setReg({ ...reg, confirm: event.target.value })} placeholder="Repeat your password" required />{reg.confirm && <span className={`absolute right-10 top-3 ${passwordsMatch ? 'text-[#1E9E6A]' : 'text-red-500'}`}>{passwordsMatch ? <Check className="h-4 w-4" /> : '×'}</span>}<button type="button" onClick={() => setShowConfirm((value) => !value)} className="absolute right-3 top-3 text-[#9CA3AF]">{showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></Field>
              <label className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-[#4B5563]"><Checkbox className="mt-0.5" checked={accepted} onCheckedChange={(value) => setAccepted(Boolean(value))} /><span>I agree to the <span className="font-semibold text-[#b000b0]">acceptable use policy</span> and understand tickets are logged for audit.</span></label>
              <Button type="submit" disabled={loading} className="h-12 w-full rounded-[10px] bg-[#ee00ee] font-semibold text-white hover:bg-[#c900c9]">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Create account <ArrowRight className="h-4 w-4" /></>}</Button>
            </form>
            <p className="mt-5 text-center text-sm text-[#4B5563]">Already have an account? <button onClick={() => setMode('login')} className="font-semibold text-[#b000b0] hover:text-[#ee00ee]">Sign in</button></p>
          </>}
        </div>
      </main>
    </div>
  )
}

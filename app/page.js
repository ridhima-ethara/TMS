'use client'
import { useCallback, useEffect, useState } from 'react'
import { api, ROLE_LABEL } from '@/lib/appapi'
import Login from '@/components/app/Login'
import Dashboard from '@/components/app/Dashboard'
import TicketsView from '@/components/app/TicketsView'
import TasksView from '@/components/app/TasksView'
import ChecklistsView from '@/components/app/ChecklistsView'
import MyChecklist from '@/components/app/MyChecklist'
import MemberChecklists from '@/components/app/MemberChecklists'
import AuditView from '@/components/app/AuditView'
import TicketDrawer from '@/components/app/TicketDrawer'
import { Toaster } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { Ticket, LayoutDashboard, FileCheck2, ListChecks, ClipboardList, ClipboardCheck, ScrollText, Bell, LogOut, Loader2, Menu, Users } from 'lucide-react'

const NAV = {
  employee: [{ k: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { k: 'tickets', label: 'My Tickets', icon: Ticket }],
  it: [
    { k: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { k: 'tickets', label: 'IT Tickets', icon: Ticket },
    { k: 'approvals', label: 'Approvals', icon: FileCheck2 },
    { k: 'mychecklist', label: 'My KRA / Tasks', icon: ClipboardCheck },
  ],
  admin: [
    { k: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { k: 'tickets', label: 'Admin Tickets', icon: Ticket },
    { k: 'approvals', label: 'Approvals', icon: FileCheck2 },
    { k: 'tasks', label: 'Operational Tasks', icon: ListChecks },
    { k: 'checklists', label: 'Checklists', icon: ClipboardList },
    { k: 'mychecklist', label: 'My KRA / Tasks', icon: ClipboardCheck },
  ],
  super_admin: [
    { k: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { k: 'tickets', label: 'All Tickets', icon: Ticket },
    { k: 'approvals', label: 'Approval Inbox', icon: FileCheck2 },
    { k: 'tasks', label: 'Operational Tasks', icon: ListChecks },
    { k: 'checklists', label: 'Checklists', icon: ClipboardList },
    { k: 'member-checklists', label: 'Member KRA', icon: Users },
    { k: 'audit', label: 'Audit Logs', icon: ScrollText },
  ],
}

export default function App() {
  const [user, setUser] = useState(null)
  const [booting, setBooting] = useState(true)
  const [view, setView] = useState('dashboard')
  const [refresh, setRefresh] = useState(0)
  const [openTicketId, setOpenTicketId] = useState(null)
  const [users, setUsers] = useState([])
  const [notifs, setNotifs] = useState([])
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const doRefresh = useCallback(() => setRefresh((n) => n + 1), [])

  const boot = useCallback(async () => {
    try {
      await api('/seed', { method: 'POST' })
      const { user } = await api('/auth/me')
      if (user) setUser(user)
    } catch (e) { /* ignore */ } finally { setBooting(false) }
  }, [])
  useEffect(() => { boot() }, [boot])

  const loadMeta = useCallback(async () => {
    if (!user) return
    try { setUsers(await api('/users')) } catch (e) {}
    try { setNotifs(await api('/notifications')) } catch (e) {}
  }, [user])
  useEffect(() => { loadMeta() }, [loadMeta, refresh])

  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); setView('dashboard') }
  const markRead = async () => { try { await api('/notifications/read', { method: 'POST' }); setNotifs((n) => n.map((x) => ({ ...x, read: true }))) } catch (e) {} }

  if (booting) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
  if (!user) return (<><Login onLogin={(u) => { setUser(u); doRefresh() }} /><Toaster richColors position="top-right" /></>)

  const nav = NAV[user.role] || NAV.employee
  const unread = notifs.filter((n) => !n.read).length
  const titleMap = { dashboard: 'Dashboard', tickets: nav.find((n) => n.k === 'tickets')?.label, approvals: 'Approvals', tasks: 'Operational Tasks', checklists: 'Checklists', mychecklist: 'My KRA / Daily Tasks', 'member-checklists': 'Member KRA', audit: 'Audit Logs' }

  const Sidebar = () => (
    <aside className="w-60 shrink-0 border-r bg-slate-900 text-slate-200 flex flex-col">
      <div className="h-16 flex items-center gap-2 px-5 border-b border-slate-800 text-lg font-semibold text-white">
        <Ticket className="h-5 w-5 text-teal-400" /> TicketFlow
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {nav.map((n) => {
          const Icon = n.icon
          const active = view === n.k
          return (
            <button key={n.k} onClick={() => { setView(n.k); setSidebarOpen(false) }} className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${active ? 'bg-teal-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
              <Icon className="h-4 w-4" />{n.label}
            </button>
          )
        })}
      </nav>
      <div className="p-3 border-t border-slate-800 text-xs text-slate-400">{ROLE_LABEL[user.role]}</div>
    </aside>
  )

  return (
    <div className="min-h-screen flex bg-muted/30">
      <div className="hidden md:flex"><Sidebar /></div>
      {sidebarOpen && <div className="fixed inset-0 z-40 md:hidden"><div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} /><div className="relative z-50 flex h-full"><Sidebar /></div></div>}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b bg-card flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)}><Menu className="h-5 w-5" /></Button>
            <div>
              <h1 className="text-lg font-semibold">{titleMap[view] || 'Dashboard'}</h1>
              <p className="text-xs text-muted-foreground">IT & Admin Service Management</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Popover onOpenChange={(o) => { if (o && unread) markRead() }}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="relative">
                  <Bell className="h-4 w-4" />
                  {unread > 0 && <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center">{unread}</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="p-3 font-medium text-sm border-b">Notifications</div>
                <ScrollArea className="h-72">
                  {notifs.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No notifications</p> : notifs.map((n) => (
                    <button key={n.id} onClick={() => n.ticket_id && setOpenTicketId(n.ticket_id)} className={`w-full text-left px-3 py-2 border-b text-sm hover:bg-muted/50 ${!n.read ? 'bg-teal-50' : ''}`}>
                      <p>{n.message}</p>
                      {n.ticket_human_id && <p className="text-xs text-muted-foreground font-mono">{n.ticket_human_id}</p>}
                    </button>
                  ))}
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8"><AvatarFallback className="text-xs bg-teal-600 text-white">{user.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</AvatarFallback></Avatar>
              <div className="hidden sm:block"><p className="text-sm font-medium leading-none">{user.name}</p><p className="text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</p></div>
            </div>
            <Button variant="ghost" size="icon" onClick={logout}><LogOut className="h-4 w-4" /></Button>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-x-hidden">
          {view === 'dashboard' && <Dashboard user={user} onOpenTicket={setOpenTicketId} refresh={refresh} />}
          {view === 'tickets' && <TicketsView user={user} onOpenTicket={setOpenTicketId} refresh={refresh} onRefresh={doRefresh} />}
          {view === 'approvals' && <TicketsView user={user} onOpenTicket={setOpenTicketId} refresh={refresh} onRefresh={doRefresh} preset="approvals" />}
          {view === 'tasks' && <TasksView user={user} />}
          {view === 'checklists' && <ChecklistsView user={user} onRefresh={doRefresh} />}
          {view === 'mychecklist' && <MyChecklist />}
          {view === 'member-checklists' && <MemberChecklists />}
          {view === 'audit' && <AuditView />}
        </main>
      </div>

      {openTicketId && (
        <TicketDrawer ticketId={openTicketId} user={user} users={users} open={!!openTicketId} onClose={() => setOpenTicketId(null)} onChanged={doRefresh} />
      )}
      <Toaster richColors position="top-right" />
    </div>
  )
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ROLE_LABEL } from "@/lib/appapi";
import Login from "@/components/app/Login";
import Dashboard from "@/components/app/Dashboard";
import TicketsView from "@/components/app/TicketsView";
import TasksView from "@/components/app/TasksView";
import ChecklistsView from "@/components/app/ChecklistsView";
import MyChecklist from "@/components/app/MyChecklist";
import SuperAdminMemberKra from "@/components/app/SuperAdminMemberKra";
import AuditView from "@/components/app/AuditView";
import TicketDrawer from "@/components/app/TicketDrawer";
import SuperAdminDashboard from "@/components/app/SuperAdminDashboard";
import SuperAdminTickets from "@/components/app/SuperAdminTickets";
import ApprovalsView from "@/components/app/ApprovalsView";
import ParkingView from "@/components/app/ParkingView";
import SettingsView from "@/components/app/SettingsView";
import {
  AgentDashboard,
  AgentKra,
  AgentTickets,
} from "@/components/app/AgentViews";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Ticket,
  LayoutDashboard,
  FileCheck2,
  ListChecks,
  ClipboardList,
  ClipboardCheck,
  ScrollText,
  Bell,
  LogOut,
  Loader2,
  Menu,
  Users,
  Car,
  Settings,
} from "lucide-react";

const NAV = {
  employee: [
    { k: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { k: "tickets", label: "My Tickets", icon: Ticket },
  ],
  it: [
    { k: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { k: "tickets", label: "IT Tickets", icon: Ticket },
    { k: "approvals", label: "Approvals", icon: FileCheck2 },
    { k: "mychecklist", label: "My KRA", icon: ClipboardCheck },
  ],
  admin: [
    { k: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { k: "tickets", label: "Admin Tickets", icon: Ticket },
    { k: "approvals", label: "Approvals", icon: FileCheck2 },
    { k: "mychecklist", label: "My KRA", icon: ClipboardCheck },
    { k: "parking", label: "Parking", icon: Car },
  ],
  super_admin: [
    { k: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { k: "tickets", label: "All Tickets", icon: Ticket },
    { k: "approvals", label: "Approval Inbox", icon: FileCheck2 },
    { k: "member-checklists", label: "Member KRA", icon: Users },
    { k: "parking", label: "Parking", icon: Car },
    { k: "settings", label: "Settings", icon: Settings },
    { k: "audit", label: "Audit Logs", icon: ScrollText },
  ],
};

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState("dashboard");
  const [refresh, setRefresh] = useState(0);
  const [openTicketId, setOpenTicketId] = useState(null);
  const [users, setUsers] = useState([]);
  const [notifs, setNotifs] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const doRefresh = useCallback(() => setRefresh((n) => n + 1), []);

  const boot = useCallback(async () => {
    try {
      await api("/seed", { method: "POST" });
      const { user } = await api("/auth/me");
      if (user) setUser(user);
    } catch (e) {
      /* ignore */
    } finally {
      setBooting(false);
    }
  }, []);
  useEffect(() => {
    boot();
  }, [boot]);

  const loadMeta = useCallback(async () => {
    if (!user) return;
    try {
      setUsers(await api("/users"));
    } catch (e) {}
    try {
      setNotifs(await api("/notifications"));
    } catch (e) {}
  }, [user]);
  useEffect(() => {
    loadMeta();
  }, [loadMeta, refresh]);

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
    setView("dashboard");
  };
  const markRead = async () => {
    try {
      await api("/notifications/read", { method: "POST" });
      setNotifs((n) => n.map((x) => ({ ...x, read: true })));
    } catch (e) {}
  };

  if (booting)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  if (!user)
    return (
      <>
        <Login
          onLogin={(u) => {
            setUser(u);
            doRefresh();
          }}
        />
        <Toaster richColors position="top-right" />
      </>
    );

  const nav = NAV[user.role] || NAV.employee;
  const unread = notifs.filter((n) => !n.read).length;
  const titleMap = {
    dashboard: "Dashboard",
    tickets: nav.find((n) => n.k === "tickets")?.label,
    approvals: "Approvals",
    tasks: "Operational Tasks",
    checklists: "Checklists",
    mychecklist: "My KRA / Daily Tasks",
    "member-checklists": "Member KRA",
    parking: "Tulip Parking",
    settings: "Member Settings",
    audit: "Audit Logs",
  };

  const Sidebar = () => (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[#E5E9EF] bg-white text-[#4B5563] shadow-[8px_0_28px_rgba(17,24,39,.04)]">
      <div className="flex h-16 items-center gap-3 border-b border-[#E5E9EF] px-5 text-lg font-semibold text-[#111827]">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-fuchsia-200 bg-fuchsia-50 shadow-sm">
          <Ticket className="h-5 w-5 text-[#ee00ee]" />
        </span>
        <span>
          Ethara <span className="text-[#ee00ee]">Service Hub</span>
        </span>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {nav.map((n) => {
          const Icon = n.icon;
          const active = view === n.k;
          return (
            <button
              key={n.k}
              onClick={() => {
                setView(n.k);
                setSidebarOpen(false);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${active ? "bg-fuchsia-50 text-[#9D139D] shadow-[inset_3px_0_0_#ee00ee]" : "text-[#4B5563] hover:bg-[#F4F6F8] hover:text-[#111827]"}`}
            >
              <Icon className="h-4 w-4" />
              {n.label}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-[#E5E9EF] p-4 text-xs text-[#6B7280]">
        <span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,.45)]" />
        {ROLE_LABEL[user.role]} workspace
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen flex bg-[#f7f8fc] dashboard-shell">
      <div className="hidden md:flex">
        <Sidebar />
      </div>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative z-50 flex h-full">
            <Sidebar />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="min-h-16 border-b border-[#e5e7f0] bg-white/90 backdrop-blur-xl flex items-center justify-between px-4 py-3 md:px-7 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-[#0b0e14]">
                {titleMap[view] || "Dashboard"}
              </h1>
              <p className="text-xs text-[#697087]">
                Ethara IT &amp; Admin Operations
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Popover
              onOpenChange={(o) => {
                if (o && unread) markRead();
              }}
            >
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="relative">
                  <Bell className="h-4 w-4" />
                  {unread > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-[10px] text-white flex items-center justify-center">
                      {unread}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="p-3 font-medium text-sm border-b">
                  Notifications
                </div>
                <ScrollArea className="h-72">
                  {notifs.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">
                      No notifications
                    </p>
                  ) : (
                    notifs.map((n) => (
                      <button
                        key={n.id}
                        onClick={() =>
                          n.ticket_id && setOpenTicketId(n.ticket_id)
                        }
                        className={`w-full text-left px-3 py-2 border-b text-sm hover:bg-muted/50 ${!n.read ? "bg-fuchsia-50" : ""}`}
                      >
                        <p>{n.message}</p>
                        {n.ticket_human_id && (
                          <p className="text-xs text-muted-foreground font-mono">
                            {n.ticket_human_id}
                          </p>
                        )}
                      </button>
                    ))
                  )}
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <div className="flex items-center gap-2">
              <Avatar className="h-9 w-9 ring-2 ring-fuchsia-100">
                <AvatarFallback className="text-xs bg-[#151a28] text-white">
                  {user.name
                    .split(" ")
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:block">
                <p className="text-sm font-medium leading-none">{user.name}</p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_LABEL[user.role]}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={logout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-7 overflow-x-hidden max-w-[1920px] w-full mx-auto">
          {view === "dashboard" &&
            (user.role === "super_admin" ? (
              <SuperAdminDashboard
                onViewKra={() => setView("member-checklists")}
              />
            ) : ["it", "admin"].includes(user.role) ? (
              <AgentDashboard
                user={user}
                onGoTickets={() => setView("tickets")}
                onGoKra={() => setView("mychecklist")}
              />
            ) : (
              <Dashboard
                user={user}
                onOpenTicket={setOpenTicketId}
                refresh={refresh}
              />
            ))}
          {view === "tickets" &&
            (user.role === "super_admin" ? (
              <SuperAdminTickets onOpenTicket={setOpenTicketId} />
            ) : ["it", "admin"].includes(user.role) ? (
              <AgentTickets user={user} onOpenTicket={setOpenTicketId} />
            ) : (
              <TicketsView
                user={user}
                onOpenTicket={setOpenTicketId}
                refresh={refresh}
                onRefresh={doRefresh}
              />
            ))}
          {view === "approvals" && (
            <ApprovalsView user={user} onOpenTicket={setOpenTicketId} />
          )}
          {view === "tasks" && <TasksView user={user} />}
          {view === "checklists" && (
            <ChecklistsView user={user} onRefresh={doRefresh} />
          )}
          {view === "mychecklist" &&
            (["it", "admin"].includes(user.role) ? (
              <AgentKra user={user} />
            ) : (
              <MyChecklist />
            ))}
          {view === "member-checklists" && <SuperAdminMemberKra />}
          {view === "parking" && <ParkingView />}
          {view === "settings" && <SettingsView />}
          {view === "audit" && <AuditView />}
        </main>
      </div>

      {openTicketId && (
        <TicketDrawer
          ticketId={openTicketId}
          user={user}
          users={users}
          open={!!openTicketId}
          onClose={() => setOpenTicketId(null)}
          onChanged={doRefresh}
        />
      )}
      <Toaster richColors position="top-right" />
    </div>
  );
}

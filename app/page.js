"use client";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ROLE_LABEL } from "@/lib/appapi";
import Login from "@/components/app/Login";
import Dashboard from "@/components/app/Dashboard";
import EmployeeAcknowledgements from "@/components/app/EmployeeAcknowledgements";
import TicketsView from "@/components/app/TicketsView";
import MyChecklist from "@/components/app/MyChecklist";
import SuperAdminMemberKra from "@/components/app/SuperAdminMemberKra";
import AuditView from "@/components/app/AuditView";
import TicketDrawer from "@/components/app/TicketDrawer";
import SuperAdminDashboard from "@/components/app/SuperAdminDashboard";
import SuperAdminTickets from "@/components/app/SuperAdminTickets";
import ApprovalsView from "@/components/app/ApprovalsView";
import ParkingView from "@/components/app/ParkingView";
import SettingsView from "@/components/app/SettingsView";
import FirewallView from "@/components/app/FirewallView";
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
  ClipboardCheck,
  ScrollText,
  Bell,
  LogOut,
  Loader2,
  Menu,
  Users,
  Car,
  Settings,
  Shield,
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  Clock3,
  MessageSquare,
  Sparkles,
  UserPlus,
  Volume2,
  VolumeX,
} from "lucide-react";

const NAV = {
  employee: [
    { k: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { k: "tickets", label: "My Tickets", icon: Ticket },
    { k: "acknowledgements", label: "Resolution Acknowledgements", icon: FileCheck2 },
  ],
  it: [
    { k: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { k: "tickets", label: "IT Tickets", icon: Ticket },
    { k: "approvals", label: "Approvals", icon: FileCheck2 },
    { k: "mychecklist", label: "My KRA", icon: ClipboardCheck },
    { k: "firewall", label: "Firewall Utilization", icon: Shield },
  ],
  admin: [
    { k: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { k: "tickets", label: "Admin Tickets", icon: Ticket },
    { k: "approvals", label: "Approvals", icon: FileCheck2 },
    { k: "mychecklist", label: "My KRA", icon: ClipboardCheck },
    { k: "parking", label: "Parking", icon: Car },
    { k: "firewall", label: "Firewall Utilization", icon: Shield },
  ],
  super_admin: [
    { k: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { k: "tickets", label: "All Tickets", icon: Ticket },
    { k: "approvals", label: "Approval Inbox", icon: FileCheck2 },
    { k: "member-checklists", label: "Member KRA", icon: Users },
    { k: "parking", label: "Parking", icon: Car },
    { k: "settings", label: "Settings", icon: Settings },
    { k: "firewall", label: "Firewall Utilization", icon: Shield },
    { k: "audit", label: "Audit Logs", icon: ScrollText },
  ],
};

function viewFromUrl(role) {
  if (typeof window === "undefined") return "dashboard";
  const requested = new URL(window.location.href).searchParams.get("view");
  const allowed = (NAV[role] || NAV.employee).some(
    (item) => item.k === requested,
  );
  return allowed ? requested : "dashboard";
}

function updateViewUrl(view, { replace = false } = {}) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (view === "dashboard") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  window.history[replace ? "replaceState" : "pushState"](
    { ...window.history.state, view },
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

function notificationPresentation(notification) {
  const message = String(notification.message || "").toLowerCase();
  const kind =
    notification.kind ||
    (/sla breach|escalat|overdue/.test(message)
      ? "escalation"
      : /resolved|closed|confirmed/.test(message)
        ? "resolution"
        : /assign|new .*ticket|ticket .*raised/.test(message)
          ? "assignment"
          : /comment|response/.test(message)
            ? "comment"
            : /approval|approved|rejected|clarification/.test(message)
              ? "approval"
              : /remind|pending/.test(message)
                ? "reminder"
                : "general");
  return {
    escalation: {
      Icon: AlertTriangle,
      icon: "bg-red-100 text-red-700",
      edge: "border-l-red-500",
      label: "Escalation",
    },
    resolution: {
      Icon: CheckCircle2,
      icon: "bg-emerald-100 text-emerald-700",
      edge: "border-l-emerald-500",
      label: "Resolution",
    },
    assignment: {
      Icon: UserPlus,
      icon: "bg-blue-100 text-blue-700",
      edge: "border-l-blue-500",
      label: "Assignment",
    },
    comment: {
      Icon: MessageSquare,
      icon: "bg-purple-100 text-purple-700",
      edge: "border-l-purple-500",
      label: "Conversation",
    },
    approval: {
      Icon: FileCheck2,
      icon: "bg-amber-100 text-amber-700",
      edge: "border-l-amber-500",
      label: "Approval",
    },
    reminder: {
      Icon: Clock3,
      icon: "bg-orange-100 text-orange-700",
      edge: "border-l-orange-500",
      label: "Reminder",
    },
    general: {
      Icon: Bell,
      icon: "bg-slate-100 text-slate-700",
      edge: "border-l-slate-400",
      label: "Update",
    },
  }[kind] || {
    Icon: Bell,
    icon: "bg-slate-100 text-slate-700",
    edge: "border-l-slate-400",
    label: "Update",
  };
}

function relativeNotificationTime(value) {
  const at = new Date(value).getTime();
  if (!Number.isFinite(at)) return "Just now";
  const elapsed = Math.max(0, Date.now() - at);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7
    ? `${days}d ago`
    : new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      });
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState("dashboard");
  const [refresh, setRefresh] = useState(0);
  const [openTicketId, setOpenTicketId] = useState(null);
  const [users, setUsers] = useState([]);
  const [notifs, setNotifs] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const notificationIdsRef = useRef(new Set());
  const notificationsReadyRef = useRef(false);
  const userInteractedRef = useRef(false);
  const soundEnabledRef = useRef(false);

  const doRefresh = useCallback(() => setRefresh((n) => n + 1), []);

  const navigateView = useCallback(
    (requested, options) => {
      const allowed = (NAV[user?.role] || NAV.employee).some(
        (item) => item.k === requested,
      );
      const next = allowed ? requested : "dashboard";
      setView(next);
      updateViewUrl(next, options);
    },
    [user?.role],
  );

  const boot = useCallback(async () => {
    try {
      const { user } = await api("/auth/me");
      if (user) {
        setUser(user);
        const restoredView = viewFromUrl(user.role);
        setView(restoredView);
        updateViewUrl(restoredView, { replace: true });
      }
    } catch (e) {
      /* ignore */
    } finally {
      setBooting(false);
    }
  }, []);
  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    if (!user) return undefined;
    const restoreBrowserView = () => setView(viewFromUrl(user.role));
    window.addEventListener("popstate", restoreBrowserView);
    return () => window.removeEventListener("popstate", restoreBrowserView);
  }, [user]);

  useEffect(() => {
    const enabled = window.localStorage.getItem("ticketflow-notification-sound") === "true";
    setSoundEnabled(enabled);
    soundEnabledRef.current = enabled;
  }, []);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    if (!user) return undefined;
    const markInteraction = () => {
      userInteractedRef.current = true;
    };
    window.addEventListener("pointerdown", markInteraction, { once: true });
    window.addEventListener("keydown", markInteraction, { once: true });
    return () => {
      window.removeEventListener("pointerdown", markInteraction);
      window.removeEventListener("keydown", markInteraction);
    };
  }, [user]);

  const playNotificationSound = useCallback(() => {
    if (!soundEnabledRef.current || !userInteractedRef.current) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext();
      const gain = context.createGain();
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        880,
        context.currentTime + 0.12,
      );
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.075, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.24);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.25);
      oscillator.addEventListener("ended", () => context.close());
    } catch {
      // Sound is an enhancement; browser audio restrictions must not affect alerts.
    }
  }, []);

  const loadNotifications = useCallback(
    async ({ announceNew = true } = {}) => {
      try {
        const items = await api("/notifications");
        const newlyArrived = notificationsReadyRef.current
          ? items.filter(
              (item) =>
                !item.read && !notificationIdsRef.current.has(item.id),
            )
          : [];
        notificationIdsRef.current = new Set(items.map((item) => item.id));
        notificationsReadyRef.current = true;
        setNotifs(items);
        if (announceNew && newlyArrived.length) {
          playNotificationSound();
          const latest = newlyArrived[0];
          toast.info(
            newlyArrived.length === 1
              ? latest.message
              : `${newlyArrived.length} new service updates`,
            {
              description:
                newlyArrived.length === 1
                  ? latest.ticket_human_id || "TicketFlow notification"
                  : latest.message,
              action: latest.ticket_id
                ? {
                    label: "View",
                    onClick: () => setOpenTicketId(latest.ticket_id),
                  }
                : undefined,
            },
          );
        }
      } catch {
        // Background polling stays quiet; foreground API errors remain actionable.
      }
    },
    [playNotificationSound],
  );

  const loadMeta = useCallback(async () => {
    if (!user) return;
    try {
      setUsers(await api("/users"));
    } catch (e) {}
  }, [user]);
  useEffect(() => {
    loadMeta();
  }, [loadMeta, refresh]);

  useEffect(() => {
    notificationIdsRef.current = new Set();
    notificationsReadyRef.current = false;
    if (!user) {
      setNotifs([]);
      return undefined;
    }
    loadNotifications({ announceNew: false });
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") loadNotifications();
    }, 25000);
    return () => window.clearInterval(interval);
  }, [user, loadNotifications]);

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    updateViewUrl("dashboard", { replace: true });
    setUser(null);
    setView("dashboard");
  };
  const markRead = async () => {
    try {
      await api("/notifications/read", { method: "POST" });
      setNotifs((n) => n.map((x) => ({ ...x, read: true })));
    } catch (e) {}
  };
  const markNotificationRead = async (notification) => {
    if (notification.read) return;
    try {
      await api(`/notifications/${notification.id}/read`, { method: "POST" });
      setNotifs((items) =>
        items.map((item) =>
          item.id === notification.id ? { ...item, read: true } : item,
        ),
      );
    } catch (error) {
      toast.error(error.message);
    }
  };
  const openNotification = async (notification) => {
    await markNotificationRead(notification);
    if (notification.ticket_id) setOpenTicketId(notification.ticket_id);
    setNotificationsOpen(false);
  };
  const toggleNotificationSound = () => {
    userInteractedRef.current = true;
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundEnabledRef.current = next;
    window.localStorage.setItem(
      "ticketflow-notification-sound",
      String(next),
    );
    toast.success(next ? "Notification sound enabled" : "Notification sound muted");
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
            const restoredView = viewFromUrl(u.role);
            setView(restoredView);
            updateViewUrl(restoredView, { replace: true });
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
    acknowledgements: "Resolution Acknowledgements",
    approvals: "Approvals",
    mychecklist: "My KRA / Daily Tasks",
    "member-checklists": "Member KRA",
    parking: "Tulip Parking",
    settings: "Member Settings",
    firewall: "Firewall Utilization",
    audit: "Audit Logs",
  };

  const Sidebar = () => (
    <aside className="dashboard-sidebar flex w-[min(16rem,calc(100vw-2rem))] shrink-0 flex-col border-r border-[#E5E9EF] bg-white text-[#4B5563] shadow-[8px_0_28px_rgba(17,24,39,.04)] md:w-64">
      <div className="flex h-16 items-center gap-3 border-b border-[#E5E9EF] px-5 text-lg font-semibold text-[#111827]">
        <span className="brand-emblem-frame flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#DDE8E3] bg-white shadow-sm">
          <Image src="/brand/ethara-emblem.png" alt="" width={36} height={36} priority className="brand-emblem h-9 w-9 object-contain" aria-hidden="true" />
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
                navigateView(n.k);
                setSidebarOpen(false);
              }}
              className={`dashboard-nav-item flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${active ? "bg-fuchsia-50 text-[#9D139D] shadow-[inset_3px_0_0_#ee00ee]" : "text-[#4B5563] hover:bg-[#F4F6F8] hover:text-[#111827]"}`}
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
            className="dashboard-mobile-backdrop absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="dashboard-mobile-sidebar relative z-50 flex h-full">
            <Sidebar />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-2 border-b border-[#e5e7f0] bg-white/90 px-2 py-2 backdrop-blur-xl sm:px-4 sm:py-3 md:px-7">
          <div className="flex min-w-0 items-center gap-1 sm:gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold text-[#0b0e14] sm:text-xl">
                {titleMap[view] || "Dashboard"}
              </h1>
              <p className="hidden text-xs text-[#697087] sm:block">
                Ethara IT &amp; Admin Operations
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <Popover open={notificationsOpen} onOpenChange={setNotificationsOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className={`relative ${unread ? "notification-bell-active border-fuchsia-200 bg-fuchsia-50 text-[#9D139D]" : ""}`}
                  aria-label={`${unread} unread notification${unread === 1 ? "" : "s"}`}
                >
                  <Bell className="h-4 w-4" />
                  {unread > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white shadow-sm">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[calc(100vw-1rem)] max-w-[390px] overflow-hidden rounded-2xl border-[#DDE3EA] p-0 shadow-2xl"
              >
                <div className="border-b border-[#E5E9EF] bg-gradient-to-r from-[#111827] to-[#20283A] p-4 text-white">
                  <div className="flex items-center gap-3">
                    <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-white/10">
                      <Bell className="h-5 w-5" />
                      {unread > 0 && (
                        <i className="notification-live-dot absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-400" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">Notification centre</p>
                      <p className="text-xs text-white/65">
                        {unread
                          ? `${unread} update${unread === 1 ? "" : "s"} need your attention`
                          : "You are all caught up"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={toggleNotificationSound}
                      className="grid h-8 w-8 place-items-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                      aria-label={soundEnabled ? "Mute notification sounds" : "Enable notification sounds"}
                      title={soundEnabled ? "Mute notification sounds" : "Enable notification sounds"}
                    >
                      {soundEnabled ? (
                        <Volume2 className="h-4 w-4" />
                      ) : (
                        <VolumeX className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {unread > 0 && (
                    <button
                      type="button"
                      onClick={markRead}
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300 hover:text-emerald-200"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      Mark all as read
                    </button>
                  )}
                </div>
                <ScrollArea className="h-[min(430px,60vh)] bg-[#FAFBFC]">
                  {notifs.length === 0 ? (
                    <div className="flex min-h-64 flex-col items-center justify-center px-8 text-center">
                      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
                        <Sparkles className="h-6 w-6" />
                      </span>
                      <p className="mt-4 font-semibold text-[#111827]">
                        Quiet, in a good way
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#697087]">
                        Assignments, SLA escalations, approvals, and resolution
                        updates will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="p-2">
                      {notifs.map((notification) => {
                        const meta = notificationPresentation(notification);
                        const Icon = meta.Icon;
                        return (
                          <button
                            key={notification.id}
                            type="button"
                            onClick={() => openNotification(notification)}
                            className={`notification-item mb-1 flex w-full items-start gap-3 rounded-xl border-l-[3px] px-3 py-3 text-left transition-colors hover:bg-white hover:shadow-sm ${meta.edge} ${!notification.read ? "notification-arrival bg-white" : "bg-transparent opacity-80"}`}
                          >
                            <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${meta.icon}`}>
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <b className="text-[10px] uppercase tracking-wider text-[#697087]">
                                  {meta.label}
                                </b>
                                {!notification.read && (
                                  <i className="h-1.5 w-1.5 rounded-full bg-[#ee00ee]" />
                                )}
                                <time className="ml-auto text-[10px] text-[#9CA3AF]">
                                  {relativeNotificationTime(notification.created_at)}
                                </time>
                              </span>
                              <span className="mt-1 block text-sm leading-5 text-[#202633]">
                                {notification.message}
                              </span>
                              {notification.ticket_human_id && (
                                <span className="mt-1.5 inline-block rounded-md bg-[#F0F2F5] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#4B5563]">
                                  {notification.ticket_human_id}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8 ring-2 ring-fuchsia-100 sm:h-9 sm:w-9">
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

        <main className="mx-auto w-full max-w-[1920px] flex-1 overflow-x-hidden p-3 sm:p-4 md:p-7">
          <div key={view} className="dashboard-view-enter">
          {view === "dashboard" &&
            (user.role === "super_admin" ? (
              <SuperAdminDashboard
                onViewKra={() => navigateView("member-checklists")}
                onOpenTicket={setOpenTicketId}
              />
            ) : ["it", "admin"].includes(user.role) ? (
              <AgentDashboard
                user={user}
                onGoTickets={() => navigateView("tickets")}
                onGoKra={() => navigateView("mychecklist")}
              />
            ) : (
              <Dashboard
                user={user}
                onOpenTicket={setOpenTicketId}
                onGoTickets={() => navigateView("tickets")}
                onGoAcknowledgements={() => navigateView("acknowledgements")}
                refresh={refresh}
              />
            ))}
          {view === "acknowledgements" && user.role === "employee" && (
            <EmployeeAcknowledgements
              onOpenTicket={setOpenTicketId}
              refresh={refresh}
              onRefresh={doRefresh}
            />
          )}
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
          {view === "mychecklist" &&
            (["it", "admin"].includes(user.role) ? (
              <AgentKra user={user} />
            ) : (
              <MyChecklist />
            ))}
          {view === "member-checklists" && <SuperAdminMemberKra />}
          {view === "parking" && <ParkingView />}
          {view === "settings" && <SettingsView />}
          {view === "firewall" && <FirewallView user={user} />}
          {view === "audit" && <AuditView />}
          </div>
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

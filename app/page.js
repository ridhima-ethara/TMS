"use client";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ROLE_LABEL } from "@/lib/appapi";
import { configureSla } from "@/lib/sla";
import Login from "@/components/app/Login";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ThemeToggle from "@/components/app/ThemeToggle";
import dynamic from "next/dynamic";

// Each screen is its own chunk, loaded when first opened. Shipping every view
// (the Firewall view alone is ~6k lines, plus the chart library) in the first
// bundle made the initial load download and parse everything for every user.
const ViewLoading = () => (
  <div className="h-[520px] w-full animate-pulse rounded-xl bg-[#ebeae6]" />
);
const lazyView = (loader) =>
  dynamic(loader, { ssr: false, loading: ViewLoading });
const Dashboard = lazyView(() => import("@/components/app/Dashboard"));
const EmployeeAcknowledgements = lazyView(() => import("@/components/app/EmployeeAcknowledgements"));
const TicketsView = lazyView(() => import("@/components/app/TicketsView"));
const MyChecklist = lazyView(() => import("@/components/app/MyChecklist"));
const SuperAdminMemberKra = lazyView(() => import("@/components/app/SuperAdminMemberKra"));
const AuditView = lazyView(() => import("@/components/app/AuditView"));
const TicketDrawer = dynamic(() => import("@/components/app/TicketDrawer"), { ssr: false });
const SuperAdminDashboard = lazyView(() => import("@/components/app/SuperAdminDashboard"));
const SuperAdminTickets = lazyView(() => import("@/components/app/SuperAdminTickets"));
const ApprovalsView = lazyView(() => import("@/components/app/ApprovalsView"));
const ParkingView = lazyView(() => import("@/components/app/ParkingView"));
const SettingsView = lazyView(() => import("@/components/app/SettingsView"));
const FirewallView = lazyView(() => import("@/components/app/FirewallView"));
const VendorAnalysis = lazyView(() => import("@/components/app/VendorAnalysis"));
const IncidentReportsView = lazyView(() => import("@/components/app/IncidentReports"));
const HeadDashboard = lazyView(() =>
  import("@/components/app/HeadDashboard"),
);
const MemberDashboard = lazyView(() =>
  import("@/components/app/MemberDashboard"),
);
const AgentKra = lazyView(() =>
  import("@/components/app/MyKraView"),
);
const TicketBoard = lazyView(() => import("@/components/app/TicketBoard"));
import { toast } from "sonner";
import {
  AlertOctagon,
  Ticket,
  LayoutDashboard,
  Laptop,
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
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronsUpDown,
  Clock3,
  MessageSquare,
  Sparkles,
  UserPlus,
  Volume2,
  VolumeX,
} from "lucide-react";


// Sidebar groups follow the Service Hub design: Service desk / People /
// Workplace / System. Roles only ever see their own items.
const NAV = {
  employee: [
    { k: "dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Service desk" },
    { k: "tickets", label: "My tickets", icon: Ticket, group: "Service desk" },
    { k: "acknowledgements", label: "Resolution acknowledgements", icon: FileCheck2, group: "Service desk" },
  ],
  it: [
    { k: "dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Service desk" },
    { k: "tickets", label: "IT tickets", icon: Ticket, group: "Service desk" },
    { k: "approvals", label: "Approvals", icon: FileCheck2, group: "Service desk" },
    { k: "incident-reports", label: "Incident reports", icon: AlertOctagon, group: "Service desk" },
    { k: "mychecklist", label: "My Checklist", icon: ClipboardCheck, group: "People" },
    { k: "vendor-analysis", label: "Vendor analysis", icon: Laptop, group: "People" },
    { k: "firewall", label: "Firewall", icon: Shield, group: "Workplace" },
  ],
  admin: [
    { k: "dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Service desk" },
    { k: "tickets", label: "Admin tickets", icon: Ticket, group: "Service desk" },
    { k: "approvals", label: "Approvals", icon: FileCheck2, group: "Service desk" },
    { k: "mychecklist", label: "My Checklist", icon: ClipboardCheck, group: "People" },
    { k: "vendor-analysis", label: "Vendor analysis", icon: Laptop, group: "People" },
    { k: "parking", label: "Parking", icon: Car, group: "Workplace" },
    { k: "firewall", label: "Firewall", icon: Shield, group: "Workplace" },
  ],
  super_admin: [
    { k: "dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Service desk" },
    { k: "tickets", label: "All tickets", icon: Ticket, group: "Service desk" },
    { k: "approvals", label: "Approval inbox", icon: FileCheck2, group: "Service desk" },
    { k: "incident-reports", label: "Incident reports", icon: AlertOctagon, group: "Service desk" },
    { k: "member-checklists", label: "Team & Checklists", icon: Users, group: "People" },
    { k: "vendor-analysis", label: "Vendor analysis", icon: Laptop, group: "People" },
    { k: "parking", label: "Parking", icon: Car, group: "Workplace" },
    { k: "firewall", label: "Firewall", icon: Shield, group: "Workplace" },
    { k: "settings", label: "Settings", icon: Settings, group: "System" },
    { k: "audit", label: "Audit logs", icon: ScrollText, group: "System" },
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

function notificationTargetView(notification, role) {
  const message = String(notification.message || "").toLowerCase();
  const kind = String(notification.kind || "").toLowerCase();
  if (notification.ticket_id) {
    if (
      kind === "approval" ||
      /approval|approved|rejected|clarification/.test(message)
    )
      return ["it", "admin", "super_admin"].includes(role)
        ? "approvals"
        : "tickets";
    if (
      role === "employee" &&
      (kind === "resolution" || /resolved|please confirm/.test(message))
    )
      return "acknowledgements";
    return "tickets";
  }
  if (/incident report/.test(message))
    return ["it", "super_admin"].includes(role) ? "incident-reports" : "dashboard";
  if (/firewall/.test(message)) return "firewall";
  if (/parking/.test(message))
    return ["admin", "super_admin"].includes(role) ? "parking" : "dashboard";
  if (/kra|checklist/.test(message))
    return role === "super_admin"
      ? "member-checklists"
      : ["it", "admin"].includes(role)
        ? "mychecklist"
        : "dashboard";
  if (kind === "approval" || /approval/.test(message)) return "approvals";
  return "dashboard";
}

/**
 * Navigation rail.
 *
 * Declared at module scope so switching views or receiving a notification poll
 * does not remount the whole nav subtree. `collapsed` only ever comes through
 * as true for the desktop rail — the mobile drawer always renders labels.
 */
/**
 * Lets a member holding several roles act as one of them. Reloads the app so
 * every view, nav item and cached list is rebuilt for the new role.
 */
function RoleSwitcher({ role, roles }) {
  const [switching, setSwitching] = useState(false);
  const switchRole = async (next) => {
    if (next === role) return;
    setSwitching(true);
    try {
      await api("/auth/switch-role", { method: "POST", body: { role: next } });
      window.location.assign("/");
    } catch (error) {
      toast.error(error.message);
      setSwitching(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={switching}
        aria-label="Switch role"
        className="-ml-1 mt-0.5 flex max-w-full items-center gap-1 rounded-md px-1 py-0.5 text-left text-[11.5px] text-[#6b6b76] outline-none transition-colors hover:bg-[#f5f5f2] hover:text-[#17171c] focus-visible:ring-2 focus-visible:ring-[#b3177f]/30 disabled:opacity-60 data-[state=open]:bg-[#f5f5f2] data-[state=open]:text-[#17171c]"
      >
        <span className="truncate">{ROLE_LABEL[role] || role}</span>
        {switching ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-70" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-52">
        <DropdownMenuLabel className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Switch role
        </DropdownMenuLabel>
        {roles.map((option) => {
          const active = option === role;
          return (
            <DropdownMenuItem
              key={option}
              onSelect={() => switchRole(option)}
              className={active ? "font-semibold text-[#b3177f]" : ""}
            >
              <span className="flex-1 truncate">{ROLE_LABEL[option] || option}</span>
              {active && <Check className="h-3.5 w-3.5 text-[#b3177f]" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({
  nav,
  view,
  role,
  user,
  collapsed,
  onNavigate,
  badges = {},
}) {
  const groups = nav.reduce((list, item) => {
    const last = list[list.length - 1];
    if (last && last.title === item.group) last.items.push(item);
    else list.push({ title: item.group, items: [item] });
    return list;
  }, []);
  const userInitials = (user?.name || "")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <TooltipProvider delayDuration={120}>
      <aside
        data-collapsed={collapsed ? "true" : "false"}
        className="dashboard-sidebar flex h-full w-[min(16rem,calc(100vw-2rem))] shrink-0 flex-col overflow-hidden border-r border-[#e8e7e3] bg-white text-[13px] text-[#3b3b44] md:w-full"
      >
        <div
          className={`flex shrink-0 items-center border-b border-[#efeeea] ${collapsed ? "justify-center px-2 py-4" : "gap-2.5 px-[18px] pb-4 pt-[18px]"}`}
        >
          <Image
            src="/brand/ethara-emblem.png"
            alt="Ethara"
            width={30}
            height={30}
            priority
            className="h-[30px] w-[30px] shrink-0 rounded-full object-contain"
          />
          {!collapsed && (
            <span className="dashboard-sidebar-label truncate text-sm font-semibold text-[#17171c]">
              Ethara <span className="text-[#b3177f]">Service Hub</span>
            </span>
          )}
        </div>

        <nav
          aria-label="Primary"
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden py-4 ${collapsed ? "gap-1 px-2" : "gap-[18px] px-2.5"}`}
        >
          {groups.map((group) => (
            <div key={group.title} className="flex flex-col gap-0.5">
              {!collapsed && (
                <div className="px-2.5 pb-1.5 text-[10.5px] uppercase tracking-[.08em] text-[#9a9aa3]">
                  {group.title}
                </div>
              )}
              {group.items.map((n) => {
                const Icon = n.icon;
                const active = view === n.k;
                const badge = badges[n.k] > 0 ? badges[n.k] : null;
                const item = (
                  <button
                    onClick={() => onNavigate(n.k)}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? n.label : undefined}
                    className={`dashboard-nav-item flex w-full items-center rounded-lg text-left ${collapsed ? "justify-center px-0 py-2.5" : "justify-between gap-2 px-2.5 py-2"} ${
                      active
                        ? "dashboard-nav-item-active bg-[#fbe9f4] font-semibold text-[#8a0f61]"
                        : "text-[#3b3b44] hover:bg-[#f5f5f2]"
                    }`}
                  >
                    {collapsed ? (
                      <Icon className="h-4 w-4 shrink-0" />
                    ) : (
                      <>
                        <span className="dashboard-sidebar-label truncate">
                          {n.label}
                        </span>
                        {badge && (
                          <span className={`text-[11px] tabular-nums ${active ? "" : "text-[#6b6b76]"}`}>
                            {badge}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                );
                if (!collapsed) return <div key={n.k}>{item}</div>;
                return (
                  <Tooltip key={n.k}>
                    <TooltipTrigger asChild>{item}</TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">
                      {n.label}
                      {badge ? ` · ${badge}` : ""}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </nav>

        <div
          className={`flex shrink-0 items-center border-t border-[#efeeea] ${collapsed ? "justify-center p-2" : "gap-2.5 px-4 py-3.5"}`}
        >
          {!collapsed && (
            <>
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-[#17171c] text-[11px] font-semibold text-white">
                {userInitials}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate font-semibold text-[#17171c]">
                  {user?.name}
                </span>
                {user?.roles?.length > 1 ? (
                  <RoleSwitcher role={role} roles={user.roles} />
                ) : (
                  <span className="truncate text-[11.5px] text-[#6b6b76]">
                    {ROLE_LABEL[role]}
                  </span>
                )}
              </span>
            </>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState("dashboard");
  const [refresh, setRefresh] = useState(0);
  const [openTicketId, setOpenTicketId] = useState(null);
  const [users, setUsers] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [notifs, setNotifs] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarCollapsed = false;
  // Gates the width transition so restoring a collapsed rail on load does not
  // animate from the expanded width on first paint.
  const [shellReady, setShellReady] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const notificationIdsRef = useRef(new Set());
  const notificationsReadyRef = useRef(false);
  const userInteractedRef = useRef(false);
  const soundEnabledRef = useRef(false);
  const pendingNotificationSoundRef = useRef(false);

  const doRefresh = useCallback(() => setRefresh((n) => n + 1), []);

  // Enable the width transition after first paint.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShellReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

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
    const enabled =
      window.localStorage.getItem("ticketflow-notification-sound") !== "false";
    setSoundEnabled(enabled);
    soundEnabledRef.current = enabled;
  }, []);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const playNotificationSound = useCallback(() => {
    const browserActivated =
      userInteractedRef.current ||
      Boolean(window.navigator.userActivation?.hasBeenActive);
    if (!soundEnabledRef.current || !browserActivated) return false;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
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
      return true;
    } catch {
      // Sound is an enhancement; browser audio restrictions must not affect alerts.
      return false;
    }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const markInteraction = () => {
      userInteractedRef.current = true;
      if (pendingNotificationSoundRef.current) {
        pendingNotificationSoundRef.current = !playNotificationSound();
      }
    };
    window.addEventListener("pointerdown", markInteraction, { once: true });
    window.addEventListener("keydown", markInteraction, { once: true });
    return () => {
      window.removeEventListener("pointerdown", markInteraction);
      window.removeEventListener("keydown", markInteraction);
    };
  }, [user, playNotificationSound]);

  const markNotificationRead = useCallback(async (notification) => {
    if (notification.read) return;
    setNotifs((items) =>
      items.map((item) =>
        item.id === notification.id ? { ...item, read: true } : item,
      ),
    );
    try {
      await api(`/notifications/${notification.id}/read`, { method: "POST" });
    } catch (error) {
      setNotifs((items) =>
        items.map((item) =>
          item.id === notification.id ? { ...item, read: false } : item,
        ),
      );
      toast.error(error.message);
    }
  }, []);

  const openNotification = useCallback(
    (notification) => {
      void markNotificationRead(notification);
      navigateView(notificationTargetView(notification, user?.role));
      if (notification.ticket_id) setOpenTicketId(notification.ticket_id);
      setNotificationsOpen(false);
    },
    [markNotificationRead, navigateView, user?.role],
  );

  const loadNotifications = useCallback(
    async ({ announceNew = true } = {}) => {
      try {
        const items = await api("/notifications");
        const firstLoad = !notificationsReadyRef.current;
        const unreadItems = items.filter((item) => !item.read);
        const newlyArrived = !firstLoad
          ? items.filter(
              (item) =>
                !item.read && !notificationIdsRef.current.has(item.id),
            )
          : [];
        notificationIdsRef.current = new Set(items.map((item) => item.id));
        notificationsReadyRef.current = true;
        setNotifs(items);
        if (firstLoad && unreadItems.length) {
          pendingNotificationSoundRef.current = !playNotificationSound();
        }
        if (announceNew && newlyArrived.length) {
          pendingNotificationSoundRef.current = !playNotificationSound();
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
              action: {
                label: "View",
                onClick: () => openNotification(latest),
              },
            },
          );
        }
      } catch {
        // Background polling stays quiet; foreground API errors remain actionable.
      }
    },
    [openNotification, playNotificationSound],
  );

  const loadMeta = useCallback(async () => {
    if (!user) return;
    // Saved SLA rules (Settings → SLA & hours) so browser-side SLA maths
    // matches the server's.
    api("/settings/sla")
      .then((config) => configureSla(config))
      .catch(() => {});
    try {
      setUsers(await api("/users"));
    } catch (e) {}
  }, [user]);
  useEffect(() => {
    loadMeta();
  }, [loadMeta, refresh]);

  // Pending count for the super admin's Approval inbox nav item.
  useEffect(() => {
    if (user?.role !== "super_admin") return;
    api("/approvals")
      .then((rows) =>
        setPendingApprovals(
          rows.filter((row) =>
            ["Pending", "On Hold", "Clarification"].includes(row.status),
          ).length,
        ),
      )
      .catch(() => {});
  }, [user, refresh]);

  useEffect(() => {
    notificationIdsRef.current = new Set();
    notificationsReadyRef.current = false;
    pendingNotificationSoundRef.current = false;
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
  const toggleNotificationSound = () => {
    userInteractedRef.current = true;
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundEnabledRef.current = next;
    window.localStorage.setItem(
      "ticketflow-notification-sound",
      String(next),
    );
    pendingNotificationSoundRef.current = false;
    if (next) window.setTimeout(playNotificationSound, 0);
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

  // Members (not team heads) see their personal dashboard as "My dashboard".
  const nav = (NAV[user.role] || NAV.employee).map((item) =>
    item.k === "dashboard" && ["it", "admin"].includes(user.role)
      ? { ...item, label: user.is_team_head ? "Team dashboard" : "My dashboard" }
      : item,
  );
  const unread = notifs.filter((n) => !n.read).length;
  // Screens redesigned with their own page heading don't repeat it in the bar.
  const ownHeading =
    view === "firewall" ||
    view === "vendor-analysis" ||
    view === "incident-reports" ||
    (view === "mychecklist" && ["it", "admin"].includes(user.role)) ||
    (view === "dashboard" && ["it", "admin"].includes(user.role)) ||
    (view === "tickets" && ["it", "admin"].includes(user.role)) ||
    view === "approvals" ||
    (user.role === "super_admin" &&
      ["dashboard", "tickets", "approvals", "member-checklists", "settings", "audit"].includes(view));
  const navBadges =
    user.role === "super_admin" ? { approvals: pendingApprovals } : {};
  const titleMap = {
    dashboard: "Dashboard",
    tickets: nav.find((n) => n.k === "tickets")?.label,
    acknowledgements: "Resolution Acknowledgements",
    approvals: "Approvals",
    mychecklist: "My Checklist / Daily Tasks",
    "member-checklists": "Team & Checklists",
    "vendor-analysis": "Laptop Vendor Analysis",
    "incident-reports": "Incident Reports",
    parking: "Tulip Parking",
    settings: "Member Settings",
    firewall: "Firewall Utilization",
    audit: "Audit Logs",
  };

  return (
    <div
      className="dashboard-shell min-h-screen flex bg-[#f5f5f2]"
      data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
      data-shell-ready={shellReady ? "true" : "false"}
    >
      <div className="dashboard-sidebar-slot fixed inset-y-0 left-0 z-40 hidden h-screen md:flex">
        <Sidebar
          nav={nav}
          view={view}
          role={user.role}
          user={user}
          collapsed={sidebarCollapsed}
          onNavigate={(k) => navigateView(k)}
          badges={navBadges}
        />
      </div>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="dashboard-mobile-backdrop absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="dashboard-mobile-sidebar relative z-50 flex h-full">
            <Sidebar
              nav={nav}
              view={view}
              role={user.role}
              user={user}
              collapsed={false}
              onNavigate={(k) => {
                navigateView(k);
                setSidebarOpen(false);
              }}
                  badges={navBadges}
            />
          </div>
        </div>
      )}

      <div className="dashboard-main min-w-0 flex-1 flex-col flex">
        <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-2 border-b border-[#e8e7e3] bg-[#f5f5f2]/90 px-2 py-2 backdrop-blur-xl sm:px-4 md:px-7">
          <div className="flex min-w-0 items-center gap-1 sm:gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </Button>
            {!ownHeading && (
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold tracking-[-.01em] text-[#17171c] sm:text-lg">
                  {titleMap[view] || "Dashboard"}
                </h1>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <ThemeToggle />
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
            <Button variant="ghost" size="icon" onClick={logout} aria-label="Sign out" title="Sign out">
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
                onViewIncidents={() => navigateView("incident-reports")}
                onOpenTicket={setOpenTicketId}
              />
            ) : ["it", "admin"].includes(user.role) && !user.is_team_head ? (
              <MemberDashboard
                user={user}
                onGoTickets={() => navigateView("tickets")}
                onGoKra={() => navigateView("mychecklist")}
                onGoApprovals={() => navigateView("approvals")}
                onOpenTicket={setOpenTicketId}
              />
            ) : ["it", "admin"].includes(user.role) ? (
              <HeadDashboard
                user={user}
                onGoTickets={() => navigateView("tickets")}
                onGoApprovals={() => navigateView("approvals")}
                onOpenTicket={setOpenTicketId}
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
              <SuperAdminTickets user={user} onOpenTicket={setOpenTicketId} />
            ) : ["it", "admin"].includes(user.role) ? (
              <TicketBoard
                user={user}
                onOpenTicket={setOpenTicketId}
                onGoApprovals={() => navigateView("approvals")}
              />
            ) : (
              <TicketsView
                user={user}
                onOpenTicket={setOpenTicketId}
                refresh={refresh}
                onRefresh={doRefresh}
              />
            ))}
          {view === "approvals" && (
            <ApprovalsView
              user={user}
              onOpenTicket={setOpenTicketId}
              onChanged={doRefresh}
            />
          )}
          {view === "mychecklist" &&
            (["it", "admin"].includes(user.role) ? (
              <AgentKra user={user} />
            ) : (
              <MyChecklist />
            ))}
          {view === "member-checklists" && <SuperAdminMemberKra />}
          {view === "vendor-analysis" &&
            ["it", "admin", "super_admin"].includes(user.role) && (
              <VendorAnalysis user={user} onOpenTicket={setOpenTicketId} />
            )}
          {view === "incident-reports" &&
            ["it", "super_admin"].includes(user.role) && (
              <IncidentReportsView user={user} />
            )}
          {view === "parking" && <ParkingView />}
          {view === "settings" && <SettingsView />}
          {view === "firewall" && <FirewallView user={user} />}
          {view === "audit" && <AuditView onOpenTicket={setOpenTicketId} />}
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

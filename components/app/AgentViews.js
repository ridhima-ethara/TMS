"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  PRIORITIES,
  PRIORITY_META,
  fmtDate,
  slaRemaining,
  statusClass,
} from "@/lib/appapi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Check,
  Clock3,
  Download,
  GripVertical,
  Inbox,
  Plus,
  Search,
  ChevronDown,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { RaiseTicket } from "@/components/app/TicketsView";
import TeamPerformance from "@/components/app/TeamPerformance";
import CategoryManager from "@/components/app/CategoryManager";

const DONE = ["Resolved", "Closed", "Cancelled"];
const roleMeta = (user) =>
  user.role === "it"
    ? { department: "IT", team: "IT team", accent: "#2E7CD6", soft: "#E8F1FB" }
    : {
        department: "Admin",
        team: "Admin team",
        accent: "#1B7F6E",
        soft: "#E4F5EE",
      };
const dayKey = (date) => new Date(date).toISOString().slice(0, 10);
const age = (created) => {
  const days = Math.floor((Date.now() - new Date(created)) / 86400000);
  return days > 0 ? `${days}d` : "<1d";
};

function AgentKpis({ tickets, stats }) {
  const active = tickets.filter((ticket) => !DONE.includes(ticket.status));
  const overdue = active.filter(
    (ticket) =>
      ticket.sla_resolution_due &&
      new Date(ticket.sla_resolution_due) < new Date(),
  );
  const oldest = overdue.sort(
    (a, b) => new Date(a.sla_resolution_due) - new Date(b.sla_resolution_due),
  )[0];
  const oldestText = oldest
    ? slaRemaining(oldest.sla_resolution_due).text.replace("Overdue ", "")
    : "—";
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {[
        [
          "Assigned to me",
          active.length,
          `${tickets.length - active.length} closed`,
          "",
        ],
        // Tickets now start in Open rather than In Progress, so without this
        // tile freshly raised or newly claimed work appears in no count.
        [
          "Open",
          active.filter((ticket) => ticket.status === "Open").length,
          "not started yet",
          "text-[#6C5CE7]",
        ],
        [
          "Overdue",
          overdue.length,
          `oldest ${oldestText}`,
          "text-[#DC3D3D] border-l-[3px] border-l-[#DC3D3D] rounded-l-none",
        ],
        [
          "In progress",
          active.filter((ticket) => ticket.status === "In Progress").length,
          "work started",
          "text-[#2E7CD6]",
        ],
        [
          "Response SLA",
          `${stats.response_sla_compliance}%`,
          "target 80%",
          stats.response_sla_compliance >= 80 ? "text-[#1E9E6A]" : "text-[#DC3D3D]",
        ],
        [
          "Resolution SLA",
          `${stats.sla_compliance}%`,
          "target 80%",
          stats.sla_compliance >= 80 ? "text-[#1E9E6A]" : "text-[#DC3D3D]",
        ],
        [
          "Avg resolution",
          `${stats.avg_resolution_hours}h`,
          "vs team average",
          "",
        ],
      ].map(([label, value, detail, tone]) => (
        <Card
          key={label}
          className={`border-[#E5E9EF] p-4 shadow-none ${tone.includes("border-l") ? tone : ""}`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {label}
          </p>
          <p
            className={`mt-1 text-2xl font-bold tabular-nums ${tone.includes("border-l") ? "text-[#DC3D3D]" : tone}`}
          >
            {value}
          </p>
          <p className="mt-1 text-xs text-[#9CA3AF]">{detail}</p>
        </Card>
      ))}
    </div>
  );
}

function MiniKra({ lists, onGoKra }) {
  const list = lists[0];
  if (!list)
    return (
      <Card className="border-[#E5E9EF] p-5 shadow-none">
        <p className="text-sm text-[#9CA3AF]">
          No KRA assigned or added yet.
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onGoKra}>
          <Plus className="mr-1 h-4 w-4" />
          Add my daily KRA
        </Button>
      </Card>
    );
  const submission = list.today_submission;
  const displayStatus = list.today_status || submission?.status || "Not submitted";
  const issue = list.overdue || ["Late", "Issue"].includes(displayStatus);
  const responses = submission?.responses || [];
  const done = responses.filter((response) => response.done).length;
  return (
    <Card className="border-[#E5E9EF] p-5 shadow-none">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold">My KRA — today</h3>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${issue ? "bg-[#FDECEC] text-[#A32D2D]" : submission ? (submission.status === "Completed" ? "bg-[#E4F5EE] text-[#0E6B47]" : "bg-[#FDF3E0] text-[#8A5A06]") : "bg-[#FDECEC] text-[#A32D2D]"}`}
        >
          {displayStatus}
        </span>
        <span className="ml-auto text-xs text-[#4B5563]">
          ⏱ cut-off 7:00 PM
        </span>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#EDF0F4]">
          <div
            className="h-full bg-[#1E9E6A]"
            style={{
              width: `${list.items.length ? (done / list.items.length) * 100 : 0}%`,
            }}
          />
        </div>
        <span className="text-xs font-semibold">
          {done}/{list.items.length} done
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {list.items.map((item) => {
          const complete = responses.find(
            (response) => response.item === item.label,
          )?.done;
          return (
            <span
              key={item.key}
              className={`rounded-full px-3 py-1 text-xs ${complete ? "bg-[#E4F5EE] text-[#0E6B47]" : "bg-[#EDF0F4] text-[#4B5563]"}`}
            >
              {complete ? "✓" : "○"} {item.label}
            </span>
          );
        })}
      </div>
      <Button
        className="mt-4 bg-[#131C26] hover:bg-[#1C2836]"
        size="sm"
        onClick={onGoKra}
      >
        Continue in My KRA →
      </Button>
    </Card>
  );
}

function QueueCategories({ tickets, accent }) {
  const active = tickets.filter((ticket) => !DONE.includes(ticket.status));
  const groups = Object.entries(
    active.reduce((map, ticket) => {
      map[ticket.category || "Other"] = (
        map[ticket.category || "Other"] || []
      ).concat(ticket);
      return map;
    }, {}),
  )
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);
  const max = Math.max(...groups.map(([, rows]) => rows.length), 1);
  return (
    <Card className="border-[#E5E9EF] p-5 shadow-none">
      <h3 className="mb-4 font-bold">
        My queue by category{" "}
        <span className="text-xs font-medium text-[#DC3D3D]">
          · red = overdue
        </span>
      </h3>
      <div className="space-y-3">
        {groups.map(([category, rows]) => {
          const overdue = rows.filter(
            (ticket) => new Date(ticket.sla_resolution_due) < new Date(),
          ).length;
          return (
            <div
              key={category}
              className="grid grid-cols-[84px_1fr_18px] items-center gap-2 text-xs sm:grid-cols-[110px_1fr_18px] sm:gap-3"
            >
              <span className="truncate text-[#4B5563]">{category}</span>
              <div className="flex h-2 overflow-hidden rounded-full bg-[#EDF0F4]">
                <span
                  style={{
                    width: `${((rows.length - overdue) / max) * 100}%`,
                    background: accent,
                  }}
                />
                <span
                  className="bg-[#DC3D3D]"
                  style={{ width: `${(overdue / max) * 100}%` }}
                />
              </div>
              <b>{rows.length}</b>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AgentWeek({ tickets, accent, soft }) {
  const [calendarView, setCalendarView] = useState("month");
  const [selectedDay, setSelectedDay] = useState(null);
  const now = new Date();
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - now.getDay() + index);
    return date;
  });
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const gridEnd = new Date(monthEnd);
  gridEnd.setDate(monthEnd.getDate() + (6 - monthEnd.getDay()));
  const monthDays = [];
  for (
    let date = new Date(gridStart);
    date <= gridEnd;
    date.setDate(date.getDate() + 1)
  )
    monthDays.push(new Date(date));
  const days = calendarView === "week" ? weekDays : monthDays;
  return (
    <Card className="border-[#E5E9EF] p-5 shadow-none">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h3 className="font-bold">
            {calendarView === "week"
              ? "This week"
              : now.toLocaleDateString("en-GB", {
                  month: "long",
                  year: "numeric",
                })}
          </h3>
          <p className="text-xs text-[#9CA3AF]">Ticket SLA due dates</p>
        </div>
        <div className="ml-auto flex rounded-lg bg-[#EDF0F4] p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setCalendarView("month")}
            className={`rounded-md px-4 py-2 transition ${calendarView === "month" ? "bg-white text-[#111827] shadow-sm" : "text-[#4B5563]"}`}
          >
            Month
          </button>
          <button
            type="button"
            onClick={() => setCalendarView("week")}
            className={`rounded-md px-4 py-2 transition ${calendarView === "week" ? "bg-white text-[#111827] shadow-sm" : "text-[#4B5563]"}`}
          >
            Week
          </button>
        </div>
      </div>
      <div className={calendarView === "month" ? "overflow-x-auto pb-2" : ""}>
      {calendarView === "month" && (
        <div className="mb-2 grid min-w-[680px] grid-cols-7 gap-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
            <span
              key={label}
              className="px-2 text-[10px] font-semibold uppercase text-[#9CA3AF]"
            >
              {label}
            </span>
          ))}
        </div>
      )}
      <div
        className={`grid gap-2 ${calendarView === "month" ? "min-w-[680px] grid-cols-7" : "grid-cols-1 sm:grid-cols-4 xl:grid-cols-7"}`}
      >
        {days.map((date) => {
          const today = dayKey(date) === dayKey(now);
          const inMonth = date.getMonth() === now.getMonth();
          const due = tickets.filter(
            (ticket) =>
              !DONE.includes(ticket.status) &&
              ticket.sla_resolution_due &&
              dayKey(ticket.sla_resolution_due) === dayKey(date),
          );
          const overdue = due.filter(
            (ticket) => new Date(ticket.sla_resolution_due) < now,
          ).length;
          return (
            <button
              type="button"
              key={date.toISOString()}
              disabled={!due.length}
              onClick={() =>
                due.length && setSelectedDay({ date, tickets: due })
              }
              className={`rounded-xl border p-3 text-left transition-all ${calendarView === "month" ? "min-h-24" : "min-h-20"} ${!inMonth && calendarView === "month" ? "bg-[#FAFBFC] opacity-50" : ""} ${due.length ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2" : "cursor-default"}`}
              style={
                today
                  ? { border: `2px solid ${accent}`, background: soft }
                  : { borderColor: "#E5E9EF" }
              }
            >
              <p className="text-[11px] font-semibold uppercase text-[#9CA3AF]">
                {calendarView === "week"
                  ? date.toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "numeric",
                    })
                  : date.getDate()}
                {today ? " · today" : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {overdue > 0 && (
                  <span className="rounded-full bg-red-100 px-2 py-1 text-[10px] text-red-800">
                    {overdue} overdue
                  </span>
                )}
                {due.length - overdue > 0 && (
                  <span
                    className="rounded-full px-2 py-1 text-[10px]"
                    style={{ background: soft, color: accent }}
                  >
                    {due.length - overdue} due
                  </span>
                )}
                {!due.length && (
                  <span className="text-xs text-[#9CA3AF]">—</span>
                )}
              </div>
              {due.length > 0 && (
                <p
                  className="mt-2 text-[10px] font-semibold"
                  style={{ color: accent }}
                >
                  View tickets →
                </p>
              )}
            </button>
          );
        })}
      </div>
      </div>
      <Dialog
        open={!!selectedDay}
        onOpenChange={(open) => !open && setSelectedDay(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Tickets due{" "}
              {selectedDay?.date.toLocaleDateString("en-GB", {
                weekday: "long",
                day: "2-digit",
                month: "long",
              })}
            </DialogTitle>
            <p className="text-sm text-[#9CA3AF]">
              {selectedDay?.tickets.length || 0} active team ticket
              {selectedDay?.tickets.length === 1 ? "" : "s"}
            </p>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {selectedDay?.tickets.map((ticket) => {
              const sla = slaRemaining(ticket.sla_resolution_due);
              return (
                <Card
                  key={ticket.id}
                  className="border-[#E5E9EF] p-4 shadow-none"
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-[#9CA3AF]">
                          {ticket.human_id}
                        </span>
                        <Badge
                          className={PRIORITY_META[ticket.priority]?.badge}
                        >
                          {ticket.priority}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={statusClass(ticket.status)}
                        >
                          {ticket.status}
                        </Badge>
                      </div>
                      <p className="mt-2 font-semibold">{ticket.title}</p>
                      <p className="mt-1 text-xs text-[#9CA3AF]">
                        {ticket.category} · Raised by{" "}
                        {ticket.raised_by_name || "—"} ·{" "}
                        {ticket.location || "Location not set"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-xs font-semibold ${sla.breach ? "text-red-700" : "text-green-700"}`}
                      >
                        {sla.text}
                      </p>
                      <p className="mt-1 text-xs text-[#9CA3AF]">
                        {ticket.assignee_name
                          ? `Assigned to ${ticket.assignee_name}`
                          : "Awaiting team claim"}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function AgentDashboard({ user, onGoTickets, onGoKra }) {
  const meta = roleMeta(user);
  const [data, setData] = useState(null);
  useEffect(() => {
    const load = () =>
      Promise.all([
        api("/dashboard"),
        api(`/tickets?assignee_id=${user.id}&limit=1000`),
        api("/tickets?limit=1000"),
        api("/member-checklists"),
        // Team heads see their own department's member performance; the
        // endpoint scopes to their department and refuses other roles.
        user.is_team_head
          ? api("/reports/member-sla").catch(() => null)
          : Promise.resolve(null),
      ])
        .then(([stats, queue, teamQueue, lists, memberSla]) =>
          setData({
            stats,
            tickets: queue.items,
            teamTickets: teamQueue.items,
            lists,
            memberSla,
          }),
        )
        .catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [user.id, user.is_team_head]);
  if (!data)
    return <div className="h-96 animate-pulse rounded-xl bg-[#EDF0F4]" />;
  const overdue = data.tickets
    .filter(
      (ticket) =>
        !DONE.includes(ticket.status) &&
        new Date(ticket.sla_resolution_due) < new Date(),
    )
    .sort(
      (a, b) => new Date(a.sla_resolution_due) - new Date(b.sla_resolution_due),
    );
  return (
    <div className="space-y-4 text-[#111827]">
      <div>
        <h2 className="text-xl font-bold">
          Good{" "}
          {new Date().getHours() < 12
            ? "morning"
            : new Date().getHours() < 17
              ? "afternoon"
              : "evening"}
          , {user.name.split(" ")[0]}
        </h2>
        <p className="text-sm text-[#9CA3AF]">
          {new Date().toLocaleDateString("en-GB", {
            weekday: "long",
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}{" "}
          · {meta.team}
        </p>
      </div>
      {overdue.length > 0 && (
        <div className="flex flex-wrap items-center gap-5 rounded-xl border border-[#F5C9C9] bg-[#FDECEC] px-5 py-3 text-sm text-[#A32D2D]">
          <b className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {overdue.length} tickets overdue — SLA met is{" "}
            {data.stats.sla_compliance}%
          </b>
          {overdue.slice(0, 3).map((ticket) => (
            <span key={ticket.id}>
              {ticket.human_id} ·{" "}
              {slaRemaining(ticket.sla_resolution_due).text.replace(
                "Overdue ",
                "",
              )}
            </span>
          ))}
          <button
            className="ml-auto font-semibold underline"
            onClick={onGoTickets}
          >
            Work overdue queue →
          </button>
        </div>
      )}
      <AgentKpis tickets={data.tickets} stats={data.stats} />
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <MiniKra lists={data.lists} onGoKra={onGoKra} />
        <QueueCategories tickets={data.tickets} accent={meta.accent} />
      </div>
      <AgentWeek
        tickets={data.teamTickets}
        accent={meta.accent}
        soft={meta.soft}
      />
      {user.is_team_head && data.memberSla?.members?.length > 0 && (
        <TeamPerformance
          department={meta.department}
          members={data.memberSla.members}
          tickets={data.teamTickets}
          title="Team performance"
        />
      )}
      {user.is_team_head && (
        <CategoryManager departments={[meta.department]} />
      )}
    </div>
  );
}

function RaiseAgentTicket({ user, onCreated }) {
  const meta = roleMeta(user);
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({
    title: "",
    category: "",
    priority: "Medium",
    description: "",
    asset_serial_number: "",
  });
  const [assetMatch, setAssetMatch] = useState(null);
  useEffect(() => {
    if (open)
      api(`/categories?department=${meta.department}`)
        .then((rows) => setCategories(rows.map((row) => row.name)))
        .catch(() => {});
  }, [open, meta.department]);
  // Resolve an entered laptop serial to its inventory record so the vendor
  // mapping is confirmed before the ticket is raised.
  useEffect(() => {
    const query = form.asset_serial_number.trim();
    if (!query) {
      setAssetMatch(null);
      return undefined;
    }
    const timer = setTimeout(() => {
      api(`/assets/laptops?query=${encodeURIComponent(query)}`)
        .then((result) => setAssetMatch(result.items?.[0] || null))
        .catch(() => setAssetMatch(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [form.asset_serial_number]);
  const submit = async () => {
    if (!form.title) return toast.error("Title is required");
    try {
      await api("/tickets", {
        method: "POST",
        body: { ...form, department: meta.department },
      });
      toast.success("Ticket raised");
      setOpen(false);
      onCreated();
    } catch (error) {
      toast.error(error.message);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#131C26] hover:bg-[#1C2836]" size="sm">
          <Plus className="h-4 w-4" />
          Raise ticket
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Raise {meta.department} ticket</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input
              className="mt-1"
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(value) => setForm({ ...form, category: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select
                value={form.priority}
                onValueChange={(value) => setForm({ ...form, priority: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {priority}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              className="mt-1"
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </div>
          <div>
            <Label>Laptop serial number (optional)</Label>
            <Input
              className="mt-1 font-mono uppercase"
              value={form.asset_serial_number}
              onChange={(event) =>
                setForm({ ...form, asset_serial_number: event.target.value })
              }
              placeholder="Maps the ticket to the issued laptop and vendor"
            />
            {assetMatch && (
              <p className="mt-1 text-xs text-emerald-700">
                💻 {assetMatch.brand} · {assetMatch.name || "Unassigned"}
                {assetMatch.employee_code && ` (${assetMatch.employee_code})`} ·
                Vendor {assetMatch.vendor}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const exportTickets = (rows) => {
  const csv = [
    ["ID", "Title", "Category", "Priority", "Status", "SLA"],
    ...rows.map((ticket) => [
      ticket.human_id,
      ticket.title,
      ticket.category,
      ticket.priority,
      ticket.status,
      slaRemaining(ticket.sla_resolution_due).text,
    ]),
  ]
    .map((row) =>
      row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "agent-tickets.csv";
  link.click();
  URL.revokeObjectURL(link.href);
};

function TicketActionMenu({ ticket, done, user, onOpenTicket, onUpdated }) {
  if (done)
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOpenTicket(ticket.id)}
      >
        View
      </Button>
    );
  const update = async (payload, message, updateOptions = {}) => {
    try {
      await api(`/tickets/${ticket.id}`, { method: "PATCH", body: payload });
      toast.success(message);
      onUpdated(updateOptions);
    } catch (error) {
      toast.error(error.message);
    }
  };
  const actionLabel =
    !ticket.assignee_id
      ? "Claim ticket"
      : ticket.assignee_id !== user.id && !user.is_team_head
        ? "View"
        : ticket.status === "In Progress"
          ? "In progress"
          : "Resolve";
  const canWorkTicket =
    !ticket.assignee_id ||
    ticket.assignee_id === user.id ||
    user.is_team_head;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {actionLabel} ▾
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Ticket actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onOpenTicket(ticket.id)}>
          View details
        </DropdownMenuItem>
        {canWorkTicket && (
          <>
            <DropdownMenuItem
              disabled={!!ticket.assignee_id}
              onSelect={() =>
                update(
                  { assignee_id: user.id },
                  `${ticket.human_id} claimed — in progress`,
                )
              }
            >
              Claim for myself
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!ticket.assignee_id || ticket.status === "In Progress"}
              onSelect={() =>
                update(
                  { status: "In Progress" },
                  `${ticket.human_id} moved to In Progress`,
                )
              }
            >
              Start progress
            </DropdownMenuItem>
            {!!ticket.assignee_id &&
              (ticket.assignee_id === user.id || user.is_team_head) && (
                <DropdownMenuItem
                  className="text-amber-700 focus:text-amber-800"
                  onSelect={() =>
                    update(
                      { assignee_id: null },
                      `${ticket.human_id} returned to the pending team queue`,
                      { returnedToTeam: true },
                    )
                  }
                >
                  Unassign to team queue
                </DropdownMenuItem>
              )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!ticket.assignee_id}
              className="text-green-700 focus:text-green-800"
              onSelect={() =>
                update(
                  {
                    resolution: {
                      summary: "Resolved from agent queue",
                      action_taken: "Issue completed by assigned agent",
                      root_cause: "",
                    },
                  },
                  `${ticket.human_id} resolved`,
                )
              }
            >
              Mark resolved
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AgentTickets({ user, onOpenTicket }) {
  const meta = roleMeta(user);
  const [scope, setScope] = useState("mine");
  const [tickets, setTickets] = useState([]);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("all");
  const [category, setCategory] = useState("all");
  const [quick, setQuick] = useState("all");
  const [loading, setLoading] = useState(true);
  const [draggedTicketId, setDraggedTicketId] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);
  const [movingTicketId, setMovingTicketId] = useState(null);
  const dragClickGuardRef = useRef(null);
  const load = () => {
    setLoading(true);
    api(
      `/tickets?${scope === "mine" ? `assignee_id=${user.id}&` : ""}limit=1000`,
    )
      .then((result) => setTickets(result.items))
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [scope, user.id]);
  const categoryOptions = [
    ...new Set(tickets.map((ticket) => ticket.category).filter(Boolean)),
  ].sort();
  const unallocatedCount = tickets.filter(
    (ticket) => !ticket.assignee_id && !DONE.includes(ticket.status),
  ).length;
  const handleTicketUpdated = ({ returnedToTeam = false } = {}) => {
    if (returnedToTeam) {
      setQuick("all");
      if (scope !== "team") {
        setScope("team");
        return;
      }
    }
    load();
  };
  const filtered = tickets
    .filter(
      (ticket) =>
        (!search ||
          `${ticket.human_id} ${ticket.title} ${ticket.issue_user_name || ticket.raised_for_name || ""} ${ticket.issue_user_email || ""} ${ticket.issue_user_employee_code || ""}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (priority === "all" || ticket.priority === priority) &&
        (category === "all" || ticket.category === category) &&
        (quick === "all" ||
          (quick === "overdue" &&
            !DONE.includes(ticket.status) &&
            new Date(ticket.sla_resolution_due) < new Date()) ||
          (quick === "progress" && ticket.status === "In Progress") ||
          (quick === "resolved" && DONE.includes(ticket.status))),
    )
    .sort(
      (a, b) =>
        Number(
          !DONE.includes(a.status) &&
            new Date(a.sla_resolution_due) < new Date(),
        ) -
        Number(
          !DONE.includes(b.status) &&
            new Date(b.sla_resolution_due) < new Date(),
        ),
    )
    .reverse();
  // Unallocated -> Open -> In progress -> Closed. Open means a member has
  // claimed the ticket but has not started; moving it to In progress is what
  // stamps work_started_at, so active time measures real work.
  const kanbanColumns = [
    {
      key: "unallocated",
      label: "Unallocated",
      color: "#6C5CE7",
      soft: "bg-[#F4F2FF]",
      matches: (ticket) =>
        !ticket.assignee_id && !DONE.includes(ticket.status),
    },
    {
      key: "open",
      label: "Open",
      color: "#2E7CD6",
      soft: "bg-[#EAF2FC]",
      matches: (ticket) =>
        Boolean(ticket.assignee_id) &&
        !DONE.includes(ticket.status) &&
        ticket.status === "Open",
    },
    {
      key: "progress",
      label: "In progress",
      color: "#E8930C",
      soft: "bg-[#FFF8EA]",
      matches: (ticket) =>
        Boolean(ticket.assignee_id) &&
        !DONE.includes(ticket.status) &&
        ticket.status !== "Open",
    },
    {
      key: "done",
      label: "Closed",
      color: "#1E9E6A",
      soft: "bg-[#EFFAF5]",
      matches: (ticket) => DONE.includes(ticket.status),
    },
  ];
  const canDragTicket = (ticket) =>
    !DONE.includes(ticket.status) &&
    (!ticket.assignee_id ||
      ticket.assignee_id === user.id ||
      user.is_team_head);
  const movePayload = (ticket, columnKey) => {
    const assigneeId = ticket.assignee_id || user.id;
    if (columnKey === "unallocated") return { assignee_id: null };
    // Claiming a ticket without starting it: assign, stay Open.
    if (columnKey === "open")
      return { assignee_id: assigneeId, status: "Open" };
    if (columnKey === "progress")
      return { assignee_id: assigneeId, status: "In Progress" };
    if (columnKey === "done")
      return {
        assignee_id: assigneeId,
        resolution: {
          summary: "Resolved through the Kanban workflow",
          action_taken: "Ticket moved to the resolved stage by the assigned agent",
          root_cause: "",
        },
      };
    return null;
  };
  const finishDragging = () => {
    setDraggedTicketId(null);
    setDragOverColumn(null);
    window.setTimeout(() => {
      dragClickGuardRef.current = null;
    }, 0);
  };
  const dropTicket = async (event, column) => {
    event.preventDefault();
    const ticketId =
      event.dataTransfer.getData("application/x-ticket-id") ||
      event.dataTransfer.getData("text/plain") ||
      draggedTicketId;
    const ticket = tickets.find((item) => item.id === ticketId);
    finishDragging();
    if (!ticket || movingTicketId) return;
    if (!canDragTicket(ticket)) {
      toast.error("You can only move unallocated tickets or tickets assigned to you");
      return;
    }
    const currentColumn = kanbanColumns.find((item) => item.matches(ticket));
    if (currentColumn?.key === column.key) return;
    const payload = movePayload(ticket, column.key);
    if (!payload) return;
    setMovingTicketId(ticket.id);
    try {
      await api(`/tickets/${ticket.id}`, {
        method: "PATCH",
        body: payload,
      });
      toast.success(`${ticket.human_id} moved to ${column.label}`);
      handleTicketUpdated({ returnedToTeam: column.key === "unallocated" });
    } catch (error) {
      toast.error(error.message);
      load();
    } finally {
      setMovingTicketId(null);
    }
  };
  return (
    <div className="space-y-4 text-[#111827]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex w-full overflow-x-auto rounded-lg bg-[#EDF0F4] p-1 sm:w-auto">
          <button
            onClick={() => setScope("mine")}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${scope === "mine" ? "bg-white shadow-sm" : "text-[#4B5563]"}`}
          >
            My tickets · {scope === "mine" ? tickets.length : "—"}
          </button>
          <button
            onClick={() => setScope("team")}
            className={`rounded-md px-4 py-2 text-sm font-semibold ${scope === "team" ? "bg-white shadow-sm" : "text-[#4B5563]"}`}
          >
            Team tickets · {scope === "team" ? tickets.length : "—"}
          </button>
        </div>
        {scope === "team" && (
          <>
            <span className="rounded-full bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800">
              {unallocatedCount} pending / unallocated
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
              {user.location || meta.team} scope
            </span>
          </>
        )}
        {[
          ["overdue", "Overdue", "bg-red-100 text-red-800"],
          ["progress", "In progress", "bg-blue-100 text-blue-800"],
          ["resolved", "Closed", "bg-green-100 text-green-800"],
        ].map(([value, label, style]) => (
          <button
            key={value}
            onClick={() => setQuick(quick === value ? "all" : value)}
            className={`rounded-full px-3 py-2 text-xs font-semibold ${style} ${quick === value ? "ring-2 ring-offset-1" : ""}`}
          >
            {label}
          </button>
        ))}
        <div className="relative w-full sm:ml-2 sm:w-auto">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#9CA3AF]" />
          <Input
            className="w-full bg-white pl-9 sm:w-56"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search id, title…"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full bg-white sm:ml-auto sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categoryOptions.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-full bg-white sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priority</SelectItem>
            {PRIORITIES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportTickets(filtered)}
        >
          <Download className="h-4 w-4" />
          Export
        </Button>
        <RaiseTicket user={user} onCreated={load} />
      </div>
      <p className="flex items-center gap-1.5 text-xs text-[#7B8495]">
        <GripVertical className="h-3.5 w-3.5" />
        Drag an eligible ticket card between columns to update its workflow
        stage. The action menu remains available for keyboard and mobile use.
      </p>
      <Card className="overflow-hidden border-[#E5E9EF] bg-[#F7F8FA] shadow-none">
        {loading ? (
          <div className="py-20 text-center text-sm text-[#9CA3AF]">
            Loading ticket board…
          </div>
        ) : (
          <div className="overflow-x-auto p-4">
            <div className="flex min-w-max items-start gap-3">
              {kanbanColumns.map((column) => {
                const rows = filtered.filter(column.matches);
                return (
                  <section
                    key={column.key}
                    onDragOver={(event) => {
                      if (!draggedTicketId) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      if (dragOverColumn !== column.key)
                        setDragOverColumn(column.key);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget))
                        setDragOverColumn(null);
                    }}
                    onDrop={(event) => dropTicket(event, column)}
                    className={`w-[300px] shrink-0 rounded-2xl p-1 transition-all ${
                      dragOverColumn === column.key
                        ? "bg-fuchsia-50 ring-2 ring-[#ED00ED]/45"
                        : ""
                    }`}
                  >
                    <div
                      className={`mb-3 flex items-center rounded-xl border border-white px-3 py-3 shadow-sm ${column.soft}`}
                    >
                      <span
                        className="mr-2 h-2.5 w-2.5 rounded-full"
                        style={{ background: column.color }}
                      />
                      <h3 className="text-sm font-bold">{column.label}</h3>
                      <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-semibold shadow-sm">
                        {rows.length}
                      </span>
                    </div>
                    <div className="min-h-44 space-y-3 rounded-xl">
                      {rows.map((ticket) => {
                        const sla = slaRemaining(ticket.sla_resolution_due);
                        const done = DONE.includes(ticket.status);
                        const draggable = canDragTicket(ticket);
                        return (
                          <Card
                            key={ticket.id}
                            draggable={draggable && movingTicketId !== ticket.id}
                            onDragStart={(event) => {
                              if (!draggable) {
                                event.preventDefault();
                                return;
                              }
                              dragClickGuardRef.current = ticket.id;
                              setDraggedTicketId(ticket.id);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData(
                                "application/x-ticket-id",
                                ticket.id,
                              );
                              event.dataTransfer.setData("text/plain", ticket.id);
                            }}
                            onDragEnd={finishDragging}
                            className={`group overflow-hidden border-[#E5E9EF] p-0 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                              draggable
                                ? "cursor-grab active:cursor-grabbing"
                                : "cursor-pointer"
                            } ${
                              draggedTicketId === ticket.id
                                ? "scale-[.98] opacity-40 ring-2 ring-[#ED00ED]/30"
                                : ""
                            } ${
                              movingTicketId === ticket.id
                                ? "pointer-events-none opacity-55"
                                : ""
                            } ${sla.breach && !done ? "border-l-[3px] border-l-[#DC3D3D]" : ""}`}
                            onClick={() => {
                              if (dragClickGuardRef.current === ticket.id) return;
                              onOpenTicket(ticket.id);
                            }}
                            title={
                              draggable
                                ? "Drag to another workflow stage"
                                : done
                                  ? "Completed tickets cannot be moved"
                                  : "Only the assigned member or team head can move this ticket"
                            }
                          >
                            <div
                              className={`flex items-start gap-3 border-b px-4 py-3 ${
                                ticket.assignee_name
                                  ? "border-[#DCE8F5] bg-[#F4F8FC]"
                                  : "border-[#E7E1FA] bg-[#F7F4FF]"
                              }`}
                            >
                              <span
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white shadow-sm"
                                style={{
                                  background: ticket.assignee_name
                                    ? meta.accent
                                    : "#6C5CE7",
                                }}
                              >
                                {ticket.assignee_name
                                  ? ticket.assignee_name
                                      .split(" ")
                                      .map((part) => part[0])
                                      .slice(0, 2)
                                      .join("")
                                  : "U"}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-[9.5px] font-semibold uppercase tracking-wider text-[#8B93A1]">
                                  {ticket.assignee_name
                                    ? "Assigned to"
                                    : "Assignment"}
                                </p>
                                <p className="break-words text-[13px] font-bold leading-5 text-[#1F2937]">
                                  {ticket.assignee_name || "Unallocated"}
                                </p>
                                {!ticket.assignee_name && (
                                  <p className="text-[10.5px] font-medium text-[#6C5CE7]">
                                    Pending team claim
                                  </p>
                                )}
                              </div>
                              {ticket.assignee_id === user.id && (
                                <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[9.5px] font-bold text-[#2E7CD6] shadow-sm">
                                  Mine
                                </span>
                              )}
                              {draggable && (
                                <GripVertical
                                  className="h-4 w-4 shrink-0 text-[#9CA3AF]"
                                  aria-hidden="true"
                                />
                              )}
                            </div>
                            <div className="p-4">
                              <div className="flex items-start gap-2">
                                <span className="font-mono text-[11px] font-semibold text-[#7B8495]">
                                  {ticket.human_id}
                                </span>
                                <Badge
                                  className={`ml-auto ${PRIORITY_META[ticket.priority]?.badge}`}
                                >
                                  {ticket.priority}
                                </Badge>
                              </div>
                              <h4 className="mt-2 line-clamp-2 min-h-10 text-sm font-bold leading-5">
                                {ticket.title}
                              </h4>
                              <div className="mt-2 space-y-1 text-[11.5px] text-[#69738B]">
                                <p className="line-clamp-1">
                                  <span className="font-semibold text-[#4B5563]">Category:</span>{" "}
                                  {ticket.category || "Not specified"}
                                </p>
                                <p className="line-clamp-2">
                                  <span className="font-semibold text-[#4B5563]">Location:</span>{" "}
                                  {ticket.location || "Not specified"}
                                </p>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                <Badge
                                  variant="outline"
                                  className={statusClass(ticket.status)}
                                >
                                  {ticket.status}
                                </Badge>
                                {!done && (
                                  <span
                                    className={`rounded-full px-2 py-1 text-[10px] font-semibold ${sla.breach ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}
                                  >
                                    {sla.text}
                                  </span>
                                )}
                              </div>
                              <div className="mt-3 flex items-center gap-2 border-t border-[#EDF0F4] pt-3">
                                <div className="min-w-0 flex-1">
                                  <p className="text-[10.5px] font-semibold text-[#69738B]">
                                    {done ? "Completed" : `Raised ${age(ticket.created_at)} ago`}
                                  </p>
                                </div>
                                <div onClick={(event) => event.stopPropagation()}>
                                  <TicketActionMenu
                                    ticket={ticket}
                                    done={done}
                                    user={user}
                                    onOpenTicket={onOpenTicket}
                                    onUpdated={handleTicketUpdated}
                                  />
                                </div>
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                      {!rows.length && (
                        <div className="rounded-xl border border-dashed border-[#D9DEE5] bg-white/70 px-4 py-8 text-center text-xs text-[#9CA3AF]">
                          No tickets in this stage
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
            {!filtered.length && (
              <div className="py-12 text-center text-[#9CA3AF]">
                <Inbox className="mx-auto mb-2 h-8 w-8" />
                No tickets found
              </div>
            )}
          </div>
        )}
        <p className="border-t px-4 py-3 text-xs text-[#9CA3AF]">
          Showing {filtered.length} of {tickets.length}{" "}
          {scope === "mine" ? "my" : "team"} tickets · grouped by workflow stage
        </p>
      </Card>
    </div>
  );
}

function CompliancePanel({ submissions, assignedAt, overdue }) {
  const dates = Array.from({ length: 30 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - index));
    return dayKey(date);
  });
  const score = (count) => {
    const relevant = dates.slice(-count);
    const records = submissions.filter((submission) =>
      relevant.includes(submission.date),
    );
    return relevant.length
      ? Math.round(
          (records.reduce(
            (sum, item) =>
              sum + (item.status === "Completed" ? 1 : item.status === "Partial" ? 0.5 : 0),
            0,
          ) /
            relevant.length) *
            100,
        )
      : 0;
  };
  const assignedDate = assignedAt ? dayKey(assignedAt) : dayKey(new Date());
  const trackedDays = Math.max(
    1,
    Math.floor((Date.now() - new Date(assignedDate).getTime()) / 86400000) + 1,
  );
  let streak = 0;
  for (let index = dates.length - 2; index >= 0; index--) {
    const record = submissions.find((item) => item.date === dates[index]);
    if (record?.status === "Completed") streak++;
    else break;
  }
  return (
    <Card className="border-[#E5E9EF] p-5 shadow-none">
      <h3 className="font-bold">My compliance</h3>
      <div className="my-4 flex gap-8">
        {[
          ["7-day", `${score(7)}%`],
          ["30-day", trackedDays >= 30 ? `${score(30)}%` : "—"],
          ["Streak", `${streak} days`],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-[11px] font-semibold uppercase text-[#9CA3AF]">
              {label}
            </p>
            <p
              className={`text-xl font-bold ${label === "Streak" ? "text-[#1E9E6A]" : ""}`}
            >
              {value}
            </p>
          </div>
        ))}
      </div>
      <p className="mb-2 text-[11px] font-semibold uppercase text-[#9CA3AF]">
        Last 30 days
      </p>
      <div className="grid grid-cols-10 gap-1">
        {dates.map((date) => {
          const record = submissions.find((item) => item.date === date);
          return (
            <span
              key={date}
              title={`${date}: ${date < assignedDate ? "Before assignment" : record?.status || (date === dayKey(new Date()) ? "Today" : "Missed")}`}
              className={`h-4 w-4 rounded-[4px] ${date === dayKey(new Date()) ? "border-2 border-[#111827] " : ""}${date < assignedDate ? "bg-[#D9DEE5]" : record?.status === "Completed" ? "bg-[#1E9E6A]" : record?.status === "Partial" ? "bg-[#E8930C]" : date === dayKey(new Date()) && overdue ? "bg-[#DC3D3D]" : date >= dayKey(new Date()) ? "bg-[#EDF0F4]" : "bg-[#DC3D3D]"}`}
            />
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-[#9CA3AF]">
        ■ on time · <span className="text-[#E8930C]">■</span> partial/late ·{" "}
        <span className="text-[#DC3D3D]">■</span> missed · ☐ upcoming
      </p>
    </Card>
  );
}

function CreateOwnKraCard({ onCreated }) {
  const [title, setTitle] = useState("My Daily KRA");
  const [items, setItems] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const list = items
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!list.length)
      return toast.error("Add at least one daily work item (one per line)");
    setBusy(true);
    try {
      await api("/member-checklists", {
        method: "POST",
        body: { title, items: list },
      });
      toast.success("Daily KRA created");
      onCreated?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="border-[#E5E9EF] p-5 shadow-none">
      <h3 className="font-bold">Set up my daily KRA</h3>
      <p className="mt-1 text-sm text-[#9CA3AF]">
        No KRA is assigned to you yet. Define the work you do every day — it
        stays constant each day, and you can log additional work on any day
        before submitting.
      </p>
      <Input
        className="mt-3"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title"
      />
      <textarea
        rows={6}
        className="mt-2 w-full rounded-lg border border-[#E5E9EF] p-3 text-sm"
        value={items}
        onChange={(event) => setItems(event.target.value)}
        placeholder={"One daily work item per line, e.g.\nCheck backup job status\nReview firewall alerts\nClear pending tickets"}
      />
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={submit} disabled={busy}>
          <Plus className="mr-1 h-4 w-4" />
          Create daily KRA
        </Button>
      </div>
    </Card>
  );
}

function TodayChecklist({ list, onSubmitted }) {
  const initial = list.items.map((item) => {
    const existing = list.today_submission?.responses?.find(
      (response) => response.item === item.label,
    );
    return {
      item: item.label,
      done: existing?.done || false,
      remark: existing?.remark || "",
    };
  });
  const [rows, setRows] = useState(initial);
  const [newTask, setNewTask] = useState("");
  useEffect(() => {
    const selfAdded = (list.today_submission?.responses || []).filter(
      (response) => response.self_added,
    );
    if (selfAdded.length) setRows([...initial, ...selfAdded]);
  }, [list.id]);
  const done = rows.filter((row) => row.done).length;
  const submit = async () => {
    try {
      await api(`/member-checklists/${list.id}/submit`, {
        method: "POST",
        body: { responses: rows },
      });
      toast.success("Checklist submitted");
      onSubmitted();
    } catch (error) {
      toast.error(error.message);
    }
  };
  return (
    <Card className="border-[#E5E9EF] p-4 shadow-none sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold">
          ☑ {list.title} —{" "}
          {new Date().toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
          })}
        </h3>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${list.overdue ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
          {list.overdue
            ? "Issue · overdue"
            : done === rows.length
            ? "Complete"
            : done
              ? "In progress"
              : "Not started"}
        </span>
        <span className="ml-auto text-sm font-semibold">
          {done}/{rows.length}
        </span>
      </div>
      <div className="my-3 h-2 overflow-hidden rounded-full bg-[#EDF0F4]">
        <div
          className="h-full bg-[#1E9E6A]"
          style={{ width: `${rows.length ? (done / rows.length) * 100 : 0}%` }}
        />
      </div>
      <div>
        <p className="border-b pb-2 text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
          Assigned
        </p>
        {rows.map(
          (row, index) =>
            !row.self_added && (
              <div
                key={row.item}
                className="flex flex-wrap items-center gap-3 border-b border-[#E5E9EF] py-3 last:border-0"
              >
                <Checkbox
                  checked={row.done}
                  onCheckedChange={(checked) =>
                    setRows(
                      rows.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, done: !!checked }
                          : item,
                      ),
                    )
                  }
                />
                <span
                  className={`min-w-0 flex-1 text-sm sm:min-w-52 ${row.done ? "text-[#9CA3AF] line-through" : "font-medium"}`}
                >
                  {row.item}
                </span>
                <Input
                  className="h-8 w-full sm:w-52"
                  placeholder="Remark (optional)"
                  value={row.remark}
                  onChange={(event) =>
                    setRows(
                      rows.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, remark: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </div>
            ),
        )}
      </div>
      <div className="mt-4 rounded-xl border border-dashed border-[#CFC8F8] bg-[#FAF9FF] p-4">
        <div className="mb-2 flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6C5CE7]">
            Added by me today
          </p>
          <span className="rounded-full bg-[#ECE9FF] px-2 py-0.5 text-[10px] font-semibold text-[#6C5CE7]">
            Self-added
          </span>
        </div>
        {rows.map(
          (row, index) =>
            row.self_added && (
              <div
                key={`${row.item}-${index}`}
                className="flex flex-wrap items-center gap-3 border-b border-[#E7E2FF] py-3 last:border-0"
              >
                <Checkbox
                  checked={row.done}
                  onCheckedChange={(checked) =>
                    setRows(
                      rows.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, done: !!checked }
                          : item,
                      ),
                    )
                  }
                />
                <span
                  className={`min-w-0 flex-1 text-sm sm:min-w-52 ${row.done ? "text-[#9CA3AF] line-through" : "font-medium"}`}
                >
                  {row.item}
                </span>
                <Input
                  className="h-8 w-full bg-white sm:w-52"
                  placeholder="Remark (optional)"
                  value={row.remark || ""}
                  onChange={(event) =>
                    setRows(
                      rows.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, remark: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-red-600"
                  onClick={() =>
                    setRows(rows.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ),
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            className="bg-white"
            placeholder="Add a task for today"
            value={newTask}
            onChange={(event) => setNewTask(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && newTask.trim()) {
                event.preventDefault();
                setRows([
                  ...rows,
                  {
                    item: newTask.trim(),
                    done: false,
                    remark: "",
                    self_added: true,
                  },
                ]);
                setNewTask("");
              }
            }}
          />
          <Button
            variant="outline"
            disabled={!newTask.trim()}
            onClick={() => {
              setRows([
                ...rows,
                {
                  item: newTask.trim(),
                  done: false,
                  remark: "",
                  self_added: true,
                },
              ]);
              setNewTask("");
            }}
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
        <span className="w-full text-xs text-[#9CA3AF] sm:w-auto">
          Submit before the 7:00 PM cut-off
        </span>
        <Button
          variant="outline"
          className="w-full sm:ml-auto sm:w-auto"
          onClick={() => toast.success("Draft saved locally")}
        >
          Save draft
        </Button>
        <Button className="w-full bg-[#131C26] hover:bg-[#1C2836] sm:w-auto" onClick={submit}>
          Submit checklist
        </Button>
      </div>
    </Card>
  );
}

export function AgentKra({ user }) {
  const [lists, setLists] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [mode, setMode] = useState("today");
  const [month, setMonth] = useState(dayKey(new Date()).slice(0, 7));
  const [expanded, setExpanded] = useState(null);
  const [visibleCount, setVisibleCount] = useState(8);
  const load = () =>
    Promise.all([
      api("/member-checklists"),
      api("/member-checklist-submissions"),
    ])
      .then(([assigned, history]) => {
        setLists(assigned);
        setSubmissions(history);
      })
      .catch((error) => toast.error(error.message));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="space-y-4 text-[#111827]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-full rounded-lg bg-[#EDF0F4] p-1 sm:w-auto">
          <button
            onClick={() => setMode("today")}
            className={`flex-1 rounded-md px-5 py-2 text-sm font-semibold ${mode === "today" ? "bg-white shadow-sm" : "text-[#4B5563]"}`}
          >
            Today
          </button>
          <button
            onClick={() => setMode("submissions")}
            className={`flex-1 rounded-md px-5 py-2 text-sm font-semibold ${mode === "submissions" ? "bg-white shadow-sm" : "text-[#4B5563]"}`}
          >
            Submissions
          </button>
        </div>
        <span className="ml-auto flex items-center gap-1 text-xs text-[#4B5563]">
          <Clock3 className="h-4 w-4" />
          Cut-off 7:00 PM
        </span>
      </div>
      {mode === "today" ? (
        <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <div className="space-y-4">
            {lists.map((list) => (
              <TodayChecklist key={list.id} list={list} onSubmitted={load} />
            ))}
            {!lists.length && <CreateOwnKraCard onCreated={load} />}
          </div>
          <div className="space-y-4">
            <CompliancePanel
              submissions={submissions}
              overdue={lists.some((list) => list.overdue)}
              assignedAt={
                lists
                  .map((list) => list.created_at)
                  .filter(Boolean)
                  .sort()[0]
              }
            />
            <Card className="border-[#E5E9EF] p-5 shadow-none">
              <h3 className="mb-3 font-bold">Recent submissions</h3>
              {submissions.slice(0, 4).map((submission) => (
                <div
                  key={submission.id}
                  className="flex items-center border-b py-3 last:border-0"
                >
                  <div className="flex-1">
                    <p className="text-sm font-semibold">
                      {new Date(submission.date).toLocaleDateString("en-GB", {
                        weekday: "short",
                        day: "2-digit",
                        month: "short",
                      })}
                    </p>
                    <p className="text-xs text-[#9CA3AF]">
                      {submission.done_count}/{submission.total} tasks
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${submission.status === "Completed" ? "bg-green-100 text-green-800" : submission.status === "Late" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}
                  >
                    {submission.status}
                  </span>
                </div>
              ))}
              {!submissions.length && (
                <div className="py-8 text-center text-sm text-[#9CA3AF]">
                  No submissions yet — your first one appears here
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : (
        <SubmissionHistory
          submissions={submissions}
          month={month}
          setMonth={setMonth}
          expanded={expanded}
          setExpanded={setExpanded}
          visibleCount={visibleCount}
          setVisibleCount={setVisibleCount}
        />
      )}
    </div>
  );
}

function SubmissionHistory({
  submissions,
  month,
  setMonth,
  expanded,
  setExpanded,
  visibleCount,
  setVisibleCount,
}) {
  const rows = submissions
    .filter((item) => item.date?.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date));
  const onTime = rows.filter((item) => item.status === "Completed").length;
  const late = rows.filter((item) => item.status !== "Completed").length;
  const elapsed =
    month === dayKey(new Date()).slice(0, 7)
      ? new Date().getDate()
      : new Date(
          Number(month.slice(0, 4)),
          Number(month.slice(5, 7)),
          0,
        ).getDate();
  const missed = Math.max(0, elapsed - rows.length);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h3 className="text-lg font-bold">Submission history</h3>
          <p className="text-xs text-[#9CA3AF]">
            Review your daily KRA records and remarks
          </p>
        </div>
        <Input
          type="month"
          className="w-full bg-white sm:ml-auto sm:w-44"
          value={month}
          onChange={(event) => {
            setMonth(event.target.value);
            setVisibleCount(8);
          }}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["On time", onTime, "text-[#1E9E6A]"],
          ["Late / partial", late, "text-[#E8930C]"],
          ["Missed", missed, "text-[#DC3D3D]"],
          [
            "Compliance",
            elapsed ? `${Math.round((onTime / elapsed) * 100)}%` : "—",
            "text-[#6C5CE7]",
          ],
        ].map(([label, value, color]) => (
          <Card key={label} className="border-[#E5E9EF] p-4 shadow-none">
            <p className="text-[11px] font-semibold uppercase text-[#9CA3AF]">
              {label}
            </p>
            <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
        {rows.slice(0, visibleCount).map((submission) => (
          <div key={submission.id} className="border-b last:border-0">
            <button
              className="flex w-full flex-wrap items-center gap-3 px-4 py-4 text-left hover:bg-[#FAFBFC] sm:flex-nowrap sm:gap-4 sm:px-5"
              onClick={() =>
                setExpanded(expanded === submission.id ? null : submission.id)
              }
            >
              <ChevronDown
                className={`h-4 w-4 transition ${expanded === submission.id ? "rotate-180" : ""}`}
              />
              <div className="flex-1">
                <p className="text-sm font-semibold">
                  {new Date(`${submission.date}T00:00:00`).toLocaleDateString(
                    "en-GB",
                    { weekday: "short", day: "2-digit", month: "short" },
                  )}
                </p>
                <p className="text-xs text-[#9CA3AF]">
                  {submission.checklist_title}
                </p>
              </div>
              <span className="text-sm font-semibold">
                {submission.done_count}/{submission.total}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${submission.status === "Completed" ? "bg-green-100 text-green-800" : submission.status === "Late" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}
              >
                {submission.status}
              </span>
            </button>
            {expanded === submission.id && (
              <div className="bg-[#FAFBFC] px-12 pb-4">
                {(submission.responses || []).map((response, index) => (
                  <div
                    key={`${response.item}-${index}`}
                    className="flex items-start gap-3 border-t py-3 text-sm"
                  >
                    <span
                      className={
                        response.done ? "text-[#1E9E6A]" : "text-[#9CA3AF]"
                      }
                    >
                      {response.done ? "✓" : "○"}
                    </span>
                    <div className="flex-1">
                      <p className="font-medium">
                        {response.item}
                        {response.self_added && (
                          <span className="ml-2 rounded-full bg-[#ECE9FF] px-2 py-0.5 text-[10px] font-semibold text-[#6C5CE7]">
                            Self-added
                          </span>
                        )}
                      </p>
                      {response.remark && (
                        <p className="mt-1 text-xs text-[#9CA3AF]">
                          {response.remark}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {!rows.length && (
          <div className="py-14 text-center text-sm text-[#9CA3AF]">
            No submissions yet — your first one appears here
          </div>
        )}
        {rows.length > visibleCount && (
          <div className="border-t p-4 text-center">
            <Button
              variant="outline"
              onClick={() => setVisibleCount(visibleCount + 8)}
            >
              Load more
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

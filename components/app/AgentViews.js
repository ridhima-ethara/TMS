"use client";

import { useEffect, useMemo, useState } from "react";
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
  Inbox,
  Plus,
  Search,
  ChevronDown,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { RaiseTicket } from "@/components/app/TicketsView";

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
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[
        [
          "Assigned to me",
          tickets.length,
          `of ${stats.total} team tickets`,
          "",
        ],
        [
          "Overdue",
          overdue.length,
          `oldest ${oldestText}`,
          "text-[#DC3D3D] border-l-[3px] border-l-[#DC3D3D] rounded-l-none",
        ],
        [
          "In progress",
          tickets.filter((ticket) => ticket.status === "In Progress").length,
          "active queue",
          "text-[#2E7CD6]",
        ],
        [
          "SLA met",
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
        <p className="text-sm text-[#9CA3AF]">No KRA assigned.</p>
      </Card>
    );
  const submission = list.today_submission;
  const responses = submission?.responses || [];
  const done = responses.filter((response) => response.done).length;
  return (
    <Card className="border-[#E5E9EF] p-5 shadow-none">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold">My KRA — today</h3>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${submission ? (submission.status === "Completed" ? "bg-[#E4F5EE] text-[#0E6B47]" : "bg-[#FDF3E0] text-[#8A5A06]") : "bg-[#FDECEC] text-[#A32D2D]"}`}
        >
          {submission?.status || "Not submitted"}
        </span>
        <span className="ml-auto text-xs text-[#4B5563]">
          ⏱ cut-off 6:00 PM
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
              className="grid grid-cols-[110px_1fr_18px] items-center gap-3 text-xs"
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
  const [calendarView, setCalendarView] = useState("week");
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
            onClick={() => setCalendarView("week")}
            className={`rounded-md px-4 py-2 transition ${calendarView === "week" ? "bg-white text-[#111827] shadow-sm" : "text-[#4B5563]"}`}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => setCalendarView("month")}
            className={`rounded-md px-4 py-2 transition ${calendarView === "month" ? "bg-white text-[#111827] shadow-sm" : "text-[#4B5563]"}`}
          >
            Month
          </button>
        </div>
      </div>
      {calendarView === "month" && (
        <div className="mb-2 grid grid-cols-7 gap-2">
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
        className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${calendarView === "month" ? "lg:grid-cols-7" : "xl:grid-cols-7"}`}
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
    Promise.all([
      api("/dashboard"),
      api(`/tickets?assignee_id=${user.id}&limit=200`),
      api("/tickets?limit=200"),
      api("/member-checklists"),
    ])
      .then(([stats, queue, teamQueue, lists]) =>
        setData({
          stats,
          tickets: queue.items,
          teamTickets: teamQueue.items,
          lists,
        }),
      )
      .catch(() => {});
  }, [user.id]);
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
  });
  useEffect(() => {
    if (open)
      api(`/categories?department=${meta.department}`)
        .then((rows) => setCategories(rows.map((row) => row.name)))
        .catch(() => {});
  }, [open, meta.department]);
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
          <div className="grid grid-cols-2 gap-3">
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
  const update = async (payload, message) => {
    try {
      await api(`/tickets/${ticket.id}`, { method: "PATCH", body: payload });
      toast.success(message);
      onUpdated();
    } catch (error) {
      toast.error(error.message);
    }
  };
  const actionLabel =
    {
      Acknowledged: "Acknowledged",
      "In Progress": "In progress",
      "Pending User Response": "Awaiting user",
    }[ticket.status] || "Resolve";
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
        <DropdownMenuItem
          disabled={ticket.status === "Acknowledged"}
          onSelect={() =>
            update(
              {
                status: "Acknowledged",
                assignee_id: ticket.assignee_id || user.id,
              },
              `${ticket.human_id} acknowledged`,
            )
          }
        >
          Acknowledge
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={ticket.status === "In Progress"}
          onSelect={() =>
            update(
              { status: "In Progress" },
              `${ticket.human_id} moved to In Progress`,
            )
          }
        >
          Start progress
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={ticket.status === "Pending User Response"}
          onSelect={() =>
            update(
              { status: "Pending User Response" },
              `${ticket.human_id} is awaiting user response`,
            )
          }
        >
          Await user response
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AgentTickets({ user, onOpenTicket }) {
  const meta = roleMeta(user);
  const [scope, setScope] = useState("team");
  const [tickets, setTickets] = useState([]);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("all");
  const [category, setCategory] = useState("all");
  const [quick, setQuick] = useState("all");
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    api(
      `/tickets?${scope === "mine" ? `assignee_id=${user.id}&` : ""}limit=200`,
    )
      .then((result) => setTickets(result.items))
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, [scope, user.id]);
  const categoryOptions = [
    ...new Set(tickets.map((ticket) => ticket.category).filter(Boolean)),
  ].sort();
  const filtered = tickets
    .filter(
      (ticket) =>
        (!search ||
          `${ticket.human_id} ${ticket.title}`
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
  return (
    <div className="space-y-4 text-[#111827]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-[#EDF0F4] p-1">
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
            Team
          </button>
        </div>
        {[
          ["overdue", "Overdue", "bg-red-100 text-red-800"],
          ["progress", "In progress", "bg-blue-100 text-blue-800"],
          ["resolved", "Resolved", "bg-green-100 text-green-800"],
        ].map(([value, label, style]) => (
          <button
            key={value}
            onClick={() => setQuick(quick === value ? "all" : value)}
            className={`rounded-full px-3 py-2 text-xs font-semibold ${style} ${quick === value ? "ring-2 ring-offset-1" : ""}`}
          >
            {label}
          </button>
        ))}
        <div className="relative ml-2">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#9CA3AF]" />
          <Input
            className="w-56 bg-white pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search id, title…"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="ml-auto w-44 bg-white">
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
          <SelectTrigger className="w-36 bg-white">
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
      <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-12 text-center text-[#9CA3AF]"
                  >
                    Loading tickets…
                  </TableCell>
                </TableRow>
              ) : filtered.length ? (
                filtered.map((ticket) => {
                  const sla = slaRemaining(ticket.sla_resolution_due);
                  const done = DONE.includes(ticket.status);
                  return (
                    <TableRow
                      key={ticket.id}
                      className={sla.breach && !done ? "bg-[#FFF9F9]" : ""}
                    >
                      <TableCell className="font-mono text-xs text-[#9CA3AF]">
                        {ticket.human_id}
                      </TableCell>
                      <TableCell className="font-semibold">
                        {ticket.title}
                      </TableCell>
                      <TableCell>{ticket.category}</TableCell>
                      <TableCell>
                        <Badge
                          className={PRIORITY_META[ticket.priority]?.badge}
                        >
                          {ticket.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={statusClass(ticket.status)}
                        >
                          {ticket.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {done ? (
                          <span className="text-[#9CA3AF]">met</span>
                        ) : (
                          <span
                            className={
                              sla.breach
                                ? "rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-800"
                                : "text-green-700"
                            }
                          >
                            {sla.text}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {done ? "—" : age(ticket.created_at)}
                      </TableCell>
                      <TableCell>
                        <TicketActionMenu
                          ticket={ticket}
                          done={done}
                          user={user}
                          onOpenTicket={onOpenTicket}
                          onUpdated={load}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={8}>
                    <div className="py-12 text-center text-[#9CA3AF]">
                      <Inbox className="mx-auto mb-2 h-8 w-8" />
                      No tickets found
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <p className="border-t px-4 py-3 text-xs text-[#9CA3AF]">
          Showing {filtered.length} of {tickets.length}{" "}
          {scope === "mine" ? "my" : "team"} tickets · overdue sorted first
        </p>
      </Card>
    </div>
  );
}

function CompliancePanel({ submissions, assignedAt }) {
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
            (sum, item) => sum + (item.status === "Completed" ? 1 : 0.5),
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
              className={`h-4 w-4 rounded-[4px] ${date === dayKey(new Date()) ? "border-2 border-[#111827] " : ""}${date < assignedDate ? "bg-[#D9DEE5]" : record?.status === "Completed" ? "bg-[#1E9E6A]" : record?.status === "Partial" ? "bg-[#E8930C]" : date >= dayKey(new Date()) ? "bg-[#EDF0F4]" : "bg-[#DC3D3D]"}`}
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
    <Card className="border-[#E5E9EF] p-5 shadow-none">
      <div className="flex items-center gap-2">
        <h3 className="font-bold">
          ☑ {list.title} —{" "}
          {new Date().toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
          })}
        </h3>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
          {done === rows.length
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
                  className={`min-w-52 flex-1 text-sm ${row.done ? "text-[#9CA3AF] line-through" : "font-medium"}`}
                >
                  {row.item}
                </span>
                <Input
                  className="h-8 w-52"
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
                  className={`min-w-52 flex-1 text-sm ${row.done ? "text-[#9CA3AF] line-through" : "font-medium"}`}
                >
                  {row.item}
                </span>
                <Input
                  className="h-8 w-52 bg-white"
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
        <div className="mt-3 flex gap-2">
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
      <div className="mt-4 flex items-center gap-2 border-t pt-4">
        <span className="text-xs text-[#9CA3AF]">
          Submit before the 6:00 PM cut-off
        </span>
        <Button
          variant="outline"
          className="ml-auto"
          onClick={() => toast.success("Draft saved locally")}
        >
          Save draft
        </Button>
        <Button className="bg-[#131C26] hover:bg-[#1C2836]" onClick={submit}>
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
      <div className="flex items-center">
        <div className="flex rounded-lg bg-[#EDF0F4] p-1">
          <button
            onClick={() => setMode("today")}
            className={`rounded-md px-5 py-2 text-sm font-semibold ${mode === "today" ? "bg-white shadow-sm" : "text-[#4B5563]"}`}
          >
            Today
          </button>
          <button
            onClick={() => setMode("submissions")}
            className={`rounded-md px-5 py-2 text-sm font-semibold ${mode === "submissions" ? "bg-white shadow-sm" : "text-[#4B5563]"}`}
          >
            Submissions
          </button>
        </div>
        <span className="ml-auto flex items-center gap-1 text-xs text-[#4B5563]">
          <Clock3 className="h-4 w-4" />
          Cut-off 6:00 PM
        </span>
      </div>
      {mode === "today" ? (
        <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <div className="space-y-4">
            {lists.map((list) => (
              <TodayChecklist key={list.id} list={list} onSubmitted={load} />
            ))}
            {!lists.length && (
              <Card className="p-10 text-center text-[#9CA3AF] shadow-none">
                No KRA assigned yet.
              </Card>
            )}
          </div>
          <div className="space-y-4">
            <CompliancePanel
              submissions={submissions}
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
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${submission.status === "Completed" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}
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
          className="ml-auto w-44 bg-white"
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
              className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-[#FAFBFC]"
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
                className={`rounded-full px-3 py-1 text-xs font-semibold ${submission.status === "Completed" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}
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

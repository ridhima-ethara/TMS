"use client";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  PRIORITY_META,
  statusClass,
  ALL_STATUSES,
  PRIORITIES,
  fmtDate,
  slaRemaining,
} from "@/lib/appapi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import AttachmentUpload from "@/components/app/AttachmentUpload";
import { toast } from "sonner";
import {
  Check,
  Plus,
  Search,
  Download,
  Inbox,
  LayoutGrid,
  List,
  UserRound,
} from "lucide-react";

const EMPLOYEE_DONE_STATUSES = ["Resolved", "Closed", "Cancelled"];
const EMPLOYEE_WAITING_STATUSES = [
  "Approval Preparation",
  "Pending Super Admin Approval",
  "Clarification Required",
  "Approval On Hold",
  "Approval Rejected",
  "Pending User Response",
  "Pending Vendor",
  "Pending Finance",
  "Pending Material",
  "On Hold",
];

const EMPLOYEE_KANBAN_COLUMNS = [
  {
    key: "raised",
    label: "Raised / Pending",
    color: "#6C5CE7",
    soft: "bg-[#F5F2FF]",
  },
  {
    key: "assigned",
    label: "Assigned",
    color: "#2E7CD6",
    soft: "bg-[#EEF5FD]",
  },
  {
    key: "progress",
    label: "In progress",
    color: "#E8930C",
    soft: "bg-[#FFF8EA]",
  },
  {
    key: "waiting",
    label: "Waiting / Approval",
    color: "#9B59B6",
    soft: "bg-[#FAF3FC]",
  },
  {
    key: "done",
    label: "Resolved / Closed",
    color: "#1E9E6A",
    soft: "bg-[#EFFAF5]",
  },
];

function employeeTicketStage(ticket) {
  if (EMPLOYEE_DONE_STATUSES.includes(ticket.status)) return "done";
  if (EMPLOYEE_WAITING_STATUSES.includes(ticket.status)) return "waiting";
  if (["In Progress", "Approved - Ready for Action"].includes(ticket.status))
    return "progress";
  if (
    ticket.assignee_id ||
    ["Assigned", "Acknowledged"].includes(ticket.status)
  )
    return "assigned";
  return "raised";
}

function employeeStatusTime(ticket) {
  const key = String(ticket.status || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const value =
    ticket.status_timestamps?.[key] || ticket.updated_at || ticket.created_at;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EmployeeTicketProgress({ stage }) {
  const progressIndex = {
    raised: 0,
    assigned: 1,
    progress: 2,
    waiting: 2,
    done: 3,
  }[stage];
  const labels = ["Raised", "Assigned", "Working", "Resolved"];
  return (
    <div className="mt-4">
      <div className="relative flex justify-between">
        <div className="absolute left-2 right-2 top-1.5 h-0.5 bg-[#E1E5EB]" />
        <div
          className="absolute left-2 top-1.5 h-0.5 bg-[#ED00ED] transition-all duration-500"
          style={{ width: `${(progressIndex / 3) * 92}%` }}
        />
        {labels.map((label, index) => (
          <div key={label} className="relative z-10 flex flex-col items-center">
            <span
              className={`h-3.5 w-3.5 rounded-full border-2 transition-colors ${
                index <= progressIndex
                  ? "border-[#ED00ED] bg-[#ED00ED]"
                  : "border-[#CBD1DB] bg-white"
              }`}
            />
            <span
              className={`mt-1.5 text-[9px] font-semibold ${
                index <= progressIndex ? "text-[#A520B8]" : "text-[#9CA3AF]"
              }`}
            >
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmployeeKanban({ tickets, loading, onOpenTicket }) {
  if (loading)
    return (
      <Card className="border-[#E5E9EF] py-20 text-center text-sm text-[#9CA3AF] shadow-none">
        Loading your live ticket progress…
      </Card>
    );
  return (
    <Card className="overflow-hidden border-[#E5E9EF] bg-[#F7F8FA] shadow-none">
      <div className="overflow-x-auto p-4">
        <div className="flex min-w-max items-start gap-3">
          {EMPLOYEE_KANBAN_COLUMNS.map((column) => {
            const rows = tickets.filter(
              (ticket) => employeeTicketStage(ticket) === column.key,
            );
            return (
              <section key={column.key} className="w-[290px] shrink-0">
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
                <div className="space-y-3">
                  {rows.map((ticket) => {
                    const stage = employeeTicketStage(ticket);
                    const done = EMPLOYEE_DONE_STATUSES.includes(ticket.status);
                    const sla = slaRemaining(ticket.sla_resolution_due);
                    return (
                      <button
                        key={ticket.id}
                        type="button"
                        onClick={() => onOpenTicket(ticket.id)}
                        className={`block w-full overflow-hidden rounded-xl border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                          sla.breach && !done
                            ? "border-l-[3px] border-l-red-500"
                            : "border-[#E5E9EF]"
                        }`}
                      >
                        <div className="border-b border-[#E8ECF2] bg-[#FAFBFC] px-4 py-3">
                          <p className="text-[9px] font-semibold uppercase tracking-wider text-[#8B93A1]">
                            {ticket.assignee_name ? "Assigned to" : "Team allocation"}
                          </p>
                          <p className="mt-0.5 truncate text-sm font-bold text-[#1F2937]">
                            {ticket.assignee_name || `${ticket.department} team · Pending`}
                          </p>
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
                          <p className="mt-2 line-clamp-1 text-[11px] text-[#69738B]">
                            {ticket.department} · {ticket.category || "Uncategorised"}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={statusClass(ticket.status)}
                            >
                              {ticket.status}
                            </Badge>
                            {!done && (
                              <span
                                className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                                  sla.breach
                                    ? "bg-red-100 text-red-800"
                                    : "bg-emerald-100 text-emerald-800"
                                }`}
                              >
                                {sla.text}
                              </span>
                            )}
                          </div>
                          <EmployeeTicketProgress stage={stage} />
                          <p className="mt-3 border-t border-[#EDF0F4] pt-2 text-[10px] font-medium text-[#7B8495]">
                            Status updated {employeeStatusTime(ticket)}
                          </p>
                        </div>
                      </button>
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
        {!tickets.length && (
          <div className="py-12 text-center text-[#9CA3AF]">
            <Inbox className="mx-auto mb-2 h-8 w-8" />
            No tickets found
          </div>
        )}
      </div>
      <p className="border-t px-4 py-3 text-xs text-[#9CA3AF]">
        Live workflow view · automatically refreshes when IT or Admin updates a ticket
      </p>
    </Card>
  );
}

function exportCsv(rows) {
  const cols = [
    "human_id",
    "department",
    "category",
    "title",
    "priority",
    "status",
    "raised_by_name",
    "assignee_name",
    "location",
    "created_at",
  ];
  const esc = (v) => {
    const s = String(v ?? "");
    return /^[=+\-@]/.test(s) ? `'${s}` : `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => esc(r[c])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "tickets.csv";
  a.click();
}

export default function TicketsView({
  user,
  onOpenTicket,
  refresh,
  onRefresh,
  preset,
}) {
  const [data, setData] = useState({ items: [], total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState([]);
  const isSuper = user.role === "super_admin";
  const [employeeView, setEmployeeView] = useState("kanban");
  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    priority: "all",
    category: "all",
    department: isSuper ? "IT" : "all",
    page: 1,
  });

  // load categories for the active department
  useEffect(() => {
    const dept =
      filters.department !== "all" ? `?department=${filters.department}` : "";
    api(`/categories${dept}`)
      .then((c) => setCats([...new Set(c.map((x) => x.name))]))
      .catch(() => {});
  }, [filters.department]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.search) p.set("search", filters.search);
      if (filters.status !== "all") p.set("status", filters.status);
      if (filters.priority !== "all") p.set("priority", filters.priority);
      if (filters.category !== "all") p.set("category", filters.category);
      if (filters.department !== "all") p.set("department", filters.department);
      p.set("page", String(filters.page));
      p.set(
        "limit",
        user.role === "employee" && employeeView === "kanban" ? "100" : "15",
      );
      let items = await api(`/tickets?${p.toString()}`);
      if (preset === "approvals") {
        const APPR = [
          "Pending Super Admin Approval",
          "Clarification Required",
          "Approval On Hold",
          "Approval Rejected",
          "Approved - Ready for Action",
          "Approval Preparation",
        ];
        items = {
          ...items,
          items: items.items.filter((t) => APPR.includes(t.status)),
        };
      }
      setData(items);
    } catch (e) {
      if (!silent) toast.error(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filters, preset, user.role, employeeView]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  useEffect(() => {
    if (user.role !== "employee") return undefined;
    const refreshProgress = () => {
      if (document.visibilityState === "visible") load({ silent: true });
    };
    const timer = window.setInterval(refreshProgress, 10000);
    window.addEventListener("focus", refreshProgress);
    document.addEventListener("visibilitychange", refreshProgress);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshProgress);
      document.removeEventListener("visibilitychange", refreshProgress);
    };
  }, [user.role, load]);

  return (
    <div className="space-y-4">
      {user.role === "employee" && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Total tickets", data.total, "text-[#111827]"],
            [
              "Open",
              data.items.filter(
                (ticket) =>
                  !["Resolved", "Closed", "Cancelled"].includes(ticket.status),
              ).length,
              "text-[#2E7CD6]",
            ],
            [
              "In progress",
              data.items.filter((ticket) => ticket.status === "In Progress")
                .length,
              "text-[#E8930C]",
            ],
            [
              "Resolved",
              data.items.filter((ticket) =>
                ["Resolved", "Closed"].includes(ticket.status),
              ).length,
              "text-[#1E9E6A]",
            ],
          ].map(([label, value, tone]) => (
            <Card key={label} className="border-[#E5E9EF] p-4 shadow-none">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                {label}
              </p>
              <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
            </Card>
          ))}
        </div>
      )}
      {isSuper && (
        <Tabs
          value={filters.department}
          onValueChange={(v) =>
            setFilters({ ...filters, department: v, category: "all", page: 1 })
          }
        >
          <TabsList className="h-auto max-w-full justify-start overflow-x-auto">
            <TabsTrigger value="IT">IT Department</TabsTrigger>
            <TabsTrigger value="Admin">Admin Department</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="w-full pl-8 sm:w-56"
              placeholder="Search id, title..."
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value, page: 1 })
              }
            />
          </div>
          <Select
            value={filters.status}
            onValueChange={(v) =>
              setFilters({ ...filters, status: v, page: 1 })
            }
          >
            <SelectTrigger className="h-9 w-full sm:w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.priority}
            onValueChange={(v) =>
              setFilters({ ...filters, priority: v, page: 1 })
            }
          >
            <SelectTrigger className="h-9 w-full sm:w-32">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priority</SelectItem>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.category}
            onValueChange={(v) =>
              setFilters({ ...filters, category: v, page: 1 })
            }
          >
            <SelectTrigger className="h-9 w-full sm:w-44">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {cats.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {user.role === "employee" && (
            <div
              className="flex rounded-lg border border-[#DDE2EA] bg-[#F3F5F8] p-1"
              role="group"
              aria-label="Ticket view"
            >
              <button
                type="button"
                onClick={() => setEmployeeView("kanban")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition ${
                  employeeView === "kanban"
                    ? "bg-white text-[#A520B8] shadow-sm"
                    : "text-[#69738B]"
                }`}
                aria-pressed={employeeView === "kanban"}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Kanban
              </button>
              <button
                type="button"
                onClick={() => setEmployeeView("list")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition ${
                  employeeView === "list"
                    ? "bg-white text-[#A520B8] shadow-sm"
                    : "text-[#69738B]"
                }`}
                aria-pressed={employeeView === "list"}
              >
                <List className="h-3.5 w-3.5" />
                List
              </button>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCsv(data.items)}
          >
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
          {preset === "approvals" ? (
            ["it", "admin"].includes(user.role) && (
              <RaiseRequest
                user={user}
                onCreated={() => {
                  onRefresh?.();
                  load();
                }}
              />
            )
          ) : (
            <RaiseTicket
              user={user}
              onCreated={() => {
                onRefresh?.();
                load();
              }}
            />
          )}
        </div>
      </div>

      {user.role === "employee" && employeeView === "kanban" && (
        <EmployeeKanban
          tickets={data.items}
          loading={loading}
          onOpenTicket={onOpenTicket}
        />
      )}

      {(user.role !== "employee" || employeeView === "list") && (
      <Card>
        <Table className="min-w-[900px]">
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assignee</TableHead>
              <TableHead>SLA</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <div className="py-12 text-center text-muted-foreground">
                    <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    No tickets found
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((t) => {
                const sla = slaRemaining(t.sla_resolution_due);
                const done = ["Resolved", "Closed", "Cancelled"].includes(
                  t.status,
                );
                return (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => onOpenTicket(t.id)}
                  >
                    <TableCell className="font-mono text-xs">
                      {t.human_id}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate">
                      {t.title}
                    </TableCell>
                    <TableCell className="text-sm">{t.category}</TableCell>
                    <TableCell>
                      <Badge className={PRIORITY_META[t.priority]?.badge}>
                        {t.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={statusClass(t.status)}
                      >
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.assignee_name || "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {done ? (
                        "-"
                      ) : (
                        <span
                          className={
                            sla.breach
                              ? "text-red-600 font-semibold"
                              : "text-emerald-600"
                          }
                        >
                          {sla.text}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {fmtDate(t.created_at)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{data.total} tickets</p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page <= 1}
            onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
          >
            Prev
          </Button>
          <span className="text-sm">
            Page {data.page} / {data.pages || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={filters.page >= (data.pages || 1)}
            onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function LocationSelect({ value, onChange, locs }) {
  const groups = locs.reduce((a, l) => {
    (a[l.building || "Other"] = a[l.building || "Other"] || []).push(l);
    return a;
  }, {});
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-11 rounded-xl bg-[#FAFBFC]">
        <SelectValue placeholder="Select location" />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(groups).map(([building, items]) => (
          <SelectGroup key={building}>
            <SelectLabel>{building}</SelectLabel>
            {items.map((l) => (
              <SelectItem key={l.name} value={l.name}>
                {l.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

const locationSite = (value) => {
  if (/\blotus\b/i.test(String(value || ""))) return "Lotus";
  if (/\btulip\b/i.test(String(value || ""))) return "Tulip";
  return null;
};

export function RaiseTicket({ user, onCreated }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cats, setCats] = useState([]);
  const [locs, setLocs] = useState([]);
  const [members, setMembers] = useState([]);
  const [existingTickets, setExistingTickets] = useState([]);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [f, setF] = useState({
    department: "IT",
    category: "",
    title: "",
    description: "",
    priority: "Medium",
    location: "Tulip - Ground Floor",
    raised_for_name: "",
    raised_for_id: "",
    employee_id: "",
    email: "",
    assignee_id: "",
  });

  useEffect(() => {
    if (!open) return;
    api(`/categories?department=${f.department}`)
      .then((c) => {
        const names = c.map((x) => x.name);
        setCats(names);
        if (!f.category && names.length)
          setF((current) => ({ ...current, category: names[0] }));
      })
      .catch(() => {});
    api("/locations")
      .then(setLocs)
      .catch(() => {});
    api("/users")
      .then((rows) =>
        setMembers(
          rows.filter(
            (member) =>
              member.role === (f.department === "Admin" ? "admin" : "it"),
          ),
        ),
      )
      .catch(() => {});
    api("/tickets?limit=200")
      .then((result) => setExistingTickets(result.items || []))
      .catch(() => {});
  }, [open, f.department]);

  const submit = async () => {
    if (!f.title) return toast.error("Title required");
    setBusy(true);
    try {
      const t = await api("/tickets", {
        method: "POST",
        body: { ...f, attachment_ids: attachments.map((item) => item.id) },
      });
      toast.success(`Raised ${t.human_id}`);
      setOpen(false);
      setAttachments([]);
      setF((current) => ({
        ...current,
        title: "",
        description: "",
        category: "",
        raised_for_id: "",
        raised_for_name: "",
        employee_id: "",
        email: "",
        assignee_id: "",
      }));
      onCreated();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const categoryIcon = (category = "") => {
    const value = category.toLowerCase();
    if (value.includes("network") || value.includes("wi-fi")) return "📶";
    if (value.includes("laptop")) return "💾";
    if (value.includes("hardware")) return "💻";
    if (value.includes("printer")) return "🖨️";
    if (value.includes("email") || value.includes("access")) return "✉️";
    if (value.includes("password")) return "🔑";
    if (value.includes("parking")) return "🚗";
    if (value.includes("air") || value.includes("ac")) return "❄️";
    return "📋";
  };
  const visibleCategories = cats.filter((category) =>
    category.toLowerCase().includes(categorySearch.toLowerCase()),
  );
  const duplicate =
    f.title.trim().length >= 4
      ? existingTickets.find(
          (ticket) =>
            !["Resolved", "Closed", "Cancelled"].includes(ticket.status) &&
            (ticket.title.toLowerCase().includes(f.title.toLowerCase()) ||
              f.title.toLowerCase().includes(ticket.title.toLowerCase())),
        )
      : null;
  const selectedSite = locationSite(f.location);
  const userSite = locationSite(user.location);
  const managedSites = (user.managed_locations || [])
    .map(locationSite)
    .filter(Boolean);
  const canAssignTeam =
    user.role === "super_admin" ||
    (user.is_team_head &&
      user.role === (f.department === "Admin" ? "admin" : "it") &&
      (f.department === "Admin" ||
        !selectedSite ||
        managedSites.includes(selectedSite) ||
        userSite === selectedSite));
  const availableMembers = canAssignTeam
    ? members
    : members.filter(
        (member) =>
          member.id === user.id &&
          user.role === (f.department === "Admin" ? "admin" : "it") &&
          (!selectedSite || !userSite || selectedSite === userSite),
      );
  const selectedMember = availableMembers.find(
    (member) => member.id === f.assignee_id,
  );
  const hasAffectedEmployee = Boolean(
    f.raised_for_name.trim() || f.email.trim() || f.employee_id.trim(),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Raise Ticket
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[760px] overflow-y-auto rounded-2xl p-4 sm:max-h-[94vh] sm:p-7">
        <DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div>
              <DialogTitle className="text-2xl font-bold">
                Raise a ticket
              </DialogTitle>
              <p className="mt-1 text-sm font-medium text-[#9CA3AF]">
                {f.department} department · routed automatically by category
              </p>
            </div>
            <div className="flex w-full rounded-lg bg-[#EDF0F4] p-1 sm:ml-auto sm:w-auto">
              {["IT", "Admin"].map((department) => (
                <button
                  key={department}
                  onClick={() =>
                    setF({ ...f, department, category: "", assignee_id: "" })
                  }
                  className={`flex-1 rounded-md px-5 py-2 text-sm font-semibold ${f.department === department ? "bg-white shadow-sm" : "text-[#4B5563]"}`}
                >
                  {department}
                </button>
              ))}
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative space-y-1">
            <Label className="text-sm font-semibold">Category</Label>
            <button
              type="button"
              onClick={() => setCategoryOpen(!categoryOpen)}
              className={`flex h-12 w-full items-center gap-3 rounded-xl border bg-white px-4 text-left text-sm font-semibold ${categoryOpen ? "border-2 border-[#1B7F6E]" : "border-[#E5E9EF]"}`}
            >
              <span>{categoryIcon(f.category)}</span>
              <span className="flex-1">{f.category || "Select category"}</span>
              <span className="text-[#9CA3AF]">{categoryOpen ? "▲" : "▼"}</span>
            </button>
            {categoryOpen && (
              <div className="absolute left-0 right-0 top-[74px] z-50 overflow-hidden rounded-xl border border-[#E5E9EF] bg-white shadow-xl">
                <div className="flex items-center gap-2 border-b px-4 py-3">
                  <Search className="h-4 w-4 text-[#9CA3AF]" />
                  <input
                    autoFocus
                    className="flex-1 bg-transparent text-sm outline-none"
                    placeholder="Search categories…"
                    value={categorySearch}
                    onChange={(event) => setCategorySearch(event.target.value)}
                  />
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {visibleCategories.map((category) => (
                    <button
                      type="button"
                      key={category}
                      onClick={() => {
                        setF({ ...f, category });
                        setCategoryOpen(false);
                        setCategorySearch("");
                      }}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm ${f.category === category ? "bg-[#E4F5EE] font-semibold text-[#0E6B47]" : "text-[#4B5563] hover:bg-[#FAFBFC]"}`}
                    >
                      <span>{categoryIcon(category)}</span>
                      <span className="flex-1">{category}</span>
                      {f.category === category && <Check className="h-4 w-4" />}
                    </button>
                  ))}
                </div>
                {cats.length > visibleCategories.length && (
                  <p className="border-t px-4 py-2 text-xs text-[#9CA3AF]">
                    + {cats.length - visibleCategories.length} more categories
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="grid gap-5 sm:grid-cols-[1.4fr_1fr]">
            <div>
              <Label className="text-sm font-semibold">
                Priority · sets response SLA
              </Label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Low", "24h"],
                  ["Medium", "8h"],
                  ["High", "4h"],
                  ["Critical", "1h"],
                ].map(([priority, sla]) => (
                  <button
                    type="button"
                    key={priority}
                    onClick={() => setF({ ...f, priority })}
                    className={`rounded-xl border p-2.5 text-center ${f.priority === priority ? "border-2 border-[#E8930C] bg-[#FDF3E0] text-[#8A5A06]" : "border-[#E5E9EF]"}`}
                  >
                    <b className="block text-xs">{priority}</b>
                    <span className="text-[10px] text-[#9CA3AF]">{sla}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Location</Label>
              <LocationSelect
                value={f.location}
                onChange={(v) =>
                  setF({ ...f, location: v, assignee_id: "" })
                }
                locs={locs}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Title</Label>
            <Input
              className="h-11 rounded-xl bg-[#FAFBFC]"
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
              placeholder="Brief summary"
            />
          </div>
          {duplicate && (
            <button
              type="button"
              className="w-full rounded-lg bg-[#E8F1FB] px-3 py-2 text-left text-xs text-[#1A5CA8]"
            >
              ℹ Similar open ticket:{" "}
              <b>
                {duplicate.human_id} “{duplicate.title}”
              </b>{" "}
              · <u>view before raising a duplicate</u>
            </button>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea
              className="rounded-xl bg-[#FAFBFC]"
              rows={3}
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              placeholder="Describe the issue"
            />
          </div>
          {user.role !== "employee" && (
            <div className="rounded-xl border border-[#DDE7E3] bg-gradient-to-r from-[#F7FBF9] to-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Label className="text-sm font-semibold">
                    Affected employee
                    <span className="ml-1 font-medium text-[#9CA3AF]">
                      (optional)
                    </span>
                  </Label>
                  <p className="mt-1 text-xs leading-5 text-[#697087]">
                    Enter the employee details manually. If the email or GRP
                    code matches a registered employee, the ticket will also
                    appear on their dashboard.
                  </p>
                </div>
                <span
                  className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-semibold ${hasAffectedEmployee ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}
                >
                  {hasAffectedEmployee
                    ? "Affected employee recorded"
                    : "Internal · auto-close"}
                </span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Employee name</Label>
                  <Input
                    className="mt-1 h-11 bg-white"
                    value={f.raised_for_name}
                    onChange={(event) =>
                      setF({ ...f, raised_for_name: event.target.value, raised_for_id: "" })
                    }
                    placeholder="Full name"
                  />
                </div>
                <div>
                  <Label className="text-xs">Company email (optional)</Label>
                  <Input
                    type="email"
                    className="mt-1 h-11 bg-white"
                    value={f.email}
                    onChange={(event) =>
                      setF({ ...f, email: event.target.value, raised_for_id: "" })
                    }
                    placeholder="employee@ethara.ai"
                  />
                </div>
                <div>
                  <Label className="text-xs">GRP code (optional)</Label>
                  <Input
                    className="mt-1 h-11 bg-white"
                    value={f.employee_id}
                    onChange={(event) =>
                      setF({ ...f, employee_id: event.target.value, raised_for_id: "" })
                    }
                    placeholder="GRP-0000"
                  />
                </div>
              </div>
              <p className="mt-2 text-[10px] text-[#9CA3AF]">
                Leave all three fields blank for an internal team ticket.
              </p>
            </div>
          )}
          {["employee", "it", "admin", "super_admin"].includes(user.role) && (
            <div
              className={`grid gap-3 ${user.role === "employee" ? "" : "sm:grid-cols-2"}`}
            >
              <div>
                <Label className="text-xs">Raised by</Label>
                <div className="mt-1 flex items-center gap-3 rounded-lg border bg-[#FAFBFC] p-3">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-[#2E7CD6] text-xs font-semibold text-white">
                    {user.name
                      .split(" ")
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {user.name}
                    </p>
                    <p className="truncate text-xs text-[#9CA3AF]">
                      {user.email}
                    </p>
                  </div>
                  <span className="text-[10px] text-[#9CA3AF]">autofilled</span>
                </div>
              </div>
              {user.role === "employee" ? (
                <div>
                  <Label className="text-xs">
                    Assign to ({f.department} team)
                  </Label>
                  <div className="mt-1 flex h-[58px] items-center gap-3 rounded-xl border border-[#E5E9EF] bg-[#FAFBFC] px-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#6C5CE7] text-white">
                      <UserRound className="h-4 w-4" />
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">
                        Auto-route to all {f.department} members
                      </p>
                      <p className="text-[11px] text-[#9CA3AF]">
                        A team member will claim and acknowledge the ticket
                      </p>
                    </div>
                    <span className="rounded-full bg-[#E4F5EE] px-2.5 py-1 text-[10px] font-semibold text-[#0E6B47]">
                      Automatic
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <Label className="text-xs">
                    Assign to ({f.department} member)
                  </Label>
                  <Select
                    value={f.assignee_id}
                    onValueChange={(value) =>
                      setF({ ...f, assignee_id: value })
                    }
                  >
                    <SelectTrigger className="mt-1 h-[58px]">
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-[#6C5CE7] text-xs font-semibold text-white">
                        {selectedMember ? (
                          selectedMember.name
                            .split(" ")
                            .map((part) => part[0])
                            .slice(0, 2)
                            .join("")
                        ) : (
                          <UserRound className="h-4 w-4" />
                        )}
                      </span>
                      <SelectValue placeholder="Auto-route or select member" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableMembers.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.name} · {member.location || f.department}
                        </SelectItem>
                      ))}
                      {!availableMembers.length && (
                        <div className="px-3 py-2 text-xs text-[#9CA3AF]">
                          This ticket will be routed to the location team queue.
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          <div>
            <Label className="text-sm font-semibold">
              Attachments{" "}
              <span className="font-medium text-[#9CA3AF]">(optional)</span>
            </Label>
            <div className="mt-2">
              <AttachmentUpload
                value={attachments}
                onChange={setAttachments}
                disabled={busy}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B7F6E] hover:bg-[#14695B]"
            onClick={submit}
            disabled={busy}
          >
            Submit ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RaiseRequest({ user, onCreated }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cats, setCats] = useState([]);
  const [locs, setLocs] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const dept = user.role === "admin" ? "Admin" : "IT";
  const [f, setF] = useState({
    category: "",
    title: "",
    description: "",
    priority: "High",
    location: "Tulip - Ground Floor",
    justification: "",
    requested_amount: "",
    vendor: "",
    required_by: "",
  });

  useEffect(() => {
    if (!open) return;
    api(`/categories?department=${dept}`)
      .then((c) => setCats(c.map((x) => x.name)))
      .catch(() => {});
    api("/locations")
      .then(setLocs)
      .catch(() => {});
  }, [open]);

  const submit = async () => {
    if (!f.title || !f.justification)
      return toast.error("Title and justification are required");
    setBusy(true);
    try {
      const t = await api("/tickets", {
        method: "POST",
        body: {
          department: dept,
          category: f.category,
          title: f.title,
          description: f.description,
          priority: f.priority,
          location: f.location,
        },
      });
      await api(`/tickets/${t.id}/approval/submit`, {
        method: "POST",
        body: {
          justification: f.justification,
          requested_amount: Number(f.requested_amount) || 0,
          vendor: f.vendor,
          required_by: f.required_by,
          attachment_ids: attachments.map((item) => item.id),
        },
      });
      toast.success(`Request ${t.human_id} sent to Super Admin`);
      setOpen(false);
      setAttachments([]);
      setF({
        ...f,
        title: "",
        description: "",
        justification: "",
        requested_amount: "",
        vendor: "",
      });
      onCreated();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Raise Request
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise Approval Request ({dept})</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            This request will be submitted to the Super Admin for approval
            before any execution.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select
                value={f.category}
                onValueChange={(v) => setF({ ...f, category: v })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {cats.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Priority</Label>
              <Select
                value={f.priority}
                onValueChange={(v) => setF({ ...f, priority: v })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Location</Label>
            <LocationSelect
              value={f.location}
              onChange={(v) => setF({ ...f, location: v })}
              locs={locs}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Title</Label>
            <Input
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
              placeholder="What is being requested"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Justification</Label>
            <Textarea
              rows={2}
              value={f.justification}
              onChange={(e) => setF({ ...f, justification: e.target.value })}
              placeholder="Why is this needed"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Amount (₹)</Label>
              <Input
                type="number"
                value={f.requested_amount}
                onChange={(e) =>
                  setF({ ...f, requested_amount: e.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Vendor</Label>
              <Input
                value={f.vendor}
                onChange={(e) => setF({ ...f, vendor: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Required by</Label>
              <Input
                type="date"
                value={f.required_by}
                onChange={(e) => setF({ ...f, required_by: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Proof or reference documents</Label>
            <AttachmentUpload
              value={attachments}
              onChange={setAttachments}
              disabled={busy}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy}>
            Submit to Super Admin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

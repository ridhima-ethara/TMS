"use client";

// Approval inbox for every role. Super Admin decides purchase requests; IT and
// Admin members raise them, follow their team's requests and answer requests
// for information. Decisions and resubmissions go through the ticket approval
// API; discussion uses the linked ticket's comments.
import { useCallback, useEffect, useState } from "react";
import { api, PRIORITIES, slaRemaining } from "@/lib/appapi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import AttachmentUpload from "@/components/app/AttachmentUpload";
import { toast } from "sonner";
import { DateField } from "@/components/ui/date-field";

const initials = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

function RaiseRequest({ user, onCreated }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cats, setCats] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const dept = user.role === "admin" ? "Admin" : "IT";
  const [form, setForm] = useState({
    category: "",
    priority: "High",
    title: "",
    justification: "",
    requested_amount: "",
    vendor: "",
    required_by: "",
  });
  useEffect(() => {
    if (open)
      api(`/categories?department=${dept}`)
        .then((rows) => setCats(rows.map((row) => row.name)))
        .catch(() => {});
  }, [open, dept]);
  const submit = async () => {
    if (!form.category || !form.title || !form.justification)
      return toast.error("Category, title and justification are required");
    setBusy(true);
    try {
      const ticket = await api("/tickets", {
        method: "POST",
        body: {
          department: dept,
          category: form.category,
          title: form.title,
          description: form.justification,
          priority: form.priority,
        },
      });
      await api(`/tickets/${ticket.id}/approval/submit`, {
        method: "POST",
        body: {
          justification: form.justification,
          requested_amount: Number(form.requested_amount) || 0,
          vendor: form.vendor,
          required_by: form.required_by,
          attachment_ids: attachments.map((item) => item.id),
        },
      });
      toast.success(`Approval request submitted as ${ticket.human_id}`);
      setOpen(false);
      setAttachments([]);
      onCreated();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="rounded-[9px] bg-[#12795a] px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-[#0e6149]">
          + Raise request
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Raise approval request</DialogTitle>
          <p className="text-sm text-[#9CA3AF]">
            Submitted to the super admin before any purchase or execution.
          </p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(value) => setForm({ ...form, category: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {cats.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
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
            <Label>Title</Label>
            <Input
              className="mt-1"
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
            />
          </div>
          <div>
            <Label>Justification</Label>
            <Textarea
              className="mt-1"
              rows={3}
              value={form.justification}
              onChange={(event) =>
                setForm({ ...form, justification: event.target.value })
              }
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>
                Amount (₹){" "}
                <span className="font-normal text-[#9CA3AF]">optional</span>
              </Label>
              <Input
                className="mt-1"
                type="number"
                value={form.requested_amount}
                onChange={(event) =>
                  setForm({ ...form, requested_amount: event.target.value })
                }
              />
            </div>
            <div>
              <Label>Vendor</Label>
              <Input
                className="mt-1"
                value={form.vendor}
                onChange={(event) =>
                  setForm({ ...form, vendor: event.target.value })
                }
              />
            </div>
            <div>
              <Label>Required by</Label>
              <DateField
                className="mt-1 w-full"
                value={form.required_by}
                clearable
                onChange={(value) => setForm({ ...form, required_by: value })}
              />
            </div>
          </div>
          {Number(form.requested_amount) > 25000 && (
            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              ⚠ Amounts above ₹25,000 also require finance sign-off after super
              admin approval.
            </div>
          )}
          <div>
            <Label>Proof, quotation or reference documents</Label>
            <div className="mt-1">
              <AttachmentUpload
                value={attachments}
                onChange={setAttachments}
                disabled={busy}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => toast.success("Draft kept in this form")}
          >
            Save draft
          </Button>
          <Button onClick={submit} disabled={busy}>
            Submit to super admin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const GRN = "#12795a", AMB = "#8a5a00", RED = "#b42318", MAG = "#b3177f";
const DAY_MS = 86400000;
const FINANCE_LIMIT = 25000;
const QUOTE_LIMIT = 100000;
const OPEN_STATES = ["Pending", "On Hold", "Clarification"];
const isOpen = (status) => OPEN_STATES.includes(status);
const isApproved = (status) => status === "Approved" || status === "Partially Approved";
const STATUS_TONE = {
  Pending: ["#fdf3dc", AMB],
  "On Hold": ["#fdf3dc", AMB],
  Clarification: ["#e8f0fc", "#1d4f9e"],
  Approved: ["#e4f3ec", GRN],
  "Partially Approved": ["#e4f3ec", GRN],
  Rejected: ["#fdeaea", RED],
};
const STATUS_LABEL = { Clarification: "Info requested", "Partially Approved": "Part-approved", "On Hold": "On hold" };
const DESK = { IT: ["#2f6bd0", "#e8f0fc"], Admin: [GRN, "#e4f3ec"] };
const DECISION_VERB = {
  submitted: "submitted for approval",
  resubmitted: "resubmitted with more information",
  approve: "approved the request",
  partial: "part-approved the request",
  reject: "rejected the request",
  hold: "put the request on hold",
  clarify: "asked for more information",
};
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const daysBetween = (ms) => Math.max(0, Math.floor(ms / DAY_MS));
const dayMonth = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const stamp = (d) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const segCls = (on) => (on ? "bg-white text-[#17171c] shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "bg-transparent text-[#6b6b76]");
const span = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};
const requesterOf = (row) =>
  row.history?.find((h) => h.action === "submitted")?.by || row.ticket?.raised_by_name || "Requester";
const decisionEntry = (row) =>
  [...(row.history || [])].reverse().find((h) => ["approve", "partial", "reject"].includes(h.action));
const decidedAt = (row) => new Date(decisionEntry(row)?.at || row.updated_at || row.created_at);
const ticketOverdue = (t, now) =>
  t && !["Resolved", "Closed", "Cancelled"].includes(t.status) && t.sla_resolution_due && new Date(t.sla_resolution_due).getTime() < now;
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

function exportRows(rows) {
  const csv = [
    ["ID", "Desk", "Request", "Ticket", "Requested by", "Vendor", "Amount", "Approved amount", "Required by", "Status", "Raised", "Decision remarks"],
    ...rows.map((r) => [
      r.human_id, r.ticket?.department, r.ticket?.title, r.ticket?.human_id, requesterOf(r), r.vendor, r.requested_amount,
      r.approved_amount ?? "", r.required_by ? dayMonth(r.required_by) : "", r.status, r.created_at ? dayMonth(r.created_at) : "", r.decision_remarks || "",
    ]),
  ].map((line) => line.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "approvals.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Shared facts for one approval row: waiting time, deadlines, blocking ticket
// and the checks a decider should look at.
function analyse(row, ctx) {
  const { now, decided, usualDays } = ctx;
  const ticket = row.ticket || {};
  const open = isOpen(row.status);
  const waitMs = now - new Date(row.created_at);
  const wait = daysBetween(waitMs);
  const req = row.required_by ? new Date(row.required_by) : null;
  const reqLate = req && req.getTime() < now - DAY_MS ? daysBetween(now - req) : 0;
  const blocking = open && ticketOverdue(ticket, now);
  const overdueBy = blocking ? now - new Date(ticket.sla_resolution_due) : 0;
  const quotes = row.attachments?.length || 0;
  const needQuotes = (row.requested_amount || 0) > QUOTE_LIMIT ? 3 : 1;
  const pastOrders = decided.filter(
    (o) => o.id !== row.id && row.vendor && o.vendor?.trim().toLowerCase() === row.vendor.trim().toLowerCase() && isApproved(o.status),
  ).length;
  const by = requesterOf(row);
  const checks = [];
  if (blocking) checks.push([false, `Blocking ${ticket.human_id} — overdue ${span(overdueBy)}`]);
  if (req) checks.push(reqLate ? [false, `Required by ${dayMonth(req)} — already ${reqLate} day${reqLate === 1 ? "" : "s"} late`] : [true, `Required by ${dayMonth(req)}`]);
  else checks.push([false, "No required-by date set"]);
  if (open)
    checks.push(
      usualDays != null
        ? [wait <= Math.ceil(usualDays), `Waiting ${wait} day${wait === 1 ? "" : "s"}${wait > usualDays ? ` — usual decision time is ${usualDays} day${usualDays === 1 ? "" : "s"}` : ""}`]
        : [wait <= 2, `Waiting ${wait} day${wait === 1 ? "" : "s"}`],
    );
  checks.push(
    quotes >= needQuotes
      ? [true, `${quotes} document${quotes === 1 ? "" : "s"} attached${needQuotes > 1 ? " · 3 recommended above ₹1L" : ""}`]
      : [false, `${quotes || "No"} quotation${quotes === 1 ? "" : "s"} attached — ${needQuotes} recommended${needQuotes > 1 ? " above ₹1L" : ""}`],
  );
  if (row.vendor) checks.push(pastOrders ? [true, `Known vendor · ${pastOrders} past approved order${pastOrders === 1 ? "" : "s"}`] : [false, "New vendor · no past approved orders"]);
  if (ticket.raised_by_name && ticket.raised_by_name === ticket.assignee_name && ticket.raised_by_name === by)
    checks.push([false, "Raised, owned and requested by one person — no second review"]);
  return { row, ticket, open, wait, waitMs, req, reqLate, blocking, overdueBy, quotes, pastOrders, by, checks };
}

function stageOf(a, isSuper) {
  const s = a.row.status;
  const fin = (a.row.approved_amount ?? a.row.requested_amount ?? 0) > FINANCE_LIMIT;
  const steps =
    s === "Rejected" ? [GRN, RED, "#e3e1dc", "#e3e1dc"]
      : isApproved(s) ? [GRN, GRN, fin ? "#e0b44a" : GRN, GRN]
        : s === "Clarification" ? [GRN, "#6f9ce6", "#e3e1dc", "#e3e1dc"]
          : [GRN, MAG, "#e3e1dc", "#e3e1dc"];
  const text =
    s === "Rejected" ? "Stopped at Super Admin"
      : isApproved(s) ? (fin ? "Finance sign-off next" : "Approved · work unlocked")
        : s === "Clarification" ? "Waiting on requester"
          : s === "On Hold" ? `On hold · ${isSuper ? "you" : "Super Admin"}`
            : `Step 2 of 4 · ${isSuper ? "you" : "Super Admin"}`;
  return { steps, text };
}

function Inbox({ rows, user, load, onOpenTicket }) {
  const isSuper = user.role === "super_admin";
  const [tab, setTab] = useState(isSuper ? "pending" : "all");
  const [desk, setDesk] = useState("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);
  const now = Date.now();

  const decided = rows.filter((r) => ["Approved", "Partially Approved", "Rejected"].includes(r.status));
  const usualMs = median(decided.map((r) => decidedAt(r) - new Date(r.created_at)));
  const usualDays = usualMs == null ? null : Math.max(0.5, Math.round((usualMs / DAY_MS) * 2) / 2);
  const ctx = { now, decided, usualDays };
  const items = rows.map((r) => analyse(r, ctx));
  const byId = new Map(items.map((a) => [a.row.id, a]));
  const deskOk = (a) => desk === "all" || a.ticket.department === desk;
  const pend = items.filter((a) => a.open);
  const month = now - 30 * DAY_MS;
  const recent = decided.filter((r) => decidedAt(r).getTime() >= month);
  const recentOk = recent.filter((r) => isApproved(r.status));
  const ninety = decided.filter((r) => decidedAt(r).getTime() >= now - 90 * DAY_MS);
  const med90 = median(ninety.map((r) => (decidedAt(r) - new Date(r.created_at)) / DAY_MS));
  const blockers = pend.filter((a) => a.blocking).sort((a, b) => b.waitMs - a.waitMs);
  const oldestBlock = blockers[0];
  const kpis = isSuper
    ? [
        ["Waiting on you", pend.length, pend.length ? `${inr(pend.reduce((s, a) => s + (a.row.requested_amount || 0), 0))} total` : "inbox clear", pend.length ? AMB : GRN],
        ["Oldest waiting", pend.length ? `${Math.max(...pend.map((a) => a.wait))} days` : "—", usualDays != null ? `usual decision time ${usualDays} day${usualDays === 1 ? "" : "s"}` : "no past decisions yet", pend.some((a) => a.wait > 7) ? RED : "#17171c"],
        ["Blocking overdue tickets", blockers.length, "ticket SLA runs while waiting", blockers.length ? RED : GRN],
        ["Approved · last 30 days", recentOk.length, `${inr(recentOk.reduce((s, r) => s + (r.approved_amount ?? r.requested_amount ?? 0), 0))} · ${recent.length - recentOk.length} rejected`, "#17171c"],
        ["Decided · last 90 days", ninety.length, med90 == null ? "no decisions yet" : `median ${med90 < 1 ? "same day" : `${Math.round(med90)} day${Math.round(med90) === 1 ? "" : "s"}`} to decide`, "#17171c"],
      ]
    : [
        ["Waiting on Super Admin", pend.filter((a) => a.row.status !== "Clarification").length, pend.length ? `${inr(pend.reduce((s, a) => s + (a.row.requested_amount || 0), 0))} pending` : "nothing pending", AMB],
        ["Need your reply", pend.filter((a) => a.row.status === "Clarification").length, "Super Admin asked for info", pend.some((a) => a.row.status === "Clarification") ? "#1d4f9e" : "#17171c"],
        ["Blocking overdue tickets", blockers.length, "ticket SLA runs while waiting", blockers.length ? RED : GRN],
        ["Approved · last 30 days", recentOk.length, `${inr(recentOk.reduce((s, r) => s + (r.approved_amount ?? r.requested_amount ?? 0), 0))} · ${recent.length - recentOk.length} rejected`, "#17171c"],
        ["Usual decision time", usualDays == null ? "—" : `${usualDays} day${usualDays === 1 ? "" : "s"}`, `${decided.length} decided so far`, "#17171c"],
      ];
  const needReply = !isSuper && pend.filter((a) => a.row.status === "Clarification").sort((a, b) => b.waitMs - a.waitMs)[0];

  const inTab = (a) =>
    tab === "all" || (tab === "pending" && a.open) || (tab === "approved" && isApproved(a.row.status)) || (tab === "rejected" && a.row.status === "Rejected");
  const ql = q.trim().toLowerCase();
  const list = items
    .filter((a) => deskOk(a) && inTab(a) && (!ql || `${a.row.human_id} ${a.ticket.title || ""} ${a.ticket.human_id || ""} ${a.by} ${a.row.vendor || ""} ${a.ticket.category || ""}`.toLowerCase().includes(ql)))
    .sort((a, b) => (a.open !== b.open ? (a.open ? -1 : 1) : a.open ? b.blocking - a.blocking || b.waitMs - a.waitMs : decidedAt(b.row) - decidedAt(a.row)));
  const counts = {
    all: items.filter(deskOk).length,
    pending: items.filter((a) => deskOk(a) && a.open).length,
    approved: items.filter((a) => deskOk(a) && isApproved(a.row.status)).length,
    rejected: items.filter((a) => deskOk(a) && a.row.status === "Rejected").length,
  };
  // Below 1400px the Required-by and Stage columns drop out (both are in the drawer),
  // so Status and the row action stay on screen on laptops and tablets.
  const COLS = { "--cols": "minmax(220px,2fr) 140px 100px 120px 128px 72px", "--cols-xl": "minmax(240px,2.2fr) 140px 100px 120px 110px 160px 120px 72px" };
  const COLS_CLS = "[grid-template-columns:var(--cols)] min-[1400px]:[grid-template-columns:var(--cols-xl)]";
  const current = openId && byId.get(openId);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-3.5 text-[13px] text-[#17171c]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[3px]">
          <h2 className="m-0 text-[21px] font-semibold tracking-[-.01em]">Approvals</h2>
          <div className="text-[12.5px] text-[#6b6b76]">
            {isSuper ? "Purchase requests that need a Super Admin decision" : `${user.role === "admin" ? "Admin" : "IT"} team purchase requests and their decisions`} ·{" "}
            {new Date(now).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { exportRows(list.map((a) => a.row)); toast.success(`Exported ${list.length} request${list.length === 1 ? "" : "s"}`); }} className="rounded-[9px] border border-[#e0dfdb] bg-white px-3 py-2 text-[12.5px] text-[#17171c]">Export</button>
          {!isSuper && <RaiseRequest user={user} onCreated={() => load(true)} />}
        </div>
      </header>

      <section className="flex flex-wrap gap-2">
        {kpis.map(([l, v, s, c]) => (
          <div key={l} className="flex min-w-0 flex-[1_1_160px] flex-col gap-1 rounded-[11px] border border-[#e8e7e3] bg-white px-[15px] py-[13px]">
            <span className="text-[11.5px] text-[#6b6b76]">{l}</span>
            <span className="text-[22px] font-semibold tracking-[-.02em]" style={{ color: c }}>{v}</span>
            <span className="text-[11.5px] leading-[1.35] text-[#8a8a93]">{s}</span>
          </div>
        ))}
      </section>

      {isSuper && oldestBlock && (
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 rounded-xl border border-[#f1d3d0] bg-white px-4 py-3">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <span className="mt-[5px] h-2 w-2 flex-none rounded-full bg-[#b42318]" />
            <span className="leading-normal text-[#3b3b44]">
              <strong className="font-semibold text-[#17171c]">
                {blockers.length === 1 ? "An open ticket waiting on you is past its SLA." : `${blockers.length} open tickets waiting on you are past their SLA.`}
              </strong>{" "}
              The {oldestBlock.ticket.title || "oldest"} request has blocked {oldestBlock.ticket.human_id} for {oldestBlock.wait} day{oldestBlock.wait === 1 ? "" : "s"}.
            </span>
          </div>
          <button onClick={() => setOpenId(oldestBlock.row.id)} className="shrink-0 whitespace-nowrap rounded-lg border border-[#e0dfdb] bg-white px-3 py-[7px] text-[12.5px]">Review request</button>
        </div>
      )}
      {needReply && (
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 rounded-xl border border-[#d6e2f5] bg-white px-4 py-3">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <span className="mt-[5px] h-2 w-2 flex-none rounded-full bg-[#2f6bd0]" />
            <span className="leading-normal text-[#3b3b44]">
              <strong className="font-semibold text-[#17171c]">Super Admin asked for more information on {needReply.ticket.title || needReply.row.human_id}.</strong>{" "}
              {needReply.row.decision_remarks ? `“${needReply.row.decision_remarks}”` : "Reply and resubmit to get a decision."}
            </span>
          </div>
          <button onClick={() => setOpenId(needReply.row.id)} className="shrink-0 whitespace-nowrap rounded-lg border border-[#e0dfdb] bg-white px-3 py-[7px] text-[12.5px]">Reply</button>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-[#e8e7e3] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <div className="flex max-w-full gap-0.5 overflow-x-auto rounded-[9px] bg-[#efeeea] p-[3px]">
              {[["all", "All"], ["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"]].map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={`shrink-0 whitespace-nowrap rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium ${segCls(tab === k)}`}>{l} · {counts[k]}</button>
              ))}
            </div>
            {isSuper && (
              <div className="flex gap-0.5 rounded-[9px] bg-[#efeeea] p-[3px]">
                {[["all", "Both desks"], ["IT", "IT"], ["Admin", "Admin"]].map(([k, l]) => (
                  <button key={k} onClick={() => setDesk(k)} className={`rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium ${segCls(desk === k)}`}>{l}</button>
                ))}
              </div>
            )}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, vendor, person…" className="w-[240px] max-w-full rounded-lg border border-[#e0dfdb] bg-white px-[11px] py-[7px] text-[12.5px] text-[#17171c] outline-none" />
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[820px] min-[1400px]:min-w-[1040px]">
            <div className={`grid gap-3.5 border-y border-[#efeeea] bg-[#f7f6f3] px-4 py-[9px] text-[11.5px] text-[#6b6b76] ${COLS_CLS}`} style={COLS}>
              <span>Request</span><span>Requested by</span><span className="text-right">Amount</span><span>Waiting</span><span className="hidden min-[1400px]:block">Required by</span><span className="hidden min-[1400px]:block">Stage</span><span>Status</span><span />
            </div>
            {list.map((a) => {
              const r = a.row;
              const [color, soft] = DESK[a.ticket.department] || DESK.IT;
              const [stBg, stFg] = STATUS_TONE[r.status] || STATUS_TONE.Pending;
              const st = stageOf(a, isSuper);
              const took = (decidedAt(r) - new Date(r.created_at)) / DAY_MS;
              const flag = a.open && a.blocking ? (oldestBlock && oldestBlock.row.id === r.id ? "Blocks oldest ticket" : "Blocks overdue ticket") : "";
              return (
                <div key={r.id} onClick={() => setOpenId(r.id)} className={`grid cursor-pointer items-center gap-3.5 border-b border-[#f1f0ec] px-4 py-3 hover:bg-[#fbfaf8] ${a.open && a.wait > 7 ? "bg-[#fffdfa]" : "bg-white"} ${COLS_CLS}`} style={COLS}>
                  <div className="flex min-w-0 flex-col gap-[3px]">
                    <div className="flex min-w-0 items-center gap-[7px]">
                      <span className="truncate font-semibold">{a.ticket.title || "Approval request"}</span>
                      {flag && <span className="whitespace-nowrap rounded bg-[#fdeaea] px-1.5 py-px text-[10.5px] font-semibold text-[#b42318]">{flag}</span>}
                    </div>
                    <span className="truncate text-[11.5px] text-[#8a8a93]"><span className="font-mono">{r.human_id}</span> · {a.ticket.category || "No category"} · {r.vendor || "No vendor"}</span>
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full text-[10px] font-semibold" style={{ background: soft, color }}>{initials(a.by)}</span>
                    <div className="flex min-w-0 flex-col leading-[1.3]"><span className="truncate">{a.by}</span><span className="text-[11px] text-[#8a8a93]">{a.ticket.department || "—"} · {dayMonth(r.created_at)}</span></div>
                  </div>
                  <span className="text-right font-semibold tabular-nums">{inr(r.requested_amount)}{r.status === "Partially Approved" && r.approved_amount != null ? <span className="block text-[11px] font-normal text-[#12795a]">{inr(r.approved_amount)} approved</span> : null}</span>
                  <div className="flex flex-col gap-1">
                    <span className="text-[12.5px] font-semibold" style={{ color: a.open ? (a.wait > 7 ? RED : a.wait > 2 ? AMB : "#55555e") : "#9a9894" }}>
                      {a.open ? `${a.wait} day${a.wait === 1 ? "" : "s"}` : took < 1 ? "Decided same day" : `Decided in ${Math.round(took)}d`}
                    </span>
                    <div className="h-[5px] overflow-hidden rounded-[3px] bg-[#f1f0ec]"><div className="h-full" style={{ width: `${Math.min(100, ((a.open ? a.wait : took) / 30) * 100)}%`, background: a.open ? (a.wait > 7 ? RED : a.wait > 2 ? "#e0b44a" : "#9a9894") : "#9a9894" }} /></div>
                  </div>
                  <div className="hidden flex-col leading-[1.3] min-[1400px]:flex">
                    <span>{a.req ? dayMonth(a.req) : "—"}</span>
                    <span className="text-[11px]" style={{ color: RED }}>{a.open && a.reqLate ? `${a.reqLate} days late` : a.open && !a.req ? <span className="text-[#8a8a93]">not set</span> : ""}</span>
                  </div>
                  <div className="hidden flex-col gap-[5px] min-[1400px]:flex">
                    <div className="flex gap-[3px]">{st.steps.map((c, i) => <span key={i} className="h-[5px] flex-1 rounded-[3px]" style={{ background: c }} />)}</div>
                    <span className="text-[11.5px] text-[#55555e]">{st.text}</span>
                  </div>
                  <span><span className="whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11.5px] font-semibold" style={{ background: stBg, color: stFg }}>{r.status === "Pending" ? `Pending · ${a.wait}d` : STATUS_LABEL[r.status] || r.status}</span></span>
                  <button onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }} className="rounded-[7px] border border-[#e0dfdb] bg-white px-2.5 py-[5px] text-xs">
                    {isSuper && a.open && r.status !== "Clarification" ? "Review" : !isSuper && r.status === "Clarification" ? "Reply" : "View"}
                  </button>
                </div>
              );
            })}
            {!list.length && (
              <div className="p-7 text-center text-[#6b6b76]">
                {tab === "pending" ? (isSuper ? "Inbox clear — nothing waiting on you." : "Nothing pending — raise a request when you need a purchase approved.") : rows.length ? "No requests match." : "No approval requests yet."}
              </div>
            )}
          </div>
        </div>
      </section>

      {current && <ApprovalDrawer a={current} user={user} isSuper={isSuper} usualDays={usualDays} onClose={() => setOpenId(null)} onChanged={() => load(true)} onOpenTicket={onOpenTicket} />}
    </div>
  );
}

function ApprovalDrawer({ a, user, isSuper, usualDays, onClose, onChanged, onOpenTicket }) {
  const r = a.row;
  const ticket = a.ticket;
  const [dtab, setDtab] = useState("overview");
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState("");
  const [noteErr, setNoteErr] = useState(false);
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState(String(r.requested_amount || ""));
  const [comment, setComment] = useState("");
  const [vis, setVis] = useState("public");
  const [busy, setBusy] = useState(false);
  const loadDetail = useCallback(() => {
    if (!r.ticket_id) return setDetail({ history: [], comments: [] });
    api(`/tickets/${r.ticket_id}`).then(setDetail).catch(() => setDetail({ history: [], comments: [] }));
  }, [r.ticket_id]);
  useEffect(() => {
    setDtab("overview");
    setNote("");
    setNoteErr(false);
    setPartial(false);
    setAmount(String(r.requested_amount || ""));
    loadDetail();
  }, [r.id, loadDetail, r.requested_amount]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const t = { ...ticket, ...(detail || {}) };
  const first = a.by.split(" ")[0];
  const [stBg, stFg] = STATUS_TONE[r.status] || STATUS_TONE.Pending;
  const high = ["High", "Critical"].includes(ticket.priority);
  const amtN = parseInt(String(amount).replace(/[^\d]/g, ""), 10);
  const dec = decisionEntry(r);
  const finance = (r.approved_amount ?? r.requested_amount ?? 0) > FINANCE_LIMIT;

  const decide = async (decision) => {
    const remarks = note.trim();
    if (["reject", "clarify"].includes(decision) && !remarks) {
      setNoteErr(true);
      return toast.error(`Add a note so ${first} knows why`);
    }
    let body = { decision, remarks };
    if (decision === "approve" && partial) {
      if (!amtN || amtN <= 0 || amtN > (r.requested_amount || 0)) return toast.error(`Enter an amount up to ${inr(r.requested_amount)}`);
      if (amtN < (r.requested_amount || 0)) {
        if (!remarks) {
          setNoteErr(true);
          return toast.error(`Add a note so ${first} knows why less was approved`);
        }
        body = { decision: "partial", remarks, approved_amount: amtN };
      }
    }
    setBusy(true);
    try {
      await api(`/tickets/${r.ticket_id}/approval/decision`, { method: "POST", body });
      toast.success(
        body.decision === "approve" ? `Approved ${r.human_id}${finance ? " · sent to Finance for sign-off" : ""}`
          : body.decision === "partial" ? `Approved ${inr(amtN)} of ${inr(r.requested_amount)}`
            : body.decision === "reject" ? `Rejected ${r.human_id} · ${first} notified`
              : `Asked ${first} for more info`,
      );
      setNote("");
      setDtab("activity");
      onChanged();
      loadDetail();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  // Requester side: answer a request for information by resubmitting with
  // the reply as the new justification. Every other field is sent back
  // unchanged because resubmitting replaces them.
  const resubmit = async () => {
    const reply = note.trim();
    if (!reply) {
      setNoteErr(true);
      return toast.error("Add your reply before resubmitting");
    }
    setBusy(true);
    try {
      await api(`/tickets/${r.ticket_id}/approval/submit`, {
        method: "POST",
        body: {
          justification: reply,
          requested_amount: r.requested_amount || 0,
          vendor: r.vendor || "",
          quotation: r.quotation || "",
          alternatives: r.alternatives || "",
          recommendation: r.recommendation || "",
          required_by: r.required_by || null,
          risk: r.risk || "",
          attachment_ids: [],
        },
      });
      toast.success(`${r.human_id} resubmitted to Super Admin`);
      setNote("");
      onChanged();
      loadDetail();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const addComment = async () => {
    const body = comment.trim();
    if (!body || !r.ticket_id) return;
    setBusy(true);
    try {
      await api(`/tickets/${r.ticket_id}/comments`, { method: "POST", body: { body, type: vis } });
      toast.success(vis === "internal" ? "Internal note added" : "Comment added");
      setComment("");
      loadDetail();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  // Activity: approval history + ticket comments, oldest first.
  const events = [
    ...(r.history || []).map((h) => ({
      at: h.at, who: h.by || "System", what: DECISION_VERB[h.action] || h.action,
      body: [h.approved_amount != null ? inr(h.approved_amount) : "", h.remarks || ""].filter(Boolean).join(" · "),
      kind: ["approve", "partial", "reject"].includes(h.action) ? "decision" : ["submitted", "resubmitted"].includes(h.action) ? "appr" : "note",
    })),
    ...((detail?.comments || []).map((c) => ({ at: c.created_at, who: c.author_name || "Someone", what: c.type === "internal" ? "added an internal note" : "commented", body: c.body, kind: c.type }))),
    ...(ticket.created_at ? [{ at: ticket.created_at, who: ticket.raised_by_name || "Requester", what: `raised ${ticket.human_id}${ticket.assignee_name ? ` · assigned to ${ticket.assignee_name}` : ""}`, body: "", kind: "note" }] : []),
  ].sort((x, y) => new Date(x.at) - new Date(y.at));

  const respDue = t.sla_response_due ? new Date(t.sla_response_due) : null;
  const respAt = t.acknowledged_at || t.first_response_at;
  const resp = respAt ? (respDue && new Date(respAt) > respDue ? `Missed · ${span(new Date(respAt) - new Date(t.raised_at || t.created_at))}` : `Met · ${span(new Date(respAt) - new Date(t.raised_at || t.created_at))}`) : "Not responded yet";
  const resolvedAt = t.resolved_at || t.resolution?.resolved_date;
  const res = t.sla_paused_at ? "Paused while waiting" : resolvedAt ? (t.sla_resolution_due && new Date(resolvedAt) > new Date(t.sla_resolution_due) ? "Resolved late" : "Resolved on time") : t.sla_resolution_due ? slaRemaining(t.sla_resolution_due).text : "No SLA";
  const resBad = !t.sla_paused_at && !resolvedAt && t.sla_resolution_due && new Date(t.sla_resolution_due) < Date.now();
  const life = [
    ["Raised", t.raised_at || t.created_at],
    ["Acknowledged", respAt],
    ["Work started", t.work_started_at],
    ["Resolved", resolvedAt],
    ["Closed", t.closed_at],
  ];
  const facts = [
    { l: "Amount", v: inr(r.requested_amount), s: r.status === "Partially Approved" && r.approved_amount != null ? `${inr(r.approved_amount)} approved` : `${a.quotes} document${a.quotes === 1 ? "" : "s"}`, c: "#17171c", sc: r.status === "Partially Approved" ? GRN : "#8a8a93" },
    a.open
      ? { l: "Waiting", v: `${a.wait} day${a.wait === 1 ? "" : "s"}`, s: usualDays != null ? `usual ${usualDays} day${usualDays === 1 ? "" : "s"}` : "since submitted", c: a.wait > 7 ? RED : a.wait > 2 ? AMB : "#17171c", sc: "#8a8a93" }
      : { l: "Decided", v: dayMonth(decidedAt(r)), s: `by ${dec?.by || r.decided_by || "Super Admin"}`, c: "#17171c", sc: "#8a8a93" },
    { l: "Required by", v: a.req ? dayMonth(a.req) : "Not set", s: a.reqLate && a.open ? `${a.reqLate} days late` : a.req ? "requester's deadline" : "no deadline given", c: a.req ? "#17171c" : "#8a8a93", sc: a.reqLate && a.open ? RED : "#8a8a93" },
    { l: "Ticket SLA", v: t.sla_paused_at ? "Paused" : resolvedAt ? "Resolved" : resBad ? "Overdue" : t.sla_resolution_due ? "On track" : "—", s: t.sla_paused_at ? "while waiting" : resBad ? slaRemaining(t.sla_resolution_due).text.replace("Overdue ", "") : t.sla_resolution_due && !resolvedAt ? `${slaRemaining(t.sla_resolution_due).text} left` : "", c: resBad ? RED : "#17171c", sc: resBad ? RED : "#8a8a93" },
  ];
  const chain = [
    { l: "Requested", s: `${a.by} · ${dayMonth(r.created_at)}`, bar: GRN, sc: "#8a8a93", fw: 500 },
    {
      l: "Super Admin",
      s: a.open ? (r.status === "Clarification" ? "Waiting on requester" : `${isSuper ? "You" : "Pending"} · ${a.wait} day${a.wait === 1 ? "" : "s"}`) : `${dec?.by || r.decided_by || "Super Admin"} · ${(STATUS_LABEL[r.status] || r.status).toLowerCase()}`,
      bar: a.open ? (r.status === "Clarification" ? "#6f9ce6" : MAG) : r.status === "Rejected" ? RED : GRN,
      sc: a.open ? "#8a0f61" : "#8a8a93", fw: 600,
    },
    { l: "Finance sign-off", s: r.status === "Rejected" ? "Not needed" : finance ? `Required above ${inr(FINANCE_LIMIT)}` : "Not required", bar: isApproved(r.status) && finance ? "#e0b44a" : isApproved(r.status) ? GRN : "#e3e1dc", sc: "#8a8a93", fw: 500 },
    { l: "Work resumes", s: isApproved(r.status) ? `${ticket.human_id || "Ticket"} unlocked` : r.status === "Rejected" ? "Ticket continues without purchase" : "After approval", bar: isApproved(r.status) ? GRN : "#e3e1dc", sc: "#8a8a93", fw: 500 },
  ];
  const peopleOnTicket = ticket.assignee_name ? `Assigned to ${ticket.assignee_name}` : "Unallocated";
  const canDecide = isSuper && a.open;
  const canReply = !isSuper && r.status === "Clarification";

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-[rgba(23,23,28,.3)]" />
      <aside role="dialog" aria-label={`Approval ${r.human_id}`} className="fixed bottom-0 right-0 top-0 z-[41] flex w-[min(620px,100vw)] flex-col bg-white text-[13px] text-[#17171c] shadow-[-12px_0_40px_rgba(0,0,0,.14)]">
        <div className="flex flex-col gap-2.5 border-b border-[#efeeea] px-[22px] pb-3.5 pt-[18px]">
          <div className="flex items-start justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-[#e0dfdb] px-2 py-[3px] font-mono text-[11.5px]">{r.human_id}</span>
              <span className="rounded-md border border-[#e0dfdb] px-2 py-[3px] text-[11.5px]">{ticket.department || "—"}</span>
              {ticket.priority && <span className="rounded-md px-2 py-[3px] text-[11.5px] font-semibold" style={high ? { background: "#e0822f", color: "#fff" } : { background: "#fdf3dc", color: AMB }}>{ticket.priority}</span>}
              <span className="rounded-full px-[9px] py-[3px] text-[11.5px] font-semibold" style={{ background: stBg, color: stFg }}>{STATUS_LABEL[r.status] || r.status}</span>
            </div>
            <button onClick={onClose} aria-label="Close" className="h-[30px] w-[30px] flex-none rounded-lg border border-[#e0dfdb] bg-white text-sm text-[#55555e]">✕</button>
          </div>
          <div className="flex flex-col gap-[3px]">
            <span className="text-lg font-semibold leading-[1.3] tracking-[-.01em]">{ticket.title || "Approval request"}</span>
            <span className="text-[#6b6b76]">
              {ticket.category || "No category"} · {ticket.location || "No location"}
              {ticket.human_id && <> · ticket <button onClick={() => { onClose(); onOpenTicket?.(r.ticket_id); }} className="bg-transparent font-mono text-xs text-[#b3177f] hover:underline">{ticket.human_id}</button></>}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {facts.map((f) => (
              <div key={f.l} className="flex min-w-0 flex-col gap-0.5 rounded-[9px] border border-[#efeeea] px-2.5 py-2">
                <span className="text-[10.5px] uppercase tracking-[.04em] text-[#6b6b76]">{f.l}</span>
                <span className="truncate text-sm font-semibold" style={{ color: f.c }}>{f.v}</span>
                <span className="truncate text-[11px]" style={{ color: f.sc }}>{f.s}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-0.5 rounded-[9px] bg-[#efeeea] p-[3px]">
            {[["overview", "Overview"], ["activity", `Activity · ${events.length}`]].map(([k, l]) => (
              <button key={k} onClick={() => setDtab(k)} className={`flex-1 rounded-[7px] px-2.5 py-[7px] text-[12.5px] font-medium ${segCls(dtab === k)}`}>{l}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-auto px-[22px] py-4">
          {dtab === "overview" ? (
            <>
              <div className="flex flex-col gap-2">
                <span className="font-semibold">{a.open ? "Things to check before deciding" : "Checks"}</span>
                {a.checks.map(([ok, text]) => (
                  <div key={text} className="flex items-start gap-[9px] leading-[1.45]">
                    <span className="mt-px grid h-[17px] w-[17px] flex-none place-items-center rounded-full text-[10px] font-bold" style={ok ? { background: "#e4f3ec", color: GRN } : { background: "#fdeaea", color: RED }}>{ok ? "✓" : "!"}</span>
                    <span className="text-[#3b3b44]">{text}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 rounded-[11px] border border-[#efeeea] p-3.5">
                <span className="font-semibold">The request</span>
                {r.justification && <span className="rounded-lg bg-[#f7f6f3] px-[11px] py-[9px] leading-normal text-[#3b3b44]">“{r.justification}”</span>}
                <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
                  <div className="flex flex-col gap-0.5"><span className="text-[11.5px] text-[#6b6b76]">Vendor</span><span className="font-medium">{r.vendor || "Not specified"}</span><span className="text-[11.5px] text-[#8a8a93]">{r.vendor ? (a.pastOrders ? `${a.pastOrders} past approved order${a.pastOrders === 1 ? "" : "s"}` : "New vendor · no past orders") : "—"}</span></div>
                  <div className="flex flex-col gap-0.5"><span className="text-[11.5px] text-[#6b6b76]">Breakdown</span><span className="font-medium">{r.quotation || ticket.category || "—"}</span><span className="text-[11.5px] text-[#8a8a93]">{a.quotes} document{a.quotes === 1 ? "" : "s"} attached</span></div>
                  <div className="flex flex-col gap-0.5"><span className="text-[11.5px] text-[#6b6b76]">Requested by</span><span className="font-medium">{a.by}</span><span className="text-[11.5px] text-[#8a8a93]">{ticket.department || "—"} team · {stamp(r.created_at)}</span></div>
                  <div className="flex flex-col gap-0.5"><span className="text-[11.5px] text-[#6b6b76]">On the ticket</span><span className="font-medium">{peopleOnTicket}</span>{ticket.raised_by_name && ticket.raised_by_name === ticket.assignee_name && <span className="text-[11.5px] text-[#8a5a00]">Raised, owned and assigned by one person</span>}</div>
                  {r.alternatives && <div className="flex flex-col gap-0.5 sm:col-span-2"><span className="text-[11.5px] text-[#6b6b76]">Alternatives considered</span><span>{r.alternatives}</span></div>}
                  {r.risk && <div className="flex flex-col gap-0.5 sm:col-span-2"><span className="text-[11.5px] text-[#6b6b76]">Risk if not approved</span><span>{r.risk}</span></div>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] text-[#6b6b76]">Documents · {a.quotes}</span>
                  {(r.attachments || []).map((f) => (
                    <div key={f.id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[9px] border border-[#efeeea] px-2.5 py-2">
                      <span className="grid h-8 w-8 place-items-center rounded-[7px] bg-[#fdeaea] text-[9.5px] font-bold text-[#b42318]">{(f.name?.split(".").pop() || "FILE").slice(0, 4).toUpperCase()}</span>
                      <div className="flex min-w-0 flex-col"><span className="truncate font-medium">{f.name}</span><span className="text-[11.5px] text-[#8a8a93]">{f.size ? `${Math.max(1, Math.round(f.size / 1024))} KB` : "—"} · {f.uploaded_by_name || a.by}</span></div>
                      <a href={f.url} target="_blank" rel="noreferrer" className="rounded-[7px] border border-[#e0dfdb] bg-white px-2.5 py-[5px] text-xs text-[#17171c] no-underline">Open</a>
                    </div>
                  ))}
                  {!a.quotes && <span className="text-xs text-[#9a9aa3]">No documents attached.</span>}
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-[11px] border border-[#efeeea] p-3.5">
                <span className="font-semibold">Approval chain</span>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {chain.map((s) => (
                    <div key={s.l} className="flex min-w-0 flex-col gap-1.5">
                      <span className="h-[5px] rounded-[3px]" style={{ background: s.bar }} />
                      <span className="text-[12.5px]" style={{ fontWeight: s.fw }}>{s.l}</span>
                      <span className="text-[11px] leading-[1.35]" style={{ color: s.sc }}>{s.s}</span>
                    </div>
                  ))}
                </div>
              </div>

              {ticket.human_id && (
                <div className="flex flex-col gap-3 rounded-[11px] border border-[#efeeea] p-3.5">
                  <div className="flex flex-wrap justify-between gap-2.5"><span className="font-semibold">Linked ticket · {ticket.human_id}</span><span className="text-[11.5px] text-[#6b6b76]">Status · {t.status}</span></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-0.5 rounded-lg bg-[#f7f6f3] px-[11px] py-[9px]"><span className="text-[11px] text-[#6b6b76]">Response{respDue ? ` · due ${stamp(respDue)}` : ""}</span><span className="font-semibold" style={{ color: resp.startsWith("Met") ? GRN : resp.startsWith("Missed") ? RED : "#55555e" }}>{resp}</span></div>
                    <div className={`flex flex-col gap-0.5 rounded-lg px-[11px] py-[9px] ${resBad ? "bg-[#fdf5f4]" : "bg-[#f7f6f3]"}`}><span className="text-[11px] text-[#6b6b76]">Resolution{t.sla_resolution_due ? ` · due ${stamp(t.sla_resolution_due)}` : ""}</span><span className="font-semibold" style={{ color: resBad ? RED : "#17171c" }}>{res}</span></div>
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {life.map(([l, at], i) => (
                      <div key={l} className="flex min-w-0 flex-col gap-[5px]">
                        <div className="flex items-center gap-1"><span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: at ? GRN : "#e3e1dc" }} /><span className="h-0.5 flex-1" style={{ background: i < life.length - 1 ? (at && life[i + 1][1] ? GRN : "#e3e1dc") : "transparent" }} /></div>
                        <span className="text-xs font-medium" style={{ color: at ? "#17171c" : "#9a9aa3" }}>{l}</span>
                        <span className="text-[11px] text-[#8a8a93]">{at ? stamp(at) : "—"}</span>
                      </div>
                    ))}
                  </div>
                  {a.open && (
                    <span className="rounded-lg bg-[#fdf7e8] px-2.5 py-2 text-xs leading-normal text-[#3b3b44]">
                      {t.sla_paused_at ? "The ticket's SLA is paused while it waits for this approval." : `The ticket's SLA keeps running while it waits for approval, so the delay counts against ${ticket.department || "the team"}.${isSuper ? " You can pause SLA during approval in Settings → SLA & hours." : ""}`}
                    </span>
                  )}
                  {t.asset_serial_number && <span className="text-xs text-[#55555e]">Requester's laptop: <span className="font-mono">{t.asset_serial_number}</span></span>}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-col">
                {detail === null && <span className="text-xs text-[#9a9aa3]">Loading activity…</span>}
                {events.map((e, i) => {
                  const tone = e.kind === "appr" ? ["#fbe9f4", "#8a0f61"] : e.kind === "decision" ? ["#e4f3ec", GRN] : e.who === "System" ? ["#f1f0ec", "#55555e"] : ["#e8f0fc", "#1d4f9e"];
                  const isComment = e.kind === "public" || e.kind === "internal";
                  return (
                    <div key={`${e.at}-${i}`} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                      <div className="flex flex-col items-center"><span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full text-[9.5px] font-bold" style={{ background: tone[0], color: tone[1] }}>{initials(e.who)}</span>{i < events.length - 1 && <span className="min-h-3.5 w-0.5 flex-1 bg-[#efeeea]" />}</div>
                      <div className="flex min-w-0 flex-col gap-1 pb-3.5">
                        <div className="flex flex-wrap items-baseline gap-1.5"><span className="font-semibold">{e.who}</span><span className="text-[#55555e]">{e.what}</span><span className="text-[11.5px] text-[#9a9aa3]">· {stamp(e.at)}</span></div>
                        {e.body && (isComment
                          ? <span className="rounded-[9px] border px-[11px] py-2 leading-normal text-[#17171c]" style={e.kind === "internal" ? { background: "#fdf7e8", borderColor: "#f1e2b8" } : { background: "#f7f6f3", borderColor: "#efeeea" }}>{e.body}</span>
                          : <span className="text-[12.5px] text-[#6b6b76]">{e.body}</span>)}
                      </div>
                    </div>
                  );
                })}
              </div>
              {r.ticket_id && (
                <div className="flex flex-col gap-2.5 rounded-[11px] border border-[#e8e7e3] p-3">
                  <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Write a comment…" className="resize-y border-0 bg-transparent text-[13px] text-[#17171c] outline-none" />
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex gap-0.5 rounded-[7px] bg-[#efeeea] p-0.5">
                      {[["public", "Public — visible to requester"], ["internal", "Internal note"]].map(([k, l]) => (
                        <button key={k} onClick={() => setVis(k)} className={`rounded-[5px] px-2.5 py-[5px] text-xs font-medium ${segCls(vis === k)}`}>{l}</button>
                      ))}
                    </div>
                    <button onClick={addComment} disabled={!comment.trim() || busy} className="rounded-lg px-3.5 py-[7px] text-[12.5px] font-medium text-white" style={{ background: comment.trim() ? MAG : "#e7b6d6", cursor: comment.trim() ? "pointer" : "default" }}>Add comment</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {canDecide && (
          <div className="flex flex-col gap-2.5 border-t border-[#efeeea] bg-[#fbfaf8] px-[22px] py-3.5">
            {partial && (
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[#55555e]">Approve amount</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" className="w-[150px] rounded-lg border border-[#e0dfdb] px-2.5 py-[7px] text-[13px] tabular-nums outline-none" />
                <span className="text-xs text-[#8a8a93]">of {inr(r.requested_amount)} requested</span>
              </div>
            )}
            <textarea
              value={note}
              onChange={(e) => { setNote(e.target.value); setNoteErr(false); }}
              rows={2}
              placeholder={`Note to ${first} (required to reject, ask for info or approve less)`}
              className="resize-y rounded-lg bg-white px-2.5 py-2 text-[12.5px] text-[#17171c] outline-none"
              style={{ border: `1px solid ${noteErr ? "#e3a29b" : "#e0dfdb"}` }}
            />
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => decide("approve")} className="flex-[1_1_180px] rounded-[9px] bg-[#12795a] px-3 py-2.5 text-[13px] font-medium text-white hover:bg-[#0e6149] disabled:opacity-60">
                {partial && amtN && amtN < (r.requested_amount || 0) ? `Approve ${inr(amtN)}` : `Approve ${inr(r.requested_amount)}`}
              </button>
              <button disabled={busy} onClick={() => setPartial(!partial)} className="rounded-[9px] border border-[#e0dfdb] bg-white px-3 py-2.5 text-[13px]">{partial ? "Full amount" : "Approve less"}</button>
              <button disabled={busy || r.status === "Clarification"} title={r.status === "Clarification" ? "Already waiting on the requester" : undefined} onClick={() => decide("clarify")} className="rounded-[9px] border border-[#e0dfdb] bg-white px-3 py-2.5 text-[13px] disabled:opacity-50">Ask for info</button>
              <button disabled={busy} onClick={() => decide("reject")} className="rounded-[9px] border border-[#f1d3d0] bg-white px-3 py-2.5 text-[13px] text-[#b42318] disabled:opacity-60">Reject</button>
            </div>
            <span className="text-[11.5px] text-[#8a8a93]">Approving {finance ? "sends it to Finance and " : ""}unlocks {ticket.human_id || "the ticket"} so the team can start work.</span>
          </div>
        )}
        {canReply && (
          <div className="flex flex-col gap-2.5 border-t border-[#efeeea] bg-[#f5f8fd] px-[22px] py-3.5">
            {r.decision_remarks && <span className="leading-[1.45] text-[#1d4f9e]"><strong className="font-semibold">Super Admin asked:</strong> “{r.decision_remarks}”</span>}
            <textarea value={note} onChange={(e) => { setNote(e.target.value); setNoteErr(false); }} rows={3} placeholder="Your answer — it replaces the justification and goes back to Super Admin" className="resize-y rounded-lg bg-white px-2.5 py-2 text-[12.5px] text-[#17171c] outline-none" style={{ border: `1px solid ${noteErr ? "#e3a29b" : "#e0dfdb"}` }} />
            <div className="flex justify-end"><button disabled={busy} onClick={resubmit} className="rounded-[9px] bg-[#17171c] px-4 py-2.5 text-[13px] font-medium text-white disabled:opacity-60">Reply & resubmit</button></div>
          </div>
        )}
        {!a.open && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[#efeeea] px-[22px] py-3.5" style={{ background: r.status === "Rejected" ? "#fdf5f4" : "#f1f8f4" }}>
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold" style={{ color: r.status === "Rejected" ? RED : "#0f5c45" }}>
                {r.status === "Rejected" ? "✕ Rejected" : r.status === "Partially Approved" ? `✓ Approved ${inr(r.approved_amount)} of ${inr(r.requested_amount)}` : `✓ Approved ${inr(r.requested_amount)}`}
              </span>
              <span className="text-xs text-[#3b3b44]">
                {dec?.by || r.decided_by || "Super Admin"} · {dayMonth(decidedAt(r))}
                {r.decision_remarks ? ` · “${r.decision_remarks}”` : ""}
                {isApproved(r.status) ? ` · ${finance ? "sent to Finance · " : ""}${ticket.human_id || "ticket"} unlocked` : ""}
              </span>
            </div>
          </div>
        )}
        {a.open && !isSuper && !canReply && (
          <div className="border-t border-[#efeeea] bg-[#fbfaf8] px-[22px] py-3 text-xs text-[#6b6b76]">
            {r.status === "On Hold" ? "Super Admin put this on hold." : "Waiting on Super Admin's decision."} Add a public comment in Activity if something changes.
          </div>
        )}
      </aside>
    </>
  );
}

export default function ApprovalsView({ user, onOpenTicket, onChanged }) {
  const [rows, setRows] = useState(null);
  // `changed` is true after a decision so the nav badge refreshes too.
  const load = useCallback(
    (changed) =>
      api("/approvals")
        .then((result) => {
          setRows(result);
          if (changed === true) onChanged?.();
        })
        .catch((error) => {
          setRows((prev) => prev || []);
          toast.error(error.message);
        }),
    [onChanged],
  );
  useEffect(() => {
    load();
    const timer = setInterval(() => load(), 60000);
    return () => clearInterval(timer);
  }, []);
  if (!rows) return <div className="mx-auto h-[60vh] max-w-[1400px] animate-pulse rounded-xl bg-[#ebeae6]" />;
  return <Inbox rows={rows} user={user} load={load} onOpenTicket={onOpenTicket} />;
}

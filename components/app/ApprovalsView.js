"use client";

import { useEffect, useMemo, useState } from "react";
import { api, PRIORITIES } from "@/lib/appapi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import AttachmentUpload from "@/components/app/AttachmentUpload";
import { Check, Download, FileCheck2, Plus, X } from "lucide-react";
import { toast } from "sonner";

const pending = (status) =>
  ["Pending", "On Hold", "Clarification"].includes(status);
const money = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
const initials = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const age = (date) => {
  const hours = Math.max(
    0,
    Math.floor((Date.now() - new Date(date)) / 3600000),
  );
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};
const statusTone = (status) =>
  status === "Approved" || status === "Partially Approved"
    ? "bg-green-100 text-green-800"
    : status === "Rejected"
      ? "bg-red-100 text-red-800"
      : "bg-amber-100 text-amber-800";

function exportRows(rows) {
  const csv = [
    ["ID", "Department", "Request", "Amount", "Required by", "Status"],
    ...rows.map((row) => [
      row.human_id,
      row.ticket?.department,
      row.ticket?.title,
      row.requested_amount,
      row.required_by || "",
      row.status,
    ]),
  ]
    .map((line) =>
      line
        .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "approvals.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

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
        <Button className="bg-[#1B7F6E] hover:bg-[#14695B]">
          <Plus className="h-4 w-4" />
          Raise request
        </Button>
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
              <Input
                className="mt-1"
                type="date"
                value={form.required_by}
                onChange={(event) =>
                  setForm({ ...form, required_by: event.target.value })
                }
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

function AgentApprovals({ rows, user, load, onOpenTicket }) {
  const [filter, setFilter] = useState("All");
  const visible = rows.filter(
    (row) =>
      filter === "All" ||
      (filter === "Pending"
        ? pending(row.status)
        : row.status.includes(filter)),
  );
  const approved = rows.filter((row) => row.status.includes("Approved"));
  const cards = [
    [
      "Pending",
      rows.filter((row) => pending(row.status)).length,
      "text-[#E8930C]",
    ],
    ["Approved", approved.length, "text-[#1E9E6A]"],
    [
      "Rejected",
      rows.filter((row) => row.status === "Rejected").length,
      "text-[#DC3D3D]",
    ],
    [
      "Approved value",
      money(
        approved.reduce(
          (sum, row) =>
            sum + (row.approved_amount ?? row.requested_amount ?? 0),
          0,
        ),
      ),
      "text-[#111827]",
    ],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {cards.map(([label, value, tone]) => (
          <Card key={label} className="border-[#E5E9EF] p-4 shadow-none">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              {label}
            </p>
            <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
            <p className="text-xs text-[#9CA3AF]">this month</p>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex max-w-full overflow-x-auto rounded-lg bg-[#EDF0F4] p-1">
          {["All", "Pending", "Approved", "Rejected"].map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={`rounded-md px-4 py-2 text-sm font-semibold ${filter === item ? "bg-white shadow-sm" : "text-[#4B5563]"}`}
            >
              {item} ·{" "}
              {item === "All"
                ? rows.length
                : rows.filter((row) =>
                    item === "Pending"
                      ? pending(row.status)
                      : row.status.includes(item),
                  ).length}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          className="ml-auto"
          onClick={() => exportRows(visible)}
        >
          <Download className="h-4 w-4" />
          Export
        </Button>
        <RaiseRequest user={user} onCreated={load} />
      </div>
      <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
        <div className="overflow-x-auto">
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Request</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Required by</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs text-[#9CA3AF]">
                    {row.human_id}
                  </TableCell>
                  <TableCell>
                    <p className="font-semibold">{row.ticket?.title}</p>
                    <p className="text-xs text-[#9CA3AF]">
                      {row.ticket?.category} · {row.vendor || "No vendor"} ·
                      raised{" "}
                      {new Date(row.created_at).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </p>
                  </TableCell>
                  <TableCell className="font-semibold">
                    {money(row.requested_amount)}
                  </TableCell>
                  <TableCell>
                    {row.required_by
                      ? new Date(row.required_by).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {[0, 1, 2, 3].map((step) => (
                        <span
                          key={step}
                          className={`h-2 w-2 rounded-full ${row.status === "Rejected" && step === 1 ? "bg-red-500" : row.status.includes("Approved") || step === 0 ? "bg-green-500" : step === 1 && pending(row.status) ? "bg-amber-500" : "bg-[#D9DEE5]"}`}
                        />
                      ))}
                      <span className="ml-1 text-xs text-[#9CA3AF]">
                        {row.status.includes("Approved")
                          ? "complete"
                          : row.status === "Rejected"
                            ? "stopped"
                            : "with super admin"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={statusTone(row.status)}>
                      {pending(row.status)
                        ? `Pending · ${age(row.created_at)}`
                        : row.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenTicket(row.ticket_id)}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!visible.length && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className="py-14 text-center text-[#9CA3AF]">
                      <FileCheck2 className="mx-auto mb-2 h-8 w-8" />
                      No requests yet — raise your first request
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function SuperInbox({ rows, load }) {
  const [status, setStatus] = useState("Pending");
  const [department, setDepartment] = useState("Both");
  const [notes, setNotes] = useState({});
  const visible = rows.filter(
    (row) =>
      (status === "All" ||
        (status === "Pending"
          ? pending(row.status)
          : row.status.includes(status))) &&
      (department === "Both" || row.ticket?.department === department),
  );
  const decide = async (row, decision) => {
    if (decision === "reject" && !notes[row.id]?.trim())
      return toast.error("A note is required to reject");
    try {
      await api(`/tickets/${row.ticket_id}/approval/decision`, {
        method: "POST",
        body: { decision, remarks: notes[row.id] || "" },
      });
      toast.success(
        decision === "approve" ? "Request approved" : "Request rejected",
      );
      load();
    } catch (error) {
      toast.error(error.message);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg bg-[#EDF0F4] p-1">
          {["Pending", "Approved", "Rejected", "All"].map((item) => (
            <button
              key={item}
              onClick={() => setStatus(item)}
              className={`rounded-md px-4 py-2 text-sm font-semibold ${status === item ? "bg-white shadow-sm" : "text-[#4B5563]"}`}
            >
              {item}
              {item === "Pending"
                ? ` · ${rows.filter((row) => pending(row.status)).length}`
                : ""}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg bg-[#EDF0F4] p-1">
          {["Both", "IT", "Admin"].map((item) => (
            <button
              key={item}
              onClick={() => setDepartment(item)}
              className={`rounded-md px-4 py-2 text-sm font-semibold ${department === item ? "bg-white shadow-sm" : "text-[#4B5563]"}`}
            >
              {item}
            </button>
          ))}
        </div>
        <p className="ml-auto text-sm text-[#4B5563]">
          Total pending value:{" "}
          <b>
            {money(
              visible
                .filter((row) => pending(row.status))
                .reduce((sum, row) => sum + row.requested_amount, 0),
            )}
          </b>
        </p>
      </div>
      {visible.map((row) => (
        <Card
          key={row.id}
          className={`rounded-l-none border-l-[3px] p-5 shadow-none ${row.ticket?.department === "IT" ? "border-l-[#2E7CD6]" : "border-l-[#1B7F6E]"}`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`grid h-9 w-9 place-items-center rounded-full text-xs font-semibold text-white ${row.ticket?.department === "IT" ? "bg-[#2E7CD6]" : "bg-[#1B7F6E]"}`}
            >
              {initials(row.ticket?.raised_by_name)}
            </span>
            <div className="min-w-0 flex-1 sm:min-w-64">
              <div className="flex flex-wrap items-center gap-1.5 font-bold">
                {row.ticket?.title}
                <Badge
                  className={
                    row.ticket?.department === "IT"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-green-100 text-green-800"
                  }
                >
                  {row.ticket?.department}
                </Badge>
                <Badge className="bg-amber-100 text-amber-800">
                  {row.ticket?.priority}
                </Badge>
              </div>
              <p className="text-xs text-[#9CA3AF]">
                {row.human_id} · {row.ticket?.raised_by_name} ·{" "}
                {row.vendor || "No vendor"} · required by{" "}
                {row.required_by
                  ? new Date(row.required_by).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                    })
                  : "not set"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold">{money(row.requested_amount)}</p>
              <p className="text-[11px] text-[#9CA3AF]">
                {row.requested_amount > 25000
                  ? "+ finance sign-off needed"
                  : "within your limit"}
              </p>
            </div>
          </div>
          {row.justification && (
            <p className="my-3 rounded-lg bg-[#FAFBFC] p-3 text-sm text-[#4B5563]">
              “{row.justification}”
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#9CA3AF]">
              Waiting {age(row.created_at)}
            </span>
            {pending(row.status) ? (
              <>
                <Input
                  className="h-9 w-full flex-1 sm:ml-2 sm:min-w-64"
                  placeholder="Add a note (required to reject)…"
                  value={notes[row.id] || ""}
                  onChange={(event) =>
                    setNotes({ ...notes, [row.id]: event.target.value })
                  }
                />
                <Button
                  variant="outline"
                  className="border-red-200 text-red-700"
                  onClick={() => decide(row, "reject")}
                >
                  <X className="h-4 w-4" />
                  Reject
                </Button>
                <Button
                  className="bg-[#1B7F6E] hover:bg-[#14695B]"
                  onClick={() => decide(row, "approve")}
                >
                  <Check className="h-4 w-4" />
                  Approve
                </Button>
              </>
            ) : (
              <Badge className={statusTone(row.status)}>{row.status}</Badge>
            )}
          </div>
        </Card>
      ))}
      {!visible.length && (
        <Card className="border-dashed py-14 text-center text-[#9CA3AF] shadow-none">
          No approval requests in this view.
        </Card>
      )}
    </div>
  );
}

export default function ApprovalsView({ user, onOpenTicket }) {
  const [rows, setRows] = useState([]);
  const load = () =>
    api("/approvals")
      .then(setRows)
      .catch((error) => toast.error(error.message));
  useEffect(() => {
    load();
  }, []);
  return user.role === "super_admin" ? (
    <SuperInbox rows={rows} load={load} />
  ) : (
    <AgentApprovals
      rows={rows}
      user={user}
      load={load}
      onOpenTicket={onOpenTicket}
    />
  );
}

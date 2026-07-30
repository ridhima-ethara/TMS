"use client";
import { useEffect, useState } from "react";
import {
  api,
  PRIORITY_META,
  statusClass,
  ALL_STATUSES,
  PRIORITIES,
  fmtDateTime,
  fmtDate,
  slaRemaining,
} from "@/lib/appapi";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Loader2,
  Lock,
  MessageSquare,
  Clock,
  FileCheck2,
  CheckCircle2,
  RotateCcw,
  Star,
} from "lucide-react";

function Bar({ children }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export default function TicketDrawer({
  ticketId,
  user,
  open,
  onClose,
  onChanged,
  users = [],
}) {
  const [t, setT] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [commentType, setCommentType] = useState("public");
  const isStaff = ["it", "admin", "super_admin"].includes(user.role);
  const deptUsers = users.filter((u) =>
    t?.department === "Admin" ? u.role === "admin" : u.role === "it",
  );

  const load = async () => {
    if (!ticketId) return;
    setLoading(true);
    try {
      setT(await api(`/tickets/${ticketId}`));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (open && ticketId) load();
  }, [ticketId, open]);

  const patch = async (body, msg) => {
    setBusy(true);
    try {
      await api(`/tickets/${ticketId}`, { method: "PATCH", body });
      toast.success(msg || "Updated");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await api(`/tickets/${ticketId}/comments`, {
        method: "POST",
        body: { body: comment, type: commentType },
      });
      setComment("");
      toast.success("Comment added");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto p-0">
        {loading || !t ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col">
            <SheetHeader className="p-5 border-b bg-muted/30">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="font-mono">
                  {t.human_id}
                </Badge>
                <Badge variant="outline">{t.department}</Badge>
                <Badge className={PRIORITY_META[t.priority]?.badge}>
                  {t.priority}
                </Badge>
                <Badge variant="outline" className={statusClass(t.status)}>
                  {t.status}
                </Badge>
              </div>
              <SheetTitle className="text-left text-lg mt-1">
                {t.title}
              </SheetTitle>
              <p className="text-sm text-muted-foreground text-left">
                {t.category}
                {t.subcategory ? ` › ${t.subcategory}` : ""} · {t.location}
              </p>
            </SheetHeader>

            <Tabs defaultValue="details" className="p-5">
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="timeline">
                  <Clock className="h-3.5 w-3.5 mr-1" />
                  Timeline
                </TabsTrigger>
                <TabsTrigger value="comments">
                  <MessageSquare className="h-3.5 w-3.5 mr-1" />
                  Comments
                </TabsTrigger>
                {isStaff && (
                  <TabsTrigger value="approval">
                    <FileCheck2 className="h-3.5 w-3.5 mr-1" />
                    Approval
                  </TabsTrigger>
                )}
              </TabsList>

              {/* DETAILS */}
              <TabsContent value="details" className="space-y-4 pt-4">
                <p className="text-sm whitespace-pre-wrap">
                  {t.description || "No description."}
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Info label="Raised by" value={t.raised_by_name} />
                  <Info label="Raised for" value={t.raised_for_name} />
                  <Info label="Employee ID" value={t.employee_id} />
                  <Info label="Email" value={t.email} />
                  <Info
                    label="Assignee"
                    value={t.assignee_name || "Unassigned"}
                  />
                  <Info label="Created" value={fmtDateTime(t.created_at)} />
                  <Info
                    label="Response SLA"
                    value={fmtDate(t.sla_response_due)}
                  />
                  <Info
                    label="Resolution SLA"
                    value={
                      <SlaText due={t.sla_resolution_due} status={t.status} />
                    }
                  />
                </div>

                {t.resolution && (
                  <div className="rounded-md border bg-green-50 p-3 text-sm space-y-1">
                    <p className="font-medium text-green-800">Resolution</p>
                    <p>
                      <span className="text-muted-foreground">Summary:</span>{" "}
                      {t.resolution.summary}
                    </p>
                    {t.resolution.action_taken && (
                      <p>
                        <span className="text-muted-foreground">Action:</span>{" "}
                        {t.resolution.action_taken}
                      </p>
                    )}
                    {t.resolution.root_cause && (
                      <p>
                        <span className="text-muted-foreground">
                          Root cause:
                        </span>{" "}
                        {t.resolution.root_cause}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      By {t.resolution.resolved_by} ·{" "}
                      {fmtDateTime(t.resolution.resolved_date)}
                    </p>
                  </div>
                )}
                {t.confirmation && (
                  <div className="rounded-md border p-3 text-sm">
                    {t.confirmation.confirmed ? (
                      <p className="text-green-700 font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" />
                        Confirmed by employee{" "}
                        {t.confirmation.rating
                          ? `· ${t.confirmation.rating}★`
                          : ""}
                      </p>
                    ) : (
                      <p className="text-rose-700 font-medium">
                        Reopened by employee
                      </p>
                    )}
                    {t.confirmation.comment && (
                      <p className="text-muted-foreground mt-1">
                        {t.confirmation.comment}
                      </p>
                    )}
                  </div>
                )}

                <Separator />

                {/* STAFF ACTIONS */}
                {isStaff && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Actions</p>
                    <Bar>
                      <div className="space-y-1">
                        <Label className="text-xs">Assignee</Label>
                        <Select
                          value={t.assignee_id || "none"}
                          onValueChange={(v) =>
                            patch(
                              { assignee_id: v === "none" ? null : v },
                              "Assignment updated",
                            )
                          }
                        >
                          <SelectTrigger className="w-44 h-9">
                            <SelectValue placeholder="Assign" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Unassigned</SelectItem>
                            {(user.role === "super_admin" || user.is_team_head
                              ? deptUsers
                              : deptUsers.filter((u) => u.id === user.id)
                            ).map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.name}
                                {u.id === user.id ? " (Me)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Priority</Label>
                        <Select
                          value={t.priority}
                          onValueChange={(v) =>
                            patch({ priority: v }, "Priority updated")
                          }
                        >
                          <SelectTrigger className="w-32 h-9">
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
                      <div className="space-y-1">
                        <Label className="text-xs">Status</Label>
                        <Select
                          value={t.status}
                          onValueChange={(v) =>
                            patch({ status: v }, "Status updated")
                          }
                        >
                          <SelectTrigger className="w-56 h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ALL_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </Bar>
                    {t.approval_required &&
                      ![
                        "Approved - Ready for Action",
                        "In Progress",
                        "Resolved",
                        "Closed",
                      ].includes(t.status) && (
                        <p className="text-xs flex items-center gap-1 text-amber-700">
                          <Lock className="h-3.5 w-3.5" />
                          Execution locked until Super Admin approval.
                        </p>
                      )}
                    <ResolveForm
                      onSubmit={(r) =>
                        patch({ resolution: r }, "Ticket resolved")
                      }
                      disabled={busy}
                    />
                  </div>
                )}

                {/* EMPLOYEE CONFIRM */}
                {user.role === "employee" && t.status === "Resolved" && (
                  <ConfirmForm
                    ticketId={ticketId}
                    onDone={() => {
                      load();
                      onChanged?.();
                    }}
                  />
                )}
              </TabsContent>

              {/* TIMELINE */}
              <TabsContent value="timeline" className="pt-4">
                <ol className="relative border-l pl-4 space-y-4">
                  {(t.history || []).map((h) => (
                    <li key={h.id} className="ml-2">
                      <div className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full bg-fuchsia-500" />
                      <p className="text-sm font-medium capitalize">
                        {h.type}
                        {h.to ? `: ${h.to}` : ""}
                      </p>
                      {h.note && (
                        <p className="text-sm text-muted-foreground">
                          {h.note}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {h.by_name || "System"} · {fmtDateTime(h.created_at)}
                      </p>
                    </li>
                  ))}
                  {(!t.history || t.history.length === 0) && (
                    <p className="text-sm text-muted-foreground">
                      No events yet.
                    </p>
                  )}
                </ol>
              </TabsContent>

              {/* COMMENTS */}
              <TabsContent value="comments" className="pt-4 space-y-3">
                <div className="space-y-3 max-h-72 overflow-y-auto">
                  {(t.comments || []).map((c) => (
                    <div
                      key={c.id}
                      className={`rounded-md border p-3 text-sm ${c.type === "internal" ? "bg-amber-50 border-amber-200" : c.type === "approval" ? "bg-purple-50 border-purple-200" : "bg-muted/40"}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {c.author_name}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({c.author_role})
                          </span>
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {c.type}
                        </Badge>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {fmtDateTime(c.created_at)}
                      </p>
                    </div>
                  ))}
                  {(!t.comments || t.comments.length === 0) && (
                    <p className="text-sm text-muted-foreground">
                      No comments yet.
                    </p>
                  )}
                </div>
                <Separator />
                <div className="space-y-2">
                  {isStaff && (
                    <Select value={commentType} onValueChange={setCommentType}>
                      <SelectTrigger className="w-40 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="public">
                          Public (visible to employee)
                        </SelectItem>
                        <SelectItem value="internal">
                          Internal (staff only)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Write a comment..."
                    rows={3}
                  />
                  <Button
                    size="sm"
                    onClick={addComment}
                    disabled={busy || !comment.trim()}
                  >
                    Add comment
                  </Button>
                </div>
              </TabsContent>

              {/* APPROVAL */}
              {isStaff && (
                <TabsContent value="approval" className="pt-4 space-y-4">
                  <ApprovalSection
                    t={t}
                    user={user}
                    onChanged={() => {
                      load();
                      onChanged?.();
                    }}
                  />
                </TabsContent>
              )}
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="font-medium">{value || "-"}</div>
    </div>
  );
}
function SlaText({ due, status }) {
  if (["Resolved", "Closed", "Cancelled"].includes(status))
    return <span>{fmtDate(due)}</span>;
  const s = slaRemaining(due);
  return (
    <span
      className={s.breach ? "text-red-600 font-semibold" : "text-emerald-600"}
    >
      {s.text}
    </span>
  );
}

function ResolveForm({ onSubmit, disabled }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [action, setAction] = useState("");
  const [root, setRoot] = useState("");
  if (!open)
    return (
      <Button
        variant="outline"
        size="sm"
        className="text-green-700 border-green-300"
        onClick={() => setOpen(true)}
      >
        <CheckCircle2 className="h-4 w-4 mr-1" />
        Resolve ticket
      </Button>
    );
  return (
    <div className="rounded-md border p-3 space-y-2 bg-green-50/50">
      <Label className="text-xs">Resolution summary</Label>
      <Textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={2}
        placeholder="What was done"
      />
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Action taken"
        />
        <Input
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          placeholder="Root cause"
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={disabled || !summary}
          onClick={() =>
            onSubmit({ summary, action_taken: action, root_cause: root })
          }
        >
          Submit resolution
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ConfirmForm({ ticketId, onDone }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action) => {
    setBusy(true);
    try {
      await api(`/tickets/${ticketId}/confirm`, {
        method: "POST",
        body: { action, rating, comment },
      });
      toast.success(action === "confirm" ? "Confirmed & closed" : "Reopened");
      onDone();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-md border p-3 space-y-2 bg-blue-50/50">
      <p className="text-sm font-medium">
        This ticket is resolved. Please confirm.
      </p>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)}>
            <Star
              className={`h-5 w-5 ${n <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
            />
          </button>
        ))}
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Optional comment"
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => act("confirm")}>
          <CheckCircle2 className="h-4 w-4 mr-1" />
          Confirm & close
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => act("reopen")}
        >
          <RotateCcw className="h-4 w-4 mr-1" />
          Reopen
        </Button>
      </div>
    </div>
  );
}

function ApprovalSection({ t, user, onChanged }) {
  const a = t.approval;
  const [form, setForm] = useState({
    justification: "",
    requested_amount: "",
    vendor: "",
    quotation: "",
    alternatives: "",
    recommendation: "",
    risk: "",
    required_by: "",
  });
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState({
    decision: "approve",
    remarks: "",
    approved_amount: "",
  });

  const submit = async () => {
    setBusy(true);
    try {
      await api(`/tickets/${t.id}/approval/submit`, {
        method: "POST",
        body: { ...form, requested_amount: Number(form.requested_amount) || 0 },
      });
      toast.success("Submitted for approval");
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const decide = async () => {
    setBusy(true);
    try {
      await api(`/tickets/${t.id}/approval/decision`, {
        method: "POST",
        body: {
          ...decision,
          approved_amount:
            decision.approved_amount === ""
              ? null
              : Number(decision.approved_amount),
        },
      });
      toast.success("Decision recorded");
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  // IT/Admin: prepare & submit (dept-scoped; when no approval or clarification/rejected)
  const canPrepare =
    ((user.role === "admin" && t.department === "Admin") ||
      (user.role === "it" && t.department === "IT")) &&
    (!a || a.status === "Clarification" || a.status === "Rejected");
  // Super admin decision
  const canDecide = user.role === "super_admin" && a && a.status === "Pending";

  return (
    <div className="space-y-4">
      {a && (
        <div className="rounded-md border p-3 text-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs">{a.human_id}</span>
            <Badge variant="outline" className={statusClass(t.status)}>
              {a.status}
            </Badge>
          </div>
          <p>
            <span className="text-muted-foreground">Justification:</span>{" "}
            {a.justification}
          </p>
          <div className="grid grid-cols-2 gap-1">
            <p>
              <span className="text-muted-foreground">Requested:</span> ₹
              {a.requested_amount}
            </p>
            <p>
              <span className="text-muted-foreground">Approved:</span>{" "}
              {a.approved_amount != null ? `₹${a.approved_amount}` : "-"}
            </p>
            <p>
              <span className="text-muted-foreground">Vendor:</span>{" "}
              {a.vendor || "-"}
            </p>
            <p>
              <span className="text-muted-foreground">Required by:</span>{" "}
              {fmtDate(a.required_by)}
            </p>
          </div>
          {a.recommendation && (
            <p>
              <span className="text-muted-foreground">Recommendation:</span>{" "}
              {a.recommendation}
            </p>
          )}
          {a.decision_remarks && (
            <p>
              <span className="text-muted-foreground">Decision remarks:</span>{" "}
              {a.decision_remarks}
            </p>
          )}
          {(a.history || []).length > 0 && (
            <div className="mt-2 border-t pt-2">
              <p className="text-xs font-medium mb-1">Approval history</p>
              {a.history.map((h, i) => (
                <p key={i} className="text-xs text-muted-foreground capitalize">
                  {h.action} by {h.by} · {fmtDateTime(h.at)}{" "}
                  {h.remarks ? `— ${h.remarks}` : ""}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {canPrepare && (
        <div className="rounded-md border p-3 space-y-2">
          <p className="text-sm font-medium">Prepare approval request</p>
          <Textarea
            placeholder="Justification"
            rows={2}
            value={form.justification}
            onChange={(e) =>
              setForm({ ...form, justification: e.target.value })
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Requested amount (₹)"
              type="number"
              value={form.requested_amount}
              onChange={(e) =>
                setForm({ ...form, requested_amount: e.target.value })
              }
            />
            <Input
              placeholder="Vendor"
              value={form.vendor}
              onChange={(e) => setForm({ ...form, vendor: e.target.value })}
            />
            <Input
              placeholder="Quotation ref"
              value={form.quotation}
              onChange={(e) => setForm({ ...form, quotation: e.target.value })}
            />
            <Input
              type="date"
              value={form.required_by}
              onChange={(e) =>
                setForm({ ...form, required_by: e.target.value })
              }
            />
          </div>
          <Input
            placeholder="Alternatives considered"
            value={form.alternatives}
            onChange={(e) => setForm({ ...form, alternatives: e.target.value })}
          />
          <Input
            placeholder="Recommendation"
            value={form.recommendation}
            onChange={(e) =>
              setForm({ ...form, recommendation: e.target.value })
            }
          />
          <Input
            placeholder="Risk if not approved"
            value={form.risk}
            onChange={(e) => setForm({ ...form, risk: e.target.value })}
          />
          <Button
            size="sm"
            disabled={busy || !form.justification}
            onClick={submit}
          >
            Submit to Super Admin
          </Button>
        </div>
      )}

      {canDecide && (
        <div className="rounded-md border p-3 space-y-2 bg-amber-50/50">
          <p className="text-sm font-medium">Super Admin decision</p>
          <Select
            value={decision.decision}
            onValueChange={(v) => setDecision({ ...decision, decision: v })}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="approve">Approve</SelectItem>
              <SelectItem value="partial">Partially Approve</SelectItem>
              <SelectItem value="reject">Reject</SelectItem>
              <SelectItem value="hold">Hold</SelectItem>
              <SelectItem value="clarify">Request Clarification</SelectItem>
            </SelectContent>
          </Select>
          {["approve", "partial"].includes(decision.decision) && (
            <Input
              type="number"
              placeholder="Approved amount (₹)"
              value={decision.approved_amount}
              onChange={(e) =>
                setDecision({ ...decision, approved_amount: e.target.value })
              }
            />
          )}
          <Textarea
            placeholder="Remarks (required for partial/reject/hold/clarify)"
            rows={2}
            value={decision.remarks}
            onChange={(e) =>
              setDecision({ ...decision, remarks: e.target.value })
            }
          />
          <Button size="sm" disabled={busy} onClick={decide}>
            Record decision
          </Button>
        </div>
      )}

      {!a && user.role !== "admin" && (
        <p className="text-sm text-muted-foreground">
          No approval request for this ticket.
        </p>
      )}
    </div>
  );
}

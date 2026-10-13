"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/appapi";
import { configureSla } from "@/lib/sla";
import { Skeleton } from "@/components/ui/skeleton";
import { AppSelect } from "@/components/ui/select";
import { X } from "lucide-react";
import { toast } from "sonner";

const TEAM = {
  it: ["IT", "#2f6bd0", "#e8f0fc"],
  admin: ["Admin", "#12795a", "#e4f3ec"],
  super_admin: ["Super Admin", "#8a0f61", "#fbe9f4"],
  employee: ["Employee", "#55555e", "#f1f0ec"],
};
const PRIORITIES = ["Critical", "High", "Medium", "Low"];
const PRIO_COLOR = { Critical: "#b42318", High: "#e0822f", Medium: "#d1a441", Low: "#9a9aa3" };
const DAYS = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]];
// Employee ID and Last active drop out below xl so Needs attention and Manage stay visible.
const MEMBER_COLS = { "--cols": "minmax(200px,2fr) 140px 70px 80px minmax(150px,1.4fr) 80px", "--cols-xl": "minmax(220px,2fr) 100px 150px 80px 100px 80px minmax(170px,1.4fr) 80px" };
const MEMBER_COLS_CLS = "[grid-template-columns:var(--cols)] xl:[grid-template-columns:var(--cols-xl)]";
const CAT_COLS = "minmax(200px,1.6fr) 80px minmax(140px,1fr) 100px 110px minmax(190px,1.4fr) 90px";
const seg = (on) => (on ? "bg-white text-[#17171c] shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "bg-transparent text-[#6b6b76]");
const initials = (name = "") => name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
const isTest = (u) =>
  /e2e|pentest|\btest\b/i.test(u.email || "") || /^(pending admin|pentest)$/i.test(u.name || "") || /E2E|PENTEST|TEST/i.test(u.employee_id || "");
const daysSince = (value) => (value ? Math.floor((Date.now() - new Date(value).getTime()) / 86400000) : null);
const Toggle = ({ on, locked }) => (
  <span className={`relative h-5 w-9 shrink-0 rounded-[10px] ${on ? "bg-[#12795a]" : "bg-[#d6d4ce]"} ${locked ? "opacity-60" : ""}`}>
    <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)]" style={{ left: on ? 18 : 2 }} />
  </span>
);

// Hours ⇄ label. "d" means working days (the configured day length).
const hoursLabel = (hours, dayLength) => {
  if (hours == null) return "";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (dayLength && hours >= dayLength * 2 && Math.abs(hours / dayLength - Math.round(hours / dayLength)) < 0.01) return `${Math.round(hours / dayLength)}d`;
  return `${Math.round(hours * 100) / 100}h`;
};
const parseHours = (text, dayLength) => {
  const m = String(text).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs|d|day|days)?$/);
  if (!m) return null;
  const v = Number(m[1]);
  const unit = m[2] || "h";
  return unit.startsWith("m") ? v / 60 : unit.startsWith("d") ? v * dayLength : v;
};

function flagsOf(u) {
  const f = [];
  if (isTest(u)) f.push({ t: "Test account", long: "Automated or test account with live access", cls: "bg-[#fdeaea] text-[#b42318]" });
  if (u.is_team_head && ["it", "admin"].includes(u.role) && !u.closed_7d && u.overdue_open)
    f.push({ t: `Idle head · owns ${u.overdue_open} overdue`, long: `Team head who closed 0 tickets in 7 days and owns ${u.overdue_open} overdue ticket${u.overdue_open === 1 ? "" : "s"}`, cls: "bg-[#fdf3dc] text-[#8a5a00]" });
  if (!isTest(u) && !String(u.employee_id || "").trim()) f.push({ t: "No employee ID", long: "Employee ID missing — breaks requester mapping", cls: "bg-[#fdf3dc] text-[#8a5a00]" });
  else if (!isTest(u) && !/^(GRP|GRTP|CONS)\d{3,5}$/i.test(String(u.employee_id).trim()))
    f.push({ t: "ID format", long: `ID “${u.employee_id}” doesn’t match the GRP#### format`, cls: "bg-[#f1f0ec] text-[#55555e]" });
  else if (/^GRTP/i.test(String(u.employee_id)))
    f.push({ t: "ID format", long: `ID “${u.employee_id}” doesn’t match the GRP#### format`, cls: "bg-[#f1f0ec] text-[#55555e]" });
  const idle = daysSince(u.last_active_at);
  if (!isTest(u) && idle != null && idle >= 14) f.push({ t: `No sign-in ${idle}d`, long: `No activity for ${idle} days but access is active`, cls: "bg-[#f1f0ec] text-[#55555e]" });
  if (/^CONS/i.test(String(u.employee_id || ""))) f.push({ t: "Consultant", long: "Consultant — set an access end date", cls: "bg-[#f1f0ec] text-[#55555e]" });
  return f;
}

// Likely duplicate: shares its meaningful words with a busier category on the
// same desk ("Hardware Issue" vs "Laptop Issue", "Antivirus / Security" vs
// "Endpoint Security").
const SYNONYMS = { hardware: "laptop", antivirus: "endpoint", password: "account", internet: "wifi", operation: "operations", policy: "policies", billing: "cloud" };
const GENERIC = new Set(["issue", "issues", "support", "request", "requests", "management", "related", "task", "tasks", "and", "the", "for"]);
const keyWords = (name) =>
  new Set(String(name).toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !GENERIC.has(w)).map((w) => SYNONYMS[w] || w.replace(/s$/, "")));
function duplicateOf(cat, all) {
  const mine = keyWords(cat.name);
  if (!mine.size) return null;
  let best = null;
  for (const other of all) {
    if (other.id === cat.id || other.department !== cat.department || other.hidden) continue;
    if ((other.tickets_total || 0) < (cat.tickets_total || 0)) continue;
    const theirs = keyWords(other.name);
    let shared = 0;
    mine.forEach((w) => { if (theirs.has(w)) shared += 1; });
    // Same meaningful words (after synonyms) — conservative, since a merge
    // re-labels real tickets.
    if (shared === mine.size && shared === theirs.size && (!best || (other.tickets_total || 0) > (best.tickets_total || 0))) best = other;
  }
  return best;
}
const wrongDesk = (cat) =>
  cat.department === "IT" && /invoice|billing|finance|reimburs/i.test(cat.name)
    ? "Finance / Admin, not IT"
    : cat.department === "IT" && /administrative|housekeeping|pantry|furniture/i.test(cat.name)
      ? "Belongs on Admin desk"
      : cat.department === "Admin" && /laptop|software|wifi|network|vpn|antivirus/i.test(cat.name)
        ? "Belongs on IT desk"
        : null;

// ------------------------------------------------------------------ members
function MembersTab({ users, lists, resets, reload }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState(null);
  useEffect(() => {
    api("/settings/sla").then((c) => setReview(c.access_review)).catch(() => {});
  }, []);

  const active = users.filter((u) => u.active !== false);
  const tests = active.filter(isTest);
  const needs = (u) => u.active !== false && flagsOf(u).length > 0;
  const heads = users.filter((u) => u.is_team_head && u.active !== false);
  const idleHeads = heads.filter((u) => !u.closed_7d && u.overdue_open);
  const reviewedDays = daysSince(review?.reviewed_at);
  const kpis = [
    { l: "Active accounts", v: active.length, s: `${active.length - tests.length} real people · ${tests.length} test`, c: "#17171c" },
    { l: "Need attention", v: users.filter(needs).length, s: "test, idle, missing ID, idle heads", c: users.filter(needs).length ? "#b42318" : "#12795a" },
    { l: "Team heads", v: heads.length, s: idleHeads.length ? `${idleHeads.length} idle with overdue tickets` : "all active", c: "#17171c" },
    { l: "Last access review", v: review ? (reviewedDays === 0 ? "Today" : `${reviewedDays}d ago`) : "Never", s: review ? `by ${review.reviewed_by} · recommend quarterly` : "Recommend quarterly", c: !review || reviewedDays > 90 ? "#8a5a00" : "#12795a", action: true },
  ];
  const markReviewed = async () => {
    try {
      setReview(await api("/settings/access-review", { method: "POST" }));
      toast.success("Access review recorded");
    } catch (error) {
      toast.error(error.message);
    }
  };
  const deactivate = async (targets) => {
    if (!targets.length) return;
    if (!window.confirm(`Deactivate ${targets.length} account${targets.length === 1 ? "" : "s"}? ${targets.map((u) => u.name).join(", ")}`)) return;
    try {
      for (const u of targets) await api(`/users/${u.id}`, { method: "PATCH", body: { active: false } });
      toast.success(`${targets.length} account${targets.length === 1 ? "" : "s"} deactivated`);
      reload();
    } catch (error) {
      toast.error(error.message);
    }
  };
  const query = q.trim().toLowerCase();
  const rows = users
    .filter((u) =>
      (filter === "all" || (filter === "attn" && needs(u)) || (filter === "heads" && u.is_team_head) || (filter === "inactive" && u.active === false)) &&
      (!query || `${u.name} ${u.email} ${u.employee_id}`.toLowerCase().includes(query)))
    .sort((a, b) => (a.active === false) - (b.active === false) || (flagsOf(b).length > 0) - (flagsOf(a).length > 0) || (b.tickets_30d || 0) - (a.tickets_30d || 0));

  const om = openId && users.find((u) => u.id === openId);
  const open = (u) => {
    setOpenId(u.id);
    setDraft({ role: u.role, location: u.location || "Tulip", employee_id: u.employee_id || "", is_team_head: Boolean(u.is_team_head), extra_roles: u.extra_roles || [], name: u.name, password: "" });
  };
  const save = async () => {
    setSaving(true);
    try {
      const body = { name: draft.name, role: draft.role, employee_id: draft.employee_id, location: draft.location, is_team_head: ["it", "admin"].includes(draft.role) ? draft.is_team_head : false, extra_roles: draft.extra_roles.filter((r) => r !== draft.role), password: draft.password || undefined };
      await api(`/users/${om.id}`, { method: "PATCH", body });
      if (draft.password) {
        const pending = resets.find((r) => r.user_id === om.id);
        if (pending) await api(`/password-reset-requests/${pending.id}`, { method: "PATCH", body: { status: "completed" } }).catch(() => {});
      }
      toast.success("Changes saved");
      setOpenId(null);
      reload();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };
  const toggleActive = async () => {
    const next = om.active === false;
    if (!next && !window.confirm(`Deactivate ${om.name}? They are signed out immediately.`)) return;
    try {
      await api(`/users/${om.id}`, { method: "PATCH", body: { active: next } });
      toast.success(`${om.name} ${next ? "reactivated" : "deactivated"}`);
      setOpenId(null);
      reload();
    } catch (error) {
      toast.error(error.message);
    }
  };
  const resolveReset = async (id, status) => {
    try {
      await api(`/password-reset-requests/${id}`, { method: "PATCH", body: { status } });
      toast.success(status === "completed" ? "Request marked as done" : "Request dismissed");
      reload();
    } catch (error) {
      toast.error(error.message);
    }
  };
  const memberLists = om ? lists.filter((l) => l.member_id === om.id && l.active !== false) : [];
  const role = draft?.role;
  const perms = om
    ? [
        { l: "Team head", d: "Sees and assigns every ticket for their team and site", on: ["it", "admin"].includes(role) && draft.is_team_head, locked: !["it", "admin"].includes(role), toggle: () => setDraft({ ...draft, is_team_head: !draft.is_team_head }) },
        { l: "Approve purchases", d: "Can approve/reject in Approval inbox · set by role", on: role === "super_admin", locked: true },
        { l: "See all tickets", d: role === "super_admin" ? "Every desk and site · set by role" : ["it", "admin"].includes(role) ? "Own desk's tickets · set by role" : "Only tickets they raised · set by role", on: role !== "employee", locked: true },
        { l: "Manage checklists", d: "Assign and edit team checklists · set by role", on: role === "super_admin", locked: true },
        { l: "Export reports", d: "CSV export of dashboards · set by role", on: role === "super_admin", locked: true },
      ]
    : [];

  return (
    <>
      <section className="grid overflow-hidden rounded-xl border border-[#e8e7e3] bg-white" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        {kpis.map((k) => (
          <div key={k.l} className="flex flex-col gap-[5px] border-r border-[#efeeea] px-[18px] py-3.5 last:border-r-0">
            <span className="text-xs text-[#6b6b76]">{k.l}</span>
            <span className="text-[22px] font-semibold tracking-[-.02em]" style={{ color: k.c }}>{k.v}</span>
            <span className="text-[11.5px] leading-snug text-[#6b6b76]">{k.s}{k.action && <> · <button onClick={markReviewed} className="text-[#b3177f] hover:underline">Mark reviewed</button></>}</span>
          </div>
        ))}
      </section>

      {tests.length > 0 && (
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 rounded-xl border border-[#f1d3d0] bg-white px-4 py-3.5">
          <div className="flex min-w-0 flex-1 items-start gap-2.5"><span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-[#b42318]" /><span className="leading-normal text-[#3b3b44]"><strong className="font-semibold text-[#17171c]">{tests.length} test or shared account{tests.length === 1 ? " has" : "s have"} live access.</strong> {tests.map((u) => `“${u.name}”`).filter((v, i, a) => a.indexOf(v) === i).join(", ")} appear in team stats and can act on tickets. Shared or test logins hide who did the work.</span></div>
          <button onClick={() => deactivate(tests)} className="shrink-0 whitespace-nowrap rounded-lg bg-[#b42318] px-3 py-2 text-[12.5px] text-white">Deactivate {tests.length} account{tests.length === 1 ? "" : "s"}</button>
        </div>
      )}

      {resets.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-[#f1d9a8] bg-white px-4 py-3.5">
          <strong className="font-semibold">Password reset requests · {resets.length}</strong>
          {resets.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#3b3b44]">
              <span className="font-medium">{r.name || r.user_name || r.email}</span><span className="text-[#8a8a93]">{r.email}</span>
              <span className="ml-auto flex gap-1.5">
                {users.find((u) => u.id === r.user_id) && <button onClick={() => open(users.find((u) => u.id === r.user_id))} className="rounded-md border border-[#e0dfdb] bg-white px-2 py-1 text-xs">Set password</button>}
                <button onClick={() => resolveReset(r.id, "dismissed")} className="rounded-md border border-[#e0dfdb] bg-white px-2 py-1 text-xs text-[#6b6b76]">Dismiss</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-[#e8e7e3] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-[18px] py-3.5">
          <div className="flex flex-wrap gap-0.5 rounded-[9px] bg-[#efeeea] p-[3px]">
            {[["all", "All"], ["attn", "Needs attention"], ["heads", "Team heads"], ["inactive", "Deactivated"]].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`shrink-0 whitespace-nowrap rounded-[7px] px-2.5 py-[5px] text-xs font-medium ${seg(filter === k)}`}>{l}</button>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, ID…" className="w-[220px] max-w-full rounded-lg border border-[#e0dfdb] bg-white px-[11px] py-[7px] text-[12.5px] text-[#17171c] outline-none" />
          </div>
        </div>
        <div className="overflow-x-auto"><div className="min-w-[760px] xl:min-w-[980px]">
          <div className={`grid gap-3 border-y border-[#efeeea] bg-[#f7f6f3] px-[18px] py-[9px] text-[11.5px] text-[#6b6b76] ${MEMBER_COLS_CLS}`} style={MEMBER_COLS}>
            <span>Member</span><span className="hidden xl:block">Employee ID</span><span>Role</span><span>Site</span><span className="hidden xl:block">Last active</span><span className="text-right">Tickets 30d</span><span>Needs attention</span><span />
          </div>
          {rows.map((u) => {
            const [label, color, soft] = TEAM[u.role] || TEAM.employee;
            const inactive = u.active === false;
            const idle = daysSince(u.last_active_at);
            const flags = inactive ? [{ t: "Deactivated", cls: "bg-[#f1f0ec] text-[#8a8a93]" }] : flagsOf(u);
            return (
              <div key={u.id} className={`grid items-center gap-3 border-b border-[#f1f0ec] px-[18px] py-2.5 ${inactive ? "opacity-50" : ""} ${MEMBER_COLS_CLS}`} style={MEMBER_COLS}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[10.5px] font-semibold" style={{ background: soft, color }}>{initials(u.name)}</span>
                  <div className="flex min-w-0 flex-col leading-tight"><span className="font-medium">{u.name}</span><span className="truncate text-[11.5px] text-[#8a8a93]">{u.email}</span></div>
                </div>
                <span className={`hidden font-mono text-[11.5px] xl:block ${String(u.employee_id || "").trim() ? "text-[#55555e]" : "text-[#b42318]"}`}>{String(u.employee_id || "").trim() || "missing"}</span>
                <div className="flex flex-wrap gap-1"><span className="rounded-[5px] border border-[#e0dfdb] px-[7px] py-0.5 text-[11px]">{label}</span>{(u.extra_roles || []).filter((r) => r !== u.role).map((r) => <span key={r} title="Additional role" className="rounded-[5px] border border-dashed border-[#e0dfdb] px-[7px] py-0.5 text-[11px] text-[#6b6b76]">+{(TEAM[r] || TEAM.employee)[0]}</span>)}{u.is_team_head && <span className="rounded-[5px] bg-[#fbe9f4] px-[7px] py-0.5 text-[11px] font-medium text-[#8a0f61]">Head</span>}</div>
                <span className="text-[#55555e]">{u.location || "—"}</span>
                <span className={`hidden xl:block ${idle != null && idle >= 14 ? "text-[#b42318]" : "text-[#55555e]"}`}>{inactive ? "Deactivated" : idle == null ? "—" : idle === 0 ? "Today" : idle === 1 ? "Yesterday" : `${idle} days ago`}</span>
                <span className="text-right font-semibold tabular-nums">{u.tickets_30d || 0}</span>
                <div className="flex flex-wrap gap-1">{flags.map((f) => <span key={f.t} className={`whitespace-nowrap rounded-[5px] px-[7px] py-[3px] text-[11px] font-medium ${f.cls}`}>{f.t}</span>)}</div>
                <button onClick={() => open(u)} className="whitespace-nowrap rounded-[7px] border border-[#e0dfdb] bg-white px-2.5 py-[5px] text-xs">Manage</button>
              </div>
            );
          })}
          {!rows.length && <div className="p-7 text-center text-[#6b6b76]">No members match.</div>}
        </div></div>
      </section>

      {om && draft && (
        <>
          <div onClick={() => setOpenId(null)} className="fixed inset-0 z-40 bg-[rgba(23,23,28,.28)]" />
          <aside className="fixed inset-y-0 right-0 z-[41] flex w-[min(420px,100vw)] flex-col bg-white text-[13px] shadow-[-12px_0_40px_rgba(0,0,0,.12)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#efeeea] px-[22px] pb-4 pt-5">
              <div className="flex min-w-0 flex-col gap-[3px]"><span className="text-base font-semibold">{om.name}</span><span className="truncate text-xs text-[#6b6b76]">{om.email}</span></div>
              <button onClick={() => setOpenId(null)} className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-[#e0dfdb] bg-white text-[#55555e]" aria-label="Close"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="flex flex-1 flex-col gap-4 overflow-auto px-[22px] py-[18px]">
              {flagsOf(om).length > 0 && om.active !== false && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-[#f1d3d0] bg-[#fdf5f4] px-3 py-2.5">{flagsOf(om).map((f) => <span key={f.t} className="text-[12.5px] text-[#8a2a1f]">• {f.long}</span>)}</div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 flex flex-col gap-[5px]"><span className="text-[11.5px] text-[#6b6b76]">Name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="rounded-lg border border-[#e0dfdb] px-[9px] py-[7px] text-[12.5px]" /></label>
                <label className="flex flex-col gap-[5px]"><span className="text-[11.5px] text-[#6b6b76]">Team</span>
                  <AppSelect value={draft.role} onValueChange={(v) => setDraft({ ...draft, role: v })} options={[["it", "IT"], ["admin", "Admin"], ["super_admin", "Super Admin"], ["employee", "Employee"]]} className="h-auto rounded-lg border-[#e0dfdb] px-2.5 py-[7px] text-[12.5px]" /></label>
                <label className="flex flex-col gap-[5px]"><span className="text-[11.5px] text-[#6b6b76]">Site</span>
                  <AppSelect value={/lotus/i.test(draft.location) ? "Lotus" : "Tulip"} onValueChange={(v) => setDraft({ ...draft, location: v })} options={[["Tulip", "Tulip"], ["Lotus", "Lotus"]]} className="h-auto rounded-lg border-[#e0dfdb] px-2.5 py-[7px] text-[12.5px]" /></label>
                <label className="flex flex-col gap-[5px]"><span className="text-[11.5px] text-[#6b6b76]">Employee ID</span><input value={draft.employee_id} onChange={(e) => setDraft({ ...draft, employee_id: e.target.value })} className="rounded-lg border border-[#e0dfdb] px-[9px] py-[7px] text-[12.5px]" /></label>
                <div className="flex flex-col gap-[5px]"><span className="text-[11.5px] text-[#6b6b76]">checklist</span><span className="rounded-lg border border-[#efeeea] bg-[#f7f6f3] px-[9px] py-[7px] text-[12.5px] text-[#3b3b44]">{memberLists.length ? memberLists.map((l) => `${l.title} (${(l.items || []).length})`).join(", ") : "None"}</span></div>
                <label className="col-span-2 flex flex-col gap-[5px]"><span className="text-[11.5px] text-[#6b6b76]">New password {resets.some((r) => r.user_id === om.id) && <span className="text-[#8a5a00]">· reset requested</span>}</span><input type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} placeholder="Leave blank to keep current" className="rounded-lg border border-[#e0dfdb] px-[9px] py-[7px] text-[12.5px]" autoComplete="new-password" /></label>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">Additional roles</span>
                  <span className="text-xs text-[#6b6b76]">The member can switch between their team and these roles from the menu under their name. Team head stays with their main team.</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(TEAM).filter(([k]) => k !== draft.role).map(([k, [label, color, soft]]) => {
                    const on = draft.extra_roles.includes(k);
                    return (
                      <button key={k} type="button" aria-pressed={on} onClick={() => setDraft({ ...draft, extra_roles: on ? draft.extra_roles.filter((r) => r !== k) : [...draft.extra_roles, k] })} className="flex items-center gap-1.5 rounded-lg border px-3 py-[7px] text-[12.5px]" style={on ? { background: soft, borderColor: color, color } : { background: "#fff", borderColor: "#e0dfdb", color: "#3b3b44" }}>
                        <span className="grid h-3.5 w-3.5 place-items-center rounded-[4px] border text-[10px] leading-none" style={{ borderColor: on ? color : "#c9c8c3", background: on ? color : "#fff", color: "#fff" }}>{on ? "✓" : ""}</span>{label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col">
                <span className="mb-1 font-semibold">Permissions</span>
                {perms.map((p) => (
                  <button key={p.l} onClick={p.locked ? undefined : p.toggle} disabled={p.locked} className="grid items-center gap-3.5 border-b border-[#f1f0ec] py-2.5 text-left disabled:cursor-default" style={{ gridTemplateColumns: "minmax(0,1fr) 36px" }}>
                    <div className="flex flex-col gap-0.5"><span className="font-medium">{p.l}</span><span className="text-xs text-[#6b6b76]">{p.d}</span></div>
                    <Toggle on={p.on} locked={p.locked} />
                  </button>
                ))}
                <span className="pt-2 text-[11.5px] text-[#8a8a93]">Permissions follow the team; change the team to change them. checklists are assigned in Team &amp; Checklists.</span>
              </div>
            </div>
            <div className="flex justify-between gap-2 border-t border-[#efeeea] px-[22px] py-3.5">
              <button onClick={toggleActive} className="rounded-lg border border-[#f1d3d0] bg-white px-3 py-2 text-[12.5px] text-[#b42318]">{om.active === false ? "Reactivate account" : "Deactivate account"}</button>
              <button onClick={save} disabled={saving} className="rounded-lg bg-[#17171c] px-3.5 py-2 text-[12.5px] text-white disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button>
            </div>
          </aside>
        </>
      )}
    </>
  );
}

// --------------------------------------------------------------- categories
function CategoriesTab({ dayLength }) {
  const [cats, setCats] = useState(null);
  const [desk, setDesk] = useState("IT");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({ name: "", department: "IT", sla: "", priority: "Medium" });
  const slaOptions = [["", "Priority default"], ["2", "2h"], ["4", "4h"], ["8", "8h"], ["24", "24h"], [String(dayLength * 3), "3d"], [String(dayLength * 5), "5d"]];
  const load = () => api("/categories?include_hidden=1&with_usage=1").then(setCats).catch((error) => toast.error(error.message));
  useEffect(() => { load(); }, []);
  if (!cats) return <Skeleton className="h-[480px] w-full rounded-xl" />;

  const deskCats = cats.filter((c) => c.department === desk);
  const visible = deskCats.filter((c) => !c.hidden);
  const total = visible.reduce((a, c) => a + (c.tickets_30d || 0), 0) || 1;
  const top6 = [...visible].sort((a, b) => (b.tickets_30d || 0) - (a.tickets_30d || 0)).slice(0, 6).reduce((a, c) => a + (c.tickets_30d || 0), 0);
  const unused = visible.filter((c) => !c.tickets_30d);
  const dups = visible.map((c) => ({ c, into: duplicateOf(c, deskCats) })).filter((x) => x.into);
  const dupMap = new Map(dups.map((x) => [x.c.id, x.into]));
  const noPrio = visible.filter((c) => !c.default_priority);
  const insights = [
    { v: `${Math.round((top6 / total) * 100)}%`, c: "#17171c", h: "of tickets fall in 6 categories", b: `Pin these to the top of the raise-ticket list; the other ${Math.max(0, visible.length - 6)} are rarely picked.` },
    { v: unused.length, c: unused.length ? "#b42318" : "#12795a", h: "categories unused in 30 days", b: "Hide them from the dropdown. Standard ones can’t be deleted, but they can be hidden." },
    { v: dups.length, c: dups.length ? "#8a5a00" : "#12795a", h: "likely duplicates", b: dups[0] ? `e.g. “${dups[0].c.name}” vs “${dups[0].into.name}”. Duplicates split your reports — merge them.` : "No overlapping category names found." },
    { v: noPrio.length, c: noPrio.length ? "#8a5a00" : "#12795a", h: "without a default priority", b: "New tickets in these start at Medium. Set defaults for network and security first." },
  ];
  const maxN = Math.max(1, ...deskCats.map((c) => c.tickets_30d || 0));
  const rows = deskCats
    .filter((c) => {
      const issue = !c.tickets_30d || dupMap.has(c.id) || wrongDesk(c);
      return filter === "all" ? !c.hidden : filter === "issues" ? issue && !c.hidden : filter === "custom" ? c.custom : c.hidden;
    })
    .sort((a, b) => (b.tickets_30d || 0) - (a.tickets_30d || 0) || a.name.localeCompare(b.name));
  const words = form.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  const similar = words.length ? cats.filter((c) => c.department === form.department && words.some((w) => c.name.toLowerCase().includes(w))).slice(0, 4).map((c) => c.name) : [];

  const patch = async (cat, body, message) => {
    try {
      const updated = await api(`/categories/${cat.id}`, { method: "PATCH", body });
      setCats((list) => list.map((c) => (c.id === cat.id ? { ...c, ...updated } : c)));
      if (message) toast.success(message);
    } catch (error) {
      toast.error(error.message);
    }
  };
  const merge = async (cat, into) => {
    if (!window.confirm(`Merge “${cat.name}” into “${into.name}”?\n\nAll ${cat.tickets_total || 0} ticket${cat.tickets_total === 1 ? "" : "s"} in “${cat.name}” will be re-labelled “${into.name}”, and “${cat.name}” will be removed from the list. This is recorded in the audit log.`)) return;
    try {
      const result = await api(`/categories/${cat.id}/merge`, { method: "POST", body: { into_id: into.id } });
      toast.success(`Merged “${cat.name}” into “${into.name}” · ${result.tickets_moved} tickets moved`);
      load();
    } catch (error) {
      toast.error(error.message);
    }
  };
  const remove = async (cat) => {
    if (!window.confirm(`Delete the custom category “${cat.name}”?`)) return;
    try {
      await api(`/categories/${cat.id}`, { method: "DELETE" });
      toast.success(`Deleted “${cat.name}”`);
      load();
    } catch (error) {
      toast.error(error.message);
    }
  };
  const add = async () => {
    const name = form.name.trim();
    if (!name) return;
    try {
      await api("/categories", { method: "POST", body: { name, department: form.department, sla_hours: form.sla ? Number(form.sla) : null, default_priority: form.priority } });
      toast.success(`Added “${name}” to ${form.department}${form.sla ? ` · SLA ${slaOptions.find((o) => o[0] === form.sla)?.[1]}` : ""}`);
      setForm({ ...form, name: "" });
      setDesk(form.department);
      setFilter("custom");
      load();
    } catch (error) {
      toast.error(error.message);
    }
  };
  const slaValue = (c) => (c.sla_hours ? (slaOptions.find((o) => Number(o[0]) === Number(c.sla_hours))?.[0] ?? String(c.sla_hours)) : "");

  return (
    <>
      <section className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))" }}>
        {insights.map((i) => (
          <div key={i.h} className="flex flex-col gap-1.5 rounded-xl border border-[#e8e7e3] bg-white p-4">
            <span className="text-[22px] font-semibold tracking-[-.02em]" style={{ color: i.c }}>{i.v}</span>
            <span className="font-semibold">{i.h}</span>
            <span className="text-[12.5px] leading-normal text-[#55555e]">{i.b}</span>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2.5 rounded-xl border border-[#e8e7e3] bg-white px-[18px] py-4">
        <span className="font-semibold">Add a category</span>
        <div className="flex flex-wrap gap-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="e.g. VPN access request" className="min-w-[220px] flex-1 rounded-lg border border-[#e0dfdb] px-[11px] py-2 text-[12.5px] text-[#17171c] outline-none" />
          <AppSelect value={form.department} onValueChange={(v) => setForm({ ...form, department: v })} options={[["IT", "IT desk"], ["Admin", "Admin desk"]]} aria-label="Desk" className="h-auto w-auto rounded-lg border-[#e0dfdb] px-2.5 py-[7px] text-[12.5px]" />
          <AppSelect value={form.sla} onValueChange={(v) => setForm({ ...form, sla: v })} options={slaOptions.map(([v, l]) => [v, v ? `SLA ${l}` : "SLA: priority default"])} aria-label="SLA" className="h-auto w-auto rounded-lg border-[#e0dfdb] px-2.5 py-[7px] text-[12.5px]" />
          <AppSelect value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })} options={PRIORITIES.map((p) => [p, `${p} priority`])} aria-label="Priority" className="h-auto w-auto rounded-lg border-[#e0dfdb] px-2.5 py-[7px] text-[12.5px]" />
          <button onClick={add} className="rounded-lg bg-[#b3177f] px-3.5 py-2 text-[12.5px] font-medium text-white">Add category</button>
        </div>
        {similar.length > 0 && <span className="text-xs text-[#8a5a00]">Similar categories already exist: <strong className="font-semibold">{similar.join(", ")}</strong>. Consider using one of those instead.</span>}
      </section>

      <section className="overflow-hidden rounded-xl border border-[#e8e7e3] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-[18px] py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-0.5 rounded-[9px] bg-[#efeeea] p-[3px]">{["IT", "Admin"].map((d) => <button key={d} onClick={() => setDesk(d)} className={`rounded-[7px] px-2.5 py-[5px] text-xs font-medium ${seg(desk === d)}`}>{d}</button>)}</div>
            <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">{desk} categories · {rows.length}</h3><span className="text-xs text-[#6b6b76]">Ordered by use. SLA and default priority apply to new tickets.</span></div>
          </div>
          <div className="flex flex-wrap gap-0.5 rounded-[9px] bg-[#efeeea] p-[3px]">
            {[["all", "All"], ["issues", "Needs cleanup"], ["custom", "Custom"], ["hidden", "Hidden"]].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`shrink-0 whitespace-nowrap rounded-[7px] px-2.5 py-[5px] text-xs font-medium ${seg(filter === k)}`}>{l}</button>)}
          </div>
        </div>
        <div className="overflow-x-auto"><div className="min-w-[940px]">
          <div className="grid gap-3 border-y border-[#efeeea] bg-[#f7f6f3] px-[18px] py-[9px] text-[11.5px] text-[#6b6b76]" style={{ gridTemplateColumns: CAT_COLS }}>
            <span>Category</span><span>Type</span><span>Tickets · 30 days</span><span>Resolution SLA</span><span>Default priority</span><span>Signal</span><span />
          </div>
          {rows.map((c) => {
            const into = dupMap.get(c.id);
            const wrong = wrongDesk(c);
            let signal = "—";
            let sigC = "text-[#8a8a93]";
            if (c.merged_into) { signal = `Merged into “${c.merged_into}”`; }
            else if (into) { signal = `Possible duplicate of “${into.name}”`; sigC = "text-[#8a5a00]"; }
            else if (wrong) { signal = wrong; sigC = "text-[#8a5a00]"; }
            if (!c.tickets_30d && !into && !c.merged_into) { signal = signal === "—" ? "Unused in 30 days" : `${signal} · unused`; sigC = "text-[#b42318]"; }
            return (
              <div key={c.id} className={`grid items-center gap-3 border-b border-[#f1f0ec] px-[18px] py-2 ${c.hidden ? "opacity-55" : ""}`} style={{ gridTemplateColumns: CAT_COLS }}>
                <span className="font-medium">{c.name}</span>
                <span className={`text-[11px] ${c.custom ? "text-[#8a0f61]" : "text-[#8a8a93]"}`}>{c.custom ? "Custom" : "Standard"}</span>
                <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-[#f1f0ec]"><div className="h-full rounded-[3px] bg-[#b3177f]" style={{ width: `${Math.round(((c.tickets_30d || 0) / maxN) * 100)}%` }} /></div><span className="w-7 text-right font-semibold tabular-nums">{c.tickets_30d || 0}</span></div>
                <AppSelect
                  value={slaValue(c)}
                  onValueChange={(v) => patch(c, { sla_hours: v ? Number(v) : null }, `SLA for “${c.name}” updated`)}
                  options={[
                    ...slaOptions.map(([v, l]) => [v, v ? l : "Default"]),
                    ...(c.sla_hours && !slaOptions.some((o) => Number(o[0]) === Number(c.sla_hours)) ? [[String(c.sla_hours), hoursLabel(c.sla_hours, dayLength)]] : []),
                  ]}
                  aria-label={`SLA for ${c.name}`}
                  className="h-auto rounded-md border-[#e0dfdb] px-2 py-1 text-xs"
                />
                <AppSelect
                  value={c.default_priority || ""}
                  onValueChange={(v) => patch(c, { default_priority: v || null }, `Default priority for “${c.name}” updated`)}
                  options={[["", "Not set"], ...PRIORITIES.slice().reverse().map((p) => [p, p])]}
                  aria-label={`Default priority for ${c.name}`}
                  className={`h-auto rounded-md px-2 py-1 text-xs ${c.default_priority ? "border-[#e0dfdb]" : "border-[#e8c98a]"}`}
                />
                <span className={`text-xs leading-snug ${sigC}`}>{signal}</span>
                <span>
                  {into && !c.hidden ? <button onClick={() => merge(c, into)} className="rounded-[7px] border border-[#e0dfdb] bg-white px-2.5 py-1 text-xs">Merge</button>
                    : c.custom && !c.tickets_total ? <button onClick={() => remove(c)} className="rounded-[7px] border border-[#e0dfdb] bg-white px-2.5 py-1 text-xs text-[#b42318]">Delete</button>
                      : (!c.tickets_30d || c.hidden) ? <button onClick={() => patch(c, { hidden: !c.hidden }, c.hidden ? `“${c.name}” shown in dropdowns` : `“${c.name}” hidden from dropdowns`)} className="rounded-[7px] border border-[#e0dfdb] bg-white px-2.5 py-1 text-xs">{c.hidden ? "Show" : "Hide"}</button> : null}
                </span>
              </div>
            );
          })}
          {!rows.length && <div className="p-7 text-center text-[#6b6b76]">No categories in this view.</div>}
        </div></div>
      </section>
    </>
  );
}

// --------------------------------------------------------------------- SLA
function SlaTab({ config, onSaved }) {
  const toTime = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
  const fromTime = (t) => { const [h, m] = String(t).split(":").map(Number); return h + (m || 0) / 60; };
  const initial = () => ({
    days: [...config.business_hours.weekdays],
    start: toTime(config.business_hours.start),
    end: toTime(config.business_hours.end),
    working_hours_only: config.working_hours_only !== false,
    pause_on_approval: Boolean(config.pause_on_approval),
    auto_escalate: Boolean(config.auto_escalate),
    policy: JSON.parse(JSON.stringify(config.policy)),
  });
  const [draft, setDraft] = useState(initial);
  const [desk, setDesk] = useState("IT");
  const [text, setText] = useState({});
  const [saving, setSaving] = useState(false);
  const dayLength = Math.max(1, fromTime(draft.end) - fromTime(draft.start));
  const cell = (priority, index) => text[`${desk}|${priority}|${index}`] ?? hoursLabel(draft.policy[desk][priority][index], null);
  const setCell = (priority, index, value) => {
    setText((t) => ({ ...t, [`${desk}|${priority}|${index}`]: value }));
    const hours = parseHours(value, dayLength);
    if (hours && hours > 0) setDraft((d) => { const policy = JSON.parse(JSON.stringify(d.policy)); policy[desk][priority][index] = hours; return { ...d, policy }; });
  };
  const invalid = Object.entries(text).find(([, v]) => !parseHours(v, dayLength));
  const toggles = [
    ["working_hours_only", "Count SLA in working hours only", "Deadlines and ticket ages count only the hours above; off = around the clock"],
    ["pause_on_approval", "Pause SLA while waiting on approval or user", "The clock stops while a purchase approval is pending, on hold or awaiting info"],
    ["auto_escalate", "Auto-escalate to team head at 80% of SLA", "Notifies the team head and assignee before a breach, not after"],
  ];
  const save = async () => {
    if (invalid) return toast.error(`“${invalid[1]}” isn't a valid time — use e.g. 30m, 4h or 3d`);
    setSaving(true);
    try {
      const result = await api("/settings/sla", {
        method: "PUT",
        body: {
          business_hours: { start: fromTime(draft.start), end: fromTime(draft.end), weekdays: draft.days },
          working_hours_only: draft.working_hours_only,
          pause_on_approval: draft.pause_on_approval,
          auto_escalate: draft.auto_escalate,
          policy: draft.policy,
        },
      });
      toast.success(`SLA rules saved · apply to new tickets${result.paused ? ` · ${result.paused} ticket${result.paused === 1 ? "" : "s"} paused for approval` : ""}${result.resumed ? ` · ${result.resumed} resumed` : ""}`);
      setText({});
      configureSla(result);
      onSaved(result);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial());

  return (
    <>
      <section className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))" }}>
        <div className="flex flex-col gap-3.5 rounded-xl border border-[#e8e7e3] bg-white p-[18px]">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Working hours</h3><span className="text-xs text-[#6b6b76]">SLA clocks and ticket ages count only these hours</span></div>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map(([label, n]) => {
              const on = draft.days.includes(n);
              return <button key={label} onClick={() => setDraft({ ...draft, days: on ? draft.days.filter((d) => d !== n) : [...draft.days, n] })} className={`rounded-lg border px-[11px] py-[7px] text-[12.5px] font-medium ${on ? "border-[#17171c] bg-[#17171c] text-white" : "border-[#e0dfdb] bg-white text-[#55555e]"}`}>{label}</button>;
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2.5"><span className="text-[#55555e]">From</span><input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className="rounded-lg border border-[#e0dfdb] px-2 py-1.5 text-[12.5px]" /><span className="text-[#55555e]">to</span><input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className="rounded-lg border border-[#e0dfdb] px-2 py-1.5 text-[12.5px]" /><span className="text-xs text-[#8a8a93]">Asia/Kolkata</span></div>
          {toggles.map(([key, l, d]) => (
            <button key={key} onClick={() => setDraft({ ...draft, [key]: !draft[key] })} className="grid items-center gap-3.5 border-t border-[#f1f0ec] py-2.5 text-left" style={{ gridTemplateColumns: "minmax(0,1fr) 36px" }}>
              <div className="flex flex-col gap-0.5"><span className="font-medium">{l}</span><span className="text-xs leading-snug text-[#6b6b76]">{d}</span></div>
              <Toggle on={draft[key]} />
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3.5 rounded-xl border border-[#e8e7e3] bg-white p-[18px]">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Priority targets</h3><span className="text-xs text-[#6b6b76]">First response and resolution by priority. Category SLAs override resolution.</span></div>
            <div className="flex gap-0.5 rounded-[9px] bg-[#efeeea] p-[3px]">{["IT", "Admin"].map((d) => <button key={d} onClick={() => setDesk(d)} className={`rounded-[7px] px-2.5 py-[5px] text-xs font-medium ${seg(desk === d)}`}>{d} desk</button>)}</div>
          </div>
          <div className="grid items-center gap-2.5" style={{ gridTemplateColumns: "minmax(0,1fr) 120px 120px" }}>
            <span className="text-[11.5px] text-[#6b6b76]">Priority</span><span className="text-[11.5px] text-[#6b6b76]">First response</span><span className="text-[11.5px] text-[#6b6b76]">Resolution</span>
            {PRIORITIES.map((p) => [
              <span key={`${p}-l`} className="flex items-center gap-2 font-medium"><span className="h-2 w-2 rounded-full" style={{ background: PRIO_COLOR[p] }} />{p}</span>,
              ...[0, 1].map((i) => {
                const value = cell(p, i);
                const bad = !parseHours(value, dayLength);
                return <input key={`${p}-${i}`} value={value} onChange={(e) => setCell(p, i, e.target.value)} className={`box-border w-full rounded-[7px] border px-2 py-1.5 text-[12.5px] ${bad ? "border-[#e3a29b]" : "border-[#e0dfdb]"}`} />;
              }),
            ])}
          </div>
          <div className="rounded-lg bg-[#f7f6f3] px-3 py-2.5 text-[12.5px] leading-normal text-[#3b3b44]">Times are working time: <b>30m</b>, <b>4h</b> or <b>3d</b> (a working day = {Math.round(dayLength * 10) / 10}h). First response is measured when a member picks the ticket up. Changes apply to new tickets and priority changes; existing deadlines are kept.</div>
          <div className="flex flex-wrap justify-end gap-2">
            {dirty && <button onClick={() => { setDraft(initial()); setText({}); }} className="rounded-lg border border-[#e0dfdb] bg-white px-3 py-2 text-[12.5px]">Discard</button>}
            <button onClick={save} disabled={saving || !dirty} className="rounded-lg bg-[#17171c] px-3.5 py-2 text-[12.5px] text-white disabled:opacity-50">{saving ? "Saving…" : "Save SLA rules"}</button>
          </div>
        </div>
      </section>
    </>
  );
}

export default function SettingsView() {
  const [tab, setTab] = useState("members");
  const [users, setUsers] = useState(null);
  const [lists, setLists] = useState([]);
  const [resets, setResets] = useState([]);
  const [sla, setSla] = useState(null);
  const load = () => {
    api("/users?with_stats=1").then(setUsers).catch((error) => toast.error(error.message));
    api("/member-checklists").then(setLists).catch(() => setLists([]));
    api("/password-reset-requests").then((rows) => setResets(rows.filter((r) => r.status === "pending"))).catch(() => setResets([]));
  };
  useEffect(() => {
    load();
    api("/settings/sla").then(setSla).catch((error) => toast.error(error.message));
  }, []);
  const dayLength = useMemo(() => (sla ? sla.business_hours.end - sla.business_hours.start : 9), [sla]);

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-4 text-[13px] text-[#17171c]">
      <header className="flex flex-wrap items-end justify-between gap-3.5">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[22px] font-semibold tracking-[-.01em]">Settings</h2>
          <div className="text-[#6b6b76]">People, access, ticket categories and SLA rules</div>
        </div>
        <div className="flex max-w-full gap-0.5 overflow-x-auto rounded-[9px] bg-[#ebeae6] p-[3px]">
          {[["members", "Members & access"], ["cats", "Ticket categories"], ["sla", "SLA & hours"]].map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`shrink-0 whitespace-nowrap rounded-[7px] px-3.5 py-[7px] text-[12.5px] font-medium ${seg(tab === k)}`}>{l}</button>)}
        </div>
      </header>
      {tab === "members" && (users ? <MembersTab users={users} lists={lists} resets={resets} reload={load} /> : <Skeleton className="h-[520px] w-full rounded-xl" />)}
      {tab === "cats" && <CategoriesTab dayLength={dayLength} />}
      {tab === "sla" && (sla ? <SlaTab key={JSON.stringify(sla)} config={sla} onSaved={(result) => setSla((s) => ({ ...s, ...result }))} /> : <Skeleton className="h-[420px] w-full rounded-xl" />)}
    </div>
  );
}

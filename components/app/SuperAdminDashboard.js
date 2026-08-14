"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/appapi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Bell,
  Building2,
  Download,
  Laptop,
} from "lucide-react";
import { toast } from "sonner";
import { workingHoursBetween } from "@/lib/sla";

const DONE = ["Resolved", "Closed", "Cancelled"];
const deptMeta = {
  IT: { icon: Laptop, color: "#2E7CD6", soft: "#E8F1FB" },
  Admin: { icon: Building2, color: "#6C5CE7", soft: "#EFEDFC" },
};

const initials = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const hours = (ms) => Math.max(0, Math.floor(ms / 3600000));
const duration = (ms) => {
  const h = hours(ms);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`;
};
const inputDate = (date) => new Date(date).toISOString().slice(0, 10);
const inRange = (ticket, from, to) => {
  const created = new Date(ticket.created_at);
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T23:59:59.999`);
  return created >= start && created <= end;
};
const makeStats = (tickets) => {
  const count = (predicate) => tickets.filter(predicate).length;
  const response = tickets
    .filter(
      (ticket) =>
        (ticket.acknowledged_at || ticket.first_response_at) &&
        (ticket.raised_at || ticket.created_at),
    )
    .map(
      (ticket) =>
        workingHoursBetween(
          ticket.raised_at || ticket.created_at,
          ticket.acknowledged_at || ticket.first_response_at,
        ),
    );
  const resolvedTimes = tickets
    .filter(
      (ticket) =>
        (ticket.resolved_at || ticket.resolution?.resolved_date) &&
        (ticket.raised_at || ticket.created_at),
    )
    .map(
      (ticket) =>
        workingHoursBetween(
          ticket.raised_at || ticket.created_at,
          ticket.resolved_at || ticket.resolution.resolved_date,
        ),
    );
  const resolvedForSla = tickets.filter(
    (ticket) =>
      (ticket.resolved_at || ticket.resolution?.resolved_date) &&
      ticket.sla_resolution_due,
  );
  const met = resolvedForSla.filter(
    (ticket) =>
      new Date(ticket.resolved_at || ticket.resolution.resolved_date) <=
      new Date(ticket.sla_resolution_due),
  ).length;
  const responseMeasured = tickets.filter(
    (ticket) =>
      ticket.acknowledged_at ||
      ticket.first_response_at ||
      (ticket.sla_response_due &&
        new Date(ticket.sla_response_due) < new Date() &&
        ticket.status !== "Cancelled"),
  );
  const responseMet = responseMeasured.filter(
    (ticket) =>
      (ticket.acknowledged_at || ticket.first_response_at) &&
      ticket.sla_response_due &&
      new Date(ticket.acknowledged_at || ticket.first_response_at) <=
        new Date(ticket.sla_response_due),
  ).length;
  const avg = (values) =>
    values.length
      ? Math.round(
          (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
        ) / 10
      : 0;
  const categories = tickets.reduce((map, ticket) => {
    map[ticket.category || "Other"] =
      (map[ticket.category || "Other"] || 0) + 1;
    return map;
  }, {});
  return {
    total: tickets.length,
    in_progress: count((ticket) => ticket.status === "In Progress"),
    resolved: count((ticket) => ticket.status === "Resolved"),
    escalated: count(
      (ticket) =>
        !DONE.includes(ticket.status) &&
        (ticket.response_sla_breached_at ||
          ticket.resolution_sla_breached_at ||
          (ticket.sla_resolution_due &&
            new Date(ticket.sla_resolution_due) < new Date())),
    ),
    avg_response_hours: avg(response),
    avg_resolution_hours: avg(resolvedTimes),
    response_sla_compliance: responseMeasured.length
      ? Math.round((responseMet / responseMeasured.length) * 100)
      : 0,
    response_sla_breached: responseMeasured.length - responseMet,
    resolution_sla_compliance: resolvedForSla.length
      ? Math.round((met / resolvedForSla.length) * 100)
      : 0,
    resolution_sla_breached: resolvedForSla.length - met,
    sla_compliance: responseMeasured.length + resolvedForSla.length
      ? Math.round(((responseMet + met) / (responseMeasured.length + resolvedForSla.length)) * 100)
      : 0,
    by_priority: ["Critical", "High", "Medium", "Low"].map((name) => ({
      name,
      value: count((ticket) => ticket.priority === name),
    })),
    by_category: Object.entries(categories).map(([name, value]) => ({
      name,
      value,
    })),
  };
};
const rangeMembers = (members, tickets) =>
  members.map((member) => {
    const assigned = tickets.filter(
      (ticket) => ticket.assignee_id === member.member_id,
    );
    const resolved = assigned.filter(
      (ticket) => ticket.resolved_at || ticket.resolution?.resolved_date,
    );
    const met = resolved.filter(
      (ticket) =>
        ticket.sla_resolution_due &&
        new Date(ticket.resolved_at || ticket.resolution.resolved_date) <=
          new Date(ticket.sla_resolution_due),
    ).length;
    const responseMeasured = assigned.filter(
      (ticket) =>
        ticket.acknowledged_at ||
        ticket.first_response_at ||
        (ticket.sla_response_due &&
          new Date(ticket.sla_response_due) < new Date() &&
          ticket.status !== "Cancelled"),
    );
    const responseMet = responseMeasured.filter(
      (ticket) =>
        (ticket.acknowledged_at || ticket.first_response_at) &&
        ticket.sla_response_due &&
        new Date(ticket.acknowledged_at || ticket.first_response_at) <=
          new Date(ticket.sla_response_due),
    ).length;
    const workingTimes = resolved
      .filter((ticket) => ticket.work_started_at)
      .map((ticket) =>
        workingHoursBetween(
          ticket.work_started_at,
          ticket.resolved_at || ticket.resolution.resolved_date,
        ),
      );
    const responseTimes = assigned
      .filter((ticket) => ticket.acknowledged_at || ticket.first_response_at)
      .map((ticket) =>
        workingHoursBetween(
          ticket.raised_at || ticket.created_at,
          ticket.acknowledged_at || ticket.first_response_at,
        ),
      );
    const resolutionTimes = resolved.map((ticket) =>
      workingHoursBetween(
        ticket.raised_at || ticket.created_at,
        ticket.resolved_at || ticket.resolution.resolved_date,
      ),
    );
    const average = (values) =>
      values.length
        ? Math.round(
            (values.reduce((sum, value) => sum + value, 0) / values.length) *
              10,
          ) / 10
        : 0;
    return {
      ...member,
      assigned: assigned.length,
      open: assigned.filter((ticket) => !DONE.includes(ticket.status)).length,
      resolved: resolved.length,
      response_sla_compliance: responseMeasured.length
        ? Math.round((responseMet / responseMeasured.length) * 100)
        : 0,
      response_sla_breached: responseMeasured.length - responseMet,
      resolution_sla_compliance: resolved.length
        ? Math.round((met / resolved.length) * 100)
        : 0,
      resolution_sla_breached: resolved.length - met,
      avg_response_hours: average(responseTimes),
      avg_resolution_hours: average(resolutionTimes),
      avg_working_hours: average(workingTimes),
      total_working_hours:
        Math.round(
          workingTimes.reduce((sum, value) => sum + value, 0) * 10,
        ) / 10,
      sla_compliance: responseMeasured.length + resolved.length
        ? Math.round(((responseMet + met) / (responseMeasured.length + resolved.length)) * 100)
        : 0,
    };
  });

function CategoryRows({ rows, tickets, color }) {
  const top = [...(rows || [])].sort((a, b) => b.value - a.value).slice(0, 6);
  const max = Math.max(...top.map((row) => row.value), 1);
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm font-semibold text-[#4B5563]">
        Categories · red = overdue share
      </p>
      {top.map((row) => {
        const categoryTickets = tickets.filter(
          (ticket) => ticket.category === row.name,
        );
        const overdue = categoryTickets.filter(
          (ticket) =>
            !DONE.includes(ticket.status) &&
            new Date(ticket.sla_resolution_due) < new Date(),
        ).length;
        return (
          <div
            key={row.name}
            className="grid grid-cols-[88px_1fr_18px] items-center gap-2 text-sm sm:grid-cols-[120px_1fr_18px] sm:gap-3"
          >
            <span className="truncate text-[#4B5563]">{row.name}</span>
            <div className="flex h-3 overflow-hidden rounded-full bg-[#F4F6F8]">
              <span
                style={{
                  width: `${((row.value - overdue) / max) * 100}%`,
                  background: color,
                }}
              />
              <span
                style={{ width: `${(overdue / max) * 100}%` }}
                className="bg-[#E84B4B]"
              />
            </div>
            <span className="text-[#777]">{row.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function PriorityMix({ stats, open }) {
  const colors = {
    Critical: "#7A1F1F",
    High: "#E8930C",
    Medium: "#EAB308",
    Low: "#1E9E6A",
  };
  const entries = stats.by_priority || [];
  const total = Math.max(
    entries.reduce((sum, entry) => sum + entry.value, 0),
    1,
  );
  let cursor = 0;
  const stops = entries
    .map((entry) => {
      const start = cursor;
      cursor += (entry.value / total) * 100;
      return `${colors[entry.name]} ${start}% ${cursor}%`;
    })
    .join(", ");
  return (
    <div className="min-w-0">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
        By priority
      </p>
      <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[100px_minmax(0,1fr)] sm:gap-4">
        <div
          className="grid h-20 w-20 shrink-0 place-items-center rounded-full sm:h-24 sm:w-24"
          style={{ background: `conic-gradient(${stops || "#EDF0F4 0 100%"})` }}
        >
          <div className="grid h-14 w-14 place-items-center rounded-full bg-white text-center sm:h-16 sm:w-16">
            <span>
              <b className="block text-xl">{open}</b>
              <small className="text-[#9CA3AF]">open</small>
            </span>
          </div>
        </div>
        <div className="grid min-w-0 gap-1.5">
          {entries.map((entry) => (
            <div
              key={entry.name}
              className="flex min-w-0 items-center gap-2 rounded-lg bg-[#FAFBFC] px-2 py-1.5"
            >
              <i
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: colors[entry.name] }}
              />
              <span className="truncate text-xs font-medium text-[#4B5563]">
                {entry.name}
              </span>
              <b className="ml-auto text-sm font-bold tabular-nums text-[#111827]">
                {entry.value}
              </b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MemberPerformance({ rows, color }) {
  return (
    <div className="border-t border-[#E5E9EF] px-5 py-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
        Member SLA performance
      </p>
      <div className="grid gap-3 xl:grid-cols-2">
        {(rows || []).map((member) => (
          <div
            key={member.member_id}
            className="rounded-xl border border-[#E5E9EF] bg-[#FAFBFC] p-3 text-sm"
          >
            <div className="flex items-center gap-3">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-semibold text-white shadow-sm"
                style={{ background: member.assigned ? color : "#8B93A1" }}
              >
                {initials(member.member_name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{member.member_name}</p>
                <p className="truncate text-xs text-[#9CA3AF]">
                  {member.location || "Location not set"}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${member.assigned ? (member.sla_compliance >= 75 ? "bg-[#E4F5EE] text-[#0E6B47]" : "bg-[#FDF3E0] text-[#8A5A06]") : "bg-[#EDF0F4] text-[#9CA3AF]"}`}
              >
                {member.assigned ? `${member.sla_compliance}% overall` : "No data"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Workload", `${member.assigned || 0} / ${member.open || 0}`, "assigned / open"],
                ["Response", `${member.avg_response_hours || 0}h`, `${member.response_sla_compliance || 0}% SLA · ${member.response_sla_breached || 0} breach`],
                ["Resolution", `${member.avg_resolution_hours || 0}h`, `${member.resolution_sla_compliance || 0}% SLA · ${member.resolution_sla_breached || 0} breach`],
                ["Active work", `${member.avg_working_hours || 0}h`, `${member.total_working_hours || 0}h total`],
              ].map(([label, value, detail]) => (
                <div key={label} className="rounded-lg bg-white px-2.5 py-2">
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                    {label}
                  </p>
                  <b className="mt-0.5 block tabular-nums text-[#111827]">
                    {value}
                  </b>
                  <p className="text-[9px] text-[#697087]">{detail}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeskCard({ department, stats, tickets, members }) {
  const meta = deptMeta[department];
  const Icon = meta.icon;
  const open = tickets.filter((ticket) => !DONE.includes(ticket.status)).length;
  return (
    <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
      <div
        className="flex flex-wrap items-center gap-3 px-4 py-4 text-white sm:px-5"
        style={{ background: department === "IT" ? "#2E7CD6" : "#1B7F6E" }}
      >
        <Icon className="h-5 w-5" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">{department} service desk</h2>
          <p className="text-xs text-white/80">Live analytics &amp; SLA</p>
        </div>
        {[
          ["Tickets", stats.total],
          ["Escalated", stats.escalated],
          ["Response SLA", `${stats.response_sla_compliance}%`],
          ["Resolution SLA", `${stats.resolution_sla_compliance}%`],
        ].map(([label, value]) => (
          <div key={label} className="min-w-[calc(50%-0.375rem)] flex-1 text-center sm:min-w-16 sm:flex-none">
            <p className="text-xl font-bold">{value}</p>
            <p className="text-[10px] text-white/80">{label}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 border-b border-[#E5E9EF] sm:grid-cols-4">
        {[
          ["Open", open, "#111827"],
          ["In progress", stats.in_progress, meta.color],
          ["Escalated", stats.escalated, "#A32D2D"],
          ["Resolved", stats.resolved, "#087017"],
        ].map(([label, value, color], index) => (
          <div
            key={label}
            className={`py-4 text-center ${index < 3 ? "border-r border-[#E5E9EF]" : ""}`}
          >
            <p className="text-2xl font-bold tabular-nums" style={{ color }}>
              {value}
            </p>
            <p className="text-sm text-[#85817D]">{label}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 border-b border-[#E5E9EF]">
        <div className="border-r border-[#E5E9EF] px-5 py-4">
          <p className="text-xs font-semibold uppercase text-[#9CA3AF]">
            Avg response
          </p>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-xl font-bold">{stats.avg_response_hours}h</p>
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${stats.response_sla_breached ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
              {stats.response_sla_breached || 0} response breach
            </span>
          </div>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs font-semibold uppercase text-[#9CA3AF]">
            Avg resolution
          </p>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-xl font-bold">
              {stats.avg_resolution_hours}h
            </p>
            <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${stats.resolution_sla_breached ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
              {stats.resolution_sla_breached || 0} resolution breach
            </span>
          </div>
        </div>
      </div>
      <div className="grid gap-6 px-5 py-5 md:grid-cols-[225px_minmax(0,1fr)]">
        <PriorityMix stats={stats} open={open} />
        <CategoryRows
          rows={stats.by_category}
          tickets={tickets}
          color={department === "IT" ? "#2E7CD6" : "#1B7F6E"}
        />
      </div>
      <MemberPerformance
        rows={members}
        color={department === "IT" ? "#2E7CD6" : "#1B7F6E"}
      />
    </Card>
  );
}

function UserIssueInsights({ tickets, onOpenTicket }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const users = useMemo(() => {
    const groups = new Map();
    for (const ticket of tickets) {
      const key =
        ticket.issue_user_id ||
        (ticket.issue_user_name
          ? `name:${ticket.issue_user_name.toLowerCase()}`
          : null) ||
        ticket.issue_user_email ||
        ticket.email ||
        ticket.raised_by_id ||
        ticket.issue_user_name ||
        ticket.raised_for_name ||
        ticket.raised_by_name;
      if (!groups.has(key)) groups.set(key, {
        key,
        name: ticket.issue_user_name || ticket.raised_for_name || ticket.raised_by_name || "Unknown user",
        email: ticket.issue_user_email || ticket.email || "",
        employeeId: ticket.issue_user_employee_code || ticket.employee_id || "",
        location: ticket.location || "",
        total: 0,
        open: 0,
        overdue: 0,
        responseMet: 0,
        responseBreached: 0,
        responsePending: 0,
        categories: {},
        latest: null,
      });
      const row = groups.get(key);
      row.total++;
      if (!DONE.includes(ticket.status)) row.open++;
      if (!DONE.includes(ticket.status) && ticket.sla_resolution_due && new Date(ticket.sla_resolution_due) < new Date()) row.overdue++;
      const responseAt = ticket.acknowledged_at || ticket.first_response_at;
      if (responseAt) {
        if (ticket.sla_response_due && new Date(responseAt) <= new Date(ticket.sla_response_due)) row.responseMet++;
        else row.responseBreached++;
      } else if (ticket.sla_response_due && new Date(ticket.sla_response_due) < new Date() && ticket.status !== "Cancelled") row.responseBreached++;
      else if (ticket.status !== "Cancelled") row.responsePending++;
      const category = ticket.category || "Other";
      row.categories[category] = (row.categories[category] || 0) + 1;
      if (!row.latest || new Date(ticket.created_at) > new Date(row.latest.created_at)) row.latest = ticket;
    }
    return [...groups.values()].map((row) => ({
      ...row,
      responseCompliance: row.responseMet + row.responseBreached
        ? Math.round((row.responseMet / (row.responseMet + row.responseBreached)) * 100)
        : 0,
      topCategories: Object.entries(row.categories).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      repeatIssue: Object.values(row.categories).some((count) => count > 1),
    })).sort((a, b) => b.total - a.total || b.overdue - a.overdue);
  }, [tickets]);
  const filtered = users.filter((user) => [user.name, user.email, user.employeeId, user.location, ...user.topCategories.map((category) => category.name)].join(" ").toLowerCase().includes(query.toLowerCase().trim()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => setPage(1), [query, tickets.length]);
  const repeatUsers = users.filter((user) => user.repeatIssue).length;
  const responseBreaches = users.reduce((sum, user) => sum + user.responseBreached, 0);
  const overdue = users.reduce((sum, user) => sum + user.overdue, 0);
  return <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
    <div className="flex flex-wrap items-center gap-3 border-b border-[#E5E9EF] px-4 py-4 sm:px-5"><div className="mr-auto"><h2 className="font-bold">Issues by requesting user</h2><p className="text-xs text-[#8B93A1]">Repeat issues, open workload and response SLA mapped to the employee who requested support.</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search user, code, location or issue…" className="h-9 w-full rounded-lg border border-[#DDE2EA] bg-[#FAFBFC] px-3 text-sm sm:min-w-72 sm:w-auto" /></div>
    <div className="grid gap-px bg-[#E5E9EF] sm:grid-cols-2 lg:grid-cols-4">{[["Users with issues", users.length], ["Repeat-issue users", repeatUsers], ["Response SLA breaches", responseBreaches], ["Overdue active issues", overdue]].map(([label, value]) => <div key={label} className="bg-white p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-[#8B93A1]">{label}</p><b className={`mt-1 block text-2xl ${/breach|overdue/i.test(label) && value ? "text-red-600" : ""}`}>{value}</b></div>)}</div>
    <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-[#FAFBFC] text-[10px] uppercase tracking-wider text-[#8B93A1]"><tr><th className="px-4 py-3">User</th><th className="px-4 py-3">Issues</th><th className="px-4 py-3">Top issue categories</th><th className="px-4 py-3 text-center">Response SLA</th><th className="px-4 py-3 text-center">Breached / pending</th><th className="px-4 py-3">Latest issue</th><th className="px-4 py-3" /></tr></thead><tbody>{rows.map((user) => <tr key={user.key} className="border-t border-[#EDF0F4]"><td className="px-4 py-3"><b>{user.name}</b><p className="text-xs text-[#69738B]">{user.employeeId || "No employee code"} · {user.location || "No location"}</p><p className="text-[10px] text-[#9CA3AF]">{user.email}</p></td><td className="px-4 py-3"><b>{user.total} total</b><p className="text-xs text-[#69738B]">{user.open} open · {user.overdue} overdue</p>{user.repeatIssue && <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Repeat pattern</span>}</td><td className="px-4 py-3">{user.topCategories.slice(0, 3).map((category) => <span key={category.name} className="mr-1 inline-block rounded-md bg-[#F1F3F7] px-2 py-1 text-[11px]">{category.name} · {category.count}</span>)}</td><td className="px-4 py-3 text-center"><span className={`rounded-full px-2 py-1 text-xs font-bold ${user.responseCompliance >= 80 ? "bg-emerald-100 text-emerald-800" : user.responseCompliance >= 50 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>{user.responseCompliance}%</span><p className="mt-1 text-[10px] text-[#8B93A1]">{user.responseMet} within SLA</p></td><td className="px-4 py-3 text-center"><b className={user.responseBreached ? "text-red-600" : ""}>{user.responseBreached}</b><span className="px-1 text-[#B0B6C2]">/</span><b className="text-amber-600">{user.responsePending}</b></td><td className="max-w-64 px-4 py-3"><b className="block truncate text-xs">{user.latest?.human_id} · {user.latest?.title}</b><p className="text-[10px] text-[#8B93A1]">{user.latest?.created_at ? new Date(user.latest.created_at).toLocaleString("en-GB") : "—"}</p></td><td className="px-4 py-3"><Button variant="outline" size="sm" disabled={!user.latest?.id || !onOpenTicket} onClick={() => onOpenTicket?.(user.latest.id)}>Open latest</Button></td></tr>)}</tbody></table></div>
    {!rows.length && <p className="p-8 text-center text-sm text-[#69738B]">No matching user issues in the selected date range.</p>}
    {filtered.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E9EF] bg-[#FAFBFC] px-5 py-3"><p className="text-xs text-[#69738B]">Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} users</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><span className="text-xs font-semibold">Page {currentPage} of {pageCount}</span><Button variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</Button></div></div>}
  </Card>;
}

export default function SuperAdminDashboard({ onViewKra, onOpenTicket }) {
  const [data, setData] = useState(null);
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 6);
    return inputDate(date);
  });
  const [to, setTo] = useState(() => inputDate(new Date()));
  useEffect(() => {
    Promise.all([
      api("/dashboard?department=IT"),
      api("/dashboard?department=Admin"),
      api("/tickets?department=IT&limit=200"),
      api("/tickets?department=Admin&limit=200"),
      api("/reports/member-sla?department=IT"),
      api("/reports/member-sla?department=Admin"),
      api("/reports/daily-kra"),
    ])
      .then(([it, admin, itTickets, adminTickets, itSla, adminSla, kra]) =>
        setData({
          it,
          admin,
          itTickets: itTickets.items,
          adminTickets: adminTickets.items,
          itSla,
          adminSla,
          kra,
        }),
      )
      .catch(() => {});
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const itTickets = data.itTickets.filter((ticket) =>
      inRange(ticket, from, to),
    );
    const adminTickets = data.adminTickets.filter((ticket) =>
      inRange(ticket, from, to),
    );
    return {
      ...data,
      itTickets,
      adminTickets,
      it: makeStats(itTickets),
      admin: makeStats(adminTickets),
      itMembers: rangeMembers(data.itSla.members, itTickets),
      adminMembers: rangeMembers(data.adminSla.members, adminTickets),
    };
  }, [data, from, to]);

  const attention = useMemo(() => {
    if (!view) return null;
    const active = [...view.itTickets, ...view.adminTickets].filter(
      (ticket) =>
        !DONE.includes(ticket.status) &&
        ticket.sla_resolution_due &&
        new Date(ticket.sla_resolution_due) < new Date(),
    );
    const longest = active.sort(
      (a, b) => new Date(a.sla_resolution_due) - new Date(b.sla_resolution_due),
    )[0];
    const slow = view.it.avg_resolution_hours
      ? (
          view.admin.avg_resolution_hours / view.it.avg_resolution_hours
        ).toFixed(1)
      : "—";
    const weakest = [...(view.adminMembers || [])].sort(
      (a, b) => a.sla_compliance - b.sla_compliance,
    )[0];
    return { longest, slow, weakest };
  }, [view]);

  if (!data) return <Skeleton className="h-[520px] w-full rounded-xl" />;
  const kraMembers = data.kra.members || [];
  const submitted = kraMembers.filter(
    (member) => member.submitted_lists > 0,
  ).length;
  const pendingTasks = kraMembers.reduce(
    (sum, member) => sum + Math.max(0, member.total_items - member.done_items),
    0,
  );
  const exportReport = () => {
    const allTickets = [...view.itTickets, ...view.adminTickets];
    const csvCell = (value) => {
      const text = String(value ?? "");
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const dateTime = (value) =>
      value ? new Date(value).toLocaleString("en-GB") : "";
    const ticketStatusCount = (tickets, status) =>
      tickets.filter((ticket) => ticket.status === status).length;
    const resourceRows = (department, members, tickets) => {
      const rows = members.map((member) => {
        const assigned = tickets.filter(
          (ticket) => ticket.assignee_id === member.member_id,
        );
        const overdue = assigned.filter(
          (ticket) =>
            !DONE.includes(ticket.status) &&
            ticket.sla_resolution_due &&
            new Date(ticket.sla_resolution_due) < new Date(),
        ).length;
        return [
          department,
          member.member_name,
          member.email || "",
          member.location || "",
          assigned.length,
          ticketStatusCount(assigned, "Open"),
          ticketStatusCount(assigned, "Assigned"),
          ticketStatusCount(assigned, "Acknowledged"),
          ticketStatusCount(assigned, "In Progress"),
          assigned.filter((ticket) =>
            [
              "Pending User Response",
              "Pending Vendor",
              "Pending Finance",
              "Pending Material",
              "On Hold",
            ].includes(ticket.status),
          ).length,
          assigned.filter((ticket) =>
            [
              "Pending Super Admin Approval",
              "Clarification Required",
              "Approval On Hold",
            ].includes(ticket.status),
          ).length,
          ticketStatusCount(assigned, "Resolved"),
          ticketStatusCount(assigned, "Closed"),
          overdue,
          `${member.sla_compliance || 0}%`,
          `${member.avg_response_hours || 0}h`,
          `${member.avg_resolution_hours || 0}h`,
          `${member.avg_working_hours || 0}h`,
        ];
      });
      const unassigned = tickets.filter((ticket) => !ticket.assignee_id);
      if (unassigned.length)
        rows.push([
          department,
          "Unassigned / Team queue",
          "",
          "",
          unassigned.length,
          ticketStatusCount(unassigned, "Open"),
          ticketStatusCount(unassigned, "Assigned"),
          ticketStatusCount(unassigned, "Acknowledged"),
          ticketStatusCount(unassigned, "In Progress"),
          unassigned.filter((ticket) => ticket.status.startsWith("Pending"))
            .length,
          unassigned.filter((ticket) => ticket.status.includes("Approval"))
            .length,
          ticketStatusCount(unassigned, "Resolved"),
          ticketStatusCount(unassigned, "Closed"),
          unassigned.filter(
            (ticket) =>
              ticket.sla_resolution_due &&
              new Date(ticket.sla_resolution_due) < new Date(),
          ).length,
          "—",
          "—",
          "—",
          "—",
        ]);
      return rows;
    };
    const rows = [
      ["TICKETFLOW DETAILED OPERATIONS REPORT"],
      ["Date range", `${from} to ${to}`],
      ["Generated at", new Date().toLocaleString("en-GB")],
      [],
      ["DEPARTMENT SUMMARY"],
      [
        "Department",
        "Tickets",
        "Open",
        "In progress",
        "Escalated",
        "Resolved",
        "SLA met",
        "Avg response",
        "Avg resolution",
      ],
      [
        "IT",
        view.it.total,
        view.itTickets.filter((ticket) => !DONE.includes(ticket.status)).length,
        view.it.in_progress,
        view.it.escalated,
        view.it.resolved,
        `${view.it.sla_compliance}%`,
        `${view.it.avg_response_hours}h`,
        `${view.it.avg_resolution_hours}h`,
      ],
      [
        "Admin",
        view.admin.total,
        view.adminTickets.filter((ticket) => !DONE.includes(ticket.status))
          .length,
        view.admin.in_progress,
        view.admin.escalated,
        view.admin.resolved,
        `${view.admin.sla_compliance}%`,
        `${view.admin.avg_response_hours}h`,
        `${view.admin.avg_resolution_hours}h`,
      ],
      [],
      ["RESOURCE / MEMBER STATUS SUMMARY"],
      [
        "Department",
        "Member / Resource",
        "Email",
        "Location",
        "Total assigned",
        "Open",
        "Assigned",
        "Acknowledged",
        "In progress",
        "Pending / On hold",
        "Pending approval",
        "Resolved",
        "Closed",
        "Overdue",
        "SLA met",
        "Avg response",
        "Avg resolution",
        "Avg member work",
      ],
      ...resourceRows("IT", view.itMembers || [], view.itTickets),
      ...resourceRows("Admin", view.adminMembers || [], view.adminTickets),
      [],
      ["TICKET-LEVEL ASSIGNMENT DETAILS"],
      [
        "Ticket ID",
        "Department",
        "Title",
        "Category",
        "Priority",
        "Status",
        "Assigned member",
        "Assignee ID",
        "Raised by",
        "Raised for",
        "Employee ID",
        "Email",
        "Location",
        "Created at",
        "Raised at",
        "Allocated at",
        "Allocated by",
        "Acknowledged at",
        "Acknowledged by",
        "Work started at",
        "Working member",
        "SLA response due",
        "SLA resolution due",
        "SLA state",
        "Resolved at",
        "Resolved by",
        "Closed at",
        "Closed by",
        "Member working hours",
        "Resolution summary",
        "Action taken",
        "Root cause",
        "Approval required",
        "Description",
      ],
      ...allTickets
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map((ticket) => {
          const resolvedAt = ticket.resolved_at || ticket.resolution?.resolved_date;
          const slaState = resolvedAt
            ? new Date(resolvedAt) <= new Date(ticket.sla_resolution_due)
              ? "Met"
              : "Breached"
            : DONE.includes(ticket.status)
              ? "Closed"
              : ticket.sla_resolution_due &&
                  new Date(ticket.sla_resolution_due) < new Date()
                ? "Overdue"
                : "Within SLA";
          return [
            ticket.human_id,
            ticket.department,
            ticket.title,
            ticket.category,
            ticket.priority,
            ticket.status,
            ticket.assignee_name || "Unassigned / Team queue",
            ticket.assignee_id || "",
            ticket.raised_by_name,
            ticket.raised_for_name,
            ticket.employee_id,
            ticket.email,
            ticket.location,
            dateTime(ticket.created_at),
            dateTime(ticket.raised_at || ticket.created_at),
            dateTime(ticket.assigned_at),
            ticket.assigned_by_name || "",
            dateTime(ticket.acknowledged_at || ticket.first_response_at),
            ticket.acknowledged_by_name || ticket.first_response_by_name || "",
            dateTime(ticket.work_started_at),
            ticket.work_started_by_name || ticket.assignee_name || "",
            dateTime(ticket.sla_response_due),
            dateTime(ticket.sla_resolution_due),
            slaState,
            dateTime(resolvedAt),
            ticket.resolved_by_name || ticket.resolution?.resolved_by || "",
            dateTime(ticket.closed_at),
            ticket.closed_by_name || "",
            ticket.member_working_minutes != null
              ? Math.round((ticket.member_working_minutes / 60) * 10) / 10
              : "",
            ticket.resolution?.summary || "",
            ticket.resolution?.action_taken || "",
            ticket.resolution?.root_cause || "",
            ticket.approval_required ? "Yes" : "No",
            ticket.description || "",
          ];
        }),
    ];
    const blob = new Blob(
      ["\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ticketflow-detailed-report-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const remindAll = async () => {
    try {
      const result = await api("/member-checklists/remind-pending", {
        method: "POST",
      });
      toast.success(
        `Reminder sent to ${result.reminded} pending member${result.reminded === 1 ? "" : "s"}`,
      );
    } catch (error) {
      toast.error(error.message);
    }
  };
  return (
    <div className="space-y-4 text-[#111827]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-[#9CA3AF]">
            Live analytics &amp; SLA ·{" "}
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <label className="w-full text-xs font-semibold text-[#4B5563] sm:w-auto">
            From
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1 block h-9 w-full rounded-md border border-[#E5E9EF] bg-white px-3 text-sm sm:w-auto"
            />
          </label>
          <label className="w-full text-xs font-semibold text-[#4B5563] sm:w-auto">
            To
            <input
              type="date"
              value={to}
              min={from}
              max={inputDate(new Date())}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1 block h-9 w-full rounded-md border border-[#E5E9EF] bg-white px-3 text-sm sm:w-auto"
            />
          </label>
          <Button className="w-full sm:w-auto" variant="outline" onClick={exportReport}>
            <Download className="h-4 w-4" />
            Export report
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-xl border border-[#F5C9C9] bg-[#FDECEC] px-5 py-4 text-sm text-[#942828]">
        <span className="flex items-center gap-2 font-bold">
          <AlertTriangle className="h-4 w-4" />
          Needs attention
        </span>
        <span>
          Longest overdue:{" "}
          <b>
            {attention.longest
              ? `${attention.longest.human_id} · ${duration(Date.now() - new Date(attention.longest.sla_resolution_due))}`
              : "None"}
          </b>
        </span>
        <span>
          Admin resolution <b>{attention.slow}× slower</b> than IT
        </span>
        <span>
          {attention.weakest?.member_name}:{" "}
          <b>{attention.weakest?.sla_compliance || 0}% SLA met</b>
        </span>
      </div>


      <div className="grid gap-4 xl:grid-cols-[1fr_120px_1fr]">
        <DeskCard
          department="IT"
          stats={view.it}
          tickets={view.itTickets}
          members={view.itMembers}
        />
        <div className="hidden flex-col items-center justify-center gap-3 xl:flex">
          <p className="text-xs font-semibold uppercase text-[#9CA3AF]">
            IT vs Admin
          </p>
          {[
            [
              "Response SLA",
              `${view.it.response_sla_compliance}%`,
              `${view.admin.response_sla_compliance}%`,
            ],
            [
              "Resolution SLA",
              `${view.it.resolution_sla_compliance}%`,
              `${view.admin.resolution_sla_compliance}%`,
            ],
            [
              "Resolution",
              `${view.it.avg_resolution_hours}h`,
              `${view.admin.avg_resolution_hours}h`,
            ],
            ["Escalated", view.it.escalated, view.admin.escalated],
            [
              "Response",
              `${view.it.avg_response_hours}h`,
              `${view.admin.avg_response_hours}h`,
            ],
          ].map(([label, itValue, adminValue]) => (
            <Card
              key={label}
              className="w-full px-2 py-3 text-center shadow-none"
            >
              <p className="text-xs font-semibold text-[#9CA3AF]">{label}</p>
              <p className="mt-1 font-bold text-green-700">{itValue}</p>
              <p className="text-[10px] text-[#9CA3AF]">vs</p>
              <p className="font-bold text-red-600">{adminValue}</p>
            </Card>
          ))}
        </div>
        <DeskCard
          department="Admin"
          stats={view.admin}
          tickets={view.adminTickets}
          members={view.adminMembers}
        />
      </div>

      <UserIssueInsights
        tickets={[...view.itTickets, ...view.adminTickets]}
        onOpenTicket={onOpenTicket}
      />

      <Card className="flex flex-wrap items-center gap-5 border-[#E5E9EF] px-5 py-4 shadow-none">
        <div>
          <p className="font-bold">Daily KRA compliance</p>
          <p className="text-xs text-[#9CA3AF]">{data.kra.date}</p>
        </div>
        <span className="font-medium text-red-700">
          {submitted}/{kraMembers.length} submitted
        </span>
        <div className="flex -space-x-2">
          {kraMembers.map((member) => (
            <span
              key={member.member_id}
              title={`${member.member_name}: ${member.status}`}
              className={`grid h-9 w-9 place-items-center rounded-full border-2 border-white text-xs font-semibold ${member.status === "Completed" ? "bg-[#DDF4E9] text-[#0E6B47]" : member.status === "Issue" ? "bg-[#DC3D3D] text-white" : member.status === "Partial" ? "bg-[#FDF3E0] text-[#8A5A06]" : "bg-[#EEF0F3] text-[#697087]"}`}
            >
              {initials(member.member_name)}
            </span>
          ))}
        </div>
        <span className="text-sm text-[#4B5563]">
          {pendingTasks} tasks pending across IT and Admin teams
        </span>
        <Button variant="outline" className="ml-auto" onClick={remindAll}>
          <Bell className="h-4 w-4" />
          Remind all
        </Button>
        <Button className="bg-[#131C26] hover:bg-[#1C2836]" onClick={onViewKra}>
          View KRA board
        </Button>
      </Card>
    </div>
  );
}

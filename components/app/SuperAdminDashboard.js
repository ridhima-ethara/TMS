"use client";

import { useEffect, useMemo, useState } from "react";
import { api, fetchAllTickets } from "@/lib/appapi";
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
import TeamPerformance from "@/components/app/TeamPerformance";
import MemberReport from "@/components/app/MemberReport";
import OperationsOverview from "@/components/app/OperationsOverview";
import { IncidentReportsPanel } from "@/components/app/IncidentReports";

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

// Checklist submissions are keyed by an IST calendar day, and every timestamp on them
// is read back in IST, because that is the timezone the cutoff and the whole SLA
// engine are defined in.
const IST = "Asia/Kolkata";
const istTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString("en-GB", {
        timeZone: IST,
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const istDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", {
        timeZone: IST,
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
/** Minutes past IST midnight, used to average clock times across days. */
const istMinuteOfDay = (value) => {
  if (!value) return null;
  const [h, m] = istTime(value).split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
const minutesToClock = (minutes) =>
  minutes == null
    ? "—"
    : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
        Math.round(minutes % 60),
      ).padStart(2, "0")}`;

/**
 * Groups checklist submissions per member for the selected range.
 *
 * `created_at` is the first entry of the day and `submitted_at` is the most
 * recent update — a re-submission overwrites `submitted_at` in place, so these
 * two are the only update times the records preserve. Individual intermediate
 * saves are not recoverable, which is why this reports first/last rather than a
 * full edit history.
 */
const kraActivityByMember = (submissions, from, to) => {
  const map = new Map();
  for (const entry of submissions || []) {
    const day = String(entry.date || "").slice(0, 10);
    if (!day || day < from || day > to) continue;
    const id = entry.member_id;
    if (!map.has(id))
      map.set(id, {
        member_id: id,
        member_name: entry.member_name,
        submissions: 0,
        days: new Set(),
        done: 0,
        total: 0,
        late: 0,
        revised: 0,
        firstEntryMinutes: [],
        lastUpdateMinutes: [],
        entries: [],
      });
    const row = map.get(id);
    const first = entry.created_at || entry.submitted_at;
    const last = entry.submitted_at || entry.created_at;
    row.submissions += 1;
    row.days.add(day);
    row.done += Number(entry.done_count) || 0;
    row.total += Number(entry.total) || 0;
    if (entry.late) row.late += 1;
    // A gap of more than a minute means the member came back and revised it.
    if (first && last && new Date(last) - new Date(first) > 60_000)
      row.revised += 1;
    const firstMinutes = istMinuteOfDay(first);
    const lastMinutes = istMinuteOfDay(last);
    if (firstMinutes != null) row.firstEntryMinutes.push(firstMinutes);
    if (lastMinutes != null) row.lastUpdateMinutes.push(lastMinutes);
    row.entries.push({
      date: day,
      title: entry.checklist_title,
      done: Number(entry.done_count) || 0,
      total: Number(entry.total) || 0,
      status: entry.status,
      late: Boolean(entry.late),
      firstEntryAt: first,
      lastUpdateAt: last,
      deadlineAt: entry.deadline_at,
    });
  }
  const mean = (values) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  for (const row of map.values()) {
    row.dayCount = row.days.size;
    row.completion = row.total
      ? Math.round((row.done / row.total) * 100)
      : 0;
    row.avgFirstEntry = minutesToClock(mean(row.firstEntryMinutes));
    row.avgLastUpdate = minutesToClock(mean(row.lastUpdateMinutes));
    row.earliestFirstEntry = minutesToClock(
      row.firstEntryMinutes.length ? Math.min(...row.firstEntryMinutes) : null,
    );
    row.latestUpdate = minutesToClock(
      row.lastUpdateMinutes.length ? Math.max(...row.lastUpdateMinutes) : null,
    );
    row.entries.sort((a, b) => b.date.localeCompare(a.date));
  }
  return map;
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
    // Open = raised or claimed but not started (covers the Unallocated and
    // Open board columns); working = every other active status. The two are
    // disjoint, so Open never double-counts tickets already being worked on.
    open: count((ticket) => ticket.status === "Open"),
    active: count((ticket) => !DONE.includes(ticket.status)),
    working: count(
      (ticket) => !DONE.includes(ticket.status) && ticket.status !== "Open",
    ),
    working_breakdown: Object.entries(
      tickets.reduce((map, ticket) => {
        if (!DONE.includes(ticket.status) && ticket.status !== "Open")
          map[ticket.status] = (map[ticket.status] || 0) + 1;
        return map;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => `${name}: ${value}`)
      .join(" · "),
    in_progress: count((ticket) => ticket.status === "In Progress"),
    // Completed work: tickets auto-close when no user confirmation is
    // required, so "Resolved" must count Closed tickets too.
    resolved: count((ticket) => ["Resolved", "Closed"].includes(ticket.status)),
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
const rangeMembers = (members, tickets, kraActivity) =>
  members.map((member) => {
    const assigned = tickets.filter(
      (ticket) => ticket.assignee_id === member.member_id,
    );
    const resolved = assigned.filter(
      (ticket) => ticket.resolved_at || ticket.resolution?.resolved_date,
    );
    // Only tickets carrying a resolution deadline can be judged against one.
    // Dividing by every resolved ticket (as this did) silently understates a
    // member's compliance for any ticket without sla_resolution_due, and
    // disagreed with the desk-level maths in makeStats.
    const resolvedForSla = resolved.filter(
      (ticket) => ticket.sla_resolution_due,
    );
    const met = resolvedForSla.filter(
      (ticket) =>
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
    // "Handling time" is elapsed IST business time from the moment the member
    // picked the ticket up to the moment it was resolved. It is NOT effort:
    // members run several tickets at once, so these windows overlap and must
    // never be summed into an "hours worked" figure.
    //
    // work_started_at (set when a ticket moves to In Progress) is only present
    // on about a fifth of resolved tickets, so it falls back to the
    // acknowledgement time. `handled_from_work_started` reports how many rows
    // used the precise field, so the average can be read with that in mind.
    const workSpans = resolved
      .map((ticket) => ({
        precise: Boolean(ticket.work_started_at),
        from:
          ticket.work_started_at ||
          ticket.acknowledged_at ||
          ticket.first_response_at,
        to: ticket.resolved_at || ticket.resolution.resolved_date,
      }))
      .filter((span) => span.from && span.to);
    const workingTimes = workSpans.map((span) =>
      workingHoursBetween(span.from, span.to),
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
      resolution_sla_compliance: resolvedForSla.length
        ? Math.round((met / resolvedForSla.length) * 100)
        : 0,
      resolution_sla_breached: resolvedForSla.length - met,
      avg_response_hours: average(responseTimes),
      avg_resolution_hours: average(resolutionTimes),
      avg_working_hours: average(workingTimes),
      handled_count: workSpans.length,
      handled_from_work_started: workSpans.filter((span) => span.precise)
        .length,
      // Kept for the export, but labelled as overlapping elapsed time rather
      // than as hours worked.
      total_working_hours:
        Math.round(
          workingTimes.reduce((sum, value) => sum + value, 0) * 10,
        ) / 10,
      kra: kraActivity?.get(member.member_id) || null,
      sla_compliance: responseMeasured.length + resolvedForSla.length
        ? Math.round(((responseMet + met) / (responseMeasured.length + resolvedForSla.length)) * 100)
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

function PriorityMix({ stats, total }) {
  const colors = {
    Critical: "#7A1F1F",
    High: "#E8930C",
    Medium: "#EAB308",
    Low: "#1E9E6A",
  };
  const entries = stats.by_priority || [];
  const ringTotal = Math.max(
    entries.reduce((sum, entry) => sum + entry.value, 0),
    1,
  );
  let cursor = 0;
  const stops = entries
    .map((entry) => {
      const start = cursor;
      cursor += (entry.value / ringTotal) * 100;
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
          style={{ background: `conic-gradient(${stops || "var(--ring-track-cool) 0 100%"})` }}
        >
          <div className="grid h-14 w-14 place-items-center rounded-full bg-white text-center sm:h-16 sm:w-16">
            <span>
              {/* The ring and the legend both describe every ticket in the
                  selected range, so the centre figure has to be that same
                  total. It previously showed the active count, which left the
                  number disagreeing with the segments around it. */}
              <b className="block text-xl">{total}</b>
              <small className="text-[#9CA3AF]">in range</small>
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

function MemberPerformance({ rows, color, unassigned = 0, onSelect }) {
  const assignedTotal = (rows || []).reduce(
    (sum, member) => sum + (member.assigned || 0),
    0,
  );
  return (
    <div className="border-t border-[#E5E9EF] px-5 py-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
        Member SLA performance
        <span className="ml-2 normal-case tracking-normal text-[#8B93A1]">
          {assignedTotal} assigned to members
          {unassigned ? ` · ${unassigned} in the unassigned team queue` : ""}
          {" · select a member for the full report"}
        </span>
      </p>
      <div className="grid gap-3 xl:grid-cols-2">
        {(rows || []).map((member) => (
          <button
            key={member.member_id}
            type="button"
            onClick={() => onSelect?.(member)}
            aria-label={`Open consolidated report for ${member.member_name}`}
            className="member-card w-full rounded-xl border border-[#E5E9EF] bg-[#FAFBFC] p-3 text-left text-sm transition-all hover:border-[#C9D2DD] hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ED00ED]"
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
                // Elapsed pickup-to-resolve business time, averaged per ticket.
                // The per-ticket average is the meaningful figure; the sum of
                // these windows overlaps and is not hours worked.
                [
                  "Handling time",
                  `${member.avg_working_hours || 0}h`,
                  `avg over ${member.handled_count || 0} resolved`,
                ],
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
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white px-2.5 py-2 text-[10px] text-[#697087]">
              <span className="font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Checklist
              </span>
              {member.kra ? (
                <>
                  <span>
                    <b>{member.kra.dayCount}</b> day
                    {member.kra.dayCount === 1 ? "" : "s"} ·{" "}
                    <b>{member.kra.completion}%</b> tasks done
                  </span>
                  <span>
                    updated <b>{member.kra.avgFirstEntry}</b> →{" "}
                    <b>{member.kra.avgLastUpdate}</b> IST
                  </span>
                  {member.kra.late > 0 && (
                    <span className="font-semibold text-red-600">
                      {member.kra.late} late
                    </span>
                  )}
                </>
              ) : (
                <span>No submissions in range</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function DeskCard({ department, stats, tickets, members, onSelectMember }) {
  const meta = deptMeta[department];
  const Icon = meta.icon;
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
          // Deliberately a live, all-dates figure (see the view memo), so it is
          // labelled to stop it being read as part of the selected range.
          ["Escalated · live", stats.escalated],
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
          [
            "Open",
            stats.open,
            "var(--stat-open)",
            "Status Open — raised or claimed, but work has not started",
          ],
          ["In progress", stats.working, meta.color, stats.working_breakdown || "No active work"],
          [
            "Escalated · live",
            stats.escalated,
            "var(--stat-escalated)",
            "Active tickets past response or resolution SLA — live across all dates, not the selected range",
          ],
          ["Closed", stats.resolved, "var(--stat-closed)", "Completed tickets"],
        ].map(([label, value, color, tip], index) => (
          <div
            key={label}
            title={tip}
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
        <PriorityMix stats={stats} total={stats.total} />
        <CategoryRows
          rows={stats.by_category}
          tickets={tickets}
          color={department === "IT" ? "#2E7CD6" : "#1B7F6E"}
        />
      </div>
      <MemberPerformance
        rows={members}
        onSelect={onSelectMember}
        unassigned={
          tickets.filter((ticket) => !ticket.assignee_id).length
        }
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
      // Group by the most stable identifier available so one person never
      // splits into multiple rows: email → employee code → user id → name.
      const email = (ticket.issue_user_email || ticket.email || "")
        .trim()
        .toLowerCase();
      const employeeCode = (
        ticket.issue_user_employee_code ||
        ticket.employee_id ||
        ""
      )
        .toString()
        .trim()
        .toLowerCase();
      const name = (
        ticket.issue_user_name ||
        ticket.raised_for_name ||
        ticket.raised_by_name ||
        ""
      )
        .trim()
        .toLowerCase();
      const key =
        (email && `email:${email}`) ||
        (employeeCode && `code:${employeeCode}`) ||
        ticket.issue_user_id ||
        (name && `name:${name}`) ||
        `ticket:${ticket.id}`;
      if (!groups.has(key)) groups.set(key, {
        key,
        name: ticket.issue_user_name || ticket.raised_for_name || ticket.raised_by_name || "Unknown user",
        email: ticket.issue_user_email || ticket.email || "",
        employeeId: ticket.issue_user_employee_code || ticket.employee_id || "",
        location: ticket.location || "",
        total: 0,
        open: 0,
        inProgress: 0,
        overdue: 0,
        responseMet: 0,
        responseBreached: 0,
        responsePending: 0,
        categories: {},
        latest: null,
      });
      const row = groups.get(key);
      row.total++;
      if (ticket.status === "Open") row.open++;
      else if (!DONE.includes(ticket.status)) row.inProgress++;
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
    <div className="flex flex-wrap items-center gap-3 border-b border-[#E5E9EF] px-4 py-4 sm:px-5"><div className="mr-auto"><h2 className="font-bold">Issues raised by users</h2><p className="text-xs text-[#8B93A1]">Repeat issues, open and in-progress workload, and response SLA mapped to the user who raised each ticket.</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search user, code, location or issue…" className="h-9 w-full rounded-lg border border-[#DDE2EA] bg-[#FAFBFC] px-3 text-sm sm:min-w-72 sm:w-auto" /></div>
    <div className="grid gap-px bg-[#E5E9EF] sm:grid-cols-2 lg:grid-cols-4">{[["Users who raised issues", users.length], ["Repeat-issue users", repeatUsers], ["Response SLA breaches", responseBreaches], ["Overdue active issues", overdue]].map(([label, value]) => <div key={label} className="bg-white p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-[#8B93A1]">{label}</p><b className={`mt-1 block text-2xl ${/breach|overdue/i.test(label) && value ? "text-red-600" : ""}`}>{value}</b></div>)}</div>
    <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-[#FAFBFC] text-[10px] uppercase tracking-wider text-[#8B93A1]"><tr><th className="px-4 py-3">User</th><th className="px-4 py-3">Issues</th><th className="px-4 py-3">Top issue categories</th><th className="px-4 py-3 text-center">Response SLA</th><th className="px-4 py-3 text-center">Response breached / pending</th><th className="px-4 py-3">Latest issue</th><th className="px-4 py-3" /></tr></thead><tbody>{rows.map((user) => <tr key={user.key} className="border-t border-[#EDF0F4]"><td className="px-4 py-3"><b>{user.name}</b><p className="text-xs text-[#69738B]">{user.employeeId || "No employee code"} · {user.location || "No location"}</p><p className="text-[10px] text-[#9CA3AF]">{user.email}</p></td><td className="px-4 py-3"><b>{user.total} total</b><p className="text-xs text-[#69738B]">{user.open} open · {user.inProgress} in progress{user.overdue ? ` · ${user.overdue} overdue` : ""}</p>{user.repeatIssue && <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Repeat pattern</span>}</td><td className="px-4 py-3">{user.topCategories.slice(0, 3).map((category) => <span key={category.name} className="mr-1 inline-block rounded-md bg-[#F1F3F7] px-2 py-1 text-[11px]">{category.name} · {category.count}</span>)}</td><td className="px-4 py-3 text-center"><span className={`rounded-full px-2 py-1 text-xs font-bold ${user.responseCompliance >= 80 ? "bg-emerald-100 text-emerald-800" : user.responseCompliance >= 50 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>{user.responseCompliance}%</span><p className="mt-1 text-[10px] text-[#8B93A1]">{user.responseMet} within SLA</p></td><td className="px-4 py-3 text-center"><b className={user.responseBreached ? "text-red-600" : ""}>{user.responseBreached}</b><span className="px-1 text-[#B0B6C2]">/</span><b className="text-amber-600">{user.responsePending}</b></td><td className="max-w-64 px-4 py-3"><b className="block truncate text-xs">{user.latest?.human_id} · {user.latest?.title}</b><p className="text-[10px] text-[#8B93A1]">{user.latest?.created_at ? new Date(user.latest.created_at).toLocaleString("en-GB") : "—"}</p></td><td className="px-4 py-3"><Button variant="outline" size="sm" disabled={!user.latest?.id || !onOpenTicket} onClick={() => onOpenTicket?.(user.latest.id)}>Open latest</Button></td></tr>)}</tbody></table></div>
    {!rows.length && <p className="p-8 text-center text-sm text-[#69738B]">No matching user issues in the selected date range.</p>}
    {filtered.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E9EF] bg-[#FAFBFC] px-5 py-3"><p className="text-xs text-[#69738B]">Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} users</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><span className="text-xs font-semibold">Page {currentPage} of {pageCount}</span><Button variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</Button></div></div>}
  </Card>;
}

export default function SuperAdminDashboard({ onViewKra, onViewIncidents, onOpenTicket }) {
  const [data, setData] = useState(null);
  const [memberReport, setMemberReport] = useState(null);
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 6);
    return inputDate(date);
  });
  const [to, setTo] = useState(() => inputDate(new Date()));
  useEffect(() => {
    const load = () =>
      Promise.all([
        api("/dashboard?department=IT"),
        api("/dashboard?department=Admin"),
        // Paged fetches: IT alone is past the 1000-row page cap, and a single
        // page silently dropped the oldest tickets from every figure below.
        fetchAllTickets("department=IT"),
        fetchAllTickets("department=Admin"),
        api("/reports/member-sla?department=IT"),
        api("/reports/member-sla?department=Admin"),
        api("/reports/daily-kra"),
        // Checklist activity for the whole period. Fetched unfiltered and narrowed
        // client-side, matching how tickets are handled, so changing the date
        // range never needs another round trip.
        api("/member-checklist-submissions?limit=5000"),
      ])
        .then(
          ([
            it,
            admin,
            itTickets,
            adminTickets,
            itSla,
            adminSla,
            kra,
            kraSubmissions,
          ]) =>
            setData({
              it,
              admin,
              itTickets: itTickets.items,
              adminTickets: adminTickets.items,
              itSla,
              adminSla,
              kra,
              kraSubmissions: Array.isArray(kraSubmissions)
                ? kraSubmissions
                : [],
            }),
        )
        .catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const itTickets = data.itTickets.filter((ticket) =>
      inRange(ticket, from, to),
    );
    const adminTickets = data.adminTickets.filter((ticket) =>
      inRange(ticket, from, to),
    );
    // Volume and SLA averages describe the selected period, but escalation is
    // a live operational state: a ticket breaches precisely because it is old,
    // so range-filtering it would hide the tickets that most need attention.
    // The server computes escalated over every ticket, unpaged; use that.
    const kraActivity = kraActivityByMember(data.kraSubmissions, from, to);
    return {
      ...data,
      itTickets,
      adminTickets,
      allTickets: [...data.itTickets, ...data.adminTickets],
      kraActivity,
      it: { ...makeStats(itTickets), escalated: data.it.escalated ?? 0 },
      admin: {
        ...makeStats(adminTickets),
        escalated: data.admin.escalated ?? 0,
      },
      itMembers: rangeMembers(data.itSla.members, itTickets, kraActivity),
      adminMembers: rangeMembers(
        data.adminSla.members,
        adminTickets,
        kraActivity,
      ),
    };
  }, [data, from, to]);

  const attention = useMemo(() => {
    if (!view) return null;
    // Overdue work is drawn from every loaded ticket, not the date-filtered
    // view: the longest-overdue ticket is almost always older than the range.
    const active = view.allTickets.filter(
      (ticket) =>
        !DONE.includes(ticket.status) &&
        ticket.sla_resolution_due &&
        new Date(ticket.sla_resolution_due) < new Date(),
    );
    const overdue = [...active].sort(
      (a, b) => new Date(a.sla_resolution_due) - new Date(b.sla_resolution_due),
    );
    const longest = overdue[0];
    // Directional comparison. The ratio alone was rendered with a hardcoded
    // "slower", so a faster Admin desk read as "0.2x slower than IT".
    const itHours = view.it.avg_resolution_hours;
    const adminHours = view.admin.avg_resolution_hours;
    const comparison =
      itHours && adminHours
        ? adminHours >= itHours
          ? {
              factor: (adminHours / itHours).toFixed(1),
              direction: "slower",
              desk: "Admin",
              other: "IT",
            }
          : {
              factor: (itHours / adminHours).toFixed(1),
              direction: "slower",
              desk: "IT",
              other: "Admin",
            }
        : null;
    // Weakest desk member across both desks, but only where there is a workload
    // to judge — a member with nothing assigned is not "0% compliant".
    const weakest = [
      ...(view.itMembers || []).map((member) => ({
        ...member,
        department: "IT",
      })),
      ...(view.adminMembers || []).map((member) => ({
        ...member,
        department: "Admin",
      })),
    ]
      .filter((member) => member.assigned > 0)
      .sort((a, b) => a.sla_compliance - b.sla_compliance)[0];
    const unassigned = view.allTickets.filter(
      (ticket) => !ticket.assignee_id && !DONE.includes(ticket.status),
    ).length;
    const kraPending = (view.kra?.members || []).filter(
      (member) => !member.submitted_lists,
    ).length;
    return {
      longest,
      overdueCount: overdue.length,
      overdueTop: overdue.slice(0, 3),
      comparison,
      weakest,
      unassigned,
      kraPending,
    };
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
  /**
   * Builds the operations report as a single CSV made of clearly titled
   * sections, each with its own header row, so it opens cleanly in Excel and
   * every number can be traced back to a definition.
   *
   * Sections: report metadata, desk summary, member detail (tickets + SLA +
   * handling time + Checklist), the unassigned queue, per-day checklist submissions, and
   * the full ticket ledger.
   */
  const exportReport = () => {
    const csvCell = (value) => {
      const text = String(value ?? "");
      // Guard against spreadsheet formula injection.
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const stamp = (value) => (value ? istDateTime(value) : "");
    const clock = (value) => (value ? istTime(value) : "");
    const pct = (value) => `${value || 0}%`;
    const hrs = (value) => `${value || 0}h`;

    const overdueNow = (list) =>
      list.filter(
        (ticket) =>
          !DONE.includes(ticket.status) &&
          ticket.sla_resolution_due &&
          new Date(ticket.sla_resolution_due) < new Date(),
      ).length;
    const statusCounts = (list) => [
      list.filter((ticket) => ticket.status === "Open").length,
      list.filter(
        (ticket) => !DONE.includes(ticket.status) && ticket.status !== "Open",
      ).length,
      list.filter((ticket) => ["Resolved", "Closed"].includes(ticket.status))
        .length,
      list.filter((ticket) => ticket.status === "Cancelled").length,
    ];

    const blank = [];
    const section = (title, note) =>
      note ? [blank, [title], [note]] : [blank, [title]];

    // ---- member rows: one line per member, everything about them ----------
    const MEMBER_HEADER = [
      "Department",
      "Member",
      "Email",
      "Location",
      "Assigned",
      "Open",
      "In progress",
      "Closed",
      "Cancelled",
      "Overdue now",
      "Overall SLA met",
      "Response SLA met",
      "Response breaches",
      "Avg response (business h)",
      "Resolution SLA met",
      "Resolution breaches",
      "Avg resolution (business h)",
      "Avg handling time per ticket (business h)",
      "Tickets measured for handling time",
      "…with exact work-start stamp",
      "Sum of handling windows (overlapping, not hours worked)",
      "Checklist days submitted",
      "Checklist submissions",
      "Checklist tasks done",
      "Checklist tasks total",
      "Checklist completion",
      "Checklist late submissions",
      "Checklist revised after first entry",
      "Checklist typical first entry (IST)",
      "Checklist typical last update (IST)",
      "Checklist earliest first entry (IST)",
      "Checklist latest update (IST)",
    ];
    const memberRows = (department, members, tickets) =>
      members.map((member) => {
        const mine = tickets.filter(
          (ticket) => ticket.assignee_id === member.member_id,
        );
        const kra = member.kra;
        return [
          department,
          member.member_name,
          member.email || "",
          member.location || "",
          mine.length,
          ...statusCounts(mine),
          overdueNow(mine),
          pct(member.sla_compliance),
          pct(member.response_sla_compliance),
          member.response_sla_breached || 0,
          member.avg_response_hours || 0,
          pct(member.resolution_sla_compliance),
          member.resolution_sla_breached || 0,
          member.avg_resolution_hours || 0,
          member.avg_working_hours || 0,
          member.handled_count || 0,
          member.handled_from_work_started || 0,
          member.total_working_hours || 0,
          kra?.dayCount || 0,
          kra?.submissions || 0,
          kra?.done || 0,
          kra?.total || 0,
          pct(kra?.completion),
          kra?.late || 0,
          kra?.revised || 0,
          kra?.avgFirstEntry || "",
          kra?.avgLastUpdate || "",
          kra?.earliestFirstEntry || "",
          kra?.latestUpdate || "",
        ];
      });

    const queueRow = (department, tickets) => {
      const unassigned = tickets.filter((ticket) => !ticket.assignee_id);
      if (!unassigned.length) return [];
      return [
        [
          department,
          "Unassigned / team queue",
          unassigned.length,
          ...statusCounts(unassigned),
          overdueNow(unassigned),
        ],
      ];
    };

    // ---- per-day checklist submissions -----------------------------------------
    const kraRows = [];
    for (const [department, members] of [
      ["IT", view.itMembers || []],
      ["Admin", view.adminMembers || []],
    ]) {
      for (const member of members) {
        for (const entry of member.kra?.entries || []) {
          kraRows.push([
            department,
            member.member_name,
            entry.date,
            entry.title || "",
            entry.done,
            entry.total,
            entry.status || "",
            entry.late ? "Yes" : "No",
            stamp(entry.firstEntryAt),
            stamp(entry.lastUpdateAt),
            stamp(entry.deadlineAt),
            entry.firstEntryAt &&
            entry.lastUpdateAt &&
            new Date(entry.lastUpdateAt) - new Date(entry.firstEntryAt) > 60000
              ? "Yes"
              : "No",
          ]);
        }
      }
    }
    kraRows.sort(
      (a, b) => String(b[2]).localeCompare(String(a[2])) || String(a[1]).localeCompare(String(b[1])),
    );

    // ---- full ticket ledger ----------------------------------------------
    const allTickets = [...view.itTickets, ...view.adminTickets];
    const ticketRows = allTickets
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((ticket) => {
        const resolvedAt =
          ticket.resolved_at || ticket.resolution?.resolved_date;
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
          slaState,
          ticket.assignee_name || "Unassigned / team queue",
          ticket.location || "",
          ticket.issue_user_name || ticket.raised_for_name || "",
          ticket.issue_user_employee_code || ticket.employee_id || "",
          ticket.issue_user_email || ticket.email || "",
          ticket.raised_by_name || "",
          stamp(ticket.created_at),
          stamp(ticket.assigned_at),
          ticket.assigned_by_name || "",
          stamp(ticket.acknowledged_at || ticket.first_response_at),
          stamp(ticket.work_started_at),
          stamp(ticket.sla_response_due),
          stamp(ticket.sla_resolution_due),
          stamp(resolvedAt),
          ticket.resolved_by_name || ticket.resolution?.resolved_by || "",
          stamp(ticket.closed_at),
          ticket.closed_by_name || "",
          ticket.member_working_minutes != null
            ? Math.round((ticket.member_working_minutes / 60) * 10) / 10
            : "",
          ticket.approval_required ? "Yes" : "No",
          ticket.resolution?.summary || "",
          ticket.resolution?.action_taken || "",
          ticket.resolution?.root_cause || "",
        ];
      });

    const rows = [
      ["ETHARA SERVICE HUB — OPERATIONS REPORT"],
      ["Date range (tickets raised)", `${from} to ${to}`],
      ["Generated at (IST)", istDateTime(new Date())],
      ["Business hours", "Mon–Fri, 10:00–19:00 IST"],
      ["Tickets in range", allTickets.length],
      [
        "Note on handling time",
        "Elapsed business time from ticket pickup to resolution. Members handle several tickets at once, so these windows overlap — the summed column is not hours worked.",
      ],
      [
        "Note on escalated",
        "Escalated counts are live across all dates, because a ticket breaches precisely because it is old.",
      ],

      ...section("1. DESK SUMMARY"),
      [
        "Department",
        "Tickets in range",
        "Open",
        "In progress",
        "Active total",
        "Closed",
        "Escalated (live, all dates)",
        "Overall SLA met",
        "Response SLA met",
        "Resolution SLA met",
        "Avg response (business h)",
        "Avg resolution (business h)",
      ],
      ...[
        ["IT", view.it],
        ["Admin", view.admin],
      ].map(([name, stats]) => [
        name,
        stats.total,
        stats.open,
        stats.working,
        stats.active,
        stats.resolved,
        stats.escalated,
        pct(stats.sla_compliance),
        pct(stats.response_sla_compliance),
        pct(stats.resolution_sla_compliance),
        stats.avg_response_hours,
        stats.avg_resolution_hours,
      ]),

      ...section(
        "2. MEMBER DETAIL",
        "One row per member: workload, SLA, handling time and checklist activity for the selected range.",
      ),
      MEMBER_HEADER,
      ...memberRows("IT", view.itMembers || [], view.itTickets),
      ...memberRows("Admin", view.adminMembers || [], view.adminTickets),

      ...section(
        "3. UNASSIGNED QUEUE",
        "Tickets in range with no owner. Excluded from member rows above.",
      ),
      [
        "Department",
        "Queue",
        "Tickets",
        "Open",
        "In progress",
        "Closed",
        "Cancelled",
        "Overdue now",
      ],
      ...queueRow("IT", view.itTickets),
      ...queueRow("Admin", view.adminTickets),

      ...section(
        "4. CHECKLIST SUBMISSIONS BY DAY",
        "First entry is when the member started the day's checklist; last update is the most recent save. Intermediate saves overwrite in place and are not retained.",
      ),
      [
        "Department",
        "Member",
        "Date",
        "Checklist",
        "Tasks done",
        "Tasks total",
        "Status",
        "Late",
        "First entry (IST)",
        "Last update (IST)",
        "Deadline (IST)",
        "Revised after first entry",
      ],
      ...(kraRows.length ? kraRows : [["—", "No checklist submissions in range"]]),

      ...section(
        "5. TICKET LEDGER",
        "Every ticket raised in the selected range, with its full lifecycle timestamps in IST.",
      ),
      [
        "Ticket",
        "Department",
        "Title",
        "Category",
        "Priority",
        "Status",
        "SLA state",
        "Assigned member",
        "Location",
        "Raised for",
        "Employee code",
        "Email",
        "Raised by",
        "Created (IST)",
        "Allocated (IST)",
        "Allocated by",
        "Acknowledged (IST)",
        "Work started (IST)",
        "Response due (IST)",
        "Resolution due (IST)",
        "Resolved (IST)",
        "Resolved by",
        "Closed (IST)",
        "Closed by",
        "Handling time (business h)",
        "Approval required",
        "Resolution summary",
        "Action taken",
        "Root cause",
      ],
      ...ticketRows,
    ];

    const blob = new Blob(
      ["\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ethara-operations-report-${from}-to-${to}.csv`;
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
    <div>
      <OperationsOverview
        data={{ ...data, kraActivity: view.kraActivity }}
        from={from}
        to={to}
        setFrom={setFrom}
        setTo={setTo}
        maxDate={inputDate(new Date())}
        onExport={exportReport}
        onRemindAll={remindAll}
        onViewKra={onViewKra}
        onOpenReport={(member, department) =>
          setMemberReport({
            member:
              (department === "IT" ? view.itMembers : view.adminMembers).find(
                (row) => row.member_id === member.member_id,
              ) || member,
            department,
          })
        }
        onOpenTicket={onOpenTicket}
      />
      <IncidentReportsPanel onViewAll={onViewIncidents} />
      {memberReport && (
        <MemberReport
          member={memberReport.member}
          department={memberReport.department}
          tickets={
            memberReport.department === "IT"
              ? view.itTickets
              : view.adminTickets
          }
          from={from}
          to={to}
          onClose={() => setMemberReport(null)}
          onOpenTicket={onOpenTicket}
        />
      )}
    </div>
  );
}

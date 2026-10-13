"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { PRIORITY_META, statusClass } from "@/lib/appapi";

const DONE = ["Resolved", "Closed", "Cancelled"];
const IST = "Asia/Kolkata";

const initials = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

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
const istTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString("en-GB", {
        timeZone: IST,
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function Stat({ label, value, detail, tone = "" }) {
  return (
    <div className="rounded-lg border border-[#E5E9EF] bg-[#FAFBFC] px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
        {label}
      </p>
      <b className={`mt-0.5 block text-lg tabular-nums ${tone}`}>{value}</b>
      {detail && <p className="mt-0.5 text-[10px] leading-4 text-[#697087]">{detail}</p>}
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <section className="rounded-xl border border-[#E5E9EF]">
      <header className="border-b border-[#E5E9EF] bg-[#FAFBFC] px-4 py-2.5">
        <h3 className="text-sm font-bold">{title}</h3>
        {subtitle && <p className="text-[11px] leading-4 text-[#697087]">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

/**
 * Consolidated report for one desk member over the dashboard's selected range.
 *
 * Everything here is derived from the same range-filtered ticket set the desk
 * cards use, so the figures reconcile with the dashboard rather than being a
 * second, independent calculation.
 */
export default function MemberReport({
  member,
  department,
  tickets,
  from,
  to,
  onClose,
  onOpenTicket,
}) {
  const detail = useMemo(() => {
    if (!member) return null;
    const mine = (tickets || []).filter(
      (ticket) => ticket.assignee_id === member.member_id,
    );
    const overdue = mine.filter(
      (ticket) =>
        !DONE.includes(ticket.status) &&
        ticket.sla_resolution_due &&
        new Date(ticket.sla_resolution_due) < new Date(),
    );
    const byStatus = mine.reduce((map, ticket) => {
      map[ticket.status] = (map[ticket.status] || 0) + 1;
      return map;
    }, {});
    const byPriority = ["Critical", "High", "Medium", "Low"].map((name) => ({
      name,
      value: mine.filter((ticket) => ticket.priority === name).length,
    }));
    const byCategory = Object.entries(
      mine.reduce((map, ticket) => {
        const key = ticket.category || "Other";
        map[key] = (map[key] || 0) + 1;
        return map;
      }, {}),
    )
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    return { mine, overdue, byStatus, byPriority, byCategory };
  }, [member, tickets]);

  if (!member || !detail) return null;
  const kra = member.kra;

  const exportMember = () => {
    const cell = (value) => {
      const text = String(value ?? "");
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = [
      ["MEMBER CONSOLIDATED REPORT"],
      ["Member", member.member_name],
      ["Email", member.email || ""],
      ["Department", department],
      ["Location", member.location || ""],
      ["Date range", `${from} to ${to}`],
      ["Generated at", new Date().toLocaleString("en-GB")],
      [],
      ["WORKLOAD"],
      ["Assigned", member.assigned || 0],
      ["Still open", member.open || 0],
      ["Resolved", member.resolved || 0],
      ["Overdue now", detail.overdue.length],
      [],
      ["SLA"],
      ["Overall SLA met %", `${member.sla_compliance || 0}%`],
      ["Response SLA met %", `${member.response_sla_compliance || 0}%`],
      ["Response breaches", member.response_sla_breached || 0],
      ["Resolution SLA met %", `${member.resolution_sla_compliance || 0}%`],
      ["Resolution breaches", member.resolution_sla_breached || 0],
      ["Avg response (business hrs)", member.avg_response_hours || 0],
      ["Avg resolution (business hrs)", member.avg_resolution_hours || 0],
      [],
      ["HANDLING TIME (elapsed business time from pickup to resolve)"],
      ["Avg handling time per ticket (hrs)", member.avg_working_hours || 0],
      ["Tickets measured", member.handled_count || 0],
      [
        "…of which used exact work-start stamp",
        member.handled_from_work_started || 0,
      ],
      [
        "Sum of handling windows (hrs)",
        member.total_working_hours || 0,
      ],
      [
        "Note",
        "Windows overlap when several tickets are handled at once, so the sum is not hours worked.",
      ],
      [],
      ["CHECKLIST ACTIVITY"],
      ["Days submitted", kra?.dayCount || 0],
      ["Submissions", kra?.submissions || 0],
      ["Tasks done / total", `${kra?.done || 0} / ${kra?.total || 0}`],
      ["Completion %", `${kra?.completion || 0}%`],
      ["Late submissions", kra?.late || 0],
      ["Revised after first entry", kra?.revised || 0],
      ["Avg first entry (IST)", kra?.avgFirstEntry || "—"],
      ["Avg last update (IST)", kra?.avgLastUpdate || "—"],
      ["Earliest first entry (IST)", kra?.earliestFirstEntry || "—"],
      ["Latest update (IST)", kra?.latestUpdate || "—"],
      [],
      ["CHECKLIST SUBMISSIONS"],
      ["Date", "Checklist", "Done", "Total", "Status", "Late", "First entry (IST)", "Last update (IST)", "Deadline (IST)"],
      ...(kra?.entries || []).map((entry) => [
        entry.date,
        entry.title || "",
        entry.done,
        entry.total,
        entry.status || "",
        entry.late ? "Yes" : "No",
        istDateTime(entry.firstEntryAt),
        istDateTime(entry.lastUpdateAt),
        istDateTime(entry.deadlineAt),
      ]),
      [],
      ["ASSIGNED TICKETS"],
      ["Ticket", "Title", "Category", "Priority", "Status", "Created (IST)", "Acknowledged (IST)", "Work started (IST)", "Resolved (IST)", "Resolution due (IST)", "SLA state", "Handling time (hrs)"],
      ...detail.mine
        .slice()
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
            ticket.title,
            ticket.category,
            ticket.priority,
            ticket.status,
            istDateTime(ticket.created_at),
            istDateTime(ticket.acknowledged_at || ticket.first_response_at),
            istDateTime(ticket.work_started_at),
            istDateTime(resolvedAt),
            istDateTime(ticket.sla_resolution_due),
            slaState,
            ticket.member_working_minutes != null
              ? Math.round((ticket.member_working_minutes / 60) * 10) / 10
              : "",
          ];
        }),
    ];
    const blob = new Blob(
      ["\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `member-report-${member.member_name.replace(/\s+/g, "-").toLowerCase()}-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <Dialog open={Boolean(member)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[980px] overflow-y-auto rounded-2xl sm:max-h-[92vh]">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-3 text-left">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#131C26] text-sm font-semibold text-white">
              {initials(member.member_name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xl font-bold">
                {member.member_name}
              </span>
              <span className="block truncate text-xs font-normal text-[#697087]">
                {department} desk · {member.location || "Location not set"}
                {member.email ? ` · ${member.email}` : ""}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto shrink-0"
              onClick={exportMember}
            >
              <Download className="h-4 w-4" />
              Export member CSV
            </Button>
          </DialogTitle>
          <p className="mt-1 text-xs text-[#697087]">
            Consolidated for {from} to {to}. Ticket figures cover tickets{" "}
            <b>raised</b> in this range; &quot;overdue now&quot; is live.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              label="Assigned"
              value={member.assigned || 0}
              detail={`${member.open || 0} still open`}
            />
            <Stat
              label="Resolved"
              value={member.resolved || 0}
              detail="in the selected range"
            />
            <Stat
              label="Overdue now"
              value={detail.overdue.length}
              detail="past resolution SLA"
              tone={detail.overdue.length ? "text-red-600" : ""}
            />
            <Stat
              label="Overall SLA"
              value={`${member.sla_compliance || 0}%`}
              detail="response + resolution met"
              tone={
                (member.sla_compliance || 0) >= 75
                  ? "text-emerald-700"
                  : "text-amber-700"
              }
            />
          </div>

          <Section
            title="SLA performance"
            subtitle="Averages count only business hours — Mon to Fri, 10:00–19:00 IST."
          >
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
              <Stat
                label="Avg response"
                value={`${member.avg_response_hours || 0}h`}
                detail={`${member.response_sla_compliance || 0}% met · ${member.response_sla_breached || 0} breached`}
              />
              <Stat
                label="Avg resolution"
                value={`${member.avg_resolution_hours || 0}h`}
                detail={`${member.resolution_sla_compliance || 0}% met · ${member.resolution_sla_breached || 0} breached`}
              />
              <Stat
                label="Handling time / ticket"
                value={`${member.avg_working_hours || 0}h`}
                detail={`avg across ${member.handled_count || 0} resolved ticket${(member.handled_count || 0) === 1 ? "" : "s"}`}
              />
              <Stat
                label="Exact work-start data"
                value={`${member.handled_from_work_started || 0}/${member.handled_count || 0}`}
                detail="rest measured from acknowledgement"
              />
            </div>
            <p className="border-t border-[#E5E9EF] bg-[#FAFBFC] px-4 py-2 text-[11px] leading-4 text-[#697087]">
              <b>Handling time</b> is elapsed business time from the moment the
              ticket was picked up to the moment it was resolved — not effort. A
              member usually has several tickets in progress at once, so these
              windows overlap. The sum of them{" "}
              ({member.total_working_hours || 0}h) is therefore not
              &quot;hours worked&quot; and should not be read as a timesheet.
            </p>
          </Section>

          <Section
            title="Checklist activity"
            subtitle="When the member filled in their daily checklist, in IST. Records keep the first entry and the most recent update for each day."
          >
            {kra ? (
              <>
                <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
                  <Stat
                    label="Days submitted"
                    value={kra.dayCount}
                    detail={`${kra.submissions} submission${kra.submissions === 1 ? "" : "s"}`}
                  />
                  <Stat
                    label="Tasks completed"
                    value={`${kra.done}/${kra.total}`}
                    detail={`${kra.completion}% of assigned tasks`}
                  />
                  <Stat
                    label="Typical first entry"
                    value={kra.avgFirstEntry}
                    detail={`earliest ${kra.earliestFirstEntry}`}
                  />
                  <Stat
                    label="Typical last update"
                    value={kra.avgLastUpdate}
                    detail={`latest ${kra.latestUpdate}`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 px-3 pb-3 sm:grid-cols-2">
                  <Stat
                    label="Late submissions"
                    value={kra.late}
                    detail="after the 7:00 PM IST cutoff"
                    tone={kra.late ? "text-red-600" : ""}
                  />
                  <Stat
                    label="Revised after first entry"
                    value={kra.revised}
                    detail="came back and updated the same day"
                  />
                </div>
                <div className="overflow-x-auto border-t border-[#E5E9EF]">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="bg-[#FAFBFC] text-[10px] uppercase tracking-wider text-[#8B93A1]">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Checklist</th>
                        <th className="px-3 py-2 text-center">Done</th>
                        <th className="px-3 py-2">First entry</th>
                        <th className="px-3 py-2">Last update</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kra.entries.map((entry) => (
                        <tr
                          key={`${entry.date}-${entry.title}`}
                          className="border-t border-[#EDF0F4]"
                        >
                          <td className="px-3 py-2 font-semibold">{entry.date}</td>
                          <td className="max-w-48 truncate px-3 py-2">
                            {entry.title}
                          </td>
                          <td className="px-3 py-2 text-center tabular-nums">
                            {entry.done}/{entry.total}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {istTime(entry.firstEntryAt)}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {istTime(entry.lastUpdateAt)}
                            {entry.lastUpdateAt &&
                              entry.firstEntryAt &&
                              new Date(entry.lastUpdateAt) -
                                new Date(entry.firstEntryAt) >
                                60_000 && (
                                <span className="ml-1 text-[9px] text-[#8B93A1]">
                                  revised
                                </span>
                              )}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${entry.late ? "bg-red-100 text-red-700" : entry.status === "Completed" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
                            >
                              {entry.late ? "Late" : entry.status || "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="p-4 text-sm text-[#697087]">
                No checklist submissions recorded for this member in the selected
                range.
              </p>
            )}
          </Section>

          <Section
            title={`Assigned tickets (${detail.mine.length})`}
            subtitle="Raised within the selected range and assigned to this member."
          >
            {detail.mine.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-[#FAFBFC] text-[10px] uppercase tracking-wider text-[#8B93A1]">
                    <tr>
                      <th className="px-3 py-2">Ticket</th>
                      <th className="px-3 py-2">Title</th>
                      <th className="px-3 py-2">Priority</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Resolved</th>
                      <th className="px-3 py-2 text-center">Handling</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.mine
                      .slice()
                      .sort(
                        (a, b) => new Date(b.created_at) - new Date(a.created_at),
                      )
                      .map((ticket) => {
                        const resolvedAt =
                          ticket.resolved_at || ticket.resolution?.resolved_date;
                        const isOverdue =
                          !DONE.includes(ticket.status) &&
                          ticket.sla_resolution_due &&
                          new Date(ticket.sla_resolution_due) < new Date();
                        return (
                          <tr
                            key={ticket.id}
                            className="border-t border-[#EDF0F4]"
                          >
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => onOpenTicket?.(ticket.id)}
                                disabled={!onOpenTicket}
                                className="font-semibold underline decoration-[#D9DEE7] underline-offset-2 hover:decoration-[#111827] disabled:no-underline"
                              >
                                {ticket.human_id}
                              </button>
                              {isOverdue && (
                                <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold text-red-700">
                                  overdue
                                </span>
                              )}
                            </td>
                            <td className="max-w-56 truncate px-3 py-2">
                              {ticket.title}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_META[ticket.priority]?.badge || ""}`}
                              >
                                {ticket.priority}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass(ticket.status)}`}
                              >
                                {ticket.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 tabular-nums">
                              {istDateTime(ticket.created_at)}
                            </td>
                            <td className="px-3 py-2 tabular-nums">
                              {istDateTime(resolvedAt)}
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums">
                              {ticket.member_working_minutes != null
                                ? `${Math.round((ticket.member_working_minutes / 60) * 10) / 10}h`
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-4 text-sm text-[#697087]">
                No tickets assigned to this member in the selected range.
              </p>
            )}
          </Section>

          {detail.byCategory.length > 0 && (
            <Section title="Issue mix" subtitle="Categories this member handled.">
              <div className="flex flex-wrap gap-2 p-3">
                {detail.byCategory.map((row) => (
                  <span
                    key={row.name}
                    className="rounded-lg bg-[#F1F3F7] px-2.5 py-1 text-xs"
                  >
                    {row.name} · <b>{row.value}</b>
                  </span>
                ))}
              </div>
            </Section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

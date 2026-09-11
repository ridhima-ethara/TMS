"use client";
import { useMemo, useState } from "react";
import { fmtDate, statusClass } from "@/lib/appapi";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Award, TrendingDown, Timer, UserRound } from "lucide-react";

const DONE = ["Resolved", "Closed", "Cancelled"];

const initials = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

// Ranking only considers members who actually carried work in the period;
// somebody with no assigned tickets is not the "best" performer at 0%.
const ranked = (members) =>
  members
    .filter((member) => (member.assigned || 0) > 0)
    .sort(
      (a, b) =>
        (b.sla_compliance || 0) - (a.sla_compliance || 0) ||
        (b.resolved || 0) - (a.resolved || 0),
    );

function InsightCard({ tone, icon: Icon, caption, member, onSelect }) {
  if (!member) return null;
  const positive = tone === "good";
  return (
    <button
      type="button"
      onClick={() => onSelect(member.member_id)}
      className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition hover:shadow-sm ${
        positive
          ? "border-[#BBE7D2] bg-[#F2FAF6]"
          : "border-[#F5C9C9] bg-[#FDECEC]"
      }`}
    >
      <span
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white ${
          positive ? "bg-[#0E6B47]" : "bg-[#A32D2D]"
        }`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[11px] font-semibold uppercase tracking-wide ${
            positive ? "text-[#0E6B47]" : "text-[#A32D2D]"
          }`}
        >
          {caption}
        </p>
        <p className="truncate font-bold text-[#111827]">
          {member.member_name}
        </p>
        <p className="truncate text-xs text-[#697087]">
          {member.sla_compliance}% SLA · {member.resolved} resolved of{" "}
          {member.assigned} · {member.avg_working_hours || 0}h active
        </p>
      </div>
    </button>
  );
}

export default function TeamPerformance({
  department,
  members = [],
  tickets = [],
  onOpenTicket,
  title = "Performance insights",
}) {
  const [selectedId, setSelectedId] = useState("all");

  const order = useMemo(() => ranked(members), [members]);
  const best = order[0] || null;
  const worst = order.length > 1 ? order[order.length - 1] : null;

  const selected =
    selectedId === "all"
      ? null
      : members.find((member) => member.member_id === selectedId) || null;

  // The member filter drives every panel below it, so picking a person shows
  // their figures and the tickets behind them.
  const visibleMembers = selected ? [selected] : members;
  const memberTickets = useMemo(() => {
    if (!selected) return [];
    return tickets
      .filter((ticket) => ticket.assignee_id === selected.member_id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [tickets, selected]);

  return (
    <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
      <div className="flex flex-col gap-3 border-b border-[#E5E9EF] px-5 py-4 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h3 className="font-bold text-[#111827]">
            {title}
            {department ? (
              <span className="ml-1 text-xs font-normal text-[#8B93A1]">
                {department} team
              </span>
            ) : null}
          </h3>
          <p className="text-xs text-[#697087]">
            Ranked by overall SLA compliance across assigned tickets.
          </p>
        </div>
        <div className="sm:ml-auto">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-full bg-white sm:w-60">
              <SelectValue placeholder="All members" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All members</SelectItem>
              {members.map((member) => (
                <SelectItem key={member.member_id} value={member.member_id}>
                  {member.member_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!selected && (best || worst) && (
        <div className="grid gap-3 border-b border-[#E5E9EF] p-5 sm:grid-cols-2">
          <InsightCard
            tone="good"
            icon={Award}
            caption="Best performing"
            member={best}
            onSelect={setSelectedId}
          />
          <InsightCard
            tone="bad"
            icon={TrendingDown}
            caption="Needs support"
            member={worst}
            onSelect={setSelectedId}
          />
        </div>
      )}

      <div className="overflow-x-auto">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead className="text-right">Assigned</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">Resolved</TableHead>
              <TableHead className="text-right">Avg response</TableHead>
              <TableHead className="text-right">Avg resolution</TableHead>
              <TableHead className="text-right">Active hrs</TableHead>
              <TableHead className="text-right">SLA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleMembers.map((member) => (
              <TableRow key={member.member_id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#EDF0F4] text-[11px] font-semibold text-[#4B5563]">
                      {initials(member.member_name)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {member.member_name}
                      </p>
                      <p className="truncate text-[11px] text-[#9CA3AF]">
                        {member.location || "Location not set"}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {member.assigned || 0}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {member.open || 0}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {member.resolved || 0}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {member.avg_response_hours || 0}h
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {member.avg_resolution_hours || 0}h
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <span title={`${member.total_working_hours || 0}h total active time`}>
                    {member.avg_working_hours || 0}h
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      !member.assigned
                        ? "bg-[#EDF0F4] text-[#9CA3AF]"
                        : member.sla_compliance >= 75
                          ? "bg-[#E4F5EE] text-[#0E6B47]"
                          : "bg-[#FDF3E0] text-[#8A5A06]"
                    }`}
                  >
                    {member.assigned ? `${member.sla_compliance}%` : "No data"}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {!visibleMembers.length && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-sm text-[#697087]"
                >
                  No members in this department yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {selected && (
        <div className="border-t border-[#E5E9EF] p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <UserRound className="h-4 w-4 text-[#697087]" />
            <h4 className="font-semibold text-[#111827]">
              {selected.member_name}&apos;s tickets
            </h4>
            <span className="text-xs text-[#9CA3AF]">
              {memberTickets.length} in the selected period
            </span>
            <span className="ml-auto flex items-center gap-1 text-xs text-[#697087]">
              <Timer className="h-3.5 w-3.5" />
              {selected.total_working_hours || 0}h total active
            </span>
          </div>
          {memberTickets.length ? (
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Raised</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberTickets.map((ticket) => (
                    <TableRow
                      key={ticket.id}
                      className={onOpenTicket ? "cursor-pointer" : ""}
                      onClick={() => onOpenTicket?.(ticket.id)}
                    >
                      <TableCell className="font-mono text-xs font-semibold">
                        {ticket.human_id}
                      </TableCell>
                      <TableCell className="max-w-[260px] truncate text-sm">
                        {ticket.title}
                      </TableCell>
                      <TableCell className="text-xs text-[#697087]">
                        {ticket.category || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusClass(ticket.status)}>
                          {ticket.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-[#697087]">
                        {fmtDate(ticket.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="rounded-xl bg-[#FAFBFC] p-6 text-center text-sm text-[#697087]">
              No tickets assigned to {selected.member_name} in the selected
              period.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

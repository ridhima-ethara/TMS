"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fmtDate, statusClass, PRIORITY_META } from "@/lib/appapi";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
  Clock,
  Laptop,
  RefreshCcw,
  Search,
  Ticket,
  TrendingUp,
  Truck,
} from "lucide-react";
import { toast } from "sonner";

const VENDOR_COLORS = ["#2E7CD6", "#6C5CE7", "#E8930C", "#1B7F6E", "#D6455D"];
const DONE = ["Resolved", "Closed", "Cancelled"];

// Same-day laptop fixes are common, and "0d" reads as missing data rather than
// fast, so anything under a day is reported in hours.
const formatResolution = (days) => {
  if (days == null) return "—";
  if (days >= 1) return `${days}d`;
  const hours = days * 24;
  return hours >= 1 ? `${Math.round(hours)}h` : "<1h";
};

function Kpi({ icon: Icon, label, value, hint, tone }) {
  return (
    <Card className="flex items-center gap-4 p-4">
      <span
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
        style={{ background: `${tone}18`, color: tone }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-[#697087]">{label}</p>
        <p className="truncate text-xl font-bold text-[#111827]">{value}</p>
        {hint && <p className="truncate text-[11px] text-[#9CA3AF]">{hint}</p>}
      </div>
    </Card>
  );
}

// A labelled proportional bar. Used for every breakdown so category, priority
// and status are read the same way.
function BarList({ counts, color, empty = "No data" }) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length)
    return <p className="text-xs text-[#9CA3AF]">{empty}</p>;
  const max = Math.max(...entries.map(([, value]) => value), 1);
  return (
    <div className="space-y-2">
      {entries.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs text-[#4B5563]">{label}</p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#EDF0F4]">
              <div
                className="h-full rounded-full"
                style={{ width: `${(value / max) * 100}%`, background: color }}
              />
            </div>
          </div>
          <span className="text-xs font-semibold tabular-nums text-[#111827]">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, hint, tone = "#111827" }) {
  return (
    <div className="rounded-xl border border-[#E5E9EF] bg-white p-3">
      <p className="text-[11px] font-medium text-[#697087]">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums" style={{ color: tone }}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-[#9CA3AF]">{hint}</p>}
    </div>
  );
}

// Fleet-size-adjusted comparison. A vendor supplying twice the laptops is
// expected to raise twice the tickets, so raw counts cannot rank reliability;
// issues per 100 laptops can.
function VendorComparison({ vendors, selected, onSelect }) {
  const maxRate = Math.max(
    ...vendors.map((vendor) => vendor.issue_rate_per_100 || 0),
    0.01,
  );
  return (
    <Card className="p-5">
      <h3 className="font-bold text-[#111827]">Vendor reliability</h3>
      <p className="mt-0.5 text-xs text-[#697087]">
        Issues per 100 laptops issued — comparable across vendors of different
        fleet sizes. Select a vendor for the full breakdown.
      </p>
      <div className="mt-4 space-y-3">
        {vendors.map((vendor, index) => {
          const color = VENDOR_COLORS[index % VENDOR_COLORS.length];
          const isSelected = vendor.vendor === selected;
          const rate = vendor.issue_rate_per_100 || 0;
          return (
            <button
              key={vendor.vendor}
              type="button"
              onClick={() => onSelect(vendor.vendor)}
              aria-pressed={isSelected}
              className={`w-full rounded-xl border p-3 text-left transition ${
                isSelected
                  ? "border-[#1B7F6E] bg-[#F4FBF8] shadow-sm"
                  : "border-[#E5E9EF] bg-white hover:border-[#C9D2DD] hover:bg-[#FAFBFC]"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white"
                  style={{ background: color }}
                >
                  <Truck className="h-4 w-4" />
                </span>
                <span className="font-semibold text-[#111827]">
                  {vendor.vendor}
                </span>
                <span className="text-xs text-[#697087]">
                  {vendor.fleet_size} laptops · {vendor.tickets_total} tickets
                </span>
                <span className="ml-auto text-sm font-bold tabular-nums text-[#111827]">
                  {rate.toFixed(2)}
                  <span className="ml-1 text-[11px] font-medium text-[#9CA3AF]">
                    /100
                  </span>
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#EDF0F4]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max((rate / maxRate) * 100, rate ? 4 : 0)}%`,
                    background: color,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function VendorDetail({ vendor, color, onOpenTicket }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const tickets = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (vendor.recent_tickets || []).filter((ticket) => {
      const done = DONE.includes(ticket.status);
      if (statusFilter === "open" && done) return false;
      if (statusFilter === "closed" && !done) return false;
      if (!term) return true;
      return [
        ticket.human_id,
        ticket.title,
        ticket.asset_serial_number,
        ticket.issue_user_name,
        ticket.category,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });
  }, [vendor.recent_tickets, search, statusFilter]);

  const overdue = vendor.tickets_overdue || 0;
  return (
    <Card className="overflow-hidden">
      <div
        className="flex flex-wrap items-center gap-3 px-5 py-4 text-white"
        style={{ background: color }}
      >
        <Truck className="h-5 w-5" />
        <div className="min-w-0">
          <h3 className="text-lg font-bold">{vendor.vendor}</h3>
          <p className="text-xs text-white/80">
            {vendor.fleet_size} laptops issued ·{" "}
            {Object.keys(vendor.brands || {}).length} brand
            {Object.keys(vendor.brands || {}).length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="grid gap-3 border-b border-[#E5E9EF] p-5 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Total tickets" value={vendor.tickets_total} />
        <Metric
          label="Open"
          value={vendor.tickets_open}
          tone={vendor.tickets_open ? "#B45309" : "#111827"}
          hint={overdue ? `${overdue} past SLA` : "none past SLA"}
        />
        <Metric label="Closed" value={vendor.tickets_closed} tone="#087017" />
        <Metric
          label="Issues per 100"
          value={
            vendor.issue_rate_per_100 == null
              ? "—"
              : vendor.issue_rate_per_100.toFixed(2)
          }
          hint="fleet-size adjusted"
        />
        <Metric
          label="Avg resolution"
          value={formatResolution(vendor.avg_resolution_days)}
          hint={
            vendor.tickets_closed
              ? `${vendor.tickets_closed} closed ticket${vendor.tickets_closed === 1 ? "" : "s"}`
              : "no closed tickets"
          }
        />
      </div>

      <div className="grid gap-5 border-b border-[#E5E9EF] p-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
            Issues by category
          </p>
          <BarList
            counts={vendor.by_category}
            color={color}
            empty="No tickets mapped yet"
          />
        </div>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
            Issues by priority
          </p>
          <BarList counts={vendor.by_priority} color="#E8930C" />
        </div>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
            Current status
          </p>
          <BarList counts={vendor.by_status} color="#6C5CE7" />
        </div>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
            Fleet by brand
          </p>
          <BarList counts={vendor.brands} color="#1B7F6E" />
        </div>
      </div>

      <div className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <h4 className="font-semibold text-[#111827]">
            Tickets{" "}
            <span className="text-xs font-normal text-[#9CA3AF]">
              ({tickets.length} shown)
            </span>
          </h4>
          <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
            <div className="flex w-full items-center gap-2 rounded-lg border border-[#E5E9EF] bg-white px-3 sm:w-64">
              <Search className="h-4 w-4 shrink-0 text-[#9CA3AF]" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ticket, serial, employee…"
                className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="flex rounded-lg bg-[#EDF0F4] p-1">
              {[
                ["all", "All"],
                ["open", "Open"],
                ["closed", "Closed"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                    statusFilter === value
                      ? "bg-white shadow-sm text-[#111827]"
                      : "text-[#4B5563]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {tickets.length ? (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Serial</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Raised</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    className="cursor-pointer"
                    onClick={() => onOpenTicket?.(ticket.id)}
                  >
                    <TableCell className="font-mono text-xs font-semibold">
                      {ticket.human_id}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-sm">
                      {ticket.title}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {ticket.asset_serial_number}
                    </TableCell>
                    <TableCell className="text-sm">
                      {ticket.issue_user_name || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={PRIORITY_META[ticket.priority]?.badge || ""}
                      >
                        {ticket.priority}
                      </Badge>
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
          <p className="mt-4 rounded-xl bg-[#FAFBFC] p-6 text-center text-sm text-[#697087]">
            {vendor.tickets_total
              ? "No tickets match this search or filter."
              : "No laptop tickets have been mapped to this vendor yet."}
          </p>
        )}
      </div>
    </Card>
  );
}

export default function VendorAnalysis({ onOpenTicket }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api("/reports/vendor-analysis"));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const vendors = data?.vendors || [];
  // Default to the vendor raising the most issues; keep the user's choice
  // across refreshes as long as that vendor still exists.
  const activeVendor =
    vendors.find((vendor) => vendor.vendor === selected) || vendors[0] || null;
  const activeIndex = vendors.findIndex(
    (vendor) => vendor.vendor === activeVendor?.vendor,
  );

  if (loading && !data)
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  if (!data) return null;

  const { totals } = data;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-[#111827]">
            Laptop vendor analysis
          </h2>
          <p className="text-xs text-[#697087]">
            Laptop tickets are mapped to the issuing vendor via serial number or
            GRP code, so recurring hardware problems can be traced to their
            supplier.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCcw
            className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={Laptop}
          label="Laptops tracked"
          value={totals.fleet_size}
          hint={`${vendors.length} vendor${vendors.length === 1 ? "" : "s"}`}
          tone="#2E7CD6"
        />
        <Kpi
          icon={Ticket}
          label="Laptop tickets mapped"
          value={totals.mapped_tickets}
          hint={
            totals.unmatched_tickets
              ? `${totals.unmatched_tickets} with unrecognised serials`
              : "All serials recognised"
          }
          tone="#6C5CE7"
        />
        <Kpi
          icon={AlertTriangle}
          label="Open laptop issues"
          value={totals.open_tickets}
          tone="#E8930C"
        />
        <Kpi
          icon={TrendingUp}
          label="Most issues from"
          value={totals.top_vendor || "—"}
          hint={
            totals.top_vendor
              ? "Highest mapped ticket count"
              : "No mapped tickets yet"
          }
          tone="#D6455D"
        />
      </div>

      {vendors.length ? (
        <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <VendorComparison
            vendors={vendors}
            selected={activeVendor?.vendor}
            onSelect={setSelected}
          />
          {activeVendor && (
            <VendorDetail
              key={activeVendor.vendor}
              vendor={activeVendor}
              color={VENDOR_COLORS[activeIndex % VENDOR_COLORS.length]}
              onOpenTicket={onOpenTicket}
            />
          )}
        </div>
      ) : (
        <Card className="p-8 text-center text-sm text-[#697087]">
          No laptop inventory loaded yet.
        </Card>
      )}

      {totals.unmatched_tickets > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-[#9CA3AF]">
          <Clock className="h-3.5 w-3.5" />
          {totals.unmatched_tickets} laptop ticket
          {totals.unmatched_tickets === 1 ? " has" : "s have"} a serial number
          that is not in the vendor inventory sheets, so they are excluded from
          the vendor totals above.
        </p>
      )}
    </div>
  );
}

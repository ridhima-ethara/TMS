"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/appapi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertOctagon,
  CheckCircle2,
  Clock3,
  Eye,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import DateRangeMenu from "@/components/app/DateRangeMenu";

const STATUSES = ["Resolved", "Monitoring", "Open"];

// Kept in step with INCIDENT_CATEGORIES in the API route.
export const INCIDENT_CATEGORIES = [
  "Internet / ISP",
  "Wi-Fi",
  "LAN / Network",
  "Power / UPS",
  "Hardware / Devices",
  "Software / Applications",
  "Security / Firewall",
  "CCTV / Access Control",
  "Printer",
  "Meeting Room / VC",
  "Other",
];

// Locations are "Site - Floor" ("Tulip - Second Floor", "Lotus - Labs").
const UNSPECIFIED = "Not specified";
export const placeOf = (location) => {
  const [site, ...rest] = String(location || "").split(" - ");
  if (!location || !rest.length) return { site: UNSPECIFIED, floor: UNSPECIFIED, label: UNSPECIFIED };
  return { site: site.trim(), floor: rest.join(" - ").trim(), label: location };
};
// Top of the building first, so the floor view reads like a cross-section.
const FLOOR_RANK = ["Third Floor", "Second Floor", "First Floor", "Ground Floor", "Basement", "Bullpen", "Labs"];
const floorRank = (floor) => {
  const i = FLOOR_RANK.indexOf(floor);
  return i === -1 ? FLOOR_RANK.length : i;
};

const STATUS_STYLE = {
  Resolved: "bg-emerald-100 text-emerald-800",
  Monitoring: "bg-amber-100 text-amber-800",
  Open: "bg-red-100 text-red-700",
};

// Rows of the report, in the order of the agreed incident format.
const FIELDS = [
  ["issue", "Issue"],
  ["occurred_at", "Date & Time"],
  ["category", "Category"],
  ["location", "Location / Floor"],
  ["root_cause", "Root Cause (RCA)"],
  ["impact", "Impact"],
  ["resolution", "Resolution / Action Taken"],
  ["resolution_time_minutes", "Resolution Time (TAT)"],
  ["status", "Current Status"],
  ["key_achievement", "Key Achievement"],
  ["preventive_action", "Preventive Action / Key Learning"],
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "15-Jul-2026, 11:30 AM" in IST, matching the incident format.
export const formatIncidentDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}-${MONTHS[Number(parts.month) - 1]}-${parts.year}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()}`;
};

export const formatTat = (minutes) => {
  if (minutes === null || minutes === undefined || minutes === "") return "—";
  const value = Number(minutes);
  if (value < 60) return `${value} Minute${value === 1 ? "" : "s"}`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return `${hours} Hour${hours === 1 ? "" : "s"}${rest ? ` ${rest} Minute${rest === 1 ? "" : "s"}` : ""}`;
};

export function IncidentStatus({ status }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status] || "bg-[#F1F3F7] text-[#69738B]"}`}
    >
      {status === "Resolved" && <CheckCircle2 className="h-3 w-3" />}
      {status}
    </span>
  );
}

// datetime-local wants the browser's local wall time, not UTC.
const toLocalInput = (value) => {
  const date = value ? new Date(value) : new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const emptyForm = () => ({
  issue: "",
  category: "",
  location: "",
  occurred_at: toLocalInput(),
  root_cause: "",
  impact: "",
  resolution: "",
  tat_value: "",
  tat_unit: "minutes",
  status: "Resolved",
  key_achievement: "",
  preventive_action: "",
});

const formFrom = (report) => {
  const minutes = report.resolution_time_minutes;
  const inHours = minutes != null && minutes >= 60 && minutes % 60 === 0;
  return {
    issue: report.issue || "",
    category: report.category || "",
    location: report.location || "",
    occurred_at: toLocalInput(report.occurred_at),
    root_cause: report.root_cause || "",
    impact: report.impact || "",
    resolution: report.resolution || "",
    tat_value: minutes == null ? "" : String(inHours ? minutes / 60 : minutes),
    tat_unit: inHours ? "hours" : "minutes",
    status: report.status || "Resolved",
    key_achievement: report.key_achievement || "",
    preventive_action: report.preventive_action || "",
  };
};

function IncidentForm({ open, report, locations = [], onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setForm(report ? formFrom(report) : emptyForm());
  }, [open, report]);
  const set = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async () => {
    if (!form.issue.trim()) return toast.error("Issue is required");
    if (!form.category) return toast.error("Select the incident category");
    if (!form.location) return toast.error("Select the location / floor");
    if (!form.root_cause.trim()) return toast.error("Root cause is required");
    if (!form.impact.trim()) return toast.error("Impact is required");
    if (!form.resolution.trim())
      return toast.error("Resolution / action taken is required");
    const raw = form.tat_value.trim();
    if (form.status === "Resolved" && !raw)
      return toast.error("Resolution time is required for a resolved incident");
    const amount = Number(raw);
    if (raw && (!Number.isFinite(amount) || amount < 0))
      return toast.error("Enter a valid resolution time");
    const body = {
      issue: form.issue,
      category: form.category,
      location: form.location,
      occurred_at: new Date(form.occurred_at).toISOString(),
      root_cause: form.root_cause,
      impact: form.impact,
      resolution: form.resolution,
      resolution_time_minutes: raw
        ? Math.round(form.tat_unit === "hours" ? amount * 60 : amount)
        : null,
      status: form.status,
      key_achievement: form.key_achievement,
      preventive_action: form.preventive_action,
    };
    setSaving(true);
    try {
      await api(report ? `/incident-reports/${report.id}` : "/incident-reports", {
        method: report ? "PATCH" : "POST",
        body,
      });
      toast.success(report ? "Incident report updated" : "Incident reported to Super Admin");
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{report ? "Edit incident report" : "Report an incident"}</DialogTitle>
          <p className="text-sm text-[#8B93A1]">
            Super Admin sees this report on their dashboard.
          </p>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Issue *</Label>
            <Input
              className="mt-1"
              value={form.issue}
              onChange={set("issue")}
              maxLength={300}
              placeholder="e.g. Slow Internet Connectivity on Second Floor"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Category *</Label>
              <Select value={form.category} onValueChange={(value) => setForm({ ...form, category: value })}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="What kind of issue" />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_CATEGORIES.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Location / Floor *</Label>
              <Select value={form.location} onValueChange={(value) => setForm({ ...form, location: value })}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Where it happened" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Date &amp; Time *</Label>
              <Input
                type="datetime-local"
                className="mt-1"
                value={form.occurred_at}
                max={toLocalInput()}
                onChange={set("occurred_at")}
              />
            </div>
            <div>
              <Label>Current Status *</Label>
              <Select
                value={form.status}
                onValueChange={(value) => setForm({ ...form, status: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Root Cause (RCA) *</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={form.root_cause}
              onChange={set("root_cause")}
              placeholder="e.g. The LAN cable of one Access Point (AP) was found unplugged."
            />
          </div>
          <div>
            <Label>Impact *</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={form.impact}
              onChange={set("impact")}
              placeholder="Who and what was affected, and what stayed unaffected"
            />
          </div>
          <div>
            <Label>Resolution / Action Taken *</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={form.resolution}
              onChange={set("resolution")}
            />
          </div>
          <div>
            <Label>
              Resolution Time (TAT){form.status === "Resolved" ? " *" : ""}
            </Label>
            <div className="mt-1 flex gap-2">
              <Input
                type="number"
                min="0"
                step="any"
                value={form.tat_value}
                onChange={set("tat_value")}
                placeholder="15"
              />
              <Select
                value={form.tat_unit}
                onValueChange={(value) => setForm({ ...form, tat_unit: value })}
              >
                <SelectTrigger className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">Minutes</SelectItem>
                  <SelectItem value="hours">Hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Key Achievement</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={form.key_achievement}
              onChange={set("key_achievement")}
            />
          </div>
          <div>
            <Label>Preventive Action / Key Learning</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={form.preventive_action}
              onChange={set("preventive_action")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            className="bg-[#131C26] hover:bg-[#1C2836]"
            onClick={submit}
            disabled={saving}
          >
            {saving ? "Saving…" : report ? "Save changes" : "Submit report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The report laid out as the two-column table from the incident format.
function IncidentSheet({ report }) {
  const value = (key) => {
    if (key === "occurred_at") return formatIncidentDate(report.occurred_at);
    if (key === "resolution_time_minutes")
      return formatTat(report.resolution_time_minutes);
    if (key === "status") return <IncidentStatus status={report.status} />;
    return report[key] || "—";
  };
  return (
    <div className="overflow-hidden rounded-lg border border-[#E5E9EF]">
      <table className="w-full text-left text-sm">
        <tbody>
          {FIELDS.map(([key, label]) => (
            <tr key={key} className="border-t border-[#EDF0F4] first:border-t-0">
              <th className="w-[34%] bg-[#FAFBFC] px-3 py-2.5 align-top text-xs font-bold text-[#17171c] sm:w-56 sm:text-sm">
                {label}
              </th>
              <td className="whitespace-pre-wrap break-words px-3 py-2.5 align-top text-[#2B3240]">
                {value(key)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IncidentDetail({ report, onClose }) {
  return (
    <Dialog open={!!report} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Incident report</DialogTitle>
          {report && (
            <p className="text-xs text-[#8B93A1]">
              Reported by {report.reported_by} ·{" "}
              {formatIncidentDate(report.created_at)}
              {report.updated_by ? ` · last edited by ${report.updated_by}` : ""}
            </p>
          )}
        </DialogHeader>
        {report && <IncidentSheet report={report} />}
      </DialogContent>
    </Dialog>
  );
}

function useIncidentReports() {
  const [reports, setReports] = useState(null);
  const [locations, setLocations] = useState([]);
  const load = useCallback(async () => {
    try {
      const data = await api("/incident-reports");
      setReports(data.reports || []);
      setLocations(data.locations || []);
    } catch (error) {
      toast.error(error.message);
      setReports((current) => current || []);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return [reports, load, locations];
}

const summarize = (reports) => {
  const timed = reports.filter((row) => row.resolution_time_minutes != null);
  return {
    total: reports.length,
    resolved: reports.filter((row) => row.status === "Resolved").length,
    active: reports.filter((row) => row.status !== "Resolved").length,
    avgTat: timed.length
      ? Math.round(
          timed.reduce((sum, row) => sum + row.resolution_time_minutes, 0) /
            timed.length,
        )
      : null,
  };
};

function StatStrip({ reports }) {
  const stats = summarize(reports);
  return (
    <div className="grid grid-cols-2 gap-px bg-[#E5E9EF] lg:grid-cols-4">
      {[
        ["Incidents reported", stats.total],
        ["Resolved", stats.resolved],
        ["Open / monitoring", stats.active],
        ["Average TAT", formatTat(stats.avgTat)],
      ].map(([label, value]) => (
        <div key={label} className="bg-white p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8B93A1]">
            {label}
          </p>
          <b
            className={`mt-1 block text-xl ${label === "Open / monitoring" && value ? "text-red-600" : ""}`}
          >
            {value}
          </b>
        </div>
      ))}
    </div>
  );
}

const TZ = "Asia/Kolkata";
const DAY = 86400000;
const dayKey = (value) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const shiftKey = (key, days) => dayKey(Date.parse(`${key}T12:00:00+05:30`) + days * DAY);
const shortKey = (key) =>
  new Date(`${key}T12:00:00+05:30`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: TZ });
const RANGE_PRESETS = [["all", "All time"], ["30d", "Last 30 days"], ["month", "This month"], ["90d", "Last 3 months"]];
const seg = (on) => (on ? "bg-white text-[#17171c] shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "bg-transparent text-[#6b6b76]");
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Panel({ title, note, children, className = "" }) {
  return (
    <Card className={`overflow-hidden border-[#E5E9EF] shadow-none ${className}`}>
      <div className="border-b border-[#EDF0F4] px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-[#17171c]">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-[#8B93A1]">{note}</p>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </Card>
  );
}

function Bar({ value, max, tone = "#b3177f" }) {
  return (
    <span className="relative block h-2 w-full overflow-hidden rounded-full bg-[#F1F3F7]">
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${max ? Math.max(4, (value / max) * 100) : 0}%`, background: tone }} />
    </span>
  );
}

// Analysis of the incident reports: what is raised, where, and on which floor.
function IncidentDashboard({ reports, onOpen }) {
  const today = dayKey(new Date());
  const [range, setRange] = useState({ preset: "all", from: "", to: "" });
  const [site, setSite] = useState("all");
  const from = range.preset === "30d" ? shiftKey(today, -29) : range.preset === "90d" ? shiftKey(today, -89) : range.preset === "month" ? `${today.slice(0, 7)}-01` : range.preset === "custom" ? range.from : "";
  const to = range.preset === "custom" ? range.to : range.preset === "all" ? "" : today;

  const rows = useMemo(
    () =>
      reports
        .map((r) => ({ ...r, place: placeOf(r.location), day: dayKey(r.occurred_at || r.created_at), cat: r.category || UNSPECIFIED }))
        .filter((r) => (!from || r.day >= from) && (!to || r.day <= to) && (site === "all" || r.place.site === site)),
    [reports, from, to, site],
  );
  const sites = useMemo(() => [...new Set(reports.map((r) => placeOf(r.location).site).filter((x) => x !== UNSPECIFIED))].sort(), [reports]);

  const total = rows.length;
  const resolved = rows.filter((r) => r.status === "Resolved").length;
  const active = total - resolved;
  const timed = rows.filter((r) => r.resolution_time_minutes != null);
  const avgTat = timed.length ? Math.round(timed.reduce((a, r) => a + r.resolution_time_minutes, 0) / timed.length) : null;
  const missingPlace = rows.filter((r) => r.place.site === UNSPECIFIED).length;
  const missingCat = rows.filter((r) => r.cat === UNSPECIFIED).length;

  // Floors grouped by site, top floor first.
  const floorMap = new Map();
  for (const r of rows) {
    const key = `${r.place.site}|${r.place.floor}`;
    const e = floorMap.get(key) || { site: r.place.site, floor: r.place.floor, n: 0, open: 0, cats: {} };
    e.n += 1;
    if (r.status !== "Resolved") e.open += 1;
    e.cats[r.cat] = (e.cats[r.cat] || 0) + 1;
    floorMap.set(key, e);
  }
  const floors = [...floorMap.values()];
  const maxFloor = Math.max(1, ...floors.map((f) => f.n));
  const bySite = [...new Set(floors.map((f) => f.site))]
    .filter((s) => s !== UNSPECIFIED)
    .sort((a, b) => a.localeCompare(b))
    .map((s) => ({ site: s, floors: floors.filter((f) => f.site === s).sort((a, b) => floorRank(a.floor) - floorRank(b.floor)) }));
  const topFloor = floors.filter((f) => f.site !== UNSPECIFIED).sort((a, b) => b.n - a.n)[0];

  const catCounts = Object.entries(rows.reduce((acc, r) => ((acc[r.cat] = (acc[r.cat] || 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...catCounts.map(([, n]) => n));
  const topCat = catCounts.find(([c]) => c !== UNSPECIFIED);

  // Floor × category grid, only the categories and floors that occur.
  const gridCats = catCounts.map(([c]) => c).filter((c) => c !== UNSPECIFIED);
  const gridFloors = bySite.flatMap((g) => g.floors);
  const maxCell = Math.max(1, ...gridFloors.flatMap((f) => Object.values(f.cats)));

  // Trend: days for short ranges, weeks up to ~6 months, months beyond.
  const firstDay = from || (rows.length ? rows.map((r) => r.day).sort()[0] : today);
  const lastDay = to || today;
  const span = Math.round((Date.parse(lastDay) - Date.parse(firstDay)) / DAY) + 1;
  const unit = span <= 31 ? "day" : span <= 190 ? "week" : "month";
  const bucketOf = (key) => {
    if (unit === "day") return key;
    if (unit === "month") return key.slice(0, 7);
    const d = new Date(`${key}T12:00:00+05:30`);
    const monday = (d.getUTCDay() + 6) % 7;
    return shiftKey(key, -monday);
  };
  const buckets = [];
  for (let k = bucketOf(firstDay); k <= lastDay && buckets.length < 400; ) {
    buckets.push(k);
    k = unit === "day" ? shiftKey(k, 1) : unit === "week" ? shiftKey(k, 7) : (() => { const [y, m] = k.split("-").map(Number); return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`; })();
    if (unit === "month" && k > lastDay.slice(0, 7)) break;
  }
  const trend = buckets.map((b) => ({ b, n: rows.filter((r) => bucketOf(r.day) === b).length }));
  const maxTrend = Math.max(1, ...trend.map((t) => t.n));
  const bucketLabel = (b) => (unit === "month" ? new Date(`${b}-15T12:00:00+05:30`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: TZ }) : shortKey(b));

  const rangeLabel = range.preset === "custom" ? `${from ? shortKey(from) : "Start"} – ${to ? shortKey(to) : "today"}` : RANGE_PRESETS.find((p) => p[0] === range.preset)?.[1];
  const lead = total
    ? `${plural(total, "incident")}${topFloor ? ` · most reported on ${topFloor.site} ${topFloor.floor} (${topFloor.n})` : ""}${topCat ? ` · most common issue: ${topCat[0]} (${topCat[1]})` : ""}`
    : "No incidents in this period.";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#55555e]">{lead}</p>
        <div className="flex flex-wrap items-center gap-2">
          {sites.length > 1 && (
            <div className="flex gap-0.5 rounded-[9px] bg-[#ebeae6] p-[3px]">
              {[["all", "All sites"], ...sites.map((x) => [x, x])].map(([k, l]) => (
                <button key={k} onClick={() => setSite(k)} className={`rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium ${seg(site === k)}`}>{l}</button>
              ))}
            </div>
          )}
          <DateRangeMenu
            from={from}
            to={to}
            max={today}
            label={rangeLabel}
            summary="Filters by the date the incident happened"
            presets={RANGE_PRESETS.map(([key, label]) => ({ key, label, active: range.preset === key }))}
            onPreset={(key) => setRange({ preset: key, from: "", to: "" })}
            onFrom={(v) => setRange({ preset: "custom", from: v, to: to || today })}
            onTo={(v) => setRange({ preset: "custom", from, to: v })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ["Incidents", total, `${rangeLabel}${site === "all" ? "" : ` · ${site}`}`],
          ["Resolved", total ? `${pct(resolved, total)}%` : "—", `${resolved} of ${total}`],
          ["Open / monitoring", active, active ? "still being worked on" : "none outstanding", active ? "#b42318" : undefined],
          ["Average TAT", formatTat(avgTat), timed.length ? `across ${plural(timed.length, "resolved incident")}` : "no resolved incidents"],
          ["Most affected floor", topFloor ? topFloor.floor : "—", topFloor ? `${topFloor.site} · ${plural(topFloor.n, "incident")}` : "no floor recorded yet"],
        ].map(([label, value, sub, color]) => (
          <Card key={label} className="border-[#E5E9EF] px-4 py-3 shadow-none">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#8B93A1]">{label}</p>
            <p className="mt-1 truncate text-xl font-semibold text-[#17171c]" style={color ? { color } : undefined}>{value}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-[#8B93A1]">{sub}</p>
          </Card>
        ))}
      </div>

      {(missingPlace > 0 || missingCat > 0) && total > 0 && (
        <p className="rounded-lg bg-[#FDF3DC] px-3 py-2 text-xs text-[#8a5a00]">
          {missingPlace ? `${plural(missingPlace, "incident")} ${missingPlace === 1 ? "has" : "have"} no floor recorded` : ""}
          {missingPlace && missingCat ? " and " : ""}
          {missingCat ? `${plural(missingCat, "incident")} ${missingCat === 1 ? "has" : "have"} no category` : ""}
          {" — they were logged before these fields existed. Edit them in Reports to complete the analysis."}
        </p>
      )}

      {!total ? (
        <Card className="border-[#E5E9EF] p-10 text-center shadow-none">
          <AlertOctagon className="mx-auto h-8 w-8 text-[#B0B6C2]" />
          <p className="mt-2 text-sm text-[#69738B]">No incidents were reported in this period.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
            <Panel title="Where issues are reported" note="Each site drawn as a building, top floor first. Bar length = number of incidents on that floor.">
              {!bySite.length && (
                <div className="rounded-xl border border-dashed border-[#D6DAE1] px-4 py-8 text-center text-sm text-[#69738B]">
                  No floor has been recorded yet. New incidents ask for the location / floor, and the building view fills in as they come in.
                </div>
              )}
              {bySite.length > 0 && missingPlace > 0 && (
                <p className="mb-3 text-xs text-[#8B93A1]">{plural(missingPlace, "incident")} without a floor {missingPlace === 1 ? "is" : "are"} not shown here.</p>
              )}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {bySite.map(({ site: s, floors: fl }) => (
                  <div key={s} className="overflow-hidden rounded-xl border border-[#E5E9EF]">
                    <div className="flex items-center gap-2 border-b border-[#EDF0F4] bg-[#FAFBFC] px-3 py-2">
                      <MapPin className="h-3.5 w-3.5 text-[#b3177f]" />
                      <span className="text-[13px] font-semibold text-[#17171c]">{s}</span>
                      <span className="ml-auto text-xs text-[#8B93A1]">{plural(fl.reduce((a, f) => a + f.n, 0), "incident")}</span>
                    </div>
                    {fl.map((f) => {
                      const top = Object.entries(f.cats).sort((a, b) => b[1] - a[1])[0];
                      const hot = f === topFloor;
                      return (
                        <div key={f.floor} className={`grid grid-cols-[minmax(92px,auto)_1fr_auto] items-center gap-3 border-b border-[#F1F3F7] px-3 py-2.5 last:border-b-0 ${hot ? "bg-[#fbf2f8]" : ""}`}>
                          <div className="min-w-0">
                            <p className="truncate text-[12.5px] font-medium text-[#17171c]">{f.floor}</p>
                            <p className="truncate text-[11px] text-[#8B93A1]">{top && top[0] !== UNSPECIFIED ? `Mostly ${top[0]}` : ""}</p>
                          </div>
                          <Bar value={f.n} max={maxFloor} />
                          <span className="w-12 text-right text-[12.5px] font-semibold tabular-nums text-[#17171c]">
                            {f.n}
                            {f.open > 0 && <span className="block text-[10.5px] font-medium text-[#b42318]">{f.open} open</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="What issues are raised" note="Incidents by category, most frequent first.">
              <div className="space-y-3">
                {catCounts.map(([c, n]) => (
                  <div key={c} className="grid grid-cols-[minmax(120px,170px)_1fr_auto] items-center gap-3">
                    <span className={`truncate text-[12.5px] ${c === UNSPECIFIED ? "italic text-[#8B93A1]" : "text-[#17171c]"}`}>{c}</span>
                    <Bar value={n} max={maxCat} tone={c === UNSPECIFIED ? "#C7CCD6" : "#2f6bd0"} />
                    <span className="w-16 text-right text-[12.5px] tabular-nums text-[#55555e]"><b className="text-[#17171c]">{n}</b> · {pct(n, total)}%</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Issues by floor and category" note="Each cell counts incidents of that category on that floor — darker means more. Read across a row to see a floor's problems.">
            {!gridFloors.length || !gridCats.length ? (
              <p className="rounded-xl border border-dashed border-[#D6DAE1] px-4 py-8 text-center text-sm text-[#69738B]">
                This grid fills in once incidents carry both a floor and a category.
              </p>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-separate border-spacing-1 text-center text-[12px]">
                <thead>
                  <tr>
                    <th className="w-44 text-left text-[11px] font-medium text-[#8B93A1]">Floor</th>
                    {gridCats.map((c) => <th key={c} className="px-1 text-[11px] font-medium leading-tight text-[#8B93A1]">{c}</th>)}
                    <th className="text-[11px] font-medium text-[#8B93A1]">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {gridFloors.map((f) => (
                    <tr key={`${f.site}|${f.floor}`}>
                      <td className="truncate pr-2 text-left text-[12.5px] text-[#17171c]">{f.site === UNSPECIFIED ? UNSPECIFIED : `${f.site} · ${f.floor}`}</td>
                      {gridCats.map((c) => {
                        const n = f.cats[c] || 0;
                        const a = n ? 0.18 + 0.82 * (n / maxCell) : 0;
                        return (
                          <td key={c} className="h-9 rounded-md font-semibold tabular-nums" style={n ? { background: `rgba(179,23,127,${a.toFixed(2)})`, color: a > 0.55 ? "#fff" : "#5c0b41" } : { background: "rgba(140,148,160,.08)", color: "transparent" }} title={`${f.site} ${f.floor} · ${c}: ${n}`}>
                            {n || "·"}
                          </td>
                        );
                      })}
                      <td className="font-semibold tabular-nums text-[#17171c]">{f.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </Panel>

          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Panel title="Incidents over time" note={`Per ${unit}, by the date the incident happened.`}>
              <div className="flex h-40 items-end gap-1">
                {trend.map((t) => (
                  <div key={t.b} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${bucketLabel(t.b)}: ${t.n}`}>
                    {t.n > 0 && <span className="text-[10.5px] font-semibold tabular-nums text-[#55555e]">{t.n}</span>}
                    <span className="w-full max-w-[34px] rounded-t-[4px]" style={{ height: `${t.n ? Math.max(6, (t.n / maxTrend) * 100) : 2}%`, background: t.n ? "#b3177f" : "#E5E9EF" }} />
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[10.5px] text-[#8B93A1]">
                <span>{bucketLabel(trend[0]?.b || firstDay)}</span>
                {trend.length > 2 && <span>{bucketLabel(trend[Math.floor(trend.length / 2)].b)}</span>}
                <span>{bucketLabel(trend.at(-1)?.b || lastDay)}</span>
              </div>
            </Panel>

            <Panel title="Recent incidents" note="Latest first — click one to open its full report.">
              <div className="-my-1 divide-y divide-[#F1F3F7]">
                {[...rows].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)).slice(0, 6).map((r) => (
                  <button key={r.id} onClick={() => onOpen(r)} className="flex w-full items-center gap-3 py-2 text-left hover:bg-[#FAFBFC]">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-[#17171c]">{r.issue}</p>
                      <p className="truncate text-[11.5px] text-[#8B93A1]">{r.location || "No floor recorded"}{r.category ? ` · ${r.category}` : ""} · {formatIncidentDate(r.occurred_at)}</p>
                    </div>
                    <IncidentStatus status={r.status} />
                  </button>
                ))}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

export default function IncidentReportsView({ user }) {
  const [reports, reload, locations] = useIncidentReports();
  const isSuperAdmin = user.role === "super_admin";
  const [tab, setTab] = useState(isSuperAdmin ? "dashboard" : "reports");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [where, setWhere] = useState("all");
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState(null);
  const canReport = user.role === "it";

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (reports || []).filter(
      (row) =>
        (status === "all" || row.status === status) &&
        (category === "all" || (row.category || UNSPECIFIED) === category) &&
        (where === "all" || (row.location || UNSPECIFIED) === where) &&
        (!term ||
          [row.issue, row.root_cause, row.impact, row.resolution, row.reported_by, row.category, row.location]
            .join(" ")
            .toLowerCase()
            .includes(term)),
    );
  }, [reports, query, status, category, where]);
  const whereOptions = useMemo(
    () => [...new Set((reports || []).map((r) => r.location || UNSPECIFIED))].sort((a, b) => (a === UNSPECIFIED) - (b === UNSPECIFIED) || a.localeCompare(b)),
    [reports],
  );

  const remove = async (report) => {
    if (!window.confirm(`Delete the incident report "${report.issue}"?`)) return;
    try {
      await api(`/incident-reports/${report.id}`, { method: "DELETE" });
      toast.success("Incident report deleted");
      reload();
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-.01em] text-[#17171c]">
            Incident reports
          </h1>
          <p className="text-sm text-[#69738B]">
            {canReport
              ? "Log each IT incident with its location, root cause, impact, action taken and turnaround time. Super Admin is notified of every report."
              : "Incidents reported by the IT team — where they happen, what they are, and how fast they are fixed."}
          </p>
        </div>
        {canReport && (
          <Button
            className="w-full bg-[#131C26] hover:bg-[#1C2836] sm:w-auto"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Report incident
          </Button>
        )}
      </div>

      <div className="flex w-fit gap-0.5 rounded-[10px] bg-[#ebeae6] p-[3px]" role="tablist" aria-label="Incident views">
        {[["dashboard", "Dashboard", LayoutDashboard], ["reports", "Reports", ListChecks]].map(([k, l, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 rounded-lg px-3.5 py-[7px] text-[13px] font-medium ${seg(tab === k)}`}>
            <Icon className="h-3.5 w-3.5" />
            {l}
            {k === "reports" && reports && <span className="rounded-full bg-[#F1F3F7] px-1.5 text-[11px] font-semibold text-[#55555e]">{reports.length}</span>}
          </button>
        ))}
      </div>

      {tab === "dashboard" ? (
        reports ? (
          <IncidentDashboard reports={reports} onOpen={setViewing} />
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        )
      ) : (
        <>
          <Card className="overflow-hidden border-[#E5E9EF] shadow-none">
            {reports ? <StatStrip reports={reports} /> : <Skeleton className="h-20 w-full" />}
            <div className="flex flex-wrap items-center gap-2 border-t border-[#E5E9EF] px-4 py-3">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8B93A1]" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search issue, cause, impact, floor or reporter…"
                  className="pl-9"
                />
              </div>
              <Select value={where} onValueChange={setWhere}>
                <SelectTrigger className="w-full sm:w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All floors</SelectItem>
                  {whereOptions.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full sm:w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {[...INCIDENT_CATEGORIES, UNSPECIFIED].map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUSES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>

          {!reports ? (
            <div className="space-y-3">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : !filtered.length ? (
            <Card className="border-[#E5E9EF] p-10 text-center shadow-none">
              <AlertOctagon className="mx-auto h-8 w-8 text-[#B0B6C2]" />
              <p className="mt-2 text-sm text-[#69738B]">
                {reports.length
                  ? "No incident reports match your filters."
                  : canReport
                    ? "No incidents reported yet. Use “Report incident” to log one."
                    : "The IT team has not reported any incidents yet."}
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              {filtered.map((report) => {
                const canEdit = isSuperAdmin || report.reported_by_id === user.id;
                return (
                  <Card key={report.id} className="overflow-hidden border-[#E5E9EF] shadow-none">
                    <div className="flex flex-wrap items-center gap-2 border-b border-[#E5E9EF] px-4 py-3">
                      <div className="mr-auto min-w-0">
                        <p className="truncate font-semibold text-[#17171c]">{report.issue}</p>
                        <p className="text-xs text-[#8B93A1]">
                          {report.location || "No floor recorded"} · Reported by {report.reported_by} ·{" "}
                          {formatIncidentDate(report.created_at)}
                        </p>
                      </div>
                      <IncidentStatus status={report.status} />
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditing(report);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      )}
                      {isSuperAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => remove(report)}
                          aria-label="Delete incident report"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="p-4">
                      <IncidentSheet report={report} />
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <IncidentForm
        open={formOpen}
        report={editing}
        locations={locations}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
      />
      <IncidentDetail report={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

// Compact recent-incidents card for the Super Admin dashboard.
export function IncidentReportsPanel({ onViewAll }) {
  const [reports] = useIncidentReports();
  const [viewing, setViewing] = useState(null);
  const recent = (reports || []).slice(0, 5);
  return (
    <Card className="mt-6 overflow-hidden border-[#E5E9EF] shadow-none">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#E5E9EF] px-4 py-4 sm:px-5">
        <div className="mr-auto">
          <h2 className="flex items-center gap-2 font-bold">
            <AlertOctagon className="h-4 w-4 text-[#9D139D]" />
            IT incident reports
          </h2>
          <p className="text-xs text-[#8B93A1]">
            Incidents logged by IT members, with root cause, impact and turnaround time.
          </p>
        </div>
        {onViewAll && (
          <Button variant="outline" size="sm" onClick={onViewAll}>
            View all
          </Button>
        )}
      </div>
      {!reports ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <StatStrip reports={reports} />
          {recent.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-[#FAFBFC] text-[10px] uppercase tracking-wider text-[#8B93A1]">
                  <tr>
                    <th className="px-4 py-3">Issue</th>
                    <th className="px-4 py-3">Date &amp; time</th>
                    <th className="px-4 py-3">TAT</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Reported by</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {recent.map((report) => (
                    <tr key={report.id} className="border-t border-[#EDF0F4]">
                      <td className="max-w-80 px-4 py-3">
                        <b className="block truncate">{report.issue}</b>
                        <p className="truncate text-xs text-[#69738B]">
                          {report.location ? `${report.location} · ` : ""}RCA: {report.root_cause}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">
                        {formatIncidentDate(report.occurred_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3 w-3 text-[#8B93A1]" />
                          {formatTat(report.resolution_time_minutes)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <IncidentStatus status={report.status} />
                      </td>
                      <td className="px-4 py-3 text-xs">{report.reported_by}</td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="outline" size="sm" onClick={() => setViewing(report)}>
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-8 text-center text-sm text-[#69738B]">
              No incidents reported by the IT team yet.
            </p>
          )}
        </>
      )}
      <IncidentDetail report={viewing} onClose={() => setViewing(null)} />
    </Card>
  );
}

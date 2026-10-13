"use client";

import { useEffect, useMemo, useState } from "react";
import { workingHoursBetween } from "@/lib/sla";
import { X } from "lucide-react";
import DateRangeMenu from "@/components/app/DateRangeMenu";

const DAY = 86400000;
const DESK = {
  IT: { label: "IT", color: "#2f6bd0", soft: "#e8f0fc" },
  Admin: { label: "Admin", color: "#12795a", soft: "#e4f3ec" },
};
const DONE = ["Resolved", "Closed", "Cancelled"];
const AGE = [
  ["< 1 day", 0, 1, "#b9b7b0"],
  ["1–3 days", 1, 3, "#d1a441"],
  ["3–7 days", 3, 7, "#e0822f"],
  ["1–4 weeks", 7, 28, "#cf4e36"],
  ["> 4 weeks", 28, Infinity, "#9e1f14"],
];
// "Per workday" and "Last 7 days" drop out below xl so Checklist and Signals stay on screen.
const MEMBER_COLS = {
  "--cols": "minmax(190px,2fr) 80px 100px 70px minmax(110px,1.2fr) 100px minmax(180px,1.6fr)",
  "--cols-xl": "minmax(210px,2.2fr) 90px 90px 100px 80px minmax(130px,1.3fr) 100px 96px minmax(200px,1.6fr)",
};
const MEMBER_COLS_CLS = "[grid-template-columns:var(--cols)] xl:[grid-template-columns:var(--cols-xl)]";
const seg = (on) =>
  on
    ? "bg-white text-[#17171c] shadow-[0_1px_2px_rgba(0,0,0,.08)]"
    : "bg-transparent text-[#6b6b76]";
const initials = (name = "") =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const dayKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const raisedAt = (t) => t.raised_at || t.created_at;
const resolvedAt = (t) =>
  ["Resolved", "Closed"].includes(t.status)
    ? t.resolved_at || t.resolution?.resolved_date || t.closed_at || null
    : null;
const isOverdue = (t, now) =>
  !DONE.includes(t.status) &&
  t.sla_resolution_due &&
  new Date(t.sla_resolution_due).getTime() < now;
const hrs = (value) => (value == null ? "—" : `${Math.round(value * 10) / 10}h`);
const mean = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const shortDate = (date) =>
  new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const Card = ({ className = "", children }) => (
  <section className={`rounded-xl border border-[#e8e7e3] bg-white ${className}`}>
    {children}
  </section>
);
const Note = ({ children }) => (
  <div className="rounded-lg bg-[#f7f6f3] px-3 py-2.5 text-[12.5px] leading-normal text-[#3b3b44]">
    {children}
  </div>
);
const Heading = ({ title, sub }) => (
  <div className="flex flex-col gap-[3px]">
    <h3 className="m-0 text-sm font-semibold">{title}</h3>
    <span className="text-xs text-[#6b6b76]">{sub}</span>
  </div>
);

export default function OperationsOverview({
  data,
  from,
  to,
  setFrom,
  setTo,
  maxDate,
  onExport,
  onRemindAll,
  onViewKra,
  onOpenReport,
  onOpenTicket,
}) {
  const [desk, setDesk] = useState("all");
  const [sort, setSort] = useState({ key: "resolved", dir: -1 });
  const [showIdle, setShowIdle] = useState(true);
  const [drawer, setDrawer] = useState(null);
  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const model = useMemo(() => {
    const now = Date.now();
    const start = new Date(`${from}T00:00:00`).getTime();
    const end = new Date(`${to}T23:59:59.999`).getTime();
    const desks = desk === "all" ? ["IT", "Admin"] : [desk];
    const ticketsOf = (d) => (d === "IT" ? data.itTickets : data.adminTickets);
    const all = desks.flatMap(ticketsOf);
    const inWindow = (value) => {
      if (!value) return false;
      const t = new Date(value).getTime();
      return t >= start && t <= end;
    };
    const created = all.filter((t) => inWindow(raisedAt(t)));
    const resolved = all.filter((t) => inWindow(resolvedAt(t)));
    const resHours = (t) => workingHoursBetween(raisedAt(t), resolvedAt(t));
    const active = all.filter((t) => !DONE.includes(t.status));
    const overdue = active.filter((t) => isOverdue(t, now));

    // ---- days in range (capped to 31 so the chart stays legible)
    const days = [];
    for (let d = new Date(start); d.getTime() <= Math.min(end, now) && days.length < 62; d.setDate(d.getDate() + 1))
      days.push(dayKey(d));
    const shownDays = days.slice(-31);
    const workdays = days.filter((key) => {
      const w = new Date(`${key}T12:00:00`).getDay();
      return w !== 0 && w !== 6;
    }).length || 1;
    const createdByDay = {};
    created.forEach((t) => {
      const k = dayKey(raisedAt(t));
      createdByDay[k] = (createdByDay[k] || 0) + 1;
    });
    const resolvedByDay = {};
    resolved.forEach((t) => {
      const k = dayKey(resolvedAt(t));
      resolvedByDay[k] = (resolvedByDay[k] || 0) + 1;
    });
    const maxV = Math.max(1, ...shownDays.map((k) => Math.max(createdByDay[k] || 0, resolvedByDay[k] || 0)));
    const chart = shownDays.map((k) => {
      const c = createdByDay[k] || 0;
      const r = resolvedByDay[k] || 0;
      const date = new Date(`${k}T12:00:00`);
      return {
        key: k,
        label: `${date.toLocaleDateString("en-GB", { weekday: "short" })} ${date.getDate()}`,
        ch: Math.round((c / maxV) * 150),
        rh: Math.round((r / maxV) * 150),
        net: `${r - c > 0 ? "+" : ""}${r - c}`,
        tip: `${c} created · ${r} resolved`,
        c,
      };
    });
    const gap = created.length - resolved.length;
    const peak = [...chart].sort((a, b) => b.c - a.c)[0];
    const trendNote =
      gap <= Math.max(5, created.length * 0.05)
        ? `Keeping pace — ${resolved.length} resolved vs ${created.length} created.${peak && peak.c ? ` ${peak.label} was the busiest day (${peak.c} created).` : ""}`
        : `Falling behind by ${gap} tickets in this range — ${resolved.length} resolved vs ${created.length} created.`;

    // ---- backlog age
    const ageDays = (t) => (now - new Date(raisedAt(t)).getTime()) / DAY;
    const aging = AGE.map(([label, lo, hi, color]) => ({
      label,
      color,
      n: active.filter((t) => ageDays(t) >= lo && ageDays(t) < hi).length,
    }));
    const agMax = Math.max(1, ...aging.map((a) => a.n));
    const old = aging[3].n + aging[4].n;
    const agingNote = !active.length
      ? "No live tickets. Healthy."
      : old
        ? `${old} ticket${old === 1 ? " is" : "s are"} over a week old${overdue.length ? ` and ${overdue.length} are past SLA` : ""}. Recent intake is being handled; the risk is old tickets nobody returns to.`
        : "Nothing older than a week. Healthy.";

    // ---- KPIs
    const avgRes = mean(resolved.map(resHours));
    const deskAvg = (d) => mean(resolved.filter((t) => t.department === d).map(resHours));
    const met = resolved.filter(
      (t) => t.sla_resolution_due && new Date(resolvedAt(t)) <= new Date(t.sla_resolution_due),
    ).length;
    const judged = resolved.filter((t) => t.sla_resolution_due).length + overdue.length;
    const kpi = {
      created: created.length,
      createdSub:
        desk === "all"
          ? `${created.filter((t) => t.department === "IT").length} IT · ${created.filter((t) => t.department === "Admin").length} Admin`
          : `${shortDate(start)} – ${shortDate(end)}`,
      resolved: resolved.length,
      resolvedSub: `${pct(resolved.length, created.length)}% of created`,
      avgRes: hrs(avgRes),
      avgResSub:
        desk === "all" ? `IT ${hrs(deskAvg("IT"))} · Admin ${hrs(deskAvg("Admin"))}` : "working hours, raised → resolved",
      sla: judged ? `${pct(met, judged)}%` : "—",
      slaSub: `${met} on time of ${judged} (resolved + live overdue)`,
      backlog: active.length,
      backlogSub: `${overdue.length} overdue · ${active.length - overdue.length} on track`,
    };

    // ---- members
    const kraById = new Map((data.kra?.members || []).map((m) => [m.member_id, m]));
    const members = desks.flatMap((d) =>
      ((d === "IT" ? data.itSla : data.adminSla)?.members || []).map((m) => ({ ...m, desk: d })),
    );
    const deskResolved = {};
    const rows = members.map((m) => {
      const mine = ticketsOf(m.desk).filter((t) => t.assignee_id === m.member_id);
      const res = mine.filter((t) => inWindow(resolvedAt(t)));
      deskResolved[m.desk] = (deskResolved[m.desk] || 0) + res.length;
      const live = mine.filter((t) => !DONE.includes(t.status));
      const late = live.filter((t) => isOverdue(t, now));
      const kra = kraById.get(m.member_id);
      const byDay = {};
      res.forEach((t) => {
        const k = dayKey(resolvedAt(t));
        byDay[k] = (byDay[k] || 0) + 1;
      });
      const cats = {};
      res.forEach((t) => {
        cats[t.category || "Other"] = (cats[t.category || "Other"] || 0) + 1;
      });
      const latest = [...mine].sort((a, b) => new Date(raisedAt(b)) - new Date(raisedAt(a)))[0];
      return {
        member: m,
        id: m.member_id,
        name: m.member_name,
        desk: m.desk,
        site: m.location || "—",
        resolved: res.length,
        perDay: res.length / workdays,
        res: res.length ? mean(res.map(resHours)) : null,
        load: live.length,
        overdue: late.length,
        overdueTickets: late,
        spark: shownDays.slice(-7).map((k) => byDay[k] || 0),
        sparkDays: shownDays.slice(-7),
        cats: Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 5),
        latest,
        kra: kra ? (kra.submitted_lists > 0 ? "yes" : "no") : "na",
        kraRow: kra,
        kraDays: data.kraActivity?.get(m.member_id)?.dayCount || 0,
      };
    });
    rows.forEach((r) => {
      r.share = pct(r.resolved, deskResolved[r.desk]);
    });
    const topBy = {};
    desks.forEach((d) => {
      const top = rows.filter((r) => r.desk === d && r.resolved).sort((a, b) => b.resolved - a.resolved)[0];
      if (top) topBy[d] = top.id;
    });
    rows.forEach((r) => {
      r.flags = [];
      if (topBy[r.desk] === r.id) r.flags.push(["Top closer", "bg-[#e4f3ec] text-[#12795a]"]);
      if (r.overdue) r.flags.push([`${r.overdue} overdue`, "bg-[#fdeaea] text-[#b42318]"]);
      if (!r.resolved) r.flags.push(["No closures", "bg-[#fdf3dc] text-[#8a5a00]"]);
      if (r.res != null && r.res >= 4) r.flags.push(["Slow resolution", "bg-[#fdf3dc] text-[#8a5a00]"]);
    });

    // ---- insights (only statements the data supports)
    const insights = [];
    const first = (name) => name.split(" ")[0];
    const itRows = rows.filter((r) => r.desk === "IT").sort((a, b) => b.resolved - a.resolved);
    if (desk !== "Admin" && deskResolved.IT >= 10 && itRows.length > 3) {
      const top3 = itRows.slice(0, 3);
      const share = pct(top3.reduce((a, r) => a + r.resolved, 0), deskResolved.IT);
      insights.push({
        text: `Top 3 IT members closed ${share}% of IT tickets — ${share >= 60 ? "high dependency on " : ""}${top3.map((r) => first(r.name)).join(", ")}`,
        cls: "bg-[#e8f0fc] text-[#1d4f9e]",
        dot: "#1d4f9e",
      });
    }
    const idleOwners = rows.filter((r) => !r.resolved && r.overdue);
    if (idleOwners.length)
      insights.push({
        text: `${idleOwners.map((r) => r.name).slice(0, 3).join(" & ")} closed nothing in this range but own ${idleOwners.reduce((a, r) => a + r.overdue, 0)} overdue ticket${idleOwners.reduce((a, r) => a + r.overdue, 0) === 1 ? "" : "s"}`,
        cls: "bg-[#fdeaea] text-[#b42318]",
        dot: "#b42318",
      });
    const adminRows = rows.filter((r) => r.desk === "Admin").sort((a, b) => b.resolved - a.resolved);
    const adminCreated = created.filter((t) => t.department === "Admin");
    if (desk !== "IT" && adminRows[0]?.resolved) {
      const lead = adminRows[0];
      const handled = adminCreated.filter((t) => t.assignee_id === lead.id).length;
      const idle = adminRows.filter((r) => !r.resolved).length;
      insights.push({
        text: `${lead.name} carries ${handled} of ${adminCreated.length} Admin tickets${lead.res != null ? ` at ${hrs(lead.res)} avg` : ""}${idle ? ` — ${idle} Admin member${idle === 1 ? "" : "s"} closed nothing` : ""}`,
        cls: "bg-[#fdf3dc] text-[#8a5a00]",
        dot: "#8a5a00",
      });
    }
    const enrolled = rows.filter((r) => r.kra !== "na");
    if (enrolled.length) {
      const done = enrolled.filter((r) => r.kra === "yes");
      insights.push({
        text:
          done.length === 1
            ? `Only ${done[0].name} submitted today’s checklist (${done.length} of ${enrolled.length})`
            : `${done.length} of ${enrolled.length} Checklists submitted today`,
        cls: "bg-[#f1f0ec] text-[#3b3b44]",
        dot: "#3b3b44",
      });
    }

    // ---- categories
    const catCount = {};
    created.forEach((t) => {
      const key = `${t.category || "Other"}|${t.department}`;
      catCount[key] = (catCount[key] || 0) + 1;
    });
    const catRows = Object.entries(catCount)
      .map(([key, c]) => {
        const [n, d] = key.split("|");
        return { n, d, c };
      })
      .sort((a, b) => b.c - a.c)
      .slice(0, 9);
    const catMax = Math.max(1, ...catRows.map((c) => c.c));
    const laptop = created.filter((t) => /laptop/i.test(t.category || "")).length;
    const topCat = catRows[0];
    const catNote = created.length
      ? laptop >= created.length * 0.2
        ? { strong: `${laptop} of ${created.length} tickets (${pct(laptop, created.length)}%) are laptop-related.`, rest: topCat ? ` ${topCat.n} leads with ${topCat.c}.` : "" }
        : { strong: topCat ? `${topCat.n} is the top request (${topCat.c} of ${created.length}).` : "", rest: "" }
      : null;

    // ---- desk comparison
    const deskStats = ["IT", "Admin"].map((d) => {
      const c = data[d === "IT" ? "itTickets" : "adminTickets"];
      const cr = c.filter((t) => inWindow(raisedAt(t))).length;
      const rs = c.filter((t) => inWindow(resolvedAt(t)));
      const dm = rows.length && desk === "all" ? rows.filter((r) => r.desk === d) : ((d === "IT" ? data.itSla : data.adminSla)?.members || []).map((m) => ({ id: m.member_id, resolved: rs.filter((t) => t.assignee_id === m.member_id).length }));
      const activeMembers = dm.filter((r) => r.resolved).length;
      return {
        d,
        created: cr,
        resolved: rs.length,
        avg: mean(rs.map(resHours)),
        overdue: c.filter((t) => isOverdue(t, now)).length,
        active: activeMembers,
        total: dm.length,
        per: activeMembers ? Math.round((rs.length / activeMembers) * 10) / 10 : 0,
      };
    });
    const [itS, adS] = deskStats;
    let deskNote = null;
    if (itS.avg && adS.avg) {
      const slow = adS.avg >= itS.avg ? adS : itS;
      const fast = slow === adS ? itS : adS;
      const slowRows = rows.length && desk === "all" ? rows.filter((r) => r.desk === slow.d).sort((a, b) => b.resolved - a.resolved) : [];
      const lead = slowRows[0];
      deskNote = {
        strong: `${slow.d} is ${(slow.avg / fast.avg).toFixed(1)}× slower to resolve than ${fast.d}.`,
        rest: lead?.resolved
          ? ` ${lead.name} closed ${lead.resolved} of ${slow.resolved} ${slow.d} tickets${lead.res != null ? ` at ${hrs(lead.res)} each` : ""}.${slow.total - slow.active ? ` ${slow.total - slow.active} ${slow.d} member${slow.total - slow.active === 1 ? "" : "s"} closed nothing.` : ""}`
          : "",
      };
    }

    return { kpi, chart, trendNote, aging, agMax, agingNote, rows, insights, catRows, catMax, catNote, deskStats, deskNote, workdays, activeCount: active.length };
  }, [data, desk, from, to]);

  const sortVal = {
    name: (r) => r.name.toLowerCase(),
    resolved: (r) => r.resolved,
    perDay: (r) => r.perDay,
    res: (r) => (r.res == null ? (sort.dir < 0 ? -1 : 1e9) : r.res),
    load: (r) => r.load,
    share: (r) => r.share,
    kra: (r) => (r.kra === "yes" ? 1 : r.kra === "no" ? 0 : -1),
  }[sort.key];
  const members = model.rows
    .filter((r) => showIdle || r.resolved > 0)
    .sort((a, b) => {
      const x = sortVal(a);
      const y = sortVal(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  const sortBy = (key) =>
    setSort((current) => ({
      key,
      dir: current.key === key ? -current.dir : key === "name" || key === "res" ? 1 : -1,
    }));
  const arrow = (key) => (sort.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : "");

  const selected = drawer && model.rows.find((r) => r.id === drawer);
  const rangeLabel = `${shortDate(`${from}T12:00:00`)} – ${shortDate(`${to}T12:00:00`)} ${to.slice(0, 4)}`;
  const preset = (days) => {
    const end = new Date(`${maxDate}T12:00:00`);
    const begin = new Date(end);
    begin.setDate(begin.getDate() - (days - 1));
    setFrom(dayKey(begin));
    setTo(maxDate);
  };
  const rangeDays = Math.round((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / DAY) + 1;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-[18px] text-[13px] text-[#17171c]">
      <header className="flex flex-wrap items-end justify-between gap-3.5">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[22px] font-semibold tracking-[-.01em]">Operations overview</h2>
          <div className="text-[#6b6b76]">
            IT &amp; Admin desks ·{" "}
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}{" "}
            · {rangeDays === 1 && to === maxDate ? "today" : rangeDays === 7 && to === maxDate ? "last 7 days" : `${rangeDays} day${rangeDays === 1 ? "" : "s"}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 rounded-[9px] bg-[#ebeae6] p-[3px]">
            {[["all", "All desks"], ["IT", "IT"], ["Admin", "Admin"]].map(([k, l]) => (
              <button key={k} onClick={() => setDesk(k)} className={`rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium ${seg(desk === k)}`}>{l}</button>
            ))}
          </div>
          <DateRangeMenu
            from={from}
            to={to}
            max={maxDate}
            label={rangeLabel}
            summary={`${rangeDays} day${rangeDays === 1 ? "" : "s"} selected`}
            presets={[1, 7, 14, 30].map((n) => ({ key: n, label: n === 1 ? "Today" : `Last ${n} days`, active: to === maxDate && rangeDays === n }))}
            onPreset={preset}
            onFrom={setFrom}
            onTo={setTo}
          />
          <button onClick={onExport} className="rounded-[9px] bg-[#17171c] px-3.5 py-2 text-[12.5px] font-medium text-white">Export report</button>
        </div>
      </header>

      <Card className="overflow-hidden">
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
          {[
            ["Tickets created", model.kpi.created, model.kpi.createdSub],
            ["Resolved", model.kpi.resolved, model.kpi.resolvedSub],
            ["Avg resolution time", model.kpi.avgRes, model.kpi.avgResSub],
            ["Resolution SLA (incl. overdue)", model.kpi.sla, model.kpi.slaSub],
            ["Live backlog", model.kpi.backlog, model.kpi.backlogSub],
          ].map(([label, value, sub]) => (
            <div key={label} className="flex flex-col gap-1.5 border-r border-[#efeeea] px-[18px] py-4 last:border-r-0">
              <span className="text-xs text-[#6b6b76]">{label}</span>
              <span className="text-2xl font-semibold tracking-[-.02em]">{value}</span>
              <span className="text-xs text-[#6b6b76]">{sub}</span>
            </div>
          ))}
        </div>
      </Card>

      <section className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))" }}>
        <Card className="flex flex-col gap-3.5 p-[18px]">
          <div className="flex flex-wrap justify-between gap-2">
            <Heading title="Created vs resolved" sub="Is the team keeping up with demand?" />
            <div className="flex items-center gap-3.5 text-xs text-[#55555e]">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[#d6d4ce]" />Created</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[#b3177f]" />Resolved</span>
            </div>
          </div>
          <div className="grid h-[170px] items-end border-b border-[#e8e7e3] px-1" style={{ gridTemplateColumns: `repeat(${model.chart.length || 1},minmax(0,1fr))`, gap: model.chart.length > 14 ? 3 : 10 }}>
            {model.chart.map((d) => (
              <div key={d.key} title={d.tip} className="flex h-full items-end justify-center gap-1">
                <div className="w-[40%] max-w-5 rounded-t bg-[#d6d4ce]" style={{ height: d.ch }} />
                <div className="w-[40%] max-w-5 rounded-t bg-[#b3177f]" style={{ height: d.rh }} />
              </div>
            ))}
          </div>
          <div className="-mt-1.5 grid px-1" style={{ gridTemplateColumns: `repeat(${model.chart.length || 1},minmax(0,1fr))`, gap: model.chart.length > 14 ? 3 : 10 }}>
            {model.chart.map((d, i) => (
              <div key={d.key} className="text-center text-[11.5px] leading-snug text-[#6b6b76]">
                {model.chart.length <= 14 || i % Math.ceil(model.chart.length / 10) === 0 ? (
                  <>
                    <div className="whitespace-nowrap">{d.label}</div>
                    <div className="font-medium text-[#17171c]">{d.net}</div>
                  </>
                ) : null}
              </div>
            ))}
          </div>
          <Note>{model.trendNote}</Note>
        </Card>

        <Card className="flex flex-col gap-3.5 p-[18px]">
          <Heading title="Backlog age" sub={`${model.activeCount} live tickets by age`} />
          <div className="flex flex-1 flex-col justify-center gap-3">
            {model.aging.map((a) => (
              <div key={a.label} className="grid items-center gap-3" style={{ gridTemplateColumns: "80px minmax(0,1fr) 28px" }}>
                <span className="text-[12.5px] text-[#55555e]">{a.label}</span>
                <div className="h-2.5 overflow-hidden rounded-[5px] bg-[#f1f0ec]"><div className="h-full rounded-[5px]" style={{ width: `${Math.round((a.n / model.agMax) * 100)}%`, background: a.color }} /></div>
                <span className="text-right font-semibold tabular-nums">{a.n}</span>
              </div>
            ))}
          </div>
          <Note>{model.agingNote}</Note>
        </Card>
      </section>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-[18px] pb-3.5 pt-[18px]">
          <Heading title="Team productivity" sub="Click a column to rank · click a member for the full report" />
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-[#55555e]">
            <input type="checkbox" checked={showIdle} onChange={() => setShowIdle((v) => !v)} className="accent-[#b3177f]" />
            Show members with no closures
          </label>
        </div>
        {model.insights.length > 0 && (
          <div className="flex flex-wrap gap-2 px-[18px] pb-4">
            {model.insights.map((item) => (
              <div key={item.text} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] leading-snug ${item.cls}`}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: item.dot }} />
                {item.text}
              </div>
            ))}
          </div>
        )}
        <div className="overflow-x-auto">
          <div className="min-w-[900px] xl:min-w-[1110px]">
            <div className={`grid gap-3 border-y border-[#efeeea] bg-[#f7f6f3] px-[18px] py-2.5 text-[11.5px] text-[#6b6b76] ${MEMBER_COLS_CLS}`} style={MEMBER_COLS}>
              <button onClick={() => sortBy("name")} className="text-left">Member{arrow("name")}</button>
              <button onClick={() => sortBy("resolved")} className="text-right">Resolved{arrow("resolved")}</button>
              <button onClick={() => sortBy("perDay")} className="hidden text-right xl:block">Per workday{arrow("perDay")}</button>
              <button onClick={() => sortBy("res")} className="text-right">Avg resolution{arrow("res")}</button>
              <button onClick={() => sortBy("load")} className="text-right">Live load{arrow("load")}</button>
              <button onClick={() => sortBy("share")} className="text-left">Share of desk{arrow("share")}</button>
              <span className="hidden xl:block">Last 7 days</span>
              <button onClick={() => sortBy("kra")} className="text-left">Checklist today{arrow("kra")}</button>
              <span>Signals</span>
            </div>
            {members.map((m) => {
              const D = DESK[m.desk];
              const sparkMax = Math.max(1, ...m.spark);
              return (
                <div key={m.id} onClick={() => setDrawer(m.id)} className={`grid cursor-pointer items-center gap-3 border-b border-[#f1f0ec] px-[18px] py-[11px] hover:bg-[#fbfaf8] ${MEMBER_COLS_CLS}`} style={MEMBER_COLS}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[11px] font-semibold" style={{ background: D.soft, color: D.color }}>{initials(m.name)}</div>
                    <div className="flex min-w-0 flex-col leading-tight"><span className="truncate font-medium">{m.name}</span><span className="text-[11.5px] text-[#8a8a93]">{D.label} · {m.site}</span></div>
                  </div>
                  <span className="text-right text-sm font-semibold tabular-nums">{m.resolved}</span>
                  <span className="hidden text-right tabular-nums xl:block">{m.perDay.toFixed(1)}</span>
                  <span className={`text-right tabular-nums ${m.res != null && m.res >= 4 ? "text-[#b42318]" : "text-[#17171c]"}`}>{hrs(m.res)}</span>
                  <span className="text-right tabular-nums">{m.load}</span>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-[#f1f0ec]"><div className="h-full rounded-[3px]" style={{ width: `${m.share}%`, background: D.color }} /></div>
                    <span className="w-[30px] text-right text-[11.5px] text-[#55555e]">{m.share}%</span>
                  </div>
                  <div className="hidden h-6 items-end gap-[3px] xl:flex">
                    {m.spark.map((v, i) => (
                      <div key={i} className="w-[7px] rounded-sm" style={{ height: Math.max(2, Math.round((v / sparkMax) * 24)), background: v ? D.color : "#e3e1dc" }} title={`${m.sparkDays[i]}: ${v}`} />
                    ))}
                  </div>
                  <div>
                    {m.kra === "yes" && <span className="rounded-full bg-[#e4f3ec] px-2 py-[3px] text-[11.5px] font-medium text-[#12795a]">Submitted</span>}
                    {m.kra === "no" && <span className="rounded-full bg-[#fdeaea] px-2 py-[3px] text-[11.5px] font-medium text-[#b42318]">Missing</span>}
                    {m.kra === "na" && <span className="text-[11.5px] text-[#9a9aa3]">Not enrolled</span>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {m.flags.map(([t, cls]) => <span key={t} className={`whitespace-nowrap rounded-[5px] px-[7px] py-[3px] text-[11px] font-medium ${cls}`}>{t}</span>)}
                  </div>
                </div>
              );
            })}
            {!members.length && <div className="p-7 text-center text-[#6b6b76]">No members to show.</div>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-[18px] py-3 text-[11.5px] text-[#8a8a93]">
          <span className="flex-1">Per workday = resolved ÷ {model.workdays} working day{model.workdays === 1 ? "" : "s"} in the range. Resolution times are working hours (10:00–19:00, Mon–Fri).</span>
          <button onClick={onRemindAll} className="rounded-lg border border-[#e0dfdb] bg-white px-2.5 py-1.5 text-xs text-[#17171c]">Remind pending checklists</button>
          <button onClick={onViewKra} className="rounded-lg border border-[#e0dfdb] bg-white px-2.5 py-1.5 text-xs text-[#17171c]">View checklist board</button>
        </div>
      </Card>

      <section className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))" }}>
        <Card className="flex flex-col gap-3.5 p-[18px]">
          <Heading title="What people keep asking for" sub="Tickets by category, selected range" />
          <div className="flex flex-col gap-[9px]">
            {model.catRows.map((c) => (
              <div key={`${c.n}-${c.d}`} className="grid items-center gap-3" style={{ gridTemplateColumns: "minmax(120px,170px) minmax(0,1fr) 28px" }}>
                <span className="truncate text-[#3b3b44]" title={`${c.n} · ${c.d}`}>{c.n}</span>
                <div className="h-2 overflow-hidden rounded bg-[#f1f0ec]"><div className="h-full rounded" style={{ width: `${Math.round((c.c / model.catMax) * 100)}%`, background: DESK[c.d]?.color || "#2f6bd0" }} /></div>
                <span className="text-right font-semibold tabular-nums">{c.c}</span>
              </div>
            ))}
            {!model.catRows.length && <span className="text-[#8a8a93]">No tickets in this range.</span>}
          </div>
          {model.catNote && <Note><strong className="font-semibold">{model.catNote.strong}</strong>{model.catNote.rest}</Note>}
        </Card>

        <Card className="flex flex-col gap-3.5 p-[18px]">
          <Heading title="Desk comparison" sub="Selected range · active members only" />
          <div className="grid text-[12.5px]" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr)" }}>
            <span className="py-2 text-[#6b6b76]" />
            <span className="py-2 text-right font-semibold text-[#2f6bd0]">IT</span>
            <span className="py-2 text-right font-semibold text-[#12795a]">Admin</span>
            {(() => {
              const [it, ad] = model.deskStats;
              const slowAvg = it.avg && ad.avg ? (it.avg > ad.avg ? "IT" : "Admin") : null;
              const rows = [
                ["Tickets created", it.created, ad.created],
                ["Resolved", it.resolved, ad.resolved],
                ["Avg resolution", hrs(it.avg), hrs(ad.avg), slowAvg],
                ["Overdue (live)", it.overdue, ad.overdue, "overdue"],
                ["Members who closed tickets", `${it.active} of ${it.total}`, `${ad.active} of ${ad.total}`],
                ["Resolved per active member", it.per.toFixed(1), ad.per.toFixed(1)],
              ];
              return rows.map(([label, a, b, flag]) => [
                <span key={`${label}-l`} className="border-t border-[#f1f0ec] py-[9px] text-[#55555e]">{label}</span>,
                <span key={`${label}-a`} className={`border-t border-[#f1f0ec] py-[9px] text-right font-medium ${(flag === "IT" || (flag === "overdue" && it.overdue)) ? "text-[#b42318]" : ""}`}>{a}</span>,
                <span key={`${label}-b`} className={`border-t border-[#f1f0ec] py-[9px] text-right font-medium ${(flag === "Admin" || (flag === "overdue" && ad.overdue)) ? "text-[#b42318]" : ""}`}>{b}</span>,
              ]);
            })()}
          </div>
          {model.deskNote && <Note><strong className="font-semibold">{model.deskNote.strong}</strong>{model.deskNote.rest}</Note>}
        </Card>
      </section>

      {selected && (() => {
        const D = DESK[selected.desk];
        const mx = Math.max(1, ...selected.spark);
        const cmx = Math.max(1, ...selected.cats.map((c) => c[1]));
        return (
          <>
            <div onClick={() => setDrawer(null)} className="fixed inset-0 z-40 bg-[rgba(23,23,28,.28)]" />
            <aside className="fixed inset-y-0 right-0 z-[41] flex w-[min(460px,100vw)] flex-col bg-white text-[13px] shadow-[-12px_0_40px_rgba(0,0,0,.12)]">
              <div className="flex items-start justify-between gap-3 border-b border-[#efeeea] px-[22px] pb-4 pt-5">
                <div className="flex flex-col gap-[3px]"><span className="text-base font-semibold">{selected.name}</span><span className="text-xs text-[#6b6b76]">{D.label} desk · {selected.site} · {rangeLabel}</span></div>
                <button onClick={() => setDrawer(null)} className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-[#e0dfdb] bg-white text-[#55555e]" aria-label="Close"><X className="h-3.5 w-3.5" /></button>
              </div>
              <div className="flex flex-1 flex-col gap-[18px] overflow-auto px-[22px] py-[18px]">
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    ["Resolved", selected.resolved, ""],
                    ["Per workday", selected.perDay.toFixed(1), ""],
                    ["Avg resolution", hrs(selected.res), selected.res != null && selected.res >= 4 ? "text-[#b42318]" : ""],
                    ["Overdue owned", selected.overdue, selected.overdue ? "text-[#b42318]" : ""],
                  ].map(([l, v, c]) => (
                    <div key={l} className="flex flex-col gap-1 rounded-[10px] border border-[#efeeea] p-3"><span className="text-[11.5px] text-[#6b6b76]">{l}</span><span className={`text-xl font-semibold ${c}`}>{v}</span></div>
                  ))}
                </div>
                <div className="flex flex-col gap-2.5">
                  <span className="font-semibold">Resolved per day</span>
                  <div className="grid h-[110px] items-end gap-2 border-b border-[#e8e7e3]" style={{ gridTemplateColumns: `repeat(${selected.spark.length},minmax(0,1fr))` }}>
                    {selected.spark.map((v, i) => (
                      <div key={i} className="flex h-full flex-col items-center justify-end gap-1"><span className="text-[11px] text-[#55555e]">{v}</span><div className="w-[60%] rounded-t" style={{ height: Math.max(2, Math.round((v / mx) * 80)), background: D.color }} /></div>
                    ))}
                  </div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${selected.spark.length},minmax(0,1fr))` }}>
                    {selected.sparkDays.map((k) => <span key={k} className="text-center text-[11px] text-[#6b6b76]">{new Date(`${k}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" })}</span>)}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="font-semibold">Category mix</span>
                  {selected.cats.map(([n, c]) => (
                    <div key={n} className="grid items-center gap-2.5" style={{ gridTemplateColumns: "minmax(0,1fr) 90px 24px" }}><span className="text-[#3b3b44]">{n}</span><div className="h-1.5 overflow-hidden rounded-[3px] bg-[#f1f0ec]"><div className="h-full" style={{ width: `${Math.round((c / cmx) * 100)}%`, background: D.color }} /></div><span className="text-right font-semibold">{c}</span></div>
                  ))}
                  {!selected.cats.length && <span className="text-[#8a8a93]">No tickets closed in this range.</span>}
                </div>
                <div className="flex flex-col gap-1.5 rounded-[10px] border border-[#efeeea] p-3">
                  <span className="text-[11.5px] text-[#6b6b76]">Latest ticket</span>
                  {selected.latest ? (
                    <button onClick={() => onOpenTicket?.(selected.latest.id)} className="text-left"><span className="font-mono text-xs text-[#b3177f]">{selected.latest.human_id}</span> · {selected.latest.title}</button>
                  ) : <span>No tickets assigned</span>}
                </div>
                {selected.overdueTickets.length > 0 && (
                  <div className="flex flex-col gap-1.5 rounded-[10px] border border-[#f1d3d0] p-3">
                    <span className="text-[11.5px] text-[#b42318]">Overdue tickets owned</span>
                    {selected.overdueTickets.slice(0, 5).map((t) => (
                      <button key={t.id} onClick={() => onOpenTicket?.(t.id)} className="truncate text-left"><span className="font-mono text-xs text-[#6b6b76]">{t.human_id}</span> · {t.title}</button>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-1.5 rounded-[10px] border border-[#efeeea] p-3">
                  <span className="text-[11.5px] text-[#6b6b76]">Checklist</span>
                  <span>{selected.kra === "na" ? "Not enrolled in daily checklist" : `${selected.kra === "yes" ? "Submitted today" : "Not submitted today"} · ${selected.kraDays} day${selected.kraDays === 1 ? "" : "s"} submitted in range`}</span>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-[#efeeea] px-[22px] py-3.5">
                <button onClick={() => { setDrawer(null); onOpenReport(selected.member, selected.desk); }} className="rounded-lg bg-[#17171c] px-3.5 py-2 text-[12.5px] text-white">Full report</button>
              </div>
            </aside>
          </>
        );
      })()}
    </div>
  );
}

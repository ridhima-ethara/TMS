"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/appapi";
import { Skeleton } from "@/components/ui/skeleton";
import { RaiseTicket } from "@/components/app/TicketsView";
import { toast } from "sonner";

const DONE = ["Resolved", "Closed", "Cancelled"];
const RECENT = 31;
const TYPE = {
  F: ["Failure", "bg-[#fdeaea] text-[#b42318]"],
  S: ["Service request", "bg-[#f1f0ec] text-[#55555e]"],
  N: ["Software / not HW", "bg-[#fdf3dc] text-[#8a5a00]"],
};
const TICKET_COLS = "150px minmax(200px,2fr) 120px minmax(130px,1fr) 110px 70px";
const seg = (on) => (on ? "bg-white text-[#17171c]" : "bg-transparent text-[#6b6b76]");
const n = (value) => Number(value || 0).toLocaleString("en-IN");

// Only hardware failures count against a supplier; allocations, returns and
// inventory work are normal IT service, and the rest is mis-tagged.
function classify(category = "") {
  const c = category.toLowerCase();
  if (/procurement|allocation|inventory|return|configuration|transfer|receipt|offboarding|onboarding/.test(c)) return "S";
  if (/laptop|charger|hardware|keyboard|screen|battery|display|repair/.test(c)) return "F";
  return "N";
}
// The asset register spells brands many ways ("LENOVO", "MAC Book Pro M1"…).
function brandOf(raw = "") {
  const b = raw.toLowerCase();
  if (!b.trim()) return null;
  if (/\bhp\b|hewlett/.test(b)) return "HP";
  if (/lenovo|thinkpad/.test(b)) return "Lenovo";
  if (/dell/.test(b)) return "Dell";
  if (/mac|apple|\bm[1-4]\b/.test(b)) return "Apple";
  if (/asus/.test(b)) return "Asus";
  if (/acer/.test(b)) return "Acer";
  return raw.trim();
}
const hoursLabel = (hours) =>
  hours == null ? "—" : hours < 24 ? `${Math.round(hours * 10) / 10}h` : `${Math.round((hours / 24) * 10) / 10}d`;
const dm = (value) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function downloadPack(rows, vendors) {
  const cell = (value) => {
    const text = String(value ?? "");
    return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
  };
  const lines = [
    ["Vendor review pack", new Date().toLocaleString("en-GB")],
    [],
    ["Vendor", "Laptops", "Hardware failures", "Failures per 100", "Service requests", "Not laptop-related", "Charger replacements", "Chargers per 100", "Avg resolution", "Open", "Past SLA"],
    ...vendors.map((v) => [v.name, v.fleet, v.f, v.rate.toFixed(1), v.s, v.n, v.charger, v.chargerRate.toFixed(1), hoursLabel(v.avgHours), v.open, v.pastSla]),
    [],
    ["Ticket", "Title", "Category", "Counts as", "Vendor", "Brand", "Serial", "Laptop user", "Status", "Raised"],
    ...rows.map((t) => [t.human_id, t.title, t.category, TYPE[t.type][0], t.vendor || "Unknown serial", t.brandName || "", t.serial, t.user, t.status, new Date(t.created_at).toLocaleString("en-GB")]),
  ];
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["﻿" + lines.map((line) => line.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  link.download = `vendor-review-pack-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function VendorAnalysis({ user, onOpenTicket }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [type, setType] = useState("all");
  const [serial, setSerial] = useState(null);

  const load = () =>
    api("/reports/vendor-analysis")
      .then(setData)
      .catch((error) => toast.error(error.message));
  useEffect(() => {
    load();
  }, []);

  const model = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const tickets = (data.laptop_tickets || []).map((t) => ({ ...t, type: classify(t.category), brandName: brandOf(t.brand) }));
    const vendors = (data.vendors || [])
      .filter((v) => v.fleet_size > 0 && v.vendor !== "Unknown")
      .map((v) => {
        const mine = tickets.filter((t) => t.vendor === v.vendor);
        const f = mine.filter((t) => t.type === "F");
        const catCount = (list) =>
          Object.entries(list.reduce((map, t) => ({ ...map, [t.category || "Other"]: (map[t.category || "Other"] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
        const brandFleet = {};
        const brandRaw = {};
        Object.entries(v.brands || {}).forEach(([raw, count]) => {
          const name = brandOf(raw) || "Unspecified";
          brandFleet[name] = (brandFleet[name] || 0) + count;
          (brandRaw[name] = brandRaw[name] || []).push(raw);
        });
        const brandFail = {};
        const brandCharger = {};
        f.forEach((t) => {
          const name = t.brandName || "Unspecified";
          brandFail[name] = (brandFail[name] || 0) + 1;
          if (/charger/i.test(t.category)) brandCharger[name] = (brandCharger[name] || 0) + 1;
        });
        const brands = Object.entries(brandFleet)
          .map(([name, fleet]) => ({ name, fleet, fails: brandFail[name] || 0, chargers: brandCharger[name] || 0, raw: brandRaw[name], rate: ((brandFail[name] || 0) / fleet) * 100 }))
          .sort((a, b) => b.rate - a.rate);
        const resolved = mine.filter((t) => t.resolved_at && t.created_at).map((t) => (new Date(t.resolved_at) - new Date(t.created_at)) / 3600000);
        const open = mine.filter((t) => !DONE.includes(t.status));
        const charger = f.filter((t) => /charger/i.test(t.category)).length;
        return {
          key: v.vendor,
          name: v.vendor,
          fleet: v.fleet_size,
          tickets: mine,
          f: f.length,
          s: mine.filter((t) => t.type === "S").length,
          n: mine.filter((t) => t.type === "N").length,
          rate: (f.length / v.fleet_size) * 100,
          charger,
          chargerRate: (charger / v.fleet_size) * 100,
          avgHours: resolved.length ? resolved.reduce((a, b) => a + b, 0) / resolved.length : null,
          open: open.length,
          pastSla: open.filter((t) => t.sla_resolution_due && new Date(t.sla_resolution_due).getTime() < now).length,
          cats: { F: catCount(f), S: catCount(mine.filter((t) => t.type === "S")), N: catCount(mine.filter((t) => t.type === "N")) },
          brands,
          rawCount: Object.keys(v.brands || {}).length,
        };
      })
      .sort((a, b) => b.rate - a.rate);
    const worst = vendors[0];
    const best = vendors.length > 1 ? vendors[vendors.length - 1] : null;
    const recent = [...tickets].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, RECENT);
    const bySerial = {};
    recent.forEach((t) => (bySerial[t.serial] = bySerial[t.serial] || []).push(t));
    const shared = Object.entries(bySerial)
      .map(([s, list]) => ({ serial: s, list, users: [...new Set(list.map((t) => t.user).filter(Boolean))] }))
      .filter((x) => x.users.length >= 3)
      .sort((a, b) => b.list.length - a.list.length);
    return { tickets, vendors, worst, best, recent, shared };
  }, [data]);

  if (!model) return <Skeleton className="h-[720px] w-full rounded-xl" />;
  const { vendors, worst, best, tickets, shared, recent } = model;
  const cur = vendors.find((v) => v.key === selected) || worst;
  const matched = tickets.filter((t) => t.vendor).length;
  const unknown = tickets.length - matched;
  const failures = vendors.reduce((a, v) => a + v.f, 0);
  const chargers = vendors.reduce((a, v) => a + v.charger, 0);
  const chargerLead = [...vendors].sort((a, b) => b.charger - a.charger)[0];
  const sharedSet = new Set(shared.map((x) => x.serial));
  const sharedTickets = shared.reduce((a, x) => a + x.list.length, 0);
  const userCounts = shared.map((x) => x.users.length);

  const groups = cur
    ? [
        ["F", "Hardware failures", "#d4553a", cur.f ? `Counts against the vendor.${cur.charger ? ` Chargers alone are ${Math.round((cur.charger / cur.f) * 100)}% of failures.` : ""}` : "No hardware failures logged."],
        ["S", "Service & lifecycle", "#9a9894", "Normal IT work — allocations, returns, inventory. Not a vendor fault."],
        ["N", "Not laptop-related", "#d1a441", cur.n ? "Mis-tagged to a laptop serial. Exclude from vendor stats." : "None — clean tagging."],
      ].map(([key, label, color, note]) => {
        const rows = cur.cats[key];
        const mx = Math.max(1, ...rows.map((r) => r[1]));
        return { key, label, color, note, total: rows.reduce((a, r) => a + r[1], 0), rows: rows.map(([name, c]) => ({ name, c, pct: Math.round((c / mx) * 100) })) };
      })
    : [];
  const bmax = cur ? Math.max(1, ...cur.brands.map((b) => b.rate)) : 1;
  let brandNote = "";
  if (cur?.brands.length) {
    const top = cur.brands[0];
    const low = cur.brands[cur.brands.length - 1];
    if (cur === best && worst && worst !== cur)
      brandNote = `${cur.name} brands sit near ${cur.rate.toFixed(1)} failures per 100 — use ${cur.name} as the benchmark when renewing the ${worst.name} contract.`;
    else if (top.rate > 100)
      brandNote = `${top.name} shows ${top.fails} failures on ${top.fleet} units — more failures than laptops, because a few reused serials are logged against it. Fix serial capture before judging this brand; ${cur.brands.filter((b) => b.rate <= 100 && b.fails).map((b) => `${b.name} ${b.rate.toFixed(1)}`).join(", ") || "other brands"} per 100 are reliable.`;
    else if (top.fails)
      brandNote = `${top.name} units fail most (${top.rate.toFixed(1)} per 100)${top.chargers / Math.max(1, top.fails) >= 0.25 ? ", driven by chargers" : ""}.${low !== top ? ` ${low.name} fails at ${low.rate ? `${(low.rate / top.rate < 0.5 ? "less than half" : `${Math.round((low.rate / top.rate) * 100)}% of`)} that rate` : "almost never"}.` : ""}${top.chargers >= 5 ? ` Raise a bulk charger warranty claim for ${top.name} first.` : ""}`;
    else brandNote = "No hardware failures logged against these brands.";
  }

  const list = (serial ? tickets.filter((t) => t.serial === serial) : cur ? cur.tickets : [])
    .filter((t) => type === "all" || t.type === type)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, serial ? 100 : 40);
  const listDates = list.length ? `${dm(list[list.length - 1].created_at)} – ${dm(list[0].created_at)}` : "";
  const scrollToSerials = () => {
    const el = document.getElementById("vendor-serials");
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
  };

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4 text-[13px] text-[#17171c]">
      <header className="flex flex-wrap items-end justify-between gap-3.5">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[22px] font-semibold tracking-[-.01em]">Laptop vendor analysis</h2>
          <div className="text-[#6b6b76]">Which supplier&apos;s laptops break, how often, and what to raise with them</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { downloadPack(tickets, vendors); toast.success("Vendor review pack exported"); }} className="rounded-[9px] border border-[#e0dfdb] bg-white px-3 py-2 text-[12.5px] text-[#17171c]">Export vendor review pack</button>
          {user && (
            <RaiseTicket user={user} onCreated={load} trigger={<button className="rounded-[9px] bg-[#17171c] px-3.5 py-2 text-[12.5px] font-medium text-white">Raise warranty claim</button>} />
          )}
        </div>
      </header>

      <section className="grid overflow-hidden rounded-xl border border-[#e8e7e3] bg-white" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <div className="flex flex-col gap-[5px] border-r border-[#efeeea] px-[18px] py-3.5"><span className="text-xs text-[#6b6b76]">Laptops tracked</span><span className="text-[22px] font-semibold tracking-[-.02em]">{n(data.totals?.fleet_size)}</span><span className="text-[11.5px] text-[#6b6b76]">{vendors.map((v) => `${v.name} ${n(v.fleet)}`).join(" · ")}</span></div>
        <div className="flex flex-col gap-[5px] border-r border-[#efeeea] px-[18px] py-3.5"><span className="text-xs text-[#6b6b76]">Laptop tickets</span><span className="text-[22px] font-semibold tracking-[-.02em]">{n(tickets.length)}</span><span className="text-[11.5px] text-[#6b6b76]">{n(matched)} matched{unknown ? <> · <span className="text-[#b42318]">{n(unknown)} unknown serial ({Math.round((unknown / Math.max(1, tickets.length)) * 100)}%)</span></> : ""}</span></div>
        <div className="flex flex-col gap-[5px] border-r border-[#efeeea] px-[18px] py-3.5"><span className="text-xs text-[#6b6b76]">Real hardware failures</span><span className="text-[22px] font-semibold tracking-[-.02em]">{n(failures)}</span><span className="text-[11.5px] text-[#6b6b76]">excludes allocations, transfers, returns</span></div>
        <div className="flex flex-col gap-[5px] border-r border-[#efeeea] px-[18px] py-3.5"><span className="text-xs text-[#6b6b76]">Failures per 100 laptops</span>
          <span className="text-[22px] font-semibold tracking-[-.02em]">
            {worst ? <span className="text-[#b42318]">{worst.rate.toFixed(1)}</span> : "—"}
            {best && <> <span className="text-sm font-medium text-[#8a8a93]">vs</span> <span className="text-[#12795a]">{best.rate.toFixed(1)}</span></>}
          </span>
          <span className="text-[11.5px] text-[#6b6b76]">{best && worst ? `${worst.name} vs ${best.name}${best.rate ? ` · ${(worst.rate / best.rate).toFixed(1)}× gap` : ""}` : worst?.name || ""}</span>
        </div>
        <div className="flex flex-col gap-[5px] px-[18px] py-3.5"><span className="text-xs text-[#6b6b76]">Charger replacements</span><span className="text-[22px] font-semibold tracking-[-.02em]">{n(chargers)}</span><span className="text-[11.5px] text-[#6b6b76]">{chargerLead?.charger ? `${chargerLead.charger} ${chargerLead.name} — 1 in ${Math.round(chargerLead.fleet / chargerLead.charger)} of their units` : "none logged"}</span></div>
      </section>

      {shared.length > 0 && (
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 rounded-xl border border-[#f1d3d0] bg-white px-4 py-3.5">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-[#b42318]" />
            <span className="leading-normal text-[#3b3b44]"><strong className="font-semibold text-[#17171c]">Serial numbers are being reused, so per-device numbers can&apos;t be trusted yet.</strong> {shared.length} serial{shared.length === 1 ? "" : "s"} account for {sharedTickets} of the last {recent.length} tickets, each logged against {Math.min(...userCounts)}{Math.max(...userCounts) !== Math.min(...userCounts) ? `–${Math.max(...userCounts)}` : ""} different people. Pick the serial from the asset register when raising a ticket instead of typing it.</span>
          </div>
          <button onClick={scrollToSerials} className="shrink-0 whitespace-nowrap rounded-lg border border-[#e0dfdb] bg-white px-3 py-[7px] text-[12.5px]">See serials</button>
        </div>
      )}

      {/* 1, 2 or (on very wide screens) 3/4 columns so cards never leave one stranded. */}
      <section className={`grid grid-cols-1 gap-3 lg:grid-cols-2 ${vendors.length % 3 === 0 ? "min-[1800px]:grid-cols-3" : vendors.length % 4 === 0 ? "min-[1800px]:grid-cols-4" : ""}`}>
        {vendors.map((v) => {
          const isWorst = best && v === worst;
          const isBest = best && v === best;
          const tot = Math.max(1, v.f + v.s + v.n);
          return (
            <button key={v.key} onClick={() => { setSelected(v.key); setSerial(null); }} className={`flex flex-col gap-3.5 rounded-[14px] bg-white p-[18px] text-left text-[#17171c] ${cur === v ? "border-2 border-[#b3177f]" : "border border-[#e8e7e3]"}`}>
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex flex-col gap-[3px]"><span className="text-base font-semibold">{v.name}</span><span className="text-xs text-[#6b6b76]">{n(v.fleet)} laptops · {v.brands.map((b) => b.name).join(", ")}</span></div>
                {(isWorst || isBest) && <span className={`rounded-full px-[9px] py-[3px] text-[11.5px] font-medium ${isWorst ? "bg-[#fdeaea] text-[#b42318]" : "bg-[#e4f3ec] text-[#12795a]"}`}>{isWorst ? (best.rate ? `${(worst.rate / best.rate).toFixed(1)}× more failures` : "Most failures") : "Benchmark"}</span>}
              </div>
              <div className="flex items-baseline gap-2"><span className={`text-[34px] font-semibold tracking-[-.02em] ${isWorst ? "text-[#b42318]" : "text-[#12795a]"}`}>{v.rate.toFixed(1)}</span><span className="text-[#6b6b76]">hardware failures per 100 laptops</span></div>
              <div className="flex flex-col gap-1.5">
                <div className="flex h-2.5 overflow-hidden rounded-[5px] bg-[#f1f0ec]"><div className="bg-[#d4553a]" style={{ width: `${(v.f / tot) * 100}%` }} /><div className="bg-[#b9b7b0]" style={{ width: `${(v.s / tot) * 100}%` }} /><div className="bg-[#e0c68a]" style={{ width: `${(v.n / tot) * 100}%` }} /></div>
                <div className="flex flex-wrap gap-3.5 text-[11.5px] text-[#55555e]">
                  <span className="flex items-center gap-[5px]"><span className="h-2 w-2 rounded-sm bg-[#d4553a]" />{v.f} failures</span>
                  <span className="flex items-center gap-[5px]"><span className="h-2 w-2 rounded-sm bg-[#b9b7b0]" />{v.s} service requests</span>
                  <span className="flex items-center gap-[5px]"><span className="h-2 w-2 rounded-sm bg-[#e0c68a]" />{v.n} not laptop-related</span>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2.5 border-t border-[#f1f0ec] pt-3">
                <div className="flex flex-col gap-0.5"><span className="text-[11px] text-[#6b6b76]">All tickets</span><span className="font-semibold">{v.tickets.length}</span></div>
                <div className="flex flex-col gap-0.5"><span className="text-[11px] text-[#6b6b76]">Chargers /100</span><span className="font-semibold">{v.chargerRate.toFixed(1)}</span></div>
                <div className="flex flex-col gap-0.5"><span className="text-[11px] text-[#6b6b76]">Avg resolution</span><span className="font-semibold">{hoursLabel(v.avgHours)}</span></div>
                <div className="flex flex-col gap-0.5"><span className="text-[11px] text-[#6b6b76]">Open</span><span className={`font-semibold ${v.pastSla ? "text-[#b42318]" : ""}`}>{v.pastSla ? `${v.open} · ${v.pastSla} past SLA` : v.open}</span></div>
              </div>
            </button>
          );
        })}
        {!vendors.length && <div className="rounded-xl border border-[#e8e7e3] bg-white p-7 text-center text-[#6b6b76]">No vendor fleet data yet.</div>}
      </section>

      {cur && (
        <section className="flex flex-col gap-3.5 rounded-xl border border-[#e8e7e3] bg-white p-[18px]">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">What {cur.name} tickets actually are</h3><span className="text-xs text-[#6b6b76]">Only failures count against a supplier; service work and mis-tagged tickets are separated out.</span></div>
          <div className="grid gap-[18px]" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))" }}>
            {groups.map((g) => (
              <div key={g.key} className="flex flex-col gap-[9px]">
                <div className="flex items-baseline justify-between pb-1.5" style={{ borderBottom: `2px solid ${g.color}` }}><span className="font-semibold">{g.label}</span><span className="font-semibold tabular-nums">{g.total}</span></div>
                <span className="text-[11.5px] leading-snug text-[#6b6b76]">{g.note}</span>
                {g.rows.map((r) => (
                  <div key={r.name} className="grid items-center gap-2.5" style={{ gridTemplateColumns: "minmax(0,1fr) 80px 30px" }}>
                    <span className="truncate text-[#3b3b44]">{r.name}</span>
                    <div className="h-1.5 overflow-hidden rounded-[3px] bg-[#f1f0ec]"><div className="h-full rounded-[3px]" style={{ width: `${r.pct}%`, background: g.color }} /></div>
                    <span className="text-right font-semibold tabular-nums">{r.c}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,440px),1fr))" }}>
        {cur && (
          <div className="flex flex-col gap-3 rounded-xl border border-[#e8e7e3] bg-white p-[18px]">
            <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Failure rate by brand · {cur.name}</h3><span className="text-xs text-[#6b6b76]">Brand names merged — the asset register lists {cur.rawCount} spelling{cur.rawCount === 1 ? "" : "s"} for {cur.brands.length} brand{cur.brands.length === 1 ? "" : "s"}</span></div>
            <div className="flex flex-col">
              {cur.brands.map((b) => {
                const color = b.rate > 30 ? "#b42318" : b.rate > 10 ? "#c8871b" : "#12795a";
                return (
                  <div key={b.name} className="grid items-center gap-3 border-b border-[#f1f0ec] py-[11px]" style={{ gridTemplateColumns: "minmax(0,1.2fr) 70px minmax(0,1.4fr) 54px" }}>
                    <div className="flex min-w-0 flex-col gap-[3px]"><span className="font-semibold">{b.name}</span><span className="truncate text-[11px] text-[#8a8a93]">{b.raw.length > 1 ? `merged: ${b.raw.join(" · ")}` : b.raw[0]}</span></div>
                    <span className="text-right text-xs tabular-nums text-[#55555e]">{n(b.fleet)} units</span>
                    <div className="h-2 overflow-hidden rounded bg-[#f1f0ec]"><div className="h-full rounded" style={{ width: `${Math.round((b.rate / bmax) * 100)}%`, background: color }} /></div>
                    <span className="text-right font-semibold tabular-nums" style={{ color }}>{b.rate.toFixed(1)}</span>
                  </div>
                );
              })}
            </div>
            {brandNote && <div className="rounded-lg bg-[#f7f6f3] px-3 py-2.5 text-[12.5px] leading-normal text-[#3b3b44]">{brandNote}</div>}
          </div>
        )}

        <div id="vendor-serials" className="flex flex-col gap-3 rounded-xl border border-[#e8e7e3] bg-white p-[18px]">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Serials used by several people</h3><span className="text-xs text-[#6b6b76]">Last {recent.length} laptop tickets · one laptop shouldn&apos;t have many different users in a few days. Click to filter.</span></div>
          <div className="flex flex-col">
            {shared.map((x) => (
              <button key={x.serial} onClick={() => setSerial(serial === x.serial ? null : x.serial)} className={`grid items-center gap-3 rounded-md border-b border-[#f1f0ec] px-2 py-2.5 text-left ${serial === x.serial ? "bg-[#fdf5fa]" : ""}`} style={{ gridTemplateColumns: "120px 64px minmax(0,1fr)" }}>
                <span className="font-mono text-xs font-medium">{x.serial}</span>
                <span className="tabular-nums"><strong className="font-semibold">{x.list.length}</strong> <span className="text-[11.5px] text-[#8a8a93]">tickets</span></span>
                <div className="flex min-w-0 flex-col gap-0.5"><span className="text-xs font-medium text-[#b42318]">{x.users.length} different users</span><span className="truncate text-[11.5px] text-[#6b6b76]">{x.users.join(", ")}</span></div>
              </button>
            ))}
            {!shared.length && <span className="py-3 font-medium text-[#12795a]">No serial is shared by 3+ people in the last {recent.length} tickets.</span>}
          </div>
          {shared.length > 0 && <span className="text-xs leading-normal text-[#55555e]">A serial that appears on unrelated tickets for many people is usually a placeholder or a copied value — its per-device history is unreliable.</span>}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[#e8e7e3] bg-white">
        <div className="flex flex-wrap items-start justify-between gap-2.5 px-[18px] pb-3 pt-4">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Recent laptop tickets · {list.length}</h3><span className="text-xs text-[#6b6b76]">{serial ? `Serial ${serial}` : `${cur?.name || ""}${listDates ? ` · ${listDates}` : ""}`}</span></div>
          <div className="flex flex-wrap items-center gap-2">
            {serial && <button onClick={() => setSerial(null)} className="rounded-full bg-[#fbe9f4] px-2.5 py-[5px] text-xs font-medium text-[#8a0f61]">{serial} ✕</button>}
            <div className="flex gap-0.5 rounded-[9px] bg-[#efeeea] p-[3px]">
              {[["all", "All"], ["F", "Failures"], ["S", "Service"], ["N", "Not HW"]].map(([k, l]) => <button key={k} onClick={() => setType(k)} className={`rounded-[7px] px-2.5 py-[5px] text-xs font-medium ${seg(type === k)}`}>{l}</button>)}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto"><div className="min-w-[860px]">
          <div className="grid gap-3 border-y border-[#efeeea] bg-[#f7f6f3] px-[18px] py-[9px] text-[11.5px] text-[#6b6b76]" style={{ gridTemplateColumns: TICKET_COLS }}>
            <span>Ticket</span><span>Issue</span><span>Serial</span><span>Laptop user</span><span>Counts as</span><span>Date</span>
          </div>
          {list.map((t) => (
            <div key={t.id} onClick={() => onOpenTicket?.(t.id)} className="grid cursor-pointer items-center gap-3 border-b border-[#f1f0ec] px-[18px] py-[9px] hover:bg-[#fbfaf8]" style={{ gridTemplateColumns: TICKET_COLS }}>
              <span className="font-mono text-[11.5px] text-[#55555e]">{t.human_id}</span>
              <span className="truncate font-medium">{t.title}</span>
              <span className="flex items-center gap-1.5"><span className="font-mono text-[11.5px]">{t.serial}</span>{sharedSet.has(t.serial) && <span title="Serial used by several people" className="h-1.5 w-1.5 rounded-full bg-[#b42318]" />}</span>
              <span className="truncate text-[#3b3b44]">{t.user || "—"}</span>
              <span><span className={`whitespace-nowrap rounded-[5px] px-2 py-[3px] text-[11px] font-medium ${TYPE[t.type][1]}`}>{TYPE[t.type][0]}</span></span>
              <span className="text-xs text-[#6b6b76]">{dm(t.created_at)}</span>
            </div>
          ))}
          {!list.length && <div className="p-7 text-center text-[#6b6b76]">No laptop tickets match.</div>}
        </div></div>
      </section>
    </div>
  );
}

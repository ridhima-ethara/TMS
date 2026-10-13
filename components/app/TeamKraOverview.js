"use client";

import { useEffect, useMemo, useState } from "react";
import { api, fetchAllTickets } from "@/lib/appapi";
import { Skeleton } from "@/components/ui/skeleton";
import { X } from "lucide-react";
import { toast } from "sonner";
import DateRangeMenu from "@/components/app/DateRangeMenu";
import { compareText } from "@/lib/sort";

const DESK = {
  it: { label: "IT", color: "#2f6bd0", soft: "#e8f0fc" },
  admin: { label: "Admin", color: "#12795a", soft: "#e4f3ec" },
};
const WORKDAYS = 8;
// "Reports reliably" = checklist submitted on at least half the workdays; "active on tickets" = 5+ closed in 7 days.
const REPORTS_OK = 0.5;
const BUSY_TICKETS = 5;
const VERDICT = {
  noreport: { label: "Working, not reporting", hint: "Closes tickets but skips checklist", cls: "bg-[#fdeaea] text-[#b42318]", dot: "#b42318" },
  neither: { label: "Low on both", hint: "Few tickets and rarely reports", cls: "bg-[#f1f0ec] text-[#55555e]", dot: "#8a8a93" },
  lowwork: { label: "Reporting, few tickets", hint: "Fills checklist, closes few tickets", cls: "bg-[#fdf3dc] text-[#8a5a00]", dot: "#d9a13a" },
  good: { label: "On track", hint: "Closes tickets and reports", cls: "bg-[#e4f3ec] text-[#12795a]", dot: "#12795a" },
};
const VERDICT_ORDER = ["noreport", "neither", "lowwork", "good"];
const DONE = ["Resolved", "Closed"];
const TZ = "Asia/Kolkata";
const istKey = (value = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const noonIst = (key) => new Date(`${key}T12:00:00+05:30`);
const weekday = (key) => noonIst(key).toLocaleDateString("en-GB", { weekday: "short", timeZone: TZ });
const dayNum = (key) => Number(key.slice(8, 10));
const clock = (value) => new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const initials = (name = "") => name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
const first = (name = "") => name.split(" ")[0];
const pctColor = (p) => (p >= 90 ? "#12795a" : p >= 50 ? "#d9a13a" : "#d4553a");
const seg = (on) => (on ? "bg-white text-[#17171c] shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "bg-transparent text-[#6b6b76]");
const words = (label) => new Set(String(label).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2));
const similar = (a, b) => {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return false;
  let shared = 0;
  x.forEach((w) => { if (y.has(w)) shared += 1; });
  return shared / Math.min(x.size, y.size) >= 0.8;
};

/** The last N Mon–Fri IST day keys, oldest first, ending today (or the last workday). */
function lastWorkdays(count) {
  const keys = [];
  const cursor = noonIst(istKey());
  while (keys.length < count) {
    const key = istKey(cursor);
    const w = noonIst(key).getUTCDay();
    if (w !== 0 && w !== 6) keys.unshift(key);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return keys;
}

/** Mon–Fri IST day keys from `from` to `to` inclusive, oldest first. */
function workdaysBetween(from, to) {
  const keys = [];
  for (let cursor = noonIst(from); istKey(cursor) <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const key = istKey(cursor);
    const w = noonIst(key).getUTCDay();
    if (w !== 0 && w !== 6) keys.push(key);
  }
  return keys;
}
const shiftKey = (key, days) => {
  const d = noonIst(key);
  d.setUTCDate(d.getUTCDate() + days);
  return istKey(d);
};
const shortDate = (key) => `${dayNum(key)} ${noonIst(key).toLocaleDateString("en-GB", { month: "short", timeZone: TZ })}`;
const MAX_RANGE_DAYS = 92;

export default function TeamKraOverview({ onEdit }) {
  const [data, setData] = useState(null);
  const [desk, setDesk] = useState("all");
  const [open, setOpen] = useState(null);
  const [reminded, setReminded] = useState({});
  const [now, setNow] = useState(() => Date.now());
  const today = istKey();
  const [range, setRange] = useState(() => ({ preset: "8wd", from: lastWorkdays(WORKDAYS)[0], to: istKey() }));
  const days = useMemo(() => workdaysBetween(range.from, range.to), [range.from, range.to]);
  const rangeDays = days.length;
  // Ticket work scales with the range: 5 closed per 5 workdays counts as busy.
  const busyTickets = Math.max(1, Math.round((BUSY_TICKETS * Math.max(rangeDays, 1)) / 5));
  const [boardDay, setBoardDay] = useState(() => istKey());
  const applyPreset = (preset) => {
    const month = today.slice(0, 7);
    if (preset === "8wd") return setRange({ preset, from: lastWorkdays(WORKDAYS)[0], to: today });
    if (preset === "30d") return setRange({ preset, from: shiftKey(today, -29), to: today });
    if (preset === "month") return setRange({ preset, from: `${month}-01`, to: today });
    if (preset === "lastmonth") {
      const lastEnd = shiftKey(`${month}-01`, -1);
      return setRange({ preset, from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd });
    }
  };
  const setCustom = (key, value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    setRange((current) => {
      let next = { ...current, preset: "custom", [key]: value > today ? today : value };
      if (next.from > next.to) next = key === "from" ? { ...next, to: next.from } : { ...next, from: next.to };
      if ((noonIst(next.to) - noonIst(next.from)) / 86400000 > MAX_RANGE_DAYS) {
        toast.error(`Choose a range of ${MAX_RANGE_DAYS} days or less`);
        return current;
      }
      return next;
    });
  };
  const [verdictFilter, setVerdictFilter] = useState("all");

  useEffect(() => {
    const load = () =>
      Promise.all([
        api("/users"),
        api("/member-checklists"),
        api(`/member-checklist-submissions?from=${range.from}&to=${range.to}&limit=5000`),
        fetchAllTickets("department=IT"),
        fetchAllTickets("department=Admin"),
      ])
        .then(([users, lists, submissions, it, admin]) => {
          setData({ users, lists, submissions: Array.isArray(submissions) ? submissions : [], tickets: [...it.items, ...admin.items] });
          setNow(Date.now());
        })
        .catch((error) => toast.error(error.message));
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [range.from, range.to]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const model = useMemo(() => {
    if (!data) return null;
    const rangeStart = noonIst(range.from).getTime() - 12 * 3600000;
    const rangeEnd = noonIst(range.to).getTime() + 12 * 3600000;
    const closedBy = {};
    data.tickets.forEach((t) => {
      const at = t.resolved_at || t.resolution?.resolved_date || t.closed_at;
      if (DONE.includes(t.status) && t.assignee_id && at && new Date(at).getTime() >= rangeStart && new Date(at).getTime() < rangeEnd)
        closedBy[t.assignee_id] = (closedBy[t.assignee_id] || 0) + 1;
    });
    const openTickets = data.tickets.filter((t) => !DONE.includes(t.status) && t.status !== "Cancelled");
    const lists = data.lists.filter((l) => l.active !== false);
    const byMember = new Map();
    lists.forEach((l) => {
      const m = byMember.get(l.member_id) || { id: l.member_id, name: l.member_name, desk: l.member_role === "admin" ? "admin" : "it", lists: [], items: [] };
      m.lists.push(l);
      (l.items || []).forEach((item) => m.items.push({ ...item, listId: l.id }));
      byMember.set(l.member_id, m);
    });
    const members = [...byMember.values()].map((m) => {
      const subs = data.submissions.filter((s) => s.member_id === m.id);
      const perDay = {};
      subs.forEach((s) => {
        const d = perDay[s.date] || { done: 0, total: 0, late: false, at: null, statuses: [] };
        d.done += Number(s.done_count || 0);
        d.total += Number(s.total || 0);
        d.late = d.late || Boolean(s.late);
        d.at = s.submitted_at || s.created_at || d.at;
        d.statuses.push(s.status);
        perDay[s.date] = d;
      });
      const N = m.items.length;
      // Expected check-ins only count from the day the checklist existed.
      const createdKey = istKey(Math.min(...m.lists.map((l) => new Date(l.created_at || 0).getTime())));
      const expected = days.filter((k) => k >= createdKey).length;
      const submittedDays = days.filter((k) => perDay[k]);
      const avg = submittedDays.length
        ? Math.round((submittedDays.reduce((a, k) => a + (perDay[k].total ? perDay[k].done / perDay[k].total : 0), 0) / submittedDays.length) * 100)
        : null;
      // Skip counts per item key, only on days that were submitted.
      const skips = {};
      subs.filter((s) => days.includes(s.date)).forEach((s) => {
        (s.responses || []).forEach((r) => {
          const key = `${s.checklist_id}:${r.key}`;
          skips[key] = skips[key] || { item: r.item, skipped: 0, seen: 0 };
          skips[key].seen += 1;
          if (!r.done) skips[key].skipped += 1;
        });
      });
      // Full submission per day (responses incl. extras) for the daily checklist board.
      const subsByDay = {};
      subs.forEach((s) => { (subsByDay[s.date] = subsByDay[s.date] || []).push(s); });
      const todaySubs = subs.filter((s) => s.date === today);
      const todayDone = new Map();
      todaySubs.forEach((s) => (s.responses || []).forEach((r) => todayDone.set(`${s.checklist_id}:${r.key}`, r)));
      const dupOf = {};
      m.items.forEach((item, i) => {
        for (let j = 0; j < i; j++) if (similar(item.label, m.items[j].label)) { dupOf[i] = j; break; }
      });
      // "Vague" = short items built on generic terms that can't be verified
      // ("End user support", "Daily IT operations").
      const GENERIC = /\b(support|operations?|management|security|inventory|network(ing)?)\b/i;
      const vague = N >= 3 && m.items.filter((item) => words(item.label).size <= 3 && GENERIC.test(item.label)).length / N >= 0.5;
      return {
        ...m,
        N,
        perDay,
        subsByDay,
        createdKey,
        expected,
        submitted: submittedDays.length,
        avg,
        tickets: closedBy[m.id] || 0,
        overdue: openTickets.filter((t) => t.assignee_id === m.id && t.sla_resolution_due && new Date(t.sla_resolution_due).getTime() < now).length,
        skips,
        todayDone,
        todaySubmitted: todaySubs.length > 0,
        todayCount: todaySubs.reduce((a, s) => a + Number(s.done_count || 0), 0),
        dupOf,
        dupCount: Object.keys(dupOf).length,
        vague,
      };
    });
    return { members };
  }, [data, days, today, now, range.from, range.to]);

  if (!model) return <Skeleton className="h-[720px] w-full rounded-xl" />;
  const rangeLabel = `${shortDate(range.from)} – ${shortDate(range.to)}`;

  const members = model.members.filter((m) => desk === "all" || m.desk === desk).sort((a, b) => (a.desk === b.desk ? b.tickets - a.tickets || a.name.localeCompare(b.name) : a.desk === "it" ? -1 : 1));
  const all = model.members;
  const todayIsWorkday = days.includes(today);
  const cutoffAt = new Date(`${today}T19:00:00+05:30`).getTime();
  const left = cutoffAt - now;
  const leftLabel = left > 0 ? `${Math.floor(left / 3600000)}h ${Math.round((left % 3600000) / 60000)}m left` : "cut-off passed";
  const submittedToday = all.filter((m) => m.todaySubmitted);
  const expectedTotal = all.reduce((a, m) => a + m.expected, 0);
  const submittedTotal = all.reduce((a, m) => a + m.submitted, 0);
  const never = all.filter((m) => !m.submitted);
  const tickedToday = all.reduce((a, m) => a + m.todayCount, 0);
  const itemsTotal = all.reduce((a, m) => a + m.N, 0);
  const topTicker = [...all].sort((a, b) => b.todayCount - a.todayCount)[0];
  const perDayCount = days.map((k) => ({ k, n: all.filter((m) => m.perDay[k]).length }));
  const best = [...perDayCount].sort((a, b) => b.n - a.n)[0];
  const worst = [...perDayCount].filter((d) => d.k !== today).sort((a, b) => a.n - b.n)[0];
  const kpis = [
    { l: "Submitted today", v: `${submittedToday.length} / ${all.length}`, s: todayIsWorkday ? `Cut-off 19:00 · ${leftLabel}` : "Not a workday", c: submittedToday.length < all.length ? "#b42318" : "#12795a" },
    { l: `Submission rate · ${rangeDays} workday${rangeDays === 1 ? "" : "s"}`, v: `${expectedTotal ? Math.round((submittedTotal / expectedTotal) * 100) : 0}%`, s: `${submittedTotal} of ${expectedTotal} expected check-ins`, c: "#17171c" },
    { l: "Never submitted", v: never.length, s: never.length ? never.map((m) => first(m.name)).slice(0, 4).join(", ") : "everyone has reported", c: never.length ? "#b42318" : "#12795a" },
    { l: "Tasks ticked today", v: `${tickedToday} / ${itemsTotal}`, s: topTicker && tickedToday && topTicker.todayCount / tickedToday >= 0.4 ? `${Math.round((topTicker.todayCount / tickedToday) * 100)}% of them are ${first(topTicker.name)}'s ${topTicker.N}-item list` : `${itemsTotal ? Math.round((tickedToday / itemsTotal) * 100) : 0}% of all checklist items`, c: "#17171c" },
    { l: "Best-reporting day", v: best ? `${weekday(best.k)} ${dayNum(best.k)}` : "—", s: best ? `${best.n} of ${all.length} submitted${worst ? ` · ${weekday(worst.k)} ${dayNum(worst.k)} lowest (${worst.n})` : ""}` : "", c: "#17171c" },
  ];

  // Reporting vs work: one plain-language verdict per member instead of a scatter.
  const tmax = Math.max(1, ...members.map((m) => m.tickets));
  const verdicts = members.map((m) => {
    const rate = m.expected ? m.submitted / m.expected : 0;
    const reports = rate >= REPORTS_OK;
    const works = m.tickets >= busyTickets;
    const v = reports && works ? "good" : works ? "noreport" : reports ? "lowwork" : "neither";
    return { m, rate, v };
  }).sort((a, b) => VERDICT_ORDER.indexOf(a.v) - VERDICT_ORDER.indexOf(b.v) || b.m.tickets - a.m.tickets || b.rate - a.rate);
  const verdictCounts = Object.fromEntries(VERDICT_ORDER.map((k) => [k, verdicts.filter((d) => d.v === k).length]));
  const shownVerdicts = verdicts.filter((d) => verdictFilter === "all" || d.v === verdictFilter);

  const boardKey = days.includes(boardDay) ? boardDay : days.at(-1);
  const board = members
    .map((m) => {
      const subs = m.subsByDay[boardKey] || [];
      const responses = subs.flatMap((s) => s.responses || []);
      const done = subs.reduce((a, s) => a + Number(s.done_count || 0), 0);
      const total = subs.reduce((a, s) => a + Number(s.total || 0), 0);
      const at = subs.map((s) => s.submitted_at || s.created_at).filter(Boolean).sort(compareText).at(-1);
      return { m, subs, responses, done, total, at, late: subs.some((s) => s.late), applies: boardKey >= m.createdKey };
    })
    .sort((a, b) => (b.subs.length > 0) - (a.subs.length > 0) || a.m.name.localeCompare(b.m.name));
  const boardSubmitted = board.filter((b) => b.subs.length).length;

  const skipped = members
    .flatMap((m) => Object.values(m.skips).filter((s) => s.skipped).map((s) => ({ ...s, who: `${m.name} · ${m.submitted} submission${m.submitted === 1 ? "" : "s"}` })))
    .sort((a, b) => b.skipped / b.seen - a.skipped / a.seen || b.skipped - a.skipped)
    .slice(0, 7);

  const todayRows = [...members].sort((a, b) => a.todaySubmitted - b.todaySubmitted);
  const pendingIds = members.filter((m) => !m.todaySubmitted && !reminded[m.id]).map((m) => m.id);
  const remind = async (ids) => {
    if (!ids.length) return;
    try {
      const result = await api("/member-checklists/remind-pending", { method: "POST", body: { member_ids: ids } });
      setReminded((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, true])) }));
      toast.success(`Reminder sent to ${result.reminded} member${result.reminded === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const health = members.map((m) => {
    const flags = [];
    if (m.N > 12) flags.push([`${m.N} items — too many for daily`, "bg-[#fdeaea] text-[#b42318]"]);
    if (m.dupCount) flags.push([`${m.dupCount} duplicate${m.dupCount === 1 ? "" : "s"}`, "bg-[#fdeaea] text-[#b42318]"]);
    if (m.vague) flags.push(["Vague items", "bg-[#fdf3dc] text-[#8a5a00]"]);
    if (m.N === 1) flags.push(["Single item", "bg-[#fdf3dc] text-[#8a5a00]"]);
    if (!m.submitted) flags.push(["Never used", "bg-[#f1f0ec] text-[#55555e]"]);
    if (!flags.length) flags.push(["OK", "bg-[#e4f3ec] text-[#12795a]"]);
    return { m, flags };
  });
  const itSizes = [...new Set(model.members.filter((m) => m.desk === "it").map((m) => m.N))].sort((a, b) => a - b);

  const om = open && model.members.find((m) => m.id === open);
  let read = "";
  if (om) {
    const rate = om.expected ? om.submitted / om.expected : 0;
    const busy = om.tickets >= busyTickets * 2;
    read = [
      rate >= 0.75 ? `Reports reliably (${om.submitted}/${om.expected} workdays).` : om.submitted ? `Reports on ${om.submitted} of ${om.expected} workdays.` : `No checklist submitted in ${om.expected || rangeDays} workdays.`,
      busy ? `${om.tickets} tickets closed in ${rangeLabel}${rate < 0.5 ? " — the work is happening; the reporting habit isn't" : ""}.` : `${om.tickets} ticket${om.tickets === 1 ? "" : "s"} closed in ${rangeLabel}.`,
      om.N > 12 ? `The ${om.N}-item list inflates effort and drags the % down.` : "",
      om.dupCount ? `${om.dupCount} item${om.dupCount === 1 ? " repeats" : "s repeat"} another almost word for word.` : "",
      !om.submitted && !om.tickets && om.overdue ? `Owns ${om.overdue} overdue ticket${om.overdue === 1 ? "" : "s"} — needs a conversation.` : "",
    ].filter(Boolean).join(" ");
  }

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4 text-[13px] text-[#17171c]">
      <header className="flex flex-wrap items-end justify-between gap-3.5">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[22px] font-semibold tracking-[-.01em]">Team &amp; Checklists</h2>
          <div className="text-[#6b6b76]">Daily checklists vs real ticket work · {rangeDays} workday{rangeDays === 1 ? "" : "s"} ({rangeLabel})</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 rounded-[9px] bg-[#ebeae6] p-[3px]">
            {[["all", "All teams"], ["it", "IT"], ["admin", "Admin"]].map(([k, l]) => (
              <button key={k} onClick={() => setDesk(k)} className={`rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium ${seg(desk === k)}`}>{l}</button>
            ))}
          </div>
          <DateRangeMenu
            from={range.from}
            to={range.to}
            max={today}
            label={`${rangeLabel} ${range.to.slice(0, 4)}`}
            summary={`${rangeDays} workday${rangeDays === 1 ? "" : "s"}`}
            presets={[["8wd", "Last 8 workdays"], ["30d", "Last 30 days"], ["month", "This month"], ["lastmonth", "Last month"]].map(([key, label]) => ({ key, label, active: range.preset === key }))}
            onPreset={applyPreset}
            onFrom={(v) => setCustom("from", v)}
            onTo={(v) => setCustom("to", v)}
          />
          <button onClick={onEdit} className="rounded-[9px] border border-[#e0dfdb] bg-white px-3 py-2 text-[12.5px] text-[#17171c]">Edit checklists</button>
          <button onClick={() => remind(pendingIds)} disabled={!pendingIds.length} className="rounded-[9px] bg-[#17171c] px-3.5 py-2 text-[12.5px] font-medium text-white disabled:opacity-60">
            {pendingIds.length ? `Remind pending (${pendingIds.length})` : "All reminded"}
          </button>
        </div>
      </header>

      <section className="grid overflow-hidden rounded-xl border border-[#e8e7e3] bg-white" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        {kpis.map((k) => (
          <div key={k.l} className="flex flex-col gap-[5px] border-r border-[#efeeea] px-[18px] py-3.5 last:border-r-0">
            <span className="text-xs text-[#6b6b76]">{k.l}</span>
            <span className="text-[22px] font-semibold tracking-[-.02em]" style={{ color: k.c }}>{k.v}</span>
            <span className="text-[11.5px] leading-snug text-[#6b6b76]">{k.s}</span>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-[#e8e7e3] bg-white">
        <div className="flex flex-wrap items-start justify-between gap-2.5 px-[18px] pb-3 pt-4">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Consistency · who fills it, and how fully</h3><span className="text-xs text-[#6b6b76]">% of checklist ticked each workday. Blank = no submission. Click a member for detail.</span></div>
          <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-[#55555e]">
            {[["#12795a", "90–100%"], ["#d9a13a", "50–89%"], ["#d4553a", "< 50%"], ["#f1f0ec", "Missed"]].map(([c, l]) => <span key={l} className="flex items-center gap-[5px]"><span className="h-3 w-3 rounded-[3px]" style={{ background: c }} />{l}</span>)}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[900px] items-center gap-[5px] px-[18px] pb-4 tabular-nums" style={{ gridTemplateColumns: `minmax(170px,1.6fr) repeat(${days.length},minmax(52px,1fr)) 86px 92px 96px` }}>
            <span className="text-[11px] text-[#8a8a93]">Member</span>
            {days.map((k) => <span key={k} className={`text-center text-[11px] leading-tight ${k === today ? "font-semibold text-[#b3177f]" : "text-[#8a8a93]"}`}>{k === today ? "Today" : weekday(k)}<br />{dayNum(k)}</span>)}
            <span className="text-right text-[11px] text-[#8a8a93]">Submitted</span>
            <span className="text-right text-[11px] text-[#8a8a93]">Avg ticked</span>
            <span className="text-right text-[11px] text-[#8a8a93]">Tickets closed</span>
            {members.map((m) => {
              const D = DESK[m.desk];
              return [
                <button key={`${m.id}-n`} onClick={() => setOpen(m.id)} className="flex min-w-0 items-center gap-[9px] py-[3px] text-left">
                  <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-[10px] font-semibold" style={{ background: D.soft, color: D.color }}>{initials(m.name)}</span>
                  <span className="flex min-w-0 flex-col leading-tight"><span className="truncate font-medium">{m.name}</span><span className="text-[11px] text-[#8a8a93]">{D.label} · {m.N} items</span></span>
                </button>,
                ...days.map((k) => {
                  const d = m.perDay[k];
                  if (!d) {
                    const due = k === today;
                    return <div key={`${m.id}-${k}`} title={due ? "Not submitted yet" : "No submission"} className={`box-border grid h-[34px] place-items-center rounded-md text-[11.5px] font-semibold text-[#9a9aa3] ${due ? "border-[1.5px] border-dashed border-[#d6d4ce] bg-white" : "bg-[#f1f0ec]"}`}>{due ? "due" : ""}</div>;
                  }
                  const p = d.total ? Math.round((d.done / d.total) * 100) : 0;
                  return (
                    <div key={`${m.id}-${k}`} title={`${d.done}/${d.total} items${d.late ? ` · submitted late${d.at ? ` at ${clock(d.at)}` : ""}` : d.at ? ` · submitted ${clock(d.at)}` : ""}${d.done === 0 ? " · 0 ticked" : ""}`} className="relative grid h-[34px] place-items-center rounded-md text-[11.5px] font-semibold text-white" style={{ background: pctColor(p) }}>
                      {p}%
                      {d.late && <span className="absolute right-1 top-[3px] h-[5px] w-[5px] rounded-full bg-white" />}
                    </div>
                  );
                }),
                <span key={`${m.id}-s`} className={`text-right font-semibold ${m.expected && m.submitted / m.expected >= 0.75 ? "text-[#12795a]" : m.expected && m.submitted / m.expected >= 0.375 ? "text-[#8a5a00]" : "text-[#b42318]"}`}>{m.submitted}/{m.expected}</span>,
                <span key={`${m.id}-a`} className="text-right">{m.avg == null ? "—" : `${m.avg}%`}</span>,
                <span key={`${m.id}-t`} className="text-right font-semibold">{m.tickets}</span>,
              ];
            })}
          </div>
          {!members.length && <p className="px-[18px] pb-5 text-[#6b6b76]">No checklists assigned for this team.</p>}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-[#e8e7e3] bg-white p-[18px]">
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Daily checklist · all members</h3><span className="text-xs text-[#6b6b76]">What each member reported on {!boardKey ? "— no workdays in this range" : noonIst(boardKey).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: TZ })} · {boardSubmitted} of {board.length} submitted</span></div>
          <div className="flex flex-wrap gap-0.5 rounded-[9px] bg-[#ebeae6] p-[3px]">
            {days.map((k) => <button key={k} onClick={() => setBoardDay(k)} className={`rounded-[7px] px-2.5 py-1 text-[12px] font-medium ${seg(boardKey === k)}`}>{k === today ? "Today" : `${weekday(k)} ${dayNum(k)}`}</button>)}
          </div>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,280px),1fr))" }}>
          {board.map(({ m, subs, responses, done, total, at, late, applies }) => {
            const D = DESK[m.desk];
            const submitted = subs.length > 0;
            const p = total ? Math.round((done / total) * 100) : 0;
            const status = submitted
              ? [`${late ? "Late" : "Submitted"}${at ? ` · ${clock(at)}` : ""}`, late ? "bg-[#fdf3dc] text-[#8a5a00]" : "bg-[#e4f3ec] text-[#12795a]"]
              : !applies ? ["Not assigned yet", "bg-[#f1f0ec] text-[#55555e]"]
              : boardKey === today ? ["Pending", "bg-white text-[#8a8a93] border border-dashed border-[#d6d4ce]"]
              : ["Missed", "bg-[#fdeaea] text-[#b42318]"];
            const rows = submitted ? responses : m.items.map((item) => ({ key: `${item.listId}:${item.key}`, item: item.label }));
            return (
              <div key={m.id} className="flex flex-col gap-2 rounded-[10px] border border-[#efeeea] p-3">
                <div className="flex items-center justify-between gap-2">
                  <button onClick={() => setOpen(m.id)} className="flex min-w-0 items-center gap-[9px] text-left">
                    <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-[10px] font-semibold" style={{ background: D.soft, color: D.color }}>{initials(m.name)}</span>
                    <span className="flex min-w-0 flex-col leading-tight"><span className="truncate font-medium">{m.name}</span><span className="text-[11px] text-[#8a8a93]">{D.label}{submitted ? ` · ${done}/${total} done` : ` · ${m.N} items`}</span></span>
                  </button>
                  <span className={`shrink-0 rounded-full px-2 py-[3px] text-[11px] font-medium ${status[1]}`}>{status[0]}</span>
                </div>
                {submitted && <div className="h-1.5 overflow-hidden rounded-[3px] bg-[#f1f0ec]"><div className="h-full" style={{ width: `${p}%`, background: pctColor(p) }} /></div>}
                <ul className={`m-0 flex max-h-[260px] list-none flex-col gap-1 overflow-auto p-0 pb-1 ${submitted ? "" : "opacity-55"}`}>
                  {rows.map((r, i) => (
                    <li key={`${r.key}-${i}`} className="grid items-start gap-2" style={{ gridTemplateColumns: "16px minmax(0,1fr)" }}>
                      <span className={`mt-px box-border grid h-4 w-4 place-items-center rounded text-[10px] text-white ${submitted && r.done ? "bg-[#12795a]" : submitted && r.na ? "bg-[#b9b7b0]" : "border-[1.5px] border-[#d6d4ce] bg-white"}`}>{submitted && r.done ? "✓" : submitted && r.na ? "–" : ""}</span>
                      <span className="flex min-w-0 flex-col gap-0.5 leading-snug">
                        <span className={submitted && !r.done && !r.na ? "text-[#b42318]" : "text-[#3b3b44]"}>{r.item}{r.extra || r.self_added ? <span className="ml-1 text-[11px] text-[#8a8a93]">(added)</span> : null}{r.na ? <span className="ml-1 text-[11px] text-[#8a8a93]">(N/A)</span> : null}</span>
                        {r.remark && <span className="text-[11.5px] text-[#8a5a00]">{r.remark}</span>}
                      </span>
                    </li>
                  ))}
                  {!rows.length && <li className="text-[#8a8a93]">No items on this checklist.</li>}
                </ul>
                {rows.length > 10 && <span className="-mt-1 text-[11px] text-[#8a8a93]">{rows.length} items · scroll the list to see all</span>}
                {submitted && subs.some((s) => s.remark) && <span className="rounded-md bg-[#f7f6f3] px-2 py-1.5 text-[11.5px] text-[#3b3b44]">{subs.map((s) => s.remark).filter(Boolean).join(" · ")}</span>}
              </div>
            );
          })}
          {!board.length && <span className="text-[#8a8a93]">No checklists assigned for this team.</span>}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border border-[#e8e7e3] bg-white p-[18px]">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Checklist reporting vs actual ticket work</h3><span className="text-xs text-[#6b6b76]">Does each member both close tickets and fill their daily checklist? Reporting counts if submitted on {Math.round(REPORTS_OK * 100)}%+ of the {rangeDays} workdays in range; ticket work counts at {busyTickets}+ closed in the same dates.</span></div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setVerdictFilter("all")} className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${verdictFilter === "all" ? "border-[#17171c] bg-[#17171c] text-white" : "border-[#e0dfdb] bg-white text-[#55555e]"}`}>All · {verdicts.length}</button>
            {VERDICT_ORDER.map((k) => (
              <button key={k} onClick={() => setVerdictFilter(verdictFilter === k ? "all" : k)} title={VERDICT[k].hint} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${verdictFilter === k ? "border-[#17171c]" : "border-transparent"} ${VERDICT[k].cls}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: VERDICT[k].dot }} />{VERDICT[k].label} · {verdictCounts[k]}
              </button>
            ))}
          </div>
          <div className="-mx-1 overflow-x-auto px-1"><div className="flex min-w-[540px] flex-col">
            <div className="grid items-center gap-3 border-b border-[#efeeea] pb-1.5 text-[11px] text-[#8a8a93]" style={{ gridTemplateColumns: "minmax(150px,1.4fr) minmax(80px,1fr) minmax(80px,1fr) 150px" }}>
              <span>Member</span><span>Checklist submitted (days)</span><span>Tickets closed (range)</span><span className="text-right">Verdict</span>
            </div>
            {shownVerdicts.map(({ m, rate, v }) => {
              const D = DESK[m.desk];
              return (
                <button key={m.id} onClick={() => setOpen(m.id)} className="grid items-center gap-3 border-b border-[#f1f0ec] py-2 text-left hover:bg-[#faf9f7]" style={{ gridTemplateColumns: "minmax(150px,1.4fr) minmax(80px,1fr) minmax(80px,1fr) 150px" }}>
                  <span className="flex min-w-0 items-center gap-[9px]"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9.5px] font-semibold" style={{ background: D.soft, color: D.color }}>{initials(m.name)}</span><span className="flex min-w-0 flex-col leading-tight"><span className="truncate">{m.name}</span><span className="text-[11px] text-[#8a8a93]">{D.label}</span></span></span>
                  <span className="flex items-center gap-2">
                    <span className="relative h-1.5 flex-1 overflow-hidden rounded-[3px] bg-[#f1f0ec]"><span className="absolute inset-y-0 left-0 rounded-[3px]" style={{ width: `${Math.round(rate * 100)}%`, background: rate >= REPORTS_OK ? "#12795a" : "#d4553a" }} /><span className="absolute inset-y-0 w-px bg-[#8a8a93]" style={{ left: `${REPORTS_OK * 100}%` }} /></span>
                    <span className="w-[30px] text-right text-[11.5px] font-semibold tabular-nums">{m.submitted}/{m.expected}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="relative h-1.5 flex-1 overflow-hidden rounded-[3px] bg-[#f1f0ec]"><span className="absolute inset-y-0 left-0 rounded-[3px]" style={{ width: `${Math.round((m.tickets / tmax) * 100)}%`, background: m.tickets >= busyTickets ? "#2f6bd0" : "#b9b7b0" }} /></span>
                    <span className="w-[22px] text-right text-[11.5px] font-semibold tabular-nums">{m.tickets}</span>
                  </span>
                  <span className="flex justify-end"><span className={`rounded-full px-2 py-[3px] text-[11px] font-medium ${VERDICT[v].cls}`}>{VERDICT[v].label}</span></span>
                </button>
              );
            })}
            {!shownVerdicts.length && <span className="py-3 text-[#8a8a93]">No members in this group.</span>}
          </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-[#e8e7e3] bg-white p-[18px]">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Most-skipped checklist items</h3><span className="text-xs text-[#6b6b76]">Items left unticked on submitted days — either not done, or not a daily task</span></div>
          <div className="flex flex-col">
            {skipped.map((k) => (
              <div key={k.who + k.item} className="grid items-center gap-3 border-b border-[#f1f0ec] py-[9px]" style={{ gridTemplateColumns: "minmax(0,1fr) 110px 44px" }}>
                <div className="flex min-w-0 flex-col gap-0.5"><span className="truncate">{k.item}</span><span className="text-[11.5px] text-[#8a8a93]">{k.who}</span></div>
                <div className="h-1.5 overflow-hidden rounded-[3px] bg-[#f1f0ec]"><div className="h-full rounded-[3px] bg-[#d4553a]" style={{ width: `${Math.round((k.skipped / k.seen) * 100)}%` }} /></div>
                <span className="text-right font-semibold tabular-nums">{k.skipped}/{k.seen}</span>
              </div>
            ))}
            {!skipped.length && <span className="py-3 text-[#8a8a93]">No items skipped on submitted days.</span>}
          </div>
          <span className="text-xs leading-normal text-[#55555e]">Items skipped on most days should move to a weekly checklist or be removed — they drag scores down without signalling a problem.</span>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border border-[#e8e7e3] bg-white p-[18px]">
          <div className="flex flex-wrap justify-between gap-2.5">
            <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Today · {noonIst(today).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: TZ })}</h3><span className="text-xs text-[#6b6b76]">Cut-off 19:00 · {leftLabel}</span></div>
            <span className="text-xs text-[#6b6b76]">{members.filter((m) => m.todaySubmitted).length} submitted · {members.filter((m) => !m.todaySubmitted).length} pending</span>
          </div>
          <div className="flex flex-col">
            {todayRows.map((m) => {
              const D = DESK[m.desk];
              const p = m.N ? Math.round((m.todayCount / m.N) * 100) : 0;
              const complete = m.todaySubmitted && m.todayCount >= m.N;
              return (
                <div key={m.id} className="grid items-center gap-3 border-b border-[#f1f0ec] py-2" style={{ gridTemplateColumns: "minmax(0,1fr) 120px 92px" }}>
                  <button onClick={() => setOpen(m.id)} className="flex min-w-0 items-center gap-[9px] text-left"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9.5px] font-semibold" style={{ background: D.soft, color: D.color }}>{initials(m.name)}</span><span className="truncate">{m.name}</span></button>
                  <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-[#f1f0ec]"><div className="h-full" style={{ width: `${p}%`, background: m.todaySubmitted ? pctColor(p) : "#e3e1dc" }} /></div><span className="w-[38px] text-right text-[11.5px] text-[#55555e]">{m.todayCount}/{m.N}</span></div>
                  <div className="flex justify-end">
                    {m.todaySubmitted ? (
                      <span className={`rounded-full px-2 py-[3px] text-[11.5px] font-medium ${complete ? "bg-[#e4f3ec] text-[#12795a]" : "bg-[#fdf3dc] text-[#8a5a00]"}`}>{complete ? "Complete" : m.todayCount === 0 ? "Not done" : "Partial"}</span>
                    ) : (
                      <button onClick={() => remind([m.id])} disabled={reminded[m.id]} className={`rounded-[7px] border border-[#e0dfdb] bg-white px-2.5 py-1 text-xs ${reminded[m.id] ? "text-[#9a9aa3]" : "text-[#17171c]"}`}>{reminded[m.id] ? "Reminded" : "Remind"}</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-[#e8e7e3] bg-white p-[18px]">
          <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">Checklist health</h3><span className="text-xs text-[#6b6b76]">{itSizes.length > 1 ? `Same IT role, ${itSizes.join(" vs ")} items — so % scores can't be compared` : "Checklist size and quality per member"}</span></div>
          <div className="flex flex-col">
            {health.map(({ m, flags }) => (
              <div key={m.id} className="grid items-center gap-3 border-b border-[#f1f0ec] py-[9px]" style={{ gridTemplateColumns: "minmax(120px,1fr) 54px minmax(0,1.6fr)" }}>
                <span className="truncate font-medium">{m.name}</span>
                <span className={`text-right font-semibold tabular-nums ${m.N > 12 ? "text-[#b42318]" : ""}`}>{m.N}</span>
                <div className="flex flex-wrap gap-1">{flags.map(([t, cls]) => <span key={t} className={`rounded-[5px] px-[7px] py-[3px] text-[11px] font-medium ${cls}`}>{t}</span>)}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-[#f7f6f3] px-3 py-2.5 text-[12.5px] leading-normal text-[#3b3b44]"><strong className="font-semibold">Suggested IT template (7 items):</strong> Daily internet &amp; Wi-Fi check · VC room readiness · Antivirus/endpoint status · Asset movements logged · User account changes · Open tickets reviewed · Hand-off note. Keep lists the same size so % scores compare fairly.</div>
        </div>
      </section>

      {om && (
        <>
          <div onClick={() => setOpen(null)} className="fixed inset-0 z-40 bg-[rgba(23,23,28,.28)]" />
          <aside className="fixed inset-y-0 right-0 z-[41] flex w-[min(460px,100vw)] flex-col bg-white text-[13px] shadow-[-12px_0_40px_rgba(0,0,0,.12)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#efeeea] px-[22px] pb-4 pt-5">
              <div className="flex flex-col gap-[3px]"><span className="text-base font-semibold">{om.name}</span><span className="text-xs text-[#6b6b76]">{DESK[om.desk].label} team · {om.N}-item checklist{om.lists.length > 1 ? ` across ${om.lists.length} lists` : ""}</span></div>
              <button onClick={() => setOpen(null)} className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-[#e0dfdb] bg-white text-[#55555e]" aria-label="Close"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="flex flex-1 flex-col gap-[18px] overflow-auto px-[22px] py-[18px]">
              <div className="grid grid-cols-3 gap-2.5">
                {[["Checklist submitted", `${om.submitted}/${om.expected}`], ["Avg ticked", om.avg == null ? "—" : `${om.avg}%`], ["Tickets closed (range)", om.tickets]].map(([l, v]) => (
                  <div key={l} className="flex flex-col gap-1 rounded-[10px] border border-[#efeeea] p-3"><span className="text-[11.5px] text-[#6b6b76]">{l}</span><span className="text-[19px] font-semibold">{v}</span></div>
                ))}
              </div>
              <div className="rounded-lg bg-[#f7f6f3] px-3 py-2.5 text-[12.5px] leading-normal text-[#3b3b44]">{read}</div>
              <div className="flex flex-col gap-0.5">
                <span className="mb-1.5 font-semibold">Checklist · today &amp; skip rate</span>
                {om.items.map((item, i) => {
                  const key = `${item.listId}:${item.key}`;
                  const todayResp = om.todayDone.get(key);
                  const done = Boolean(todayResp?.done);
                  const sk = om.skips[key];
                  const rate = sk ? sk.skipped / Math.max(1, sk.seen) : 0;
                  const dup = om.dupOf[i];
                  return (
                    <div key={key} className="grid items-start gap-2.5 border-b border-[#f4f3f0] py-[7px]" style={{ gridTemplateColumns: "18px minmax(0,1fr) 64px" }}>
                      <span className={`mt-px box-border grid h-4 w-4 place-items-center rounded text-[10px] text-white ${done ? "bg-[#12795a]" : "border-[1.5px] border-[#d6d4ce] bg-white"}`}>{done ? "✓" : ""}</span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="leading-snug text-[#3b3b44]">{item.label}</span>
                        {dup != null && <span className="text-[11.5px] text-[#b42318]">Duplicate of item {dup + 1}</span>}
                        {todayResp?.remark && <span className="text-[11.5px] text-[#8a5a00]">{todayResp.remark}</span>}
                      </div>
                      <span className={`text-right text-[11.5px] ${rate >= 0.5 ? "text-[#b42318]" : "text-[#8a8a93]"}`}>{sk ? `skipped ${sk.skipped}/${sk.seen}` : ""}</span>
                    </div>
                  );
                })}
                {!om.submitted && <span className="pt-2 text-[#8a8a93]">{om.N}-item checklist assigned — never submitted in {om.expected || rangeDays} workdays.</span>}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#efeeea] px-[22px] py-3.5">
              {!om.todaySubmitted && <button onClick={() => remind([om.id])} disabled={reminded[om.id]} className="rounded-lg border border-[#e0dfdb] bg-white px-3 py-2 text-[12.5px] disabled:text-[#9a9aa3]">{reminded[om.id] ? "Reminded" : "Remind"}</button>}
              <button onClick={() => { setOpen(null); onEdit(); }} className="rounded-lg bg-[#17171c] px-3.5 py-2 text-[12.5px] text-white">Edit checklist</button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

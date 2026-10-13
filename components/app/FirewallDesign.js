"use client";

// Presentation layer for the Firewall page redesign. Every number here is
// derived from the live payloads FirewallView already loads (summary overview,
// security summary, traffic report, downtime and archive list); nothing is
// hard-coded. The detailed panels (device table, app explorer, interfaces,
// event stream, archive downloads) still render below each tab.

const RED = "#b42318";
const AMB = "#8a5a00";
const GRN = "#12795a";
const BLU = "#2f6bd0";
const MAG = "#b3177f";
const ORG = "#e0822f";
const GRY = "#9a9894";
const INK = "#17171c";
const SEV = {
  c: ["bg-[#fdeaea] text-[#b42318]", RED, "border-[#f1d3d0]"],
  h: ["bg-[#fdf3dc] text-[#8a5a00]", AMB, "border-[#e8e7e3]"],
  m: ["bg-[#f1f0ec] text-[#55555e]", "#55555e", "border-[#e8e7e3]"],
  g: ["bg-[#e4f3ec] text-[#12795a]", GRN, "border-[#e8e7e3]"],
};

export const fmtBytes = (bytes) => {
  const mb = Number(bytes || 0) / 1e6;
  if (mb >= 1e6) return `${(mb / 1e6).toFixed(1)} TB`;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  if (!bytes) return "0";
  return `${Math.max(1, Math.round(mb * 1000))} KB`;
};
const n = (value) => Number(value || 0).toLocaleString("en-IN");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const dur = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};
const istDate = (value) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const dm = (value) =>
  new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const clock = (value) =>
  new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

const kp = (l, v, s, c = INK) => ({ l, v, s, c });
const ins = (k, tag, h, b) => ({ k, tag, h, b });
const row = (l, sub, v, segs, o = {}) => ({ l, sub, v, segs, tag: o.tag || "", tagCls: o.tagCls || SEV.c[0], vc: o.vc || INK, tip: o.tip || "" });
const bars = (rows, color, fmt = n) => {
  const mx = Math.max(1e-9, ...rows.map((r) => r[2]));
  return rows.map((r) => row(r[0], r[1], fmt(r[2]), [{ w: Math.max(0.6, (r[2] / mx) * 100), c: r[3]?.c || color }], r[3] || {}));
};
const split = (rows, c1, c2) => {
  const mx = Math.max(1e-9, ...rows.map((r) => r[2] + r[3]));
  return rows.map((r) => row(r[0], r[1], fmtBytes(r[2] + r[3]), [{ w: (r[2] / mx) * 100, c: c1 }, { w: (r[3] / mx) * 100, c: c2 }], r[4] || {}));
};
const chart = (title, sub, legend, cols, note) => {
  const mx = Math.max(1, ...cols.map((c) => c.vals.reduce((a, b) => a + b, 0)));
  return { title, sub, legend, note, cols: cols.map((c) => ({ l: c.l, tip: c.tip || "", segs: c.vals.map((v, i) => ({ h: Math.round((v / mx) * 120), c: legend[i].c })) })) };
};

const PURPOSES = [
  ["Web browsing", BLU, (a) => /web\.client/i.test(a.category || "") || /^(https?|https?\.browser.*)$/i.test(a.name)],
  ["Proxy / tunnel", RED, (a) => /proxy/i.test(a.category || "") || a.risk === "critical"],
  ["Remote access & VPN", ORG, (a) => /remote/i.test(a.category || "") || /^(ssh|rdp|isakmp|ipsec|ssl_tls.*|openvpn|teamviewer|anydesk)/i.test(a.name)],
  ["Video & social", MAG, (a) => /video|audio|social|game/i.test(a.category || "")],
  ["Collaboration & email", GRN, (a) => /collab|email|storage|business/i.test(a.category || "")],
];
const purposeOf = (app) => PURPOSES.find(([, , test]) => test(app)) || ["Other", GRY];

/** Builds everything the redesigned tabs show from the live payloads. */
export function buildFirewallModel(input) {
  const {
    firewall, data, report, security, downtime, deviceList, interfaceRows, policyRows,
    activeAcceptPolicies, applicationControlPolicies, cpu, memory, sessions, sessionHistory,
    eventCount, archives, systemTypeFrom, mapped,
  } = input;
  const now = Date.now();
  const siteLabel = firewall.toUpperCase();
  const otherId = firewall === "hq" ? "hq2" : "hq";
  const other = downtime?.[otherId];
  const mine = downtime?.[firewall];
  const agg = report?.aggregates || {};
  const apps = agg.applications || [];
  const identifiedApps = apps.filter((a) => a.source_kind === "application_control");
  const traffic = Number(report?.summary?.traffic_bytes || 0);
  const clients = agg.clients || [];
  const bf = security?.brute_force;
  const topGroup = security?.groups?.[0];
  const up = interfaceRows.filter((r) => r.link === true || r.link === "up" || r.status === "up");
  const down = interfaceRows.length - up.length;
  const codeRx = /\bGR[A-Z]*\d{3,}\b/i;
  const withCode = deviceList.filter((d) => codeRx.test(String(d.hostname || "")));
  const types = {};
  deviceList.forEach((d) => {
    const label = systemTypeFrom(d).label;
    types[label] = (types[label] || 0) + 1;
  });
  const personal = (types.Android || 0) + (types["iPhone / iOS"] || 0) + (types.Tablet || 0) + (types.Mobile || 0);
  const criticalApps = identifiedApps.filter((a) => a.risk === "critical");
  const port = (p) => (agg.destination_ports || []).find((x) => String(x.name) === String(p));
  const ssh = port(22);
  const dot = port(853);
  const sensorsSilent = security && !security.sensors.ips && !security.sensors.antivirus;
  const inventoryErrors = data?.sections?.device_inventory?.errors || [];
  const truncated = [
    data?.section_meta?.events?.row_limit_reached && "security events",
    report?.summary?.record_limit_reached && "traffic",
  ].filter(Boolean);

  // ---- ordered action list (overview)
  const actions = [];
  if (bf && bf.failed >= 100)
    actions.push(["Block the admin-login brute-force", "c", "Critical", `${n(bf.failed)} failed admin logins from ${n(bf.source_ips)} IPs${bf.succeeded ? ` (${bf.succeeded} successful admin logins also logged — verify them)` : ""}. Restrict admin access to trusted hosts.`, "Open incident", "events"]);
  if (other && other.current?.state && other.current.state !== "online")
    actions.push([`Restore ${otherId.toUpperCase()} firewall`, "c", "Critical", `Offline ${other.current?.state_since ? dur(now - new Date(other.current.state_since)) : ""} — ${otherId.toUpperCase()} traffic and threats are invisible.`, `View ${otherId.toUpperCase()}`, `site:${otherId}`]);
  criticalApps.forEach((a) =>
    actions.push([`Block ${a.name}`, "c", "Critical", `${a.sources} device${a.sources === 1 ? "" : "s"} used it for ${fmtBytes(a.traffic_bytes)} (${a.category}). It can tunnel around web filtering.`, "See apps", "applications"]));
  if (deviceList.length && pct(mapped, deviceList.length) < 50)
    actions.push([`Identify the ${n(deviceList.length - mapped)} unknown devices`, "h", "High", `${pct(mapped, deviceList.length)}% have an owner.${withCode.length ? ` ${n(withCode.length)} hostnames already contain an employee code.` : ""}`, "See devices", "devices"]);
  if ((dot && dot.sources) || (ssh && ssh.sources))
    actions.push(["Close encrypted-DNS & SSH leaks", "h", "High", [dot && `Port 853 (${dot.sources} device${dot.sources === 1 ? "" : "s"}) bypasses the DNS filter`, ssh && `SSH out from ${ssh.sources} device${ssh.sources === 1 ? "" : "s"} (${fmtBytes(ssh.traffic_bytes)})`].filter(Boolean).join("; ") + ".", "See traffic", "interfaces"]);
  if (sensorsSilent)
    actions.push(["Turn on IPS & antivirus logging", "m", "Medium", "0 IPS and 0 antivirus events in the retained window — “no threats” currently means “not measured”.", "See security", "events"]);
  if (activeAcceptPolicies.length && applicationControlPolicies.length < activeAcceptPolicies.length)
    actions.push(["Scan apps on every allow policy", "m", "Medium", `Only ${applicationControlPolicies.length} of ${activeAcceptPolicies.length} active allow policies have Application Control.`, "See apps", "applications"]);

  const healthy = cpu < 70 && memory < 85;
  const tabs = {};
  const T = (key) => (tabs[key] = { kpis: [], insights: [], charts: [], panels: [], table: null });

  // ---- overview
  {
    const t = T("overview");
    const topClient = [...clients].sort((a, b) => b.traffic_bytes - a.traffic_bytes)[0];
    const peak = sessionHistory.reduce((m, r) => (r.sessions > (m?.sessions || 0) ? r : m), null);
    t.kpis = [
      kp("Active sessions", n(sessions), peak ? `peak ${n(peak.sessions)} at ${peak.time} (last hour)` : "concurrent connections"),
      kp("Devices online", n(deviceList.length), `${n(mapped)} with a known owner`, mapped ? INK : RED),
      kp("Security events", n(security?.total ?? eventCount), topGroup ? `${pct(topGroup.count, security.total)}% are “${topGroup.title}”` : "retained window", topGroup && topGroup.severity === "alert" ? RED : INK),
      kp("CPU · memory", `${cpu}% · ${memory}%`, healthy ? "plenty of headroom" : "elevated", healthy ? GRN : AMB),
      kp("Traffic today", fmtBytes(traffic), topClient && traffic ? `${pct(topClient.traffic_bytes, traffic)}% from ${topClient.source_name || topClient.source_ip || "one device"}` : "from traffic logs"),
      kp("Links", `${up.length} up`, `${down} unused port${down === 1 ? "" : "s"} down`),
    ];
    const availability = mine?.summary?.availability_percent;
    t.insights = [
      healthy
        ? ins("g", "Healthy", "The firewall itself is fine", `CPU ${cpu}%, memory ${memory}%, ${n(sessions)} active sessions. No hardware or capacity action needed.`)
        : ins("h", "Load", "The firewall is under load", `CPU ${cpu}%, memory ${memory}%. Watch for sustained peaks.`),
      availability != null
        ? ins(availability >= 99 ? "g" : "h", "Availability", `${siteLabel} was reachable ${Math.round(availability * 10) / 10}% of the last ${mine.period?.requested_days || 7} days`, `${mine.summary.outage_count} outage${mine.summary.outage_count === 1 ? "" : "s"} recorded${mine.last_outage ? ` — longest ended ${dm(mine.last_outage.ended_at || now)} after ${dur(mine.last_outage.duration_ms || 0)}` : ""}.${other ? ` ${otherId.toUpperCase()} is ${other.current?.state || "unknown"} now.` : ""}`)
        : ins("m", "Availability", "Availability is still being measured", "Probe history will appear once health checks accumulate."),
      truncated.length
        ? ins("m", "Data trust", `Some logs hit the API row limit`, `The ${truncated.join(" and ")} feed${truncated.length > 1 ? "s" : ""} returned the maximum rows, so totals may be undercounted. Raise the limit so totals agree.`)
        : ins("g", "Data trust", "All log sources returned complete data", "No API row limits were hit in the current window."),
    ];
    t.actions = actions.map((a, i) => ({ n: i + 1, t: a[0], k: a[1], sev: a[2], d: a[3], cta: a[4], go: a[5] }));
    t.actionSub = `CPU, memory and ${up.length} link${up.length === 1 ? "" : "s"} are ${healthy ? "healthy" : "under watch"} — these are the only problems`;
    if (sessionHistory.length)
      t.charts.push(chart("Active sessions · last hour", "concurrent sessions", [{ l: "Sessions", c: BLU }], sessionHistory.map((r, i) => ({ l: i % 4 === 0 ? r.time : "", vals: [r.sessions], tip: `${r.time} · ${n(r.sessions)} sessions` })), peak ? `Peak ${n(peak.sessions)} at ${peak.time}; now ${n(sessions)}.` : ""));
    const dayBlocks = (site) => {
      // Calendar days in IST from the API, oldest first, today last.
      const days = (downtime?.[site]?.daily || []).slice(-7);
      return days.map((d) => ({
        w: 100 / days.length,
        c: !d.tracked_ms ? "#dcdad4" : d.downtime_ms ? (d.downtime_ms >= d.tracked_ms * 0.95 ? "#d4553a" : "#e0b44a") : d.ports?.length ? "#7c5ce0" : "#3aa57a",
      }));
    };
    const siteRow = (site) => {
      const d = downtime?.[site];
      if (!d) return null;
      const online = d.current?.state === "online";
      return row(site.toUpperCase(), `${Math.round((d.summary?.availability_percent || 0) * 10) / 10}% · ${online ? `up since ${dm(d.current.state_since)} ${clock(d.current.state_since)}` : `down since ${dm(d.current?.state_since || now)}`}`, online ? "Online" : "Offline", dayBlocks(site), { vc: online ? GRN : RED });
    };
    t.panels.push({ title: "Availability · last 7 days", sub: "one block per day (IST), today on the right", lw: "1fr", legend: [{ l: "Up", c: "#3aa57a" }, { l: "Partial", c: "#e0b44a" }, { l: "Down", c: "#d4553a" }, { l: "Port down", c: "#7c5ce0" }, { l: "No data", c: "#dcdad4" }], rows: ["hq", "hq2"].map(siteRow).filter(Boolean), note: [mine, other].filter(Boolean).map((d) => `${d.firewall?.label || ""}: ${d.summary?.outage_count || 0} outage${d.summary?.outage_count === 1 ? "" : "s"} · today ${d.today?.downtime_ms ? `${dur(d.today.downtime_ms)} down` : "no downtime"}`).join(" · ") });
    const byPurpose = {};
    apps.filter((a) => a.source_kind === "application_control").forEach((a) => {
      const [label, color] = purposeOf(a);
      const entry = byPurpose[label] || { label, color, bytes: 0, names: [] };
      entry.bytes += Number(a.traffic_bytes || 0);
      if (entry.names.length < 3) entry.names.push(a.name);
      byPurpose[label] = entry;
    });
    const purposeRows = Object.values(byPurpose).sort((a, b) => b.bytes - a.bytes);
    t.purposes = purposeRows;
    if (purposeRows.length)
      t.panels.push({ title: "Traffic by purpose · today", sub: `${fmtBytes(purposeRows.reduce((a, p) => a + p.bytes, 0))} identified by Application Control`, lw: "1.2fr", legend: [], rows: bars(purposeRows.map((p) => [p.label, p.names.join(", "), p.bytes, { c: p.color, ...(p.color === RED ? { tag: "block" } : {}) }]), BLU, fmtBytes), note: "" });
  }

  // ---- devices
  {
    const t = T("devices");
    const phonesPct = pct(personal, deviceList.length);
    t.kpis = [
      kp("Devices online", n(deviceList.length), "active DHCP leases"),
      kp("Known owner", n(mapped), `${pct(mapped, deviceList.length)}% · ${n(deviceList.length - mapped)} still unknown`, mapped ? AMB : RED),
      kp("Phones & tablets", n(personal), `${phonesPct}% of devices on the network`, phonesPct >= 30 ? AMB : INK),
      kp("OS not detected", n(types["Unknown system"] || 0), "enable device detection"),
      kp("Bandwidth today", fmtBytes(traffic), `${n(clients.length)} devices had traffic`),
    ];
    const sorted = [...clients].sort((a, b) => b.traffic_bytes - a.traffic_bytes);
    const heavy = sorted[0];
    const uploaders = sorted.filter((c) => c.sent_bytes > c.received_bytes * 2 && c.sent_bytes > 50e6).slice(0, 2);
    t.insights = [
      heavy && traffic
        ? ins(pct(heavy.traffic_bytes, traffic) >= 30 ? "h" : "m", "Heavy user", `One device used ${pct(heavy.traffic_bytes, traffic)}% of today’s bandwidth`, `${heavy.source_name || heavy.source_ip} moved ${fmtBytes(heavy.traffic_bytes)} — ${heavy.sent_bytes > heavy.received_bytes ? "mostly upload" : "mostly download"}. Check for sync, backup or tunnel traffic.`)
        : ins("m", "Heavy user", "No traffic logged yet today", "Bandwidth ranking appears once traffic logs arrive."),
      uploaders.length
        ? ins("c", "Uploads", `${uploaders.length} device${uploaders.length === 1 ? " is" : "s are"} uploading, not browsing`, uploaders.map((c) => `${c.source_name || c.source_ip} sent ${fmtBytes(c.sent_bytes)}`).join(" and ") + " upstream.")
        : ins("g", "Uploads", "No unusual upload-heavy devices", "Upstream traffic is in line with downloads."),
      inventoryErrors.length && !mapped
        ? ins("c", "Owner mapping", "The asset register isn’t being read", `The server can’t open the asset inventory file (${String(inventoryErrors[0]).split(":")[0]}), so no device can be matched to an owner. Point it at the current register.`)
        : ins("g", "Quick win", `${n(withCode.length)} hostnames already name their owner`, `e.g. ${withCode.slice(0, 2).map((d) => d.hostname).join(", ") || "—"} — the employee code is in the name.`),
    ];
    t.coverage = { pct: `${pct(mapped, deviceList.length)}%`, of: `${n(mapped)} of ${n(deviceList.length)}`, color: mapped ? AMB : RED };
    t.funnel = [
      { l: "Online now", v: deviceList.length, pct: 100, c: GRY },
      { l: "Hostname contains employee code", v: withCode.length, pct: pct(withCode.length, deviceList.length), c: BLU },
      { l: "Owner confirmed", v: mapped, pct: pct(mapped, deviceList.length), c: GRN },
    ];
    const typeRows = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => [label, /Android|iPhone|Tablet|Mobile/.test(label) ? "personal" : "", count, { c: /Android|iPhone|Tablet|Mobile/.test(label) ? MAG : label === "Unknown system" ? GRY : BLU }]);
    const perPort = {};
    deviceList.forEach((d) => {
      const key = d.interface || d.detected_interface || "unknown";
      perPort[key] = (perPort[key] || 0) + 1;
    });
    const aliases = Object.fromEntries(interfaceRows.map((r) => [r.name || r.id, r.alias]));
    const portRows = Object.entries(perPort).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const top2 = portRows.slice(0, 2);
    t.panels = [
      { title: "What’s on the network", sub: `${n(deviceList.length)} devices by type`, lw: "1fr", legend: [], rows: bars(typeRows, BLU), note: personal ? `${n(personal)} phones and tablets share the network. Move personal devices to a guest SSID.` : "" },
      { title: "Devices per port", sub: top2.length ? `${top2.map((p) => p[0]).join(" and ")} carry ${pct(top2.reduce((a, p) => a + p[1], 0), deviceList.length)}% of devices` : "", lw: "1fr", legend: [], rows: bars(portRows.map(([p, c]) => [p, aliases[p] || "", c]), BLU), note: "Split the busiest ports into staff, guest and IoT VLANs so one noisy device can’t affect everyone." },
    ];
  }

  // ---- applications
  {
    const t = T("applications");
    const identifiedBytes = identifiedApps.reduce((a, x) => a + Number(x.traffic_bytes || 0), 0);
    const groups = {};
    identifiedApps.forEach((a) => {
      const [label, color] = purposeOf(a);
      const g = groups[label] || { label, color, bytes: 0, apps: [] };
      g.bytes += Number(a.traffic_bytes || 0);
      g.apps.push(a);
      groups[label] = g;
    });
    const risky = (groups["Proxy / tunnel"]?.bytes || 0) + (groups["Remote access & VPN"]?.bytes || 0);
    const business = (groups["Web browsing"]?.bytes || 0) + (groups["Collaboration & email"]?.bytes || 0);
    t.kpis = [
      kp("App traffic today", fmtBytes(identifiedBytes), `${identifiedApps.length} apps identified`),
      kp("Business use", fmtBytes(business), `${pct(business, identifiedBytes)}% · browsing, docs, email`, GRN),
      kp("Risky traffic", fmtBytes(risky), `${pct(risky, identifiedBytes)}% · proxy + remote access`, risky ? RED : INK),
      kp("Leisure", fmtBytes(groups["Video & social"]?.bytes || 0), `${pct(groups["Video & social"]?.bytes || 0, identifiedBytes)}% · video & social`),
      kp("Policies scanning apps", `${applicationControlPolicies.length} of ${activeAcceptPolicies.length}`, `${activeAcceptPolicies.length - applicationControlPolicies.length} policies unscanned`, applicationControlPolicies.length < activeAcceptPolicies.length ? AMB : GRN),
    ];
    const sshApp = identifiedApps.find((a) => /^ssh$/i.test(a.name));
    t.insights = [
      criticalApps[0]
        ? ins("c", "Critical", `${criticalApps[0].name} — ${criticalApps[0].sources} device${criticalApps[0].sources === 1 ? "" : "s"} use it`, `${fmtBytes(criticalApps[0].traffic_bytes)} today, sent ${fmtBytes(criticalApps[0].sent_bytes)} / received ${fmtBytes(criticalApps[0].received_bytes)}. Block it in policy.`)
        : ins("g", "Critical", "No critical-risk applications", "Nothing rated critical by Application Control today."),
      sshApp
        ? ins("h", "Elevated", `Outbound SSH from ${sshApp.sources} device${sshApp.sources === 1 ? "" : "s"}, ${fmtBytes(sshApp.traffic_bytes)}`, "Normal for engineers, risky from unmanaged machines. Limit port 22 to approved hosts.")
        : ins("g", "Elevated", "No outbound SSH today", "Remote-shell traffic is not present in the retained logs."),
      ins(applicationControlPolicies.length < activeAcceptPolicies.length ? "m" : "g", "Coverage", `${applicationControlPolicies.length} of ${activeAcceptPolicies.length} allow-policies scan apps`, applicationControlPolicies.length < activeAcceptPolicies.length ? "Traffic on the other policies shows as “unscanned”. Enable Application Control on every outbound policy." : "Every active allow policy has Application Control."),
    ];
    const total = Object.values(groups).reduce((a, g) => a + g.bytes, 0) || 1;
    t.comp = Object.values(groups).sort((a, b) => b.bytes - a.bytes).map((g) => {
      const w = (g.bytes / total) * 100;
      return {
        l: g.label, c: g.color, w, v: fmtBytes(g.bytes), pctL: `${w < 1 ? w.toFixed(1) : Math.round(w)}%`,
        inner: w > 12 ? `${g.label} ${Math.round(w)}%` : w > 5 ? `${Math.round(w)}%` : "",
        list: g.apps.sort((a, b) => b.traffic_bytes - a.traffic_bytes).slice(0, 5).map((a) => ({ n: a.name, v: fmtBytes(a.traffic_bytes) })),
      };
    });
    t.compTitle = `Where ${fmtBytes(identifiedBytes)} of app traffic went today`;
    const top = [...identifiedApps].sort((a, b) => b.traffic_bytes - a.traffic_bytes).slice(0, 7);
    t.panels = [
      { title: "Top applications · download vs upload", sub: "Balanced up/down on a proxy = tunnel", lw: "1.1fr", legend: [{ l: "Received", c: BLU }, { l: "Sent", c: MAG }], rows: split(top.map((a) => [a.name, `${a.sources} device${a.sources === 1 ? "" : "s"}`, Number(a.received_bytes || 0), Number(a.sent_bytes || 0), a.risk === "critical" ? { tag: "critical" } : a.risk === "elevated" && /ssh/i.test(a.name) ? { tag: "elevated", tagCls: SEV.h[0] } : {}])), note: "" },
      { title: "Traffic by risk level", sub: "Firewall risk rating per app", lw: "1fr", legend: [], rows: bars(["critical", "elevated", "medium", "low"].map((r) => { const list = identifiedApps.filter((a) => a.risk === r); return [r[0].toUpperCase() + r.slice(1), `${list.length} app${list.length === 1 ? "" : "s"}${list.length ? ` · ${list.slice(0, 3).map((a) => a.name).join(", ")}` : ""}`, list.reduce((s, a) => s + Number(a.traffic_bytes || 0), 0), { c: r === "critical" ? RED : r === "elevated" ? ORG : BLU }]; }).filter((r) => r[2] > 0), BLU, fmtBytes), note: "" },
    ];
  }

  // ---- interfaces / traffic
  {
    const t = T("interfaces");
    const wan = interfaceRows.find((r) => /wan/i.test(r.name || r.id || "") && (r.link === true || r.link === "up"));
    const countries = [...(agg.destination_countries || [])].sort((a, b) => b.traffic_bytes - a.traffic_bytes);
    const perSession = (c) => c.traffic_bytes / Math.max(1, c.records);
    const median = (() => {
      const list = countries.map(perSession).sort((a, b) => a - b);
      return list.length ? list[Math.floor(list.length / 2)] : 0;
    })();
    const odd = countries.find((c) => c.records >= 20 && perSession(c) > median * 10 && c.traffic_bytes > 500e6 && c.name !== "India");
    const policies = [...(agg.policies || [])].sort((a, b) => b.traffic_bytes - a.traffic_bytes);
    const topPolicy = policies[0];
    t.kpis = [
      kp("Links up", `${up.length} of ${interfaceRows.length}`, `${down} unused port${down === 1 ? "" : "s"} down`, GRN),
      kp("Internet link", wan ? `${wan.alias || wan.name} · ${wan.speed ? `${wan.speed >= 1000 ? `${wan.speed / 1000} Gbps` : `${wan.speed} Mbps`}` : "up"}` : "—", wan ? `${fmtBytes(Number(wan.rx_bytes || 0) + Number(wan.tx_bytes || 0))} since last reboot` : "no WAN link detected"),
      kp("Top policy today", topPolicy ? fmtBytes(topPolicy.traffic_bytes) : "—", topPolicy ? `${pct(topPolicy.traffic_bytes, traffic)}% via ${topPolicy.name}` : ""),
      kp("Top destination", countries[0]?.name || "—", countries[0] ? `${fmtBytes(countries[0].traffic_bytes)} from ${n(countries[0].records)} sessions` : "", odd && odd === countries[0] ? RED : INK),
      kp("Outbound SSH", ssh ? fmtBytes(ssh.traffic_bytes) : "0", ssh ? `${n(ssh.records)} sessions · ${ssh.sources} devices` : "none today", ssh ? AMB : GRN),
    ];
    const noIp = interfaceRows.filter((r) => (r.link === true || r.link === "up") && (!r.ip || r.ip === "0.0.0.0") && Number(r.rx_bytes || 0) + Number(r.tx_bytes || 0) > 1e12);
    t.insights = [
      odd
        ? ins("c", "Unusual", `${odd.name} gets ${fmtBytes(odd.traffic_bytes)} from just ${n(odd.records)} sessions`, `${fmtBytes(perSession(odd))} per session vs ${fmtBytes(median)} typical — the pattern of a tunnel or bulk transfer. Cross-check with the Applications tab.`)
        : ins("g", "Destinations", "No unusual destination pattern", "Traffic per session is in line across countries."),
      dot
        ? ins("h", "Filter bypass", `Port 853 (DNS-over-TLS) used by ${dot.sources} device${dot.sources === 1 ? "" : "s"}`, `Encrypted DNS skips the DNS filter${security ? ` — only ${security.sensors.dns} DNS-filter event${security.sensors.dns === 1 ? " was" : "s were"} logged` : ""}. Block 853 outbound.`)
        : ins("g", "Filter bypass", "No encrypted-DNS bypass seen", "Port 853 is not in today’s traffic."),
      noIp.length
        ? ins("m", "Config", `${noIp[0].name} carries ${fmtBytes(Number(noIp[0].rx_bytes || 0) + Number(noIp[0].tx_bytes || 0))} but has no IP`, "Probably a bridged or unlabelled link — name it and confirm it’s intended.")
        : ins("g", "Config", "Every active link has an address", "No unlabelled high-traffic ports."),
    ];
    const linkRows = [...up].sort((a, b) => Number(b.rx_bytes || 0) + Number(b.tx_bytes || 0) - (Number(a.rx_bytes || 0) + Number(a.tx_bytes || 0))).slice(0, 8)
      .map((r) => [r.alias || r.name, `${r.name}${r.ip && r.ip !== "0.0.0.0" ? ` · ${r.ip}` : " · no IP"}${r.speed ? ` · ${r.speed >= 1000 ? `${r.speed / 1000} Gbps` : `${r.speed} Mbps`}` : ""}`, Number(r.rx_bytes || 0), Number(r.tx_bytes || 0), /wan/i.test(r.name) ? { tag: "WAN", tagCls: "bg-[#e8f0fc] text-[#1d4f9e]" } : (!r.ip || r.ip === "0.0.0.0") ? { tag: "check" } : r.speed && r.speed < 1000 ? { tag: `${r.speed} Mbps`, tagCls: SEV.h[0] } : {}]);
    const PORT_NAMES = { 443: "HTTPS", 80: "HTTP", 22: "SSH", 53: "DNS", 853: "DNS-over-TLS", 123: "NTP", 4500: "IPsec VPN", 500: "IKE", 5223: "Apple push", 5228: "Google Play", 5222: "XMPP", 993: "IMAPS", 3478: "STUN", 3389: "RDP" };
    const ports = [...(agg.destination_ports || [])].sort((a, b) => b.traffic_bytes - a.traffic_bytes).slice(0, 8);
    t.panels = [
      { title: "Links since last reboot", sub: "Received vs sent per interface", lw: "1.3fr", legend: [{ l: "Received", c: BLU }, { l: "Sent", c: "#1b8a8f" }], rows: split(linkRows, BLU, "#1b8a8f"), note: "" },
      { title: "Where traffic goes · today", sub: "Destination country · sessions", lw: "1fr", legend: [], rows: bars(countries.slice(0, 8).map((c) => [c.name, `${n(c.records)} sessions · ${n(c.destinations)} hosts`, c.traffic_bytes, c === odd ? { tag: "tunnel?", c: RED } : {}]), BLU, fmtBytes), note: "" },
      { title: "Ports in use · today", sub: "What each port means", lw: "1.2fr", legend: [], rows: bars(ports.map((p) => [`${p.name} · ${PORT_NAMES[p.name] || "other"}`, `${n(p.records)} sessions · ${p.sources} device${p.sources === 1 ? "" : "s"}`, p.traffic_bytes, String(p.name) === "22" ? { tag: "review", tagCls: SEV.h[0], c: ORG } : String(p.name) === "853" ? { tag: "bypass", c: RED } : {}]), BLU, fmtBytes), note: "" },
      { title: "Policies matched · today", sub: `${(agg.actions || []).filter((a) => /deny|block/i.test(a.name)).reduce((s, a) => s + a.records, 0) ? "Some sessions denied" : "All sessions accepted — nothing blocked"}`, lw: "1fr", legend: [], rows: bars(policies.map((p) => [p.name, `${n(p.records)} sessions`, p.traffic_bytes]), BLU, fmtBytes), note: (agg.actions || []).some((a) => /deny|block/i.test(a.name)) ? "" : "Every session was accepted. Add deny rules for risky apps and bypass ports." },
    ];
  }

  // ---- security
  {
    const t = T("events");
    const sev = security?.severity || {};
    const days = security?.daily || [];
    t.kpis = [
      kp("Events in window", n(security?.total ?? eventCount), security ? `${n(sev.alert)} alert · ${n(sev.information)} info · ${n(sev.notice)} notice` : "loading…"),
      kp("Failed admin logins", n(bf?.failed || 0), bf ? `${n(bf.source_ips)} IPs · ${new Set(bf.origins.map((o) => o.country).filter(Boolean)).size} countries` : "", bf?.failed ? RED : GRN),
      kp("Successful admin logins", n(bf?.succeeded || 0), bf?.succeeded ? "verify these were your admins" : "no admin sign-ins logged", bf?.succeeded ? AMB : GRN),
      kp("IPS · antivirus events", `${n(security?.sensors.ips || 0)} · ${n(security?.sensors.antivirus || 0)}`, sensorsSilent ? "sensors not logging" : "sensors reporting", sensorsSilent ? AMB : GRN),
      kp("Retained window", security?.first_event_at ? `${dm(security.first_event_at)} → ${dm(security.last_event_at)}` : "—", data?.section_meta?.events?.records_available ? `${n(security?.total)} of ${n(data.section_meta.events.records_available)} available (API limit)` : ""),
    ];
    const alerts = sev.alert || 0;
    const noise = security ? security.groups.filter((g) => g.severity === "information" || g.severity === "notice") : [];
    t.insights = [
      topGroup && alerts
        ? ins("c", `One incident, not ${n(alerts)}`, `Nearly every alert is the same “${topGroup.title}”`, `${n(topGroup.count)} of ${n(alerts)} alerts are “${topGroup.title}”. Handle it once — the remaining ${n(alerts - topGroup.count)} alerts are ordinary.`)
        : ins("g", "Alerts", "No alert-level events", "The retained window has no alerts."),
      sensorsSilent
        ? ins("h", "Blind spot", "IPS and antivirus logged 0 events", "Profiles aren’t applied to policies or logging is off. “0 threats” here means “not measured”.")
        : ins("g", "Sensors", "IPS and antivirus are reporting", `${n(security?.sensors.ips || 0)} IPS · ${n(security?.sensors.antivirus || 0)} antivirus events.`),
      ins("m", "Noise", `${n(noise.reduce((a, g) => a + g.count, 0))} info/notice events need no action`, noise.slice(0, 3).map((g) => `${g.title} (${n(g.count)})`).join(", ") + (noise.length ? " — roll them up or suppress." : "")),
    ];
    t.incident = bf && bf.failed ? {
      headline: `${n(bf.failed)} failed admin logins from ${n(bf.source_ips)} public IPs. ${n(bf.succeeded)} succeeded.`,
      topSource: bf.top_sources[0]?.ip || "—",
      rate: security.first_event_at ? `~${n(Math.round(bf.failed / Math.max(1, (new Date(security.last_event_at) - new Date(security.first_event_at)) / 3600000)))} / hour` : "—",
      since: security.first_event_at ? dm(security.first_event_at) : "—",
      subnets: [...new Set(bf.top_sources.map((s) => s.ip.split(".").slice(0, 3).join(".") + ".0/24"))].slice(0, 2),
      countries: [...new Set(bf.origins.map((o) => o.country_code).filter(Boolean))].slice(0, 3),
    } : null;
    if (security?.hourly?.length)
      t.charts.push(chart("Events by hour · last 24 hours", "IST", [{ l: "Alert", c: "#d4553a" }, { l: "Info", c: BLU }, { l: "Notice", c: "#e0b44a" }], security.hourly.map((h, i) => ({ l: i % 3 === 0 ? clock(h.hour).slice(0, 2) : "", vals: [h.alert + h.warning, h.information, h.notice], tip: `${clock(h.hour)} · ${n(h.alert + h.warning)} alerts · ${n(h.information)} info · ${n(h.notice)} notice` })), (() => {
        const a = security.hourly.map((h) => h.alert).filter(Boolean);
        const avg = a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
        const flat = a.length >= 12 && a.every((v) => Math.abs(v - avg) < avg * 0.5);
        return flat ? `A flat ~${n(Math.round(avg))} alerts every hour, day and night = automated attack, not users.` : "Alert volume by hour over the last day.";
      })()));
    if (bf?.origins?.length)
      t.panels.push({ title: "Where the attack comes from", sub: "Failed admin logins by origin", lw: "1.3fr", legend: [], rows: bars(bf.origins.map((o) => [o.city ? `${o.city}, ${o.country_code || o.country}` : "Location not resolved", `${o.ips} IP${o.ips === 1 ? "" : "s"}${o.asn ? ` · AS${o.asn}` : ""}${o.organization ? ` · ${o.organization}` : ""}`, o.count, { c: RED }]), RED), note: "Block by ASN, not country — these are rented servers." });
    if (security)
      t.panels.push({ title: "Is every sensor reporting?", sub: "Events per source · retained window", lw: "1fr", legend: [], rows: bars([["System events", "firewall & admin", security.total, { c: GRN }], ["Web filter", "URL categories", security.sensors.web, { c: security.sensors.web ? GRN : RED, ...(security.sensors.web ? {} : { tag: "silent" }) }], ["DNS filter", dot ? "bypassed via port 853" : "DNS categories", security.sensors.dns, security.sensors.dns < 10 ? { tag: "low", tagCls: SEV.h[0], c: ORG } : { c: GRN }], ["Antivirus", security.sensors.antivirus ? "" : "no profile applied?", security.sensors.antivirus, security.sensors.antivirus ? { c: GRN } : { tag: "silent", c: RED }], ["Intrusion prevention", security.sensors.ips ? "" : "no profile applied?", security.sensors.ips, security.sensors.ips ? { c: GRN } : { tag: "silent", c: RED }]], GRN), note: "" });
    if (days.length) {
      const mx = Math.max(1, ...days.map((d) => d.alerts + d.other));
      const peakDay = [...days].sort((a, b) => b.alerts - a.alerts)[0];
      t.panels.push({ title: "Events by day", sub: `Retained window ${dm(days[0].date)} → ${dm(days[days.length - 1].date)}`, lw: ".8fr", legend: [{ l: "Alerts", c: "#d4553a" }, { l: "Other", c: BLU }], rows: days.map((d) => row(new Date(`${d.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }), d === peakDay ? "peak" : "", n(d.alerts + d.other), [{ w: (d.alerts / mx) * 100, c: "#d4553a" }, { w: (d.other / mx) * 100, c: BLU }])), note: peakDay ? `${dm(peakDay.date)} had ${n(peakDay.alerts)} alerts — the busiest day in the window.` : "" });
    }
  }

  // ---- archive
  {
    const t = T("archive");
    t.missing = null;
    if (archives) {
    const list = archives;
    const byDate = new Map(list.map((a) => [a.date, a]));
    const today = istDate(now);
    const [y, m] = today.split("-").map(Number);
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const todayNum = Number(today.slice(8, 10));
    let missing = 0;
    let capped = 0;
    const monthRows = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const a = byDate.get(key);
      if (d <= todayNum && !a) missing++;
      if (a && Number(a.summary?.stored_records || 0) >= Number(a.record_limit || 50000)) capped++;
      monthRows.push({ d, key, a, future: d > todayNum });
    }
    const maxTraffic = Math.max(1, ...monthRows.filter((r) => r.a).map((r) => Number(r.a.summary?.traffic_bytes || 0)));
    const lead = (monthStart.getUTCDay() + 6) % 7;
    const cells = Array.from({ length: lead }, () => ({ empty: true }));
    monthRows.forEach(({ d, key, a, future }) => {
      if (!a) {
        cells.push({ n: d, v: future ? "" : "—", missing: !future, future, tip: `${dm(`${key}T12:00:00+05:30`)} · ${future ? "upcoming" : "no archive"}` });
        return;
      }
      const tb = Number(a.summary?.traffic_bytes || 0);
      const alpha = 0.12 + (tb / maxTraffic) * 0.88;
      const isCapped = Number(a.summary?.stored_records || 0) >= Number(a.record_limit || 50000);
      cells.push({ n: d, v: fmtBytes(tb), bg: `rgba(47,107,208,${alpha.toFixed(2)})`, fg: alpha > 0.55 ? "#fff" : INK, cap: isCapped, tip: `${dm(`${key}T12:00:00+05:30`)} · ${fmtBytes(tb)} · ${n(a.summary?.stored_records)} records · ${n(a.summary?.unique_sources)} systems` });
    });
    while (cells.length % 7) cells.push({ empty: true });
    const stored = list.reduce((s, a) => s + Number(a.summary?.stored_records || 0), 0);
    const storedTraffic = list.reduce((s, a) => s + Number(a.summary?.traffic_bytes || 0), 0);
    const blocked = list.reduce((s, a) => s + Number(a.summary?.blocked || 0), 0);
    const threats = list.reduce((s, a) => s + Number(a.summary?.threats || 0), 0);
    const monthName = monthStart.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
    const gapDays = monthRows.filter((r) => !r.future && !r.a).map((r) => r.d);
    const cappedDays = monthRows.filter((r) => r.a && Number(r.a.summary?.stored_records || 0) >= Number(r.a.record_limit || 50000)).map((r) => r.d);
    const firstApps = list.filter((a) => Number(a.summary?.applications || 0) > 0).map((a) => a.date).sort()[0];
    t.kpis = [
      kp("Archived days", n(list.length), list.length ? `${dm(list.map((a) => a.date).sort()[0])} → ${dm(list.map((a) => a.date).sort().at(-1))}` : "none yet"),
      kp(`Missing days · ${monthName.slice(0, 3)}`, n(missing), missing ? "no archive saved" : "every day captured", missing ? RED : GRN),
      kp("Days hit record cap", n(capped), capped ? "stopped at the record limit" : "none truncated", capped ? AMB : GRN),
      kp("Stored records", stored >= 1e6 ? `${(stored / 1e6).toFixed(2)}M` : n(stored), `${fmtBytes(storedTraffic)} traffic`),
      kp("Blocked · threats", `${n(blocked)} · ${n(threats)}`, blocked || threats ? "across all archived days" : "every single day", blocked || threats ? INK : AMB),
    ];
    const ranges = (daysList) => {
      const out = [];
      daysList.forEach((d) => {
        const last = out[out.length - 1];
        if (last && last[1] === d - 1) last[1] = d;
        else out.push([d, d]);
      });
      return out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
    };
    t.insights = [
      gapDays.length
        ? ins("c", "Gap", `No archive for ${ranges(gapDays)} ${monthName.slice(0, 3)}`, "Anything that happened on those days can’t be investigated. Backfill from FortiAnalyzer if available.")
        : ins("g", "Coverage", `Every day of ${monthName} so far is archived`, "No gaps in the daily archive."),
      cappedDays.length
        ? ins("h", "Truncated", `${cappedDays.length} day${cappedDays.length === 1 ? "" : "s"} stopped at the record cap`, `${ranges(cappedDays)} ${monthName.slice(0, 3)} hit the limit, so later events those days are missing. Raise the cap or archive hourly.`)
        : ins("g", "Truncated", "No day hit the record cap", "Every archive holds its full record set."),
      firstApps
        ? ins("m", "Coverage", `App identification since ${dm(firstApps)}`, "Earlier days show 0 identified apps — compare app trends from that date onward.")
        : ins("m", "Coverage", "No app identification in archives yet", "Application Control data will appear in new archives."),
    ];
    t.cal = cells;
    t.calTitle = `${monthName} at a glance`;
    t.missing = missing;
    }
  }

  const badge = {
    overview: actions.length ? [`${actions.length} to fix`, actions.some((a) => a[1] === "c") ? "c" : "h"] : ["All clear", "g"],
    devices: [`${pct(mapped, deviceList.length)}% known`, pct(mapped, deviceList.length) < 50 ? "c" : "g"],
    applications: criticalApps.length ? [`${criticalApps.length} critical`, "c"] : [`${identifiedApps.length} apps`, "g"],
    interfaces: [`${up.length} up`, "g"],
    events: [n(security?.total ?? eventCount), bf?.failed ? "c" : "g"],
    archive: tabs.archive.missing == null ? ["", "m"] : [`${tabs.archive.missing} gap${tabs.archive.missing === 1 ? "" : "s"}`, tabs.archive.missing ? "h" : "g"],
  };
  return { tabs, badge, actions };
}

// ------------------------------------------------------------------ views

export function FwSiteHeader({ title, statusLabel, statusTone, sub, sites, active, onSite, onRefresh, refreshing, onReport, reporting }) {
  const tone = { green: "bg-[#e4f3ec] text-[#12795a]", red: "bg-[#fdeaea] text-[#b42318]", amber: "bg-[#fdf3dc] text-[#8a5a00]", gray: "bg-[#f1f0ec] text-[#55555e]" }[statusTone] || "bg-[#f1f0ec] text-[#55555e]";
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-[3px]">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 text-[21px] font-semibold tracking-[-.01em]">{title}</h2>
          <span className={`rounded-full px-[9px] py-[3px] text-[11.5px] font-medium ${tone}`}>● {statusLabel}</span>
        </div>
        <div className="truncate text-[12.5px] text-[#6b6b76]">{sub}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded-[9px] bg-[#ebeae6] p-[3px]">
          {sites.map((s) => (
            <button key={s.id} onClick={() => onSite(s.id)} className={`flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium ${active === s.id ? "bg-white text-[#17171c] shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-[#6b6b76]"}`}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
              {s.label}
            </button>
          ))}
        </div>
        <button onClick={onRefresh} disabled={refreshing} className="rounded-[9px] border border-[#e0dfdb] bg-white px-3 py-[7px] text-[12.5px] text-[#17171c] disabled:opacity-60">{refreshing ? "Refreshing…" : "Refresh"}</button>
        <button onClick={onReport} disabled={reporting} className="rounded-[9px] bg-[#17171c] px-3.5 py-2 text-[12.5px] font-medium text-white disabled:opacity-60">{reporting ? "Exporting…" : "7-day report"}</button>
      </div>
    </header>
  );
}

export function FwSiteDown({ site, downtime, raiseTicket, onBack }) {
  const since = downtime?.current?.state_since;
  const last = downtime?.current_outage?.pre_downtime_snapshot || downtime?.last_outage?.pre_downtime_snapshot;
  const steps = [
    `Check power and the WAN link at the ${site} rack`,
    `Confirm the ${site} FortiGate answers from HQ over the site-to-site VPN`,
    `Re-issue the API token if it has expired`,
    `Once back, backfill the missing days from FortiAnalyzer`,
  ];
  return (
    <section className="flex max-w-[760px] flex-col gap-3.5 rounded-[14px] border border-[#f1d3d0] bg-white p-[26px]">
      <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#b42318]">{site} is unreachable</span>
      <span className="text-xl font-semibold leading-snug">No data from {site}{since ? ` for ${dur(Date.now() - new Date(since))}` : ""} — the site is currently invisible.</span>
      <span className="leading-relaxed text-[#55555e]">
        {since ? `Last contact ${dm(since)}, ${clock(since)}` : "No successful contact recorded"}
        {last ? ` (final report: ${n(last.stored_records)} records).` : "."} Zero devices here means missing data, not an empty office.
      </span>
      {steps.map((t, i) => (
        <div key={t} className="flex items-start gap-2.5"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#f1f0ec] text-[11px] font-semibold">{i + 1}</span><span className="leading-normal text-[#3b3b44]">{t}</span></div>
      ))}
      <div className="flex flex-wrap gap-2">
        {raiseTicket}
        <button onClick={onBack} className="rounded-lg border border-[#e0dfdb] bg-white px-3.5 py-[9px] text-[12.5px]">Show last known data</button>
      </div>
    </section>
  );
}

export function FwTabBar({ tabs, active, onSelect }) {
  return (
    <div className="sticky top-[72px] z-[5] grid gap-0.5 rounded-[11px] border border-[#e8e7e3] bg-white p-1" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button key={t.key} onClick={() => onSelect(t.key)} className={`flex items-center justify-center gap-[7px] whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium ${on ? "bg-[#17171c] text-white" : "text-[#55555e]"}`}>
            {t.label}
            {t.badge && <span className={`whitespace-nowrap rounded-full px-[7px] py-px text-[10.5px] ${on ? "bg-white/20 text-white" : SEV[t.tone]?.[0] || SEV.m[0]}`}>{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function FwKpis({ kpis }) {
  return (
    <section className="flex flex-wrap gap-2">
      {kpis.map((k) => (
        <div key={k.l} className="flex min-w-0 flex-[1_1_150px] flex-col gap-1 rounded-[10px] border border-[#e8e7e3] bg-white px-3.5 py-3">
          <span className="text-[11.5px] text-[#6b6b76]">{k.l}</span>
          <span className="text-xl font-semibold tracking-[-.02em]" style={{ color: k.c }}>{k.v}</span>
          <span className="text-[11.5px] leading-snug text-[#6b6b76]">{k.s}</span>
        </div>
      ))}
    </section>
  );
}

export function FwInsights({ items }) {
  return (
    <section className="flex flex-wrap gap-3">
      {items.map((i) => (
        <div key={i.tag + i.h} className={`flex min-w-0 flex-[1_1_280px] flex-col gap-1.5 rounded-xl border bg-white px-4 py-3.5 ${SEV[i.k][2]}`}>
          <span className="text-[10.5px] font-semibold uppercase tracking-[.05em]" style={{ color: SEV[i.k][1] }}>{i.tag}</span>
          <span className="font-semibold leading-snug">{i.h}</span>
          <span className="text-[12.5px] leading-normal text-[#55555e]">{i.b}</span>
        </div>
      ))}
    </section>
  );
}

export function FwActions({ actions, sub, onGo }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#e8e7e3] bg-white">
      <div className="flex flex-col gap-[3px] px-[18px] pb-2 pt-3.5"><h3 className="m-0 text-sm font-semibold">Fix these, in this order</h3><span className="text-xs text-[#6b6b76]">{sub}</span></div>
      {actions.map((a) => (
        <div key={a.t} className="grid items-center gap-3.5 border-t border-[#f1f0ec] px-[18px] py-[11px]" style={{ gridTemplateColumns: "28px minmax(0,1fr) auto" }}>
          <span className={`grid h-[26px] w-[26px] place-items-center rounded-full text-xs font-semibold ${SEV[a.k][0]}`}>{a.n}</span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{a.t}</span><span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${SEV[a.k][0]}`}>{a.sev}</span></div>
            <span className="text-[12.5px] leading-snug text-[#55555e]">{a.d}</span>
          </div>
          <button onClick={() => onGo(a.go)} className="whitespace-nowrap rounded-lg border border-[#e0dfdb] bg-white px-3 py-1.5 text-[12.5px]">{a.cta}</button>
        </div>
      ))}
      {!actions.length && <div className="border-t border-[#f1f0ec] px-[18px] py-4 font-medium text-[#12795a]">Nothing to fix right now.</div>}
    </section>
  );
}

function Legend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 text-[11.5px] text-[#55555e]">
      {items.map((l) => <span key={l.l} className="flex items-center gap-[5px]"><span className="h-[9px] w-[9px] rounded-sm" style={{ background: l.c }} />{l.l}</span>)}
    </div>
  );
}

export function FwChartsAndPanels({ charts, panels }) {
  if (!charts.length && !panels.length) return null;
  return (
    <section className="flex flex-wrap items-start gap-3">
      {charts.map((ch) => (
        <div key={ch.title} className="flex min-w-0 shrink-0 grow-0 basis-full flex-col gap-2.5 rounded-xl border lg:basis-[calc(50%-6px)] min-[1500px]:basis-[calc(33.333%-8px)] border-[#e8e7e3] bg-white px-[18px] py-4">
          <div className="flex flex-wrap justify-between gap-2.5"><div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">{ch.title}</h3><span className="text-xs text-[#6b6b76]">{ch.sub}</span></div><Legend items={ch.legend} /></div>
          <div className="grid h-[130px] items-end gap-[3px] border-b border-[#e8e7e3]" style={{ gridTemplateColumns: `repeat(${ch.cols.length},minmax(0,1fr))` }}>
            {ch.cols.map((col, i) => (
              <div key={i} title={col.tip} className="flex h-full flex-col-reverse justify-start">
                {col.segs.map((sg, j) => <div key={j} style={{ height: sg.h, background: sg.c }} />)}
              </div>
            ))}
          </div>
          <div className="-mt-[5px] grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${ch.cols.length},minmax(0,1fr))` }}>
            {ch.cols.map((col, i) => <span key={i} className="overflow-visible whitespace-nowrap text-left text-[10px] text-[#8a8a93]">{col.l}</span>)}
          </div>
          {ch.note && <span className="rounded-[7px] bg-[#f7f6f3] px-2.5 py-2 text-xs leading-normal text-[#3b3b44]">{ch.note}</span>}
        </div>
      ))}
      {panels.map((p) => (
        <div key={p.title} className="flex min-w-0 flex-[1_1_380px] flex-col gap-[9px] rounded-xl border border-[#e8e7e3] bg-white px-[18px] py-4">
          <div className="flex flex-wrap justify-between gap-2.5"><div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">{p.title}</h3><span className="text-xs text-[#6b6b76]">{p.sub}</span></div>{p.legend.length > 0 && <Legend items={p.legend} />}</div>
          {p.rows.map((r) => (
            <div key={r.l + r.sub} title={r.tip} className="grid items-center gap-3" style={{ gridTemplateColumns: `minmax(0,${p.lw}) minmax(0,1fr) 64px` }}>
              <div className="flex min-w-0 flex-col leading-tight">
                <div className="flex min-w-0 items-center gap-1.5"><span className="truncate font-medium">{r.l}</span>{r.tag && <span className={`whitespace-nowrap rounded px-1.5 py-px text-[10px] font-semibold ${r.tagCls}`}>{r.tag}</span>}</div>
                <span className="truncate text-[11px] text-[#8a8a93]">{r.sub}</span>
              </div>
              <div className="flex h-[9px] overflow-hidden rounded-[5px] bg-[#f1f0ec]">{r.segs.map((sg, j) => <div key={j} style={{ width: `${sg.w}%`, background: sg.c }} />)}</div>
              <span className="text-right font-semibold tabular-nums" style={{ color: r.vc }}>{r.v}</span>
            </div>
          ))}
          {!p.rows.length && <span className="text-[#8a8a93]">No data in the current window.</span>}
          {p.note && <span className="rounded-[7px] bg-[#f7f6f3] px-2.5 py-2 text-xs leading-normal text-[#3b3b44]">{p.note}</span>}
        </div>
      ))}
    </section>
  );
}

export function FwDeviceCoverage({ coverage, funnel, note }) {
  return (
    <section className="flex flex-wrap items-center gap-[18px] rounded-xl border border-[#e8e7e3] bg-white px-[18px] py-4">
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-[5px]"><span className="text-xs text-[#6b6b76]">Devices with a known owner</span><div className="flex items-baseline gap-2"><span className="text-[32px] font-semibold tracking-[-.02em]" style={{ color: coverage.color }}>{coverage.pct}</span><span className="text-[#6b6b76]">{coverage.of}</span></div><span className="text-[12.5px] leading-normal text-[#55555e]">If an unowned device misbehaves, nobody can be contacted.</span></div>
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2">
        {funnel.map((f) => (
          <div key={f.l} className="grid items-end gap-2.5" style={{ gridTemplateColumns: "minmax(0,1fr) 44px" }}><div className="flex flex-col gap-1"><span className="text-xs text-[#3b3b44]">{f.l}</span><div className="h-[9px] overflow-hidden rounded-[5px] bg-[#f1f0ec]"><div className="h-full rounded-[5px]" style={{ width: `${f.pct}%`, background: f.c }} /></div></div><span className="text-right font-semibold tabular-nums">{n(f.v)}</span></div>
        ))}
      </div>
      <div className="flex min-w-0 flex-[1_1_220px] flex-col items-start gap-2"><span className="text-xs leading-normal text-[#55555e]">{note}</span></div>
    </section>
  );
}

export function FwAppComposition({ title, comp }) {
  if (!comp.length) return null;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[#e8e7e3] bg-white px-[18px] py-4">
      <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">{title}</h3><span className="text-xs text-[#6b6b76]">Grouped by purpose, not firewall category names</span></div>
      <div className="flex h-[34px] gap-0.5 overflow-hidden rounded-lg">
        {comp.map((c) => <div key={c.l} title={`${c.l} · ${c.v} · ${c.pctL}`} className="flex min-w-1.5 items-center overflow-hidden whitespace-nowrap pl-2 text-[11.5px] font-semibold text-white" style={{ width: `${c.w}%`, background: c.c }}>{c.inner}</div>)}
      </div>
      <div className="flex flex-wrap gap-2.5">
        {comp.map((c) => (
          <div key={c.l} className="flex min-w-0 flex-[1_1_200px] flex-col gap-2 rounded-[10px] border border-[#efeeea] px-3 py-2.5" style={{ borderTop: `3px solid ${c.c}` }}>
            <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{c.l}</span><span className="whitespace-nowrap text-xs text-[#55555e]"><strong className="font-semibold text-[#17171c]">{c.v}</strong> · {c.pctL}</span></div>
            {c.list.map((a) => (
              <div key={a.n} className="grid items-center gap-2" style={{ gridTemplateColumns: "22px minmax(0,1fr) auto" }}>
                <span className="grid h-5 w-5 place-items-center rounded-[5px] text-[10px] font-bold text-white" style={{ background: c.c }}>{a.n[0]}</span>
                <span className="truncate">{a.n}</span>
                <span className="text-xs tabular-nums text-[#55555e]">{a.v}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function FwIncident({ incident, steps, onToggle }) {
  const done = steps.filter((s) => s.done).length;
  const status = done === 0 ? ["Unresolved", SEV.c[0]] : done < steps.length ? [`Mitigating · ${done}/${steps.length}`, SEV.h[0]] : ["Contained", SEV.g[0]];
  return (
    <section className="flex flex-wrap gap-[18px] rounded-xl border border-[#f1d3d0] bg-white px-[18px] py-4">
      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2.5"><span className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#b42318]">Ongoing incident · brute-force on firewall admin</span><span className={`whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11.5px] font-medium ${status[1]}`}>{status[0]}</span></div>
        <span className="text-[17px] font-semibold leading-snug">{incident.headline}</span>
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-0.5 rounded-[9px] border border-[#efeeea] px-[11px] py-[9px]"><span className="text-[11px] text-[#6b6b76]">Top source</span><span className="font-mono text-[12.5px] font-semibold text-[#b42318]">{incident.topSource}</span></div>
          <div className="flex flex-col gap-0.5 rounded-[9px] border border-[#efeeea] px-[11px] py-[9px]"><span className="text-[11px] text-[#6b6b76]">Rate</span><span className="font-semibold">{incident.rate}</span></div>
          <div className="flex flex-col gap-0.5 rounded-[9px] border border-[#efeeea] px-[11px] py-[9px]"><span className="text-[11px] text-[#6b6b76]">Since</span><span className="font-semibold">{incident.since}</span></div>
        </div>
      </div>
      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-1">
        <span className="mb-1 font-semibold">Response checklist</span>
        {steps.map((s, i) => (
          <button key={s.t} onClick={() => onToggle(i)} className="flex items-start gap-2.5 py-[5px] text-left">
            <span className={`mt-px grid h-4 w-4 shrink-0 place-items-center rounded text-[10px] text-white ${s.done ? "bg-[#12795a]" : "border-[1.5px] border-[#d6d4ce] bg-white"}`}>{s.done ? "✓" : ""}</span>
            <span className={`leading-snug ${s.done ? "text-[#8a8a93] line-through" : "text-[#3b3b44]"}`}>{s.t}</span>
          </button>
        ))}
        <span className="mt-1 text-[11px] text-[#8a8a93]">Checklist progress is saved in this browser.</span>
      </div>
    </section>
  );
}

export function FwArchiveCalendar({ title, cells }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[#e8e7e3] bg-white px-[18px] py-4">
      <div className="flex flex-wrap justify-between gap-2.5">
        <div className="flex flex-col gap-[3px]"><h3 className="m-0 text-sm font-semibold">{title}</h3><span className="text-xs text-[#6b6b76]">Each day = traffic archived. Grey = no archive. Dot = hit the record cap.</span></div>
        <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-[#55555e]">
          <span className="flex items-center gap-[5px]"><span className="h-3 w-3 rounded-[3px]" style={{ background: "rgba(47,107,208,.2)" }} />Light</span>
          <span className="flex items-center gap-[5px]"><span className="h-3 w-3 rounded-[3px] bg-[#2f6bd0]" />Heavy</span>
          <span className="flex items-center gap-[5px]"><span className="box-border h-3 w-3 rounded-[3px] border border-dashed border-[#d6d4ce] bg-[#f1f0ec]" />Missing</span>
        </div>
      </div>
      <div className="grid max-w-[720px] grid-cols-7 gap-[5px]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((h) => <span key={h} className="text-center text-[10.5px] text-[#8a8a93]">{h}</span>)}
        {cells.map((d, i) => d.empty ? <div key={i} /> : (
          <div key={i} title={d.tip} className={`relative box-border flex h-[46px] flex-col justify-between rounded-[7px] px-[7px] py-[5px] ${d.missing ? "border border-dashed border-[#d6d4ce] bg-[#f1f0ec] text-[#9a9aa3]" : d.future ? "bg-[#f7f6f3] text-[#b9b7b0]" : ""}`} style={d.bg ? { background: d.bg, color: d.fg } : undefined}>
            <span className="text-[11px] font-semibold">{d.n}</span>
            <span className="text-[10.5px]">{d.v}</span>
            {d.cap && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#e0822f]" />}
          </div>
        ))}
      </div>
    </section>
  );
}

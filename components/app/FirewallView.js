"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/appapi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Activity,
  AlertTriangle,
  Cable,
  ChevronDown,
  Clock3,
  FileText,
  Download,
  LockKeyhole,
  MapPin,
  Network,
  RefreshCw,
  Router,
  Server,
  Shield,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";
import { RaiseTicket } from "@/components/app/TicketsView";
import { AppSelect } from "@/components/ui/select";
import { DateField } from "@/components/ui/date-field";
import {
  buildFirewallModel,
  FwActions,
  FwAppComposition,
  FwArchiveCalendar,
  FwChartsAndPanels,
  FwDeviceCoverage,
  FwIncident,
  FwInsights,
  FwKpis,
  FwSiteDown,
  FwSiteHeader,
  FwTabBar,
} from "@/components/app/FirewallDesign";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TABS = [
  ["overview", "Overview"],
  ["devices", "Devices"],
  ["applications", "Applications"],
  ["interfaces", "Interfaces"],
  ["events", "Security"],
  ["archive", "Daily archive"],
];

const CHART_COLORS = [
  "#4F6EF7",
  "#0D9C6F",
  "#7C3AED",
  "#EA580C",
  "#C026D3",
  "#B7791F",
  "#98A0B3",
];

const APPLICATION_TONES = [
  "border-blue-200 bg-blue-50 text-blue-700",
  "border-emerald-200 bg-emerald-50 text-emerald-700",
  "border-violet-200 bg-violet-50 text-violet-700",
  "border-orange-200 bg-orange-50 text-orange-700",
  "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  "border-cyan-200 bg-cyan-50 text-cyan-700",
  "border-amber-200 bg-amber-50 text-amber-800",
  "border-rose-200 bg-rose-50 text-rose-700",
  "border-indigo-200 bg-indigo-50 text-indigo-700",
  "border-teal-200 bg-teal-50 text-teal-700",
];

const EMPTY_FIREWALL_ROWS = [];

const BANDWIDTH_RANGES = [
  ["today", "Today whole day"],
  ["1h", "Last 1 hour"],
  ["24h", "Last 24 hours"],
];

function bandwidthQuery(range) {
  if (range === "1h") return "hours=1";
  if (range === "24h") return "hours=24";
  return "today=true";
}

function bandwidthRangeLabel(range) {
  return (
    BANDWIDTH_RANGES.find(([value]) => value === range)?.[1] ||
    "Today whole day"
  );
}

function applicationTone(category, name) {
  const key = String(category || name || "Unclassified");
  const hash = [...key].reduce((total, character) => total + character.charCodeAt(0), 0);
  return APPLICATION_TONES[hash % APPLICATION_TONES.length];
}

const listFrom = (value) =>
  Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : Array.isArray(value?.data)
        ? value.data
        : Array.isArray(value?.results)
          ? value.results
          : [];
const numberFrom = (value, keys, fallback = 0) => {
  for (const key of keys) {
    const found = key
      .split(".")
      .reduce((current, part) => current?.[part], value);
    if (found !== undefined && found !== null && !Number.isNaN(Number(found)))
      return Number(found);
  }
  return fallback;
};
const textFrom = (value, keys, fallback = "—") => {
  for (const key of keys) {
    const found = key
      .split(".")
      .reduce((current, part) => current?.[part], value);
    if (["string", "number", "boolean"].includes(typeof found))
      return String(found);
  }
  return fallback;
};
const firewallMacKey = (value) => {
  const compact = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "");
  return compact.length === 12
    ? compact
    : String(value || "").trim().toLowerCase();
};

function firewallLocalDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatUsageRangeTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function firewallEventTimestamp(row) {
  const raw =
    row?.eventtime ??
    row?.timestamp ??
    row?.datetime ??
    row?.time_stamp ??
    null;
  if (raw !== null && raw !== "") {
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      const value =
        numeric > 1e15
          ? numeric / 1e6
          : numeric > 1e12
            ? numeric
            : numeric * 1000;
      const timestamp = new Date(value);
      if (!Number.isNaN(timestamp.getTime())) return timestamp;
    }
    const timestamp = new Date(raw);
    if (!Number.isNaN(timestamp.getTime())) return timestamp;
  }
  if (row?.date) {
    const combined = `${row.date}T${row.time || "00:00:00"}+05:30`;
    const timestamp = new Date(combined);
    if (!Number.isNaN(timestamp.getTime())) return timestamp;
  }
  return null;
}

function EmptyPanel({ title, configured }) {
  return (
    <div className="rounded-xl border border-dashed border-[#D9DEE5] bg-[#FAFBFC] px-5 py-12 text-center">
      <Server className="mx-auto h-8 w-8 text-[#9CA3AF]" />
      <p className="mt-3 font-semibold">
        {configured
          ? `No ${title.toLowerCase()} data returned`
          : "Firewall connection not configured"}
      </p>
      <p className="mt-1 text-sm text-[#9CA3AF]">
        {configured
          ? "Confirm the vendor API path and response permissions."
          : "A Super Admin can add the local environment values described in Configuration."}
      </p>
    </div>
  );
}

function ResourceTrend({ data }) {
  if (!data.length)
    return <EmptyPanel title="Utilization history" configured />;
  return (
    <div className="h-64 p-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid
            stroke="#E8ECF2"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
          <Tooltip
            contentStyle={{ borderRadius: 10, border: "1px solid #E5E9EF" }}
          />
          <Line
            type="monotone"
            dataKey="cpu"
            name="CPU"
            stroke="#F97316"
            strokeWidth={2.5}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="memory"
            name="Memory"
            stroke="#6C5CE7"
            strokeWidth={2.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SessionTrend({ data }) {
  if (!data.length)
    return <EmptyPanel title="Active session history" configured />;
  return (
    <div className="h-64 p-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid
            stroke="#E8ECF2"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip
            contentStyle={{ borderRadius: 10, border: "1px solid #E5E9EF" }}
            formatter={(value) => [
              Number(value).toLocaleString(),
              "Active sessions",
            ]}
          />
          <Line
            type="monotone"
            dataKey="sessions"
            name="Active sessions"
            stroke="#1B7F6E"
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function systemTypeFrom(device) {
  const identity = [
    device.device_type,
    device.os_name,
    device.os_version,
    device.hostname,
    device.hardware_vendor,
    device.vendor,
    device.client_identifier,
    device.vendor_class,
    device.vci,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/android/.test(identity))
    return { label: "Android", tone: "bg-green-100 text-green-800" };
  if (/iphone|ios/.test(identity))
    return { label: "iPhone / iOS", tone: "bg-blue-100 text-blue-800" };
  if (/ipad|tablet/.test(identity))
    return { label: "Tablet", tone: "bg-purple-100 text-purple-800" };
  if (/macbook|macos|mac os|imac/.test(identity))
    return { label: "Mac", tone: "bg-slate-100 text-slate-800" };
  if (/windows|desktop|workstation|laptop|computer|pc\b/.test(identity))
    return { label: "Desktop", tone: "bg-cyan-100 text-cyan-800" };
  if (/server/.test(identity))
    return { label: "Server", tone: "bg-orange-100 text-orange-800" };
  if (/printer/.test(identity))
    return { label: "Printer", tone: "bg-amber-100 text-amber-800" };
  if (/router|switch|access point|firewall|network/.test(identity))
    return { label: "Network device", tone: "bg-indigo-100 text-indigo-800" };
  if (/phone|mobile/.test(identity))
    return { label: "Mobile", tone: "bg-teal-100 text-teal-800" };
  return { label: "Unknown system", tone: "bg-slate-100 text-slate-700" };
}

function deviceThreatDetected(device) {
  const booleanSignals = [
    device.is_infected,
    device.infected,
    device.has_virus,
    device.virus_detected,
    device.malware_detected,
    device.compromised,
  ];
  if (
    booleanSignals.some(
      (value) => value === true || value === 1 || value === "1",
    )
  )
    return true;
  const status = [
    device.security_status,
    device.health_status,
    device.risk_level,
    device.threat_level,
    device.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /infected|virus detected|malware detected|compromised|critical risk/.test(
    status,
  );
}

function ConnectedDevicesPanel({
  value,
  logs,
  threats,
  threatErrors,
  source,
  firewall,
}) {
  const rows = listFrom(value);
  const pageSize = 10;
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [interfaceFilter, setInterfaceFilter] = useState("all");
  const [mappingFilter, setMappingFilter] = useState("all");
  const [bandwidthRange, setBandwidthRange] = useState("today");
  const [periodLogs, setPeriodLogs] = useState(null);
  const [bandwidthMeta, setBandwidthMeta] = useState(null);
  const [bandwidthError, setBandwidthError] = useState("");
  const [bandwidthLoading, setBandwidthLoading] = useState(false);
  useEffect(() => {
    const queryString = bandwidthQuery(bandwidthRange);
    setBandwidthLoading(true);
    setBandwidthError("");
    setPeriodLogs(null);
    const controller = new AbortController();
    api(`/firewall/bandwidth?${queryString}&firewall=${firewall}`, {
      signal: controller.signal,
      timeout: 30000,
    })
      .then((report) => {
        setPeriodLogs(report.clients || []);
        setBandwidthMeta({ period: report.period, summary: report.summary });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setBandwidthError(error.message);
        toast.error(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBandwidthLoading(false);
      });
    return () => controller.abort();
  }, [bandwidthRange, firewall]);
  const interfaces = [
    ...new Set(
      rows
        .flatMap((row) =>
          row.detected_interface
            ? [row.detected_interface]
            : row.online_interfaces || [],
        )
        .filter(Boolean),
    ),
  ].sort(compareText);
  const filteredRows = rows.filter((row) => {
    const deviceInterfaces = row.detected_interface
      ? [row.detected_interface]
      : row.online_interfaces || [];
    const matchesInterface =
      interfaceFilter === "all" || deviceInterfaces.includes(interfaceFilter);
    const matchesMapping =
      mappingFilter === "all" ||
      (mappingFilter === "mapped" && row.inventory_match) ||
      (mappingFilter === "unmapped" && !row.inventory_match);
    const searchable = [
      row.hostname,
      row.ipv4_address,
      row.mac,
      row.master_mac,
      row.os_name,
      row.device_type,
      row.hardware_vendor,
      row.vendor,
      row.asset_user_name,
      row.employee_code,
      row.asset_email,
      row.av_status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return matchesInterface && matchesMapping && searchable.includes(query.trim().toLowerCase());
  });
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filteredRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  useEffect(() => {
    setPage(1);
  }, [rows.length, query, interfaceFilter, mappingFilter]);
  if (!rows.length) return <EmptyPanel title="Connected devices" configured />;
  const uniqueMacs = new Set(
    rows.map((row) => row.mac || row.master_mac).filter(Boolean),
  );
  const unmappedDevices = rows.filter(
    (row) => !row.inventory_match && !row.inventory_conflict,
  );
  const ambiguousDevices = rows.filter((row) => row.inventory_conflict);
  const interfaceCounts = Object.entries(
    rows.reduce((counts, row) => {
      const interfaces = row.detected_interface
        ? [row.detected_interface]
        : Array.isArray(row.online_interfaces) && row.online_interfaces.length
          ? row.online_interfaces
          : ["Unknown interface"];
      [...new Set(interfaces)].forEach((name) => {
        counts[name] = (counts[name] || 0) + 1;
      });
      return counts;
    }, {}),
  )
    .map(([name, devices]) => ({ name, devices }))
    .sort((a, b) => b.devices - a.devices);
  const osCounts = Object.entries(
    rows.reduce((counts, row) => {
      const type = systemTypeFrom(row).label;
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {}),
  )
    .map(([name, count], index) => ({
      name,
      count,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }))
    .sort((a, b) => b.count - a.count);
  // Never mix the small live-memory sample into a selected archive period;
  // it creates convincing but materially incomplete bandwidth totals.
  const effectiveBandwidthLogs = periodLogs || EMPTY_FIREWALL_ROWS;
  const normalizedNetworkIdentifier = (value) =>
    String(value || "").trim().toLowerCase();
  const normalizedMacIdentifier = (value) => {
    const compact = normalizedNetworkIdentifier(value).replace(/[^a-f0-9]/g, "");
    return compact.length === 12 ? compact : normalizedNetworkIdentifier(value);
  };
  const devicesByIp = new Map();
  const devicesByMac = new Map();
  rows.forEach((row) => {
    [row.ipv4_address, row.ip_address, row.ip].forEach((value) => {
      const identifier = normalizedNetworkIdentifier(value);
      if (identifier) devicesByIp.set(identifier, row);
    });
    [row.mac, row.mac_address, row.master_mac, row.hwaddr].forEach((value) => {
      const identifier = normalizedMacIdentifier(value);
      if (identifier) devicesByMac.set(identifier, row);
    });
  });
  const trafficByClient = listFrom(effectiveBandwidthLogs).reduce(
    (summary, row) => {
      const ip = textFrom(
        row,
        ["srcip", "source_ip", "sourceIp", "src_ip", "ip"],
        "",
      );
      const mac = textFrom(
        row,
        ["srcmac", "source_mac", "mastersrcmac", "master_mac", "mac"],
        "",
      );
      const normalizedIp = normalizedNetworkIdentifier(ip);
      const normalizedMac = normalizedMacIdentifier(mac);
      if (!normalizedIp && !normalizedMac) return summary;
      const device =
        devicesByMac.get(normalizedMac) || devicesByIp.get(normalizedIp) || {};
      const deviceMac = normalizedMacIdentifier(
        device.mac || device.mac_address || device.master_mac || device.hwaddr,
      );
      const clientKey = deviceMac || normalizedMac
        ? `mac:${deviceMac || normalizedMac}`
        : `ip:${normalizedIp}`;
      const application = textFrom(
        row,
        ["app", "application", "appname", "service"],
        "Other",
      );
      const received = numberFrom(row, [
        "rcvdbyte",
        "received_bytes",
        "download",
      ]);
      const sent = numberFrom(row, ["sentbyte", "sent_bytes", "upload"]);
      const bytes = received + sent;
      if (!summary[clientKey])
        summary[clientKey] = {
          ip: ip || device.ipv4_address || device.ip_address || device.ip || "",
          mac: mac || device.mac || device.mac_address || device.master_mac || "",
          device,
          total: 0,
          received: 0,
          sent: 0,
          sessions: 0,
          applications: {},
          sourceName: textFrom(
            row,
            ["srcname", "source_name", "hostname", "host_name"],
            "",
          ),
          deviceType: textFrom(
            row,
            ["srcdevtype", "source_device_type", "device_type", "devtype"],
            "",
          ),
          osName: textFrom(
            row,
            ["srcosname", "source_os_name", "os_name", "osname"],
            "",
          ),
          vendor: textFrom(
            row,
            ["srchwvendor", "source_vendor", "hardware_vendor", "vendor", "manufacturer"],
            "",
          ),
          assetUserName: row.asset_user_name || device.asset_user_name || "",
          employeeCode: row.employee_code || device.employee_code || "",
          avStatus: row.av_status || device.av_status || "Unknown",
          inventoryMatch: Boolean(row.inventory_match || device.inventory_match),
        };
      const client = summary[clientKey];
      client.ip ||= ip;
      client.mac ||= mac;
      client.sourceName ||= textFrom(
        row,
        ["srcname", "source_name", "hostname", "host_name"],
        "",
      );
      client.deviceType ||= textFrom(
        row,
        ["srcdevtype", "source_device_type", "device_type", "devtype"],
        "",
      );
      client.osName ||= textFrom(
        row,
        ["srcosname", "source_os_name", "os_name", "osname"],
        "",
      );
      client.vendor ||= textFrom(
        row,
        ["srchwvendor", "source_vendor", "hardware_vendor", "vendor", "manufacturer"],
        "",
      );
      client.assetUserName ||= row.asset_user_name || device.asset_user_name || "";
      client.employeeCode ||= row.employee_code || device.employee_code || "";
      client.avStatus ||= row.av_status || device.av_status || "Unknown";
      client.inventoryMatch ||= Boolean(row.inventory_match || device.inventory_match);
      client.total += bytes;
      client.received += received;
      client.sent += sent;
      client.sessions += numberFrom(row, ["traffic_records"], 1);
      client.applications[application] =
        (client.applications[application] || 0) + bytes;
      return summary;
    },
    {},
  );
  const bandwidthRows = Object.values(trafficByClient)
    .map((traffic) => {
      const device = traffic.device || {};
      const systemType = systemTypeFrom({
        ...device,
        device_type: device.device_type || traffic.deviceType,
        os_name: device.os_name || traffic.osName,
        hardware_vendor: device.hardware_vendor || traffic.vendor,
      });
      return {
        ip: traffic.ip,
        name: traffic.assetUserName
          ? `${traffic.assetUserName}${traffic.employeeCode ? ` · ${traffic.employeeCode}` : ""}`
          : device.hostname ||
            traffic.sourceName ||
            device.device_type ||
            traffic.deviceType ||
            traffic.ip ||
            traffic.mac,
        memberName: traffic.assetUserName || "Unmapped member",
        employeeCode: traffic.employeeCode || "",
        hostname:
          device.hostname ||
          traffic.sourceName ||
          device.device_type ||
          traffic.deviceType ||
          "Unknown system",
        mac: traffic.mac || device.mac || device.master_mac || "",
        systemType: systemType.label,
        systemTypeTone: systemType.tone,
        avStatus: traffic.avStatus || "Unknown",
        inventoryMatch: Boolean(traffic.inventoryMatch),
        total: traffic.total,
        received: traffic.received,
        sent: traffic.sent,
        sessions: traffic.sessions,
        applications: traffic.applications,
      };
    })
    .sort((a, b) => b.total - a.total);
  const totalObservedBandwidth = bandwidthRows.reduce(
    (sum, row) => sum + row.total,
    0,
  );
  const mobileBandwidthConsumers = bandwidthRows.filter((row) =>
    /android|iphone|ios|tablet|mobile/i.test(row.systemType),
  );
  const infectedDevices = rows.filter(deviceThreatDetected);
  const threatRows = Object.entries(threats || {}).flatMap(
    ([source, payload]) =>
      listFrom(payload).map((row) => ({ ...row, threat_source: source })),
  );
  const affectedThreatDevices = new Set(
    threatRows
      .flatMap((row) => [
        row.srcip,
        row.source_ip,
        row.srcmac,
        row.mastersrcmac,
      ])
      .filter(Boolean),
  );
  const criticalThreats = threatRows.filter((row) =>
    /critical|high|emergency|alert/i.test(
      textFrom(row, ["level", "severity", "risk", "crlevel"], ""),
    ),
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="hidden">
        <div className="rounded-xl bg-green-50 px-4 py-3">
          <b className="text-lg text-green-700">
            {rows.filter((row) => row.is_online !== false).length}
          </b>
          <p className="text-xs text-green-800">Online records</p>
        </div>
        <div className="rounded-xl bg-blue-50 px-4 py-3">
          <b className="text-lg text-blue-700">{uniqueMacs.size}</b>
          <p className="text-xs text-blue-800">Unique MAC addresses</p>
        </div>
      </div>
      <div className={`${threatRows.length || infectedDevices.length ? "order-7" : "hidden"} overflow-hidden rounded-2xl border border-[#F1C7C7] bg-white shadow-sm`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1DADA] px-5 py-4">
          <div>
            <h3 className="text-lg font-bold">Device threat dashboard</h3>
            <p className="text-xs text-[#98A0B3]">
              Antivirus, IPS, web-filter and DNS-filter telemetry correlated to
              devices
            </p>
          </div>
          <Badge
            className={
              criticalThreats.length || infectedDevices.length
                ? "bg-red-100 text-red-800"
                : "bg-emerald-100 text-emerald-800"
            }
          >
            {criticalThreats.length || infectedDevices.length
              ? "Attention required"
              : "No confirmed critical device threat"}
          </Badge>
        </div>
        <div className="grid gap-px bg-[#F1E4E4] sm:grid-cols-2 lg:grid-cols-4">
          {[
            [
              "Explicitly infected devices",
              infectedDevices.length,
              "text-red-700",
            ],
            ["Threat records", threatRows.length, "text-amber-700"],
            [
              "Affected identifiers",
              affectedThreatDevices.size,
              "text-orange-700",
            ],
            ["Critical/high events", criticalThreats.length, "text-red-700"],
          ].map(([label, metric, tone]) => (
            <div key={label} className="bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                {label}
              </p>
              <b className={`mt-1 block text-2xl ${tone}`}>{metric}</b>
            </div>
          ))}
        </div>
        {threatRows.length ? (
          <div className="max-h-80 overflow-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="sticky top-0 bg-[#FAFBFC] text-[11px] uppercase tracking-wider text-[#9CA3AF]">
                <tr>
                  <th className="px-4 py-3">Threat</th>
                  <th className="px-4 py-3">Source device</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {threatRows.slice(0, 100).map((row, index) => (
                  <tr
                    key={row.id || row.logid || index}
                    className="border-t border-[#EDF0F4]"
                  >
                    <td className="px-4 py-3 font-semibold">
                      {textFrom(
                        row,
                        ["virus", "attack", "hostname", "msg", "logdesc"],
                        "Detected security event",
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {textFrom(
                        row,
                        ["srcname", "srcip", "source_ip", "srcmac"],
                        "Unknown device",
                      )}
                    </td>
                    <td className="px-4 py-3 capitalize">
                      {String(row.threat_source).replace("threat_", "")}
                    </td>
                    <td className="px-4 py-3">
                      {textFrom(
                        row,
                        ["level", "severity", "risk", "crlevel"],
                        "Information",
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {textFrom(
                        row,
                        ["action", "eventtype", "status"],
                        "Observed",
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {[row.date, row.time || row.timestamp]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-5 text-sm text-[#69738B]">
            No antivirus, IPS, web-filter or DNS-filter threat records were
            returned for the current period.{" "}
            {Object.keys(threatErrors || {}).length
              ? `${Object.keys(threatErrors).length} threat endpoint(s) are unavailable or not permitted for this API account.`
              : "Threat telemetry endpoints are connected and currently empty."}
          </div>
        )}
      </div>
      <div className="order-2 overflow-hidden rounded-2xl border border-[#E7E9F2] bg-white shadow-[0_1px_2px_rgba(24,28,46,0.05),0_4px_14px_rgba(24,28,46,0.05)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#DDE2EA] px-5 py-4">
          <div className="mr-auto">
            <h3 className="text-sm font-bold">Top bandwidth consumers</h3>
            <p className="text-xs text-[#98A0B3]">
              Upload, download and traffic records ·{" "}
              {bandwidthRangeLabel(bandwidthRange)}
            </p>
          </div>
          <AppSelect
            value={bandwidthRange}
            onValueChange={setBandwidthRange}
            options={BANDWIDTH_RANGES}
            aria-label="Bandwidth range"
            className="w-full border-[#DDE2EA] sm:w-auto"
          />
          {bandwidthLoading && (
            <RefreshCw className="h-4 w-4 animate-spin text-[#4F6EF7]" />
          )}
        </div>
        {!bandwidthLoading && (
          <div className={`border-b px-5 py-3 text-xs ${bandwidthError ? "border-red-200 bg-red-50 text-red-700" : "border-[#E5E9EF] bg-[#F8FAFC] text-[#69738B]"}`}>
            {bandwidthError ? (
              `Unable to load bandwidth details: ${bandwidthError}`
            ) : bandwidthMeta ? (
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <b className="text-[#374151]">{bandwidthMeta.summary?.records || 0} traffic records</b>
                <span>
                  Usage from {formatUsageRangeTimestamp(bandwidthMeta.period?.start)} →{" "}
                  {formatUsageRangeTimestamp(bandwidthMeta.period?.end)} IST
                </span>
                <span>Firewall: {firewall.toUpperCase()}</span>
                {bandwidthMeta.summary?.data_end && (
                  <span>
                    Latest archived activity: {formatUsageRangeTimestamp(bandwidthMeta.summary.data_end)} IST
                  </span>
                )}
                {bandwidthMeta.summary?.captured_at && (
                  <span>
                    Refreshed: {formatUsageRangeTimestamp(bandwidthMeta.summary.captured_at)} IST
                  </span>
                )}
                {bandwidthMeta.summary?.record_limit_reached && (
                  <span className="font-semibold text-[#B45309]">
                    API row limit reached; displayed usage may be partial.
                  </span>
                )}
                {bandwidthMeta.summary?.source_complete === false &&
                  !bandwidthMeta.summary?.record_limit_reached && (
                    <span className="font-semibold text-[#B45309]">
                      The firewall did not return every retained source row;
                      totals may be partial.
                    </span>
                  )}
              </span>
            ) : null}
          </div>
        )}
        <div className="grid gap-px bg-[#E3E6EE] sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Observed bandwidth", formatBytes(totalObservedBandwidth)],
            ["Clients with traffic", bandwidthRows.length],
            ["Mobile / tablet clients", mobileBandwidthConsumers.length],
            ["Highest consumer", bandwidthRows[0]?.name || "—"],
            [
              "Highest usage",
              bandwidthRows[0] ? formatBytes(bandwidthRows[0].total) : "0 B",
            ],
          ].map(([label, metric]) => (
            <div key={label} className="bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                {label}
              </p>
              <b className="mt-1 block truncate text-xl">{metric}</b>
            </div>
          ))}
        </div>
        {bandwidthRows.length ? (
          <div className="grid gap-4 p-5 xl:grid-cols-[2fr_1fr]">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={bandwidthRows.slice(0, 12)}
                  layout="vertical"
                  margin={{ left: 45, right: 15 }}
                >
                  <CartesianGrid
                    stroke="#E8ECF2"
                    strokeDasharray="3 3"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(bytes) => formatBytes(bytes)}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip formatter={(bytes, name) => [formatBytes(bytes), name]} />
                  <Bar
                    dataKey="received"
                    name="Downloaded"
                    stackId="bandwidth"
                    fill="#4F6EF7"
                  />
                  <Bar
                    dataKey="sent"
                    name="Uploaded"
                    stackId="bandwidth"
                    fill="#0D9C6F"
                    radius={[0, 5, 5, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {bandwidthRows.slice(0, 10).map((device, index) => (
                <div
                  key={device.ip}
                  className="flex items-center gap-3 rounded-lg bg-[#F8F9FC] p-3"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-xs font-bold text-[#69738B]">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <b className="block truncate text-sm">{device.name}</b>
                    <p className="truncate text-xs text-[#69738B]">
                      {device.hostname}
                    </p>
                    <span
                      className={`mt-1 block w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${device.systemTypeTone}`}
                    >
                      {device.systemType}
                    </span>
                    <span className="text-xs text-[#98A0B3]">
                      {device.ip}
                      {device.mac ? ` · ${device.mac}` : ""} · {device.sessions}{" "}
                      records
                    </span>
                    <span
                      className={`mt-1 block w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${device.inventoryMatch ? (/installed|active|protected|running/i.test(device.avStatus) ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800") : "bg-red-100 text-red-800"}`}
                    >
                      {device.inventoryMatch
                        ? `AV: ${device.avStatus}`
                        : "MAC not mapped"}
                    </span>
                  </div>
                  <b className="ml-auto whitespace-nowrap text-sm">
                    {formatBytes(device.total)}
                  </b>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-6 text-sm text-[#69738B]">
            {bandwidthLoading
              ? "Loading bandwidth details for the selected period…"
              : bandwidthError
                ? "The firewall report could not be loaded. Please retry or refresh the firewall connection."
                : `No per-device bandwidth records were returned for ${firewall.toUpperCase()} in the selected period.`}
          </div>
        )}
      </div>
      <div className="order-1 grid gap-4 xl:grid-cols-[1fr_2fr]">
        <div className="rounded-xl border border-[#E5E9EF] bg-white p-4">
          <h3 className="font-bold">Devices by OS</h3>
          <p className="text-xs text-[#9CA3AF]">
            Detected operating-system families
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="h-48 min-w-40 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={osCounts}
                    dataKey="count"
                    nameKey="name"
                    innerRadius={46}
                    outerRadius={70}
                    paddingAngle={2}
                  >
                    {osCounts.map((item) => (
                      <Cell key={item.name} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(count) => [count, "Devices"]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="min-w-40 flex-1 space-y-2">
              {osCounts.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center gap-2 text-xs"
                >
                  <i
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ background: item.color }}
                  />
                  <span className="text-[#6B7280]">{item.name}</span>
                  <b className="ml-auto">{item.count.toLocaleString()}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[#E5E9EF] bg-white p-4">
          <div className="mb-4">
            <h3 className="font-bold">Devices by interface</h3>
            <p className="text-xs text-[#9CA3AF]">
              Number of connected devices detected on each network interface
            </p>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={interfaceCounts}
                margin={{ top: 5, right: 10, left: 0, bottom: 30 }}
              >
                <CartesianGrid
                  stroke="#E8ECF2"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="name"
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  tick={{ fontSize: 10 }}
                  height={65}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip
                  cursor={{ fill: "#F4F7FA" }}
                  contentStyle={{
                    borderRadius: 10,
                    border: "1px solid #E5E9EF",
                  }}
                  formatter={(count) => [count, "Devices"]}
                />
                <Bar
                  dataKey="devices"
                  name="Connected devices"
                  fill="#2E7CD6"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={64}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="order-3 flex flex-wrap items-center gap-3 rounded-t-2xl border border-b-0 border-[#E5E9EF] bg-white p-4">
        <div className="mr-auto w-full sm:min-w-56 sm:w-auto">
          <h3 className="text-lg font-bold">Connected devices</h3>
          <p className="text-xs text-[#98A0B3]">
            {filteredRows.length.toLocaleString()} visible ·{" "}
            {source?.live_only
              ? "active DHCP leases right now"
              : "firewall discovery fallback"}
          </p>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search device, IP, MAC or OS…"
          className="h-10 w-full rounded-lg border border-[#DDE2EA] px-3 text-sm outline-none focus:border-[#4F6EF7] sm:min-w-64 sm:max-w-md sm:flex-1"
        />
        <AppSelect
          value={interfaceFilter}
          onValueChange={setInterfaceFilter}
          options={[["all", "All interfaces"], ...interfaces.map((name) => [name, name])]}
          aria-label="Interface"
          className="h-10 w-full border-[#DDE2EA] sm:w-auto"
        />
        <div className="flex flex-wrap gap-1.5">
          {[["all", `All · ${rows.length}`], ["unmapped", `Unmapped · ${unmappedDevices.length}`], ["mapped", `Mapped · ${rows.length - unmappedDevices.length}`]].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setMappingFilter(key)} className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold ${mappingFilter === key ? key === "unmapped" ? "bg-[#FCE9ED] text-[#C41E3D] ring-1 ring-[#F5CBD5]" : key === "mapped" ? "bg-[#E8F6EE] text-[#15803D] ring-1 ring-emerald-200" : "bg-[#EDF0FE] text-[#4A5FE8] ring-1 ring-[#D8DEFB]" : "bg-[#F0F1F7] text-[#5B6178]"}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="order-4 overflow-x-auto border border-[#E5E9EF] bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-[#FAFBFC] text-[11px] uppercase tracking-wider text-[#9CA3AF]">
            <tr>
              <th className="px-4 py-3">Device</th>
              <th className="px-4 py-3">Assigned user</th>
              <th className="px-4 py-3">IP · MAC</th>
              <th className="px-4 py-3">Operating system</th>
              <th className="px-4 py-3">Interface</th>
              <th className="px-4 py-3 text-right">Traffic</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, index) => {
              const systemType = systemTypeFrom(row);
              const threatDetected = deviceThreatDetected(row);
              const deviceMac = normalizedMacIdentifier(
                row.mac || row.mac_address || row.master_mac || row.hwaddr,
              );
              const deviceIp = normalizedNetworkIdentifier(
                row.ipv4_address || row.ip_address || row.ip,
              );
              const traffic = deviceMac
                ? trafficByClient[`mac:${deviceMac}`]
                : trafficByClient[`ip:${deviceIp}`];
              const topApplication = traffic
                ? Object.entries(traffic.applications).sort(
                    (a, b) => b[1] - a[1],
                  )[0]?.[0]
                : null;
              const absoluteIndex = (currentPage - 1) * pageSize + index;
              return (
                <tr
                  key={`${row.mac || row.ipv4_address || absoluteIndex}-${absoluteIndex}`}
                  className={`border-t border-[#EDF0F4] ${row.inventory_conflict ? "bg-amber-50/80" : !row.inventory_match ? "bg-red-50/70" : threatDetected ? "bg-red-50 ring-1 ring-inset ring-red-200" : ""}`}
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold">
                      {row.hostname || row.device_type || "Unknown device"}
                    </p>
                    <p className="text-xs text-[#9CA3AF]">
                      {row.device_type || "Unclassified"}
                    </p>
                    {(row.hardware_vendor || row.vendor) && (
                      <p className="mt-1 text-xs font-medium text-[#69738B]">
                        {row.hardware_vendor || row.vendor}
                      </p>
                    )}
                    {row.identification_source && (
                      <p className="mt-1 text-[10px] text-[#98A0B3]">
                        Enriched from firewall traffic
                      </p>
                    )}
                    {threatDetected && (
                      <Badge className="mt-2 bg-red-600 text-white">
                        Virus detected
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold">
                      {row.asset_user_name || (row.inventory_conflict ? "Needs ownership review" : "Unmapped")}
                    </p>
                    <p className="text-xs text-[#9CA3AF]">
                      {row.employee_code || "No employee code"}
                    </p>
                    {row.asset_email && (
                      <p className="text-[10px] text-[#9CA3AF]">
                        {row.asset_email}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[#4B5563]">
                    <span className="block">{row.ipv4_address || "—"}</span>
                    <span className={`mt-1 block text-[10.5px] ${row.inventory_match ? "text-[#98A0B5]" : row.inventory_conflict ? "font-semibold text-[#B45309]" : "font-semibold text-[#C41E3D]"}`}>{row.mac || row.master_mac || "No MAC"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{systemType.label}</p>
                    <p className="mt-1 text-[11px] text-[#98A0B5]">
                      {[row.os_name, row.os_version]
                        .filter(Boolean)
                        .join(" ") || "OS not detected"}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs">{row.detected_interface || row.online_interfaces?.join(", ") || "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {traffic
                      ? formatBytes(traffic.total)
                      : row.observed_traffic_bytes
                        ? formatBytes(row.observed_traffic_bytes)
                        : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <FwPill tone={!row.inventory_match ? row.inventory_conflict ? "amber" : "red" : /installed|active|protected|running/i.test(row.av_status || "") ? "green" : "amber"}>
                      <i className="h-1.5 w-1.5 rounded-full bg-current" />
                      {row.inventory_match ? row.av_status || "AV pending" : row.inventory_conflict ? "Needs review" : "Unmapped"}
                    </FwPill>
                    {(row.traffic_last_seen || row.last_seen) && (
                      <p className="mt-1 whitespace-nowrap text-[11px] text-[#98A0B3]">
                        Seen {row.traffic_last_seen || row.last_seen}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="order-5 flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border border-t-0 border-[#E5E9EF] bg-[#FAFBFC] px-4 py-3">
        <p className="text-xs text-[#6B7280]">
          Showing {filteredRows.length ? (currentPage - 1) * pageSize + 1 : 0}–
          {Math.min(currentPage * pageSize, filteredRows.length)} of{" "}
          {filteredRows.length} devices · 10 entries per page
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Previous
          </Button>
          <span className="min-w-24 text-center text-xs font-semibold text-[#4B5563]">
            Page {currentPage} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === pageCount}
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
          >
            Next
          </Button>
        </div>
      </div>
      {ambiguousDevices.length > 0 && (
        <div className="order-6 overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-amber-100 bg-amber-50 px-5 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <div><h3 className="font-bold text-amber-900">Duplicate MAC ownership requires review</h3><p className="text-xs text-amber-700">{ambiguousDevices.length} live device{ambiguousDevices.length === 1 ? " has" : "s have"} conflicting employee records and were deliberately not auto-assigned.</p></div>
            <Badge className="ml-auto bg-amber-600 text-white">Ambiguous</Badge>
          </div>
          <div className="grid max-h-80 gap-px overflow-y-auto bg-amber-100 sm:grid-cols-2 lg:grid-cols-3">
            {ambiguousDevices.map((device, index) => (
              <div key={`${device.mac || device.ipv4_address}-${index}`} className="bg-white p-3">
                <p className="font-mono text-xs font-bold text-amber-800">{device.mac || device.master_mac || "No MAC"}</p>
                <p className="mt-1 text-xs text-[#6B7280]">{device.ipv4_address || "No IP"} · {device.hostname || "Unknown device"}</p>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Possible owners</p>
                <div className="mt-1 space-y-1">{(device.inventory_candidates || []).map((candidate, candidateIndex) => <p key={`${candidate.employee_code}-${candidateIndex}`} className="text-xs text-[#4B5563]">{candidate.name || "Unknown"}{candidate.employee_code ? ` · ${candidate.employee_code}` : ""}{candidate.serial_number ? ` · ${candidate.serial_number}` : ""}</p>)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="hidden">
        <div className="flex items-center gap-3 border-b border-red-100 bg-red-50 px-5 py-4">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <div>
            <h3 className="font-bold text-red-900">
              Unmapped live MAC addresses
            </h3>
            <p className="text-xs text-red-700">
              {unmappedDevices.length} connected device
              {unmappedDevices.length === 1 ? "" : "s"} not found in either
              supplied CSV file
            </p>
          </div>
          <Badge className="ml-auto bg-red-600 text-white">
            Requires review
          </Badge>
        </div>
        {unmappedDevices.length ? (
          <div className="grid max-h-72 gap-px overflow-y-auto bg-red-100 sm:grid-cols-2 lg:grid-cols-3">
            {unmappedDevices.map((device, index) => (
              <div
                key={`${device.mac || device.ipv4_address}-${index}`}
                className="bg-white p-3"
              >
                <p className="font-mono text-xs font-bold text-red-700">
                  {device.mac || device.master_mac || "No MAC"}
                </p>
                <p className="mt-1 text-xs text-[#6B7280]">
                  {device.ipv4_address || "No IP"} ·{" "}
                  {device.hostname || "Unknown device"}
                </p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-red-500">
                  Not found in asset or AV inventory
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-5 text-sm text-green-700">
            All live device MAC addresses are mapped.
          </p>
        )}
      </div>
    </div>
  );
}

function friendlyFirewallApplicationName(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  const matchers = [
    [/whats[._ -]?app/i, "WhatsApp"],
    [/instagram/i, "Instagram"],
    [/youtube/i, "YouTube"],
    [/google[._ -]?search/i, "Google Search"],
    [/google[._ -]?accounts?/i, "Google Accounts"],
    [/facebook/i, "Facebook"],
  ];
  return matchers.find(([pattern]) => pattern.test(raw))?.[1] || raw;
}

function identifiedApplication(row) {
  const explicit = textFrom(row, ["app", "application", "appname"], "");
  const explicitlyIdentified =
    row.application_identified === true ||
    row.application_source === "fortigate_application_control" ||
    (row.application_identified === undefined && Boolean(row.app || row.appname));
  if (explicit && explicitlyIdentified)
    return {
      name: friendlyFirewallApplicationName(explicit),
      rawName: explicit,
      confidence: "identified",
    };
  const service = textFrom(
    row,
    ["service", "application"],
    "Unknown service",
  );
  return { name: service, rawName: service, confidence: "protocol" };
}

function UserActivityExplorer({ logs, devices, firewall }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const detailRef = useRef(null);
  const pageSize = 10;
  const activity = useMemo(() => {
    const deviceRows = listFrom(devices);
    const byIp = Object.fromEntries(
      deviceRows
        .filter((row) => row.ipv4_address)
        .map((row) => [row.ipv4_address, row]),
    );
    const byMac = Object.fromEntries(
      deviceRows.flatMap((row) =>
        [row.mac, row.master_mac]
          .filter(Boolean)
          .map((mac) => [firewallMacKey(mac), row]),
      ),
    );
    return Object.values(logs.reduce((summary, row) => {
    const ip = textFrom(row, ["srcip", "source_ip", "ip"], "Unknown IP");
    const mac = textFrom(
      row,
      ["srcmac", "source_mac", "mastersrcmac", "mac"],
      "",
    );
    const device = byIp[ip] || byMac[firewallMacKey(mac)] || {};
    const member = row.asset_user_name || device.asset_user_name || "Unmapped user";
    const employeeCode = row.employee_code || device.employee_code || "";
    const key = mac || ip;
    const application = identifiedApplication(row);
    if (!summary[key]) summary[key] = {
      key,
      member,
      employeeCode,
      email: row.asset_email || device.asset_email || "",
      inventoryMatch: Boolean(row.inventory_match || device.inventory_match),
      avStatus: row.av_status || device.av_status || "Unknown",
      hostname: row.srcname || row.source_name || device.hostname || row.devtype || row.source_device_type || device.device_type || "Unknown system",
      os: row.osname || row.source_os_name || device.os_name || device.asset_os_version || "Unknown OS",
      hardware: row.srchwvendor || row.source_vendor || device.hardware_vendor || device.asset_brand || "Unknown hardware",
      ip,
      mac,
      interface: row.srcintf || row.source_interface || device.detected_interface || "—",
      total: 0,
      sent: 0,
      received: 0,
      duration: 0,
      sessions: 0,
      blocked: 0,
      applications: new Map(),
      destinations: new Set(),
      countries: new Set(),
      policies: new Set(),
      records: [],
      lastActivity: "",
    };
    const item = summary[key];
    const sent = numberFrom(row, ["sentbyte", "sent_bytes", "upload"]);
    const received = numberFrom(row, ["rcvdbyte", "received_bytes", "download"]);
    const bytes = sent + received;
    const action = textFrom(row, ["action", "status"], "Observed");
    item.total += bytes;
    item.sent += sent;
    item.received += received;
    item.duration += numberFrom(row, ["duration", "duration_seconds"], 0);
    item.sessions += 1;
    if (/deny|block|drop/i.test(action)) item.blocked += 1;
    const appCurrent = item.applications.get(application.name) || { bytes: 0, sessions: 0, confidence: application.confidence };
    appCurrent.bytes += bytes;
    appCurrent.sessions += 1;
    item.applications.set(application.name, appCurrent);
    const destination = textFrom(row, ["dstip", "destination_ip"], "");
    if (destination) item.destinations.add(destination);
    const country = textFrom(row, ["dstcountry", "destination_country"], "");
    if (country) item.countries.add(country);
    const policy = textFrom(row, ["policyname", "policy"], "");
    if (policy) item.policies.add(policy);
    const timestamp = [row.date, row.time || row.timestamp].filter(Boolean).join(" ");
    if (timestamp > item.lastActivity) item.lastActivity = timestamp;
    item.records.push({
      application: application.name,
      confidence: application.confidence,
      destination: destination || "—",
      port: row.dstport || row.destination_port || "—",
      country: country || "—",
      service: row.service || row.application || "—",
      action,
      policy: policy || "—",
      bytes,
      duration: numberFrom(row, ["duration", "duration_seconds"], 0),
      time: timestamp || "—",
    });
    return summary;
  }, {})).map((item) => ({
    ...item,
    applications: [...item.applications.entries()].map(([name, metrics]) => ({ name, ...metrics })).sort((a, b) => b.bytes - a.bytes),
    destinations: [...item.destinations],
    countries: [...item.countries],
    policies: [...item.policies],
    records: item.records.sort((a, b) => b.time.localeCompare(a.time)),
  })).sort((a, b) => b.total - a.total);
  }, [devices, logs]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return activity;
    return activity.filter((item) =>
      [
        item.member,
        item.employeeCode,
        item.email,
        item.hostname,
        item.ip,
        item.mac,
        item.os,
        ...item.applications.map((app) => app.name),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [activity, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => {
    setPage(1);
  }, [query, logs.length, firewall]);
  const detail = activity.find((item) => item.key === selected);
  useEffect(() => {
    if (!detail) return;
    const frame = window.requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [detail]);
  return <section className="order-4 overflow-hidden rounded-2xl border border-[#D7DDF0] bg-white shadow-sm">
    <div className="flex flex-wrap items-center gap-3 border-b border-[#E5E9EF] px-5 py-4">
      <div className="mr-auto"><h3 className="text-lg font-bold">User and system utilization</h3><p className="text-xs text-[#8B93A1]">Member identity, endpoint, applications/protocols, destinations and policy activity from {firewall.toUpperCase()} traffic logs.</p></div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search user, system, IP or app…" className="h-9 w-full rounded-lg border border-[#DDE2EA] bg-[#FAFBFC] px-3 text-sm sm:min-w-64 sm:w-auto" />
    </div>
    <div className="grid gap-px bg-[#E5E9EF] sm:grid-cols-2 lg:grid-cols-4">
      {[["Users/systems observed", activity.length], ["Inventory mapped", activity.filter((item) => item.inventoryMatch).length], ["Destinations reached", new Set(activity.flatMap((item) => item.destinations)).size], ["Blocked records", activity.reduce((sum, item) => sum + item.blocked, 0)]].map(([label, metric]) => <div key={label} className="bg-white p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-[#8B93A1]">{label}</p><b className="mt-1 block text-2xl">{metric}</b></div>)}
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-[#FAFBFC] text-[10px] uppercase tracking-wider text-[#8B93A1]"><tr><th className="px-4 py-3">Member and system</th><th className="px-4 py-3">Network identity</th><th className="px-4 py-3">Top usage</th><th className="px-4 py-3">Destinations</th><th className="px-4 py-3 text-right">Records</th><th className="px-4 py-3 text-right">Bandwidth</th><th className="px-4 py-3">Last activity</th><th className="px-4 py-3" /></tr></thead>
      <tbody>{pageRows.map((item) => <tr key={item.key} className="border-t border-[#EDF0F4] align-top hover:bg-[#FAFBFC]"><td className="px-4 py-3"><b className={item.inventoryMatch ? "text-[#111827]" : "text-red-700"}>{item.member}</b><p className="text-xs text-[#69738B]">{item.employeeCode || "No employee code"} · {item.hostname}</p><p className="text-[11px] text-[#98A0B3]">{item.os} · AV: {item.avStatus}</p></td><td className="px-4 py-3 font-mono text-xs"><p>{item.ip}</p><p className="text-[#69738B]">{item.mac || "No MAC"}</p><p className="text-[#98A0B3]">{item.interface}</p></td><td className="px-4 py-3">{item.applications.slice(0, 3).map((app) => <span key={app.name} className="mr-1 mt-1 inline-block rounded-md bg-[#EEF1FF] px-2 py-1 text-[11px] font-semibold text-[#4456A6]">{app.name} · {formatBytes(app.bytes)}</span>)}</td><td className="px-4 py-3"><b>{item.destinations.length}</b><p className="max-w-48 truncate text-xs text-[#69738B]">{item.countries.slice(0, 3).join(", ") || "Unknown country"}</p></td><td className="px-4 py-3 text-right"><b>{item.sessions.toLocaleString()}</b>{item.blocked > 0 && <p className="text-xs text-red-600">{item.blocked} blocked</p>}</td><td className="px-4 py-3 text-right"><b>{formatBytes(item.total)}</b><p className="text-[11px] text-[#8B93A1]">↑ {formatBytes(item.sent)} · ↓ {formatBytes(item.received)}</p></td><td className="whitespace-nowrap px-4 py-3 text-xs">{item.lastActivity || "—"}</td><td className="px-4 py-3"><Button variant="outline" size="sm" onClick={() => setSelected(item.key)}>Inspect</Button></td></tr>)}</tbody></table>
    </div>
    {filtered.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E9EF] bg-[#FAFBFC] px-5 py-3"><p className="text-xs text-[#69738B]">Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} systems</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><span className="min-w-20 text-center text-xs font-semibold">Page {currentPage} of {pageCount}</span><Button variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</Button></div></div>}
    {!filtered.length && <p className="p-8 text-center text-sm text-[#69738B]">No matching user or system activity found.</p>}
    {detail && <div ref={detailRef} tabIndex={-1} className="scroll-mt-24 border-t-2 border-[#D7DDF0] bg-[#F8F9FC] p-4 outline-none sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h4 className="text-lg font-bold">Activity details · {detail.member}</h4><p className="text-xs text-[#69738B]">{detail.hostname} · {detail.ip} · {detail.mac || "No MAC"}</p></div><Button variant="outline" size="sm" onClick={() => setSelected(null)}>Close</Button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Applications/protocols", detail.applications.length], ["Unique destinations", detail.destinations.length], ["Countries", detail.countries.length], ["Policies matched", detail.policies.length]].map(([label, metric]) => <div key={label} className="rounded-lg border bg-white p-3"><p className="text-[10px] uppercase text-[#8B93A1]">{label}</p><b className="text-xl">{metric}</b></div>)}</div><div className="mt-4 overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[950px] text-left text-xs"><thead className="bg-[#F3F5F8] uppercase text-[#8B93A1]"><tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Application / service</th><th className="px-3 py-2">Destination</th><th className="px-3 py-2">Country</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Policy</th><th className="px-3 py-2 text-right">Duration</th><th className="px-3 py-2 text-right">Traffic</th></tr></thead><tbody>{detail.records.slice(0, 100).map((record, index) => <tr key={`${record.time}-${record.destination}-${index}`} className="border-t"><td className="whitespace-nowrap px-3 py-2">{record.time}</td><td className="px-3 py-2"><b>{record.application}</b><p className="text-[10px] text-[#8B93A1]">{record.confidence === "identified" ? "Firewall-identified app" : `Protocol/service · ${record.service}`}</p></td><td className="px-3 py-2 font-mono">{record.destination}:{record.port}</td><td className="px-3 py-2">{record.country}</td><td className="px-3 py-2">{record.action}</td><td className="px-3 py-2">{record.policy}</td><td className="px-3 py-2 text-right">{record.duration}s</td><td className="px-3 py-2 text-right font-semibold">{formatBytes(record.bytes)}</td></tr>)}</tbody></table></div><p className="mt-3 text-[11px] text-[#8B93A1]">Shows network metadata exposed by the firewall. Encrypted page contents, typed text and private message contents are not visible.</p></div>}
  </section>;
}

function ApplicationUsagePanel({
  value,
  devices,
  firewall,
  inspection,
  loading = false,
  policyCoverage,
  reportSummary,
  reportPeriod,
  aggregates,
}) {
  const logs = listFrom(value);
  // The report ships a bounded page of records, so when the server-side
  // aggregate is present it is the only view that covers the whole period.
  const aggregatedApplications = aggregates?.applications;
  const usageEntries = aggregatedApplications
    ? aggregatedApplications.map((row) => ({
        name: row.name,
        category: row.category || "Unclassified",
        risk: row.risk || "Unknown",
        identified: row.source_kind === "application_control",
        sessions: Number(row.records || 0),
        received: Number(row.received_bytes || 0),
        sent: Number(row.sent_bytes || 0),
        total: Number(row.traffic_bytes || 0),
      }))
    : Object.values(
    logs.reduce((summary, row) => {
      const identified = identifiedApplication(row);
      const name = identified.name;
      const category = textFrom(
        row,
        ["appcat", "category", "service"],
        "Unclassified",
      );
      const risk = textFrom(row, ["apprisk", "application_risk"], "Unknown");
      const received = numberFrom(row, [
        "rcvdbyte",
        "received_bytes",
        "download",
        "bytes_received",
      ]);
      const sent = numberFrom(row, [
        "sentbyte",
        "sent_bytes",
        "upload",
        "bytes_sent",
      ]);
      if (!summary[name])
        summary[name] = {
          name,
          category,
          risk,
          identified: false,
          sessions: 0,
          received: 0,
          sent: 0,
          total: 0,
        };
      summary[name].identified ||= identified.confidence === "identified";
      if (summary[name].risk === "Unknown" && risk !== "Unknown")
        summary[name].risk = risk;
      summary[name].sessions += 1;
      summary[name].received += received;
      summary[name].sent += sent;
      summary[name].total += received + sent;
      return summary;
    }, {}),
  );
  usageEntries.sort((a, b) => b.total - a.total || b.sessions - a.sessions);
  if (!usageEntries.length && loading)
    return (
      <div className="overflow-hidden rounded-2xl border border-[#DDE2EA] bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <RefreshCw className="h-5 w-5 animate-spin text-[#4A5FE8]" />
          <div>
            <p className="font-semibold">Loading application usage</p>
            <p className="text-xs text-[#8B93A1]">
              Reading current traffic and the verified pre-downtime fallback…
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-24 animate-pulse rounded-xl bg-[#F0F2F7]" />
          ))}
        </div>
      </div>
    );
  if (!usageEntries.length)
    return <EmptyPanel title="Application usage" configured />;
  const applications = usageEntries.filter((entry) => entry.identified);
  const networkServices = usageEntries.filter((entry) => !entry.identified);
  const totalTraffic = usageEntries.reduce((sum, entry) => sum + entry.total, 0);
  const identifiedTraffic = applications.reduce(
    (sum, application) => sum + application.total,
    0,
  );
  const categories = Object.values(
    usageEntries.reduce((summary, app) => {
      if (!summary[app.category])
        summary[app.category] = { name: app.category, value: 0 };
      summary[app.category].value += app.total;
      return summary;
    }, {}),
  )
    .sort((a, b) => b.value - a.value)
    .map((item, index) => ({
      ...item,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));
  const topCategories = categories.slice(0, 6);
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, "0")}:00`,
  }));
  logs.forEach((row) => {
    const rawTime = String(row.time || row.timestamp || "");
    const hour = Number(
      rawTime.match(/(?:T|^)(\d{2}):/)?.[1] ?? rawTime.slice(0, 2),
    );
    const category = textFrom(
      row,
      ["appcat", "category", "service"],
      "Unclassified",
    );
    if (Number.isInteger(hour) && hourly[hour])
      hourly[hour][category] =
        (hourly[hour][category] || 0) +
        (numberFrom(row, ["rcvdbyte", "received_bytes", "download"]) +
          numberFrom(row, ["sentbyte", "sent_bytes", "upload"])) /
          1024 ** 2;
  });
  const hourlyTotals = hourly.map((entry) => ({
    ...entry,
    total: Object.entries(entry).reduce(
      (sum, [key, value]) => sum + (key === "hour" ? 0 : Number(value) || 0),
      0,
    ),
  }));
  const peakHour = hourlyTotals.reduce(
    (peak, entry) => (entry.total > peak.total ? entry : peak),
    hourlyTotals[0],
  );
  const peakStart = Number(peakHour.hour.slice(0, 2));
  const peakRange = `${String(peakStart).padStart(2, "0")}:00–${String((peakStart + 1) % 24).padStart(2, "0")}:00`;
  const deviceNames = Object.fromEntries(
    listFrom(devices).map((device) => [
      device.ipv4_address,
      device.asset_user_name
        ? `${device.asset_user_name} · ${device.hostname || device.device_type || "system"}`
        : device.hostname || device.device_type || "Unknown device",
    ]),
  );
  const consumers = Object.values(
    logs.reduce((summary, row) => {
      const detection = identifiedApplication(row);
      const application = detection.name;
      const ip = textFrom(row, ["srcip", "source_ip", "ip"], "Unknown IP");
      const key = `${application}|${ip}`;
      if (!summary[key])
        summary[key] = {
          application,
          identified: detection.confidence === "identified",
          ip,
          device: row.asset_user_name
            ? `${row.asset_user_name} · ${row.srcname || row.source_name || row.devtype || row.source_device_type || "system"}`
            : deviceNames[ip] || row.srcname || row.source_name || ip,
          total: 0,
        };
      summary[key].total +=
        numberFrom(row, ["rcvdbyte", "received_bytes", "download"]) +
        numberFrom(row, ["sentbyte", "sent_bytes", "upload"]);
      return summary;
    }, {}),
  )
    .sort((a, b) => b.total - a.total)
    .filter((consumer) =>
      applications.length ? consumer.identified : !consumer.identified,
    )
    .filter(
      (consumer, index, all) =>
        all.findIndex((item) => item.application === consumer.application) ===
        index,
    )
    .slice(0, 12);
  const smallerApplications = applications
    .filter((app) => app.total > 0)
    .slice()
    .sort((a, b) => a.total - b.total)
    .slice(0, 12);
  const smallerServices = networkServices
    .filter((service) => service.total > 0)
    .slice()
    .sort((a, b) => a.total - b.total)
    .slice(0, 12);
  const applicationInventory = applications
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const serviceInventory = networkServices
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const primaryEntries = applications.length ? applications : networkServices;
  const inventoryEntries = applications.length
    ? applicationInventory
    : serviceInventory;
  const smallerEntries = applications.length
    ? smallerApplications
    : smallerServices;
  const topApplication = primaryEntries[0];
  const identifiedDevices = new Set(
    logs
      .map((row) => row.srcip || row.source_ip || row.srcmac || row.source_mac)
      .filter(Boolean),
  ).size;
  const activePolicyCount = Number(policyCoverage?.active || 0);
  const applicationControlPolicyCount = Number(
    policyCoverage?.configured || 0,
  );
  const hasPolicyCoverage = Boolean(policyCoverage);
  const displayedPeriod =
    reportPeriod?.start || reportPeriod?.end
      ? `${formatUsageRangeTimestamp(reportPeriod?.start)} → ${formatUsageRangeTimestamp(reportPeriod?.end)} IST`
      : "selected reporting period";
  const trafficScope = reportSummary?.archive_fallback
    ? "verified saved reporting period"
    : "selected reporting period";
  const applicationControlConfigured = applicationControlPolicyCount > 0;
  const inspectionTitle =
    inspection?.state === "identified"
      ? "FortiGate Application Control data verified"
      : inspection?.state === "unavailable"
        ? "Application Control endpoint unavailable"
        : hasPolicyCoverage && !applicationControlConfigured
          ? "Application identification is not configured on active policies"
          : "No Application Control detections in this period";
  return (
    <div className="flex flex-col gap-4">
      {reportSummary?.archive_fallback && (
        <div className="order-1 flex flex-wrap items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
          <div className="min-w-0 flex-1">
            <b>Showing the latest verified saved firewall report</b>
            <p className="mt-1 text-[11px] leading-5 text-blue-800/80">
              {Number(reportSummary.records || 0).toLocaleString()}
              {reportSummary.records_sampled
                ? ` of ${Number(reportSummary.records_available || 0).toLocaleString()}`
                : ""}{" "}
              appliance-verified records from{" "}
              {formatUsageRangeTimestamp(reportPeriod?.start)} →{" "}
              {formatUsageRangeTimestamp(reportPeriod?.end)} IST. {reportSummary.fallback_reason}.
              {reportSummary.archive_protected_before_downtime
                ? " This report was protected before downtime."
                : ""}
            </p>
          </div>
          <Badge className="border border-blue-200 bg-white text-blue-700">
            Saved data
          </Badge>
        </div>
      )}
      {inspection && (
        <div
          className={`order-1 rounded-xl border px-4 py-3 text-xs ${
            inspection.state === "identified"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : inspection.state === "unavailable"
                ? "border-red-200 bg-red-50 text-red-800"
                : !applicationControlConfigured
                  ? "border-blue-200 bg-blue-50 text-blue-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <b>{inspectionTitle}</b>
            {hasPolicyCoverage && (
              <span className="rounded-full border border-current/15 bg-white/70 px-2.5 py-1 font-semibold">
                {applicationControlPolicyCount.toLocaleString()} of{" "}
                {activePolicyCount.toLocaleString()} active allow policies
              </span>
            )}
            {inspection.state === "identified" && (
              <>
                <span>
                  {Number(inspection.rows_in_period || 0).toLocaleString()} app
                  events · {Number(inspection.unique_applications || 0).toLocaleString()} identified apps
                </span>
                <span>
                  {Number(inspection.matched_traffic_records || 0).toLocaleString()} traffic records matched
                </span>
              </>
            )}
          </div>
          <p className="mt-1 text-[11px] opacity-80">
            {inspection.error
              ? inspection.error
              : inspection.state === "identified"
                ? `Categories: ${(inspection.categories || []).join(", ") || "not supplied"} · Risks: ${(inspection.risks || []).join(", ") || "not supplied"}.`
                : !applicationControlConfigured
                  ? `Traffic logging is working and the ${trafficScope} still contains exact service/protocol, source, destination and bandwidth data. Exact application names require an Application Control profile on the relevant policy.`
                  : `Traffic for the ${trafficScope} is still available as exact firewall service/protocol data. Those records are listed separately and are not counted as identified applications.`}
          </p>
          {inspection.state !== "identified" &&
            inspection.retained_applications?.length > 0 && (
              <details className="group mt-3 rounded-lg border border-current/10 bg-white/70">
                <summary className="flex cursor-pointer list-none items-center gap-2 p-3 font-semibold">
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                  Historical detections ·{" "}
                  {formatUsageRangeTimestamp(inspection.retained_period?.start)} →{" "}
                  {formatUsageRangeTimestamp(inspection.retained_period?.end)} IST
                  <span className="ml-auto font-normal opacity-70">
                    {inspection.retained_applications.length.toLocaleString()} apps
                  </span>
                </summary>
                <div className="border-t border-current/10 p-3">
                  <p className="text-[11px] opacity-75">
                    These are historical firewall detections for reference only.
                    They are not added to the displayed bandwidth totals.
                  </p>
                  <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                    {inspection.retained_applications.map((app) => {
                      const friendlyName = friendlyFirewallApplicationName(
                        app.name,
                      );
                      return (
                      <span
                        key={app.name}
                        title={`${friendlyName !== app.name ? `FortiGate signature ${app.name} · ` : ""}${app.category} · risk ${app.risk} · ${app.events} events · ${app.source_systems} source systems`}
                        className={`rounded-md border px-2.5 py-1.5 text-[11px] font-semibold ${applicationTone(app.category, app.name)}`}
                      >
                        {friendlyName} · {Number(app.events).toLocaleString()}
                      </span>
                      );
                    })}
                  </div>
                </div>
              </details>
            )}
        </div>
      )}
      <div className="order-1 grid gap-px overflow-hidden rounded-2xl border border-[#DDE2EA] bg-[#DDE2EA] shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            Observed network traffic
          </p>
          <b className="mt-1 block text-xl">{formatBytes(totalTraffic)}</b>
          <span className="text-xs text-[#9CA3AF]">
            across {listFrom(devices).length.toLocaleString()} devices
          </span>
        </div>
        <div className="bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {applications.length ? "Top application" : "Top network service"}
          </p>
          <b className="mt-1 block truncate text-xl">{topApplication?.name}</b>
          <span className="text-xs text-[#9CA3AF]">
            {formatBytes(topApplication?.total)} ·{" "}
            {totalTraffic
              ? Math.round((topApplication?.total / totalTraffic) * 100)
              : 0}
            % of traffic
          </span>
        </div>
        <div className="bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            Peak hour
          </p>
          <b className="mt-1 block text-xl">{peakRange}</b>
          <span className="text-xs text-[#9CA3AF]">
            {peakHour.total.toFixed(1)} MB observed traffic
          </span>
        </div>
        <div className="bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {applications.length
              ? "Currently identified apps"
              : "Application Control coverage"}
          </p>
          <b className="mt-1 block text-xl">
            {applications.length
              ? applications.length
              : hasPolicyCoverage
                ? `${applicationControlPolicyCount} / ${activePolicyCount}`
                : "—"}
          </b>
          <span className="text-xs text-[#9CA3AF]">
            {applications.length
              ? `${formatBytes(identifiedTraffic)} identified by Application Control`
              : "active allow policies have an Application Control profile"}
          </span>
        </div>
      </div>
      <div className="order-7">
        <UserActivityExplorer logs={logs} devices={devices} firewall={firewall} />
      </div>
      <div className="order-6 overflow-hidden rounded-2xl border border-[#CCD5FF] bg-white shadow-sm">
        <div className="border-b border-[#E0E5FF] px-5 py-4">
          <h3 className="text-lg font-bold">
            {applications.length
              ? "Application intelligence"
              : "Current traffic and service intelligence"}
          </h3>
          <p className="text-xs text-[#98A0B3]">
            Firewall classification coverage, observed traffic and source
            systems for the {trafficScope}
          </p>
        </div>
        <div className="grid gap-px bg-[#E0E5FF] sm:grid-cols-2 lg:grid-cols-4">
          {(applications.length
            ? [
                [
                  "Firewall identified",
                  applications.length,
                  "applications identified by the firewall",
                ],
                [
                  "Source devices observed",
                  identifiedDevices,
                  "devices represented in traffic logs",
                ],
                [
                  "Application traffic",
                  formatBytes(identifiedTraffic),
                  "traffic tied to firewall-identified applications",
                ],
                [
                  "Network service labels",
                  networkServices.length,
                  "protocol/service entries kept separate from apps",
                ],
              ]
            : [
                [
                  "Network service labels",
                  networkServices.length,
                  "exact service/protocol labels from traffic logs",
                ],
                [
                  "Source systems observed",
                  identifiedDevices,
                  "systems represented in the displayed traffic",
                ],
                [
                  "Observed service traffic",
                  formatBytes(totalTraffic),
                  "upload and download volume in this report",
                ],
                [
                  "App Control policies",
                  hasPolicyCoverage
                    ? `${applicationControlPolicyCount} / ${activePolicyCount}`
                    : "—",
                  "configured active allow policies",
                ],
              ]
          ).map(([label, metric, note]) => (
            <div key={label} className="bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7B86A4]">
                {label}
              </p>
              <b className="mt-1 block text-2xl text-[#3349A8]">{metric}</b>
              <span className="text-xs text-[#98A0B3]">{note}</span>
            </div>
          ))}
        </div>
        {applications.length ? (
          <div className="flex flex-wrap gap-2 p-5">
            {applications.map((app) => (
              <span
                key={app.name}
                className="rounded-lg border border-[#DDE3FF] bg-[#F5F7FF] px-3 py-2 text-xs font-semibold text-[#4F63BD]"
              >
                {app.name} · {formatBytes(app.total)}
              </span>
            ))}
          </div>
        ) : (
          <div className="p-5 text-sm text-[#69738B]">
            The displayed traffic contains service/protocol labels, not exact
            application identities. Enable an Application Control profile on
            the relevant firewall policies to classify external applications;
            no application names are inferred or fabricated here.
          </div>
        )}
      </div>
      <div className="order-3">
        <div className="overflow-hidden rounded-2xl border border-[#DDE2EA] bg-white shadow-sm">
          <div className="border-b border-[#DDE2EA] px-6 py-5">
            <h3 className="text-lg font-bold">
              Usage by hour
            </h3>
            <p className="text-xs text-[#9CA3AF]">
              Observed network volume by hour · peak hour {peakRange}
            </p>
          </div>
          <div className="px-5 py-5">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyTotals}>
                  <CartesianGrid
                    stroke="#E8ECF2"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis dataKey="hour" interval={2} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} unit=" MB" />
                  <Tooltip />
                  {topCategories.map((category) => (
                    <Bar
                      key={category.name}
                      dataKey={category.name}
                      stackId="traffic"
                      fill={category.color}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-3 pt-3">
              {topCategories.map((category) => (
                <span
                  key={category.name}
                  className="flex items-center gap-1 text-xs text-[#6B7280]"
                >
                  <i
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ background: category.color }}
                  />
                  {category.name}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="hidden">
          <div className="flex items-center justify-between border-b border-[#DDE2EA] px-6 py-5">
            <h3 className="text-lg font-bold">Traffic by category</h3>
            <Badge variant="outline">today</Badge>
          </div>
          <div className="p-5">
            <p className="text-xs text-[#9CA3AF]">
              Share of observed application volume
            </p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categories}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={76}
                    paddingAngle={2}
                  >
                    {categories.map((item) => (
                      <Cell key={item.name} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(bytes) => [formatBytes(bytes), "Traffic"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {categories.slice(0, 7).map((item) => (
                <div
                  key={item.name}
                  className="flex items-center gap-2 text-xs"
                >
                  <i
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ background: item.color }}
                  />
                  <span className="truncate text-[#6B7280]">{item.name}</span>
                  <b className="ml-auto">{formatBytes(item.value)}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="order-5 grid gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-[#DDE2EA] bg-white shadow-sm">
          <div className="border-b border-[#DDE2EA] px-5 py-4">
            <h3 className="text-lg font-bold">
              {applications.length
                ? "Smaller bandwidth-consuming applications"
                : "Lower-volume network services"}
            </h3>
            <p className="text-xs text-[#98A0B3]">
              {applications.length
                ? "Lowest-volume firewall-identified applications"
                : "Lowest-volume service/protocol labels in this traffic sample"}
            </p>
          </div>
          <div className="grid gap-x-6 px-5 py-4 sm:grid-cols-2">
            {smallerEntries.map((app, index) => (
              <div
                key={app.name}
                className="flex items-center gap-3 border-b border-[#EDF0F4] py-3"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#F2F4F8] text-xs font-bold text-[#69738B]">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-sm">{app.name}</b>
                  <span className="text-xs text-[#98A0B3]">
                    {app.category} · {app.sessions.toLocaleString()} sessions
                  </span>
                </div>
                <div className="text-right">
                  <b className="text-sm">{formatBytes(app.total)}</b>
                  <span className="block text-[11px] text-[#98A0B3]">
                    {totalTraffic
                      ? ((app.total / totalTraffic) * 100).toFixed(3)
                      : "0.000"}
                    %
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-[#DDE2EA] bg-white shadow-sm">
          <div className="border-b border-[#DDE2EA] px-5 py-4">
            <h3 className="text-lg font-bold">
              {applications.length
                ? "All detected applications"
                : "Network services and protocols"}
            </h3>
            <p className="text-xs text-[#98A0B3]">
              {inventoryEntries.length}{" "}
              {applications.length
                ? "firewall-identified applications"
                : "service/protocol labels in the current sample"}
            </p>
          </div>
          <div className="flex max-h-80 flex-wrap content-start gap-2 overflow-y-auto p-5">
            {inventoryEntries.map((app) => (
              <span
                key={app.name}
                title={`${app.category} · ${formatBytes(app.total)} · ${app.sessions} sessions`}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${applicationTone(app.category, app.name)}`}
              >
                <i className="h-2 w-2 rounded-full bg-current opacity-70" />
                {app.name}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="order-2 grid items-start gap-4 xl:grid-cols-[1.55fr_1fr]">
        <div className="overflow-x-auto rounded-2xl border border-[#DDE2EA] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#DDE2EA] px-5 py-4">
            <h3 className="text-lg font-bold">
              {applications.length
                ? "Top applications"
                : "Top network services and protocols"}
            </h3>
            <span className="text-sm text-[#98A0B3]">
              by total volume · {displayedPeriod}
            </span>
          </div>
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-[#FAFBFC] text-[11px] uppercase tracking-wider text-[#9CA3AF]">
              <tr>
                <th className="px-4 py-3">
                  {applications.length ? "Application" : "Network service"}
                </th>
                <th className="px-4 py-3">Category / risk</th>
                <th className="px-4 py-3 text-right">Sessions</th>
                <th className="px-4 py-3 text-right">Received</th>
                <th className="px-4 py-3 text-right">Sent</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Share</th>
              </tr>
            </thead>
            <tbody>
              {primaryEntries.slice(0, 8).map((app) => (
                <tr key={app.name} className="border-t border-[#EDF0F4]">
                  <td className="px-4 py-3 font-semibold">{app.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{app.category}</Badge>
                    <p className="mt-1 text-[10px] text-[#8B93A1]">
                      {app.identified
                        ? `Firewall identified · risk ${app.risk}`
                        : "Service/protocol only"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {app.sessions.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatBytes(app.received)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatBytes(app.sent)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold">
                    {formatBytes(app.total)}
                  </td>
                  <td className="min-w-32 px-4 py-3">
                    <div className="h-2 overflow-hidden rounded-full bg-[#E9EBF2]">
                      <div
                        className="h-full rounded-full bg-[#4F6EF7]"
                        style={{
                          width: `${totalTraffic ? (app.total / totalTraffic) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-[#DDE2EA] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#DDE2EA] px-5 py-4">
            <h3 className="text-lg font-bold">
              Top consumers per {applications.length ? "application" : "service"}
            </h3>
            <span className="text-sm text-[#98A0B3]">
              heaviest device for each {applications.length ? "app" : "service"}
            </span>
          </div>
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-[#FAFBFC] text-[11px] uppercase tracking-wider text-[#9CA3AF]">
              <tr>
                <th className="px-4 py-3">
                  {applications.length ? "Application" : "Network service"}
                </th>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">IP address</th>
                <th className="px-4 py-3 text-right">Usage</th>
                <th className="px-4 py-3 text-right">% of app</th>
              </tr>
            </thead>
            <tbody>
              {consumers.map((consumer) => (
                <tr
                  key={`${consumer.application}-${consumer.ip}`}
                  className="border-t border-[#EDF0F4]"
                >
                  <td className="px-4 py-3 font-semibold">
                    {consumer.application}
                  </td>
                  <td className="px-4 py-3">{consumer.device}</td>
                  <td className="px-4 py-3 font-mono text-xs">{consumer.ip}</td>
                  <td className="px-4 py-3 text-right font-bold">
                    {formatBytes(consumer.total)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(() => {
                      const appTotal =
                        usageEntries.find(
                          (app) => app.name === consumer.application,
                        )?.total || 0;
                      return appTotal
                        ? `${((consumer.total / appTotal) * 100).toFixed(1)}%`
                        : "—";
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TopApplicationsOverview({ value, onOpen, aggregates }) {
  const rows = listFrom(value);
  const aggregatedApplications = aggregates?.applications;
  const allApplications = aggregatedApplications
    ? aggregatedApplications.map((row) => ({
        name: row.name,
        total: Number(row.traffic_bytes || 0),
        identified: row.source_kind === "application_control",
      }))
    : Object.values(
    rows.reduce((summary, row) => {
      const detection = identifiedApplication(row);
      const name = detection.name;
      if (!summary[name])
        summary[name] = { name, total: 0, identified: false };
      summary[name].identified ||= detection.confidence === "identified";
      summary[name].total +=
        numberFrom(row, ["rcvdbyte", "received_bytes", "download"]) +
        numberFrom(row, ["sentbyte", "sent_bytes", "upload"]);
      return summary;
    }, {}),
  );
  allApplications.sort((a, b) => b.total - a.total);
  const applications = allApplications.slice(0, 5);
  if (!applications.length) return null;
  const maximum = Math.max(...applications.map((app) => app.total), 1);
  const total = allApplications.reduce((sum, app) => sum + app.total, 0);
  const topTraffic = applications.reduce((sum, app) => sum + app.total, 0);
  const identifiedCount = allApplications.filter((app) => app.identified).length;
  const colors = ["#4A5FE8", "#7C3AED", "#0E7490", "#5B6178", "#B45309"];
  return (
    <div className={FW_CARD}>
      <div className="flex items-start justify-between gap-3 px-[18px] pt-4">
        <div>
          <h3 className="text-sm font-bold tracking-tight">Top applications and services today</h3>
          <p className="mt-0.5 text-xs text-[#98A0B5]">
            By observed volume · {identifiedCount} firewall-identified apps ·{" "}
            {allApplications.length - identifiedCount} service/protocol labels
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 rounded-[10px] border border-[#E7E9F2] bg-white px-3 py-1.5 text-xs font-semibold text-[#181C2E] hover:bg-[#F7F8FB]"
        >
          Full view →
        </button>
      </div>
      <div className="space-y-3 p-[18px]">
        {applications.map((app, index) => (
          <div
            key={app.name}
            className="grid items-center gap-3 sm:grid-cols-[86px_1fr_112px]"
          >
            <b className="truncate text-xs font-semibold">{app.name}</b>
            <div className="h-2.5 overflow-hidden rounded-full bg-[#F0F1F7]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(app.total / maximum) * 100}%`,
                  background: colors[index],
                }}
              />
            </div>
            <span className="text-right text-[11.5px] text-[#5B6178]">
              <b className="text-[#181C2E]">{formatBytes(app.total)}</b> · {total ? Math.round((app.total / total) * 100) : 0}%
            </span>
          </div>
        ))}
        <p className="pt-1 text-[11px] text-[#98A0B5]">
          These five applications account for {total ? Math.round((topTraffic / total) * 100) : 0}% of observed traffic.
        </p>
      </div>
    </div>
  );
}

function SystemInformationPanel({ configuration, status, throughput }) {
  const config = configuration?.results || {};
  const system = status?.results || {};
  const enabledValue = (value) => {
    const enabled = value === true || value === "enable" || value === "enabled";
    return enabled ? (
      <Badge className="bg-emerald-50 text-emerald-700">●&nbsp; enabled</Badge>
    ) : (
      String(value ?? "—")
    );
  };
  const pairs = [
    [
      ["Hostname", system.hostname || config.hostname],
      [
        "Firmware",
        status?.version ? `${status.version} build ${status.build || ""}` : "—",
      ],
    ],
    [
      ["Timezone", config.timezone],
      ["VDOM mode", config["vdom-mode"]],
    ],
    [
      ["Minimum SSL", config["ssl-min-proto-version"]],
      ["Strong crypto", enabledValue(config["strong-crypto"])],
    ],
    [
      ["HTTPS admin port", config["admin-sport"]],
      ["SSH admin port", config["admin-ssh-port"]],
    ],
    [
      [
        "Admin timeout",
        config.admintimeout ? `${config.admintimeout} min` : "—",
      ],
      ["Cloud communication", enabledValue(config["cloud-communication"])],
    ],
    [
      [
        "Security rating schedule",
        enabledValue(config["security-rating-run-on-schedule"]),
      ],
      [
        "Throughput",
        throughput === "—" ? (
          <span>
            — <small className="text-[#98A0B3]">sensor unavailable</small>
          </span>
        ) : (
          throughput
        ),
      ],
    ],
  ];
  return (
    <div className="px-[18px] pb-4 pt-1">
      <div className="grid gap-x-10 md:grid-cols-2">
        {pairs.flat().map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 border-b border-[#F0F1F7] py-2 text-[12.5px]">
            <span className="text-[#5B6178]">{label}</span>
            <span className="text-right font-semibold text-[#181C2E]">
              {value ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SecurityEventsSummary({ value, onOpen }) {
  const events = listFrom(value);
  const groups = Object.values(
    events.reduce((summary, row) => {
      const title = textFrom(
        row,
        ["logdesc", "msg", "eventtype"],
        "Security event",
      );
      if (!summary[title])
        summary[title] = {
          title,
          count: 0,
          severity: textFrom(row, ["level", "severity"], "information"),
        };
      summary[title].count += 1;
      return summary;
    }, {}),
  )
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  const critical = events.filter((row) =>
    /critical|emergency|alert/i.test(textFrom(row, ["level", "severity"], "")),
  ).length;
  const warnings = events.filter((row) =>
    /warning/i.test(textFrom(row, ["level", "severity"], "")),
  ).length;
  return (
    <div className="overflow-hidden rounded-2xl border border-[#DDE2EA] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#DDE2EA] px-6 py-5">
        <h3 className="text-lg font-bold">Retained security events</h3>
        <button
          type="button"
          onClick={onOpen}
          className="rounded-xl bg-[#EEF1FF] px-4 py-2 text-sm font-bold text-[#5670F5]"
        >
          Open →
        </button>
      </div>
      <div className="space-y-6 px-6 py-6">
        {groups.length ? (
          groups.map((group, index) => (
            <div key={group.title} className="flex items-center gap-4">
              <div className="min-w-0">
                <b className="block truncate text-base">{group.title}</b>
                <p className="mt-1 text-sm text-[#98A0B3]">
                  {group.severity} ·{" "}
                  {group.count > 1 ? "recurring event" : "latest event"}
                </p>
              </div>
              <Badge
                className={`ml-auto shrink-0 ${index < 2 ? "bg-amber-50 text-amber-700" : "bg-slate-50 text-slate-600"}`}
              >
                ●&nbsp; {group.count}×
              </Badge>
            </div>
          ))
        ) : (
          <p className="text-sm text-[#98A0B3]">No security events returned.</p>
        )}
        <p className="border-t border-[#E5E9EF] pt-4 text-sm leading-6 text-[#98A0B3]">
          {critical} critical · {warnings} warning ·{" "}
          {events.length - critical - warnings} notice/info.{" "}
          {critical || warnings
            ? "Review the highlighted events."
            : "No critical issues detected."}
        </p>
      </div>
    </div>
  );
}

function SecurityEventsPanel({ value, sourceMeta = {} }) {
  const allEvents = listFrom(value);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [periodFilter, setPeriodFilter] = useState("today");
  const [selectedDate, setSelectedDate] = useState(firewallLocalDate());
  if (!allEvents.length)
    return <EmptyPanel title="Security events" configured />;
  const severityName = (row) => {
    const raw = textFrom(row, ["level", "severity", "crlevel"], "Information").toLowerCase();
    if (/critical|emergency|alert|error/.test(raw)) return "alert";
    if (/warn/.test(raw)) return "warning";
    if (/notice/.test(raw)) return "notice";
    return "information";
  };
  const sourceIp = (row) =>
    textFrom(row, ["srcip", "source_ip", "sourceIp", "src_ip", "ip"], "—");
  const isFailedAdminLogin = (row) => {
    const description = textFrom(
      row,
      ["message", "msg", "logdesc", "description", "eventtype"],
      "",
    );
    return (
      /(?:administrator|admin).{0,120}(?:login|logon).{0,120}(?:fail|invalid)/i.test(
        description,
      ) ||
      /(?:login|logon).{0,120}(?:fail|invalid).{0,120}(?:administrator|admin)/i.test(
        description,
      )
    );
  };
  const issueReason = (row) => {
    const source = textFrom(row, ["security_source"], "System event");
    const action = textFrom(row, ["action", "status"], "").trim();
    const explicitReason = textFrom(
      row,
      ["reason", "failure_reason", "event_reason"],
      "",
    ).trim();
    const description = textFrom(
      row,
      ["msg", "message", "logdesc", "description", "eventtype"],
      "Security event",
    ).trim();
    if (isFailedAdminLogin(row))
      return `The firewall rejected an administrator sign-in from ${sourceIp(row)} because the credentials or authentication attempt were not accepted.`;
    if (explicitReason && !/^(unknown|n\/a|none)$/i.test(explicitReason))
      return `Firewall-supplied reason: ${explicitReason}.`;
    if (source === "Antivirus") {
      const detection = textFrom(
        row,
        ["virus", "virusname", "filename", "msg"],
        "suspicious file or payload",
      );
      return `The antivirus engine detected ${detection}${action ? ` and recorded the action as ${action}` : ""}.`;
    }
    if (source === "Intrusion prevention") {
      const signature = textFrom(
        row,
        ["attack", "attack_name", "signature", "msg"],
        "an intrusion-prevention signature",
      );
      return `Traffic matched the IPS signature “${signature}”${action ? `; the firewall action was ${action}` : ""}.`;
    }
    if (source === "Web filter") {
      const target = textFrom(row, ["hostname", "url", "dstname"], "a web request");
      const category = textFrom(row, ["catdesc", "category"], "the configured web-filter policy");
      return `${target} matched ${category}${action ? ` and the firewall action was ${action}` : ""}.`;
    }
    if (source === "DNS filter") {
      const query = textFrom(row, ["qname", "domain", "hostname", "url"], "a DNS request");
      const category = textFrom(row, ["catdesc", "category"], "the configured DNS-filter policy");
      return `${query} matched ${category}${action ? ` and the firewall action was ${action}` : ""}.`;
    }
    if (/interface|link/.test(description.toLowerCase()) && /down|disconnect|lost/.test(description.toLowerCase()))
      return "The firewall detected that a network interface or link changed to a down/disconnected state.";
    if (/config|setting/.test(description.toLowerCase()) && /change|edit|update/.test(description.toLowerCase()))
      return "The firewall recorded an administrative configuration change for audit and security review.";
    if (/deny|block|drop/i.test(action))
      return `The firewall raised this record because the matched policy or security profile recorded the traffic action as ${action}.`;
    return `FortiGate emitted “${description}” as a ${severityName(row)}-severity ${source.toLowerCase()} record.`;
  };
  const sourceLocation = (row) => {
    const geo = row.source_geo || row.sourceGeo;
    if (!geo) return null;
    const parts = [geo.city, geo.region, geo.country].filter(
      (part, index, values) => part && values.indexOf(part) === index,
    );
    return {
      label: parts.join(", ") || "Location unavailable",
      network: geo.organization || geo.isp || geo.domain || "Network unavailable",
      asn: geo.asn ? `AS${geo.asn}` : "",
      countryCode: geo.country_code || geo.countryCode || "",
    };
  };
  const eventTimeline = allEvents.map((row) => {
    const timestamp = firewallEventTimestamp(row);
    return {
      row,
      timestamp,
      date: timestamp ? firewallLocalDate(timestamp) : null,
    };
  });
  const today = firewallLocalDate();
  const lastSevenStart = firewallLocalDate(
    new Date(`${today}T00:00:00+05:30`).getTime() - 6 * 86400000,
  );
  const events = eventTimeline
    .filter((entry) => {
      if (periodFilter === "retained") return true;
      if (periodFilter === "today") return entry.date === today;
      if (periodFilter === "7d")
        return entry.date && entry.date >= lastSevenStart && entry.date <= today;
      return entry.date === selectedDate;
    })
    .map((entry) => entry.row);
  const periodLabel =
    periodFilter === "retained"
      ? "Retained window"
      : periodFilter === "today"
        ? `Today · ${today}`
        : periodFilter === "7d"
          ? `${lastSevenStart} to ${today}`
          : selectedDate;
  const retainedTimestamps = eventTimeline
    .map((entry) => entry.timestamp)
    .filter(Boolean)
    .sort((left, right) => left - right);
  const retainedStart = retainedTimestamps[0] || null;
  const retainedEnd = retainedTimestamps.at(-1) || null;
  const sourceRows = Object.values(
    allEvents.reduce((summary, row) => {
      const name = textFrom(row, ["security_source"], "System event");
      if (!summary[name])
        summary[name] = {
          name,
          retained: 0,
          selected: 0,
          available: Number(sourceMeta[name]?.records_available || 0),
          complete: sourceMeta[name]?.complete !== false,
        };
      summary[name].retained += 1;
      return summary;
    }, Object.fromEntries(
      Object.entries(sourceMeta).map(([name, metadata]) => [
        name,
        {
          name,
          retained: 0,
          selected: 0,
          available: Number(metadata?.records_available || 0),
          complete: metadata?.complete !== false,
        },
      ]),
    )),
  );
  for (const row of events) {
    const source = sourceRows.find(
      (item) => item.name === textFrom(row, ["security_source"], "System event"),
    );
    if (source) source.selected += 1;
  }
  sourceRows.sort((left, right) => right.selected - left.selected || right.retained - left.retained);
  const retainedAvailable = sourceRows.reduce(
    (sum, source) => sum + Math.max(source.retained, source.available),
    0,
  );
  const sourceComplete = sourceRows.every((source) => source.complete);
  const dailyRows = Object.values(
    eventTimeline.reduce((summary, entry) => {
      if (!entry.date) return summary;
      if (!summary[entry.date])
        summary[entry.date] = {
          date: entry.date,
          total: 0,
          alert: 0,
          warning: 0,
          notice: 0,
          information: 0,
        };
      const severity = severityName(entry.row);
      summary[entry.date].total += 1;
      summary[entry.date][severity] += 1;
      return summary;
    }, {}),
  ).sort((left, right) => right.date.localeCompare(left.date));
  const failedAdminLogins = events.filter(isFailedAdminLogin);
  const failedLoginOrigins = Object.values(
    failedAdminLogins.reduce((origins, row) => {
      const geo = sourceLocation(row);
      const label = geo?.label || "Location unavailable";
      const key = `${label}|${geo?.network || ""}`;
      if (!origins[key])
        origins[key] = {
          key,
          label,
          network: geo?.network || "Geolocation service did not return a match",
          asn: geo?.asn || "",
          countryCode: geo?.countryCode || "",
          count: 0,
          ips: new Set(),
        };
      origins[key].count += 1;
      const ip = sourceIp(row);
      if (ip !== "—") origins[key].ips.add(ip);
      return origins;
    }, {}),
  ).sort((a, b) => b.count - a.count);
  const severityTotals = events.reduce((counts, row) => {
    const severity = severityName(row);
    counts[severity] = (counts[severity] || 0) + 1;
    return counts;
  }, {});
  const severityCounts = [
    { name: "alert", count: severityTotals.alert || 0, color: "#C41E3D", note: "requires review" },
    { name: "warning", count: severityTotals.warning || 0, color: "#E8833A", note: "elevated activity" },
    { name: "information", count: severityTotals.information || 0, color: "#4A5FE8", note: "routine activity" },
    { name: "notice", count: severityTotals.notice || 0, color: "#B45309", note: "system notices" },
  ].filter((item) => item.count > 0);
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, "0")}:00`,
    alert: 0,
    warning: 0,
    information: 0,
    notice: 0,
  }));
  events.forEach((row) => {
    const timestamp = firewallEventTimestamp(row);
    const hour = timestamp
      ? Number(
          timestamp.toLocaleString("en-GB", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            hourCycle: "h23",
          }),
        )
      : Number.NaN;
    if (Number.isInteger(hour) && hourly[hour]) hourly[hour][severityName(row)] += 1;
  });
  const groups = Object.values(
    events.reduce((summary, row) => {
      const title = textFrom(
        row,
        ["logdesc", "msg", "message", "eventtype"],
        "Security event",
      );
      const key = `${title}|${severityName(row)}`;
      if (!summary[key])
        summary[key] = {
          key,
          title,
          severity: severityName(row),
          count: 0,
          latest: row,
        };
      summary[key].count += 1;
      if (
        (firewallEventTimestamp(row)?.getTime() || 0) >
        (firewallEventTimestamp(summary[key].latest)?.getTime() || 0)
      )
        summary[key].latest = row;
      return summary;
    }, {}),
  ).sort((a, b) => b.count - a.count);
  const visibleGroups =
    severityFilter === "all"
      ? groups
      : groups.filter((group) => group.severity === severityFilter);
  const severityChipClass = (severity, active) => {
    if (severity === "all")
      return active
        ? "border-blue-200 bg-blue-100 text-blue-700"
        : "border-blue-200 bg-blue-50 text-blue-700";
    if (severity.includes("notice"))
      return active
        ? "border-amber-300 bg-amber-100 text-amber-800"
        : "border-amber-200 bg-amber-50 text-amber-700";
    if (severity.includes("information"))
      return active
        ? "border-indigo-300 bg-indigo-100 text-indigo-800"
        : "border-indigo-200 bg-indigo-50 text-indigo-700";
    if (severity.includes("warning"))
      return active
        ? "border-orange-300 bg-orange-100 text-orange-800"
        : "border-orange-200 bg-orange-50 text-orange-700";
    if (/critical|emergency|alert/.test(severity))
      return active
        ? "border-red-300 bg-red-100 text-red-800"
        : "border-red-200 bg-red-50 text-red-700";
    return active
      ? "border-slate-300 bg-slate-200 text-slate-800"
      : "border-slate-200 bg-slate-50 text-slate-700";
  };
  const detailItems = (row) => {
    const geo = sourceLocation(row);
    const items = [
      [
        "Description",
        textFrom(row, ["msg", "message", "logdesc", "description"]),
      ],
      ["Why this was raised", issueReason(row)],
      ["Event type", textFrom(row, ["eventtype", "eventType", "subtype", "type"])],
      ["Firewall source", textFrom(row, ["security_source"], "System event")],
      ["Event ID", textFrom(row, ["eventid", "eventId", "logid", "id", "uuid"])],
      [
        "Source / destination",
        `${sourceIp(row)} / ${textFrom(row, ["dstip", "destination_ip", "destinationIp", "dst_ip"], "—")}`,
      ],
      [
        "User / interface",
        `${textFrom(row, ["user", "username", "srcuser"], "—")} / ${textFrom(row, ["interface", "srcintf", "dstintf", "ui", "method"], "—")}`,
      ],
      [
        "Latest occurrence",
        formatUsageRangeTimestamp(firewallEventTimestamp(row)),
      ],
    ];
    if (isFailedAdminLogin(row)) {
      items.splice(
        4,
        0,
        [
          "Approximate source location",
          geo?.label || "Unavailable for this source IP",
        ],
        [
          "Source network",
          geo
            ? [geo.asn, geo.network].filter(Boolean).join(" · ")
            : "Unavailable for this source IP",
        ],
      );
    }
    return items;
  };
  return (
    <div className="space-y-4">
      <section className={`${FW_CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-3 border-b border-[#E7E9F2] px-[18px] py-4">
          <div className="mr-auto">
            <h3 className="text-sm font-bold">Security event coverage</h3>
            <p className="mt-0.5 text-xs text-[#98A0B5]">
              Per-day view and consolidated firewall retention window
            </p>
          </div>
          <AppSelect
            value={periodFilter}
            onValueChange={(value) => {
              setPeriodFilter(value);
              setSeverityFilter("all");
              setExpandedGroup(null);
            }}
            options={[["today", "Today"], ["7d", "Last 7 days"], ["day", "Select a day"], ["retained", "All retained events"]]}
            aria-label="Period"
            className="w-full border-[#DDE2EA] sm:w-auto"
          />
          {periodFilter === "day" && (
            <DateField
              value={selectedDate}
              max={today}
              onChange={setSelectedDate}
              aria-label="Select a day"
              className="h-9 w-full rounded-lg px-3 text-sm sm:w-auto"
            />
          )}
        </div>
        <div className="grid gap-px bg-[#E7E9F2] sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Selected period", events.length.toLocaleString(), periodLabel],
            [
              "Today",
              eventTimeline.filter((entry) => entry.date === today).length.toLocaleString(),
              today,
            ],
            [
              "Retained records returned",
              allEvents.length.toLocaleString(),
              retainedAvailable > allEvents.length
                ? `${retainedAvailable.toLocaleString()} reported available`
                : "current API retention window",
            ],
            [
              "Retained coverage",
              retainedStart && retainedEnd
                ? `${firewallLocalDate(retainedStart)} → ${firewallLocalDate(retainedEnd)}`
                : "Time unavailable",
              sourceComplete ? "all returned sources complete" : "one or more sources are partial",
            ],
          ].map(([label, metric, note]) => (
            <div key={label} className="bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7B8193]">
                {label}
              </p>
              <b className="mt-1 block text-xl text-[#181C2E]">{metric}</b>
              <p className="mt-1 text-[11px] text-[#98A0B5]">{note}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-px border-t border-[#E7E9F2] bg-[#E7E9F2] lg:grid-cols-2">
          <div className="bg-white p-[18px]">
            <h4 className="text-sm font-bold">Latest retained dates</h4>
            <p className="mt-0.5 text-xs text-[#98A0B5]">
              Daily bifurcation across every returned security source
            </p>
            <div className="mt-3 overflow-x-auto rounded-lg border border-[#EDF0F4]">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead className="bg-[#FAFBFC] uppercase tracking-wide text-[#8B93A1]">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Alerts</th>
                    <th className="px-3 py-2 text-right">Warnings</th>
                    <th className="px-3 py-2 text-right">Notice/info</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyRows.slice(0, 7).map((row) => (
                    <tr key={row.date} className="border-t border-[#EDF0F4]">
                      <td className="px-3 py-2 font-semibold">{row.date}</td>
                      <td className="px-3 py-2 text-right font-bold">{row.total.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-red-700">{row.alert.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-orange-700">{row.warning.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">{(row.notice + row.information).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="bg-white p-[18px]">
            <h4 className="text-sm font-bold">Source bifurcation</h4>
            <p className="mt-0.5 text-xs text-[#98A0B5]">
              Selected-period records versus the retained source response
            </p>
            <div className="mt-3 space-y-2">
              {sourceRows.map((source) => (
                <div key={source.name} className="flex items-center gap-3 rounded-lg border border-[#EDF0F4] px-3 py-2.5 text-xs">
                  <span className="min-w-0 flex-1 truncate font-semibold">{source.name}</span>
                  <span className="text-[#69738B]">
                    selected <b className="text-[#181C2E]">{source.selected.toLocaleString()}</b>
                  </span>
                  <span className="text-[#69738B]">
                    retained <b className="text-[#181C2E]">{source.retained.toLocaleString()}</b>
                    {source.available > source.retained
                      ? ` / ${source.available.toLocaleString()}`
                      : ""}
                  </span>
                  {!source.complete && (
                    <Badge className="bg-amber-50 text-amber-800">Partial</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="border-t border-[#E7E9F2] bg-[#FFFDF7] px-[18px] py-3 text-[11px] leading-5 text-[#6B6470]">
          <b>Retention meaning:</b> consolidated counts cover only the records
          currently retained and returned by the firewall APIs; they are not a
          lifetime total from appliance startup. The date filter above applies
          to the event stream, severity chart, and failed-login origins below.
        </p>
      </section>
      <div className="grid gap-3.5 xl:grid-cols-[1.55fr_1fr]">
        <div className={FW_CARD}>
          <div className="flex flex-wrap items-start justify-between gap-3 px-[18px] pt-4">
            <div><h3 className="text-sm font-bold">Events by hour · {periodLabel}</h3><p className="mt-0.5 text-xs text-[#98A0B5]">{events.length.toLocaleString()} events in the selected period · grouped by severity</p></div>
            <div className="flex flex-wrap gap-3 text-[11.5px] text-[#5B6178]">{severityCounts.map((item) => <span key={item.name} className="flex items-center gap-1.5 capitalize"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: item.color }} />{item.name}</span>)}</div>
          </div>
          <div className="h-[190px] px-3 pb-3 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourly}>
                <CartesianGrid stroke="#F0F1F7" vertical={false} />
                <XAxis dataKey="hour" interval={2} tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="alert" stackId="events" fill="#C41E3D" />
                <Bar dataKey="warning" stackId="events" fill="#E8833A" />
                <Bar dataKey="information" stackId="events" fill="#4A5FE8" />
                <Bar dataKey="notice" stackId="events" fill="#B45309" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={FW_CARD}>
          <div className="px-[18px] pt-4"><h3 className="text-sm font-bold">Severity breakdown</h3><p className="mt-0.5 text-xs text-[#98A0B5]">Proportions plus operational meaning</p></div>
          <div className="p-[18px]">
            <div className="flex h-[18px] overflow-hidden rounded-lg">{severityCounts.map((item) => <div key={item.name} style={{ width: `${(item.count / events.length) * 100}%`, background: item.color }} title={`${item.name}: ${item.count}`} />)}</div>
            <div className="mt-3.5">{severityCounts.map((item) => <div key={item.name} className="flex items-center justify-between border-b border-[#F0F1F7] py-2 text-[12.5px] last:border-0"><span className="flex items-center gap-2 capitalize text-[#5B6178]"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: item.color }} />{item.name}</span><b className="tabular-nums">{item.count.toLocaleString()} · {item.note}</b></div>)}</div>
            {severityTotals.alert > 1 && <p className="mt-3 rounded-[10px] bg-[#FCE9ED] px-3 py-2.5 text-xs font-medium text-[#C41E3D]">Recurring alerts are grouped below so repeated records can be handled as one incident.</p>}
          </div>
        </div>
      </div>
      {failedAdminLogins.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#F1D7DC] bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#F1E3E6] bg-[#FFF9FA] px-[18px] py-4">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#FCE9ED] text-[#C41E3D]">
                <MapPin className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h3 className="text-sm font-bold">Failed administrator-login origins</h3>
                <p className="mt-0.5 text-xs text-[#7B8193]">
                  {failedAdminLogins.length.toLocaleString()} attempts from {new Set(failedAdminLogins.map(sourceIp).filter((ip) => ip !== "—")).size.toLocaleString()} public IPs
                </p>
              </div>
            </div>
            <Badge className="border border-amber-200 bg-amber-50 text-amber-800">
              Approximate IP location
            </Badge>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {failedLoginOrigins.slice(0, 6).map((origin) => (
              <div key={origin.key} className="rounded-[11px] border border-[#E7E9F2] bg-[#FBFCFE] p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">
                      {origin.countryCode ? `${origin.countryCode} · ` : ""}{origin.label}
                    </p>
                    <p className="mt-1 truncate text-xs text-[#7B8193]">
                      {[origin.asn, origin.network].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Badge className="shrink-0 bg-red-50 text-red-700">{origin.count}×</Badge>
                </div>
                <p className="mt-3 text-[11px] font-medium text-[#98A0B5]">
                  {origin.ips.size} source {origin.ips.size === 1 ? "IP" : "IPs"} · {Array.from(origin.ips).slice(0, 2).join(", ")}
                  {origin.ips.size > 2 ? ` +${origin.ips.size - 2}` : ""}
                </p>
              </div>
            ))}
          </div>
          <p className="border-t border-[#EEF0F5] px-[18px] py-3 text-[11px] leading-5 text-[#7B8193]">
            Location is inferred from public IP registration and may identify a VPN, proxy, or hosting provider rather than the operator’s physical location.
          </p>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-[#E5E9EF] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E9EF] p-4">
          <div>
            <h3 className="font-bold">Event stream</h3>
            <p className="text-xs text-[#9CA3AF]">
              Identical recurring events are grouped; expand for latest
              occurrence details
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "all", label: "All", count: events.length },
              ...severityCounts.map((item) => ({
                key: item.name,
                label: item.name,
                count: item.count,
              })),
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSeverityFilter(item.key)}
                className={`rounded-full border px-4 py-2 text-xs font-semibold capitalize transition hover:brightness-95 ${severityChipClass(item.key, severityFilter === item.key)}`}
              >
                {item.label} · {item.count}
              </button>
            ))}
          </div>
        </div>
        {visibleGroups.map((group) => {
          const expanded = expandedGroup === group.key;
          return (
            <div
              key={group.key}
              className="border-b border-[#EDF0F4] last:border-0"
            >
              <button
                type="button"
                onClick={() => setExpandedGroup(expanded ? null : group.key)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-[#F8F9FC]"
              >
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-50 text-amber-700">
                  <ShieldAlert className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <b>{group.title}</b>
                  <p className="text-xs text-[#9CA3AF]">
                    latest{" "}
                    {formatUsageRangeTimestamp(
                      firewallEventTimestamp(group.latest),
                    )}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[#69738B]">
                    <b>Reason:</b> {issueReason(group.latest)}
                  </p>
                </div>
                <Badge className="ml-auto bg-amber-100 text-amber-800 capitalize">
                  {group.severity}
                </Badge>
                <Badge className="bg-slate-100 text-slate-700">
                  {group.count}×
                </Badge>
                <ChevronDown
                  className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`}
                />
              </button>
              {expanded && (
                <div className="grid gap-3 bg-[#F8F9FC] p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {detailItems(group.latest).map(([label, detail]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-[#E5E9EF] bg-white p-3"
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                        {label}
                      </p>
                      <p className="mt-1 break-words text-sm font-semibold">
                        {detail}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!visibleGroups.length && (
          <div className="px-5 py-10 text-center">
            <Shield className="mx-auto h-7 w-7 text-[#A5ADBD]" />
            <p className="mt-2 text-sm font-semibold">
              No security events in {periodLabel.toLowerCase()}
            </p>
            <p className="mt-1 text-xs text-[#98A0B5]">
              Choose another date or All retained events to inspect the
              firewall&apos;s retained records.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function FirewallAggregateBars({ title, subtitle, rows, empty, valueOf, labelOf }) {
  const top = Math.max(...rows.map((row) => valueOf(row)), 1);
  return (
    <section className={`${FW_CARD} overflow-hidden`}>
      <div className="border-b border-[#E7E9F2] px-[18px] py-4">
        <h3 className="text-sm font-bold">{title}</h3>
        <p className="mt-0.5 text-xs text-[#98A0B5]">{subtitle}</p>
      </div>
      {rows.length ? (
        <div className="space-y-3 p-[18px]">
          {rows.map((row) => (
            <div
              key={row.name}
              className="grid gap-2 md:grid-cols-[200px_1fr_110px] md:items-center"
            >
              <div>
                <b className="block truncate text-[12.5px]">{row.name}</b>
                <span className="text-[10.5px] text-[#98A0B5]">{labelOf(row)}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-[#F0F1F7]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#4A5FE8] to-[#0E7490]"
                  style={{ width: `${Math.max(2, (valueOf(row) / top) * 100)}%` }}
                />
              </div>
              <b className="text-right text-[13px] tabular-nums">
                {formatBytes(row.traffic_bytes)}
              </b>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-6 text-sm text-[#69738B]">{empty}</div>
      )}
    </section>
  );
}

function FirewallApplicationsPanel({ report }) {
  const applications = report?.aggregates?.applications || [];
  const control = report?.summary?.application_control || {};
  const identified = applications.filter(
    (row) => row.source_kind === "application_control",
  ).length;
  return (
    <section className={`${FW_CARD} overflow-hidden`}>
      <div className="border-b border-[#E7E9F2] px-[18px] py-4">
        <h3 className="text-sm font-bold">Applications in use</h3>
        <p className="mt-0.5 text-xs text-[#98A0B5]">
          Every application and service seen on traffic in the selected period ·{" "}
          {applications.length.toLocaleString()} distinct
        </p>
      </div>
      {control.state !== "identified" && (
        <div className="border-b border-amber-200 bg-amber-50 px-[18px] py-3 text-xs text-amber-800">
          <b>Application Control is not naming applications right now.</b> The
          appliance returned{" "}
          {Number(control.rows_in_period || 0).toLocaleString()} app-control
          events for this period
          {Number(control.retained_events || 0) > 0 &&
            control.retained_period?.start && (
              <>
                {" "}
                (it still retains{" "}
                {Number(control.retained_events).toLocaleString()} events from{" "}
                {formatUsageRangeTimestamp(control.retained_period.start)})
              </>
            )}
          . The names below come from the traffic log&apos;s service field, so
          they identify the protocol or port rather than the application. Enable
          an Application Control profile with memory logging on the firewall
          policies to resolve real application names.
        </div>
      )}
      <div className="grid gap-px bg-[#E7E9F2] sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Distinct applications", applications.length.toLocaleString()],
          ["Named by App Control", identified.toLocaleString()],
          [
            "App-control events",
            Number(control.rows_in_period || 0).toLocaleString(),
          ],
          [
            "Top application",
            applications[0]?.name || "—",
          ],
        ].map(([label, value]) => (
          <div key={label} className="bg-white px-[18px] py-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#98A0B5]">
              {label}
            </div>
            <div className="mt-1 truncate text-[15px] font-bold">{value}</div>
          </div>
        ))}
      </div>
      {applications.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[12.5px]">
            <thead className="bg-[#F8FAFC] text-[10.5px] uppercase tracking-wide text-[#98A0B5]">
              <tr>
                {[
                  "Application",
                  "Source",
                  "Category",
                  "Risk",
                  "Records",
                  "Clients",
                  "Destinations",
                  "Traffic",
                  "Last seen",
                ].map((column) => (
                  <th key={column} className="px-3 py-2 font-semibold">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {applications.map((row) => (
                <tr key={row.name} className="border-t border-[#EEF0F6]">
                  <td className="px-3 py-2 font-semibold">{row.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10.5px] ${
                        row.source_kind === "application_control"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {row.source_kind === "application_control"
                        ? "App Control"
                        : "Service"}
                    </span>
                  </td>
                  <td className="px-3 py-2">{row.category || "—"}</td>
                  <td className="px-3 py-2">{row.risk || "—"}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.records.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{row.sources}</td>
                  <td className="px-3 py-2 tabular-nums">{row.destinations}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatBytes(row.traffic_bytes)}
                  </td>
                  <td className="px-3 py-2 text-[#69738B]">
                    {row.last_seen
                      ? formatUsageRangeTimestamp(row.last_seen)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-6 text-sm text-[#69738B]">
          No application or service activity was returned for this period.
        </div>
      )}
    </section>
  );
}

function InterfacePeriodUsage({ firewall }) {
  const [range, setRange] = useState("today");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const queryString = bandwidthQuery(range);
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setReport(null);
    api(`/firewall/report?${queryString}&firewall=${firewall}`, {
      signal: controller.signal,
      timeout: 60000,
    })
      .then(setReport)
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [range, firewall]);

  // `records` is a bounded page of the period (the full set reaches ~236k rows
  // on HQ), so every total here comes from the server-side aggregate, which is
  // computed over all of them.
  const interfaceUsage = (report?.aggregates?.interfaces || []).map((row) => ({
    name: row.name,
    received: row.received_bytes,
    sent: row.sent_bytes,
    total: row.traffic_bytes,
    records: row.records,
  }));
  const busiest = Math.max(...interfaceUsage.map((row) => row.total), 1);
  const sourceSystems = Number(report?.aggregates?.source_systems || 0);

  return (
    <div className="space-y-4">
      <section className={`${FW_CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-3 border-b border-[#E7E9F2] px-[18px] py-4">
          <div className="mr-auto">
            <h3 className="text-sm font-bold">Interface usage by period</h3>
            <p className="mt-0.5 text-xs text-[#98A0B5]">
              Timestamped traffic logs grouped by source interface · {firewall.toUpperCase()}
            </p>
          </div>
          <AppSelect
            value={range}
            onValueChange={setRange}
            options={BANDWIDTH_RANGES}
            aria-label="Range"
            className="w-full border-[#DDE2EA] sm:w-auto"
          />
          {loading && <RefreshCw className="h-4 w-4 animate-spin text-[#4A5FE8]" />}
        </div>
        <div
          className={`border-b px-[18px] py-3 text-xs ${
            error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-[#E7E9F2] bg-[#F8FAFC] text-[#5B6178]"
          }`}
        >
          {error ? (
            `Unable to load interface usage: ${error}`
          ) : report?.period ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Clock3 className="h-3.5 w-3.5 text-[#4A5FE8]" />
              <b className="text-[#374151]">Usage period:</b>
              <span>{formatUsageRangeTimestamp(report.period.start)}</span>
              <span>→</span>
              <span>{formatUsageRangeTimestamp(report.period.end)} IST</span>
              {report.summary?.record_limit_reached && (
                <span className="font-semibold text-[#B45309]">
                  · API row limit reached; totals may be partial.
                </span>
              )}
              {report.summary?.source_complete === false &&
                !report.summary?.record_limit_reached && (
                  <span className="font-semibold text-[#B45309]">
                    · The firewall did not return every retained source row;
                    totals may be partial.
                  </span>
                )}
            </span>
          ) : (
            "Loading the selected usage period…"
          )}
        </div>
        <div className="grid gap-px bg-[#E7E9F2] sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Usage in period", formatBytes(report?.summary?.traffic_bytes || 0)],
            ["Traffic records", Number(report?.summary?.records || 0).toLocaleString()],
            ["Source interfaces", interfaceUsage.length],
            ["Systems observed", sourceSystems],
          ].map(([label, metric]) => (
            <div key={label} className="bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#98A0B5]">
                {label}
              </p>
              <b className="mt-1 block text-xl tabular-nums">{metric}</b>
            </div>
          ))}
        </div>
        {!loading && !error && (
          interfaceUsage.length ? (
            <div className="space-y-3 p-[18px]">
              {interfaceUsage.slice(0, 10).map((row) => (
                <div key={row.name} className="grid gap-2 md:grid-cols-[180px_1fr_100px] md:items-center">
                  <div>
                    <b className="block truncate text-[12.5px]">{row.name}</b>
                    <span className="text-[10.5px] text-[#98A0B5]">
                      {row.records.toLocaleString()} records
                    </span>
                  </div>
                  <div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-[#F0F1F7]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#4A5FE8] to-[#0E7490]"
                        style={{ width: `${Math.max(2, (row.total / busiest) * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10.5px] text-[#98A0B5]">
                      <span>↓ {formatBytes(row.received)}</span>
                      <span>↑ {formatBytes(row.sent)}</span>
                    </div>
                  </div>
                  <b className="text-right text-[13px] tabular-nums">
                    {formatBytes(row.total)}
                  </b>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-sm text-[#69738B]">
              No interface traffic was returned for the selected date range.
            </div>
          )
        )}
      </section>
      <FirewallApplicationsPanel report={report} />
      <FirewallAggregateBars
        title="Destination interfaces"
        subtitle="Where traffic left the appliance in this period"
        rows={(report?.aggregates?.destination_interfaces || []).slice(0, 10)}
        empty="No destination interface traffic in this period."
        valueOf={(row) => row.traffic_bytes}
        labelOf={(row) => `${row.records.toLocaleString()} records`}
      />
      <FirewallAggregateBars
        title="Firewall policies"
        subtitle="Policy that matched each session"
        rows={(report?.aggregates?.policies || []).slice(0, 10)}
        empty="The traffic log did not name a policy for this period."
        valueOf={(row) => row.traffic_bytes}
        labelOf={(row) => `${row.records.toLocaleString()} sessions`}
      />
      <FirewallAggregateBars
        title="Destination countries"
        subtitle="Where outbound sessions terminated"
        rows={(report?.aggregates?.destination_countries || []).slice(0, 10)}
        empty="No destination country was resolved for this period."
        valueOf={(row) => row.traffic_bytes}
        labelOf={(row) => `${row.records.toLocaleString()} sessions · ${row.destinations} hosts`}
      />
      <FirewallAggregateBars
        title="Destination ports"
        subtitle="Busiest destination ports by traffic"
        rows={(report?.aggregates?.destination_ports || []).slice(0, 10)}
        empty="No destination port activity in this period."
        valueOf={(row) => row.traffic_bytes}
        labelOf={(row) => `${row.records.toLocaleString()} sessions · ${row.sources} clients`}
      />
      <FirewallAggregateBars
        title="Session actions and severity"
        subtitle="Action taken by the firewall, then log severity"
        rows={[
          ...(report?.aggregates?.actions || []),
          ...(report?.aggregates?.severities || []),
        ]}
        empty="The traffic log did not record an action or severity."
        valueOf={(row) => row.records}
        labelOf={(row) => `${row.records.toLocaleString()} sessions`}
      />
      <FirewallAggregateBars
        title="Protocols"
        subtitle="Transport protocol carrying the traffic"
        rows={report?.aggregates?.protocols || []}
        empty="No protocol was recorded for this period."
        valueOf={(row) => row.traffic_bytes}
        labelOf={(row) => `${row.records.toLocaleString()} sessions`}
      />
    </div>
  );
}

function InterfacesPanel({ value, firewall, lastUpdated }) {
  const results = value?.results || {};
  const rows = Array.isArray(results) ? results : Object.values(results);
  const [showDown, setShowDown] = useState(false);
  if (!rows.length) return <EmptyPanel title="Interfaces" configured />;
  const isUp = (row) =>
    row.link === true || row.link === "up" || row.status === "up";
  const active = rows
    .filter(isUp)
    .sort(
      (a, b) =>
        Number(b.rx_bytes || 0) +
        Number(b.tx_bytes || 0) -
        Number(a.rx_bytes || 0) -
        Number(a.tx_bytes || 0),
    );
  const down = rows.filter((row) => !isUp(row));
  const totalReceived = rows.reduce(
    (sum, row) => sum + Number(row.rx_bytes || 0),
    0,
  );
  const totalSent = rows.reduce(
    (sum, row) => sum + Number(row.tx_bytes || 0),
    0,
  );
  const busiest = Math.max(
    ...active.map(
      (row) => Number(row.rx_bytes || 0) + Number(row.tx_bytes || 0),
    ),
    1,
  );
  return (
    <div className="space-y-4">
      <InterfacePeriodUsage firewall={firewall} />
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E7E9F2] bg-white px-4 py-3 text-xs text-[#5B6178]">
        <Clock3 className="h-4 w-4 text-[#4A5FE8]" />
        <b className="text-[#374151]">Lifetime counter period:</b>
        <span>last firewall reboot (start date not supplied by the API)</span>
        <span>→</span>
        <span>{formatUsageRangeTimestamp(lastUpdated)} IST</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Interfaces up", active.length, "text-[#15803D]", `of ${rows.length} physical ports`],
          ["Interfaces down", down.length, "text-[#181C2E]", "no active link — unused ports"],
          ["Lifetime received", formatBytes(totalReceived), "text-[#181C2E]", "counters since last reboot"],
          ["Lifetime sent", formatBytes(totalSent), "text-[#181C2E]", "counters since last reboot"],
        ].map(([label, metric, tone, note]) => (
          <div key={label} className={`${FW_CARD} p-4`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              {label}
            </p>
            <b className={`mt-1 block text-xl ${tone}`}>{metric}</b>
            <p className="mt-1 text-[11.5px] text-[#5B6178]">{note}</p>
          </div>
        ))}
      </div>
      <div className={FW_CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-[18px] pt-4">
          <div>
            <h3 className="text-sm font-bold">Active interfaces</h3>
            <p className="mt-0.5 text-xs text-[#98A0B5]">
              Sorted by total traffic · received and sent shown as one paired bar
            </p>
          </div>
          <div className="flex gap-3 text-[11.5px] text-[#5B6178]"><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-[#4A5FE8]" />Received</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-[#0E7490]" />Sent</span></div>
        </div>
        <div className="px-[18px] pb-[18px] pt-3">{active.map((row, index) => {
          const total = Number(row.rx_bytes || 0) + Number(row.tx_bytes || 0);
          const identity = `${row.name || ""} ${row.alias || ""}`.toLowerCase();
          const role = /wan|tata|connectia|internet/.test(identity) ? "WAN" : "LAN";
          return (
            <div
              key={row.name || index}
              className="grid gap-3 border-b border-[#F0F1F7] py-2.5 last:border-0 md:grid-cols-[190px_1fr_90px] md:items-center"
            >
              <div>
                <div className="flex items-center gap-1.5"><b className="text-[12.5px]">{row.alias || row.name || `Interface ${index + 1}`}</b><FwPill tone={role === "WAN" ? "brand" : "gray"} className="px-2 py-0.5 text-[9.5px]">{role}</FwPill></div>
                <p className="font-mono text-[10px] text-[#98A0B5]">
                  {row.name} · {row.ip || "No IP"} ·{" "}
                  {row.speed ? `${row.speed} Mbps` : "Speed unavailable"}
                </p>
              </div>
              <div>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-[#F0F1F7]">
                  <div className="h-full bg-[#4A5FE8]" style={{ width: `${(Number(row.rx_bytes || 0) / busiest) * 100}%` }} />
                  <div className="h-full bg-[#0E7490]" style={{ width: `${(Number(row.tx_bytes || 0) / busiest) * 100}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-[10.5px] text-[#98A0B5]"><span>↓ {formatBytes(row.rx_bytes)} received</span><span>↑ {formatBytes(row.tx_bytes)} sent</span></div>
              </div>
              <b className="text-right text-[13px] tabular-nums">{formatBytes(total)}</b>
            </div>
          );
        })}</div>
      </div>
      <div className="grid items-start gap-3.5 xl:grid-cols-[1.55fr_1fr]">
        <div className={FW_CARD}>
          <div className="px-[18px] pt-4"><h3 className="text-sm font-bold">Observations</h3><p className="mt-0.5 text-xs text-[#98A0B5]">What the interface counters currently show</p></div>
          <div className="space-y-2.5 p-[18px] pt-3">
            <FwInsight tone="amber" icon="▲" title="Traffic direction varies by interface role" text="WAN and LAN counters can be asymmetric because of NAT flow accounting; compare the paired received and sent bars before treating it as an anomaly." />
            <FwInsight tone="teal" icon="i" title="Counters are cumulative" text="Interface byte totals accumulate since restart and are not live per-second throughput unless the firewall supplies a rate sensor." />
            {active.some((row) => Number(row.speed || 0) > 0 && Number(row.speed) < 1000) && <FwInsight tone="teal" icon="i" title="Lower-speed active link detected" text="At least one active interface is below 1 Gbps. Review capacity before adding high-volume workloads." />}
          </div>
        </div>
      <div className={FW_CARD}>
        <button
          type="button"
          onClick={() => setShowDown((value) => !value)}
          className="flex w-full items-center gap-2 px-5 py-4 text-left hover:bg-[#F8F9FC]"
        >
          <ChevronDown
            className={`h-4 w-4 transition ${showDown ? "rotate-180" : ""}`}
          />
          <b>Down interfaces</b>
          <span className="text-xs text-[#9CA3AF]">
            · {down.length} with no active link
          </span>
          <Badge className="ml-auto bg-slate-100 text-slate-700">
            {down.length}
          </Badge>
        </button>
        {showDown && (
          <div className="flex flex-wrap gap-2 border-t border-[#E5E9EF] p-4">
            {down.map((row, index) => (
              <span
                key={row.name || index}
                className="rounded-lg border border-[#E5E9EF] bg-[#F8F9FC] px-3 py-2 text-xs font-semibold text-[#6B7280]"
              >
                {row.alias || row.name || `Interface ${index + 1}`}
              </span>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

function RecordList({ value, emptyTitle, kind, max = 100 }) {
  const rows = listFrom(value);
  const [expandedRow, setExpandedRow] = useState(null);
  if (!rows.length) return <EmptyPanel title={emptyTitle} configured />;
  const visibleRows = rows.slice(0, max);
  return (
    <div className="space-y-2">
      {visibleRows.map((row, index) => {
        const expanded = kind === "event" && expandedRow === index;
        const eventDetails = [
          [
            "Description",
            textFrom(row, ["msg", "message", "logdesc", "description"]),
          ],
          ["Event type", textFrom(row, ["eventtype", "subtype", "type"])],
          ["Severity", textFrom(row, ["level", "severity", "priority"])],
          [
            "Date and time",
            [row.date, row.time || row.timestamp].filter(Boolean).join(" ") ||
              "—",
          ],
          [
            "Source",
            textFrom(row, ["srcip", "source_ip", "srcname", "source"]),
          ],
          [
            "Destination",
            textFrom(row, [
              "dstip",
              "destination_ip",
              "dstname",
              "destination",
            ]),
          ],
          ["User", textFrom(row, ["user", "username", "srcuser"])],
          ["Action", textFrom(row, ["action", "status", "result"])],
          ["Interface", textFrom(row, ["interface", "srcintf", "dstintf"])],
          ["Event ID", textFrom(row, ["eventid", "logid", "id", "uuid"])],
        ];
        return (
          <Card
            key={row.id || row.uuid || index}
            className={`border-[#E5E9EF] p-4 shadow-none transition ${kind === "event" ? "cursor-pointer hover:border-[#9CBFE6] hover:shadow-sm" : ""}`}
            onClick={
              kind === "event"
                ? () => setExpandedRow(expanded ? null : index)
                : undefined
            }
          >
            <div className="flex flex-wrap items-start gap-3">
              <span
                className={`grid h-9 w-9 place-items-center rounded-lg ${kind === "event" ? "bg-red-50 text-red-600" : kind === "device" ? "bg-blue-50 text-blue-600" : "bg-[#F4F6F8] text-[#4B5563]"}`}
              >
                {kind === "event" ? (
                  <ShieldAlert className="h-4 w-4" />
                ) : kind === "device" ? (
                  <Wifi className="h-4 w-4" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {textFrom(
                    row,
                    [
                      "name",
                      "hostname",
                      "logdesc",
                      "msg",
                      "title",
                      "message",
                      "event",
                      "action",
                      "device_type",
                    ],
                    `${emptyTitle} ${index + 1}`,
                  )}
                </p>
                <p className="mt-1 text-xs text-[#9CA3AF]">
                  {textFrom(
                    row,
                    [
                      "ip",
                      "ipv4_address",
                      "ip_address",
                      "srcip",
                      "source_ip",
                      "address",
                    ],
                    "No IP",
                  )}{" "}
                  ·{" "}
                  {textFrom(
                    row,
                    [
                      "status",
                      "level",
                      "severity",
                      "state",
                      "eventtype",
                      "type",
                    ],
                    "Information",
                  )}{" "}
                  ·{" "}
                  {textFrom(
                    row,
                    ["date", "timestamp", "time", "created_at", "last_seen"],
                    "Time unavailable",
                  )}
                </p>
              </div>
              {row.status && (
                <Badge variant="outline">{String(row.status)}</Badge>
              )}
              {kind === "event" && (
                <button
                  type="button"
                  aria-expanded={expanded}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#2E7CD6] hover:bg-blue-50"
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpandedRow(expanded ? null : index);
                  }}
                >
                  {expanded ? "Hide details" : "View details"}
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </button>
              )}
            </div>
            {expanded && (
              <div className="mt-4 border-t border-[#E5E9EF] pt-4">
                <div className="mb-3 flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-red-600" />
                  <h4 className="text-sm font-bold">Issue details</h4>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {eventDetails.map(([label, detail]) => (
                    <div
                      key={label}
                      className={`rounded-lg bg-[#F7F9FB] p-3 ${label === "Description" ? "sm:col-span-2 lg:col-span-3" : ""}`}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                        {label}
                      </p>
                      <p className="mt-1 break-words text-sm font-medium text-[#374151]">
                        {detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        );
      })}
      {rows.length > visibleRows.length && (
        <p className="rounded-lg bg-[#F4F6F8] px-3 py-2 text-center text-xs text-[#6B7280]">
          Showing the latest {visibleRows.length} of {rows.length} records
        </p>
      )}
    </div>
  );
}

function policyText(value) {
  if (Array.isArray(value))
    return value.map((item) => policyText(item)).filter(Boolean).join(", ");
  if (value && typeof value === "object")
    return String(value.name || value.q_origin_key || value.id || "");
  return value == null ? "" : String(value);
}

function hq2FloorFor(value) {
  const name = `${policyText(value.name)} ${policyText(value.comments)} ${policyText(value.policyname)} ${policyText(value.policy)}`.toLowerCase();
  const interfaces = `${policyText(value.srcintf)} ${policyText(value.source_interface)} ${policyText(value.dstintf)} ${policyText(value.destination_interface)} ${policyText(value.detected_interface)}`.toLowerCase();
  if (/cctv|camera/.test(name)) return "Shared";
  if (/\b(?:gf|ground[ _-]*floor)\b/.test(name) || /\bport13\b/.test(interfaces)) return 1;
  if (/\b(?:ff|first[ _-]*floor)\b/.test(name) || /\bport(?:3|4)\b/.test(interfaces)) return 2;
  if (/\b(?:sf|second[ _-]*floor)\b/.test(name) || /\bport9\b/.test(interfaces) || /(?:^|[ ,])lan(?:$|[ ,])/.test(interfaces)) return 3;
  if (/\b(?:tf|third[ _-]*floor|fourth[ _-]*floor)\b/.test(name) || /\bport10\b/.test(interfaces)) return 4;
  return "Shared";
}

function HQ2FloorUsage({ logs }) {
  const rows = listFrom(logs);
  const floorLabels = ["1st Floor", "2nd Floor", "3rd Floor", "4th Floor"];
  const policyLabels = ["GF", "FF", "SF", "TF"];
  const colors = ["#347FD1", "#7C5CE7", "#16806D", "#E58B17"];
  const groups = [1, 2, 3, 4].map((floor) => {
    const floorRows = rows.filter((row) => hq2FloorFor(row) === floor);
    const systems = Object.values(floorRows.reduce((summary, row) => {
      const ip = textFrom(row, ["srcip", "source_ip"], "Unknown IP");
      const mac = textFrom(row, ["srcmac", "source_mac", "mastersrcmac"], "");
      const key = firewallMacKey(mac) || ip;
      const sent = numberFrom(row, ["sentbyte", "sent_bytes"]);
      const received = numberFrom(row, ["rcvdbyte", "received_bytes"]);
      if (!summary[key]) summary[key] = {
        key,
        member: row.asset_user_name || "Unmapped user",
        employeeCode: row.employee_code || "",
        mapped: Boolean(row.inventory_match),
        hostname: row.srcname || row.source_name || row.devtype || row.source_device_type || "Unknown system",
        os: row.osname || row.source_os_name || row.asset_os_version || "Unknown OS",
        av: row.av_status || "Unknown",
        ip,
        mac,
        total: 0,
        sent: 0,
        received: 0,
        sessions: 0,
        applications: {},
      };
      const system = summary[key];
      system.sent += sent;
      system.received += received;
      system.total += sent + received;
      system.sessions += 1;
      const app = identifiedApplication(row).name;
      system.applications[app] = (system.applications[app] || 0) + sent + received;
      return summary;
    }, {})).sort((a, b) => b.total - a.total);
    const services = Object.entries(floorRows.reduce((summary, row) => {
      const app = identifiedApplication(row).name;
      summary[app] = (summary[app] || 0) + numberFrom(row, ["sentbyte", "sent_bytes"]) + numberFrom(row, ["rcvdbyte", "received_bytes"]);
      return summary;
    }, {})).map(([name, bytes]) => ({ name, bytes })).sort((a, b) => b.bytes - a.bytes);
    return {
      floor,
      rows: floorRows,
      systems,
      services,
      bytes: systems.reduce((sum, system) => sum + system.total, 0),
      mapped: systems.filter((system) => system.mapped).length,
    };
  });
  const totalBytes = groups.reduce((sum, group) => sum + group.bytes, 0);
  return <section className="overflow-hidden rounded-2xl border border-[#DDE2EA] bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E9EF] px-5 py-4"><div><h3 className="font-bold">HQ2 utilization and systems by floor</h3><p className="mt-1 text-xs text-[#8B93A1]">Today&apos;s retained traffic records classified using the HQ2 interface and policy layout.</p></div><Badge className="bg-blue-50 text-blue-700">{groups.reduce((sum, group) => sum + group.systems.length, 0)} systems observed</Badge></div>
    <div className="grid gap-4 p-4 xl:grid-cols-2">{groups.map((group, index) => {
      const share = totalBytes ? (group.bytes / totalBytes) * 100 : 0;
      return <article key={group.floor} className="overflow-hidden rounded-xl border border-[#E1E6ED] bg-[#FAFBFC]">
        <div className="border-b border-[#E5E9EF] bg-white p-4"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl text-sm font-bold text-white" style={{ background: colors[index] }}>{group.floor}F</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><h4 className="font-bold">{floorLabels[index]}</h4><b style={{ color: colors[index] }}>{formatBytes(group.bytes)}</b></div><p className="text-xs text-[#8B93A1]">{policyLabels[index]} group · {group.systems.length} systems · {group.rows.length} traffic records</p></div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#E8ECF2]"><div className="h-full rounded-full" style={{ width: `${share}%`, background: colors[index] }} /></div><div className="mt-2 flex justify-between text-[11px] text-[#69738B]"><span>{share.toFixed(1)}% of observed floor traffic</span><span>{group.mapped}/{group.systems.length} inventory mapped</span></div></div>
        <div className="grid grid-cols-3 gap-px bg-[#E5E9EF]"><div className="bg-white p-3 text-center"><b>{group.systems.length}</b><p className="text-[9px] uppercase text-[#8B93A1]">Systems</p></div><div className="bg-white p-3 text-center"><b>{group.mapped}</b><p className="text-[9px] uppercase text-[#8B93A1]">Mapped users</p></div><div className="bg-white p-3 text-center"><b>{group.services.length}</b><p className="text-[9px] uppercase text-[#8B93A1]">Services</p></div></div>
        <div className="flex flex-wrap gap-1.5 border-b border-[#E5E9EF] px-4 py-3">{group.services.slice(0, 5).map((service) => <span key={service.name} className="rounded-md border bg-white px-2 py-1 text-[10px] font-semibold text-[#596278]">{service.name} · {formatBytes(service.bytes)}</span>)}{!group.services.length && <span className="text-xs text-[#9CA3AF]">No service activity returned.</span>}</div>
        <div className="max-h-80 divide-y divide-[#E8ECF2] overflow-auto">{group.systems.map((system) => <div key={system.key} className="flex items-start gap-3 bg-white px-4 py-3"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${system.mapped ? "bg-emerald-500" : "bg-red-500"}`} /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className={`block truncate text-sm ${system.mapped ? "text-[#1F2937]" : "text-red-700"}`}>{system.member}</b><p className="truncate text-xs text-[#69738B]">{system.employeeCode ? `${system.employeeCode} · ` : ""}{system.hostname}</p></div><b className="whitespace-nowrap text-xs">{formatBytes(system.total)}</b></div><p className="mt-1 truncate font-mono text-[10px] text-[#8B93A1]">{system.ip} · {system.mac || "No MAC"}</p><div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-[#69738B]"><span>{system.sessions} records</span><span>↑ {formatBytes(system.sent)}</span><span>↓ {formatBytes(system.received)}</span><span>{system.os}</span><span>AV: {system.av}</span></div></div></div>)}{!group.systems.length && <p className="bg-white px-4 py-8 text-center text-xs text-[#9CA3AF]">No systems observed on this floor in the current traffic sample.</p>}</div>
      </article>;
    })}</div>
    <div className="border-t border-[#E5E9EF] bg-[#FAFBFC] px-5 py-3 text-[11px] text-[#69738B]">Floor mapping: 1F = GF/port13 · 2F = FF/port3–4 · 3F = SF/port9/lan · 4F = TF/port10. Red systems are not mapped in the supplied asset inventory.</div>
  </section>;
}

function HQ2FloorPolicies({ value }) {
  const policies = listFrom(value);
  const floors = [1, 2, 3, 4].map((floor) => ({
    floor,
    rows: policies.filter((policy) => hq2FloorFor(policy) === floor),
  }));
  const shared = policies.filter((policy) => hq2FloorFor(policy) === "Shared");
  const groups = [...floors, { floor: "Shared", rows: shared }];
  return (
    <section className="overflow-hidden rounded-2xl border border-[#DDE2EA] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E9EF] px-5 py-4">
        <div>
          <h3 className="font-bold">HQ2 firewall policies by floor</h3>
          <p className="mt-1 text-xs text-[#8B93A1]">Live policy rules classified from names, comments, interfaces and address objects.</p>
        </div>
        <Badge className="bg-fuchsia-50 text-fuchsia-700">{policies.length} policies</Badge>
      </div>
      {!policies.length ? (
        <EmptyPanel title="HQ2 firewall policies" configured />
      ) : (
        <div className="grid gap-4 p-4 xl:grid-cols-2">
          {groups.map((group) => {
            const enabled = group.rows.filter((row) => !["disable", "disabled", false, 0].includes(row.status)).length;
            return (
              <div key={group.floor} className="overflow-hidden rounded-xl border border-[#E5E9EF] bg-[#FAFBFC]">
                <div className="flex items-center justify-between border-b border-[#E5E9EF] bg-white px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 min-w-9 place-items-center rounded-lg bg-[#151A28] px-2 text-xs font-bold text-white">{typeof group.floor === "number" ? `${group.floor}F` : "ALL"}</span>
                    <div><p className="text-sm font-bold">{typeof group.floor === "number" ? `${group.floor}${group.floor === 1 ? "st" : group.floor === 2 ? "nd" : group.floor === 3 ? "rd" : "th"} Floor` : "Shared / unclassified"}</p><p className="text-[11px] text-[#8B93A1]">{typeof group.floor === "number" ? `${["GF", "FF", "SF", "TF"][group.floor - 1]} policy group · ` : ""}{enabled} enabled · {group.rows.length} total</p></div>
                  </div>
                  <span className={`h-2.5 w-2.5 rounded-full ${group.rows.length ? "bg-emerald-500" : "bg-slate-300"}`} />
                </div>
                {group.rows.length ? <div className="max-h-72 divide-y divide-[#E9EDF2] overflow-auto">{group.rows.map((policy, index) => {
                  const isEnabled = !["disable", "disabled", false, 0].includes(policy.status);
                  return <div key={policy.policyid || policy.id || `${group.floor}-${index}`} className="p-4 text-xs">
                    <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-[#1F2937]">{policy.name || `Policy ${policy.policyid || index + 1}`}</p><p className="mt-1 text-[#8B93A1]">ID {policy.policyid ?? policy.id ?? "—"} · {policy.action || "accept"}</p></div><Badge className={isEnabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}>{isEnabled ? "Enabled" : "Disabled"}</Badge></div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[#4B5563]"><p><b>From:</b> {policyText(policy.srcintf) || "Any"}</p><p><b>To:</b> {policyText(policy.dstintf) || "Any"}</p><p><b>Source:</b> {policyText(policy.srcaddr) || "Any"}</p><p><b>Destination:</b> {policyText(policy.dstaddr) || "Any"}</p></div>
                  </div>;
                })}</div> : <p className="px-4 py-8 text-center text-xs text-[#9CA3AF]">No policies identified for this floor.</p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function firewallSnapshot(data) {
  const sections = data?.sections || {};
  const logs = listFrom(sections.logs);
  return {
    online: Boolean(data?.connected),
    devices: listFrom(sections.devices).length || numberFrom(sections.statistics, ["connected_devices", "devices.connected", "clients"]),
    sessions: numberFrom(sections.statistics, ["results.session.0.current", "sessions.current", "sessions"]),
    events: listFrom(sections.events).length || numberFrom(sections.statistics, ["security_events", "threats", "blocked_threats"]),
    cpu: numberFrom(sections.statistics, ["results.cpu.0.current", "cpu.current", "cpu"]),
    memory: numberFrom(sections.statistics, ["results.mem.0.current", "memory.current", "memory"]),
    traffic: logs.reduce((sum, row) => sum + numberFrom(row, ["rcvdbyte", "received_bytes", "download"]) + numberFrom(row, ["sentbyte", "sent_bytes", "upload"]), 0),
    model: sections.status?.results?.model_name || sections.status?.results?.model || "Firewall",
  };
}

function mergeFirewallOverview(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;
  return {
    ...current,
    ...incoming,
    configured: current.configured || incoming.configured,
    connected: current.connected || incoming.connected,
    operational_state:
      current.operational_state === "down"
        ? incoming.operational_state || current.operational_state
        : current.operational_state || incoming.operational_state,
    sections: { ...(current.sections || {}), ...(incoming.sections || {}) },
    section_meta: {
      ...(current.section_meta || {}),
      ...(incoming.section_meta || {}),
    },
    errors: { ...(current.errors || {}), ...(incoming.errors || {}) },
    threat_errors: {
      ...(current.threat_errors || {}),
      ...(incoming.threat_errors || {}),
    },
    last_updated: incoming.last_updated || current.last_updated,
  };
}

async function firewallTrafficReportWithArchiveFallback(firewall) {
  let liveReport = null;
  let liveError = null;
  try {
    liveReport = await api(
      `/firewall/report?today=true&firewall=${firewall}`,
      { timeout: 120000 },
    );
    if ((liveReport.records || []).length) return liveReport;
  } catch (error) {
    liveError = error;
  }

  try {
    const archived = await api(
      `/firewall/archive/fallback?firewall=${firewall}`,
      { timeout: 120000 },
    );
    return {
      ...archived,
      summary: {
        ...(archived.summary || {}),
        ...(liveReport?.summary || {}),
        records: Number(archived.summary?.records || archived.records?.length || 0),
        records_available: Number(
          archived.summary?.records_available || archived.records?.length || 0,
        ),
        records_sampled: Boolean(archived.summary?.records_sampled),
        traffic_bytes: Number(archived.summary?.traffic_bytes || 0),
        archived_rows_available: Number(
          archived.summary?.archived_rows_available || archived.records?.length || 0,
        ),
        archived_rows_considered: Number(
          archived.summary?.archived_rows_considered || archived.records?.length || 0,
        ),
        archive_records_included: true,
        archive_fallback: true,
        archive_date: archived.summary?.archive_date,
        archive_captured_at: archived.summary?.archive_captured_at || null,
        archive_protected_before_downtime: Boolean(
          archived.summary?.archive_protected_before_downtime,
        ),
        source: archived.summary?.source || "latest_appliance_verified_daily_archive",
        source_complete: Boolean(archived.summary?.source_complete),
        source_identity_verified: true,
        appliance_serial: archived.summary?.appliance_serial || null,
        live_error: liveError?.message || null,
        fallback_reason: liveError
          ? "Live firewall traffic was unavailable"
          : "The live current-period report returned no records",
        application_control:
          liveReport?.summary?.application_control ||
          archived.summary?.application_control,
      },
    };
  } catch (archiveError) {
    if (liveReport) return liveReport;
    throw liveError || archiveError;
  }
}

function FirewallEstateComparison({ values, onSelect }) {
  const hq = firewallSnapshot(values.hq);
  const hq2 = firewallSnapshot(values.hq2);
  const multiplier = (right, left) =>
    left > 0 && right > 0 ? `${(right / left).toFixed(1)}×` : "—";
  const rows = [
    ["Devices", hq.devices.toLocaleString(), hq2.devices.toLocaleString(), multiplier(hq2.devices, hq.devices)],
    ["Active sessions", hq.sessions.toLocaleString(), hq2.sessions.toLocaleString(), multiplier(hq2.sessions, hq.sessions)],
    ["Security events", hq.events.toLocaleString(), hq2.events.toLocaleString(), hq.events === hq2.events ? "—" : multiplier(hq2.events, hq.events)],
    ["CPU / Memory", `${hq.cpu}% / ${hq.memory}%`, `${hq2.cpu}% / ${hq2.memory}%`, "—"],
    ["Observed traffic", formatBytes(hq.traffic), formatBytes(hq2.traffic), "—"],
  ];
  const suspiciousHq2Traffic = hq2.devices > hq.devices && hq2.traffic > 0 && hq2.traffic < hq.traffic * 0.2;
  return (
    <div className={FW_CARD}>
      <div className="flex items-start justify-between gap-3 px-[18px] pt-4">
        <div>
          <h3 className="text-sm font-bold tracking-tight">HQ vs HQ2 at a glance</h3>
          <p className="mt-0.5 text-xs text-[#98A0B5]">Estate comparison — shown once, here</p>
        </div>
        <button type="button" onClick={() => onSelect("hq2")} className="shrink-0 rounded-[10px] border border-[#E7E9F2] bg-white px-3 py-1.5 text-xs font-semibold hover:bg-[#F7F8FB]">Open HQ2 →</button>
      </div>
      <div className="p-[18px] pt-2.5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead><tr className="border-b border-[#E7E9F2] text-[10.5px] font-semibold uppercase tracking-wider text-[#98A0B5]"><th className="px-3 py-2 text-left" /><th className="px-3 py-2 text-right">HQ</th><th className="px-3 py-2 text-right">HQ2</th><th className="px-3 py-2 text-right">Δ</th></tr></thead>
            <tbody>{rows.map(([label, hqValue, hq2Value, delta]) => <tr key={label} className="border-b border-[#F0F1F7] last:border-0"><td className="px-3 py-2.5 text-[#5B6178]">{label}</td><td className="px-3 py-2.5 text-right font-semibold tabular-nums">{hqValue}</td><td className="px-3 py-2.5 text-right tabular-nums">{hq2Value}</td><td className="px-3 py-2.5 text-right tabular-nums text-[#98A0B5]">{delta}</td></tr>)}</tbody>
          </table>
        </div>
        {suspiciousHq2Traffic && <p className="mt-2.5 text-[11px] text-[#B45309]">⚠ HQ2 traffic is unusually low for its connected-device count — check log forwarding on HQ2.</p>}
      </div>
    </div>
  );
}

// ---------------- redesign presentational primitives ----------------
const FW_CARD =
  "rounded-2xl border border-[#E7E9F2] bg-white shadow-[0_1px_2px_rgba(24,28,46,0.05),0_4px_14px_rgba(24,28,46,0.05)]";

const FW_PILL_TONES = {
  green: "bg-[#E8F6EE] text-[#15803D]",
  amber: "bg-[#FCF1DF] text-[#B45309]",
  red: "bg-[#FCE9ED] text-[#C41E3D]",
  gray: "bg-[#F0F1F7] text-[#5B6178]",
  brand: "bg-[#EDF0FE] text-[#4A5FE8]",
  teal: "bg-[#E6F5F9] text-[#0E7490]",
};

function FwPill({ tone = "gray", children, className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${FW_PILL_TONES[tone] || FW_PILL_TONES.gray} ${className}`}
    >
      {children}
    </span>
  );
}

function FwKpi({ label, value, valueClass = "", children }) {
  return (
    <div className={`${FW_CARD} p-4`}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#98A0B5]">
        {label}
      </p>
      <p className={`mt-1.5 text-[21px] font-bold tracking-tight tabular-nums ${valueClass}`}>
        {value}
      </p>
      <div className="mt-1 text-[11.5px] text-[#5B6178]">{children}</div>
    </div>
  );
}

function formatDowntimeDuration(milliseconds) {
  const totalMinutes = Math.max(0, Math.floor(Number(milliseconds || 0) / 60000));
  if (totalMinutes < 1) return "< 1 min";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return [
    days ? `${days}d` : null,
    hours ? `${hours}h` : null,
    minutes || (!days && !hours) ? `${minutes}m` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatDowntimeTimestamp(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function firewallArchiveInputDate(value) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const DOWNTIME_DAY_MS = 24 * 60 * 60 * 1000;

function formatDowntimeDay(value, withWeekday = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    ...(withWeekday ? { weekday: "short" } : {}),
    day: "2-digit",
    month: "short",
  });
}

function downtimeDayTone(day) {
  if (!day?.tracked_ms) return "bg-[#E7E9F2]";
  if (day.downtime_ms)
    return day.downtime_ms >= day.tracked_ms * 0.95 ? "bg-[#C41E3D]" : "bg-[#E2A33A]";
  return day.ports?.length ? "bg-[#7C5CE0]" : "bg-[#22A06B]";
}

function portLabel(item) {
  if (String(item.port).startsWith("isp:")) return item.alias || item.port.slice(4);
  return item.alias ? `${item.port} · ${item.alias}` : item.port;
}

function portDowntimeText(ports = []) {
  return ports
    .map((item) =>
      `${String(item.port).startsWith("isp:") ? `${item.alias || item.port.slice(4)} line` : item.port} ${formatDowntimeDuration(item.downtime_ms)}`,
    )
    .join(", ");
}

function DowntimeReason({ reason, compact = false }) {
  if (!reason) return null;
  const unknown = ["unrecorded", "unknown"].includes(reason.code);
  return (
    <div className={compact ? "" : "mt-1.5"}>
      <p className={`text-[11.5px] font-semibold ${unknown ? "text-[#98A0B5]" : "text-[#181C2E]"}`}>
        {reason.title}
      </p>
      {!compact && (
        <p className="mt-0.5 text-[11px] leading-relaxed text-[#5B6178]">{reason.detail}</p>
      )}
      {reason.breakdown?.length > 1 && (
        <p className="mt-1 text-[10.5px] text-[#5B6178]">
          Also seen: {reason.breakdown
            .slice(1)
            .map((item) => `${item.title} (${item.probes} check${item.probes === 1 ? "" : "s"})`)
            .join(", ")}
        </p>
      )}
      {reason.error && (
        <p className="mt-1 break-all font-mono text-[10.5px] text-[#98A0B5]">{reason.error}</p>
      )}
    </div>
  );
}

function FirewallDowntimeSection({
  values,
  days,
  onDaysChange,
  loading,
  activeFirewall,
  onSelect,
}) {
  // Selected calendar day per firewall; null means today.
  const [selectedDay, setSelectedDay] = useState({ hq: null, hq2: null });
  const [showAll, setShowAll] = useState({ hq: false, hq2: false });
  const stateDetails = {
    online: { label: "Online", tone: "green", dot: "bg-[#15803D]" },
    degraded: { label: "Degraded", tone: "amber", dot: "bg-[#B45309]" },
    down: { label: "Offline", tone: "red", dot: "bg-[#C41E3D]" },
    unconfigured: { label: "Setup required", tone: "gray", dot: "bg-[#98A0B5]" },
    unknown: { label: "Not checked", tone: "gray", dot: "bg-[#98A0B5]" },
  };

  return (
    <section className={`${FW_CARD} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F0F1F7] px-[18px] py-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#4A5FE8]" />
            <h3 className="text-sm font-bold tracking-tight">
              Firewall uptime &amp; downtime
            </h3>
          </div>
          <p className="mt-1 text-xs text-[#98A0B5]">
            Checked every minute. Days are in IST; today is the last block. Click a day to see its outages and reasons.
          </p>
        </div>
        <div className="flex items-center rounded-[10px] border border-[#E7E9F2] bg-[#F7F8FB] p-1">
          {[7, 30, 90].map((period) => (
            <button
              key={period}
              type="button"
              onClick={() => onDaysChange(period)}
              className={`rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition ${
                days === period
                  ? "bg-white text-[#4A5FE8] shadow-sm"
                  : "text-[#5B6178] hover:text-[#181C2E]"
              }`}
            >
              {period} days
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 p-3 sm:p-[18px] xl:grid-cols-2">
        {["hq", "hq2"].map((id) => {
          const availability = values[id];
          const currentState = availability?.current?.state || "unknown";
          const state = stateDetails[currentState] || stateDetails.unknown;
          const currentOutage = availability?.current_outage;
          const availabilityPercent = availability?.summary?.availability_percent;
          const daily = availability?.daily || [];
          const today = availability?.today;
          const day =
            daily.find((item) => item.date === selectedDay[id]) ||
            daily[daily.length - 1] ||
            null;
          const isToday = !day || day.date === today?.date;
          const dayStart = day ? new Date(day.start).getTime() : 0;
          const byStartDesc = (a, b) => new Date(b.started_at) - new Date(a.started_at);
          const inDay = (outage) => {
            const start = new Date(outage.started_at).getTime();
            const end = outage.ended_at ? new Date(outage.ended_at).getTime() : Date.now();
            return start < dayStart + DOWNTIME_DAY_MS && end > dayStart;
          };
          const portOutages = availability?.ports?.outages || [];
          const dayOutages = (
            isToday
              ? [...(today?.outages || []), ...(today?.port_outages || [])]
              : [...(availability?.recent_outages || []), ...portOutages].filter(inDay)
          ).sort(byStartDesc);
          const allOutages = [...(availability?.recent_outages || []), ...portOutages].sort(byStartDesc);
          const portsNow = availability?.ports?.current || [];
          const portsDown = portsNow.filter((item) => !item.up);
          const listed = showAll[id] ? allOutages : dayOutages;
          const reasons = availability?.reason_breakdown || [];
          const maxReasonMs = Math.max(1, ...reasons.map((item) => item.downtime_ms));
          return (
            <div
              key={id}
              className={`min-w-0 rounded-[14px] border p-4 transition sm:p-[18px] ${
                activeFirewall === id
                  ? "border-[#AEB9FA] bg-[#FAFAFF] shadow-[0_0_0_2px_rgba(74,95,232,0.08)]"
                  : "border-[#E7E9F2] bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#98A0B5]">
                    {id.toUpperCase()} firewall
                  </p>
                  <p className="mt-1 text-[20px] font-bold tabular-nums">
                    {availabilityPercent === null || availabilityPercent === undefined
                      ? "—"
                      : `${Number(availabilityPercent).toFixed(
                          Number(availabilityPercent) >= 99.995 ? 3 : 2,
                        )}%`}
                  </p>
                  <p className="text-[11.5px] text-[#5B6178]">
                    availability · last {days} days
                  </p>
                  {availability?.summary?.monitoring_gap_ms > 0 && (
                    <p className="mt-0.5 max-w-[340px] text-[10.5px] leading-snug text-[#98A0B5]">
                      Leaves out {formatDowntimeDuration(availability.summary.monitoring_gap_ms)} when TMS could not check the firewall (e.g. certificate changed). That is a monitoring gap, not network downtime.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <FwPill tone={state.tone}>
                    <i className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
                    {state.label}
                  </FwPill>
                  {activeFirewall !== id && (
                    <button
                      type="button"
                      onClick={() => onSelect(id)}
                      className="text-[11px] font-semibold text-[#4A5FE8] hover:underline"
                    >
                      View {id.toUpperCase()} →
                    </button>
                  )}
                </div>
              </div>

              {loading && !availability ? (
                <div className="mt-4 h-24 animate-pulse rounded-xl bg-[#F0F1F7]" />
              ) : (
                <>
                  {(currentOutage || availability?.current?.reason) && (
                    <div className="mt-3 rounded-[11px] border border-[#F5CBD5] bg-[#FFF6F7] p-3">
                      <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#C41E3D]">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {currentOutage
                          ? `Down now · ${formatDowntimeDuration(currentOutage.duration_ms)} (since ${formatDowntimeTimestamp(currentOutage.started_at)})`
                          : `${state.label} now`}
                      </p>
                      <DowntimeReason
                        reason={availability?.current?.reason || currentOutage?.reason}
                      />
                      {currentOutage?.pre_downtime_snapshot && (
                        <p className="mt-1.5 text-[10.5px] font-semibold text-[#4A5FE8]">
                          Pre-downtime report saved · {Number(
                            currentOutage.pre_downtime_snapshot.stored_records || 0,
                          ).toLocaleString()} records
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div
                      className={`rounded-[10px] border p-3 ${
                        today?.downtime_ms
                          ? "border-[#F5CBD5] bg-[#FFF6F7]"
                          : "border-[#D9EBDD] bg-[#F7FBF8]"
                      }`}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A0B5]">
                        Today · {formatDowntimeDay(today?.start)}
                      </p>
                      <p
                        className={`mt-1 text-sm font-bold tabular-nums ${
                          today?.downtime_ms ? "text-[#C41E3D]" : "text-[#15803D]"
                        }`}
                      >
                        {today?.downtime_ms ? formatDowntimeDuration(today.downtime_ms) : "No downtime"}
                      </p>
                      <p className="text-[10.5px] text-[#5B6178]">
                        {today?.outage_count || 0} outage{today?.outage_count === 1 ? "" : "s"}
                      </p>
                      {today?.ports?.length > 0 && (
                        <p className="mt-0.5 text-[10.5px] font-semibold text-[#7C5CE0]">
                          Ports: {portDowntimeText(today.ports)}
                        </p>
                      )}
                    </div>
                    <div className="rounded-[10px] border border-[#F0F1F7] bg-white p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A0B5]">
                        Downtime · {days}d
                      </p>
                      <p className="mt-1 text-sm font-bold tabular-nums">
                        {formatDowntimeDuration(availability?.summary?.total_downtime_ms)}
                      </p>
                      <p className="text-[10.5px] text-[#5B6178]">
                        {availability?.summary?.outage_count ?? 0} outage{availability?.summary?.outage_count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="rounded-[10px] border border-[#F0F1F7] bg-white p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A0B5]">
                        Longest
                      </p>
                      <p className="mt-1 text-sm font-bold tabular-nums">
                        {availability?.summary?.longest_outage_ms
                          ? formatDowntimeDuration(availability.summary.longest_outage_ms)
                          : "—"}
                      </p>
                      <p className="text-[10.5px] text-[#5B6178]">in this window</p>
                    </div>
                    <div className="rounded-[10px] border border-[#F0F1F7] bg-white p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A0B5]">
                        Last check
                      </p>
                      <p className="mt-1 truncate text-xs font-semibold">
                        {formatDowntimeTimestamp(availability?.current?.last_probe_at)}
                      </p>
                      <p className="text-[10.5px] text-[#5B6178]">
                        {availability?.current?.successful_sections ?? 0}/3 checks passed
                      </p>
                    </div>
                  </div>

                  {portsNow.length > 0 && (
                    <div className="mt-3 rounded-[11px] border border-[#E7E9F2] bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#181C2E]">
                          <Cable className="h-3.5 w-3.5 text-[#7C5CE0]" />
                          Ports · {portsNow.length - portsDown.length}/{portsNow.length} up
                        </p>
                        <span className="text-[10.5px] text-[#98A0B5]">named or previously used ports</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {portsNow.map((item) => (
                          <span
                            key={item.port}
                            title={`${portLabel(item)}${item.ip ? ` · ${item.ip}` : ""} · ${item.up ? "up" : "down"} since ${formatDowntimeTimestamp(item.state_since)}`}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                              item.up ? "bg-[#E8F6EE] text-[#15803D]" : "bg-[#FCE9ED] text-[#C41E3D]"
                            }`}
                          >
                            <i className={`h-1.5 w-1.5 rounded-full ${item.up ? "bg-[#15803D]" : "bg-[#C41E3D]"}`} />
                            {portLabel(item)}
                            {!item.up && (
                              <span className="font-normal">
                                · {formatDowntimeDuration(Date.now() - new Date(item.state_since))}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {daily.length > 0 && (
                    <div className="mt-4">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10.5px] text-[#98A0B5]">
                        <span className="whitespace-nowrap">{formatDowntimeDay(daily[0].start)}</span>
                        <span className="order-last flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 sm:order-none sm:w-auto">
                          {[
                            ["bg-[#22A06B]", "Up"],
                            ["bg-[#E2A33A]", "Partial"],
                            ["bg-[#C41E3D]", "Down"],
                            ["bg-[#7C5CE0]", "Port down"],
                            ["bg-[#E7E9F2]", "No data"],
                          ].map(([tone, label]) => (
                            <span key={label} className="flex items-center gap-1 whitespace-nowrap">
                              <i className={`h-2 w-2 rounded-sm ${tone}`} />
                              {label}
                            </span>
                          ))}
                        </span>
                        <span className="whitespace-nowrap font-semibold text-[#181C2E]">Today</span>
                      </div>
                      <div className="mt-1.5 flex h-8 items-stretch gap-[2px]">
                        {daily.map((item) => {
                          const selected = day?.date === item.date;
                          return (
                            <button
                              key={item.date}
                              type="button"
                              onClick={() => {
                                setSelectedDay((prev) => ({ ...prev, [id]: item.date }));
                                setShowAll((prev) => ({ ...prev, [id]: false }));
                              }}
                              title={`${formatDowntimeDay(item.start, true)} · ${
                                item.tracked_ms
                                  ? item.downtime_ms
                                    ? `${formatDowntimeDuration(item.downtime_ms)} down (${item.outage_count} outage${item.outage_count === 1 ? "" : "s"})`
                                    : "firewall up"
                                  : "not tracked"
                              }${item.ports?.length ? ` · ports: ${portDowntimeText(item.ports)}` : ""}`}
                              aria-label={`Show downtime for ${formatDowntimeDay(item.start)}`}
                              className={`min-w-0 flex-1 rounded-[3px] ${downtimeDayTone(item)} transition hover:opacity-80 ${
                                selected ? "ring-2 ring-[#181C2E] ring-offset-1" : ""
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11.5px] font-bold text-[#181C2E]">
                        {showAll[id]
                          ? `All outages · last ${days} days`
                          : `${isToday ? "Today" : formatDowntimeDay(day?.start, true)}${
                              day?.downtime_ms
                                ? ` · firewall ${formatDowntimeDuration(day.downtime_ms)} down`
                                : ""
                            }${day?.ports?.length ? ` · ports ${portDowntimeText(day.ports)}` : ""}`}
                      </p>
                      {allOutages.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowAll((prev) => ({ ...prev, [id]: !prev[id] }))}
                          className="text-[11px] font-semibold text-[#4A5FE8] hover:underline"
                        >
                          {showAll[id] ? "Show selected day" : `Show all ${allOutages.length}`}
                        </button>
                      )}
                    </div>
                    {listed.length ? (
                      <ul className="mt-2 max-h-[340px] space-y-2 overflow-y-auto pr-1">
                        {listed.map((outage) => (
                          <li
                            key={outage.id}
                            className={`rounded-[11px] border p-3 ${
                              outage.open ? "border-[#F5CBD5] bg-[#FFF6F7]" : "border-[#E7E9F2] bg-white"
                            }`}
                          >
                            {outage.kind === "port" && (
                              <p className="mb-1 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-[#7C5CE0]">
                                <Cable className="h-3 w-3" />
                                Port {portLabel(outage)}
                              </p>
                            )}
                            {outage.kind === "isp" && (
                              <p className="mb-1 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-[#B45309]">
                                <Cable className="h-3 w-3" />
                                Internet line · {portLabel(outage)}
                              </p>
                            )}
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                              <p className="text-[11px] text-[#5B6178]">
                                <Clock3 className="mr-1 inline h-3 w-3 align-[-2px]" />
                                {formatDowntimeTimestamp(outage.started_at)} →{" "}
                                {outage.open ? "ongoing" : formatDowntimeTimestamp(outage.ended_at)}
                              </p>
                              <span
                                className={`text-[11.5px] font-bold tabular-nums ${
                                  outage.open ? "text-[#C41E3D]" : "text-[#181C2E]"
                                }`}
                              >
                                {formatDowntimeDuration(outage.duration_ms)}
                              </span>
                            </div>
                            <details className="group mt-1">
                              <summary className="flex cursor-pointer list-none items-center gap-1">
                                <DowntimeReason reason={outage.reason} compact />
                                <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[10.5px] font-semibold text-[#4A5FE8]">
                                  Why?
                                  <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
                                </span>
                              </summary>
                              <p className="mt-1 text-[11px] leading-relaxed text-[#5B6178]">
                                {outage.reason?.detail}
                              </p>
                              <div className="mt-2 rounded-[9px] border border-[#E7E9F2] bg-[#F7F8FB] p-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A0B5]">
                                  From the firewall's event log
                                </p>
                                {outage.firewall_events?.length ? (
                                  <ul className="mt-1 space-y-1">
                                    {outage.firewall_events.map((event, index) => (
                                      <li key={`${event.at}-${index}`} className="text-[10.5px] leading-snug text-[#5B6178]">
                                        <span className="font-mono text-[#98A0B5]">{event.at}</span>{" "}
                                        <span className="font-semibold text-[#181C2E]">{event.title}</span>
                                        {event.message ? ` — ${event.message}` : ""}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="mt-1 text-[10.5px] text-[#98A0B5]">
                                    {outage.open
                                      ? "Checked when the outage ends."
                                      : "No matching firewall log entries were captured for this outage (the firewall keeps only the last few minutes of logs)."}
                                  </p>
                                )}
                              </div>
                              {["port", "isp"].includes(outage.kind) && !outage.start_observed && (
                                <p className="mt-1 text-[10.5px] text-[#B45309]">
                                  Already down when monitoring first saw it — the real start is earlier.
                                </p>
                              )}
                              {outage.reason?.reboot_at && (
                                <p className="mt-1 text-[10.5px] text-[#5B6178]">
                                  The firewall reports its last restart at {formatDowntimeTimestamp(outage.reason.reboot_at)}.
                                </p>
                              )}
                              {outage.note && (
                                <p className="mt-1 text-[10.5px] text-[#5B6178]">{outage.note}</p>
                              )}
                              {outage.failed_sections?.length > 0 && (
                                <p className="mt-1 text-[10.5px] text-[#98A0B5]">
                                  Failed checks: {outage.failed_sections.join(", ")}
                                </p>
                              )}
                              {outage.pre_downtime_snapshot && (
                                <p className="mt-1 text-[10.5px] font-semibold text-[#4A5FE8]">
                                  Pre-downtime report saved · {Number(
                                    outage.pre_downtime_snapshot.stored_records || 0,
                                  ).toLocaleString()} records
                                </p>
                              )}
                            </details>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-2 rounded-[11px] border border-[#D9EBDD] bg-[#F7FBF8] p-3 text-[11.5px] font-semibold text-[#15803D]">
                        {day && !day.tracked_ms
                          ? "Not tracked on this day."
                          : `No downtime ${isToday ? "today" : "on this day"}.`}
                      </div>
                    )}
                  </div>

                  {daily.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[11.5px] font-bold text-[#181C2E]">Day-wise downtime (IST)</p>
                      <div className="mt-2 max-h-[260px] overflow-auto rounded-[10px] border border-[#F0F1F7]">
                        <table className="w-full min-w-[420px] text-left text-[11px]">
                          <thead className="sticky top-0 whitespace-nowrap bg-[#F7F8FB] text-[10px] uppercase tracking-wide text-[#98A0B5]">
                            <tr>
                              <th className="px-2.5 py-1.5 font-semibold">Day</th>
                              <th className="px-2.5 py-1.5 font-semibold">Firewall down</th>
                              <th className="px-2.5 py-1.5 font-semibold">Uptime</th>
                              <th className="px-2.5 py-1.5 font-semibold">Ports down</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...daily].reverse().map((item) => (
                              <tr
                                key={item.date}
                                onClick={() => {
                                  setSelectedDay((prev) => ({ ...prev, [id]: item.date }));
                                  setShowAll((prev) => ({ ...prev, [id]: false }));
                                }}
                                className={`cursor-pointer border-t border-[#F0F1F7] hover:bg-[#FAFAFF] ${
                                  day?.date === item.date ? "bg-[#F3F4FF]" : ""
                                }`}
                              >
                                <td className="whitespace-nowrap px-2.5 py-1.5 font-semibold">
                                  {item.date === today?.date ? "Today" : formatDowntimeDay(item.start, true)}
                                </td>
                                <td className={`whitespace-nowrap px-2.5 py-1.5 tabular-nums ${item.downtime_ms ? "font-semibold text-[#C41E3D]" : "text-[#98A0B5]"}`}>
                                  {!item.tracked_ms ? "—" : item.downtime_ms ? formatDowntimeDuration(item.downtime_ms) : "0m"}
                                </td>
                                <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums text-[#5B6178]">
                                  {item.availability_percent == null ? "—" : `${Number(item.availability_percent).toFixed(item.availability_percent >= 99.95 || item.availability_percent === 0 ? 0 : 1)}%`}
                                </td>
                                <td className={`px-2.5 py-1.5 ${item.ports?.length ? "font-semibold text-[#7C5CE0]" : "text-[#98A0B5]"}`}>
                                  {item.ports?.length ? portDowntimeText(item.ports) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {reasons.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[11.5px] font-bold text-[#181C2E]">
                        Downtime by reason · last {days} days
                      </p>
                      <div className="mt-2 space-y-2">
                        {reasons.map((item) => (
                          <div key={item.code} title={item.detail}>
                            <div className="flex items-baseline justify-between gap-2 text-[11px]">
                              <span className="truncate font-semibold text-[#181C2E]">{item.title}</span>
                              <span className="shrink-0 tabular-nums text-[#5B6178]">
                                {formatDowntimeDuration(item.downtime_ms)} · {item.outage_count}×
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-[#F0F1F7]">
                              <div
                                className="h-1.5 rounded-full bg-[#C41E3D]/70"
                                style={{ width: `${Math.max(2, (item.downtime_ms / maxReasonMs) * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="mt-3 text-[10.5px] text-[#98A0B5]">
                    Tracking from {formatDowntimeTimestamp(availability?.period?.tracked_start)}
                    {portsNow.length > 0 &&
                      ` · ports monitored since ${formatDowntimeTimestamp(
                        portsNow.reduce(
                          (first, item) =>
                            !first || new Date(item.first_seen_at) < new Date(first) ? item.first_seen_at : first,
                          null,
                        ),
                      )}`}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FwInsight({ tone = "teal", icon, title, text, badge, badgeTone }) {
  const iconTones = {
    red: "bg-[#FCE9ED] text-[#C41E3D]",
    amber: "bg-[#FCF1DF] text-[#B45309]",
    teal: "bg-[#E6F5F9] text-[#0E7490]",
  };
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-3.5 ${tone === "red" ? "border-[#F5CBD5] bg-[#FFFBFC]" : "border-[#E7E9F2]"}`}
    >
      <span
        className={`grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-sm font-bold ${iconTones[tone] || iconTones.teal}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h4 className="text-[12.5px] font-semibold">{title}</h4>
        <p className="mt-0.5 text-xs text-[#5B6178]">{text}</p>
      </div>
      {badge && (
        <span className="ml-auto shrink-0 self-center">
          <FwPill tone={badgeTone}>{badge}</FwPill>
        </span>
      )}
    </div>
  );
}

function CombinedUtilization({ resource, sessions }) {
  const merged = resource.map((row, index) => ({
    ...row,
    sessions: sessions[index]?.sessions ?? null,
  }));
  if (!merged.length)
    return <EmptyPanel title="utilization history" configured />;
  return (
    <div className="h-[220px] px-3 pb-4 pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={merged}>
          <CartesianGrid stroke="#F0F1F7" vertical={false} />
          <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#98A0B5" }} />
          <YAxis
            yAxisId="pct"
            domain={[0, 100]}
            unit="%"
            width={34}
            tick={{ fontSize: 10, fill: "#98A0B5" }}
          />
          <YAxis
            yAxisId="sess"
            orientation="right"
            width={40}
            tick={{ fontSize: 10, fill: "#98A0B5" }}
            tickFormatter={(value) =>
              value >= 1000 ? `${Math.round(value / 1000)}k` : value
            }
          />
          <Tooltip
            contentStyle={{ borderRadius: 10, border: "1px solid #E5E9EF" }}
            formatter={(value, name) => [
              name === "Sessions"
                ? Number(value).toLocaleString()
                : `${value}%`,
              name,
            ]}
          />
          <Line
            yAxisId="sess"
            type="monotone"
            dataKey="sessions"
            name="Sessions"
            stroke="#0E7490"
            strokeWidth={2.2}
            dot={false}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="memory"
            name="Memory"
            stroke="#7C3AED"
            strokeWidth={1.8}
            dot={false}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="cpu"
            name="CPU"
            stroke="#E8833A"
            strokeWidth={1.8}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function InventoryCoverage({ devices, firewall }) {
  const rows = listFrom(devices);
  const total = rows.length;
  if (!total) return null;
  const mappedRows = rows.filter((row) => row.inventory_match);
  const avInstalled = mappedRows.filter((row) =>
    /installed|active|protected|running|enabled|up to date/i.test(row.av_status || ""),
  ).length;
  const avPending = Math.max(0, mappedRows.length - avInstalled);
  const unmappedRows = rows.filter((row) => !row.inventory_match);
  const coverage = Math.round((mappedRows.length / total) * 100);
  const percent = (value) => `${(value / total) * 100}%`;
  const exportUnmapped = () => {
    const columns = ["device", "ip_address", "mac_address", "operating_system", "interface", "last_seen"];
    const records = unmappedRows.map((row) => [
      row.hostname || row.device_type || "Unknown device",
      row.ipv4_address || "",
      row.mac || row.master_mac || "",
      [row.os_name, row.os_version].filter(Boolean).join(" "),
      row.detected_interface || row.online_interfaces?.join(", ") || "",
      row.traffic_last_seen || row.last_seen || "",
    ]);
    const csv = [columns, ...records]
      .map((record) => record.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = `${firewall}-unmapped-devices.csv`;
    link.click();
    URL.revokeObjectURL(href);
    toast.success(`Exported ${unmappedRows.length} unmapped devices`);
  };
  return (
    <div className={`${FW_CARD} p-[18px]`}>
      <div className="flex flex-wrap items-center gap-6">
        <div className="shrink-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#98A0B5]">
            Inventory coverage
          </p>
          <p
            className={`mt-1 text-[26px] font-bold tabular-nums ${coverage < 50 ? "text-[#C41E3D]" : "text-[#15803D]"}`}
          >
            {coverage}%
          </p>
          <p className="text-xs text-[#5B6178]">
            {mappedRows.length.toLocaleString()} of {total.toLocaleString()} devices
            identified
          </p>
        </div>
        <div className="min-w-0 flex-1 sm:min-w-[220px]">
          <div className="flex h-4 overflow-hidden rounded-lg">
            <div style={{ width: percent(avInstalled) }} className="bg-[#15803D]" title={`AV installed ${avInstalled}`} />
            <div style={{ width: percent(avPending) }} className="bg-[#F5C77E]" title={`AV pending ${avPending}`} />
            <div style={{ width: percent(unmappedRows.length) }} className="bg-[#EF8AA0]" title={`Unmapped ${unmappedRows.length}`} />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-3.5 text-[11.5px] text-[#5B6178]">
            <span className="flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px] bg-[#15803D]" />
              Mapped · AV installed
              <b className="ml-1 font-bold">{avInstalled.toLocaleString()}</b>
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px] bg-[#F5C77E]" />
              Mapped · AV pending
              <b className="ml-1 font-bold">{avPending.toLocaleString()}</b>
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px] bg-[#EF8AA0]" />
              Not in asset or AV inventory
              <b className="ml-1 font-bold">{unmappedRows.length.toLocaleString()}</b>
            </span>
          </div>
          <p className="mt-2.5 text-[11px] text-[#98A0B5]">
            Unmapped devices are network blind spots: no owner, no telemetry.
            Reconcile them against your asset inventory — the full device list is
            in the table below.
          </p>
        </div>
        <button type="button" onClick={exportUnmapped} disabled={!unmappedRows.length} className="w-full shrink-0 rounded-[10px] bg-[#4A5FE8] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[#3346C9] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
          <Download className="mr-1.5 inline h-3.5 w-3.5" /> Export {unmappedRows.length.toLocaleString()} unmapped
        </button>
      </div>
    </div>
  );
}

function FirewallArchivePanel({ firewall, configured, onLoaded }) {
  const [archives, setArchives] = useState([]);
  const [captureStatus, setCaptureStatus] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [openingDate, setOpeningDate] = useState("");
  const [page, setPage] = useState(1);
  const [recordPage, setRecordPage] = useState(1);
  const selectedRef = useRef(null);
  const dayRequestRef = useRef(0);
  const today = firewallArchiveInputDate(new Date());
  const rangeStart = firewallArchiveInputDate(
    new Date(Date.now() - 6 * 86400000),
  );
  const [from, setFrom] = useState(rangeStart);
  const [to, setTo] = useState(today);
  const pageSize = 12;
  const recordPageSize = 25;

  const load = async () => {
    setLoading(true);
    try {
      const result = await api(
        `/firewall/archive?firewall=${firewall}&limit=365`,
        { timeout: 30_000 },
      );
      setArchives(result.archives || []);
      onLoaded?.(result.archives || []);
      setCaptureStatus(result.capture_status || null);
      setPage(1);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    dayRequestRef.current += 1;
    setOpeningDate("");
    setSelected(null);
    load();
  }, [firewall]);

  useEffect(() => {
    if (!selected?.date) return;
    const frame = window.requestAnimationFrame(() => {
      selectedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      selectedRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected?.date]);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await api(
        `/firewall/archive/sync?firewall=${firewall}`,
        { method: "POST", timeout: 120_000 },
      );
      await load();
      toast.success(
        `Archived ${result.dates_archived || 0} day(s) from ${Number(result.records_observed || 0).toLocaleString()} detailed records`,
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSyncing(false);
    }
  };

  const openDay = async (date, targetPage = 1) => {
    const requestId = ++dayRequestRef.current;
    setOpeningDate(date);
    try {
      const result = await api(
        `/firewall/archive?firewall=${firewall}&date=${date}&record_page=${targetPage}&record_limit=${recordPageSize}`,
        { timeout: 60_000 },
      );
      if (requestId !== dayRequestRef.current) return;
      setSelected(result);
      setRecordPage(result.record_pagination?.page || targetPage);
    } catch (error) {
      if (requestId === dayRequestRef.current) toast.error(error.message);
    } finally {
      if (requestId === dayRequestRef.current) setOpeningDate("");
    }
  };

  const exportRange = (type = "details") => {
    if (from > to) return toast.error("From date must be before To date");
    const days = Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1;
    if (type === "details" && days > 7)
      return toast.error("Export up to 7 detailed archived days at a time");
    if (type === "summary" && days > 366)
      return toast.error("Export up to 366 archive summary days at a time");
    const link = document.createElement("a");
    link.href = `/api/firewall/archive/export?firewall=${firewall}&type=${type}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    link.download = `${firewall}-firewall-archive-${type}-${from}-to-${to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.success(
      type === "summary"
        ? "Daily summary export started"
        : "Detailed record export started",
    );
  };

  if (loading)
    return <div className="h-80 animate-pulse rounded-2xl bg-[#EDF0F4]" />;
  const totalPages = Math.max(1, Math.ceil(archives.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = archives.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const selectedRecords = selected?.records || [];
  const recordPages = selected?.record_pagination?.total_pages || 1;
  const totalSelectedRecords =
    selected?.record_pagination?.total_records || selectedRecords.length;
  const visibleRecords = selectedRecords;
  const escalationDays = archives.filter(
    (item) => item.escalation_count > 0,
  ).length;
  const observedTraffic = archives.reduce(
    (sum, item) => sum + Number(item.summary?.traffic_bytes || 0),
    0,
  );
  const lastArchiveAt = captureStatus?.last_archive_at
    ? new Date(captureStatus.last_archive_at)
    : null;
  const captureIsCurrent = Boolean(
    lastArchiveAt &&
      !Number.isNaN(lastArchiveAt.getTime()) &&
      Date.now() - lastArchiveAt.getTime() <= 30 * 60_000,
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-px overflow-hidden rounded-2xl border border-[#DDE2EA] bg-[#DDE2EA] sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Archived days", archives.length],
          ["Days with escalations", escalationDays],
          [
            "Stored records",
            archives
              .reduce(
                (sum, item) => sum + Number(item.summary?.stored_records || 0),
                0,
              )
              .toLocaleString(),
          ],
          ["Observed traffic", formatBytes(observedTraffic)],
        ].map(([label, value]) => (
          <div key={label} className="bg-white p-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8B93A1]">
              {label}
            </p>
            <b
              className={`mt-1 block text-2xl ${label.includes("escalation") && value ? "text-red-600" : ""}`}
            >
              {value}
            </b>
          </div>
        ))}
      </div>

      <div
        className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 text-xs ${
          captureStatus?.last_archive_error
            ? "border-red-200 bg-red-50 text-red-800"
            : captureIsCurrent
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
        }`}
      >
        <span
          className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
            captureStatus?.last_archive_error
              ? "bg-red-500"
              : captureIsCurrent
                ? "bg-emerald-500"
                : "bg-amber-500"
          }`}
        />
        <div className="min-w-0 flex-1">
          <b>
            {captureStatus?.last_archive_error
              ? "Automatic archive needs attention"
              : captureIsCurrent
                ? "Automatic archive is active"
                : "Waiting for the next automatic capture"}
          </b>
          <p className="mt-0.5 text-[11px] opacity-80">
            {captureStatus?.last_archive_error
              ? captureStatus.last_archive_error
              : captureStatus?.last_archive_at
                ? `Last ${captureStatus.last_archive_reason || "automatic"} capture ${formatDowntimeTimestamp(captureStatus.last_archive_at)} · ${Number(captureStatus.last_archive_records || 0).toLocaleString()} records observed. New retained firewall records are merged every 15 minutes.`
                : "The first background capture starts shortly after the service becomes available. Use Capture now if an immediate snapshot is required."}
          </p>
        </div>
        <span className="rounded-full border border-current/15 bg-white/70 px-2.5 py-1 font-semibold">
          {firewall.toUpperCase()} only
        </span>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[#DDE2EA] bg-white shadow-sm">
        <div className="flex flex-wrap items-end gap-3 border-b border-[#E5E9EF] px-5 py-4">
          <div className="mr-auto">
            <h3 className="text-lg font-bold">Daily firewall report archive</h3>
            <p className="text-xs text-[#8B93A1]">
              Persistent {firewall.toUpperCase()} traffic records, usage,
              mappings, security actions and downloadable evidence in
              Asia/Kolkata time.
            </p>
          </div>
          <label className="w-full text-[11px] font-semibold text-[#69738B] sm:w-auto">
            From
            <DateField
              value={from}
              max={to || undefined}
              onChange={setFrom}
              clearable
              className="mt-1 h-9 w-full rounded-lg px-2 text-xs sm:ml-2 sm:mt-0 sm:w-auto"
            />
          </label>
          <label className="w-full text-[11px] font-semibold text-[#69738B] sm:w-auto">
            To
            <DateField
              value={to}
              min={from || undefined}
              onChange={setTo}
              clearable
              className="mt-1 h-9 w-full rounded-lg px-2 text-xs sm:ml-2 sm:mt-0 sm:w-auto"
            />
          </label>
          <Button className="w-full sm:w-auto" variant="outline" onClick={() => exportRange("summary")}>
            <Download className="h-4 w-4" /> Summary CSV
          </Button>
          <Button className="w-full sm:w-auto" variant="outline" onClick={() => exportRange("details")}>
            <Download className="h-4 w-4" /> Detailed CSV
          </Button>
          <Button className="w-full sm:w-auto" onClick={sync} disabled={!configured || syncing}>
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            Capture now
          </Button>
        </div>
        {visible.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-[#FAFBFC] text-[10px] uppercase tracking-wider text-[#8B93A1]">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Records</th>
                  <th className="px-4 py-3">Systems</th>
                  <th className="px-4 py-3">Identified apps</th>
                  <th className="px-4 py-3">Traffic</th>
                  <th className="px-4 py-3">Blocked</th>
                  <th className="px-4 py-3">Threats</th>
                  <th className="px-4 py-3">Escalation</th>
                  <th className="px-4 py-3">Snapshot</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((archive) => (
                  <tr key={archive.id} className="border-t border-[#EDF0F4]">
                    <td className="px-4 py-3 font-semibold">{archive.date}</td>
                    <td className="px-4 py-3">
                      {Number(archive.summary?.stored_records || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">{archive.summary?.unique_sources || 0}</td>
                    <td className="px-4 py-3">{archive.summary?.applications || 0}</td>
                    <td className="px-4 py-3 font-semibold">
                      {formatBytes(archive.summary?.traffic_bytes || 0)}
                    </td>
                    <td className="px-4 py-3">{archive.summary?.blocked || 0}</td>
                    <td className="px-4 py-3">{archive.summary?.threats || 0}</td>
                    <td className="px-4 py-3">
                      {archive.escalation_count ? (
                        <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
                          {archive.escalation_count} flagged
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                          Clear
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!archive.source_identity_verified && (
                        <span className="mb-1 inline-block rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                          Appliance identity pending
                        </span>
                      )}
                      <div>
                      {archive.protected_before_downtime ? (
                        <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
                          Saved before downtime
                        </span>
                      ) : archive.record_limit_reached ? (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                          Saved · configured limit reached
                        </span>
                      ) : archive.archive_complete ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                          Detailed · complete
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                          Detailed · retained source
                        </span>
                      )}
                      </div>
                      <p className="mt-1 text-[10px] text-[#8B93A1]">
                        {archive.captured_at
                          ? formatDowntimeTimestamp(archive.captured_at)
                          : "Awaiting snapshot"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="outline" size="sm" disabled={Boolean(openingDate)} onClick={() => openDay(archive.date)}>
                        {openingDate === archive.date ? "Loading details…" : "View details"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-sm text-[#69738B]">
            No daily reports have been archived for {firewall.toUpperCase()} yet.
            {configured ? " Use Capture now to create the first archive." : " Historical records will remain available after the firewall reconnects."}
          </div>
        )}
        {archives.length > pageSize && (
          <div className="flex items-center justify-between border-t bg-[#FAFBFC] px-5 py-3 text-xs">
            <span>Page {currentPage} of {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
            </div>
          </div>
        )}
      </section>

      {selected && (
        <section ref={selectedRef} tabIndex={-1} aria-label={`Archived firewall details for ${selected.date}`} className="scroll-mt-24 overflow-hidden rounded-2xl border border-[#CCD5FF] bg-white shadow-sm outline-none">
          <div className="flex flex-wrap items-center gap-3 border-b border-[#DDE3FF] px-5 py-4">
            <div className="mr-auto">
              <h3 className="text-lg font-bold">
                {selected.firewall_label} · {selected.date}
              </h3>
              <p className="text-xs text-[#8B93A1]">
                {Number(totalSelectedRecords).toLocaleString()} stored records · captured {selected.captured_at ? new Date(selected.captured_at).toLocaleString("en-GB") : "—"}
              </p>
              <p className="mt-1 text-[11px] font-medium text-[#4A5FE8]">
                {selected.protected_before_downtime
                  ? `Protected before downtime at ${formatDowntimeTimestamp(selected.last_pre_downtime_protected_at)}`
                  : `Automatic daily snapshot · ${selected.record_limit_reached ? "configured storage limit reached; exported data contains every retained record shown here" : selected.archive_complete ? "complete daily coverage" : selected.source_complete ? "complete retained source; daily coverage may contain a gap" : "retained source may be partial"}`}
              </p>
              {!selected.source_identity_verified && (
                <p className="mt-1 text-[11px] font-semibold text-[#B45309]">
                  Legacy records without an appliance serial are preserved in
                  this archive but excluded from live HQ/HQ2 report totals.
                </p>
              )}
            </div>
            <Button variant="outline" asChild>
              <a
                href={`/api/firewall/archive/export?firewall=${firewall}&type=details&date=${encodeURIComponent(selected.date)}`}
                download={`${firewall}-firewall-archive-details-${selected.date}.csv`}
              >
                <Download className="h-4 w-4" /> Export stored day details
              </a>
            </Button>
            <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
          </div>
          {selected.escalations?.length > 0 && (
            <div className="grid gap-3 border-b border-[#F3D5DA] bg-[#FFF8F9] p-4 md:grid-cols-2">
              {selected.escalations.map((item) => (
                <div key={item.title} className="rounded-lg border border-[#F1C7CF] bg-white p-3">
                  <span className="text-[10px] font-bold uppercase text-red-600">{item.severity} escalation</span>
                  <p className="mt-1 text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-xs text-[#69738B]">{item.message}</p>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-px border-b border-[#E5E9EF] bg-[#E5E9EF] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {[
              ["Stored records", Number(totalSelectedRecords).toLocaleString()],
              ["Source systems", Number(selected.summary?.unique_sources || 0).toLocaleString()],
              ["Observed traffic", formatBytes(selected.summary?.traffic_bytes || 0)],
              ["Identified apps", Number(selected.summary?.applications || 0).toLocaleString()],
              ["Blocked", Number(selected.summary?.blocked || 0).toLocaleString()],
              ["Threat events", Number(selected.summary?.threats || 0).toLocaleString()],
            ].map(([label, metric]) => (
              <div key={label} className="bg-white px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8B93A1]">
                  {label}
                </p>
                <b className="mt-1 block text-lg">{metric}</b>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1900px] text-left text-xs">
              <thead className="bg-[#FAFBFC] uppercase tracking-wider text-[#8B93A1]">
                <tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Member / system</th><th className="px-3 py-2">Network identity</th><th className="px-3 py-2">Destination</th><th className="px-3 py-2">Application / service</th><th className="px-3 py-2">Category / risk</th><th className="px-3 py-2">Action / severity</th><th className="px-3 py-2">Policy / interfaces</th><th className="px-3 py-2 text-right">Sent</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Duration</th><th className="px-3 py-2">Message</th></tr>
              </thead>
              <tbody>
                {visibleRecords.map((record, index) => (
                  <tr key={`${record.timestamp}-${record.source_ip}-${index}`} className="border-t border-[#EDF0F4]">
                    <td className="whitespace-nowrap px-3 py-2">{new Date(record.timestamp).toLocaleString("en-GB")}</td>
                    <td className="px-3 py-2"><b>{record.asset_user_name || record.source_name || "Unmapped system"}</b><p className="text-[10px] text-[#8B93A1]">{record.employee_code || "No employee code"} · {record.source_device_type || record.source_os_name || "Unknown device"}</p><p className={record.inventory_match ? "text-[10px] text-emerald-700" : "text-[10px] font-semibold text-red-600"}>{record.inventory_match ? `Inventory mapped · AV ${record.av_status || "Unknown"}` : "Inventory mapping not found"}</p></td>
                    <td className="px-3 py-2 font-mono"><b>{record.source_ip || "—"}</b><p className="text-[10px] text-[#8B93A1]">{record.source_mac || "No MAC"}</p><p className="text-[10px] text-[#8B93A1]">Protocol {record.protocol || "—"}</p></td>
                    <td className="px-3 py-2 font-mono"><b>{record.destination_ip || "—"}:{record.destination_port || "—"}</b><p className="font-sans text-[10px] text-[#8B93A1]">{record.destination_country || "Unknown country"}</p></td>
                    <td className="px-3 py-2"><b>{record.application || record.service || "—"}</b><p className="text-[10px] text-[#8B93A1]">{record.application_identified ? "Firewall-identified application" : `Service/protocol · ${record.service || "unclassified"}`}</p></td>
                    <td className="px-3 py-2"><b>{record.category || "Unclassified"}</b><p className="text-[10px] text-[#8B93A1]">Risk {record.application_risk || "Unknown"}</p></td>
                    <td className="px-3 py-2"><b>{record.action || "—"}</b><p className="text-[10px] text-[#8B93A1]">{record.severity || "No severity"}</p></td>
                    <td className="px-3 py-2"><b>{record.policy || "—"}</b><p className="text-[10px] text-[#8B93A1]">{record.source_interface || "—"} → {record.destination_interface || "—"}</p></td>
                    <td className="px-3 py-2 text-right font-semibold">{formatBytes(record.sent_bytes || 0)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatBytes(record.received_bytes || 0)}</td>
                    <td className="px-3 py-2 text-right">{Number(record.duration_seconds || 0).toLocaleString()}s</td>
                    <td className="max-w-72 truncate px-3 py-2">{record.message || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recordPages > 1 && (
            <div className="flex items-center justify-between border-t bg-[#FAFBFC] px-5 py-3 text-xs">
              <span>Records page {recordPage} of {recordPages}</span>
              <div className="flex gap-2"><Button variant="outline" size="sm" disabled={recordPage === 1 || Boolean(openingDate)} onClick={() => openDay(selected.date, recordPage - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={recordPage === recordPages || Boolean(openingDate)} onClick={() => openDay(selected.date, recordPage + 1)}>Next</Button></div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default function FirewallView({ user }) {
  const [archives, setArchives] = useState(null);
  const [showStale, setShowStale] = useState(false);
  const checklistKey = `firewall-incident-checklist:${new Date().toISOString().slice(0, 10)}`;
  const [checklist, setChecklist] = useState({});
  useEffect(() => {
    try {
      setChecklist(JSON.parse(window.localStorage.getItem(checklistKey) || "{}"));
    } catch {
      setChecklist({});
    }
  }, [checklistKey]);
  const [data, setData] = useState(null);
  const [comparison, setComparison] = useState({ hq: null, hq2: null });
  const [trafficReport, setTrafficReport] = useState(null);
  const [trafficReportError, setTrafficReportError] = useState("");
  const [downtime, setDowntime] = useState({ hq: null, hq2: null });
  const [downtimeDays, setDowntimeDays] = useState(7);
  const [downtimeLoading, setDowntimeLoading] = useState(true);
  const [firewall, setFirewall] = useState("hq");
  const [tab, setTab] = useState("overview");
  const [activeMetric, setActiveMetric] = useState("System status");
  const [loading, setLoading] = useState(true);
  const [liveDetailsLoading, setLiveDetailsLoading] = useState(false);
  const [comparisonLoading, setComparisonLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const detailRef = useRef(null);
  const loadRequestRef = useRef(0);
  const loadDowntime = (period = downtimeDays) => {
    setDowntimeLoading(true);
    return Promise.all([
      api(`/firewall/downtime?firewall=hq&days=${period}`),
      api(`/firewall/downtime?firewall=hq2&days=${period}`),
    ])
      .then(([hq, hq2]) => setDowntime({ hq, hq2 }))
      .catch((error) => toast.error(error.message))
      .finally(() => setDowntimeLoading(false));
  };
  const load = () => {
    const targetFirewall = firewall;
    const requestId = ++loadRequestRef.current;
    const isCurrentRequest = () => loadRequestRef.current === requestId;
    setLoading(true);
    setLiveDetailsLoading(false);
    setTrafficReport(null);
    setTrafficReportError("");
    api(`/firewall/overview?firewall=${targetFirewall}&scope=summary`, {
      timeout: 30000,
    })
      .then((overview) => {
        if (!isCurrentRequest()) return;
        setData(overview);
        setComparison((current) => ({
          ...current,
          [targetFirewall]: overview,
        }));
        setLoading(false);
        setLiveDetailsLoading(true);

        return Promise.allSettled([
          firewallTrafficReportWithArchiveFallback(targetFirewall),
          api(
            `/firewall/overview?firewall=${targetFirewall}&scope=security`,
            { timeout: 120000 },
          ),
        ]).then(([reportResult, securityResult]) => {
          if (!isCurrentRequest()) return;
          if (reportResult.status === "fulfilled") {
            const report = reportResult.value;
            const trafficPayload = {
              sections: { logs: report.records || [] },
              section_meta: {
                logs: {
                  source: report.summary?.source || "firewall_report",
                  fetched_at: report.generated_at,
                  records_returned: Number(report.summary?.records || 0),
                  records_available: Number(
                    report.summary?.api_rows_available ||
                      report.summary?.records ||
                      0,
                  ),
                  complete: Boolean(report.summary?.source_complete),
                },
              },
              last_updated: report.generated_at,
            };
            setTrafficReport(report);
            setData((current) => mergeFirewallOverview(current, trafficPayload));
            setComparison((current) => ({
              ...current,
              [targetFirewall]: mergeFirewallOverview(
                current[targetFirewall],
                trafficPayload,
              ),
            }));
          } else {
            setTrafficReportError(
              reportResult.reason?.message || "Report unavailable",
            );
          }
          if (securityResult.status === "fulfilled") {
            setData((current) =>
              mergeFirewallOverview(current, securityResult.value),
            );
            setComparison((current) => ({
              ...current,
              [targetFirewall]: mergeFirewallOverview(
                current[targetFirewall],
                securityResult.value,
              ),
            }));
          } else {
            toast.error(
              securityResult.reason?.message ||
                "Live firewall security details are temporarily unavailable",
            );
          }
        });
      })
      .catch((error) => {
        if (isCurrentRequest()) toast.error(error.message);
      })
      .finally(() => {
        if (!isCurrentRequest()) return;
        setLoading(false);
        setLiveDetailsLoading(false);
      });
  };
  const loadComparison = () => {
    setComparisonLoading(true);
    const otherFirewall = firewall === "hq" ? "hq2" : "hq";
    api(`/firewall/overview?firewall=${otherFirewall}&scope=summary`, {
      timeout: 30000,
    })
      .then((overview) =>
        setComparison((current) => ({
          ...current,
          [otherFirewall]: overview,
        })),
      )
      .catch((error) => toast.error(error.message))
      .finally(() => setComparisonLoading(false));
  };
  const refreshAll = () => {
    load();
    loadComparison();
    loadDowntime();
  };
  const exportSevenDayReport = async () => {
    setReportLoading(true);
    try {
      // /firewall/report now returns a bounded page of records, so building the
      // CSV in the browser would silently export only that page. The archive
      // export endpoint streams the full range as CSV from the server instead.
      const to = firewallLocalDate();
      const from = firewallLocalDate(
        new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
      );
      const response = await fetch(
        `/api/firewall/archive/export?type=details&from=${from}&to=${to}&firewall=${firewall}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        let message = `Export failed (${response.status})`;
        try {
          message = (await response.json())?.error || message;
        } catch {}
        throw new Error(message);
      }
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${firewall}-firewall-report-${from}-to-${to}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success(`Exported ${firewall.toUpperCase()} firewall records for ${from} to ${to}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setReportLoading(false);
    }
  };
  useEffect(() => {
    setData(null);
    setTab("overview");
    setArchives(null);
    setShowStale(false);
    load();
  }, [firewall]);
  useEffect(() => {
    loadComparison();
  }, []);
  useEffect(() => {
    loadDowntime(downtimeDays);
  }, [downtimeDays]);
  const sections = data?.sections || {};
  const trafficLogs = useDeferredValue(
    trafficReport?.records || EMPTY_FIREWALL_ROWS,
  );
  const trafficPeriod = trafficReport?.period || null;
  const threatSections = Object.fromEntries(
    Object.entries(sections).filter(([name]) => name.startsWith("threat_")),
  );
  const securityRows = useMemo(() => {
    const sourceLabels = {
      threat_antivirus: "Antivirus",
      threat_ips: "Intrusion prevention",
      threat_web: "Web filter",
      threat_dns: "DNS filter",
    };
    return [
      ...listFrom(sections.events).map((row) => ({
        ...row,
        security_source: "System event",
      })),
      ...Object.entries(sourceLabels).flatMap(([key, label]) =>
        listFrom(sections[key]).map((row) => ({
          ...row,
          security_source: label,
          eventtype: row.eventtype || label,
        })),
      ),
    ];
  }, [
    sections.events,
    sections.threat_antivirus,
    sections.threat_ips,
    sections.threat_web,
    sections.threat_dns,
  ]);
  const securitySourceMeta = {
    "System event": data?.section_meta?.events || {},
    Antivirus: data?.section_meta?.threat_antivirus || {},
    "Intrusion prevention": data?.section_meta?.threat_ips || {},
    "Web filter": data?.section_meta?.threat_web || {},
    "DNS filter": data?.section_meta?.threat_dns || {},
  };
  const deviceCount =
    listFrom(sections.devices).length ||
    numberFrom(sections.statistics, [
      "connected_devices",
      "devices.connected",
      "clients",
    ]);
  const vpnCount =
    listFrom(sections.vpn).length ||
    numberFrom(sections.vpn, ["active", "connected", "active_tunnels"]);
  const eventCount =
    securityRows.length ||
    numberFrom(sections.statistics, [
      "security_events",
      "threats",
      "blocked_threats",
    ]);
  const throughput = textFrom(sections.statistics, [
    "throughput",
    "traffic.current",
    "bandwidth",
    "current_throughput",
  ]);
  const {
    applicationTraffic,
    unclassifiedTraffic,
    applicationCount,
    networkServiceCount,
  } = useMemo(() => {
    // These totals must describe the whole period. trafficReport.records is now
    // a bounded page, so they are derived from the server-side aggregate, which
    // is computed over every record in the period.
    const applications = trafficReport?.aggregates?.applications || [];
    const unclassifiedName = (name) =>
      !name ||
      /^(unscanned|unknown|unknown application|other traffic|other|unclassified)$/i.test(
        name,
      ) ||
      /^(udp|tcp)[/:]\d+/i.test(name);
    let unclassified = 0;
    const identifiedApplications = new Set();
    const networkServices = new Set();
    for (const row of applications) {
      const identified = row.source_kind === "application_control";
      if (identified) identifiedApplications.add(row.name);
      else if (row.name) networkServices.add(row.name);
      if (!identified || unclassifiedName(row.name))
        unclassified += Number(row.traffic_bytes || 0);
    }
    return {
      applicationTraffic: Number(trafficReport?.summary?.traffic_bytes || 0),
      unclassifiedTraffic: unclassified,
      applicationCount: identifiedApplications.size,
      networkServiceCount: networkServices.size,
    };
  }, [trafficReport]);
  const interfaceResults = sections.interfaces?.results || {};
  const interfaceRows = Array.isArray(interfaceResults)
    ? interfaceResults
    : Object.values(interfaceResults);
  const interfacesUp = interfaceRows.filter(
    (row) => row.link === true || row.link === "up" || row.status === "up",
  ).length;
  const policyRows = listFrom(sections.policies);
  const activeAcceptPolicies = policyRows.filter(
    (policy) =>
      policy.status !== "disable" &&
      String(policy.action || "accept").toLowerCase() === "accept",
  );
  const applicationControlPolicies = activeAcceptPolicies.filter((policy) =>
    String(policy["application-list"] || policy.application_list || "").trim(),
  );
  const cpuUsage = numberFrom(sections.statistics, [
    "results.cpu.0.current",
    "cpu.current",
    "cpu",
  ]);
  const memoryUsage = numberFrom(sections.statistics, [
    "results.mem.0.current",
    "memory.current",
    "memory",
  ]);
  const sessionCount = numberFrom(sections.statistics, [
    "results.session.0.current",
    "sessions.current",
    "sessions",
  ]);
  const cpuHistory =
    sections.statistics?.results?.cpu?.[0]?.historical?.["1-hour"]?.values ||
    [];
  const memoryHistory =
    sections.statistics?.results?.mem?.[0]?.historical?.["1-hour"]?.values ||
    [];
  const resourceHistory = cpuHistory
    .slice(-20)
    .map(([timestamp, value], index) => ({
      time: new Date(Number(timestamp) * 1000).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      cpu: Number(value) || 0,
      memory:
        Number(
          memoryHistory[
            memoryHistory.length - Math.min(cpuHistory.length, 20) + index
          ]?.[1],
        ) || 0,
    }));
  const sessionHistoryValues =
    sections.statistics?.results?.session?.[0]?.historical?.["1-hour"]
      ?.values || [];
  const sessionHistory = sessionHistoryValues
    .slice(-20)
    .map(([timestamp, value]) => ({
      time: new Date(Number(timestamp) * 1000).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      sessions: Number(value) || 0,
    }));
  const status =
    data?.operational_state || (data?.connected ? "online" : "down");
  const statusPresentation = {
    online: { label: "Online", tone: "green", dot: "bg-[#15803D]" },
    degraded: { label: "Degraded", tone: "amber", dot: "bg-[#B45309]" },
    down: { label: "Offline", tone: "red", dot: "bg-[#C41E3D]" },
    unconfigured: {
      label: "Setup required",
      tone: "gray",
      dot: "bg-[#98A0B5]",
    },
  }[status] || { label: "Not checked", tone: "gray", dot: "bg-[#98A0B5]" };
  const openDetail = (target, label) => {
    setTab(target);
    setActiveMetric(label);
    window.requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  // ---- redesign-derived signals (computed from the live payload) ----
  const eventList = securityRows;
  const { severityTally, eventGroups } = useMemo(() => {
    const severityOf = (row) => {
      const level = textFrom(
        row,
        ["level", "severity", "crlevel"],
        "",
      ).toLowerCase();
      if (/emergency|alert|critical|error/.test(level)) return "alert";
      if (/warn/.test(level)) return "warning";
      if (/notice/.test(level)) return "notice";
      return "information";
    };
    const tally = {};
    const groups = {};
    for (const row of eventList) {
      const severity = severityOf(row);
      tally[severity] = (tally[severity] || 0) + 1;
      const title = textFrom(
        row,
        ["logdesc", "msg", "message", "eventtype"],
        "Security event",
      );
      const key = `${title}|${severity}`;
      if (!groups[key])
        groups[key] = { title, severity, count: 0, sources: {} };
      groups[key].count += 1;
      const source = textFrom(
        row,
        ["srcip", "source_ip", "sourceIp", "src_ip", "srcname"],
        "",
      );
      if (source && source !== "—")
        groups[key].sources[source] =
          (groups[key].sources[source] || 0) + 1;
    }
    return {
      severityTally: tally,
      eventGroups: Object.values(groups).sort((a, b) => b.count - a.count),
    };
  }, [eventList]);
  const alertEvents = severityTally.alert || 0;
  const noticeEvents = severityTally.notice || 0;
  const infoEvents = severityTally.information || 0;
  const topAlertGroup = eventGroups.find(
    (group) => group.severity === "alert" || group.severity === "warning",
  );
  const topAlertSource = topAlertGroup
    ? Object.entries(topAlertGroup.sources).sort((a, b) => b[1] - a[1])[0]?.[0]
    : null;

  const deviceList = listFrom(sections.devices);
  const identifiedDevices = deviceList.filter(
    (device) => device.inventory_match,
  ).length;
  const unmappedDevices = Math.max(0, deviceList.length - identifiedDevices);
  const unmappedPct = deviceList.length
    ? Math.round((unmappedDevices / deviceList.length) * 100)
    : 0;

  const unclassifiedPct = applicationTraffic
    ? Math.round((unclassifiedTraffic / applicationTraffic) * 100)
    : 0;

  const interfacesDown = Math.max(0, interfaceRows.length - interfacesUp);
  const system = sections.status?.results || {};
  const configuration = sections.configuration?.results || {};
  const hqSnapshot = firewallSnapshot(comparison.hq || (firewall === "hq" ? data : null));
  const hq2Snapshot = firewallSnapshot(comparison.hq2 || (firewall === "hq2" ? data : null));
  const hqSerial = comparison.hq?.appliance_identity?.serial;
  const hq2Serial = comparison.hq2?.appliance_identity?.serial;
  const duplicateAppliance = Boolean(
    hqSerial && hq2Serial && hqSerial === hq2Serial,
  );
  const incompleteSections = Object.entries(data?.section_meta || {}).filter(
    ([, metadata]) => metadata.complete === false,
  );
  const headerName = system.hostname || configuration.hostname || data?.name || "Primary Firewall";
  const headerMeta = [
    system.model_name || system.model,
    sections.status?.version && `${sections.status.version} build ${sections.status.build || ""}`,
    configuration.timezone,
    configuration["vdom-mode"],
  ].filter(Boolean).join(" · ");

  const attention = [];
  if (topAlertGroup && topAlertGroup.count >= 3)
    attention.push({
      tone: "red",
      icon: "!",
      title: `${topAlertGroup.title} · ${topAlertGroup.count}×`,
      text: topAlertSource
        ? `Recurring ${topAlertGroup.severity} from ${topAlertSource}. Review the source and the event stream.`
        : `Recurring ${topAlertGroup.severity} event — inspect the security event stream.`,
      badge: "Critical",
      badgeTone: "red",
    });
  if (unmappedPct >= 50)
    attention.push({
      tone: "amber",
      icon: "▲",
      title: `${unmappedPct}% of devices unidentified`,
      text: `${unmappedDevices.toLocaleString()} of ${deviceList.length.toLocaleString()} devices have no hostname or known OS — inventory blind spots.`,
      badge: "High",
      badgeTone: "amber",
    });
  if (applicationTraffic && unclassifiedPct >= 80)
    attention.push({
      tone: "amber",
      icon: "▲",
      title: "Application Control not classifying traffic",
      text: `${unclassifiedPct}% of ${formatBytes(applicationTraffic)} is generic / unscanned. ${applicationControlPolicies.length} of ${activeAcceptPolicies.length} active allow policies have an Application Control profile assigned.`,
      badge: "High",
      badgeTone: "amber",
    });
  if (throughput === "—" || !throughput)
    attention.push({
      tone: "teal",
      icon: "i",
      title: "Throughput sensor unavailable",
      text: "Interface totals are lifetime counters since reboot, not a live per-second rate.",
      badge: "Info",
      badgeTone: "gray",
    });

  const siteDowntime = downtime[firewall];
  const siteDown =
    status === "down" ||
    (siteDowntime?.current?.state && siteDowntime.current.state !== "online");
  const siteState = (id) => {
    const state = downtime[id]?.current?.state || (comparison[id]?.connected ? "online" : comparison[id] ? "down" : null);
    return state === "online" ? "#12795a" : state ? "#b42318" : "#9a9aa3";
  };
  const model = useMemo(
    () =>
      buildFirewallModel({
        firewall,
        data,
        report: trafficReport,
        security: data?.security_summary || null,
        downtime,
        deviceList,
        interfaceRows,
        policyRows,
        activeAcceptPolicies,
        applicationControlPolicies,
        cpu: cpuUsage,
        memory: memoryUsage,
        sessions: sessionCount,
        sessionHistory,
        eventCount,
        archives,
        systemTypeFrom,
        mapped: identifiedDevices,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [firewall, data, trafficReport, downtime, archives],
  );
  const current = model.tabs[tab] || model.tabs.overview;
  const incidentSteps = current.incident
    ? [
        "Restrict admin access to trusted hosts (office + VPN only)",
        current.incident.subnets.length
          ? `Block ${current.incident.subnets.join(" and ")} at WAN`
          : "Block the top source IPs at WAN",
        current.incident.countries.length
          ? `Geo-block the admin port for ${current.incident.countries.join(", ")}`
          : "Geo-block the admin port for attacking countries",
        "Enforce 2FA for all firewall admins",
      ].map((t, i) => ({ t, done: Boolean(checklist[i]) }))
    : [];
  const toggleStep = (index) => {
    const next = { ...checklist, [index]: !checklist[index] };
    setChecklist(next);
    try {
      window.localStorage.setItem(checklistKey, JSON.stringify(next));
    } catch {}
  };
  const goTo = (target) => {
    if (target?.startsWith("site:")) {
      setFirewall(target.slice(5));
      return;
    }
    setTab(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const tabList = [
    ["overview", "Overview"],
    ["devices", "Devices"],
    ["applications", "Applications"],
    ["interfaces", "Traffic"],
    ["events", "Security"],
    ["archive", "Archive"],
  ].map(([key, label]) => ({
    key,
    label,
    badge: key === "applications" && liveDetailsLoading && !trafficReport ? "…" : key === "events" && liveDetailsLoading && !data?.security_summary ? "…" : model.badge[key]?.[0],
    tone: model.badge[key]?.[1] || "m",
  }));
  const headerSub = [
    firewall.toUpperCase(),
    [system.model_name || system.model, system.model_number].filter(Boolean).join("-"),
    sections.status?.version,
    data?.last_updated
      ? `refreshed ${new Date(data.last_updated).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const downSince = siteDowntime?.current?.state_since;

  if (loading && !data)
    return <div className="h-96 animate-pulse rounded-xl bg-[#EDF0F4]" />;
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-3.5 text-[13px] text-[#17171c]">
      <FwSiteHeader
        title="Firewall"
        statusLabel={siteDown ? `Offline${downSince ? ` ${formatDowntimeDuration(Date.now() - new Date(downSince))}` : ""}` : statusPresentation.label}
        statusTone={siteDown ? "red" : statusPresentation.tone}
        sub={siteDown && downSince ? `${firewall.toUpperCase()} · last contact ${new Date(downSince).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : headerSub}
        sites={[
          { id: "hq", label: "HQ", dot: siteState("hq") },
          { id: "hq2", label: "HQ2", dot: siteState("hq2") },
        ]}
        active={firewall}
        onSite={setFirewall}
        onRefresh={refreshAll}
        refreshing={loading || liveDetailsLoading}
        onReport={exportSevenDayReport}
        reporting={reportLoading || !data?.configured}
      />

      {siteDown && !showStale ? (
        <FwSiteDown
          site={firewall.toUpperCase()}
          downtime={siteDowntime}
          raiseTicket={
            user ? (
              <RaiseTicket
                user={user}
                onCreated={() => toast.success("Ticket raised")}
                trigger={
                  <button className="rounded-lg bg-[#17171c] px-3.5 py-[9px] text-[12.5px] text-white">
                    Raise IT ticket for {firewall.toUpperCase()}
                  </button>
                }
              />
            ) : null
          }
          onBack={() => setShowStale(true)}
        />
      ) : (
        <>
          <FwTabBar tabs={tabList} active={tab} onSelect={goTo} />
          {liveDetailsLoading && data && (
            <div role="status" className="flex items-center gap-3 rounded-xl border border-[#e8e7e3] bg-white px-4 py-3 text-xs text-[#55555e]">
              <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
              <span>Live overview ready. Traffic and security details are syncing in the background.</span>
            </div>
          )}
          {data?.configured && Object.keys(data.errors || {}).length > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <b>Some firewall endpoints could not be loaded.</b>
                <p className="mt-1 text-xs">{Object.entries(data.errors).map(([name, error]) => `${name}: ${error}`).join(" · ")}</p>
              </div>
            </div>
          )}
          {duplicateAppliance && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><b>HQ and HQ2 currently resolve to the same firewall appliance</b> (serial {hqSerial}). Treat the two views as one location until the second API URL points to its own appliance.</div>
            </div>
          )}
          {trafficReportError && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><b>Today&apos;s traffic report could not be verified.</b><p className="mt-1 text-xs">{trafficReportError}</p></div>
            </div>
          )}

          {current.kpis.length > 0 && <FwKpis kpis={current.kpis} />}
          {current.insights.length > 0 && <FwInsights items={current.insights} />}

          {tab === "overview" && (
            <FwActions actions={current.actions || []} sub={current.actionSub} onGo={goTo} />
          )}
          {tab === "devices" && current.coverage && (
            <FwDeviceCoverage
              coverage={current.coverage}
              funnel={current.funnel}
              note="Hostnames like “Ethara-GRP1048” already contain the employee code. Once the asset register is readable by the server, owners are matched automatically by MAC — see the device table below."
            />
          )}
          {tab === "applications" && (
            <FwAppComposition title={current.compTitle} comp={current.comp || []} />
          )}
          {tab === "events" && current.incident && (
            <FwIncident incident={current.incident} steps={incidentSteps} onToggle={toggleStep} />
          )}
          {tab === "archive" && current.cal && (
            <FwArchiveCalendar title={current.calTitle} cells={current.cal} />
          )}

          <FwChartsAndPanels charts={current.charts} panels={current.panels} />

          <div ref={detailRef} className="scroll-mt-24">
            {tab === "overview" &&
              (data?.configured ? (
                <div className="space-y-4">
                  <FirewallDowntimeSection
                    values={downtime}
                    days={downtimeDays}
                    onDaysChange={setDowntimeDays}
                    loading={downtimeLoading}
                    activeFirewall={firewall}
                    onSelect={setFirewall}
                  />
                  <details className="group overflow-hidden rounded-xl border border-[#e8e7e3] bg-white">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-[18px] py-3.5 text-[13px] font-semibold text-[#55555e]">
                      <Server className="h-4 w-4" />
                      System information &amp; admin configuration
                      <ChevronDown className="ml-auto h-4 w-4 transition group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-[#f1f0ec] p-3">
                      <SystemInformationPanel configuration={sections.configuration} status={sections.status} throughput={throughput} />
                    </div>
                  </details>
                  {firewall === "hq2" && (
                    <>
                      <HQ2FloorUsage logs={trafficLogs} />
                      <HQ2FloorPolicies value={sections.policies} />
                    </>
                  )}
                </div>
              ) : (
                <EmptyPanel title="Overview" configured={false} />
              ))}
            {tab === "devices" && (
              <div className="space-y-4">
                <InventoryCoverage devices={sections.devices} firewall={firewall} />
                <ConnectedDevicesPanel
                  value={sections.devices}
                  logs={sections.logs}
                  threats={threatSections}
                  threatErrors={data?.threat_errors}
                  source={sections.device_source}
                  firewall={firewall}
                />
              </div>
            )}
            {tab === "applications" && (
              <ApplicationUsagePanel
                value={trafficLogs}
                aggregates={trafficReport?.aggregates}
                devices={sections.devices}
                firewall={firewall}
                inspection={trafficReport?.summary?.application_control}
                loading={liveDetailsLoading && !trafficReport}
                policyCoverage={{
                  active: activeAcceptPolicies.length,
                  configured: applicationControlPolicies.length,
                }}
                reportSummary={trafficReport?.summary}
                reportPeriod={trafficReport?.period}
              />
            )}
            {tab === "interfaces" && (
              <InterfacesPanel value={sections.interfaces} firewall={firewall} lastUpdated={data?.last_updated} />
            )}
            {tab === "events" && (
              <div className="space-y-2">
                {data?.section_meta?.events?.rows_sent && (
                  <p className="text-xs text-[#6b6b76]">
                    The event table shows the newest {Number(data.section_meta.events.rows_sent).toLocaleString()} of {Number(data.section_meta.events.rows_summarised).toLocaleString()} retained events; the figures above cover all of them.
                  </p>
                )}
                <SecurityEventsPanel value={securityRows} sourceMeta={securitySourceMeta} />
              </div>
            )}
            {tab === "archive" && (
              <FirewallArchivePanel firewall={firewall} configured={Boolean(data?.configured)} onLoaded={setArchives} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

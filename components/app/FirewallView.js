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
  ["24h", "Last 24 hours"],
  ["1h", "Last 1 hour"],
  ["7d", "Last 7 days"],
  ["day", "Select a day"],
];

function bandwidthQuery(range, selectedDate) {
  if (range === "today") return "today=true";
  if (range === "24h") return "hours=24";
  if (range === "1h") return "hours=1";
  if (range === "7d") return "days=7";
  return `date=${selectedDate}`;
}

function bandwidthRangeLabel(range, selectedDate) {
  if (range === "day") return selectedDate;
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
  const [bandwidthDate, setBandwidthDate] = useState(
    firewallLocalDate(),
  );
  const [periodLogs, setPeriodLogs] = useState(null);
  const [bandwidthMeta, setBandwidthMeta] = useState(null);
  const [bandwidthError, setBandwidthError] = useState("");
  const [bandwidthLoading, setBandwidthLoading] = useState(false);
  useEffect(() => {
    const queryString = bandwidthQuery(bandwidthRange, bandwidthDate);
    setBandwidthLoading(true);
    setBandwidthError("");
    setPeriodLogs(null);
    const controller = new AbortController();
    api(`/firewall/report?${queryString}&firewall=${firewall}`, {
      signal: controller.signal,
      timeout: 60000,
    })
      .then((report) => {
        setPeriodLogs(report.records || []);
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
  }, [bandwidthRange, bandwidthDate, firewall]);
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
  ].sort();
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
  const effectiveBandwidthLogs = periodLogs ?? logs;
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
      client.sessions += 1;
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
        receivedMb: Number((traffic.received / 1024 ** 2).toFixed(2)),
        sentMb: Number((traffic.sent / 1024 ** 2).toFixed(2)),
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
              {bandwidthRangeLabel(bandwidthRange, bandwidthDate)}
            </p>
          </div>
          <select
            value={bandwidthRange}
            onChange={(event) => setBandwidthRange(event.target.value)}
            className="h-9 w-full rounded-lg border border-[#DDE2EA] bg-white px-3 text-sm sm:w-auto"
          >
            {BANDWIDTH_RANGES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {bandwidthRange === "day" && (
            <input
              type="date"
              value={bandwidthDate}
              max={firewallLocalDate()}
              onChange={(event) => setBandwidthDate(event.target.value)}
              className="h-9 w-full rounded-lg border border-[#DDE2EA] bg-white px-3 text-sm sm:w-auto"
            />
          )}
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
            [
              bandwidthRange === "day"
                ? "Selected day total"
                : "Observed bandwidth",
              formatBytes(totalObservedBandwidth),
            ],
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
                  <XAxis type="number" tick={{ fontSize: 10 }} unit=" MB" />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip />
                  <Bar
                    dataKey="receivedMb"
                    name="Downloaded"
                    stackId="bandwidth"
                    fill="#4F6EF7"
                  />
                  <Bar
                    dataKey="sentMb"
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
        <select
          value={interfaceFilter}
          onChange={(event) => setInterfaceFilter(event.target.value)}
          className="h-10 w-full rounded-lg border border-[#DDE2EA] bg-white px-3 text-sm sm:w-auto"
        >
          <option value="all">All interfaces</option>
          {interfaces.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
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

function identifiedApplication(row) {
  const explicit = textFrom(row, ["app", "application", "appname"], "");
  if (explicit) return { name: explicit, confidence: "identified" };
  const service = textFrom(row, ["service"], "Unknown service");
  return { name: service, confidence: "protocol" };
}

function UserActivityExplorer({ logs, devices, firewall }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const deviceRows = listFrom(devices);
  const byIp = Object.fromEntries(deviceRows.filter((row) => row.ipv4_address).map((row) => [row.ipv4_address, row]));
  const byMac = Object.fromEntries(deviceRows.flatMap((row) => [row.mac, row.master_mac].filter(Boolean).map((mac) => [firewallMacKey(mac), row])));
  const activity = Object.values(logs.reduce((summary, row) => {
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
  const filtered = activity.filter((item) => [item.member, item.employeeCode, item.email, item.hostname, item.ip, item.mac, item.os, ...item.applications.map((app) => app.name)].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => {
    setPage(1);
  }, [query, logs.length, firewall]);
  const detail = activity.find((item) => item.key === selected);
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
    {detail && <div className="border-t-2 border-[#D7DDF0] bg-[#F8F9FC] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h4 className="text-lg font-bold">Activity details · {detail.member}</h4><p className="text-xs text-[#69738B]">{detail.hostname} · {detail.ip} · {detail.mac || "No MAC"}</p></div><Button variant="outline" size="sm" onClick={() => setSelected(null)}>Close</Button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Applications/protocols", detail.applications.length], ["Unique destinations", detail.destinations.length], ["Countries", detail.countries.length], ["Policies matched", detail.policies.length]].map(([label, metric]) => <div key={label} className="rounded-lg border bg-white p-3"><p className="text-[10px] uppercase text-[#8B93A1]">{label}</p><b className="text-xl">{metric}</b></div>)}</div><div className="mt-4 overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[950px] text-left text-xs"><thead className="bg-[#F3F5F8] uppercase text-[#8B93A1]"><tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Application / service</th><th className="px-3 py-2">Destination</th><th className="px-3 py-2">Country</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Policy</th><th className="px-3 py-2 text-right">Duration</th><th className="px-3 py-2 text-right">Traffic</th></tr></thead><tbody>{detail.records.slice(0, 100).map((record, index) => <tr key={`${record.time}-${record.destination}-${index}`} className="border-t"><td className="whitespace-nowrap px-3 py-2">{record.time}</td><td className="px-3 py-2"><b>{record.application}</b><p className="text-[10px] text-[#8B93A1]">{record.confidence === "identified" ? "Firewall-identified app" : `Protocol/service · ${record.service}`}</p></td><td className="px-3 py-2 font-mono">{record.destination}:{record.port}</td><td className="px-3 py-2">{record.country}</td><td className="px-3 py-2">{record.action}</td><td className="px-3 py-2">{record.policy}</td><td className="px-3 py-2 text-right">{record.duration}s</td><td className="px-3 py-2 text-right font-semibold">{formatBytes(record.bytes)}</td></tr>)}</tbody></table></div><p className="mt-3 text-[11px] text-[#8B93A1]">Shows network metadata exposed by the firewall. Encrypted page contents, typed text and private message contents are not visible.</p></div>}
  </section>;
}

function ApplicationUsagePanel({ value, devices, firewall }) {
  const logs = listFrom(value);
  const applications = Object.values(
    logs.reduce((summary, row) => {
      const name = textFrom(
        row,
        ["app", "application", "appname", "service"],
        "Other traffic",
      );
      const category = textFrom(
        row,
        ["appcat", "category", "service"],
        "Unclassified",
      );
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
          sessions: 0,
          received: 0,
          sent: 0,
          total: 0,
        };
      summary[name].sessions += 1;
      summary[name].received += received;
      summary[name].sent += sent;
      summary[name].total += received + sent;
      return summary;
    }, {}),
  ).sort((a, b) => b.total - a.total || b.sessions - a.sessions);
  if (!applications.length)
    return <EmptyPanel title="Application usage" configured />;
  const totalTraffic = applications.reduce((sum, app) => sum + app.total, 0);
  const categories = Object.values(
    applications.reduce((summary, app) => {
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
      const application = textFrom(
        row,
        ["app", "application", "appname", "service"],
        "Other traffic",
      );
      const ip = textFrom(row, ["srcip", "source_ip", "ip"], "Unknown IP");
      const key = `${application}|${ip}`;
      if (!summary[key])
        summary[key] = {
          application,
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
  const applicationInventory = applications
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const specificallyIdentified = applications.filter(
    (app) =>
      !/^(http|https|ssl|quic|tcp\/\d+|udp\/\d+|unclassified|other traffic)$/i.test(
        app.name,
      ),
  );
  const genericSessions = applications
    .filter((app) =>
      /^(http|https|ssl|quic|tcp\/\d+|udp\/\d+|unclassified)$/i.test(app.name),
    )
    .reduce((sum, app) => sum + app.sessions, 0);
  const identifiedDevices = new Set(
    logs
      .map((row) => row.srcip || row.source_ip || row.srcmac || row.source_mac)
      .filter(Boolean),
  ).size;
  return (
    <div className="flex flex-col gap-4">
      <div className="order-1 grid gap-px overflow-hidden rounded-2xl border border-[#DDE2EA] bg-[#DDE2EA] shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            App traffic
          </p>
          <b className="mt-1 block text-xl">{formatBytes(totalTraffic)}</b>
          <span className="text-xs text-[#9CA3AF]">
            across {listFrom(devices).length.toLocaleString()} devices
          </span>
        </div>
        <div className="bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            Top application
          </p>
          <b className="mt-1 block truncate text-xl">{applications[0]?.name}</b>
          <span className="text-xs text-[#9CA3AF]">
            {formatBytes(applications[0]?.total)} ·{" "}
            {totalTraffic
              ? Math.round((applications[0]?.total / totalTraffic) * 100)
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
            Named apps
          </p>
          <b className="mt-1 block text-xl">{specificallyIdentified.length}<span className="text-[13px] font-semibold text-[#98A0B5]"> / {applications.length}</span></b>
          <span className="text-xs text-[#9CA3AF]">
            specifically identified applications
          </span>
        </div>
      </div>
      <div className="order-7">
        <UserActivityExplorer logs={logs} devices={devices} firewall={firewall} />
      </div>
      <div className="order-6 overflow-hidden rounded-2xl border border-[#CCD5FF] bg-white shadow-sm">
        <div className="border-b border-[#E0E5FF] px-5 py-4">
          <h3 className="text-lg font-bold">Application intelligence</h3>
          <p className="text-xs text-[#98A0B3]">
            Application identification quality, device reach and long-tail usage
            from live firewall records
          </p>
        </div>
        <div className="grid gap-px bg-[#E0E5FF] sm:grid-cols-2 lg:grid-cols-4">
          {[
            [
              "Specifically identified",
              specificallyIdentified.length,
              "named applications beyond generic protocols",
            ],
            [
              "Source devices observed",
              identifiedDevices,
              "devices represented in traffic logs",
            ],
            [
              "Generic/encrypted records",
              genericSessions.toLocaleString(),
              "requires deeper Application Control classification",
            ],
            [
              "Small applications tracked",
              smallerApplications.length,
              "lowest-volume consumers retained below",
            ],
          ].map(([label, metric, note]) => (
            <div key={label} className="bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7B86A4]">
                {label}
              </p>
              <b className="mt-1 block text-2xl text-[#3349A8]">{metric}</b>
              <span className="text-xs text-[#98A0B3]">{note}</span>
            </div>
          ))}
        </div>
        {specificallyIdentified.length ? (
          <div className="flex flex-wrap gap-2 p-5">
            {specificallyIdentified.map((app) => (
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
            The current traffic sample contains only generic protocol labels.
            Enable or permit detailed Application Control logging to identify
            exact external applications.
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
              Observed application volume by hour · peak hour {peakRange}
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
              Smaller bandwidth-consuming applications
            </h3>
            <p className="text-xs text-[#98A0B3]">
              Lowest-volume detected applications, retained for long-tail
              visibility
            </p>
          </div>
          <div className="grid gap-x-6 px-5 py-4 sm:grid-cols-2">
            {smallerApplications.map((app, index) => (
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
            <h3 className="text-lg font-bold">All detected applications</h3>
            <p className="text-xs text-[#98A0B3]">
              {applicationInventory.length} applications in the current firewall
              sample
            </p>
          </div>
          <div className="flex max-h-80 flex-wrap content-start gap-2 overflow-y-auto p-5">
            {applicationInventory.map((app) => (
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
            <h3 className="text-lg font-bold">Top applications</h3>
            <span className="text-sm text-[#98A0B3]">
              by total volume today
            </span>
          </div>
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-[#FAFBFC] text-[11px] uppercase tracking-wider text-[#9CA3AF]">
              <tr>
                <th className="px-4 py-3">Application</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Sessions</th>
                <th className="px-4 py-3 text-right">Received</th>
                <th className="px-4 py-3 text-right">Sent</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Share</th>
              </tr>
            </thead>
            <tbody>
              {applications.slice(0, 8).map((app) => (
                <tr key={app.name} className="border-t border-[#EDF0F4]">
                  <td className="px-4 py-3 font-semibold">{app.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{app.category}</Badge>
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
            <h3 className="text-lg font-bold">Top consumers per application</h3>
            <span className="text-sm text-[#98A0B3]">
              heaviest device for each app
            </span>
          </div>
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-[#FAFBFC] text-[11px] uppercase tracking-wider text-[#9CA3AF]">
              <tr>
                <th className="px-4 py-3">Application</th>
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
                        applications.find(
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

function TopApplicationsOverview({ value, onOpen }) {
  const rows = listFrom(value);
  const allApplications = Object.values(
    rows.reduce((summary, row) => {
      const name = textFrom(
        row,
        ["app", "application", "appname", "service"],
        "Other traffic",
      );
      if (!summary[name]) summary[name] = { name, total: 0 };
      summary[name].total +=
        numberFrom(row, ["rcvdbyte", "received_bytes", "download"]) +
        numberFrom(row, ["sentbyte", "sent_bytes", "upload"]);
      return summary;
    }, {}),
  ).sort((a, b) => b.total - a.total);
  const applications = allApplications.slice(0, 5);
  if (!applications.length) return null;
  const maximum = Math.max(...applications.map((app) => app.total), 1);
  const total = allApplications.reduce((sum, app) => sum + app.total, 0);
  const topTraffic = applications.reduce((sum, app) => sum + app.total, 0);
  const colors = ["#4A5FE8", "#7C3AED", "#0E7490", "#5B6178", "#B45309"];
  return (
    <div className={FW_CARD}>
      <div className="flex items-start justify-between gap-3 px-[18px] pt-4">
        <div>
          <h3 className="text-sm font-bold tracking-tight">Top applications today</h3>
          <p className="mt-0.5 text-xs text-[#98A0B5]">
            By observed volume · {allApplications.length} apps detected in total
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

function SecurityEventsPanel({ value }) {
  const events = listFrom(value);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [expandedGroup, setExpandedGroup] = useState(null);
  if (!events.length) return <EmptyPanel title="Security events" configured />;
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
    const raw = String(row.time || row.timestamp || "");
    const hour = Number(raw.match(/(?:T|^)(\d{2}):/)?.[1] ?? raw.slice(0, 2));
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
      ["Event type", textFrom(row, ["eventtype", "eventType", "subtype", "type"])],
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
        [row.date, row.time || row.timestamp].filter(Boolean).join(" ") || "—",
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
      <div className="grid gap-3.5 xl:grid-cols-[1.55fr_1fr]">
        <div className={FW_CARD}>
          <div className="flex flex-wrap items-start justify-between gap-3 px-[18px] pt-4">
            <div><h3 className="text-sm font-bold">Retained events by hour</h3><p className="mt-0.5 text-xs text-[#98A0B5]">{events.length.toLocaleString()} retained events · grouped by severity</p></div>
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
                <div>
                  <b>{group.title}</b>
                  <p className="text-xs text-[#9CA3AF]">
                    latest{" "}
                    {[group.latest.date, group.latest.time]
                      .filter(Boolean)
                      .join(" ") || "time unavailable"}
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
      </div>
    </div>
  );
}

function InterfacePeriodUsage({ firewall }) {
  const [range, setRange] = useState("today");
  const [selectedDate, setSelectedDate] = useState(firewallLocalDate());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const queryString = bandwidthQuery(range, selectedDate);
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
  }, [range, selectedDate, firewall]);

  const records = report?.records || [];
  const interfaceUsage = Object.values(
    records.reduce((summary, row) => {
      const name = row.source_interface || "Unclassified interface";
      if (!summary[name])
        summary[name] = { name, received: 0, sent: 0, total: 0, records: 0 };
      const received = Number(row.received_bytes || 0);
      const sent = Number(row.sent_bytes || 0);
      summary[name].received += received;
      summary[name].sent += sent;
      summary[name].total += received + sent;
      summary[name].records += 1;
      return summary;
    }, {}),
  ).sort((a, b) => b.total - a.total);
  const busiest = Math.max(...interfaceUsage.map((row) => row.total), 1);
  const sourceSystems = new Set(records.map((row) => row.source_ip).filter(Boolean))
    .size;

  return (
    <section className={`${FW_CARD} overflow-hidden`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-[#E7E9F2] px-[18px] py-4">
        <div className="mr-auto">
          <h3 className="text-sm font-bold">Interface usage by period</h3>
          <p className="mt-0.5 text-xs text-[#98A0B5]">
            Timestamped traffic logs grouped by source interface · {firewall.toUpperCase()}
          </p>
        </div>
        <select
          value={range}
          onChange={(event) => setRange(event.target.value)}
          className="h-9 w-full rounded-lg border border-[#DDE2EA] bg-white px-3 text-sm sm:w-auto"
        >
          {BANDWIDTH_RANGES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        {range === "day" && (
          <input
            type="date"
            value={selectedDate}
            max={firewallLocalDate()}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="h-9 w-full rounded-lg border border-[#DDE2EA] bg-white px-3 text-sm sm:w-auto"
          />
        )}
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${FW_PILL_TONES[tone] || FW_PILL_TONES.gray} ${className}`}
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

function FirewallDowntimeSection({
  values,
  days,
  onDaysChange,
  loading,
  activeFirewall,
  onSelect,
}) {
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
            Persisted availability checks; partial endpoint failures are shown as degraded.
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
      <div className="grid gap-3 p-3 sm:p-[18px] lg:grid-cols-2">
        {["hq", "hq2"].map((id) => {
          const availability = values[id];
          const currentState = availability?.current?.state || "unknown";
          const state = stateDetails[currentState] || stateDetails.unknown;
          const currentOutage = availability?.current_outage;
          const lastOutage = availability?.last_outage;
          const availabilityPercent =
            availability?.summary?.availability_percent;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className={`rounded-[14px] border p-4 text-left transition sm:p-[18px] ${
                activeFirewall === id
                  ? "border-[#AEB9FA] bg-[#FAFAFF] shadow-[0_0_0_2px_rgba(74,95,232,0.08)]"
                  : "border-[#E7E9F2] bg-white hover:border-[#CDD3E2]"
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
                  <p className="text-[11.5px] text-[#5B6178]">availability</p>
                </div>
                <FwPill tone={state.tone}>
                  <i className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
                  {state.label}
                </FwPill>
              </div>

              {loading && !availability ? (
                <div className="mt-4 h-24 animate-pulse rounded-xl bg-[#F0F1F7]" />
              ) : (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="rounded-[10px] bg-white p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A0B5]">
                        Downtime
                      </p>
                      <p className="mt-1 text-sm font-bold tabular-nums">
                        {formatDowntimeDuration(
                          availability?.summary?.total_downtime_ms,
                        )}
                      </p>
                    </div>
                    <div className="rounded-[10px] bg-white p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A0B5]">
                        Outages
                      </p>
                      <p className="mt-1 text-sm font-bold tabular-nums">
                        {availability?.summary?.outage_count ?? 0}
                      </p>
                    </div>
                    <div className="col-span-2 rounded-[10px] bg-white p-3 sm:col-span-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#98A0B5]">
                        Last probe
                      </p>
                      <p className="mt-1 truncate text-xs font-semibold">
                        {formatDowntimeTimestamp(
                          availability?.current?.last_probe_at,
                        )}
                      </p>
                    </div>
                  </div>
                  {currentOutage ? (
                    <div className="mt-3 rounded-[11px] border border-[#F5CBD5] bg-[#FFF6F7] p-3">
                      <p className="text-[11.5px] font-bold text-[#C41E3D]">
                        Current outage · {formatDowntimeDuration(currentOutage.duration_ms)}
                      </p>
                      <p className="mt-1 text-[11px] text-[#5B6178]">
                        Detected {formatDowntimeTimestamp(currentOutage.started_at)}
                      </p>
                      {currentOutage.pre_downtime_snapshot && (
                        <p className="mt-1.5 text-[10.5px] font-semibold text-[#4A5FE8]">
                          Pre-downtime report saved · {Number(
                            currentOutage.pre_downtime_snapshot.stored_records || 0,
                          ).toLocaleString()} records · {formatDowntimeTimestamp(
                            currentOutage.pre_downtime_snapshot.captured_at,
                          )}
                        </p>
                      )}
                    </div>
                  ) : lastOutage ? (
                    <div className="mt-3 rounded-[11px] border border-[#E7E9F2] bg-white p-3">
                      <p className="text-[11.5px] font-semibold text-[#5B6178]">
                        Last downtime · {formatDowntimeDuration(lastOutage.duration_ms)}
                      </p>
                      <p className="mt-1 text-[11px] text-[#98A0B5]">
                        {formatDowntimeTimestamp(lastOutage.started_at)} →{" "}
                        {formatDowntimeTimestamp(lastOutage.ended_at)}
                      </p>
                      {lastOutage.pre_downtime_snapshot && (
                        <p className="mt-1.5 text-[10.5px] font-semibold text-[#4A5FE8]">
                          Pre-downtime report saved · {Number(
                            lastOutage.pre_downtime_snapshot.stored_records || 0,
                          ).toLocaleString()} records
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-[11px] border border-[#D9EBDD] bg-[#F7FBF8] p-3 text-[11.5px] font-semibold text-[#15803D]">
                      No downtime recorded in this tracking window.
                    </div>
                  )}
                  <p className="mt-3 text-[10.5px] text-[#98A0B5]">
                    Tracking from {formatDowntimeTimestamp(availability?.period?.tracked_start)}
                  </p>
                </>
              )}
            </button>
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

function FirewallArchivePanel({ firewall, configured }) {
  const [archives, setArchives] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [page, setPage] = useState(1);
  const [recordPage, setRecordPage] = useState(1);
  const today = new Date().toISOString().slice(0, 10);
  const rangeStart = new Date(Date.now() - 6 * 86400000)
    .toISOString()
    .slice(0, 10);
  const [from, setFrom] = useState(rangeStart);
  const [to, setTo] = useState(today);
  const pageSize = 12;
  const recordPageSize = 25;

  const load = async () => {
    setLoading(true);
    try {
      const result = await api(
        `/firewall/archive?firewall=${firewall}&limit=365`,
      );
      setArchives(result.archives || []);
      setPage(1);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelected(null);
    load();
  }, [firewall]);

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
    try {
      const result = await api(
        `/firewall/archive?firewall=${firewall}&date=${date}&record_page=${targetPage}&record_limit=${recordPageSize}`,
        { timeout: 60_000 },
      );
      setSelected(result);
      setRecordPage(result.record_pagination?.page || targetPage);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const exportRange = async () => {
    if (from > to) return toast.error("From date must be before To date");
    const days = Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1;
    if (days > 7)
      return toast.error("Export up to 7 archived days at a time");
    const link = document.createElement("a");
    link.href = `/api/firewall/archive/export?firewall=${firewall}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    link.download = `${firewall}-firewall-archive-${from}-to-${to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.success("Detailed archive export started");
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

      <section className="overflow-hidden rounded-2xl border border-[#DDE2EA] bg-white shadow-sm">
        <div className="flex flex-wrap items-end gap-3 border-b border-[#E5E9EF] px-5 py-4">
          <div className="mr-auto">
            <h3 className="text-lg font-bold">Daily firewall report archive</h3>
            <p className="text-xs text-[#8B93A1]">
              Persistent HQ/HQ2 records, risk escalations and downloadable daily
              evidence in Asia/Kolkata time.
            </p>
          </div>
          <label className="w-full text-[11px] font-semibold text-[#69738B] sm:w-auto">
            From
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1 h-9 w-full rounded-lg border px-2 text-xs sm:ml-2 sm:mt-0 sm:w-auto"
            />
          </label>
          <label className="w-full text-[11px] font-semibold text-[#69738B] sm:w-auto">
            To
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1 h-9 w-full rounded-lg border px-2 text-xs sm:ml-2 sm:mt-0 sm:w-auto"
            />
          </label>
          <Button className="w-full sm:w-auto" variant="outline" onClick={exportRange}>
            <Download className="h-4 w-4" /> Export range
          </Button>
          <Button className="w-full sm:w-auto" onClick={sync} disabled={!configured || syncing}>
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            Sync last 7 days
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
                  <th className="px-4 py-3">Applications</th>
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
                      {archive.protected_before_downtime ? (
                        <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
                          Saved before downtime
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
                      <p className="mt-1 text-[10px] text-[#8B93A1]">
                        {archive.captured_at
                          ? formatDowntimeTimestamp(archive.captured_at)
                          : "Awaiting snapshot"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="outline" size="sm" onClick={() => openDay(archive.date)}>
                        View day
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
            {configured ? " Use Sync last 7 days to create the first archive." : " Historical records will remain available after the firewall reconnects."}
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
        <section className="overflow-hidden rounded-2xl border border-[#CCD5FF] bg-white shadow-sm">
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
                  : `Automatic daily snapshot · ${selected.archive_complete ? "complete daily coverage" : selected.source_complete ? "complete retained source; daily coverage may contain a gap" : "retained source may be partial"}`}
              </p>
            </div>
            <Button variant="outline" asChild>
              <a
                href={`/api/firewall/archive/export?firewall=${firewall}&date=${encodeURIComponent(selected.date)}`}
                download={`${firewall}-firewall-archive-${selected.date}.csv`}
              >
                <Download className="h-4 w-4" /> Export day
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-left text-xs">
              <thead className="bg-[#FAFBFC] uppercase tracking-wider text-[#8B93A1]">
                <tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Destination</th><th className="px-3 py-2">Application</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Severity</th><th className="px-3 py-2">Policy</th><th className="px-3 py-2 text-right">Traffic</th><th className="px-3 py-2">Message</th></tr>
              </thead>
              <tbody>
                {visibleRecords.map((record, index) => (
                  <tr key={`${record.timestamp}-${record.source_ip}-${index}`} className="border-t border-[#EDF0F4]">
                    <td className="whitespace-nowrap px-3 py-2">{new Date(record.timestamp).toLocaleString("en-GB")}</td>
                    <td className="px-3 py-2"><b>{record.source_name || record.source_ip || "—"}</b><p className="font-mono text-[10px] text-[#8B93A1]">{record.source_ip} · {record.source_mac}</p></td>
                    <td className="px-3 py-2 font-mono">{record.destination_ip || "—"}</td>
                    <td className="px-3 py-2">{record.application || "—"}</td>
                    <td className="px-3 py-2">{record.action || "—"}</td>
                    <td className="px-3 py-2">{record.severity || "—"}</td>
                    <td className="px-3 py-2">{record.policy || "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatBytes(Number(record.sent_bytes || 0) + Number(record.received_bytes || 0))}</td>
                    <td className="max-w-72 truncate px-3 py-2">{record.message || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recordPages > 1 && (
            <div className="flex items-center justify-between border-t bg-[#FAFBFC] px-5 py-3 text-xs">
              <span>Records page {recordPage} of {recordPages}</span>
              <div className="flex gap-2"><Button variant="outline" size="sm" disabled={recordPage === 1} onClick={() => openDay(selected.date, recordPage - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={recordPage === recordPages} onClick={() => openDay(selected.date, recordPage + 1)}>Next</Button></div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default function FirewallView() {
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
          api(`/firewall/report?today=true&firewall=${targetFirewall}`, {
            timeout: 120000,
          }),
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
      const report = await api(`/firewall/report?days=7&firewall=${firewall}`, {
        timeout: 60000,
      });
      const columns = [
        "timestamp",
        "source_ip",
        "destination_ip",
        "application",
        "action",
        "severity",
        "sent_bytes",
        "received_bytes",
        "message",
      ];
      const csv = [
        columns,
        ...(report.records || []).map((row) =>
          columns.map((column) => row[column] ?? ""),
        ),
      ]
        .map((record) =>
          record
            .map((value) => `"${String(value).replace(/"/g, '""')}"`)
            .join(","),
        )
        .join("\n");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      link.download = `${firewall}-firewall-report-${report.period.start.slice(0, 10)}-to-${report.period.end.slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success(
        `Exported ${report.summary.records} firewall records for the last 7 days`,
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setReportLoading(false);
    }
  };
  useEffect(() => {
    setData(null);
    setTab("overview");
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
    listFrom(sections.events).length ||
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
  const { applicationTraffic, unclassifiedTraffic, applicationCount } =
    useMemo(() => {
      let total = 0;
      let unclassified = 0;
      const applications = new Set();
      for (const row of trafficLogs) {
        const received = numberFrom(row, [
          "rcvdbyte",
          "received_bytes",
          "download",
        ]);
        const sent = numberFrom(row, ["sentbyte", "sent_bytes", "upload"]);
        const bytes = received + sent;
        const name = textFrom(
          row,
          ["app", "application", "appname", "service"],
          "Other traffic",
        );
        total += bytes;
        applications.add(name);
        if (
          /^(unscanned|unknown|other traffic|other|unclassified)$/i.test(name) ||
          /^(udp|tcp)[/:]\d+/i.test(name)
        )
          unclassified += bytes;
      }
      return {
        applicationTraffic: total,
        unclassifiedTraffic: unclassified,
        applicationCount: applications.size,
      };
    }, [trafficLogs]);
  const interfaceResults = sections.interfaces?.results || {};
  const interfaceRows = Array.isArray(interfaceResults)
    ? interfaceResults
    : Object.values(interfaceResults);
  const interfacesUp = interfaceRows.filter(
    (row) => row.link === true || row.link === "up" || row.status === "up",
  ).length;
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
  const eventList = listFrom(sections.events);
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
      text: `${unclassifiedPct}% of ${formatBytes(applicationTraffic)} is generic / unscanned. Enable an App Control profile to unlock category and risk data.`,
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

  if (loading && !data)
    return <div className="h-96 animate-pulse rounded-xl bg-[#EDF0F4]" />;
  return (
    <div className="mx-auto max-w-[1240px] space-y-[18px] rounded-2xl bg-[#F5F6FA] p-3 text-[#181C2E] sm:p-4 md:px-7 md:pb-10">
      <div className="flex flex-wrap items-center gap-4 py-1">
        <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] bg-gradient-to-br from-[#4A5FE8] to-[#3346C9] text-white">
          <Shield className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16.5px] font-bold tracking-tight">
              {headerName} — {firewall.toUpperCase()} firewall
            </h2>
            <FwPill tone={statusPresentation.tone}>
              <i className={`h-1.5 w-1.5 rounded-full ${statusPresentation.dot}`} />
              {statusPresentation.label}
            </FwPill>
          </div>
          <p className="mt-0.5 truncate text-xs text-[#98A0B5]">
            {headerMeta || "Live security, network and utilization visibility"} · last refreshed {data?.last_updated ? new Date(data.last_updated).toLocaleString("en-GB") : "—"}
          </p>
        </div>
        <div className="flex w-full overflow-x-auto rounded-[11px] border border-[#E7E9F2] bg-white p-[3px] sm:w-auto">
          {[["hq", hqSnapshot.devices], ["hq2", hq2Snapshot.devices]].map(([id, count]) => (
            <button key={id} type="button" onClick={() => setFirewall(id)} aria-pressed={firewall === id} className={`flex min-w-max flex-1 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition ${firewall === id ? "bg-[#4A5FE8] text-white" : "text-[#5B6178] hover:bg-[#F5F6FA]"}`}>
              {id.toUpperCase()} <span className="text-[11.5px] font-medium opacity-75">{Number(count || 0).toLocaleString()} devices</span>
            </button>
          ))}
        </div>
        <Button variant="outline" className="w-full rounded-[10px] border-[#E7E9F2] bg-white text-[12.5px] sm:w-auto" onClick={refreshAll} disabled={loading || comparisonLoading || liveDetailsLoading}>
          <RefreshCw className={`h-4 w-4 ${loading || liveDetailsLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <Button
          className="w-full rounded-[10px] bg-[#4A5FE8] text-[12.5px] text-white hover:bg-[#3346C9] sm:w-auto"
          onClick={exportSevenDayReport}
          disabled={reportLoading || !data?.configured}
        >
          <Download
            className={`h-4 w-4 ${reportLoading ? "animate-bounce" : ""}`}
          />
          7-day report
        </Button>
      </div>
      {liveDetailsLoading && data && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800"
        >
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          <span>
            <b>Live overview ready.</b> Retained traffic and security details
            are loading in the background; the page remains available while
            they sync.
          </span>
        </div>
      )}
      {data?.configured && Object.keys(data.errors || {}).length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>Some firewall endpoints could not be loaded.</b>
            <p className="mt-1 text-xs">
              {Object.entries(data.errors)
                .map(([name, error]) => `${name}: ${error}`)
                .join(" · ")}
            </p>
          </div>
        </div>
      )}
      {duplicateAppliance && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>HQ and HQ2 currently resolve to the same firewall appliance.</b>
            <p className="mt-1 text-xs">
              Both profiles returned serial {hqSerial}. Values are shown exactly
              as returned, but they cannot be treated as two independent locations
              until the second firewall API URL or token points to its own appliance.
            </p>
          </div>
        </div>
      )}
      {trafficReportError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>Today&apos;s traffic report could not be verified.</b>
            <p className="mt-1 text-xs">{trafficReportError}</p>
          </div>
        </div>
      )}
      {trafficReport && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[#DDE2EA] bg-white px-4 py-3 text-xs text-[#5B6178]">
          <Shield className="h-4 w-4 text-[#4A5FE8]" />
          <b className="text-[#374151]">Verified traffic period</b>
          <span>
            {formatUsageRangeTimestamp(trafficPeriod?.start)} →{" "}
            {formatUsageRangeTimestamp(trafficPeriod?.end)} IST
          </span>
          <span>{Number(trafficReport.summary?.records || 0).toLocaleString()} unique records</span>
          <span>
            {Number(trafficReport.summary?.api_rows_fetched || trafficReport.summary?.api_rows_returned || 0).toLocaleString()}
            /{Number(trafficReport.summary?.api_rows_available || 0).toLocaleString()}
            {" "}retained API rows fetched
          </span>
          <span>
            {Number(trafficReport.summary?.api_pages_fetched || 1)} firewall page(s)
          </span>
          <FwPill
            tone={trafficReport.summary?.source_complete ? "green" : "amber"}
          >
            {trafficReport.summary?.source_complete
              ? "Complete retained source"
              : "Partial source"}
          </FwPill>
          <span className="basis-full text-[11px] text-[#7B8498]">
            Period totals combine the firewall&apos;s currently retained memory
            logs with daily records already archived by this platform.
          </span>
        </div>
      )}
      {incompleteSections.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <b>Partial firewall section data:</b>{" "}
          {incompleteSections
            .map(
              ([name, metadata]) =>
                `${name} (${metadata.records_returned}/${metadata.records_available})`,
            )
            .join(" · ")}
        </div>
      )}
      {topAlertGroup && topAlertGroup.count >= 5 && (
        <div className="flex flex-wrap items-center gap-4 rounded-[13px] border border-[#F5CBD5] bg-[#FFF6F7] px-4 py-3">
          <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-[#FCE9ED] text-lg font-extrabold text-[#C41E3D]">
            !
          </span>
          <div className="min-w-0">
            <h4 className="text-[13.5px] font-bold text-[#C41E3D]">
              {topAlertGroup.title} — {topAlertGroup.count} events in the current
              window
            </h4>
            <p className="mt-0.5 text-[12.5px] text-[#5B6178]">
              {topAlertSource ? (
                <>
                  Highest volume from{" "}
                  <b className="font-mono text-[#C41E3D]">{topAlertSource}</b>.{" "}
                </>
              ) : null}
              This {topAlertGroup.severity} is the most frequent event right now
              — treat it as one incident, not {topAlertGroup.count} problems.
            </p>
          </div>
          <button
            onClick={() => openDetail("events", "Security events")}
            className="ml-auto shrink-0 rounded-[10px] border border-[#E7E9F2] bg-white px-3.5 py-2 text-[12.5px] font-semibold hover:bg-[#F7F8FB]"
          >
            View events →
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <button
          type="button"
          onClick={() => openDetail("overview", "Active sessions")}
          className="text-left"
        >
          <FwKpi label="Active sessions" value={sessionCount.toLocaleString()}>
            concurrent connections
          </FwKpi>
        </button>
        <button
          type="button"
          onClick={() => openDetail("devices", "Connected devices")}
          className="text-left"
        >
          <FwKpi label="Connected devices" value={deviceCount.toLocaleString()}>
            {unmappedDevices ? (
              <span className="font-semibold text-[#C41E3D]">
                {unmappedDevices.toLocaleString()} unidentified
              </span>
            ) : (
              <span className="font-semibold text-[#15803D]">
                all identified
              </span>
            )}
          </FwKpi>
        </button>
        <button
          type="button"
          onClick={() => openDetail("events", "Security events")}
          className="text-left"
        >
          <FwKpi
            label="Security events"
            value={eventCount.toLocaleString()}
            valueClass={alertEvents ? "text-[#C41E3D]" : ""}
          >
            {alertEvents ? (
              <>
                <b className="font-semibold text-[#C41E3D]">
                  {alertEvents} alerts
                </b>{" "}
                · {infoEvents} info · {noticeEvents} notice
              </>
            ) : (
              `${infoEvents} info · ${noticeEvents} notice`
            )}
          </FwKpi>
        </button>
        <FwKpi
          label="CPU · Memory"
          value={
            <>
              {cpuUsage}% <span className="text-[#98A0B5]">·</span> {memoryUsage}%
            </>
          }
        >
          {cpuUsage < 70 && memoryUsage < 85 ? (
            <span className="font-semibold text-[#15803D]">Healthy headroom</span>
          ) : (
            <span className="font-semibold text-[#B45309]">Elevated</span>
          )}
        </FwKpi>
        <button
          type="button"
          onClick={() => openDetail("applications", "App traffic")}
          className="text-left"
        >
          <FwKpi label="App traffic" value={formatBytes(applicationTraffic)}>
            {applicationTraffic ? (
              unclassifiedPct >= 80 ? (
                <span className="font-semibold text-[#B45309]">
                  {unclassifiedPct}% unscanned
                </span>
              ) : (
                `${100 - unclassifiedPct}% classified`
              )
            ) : (
              "no traffic logged"
            )}
          </FwKpi>
        </button>
        <button
          type="button"
          onClick={() => openDetail("interfaces", "Interfaces")}
          className="text-left"
        >
          <FwKpi
            label="Interfaces"
            value={
              <>
                {interfacesUp}{" "}
                <span className="text-[13px] font-semibold text-[#98A0B5]">
                  up
                </span>
              </>
            }
          >
            {interfacesDown} down — unused ports
          </FwKpi>
        </button>
      </div>
      <FirewallDowntimeSection
        values={downtime}
        days={downtimeDays}
        onDaysChange={setDowntimeDays}
        loading={downtimeLoading}
        activeFirewall={firewall}
        onSelect={setFirewall}
      />
      <div
        ref={detailRef}
        className="scroll-mt-4 flex gap-1 overflow-x-auto rounded-xl border border-[#E7E9F2] bg-white p-1 shadow-[0_1px_2px_rgba(24,28,46,0.05),0_4px_14px_rgba(24,28,46,0.05)]"
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setTab(key);
              setActiveMetric(null);
            }}
            className={`flex min-w-max flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2.5 text-[13px] font-semibold transition ${tab === key ? "bg-[#4A5FE8] text-white shadow-sm" : "text-[#5B6178] hover:bg-[#F5F6FA]"}`}
          >
            {label}
            {key === "devices" && <span className={`rounded-full px-2 py-0.5 text-[10.5px] ${tab === key ? "bg-white/20" : "bg-[#F0F1F7]"}`}>{deviceCount.toLocaleString()}</span>}
            {key === "applications" && <span className={`rounded-full px-2 py-0.5 text-[10.5px] ${tab === key ? "bg-white/20" : "bg-[#F0F1F7]"}`}>{applicationCount.toLocaleString()}</span>}
            {key === "interfaces" && <span className={`rounded-full px-2 py-0.5 text-[10.5px] ${tab === key ? "bg-white/20" : "bg-[#F0F1F7]"}`}>{interfacesUp} up</span>}
            {key === "events" && <span className={`rounded-full px-2 py-0.5 text-[10.5px] ${tab === key ? "bg-white/20" : eventCount ? "bg-[#FCE9ED] text-[#C41E3D]" : "bg-[#F0F1F7]"}`}>{eventCount.toLocaleString()}</span>}
          </button>
        ))}
      </div>
      <div>
        {tab === "overview" &&
          (data?.configured ? (
            <div className="space-y-5">
              <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
                <div className={FW_CARD}>
                  <div className="flex items-start justify-between gap-3 px-[18px] pb-0 pt-4">
                    <div>
                      <div className="text-sm font-bold tracking-tight">
                        Sessions &amp; utilization — last hour
                      </div>
                      <div className="mt-0.5 text-xs text-[#98A0B5]">
                        Sessions, CPU and memory in one combined view
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[11.5px] text-[#5B6178]">
                      <span className="flex items-center gap-1.5">
                        <i className="h-2 w-2 rounded-[3px] bg-[#0E7490]" />
                        Sessions
                      </span>
                      <span className="flex items-center gap-1.5">
                        <i className="h-2 w-2 rounded-[3px] bg-[#7C3AED]" />
                        Memory
                      </span>
                      <span className="flex items-center gap-1.5">
                        <i className="h-2 w-2 rounded-[3px] bg-[#E8833A]" />
                        CPU
                      </span>
                    </div>
                  </div>
                  <CombinedUtilization
                    resource={resourceHistory}
                    sessions={sessionHistory}
                  />
                </div>
                <div className={FW_CARD}>
                  <div className="px-[18px] pb-0 pt-4">
                    <div className="text-sm font-bold tracking-tight">
                      Needs attention
                    </div>
                    <div className="mt-0.5 text-xs text-[#98A0B5]">
                      Ranked by risk — everything else is healthy
                    </div>
                  </div>
                  <div className="space-y-2.5 p-[18px] pt-3.5">
                    {attention.length ? (
                      attention.map((item) => (
                        <FwInsight key={item.title} {...item} />
                      ))
                    ) : (
                      <div className="flex items-center gap-3 rounded-xl border border-[#E7E9F2] bg-[#F7FBF8] p-4 text-sm text-[#15803D]">
                        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#E8F6EE] font-bold">
                          ✓
                        </span>
                        No outstanding issues detected in the current window.
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid gap-3.5 lg:grid-cols-2">
                <TopApplicationsOverview
                  value={trafficLogs}
                  onOpen={() => openDetail("applications", "Throughput")}
                />
                <FirewallEstateComparison values={comparison} onSelect={setFirewall} />
              </div>
              <details className="group overflow-hidden rounded-2xl border border-[#E7E9F2] bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-[18px] py-3.5 text-[13px] font-semibold text-[#5B6178]">
                  <Server className="h-4 w-4" />
                  System information &amp; admin configuration
                  <ChevronDown className="ml-auto h-4 w-4 transition group-open:rotate-180" />
                </summary>
                <div className="border-t border-[#F0F1F7] p-3">
                  <SystemInformationPanel
                    configuration={sections.configuration}
                    status={sections.status}
                    throughput={throughput}
                  />
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
            <InventoryCoverage
              devices={sections.devices}
              firewall={firewall}
            />
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
          <div className="space-y-4">
            {applicationTraffic > 0 && unclassifiedPct >= 80 && (
              <div className="flex flex-wrap items-center gap-3 rounded-[13px] border border-[#F2DEB8] bg-[#FFFBF3] px-4 py-3">
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-[#FCF1DF] text-[#B45309]">
                  ▲
                </span>
                <div className="min-w-0">
                  <h4 className="text-[13.5px] font-bold text-[#B45309]">
                    Application Control is not classifying traffic
                  </h4>
                  <p className="mt-0.5 text-[12.5px] text-[#5B6178]">
                    {unclassifiedPct}% of {formatBytes(applicationTraffic)} is
                    generic &ldquo;unscanned&rdquo; — app names below are
                    port-based guesses. Enable an Application Control profile on
                    LAN→WAN policies to unlock category and risk data.
                  </p>
                </div>
              </div>
            )}
            <ApplicationUsagePanel
              value={trafficLogs}
              devices={sections.devices}
              firewall={firewall}
            />
          </div>
        )}
        {tab === "interfaces" && (
          <InterfacesPanel
            value={sections.interfaces}
            firewall={firewall}
            lastUpdated={data?.last_updated}
          />
        )}
        {tab === "events" && <SecurityEventsPanel value={sections.events} />}
        {tab === "archive" && (
          <FirewallArchivePanel
            firewall={firewall}
            configured={Boolean(data?.configured)}
          />
        )}
      </div>
    </div>
  );
}

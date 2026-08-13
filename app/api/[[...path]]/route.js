import { connectToPostgres } from "@/lib/postgres-document-db";
import { v4 as uuidv4 } from "uuid";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import {
  slaDates,
  isBusinessTime,
  nextBusinessTime,
  workingHoursBetween,
  workingMinutesBetween,
} from "@/lib/sla";

// ---------------- PostgreSQL ----------------
let db;
let connecting;
async function connectToDatabase() {
  if (db) return db;
  if (!connecting) {
    connecting = (async () => {
      db = await connectToPostgres();
      await Promise.all([
        db.collection("users").createIndex({ email: 1 }, { unique: true }),
        db.collection("tickets").createIndex({ id: 1 }, { unique: true }),
        db.collection("tickets").createIndex({ human_id: 1 }, { unique: true }),
        db.collection("tickets").createIndex({ department: 1, status: 1, created_at: -1 }),
        db.collection("tickets").createIndex({
          department: 1,
          routing_site: 1,
          assignee_id: 1,
          status: 1,
          created_at: -1,
        }),
        db.collection("tickets").createIndex({ sla_response_due: 1, response_sla_breached_at: 1 }),
        db.collection("tickets").createIndex({ sla_resolution_due: 1, resolution_sla_breached_at: 1 }),
        db.collection("approvals").createIndex({ ticket_id: 1 }),
        db.collection("notifications").createIndex({ user_id: 1, created_at: -1 }),
        db.collection("audit_logs").createIndex({ created_at: -1 }),
        db.collection("email_outbox").createIndex({ dedupe_key: 1 }, { unique: true }),
        db.collection("email_outbox").createIndex({ status: 1, next_attempt_at: 1 }),
        db.collection("email_verifications").createIndex(
          { token_hash: 1 },
          { unique: true },
        ),
        db.collection("email_verifications").createIndex(
          { expires_at: 1 },
          { expireAfterSeconds: 0 },
        ),
        db.collection("attachments").createIndex({ id: 1 }, { unique: true }),
        db.collection("attachments").createIndex({ owner_id: 1, linked_entity: 1, created_at: -1 }),
        db.collection("firewall_daily_archives").createIndex(
          { firewall_id: 1, date: -1 },
          { unique: true },
        ),
        db.collection("firewall_health").createIndex(
          { firewall_id: 1 },
          { unique: true },
        ),
        db.collection("firewall_outages").createIndex(
          { firewall_id: 1, open: 1 },
          { unique: true, partialFilterExpression: { open: true } },
        ),
        db.collection("firewall_outages").createIndex(
          { firewall_id: 1, started_at: -1 },
        ),
      ]);
      await ensureDesignatedItManagers(db);
      await ensureTicketRoutingData(db);
      await migrateTicketSlaData(db);
      startSlaMonitor(db);
      startFirewallHealthMonitor(db);
      return db;
    })().catch((error) => {
      connecting = null;
      throw error;
    });
  }
  return connecting;
}

function jwtSecret() {
  const value = process.env.JWT_SECRET;
  if (!value || Buffer.byteLength(value, "utf8") < 32)
    throw new Error("JWT_SECRET must contain at least 32 bytes");
  return new TextEncoder().encode(value);
}

function emailVerificationRequired() {
  if (process.env.EMAIL_VERIFICATION_REQUIRED === "true") return true;
  if (process.env.EMAIL_VERIFICATION_REQUIRED === "false") return false;
  return process.env.NODE_ENV === "production";
}

function publicAppOrigin(request) {
  const configured = process.env.PUBLIC_APP_URL;
  if (configured) return new URL(configured).origin;
  if (process.env.NODE_ENV === "production")
    throw new Error("PUBLIC_APP_URL must be configured in production");
  return new URL(request.url).origin;
}

// ---------------- helpers ----------------
function json(data, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function loginRateLimitKey(request, email) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return createHash("sha256").update(`${ip}:${email}`).digest("hex");
}
async function loginRateLimited(db, request, email) {
  const result = await db.consumeRateLimit(loginRateLimitKey(request, email), 8, 15 * 60_000);
  return result.limited;
}
async function clearLoginAttempts(db, request, email) {
  await db.clearRateLimit(loginRateLimitKey(request, email));
}

let localFirewallProfiles;
function firewallProfile(request) {
  const requested =
    (typeof request === "string"
      ? request
      : new URL(request.url).searchParams.get("firewall")) === "hq"
      ? "hq"
      : "hq2";
  if (!localFirewallProfiles) {
    localFirewallProfiles = [];
    try {
      const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);
      let current = null;
      for (const line of lines) {
        const match = line.match(/^(FIREWALL_[A-Z0-9_]+)=(.*)$/);
        if (!match) continue;
        if (match[1] === "FIREWALL_API_URL") {
          current = {};
          localFirewallProfiles.push(current);
        }
        if (current) current[match[1].replace(/^FIREWALL_/, "")] = match[2];
      }
    } catch {
      localFirewallProfiles = [];
    }
  }
  const localIndex = requested === "hq" ? 1 : 0;
  const local = localFirewallProfiles[localIndex] || {};
  const prefix = requested === "hq" ? "FIREWALL_HQ_" : "FIREWALL_HQ2_";
  const value = (key, fallback = "") =>
    process.env[`${prefix}${key}`] ||
    local[key] ||
    process.env[`FIREWALL_${key}`] ||
    fallback;
  return { id: requested, label: requested === "hq" ? "HQ" : "HQ2", value };
}

function normalizeCertificateFingerprint(value) {
  return String(value || "")
    .replace(/[^a-f0-9]/gi, "")
    .toUpperCase();
}

function pinnedFirewallAgent(expectedFingerprint) {
  const expected = normalizeCertificateFingerprint(expectedFingerprint);
  if (expected.length !== 64)
    throw new Error("Firewall certificate pin must be a SHA-256 fingerprint");
  const agent = new HttpsAgent({ keepAlive: false });
  agent.createConnection = (options, callback) => {
    const socket = tlsConnect({
      ...options,
      minVersion: "TLSv1.2",
      rejectUnauthorized: false,
    });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) {
        socket.destroy(error);
        callback(error);
      } else callback(null, socket);
    };
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      const actual = normalizeCertificateFingerprint(
        certificate?.fingerprint256,
      );
      if (!actual || actual !== expected) {
        const error = new Error("Firewall certificate fingerprint mismatch");
        error.code = "FIREWALL_CERT_PIN_MISMATCH";
        finish(error);
        return;
      }
      const now = Date.now();
      const validFrom = Date.parse(certificate.valid_from);
      const validTo = Date.parse(certificate.valid_to);
      if (
        !Number.isFinite(validFrom) ||
        !Number.isFinite(validTo) ||
        now < validFrom ||
        now > validTo
      ) {
        const error = new Error("Firewall certificate is expired or not yet valid");
        error.code = "FIREWALL_CERT_INVALID_DATE";
        finish(error);
        return;
      }
      finish();
    });
    socket.once("error", finish);
  };
  return agent;
}

async function firewallRequest(url, headers, tls = {}) {
  const target = new URL(url);
  const isHttps = target.protocol === "https:";
  const allowSelfSigned = tls.allowSelfSigned === true;
  const caPath = tls.caPath;
  const certSha256 = tls.certSha256;
  if (allowSelfSigned && process.env.NODE_ENV === "production")
    throw new Error("Self-signed firewall certificate bypass is disabled in production");
  const options = { method: "GET", headers, timeout: 10000 };
  if (isHttps) {
    if (certSha256) options.agent = pinnedFirewallAgent(certSha256);
    else {
      options.rejectUnauthorized = !allowSelfSigned;
      if (caPath) options.ca = readFileSync(caPath);
    }
  }
  return new Promise((resolve, reject) => {
    const request = (isHttps ? httpsRequest : httpRequest)(
      target,
      options,
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300)
            return reject(new Error(`HTTP ${response.statusCode}`));
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            reject(new Error("Firewall returned a non-JSON response"));
          }
        });
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("Request timed out")),
    );
    request.on("error", reject);
    request.end();
  });
}

const FIREWALL_HEALTH_MONITOR_KEY = Symbol.for(
  "ticketflow.firewallHealthMonitor",
);

async function probeFirewallAvailability(db, firewallId) {
  const profile = firewallProfile(firewallId);
  const fw = profile.value;
  const baseUrl = String(fw("API_URL")).replace(/\/$/, "");
  const apiKey = fw("API_KEY");
  if (!baseUrl || !apiKey) {
    await recordFirewallHealth(db, profile, "unconfigured");
    return;
  }
  const headerName = fw("API_HEADER", "Authorization");
  const prefix = fw("API_PREFIX", "Bearer");
  const headers = {
    Accept: "application/json",
    [headerName]: prefix ? `${prefix} ${apiKey}` : apiKey,
  };
  const tls = {
    allowSelfSigned: fw("ALLOW_SELF_SIGNED", "false") === "true",
    caPath: fw("CA_CERT_PATH", ""),
    certSha256: fw("CERT_SHA256", ""),
  };
  const paths = {
    status: fw("STATUS_PATH", "/api/system/status"),
    configuration: fw("CONFIG_PATH", "/api/system/configuration"),
    statistics: fw("STATISTICS_PATH", "/api/statistics"),
  };
  const results = await Promise.all(
    Object.entries(paths).map(async ([name, path]) => {
      try {
        await firewallRequest(
          `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`,
          headers,
          tls,
        );
        return [name, true];
      } catch {
        return [name, false];
      }
    }),
  );
  const successfulSections = results.filter(([, successful]) => successful).length;
  const failedSections = results
    .filter(([, successful]) => !successful)
    .map(([name]) => name);
  const state =
    successfulSections === 0
      ? "down"
      : failedSections.length
        ? "degraded"
        : "online";
  await recordFirewallHealth(db, profile, state, {
    successfulSections,
    failedSections,
  });
}

function startFirewallHealthMonitor(db) {
  if (
    process.env.NODE_ENV === "test" ||
    globalThis[FIREWALL_HEALTH_MONITOR_KEY]
  )
    return;
  const configuredInterval = Number(
    process.env.FIREWALL_HEALTH_INTERVAL_MS || 60_000,
  );
  const intervalMs = Number.isFinite(configuredInterval)
    ? Math.min(15 * 60_000, Math.max(30_000, configuredInterval))
    : 60_000;
  const run = () =>
    Promise.all([
      probeFirewallAvailability(db, "hq"),
      probeFirewallAvailability(db, "hq2"),
    ]).catch((error) => console.error("Firewall health monitor failed:", error));
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  globalThis[FIREWALL_HEALTH_MONITOR_KEY] = { timer, intervalMs };
  void run();
}

function sanitizeFirewallPayload(value) {
  if (Array.isArray(value)) return value.map(sanitizeFirewallPayload);
  if (!value || typeof value !== "object") return value;
  const redacted = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      /(password|passwd|secret|token|api.?key|private.?key|community)/i.test(
        key,
      )
    )
      redacted[key] = "[REDACTED]";
    else redacted[key] = sanitizeFirewallPayload(entry);
  }
  return redacted;
}

function firewallRows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.results)) return value.results;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

const firewallIpLocationCache = new Map();
const IP_LOCATION_TTL_MS = 24 * 60 * 60 * 1000;
const IP_LOCATION_FAILURE_TTL_MS = 15 * 60 * 1000;

function firewallEventSourceIp(row) {
  return String(
    row?.srcip ||
      row?.source_ip ||
      row?.sourceIp ||
      row?.src_ip ||
      row?.ip ||
      "",
  ).trim();
}

function isFailedAdministratorLogin(row) {
  const description = [
    row?.message,
    row?.msg,
    row?.logdesc,
    row?.description,
    row?.eventtype,
    row?.event_type,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    /(?:administrator|admin).{0,120}(?:login|logon).{0,120}(?:fail|invalid)/i.test(
      description,
    ) ||
    /(?:login|logon).{0,120}(?:fail|invalid).{0,120}(?:administrator|admin)/i.test(
      description,
    )
  );
}

function isPublicIpAddress(value) {
  const ip = String(value || "").trim().toLowerCase();
  if (!ip) return false;
  if (ip.includes(":")) {
    return !(
      ip === "::" ||
      ip === "::1" ||
      ip.startsWith("fc") ||
      ip.startsWith("fd") ||
      /^fe[89ab]/.test(ip) ||
      ip.startsWith("2001:db8:")
    );
  }
  const parts = ip.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  const [first, second, third] = parts;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

async function lookupFirewallIpLocation(ip) {
  const now = Date.now();
  const cached = firewallIpLocationCache.get(ip);
  if (cached && cached.expiresAt > now) return cached.value;
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload?.success) throw new Error("Location unavailable");
    const connection = payload.connection || {};
    const value = {
      city: String(payload.city || ""),
      region: String(payload.region || ""),
      country: String(payload.country || ""),
      country_code: String(payload.country_code || ""),
      latitude: Number.isFinite(Number(payload.latitude))
        ? Number(payload.latitude)
        : null,
      longitude: Number.isFinite(Number(payload.longitude))
        ? Number(payload.longitude)
        : null,
      timezone: String(payload.timezone?.id || ""),
      asn: Number(connection.asn) || null,
      organization: String(connection.org || ""),
      isp: String(connection.isp || ""),
      domain: String(connection.domain || ""),
      approximate: true,
      resolved_at: new Date(now).toISOString(),
    };
    firewallIpLocationCache.set(ip, {
      value,
      expiresAt: now + IP_LOCATION_TTL_MS,
    });
    return value;
  } catch {
    firewallIpLocationCache.set(ip, {
      value: null,
      expiresAt: now + IP_LOCATION_FAILURE_TTL_MS,
    });
    return null;
  }
}

function replaceFirewallRows(value, rows) {
  if (Array.isArray(value)) return rows;
  if (Array.isArray(value?.results)) return { ...value, results: rows };
  if (Array.isArray(value?.data)) return { ...value, data: rows };
  if (Array.isArray(value?.items)) return { ...value, items: rows };
  return value;
}

async function enrichFirewallSecurityEvents(value) {
  const rows = firewallRows(value);
  const sourceIps = [
    ...new Set(
      rows
        .filter(isFailedAdministratorLogin)
        .map(firewallEventSourceIp)
        .filter(isPublicIpAddress),
    ),
  ].slice(0, 30);
  if (!sourceIps.length) return value;
  const locations = new Map(
    await Promise.all(
      sourceIps.map(async (ip) => [ip, await lookupFirewallIpLocation(ip)]),
    ),
  );
  return replaceFirewallRows(
    value,
    rows.map((row) => {
      const sourceIp = firewallEventSourceIp(row);
      const sourceLocation = locations.get(sourceIp);
      return sourceLocation ? { ...row, source_geo: sourceLocation } : row;
    }),
  );
}

function activeDhcpLeases(payload) {
  const found = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (
          item &&
          typeof item === "object" &&
          (item.ip || item.ip_address || item.ipv4_address) &&
          (item.mac || item.mac_address || item.hwaddr)
        )
          found.push(item);
        else visit(item);
      });
    } else if (value && typeof value === "object")
      Object.values(value).forEach(visit);
  };
  visit(payload);
  const now = Date.now();
  return found
    .filter((lease) => {
      const state = String(
        lease.status || lease.state || lease.lease_state || "active",
      ).toLowerCase();
      const expiry = lease.expires_at || lease.expiry || lease.lease_end;
      const expiryTime = expiry ? new Date(expiry).getTime() : null;
      const remainingSeconds = Number(lease.expire_time);
      const fortiExpiryTime = Number.isFinite(remainingSeconds)
        ? remainingSeconds > 1_000_000_000
          ? remainingSeconds * 1000
          : now + remainingSeconds * 1000
        : null;
      return (
        !/(expired|inactive|released|offline)/.test(state) &&
        (!fortiExpiryTime || fortiExpiryTime > now) &&
        (!expiryTime || Number.isNaN(expiryTime) || expiryTime > now)
      );
    })
    .map((lease) => ({
      ...lease,
      ipv4_address: lease.ipv4_address || lease.ip_address || lease.ip,
      mac: lease.mac || lease.mac_address || lease.hwaddr,
      hostname:
        lease.hostname ||
        lease.host_name ||
        lease.client_name ||
        lease.device_name,
      detected_interface:
        lease.interface || lease.interface_name || lease.intf || lease.scope,
      status: "Online",
      lease_expires_at:
        lease.expires_at ||
        lease.expiry ||
        lease.lease_end ||
        (Number(lease.expire_time) > 0
          ? new Date(
              Number(lease.expire_time) > 1_000_000_000
                ? Number(lease.expire_time) * 1000
                : now + Number(lease.expire_time) * 1000,
            ).toISOString()
          : null),
      live_source: "dhcp",
    }));
}

function firewallRecordTime(row) {
  const raw =
    row.timestamp ||
    row.datetime ||
    row.eventtime ||
    row.time_stamp ||
    (row.date && row.time ? `${row.date} ${row.time}` : row.date);
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0)
    return new Date(
      numeric > 1e15
        ? numeric / 1e6
        : numeric > 1e12
          ? numeric
          : numeric * 1000,
    );
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function firewallArchiveDate(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function normalizedFirewallRecord(row) {
  const timestamp = firewallRecordTime(row);
  if (!timestamp) return null;
  return {
    timestamp: timestamp.toISOString(),
    source_ip: row.srcip || row.source_ip || row.ip || "",
    source_mac: row.srcmac || row.mastersrcmac || row.mac || "",
    source_name: row.srcname || row.hostname || row.asset_user_name || "",
    employee_code: row.employee_code || "",
    destination_ip: row.dstip || row.destination_ip || "",
    destination_country: row.dstcountry || row.destination_country || "",
    source_interface: Array.isArray(row.srcintf)
      ? row.srcintf.join(", ")
      : String(row.srcintf || row.interface || ""),
    destination_interface: Array.isArray(row.dstintf)
      ? row.dstintf.join(", ")
      : String(row.dstintf || ""),
    application:
      row.app || row.appname || row.application || row.service || "",
    category: row.appcat || row.category || "",
    action: row.action || row.status || "",
    severity: row.level || row.severity || row.crlevel || "",
    policy: row.policyname || row.policy || row.policyid || "",
    sent_bytes: Number(row.sentbyte || row.sent_bytes || 0),
    received_bytes: Number(row.rcvdbyte || row.received_bytes || 0),
    duration_seconds: Number(row.duration || 0),
    message: row.msg || row.message || row.event || row.logdesc || "",
  };
}

function firewallArchiveSummary(records) {
  const blocked = records.filter((row) =>
    /block|deny|drop/i.test(row.action),
  ).length;
  const threats = records.filter((row) =>
    /critical|high|emergency|alert|virus|malware|intrusion|attack/i.test(
      `${row.severity} ${row.message}`,
    ),
  ).length;
  const critical = records.filter((row) =>
    /critical|emergency|alert/i.test(`${row.severity} ${row.message}`),
  ).length;
  const summary = {
    stored_records: records.length,
    blocked,
    threats,
    critical,
    traffic_bytes: records.reduce(
      (sum, row) => sum + row.sent_bytes + row.received_bytes,
      0,
    ),
    unique_sources: new Set(
      records.map((row) => row.source_mac || row.source_ip).filter(Boolean),
    ).size,
    applications: new Set(records.map((row) => row.application).filter(Boolean))
      .size,
  };
  const escalations = [];
  if (critical)
    escalations.push({
      severity: "Critical",
      title: `${critical} critical firewall event${critical === 1 ? "" : "s"}`,
      message: "Review the archived security records and affected source systems.",
    });
  else if (threats)
    escalations.push({
      severity: "High",
      title: `${threats} high-risk event${threats === 1 ? "" : "s"}`,
      message: "Validate the threat action and confirm the source endpoint is safe.",
    });
  if (blocked >= 100)
    escalations.push({
      severity: "Medium",
      title: `${blocked} blocked sessions`,
      message: "Blocked activity is elevated for this archived day.",
    });
  return { summary, escalations };
}

function firewallRecordFingerprint(row) {
  return [
    row.timestamp,
    row.source_ip,
    row.source_mac,
    row.destination_ip,
    row.source_interface,
    row.destination_interface,
    row.application,
    row.action,
    row.sent_bytes,
    row.received_bytes,
    row.message,
  ].join("|");
}

async function recordFirewallHealth(
  db,
  profile,
  state,
  { successfulSections = 0, failedSections = [] } = {},
) {
  const now = new Date();
  const healthCollection = db.collection("firewall_health");
  const outageCollection = db.collection("firewall_outages");
  const previous = await healthCollection.findOne({ firewall_id: profile.id });
  const stateChanged = previous?.current_state !== state;
  let recoveredAt = null;

  if (state === "down") {
    try {
      await outageCollection.updateOne(
        { firewall_id: profile.id, open: true },
        {
          $set: {
            last_probe_at: now,
            successful_sections: successfulSections,
            failed_sections: failedSections,
            updated_at: now,
          },
          $setOnInsert: {
            id: uuidv4(),
            firewall_id: profile.id,
            firewall_label: profile.label,
            open: true,
            started_at: now,
            created_at: now,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      // Concurrent HQ/HQ2 comparison refreshes can race on the first failed probe.
      if (error?.code !== 11000) throw error;
      await outageCollection.updateOne(
        { firewall_id: profile.id, open: true },
        { $set: { last_probe_at: now, updated_at: now } },
      );
    }
  } else {
    const openOutage = await outageCollection.findOne({
      firewall_id: profile.id,
      open: true,
    });
    if (openOutage) {
      recoveredAt = now;
      await outageCollection.updateOne(
        { _id: openOutage._id, open: true },
        {
          $set: {
            open: false,
            ended_at: now,
            recovered_state: state,
            duration_ms: Math.max(0, now.getTime() - openOutage.started_at.getTime()),
            updated_at: now,
          },
        },
      );
    }
  }

  await healthCollection.updateOne(
    { firewall_id: profile.id },
    {
      $set: {
        firewall_id: profile.id,
        firewall_label: profile.label,
        current_state: state,
        state_since:
          stateChanged || !previous?.state_since ? now : previous.state_since,
        last_probe_at: now,
        successful_sections: successfulSections,
        failed_sections: failedSections,
        ...(state === "down" ? { last_failure_at: now } : {}),
        ...(["online", "degraded"].includes(state)
          ? { last_success_at: now }
          : {}),
        ...(recoveredAt ? { last_recovered_at: recoveredAt } : {}),
        updated_at: now,
      },
      $setOnInsert: { id: uuidv4(), created_at: now },
    },
    { upsert: true },
  );
}

async function firewallDowntimeSummary(db, profile, days) {
  const now = new Date();
  const requestedStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const health = await db
    .collection("firewall_health")
    .findOne({ firewall_id: profile.id });
  const trackedStart = health?.created_at
    ? new Date(Math.max(requestedStart.getTime(), health.created_at.getTime()))
    : null;
  const outageFilter = {
    firewall_id: profile.id,
    started_at: { $lt: now },
    $or: [{ open: true }, { ended_at: { $gt: trackedStart || requestedStart } }],
  };
  const outages = await db
    .collection("firewall_outages")
    .find(outageFilter)
    .sort({ started_at: -1 })
    .limit(1000)
    .toArray();
  const periodMs = trackedStart
    ? Math.max(0, now.getTime() - trackedStart.getTime())
    : 0;
  const totalDowntimeMs = trackedStart
    ? outages.reduce((total, outage) => {
        const startedAt = new Date(outage.started_at).getTime();
        const endedAt = outage.open || !outage.ended_at
          ? now.getTime()
          : new Date(outage.ended_at).getTime();
        const overlapStart = Math.max(startedAt, trackedStart.getTime());
        const overlapEnd = Math.min(endedAt, now.getTime());
        return total + Math.max(0, overlapEnd - overlapStart);
      }, 0)
    : 0;
  const currentOutage = outages.find((outage) => outage.open) || null;
  const lastCompletedOutage =
    outages.find((outage) => !outage.open && outage.ended_at) || null;
  const availabilityPercent = periodMs
    ? Math.max(0, ((periodMs - totalDowntimeMs) / periodMs) * 100)
    : null;

  return {
    firewall: { id: profile.id, label: profile.label },
    current: health
      ? {
          state: health.current_state,
          state_since: health.state_since,
          last_probe_at: health.last_probe_at,
          successful_sections: health.successful_sections || 0,
          failed_sections: health.failed_sections || [],
        }
      : {
          state: "unknown",
          state_since: null,
          last_probe_at: null,
          successful_sections: 0,
          failed_sections: [],
        },
    period: {
      requested_days: days,
      requested_start: requestedStart,
      tracked_start: trackedStart,
      end: now,
      tracked_ms: periodMs,
    },
    summary: {
      availability_percent:
        availabilityPercent === null ? null : Number(availabilityPercent.toFixed(3)),
      total_downtime_ms: totalDowntimeMs,
      outage_count: outages.length,
    },
    current_outage: currentOutage
      ? {
          id: currentOutage.id,
          started_at: currentOutage.started_at,
          duration_ms: Math.max(
            0,
            now.getTime() - new Date(currentOutage.started_at).getTime(),
          ),
        }
      : null,
    last_outage: lastCompletedOutage
      ? {
          id: lastCompletedOutage.id,
          started_at: lastCompletedOutage.started_at,
          ended_at: lastCompletedOutage.ended_at,
          duration_ms:
            lastCompletedOutage.duration_ms ||
            Math.max(
              0,
              new Date(lastCompletedOutage.ended_at).getTime() -
                new Date(lastCompletedOutage.started_at).getTime(),
            ),
        }
      : null,
    recent_outages: outages.slice(0, 10).map((outage) => ({
      id: outage.id,
      open: outage.open,
      started_at: outage.started_at,
      ended_at: outage.ended_at || null,
      duration_ms: outage.open
        ? Math.max(0, now.getTime() - new Date(outage.started_at).getTime())
        : outage.duration_ms || 0,
    })),
  };
}

async function archiveFirewallRecords(db, profile, firewallName, records, capturedAt) {
  const normalized = records.map(normalizedFirewallRecord).filter(Boolean);
  const groups = new Map();
  for (const record of normalized) {
    const date = firewallArchiveDate(record.timestamp);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(record);
  }
  const capturedDate = firewallArchiveDate(capturedAt);
  if (!groups.size) groups.set(capturedDate, []);
  for (const [date, dayRecords] of groups) {
    const existing = await db
      .collection("firewall_daily_archives")
      .findOne({ firewall_id: profile.id, date });
    const merged = new Map();
    for (const record of [...(existing?.records || []), ...dayRecords])
      merged.set(firewallRecordFingerprint(record), record);
    const stored = [...merged.values()]
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
      .slice(0, 2500);
    const { summary, escalations } = firewallArchiveSummary(stored);
    const escalationSignature = escalations.map((item) => item.title).join("|");
    const shouldNotify =
      date === capturedDate &&
      capturedDate === firewallArchiveDate(new Date()) &&
      Boolean(escalationSignature) &&
      escalationSignature !== existing?.escalation_signature;
    await db.collection("firewall_daily_archives").updateOne(
      { firewall_id: profile.id, date },
      {
        $set: {
          firewall_id: profile.id,
          firewall_label: profile.label,
          firewall_name: firewallName,
          date,
          timezone: "Asia/Kolkata",
          summary,
          escalations,
          escalation_count: escalations.length,
          escalation_signature: escalationSignature,
          ...(shouldNotify ? { escalation_notified_at: new Date() } : {}),
          records: stored,
          latest_record_at: stored[0]?.timestamp || null,
          captured_at: new Date(capturedAt),
          updated_at: new Date(),
        },
        $setOnInsert: { id: uuidv4(), created_at: new Date() },
      },
      { upsert: true },
    );
    if (shouldNotify) {
      const recipients = await db
        .collection("users")
        .find({
          role: { $in: ["it", "admin", "super_admin"] },
          active: { $ne: false },
        })
        .toArray();
      await notify(
        db,
        recipients.map((user) => user.id),
        `${profile.label} firewall escalation for ${date}: ${escalations.map((item) => item.title).join("; ")}`,
        null,
      );
    }
  }
  return { dates_archived: groups.size, records_observed: normalized.length };
}

let firewallInventoryCache;
function parseCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      field += '"';
      index++;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const normalizeMac = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "");
function firewallInventory() {
  if (firewallInventoryCache) return firewallInventoryCache;
  const files = [
    {
      source: "asset_inventory",
      path:
        process.env.FIREWALL_ASSET_INVENTORY_PATH ||
        "/Users/macbookpro/Downloads/IT Asset Inventory.xlsx - Sheet1.csv",
    },
    {
      source: "av_status",
      path:
        process.env.FIREWALL_AV_STATUS_PATH ||
        "/Users/macbookpro/Downloads/AV Status and Mac Address_273.xlsx - Sheet1.csv",
    },
  ];
  const index = new Map(),
    errors = [];
  for (const file of files) {
    try {
      const rows = parseCsv(readFileSync(file.path, "utf8"));
      const headers = (rows.shift() || []).map((header) =>
        header
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_"),
      );
      rows.forEach((values) => {
        const record = Object.fromEntries(
          headers.map((header, column) => [
            header,
            String(values[column] || "").trim(),
          ]),
        );
        const mac = normalizeMac(record.mac_address);
        if (!mac || mac.length !== 12) return;
        const current = index.get(mac) || { matches: [], sources: new Set() };
        current.matches.push({
          source: file.source,
          name: record.name || "",
          employee_code: record.emp_code || record.emp_code_ || "",
          email: record.ethara_email_id || "",
          av_status: record.av_status || "",
          serial_number: record.serial_number || "",
          os_version: record.os_version || "",
          brand: record.brand || "",
        });
        current.sources.add(file.source);
        index.set(mac, current);
      });
    } catch (error) {
      errors.push(`${file.source}: ${error.message}`);
    }
  }
  firewallInventoryCache = { index, errors };
  return firewallInventoryCache;
}

function mapFirewallInventory(devices) {
  const inventory = firewallInventory();
  const mapped = devices.map((device) => {
    const mac = normalizeMac(
      device.mac || device.master_mac || device.srcmac || device.mastersrcmac,
    );
    const entry = inventory.index.get(mac);
    if (!entry)
      return {
        ...device,
        inventory_status: "Unmapped",
        inventory_match: false,
        av_status: "Unknown",
      };
    const assets = entry.matches.filter((match) => match.source === "asset_inventory");
    const avRows = entry.matches.filter((match) => match.source === "av_status");
    const normalized = (value) => String(value || "").trim().toLowerCase();
    const matchScore = (asset, av) => {
      let score = 0;
      if (asset.serial_number && normalized(asset.serial_number) === normalized(av.serial_number)) score += 100;
      if (asset.email && normalized(asset.email) === normalized(av.email)) score += 80;
      if (/^gr/i.test(asset.employee_code || "") && normalized(asset.employee_code) === normalized(av.employee_code)) score += 40;
      return score;
    };
    let preferred = null;
    let mappingBasis = "";
    if (assets.length === 1) {
      preferred = assets[0];
      mappingBasis = "unique asset inventory MAC";
    } else if (assets.length > 1) {
      const ranked = assets
        .map((asset) => ({
          asset,
          score: Math.max(0, ...avRows.map((av) => matchScore(asset, av))),
        }))
        .sort((a, b) => b.score - a.score);
      if (ranked[0].score > 0 && ranked[0].score > (ranked[1]?.score || 0)) {
        preferred = ranked[0].asset;
        mappingBasis = "asset inventory matched to AV serial/email/code";
      } else {
        const installed = assets.filter((asset) => /installed|active|protected|running/i.test(asset.av_status));
        if (installed.length === 1) {
          preferred = installed[0];
          mappingBasis = "only active/installed asset record for duplicate MAC";
        }
      }
    } else if (avRows.length === 1) {
      preferred = avRows[0];
      mappingBasis = "unique AV inventory MAC (asset record unavailable)";
    }
    if (!preferred) {
      return {
        ...device,
        inventory_status: "Ambiguous",
        inventory_match: false,
        inventory_conflict: true,
        av_status: "Needs review",
        inventory_sources: [...entry.sources],
        inventory_matches: entry.matches.length,
        inventory_candidates: assets.map((candidate) => ({
          name: candidate.name,
          employee_code: candidate.employee_code,
          email: candidate.email,
          serial_number: candidate.serial_number,
          av_status: candidate.av_status,
        })),
      };
    }
    const matchingAv = avRows
      .map((av) => ({ av, score: matchScore(preferred, av) }))
      .sort((a, b) => b.score - a.score)[0];
    const av = matchingAv?.score > 0 ? matchingAv.av : null;
    return {
      ...device,
      inventory_status: "Mapped",
      inventory_match: true,
      asset_user_name: preferred.name,
      employee_code: preferred.employee_code,
      asset_email: preferred.email,
      av_status: av?.av_status || preferred.av_status || "Not recorded",
      asset_serial_number: preferred.serial_number,
      asset_os_version: preferred.os_version,
      asset_brand: preferred.brand,
      inventory_sources: [...entry.sources],
      inventory_matches: entry.matches.length,
      inventory_conflict: false,
      inventory_mapping_basis: mappingBasis,
    };
  });
  return {
    devices: mapped,
    summary: {
      mapped: mapped.filter((device) => device.inventory_match).length,
      unmapped: mapped.filter((device) => !device.inventory_match && !device.inventory_conflict).length,
      ambiguous: mapped.filter((device) => device.inventory_conflict).length,
      inventory_macs: inventory.index.size,
      errors: inventory.errors,
    },
  };
}

function enrichFirewallDevices(devicesPayload, logsPayload) {
  const devices = firewallRows(devicesPayload);
  const logs = firewallRows(logsPayload);
  if (!devices.length || !logs.length) return devicesPayload;
  const observations = new Map();
  logs.forEach((row) => {
    const identifiers = [row.srcip, row.source_ip, row.srcmac, row.mastersrcmac]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    identifiers.forEach((identifier) => {
      const current = observations.get(identifier) || {
        applications: new Set(),
        traffic_bytes: 0,
      };
      const application =
        row.app || row.appname || row.application || row.service;
      if (application) current.applications.add(String(application));
      current.traffic_bytes +=
        Number(row.sentbyte || row.sent_bytes || 0) +
        Number(row.rcvdbyte || row.received_bytes || 0);
      current.hostname ||= row.srcname || row.hostname || row.devname;
      current.device_type ||= row.srcdevtype || row.devtype || row.device_type;
      current.os_name ||= row.srcosname || row.osname || row.os_name;
      current.os_version ||=
        row.srcswversion || row.osversion || row.os_version;
      current.vendor ||= row.srchwvendor || row.vendor || row.manufacturer;
      current.interface ||= row.srcintf || row.interface;
      current.last_seen ||= [row.date, row.time || row.timestamp]
        .filter(Boolean)
        .join(" ");
      observations.set(identifier, current);
    });
  });
  const enriched = devices.map((device) => {
    const keys = [device.ipv4_address, device.ip, device.mac, device.master_mac]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    const detail = keys.map((key) => observations.get(key)).find(Boolean);
    if (!detail) return device;
    return {
      ...device,
      hostname: device.hostname || detail.hostname,
      device_type: device.device_type || detail.device_type,
      os_name: device.os_name || detail.os_name,
      os_version: device.os_version || detail.os_version,
      hardware_vendor: device.hardware_vendor || device.vendor || detail.vendor,
      detected_interface: device.detected_interface || detail.interface,
      observed_applications: [...detail.applications].sort(),
      observed_traffic_bytes: detail.traffic_bytes,
      traffic_last_seen: detail.last_seen,
      identification_source: "device discovery + traffic logs",
    };
  });
  if (Array.isArray(devicesPayload)) return enriched;
  if (Array.isArray(devicesPayload?.results))
    return { ...devicesPayload, results: enriched };
  if (Array.isArray(devicesPayload?.data))
    return { ...devicesPayload, data: enriched };
  if (Array.isArray(devicesPayload?.items))
    return { ...devicesPayload, items: enriched };
  return devicesPayload;
}

function clean(doc) {
  if (!doc) return doc;
  if (Array.isArray(doc)) return doc.map(clean);
  const { _id, password_hash, ...rest } = doc;
  return rest;
}

function textValue(value, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const ATTACHMENT_TYPES = Object.freeze({
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const attachmentUploadUsage = new Map();

function attachmentRateLimited(userId, files) {
  const now = Date.now();
  const recent = (attachmentUploadUsage.get(userId) || []).filter(
    (entry) => now - entry.at < 60 * 60_000,
  );
  const requestedBytes = files.reduce(
    (sum, file) => sum + Number(file.size || 0),
    0,
  );
  if (
    recent.reduce((sum, entry) => sum + entry.files, 0) + files.length > 30 ||
    recent.reduce((sum, entry) => sum + entry.bytes, 0) + requestedBytes >
      100 * 1024 * 1024
  )
    return true;
  recent.push({ at: now, files: files.length, bytes: requestedBytes });
  attachmentUploadUsage.set(userId, recent);
  return false;
}

function requestError(message, status = 400) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

function safeAttachmentName(value) {
  return String(value || "attachment")
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._ ()-]/g, "_")
    .slice(0, 140) || "attachment";
}

function attachmentExtension(name) {
  const match = String(name).toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] || "";
}

function hasValidFileSignature(extension, bytes) {
  if (extension === ".pdf") return bytes.subarray(0, 5).toString() === "%PDF-";
  if ([".jpg", ".jpeg"].includes(extension))
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === ".png")
    return bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  if (extension === ".docx")
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (extension === ".doc")
    return bytes.subarray(0, 8).equals(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    );
  return false;
}

function attachmentSummary(attachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    content_type: attachment.content_type,
    size: attachment.size,
    uploaded_by_name: attachment.owner_name,
    created_at: attachment.created_at,
    url: `/api/attachments/${attachment.id}`,
  };
}

async function uploadAttachment(db, file, session) {
  const name = safeAttachmentName(file.name);
  const extension = attachmentExtension(name);
  const contentType = ATTACHMENT_TYPES[extension];
  if (!contentType)
    throw requestError(
      `${name}: only PDF, JPEG, PNG, DOC and DOCX files are allowed`,
      415,
    );
  if (!file.size || file.size > MAX_ATTACHMENT_BYTES)
    throw requestError(`${name}: each file must be 5 MB or smaller`, 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size || !hasValidFileSignature(extension, bytes))
    throw requestError(`${name}: file content does not match its extension`, 415);
  const id = uuidv4();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await db.storeBlob(id, bytes, sha256);
  const attachment = {
    id,
    blob_storage: "postgresql",
    name,
    content_type: contentType,
    size: bytes.length,
    sha256,
    owner_id: session.id,
    owner_name: session.name,
    linked_entity: null,
    entity_id: null,
    ticket_id: null,
    created_at: new Date(),
  };
  try {
    await db.collection("attachments").insertOne(attachment);
  } catch (error) {
    await db.deleteBlob(id);
    throw error;
  }
  return attachment;
}

async function ownedPendingAttachments(db, values, session) {
  const ids = [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length > MAX_ATTACHMENTS)
    throw requestError(`A maximum of ${MAX_ATTACHMENTS} files is allowed`);
  if (!ids.length) return [];
  const attachments = await db
    .collection("attachments")
    .find({
      id: { $in: ids },
      owner_id: session.id,
      linked_entity: null,
    })
    .toArray();
  if (attachments.length !== ids.length)
    throw requestError(
      "One or more attachments are missing, already linked, or owned by another user",
      403,
    );
  const total = attachments.reduce((sum, item) => sum + Number(item.size || 0), 0);
  if (total > MAX_ATTACHMENT_TOTAL_BYTES)
    throw requestError("Combined attachment size must not exceed 25 MB", 413);
  return ids.map((id) => attachments.find((item) => item.id === id));
}

async function linkAttachments(db, attachments, entity, entityId, ticketId) {
  if (!attachments.length) return [];
  const linkedAt = new Date();
  await db.collection("attachments").updateMany(
    { id: { $in: attachments.map((item) => item.id) }, linked_entity: null },
    {
      $set: {
        linked_entity: entity,
        entity_id: entityId,
        ticket_id: ticketId,
        linked_at: linkedAt,
      },
    },
  );
  return attachments.map(attachmentSummary);
}

async function getSession(request) {
  try {
    const token = request.cookies.get("tf_token")?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, jwtSecret());
    return payload;
  } catch (e) {
    return null;
  }
}

function pad(n) {
  return String(n).padStart(6, "0");
}
function ddmmyy(d = new Date()) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}${mm}${yy}`;
}
async function nextSeq(db, key) {
  const r = await db
    .collection("counters")
    .findOneAndUpdate(
      { _id: key },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );
  return r.value ? r.value.seq : r.seq || 1;
}
async function humanId(db, prefix, location) {
  const seq = await nextSeq(db, `${prefix}-${location || ""}-${ddmmyy()}`);
  if (location) return `${prefix}-${location}-${ddmmyy()}-${pad(seq)}`;
  return `${prefix}-${ddmmyy()}-${pad(seq)}`;
}

async function audit(db, actor, action, entity, entityId, details = {}) {
  await db.collection("audit_logs").insertOne({
    id: uuidv4(),
    actor_id: actor?.id || "system",
    actor_name: actor?.name || "system",
    actor_role: actor?.role || "system",
    action,
    entity,
    entity_id: entityId,
    details,
    created_at: new Date(),
  });
}
async function notify(db, userIds, message, ticket) {
  const ids = [
    ...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean)),
  ];
  const docs = ids.filter(Boolean).map((uid) => ({
    id: uuidv4(),
    user_id: uid,
    message,
    ticket_id: ticket?.id || null,
    ticket_human_id: ticket?.human_id || null,
    read: false,
    created_at: new Date(),
  }));
  if (docs.length) await db.collection("notifications").insertMany(docs);
}

async function queueEmail(db, recipients, subject, message, dedupePrefix) {
  const users = recipients.filter((user) => user?.email);
  if (!users.length) return 0;
  const now = new Date();
  const writes = users.map((user) => ({
    updateOne: {
      filter: { dedupe_key: `${dedupePrefix}:${user.id || user.email}` },
      update: {
        $setOnInsert: {
          id: uuidv4(),
          dedupe_key: `${dedupePrefix}:${user.id || user.email}`,
          to: user.email,
          user_id: user.id || null,
          subject,
          message,
          status: "pending",
          attempts: 0,
          next_attempt_at: now,
          created_at: now,
          updated_at: now,
        },
      },
      upsert: true,
    },
  }));
  const result = await db.collection("email_outbox").bulkWrite(writes, {
    ordered: false,
  });
  return result.upsertedCount || 0;
}

async function deliverQueuedEmails(db, limit = 10) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!apiKey || !from)
    return {
      configured: false,
      delivered: 0,
      pending: await db
        .collection("email_outbox")
        .countDocuments({ status: { $in: ["pending", "retry"] } }),
    };

  const now = new Date();
  const queued = await db
    .collection("email_outbox")
    .find({
      status: { $in: ["pending", "retry"] },
      next_attempt_at: { $lte: now },
      attempts: { $lt: 5 },
    })
    .sort({ created_at: 1 })
    .limit(limit)
    .toArray();
  let delivered = 0;
  for (const email of queued) {
    const claimed = await db.collection("email_outbox").updateOne(
      { id: email.id, status: { $in: ["pending", "retry"] } },
      { $set: { status: "sending", updated_at: new Date() } },
    );
    if (!claimed.modifiedCount) continue;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email.to],
          subject: email.subject,
          text: email.message,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(`Email provider returned HTTP ${response.status}`);
      await db.collection("email_outbox").updateOne(
        { id: email.id },
        {
          $set: {
            status: "sent",
            sent_at: new Date(),
            updated_at: new Date(),
          },
          $unset: { last_error: "" },
        },
      );
      delivered++;
    } catch (error) {
      const attempts = Number(email.attempts || 0) + 1;
      const delayMinutes = Math.min(60, 2 ** attempts);
      await db.collection("email_outbox").updateOne(
        { id: email.id },
        {
          $set: {
            status: attempts >= 5 ? "failed" : "retry",
            attempts,
            last_error: String(error?.message || "Delivery failed").slice(
              0,
              300,
            ),
            next_attempt_at: new Date(Date.now() + delayMinutes * 60_000),
            updated_at: new Date(),
          },
        },
      );
    }
  }
  return { configured: true, delivered, processed: queued.length };
}

async function createEmailVerification(db, user, appOrigin) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
  await db.collection("email_verifications").deleteMany({
    user_id: user.id,
    consumed_at: null,
  });
  await db.collection("email_verifications").insertOne({
    id: uuidv4(),
    user_id: user.id,
    token_hash: tokenHash,
    consumed_at: null,
    created_at: now,
    expires_at: expiresAt,
  });
  const verifyUrl = `${appOrigin}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await queueEmail(
    db,
    [user],
    "Verify your Ethara Service Hub email",
    `Hello ${user.name},\n\nVerify your email address within 24 hours:\n${verifyUrl}\n\nIf you did not create this account, ignore this email.`,
    `email-verification:${user.id}:${expiresAt.getTime()}`,
  );
  await deliverQueuedEmails(db, 1);
}

async function slaEscalationRecipients(db, ticket) {
  const teamRole = ticket.department === "Admin" ? "admin" : "it";
  const users = await db
    .collection("users")
    .find({
      active: { $ne: false },
      $or: [{ role: "super_admin" }, { role: teamRole }],
    })
    .toArray();
  const scopedUsers = users.filter(
    (user) =>
      user.role === "super_admin" ||
      canAccessTicket(
        {
          ...user,
          is_team_head: Boolean(user.is_team_head),
          managed_locations: user.managed_locations || [],
        },
        ticket,
      ),
  );
  if (
    ticket.assignee_id &&
    !scopedUsers.some((user) => user.id === ticket.assignee_id)
  ) {
    const assignee = await db
      .collection("users")
      .findOne({ id: ticket.assignee_id, active: { $ne: false } });
    if (assignee) scopedUsers.push(assignee);
  }
  return scopedUsers;
}

async function recordSlaBreach(db, ticket, kind, at) {
  const field =
    kind === "response"
      ? "response_sla_breached_at"
      : "resolution_sla_breached_at";
  const update = await db.collection("tickets").updateOne(
    { id: ticket.id, [field]: { $exists: false } },
    {
      $set: {
        [field]: at,
        [`sla_breaches.${kind}`]: true,
        [`sla_breach_notifications.${kind}_sent_at`]: at,
        updated_at: at,
      },
    },
  );
  if (!update.modifiedCount) return false;

  const recipients = await slaEscalationRecipients(db, ticket);
  const label = kind === "response" ? "response" : "resolution";
  const message = `SLA breach: ${ticket.human_id} missed its ${label} deadline (${ticket.title})`;
  await notify(
    db,
    recipients.map((user) => user.id),
    message,
    ticket,
  );
  await queueEmail(
    db,
    recipients,
    `[TicketFlow] ${ticket.human_id} ${label} SLA breached`,
    `${message}\n\nDepartment: ${ticket.department}\nPriority: ${ticket.priority}\nRequester: ${ticket.issue_user_name || ticket.raised_for_name || ticket.raised_by_name || "Unknown"}\nAssignee: ${ticket.assignee_name || "Unassigned"}`,
    `sla:${ticket.id}:${kind}`,
  );
  await audit(db, null, `ticket.sla.${kind}.breached`, "ticket", ticket.id, {
    human_id: ticket.human_id,
    due_at:
      kind === "response"
        ? ticket.sla_response_due
        : ticket.sla_resolution_due,
  });
  return true;
}

let lastSlaSweepAt = 0;
let slaSweepPromise;
let slaMonitorTimer;
function startSlaMonitor(database) {
  if (process.env.NODE_ENV !== "production" || slaMonitorTimer) return;
  slaMonitorTimer = setInterval(() => {
    processSlaBreaches(database, true).catch((error) =>
      console.error("Scheduled SLA sweep failed:", error),
    );
  }, 5 * 60_000);
  slaMonitorTimer.unref?.();
}
async function processSlaBreaches(db, force = false) {
  const currentMillis = Date.now();
  if (!force && currentMillis - lastSlaSweepAt < 60_000)
    return { skipped: true, reason: "throttled" };
  if (slaSweepPromise) return slaSweepPromise;
  lastSlaSweepAt = currentMillis;
  slaSweepPromise = (async () => {
    const now = new Date();
    if (!isBusinessTime(now))
      return {
        deferred: true,
        reason: "outside_business_hours",
        next_processing_at: nextBusinessTime(now),
      };
    let responseBreaches = 0;
    let resolutionBreaches = 0;
    const responseCandidates = await db
      .collection("tickets")
      .find({
        status: { $ne: "Cancelled" },
        sla_response_due: { $lt: now },
        response_sla_breached_at: { $exists: false },
        response_sla_met_at: { $exists: false },
      })
      .limit(500)
      .toArray();
    for (const ticket of responseCandidates) {
      const respondedAt = ticket.acknowledged_at || ticket.first_response_at;
      if (respondedAt && new Date(respondedAt) <= new Date(ticket.sla_response_due)) {
        await db.collection("tickets").updateOne(
          { id: ticket.id, response_sla_met_at: { $exists: false } },
          { $set: { response_sla_met_at: new Date(respondedAt) } },
        );
      } else if (await recordSlaBreach(db, ticket, "response", now)) {
        responseBreaches++;
      }
    }

    const resolutionCandidates = await db
      .collection("tickets")
      .find({
        status: { $ne: "Cancelled" },
        sla_resolution_due: { $lt: now },
        resolution_sla_breached_at: { $exists: false },
        resolution_sla_met_at: { $exists: false },
      })
      .limit(500)
      .toArray();
    for (const ticket of resolutionCandidates) {
      const resolvedAt =
        ticket.resolved_at || ticket.resolution?.resolved_date || ticket.closed_at;
      if (resolvedAt && new Date(resolvedAt) <= new Date(ticket.sla_resolution_due)) {
        await db.collection("tickets").updateOne(
          { id: ticket.id, resolution_sla_met_at: { $exists: false } },
          { $set: { resolution_sla_met_at: new Date(resolvedAt) } },
        );
      } else if (await recordSlaBreach(db, ticket, "resolution", now)) {
        resolutionBreaches++;
      }
    }
    const email = await deliverQueuedEmails(db);
    return { response_breaches: responseBreaches, resolution_breaches: resolutionBreaches, email };
  })();
  try {
    return await slaSweepPromise;
  } finally {
    slaSweepPromise = null;
  }
}
async function addHistory(db, ticketId, type, actor, note, from, to) {
  await db.collection("history").insertOne({
    id: uuidv4(),
    ticket_id: ticketId,
    type,
    from: from ?? null,
    to: to ?? null,
    by_id: actor?.id,
    by_name: actor?.name,
    by_role: actor?.role,
    note: note || "",
    created_at: new Date(),
  });
}

const STATUSES = [
  "Open",
  "Assigned",
  "Acknowledged",
  "Approval Preparation",
  "Pending Super Admin Approval",
  "Clarification Required",
  "Approval On Hold",
  "Approval Rejected",
  "Approved - Ready for Action",
  "In Progress",
  "Pending User Response",
  "Pending Vendor",
  "Pending Finance",
  "Pending Material",
  "On Hold",
  "Resolved",
  "Closed",
  "Cancelled",
];
const TERMINAL_TICKET_STATUSES = ["Resolved", "Closed", "Cancelled"];

const DESIGNATED_IT_MANAGERS = Object.freeze({
  "hukum@ethara.ai": "Lotus",
  "virendra.shukla@ethara.ai": "Tulip",
});

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function ticketLocationSite(value) {
  const location = String(value || "").trim();
  if (/\blotus\b/i.test(location)) return "Lotus";
  if (/\btulip\b/i.test(location)) return "Tulip";
  return null;
}

function designatedManagerSite(email) {
  return DESIGNATED_IT_MANAGERS[normalizedEmail(email)] || null;
}

function managedItSites(user) {
  const designatedSite = designatedManagerSite(user?.email);
  if (designatedSite) return [designatedSite];
  const configuredSites = Array.isArray(user?.managed_locations)
    ? user.managed_locations.map(ticketLocationSite).filter(Boolean)
    : [];
  if (configuredSites.length) return [...new Set(configuredSites)];
  const ownSite = ticketLocationSite(user?.location);
  return ownSite ? [ownSite] : [];
}

function ticketSite(ticket) {
  return ticketLocationSite(ticket?.routing_site || ticket?.location);
}

function siteTicketFilter(site) {
  return {
    $or: [
      { routing_site: site },
      { location: { $regex: `\\b${site}\\b`, $options: "i" } },
    ],
  };
}

function itTicketScope(session) {
  const sites = session?.is_team_head
    ? managedItSites(session)
    : [ticketLocationSite(session?.location)].filter(Boolean);
  if (!sites.length) return { department: "IT" };
  return {
    $and: [
      { department: "IT" },
      {
        $or: [
          { assignee_id: session.id },
          ...sites.map((site) => siteTicketFilter(site)),
        ],
      },
    ],
  };
}

function canAccessTicket(session, ticket) {
  if (session.role === "super_admin") return true;
  if (session.role === "employee")
    return (
      ticket.raised_by_id === session.id || ticket.issue_user_id === session.id
    );
  if (session.role === "admin") return ticket.department === "Admin";
  if (session.role !== "it" || ticket.department !== "IT") return false;
  if (ticket.assignee_id === session.id) return true;
  const site = ticketSite(ticket);
  if (!site) return true;
  const allowedSites = session.is_team_head
    ? managedItSites(session)
    : [ticketLocationSite(session.location)].filter(Boolean);
  return allowedSites.includes(site);
}

function isTicketTeamHead(user, ticket) {
  if (user?.role === "super_admin") return true;
  if (!user?.is_team_head) return false;
  const teamRole = ticket.department === "Admin" ? "admin" : "it";
  if (user.role !== teamRole) return false;
  if (teamRole === "admin") return true;
  const site = ticketSite(ticket);
  if (!site) return true;
  return managedItSites(user).includes(site);
}

async function ensureDesignatedItManagers(database) {
  await Promise.all(
    Object.entries(DESIGNATED_IT_MANAGERS).map(([email, site]) =>
      database.collection("users").updateOne(
        { email },
        {
          $set: {
            role: "it",
            department: "IT",
            is_team_head: true,
            managed_locations: [site],
            updated_at: new Date(),
          },
        },
      ),
    ),
  );
}

async function ensureTicketRoutingData(database) {
  const tickets = database.collection("tickets");
  await Promise.all([
    tickets.updateMany(
      { routing_site: { $exists: false }, location: { $regex: "\\blotus\\b", $options: "i" } },
      { $set: { routing_site: "Lotus" } },
    ),
    tickets.updateMany(
      { routing_site: { $exists: false }, location: { $regex: "\\btulip\\b", $options: "i" } },
      { $set: { routing_site: "Tulip" } },
    ),
    tickets.updateMany(
      { assignee_id: null },
      { $set: { allocation_status: "unallocated", queue_state: "pending" } },
    ),
    tickets.updateMany(
      { assignee_id: { $ne: null } },
      { $set: { allocation_status: "allocated", queue_state: "assigned" } },
    ),
  ]);
  await Promise.all(
    ["IT", "Admin"].flatMap((department) =>
      ["Lotus", "Tulip"].map((site) =>
        tickets.updateMany(
          { department, routing_site: site },
          { $set: { routed_team: `${department}:${site}` } },
        ),
      ),
    ),
  );
}

// role-based ticket filter
function scopeFilter(session) {
  if (session.role === "super_admin") return {};
  if (session.role === "it") return itTicketScope(session);
  if (session.role === "admin") return { department: "Admin" };
  // Employees can see tickets they raised and tickets explicitly raised for them.
  return { $or: [{ raised_by_id: session.id }, { issue_user_id: session.id }] };
}

const requesterId = (ticket) => ticket.issue_user_id || ticket.raised_by_id;

function lifecycleStatusKey(status) {
  return String(status || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// One-time, additive migration for tickets created before business-hours SLA
// and explicit lifecycle fields were introduced. Batching avoids loading the
// complete ticket/history collections into memory on larger installations.
async function migrateTicketSlaData(database) {
  const users = await database.collection("users").find({}).toArray();
  const userById = new Map(users.map((user) => [user.id, user]));
  const userByEmail = new Map(
    users.filter((user) => user.email).map((user) => [user.email.toLowerCase(), user]),
  );
  const userByEmployeeId = new Map(
    users
      .filter((user) => user.employee_id)
      .map((user) => [String(user.employee_id).toLowerCase(), user]),
  );
  const userByName = new Map(
    users.filter((user) => user.name).map((user) => [user.name.toLowerCase(), user]),
  );

  while (true) {
    const tickets = await database
      .collection("tickets")
      .find({ sla_schema_version: { $ne: 1 } })
      .limit(250)
      .toArray();
    if (!tickets.length) break;
    const histories = await database
      .collection("history")
      .find({ ticket_id: { $in: tickets.map((ticket) => ticket.id) } })
      .sort({ created_at: 1 })
      .toArray();
    const historyByTicket = new Map();
    for (const event of histories) {
      if (!historyByTicket.has(event.ticket_id))
        historyByTicket.set(event.ticket_id, []);
      historyByTicket.get(event.ticket_id).push(event);
    }

    const writes = tickets.map((ticket) => {
      const raisedAt = new Date(ticket.raised_at || ticket.created_at || Date.now());
      const sla = slaDates(ticket.department, ticket.priority, raisedAt);
      const events = historyByTicket.get(ticket.id) || [];
      const assignment = events.find(
        (event) => event.type === "assignment" && event.to,
      );
      const statusEvent = (status) =>
        events.find(
          (event) =>
            event.type === "status" &&
            String(event.to).toLowerCase() === status.toLowerCase(),
        );
      const acknowledgedEvent = statusEvent("Acknowledged");
      const workEvent = statusEvent("In Progress");
      const resolvedEvent = statusEvent("Resolved");
      const closedEvent = statusEvent("Closed");
      const reopenedEvent = statusEvent("Reopened");
      const assignedAt =
        ticket.assigned_at ||
        assignment?.created_at ||
        (ticket.assignee_id
          ? ticket.first_response_at || ticket.created_at
          : null);
      const acknowledgedAt =
        ticket.acknowledged_at ||
        ticket.first_response_at ||
        acknowledgedEvent?.created_at ||
        (ticket.assignee_id ? assignedAt : null);
      const workStartedAt = ticket.work_started_at || workEvent?.created_at || null;
      const resolvedAt =
        ticket.resolved_at ||
        ticket.resolution?.resolved_date ||
        resolvedEvent?.created_at ||
        null;
      const closedAt =
        ticket.closed_at ||
        (ticket.confirmation?.confirmed ? ticket.confirmation.at : null) ||
        closedEvent?.created_at ||
        null;
      const statusTimestamps = { ...(ticket.status_timestamps || {}), raised: raisedAt };
      if (assignedAt) statusTimestamps.assigned = new Date(assignedAt);
      if (acknowledgedAt) statusTimestamps.acknowledged = new Date(acknowledgedAt);
      if (workStartedAt) statusTimestamps.in_progress = new Date(workStartedAt);
      if (resolvedAt) statusTimestamps.resolved = new Date(resolvedAt);
      if (closedAt) statusTimestamps.closed = new Date(closedAt);
      if (reopenedEvent)
        statusTimestamps.reopened = new Date(
          ticket.reopened_at || reopenedEvent.created_at,
        );
      for (const event of events.filter((item) => item.type === "status")) {
        const key = lifecycleStatusKey(event.to);
        if (key && !statusTimestamps[key])
          statusTimestamps[key] = new Date(event.created_at);
      }

      const issueName =
        ticket.issue_user_name ||
        ticket.raised_for_name ||
        ticket.raised_by_name ||
        "Unknown user";
      const raisedUser = userById.get(ticket.raised_by_id);
      const matchedIssueUser =
        (ticket.issue_user_id && userById.get(ticket.issue_user_id)) ||
        userByEmail.get(String(ticket.issue_user_email || ticket.email || "").toLowerCase()) ||
        userByEmployeeId.get(
          String(
            ticket.issue_user_employee_code || ticket.employee_id || "",
          ).toLowerCase(),
        ) ||
        userByName.get(issueName.toLowerCase()) ||
        (raisedUser &&
        (!ticket.raised_for_name ||
          raisedUser.name.toLowerCase() === ticket.raised_for_name.toLowerCase())
          ? raisedUser
          : null);
      const set = {
        sla_schema_version: 1,
        raised_at: raisedAt,
        ...sla,
        issue_user_id: matchedIssueUser?.id || ticket.issue_user_id || null,
        issue_user_name: matchedIssueUser?.name || issueName,
        issue_user_email:
          matchedIssueUser?.email || ticket.issue_user_email || ticket.email || "",
        issue_user_employee_code:
          matchedIssueUser?.employee_id ||
          ticket.issue_user_employee_code ||
          ticket.employee_id ||
          "",
        status_timestamps: statusTimestamps,
      };
      if (assignedAt) {
        set.assigned_at = new Date(assignedAt);
        set.last_assigned_at = new Date(ticket.last_assigned_at || assignedAt);
        set.assigned_by_id = ticket.assigned_by_id || assignment?.by_id || null;
        set.assigned_by_name =
          ticket.assigned_by_name || assignment?.by_name || "System";
      }
      if (acknowledgedAt) {
        set.acknowledged_at = new Date(acknowledgedAt);
        set.acknowledged_by_id =
          ticket.acknowledged_by_id ||
          ticket.first_response_by_id ||
          acknowledgedEvent?.by_id ||
          assignment?.by_id ||
          null;
        set.acknowledged_by_name =
          ticket.acknowledged_by_name ||
          ticket.first_response_by_name ||
          acknowledgedEvent?.by_name ||
          assignment?.by_name ||
          "System";
        set.first_response_at = new Date(acknowledgedAt);
        set.response_working_minutes = workingMinutesBetween(
          raisedAt,
          acknowledgedAt,
        );
        if (new Date(acknowledgedAt) <= sla.sla_response_due)
          set.response_sla_met_at = new Date(acknowledgedAt);
      }
      if (workStartedAt) {
        set.work_started_at = new Date(workStartedAt);
        set.work_started_by_id =
          ticket.work_started_by_id || workEvent?.by_id || ticket.assignee_id || null;
        set.work_started_by_name =
          ticket.work_started_by_name || workEvent?.by_name || ticket.assignee_name || "System";
      }
      if (resolvedAt) {
        set.resolved_at = new Date(resolvedAt);
        set.resolved_by_id = ticket.resolved_by_id || resolvedEvent?.by_id || null;
        set.resolved_by_name =
          ticket.resolved_by_name ||
          ticket.resolution?.resolved_by ||
          resolvedEvent?.by_name ||
          "System";
        set.resolution_working_minutes = workingMinutesBetween(raisedAt, resolvedAt);
        if (workStartedAt)
          set.member_working_minutes = workingMinutesBetween(
            workStartedAt,
            resolvedAt,
          );
        if (new Date(resolvedAt) <= sla.sla_resolution_due)
          set.resolution_sla_met_at = new Date(resolvedAt);
      }
      if (closedAt) {
        set.closed_at = new Date(closedAt);
        set.closed_by_id = ticket.closed_by_id || closedEvent?.by_id || null;
        set.closed_by_name =
          ticket.closed_by_name || closedEvent?.by_name || "Requester";
        set.lifecycle_working_minutes = workingMinutesBetween(raisedAt, closedAt);
      }
      if (reopenedEvent) {
        set.reopened_at = new Date(ticket.reopened_at || reopenedEvent.created_at);
        set.reopened_by_id = ticket.reopened_by_id || reopenedEvent.by_id || null;
        set.reopened_by_name =
          ticket.reopened_by_name || reopenedEvent.by_name || "Requester";
      }
      return {
        updateOne: {
          filter: { id: ticket.id, sla_schema_version: { $ne: 1 } },
          update: { $set: set },
        },
      };
    });
    if (writes.length)
      await database.collection("tickets").bulkWrite(writes, { ordered: false });
  }
}

// ---------------- SEED ----------------
const CATEGORIES = [
  "Daily Operations",
  "Employee Onboarding",
  "Employee Offboarding",
  "Email & Slack Support",
  "Laptop Allocation",
  "Laptop Replacement",
  "Laptop Repair",
  "Hardware Accessories",
  "IT Asset Inventory",
  "Internet Issues",
  "WiFi Issues",
  "LAN & Network Issues",
  "Printer Support",
  "Software Installation",
  "Device Configuration",
  "Vendor Asset Receipt",
  "Asset Transfer",
  "Account & Access Management",
  "Administrative Support",
  "Other",
];
const LOCATIONS = [
  { name: "Tulip - Ground Floor", building: "Tulip", code: "TULG" },
  { name: "Tulip - First Floor", building: "Tulip", code: "TUL1" },
  { name: "Tulip - Second Floor", building: "Tulip", code: "TUL2" },
  { name: "Tulip - Third Floor", building: "Tulip", code: "TUL3" },
  { name: "Lotus - Bullpen", building: "Lotus", code: "LOTB" },
  { name: "Lotus - Labs", building: "Lotus", code: "LOTL" },
];
const LOC_NAMES = LOCATIONS.map((l) => l.name);

const IT_SEED = [
  [
    "Lalit",
    "Network/Wi-Fi",
    "High",
    "Internet not working at desk",
    "Ajeet Kumar",
    "Resolve",
  ],
  [
    "Shivani Dhankar",
    "Laptop Allocation",
    "Medium",
    "New laptop assignment",
    "Ajeet Kumar",
    "Resolve",
  ],
  [
    "Rishabh Ramayne",
    "Laptop Allocation",
    "Medium",
    "Laptop assign for new joiner",
    "Ajeet Kumar",
    "Resolve",
  ],
  [
    "Rikta",
    "Printers",
    "High",
    "Printer not printing",
    "Sunil Rathore",
    "Resolve",
  ],
  [
    "Utakrsh",
    "Biometric",
    "Low",
    "Biometric IP assign",
    "Sunil Rathore",
    "Resolve",
  ],
  [
    "Aman Yadav",
    "Email/Access",
    "High",
    "Email not syncing",
    "Ajeet Kumar",
    "Resolve",
  ],
  [
    "Yassir Mulla",
    "Offboarding",
    "High",
    "Employee offboarding - revoke access",
    "Ajeet Kumar",
    "Resolve",
  ],
  [
    "Swarnim Jain",
    "Password Reset",
    "High",
    "Email password reset",
    "Sunil Rathore",
    "In Progress",
  ],
  [
    "Aniket Soni",
    "Network/Wi-Fi",
    "High",
    "Internet issue in cabin",
    "Ajeet Kumar",
    "In Progress",
  ],
  [
    "Shreya Kumari",
    "Hardware",
    "High",
    "Laptop not booting",
    "Ajeet Kumar",
    "In Progress",
  ],
  [
    "Gourav Singh",
    "Printers",
    "Low",
    "PDF printout support",
    "Sunil Rathore",
    "Resolve",
  ],
  [
    "Shivani Sehgal",
    "Hardware",
    "Medium",
    "Laptop charger issue",
    "Ajeet Kumar",
    "In Progress",
  ],
];

const ADMIN_TASK_SEED = [
  [
    "Update the Expense Summary on a daily basis",
    "Expense Summary",
    "HQ1",
    "daily",
    "Done",
    "",
  ],
  [
    "Prepare the Payment Sheet",
    "Payments",
    "HQ1",
    "daily",
    "Done",
    "No payment done today",
  ],
  [
    "Prepare Receivables vs Payables report",
    "Payments",
    "HQ1",
    "monthly",
    "Done",
    "",
  ],
  [
    "Handle banking tasks - account opening & payments",
    "Banking",
    "HQ1",
    "daily",
    "Done",
    "GRT Rekyc and demat account docs prepared",
  ],
  [
    "Update the Cash Flow statement daily",
    "Cash Flow",
    "HQ1",
    "daily",
    "Done",
    "",
  ],
  [
    "Process vendor and business payments",
    "Payments",
    "HQ1",
    "daily",
    "Done",
    "No vendor payment done today",
  ],
  [
    "Food Vendor License and agreement",
    "Vendors",
    "HQ1",
    "one-time",
    "In Process",
    "Agreement pending for review",
  ],
  [
    "New food vendor meeting (Round Tummy)",
    "Vendors",
    "HQ1",
    "one-time",
    "In Process",
    "Menu received, will ask for food taste",
  ],
  [
    "ID Card query and Parking issue at 301",
    "Parking",
    "301",
    "one-time",
    "In Process",
    "Parking issue under discussion",
  ],
  [
    "Printer Quotation HQ2",
    "Printers",
    "HQ2",
    "one-time",
    "Done",
    "New printer received",
  ],
  [
    "NPS enrollment",
    "Insurance",
    "HQ1",
    "one-time",
    "In Process",
    "Meeting fixed on 05/08",
  ],
  [
    "Group Medical Policy",
    "Insurance",
    "HQ1",
    "one-time",
    "In Process",
    "Need employee details for quotation",
  ],
  [
    "Laptop Insurance",
    "Insurance",
    "HQ1",
    "one-time",
    "In Process",
    "Need asset details for quotation",
  ],
];

const CHECKLIST_ITEMS = [
  "Courier and inward register",
  "Wi-Fi",
  "CCTV and assets",
  "Parking",
  "Food vendor billing",
  "Housekeeping",
  "Stationery inventory",
  "Air conditioning",
  "Visitor register",
  "Medicine register",
  "Complaint register",
  "Seat count",
  "Medicine requirements",
];

function mapStatus(s) {
  const m = {
    Resolve: "Resolved",
    Done: "Completed",
    "In Process": "In Progress",
  };
  return m[s] || s;
}

async function seedDb(db) {
  const existing = await db.collection("users").countDocuments();
  if (existing > 0) return { seeded: false, message: "already seeded" };

  const users = [
    {
      name: "Emma Employee",
      email: "employee@ethara.ai",
      role: "employee",
      department: "General",
      employee_id: "EMP-1001",
      location: "Tulip - Ground Floor",
    },
    {
      name: "Ajeet Kumar",
      email: "it@ethara.ai",
      role: "it",
      department: "IT",
      employee_id: "IT-2001",
      location: "Tulip - First Floor",
    },
    {
      name: "Sunil Rathore",
      email: "it2@ethara.ai",
      role: "it",
      department: "IT",
      employee_id: "IT-2002",
      location: "Tulip - Second Floor",
    },
    {
      name: "Rajeev Goyal",
      email: "admin@ethara.ai",
      role: "admin",
      department: "Admin",
      employee_id: "ADM-3001",
      location: "Lotus - Bullpen",
    },
    {
      name: "Neha Sharma",
      email: "admin2@ethara.ai",
      role: "admin",
      department: "Admin",
      employee_id: "ADM-3002",
      location: "Lotus - Labs",
    },
    {
      name: "Sara Superadmin",
      email: "superadmin@ethara.ai",
      role: "super_admin",
      department: "Management",
      employee_id: "SA-9001",
      location: "Tulip - Third Floor",
    },
  ];
  const userDocs = await Promise.all(
    users.map(async (u) => ({
      id: uuidv4(),
      password_hash: await bcrypt.hash(randomBytes(32).toString("base64url"), 12),
      password_reset_required: true,
      seeded_fixture: true,
      active: true,
      created_at: new Date(),
      ...u,
    })),
  );
  await db.collection("users").insertMany(userDocs);
  const byName = (n) => userDocs.find((u) => u.name === n);
  const employee = byName("Emma Employee");

  // categories
  const cats = [
    ...CATEGORIES.map((c) => ({ id: uuidv4(), department: "IT", name: c })),
    ...CATEGORIES.map((c) => ({ id: uuidv4(), department: "Admin", name: c })),
  ];
  await db.collection("categories").insertMany(cats);
  await db
    .collection("locations")
    .insertMany(LOCATIONS.map((l) => ({ id: uuidv4(), ...l })));

  // IT tickets from CSV (with realistic spread-out timestamps for SLA analytics)
  const itTickets = [];
  const histDocs = [];
  const HOUR = 3600000;
  for (const row of IT_SEED) {
    const [uname, cat, prio, desc, assignee, statusRaw] = row;
    const status = mapStatus(statusRaw);
    const id = uuidv4();
    const hid = await humanId(db, "IT");
    const assigneeUser = byName(assignee);
    const createdAt = new Date(
      Date.now() -
        Math.floor(1 + Math.random() * 13) * 24 * HOUR -
        Math.floor(Math.random() * 10) * HOUR,
    );
    const ackAt = new Date(
      createdAt.getTime() + Math.floor(1 + Math.random() * 6) * HOUR,
    );
    const resolvedAt = new Date(
      ackAt.getTime() + Math.floor(2 + Math.random() * 40) * HOUR,
    );
    const t = {
      id,
      human_id: hid,
      sla_schema_version: 1,
      department: "IT",
      category: cat,
      subcategory: "",
      title: `${cat} - ${uname}`,
      description: desc,
      priority: prio,
      status,
      raised_by_id: employee.id,
      raised_by_name: uname,
      raised_for_name: uname,
      employee_id: "EMP-" + Math.floor(1000 + Math.random() * 9000),
      email: "user@company.com",
      location: "HQ1",
      assignee_id: assigneeUser?.id || null,
      assignee_name: assignee,
      approval_required: false,
      legacy_id: null,
      ...slaDates("IT", prio, createdAt),
      created_at: createdAt,
      updated_at: resolvedAt,
      first_response_at: ackAt,
      resolution:
        status === "Resolved"
          ? {
              summary: "Issue resolved",
              action_taken: "Standard fix applied",
              root_cause: "",
              resolved_by: assignee,
              resolved_date: resolvedAt,
            }
          : null,
      confirmation: null,
    };
    itTickets.push(t);
    histDocs.push({
      id: uuidv4(),
      ticket_id: id,
      type: "created",
      by_name: uname,
      by_role: "employee",
      note: "Ticket raised",
      created_at: createdAt,
    });
    histDocs.push({
      id: uuidv4(),
      ticket_id: id,
      type: "status",
      to: "Acknowledged",
      by_name: assignee,
      by_role: "it",
      note: "",
      created_at: ackAt,
    });
    if (status === "Resolved")
      histDocs.push({
        id: uuidv4(),
        ticket_id: id,
        type: "status",
        to: status,
        by_name: assignee,
        by_role: "it",
        note: "",
        created_at: resolvedAt,
      });
  }
  await db.collection("tickets").insertMany(itTickets);
  if (histDocs.length) await db.collection("history").insertMany(histDocs);

  // Admin tasks from CSV
  const admin = byName("Rajeev Goyal");
  const taskDocs = [];
  for (const row of ADMIN_TASK_SEED) {
    const [title, cat, loc, rec, statusRaw, remarks] = row;
    const hid = await humanId(db, "ATSK");
    taskDocs.push({
      id: uuidv4(),
      human_id: hid,
      title,
      category: cat,
      location: loc,
      recurrence: rec,
      owner_id: admin.id,
      owner_name: admin.name,
      backup_owner_name: "Admin Backup",
      priority: "Medium",
      due_date: new Date(),
      status: mapStatus(statusRaw),
      remarks,
      linked_approval: null,
      completion_proof: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
  await db.collection("tasks").insertMany(taskDocs);

  // Checklist templates per location
  const templates = [];
  for (const loc of LOCATIONS) {
    templates.push({
      id: uuidv4(),
      name: `Daily Facility Checklist - ${loc.name}`,
      location: loc.name,
      code: loc.code,
      frequency: "daily",
      items: CHECKLIST_ITEMS.map((label, i) => ({ key: `item_${i}`, label })),
      created_at: new Date(),
    });
  }
  await db.collection("checklist_templates").insertMany(templates);

  // One sample admin approval ticket
  const aid = uuidv4();
  const ahid = await humanId(db, "ADM");
  await db.collection("tickets").insertOne({
    id: aid,
    human_id: ahid,
    sla_schema_version: 1,
    department: "Admin",
    category: "Printers",
    subcategory: "",
    title: "New printer procurement for HQ2",
    description: "Existing printer beyond repair, need replacement",
    priority: "High",
    status: "Approval Preparation",
    raised_by_id: employee.id,
    raised_by_name: "Emma Employee",
    raised_for_name: "Emma Employee",
    employee_id: "EMP-1001",
    email: "employee@demo.com",
    location: "HQ2",
    assignee_id: admin.id,
    assignee_name: admin.name,
    approval_required: true,
    legacy_id: null,
    ...slaDates("Admin", "High"),
    created_at: new Date(),
    updated_at: new Date(),
    resolution: null,
    confirmation: null,
  });
  await db.collection("history").insertOne({
    id: uuidv4(),
    ticket_id: aid,
    type: "created",
    by_name: "Emma Employee",
    by_role: "employee",
    note: "Ticket raised",
    created_at: new Date(),
  });

  // Extra Admin tickets for split-view / SLA / calendar richness
  const ADMIN_TICKET_SEED = [
    ["AC not working in meeting room", "AC", "High", "Resolved"],
    ["Housekeeping delay report", "Housekeeping", "Low", "Resolved"],
    ["Parking allocation for new joiner", "Parking", "Medium", "In Progress"],
    ["Stationery restock request", "Stationery", "Low", "Resolved"],
    ["Courier not delivered", "Courier", "Medium", "Open"],
    ["Water dispenser leaking", "Water", "High", "Resolved"],
    ["ID card replacement", "ID/Access Cards", "Medium", "Resolved"],
  ];
  const adminTickets = [];
  const adminHist = [];
  for (const [title, cat, prio, status] of ADMIN_TICKET_SEED) {
    const id = uuidv4();
    const hid = await humanId(db, "ADM");
    const createdAt = new Date(
      Date.now() - Math.floor(1 + Math.random() * 12) * 24 * HOUR,
    );
    const ackAt = new Date(
      createdAt.getTime() + Math.floor(1 + Math.random() * 8) * HOUR,
    );
    const resolvedAt = new Date(
      ackAt.getTime() + Math.floor(3 + Math.random() * 50) * HOUR,
    );
    adminTickets.push({
      id,
      human_id: hid,
      sla_schema_version: 1,
      department: "Admin",
      category: cat,
      subcategory: "",
      title,
      description: title,
      priority: prio,
      status,
      raised_by_id: employee.id,
      raised_by_name: "Emma Employee",
      raised_for_name: "Emma Employee",
      employee_id: "EMP-1001",
      email: "employee@demo.com",
      location: LOC_NAMES[Math.floor(Math.random() * LOC_NAMES.length)],
      assignee_id: admin.id,
      assignee_name: admin.name,
      approval_required: false,
      legacy_id: null,
      ...slaDates("Admin", prio, createdAt),
      created_at: createdAt,
      updated_at: resolvedAt,
      first_response_at: ackAt,
      resolution:
        status === "Resolved"
          ? {
              summary: "Handled",
              action_taken: "Resolved by admin team",
              root_cause: "",
              resolved_by: admin.name,
              resolved_date: resolvedAt,
            }
          : null,
      confirmation: null,
    });
    adminHist.push({
      id: uuidv4(),
      ticket_id: id,
      type: "created",
      by_name: "Emma Employee",
      by_role: "employee",
      note: "Ticket raised",
      created_at: createdAt,
    });
    adminHist.push({
      id: uuidv4(),
      ticket_id: id,
      type: "status",
      to: "Acknowledged",
      by_name: admin.name,
      by_role: "admin",
      created_at: ackAt,
    });
    if (status === "Resolved")
      adminHist.push({
        id: uuidv4(),
        ticket_id: id,
        type: "status",
        to: "Resolved",
        by_name: admin.name,
        by_role: "admin",
        created_at: resolvedAt,
      });
  }
  await db.collection("tickets").insertMany(adminTickets);
  await db.collection("history").insertMany(adminHist);

  // Per-member daily checklists (defined by Super Admin)
  const superUser = byName("Sara Superadmin");
  const memberChecklists = [
    {
      member: byName("Ajeet Kumar"),
      title: "IT Ops KRA",
      items: [
        "Verify server backups completed",
        "Check network & Wi-Fi uptime",
        "Respond to all pending tickets",
        "Update asset & inventory register",
        "Review security alerts",
      ],
    },
    {
      member: byName("Sunil Rathore"),
      title: "IT Support KRA",
      items: [
        "Check printer & peripheral status",
        "Process new laptop allocations",
        "Verify biometric devices online",
        "Clear helpdesk queue",
      ],
    },
    {
      member: byName("Rajeev Goyal"),
      title: "Admin Ops KRA",
      items: [
        "Update expense summary",
        "Check courier & inward register",
        "Verify housekeeping done",
        "Reconcile petty cash",
        "Review vendor payments",
      ],
    },
    {
      member: byName("Neha Sharma"),
      title: "Admin Facilities KRA",
      items: [
        "Inspect washrooms & pantry",
        "Verify visitor register",
        "Check AC & electricity",
        "Follow up vendor agreements",
      ],
    },
  ];
  const mcDocs = memberChecklists
    .filter((c) => c.member)
    .map((c) => ({
      id: uuidv4(),
      member_id: c.member.id,
      member_name: c.member.name,
      member_role: c.member.role,
      title: c.title,
      frequency: "daily",
      active: true,
      items: c.items.map((label, i) => ({ key: `mc_${i}`, label })),
      created_by: superUser?.name || "Super Admin",
      created_at: new Date(),
    }));
  if (mcDocs.length)
    await db.collection("member_checklists").insertMany(mcDocs);

  return {
    seeded: true,
    users: users.map((u) => ({ email: u.email, role: u.role })),
  };
}

// ---------------- OPTIONS ----------------
export async function OPTIONS() {
  return json({}, 200);
}

// ---------------- ROUTER ----------------
async function handleRoute(request, { params }) {
  const { path = [] } = await params;
  const route = `/${path.join("/")}`;
  const method = request.method;
  const seg = path;

  try {
    const db = await connectToDatabase();

    // health
    if (route === "/" || route === "/root")
      return json({ message: "TicketFlow API" });

    // Development-only seed. Never expose destructive fixture loading in production.
    if (route === "/seed" && method === "POST") {
      if (
        process.env.NODE_ENV === "production" ||
        process.env.ALLOW_DATABASE_SEED !== "true"
      )
        return json({ error: "Not found" }, 404);
      const force = new URL(request.url).searchParams.get("force") === "true";
      if (force) {
        for (const c of [
          "users",
          "categories",
          "locations",
          "tickets",
          "history",
          "comments",
          "approvals",
          "tasks",
          "checklist_templates",
          "checklist_executions",
          "member_checklists",
          "member_checklist_submissions",
          "notifications",
          "email_verifications",
          "audit_logs",
          "counters",
        ]) {
          await db.collection(c).deleteMany({});
        }
      }
      const r = await seedDb(db);
      return json(r);
    }

    // Optional scheduler entry point. A configured bearer secret lets a cron
    // process SLA breaches even when nobody is actively using the dashboard.
    if (route === "/sla/process" && method === "POST") {
      const cronSecret = process.env.SLA_CRON_SECRET;
      const authorization = request.headers.get("authorization");
      if (cronSecret && authorization === `Bearer ${cronSecret}`)
        return json(await processSlaBreaches(db, true));
    }

    // ---- AUTH ----
    if (route === "/auth/quick-login" && method === "POST") {
      if (
        process.env.NODE_ENV === "production" ||
        process.env.ALLOW_QUICK_LOGIN !== "true"
      )
        return json({ error: "Not found" }, 404);
      const body = await request.json();
      const role = ["employee", "it", "admin", "super_admin"].includes(
        body?.role,
      )
        ? body.role
        : null;
      if (!role) return json({ error: "Invalid quick-login role" }, 400);
      const user = await db.collection("users").findOne({
        role,
        seeded_fixture: true,
        active: { $ne: false },
      });
      if (!user)
        return json({ error: "Quick-login fixture is unavailable" }, 404);
      const token = await new SignJWT({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("8h")
        .setIssuedAt()
        .sign(jwtSecret());
      const response = json({ user: clean(user) });
      response.cookies.set("tf_token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: 8 * 3600,
      });
      await audit(db, user, "login.quick_fixture", "user", user.id, {});
      return response;
    }
    if (route === "/auth/login" && method === "POST") {
      const body = await request.json();
      // Guard against non-string (e.g. NoSQL operator object) input so crafted
      // payloads are rejected cleanly instead of throwing a 500.
      const email = (
        typeof body.email === "string" ? body.email : ""
      )
        .toLowerCase()
        .trim();
      const password = typeof body.password === "string" ? body.password : "";
      if (await loginRateLimited(db, request, email))
        return json({ error: "Too many login attempts. Try again later." }, 429);
      if (!email.endsWith("@ethara.ai")) {
        return json(
          { error: "Only @ethara.ai email addresses are allowed" },
          400,
        );
      }
      const user = await db.collection("users").findOne({ email });
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return json({ error: "Invalid credentials" }, 401);
      }
      if (user.email_verification_required && !user.email_verified_at)
        return json({ error: "Verify your email address before signing in" }, 403);
      if (user.active === false)
        return json({ error: "This account is awaiting approval or has been disabled" }, 403);
      await clearLoginAttempts(db, request, email);
      const token = await new SignJWT({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("7d")
        .setIssuedAt()
        .sign(jwtSecret());
      const res = json({ user: clean(user) });
      res.cookies.set("tf_token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 7 * 24 * 3600,
      });
      await audit(db, user, "login", "user", user.id, {});
      return res;
    }
    if (route === "/auth/verify-email" && method === "GET") {
      const token = new URL(request.url).searchParams.get("token") || "";
      const redirect = (status) =>
        NextResponse.redirect(
          new URL(`/?emailVerification=${status}`, publicAppOrigin(request)),
        );
      if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return redirect("invalid");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const now = new Date();
      const verification = await db.collection("email_verifications").findOneAndUpdate(
        {
          token_hash: tokenHash,
          consumed_at: null,
          expires_at: { $gt: now },
        },
        { $set: { consumed_at: now } },
        { returnDocument: "before" },
      );
      if (!verification) return redirect("invalid");
      const user = await db.collection("users").findOne({ id: verification.user_id });
      if (!user) return redirect("invalid");
      await db.collection("users").updateOne(
        { id: user.id },
        {
          $set: {
            email_verified_at: now,
            active:
              user.role === "employee" &&
              user.activation_pending_reason === "email_verification"
                ? true
                : user.active,
            activation_pending_reason: null,
            updated_at: now,
          },
        },
      );
      await audit(db, user, "auth.email_verified", "user", user.id, {});
      return redirect(user.role === "employee" ? "success" : "approval-pending");
    }
    if (route === "/auth/register" && method === "POST") {
      const b = await request.json();
      // Coerce to strings so non-string (e.g. object) input is rejected with a
      // 400 rather than throwing downstream (bcrypt.hash / .toLowerCase).
      const email = (typeof b.email === "string" ? b.email : "")
        .toLowerCase()
        .trim();
      const name = (typeof b.name === "string" ? b.name : "").trim();
      const password = typeof b.password === "string" ? b.password : "";
      if (!email.endsWith("@ethara.ai")) {
        return json(
          { error: "Registration is restricted to @ethara.ai email addresses" },
          400,
        );
      }
      if (!name || password.length < 8) {
        return json(
          {
            error: "Name and a password of at least 8 characters are required",
          },
          400,
        );
      }
      const managerSite = designatedManagerSite(email);
      const role = managerSite
        ? "it"
        : ["employee", "it", "admin"].includes(b.role)
          ? b.role
          : null;
      if (!role)
        return json(
          { error: "Please select a valid role (Employee, IT, or Admin)" },
          400,
        );
      const existing = await db.collection("users").findOne({ email });
      if (existing)
        return json(
          { error: "An account with this email already exists" },
          409,
        );
      const department =
        role === "it" ? "IT" : role === "admin" ? "Admin" : "General";
      const requiresEmailVerification = emailVerificationRequired();
      const verificationOrigin = requiresEmailVerification
        ? publicAppOrigin(request)
        : null;
      const hash = await bcrypt.hash(password, 10);
      const now = new Date();
      const user = {
        id: uuidv4(),
        name,
        email,
        role,
        department,
        password_hash: hash,
        employee_id: b.employee_id || "",
        location: b.location || "Tulip - Ground Floor",
        is_team_head: Boolean(managerSite),
        managed_locations: managerSite ? [managerSite] : [],
        active: role === "employee" && !requiresEmailVerification,
        activation_pending_reason: requiresEmailVerification
          ? "email_verification"
          : role === "employee"
            ? null
            : "super_admin_approval",
        email_verification_required: requiresEmailVerification,
        email_verified_at: requiresEmailVerification ? null : now,
        created_at: now,
      };
      await db.collection("users").insertOne(user);
      if (requiresEmailVerification) {
        await createEmailVerification(db, user, verificationOrigin);
        await audit(db, user, "register.verification_pending", "user", user.id, {
          role,
        });
        return json(
          {
            pending: true,
            message: "Account created. Check your email to verify your address.",
          },
          202,
        );
      }
      if (!user.active) {
        await audit(db, user, "register.pending", "user", user.id, { role });
        return json(
          { pending: true, message: "Account created and awaiting Super Admin approval" },
          202,
        );
      }
      const token = await new SignJWT({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("7d")
        .setIssuedAt()
        .sign(jwtSecret());
      const res = json({ user: clean(user) });
      res.cookies.set("tf_token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 7 * 24 * 3600,
      });
      await audit(db, user, "register", "user", user.id, { role });
      return res;
    }
    if (route === "/auth/logout" && method === "POST") {
      const res = json({ ok: true });
      res.cookies.set("tf_token", "", { httpOnly: true, path: "/", maxAge: 0 });
      return res;
    }
    if (route === "/auth/me" && method === "GET") {
      const s = await getSession(request);
      if (!s) return json({ user: null }, 200);
      const user = await db.collection("users").findOne({ id: s.id });
      if (!user || user.active === false) return json({ user: null }, 200);
      return json({ user: clean(user) });
    }

    // everything below requires auth
    const tokenSession = await getSession(request);
    if (!tokenSession) return json({ error: "Unauthorized" }, 401);
    const sessionUser = await db.collection("users").findOne({ id: tokenSession.id });
    if (!sessionUser || sessionUser.active === false)
      return json({ error: "Account disabled" }, 401);
    // Authorization always uses current database state, not potentially stale JWT claims.
    const session = {
      id: sessionUser.id,
      name: sessionUser.name,
      email: sessionUser.email,
      role: sessionUser.role,
      department: sessionUser.department,
      location: sessionUser.location,
      is_team_head: Boolean(sessionUser.is_team_head),
      managed_locations: sessionUser.managed_locations || [],
    };

    if (route === "/sla/process" && method === "POST") {
      if (session.role !== "super_admin")
        return json({ error: "Forbidden" }, 403);
      return json(await processSlaBreaches(db, true));
    }
    if (
      method === "GET" &&
      (route === "/dashboard" ||
        route === "/notifications" ||
        route.startsWith("/tickets") ||
        route.startsWith("/reports/"))
    ) {
      try {
        await processSlaBreaches(db);
      } catch (error) {
        console.error("SLA sweep failed:", error);
      }
    }

    // ---- SECURE ATTACHMENTS ----
    if (route === "/attachments" && method === "POST") {
      let form;
      try {
        form = await request.formData();
      } catch {
        return json({ error: "A valid multipart upload is required" }, 400);
      }
      const files = form
        .getAll("files")
        .filter((file) => file && typeof file.arrayBuffer === "function");
      if (!files.length)
        return json({ error: "Select at least one file" }, 400);
      if (files.length > MAX_ATTACHMENTS)
        return json(
          { error: `A maximum of ${MAX_ATTACHMENTS} files is allowed` },
          400,
        );
      if (
        files.reduce((sum, file) => sum + Number(file.size || 0), 0) >
        MAX_ATTACHMENT_TOTAL_BYTES
      )
        return json({ error: "Combined upload must not exceed 25 MB" }, 413);
      if (attachmentRateLimited(session.id, files))
        return json(
          { error: "Upload limit reached. Try again after the hourly window." },
          429,
        );
      const uploaded = [];
      try {
        for (const file of files)
          uploaded.push(await uploadAttachment(db, file, session));
      } catch (error) {
        if (uploaded.length) {
          try {
            await db.collection("attachments").deleteMany({
              id: { $in: uploaded.map((item) => item.id) },
            });
          } catch {}
        }
        for (const attachment of uploaded) {
          try {
            await db.deleteBlob(attachment.id);
          } catch {}
        }
        throw error;
      }
      await audit(db, session, "attachment.upload", "attachment", uploaded[0].id, {
        count: uploaded.length,
        total_bytes: uploaded.reduce((sum, item) => sum + item.size, 0),
      });
      return json({ attachments: uploaded.map(attachmentSummary) }, 201);
    }

    if (seg[0] === "attachments" && seg[1] && method === "GET") {
      const attachment = await db
        .collection("attachments")
        .findOne({ id: seg[1] });
      if (!attachment) return json({ error: "Attachment not found" }, 404);
      let authorized = attachment.owner_id === session.id && !attachment.linked_entity;
      if (!authorized && attachment.ticket_id) {
        const linkedTicket = await db
          .collection("tickets")
          .findOne({ id: attachment.ticket_id });
        authorized = Boolean(
          linkedTicket &&
            canAccessTicket(session, linkedTicket),
        );
      }
      if (!authorized) return json({ error: "Forbidden" }, 403);
      const body = await db.getBlob(attachment.id);
      if (!body) {
        return json({ error: "Stored attachment is unavailable" }, 404);
      }
      const response = new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": attachment.content_type,
          "Content-Length": String(body.length),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
      return response;
    }

    if (seg[0] === "attachments" && seg[1] && method === "DELETE") {
      const attachment = await db.collection("attachments").findOne({
        id: seg[1],
        owner_id: session.id,
        linked_entity: null,
      });
      if (!attachment)
        return json({ error: "Pending attachment not found" }, 404);
      await db.collection("attachments").deleteOne({ id: attachment.id });
      try {
        await db.deleteBlob(attachment.id);
      } catch {}
      await audit(db, session, "attachment.delete", "attachment", attachment.id);
      return json({ ok: true });
    }

    // ---- USERS / CONFIG ----
    if (route === "/users" && method === "GET") {
      let filter = { active: { $ne: false } };
      if (session.role === "employee") filter = { id: session.id };
      else if (session.role === "it") filter = { role: "it", active: { $ne: false } };
      else if (session.role === "admin") filter = { role: "admin", active: { $ne: false } };
      else if (session.role !== "super_admin")
        return json({ error: "Forbidden" }, 403);
      const users = await db.collection("users").find(filter).toArray();
      return json(clean(users));
    }
    if (seg[0] === "users" && seg[1] && method === "PATCH") {
      if (session.role !== "super_admin")
        return json({ error: "Forbidden" }, 403);
      const b = await request.json();
      const user = await db.collection("users").findOne({ id: seg[1] });
      if (!user) return json({ error: "Member not found" }, 404);
      const set = {};
      if (["employee", "it", "admin", "super_admin"].includes(b.role)) {
        set.role = b.role;
        set.department =
          b.role === "it"
            ? "IT"
            : b.role === "admin"
              ? "Admin"
              : b.role === "super_admin"
                ? "Management"
                : "General";
      }
      if (typeof b.active === "boolean") {
        set.active = b.active;
        set.activation_pending_reason = null;
      }
      if (typeof b.is_team_head === "boolean")
        set.is_team_head = b.is_team_head;
      if (b.name?.trim()) set.name = b.name.trim();
      if (b.employee_id !== undefined)
        set.employee_id = String(b.employee_id).trim();
      if (b.location !== undefined) set.location = String(b.location).trim();
      const managerSite = designatedManagerSite(user.email);
      if (managerSite) {
        set.role = "it";
        set.department = "IT";
        set.is_team_head = true;
        set.managed_locations = [managerSite];
      } else if (
        set.role &&
        !["it", "admin"].includes(set.role)
      ) {
        set.is_team_head = false;
        set.managed_locations = [];
      } else if (typeof b.is_team_head === "boolean") {
        const effectiveLocation =
          b.location !== undefined ? String(b.location).trim() : user.location;
        const site = ticketLocationSite(effectiveLocation);
        set.managed_locations = b.is_team_head && site ? [site] : [];
      }
      if (b.password) {
        if (String(b.password).length < 8)
          return json({ error: "Password must be at least 8 characters" }, 400);
        set.password_hash = await bcrypt.hash(String(b.password), 10);
        set.password_reset_required = false;
      }
      set.updated_at = new Date();
      await db.collection("users").updateOne({ id: user.id }, { $set: set });
      await audit(db, session, "user.settings.update", "user", user.id, {
        ...set,
        password_hash: set.password_hash ? "changed" : undefined,
      });
      return json(clean(await db.collection("users").findOne({ id: user.id })));
    }
    if (route === "/categories" && method === "GET") {
      const dept = new URL(request.url).searchParams.get("department");
      const q = dept ? { department: dept } : {};
      const cats = await db.collection("categories").find(q).toArray();
      return json(clean(cats));
    }
    if (route === "/locations" && method === "GET") {
      return json(clean(await db.collection("locations").find({}).toArray()));
    }

    if (route === "/firewall/overview" && method === "GET") {
      if (!["it", "admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const profile = firewallProfile(request);
      const fw = profile.value;
      const baseUrl = String(fw("API_URL")).replace(/\/$/, "");
      const apiKey = fw("API_KEY");
      const configured = Boolean(baseUrl && apiKey);
      const withLogRows = (path) =>
        /(?:\?|&)rows=/.test(path)
          ? path
          : `${path}${path.includes("?") ? "&" : "?"}rows=${fw("LOG_ROWS", "1000")}`;
      const firewallLogsPath = fw("LOGS_PATH", "/api/logs");
      const logsPath = withLogRows(firewallLogsPath);
      const paths = {
        status: fw("STATUS_PATH", "/api/system/status"),
        configuration: fw("CONFIG_PATH", "/api/system/configuration"),
        statistics: fw("STATISTICS_PATH", "/api/statistics"),
        devices: fw("DEVICES_PATH", "/api/connected-devices"),
        dhcp: fw("DHCP_PATH", "/api/v2/monitor/system/dhcp"),
        vpn: fw("VPN_PATH", "/api/vpn/status"),
        interfaces: fw("INTERFACES_PATH", "/api/interfaces"),
        policies: fw("POLICIES_PATH", "/api/v2/cmdb/firewall/policy"),
        logs: logsPath,
        events: fw("EVENTS_PATH", "/api/security-events"),
        threat_antivirus: withLogRows(
          fw("ANTIVIRUS_PATH", "/api/v2/log/memory/virus"),
        ),
        threat_ips: withLogRows(fw("IPS_PATH", "/api/v2/log/memory/ips")),
        threat_web: withLogRows(
          fw("WEBFILTER_PATH", "/api/v2/log/memory/webfilter"),
        ),
        threat_dns: withLogRows(fw("DNSFILTER_PATH", "/api/v2/log/memory/dns")),
      };
      if (!configured) {
        try {
          await recordFirewallHealth(db, profile, "unconfigured");
        } catch (error) {
          console.error("Firewall health tracking failed:", error);
        }
        return json({
          configured: false,
          connected: false,
          operational_state: "unconfigured",
          id: profile.id,
          label: profile.label,
          name: fw("NAME", profile.label),
          sections: {},
          errors: {},
          last_updated: null,
        });
      }
      const headerName = fw("API_HEADER", "Authorization");
      const prefix = fw("API_PREFIX", "Bearer");
      const headers = {
        Accept: "application/json",
        [headerName]: prefix ? `${prefix} ${apiKey}` : apiKey,
      };
      const tls = {
        allowSelfSigned: fw("ALLOW_SELF_SIGNED", "false") === "true",
        caPath: fw("CA_CERT_PATH", ""),
        certSha256: fw("CERT_SHA256", ""),
      };
      const results = await Promise.all(
        Object.entries(paths).map(async ([name, path]) => {
          try {
            const payload = await firewallRequest(
              `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`,
              headers,
              tls,
            );
            return [name, sanitizeFirewallPayload(payload), null];
          } catch (error) {
            return [name, null, error.message || "Request failed"];
          }
        }),
      );
      const sections = {},
        errors = {},
        threat_errors = {};
      results.forEach(([name, payload, error]) => {
        if (error && name.startsWith("threat_")) threat_errors[name] = error;
        else if (error) errors[name] = error;
        else sections[name] = payload;
      });
      const successfulSectionCount = Object.keys(sections).length;
      const failedSections = [
        ...Object.keys(errors),
        ...Object.keys(threat_errors),
      ];
      const operationalState =
        successfulSectionCount === 0
          ? "down"
          : failedSections.length
            ? "degraded"
            : "online";
      try {
        await recordFirewallHealth(db, profile, operationalState, {
          successfulSections: successfulSectionCount,
          failedSections,
        });
      } catch (error) {
        console.error("Firewall health tracking failed:", error);
      }
      if (sections.events !== undefined)
        sections.events = await enrichFirewallSecurityEvents(sections.events);
      if (sections.dhcp !== undefined) {
        const liveLeases = activeDhcpLeases(sections.dhcp);
        sections.devices = sections.logs
          ? enrichFirewallDevices(liveLeases, sections.logs)
          : liveLeases;
        sections.device_source = {
          type: "dhcp",
          live_only: true,
          count: liveLeases.length,
        };
      } else {
        sections.devices = [];
        sections.device_source = {
          type: "dhcp_unavailable",
          live_only: true,
          count: 0,
        };
      }
      const inventoryMapping = mapFirewallInventory(
        firewallRows(sections.devices),
      );
      sections.devices = inventoryMapping.devices;
      sections.device_inventory = inventoryMapping.summary;
      if (sections.logs) {
        const logRows = firewallRows(sections.logs);
        const logMapping = mapFirewallInventory(logRows);
        if (Array.isArray(sections.logs)) sections.logs = logMapping.devices;
        else if (Array.isArray(sections.logs.results))
          sections.logs = { ...sections.logs, results: logMapping.devices };
        else if (Array.isArray(sections.logs.data))
          sections.logs = { ...sections.logs, data: logMapping.devices };
        else if (Array.isArray(sections.logs.items))
          sections.logs = { ...sections.logs, items: logMapping.devices };
        sections.traffic_inventory = logMapping.summary;
        try {
          await archiveFirewallRecords(
            db,
            profile,
            fw("NAME", profile.label),
            logMapping.devices,
            new Date(),
          );
        } catch (error) {
          console.error("Firewall daily archive failed:", error);
        }
      }
      return json({
        configured: true,
        connected: successfulSectionCount > 0,
        operational_state: operationalState,
        id: profile.id,
        label: profile.label,
        name: fw("NAME", profile.label),
        sections,
        errors,
        threat_errors,
        last_updated: new Date().toISOString(),
      });
    }

    if (route === "/firewall/downtime" && method === "GET") {
      if (!["it", "admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const profile = firewallProfile(request);
      const requestedDays = Number(
        new URL(request.url).searchParams.get("days") || 7,
      );
      if (!Number.isFinite(requestedDays))
        return json({ error: "Invalid downtime period" }, 400);
      const days = Math.min(90, Math.max(1, Math.round(requestedDays)));
      return json(clean(await firewallDowntimeSummary(db, profile, days)));
    }

    if (route === "/firewall/report" && method === "GET") {
      if (!["it", "admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const profile = firewallProfile(request);
      const fw = profile.value;
      const baseUrl = String(fw("API_URL")).replace(/\/$/, "");
      const apiKey = fw("API_KEY");
      if (!baseUrl || !apiKey)
        return json({ error: "Firewall connection not configured" }, 400);
      const url = new URL(request.url);
      const days = Math.min(
        7,
        Math.max(1, Number(url.searchParams.get("days") || 7)),
      );
      const requestedHours = Number(url.searchParams.get("hours") || 0);
      const selectedDate = url.searchParams.get("date");
      const todayRequested = url.searchParams.get("today") === "true";
      if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate))
        return json({ error: "Invalid firewall report date" }, 400);
      const end = new Date();
      let start = new Date(end.getTime() - days * 86400000);
      let periodHours = days * 24;
      if (requestedHours > 0) {
        periodHours = Math.min(168, Math.max(1, requestedHours));
        start = new Date(end.getTime() - periodHours * 3600000);
      } else if (todayRequested) {
        const today = firewallArchiveDate(end);
        start = new Date(`${today}T00:00:00.000+05:30`);
        periodHours = Math.max(
          0,
          (end.getTime() - start.getTime()) / 3600000,
        );
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(selectedDate || "")) {
        start = new Date(`${selectedDate}T00:00:00.000+05:30`);
        end.setTime(new Date(`${selectedDate}T23:59:59.999+05:30`).getTime());
        periodHours = 24;
      }
      const basePath = fw("REPORT_PATH", fw("LOGS_PATH", "/api/logs"));
      const reportUrl = new URL(
        `${baseUrl}${basePath.startsWith("/") ? basePath : `/${basePath}`}`,
      );
      reportUrl.searchParams.set(
        fw("REPORT_START_PARAM", "start"),
        start.toISOString(),
      );
      reportUrl.searchParams.set(
        fw("REPORT_END_PARAM", "end"),
        end.toISOString(),
      );
      const configuredReportRows = Number(fw("REPORT_ROWS", "10000"));
      const reportRowLimit = Number.isFinite(configuredReportRows)
        ? Math.min(100000, Math.max(1, Math.round(configuredReportRows)))
        : 10000;
      reportUrl.searchParams.set("rows", String(reportRowLimit));
      const headerName = fw("API_HEADER", "Authorization");
      const prefix = fw("API_PREFIX", "Bearer");
      const payload = await firewallRequest(
        reportUrl.toString(),
        {
          Accept: "application/json",
          [headerName]: prefix ? `${prefix} ${apiKey}` : apiKey,
        },
        {
          allowSelfSigned: fw("ALLOW_SELF_SIGNED", "false") === "true",
          caPath: fw("CA_CERT_PATH", ""),
          certSha256: fw("CERT_SHA256", ""),
        },
      );
      const allRows = firewallRows(payload);
      const datedRows = allRows.filter((row) => {
        const time = firewallRecordTime(row);
        return time && time >= start && time <= end;
      });
      const records = datedRows.map(normalizedFirewallRecord).filter(Boolean);
      const archive = await archiveFirewallRecords(
        db,
        profile,
        fw("NAME", profile.label),
        datedRows,
        end,
      );
      return json({
        firewall: {
          id: profile.id,
          label: profile.label,
          name: fw("NAME", profile.label),
        },
        generated_at: end.toISOString(),
        period: {
          start: start.toISOString(),
          end: end.toISOString(),
          days: periodHours / 24,
          hours: periodHours,
        },
        summary: {
          records: records.length,
          api_rows_returned: allRows.length,
          api_row_limit: reportRowLimit,
          record_limit_reached: allRows.length >= reportRowLimit,
          blocked: records.filter((row) => /block|deny|drop/i.test(row.action))
            .length,
          threats: records.filter((row) =>
            /critical|high|virus|malware|intrusion/i.test(
              `${row.severity} ${row.message}`,
            ),
          ).length,
          traffic_bytes: records.reduce(
            (sum, row) => sum + row.sent_bytes + row.received_bytes,
            0,
          ),
        },
        archive,
        records,
      });
    }

    if (route === "/firewall/archive" && method === "GET") {
      if (!["it", "admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const url = new URL(request.url);
      const profile = firewallProfile(request);
      const date = url.searchParams.get("date");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const includeRecords = url.searchParams.get("include_records") === "true";
      const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
      const filter = { firewall_id: profile.id };
      if (validDate(date)) filter.date = date;
      else if (validDate(from) || validDate(to)) {
        filter.date = {};
        if (validDate(from)) filter.date.$gte = from;
        if (validDate(to)) filter.date.$lte = to;
      }
      if (date && !validDate(date))
        return json({ error: "Invalid archive date" }, 400);
      if ((from && !validDate(from)) || (to && !validDate(to)))
        return json({ error: "Invalid archive date range" }, 400);
      if (validDate(from) && validDate(to) && from > to)
        return json({ error: "Archive start date must be before end date" }, 400);
      const requestedLimit = Number(url.searchParams.get("limit") || 31);
      const limit = Math.min(includeRecords ? 7 : 365, Math.max(1, requestedLimit));
      const projection = includeRecords || validDate(date) ? {} : { records: 0 };
      const archives = await db
        .collection("firewall_daily_archives")
        .find(filter, { projection })
        .sort({ date: -1 })
        .limit(limit)
        .toArray();
      if (validDate(date))
        return archives[0]
          ? json(clean(archives[0]))
          : json({ error: "No archived report for that date" }, 404);
      const archiveSummaries = archives.map(({ records: storedRecords, ...item }) => item);
      return json({
        firewall: { id: profile.id, label: profile.label },
        archives: clean(includeRecords ? archiveSummaries : archives),
        count: archives.length,
        records: includeRecords
          ? archives.flatMap((item) =>
              (item.records || []).map((record) => ({
                archive_date: item.date,
                ...record,
              })),
            )
          : undefined,
      });
    }

    if (route === "/parking" && method === "GET") {
      if (!["admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const allocations = await db
        .collection("parking_allocations")
        .find({ location: "Tulip" })
        .sort({ vehicle_type: 1, slot_number: 1 })
        .toArray();
      return json({
        location: "Tulip",
        capacity: { four_wheeler: 12, two_wheeler: 90 },
        allocations: clean(allocations),
      });
    }
    if (route === "/parking" && method === "POST") {
      if (!["admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const b = await request.json();
      const member = await db.collection("users").findOne({ id: b.member_id });
      if (!member) return json({ error: "Member not found" }, 400);
      const vehicleType =
        b.vehicle_type === "four_wheeler" ? "four_wheeler" : "two_wheeler";
      const capacity = vehicleType === "four_wheeler" ? 12 : 90;
      const existing = await db
        .collection("parking_allocations")
        .find({ location: "Tulip", vehicle_type: vehicleType })
        .toArray();
      const occupied = new Set(existing.map((item) => item.slot_number));
      const requested = Number(b.slot_number || 0);
      const slotNumber =
        requested ||
        Array.from({ length: capacity }, (_, index) => index + 1).find(
          (slot) => !occupied.has(slot),
        );
      if (!slotNumber || slotNumber < 1 || slotNumber > capacity)
        return json({ error: "No valid parking slot available" }, 400);
      if (occupied.has(slotNumber))
        return json({ error: "That parking slot is already allocated" }, 409);
      const vehicleNumber = String(b.vehicle_number || "")
        .trim()
        .toUpperCase();
      if (!vehicleNumber)
        return json({ error: "Vehicle number is required" }, 400);
      if (
        await db
          .collection("parking_allocations")
          .findOne({ vehicle_number: vehicleNumber })
      )
        return json(
          { error: "This vehicle already has a parking allocation" },
          409,
        );
      const doc = {
        id: uuidv4(),
        location: "Tulip",
        member_id: member.id,
        member_name: member.name,
        member_email: member.email,
        vehicle_type: vehicleType,
        vehicle_number: vehicleNumber,
        slot_number: slotNumber,
        notes: b.notes || "",
        allocated_by: session.name,
        created_at: new Date(),
      };
      await db.collection("parking_allocations").insertOne(doc);
      await notify(
        db,
        member.id,
        `${vehicleType === "four_wheeler" ? "Four" : "Two"}-wheeler parking slot ${slotNumber} allocated at Tulip`,
        null,
      );
      await audit(db, session, "parking.allocate", "parking", doc.id, {
        member: member.name,
        slot: slotNumber,
        vehicle_type: vehicleType,
      });
      return json(clean(doc));
    }
    if (seg[0] === "parking" && seg[1] && method === "DELETE") {
      if (!["admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const allocation = await db
        .collection("parking_allocations")
        .findOne({ id: seg[1] });
      if (!allocation) return json({ error: "Allocation not found" }, 404);
      await db.collection("parking_allocations").deleteOne({ id: seg[1] });
      await notify(
        db,
        allocation.member_id,
        `Tulip parking slot ${allocation.slot_number} allocation removed`,
        null,
      );
      await audit(db, session, "parking.remove", "parking", allocation.id, {
        slot: allocation.slot_number,
      });
      return json({ ok: true });
    }

    // ---- APPROVALS: joined request feed ----
    if (route === "/approvals" && method === "GET") {
      if (!["it", "admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const ticketFilter = scopeFilter(session);
      const tickets = await db
        .collection("tickets")
        .find(ticketFilter)
        .toArray();
      const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
      const approvals = await db
        .collection("approvals")
        .find({ ticket_id: { $in: tickets.map((ticket) => ticket.id) } })
        .sort({ created_at: -1 })
        .toArray();
      return json(
        clean(
          approvals.map((approval) => ({
            ...approval,
            ticket: ticketById.get(approval.ticket_id),
          })),
        ),
      );
    }

    // ---- DASHBOARD ----
    if (route === "/dashboard" && method === "GET") {
      const deptParam = new URL(request.url).searchParams.get("department");
      let filter = scopeFilter(session);
      // super_admin may scope by department for split views
      if (session.role === "super_admin" && deptParam)
        filter = { department: deptParam };
      const tickets = await db.collection("tickets").find(filter).toArray();
      const count = (f) => tickets.filter(f).length;
      const now = Date.now();
      const HOUR = 3600000;
      // SLA timings
      const respTimes = [],
        resTimes = [];
      let slaMet = 0,
        slaTotalResolved = 0,
        responseMet = 0,
        responseBreached = 0,
        responsePending = 0;
      for (const t of tickets) {
        const responseAt = t.acknowledged_at || t.first_response_at;
        const resolvedAt = t.resolved_at || t.resolution?.resolved_date;
        if (responseAt && (t.raised_at || t.created_at)) {
          respTimes.push(workingHoursBetween(t.raised_at || t.created_at, responseAt));
          if (
            t.sla_response_due &&
            new Date(responseAt) <= new Date(t.sla_response_due)
          )
            responseMet++;
          else responseBreached++;
        } else if (
          t.sla_response_due &&
          new Date(t.sla_response_due).getTime() < now &&
          t.status !== "Cancelled"
        )
          responseBreached++;
        else if (t.status !== "Cancelled") responsePending++;
        if (resolvedAt && (t.raised_at || t.created_at)) {
          const rt = workingHoursBetween(t.raised_at || t.created_at, resolvedAt);
          resTimes.push(rt);
          slaTotalResolved++;
          if (
            t.sla_resolution_due &&
            new Date(resolvedAt) <= new Date(t.sla_resolution_due)
          )
            slaMet++;
        }
      }
      const avg = (a) =>
        a.length
          ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10
          : 0;
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const stats = {
        total: tickets.length,
        today: tickets.filter(
          (t) => t.created_at && new Date(t.created_at) >= startOfDay,
        ).length,
        open: count((t) => t.status === "Open"),
        unallocated: count(
          (t) =>
            !t.assignee_id &&
            !TERMINAL_TICKET_STATUSES.includes(t.status),
        ),
        assigned: count((t) => t.status === "Assigned"),
        in_progress: count((t) => t.status === "In Progress"),
        pending_user: count((t) => t.status === "Pending User Response"),
        pending_approval: count(
          (t) => t.status === "Pending Super Admin Approval",
        ),
        clarification: count((t) => t.status === "Clarification Required"),
        approved_ready: count(
          (t) => t.status === "Approved - Ready for Action",
        ),
        resolved: count((t) => t.status === "Resolved"),
        closed: count((t) => t.status === "Closed"),
        overdue: count(
          (t) =>
            !["Resolved", "Closed", "Cancelled"].includes(t.status) &&
            t.sla_resolution_due &&
            new Date(t.sla_resolution_due).getTime() < now,
        ),
        escalated: count(
          (t) =>
            !["Resolved", "Closed", "Cancelled"].includes(t.status) &&
            t.created_at &&
            now - new Date(t.created_at).getTime() > 24 * HOUR,
        ),
        avg_response_hours: avg(respTimes),
        avg_resolution_hours: avg(resTimes),
        sla_compliance: slaTotalResolved
          ? Math.round((slaMet / slaTotalResolved) * 100)
          : 0,
        response_sla_compliance: responseMet + responseBreached
          ? Math.round((responseMet / (responseMet + responseBreached)) * 100)
          : 0,
        response_sla_met: responseMet,
        response_sla_breached: responseBreached,
        response_sla_pending: responsePending,
        resolution_sla_met: slaMet,
        resolution_sla_breached: Math.max(0, slaTotalResolved - slaMet),
        by_priority: ["Critical", "High", "Medium", "Low"].map((p) => ({
          name: p,
          value: count((t) => t.priority === p),
        })),
        by_status: STATUSES.map((s) => ({
          name: s,
          value: count((t) => t.status === s),
        })).filter((x) => x.value > 0),
        by_category: Object.entries(
          tickets.reduce((a, t) => {
            a[t.category] = (a[t.category] || 0) + 1;
            return a;
          }, {}),
        ).map(([name, value]) => ({ name, value })),
      };
      // extra for tasks/approvals
      if (session.role === "admin" || session.role === "super_admin") {
        const tasks = await db.collection("tasks").find({}).toArray();
        stats.tasks_total = tasks.length;
        stats.tasks_overdue = tasks.filter(
          (t) =>
            t.status !== "Completed" &&
            t.due_date &&
            new Date(t.due_date).getTime() < now,
        ).length;
        stats.tasks_in_progress = tasks.filter(
          (t) => t.status === "In Progress",
        ).length;
      }
      const recent = [...tickets]
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
        .slice(0, 8);
      stats.recent = clean(recent);
      // calendar payload (lightweight, all scoped tickets)
      stats.calendar = tickets.map((t) => ({
        id: t.id,
        human_id: t.human_id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        created_at: t.created_at,
      }));
      return json(stats);
    }

    // ---- REPORTS: member SLA ----
    if (route === "/reports/member-sla" && method === "GET") {
      if (session.role !== "super_admin")
        return json({ error: "Forbidden" }, 403);
      const dept = new URL(request.url).searchParams.get("department") || "IT";
      const role = dept === "Admin" ? "admin" : "it";
      const members = await db
        .collection("users")
        .find({ role, active: { $ne: false } })
        .toArray();
      const tickets = await db
        .collection("tickets")
        .find({ department: dept })
        .toArray();
      const HOUR = 3600000;
      const avg = (a) =>
        a.length
          ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10
          : 0;
      const rows = members.map((mUser) => {
        const mt = tickets.filter((t) => t.assignee_id === mUser.id);
        const resp = [],
          res = [],
          work = [];
        let resolutionMet = 0,
          resolvedCount = 0,
          responseMet = 0,
          responseBreached = 0,
          responsePending = 0;
        for (const t of mt) {
          const responseAt = t.acknowledged_at || t.first_response_at;
          const resolvedAt = t.resolved_at || t.resolution?.resolved_date;
          if (responseAt && (t.raised_at || t.created_at)) {
            resp.push(
              workingHoursBetween(t.raised_at || t.created_at, responseAt),
            );
            if (
              t.sla_response_due &&
              new Date(responseAt) <= new Date(t.sla_response_due)
            )
              responseMet++;
            else responseBreached++;
          } else if (
            t.sla_response_due &&
            new Date(t.sla_response_due) < new Date() &&
            t.status !== "Cancelled"
          )
            responseBreached++;
          else if (t.status !== "Cancelled") responsePending++;
          if (resolvedAt && (t.raised_at || t.created_at)) {
            res.push(
              workingHoursBetween(t.raised_at || t.created_at, resolvedAt),
            );
            if (t.work_started_at)
              work.push(workingHoursBetween(t.work_started_at, resolvedAt));
            resolvedCount++;
            if (
              t.sla_resolution_due &&
              new Date(resolvedAt) <= new Date(t.sla_resolution_due)
            )
              resolutionMet++;
          }
        }
        const openCount = mt.filter(
          (t) => !["Resolved", "Closed", "Cancelled"].includes(t.status),
        ).length;
        return {
          member_id: mUser.id,
          member_name: mUser.name,
          email: mUser.email,
          location: mUser.location,
          assigned: mt.length,
          open: openCount,
          resolved: resolvedCount,
          avg_response_hours: avg(resp),
          avg_resolution_hours: avg(res),
          avg_working_hours: avg(work),
          total_working_hours: Math.round(
            work.reduce((sum, hours) => sum + hours, 0) * 10,
          ) / 10,
          response_sla_met: responseMet,
          response_sla_breached: responseBreached,
          response_sla_pending: responsePending,
          response_sla_compliance: responseMet + responseBreached
            ? Math.round((responseMet / (responseMet + responseBreached)) * 100)
            : 0,
          resolution_sla_met: resolutionMet,
          resolution_sla_breached: Math.max(0, resolvedCount - resolutionMet),
          resolution_sla_compliance: resolvedCount
            ? Math.round((resolutionMet / resolvedCount) * 100)
            : 0,
          sla_compliance: responseMet + responseBreached + resolvedCount
            ? Math.round(((responseMet + resolutionMet) / (responseMet + responseBreached + resolvedCount)) * 100)
            : 0,
        };
      });
      return json({ department: dept, members: rows });
    }

    // ---- REPORTS: issue patterns and SLA by requesting user ----
    if (route === "/reports/user-issues" && method === "GET") {
      if (!["it", "admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const url = new URL(request.url);
      const department = url.searchParams.get("department");
      let filter = scopeFilter(session);
      if (session.role === "super_admin" && ["IT", "Admin"].includes(department))
        filter = { department };
      const tickets = await db.collection("tickets").find(filter).toArray();
      const now = new Date();
      const done = ["Resolved", "Closed", "Cancelled"];
      const groups = new Map();
      for (const ticket of tickets) {
        const key =
          ticket.issue_user_id ||
          (ticket.issue_user_name
            ? `name:${ticket.issue_user_name.toLowerCase()}`
            : null) ||
          ticket.issue_user_email ||
          ticket.email ||
          ticket.raised_by_id ||
          ticket.issue_user_name ||
          ticket.raised_for_name ||
          ticket.raised_by_name ||
          "unknown";
        if (!groups.has(key))
          groups.set(key, {
            user_id: ticket.issue_user_id || ticket.raised_by_id || null,
            user_name:
              ticket.issue_user_name ||
              ticket.raised_for_name ||
              ticket.raised_by_name ||
              "Unknown user",
            email: ticket.issue_user_email || ticket.email || "",
            employee_id:
              ticket.issue_user_employee_code || ticket.employee_id || "",
            location: ticket.location || "",
            total: 0,
            open: 0,
            overdue: 0,
            response_met: 0,
            response_breached: 0,
            response_pending: 0,
            resolution_breached: 0,
            categories: {},
            priorities: {},
            last_issue_at: null,
            latest_ticket_id: null,
            latest_human_id: null,
            latest_title: null,
          });
        const row = groups.get(key);
        row.total++;
        if (!done.includes(ticket.status)) row.open++;
        if (
          !done.includes(ticket.status) &&
          ticket.sla_resolution_due &&
          new Date(ticket.sla_resolution_due) < now
        ) {
          row.overdue++;
          row.resolution_breached++;
        } else if (
          ticket.resolution?.resolved_date &&
          ticket.sla_resolution_due &&
          new Date(ticket.resolution.resolved_date) > new Date(ticket.sla_resolution_due)
        )
          row.resolution_breached++;
        const responseAt = ticket.acknowledged_at || ticket.first_response_at;
        if (responseAt) {
          if (
            ticket.sla_response_due &&
            new Date(responseAt) <= new Date(ticket.sla_response_due)
          )
            row.response_met++;
          else row.response_breached++;
        } else if (
          ticket.sla_response_due &&
          new Date(ticket.sla_response_due) < now &&
          ticket.status !== "Cancelled"
        )
          row.response_breached++;
        else if (ticket.status !== "Cancelled") row.response_pending++;
        const category = ticket.category || "Other";
        row.categories[category] = (row.categories[category] || 0) + 1;
        const priority = ticket.priority || "Medium";
        row.priorities[priority] = (row.priorities[priority] || 0) + 1;
        if (!row.last_issue_at || new Date(ticket.created_at) > new Date(row.last_issue_at)) {
          row.last_issue_at = ticket.created_at;
          row.latest_ticket_id = ticket.id;
          row.latest_human_id = ticket.human_id;
          row.latest_title = ticket.title;
        }
      }
      const users = [...groups.values()]
        .map((row) => ({
          ...row,
          response_sla_compliance: row.response_met + row.response_breached
            ? Math.round((row.response_met / (row.response_met + row.response_breached)) * 100)
            : 0,
          top_categories: Object.entries(row.categories)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count),
          repeat_issue: Object.values(row.categories).some((count) => count > 1),
        }))
        .sort((a, b) => b.total - a.total || b.overdue - a.overdue);
      return json({ users, total_users: users.length, total_tickets: tickets.length });
    }

    // ---- TICKETS ----
    if (route === "/tickets" && method === "GET") {
      const url = new URL(request.url);
      const p = url.searchParams;
      const filter = { ...scopeFilter(session) };
      if (session.role === "super_admin" && p.get("department")) filter.department = p.get("department");
      if (p.get("status")) filter.status = p.get("status");
      if (p.get("priority")) filter.priority = p.get("priority");
      if (p.get("category")) filter.category = p.get("category");
      if (p.get("location")) filter.location = p.get("location");
      if (p.get("assignee_id") === "unassigned")
        filter.assignee_id = null;
      else if (p.get("assignee_id"))
        filter.assignee_id = p.get("assignee_id");
      if (p.get("allocation") === "unallocated")
        filter.assignee_id = null;
      if (p.get("search")) {
        const rx = new RegExp(
          p.get("search").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "i",
        );
        const searchFilter = [
          { title: rx },
          { human_id: rx },
          { description: rx },
          { raised_by_name: rx },
          { raised_for_name: rx },
          { issue_user_name: rx },
          { issue_user_email: rx },
          { issue_user_employee_code: rx },
        ];
        if (filter.$or) {
          const visibilityFilter = filter.$or;
          delete filter.$or;
          filter.$and = [
            { $or: visibilityFilter },
            { $or: searchFilter },
          ];
        } else filter.$or = searchFilter;
      }
      const parsedPage = Number.parseInt(p.get("page") || "1", 10);
      const parsedLimit = Number.parseInt(p.get("limit") || "15", 10);
      const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(100, Math.max(1, parsedLimit))
        : 15;
      const total = await db.collection("tickets").countDocuments(filter);
      const items = await db
        .collection("tickets")
        .find(filter)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray();
      return json({
        items: clean(items),
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      });
    }

    if (route === "/tickets" && method === "POST") {
      const b = await request.json();
      const department = b.department || "IT";
      if (!["IT", "Admin"].includes(department))
        return json({ error: "Invalid department" }, 400);
      const title = textValue(b.title, 200);
      const description = textValue(b.description, 10000);
      if (!title || !description)
        return json({ error: "Title and description are required" }, 400);
      const category = textValue(b.category, 100);
      if (!category)
        return json({ error: "Select a ticket category" }, 400);
      const validCategory = await db.collection("categories").findOne({
        department,
        name: category,
      });
      if (!validCategory)
        return json(
          { error: `Select a valid ${department} ticket category` },
          400,
        );
      // employees can raise; IT/Admin can raise for others
      const id = uuidv4();
      const prefix = department === "Admin" ? "ADM" : "IT";
      const hid = await humanId(db, prefix);
      const priority = b.priority || "Medium";
      if (!["Critical", "High", "Medium", "Low"].includes(priority))
        return json({ error: "Invalid priority" }, 400);
      const pendingTicketAttachments = await ownedPendingAttachments(
        db,
        b.attachment_ids,
        session,
      );
      const requestedAssignee =
        session.role !== "employee" && b.assignee_id
          ? await db.collection("users").findOne({
              id: b.assignee_id,
              role: department === "Admin" ? "admin" : "it",
              active: { $ne: false },
            })
          : null;
      if (b.assignee_id && !requestedAssignee)
        return json({ error: "Valid department member not found" }, 400);
      const hasExplicitIssueUser = Boolean(
        b.raised_for_id ||
          textValue(b.raised_for_name, 150) ||
          textValue(b.email, 254) ||
          textValue(b.employee_id, 50),
      );
      let issueUser =
        session.role === "employee" || !hasExplicitIssueUser
          ? sessionUser
          : null;
      if (!issueUser && b.raised_for_id)
        issueUser = await db
          .collection("users")
          .findOne({ id: b.raised_for_id, active: { $ne: false } });
      if (!issueUser) {
        const identity = [];
        const requestedEmail = textValue(b.email, 254).toLowerCase();
        const requestedEmployeeId = textValue(b.employee_id, 50);
        const requestedName = textValue(b.raised_for_name, 150);
        if (requestedEmail) identity.push({ email: requestedEmail });
        if (requestedEmployeeId) identity.push({ employee_id: requestedEmployeeId });
        if (requestedName) identity.push({ name: requestedName });
        if (identity.length)
          issueUser = await db
            .collection("users")
            .findOne({ active: { $ne: false }, $or: identity });
      }
      const now = new Date();
      const issueUserName =
        issueUser?.name || textValue(b.raised_for_name, 150) || session.name;
      const issueUserEmail =
        issueUser?.email ||
        (session.role === "employee"
          ? session.email
          : textValue(b.email, 254).toLowerCase() || session.email);
      const issueEmployeeCode =
        issueUser?.employee_id || textValue(b.employee_id, 50);
      const explicitLocation = textValue(b.location, 150);
      if (explicitLocation) {
        const validLocation = await db
          .collection("locations")
          .findOne({ name: explicitLocation });
        if (!validLocation)
          return json({ error: "Select a valid ticket location" }, 400);
      }
      const location =
        explicitLocation || issueUser?.location || sessionUser.location || "HQ1";
      const routingSite = ticketLocationSite(location);
      const routingTicket = { department, location, routing_site: routingSite };
      if (requestedAssignee && session.role !== "super_admin") {
        if (session.role !== requestedAssignee.role)
          return json({ error: "You can only assign within your team" }, 403);
        const assigningToSelf = requestedAssignee.id === session.id;
        if (
          (!assigningToSelf && !isTicketTeamHead(sessionUser, routingTicket)) ||
          (assigningToSelf && !canAccessTicket(session, routingTicket))
        )
          return json(
            {
              error: assigningToSelf
                ? "You can only claim tickets routed to your location"
                : department === "IT"
                  ? "Only the location IT head can allocate this ticket to another member"
                  : "Only an Admin team head can allocate this ticket to another member",
            },
            403,
          );
      }
      const statusTimestamps = { raised: now, open: now };
      if (requestedAssignee) {
        statusTimestamps.assigned = now;
        statusTimestamps.acknowledged = now;
      }
      const t = {
        id,
        human_id: hid,
        sla_schema_version: 1,
        department,
        category,
        subcategory: textValue(b.subcategory, 100),
        title,
        description,
        priority,
        status: requestedAssignee ? "Assigned" : "Open",
        raised_by_id: session.id,
        raised_by_name: session.name,
        raised_for_name: issueUserName,
        employee_id: issueEmployeeCode,
        email: issueUserEmail,
        issue_user_id: issueUser?.id || (session.role === "employee" ? session.id : null),
        issue_user_name: issueUserName,
        issue_user_email: issueUserEmail,
        issue_user_employee_code: issueEmployeeCode,
        location,
        routing_site: routingSite,
        routed_team: routingSite ? `${department}:${routingSite}` : department,
        allocation_status: requestedAssignee ? "allocated" : "unallocated",
        queue_state: requestedAssignee ? "assigned" : "pending",
        assignee_id: requestedAssignee?.id || null,
        assignee_name: requestedAssignee?.name || null,
        raised_at: now,
        assigned_at: requestedAssignee ? now : null,
        last_assigned_at: requestedAssignee ? now : null,
        assigned_by_id: requestedAssignee ? session.id : null,
        assigned_by_name: requestedAssignee ? session.name : null,
        acknowledged_at: requestedAssignee ? now : null,
        acknowledged_by_id: requestedAssignee ? session.id : null,
        acknowledged_by_name: requestedAssignee ? session.name : null,
        first_response_at: requestedAssignee ? now : null,
        first_response_by_id: requestedAssignee ? session.id : null,
        first_response_by_name: requestedAssignee ? session.name : null,
        response_working_minutes: requestedAssignee ? 0 : null,
        status_timestamps: statusTimestamps,
        attachments: pendingTicketAttachments.map(attachmentSummary),
        approval_required: false,
        legacy_id: null,
        ...slaDates(department, priority, now),
        created_at: now,
        updated_at: now,
        resolution: null,
        confirmation: null,
      };
      await db.collection("tickets").insertOne(t);
      await linkAttachments(
        db,
        pendingTicketAttachments,
        "ticket",
        id,
        id,
      );
      await addHistory(
        db,
        id,
        "created",
        session,
        "Ticket raised",
        null,
        t.status,
      );
      if (requestedAssignee)
        await addHistory(
          db,
          id,
          "assignment",
          session,
          `Acknowledged and assigned to ${requestedAssignee.name}`,
          null,
          requestedAssignee.name,
        );
      await audit(db, session, "ticket.create", "ticket", id, {
        human_id: hid,
      });
      // notify department
      const deptRole = department === "Admin" ? "admin" : "it";
      const staff = await db
        .collection("users")
        .find({ role: deptRole, active: { $ne: false } })
        .toArray();
      const locationStaff =
        department === "IT" && routingSite
          ? staff.filter(
              (user) =>
                ticketLocationSite(user.location) === routingSite ||
                (user.is_team_head && managedItSites(user).includes(routingSite)),
            )
          : staff;
      const intakeRecipients = locationStaff.length ? locationStaff : staff;
      await notify(
        db,
        intakeRecipients.map((u) => u.id),
        `New ${department} ticket ${hid}: ${t.title}`,
        t,
      );
      if (requestedAssignee)
        await notify(
          db,
          requestedAssignee.id,
          `Ticket ${hid} assigned to you`,
          t,
        );
      return json(clean(t));
    }

    // /tickets/:id ...
    if (seg[0] === "tickets" && seg[1]) {
      const ticketId = seg[1];
      const ticket = await db.collection("tickets").findOne({ id: ticketId });
      if (!ticket) return json({ error: "Not found" }, 404);
      // Object-level authorization includes the routed IT location.
      if (!canAccessTicket(session, ticket))
        return json({ error: "Forbidden" }, 403);

      // GET detail
      if (seg.length === 2 && method === "GET") {
        const history = await db
          .collection("history")
          .find({ ticket_id: ticketId })
          .sort({ created_at: 1 })
          .toArray();
        let comments = await db
          .collection("comments")
          .find({ ticket_id: ticketId })
          .sort({ created_at: 1 })
          .toArray();
        // employees only see public comments
        if (session.role === "employee")
          comments = comments.filter((c) => c.type === "public");
        const approval = await db
          .collection("approvals")
          .findOne({ ticket_id: ticketId });
        const detail = clean(ticket);
        detail.history = clean(history);
        detail.comments = clean(comments);
        detail.approval = session.role === "employee" ? null : clean(approval);
        return json(detail);
      }

      // staff-only mutations
      const isStaff = ["it", "admin", "super_admin"].includes(session.role);

      // update (status/assign/priority/resolution)
      if (seg.length === 2 && method === "PATCH") {
        if (!isStaff) return json({ error: "Forbidden" }, 403);
        if (TERMINAL_TICKET_STATUSES.includes(ticket.status))
          return json(
            {
              error:
                "This ticket is final and cannot be reassigned, reopened, or modified",
            },
            409,
          );
        const b = await request.json();
        const now = new Date();
        const set = { updated_at: now };
        const actor = sessionUser;
        const teamRole = ticket.department === "Admin" ? "admin" : "it";
        const raisedAt = ticket.raised_at || ticket.created_at;
        let acknowledgementAt = ticket.acknowledged_at || ticket.first_response_at;
        let resolutionAt = ticket.resolved_at || ticket.resolution?.resolved_date;
        let lifecycleChanged = false;

        const markAcknowledged = () => {
          if (acknowledgementAt) return;
          acknowledgementAt = now;
          set.acknowledged_at = now;
          set.acknowledged_by_id = session.id;
          set.acknowledged_by_name = session.name;
          set.first_response_at = now;
          set.first_response_by_id = session.id;
          set.first_response_by_name = session.name;
          set.response_working_minutes = workingMinutesBetween(raisedAt, now);
          set["status_timestamps.acknowledged"] = now;
          lifecycleChanged = true;
        };

        const markResolved = () => {
          if (!resolutionAt) {
            resolutionAt = now;
            set.resolved_at = now;
            set.resolved_by_id = session.id;
            set.resolved_by_name = session.name;
            set.resolution_working_minutes = workingMinutesBetween(raisedAt, now);
            if (ticket.work_started_at)
              set.member_working_minutes = workingMinutesBetween(
                ticket.work_started_at,
                now,
              );
          }
          set["status_timestamps.resolved"] = now;
          lifecycleChanged = true;
        };

        if (b.assignee_id !== undefined) {
          const u = b.assignee_id
            ? await db.collection("users").findOne({
                id: b.assignee_id,
                role: teamRole,
                active: { $ne: false },
              })
            : null;
          if (b.assignee_id && !u)
            return json({ error: "Valid department member not found" }, 400);
          if (session.role !== "super_admin") {
            if (session.role !== teamRole)
              return json(
                { error: "You can only assign within your team" },
                403,
              );
            const actorIsTicketHead = isTicketTeamHead(actor, ticket);
            if (u?.id === session.id) {
              if (
                ticket.assignee_id &&
                ticket.assignee_id !== session.id &&
                !actorIsTicketHead
              )
                return json(
                  { error: "This ticket is already allocated to another member" },
                  409,
                );
            } else if (u && !actorIsTicketHead)
              return json(
                { error: "Only the location team head can assign another member" },
                403,
              );
            if (
              !u &&
              ticket.assignee_id &&
              ticket.assignee_id !== session.id &&
              !actorIsTicketHead
            )
              return json(
                { error: "You can only unassign a ticket allocated to you" },
                403,
              );
          }
          set.assignee_id = u?.id || null;
          set.assignee_name = u?.name || null;
          set.allocation_status = u ? "allocated" : "unallocated";
          set.queue_state = u ? "assigned" : "pending";
          if ((ticket.assignee_id || null) !== (u?.id || null)) {
            if (u) {
              if (ticket.status === "Open") set.status = "Assigned";
              if (!ticket.assigned_at) set.assigned_at = now;
              set.last_assigned_at = now;
              set.assigned_by_id = session.id;
              set.assigned_by_name = session.name;
              set["status_timestamps.assigned"] = now;
              markAcknowledged();
            } else {
              set.last_unassigned_at = now;
              set.unassigned_by_id = session.id;
              set.unassigned_by_name = session.name;
            }
            await addHistory(
              db,
              ticketId,
              "assignment",
              session,
              u
                ? `Acknowledged and assigned to ${u.name}`
                : "Assignment removed",
              ticket.assignee_name,
              u?.name || null,
            );
          }
          if (u && ticket.assignee_id !== u.id)
            await notify(
              db,
              u.id,
              `Ticket ${ticket.human_id} assigned to you`,
              ticket,
            );
        }
        if (b.priority && b.priority !== ticket.priority) {
          if (!["Critical", "High", "Medium", "Low"].includes(b.priority))
            return json({ error: "Invalid priority" }, 400);
          set.priority = b.priority;
          const sla = slaDates(ticket.department, b.priority, raisedAt);
          set.sla_response_due = sla.sla_response_due;
          set.sla_resolution_due = sla.sla_resolution_due;
          set.sla_clock_started_at = sla.sla_clock_started_at;
          set.sla_policy = sla.sla_policy;
          await addHistory(
            db,
            ticketId,
            "priority",
            session,
            `Priority changed`,
            ticket.priority,
            b.priority,
          );
        }
        if (b.status && b.status !== ticket.status) {
          if (!STATUSES.includes(b.status))
            return json({ error: "Invalid status" }, 400);
          // block execution before approval
          const executionStatuses = ["In Progress", "Resolved"];
          if (
            ticket.approval_required &&
            executionStatuses.includes(b.status)
          ) {
            const appr = await db
              .collection("approvals")
              .findOne({ ticket_id: ticketId });
            if (
              !appr ||
              (appr.status !== "Approved" &&
                appr.status !== "Partially Approved")
            ) {
              return json({ error: "Approval required before execution" }, 400);
            }
          }
          const effectiveAssignee =
            b.assignee_id !== undefined ? b.assignee_id : ticket.assignee_id;
          if (
            !actor?.is_team_head &&
            session.role !== "super_admin" &&
            effectiveAssignee !== session.id
          )
            return json(
              { error: "Only the assigned member or team head can update this ticket" },
              403,
            );
          if (
            ["In Progress", "Resolved"].includes(b.status) &&
            !effectiveAssignee
          )
            return json(
              { error: "Assign the ticket before starting or resolving it" },
              400,
            );
          set.status = b.status;
          const statusKey = b.status
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "");
          set[`status_timestamps.${statusKey}`] = now;
          if (b.status === "Acknowledged") markAcknowledged();
          if (b.status === "In Progress") {
            markAcknowledged();
            if (!ticket.work_started_at) {
              set.work_started_at = now;
              set.work_started_by_id = session.id;
              set.work_started_by_name = session.name;
            }
            lifecycleChanged = true;
          }
          if (b.status === "Resolved") markResolved();
          if (b.status === "Closed") {
            set.closed_at = ticket.closed_at || now;
            set.closed_by_id = session.id;
            set.closed_by_name = session.name;
            set.lifecycle_working_minutes = workingMinutesBetween(raisedAt, now);
            lifecycleChanged = true;
          }
          await addHistory(
            db,
            ticketId,
            "status",
            session,
            b.note || "",
            ticket.status,
            b.status,
          );
          await notify(
            db,
            requesterId(ticket),
            `Ticket ${ticket.human_id} status: ${b.status}`,
            ticket,
          );
        }
        if (b.resolution) {
          const effectiveAssignee =
            b.assignee_id !== undefined ? b.assignee_id : ticket.assignee_id;
          if (
            !actor?.is_team_head &&
            session.role !== "super_admin" &&
            effectiveAssignee !== session.id
          )
            return json(
              { error: "Only the assigned member or team head can resolve this ticket" },
              403,
            );
          if (!effectiveAssignee)
            return json({ error: "Assign the ticket before resolving it" }, 400);
          if (ticket.approval_required) {
            const approval = await db.collection("approvals").findOne({ ticket_id: ticketId });
            if (!approval || !["Approved", "Partially Approved"].includes(approval.status))
              return json({ error: "Approval required before resolution" }, 400);
          }
          const summary = textValue(b.resolution.summary, 5000);
          if (!summary) return json({ error: "Resolution summary is required" }, 400);
          set.resolution = {
            summary,
            action_taken: textValue(b.resolution.action_taken, 5000),
            root_cause: textValue(b.resolution.root_cause, 5000),
            resolved_by: session.name,
            resolved_date: now,
          };
          set.status = "Resolved";
          markAcknowledged();
          markResolved();
          if (b.status !== "Resolved")
            await addHistory(
              db,
              ticketId,
              "status",
              session,
              "Resolved: " + summary,
              ticket.status,
              "Resolved",
            );
          await notify(
            db,
            requesterId(ticket),
            `Ticket ${ticket.human_id} resolved - please confirm`,
            ticket,
          );
        }
        const ticketUpdate = await db
          .collection("tickets")
          .updateOne(
            { id: ticketId, status: ticket.status },
            { $set: set },
          );
        if (!ticketUpdate.modifiedCount)
          return json(
            { error: "Ticket changed in another session; refresh and try again" },
            409,
          );
        await audit(db, session, "ticket.update", "ticket", ticketId, b);
        if (lifecycleChanged || b.priority) {
          try {
            await processSlaBreaches(db, true);
          } catch (error) {
            console.error("Ticket SLA processing failed:", error);
          }
        }
        const updated = await db
          .collection("tickets")
          .findOne({ id: ticketId });
        return json(clean(updated));
      }

      // comments
      if (seg[2] === "comments" && method === "POST") {
        const b = await request.json();
        const commentBody = textValue(b.body, 5000);
        if (!commentBody) return json({ error: "Comment cannot be empty" }, 400);
        let type = b.type || "public";
        if (!["public", "internal"].includes(type))
          return json({ error: "Invalid comment type" }, 400);
        if (session.role === "employee") type = "public";
        if (type === "internal" && session.role === "employee")
          return json({ error: "Forbidden" }, 403);
        const c = {
          id: uuidv4(),
          ticket_id: ticketId,
          type,
          body: commentBody,
          author_id: session.id,
          author_name: session.name,
          author_role: session.role,
          created_at: new Date(),
        };
        await db.collection("comments").insertOne(c);
        if (
          type === "public" &&
          session.role !== "employee" &&
          !ticket.first_response_at
        ) {
          await db.collection("tickets").updateOne(
            {
              id: ticketId,
              $or: [
                { first_response_at: { $exists: false } },
                { first_response_at: null },
              ],
            },
            {
              $set: {
                first_response_at: c.created_at,
                first_response_by_id: session.id,
                first_response_by_name: session.name,
                acknowledged_at: c.created_at,
                acknowledged_by_id: session.id,
                acknowledged_by_name: session.name,
                response_working_minutes: workingMinutesBetween(
                  ticket.raised_at || ticket.created_at,
                  c.created_at,
                ),
                "status_timestamps.acknowledged": c.created_at,
                updated_at: c.created_at,
              },
            },
          );
          try {
            await processSlaBreaches(db, true);
          } catch (error) {
            console.error("Comment SLA processing failed:", error);
          }
        }
        await addHistory(
          db,
          ticketId,
          "comment",
          session,
          `${type} comment added`,
        );
        // notify other party
        if (session.role === "employee") {
          const allStaff = await db
            .collection("users")
            .find({
              role: ticket.department === "Admin" ? "admin" : "it",
              active: { $ne: false },
            })
            .toArray();
          const staff = allStaff.filter((user) =>
            canAccessTicket(
              {
                ...user,
                is_team_head: Boolean(user.is_team_head),
                managed_locations: user.managed_locations || [],
              },
              ticket,
            ),
          );
          await notify(
            db,
            staff.map((u) => u.id),
            `New comment on ${ticket.human_id}`,
            ticket,
          );
        } else if (type === "public") {
          await notify(
            db,
            requesterId(ticket),
            `New response on ${ticket.human_id}`,
            ticket,
          );
        }
        return json(clean(c));
      }

      // Employee confirmation can move Resolved to Closed; terminal tickets
      // can never return to an active state.
      if (seg[2] === "confirm" && method === "POST") {
        if (requesterId(ticket) !== session.id && ticket.raised_by_id !== session.id)
          return json({ error: "Forbidden" }, 403);
        const b = await request.json();
        if (b.action !== "confirm")
          return json({ error: "Invalid confirmation action" }, 400);
        if (ticket.status !== "Resolved")
          return json({ error: "Only resolved tickets can be confirmed and closed" }, 400);
        const rating = Number(b.rating) || null;
        if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5))
          return json({ error: "Rating must be between 1 and 5" }, 400);
        const now = new Date();
        const closeResult = await db.collection("tickets").updateOne(
          { id: ticketId, status: "Resolved" },
          {
            $set: {
              status: "Closed",
              confirmation: {
                confirmed: true,
                rating,
                comment: textValue(b.comment, 2000),
                at: now,
              },
              closed_at: ticket.closed_at || now,
              closed_by_id: session.id,
              closed_by_name: session.name,
              lifecycle_working_minutes: workingMinutesBetween(
                ticket.raised_at || ticket.created_at,
                now,
              ),
              "status_timestamps.closed": now,
              updated_at: now,
            },
          },
        );
        if (!closeResult.modifiedCount)
          return json({ error: "Ticket is already final" }, 409);
        await addHistory(
          db,
          ticketId,
          "status",
          session,
          `Confirmed. Rating: ${rating || "n/a"}`,
          ticket.status,
          "Closed",
        );
        await notify(
          db,
          ticket.assignee_id,
          `Ticket ${ticket.human_id} confirmed & closed`,
          ticket,
        );
        await audit(db, session, "ticket.confirm", "ticket", ticketId, b);
        try {
          await processSlaBreaches(db, true);
        } catch (error) {
          console.error("Confirmation SLA processing failed:", error);
        }
        const updated = await db
          .collection("tickets")
          .findOne({ id: ticketId });
        return json(clean(updated));
      }

      // ---- APPROVAL: submit (IT or Admin, dept-scoped by object auth above) ----
      if (seg[2] === "approval" && seg[3] === "submit" && method === "POST") {
        if (TERMINAL_TICKET_STATUSES.includes(ticket.status))
          return json({ error: "Final tickets cannot enter approval again" }, 409);
        if (!["it", "admin"].includes(session.role))
          return json({ error: "Forbidden" }, 403);
        const b = await request.json();
        const approvalNow = new Date();
        const existing = await db
          .collection("approvals")
          .findOne({ ticket_id: ticketId });
        const pendingApprovalAttachments = await ownedPendingAttachments(
          db,
          b.attachment_ids,
          session,
        );
        const approvalAttachments = [
          ...(Array.isArray(existing?.attachments)
            ? existing.attachments.filter((item) => item?.id)
            : []),
          ...pendingApprovalAttachments.map(attachmentSummary),
        ].filter(
          (item, index, items) =>
            items.findIndex((candidate) => candidate.id === item.id) === index,
        );
        const apprData = {
          justification: b.justification || "",
          requested_amount: b.requested_amount || 0,
          vendor: b.vendor || "",
          quotation: b.quotation || "",
          alternatives: b.alternatives || "",
          recommendation: b.recommendation || "",
          required_by: b.required_by ? new Date(b.required_by) : null,
          risk: b.risk || "",
          attachments: approvalAttachments,
        };
        let approval;
        if (existing) {
          approval = existing;
          await db.collection("approvals").updateOne(
            { ticket_id: ticketId },
            {
              $set: { ...apprData, status: "Pending", updated_at: approvalNow },
              $push: {
                history: {
                  action: "resubmitted",
                  by: session.name,
                  at: approvalNow,
                  remarks: b.justification,
                },
              },
            },
          );
        } else {
          const ahid = await humanId(db, "APR");
          approval = {
            id: uuidv4(),
            human_id: ahid,
            ticket_id: ticketId,
            ...apprData,
            status: "Pending",
            approved_amount: null,
            decision_remarks: "",
            decided_by: null,
            history: [
              {
                action: "submitted",
                by: session.name,
                at: approvalNow,
                remarks: b.justification,
              },
            ],
            created_at: approvalNow,
            updated_at: approvalNow,
          };
          await db.collection("approvals").insertOne(approval);
        }
        await linkAttachments(
          db,
          pendingApprovalAttachments,
          "approval",
          approval.id,
          ticketId,
        );
        await db.collection("tickets").updateOne(
          { id: ticketId },
          {
            $set: {
              status: "Pending Super Admin Approval",
              approval_required: true,
              "status_timestamps.pending_super_admin_approval": approvalNow,
              updated_at: approvalNow,
            },
          },
        );
        await addHistory(
          db,
          ticketId,
          "approval",
          session,
          "Submitted for Super Admin approval",
          ticket.status,
          "Pending Super Admin Approval",
        );
        const supers = await db
          .collection("users")
          .find({ role: "super_admin" })
          .toArray();
        await notify(
          db,
          supers.map((u) => u.id),
          `Approval requested for ${ticket.human_id}`,
          ticket,
        );
        await audit(
          db,
          session,
          "approval.submit",
          "ticket",
          ticketId,
          apprData,
        );
        return json({ ok: true });
      }

      // ---- APPROVAL: decision (super admin) ----
      if (seg[2] === "approval" && seg[3] === "decision" && method === "POST") {
        if (TERMINAL_TICKET_STATUSES.includes(ticket.status))
          return json({ error: "Final tickets cannot be changed" }, 409);
        if (session.role !== "super_admin")
          return json({ error: "Forbidden" }, 403);
        const b = await request.json();
        const decision = b.decision; // approve | partial | reject | hold | clarify
        const remarksRequired = ["partial", "reject", "hold", "clarify"];
        if (remarksRequired.includes(decision) && !b.remarks)
          return json({ error: "Remarks required" }, 400);
        const map = {
          approve: { appr: "Approved", ticket: "Approved - Ready for Action" },
          partial: {
            appr: "Partially Approved",
            ticket: "Approved - Ready for Action",
          },
          reject: { appr: "Rejected", ticket: "Approval Rejected" },
          hold: { appr: "On Hold", ticket: "Approval On Hold" },
          clarify: { appr: "Clarification", ticket: "Clarification Required" },
        };
        const m = map[decision];
        if (!m) return json({ error: "Invalid decision" }, 400);
        const decisionNow = new Date();
        await db.collection("approvals").updateOne(
          { ticket_id: ticketId },
          {
            $set: {
              status: m.appr,
              approved_amount: b.approved_amount ?? null,
              decision_remarks: b.remarks || "",
              decided_by: session.name,
              updated_at: decisionNow,
            },
            $push: {
              history: {
                action: decision,
                by: session.name,
                at: decisionNow,
                remarks: b.remarks || "",
                approved_amount: b.approved_amount ?? null,
              },
            },
          },
        );
        await db
          .collection("tickets")
          .updateOne(
            { id: ticketId },
            {
              $set: {
                status: m.ticket,
                [`status_timestamps.${m.ticket
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "_")
                  .replace(/^_|_$/g, "")}`]: decisionNow,
                updated_at: decisionNow,
              },
            },
          );
        await addHistory(
          db,
          ticketId,
          "approval",
          session,
          `${decision.toUpperCase()}: ${b.remarks || ""}`,
          ticket.status,
          m.ticket,
        );
        await notify(
          db,
          ticket.assignee_id,
          `Approval ${m.appr} for ${ticket.human_id}`,
          ticket,
        );
        await audit(db, session, "approval.decision", "ticket", ticketId, {
          decision,
          ...b,
        });
        return json({ ok: true });
      }
    }

    // ---- TASKS ----
    if (route === "/tasks" && method === "GET") {
      if (!["admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const tasks = await db
        .collection("tasks")
        .find({})
        .sort({ created_at: -1 })
        .toArray();
      return json(clean(tasks));
    }
    if (route === "/tasks" && method === "POST") {
      if (session.role !== "admin") return json({ error: "Forbidden" }, 403);
      const b = await request.json();
      const hid = await humanId(db, "ATSK");
      const t = {
        id: uuidv4(),
        human_id: hid,
        title: b.title || "Untitled",
        category: b.category || "Facilities",
        location: b.location || "HQ1",
        recurrence: b.recurrence || "one-time",
        owner_id: session.id,
        owner_name: session.name,
        backup_owner_name: b.backup_owner_name || "",
        priority: b.priority || "Medium",
        due_date: b.due_date ? new Date(b.due_date) : new Date(),
        status: "Not Started",
        remarks: b.remarks || "",
        linked_approval: null,
        completion_proof: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      await db.collection("tasks").insertOne(t);
      await audit(db, session, "task.create", "task", t.id, { human_id: hid });
      return json(clean(t));
    }
    if (seg[0] === "tasks" && seg[1] && method === "PATCH") {
      if (session.role !== "admin") return json({ error: "Forbidden" }, 403);
      const b = await request.json();
      const set = { updated_at: new Date() };
      for (const k of ["status", "remarks", "priority", "completion_proof"])
        if (b[k] !== undefined) set[k] = b[k];
      await db.collection("tasks").updateOne({ id: seg[1] }, { $set: set });
      await audit(db, session, "task.update", "task", seg[1], b);
      return json(clean(await db.collection("tasks").findOne({ id: seg[1] })));
    }

    // ---- CHECKLISTS ----
    if (route === "/checklists/templates" && method === "GET") {
      if (!["admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      return json(
        clean(await db.collection("checklist_templates").find({}).toArray()),
      );
    }
    if (route === "/checklists/executions" && method === "GET") {
      if (!["admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      return json(
        clean(
          await db
            .collection("checklist_executions")
            .find({})
            .sort({ created_at: -1 })
            .toArray(),
        ),
      );
    }
    if (route === "/checklists/executions" && method === "POST") {
      if (session.role !== "admin") return json({ error: "Forbidden" }, 403);
      const b = await request.json();
      const tpl = await db
        .collection("checklist_templates")
        .findOne({ id: b.template_id });
      if (!tpl) return json({ error: "Template not found" }, 404);
      const hid = await humanId(
        db,
        "CHK",
        tpl.code ||
          (tpl.location || "")
            .replace(/[^A-Za-z0-9]/g, "")
            .toUpperCase()
            .slice(0, 4),
      );
      const exec = {
        id: uuidv4(),
        human_id: hid,
        template_id: tpl.id,
        template_name: tpl.name,
        location: tpl.location,
        date: new Date(),
        responses:
          b.responses ||
          tpl.items.map((it) => ({
            item: it.label,
            status: "Not Started",
            remarks: "",
          })),
        status: "In Progress",
        owner_name: session.name,
        created_at: new Date(),
        updated_at: new Date(),
      };
      await db.collection("checklist_executions").insertOne(exec);
      await audit(db, session, "checklist.create", "checklist", exec.id, {
        human_id: hid,
      });
      return json(clean(exec));
    }
    if (
      seg[0] === "checklists" &&
      seg[1] === "executions" &&
      seg[2] &&
      method === "PATCH"
    ) {
      if (session.role !== "admin") return json({ error: "Forbidden" }, 403);
      const b = await request.json();
      const set = { updated_at: new Date() };
      if (b.responses) set.responses = b.responses;
      if (b.status) set.status = b.status;
      await db
        .collection("checklist_executions")
        .updateOne({ id: seg[2] }, { $set: set });
      return json(
        clean(
          await db.collection("checklist_executions").findOne({ id: seg[2] }),
        ),
      );
    }
    // create ticket from checklist item
    if (
      seg[0] === "checklists" &&
      seg[1] === "to-ticket" &&
      method === "POST"
    ) {
      if (session.role !== "admin") return json({ error: "Forbidden" }, 403);
      const b = await request.json();
      const id = uuidv4();
      const hid = await humanId(db, "ADM");
      const t = {
        id,
        human_id: hid,
        department: "Admin",
        category: "Facilities",
        subcategory: "",
        title: `Checklist issue: ${b.item}`,
        description: b.remarks || "",
        priority: b.priority || "Medium",
        status: "Open",
        raised_by_id: session.id,
        raised_by_name: session.name,
        raised_for_name: session.name,
        employee_id: "",
        email: session.email,
        location: b.location || "HQ1",
        assignee_id: session.id,
        assignee_name: session.name,
        approval_required: false,
        legacy_id: null,
        source: "checklist",
        ...slaDates("Admin", b.priority || "Medium"),
        created_at: new Date(),
        updated_at: new Date(),
        resolution: null,
        confirmation: null,
      };
      await db.collection("tickets").insertOne(t);
      await addHistory(
        db,
        id,
        "created",
        session,
        `Created from checklist item: ${b.item}`,
        null,
        "Open",
      );
      await audit(db, session, "ticket.from_checklist", "ticket", id, {
        item: b.item,
      });
      return json(clean(t));
    }

    // ---- MEMBER CHECKLISTS (Super Admin defines; IT/Admin submit daily) ----
    if (route === "/member-checklists" && method === "GET") {
      const today = new Date().toISOString().slice(0, 10);
      let q = {};
      if (session.role === "super_admin") {
        const mid = new URL(request.url).searchParams.get("member_id");
        if (mid) q = { member_id: mid };
      } else if (["it", "admin"].includes(session.role)) {
        q = { member_id: session.id };
      } else {
        return json({ error: "Forbidden" }, 403);
      }
      const lists = await db.collection("member_checklists").find(q).toArray();
      // attach today's submission for member view
      const out = [];
      for (const l of lists) {
        const sub = await db
          .collection("member_checklist_submissions")
          .findOne({ checklist_id: l.id, date: today });
        out.push({ ...clean(l), today_submission: sub ? clean(sub) : null });
      }
      return json(out);
    }
    if (route === "/member-checklists" && method === "POST") {
      if (session.role !== "super_admin")
        return json({ error: "Forbidden" }, 403);
      const b = await request.json();
      const member = await db.collection("users").findOne({ id: b.member_id });
      if (!member) return json({ error: "Member not found" }, 400);
      const doc = {
        id: uuidv4(),
        member_id: member.id,
        member_name: member.name,
        member_role: member.role,
        location: b.location || member.location || "",
        title: b.title || "Daily Checklist",
        frequency: b.frequency || "daily",
        active: true,
        items: (b.items || [])
          .filter(Boolean)
          .map((label, i) => ({ key: `mc_${i}`, label })),
        created_by: session.name,
        created_at: new Date(),
      };
      await db.collection("member_checklists").insertOne(doc);
      await audit(
        db,
        session,
        "member_checklist.create",
        "member_checklist",
        doc.id,
        { member: member.name },
      );
      await notify(
        db,
        member.id,
        `New daily checklist assigned: ${doc.title}`,
        null,
      );
      return json(clean(doc));
    }
    if (route === "/member-checklists/remind-pending" && method === "POST") {
      if (session.role !== "super_admin")
        return json({ error: "Forbidden" }, 403);
      const today = new Date().toISOString().slice(0, 10);
      const lists = await db
        .collection("member_checklists")
        .find({ active: true })
        .toArray();
      const submissions = await db
        .collection("member_checklist_submissions")
        .find({ date: today })
        .toArray();
      const submittedIds = new Set(
        submissions.map((item) => item.checklist_id),
      );
      const pendingByMember = new Map();
      for (const list of lists) {
        if (!submittedIds.has(list.id))
          pendingByMember.set(
            list.member_id,
            (pendingByMember.get(list.member_id) || 0) + 1,
          );
      }
      for (const [memberId, count] of pendingByMember) {
        await notify(
          db,
          memberId,
          `Reminder: ${count} daily KRA checklist${count === 1 ? "" : "s"} pending for today`,
          null,
        );
      }
      await audit(
        db,
        session,
        "member_checklist.remind_pending",
        "member_checklist",
        today,
        { members: pendingByMember.size },
      );
      return json({ ok: true, reminded: pendingByMember.size });
    }
    if (
      seg[0] === "member-checklists" &&
      seg[1] &&
      seg[2] === "submit" &&
      method === "POST"
    ) {
      if (!["it", "admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const list = await db
        .collection("member_checklists")
        .findOne({ id: seg[1] });
      if (!list) return json({ error: "Not found" }, 404);
      if (list.member_id !== session.id)
        return json({ error: "Forbidden" }, 403);
      const b = await request.json();
      const date = b.date || new Date().toISOString().slice(0, 10);
      const responses = b.responses || [];
      const doneCount = responses.filter((r) => r.done).length;
      const status =
        doneCount === responses.length && responses.length > 0
          ? "Completed"
          : "Partial";
      const existing = await db
        .collection("member_checklist_submissions")
        .findOne({ checklist_id: list.id, date });
      const payload = {
        checklist_id: list.id,
        checklist_title: list.title,
        member_id: session.id,
        member_name: session.name,
        date,
        responses,
        done_count: doneCount,
        total: responses.length,
        status,
        submitted_at: new Date(),
      };
      if (existing)
        await db
          .collection("member_checklist_submissions")
          .updateOne({ id: existing.id }, { $set: payload });
      else
        await db
          .collection("member_checklist_submissions")
          .insertOne({ id: uuidv4(), ...payload, created_at: new Date() });
      await audit(
        db,
        session,
        "member_checklist.submit",
        "member_checklist",
        list.id,
        { date, status },
      );
      return json({
        ok: true,
        status,
        done_count: doneCount,
        total: responses.length,
      });
    }
    if (seg[0] === "member-checklists" && seg[1] && method === "DELETE") {
      if (session.role !== "super_admin")
        return json({ error: "Forbidden" }, 403);
      await db.collection("member_checklists").deleteOne({ id: seg[1] });
      return json({ ok: true });
    }
    if (route === "/member-checklist-submissions" && method === "GET") {
      const p = new URL(request.url).searchParams;
      const q = {};
      if (session.role === "super_admin") {
        if (p.get("member_id")) q.member_id = p.get("member_id");
      } else if (["it", "admin"].includes(session.role)) {
        q.member_id = session.id; // members see only their own records
      } else {
        return json({ error: "Forbidden" }, 403);
      }
      if (p.get("date")) q.date = p.get("date");
      const items = await db
        .collection("member_checklist_submissions")
        .find(q)
        .sort({ date: -1, submitted_at: -1 })
        .limit(200)
        .toArray();
      return json(clean(items));
    }

    // ---- DAILY KRA COMPLIANCE (Super Admin dashboard) ----
    if (route === "/reports/daily-kra" && method === "GET") {
      if (session.role !== "super_admin")
        return json({ error: "Forbidden" }, 403);
      const date =
        new URL(request.url).searchParams.get("date") ||
        new Date().toISOString().slice(0, 10);
      const lists = await db
        .collection("member_checklists")
        .find({ active: true })
        .toArray();
      const subs = await db
        .collection("member_checklist_submissions")
        .find({ date })
        .toArray();
      const byMember = {};
      for (const l of lists) {
        const m = (byMember[l.member_id] = byMember[l.member_id] || {
          member_id: l.member_id,
          member_name: l.member_name,
          member_role: l.member_role,
          total_lists: 0,
          total_items: 0,
          done_items: 0,
          submitted_lists: 0,
        });
        m.total_lists += 1;
        m.total_items += (l.items || []).length;
      }
      for (const s of subs) {
        const m = byMember[s.member_id];
        if (!m) continue;
        m.submitted_lists += 1;
        m.done_items += s.done_count || 0;
      }
      const members = Object.values(byMember).map((m) => {
        let status = "Not Submitted";
        if (m.submitted_lists > 0)
          status =
            m.submitted_lists >= m.total_lists && m.done_items >= m.total_items
              ? "Completed"
              : "Partial";
        return {
          ...m,
          status,
          compliant: status === "Completed",
          pct: m.total_items
            ? Math.round((m.done_items / m.total_items) * 100)
            : 0,
        };
      });
      return json({ date, members });
    }

    // ---- NOTIFICATIONS ----
    if (route === "/notifications" && method === "GET") {
      const items = await db
        .collection("notifications")
        .find({ user_id: session.id })
        .sort({ created_at: -1 })
        .limit(50)
        .toArray();
      return json(clean(items));
    }
    if (route === "/notifications/read" && method === "POST") {
      await db
        .collection("notifications")
        .updateMany({ user_id: session.id }, { $set: { read: true } });
      return json({ ok: true });
    }

    // ---- AUDIT ----
    if (route === "/audit" && method === "GET") {
      if (session.role !== "super_admin")
        return json({ error: "Forbidden" }, 403);
      const items = await db
        .collection("audit_logs")
        .find({})
        .sort({ created_at: -1 })
        .limit(300)
        .toArray();
      return json(clean(items));
    }

    return json({ error: `Route ${route} not found` }, 404);
  } catch (error) {
    if (error?.statusCode)
      return json({ error: error.message }, error.statusCode);
    console.error("API Error:", error);
    return json({ error: "Internal server error" }, 500);
  }
}

export const GET = handleRoute;
export const POST = handleRoute;
export const PUT = handleRoute;
export const DELETE = handleRoute;
export const PATCH = handleRoute;

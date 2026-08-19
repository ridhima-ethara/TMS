import { connectToPostgres } from "@/lib/postgres-document-db";
import { v4 as uuidv4 } from "uuid";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import ExcelJS from "exceljs";
import { SignJWT, jwtVerify } from "jose";
import { request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
import { readFileSync } from "node:fs";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
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
        db.collection("login_otp_challenges").createIndex(
          { id: 1 },
          { unique: true },
        ),
        db.collection("login_otp_challenges").createIndex({
          user_id: 1,
          expires_at: -1,
        }),
        db.collection("kra_escalations").createIndex(
          { checklist_id: 1, date: 1 },
          { unique: true },
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
      await ensureKraDefaults(db);
      await migrateTicketSlaData(db);
      startSlaMonitor(db);
      startEmailDeliveryMonitor(db);
      startFirewallHealthMonitor(db);
      startFirewallArchiveMonitor(db);
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

const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

// Hosts that cannot be reached from the public internet. Plaintext HTTP is
// acceptable to these because there is no untrusted network in between; the
// rule exists to stop a public hostname being served over http.
function isPrivateHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTNAMES.has(host) || host === "::1") return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd"))
    return true;
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part)))
    return false;
  const [a, b] = parts.map(Number);
  if (parts.some((part) => Number(part) > 255)) return false;
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

// PUBLIC_APP_URL anchors email verification links and the cross-site mutation
// allowlist, so a wrong or plaintext value is a security problem rather than a
// cosmetic one. Resolve it once and report the failure instead of throwing, so
// callers can decide between "reject the request" and "fail the operation".
let publicAppOriginResult;
function resolvePublicAppOrigin() {
  if (publicAppOriginResult) return publicAppOriginResult;
  const production = process.env.NODE_ENV === "production";
  const configured = String(process.env.PUBLIC_APP_URL || "").trim();
  if (!configured) {
    publicAppOriginResult = production
      ? { error: "PUBLIC_APP_URL must be configured in production" }
      : { origin: null };
    return publicAppOriginResult;
  }
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    publicAppOriginResult = {
      error:
        "PUBLIC_APP_URL must be an absolute URL, for example https://tms.example.com",
    };
    return publicAppOriginResult;
  }
  // http:// is permitted only for a host that is not routable from the public
  // internet (loopback or a private LAN address). Over a real hostname it would
  // send verification links over plaintext and add a spoofable origin to the
  // CSRF allowlist. The check deliberately keys on the host rather than
  // NODE_ENV, because the standalone server always reports production -- so an
  // environment test would reject `npm start` against http://localhost.
  if (parsed.protocol !== "https:" && !isPrivateHostname(parsed.hostname)) {
    publicAppOriginResult = {
      error:
        "PUBLIC_APP_URL must use https:// for a publicly routable host",
    };
    return publicAppOriginResult;
  }
  publicAppOriginResult = { origin: parsed.origin };
  return publicAppOriginResult;
}

function publicAppOrigin(request) {
  const resolved = resolvePublicAppOrigin();
  if (resolved.error) throw new Error(resolved.error);
  return resolved.origin || new URL(request.url).origin;
}

// ---------------- helpers ----------------
function json(data, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function sessionCookieSecure() {
  if (process.env.SESSION_COOKIE_SECURE === "false") return false;
  if (process.env.SESSION_COOKIE_SECURE === "true") return true;
  return process.env.NODE_ENV === "production";
}

function requestClientAddress(request) {
  // Forwarded headers are attacker-controlled unless the deployment explicitly
  // confirms that a trusted reverse proxy replaces them.
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = request.headers.get("x-forwarded-for");
    const address = forwarded?.split(",")[0]?.trim();
    if (address) return address;
  }
  return request.ip || "local";
}

function requestRateLimitKey(scope, request, identity = "") {
  const ip = requestClientAddress(request);
  return createHash("sha256")
    .update(`${scope}:${ip}:${identity}`)
    .digest("hex");
}
async function loginRateLimited(db, request, email) {
  const result = await db.consumeRateLimit(
    requestRateLimitKey("login", request, email),
    8,
    15 * 60_000,
  );
  return result.limited;
}
async function clearLoginAttempts(db, request, email) {
  await db.clearRateLimit(requestRateLimitKey("login", request, email));
}

function rejectsCrossSiteMutation(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin]);
  if (process.env.TRUST_PROXY === "true") {
    const forwardedHost = request.headers.get("x-forwarded-host");
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    if (forwardedHost && forwardedProtocol)
      allowed.add(`${forwardedProtocol}://${forwardedHost}`);
  }
  const configuredOrigin = resolvePublicAppOrigin();
  // A misconfigured public origin cannot be trusted to authorise a mutation.
  if (configuredOrigin.error) return true;
  if (configuredOrigin.origin) allowed.add(configuredOrigin.origin);
  // Accept the address the browser actually connected to. A cross-site attacker
  // controls neither header pair: the browser sets Host to this server and
  // Origin to the attacker's site, so they only match for a page this server
  // served. Without this, reaching the app on any address other than the one
  // baked into PUBLIC_APP_URL (a LAN IP, or plain 127.0.0.1) rejects every
  // mutation.
  const hostHeader = request.headers.get("host");
  if (hostHeader) {
    try {
      const scheme = new URL(request.url).protocol;
      allowed.add(new URL(`${scheme}//${hostHeader}`).origin);
    } catch {
      // A malformed Host header simply contributes no allowed origin.
    }
  }
  try {
    return !allowed.has(new URL(origin).origin);
  } catch {
    return true;
  }
}

function requestBodyTooLarge(request, route) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength <= 0) return false;
  const limit =
    route === "/attachments"
      ? 27 * 1024 * 1024
      : route === "/member-checklists/import-preview"
        ? 5 * 1024 * 1024
        : 1024 * 1024;
  return contentLength > limit;
}

function sessionVersionMatches(user, tokenSession) {
  return (
    Number(user?.session_version || 0) ===
    Number(tokenSession?.session_version || 0)
  );
}

function demoLoginAllowed(request) {
  if (process.env.ALLOW_DEMO_LOGIN !== "true") return false;
  if (process.env.ALLOW_DEMO_LOGIN_REMOTE === "true") return true;
  try {
    const loopback = LOOPBACK_HOSTNAMES;
    const requestHostname = new URL(request.url).hostname.toLowerCase();
    const hostHeader = String(request.headers.get("host") || "").toLowerCase();
    const headerHostname = hostHeader.startsWith("[")
      ? hostHeader.slice(0, hostHeader.indexOf("]") + 1)
      : hostHeader.split(":")[0];
    return loopback.has(requestHostname) && loopback.has(headerHostname);
  } catch {
    return false;
  }
}

function localFirewallProfileBlocks() {
  // The original local setup contains two legacy FIREWALL_* blocks. Do not
  // cache a failed read: the standalone process can start before its working
  // directory/environment file is available, and caching [] would silently
  // make both location tabs fall back to the same generic process variables.
  const candidates = [
    process.env.FIREWALL_ENV_PATH,
    `${process.cwd()}/.env.local`,
    `${process.cwd()}/../../.env.local`,
  ].filter(Boolean);
  for (const path of [...new Set(candidates)]) {
    try {
      const profiles = [];
      let current = null;
      const lines = readFileSync(path, "utf8").split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^(FIREWALL_[A-Z0-9_]+)=(.*)$/);
        if (!match) continue;
        if (match[1] === "FIREWALL_API_URL") {
          current = {};
          profiles.push(current);
        }
        if (current) current[match[1].replace(/^FIREWALL_/, "")] = match[2];
      }
      if (profiles.length) return profiles;
    } catch {
      // Try the next deployment-safe location.
    }
  }
  return [];
}

function firewallProfile(request) {
  const requested =
    (typeof request === "string"
      ? request
      : new URL(request.url).searchParams.get("firewall")) === "hq"
      ? "hq"
      : "hq2";
  const localFirewallProfiles = localFirewallProfileBlocks();
  const localIndex = requested === "hq" ? 1 : 0;
  const local = localFirewallProfiles[localIndex] || {};
  const sharedLegacyDefaults = localFirewallProfiles[0] || {};
  const prefix = requested === "hq" ? "FIREWALL_HQ_" : "FIREWALL_HQ2_";
  const locationCredentialKeys = new Set([
    "API_URL",
    "API_KEY",
    "CA_CERT_PATH",
    "CERT_SHA256",
  ]);
  const value = (key, fallback = "") => {
    const explicit = process.env[`${prefix}${key}`];
    if (explicit) return explicit;
    if (local[key]) return local[key];
    // Credentials and appliance identity must never fall through to the other
    // location. A missing profile is safer as "unconfigured" than mislabeled
    // live data from HQ or HQ2.
    if (locationCredentialKeys.has(key)) return fallback;
    return (
      sharedLegacyDefaults[key] ||
      process.env[`FIREWALL_${key}`] ||
      fallback
    );
  };
  return { id: requested, label: requested === "hq" ? "HQ" : "HQ2", value };
}

function firewallDisplayName(profile) {
  const configured = String(profile.value("NAME", "")).trim();
  return !configured || /^(?:primary\s+)?firewall(?:\s+name)?$/i.test(configured)
    ? `${profile.label} Firewall`
    : configured;
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
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("Unsupported firewall API protocol");
  const isHttps = target.protocol === "https:";
  const allowSelfSigned = tls.allowSelfSigned === true;
  const caPath = tls.caPath;
  const certSha256 = tls.certSha256;
  if (allowSelfSigned && process.env.NODE_ENV === "production")
    throw new Error("Self-signed firewall certificate bypass is disabled in production");
  const configuredMaxBytes = Number(
    process.env.FIREWALL_MAX_RESPONSE_BYTES || 25 * 1024 * 1024,
  );
  const maxResponseBytes = Number.isFinite(configuredMaxBytes)
    ? Math.min(100 * 1024 * 1024, Math.max(1024 * 1024, configuredMaxBytes))
    : 25 * 1024 * 1024;
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
        let responseBytes = 0;
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBytes += Buffer.byteLength(chunk);
          if (responseBytes > maxResponseBytes) {
            request.destroy(
              new Error("Firewall response exceeded the configured size limit"),
            );
            return;
          }
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

async function firewallPaginatedRequest(
  url,
  headers,
  tls = {},
  { pageSize = 10000, maxRows = 100000 } = {},
) {
  const target = new URL(url);
  const safePageSize = Math.min(10000, Math.max(100, Number(pageSize) || 10000));
  const safeMaxRows = Math.min(250000, Math.max(safePageSize, Number(maxRows) || 100000));
  target.searchParams.set("rows", String(safePageSize));
  target.searchParams.set("start", "0");
  let firstPayload = null;
  let start = 0;
  let totalLines = 0;
  let pages = 0;
  let rawRowsFetched = 0;
  let searchSession = "";
  let stopReason = "row_limit";
  let lastStart = start;
  let lastNextIndex = null;
  let lastPageRows = 0;
  const merged = [];
  const fingerprints = new Set();
  while (rawRowsFetched < safeMaxRows) {
    target.searchParams.set("start", String(start));
    if (searchSession)
      target.searchParams.set("session_id", searchSession);
    const payload = await firewallRequest(target.toString(), headers, tls);
    if (!firstPayload) {
      firstPayload = payload;
      if (payload?.session_id !== undefined && payload?.session_id !== null)
        searchSession = String(payload.session_id);
    }
    const page = firewallRows(payload);
    pages += 1;
    rawRowsFetched += page.length;
    lastStart = start;
    lastPageRows = page.length;
    lastNextIndex = payload?.next_idx ?? null;
    totalLines = Math.max(
      totalLines,
      Number(payload?.total_lines || payload?.matched_count || payload?.size || 0),
    );
    for (const row of page) {
      const fingerprint = [
        row?.eventtime,
        row?.logid,
        row?.sessionid,
        row?.date,
        row?.time,
        row?.srcip,
        row?.dstip,
        row?.sentbyte,
        row?.rcvdbyte,
      ].join("|");
      if (!fingerprints.has(fingerprint)) {
        fingerprints.add(fingerprint);
        merged.push(row);
      }
      if (merged.length >= safeMaxRows) break;
    }
    if (!page.length) {
      stopReason = "empty_page";
      break;
    }
    if (totalLines && rawRowsFetched >= totalLines) {
      stopReason = "source_exhausted";
      break;
    }
    const nextStart = Number(payload?.next_idx);
    const candidate =
      Number.isFinite(nextStart) && nextStart > start
        ? nextStart
        : start + page.length;
    if (candidate <= start) {
      stopReason = "non_advancing_cursor";
      break;
    }
    start = candidate;
  }
  const expectedRows = totalLines || merged.length;
  return {
    ...(firstPayload || {}),
    results: merged,
    start: 0,
    total_lines: expectedRows,
    rows_returned: merged.length,
    raw_rows_fetched: rawRowsFetched,
    duplicate_rows_removed: Math.max(0, rawRowsFetched - merged.length),
    pages_fetched: pages,
    pagination_stop_reason: stopReason,
    pagination_last_start: lastStart,
    pagination_last_next_idx: lastNextIndex,
    pagination_last_page_rows: lastPageRows,
    search_session_pinned: Boolean(searchSession),
    pagination_complete: rawRowsFetched >= expectedRows,
    row_limit_reached: rawRowsFetched >= safeMaxRows && rawRowsFetched < expectedRows,
  };
}

function firewallSectionMetadata(payload, path, fetchedAt) {
  const recordsReturned = firewallRows(payload).length;
  const recordsAvailable = Number(
    payload?.total_lines || payload?.matched_count || payload?.size || recordsReturned,
  );
  return {
    source: "firewall_api",
    path: String(path || "").split("?")[0],
    fetched_at: fetchedAt.toISOString(),
    vendor_status: payload?.status || "success",
    records_returned: recordsReturned,
    records_available: recordsAvailable,
    complete:
      payload?.pagination_complete !== undefined
        ? Boolean(payload.pagination_complete)
        : recordsReturned >= recordsAvailable,
    pages_fetched: Number(payload?.pages_fetched || 1),
    raw_rows_fetched: Number(payload?.raw_rows_fetched || recordsReturned),
    duplicate_rows_removed: Number(payload?.duplicate_rows_removed || 0),
    pagination_stop_reason: payload?.pagination_stop_reason || null,
    pagination_last_start: payload?.pagination_last_start ?? null,
    pagination_last_next_idx: payload?.pagination_last_next_idx ?? null,
    pagination_last_page_rows: payload?.pagination_last_page_rows ?? null,
    search_session_pinned: Boolean(payload?.search_session_pinned),
    row_limit_reached: Boolean(payload?.row_limit_reached),
    appliance_serial: payload?.serial || null,
    firmware: payload?.version || null,
    build: payload?.build ?? null,
  };
}

const FIREWALL_HEALTH_MONITOR_KEY = Symbol.for(
  "ticketflow.firewallHealthMonitor",
);
const FIREWALL_ARCHIVE_MONITOR_KEY = Symbol.for(
  "ticketflow.firewallArchiveMonitor",
);
const FIREWALL_ARCHIVE_SYNCS_KEY = Symbol.for(
  "ticketflow.firewallArchiveSyncs",
);
const FIREWALL_ARCHIVE_WRITES_KEY = Symbol.for(
  "ticketflow.firewallArchiveWrites",
);
const FIREWALL_BANDWIDTH_CACHE_KEY = Symbol.for(
  "ticketflow.firewallBandwidthCache",
);
const FIREWALL_OVERVIEW_CACHE_KEY = Symbol.for(
  "ticketflow.firewallOverviewCache",
);
const FIREWALL_OVERVIEW_INFLIGHT_KEY = Symbol.for(
  "ticketflow.firewallOverviewInflight",
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
  if (state === "degraded")
    void syncFirewallArchiveSnapshot(db, profile.id, {
      reason: "degraded_pre_downtime",
    }).catch((error) =>
      console.error(`${profile.label} pre-downtime archive failed:`, error),
    );
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

async function syncFirewallArchiveSnapshot(
  db,
  firewallId,
  { reason = "scheduled" } = {},
) {
  if (!globalThis[FIREWALL_ARCHIVE_SYNCS_KEY])
    globalThis[FIREWALL_ARCHIVE_SYNCS_KEY] = new Map();
  const active = globalThis[FIREWALL_ARCHIVE_SYNCS_KEY];
  if (active.has(firewallId)) return active.get(firewallId);

  const task = (async () => {
    const profile = firewallProfile(firewallId);
    const fw = profile.value;
    const baseUrl = String(fw("API_URL")).replace(/\/$/, "");
    const apiKey = fw("API_KEY");
    if (!baseUrl || !apiKey)
      return { skipped: true, reason: "unconfigured" };
    const basePath = fw("REPORT_PATH", fw("LOGS_PATH", "/api/logs"));
    const endpoint = `${baseUrl}${basePath.startsWith("/") ? basePath : `/${basePath}`}`;
    const configuredPageRows = Number(
      fw("ARCHIVE_PAGE_ROWS", fw("REPORT_ROWS", "10000")),
    );
    const pageSize = Number.isFinite(configuredPageRows)
      ? Math.min(10000, Math.max(100, Math.round(configuredPageRows)))
      : 10000;
    const configuredMaxRows = Number(fw("ARCHIVE_SYNC_MAX_ROWS", "100000"));
    const maxRows = Number.isFinite(configuredMaxRows)
      ? Math.min(250000, Math.max(pageSize, Math.round(configuredMaxRows)))
      : 100000;
    const headerName = fw("API_HEADER", "Authorization");
    const prefix = fw("API_PREFIX", "Bearer");
    const payload = await firewallPaginatedRequest(
      endpoint,
      {
        Accept: "application/json",
        [headerName]: prefix ? `${prefix} ${apiKey}` : apiKey,
      },
      {
        allowSelfSigned: fw("ALLOW_SELF_SIGNED", "false") === "true",
        caPath: fw("CA_CERT_PATH", ""),
        certSha256: fw("CERT_SHA256", ""),
      },
      { pageSize, maxRows },
    );
    const rawRows = firewallRows(payload);
    const inventory = await mapFirewallInventory(
      rawRows.map((row) => ({
        ...row,
        appliance_serial: payload?.serial || "",
      })),
    );
    const capturedAt = new Date();
    const archive = await archiveFirewallRecords(
      db,
      profile,
      firewallDisplayName(profile),
      inventory.devices,
      capturedAt,
      {
        captureReason: reason,
        sourceComplete: Boolean(payload?.pagination_complete),
        sourceRowsFetched: Number(payload?.raw_rows_fetched || rawRows.length),
        sourceRowsAvailable: Number(payload?.total_lines || rawRows.length),
        sourcePagesFetched: Number(payload?.pages_fetched || 1),
        applianceSerial: payload?.serial || "",
      },
    );
    await db.collection("firewall_health").updateOne(
      { firewall_id: profile.id },
      {
        $set: {
          last_archive_at: capturedAt,
          last_archive_reason: reason,
          last_archive_records: inventory.devices.length,
          last_archive_source_complete: Boolean(payload?.pagination_complete),
          last_archive_error: null,
          updated_at: capturedAt,
        },
      },
    );
    return { ...archive, source_complete: Boolean(payload?.pagination_complete) };
  })();
  active.set(firewallId, task);
  try {
    return await task;
  } catch (error) {
    const profile = firewallProfile(firewallId);
    await db.collection("firewall_health").updateOne(
      { firewall_id: profile.id },
      {
        $set: {
          last_archive_error: error.message || "Archive collection failed",
          last_archive_error_at: new Date(),
          updated_at: new Date(),
        },
      },
    );
    throw error;
  } finally {
    active.delete(firewallId);
  }
}

function startFirewallArchiveMonitor(db) {
  if (
    process.env.NODE_ENV === "test" ||
    globalThis[FIREWALL_ARCHIVE_MONITOR_KEY]
  )
    return;
  const configuredInterval = Number(
    process.env.FIREWALL_ARCHIVE_INTERVAL_MS || 15 * 60_000,
  );
  const intervalMs = Number.isFinite(configuredInterval)
    ? Math.min(24 * 60 * 60_000, Math.max(5 * 60_000, configuredInterval))
    : 15 * 60_000;
  const configuredInitialDelay = Number(
    process.env.FIREWALL_ARCHIVE_INITIAL_DELAY_MS || 30_000,
  );
  const initialDelayMs = Number.isFinite(configuredInitialDelay)
    ? Math.min(intervalMs, Math.max(5_000, configuredInitialDelay))
    : 30_000;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      // Run sequentially so two location profiles never overload an appliance.
      for (const firewallId of ["hq", "hq2"]) {
        try {
          await syncFirewallArchiveSnapshot(db, firewallId, {
            reason: "scheduled",
          });
        } catch (error) {
          console.error(`${firewallId.toUpperCase()} archive monitor failed:`, error);
        }
      }
    } finally {
      running = false;
    }
  };
  const initialTimer = setTimeout(() => void run(), initialDelayMs);
  const timer = setInterval(() => void run(), intervalMs);
  initialTimer.unref?.();
  timer.unref?.();
  globalThis[FIREWALL_ARCHIVE_MONITOR_KEY] = {
    timer,
    initialTimer,
    intervalMs,
  };
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
  const active = found
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
        !/(expired|inactive|released|offline|conflict|declined)/.test(state) &&
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
  const unique = new Map();
  for (const lease of active) {
    const mac = normalizeMac(lease.mac);
    const ip = String(lease.ipv4_address || "").trim();
    const detectedInterface = String(lease.detected_interface || "").trim();
    const key = mac || (ip ? `ip:${ip}` : "");
    if (!key) continue;
    const current = unique.get(key);
    if (!current) {
      unique.set(key, {
        ...lease,
        ip_addresses: ip ? [ip] : [],
        online_interfaces: detectedInterface ? [detectedInterface] : [],
      });
      continue;
    }
    const ipAddresses = [
      ...new Set([...(current.ip_addresses || []), ip].filter(Boolean)),
    ];
    const onlineInterfaces = [
      ...new Set(
        [...(current.online_interfaces || []), detectedInterface].filter(
          Boolean,
        ),
      ),
    ];
    const currentExpiry = Date.parse(current.lease_expires_at || "") || 0;
    const leaseExpiry = Date.parse(lease.lease_expires_at || "") || 0;
    unique.set(key, {
      ...(leaseExpiry > currentExpiry ? lease : current),
      ip_addresses: ipAddresses,
      online_interfaces: onlineInterfaces,
    });
  }
  return [...unique.values()];
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

function firewallApplicationName(row) {
  return String(row?.app || row?.appname || row?.application || "").trim();
}

function firewallApplicationMatchKeys(row) {
  const sessionId = String(row?.sessionid || row?.session_id || "").trim();
  const sourceIp = String(row?.srcip || row?.source_ip || "").trim();
  const destinationIp = String(row?.dstip || row?.destination_ip || "").trim();
  const sourcePort = String(row?.srcport || row?.source_port || "").trim();
  const destinationPort = String(
    row?.dstport || row?.destination_port || "",
  ).trim();
  const protocol = String(row?.proto || row?.protocol || "").trim();
  return [
    sessionId && sourceIp && destinationIp
      ? `session:${sessionId}|${sourceIp}|${destinationIp}`
      : "",
    sessionId ? `session:${sessionId}` : "",
    sourceIp && destinationIp && destinationPort
      ? `flow:${sourceIp}|${destinationIp}|${sourcePort}|${destinationPort}|${protocol}`
      : "",
  ].filter(Boolean);
}

function firewallApplicationCandidateScore(row) {
  const name = firewallApplicationName(row);
  const category = String(row?.appcat || row?.category || "").trim();
  const risk = String(row?.apprisk || row?.application_risk || "").trim();
  let score = /unknown application/i.test(name) ? 0 : 10;
  if (category && !/^(unknown|unscanned|unclassified)$/i.test(category))
    score += 4;
  if (risk && !/^unknown$/i.test(risk)) score += 2;
  if (!/^(ssl|http|https)$/i.test(name)) score += 1;
  return score;
}

function enrichFirewallTrafficApplications(trafficRows, applicationRows) {
  const applicationIndex = new Map();
  for (const row of applicationRows) {
    if (!firewallApplicationName(row)) continue;
    for (const key of firewallApplicationMatchKeys(row)) {
      if (!applicationIndex.has(key)) applicationIndex.set(key, []);
      applicationIndex.get(key).push(row);
    }
  }
  let matchedTrafficRecords = 0;
  const matchedApplicationEvents = new Set();
  const records = trafficRows.map((trafficRow) => {
    const candidates = [];
    const seen = new Set();
    for (const key of firewallApplicationMatchKeys(trafficRow)) {
      for (const candidate of applicationIndex.get(key) || []) {
        const fingerprint = [
          candidate.eventtime,
          candidate.logid,
          candidate.sessionid,
          candidate.app,
          candidate.srcip,
          candidate.dstip,
        ].join("|");
        if (!seen.has(fingerprint)) {
          seen.add(fingerprint);
          candidates.push({ candidate, fingerprint });
        }
      }
      if (candidates.length) break;
    }
    if (!candidates.length) return trafficRow;
    candidates.sort(
      (left, right) =>
        firewallApplicationCandidateScore(right.candidate) -
          firewallApplicationCandidateScore(left.candidate) ||
        Number(right.candidate.eventtime || 0) -
          Number(left.candidate.eventtime || 0),
    );
    const selected = candidates[0].candidate;
    candidates.forEach(({ fingerprint }) =>
      matchedApplicationEvents.add(fingerprint),
    );
    matchedTrafficRecords += 1;
    const application = firewallApplicationName(selected);
    const identified = !/^unknown application$/i.test(application);
    return {
      ...trafficRow,
      ...(identified ? { app: application, appname: application } : {}),
      appcat:
        selected.appcat || selected.category || trafficRow.appcat || "",
      apprisk: selected.apprisk || selected.application_risk || "",
      application_action: selected.action || "",
      application_identified: identified,
      application_source: "fortigate_application_control",
      application_event_count: candidates.length,
      application_log_time:
        firewallRecordTime(selected)?.toISOString() || null,
    };
  });
  const identifiedRows = applicationRows.filter(
    (row) =>
      firewallApplicationName(row) &&
      !/^unknown application$/i.test(firewallApplicationName(row)),
  );
  return {
    records,
    summary: {
      source: "fortigate_application_control_log",
      events: applicationRows.length,
      identified_events: identifiedRows.length,
      matched_traffic_records: matchedTrafficRecords,
      matched_application_events: matchedApplicationEvents.size,
      unmatched_application_events: Math.max(
        0,
        applicationRows.length - matchedApplicationEvents.size,
      ),
      unique_applications: new Set(
        identifiedRows.map(firewallApplicationName).filter(Boolean),
      ).size,
      categories: [
        ...new Set(
          identifiedRows
            .map((row) => row.appcat || row.category)
            .filter(Boolean),
        ),
      ].sort(),
      risks: [
        ...new Set(
          identifiedRows
            .map((row) => row.apprisk || row.application_risk)
            .filter(Boolean),
        ),
      ].sort(),
    },
  };
}

function firewallApplicationRetentionSummary(rows) {
  const applications = new Map();
  const timestamps = [];
  for (const row of rows) {
    const name = firewallApplicationName(row);
    if (!name || /^unknown application$/i.test(name)) continue;
    const timestamp = firewallRecordTime(row);
    if (timestamp) timestamps.push(timestamp);
    const current = applications.get(name) || {
      name,
      category: String(row.appcat || row.category || "Unknown"),
      risk: String(row.apprisk || row.application_risk || "Unknown"),
      events: 0,
      sourceSystems: new Set(),
      destinations: new Set(),
      lastSeen: null,
    };
    current.events += 1;
    if (row.srcip) current.sourceSystems.add(String(row.srcip));
    if (row.dstip) current.destinations.add(String(row.dstip));
    if (timestamp && (!current.lastSeen || timestamp > current.lastSeen))
      current.lastSeen = timestamp;
    applications.set(name, current);
  }
  timestamps.sort((left, right) => left - right);
  return {
    retained_events: rows.length,
    retained_identified_applications: applications.size,
    retained_period: timestamps.length
      ? {
          start: timestamps[0].toISOString(),
          end: timestamps.at(-1).toISOString(),
        }
      : null,
    retained_applications: [...applications.values()]
      .sort(
        (left, right) =>
          right.events - left.events || left.name.localeCompare(right.name),
      )
      .slice(0, 40)
      .map((application) => ({
        name: application.name,
        category: application.category,
        risk: application.risk,
        events: application.events,
        source_systems: application.sourceSystems.size,
        destinations: application.destinations.size,
        last_seen: application.lastSeen?.toISOString() || null,
      })),
  };
}

function normalizedFirewallRecord(row) {
  const timestamp = firewallRecordTime(row);
  if (!timestamp) return null;
  const explicitApplication = firewallApplicationName(row);
  const service = String(row.service || "").trim();
  const applicationIdentified =
    row.application_identified !== undefined
      ? Boolean(row.application_identified)
      : Boolean(
          row.app ||
            row.appname ||
            (row.application && row.application !== row.service),
        );
  return {
    record_id:
      row.record_id ||
      [row.logid, row.sessionid, row.eventtime].filter(Boolean).join(":") ||
      "",
    appliance_serial: row.appliance_serial || row.serial || "",
    timestamp: timestamp.toISOString(),
    source_ip: row.srcip || row.source_ip || row.ip || "",
    source_mac:
      row.srcmac || row.source_mac || row.mastersrcmac || row.mac || "",
    source_name:
      row.srcname || row.source_name || row.hostname || row.asset_user_name || "",
    source_device_type:
      row.srcdevtype ||
      row.devtype ||
      row.source_device_type ||
      row.device_type ||
      "",
    source_os_name:
      row.srcosname || row.osname || row.source_os_name || row.os_name || "",
    source_vendor:
      row.srchwvendor || row.source_vendor || row.hardware_vendor || row.vendor || "",
    asset_user_name: row.asset_user_name || "",
    employee_code: row.employee_code || "",
    asset_email: row.asset_email || "",
    av_status: row.av_status || "Unknown",
    inventory_status: row.inventory_status || "Unmapped",
    inventory_match: Boolean(row.inventory_match),
    inventory_conflict: Boolean(row.inventory_conflict),
    destination_ip: row.dstip || row.destination_ip || "",
    destination_port: row.dstport || row.destination_port || "",
    destination_country: row.dstcountry || row.destination_country || "",
    source_interface: Array.isArray(row.srcintf)
      ? row.srcintf.join(", ")
      : String(row.srcintf || row.source_interface || row.interface || ""),
    destination_interface: Array.isArray(row.dstintf)
      ? row.dstintf.join(", ")
      : String(row.dstintf || row.destination_interface || ""),
    session_id: row.sessionid || row.session_id || "",
    protocol: row.proto || row.protocol || "",
    application: explicitApplication || service,
    service: service || row.application || "",
    category: row.appcat || row.category || "",
    application_risk: row.apprisk || row.application_risk || "",
    application_action: row.application_action || "",
    application_identified: applicationIdentified,
    application_source:
      row.application_source ||
      (applicationIdentified ? "firewall_traffic_log" : "service_protocol"),
    application_event_count: Number(row.application_event_count || 0),
    application_log_time: row.application_log_time || "",
    action: row.action || row.status || "",
    severity: row.level || row.severity || row.crlevel || "",
    policy: row.policyname || row.policy || row.policyid || "",
    sent_bytes: Number(row.sentbyte || row.sent_bytes || 0),
    received_bytes: Number(row.rcvdbyte || row.received_bytes || 0),
    duration_seconds: Number(row.duration || row.duration_seconds || 0),
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
    sent_bytes: records.reduce((sum, row) => sum + row.sent_bytes, 0),
    received_bytes: records.reduce((sum, row) => sum + row.received_bytes, 0),
    duration_seconds: records.reduce(
      (sum, row) => sum + row.duration_seconds,
      0,
    ),
    unique_sources: new Set(
      records.map((row) => row.source_mac || row.source_ip).filter(Boolean),
    ).size,
    unique_destinations: new Set(
      records.map((row) => row.destination_ip).filter(Boolean),
    ).size,
    unique_policies: new Set(
      records.map((row) => row.policy).filter(Boolean),
    ).size,
    inventory_mapped_sources: new Set(
      records
        .filter((row) => row.inventory_match)
        .map((row) => row.source_mac || row.source_ip)
        .filter(Boolean),
    ).size,
    applications: new Set(
      records
        .filter((row) => row.application_identified === true)
        .map((row) => row.application)
        .filter(Boolean),
    ).size,
    protocol_services: new Set(
      records
        .filter((row) => row.application_identified !== true)
        .map((row) => row.service || row.application)
        .filter(Boolean),
    ).size,
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

// Report responses used to ship every merged record to the browser, which on HQ
// meant ~236k rows / 231 MB per request. Everything the dashboard renders is a
// grouping of those rows, so the grouping happens here once and the record list
// is returned as a bounded page instead.
const FIREWALL_REPORT_RECORD_LIMIT = 2000;
const FIREWALL_AGGREGATE_LIMIT = 200;

function firewallReportAggregates(records) {
  const tally = (map, key, row, extra) => {
    if (key === undefined || key === null || key === "") return;
    const name = String(key);
    let entry = map.get(name);
    if (!entry) {
      entry = {
        name,
        records: 0,
        sent_bytes: 0,
        received_bytes: 0,
        traffic_bytes: 0,
        sources: new Set(),
        destinations: new Set(),
        first_seen: null,
        last_seen: null,
      };
      map.set(name, entry);
    }
    const sent = Number(row.sent_bytes || 0);
    const received = Number(row.received_bytes || 0);
    entry.records += 1;
    entry.sent_bytes += sent;
    entry.received_bytes += received;
    entry.traffic_bytes += sent + received;
    if (row.source_ip) entry.sources.add(row.source_ip);
    if (row.destination_ip) entry.destinations.add(row.destination_ip);
    const time = row.timestamp || null;
    if (time) {
      if (!entry.first_seen || time < entry.first_seen) entry.first_seen = time;
      if (!entry.last_seen || time > entry.last_seen) entry.last_seen = time;
    }
    if (extra) extra(entry, row);
  };
  const finish = (map, limit = FIREWALL_AGGREGATE_LIMIT) =>
    [...map.values()]
      .map((entry) => ({
        ...entry,
        sources: entry.sources.size,
        destinations: entry.destinations.size,
      }))
      .sort((a, b) => b.traffic_bytes - a.traffic_bytes || b.records - a.records)
      .slice(0, limit);

  const interfaces = new Map();
  const destinationInterfaces = new Map();
  const applications = new Map();
  const protocols = new Map();
  const policies = new Map();
  const actions = new Map();
  const severities = new Map();
  const countries = new Map();
  const destinationPorts = new Map();
  const clients = new Map();
  const sourceSystems = new Set();

  for (const row of records) {
    if (row.source_ip) sourceSystems.add(row.source_ip);
    tally(interfaces, row.source_interface || "Unclassified interface", row);
    tally(
      destinationInterfaces,
      row.destination_interface || "Unclassified interface",
      row,
    );
    tally(protocols, row.protocol, row);
    tally(policies, row.policy, row);
    tally(actions, row.action, row);
    tally(severities, row.severity, row);
    tally(countries, row.destination_country, row);
    tally(destinationPorts, row.destination_port, row);
    // Application Control names the app when deep inspection is on; otherwise
    // the traffic log still carries a service label, which is the only
    // application signal available on an appliance without app-ctrl logging.
    tally(
      applications,
      row.application || row.service,
      row,
      (entry, source) => {
        entry.category ||= source.category || null;
        entry.risk ||= source.application_risk || null;
        entry.application_action ||= source.application_action || null;
        entry.identified_records =
          (entry.identified_records || 0) +
          (source.application_identified ? 1 : 0);
        // normalizedFirewallRecord falls `application` back to the service
        // label, so only application_identified distinguishes a real
        // Application Control match from a plain service name.
        if (source.application_identified) entry.source_kind = "application_control";
        else entry.source_kind ||= "service";
      },
    );
    tally(
      clients,
      row.source_mac || row.source_ip,
      row,
      (entry, source) => {
        entry.source_ip ||= source.source_ip || null;
        entry.source_mac ||= source.source_mac || null;
        entry.source_name ||= source.source_name || null;
        entry.source_device_type ||= source.source_device_type || null;
        entry.source_os_name ||= source.source_os_name || null;
        entry.source_vendor ||= source.source_vendor || null;
        entry.asset_user_name ||= source.asset_user_name || null;
        entry.employee_code ||= source.employee_code || null;
        entry.asset_email ||= source.asset_email || null;
        entry.av_status ||= source.av_status || null;
        entry.inventory_match ||= Boolean(source.inventory_match);
      },
    );
  }

  return {
    source_systems: sourceSystems.size,
    interfaces: finish(interfaces),
    destination_interfaces: finish(destinationInterfaces),
    applications: finish(applications),
    protocols: finish(protocols),
    policies: finish(policies),
    actions: finish(actions),
    severities: finish(severities),
    destination_countries: finish(countries),
    destination_ports: finish(destinationPorts),
    clients: finish(clients),
  };
}

function firewallRecordFingerprint(row) {
  return [
    row.record_id,
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

function firewallTrafficRecordKey(row) {
  return createHash("md5").update(firewallRecordFingerprint(row)).digest("hex");
}

function firewallTrafficClientKey(row) {
  const mac = normalizeMac(row.source_mac);
  if (mac) return `mac:${mac}`;
  const ip = String(row.source_ip || "").trim();
  return ip ? `ip:${ip}` : "";
}

async function indexFirewallTrafficRecords(db, firewallId, date, records) {
  const candidates = records
    .map((row) => ({
      record_key: firewallTrafficRecordKey(row),
      observed_at: row.timestamp,
      client_key: firewallTrafficClientKey(row),
      source_ip: row.source_ip || "",
      source_mac: row.source_mac || "",
      source_name: row.source_name || "",
      source_device_type: row.source_device_type || "",
      source_os_name: row.source_os_name || "",
      source_vendor: row.source_vendor || "",
      asset_user_name: row.asset_user_name || "",
      employee_code: row.employee_code || "",
      asset_email: row.asset_email || "",
      av_status: row.av_status || "Unknown",
      inventory_match: Boolean(row.inventory_match),
      sent_bytes: Math.max(0, Math.round(Number(row.sent_bytes || 0))),
      received_bytes: Math.max(0, Math.round(Number(row.received_bytes || 0))),
      appliance_serial: row.appliance_serial || "",
    }))
    .filter(
      (row) =>
        row.client_key &&
        row.observed_at &&
        !Number.isNaN(Date.parse(row.observed_at)),
    );
  const indexed = [
    ...new Map(candidates.map((row) => [row.record_key, row])).values(),
  ];
  const batchSize = 10_000;
  for (let offset = 0; offset < indexed.length; offset += batchSize) {
    const batch = indexed.slice(offset, offset + batchSize);
    await db.pool.query(
      `INSERT INTO tms_firewall_traffic_records (
         firewall_id, archive_date, record_key, observed_at, client_key,
         source_ip, source_mac, source_name, source_device_type,
         source_os_name, source_vendor, asset_user_name, employee_code,
         asset_email, av_status, inventory_match, sent_bytes, received_bytes,
         appliance_serial, updated_at
       )
       SELECT $1,
              $2::date,
              entry.record_key,
              entry.observed_at,
              entry.client_key,
              entry.source_ip,
              entry.source_mac,
              entry.source_name,
              entry.source_device_type,
              entry.source_os_name,
              entry.source_vendor,
              entry.asset_user_name,
              entry.employee_code,
              entry.asset_email,
              entry.av_status,
              entry.inventory_match,
              entry.sent_bytes,
              entry.received_bytes,
              entry.appliance_serial,
              now()
         FROM jsonb_to_recordset($3::jsonb) AS entry(
           record_key text,
           observed_at timestamptz,
           client_key text,
           source_ip text,
           source_mac text,
           source_name text,
           source_device_type text,
           source_os_name text,
           source_vendor text,
           asset_user_name text,
           employee_code text,
           asset_email text,
           av_status text,
           inventory_match boolean,
           sent_bytes bigint,
           received_bytes bigint,
           appliance_serial text
         )
       ON CONFLICT (firewall_id, archive_date, record_key) DO UPDATE SET
         observed_at = EXCLUDED.observed_at,
         client_key = EXCLUDED.client_key,
         source_ip = EXCLUDED.source_ip,
         source_mac = EXCLUDED.source_mac,
         source_name = EXCLUDED.source_name,
         source_device_type = EXCLUDED.source_device_type,
         source_os_name = EXCLUDED.source_os_name,
         source_vendor = EXCLUDED.source_vendor,
         asset_user_name = EXCLUDED.asset_user_name,
         employee_code = EXCLUDED.employee_code,
         asset_email = EXCLUDED.asset_email,
         av_status = EXCLUDED.av_status,
         inventory_match = EXCLUDED.inventory_match,
         sent_bytes = EXCLUDED.sent_bytes,
         received_bytes = EXCLUDED.received_bytes,
         appliance_serial = EXCLUDED.appliance_serial,
         updated_at = now()`,
      [firewallId, date, JSON.stringify(batch)],
    );
  }
  return indexed.length;
}

function firewallBandwidthHourlyRows(records) {
  const summaries = new Map();
  for (const row of records) {
    const clientKey = firewallTrafficClientKey(row);
    const observedAt = new Date(row.timestamp);
    if (!clientKey || Number.isNaN(observedAt.getTime())) continue;
    observedAt.setUTCMinutes(0, 0, 0);
    const bucketStart = observedAt.toISOString();
    const key = `${bucketStart}|${clientKey}`;
    const existing = summaries.get(key) || {
      bucket_start: bucketStart,
      client_key: clientKey,
      source_ip: "",
      source_mac: "",
      source_name: "",
      source_device_type: "",
      source_os_name: "",
      source_vendor: "",
      asset_user_name: "",
      employee_code: "",
      asset_email: "",
      av_status: "Unknown",
      inventory_match: false,
      traffic_records: 0,
      sent_bytes: 0,
      received_bytes: 0,
      first_activity: row.timestamp,
      last_activity: row.timestamp,
      appliance_serial: "",
    };
    for (const field of [
      "source_ip",
      "source_mac",
      "source_name",
      "source_device_type",
      "source_os_name",
      "source_vendor",
      "asset_user_name",
      "employee_code",
      "asset_email",
      "av_status",
      "appliance_serial",
    ])
      if (row[field]) existing[field] = row[field];
    existing.inventory_match ||= Boolean(row.inventory_match);
    existing.traffic_records += 1;
    existing.sent_bytes += Math.max(0, Number(row.sent_bytes || 0));
    existing.received_bytes += Math.max(0, Number(row.received_bytes || 0));
    if (Date.parse(row.timestamp) < Date.parse(existing.first_activity))
      existing.first_activity = row.timestamp;
    if (Date.parse(row.timestamp) > Date.parse(existing.last_activity))
      existing.last_activity = row.timestamp;
    summaries.set(key, existing);
  }
  return [...summaries.values()];
}

async function replaceFirewallBandwidthHourly(db, firewallId, date, records) {
  const summaries = firewallBandwidthHourlyRows(records);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM tms_firewall_bandwidth_hourly
        WHERE firewall_id = $1 AND archive_date = $2::date`,
      [firewallId, date],
    );
    for (let offset = 0; offset < summaries.length; offset += 5000) {
      await client.query(
        `INSERT INTO tms_firewall_bandwidth_hourly (
           firewall_id, archive_date, bucket_start, client_key, source_ip,
           source_mac, source_name, source_device_type, source_os_name,
           source_vendor, asset_user_name, employee_code, asset_email,
           av_status, inventory_match, traffic_records, sent_bytes,
           received_bytes, first_activity, last_activity, appliance_serial,
           updated_at
         )
         SELECT $1, $2::date, entry.bucket_start, entry.client_key,
                entry.source_ip, entry.source_mac, entry.source_name,
                entry.source_device_type, entry.source_os_name,
                entry.source_vendor, entry.asset_user_name,
                entry.employee_code, entry.asset_email, entry.av_status,
                entry.inventory_match, entry.traffic_records,
                entry.sent_bytes, entry.received_bytes,
                entry.first_activity, entry.last_activity,
                entry.appliance_serial, now()
           FROM jsonb_to_recordset($3::jsonb) AS entry(
             bucket_start timestamptz, client_key text, source_ip text,
             source_mac text, source_name text, source_device_type text,
             source_os_name text, source_vendor text, asset_user_name text,
             employee_code text, asset_email text, av_status text,
             inventory_match boolean, traffic_records bigint,
             sent_bytes bigint, received_bytes bigint,
             first_activity timestamptz, last_activity timestamptz,
             appliance_serial text
           )`,
        [firewallId, date, JSON.stringify(summaries.slice(offset, offset + 5000))],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return summaries.length;
}

const FIREWALL_ARCHIVE_COLUMNS = [
  "archive_date",
  "firewall_id",
  "firewall_label",
  "firewall_name",
  "record_id",
  "appliance_serial",
  "timestamp",
  "source_ip",
  "source_mac",
  "source_name",
  "source_device_type",
  "source_os_name",
  "source_vendor",
  "asset_user_name",
  "employee_code",
  "asset_email",
  "av_status",
  "inventory_status",
  "inventory_match",
  "inventory_conflict",
  "destination_ip",
  "destination_port",
  "destination_country",
  "source_interface",
  "destination_interface",
  "session_id",
  "protocol",
  "application",
  "service",
  "category",
  "application_risk",
  "application_identified",
  "application_source",
  "application_action",
  "application_event_count",
  "application_log_time",
  "action",
  "severity",
  "policy",
  "sent_bytes",
  "received_bytes",
  "duration_seconds",
  "message",
];

const FIREWALL_ARCHIVE_SUMMARY_COLUMNS = [
  "firewall_id",
  "firewall_label",
  "firewall_name",
  "date",
  "timezone",
  "stored_records",
  "unique_sources",
  "inventory_mapped_sources",
  "unique_destinations",
  "identified_applications",
  "protocol_services",
  "unique_policies",
  "traffic_bytes",
  "sent_bytes",
  "received_bytes",
  "duration_seconds",
  "blocked",
  "threats",
  "critical",
  "escalations",
  "capture_count",
  "first_record_at",
  "latest_record_at",
  "first_captured_at",
  "captured_at",
  "last_capture_reason",
  "source_complete",
  "archive_complete",
  "capture_gap_detected",
  "record_limit_reached",
  "source_identity_verified",
  "appliance_serial",
];

function firewallArchiveCsvCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function firewallArchiveSummaryRow(archive) {
  const summary = archive.summary || {};
  return {
    firewall_id: archive.firewall_id,
    firewall_label: archive.firewall_label,
    firewall_name: archive.firewall_name,
    date: archive.date,
    timezone: archive.timezone,
    stored_records: Number(summary.stored_records || 0),
    unique_sources: Number(summary.unique_sources || 0),
    inventory_mapped_sources: Number(summary.inventory_mapped_sources || 0),
    unique_destinations: Number(summary.unique_destinations || 0),
    identified_applications: Number(summary.applications || 0),
    protocol_services: Number(summary.protocol_services || 0),
    unique_policies: Number(summary.unique_policies || 0),
    traffic_bytes: Number(summary.traffic_bytes || 0),
    sent_bytes: Number(summary.sent_bytes || 0),
    received_bytes: Number(summary.received_bytes || 0),
    duration_seconds: Number(summary.duration_seconds || 0),
    blocked: Number(summary.blocked || 0),
    threats: Number(summary.threats || 0),
    critical: Number(summary.critical || 0),
    escalations: Number(archive.escalation_count || 0),
    capture_count: Number(archive.capture_count || 0),
    first_record_at: archive.first_record_at || "",
    latest_record_at: archive.latest_record_at || "",
    first_captured_at: archive.first_captured_at || "",
    captured_at: archive.captured_at || "",
    last_capture_reason: archive.last_capture_reason || "",
    source_complete: Boolean(archive.source_complete),
    archive_complete: Boolean(archive.archive_complete),
    capture_gap_detected: Boolean(archive.capture_gap_detected),
    record_limit_reached: Boolean(archive.record_limit_reached),
    source_identity_verified: Boolean(archive.source_identity_verified),
    appliance_serial: archive.appliance_serial || "",
  };
}

function firewallArchiveSummaryCsv(archives) {
  const header = FIREWALL_ARCHIVE_SUMMARY_COLUMNS.map(
    firewallArchiveCsvCell,
  ).join(",");
  const rows = archives.map((archive) => {
    const record = firewallArchiveSummaryRow(archive);
    return FIREWALL_ARCHIVE_SUMMARY_COLUMNS.map((column) =>
      firewallArchiveCsvCell(record[column]),
    ).join(",");
  });
  return `\uFEFF${[header, ...rows].join("\r\n")}\r\n`;
}

async function firewallArchiveIndex(
  db,
  firewallId,
  { date = null, from = null, to = null, limit = 365 } = {},
) {
  const result = await db.pool.query(
    `SELECT document_key,
            data - 'records' AS archive,
            CASE
              WHEN jsonb_typeof(data->'records') = 'array'
                THEN jsonb_array_length(data->'records')
              ELSE 0
            END AS record_count
       FROM tms_documents
      WHERE collection_name = $1
        AND data->>'firewall_id' = $2
        AND ($3::text IS NULL OR data->>'date' = $3)
        AND ($4::text IS NULL OR data->>'date' >= $4)
        AND ($5::text IS NULL OR data->>'date' <= $5)
      ORDER BY data->>'date' DESC
      LIMIT $6`,
    [
      "firewall_daily_archives",
      firewallId,
      date,
      from,
      to,
      limit,
    ],
  );
  return result.rows.map((row) => ({
    document_key: row.document_key,
    archive: {
      ...row.archive,
      summary: {
        ...(row.archive?.summary || {}),
        stored_records: Number(
          row.archive?.summary?.stored_records ?? row.record_count ?? 0,
        ),
      },
    },
    record_count: Number(row.record_count || 0),
  }));
}

async function firewallBandwidthFromArchive(db, profile, start, end) {
  const fromDate = firewallArchiveDate(start);
  const toDate = firewallArchiveDate(end);
  const hourMs = 60 * 60_000;
  const completeStart = new Date(Math.ceil(start.getTime() / hourMs) * hourMs);
  const completeEnd = new Date(Math.floor(end.getTime() / hourMs) * hourMs);
  const [clientResult, metadataResult] = await Promise.all([
    db.pool.query(
      `WITH archive_identities AS (
         SELECT (data->>'date')::date AS archive_date,
                COALESCE(data->>'appliance_serial', '') AS appliance_serial
           FROM tms_documents
          WHERE collection_name = 'firewall_daily_archives'
            AND data->>'firewall_id' = $1
            AND data->>'date' >= $6
            AND data->>'date' <= $7
       ), combined_records AS (
         SELECT hourly.client_key,
                hourly.source_ip,
                hourly.source_mac,
                hourly.source_name,
                hourly.source_device_type,
                hourly.source_os_name,
                hourly.source_vendor,
                hourly.asset_user_name,
                hourly.employee_code,
                hourly.asset_email,
                hourly.av_status,
                hourly.inventory_match,
                hourly.traffic_records,
                hourly.sent_bytes,
                hourly.received_bytes,
                hourly.first_activity,
                hourly.last_activity
           FROM tms_firewall_bandwidth_hourly hourly
           JOIN archive_identities archive USING (archive_date)
          WHERE hourly.firewall_id = $1
            AND hourly.bucket_start >= $4::timestamptz
            AND hourly.bucket_start < $5::timestamptz
            AND (
              archive.appliance_serial = ''
              OR hourly.appliance_serial = archive.appliance_serial
            )
         UNION ALL
         SELECT traffic.client_key,
                traffic.source_ip,
                traffic.source_mac,
                traffic.source_name,
                traffic.source_device_type,
                traffic.source_os_name,
                traffic.source_vendor,
                traffic.asset_user_name,
                traffic.employee_code,
                traffic.asset_email,
                traffic.av_status,
                traffic.inventory_match,
                1::bigint AS traffic_records,
                traffic.sent_bytes,
                traffic.received_bytes,
                traffic.observed_at AS first_activity,
                traffic.observed_at AS last_activity
           FROM tms_firewall_traffic_records traffic
           JOIN archive_identities archive USING (archive_date)
          WHERE traffic.firewall_id = $1
            AND traffic.observed_at >= $2::timestamptz
            AND traffic.observed_at <= $3::timestamptz
            AND NOT (
              $4::timestamptz < $5::timestamptz
              AND traffic.observed_at >= $4::timestamptz
              AND traffic.observed_at < $5::timestamptz
            )
            AND (
              archive.appliance_serial = ''
              OR traffic.appliance_serial = archive.appliance_serial
            )
       ), clients AS (
         SELECT client_key,
                MAX(NULLIF(source_ip, '')) AS source_ip,
                MAX(NULLIF(source_mac, '')) AS source_mac,
                MAX(NULLIF(source_name, '')) AS source_name,
                MAX(NULLIF(source_device_type, '')) AS source_device_type,
                MAX(NULLIF(source_os_name, '')) AS source_os_name,
                MAX(NULLIF(source_vendor, '')) AS source_vendor,
                MAX(NULLIF(asset_user_name, '')) AS asset_user_name,
                MAX(NULLIF(employee_code, '')) AS employee_code,
                MAX(NULLIF(asset_email, '')) AS asset_email,
                MAX(NULLIF(av_status, '')) AS av_status,
                BOOL_OR(inventory_match) AS inventory_match,
                SUM(traffic_records)::bigint AS traffic_records,
                SUM(sent_bytes)::numeric AS sent_bytes,
                SUM(received_bytes)::numeric AS received_bytes,
                MIN(first_activity) AS first_activity,
                MAX(last_activity) AS last_activity
           FROM combined_records
          GROUP BY client_key
       )
       SELECT *,
              COUNT(*) OVER() AS total_clients,
              SUM(traffic_records) OVER() AS total_records,
              SUM(sent_bytes) OVER() AS total_sent_bytes,
              SUM(received_bytes) OVER() AS total_received_bytes,
              MIN(first_activity) OVER() AS data_start,
              MAX(last_activity) OVER() AS data_end
         FROM clients
        ORDER BY (sent_bytes + received_bytes) DESC
        LIMIT 2000`,
      [
        profile.id,
        start.toISOString(),
        end.toISOString(),
        completeStart.toISOString(),
        completeEnd.toISOString(),
        fromDate,
        toDate,
      ],
    ),
    db.pool.query(
      `SELECT COUNT(*)::integer AS archive_days,
              MAX(NULLIF(data->>'captured_at', '')::timestamptz) AS captured_at,
              BOOL_OR(COALESCE(NULLIF(data->>'record_limit_reached', '')::boolean, false)) AS record_limit_reached,
              BOOL_AND(COALESCE(NULLIF(data->>'source_complete', '')::boolean, false)) AS source_complete,
              BOOL_AND(COALESCE(NULLIF(data->>'source_identity_verified', '')::boolean, false)) AS source_identity_verified,
              BOOL_AND(COALESCE(NULLIF(data->>'archive_complete', '')::boolean, false)) AS archive_complete,
              SUM(COALESCE(NULLIF(data#>>'{summary,stored_records}', '')::bigint, 0))::bigint AS stored_records
         FROM tms_documents
        WHERE collection_name = $1
          AND data->>'firewall_id' = $2
          AND data->>'date' >= $3
          AND data->>'date' <= $4`,
      ["firewall_daily_archives", profile.id, fromDate, toDate],
    ),
  ]);
  const totals = clientResult.rows[0] || {};
  const metadata = metadataResult.rows[0] || {};
  return {
    clients: clientResult.rows.map((row) => ({
      source_ip: row.source_ip || "",
      source_mac: row.source_mac || "",
      source_name: row.source_name || "",
      source_device_type: row.source_device_type || "",
      source_os_name: row.source_os_name || "",
      source_vendor: row.source_vendor || "",
      asset_user_name: row.asset_user_name || "",
      employee_code: row.employee_code || "",
      asset_email: row.asset_email || "",
      av_status: row.av_status || "Unknown",
      inventory_match: Boolean(row.inventory_match),
      traffic_records: Number(row.traffic_records || 0),
      sent_bytes: Number(row.sent_bytes || 0),
      received_bytes: Number(row.received_bytes || 0),
      first_activity: row.first_activity || null,
      last_activity: row.last_activity || null,
    })),
    summary: {
      records: Number(totals.total_records || 0),
      clients: Number(totals.total_clients || 0),
      sent_bytes: Number(totals.total_sent_bytes || 0),
      received_bytes: Number(totals.total_received_bytes || 0),
      traffic_bytes:
        Number(totals.total_sent_bytes || 0) +
        Number(totals.total_received_bytes || 0),
      data_start: totals.data_start || null,
      data_end: totals.data_end || null,
      archive_days: Number(metadata.archive_days || 0),
      stored_records: Number(metadata.stored_records || 0),
      captured_at: metadata.captured_at || null,
      record_limit_reached: Boolean(metadata.record_limit_reached),
      source_complete: Boolean(metadata.source_complete),
      source_identity_verified: Boolean(metadata.source_identity_verified),
      archive_complete: Boolean(metadata.archive_complete),
      source: "verified_daily_archive",
    },
  };
}

async function firewallArchiveDayPage(
  db,
  firewallId,
  date,
  page,
  pageSize,
) {
  const offset = (page - 1) * pageSize;
  const result = await db.pool.query(
    `WITH selected AS (
       SELECT data - 'records' AS archive,
              CASE
                WHEN jsonb_typeof(data->'records') = 'array'
                  THEN data->'records'
                ELSE '[]'::jsonb
              END AS records
         FROM tms_documents
        WHERE collection_name = $1
          AND data->>'firewall_id' = $2
          AND data->>'date' = $3
        LIMIT 1
     ), hydrated AS (
       SELECT archive, records, jsonb_array_length(records) AS total_records
         FROM selected
     )
     SELECT archive,
            total_records,
            COALESCE(
              (
                SELECT jsonb_agg(records -> item_index ORDER BY item_index)
                  FROM generate_series(
                    $4::integer,
                    LEAST($5::integer, total_records - 1)
                  ) AS item_index
              ),
              '[]'::jsonb
            ) AS page_records
       FROM hydrated`,
    [
      "firewall_daily_archives",
      firewallId,
      date,
      offset,
      offset + pageSize - 1,
    ],
  );
  if (!result.rows[0]) return null;
  return {
    archive: result.rows[0].archive,
    records: result.rows[0].page_records || [],
    totalRecords: Number(result.rows[0].total_records || 0),
  };
}

function firewallArchiveDatabaseCsvStream(db, archives) {
  const encoder = new TextEncoder();
  let archiveIndex = 0;
  let recordOffset = 0;
  let headerSent = false;
  const pageSize = 1000;
  return new ReadableStream({
    async pull(controller) {
      try {
        let chunk = "";
        if (!headerSent) {
          chunk = `\uFEFF${FIREWALL_ARCHIVE_COLUMNS.map(firewallArchiveCsvCell).join(",")}\r\n`;
          headerSent = true;
        }
        while (archiveIndex < archives.length && chunk.length < 512 * 1024) {
          const archive = archives[archiveIndex];
          if (recordOffset >= archive.record_count) {
            archiveIndex += 1;
            recordOffset = 0;
            continue;
          }
          const page = await firewallArchiveDayPage(
            db,
            archive.archive.firewall_id,
            archive.archive.date,
            Math.floor(recordOffset / pageSize) + 1,
            pageSize,
          );
          const records = page?.records || [];
          if (!records.length) {
            archiveIndex += 1;
            recordOffset = 0;
            continue;
          }
          for (const record of records) {
            const exported = {
              archive_date: archive.archive.date,
              firewall_id: archive.archive.firewall_id,
              firewall_label: archive.archive.firewall_label,
              firewall_name: archive.archive.firewall_name,
              ...record,
            };
            chunk += `${FIREWALL_ARCHIVE_COLUMNS.map((column) =>
              firewallArchiveCsvCell(exported[column]),
            ).join(",")}\r\n`;
          }
          recordOffset += records.length;
        }
        if (chunk) controller.enqueue(encoder.encode(chunk));
        if (archiveIndex >= archives.length) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

async function preservePreDowntimeArchive(db, profile, detectedAt) {
  const candidates = await db
    .collection("firewall_daily_archives")
    .find({ firewall_id: profile.id })
    .sort({ date: -1 })
    .limit(7)
    .toArray();
  const archive =
    candidates.find(
      (item) => Number(item.summary?.stored_records || item.records?.length) > 0,
    ) || candidates[0];
  if (!archive) return null;
  const capturedAt = archive.captured_at
    ? new Date(archive.captured_at)
    : archive.updated_at
      ? new Date(archive.updated_at)
      : null;
  const snapshot = {
    archive_id: archive.id,
    archive_date: archive.date,
    captured_at: capturedAt,
    latest_record_at: archive.latest_record_at || null,
    stored_records: Number(
      archive.summary?.stored_records || archive.records?.length || 0,
    ),
    source_complete: Boolean(archive.source_complete),
    archive_complete: Boolean(archive.archive_complete),
    protected_at: detectedAt,
    gap_ms: capturedAt
      ? Math.max(0, detectedAt.getTime() - capturedAt.getTime())
      : null,
  };
  await db.collection("firewall_daily_archives").updateOne(
    { id: archive.id, firewall_id: profile.id },
    {
      $set: {
        protected_before_downtime: true,
        last_pre_downtime_snapshot: snapshot,
        last_pre_downtime_protected_at: detectedAt,
        updated_at: detectedAt,
      },
    },
  );
  return snapshot;
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
  const preDowntimeSnapshot =
    state === "down" && stateChanged
      ? await preservePreDowntimeArchive(db, profile, now)
      : null;

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
            pre_downtime_snapshot: preDowntimeSnapshot,
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
        {
          id: openOutage.id,
          firewall_id: profile.id,
          open: true,
        },
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
        ...(preDowntimeSnapshot
          ? {
              last_pre_downtime_snapshot: preDowntimeSnapshot,
              last_pre_downtime_protected_at: now,
            }
          : {}),
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
          pre_downtime_snapshot: currentOutage.pre_downtime_snapshot || null,
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
          pre_downtime_snapshot:
            lastCompletedOutage.pre_downtime_snapshot || null,
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
      pre_downtime_snapshot: outage.pre_downtime_snapshot || null,
      duration_ms: outage.open
        ? Math.max(0, now.getTime() - new Date(outage.started_at).getTime())
        : outage.duration_ms || 0,
    })),
  };
}

async function archiveFirewallRecords(...args) {
  if (!globalThis[FIREWALL_ARCHIVE_WRITES_KEY])
    globalThis[FIREWALL_ARCHIVE_WRITES_KEY] = new Map();
  const writes = globalThis[FIREWALL_ARCHIVE_WRITES_KEY];
  const profile = args[1];
  const key = profile?.id || "default";
  const previous = writes.get(key) || Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(() => archiveFirewallRecordsUnlocked(...args));
  writes.set(key, task);
  try {
    return await task;
  } finally {
    if (writes.get(key) === task) writes.delete(key);
  }
}

async function archiveFirewallRecordsUnlocked(
  db,
  profile,
  firewallName,
  records,
  capturedAt,
  capture = {},
) {
  const normalized = records.map(normalizedFirewallRecord).filter(Boolean);
  const groups = new Map();
  for (const record of normalized) {
    const date = firewallArchiveDate(record.timestamp);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(record);
  }
  const capturedDate = firewallArchiveDate(capturedAt);
  if (!groups.has(capturedDate)) groups.set(capturedDate, []);
  for (const [date, dayRecords] of groups) {
    const existing = await db
      .collection("firewall_daily_archives")
      .findOne({ firewall_id: profile.id, date });
    const merged = new Map();
    for (const record of [...(existing?.records || []), ...dayRecords])
      merged.set(firewallRecordFingerprint(record), record);
    // A day's embedded records are re-parsed and re-serialised on every
    // 15-minute sync. At the old 250k ceiling a single day reached ~32MB and
    // took ~7s just to revive, stalling the event loop and OOM-killing
    // Postgres. 50k keeps a day near ~6MB. The ceiling is capped too, not just
    // the default, so a deployment already exporting
    // FIREWALL_ARCHIVE_MAX_RECORDS=250000 is clamped down without an env edit.
    // Full per-record history is unaffected: it lives in the relational
    // tms_firewall_traffic_records table, which is never truncated.
    const configuredArchiveRows = Number(
      profile.value("ARCHIVE_MAX_RECORDS", "50000"),
    );
    const archiveRowLimit = Number.isFinite(configuredArchiveRows)
      ? Math.min(50000, Math.max(2500, Math.round(configuredArchiveRows)))
      : 50000;
    // Summaries, appliance-identity counters and the hourly bandwidth rollup
    // are derived from every record seen this cycle, before truncation, so
    // narrowing what is retained never shrinks the reported totals.
    const dayAll = [...merged.values()].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    const stored = dayAll.slice(0, archiveRowLimit);
    const expectedApplianceSerial = String(capture.applianceSerial || "").trim();
    const verifiedRecords = expectedApplianceSerial
      ? dayAll.filter(
          (record) => record.appliance_serial === expectedApplianceSerial,
        ).length
      : 0;
    const foreignApplianceRecords = expectedApplianceSerial
      ? dayAll.filter(
          (record) =>
            record.appliance_serial &&
            record.appliance_serial !== expectedApplianceSerial,
        ).length
      : 0;
    const unverifiedApplianceRecords = dayAll.filter(
      (record) => !record.appliance_serial,
    ).length;
    const sourceIdentityVerified = Boolean(
      expectedApplianceSerial &&
        foreignApplianceRecords === 0 &&
        unverifiedApplianceRecords === 0,
    );
    const archiveAnalysis = firewallArchiveSummary(dayAll);
    const summary = {
      ...archiveAnalysis.summary,
      // Byte/threat/uniqueness aggregates above cover every record seen for
      // the day; these two keep the retained-vs-observed distinction explicit
      // now that the retained slice is smaller than the day.
      observed_records: dayAll.length,
      stored_records: stored.length,
      verified_appliance_records: verifiedRecords,
      unverified_appliance_records: unverifiedApplianceRecords,
      foreign_appliance_records: foreignApplianceRecords,
    };
    const escalations = archiveAnalysis.escalations;
    const capturedAtDate = new Date(capturedAt);
    const captureReason = capture.captureReason || "live_api";
    const previousCapturedAt = existing?.captured_at
      ? new Date(existing.captured_at)
      : null;
    const captureGapMs =
      previousCapturedAt && firewallArchiveDate(previousCapturedAt) === date
        ? Math.max(0, capturedAtDate.getTime() - previousCapturedAt.getTime())
        : null;
    const configuredCaptureInterval = Number(
      process.env.FIREWALL_ARCHIVE_INTERVAL_MS || 15 * 60_000,
    );
    const expectedCaptureInterval = Number.isFinite(configuredCaptureInterval)
      ? Math.min(
          24 * 60 * 60_000,
          Math.max(5 * 60_000, configuredCaptureInterval),
        )
      : 15 * 60_000;
    const captureGapDetected = Boolean(
      existing?.capture_gap_detected ||
        existing?.record_limit_reached ||
        (captureGapMs !== null && captureGapMs > expectedCaptureInterval * 2),
    );
    const currentRecordLimitReached = merged.size > archiveRowLimit;
    const archiveComplete = Boolean(
      capture.sourceComplete &&
        sourceIdentityVerified &&
        !currentRecordLimitReached &&
        !captureGapDetected,
    );
    const snapshot = {
      captured_at: capturedAtDate,
      reason: captureReason,
      records_observed: dayRecords.length,
      records_stored: stored.length,
      records_observed_day: dayAll.length,
      source_complete: Boolean(capture.sourceComplete),
      source_rows_fetched: Number(capture.sourceRowsFetched || normalized.length),
      source_rows_available: Number(
        capture.sourceRowsAvailable || normalized.length,
      ),
      source_pages_fetched: Number(capture.sourcePagesFetched || 1),
      record_limit_reached: currentRecordLimitReached,
      archive_complete: archiveComplete,
      appliance_serial: expectedApplianceSerial || null,
      source_identity_verified: sourceIdentityVerified,
      verified_appliance_records: verifiedRecords,
      unverified_appliance_records: unverifiedApplianceRecords,
      foreign_appliance_records: foreignApplianceRecords,
      capture_gap_ms: captureGapMs,
    };
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
          appliance_serial: expectedApplianceSerial || null,
          source_identity_verified: sourceIdentityVerified,
          source_complete: Boolean(capture.sourceComplete),
          archive_complete: archiveComplete,
          capture_gap_detected: captureGapDetected,
          latest_capture_gap_ms: captureGapMs,
          capture_count: Number(existing?.capture_count || 0) + 1,
          last_capture_reason: captureReason,
          last_snapshot: snapshot,
          first_captured_at: existing?.first_captured_at || capturedAtDate,
          ...(capture.sourceComplete
            ? { last_complete_capture_at: capturedAtDate }
            : existing?.last_complete_capture_at
              ? { last_complete_capture_at: existing.last_complete_capture_at }
              : {}),
          record_limit: archiveRowLimit,
          record_limit_reached: currentRecordLimitReached,
          escalations,
          escalation_count: escalations.length,
          escalation_signature: escalationSignature,
          ...(shouldNotify ? { escalation_notified_at: new Date() } : {}),
          records: stored,
          latest_record_at: dayAll[0]?.timestamp || null,
          first_record_at: dayAll.at(-1)?.timestamp || null,
          captured_at: capturedAtDate,
          updated_at: new Date(),
        },
        $setOnInsert: { id: uuidv4(), created_at: new Date() },
      },
      { upsert: true },
    );
    try {
      const indexedState = await db.pool.query(
        `SELECT EXISTS (
           SELECT 1
             FROM tms_firewall_traffic_records
            WHERE firewall_id = $1 AND archive_date = $2::date
         ) AS has_records`,
        [profile.id, date],
      );
      await indexFirewallTrafficRecords(
        db,
        profile.id,
        date,
        indexedState.rows[0]?.has_records ? dayRecords : dayAll,
      );
    } catch (error) {
      console.error("Firewall traffic indexing failed:", error);
    }
    try {
      await replaceFirewallBandwidthHourly(db, profile.id, date, dayAll);
    } catch (error) {
      console.error("Firewall bandwidth summary failed:", error);
    }
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
function inventoryCellText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    if (value.text !== undefined) return String(value.text).trim();
    if (Array.isArray(value.richText))
      return value.richText.map((part) => part.text || "").join("").trim();
    if (value.result !== undefined) return String(value.result).trim();
  }
  return String(value).trim();
}

async function inventoryRowsFrom(path) {
  if (/\.xlsx$/i.test(path)) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(readFileSync(path));
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];
    const rows = [];
    worksheet.eachRow((row) => {
      rows.push(row.values.slice(1).map(inventoryCellText));
    });
    return rows;
  }
  return parseCsv(readFileSync(path, "utf8"));
}

async function firewallInventory() {
  if (firewallInventoryCache) return firewallInventoryCache;
  firewallInventoryCache = (async () => {
  const files = [
    {
      source: "asset_inventory",
      paths: [
        process.env.FIREWALL_ASSET_INVENTORY_PATH,
        "/Users/macbookpro/Downloads/IT Asset Inventory.xlsx - Sheet1.csv",
        "/Users/macbookpro/Downloads/IT Asset Inventory.xlsx",
      ].filter(Boolean),
    },
    {
      source: "av_status",
      paths: [
        process.env.FIREWALL_AV_STATUS_PATH,
        "/Users/macbookpro/Downloads/AV Status and Mac Address_273.xlsx - Sheet1.csv",
      ].filter(Boolean),
    },
  ];
  const index = new Map(),
    errors = [];
  for (const file of files) {
    let rows = null;
    let loadedPath = null;
    let lastError = null;
    for (const path of [...new Set(file.paths)]) {
      try {
        rows = await inventoryRowsFrom(path);
        loadedPath = path;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (rows) {
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
      continue;
    }
    const assetContainsAv =
      file.source === "av_status" &&
      [...index.values()].some((entry) =>
        entry.matches.some((match) => Boolean(match.av_status)),
      );
    if (!assetContainsAv)
      errors.push(`${file.source}: ${lastError?.message || "inventory file not found"}`);
  }
  return { index, errors };
  })();
  return firewallInventoryCache;
}

async function mapFirewallInventory(devices) {
  const inventory = await firewallInventory();
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
  const { _id, password_hash, session_version, sessions_revoked_at, ...rest } =
    doc;
  return rest;
}

function textValue(value, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const PASSWORD_MIN_LENGTH = 12;

function passwordPolicyError(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  )
    return "Password must include uppercase, lowercase, a number and a symbol";
  return null;
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

async function attachmentRateLimited(database, userId, files) {
  const requestedBytes = files.reduce(
    (sum, file) => sum + Number(file.size || 0),
    0,
  );
  const key = (scope) =>
    createHash("sha256").update(`${scope}:${userId}`).digest("hex");
  const [fileRate, byteRate] = await Promise.all([
    database.consumeRateLimit(
      key("attachment-files"),
      30,
      60 * 60_000,
      files.length,
    ),
    database.consumeRateLimit(
      key("attachment-bytes"),
      100 * 1024 * 1024,
      60 * 60_000,
      requestedBytes,
    ),
  ]);
  return fileRate.limited || byteRate.limited;
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
function notificationKind(message = "") {
  const value = String(message).toLowerCase();
  if (/sla breach|escalat|overdue/.test(value)) return "escalation";
  if (/resolved|closed|confirmed/.test(value)) return "resolution";
  if (/assign|new .*ticket|ticket .*raised/.test(value)) return "assignment";
  if (/comment|response/.test(value)) return "comment";
  if (/approval|approved|rejected|clarification/.test(value)) return "approval";
  if (/remind|pending/.test(value)) return "reminder";
  return "general";
}

async function notify(db, userIds, message, ticket, kind, options = {}) {
  const ids = [
    ...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean)),
  ];
  const docs = ids.filter(Boolean).map((uid) => ({
    id: uuidv4(),
    user_id: uid,
    message,
    ticket_id: ticket?.id || null,
    ticket_human_id: ticket?.human_id || null,
    kind: kind || notificationKind(message),
    read: false,
    created_at: new Date(),
  }));
  if (docs.length) await db.collection("notifications").insertMany(docs);
  if (
    docs.length &&
    options.email !== false &&
    process.env.EMAIL_NOTIFICATIONS_ENABLED !== "false"
  ) {
    const recipients = await db
      .collection("users")
      .find({ id: { $in: ids }, active: { $ne: false } })
      .toArray();
    const emailRecipients = recipients.filter(
      (user) => user.email_notifications_disabled !== true,
    );
    if (emailRecipients.length) {
      const eventId = uuidv4();
      await queueEmail(
        db,
        emailRecipients,
        ticket?.human_id
          ? `[TicketFlow] ${ticket.human_id} update`
          : "[TicketFlow] Service Hub notification",
        `${message}${ticket?.human_id ? `\n\nTicket: ${ticket.human_id}` : ""}\n\nSign in to Ethara Service Hub to review the details.`,
        `notification:${eventId}`,
      );
      if (emailDeliveryConfigured())
        await deliverQueuedEmails(db, Math.min(10, emailRecipients.length));
    }
  }
}

function emailDeliveryConfigured() {
  return Boolean(emailTransportConfiguration());
}

let smtpTransporter;
let smtpTransporterKey;

function emailTransportConfiguration() {
  const from = String(process.env.MAIL_FROM || "").trim();
  if (!from || /[\r\n]/.test(from)) return null;
  const requested = String(process.env.EMAIL_TRANSPORT || "auto").toLowerCase();
  if ((requested === "smtp" || requested === "auto") && process.env.SMTP_HOST) {
    try {
      smtpConnectionConfiguration();
      return { mode: "smtp", from };
    } catch {
      return null;
    }
  }
  if (
    (requested === "resend" || requested === "auto") &&
    process.env.RESEND_API_KEY
  )
    return { mode: "resend", from };
  return null;
}

function smtpConnectionConfiguration() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SMTP_HOST and a valid SMTP_PORT are required");
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const requireTLS = !secure && process.env.SMTP_REQUIRE_TLS !== "false";
  const isLoopback = ["127.0.0.1", "::1", "localhost"].includes(
    host.toLowerCase(),
  );
  if (
    !secure &&
    !requireTLS &&
    !(isLoopback && process.env.SMTP_ALLOW_INSECURE_LOCAL === "true")
  )
    throw new Error(
      "Unencrypted SMTP is allowed only for an explicitly enabled loopback test server",
    );
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (Boolean(user) !== Boolean(pass))
    throw new Error("SMTP_USER and SMTP_PASS must be configured together");
  const caPath = String(process.env.SMTP_CA_CERT_PATH || "").trim();
  const tls = {
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    ...(caPath ? { ca: [readFileSync(caPath)] } : {}),
  };
  return {
    host,
    port,
    secure,
    requireTLS,
    auth: user && pass ? { user, pass } : undefined,
    tls,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

function getSmtpTransporter() {
  const options = smtpConnectionConfiguration();
  const key = JSON.stringify({
    host: options.host,
    port: options.port,
    secure: options.secure,
    requireTLS: options.requireTLS,
    user: options.auth?.user || "",
    ca: Boolean(process.env.SMTP_CA_CERT_PATH),
  });
  if (!smtpTransporter || smtpTransporterKey !== key) {
    smtpTransporter = nodemailer.createTransport(options);
    smtpTransporterKey = key;
  }
  return smtpTransporter;
}

function safeEmailHeader(value, fallback = "") {
  const cleanValue = String(value || fallback).replace(/[\r\n]+/g, " ").trim();
  return cleanValue.slice(0, 250);
}

function safeEmailAddress(value) {
  const address = String(value || "").trim();
  if (
    address.length > 254 ||
    /[\r\n]/.test(address) ||
    !/^[^\s@]+@[^\s@]+$/.test(address)
  )
    throw new Error("Email recipient address is invalid");
  return address;
}

const EMAIL_DELIVERY_MONITOR_KEY = Symbol.for(
  "ticketflow.emailDeliveryMonitor",
);

function startEmailDeliveryMonitor(database) {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.EMAIL_DELIVERY_MONITOR_DISABLED === "true" ||
    !emailDeliveryConfigured() ||
    globalThis[EMAIL_DELIVERY_MONITOR_KEY]
  )
    return;
  const configuredInterval = Number(
    process.env.EMAIL_DELIVERY_INTERVAL_MS || 30_000,
  );
  const intervalMs = Number.isFinite(configuredInterval)
    ? Math.min(5 * 60_000, Math.max(15_000, configuredInterval))
    : 30_000;
  const run = () =>
    deliverQueuedEmails(database, 25).catch((error) =>
      console.error("Email outbox delivery failed:", error.message),
    );
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  globalThis[EMAIL_DELIVERY_MONITOR_KEY] = { timer, intervalMs };
  void run();
}

function loginOtpRequired() {
  if (process.env.LOGIN_OTP_REQUIRED === "true") return true;
  if (process.env.LOGIN_OTP_REQUIRED === "false") return false;
  return emailDeliveryConfigured();
}

async function queueEmail(
  db,
  recipients,
  subject,
  message,
  dedupePrefix,
  options = {},
) {
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
          sensitive: options.sensitive === true,
          expires_at: options.expiresAt || null,
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

async function deliverQueuedEmails(db, limit = 10, options = {}) {
  const now = new Date();
  await db.collection("email_outbox").updateMany(
    {
      sensitive: true,
      expires_at: { $lte: now },
      status: { $in: ["pending", "retry"] },
    },
    {
      $set: {
        status: "expired",
        message: "[Expired sensitive email removed]",
        updated_at: now,
      },
    },
  );
  const transport = emailTransportConfiguration();
  if (!transport)
    return {
      configured: false,
      delivered: 0,
      pending: await db
        .collection("email_outbox")
        .countDocuments({ status: { $in: ["pending", "retry"] } }),
    };

  const queueFilter = {
    status: { $in: ["pending", "retry"] },
    next_attempt_at: { $lte: now },
    attempts: { $lt: 5 },
  };
  if (options.dedupePrefix)
    queueFilter.dedupe_key = {
      $regex: `^${String(options.dedupePrefix).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`,
    };
  const queued = await db
    .collection("email_outbox")
    .find(queueFilter)
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
      if (transport.mode === "smtp") {
        await getSmtpTransporter().sendMail({
          from: transport.from,
          to: safeEmailAddress(email.to),
          subject: safeEmailHeader(email.subject, "Ethara Service Hub notification"),
          text: String(email.message || ""),
        });
      } else {
        const response = await fetch(
          process.env.RESEND_API_URL || "https://api.resend.com/emails",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: transport.from,
              to: [safeEmailAddress(email.to)],
              subject: safeEmailHeader(
                email.subject,
                "Ethara Service Hub notification",
              ),
              text: String(email.message || ""),
            }),
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!response.ok)
          throw new Error(`Email provider returned HTTP ${response.status}`);
      }
      await db.collection("email_outbox").updateOne(
        { id: email.id },
        {
          $set: {
            status: "sent",
            sent_at: new Date(),
            ...(email.sensitive
              ? { message: "[Sensitive email delivered and removed]" }
              : {}),
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
            ...(email.sensitive && attempts >= 5
              ? { message: "[Failed sensitive email removed]" }
              : {}),
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

const LOGIN_OTP_TTL_MS = 10 * 60_000;
const LOGIN_OTP_RESEND_MS = 60_000;
const LOGIN_OTP_MAX_ATTEMPTS = 5;

function maskEmail(email) {
  const [name = "", domain = ""] = String(email).split("@");
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"•".repeat(Math.max(3, name.length - visible.length))}@${domain}`;
}

function loginOtpDigest(challengeId, code) {
  return createHmac("sha256", jwtSecret())
    .update(`${challengeId}:${code}`)
    .digest("hex");
}

function otpMatches(expectedDigest, challengeId, code) {
  const actual = Buffer.from(loginOtpDigest(challengeId, code), "hex");
  const expected = Buffer.from(String(expectedDigest || ""), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function loginChallengeToken(challenge, user) {
  return new SignJWT({
    purpose: "login_otp",
    challenge_id: challenge.id,
    user_id: user.id,
    session_version: Number(user.session_version || 0),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .setJti(uuidv4())
    .sign(jwtSecret());
}

async function getLoginChallengeSession(request) {
  try {
    const token = request.cookies.get("tf_login_challenge")?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, jwtSecret());
    return payload.purpose === "login_otp" ? payload : null;
  } catch {
    return null;
  }
}

function setLoginChallengeCookie(response, token) {
  response.cookies.set("tf_login_challenge", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: sessionCookieSecure(),
    path: "/api/auth",
    maxAge: LOGIN_OTP_TTL_MS / 1000,
  });
}

function clearLoginChallengeCookie(response) {
  response.cookies.set("tf_login_challenge", "", {
    httpOnly: true,
    sameSite: "strict",
    secure: sessionCookieSecure(),
    path: "/api/auth",
    maxAge: 0,
  });
}

function loginSite(value, user) {
  return ticketLocationSite(value) || ticketLocationSite(user?.location) || "Tulip";
}

async function createLoginSessionResponse(user, remember = false, location) {
  const maxAge = remember ? 30 * 24 * 3600 : 12 * 3600;
  const selectedSite = loginSite(location, user);
  const token = await new SignJWT({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    login_site: selectedSite,
    session_version: Number(user.session_version || 0),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${maxAge}s`)
    .setIssuedAt()
    .setJti(uuidv4())
    .sign(jwtSecret());
  const response = json({
    user: { ...clean(user), location: selectedSite, login_site: selectedSite },
  });
  response.cookies.set("tf_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieSecure(),
    path: "/",
    maxAge,
  });
  clearLoginChallengeCookie(response);
  return response;
}

async function queueLoginOtp(db, user, challenge, code, version = 0) {
  const dedupePrefix = `login-otp:${challenge.id}:${version}`;
  await queueEmail(
    db,
    [user],
    "Your Ethara Service Hub sign-in code",
    `Hello ${user.name},\n\nYour one-time sign-in code is: ${code}\n\nThis code expires in 10 minutes and can be used only once. If you did not attempt to sign in, reset your password and contact your administrator.`,
    dedupePrefix,
    { sensitive: true, expiresAt: challenge.expires_at },
  );
  return deliverQueuedEmails(db, 1, { dedupePrefix });
}

async function supersedePendingLoginOtpEmails(db, userId) {
  await db.collection("email_outbox").updateMany(
    {
      user_id: userId,
      sensitive: true,
      status: { $in: ["pending", "retry"] },
    },
    {
      $set: {
        status: "superseded",
        message: "[Superseded sensitive email removed]",
        updated_at: new Date(),
      },
    },
  );
}

async function issueLoginOtp(db, request, user, remember, location) {
  const limit = await db.consumeRateLimit(
    requestRateLimitKey("login-otp-send", request, user.id),
    5,
    60 * 60_000,
  );
  if (limit.limited)
    return { error: "Too many verification codes requested. Try again later." };
  await supersedePendingLoginOtpEmails(db, user.id);
  const now = new Date();
  const code = String(randomInt(100000, 1000000));
  const challenge = {
    id: uuidv4(),
    user_id: user.id,
    code_hash: "",
    attempts: 0,
    resend_count: 0,
    remember: Boolean(remember),
    login_site: loginSite(location, user),
    consumed_at: null,
    next_resend_at: new Date(now.getTime() + LOGIN_OTP_RESEND_MS),
    expires_at: new Date(now.getTime() + LOGIN_OTP_TTL_MS),
    created_at: now,
    updated_at: now,
  };
  challenge.code_hash = loginOtpDigest(challenge.id, code);
  await db.collection("login_otp_challenges").deleteMany({
    user_id: user.id,
    consumed_at: null,
  });
  await db.collection("login_otp_challenges").insertOne(challenge);
  const delivery = await queueLoginOtp(db, user, challenge, code);
  return { challenge, delivery };
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
    { sensitive: true, expiresAt },
  );
  await deliverQueuedEmails(db, 1);
}

const APPROVAL_EMAIL_TOKEN_TTL_MS = 48 * 60 * 60_000;

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function approvalEmailPage({ title, message, context, token, success = false }) {
  const approval = context?.approval;
  const ticket = context?.ticket;
  const details = approval && ticket
    ? `<dl>
        <div><dt>Ticket</dt><dd>${escapeHtml(ticket.human_id)} · ${escapeHtml(ticket.title)}</dd></div>
        <div><dt>Requested amount</dt><dd>${escapeHtml(approval.requested_amount || "Not specified")}</dd></div>
        <div><dt>Vendor</dt><dd>${escapeHtml(approval.vendor || "Not specified")}</dd></div>
        <div><dt>Justification</dt><dd>${escapeHtml(approval.justification || "Not specified")}</dd></div>
      </dl>`
    : "";
  const form = context && token && !success
    ? `<form method="post" action="/api/approvals/email-action">
        <input type="hidden" name="token" value="${escapeHtml(token)}" />
        <label for="remarks">Remarks <span>(required when rejecting)</span></label>
        <textarea id="remarks" name="remarks" maxlength="2000" placeholder="Add decision remarks"></textarea>
        <div class="actions">
          <button class="approve" type="submit" name="decision" value="approve">Approve request</button>
          <button class="reject" type="submit" name="decision" value="reject">Reject request</button>
        </div>
      </form>`
    : "";
  return `<!doctype html>
  <html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(title)} · Ethara Service Hub</title>
  <style>
    :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:#f4f5f8;color:#171923}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#fce7fc 0,#f4f5f8 42%)}
    main{width:min(620px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:32px;box-shadow:0 24px 60px rgba(38,24,66,.13)}
    .mark{display:inline-grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#ed00ed;color:#fff;font-weight:800;margin-bottom:18px}
    h1{margin:0;font-size:25px;letter-spacing:-.03em}p{color:#5f6675;line-height:1.6}dl{margin:24px 0;border:1px solid #eceef2;border-radius:12px;overflow:hidden}
    dl div{padding:12px 15px;border-bottom:1px solid #eceef2}dl div:last-child{border-bottom:0}dt{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8a91a0;font-weight:700}dd{margin:5px 0 0;line-height:1.45}
    label{display:block;font-size:13px;font-weight:700;margin-bottom:8px}label span{font-weight:400;color:#777f8f}textarea{width:100%;min-height:96px;resize:vertical;border:1px solid #d8dbe3;border-radius:10px;padding:12px;font:inherit}
    textarea:focus{outline:3px solid rgba(237,0,237,.13);border-color:#ed00ed}.actions{display:flex;gap:12px;margin-top:16px;flex-wrap:wrap}button{border:0;border-radius:10px;padding:12px 18px;font-weight:750;cursor:pointer}.approve{background:#ed00ed;color:#fff}.reject{background:#fff1f2;color:#be123c;border:1px solid #fecdd3}
    .security{margin-top:24px;padding-top:18px;border-top:1px solid #eceef2;font-size:12px;color:#8a91a0}
  </style></head><body><main><div class="mark">E</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${details}${form}<p class="security">This secure decision page expires after 48 hours. Opening the link never changes the approval; a decision is recorded only after you press an action button.</p></main></body></html>`;
}

function approvalEmailResponse(input, status = 200) {
  return new NextResponse(approvalEmailPage(input), {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

async function approvalEmailToken(approval, ticket, recipient) {
  return new SignJWT({
    purpose: "approval_email_action",
    approval_id: approval.id,
    ticket_id: ticket.id,
    user_id: recipient.id,
    session_version: Number(recipient.session_version || 0),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("48h")
    .setJti(uuidv4())
    .sign(jwtSecret());
}

async function queueApprovalRequestEmails(
  database,
  recipients,
  approval,
  ticket,
  appOrigin,
  version,
) {
  const expiresAt = new Date(Date.now() + APPROVAL_EMAIL_TOKEN_TTL_MS);
  let queued = 0;
  for (const recipient of recipients.filter(
    (user) => user?.email && user.email_notifications_disabled !== true,
  )) {
    const token = await approvalEmailToken(approval, ticket, recipient);
    const actionUrl = `${appOrigin}/api/approvals/email-action?token=${encodeURIComponent(token)}`;
    queued += await queueEmail(
      database,
      [recipient],
      `[Approval required] ${ticket.human_id} · ${ticket.title}`,
      `Hello ${recipient.name},\n\n${ticket.human_id} requires your approval.\n\nRequested amount: ${approval.requested_amount || "Not specified"}\nVendor: ${approval.vendor || "Not specified"}\nJustification: ${approval.justification || "Not specified"}\n\nReview and decide securely:\n${actionUrl}\n\nOpening this link does not approve the request. The link expires in 48 hours. You can also decide from the Ethara Service Hub dashboard.`,
      `approval-request:${approval.id}:${version}`,
      { sensitive: true, expiresAt },
    );
  }
  if (queued && emailDeliveryConfigured())
    await deliverQueuedEmails(database, Math.min(25, queued), {
      dedupePrefix: `approval-request:${approval.id}:${version}`,
    });
  return queued;
}

async function approvalEmailContext(database, token) {
  if (
    typeof token !== "string" ||
    token.length > 4096 ||
    !/^[A-Za-z0-9._-]+$/.test(token)
  )
    throw requestError("This approval link is invalid", 400);
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwtSecret()));
  } catch {
    throw requestError("This approval link is invalid or has expired", 401);
  }
  if (
    payload.purpose !== "approval_email_action" ||
    !payload.approval_id ||
    !payload.ticket_id ||
    !payload.user_id
  )
    throw requestError("This approval link is invalid", 401);
  const [user, approval, ticket] = await Promise.all([
    database.collection("users").findOne({
      id: payload.user_id,
      role: "super_admin",
      active: { $ne: false },
    }),
    database.collection("approvals").findOne({
      id: payload.approval_id,
      ticket_id: payload.ticket_id,
    }),
    database.collection("tickets").findOne({ id: payload.ticket_id }),
  ]);
  if (
    !user ||
    Number(user.session_version || 0) !== Number(payload.session_version || 0)
  )
    throw requestError("This approval link is no longer authorized", 403);
  if (!approval || !ticket)
    throw requestError("This approval request is no longer available", 404);
  if (approval.status !== "Pending")
    throw requestError(`This request is already ${approval.status}`, 409);
  if (TERMINAL_TICKET_STATUSES.includes(ticket.status))
    throw requestError("This ticket is already final", 409);
  return { payload, user, approval, ticket };
}

async function supersedePendingApprovalEmails(database, approvalId) {
  const prefix = `^approval-request:${String(approvalId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`;
  await database.collection("email_outbox").updateMany(
    {
      dedupe_key: { $regex: prefix },
      sensitive: true,
      status: { $in: ["pending", "retry"] },
    },
    {
      $set: {
        status: "superseded",
        message: "[Completed approval email removed]",
        updated_at: new Date(),
      },
    },
  );
}

async function decideApprovalFromEmail(database, context, decision, remarks) {
  if (!["approve", "reject"].includes(decision))
    throw requestError("Select approve or reject", 400);
  const cleanRemarks = textValue(remarks, 2000);
  if (decision === "reject" && !cleanRemarks)
    throw requestError("Remarks are required when rejecting a request", 400);
  const { approval, ticket, user } = context;
  const mapping = decision === "approve"
    ? { approval: "Approved", ticket: "Approved - Ready for Action" }
    : { approval: "Rejected", ticket: "Approval Rejected" };
  const now = new Date();
  const result = await database.collection("approvals").updateOne(
    { id: approval.id, ticket_id: ticket.id, status: "Pending" },
    {
      $set: {
        status: mapping.approval,
        approved_amount:
          decision === "approve" ? approval.requested_amount || null : null,
        decision_remarks:
          cleanRemarks || "Approved from the secure email decision page",
        decided_by: user.name,
        decision_channel: "email",
        updated_at: now,
      },
      $push: {
        history: {
          action: decision,
          by: user.name,
          at: now,
          remarks: cleanRemarks,
          channel: "email",
        },
      },
    },
  );
  if (!result.modifiedCount)
    throw requestError("This approval has already been completed", 409);
  await database.collection("tickets").updateOne(
    { id: ticket.id },
    {
      $set: {
        status: mapping.ticket,
        [`status_timestamps.${lifecycleStatusKey(mapping.ticket)}`]: now,
        updated_at: now,
      },
    },
  );
  await addHistory(
    database,
    ticket.id,
    "approval",
    user,
    `${decision.toUpperCase()} from secure email: ${cleanRemarks}`,
    ticket.status,
    mapping.ticket,
  );
  await notify(
    database,
    ticket.assignee_id,
    `Approval ${mapping.approval} for ${ticket.human_id}`,
    ticket,
  );
  await supersedePendingApprovalEmails(database, approval.id);
  await audit(database, user, "approval.email_decision", "ticket", ticket.id, {
    decision,
    approval_id: approval.id,
    channel: "email",
  });
  return mapping;
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
    "escalation",
    { email: false },
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

function itTicketScope() {
  // Every IT member sees the whole IT team's tickets (both sites, all
  // statuses) so team boards and resolved/closed columns stay complete.
  // Claiming, allocating and status updates remain guarded separately:
  // claims stay site-scoped via canAccessTicket and updates require the
  // assigned member or a team head.
  return { department: "IT" };
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
  if (!site) return !ticket.assignee_id || session.is_team_head;
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
      {
        $or: [
          { assignee_id: null },
          { assignee_id: "" },
          { assignee_id: { $exists: false } },
        ],
      },
      { $set: { allocation_status: "unallocated", queue_state: "pending" } },
    ),
    tickets.updateMany(
      { assignee_id: { $exists: true, $nin: [null, ""] } },
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
  if (session.role === "it") return itTicketScope();
  if (session.role === "admin") return { department: "Admin" };
  // Employees can see tickets they raised and tickets explicitly raised for them.
  return { $or: [{ raised_by_id: session.id }, { issue_user_id: session.id }] };
}

const requesterId = (ticket) => ticket.issue_user_id || ticket.raised_by_id;

async function ticketAcknowledgementRequired(database, ticket) {
  if (typeof ticket.acknowledgement_required === "boolean")
    return ticket.acknowledgement_required;
  const requesterIds = [ticket.issue_user_id, ticket.raised_by_id].filter(
    Boolean,
  );
  if (!requesterIds.length) return false;
  const requesters = await database
    .collection("users")
    .find({ id: { $in: requesterIds } })
    .toArray();
  const issueUser = requesters.find((user) => user.id === ticket.issue_user_id);
  if (issueUser) return issueUser.role === "employee";
  const raisedBy = requesters.find((user) => user.id === ticket.raised_by_id);
  return raisedBy?.role === "employee";
}

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
    "Ajeet Kumar",
    "Resolve",
  ],
  [
    "Utakrsh",
    "Biometric",
    "Low",
    "Biometric IP assign",
    "Ajeet Kumar",
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
    "Ajeet Kumar",
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
    "Ajeet Kumar",
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

const KRA_CUTOFF = "19:00";
const KRA_TIME_ZONE = "Asia/Kolkata";

function kraDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: KRA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function kraDeadlineAt(date, cutoff = KRA_CUTOFF) {
  const [year, month, day] = String(date).split("-").map(Number);
  const [hour, minute] = String(cutoff).split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute) - 330 * 60_000,
  );
}

function kraRunsOnDate(list, date) {
  if (String(list.frequency || "").toLowerCase() !== "weekdays") return true;
  const day = new Date(`${date}T12:00:00+05:30`).getUTCDay();
  return day !== 0 && day !== 6;
}

function kraSubmissionCompleted(list, submission) {
  return Boolean(
    submission &&
      Number(submission.done_count || 0) >= (list.items || []).length &&
      (list.items || []).length > 0,
  );
}

async function ensureKraDefaults(database) {
  await database.collection("member_checklists").updateMany(
    { cutoff: { $ne: KRA_CUTOFF } },
    { $set: { cutoff: KRA_CUTOFF, updated_at: new Date() } },
  );
}

async function processKraEscalations(
  database,
  date = kraDateKey(),
  now = new Date(),
) {
  const lists = await database
    .collection("member_checklists")
    .find({ active: true })
    .toArray();
  const submissions = await database
    .collection("member_checklist_submissions")
    .find({ date })
    .toArray();
  const byChecklist = new Map(
    submissions.map((submission) => [submission.checklist_id, submission]),
  );
  const superAdmins = await database
    .collection("users")
    .find({ role: "super_admin", active: { $ne: false } })
    .toArray();
  let created = 0;
  for (const list of lists) {
    if (!kraRunsOnDate(list, date)) continue;
    const deadline = kraDeadlineAt(date, list.cutoff || KRA_CUTOFF);
    if (!deadline || now <= deadline) continue;
    const submission = byChecklist.get(list.id);
    const completedOnTime =
      kraSubmissionCompleted(list, submission) &&
      submission?.submitted_at &&
      new Date(submission.submitted_at) <= deadline;
    if (completedOnTime) continue;
    const existing = await database
      .collection("kra_escalations")
      .findOne({ checklist_id: list.id, date });
    if (existing) continue;
    const escalation = {
      id: `kra_${createHash("sha256")
        .update(`${list.id}:${date}`)
        .digest("hex")}`,
      checklist_id: list.id,
      checklist_title: list.title,
      member_id: list.member_id,
      member_name: list.member_name,
      member_role: list.member_role,
      date,
      cutoff: KRA_CUTOFF,
      deadline_at: deadline,
      status: submission ? "late_or_incomplete" : "not_submitted",
      done_count: Number(submission?.done_count || 0),
      total: (list.items || []).length,
      created_at: now,
    };
    try {
      await database.collection("kra_escalations").insertOne(escalation);
    } catch (error) {
      if (error?.code === 11000) continue;
      throw error;
    }
    const recipients = [list.member_id, ...superAdmins.map((user) => user.id)];
    await notify(
      database,
      recipients,
      `KRA escalation: ${list.member_name} missed the 7:00 PM cut-off for ${list.title}`,
      null,
      "escalation",
    );
    await audit(
      database,
      null,
      "member_checklist.overdue",
      "member_checklist",
      list.id,
      { date, cutoff: KRA_CUTOFF, escalation_id: escalation.id },
    );
    created += 1;
  }
  return created;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  row.push(value.replace(/\r$/, ""));
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function spreadsheetTaskRows(rows) {
  const populated = rows
    .map((row) => row.map((cell) => String(cell || "").trim()))
    .filter((row) => row.some(Boolean));
  if (!populated.length) return [];
  const taskHeader =
    /^(task|tasks|daily work|work item|activity|activities|responsibility|responsibilities|kra|description)$/i;
  const headerIndex = populated[0].findIndex((cell) => taskHeader.test(cell));
  const source = headerIndex >= 0 ? populated.slice(1) : populated;
  const items = source
    .map((row) =>
      (headerIndex >= 0 ? row[headerIndex] : row.find(Boolean) || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300),
    )
    .filter((item) => item && !taskHeader.test(item));
  return [...new Set(items)].slice(0, 200);
}

async function tasksFromSpreadsheet(file) {
  if (!file || typeof file.arrayBuffer !== "function")
    throw requestError("Choose an Excel (.xlsx) or CSV file", 400);
  if (file.size > 4 * 1024 * 1024)
    throw requestError("The KRA spreadsheet must be 4 MB or smaller", 413);
  const name = String(file.name || "").toLowerCase();
  let rows;
  let sheetName = "CSV";
  if (name.endsWith(".csv")) {
    rows = parseCsvRows(await file.text());
  } else if (name.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()));
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw requestError("The workbook has no worksheets", 400);
    sheetName = worksheet.name;
    rows = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        values[column - 1] = cell.value?.formula ? "" : cell.text;
      });
      rows.push(values);
    });
  } else {
    throw requestError("Use an .xlsx or .csv KRA spreadsheet", 400);
  }
  const items = spreadsheetTaskRows(rows);
  if (!items.length)
    throw requestError(
      "No daily work rows were found. Add a Task, Daily Work, Activity or Responsibility column.",
      400,
    );
  return { items, sheet_name: sheetName, rows_imported: items.length };
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
      name: "Rajeev Goyal",
      email: "admin@ethara.ai",
      role: "admin",
      department: "Admin",
      employee_id: "ADM-3001",
      location: "Lotus - Bullpen",
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
  // Never ship a reusable fixture credential in source control. Developers who
  // deliberately enable seeding must provide a strong local-only password.
  const seedPassword = process.env.SEED_DEMO_PASSWORD;
  const seedPasswordError = passwordPolicyError(seedPassword);
  if (seedPasswordError)
    throw requestError(`SEED_DEMO_PASSWORD: ${seedPasswordError}`, 503);
  const seedPasswordHash = await bcrypt.hash(seedPassword, 12);
  const userDocs = users.map((u) => ({
    id: uuidv4(),
    password_hash: seedPasswordHash,
    seeded_fixture: true,
    active: true,
    email_verified: true,
    created_at: new Date(),
    ...u,
  }));
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

  // Demo logins must not make operational dashboards look populated. Business
  // fixtures remain available only for an explicitly requested legacy demo.
  if (process.env.SEED_DEMO_BUSINESS_DATA !== "true") {
    const templateDocs = LOCATIONS.map((location) => ({
      id: uuidv4(),
      name: `Daily Facility Checklist - ${location.name}`,
      location: location.name,
      code: location.code,
      frequency: "daily",
      items: CHECKLIST_ITEMS.map((label, index) => ({
        key: `item_${index}`,
        label,
      })),
      created_at: new Date(),
    }));
    await db.collection("checklist_templates").insertMany(templateDocs);
    return {
      seeded: true,
      users: users.map((user) => ({ email: user.email, role: user.role })),
      business_fixtures: false,
    };
  }

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

    if (requestBodyTooLarge(request, route))
      return json({ error: "Request body is too large" }, 413);
    if (rejectsCrossSiteMutation(request))
      return json({ error: "Cross-site request rejected" }, 403);

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
          "email_outbox",
          "email_verifications",
          "login_otp_challenges",
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
    if (route === "/auth/demo-accounts" && method === "GET") {
      if (!demoLoginAllowed(request))
        return json({ error: "Not found" }, 404);
      const accounts = await db
        .collection("users")
        .find({ seeded_fixture: true, active: { $ne: false } })
        .toArray();
      return json({
        accounts: accounts
          .map((user) => ({
            email: user.email,
            name: user.name,
            role: user.role,
          }))
          .sort((a, b) =>
            `${a.role}:${a.name}`.localeCompare(`${b.role}:${b.name}`),
          ),
      });
    }
    if (route === "/auth/demo-login" && method === "POST") {
      if (!demoLoginAllowed(request))
        return json({ error: "Not found" }, 404);
      const body = await request.json();
      const email = (
        typeof body.email === "string" ? body.email : ""
      )
        .toLowerCase()
        .trim();
      const rate = await db.consumeRateLimit(
        requestRateLimitKey("demo-login", request, email),
        20,
        15 * 60_000,
      );
      if (rate.limited)
        return json({ error: "Too many login attempts. Try again later." }, 429);
      const user = await db.collection("users").findOne({
        email,
        seeded_fixture: true,
        active: { $ne: false },
      });
      if (!user) return json({ error: "Demo account is unavailable" }, 404);
      if (body.location && !ticketLocationSite(body.location))
        return json({ error: "Select Tulip or Lotus as your location" }, 400);
      const response = await createLoginSessionResponse(
        user,
        body.remember,
        body.location,
      );
      await clearLoginAttempts(db, request, email);
      await audit(db, user, "login.demo", "user", user.id, {});
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
      const employeeId = textValue(body.employee_id, 50);
      if (body.location && !ticketLocationSite(body.location))
        return json({ error: "Select Tulip or Lotus as your location" }, 400);
      if (await loginRateLimited(db, request, email))
        return json({ error: "Too many login attempts. Try again later." }, 429);
      if (
        email.length > 254 ||
        !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@ethara\.ai$/i.test(email)
      ) {
        return json(
          { error: "Only @ethara.ai email addresses are allowed" },
          400,
        );
      }
      const user = await db.collection("users").findOne({ email });
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return json({ error: "Invalid credentials" }, 401);
      }
      // Accounts without an employee ID on file (legacy records) skip the
      // check so they are not locked out; the same generic error as a wrong
      // password keeps accounts unprobeable.
      const storedEmployeeId = textValue(user.employee_id, 50);
      if (
        storedEmployeeId &&
        storedEmployeeId.toLowerCase() !== employeeId.toLowerCase()
      ) {
        return json({ error: "Invalid credentials" }, 401);
      }
      if (
        user.seeded_fixture === true &&
        process.env.ALLOW_DEMO_LOGIN !== "true"
      )
        return json({ error: "Invalid credentials" }, 401);
      if (user.email_verification_required && !user.email_verified_at)
        return json({ error: "Verify your email address before signing in" }, 403);
      if (user.active === false)
        return json({ error: "This account has been disabled. Contact your administrator." }, 403);
      await clearLoginAttempts(db, request, email);
      if (loginOtpRequired()) {
        if (!emailDeliveryConfigured())
          return json(
            {
              error:
                "Login verification email is not configured. Contact your administrator.",
            },
            503,
          );
        const issued = await issueLoginOtp(
          db,
          request,
          user,
          body.remember,
          body.location,
        );
        if (issued.error) return json({ error: issued.error }, 429);
        const challengeToken = await loginChallengeToken(
          issued.challenge,
          user,
        );
        const response = json({
          otp_required: true,
          masked_email: maskEmail(user.email),
          expires_in: LOGIN_OTP_TTL_MS / 1000,
          resend_after: LOGIN_OTP_RESEND_MS / 1000,
          delivery_state: issued.delivery.delivered ? "sent" : "queued",
        });
        setLoginChallengeCookie(response, challengeToken);
        await audit(db, user, "login.otp_requested", "user", user.id, {
          delivery_state: issued.delivery.delivered ? "sent" : "queued",
        });
        return response;
      }
      const response = await createLoginSessionResponse(
        user,
        body.remember,
        body.location,
      );
      await audit(db, user, "login", "user", user.id, {
        otp: false,
      });
      return response;
    }
    if (route === "/auth/login/otp/verify" && method === "POST") {
      const body = await request.json();
      const code = typeof body.code === "string" ? body.code.trim() : "";
      if (!/^\d{6}$/.test(code))
        return json({ error: "Enter the 6-digit verification code" }, 400);
      const tokenSession = await getLoginChallengeSession(request);
      if (!tokenSession)
        return json(
          { error: "Your login verification session has expired" },
          401,
        );
      const now = new Date();
      const challenge = await db.collection("login_otp_challenges").findOne({
        id: tokenSession.challenge_id,
        user_id: tokenSession.user_id,
        consumed_at: null,
        expires_at: { $gt: now },
      });
      if (!challenge)
        return json(
          { error: "This verification code has expired. Sign in again." },
          401,
        );
      const verifyLimit = await db.consumeRateLimit(
        requestRateLimitKey("login-otp-verify", request, challenge.id),
        LOGIN_OTP_MAX_ATTEMPTS,
        LOGIN_OTP_TTL_MS,
      );
      if (verifyLimit.limited)
        return json(
          { error: "Too many verification attempts. Sign in again." },
          429,
        );
      if (Number(challenge.attempts || 0) >= LOGIN_OTP_MAX_ATTEMPTS)
        return json(
          { error: "Too many incorrect codes. Sign in again." },
          429,
        );
      const user = await db.collection("users").findOne({
        id: challenge.user_id,
        active: { $ne: false },
      });
      if (
        !user ||
        Number(user.session_version || 0) !==
          Number(tokenSession.session_version || 0)
      )
        return json({ error: "Your login session is no longer valid" }, 401);
      if (!otpMatches(challenge.code_hash, challenge.id, code)) {
        const attempts = Number(challenge.attempts || 0) + 1;
        await db.collection("login_otp_challenges").updateOne(
          { id: challenge.id, consumed_at: null },
          {
            $set: {
              attempts,
              last_failed_at: now,
              updated_at: now,
            },
          },
        );
        await audit(db, user, "login.otp_failed", "user", user.id, {
          attempts,
        });
        return json(
          {
            error:
              attempts >= LOGIN_OTP_MAX_ATTEMPTS
                ? "Too many incorrect codes. Sign in again."
                : `Incorrect code. ${LOGIN_OTP_MAX_ATTEMPTS - attempts} attempt${LOGIN_OTP_MAX_ATTEMPTS - attempts === 1 ? "" : "s"} remaining.`,
          },
          attempts >= LOGIN_OTP_MAX_ATTEMPTS ? 429 : 401,
        );
      }
      const consumed = await db.collection("login_otp_challenges").updateOne(
        { id: challenge.id, consumed_at: null },
        { $set: { consumed_at: now, updated_at: now } },
      );
      if (!consumed.modifiedCount)
        return json({ error: "This verification code was already used" }, 409);
      const response = await createLoginSessionResponse(
        user,
        challenge.remember,
        challenge.login_site,
      );
      await db.clearRateLimit(
        requestRateLimitKey("login-otp-verify", request, challenge.id),
      );
      await audit(db, user, "login", "user", user.id, { otp: true });
      await audit(db, user, "login.otp_verified", "user", user.id, {});
      return response;
    }
    if (route === "/auth/login/otp/resend" && method === "POST") {
      const tokenSession = await getLoginChallengeSession(request);
      if (!tokenSession)
        return json(
          { error: "Your login verification session has expired" },
          401,
        );
      if (!emailDeliveryConfigured())
        return json({ error: "Verification email is not configured" }, 503);
      const now = new Date();
      const challenge = await db.collection("login_otp_challenges").findOne({
        id: tokenSession.challenge_id,
        user_id: tokenSession.user_id,
        consumed_at: null,
        expires_at: { $gt: now },
      });
      if (!challenge)
        return json({ error: "Sign in again to request a new code" }, 401);
      if (
        challenge.next_resend_at &&
        new Date(challenge.next_resend_at).getTime() > now.getTime()
      ) {
        const wait = Math.ceil(
          (new Date(challenge.next_resend_at).getTime() - now.getTime()) / 1000,
        );
        return json(
          { error: `Wait ${wait} seconds before requesting another code` },
          429,
        );
      }
      const sendLimit = await db.consumeRateLimit(
        requestRateLimitKey("login-otp-send", request, challenge.user_id),
        5,
        60 * 60_000,
      );
      if (sendLimit.limited)
        return json(
          { error: "Too many verification codes requested. Try again later." },
          429,
        );
      const user = await db.collection("users").findOne({
        id: challenge.user_id,
        active: { $ne: false },
      });
      if (
        !user ||
        Number(user.session_version || 0) !==
          Number(tokenSession.session_version || 0)
      )
        return json({ error: "Your login session is no longer valid" }, 401);
      const code = String(randomInt(100000, 1000000));
      const resendCount = Number(challenge.resend_count || 0) + 1;
      const expiresAt = new Date(now.getTime() + LOGIN_OTP_TTL_MS);
      const nextResendAt = new Date(now.getTime() + LOGIN_OTP_RESEND_MS);
      await supersedePendingLoginOtpEmails(db, user.id);
      await db.collection("login_otp_challenges").updateOne(
        { id: challenge.id, consumed_at: null },
        {
          $set: {
            code_hash: loginOtpDigest(challenge.id, code),
            attempts: 0,
            resend_count: resendCount,
            expires_at: expiresAt,
            next_resend_at: nextResendAt,
            updated_at: now,
          },
        },
      );
      const updatedChallenge = {
        ...challenge,
        code_hash: loginOtpDigest(challenge.id, code),
        attempts: 0,
        resend_count: resendCount,
        expires_at: expiresAt,
        next_resend_at: nextResendAt,
      };
      const delivery = await queueLoginOtp(
        db,
        user,
        updatedChallenge,
        code,
        resendCount,
      );
      const response = json({
        ok: true,
        masked_email: maskEmail(user.email),
        expires_in: LOGIN_OTP_TTL_MS / 1000,
        resend_after: LOGIN_OTP_RESEND_MS / 1000,
        delivery_state: delivery.delivered ? "sent" : "queued",
      });
      setLoginChallengeCookie(
        response,
        await loginChallengeToken(updatedChallenge, user),
      );
      await audit(db, user, "login.otp_resent", "user", user.id, {
        resend_count: resendCount,
      });
      return response;
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
            active: true,
            activation_pending_reason: null,
            updated_at: now,
          },
        },
      );
      await audit(db, user, "auth.email_verified", "user", user.id, {});
      return redirect("success");
    }
    if (route === "/auth/register" && method === "POST") {
      const b = await request.json();
      // Coerce to strings so non-string (e.g. object) input is rejected with a
      // 400 rather than throwing downstream (bcrypt.hash / .toLowerCase).
      const email = (typeof b.email === "string" ? b.email : "")
        .toLowerCase()
        .trim();
      // Limit per email address, with a much larger per-client backstop.
      // Keying only on the client address put every registration in the whole
      // deployment into a single 10/hour bucket: NextRequest exposes no IP, so
      // requestClientAddress returns a constant unless TRUST_PROXY is set, and
      // ten signups anywhere locked out everyone else for an hour.
      const [emailLimit, clientLimit] = await Promise.all([
        db.consumeRateLimit(
          requestRateLimitKey("register", request, email),
          5,
          60 * 60_000,
        ),
        db.consumeRateLimit(
          requestRateLimitKey("register-client", request),
          200,
          60 * 60_000,
        ),
      ]);
      if (emailLimit.limited || clientLimit.limited)
        return json(
          { error: "Too many registration attempts. Try again later." },
          429,
        );
      const name = textValue(b.name, 150);
      const password = typeof b.password === "string" ? b.password : "";
      if (
        email.length > 254 ||
        !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@ethara\.ai$/i.test(email)
      ) {
        return json(
          { error: "Registration is restricted to @ethara.ai email addresses" },
          400,
        );
      }
      const passwordError = passwordPolicyError(password);
      if (!name || passwordError) {
        return json(
          {
            error: !name ? "Name is required" : passwordError,
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
      const registrationSite = ticketLocationSite(b.location);
      if (!registrationSite)
        return json(
          { error: "Please select a valid work location (Tulip or Lotus)" },
          400,
        );
      const registrationEmployeeId = textValue(b.employee_id, 50);
      if (!registrationEmployeeId)
        return json({ error: "Employee ID is required" }, 400);
      const existing = await db.collection("users").findOne({ email });
      if (existing)
        return json(
          { error: "An account with this email already exists" },
          409,
        );
      const department =
        role === "it" ? "IT" : role === "admin" ? "Admin" : "General";
      const requiresEmailVerification = emailVerificationRequired();
      if (requiresEmailVerification && !emailDeliveryConfigured())
        return json(
          {
            error:
              "Registration email verification is temporarily unavailable. Contact your administrator.",
          },
          503,
        );
      const verificationOrigin = requiresEmailVerification
        ? publicAppOrigin(request)
        : null;
      const hash = await bcrypt.hash(password, 12);
      const now = new Date();
      const user = {
        id: uuidv4(),
        name,
        email,
        role,
        department,
        password_hash: hash,
        employee_id: registrationEmployeeId,
        location: registrationSite,
        is_team_head: Boolean(managerSite),
        managed_locations: managerSite ? [managerSite] : [],
        // Accounts are active as soon as registration (and email verification,
        // when enabled) completes; a Super Admin can disable an account later.
        active: !requiresEmailVerification,
        activation_pending_reason: requiresEmailVerification
          ? "email_verification"
          : null,
        email_verification_required: requiresEmailVerification,
        email_verified_at: requiresEmailVerification ? null : now,
        session_version: 0,
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
      const token = await new SignJWT({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        session_version: 0,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("7d")
        .setIssuedAt()
        .setJti(uuidv4())
        .sign(jwtSecret());
      const res = json({ user: clean(user) });
      res.cookies.set("tf_token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: sessionCookieSecure(),
        path: "/",
        maxAge: 7 * 24 * 3600,
      });
      await audit(db, user, "register", "user", user.id, { role });
      return res;
    }
    if (route === "/auth/password-reset-request" && method === "POST") {
      const b = await request.json();
      const email = (typeof b.email === "string" ? b.email : "")
        .toLowerCase()
        .trim();
      const employeeId = textValue(b.employee_id, 50);
      const [emailLimit, clientLimit] = await Promise.all([
        db.consumeRateLimit(
          requestRateLimitKey("password-reset", request, email),
          3,
          60 * 60_000,
        ),
        db.consumeRateLimit(
          requestRateLimitKey("password-reset-client", request),
          30,
          60 * 60_000,
        ),
      ]);
      if (emailLimit.limited || clientLimit.limited)
        return json({ error: "Too many reset requests. Try again later." }, 429);
      // Always the same response so account existence cannot be probed.
      const generic = {
        ok: true,
        message:
          "If the account exists, the Super Admin has been notified and will reset your password.",
      };
      if (
        email.length > 254 ||
        !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@ethara\.ai$/i.test(email)
      )
        return json(generic);
      const user = await db.collection("users").findOne({ email });
      if (!user || user.active === false) return json(generic);
      const storedEmployeeId = textValue(user.employee_id, 50);
      if (
        storedEmployeeId &&
        employeeId &&
        storedEmployeeId.toLowerCase() !== employeeId.toLowerCase()
      )
        return json(generic);
      const pending = await db
        .collection("password_reset_requests")
        .findOne({ user_id: user.id, status: "pending" });
      if (!pending) {
        await db.collection("password_reset_requests").insertOne({
          id: uuidv4(),
          user_id: user.id,
          name: user.name,
          email: user.email,
          employee_id: storedEmployeeId,
          status: "pending",
          created_at: new Date(),
        });
        const superAdmins = await db
          .collection("users")
          .find({ role: "super_admin", active: { $ne: false } })
          .toArray();
        await notify(
          db,
          superAdmins.map((admin) => admin.id),
          `Password reset requested by ${user.name} (${user.email}). Review it in Member settings.`,
          null,
          "reminder",
        );
        await audit(db, user, "auth.password_reset_requested", "user", user.id, {});
      }
      return json(generic);
    }
    if (route === "/auth/logout" && method === "POST") {
      const tokenSession = await getSession(request);
      if (tokenSession) {
        const sessionUser = await db
          .collection("users")
          .findOne({ id: tokenSession.id });
        if (sessionUser && sessionVersionMatches(sessionUser, tokenSession))
          await db.collection("users").updateOne(
            { id: sessionUser.id },
            {
              $inc: { session_version: 1 },
              $set: { sessions_revoked_at: new Date() },
            },
          );
      }
      const res = json({ ok: true });
      res.cookies.set("tf_token", "", {
        httpOnly: true,
        sameSite: "lax",
        secure: sessionCookieSecure(),
        path: "/",
        maxAge: 0,
      });
      return res;
    }
    if (route === "/auth/me" && method === "GET") {
      const s = await getSession(request);
      if (!s) return json({ user: null }, 200);
      const user = await db.collection("users").findOne({ id: s.id });
      if (
        !user ||
        user.active === false ||
        !sessionVersionMatches(user, s)
      )
        return json({ user: null }, 200);
      const selectedSite = loginSite(s.login_site, user);
      return json({
        user: { ...clean(user), location: selectedSite, login_site: selectedSite },
      });
    }

    // Email links are bearer-authorized, bound to one active Super Admin and
    // read-only on GET. The decision itself is deliberately a confirmed POST
    // so automated email link scanners cannot approve or reject requests.
    if (route === "/approvals/email-action" && method === "GET") {
      const token = new URL(request.url).searchParams.get("token") || "";
      try {
        const context = await approvalEmailContext(db, token);
        return approvalEmailResponse({
          title: "Approval decision required",
          message: `Review this request as ${context.user.name}. You can approve or reject it below, or close this page and decide from the dashboard.`,
          context,
          token,
        });
      } catch (error) {
        return approvalEmailResponse(
          {
            title: "Approval link unavailable",
            message: error?.message || "This approval link cannot be used.",
          },
          error?.statusCode || 400,
        );
      }
    }
    if (route === "/approvals/email-action" && method === "POST") {
      let form;
      try {
        form = await request.formData();
      } catch {
        return approvalEmailResponse(
          {
            title: "Decision not recorded",
            message: "The submitted approval form was invalid.",
          },
          400,
        );
      }
      const token = textValue(form.get("token"), 4096);
      const decision = textValue(form.get("decision"), 20).toLowerCase();
      const remarks = textValue(form.get("remarks"), 2000);
      let context;
      try {
        context = await approvalEmailContext(db, token);
        const result = await decideApprovalFromEmail(
          db,
          context,
          decision,
          remarks,
        );
        return approvalEmailResponse({
          title: `Request ${result.approval.toLowerCase()}`,
          message: `${context.ticket.human_id} was ${result.approval.toLowerCase()} successfully. The dashboard and audit trail have been updated.`,
          context,
          success: true,
        });
      } catch (error) {
        return approvalEmailResponse(
          {
            title: "Decision not recorded",
            message: error?.message || "This approval decision could not be recorded.",
            context,
            token: context ? token : null,
          },
          error?.statusCode || 400,
        );
      }
    }

    // everything below requires auth
    const tokenSession = await getSession(request);
    if (!tokenSession) return json({ error: "Unauthorized" }, 401);
    const sessionUser = await db.collection("users").findOne({ id: tokenSession.id });
    if (!sessionUser || sessionUser.active === false)
      return json({ error: "Account disabled" }, 401);
    if (!sessionVersionMatches(sessionUser, tokenSession))
      return json({ error: "Session expired" }, 401);
    // Authorization always uses current database state, not potentially stale JWT claims.
    const session = {
      id: sessionUser.id,
      name: sessionUser.name,
      email: sessionUser.email,
      role: sessionUser.role,
      department: sessionUser.department,
      location: loginSite(tokenSession.login_site, sessionUser),
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
      if (await attachmentRateLimited(db, session.id, files))
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
    if (route === "/users/requesters" && method === "GET") {
      if (!["it", "admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const requesters = await db
        .collection("users")
        .find({ role: "employee", active: { $ne: false } })
        .sort({ name: 1 })
        .limit(1000)
        .toArray();
      return json(
        requesters.map((requester) => ({
          id: requester.id,
          name: requester.name,
          email: requester.email,
          employee_id: requester.employee_id || "",
          location: requester.location || "",
        })),
      );
    }
    if (route === "/users" && method === "GET") {
      let filter = {};
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
      if (
        b.role !== undefined &&
        !["employee", "it", "admin", "super_admin"].includes(b.role)
      )
        return json({ error: "Invalid member role" }, 400);
      if (b.active !== undefined && typeof b.active !== "boolean")
        return json({ error: "Active status must be true or false" }, 400);
      const removesActiveSuperAdmin =
        user.role === "super_admin" &&
        ((b.role !== undefined && b.role !== "super_admin") || b.active === false);
      if (
        removesActiveSuperAdmin &&
        (await db
          .collection("users")
          .countDocuments({ role: "super_admin", active: { $ne: false } })) <= 1
      )
        return json(
          { error: "At least one active Super Admin account is required" },
          409,
        );
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
      if (b.name !== undefined && typeof b.name !== "string")
        return json({ error: "Name must be text" }, 400);
      if (b.name?.trim()) set.name = textValue(b.name, 150);
      if (b.employee_id !== undefined) {
        if (typeof b.employee_id !== "string")
          return json({ error: "Employee code must be text" }, 400);
        set.employee_id = textValue(b.employee_id, 50);
      }
      if (b.location !== undefined) {
        if (typeof b.location !== "string" || !ticketLocationSite(b.location))
          return json({ error: "Select a Tulip or Lotus location" }, 400);
        set.location = textValue(b.location, 150);
      }
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
      let revokeSessions =
        (b.role !== undefined && b.role !== user.role) ||
        (typeof b.active === "boolean" && b.active !== user.active);
      if (b.password !== undefined && b.password !== "") {
        const passwordError = passwordPolicyError(b.password);
        if (passwordError) return json({ error: passwordError }, 400);
        set.password_hash = await bcrypt.hash(b.password, 12);
        set.password_reset_required = false;
        set.sessions_revoked_at = new Date();
        revokeSessions = true;
      }
      if (revokeSessions) set.sessions_revoked_at = new Date();
      set.updated_at = new Date();
      await db.collection("users").updateOne(
        { id: user.id },
        {
          $set: set,
          ...(revokeSessions ? { $inc: { session_version: 1 } } : {}),
        },
      );
      await audit(db, session, "user.settings.update", "user", user.id, {
        ...set,
        password_hash: set.password_hash ? "changed" : undefined,
      });
      return json(clean(await db.collection("users").findOne({ id: user.id })));
    }
    if (route === "/password-reset-requests" && method === "GET") {
      if (session.role !== "super_admin")
        return json({ error: "Forbidden" }, 403);
      const requests = await db
        .collection("password_reset_requests")
        .find({})
        .sort({ created_at: -1 })
        .limit(200)
        .toArray();
      return json(clean(requests));
    }
    if (seg[0] === "password-reset-requests" && seg[1] && method === "PATCH") {
      if (session.role !== "super_admin")
        return json({ error: "Forbidden" }, 403);
      const b = await request.json();
      if (!["completed", "dismissed"].includes(b.status))
        return json({ error: "Status must be completed or dismissed" }, 400);
      const resetRequest = await db
        .collection("password_reset_requests")
        .findOne({ id: seg[1] });
      if (!resetRequest) return json({ error: "Reset request not found" }, 404);
      if (resetRequest.status !== "pending")
        return json({ error: "This request is already resolved" }, 409);
      await db.collection("password_reset_requests").updateOne(
        { id: resetRequest.id },
        {
          $set: {
            status: b.status,
            resolved_by: session.id,
            resolved_by_name: session.name,
            resolved_at: new Date(),
          },
        },
      );
      await audit(
        db,
        session,
        "auth.password_reset_resolved",
        "password_reset_request",
        resetRequest.id,
        { status: b.status, user_id: resetRequest.user_id },
      );
      return json(
        clean(
          await db
            .collection("password_reset_requests")
            .findOne({ id: resetRequest.id }),
        ),
      );
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
      const requestedScope = new URL(request.url).searchParams.get("scope");
      const scope = ["summary", "security"].includes(requestedScope)
        ? requestedScope
        : "full";
      if (!globalThis[FIREWALL_OVERVIEW_CACHE_KEY])
        globalThis[FIREWALL_OVERVIEW_CACHE_KEY] = new Map();
      const overviewCache = globalThis[FIREWALL_OVERVIEW_CACHE_KEY];
      const overviewCacheKey = `${profile.id}:${scope}`;
      const cachedOverview = overviewCache.get(overviewCacheKey);
      if (cachedOverview && Date.now() - cachedOverview.createdAt < 30_000)
        return json(cachedOverview.payload);
      // Building an overview queries every appliance endpoint and pages
      // through its memory logs, which can take well over the client timeout.
      // Once any snapshot exists, serve it immediately and refresh in the
      // background; only the very first load for a scope waits on the
      // appliance. Concurrent cold requests share one in-flight fetch.
      if (!globalThis[FIREWALL_OVERVIEW_INFLIGHT_KEY])
        globalThis[FIREWALL_OVERVIEW_INFLIGHT_KEY] = new Map();
      const overviewInflight = globalThis[FIREWALL_OVERVIEW_INFLIGHT_KEY];
      const buildOverview = async () => {
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
      const scopedPaths = Object.entries(paths).filter(([name]) => {
        if (scope === "summary")
          return ![
            "logs",
            "events",
            "threat_antivirus",
            "threat_ips",
            "threat_web",
            "threat_dns",
          ].includes(name);
        if (scope === "security")
          return name === "events" || name.startsWith("threat_");
        return true;
      });
      if (!configured) {
        try {
          await recordFirewallHealth(db, profile, "unconfigured");
        } catch (error) {
          console.error("Firewall health tracking failed:", error);
        }
        const payload = {
          configured: false,
          connected: false,
          operational_state: "unconfigured",
          id: profile.id,
          label: profile.label,
          name: firewallDisplayName(profile),
          scope,
          sections: {},
          errors: {},
          last_updated: null,
        };
        overviewCache.set(overviewCacheKey, {
          createdAt: Date.now(),
          payload,
        });
        return payload;
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
        scopedPaths.map(async ([name, path]) => {
          try {
            const endpoint = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
            const isLogSection =
              name === "logs" || name === "events" || name.startsWith("threat_");
            const payload =
              isLogSection
                ? await firewallPaginatedRequest(endpoint, headers, tls, {
                    pageSize: Number(
                      fw(
                        name === "logs" ? "LOG_PAGE_ROWS" : "EVENT_PAGE_ROWS",
                        name === "logs" ? "10000" : "5000",
                      ),
                    ),
                    maxRows: Number(
                      fw(
                        name === "logs" ? "LOG_MAX_ROWS" : "EVENT_MAX_ROWS",
                        "100000",
                      ),
                    ),
                  })
                : await firewallRequest(endpoint, headers, tls);
            if (
              /error|fail/i.test(String(payload?.status || "")) ||
              Number(payload?.http_status || 200) >= 400
            )
              throw new Error(
                payload?.error ||
                  payload?.message ||
                  `Firewall returned ${payload?.status || "an error"}`,
              );
            return [name, sanitizeFirewallPayload(payload), null, path];
          } catch (error) {
            return [name, null, error.message || "Request failed", path];
          }
        }),
      );
      const sections = {},
        errors = {},
        threat_errors = {},
        section_meta = {};
      const fetchedAt = new Date();
      results.forEach(([name, payload, error, path]) => {
        if (error && name.startsWith("threat_")) threat_errors[name] = error;
        else if (error) errors[name] = error;
        else {
          sections[name] = payload;
          section_meta[name] = firewallSectionMetadata(payload, path, fetchedAt);
        }
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
        section_meta.devices = {
          ...(section_meta.dhcp || {}),
          source: "firewall_dhcp_active_leases",
          records_returned: liveLeases.length,
          records_available: liveLeases.length,
          complete: true,
        };
      } else if (scope !== "security") {
        sections.devices = [];
        sections.device_source = {
          type: "dhcp_unavailable",
          live_only: true,
          count: 0,
        };
        section_meta.devices = {
          source: "firewall_dhcp_active_leases",
          fetched_at: fetchedAt.toISOString(),
          records_returned: 0,
          records_available: 0,
          complete: false,
        };
      }
      if (sections.devices !== undefined) {
        const inventoryMapping = await mapFirewallInventory(
          firewallRows(sections.devices),
        );
        sections.devices = inventoryMapping.devices;
        sections.device_inventory = inventoryMapping.summary;
      }
      if (sections.logs) {
        const logRows = firewallRows(sections.logs);
        const logMapping = await mapFirewallInventory(
          logRows.map((row) => ({
            ...row,
            appliance_serial: section_meta.logs?.appliance_serial || "",
          })),
        );
        if (Array.isArray(sections.logs)) sections.logs = logMapping.devices;
        else if (Array.isArray(sections.logs.results))
          sections.logs = { ...sections.logs, results: logMapping.devices };
        else if (Array.isArray(sections.logs.data))
          sections.logs = { ...sections.logs, data: logMapping.devices };
        else if (Array.isArray(sections.logs.items))
          sections.logs = { ...sections.logs, items: logMapping.devices };
        sections.traffic_inventory = logMapping.summary;
        // The overview is a read path. Archiving here re-wrote the whole daily
        // archive document (up to ~250k embedded records) on every dashboard
        // load, and the document store takes a collection-wide lock to do it,
        // which made this endpoint hang for minutes. The scheduled archive
        // monitor and the manual /firewall/archive/sync already persist exactly
        // these rows via syncFirewallArchiveSnapshot, so nothing is lost.
      }
      const payload = {
        configured: true,
        connected: successfulSectionCount > 0,
        operational_state: operationalState,
        id: profile.id,
        label: profile.label,
        name: firewallDisplayName(profile),
        scope,
        appliance_identity: {
          serial:
            sections.status?.serial ||
            sections.status?.results?.serial ||
            null,
          hostname:
            sections.status?.results?.hostname ||
            sections.configuration?.results?.hostname ||
            null,
          model:
            sections.status?.results?.model_name ||
            sections.status?.results?.model ||
            null,
          firmware: sections.status?.version || null,
          build: sections.status?.build ?? null,
        },
        sections,
        section_meta,
        errors,
        threat_errors,
        last_updated: fetchedAt.toISOString(),
      };
      overviewCache.set(overviewCacheKey, {
        createdAt: Date.now(),
        payload,
      });
      if (overviewCache.size > 12)
        overviewCache.delete(overviewCache.keys().next().value);
      return payload;
      };
      let overviewPromise = overviewInflight.get(overviewCacheKey);
      if (!overviewPromise) {
        overviewPromise = buildOverview().finally(() => {
          overviewInflight.delete(overviewCacheKey);
        });
        overviewInflight.set(overviewCacheKey, overviewPromise);
      }
      if (cachedOverview) {
        overviewPromise.catch((error) =>
          console.error(
            "Firewall overview background refresh failed:",
            error?.message || error,
          ),
        );
        return json(cachedOverview.payload);
      }
      return json(await overviewPromise);
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

    if (route === "/firewall/bandwidth" && method === "GET") {
      if (!["it", "admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const profile = firewallProfile(request);
      const url = new URL(request.url);
      const days = Math.min(
        7,
        Math.max(1, Number(url.searchParams.get("days") || 7)),
      );
      const requestedHours = Number(url.searchParams.get("hours") || 0);
      const selectedDate = url.searchParams.get("date");
      const todayRequested = url.searchParams.get("today") === "true";
      if (selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate))
        return json({ error: "Invalid firewall bandwidth date" }, 400);
      const now = new Date();
      let end = new Date(now);
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
        if (start > now)
          return json({ error: "Firewall bandwidth date cannot be in the future" }, 400);
        const selectedDayEnd = new Date(
          `${selectedDate}T23:59:59.999+05:30`,
        );
        end = new Date(Math.min(now.getTime(), selectedDayEnd.getTime()));
        periodHours = Math.max(
          0,
          (end.getTime() - start.getTime()) / 3600000,
        );
      }
      if (!globalThis[FIREWALL_BANDWIDTH_CACHE_KEY])
        globalThis[FIREWALL_BANDWIDTH_CACHE_KEY] = new Map();
      const cache = globalThis[FIREWALL_BANDWIDTH_CACHE_KEY];
      const rangeKey = todayRequested
        ? "today"
        : selectedDate
          ? `date:${selectedDate}`
          : requestedHours > 0
            ? `hours:${periodHours}`
            : `days:${days}`;
      const cacheKey = `${profile.id}:${rangeKey}`;
      const cached = cache.get(cacheKey);
      let bandwidth;
      if (cached && Date.now() - cached.createdAt < 30_000) {
        bandwidth = cached.bandwidth;
      } else {
        bandwidth = await firewallBandwidthFromArchive(
          db,
          profile,
          start,
          end,
        );
        cache.set(cacheKey, { createdAt: Date.now(), bandwidth });
        if (cache.size > 20) cache.delete(cache.keys().next().value);
      }
      return json(
        clean({
          firewall: {
            id: profile.id,
            label: profile.label,
            name: firewallDisplayName(profile),
          },
          generated_at: now,
          period: {
            start,
            end,
            days: periodHours / 24,
            hours: periodHours,
          },
          summary: bandwidth.summary,
          clients: bandwidth.clients,
        }),
      );
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
      const now = new Date();
      const end = new Date(now);
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
        if (start > now)
          return json({ error: "Firewall report date cannot be in the future" }, 400);
        const selectedDayEnd = new Date(
          `${selectedDate}T23:59:59.999+05:30`,
        );
        end.setTime(Math.min(now.getTime(), selectedDayEnd.getTime()));
        periodHours = Math.max(
          0,
          (end.getTime() - start.getTime()) / 3600000,
        );
      }
      const basePath = fw("REPORT_PATH", fw("LOGS_PATH", "/api/logs"));
      const reportUrl = new URL(
        `${baseUrl}${basePath.startsWith("/") ? basePath : `/${basePath}`}`,
      );
      const configuredReportRows = Number(fw("REPORT_ROWS", "10000"));
      const reportPageRows = Number.isFinite(configuredReportRows)
        ? Math.min(10000, Math.max(100, Math.round(configuredReportRows)))
        : 10000;
      const configuredReportMaxRows = Number(fw("REPORT_MAX_ROWS", "100000"));
      const reportRowLimit = Number.isFinite(configuredReportMaxRows)
        ? Math.min(250000, Math.max(reportPageRows, Math.round(configuredReportMaxRows)))
        : 100000;
      const headerName = fw("API_HEADER", "Authorization");
      const prefix = fw("API_PREFIX", "Bearer");
      const requestHeaders = {
        Accept: "application/json",
        [headerName]: prefix ? `${prefix} ${apiKey}` : apiKey,
      };
      const requestTls = {
        allowSelfSigned: fw("ALLOW_SELF_SIGNED", "false") === "true",
        caPath: fw("CA_CERT_PATH", ""),
        certSha256: fw("CERT_SHA256", ""),
      };
      const applicationPath = fw(
        "APPLICATION_PATH",
        "/api/v2/log/memory/app-ctrl",
      );
      const applicationUrl = new URL(
        `${baseUrl}${applicationPath.startsWith("/") ? applicationPath : `/${applicationPath}`}`,
      );
      const applicationPageRows = Math.min(
        5000,
        Math.max(100, Number(fw("APPLICATION_PAGE_ROWS", "5000")) || 5000),
      );
      const applicationMaxRows = Math.min(
        50000,
        Math.max(
          applicationPageRows,
          Number(fw("APPLICATION_MAX_ROWS", "20000")) || 20000,
        ),
      );
      const [payload, applicationResult] = await Promise.all([
        firewallPaginatedRequest(
          reportUrl.toString(),
          requestHeaders,
          requestTls,
          { pageSize: reportPageRows, maxRows: reportRowLimit },
        ),
        firewallPaginatedRequest(
          applicationUrl.toString(),
          requestHeaders,
          requestTls,
          { pageSize: applicationPageRows, maxRows: applicationMaxRows },
        )
          .then((applicationPayload) => ({ payload: applicationPayload }))
          .catch((error) => ({
            error: error.message || "Application Control logs unavailable",
          })),
      ]);
      const allRows = firewallRows(payload);
      const datedRows = allRows.filter((row) => {
        const time = firewallRecordTime(row);
        return time && time >= start && time <= end;
      });
      const allApplicationRows = applicationResult.payload
        ? firewallRows(applicationResult.payload)
        : [];
      const applicationRetention = firewallApplicationRetentionSummary(
        allApplicationRows,
      );
      const datedApplicationRows = allApplicationRows.filter((row) => {
        const time = firewallRecordTime(row);
        return time && time >= start && time <= end;
      });
      const applicationMerge = enrichFirewallTrafficApplications(
        datedRows,
        datedApplicationRows,
      );
      const reportInventory = await mapFirewallInventory(
        applicationMerge.records,
      );
      const enrichedDatedRows = reportInventory.devices.map((row) => ({
        ...row,
        appliance_serial: payload?.serial || "",
      }));
      const apiRecords = enrichedDatedRows
        .map(normalizedFirewallRecord)
        .filter(Boolean);
      // Reports are read paths. Detailed persistence is handled by the
      // scheduled/manual archive sync, avoiding a large archive rewrite every
      // time a user changes a bandwidth or date filter.
      const archive = {
        managed_by: "automatic_archive_monitor",
        write_performed: false,
      };
      const includeArchivedRecords =
        !todayRequested && !(requestedHours > 0 && requestedHours <= 1);
      // Read the day documents with SQL rather than through the document
      // store: that helper has no filter pushdown, so it loaded and date-revived
      // every archive row (~1 GB across all days) just to keep the few days in
      // range. Postgres filters by firewall and date before anything is parsed.
      const archivedDays = includeArchivedRecords
        ? (
            await db.pool.query(
              `SELECT COALESCE(data->'records', '[]'::jsonb) AS records
                 FROM tms_documents
                WHERE collection_name = 'firewall_daily_archives'
                  AND data->>'firewall_id' = $1
                  AND data->>'date' >= $2
                  AND data->>'date' <= $3`,
              [profile.id, firewallArchiveDate(start), firewallArchiveDate(end)],
            )
          ).rows
        : [];
      const archivedRecordsAvailable = archivedDays.flatMap(
        (day) => day.records || [],
      );
      const expectedApplianceSerial = String(payload?.serial || "").trim();
      const archivedRecords = expectedApplianceSerial
        ? archivedRecordsAvailable.filter(
            (record) =>
              record.appliance_serial === expectedApplianceSerial,
          )
        : [];
      const unverifiedArchiveRecordsExcluded = Math.max(
        0,
        archivedRecordsAvailable.length - archivedRecords.length,
      );
      const mergedRecords = new Map();
      for (const row of [...archivedRecords, ...apiRecords]) {
        const normalized = normalizedFirewallRecord(row);
        const timestamp = normalized && new Date(normalized.timestamp);
        if (
          normalized &&
          timestamp >= start &&
          timestamp <= end
        )
          mergedRecords.set(firewallRecordFingerprint(normalized), normalized);
      }
      const records = [...mergedRecords.values()].sort(
        (left, right) =>
          new Date(right.timestamp).getTime() -
          new Date(left.timestamp).getTime(),
      );
      return json({
        firewall: {
          id: profile.id,
          label: profile.label,
          name: firewallDisplayName(profile),
        },
        generated_at: now.toISOString(),
        period: {
          start: start.toISOString(),
          end: end.toISOString(),
          days: periodHours / 24,
          hours: periodHours,
        },
        summary: {
          records: records.length,
          records_returned: Math.min(records.length, FIREWALL_REPORT_RECORD_LIMIT),
          records_truncated: records.length > FIREWALL_REPORT_RECORD_LIMIT,
          record_page_limit: FIREWALL_REPORT_RECORD_LIMIT,
          api_rows_returned: allRows.length,
          api_rows_fetched: Number(payload?.raw_rows_fetched || allRows.length),
          api_rows_available: Number(payload?.total_lines || allRows.length),
          duplicate_api_rows_removed: Number(payload?.duplicate_rows_removed || 0),
          api_pages_fetched: Number(payload?.pages_fetched || 1),
          pagination_stop_reason: payload?.pagination_stop_reason || null,
          archived_rows_available: archivedRecordsAvailable.length,
          archived_rows_considered: archivedRecords.length,
          unverified_archive_rows_excluded:
            unverifiedArchiveRecordsExcluded,
          appliance_serial: expectedApplianceSerial || null,
          source_identity_verified: Boolean(expectedApplianceSerial),
          api_row_limit: reportRowLimit,
          record_limit_reached: Boolean(payload?.row_limit_reached),
          source_complete: Boolean(
            payload?.pagination_complete &&
              unverifiedArchiveRecordsExcluded === 0,
          ),
          source: includeArchivedRecords
            ? "firewall_memory_logs_and_verified_daily_archive"
            : "firewall_memory_logs",
          archive_records_included: includeArchivedRecords,
          // reportInventory only saw the live API rows for this period, but
          // `records` also carries the archived rows merged in below. Counting
          // over `records` keeps this KPI describing the rows actually shown
          // (on HQ the two populations differed by ~226k rows).
          inventory: {
            mapped: records.filter((row) => row.inventory_match).length,
            unmapped: records.filter(
              (row) => !row.inventory_match && !row.inventory_conflict,
            ).length,
            ambiguous: records.filter((row) => row.inventory_conflict).length,
            inventory_macs: reportInventory.summary.inventory_macs,
            errors: reportInventory.summary.errors,
            api_rows_only: reportInventory.summary,
          },
          application_control: {
            ...applicationMerge.summary,
            ...applicationRetention,
            state: applicationResult.error
              ? "unavailable"
              : datedApplicationRows.length
                ? "identified"
                : "no_retained_logs",
            error: applicationResult.error || null,
            path: applicationPath.split("?")[0],
            rows_fetched: Number(
              applicationResult.payload?.raw_rows_fetched ||
                allApplicationRows.length,
            ),
            rows_available: Number(
              applicationResult.payload?.total_lines ||
                allApplicationRows.length,
            ),
            rows_in_period: datedApplicationRows.length,
            source_complete: applicationResult.payload
              ? Boolean(applicationResult.payload.pagination_complete)
              : false,
          },
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
        aggregates: firewallReportAggregates(records),
        records: records.slice(0, FIREWALL_REPORT_RECORD_LIMIT),
      });
    }

    if (route === "/firewall/archive/fallback" && method === "GET") {
      if (!["it", "admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const profile = firewallProfile(request);
      const archiveRows = await db.pool.query(
        `SELECT data - 'records' AS data
           FROM tms_documents
          WHERE collection_name = $1
            AND data->>'firewall_id' = $2
            AND COALESCE(data->>'appliance_serial', '') <> ''
            AND COALESCE((data#>>'{summary,verified_appliance_records}')::integer, 0) > 0
          ORDER BY data->>'date' DESC
          LIMIT 14`,
        ["firewall_daily_archives", profile.id],
      );
      const summaries = archiveRows.rows.map((row) => row.data);
      const summary =
        summaries.find((item) => item.protected_before_downtime) ||
        summaries[0];
      if (!summary)
        return json(
          { error: "No appliance-verified saved firewall records are available" },
          404,
        );
      const archive = summary;
      const expectedSerial = String(archive.appliance_serial || "").trim();
      const protectedAtRaw =
        archive.last_pre_downtime_snapshot?.protected_at ||
        archive.last_pre_downtime_protected_at ||
        null;
      const protectedAt = protectedAtRaw ? new Date(protectedAtRaw) : null;
      const configuredLimit = Number(profile.value("FALLBACK_MAX_ROWS", "25000"));
      const maxRows = Number.isFinite(configuredLimit)
        ? Math.min(50000, Math.max(1000, Math.round(configuredLimit)))
        : 25000;
      const readVerifiedRecords = (cutoff) =>
        db.pool.query(
          `SELECT record, COUNT(*) OVER() AS total_records
             FROM tms_documents archive
             CROSS JOIN LATERAL jsonb_array_elements(
               CASE
                 WHEN jsonb_typeof(archive.data->'records') = 'array'
                   THEN archive.data->'records'
                 ELSE '[]'::jsonb
               END
             ) AS record
            WHERE archive.collection_name = $1
              AND archive.document_key = $2
              AND record->>'appliance_serial' = $3
              AND ($4::timestamptz IS NULL OR (record->>'timestamp')::timestamptz <= $4::timestamptz)
            ORDER BY (record->>'timestamp')::timestamptz DESC
            LIMIT $5`,
          [
            "firewall_daily_archives",
            String(archive.id),
            expectedSerial,
            cutoff,
            maxRows,
          ],
        );
      let verifiedRows = protectedAt
        ? await readVerifiedRecords(protectedAt.toISOString())
        : { rows: [] };
      const useProtectedSnapshot = verifiedRows.rows.length > 0;
      if (!useProtectedSnapshot) verifiedRows = await readVerifiedRecords(null);
      const records = verifiedRows.rows
        .map((row) => normalizedFirewallRecord(row.record))
        .filter(Boolean);
      const recordsAvailable = Number(
        verifiedRows.rows[0]?.total_records || records.length,
      );
      if (!records.length)
        return json(
          { error: "The saved report has no records for this appliance serial" },
          404,
        );
      const timestamps = records
        .map((record) => new Date(record.timestamp))
        .filter((timestamp) => !Number.isNaN(timestamp.getTime()))
        .sort((left, right) => left - right);
      const identifiedApplications = new Set(
        records
          .filter((record) => record.application_identified === true)
          .map((record) => record.application)
          .filter(Boolean),
      );
      return json({
        firewall: {
          id: profile.id,
          label: profile.label,
          name: firewallDisplayName(profile),
        },
        generated_at: new Date().toISOString(),
        period: {
          start:
            timestamps[0]?.toISOString() ||
            `${archive.date}T00:00:00.000+05:30`,
          end:
            timestamps.at(-1)?.toISOString() ||
            `${archive.date}T23:59:59.999+05:30`,
          days: 1,
          hours: 24,
        },
        summary: {
          records: records.length,
          records_available: recordsAvailable,
          records_sampled: records.length < recordsAvailable,
          source: useProtectedSnapshot
            ? "appliance_verified_pre_downtime_archive"
            : "latest_appliance_verified_daily_archive",
          source_complete: Boolean(
            !archive.record_limit_reached &&
              records.length === recordsAvailable,
          ),
          source_identity_verified: true,
          appliance_serial: expectedSerial,
          archive_records_included: true,
          archive_fallback: true,
          archive_date: archive.date,
          archive_captured_at: archive.captured_at || null,
          archive_protected_before_downtime: useProtectedSnapshot,
          archived_rows_available: recordsAvailable,
          archived_rows_considered: records.length,
          traffic_bytes: records.reduce(
            (sum, record) =>
              sum + record.sent_bytes + record.received_bytes,
            0,
          ),
          application_control: {
            state: "archive_fallback",
            rows_in_period: records.filter(
              (record) => record.application_identified === true,
            ).length,
            unique_applications: identifiedApplications.size,
            source_complete: Boolean(
              !archive.record_limit_reached &&
                records.length === recordsAvailable,
            ),
          },
        },
        archive: {
          managed_by: "automatic_archive_monitor",
          write_performed: false,
          fallback: true,
          date: archive.date,
          protected_before_downtime: useProtectedSnapshot,
        },
        records,
      });
    }

    if (route === "/firewall/archive/export" && method === "GET") {
      if (!["it", "admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const url = new URL(request.url);
      const profile = firewallProfile(request);
      const date = url.searchParams.get("date");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const exportType =
        url.searchParams.get("type") === "summary" ? "summary" : "details";
      const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
      if (date && !validDate(date))
        return json({ error: "Invalid archive date" }, 400);
      if ((from && !validDate(from)) || (to && !validDate(to)))
        return json({ error: "Invalid archive date range" }, 400);
      if (validDate(from) && validDate(to) && from > to)
        return json({ error: "Archive start date must be before end date" }, 400);
      if (!validDate(date) && !validDate(from) && !validDate(to))
        return json({ error: "Select an archive date or date range" }, 400);
      const rangeStart = validDate(date) ? date : validDate(from) ? from : to;
      const rangeEnd = validDate(date) ? date : validDate(to) ? to : from;
      const days =
        Math.floor(
          (new Date(`${rangeEnd}T00:00:00Z`).getTime() -
            new Date(`${rangeStart}T00:00:00Z`).getTime()) /
            86400000,
        ) + 1;
      const maximumDays = exportType === "summary" ? 366 : 7;
      if (days > maximumDays)
        return json(
          {
            error:
              exportType === "summary"
                ? "Export up to 366 archive summary days at a time"
                : "Export up to 7 detailed archived days at a time",
          },
          400,
        );
      const archives = (
        await firewallArchiveIndex(db, profile.id, {
          from: rangeStart,
          to: rangeEnd,
          limit: maximumDays,
        })
      ).reverse();
      if (!archives.length)
        return json({ error: "No archived reports in that date range" }, 404);
      const totalRecords = archives.reduce(
        (sum, archive) => sum + archive.record_count,
        0,
      );
      const filename = `${profile.id}-firewall-archive-${exportType}-${rangeStart}${rangeStart === rangeEnd ? "" : `-to-${rangeEnd}`}.csv`;
      const body =
        exportType === "summary"
          ? firewallArchiveSummaryCsv(
              archives.map((archive) => archive.archive),
            )
          : firewallArchiveDatabaseCsvStream(db, archives);
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "X-Archive-Days": String(archives.length),
          "X-Archive-Records": String(totalRecords),
          "X-Archive-Export-Type": exportType,
        },
      });
    }

    if (route === "/firewall/archive/sync" && method === "POST") {
      if (!["it", "admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const profile = firewallProfile(request);
      return json(
        await syncFirewallArchiveSnapshot(db, profile.id, {
          reason: "manual_sync",
        }),
      );
    }

    if (route === "/firewall/archive" && method === "GET") {
      if (!["it", "admin", "super_admin"].includes(session.role))
        return json({ error: "Forbidden" }, 403);
      const url = new URL(request.url);
      const profile = firewallProfile(request);
      const date = url.searchParams.get("date");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
      if (date && !validDate(date))
        return json({ error: "Invalid archive date" }, 400);
      if ((from && !validDate(from)) || (to && !validDate(to)))
        return json({ error: "Invalid archive date range" }, 400);
      if (validDate(from) && validDate(to) && from > to)
        return json({ error: "Archive start date must be before end date" }, 400);
      const requestedLimit = Number(url.searchParams.get("limit") || 31);
      const limit = Math.min(365, Math.max(1, requestedLimit));
      if (validDate(date)) {
        const requestedRecordPage = Number(
          url.searchParams.get("record_page") || 1,
        );
        const requestedRecordLimit = Number(
          url.searchParams.get("record_limit") || 25,
        );
        const recordPage = Number.isFinite(requestedRecordPage)
          ? Math.max(1, Math.round(requestedRecordPage))
          : 1;
        const recordLimit = Number.isFinite(requestedRecordLimit)
          ? Math.min(100, Math.max(1, Math.round(requestedRecordLimit)))
          : 25;
        const index = await firewallArchiveIndex(db, profile.id, {
          date,
          limit: 1,
        });
        if (!index[0])
          return json({ error: "No archived report for that date" }, 404);
        const totalRecords = index[0].record_count;
        const totalPages = Math.max(1, Math.ceil(totalRecords / recordLimit));
        const currentPage = Math.min(recordPage, totalPages);
        const result = await firewallArchiveDayPage(
          db,
          profile.id,
          date,
          currentPage,
          recordLimit,
        );
        return json(
          clean({
            ...result.archive,
            records: result.records,
            record_pagination: {
              page: currentPage,
              page_size: recordLimit,
              total_records: totalRecords,
              total_pages: totalPages,
            },
          }),
        );
      }
      const archives = await firewallArchiveIndex(db, profile.id, {
        from: validDate(from) ? from : null,
        to: validDate(to) ? to : null,
        limit,
      });
      const captureStatus = await db
        .collection("firewall_health")
        .findOne(
          { firewall_id: profile.id },
          {
            projection: {
              last_archive_at: 1,
              last_archive_reason: 1,
              last_archive_records: 1,
              last_archive_source_complete: 1,
              last_archive_error: 1,
              last_archive_error_at: 1,
            },
          },
        );
      return json({
        firewall: { id: profile.id, label: profile.label },
        archives: clean(archives.map((item) => item.archive)),
        count: archives.length,
        capture_status: clean(captureStatus || null),
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
      const member = await db.collection("users").findOne({
        id: b.member_id,
        active: { $ne: false },
      });
      if (!member) return json({ error: "Member not found" }, 400);
      if (!["four_wheeler", "two_wheeler"].includes(b.vehicle_type))
        return json({ error: "Select a valid vehicle type" }, 400);
      const vehicleType = b.vehicle_type;
      const capacity = vehicleType === "four_wheeler" ? 12 : 90;
      const existing = await db
        .collection("parking_allocations")
        .find({ location: "Tulip", vehicle_type: vehicleType })
        .toArray();
      const occupied = new Set(existing.map((item) => item.slot_number));
      const requested = Number(b.slot_number || 0);
      if (b.slot_number && !Number.isInteger(requested))
        return json({ error: "Parking slot must be a whole number" }, 400);
      const slotNumber =
        requested ||
        Array.from({ length: capacity }, (_, index) => index + 1).find(
          (slot) => !occupied.has(slot),
        );
      if (!slotNumber || slotNumber < 1 || slotNumber > capacity)
        return json({ error: "No valid parking slot available" }, 400);
      if (occupied.has(slotNumber))
        return json({ error: "That parking slot is already allocated" }, 409);
      const vehicleNumber = textValue(b.vehicle_number, 20)
        .trim()
        .toUpperCase();
      if (!vehicleNumber)
        return json({ error: "Vehicle number is required" }, 400);
      if (!/^[A-Z0-9 -]{4,20}$/.test(vehicleNumber))
        return json({ error: "Enter a valid vehicle number" }, 400);
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
        notes: textValue(b.notes, 1000),
        allocated_by_id: session.id,
        allocated_by: session.name,
        created_at: new Date(),
      };
      try {
        await db.collection("parking_allocations").insertOne(doc);
      } catch (error) {
        if (error?.code === 11000)
          return json(
            { error: "That parking slot or vehicle is already allocated" },
            409,
          );
        throw error;
      }
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
      // SLA timings
      const respTimes = [],
        resTimes = [];
      let slaMet = 0,
        slaTotalResolved = 0,
        resolutionBreached = 0,
        resolutionPending = 0,
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
          else if (t.sla_resolution_due) resolutionBreached++;
        } else if (
          !["Resolved", "Closed", "Cancelled"].includes(t.status) &&
          t.sla_resolution_due &&
          new Date(t.sla_resolution_due).getTime() < now
        ) {
          resolutionBreached++;
        } else if (!["Resolved", "Closed", "Cancelled"].includes(t.status)) {
          resolutionPending++;
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
            Boolean(
              t.response_sla_breached_at ||
                t.resolution_sla_breached_at ||
                (t.sla_response_due &&
                  !t.acknowledged_at &&
                  !t.first_response_at &&
                  new Date(t.sla_response_due).getTime() < now) ||
                (t.sla_resolution_due &&
                  new Date(t.sla_resolution_due).getTime() < now),
            ),
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
        resolution_sla_breached: resolutionBreached,
        resolution_sla_pending: resolutionPending,
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
      if (
        p.get("assignee_id") === "unassigned" ||
        p.get("allocation") === "unallocated"
      ) {
        const unallocatedFilter = {
          $or: [
            { assignee_id: null },
            { assignee_id: "" },
            { assignee_id: { $exists: false } },
          ],
        };
        filter.$and = [...(filter.$and || []), unallocatedFilter];
      } else if (p.get("assignee_id"))
        filter.assignee_id = p.get("assignee_id");
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
            ...(filter.$and || []),
            { $or: visibilityFilter },
            { $or: searchFilter },
          ];
        } else if (filter.$and)
          filter.$and = [...filter.$and, { $or: searchFilter }];
        else filter.$or = searchFilter;
      }
      const parsedPage = Number.parseInt(p.get("page") || "1", 10);
      const parsedLimit = Number.parseInt(p.get("limit") || "15", 10);
      const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(200, Math.max(1, parsedLimit))
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
      const requestedEmail = textValue(b.email, 254).toLowerCase();
      const requestedEmployeeId = textValue(b.employee_id, 50);
      const requestedName = textValue(b.raised_for_name, 150);
      if (
        session.role !== "employee" &&
        hasExplicitIssueUser &&
        !b.raised_for_id
      ) {
        if (!requestedName)
          return json(
            {
              error:
                "Enter the affected employee name; company email and GRP code are optional",
            },
            400,
          );
        if (requestedEmail && !/^[^\s@]+@ethara\.ai$/i.test(requestedEmail))
          return json(
            { error: "Enter a valid @ethara.ai email for the affected employee" },
            400,
          );
      }
      let issueUser = session.role === "employee" ? sessionUser : null;
      if (!issueUser && b.raised_for_id)
        issueUser = await db
          .collection("users")
          .findOne({
            id: b.raised_for_id,
            role: "employee",
            active: { $ne: false },
          });
      if (!issueUser) {
        const identity = [];
        if (requestedEmail) identity.push({ email: requestedEmail });
        if (requestedEmployeeId) identity.push({ employee_id: requestedEmployeeId });
        if (identity.length)
          issueUser = await db
            .collection("users")
            .findOne({
              role: "employee",
              active: { $ne: false },
              $or: identity,
            });
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
      const acknowledgementRequired =
        session.role === "employee" || issueUser?.role === "employee";
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
        issue_user_role: issueUser?.role || null,
        acknowledgement_required: acknowledgementRequired,
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
      // Reads are team-wide: any IT member may open any IT ticket so the
      // team board links resolve. Mutations keep the stricter site/assignee
      // authorization below via canAccessTicket and the per-action guards.
      const canReadTicket =
        canAccessTicket(session, ticket) ||
        (session.role === "it" && ticket.department === "IT");
      if (seg.length === 2 && method === "GET") {
        if (!canReadTicket) return json({ error: "Forbidden" }, 403);
      } else if (!canAccessTicket(session, ticket))
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
        const acknowledgementRequired = await ticketAcknowledgementRequired(
          db,
          ticket,
        );
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

        const markClosed = ({ automatic = false } = {}) => {
          set.closed_at = ticket.closed_at || now;
          set.closed_by_id = session.id;
          set.closed_by_name = session.name;
          set.lifecycle_working_minutes = workingMinutesBetween(raisedAt, now);
          set["status_timestamps.closed"] = now;
          if (automatic)
            set.confirmation = {
              required: false,
              confirmed: true,
              auto_closed: true,
              at: now,
              by: session.name,
            };
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
              if (["Assigned", "Acknowledged", "In Progress"].includes(ticket.status)) {
                set.status = "Open";
                set["status_timestamps.open"] = now;
              }
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
          if (b.status === "Closed" && acknowledgementRequired)
            return json(
              {
                error:
                  "The affected employee must acknowledge the resolution before this ticket can close",
              },
              409,
            );
          const effectiveStatus =
            b.status === "Resolved" && !acknowledgementRequired
              ? "Closed"
              : b.status;
          set.status = effectiveStatus;
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
          if (b.status === "Resolved") {
            markResolved();
            if (!acknowledgementRequired) markClosed({ automatic: true });
          }
          if (b.status === "Closed") {
            markClosed();
          }
          await addHistory(
            db,
            ticketId,
            "status",
            session,
            b.note || "",
            ticket.status,
            effectiveStatus,
          );
          if (!b.resolution)
            await notify(
              db,
              requesterId(ticket),
              `Ticket ${ticket.human_id} status: ${effectiveStatus}`,
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
          const finalStatus = acknowledgementRequired ? "Resolved" : "Closed";
          set.status = finalStatus;
          markAcknowledged();
          markResolved();
          if (!acknowledgementRequired) markClosed({ automatic: true });
          if (b.status !== "Resolved")
            await addHistory(
              db,
              ticketId,
              "status",
              session,
              "Resolved: " + summary,
              ticket.status,
              finalStatus,
            );
          await notify(
            db,
            requesterId(ticket),
            acknowledgementRequired
              ? `Ticket ${ticket.human_id} resolved - please confirm`
              : `Ticket ${ticket.human_id} resolved and closed`,
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
        const approvalEmailOrigin =
          process.env.EMAIL_NOTIFICATIONS_ENABLED !== "false"
            ? publicAppOrigin(request)
            : null;
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
          approval = {
            ...existing,
            ...apprData,
            status: "Pending",
            updated_at: approvalNow,
          };
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
          .find({ role: "super_admin", active: { $ne: false } })
          .toArray();
        await notify(
          db,
          supers.map((u) => u.id),
          `Approval requested for ${ticket.human_id}`,
          ticket,
          "approval",
          { email: false },
        );
        if (approvalEmailOrigin)
          await queueApprovalRequestEmails(
            db,
            supers,
            approval,
            ticket,
            approvalEmailOrigin,
            approvalNow.getTime(),
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
        const currentApproval = await db
          .collection("approvals")
          .findOne({ ticket_id: ticketId });
        if (!currentApproval)
          return json({ error: "Approval request not found" }, 404);
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
        await supersedePendingApprovalEmails(db, currentApproval.id);
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
      const title = textValue(b.title, 200);
      if (!title) return json({ error: "Task title is required" }, 400);
      const recurrence = textValue(b.recurrence, 20) || "one-time";
      if (!["one-time", "daily", "weekly", "monthly"].includes(recurrence))
        return json({ error: "Invalid task recurrence" }, 400);
      const priority = textValue(b.priority, 20) || "Medium";
      if (!["Critical", "High", "Medium", "Low"].includes(priority))
        return json({ error: "Invalid task priority" }, 400);
      const dueDate = b.due_date ? new Date(b.due_date) : new Date();
      if (Number.isNaN(dueDate.getTime()))
        return json({ error: "Invalid task due date" }, 400);
      const hid = await humanId(db, "ATSK");
      const t = {
        id: uuidv4(),
        human_id: hid,
        title,
        category: textValue(b.category, 100) || "Facilities",
        location: textValue(b.location, 150) || "HQ1",
        recurrence,
        owner_id: session.id,
        owner_name: session.name,
        backup_owner_name: textValue(b.backup_owner_name, 150),
        priority,
        due_date: dueDate,
        status: "Not Started",
        remarks: textValue(b.remarks, 5000),
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
      const task = await db.collection("tasks").findOne({ id: seg[1] });
      if (!task) return json({ error: "Task not found" }, 404);
      const set = { updated_at: new Date() };
      if (b.status !== undefined) {
        if (
          ![
            "Not Started",
            "In Progress",
            "Pending Approval",
            "On Hold",
            "Completed",
            "Not Applicable",
          ].includes(b.status)
        )
          return json({ error: "Invalid task status" }, 400);
        set.status = b.status;
      }
      if (b.priority !== undefined) {
        if (!["Critical", "High", "Medium", "Low"].includes(b.priority))
          return json({ error: "Invalid task priority" }, 400);
        set.priority = b.priority;
      }
      if (b.remarks !== undefined) set.remarks = textValue(b.remarks, 5000);
      if (b.completion_proof !== undefined)
        set.completion_proof = textValue(b.completion_proof, 1000);
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
      const today = kraDateKey();
      const now = new Date();
      await processKraEscalations(db, today, now);
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
        const deadline = kraDeadlineAt(today, l.cutoff || KRA_CUTOFF);
        const completedOnTime =
          kraSubmissionCompleted(l, sub) &&
          sub?.submitted_at &&
          new Date(sub.submitted_at) <= deadline;
        const overdue = Boolean(deadline && now > deadline && !completedOnTime);
        out.push({
          ...clean(l),
          cutoff: KRA_CUTOFF,
          cutoff_at: deadline,
          overdue,
          today_status: overdue ? "Issue" : sub?.status || "Not submitted",
          today_submission: sub ? clean(sub) : null,
        });
      }
      return json(out);
    }
    if (
      route === "/member-checklists/import-preview" &&
      method === "POST"
    ) {
      if (session.role !== "super_admin")
        return json({ error: "Forbidden" }, 403);
      const form = await request.formData();
      return json(await tasksFromSpreadsheet(form.get("file")));
    }
    if (route === "/member-checklists" && method === "POST") {
      if (session.role !== "super_admin")
        return json({ error: "Forbidden" }, 403);
      const b = await request.json();
      const member = await db.collection("users").findOne({ id: b.member_id });
      if (!member) return json({ error: "Member not found" }, 400);
      if (!["it", "admin"].includes(member.role))
        return json({ error: "KRA can be assigned only to IT or Admin members" }, 400);
      if (
        !Array.isArray(b.items) ||
        !b.items.some((item) => textValue(item, 300))
      )
        return json({ error: "Add at least one daily work item" }, 400);
      const doc = {
        id: uuidv4(),
        member_id: member.id,
        member_name: member.name,
        member_role: member.role,
        location: textValue(b.location, 150) || member.location || "",
        title: textValue(b.title, 200) || "Daily Checklist",
        frequency:
          String(b.frequency || b.repeat || "Daily").toLowerCase() ===
          "weekdays"
            ? "Weekdays"
            : "Daily",
        cutoff: KRA_CUTOFF,
        active: true,
        items: (b.items || [])
          .filter(Boolean)
          .slice(0, 200)
          .map((label, i) => ({
            key: `mc_${i}`,
            label: textValue(label, 300),
          }))
          .filter((item) => item.label),
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
      const date = kraDateKey();
      if (b.date && b.date !== date)
        return json({ error: "KRA can only be submitted for today" }, 400);
      if (!Array.isArray(b.responses))
        return json({ error: "KRA responses must be a list" }, 400);
      const expectedItems = Array.isArray(list.items) ? list.items : [];
      const submittedByItem = new Map();
      for (const response of b.responses.slice(0, 200)) {
        if (!response || typeof response !== "object" || Array.isArray(response))
          return json({ error: "Invalid KRA response" }, 400);
        const item = textValue(response.item, 300);
        const matched = expectedItems.find(
          (expected) => expected.key === response.key || expected.label === item,
        );
        if (!matched)
          return json({ error: "A KRA response does not match this checklist" }, 400);
        if (submittedByItem.has(matched.key))
          return json({ error: "Duplicate KRA response" }, 400);
        submittedByItem.set(matched.key, {
          key: matched.key,
          item: matched.label,
          done: response.done === true,
          remark: textValue(response.remark, 1000),
        });
      }
      const responses = expectedItems.map(
        (item) =>
          submittedByItem.get(item.key) || {
            key: item.key,
            item: item.label,
            done: false,
            remark: "",
          },
      );
      const doneCount = responses.filter((r) => r.done).length;
      const now = new Date();
      const deadline = kraDeadlineAt(date, list.cutoff || KRA_CUTOFF);
      const late = Boolean(deadline && now > deadline);
      const completed =
        doneCount === responses.length && responses.length > 0
      const status = late ? "Late" : completed ? "Completed" : "Partial";
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
        cutoff: KRA_CUTOFF,
        deadline_at: deadline,
        late,
        submitted_at: now,
      };
      if (existing)
        await db
          .collection("member_checklist_submissions")
          .updateOne({ id: existing.id }, { $set: payload });
      else
        await db
          .collection("member_checklist_submissions")
          .insertOne({ id: uuidv4(), ...payload, created_at: now });
      if (late) await processKraEscalations(db, date, now);
      await audit(
        db,
        session,
        "member_checklist.submit",
        "member_checklist",
        list.id,
        { date, status, late },
      );
      return json({
        ok: true,
        status,
        done_count: doneCount,
        total: responses.length,
        late,
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
      const requestedDate = new URL(request.url).searchParams.get("date");
      const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || "")
        ? requestedDate
        : kraDateKey();
      const now = new Date();
      if (date === kraDateKey(now))
        await processKraEscalations(db, date, now);
      const lists = await db
        .collection("member_checklists")
        .find({ active: true })
        .toArray();
      const subs = await db
        .collection("member_checklist_submissions")
        .find({ date })
        .toArray();
      const byChecklist = new Map(
        subs.map((submission) => [submission.checklist_id, submission]),
      );
      const byMember = {};
      for (const l of lists) {
        if (!kraRunsOnDate(l, date)) continue;
        const m = (byMember[l.member_id] = byMember[l.member_id] || {
          member_id: l.member_id,
          member_name: l.member_name,
          member_role: l.member_role,
          total_lists: 0,
          total_items: 0,
          done_items: 0,
          submitted_lists: 0,
          issue_lists: 0,
        });
        m.total_lists += 1;
        m.total_items += (l.items || []).length;
        const submission = byChecklist.get(l.id);
        if (submission) {
          m.submitted_lists += 1;
          m.done_items += Number(submission.done_count || 0);
        }
        const deadline = kraDeadlineAt(date, l.cutoff || KRA_CUTOFF);
        const completedOnTime =
          kraSubmissionCompleted(l, submission) &&
          submission?.submitted_at &&
          new Date(submission.submitted_at) <= deadline;
        if (deadline && now > deadline && !completedOnTime) m.issue_lists += 1;
      }
      const members = Object.values(byMember).map((m) => {
        let status = "Not Submitted";
        if (m.issue_lists > 0) status = "Issue";
        else if (m.submitted_lists > 0)
          status =
            m.submitted_lists >= m.total_lists && m.done_items >= m.total_items
              ? "Completed"
              : "Partial";
        return {
          ...m,
          status,
          escalated: m.issue_lists > 0,
          compliant: status === "Completed",
          pct: m.total_items
            ? Math.round((m.done_items / m.total_items) * 100)
            : 0,
        };
      });
      return json({
        date,
        cutoff: KRA_CUTOFF,
        cutoff_label: "7:00 PM",
        members,
      });
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
    if (
      seg[0] === "notifications" &&
      seg[1] &&
      seg[2] === "read" &&
      method === "POST"
    ) {
      const notification = await db.collection("notifications").findOne({
        id: seg[1],
        user_id: session.id,
      });
      if (!notification)
        return json({ error: "Notification not found" }, 404);
      if (!notification.read)
        await db.collection("notifications").updateOne(
          { id: notification.id, user_id: session.id },
          { $set: { read: true, read_at: new Date() } },
        );
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

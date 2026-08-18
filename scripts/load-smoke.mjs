import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import bcrypt from "bcryptjs";
import {
  closePostgres,
  connectToPostgres,
} from "../lib/postgres-document-db.js";

const baseUrl = process.env.LOAD_TEST_URL || "http://127.0.0.1:3004/api";
const requests = Math.min(2000, Math.max(1, Number(process.env.LOAD_REQUESTS || 300)));
const concurrency = Math.min(100, Math.max(1, Number(process.env.LOAD_CONCURRENCY || 25)));

// The seeded demo fixtures and /auth/demo-login were removed, so the load test
// provisions a throwaway Super Admin, signs in normally, and deletes it after.
const database = await connectToPostgres();
const loadUserPassword = `Load-${randomBytes(15).toString("base64url")}!aA1`;
const loadUser = {
  id: randomUUID(),
  name: "load smoke",
  email: `load-${randomBytes(3).toString("hex")}@ethara.ai`,
  role: "super_admin",
  department: "Management",
  password_hash: await bcrypt.hash(loadUserPassword, 12),
  employee_id: "",
  location: "Tulip - Third Floor",
  is_team_head: false,
  managed_locations: [],
  active: true,
  activation_pending_reason: null,
  email_verification_required: false,
  email_verified_at: new Date(),
  session_version: 0,
  created_at: new Date(),
};
await database.collection("users").insertOne(loadUser);

const login = await fetch(`${baseUrl}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: new URL(baseUrl).origin },
  body: JSON.stringify({
    email: loadUser.email,
    password: loadUserPassword,
    location: "Tulip",
  }),
});
assert.equal(login.status, 200, "load-test login failed");
const cookie = (login.headers.get("set-cookie") || "").split(";", 1)[0];

const paths = ["/", "/auth/me", "/categories", "/locations", "/tickets?limit=15", "/notifications"];
const samples = [];
let succeeded = 0;
let failed = 0;
let cursor = 0;
const started = performance.now();

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= requests) return;
    const requestStarted = performance.now();
    try {
      const response = await fetch(`${baseUrl}${paths[index % paths.length]}`, {
        headers: { cookie },
        signal: AbortSignal.timeout(10_000),
      });
      samples.push(performance.now() - requestStarted);
      if (response.ok) succeeded += 1;
      else failed += 1;
      await response.arrayBuffer();
    } catch {
      samples.push(performance.now() - requestStarted);
      failed += 1;
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
const durationMs = performance.now() - started;
samples.sort((left, right) => left - right);
const percentile = (value) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * value) - 1)] || 0;
const result = {
  requests,
  concurrency,
  succeeded,
  failed,
  duration_ms: Math.round(durationMs),
  requests_per_second: Number((requests / (durationMs / 1000)).toFixed(2)),
  latency_ms: {
    min: Number((samples[0] || 0).toFixed(2)),
    median: Number(percentile(0.5).toFixed(2)),
    p95: Number(percentile(0.95).toFixed(2)),
    p99: Number(percentile(0.99).toFixed(2)),
    max: Number((samples.at(-1) || 0).toFixed(2)),
  },
};
console.log(JSON.stringify(result, null, 2));
await database.collection("users").deleteMany({ id: loadUser.id });
await closePostgres();
assert.equal(failed, 0, `${failed} load-test requests failed`);

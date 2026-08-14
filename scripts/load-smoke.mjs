import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const baseUrl = process.env.LOAD_TEST_URL || "http://127.0.0.1:3004/api";
const requests = Math.min(2000, Math.max(1, Number(process.env.LOAD_REQUESTS || 300)));
const concurrency = Math.min(100, Math.max(1, Number(process.env.LOAD_CONCURRENCY || 25)));

const accountsResponse = await fetch(`${baseUrl}/auth/demo-accounts`);
assert.equal(accountsResponse.status, 200, "demo login is required for the local load test");
const accounts = (await accountsResponse.json()).accounts || [];
const account = accounts.find((item) => item.role === "super_admin");
assert.ok(account, "Super Admin demo fixture is unavailable");
const login = await fetch(`${baseUrl}/auth/demo-login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: account.email, location: "Tulip" }),
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
assert.equal(failed, 0, `${failed} load-test requests failed`);

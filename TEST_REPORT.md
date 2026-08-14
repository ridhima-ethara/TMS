# Platform validation report

Date: 13 August 2026  
Runtime: Next.js 15.5.23 standalone, local PostgreSQL, Node.js, localhost port 3004

## Outcome

- Production build: PASS
- Runtime health: PASS (`/` and `/api` return HTTP 200)
- Production dependency audit: PASS, zero known vulnerabilities
- Full platform/security suite: PASS, 56 assertions
- Ticket/SLA/approval workflow: PASS, 61 assertions
- Requested location/KRA flow: PASS
- Email OTP suite: PASS, 28 assertions
- SMTP OTP suite: PASS, 14 assertions
- Live HQ retained-traffic report: PASS, source complete
- Live HQ2 retained-traffic report: PASS, source complete
- Load smoke: PASS, zero failed requests
- Seeded business-data cleanup: PASS

## Load result

Controlled localhost read-heavy test, excluding live firewall endpoints to avoid
overloading the appliance:

| Metric | Result |
|---|---:|
| Requests | 1,000 |
| Concurrency | 50 |
| Successful | 1,000 |
| Failed | 0 |
| Throughput | 754.75 requests/second |
| Median latency | 64.36 ms |
| p95 latency | 110.04 ms |
| p99 latency | 307.05 ms |
| Maximum latency | 396.41 ms |

This is a local smoke benchmark, not a production capacity guarantee. Production
results depend on host sizing, database latency, TLS/proxy overhead, active data
volume, and concurrent firewall/API traffic.

## Security fixes completed

- Staff-role self-registration now remains inactive until Super Admin approval.
- Role/active/password changes revoke existing sessions.
- The last active Super Admin cannot be disabled or demoted.
- Demo quick login is local-host only unless an explicit remote override is set;
  forged/public Host headers return 404.
- Upload throttling moved from process memory to PostgreSQL so it survives
  restarts and works across application instances.
- Attachment type, signature, ownership, size, count and linked-ticket access
  checks are covered.
- Parking slots and vehicle numbers now have database uniqueness constraints,
  preventing concurrent double allocation.
- Task inputs, user mutations, parking inputs and KRA submissions now use
  bounded allow-list validation.
- KRA responses are reconstructed from the authoritative server checklist;
  injected and duplicate work items are rejected.
- CSRF-style cross-site mutations, IDOR attempts, stale sessions and terminal
  ticket reopening are covered by automated tests.

## Data cleanup result

Removed seeded operational records while preserving login/reference/integration
state:

| Collection | Remaining |
|---|---:|
| Tickets | 0 |
| Tasks | 0 |
| Member KRAs | 0 |
| Checklist executions | 0 |
| Approvals | 0 |
| Notifications | 0 |
| Parking allocations | 0 |
| History/comments | 0 |
| Demo accounts | 6 |
| Non-demo users | 1 |
| Firewall daily archives | 10 |
| Firewall health profiles | 2 |

Categories, locations, and checklist templates remain as reference
configuration so new real work can be created.

## Remaining work and risks

1. Browser automation is not installed. Responsive layouts, keyboard focus,
   screen-reader behavior, transitions, refresh-state persistence, downloads,
   and visual regressions still need Playwright coverage across Chromium,
   Firefox, WebKit, and mobile viewports.
2. SMTP, login OTP, email notifications, and registration email verification
   are disabled in the active local configuration. Mock SMTP/Resend tests pass,
   but a production provider, SPF/DKIM/DMARC, bounce handling, and end-to-end
   delivery monitoring must be configured before production.
3. HQ and HQ2 currently identify as the same firewall appliance. Distinct
   verified URLs/tokens/certificate pins are required for genuinely independent
   site reporting.
4. The live firewall system-event ring can exceed the 100,000-row interactive
   cap. The UI correctly marks it partial. Detailed traffic now uses scheduled
   incremental daily archival, but long-term security-event archival remains a
   separate follow-up.
5. Full live firewall reports currently take roughly 35–45 seconds in the
   local network. Scheduled daily collection now preserves detailed traffic
   independently of page views; an aggregate cache would further reduce live
   report latency. The load test deliberately did not hammer the appliance.
6. The PostgreSQL document compatibility layer currently retrieves a whole
   collection and filters many queries in application memory. It passed the
   empty/small-data load smoke but should be replaced with indexed native SQL or
   server-side JSONB predicates before large-scale data growth.
7. File uploads validate signatures and access but are not scanned by an
   antivirus/CDR service. Add quarantine and malware scanning for production.
8. Production CSP still permits inline scripts/styles for current Next/chart
   behavior. Migrate to nonces or hashes to remove `unsafe-inline`.
9. Backups, point-in-time recovery, failover, proxy/TLS termination, centralized
   logs/metrics/alerts, restore drills, and multi-instance monitor behavior need
   validation in the actual deployment environment.
10. Demo login is suitable only for this localhost demonstration. Disable
    `ALLOW_DEMO_LOGIN` and rotate/remove fixture credentials before any remote
    deployment.

## Files

- Full test matrix: `TEST_CASES.md`
- Platform integration tests: `scripts/full-platform-e2e.mjs`
- Workflow tests: `scripts/ticket-workflow-e2e.mjs`
- Requested-flow tests: `scripts/requested-flow-e2e.mjs`
- OTP tests: `scripts/login-otp-e2e.mjs`, `scripts/smtp-otp-e2e.mjs`
- Load test: `scripts/load-smoke.mjs`
- Safe demo cleanup: `scripts/clear-demo-business-data.mjs`

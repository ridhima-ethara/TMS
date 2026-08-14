# Ethara Service Hub test cases

These cases cover the current frontend/API/PostgreSQL implementation. Automated
cases are mapped to the scripts shown below; visual and external-integration
cases remain manual because they require real devices, mail infrastructure, or
multiple viewport/browser engines.

## Automated suites

| Suite | Scope | Command |
|---|---|---|
| Platform and security | Headers, auth, registration, RBAC/IDOR, validation, uploads, tickets, tasks, parking concurrency, KRA integrity, logout revocation | `npm run test:platform` |
| Ticket workflow | IT/Admin lifecycle, assignment, unassignment, employee acknowledgement, approvals, notifications, SLA and weekend calculations | `npm run test:workflow` |
| Requested flows | Login location, team scope, affected-user mapping, Excel KRA import, 7 PM cutoff and escalation | `npm run test:requested` |
| Email OTP | OTP hashing, secure cookies, attempt/replay protection, outbox redaction and audit | `npm run test:otp` |
| SMTP OTP | SMTP delivery, code verification, session creation and sensitive-data redaction | `npm run test:smtp` |
| Load smoke | Concurrent authenticated and unauthenticated read traffic | `npm run test:load` |
| Production build | Compilation, lint/type validation and standalone packaging | `npm run build` |

## Functional matrix

| ID | Role/module | Test | Expected result | Automation |
|---|---|---|---|---|
| AUTH-01 | Public | Register an employee with valid Ethara email, strong password and work location | Account is active when email verification is disabled; session is issued | Platform |
| AUTH-02 | Public | Register an IT/Admin account | Account remains inactive until Super Admin approval | Platform |
| AUTH-03 | Public | Invalid domain, weak password, invalid role/location and object-shaped login input | Request rejected with 400; no account/session created | Platform |
| AUTH-04 | Public | Repeated invalid login/OTP attempts | PostgreSQL-backed rate limit returns 429 | OTP/manual threshold |
| AUTH-05 | User | Logout and reuse the old cookie | Session version is revoked and `/auth/me` returns no user | Platform |
| AUTH-06 | Security | Submit mutation with a foreign Origin or `Sec-Fetch-Site: cross-site` | 403 cross-site rejection | Platform |
| AUTH-07 | Demo | Request quick login remotely without explicit remote override | 404; local quick login remains available | Platform/manual deployment |
| USER-01 | Super Admin | List users | All members visible; hashes/session versions absent | Platform |
| USER-02 | Super Admin | Change member role or active state | Sessions revoked; last active Super Admin cannot be removed | Platform/manual UI |
| USER-03 | Employee/IT/Admin | List users/requesters | Role-limited fields and scope only | Workflow |
| TKT-01 | Employee | Raise IT and Admin tickets with valid category/location | Ticket gets timestamp, SLA dates, routing team, and unallocated pending state | Workflow |
| TKT-02 | IT | View Tulip ticket while logged into Lotus | 403/no list leakage unless it is a legacy unclassified shared-queue item | Platform/Requested |
| TKT-03 | Team member | Claim an unallocated ticket for self | Assignment and acknowledgement timestamps set | Platform/Workflow |
| TKT-04 | Non-head member | Assign a ticket to another member | 403 | Platform/Workflow |
| TKT-05 | Team head | Assign/unassign team tickets | Allowed within managed site; unassign returns ticket to pending team queue | Workflow |
| TKT-06 | Assignee | Move Assigned → In Progress → Resolved | Work start/resolution timestamps and SLA minutes set | Workflow |
| TKT-07 | Employee | Acknowledge a resolved ticket with rating | Ticket closes permanently and confirmation is recorded | Platform/Workflow |
| TKT-08 | Any staff | Modify/reopen a closed ticket | 409 terminal-state rejection | Platform |
| TKT-09 | Staff | Raise a ticket for an affected employee using name/email/code | Identity mapped and ticket visible in employee acknowledgement queue | Requested |
| TKT-10 | List | Search/filter/paginate by status, priority, category, location and assignee | Scoped, capped pagination and matching results | Workflow/manual UI |
| APR-01 | IT/Admin | Submit approval with optional multiple attachments | Pending request and Super Admin notification created | Workflow |
| APR-02 | Super Admin | Approve/partial/reject/hold/clarify | Required remarks enforced; ticket/approval/history update atomically | Workflow |
| APR-03 | Email | Open signed approval link, decide, then replay | GET does not mutate; first valid POST succeeds; replay returns 409 | Workflow when email enabled |
| ATT-01 | Any user | Upload PDF/JPEG/PNG/DOC/DOCX with valid signature, max 5 MB each/25 MB total | 201 and private metadata/blob storage | Platform |
| ATT-02 | Any user | Spoof extension/MIME or exceed count/size | 413/415 and partial uploads rolled back | Platform/manual limits |
| ATT-03 | Different user | Download pending or unauthorized linked file | 403; authorized owner/ticket participant receives `attachment` response | Platform |
| TASK-01 | Admin | Create and update a task | Required title and status/priority/recurrence validation; audit created | Platform |
| TASK-02 | Other role | Create/update task | 403 | Platform/manual |
| KRA-01 | Super Admin | Import CSV/XLSX and create KRA | Valid task column parsed, max limits enforced, cutoff standardized to 7 PM | Requested |
| KRA-02 | Assigned member | Submit exact checklist responses | Completed/Partial/Late recorded for today only | Platform/Requested |
| KRA-03 | Assigned member | Inject or duplicate checklist items | 400; server reconstructs responses from authoritative template | Platform |
| KRA-04 | Scheduler/dashboard | Miss 7 PM cutoff | Idempotent escalation and member/Super Admin notifications | Requested |
| PARK-01 | Admin/Super Admin | Allocate valid Tulip 2-/4-wheeler slot | Capacity, member, vehicle and slot stored; notification/audit created | Platform |
| PARK-02 | Concurrent admins | Allocate same slot simultaneously | Exactly one succeeds; database uniqueness makes other return 409 | Platform |
| PARK-03 | Admin/Super Admin | Remove allocation | Allocation removed and member notified | Manual/API |
| NOT-01 | User | Read own/all notifications | Only caller-owned notifications change | Workflow |
| AUD-01 | Employee/IT/Admin | Read audit log | 403 | Platform |
| AUD-02 | Super Admin | Read audit log | Latest sanitized records returned | Platform/manual UI |
| FW-01 | IT/Admin/Super Admin | Open HQ/HQ2 overview | Every configured vendor section returns source metadata or a visible error | Live integration |
| FW-02 | Firewall reports | Today/1h/24h/7d/specific date | Stable vendor search-session pagination and exact retained-row completeness metadata | Live integration |
| FW-03 | Devices | Refresh connected devices | Active DHCP leases only; deduplicated MAC/IP; inventory/AV mapping shown | Live integration |
| FW-04 | Applications/bandwidth | Change period | App/device/interface/floor totals recompute from selected report period | Live integration/manual UI |
| FW-05 | Archive/downtime | Read/export archives and health periods | Scheduled detailed records, completeness/gap flags and outages reflected; CSV export downloads | Live integration/manual download |
| FW-07 | Archive resilience | Firewall changes from healthy/degraded to down | The last successful daily archive is protected and referenced by the outage as its pre-downtime snapshot | Health-transition integration/manual appliance simulation |
| FW-06 | Security | Use invalid TLS trust/fingerprint | Connection rejected; no production self-signed bypass | Configuration integration |
| UI-01 | All roles | Refresh a nested module/page | Same module restored without returning to dashboard | Manual browser |
| UI-02 | All roles | Loading, empty and failure states | No white screen; clear retry/empty messaging | Manual browser |
| UI-03 | Responsive | 320/375/768/1024/1440 px layouts | No inaccessible controls or destructive desktop regressions | Manual multi-browser |
| UI-04 | Accessibility | Keyboard and screen-reader dialog/sheet navigation | Titles, focus, labels and escape behavior work | Manual axe/screen reader |

## Release acceptance

- All automated suites exit successfully.
- Production dependency audit reports no known vulnerability.
- Load smoke has zero failed requests and records median/p95/p99 latency.
- No seeded business tickets/tasks/KRAs remain after the cleanup script.
- Real users, reference categories/locations, and real firewall archives remain intact.
- Production must disable demo login, use HTTPS, enable email verification/OTP,
  configure SMTP/Resend, and use distinct verified HQ/HQ2 firewall profiles.

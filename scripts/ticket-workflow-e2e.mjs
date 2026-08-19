import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { addWorkingHours, workingMinutesBetween } from "../lib/sla.js";
import {
  closePostgres,
  connectToPostgres,
} from "../lib/postgres-document-db.js";

const baseUrl = process.env.WORKFLOW_TEST_URL || "http://localhost:3004/api";
const db = await connectToPostgres();
const runId = `workflow-test-${Date.now()}-${randomBytes(3).toString("hex")}`;
const password = `Test-${randomBytes(18).toString("base64url")}!`;
const location = "Tulip - Ground Floor";
const users = [
  { role: "employee", name: "Workflow Employee", department: "General" },
  { role: "it", name: "Workflow IT", department: "IT" },
  { role: "admin", name: "Workflow Admin", department: "Admin" },
  {
    role: "super_admin",
    name: "Workflow Super Admin",
    department: "Management",
  },
].map((user) => ({
  ...user,
  id: randomUUID(),
  email: `${runId}-${user.role.replace("_", "-")}@ethara.ai`,
  employee_id: `TEST-${randomBytes(3).toString("hex").toUpperCase()}`,
  location,
  active: true,
  email_verified: true,
  session_version: 0,
  created_at: new Date(),
  test_run_id: runId,
}));
const userByRole = Object.fromEntries(users.map((user) => [user.role, user]));
const ticketIds = [];
const dateKey = (() => {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, "0")}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getFullYear()).slice(-2)}`;
})();
const counterKeys = [`IT--${dateKey}`, `ADM--${dateKey}`];
const counterSnapshots = new Map(
  await Promise.all(
    counterKeys.map(async (key) => [
      key,
      await db.collection("counters").findOne({ _id: key }),
    ]),
  ),
);

function ensureResponse(result, status, label) {
  assert.equal(
    result.status,
    status,
    `${label}: expected ${status}, received ${result.status} (${result.body?.error || "no error detail"})`,
  );
  return result.body;
}

async function login(user) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      password,
      employee_id: user.employee_id,
    }),
  });
  const body = await response.json();
  ensureResponse({ status: response.status, body }, 200, `${user.role} login`);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie, `${user.role} login did not return a session cookie`);
  return async (path, options = {}) => {
    const request = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        cookie,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      body:
        options.body && typeof options.body !== "string"
          ? JSON.stringify(options.body)
          : options.body,
    });
    const text = await request.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }
    return { status: request.status, body: parsed };
  };
}

async function createTicket(client, department, category, extra = {}) {
  const result = await client("/tickets", {
    method: "POST",
    body: {
      department,
      category,
      title: `${runId} ${department} workflow`,
      description: "Automated lifecycle verification ticket",
      priority: "Critical",
      location,
      ...extra,
    },
  });
  const ticket = ensureResponse(result, 200, `${department} ticket creation`);
  ticketIds.push(ticket.id);
  return ticket;
}

async function updateTicket(client, ticketId, body, label) {
  return ensureResponse(
    await client(`/tickets/${ticketId}`, { method: "PATCH", body }),
    200,
    label,
  );
}

async function confirmTicket(client, ticketId, label) {
  return ensureResponse(
    await client(`/tickets/${ticketId}/confirm`, {
      method: "POST",
      body: { action: "confirm", rating: 5, comment: "Verified" },
    }),
    200,
    label,
  );
}

async function cleanup() {
  const ids = users.map((user) => user.id);
  if (ticketIds.length) {
    await Promise.all([
      db.collection("history").deleteMany({ ticket_id: { $in: ticketIds } }),
      db.collection("comments").deleteMany({ ticket_id: { $in: ticketIds } }),
      db.collection("approvals").deleteMany({ ticket_id: { $in: ticketIds } }),
      db.collection("notifications").deleteMany({ ticket_id: { $in: ticketIds } }),
      db.collection("email_outbox").deleteMany({ user_id: { $in: ids } }),
      db.collection("audit_logs").deleteMany({
        $or: [
          { actor_id: { $in: ids } },
          { entity_id: { $in: ticketIds } },
        ],
      }),
    ]);
    await db.collection("tickets").deleteMany({ id: { $in: ticketIds } });
  }
  await db.collection("notifications").deleteMany({ user_id: { $in: ids } });
  await db.collection("email_outbox").deleteMany({ user_id: { $in: ids } });
  await db
    .collection("login_otp_challenges")
    .deleteMany({ user_id: { $in: ids } });
  await db.collection("users").deleteMany({ id: { $in: ids } });
  for (const key of counterKeys) {
    const snapshot = counterSnapshots.get(key);
    if (snapshot)
      await db
        .collection("counters")
        .updateOne({ _id: key }, { $set: { seq: snapshot.seq } });
    else await db.collection("counters").deleteOne({ _id: key });
  }
}

try {
  const passwordHash = await bcrypt.hash(password, 10);
  await db.collection("users").insertMany(
    users.map((user) => ({ ...user, password_hash: passwordHash })),
  );
  const categories = await db.collection("categories").find({}).toArray();
  const itCategory = categories.find((item) => item.department === "IT")?.name;
  const adminCategory = categories.find(
    (item) => item.department === "Admin",
  )?.name;
  assert.ok(itCategory, "No IT category is configured");
  assert.ok(adminCategory, "No Admin category is configured");

  const employee = await login(userByRole.employee);
  const it = await login(userByRole.it);
  const admin = await login(userByRole.admin);
  const superAdmin = await login(userByRole.super_admin);

  ensureResponse(
    await employee("/users/requesters"),
    403,
    "employee requester-directory RBAC",
  );
  const requesterDirectory = ensureResponse(
    await it("/users/requesters"),
    200,
    "staff requester directory",
  );
  const requester = requesterDirectory.find(
    (item) => item.id === userByRole.employee.id,
  );
  assert.deepEqual(
    Object.keys(requester).sort(),
    ["email", "employee_id", "id", "location", "name"],
    "requester directory exposed unexpected fields",
  );

  const employeeItTicket = await createTicket(employee, "IT", itCategory);
  assert.equal(employeeItTicket.acknowledgement_required, true);
  assert.equal(employeeItTicket.allocation_status, "unallocated");
  assert.equal(employeeItTicket.queue_state, "pending");
  const teamQueue = ensureResponse(
    await it("/tickets?allocation=unallocated&limit=100"),
    200,
    "IT team queue",
  );
  assert.ok(
    teamQueue.items.some((ticket) => ticket.id === employeeItTicket.id),
    "employee IT ticket did not reach the team queue",
  );
  const assignedIt = await updateTicket(
    it,
    employeeItTicket.id,
    { assignee_id: userByRole.it.id },
    "IT self-assignment",
  );
  assert.equal(assignedIt.status, "Assigned");
  assert.ok(assignedIt.assigned_at && assignedIt.acknowledged_at);
  const startedIt = await updateTicket(
    it,
    employeeItTicket.id,
    { status: "In Progress" },
    "IT work start",
  );
  assert.ok(startedIt.work_started_at);
  const resolvedIt = await updateTicket(
    it,
    employeeItTicket.id,
    { resolution: { summary: "Network service restored" } },
    "IT resolution",
  );
  assert.equal(resolvedIt.status, "Resolved");
  assert.ok(resolvedIt.resolved_at);
  const closedIt = await confirmTicket(
    employee,
    employeeItTicket.id,
    "employee IT acknowledgement",
  );
  assert.equal(closedIt.status, "Closed");
  assert.equal(closedIt.confirmation.confirmed, true);

  const employeeAdminTicket = await createTicket(
    employee,
    "Admin",
    adminCategory,
  );
  await updateTicket(
    admin,
    employeeAdminTicket.id,
    { assignee_id: userByRole.admin.id },
    "Admin self-assignment",
  );
  const resolvedAdmin = await updateTicket(
    admin,
    employeeAdminTicket.id,
    { resolution: { summary: "Administrative request completed" } },
    "Admin resolution",
  );
  assert.equal(resolvedAdmin.status, "Resolved");
  assert.equal(
    (await confirmTicket(employee, employeeAdminTicket.id, "employee Admin acknowledgement"))
      .status,
    "Closed",
  );

  const mappedTicket = await createTicket(it, "IT", itCategory, {
    raised_for_id: userByRole.employee.id,
    assignee_id: userByRole.it.id,
  });
  assert.equal(mappedTicket.issue_user_id, userByRole.employee.id);
  assert.equal(mappedTicket.acknowledgement_required, true);
  const mappedResolved = await updateTicket(
    it,
    mappedTicket.id,
    { resolution: { summary: "Mapped employee issue resolved" } },
    "mapped employee resolution",
  );
  assert.equal(mappedResolved.status, "Resolved");
  const employeeResolved = ensureResponse(
    await employee("/tickets?status=Resolved&limit=100"),
    200,
    "mapped employee acknowledgement queue",
  );
  assert.ok(employeeResolved.items.some((ticket) => ticket.id === mappedTicket.id));
  await confirmTicket(employee, mappedTicket.id, "mapped employee acknowledgement");

  const internalTicket = await createTicket(it, "IT", itCategory, {
    assignee_id: userByRole.it.id,
  });
  assert.equal(internalTicket.acknowledgement_required, false);
  const internalClosed = await updateTicket(
    it,
    internalTicket.id,
    { resolution: { summary: "Internal maintenance completed" } },
    "internal staff completion",
  );
  assert.equal(internalClosed.status, "Closed");
  assert.equal(internalClosed.confirmation.auto_closed, true);
  assert.ok(internalClosed.resolved_at && internalClosed.closed_at);

  const approvalTicket = await createTicket(it, "IT", itCategory, {
    assignee_id: userByRole.it.id,
  });
  ensureResponse(
    await it(`/tickets/${approvalTicket.id}/approval/submit`, {
      method: "POST",
      body: {
        justification: "Approval email workflow verification",
        requested_amount: 12500,
        vendor: "Workflow Test Vendor",
        recommendation: "Approve for automated validation",
      },
    }),
    200,
    "approval submission",
  );
  const approvalEmail = await db.collection("email_outbox").findOne({
    user_id: userByRole.super_admin.id,
    subject: { $regex: "^\\[Approval required\\]" },
  });
  if (process.env.EMAIL_NOTIFICATIONS_ENABLED === "false") {
    assert.equal(approvalEmail, null, "email was queued while notifications are disabled");
    ensureResponse(
      await superAdmin(`/tickets/${approvalTicket.id}/approval/decision`, {
        method: "POST",
        body: { decision: "approve", remarks: "Approved in dashboard-only mode" },
      }),
      200,
      "dashboard-only approval decision",
    );
  } else {
    assert.ok(approvalEmail, "approval request email was not queued");
    assert.match(approvalEmail.subject, /Approval required/);
    assert.equal(approvalEmail.sensitive, true);
    assert.equal(approvalEmail.status, "pending");
    const approvalUrlValue = approvalEmail.message.match(
      /https?:\/\/[^\s]+\/api\/approvals\/email-action\?token=[A-Za-z0-9._~-]+/,
    )?.[0];
    assert.ok(approvalUrlValue, "approval email has no secure action URL");
    const approvalUrl = new URL(approvalUrlValue);
    const approvalPreview = await fetch(approvalUrl);
    assert.equal(approvalPreview.status, 200);
    assert.match(await approvalPreview.text(), /Approval decision required/);
    assert.equal(
      (await db.collection("approvals").findOne({ ticket_id: approvalTicket.id }))
        .status,
      "Pending",
      "opening the approval email changed state",
    );
    const rejectedWithoutRemarks = await fetch(
      `${approvalUrl.origin}${approvalUrl.pathname}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: approvalUrl.searchParams.get("token"),
          decision: "reject",
        }),
      },
    );
    assert.equal(rejectedWithoutRemarks.status, 400);
    const approvalDecision = await fetch(
      `${approvalUrl.origin}${approvalUrl.pathname}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: approvalUrl.searchParams.get("token"),
          decision: "approve",
          remarks: "Approved through the secure email workflow test",
        }),
      },
    );
    assert.equal(approvalDecision.status, 200);
    const approvalReplay = await fetch(
      `${approvalUrl.origin}${approvalUrl.pathname}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: approvalUrl.searchParams.get("token"),
          decision: "approve",
        }),
      },
    );
    assert.equal(approvalReplay.status, 409);
  }

  const dashboardApprovalTicket = await createTicket(it, "IT", itCategory, {
    assignee_id: userByRole.it.id,
  });
  ensureResponse(
    await it(`/tickets/${dashboardApprovalTicket.id}/approval/submit`, {
      method: "POST",
      body: {
        justification: "Dashboard approval regression verification",
        requested_amount: 4500,
        vendor: "Dashboard Test Vendor",
      },
    }),
    200,
    "dashboard approval submission",
  );
  const dashboardApproval = await db
    .collection("approvals")
    .findOne({ ticket_id: dashboardApprovalTicket.id });
  const dashboardApprovalEmail = await db.collection("email_outbox").findOne({
    user_id: userByRole.super_admin.id,
    dedupe_key: {
      $regex: `^approval-request:${dashboardApproval.id}:`,
    },
  });
  if (process.env.EMAIL_NOTIFICATIONS_ENABLED === "false")
    assert.equal(dashboardApprovalEmail, null);
  else assert.ok(dashboardApprovalEmail);
  ensureResponse(
    await superAdmin(
      `/tickets/${dashboardApprovalTicket.id}/approval/decision`,
      {
        method: "POST",
        body: { decision: "approve", remarks: "Approved from dashboard" },
      },
    ),
    200,
    "dashboard approval decision",
  );
  assert.equal(
    (await db.collection("tickets").findOne({ id: dashboardApprovalTicket.id }))
      .status,
    "Approved - Ready for Action",
  );
  if (dashboardApprovalEmail) {
    const supersededDashboardEmail = await db
      .collection("email_outbox")
      .findOne({ id: dashboardApprovalEmail.id });
    assert.equal(supersededDashboardEmail.status, "superseded");
    assert.equal(
      supersededDashboardEmail.message,
      "[Completed approval email removed]",
    );
  }

  const unassignedTicket = await createTicket(employee, "IT", itCategory);
  await updateTicket(
    it,
    unassignedTicket.id,
    { assignee_id: userByRole.it.id },
    "self-assign before unassign",
  );
  const returnedToQueue = await updateTicket(
    it,
    unassignedTicket.id,
    { assignee_id: null },
    "return ticket to team queue",
  );
  assert.equal(returnedToQueue.status, "Open");
  assert.equal(returnedToQueue.allocation_status, "unallocated");
  assert.equal(returnedToQueue.queue_state, "pending");

  const employeeNotifications = ensureResponse(
    await employee("/notifications"),
    200,
    "employee notifications",
  );
  const ownNotification = employeeNotifications.find(
    (item) => item.ticket_id === mappedTicket.id,
  );
  assert.ok(ownNotification, "mapped employee did not receive a notification");
  const itNotifications = ensureResponse(
    await it("/notifications"),
    200,
    "IT notifications",
  );
  const foreignNotification = itNotifications.find(
    (item) => !employeeNotifications.some((own) => own.id === item.id),
  );
  assert.ok(foreignNotification, "notification ownership test has no fixture");
  ensureResponse(
    await employee(`/notifications/${foreignNotification.id}/read`, {
      method: "POST",
    }),
    404,
    "notification ownership",
  );
  ensureResponse(
    await employee(`/notifications/${ownNotification.id}/read`, {
      method: "POST",
    }),
    200,
    "individual notification read",
  );
  const queuedNotificationEmail = await db.collection("email_outbox").findOne({
    user_id: userByRole.employee.id,
    sensitive: false,
  });
  if (process.env.EMAIL_NOTIFICATIONS_ENABLED === "false")
    assert.equal(queuedNotificationEmail, null);
  else {
    assert.ok(
      queuedNotificationEmail,
      "in-app ticket notification was not added to the email outbox",
    );
    assert.match(queuedNotificationEmail.subject, /^\[TicketFlow\]/);
    assert.equal(queuedNotificationEmail.status, "pending");
  }

  const memberSla = ensureResponse(
    await superAdmin("/reports/member-sla?department=IT"),
    200,
    "Super Admin member SLA",
  );
  const testedMember = memberSla.members.find(
    (member) => member.member_id === userByRole.it.id,
  );
  assert.ok(testedMember, "IT member is missing from the SLA report");
  assert.ok(testedMember.assigned >= 3 && testedMember.resolved >= 2);
  const dashboard = ensureResponse(
    await superAdmin("/dashboard?department=IT"),
    200,
    "Super Admin escalation metrics",
  );
  for (const field of [
    "escalated",
    "response_sla_breached",
    "resolution_sla_breached",
    "resolution_sla_pending",
  ])
    assert.equal(typeof dashboard[field], "number", `${field} is not numeric`);

  const fridayClose = new Date("2026-08-14T13:30:00.000Z");
  assert.equal(
    addWorkingHours(fridayClose, 1).toISOString(),
    "2026-08-17T05:30:00.000Z",
    "Friday after-hours SLA did not resume Monday at 10:00 IST",
  );
  assert.equal(
    workingMinutesBetween(
      new Date("2026-08-14T13:30:00.000Z"),
      new Date("2026-08-17T04:30:00.000Z"),
    ),
    0,
    "Weekend time was counted toward SLA",
  );

  console.log("PASS: 61 ticket lifecycle, RBAC, email/dashboard approval, SLA, and escalation assertions");
} finally {
  await cleanup();
  await closePostgres();
}

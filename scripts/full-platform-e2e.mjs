import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  closePostgres,
  connectToPostgres,
} from "../lib/postgres-document-db.js";

const baseUrl = process.env.E2E_URL || "http://127.0.0.1:3004/api";
const appUrl = new URL(baseUrl).origin;
const database = await connectToPostgres();
const runId = `full-e2e-${Date.now()}-${randomBytes(3).toString("hex")}`;
const password = `Full-${randomBytes(18).toString("base64url")}!`;
const created = {
  users: [],
  tickets: [],
  tasks: [],
  parking: [],
  checklists: [],
  attachments: [],
};
let assertions = 0;

function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

async function request(path, { method = "GET", body, cookie, headers = {} } = {}) {
  const form = body instanceof FormData;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined && !form ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.arrayBuffer();
  return { response, payload };
}

async function login(user) {
  const result = await request("/auth/login", {
    method: "POST",
    body: { email: user.email, password, location: user.location },
  });
  equal(result.response.status, 200, `${user.role} login failed`);
  const cookie = (result.response.headers.get("set-cookie") || "").split(";", 1)[0];
  check(cookie.startsWith("tf_token="), `${user.role} session cookie missing`);
  return cookie;
}

function fixture(role, location, suffix = role) {
  return {
    id: randomUUID(),
    name: `Full E2E ${suffix}`,
    email: `${runId}-${suffix.replace(/_/g, "-")}@ethara.ai`,
    role,
    department: role === "it" ? "IT" : role === "admin" ? "Admin" : role === "super_admin" ? "Management" : "General",
    employee_id: `E2E-${randomBytes(3).toString("hex").toUpperCase()}`,
    location,
    active: true,
    email_verified: true,
    email_verified_at: new Date(),
    session_version: 0,
    test_run_id: runId,
    created_at: new Date(),
  };
}

const users = {
  employee: fixture("employee", "Tulip", "employee"),
  otherEmployee: fixture("employee", "Lotus", "employee-other"),
  tulipIt: fixture("it", "Tulip", "it-tulip"),
  lotusIt: fixture("it", "Lotus", "it-lotus"),
  admin: fixture("admin", "Tulip", "admin"),
  superAdmin: fixture("super_admin", "Tulip", "super-admin"),
};

async function cleanup() {
  const ticketIds = created.tickets;
  const userIds = created.users;
  const checklistIds = created.checklists;
  await Promise.all([
    database.collection("history").deleteMany({ ticket_id: { $in: ticketIds } }),
    database.collection("comments").deleteMany({ ticket_id: { $in: ticketIds } }),
    database.collection("approvals").deleteMany({ ticket_id: { $in: ticketIds } }),
    database.collection("notifications").deleteMany({
      $or: [{ user_id: { $in: userIds } }, { ticket_id: { $in: ticketIds } }],
    }),
    database.collection("email_outbox").deleteMany({ user_id: { $in: userIds } }),
    database.collection("audit_logs").deleteMany({
      $or: [
        { actor_id: { $in: userIds } },
        { entity_id: { $in: [...ticketIds, ...created.tasks, ...created.parking, ...checklistIds] } },
      ],
    }),
    database.collection("tickets").deleteMany({ id: { $in: ticketIds } }),
    database.collection("tasks").deleteMany({ id: { $in: created.tasks } }),
    database.collection("parking_allocations").deleteMany({ id: { $in: created.parking } }),
    database.collection("member_checklists").deleteMany({ id: { $in: checklistIds } }),
    database.collection("member_checklist_submissions").deleteMany({ checklist_id: { $in: checklistIds } }),
    database.collection("kra_escalations").deleteMany({ checklist_id: { $in: checklistIds } }),
    database.collection("attachments").deleteMany({ id: { $in: created.attachments } }),
    database.collection("login_otp_challenges").deleteMany({ user_id: { $in: userIds } }),
    database.collection("email_verifications").deleteMany({ user_id: { $in: userIds } }),
  ]);
  for (const id of created.attachments) await database.deleteBlob(id);
  await database.collection("users").deleteMany({ id: { $in: userIds } });
}

try {
  const passwordHash = await bcrypt.hash(password, 10);
  const fixtureUsers = Object.values(users).map((user) => ({
    ...user,
    password_hash: passwordHash,
  }));
  await database.collection("users").insertMany(fixtureUsers);
  created.users.push(...fixtureUsers.map((user) => user.id));

  const appResponse = await fetch(appUrl);
  equal(appResponse.status, 200, "application root is unavailable");
  check(appResponse.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), "CSP frame protection missing");
  equal(appResponse.headers.get("x-frame-options"), "DENY", "X-Frame-Options missing");
  equal(appResponse.headers.get("x-content-type-options"), "nosniff", "nosniff missing");

  equal((await request("/dashboard")).response.status, 401, "unauthenticated dashboard access was allowed");
  equal(
    (
      await request("/auth/register", {
        method: "POST",
        headers: { origin: "https://attacker.invalid" },
        body: {},
      })
    ).response.status,
    403,
    "cross-site mutation was allowed",
  );
  equal(
    (
      await request("/auth/login", {
        method: "POST",
        body: { email: { $ne: null }, password: "x" },
      })
    ).response.status,
    400,
    "object login input was not rejected",
  );

  const cookies = {};
  for (const [name, user] of Object.entries(users)) cookies[name] = await login(user);

  equal((await request("/audit", { cookie: cookies.employee })).response.status, 403, "employee audit access was allowed");
  equal((await request("/firewall/overview", { cookie: cookies.employee })).response.status, 403, "employee firewall access was allowed");
  equal(
    (
      await request("/firewall/archive/sync?firewall=hq", {
        method: "POST",
        cookie: cookies.employee,
      })
    ).response.status,
    403,
    "employee firewall archive sync was allowed",
  );
  const userDirectory = await request("/users", { cookie: cookies.superAdmin });
  equal(userDirectory.response.status, 200, "Super Admin user directory failed");
  check(userDirectory.payload.every((user) => !("password_hash" in user) && !("session_version" in user)), "user directory leaked credentials or session state");

  const employeeRegistrationEmail = `${runId}-registered@ethara.ai`;
  const employeeRegistration = await request("/auth/register", {
    method: "POST",
    body: {
      name: "Registered Employee",
      email: employeeRegistrationEmail,
      password,
      role: "employee",
      location: "Tulip",
      employee_id: "E2E-REG",
    },
  });
  equal(employeeRegistration.response.status, 200, "employee registration failed");
  const registeredEmployee = await database.collection("users").findOne({ email: employeeRegistrationEmail });
  check(registeredEmployee?.active, "employee registration was not activated");
  created.users.push(registeredEmployee.id);

  const adminRegistrationEmail = `${runId}-registered-admin@ethara.ai`;
  const staffRegistration = await request("/auth/register", {
    method: "POST",
    body: {
      name: "Pending Admin",
      email: adminRegistrationEmail,
      password,
      role: "admin",
      location: "Tulip",
      employee_id: "E2E-ADM",
    },
  });
  equal(staffRegistration.response.status, 202, "privileged registration was not held for approval");
  const pendingAdmin = await database.collection("users").findOne({ email: adminRegistrationEmail });
  equal(pendingAdmin.active, false, "privileged registration became active without approval");
  created.users.push(pendingAdmin.id);

  const categories = await request("/categories?department=IT", { cookie: cookies.employee });
  const category = categories.payload[0]?.name;
  check(category, "IT category fixture is missing");
  equal(
    (
      await request("/tickets", {
        method: "POST",
        cookie: cookies.employee,
        body: { department: "IT", category: "Not configured", title: "Bad", description: "Bad", location: "Tulip" },
      })
    ).response.status,
    400,
    "invalid ticket category was accepted",
  );
  const ticketResult = await request("/tickets", {
    method: "POST",
    cookie: cookies.employee,
    body: {
      department: "IT",
      category,
      title: "Full platform lifecycle",
      description: "End-to-end test ticket",
      priority: "High",
      location: "Tulip - Ground Floor",
    },
  });
  equal(ticketResult.response.status, 200, "employee ticket creation failed");
  const ticket = ticketResult.payload;
  created.tickets.push(ticket.id);
  equal(ticket.allocation_status, "unallocated", "new ticket is not in the unallocated queue");
  equal((await request(`/tickets/${ticket.id}`, { cookie: cookies.lotusIt })).response.status, 403, "cross-location IT object access was allowed");
  equal((await request(`/tickets/${ticket.id}`, { cookie: cookies.tulipIt })).response.status, 200, "routed IT member cannot see ticket");
  equal(
    (
      await request(`/tickets/${ticket.id}`, {
        method: "PATCH",
        cookie: cookies.tulipIt,
        body: { assignee_id: users.lotusIt.id },
      })
    ).response.status,
    403,
    "non-head IT member assigned another member",
  );
  const claimed = await request(`/tickets/${ticket.id}`, {
    method: "PATCH",
    cookie: cookies.tulipIt,
    body: { assignee_id: users.tulipIt.id },
  });
  equal(claimed.response.status, 200, "IT self-claim failed");
  equal(claimed.payload.status, "Assigned", "claimed ticket status is wrong");
  equal(
    (
      await request(`/tickets/${ticket.id}`, {
        method: "PATCH",
        cookie: cookies.tulipIt,
        body: { status: "Not a status" },
      })
    ).response.status,
    400,
    "invalid ticket status was accepted",
  );

  const fakeFile = new FormData();
  fakeFile.append("files", new Blob(["not a pdf"], { type: "application/pdf" }), "proof.pdf");
  equal(
    (
      await request("/attachments", {
        method: "POST",
        cookie: cookies.employee,
        body: fakeFile,
      })
    ).response.status,
    415,
    "invalid attachment signature was accepted",
  );
  const validFile = new FormData();
  validFile.append("files", new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" }), "proof.pdf");
  const upload = await request("/attachments", {
    method: "POST",
    cookie: cookies.employee,
    body: validFile,
  });
  equal(upload.response.status, 201, "valid attachment upload failed");
  const attachmentId = upload.payload.attachments[0].id;
  created.attachments.push(attachmentId);
  equal((await request(`/attachments/${attachmentId}`, { cookie: cookies.otherEmployee })).response.status, 403, "another employee downloaded a pending attachment");
  equal((await request(`/attachments/${attachmentId}`, { cookie: cookies.employee })).response.status, 200, "attachment owner cannot download pending attachment");

  equal(
    (
      await request("/tasks", {
        method: "POST",
        cookie: cookies.admin,
        body: { title: "   " },
      })
    ).response.status,
    400,
    "blank task was accepted",
  );
  const task = await request("/tasks", {
    method: "POST",
    cookie: cookies.admin,
    body: { title: "E2E task", category: "Facilities", location: "Tulip", recurrence: "one-time", priority: "Medium" },
  });
  equal(task.response.status, 200, "task creation failed");
  created.tasks.push(task.payload.id);
  equal((await request(`/tasks/${randomUUID()}`, { method: "PATCH", cookie: cookies.admin, body: { status: "Completed" } })).response.status, 404, "missing task update did not return 404");
  equal((await request(`/tasks/${task.payload.id}`, { method: "PATCH", cookie: cookies.admin, body: { status: "Invalid" } })).response.status, 400, "invalid task status was accepted");

  const allocationBody = {
    member_id: users.employee.id,
    vehicle_type: "two_wheeler",
    vehicle_number: `E2E ${randomBytes(3).toString("hex").toUpperCase()}`,
    slot_number: 90,
  };
  const [parkingOne, parkingTwo] = await Promise.all([
    request("/parking", { method: "POST", cookie: cookies.admin, body: allocationBody }),
    request("/parking", { method: "POST", cookie: cookies.superAdmin, body: { ...allocationBody, vehicle_number: `${allocationBody.vehicle_number} X` } }),
  ]);
  const parkingStatuses = [parkingOne.response.status, parkingTwo.response.status].sort();
  assertions += 1;
  assert.deepEqual(parkingStatuses, [200, 409], "concurrent parking allocation was not protected");
  const successfulParking = parkingOne.response.status === 200 ? parkingOne.payload : parkingTwo.payload;
  created.parking.push(successfulParking.id);

  const checklist = await request("/member-checklists", {
    method: "POST",
    cookie: cookies.superAdmin,
    body: { member_id: users.tulipIt.id, title: "E2E KRA", items: ["Review queue", "Update register"] },
  });
  equal(checklist.response.status, 200, "KRA creation failed");
  created.checklists.push(checklist.payload.id);
  equal(
    (
      await request(`/member-checklists/${checklist.payload.id}/submit`, {
        method: "POST",
        cookie: cookies.tulipIt,
        body: { responses: [{ item: "Injected item", done: true }] },
      })
    ).response.status,
    400,
    "tampered KRA response was accepted",
  );
  const kraSubmission = await request(`/member-checklists/${checklist.payload.id}/submit`, {
    method: "POST",
    cookie: cookies.tulipIt,
    body: { responses: checklist.payload.items.map((item) => ({ key: item.key, item: item.label, done: true, remark: "Verified" })) },
  });
  equal(kraSubmission.response.status, 200, "valid KRA submission failed");
  equal(kraSubmission.payload.done_count, 2, "KRA completion count is wrong");

  await request(`/tickets/${ticket.id}`, {
    method: "PATCH",
    cookie: cookies.tulipIt,
    body: { resolution: { summary: "Resolved in end-to-end test" } },
  });
  const confirmation = await request(`/tickets/${ticket.id}/confirm`, {
    method: "POST",
    cookie: cookies.employee,
    body: { action: "confirm", rating: 5, comment: "Verified" },
  });
  equal(confirmation.response.status, 200, "employee resolution acknowledgement failed");
  equal(confirmation.payload.status, "Closed", "acknowledged ticket did not close");
  equal(
    (
      await request(`/tickets/${ticket.id}`, {
        method: "PATCH",
        cookie: cookies.tulipIt,
        body: { status: "In Progress" },
      })
    ).response.status,
    409,
    "closed ticket was reopened",
  );

  const logout = await request("/auth/logout", { method: "POST", cookie: cookies.employee });
  equal(logout.response.status, 200, "logout failed");
  const revoked = await request("/auth/me", { cookie: cookies.employee });
  equal(revoked.payload.user, null, "logged-out session remained valid");

  console.log(`PASS: ${assertions} frontend-header, auth, RBAC, validation, attachment, ticket, task, parking, KRA and session assertions`);
} finally {
  await cleanup();
  await closePostgres();
}

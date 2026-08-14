import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  closePostgres,
  connectToPostgres,
} from "../lib/postgres-document-db.js";

const baseUrl = "http://localhost:3004/api";
const origin = "http://localhost:3004";
const database = await connectToPostgres();
const createdTicketIds = [];
const createdChecklistIds = [];
const testTitle = `KRA import verification ${Date.now()}`;

function cookieFrom(response) {
  return (response.headers.get("set-cookie") || "").split(";", 1)[0];
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const formData = body instanceof FormData;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined && !formData
        ? { "content-type": "application/json" }
        : {}),
    },
    body:
      body === undefined ? undefined : formData ? body : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload, cookie: cookieFrom(response) };
}

async function demoLogin(email, location) {
  const result = await request("/auth/demo-login", {
    method: "POST",
    body: { email, location },
  });
  assert.equal(result.response.status, 200, result.payload.error);
  assert.ok(result.cookie);
  return result;
}

try {
  const fixtures = await database
    .collection("users")
    .find({ seeded_fixture: true })
    .toArray();
  const superAdmin = fixtures.find((user) => user.role === "super_admin");
  const admin = fixtures.find((user) => user.role === "admin");
  const itMember = fixtures.find((user) => user.role === "it");
  const employee = fixtures.find((user) => user.role === "employee");
  assert.ok(superAdmin && admin && itMember && employee);

  const superSession = await demoLogin(superAdmin.email, "Tulip");
  const adminSession = await demoLogin(admin.email, "Lotus");
  const itSession = await demoLogin(itMember.email, "Lotus");

  const adminMe = await request("/auth/me", { cookie: adminSession.cookie });
  assert.equal(adminMe.payload.user.location, "Lotus");
  assert.equal(adminMe.payload.user.login_site, "Lotus");

  const visibleUsers = await request("/users", { cookie: superSession.cookie });
  assert.equal(visibleUsers.response.status, 200);
  assert.equal(
    visibleUsers.payload.length,
    await database.collection("users").countDocuments({}),
  );

  const teamTickets = await request("/tickets?limit=100", {
    cookie: itSession.cookie,
  });
  assert.equal(teamTickets.response.status, 200);
  assert.ok(
    teamTickets.payload.items.every(
      (ticket) =>
        ticket.assignee_id === itMember.id ||
        /lotus/i.test(`${ticket.routing_site || ""} ${ticket.location || ""}`) ||
        (!ticket.assignee_id && !ticket.routing_site),
    ),
    "IT team scope included an allocated ticket from an unrelated location",
  );

  const categories = await request("/categories?department=Admin", {
    cookie: adminSession.cookie,
  });
  const locations = await request("/locations", { cookie: adminSession.cookie });
  const ticket = await request("/tickets", {
    method: "POST",
    cookie: adminSession.cookie,
    body: {
      department: "Admin",
      category: categories.payload[0].name,
      title: `Manual affected employee verification ${Date.now()}`,
      description: "End-to-end validation for manual employee identity mapping.",
      priority: "Low",
      location: locations.payload.find((item) => /lotus/i.test(item.name))?.name,
      raised_for_name: employee.name,
      email: employee.email,
      employee_id: employee.employee_id,
    },
  });
  assert.equal(ticket.response.status, 200, ticket.payload.error);
  createdTicketIds.push(ticket.payload.id);
  assert.equal(ticket.payload.issue_user_id, employee.id);
  assert.equal(ticket.payload.issue_user_email, employee.email);
  assert.equal(ticket.payload.issue_user_employee_code, employee.employee_id);

  const employeeSession = await demoLogin(employee.email, "Lotus");
  const employeeTickets = await request("/tickets?limit=100", {
    cookie: employeeSession.cookie,
  });
  assert.ok(
    employeeTickets.payload.items.some((item) => item.id === ticket.payload.id),
    "Mapped ticket was not visible to the affected employee",
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Daily Work");
  sheet.addRow(["Task", "Owner"]);
  sheet.addRow(["Review assigned tickets", itMember.name]);
  sheet.addRow(["Update the daily asset register", itMember.name]);
  sheet.addRow(["Publish end-of-day status", itMember.name]);
  const spreadsheet = await workbook.xlsx.writeBuffer();
  const upload = new FormData();
  upload.append(
    "file",
    new Blob([spreadsheet], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "daily-work.xlsx",
  );
  const preview = await request("/member-checklists/import-preview", {
    method: "POST",
    cookie: superSession.cookie,
    body: upload,
  });
  assert.equal(preview.response.status, 200, preview.payload.error);
  assert.deepEqual(preview.payload.items, [
    "Review assigned tickets",
    "Update the daily asset register",
    "Publish end-of-day status",
  ]);

  const checklist = await request("/member-checklists", {
    method: "POST",
    cookie: superSession.cookie,
    body: {
      member_id: itMember.id,
      title: testTitle,
      items: preview.payload.items,
      cutoff: "18:00",
    },
  });
  assert.equal(checklist.response.status, 200, checklist.payload.error);
  createdChecklistIds.push(checklist.payload.id);
  assert.equal(checklist.payload.cutoff, "19:00");
  assert.equal(checklist.payload.items.length, 3);

  // Move only the disposable test checklist's deadline into the past so the
  // idempotent escalation path can be verified without changing system time.
  await database
    .collection("member_checklists")
    .updateOne({ id: checklist.payload.id }, { $set: { cutoff: "00:01" } });
  await request("/member-checklists", { cookie: itSession.cookie });
  const escalation = await database.collection("kra_escalations").findOne({
    checklist_id: checklist.payload.id,
  });
  assert.ok(escalation, "the overdue KRA was not escalated and recorded");
  assert.equal(escalation.status, "not_submitted");
  const escalationNotifications = await database
    .collection("notifications")
    .find({ message: { $regex: testTitle } })
    .toArray();
  assert.ok(
    escalationNotifications.some((item) => item.user_id === itMember.id),
    "the KRA owner did not receive the escalation notification",
  );
  assert.ok(
    escalationNotifications.some((item) => item.user_id === superAdmin.id),
    "Super Admin did not receive the escalation notification",
  );
  await database
    .collection("member_checklists")
    .updateOne({ id: checklist.payload.id }, { $set: { cutoff: "19:00" } });

  const assigned = await request("/member-checklists", {
    cookie: itSession.cookie,
  });
  const assignedChecklist = assigned.payload.find(
    (item) => item.id === checklist.payload.id,
  );
  assert.equal(assignedChecklist.cutoff, "19:00");

  const submission = await request(
    `/member-checklists/${checklist.payload.id}/submit`,
    {
      method: "POST",
      cookie: itSession.cookie,
      body: {
        responses: preview.payload.items.map((item) => ({
          item,
          done: true,
          remark: "Verified",
        })),
      },
    },
  );
  assert.equal(submission.response.status, 200, submission.payload.error);
  assert.ok(["Completed", "Late"].includes(submission.payload.status));

  const report = await request("/reports/daily-kra", {
    cookie: superSession.cookie,
  });
  assert.equal(report.response.status, 200);
  assert.equal(report.payload.cutoff, "19:00");

  console.log(
    "PASS: login location, Super Admin user visibility, IT team scope, manual affected-user mapping, Excel KRA import, 7 PM cutoff, escalation notifications/recording and KRA submission",
  );
} finally {
  if (createdTicketIds.length) {
    await Promise.all([
      database.collection("tickets").deleteMany({ id: { $in: createdTicketIds } }),
      database.collection("history").deleteMany({ ticket_id: { $in: createdTicketIds } }),
      database.collection("comments").deleteMany({ ticket_id: { $in: createdTicketIds } }),
      database.collection("notifications").deleteMany({ ticket_id: { $in: createdTicketIds } }),
      database.collection("audit_logs").deleteMany({ entity_id: { $in: createdTicketIds } }),
    ]);
  }
  if (createdChecklistIds.length) {
    await Promise.all([
      database.collection("member_checklists").deleteMany({ id: { $in: createdChecklistIds } }),
      database.collection("member_checklist_submissions").deleteMany({ checklist_id: { $in: createdChecklistIds } }),
      database.collection("kra_escalations").deleteMany({ checklist_id: { $in: createdChecklistIds } }),
      database.collection("audit_logs").deleteMany({ entity_id: { $in: createdChecklistIds } }),
      database.collection("notifications").deleteMany({ message: { $regex: testTitle } }),
    ]);
  }
  await closePostgres();
}

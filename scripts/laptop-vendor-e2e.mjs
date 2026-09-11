// End-to-end verification of the laptop asset / vendor analysis feature:
// serial + GRP lookup, ticket-to-vendor mapping on creation, and the
// role-gated vendor analysis report. Creates throwaway users and tickets and
// removes them afterwards.
//   node --env-file=.env.local scripts/laptop-vendor-e2e.mjs
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  closePostgres,
  connectToPostgres,
} from "../lib/postgres-document-db.js";

const baseUrl = process.env.WORKFLOW_TEST_URL || "http://localhost:3010/api";
const db = await connectToPostgres();
const runId = `laptop-vendor-test-${Date.now()}-${randomBytes(3).toString("hex")}`;
const password = `Test-${randomBytes(18).toString("base64url")}!`;
const location = "Tulip - Ground Floor";

// Known rows from the bundled inventory sheets (read-only reference data).
const GREEN_PC_SERIAL = "PF3MJ8ZB"; // Lenovo · GRP1520 · Green PC
const SICPL_SERIAL = "CND14334HS"; // HP · SICPL
const GRP_WITH_LAPTOP = "GRTP1090"; // Deeksha Pathak · Lenovo PF2TAS38 · Green PC

const users = [
  { role: "employee", name: "Laptop Test Employee", department: "General" },
  { role: "it", name: "Laptop Test IT", department: "IT" },
  { role: "admin", name: "Laptop Test Admin", department: "Admin" },
  { role: "super_admin", name: "Laptop Test Super Admin", department: "Management" },
].map((user) => ({
  ...user,
  id: randomUUID(),
  email: `${runId}-${user.role.replace("_", "-")}@ethara.ai`,
  employee_id: user.role === "employee" ? GRP_WITH_LAPTOP : `TEST-${randomBytes(3).toString("hex").toUpperCase()}`,
  location,
  active: true,
  email_verified: true,
  session_version: 0,
  created_at: new Date(),
  test_run_id: runId,
}));
const userByRole = Object.fromEntries(users.map((user) => [user.role, user]));
const ticketIds = [];

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

async function createTicket(client, extra, label) {
  const result = await client("/tickets", {
    method: "POST",
    body: {
      department: "IT",
      category: "Laptop Repair",
      title: `${runId} ${label}`,
      description: "Automated laptop vendor mapping verification",
      priority: "Low",
      location,
      ...extra,
    },
  });
  const ticket = ensureResponse(result, 200, label);
  ticketIds.push(ticket.id);
  return ticket;
}

async function cleanup() {
  const ids = users.map((user) => user.id);
  if (ticketIds.length) {
    await Promise.all([
      db.collection("history").deleteMany({ ticket_id: { $in: ticketIds } }),
      db.collection("comments").deleteMany({ ticket_id: { $in: ticketIds } }),
      db.collection("notifications").deleteMany({ ticket_id: { $in: ticketIds } }),
      db.collection("audit_logs").deleteMany({
        $or: [{ actor_id: { $in: ids } }, { entity_id: { $in: ticketIds } }],
      }),
    ]);
    await db.collection("tickets").deleteMany({ id: { $in: ticketIds } });
  }
  await db.collection("notifications").deleteMany({ user_id: { $in: ids } });
  await db.collection("email_outbox").deleteMany({ user_id: { $in: ids } });
  await db.collection("login_otp_challenges").deleteMany({ user_id: { $in: ids } });
  await db.collection("users").deleteMany({ id: { $in: ids } });
}

try {
  const passwordHash = await bcrypt.hash(password, 10);
  await db
    .collection("users")
    .insertMany(users.map((user) => ({ ...user, password_hash: passwordHash })));

  const employee = await login(userByRole.employee);
  const it = await login(userByRole.it);
  const admin = await login(userByRole.admin);
  const superAdmin = await login(userByRole.super_admin);

  // 1. Serial and GRP lookup resolve inventory rows for any signed-in role.
  const bySerial = ensureResponse(
    await employee(`/assets/laptops?query=${GREEN_PC_SERIAL.toLowerCase()}`),
    200,
    "asset lookup by serial",
  );
  assert.equal(bySerial.items[0]?.serial_number, GREEN_PC_SERIAL);
  assert.equal(bySerial.items[0]?.vendor, "Green PC");
  const byGrp = ensureResponse(
    await it(`/assets/laptops?query=grp1520`),
    200,
    "asset lookup by GRP code",
  );
  assert.equal(byGrp.items[0]?.employee_code, "GRP1520");

  // 2. Ticket with an entered serial maps to the vendor (case-insensitive).
  const serialTicket = await createTicket(
    employee,
    { asset_serial_number: ` ${GREEN_PC_SERIAL.toLowerCase()} ` },
    "ticket with entered serial",
  );
  assert.equal(serialTicket.asset_serial_number, GREEN_PC_SERIAL);
  assert.equal(serialTicket.asset_vendor, "Green PC");
  assert.equal(serialTicket.asset_matched, true);
  assert.equal(serialTicket.asset_match_source, "serial_number");

  // 3. Laptop-category ticket without a serial auto-maps via the employee's
  // GRP code.
  const grpTicket = await createTicket(employee, {}, "ticket mapped via GRP code");
  assert.equal(grpTicket.asset_employee_code, GRP_WITH_LAPTOP);
  assert.equal(grpTicket.asset_vendor, "Green PC");
  assert.equal(grpTicket.asset_match_source, "employee_code");

  // 4. SICPL serial maps to the second vendor.
  const sicplTicket = await createTicket(
    it,
    { asset_serial_number: SICPL_SERIAL },
    "SICPL serial ticket",
  );
  assert.equal(sicplTicket.asset_vendor, "SICPL");

  // 5. Unknown serial is recorded but flagged unmatched.
  const unknownTicket = await createTicket(
    it,
    { asset_serial_number: "ZZTEST9999" },
    "unknown serial ticket",
  );
  assert.equal(unknownTicket.asset_serial_number, "ZZTEST9999");
  assert.equal(unknownTicket.asset_matched, false);
  assert.equal(unknownTicket.asset_vendor, null);

  // 6. Non-laptop categories without a serial stay unmapped.
  const plainTicket = await createTicket(
    it,
    { category: "Internet Issues", asset_serial_number: "" },
    "non-laptop ticket",
  );
  assert.equal(plainTicket.asset_serial_number, undefined);

  // 7. Vendor analysis: allowed for IT, Admin, Super Admin; denied to employees.
  ensureResponse(await employee("/reports/vendor-analysis"), 403, "employee denied");
  for (const [client, label] of [
    [it, "it"],
    [admin, "admin"],
    [superAdmin, "super_admin"],
  ]) {
    const report = ensureResponse(
      await client("/reports/vendor-analysis"),
      200,
      `${label} vendor analysis`,
    );
    const greenPc = report.vendors.find((row) => row.vendor === "Green PC");
    const sicpl = report.vendors.find((row) => row.vendor === "SICPL");
    assert.ok(greenPc, "Green PC missing from vendor analysis");
    assert.ok(sicpl, "SICPL missing from vendor analysis");
    assert.equal(greenPc.fleet_size, 765);
    assert.equal(sicpl.fleet_size, 369);
    assert.ok(greenPc.tickets_total >= 2, "Green PC ticket count not aggregated");
    assert.ok(sicpl.tickets_total >= 1, "SICPL ticket count not aggregated");
    assert.ok(report.totals.fleet_size >= 1134);
    assert.ok(report.totals.unmatched_tickets >= 1);
    assert.ok(report.totals.top_vendor, "top vendor missing");
  }

  console.log(
    "PASS: laptop lookup, serial/GRP ticket mapping, and vendor analysis RBAC verified",
  );
} finally {
  await cleanup();
  await closePostgres();
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import bcrypt from "bcryptjs";
import {
  closePostgres,
  connectToPostgres,
} from "../lib/postgres-document-db.js";

const appPort = 3014;
const mailPort = 39005;
const baseUrl = `http://127.0.0.1:${appPort}/api`;
const receivedEmails = [];
const mailServer = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/emails") {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    receivedEmails.push({
      authorization: request.headers.authorization,
      body: JSON.parse(body),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: randomUUID() }));
  });
});

await new Promise((resolve, reject) => {
  mailServer.once("error", reject);
  mailServer.listen(mailPort, "127.0.0.1", resolve);
});

const nextServer = spawn(
  process.execPath,
  [".next-build/standalone/server.js"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(appPort),
      NEXT_DIST_DIR: ".next-build",
      LOGIN_OTP_REQUIRED: "true",
      EMAIL_NOTIFICATIONS_ENABLED: "true",
      EMAIL_DELIVERY_MONITOR_DISABLED: "true",
      EMAIL_TRANSPORT: "resend",
      RESEND_API_KEY: "otp-e2e-provider-key",
      MAIL_FROM: "TicketFlow Test <ticketflow@example.test>",
      RESEND_API_URL: `http://127.0.0.1:${mailPort}/emails`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverErrors = "";
nextServer.stderr.on("data", (chunk) => {
  serverErrors += String(chunk);
});

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`OTP test server did not start: ${serverErrors.slice(-500)}`);
}

function cookieValue(response, name) {
  const cookies = response.headers.getSetCookie?.() || [
    response.headers.get("set-cookie") || "",
  ];
  const match = cookies
    .join(",")
    .match(new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`));
  return match ? `${name}=${match[1]}` : "";
}

const db = await connectToPostgres();
const user = {
  id: randomUUID(),
  name: "OTP Workflow User",
  email: `otp-workflow-${Date.now()}@ethara.ai`,
  role: "employee",
  department: "General",
  employee_id: `OTP-${randomBytes(3).toString("hex")}`,
  location: "Tulip - Ground Floor",
  active: true,
  email_verified: true,
  session_version: 0,
  test_run_id: "login-otp-e2e",
  created_at: new Date(),
};
const password = `Otp-${randomBytes(18).toString("base64url")}!`;
user.password_hash = await bcrypt.hash(password, 10);
let challengeId = null;

try {
  await db.collection("users").insertOne(user);
  await waitForServer();
  const loginResponse = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password, remember: true }),
  });
  assert.equal(loginResponse.status, 200);
  const loginBody = await loginResponse.json();
  assert.equal(loginBody.otp_required, true);
  assert.ok(!loginBody.user, "Login issued a user session before OTP verification");
  assert.ok(!loginBody.masked_email.includes(user.email.split("@")[0]));
  const challengeCookie = cookieValue(loginResponse, "tf_login_challenge");
  assert.ok(challengeCookie, "OTP challenge cookie is missing");
  const challengeCookieHeader = loginResponse.headers.get("set-cookie") || "";
  assert.match(challengeCookieHeader, /HttpOnly/i);
  assert.match(challengeCookieHeader, /SameSite=Strict/i);
  assert.match(challengeCookieHeader, /Secure/i);
  assert.equal(cookieValue(loginResponse, "tf_token"), "");
  const userEmails = receivedEmails.filter((email) =>
    email.body.to?.includes(user.email),
  );
  assert.equal(userEmails.length, 1);
  assert.equal(userEmails[0].authorization, "Bearer otp-e2e-provider-key");
  assert.deepEqual(userEmails[0].body.to, [user.email]);
  const code = userEmails[0].body.text.match(/code is: (\d{6})/)?.[1];
  assert.match(code || "", /^\d{6}$/);

  const challenge = await db
    .collection("login_otp_challenges")
    .findOne({ user_id: user.id, consumed_at: null });
  assert.ok(challenge);
  challengeId = challenge.id;
  assert.notEqual(challenge.code_hash, code);
  assert.ok(!JSON.stringify(challenge).includes(code));

  const wrongCode = code === "000000" ? "999999" : "000000";
  const wrongResponse = await fetch(`${baseUrl}/auth/login/otp/verify`, {
    method: "POST",
    headers: {
      cookie: challengeCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ code: wrongCode }),
  });
  assert.equal(wrongResponse.status, 401);
  assert.equal(cookieValue(wrongResponse, "tf_token"), "");

  const verifyResponse = await fetch(`${baseUrl}/auth/login/otp/verify`, {
    method: "POST",
    headers: {
      cookie: challengeCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
  assert.equal(verifyResponse.status, 200);
  assert.equal((await verifyResponse.json()).user.id, user.id);
  assert.ok(cookieValue(verifyResponse, "tf_token"));
  const sessionCookieHeader = verifyResponse.headers.get("set-cookie") || "";
  assert.match(sessionCookieHeader, /HttpOnly/i);
  assert.match(sessionCookieHeader, /SameSite=Lax/i);
  assert.match(sessionCookieHeader, /Secure/i);
  assert.match(
    verifyResponse.headers.get("set-cookie") || "",
    /Max-Age=2592000/,
    "Remember-me session did not retain its 30-day lifetime",
  );

  const replayResponse = await fetch(`${baseUrl}/auth/login/otp/verify`, {
    method: "POST",
    headers: {
      cookie: challengeCookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
  assert.equal(replayResponse.status, 401);
  const outbox = await db.collection("email_outbox").findOne({
    user_id: user.id,
    sensitive: true,
  });
  assert.equal(outbox.status, "sent");
  assert.equal(outbox.message, "[Sensitive email delivered and removed]");

  const audits = await db
    .collection("audit_logs")
    .find({ actor_id: user.id })
    .toArray();
  assert.ok(audits.some((item) => item.action === "login.otp_requested"));
  assert.ok(audits.some((item) => item.action === "login.otp_failed"));
  assert.ok(audits.some((item) => item.action === "login.otp_verified"));

  console.log("PASS: 28 email OTP, secure-cookie, session, replay, redaction, and audit assertions");
} finally {
  await Promise.all([
    db.collection("login_otp_challenges").deleteMany({ user_id: user.id }),
    db.collection("email_outbox").deleteMany({ user_id: user.id }),
    db.collection("audit_logs").deleteMany({ actor_id: user.id }),
  ]);
  await db.collection("users").deleteOne({ id: user.id });
  const rateKey = (scope, identity) =>
    createHash("sha256")
      .update(`${scope}:local:${identity}`)
      .digest("hex");
  await db.clearRateLimit(rateKey("login-otp-send", user.id));
  if (challengeId)
    await db.clearRateLimit(rateKey("login-otp-verify", challengeId));
  if (nextServer.exitCode === null) {
    nextServer.kill("SIGTERM");
    await new Promise((resolve) => nextServer.once("exit", resolve));
  }
  await new Promise((resolve) => mailServer.close(resolve));
  await closePostgres();
}

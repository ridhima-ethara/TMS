import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import bcrypt from "bcryptjs";
import {
  closePostgres,
  connectToPostgres,
} from "../lib/postgres-document-db.js";

const appPort = 3015;
const smtpPort = 39006;
const baseUrl = `http://127.0.0.1:${appPort}/api`;
const receivedMessages = [];

const smtpServer = createServer((socket) => {
  socket.setEncoding("utf8");
  socket.write("220 localhost Ethara SMTP test server\r\n");
  let buffer = "";
  let dataMode = false;
  let messageLines = [];
  socket.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\r\n")) {
      const boundary = buffer.indexOf("\r\n");
      let line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (dataMode) {
        if (line === ".") {
          receivedMessages.push(messageLines.join("\r\n"));
          messageLines = [];
          dataMode = false;
          socket.write("250 2.0.0 queued\r\n");
        } else {
          if (line.startsWith("..")) line = line.slice(1);
          messageLines.push(line);
        }
        continue;
      }
      const command = line.toUpperCase();
      if (command.startsWith("EHLO") || command.startsWith("HELO"))
        socket.write("250-localhost\r\n250 PIPELINING\r\n");
      else if (command.startsWith("MAIL FROM:") || command.startsWith("RCPT TO:"))
        socket.write("250 2.1.0 OK\r\n");
      else if (command === "DATA") {
        dataMode = true;
        socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
      } else if (command === "RSET" || command === "NOOP")
        socket.write("250 2.0.0 OK\r\n");
      else if (command === "QUIT") {
        socket.write("221 2.0.0 Bye\r\n");
        socket.end();
      } else socket.write("250 2.0.0 OK\r\n");
    }
  });
});

await new Promise((resolve, reject) => {
  smtpServer.once("error", reject);
  smtpServer.listen(smtpPort, "127.0.0.1", resolve);
});

const nextServer = spawn(process.execPath, [".next-build/standalone/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(appPort),
    NEXT_DIST_DIR: ".next-build",
    EMAIL_TRANSPORT: "smtp",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtpPort),
    SMTP_SECURE: "false",
    SMTP_REQUIRE_TLS: "false",
    SMTP_ALLOW_INSECURE_LOCAL: "true",
    SMTP_USER: "",
    SMTP_PASS: "",
    RESEND_API_KEY: "",
    MAIL_FROM: "Ethara SMTP Test <ticketflow@example.test>",
    LOGIN_OTP_REQUIRED: "true",
    EMAIL_DELIVERY_MONITOR_DISABLED: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
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
  throw new Error(`SMTP OTP test server did not start: ${serverErrors.slice(-500)}`);
}

function cookieValue(response, name) {
  const cookies = response.headers.getSetCookie?.() || [
    response.headers.get("set-cookie") || "",
  ];
  const match = cookies.join(",").match(new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`));
  return match ? `${name}=${match[1]}` : "";
}

const db = await connectToPostgres();
const user = {
  id: randomUUID(),
  name: "SMTP OTP User",
  email: `smtp-otp-${Date.now()}@ethara.ai`,
  role: "employee",
  department: "General",
  employee_id: `SMTP-${randomBytes(3).toString("hex")}`,
  location: "Tulip - Ground Floor",
  active: true,
  email_verified: true,
  session_version: 0,
  test_run_id: "smtp-otp-e2e",
  created_at: new Date(),
};
const password = `Smtp-${randomBytes(18).toString("base64url")}!`;
user.password_hash = await bcrypt.hash(password, 10);
let challengeId = null;

try {
  await db.collection("users").insertOne(user);
  await waitForServer();
  const loginResponse = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      password,
      employee_id: user.employee_id,
    }),
  });
  assert.equal(loginResponse.status, 200);
  const loginBody = await loginResponse.json();
  assert.equal(loginBody.otp_required, true);
  assert.equal(loginBody.delivery_state, "sent");
  assert.equal(receivedMessages.length, 1);
  const message = receivedMessages[0];
  assert.match(message, new RegExp(`To: ${user.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
  assert.match(message, /Subject: Your Ethara Service Hub sign-in code/i);
  const code = message.match(/code is: (\d{6})/)?.[1];
  assert.match(code || "", /^\d{6}$/);
  const challenge = await db.collection("login_otp_challenges").findOne({
    user_id: user.id,
    consumed_at: null,
  });
  assert.ok(challenge);
  challengeId = challenge.id;
  assert.ok(!JSON.stringify(challenge).includes(code));
  const verifyResponse = await fetch(`${baseUrl}/auth/login/otp/verify`, {
    method: "POST",
    headers: {
      cookie: cookieValue(loginResponse, "tf_login_challenge"),
      "content-type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
  assert.equal(verifyResponse.status, 200);
  assert.ok(cookieValue(verifyResponse, "tf_token"));
  const outbox = await db.collection("email_outbox").findOne({
    user_id: user.id,
    sensitive: true,
  });
  assert.equal(outbox.status, "sent");
  assert.equal(outbox.message, "[Sensitive email delivered and removed]");
  console.log("PASS: 14 SMTP delivery, login OTP, hashing, session, and redaction assertions");
} finally {
  await Promise.all([
    db.collection("login_otp_challenges").deleteMany({ user_id: user.id }),
    db.collection("email_outbox").deleteMany({ user_id: user.id }),
    db.collection("audit_logs").deleteMany({ actor_id: user.id }),
  ]);
  await db.collection("users").deleteOne({ id: user.id });
  const rateKey = (scope, identity) =>
    createHash("sha256").update(`${scope}:local:${identity}`).digest("hex");
  await db.clearRateLimit(rateKey("login-otp-send", user.id));
  if (challengeId)
    await db.clearRateLimit(rateKey("login-otp-verify", challengeId));
  if (nextServer.exitCode === null) {
    nextServer.kill("SIGTERM");
    await new Promise((resolve) => nextServer.once("exit", resolve));
  }
  await new Promise((resolve) => smtpServer.close(resolve));
  await closePostgres();
}

// Resets the seeded fixture accounts to SEED_DEMO_PASSWORD.
//
// seedDb() only runs against an empty database, so once a development database
// holds real work there is no supported way to recover the fixture logins. This
// script closes that gap without discarding data: it rewrites only the password
// of accounts flagged seeded_fixture, and bumps session_version so any session
// issued under the previous password stops working.
//
// Fixture accounts are still refused at login unless ALLOW_DEMO_LOGIN=true, and
// this script refuses to run against a production environment.
//
//   node --env-file=.env.local scripts/set-demo-passwords.mjs

import bcrypt from "bcryptjs";
import {
  closePostgres,
  connectToPostgres,
} from "../lib/postgres-document-db.js";

const PASSWORD_MIN_LENGTH = 12;

function passwordPolicyError(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH)
    return `must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  )
    return "must include uppercase, lowercase, a number and a symbol";
  return null;
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run: NODE_ENV is production.");
  process.exit(1);
}

const password = process.env.SEED_DEMO_PASSWORD;
const policyError = passwordPolicyError(password);
if (policyError) {
  console.error(`SEED_DEMO_PASSWORD ${policyError}.`);
  process.exit(1);
}

const db = await connectToPostgres();
try {
  const fixtures = await db
    .collection("users")
    .find({ seeded_fixture: true })
    .toArray();

  if (!fixtures.length) {
    console.error(
      "No seeded_fixture accounts found. Load fixtures first with ALLOW_DATABASE_SEED=true.",
    );
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  for (const user of fixtures) {
    await db.collection("users").updateOne(
      { id: user.id },
      {
        $set: {
          password_hash: hash,
          password_reset_required: false,
          active: true,
          email_verified: true,
          session_version: Number(user.session_version || 0) + 1,
        },
      },
    );
    console.log(`updated  ${user.role.padEnd(12)} ${user.email}`);
  }

  console.log(`\n${fixtures.length} fixture account(s) now use SEED_DEMO_PASSWORD.`);
  if (process.env.ALLOW_DEMO_LOGIN !== "true")
    console.log("Note: set ALLOW_DEMO_LOGIN=true or these accounts stay blocked at login.");
} finally {
  await closePostgres();
}

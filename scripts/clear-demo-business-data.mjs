// Removes only operational records linked to accounts marked seeded_fixture.
// Demo login accounts and reference configuration remain available. Run without
// --apply for a dry-run inventory; destructive execution requires --apply.

import {
  closePostgres,
  connectToPostgres,
} from "../lib/postgres-document-db.js";

const apply = process.argv.includes("--apply");
const database = await connectToPostgres();

try {
  const fixtures = await database
    .collection("users")
    .find({ seeded_fixture: true })
    .toArray();
  const userIds = fixtures.map((user) => user.id);
  const userNames = fixtures.map((user) => user.name);
  const tickets = (await database.collection("tickets").find({}).toArray()).filter(
    (ticket) =>
      userIds.includes(ticket.raised_by_id) ||
      userIds.includes(ticket.issue_user_id) ||
      userIds.includes(ticket.assignee_id),
  );
  const ticketIds = tickets.map((ticket) => ticket.id);
  const tasks = await database
    .collection("tasks")
    .find({ owner_id: { $in: userIds } })
    .toArray();
  const checklists = await database
    .collection("member_checklists")
    .find({ member_id: { $in: userIds } })
    .toArray();
  const checklistIds = checklists.map((checklist) => checklist.id);
  const executions = (
    await database.collection("checklist_executions").find({}).toArray()
  ).filter((execution) => userNames.includes(execution.owner_name));
  const parking = await database
    .collection("parking_allocations")
    .find({ member_id: { $in: userIds } })
    .toArray();
  const attachments = await database
    .collection("attachments")
    .find({
      $or: [
        { owner_id: { $in: userIds } },
        { ticket_id: { $in: ticketIds } },
      ],
    })
    .toArray();
  const entityIds = [
    ...ticketIds,
    ...tasks.map((item) => item.id),
    ...checklistIds,
    ...executions.map((item) => item.id),
    ...parking.map((item) => item.id),
    ...attachments.map((item) => item.id),
  ];
  const preview = {
    preserved_demo_login_accounts: fixtures.length,
    tickets: ticketIds.length,
    tasks: tasks.length,
    member_checklists: checklistIds.length,
    checklist_executions: executions.length,
    parking_allocations: parking.length,
    attachments: attachments.length,
    mode: apply ? "apply" : "dry-run",
  };
  console.log(JSON.stringify(preview, null, 2));
  if (!apply) {
    console.log("No records changed. Re-run with --apply to remove this demo business data.");
    process.exitCode = 2;
  } else {
    await Promise.all([
      database.collection("history").deleteMany({ ticket_id: { $in: ticketIds } }),
      database.collection("comments").deleteMany({ ticket_id: { $in: ticketIds } }),
      database.collection("approvals").deleteMany({ ticket_id: { $in: ticketIds } }),
      database.collection("notifications").deleteMany({
        $or: [
          { user_id: { $in: userIds } },
          { ticket_id: { $in: ticketIds } },
        ],
      }),
      database.collection("email_outbox").deleteMany({ user_id: { $in: userIds } }),
      database.collection("audit_logs").deleteMany({
        $or: [
          { actor_id: { $in: userIds } },
          { entity_id: { $in: entityIds } },
        ],
      }),
      database.collection("member_checklist_submissions").deleteMany({
        checklist_id: { $in: checklistIds },
      }),
      database.collection("kra_escalations").deleteMany({
        checklist_id: { $in: checklistIds },
      }),
      database.collection("member_checklists").deleteMany({
        id: { $in: checklistIds },
      }),
      database.collection("checklist_executions").deleteMany({
        id: { $in: executions.map((item) => item.id) },
      }),
      database.collection("tasks").deleteMany({
        id: { $in: tasks.map((item) => item.id) },
      }),
      database.collection("parking_allocations").deleteMany({
        id: { $in: parking.map((item) => item.id) },
      }),
      database.collection("attachments").deleteMany({
        id: { $in: attachments.map((item) => item.id) },
      }),
      database.collection("tickets").deleteMany({ id: { $in: ticketIds } }),
    ]);
    for (const attachment of attachments)
      await database.deleteBlob(attachment.id);
    console.log("Demo business records removed; demo accounts and non-demo records preserved.");
  }
} finally {
  await closePostgres();
}

// Trim oversized firewall_daily_archives documents down to the retained record
// limit. Days that stopped syncing keep whatever they held when they were last
// written, so lowering FIREWALL_ARCHIVE_MAX_RECORDS only shrinks days that are
// still live; historical days need this one-off pass.
//
// Only the embedded `records` array is trimmed. The stored `summary`,
// escalations and appliance-identity counters are left exactly as written, so
// reported totals never shrink. Full per-record history stays in the
// relational tms_firewall_traffic_records table.
//
// Run scripts/backfill-firewall-traffic-index.mjs FIRST: this refuses to trim a
// day whose records are not already represented in that table.
//
//   node --env-file=.env.local scripts/compact-firewall-archives.mjs          # dry run
//   node --env-file=.env.local scripts/compact-firewall-archives.mjs --apply

import { closePostgres, connectToPostgres } from "../lib/postgres-document-db.js";

const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");
const limitArg = process.argv.find((value) => value.startsWith("--limit="));
const RECORD_LIMIT = Math.max(
  2500,
  Math.min(
    50000,
    Number(
      limitArg?.split("=")[1] ||
        process.env.FIREWALL_ARCHIVE_MAX_RECORDS ||
        50000,
    ) || 50000,
  ),
);

const database = await connectToPostgres();

try {
  const { rows } = await database.pool.query(
    `SELECT document_key,
            data->>'firewall_id' AS firewall_id,
            data->>'date'        AS date,
            jsonb_array_length(data->'records') AS record_count,
            pg_column_size(data) AS byte_size
       FROM tms_documents
      WHERE collection_name = 'firewall_daily_archives'
        AND jsonb_typeof(data->'records') = 'array'
        AND jsonb_array_length(data->'records') > $1
      ORDER BY jsonb_array_length(data->'records') DESC`,
    [RECORD_LIMIT],
  );

  if (!rows.length) {
    console.log(`No archives above ${RECORD_LIMIT} records. Nothing to do.`);
  } else {
    console.log(
      `${rows.length} archive(s) above ${RECORD_LIMIT} records${apply ? "" : " (dry run)"}:\n`,
    );
  }

  let trimmed = 0;
  let skipped = 0;

  for (const row of rows) {
    const { rows: indexed } = await database.pool.query(
      `SELECT count(*)::bigint AS n
         FROM tms_firewall_traffic_records
        WHERE firewall_id = $1 AND archive_date = $2::date`,
      [row.firewall_id, row.date],
    );
    const indexedRows = Number(indexed[0]?.n || 0);
    const embedded = Number(row.record_count);
    const covered = indexedRows >= embedded;
    const mb = (Number(row.byte_size) / 1024 / 1024).toFixed(1);

    if (!covered && !force) {
      console.log(
        `  SKIP  ${row.firewall_id} ${row.date}  ${embedded} records (${mb} MB) — ` +
          `only ${indexedRows} indexed; run the traffic-index backfill first`,
      );
      skipped += 1;
      continue;
    }

    console.log(
      `  TRIM  ${row.firewall_id} ${row.date}  ${embedded} -> ${RECORD_LIMIT} records ` +
        `(${mb} MB, ${indexedRows} indexed)${covered ? "" : " [forced]"}`,
    );

    if (apply) {
      // Records are stored newest-first; keep the newest slice. Trimming in
      // SQL avoids reviving tens of MB of JSON in this process.
      await database.pool.query(
        `UPDATE tms_documents
            SET data = jsonb_set(
                  data,
                  '{records}',
                  (SELECT COALESCE(jsonb_agg(record ORDER BY ordinality), '[]'::jsonb)
                     FROM jsonb_array_elements(data->'records')
                          WITH ORDINALITY AS t(record, ordinality)
                    WHERE ordinality <= $2)
                )
          WHERE document_key = $1
            AND collection_name = 'firewall_daily_archives'`,
        [row.document_key, RECORD_LIMIT],
      );
      trimmed += 1;
    }
  }

  if (rows.length) {
    console.log(
      `\n${apply ? `Trimmed ${trimmed} archive(s).` : "Dry run — pass --apply to trim."}` +
        (skipped ? ` ${skipped} skipped (not fully indexed).` : ""),
    );
    if (apply && trimmed)
      console.log("Run VACUUM FULL tms_documents to reclaim disk if needed.");
  }
} finally {
  await closePostgres();
}

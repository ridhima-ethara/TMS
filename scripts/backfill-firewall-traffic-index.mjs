import { createHash } from "node:crypto";
import { closePostgres, connectToPostgres } from "../lib/postgres-document-db.js";

const database = await connectToPostgres();
const normalizeMac = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "");

function indexedRecord(row) {
  const mac = normalizeMac(row.source_mac);
  const ip = String(row.source_ip || "").trim();
  const observedAt = row.timestamp;
  if ((!mac && !ip) || !observedAt || Number.isNaN(Date.parse(observedAt)))
    return null;
  const fingerprint = [
    row.record_id,
    row.timestamp,
    row.source_ip,
    row.source_mac,
    row.destination_ip,
    row.source_interface,
    row.destination_interface,
    row.application,
    row.action,
    row.sent_bytes,
    row.received_bytes,
    row.message,
  ].join("|");
  return {
    // Must match firewallTrafficRecordKey() in the API route: a non-security
    // de-duplication key, so MD5 is deliberate.
    record_key: createHash("md5").update(fingerprint).digest("hex"), // NOSONAR S4790
    observed_at: observedAt,
    client_key: mac ? `mac:${mac}` : `ip:${ip}`,
    source_ip: ip,
    source_mac: row.source_mac || "",
    source_name: row.source_name || "",
    source_device_type: row.source_device_type || "",
    source_os_name: row.source_os_name || "",
    source_vendor: row.source_vendor || "",
    asset_user_name: row.asset_user_name || "",
    employee_code: row.employee_code || "",
    asset_email: row.asset_email || "",
    av_status: row.av_status || "Unknown",
    inventory_match: Boolean(row.inventory_match),
    sent_bytes: Math.max(0, Math.round(Number(row.sent_bytes || 0))),
    received_bytes: Math.max(0, Math.round(Number(row.received_bytes || 0))),
    appliance_serial: row.appliance_serial || "",
  };
}

function hourlySummaryRows(records) {
  const summaries = new Map();
  for (const row of records) {
    const bucket = new Date(row.observed_at);
    bucket.setUTCMinutes(0, 0, 0);
    const bucketStart = bucket.toISOString();
    const key = `${bucketStart}|${row.client_key}`;
    const item = summaries.get(key) || {
      bucket_start: bucketStart,
      client_key: row.client_key,
      source_ip: "",
      source_mac: "",
      source_name: "",
      source_device_type: "",
      source_os_name: "",
      source_vendor: "",
      asset_user_name: "",
      employee_code: "",
      asset_email: "",
      av_status: "Unknown",
      inventory_match: false,
      traffic_records: 0,
      sent_bytes: 0,
      received_bytes: 0,
      first_activity: row.observed_at,
      last_activity: row.observed_at,
      appliance_serial: "",
    };
    for (const field of [
      "source_ip",
      "source_mac",
      "source_name",
      "source_device_type",
      "source_os_name",
      "source_vendor",
      "asset_user_name",
      "employee_code",
      "asset_email",
      "av_status",
      "appliance_serial",
    ])
      if (row[field]) item[field] = row[field];
    item.inventory_match ||= row.inventory_match;
    item.traffic_records += 1;
    item.sent_bytes += row.sent_bytes;
    item.received_bytes += row.received_bytes;
    if (Date.parse(row.observed_at) < Date.parse(item.first_activity))
      item.first_activity = row.observed_at;
    if (Date.parse(row.observed_at) > Date.parse(item.last_activity))
      item.last_activity = row.observed_at;
    summaries.set(key, item);
  }
  return [...summaries.values()];
}

const insertSql = `INSERT INTO tms_firewall_traffic_records (
  firewall_id, archive_date, record_key, observed_at, client_key,
  source_ip, source_mac, source_name, source_device_type, source_os_name,
  source_vendor, asset_user_name, employee_code, asset_email, av_status,
  inventory_match, sent_bytes, received_bytes, appliance_serial, updated_at
)
SELECT $1, $2::date, entry.record_key, entry.observed_at, entry.client_key,
       entry.source_ip, entry.source_mac, entry.source_name,
       entry.source_device_type, entry.source_os_name, entry.source_vendor,
       entry.asset_user_name, entry.employee_code, entry.asset_email,
       entry.av_status, entry.inventory_match, entry.sent_bytes,
       entry.received_bytes, entry.appliance_serial, now()
  FROM jsonb_to_recordset($3::jsonb) AS entry(
    record_key text, observed_at timestamptz, client_key text, source_ip text,
    source_mac text, source_name text, source_device_type text,
    source_os_name text, source_vendor text, asset_user_name text,
    employee_code text, asset_email text, av_status text,
    inventory_match boolean, sent_bytes bigint, received_bytes bigint,
    appliance_serial text
  )
ON CONFLICT (firewall_id, archive_date, record_key) DO NOTHING`;

const hourlyInsertSql = `INSERT INTO tms_firewall_bandwidth_hourly (
  firewall_id, archive_date, bucket_start, client_key, source_ip, source_mac,
  source_name, source_device_type, source_os_name, source_vendor,
  asset_user_name, employee_code, asset_email, av_status, inventory_match,
  traffic_records, sent_bytes, received_bytes, first_activity, last_activity,
  appliance_serial, updated_at
)
SELECT $1, $2::date, entry.bucket_start, entry.client_key, entry.source_ip,
       entry.source_mac, entry.source_name, entry.source_device_type,
       entry.source_os_name, entry.source_vendor, entry.asset_user_name,
       entry.employee_code, entry.asset_email, entry.av_status,
       entry.inventory_match, entry.traffic_records, entry.sent_bytes,
       entry.received_bytes, entry.first_activity, entry.last_activity,
       entry.appliance_serial, now()
  FROM jsonb_to_recordset($3::jsonb) AS entry(
    bucket_start timestamptz, client_key text, source_ip text, source_mac text,
    source_name text, source_device_type text, source_os_name text,
    source_vendor text, asset_user_name text, employee_code text,
    asset_email text, av_status text, inventory_match boolean,
    traffic_records bigint, sent_bytes bigint, received_bytes bigint,
    first_activity timestamptz, last_activity timestamptz,
    appliance_serial text
  )
ON CONFLICT (firewall_id, archive_date, bucket_start, client_key) DO UPDATE SET
  source_ip = EXCLUDED.source_ip,
  source_mac = EXCLUDED.source_mac,
  source_name = EXCLUDED.source_name,
  source_device_type = EXCLUDED.source_device_type,
  source_os_name = EXCLUDED.source_os_name,
  source_vendor = EXCLUDED.source_vendor,
  asset_user_name = EXCLUDED.asset_user_name,
  employee_code = EXCLUDED.employee_code,
  asset_email = EXCLUDED.asset_email,
  av_status = EXCLUDED.av_status,
  inventory_match = EXCLUDED.inventory_match,
  traffic_records = EXCLUDED.traffic_records,
  sent_bytes = EXCLUDED.sent_bytes,
  received_bytes = EXCLUDED.received_bytes,
  first_activity = EXCLUDED.first_activity,
  last_activity = EXCLUDED.last_activity,
  appliance_serial = EXCLUDED.appliance_serial,
  updated_at = now()`;

try {
  const archives = await database.pool.query(
    `SELECT document_key,
            data->>'firewall_id' AS firewall_id,
            data->>'date' AS archive_date,
            NOT EXISTS (
              SELECT 1
                FROM tms_firewall_traffic_records indexed
               WHERE indexed.firewall_id = archive.data->>'firewall_id'
                 AND indexed.archive_date = (archive.data->>'date')::date
            ) AS needs_traffic,
            NOT EXISTS (
              SELECT 1
                FROM tms_firewall_bandwidth_hourly hourly
               WHERE hourly.firewall_id = archive.data->>'firewall_id'
                 AND hourly.archive_date = (archive.data->>'date')::date
            ) AS needs_hourly
       FROM tms_documents archive
      WHERE collection_name = 'firewall_daily_archives'
        AND (
          NOT EXISTS (
            SELECT 1
              FROM tms_firewall_traffic_records indexed
             WHERE indexed.firewall_id = archive.data->>'firewall_id'
               AND indexed.archive_date = (archive.data->>'date')::date
          )
          OR NOT EXISTS (
            SELECT 1
              FROM tms_firewall_bandwidth_hourly hourly
             WHERE hourly.firewall_id = archive.data->>'firewall_id'
               AND hourly.archive_date = (archive.data->>'date')::date
          )
        )
      ORDER BY data->>'date', data->>'firewall_id'`,
  );

  let total = 0;
  for (const archive of archives.rows) {
    const source = await database.pool.query(
      `SELECT data->'records' AS records
         FROM tms_documents
        WHERE collection_name = 'firewall_daily_archives'
          AND document_key = $1`,
      [archive.document_key],
    );
    const unique = new Map();
    for (const row of source.rows[0]?.records || []) {
      const record = indexedRecord(row);
      if (record) unique.set(record.record_key, record);
    }
    const records = [...unique.values()];
    let inserted = 0;
    if (archive.needs_traffic) {
      const client = await database.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout = '10min'");
        for (let offset = 0; offset < records.length; offset += 10_000) {
          const result = await client.query(insertSql, [
            archive.firewall_id,
            archive.archive_date,
            JSON.stringify(records.slice(offset, offset + 10_000)),
          ]);
          inserted += result.rowCount;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    let hourlyCount = 0;
    if (archive.needs_hourly) {
      const hourly = hourlySummaryRows(records);
      for (let offset = 0; offset < hourly.length; offset += 5000) {
        const result = await database.pool.query(hourlyInsertSql, [
          archive.firewall_id,
          archive.archive_date,
          JSON.stringify(hourly.slice(offset, offset + 5000)),
        ]);
        hourlyCount += result.rowCount;
      }
    }
    total += inserted;
    console.log(
      `${archive.firewall_id.toUpperCase()} ${archive.archive_date}: ${inserted} traffic records, ${hourlyCount} hourly summaries`,
    );
  }
  console.log(`Firewall traffic index ready: ${total} records added`);
} finally {
  await closePostgres();
}

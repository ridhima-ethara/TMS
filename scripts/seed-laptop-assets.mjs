// Loads the bundled laptop inventory (lib/constants/laptop-assets.js) into the
// laptop_assets collection. The API performs the same sync lazily on first
// use; this script just lets operators pre-load or refresh the data:
//   node --env-file=.env.local scripts/seed-laptop-assets.mjs
import { createHash } from "node:crypto";
import { connectToPostgres, closePostgres } from "../lib/postgres-document-db.js";
import { LAPTOP_ASSETS } from "../lib/constants/laptop-assets.js";

const fingerprint = createHash("sha256")
  .update(JSON.stringify(LAPTOP_ASSETS))
  .digest("hex");

const db = await connectToPostgres();
const marker = await db.collection("laptop_asset_sync").findOne({ id: "bundled" });
if (marker?.fingerprint === fingerprint) {
  console.log(`laptop_assets already in sync (${marker.asset_count} assets).`);
} else {
  await db.collection("laptop_assets").deleteMany({ source: "bundled" });
  await db.collection("laptop_assets").insertMany(
    LAPTOP_ASSETS.map((asset) => ({
      id: `laptop_${asset.serial_number}`,
      ...asset,
      source: "bundled",
    })),
  );
  await db.collection("laptop_asset_sync").updateOne(
    { id: "bundled" },
    {
      $set: {
        id: "bundled",
        fingerprint,
        asset_count: LAPTOP_ASSETS.length,
        synced_at: new Date(),
      },
    },
    { upsert: true },
  );
  console.log(`Synced ${LAPTOP_ASSETS.length} laptop assets into laptop_assets.`);
}
const count = await db.collection("laptop_assets").countDocuments({});
console.log(`laptop_assets now holds ${count} documents.`);
await closePostgres();

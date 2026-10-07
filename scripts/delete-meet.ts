/**
 * Hard-delete a TEST meet and everything tied to it: races, taps, imports,
 * raceEntries, results. Real meets are soft-deleted from the UI and keep
 * their log; this is for cleaning test data out of a database.
 *
 *   pnpm db:delete-meet "<meet name>"         # dry run: shows what would go
 *   pnpm db:delete-meet "<meet name>" --yes   # deletes
 *
 * Point it at another database the same way as the other scripts:
 *   MONGODB_URI=… MONGODB_DB=… pnpm db:delete-meet "<meet name>" --yes
 */
import { getClient, getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";

async function main() {
  const [name, confirm] = process.argv.slice(2).filter((a) => a !== "--");
  if (!name) throw new Error('Usage: pnpm db:delete-meet "<meet name>" [--yes]');
  const db = await getDb();
  // Includes meets already soft-deleted from the UI, so their leftovers can be cleaned up too.
  const meets = await collection(db, "meets").find({ name }).toArray();
  if (meets.length === 0) throw new Error(`No meet named "${name}"`);
  if (meets.length > 1) throw new Error(`${meets.length} meets are named "${name}"; rename one first.`);
  const meet = meets[0];
  const meetId = meet._id;

  const races = await collection(db, "races").find({ meetId }).toArray();
  const raceIds = races.map((r) => r._id);
  const counts = {
    races: races.length,
    taps: await collection(db, "taps").countDocuments({ meetId }),
    imports: await collection(db, "imports").countDocuments({ meetId }),
    raceEntries: await collection(db, "raceEntries").countDocuments({ raceId: { $in: raceIds } }),
    results: await collection(db, "results").countDocuments({ raceId: { $in: raceIds } }),
  };
  console.log(`${meet.name} (${meet.date}${meet.deletedAt ? ", already hidden" : ""}) in ${db.databaseName}:`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  if (confirm !== "--yes") {
    console.log("Dry run. Add --yes to delete the meet and all of the above.");
    return;
  }
  await collection(db, "results").deleteMany({ raceId: { $in: raceIds } });
  await collection(db, "raceEntries").deleteMany({ raceId: { $in: raceIds } });
  await collection(db, "imports").deleteMany({ meetId });
  await collection(db, "taps").deleteMany({ meetId });
  await collection(db, "races").deleteMany({ meetId });
  await collection(db, "meets").deleteOne({ _id: meetId });
  console.log("Deleted.");
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

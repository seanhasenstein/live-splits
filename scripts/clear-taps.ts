/**
 * Wipe the tap log and gun times for one meet (test data before the real
 * thing). Hard-deletes taps, which is otherwise never done.
 *
 *   pnpm db:clear-taps "<meet name>" --yes
 */
import { getClient, getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";

async function main() {
  const [name, confirm] = process.argv.slice(2).filter((a) => a !== "--");
  if (!name) throw new Error('Usage: pnpm db:clear-taps "<meet name>" --yes');
  const db = await getDb();
  const meet = await collection(db, "meets").findOne({ name, deletedAt: null });
  if (!meet) throw new Error(`No meet named "${name}"`);
  const races = await collection(db, "races").find({ meetId: meet._id }).toArray();
  const raceIds = races.map((r) => r._id);
  const count = await collection(db, "taps").countDocuments({ raceId: { $in: raceIds } });
  console.log(`${meet.name} (${meet.date}): ${races.length} races, ${count} taps`);
  if (confirm !== "--yes") {
    console.log("Dry run. Add --yes to delete.");
    return;
  }
  await collection(db, "taps").deleteMany({ raceId: { $in: raceIds } });
  await collection(db, "races").updateMany({ _id: { $in: raceIds } }, { $set: { gunTimeMs: null, gunTimeSource: null } });
  console.log("Deleted taps and cleared gun times.");
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

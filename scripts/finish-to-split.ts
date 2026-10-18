/**
 * Undo a finish that was really a first split: an imported split sheet row with only a Mile 1
 * ("Ajani Laster  7:28") used to be read as a 7:28 finish, which then stood as a PR. This turns that
 * result into a DNF that keeps the time as the race's first split, the way the importer reads such a
 * row now. One athlete, one meet date, one result; anything ambiguous stops without writing.
 *
 *   pnpm db:finish-to-split "<athlete name>" <YYYY-MM-DD>         # dry run: shows the change
 *   pnpm db:finish-to-split "<athlete name>" <YYYY-MM-DD> --yes   # writes it
 *
 * Point it at another database the same way as the other scripts:
 *   MONGODB_URI=… MONGODB_DB=… pnpm db:finish-to-split "<athlete name>" <YYYY-MM-DD> --yes
 */
import { getClient, getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { formatElapsed } from "@/lib/time";

async function main() {
  const [name, date, confirm] = process.argv.slice(2).filter((a) => a !== "--");
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error('Usage: pnpm db:finish-to-split "<athlete name>" <YYYY-MM-DD> [--yes]');
  const db = await getDb();

  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const athletes = await collection(db, "athletes").find({ displayName: { $regex: `^${escaped}$`, $options: "i" }, deletedAt: null }).toArray();
  if (athletes.length !== 1) throw new Error(`${athletes.length} athletes are named "${name}"; expected exactly one.`);
  const athlete = athletes[0];

  const meets = await collection(db, "meets").find({ schoolId: athlete.schoolId, date, deletedAt: null }).toArray();
  if (meets.length === 0) throw new Error(`No meet on ${date}.`);
  const races = await collection(db, "races").find({ meetId: { $in: meets.map((m) => m._id) }, deletedAt: null }).toArray();
  const results = await collection(db, "results").find({ athleteId: athlete._id, raceId: { $in: races.map((r) => r._id) }, status: "finished", deletedAt: null }).toArray();
  if (results.length !== 1) throw new Error(`${results.length} finished results for ${athlete.displayName} on ${date}; expected exactly one.`);
  const result = results[0];
  const race = races.find((r) => r._id === result.raceId)!;
  const meet = meets.find((m) => m._id === race.meetId)!;
  const first = race.checkpoints.find((c) => c.kind === "split");
  if (!first) throw new Error(`${race.name} has no split checkpoint to keep the time at.`);
  if (!result.mark || result.mark.type !== "time") throw new Error("That result has no finish time.");
  const ms = result.mark.value;
  const entry = await collection(db, "raceEntries").findOne({ raceId: race._id, athleteId: athlete._id, deletedAt: null });

  console.log(`${db.databaseName}: ${athlete.displayName}, ${meet.name} (${meet.date}), ${race.name}`);
  console.log(`  now:   finished in ${formatElapsed(ms, "seconds")}, place ${result.place ?? "none"}`);
  console.log(`  after: DNF, ${first.label} ${formatElapsed(ms, "seconds")}, no finish, no place`);
  console.log(`  race entry: ${entry ? "found, changed the same way" : "none"}`);
  if (confirm !== "--yes") {
    console.log("Dry run. Add --yes to make the change.");
    return;
  }

  const now = new Date();
  const updatedBy = { type: "system" as const, id: null, name: "db:finish-to-split" };
  await collection(db, "results").updateOne(
    { _id: result._id },
    {
      $set: {
        mark: null,
        status: "dnf",
        place: null,
        splits: [{ checkpointId: first.id, cumulativeMs: ms, source: "mat", edited: false, estimate: false }],
        updatedAt: now,
        updatedBy,
      },
    },
  );
  if (entry) {
    await collection(db, "raceEntries").updateOne(
      { _id: entry._id },
      { $set: { status: "dnf", timeMs: null, precision: null, place: null, splits: [{ label: first.label, checkpointId: first.id, cumulativeMs: ms }], updatedAt: now, updatedBy } },
    );
  }
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

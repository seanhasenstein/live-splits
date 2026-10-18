/**
 * Move one athlete's result to another race of the same meet: an imported split sheet that never said a
 * DNF runner's level put them in varsity when they ran JV. The result (finish or DNF, splits, place
 * cleared), their race entry and their lineup spot all move, so the race they ran shows them with their
 * times and the other no longer does. Unchecking and re-checking lineups moves only the listing, not the
 * result. The two races must be the same distance with the same checkpoints.
 *
 *   pnpm db:move-result "<athlete name>" <YYYY-MM-DD> "<to race name>"         # dry run: shows the move
 *   pnpm db:move-result "<athlete name>" <YYYY-MM-DD> "<to race name>" --yes   # makes it
 *
 * Point it at another database the same way as the other scripts:
 *   MONGODB_URI=… MONGODB_DB=… pnpm db:move-result "<athlete name>" <YYYY-MM-DD> "<to race name>" --yes
 */
import { getClient, getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";

async function main() {
  const [name, date, toName, confirm] = process.argv.slice(2).filter((a) => a !== "--");
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !toName) throw new Error('Usage: pnpm db:move-result "<athlete name>" <YYYY-MM-DD> "<to race name>" [--yes]');
  const db = await getDb();
  const exact = (s: string) => ({ $regex: `^${s.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" });

  const athletes = await collection(db, "athletes").find({ displayName: exact(name), deletedAt: null }).toArray();
  if (athletes.length !== 1) throw new Error(`${athletes.length} athletes are named "${name}"; expected exactly one.`);
  const athlete = athletes[0];

  const meets = await collection(db, "meets").find({ schoolId: athlete.schoolId, date, deletedAt: null }).toArray();
  if (meets.length !== 1) throw new Error(`${meets.length} meets on ${date}; expected exactly one.`);
  const meet = meets[0];
  const races = await collection(db, "races").find({ meetId: meet._id, deletedAt: null }).toArray();

  const results = await collection(db, "results").find({ athleteId: athlete._id, raceId: { $in: races.map((r) => r._id) }, deletedAt: null }).toArray();
  if (results.length !== 1) throw new Error(`${results.length} results for ${athlete.displayName} at ${meet.name}; expected exactly one.`);
  const result = results[0];
  const from = races.find((r) => r._id === result.raceId)!;
  const targets = races.filter((r) => r.name.trim().toLowerCase() === toName.trim().toLowerCase());
  if (targets.length !== 1) throw new Error(`${targets.length} races named "${toName}" at ${meet.name}; races there: ${races.map((r) => r.name).join(", ")}.`);
  const to = targets[0];
  if (to._id === from._id) throw new Error(`${athlete.displayName} is already in ${to.name}.`);
  if (to.distanceId !== from.distanceId) throw new Error(`${from.name} and ${to.name} are different distances.`);
  const toIds = new Set(to.checkpoints.map((c) => c.id));
  const missing = result.splits.filter((s) => !toIds.has(s.checkpointId));
  if (missing.length > 0) throw new Error(`${to.name} lacks checkpoints this result uses (${missing.map((s) => s.checkpointId).join(", ")}).`);
  const levelId = to.levelIds[0];
  if (!levelId) throw new Error(`${to.name} has no level.`);
  const entry = await collection(db, "raceEntries").findOne({ raceId: from._id, athleteId: athlete._id, deletedAt: null });

  console.log(`${db.databaseName}: ${athlete.displayName}, ${meet.name} (${meet.date})`);
  console.log(`  result: ${result.status}${result.place ? `, place ${result.place}` : ""} in ${from.name}`);
  console.log(`  move to: ${to.name} (level ${levelId}), place cleared; race entry ${entry ? "moves too" : "none"}; lineups updated`);
  if (confirm !== "--yes") {
    console.log("Dry run. Add --yes to move it.");
    return;
  }

  const now = new Date();
  const updatedBy = { type: "system" as const, id: null, name: "db:move-result" };
  // The place belonged to the other race's order; the right one comes from that race's results if re-imported.
  await collection(db, "results").updateOne({ _id: result._id }, { $set: { raceId: to._id, levelId, place: null, levelPlace: null, updatedAt: now, updatedBy } });
  if (entry) await collection(db, "raceEntries").updateOne({ _id: entry._id }, { $set: { raceId: to._id, place: null, updatedAt: now, updatedBy } });
  await collection(db, "races").updateOne({ _id: from._id }, { $set: { lineup: from.lineup.filter((l) => l.athleteId !== athlete._id), updatedAt: now, updatedBy } });
  if (!to.lineup.some((l) => l.athleteId === athlete._id)) {
    await collection(db, "races").updateOne({ _id: to._id }, { $set: { lineup: [...to.lineup, { athleteId: athlete._id, levelId }], updatedAt: now, updatedBy } });
  }
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

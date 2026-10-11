/**
 * Backfill fields added after a database was seeded. Safe to run repeatedly.
 *   pnpm db:migrate            (uses .env.local)
 *   MONGODB_URI=… MONGODB_DB=… pnpm db:migrate
 */
import { getClient, getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";

async function main() {
  const db = await getDb();
  const r1 = await collection(db, "races").updateMany({ finishedAt: { $exists: false } }, { $set: { finishedAt: null } });
  const r2 = await collection(db, "races").updateMany({ officialImportId: { $exists: false } }, { $set: { officialImportId: null } });
  const r4 = await collection(db, "races").updateMany({ liveFeed: { $exists: false } }, { $set: { liveFeed: null } });
  const r5 = await collection(db, "meets").updateMany({ resultsUrl: { $exists: false } }, { $set: { resultsUrl: null } });
  const r6 = await collection(db, "schools").updateMany({ viewerLink: { $exists: false } }, { $set: { viewerLink: null } });
  // A "Mixed" race category (gender null = whole roster offered) for meets that run boys and girls together.
  const r7 = await collection(db, "programs").updateMany(
    { sport: "xc", "settings.raceCategories.id": { $ne: "mixed" } },
    { $push: { "settings.raceCategories": { id: "mixed", label: "Mixed", gender: null } } },
  );
  // Races imported before imports stopped the clock: finished at the last official finish (gun known), else the import time.
  let r8 = 0;
  for (const race of await collection(db, "races").find({ officialImportId: { $ne: null }, finishedAt: null }).toArray()) {
    const results = await collection(db, "results").find({ raceId: race._id, deletedAt: null }).toArray();
    const last = Math.max(0, ...results.map((r) => (r.mark?.type === "time" ? r.mark.value : 0)));
    const finishedAt = race.gunTimeMs !== null && last > 0 ? new Date(race.gunTimeMs + last) : race.updatedAt;
    await collection(db, "races").updateOne({ _id: race._id }, { $set: { finishedAt } });
    r8 += 1;
  }
  const r3 = await collection(db, "schools").updateMany(
    { "settings.teamAliases": { $exists: false } },
    { $set: { "settings.teamAliases": ["Sheboygan Lutheran", "Sheboygan Area Lutheran", "Sheboygan Area Lutheran HS"] } },
  );
  // The team shows whole seconds (its long-standing convention); programs seeded before the setting existed get it.
  const r9 = await collection(db, "programs").updateMany({ "settings.timePrecision": { $exists: false } }, { $set: { "settings.timePrecision": "seconds" } });
  // Results imported before precision was recorded were all stamped "tenths". A race whose official
  // times are every one a whole second came from a sheet in seconds; mark it so.
  let r10 = 0;
  for (const race of await collection(db, "races").find({ officialImportId: { $ne: null } }).toArray()) {
    const results = await collection(db, "results").find({ raceId: race._id, deletedAt: null, "mark.type": "time" }).toArray();
    const entries = await collection(db, "raceEntries").find({ raceId: race._id, deletedAt: null, timeMs: { $ne: null } }).toArray();
    const values = [...results.map((r) => (r.mark?.type === "time" ? r.mark.value : 0)), ...entries.map((e) => e.timeMs ?? 0)];
    if (values.length === 0 || values.some((v) => v % 1000 !== 0)) continue;
    await collection(db, "results").updateMany({ raceId: race._id, deletedAt: null, "mark.type": "time" }, { $set: { "mark.precision": "seconds" } });
    await collection(db, "raceEntries").updateMany({ raceId: race._id, deletedAt: null, timeMs: { $ne: null } }, { $set: { precision: "seconds" } });
    r10 += 1;
  }
  console.log(`programs.timePrecision: ${r9.modifiedCount}, races.officialSeconds: ${r10}`);
  console.log(`races.finishedAt: ${r1.modifiedCount}, races.officialImportId: ${r2.modifiedCount}, races.liveFeed: ${r4.modifiedCount}, meets.resultsUrl: ${r5.modifiedCount}, schools.viewerLink: ${r6.modifiedCount}, programs.mixedCategory: ${r7.modifiedCount}, races.finishedByImport: ${r8}, schools.teamAliases: ${r3.modifiedCount}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

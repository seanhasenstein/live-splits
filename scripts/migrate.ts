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
  // Races imported before imports stopped the clock: mark them finished at the import time.
  const r8 = await collection(db, "races").updateMany({ officialImportId: { $ne: null }, finishedAt: null }, [{ $set: { finishedAt: "$updatedAt" } }]);
  const r3 = await collection(db, "schools").updateMany(
    { "settings.teamAliases": { $exists: false } },
    { $set: { "settings.teamAliases": ["Sheboygan Lutheran", "Sheboygan Area Lutheran", "Sheboygan Area Lutheran HS"] } },
  );
  console.log(`races.finishedAt: ${r1.modifiedCount}, races.officialImportId: ${r2.modifiedCount}, races.liveFeed: ${r4.modifiedCount}, meets.resultsUrl: ${r5.modifiedCount}, schools.viewerLink: ${r6.modifiedCount}, programs.mixedCategory: ${r7.modifiedCount}, races.finishedByImport: ${r8.modifiedCount}, schools.teamAliases: ${r3.modifiedCount}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

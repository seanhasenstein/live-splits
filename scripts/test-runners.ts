/**
 * Test runners for trying a live feed at a meet our team isn't in: adds a few runners from an
 * AthleticLIVE (Trackside) race to our roster for the current season, named exactly as the timing
 * company has them so the feed matches them, then removes them (and everything tied to them) after.
 *
 *   pnpm db:test-runners add <race link> --boys            # dry run: who would be added
 *   pnpm db:test-runners add <race link> --boys --yes      # adds 4, spread from the front to the back
 *   pnpm db:test-runners add <race link> --girls --count 6 --yes
 *   pnpm db:test-runners add <race link> --girls --names "Jane Doe, Ann Lee" --yes
 *   pnpm db:test-runners remove                            # dry run: what would be removed
 *   pnpm db:test-runners remove --yes
 *
 * The race link is the race's own page, e.g. https://results.tracksidetiming.com/meets/79523/events/xc/2934056.
 * Then put them in the test race's lineup (meet page → the race → Edit). Only what this script added
 * is ever removed (it marks them as created by db:test-runners).
 *
 * It writes to MONGODB_URI / MONGODB_DB: for the dev site, point those at the dev database, e.g.
 *   MONGODB_URI=… MONGODB_DB=… pnpm db:test-runners add <link> --boys --yes
 */
import { getClient, getDb, newId } from "@/lib/db/client";
import { COLLECTIONS, collection } from "@/lib/db/collections";
import { parseAthleticLiveJson } from "@/lib/results/parse";

const MARK = "db:test-runners";
const DOCS = "https://athleticlive.blob.core.windows.net/$web/ind_res_list/_doc/";

function flag(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const yes = args.includes("--yes");
  const db = await getDb();
  const school = await collection(db, "schools").findOne({ deletedAt: null });
  if (!school) throw new Error("No school in this database");
  console.log(`Database: ${db.databaseName} · ${school.name}${yes ? "" : " · dry run (add --yes to write)"}`);
  const actor = { type: "system" as const, id: null, name: MARK };

  if (cmd === "remove") {
    const athletes = await collection(db, "athletes").find({ schoolId: school._id, "createdBy.name": MARK }).toArray();
    const ids = athletes.map((a) => a._id);
    console.log(athletes.length ? `Test runners: ${athletes.map((a) => a.displayName).join(", ")}` : "No test runners to remove.");
    if (!yes || ids.length === 0) return;
    const lineups = await collection(db, "races").updateMany({ schoolId: school._id, "lineup.athleteId": { $in: ids } }, { $pull: { lineup: { athleteId: { $in: ids } } } });
    const results = await collection(db, "results").deleteMany({ schoolId: school._id, athleteId: { $in: ids } });
    const rosters = await collection(db, "seasonRosters").deleteMany({ schoolId: school._id, athleteId: { $in: ids } });
    // Imported entries that matched them become other schools' runners again.
    const entries = await collection(db, "raceEntries").updateMany({ schoolId: school._id, athleteId: { $in: ids } }, { $set: { athleteId: null } });
    const gone = await collection(db, "athletes").deleteMany({ _id: { $in: ids } });
    console.log(`Removed ${gone.deletedCount} athletes, ${rosters.deletedCount} roster rows, ${results.deletedCount} results; took them out of ${lineups.modifiedCount} lineups and ${entries.modifiedCount} imported entries.`);
    return;
  }

  if (cmd !== "add") throw new Error("Usage: pnpm db:test-runners add <race link> --boys|--girls [--count N | --names \"A, B\"] [--yes] · pnpm db:test-runners remove [--yes]");
  const link = args.find((a) => /^https:\/\//.test(a));
  const raceId = link?.match(/\/meets\/\d+\/events\/[a-z]+\/(\d{1,12})\/?$/i)?.[1];
  if (!link || !raceId) throw new Error("Give the race's own page link: …/meets/<meet>/events/xc/<race>");
  const gender = args.includes("--girls") ? "F" : args.includes("--boys") ? "M" : null;
  if (!gender) throw new Error("Say --boys or --girls (the feed doesn't say)");

  const res = await fetch(DOCS + raceId);
  if (!res.ok) throw new Error(`AthleticLIVE answered ${res.status} for race ${raceId}: is the race posted yet?`);
  const contest = parseAthleticLiveJson(await res.json(), link, { live: true });
  const runners = contest.entries.filter((e) => e.name && e.team);
  if (runners.length === 0) throw new Error(`"${contest.name}" has no runners listed yet. Try again once the race page shows names.`);

  const existing = await collection(db, "athletes").find({ schoolId: school._id, deletedAt: null }, { projection: { displayName: 1, officialName: 1, aliases: 1 } }).toArray();
  const taken = new Set(existing.flatMap((a) => [a.displayName, a.officialName, ...a.aliases].map((n) => n.toLowerCase())));
  // Other schools' runners only: one of ours is already matched.
  const others = runners.filter((e) => !taken.has(e.name.toLowerCase()));
  let picked: typeof runners;
  const names = flag(args, "--names");
  if (names) {
    const want = names.split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
    picked = runners.filter((e) => want.includes(e.name.toLowerCase()));
    const missing = want.filter((w) => !picked.some((e) => e.name.toLowerCase() === w));
    if (missing.length) throw new Error(`Not in this race: ${missing.join(", ")}`);
  } else {
    // Spread through the field (by place once there are places, else as listed): front, middle, back.
    const count = Math.max(1, Math.min(Number(flag(args, "--count") ?? 4) || 4, others.length));
    const order = [...others].sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity));
    picked = [...new Set(Array.from({ length: count }, (_, i) => Math.round((i * (order.length - 1)) / Math.max(1, count - 1))))].map((i) => order[i]);
  }

  const program = await collection(db, "programs").findOne({ schoolId: school._id, sport: "xc", deletedAt: null });
  if (!program) throw new Error("No XC program");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: school.settings.timeZone }).format(new Date());
  const season = await collection(db, "seasons").findOne({ programId: program._id, startDate: { $lte: today }, endDate: { $gte: today }, deletedAt: null });
  if (!season) throw new Error(`No season covers ${today}`);
  const [endYear, endMonth] = season.endDate.split("-").map(Number);
  const schoolYearEnd = endMonth >= 8 ? endYear + 1 : endYear;
  const varsity = program.settings.levels.find((l) => l.id === "varsity")?.id ?? program.settings.levels[0].id;

  console.log(`${contest.name} (${runners.length} runners listed). Adding to the ${season.label} roster:`);
  const now = new Date();
  const audit = { source: "manual" as const, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor, deletedAt: null };
  for (const e of picked) {
    if (taken.has(e.name.toLowerCase())) {
      console.log(`  skip ${e.name} (already an athlete with that name)`);
      continue;
    }
    const graduationYear = e.grade !== null && e.grade >= 6 && e.grade <= 12 ? schoolYearEnd + 12 - e.grade : null;
    console.log(`  ${e.name}${e.grade ? `, grade ${e.grade}` : ""} · ${e.team}${e.place ? ` · placed ${e.place}` : ""}`);
    if (!yes) continue;
    const athlete = COLLECTIONS.athletes.schema.parse({ _id: newId(), schoolId: school._id, schemaVersion: COLLECTIONS.athletes.version, displayName: e.name, officialName: e.name, aliases: [], gender, graduationYear, birthYear: null, athleticNetId: null, ...audit });
    await collection(db, "athletes").insertOne(athlete);
    await collection(db, "seasonRosters").insertOne(COLLECTIONS.seasonRosters.schema.parse({ _id: newId(), schoolId: school._id, schemaVersion: COLLECTIONS.seasonRosters.version, seasonId: season._id, athleteId: athlete._id, defaultLevelId: varsity, ...audit }));
  }
  console.log(yes ? "Added. Put them in the test race's lineup, and run `pnpm db:test-runners remove --yes` afterwards." : "Dry run: add --yes to add them.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

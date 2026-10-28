/**
 * Loads an all-time list from the coach's records (a CSV), replacing what's stored for that list.
 * Today the one list is the State meet's: every performance our runners ran there.
 *
 *   pnpm db:all-time load state official-results/state_meet_history_2000-2025.csv          # dry run
 *   pnpm db:all-time load state official-results/state_meet_history_2000-2025.csv --yes    # saves
 *
 * Columns: gender (M/F), distance (5K/4K), year, name, grade, time (as printed), place, notes.
 * Keep the file out of git (official-results/ is ignored): it lists real students. Years the app has
 * results for (a State meet with the short name "State") come from the app, so the CSV only needs
 * the years before. Point it at another database the same way as the other scripts.
 */
import { readFileSync } from "node:fs";
import { getClient, getDb, newId } from "@/lib/db/client";
import { COLLECTIONS, collection } from "@/lib/db/collections";
import { normalizeName } from "@/lib/results/match";
import { parseElapsed } from "@/lib/time";

/** A CSV line's cells (quoted cells may hold commas). */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

async function main() {
  const [cmd, list, file, ...flags] = process.argv.slice(2);
  if (cmd !== "load" || list !== "state" || !file) throw new Error("Usage: pnpm db:all-time load state <file.csv> [--yes]");
  const yes = flags.includes("--yes");
  const [head, ...lines] = readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const cols = cells(head).map((c) => c.toLowerCase());
  const col = (name: string) => {
    const i = cols.indexOf(name);
    if (i < 0) throw new Error(`The CSV needs a "${name}" column`);
    return i;
  };
  const [g, d, y, n, gr, t, p, no] = ["gender", "distance", "year", "name", "grade", "time", "place", "notes"].map((c) => (c === "notes" ? cols.indexOf(c) : col(c)));

  const db = await getDb();
  const school = await collection(db, "schools").findOne({ deletedAt: null });
  if (!school) throw new Error("No school in this database");
  const athletes = await collection(db, "athletes").find({ schoolId: school._id, deletedAt: null }, { projection: { displayName: 1, officialName: 1, aliases: 1, gender: 1 } }).toArray();
  const byName = new Map<string, string>();
  for (const a of athletes) for (const nm of [a.displayName, a.officialName, ...a.aliases]) byName.set(`${a.gender}|${normalizeName(nm)}`, a._id);

  const now = new Date();
  const actor = { type: "system" as const, id: null, name: "db:all-time" };
  const problems: string[] = [];
  const docs = lines.flatMap((line, i) => {
    const r = cells(line);
    const gender = r[g].toUpperCase();
    const meters = Math.round(Number(r[d].toUpperCase().replace(/K$/, "")) * 1000);
    const timeMs = parseElapsed(r[t]);
    const year = Number(r[y]);
    if ((gender !== "M" && gender !== "F") || !meters || !timeMs || !Number.isInteger(year)) {
      problems.push(`line ${i + 2}: ${line}`);
      return [];
    }
    const grade = Number(r[gr]);
    const place = Number(r[p]);
    return [
      COLLECTIONS.allTimeEntries.schema.parse({
        _id: newId(),
        schoolId: school._id,
        schemaVersion: COLLECTIONS.allTimeEntries.version,
        list,
        gender,
        distanceMeters: meters,
        year,
        name: r[n],
        grade: Number.isInteger(grade) && grade > 0 ? grade : null,
        timeText: r[t],
        timeMs,
        place: Number.isInteger(place) && place > 0 ? place : null,
        notes: no >= 0 && r[no] ? r[no] : null,
        athleteId: byName.get(`${gender}|${normalizeName(r[n])}`) ?? null,
        source: "manual",
        createdAt: now,
        createdBy: actor,
        updatedAt: now,
        updatedBy: actor,
        deletedAt: null,
      }),
    ];
  });

  const groups = new Map<string, number>();
  for (const e of docs) groups.set(`${e.gender === "M" ? "Boys" : "Girls"} ${e.distanceMeters / 1000}K`, (groups.get(`${e.gender === "M" ? "Boys" : "Girls"} ${e.distanceMeters / 1000}K`) ?? 0) + 1);
  console.log(`${db.databaseName} · ${school.name}${yes ? "" : " · dry run (add --yes to save)"}`);
  for (const [k, v] of groups) console.log(`  ${k}: ${v} performances`);
  console.log(`  ${docs.filter((e) => e.athleteId).length} linked to athletes in the app; years ${Math.min(...docs.map((e) => e.year))}–${Math.max(...docs.map((e) => e.year))}`);
  if (problems.length) {
    console.log(`Skipped ${problems.length} line(s) it couldn't read:`);
    for (const pr of problems) console.log(`  ${pr}`);
  }
  if (!yes) return;
  await collection(db, "allTimeEntries").deleteMany({ schoolId: school._id, list });
  if (docs.length) await collection(db, "allTimeEntries").insertMany(docs);
  console.log(`Saved ${docs.length}, replacing the list that was there.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

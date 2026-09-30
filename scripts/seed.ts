/**
 * Seed: school, XC program, 2026 season, distances, roster (data/roster.csv).
 * Idempotent: documents are matched on a natural key and replaced, keeping
 * their _id and createdAt. Run with `pnpm db:seed`.
 *
 * This is a bootstrap. Re-running it overwrites the seeded documents' fields,
 * so once coaches edit athletes in the app, stop using it for the roster.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Db, Filter } from "mongodb";
import { getClient, getDb, newId } from "@/lib/db/client";
import { COLLECTIONS, type CollectionName, type DocOf } from "@/lib/db/collections";
import { ensureIndexes } from "@/lib/db/indexes";
import type { Actor, DistanceUnit } from "@/lib/db/schema";
import { distanceId, distanceLabel, toMeters } from "@/lib/distance";
import { gradeForSeason } from "@/lib/grade";

const SEED: Actor = { type: "system", id: null, name: "seed" };

type AnyDoc = { _id: string; createdAt: Date; createdBy: Actor };

async function upsert<N extends CollectionName>(
  db: Db,
  name: N,
  filter: Filter<AnyDoc>,
  fields: (id: string) => Record<string, unknown>,
): Promise<DocOf<N>> {
  const col = db.collection<AnyDoc>(name);
  const existing = await col.findOne(filter);
  const id = existing?._id ?? newId();
  const now = new Date();
  const doc = COLLECTIONS[name].schema.parse({
    _id: id,
    schemaVersion: COLLECTIONS[name].version,
    source: "manual",
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? SEED,
    updatedAt: now,
    updatedBy: SEED,
    deletedAt: null,
    ...fields(id),
  }) as DocOf<N>;
  // doc._id, not id: distances supply their own readable _id.
  await col.replaceOne({ _id: doc._id }, doc as AnyDoc, { upsert: true });
  return doc;
}

// ---------------------------------------------------------------- roster CSV

type RosterRow = {
  display_name: string;
  official_name: string;
  gender: string;
  graduation_year: string;
  grade_2026: string;
  default_level: string;
  aliases: string;
  athletic_net_id: string;
};

/** Minimal CSV reader: comma-separated, optional double-quoted fields. */
function parseCsv(text: string): Record<string, string>[] {
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const cells: string[] = [];
      let cell = "";
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') {
            cell += '"';
            i++;
          } else if (ch === '"') quoted = false;
          else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ",") {
          cells.push(cell.trim());
          cell = "";
        } else cell += ch;
      }
      cells.push(cell.trim());
      return cells;
    });
  const [header, ...body] = rows;
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
}

// ---------------------------------------------------------------- seed data

const XC_DISTANCES: [number, DistanceUnit][] = [
  [5, "km"],
  [3, "mi"],
  [6, "km"],
  [8, "km"],
  [10, "km"],
  [4, "km"],
  [2, "mi"],
  [1.5, "mi"],
];

async function main() {
  const db = await getDb();
  await ensureIndexes(db);

  const school = await upsert(db, "schools", { name: "Sheboygan Lutheran High School" }, (id) => ({
    schoolId: id,
    name: "Sheboygan Lutheran High School",
    shortName: "Sheboygan Lutheran",
    mascot: "Crusaders",
    state: "WI",
    settings: { timeZone: "America/Chicago" },
  }));
  const schoolId = school._id;

  const program = await upsert(db, "programs", { schoolId, sport: "xc" }, () => ({
    schoolId,
    sport: "xc",
    name: "Cross Country",
    settings: {
      recordsStartGrade: 9,
      defaultListLength: 30,
      displayUnit: "mi",
      classYearSystem: "hs_grade",
      levels: [
        { id: "varsity", label: "Varsity", abbreviation: "V" },
        { id: "jv", label: "JV", abbreviation: "JV" },
      ],
      raceCategories: [
        { id: "girls", label: "Girls", gender: "F" },
        { id: "boys", label: "Boys", gender: "M" },
      ],
      coachRoles: [
        { id: "head_coach", label: "Head Coach" },
        { id: "assistant_coach", label: "Assistant Coach" },
        { id: "manager", label: "Manager" },
      ],
      historyCompleteFromYear: null,
    },
  }));

  const season = await upsert(db, "seasons", { programId: program._id, label: "2026" }, () => ({
    schoolId,
    programId: program._id,
    label: "2026",
    startDate: "2026-08-17",
    endDate: "2026-10-31",
    badgeRules: [],
  }));

  for (const [value, unit] of XC_DISTANCES) {
    const id = distanceId("xc", value, unit);
    await upsert(db, "distances", { _id: id }, () => ({
      _id: id,
      schoolId: null,
      sport: "xc",
      value,
      unit,
      meters: toMeters(value, unit),
      label: distanceLabel(value, unit),
    }));
  }

  const csv = readFileSync(path.join(process.cwd(), "data/roster.csv"), "utf8");
  const rows = parseCsv(csv) as RosterRow[];
  const levelIdByLabel = new Map(
    program.settings.levels.map((l) => [l.label.toLowerCase(), l.id]),
  );

  for (const row of rows) {
    const graduationYear = row.graduation_year ? Number(row.graduation_year) : null;
    if (graduationYear !== null && row.grade_2026) {
      const grade = gradeForSeason(graduationYear, season.endDate);
      if (grade !== Number(row.grade_2026)) {
        throw new Error(
          `${row.display_name}: grade_2026 is ${row.grade_2026} but graduation year ${graduationYear} gives grade ${grade}`,
        );
      }
    }
    const defaultLevelId = levelIdByLabel.get(row.default_level.toLowerCase());
    if (!defaultLevelId) {
      throw new Error(`${row.display_name}: unknown default_level "${row.default_level}"`);
    }

    const athlete = await upsert(
      db,
      "athletes",
      { schoolId, officialName: row.official_name },
      () => ({
        schoolId,
        displayName: row.display_name,
        officialName: row.official_name,
        aliases: row.aliases
          .split(/[;|]/)
          .map((a) => a.trim())
          .filter(Boolean),
        gender: row.gender,
        graduationYear,
        birthYear: null,
        athleticNetId: row.athletic_net_id || null,
      }),
    );

    await upsert(
      db,
      "seasonRosters",
      { seasonId: season._id, athleteId: athlete._id },
      () => ({ schoolId, seasonId: season._id, athleteId: athlete._id, defaultLevelId }),
    );
  }

  // Read everything back through the schemas as a final check.
  for (const name of Object.keys(COLLECTIONS) as CollectionName[]) {
    const docs = await db.collection(name).find().toArray();
    for (const doc of docs) COLLECTIONS[name].schema.parse(doc);
    if (docs.length > 0) console.log(`${name}: ${docs.length} valid`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

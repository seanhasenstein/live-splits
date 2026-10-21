import "server-only";
import type { ClientSession, Db } from "mongodb";
import { getClient, getDb, newId } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import type { Actor, Athlete, Program, Race, School, Split } from "@/lib/db/schema";
import { distanceValue } from "@/lib/distance";
import { gradeForSeason } from "@/lib/grade";
import { resolvePlace } from "@/lib/places";
import { editDistance, matchAthlete, normalizeName } from "./match";
import { type HistoryMeet, type HistoryRow, sheetSummaryFor } from "./splits-history";

/**
 * Past seasons from the team's split sheets: meets, races, results and the
 * athletes who ran them, written as if the app had been there. The coach
 * reviews first (which meets, which venue, who the unknown names are) and
 * everything then lands in one transaction.
 */

export type HistoryAthleteReview = {
  name: string;
  gender: "M" | "F";
  /** Matched to an athlete already in the app (current or alumni). */
  athleteId: string | null;
  /** Season years this name appears in, in the file. */
  seasons: number[];
  /** Four seasons means a senior in the last one; fewer leaves it to the coach. */
  graduationYearGuess: number | null;
  /** Same last name, when nothing matched outright ("Robbie Tock" → Robert Tock). */
  candidates: { id: string; name: string }[];
  /** Other unknown names in the file that look like the same new person (same first name, surname a letter or two off). */
  sameAsInFile: string[];
};

export type HistoryMeetReview = {
  index: number;
  name: string;
  date: string;
  rows: number;
  races: string[];
  /**
   * A meet on this date is already in the app (imported from official results, or an earlier run, maybe
   * under another name): skipped, so nobody gets a second copy of that race.
   */
  existingMeetId: string | null;
  /** Its name in the app, so the review can say which meet it matched. */
  existingMeetName: string | null;
  /** From an earlier meet of the same name, when the app has one. */
  venueName: string;
};

export type HistoryReview = {
  meets: HistoryMeetReview[];
  athletes: HistoryAthleteReview[];
  venues: string[];
  allAthletes: { id: string; name: string; gender: "M" | "F" | "X" }[];
  /** Years the program already has a season for; others get one. */
  seasons: number[];
};

const seasonYear = (date: string) => Number(date.slice(0, 4));

export async function reviewHistory(db: Db, school: School, meets: HistoryMeet[]): Promise<HistoryReview> {
  const existingMeets = await collection(db, "meets").find({ schoolId: school._id, deletedAt: null }).toArray();
  const venues = await collection(db, "venues").find({ schoolId: school._id, deletedAt: null }).toArray();
  const venueName = new Map(venues.map((v) => [v._id, v.name]));
  const athletes = await collection(db, "athletes").find({ schoolId: school._id, deletedAt: null }).toArray();
  const seasonDocs = await collection(db, "seasons").find({ schoolId: school._id, deletedAt: null }).toArray();

  const seasonsByName = new Map<string, { gender: "M" | "F"; seasons: Set<number> }>();
  for (const m of meets) {
    for (const r of m.rows) {
      const e = seasonsByName.get(r.name) ?? { gender: r.gender, seasons: new Set<number>() };
      e.seasons.add(seasonYear(m.date));
      seasonsByName.set(r.name, e);
    }
  }
  const athleteReviews: HistoryAthleteReview[] = [...seasonsByName]
    .map(([name, { gender, seasons }]) => {
      const match = matchAthlete({ name, firstName: name.split(" ")[0], lastName: name.split(" ").slice(1).join(" "), team: null, grade: null, bib: null, place: null, status: "finished", finishMs: null, splits: {} }, athletes);
      const years = [...seasons].sort();
      return {
        name,
        gender,
        athleteId: match.athlete?._id ?? null,
        seasons: years,
        graduationYearGuess: match.athlete ? null : years.length >= 4 ? years[years.length - 1] + 1 : null,
        candidates: match.athlete ? [] : match.candidates.map((a) => ({ id: a._id, name: a.displayName })),
        sameAsInFile: [] as string[],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  // Two unknown spellings of one person in the same file ("Robbie Tock" in 2019, "Robert Tock" in 2021).
  const unknown = athleteReviews.filter((a) => !a.athleteId);
  for (const a of unknown) {
    const [first, ...rest] = normalizeName(a.name).split(" ");
    a.sameAsInFile = unknown
      .filter((b) => b !== a && b.gender === a.gender)
      .filter((b) => {
        const [bf, ...br] = normalizeName(b.name).split(" ");
        return (bf === first || editDistance(bf, first) <= 2) && editDistance(br.join(" "), rest.join(" ")) <= 2;
      })
      .map((b) => b.name);
  }

  return {
    meets: meets.map((m, index) => {
      // Same date is the same meet (the sheet's name and the app's can differ); same name first if two share a day.
      const sameDay = existingMeets.filter((e) => e.date === m.date);
      const existing = sameDay.find((e) => e.name.trim().toLowerCase() === m.name.trim().toLowerCase()) ?? sameDay[0];
      const sameName = existingMeets.filter((e) => e.venueId && e.name.trim().toLowerCase() === m.name.trim().toLowerCase()).sort((a, b) => b.date.localeCompare(a.date))[0];
      return {
        index,
        name: m.name,
        date: m.date,
        rows: m.rows.length,
        races: raceGroups(m.rows).map((g) => g.name),
        existingMeetId: existing?._id ?? null,
        existingMeetName: existing?.name ?? null,
        venueName: sameName?.venueId ? (venueName.get(sameName.venueId) ?? "") : "",
      };
    }),
    athletes: athleteReviews,
    venues: venues.map((v) => v.name).sort(),
    allAthletes: athletes.map((a) => ({ id: a._id, name: a.displayName, gender: a.gender })).sort((a, b) => a.name.localeCompare(b.name)),
    seasons: [...new Set(seasonDocs.map((s) => seasonYear(s.endDate)))].sort(),
  };
}

export type HistoryChoices = {
  /** Meet index → venue name ("" = none). Meets not listed are skipped. */
  meets: Record<number, { venueName: string }>;
  /** Name in the file → athlete to credit, a new athlete to create, or another name in the file that is the same new person. */
  athletes: Record<string, { athleteId: string } | { create: { graduationYear: number | null } } | { sameAs: string }>;
};

type RaceGroup = { key: string; name: string; gender: "M" | "F"; level: "varsity" | "jv"; rows: HistoryRow[] };

function raceGroups(rows: HistoryRow[]): RaceGroup[] {
  const groups = new Map<string, RaceGroup>();
  for (const r of rows) {
    const key = `${r.gender}-${r.level}`;
    const g = groups.get(key) ?? { key, name: `${r.gender === "M" ? "Boys" : "Girls"} ${r.level === "jv" ? "JV" : "Varsity"}`, gender: r.gender, level: r.level, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  // Girls varsity, boys varsity, then JV: the usual order of a meet.
  const order = (g: RaceGroup) => (g.level === "varsity" ? 0 : 2) + (g.gender === "F" ? 0 : 1);
  return [...groups.values()].sort((a, b) => order(a) - order(b));
}

export type HistoryCommitResult = { meets: number; skipped: number; races: number; results: number; athletesCreated: number; seasonsCreated: number };

/**
 * Two phases, each its own short transaction, so a slow connection can't run
 * into the transaction time limit and a retry is safe: first seasons and
 * athletes (looked up again inside the transaction, so a second run finds
 * them), then one transaction per meet, skipping any meet already in the app
 * by name and date. A meet that fails rolls back alone; earlier meets stay.
 */
export async function commitHistory(school: School, program: Program, meets: HistoryMeet[], choices: HistoryChoices, actor: Actor): Promise<HistoryCommitResult> {
  const db = await getDb();
  const client = await getClient();
  const result: HistoryCommitResult = { meets: 0, skipped: 0, races: 0, results: 0, athletesCreated: 0, seasonsCreated: 0 };
  const chosen = meets.map((m, i) => ({ m, i })).filter(({ i }) => choices.meets[i]);
  if (chosen.length === 0) return result;

  const people = await client.withSession((session) => session.withTransaction(() => writePeople(db, session, school, program, chosen.map(({ m }) => m), choices, actor, result)));
  const distances = await collection(db, "distances").find({ sport: "xc" }).toArray();
  for (const { m, i } of chosen) {
    await client.withSession((session) => session.withTransaction(() => writeMeet(db, session, school, program, m, choices.meets[i].venueName, people, distances, actor, result)));
  }

  // The badges can trust history back to the earliest season imported.
  const earliest = Math.min(...chosen.map(({ m }) => seasonYear(m.date)));
  const current = program.settings.historyCompleteFromYear;
  if (current === null || earliest < current) {
    await collection(db, "programs").updateOne({ _id: program._id }, { $set: { "settings.historyCompleteFromYear": earliest, updatedAt: new Date(), updatedBy: actor } });
  }
  return result;
}

type People = { seasons: Map<number, string>; athleteIdByName: Map<string, string>; athleteById: Map<string, Athlete> };

/** The program's level id for a sheet's "varsity" / "jv", by id, abbreviation or label; the sheet's word if the program has no match. */
function levelIdFor(program: Pick<Program, "settings">, level: "varsity" | "jv"): string {
  const want = level === "jv" ? ["jv", "junior varsity"] : ["varsity", "v"];
  return program.settings.levels.find((l) => want.includes(l.id.toLowerCase()) || want.includes(l.abbreviation.toLowerCase()) || want.includes(l.label.toLowerCase()))?.id ?? level;
}

async function writePeople(db: Db, session: ClientSession, school: School, program: Program, meets: HistoryMeet[], choices: HistoryChoices, actor: Actor, result: HistoryCommitResult): Promise<People> {
  const now = new Date();
  const audit = { source: "manual" as const, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor, deletedAt: null };
  const tenant = { schoolId: school._id };

  // Seasons: one per calendar year, created where missing.
  const seasons = new Map<number, string>();
  for (const s of await collection(db, "seasons").find({ programId: program._id, deletedAt: null }, { session }).toArray()) seasons.set(seasonYear(s.endDate), s._id);
  for (const year of new Set(meets.map((m) => seasonYear(m.date)))) {
    if (seasons.has(year)) continue;
    const season = COLLECTIONS.seasons.schema.parse({ _id: newId(), ...tenant, schemaVersion: COLLECTIONS.seasons.version, programId: program._id, label: String(year), startDate: `${year}-08-01`, endDate: `${year}-11-30`, badgeRules: [], ...audit });
    await collection(db, "seasons").insertOne(season, { session });
    seasons.set(year, season._id);
    result.seasonsCreated += 1;
  }

  // Athletes: matched ones as chosen; new ones created once, and not again if a name is already in the app
  // (a retry, or a spelling that arrived since the review). Rosters per season they appear in.
  const athleteIdByName = new Map<string, string>();
  const athleteById = new Map<string, Athlete>();
  const existing = await collection(db, "athletes").find({ schoolId: school._id, deletedAt: null }, { session }).toArray();
  for (const a of existing) athleteById.set(a._id, a);
  const known = (name: string) => existing.find((a) => [a.displayName, a.officialName, ...a.aliases].some((n) => normalizeName(n) === normalizeName(name)));
  const namesByGender = new Map<string, "M" | "F">();
  for (const m of meets) for (const r of m.rows) if (!namesByGender.has(r.name)) namesByGender.set(r.name, r.gender);
  const created = new Map<string, Athlete>(); // by normalized name, for a second spelling the coach said is the same new person
  for (const [name, gender] of namesByGender) {
    const choice = choices.athletes[name];
    if (!choice) throw new Error(`No decision for ${name}`);
    if ("athleteId" in choice) {
      const a = athleteById.get(choice.athleteId);
      if (!a) throw new Error(`Unknown athlete for ${name}`);
      athleteIdByName.set(name, a._id);
      // A spelling the coach confirmed ("Robbie Tock") is remembered for the next import.
      if (![a.displayName, a.officialName, ...a.aliases].some((n) => normalizeName(n) === normalizeName(name))) {
        await collection(db, "athletes").updateOne({ _id: a._id }, { $addToSet: { aliases: name }, $set: { updatedAt: now, updatedBy: actor } }, { session });
        a.aliases.push(name);
      }
      continue;
    }
    if ("sameAs" in choice) continue; // resolved below, once the person it points at exists
    const already = known(name);
    if (already) {
      athleteIdByName.set(name, already._id);
      continue;
    }
    const athlete = COLLECTIONS.athletes.schema.parse({ _id: newId(), ...tenant, schemaVersion: COLLECTIONS.athletes.version, displayName: name, officialName: name, aliases: [], gender, graduationYear: choice.create.graduationYear, birthYear: null, athleticNetId: null, ...audit });
    await collection(db, "athletes").insertOne(athlete, { session });
    athleteById.set(athlete._id, athlete);
    athleteIdByName.set(name, athlete._id);
    created.set(normalizeName(name), athlete);
    result.athletesCreated += 1;
  }
  for (const [name] of namesByGender) {
    const choice = choices.athletes[name];
    if (!choice || !("sameAs" in choice)) continue;
    const id = athleteIdByName.get(choice.sameAs);
    if (!id) throw new Error(`${name}: "${choice.sameAs}" isn't in this import`);
    athleteIdByName.set(name, id);
    const a = athleteById.get(id)!;
    if (![a.displayName, a.officialName, ...a.aliases].some((n) => normalizeName(n) === normalizeName(name))) {
      await collection(db, "athletes").updateOne({ _id: id }, { $addToSet: { aliases: name }, $set: { updatedAt: now, updatedBy: actor } }, { session });
      a.aliases.push(name);
    }
  }

  // Season rosters: the level they ran most that season; one read and one write for the lot.
  const levelCounts = new Map<string, Map<string, number>>(); // `${seasonId}:${athleteId}` → level → count
  for (const m of meets) {
    const seasonId = seasons.get(seasonYear(m.date))!;
    for (const r of m.rows) {
      const key = `${seasonId}:${athleteIdByName.get(r.name)}`;
      const counts = levelCounts.get(key) ?? new Map<string, number>();
      counts.set(r.level, (counts.get(r.level) ?? 0) + 1);
      levelCounts.set(key, counts);
    }
  }
  const have = await collection(db, "seasonRosters").find({ seasonId: { $in: [...seasons.values()] }, athleteId: { $in: [...new Set(athleteIdByName.values())] }, deletedAt: null }, { session, projection: { seasonId: 1, athleteId: 1 } }).toArray();
  const haveKeys = new Set(have.map((r) => `${r.seasonId}:${r.athleteId}`));
  const rosters = [...levelCounts]
    .filter(([key]) => !haveKeys.has(key))
    .map(([key, counts]) => {
      const [seasonId, athleteId] = key.split(":");
      const level = [...counts].sort((a, b) => b[1] - a[1])[0][0] as "varsity" | "jv";
      return COLLECTIONS.seasonRosters.schema.parse({ _id: newId(), ...tenant, schemaVersion: COLLECTIONS.seasonRosters.version, seasonId, athleteId, defaultLevelId: levelIdFor(program, level), ...audit });
    });
  if (rosters.length > 0) await collection(db, "seasonRosters").insertMany(rosters, { session });
  return { seasons, athleteIdByName, athleteById };
}

async function writeMeet(db: Db, session: ClientSession, school: School, program: Program, m: HistoryMeet, venueName: string, people: People, distances: { _id: string; meters: number }[], actor: Actor, result: HistoryCommitResult): Promise<void> {
  const now = new Date();
  const audit = { source: "manual" as const, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor, deletedAt: null };
  const tenant = { schoolId: school._id };
  const { seasons, athleteIdByName, athleteById } = people;

  // Already in the app on that date (official results, an earlier run, a retry after a lost response,
  // whatever it's called there): leave it alone rather than make a second copy of the race.
  if (await collection(db, "meets").findOne({ schoolId: school._id, date: m.date, deletedAt: null }, { session, projection: { _id: 1 } })) {
    result.skipped += 1;
    return;
  }

  const seasonId = seasons.get(seasonYear(m.date))!;
  const { venueId, courseId } = await resolvePlace(db, school._id, { venueName: venueName.trim(), venueCity: "", venueState: "", date: m.date, courseId: "", newCourseName: "" }, actor, session);
  const meet = COLLECTIONS.meets.schema.parse({
    _id: newId(),
    ...tenant,
    schemaVersion: COLLECTIONS.meets.version,
    programId: program._id,
    seasonId,
    meetSeriesId: null,
    venueId,
    courseId,
    name: m.name,
    date: m.date,
    timeZone: school.settings.timeZone,
    weather: null,
    resultsUrl: null,
    joinCodes: { managerCodeHash: null, coachCodeHash: null, viewerTokenHash: null, managerCodeEnc: null, coachCodeEnc: null, viewerTokenEnc: null },
    ...audit,
  });
  await collection(db, "meets").insertOne(meet, { session });
  result.meets += 1;

  const importDoc = COLLECTIONS.imports.schema.parse({ _id: newId(), ...tenant, schemaVersion: COLLECTIONS.imports.version, meetId: meet._id, raceId: null, fileName: "split sheets (history)", contentType: "application/json", raw: JSON.stringify(m), ...audit });
  await collection(db, "imports").insertOne(importDoc, { session });

  const courseMeters = m.distanceMeters ?? 5000;
  const distance = distances.find((d) => Math.abs(d.meters - courseMeters) < 1) ?? distances.find((d) => d.meters === 5000) ?? distances[0];
  // A finished race at noon local: the clock never ran in the app, only the sheet's times exist.
  const finishedAt = new Date(`${m.date}T12:00:00`);

  for (const [order, group] of raceGroups(m.rows).entries()) {
    const levelId = levelIdFor(program, group.level);
    const checkpoints: Race["checkpoints"] = [
      ...m.checkpoints.map((c, n) => ({ id: `cp-split-${n + 1}`, label: c.label, distance: distanceValue(Math.round(c.meters), "m"), kind: "split" as const })),
      { id: "cp-finish", label: "Finish", distance: distanceValue(courseMeters, "m"), kind: "finish" as const },
    ];
    const race = COLLECTIONS.races.schema.parse({
      _id: newId(),
      ...tenant,
      schemaVersion: COLLECTIONS.races.version,
      meetId: meet._id,
      name: group.name,
      order,
      scheduledStart: null,
      eventKind: "run",
      raceCategoryId: program.settings.raceCategories.find((c) => c.gender === group.gender)?.id ?? program.settings.raceCategories[0].id,
      levelIds: [levelId],
      distanceId: distance._id,
      measuredDistance: null,
      gunTimeMs: null,
      gunTimeSource: null,
      finishedAt,
      officialImportId: importDoc._id,
      placesDerived: false,
      liveFeed: null,
      checkpoints,
      lineup: group.rows.map((r) => ({ athleteId: athleteIdByName.get(r.name)!, levelId })),
      sections: [],
      teamScoring: [],
      // The sheet's team numbers and letter standard: only our runners are imported, not the field.
      sheetSummary: sheetSummaryFor(m.summaries, group.name),
      exclusions: { excludeFromPrSb: false, excludeFromCourseLists: false, excludeFromMeetLists: false, exclusionReason: null },
      ...audit,
    });
    await collection(db, "races").insertOne(race, { session });
    result.races += 1;

    const entries = group.rows.map((r) =>
      COLLECTIONS.raceEntries.schema.parse({
        _id: newId(),
        ...tenant,
        schemaVersion: COLLECTIONS.raceEntries.version,
        raceId: race._id,
        importId: importDoc._id,
        name: r.name,
        teamName: school.shortName,
        grade: null,
        bib: null,
        place: r.place,
        status: r.status,
        timeMs: r.finishMs,
        precision: r.finishMs !== null ? "seconds" : null,
        splits: m.checkpoints.flatMap((c, n) => (r.splits[c.label] !== undefined ? [{ label: c.label, checkpointId: `cp-split-${n + 1}`, cumulativeMs: r.splits[c.label] }] : [])),
        athleteId: athleteIdByName.get(r.name)!,
        source: "mat" as const,
        createdAt: now,
        createdBy: actor,
        updatedAt: now,
        updatedBy: actor,
        deletedAt: null,
      }),
    );
    const results = group.rows.map((r, n) => {
      const athleteId = athleteIdByName.get(r.name)!;
      const athlete = athleteById.get(athleteId)!;
      const splits: Split[] = [
        ...m.checkpoints.flatMap((c, k) => (r.splits[c.label] !== undefined ? [{ checkpointId: `cp-split-${k + 1}`, cumulativeMs: r.splits[c.label], source: "mat" as const, edited: false, estimate: false }] : [])),
        ...(r.finishMs !== null ? [{ checkpointId: "cp-finish", cumulativeMs: r.finishMs, source: "mat" as const, edited: false, estimate: false }] : []),
      ];
      const grade = athlete.graduationYear !== null ? gradeForSeason(athlete.graduationYear, `${seasonYear(m.date)}-11-30`) : null;
      return COLLECTIONS.results.schema.parse({
        _id: newId(),
        ...tenant,
        schemaVersion: COLLECTIONS.results.version,
        raceId: race._id,
        athleteId,
        distanceId: distance._id,
        mark: r.finishMs !== null ? { type: "time", value: r.finishMs, precision: "seconds", timingMethod: "fat" } : null,
        status: r.status,
        place: r.place,
        levelId,
        levelPlace: null,
        sectionId: null,
        gradeSnapshot: grade !== null && grade >= 1 && grade <= 13 ? grade : null,
        splits,
        exclusions: { excludeFromPrSb: null, excludeFromCourseLists: null, excludeFromMeetLists: null, exclusionReason: null },
        legacy: false, // a real race record exists for it; "legacy" is for results with no race
        legacyInfo: null,
        supersededBy: null,
        raceEntryId: entries[n]._id,
        legs: [],
        attempts: [],
        windMps: null,
        source: "legacy_board",
        createdAt: now,
        createdBy: actor,
        updatedAt: now,
        updatedBy: actor,
        deletedAt: null,
      });
    });
    if (entries.length > 0) await collection(db, "raceEntries").insertMany(entries, { session });
    if (results.length > 0) await collection(db, "results").insertMany(results, { session });
    result.results += results.length;
  }
}

import "server-only";
import type { ClientSession, Db } from "mongodb";
import { getClient, getDb, newId } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import type { Actor, Athlete, Program, Race, School, Split } from "@/lib/db/schema";
import { distanceValue } from "@/lib/distance";
import { gradeForSeason } from "@/lib/grade";
import { resolvePlace } from "@/lib/places";
import { matchAthlete, normalizeName } from "./match";
import type { HistoryMeet, HistoryRow } from "./splits-history";

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
};

export type HistoryMeetReview = {
  index: number;
  name: string;
  date: string;
  rows: number;
  races: string[];
  /** A meet with this name and date is already in the app: skipped. */
  existingMeetId: string | null;
  /** From an earlier meet of the same name, when the app has one. */
  venueName: string;
};

export type HistoryReview = { meets: HistoryMeetReview[]; athletes: HistoryAthleteReview[]; venues: string[]; allAthletes: { id: string; name: string; gender: "M" | "F" | "X" }[] };

const seasonYear = (date: string) => Number(date.slice(0, 4));

export async function reviewHistory(db: Db, school: School, meets: HistoryMeet[]): Promise<HistoryReview> {
  const existingMeets = await collection(db, "meets").find({ schoolId: school._id, deletedAt: null }).toArray();
  const venues = await collection(db, "venues").find({ schoolId: school._id, deletedAt: null }).toArray();
  const venueName = new Map(venues.map((v) => [v._id, v.name]));
  const athletes = await collection(db, "athletes").find({ schoolId: school._id, deletedAt: null }).toArray();

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
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    meets: meets.map((m, index) => {
      const existing = existingMeets.find((e) => e.date === m.date && e.name.trim().toLowerCase() === m.name.trim().toLowerCase());
      const sameName = existingMeets.filter((e) => e.venueId && e.name.trim().toLowerCase() === m.name.trim().toLowerCase()).sort((a, b) => b.date.localeCompare(a.date))[0];
      return {
        index,
        name: m.name,
        date: m.date,
        rows: m.rows.length,
        races: raceGroups(m.rows).map((g) => g.name),
        existingMeetId: existing?._id ?? null,
        venueName: sameName?.venueId ? (venueName.get(sameName.venueId) ?? "") : "",
      };
    }),
    athletes: athleteReviews,
    venues: venues.map((v) => v.name).sort(),
    allAthletes: athletes.map((a) => ({ id: a._id, name: a.displayName, gender: a.gender })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export type HistoryChoices = {
  /** Meet index → venue name ("" = none). Meets not listed are skipped. */
  meets: Record<number, { venueName: string }>;
  /** Name in the file → athlete to credit, or a new athlete to create. */
  athletes: Record<string, { athleteId: string } | { create: { graduationYear: number | null } }>;
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

export type HistoryCommitResult = { meets: number; races: number; results: number; athletesCreated: number; seasonsCreated: number };

export async function commitHistory(school: School, program: Program, meets: HistoryMeet[], choices: HistoryChoices, actor: Actor): Promise<HistoryCommitResult> {
  const db = await getDb();
  const client = await getClient();
  return client.withSession((session) => session.withTransaction(() => writeHistory(db, session, school, program, meets, choices, actor)));
}

async function writeHistory(db: Db, session: ClientSession, school: School, program: Program, meets: HistoryMeet[], choices: HistoryChoices, actor: Actor): Promise<HistoryCommitResult> {
  const now = new Date();
  const audit = { source: "manual" as const, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor, deletedAt: null };
  const tenant = { schoolId: school._id };
  const result: HistoryCommitResult = { meets: 0, races: 0, results: 0, athletesCreated: 0, seasonsCreated: 0 };
  const chosen = meets.map((m, i) => ({ m, i })).filter(({ i }) => choices.meets[i]);
  if (chosen.length === 0) return result;

  // Seasons: one per calendar year the chosen meets fall in, created where missing.
  const seasons = new Map<number, string>();
  for (const s of await collection(db, "seasons").find({ programId: program._id, deletedAt: null }, { session }).toArray()) {
    seasons.set(seasonYear(s.endDate), s._id);
  }
  for (const year of new Set(chosen.map(({ m }) => seasonYear(m.date)))) {
    if (seasons.has(year)) continue;
    const season = COLLECTIONS.seasons.schema.parse({
      _id: newId(),
      ...tenant,
      schemaVersion: COLLECTIONS.seasons.version,
      programId: program._id,
      label: String(year),
      startDate: `${year}-08-01`,
      endDate: `${year}-11-30`,
      badgeRules: [],
      ...audit,
    });
    await collection(db, "seasons").insertOne(season, { session });
    seasons.set(year, season._id);
    result.seasonsCreated += 1;
  }

  // Athletes: matched ones as chosen, new ones created once. Rosters per season they appear in.
  const athleteIdByName = new Map<string, string>();
  const athleteById = new Map<string, Athlete>();
  const existing = await collection(db, "athletes").find({ schoolId: school._id, deletedAt: null }, { session }).toArray();
  for (const a of existing) athleteById.set(a._id, a);
  const namesByGender = new Map<string, "M" | "F">();
  for (const { m } of chosen) for (const r of m.rows) namesByGender.set(r.name, r.gender);
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
      }
      continue;
    }
    const athlete = COLLECTIONS.athletes.schema.parse({
      _id: newId(),
      ...tenant,
      schemaVersion: COLLECTIONS.athletes.version,
      displayName: name,
      officialName: name,
      aliases: [],
      gender,
      graduationYear: choice.create.graduationYear,
      birthYear: null,
      athleticNetId: null,
      ...audit,
    });
    await collection(db, "athletes").insertOne(athlete, { session });
    athleteById.set(athlete._id, athlete);
    athleteIdByName.set(name, athlete._id);
    result.athletesCreated += 1;
  }
  // Season rosters: the level they ran most that season.
  const levelCounts = new Map<string, Map<string, number>>(); // `${seasonId}:${athleteId}` → level → count
  for (const { m } of chosen) {
    const seasonId = seasons.get(seasonYear(m.date))!;
    for (const r of m.rows) {
      const key = `${seasonId}:${athleteIdByName.get(r.name)}`;
      const counts = levelCounts.get(key) ?? new Map<string, number>();
      counts.set(r.level, (counts.get(r.level) ?? 0) + 1);
      levelCounts.set(key, counts);
    }
  }
  for (const [key, counts] of levelCounts) {
    const [seasonId, athleteId] = key.split(":");
    const level = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const has = await collection(db, "seasonRosters").findOne({ seasonId, athleteId, deletedAt: null }, { session });
    if (has) continue;
    await collection(db, "seasonRosters").insertOne(
      COLLECTIONS.seasonRosters.schema.parse({ _id: newId(), ...tenant, schemaVersion: COLLECTIONS.seasonRosters.version, seasonId, athleteId, defaultLevelId: level, ...audit }),
      { session },
    );
  }

  const distances = await collection(db, "distances").find({ sport: "xc" }, { session }).toArray();
  const categoryFor = (gender: "M" | "F") => program.settings.raceCategories.find((c) => c.gender === gender)?.id ?? program.settings.raceCategories[0].id;

  for (const { m, i } of chosen) {
    const seasonId = seasons.get(seasonYear(m.date))!;
    const { venueId, courseId } = await resolvePlace(db, school._id, { venueName: choices.meets[i].venueName.trim(), venueCity: "", venueState: "", date: m.date, courseId: "", newCourseName: "" }, actor, session);
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

    const importDoc = COLLECTIONS.imports.schema.parse({
      _id: newId(),
      ...tenant,
      schemaVersion: COLLECTIONS.imports.version,
      meetId: meet._id,
      raceId: null,
      fileName: "split sheets (history)",
      contentType: "application/json",
      raw: JSON.stringify(m),
      ...audit,
    });
    await collection(db, "imports").insertOne(importDoc, { session });

    const courseMeters = m.distanceMeters ?? 5000;
    const distance = distances.find((d) => Math.abs(d.meters - courseMeters) < 1) ?? distances.find((d) => d.meters === 5000) ?? distances[0];
    // A finished race at noon local: the clock never ran in the app, only the sheet's times exist.
    const finishedAt = new Date(`${m.date}T12:00:00`);

    for (const [order, group] of raceGroups(m.rows).entries()) {
      const checkpoints: Race["checkpoints"] = [
        ...m.checkpoints.map((c, n) => ({ id: `cp-split-${n + 1}`, label: c.label, distance: distanceValue(Math.round(c.meters), "m"), kind: "split" as const })),
        { id: "cp-finish", label: "Finish", distance: distanceValue(courseMeters, "m"), kind: "finish" as const },
      ];
      const lineup = group.rows.map((r) => ({ athleteId: athleteIdByName.get(r.name)!, levelId: group.level }));
      const race = COLLECTIONS.races.schema.parse({
        _id: newId(),
        ...tenant,
        schemaVersion: COLLECTIONS.races.version,
        meetId: meet._id,
        name: group.name,
        order,
        scheduledStart: null,
        eventKind: "run",
        raceCategoryId: categoryFor(group.gender),
        levelIds: [group.level],
        distanceId: distance._id,
        measuredDistance: null,
        gunTimeMs: null,
        gunTimeSource: null,
        finishedAt,
        officialImportId: importDoc._id,
        placesDerived: false,
        liveFeed: null,
        checkpoints,
        lineup,
        sections: [],
        teamScoring: [],
        exclusions: { excludeFromPrSb: false, excludeFromCourseLists: false, excludeFromMeetLists: false, exclusionReason: null },
        ...audit,
      });
      await collection(db, "races").insertOne(race, { session });
      result.races += 1;

      for (const r of group.rows) {
        const athleteId = athleteIdByName.get(r.name)!;
        const athlete = athleteById.get(athleteId)!;
        const entry = COLLECTIONS.raceEntries.schema.parse({
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
          athleteId,
          ...{ source: "mat" as const, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor, deletedAt: null },
        });
        await collection(db, "raceEntries").insertOne(entry, { session });
        const splits: Split[] = [
          ...m.checkpoints.flatMap((c, n) => (r.splits[c.label] !== undefined ? [{ checkpointId: `cp-split-${n + 1}`, cumulativeMs: r.splits[c.label], source: "mat" as const, edited: false, estimate: false }] : [])),
          ...(r.finishMs !== null ? [{ checkpointId: "cp-finish", cumulativeMs: r.finishMs, source: "mat" as const, edited: false, estimate: false }] : []),
        ];
        const grade = athlete.graduationYear !== null ? gradeForSeason(athlete.graduationYear, `${seasonYear(m.date)}-11-30`) : null;
        const doc = COLLECTIONS.results.schema.parse({
          _id: newId(),
          ...tenant,
          schemaVersion: COLLECTIONS.results.version,
          raceId: race._id,
          athleteId,
          distanceId: distance._id,
          mark: r.finishMs !== null ? { type: "time", value: r.finishMs, precision: "seconds", timingMethod: "fat" } : null,
          status: r.status,
          place: r.place,
          levelId: group.level,
          levelPlace: null,
          sectionId: null,
          gradeSnapshot: grade !== null && grade >= 1 && grade <= 13 ? grade : null,
          splits,
          exclusions: { excludeFromPrSb: null, excludeFromCourseLists: null, excludeFromMeetLists: null, exclusionReason: null },
          legacy: false, // a real race record exists for it; "legacy" is for results with no race
          legacyInfo: null,
          supersededBy: null,
          raceEntryId: entry._id,
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
        await collection(db, "results").insertOne(doc, { session });
        result.results += 1;
      }
    }
  }

  // The badges can trust history back to the earliest season imported.
  const earliest = Math.min(...chosen.map(({ m }) => seasonYear(m.date)));
  const current = program.settings.historyCompleteFromYear;
  if (current === null || earliest < current) {
    await collection(db, "programs").updateOne({ _id: program._id }, { $set: { "settings.historyCompleteFromYear": earliest, updatedAt: now, updatedBy: actor } }, { session });
  }
  return result;
}

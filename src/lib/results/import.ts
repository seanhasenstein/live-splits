import "server-only";
import type { Actor, Athlete, Meet, Race, Result, Split } from "@/lib/db/schema";
import { getDb, newId } from "@/lib/db/client";
import { collection, COLLECTIONS } from "@/lib/db/collections";
import { gradeForSeason } from "@/lib/grade";
import { replay } from "@/lib/replay";
import { normalizeName } from "./match";
import type { ParsedContest, ParsedEntry } from "./parse";

/**
 * Write an imported contest against a race: the whole field as raceEntries,
 * results for our athletes (official finish + mat splits, with the app's own
 * splits kept beside them), and the race marked as having official results.
 */

export type Assignment = { entryIndex: number; athleteId: string };

export type ImportPlan = {
  race: Race;
  contest: ParsedContest;
  /** Which of our athletes each results row is. Rows not listed are other schools. */
  assignments: Assignment[];
  /** Lineup athletes with no row: recorded as did-not-start. */
  dnsAthleteIds: string[];
};

/** Map a mat label to a checkpoint id: "Mile 1" ↔ "Mile 1"; "Finish" ↔ the finish checkpoint. */
export function checkpointForLabel(race: Race, label: string): string | null {
  const n = normalizeName(label);
  if (n === "finish") return race.checkpoints.find((c) => c.kind === "finish")?.id ?? null;
  return race.checkpoints.find((c) => normalizeName(c.label) === n)?.id ?? null;
}

export async function commitImport(meet: Meet, plans: ImportPlan[], raw: string, sourceUrl: string | null, actor: Actor): Promise<{ importId: string }> {
  const db = await getDb();
  const now = new Date();
  const audit = { source: "mat" as const, createdAt: now, createdBy: actor, updatedAt: now, updatedBy: actor, deletedAt: null };
  const season = await collection(db, "seasons").findOne({ _id: meet.seasonId });

  const importDoc = COLLECTIONS.imports.schema.parse({
    _id: newId(),
    schoolId: meet.schoolId,
    schemaVersion: COLLECTIONS.imports.version,
    meetId: meet._id,
    raceId: new Set(plans.map((p) => p.race._id)).size === 1 ? plans[0].race._id : null,
    fileName: sourceUrl,
    contentType: "application/json",
    raw,
    ...audit,
  });
  await collection(db, "imports").insertOne(importDoc);

  // Build (and validate) every race's entries before touching the database, so a bad row
  // fails the import up front instead of after the old entries were already retired.
  const entriesByPlan = plans.map((plan) => {
    const { race, contest } = plan;
    const byIndex = new Map(plan.assignments.map((a) => [a.entryIndex, a.athleteId]));
    return contest.entries.map((e, i) =>
      COLLECTIONS.raceEntries.schema.parse({
        _id: newId(),
        schoolId: meet.schoolId,
        schemaVersion: COLLECTIONS.raceEntries.version,
        raceId: race._id,
        importId: importDoc._id,
        name: e.name,
        teamName: e.team,
        grade: e.grade,
        bib: e.bib,
        place: e.place,
        status: e.status,
        timeMs: e.finishMs,
        precision: e.finishMs !== null ? "tenths" : null,
        splits: Object.entries(e.splits).map(([label, cumulativeMs]) => ({ label, checkpointId: checkpointForLabel(race, label), cumulativeMs })),
        athleteId: byIndex.get(i) ?? null,
        ...audit,
      }),
    );
  });

  // The full field, replacing any earlier import of each race. Done once per race up front:
  // a combined race (boys + girls JV together) takes two contests, both of which must survive.
  for (const raceId of new Set(plans.map((p) => p.race._id))) {
    await collection(db, "raceEntries").updateMany({ raceId, deletedAt: null }, { $set: { deletedAt: now, updatedAt: now, updatedBy: actor } });
    // An earlier import's result for someone this one doesn't mention would outlive its field.
    const keep = plans.filter((p) => p.race._id === raceId).flatMap((p) => [...p.assignments.map((a) => a.athleteId), ...p.dnsAthleteIds]);
    await collection(db, "results").updateMany({ raceId, deletedAt: null, athleteId: { $nin: keep } }, { $set: { deletedAt: now, updatedAt: now, updatedBy: actor } });
  }

  for (const [planIndex, plan] of plans.entries()) {
    const { race, contest } = plan;
    const byIndex = new Map(plan.assignments.map((a) => [a.entryIndex, a.athleteId]));
    const entries = entriesByPlan[planIndex];
    if (entries.length > 0) await collection(db, "raceEntries").insertMany(entries);
    const entryIdByIndex = new Map(entries.map((e, i) => [i, e._id]));

    // Our results: official times plus a snapshot of the app's splits for comparison.
    const taps = await collection(db, "taps").find({ raceId: race._id }).toArray();
    const state = replay(race, taps);
    const levelByAthlete = new Map(race.lineup.map((l) => [l.athleteId, l.levelId]));
    const athletes = await collection(db, "athletes")
      .find({ _id: { $in: [...byIndex.values(), ...plan.dnsAthleteIds] } })
      .toArray();
    const athleteById = new Map(athletes.map((a) => [a._id, a]));

    const upsertResult = async (athlete: Athlete, entry: ParsedEntry | null, entryIndex: number | null) => {
      const appSplits: Split[] = race.checkpoints.flatMap((c) => {
        const m = state.get(c.id)?.byAthlete.get(athlete._id);
        return m && m.timeMs !== null && race.gunTimeMs ? [{ checkpointId: c.id, cumulativeMs: m.timeMs - race.gunTimeMs, source: "app" as const, edited: m.edited, estimate: m.estimate }] : [];
      });
      const matSplits: Split[] = entry
        ? [
            ...Object.entries(entry.splits).flatMap(([label, ms]) => {
              const id = checkpointForLabel(race, label);
              return id ? [{ checkpointId: id, cumulativeMs: ms, source: "mat" as const, edited: false, estimate: false }] : [];
            }),
            ...(entry.finishMs !== null && checkpointForLabel(race, "Finish")
              ? [{ checkpointId: checkpointForLabel(race, "Finish")!, cumulativeMs: entry.finishMs, source: "mat" as const, edited: false, estimate: false }]
              : []),
          ]
        : [];
      const existing = await collection(db, "results").findOne({ raceId: race._id, athleteId: athlete._id, deletedAt: null });
      const result: Result = COLLECTIONS.results.schema.parse({
        _id: existing?._id ?? newId(),
        schoolId: meet.schoolId,
        schemaVersion: COLLECTIONS.results.version,
        raceId: race._id,
        athleteId: athlete._id,
        distanceId: race.distanceId,
        mark: entry?.finishMs != null ? { type: "time", value: entry.finishMs, precision: "tenths", timingMethod: "rfid" } : null,
        status: entry ? entry.status : "dns",
        place: entry?.place ?? null,
        levelId: levelByAthlete.get(athlete._id) ?? null,
        levelPlace: null,
        sectionId: null,
        gradeSnapshot: entry?.grade ?? (athlete.graduationYear !== null && season ? gradeForSeason(athlete.graduationYear, season.endDate) : null),
        splits: [...matSplits, ...appSplits],
        exclusions: existing?.exclusions ?? { excludeFromPrSb: null, excludeFromCourseLists: null, excludeFromMeetLists: null, exclusionReason: null },
        legacy: false,
        legacyInfo: null,
        supersededBy: null,
        raceEntryId: entryIndex !== null ? (entryIdByIndex.get(entryIndex) ?? null) : null,
        legs: [],
        attempts: [],
        windMps: null,
        source: "mat",
        createdAt: existing?.createdAt ?? now,
        createdBy: existing?.createdBy ?? actor,
        updatedAt: now,
        updatedBy: actor,
        deletedAt: null,
      });
      await collection(db, "results").replaceOne({ _id: result._id }, result, { upsert: true });
    };

    for (const [entryIndex, athleteId] of byIndex) {
      const athlete = athleteById.get(athleteId);
      if (athlete) await upsertResult(athlete, contest.entries[entryIndex], entryIndex);
    }
    for (const athleteId of plan.dnsAthleteIds) {
      const athlete = athleteById.get(athleteId);
      if (athlete) await upsertResult(athlete, null, null);
    }

    // Official results mean the race is over: stop the clock if nobody has yet, at the last
    // official finish when the gun is known (so the card's elapsed time is the race's, not the import's).
    // A combined race takes several contests; the race ends with the last of them.
    const lastFinish = Math.max(0, ...plans.filter((p) => p.race._id === race._id).flatMap((p) => p.contest.entries.map((e) => e.finishMs ?? 0)));
    const finishedAt = race.finishedAt ?? (race.gunTimeMs !== null && lastFinish > 0 ? new Date(race.gunTimeMs + lastFinish) : now);
    await collection(db, "races").updateOne({ _id: race._id }, { $set: { officialImportId: importDoc._id, finishedAt, updatedAt: now, updatedBy: actor } });
  }
  return { importId: importDoc._id };
}

export type OfficialTimes = Record<string, { finishMs: number | null; status: string; place: number | null; byCheckpoint: Record<string, number> }>;

/** Official (mat) times per athlete for a race, keyed by athleteId → checkpointId. Empty when nothing was imported. */
export async function getOfficialTimes(race: Race): Promise<OfficialTimes> {
  if (!race.officialImportId) return {};
  const results = await collection(await getDb(), "results").find({ raceId: race._id, deletedAt: null }).toArray();
  const out: OfficialTimes = {};
  for (const r of results) {
    if (!r.athleteId) continue;
    const byCheckpoint: Record<string, number> = {};
    for (const s of r.splits) if (s.source === "mat") byCheckpoint[s.checkpointId] = s.cumulativeMs;
    out[r.athleteId] = { finishMs: r.mark?.type === "time" ? r.mark.value : null, status: r.status, place: r.place, byCheckpoint };
  }
  return out;
}

/**
 * Gun time implied by official results: for every athlete with both an app
 * finish tap (absolute) and an official finish (elapsed), gun = tap − official.
 * The median is robust to one bad tap.
 */
export async function gunFromOfficial(race: Race): Promise<{ gunTimeMs: number; samples: number; spreadMs: number } | null> {
  const finish = race.checkpoints.find((c) => c.kind === "finish");
  if (!finish) return null;
  const [taps, official] = await Promise.all([collection(await getDb(), "taps").find({ raceId: race._id }).toArray(), getOfficialTimes(race)]);
  const cp = replay(race, taps).get(finish.id);
  const estimates: number[] = [];
  for (const [athleteId, o] of Object.entries(official)) {
    const m = cp?.byAthlete.get(athleteId);
    if (m?.timeMs != null && o.finishMs !== null) estimates.push(m.timeMs - o.finishMs);
  }
  if (estimates.length === 0) return null;
  estimates.sort((a, b) => a - b);
  const mid = Math.floor(estimates.length / 2);
  const median = estimates.length % 2 ? estimates[mid] : Math.round((estimates[mid - 1] + estimates[mid]) / 2);
  return { gunTimeMs: median, samples: estimates.length, spreadMs: estimates[estimates.length - 1] - estimates[0] };
}

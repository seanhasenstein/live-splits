import "server-only";
import type { Workout } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";

export async function listWorkouts(schoolId: string): Promise<Workout[]> {
  return collection(await getDb(), "workouts").find({ schoolId, deletedAt: null }).sort({ date: -1, createdAt: -1 }).toArray();
}

export async function getWorkout(id: string): Promise<Workout | null> {
  return collection(await getDb(), "workouts").findOne({ _id: id, deletedAt: null });
}

/**
 * Each athlete's 5K this season and ever, from official finished results, for
 * proposing workout goals. Results excluded from records don't count here
 * either: a short course would set goals too fast.
 */
export async function fiveKBests(schoolId: string, seasonId: string, athleteIds: string[]): Promise<Record<string, { sb: number | null; pr: number | null }>> {
  const out: Record<string, { sb: number | null; pr: number | null }> = Object.fromEntries(athleteIds.map((id) => [id, { sb: null, pr: null }]));
  if (athleteIds.length === 0) return out;
  const db = await getDb();
  const distances = await collection(db, "distances").find({ sport: "xc", meters: 5000 }).toArray();
  const races = await collection(db, "races")
    .find({ schoolId, distanceId: { $in: distances.map((d) => d._id) }, deletedAt: null }, { projection: { _id: 1, meetId: 1, exclusions: 1 } })
    .toArray();
  const meets = await collection(db, "meets")
    .find({ _id: { $in: [...new Set(races.map((r) => r.meetId))] }, deletedAt: null, recordsExclusion: null }, { projection: { _id: 1, seasonId: 1 } })
    .toArray();
  const seasonOf = new Map(meets.map((m) => [m._id, m.seasonId]));
  const raceById = new Map(races.filter((r) => seasonOf.has(r.meetId)).map((r) => [r._id, r]));
  const results = await collection(db, "results")
    .find({ schoolId, raceId: { $in: [...raceById.keys()] }, athleteId: { $in: athleteIds }, status: "finished", "mark.type": "time", supersededBy: null, deletedAt: null }, { projection: { athleteId: 1, raceId: 1, mark: 1, exclusions: 1 } })
    .toArray();
  for (const r of results) {
    const race = raceById.get(r.raceId!)!;
    if (r.exclusions.excludeFromPrSb ?? race.exclusions.excludeFromPrSb) continue;
    if (r.mark?.type !== "time") continue;
    const b = out[r.athleteId!];
    if (b.pr === null || r.mark.value < b.pr) b.pr = r.mark.value;
    if (seasonOf.get(race.meetId) === seasonId && (b.sb === null || r.mark.value < b.sb)) b.sb = r.mark.value;
  }
  return out;
}

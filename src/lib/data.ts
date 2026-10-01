import "server-only";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import type { Athlete, Distance, Meet, Program, Race, School, Season, Sport } from "@/lib/db/schema";

// Read helpers for server components and actions. Everything filters soft deletes.

export async function getSchool(schoolId: string): Promise<School | null> {
  return collection(await getDb(), "schools").findOne({ _id: schoolId, deletedAt: null });
}

/** Single-tenant for now: the one school in the database. */
export async function getOnlySchool(): Promise<School | null> {
  return collection(await getDb(), "schools").findOne({ deletedAt: null });
}

export async function getProgram(schoolId: string, sport: Sport): Promise<Program | null> {
  return collection(await getDb(), "programs").findOne({ schoolId, sport, deletedAt: null });
}

/** The season containing `date`, else the most recent one. */
export async function getSeasonFor(programId: string, date: string): Promise<Season | null> {
  const seasons = collection(await getDb(), "seasons");
  return (
    (await seasons.findOne({ programId, startDate: { $lte: date }, endDate: { $gte: date }, deletedAt: null })) ??
    (await seasons.findOne({ programId, deletedAt: null }, { sort: { endDate: -1 } }))
  );
}

export async function getMeet(meetId: string): Promise<Meet | null> {
  return collection(await getDb(), "meets").findOne({ _id: meetId, deletedAt: null });
}

export async function listMeets(schoolId: string): Promise<Meet[]> {
  return collection(await getDb(), "meets")
    .find({ schoolId, deletedAt: null })
    .sort({ date: -1 })
    .toArray();
}

export async function getRace(raceId: string): Promise<Race | null> {
  return collection(await getDb(), "races").findOne({ _id: raceId, deletedAt: null });
}

export async function listRaces(meetId: string): Promise<Race[]> {
  return collection(await getDb(), "races")
    .find({ meetId, deletedAt: null })
    .sort({ order: 1, scheduledStart: 1 })
    .toArray();
}

export async function listDistances(sport: Sport): Promise<Distance[]> {
  return collection(await getDb(), "distances").find({ sport, deletedAt: null }).sort({ meters: 1 }).toArray();
}

export type RosterAthlete = Athlete & { defaultLevelId: string };

/** Athletes on a season's roster, with their default level. */
export async function listRoster(seasonId: string): Promise<RosterAthlete[]> {
  const db = await getDb();
  const entries = await collection(db, "seasonRosters").find({ seasonId, deletedAt: null }).toArray();
  const levelByAthlete = new Map(entries.map((e) => [e.athleteId, e.defaultLevelId]));
  const athletes = await collection(db, "athletes")
    .find({ _id: { $in: [...levelByAthlete.keys()] }, deletedAt: null })
    .sort({ displayName: 1 })
    .toArray();
  return athletes.map((a) => ({ ...a, defaultLevelId: levelByAthlete.get(a._id)! }));
}

export async function listAthletes(schoolId: string, ids: string[]): Promise<Athlete[]> {
  return collection(await getDb(), "athletes").find({ schoolId, _id: { $in: ids } }).toArray();
}

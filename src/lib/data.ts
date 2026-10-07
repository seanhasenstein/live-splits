import "server-only";
import { decrypt, formatCode } from "@/lib/auth/crypto";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import type { Athlete, Course, Distance, Meet, Program, Race, School, Season, Sport, Venue } from "@/lib/db/schema";

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

/** A meet's join codes, readable again for coaches. Null for meets created before codes were stored encrypted. */
export function readJoinCodes(meet: Meet): { managerCode: string; coachCode: string; viewerPath: string } | null {
  const manager = decrypt(meet.joinCodes.managerCodeEnc);
  const coach = decrypt(meet.joinCodes.coachCodeEnc);
  const viewer = decrypt(meet.joinCodes.viewerTokenEnc);
  if (!manager || !coach || !viewer) return null;
  return { managerCode: formatCode(manager), coachCode: formatCode(coach), viewerPath: `/v/${viewer}` };
}

/** Name on the gun tap currently in effect, per race. */
export async function gunFiredBy(raceIds: string[]): Promise<Record<string, string>> {
  const taps = await collection(await getDb(), "taps")
    .find({ raceId: { $in: raceIds }, type: "gun" })
    .sort({ createdAt: 1 })
    .project<{ raceId: string; createdBy: { name: string } }>({ raceId: 1, createdBy: 1 })
    .toArray();
  return Object.fromEntries(taps.map((t) => [t.raceId, t.createdBy.name]));
}

export type VenueWithCourses = Pick<Venue, "_id" | "name" | "city" | "state"> & { courses: Pick<Course, "_id" | "name" | "activeFromYear" | "activeToYear">[] };

/** The school's venues with their course layouts, for the meet form. */
export async function listVenuesWithCourses(schoolId: string): Promise<VenueWithCourses[]> {
  const db = await getDb();
  const [venues, courses] = await Promise.all([
    collection(db, "venues").find({ schoolId, deletedAt: null }).sort({ name: 1 }).toArray(),
    collection(db, "courses").find({ schoolId, deletedAt: null }).sort({ activeFromYear: 1, name: 1 }).toArray(),
  ]);
  return venues.map((v) => ({
    _id: v._id,
    name: v.name,
    city: v.city,
    state: v.state,
    courses: courses.filter((c) => c.venueId === v._id).map((c) => ({ _id: c._id, name: c.name, activeFromYear: c.activeFromYear, activeToYear: c.activeToYear })),
  }));
}

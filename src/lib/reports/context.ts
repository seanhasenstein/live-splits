import "server-only";
import type { Meet, Program, School, Season } from "@/lib/db/schema";
import { getProgram, getSchool, getSeasonFor, listRoster, type RosterAthlete } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { gradeForSeason } from "@/lib/grade";
import { getTeamHistory, type HistoryRow } from "./history";

/** What every season-level report starts from: the season's meets, its roster and their whole history. */
export type SeasonContext = {
  school: School;
  program: Program;
  season: Season;
  meets: Meet[];
  roster: (RosterAthlete & { grade: number | null })[];
  /** Every race the roster has on file, all seasons. */
  history: HistoryRow[];
  /** Today where the school is. */
  today: string;
};

export async function loadSeasonContext(schoolId: string, onDate?: string): Promise<SeasonContext | null> {
  const school = await getSchool(schoolId);
  const program = school && (await getProgram(school._id, "xc"));
  if (!school || !program) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: school.settings.timeZone }).format(new Date());
  const season = await getSeasonFor(program._id, onDate ?? today);
  if (!season) return null;
  const [meets, roster] = await Promise.all([
    collection(await getDb(), "meets").find({ schoolId, seasonId: season._id, deletedAt: null }).sort({ date: 1 }).toArray(),
    listRoster(season._id),
  ]);
  const history = await getTeamHistory(schoolId, program, roster.map((a) => a._id));
  return {
    school,
    program,
    season,
    meets,
    roster: roster.map((a) => ({ ...a, grade: a.graduationYear !== null ? gradeForSeason(a.graduationYear, season.endDate) : null })),
    history,
    today,
  };
}

/** The distance most of the season's counting races were run at (the 5K), for grids that compare times. */
export function mainDistance(rows: HistoryRow[]): string | null {
  const n = new Map<string, number>();
  for (const r of rows) if (r.distanceId && r.counts) n.set(r.distanceId, (n.get(r.distanceId) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

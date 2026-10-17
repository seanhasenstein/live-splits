import "server-only";
import type { RosterRow } from "@/components/workout-form";
import { getProgram, getSeasonFor, listRoster } from "@/lib/data";
import { fiveKBests } from "@/lib/workouts";

/** The roster and 5K bests the plan form needs, for the season covering `date`. */
export async function workoutFormData(schoolId: string, date: string): Promise<{ roster: RosterRow[]; fiveK: Record<string, { sb: number | null; pr: number | null }> } | null> {
  const program = await getProgram(schoolId, "xc");
  const season = program && (await getSeasonFor(program._id, date));
  if (!program || !season) return null;
  const athletes = await listRoster(season._id);
  const levelLabel = (id: string) => program.settings.levels.find((l) => l.id === id)?.label ?? id;
  const roster = athletes.map((a) => ({ id: a._id, name: a.displayName, gender: a.gender, level: levelLabel(a.defaultLevelId) }));
  return { roster, fiveK: await fiveKBests(schoolId, season._id, roster.map((r) => r.id)) };
}

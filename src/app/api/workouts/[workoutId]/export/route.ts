import { getSession, isSchoolCoach } from "@/lib/auth/session";
import { getProgram, listRoster } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { toCsv } from "@/lib/export";
import { buildWorkoutCsvRows } from "@/lib/workout-export";
import { replayWorkout } from "@/lib/workout-replay";
import { getWorkout } from "@/lib/workouts";

/** A workout as CSV, laid out like the paper sheet. Coaches only, like the meet export. */
export async function GET(_request: Request, { params }: RouteContext<"/api/workouts/[workoutId]/export">) {
  const { workoutId } = await params;
  const session = await getSession();
  const workout = await getWorkout(workoutId);
  if (!workout || !session || workout.schoolId !== session.schoolId) return new Response("Not found", { status: 404 });
  if (!isSchoolCoach(session)) return new Response("Coaches only", { status: 403 });

  const [events, roster, program] = await Promise.all([
    collection(await getDb(), "workoutEvents").find({ workoutId: workout._id }).toArray(),
    listRoster(workout.seasonId),
    getProgram(workout.schoolId, "xc"),
  ]);
  const rows = buildWorkoutCsvRows({
    workout,
    state: replayWorkout(workout, events),
    names: new Map(roster.map((a) => [a._id, a.displayName])),
    precision: program?.settings.timePrecision ?? "tenths",
  });
  const fileName = `${workout.date}-${workout.name}.csv`.replace(/[^\w.-]+/g, "-").toLowerCase();
  // The byte-order mark tells Excel it's UTF-8, so "×" and "·" don't come out garbled.
  return new Response("\uFEFF" + toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

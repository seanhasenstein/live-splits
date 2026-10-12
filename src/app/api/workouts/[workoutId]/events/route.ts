import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { canTimeWorkout } from "@/lib/workout-events";
import { getWorkout } from "@/lib/workouts";

/**
 * A workout's event log and current plan (it can change mid-workout), polled
 * by the record screen and the team view. `?since=<ms>` returns only events
 * stored after that server time; `serverTimeMs` is the next `since`.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/workouts/[workoutId]/events">) {
  const { workoutId } = await params;
  const workout = await getWorkout(workoutId);
  if (!workout) return Response.json({ error: "Workout not found" }, { status: 404 });
  if (!(await canTimeWorkout(workout))) return Response.json({ error: "Not allowed" }, { status: 403 });
  const since = Number(new URL(request.url).searchParams.get("since") ?? 0);
  // Re-send a window so an insert still in flight at the last poll isn't skipped; clients dedupe.
  const serverTimeMs = Date.now() - 5000;
  const events = await collection(await getDb(), "workoutEvents")
    .find(since > 0 ? { workoutId, createdAt: { $gt: new Date(since) } } : { workoutId })
    .sort({ createdAt: 1 })
    .project({ _id: 0, schoolId: 0, schemaVersion: 0 })
    .toArray();
  return Response.json({
    events,
    serverTimeMs,
    workout: { sets: workout.sets, groups: workout.groups, athletes: workout.athletes, finishedAt: workout.finishedAt },
  });
}

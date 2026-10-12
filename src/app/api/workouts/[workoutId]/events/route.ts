import { getSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { canTimeWorkout } from "@/lib/workout-events";
import { getWorkout } from "@/lib/workouts";

/** Someone counts as timing a group while their record screen has polled in this long. */
const PRESENCE_MS = 2 * 60_000;

/**
 * A workout's event log and current plan (it can change mid-workout), polled
 * by the record screen and the team view. `?since=<ms>` returns only events
 * stored after that server time; `serverTimeMs` is the next `since`.
 * `?at=<groupId>` is a record screen saying which group it's timing, so the
 * workout page can show who's on each group (as with race checkpoints).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/workouts/[workoutId]/events">) {
  const { workoutId } = await params;
  const workout = await getWorkout(workoutId);
  if (!workout) return Response.json({ error: "Workout not found" }, { status: 404 });
  if (!(await canTimeWorkout(workout))) return Response.json({ error: "Not allowed" }, { status: 403 });
  const url = new URL(request.url);
  const since = Number(url.searchParams.get("since") ?? 0);
  const db = await getDb();
  const at = url.searchParams.get("at");
  const session = await getSession();
  if (session && at && workout.groups.some((g) => g.id === at)) {
    const p = session.workoutPresence;
    // Refreshed at most every 20 s.
    if (!p || p.workoutId !== workout._id || p.groupId !== at || Date.now() - p.at.getTime() > 20_000) {
      await collection(db, "sessions").updateOne({ _id: session._id }, { $set: { workoutPresence: { workoutId: workout._id, groupId: at, at: new Date() } } });
    }
  }
  const recording = (
    await collection(db, "sessions")
      .find({ "workoutPresence.workoutId": workout._id, "workoutPresence.at": { $gt: new Date(Date.now() - PRESENCE_MS) }, revokedAt: null }, { projection: { name: 1, "workoutPresence.groupId": 1 } })
      .toArray()
  ).map((s) => ({ name: s.name, groupId: s.workoutPresence!.groupId }));
  // Re-send a window so an insert still in flight at the last poll isn't skipped; clients dedupe.
  const serverTimeMs = Date.now() - 5000;
  const events = await collection(db, "workoutEvents")
    .find(since > 0 ? { workoutId, createdAt: { $gt: new Date(since) } } : { workoutId })
    .sort({ createdAt: 1 })
    .project({ _id: 0, schoolId: 0, schemaVersion: 0 })
    .toArray();
  return Response.json({
    events,
    serverTimeMs,
    recording,
    workout: { sets: workout.sets, groups: workout.groups, athletes: workout.athletes, finishedAt: workout.finishedAt },
  });
}

import { z } from "zod";
import { sessionActor } from "@/lib/auth/session";
import { canTimeWorkout, recordWorkoutEvents, WorkoutEventInput } from "@/lib/workout-events";
import { getWorkout } from "@/lib/workouts";

const Body = z.object({ events: z.array(WorkoutEventInput).min(1).max(200) });

/** Phones POST workout events here (one workout per request). Retries are safe. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  const workout = await getWorkout(parsed.data.events[0].workoutId);
  if (!workout) return Response.json({ error: "Workout not found" }, { status: 404 });
  const session = await canTimeWorkout(workout);
  if (!session) return Response.json({ error: "Not allowed" }, { status: 403 });
  const accepted = await recordWorkoutEvents(workout, parsed.data.events, sessionActor(session));
  return Response.json({ accepted, serverTimeMs: Date.now() });
}

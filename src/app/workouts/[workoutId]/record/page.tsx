import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { WorkoutRecorder } from "@/components/workout-recorder";
import { AppHeader, Page } from "@/components/ui";
import { getSession, isSchoolCoach } from "@/lib/auth/session";
import { listRoster } from "@/lib/data";
import { getWorkout } from "@/lib/workouts";

export const metadata: Metadata = { title: "Time workout" };

export default async function RecordWorkoutPage({ params, searchParams }: PageProps<"/workouts/[workoutId]/record">) {
  const { workoutId } = await params;
  const { group } = await searchParams;
  const session = await getSession();
  if (!isSchoolCoach(session)) redirect("/meets");
  const workout = await getWorkout(workoutId);
  if (!workout || workout.schoolId !== session!.schoolId) notFound();
  const roster = await listRoster(workout.seasonId);
  return (
    <>
      <AppHeader back={{ href: `/workouts/${workout._id}`, label: workout.name }} />
      <Page>
        <WorkoutRecorder
          workoutId={workout._id}
          workoutName={workout.name}
          initialPlan={{ sets: workout.sets, groups: workout.groups, athletes: workout.athletes, finishedAt: workout.finishedAt?.toISOString() ?? null }}
          people={roster.map((a) => ({ id: a._id, name: a.displayName }))}
          initialGroupId={typeof group === "string" ? group : null}
        />
      </Page>
    </>
  );
}

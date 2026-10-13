import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SessionMenu } from "@/components/session-menu";
import { WorkoutRecorder } from "@/components/workout-recorder";
import { LayoutDashboard } from "lucide-react";
import { AppHeader, LinkButton, Page } from "@/components/ui";
import { canUseWorkouts, getSession, isSchoolCoach } from "@/lib/auth/session";
import { getWorkout, workoutPeople } from "@/lib/workouts";

export const metadata: Metadata = { title: "Time workout" };

export default async function RecordWorkoutPage({ params, searchParams }: PageProps<"/workouts/[workoutId]/record">) {
  const { workoutId } = await params;
  const { group } = await searchParams;
  const session = await getSession();
  if (!canUseWorkouts(session)) redirect("/meets");
  const workout = await getWorkout(workoutId);
  if (!workout || workout.schoolId !== session!.schoolId) notFound();
  const roster = await workoutPeople(workout);
  return (
    <>
      <AppHeader
        back={{ href: `/workouts/${workout._id}`, label: workout.name }}
        right={
          <div className="flex items-center gap-2">
            <LinkButton href={`/workouts/${workout._id}`} variant="secondary" size="sm">
              <LayoutDashboard className="size-4" />
              Overview
            </LinkButton>
            <SessionMenu name={session!.name} role={isSchoolCoach(session) ? "coach" : "manager"} />
          </div>
        }
      />
      <Page>
        <WorkoutRecorder
          workoutId={workout._id}
          initialPlan={{ sets: workout.sets, groups: workout.groups, athletes: workout.athletes, finishedAt: workout.finishedAt?.toISOString() ?? null }}
          people={roster.map((a) => ({ id: a._id, name: a.displayName }))}
          initialGroupId={typeof group === "string" ? group : null}
        />
      </Page>
    </>
  );
}

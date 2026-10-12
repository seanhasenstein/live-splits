import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { WorkoutForm } from "@/components/workout-form";
import { AppHeader, Page, PageTitle } from "@/components/ui";
import { getSession, isSchoolCoach } from "@/lib/auth/session";
import { toSetInputs } from "@/lib/workout-plan";
import { workoutFormData } from "@/lib/workout-form-data";
import { getWorkout } from "@/lib/workouts";

export const metadata: Metadata = { title: "Edit workout" };

export default async function EditWorkoutPage({ params }: PageProps<"/workouts/[workoutId]/edit">) {
  const { workoutId } = await params;
  const session = await getSession();
  if (!isSchoolCoach(session)) redirect("/meets");
  const workout = await getWorkout(workoutId);
  if (!workout || workout.schoolId !== session!.schoolId) notFound();
  const data = await workoutFormData(session!.schoolId, workout.date);
  if (!data) notFound();
  return (
    <>
      <AppHeader back={{ href: `/workouts/${workout._id}`, label: workout.name }} />
      <Page>
        <PageTitle title="Edit workout" />
        <WorkoutForm
          workoutId={workout._id}
          initial={{
            name: workout.name,
            date: workout.date,
            place: workout.place,
            approximateDistances: workout.approximateDistances,
            effort: workout.effort,
            sets: toSetInputs(workout.sets),
            groups: workout.groups,
            athletes: workout.athletes,
            notes: workout.notes,
            expectedUpdatedAt: workout.updatedAt.getTime(),
          }}
          roster={data.roster}
          fiveK={data.fiveK}
          cancelHref={`/workouts/${workout._id}`}
        />
      </Page>
    </>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WorkoutForm } from "@/components/workout-form";
import { Alert, AppHeader, Page, PageTitle } from "@/components/ui";
import { getSession, isSchoolCoach } from "@/lib/auth/session";
import { getSchool } from "@/lib/data";
import { workoutFormData } from "@/lib/workout-form-data";

export const metadata: Metadata = { title: "New workout" };

export default async function NewWorkoutPage() {
  const session = await getSession();
  if (!isSchoolCoach(session)) redirect("/meets");
  const school = await getSchool(session!.schoolId);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: school?.settings.timeZone ?? "America/Chicago" }).format(new Date());
  const data = await workoutFormData(session!.schoolId, today);
  return (
    <>
      <AppHeader back={{ href: "/workouts", label: "Workouts" }} />
      <Page>
        <PageTitle title="New workout" description="Reps and rests, who's running, and their goals." />
        {!data ? (
          <Alert tone="danger">No XC season covers today.</Alert>
        ) : (
          <WorkoutForm
            workoutId={null}
            initial={{
              name: "",
              date: today,
              place: null,
              approximateDistances: true,
              effort: "vo2",
              sets: [{ count: 12, value: 400, unit: "m", rest: { kind: "time", ms: 60_000 }, restAfter: null }],
              groups: [{ id: "g1", name: "Group 1" }],
              athletes: [],
              notes: null,
            }}
            roster={data.roster}
            fiveK={data.fiveK}
            cancelHref="/workouts"
          />
        )}
      </Page>
    </>
  );
}

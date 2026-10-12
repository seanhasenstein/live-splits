import type { Metadata } from "next";
import { Pencil } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { AppHeader, Card, CardBody, CardHeader, LinkButton, Page, PageTitle, SectionLabel, Time } from "@/components/ui";
import { getSession, isSchoolCoach } from "@/lib/auth/session";
import { listAthletes } from "@/lib/data";
import { describePlan, describeRest, EFFORT_LABEL } from "@/lib/workout-plan";
import { flattenPlan } from "@/lib/workout-replay";
import { getWorkout } from "@/lib/workouts";
import { formatDuration, formatLocalDate } from "@/lib/time";

export const metadata: Metadata = { title: "Workout" };

export default async function WorkoutPage({ params }: PageProps<"/workouts/[workoutId]">) {
  const { workoutId } = await params;
  const session = await getSession();
  if (!isSchoolCoach(session)) redirect("/meets");
  const workout = await getWorkout(workoutId);
  if (!workout || workout.schoolId !== session!.schoolId) notFound();
  const athletes = await listAthletes(workout.schoolId, workout.athletes.map((a) => a.athleteId));
  const nameOf = new Map(athletes.map((a) => [a._id, a.displayName]));
  const reps = flattenPlan(workout);
  const main = reps[0];
  const goalFor = (pace: number | null) => (pace === null ? "—" : formatDuration(Math.round((pace * main.meters) / 1000)));
  const totalKm = reps.reduce((n, r) => n + r.meters, 0) / 1000;

  return (
    <>
      <AppHeader back={{ href: "/workouts", label: "Workouts" }} />
      <Page>
        <PageTitle
          title={workout.name}
          description={`${formatLocalDate(workout.date)}${workout.place ? ` · ${workout.place}` : ""} · ${EFFORT_LABEL[workout.effort]}`}
          action={
            <LinkButton href={`/workouts/${workout._id}/edit`} size="sm" variant="secondary">
              <Pencil className="size-3.5" />
              Edit
            </LinkButton>
          }
        />
        <div className="space-y-4">
          <Card>
            <CardHeader title="Reps" description={`${describePlan(workout.sets)} · ${totalKm.toFixed(totalKm % 1 ? 1 : 0)} km of reps${workout.approximateDistances ? " · distances approximate" : ""}`} />
            <CardBody flush className="divide-y divide-line">
              {workout.sets.map((set, i) => {
                const d = set.reps[0].distance;
                const label = d.unit === "m" ? `${d.value}m` : d.unit === "km" ? `${d.value}K` : `${d.value} ${d.unit}`;
                return (
                  <div key={set.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
                    {workout.sets.length > 1 && <span className="w-12 shrink-0 text-ink-3">Set {i + 1}</span>}
                    <span className="flex-1 font-medium text-ink">{set.reps.length === 1 ? label : `${set.reps.length} × ${label}`}</span>
                    <span className="text-ink-2">
                      {set.reps.length > 1 && describeRest(set.reps[0].rest)}
                      {set.restAfter && `${set.reps.length > 1 ? " · then " : ""}${describeRest(set.restAfter)}`}
                    </span>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          {workout.groups.map((g) => {
            const members = workout.athletes.filter((a) => a.groupId === g.id).sort((a, b) => (a.goalPaceMsPerKm ?? Infinity) - (b.goalPaceMsPerKm ?? Infinity));
            return (
              <Card key={g.id}>
                <CardHeader title={workout.groups.length > 1 ? g.name : "Runners"} action={<span className="text-[13px] text-ink-2">{members.length} runners</span>} />
                <CardBody flush>
                  <div className="flex justify-between border-b border-line px-4 py-1.5">
                    <SectionLabel>Athlete</SectionLabel>
                    <SectionLabel>Goal per {main.label}</SectionLabel>
                  </div>
                  <div className="divide-y divide-line">
                    {members.map((a) => (
                      <div key={a.athleteId} className="flex items-center justify-between px-4 py-2 text-sm">
                        <span className="text-ink">{nameOf.get(a.athleteId) ?? "?"}</span>
                        <Time className="font-medium text-ink">{goalFor(a.goalPaceMsPerKm)}</Time>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            );
          })}

          {workout.notes && (
            <Card>
              <CardHeader title="Notes" />
              <CardBody className="text-sm whitespace-pre-line text-ink-2">{workout.notes}</CardBody>
            </Card>
          )}
        </div>
      </Page>
    </>
  );
}

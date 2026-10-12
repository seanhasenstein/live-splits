import type { Metadata } from "next";
import { Pencil, Timer } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { AppHeader, Card, CardBody, CardHeader, LinkButton, Page, PageTitle } from "@/components/ui";
import { canUseWorkouts, getSession, isSchoolCoach } from "@/lib/auth/session";
import { SessionMenu } from "@/components/session-menu";
import { WorkoutBoard } from "@/components/workout-board";
import { WorkoutFinishButton } from "@/components/workout-finish-button";
import { getProgram, listRoster } from "@/lib/data";
import { describePlan, describeRest, EFFORT_LABEL } from "@/lib/workout-plan";
import { flattenPlan } from "@/lib/workout-replay";
import { getWorkout, lastTimeRan } from "@/lib/workouts";
import { formatLocalDate } from "@/lib/time";

export const metadata: Metadata = { title: "Workout" };

export default async function WorkoutPage({ params }: PageProps<"/workouts/[workoutId]">) {
  const { workoutId } = await params;
  const session = await getSession();
  if (!canUseWorkouts(session)) redirect("/meets");
  const coach = isSchoolCoach(session);
  const workout = await getWorkout(workoutId);
  if (!workout || workout.schoolId !== session!.schoolId) notFound();
  const [roster, program, lastTimes] = await Promise.all([listRoster(workout.seasonId), getProgram(workout.schoolId, "xc"), lastTimeRan(workout)]);
  const levelLabel = (id: string) => program?.settings.levels.find((l) => l.id === id)?.label ?? id;
  const people = roster.map((a) => ({ id: a._id, name: a.displayName, gender: a.gender, level: levelLabel(a.defaultLevelId) }));
  const reps = flattenPlan(workout);
  const totalKm = reps.reduce((n, r) => n + r.meters, 0) / 1000;

  return (
    <>
      <AppHeader back={{ href: "/workouts", label: "Workouts" }} right={<SessionMenu name={session!.name} role={coach ? "coach" : "manager"} />} />
      <Page wide>
        <PageTitle
          title={workout.name}
          description={`${formatLocalDate(workout.date)}${workout.place ? ` · ${workout.place}` : ""} · ${EFFORT_LABEL[workout.effort]}`}
          action={
            coach && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <WorkoutFinishButton workoutId={workout._id} finished={!!workout.finishedAt} />
              <LinkButton href={`/workouts/${workout._id}/edit`} size="sm" variant="secondary">
                <Pencil className="size-3.5" />
                Edit
              </LinkButton>
            </div>
            )
          }
        />
        {workout.finishedAt ? (
          <p className="mb-4 text-sm text-ink-2">Ended at {new Intl.DateTimeFormat("en-US", { timeZone: workout.timeZone, hour: "numeric", minute: "2-digit" }).format(workout.finishedAt)}. Reopen it to time more reps.</p>
        ) : (
          <div className="mb-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(workout.groups.length, 3)}, minmax(0, 1fr))` }}>
            {workout.groups.map((g) => (
              <LinkButton key={g.id} href={`/workouts/${workout._id}/record?group=${g.id}`} size="lg">
                <Timer className="size-4" />
                {workout.groups.length > 1 ? `Time ${g.name}` : "Time it"}
              </LinkButton>
            ))}
          </div>
        )}
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

          <WorkoutBoard
            workoutId={workout._id}
            initialPlan={{ sets: workout.sets, groups: workout.groups, athletes: workout.athletes, finishedAt: workout.finishedAt?.toISOString() ?? null }}
            people={people}
            lastTimes={lastTimes}
          />

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

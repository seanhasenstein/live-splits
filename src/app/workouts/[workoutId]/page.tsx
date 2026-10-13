import type { Metadata } from "next";
import { Download, Pencil, Timer } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { AnchorButton, AppHeader, Card, CardBody, CardHeader, LinkButton, Page, PageTitle } from "@/components/ui";
import { canUseWorkouts, getSession, isSchoolCoach } from "@/lib/auth/session";
import { SessionMenu } from "@/components/session-menu";
import { WorkoutBoard } from "@/components/workout-board";
import { WorkoutFinishButton } from "@/components/workout-finish-button";
import { getProgram, listRoster } from "@/lib/data";
import { conditionsText, describePlan, describeRest, describeTotal, EFFORT_LABEL, surfaceOf, surfaceText } from "@/lib/workout-plan";
import { flattenPlan } from "@/lib/workout-replay";
import { flagCounts, getWorkout, lastTimeRan } from "@/lib/workouts";
import { formatLocalDateLong } from "@/lib/time";

export const metadata: Metadata = { title: "Workout" };

export default async function WorkoutPage({ params }: PageProps<"/workouts/[workoutId]">) {
  const { workoutId } = await params;
  const session = await getSession();
  if (!canUseWorkouts(session)) redirect("/meets");
  const coach = isSchoolCoach(session);
  const workout = await getWorkout(workoutId);
  if (!workout || workout.schoolId !== session!.schoolId) notFound();
  const [roster, program, lastTimes, flags] = await Promise.all([listRoster(workout.seasonId), getProgram(workout.schoolId, "xc"), lastTimeRan(workout), flagCounts([workout._id])]);
  const levelLabel = (id: string) => program?.settings.levels.find((l) => l.id === id)?.label ?? id;
  const people = roster.map((a) => ({ id: a._id, name: a.displayName, gender: a.gender, level: levelLabel(a.defaultLevelId) }));
  const reps = flattenPlan(workout);
  const total = describeTotal(reps.reduce((n, r) => n + r.meters, 0));

  return (
    <>
      <AppHeader back={{ href: "/workouts", label: "Workouts" }} right={<SessionMenu name={session!.name} role={coach ? "coach" : "manager"} />} />
      <Page wide>
        <PageTitle
          title={workout.name}
          description={[formatLocalDateLong(workout.date), workout.place, surfaceText(surfaceOf(workout)), workout.conditions.length ? conditionsText(workout.conditions) : null, EFFORT_LABEL[workout.effort]].filter(Boolean).join(" · ")}
          action={
            coach && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <WorkoutFinishButton workoutId={workout._id} finished={!!workout.finishedAt} toCheck={flags.get(workout._id) ?? 0} />
              <AnchorButton href={`/api/workouts/${workout._id}/export`} size="sm" variant="secondary" download>
                <Download className="size-3.5" />
                CSV
              </AnchorButton>
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
          <div className={`mb-4 grid gap-2 ${workout.groups.length === 1 ? "" : workout.groups.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
            {workout.groups.map((g) => (
              <LinkButton key={g.id} href={`/workouts/${workout._id}/record?group=${g.id}`} size="lg" className="min-w-0">
                <Timer className="size-4 shrink-0" />
                <span className="truncate">{workout.groups.length > 1 ? `Time ${g.name}` : "Time it"}</span>
              </LinkButton>
            ))}
          </div>
        )}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Reps" description={`${describePlan(workout.sets)} · ${total} total`} />
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
            surface={surfaceOf(workout)}
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

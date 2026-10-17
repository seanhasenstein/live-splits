import type { Metadata } from "next";
import { Dumbbell, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { SectionTabs } from "@/components/section-tabs";
import { SessionMenu } from "@/components/session-menu";
import { WorkoutCodePanel } from "@/components/workout-code-panel";
import { AppHeader, Card, CardBody, CardHeader, EmptyState, LinkButton, Page, PageTitle, SectionLabel } from "@/components/ui";
import { decrypt, formatCode } from "@/lib/auth/crypto";
import { canUseWorkouts, getSession, isSchoolCoach } from "@/lib/auth/session";
import { getProgram } from "@/lib/data";
import { describePlan, EFFORT_LABEL } from "@/lib/workout-plan";
import { flagCounts, listWorkouts } from "@/lib/workouts";
import { formatLocalDate } from "@/lib/time";

export const metadata: Metadata = { title: "Workouts" };

export default async function WorkoutsPage() {
  const session = await getSession();
  if (!canUseWorkouts(session)) redirect(session ? "/meets" : "/join");
  const coach = isSchoolCoach(session);
  const [workouts, program] = await Promise.all([listWorkouts(session!.schoolId), coach ? getProgram(session!.schoolId, "xc") : null]);
  const toCheck = await flagCounts(workouts.map((w) => w._id));
  const workoutCode = program?.workoutCode ? decrypt(program.workoutCode.enc) : null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: workouts[0]?.timeZone ?? "America/Chicago" }).format(new Date());
  const upcoming = workouts.filter((w) => w.date >= today && !w.finishedAt).sort((a, b) => a.date.localeCompare(b.date));
  const past = workouts.filter((w) => !(w.date >= today && !w.finishedAt));

  const row = (w: (typeof workouts)[number]) => (
    <a key={w._id} href={`/workouts/${w._id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-2">
        <Dumbbell className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{w.name}</span>
        <span className="block truncate text-[13px] text-ink-2">
          {[formatLocalDate(w.date), describePlan(w.sets) === w.name ? null : describePlan(w.sets), EFFORT_LABEL[w.effort], `${w.athletes.length} runners`].filter(Boolean).join(" · ")}
        </span>
      </span>
      {/* Flagged times still waiting to be checked, so a workout isn't left half-fixed. */}
      {(toCheck.get(w._id) ?? 0) > 0 && (
        <span className="shrink-0 rounded-full border border-gold/40 bg-gold-soft px-2 py-0.5 text-xs font-medium text-ink">⚑ {toCheck.get(w._id)} to check</span>
      )}
    </a>
  );

  return (
    <>
      <AppHeader right={<SessionMenu name={session!.name} role={coach ? "coach" : "manager"} />} />
      <Page>
        {coach && <SectionTabs active="workouts" />}
        <PageTitle
          title="Workouts"
          description={coach ? "Reps timed on phones, against each runner's goal." : "Pick today's workout and the group you're timing."}
          action={
            coach && (
              <LinkButton href="/workouts/new" size="sm">
                <Plus className="size-4" />
                New workout
              </LinkButton>
            )
          }
        />
        {workouts.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Dumbbell />}
              title="No workouts yet"
              description={coach ? "Plan the reps, pick who's running, and time it from any phone." : "A coach plans each workout; it shows up here to time."}
              action={
                coach && (
                  <LinkButton href="/workouts/new" size="sm">
                    New workout
                  </LinkButton>
                )
              }
            />
          </Card>
        ) : (
          <div className="space-y-5">
            {upcoming.length > 0 && (
              <section>
                <SectionLabel className="mb-1.5">Today and coming up</SectionLabel>
                <Card>
                  <div className="divide-y divide-line">{upcoming.map(row)}</div>
                </Card>
              </section>
            )}
            {past.length > 0 && (
              <section>
                <SectionLabel className="mb-1.5">Past workouts</SectionLabel>
                <Card>
                  <div className="divide-y divide-line">{past.map(row)}</div>
                </Card>
              </section>
            )}
          </div>
        )}
        {coach && (
          <Card className="mt-5">
            <CardHeader title="Managers" description="Share the workout code with managers who time practice. They join once and can time any workout, but can't plan, edit or end one, or see meets." />
            <CardBody>
              <WorkoutCodePanel initialCode={workoutCode ? formatCode(workoutCode) : null} />
            </CardBody>
          </Card>
        )}
      </Page>
    </>
  );
}

import type { Metadata } from "next";
import { Dumbbell, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { SectionTabs } from "@/components/section-tabs";
import { SessionMenu } from "@/components/session-menu";
import { AppHeader, Card, EmptyState, LinkButton, Page, PageTitle, SectionLabel } from "@/components/ui";
import { getSession, isSchoolCoach } from "@/lib/auth/session";
import { describePlan, EFFORT_LABEL } from "@/lib/workout-plan";
import { listWorkouts } from "@/lib/workouts";
import { formatLocalDate } from "@/lib/time";

export const metadata: Metadata = { title: "Workouts" };

export default async function WorkoutsPage() {
  const session = await getSession();
  if (!isSchoolCoach(session)) redirect(session ? "/meets" : "/join");
  const workouts = await listWorkouts(session!.schoolId);
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
    </a>
  );

  return (
    <>
      <AppHeader right={<SessionMenu name={session!.name} role="coach" />} />
      <Page>
        <SectionTabs active="workouts" />
        <PageTitle
          title="Workouts"
          description="Reps timed on phones, against each runner's goal."
          action={
            <LinkButton href="/workouts/new" size="sm">
              <Plus className="size-4" />
              New workout
            </LinkButton>
          }
        />
        {workouts.length === 0 ? (
          <Card>
            <EmptyState icon={<Dumbbell />} title="No workouts yet" description="Plan the reps, pick who's running, and time it from any phone." action={<LinkButton href="/workouts/new" size="sm">New workout</LinkButton>} />
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
      </Page>
    </>
  );
}

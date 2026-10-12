import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { X } from "lucide-react";
import { deleteTemplateAction } from "@/app/actions/workouts";
import { WorkoutForm } from "@/components/workout-form";
import { Alert, AppHeader, Card, CardBody, CardHeader, Page, PageTitle } from "@/components/ui";
import { getSession, isSchoolCoach } from "@/lib/auth/session";
import { getProgram, getSchool } from "@/lib/data";
import { workoutFormData } from "@/lib/workout-form-data";
import { describePlan, EFFORT_LABEL, toSetInputs } from "@/lib/workout-plan";
import { listTemplates } from "@/lib/workouts";

export const metadata: Metadata = { title: "New workout" };

export default async function NewWorkoutPage({ searchParams }: PageProps<"/workouts/new">) {
  const session = await getSession();
  if (!isSchoolCoach(session)) redirect("/meets");
  const { template: templateParam } = await searchParams;
  const school = await getSchool(session!.schoolId);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: school?.settings.timeZone ?? "America/Chicago" }).format(new Date());
  const program = await getProgram(session!.schoolId, "xc");
  const [data, templates] = await Promise.all([workoutFormData(session!.schoolId, today), program ? listTemplates(session!.schoolId, program._id) : []]);
  const template = templates.find((t) => t._id === templateParam) ?? null;
  return (
    <>
      <AppHeader back={{ href: "/workouts", label: "Workouts" }} />
      <Page>
        <PageTitle title="New workout" description="Reps and rests, who's running, and their goals." />
        {templates.length > 0 && (
          <Card className="mb-4">
            <CardHeader title="Start from a template" description="Fills in the name, reps, rests and purpose. Who's running and their goals are still yours to pick." />
            <CardBody flush className="divide-y divide-line">
              {templates.map((t) => {
                const active = t._id === template?._id;
                return (
                  <div key={t._id} className={`flex items-center gap-2 pr-2 ${active ? "bg-brand-soft" : ""}`}>
                    {/* Picking one reloads the form with it, so the form's own state starts fresh. */}
                    <Link href={active ? "/workouts/new" : `/workouts/new?template=${t._id}`} className="min-w-0 flex-1 px-4 py-2.5 text-sm hover:bg-surface-2">
                      <span className="block truncate font-medium text-ink">{t.name}</span>
                      <span className="block truncate text-[13px] text-ink-2">
                        {describePlan(t.sets)} · {EFFORT_LABEL[t.effort]}
                        {active && " · in the form below"}
                      </span>
                    </Link>
                    <form action={deleteTemplateAction.bind(null, t._id)}>
                      <button type="submit" className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={`Remove the ${t.name} template`}>
                        <X className="size-4" />
                      </button>
                    </form>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        )}
        {!data ? (
          <Alert tone="danger">No XC season covers today.</Alert>
        ) : (
          <WorkoutForm
            key={template?._id ?? "blank"}
            workoutId={null}
            initial={{
              name: template?.name ?? "",
              date: today,
              place: null,
              approximateDistances: template?.approximateDistances ?? true,
              effort: template?.effort ?? "vo2",
              // Fresh set ids: the workout's reps are its own, not the template's.
              sets: template ? toSetInputs(template.sets).map((s) => ({ ...s, id: undefined })) : [{ count: 12, value: 400, unit: "m", rest: { kind: "time", ms: 60_000 }, restAfter: null }],
              groups: [{ id: "g1", name: "Group 1" }],
              athletes: [],
              notes: null,
              templateId: template?._id ?? null,
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

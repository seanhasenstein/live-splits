import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, ClipboardList, ListOrdered, MapPin, TableProperties, UserRound } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { SectionTabs } from "@/components/section-tabs";
import { SessionMenu } from "@/components/session-menu";
import { AppHeader, Card, CardHeader, LinkButton, ListRow, Page, PageTitle, SectionLabel } from "@/components/ui";
import { getSession, isSchoolCoach, isSchoolWide } from "@/lib/auth/session";
import { loadSeasonContext } from "@/lib/reports/context";
import { formatLocalDate } from "@/lib/time";

export const metadata: Metadata = { title: "Reports" };

/** Every report the team prints or sends, for this season. Each opens as Letter pages with Download PDF. */
export default async function ReportsPage() {
  const session = await getSession();
  if (!session) redirect("/join");
  if (!isSchoolWide(session)) notFound();
  const ctx = await loadSeasonContext(session.schoolId);
  if (!ctx) notFound();
  // Upcoming meets first (soonest first), then this season's past meets, newest first.
  const upcoming = ctx.meets.filter((m) => m.date >= ctx.today);
  const past = ctx.meets.filter((m) => m.date < ctx.today).reverse();

  return (
    <>
      <AppHeader right={<SessionMenu name={session.name} role={isSchoolCoach(session) ? "coach" : "viewer"} />} />
      <Page>
        {isSchoolCoach(session) && <SectionTabs active="reports" />}
        <PageTitle title="Reports" description={`${ctx.season.label} season · each opens ready to print or save as a PDF`} />
        <Card className="mb-4">
          <CardHeader title="Season" />
          <ListRow href="/reports/season-times" icon={<CalendarRange />} title="Season times" description="Every runner by every meet, boys and girls" />
        </Card>
        <Card className="mb-4">
          <CardHeader title="Athletes" description="Each runner's career: every race, by season, with splits and places" />
          {(["F", "M"] as const).map((g) => {
            const group = ctx.roster.filter((a) => a.gender === g).sort((a, b) => a.displayName.localeCompare(b.displayName));
            return group.length === 0 ? null : (
              <div key={g} className="border-t border-line px-4 py-3">
                <SectionLabel className="mb-2">{g === "F" ? "Girls" : "Boys"}</SectionLabel>
                <div className="flex flex-wrap gap-1.5">
                  {group.map((a) => (
                    <Link key={a._id} href={`/athletes/${a._id}`} className="rounded-md border border-line px-2 py-1 text-[13px] text-ink hover:bg-surface-2">
                      {a.displayName}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </Card>
        <Card>
          <CardHeader title="Meet reports" description="After a meet: the meet splits. Before one: the race day sheet, a preview page for each runner, and every earlier race on the course" />
          {[...upcoming, ...past].map((m) => (
            <div key={m._id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3">
              <div className="min-w-0 flex-1 basis-48">
                <div className="truncate text-sm font-medium text-ink">{m.name}</div>
                <div className="text-[13px] text-ink-2">{formatLocalDate(m.date)}</div>
              </div>
              <div className="flex gap-2">
                <LinkButton href={`/meets/${m._id}/reports/splits`} size="sm" variant="secondary">
                  <TableProperties className="size-4" />
                  Meet splits
                </LinkButton>
                <LinkButton href={`/meets/${m._id}/reports/results`} size="sm" variant="secondary">
                  <ListOrdered className="size-4" />
                  Results
                </LinkButton>
                <LinkButton href={`/meets/${m._id}/reports/race-day`} size="sm" variant="secondary">
                  <ClipboardList className="size-4" />
                  Race day sheet
                </LinkButton>
                <LinkButton href={`/meets/${m._id}/reports/previews`} size="sm" variant="secondary">
                  <UserRound className="size-4" />
                  Previews
                </LinkButton>
                <LinkButton href={`/meets/${m._id}/reports/on-this-course`} size="sm" variant="secondary">
                  <MapPin className="size-4" />
                  This course
                </LinkButton>
              </div>
            </div>
          ))}
        </Card>
      </Page>
    </>
  );
}

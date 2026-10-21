import type { Metadata } from "next";
import { CalendarRange, ClipboardList, ListOrdered, Shield, UserRound } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { SearchButton } from "@/components/search";
import { SectionTabs } from "@/components/section-tabs";
import { SessionMenu } from "@/components/session-menu";
import { AppHeader, Card, CardHeader, ListRow, Page, PageTitle } from "@/components/ui";
import { getSession, isSchoolCoach, isSchoolWide } from "@/lib/auth/session";
import { loadSeasonContext } from "@/lib/reports/context";
import { formatLocalDate } from "@/lib/time";

export const metadata: Metadata = { title: "Reports" };

/** The Season section: season-wide reports, and each meet's reports by way of its page. Each report opens as Letter pages with Download PDF. */
export default async function ReportsPage() {
  const session = await getSession();
  if (!session) redirect("/join");
  if (!isSchoolWide(session)) notFound();
  const ctx = await loadSeasonContext(session.schoolId);
  if (!ctx) notFound();
  // Upcoming meets first (soonest first), then this season's past meets, newest first.
  const upcoming = ctx.meets.filter((m) => m.date >= ctx.today);
  const past = ctx.meets.filter((m) => m.date < ctx.today).reverse();

  const label = (m: (typeof ctx.meets)[number]) => (m.date >= ctx.today ? "Race day sheet · previews · this course" : "Results · meet splits · race day sheet");

  return (
    <>
      <AppHeader
        right={
          <div className="flex items-center gap-2">
            <SearchButton />
            <SessionMenu name={session.name} role={isSchoolCoach(session) ? "coach" : "viewer"} />
          </div>
        }
      />
      <Page>
        <SectionTabs active="reports" workouts={isSchoolCoach(session)} />
        <PageTitle title="Season" description={`${ctx.season.label} · every report opens on screen, ready to print or save as a PDF`} />
        <Card className="mb-4">
          <CardHeader title="Season reports" />
          <ListRow href="/reports/season-times" icon={<CalendarRange />} title="Season times" description="Every runner by every meet, boys and girls, with letter points" />
          <ListRow href="/athletes" icon={<UserRound />} title="Athlete profiles" description="Each runner's seasons side by side, meet by meet" />
          {isSchoolCoach(session) && <ListRow href="/reports/logos" icon={<Shield />} title="Team logos" description="Logos beside team names on results" />}
        </Card>
        {upcoming.length > 0 && (
          <Card className="mb-4">
            <CardHeader title="Coming up" description="Before a meet: the race day sheet, a preview for each runner, and every earlier race on the course" />
            {upcoming.map((m) => (
              <ListRow key={m._id} href={`/meets/${m._id}#reports`} icon={<ClipboardList />} title={m.name} description={`${formatLocalDate(m.date)} · ${label(m)}`} />
            ))}
          </Card>
        )}
        {past.length > 0 && (
          <Card>
            <CardHeader title="Meets this season" description="After a meet: the results, every team, and our splits" />
            {past.map((m) => (
              <ListRow key={m._id} href={`/meets/${m._id}#reports`} icon={<ListOrdered />} title={m.name} description={`${formatLocalDate(m.date)} · ${label(m)}`} />
            ))}
          </Card>
        )}
      </Page>
    </>
  );
}

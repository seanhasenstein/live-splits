import type { Metadata } from "next";
import { CalendarRange, ClipboardList } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { SectionTabs } from "@/components/section-tabs";
import { SessionMenu } from "@/components/session-menu";
import { AppHeader, Card, CardHeader, ListRow, Page, PageTitle } from "@/components/ui";
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
        <Card>
          <CardHeader title="Race day sheets" description="Bests and splits on the clock from earlier races, with blank columns for today" />
          {[...upcoming, ...past].map((m) => (
            <ListRow key={m._id} href={`/meets/${m._id}/reports/race-day`} icon={<ClipboardList />} title={m.name} description={formatLocalDate(m.date)} />
          ))}
        </Card>
      </Page>
    </>
  );
}

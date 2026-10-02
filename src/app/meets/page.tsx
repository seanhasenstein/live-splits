import type { Metadata } from "next";
import { CalendarDays, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { SessionMenu } from "@/components/session-menu";
import { AppHeader, Card, EmptyState, LinkButton, ListRow, Page, PageTitle } from "@/components/ui";
import { getSession, isSchoolCoach } from "@/lib/auth/session";
import { listMeets } from "@/lib/data";
import { formatLocalDate } from "@/lib/time";

export const metadata: Metadata = { title: "Meets" };

export default async function MeetsPage() {
  const session = await getSession();
  if (!session) redirect("/join");
  if (!isSchoolCoach(session)) redirect(session.meetId ? `/meets/${session.meetId}` : "/join");

  const meets = await listMeets(session.schoolId);
  return (
    <>
      <AppHeader right={<SessionMenu name={session.name} role="coach" />} />
      <Page>
        <PageTitle
          title="Meets"
          description="This season"
          action={
            <LinkButton href="/meets/new" size="sm">
              <Plus className="size-4" />
              New meet
            </LinkButton>
          }
        />
        <Card>
          {meets.length === 0 ? (
            <EmptyState
              icon={<CalendarDays />}
              title="No meets yet"
              description="Create the next meet, add its races, and share the join codes with your managers."
              action={<LinkButton href="/meets/new" size="sm">New meet</LinkButton>}
            />
          ) : (
            <div className="divide-y divide-line">
              {meets.map((m) => (
                <ListRow key={m._id} icon={<CalendarDays />} title={m.name} meta={formatLocalDate(m.date)} href={`/meets/${m._id}`} />
              ))}
            </div>
          )}
        </Card>
      </Page>
    </>
  );
}

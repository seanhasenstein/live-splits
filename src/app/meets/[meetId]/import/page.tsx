import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ImportWizard } from "@/components/import-wizard";
import { AppHeader, Page, PageTitle } from "@/components/ui";
import { can, getSession } from "@/lib/auth/session";
import { getMeet, getSchool, listRaces, listRoster } from "@/lib/data";

export const metadata: Metadata = { title: "Import results" };

export default async function ImportPage({ params }: PageProps<"/meets/[meetId]/import">) {
  const { meetId } = await params;
  const session = await getSession();
  if (!session) redirect("/join");
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "export", meet)) notFound();
  const [races, roster, school] = await Promise.all([listRaces(meet._id), listRoster(meet.seasonId), getSchool(meet.schoolId)]);

  return (
    <>
      <AppHeader back={{ href: `/meets/${meet._id}`, label: meet.name }} />
      <Page>
        <PageTitle title="Import official results" description="From the timing company's link, pasted text, or a PDF. Official times then replace app taps on every screen." />
        <ImportWizard
          meetId={meet._id}
          races={races.map((r) => ({ id: r._id, name: r.name, athleteIds: r.lineup.map((l) => l.athleteId), hasOfficial: !!r.officialImportId }))}
          athletes={roster.map((a) => ({ _id: a._id, displayName: a.displayName, officialName: a.officialName, aliases: a.aliases }))}
          teamAliases={school?.settings.teamAliases ?? []}
        />
      </Page>
    </>
  );
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { updateMeetAction } from "@/app/actions/meets";
import { MeetForm } from "@/components/meet-form";
import { AppHeader, Page, PageTitle } from "@/components/ui";
import { can, getSession } from "@/lib/auth/session";
import { getMeet, getSchool, listVenuesWithCourses } from "@/lib/data";

export const metadata: Metadata = { title: "Edit meet" };

export default async function EditMeetPage({ params }: PageProps<"/meets/[meetId]/edit">) {
  const { meetId } = await params;
  const session = await getSession();
  if (!session) redirect("/join");
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "setup", meet)) notFound();
  const [school, venues] = await Promise.all([getSchool(meet.schoolId), listVenuesWithCourses(meet.schoolId)]);
  const venue = venues.find((v) => v._id === meet.venueId);

  return (
    <>
      <AppHeader back={{ href: `/meets/${meet._id}`, label: meet.name }} />
      <Page>
        <PageTitle title="Edit meet" description="Races, lineups and recorded times are not affected." />
        <MeetForm
          action={updateMeetAction.bind(null, meet._id)}
          venues={venues}
          defaultTimeZone={school?.settings.timeZone ?? "America/Chicago"}
          defaultState={school?.state ?? ""}
          meet={{
            name: meet.name,
            date: meet.date,
            timeZone: meet.timeZone,
            venueName: venue?.name ?? "",
            venueCity: venue?.city ?? "",
            venueState: venue?.state ?? "",
            courseId: meet.courseId,
          }}
          cancelHref={`/meets/${meet._id}`}
        />
      </Page>
    </>
  );
}

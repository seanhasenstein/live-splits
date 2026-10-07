import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createMeetAction } from "@/app/actions/meets";
import { MeetForm } from "@/components/meet-form";
import { AppHeader, Page, PageTitle } from "@/components/ui";
import { getSession, isSchoolCoach } from "@/lib/auth/session";
import { getSchool, listVenuesWithCourses } from "@/lib/data";

export const metadata: Metadata = { title: "New meet" };

export default async function NewMeetPage() {
  const session = await getSession();
  if (!isSchoolCoach(session)) redirect("/");
  const [school, venues] = await Promise.all([getSchool(session!.schoolId), listVenuesWithCourses(session!.schoolId)]);
  return (
    <>
      <AppHeader back={{ href: "/meets", label: "Meets" }} />
      <Page>
        <PageTitle title="New meet" description="Races and lineups come next." />
        <MeetForm
          action={createMeetAction}
          venues={venues}
          defaultTimeZone={school?.settings.timeZone ?? "America/Chicago"}
          defaultState={school?.state ?? ""}
          meet={null}
          cancelHref="/meets"
        />
      </Page>
    </>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MeetForm } from "@/components/meet-form";
import { AppHeader, Page, PageTitle } from "@/components/ui";
import { getSession, isSchoolCoach } from "@/lib/auth/session";
import { getSchool } from "@/lib/data";

export const metadata: Metadata = { title: "New meet" };

export default async function NewMeetPage() {
  const session = await getSession();
  if (!isSchoolCoach(session)) redirect("/");
  const school = await getSchool(session!.schoolId);
  return (
    <>
      <AppHeader back={{ href: "/meets", label: "Meets" }} />
      <Page>
        <PageTitle title="New meet" description="Races and lineups come next." />
        <MeetForm defaultTimeZone={school?.settings.timeZone ?? "America/Chicago"} defaultState={school?.state ?? ""} />
      </Page>
    </>
  );
}

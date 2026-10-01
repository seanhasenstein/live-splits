import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MeetForm } from "@/components/meet-form";
import { Page } from "@/components/ui";
import { getSession, isSchoolCoach } from "@/lib/auth/session";
import { getSchool } from "@/lib/data";

export const metadata: Metadata = { title: "New meet" };

export default async function NewMeetPage() {
  const session = await getSession();
  if (!isSchoolCoach(session)) redirect("/");
  const school = await getSchool(session!.schoolId);
  return (
    <Page title="New meet" back={{ href: "/meets", label: "Meets" }}>
      <MeetForm defaultTimeZone={school?.settings.timeZone ?? "America/Chicago"} defaultState={school?.state ?? ""} />
    </Page>
  );
}

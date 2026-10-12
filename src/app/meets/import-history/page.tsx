import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HistoryImportWizard } from "@/components/history-import-wizard";
import { AppHeader, Page, PageTitle } from "@/components/ui";
import { getSession, isSchoolCoach } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Import past seasons" };
/** Reading a big PDF and writing years of meets takes longer than a page view. */
export const maxDuration = 60;

export default async function ImportHistoryPage() {
  const session = await getSession();
  if (!isSchoolCoach(session)) redirect("/meets");
  return (
    <>
      <AppHeader back={{ href: "/meets", label: "Meets" }} />
      <Page>
        <PageTitle title="Import past seasons" description="The team's split sheets, one PDF for years of meets. Each meet becomes a past meet with its races and results. You'll see everything before it's written." />
        <HistoryImportWizard />
      </Page>
    </>
  );
}

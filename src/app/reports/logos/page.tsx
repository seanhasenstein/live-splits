import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { removeLogo } from "@/app/actions/logos";
import { LogoUpload } from "@/components/logo-upload";
import { TeamMark } from "@/components/rpt/team-mark";
import { AppHeader, Card, CardHeader, Page, PageTitle } from "@/components/ui";
import { getSession, isSchoolCoach } from "@/lib/auth/session";
import { getSchool } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { logoKey } from "@/lib/logos";
import { getLogoVersions } from "@/lib/logos-server";

export const metadata: Metadata = { title: "Team logos" };

/** Every team in our imported results, with its logo or a way to add one. Coaches only. */
export default async function LogosPage() {
  const session = await getSession();
  if (!session) redirect("/join");
  if (!isSchoolCoach(session)) notFound();
  const db = await getDb();
  const [school, names, stored, logos] = await Promise.all([
    getSchool(session.schoolId),
    collection(db, "raceEntries").distinct("teamName", { schoolId: session.schoolId, deletedAt: null }),
    collection(db, "teamLogos")
      .find({ schoolId: session.schoolId, deletedAt: null }, { projection: { key: 1, name: 1 } })
      .toArray(),
    getLogoVersions(session.schoolId),
  ]);
  const ourKeys = new Set([school?.name, school?.shortName].filter((x): x is string => !!x).map(logoKey));
  // One row per team: the spelling results use most, plus logos added for teams not in results yet.
  const teams = new Map<string, string>();
  for (const n of names) if (n && !teams.has(logoKey(n))) teams.set(logoKey(n), n);
  for (const l of stored) if (!teams.has(l.key)) teams.set(l.key, l.name);
  const rows = [...teams]
    .filter(([k]) => !ourKeys.has(k))
    .sort((a, b) => a[1].localeCompare(b[1]));
  const missing = rows.filter(([k]) => !logos.has(k)).length;

  return (
    <>
      <AppHeader back={{ href: "/reports", label: "Season" }} title="Team logos" />
      <Page>
        <PageTitle title="Team logos" description={`Shown beside team names on results. ${missing ? `${missing} of ${rows.length} teams still show initials.` : "Every team has one."}`} />
        <Card className="mb-4">
          <CardHeader title="Teams in our results" description="Any image works: it's trimmed and sized for you. Our own shield is used for us." />
          {rows.map(([key, name]) => (
            <div key={key} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5">
              <span className="rpt flex items-center">
                <TeamMark name={name} schoolId={session.schoolId} logos={logos} size={32} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{name}</span>
              <div className="flex items-center gap-2">
                <LogoUpload name={name} label={logos.has(key) ? "Replace" : "Upload"} />
                {logos.has(key) && (
                  <form action={removeLogo}>
                    <input type="hidden" name="key" value={key} />
                    <button type="submit" className="h-8 rounded-md px-2 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                      Remove
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))}
          {rows.length === 0 && <p className="border-t border-line px-4 py-6 text-center text-sm text-ink-2">No other teams yet. Import a meet&apos;s official results and every team in them shows up here.</p>}
        </Card>
        <Card>
          <CardHeader title="Another team" description="A team we haven't raced yet (a sectional or state opponent)." />
          <div className="border-t border-line px-4 py-3">
            <LogoUpload label="Choose image" />
          </div>
        </Card>
      </Page>
    </>
  );
}

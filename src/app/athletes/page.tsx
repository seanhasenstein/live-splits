import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SearchButton } from "@/components/search";
import { SectionTabs } from "@/components/section-tabs";
import { SessionMenu } from "@/components/session-menu";
import { AppHeader, Card, CardHeader, Page, PageTitle } from "@/components/ui";
import { getSession, isSchoolCoach, isSchoolWide } from "@/lib/auth/session";
import { mainDistance, loadSeasonContext } from "@/lib/reports/context";
import { formatElapsed } from "@/lib/time";

export const metadata: Metadata = { title: "Athletes" };

const t = (ms: number | null) => (ms === null ? "—" : formatElapsed(Math.floor(ms / 1000) * 1000, "seconds"));

/** This season's roster, girls and boys, with each runner's bests; each opens their athlete profile. */
export default async function AthletesPage() {
  const session = await getSession();
  if (!session) redirect("/join");
  if (!isSchoolWide(session)) notFound();
  const coach = isSchoolCoach(session);
  const ctx = await loadSeasonContext(session.schoolId);
  if (!ctx) notFound();
  const distanceId = mainDistance(ctx.history);
  const timed = ctx.history.filter((r) => r.distanceId === distanceId && r.counts && r.status === "finished" && r.finishMs !== null);
  const best = (rows: typeof timed) => rows.reduce<number | null>((b, r) => (b === null || r.finishMs! < b ? r.finishMs : b), null);
  const stats = (id: string) => {
    const mine = timed.filter((r) => r.athleteId === id);
    const season = mine.filter((r) => r.seasonId === ctx.season._id);
    const sb = best(season);
    const pr = best(mine);
    return {
      sb,
      pr,
      races: season.length,
      prThisSeason: sb !== null && sb === pr && mine.some((r) => r.seasonId !== ctx.season._id),
    };
  };

  return (
    <>
      <AppHeader
        right={
          <div className="flex items-center gap-2">
            <SearchButton />
            <SessionMenu name={session.name} role={coach ? "coach" : "viewer"} />
          </div>
        }
      />
      <Page wide>
        <SectionTabs active="athletes" workouts={coach} />
        <PageTitle title="Athletes" description={`${ctx.season.label} roster · open a runner for every race, chart and split`} />
        <div className="grid gap-4 md:grid-cols-2">
          {(["F", "M"] as const).map((g) => {
            const group = ctx.roster
              .filter((a) => a.gender === g)
              .map((a) => ({ a, s: stats(a._id) }))
              // Fastest this season first; runners without a time yet at the end, by name.
              .sort((x, y) => (x.s.sb ?? Infinity) - (y.s.sb ?? Infinity) || x.a.displayName.localeCompare(y.a.displayName));
            if (group.length === 0) return null;
            return (
              <Card key={g} className="overflow-hidden">
                <CardHeader title={g === "F" ? "Girls" : "Boys"} description={`${group.length} runners`} />
                <table className="w-full border-t border-line text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                      <th className="py-2 pl-4 font-semibold">Runner</th>
                      <th className="py-2 pr-3 text-right font-semibold">{ctx.season.label}</th>
                      <th className="py-2 pr-3 text-right font-semibold">Career</th>
                      <th className="py-2 pr-4 text-right font-semibold max-sm:hidden">Races</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.map(({ a, s }) => (
                      <tr key={a._id} className="border-t border-line hover:bg-surface-2">
                        <td className="py-0 pl-4">
                          <Link href={`/athletes/${a._id}`} className="flex items-baseline gap-2 py-2.5 font-medium text-ink">
                            {a.displayName}
                            {a.grade !== null && a.grade <= 12 && <span className="text-xs font-normal text-ink-3">Gr {a.grade}</span>}
                          </Link>
                        </td>
                        <td className={`py-2.5 pr-3 text-right ${s.prThisSeason ? "font-semibold text-gold-text" : "text-ink"}`}>{t(s.sb)}</td>
                        <td className="py-2.5 pr-3 text-right text-ink-2">{t(s.pr)}</td>
                        <td className="py-2.5 pr-4 text-right text-ink-2 max-sm:hidden">{s.races}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            );
          })}
        </div>
        <p className="mt-4 text-[13px] text-ink-2">Gold: a career best run this season. Looking for someone from another year or another school? Use search.</p>
      </Page>
    </>
  );
}

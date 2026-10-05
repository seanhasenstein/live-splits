import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AppHeader, Badge, Card, CardHeader, EmptyState, LinkButton, Page, PageTitle, Stat, Time } from "@/components/ui";
import { can, getSession } from "@/lib/auth/session";
import { getMeet, getRace, listAthletes, listRaces } from "@/lib/data";
import { getRaceState } from "@/lib/race-state";
import { compareRace } from "@/lib/results/compare";
import { getOfficialTimes } from "@/lib/results/import";
import { formatElapsed } from "@/lib/time";

export const metadata: Metadata = { title: "App vs official" };

const signed = (ms: number) => `${ms < 0 ? "−" : "+"}${formatElapsed(Math.abs(ms))}`;

export default async function ComparePage({ params, searchParams }: PageProps<"/meets/[meetId]/compare">) {
  const { meetId } = await params;
  const { race: raceParam } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/join");
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "export", meet)) notFound();
  const races = await listRaces(meet._id);
  const race = (typeof raceParam === "string" ? await getRace(raceParam) : null) ?? races.find((r) => r.officialImportId) ?? races[0];
  if (!race || race.meetId !== meet._id) notFound();

  const [state, official, athletes] = await Promise.all([
    getRaceState(race),
    getOfficialTimes(race),
    listAthletes(
      meet.schoolId,
      race.lineup.map((l) => l.athleteId),
    ),
  ]);
  const name = new Map(athletes.map((a) => [a._id, a.displayName]));
  const { rows, summary } = compareRace(race, state, official);
  const hasOfficial = Object.keys(official).length > 0;

  return (
    <>
      <AppHeader back={{ href: `/meets/${meet._id}`, label: meet.name }} />
      <Page wide>
        <PageTitle
          title="App vs official"
          description={`${race.name} · how close the taps were to the mats. Error is app − official; + means the tap was late.`}
          action={
            races.length > 1 ? (
              <div className="flex gap-1">
                {races.map((r) => (
                  <LinkButton key={r._id} href={`/meets/${meet._id}/compare?race=${r._id}`} size="sm" variant={r._id === race._id ? "primary" : "secondary"}>
                    {r.name}
                  </LinkButton>
                ))}
              </div>
            ) : undefined
          }
        />

        {!hasOfficial ? (
          <Card>
            <EmptyState title="No official results yet" description="Import the timing company's results first." action={<LinkButton href={`/meets/${meet._id}/import`} size="sm">Import results</LinkButton>} />
          </Card>
        ) : !race.gunTimeMs ? (
          <Card>
            <EmptyState title="No gun time" description="App times can't be compared without a gun. Set it on the meet page (Adjust → from official results)." />
          </Card>
        ) : (
          <>
            <Card className="mb-4">
              <CardHeader title="Accuracy" description="Mean and worst absolute error, and the average bias, per checkpoint." />
              <div className="divide-y divide-line border-t border-line">
                {summary.map((s) => (
                  <div key={s.checkpointId} className="grid grid-cols-3 items-center gap-4 px-4 py-3 sm:grid-cols-[6rem_1fr_1fr_1fr]">
                    <div className="col-span-3 text-sm font-semibold text-ink sm:col-span-1">{s.label}</div>
                    <Stat value={s.meanAbsMs === null ? "—" : formatElapsed(s.meanAbsMs)} label="mean error" tone={s.meanAbsMs !== null && s.meanAbsMs <= 1000 ? "brand" : "ink"} />
                    <Stat value={s.maxAbsMs === null ? "—" : formatElapsed(s.maxAbsMs)} label="worst" />
                    <Stat value={s.meanMs === null ? "—" : signed(s.meanMs)} label={`bias · ${s.n} runner${s.n === 1 ? "" : "s"}`} />
                  </div>
                ))}
              </div>
            </Card>

            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
                    <th className="px-4 py-2 font-semibold">Athlete</th>
                    {race.checkpoints.map((c) => (
                      <th key={c.id} className="px-3 py-2 text-right font-semibold">
                        {c.label}
                        <span className="block text-[10px] font-normal tracking-normal normal-case text-ink-3">app · official · error</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.athleteId}>
                      <td className="px-4 py-2 align-top font-medium text-ink">
                        {name.get(r.athleteId) ?? r.athleteId}
                        {official[r.athleteId]?.status && official[r.athleteId].status !== "finished" && (
                          <Badge tone="neutral">{official[r.athleteId].status.toUpperCase()}</Badge>
                        )}
                      </td>
                      {r.cells.map((c, i) => (
                        <td key={race.checkpoints[i].id} className="px-3 py-2 text-right align-top">
                          <Time className="block">
                            {c.appMs === null ? "—" : formatElapsed(c.appMs)}
                            {c.estimate ? "~" : c.edited ? "*" : ""}
                          </Time>
                          <Time className="block text-ink-2">{c.officialMs === null ? "—" : formatElapsed(c.officialMs)}</Time>
                          <Time className={`block text-[13px] font-medium ${c.errorMs === null ? "text-ink-3" : Math.abs(c.errorMs) <= 1000 ? "text-brand-bright" : Math.abs(c.errorMs) <= 3000 ? "text-gold-text" : "text-danger"}`}>
                            {c.errorMs === null ? "—" : signed(c.errorMs)}
                          </Time>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <p className="mt-3 text-xs text-ink-3">* edited &nbsp; ~ estimate &nbsp; Green within 1s, amber within 3s.</p>
          </>
        )}
      </Page>
    </>
  );
}

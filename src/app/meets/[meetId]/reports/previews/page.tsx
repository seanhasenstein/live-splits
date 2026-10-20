import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AthleteRacesTable, KpiStrip } from "@/components/report/athlete-races";
import { ReportShell, Sheet, SheetSection, td, teamBrand, th } from "@/components/report/report";
import { TimeChart } from "@/components/report/time-chart";
import { can, getSession } from "@/lib/auth/session";
import { getMeet, getProgram, getSchool, getSeasonFor, listRaces } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { gradeForSeason } from "@/lib/grade";
import { type AthleteRace, summarizeAthlete, worthKnowing } from "@/lib/reports/athlete";
import { getTeamHistory, seriesOf } from "@/lib/reports/history";
import { formatElapsed, formatLocalDateLong } from "@/lib/time";

export const metadata: Metadata = { title: "Race previews" };

/** Race Preview: one Letter page per runner in each race with a lineup, looking back from this meet. */
export default async function PreviewsPage({ params, searchParams }: PageProps<"/meets/[meetId]/reports/previews">) {
  const { meetId } = await params;
  const { race: onlyRace } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/join");
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "view", meet)) notFound();
  const [school, program, races] = await Promise.all([getSchool(meet.schoolId), getProgram(meet.schoolId, "xc"), listRaces(meet._id)]);
  if (!school || !program) notFound();
  const withLineup = races.filter((r) => r.lineup.length > 0 && (typeof onlyRace !== "string" || r._id === onlyRace));
  const db = await getDb();
  // Every athlete the school has, alumni too: team places in older races count everyone who ran.
  const [athletes, season, venue] = await Promise.all([
    collection(db, "athletes").find({ schoolId: meet.schoolId, deletedAt: null }).toArray(),
    getSeasonFor(program._id, meet.date),
    meet.venueId ? collection(db, "venues").findOne({ _id: meet.venueId }) : null,
  ]);
  const history = await getTeamHistory(meet.schoolId, program, athletes.map((a) => a._id));
  const byId = new Map(athletes.map((a) => [a._id, a]));
  const team = teamBrand(school);
  const mascot = (school.mascot ?? school.shortName).replace(/s$/, "");
  const t = (ms: number | null) => (ms === null ? "—" : formatElapsed(ms, "seconds"));
  const series = seriesOf(meet);

  return (
    <ReportShell back={{ href: `/meets/${meet._id}`, label: meet.name }} title="Race previews" subtitle={meet.name}>
      {withLineup.length === 0 && <p className="no-print mx-auto max-w-xl px-4 text-sm text-ink-2">No race in this meet has a lineup yet. Add runners to a race and their previews appear here.</p>}
      {withLineup.flatMap((race) => {
        const splitLabels = race.checkpoints.filter((c) => c.kind === "split").map((c) => ({ label: c.label, meters: c.distance.meters }));
        const finishMeters = race.checkpoints.find((c) => c.kind === "finish")?.distance.meters ?? null;
        const people = race.lineup.map((l) => {
          const s = summarizeAthlete({ athleteId: l.athleteId, rows: history, teamRows: history, distanceId: race.distanceId, seasonId: meet.seasonId, courseId: meet.courseId, before: meet.date });
          return { id: l.athleteId, s };
        });
        // Fastest season best first, as the team would line up.
        people.sort((a, b) => (a.s.seasonBest?.finishMs ?? a.s.careerBest?.finishMs ?? Infinity) - (b.s.seasonBest?.finishMs ?? b.s.careerBest?.finishMs ?? Infinity));
        return people.map(({ id, s }) => {
          const a = byId.get(id);
          const grade = a?.graduationYear != null && season ? gradeForSeason(a.graduationYear, season.endDate) : null;
          const facts = worthKnowing(s, { series, team: mascot });
          const refs = [
            { r: [...s.races].reverse().find((r) => r.series === series && r.seasonId !== meet.seasonId && r.finishMs !== null), note: "last year here" },
            { r: s.seasonBest, note: "season best" },
            { r: s.lastRace, note: "last race" },
          ].filter((x, i, all): x is { r: AthleteRace; note: string } => !!x.r && all.findIndex((y) => y.r?.raceId === x.r!.raceId) === i);
          return (
            <Sheet
              key={`${race._id}-${id}`}
              team={team}
              header={{
                kicker: (
                  <>
                    Race preview · <span className="text-[var(--r-gold-text)]">{meet.name}</span>
                  </>
                ),
                title: a?.displayName ?? "?",
                subline: (
                  <>
                    {grade !== null && <span className="font-semibold text-[var(--r-ink)]">Grade {grade} · </span>}
                    {race.name} · {venue ? `${venue.name} · ` : ""}
                    {formatLocalDateLong(meet.date)}
                  </>
                ),
              }}
              legend={
                <>
                  <span className="font-semibold text-[var(--r-green-text)]">Green row</span>: career best. <span className="font-semibold text-[var(--r-gold-text)]">Gold row</span>: season best. Splits are each mile on its own; On the clock is time
                  from the gun. Team: place among our runners in that race.
                </>
              }
              tag={`${meet.name} · ${race.name}`}
            >
              <KpiStrip
                items={[
                  { label: "Career best", value: t(s.careerBest?.finishMs ?? null), note: s.careerBest?.label, tone: "green" },
                  { label: `${meet.date.slice(0, 4)} best`, value: t(s.seasonBest?.finishMs ?? null), note: s.seasonBest?.label, tone: "gold" },
                  { label: "Last race", value: t(s.lastRace?.finishMs ?? null), note: s.lastRace?.label },
                  { label: "Best on this course", value: t(s.courseBest?.finishMs ?? null), note: s.courseBest ? s.courseBest.label : "first time here" },
                ]}
              />
              {s.onCourse.length > 0 && (
                <SheetSection title="On this course">
                  <AthleteRacesTable races={s.onCourse} splitLabels={splitLabels} finishMeters={finishMeters} showVsPrev={false} />
                </SheetSection>
              )}
              <SheetSection title="This season">
                {s.season.length > 0 ? <AthleteRacesTable races={s.season} splitLabels={splitLabels} finishMeters={finishMeters} /> : <p className="text-[10.5px] text-[var(--r-ink-2)]">No races yet this season.</p>}
              </SheetSection>
              {refs.length > 0 && (
                <SheetSection title="On the clock">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={th}>Race</th>
                        {splitLabels.map((c) => (
                          <th key={c.label} className={`${th} text-right`}>
                            {c.label}
                          </th>
                        ))}
                        <th className={`${th} text-right`}>Finish</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refs.map(({ r, note }) => (
                        <tr key={r.raceId}>
                          <td className={`${td} pr-2`}>
                            <span className="font-medium">{r.label}</span> <span className="text-[var(--r-ink-3)]">{note}</span>
                          </td>
                          {splitLabels.map((c) => (
                            <td key={c.label} className={`${td} text-right text-[var(--r-ink-2)]`}>
                              {t(r.splits.find((x) => Math.abs(x.meters - c.meters) <= 50)?.ms ?? null)}
                            </td>
                          ))}
                          <td className={`${td} text-right font-semibold`}>{t(r.finishMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SheetSection>
              )}
              {s.season.filter((r) => r.finishMs !== null).length >= 2 && (
                <SheetSection title="Season so far" aside="faster is higher">
                  <TimeChart
                    points={s.season
                      .filter((r) => r.finishMs !== null)
                      .map((r) => ({ label: r.label.slice(4), sub: r.levelId === "jv" ? "JV" : undefined, ms: r.finishMs!, mark: r.sb ? "gold" : meet.courseId && r.courseId === meet.courseId ? "ring" : undefined }))}
                  />
                </SheetSection>
              )}
              {facts.length > 0 && (
                <SheetSection title="Worth knowing">
                  <ul className="space-y-1 text-[11px] leading-snug">
                    {facts.map((f) => (
                      <li key={f} className="flex gap-2">
                        <span aria-hidden className="mt-[5px] size-1.5 shrink-0 rounded-full bg-[var(--r-gold)]" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </SheetSection>
              )}
            </Sheet>
          );
        });
      })}
    </ReportShell>
  );
}

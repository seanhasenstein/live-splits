import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AthleteRacesTable } from "@/components/report/athlete-races";
import { KpiStrip, MeetLine, ReportShell, Sheet, SheetSection, TableWrap, td, teamBrand, th } from "@/components/report/report";
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
  const t = (ms: number | null | undefined) => (ms == null ? "—" : formatElapsed(ms, "seconds"));
  const series = seriesOf(meet);
  const year = meet.date.slice(0, 4);
  const updated = formatLocalDateLong(new Date().toISOString().slice(0, 10)).replace(/^[A-Za-z]+, /, "");
  const kpiNote = (r: AthleteRace | null) => (r ? `${r.date.slice(0, 4)} ${r.meetShort}` : undefined);

  return (
    <ReportShell back={{ href: `/meets/${meet._id}`, label: meet.name }} title="Race previews" subtitle={meet.name}>
      {withLineup.length === 0 && <p className="no-print mx-auto max-w-xl px-4 text-sm text-ink-2">No race in this meet has a lineup yet. Add runners to a race and their previews appear here.</p>}
      {withLineup.flatMap((race) => {
        const splitLabels = race.checkpoints.filter((c) => c.kind === "split").map((c) => ({ label: c.label, meters: c.distance.meters }));
        const finishMeters = race.checkpoints.find((c) => c.kind === "finish")?.distance.meters ?? null;
        const people = race.lineup.map((l) => ({
          id: l.athleteId,
          s: summarizeAthlete({ athleteId: l.athleteId, rows: history, teamRows: history, distanceId: race.distanceId, seasonId: meet.seasonId, courseId: meet.courseId, before: meet.date }),
        }));
        // Fastest season best first, as the team would line up.
        people.sort((a, b) => (a.s.seasonBest?.finishMs ?? a.s.careerBest?.finishMs ?? Infinity) - (b.s.seasonBest?.finishMs ?? b.s.careerBest?.finishMs ?? Infinity));
        return people.map(({ id, s }) => {
          const a = byId.get(id);
          const grade = a?.graduationYear != null && season ? gradeForSeason(a.graduationYear, season.endDate) : null;
          const facts = worthKnowing(s, { series, team: mascot });
          const refs = [
            { r: [...s.races].reverse().find((r) => r.series === series && r.seasonId !== meet.seasonId && r.finishMs !== null), note: (r: AthleteRace) => `${r.meetShort} ${r.date.slice(0, 4)}${meet.courseId && r.courseId === meet.courseId ? " · this course" : ""}` },
            { r: s.seasonBest, note: (r: AthleteRace) => `${year} best · ${r.meetShort}` },
            { r: s.lastRace, note: (r: AthleteRace) => `Last race · ${r.meetShort}` },
          ].filter((x, i, all): x is { r: AthleteRace; note: (r: AthleteRace) => string } => !!x.r && all.findIndex((y) => y.r?.raceId === x.r!.raceId) === i);
          const courseYears = [...new Set(s.onCourse.map((r) => r.date.slice(0, 4)))];
          return (
            <Sheet
              key={`${race._id}-${id}`}
              team={team}
              header={{ title: "Race Preview", subline: <MeetLine meet={meet.name} venue={venue?.name} date={formatLocalDateLong(meet.date)} /> }}
              legend={
                <>
                  <span className="font-bold text-[var(--r-green)]">Green row</span> career best · <span className="font-bold text-[var(--r-gold-text)]">Gold row</span> season best · Place = overall in that race (JV = JV race) · courses differ, so compare
                  times across meets with care · times truncated to whole seconds
                </>
              }
              tag={`Updated ${updated}`}
            >
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
                <span className="text-[30px] leading-none font-extrabold tracking-tight max-sm:text-[24px]">{a?.displayName ?? "?"}</span>
                <span className="text-[13px] text-[var(--r-ink-2)]">
                  {grade !== null && grade <= 12 ? `Grade ${grade} · ` : ""}
                  {race.name} race
                </span>
              </div>
              <KpiStrip
                items={[
                  { label: "Career best", value: t(s.careerBest?.finishMs), note: kpiNote(s.careerBest), tone: "green" },
                  { label: `${year} best`, value: t(s.seasonBest?.finishMs), note: kpiNote(s.seasonBest)?.slice(5), tone: "gold" },
                  { label: "Last race", value: t(s.lastRace?.finishMs), note: s.lastRace?.meetShort },
                  { label: "Best on this course", value: t(s.courseBest?.finishMs), note: s.courseBest ? s.courseBest.date.slice(0, 4) : "first time here" },
                ]}
              />
              {s.onCourse.length > 0 && (
                <SheetSection title="On this course" note={`${venue?.name ?? "this course"} · every race here in ${courseYears.join(", ").replace(/, ([^,]*)$/, " and $1")}`}>
                  <TableWrap>
                    <AthleteRacesTable races={s.onCourse} splitLabels={splitLabels} finishMeters={finishMeters} label={(r) => `${r.date.slice(0, 4)} ${r.meetName}`} />
                  </TableWrap>
                </SheetSection>
              )}
              <SheetSection title="This season" note={`team place = among ${school.mascot ?? "our runners"} in the same race`}>
                {s.season.length > 0 ? (
                  <TableWrap>
                    <AthleteRacesTable races={s.season} splitLabels={splitLabels} finishMeters={finishMeters} label={(r) => r.meetName} />
                  </TableWrap>
                ) : (
                  <p className="py-2 text-[12px] text-[var(--r-ink-2)]">No races yet this season.</p>
                )}
              </SheetSection>
              {refs.length > 0 && (
                <SheetSection title="On the clock" note="cumulative race time at each mile mark">
                  <TableWrap>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className={th}>Reference race</th>
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
                            <td className={`${td} pr-2 text-[13px]`}>{note(r)}</td>
                            {splitLabels.map((c) => (
                              <td key={c.label} className={`${td} text-right text-[13px]`}>
                                {t(r.splits.find((x) => Math.abs(x.meters - c.meters) <= 50)?.ms ?? null)}
                              </td>
                            ))}
                            <td className={`${td} text-right text-[13px] font-bold`}>{t(r.finishMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                </SheetSection>
              )}
              {s.season.filter((r) => r.finishMs !== null).length >= 2 && (
                <SheetSection title="Season so far" note="finish time by meet · faster is higher · gray ring = this course">
                  <TimeChart points={s.season.filter((r) => r.finishMs !== null).map((r) => ({ label: r.meetShort, ms: r.finishMs!, mark: r.sb ? "gold" : meet.courseId && r.courseId === meet.courseId ? "ring" : undefined }))} />
                </SheetSection>
              )}
              {facts.length > 0 && (
                <SheetSection title="Worth knowing">
                  <ul className="space-y-1.5 pt-1 text-[12.5px] leading-snug">
                    {facts.map((f) => (
                      <li key={f} className="flex gap-2">
                        <span aria-hidden className="text-[var(--r-gold)]">
                          •
                        </span>
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

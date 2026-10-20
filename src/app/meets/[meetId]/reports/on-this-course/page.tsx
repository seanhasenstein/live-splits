import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { classYear, Grade, ReportShell, Sheet, SheetSection, TableWrap, td, teamBrand, th } from "@/components/report/report";
import { can, getSession } from "@/lib/auth/session";
import { getMeet, getProgram, getSchool, getSeasonFor, listRaces } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { segmentsAt, summarizeAthlete } from "@/lib/reports/athlete";
import { getTeamHistory, seriesOf } from "@/lib/reports/history";
import { gradeForSeason } from "@/lib/grade";
import { formatElapsed, formatLocalDateLong } from "@/lib/time";

export const metadata: Metadata = { title: "On this course" };

/** On This Course: every runner in each race by every earlier race on this meet's course, with their course best. */
export default async function OnThisCoursePage({ params }: PageProps<"/meets/[meetId]/reports/on-this-course">) {
  const { meetId } = await params;
  const session = await getSession();
  if (!session) redirect("/join");
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "view", meet)) notFound();
  const [school, program, races] = await Promise.all([getSchool(meet.schoolId), getProgram(meet.schoolId, "xc"), listRaces(meet._id)]);
  if (!school || !program) notFound();
  const db = await getDb();
  const [athletes, venue, course, season] = await Promise.all([
    collection(db, "athletes").find({ schoolId: meet.schoolId, deletedAt: null }).toArray(),
    meet.venueId ? collection(db, "venues").findOne({ _id: meet.venueId }) : null,
    meet.courseId ? collection(db, "courses").findOne({ _id: meet.courseId }) : null,
    getSeasonFor(program._id, meet.date),
  ]);
  const series = seriesOf(meet);
  const history = meet.courseId ? await getTeamHistory(meet.schoolId, program, athletes.map((a) => a._id)) : [];
  const byId = new Map(athletes.map((a) => [a._id, a]));
  const team = teamBrand(school);
  const t = (ms: number | null) => (ms === null ? "—" : formatElapsed(ms, "seconds"));
  const withLineup = races.filter((r) => r.lineup.length > 0);
  const place = course && venue && course.name !== venue.name ? `${venue.name} · ${course.name}` : (venue?.name ?? "this course");

  return (
    <ReportShell back={{ href: `/meets/${meet._id}`, label: meet.name }} title="On this course" subtitle={meet.name}>
      {!meet.courseId && (
        <p className="no-print mx-auto max-w-xl px-4 text-sm text-ink-2">
          This meet has no course yet. <Link href={`/meets/${meet._id}/edit`} className="underline">Edit the meet</Link> and set its venue to see every earlier race there.
        </p>
      )}
      {meet.courseId && withLineup.length > 0 && (
        <Sheet
          team={team}
          header={{
            kicker: `${meet.name} · ${formatLocalDateLong(meet.date)}`,
            kickerGold: true,
            title: "On This Course",
            titleCase: "as-is",
            greenRule: true,
            subline: `Every race our ${meet.name} lineup has run at ${place}, oldest first. Each runner's best here is shaded, with its mile-by-mile splits.`,
          }}
          legend={
            <>
              Times truncated to the second · <sup>JV</sup> = ran the JV race · <span className="font-semibold text-[var(--r-gold-text)]">gold column</span> = this same meet in an earlier year · — = didn&apos;t run it
            </>
          }
          tag={<span className="font-bold text-[var(--r-green)]">{school.shortName} Cross Country</span>}
        >
          {withLineup.map((race) => {
            const splitLabels = race.checkpoints.filter((c) => c.kind === "split").map((c) => ({ label: c.label, meters: c.distance.meters }));
            const finishMeters = race.checkpoints.find((c) => c.kind === "finish")?.distance.meters ?? null;
            const lastLabel = finishMeters !== null && splitLabels.length > 0 ? `Mile ${(finishMeters / 1609.344).toFixed(1)}` : "Finish";
            const people = race.lineup.map((l) => ({
              id: l.athleteId,
              s: summarizeAthlete({ athleteId: l.athleteId, rows: history, teamRows: history, distanceId: race.distanceId, seasonId: meet.seasonId, courseId: meet.courseId, before: meet.date }),
            }));
            // One column per earlier meet on this course that any of these runners ran, oldest first.
            const columns = [...new Map(people.flatMap((p) => p.s.onCourse).sort((a, b) => a.date.localeCompare(b.date)).map((r) => [r.meetId, r])).values()];
            people.sort((a, b) => (a.s.courseBest?.finishMs ?? Infinity) - (b.s.courseBest?.finishMs ?? Infinity) || (byId.get(a.id)?.displayName ?? "").localeCompare(byId.get(b.id)?.displayName ?? ""));
            return (
              <SheetSection key={race._id} title={race.name}>
                {columns.length === 0 ? (
                  <p className="py-2 text-[12px] text-[var(--r-ink-2)]">Nobody in this lineup has raced this course before.</p>
                ) : (
                  <TableWrap>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className={th}>Runner</th>
                          {columns.map((c) => (
                            <th key={c.meetId} className={`${th} text-center ${c.series === series ? "text-[var(--r-gold-text)]!" : "text-[var(--r-green)]!"}`}>
                              {c.label}
                            </th>
                          ))}
                          <th className={`${th} text-center`}>Races</th>
                          <th className={`${th} border-l border-[var(--r-line)] text-right`}>
                            <span className="block text-[var(--r-green)]">Course best</span>
                            <span className="block text-[6.5px] font-medium tracking-normal normal-case">{[...splitLabels.map((c) => c.label), lastLabel].join(" · ")}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {people.map(({ id, s }) => {
                          const best = s.courseBest;
                          const a = byId.get(id);
                          const grade = a?.graduationYear != null && season ? gradeForSeason(a.graduationYear, season.endDate) : null;
                          return (
                            <tr key={id}>
                              <td className={`${td} pr-2 font-bold`}>
                                {a?.displayName ?? "?"}
                                {classYear(grade) && <Grade>{classYear(grade)}</Grade>}
                              </td>
                              {columns.map((c) => {
                                const r = s.onCourse.find((x) => x.meetId === c.meetId);
                                const isBest = !!r && r.raceId === best?.raceId;
                                return (
                                  <td key={c.meetId} className={`${td} text-center ${isBest ? "bg-[var(--r-cream)] font-bold text-[var(--r-green)]" : ""}`}>
                                    {r ? (
                                      <>
                                        {r.status === "finished" ? t(r.finishMs) : r.status.toUpperCase()}
                                        {r.levelId === "jv" && <sup className="ml-px text-[6.5px] font-semibold text-[var(--r-ink-3)]">JV</sup>}
                                      </>
                                    ) : (
                                      <span className="text-[var(--r-ink-3)]">—</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className={`${td} text-center text-[var(--r-ink-2)]`}>{s.onCourse.length || ""}</td>
                              <td className={`${td} border-l border-[var(--r-line)] text-right`}>
                                {best ? (
                                  <>
                                    <span className="block font-bold text-[var(--r-green)]">{t(best.finishMs)}</span>
                                    <span className="block text-[8px] text-[var(--r-ink-3)]">{segmentsAt(best, splitLabels).map(t).join(" · ")}</span>
                                  </>
                                ) : (
                                  <span className="text-[var(--r-ink-3)]">first time</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
              </SheetSection>
            );
          })}
        </Sheet>
      )}
    </ReportShell>
  );
}


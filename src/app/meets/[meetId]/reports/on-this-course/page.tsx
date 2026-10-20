import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReportShell, Sheet, td, teamBrand, th } from "@/components/report/report";
import { can, getSession } from "@/lib/auth/session";
import { getMeet, getProgram, getSchool, listRaces } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { segmentsAt, summarizeAthlete } from "@/lib/reports/athlete";
import { getTeamHistory } from "@/lib/reports/history";
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
  const [athletes, venue, course] = await Promise.all([
    collection(db, "athletes").find({ schoolId: meet.schoolId, deletedAt: null }).toArray(),
    meet.venueId ? collection(db, "venues").findOne({ _id: meet.venueId }) : null,
    meet.courseId ? collection(db, "courses").findOne({ _id: meet.courseId }) : null,
  ]);
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
      {meet.courseId &&
        withLineup.map((race) => {
          const splitLabels = race.checkpoints.filter((c) => c.kind === "split").map((c) => ({ label: c.label, meters: c.distance.meters }));
          const people = race.lineup.map((l) => ({
            id: l.athleteId,
            s: summarizeAthlete({ athleteId: l.athleteId, rows: history, teamRows: history, distanceId: race.distanceId, seasonId: meet.seasonId, courseId: meet.courseId, before: meet.date }),
          }));
          // One column per earlier meet on this course that any of these runners ran, oldest first.
          const columns = [...new Map(people.flatMap((p) => p.s.onCourse).sort((a, b) => a.date.localeCompare(b.date)).map((r) => [r.meetId, r])).values()];
          people.sort((a, b) => (a.s.courseBest?.finishMs ?? Infinity) - (b.s.courseBest?.finishMs ?? Infinity) || (byId.get(a.id)?.displayName ?? "").localeCompare(byId.get(b.id)?.displayName ?? ""));
          return (
            <Sheet
              key={race._id}
              team={team}
              header={{
                kicker: (
                  <>
                    {meet.name} · <span className="text-[var(--r-gold-text)]">{formatLocalDateLong(meet.date)}</span>
                  </>
                ),
                title: `On This Course · ${race.name}`,
                subline: `Every race this lineup has run at ${place}, oldest first`,
              }}
              legend={
                <>
                  <span className="font-semibold text-[var(--r-green-text)]">Shaded</span>: their best on this course, with its mile-by-mile splits. <sup>JV</sup>: ran the JV race. — : didn&apos;t run it. Times in whole seconds.
                </>
              }
              tag={`${meet.name} · ${race.name}`}
            >
              {columns.length === 0 ? (
                <p className="text-[11px] text-[var(--r-ink-2)]">Nobody in this lineup has raced this course before.</p>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={th}>Runner</th>
                      {columns.map((c) => (
                        <th key={c.meetId} className={`${th} text-center`}>
                          {c.label}
                        </th>
                      ))}
                      <th className={`${th} text-right`}>Races</th>
                      <th className={`${th} text-right`}>Course best</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map(({ id, s }) => {
                      const best = s.courseBest;
                      return (
                        <tr key={id}>
                          <td className={`${td} pr-2 font-medium`}>{byId.get(id)?.displayName ?? "?"}</td>
                          {columns.map((c) => {
                            const r = s.onCourse.find((x) => x.meetId === c.meetId);
                            const isBest = !!r && r.raceId === best?.raceId;
                            return (
                              <td key={c.meetId} className={`${td} text-center ${isBest ? "bg-[var(--r-cream)] font-bold text-[var(--r-green-text)]" : ""}`}>
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
                          <td className={`${td} text-right`}>{s.onCourse.length || ""}</td>
                          <td className={`${td} text-right`}>
                            {best ? (
                              <>
                                <span className="font-bold text-[var(--r-green-text)]">{t(best.finishMs)}</span>
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
              )}
            </Sheet>
          );
        })}
    </ReportShell>
  );
}


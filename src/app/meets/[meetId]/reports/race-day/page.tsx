import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Fragment } from "react";
import { Pill, ReportShell, Sheet, td, teamBrand, th } from "@/components/report/report";
import { can, getSession } from "@/lib/auth/session";
import { getMeet, getProgram, getSchool, listAthletes, listRaces } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { getTeamHistory, seriesOf } from "@/lib/reports/history";
import { buildRaceDay } from "@/lib/reports/race-day";
import { formatElapsed, formatLocalDateLong } from "@/lib/time";

export const metadata: Metadata = { title: "Race day sheet" };

/** Race Day Sheet: one Letter page per race with a lineup, for the clipboard at the mile marks. */
export default async function RaceDayPage({ params }: PageProps<"/meets/[meetId]/reports/race-day">) {
  const { meetId } = await params;
  const session = await getSession();
  if (!session) redirect("/join");
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "view", meet)) notFound();
  const [school, program, races] = await Promise.all([getSchool(meet.schoolId), getProgram(meet.schoolId, "xc"), listRaces(meet._id)]);
  if (!school || !program) notFound();
  const withLineup = races.filter((r) => r.lineup.length > 0);
  const athleteIds = [...new Set(withLineup.flatMap((r) => r.lineup.map((l) => l.athleteId)))];
  const [athletes, history, venue] = await Promise.all([
    listAthletes(meet.schoolId, athleteIds),
    getTeamHistory(meet.schoolId, program, athleteIds),
    meet.venueId ? collection(await getDb(), "venues").findOne({ _id: meet.venueId }) : null,
  ]);
  const name = new Map(athletes.map((a) => [a._id, a]));
  const team = teamBrand(school);
  const t = (ms: number | null) => (ms === null ? "—" : formatElapsed(ms, "seconds"));
  const subline = (
    <>
      <span className="font-semibold text-[var(--r-ink)]">{meet.name}</span>
      {venue ? ` · ${venue.name}` : ""} · {formatLocalDateLong(meet.date)}
    </>
  );

  return (
    <ReportShell back={{ href: `/meets/${meet._id}`, label: meet.name }} title="Race day sheet" subtitle={meet.name}>
      {withLineup.length === 0 && <p className="no-print mx-auto max-w-xl px-4 text-sm text-ink-2">No race in this meet has a lineup yet. Add runners to a race and its sheet appears here.</p>}
      {withLineup.map((race) => {
        const checkpoints = race.checkpoints.filter((c) => c.kind === "split").map((c) => ({ label: c.label, meters: c.distance.meters }));
        const sheet = buildRaceDay({
          meet: { id: meet._id, date: meet.date, seasonId: meet.seasonId, courseId: meet.courseId, series: seriesOf(meet) },
          checkpoints,
          athleteIds: race.lineup.map((l) => l.athleteId),
          rows: history,
          distanceId: race.distanceId,
        });
        const cols = [...checkpoints.map((c) => c.label), "Finish"];
        const group = "border-l border-[var(--r-line)]";
        return (
          <Sheet
            key={race._id}
            team={team}
            header={{ title: `Race Day Sheet · ${race.name}`, subline }}
            legend={
              <>
                Splits are on the clock (time from the gun), as a coach at the mile mark reads them. <span className="font-semibold text-[var(--r-green-text)]">Career best</span> and{" "}
                <span className="font-semibold text-[var(--r-gold-text)]">season best</span> at this distance. — : didn&apos;t run that race. Today: write in as they pass.
              </>
            }
            tag={`${meet.name} · ${race.name}`}
          >
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th} />
                  <th className={th} colSpan={2} />
                  {sheet.refs.map((ref) => (
                    <th key={ref.meetId} colSpan={cols.length} className={`${th} ${group} text-center`}>
                      {ref.label}
                      {ref.note && <span className="ml-1 font-medium text-[var(--r-ink-3)] normal-case">({ref.note})</span>}
                    </th>
                  ))}
                  <th colSpan={cols.length} className={`${th} ${group} text-center text-[var(--r-ink)]`}>
                    Today
                  </th>
                </tr>
                <tr>
                  <th className={th}>Runner</th>
                  <th className={`${th} text-right`}>Career</th>
                  <th className={`${th} text-right`}>Season</th>
                  {sheet.refs.map((ref) =>
                    cols.map((c, i) => (
                      <th key={`${ref.meetId}-${c}`} className={`${th} text-right ${i === 0 ? group : ""}`}>
                        {c}
                      </th>
                    )),
                  )}
                  {cols.map((c, i) => (
                    <th key={`today-${c}`} className={`${th} text-center ${i === 0 ? group : ""}`}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((r) => {
                  const a = name.get(r.athleteId);
                  return (
                    <tr key={r.athleteId}>
                      <td className={`${td} pr-2 font-medium`}>{a?.displayName ?? "?"}</td>
                      <td className={`${td} text-right font-semibold text-[var(--r-green-text)]`}>{t(r.careerBest)}</td>
                      <td className={`${td} text-right font-semibold text-[var(--r-gold-text)]`}>{t(r.seasonBest)}</td>
                      {r.refs.map((cell, k) => (
                        <Fragment key={sheet.refs[k].meetId}>
                          {cell ? (
                            <>
                              {cell.splits.map((ms, i) => (
                                <td key={i} className={`${td} text-right text-[var(--r-ink-2)] ${i === 0 ? group : ""}`}>
                                  {t(ms)}
                                </td>
                              ))}
                              <td className={`${td} text-right font-semibold`}>
                                {t(cell.finishMs)}
                                {cell.jv && <Pill kind="jv" className="ml-1" />}
                              </td>
                            </>
                          ) : (
                            cols.map((c, i) => (
                              <td key={c} className={`${td} text-right text-[var(--r-ink-3)] ${i === 0 ? group : ""}`}>
                                —
                              </td>
                            ))
                          )}
                        </Fragment>
                      ))}
                      {cols.map((c, i) => (
                        // Blank, with room to write a time.
                        <td key={`today-${c}`} className={`${td} h-[0.36in] min-w-[0.6in] border-r border-[var(--r-line)] ${i === 0 ? group : ""}`} />
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Sheet>
        );
      })}
    </ReportShell>
  );
}

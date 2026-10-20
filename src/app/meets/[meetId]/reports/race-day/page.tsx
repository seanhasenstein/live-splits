import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Fragment } from "react";
import { Grade, MajorHeading, MeetLine, ReportShell, Sheet, TableWrap, td, teamBrand, th, thGroup } from "@/components/report/report";
import { can, getSession } from "@/lib/auth/session";
import { getMeet, getProgram, getSchool, getSeasonFor, listAthletes, listRaces } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { gradeForSeason } from "@/lib/grade";
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
  const [athletes, history, venue, season] = await Promise.all([
    listAthletes(meet.schoolId, athleteIds),
    getTeamHistory(meet.schoolId, program, athleteIds),
    meet.venueId ? collection(await getDb(), "venues").findOne({ _id: meet.venueId }) : null,
    getSeasonFor(program._id, meet.date),
  ]);
  const byId = new Map(athletes.map((a) => [a._id, a]));
  const team = teamBrand(school);
  const t = (ms: number | null) => (ms === null ? "" : formatElapsed(ms, "seconds"));
  const gender = (name: string) => (/\bgirls?\b|\bwomen\b/i.test(name) ? "Girls" : /\bboys?\b|\bmen\b/i.test(name) ? "Boys" : null);

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
        const sep = "border-l border-[var(--r-line)]";
        const g = gender(race.name);
        // "2025 SECTIONAL (THIS COURSE)", "LAST RACE (BIG EAST)".
        const groupLabel = (ref: (typeof sheet.refs)[number]) => (ref.note === "last race" ? `Last race (${ref.label.slice(4)})` : `20${ref.label.slice(1)}${ref.note ? ` (${ref.note})` : ""}`);
        return (
          <Sheet
            key={race._id}
            team={team}
            header={{ title: `Race Day Sheet${g ? ` · ${g}` : ""}`, subline: <MeetLine meet={meet.name} venue={venue?.name} date={formatLocalDateLong(meet.date)} /> }}
            legend={
              <>
                {cols.slice(0, -1).join(" / ")} are cumulative clock times at each mark · {sheet.refs.filter((r) => r.note === "this course").length > 0 ? `${sheet.refs.filter((r) => r.note === "this course").map((r) => `20${r.label.slice(1)}`).join(" and ")} ran on this course · ` : ""}blank columns are for today&apos;s splits · times truncated to whole seconds
              </>
            }
            tag={`Updated ${formatLocalDateLong(new Date().toISOString().slice(0, 10)).replace(/^[A-Za-z]+, /, "")}`}
          >
            <MajorHeading>{race.name}</MajorHeading>
            <TableWrap>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th colSpan={3} />
                    {sheet.refs.map((ref) => (
                      <th key={ref.meetId} colSpan={cols.length} className={`${thGroup} ${sep}`}>
                        {groupLabel(ref)}
                      </th>
                    ))}
                    <th colSpan={cols.length} className={`${thGroup} ${sep}`}>
                      Today
                    </th>
                  </tr>
                  <tr>
                    <th className={`${th} text-center`}>Runner</th>
                    <th className={`${th} text-center`}>Career best</th>
                    <th className={`${th} text-center`}>{meet.date.slice(0, 4)} best</th>
                    {[...sheet.refs.map((r) => r.meetId), "today"].map((id) =>
                      cols.map((c, i) => (
                        <th key={`${id}-${c}`} className={`${th} text-center ${i === 0 ? sep : ""}`}>
                          {c}
                        </th>
                      )),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((r) => {
                    const a = byId.get(r.athleteId);
                    const grade = a?.graduationYear != null && season ? gradeForSeason(a.graduationYear, season.endDate) : null;
                    return (
                      <tr key={r.athleteId}>
                        <td className={`${td} pr-3 font-bold`}>
                          {a?.displayName ?? "?"}
                          {grade !== null && grade <= 12 && <Grade>{grade}</Grade>}
                        </td>
                        <td className={`${td} text-center font-bold text-[var(--r-green)]`}>{t(r.careerBest)}</td>
                        <td className={`${td} text-center font-bold text-[var(--r-gold-text)]`}>{t(r.seasonBest)}</td>
                        {r.refs.map((cell, k) => (
                          <Fragment key={sheet.refs[k].meetId}>
                            {cols.map((c, i) => {
                              const ms = cell ? (i < cols.length - 1 ? cell.splits[i] : cell.finishMs) : null;
                              return (
                                <td key={c} className={`${td} text-center ${i === 0 ? sep : ""}`}>
                                  {t(ms)}
                                  {cell?.jv && i === cols.length - 1 && <sup className="ml-px text-[6.5px] font-semibold text-[var(--r-ink-3)]">JV</sup>}
                                </td>
                              );
                            })}
                          </Fragment>
                        ))}
                        {cols.map((c, i) => (
                          // Blank: room to write the time in as they pass.
                          <td key={`today-${c}`} className={`${td} h-[0.4in] min-w-[0.55in] ${i === 0 ? sep : ""}`} />
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </Sheet>
        );
      })}
    </ReportShell>
  );
}

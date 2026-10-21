import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Badge, HeroMeet, RptPage, RptShell } from "@/components/rpt/rpt";
import { can, getSession } from "@/lib/auth/session";
import { getMeet, getProgram, getSchool, listRaces, listRoster } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import type { Weather } from "@/lib/db/schema";
import { ordinal } from "@/lib/reports/athlete";
import { getTeamHistory } from "@/lib/reports/history";
import { buildMeetSplits, type FieldRow, sec } from "@/lib/reports/meet-splits";
import { formatElapsed, formatMonthDayYear as longDate } from "@/lib/time";

export const metadata: Metadata = { title: "Meet splits" };

/** "52°, sunny, southwest wind 12 mph": the weather line, without dew point. */
function weatherLine(w: Weather | null): string | null {
  if (!w) return null;
  const parts = [w.tempF !== null ? `${Math.round(w.tempF)}°` : null, w.conditions, w.windMph !== null && !/\bwind\b/i.test(w.conditions ?? "") ? `wind ${Math.round(w.windMph)} mph` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Meet Splits (design/report-spec.md §4a): boys on page 1, girls on page 2. */
export default async function MeetSplitsPage({ params }: PageProps<"/meets/[meetId]/reports/splits">) {
  const { meetId } = await params;
  const session = await getSession();
  if (!session) redirect("/join");
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "view", meet)) notFound();
  const [school, program, races, roster] = await Promise.all([getSchool(meet.schoolId), getProgram(meet.schoolId, "xc"), listRaces(meet._id), listRoster(meet.seasonId)]);
  if (!school || !program) notFound();
  const db = await getDb();
  const ranIds = races.flatMap((r) => r.lineup.map((l) => l.athleteId));
  const athletes = await collection(db, "athletes").find({ schoolId: meet.schoolId, _id: { $in: [...new Set([...roster.map((a) => a._id), ...ranIds])] }, deletedAt: null }).toArray();
  const [history, entries] = await Promise.all([
    getTeamHistory(meet.schoolId, program, athletes.map((a) => a._id)),
    collection(db, "raceEntries").find({ raceId: { $in: races.map((r) => r._id) }, deletedAt: null }, { projection: { raceId: 1, teamName: 1, place: 1, status: 1, timeMs: 1, athleteId: 1 } }).toArray(),
  ]);
  const categoryGender = new Map(program.settings.raceCategories.map((c) => [c.id, c.gender]));
  const genderOf = (r: (typeof races)[number]): "M" | "F" | null => {
    const g = categoryGender.get(r.raceCategoryId);
    if (/\bboys?\b.*\bgirls?\b|\bgirls?\b.*\bboys?\b|combined|mixed/i.test(r.name)) return null;
    return g === "M" || g === "F" ? g : /\bgirls?\b/i.test(r.name) ? "F" : /\bboys?\b/i.test(r.name) ? "M" : null;
  };
  const fields: Record<string, FieldRow[]> = {};
  for (const e of entries) (fields[e.raceId] ??= []).push({ team: e.teamName, place: e.place, status: e.status, timeMs: e.timeMs, ours: !!e.athleteId });
  const byGender = buildMeetSplits({
    meet: { id: meet._id, date: meet.date, seasonId: meet.seasonId },
    races: races.map((r) => ({ id: r._id, name: r.name, gender: genderOf(r), varsity: r.levelIds.includes("varsity"), order: r.order, sheet: r.sheetSummary, checkpoints: r.checkpoints.filter((c) => c.kind === "split").map((c) => ({ meters: c.distance.meters })) })),
    fields,
    rows: history,
    roster: roster.map((a) => ({ id: a._id, gender: a.gender })),
    athleteGender: Object.fromEntries(athletes.map((a) => [a._id, a.gender])),
  });
  const name = new Map(athletes.map((a) => [a._id, a.displayName]));
  const t = (ms: number | null) => (ms === null ? "" : formatElapsed(sec(ms) * 1000, "seconds"));
  const date = longDate(meet.date);
  const weather = weatherLine(meet.weather);

  return (
    <RptShell back={{ href: `/meets/${meet._id}`, label: meet.name }} title="Meet splits" subtitle={meet.name}>
      {(["M", "F"] as const)
        .filter((g) => byGender[g].sections.length > 0)
        .map((g) => {
          const { sections, didNotRun } = byGender[g];
          return (
            <RptPage
              key={g}
              title="Meet Splits"
              meetLine={<HeroMeet name={meet.name} parts={[date, weather]} />}
              legend={
                <>
                  <Badge kind="sb" /> season best · <Badge kind="pr" /> career best (high school) · <b>Letter</b> finish at or under the varsity letter standard
                </>
              }
              right={`${meet.name} · ${date}`}
            >
              {sections.map(({ race, stats, rows }) => {
                const raceInfo = races.find((r) => r._id === race.id)!;
                const splitCps = raceInfo.checkpoints.filter((c) => c.kind === "split");
                const finishMeters = raceInfo.checkpoints.find((c) => c.kind === "finish")?.distance.meters ?? 5000;
                const heads = [...splitCps.map((c) => c.label), `Mile ${(finishMeters / 1609.344).toFixed(1)}`];
                return (
                  <div key={race.id}>
                    <div className="sec">{race.gender === null ? `${g === "M" ? "Boys" : "Girls"} · ${race.name}` : race.name}</div>
                    {stats && (
                      <div className="stats">
                        <div className="st">
                          <div className="n">{stats.points}</div>
                          <div className="l">Pts</div>
                        </div>
                        <div className="st">
                          <div className="n">{ordinal(stats.place)}</div>
                          <div className="l">Place</div>
                        </div>
                        <div className="st">
                          <div className="n">{stats.teams}</div>
                          <div className="l">Teams</div>
                        </div>
                        {stats.runners !== null && (
                          <div className="st">
                            <div className="n">{stats.runners}</div>
                            <div className="l">Runners</div>
                          </div>
                        )}
                        {stats.letter && (
                          <div className="st gold">
                            <div className="n">
                              {ordinal(stats.letter.place)} · {t(stats.letter.ms)}
                            </div>
                            <div className="l">Letter Standard</div>
                          </div>
                        )}
                        {stats.note && <div className="st note">{stats.note}</div>}
                      </div>
                    )}
                    <div className="scroll">
                      <table className="sp">
                        <colgroup>
                          <col style={{ width: "27%" }} />
                          {heads.map((h) => (
                            <col key={h} />
                          ))}
                          <col />
                          <col />
                          <col style={{ width: "13%" }} />
                        </colgroup>
                        <thead>
                          <tr>
                            <th className="l">Athlete</th>
                            {heads.map((h) => (
                              <th key={h}>{h}</th>
                            ))}
                            <th>Finish</th>
                            <th>Place</th>
                            <th>Letter</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.athleteId}>
                              <td className="name">{name.get(r.athleteId) ?? "?"}</td>
                              {heads.map((h, i) => (
                                <td key={h}>{t(r.segments[i] ?? null)}</td>
                              ))}
                              <td className="fin">
                                {r.finishMs !== null ? t(r.finishMs) : r.status.toUpperCase()}
                                <Badge kind={r.badge} />
                              </td>
                              <td className="plc">{r.place ? ordinal(r.place) : ""}</td>
                              <td>{r.letter && <span className="lp">LETTER</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
              {didNotRun.length > 0 && (
                <>
                  <div className="dnr-h">Did Not Run</div>
                  <table className="sp" style={{ marginTop: 0 }}>
                    <tbody>
                      {didNotRun.map((id) => (
                        <tr key={id}>
                          <td className="name" style={{ width: "27%" }}>
                            {name.get(id) ?? "?"}
                          </td>
                          <td colSpan={6} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </RptPage>
          );
        })}
    </RptShell>
  );
}

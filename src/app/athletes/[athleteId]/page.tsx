import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, HeroMeet, RptPage, RptShell } from "@/components/rpt/rpt";
import { SeasonChart } from "@/components/rpt/season-chart";
import { getSession, isSchoolWide } from "@/lib/auth/session";
import { getProgram, getSchool, getSeasonFor } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { gradeForSeason } from "@/lib/grade";
import { METERS_PER_MILE } from "@/lib/pace";
import { type AthleteRace, ordinal, segmentsAt, summarizeAthlete } from "@/lib/reports/athlete";
import { mainDistance } from "@/lib/reports/context";
import { getTeamHistory, seriesOf } from "@/lib/reports/history";
import { letterStandards } from "@/lib/reports/letters";
import { buildProfile } from "@/lib/reports/profile";
import { shortMeetName } from "@/lib/reports/season-times";
import { formatElapsed, formatMonthDayYear } from "@/lib/time";

export const metadata: Metadata = { title: "Athlete" };

const t = (ms: number | null | undefined) => (ms == null ? "—" : formatElapsed(Math.floor(ms / 1000) * 1000, "seconds"));
/** "−27" / "+10" seconds, or blank. */
const sgn = (s: number | null) => (s === null ? "" : s === 0 ? "0" : s < 0 ? `−${-s}` : `+${s}`);
const tone = (s: number | null) => (s === null ? "" : s < 0 ? "f" : s > 0 ? "s" : "");
const placeOf = (p: { place: number | null; jv: boolean }) => (p.place ? `${ordinal(p.place)}${p.jv ? " JV" : ""}` : "");
const SPLITS = [{ meters: METERS_PER_MILE }, { meters: 2 * METERS_PER_MILE }];
/** Rows that fit on a continuation page; a season heading and table head take about three. */
const ROWS_PER_PAGE = 30;

/**
 * An athlete's page (the team's Athlete Profile PDF): this season against the ones before, meet by
 * meet, then every race on file by season, each linking to its results.
 */
export default async function AthletePage({ params }: PageProps<"/athletes/[athleteId]">) {
  const { athleteId } = await params;
  const session = await getSession();
  if (!session) redirect("/join");
  if (!isSchoolWide(session)) notFound();
  const db = await getDb();
  const athlete = await collection(db, "athletes").findOne({ _id: athleteId, schoolId: session.schoolId, deletedAt: null });
  if (!athlete) notFound();
  const [school, program] = await Promise.all([getSchool(session.schoolId), getProgram(session.schoolId, "xc")]);
  if (!school || !program) notFound();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: school.settings.timeZone }).format(new Date());
  const [everyone, seasons, current] = await Promise.all([
    collection(db, "athletes").find({ schoolId: session.schoolId, deletedAt: null }, { projection: { _id: 1 } }).toArray(),
    collection(db, "seasons").find({ programId: program._id, deletedAt: null }).toArray(),
    getSeasonFor(program._id, today),
  ]);
  // Everyone's history, for team places in each race.
  const history = await getTeamHistory(session.schoolId, program, everyone.map((a) => a._id));
  const mine = history.filter((r) => r.athleteId === athlete._id);
  const distanceId = mainDistance(mine);
  const atDistance = mine.filter((r) => r.distanceId === distanceId);
  const seasonById = new Map(seasons.map((s) => [s._id, s]));
  const gradeFor = (seasonId: string) => {
    const s = seasonById.get(seasonId);
    const g = athlete.graduationYear !== null && s ? gradeForSeason(athlete.graduationYear, s.endDate) : null;
    return g !== null && g <= 12 ? g : null;
  };

  const currentMeets = current ? await collection(db, "meets").find({ seasonId: current._id, deletedAt: null }).sort({ date: 1 }).toArray() : [];
  const letters = await letterStandards([...new Set(atDistance.map((r) => r.meetId))], program);
  const g = athlete.gender === "F" ? "F" : "M";
  const profile = buildProfile({
    rows: atDistance,
    seasons: seasons.map((s) => ({ id: s._id, startDate: s.startDate })),
    currentSeasonId: current?._id ?? "",
    gradeFor,
    letterMs: Object.fromEntries(Object.entries(letters).map(([meetId, byGender]) => [meetId, byGender[g]])),
    currentMeets: currentMeets.map((m) => ({ id: m._id, name: m.name, series: seriesOf(m), label: m.shortName ?? shortMeetName(m.name), date: m.date })),
    today,
    checkpoints: SPLITS,
  });

  const year = current?.label ?? today.slice(0, 4);
  const lastYear = String(Number(year) - 1);
  const latest = [...atDistance].sort((a, b) => a.date.localeCompare(b.date)).findLast((r) => r.seasonId === current?._id);
  const grade = current ? gradeFor(current._id) : null;
  const k = profile.kpis;
  const bestRow = k.careerBest ? atDistance.find((r) => r.raceId === k.careerBest!.raceId) : undefined;
  const legend = (
    <>
      <b style={{ color: "var(--gold)" }}>Gold</b> career best (high school) · <b style={{ color: "var(--green)" }}>Green</b> season best · <u>Underline</u> letter point · times truncated to whole seconds
    </>
  );
  const updated = `Updated ${formatMonthDayYear(today)}`;
  const chartSeasons = profile.seasons.slice(-3);

  // Every race on file by season, newest season first, as many whole seasons per page as fit.
  const bySeason = [...new Set(atDistance.map((r) => r.seasonId))]
    .sort((a, b) => (seasonById.get(b)?.startDate ?? "").localeCompare(seasonById.get(a)?.startDate ?? ""))
    .map((sid) => {
      const s = summarizeAthlete({ athleteId: athlete._id, rows: history, teamRows: history, distanceId, seasonId: sid, courseId: null });
      // PR marks from the whole career; SB from the season.
      return { sid, best: s.seasonBest?.finishMs ?? null, races: s.season.map((r) => ({ ...r, pr: r.raceId === k.careerBest?.raceId })) };
    });
  const pages: (typeof bySeason)[] = [];
  let room = 0;
  for (const s of bySeason) {
    const need = s.races.length + 3;
    if (pages.length === 0 || need > room) {
      pages.push([]);
      room = ROWS_PER_PAGE;
    }
    pages[pages.length - 1].push(s);
    room -= need;
  }
  const raceLink = (r: AthleteRace) => (r.wholeField ? `/meets/${r.meetId}/reports/results?race=${r.raceId}` : `/meets/${r.meetId}/reports/splits`);

  return (
    <RptShell back={{ href: "/reports", label: "Reports" }} title={athlete.displayName} subtitle="Athlete profile">
      <RptPage
        title="Athlete Profile"
        meetLine={<HeroMeet name={`${year} season`} parts={latest ? [`through the ${latest.meetName}`, formatMonthDayYear(latest.date)] : ["no races yet"]} />}
        legend={legend}
        right={updated}
      >
        <div className="lead">
          <span className="nm">{athlete.displayName}</span>
          <span className="mt">
            {grade !== null ? `Grade ${grade} · ` : ""}
            {athlete.gender === "F" ? "Girls" : "Boys"}
          </span>
        </div>
        <div className="statbar pf">
          <div className="c">
            <div className="n gold">{t(k.careerBest?.ms)}</div>
            <div className="l">Career best{bestRow ? ` · ${bestRow.date.slice(0, 4)} ${bestRow.meetShort}` : ""}</div>
          </div>
          <div className="c">
            <div className="n">{k.bestPlace ? ordinal(k.bestPlace.place) : "—"}</div>
            <div className="l">
              Best {year} finish{k.bestPlace && k.bestPlace.times > 1 ? ` · ${k.bestPlace.times} times` : ""}
            </div>
          </div>
          <div className="c">
            <div className="n">{k.vsLastBest === null ? "—" : t(Math.abs(k.vsLastBest) * 1000)}</div>
            <div className="l">{k.vsLastBest !== null && k.vsLastBest < 0 ? `Slower than ${lastYear} best` : `Faster than ${lastYear} best`}</div>
          </div>
          <div className="c">
            <div className="n">{k.sameMeet ? `${k.sameMeet.faster}/${k.sameMeet.of}` : "—"}</div>
            <div className="l">Faster than {lastYear} at the same meet</div>
          </div>
          <div className="c">
            <div className="n">{`${k.letters.earned}/${k.letters.of}`}</div>
            <div className="l">{year} letter points</div>
          </div>
        </div>

        {chartSeasons.length > 0 && (
          <>
            <div className="legend-row">
              {chartSeasons
                .slice()
                .reverse()
                .map((s, i) => (
                  <span key={s.seasonId}>
                    <i className={i === 0 ? "" : i === 1 ? "d1" : "d2"} />
                    {s.year}
                  </span>
                ))}
              <span>Faster is higher · shaded meets are still to come</span>
            </div>
            <SeasonChart slots={profile.slots.map((s) => s.label)} seasons={chartSeasons.map((s) => ({ year: s.year, points: s.cells.map((c) => c?.ms ?? null) }))} upcoming={profile.upcoming} />
          </>
        )}

        <div className="sub">
          Every race<span>small number = place · JV = JV race</span>
        </div>
        {profile.seasons.length === 0 ? (
          <p style={{ color: "var(--soft)" }}>No races on file yet.</p>
        ) : (
          <table className="pg">
            <thead>
              <tr>
                <th className="l" />
                {profile.slots.map((s) => (
                  <th key={s.series}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profile.seasons.map((s) => (
                <tr key={s.seasonId} className={s.seasonId === current?._id ? "now" : ""}>
                  <td className="l">
                    {s.year}
                    {s.grade !== null && <span className="gr">GR {s.grade}</span>}
                  </td>
                  {s.cells.map((c, i) => (
                    <td key={i} className={c ? [c.careerBest ? "cb" : c.seasonBest ? "sb" : "", c.letter ? "let" : ""].join(" ").trim() : ""}>
                      {c && (
                        <>
                          <span className="tm">{c.ms !== null ? t(c.ms) : c.status.toUpperCase()}</span>
                          <span className="pl">{placeOf(c)}</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {profile.vsLast.length > 0 && (
          <>
            <div className="sub">
              Meet by meet vs {lastYear}
              <span>
                seconds, {year} minus {lastYear} · negative = faster
              </span>
            </div>
            <table className="vs">
              <thead>
                <tr>
                  <th className="l">Meet</th>
                  <th>{lastYear} splits</th>
                  <th>{year} splits</th>
                  <th>Mile 1</th>
                  <th>Mile 2</th>
                  <th>Final 1.1</th>
                  <th>Finish</th>
                  <th>{lastYear}</th>
                  <th>{year}</th>
                </tr>
              </thead>
              <tbody>
                {profile.vsLast.map((v) => (
                  <tr key={v.label}>
                    <td className="name">{v.label}</td>
                    <td style={{ color: "var(--soft)" }}>{v.last.segments.map(t).join(" · ")}</td>
                    <td>{v.now.segments.map(t).join(" · ")}</td>
                    {v.delta.map((d, i) => (
                      <td key={i} className={tone(d)}>
                        {sgn(d)}
                      </td>
                    ))}
                    <td className="plc">{placeOf(v.last)}</td>
                    <td className="plc">{placeOf(v.now)}</td>
                  </tr>
                ))}
                {profile.vsLast.length > 1 && (
                  <tr className="avg">
                    <td className="name">Average</td>
                    <td />
                    <td />
                    {profile.average.map((d, i) => (
                      <td key={i} className={tone(d)}>
                        {sgn(d)}
                      </td>
                    ))}
                    <td />
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}

        {profile.next && (
          <div className="nextbar">
            <b>Next up</b>
            {profile.next.name}
            {profile.next.history.length > 0 && (
              <>
                {` · your ${profile.next.label} history: `}
                {profile.next.history.map((h, i) => (
                  <span key={h.year}>
                    {i > 0 && " · "}
                    {h.year} <strong>{t(h.ms)}</strong>
                  </span>
                ))}
              </>
            )}
          </div>
        )}
      </RptPage>

      {pages.map((page, n) => (
        <RptPage key={n} title={null} legend={legend} right={updated}>
          {page.map(({ sid, best, races }) => (
            <div key={sid}>
              <div className="sec">
                {seasonById.get(sid)?.label ?? "Season"}
                {gradeFor(sid) !== null && <span className="sm">Grade {gradeFor(sid)}</span>}
                {best !== null && (
                  <span className="sm">
                    Season best <b>{t(best)}</b>
                  </span>
                )}
              </div>
              <table className="sp" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  {[35, 11, 8, 8, 9, 12, 8, 9].map((w, i) => (
                    <col key={i} style={{ width: `${w}%` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className="l">Meet</th>
                    <th>Time</th>
                    <th>Mile 1</th>
                    <th>Mile 2</th>
                    <th>Final 1.1</th>
                    <th>Place</th>
                    <th>Team</th>
                    <th>Vs prev</th>
                  </tr>
                </thead>
                <tbody>
                  {races.map((r) => (
                    <tr key={r.raceId}>
                      <td className="name">
                        <Link href={raceLink(r)}>{r.meetName}</Link>
                        {r.levelId === "jv" && <span className="gr"> JV</span>}
                      </td>
                      <td className="fin">
                        {r.status === "finished" ? t(r.finishMs) : r.status.toUpperCase()}
                        <Badge kind={r.pr ? "pr" : r.sb ? "sb" : null} />
                      </td>
                      {segmentsAt(r, SPLITS).map((ms, i) => (
                        <td key={i}>{ms === null ? "" : t(ms)}</td>
                      ))}
                      <td className="plc">
                        {r.place ? ordinal(r.place) : ""}
                        {r.place && r.fieldSize ? ` of ${r.fieldSize}` : ""}
                      </td>
                      <td className="plc">{r.teamPlace ? `${r.teamPlace.place} of ${r.teamPlace.of}` : ""}</td>
                      <td style={{ color: r.vsPrev === null || r.vsPrev === 0 ? undefined : r.vsPrev < 0 ? "var(--green)" : "var(--gold)", fontWeight: 700 }}>
                        {r.vsPrev === null ? "" : r.vsPrev === 0 ? "±0:00" : `${r.vsPrev < 0 ? "−" : "+"}${t(Math.abs(r.vsPrev))}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </RptPage>
      ))}
    </RptShell>
  );
}

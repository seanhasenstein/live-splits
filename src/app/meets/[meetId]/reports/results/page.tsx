import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RptPage, RptShell } from "@/components/rpt/rpt";
import { can, getSession } from "@/lib/auth/session";
import { getMeet, getProgram, getSchool, getSeasonFor, listRaces } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import type { Weather } from "@/lib/db/schema";
import { gradeForSeason } from "@/lib/grade";
import { ordinal, segmentsAt } from "@/lib/reports/athlete";
import { getTeamHistory } from "@/lib/reports/history";
import { type ResultEntry, scoreRace, topFive } from "@/lib/reports/race-results";
import { displayCase } from "@/lib/names";
import { formatElapsed, formatMonthDayYear } from "@/lib/time";

export const metadata: Metadata = { title: "Race results" };

const t = (ms: number | null) => (ms === null ? "" : formatElapsed(Math.floor(ms / 1000) * 1000, "seconds"));

function weatherLine(w: Weather | null): string | null {
  if (!w) return null;
  const parts = [w.tempF !== null ? `${Math.round(w.tempF)}°` : null, w.conditions, w.windMph !== null && !/\bwind\b/i.test(w.conditions ?? "") ? `wind ${Math.round(w.windMph)} mph` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Who published the results, from the link they were imported from; null when it doesn't say. */
function timer(source: string | null | undefined): string | null {
  const s = (source ?? "").toLowerCase();
  if (/trackside|athletic\.?live|anet\.live|athletic\.net/.test(s)) return "TrackSide Timing";
  if (/arrowliveresults|xmtiming/.test(s)) return "XM Timing";
  if (/badgerstate/.test(s)) return "Badger State Timing";
  if (/raceresult/.test(s)) return "RACE RESULT";
  return null;
}

// Page budget, in CSS px at 96/in: a Letter page's content box (10.1in) less the footer's 0.75in.
const PAGE = 9.35 * 96;
const ROW = 21.6;
const HEAD = 22;
const SECTION = 44;

/**
 * Race results (after the team's results PDFs): team scores, our team's block with splits, and the
 * whole field, page after page. One race at a time (?race=), from a race whose whole field was
 * imported. Web view and Download PDF like the other reports.
 */
export default async function RaceResultsPage({ params, searchParams }: PageProps<"/meets/[meetId]/reports/results">) {
  const { meetId } = await params;
  const { race: raceParam } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/join");
  const meet = await getMeet(meetId);
  if (!meet || !can(session, "view", meet)) notFound();
  const [school, program, races] = await Promise.all([getSchool(meet.schoolId), getProgram(meet.schoolId, "xc"), listRaces(meet._id)]);
  if (!school || !program) notFound();
  const db = await getDb();
  const entriesAll = await collection(db, "raceEntries").find({ raceId: { $in: races.map((r) => r._id) }, deletedAt: null }).toArray();
  // Only a race with other teams' runners has its whole field.
  const withField = races.filter((r) => entriesAll.some((e) => e.raceId === r._id && e.athleteId === null));
  const race = withField.find((r) => r._id === raceParam) ?? withField[0];

  const venue = meet.venueId ? await collection(db, "venues").findOne({ _id: meet.venueId }) : null;
  const back = { href: `/meets/${meet._id}`, label: meet.name };
  if (!race) {
    return (
      <RptShell back={back} title="Race results" subtitle={meet.name}>
        <p className="no-print mx-auto max-w-xl px-4 text-sm text-ink-2">
          No race in this meet has the whole field&apos;s results yet. Import the official results (a link or the overall PDF) and every team&apos;s results appear here.
        </p>
      </RptShell>
    );
  }

  const entries = entriesAll.filter((e) => e.raceId === race._id);
  const ours = entries.filter((e) => e.athleteId);
  const [athletes, season, imp] = await Promise.all([
    collection(db, "athletes").find({ _id: { $in: ours.map((e) => e.athleteId!) } }).toArray(),
    getSeasonFor(program._id, meet.date),
    collection(db, "imports").findOne({ _id: entries[0]?.importId }),
  ]);
  const history = await getTeamHistory(meet.schoolId, program, athletes.map((a) => a._id));
  const name = new Map(athletes.map((a) => [a._id, a]));
  const grade = (id: string) => {
    const a = name.get(id);
    return a?.graduationYear != null && season ? gradeForSeason(a.graduationYear, season.endDate) : null;
  };

  const field: ResultEntry[] = entries.map((e) => ({ name: e.athleteId ? (name.get(e.athleteId)?.displayName ?? e.name) : displayCase(e.name), team: e.teamName, place: e.place, status: e.status, timeMs: e.timeMs, ours: !!e.athleteId }));
  const { teams, incomplete, points } = scoreRace(field);
  const us = teams.find((x) => x.ours);
  const order = field.map((f, i) => ({ f, i, e: entries[i] })).sort((a, b) => (a.f.place ?? Infinity) - (b.f.place ?? Infinity) || (a.f.timeMs ?? Infinity) - (b.f.timeMs ?? Infinity));
  const finishers = order.filter((o) => o.f.status === "finished" && o.f.place !== null).length;
  const ourRows = order.filter((o) => o.f.ours && o.f.status === "finished");
  const five = topFive(ourRows.map((o) => o.f.timeMs!).filter((x) => x !== null));
  const splitCps = race.checkpoints.filter((c) => c.kind === "split").map((c) => ({ label: c.label, meters: c.distance.meters }));
  const finishMeters = race.checkpoints.find((c) => c.kind === "finish")?.distance.meters ?? 5000;
  const segHeads = [...splitCps.map((c) => c.label), `Mile ${(finishMeters / 1609.344).toFixed(1)}`];
  const histFor = (athleteId: string) => history.find((h) => h.raceId === race._id && h.athleteId === athleteId);
  const pts = (i: number) => {
    const p = points[i];
    return p === null ? "—" : p.displacer ? `(${p.points})` : String(p.points);
  };

  // Lay the whole field out over pages: what's left of page 1, then full pages.
  const used = 108 + (us ? 72 : 0) + SECTION + HEAD + teams.length * ROW + (incomplete.length ? 22 : 0) + (ourRows.length ? SECTION + HEAD + ourRows.length * ROW : 0) + SECTION + HEAD;
  const first = Math.max(0, Math.floor((PAGE - used) / ROW));
  const rest = Math.floor((PAGE - HEAD - 8) / ROW) + 1;
  const chunks = [order.slice(0, first)];
  for (let k = first; k < order.length; k += rest) chunks.push(order.slice(k, k + rest));

  const date = `${new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${meet.date}T12:00:00Z`))}, ${formatMonthDayYear(meet.date)}`;
  const by = timer(`${imp?.fileName ?? ""} ${imp?.raw.slice(0, 4000) ?? ""}`);
  const footer = {
    legend: `Compiled from the official ${by ? `${by} ` : ""}results posted ${(imp?.createdAt ?? new Date()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    right: `${meet.name} · ${race.name}`,
  };
  const individual = (rows: typeof order) => (
    <table className="rs">
      <thead>
        <tr>
          <th className="l">Pl</th>
          <th className="l">Athlete</th>
          <th className="l">Team</th>
          <th>Time</th>
          <th>Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ f, i }) => (
          <tr key={i} className={f.ours ? "us" : ""}>
            <td className="pl">{f.place ?? ""}</td>
            <td className="name">{f.name}</td>
            <td className="tm">{f.team ?? ""}</td>
            <td className="t">{f.status === "finished" ? t(f.timeMs) : f.status.toUpperCase()}</td>
            <td className={points[i]?.displacer || points[i] === null ? "d" : ""}>{f.status === "finished" ? pts(i) : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <RptShell back={back} title="Race results" subtitle={`${meet.name} · ${race.name}`}>
      {withField.length > 1 && (
        <nav className="no-print mx-auto mb-3 flex max-w-5xl flex-wrap justify-center gap-2 px-4">
          {withField.map((r) => (
            <Link key={r._id} href={`?race=${r._id}`} className={`rounded-md border px-3 py-1.5 text-[13px] ${r._id === race._id ? "border-brand bg-brand-soft font-semibold text-brand-text" : "border-line text-ink-2 hover:bg-surface-2"}`}>
              {r.name}
            </Link>
          ))}
        </nav>
      )}
      <RptPage
        title={race.name}
        meetLine={
          <>
            <div className="meet">{meet.name}</div>
            <div className="hero-meet">
              {[venue?.name, date, weatherLine(meet.weather)].filter(Boolean).map((p, k) => (
                <span key={k} className="contents">
                  {k > 0 && <span className="dv">•</span>}
                  {p}
                </span>
              ))}
            </div>
          </>
        }
        legend={footer.legend}
        right={footer.right}
      >
        {us && (
          <div className="statbar">
            <div className="c">
              <div className="n">{ordinal(us.place!)}</div>
              <div className="l">Team place</div>
            </div>
            <div className="c">
              <div className="n">{us.points}</div>
              <div className="l">Team points</div>
            </div>
            <div className="c">
              <div className="n">{teams.length}</div>
              <div className="l">Scoring teams</div>
            </div>
            <div className="c">
              <div className="n">{finishers}</div>
              <div className="l">Runners</div>
            </div>
          </div>
        )}
        <div className="sec">Team Scores</div>
        <table className="rs">
          <thead>
            <tr>
              <th className="l">Pl</th>
              <th className="l">Team</th>
              {["1st", "2nd", "3rd", "4th", "5th"].map((h, k) => (
                <th key={h} className={`c ${k === 0 ? "vl" : ""}`}>
                  {h}
                </th>
              ))}
              <th className="c vl">6th</th>
              <th className="c">7th</th>
              <th className="vl">Points</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((tm) => (
              <tr key={tm.key} className={tm.ours ? "us" : ""}>
                <td className="pl">{tm.place}</td>
                <td className="name">{tm.name}</td>
                {[0, 1, 2, 3, 4].map((k) => (
                  <td key={k} className={`c t ${k === 0 ? "vl" : ""}`}>
                    {tm.places[k] ?? ""}
                  </td>
                ))}
                <td className="c d vl">{tm.places[5] !== undefined ? `(${tm.places[5]})` : ""}</td>
                <td className="c d">{tm.places[6] !== undefined ? `(${tm.places[6]})` : ""}</td>
                <td className="t vl">{tm.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {incomplete.length > 0 && (
          <div className="incomplete">
            <b>Incomplete teams</b> (fewer than five finishers, no team score): {incomplete.join(", ")}
          </div>
        )}
        {ourRows.length > 0 && (
          <>
            <div className="sec">
              {school.shortName}
              {us && (
                <>
                  <span className="sm">
                    <b>{us.points}</b>Points
                  </span>
                  {five && (
                    <>
                      <span className="sm">
                        <b>{t(five.average)}</b>Top-5 average
                      </span>
                      <span className="sm">
                        <b>{t(five.spread)}</b>1–5 spread
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
            <table className="rs">
              <thead>
                <tr>
                  <th className="l">Team</th>
                  <th className="l">Place</th>
                  <th className="l">Athlete · Grade</th>
                  {segHeads.map((h, k) => (
                    <th key={h} className={k === 0 ? "vl" : ""}>
                      {h}
                    </th>
                  ))}
                  <th className="vl">Time</th>
                  <th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {ourRows.map(({ f, i, e }) => {
                  const h = e.athleteId ? histFor(e.athleteId) : undefined;
                  const segs = h ? segmentsAt(h, splitCps) : segHeads.map(() => null);
                  const g = e.athleteId ? grade(e.athleteId) : null;
                  return (
                    <tr key={i}>
                      <td className="l t" style={{ color: "var(--green)" }}>
                        {points[i]?.teamRank ?? ""}
                      </td>
                      <td className="l plc">{f.place ? ordinal(f.place) : ""}</td>
                      <td className="name">
                        {f.name}
                        {g !== null && g <= 12 && <span style={{ color: "var(--soft)", fontWeight: 400, fontSize: "8pt", marginLeft: 4 }}>{g}</span>}
                      </td>
                      {segs.map((ms, k) => (
                        <td key={k} className={k === 0 ? "vl" : ""}>
                          {t(ms)}
                        </td>
                      ))}
                      <td className="t vl">{t(f.timeMs)}</td>
                      <td className={points[i]?.displacer || points[i] === null ? "d" : ""}>{pts(i)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
        <div className="sec">Individual Results</div>
        {individual(chunks[0])}
      </RptPage>
      {chunks.slice(1).map((rows, k) => (
        <RptPage key={k} title={null} legend={footer.legend} right={footer.right}>
          {individual(rows)}
        </RptPage>
      ))}
    </RptShell>
  );
}

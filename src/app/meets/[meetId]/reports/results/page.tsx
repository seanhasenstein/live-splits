import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FieldFilter } from "@/components/rpt/field-filter";
import { RptPage, RptShell } from "@/components/rpt/rpt";
import { TeamMark } from "@/components/rpt/team-mark";
import { can, getSession } from "@/lib/auth/session";
import { getMeet, getProgram, getSchool, getSeasonFor, listRaces } from "@/lib/data";
import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import type { Weather } from "@/lib/db/schema";
import { gradeForSeason } from "@/lib/grade";
import { ordinal, segmentsAt } from "@/lib/reports/athlete";
import { getTeamHistory } from "@/lib/reports/history";
import { officialSegments, type ResultEntry, scoreRace, splitLabels, topFive } from "@/lib/reports/race-results";
import { teamKey } from "@/lib/race-places";
import { logoKey, logoUrl } from "@/lib/logos";
import { getLogoVersions } from "@/lib/logos-server";
import { displayCase } from "@/lib/names";
import { formatElapsed, formatMonthDayYear } from "@/lib/time";

// Public when a coach shares a meet's results; still kept out of search engines (high school runners).
export const metadata: Metadata = { title: "Race results", robots: { index: false, follow: false } };

const t = (ms: number | null) => (ms === null ? "" : formatElapsed(Math.floor(ms / 1000) * 1000, "seconds"));

function weatherLine(w: Weather | null): string | null {
  if (!w) return null;
  const parts = [w.tempF !== null ? `${Math.round(w.tempF)}°` : null, w.conditions, w.windMph !== null && !/\bwind\b/i.test(w.conditions ?? "") ? `wind ${Math.round(w.windMph)} mph` : null].filter(
    Boolean,
  );
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
 * imported. ?view=teams lists every team the way ours is, in scoring order. Web view and Download PDF
 * like the other reports.
 */
export default async function RaceResultsPage({ params, searchParams }: PageProps<"/meets/[meetId]/reports/results">) {
  const { meetId } = await params;
  const { race: raceParam, view: viewParam, q: qParam } = await searchParams;
  // From search: open with the field filtered to that runner.
  const needle = typeof qParam === "string" ? qParam.trim().toLowerCase().slice(0, 80) : "";
  const view = viewParam === "teams" ? "teams" : "overall";
  const session = await getSession();
  const meet = await getMeet(meetId);
  if (!meet) notFound();
  // Anyone may open a meet whose official results a coach made public; they see only what the timing company posted.
  const member = !!session && can(session, "view", meet);
  const publicView = !member && meet.publicResults === true;
  if (!member && !publicView) {
    if (!session) redirect("/join");
    notFound();
  }
  const [school, program, races] = await Promise.all([getSchool(meet.schoolId), getProgram(meet.schoolId, "xc"), listRaces(meet._id)]);
  if (!school || !program) notFound();
  const db = await getDb();
  const entriesAll = await collection(db, "raceEntries")
    .find({ raceId: { $in: races.map((r) => r._id) }, deletedAt: null })
    .toArray();
  // Only a race with other teams' runners has its whole field.
  const withField = races.filter((r) => entriesAll.some((e) => e.raceId === r._id && e.athleteId === null));
  const race = withField.find((r) => r._id === raceParam) ?? withField[0];

  const venue = meet.venueId ? await collection(db, "venues").findOne({ _id: meet.venueId }) : null;
  const back = member ? { href: `/meets/${meet._id}`, label: meet.name } : undefined;
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
  const [athletes, season, imp, logos] = await Promise.all([
    collection(db, "athletes")
      .find({ _id: { $in: ours.map((e) => e.athleteId!) } })
      .toArray(),
    getSeasonFor(program._id, meet.date),
    collection(db, "imports").findOne({ _id: entries[0]?.importId }),
    getLogoVersions(meet.schoolId),
  ]);
  // The host, when the venue is a school whose logo we have (and isn't us: ours is already at the left).
  const hostKey = venue ? logoKey(venue.name) : null;
  const hostLogo = hostKey && hostKey !== logoKey(school.name) && hostKey !== logoKey(school.shortName) && logos.has(hostKey) ? logoUrl(meet.schoolId, hostKey, logos.get(hostKey)!) : null;
  const heroRight = hostLogo ? (
    <div className={`host ${view === "overall" ? "web-mark" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={hostLogo} alt="" />
      Host
    </div>
  ) : null;
  const mark = (name: string | null, isOurs: boolean, size?: number, className?: string) =>
    name || isOurs ? <TeamMark name={name ?? ""} ours={isOurs} schoolId={meet.schoolId} logos={logos} size={size} className={className} /> : null;
  const history = await getTeamHistory(
    meet.schoolId,
    program,
    athletes.map((a) => a._id),
  );
  const name = new Map(athletes.map((a) => [a._id, a]));
  const grade = (id: string) => {
    const a = name.get(id);
    return a?.graduationYear != null && season ? gradeForSeason(a.graduationYear, season.endDate) : null;
  };

  const field: ResultEntry[] = entries.map((e) => ({
    // The public page shows our runners as the timing company printed them, not as our roster has them.
    name: e.athleteId && !publicView ? (name.get(e.athleteId)?.displayName ?? e.name) : displayCase(e.name),
    team: e.teamName,
    place: e.place,
    status: e.status,
    timeMs: e.timeMs,
    ours: !!e.athleteId,
  }));
  const { teams, incomplete, points, ourKey } = scoreRace(field);
  const us = teams.find((x) => x.ours);
  const order = field.map((f, i) => ({ f, i, e: entries[i] })).sort((a, b) => (a.f.place ?? Infinity) - (b.f.place ?? Infinity) || (a.f.timeMs ?? Infinity) - (b.f.timeMs ?? Infinity));
  const finishers = order.filter((o) => o.f.status === "finished" && o.f.place !== null).length;
  const ourRows = order.filter((o) => o.f.ours && o.f.status === "finished");
  const splitCps = race.checkpoints.filter((c) => c.kind === "split").map((c) => ({ label: c.label, meters: c.distance.meters }));
  const finishMeters = race.checkpoints.find((c) => c.kind === "finish")?.distance.meters ?? 5000;
  const segHeads = [...splitCps.map((c) => c.label), `Mile ${(finishMeters / 1609.344).toFixed(1)}`];
  const histFor = (athleteId: string) => history.find((h) => h.raceId === race._id && h.athleteId === athleteId);
  // The results' own mat splits, when they publish any, for every team; otherwise our taps for us alone.
  const official = splitLabels(entries);
  const officialHeads = [...official, `Mile ${(finishMeters / 1609.344).toFixed(1)}`];
  const keyOf = (f: ResultEntry) => (f.ours ? ourKey : f.team ? teamKey(f.team) : null);
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
  /** A team's runners in place order: team rank, place, grade, splits when there are any, time and points. */
  const teamBlock = (key: string, title?: string) => {
    const rows = order.filter((o) => keyOf(o.f) === key && o.f.status === "finished");
    const all = order.filter((o) => keyOf(o.f) === key);
    if (all.length === 0) return null;
    const tm = teams.find((x) => x.key === key);
    // Ours by team, so a runner of ours not linked to the roster is in our block too.
    const ours = key === ourKey;
    const five = topFive(rows.map((o) => o.f.timeMs).filter((x): x is number => x !== null));
    const segsOf = (o: (typeof order)[number]): (number | null)[] | null => {
      if (official.length) return officialSegments(o.e.splits, official, o.f.timeMs);
      // Our recorded splits are ours to share: not on the public page.
      if (!ours || !o.e.athleteId || publicView) return null;
      const h = histFor(o.e.athleteId);
      return h ? segmentsAt(h, splitCps) : segHeads.map(() => null);
    };
    const segs = all.map(segsOf);
    const heads = official.length ? officialHeads : ours ? segHeads : [];
    const showSplits = heads.length > 0 && segs.some((x) => x?.some((v) => v !== null));
    const gradeOf = (o: (typeof order)[number]) => {
      const g = o.e.athleteId && !publicView ? grade(o.e.athleteId) : o.e.grade;
      return g !== null && g <= 12 ? g : null;
    };
    return (
      <div key={key} id={`team-${key}`} className="team-block">
        <div className="sec">
          {mark(all[0].f.team, ours, 22, view === "overall" ? "web-mark" : "")}
          {title ?? all[0].f.team}
          {/* The Overall view has the place in Team Scores just above, as the PDFs do. */}
          {view === "teams" &&
            (tm ? (
              <span className="sm">
                <b>{ordinal(tm.place!)}</b>Place
              </span>
            ) : (
              <span className="sm">No team score</span>
            ))}
          {tm && (
            <span className="sm">
              <b>{tm.points}</b>Points
            </span>
          )}
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
        </div>
        <div className="scroll">
          <table className="rs" style={{ tableLayout: "fixed" }}>
            {/* Fixed widths, so the columns line up from one team to the next. */}
            <colgroup>
              {[7, 9, 100 - 33 - (showSplits ? heads.length * 10 : 0), ...(showSplits ? heads.map(() => 10) : []), 10, 7].map((w, k) => (
                <col key={k} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="l">Team</th>
                <th className="l">Place</th>
                <th className="l">Athlete · Grade</th>
                {showSplits &&
                  heads.map((h, k) => (
                    <th key={h} className={k === 0 ? "vl" : ""}>
                      {h}
                    </th>
                  ))}
                <th className="vl">Time</th>
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>
              {all.map((o, n) => {
                const { f, i } = o;
                const g = gradeOf(o);
                return (
                  <tr key={i} className={view === "teams" && ours ? "us" : ""}>
                    <td className="l t" style={{ color: "var(--green)" }}>
                      {points[i]?.teamRank ?? ""}
                    </td>
                    <td className="l plc">{f.place ? ordinal(f.place) : ""}</td>
                    <td className="name">
                      {f.name}
                      {g !== null && (
                        <span
                          style={{
                            color: "var(--soft)",
                            fontWeight: 400,
                            fontSize: "8pt",
                            marginLeft: 4,
                          }}
                        >
                          {g}
                        </span>
                      )}
                    </td>
                    {showSplits &&
                      (segs[n] ?? heads.map(() => null)).map((ms, k) => (
                        <td key={k} className={k === 0 ? "vl" : ""}>
                          {t(ms)}
                        </td>
                      ))}
                    <td className="t vl">{f.status === "finished" ? t(f.timeMs) : f.status.toUpperCase()}</td>
                    <td className={points[i]?.displacer || points[i] === null ? "d" : ""}>{f.status === "finished" ? pts(i) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const individual = (rows: typeof order) => (
    <table className="rs" style={{ tableLayout: "fixed" }}>
      {/* Fixed widths, so the columns line up from one page's table to the next. */}
      <colgroup>
        {[5, 35, 40, 11, 9].map((w, k) => (
          <col key={k} style={{ width: `${w}%` }} />
        ))}
      </colgroup>
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
          <tr key={i} className={f.ours ? "us" : ""} data-team={f.team ?? ""} data-name={f.name.toLowerCase()} hidden={!!needle && !f.name.toLowerCase().includes(needle)}>
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

  const meetLine = (
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
  );
  const statbar = us && (
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
  );

  // The Teams view on paper: whole team blocks packed onto pages, what fits after the hero first.
  const blockKeys = [...teams.map((x) => x.key), ...[...new Set(order.map((o) => keyOf(o.f)).filter((k): k is string => k !== null))].filter((k) => !teams.some((x) => x.key === k)).sort()];
  const teamPages: string[][] = [[]];
  let room = PAGE - 108 - (us ? 72 : 0);
  for (const k of blockKeys) {
    const need = SECTION + HEAD + order.filter((o) => keyOf(o.f) === k).length * ROW;
    if (need > room && teamPages[teamPages.length - 1].length > 0) {
      teamPages.push([]);
      room = PAGE;
    }
    teamPages[teamPages.length - 1].push(k);
    room -= need;
  }
  const tab = (v: "overall" | "teams") => `?race=${race._id}${v === "teams" ? "&view=teams" : ""}`;

  return (
    <RptShell back={back} title="Race results" subtitle={`${meet.name} · ${race.name}`}>
      {withField.length > 1 && (
        <nav className="no-print mx-auto mb-3 flex max-w-5xl flex-wrap justify-center gap-2 px-4">
          {withField.map((r) => (
            <Link
              key={r._id}
              href={`?race=${r._id}${view === "teams" ? "&view=teams" : ""}`}
              className={`rounded-md border px-3 py-1.5 text-[13px] ${r._id === race._id ? "border-brand bg-brand-soft font-semibold text-brand-text" : "border-line text-ink-2 hover:bg-surface-2"}`}
            >
              {r.name}
            </Link>
          ))}
        </nav>
      )}
      <nav className="no-print mx-auto mb-3 flex max-w-5xl justify-center px-4" aria-label="Results view">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {(["overall", "teams"] as const).map((v) => (
            <Link
              key={v}
              href={tab(v)}
              aria-current={view === v ? "page" : undefined}
              className={`rounded-md px-4 py-1.5 text-[13px] ${view === v ? "bg-brand-soft font-semibold text-brand-text" : "text-ink-2 hover:bg-surface-2"}`}
            >
              {v === "overall" ? "Overall" : "Teams"}
            </Link>
          ))}
        </div>
      </nav>
      {view === "teams" ? (
        // Keyed by race, so switching races starts fresh (the field filter hides rows in the DOM).
        <div key={race._id} className="teams-view">
          {teamPages.map((keys, n) => (
            <RptPage key={n} title={n === 0 ? race.name : null} meetLine={n === 0 ? meetLine : undefined} heroRight={heroRight} legend={footer.legend} right={footer.right}>
              {n === 0 && statbar}
              {n === 0 && (
                <nav className="team-jump no-print" aria-label="Jump to a team">
                  {blockKeys.map((k) => {
                    const o = order.find((x) => keyOf(x.f) === k)!;
                    return (
                      <a key={k} href={`#team-${k}`} className={k === ourKey ? "us" : ""}>
                        {mark(o.f.team, k === ourKey, 14)}
                        {k === ourKey ? school.shortName : o.f.team}
                      </a>
                    );
                  })}
                </nav>
              )}
              {keys.map((k) => teamBlock(k, k === ourKey ? school.shortName : undefined))}
            </RptPage>
          ))}
        </div>
      ) : (
        <div key={race._id} className="overall-view">
          <RptPage title={race.name} meetLine={meetLine} heroRight={heroRight} legend={footer.legend} right={footer.right}>
            {statbar}
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
                    <td className="name">
                      {mark(tm.name, tm.ours, 16, "web-mark")}
                      {tm.name}
                    </td>
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
            {ourRows.length > 0 && teamBlock(keyOf(ourRows[0].f)!, school.shortName)}
            <div className="sec" id="field" style={{ scrollMarginTop: 72 }}>
              Individual Results
            </div>
            <FieldFilter
              initialQ={needle}
              initialShown={needle ? order.filter((o) => o.f.name.toLowerCase().includes(needle)).length : null}
              teams={[...new Set(order.map((o) => o.f.team).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b))}
            />
            {individual(chunks[0])}
          </RptPage>
          {chunks.slice(1).map((rows, k) => (
            <RptPage key={k} title={null} legend={footer.legend} right={footer.right}>
              {individual(rows)}
            </RptPage>
          ))}
        </div>
      )}
    </RptShell>
  );
}

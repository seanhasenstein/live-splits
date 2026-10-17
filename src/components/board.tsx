"use client";

import Link from "next/link";
import { Fragment, type ReactNode, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, History as HistoryIcon, Info, MoveHorizontal, Pencil, Share } from "lucide-react";
import { PlacesCard } from "@/components/places-card";
import { TeamCard, type TeamRow } from "@/components/team-card";
import { CheckpointCounts, DeltaText, RaceStatusBar, RecordPill, RunningClock } from "@/components/race-status";
import { SessionMenu } from "@/components/session-menu";
import { Alert, AppHeader, Badge, Button, Card, Checkbox, Field, Input, LinkButton, LiveDot, SectionLabel, Segmented, Sheet, Time, Toast } from "@/components/ui";
import { useClock } from "@/lib/client/clock";
import { useLocalValue } from "@/lib/client/use-local-value";
import { useTimeFormat } from "@/lib/client/time-format";
import { useRaceTaps } from "@/lib/client/use-race-taps";
import { type AthleteStatus, type CheckpointState, expectedAt, type Mark, replay, replayStatuses, type Slot, STATUS_LABEL, STATUS_LONG } from "@/lib/replay";
import type { AthleteRaceStatus, Precision, RacePlaces } from "@/lib/db/schema";
import { type CheckpointPlaces, fieldScores, ordinal as placeText, type OurTeam, racePlaces, replayTicks } from "@/lib/race-places";
import { paceMsPerMile, projectElapsed } from "@/lib/pace";
import { RECORD_LABEL, recordBadge } from "@/lib/records";
import type { LineupBests, PriorFinish } from "@/lib/results/bests";
import { formatClock, formatDateWithYear, formatElapsed, formatLocalDate, parseTypedTime } from "@/lib/time";

type RaceInfo = {
  id: string;
  name: string;
  gunTimeMs: number | null;
  finished: boolean;
  /** Official times, but places the app computed within our division (see races.placesDerived). */
  placesDerived: boolean;
  checkpoints: { id: string; label: string; meters: number; kind: "split" | "finish" }[];
  athleteIds: string[];
  /** Level label per athlete in this race (Varsity / JV). */
  levels: Record<string, string>;
  /** What each runner had to beat coming in: PR, season best, course best, meet best — and every earlier finish at this distance. */
  bests: LineupBests;
  /** "5K", for "Fastest 5Ks". */
  distanceLabel: string;
  /** The meet is marked as not counting for records (short course…): no badges. */
  recordsExcluded: boolean;
  /** Place counting, when the race has it on and this viewer may see it. */
  places: RacePlaces | null;
  /** Our school, as places show it. */
  ourTeam: OurTeam;
};

type Props = {
  meetId: string;
  meetName: string;
  /** Local ISO date; the season year for History. */
  meetDate: string;
  session: { name: string; role: string };
  initialRaceId: string | null;
  timeZone: string;
  races: RaceInfo[];
  athletes: Record<string, string>;
  /** Athlete gender, for the Girls / Boys filter on a combined race. */
  genders: Record<string, "F" | "M" | "X">;
  /** Grade this season, when known. */
  grades: Record<string, number | null>;
  /** `?athlete=` in the URL: open that runner's sheet on load. */
  initialAthleteId: string | null;
  canFix: boolean;
  canTap: boolean;
};

/** A time that just arrived glows this long. */
const FRESH_MS = 4000;
/** A projection this far in the past reads "overdue". */
const OVERDUE_MS = 60_000;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const eventTimeMs = (_e: SyntheticEvent) => Date.now();


export function Board({ meetId, meetName, meetDate, session, initialRaceId, timeZone, races, athletes, genders, grades, initialAthleteId, canFix, canTap }: Props) {
  const [raceId, setRaceId] = useState(() => (races.some((r) => r.id === initialRaceId) ? initialRaceId! : (races[0]?.id ?? "")));
  const race = races.find((r) => r.id === raceId) ?? races[0];

  // The deep-linked athlete opens once, for the race the page opened on; switching races drops it from the URL.
  const [openedOn] = useState(raceId);
  const [pendingAthlete, setPendingAthlete] = useState(initialAthleteId);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("race", raceId);
    if (raceId !== openedOn) url.searchParams.delete("athlete");
    window.history.replaceState(window.history.state, "", url);
  }, [raceId, openedOn]);

  if (!race) {
    return (
      <main className="p-6 text-sm text-ink-2">
        No races yet.{" "}
        <Link href={`/meets/${meetId}`} className="text-ink underline">
          Back to the meet
        </Link>
        .
      </main>
    );
  }

  return (
    <>
      <AppHeader title={meetName} titleHref={`/meets/${meetId}`} subtitle="Live results" right={<SessionMenu name={session.name} role={session.role} />} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4">
        {races.length > 1 && (
          <Segmented value={race.id} onChange={setRaceId} options={races.map((r) => ({ value: r.id, label: r.name }))} className="mb-3 lg:max-w-md" />
        )}
        <RaceBoard
          key={race.id}
          meetId={meetId}
          meetName={meetName}
          meetDate={meetDate}
          race={race}
          timeZone={timeZone}
          athletes={athletes}
          genders={genders}
          grades={grades}
          initialAthleteId={race.id === openedOn ? pendingAthlete : null}
          onInitialAthleteShown={() => setPendingAthlete(null)}
          canFix={canFix}
          canTap={canTap}
        />
      </main>
    </>
  );
}

/** One board cell: official time if imported, else the app's mark. `elapsedMs` is from the gun (null without one). */
type Cell = { mark: Mark | undefined; official: number | null; precision: Precision | null; elapsedMs: number | null; absoluteMs: number | null; missed: boolean; beforeGun?: boolean };
type Row = { athleteId: string; marks: (Mark | undefined)[]; cells: Cell[]; reached: number; officialStatus: string | null; officialPlace: number | null; status: AthleteStatus | undefined; record: ReturnType<typeof recordBadge> };

function RaceBoard({
  meetId,
  meetName,
  meetDate,
  race: raceIn,
  timeZone,
  athletes,
  genders,
  grades,
  initialAthleteId,
  onInitialAthleteShown,
  canFix,
  canTap,
}: {
  meetId: string;
  meetName: string;
  meetDate: string;
  race: RaceInfo;
  timeZone: string;
  athletes: Record<string, string>;
  genders: Record<string, "F" | "M" | "X">;
  grades: Record<string, number | null>;
  initialAthleteId: string | null;
  onInitialAthleteShown: () => void;
  canFix: boolean;
  canTap: boolean;
}) {
  const clock = useClock();
  const { taps, gunTimeMs, official, field, places: livePlaces, officialLive, finished, longRunning, staleMinutes, send, online, loaded, recording, seenAt } = useRaceTaps(raceIn.id, raceIn.gunTimeMs);
  // Places as of the last poll (on and visible to this viewer, as the page had it): turning places off
  // mid-race clears them here within seconds, and turning them on shows them.
  const race = useMemo(() => (livePlaces === undefined ? raceIn : { ...raceIn, places: livePlaces?.on ? livePlaces : null }), [raceIn, livePlaces]);
  const isFinished = race.finished || finished;
  const hasOfficial = Object.keys(official).length > 0;
  const state = useMemo(
    () => replay({ checkpoints: race.checkpoints.map((c) => ({ ...c, distance: { value: 0, unit: "mi", meters: 0 }, kind: "split" })) }, taps),
    [race, taps],
  );
  const statuses = useMemo(() => replayStatuses(taps), [taps]);
  const placesByCp = useMemo(
    () => (race.places ? racePlaces(race.checkpoints.map((c) => c.id), state, replayTicks(taps), gunTimeMs) : new Map<string, CheckpointPlaces>()),
    [race, state, taps, gunTimeMs],
  );
  const officialPlaces = useMemo(() => {
    // A division race's official places are the app's ranking within our division: not comparable with
    // counted overall places, and the field may hold several divisions. No team scores from it either.
    if (!race.places || field.length === 0 || race.placesDerived) return null;
    const place = new Map(Object.entries(official).flatMap(([id, o]) => (o.place !== null && o.status === "finished" ? [[id, o.place] as const] : [])));
    return { ...fieldScores(field), place };
  }, [race.places, race.placesDerived, field, official]);
  /** A runner's place at checkpoint i, and the change since the last checkpoint counted the same way (+ = passed people). */
  const placeAt = (athleteId: string, i: number): { place: number; overall: boolean; gained: number | null } | null => {
    const c = race.checkpoints[i];
    const here = placesByCp.get(c.id);
    const official = c.kind === "finish" && officialPlaces?.place.has(athleteId) ? officialPlaces.place.get(athleteId)! : null;
    const place = official ?? here?.place.get(athleteId) ?? null;
    if (place === null) return null;
    // With no tracked teams everyone else is Other, so the places are overall.
    const overall = official !== null || !!here?.countingAll || (race.places?.teams.length ?? 0) === 0;
    let gained: number | null = null;
    for (let j = i - 1; j >= 0 && gained === null; j--) {
      const before = placesByCp.get(race.checkpoints[j].id);
      const p = before?.place.get(athleteId);
      if (p !== undefined && (before!.countingAll || (race.places?.teams.length ?? 0) === 0) === overall) gained = p - place;
    }
    return { place, overall, gained };
  };
  const [fix, setFix] = useState<{ athleteId: string; cpIndex: number } | null>(null);
  const [statusFor, setStatusFor] = useState<string | null>(null);
  // The open runner's sheet is in the URL (?athlete=) so it can be shared and reopened.
  const [athleteSheet, setAthleteSheetState] = useState<string | null>(initialAthleteId && race.athleteIds.includes(initialAthleteId) ? initialAthleteId : null);
  useEffect(() => {
    if (initialAthleteId) onInitialAthleteShown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setAthleteSheet = (id: string | null) => {
    setAthleteSheetState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("athlete", id);
    else url.searchParams.delete("athlete");
    window.history.replaceState(window.history.state, "", url);
  };
  // Server-corrected clock, ticking once a second while the race runs (race clock, overdue).
  // Depends on the offset, not the hook's object (which is new every render).
  const running = gunTimeMs !== null && !isFinished;
  const offsetMs = clock.sync?.offsetMs ?? null;
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!running || offsetMs === null) return;
    const tick = () => setNowMs(Date.now() + offsetMs);
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [running, offsetMs]);
  // The fresh glow runs on the device clock (so does seenAt) and only needs a ticker for a few seconds after new taps.
  const [localNow, setLocalNow] = useState(0);
  useEffect(() => {
    if (seenAt.size === 0) return;
    const tick = () => setLocalNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    const stop = setTimeout(() => clearInterval(t), FRESH_MS + 1500);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [seenAt]);
  const isFresh = (tapId: string | undefined) => {
    const at = tapId ? seenAt.get(tapId) : undefined;
    return at !== undefined && localNow > 0 && localNow - at < FRESH_MS;
  };
  const [editing, setEditing] = useState(false);
  // A combined race (boys and girls together) gets a filter; the counts follow it.
  const combined = race.athleteIds.some((id) => genders[id] === "F") && race.athleteIds.some((id) => genders[id] === "M");
  const [who, setWho] = useState<"all" | "F" | "M">("all");
  const shownIds = useMemo(() => (combined && who !== "all" ? race.athleteIds.filter((id) => genders[id] === who) : race.athleteIds), [combined, who, race.athleteIds, genders]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const { ft } = useTimeFormat();
  const fmt = useCallback(
    (ms: number | null) => (ms === null ? "—" : gunTimeMs ? (ms < gunTimeMs ? "before gun" : ft(ms - gunTimeMs)) : formatClock(ms, timeZone)),
    [gunTimeMs, timeZone, ft],
  );

  // A sheet for someone no longer in this race (lineup edited underneath it) just isn't shown.
  const openAthlete = athleteSheet && race.athleteIds.includes(athleteSheet) ? athleteSheet : null;

  // Every runner in race order; `rows` is the filtered view of it. The athlete sheet and team
  // positions read from the full set so a filter never blanks a sheet or changes a rank.
  const allRows = useMemo<Row[]>(() => {
    const cps = race.checkpoints.map((c) => state.get(c.id));
    const rows = race.athleteIds.map((athleteId): Row => {
      const marks = cps.map((cp) => cp?.byAthlete.get(athleteId));
      const off = official[athleteId];
      const cells = race.checkpoints.map((c, i): Cell => {
        const m = marks[i];
        const o = off?.byCheckpoint[c.id] ?? (c.kind === "finish" ? (off?.finishMs ?? null) : null);
        if (o !== null && o !== undefined) return { mark: m, official: o, precision: off.precision, elapsedMs: o, absoluteMs: null, missed: false, beforeGun: false };
        const abs = m && !m.missed && m.timeMs !== null ? m.timeMs : null;
        // A tap from before the gun (race restarted) isn't a time: shown as "before gun", counted as nothing.
        const beforeGun = abs !== null && !!gunTimeMs && abs < gunTimeMs;
        return { mark: m, official: null, precision: null, elapsedMs: abs !== null && gunTimeMs && !beforeGun ? abs - gunTimeMs : null, absoluteMs: beforeGun ? null : abs, missed: !!m?.missed, beforeGun };
      });
      let reached = -1;
      cells.forEach((cell, i) => {
        if (cell.official !== null || cell.absoluteMs !== null) reached = i;
      });
      // Official results outrank an app-side DNS/DNF: the timing company saw them finish.
      // A finish that beats what they came in with. Official once imported (or live from the mats); provisional from a tap.
      const finishCell = cells.find((_, i) => race.checkpoints[i].kind === "finish");
      const finishMs = finishCell ? (finishCell.official ?? finishCell.elapsedMs) : null;
      const finished = !!finishCell && !finishCell.missed && !finishCell.beforeGun && (off ? off.status === "finished" : !statuses.get(athleteId));
      const record = race.recordsExcluded || !finished ? null : recordBadge(finishMs, race.bests[athleteId], !!finishCell?.official);
      return { athleteId, marks, cells, reached, officialStatus: off?.status ?? null, officialPlace: off?.place ?? null, status: off ? undefined : statuses.get(athleteId), record };
    });
    // Compare like with like: official times are from the gun, app times are elapsed when
    // there's a gun (else wall-clock, which is still monotonic within one race).
    const key = (r: Row) => {
      const c = r.cells[r.reached];
      return c.official ?? c.elapsedMs ?? c.absoluteMs ?? 0;
    };
    // Anyone out of the race (app status, or official DNS/DNF) sits at the bottom.
    const out = (r: Row) => (r.status || (r.officialStatus && r.officialStatus !== "finished") ? 1 : 0);
    // Not yet seen: the coach's order (the lineup as arranged on the race page), same as the record screen.
    const lineupIndex = new Map(race.athleteIds.map((id, i) => [id, i]));
    return rows.sort((a, b) => {
      if (out(a) !== out(b)) return out(a) - out(b);
      if (a.reached !== b.reached) return b.reached - a.reached;
      if (a.reached >= 0) return key(a) - key(b);
      return (lineupIndex.get(a.athleteId) ?? 0) - (lineupIndex.get(b.athleteId) ?? 0);
    });
  }, [race, state, official, gunTimeMs, statuses]);
  const rows = useMemo(() => (shownIds.length === race.athleteIds.length ? allRows : allRows.filter((r) => shownIds.includes(r.athleteId))), [allRows, shownIds, race.athleteIds.length]);

  const pendingTotal = race.checkpoints.reduce((n, c) => n + (state.get(c.id)?.pending.length ?? 0), 0);

  const counts = race.checkpoints.map((c, i) => {
    const has = (r: Row) => r.cells[i].official !== null || r.cells[i].absoluteMs !== null;
    return {
      id: c.id,
      label: c.label,
      n: rows.filter(has).length,
      out: rows.filter((r) => !has(r) && (!expectedAt(r.status, i, race.checkpoints) || (!!r.officialStatus && r.officialStatus !== "finished"))).length,
      // Not also counted as out: an official DNS/DNF outranks an app "missed".
      missed: rows.filter((r) => !has(r) && r.cells[i].missed && expectedAt(r.status, i, race.checkpoints) && !(r.officialStatus && r.officialStatus !== "finished")).length,
    };
  });

  // Which checkpoint the table shows: All (the overview), or one checkpoint with everything at it.
  // Remembered on this phone once picked; until then it follows the race (the latest checkpoint
  // with times while it runs) and shows All once it's over.
  const [focusPref, setFocusPref] = useLocalValue(`ls_board_focus_${race.id}`);
  // The latest checkpoint about half the field has reached: jumping at the leader would empty the table.
  const latestWithTimes = counts.reduce((last, c, i) => (c.n > 0 && c.n * 2 >= shownIds.length ? i : last), -1);
  const pickedIndex = focusPref && focusPref !== "all" ? race.checkpoints.findIndex((c) => c.id === focusPref) : -1;
  const focusIndex: number | null =
    focusPref === "all"
      ? null
      : pickedIndex >= 0
        ? pickedIndex
        : !isFinished && !editing && race.checkpoints.length > 1 && gunTimeMs !== null && latestWithTimes >= 0
          ? latestWithTimes
          : null;

  // Elapsed-from-gun time at a checkpoint (official beats app), for projections and the team line.
  const elapsedAt = (row: Row, i: number): number | null => {
    const c = row.cells[i];
    return c ? (c.official ?? c.elapsedMs) : null;
  };
  /**
   * While the race runs: when they'd reach checkpoint `i` at their last segment's pace.
   * Only for checkpoints after their last real time, and never for anyone out of the race.
   */
  const projectAt = (row: Row, i: number): number | null => {
    if (isFinished || row.status || (row.officialStatus && row.officialStatus !== "finished")) return null;
    return projectElapsed(
      race.checkpoints.map((c) => c.meters),
      race.checkpoints.map((_, j) => elapsedAt(row, j)),
      i,
    );
  };
  // "Overdue" is a cue for the people who can do something about it; viewers just see the projection.
  const staff = canFix || canTap;
  /** Past their projected time by more than a minute: worth a look. */
  const overdue = (projected: number) => {
    const n = clock.now();
    return n !== null && gunTimeMs !== null && n - gunTimeMs - projected > OVERDUE_MS;
  };
  // Finish times of runners still in the race, for the team line (a combined race needs the Girls/Boys filter first).
  // Our team checkpoint by checkpoint (a combined race needs the Girls/Boys filter first): the scorers'
  // places, the team's points and place when places were counted, and the 1–5 spread and top-five average.
  const teamRows: TeamRow[] = race.checkpoints.map((c, i) => {
    const inRace = rows.filter((r) => !(r.status || (r.officialStatus && r.officialStatus !== "finished")));
    const times = inRace
      .map((r) => elapsedAt(r, i))
      .filter((t): t is number => t !== null)
      .sort((a, b) => a - b);
    const top5 = times.length >= 5 ? times.slice(0, 5) : null;
    let places: number[] = [];
    let overall = true;
    let points: number | null = null;
    let teamPlace: number | null = null;
    let approx = false;
    const rank = (scores: { team: string; points: number | null }[]) => {
      const scored = scores.filter((x) => x.points !== null);
      const k = scored.findIndex((x) => x.team === "us");
      return k >= 0 ? k + 1 : null;
    };
    if (race.places) {
      if (c.kind === "finish" && officialPlaces && !combined && inRace.some((r) => officialPlaces.place.has(r.athleteId))) {
        // Official results: real places and real team scores.
        // The scoring places (incomplete teams and 8th+ runners taken out), so the five add up to the points.
        const us = officialPlaces.scores.find((x) => x.team === "us");
        places = us?.places.length ? [...us.places] : inRace.flatMap((r) => (officialPlaces.place.has(r.athleteId) ? [officialPlaces.place.get(r.athleteId)!] : []));
        points = us?.points ?? null;
        teamPlace = rank(officialPlaces.scores);
      } else {
        const cp = placesByCp.get(c.id);
        if (cp) {
          places = inRace.flatMap((r) => (cp.place.has(r.athleteId) ? [cp.place.get(r.athleteId)!] : []));
          overall = cp.countingAll || race.places.teams.length === 0;
          // Points need someone to score against (the whole-meet estimate, or the tracked teams), and a
          // single-gender field: a boys-and-girls race's counted taps mix both, so no team points there.
          const table = combined ? null : (cp.estimate ?? (race.places.teams.length > 0 ? cp.scores : null));
          if (table) {
            const us = table.find((x) => x.team === "us");
            points = us?.points ?? null;
            teamPlace = rank(table.filter((x) => x.team !== "*"));
            approx = !!cp.estimate;
            // The scoring places that make up those points.
            if (us?.places.length) places = [...us.places];
          }
        }
      }
    }
    return {
      label: c.label,
      timed: times.length,
      avgMs: top5 ? Math.round(top5.reduce((a, b) => a + b, 0) / 5) : null,
      spreadMs: top5 ? top5[4] - top5[0] : null,
      places: places.sort((a, b) => a - b).slice(0, 7),
      overall,
      points,
      teamPlace,
      approx,
    };
  });

  /**
   * One checkpoint with everything at it, a column each: time from the gun, split, the pace change
   * from the previous segment, and the place with its change. In order at that checkpoint; anyone
   * not there yet follows with a projection, anyone out of the race last.
   */
  const checkpointTable = (i: number) => {
    const c = race.checkpoints[i];
    // From the gun; with no gun recorded, the clock times (splits between them still work).
    const timeOf = (cell: Cell | undefined) => (cell ? (cell.official ?? cell.elapsedMs ?? (gunTimeMs === null ? cell.absoluteMs : null)) : null);
    const segMeters = c.meters - (i > 0 ? race.checkpoints[i - 1].meters : 0);
    const prevSegMeters = i > 0 ? race.checkpoints[i - 1].meters - (i > 1 ? race.checkpoints[i - 2].meters : 0) : 0;
    const list = rows.map((r) => {
      const cell = r.cells[i];
      const here = timeOf(cell);
      const out = here === null && !cell.missed && ((!!r.status && !expectedAt(r.status, i, race.checkpoints)) || (!!r.officialStatus && r.officialStatus !== "finished"));
      const projected = here === null && !cell.missed && !out ? projectAt(r, i) : null;
      return { r, cell, here, out, projected };
    });
    list.sort((a, b) => Number(a.out) - Number(b.out) || Number(a.here === null) - Number(b.here === null) || (a.here ?? a.projected ?? Infinity) - (b.here ?? b.projected ?? Infinity));
    // Tight padding and no wrapping in the number columns, so the five columns fit a narrow phone.
    const th = "px-1.5 py-2 text-right font-semibold whitespace-nowrap";
    return (
      <Card className="overflow-hidden">
        {/* A very narrow phone scrolls the table sideways inside its card instead of cutting off the last column. */}
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
              <th className="px-3 py-2 font-semibold sm:px-4">Athlete</th>
              <th className={th}>Time</th>
              {i > 0 && <th className={th}>Split</th>}
              <th className={`${th} ${race.places ? "" : "pr-3 sm:pr-4"}`} title={i > 0 ? "Pace change from the previous segment (+ slower, − faster)" : "Pace per mile"}>
                {i > 0 ? "Pace ±" : "Pace"}
              </th>
              {race.places && <th className="py-2 pr-3 pl-2 text-left font-semibold sm:pr-4">Place</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {!loaded && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-ink-3">
                  Loading…
                </td>
              </tr>
            )}
            {list.map(({ r, cell, here, out, projected }) => {
              // From the gun, the first split starts at 0; with only clock times there's no start to count from.
              const start = gunTimeMs !== null || hasOfficial ? 0 : null;
              const prev = i > 0 ? timeOf(r.cells[i - 1]) : here !== null ? start : null;
              const split = here !== null && prev !== null ? here - prev : null;
              const before = i > 1 ? timeOf(r.cells[i - 2]) : i === 1 ? start : null;
              const prevSplit = i > 0 && prev !== null && before !== null ? prev - before : null;
              const paceChange = split !== null && prevSplit !== null && segMeters > 0 && prevSegMeters > 0 ? paceMsPerMile(split, segMeters) - paceMsPerMile(prevSplit, prevSegMeters) : null;
              const m = cell.mark;
              const flag = cell.official !== null ? "" : m && !cell.missed && here !== null ? (m.estimate ? "~" : m.edited ? "*" : "") : "";
              const place = race.places && (cell.official !== null || cell.absoluteMs !== null) ? placeAt(r.athleteId, i) : null;
              const timeNode =
                projected !== null ? (
                  <span className={staff && overdue(projected) ? "text-gold-text/80" : "text-ink-3"}>
                    <Time>~{formatElapsed(projected).replace(/\.\d$/, "")}</Time>
                    {staff && overdue(projected) && <span className="block text-[11px]">overdue</span>}
                  </span>
                ) : (
                  <Time className={cell.missed || cell.beforeGun ? "text-ink-3 italic" : here !== null ? "font-semibold text-ink" : "text-ink-3"}>
                    {cell.missed ? "missed" : cell.beforeGun ? "before gun" : here === null ? "—" : cell.official === null && cell.elapsedMs === null && cell.absoluteMs !== null ? fmt(cell.absoluteMs) : ft(here, cell.precision)}
                    {flag}
                  </Time>
                );
              return (
                <tr key={r.athleteId} onClick={editing ? undefined : () => setAthleteSheet(r.athleteId)} className={`${here === null ? "text-ink-3" : ""} ${editing ? "" : "cursor-pointer hover:bg-surface-2 active:bg-surface-2"}`}>
                  <td className={`px-3 py-2.5 align-top font-medium sm:px-4 ${here === null ? "" : "text-ink"}`}>
                    {editing ? (
                      <button type="button" onClick={() => setStatusFor(r.athleteId)} className="-mx-1.5 rounded px-1.5 py-0.5 text-left hover:bg-gold-soft" title="Set DNS / DNR / DNF">
                        {athletes[r.athleteId]}
                      </button>
                    ) : (
                      <span>
                        <NameWithPill name={athletes[r.athleteId] ?? "?"} pill={c.kind === "finish" && r.record ? <RecordPill badge={r.record} className="ml-1.5 align-[2px]" /> : null} />
                      </span>
                    )}
                    {out && (
                      <span className="mt-0.5 block">
                        <Badge tone="neutral">{r.status ? STATUS_LABEL[r.status.status] : (r.officialStatus ?? "").toUpperCase()}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-1.5 py-2.5 text-right align-top whitespace-nowrap">
                    {editing && cell.official === null ? (
                      <button type="button" onClick={() => setFix({ athleteId: r.athleteId, cpIndex: i })} className="rounded-md border border-dashed border-line-strong px-1.5 py-0.5 hover:bg-surface-2 active:bg-brand-soft">
                        {timeNode}
                      </button>
                    ) : (
                      <span className={`rounded-md px-1 py-0.5 transition-colors duration-1000 ${isFresh(m?.tapId) ? "bg-brand-soft" : ""}`}>{timeNode}</span>
                    )}
                  </td>
                  {i > 0 && <td className="px-1.5 py-2.5 text-right align-top whitespace-nowrap">{split !== null ? <Time>{ft(split)}</Time> : ""}</td>}
                  <td className={`px-1.5 py-2.5 text-right align-top whitespace-nowrap ${race.places ? "" : "pr-3 sm:pr-4"}`}>
                    {i > 0 ? (
                      paceChange !== null && (
                        <Time>
                          <DeltaText ms={paceChange} />
                        </Time>
                      )
                    ) : (
                      split !== null && segMeters > 0 && <Time className="text-ink-2">{formatElapsed(paceMsPerMile(split, segMeters)).replace(/\.\d$/, "")}</Time>
                    )}
                  </td>
                  {race.places && (
                    // Left-aligned, the place a fixed width so ▲ / ▼ / = line up beside it.
                    <td className="tnum py-2.5 pr-3 pl-2 text-left align-top whitespace-nowrap sm:pr-4">
                      {place && (
                        <>
                          <span className="inline-block w-9">
                            {placeText(place.place)}
                            {!place.overall && "*"}
                          </span>
                          {place.gained !== null &&
                            (place.gained === 0 ? (
                              <span className="text-ink-3" title="Same place as the last checkpoint">
                                <MoveHorizontal className="inline size-3.5 align-[-2px]" aria-label="same place" />
                              </span>
                            ) : (
                              <span className={place.gained > 0 ? "text-brand-text" : "text-danger"}>{place.gained > 0 ? `▲${place.gained}` : `▼${-place.gained}`}</span>
                            ))}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>
    );
  };

  return (
    <>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-1">
          <RaceStatusBar finished={isFinished} gunTimeMs={gunTimeMs} now={clock.now} official={officialLive ? "live" : hasOfficial ? (race.placesDerived ? "division" : "imported") : "none"} />
          {hasOfficial && !isFinished && !gunTimeMs && <Badge tone="brand">Official results</Badge>}
          {staleMinutes > 0 && <Badge tone="gold">updated {staleMinutes} min ago</Badge>}
          {!online && (
            <Badge tone="danger" dot>
              Offline
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          {canFix &&
            (editing ? (
              <Button size="sm" onClick={() => setEditing(false)} className="col-span-2 h-10 sm:col-span-1 sm:h-8">
                Done
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)} className="h-10 sm:h-8">
                <Pencil className="size-3.5" />
                Fix times
              </Button>
            ))}
          {canTap && !editing && (
            <LinkButton href={`/meets/${meetId}/record?race=${race.id}`} size="sm" variant="secondary" className="h-10 sm:h-8">
              Record splits
            </LinkButton>
          )}
        </div>
      </div>

      {/* A combined race has a second filter row; side by side with the counts they overlap, so stack them. */}
      <div className={`mb-3 flex flex-col gap-3 ${combined ? "" : "sm:flex-row sm:items-end sm:justify-between"}`}>
        <CheckpointCounts counts={counts} total={shownIds.length} loaded={loaded} finished={isFinished} />
        <div className="flex flex-col gap-2 sm:flex-row">
          {combined && (
            <Segmented
              value={who}
              onChange={setWho}
              options={[
                { value: "all", label: "Everyone" },
                { value: "F", label: "Girls" },
                { value: "M", label: "Boys" },
              ]}
              className="w-full sm:w-64"
            />
          )}
        </div>
      </div>


      {/* Coaches and managers only (the server doesn't send it to anyone else): who is at each checkpoint, doing what. */}
      {staff && recording.length > 0 && !isFinished && (
        <div className="mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
          <span className="font-medium text-ink">Who&rsquo;s where</span>
          <ul className="mt-1 space-y-0.5">
            {race.checkpoints.map((c) => {
              const here = recording.filter((r) => r.checkpointId === c.id);
              const byName = new Map(here.map((r) => [r.name, r.job]));
              const placing = here.filter((r) => r.job === "places" || r.job === "both");
              return (
                <li key={c.id} className="flex gap-2">
                  <span className="w-16 shrink-0 text-ink-2">{c.label}</span>
                  <span className={here.length === 0 ? "text-ink-3" : "text-ink"}>
                    {here.length === 0
                      ? "nobody"
                      : [...byName].map(([name, job]) => (race.places ? `${name} (${job === "both" ? "times + places" : job})` : name)).join(", ")}
                    {race.places && placing.length > 1 && <span className="ml-1 text-danger">· two counting places</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Only for the people who can act on it (marking a race finished is staff-only). */}
      {longRunning && staff && (
        <div className="mb-3">
          <Alert tone="gold">This race has been running for over 90 minutes. Mark it finished (meet page → Options → Adjust) to stop live updates.</Alert>
        </div>
      )}

      {editing && (
        <div className="mb-3">
          <Alert tone="gold">Fix mode: tap any time to nudge, move, swap, mark missed or delete it. Tap Done when you&rsquo;re finished.</Alert>
        </div>
      )}

      {race.checkpoints.length > 1 && (
        <Segmented
          size="sm"
          scroll
          className="mb-3"
          value={focusIndex === null ? "all" : race.checkpoints[focusIndex].id}
          onChange={(v) => setFocusPref(v)}
          options={[{ value: "all", label: "All" }, ...race.checkpoints.map((c) => ({ value: c.id, label: c.label }))]}
        />
      )}
      {focusIndex !== null ? (
        checkpointTable(focusIndex)
      ) : (
      <Card className="overflow-hidden">
        {/* A very narrow phone scrolls the table sideways inside its card instead of cutting off the last column. */}
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
              <th className="px-3 py-2 font-semibold sm:px-4">{hasOfficial ? (race.placesDerived ? "Division place · Athlete" : "Finish place · Athlete") : "Athlete"}</th>
              {race.checkpoints.map((c) => (
                // Left-aligned like the cells. No sub-label: the cells read themselves (time, colored split, place).
                <th key={c.id} className="px-2 py-2 text-left font-semibold last:pr-3 sm:last:pr-4">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {!loaded && (
              <tr>
                <td colSpan={race.checkpoints.length + 1} className="px-4 py-4 text-ink-3">
                  Loading…
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr
                key={row.athleteId}
                onClick={editing ? undefined : () => setAthleteSheet(row.athleteId)}
                className={`${row.reached < 0 ? "text-ink-3" : ""} ${editing ? "" : "cursor-pointer hover:bg-surface-2 active:bg-surface-2"}`}
              >
                <td className={`px-3 py-2.5 align-top font-medium sm:px-4 ${row.reached < 0 ? "" : "text-ink"}`}>
                  {/* Place in its own column so a wrapped name hangs under its first line, not under the number. */}
                  <span className="flex items-start gap-2">
                    {hasOfficial && <span className="tnum w-8 shrink-0 py-1 text-right text-ink-3">{row.officialPlace ?? ""}</span>}
                    <span className="min-w-0">
                      {editing ? (
                        <button type="button" onClick={() => setStatusFor(row.athleteId)} className="-mx-1.5 rounded px-1.5 py-1 text-left hover:bg-gold-soft" title="Set DNS / DNR / DNF">
                          {athletes[row.athleteId]}
                        </button>
                      ) : (
                        <button type="button" onClick={() => setAthleteSheet(row.athleteId)} className="-mx-1.5 rounded px-1.5 py-1 text-left">
                          <NameWithPill name={athletes[row.athleteId] ?? "?"} pill={row.record ? <RecordPill badge={row.record} className="ml-1.5 align-[2px]" /> : null} />
                        </button>
                      )}
                      {row.status ? (
                        <span className="mt-0.5 block">
                          <Badge tone="neutral">{STATUS_LABEL[row.status.status]}</Badge>
                        </span>
                      ) : (
                        row.officialStatus &&
                        row.officialStatus !== "finished" && (
                          <span className="mt-0.5 block">
                            <Badge tone="neutral">{row.officialStatus.toUpperCase()}</Badge>
                          </span>
                        )
                      )}
                    </span>
                  </span>
                </td>
                {row.cells.map((cell, i) => {
                  if (row.status && !expectedAt(row.status, i, race.checkpoints) && cell.official === null && cell.absoluteMs === null && !cell.missed) {
                    return (
                      <td key={race.checkpoints[i].id} className="px-1 py-1 text-left align-top text-ink-3 last:pr-2 sm:last:pr-3">
                        <span className="block px-1.5 py-1.5">—</span>
                      </td>
                    );
                  }
                  const m = cell.mark;
                  // Everything relative to the gun (official times already are). Without a gun, only clock times exist.
                  const t = (c: Cell | undefined) => (c ? (c.official ?? c.elapsedMs) : null);
                  const here = t(cell);
                  const prev = i > 0 ? t(row.cells[i - 1]) : here !== null ? 0 : null;
                  const split = here !== null && prev !== null ? here - prev : null;
                  const cumulative = cell.official !== null ? ft(cell.official, cell.precision) : cell.absoluteMs !== null ? fmt(cell.absoluteMs) : "—";
                  const shown = cell.missed ? "missed" : cell.beforeGun ? "before gun" : cumulative;
                  const flag = cell.official !== null ? "" : m && !cell.missed && shown !== "—" ? (m.estimate ? "~" : m.edited ? "*" : "") : "";
                  const projected = here === null && !cell.missed ? projectAt(row, i) : null;
                  const fresh = isFresh(m?.tapId);
                  // Three short lines, one job each: the time from the gun (bold where they are now); the split
                  // and its pace change from the previous segment; the place and its change (when counting
                  // places). A projection is just a light "~" time ("overdue" for staff).
                  const place = race.places && (cell.official !== null || cell.absoluteMs !== null) ? placeAt(row.athleteId, i) : null;
                  const segMeters = race.checkpoints[i].meters - (i > 0 ? race.checkpoints[i - 1].meters : 0);
                  const prevSegMeters = i > 0 ? race.checkpoints[i - 1].meters - (i > 1 ? race.checkpoints[i - 2].meters : 0) : 0;
                  const before = i > 1 ? t(row.cells[i - 2]) : i === 1 ? 0 : null;
                  const prevSplit = i > 0 && prev !== null && before !== null ? prev - before : null;
                  const paceChange = split !== null && prevSplit !== null && segMeters > 0 && prevSegMeters > 0 ? paceMsPerMile(split, segMeters) - paceMsPerMile(prevSplit, prevSegMeters) : null;
                  const cellNode = (
                    <>
                      {projected !== null ? (
                        <span className={`block ${staff && overdue(projected) ? "text-gold-text/80" : "text-ink-3"}`}>
                          <Time className="block">~{formatElapsed(projected).replace(/\.\d$/, "")}</Time>
                          {staff && overdue(projected) && <span className="block text-[11px]">overdue</span>}
                        </span>
                      ) : (
                        <Time className={`block ${cell.missed || cell.beforeGun ? "italic" : i === row.reached && here !== null ? "font-semibold text-ink" : ""}`}>
                          {shown}
                          {flag}
                        </Time>
                      )}
                      {/* The split, colored by its pace against the segment before: green faster, red slower, gray
                          within a second. The exact change is in the checkpoint view and the runner's sheet. */}
                      {i > 0 && split !== null && (
                        <span
                          // With places on, ▲ / ▼ are the color in the cell; the split stays gray (its pace change
                          // is in the checkpoint view's Pace ± column and the runner's sheet).
                          className={`block text-[13px] leading-5 ${place || paceChange === null || Math.abs(paceChange) < 1000 ? "text-ink-2" : paceChange < 0 ? "text-brand-text" : "text-danger"}`}
                          title={paceChange !== null ? `${paceChange <= 0 ? "−" : "+"}${formatElapsed(Math.abs(paceChange)).replace(/\.\d$/, "")} per mile vs the previous segment` : undefined}
                        >
                          <Time>{ft(split)}</Time>
                        </span>
                      )}
                      {/* The first checkpoint has no split (it is the time): an empty line keeps its place level with the others. */}
                      {i === 0 && place && <span aria-hidden className="block text-[13px] leading-5">&nbsp;</span>}
                      {/* The place in a fixed-width slot, so down a column the ▲ / ▼ / ↔ beside it line up. */}
                      {place && (
                        <span className="tnum flex text-[13px] leading-5 font-medium text-ink-2">
                          <span className="min-w-9 shrink-0 pr-1">
                            {placeText(place.place)}
                            {!place.overall && "*"}
                          </span>
                          <span className="shrink-0">
                            {place.gained === null ? null : place.gained === 0 ? (
                              <span className="text-ink-3" title="Same place as the last checkpoint">
                                <MoveHorizontal className="inline size-3.5 align-[-2px]" aria-label="same place" />
                              </span>
                            ) : (
                              <span className={place.gained > 0 ? "text-brand-text" : "text-danger"}>{place.gained > 0 ? `▲${place.gained}` : `▼${-place.gained}`}</span>
                            )}
                          </span>
                        </span>
                      )}
                    </>
                  );
                  return (
                    <td key={race.checkpoints[i].id} className="px-1 py-1.5 text-left align-top last:pr-2 sm:last:pr-3">
                      {editing && cell.official === null ? (
                        <button
                          type="button"
                          onClick={() => setFix({ athleteId: row.athleteId, cpIndex: i })}
                          className="w-full rounded-md border border-dashed border-line-strong px-1.5 py-1 text-left hover:bg-surface-2 active:bg-brand-soft"
                        >
                          {cellNode}
                        </button>
                      ) : (
                        <span className={`block rounded-md px-1.5 py-1.5 transition-colors duration-1000 ${fresh ? "bg-brand-soft" : ""}`} title={cell.official !== null ? "Official time" : undefined}>
                          {cellNode}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
      )}

      {/* Below the splits (the table is what most people come for): our team, then everyone's scores. */}
      <div className="mt-3">
        <TeamCard
          name={race.ourTeam.name}
          rows={teamRows}
          ft={(ms) => ft(ms)}
          note={combined && who === "all" ? "Pick Girls or Boys above to see the team." : null}
        />
      </div>

      {/* A boys-and-girls race's counted places mix both: no scores card for it. */}
      {race.places && !combined && (
        <div className="mt-3">
          <PlacesCard
            config={race.places}
            checkpoints={race.checkpoints}
            places={placesByCp}
            ourTeam={race.ourTeam}
            // A boys-and-girls race's field mixes both: no team scores from it.
            official={officialPlaces && !combined ? officialPlaces : null}
            focus={focusIndex === null ? null : race.checkpoints[focusIndex].id}
          />
        </div>
      )}

      {/* Times captured without a name yet: a job for coaches and managers, noise for the public. */}
      {pendingTotal > 0 && staff && (
        <div className="mt-3">
          <Alert tone="gold" title={`${pendingTotal} unassigned capture${pendingTotal === 1 ? "" : "s"}`}>
            {race.checkpoints.map((c) => {
              const p = state.get(c.id)?.pending ?? [];
              return p.length ? (
                <div key={c.id} className="tnum">
                  {c.label}: {p.map((s) => fmt(s.timeMs)).join(", ")}
                </div>
              ) : null;
            })}
            {canFix && <div className="mt-1 text-xs">Use Fix times, then tap an athlete&rsquo;s empty cell to give them one.</div>}
          </Alert>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-3">
        {!editing && "Tap a runner for their splits, pace and comparison. "}* edited &nbsp; ~ estimate{!isFinished && ` · a light ~ time is a projection from the runner's last split${staff ? "; overdue means they're more than a minute past it" : ""}`} &nbsp;{hasOfficial && (officialLive ? "Official times from the timing company's live feed replace app taps as they post. " : race.placesDerived ? "Official times replace app taps where imported; the timing company scored the divisions as one field, so places here are ranked by the app within our division. " : "Official times replace app taps where imported. ")}{" "}
        {focusIndex === null
          ? race.places
            ? "Time from the gun, the split beneath it, then the place. Pick a checkpoint above the table for each split's pace change."
            : "Time from the gun; beneath it the split, green when that segment was faster than the one before, red when slower (the exact change is in the checkpoint view)."
          : "Time from the gun, the split for this segment, and Pace ±: the change in pace per mile from the previous segment (+ slower, − faster)."}{" "}
        Updates every few seconds.
        {race.places && placesByCp.size > 0 && (
          <span className="mt-1 block">
            Places: ▲ places gained since the last checkpoint · ▼ places lost · ↔ same place · * among our runners and the tracked teams only, not everyone.
          </span>
        )}
      </p>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-3">
          <Toast title={toast} />
        </div>
      )}

      {openAthlete && (
        <AthleteSheet
          race={race}
          meetName={meetName}
          meetDate={meetDate}
          row={allRows.find((r) => r.athleteId === openAthlete)}
          name={athletes[openAthlete] ?? "?"}
          grade={grades[openAthlete] ?? null}
          neighbors={(() => {
            const i = rows.findIndex((r) => r.athleteId === openAthlete);
            const prev = i > 0 ? rows[i - 1].athleteId : null;
            const next = i >= 0 && i < rows.length - 1 ? rows[i + 1].athleteId : null;
            return { prev: prev ? { id: prev, name: athletes[prev] ?? "?" } : null, next: next ? { id: next, name: athletes[next] ?? "?" } : null };
          })()}
          onPick={setAthleteSheet}
          projectAt={(i) => {
            const r = allRows.find((x) => x.athleteId === openAthlete);
            return r ? projectAt(r, i) : null;
          }}
          placeAt={(i) => (race.places ? placeAt(openAthlete, i) : null)}
          overdue={staff ? overdue : () => false}
          teamRank={(() => {
            // Position within the runner's own group (same gender and level), in race order: `rows` is
            // already sorted furthest-along-then-fastest, with anyone out of the race at the end.
            const level = race.levels[openAthlete];
            const gender = genders[openAthlete];
            const group = allRows.filter(
              (r) => race.levels[r.athleteId] === level && (!combined || genders[r.athleteId] === gender) && !(r.status || (r.officialStatus && r.officialStatus !== "finished")),
            );
            const idx = group.findIndex((r) => r.athleteId === openAthlete);
            if (idx < 0 || group[idx].reached < 0) return null;
            const team = `${gender === "F" ? "girls " : gender === "M" ? "boys " : ""}${level ?? ""} team`.replace(/\s+/g, " ").trim();
            return { rank: idx + 1, of: group.length, team };
          })()}
          raceClockMs={!isFinished && gunTimeMs !== null && nowMs > 0 ? nowMs - gunTimeMs : null}
          gunTimeMs={gunTimeMs}
          now={clock.now}
          onShared={showToast}
          onClose={() => setAthleteSheet(null)}
        />
      )}

      {statusFor && (
        <StatusSheet
          race={race}
          athleteId={statusFor}
          current={statuses.get(statusFor)}
          marks={race.checkpoints.map((c) => state.get(c.id)?.byAthlete.get(statusFor))}
          name={athletes[statusFor] ?? "?"}
          send={send}
          onClose={() => setStatusFor(null)}
          onDone={(msg) => {
            setStatusFor(null);
            showToast(msg);
          }}
        />
      )}

      {fix && (
        <FixSheet
          race={race}
          cpIndex={fix.cpIndex}
          athleteId={fix.athleteId}
          cp={state.get(race.checkpoints[fix.cpIndex].id)}
          athletes={athletes}
          gunTimeMs={gunTimeMs}
          fmt={fmt}
          send={send}
          onClose={() => setFix(null)}
          onDone={(msg) => {
            setFix(null);
            showToast(msg);
          }}
        />
      )}
    </>
  );
}

type Send = ReturnType<typeof useRaceTaps>["send"];

/** One runner's race at a readable size, with how it compares to their last meet. */
function AthleteSheet({
  race,
  meetName,
  meetDate,
  row,
  name,
  grade,
  neighbors,
  onPick,
  projectAt,
  placeAt,
  overdue,
  teamRank,
  raceClockMs,
  gunTimeMs,
  now,
  onShared,
  onClose,
}: {
  race: RaceInfo;
  meetName: string;
  meetDate: string;
  row: Row | undefined;
  name: string;
  grade: number | null;
  /** The runners either side in the table, for walking the team without closing. */
  neighbors: { prev: { id: string; name: string } | null; next: { id: string; name: string } | null };
  onPick: (id: string) => void;
  /** Projected elapsed time at checkpoint i while the race runs, else null. */
  projectAt: (i: number) => number | null;
  /** Their place at checkpoint i when places were counted there (null otherwise). */
  placeAt: (i: number) => { place: number; overall: boolean; gained: number | null } | null;
  overdue: (projected: number) => boolean;
  /** Position within the runner's gender + level group, e.g. { rank: 3, of: 7, team: "girls varsity team" }. */
  teamRank: { rank: number; of: number; team: string } | null;
  /** Elapsed race time right now (ms), while the race runs; refreshed once a second, for "ago" and projections. */
  raceClockMs: number | null;
  gunTimeMs: number | null;
  /** Synced clock, for the race clock itself (ticks at tenths). */
  now: () => number | null;
  /** A toast, for the clipboard fallback. */
  onShared: (msg: string) => void;
  onClose: () => void;
}) {
  const { ft } = useTimeFormat();
  const bests = row ? race.bests[row.athleteId] : undefined;
  const finishes = bests?.finishes ?? [];
  // The season list in date order; the top five ever.
  const byDate = [...finishes].sort((a, b) => b.date.localeCompare(a.date));
  const season = byDate.filter((f) => f.thisSeason).reverse();
  const seasonYear = meetDate.slice(0, 4);
  const year = (date: string) => date.slice(0, 4);
  const shortDate = (date: string) => formatLocalDate(date).replace(/^[A-Za-z]+, /, "");
  const fastest = finishes.slice(0, 5);
  // History is closed until asked for: the race in front of you comes first.
  const [historyOpen, setHistoryOpen] = useState(false);
  const t = (i: number): number | null => {
    const c = row?.cells[i];
    return c ? (c.official ?? c.elapsedMs) : null;
  };
  const finishIndex = race.checkpoints.findIndex((c) => c.kind === "finish");
  const finish = finishIndex >= 0 ? t(finishIndex) : null;
  const projected = finishIndex >= 0 ? projectAt(finishIndex) : null;
  // Which times are the timing company's: all, some (a live feed matched part of the race), or none.
  const officialCount = row ? row.cells.filter((c) => c.official !== null).length : 0;
  const timedCount = row ? row.cells.filter((c) => c.official !== null || c.absoluteMs !== null).length : 0;
  const finishOfficial = finishIndex >= 0 && row?.cells[finishIndex]?.official !== null && row?.cells[finishIndex]?.official !== undefined;
  // Where they were last seen on the course.
  const lastSeen = row && row.reached >= 0 && t(row.reached) !== null ? { label: race.checkpoints[row.reached].label, at: t(row.reached)! } : null;
  // Out of the race: the status is the headline, not a footnote.
  const status: { short: string; long: string } | null =
    row?.officialStatus && row.officialStatus !== "finished"
      ? { short: row.officialStatus.toUpperCase(), long: `${STATUS_LONG[row.officialStatus as keyof typeof STATUS_LONG] ?? row.officialStatus.toUpperCase()} · official results` }
      : row?.status
        ? {
            short: STATUS_LABEL[row.status.status],
            long: `${STATUS_LONG[row.status.status]}${row.status.afterCheckpointId ? ` · after ${race.checkpoints.find((c) => c.id === row.status!.afterCheckpointId)?.label ?? ""}` : ""}`,
          }
        : null;
  const subtitle = `${race.name} · ${meetName}`;
  const finishMeters = finishIndex >= 0 ? race.checkpoints[finishIndex].meters : 0;
  const avgPace = finish !== null && finishMeters > 0 ? paceMsPerMile(finish, finishMeters) : null;
  const share = async () => {
    const parts = race.checkpoints.flatMap((c, i) => {
      const v = t(i);
      return v !== null ? [`${c.label} ${ft(v, row?.cells[i]?.precision)}`] : [];
    });
    const headline = finish !== null ? ft(finish, row?.cells[finishIndex]?.precision) : status ? status.short : raceClockMs !== null ? "in progress" : parts.length ? "" : "not started";
    const text = [`${name} — ${race.name}, ${meetName}`, headline, row?.record ? `${RECORD_LABEL[row.record.kind].short}${row.record.unofficial ? " (unofficial)" : ""}` : "", row?.officialPlace != null ? `${row.officialPlace}${ordinal(row.officialPlace)}${race.placesDerived ? " in division" : " place"}` : "", ...parts]
      .filter(Boolean)
      .join(" · ");
    try {
      if (navigator.share) {
        await navigator.share({ title: name, text, url: window.location.href });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${text}\n${window.location.href}`);
        onShared("Link copied");
      } else {
        onShared("Copy the address bar to share this");
      }
    } catch {
      // dismissed
    }
  };
  // Where today's run sits among everything they've done at this distance, and this season.
  const rank = finish !== null ? finishes.filter((f) => f.ms < finish).length + 1 : null;
  const seasonRank = finish !== null ? season.filter((f) => f.ms < finish).length + 1 : null;
  // Today's cumulative times by checkpoint meters, for comparing against an earlier race.
  const todaySplits: Record<string, number> = {};
  race.checkpoints.forEach((c, i) => {
    const v = t(i);
    if (v !== null) todaySplits[String(Math.round(c.meters))] = v;
  });
  const checkpointLabels = race.checkpoints.map((c) => ({ meters: String(Math.round(c.meters)), label: c.label }));
  // Tags a row can wear in the lists, today's run included: the fastest ever, the fastest this season, the same course as today.
  // Nothing about records applies on a meet marked as not counting for them.
  const records = !race.recordsExcluded && !status;
  // Still the record now: nothing faster since (a PR beaten in a later season isn't tagged PR here either).
  const laterPr = bests?.later.pr ?? null;
  const laterSb = bests?.later.sb ?? null;
  const todayIsPR = records && finish !== null && (finishes.length === 0 || finish <= finishes[0].ms) && (laterPr === null || finish <= laterPr);
  const todayIsSB = records && finish !== null && (season.length === 0 || finish <= Math.min(...season.map((f) => f.ms))) && (laterSb === null || finish <= laterSb);
  // An earlier race wears PR / SB only if it's still the record (nothing faster since, this race included).
  const stillBest = (ms: number | undefined, later: number | null) => ms !== undefined && (later === null || ms <= later) && (finish === null || ms <= finish);
  const bestSeason = [...season].sort((a, b) => a.ms - b.ms)[0];
  const prRaceId = !todayIsPR && stillBest(finishes[0]?.ms, laterPr) ? (finishes[0]?.raceId ?? null) : null;
  const sbRaceId = !todayIsSB && stillBest(bestSeason?.ms, laterSb) ? (bestSeason?.raceId ?? null) : null;
  const tagsFor = (f: PriorFinish) => [...(f.raceId === prRaceId ? ["PR"] : []), ...(f.raceId === sbRaceId ? ["SB"] : []), ...(f.sameCourse ? ["this course"] : [])];
  // "This race", not "today": the sheet is read again long after the meet.
  const todayTags = [...(todayIsPR && finishes.length > 0 ? ["PR"] : []), ...(todayIsSB && season.length > 0 ? ["SB"] : []), "this race"];
  // On pace for a record while they're still out: the projection against what they came in with.
  const onPace = records && finish === null && projected !== null && bests ? recordBadge(projected, bests, true) : null;
  // A near miss: top three ever, or top three this season, said in words rather than a pill.
  const gapText = (ms: number) => (ms >= 60_000 ? formatElapsed(ms, "seconds") : `${Math.max(1, Math.round(ms / 1000))}s`);
  const nearMiss =
    records && finish !== null && !row?.record && bests && rank !== null && rank <= 3 && finishes.length >= 2 && bests.pr
      ? `${rank}${ordinal(rank)} fastest ever, ${gapText(finish - bests.pr.ms)} behind the personal best of ${ft(bests.pr.ms, bests.pr.precision)} at ${bests.pr.meetName} on ${formatDateWithYear(bests.pr.date)}.`
      : records && finish !== null && !row?.record && bests && seasonRank !== null && seasonRank <= 3 && season.length >= 2 && bests.sb
        ? `${seasonRank}${ordinal(seasonRank)} fastest this season, behind the season best of ${ft(bests.sb.ms, bests.sb.precision)} at ${bests.sb.meetName} on ${formatDateWithYear(bests.sb.date)}.`
        : null;
  // "5Ks" reads; "3 mis" doesn't.
  const plural = /[A-Za-z]$/.test(race.distanceLabel) && !/ mi$/.test(race.distanceLabel) ? `${race.distanceLabel}s` : `${race.distanceLabel} races`;
  const raceLink = (f: { meetId: string; raceId: string }) => `/meets/${f.meetId}/results?race=${f.raceId}&athlete=${row?.athleteId ?? ""}`;

  return (
    <Sheet
      title={
        <span className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tracking-tight">{name}</span>
          {grade !== null && <span className="text-[13px] font-normal text-ink-3">{grade}</span>}
        </span>
      }
      subtitle={subtitle}
      actions={
        <button type="button" onClick={share} aria-label="Share" title="Share" className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink">
          <Share className="size-5" />
        </button>
      }
      onClose={onClose}
    >
      <div className="mt-2 mb-3 flex items-end justify-between gap-3">
        <div>
          {status && finish === null ? (
            <>
              <div className="text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{status.long}</div>
              <div className="text-4xl font-semibold tracking-tight text-ink">{status.short}</div>
            </>
          ) : (
            <>
              <div className="text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
                {finish !== null ? (finishOfficial ? "Finish · official" : "Finish · unofficial") : projected !== null ? "Projected finish" : "Finish"}
              </div>
              <div className="flex items-center gap-2">
                <Time className="text-4xl font-semibold tracking-tight text-ink">{finish !== null ? ft(finish, row?.cells[finishIndex]?.precision) : projected !== null ? `~${formatElapsed(projected).replace(/\.\d$/, "")}` : "—"}</Time>
                {row?.record && <RecordPill badge={row.record} size="md" />}
              </div>
            </>
          )}
        </div>
        {/* The other big number: place once they've finished, the race clock while they're out there. */}
        {row?.officialPlace != null ? (
          <div className="text-right">
            <div className="text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{race.placesDerived ? "Division place" : "Place"}</div>
            <div className="text-4xl font-semibold tracking-tight text-ink">
              {row.officialPlace}
              <span className="text-xl">{ordinal(row.officialPlace)}</span>
            </div>
          </div>
        ) : (
          raceClockMs !== null &&
          finish === null &&
          !status && (
            <div className="text-right">
              <div className="flex items-center justify-end gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-danger uppercase">
                <LiveDot />
                Race clock
              </div>
              <RunningClock gunTimeMs={gunTimeMs!} now={now} className="text-4xl font-semibold tracking-tight text-ink" />
            </div>
          )
        )}
      </div>
      {/* One line under the pair: the record, a near miss, the pace they're on, or the average pace. Full width, so it rarely wraps. */}
      {!(status && finish === null) && (
        <div className="mb-3">
          {row?.record && bests ? (
            <span className="block text-[13px] text-ink-2">
              {(() => {
                const prev = bests[row.record.kind]!;
                const what = { pr: "personal best", sb: "season best", course: "best on this course", meet: "best at this meet" }[row.record.kind];
                const by = row.record.unofficial && row.record.uncertain && row.record.previousMs > finish! ? `, beaten by ${Math.max(1, Math.round((row.record.previousMs - finish!) / 1000))}s` : row.record.unofficial && row.record.uncertain ? ", matched" : "";
                return `Previous ${what} was ${ft(prev.ms, prev.precision)} at ${prev.meetName} on ${formatDateWithYear(prev.date)}${by}.`;
              })()}
            </span>
          ) : nearMiss ? (
            <span className="block text-[13px] text-ink-2">{nearMiss}</span>
          ) : onPace && bests ? (
            <span className="block text-[13px] text-brand-text">
              On pace for a {RECORD_LABEL[onPace.kind].short} · {RECORD_LABEL[onPace.kind].short} {ft(bests[onPace.kind]!.ms, bests[onPace.kind]!.precision)}
            </span>
          ) : (
            avgPace !== null && <Time className="block text-[13px] text-ink-2">{formatElapsed(avgPace).replace(/\.\d$/, "")}/mi average</Time>
          )}
        </div>
      )}
      {/* Secondary stats: a size down from the headline pair, with room above. */}
      {(teamRank || (raceClockMs !== null && finish === null && !status && lastSeen)) && (
        <div className="mt-5 mb-4 flex items-end justify-between gap-x-6 gap-y-3 border-t border-line pt-3">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {teamRank && (
              <SmallStat value={`${teamRank.rank}${ordinal(teamRank.rank)} of ${teamRank.of} runner${teamRank.of === 1 ? "" : "s"}`} label={finish === null && lastSeen ? `${teamRank.team} at ${lastSeen.label}` : teamRank.team} />
            )}
          </div>
          {/* Under the race clock, like the clock itself. */}
          {raceClockMs !== null && finish === null && !status && lastSeen && (
            <SmallStat value={`${formatElapsed(Math.max(0, raceClockMs - lastSeen.at)).replace(/\.\d$/, "")} ago`} label={`passed ${lastSeen.label}`} align="right" />
          )}
        </div>
      )}
      <div className="mt-6 divide-y divide-line rounded-lg border border-line">
        {/* Flex with fixed right-hand columns: Safari's grid skips re-layout when a cell's content changes under an open sheet. */}
        <div className="flex items-center gap-x-3 px-3 py-1.5 text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
          <span className="min-w-0 flex-1">Checkpoint</span>
          <span className="w-20 shrink-0 text-right">Time</span>
          <span className="w-20 shrink-0 text-right">Split</span>

        </div>
        {race.checkpoints.map((c, i) => {
          const here = t(i);
          const before = i > 0 ? t(i - 1) : here !== null ? 0 : null;
          const split = here !== null && before !== null ? here - before : null;
          const segMeters = c.meters - (i > 0 ? race.checkpoints[i - 1].meters : 0);
          // Pace change from the segment before: + slower, − faster, as on the board.
          const prevHere = i > 0 ? t(i - 1) : null;
          const prevBefore = i > 1 ? t(i - 2) : i === 1 ? 0 : null;
          const prevSplit = prevHere !== null && prevBefore !== null ? prevHere - prevBefore : null;
          const prevPace = prevSplit !== null && i > 0 ? paceMsPerMile(prevSplit, race.checkpoints[i - 1].meters - (i > 1 ? race.checkpoints[i - 2].meters : 0)) : null;
          const cell = row?.cells[i];
          return (
            <div key={c.id} className="flex items-start gap-x-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 font-medium text-ink">
                {c.label}
                {officialCount > 0 && officialCount < timedCount && cell?.official !== null && cell?.official !== undefined && <span className="ml-1.5 text-[10px] font-semibold tracking-wide text-brand-text uppercase">official</span>}
                {cell?.mark?.estimate && cell.official === null && <span className="ml-1.5 text-xs text-ink-3">estimate</span>}
                {(() => {
                  const p = placeAt(i);
                  if (!p) return null;
                  return (
                    <span className="tnum block text-xs font-normal text-ink-2">
                      {placeText(p.place)}
                      {p.overall ? " place" : " among tracked teams"}
                      {p.gained !== null &&
                        // ▲ / ▼ as in the table, spelled out on hover; the same place gets a quiet ↔.
                        (p.gained === 0 ? (
                          <span className="text-ink-3" title="Same place as the last checkpoint">
                            {" "}
                            <MoveHorizontal className="inline size-3.5 align-[-2px]" aria-label="same place" />
                          </span>
                        ) : (
                          <span className={p.gained > 0 ? "text-brand-text" : "text-danger"} title={`${p.gained > 0 ? "Up" : "Down"} ${Math.abs(p.gained)} place${Math.abs(p.gained) === 1 ? "" : "s"} since the last checkpoint`}>
                            {p.gained > 0 ? ` ▲${p.gained}` : ` ▼${-p.gained}`}
                          </span>
                        ))}
                    </span>
                  );
                })()}
              </span>
              {(() => {
                const p = here === null && !cell?.missed ? projectAt(i) : null;
                if (p === null)
                  return (
                    <span className="w-20 shrink-0 text-right whitespace-nowrap">
                      <Time className="block font-semibold text-ink">{cell?.missed ? "missed" : here !== null ? ft(here, cell?.precision) : "—"}</Time>
                      {split !== null && segMeters > 0 && <Time className="block text-[11px] text-ink-3">{formatElapsed(paceMsPerMile(split, segMeters)).replace(/\.\d$/, "")}/mi</Time>}
                    </span>
                  );
                const late = overdue(p);
                return (
                  <span className={`w-20 shrink-0 text-right ${late ? "text-gold-text/75" : "text-ink-3"}`}>
                    <Time className="block">~{formatElapsed(p).replace(/\.\d$/, "")}</Time>
                    <span className="block text-[10px] tracking-wide uppercase">{late ? "overdue" : "projected"}</span>
                  </span>
                );
              })()}
              <span className="w-20 shrink-0 text-right whitespace-nowrap">
                {split !== null && segMeters > 0 ? (
                  <>
                    <Time className="block text-ink-2">{ft(split)}</Time>
                    {prevPace !== null && (
                      <Time className="block text-[11px]">
                        <DeltaText ms={paceMsPerMile(split, segMeters) - prevPace} suffix="/mi" />
                      </Time>
                    )}
                  </>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </span>

            </div>
          );
        })}
      </div>
      {finishes.length > 0 && (
        <div className="mt-3 rounded-lg border border-line">
          {/* The row is the section's header; open, the lists and the chart sit inside the same card. */}
          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            aria-expanded={historyOpen}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink hover:bg-surface-2 ${historyOpen ? "rounded-b-none border-b border-line bg-surface-2" : ""}`}
          >
            <HistoryIcon className="size-4 text-ink-2" />
            <span className="flex-1">History</span>
            <span className="text-[13px] font-normal text-ink-2">
              {!historyOpen && !todayIsPR && bests?.pr ? `PR ${ft(bests.pr.ms, bests.pr.precision)} · ` : ""}
              {finishes.length} earlier {finishes.length === 1 ? race.distanceLabel : plural}
            </span>
            <ChevronRight className={`size-4 text-ink-3 transition-transform ${historyOpen ? "rotate-90" : ""}`} />
          </button>
          {historyOpen && (
            <div className="divide-y divide-line">
              <FinishList
                title={`Fastest ${plural} ever`}
                note={rank !== null ? `This race ranks ${rank}${ordinal(rank)} of ${finishes.length + 1}` : undefined}
                rows={fastest}
                today={finish !== null && rank !== null && rank <= 5 ? { ms: finish, precision: row?.cells[finishIndex]?.precision ?? null, rank, tags: todayTags } : null}
                meetName={meetName}
                todaySplits={todaySplits}
                checkpoints={checkpointLabels}
                tags={tagsFor}
                link={raceLink}
                ft={ft}
                when={(f) => `${f.meetName}, ${year(f.date)}`}
              />
              {season.length > 0 && (
                <FinishList
                  title={`${seasonYear} season`}
                  note={seasonRank !== null ? `This race ranks ${seasonRank}${ordinal(seasonRank)} of ${season.length + 1} this season` : undefined}
                  rows={season}
                  today={finish !== null ? { ms: finish, precision: row?.cells[finishIndex]?.precision ?? null, rank: null, tags: todayTags } : null}
                  meetName={meetName}
                  todaySplits={todaySplits}
                  checkpoints={checkpointLabels}
                  tags={tagsFor}
                  link={raceLink}
                  ft={ft}
                  when={(f) => `${f.meetName} · ${shortDate(f.date)}`}
                />
              )}
              {(() => {
                // The season's arc, once there's enough of it to draw. A career chart belongs on the athlete page.
                const seasonPoints = [...season.map((f) => ({ ms: f.ms, label: shortDate(f.date), today: false })), ...(finish !== null ? [{ ms: finish, label: shortDate(meetDate), today: true }] : [])];
                return seasonPoints.length >= 3 && <ProgressChart title="Race by race" points={seasonPoints} prMs={bests?.pr?.ms ?? null} ft={ft} />;
              })()}
            </div>
          )}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-2">
        {/* At either end: a disabled chevron, as pagination does. */}
        <Button variant="secondary" size="sm" onClick={() => neighbors.prev && onPick(neighbors.prev.id)} disabled={!neighbors.prev} aria-label="Previous runner" className="min-w-0 max-w-[48%]">
          <ChevronLeft className="size-4 shrink-0" />
          {neighbors.prev && <span className="truncate">{neighbors.prev.name}</span>}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => neighbors.next && onPick(neighbors.next.id)} disabled={!neighbors.next} aria-label="Next runner" className="min-w-0 max-w-[48%]">
          {neighbors.next && <span className="truncate">{neighbors.next.name}</span>}
          <ChevronRight className="size-4 shrink-0" />
        </Button>
      </div>
      <Notes
        lines={[
          officialCount === 0 && timedCount > 0 && "Times are from the app, not the timing company.",
          officialCount > 0 && officialCount < timedCount && "Times not marked official are from the app.",
          row?.cells.some((c) => c.mark?.estimate && c.official === null) && "An estimate is a time entered by hand, not tapped as they passed.",
          row?.record?.unofficial && "Records are provisional until official results are imported.",
          race.placesDerived && "Places are ranked by the app within our division.",
          race.recordsExcluded && "This meet doesn't count for PRs, season bests or course bests.",
          finishes.length === 0 && `No earlier ${race.distanceLabel} results in the app to compare with.`,
        ].filter((line): line is string => typeof line === "string")}
      />
    </Sheet>
  );
}

function SmallStat({ value, label, align = "left" }: { value: ReactNode; label: string; align?: "left" | "right" }) {
  return (
    <div className={align === "right" ? "shrink-0 text-right" : ""}>
      <Time className="block text-lg leading-none font-semibold text-ink">{value}</Time>
      <span className="mt-1 block text-[11px] font-medium tracking-[0.06em] text-ink-2 uppercase">{label}</span>
    </div>
  );
}

const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");

/** DNS / DNR / DNF for one athlete. A DNF remembers the last checkpoint they passed. */
function StatusSheet({
  race,
  athleteId,
  current,
  marks,
  name,
  send,
  onClose,
  onDone,
}: {
  race: RaceInfo;
  athleteId: string;
  current: AthleteStatus | undefined;
  marks: (Mark | undefined)[];
  name: string;
  send: Send;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  // Default the DNF point to the last checkpoint with a time.
  const lastPassed = marks.reduce<number>((best, m, i) => (m && !m.missed ? i : best), -1);
  const [after, setAfter] = useState<string | null>(current?.afterCheckpointId ?? (lastPassed >= 0 ? race.checkpoints[lastPassed].id : null));
  const base = { checkpointId: null, athleteId, targetTapId: null, timeMs: null, estimate: false, missed: false, note: null };

  const set = (e: SyntheticEvent, status: AthleteRaceStatus) => {
    void send({ ...base, type: "status", status, checkpointId: status === "dnf" ? after : null, deviceTimeMs: eventTimeMs(e) });
    const where = status === "dnf" && after ? ` after ${race.checkpoints.find((c) => c.id === after)?.label}` : "";
    onDone(`${name}: ${STATUS_LABEL[status]}${where}`);
  };
  const clear = (e: SyntheticEvent) => {
    if (!current) return;
    void send({ ...base, athleteId: null, type: "void", targetTapId: current.tapId, deviceTimeMs: eventTimeMs(e) });
    onDone(`${name}: back in the race`);
  };

  return (
    <Sheet title={name} subtitle={current ? `${STATUS_LONG[current.status]}${current.by ? ` · set by ${current.by}` : ""}` : "In the race"} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Btn onClick={(e) => set(e, "dns")}>
            <span className="block">DNS</span>
            <span className="block text-xs font-normal text-ink-2">Did not start</span>
          </Btn>
          <Btn onClick={(e) => set(e, "dnr")}>
            <span className="block">DNR</span>
            <span className="block text-xs font-normal text-ink-2">Did not run</span>
          </Btn>
        </div>
        <div>
          <SectionLabel className="mb-1.5">Did not finish · last checkpoint passed</SectionLabel>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => setAfter(null)} active={after === null}>
              Not sure
            </Btn>
            {race.checkpoints
              .filter((c) => c.kind !== "finish")
              .map((c) => (
                <Btn key={c.id} onClick={() => setAfter(c.id)} active={after === c.id}>
                  {c.label}
                </Btn>
              ))}
          </div>
          <Button onClick={(e) => set(e, "dnf")} className="mt-2 w-full">
            Mark DNF
          </Button>
        </div>
        {current && (
          <Btn onClick={clear} danger>
            Clear {STATUS_LABEL[current.status]} · back in the race
          </Btn>
        )}
      </div>
    </Sheet>
  );
}

function FixSheet({
  race,
  cpIndex,
  athleteId,
  cp,
  athletes,
  gunTimeMs,
  fmt,
  send,
  onClose,
  onDone,
}: {
  race: RaceInfo;
  cpIndex: number;
  athleteId: string;
  cp: CheckpointState | undefined;
  athletes: Record<string, string>;
  gunTimeMs: number | null;
  fmt: (ms: number | null) => string;
  send: Send;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const checkpoint = race.checkpoints[cpIndex];
  const mark = cp?.byAthlete.get(athleteId);
  const name = athletes[athleteId] ?? "?";
  const [mode, setMode] = useState<"menu" | "type" | "move" | "swap" | "add">("menu");
  const [typed, setTyped] = useState("");
  const [estimate, setEstimate] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const base = { checkpointId: checkpoint.id, athleteId: null, targetTapId: null, timeMs: null, estimate: false, missed: false, note: null };
  const others = race.athleteIds.filter((id) => id !== athleteId);
  const withoutTime = others.filter((id) => !cp?.byAthlete.get(id) || cp.byAthlete.get(id)!.missed);
  const withTime = others.filter((id) => cp?.byAthlete.get(id) && !cp.byAthlete.get(id)!.missed);

  const absolute = (text: string): number | null => {
    const ms = parseTypedTime(text);
    if (ms === null) return null;
    return gunTimeMs ? gunTimeMs + ms : null;
  };
  // What the typed digits will be saved as, shown under the field before Save.
  const typedMs = parseTypedTime(typed);
  const typedPreview = typed.trim() === "" ? null : typedMs === null ? "Not a time yet" : `= ${formatElapsed(typedMs)}`;

  const nudge = (e: SyntheticEvent, deltaMs: number) => {
    if (!mark?.timeMs) return;
    void send({ ...base, type: "edit", targetTapId: mark.tapId, timeMs: mark.timeMs + deltaMs, deviceTimeMs: eventTimeMs(e) });
    onDone(`${name}: ${fmt(mark.timeMs + deltaMs)}`);
  };

  const saveTyped = (e: SyntheticEvent) => {
    e.preventDefault();
    const timeMs = absolute(typed);
    if (timeMs === null) return setError(gunTimeMs ? "Type the time as minutes and seconds: 6:40, or just 640; tenths after a dot (640.5)." : "Set the gun time first");
    if (mark && !mark.missed) {
      void send({ ...base, type: "edit", targetTapId: mark.tapId, timeMs, deviceTimeMs: eventTimeMs(e) });
    } else {
      if (mark) void send({ ...base, type: "void", targetTapId: mark.tapId, deviceTimeMs: eventTimeMs(e) });
      void send({ ...base, type: "name_tap", athleteId, timeMs, estimate, deviceTimeMs: eventTimeMs(e) });
    }
    onDone(`${name}: ${fmt(timeMs)}${estimate && !(mark && !mark.missed) ? " (estimate)" : ""}`);
  };

  const moveTo = (e: SyntheticEvent, toId: string) => {
    if (!mark) return;
    const displaced = cp?.byAthlete.get(toId);
    if (displaced) void send({ ...base, type: "void", targetTapId: displaced.tapId, deviceTimeMs: eventTimeMs(e) });
    void send({ ...base, type: "edit", targetTapId: mark.tapId, athleteId: toId, deviceTimeMs: eventTimeMs(e) });
    onDone(`Moved ${fmt(mark.timeMs)} to ${athletes[toId]}`);
  };

  const swapWith = (e: SyntheticEvent, otherId: string) => {
    const other = cp?.byAthlete.get(otherId);
    if (!mark || !other) return;
    const t = eventTimeMs(e);
    void send({ ...base, type: "edit", targetTapId: mark.tapId, athleteId: otherId, deviceTimeMs: t });
    void send({ ...base, type: "edit", targetTapId: other.tapId, athleteId, deviceTimeMs: t + 1 });
    onDone(`Swapped ${name} and ${athletes[otherId]}`);
  };

  const assignSlot = (e: SyntheticEvent, slot: Slot) => {
    if (mark) void send({ ...base, type: "void", targetTapId: mark.tapId, deviceTimeMs: eventTimeMs(e) });
    void send({ ...base, type: "assign", athleteId, targetTapId: slot.tapId, deviceTimeMs: eventTimeMs(e) });
    onDone(`${name}: ${fmt(slot.timeMs)}`);
  };

  const markMissed = (e: SyntheticEvent) => {
    if (mark) void send({ ...base, type: "edit", targetTapId: mark.tapId, missed: true, deviceTimeMs: eventTimeMs(e) });
    else void send({ ...base, type: "edit", athleteId, missed: true, deviceTimeMs: eventTimeMs(e) });
    onDone(`${name}: missed at ${checkpoint.label}`);
  };

  const remove = (e: SyntheticEvent) => {
    if (!mark) return;
    void send({ ...base, type: "void", targetTapId: mark.tapId, deviceTimeMs: eventTimeMs(e) });
    onDone(`Deleted ${name}'s ${checkpoint.label} time`);
  };

  const list = (ids: string[], onPick: (e: SyntheticEvent, id: string) => void, empty: string) =>
    ids.length === 0 ? (
      <p className="text-sm text-ink-2">{empty}</p>
    ) : (
      <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto">
        {ids.map((id) => {
          const m = cp?.byAthlete.get(id);
          return (
            <button key={id} type="button" onClick={(e) => onPick(e, id)} className="rounded-lg border border-line bg-surface px-3 py-2 text-left hover:bg-surface-2 active:bg-gold-soft">
              <span className="block text-sm font-medium text-ink">{athletes[id]}</span>
              {m && !m.missed && <Time className="block text-xs text-ink-2">{fmt(m.timeMs)}</Time>}
            </button>
          );
        })}
      </div>
    );

  const timeLabel = mark ? (mark.missed ? "missed" : fmt(mark.timeMs)) : "no time";

  return (
    <Sheet
      title={name}
      subtitle={
        <>
          {checkpoint.label} · <Time>{timeLabel}</Time>
          {mark?.by && ` · recorded by ${mark.by}`}
        </>
      }
      onClose={onClose}
    >
      {error && (
        <div className="mb-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {mode === "menu" && mark && !mark.missed && (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-2">
            <Btn onClick={(e) => nudge(e, -1000)}>−1s</Btn>
            <Btn onClick={(e) => nudge(e, -500)}>−0.5s</Btn>
            <Btn onClick={(e) => nudge(e, 500)}>+0.5s</Btn>
            <Btn onClick={(e) => nudge(e, 1000)}>+1s</Btn>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Btn onClick={() => setMode("type")}>Type time</Btn>
            <Btn onClick={() => setMode("move")}>Move to…</Btn>
            <Btn onClick={() => setMode("swap")}>Swap with…</Btn>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={markMissed}>Mark missed</Btn>
            <Btn onClick={remove} danger>
              Delete
            </Btn>
          </div>
        </div>
      )}

      {mode === "menu" && (!mark || mark.missed) && (
        <div className="space-y-3">
          {cp && cp.pending.length > 0 && (
            <div>
              <SectionLabel className="mb-1.5">Use an unassigned capture</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {cp.pending.map((s) => (
                  <Btn key={s.tapId} onClick={(e) => assignSlot(e, s)}>
                    <Time>{fmt(s.timeMs)}</Time>
                  </Btn>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => setMode("add")}>Add time</Btn>
            {!mark?.missed && <Btn onClick={markMissed}>Mark missed</Btn>}
            {mark?.missed && (
              <Btn onClick={remove} danger>
                Clear missed
              </Btn>
            )}
          </div>
        </div>
      )}

      {(mode === "type" || mode === "add") && (
        <form onSubmit={saveTyped} className="space-y-3">
          <Field label={`${mode === "add" ? "Time" : "New time"} since the gun`} hint={typedPreview ?? "Digits are enough: 640 is 6:40, 640.5 is 6:40.5."}>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setError(null);
              }}
              placeholder={gunTimeMs ? "6:40" : "set the gun time first"}
              disabled={!gunTimeMs}
              inputMode="decimal"
              className="h-12 font-mono text-xl"
            />
          </Field>
          {mode === "add" && <Checkbox label="This is an estimate" checked={estimate} onChange={(e) => setEstimate(e.target.checked)} />}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setMode("menu")}>
              Back
            </Button>
            <Button type="submit" size="lg" disabled={!gunTimeMs}>
              Save
            </Button>
          </div>
        </form>
      )}

      {mode === "move" && (
        <div className="space-y-3">
          <SectionLabel>Move this time to</SectionLabel>
          {list(withoutTime, moveTo, "Everyone else already has a time here; use Swap instead.")}
          <Button variant="secondary" onClick={() => setMode("menu")} className="w-full">
            Back
          </Button>
        </div>
      )}

      {mode === "swap" && (
        <div className="space-y-3">
          <SectionLabel>Swap times with</SectionLabel>
          {list(withTime, swapWith, "Nobody else has a time here yet.")}
          <Button variant="secondary" onClick={() => setMode("menu")} className="w-full">
            Back
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function Btn({ onClick, children, danger, active }: { onClick: (e: SyntheticEvent) => void; children: ReactNode; danger?: boolean; active?: boolean }) {
  return (
    <Button variant={danger ? "danger" : active ? "primary" : "secondary"} size="lg" onClick={onClick}>
      {children}
    </Button>
  );
}

/** Season (or career) finishes as a small line: lower is faster, today marked, the PR as a faint line. */
function ProgressChart({ title, points, prMs, ft }: { title: string; points: { ms: number; label: string; today: boolean }[]; prMs: number | null; ft: (ms: number) => string }) {
  const W = 320;
  const H = 96;
  const padX = 14;
  const padTop = 10;
  const padBottom = 22;
  // Scale to the races themselves; a PR far below them would squash the line, so it's drawn only when it's near.
  const times = points.map((p) => p.ms);
  const pLo = Math.min(...times);
  const pHi = Math.max(...times);
  const prNear = prMs !== null && prMs >= pLo - (pHi - pLo) * 0.5 - 15_000 && prMs <= pHi;
  const lo = prNear ? Math.min(pLo, prMs!) : pLo;
  const hi = pHi;
  const span = Math.max(hi - lo, 30_000); // never flatter than a 30 s window
  const x = (i: number) => padX + (points.length === 1 ? (W - 2 * padX) / 2 : (i * (W - 2 * padX)) / (points.length - 1));
  const y = (ms: number) => padTop + ((ms - lo) / span) * (H - padTop - padBottom);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.ms).toFixed(1)}`).join(" ");
  return (
    <div className="pb-2">
      <div className="flex items-baseline justify-between border-b border-line px-3 py-2.5">
        <SectionLabel>{title}</SectionLabel>
        <span className="text-[11px] text-ink-3">lower is faster</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full px-2 pt-1" role="img" aria-label={`${title}: ${points.map((p) => `${p.label} ${ft(p.ms)}`).join(", ")}`}>
        {prMs !== null && prNear && (
          <>
            <line x1={padX} x2={W - padX} y1={y(prMs)} y2={y(prMs)} className="stroke-brand/50" strokeDasharray="3 3" />
            <text x={W - padX} y={y(prMs) - 3} textAnchor="end" className="fill-brand-text text-[9px] font-semibold">
              PR {ft(prMs)}
            </text>
          </>
        )}
        {prMs !== null && !prNear && (
          <text x={W - padX} y={padTop} textAnchor="end" className="fill-brand-text text-[9px] font-semibold">
            PR {ft(prMs)} ↑
          </text>
        )}
        <path d={path} fill="none" className="stroke-ink-2" strokeWidth="1.5" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.ms)} r={p.today ? 4 : 2.5} className={p.today ? "fill-brand" : "fill-ink"} />
            <text x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className={`text-[9px] ${p.today ? "fill-brand-text font-semibold" : "fill-ink-3"}`}>
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/**
 * A short list of earlier finishes with today's run slotted in where it
 * ranks. Tap a row to see that race's splits beside today's; "Open" goes
 * to that meet.
 */
function FinishList({
  title,
  note,
  rows,
  today,
  meetName,
  todaySplits,
  checkpoints,
  tags,
  link,
  ft,
  when,
}: {
  title: string;
  note?: string;
  rows: PriorFinish[];
  /** Today's finish; rank null means "append in date order" (a season list). */
  today: { ms: number; precision: Precision | null; rank: number | null; tags: string[] } | null;
  meetName: string;
  todaySplits: Record<string, number>;
  checkpoints: { meters: string; label: string }[];
  tags: (f: PriorFinish) => string[];
  link: (f: PriorFinish) => string;
  ft: (ms: number, p?: Precision | null) => string;
  when: (f: PriorFinish) => string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const tag = (text: string) => (
    <span key={text} className="rounded border border-line px-1 text-[10px] font-semibold tracking-wide text-ink-2 uppercase">
      {text}
    </span>
  );
  const items: ReactNode[] = rows.map((f) => {
    const isOpen = open === f.raceId;
    return (
      <div key={f.raceId} className="rounded-md">
        <button type="button" onClick={() => setOpen(isOpen ? null : f.raceId)} aria-expanded={isOpen} className={`flex w-full items-center gap-x-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2 ${isOpen ? "bg-surface-2" : ""}`}>
          <span className="min-w-0 flex-1 truncate text-ink-2">{when(f)}</span>
          {tags(f).map(tag)}
          <Time className="shrink-0 font-medium text-ink">{ft(f.ms, f.precision)}</Time>
        </button>
        {isOpen && (
          <div className="px-2 pt-1 pb-2">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-[13px]">
              <span />
              <span className="text-right text-[10px] font-semibold tracking-wide text-ink-3 uppercase">then</span>
              <span className="text-right text-[10px] font-semibold tracking-wide text-ink-3 uppercase">this race</span>
              <span className="w-12 text-right text-[10px] font-semibold tracking-wide text-ink-3 uppercase">diff</span>
              {checkpoints.map((c) => {
                const then = c.meters === checkpoints[checkpoints.length - 1].meters ? f.ms : (f.splits[c.meters] ?? null);
                const now = todaySplits[c.meters] ?? null;
                return (
                  <Fragment key={c.meters}>
                    <span className="text-ink-2">{c.label}</span>
                    <Time className="text-right text-ink-2">{then !== null ? ft(then, f.precision) : "—"}</Time>
                    <Time className="text-right font-medium text-ink">{now !== null ? ft(now, c.meters === checkpoints[checkpoints.length - 1].meters ? today?.precision : null) : "—"}</Time>
                    <Time className="w-12 text-right">{then !== null && now !== null ? <DeltaText ms={now - then} /> : <span className="text-ink-3">—</span>}</Time>
                  </Fragment>
                );
              })}
            </div>
            <Link href={link(f)} className="mt-2 inline-block text-[13px] text-ink underline decoration-line underline-offset-2">
              Open {f.meetName} {f.date.slice(0, 4)}
            </Link>
          </div>
        )}
      </div>
    );
  });
  if (today) {
    const at = today.rank === null ? items.length : Math.min(today.rank - 1, items.length);
    items.splice(
      at,
      0,
      <div key="today" className="flex items-center gap-x-2 bg-brand-soft px-2 py-1.5 text-sm">
        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{meetName}</span>
        {today.tags.map((text) => (
          <span key={text} className="rounded bg-brand px-1 text-[10px] font-semibold tracking-wide text-brand-ink uppercase">
            {text}
          </span>
        ))}
        <Time className="shrink-0 font-semibold text-ink">{ft(today.ms, today.precision)}</Time>
      </div>,
    );
  }
  return (
    <div className="pb-2">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-3 py-2.5">
        <SectionLabel>{title}</SectionLabel>
        {note && <span className="text-[11px] text-ink-3">{note}</span>}
      </div>
      <div className="flex flex-col divide-y divide-line px-1 pt-1">{items}</div>
    </div>
  );
}

/** The small print, together and labelled rather than loose under the buttons. Nothing when there's nothing to say. */
function Notes({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
        <Info className="size-3.5" />
        Notes
      </div>
      <ul className="space-y-1 text-xs leading-relaxed text-ink-2">
        {lines.map((line) => (
          <li key={line} className="flex gap-2">
            <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A name with a PR / SB pill that never ends up on a line of its own: the pill is glued to the last
 * word, so a long name in a narrow column wraps as "Elanore / Faucher [PR]".
 */
function NameWithPill({ name, pill }: { name: string; pill: ReactNode }) {
  if (!pill) return <>{name}</>;
  const words = name.split(" ");
  const last = words.pop() ?? "";
  return (
    <>
      {words.length > 0 && `${words.join(" ")} `}
      <span className="whitespace-nowrap">
        {last}
        {pill}
      </span>
    </>
  );
}

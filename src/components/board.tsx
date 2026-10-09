"use client";

import Link from "next/link";
import { type ReactNode, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Share } from "lucide-react";
import { CheckpointCounts, DeltaText, RaceStatusBar } from "@/components/race-status";
import { SessionMenu } from "@/components/session-menu";
import { Alert, AppHeader, Badge, Button, Card, Checkbox, Field, Input, LinkButton, LiveDot, SectionLabel, Segmented, Sheet, Time, Toast } from "@/components/ui";
import { useClock } from "@/lib/client/clock";
import { useRaceTaps } from "@/lib/client/use-race-taps";
import { type AthleteStatus, type CheckpointState, expectedAt, type Mark, replay, replayStatuses, type Slot, STATUS_LABEL, STATUS_LONG } from "@/lib/replay";
import type { AthleteRaceStatus } from "@/lib/db/schema";
import { lastFinished } from "@/lib/order";
import type { LineupHistory } from "@/lib/results/history";
import { METERS_PER_MILE, paceMsPerMile, projectElapsed } from "@/lib/pace";
import { formatClock, formatElapsed, parseElapsed } from "@/lib/time";

type RaceInfo = {
  id: string;
  name: string;
  gunTimeMs: number | null;
  finished: boolean;
  checkpoints: { id: string; label: string; meters: number; kind: "split" | "finish" }[];
  athleteIds: string[];
  /** Level label per athlete in this race (Varsity / JV). */
  levels: Record<string, string>;
  /** Earlier results this season, for "vs last meet" on the athlete sheet. */
  history: LineupHistory;
};

type Props = {
  meetId: string;
  meetName: string;
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


export function Board({ meetId, meetName, session, initialRaceId, timeZone, races, athletes, genders, grades, initialAthleteId, canFix, canTap }: Props) {
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
type Cell = { mark: Mark | undefined; official: number | null; elapsedMs: number | null; absoluteMs: number | null; missed: boolean; beforeGun?: boolean };
type Row = { athleteId: string; marks: (Mark | undefined)[]; cells: Cell[]; reached: number; officialStatus: string | null; officialPlace: number | null; status: AthleteStatus | undefined };

function RaceBoard({
  meetId,
  meetName,
  race,
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
  const { taps, gunTimeMs, official, officialLive, finished, longRunning, staleMinutes, send, online, loaded, recording, seenAt } = useRaceTaps(race.id, race.gunTimeMs);
  const isFinished = race.finished || finished;
  const hasOfficial = Object.keys(official).length > 0;
  const state = useMemo(
    () => replay({ checkpoints: race.checkpoints.map((c) => ({ ...c, distance: { value: 0, unit: "mi", meters: 0 }, kind: "split" })) }, taps),
    [race, taps],
  );
  const statuses = useMemo(() => replayStatuses(taps), [taps]);
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
  const [view, setView] = useState<"splits" | "both">("both");
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

  const fmt = useCallback(
    (ms: number | null) => (ms === null ? "—" : gunTimeMs ? (ms < gunTimeMs ? "before gun" : formatElapsed(ms - gunTimeMs)) : formatClock(ms, timeZone)),
    [gunTimeMs, timeZone],
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
        if (o !== null && o !== undefined) return { mark: m, official: o, elapsedMs: o, absoluteMs: null, missed: false, beforeGun: false };
        const abs = m && !m.missed && m.timeMs !== null ? m.timeMs : null;
        // A tap from before the gun (race restarted) isn't a time: shown as "before gun", counted as nothing.
        const beforeGun = abs !== null && !!gunTimeMs && abs < gunTimeMs;
        return { mark: m, official: null, elapsedMs: abs !== null && gunTimeMs && !beforeGun ? abs - gunTimeMs : null, absoluteMs: beforeGun ? null : abs, missed: !!m?.missed, beforeGun };
      });
      let reached = -1;
      cells.forEach((cell, i) => {
        if (cell.official !== null || cell.absoluteMs !== null) reached = i;
      });
      // Official results outrank an app-side DNS/DNF: the timing company saw them finish.
      return { athleteId, marks, cells, reached, officialStatus: off?.status ?? null, officialPlace: off?.place ?? null, status: off ? undefined : statuses.get(athleteId) };
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

  // Elapsed-from-gun time at a checkpoint (official beats app), for projections and the team line.
  const elapsedAt = (row: Row, i: number): number | null => {
    const c = row.cells[i];
    return c ? (c.official ?? c.elapsedMs) : null;
  };
  const finishIndex = race.checkpoints.findIndex((c) => c.kind === "finish");
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
  const finishTimes =
    finishIndex < 0 || (combined && who === "all")
      ? []
      : rows
          .filter((r) => !(r.status || (r.officialStatus && r.officialStatus !== "finished")))
          .map((r) => elapsedAt(r, finishIndex))
          .filter((t): t is number => t !== null)
          .sort((a, b) => a - b);
  const teamLine =
    finishTimes.length >= 5
      ? `Top 5 avg ${formatElapsed(Math.round(finishTimes.slice(0, 5).reduce((a, b) => a + b, 0) / 5))} · 1–5 spread ${formatElapsed(finishTimes[4] - finishTimes[0])} · ${finishTimes.length} finished`
      : finishTimes.length > 0
        ? `${finishTimes.length} finished`
        : null;

  return (
    <>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-1">
          <RaceStatusBar finished={isFinished} gunTimeMs={gunTimeMs} now={clock.now} official={officialLive ? "live" : hasOfficial ? "imported" : "none"} />
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

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
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
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "both", label: "Cumulative + splits" },
              { value: "splits", label: "Splits only" },
            ]}
            className="w-full sm:w-80"
          />
        </div>
      </div>

      {teamLine && <p className="mb-3 text-[13px] text-ink-2">{teamLine}</p>}

      {recording.length > 0 && !isFinished && (
        <p className="mb-3 text-[13px] text-ink-2">
          <span className="font-medium text-ink">Recording now</span>
          {race.checkpoints
            .map((c) => ({ c, who: [...new Set(recording.filter((r) => r.checkpointId === c.id).map((r) => r.name))] }))
            .filter(({ who }) => who.length > 0)
            .map(({ c, who }) => (
              <span key={c.id}>
                {" · "}
                {c.label}: {who.join(", ")}
              </span>
            ))}
        </p>
      )}

      {longRunning && (
        <div className="mb-3">
          <Alert tone="gold">This race has been running for over 90 minutes. Mark it finished (meet page → Options → Adjust) to stop live updates.</Alert>
        </div>
      )}

      {editing && (
        <div className="mb-3">
          <Alert tone="gold">Fix mode: tap any time to nudge, move, swap, mark missed or delete it. Tap Done when you&rsquo;re finished.</Alert>
        </div>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
              <th className="px-3 py-2 font-semibold sm:px-4">{hasOfficial ? "Place · Athlete" : "Athlete"}</th>
              {race.checkpoints.map((c, i) => (
                <th key={c.id} className="px-2 py-2 text-right font-semibold last:px-3 sm:last:px-4">
                  {c.label}
                  {view === "both" && <span className="hidden text-[10px] font-normal tracking-normal normal-case text-ink-3 min-[420px]:block">cumulative · split</span>}
                  {view === "splits" && (
                    <span className="hidden text-[10px] font-normal tracking-normal normal-case text-ink-3 min-[420px]:block">
                      {(() => {
                        const prev = i > 0 ? race.checkpoints[i - 1].meters : 0;
                        const mi = (c.meters - prev) / METERS_PER_MILE;
                        return `${Number.isInteger(+mi.toFixed(2)) ? mi.toFixed(0) : mi.toFixed(2)} mi`;
                      })()}
                    </span>
                  )}
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
                <td className={`px-3 py-2 align-top font-medium sm:px-4 ${row.reached < 0 ? "" : "text-ink"}`}>
                  {/* Place in its own column so a wrapped name hangs under its first line, not under the number. */}
                  <span className="flex items-start gap-2">
                    {hasOfficial && <span className="tnum w-6 shrink-0 py-1 text-right text-ink-3">{row.officialPlace ?? ""}</span>}
                    <span className="min-w-0">
                      {editing ? (
                        <button type="button" onClick={() => setStatusFor(row.athleteId)} className="-mx-1.5 rounded px-1.5 py-1 text-left hover:bg-gold-soft" title="Set DNS / DNR / DNF">
                          {athletes[row.athleteId]}
                        </button>
                      ) : (
                        <button type="button" onClick={() => setAthleteSheet(row.athleteId)} className="-mx-1.5 rounded px-1.5 py-1 text-left">
                          {athletes[row.athleteId]}
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
                      <td key={race.checkpoints[i].id} className="px-1 py-1 text-right align-top text-ink-3 last:pr-2 sm:last:pr-3">
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
                  const segMeters = race.checkpoints[i].meters - (i > 0 ? race.checkpoints[i - 1].meters : 0);
                  const prevHere = i > 0 ? t(row.cells[i - 1]) : null;
                  const prevPrev = i > 1 ? t(row.cells[i - 2]) : i === 1 ? 0 : null;
                  const prevSplit = prevHere !== null && prevPrev !== null ? prevHere - prevPrev : null;
                  const prevPace = prevSplit !== null ? paceMsPerMile(prevSplit, race.checkpoints[i - 1].meters - (i > 1 ? race.checkpoints[i - 2].meters : 0)) : null;
                  const last = i === row.cells.length - 1;
                  const cumulative = cell.official !== null ? formatElapsed(cell.official) : cell.absoluteMs !== null ? fmt(cell.absoluteMs) : "—";
                  const shown = cell.missed ? "missed" : cell.beforeGun ? "before gun" : view === "splits" && i > 0 ? (split === null ? "—" : formatElapsed(split)) : cumulative;
                  const flag = cell.official !== null ? "" : m && !cell.missed && shown !== "—" ? (m.estimate ? "~" : m.edited ? "*" : "") : "";
                  const projected = here === null && !cell.missed ? projectAt(row, i) : null;
                  const fresh = isFresh(m?.tapId);
                  const cellNode = (
                    <>
                      {projected !== null ? (
                        <span className={`block ${staff && overdue(projected) ? "text-gold-text/75" : "text-ink-3"}`}>
                          <Time className="block">~{formatElapsed(projected).replace(/\.\d$/, "")}</Time>
                          <span className="block text-[10px] tracking-wide uppercase">{staff && overdue(projected) ? "overdue" : "projected"}</span>
                        </span>
                      ) : (
                        <Time className={`block ${cell.missed || cell.beforeGun ? "italic" : last && here !== null && view !== "splits" ? "font-semibold" : ""}`}>
                          {shown}
                          {flag}
                        </Time>
                      )}
                      {view === "both" && i > 0 && split !== null && (
                        <Time className="block text-[11px] text-ink-3">
                          {formatElapsed(split)}
                          {prevPace !== null && segMeters > 0 && (
                            <>
                              {" "}
                              <DeltaText ms={paceMsPerMile(split, segMeters) - prevPace} suffix="/mi" />
                            </>
                          )}
                        </Time>
                      )}
                      {view === "splits" && split !== null && (
                        <Time className="block text-[11px] text-ink-3">
                          {formatElapsed(paceMsPerMile(split, segMeters)).replace(/\.\d$/, "")}/mi
                          {prevPace !== null && (
                            <>
                              {" · "}
                              <DeltaText ms={paceMsPerMile(split, segMeters) - prevPace} />
                            </>
                          )}
                        </Time>
                      )}
                      {view === "splits" && last && i > 0 && here !== null && !cell.missed && (
                        <Time className="block text-[11px] font-semibold text-ink">
                          {cumulative}
                          {flag}
                        </Time>
                      )}
                    </>
                  );
                  return (
                    <td key={race.checkpoints[i].id} className="px-1 py-1 text-right align-top last:pr-2 sm:last:pr-3">
                      {editing && cell.official === null ? (
                        <button
                          type="button"
                          onClick={() => setFix({ athleteId: row.athleteId, cpIndex: i })}
                          className="w-full rounded-md border border-dashed border-line-strong px-1.5 py-1 text-right hover:bg-surface-2 active:bg-brand-soft"
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
      </Card>

      {pendingTotal > 0 && (
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
        {!editing && "Tap a runner for their splits, pace and comparison. "}* edited &nbsp; ~ estimate{!isFinished && ` · a ~ time marked projected is a guess from the runner's last split${staff ? "; overdue means they're more than a minute past it" : ""}`} &nbsp;{hasOfficial && (officialLive ? "Official times from the timing company's live feed replace app taps as they post. " : "Official times replace app taps where imported. ")}{" "}
        {view === "splits"
          ? "Splits are the time since the previous checkpoint; beneath each, the pace per mile and the change from the previous segment (+ slower, − faster). The finish column also shows the finish time."
          : "Cumulative time from the gun, with the split beneath and the pace change from the previous segment (+ slower, − faster)."}{" "}
        Updates every few seconds.
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
          onShared={showToast}
          history={race.history.byAthlete[openAthlete]}
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
  row,
  name,
  grade,
  neighbors,
  onPick,
  projectAt,
  overdue,
  history,
  teamRank,
  raceClockMs,
  onShared,
  onClose,
}: {
  race: RaceInfo;
  meetName: string;
  row: Row | undefined;
  name: string;
  grade: number | null;
  /** The runners either side in the table, for walking the team without closing. */
  neighbors: { prev: { id: string; name: string } | null; next: { id: string; name: string } | null };
  onPick: (id: string) => void;
  /** Projected elapsed time at checkpoint i while the race runs, else null. */
  projectAt: (i: number) => number | null;
  overdue: (projected: number) => boolean;
  history: LineupHistory["byAthlete"][string] | undefined;
  /** Position within the runner's gender + level group, e.g. { rank: 3, of: 7, team: "girls varsity team" }. */
  teamRank: { rank: number; of: number; team: string } | null;
  /** Elapsed race time right now (ms), while the race runs. */
  raceClockMs: number | null;
  /** A toast, for the clipboard fallback. */
  onShared: (msg: string) => void;
  onClose: () => void;
}) {
  const last = lastFinished(history);
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
      return v !== null ? [`${c.label} ${formatElapsed(v)}`] : [];
    });
    const headline = finish !== null ? formatElapsed(finish) : status ? status.short : raceClockMs !== null ? "in progress" : parts.length ? "" : "not started";
    const text = [`${name} — ${race.name}, ${meetName}`, headline, row?.officialPlace != null ? `${row.officialPlace}${ordinal(row.officialPlace)} place` : "", ...parts]
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
  const refAt = (i: number): number | null => {
    if (!last) return null;
    const c = race.checkpoints[i];
    return c.kind === "finish" ? last.finishMs : (last.splits[String(c.meters)] ?? null);
  };

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
              <Time className="text-4xl font-semibold tracking-tight text-ink">{finish !== null ? formatElapsed(finish) : projected !== null ? `~${formatElapsed(projected).replace(/\.\d$/, "")}` : "—"}</Time>
              {avgPace !== null && <Time className="block text-[13px] text-ink-2">{formatElapsed(avgPace).replace(/\.\d$/, "")}/mi average</Time>}
            </>
          )}
        </div>
        {/* The other big number: place once they've finished, the race clock while they're out there. */}
        {row?.officialPlace != null ? (
          <div className="text-right">
            <div className="text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Place</div>
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
              <Time className="text-4xl font-semibold tracking-tight text-ink">{formatElapsed(raceClockMs).replace(/\.\d$/, "")}</Time>
            </div>
          )
        )}
      </div>
      {/* Secondary stats: a size down from the headline pair, with room above. */}
      {(teamRank || (last && last.finishMs !== null) || (raceClockMs !== null && finish === null && !status && lastSeen)) && (
        <div className="mt-5 mb-4 flex items-end justify-between gap-x-6 gap-y-3 border-t border-line pt-3">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {teamRank && (
              <SmallStat value={`${teamRank.rank}${ordinal(teamRank.rank)} of ${teamRank.of} runner${teamRank.of === 1 ? "" : "s"}`} label={finish === null && lastSeen ? `${teamRank.team} at ${lastSeen.label}` : teamRank.team} />
            )}
            {last && last.finishMs !== null && (
              <SmallStat
                value={finish !== null ? <DeltaText ms={finish - last.finishMs} /> : <span className="text-ink-2">{formatElapsed(last.finishMs)}</span>}
                label={finish !== null ? "vs last meet" : "last meet"}
              />
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
          <span className="w-16 shrink-0 text-right">Time</span>
          <span className="w-32 shrink-0 text-right">Split · pace</span>
          {last && <span className="w-14 shrink-0 text-right">vs last</span>}
        </div>
        {race.checkpoints.map((c, i) => {
          const here = t(i);
          const before = i > 0 ? t(i - 1) : here !== null ? 0 : null;
          const split = here !== null && before !== null ? here - before : null;
          const segMeters = c.meters - (i > 0 ? race.checkpoints[i - 1].meters : 0);
          const ref = refAt(i);
          const cell = row?.cells[i];
          return (
            <div key={c.id} className="flex items-center gap-x-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 font-medium text-ink">
                {c.label}
                {cell?.official !== null && cell?.official !== undefined && <span className="ml-1.5 text-[10px] font-semibold tracking-wide text-brand-text uppercase">official</span>}
                {cell?.mark?.estimate && cell.official === null && <span className="ml-1.5 text-xs text-ink-3">estimate</span>}
              </span>
              {(() => {
                const p = here === null && !cell?.missed ? projectAt(i) : null;
                if (p === null) return <Time className="w-16 shrink-0 text-right font-semibold text-ink">{cell?.missed ? "missed" : here !== null ? formatElapsed(here) : "—"}</Time>;
                const late = overdue(p);
                return (
                  <span className={`w-16 shrink-0 text-right ${late ? "text-gold-text/75" : "text-ink-3"}`}>
                    <Time className="block">~{formatElapsed(p).replace(/\.\d$/, "")}</Time>
                    <span className="block text-[10px] tracking-wide uppercase">{late ? "overdue" : "projected"}</span>
                  </span>
                );
              })()}
              <Time className="w-32 shrink-0 text-right whitespace-nowrap text-ink-2">
                {split !== null && segMeters > 0 ? `${formatElapsed(split)} · ${formatElapsed(paceMsPerMile(split, segMeters)).replace(/\.\d$/, "")}/mi` : "—"}
              </Time>
              {last && (
                <Time className="w-14 shrink-0 text-right">{here !== null && ref !== null ? <DeltaText ms={here - ref} /> : ref !== null ? <span className="text-ink-3">{formatElapsed(ref)}</span> : <span className="text-ink-3">—</span>}</Time>
              )}
            </div>
          );
        })}
      </div>
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
      <p className="mt-2 text-xs text-ink-3">
        {officialCount === 0 && timedCount > 0 && "Times are from the app, not the timing company. "}
        {officialCount > 0 && officialCount < timedCount && "Times not marked official are from the app. "}
        {!last && "No earlier results this season to compare with."}
      </p>
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
    const ms = parseElapsed(text);
    if (ms === null) return null;
    return gunTimeMs ? gunTimeMs + ms : null;
  };

  const nudge = (e: SyntheticEvent, deltaMs: number) => {
    if (!mark?.timeMs) return;
    void send({ ...base, type: "edit", targetTapId: mark.tapId, timeMs: mark.timeMs + deltaMs, deviceTimeMs: eventTimeMs(e) });
    onDone(`${name}: ${fmt(mark.timeMs + deltaMs)}`);
  };

  const saveTyped = (e: SyntheticEvent) => {
    e.preventDefault();
    const timeMs = absolute(typed);
    if (timeMs === null) return setError(gunTimeMs ? "Use m:ss.t, like 6:02.4" : "Set the gun time first");
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
          <Field label={`${mode === "add" ? "Time" : "New time"} (elapsed, m:ss.t)`}>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={gunTimeMs ? "6:02.4" : "set the gun time first"}
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

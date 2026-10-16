"use client";

import Link from "next/link";
import { type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Pencil, SlidersHorizontal, Undo2, X } from "lucide-react";
import { ClockWarning } from "@/components/race-card";
import { PlacesCard } from "@/components/places-card";
import { PlacesPad, type PlacesMode } from "@/components/places-pad";
import { CheckpointCounts, DeltaText, RaceStatusBar } from "@/components/race-status";
import { StartRaceControl } from "@/components/start-race";
import { SessionMenu } from "@/components/session-menu";
import { Alert, AppHeader, Badge, Button, LinkButton, SectionLabel, Segmented, Sheet, Time, Toast, RaceStateBadge } from "@/components/ui";
import { useClock } from "@/lib/client/clock";
import { useLocalValue } from "@/lib/client/use-local-value";
import { type Recording, useRaceTaps } from "@/lib/client/use-race-taps";
import { useWakeLock } from "@/lib/client/use-wake-lock";
import type { RacePlaces } from "@/lib/db/schema";
import { type OrderMode, lastFinished, orderAthletes, orderKey, parseOrderMode } from "@/lib/order";
import { ordinal, type OurTeam, racePlaces, replayTicks } from "@/lib/race-places";
import { paceMsPerMile, projectElapsed } from "@/lib/pace";
import { type AthleteStatus, expectedAt, type Mark, replay, replayStatuses, type Slot, type SlotWithNames, STATUS_LABEL, STATUS_LONG, type TapLike } from "@/lib/replay";
import type { LineupHistory, PriorResult } from "@/lib/results/history";
import { formatClock, formatElapsed } from "@/lib/time";

type RaceInfo = {
  id: string;
  name: string;
  gunTimeMs: number | null;
  finished: boolean;
  checkpoints: { id: string; label: string; kind: "split" | "finish"; meters: number }[];
  /** The lineup in the coach's order. */
  athleteIds: string[];
  history: LineupHistory;
  /** Place counting, when the race has it on. */
  places: RacePlaces | null;
  /** Our school, for the places buttons. */
  ourTeam: OurTeam;
};

type Props = {
  meetId: string;
  meetName: string;
  session: { name: string; role: string };
  initial: { raceId: string | null; checkpointId: string | null };
  timeZone: string;
  /** The meet has a course on file, so "vs this course" can mean something. */
  hasCourse: boolean;
  canGun: boolean;
  races: RaceInfo[];
  athletes: Record<string, string>;
};

const DOUBLE_TAP_MS = 1000;
/** Press-and-hold on a tile opens the DNS / DNF sheet. */
const HOLD_MS = 600;
/** A capture taken on this phone stays open for more names this long (a pack crossing together). */
const CAPTURE_OPEN_MS = 12_000;
/** An empty capture this phone took is offered to the next name for this long; after that, pick its chip. */
const PENDING_OPEN_MS = 2 * 60_000;
/** How long a capture chip stays in the bottom bar after it was taken. */
const CHIP_TTL_MS = 3 * 60_000;
const INTRO_KEY = "ls_record_intro_seen";
const ORDER_KEY = "ls_record_order_";
const COMPARE_KEY = "ls_record_compare";
const LARGE_KEY = "ls_record_large";
/** This phone's part in counting places: "both" (names and teams), "places" (places only) or "names". */
const PLACES_MODE_KEY = "ls_record_places_mode";
type RecordMode = PlacesMode | "names";
const MODES: { value: RecordMode; label: string; hint: string }[] = [
  { value: "names", label: "Times", hint: "Our runners' splits." },
  { value: "both", label: "Times + places", hint: "Our runners' splits, and a button for every other runner." },
  { value: "places", label: "Places", hint: "Count every runner. Times come from whoever taps names here." },
];
/** What each mode does, as the server records it. */
const JOB: Record<RecordMode, "times" | "places" | "both"> = { names: "times", both: "both", places: "places" };
const countsPlaces = (job: string) => job === "places" || job === "both";
const timesRunners = (job: string) => job === "times" || job === "both";
const JOB_LABEL: Record<string, string> = { times: "times", places: "places", both: "times + places" };
const names = (list: { name: string }[]) => [...new Set(list.map((r) => r.name))].join(" and ");
/** This phone's job at a race that counts places (default: both). */
const modeFrom = (pref: string | null): RecordMode => (pref === "places" || pref === "names" ? pref : "both");
/** How many of this device's latest taps the bottom strip shows. */
const RECENT_N = 3;
type CompareMode = "last" | "course" | "off";
const TOAST_MS = 2500;
/** How long the shout card (our runner's place) stays up. */
const SHOUT_MS = 5000;
const FLASH_MS = 400;

/**
 * When the tap happened, as epoch ms. The finger landing (pointerdown) is the
 * moment that matters; the click fires on the lift, which for a deliberate
 * press can be hundreds of ms later. The event's performance-clock timestamp
 * isn't used because iOS pauses that clock while the phone sleeps.
 */
let lastPointerDownMs = 0;
const notePointerDown = () => {
  lastPointerDownMs = Date.now();
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const eventTimeMs = (_e: SyntheticEvent) => {
  const now = Date.now();
  return lastPointerDownMs && now - lastPointerDownMs < 1500 ? lastPointerDownMs : now;
};

export function TapScreen({ meetId, meetName, session, initial, timeZone, hasCourse, canGun, races, athletes }: Props) {
  useWakeLock();
  // Selection lives in the URL (?race=&cp=) so a reload lands on the same checkpoint.
  const [sel, setSel] = useState(() => {
    const r = races.find((x) => x.id === initial.raceId) ?? races.find((x) => !x.finished) ?? races[0];
    const c = r?.checkpoints.find((x) => x.id === initial.checkpointId) ?? r?.checkpoints[0];
    return { raceId: r?.id ?? "", checkpointId: c?.id ?? "" };
  });
  const race = races.find((r) => r.id === sel.raceId) ?? races[0];
  const cpIndex = Math.max(0, race?.checkpoints.findIndex((c) => c.id === sel.checkpointId) ?? 0);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("race", sel.raceId);
    url.searchParams.set("cp", sel.checkpointId);
    window.history.replaceState(window.history.state, "", url);
  }, [sel]);

  if (!race || race.checkpoints.length === 0) {
    return (
      <main className="p-6 text-sm text-ink-2">
        No races with checkpoints yet.{" "}
        <Link href={`/meets/${meetId}`} className="text-ink underline">
          Back to the meet
        </Link>
        .
      </main>
    );
  }

  return (
    <RaceTapper
      key={race.id}
      meetId={meetId}
      meetName={meetName}
      session={session}
      timeZone={timeZone}
      race={race}
      cpIndex={cpIndex}
      athletes={athletes}
      hasCourse={hasCourse}
      canGun={canGun}
      onSwitch={setSel}
      pickerFor={(current) => <SwitchControl races={races} race={race} checkpointId={race.checkpoints[cpIndex].id} current={current} onSwitch={setSel} />}
    />
  );
}

/**
 * Where taps go. Changing it is deliberate: open the sheet, pick, confirm.
 * A stray tap on a segmented control was too easy to make mid-race.
 */
type RaceSummary = { counts: Record<string, number>; gunTimeMs: number | null; recording: Recording[] };

function SwitchControl({
  races,
  race,
  checkpointId,
  current,
  onSwitch,
}: {
  races: RaceInfo[];
  race: RaceInfo;
  checkpointId: string;
  /** Live numbers for the race we're on; other races are fetched when picked. */
  current: RaceSummary;
  onSwitch: (sel: { raceId: string; checkpointId: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState({ raceId: race.id, checkpointId });
  const [fetched, setFetched] = useState<Record<string, RaceSummary>>({});
  const [modePref, setModePref] = useLocalValue(PLACES_MODE_KEY);
  const [pickMode, setPickMode] = useState<RecordMode>(modeFrom(modePref));
  const pickedRace = races.find((r) => r.id === pick.raceId) ?? race;
  const pickedCp = pickedRace.checkpoints.find((c) => c.id === pick.checkpointId) ?? pickedRace.checkpoints[0];
  const hereMode = race.places?.on ? modeFrom(modePref) : null;
  // Someone else here doing the same job: two people counting places count runners twice;
  // two people timing ask to replace each other's times (fine if they've split the runners).
  // Shown on the button's second line, so nothing moves under a thumb; the sheet explains.
  const others = current.recording.filter((r) => !r.me && r.checkpointId === checkpointId);
  const myJob = JOB[hereMode ?? "names"];
  const placeClash = hereMode && countsPlaces(myJob) ? others.filter((r) => countsPlaces(r.job)) : [];
  const timeClash = timesRunners(myJob) ? others.filter((r) => timesRunners(r.job)) : [];
  const changed = pick.raceId !== race.id || pick.checkpointId !== checkpointId || (!!pickedRace.places?.on && pickMode !== modeFrom(modePref));
  const summary: RaceSummary | null = pickedRace.id === race.id ? current : (fetched[pickedRace.id] ?? null);

  // Another race's numbers: one fetch of its log, replayed here.
  useEffect(() => {
    if (!open || pickedRace.id === race.id || fetched[pickedRace.id]) return;
    let cancelled = false;
    fetch(`/api/races/${pickedRace.id}/taps`, { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { taps: TapLike[]; gunTimeMs: number | null; recording?: Recording[] }) => {
        if (cancelled) return;
        const st = replay({ checkpoints: pickedRace.checkpoints.map((c) => ({ ...c, distance: { value: 0, unit: "mi", meters: 0 }, kind: "split" })) }, body.taps);
        const counts = Object.fromEntries(pickedRace.checkpoints.map((c) => [c.id, [...(st.get(c.id)?.byAthlete.values() ?? [])].filter((m) => !m.missed).length]));
        setFetched((f) => ({ ...f, [pickedRace.id]: { counts, gunTimeMs: body.gunTimeMs, recording: body.recording ?? [] } }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, pickedRace, race.id, fetched]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setPick({ raceId: race.id, checkpointId });
          setPickMode(modeFrom(modePref));
          setOpen(true);
        }}
        aria-label="Change race or checkpoint"
        className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line-strong bg-surface py-1.5 pr-2 pl-3 text-left shadow-card hover:bg-surface-2 active:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-2xl leading-tight font-semibold tracking-tight text-ink">{race.checkpoints.find((c) => c.id === checkpointId)?.label}</span>
          <span className="block truncate text-[13px] text-ink-2">
            {race.name}
            {hereMode && <span className="font-medium text-ink"> · {MODES.find((m) => m.value === hereMode)!.label}</span>}
            {placeClash.length > 0 ? (
              <span className="font-semibold text-danger"> · {names(placeClash)} also counting places</span>
            ) : (
              timeClash.length > 0 && <span className="font-medium text-gold-text"> · {names(timeClash)} also timing</span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 rounded-md bg-surface-2 px-2 py-1 text-[11px] font-medium text-ink-2">
          Switch
          <ChevronDown className="size-3.5" aria-hidden />
        </span>
      </button>
      {open && (
        <Sheet title="Where are you recording?" subtitle="Taps go to the race and checkpoint you pick here." onClose={() => setOpen(false)}>
          <div className="space-y-4">
            {races.length > 1 && (
              <div>
                <SectionLabel className="mb-1.5">Race</SectionLabel>
                <Segmented
                  value={pick.raceId}
                  onChange={(id) => {
                    const r = races.find((x) => x.id === id)!;
                    setPick({ raceId: r.id, checkpointId: r.checkpoints[0]?.id ?? "" });
                  }}
                  options={races.map((r) => ({ value: r.id, label: r.finished ? `${r.name} (finished)` : r.name }))}
                />
              </div>
            )}
            <div className="flex items-center gap-2 text-[13px] text-ink-2">
              <span className="font-medium text-ink">{pickedRace.name}</span>
              {summary === null && !pickedRace.finished ? (
                <span>loading…</span>
              ) : (
                <RaceStateBadge state={pickedRace.finished ? "finished" : summary?.gunTimeMs ? "in_progress" : "not_started"} />
              )}
              <span>· {pickedRace.athleteIds.length} athletes</span>
            </div>
            <div>
              <SectionLabel className="mb-1.5">Checkpoint</SectionLabel>
              <div className="grid gap-2">
                {pickedRace.checkpoints.map((c) => {
                  const active = c.id === pick.checkpointId;
                  const n = summary?.counts[c.id];
                  const here = (summary?.recording ?? []).filter((r) => !r.me && r.checkpointId === c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setPick({ raceId: pickedRace.id, checkpointId: c.id })}
                      className={`flex min-h-12 items-center justify-between gap-3 rounded-lg border px-4 py-1.5 text-left text-base font-medium ${
                        active ? "border-brand bg-brand-soft text-ink" : "border-line bg-surface text-ink hover:bg-surface-2"
                      }`}
                    >
                      <span className="min-w-0">
                        {c.label}
                        {/* Who else is here and doing what, so gaps and doubles show before picking. */}
                        {here.length > 0 && (
                          <span className="block text-xs font-normal text-ink-2">
                            {here.map((r) => `${r.name} · ${pickedRace.places?.on ? JOB_LABEL[r.job] : "times"}`).join(", ")}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2 text-[13px] font-normal text-ink-2">
                        {n !== undefined && (
                          <span className="tnum">
                            {n} of {pickedRace.athleteIds.length} recorded
                          </span>
                        )}

                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            {pickedRace.places?.on && (
              <div>
                <SectionLabel className="mb-1.5">Your job here</SectionLabel>
                <div className="grid gap-2">
                  {MODES.map((m) => (
                    <OrderRow key={m.value} active={pickMode === m.value} label={m.label} hint={m.hint} onClick={() => setPickMode(m.value)} />
                  ))}
                </div>
                {(() => {
                  const there = (summary?.recording ?? []).filter((r) => !r.me && r.checkpointId === pick.checkpointId);
                  const job = JOB[pickMode];
                  const placing = countsPlaces(job) ? there.filter((r) => countsPlaces(r.job)) : [];
                  const timing = timesRunners(job) ? there.filter((r) => timesRunners(r.job)) : [];
                  return (
                    <>
                      {placing.length > 0 && (
                        <div className="mt-2">
                        <Alert tone="danger">
                          {names(placing)} {placing.length === 1 ? "is" : "are"} already counting places at {pickedCp?.label}. Two people counting the same runners count them twice: pick Times, or a different checkpoint.
                        </Alert>
                        </div>
                      )}
                      {timing.length > 0 && (
                        <div className="mt-2">
                        <Alert tone="gold">
                          {names(timing)} {timing.length === 1 ? "is" : "are"} already timing at {pickedCp?.label}. Fine if you&rsquo;ve split our runners between you; otherwise you&rsquo;ll replace each other&rsquo;s times.
                        </Alert>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
            <Button
              size="lg"
              disabled={!changed}
              onClick={() => {
                if (pickedRace.places?.on) setModePref(pickMode === "both" ? null : pickMode);
                onSwitch(pick);
                setOpen(false);
              }}
              className="w-full"
            >
              {changed ? `Record at ${pickedCp?.label ?? ""} · ${pickedRace.name}` : `Already here: ${pickedCp?.label ?? ""} · ${pickedRace.name}`}
            </Button>
          </div>
        </Sheet>
      )}
    </>
  );
}

type LastAction = {
  tapId: string;
  /** Sent with it (a pack of Others): undone together. */
  more?: string[];
  label: string;
  /** Set when the action replaced an earlier time, so undo can put it back. */
  restore?: { athleteId: string; timeMs: number; estimate: boolean };
};

function RaceTapper({
  meetId,
  meetName,
  session,
  timeZone,
  race,
  cpIndex,
  athletes,
  hasCourse,
  canGun,
  onSwitch,
  pickerFor,
}: {
  meetId: string;
  meetName: string;
  session: { name: string; role: string };
  timeZone: string;
  race: RaceInfo;
  cpIndex: number;
  athletes: Record<string, string>;
  hasCourse: boolean;
  /** May fire the gun from here (manager or coach). */
  canGun: boolean;
  onSwitch: (sel: { raceId: string; checkpointId: string }) => void;
  pickerFor: (current: RaceSummary) => React.ReactNode;
}) {
  const clock = useClock();
  const checkpoint = race.checkpoints[cpIndex];
  const placesOn = !!race.places?.on;
  const [placesModePref] = useLocalValue(PLACES_MODE_KEY);
  // Chosen in the Switch sheet ("Your job here"), with the race and checkpoint.
  const placesMode: RecordMode = !placesOn ? "names" : modeFrom(placesModePref);
  const { taps, gunTimeMs, official, officialLive, finished, staleMinutes, send, online, signedOut, rejected, loaded, unsent, refresh, adoptGun, recording } = useRaceTaps(race.id, race.gunTimeMs, checkpoint.id, JOB[placesMode]);

  const isFinished = race.finished || finished;
  const officialAt = (athleteId: string): number | null => {
    const o = official[athleteId];
    if (!o) return null;
    return o.byCheckpoint[checkpoint.id] ?? (checkpoint.kind === "finish" ? o.finishMs : null);
  };
  const state = useMemo(
    () => replay({ checkpoints: race.checkpoints.map((c) => ({ ...c, distance: { value: 0, unit: "mi", meters: 0 }, kind: "split" })) }, taps),
    [race, taps],
  );
  const cp = state.get(checkpoint.id);
  const prev = cpIndex > 0 ? state.get(race.checkpoints[cpIndex - 1].id) : undefined;
  const statuses = useMemo(() => replayStatuses(taps), [taps]);
  const ticks = useMemo(() => replayTicks(taps), [taps]);
  const cpPlaces = useMemo(
    () => (placesOn ? racePlaces([checkpoint.id], state, ticks, gunTimeMs).get(checkpoint.id) : undefined),
    [placesOn, checkpoint.id, state, ticks, gunTimeMs],
  );
  const [scoresOpen, setScoresOpen] = useState(false);
  // The shout card: the place (and award gap) of the runner of ours just tapped, big enough for the
  // coach beside the counter to call out. By name tap (athleteId) or by a places-only school tap (tapId).
  const [shout, setShout] = useState<{ athleteId?: string; tapId?: string; key: number } | null>(null);
  const shoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shoutSeq = useRef(0);
  const showShout = (who: { athleteId?: string; tapId?: string }) => {
    shoutSeq.current += 1;
    setShout({ ...who, key: shoutSeq.current });
    if (shoutTimer.current) clearTimeout(shoutTimer.current);
    shoutTimer.current = setTimeout(() => setShout(null), SHOUT_MS);
  };
  // Done counting here, remembered on this phone (a reload mid-race doesn't unlock the buttons).
  const [placesDoneFlag, setPlacesDone] = useLocalValue(`ls_places_done_${race.id}_${checkpoint.id}`);
  const placesDone = placesDoneFlag === "1";
  // Chosen in the Switch sheet ("Your job here"), with the race and checkpoint.

  const counts = race.checkpoints.map((c, i) => {
    const has = (id: string) => {
      const o = official[id];
      const hasOfficial = o ? (o.byCheckpoint[c.id] ?? (c.kind === "finish" ? o.finishMs : null)) !== null : false;
      const m = state.get(c.id)?.byAthlete.get(id);
      return hasOfficial || (!!m && !m.missed && !(gunTimeMs && m.timeMs !== null && m.timeMs < gunTimeMs));
    };
    const missed = (id: string) => !has(id) && !!state.get(c.id)?.byAthlete.get(id)?.missed;
    return {
      id: c.id,
      label: c.label,
      n: race.athleteIds.filter(has).length,
      out: race.athleteIds.filter((id) => !has(id) && !expectedAt(statuses.get(id), i, race.checkpoints)).length,
      // Marked missed: they passed, nobody got the time. Accounted for, with no time to add.
      missed: race.athleteIds.filter((id) => missed(id) && expectedAt(statuses.get(id), i, race.checkpoints)).length,
    };
  });

  // Everyone accounted for here: offer the next checkpoint that still has runners out, or the board.
  const total = race.athleteIds.length;
  const outstanding = (i: number) => counts[i].n + counts[i].out + counts[i].missed < total;
  const hereDone = loaded && total > 0 && !isFinished && !outstanding(cpIndex);
  // A later checkpoint still waiting on runners. (An earlier one with gaps isn't "runners out":
  // everyone through here has passed it, so those are missed taps, a job for Fix times.)
  const nextCp = hereDone ? race.checkpoints.find((_, i) => i > cpIndex && outstanding(i)) : undefined;
  const gapsBehind = hereDone
    ? race.checkpoints.flatMap((c, i) => {
        if (i >= cpIndex || !outstanding(i)) return [];
        const n = total - counts[i].n - counts[i].out - counts[i].missed;
        return [`${c.label} is missing ${n} time${n === 1 ? "" : "s"}`];
      })
    : [];
  // Everything's in: say how it ended.
  const lastCp = race.checkpoints.at(-1);
  const hasTimeAtLast = (id: string) => {
    const o = official[id];
    const m = lastCp ? state.get(lastCp.id)?.byAthlete.get(id) : undefined;
    return (lastCp && o ? (o.byCheckpoint[lastCp.id] ?? (lastCp.kind === "finish" ? o.finishMs : null)) !== null : false) || (!!m && !m.missed);
  };
  const outByStatus = race.athleteIds.reduce(
    (acc, id) => {
      const st = statuses.get(id)?.status;
      // A time at the end outranks an app status (a DNF with a finish is a bookkeeping slip, not a DNF).
      if (st && !hasTimeAtLast(id) && !(official[id] && official[id].status === "finished")) acc[st] += 1;
      return acc;
    },
    { dns: 0, dnr: 0, dnf: 0 },
  );
  const allDoneText = (() => {
    if (!lastCp) return "";
    const done = lastCp.kind === "finish" ? "finished" : `through ${lastCp.label}`;
    const out = Object.values(outByStatus).reduce((a, b) => a + b, 0);
    if (out === 0) return `Everyone has ${done}.`;
    const parts = (["dnf", "dns", "dnr"] as const).filter((k) => outByStatus[k] > 0).map((k) => `${outByStatus[k]} ${STATUS_LABEL[k]}`);
    return `Everyone's accounted for: ${race.athleteIds.filter(hasTimeAtLast).length} ${done}, ${parts.join(", ")}.`;
  })();

  // Grid order. A manager's pick is remembered on this device; otherwise the previous
  // checkpoint's order, or at the first checkpoint their last race (coach's order if none).
  const [orderPref, setOrderPref] = useLocalValue(`${ORDER_KEY}${race.id}`);
  const pickedOrder = useMemo(() => parseOrderMode(orderPref), [orderPref]);
  const hasHistory = Object.keys(race.history.byAthlete).length > 0;
  const orderMode = useMemo<OrderMode>(() => {
    const auto: OrderMode = cpIndex > 0 ? { kind: "prev" } : hasHistory ? { kind: "last" } : { kind: "coach" };
    // "Previous checkpoint" means nothing at the first one; fall back rather than show A–Z under that name.
    return pickedOrder && !(pickedOrder.kind === "prev" && cpIndex === 0) ? pickedOrder : auto;
  }, [pickedOrder, cpIndex, hasHistory]);
  const pickOrder = (m: OrderMode | null) => setOrderPref(m ? orderKey(m) : null);
  const [comparePref, setComparePref] = useLocalValue(COMPARE_KEY);
  const compare: CompareMode = comparePref === "course" && hasCourse ? "course" : comparePref === "off" ? "off" : "last";
  const [largePref, setLargePref] = useLocalValue(LARGE_KEY);
  const large = largePref === "1";

  // The prior result each tile compares against: the runner's last race, or their
  // last race on this course. Times at this checkpoint are looked up by distance.
  const reference = useCallback(
    (id: string): PriorResult | undefined => {
      const list = race.history.byAthlete[id];
      if (compare === "off" || !list) return undefined;
      if (compare === "course") {
        const onCourse = new Set(race.history.races.filter((r) => r.sameCourse).map((r) => r.id));
        return list.find((r) => onCourse.has(r.raceId) && r.finishMs !== null);
      }
      return lastFinished(list);
    },
    [race.history, compare],
  );
  const referenceAt = (r: PriorResult | undefined, cp: RaceInfo["checkpoints"][number]): number | null =>
    r ? (cp.kind === "finish" ? r.finishMs : (r.splits[String(cp.meters)] ?? null)) : null;
  const compareLabel = compare === "course" ? "this course" : "last meet";

  // Elapsed times behind a tile: where they were at the previous checkpoint, and once
  // they pass here, this segment and its pace against the previous segment.
  const prevCp = cpIndex > 0 ? race.checkpoints[cpIndex - 1] : null;
  const cumAt = (index: number, id: string): number | null => {
    if (index < 0) return 0;
    const m = state.get(race.checkpoints[index].id)?.byAthlete.get(id);
    return m && !m.missed && m.timeMs !== null && gunTimeMs && m.timeMs >= gunTimeMs ? m.timeMs - gunTimeMs : null;
  };
  const tileTimes = (id: string) => {
    const here = cumAt(cpIndex, id);
    const prevCum = cumAt(cpIndex - 1, id);
    const segment = here !== null && prevCum !== null ? here - prevCum : null;
    const segMeters = checkpoint.meters - (prevCp?.meters ?? 0);
    let paceDelta: number | null = null;
    if (prevCp && segment !== null) {
      const beforePrev = cumAt(cpIndex - 2, id);
      const prevSegment = prevCum !== null && beforePrev !== null ? prevCum - beforePrev : null;
      const prevSegMeters = prevCp.meters - (cpIndex > 1 ? race.checkpoints[cpIndex - 2].meters : 0);
      if (prevSegment !== null && segMeters > 0 && prevSegMeters > 0) paceDelta = paceMsPerMile(segment, segMeters) - paceMsPerMile(prevSegment, prevSegMeters);
    }
    // When they're due here, at the pace of their last recorded segment (none for anyone out of the race).
    const due =
      here === null && gunTimeMs && !isFinished && expectedAt(statuses.get(id), cpIndex, race.checkpoints)
        ? projectElapsed(
            race.checkpoints.map((c) => c.meters),
            race.checkpoints.map((_, j) => cumAt(j, id)),
            cpIndex,
          )
        : null;
    return { here, prevCum: cpIndex > 0 ? prevCum : null, segment, paceDelta, due };
  };

  // This device's latest taps here, newest first, for the strip above the buttons.
  const [recent, setRecent] = useState<{ athleteId: string; timeMs: number }[]>([]);
  const ordered = useMemo(
    () =>
      orderAthletes(orderMode, {
        lineup: race.athleteIds,
        names: athletes,
        history: race.history,
        // Official times are elapsed from the gun; app marks are re-based the same way when there is a gun.
        prevTime: (id) => {
          const prevCp = cpIndex > 0 ? race.checkpoints[cpIndex - 1] : undefined;
          // Official times are elapsed from the gun; without a gun they can't be compared to app taps, so app only.
          const o = gunTimeMs && prevCp ? (official[id]?.byCheckpoint[prevCp.id] ?? (prevCp.kind === "finish" ? official[id]?.finishMs : undefined)) : undefined;
          if (o != null) return o;
          const m = prev?.byAthlete.get(id);
          if (!m || m.missed || m.timeMs === null) return null;
          return gunTimeMs ? m.timeMs - gunTimeMs : m.timeMs;
        },
      }),
    [orderMode, race, prev, athletes, cpIndex, official, gunTimeMs],
  );

  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** When the Replace/Keep card opened, so the second half of a double tap can't hit Replace. */
  const confirmOpenedAt = useRef(0);
  // Press and hold a tile for DNS / DNF. The click that follows a hold is swallowed.
  const [holdId, setHoldId] = useState<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef(false);
  // The sheet opens on release, not under the finger, so the release can't land on DNS/DNF.
  const [holdArmed, setHoldArmed] = useState<string | null>(null);
  const holdStart = (id: string) => {
    heldRef.current = false;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      heldRef.current = true;
      setHoldArmed(id);
      try {
        navigator.vibrate?.(15);
      } catch {
        // not supported
      }
    }, HOLD_MS);
  };
  // heldRef stays set until the click that follows the release arrives (touch fires
  // pointerup → pointerleave → click, so pointerleave must not clear it); the next
  // pointerdown resets it anyway.
  const holdEnd = (id: string, release: boolean) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHoldArmed(null);
    if (release && heldRef.current) setHoldId(id);
  };
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  // Coarse clock for chip expiry; ticks every few seconds rather than reading the clock during render.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  // First-use card. Until hydration the flag reads null, so the card waits a beat rather than flashing.
  const [introFlag, setIntroFlag] = useLocalValue(INTRO_KEY);
  const introSeen = introFlag !== "0";
  const dismissIntro = () => setIntroFlag("1");
  useEffect(() => {
    // Read storage directly: the hook's value during hydration is the server's null.
    try {
      if (localStorage.getItem(INTRO_KEY) === null) setIntroFlag("0");
    } catch {
      // ignore
    }
  }, [setIntroFlag]);
  const lastTapAt = useRef(new Map<string, number>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Switching checkpoints: the undo target and any pending confirm no longer apply.
  const [seenCp, setSeenCp] = useState(checkpoint.id);
  if (seenCp !== checkpoint.id) {
    setSeenCp(checkpoint.id);
    setLastAction(null);
    setConfirmId(null);
    setSelectedSlotId(null);
    setRecent([]);
  }
  const offset = clock.sync?.offsetMs ?? 0;
  // The chips on screen, and the one the manager picked (a selection dies with its chip).
  const shownSlots = useMemo(() => (cp?.slots ?? []).filter((x) => x.athleteIds.length === 0 || nowMs === 0 || nowMs + offset - x.timeMs < CHIP_TTL_MS), [cp, nowMs, offset]);
  const selectedSlot = selectedSlotId ? shownSlots.find((x) => x.tapId === selectedSlotId) : undefined;

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const flash = (id: string) => {
    setFlashId(id);
    setTimeout(() => setFlashId((f) => (f === id ? null : f)), FLASH_MS);
  };

  // A tap from before the gun (the race was restarted) isn't a split; say so rather than show a negative time.
  const fmt = useCallback(
    (ms: number | null) => (ms === null ? "—" : gunTimeMs ? (ms < gunTimeMs ? "before gun" : formatElapsed(ms - gunTimeMs)) : formatClock(ms, timeZone)),
    [gunTimeMs, timeZone],
  );

  const base = { checkpointId: checkpoint.id, athleteId: null, targetTapId: null, timeMs: null, estimate: false, missed: false, note: null };

  // Captures taken on this phone: only these auto-collect a pack. Another manager's capture
  // at the same checkpoint must be picked on purpose (tap its chip).
  const myCaptures = useRef(new Set<string>());
  const lastCaptureAt = useRef(0);
  const capture = (e: SyntheticEvent) => {
    const deviceTimeMs = eventTimeMs(e);
    if (deviceTimeMs - lastCaptureAt.current < DOUBLE_TAP_MS) return; // a double-tapped Capture is one capture
    lastCaptureAt.current = deviceTimeMs;
    setSelectedSlotId(null);
    const tapId = send({ ...base, type: "capture", deviceTimeMs });
    myCaptures.current.add(tapId);
    setLastAction({ tapId, label: "capture" });
    flash("capture");
    showToast(`Captured ${fmt(deviceTimeMs + offset)}`);
  };

  const record = (e: SyntheticEvent, athleteId: string, replacing: Mark | null) => {
    const deviceTimeMs = eventTimeMs(e);
    setConfirmId(null);
    if (replacing) send({ ...base, type: "void", targetTapId: replacing.tapId, deviceTimeMs });
    // Which capture (if any) this name belongs to: a chip the manager picked (while it's still
    // showing), else the oldest empty capture this phone took recently, else this phone's newest
    // capture if a pack is still filling, else none (record now). Another phone's capture, or an
    // old one, is only used when its chip is picked on purpose. Replacing a real time is a
    // correction ("they passed just now"), so that only uses a picked chip too; filling in a
    // "missed" is just recording them.
    const correction = !!replacing && !replacing.missed && !(gunTimeMs && replacing.timeMs !== null && replacing.timeMs < gunTimeMs);
    const selected = selectedSlot;
    const newest = cp?.slots.at(-1);
    const nowServer = deviceTimeMs + offset;
    const myPending = cp?.pending.find((p) => myCaptures.current.has(p.tapId) && nowServer - p.timeMs < PENDING_OPEN_MS);
    const packOpen = newest && myCaptures.current.has(newest.tapId) && nowServer - newest.timeMs < CAPTURE_OPEN_MS;
    const slot: Slot | undefined = selected ?? (correction ? undefined : (myPending ?? (packOpen ? newest : undefined)));
    const tapId = slot ? send({ ...base, type: "assign", athleteId, targetTapId: slot.tapId, deviceTimeMs }) : send({ ...base, type: "name_tap", athleteId, deviceTimeMs });
    // A replaced time that came from a capture leaves that capture empty; drop it so the
    // next name tapped doesn't silently inherit the old time. Undo restores by time, not slot.
    if (replacing?.fromSlotId && replacing.fromSlotId !== slot?.tapId) {
      const old = cp?.slots.find((x) => x.tapId === replacing.fromSlotId);
      if (old && old.athleteIds.every((id) => id === athleteId)) send({ ...base, type: "void", targetTapId: old.tapId, deviceTimeMs: deviceTimeMs + 1 });
    }
    const restore = replacing && replacing.timeMs !== null ? { athleteId, timeMs: replacing.timeMs, estimate: replacing.estimate } : undefined;
    setLastAction({ tapId, label: athletes[athleteId] ?? "tap", restore });
    setRecent((r) => [{ athleteId, timeMs: slot ? slot.timeMs : deviceTimeMs + offset }, ...r.filter((x) => x.athleteId !== athleteId)].slice(0, RECENT_N));
    flash(athleteId);
    if (placesOn) showShout({ athleteId });
    const how = slot ? (selected ? " · from the chip" : cp?.pending.some((p) => p.tapId === slot.tapId) ? " · from capture" : " · with the pack") : "";
    showToast(`${correction ? "Replaced" : "Recorded"} ${athletes[athleteId]} ${fmt(slot ? slot.timeMs : deviceTimeMs + offset)}${how}`);
  };

  const onName = (e: SyntheticEvent, athleteId: string) => {
    if (heldRef.current) {
      heldRef.current = false;
      return;
    }
    const now = eventTimeMs(e);
    const last = lastTapAt.current.get(athleteId) ?? 0;
    lastTapAt.current.set(athleteId, now);
    if (now - last < DOUBLE_TAP_MS) return; // double-tap guard
    const existing = cp?.byAthlete.get(athleteId);
    // A real time asks before being replaced; "missed" or a tap from before the gun is just filled in.
    const real = !!existing && !existing.missed && !(gunTimeMs && existing.timeMs !== null && existing.timeMs < gunTimeMs);
    if (real) {
      confirmOpenedAt.current = now;
      setConfirmId(athleteId);
    } else record(e, athleteId, existing ?? null);
  };

  const undo = (e: SyntheticEvent) => {
    if (!lastAction) return;
    const t = eventTimeMs(e);
    send({ ...base, type: "void", targetTapId: lastAction.tapId, deviceTimeMs: t });
    for (const id of lastAction.more ?? []) send({ ...base, type: "void", targetTapId: id, deviceTimeMs: t });
    if (lastAction.restore) {
      // The replaced time was voided; give it back as a typed time.
      const { athleteId, timeMs, estimate } = lastAction.restore;
      send({ ...base, type: "name_tap", athleteId, timeMs, estimate, deviceTimeMs: t + 1 });
      showToast(`Undid replace · ${athletes[athleteId]} back to ${fmt(timeMs)}`);
    } else {
      showToast(`Undid ${lastAction.label}`);
    }
    setRecent((r) => (r[0] && lastAction.label === athletes[r[0].athleteId] ? r.slice(1) : r));
    setLastAction(null);
  };

  const deleteSlot = (e: SyntheticEvent, slot: Slot) => {
    send({ ...base, type: "void", targetTapId: slot.tapId, deviceTimeMs: eventTimeMs(e) });
    setLastAction(null); // a void can't be undone; don't leave Undo pointing at something else
    showToast(`Deleted ${fmt(slot.timeMs)}`);
  };

  // The shout card: our runner just tapped, with their place, time here and name (a places-only tap gets
  // the name once the names phone taps the runner).
  const shoutView = (() => {
    if (!shout || !cpPlaces) return null;
    const index = shout.tapId ? cpPlaces.entries.findIndex((e) => e.tapId === shout.tapId) : -1;
    const entry = index >= 0 ? cpPlaces.entries[index] : null;
    const athleteId = shout.athleteId ?? (entry?.kind === "us" ? entry.athleteId : null);
    const place = athleteId && cpPlaces.place.has(athleteId) ? cpPlaces.place.get(athleteId)! : index >= 0 ? (cpPlaces.countingAll ? index + 1 : cpPlaces.entries.slice(0, index + 1).filter((e) => e.kind !== "other").length) : null;
    if (place === null) return null;
    // A places-only tap shows its own moment at once (and keeps it, so the number doesn't jump when the
    // names phone's time arrives); a name tap shows that runner's recorded time.
    const mark = athleteId ? cp?.byAthlete.get(athleteId) : undefined;
    const at = entry ? entry.timeMs : mark && !mark.missed ? mark.timeMs : null;
    const time = at !== null && gunTimeMs && at >= gunTimeMs ? formatElapsed(at - gunTimeMs) : null;
    return { key: shout.key, place, time, name: athleteId ? (athletes[athleteId] ?? null) : null, overall: cpPlaces.countingAll };
  })();

  return (
    // Places fits the screen exactly: the buttons take what's left, so a slipping thumb can't scroll them away.
    <main className={`flex flex-col bg-bg ${placesMode === "places" ? "h-dvh overflow-hidden" : "min-h-dvh"}`}>
      <AppHeader
        title={meetName}
        titleHref={`/meets/${meetId}`}
        subtitle="Record splits"
        right={
          <>
            <LinkButton href={`/meets/${meetId}/results?race=${race.id}`} variant="secondary" size="sm">
              Live results
            </LinkButton>
            <SessionMenu name={session.name} role={session.role} />
          </>
        }
      />
      <div className="sticky top-14 z-10 space-y-2 border-b border-line bg-bg/95 px-3 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <RaceStatusBar name={race.name} finished={isFinished} gunTimeMs={gunTimeMs} now={clock.now} official={officialLive ? "live" : Object.keys(official).length ? "imported" : "none"} />
          <ClockWarning sync={clock.sync} error={clock.error} />
          {signedOut ? (
            <Link href="/join">
              <Badge tone="danger" dot>
                Signed out · rejoin
              </Badge>
            </Link>
          ) : (
            !online && (
              <Badge tone="danger" dot>
                Offline
              </Badge>
            )
          )}
          {unsent > 0 && <Badge tone="gold">{unsent} unsent</Badge>}
          {staleMinutes > 0 && <Badge tone="gold">updated {staleMinutes} min ago</Badge>}
          {rejected > 0 && (
            <Badge tone="danger" dot>
              {rejected} rejected
            </Badge>
          )}
        </div>
        {pickerFor({
          gunTimeMs,
          counts: Object.fromEntries(counts.map((c) => [c.id, c.n])),
          recording,
        })}
        {!gunTimeMs && !isFinished && canGun && (
          <StartRaceControl
            raceId={race.id}
            onStarted={(gun) => {
              adoptGun(gun);
              void refresh();
            }}
            onConflict={() => refresh()}
          />
        )}
        {/* A places counter doesn't need our runners' time counts. */}
        {placesMode !== "places" && <CheckpointCounts counts={counts} total={race.athleteIds.length} loaded={loaded} finished={isFinished} activeId={checkpoint.id} />}
      </div>

      {!introSeen && placesMode !== "places" && (
        <div className="mx-3 mt-3 rounded-lg border border-brand/30 bg-brand-soft p-3 text-sm text-ink">
          <p className="font-semibold">How to record splits</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
            <li>Tap a runner&rsquo;s name the moment they pass. That records their time.</li>
            <li>Can&rsquo;t name them fast enough? Tap <b>Capture time</b> as they pass, then tap the names after. One capture can take a whole pack.</li>
            <li>Wrong name? <b>Undo</b> takes back the last tap.</li>
            <li>Someone never came by? Press and hold their name for <b>DNS</b> / <b>DNF</b>.</li>
          </ul>
          <Button size="sm" onClick={dismissIntro} className="mt-2">
            Got it
          </Button>
        </div>
      )}
      {placesMode === "places" ? (
        <div className="flex min-h-0 flex-1 flex-col pb-28">
          <PlacesPad
              mode={placesMode}
              teams={race.places?.teams ?? []}
              ourTeam={race.ourTeam}
              checkpointId={checkpoint.id}
              places={cpPlaces}
              athletes={athletes}
              send={send}
              eventTime={eventTimeMs}
              onPointer={notePointerDown}
              onScores={() => setScoresOpen(true)}
              locked={placesDone}
              ourExpected={total - counts[cpIndex].out}
              onLock={(v) => setPlacesDone(v ? "1" : null)}
              onAction={({ tapIds, label }) => setLastAction({ tapId: tapIds[0], more: tapIds.slice(1), label })}
              onOurTap={(tapId) => showShout({ tapId })}
              onToast={showToast}
            />
        </div>
      ) : (
      <>
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <span className="text-[13px] text-ink-2">{placesMode === "both" ? "Tap names as ours pass, teams for theirs." : "Tap a runner as they pass."}</span>
        <OrderControl
          mode={orderMode}
          picked={pickedOrder !== null}
          cpIndex={cpIndex}
          checkpoints={race.checkpoints}
          history={race.history}
          onPick={pickOrder}
          compare={compare}
          hasCourse={hasCourse}
          onCompare={setComparePref}
          large={large}
          onLarge={(v) => setLargePref(v ? "1" : null)}
        />
      </div>
      <div className={`grid flex-1 content-start gap-2 p-3 ${placesMode === "both" ? "pb-[26rem]" : hereDone ? "pb-72" : "pb-48"} ${large ? "grid-cols-1" : "grid-cols-2"}`}>
        {!loaded && <p className="col-span-full text-sm text-ink-3">Loading…</p>}
        {ordered.map((id) => {
          const mark = cp?.byAthlete.get(id);
          const name = athletes[id] ?? "?";
          const [first, ...rest] = name.split(" ");
          const off = officialAt(id);
          const ref = reference(id);
          const refHere = referenceAt(ref, checkpoint);
          const tile = large ? "min-h-24 px-4 py-3" : "min-h-20 px-3 py-2";
          const nameCls = large ? "text-2xl" : "text-xl";
          const nameNode = <span className={`block truncate ${nameCls} leading-tight font-semibold`}>{first}</span>;
          if (off !== null) {
            return (
              <div key={id} className={`${tile} rounded-lg border border-line bg-surface-2 text-left text-ink-3`}>
                {nameNode}
                <span className="block truncate text-sm">{rest.join(" ")}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-sm">
                  <Time className="font-semibold text-ink-2">{formatElapsed(off)}</Time>
                  <Badge tone="brand">official</Badge>
                </span>
              </div>
            );
          }
          const beforeGun = !!mark && !mark.missed && !!gunTimeMs && mark.timeMs !== null && mark.timeMs < gunTimeMs;
          const done = !!mark && !mark.missed && !beforeGun;
          const status = statuses.get(id);
          const out = !!status && !done && !expectedAt(status, cpIndex, race.checkpoints);
          if (confirmId === id) {
            return (
              <div key={id} className={`${tile} flex flex-col justify-center rounded-lg border-2 border-brand bg-surface text-center shadow-card`}>
                <span className="text-sm text-ink">
                  Replace <Time className="font-semibold">{fmt(mark?.timeMs ?? null)}</Time>?
                </span>
                <div className="mt-1.5 flex gap-1.5">
                  <Button
                    size="sm"
                    onClick={(e) => {
                      if (Date.now() - confirmOpenedAt.current < DOUBLE_TAP_MS) return; // the second half of a double tap
                      record(e, id, mark ?? null);
                    }}
                    className="flex-1"
                  >
                    Replace
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setConfirmId(null)} className="flex-1">
                    Keep
                  </Button>
                </div>
              </div>
            );
          }
          const flashing = flashId === id;
          const muted = flashing ? "text-brand-ink/80" : done ? "text-ink-3" : "text-ink-2";
          const { prevCum, segment, paceDelta, here, due } = tileTimes(id);
          const vsRef = here !== null && refHere !== null ? here - refHere : null;
          return (
            <button
              key={id}
              type="button"
              onClick={(e) => onName(e, id)}
              onPointerDown={() => {
                notePointerDown();
                holdStart(id);
              }}
              onPointerUp={() => holdEnd(id, true)}
              onPointerLeave={() => holdEnd(id, false)}
              onPointerCancel={() => holdEnd(id, false)}
              onContextMenu={(e) => e.preventDefault()}
              style={{ WebkitTouchCallout: "none" }}
              className={`${tile} rounded-lg border text-left transition-colors select-none ${
                flashing ? "border-brand bg-brand text-brand-ink" : holdArmed === id ? "border-ink bg-surface-2 text-ink" : done || out ? "border-line bg-surface-2 text-ink-3" : "border-line bg-surface text-ink shadow-card active:bg-brand-soft"
              }`}
            >
              {nameNode}
              <span className={`block truncate text-sm ${muted}`}>{rest.join(" ")}</span>
              {out ? (
                <span className="mt-0.5 block">
                  <Badge tone="neutral">{STATUS_LABEL[status.status]}</Badge>
                </span>
              ) : !mark ? (
                (prevCum !== null || refHere !== null || due !== null) && (
                  <span className={`mt-0.5 block truncate ${large ? "text-sm" : "text-xs"} ${muted}`}>
                    {[
                      prevCum !== null && prevCp ? (
                        <span key="prev">
                          {prevCp.label} <Time className="font-medium">{formatElapsed(prevCum)}</Time>
                        </span>
                      ) : null,
                      due !== null ? (
                        <span key="due">
                          due <Time className="font-medium">~{formatElapsed(due).replace(/\.\d$/, "")}</Time>
                        </span>
                      ) : null,
                      refHere !== null ? (
                        <span key="ref">
                          {compareLabel} <Time className="font-medium">{formatElapsed(refHere)}</Time>
                        </span>
                      ) : null,
                    ]
                      .filter(Boolean)
                      .map((node, i) => (
                        <span key={i}>
                          {i > 0 && " · "}
                          {node}
                        </span>
                      ))}
                  </span>
                )
              ) : (
                <>
                  <span className={`mt-0.5 flex items-center gap-1.5 ${large ? "text-base" : "text-sm"}`}>
                    <Time className={mark.missed ? "italic" : `font-semibold ${flashing ? "" : "text-ink-2"}`}>
                      {mark.missed ? "missed" : fmt(mark.timeMs)}
                      {mark.estimate && !mark.missed && " ~"}
                    </Time>
                    {segment !== null && cpIndex > 0 && <Time className={`text-xs ${muted}`}>{formatElapsed(segment)}</Time>}
                    {paceDelta !== null && !flashing && (
                      <Time className="text-xs">
                        <DeltaText ms={paceDelta} suffix="/mi" />
                      </Time>
                    )}
                    <Pencil className="size-3 text-ink-3" aria-hidden />
                  </span>
                  {vsRef !== null && !flashing && (
                    <span className={`block text-xs ${muted}`}>
                      vs {compareLabel} <DeltaText ms={vsRef} />
                    </span>
                  )}
                  {cpPlaces?.place.has(id) && (
                    // The place leads once they've passed: what the coach calls out.
                    <span className={`mt-0.5 block ${flashing ? "" : "text-ink"}`}>
                      <span className={`tnum font-bold ${large ? "text-xl" : "text-lg"}`}>{ordinal(cpPlaces.place.get(id)!)}</span>
                      {!cpPlaces.countingAll && <span className={`text-xs ${flashing ? "" : "text-ink-2"}`}> of tracked</span>}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
      </>
      )}

      {scoresOpen && race.places && (
        <Sheet title={`Scores at ${checkpoint.label}`} subtitle={race.name} onClose={() => setScoresOpen(false)}>
          {cpPlaces ? (
            <PlacesCard config={race.places} checkpoints={[checkpoint]} places={new Map([[checkpoint.id, cpPlaces]])} official={null} ourTeam={race.ourTeam} athletes={athletes} inSheet />
          ) : (
            <p className="text-sm text-ink-2">Nobody has been counted here yet.</p>
          )}
        </Sheet>
      )}

      {holdId && (
        <TileStatusSheet
          name={athletes[holdId] ?? "?"}
          status={statuses.get(holdId)}
          hasTime={!!cp?.byAthlete.get(holdId) && !cp.byAthlete.get(holdId)!.missed}
          lastPassed={(() => {
            let label: string | null = null;
            race.checkpoints.forEach((c) => {
              const m = state.get(c.id)?.byAthlete.get(holdId);
              if (m && !m.missed) label = c.label;
            })
            return label;
          })()}
          onClose={() => setHoldId(null)}
          onStatus={(e, status) => {
            const id = holdId;
            // DNF: after the last checkpoint they passed, if any.
            let after: string | null = null;
            if (status === "dnf") race.checkpoints.forEach((c) => {
              const m = state.get(c.id)?.byAthlete.get(id);
              if (m && !m.missed) after = c.id;
            });
            const tapId = send({ ...base, type: "status", status, athleteId: id, checkpointId: after, deviceTimeMs: eventTimeMs(e) });
            setLastAction({ tapId, label: `${STATUS_LABEL[status]} for ${athletes[id]}` });
            setHoldId(null);
            showToast(`${athletes[id]}: ${STATUS_LABEL[status]}`);
          }}
          onClear={(e) => {
            const cur = statuses.get(holdId);
            if (cur) send({ ...base, type: "void", targetTapId: cur.tapId, deviceTimeMs: eventTimeMs(e) });
            setLastAction(null);
            setHoldId(null);
            showToast(`${athletes[holdId]}: back in the race`);
          }}
          onReplace={() => {
            setConfirmId(holdId);
            setHoldId(null);
          }}
        />
      )}

      {shoutView && (
        // Over the race card, never the buttons; taps pass straight through it.
        <div key={shoutView.key} className="pointer-events-none fixed inset-x-3 top-16 z-30 flex justify-center">
          <div className="w-full max-w-md rounded-xl bg-brand px-4 py-3 text-brand-ink shadow-sheet">
            <div className="flex items-baseline gap-3">
              <span className="tnum text-5xl leading-none font-bold">{ordinal(shoutView.place)}</span>
              {shoutView.time && <Time className="text-3xl leading-none font-semibold">{shoutView.time}</Time>}
              {!shoutView.overall && <span className="text-sm font-medium opacity-90">of tracked teams</span>}
            </div>
            {shoutView.name && <div className="mt-1 truncate text-base font-medium">{shoutView.name}</div>}
          </div>
        </div>
      )}

      {/* Read-only: taps go straight through it to the tiles beneath. Undo lives in the bar. */}
      {/* The shout card already says what was recorded; no toast on top of it. */}
      {toast && !shoutView && (
        <div className={`pointer-events-none fixed inset-x-0 z-20 flex justify-center px-3 [&>*]:pointer-events-none ${placesMode === "names" ? "bottom-36" : "top-36"}`}>
          <Toast title={toast} />
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        {/* Lives in the fixed bar (not above the grid) so appearing never moves a tile under a thumb. */}
      {/* Counting places too: their runners are still coming, so Done (not our last runner) is what ends this checkpoint. */}
      {/* Counting places at a mile mark: one step to finish here (locks the place buttons) and move on. */}
      {hereDone && placesMode === "both" && !placesDone && nextCp && (
        <div className="mx-3 mt-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-2">
          <span>
            All ours are through <b className="text-ink">{checkpoint.label}</b>.
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={() => {
              setPlacesDone("1");
              onSwitch({ raceId: race.id, checkpointId: nextCp.id });
            }}
          >
            Done here · Go to {nextCp.label}
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      )}
      {/* The finish (nothing comes next) reads the same as on Times. */}
      {hereDone && (placesMode === "names" || (placesMode === "both" && (placesDone || !nextCp))) && (
        <div className="mx-3 mt-2 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-sm text-ink">
          <div className="flex items-center justify-between gap-3">
            <span>
              {nextCp ? (
                <>
                  Everyone&rsquo;s {checkpoint.kind === "finish" ? "in" : "through"} <b>{checkpoint.label}</b>.
                </>
              ) : (
                allDoneText
              )}
              {gapsBehind.length > 0 && ` ${gapsBehind.join("; ")} — mark them missed on Live results.`}
            </span>
            {nextCp ? (
              <Button size="sm" onClick={() => onSwitch({ raceId: race.id, checkpointId: nextCp.id })}>
                Go to {nextCp.label}
                <ArrowRight className="size-3.5" />
              </Button>
            ) : (
              <LinkButton href={`/meets/${meetId}/results?race=${race.id}`} size="sm">
                Live results
                <ArrowRight className="size-3.5" />
              </LinkButton>
            )}
          </div>
          {!nextCp && gapsBehind.length === 0 && <p className="mt-1 text-xs text-ink-2">Need to change something? Switch checkpoints above, or use Fix times on Live results.</p>}
        </div>
      )}
        {placesMode === "both" && <PlacesPad
              mode={placesMode}
              teams={race.places?.teams ?? []}
              ourTeam={race.ourTeam}
              checkpointId={checkpoint.id}
              places={cpPlaces}
              athletes={athletes}
              send={send}
              eventTime={eventTimeMs}
              onPointer={notePointerDown}
              onScores={() => setScoresOpen(true)}
              locked={placesDone}
              ourExpected={total - counts[cpIndex].out}
              onLock={(v) => setPlacesDone(v ? "1" : null)}
              onAction={({ tapIds, label }) => setLastAction({ tapId: tapIds[0], more: tapIds.slice(1), label })}
              onOurTap={(tapId) => showShout({ tapId })}
              onToast={showToast}
            />}
        {placesMode === "names" && recent.length > 0 && (
          <p className="truncate px-3 pt-1.5 text-xs text-ink-2">
            <span className="text-ink-3">Last </span>
            {recent.map((r, i) => (
              <span key={r.athleteId}>
                {i > 0 && <span className="text-ink-3"> · </span>}
                {(athletes[r.athleteId] ?? "?").split(" ")[0]} <Time className="font-medium text-ink">{fmt(r.timeMs)}</Time>
              </span>
            ))}
          </p>
        )}
        {placesMode !== "places" && <CaptureChips
          slots={shownSlots}
          selectedId={selectedSlot?.tapId ?? null}
          athletes={athletes}
          fmt={fmt}
          onSelect={(id) => setSelectedSlotId((cur) => (cur === id ? null : id))}
          onDelete={deleteSlot}
        />}
        <div className={`flex gap-2 px-3 ${placesMode === "places" ? "py-3" : "pt-2"}`}>
          <Button variant="secondary" size="lg" onClick={undo} disabled={!lastAction} className={`flex-col gap-0.5 px-1! ${placesMode === "places" ? "h-16 flex-1" : "h-16 w-20"}`}>
            <Undo2 className="size-6 shrink-0" />
            {/* Says what it will undo, so a stray tap on Undo is caught before it costs a good one. */}
            <span className={`w-full truncate px-1 text-center ${placesMode === "places" ? "text-xs" : "text-[11px] leading-tight"}`}>{lastAction ? (placesMode === "places" ? `Undo ${lastAction.label}` : lastAction.label) : "Undo"}</span>
          </Button>
          {placesMode !== "places" && <button
            type="button"
            onPointerDown={notePointerDown}
            onClick={capture}
            className={`flex h-16 flex-1 flex-col items-center justify-center rounded-lg shadow-card select-none ${
              flashId === "capture" ? "bg-brand text-brand-ink" : "bg-ink text-bg active:bg-ink/80"
            }`}
          >
            <span className="text-xl leading-tight font-semibold tracking-wide">
              Capture time{cp && cp.pending.length > 0 ? ` · ${cp.pending.length} waiting` : ""}
            </span>
            <span className="text-xs opacity-70">{selectedSlot ? `names go to ${fmt(selectedSlot.timeMs)} · tap the chip to stop` : "then tap the names"}</span>
          </button>}
        </div>
      </div>
    </main>
  );
}

function OrderRow({ active, label, hint, disabled, onClick }: { active: boolean; label: string; hint: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-14 w-full items-center justify-between rounded-lg border px-4 text-left disabled:opacity-50 ${
        active ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-2"
      }`}
    >
      <span>
        <span className="block text-base font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink-2">{hint}</span>
      </span>
      {active && <Check className="size-4 shrink-0 text-brand-text" />}
    </button>
  );
}

/** Press-and-hold on a name: DNS / DNF without leaving the record screen. */
function TileStatusSheet({
  name,
  status,
  hasTime,
  lastPassed,
  onClose,
  onStatus,
  onClear,
  onReplace,
}: {
  name: string;
  status: AthleteStatus | undefined;
  hasTime: boolean;
  lastPassed: string | null;
  onClose: () => void;
  onStatus: (e: SyntheticEvent, status: "dns" | "dnf") => void;
  onClear: (e: SyntheticEvent) => void;
  onReplace: () => void;
}) {
  // Opened on finger lift; the browser's click for that lift can arrive a moment later.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 350);
    return () => clearTimeout(t);
  }, []);
  return (
    <Sheet title={name} subtitle={status ? STATUS_LONG[status.status] : lastPassed ? `Last seen at ${lastPassed}` : "Not seen yet"} onClose={() => settled && onClose()}>
      <div className={`grid gap-2 ${settled ? "" : "pointer-events-none"}`}>
        {status ? (
          <Button variant="secondary" size="lg" onClick={onClear}>
            Clear {STATUS_LABEL[status.status]} · back in the race
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="lg" onClick={(e) => onStatus(e, "dns")} className="h-14 flex-col gap-0">
              <span>DNS</span>
              <span className="text-xs font-normal text-ink-2">Never started</span>
            </Button>
            <Button variant="secondary" size="lg" onClick={(e) => onStatus(e, "dnf")} className="h-14 flex-col gap-0">
              <span>DNF</span>
              <span className="text-xs font-normal text-ink-2">{lastPassed ? `Dropped out after ${lastPassed}` : "Dropped out"}</span>
            </Button>
          </>
        )}
        {hasTime && (
          <Button variant="subtle" size="lg" onClick={onReplace}>
            Replace their time here…
          </Button>
        )}
        <p className="text-xs text-ink-3">Coaches can change this on the live board (Fix times → tap the name).</p>
      </div>
    </Sheet>
  );
}

/** Which way the tiles are laid out; remembered on this device for this race. */
function OrderControl({
  mode,
  picked,
  cpIndex,
  checkpoints,
  history,
  onPick,
  compare,
  hasCourse,
  onCompare,
  large,
  onLarge,
}: {
  mode: OrderMode;
  picked: boolean;
  cpIndex: number;
  checkpoints: RaceInfo["checkpoints"];
  history: LineupHistory;
  onPick: (m: OrderMode | null) => void;
  compare: CompareMode;
  hasCourse: boolean;
  onCompare: (m: CompareMode) => void;
  large: boolean;
  onLarge: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showRaces, setShowRaces] = useState(mode.kind === "race");
  const prevLabel = cpIndex > 0 ? checkpoints[cpIndex - 1].label : null;
  const raceLabel = (id: string) => history.races.find((r) => r.id === id)?.label ?? "a race";
  // Button label, after "Order:", so "Mile 2" next to a "Finish" title isn't mistaken for the checkpoint.
  const describe = (m: OrderMode) => {
    switch (m.kind) {
      case "prev":
        return prevLabel ?? "Previous checkpoint";
      case "last":
        return "Last race";
      case "race":
        return raceLabel(m.raceId);
      case "best":
        return "Season best";
      case "coach":
        return "Coach's";
      case "az":
        return "A–Z";
    }
  };
  const options: { mode: OrderMode; label: string; hint: string; disabled?: boolean }[] = [
    { mode: { kind: "prev" }, label: "Previous checkpoint", hint: prevLabel ? `Order they passed ${prevLabel}.` : "First checkpoint · nothing before it.", disabled: !prevLabel },
    { mode: { kind: "last" }, label: "Last race", hint: history.races.length ? "Each runner's most recent finish." : "No results imported yet.", disabled: history.races.length === 0 },
    { mode: { kind: "best" }, label: "Season best", hint: history.races.length ? "Fastest finish this season." : "No results imported yet.", disabled: history.races.length === 0 },
    { mode: { kind: "coach" }, label: "Coach's order", hint: "The lineup as set on the race." },
    { mode: { kind: "az" }, label: "A–Z", hint: "By first name." },
  ];
  const choose = (m: OrderMode) => {
    onPick(m);
    setOpen(false);
  };
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="min-w-0 shrink">
        <SlidersHorizontal className="size-3.5 shrink-0" />
        <span className="text-ink-2">Order:</span>
        <span className="truncate">{describe(mode)}</span>
      </Button>
      {open && (
        <Sheet title="Names and tiles" subtitle="Remembered on this phone." onClose={() => setOpen(false)}>
          <SectionLabel className="mb-1.5">Order</SectionLabel>
          <p className="mb-2 text-xs text-ink-2">Runners with nothing to sort by go last, A–Z.</p>
          <div className="grid gap-2">
            {options.map((o) => (
              <OrderRow key={o.mode.kind} active={mode.kind === o.mode.kind} label={o.label} hint={o.hint} disabled={o.disabled} onClick={() => choose(o.mode)} />
            ))}
            {history.races.length > 0 && (
              <>
                <OrderRow
                  active={mode.kind === "race"}
                  label={mode.kind === "race" ? raceLabel(mode.raceId) : "A race…"}
                  hint="Finish order from one earlier race."
                  onClick={() => setShowRaces((v) => !v)}
                />
                {showRaces && (
                  <div className="ml-4 grid gap-1.5 border-l-2 border-line pl-3">
                    {history.races.map((r) => {
                      const active = mode.kind === "race" && mode.raceId === r.id;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => choose({ kind: "race", raceId: r.id })}
                          className={`flex h-11 items-center justify-between rounded-md border px-3 text-left text-sm ${
                            active ? "border-brand bg-brand-soft text-ink" : "border-line bg-surface text-ink hover:bg-surface-2"
                          }`}
                        >
                          <span>
                            {r.label}
                            {r.sameCourse && <span className="ml-2 text-xs text-brand-text">same course</span>}
                          </span>
                          <span className="text-xs text-ink-3">{r.date}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            {picked && (
              <Button
                variant="subtle"
                size="sm"
                onClick={() => {
                  onPick(null);
                  setOpen(false);
                }}
                className="mt-1 justify-self-start"
              >
                Back to automatic
              </Button>
            )}
          </div>
          <SectionLabel className="mt-5 mb-1.5">Compare with</SectionLabel>
          <p className="mb-2 text-xs text-ink-2">
            Each tile shows the runner&rsquo;s time here from that race, and the difference once they pass.
            {!hasCourse && " This meet has no course on file."}
          </p>
          <Segmented
            value={compare}
            onChange={(v) => onCompare(v as CompareMode)}
            options={[
              { value: "last", label: "Last meet" },
              { value: "course", label: "This course", disabled: !hasCourse },
              { value: "off", label: "Off" },
            ]}
          />
          <SectionLabel className="mt-5 mb-1.5">Tiles</SectionLabel>
          <button
            type="button"
            onClick={() => onLarge(!large)}
            className={`flex h-14 w-full items-center justify-between rounded-lg border px-4 text-left ${large ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-2"}`}
          >
            <span>
              <span className="block text-base font-medium text-ink">Large tiles</span>
              <span className="block text-xs text-ink-2">One name per row, bigger text.</span>
            </span>
            {large && <Check className="size-4 shrink-0 text-brand-text" />}
          </button>
        </Sheet>
      )}
    </>
  );
}

/**
 * Recent captures, in the bottom bar where the thumb is. Empty ones are the
 * ones waiting for a name; tapping a chip makes it the target for the next names.
 */
function CaptureChips({
  slots,
  selectedId,
  athletes,
  fmt,
  onSelect,
  onDelete,
}: {
  /** Already filtered to the ones worth showing (empty, or recent). */
  slots: SlotWithNames[];
  selectedId: string | null;
  athletes: Record<string, string>;
  fmt: (ms: number | null) => string;
  onSelect: (id: string) => void;
  onDelete: (e: SyntheticEvent, slot: Slot) => void;
}) {
  const shown = slots;
  // Deleting a capture can't be undone: the × asks once ("Delete?") and forgets after a moment.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  if (shown.length === 0) return null;
  const firstName = (id: string) => (athletes[id] ?? "?").split(" ")[0];
  return (
    <div className="flex gap-1.5 overflow-x-auto px-3 pt-2 pb-0.5">
      {shown.map((s) => {
        const empty = s.athleteIds.length === 0;
        const selected = s.tapId === selectedId;
        return (
          <span
            key={s.tapId}
            className={`flex shrink-0 items-center gap-1 rounded-md py-1 pl-2 text-sm ${
              selected ? "bg-brand text-brand-ink" : empty ? "bg-brand-soft text-ink ring-2 ring-brand" : "border border-line bg-surface text-ink-2"
            }`}
          >
            <button type="button" onClick={() => onSelect(s.tapId)} className="flex items-center gap-1.5">
              <Time className="font-semibold">{fmt(s.timeMs)}</Time>
              <span className="text-xs">{empty ? "waiting" : s.athleteIds.map(firstName).join(", ")}</span>
            </button>
            {empty ? (
              armed === s.tapId ? (
                <button
                  type="button"
                  onClick={(e) => {
                    setArmed(null);
                    onDelete(e, s);
                  }}
                  className="rounded bg-danger px-1.5 py-0.5 text-xs font-medium text-white"
                >
                  Delete?
                </button>
              ) : (
                <button type="button" onClick={() => setArmed(s.tapId)} aria-label="Delete this capture" className="rounded p-1 text-ink-3 hover:text-danger">
                  <X className="size-3.5" />
                </button>
              )
            ) : (
              <span className="w-1.5" />
            )}
          </span>
        );
      })}
    </div>
  );
}

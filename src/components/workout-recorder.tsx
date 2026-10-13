"use client";

import { Check, ListChecks, MoreHorizontal, Play, Plus, SlidersHorizontal, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { changeRepsAction } from "@/app/actions/workouts";
import { AthleteBreakdown, setRepTime } from "@/components/workout-athlete-sheet";
import { MarkRunnersSheet } from "@/components/workout-mark-sheet";
import { RepCell, SHOW_DELTAS_KEY } from "@/components/workout-rep-cell";
import { groupTint, ON_GOAL_MS, repCellTone } from "@/components/workout-tint";
import { Alert, Button, Card, SectionLabel, Segmented, Sheet, Switch, Time } from "@/components/ui";
import { offsetForTap, useClock } from "@/lib/client/clock";
import { useLocalValue } from "@/lib/client/use-local-value";
import { useWakeLock } from "@/lib/client/use-wake-lock";
import { useTimeFormat } from "@/lib/client/time-format";
import { useWorkoutEvents } from "@/lib/client/use-workout-events";
import type { Workout } from "@/lib/db/schema";
import { describeRest } from "@/lib/workout-plan";
import { type AthleteRep, type FlatRep, replayWorkout, summarize } from "@/lib/workout-replay";
import { formatElapsed } from "@/lib/time";

type Plan = Pick<Workout, "sets" | "groups" | "athletes"> & { finishedAt: string | null };

/**
 * When a tap happened: the finger landing, not the lift (see the race tap
 * screen). iOS pauses the event timestamp clock while asleep, so wall time.
 */
let lastPointerDownMs = 0;
const notePointerDown = () => {
  lastPointerDownMs = Date.now();
  unlockAudio();
};

/**
 * The countdown alert: a beep (and a buzz where the phone supports it; iPhones
 * don't) at 10 s to go and a double one at Go. Browsers only allow sound after
 * a tap, so the audio is switched on by the first tap on the screen.
 */
let audio: AudioContext | null = null;
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    // no Web Audio: the buzz (where there is one) still works
  }
}
function beep(go: boolean) {
  navigator.vibrate?.(go ? [200, 100, 200] : 150);
  if (!audio || audio.state !== "running") return;
  const tones = go ? [0, 0.22] : [0];
  for (const at of tones) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = go ? 1046 : 784;
    gain.gain.setValueAtTime(0.0001, audio.currentTime + at);
    gain.gain.exponentialRampToValueAtTime(0.4, audio.currentTime + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + 0.18);
    osc.connect(gain).connect(audio.destination);
    osc.start(audio.currentTime + at);
    osc.stop(audio.currentTime + at + 0.2);
  }
}
const ALERT_KEY = "ls_workout_alerts";
const SINK_KEY = "ls_workout_sink";
const tapTime = () => {
  const now = Date.now();
  return lastPointerDownMs && now - lastPointerDownMs < 1500 ? lastPointerDownMs : now;
};

/** "+2" / "−1.4": a rep against its goal, in whole seconds or tenths as the team shows times; a minute or more as m:ss. */
function deltaText(ms: number, tenths: boolean): string {
  const t = tenths ? Math.round(ms / 100) / 10 : Math.round(ms / 1000);
  if (t === 0) return "±0";
  const abs = Math.abs(t);
  return `${t > 0 ? "+" : "−"}${abs >= 60 ? formatElapsed(abs * 1000, tenths ? "tenths" : "seconds") : tenths ? abs.toFixed(1) : String(abs)}`;
}
const deltaTone = (ms: number) => (Math.abs(ms) <= ON_GOAL_MS ? "text-ink-2" : ms < 0 ? "text-brand-text" : "text-danger");

/** How the runners are laid out, remembered on this phone. */
type TileOrder = "goal" | "last" | "name";
const ORDER_KEY = "ls_workout_order";
const LARGE_KEY = "ls_workout_large";
const ORDER_LABEL: Record<TileOrder, string> = { goal: "Goal", last: "Last rep", name: "A–Z" };

export function WorkoutRecorder({
  workoutId,
  initialPlan,
  people,
  initialGroupId,
}: {
  workoutId: string;
  initialPlan: Plan;
  /** Everyone on the roster, for names and for adding a late arrival. */
  people: { id: string; name: string }[];
  initialGroupId: string | null;
}) {
  useWakeLock();
  const clock = useClock();
  // Rep times the team's way; the running clocks stay at tenths.
  const { ft, team } = useTimeFormat();
  const tenths = team === "tenths";
  const [groupId, setGroupId] = useState(() => (initialGroupId && initialPlan.groups.some((g) => g.id === initialGroupId) ? initialGroupId : initialPlan.groups[0].id));
  const { events, plan, send, online, loaded, unsent, refresh, signedOut } = useWorkoutEvents(workoutId, initialPlan, groupId);
  const group = plan.groups.find((g) => g.id === groupId) ?? plan.groups[0];
  const state = useMemo(() => replayWorkout(plan, events), [plan, events]);
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [resultsPref, setResultsPref] = useLocalValue("ls_workout_results");
  const allReps = resultsPref === "all";
  const [orderPref, setOrderPref] = useLocalValue(ORDER_KEY);
  const order: TileOrder = orderPref === "last" || orderPref === "name" ? orderPref : "goal";
  const [largePref, setLargePref] = useLocalValue(LARGE_KEY);
  const large = largePref === "1";
  const [sinkPref, setSinkPref] = useLocalValue(SINK_KEY);
  const sink = sinkPref !== "off";
  const [frozen, setFrozen] = useState<{ key: string; ids: string[] } | null>(null);
  const [tapSeq, setTapSeq] = useState(0);
  const [lastTap, setLastTap] = useState<{ eventId: string; name: string; ms: number; lapText: string | null } | null>(null);
  // A second after the last tap the tiles settle; the undo offer lasts a little longer.
  useEffect(() => {
    if (tapSeq === 0) return;
    const settle = setTimeout(() => setFrozen(null), 1200);
    const forget = setTimeout(() => setLastTap(null), 6000);
    return () => {
      clearTimeout(settle);
      clearTimeout(forget);
    };
  }, [tapSeq]);
  const [alertPref, setAlertPref] = useLocalValue(ALERT_KEY);
  const alerts = alertPref !== "off";

  // The clocks: server time, ticking at tenths.
  // Keyed on the offset, not the clock object (a new one each render would restart the ticker).
  const offsetMs = clock.sync?.offsetMs ?? 0;
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now() + offsetForTap()); // the same offset the taps are stamped with
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [offsetMs]);

  // Keep the group in the address so a reload lands on it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("group") !== group.id) {
      url.searchParams.set("group", group.id);
      window.history.replaceState(null, "", url);
    }
  }, [group.id]);

  const phase = state.groups.get(group.id) ?? { kind: "before" as const, nextRepIndex: 0 as const };
  const reps = state.reps;
  // The rep the screen is about: the one running, else the one coming up (or the last, when done).
  const repIndex = phase.kind === "running" ? phase.repIndex : phase.kind === "rest" ? phase.afterRepIndex + 1 : phase.kind === "before" ? 0 : (phase.endedEarlyAfter ?? reps.length - 1);
  const rep = reps[repIndex];
  const lastIndex = phase.kind === "rest" ? phase.afterRepIndex : phase.kind === "running" ? phase.repIndex : phase.kind === "done" ? (phase.endedEarlyAfter ?? reps.length - 1) : -1;
  const repLabel = (i: number) => {
    const r = reps[i];
    return reps.some((x) => x.setIndex > 0) ? `Set ${r.setIndex + 1} · Rep ${r.number} of ${r.setSize}` : `Rep ${r.number} of ${r.setSize}`;
  };

  const allIds = [...state.athletes.keys()];
  const inGroupAt = (i: number) => allIds.filter((id) => state.groupAt(id, i) === group.id);
  const rowsAt = (i: number) => inGroupAt(i).map((id) => ({ id, r: state.athletes.get(id)![i] }));
  // The order the coach picked. "Last rep" is how they came in last time, so a pack's tiles sit together;
  // anyone without a finish there goes after, by goal. Ties by name.
  const byName = (a: string, b: string) => (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? "");
  const sortRows = <T extends { id: string; r: AthleteRep }>(rows: T[], i: number) => {
    const prev = i > 0 ? new Map(rows.map(({ id }) => [id, state.athletes.get(id)![i - 1]])) : null;
    const lastFinish = (id: string) => (prev?.get(id)?.status === "done" ? prev.get(id)!.finishMs! : Infinity);
    const goal = (r: AthleteRep) => r.goalMs ?? Infinity;
    return [...rows].sort((a, b) =>
      order === "name"
        ? byName(a.id, b.id)
        : order === "last"
          ? lastFinish(a.id) - lastFinish(b.id) || goal(a.r) - goal(b.r) || byName(a.id, b.id)
          : goal(a.r) - goal(b.r) || byName(a.id, b.id),
    );
  };
  // Every tile stays where it is for the whole rep: one vanishing would slide the next under the coach's thumb.
  // Finished runners move to the bottom in finish order (so after the last one the grid reads fastest
  // to slowest) — but only once tapping pauses: during a pack nothing moves under the thumb.
  const tileKey = `${group.id}:${repIndex}`;
  const ordered = phase.kind === "running" ? sortRows(rowsAt(repIndex).filter(({ r }) => r.status !== "stopped"), repIndex) : [];
  const sunk = sink
    ? [...ordered.filter(({ r }) => r.status !== "done"), ...ordered.filter(({ r }) => r.status === "done").sort((a, b) => (a.r.finishMs ?? Infinity) - (b.r.finishMs ?? Infinity))]
    : ordered;
  const tiles =
    frozen && frozen.key === tileKey
      ? [...frozen.ids.map((id) => sunk.find((t) => t.id === id)).filter((t) => t !== undefined), ...sunk.filter((t) => !frozen.ids.includes(t.id))]
      : sunk;
  const inCount = tiles.filter(({ r }) => r.status === "done").length;
  const outOf = tiles.filter(({ r }) => r.status !== "skipped").length;
  const finishedRows = lastIndex >= 0 ? rowsAt(lastIndex).filter(({ r }) => r.status === "done").sort((a, b) => (a.r.finishMs ?? 0) - (b.r.finishMs ?? 0)) : [];
  const notRunning = lastIndex >= 0 ? rowsAt(lastIndex).filter(({ r }) => r.status === "skipped" || r.status === "stopped" || r.status === "unfinished") : [];
  // Runners still out when the coach started the rest: they can still be tapped in for that rep.
  const stillOut = phase.kind === "rest" ? sortRows(rowsAt(phase.afterRepIndex).filter(({ r }) => r.status === "running"), phase.afterRepIndex) : [];
  // Between reps: who's going next, and who's set to skip it (so a skip can be seen, and undone, before the start).
  const upNext = phase.kind !== "running" && phase.kind !== "done" ? sortRows(rowsAt(repIndex).filter(({ r }) => r.status === "pending" || r.status === "skipped"), repIndex) : [];
  // Make-ups on the go: a rep someone skipped, run later on their own clock (often after everyone's done).
  const makeUps = allIds.flatMap((id) =>
    state.athletes
      .get(id)!
      .map((r, i) => ({ id, r, i }))
      .filter(({ r }) => r.makeUp && r.status === "running" && r.groupId === group.id),
  );

  // Starting the next rep while someone is still out on the last one leaves them with no time for it,
  // so it takes a second tap that says who. (A time can still be added for them afterwards.)
  // Armed for this group and this moment only: switching groups or the rep moving on disarms it.
  const armKey = `${group.id}:${phase.kind}:${repIndex}`;
  const [startArmedKey, setStartArmedKey] = useState<string | null>(null);
  const startArmed = startArmedKey === armKey;
  useEffect(() => {
    if (!startArmedKey) return;
    const t = setTimeout(() => setStartArmedKey(null), 4000);
    return () => clearTimeout(t);
  }, [startArmedKey]);
  const startRep = () => {
    if (stillOut.length > 0 && !startArmed) return setStartArmedKey(armKey);
    setStartArmedKey(null);
    send({ type: "rep_start", groupId: group.id, repId: rep.id, at: tapTime() });
  };
  // Laps: times taken with no name (a pack coming in), named after by tapping runners in finish order.
  // A lap is named by a finish that points back to it, so undoing that finish puts the lap back in line.
  const voidedIds = new Set(events.filter((e) => e.type === "void").map((e) => e.targetEventId));
  const namedLaps = new Set(events.filter((e) => e.type === "finish" && e.targetEventId && !voidedIds.has(e.clientEventId)).map((e) => e.targetEventId));
  // The rep laps belong to: the one running, or the one just run (so a leftover lap is still there to clear).
  const lapRepIndex = phase.kind === "running" ? phase.repIndex : phase.kind === "rest" ? phase.afterRepIndex : phase.kind === "done" ? (phase.endedEarlyAfter ?? reps.length - 1) : -1;
  // The Lap button is for a rep someone is still running.
  const lapOpen = phase.kind === "running" || (phase.kind === "rest" && stillOut.length > 0);
  const lapStartMs = phase.kind === "running" ? phase.startMs : (state.groupLog.get(group.id)?.find((l) => l.repIndex === lapRepIndex)?.startMs ?? null);
  const lapAt = (e: (typeof events)[number]) => e.timeMs ?? e.serverTimeMs;
  const pendingLaps =
    lapRepIndex < 0
      ? []
      : events
          .filter((e) => e.type === "lap" && e.groupId === group.id && e.repId === reps[lapRepIndex].id && !voidedIds.has(e.clientEventId) && !namedLaps.has(e.clientEventId))
          .sort((a, b) => lapAt(a) - lapAt(b));
  const takeLap = () => send({ type: "lap", groupId: group.id, repId: reps[lapRepIndex].id, at: tapTime() });
  // The time a runner would get from the oldest waiting finish (from their own start, for a late starter).
  const nextLapFor = (r: AthleteRep) => {
    const start = r.startMs ?? lapStartMs;
    return pendingLaps[0] && start !== null ? ft(Math.max(0, lapAt(pendingLaps[0]) - start)) : "";
  };
  // More laps than runners left to name: a tap too many, most likely the last one(s).
  const leftToName = lapRepIndex < 0 ? 0 : rowsAt(lapRepIndex).filter(({ r }) => r.status === "running" && !r.makeUp).length;
  const extraLaps = Math.max(0, pendingLaps.length - leftToName);
  const finish = (athleteId: string, repId = rep.id) => {
    const at = tapTime();
    // With laps waiting, a tap names the oldest one instead of taking the time now.
    const lap = pendingLaps.find((e) => e.repId === repId);
    const eventId = lap
      ? send({ type: "finish", groupId: group.id, athleteId, repId, targetEventId: lap.clientEventId, timeMs: lapAt(lap), at })
      : send({ type: "finish", groupId: group.id, athleteId, repId, at });
    // Hold the tiles where they are until tapping pauses; offer to undo this tap for a few seconds.
    if (sink) setFrozen((f) => (f && f.key === tileKey ? f : { key: tileKey, ids: tiles.map((t) => t.id) }));
    setTapSeq((n) => n + 1);
    const r = state.athletes.get(athleteId)?.[reps.findIndex((x) => x.id === repId)];
    setLastTap({ eventId, name: (nameOf.get(athleteId) ?? "?").split(" ")[0], ms: at, lapText: lap && r ? nextLapFor(r) : null });
  };
  // Starting the rest early takes two taps: the first arms it for a few seconds, so a stray tap mid-rep does nothing.
  const [restArmedKey, setRestArmedKey] = useState<string | null>(null);
  const restArmed = restArmedKey === armKey;
  useEffect(() => {
    if (!restArmedKey) return;
    const t = setTimeout(() => setRestArmedKey(null), 3000);
    return () => clearTimeout(t);
  }, [restArmedKey]);
  const startRest = () => {
    if (!restArmed) return setRestArmedKey(armKey);
    setRestArmedKey(null);
    send({ type: "rest_start", groupId: group.id, repId: rep.id, at: tapTime() });
  };
  // Ending this group early, from the Reps sheet: after the rep running now, or the one just run.
  const lastRunIndex = phase.kind === "running" ? phase.repIndex : phase.kind === "rest" ? phase.afterRepIndex : -1;
  const endGroup = () => send({ type: "group_end", groupId: group.id, repId: reps[lastRunIndex].id });
  // A rest on hold has no countdown: a water break, a weather delay. The next rep starts when the coach says.
  const canHold = phase.kind === "rest" && (phase.holdEventId !== null || phase.rest?.kind === "time" || phase.rest?.kind === "interval");
  const toggleHold = () => {
    if (phase.kind !== "rest") return;
    if (phase.holdEventId) send({ type: "void", targetEventId: phase.holdEventId });
    else send({ type: "hold", groupId: group.id, repId: reps[phase.afterRepIndex].id });
  };

  // Nudge the rep's start when the clock went a moment late or early: an edit to the start, from where it is now.
  const startEventId = phase.kind === "running" || phase.kind === "rest" ? phase.startEventId : null;
  const startMsNow = phase.kind === "running" ? phase.startMs : null;
  const nudgeStart = (deltaMs: number) => startEventId && startMsNow !== null && send({ type: "edit", targetEventId: startEventId, timeMs: startMsNow + deltaMs });
  const [adjustingKey, setAdjustingKey] = useState<string | null>(null);
  const adjusting = adjustingKey === armKey;

  // After an early rest the rep clock keeps going for whoever is still out: coaches call those times.
  const outRepStartMs = phase.kind === "rest" && stillOut.length > 0 ? (state.groupLog.get(group.id)?.find((l) => l.repIndex === phase.afterRepIndex)?.startMs ?? null) : null;

  // Beep as the rest counts down: once at 10 s to go, twice at Go. Only on a change seen
  // here, so opening the screen mid-countdown doesn't beep for a moment already past.
  // (Nothing until the clock has ticked once: `now` starts at 0, which would read as a countdown just begun.)
  const ticking = now > 0;
  const countdownStage = ticking && phase.kind === "rest" && phase.nextStartMs !== null ? (now >= phase.nextStartMs ? 2 : phase.nextStartMs - now <= 10_000 ? 1 : 0) : -1;
  const restKey = ticking && phase.kind === "rest" ? `${group.id}:${phase.afterRepIndex}` : "";
  const lastStage = useRef({ key: "", stage: -1 });
  useEffect(() => {
    const prev = lastStage.current;
    lastStage.current = { key: restKey, stage: countdownStage };
    if (alerts && restKey && prev.key === restKey && countdownStage > prev.stage && countdownStage > 0) beep(countdownStage === 2);
  }, [countdownStage, restKey, alerts]);

  // The big clock.
  let clockLabel = "";
  let clockValue = "";
  let clockTone = "text-ink";
  if (phase.kind === "running") {
    clockLabel = "Rep clock";
    clockValue = formatElapsed(Math.max(0, now - phase.startMs));
  } else if (phase.kind === "rest") {
    if (phase.nextStartMs !== null) {
      const left = phase.nextStartMs - now;
      clockLabel = left > 0 ? "Next rep in" : "Go — next rep is due";
      clockValue = formatElapsed(Math.abs(left)).replace(/\.\d$/, "");
      clockTone = left > 10_000 ? "text-ink" : left > 0 ? "text-gold-text" : "text-danger";
    } else {
      clockLabel = phase.holdEventId ? "On hold · resting" : phase.rest ? `${describeRest(phase.rest)} · resting` : "Resting";
      clockValue = formatElapsed(Math.max(0, now - phase.restStartedMs)).replace(/\.\d$/, "");
    }
  }

  // Changing the plan mid-workout: one more rep at the end, or drop the last one.
  const [repsOpen, setRepsOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [repsError, setRepsError] = useState<string | null>(null);
  const [changingReps, startChange] = useTransition();
  const lastRep = reps[reps.length - 1];
  const lastRepStarted = [...state.athletes.values()].some((list) => list[reps.length - 1]?.startMs != null);
  const otherGroups = plan.groups.filter((g) => g.id !== group.id).map((g) => ({ g, phase: state.groups.get(g.id) }));
  // Groups already finished stay finished: the extra rep is for whoever's still out there (and this group).
  const finishedOthers = otherGroups.filter(({ phase }) => phase?.kind === "done" && phase.endedEarlyAfter === null).map(({ g }) => g);
  const goingOthers = otherGroups.filter(({ phase }) => phase && phase.kind !== "done").map(({ g }) => g);
  const changeReps = (change: "add" | "drop") => {
    setRepsError(null);
    startChange(async () => {
      // Groups already finished stay finished (sent first, so they never flash back to resting; harmless if the add fails).
      if (change === "add") for (const g of finishedOthers) send({ type: "group_end", groupId: g.id, repId: lastRep.id });
      try {
        const r = await changeRepsAction(workoutId, change);
        if (r.error) return setRepsError(r.error);
      } catch {
        // Offline: a plan change needs the server, unlike taps.
        return setRepsError("Couldn't reach the server to change the reps. Try again when you have a connection.");
      }
      await refresh();
      setRepsOpen(false);
    });
  };

  // A runner added mid-rep joins from the next rep: the one running started without them.
  const joinIndex = phase.kind === "running" ? Math.min(repIndex + 1, reps.length - 1) : repIndex;
  const sheetRep = sheetFor ? state.athletes.get(sheetFor) : null;
  const notInWorkout = people.filter((p) => !state.athletes.has(p.id));

  return (
    <div className={`space-y-3 ${lapOpen ? "pb-40" : "pb-20"}`}>
      {plan.groups.length > 1 && <Segmented value={group.id} onChange={setGroupId} options={plan.groups.map((g) => ({ value: g.id, label: g.name }))} />}
      {/* Which group this phone is timing, said plainly, and how the runners are laid out. */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="min-w-0 truncate text-lg font-semibold text-ink">
          {plan.groups.length > 1 ? (
            <>
              <span className="font-normal text-ink-2">Timing </span>
              {group.name}
            </>
          ) : (
            "Timing"
          )}
        </h1>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => setViewOpen(true)}>
            <SlidersHorizontal className="size-3.5" />
            <span className="text-ink-2">Order:</span> {ORDER_LABEL[order]}
          </Button>
          {/* The rare things: add a runner, change the reps, end this group early. */}
          {!plan.finishedAt && (
            <Button variant="secondary" size="sm" onClick={() => setRepsOpen(true)} aria-label="More: add a runner, change reps">
              <MoreHorizontal className="size-4" />
            </Button>
          )}
        </div>
      </div>
      {signedOut ? (
        <Alert tone="danger">
          This phone isn&rsquo;t signed in to time anymore{unsent > 0 ? `; ${unsent} tap${unsent === 1 ? " is" : "s are"} saved on it` : ""}. Sign in again with the workout code
          {unsent > 0 ? " and they'll send" : ""}.
        </Alert>
      ) : (
        // Only when offline: online, a tap sends in a moment, and a banner flashing in would shove the tiles down mid-pack.
        !online && (
          <Alert tone="gold">
            {unsent > 0
              ? `Offline: ${unsent} tap${unsent === 1 ? "" : "s"} saved on this phone, sending when the connection's back.`
              : "Offline: keep tapping; taps are saved on this phone until the connection's back."}
          </Alert>
        )
      )}

      {plan.finishedAt && <Alert tone="gold">This workout has been ended. Times can still be fixed; reopen it from Overview to run more reps.</Alert>}
      {/* Where the group is, and the one clock that matters right now. */}
      <div className={`rounded-lg border px-4 py-4 shadow-card ${groupTint(phase, now)}`}>
        {/* The rep, big: what a coach glances at between taps. */}
        <div className="text-xl leading-tight font-semibold text-ink">
          {phase.kind === "done" ? (
            phase.endedEarlyAfter !== null ? (
              <>
                Done after rep {phase.endedEarlyAfter + 1} <span className="font-normal text-ink-2">of {reps.length}</span>
              </>
            ) : (
              <>Done: all {reps.length} reps</>
            )
          ) : phase.kind === "rest" ? (
            <>
              Between reps {phase.afterRepIndex + 1} <span className="font-normal text-ink-2">and</span> {phase.afterRepIndex + 2}
            </>
          ) : (
            repLabel(repIndex)
          )}
        </div>
        {phase.kind !== "done" && (
          <div className="mt-0.5 text-[13px] text-ink-2">
            {phase.kind === "rest" ? `Rep ${repIndex + 1} is ${rep.label}` : rep.label}
            {phase.kind === "running" && rep.restAfter && <span className="text-ink-3"> · then {describeRest(rep.restAfter)}</span>}
            {phase.kind === "running" && outOf > 0 && (
              <span className="font-semibold text-ink">
                {" "}
                · {inCount} of {outOf} in
              </span>
            )}
          </div>
        )}
        {phase.kind === "running" || phase.kind === "rest" ? (
          <div className="mt-3 flex items-end justify-between gap-4">
            {outRepStartMs !== null && (
              <div className="min-w-0">
                <div className="text-[11px] font-semibold tracking-[0.08em] text-gold-text uppercase">Rep {lastIndex + 1} clock</div>
                <Time className="block text-5xl leading-tight font-semibold tracking-tight text-ink">{formatElapsed(Math.max(0, now - outRepStartMs))}</Time>
              </div>
            )}
            <div className={outRepStartMs !== null ? "text-right" : ""}>
              <div className={`text-[11px] font-semibold tracking-[0.08em] uppercase ${clockTone === "text-ink" ? "text-ink-2" : clockTone}`}>{clockLabel}</div>
              <Time className={`block leading-tight font-semibold tracking-tight ${outRepStartMs !== null ? "text-3xl" : "text-5xl"} ${clockTone}`}>{clockValue}</Time>
            </div>
          </div>
        ) : phase.kind === "before" ? (
          <p className="mt-1 text-sm text-ink-2">{!loaded ? "Loading…" : plan.finishedAt ? "This group didn't run before the workout ended." : "Start the clock when the group goes."}</p>
        ) : phase.kind === "done" && phase.endedEarlyAfter === null && !plan.finishedAt ? (
          <Button size="xl" className="mt-3 w-full" disabled={changingReps} onClick={() => changeReps("add")}>
            <Plus className="size-5" />
            Add one more rep ({lastRep.label})
          </Button>
        ) : phase.endEventId && !plan.finishedAt ? (
          <Button variant="tint" size="sm" className="mt-3" onClick={() => send({ type: "void", targetEventId: phase.endEventId! })}>
            Undo: keep going with rep {phase.endedEarlyAfter! + 2}
          </Button>
        ) : null}
        {phase.kind === "running" && !plan.finishedAt && (
          <div className={`mt-4 grid gap-2 ${repIndex < reps.length - 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            <Button variant="tint" size="touch" disabled={!startEventId} onClick={() => setAdjustingKey(adjusting ? null : armKey)} aria-pressed={adjusting}>
              Fix the clock
            </Button>
            {/* No rest after the last rep: it's over when everyone's in. */}
            {repIndex < reps.length - 1 && (
              <Button variant={restArmed ? "gold" : "tint"} size="touch" onPointerDown={notePointerDown} onClick={startRest}>
                {restArmed ? "Tap again to rest" : "Start rest"}
              </Button>
            )}
          </div>
        )}
        {phase.kind === "running" && restArmed && <p className="mt-2 text-[13px] text-ink-2">Starts the rest before everyone&rsquo;s in. Anyone still out can be tapped in after.</p>}
        {phase.kind === "running" && adjusting && (
          <div className="mt-3 rounded-lg bg-ink/[0.04] p-3">
            <p className="mb-2 text-[13px] text-ink-2">Started the clock late or early? Add or take off seconds.</p>
            <div className="grid grid-cols-4 gap-2">
              {[-5, -1, 1, 5].map((d) => (
                <Button key={d} variant="tint" size="touch" className="font-mono" onClick={() => nudgeStart(-d * 1000)}>
                  {d > 0 ? "+" : "−"}
                  {Math.abs(d)}s
                </Button>
              ))}
            </div>
          </div>
        )}
        {phase.kind !== "running" && phase.kind !== "done" && !plan.finishedAt && (
          <>
            <Button size="xl" variant={startArmed ? "gold" : "primary"} className="mt-3 w-full" onPointerDown={notePointerDown} onClick={startRep}>
              <Play className="size-5" />
              {startArmed ? `Tap again to start rep ${repIndex + 1}` : `Start rep ${repIndex + 1}`}
            </Button>
            {/* Under the button, so arming it never moves it out from under the thumb. */}
            {startArmed && (
              <p className="mt-2 rounded-md bg-gold-soft px-3 py-2 text-[13px] text-ink">
                {listNames(shortNames(stillOut.map(({ id }) => nameOf.get(id) ?? "?")))} {stillOut.length === 1 ? "is" : "are"} still out on rep {repIndex}. Starting rep {repIndex + 1} leaves{" "}
                {stillOut.length === 1 ? "them" : "them each"} with no time for rep {repIndex}. You can add one later by tapping their name.
              </p>
            )}
          </>
        )}
        {/* Between reps: hold the countdown for a water break or a delay. */}
        {canHold && phase.kind === "rest" && !plan.finishedAt && (
          <Button variant="tint" size="touch" className="mt-2 w-full" onClick={toggleHold} aria-pressed={!!phase.holdEventId}>
            {phase.holdEventId ? "Back to the countdown" : "Hold the rest"}
          </Button>
        )}
      </div>

      {pendingLaps.length > 0 && (
        <div className={`rounded-lg border px-3 py-2.5 ${extraLaps > 0 ? "border-danger/40 bg-danger-soft/50" : "border-brand/30 bg-brand-soft/40"}`}>
          <div className="text-[13px] font-medium text-ink">
            {extraLaps > 0 && leftToName === 0
              ? `Everyone's in: ${extraLaps === 1 ? "this finish is" : `these ${extraLaps} finishes are`} extra.`
              : extraLaps > 0
                ? `${pendingLaps.length} finishes but only ${leftToName} runner${leftToName === 1 ? "" : "s"} left: ${extraLaps} ${extraLaps === 1 ? "is" : "are"} extra.`
                : `${pendingLaps.length} finish${pendingLaps.length === 1 ? "" : "es"} to name: tap runners in the order they crossed.`}
          </div>
          {extraLaps === 0 && leftToName > pendingLaps.length && (
            <div className="mt-0.5 text-[12px] text-ink-2">Still coming in? Keep tapping Finish, and name them when it&rsquo;s quiet.</div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {pendingLaps.map((e, i) => (
              <span
                key={e.clientEventId}
                className={`inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 ${
                  i >= pendingLaps.length - extraLaps ? "border-danger/50 bg-surface" : i === 0 ? "border-brand bg-surface" : "border-line bg-surface/60"
                }`}
              >
                <Time className={`text-[13px] ${i === 0 ? "font-semibold text-ink" : "text-ink-2"}`}>{lapStartMs !== null ? formatElapsed(Math.max(0, lapAt(e) - lapStartMs)) : "—"}</Time>
                <button type="button" onClick={() => send({ type: "void", targetEventId: e.clientEventId })} className="rounded-full px-1 text-[12px] text-ink-3 hover:text-ink" aria-label="Throw away this finish">
                  ✕
                </button>
              </span>
            ))}
            {/* The extra is usually the last tap; any chip's ✕ throws away a different one. */}
            {extraLaps > 0 && (
              <Button variant="danger" size="sm" className="rounded-full" onClick={() => pendingLaps.slice(-extraLaps).forEach((e) => send({ type: "void", targetEventId: e.clientEventId }))}>
                Throw away the last {extraLaps === 1 ? "one" : extraLaps}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Tap as they finish. A finished tile shows the time and stays put; tap it again for fixes. */}
      {tiles.length > 0 && (
        <div className={`grid gap-2 ${large ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
          {tiles.map(({ id, r }) => (
            <div key={id} className="relative">
              <button
                type="button"
                onPointerDown={r.status === "running" ? notePointerDown : undefined}
                onClick={() => (r.status === "running" ? finish(id) : setSheetFor(id))}
                className={`flex w-full rounded-lg border text-left ${large ? "min-h-16 items-center justify-between gap-3 py-2 pr-11 pl-4" : "h-20 flex-col items-start justify-between px-3 py-2"} ${
                  // Still out: raised, ready to tap. Tapped: green and checked, so the ones left stand out. Skipping: faded.
                  r.status === "running"
                    ? "border-line-strong bg-surface shadow-card active:bg-brand-soft"
                    : r.status === "done"
                      ? "border-brand/30 bg-brand-soft"
                      : "border-transparent bg-surface-2"
                }`}
              >
                <span className={`line-clamp-2 leading-tight font-semibold ${large ? "text-xl" : "pr-6 text-[15px]"} ${r.status === "skipped" ? "text-ink-3" : "text-ink"}`}>
                  {r.status === "done" && <Check className="mr-1 inline size-4 -translate-y-px text-brand-text" strokeWidth={3} />}
                  {nameOf.get(id) ?? "?"}
                </span>
                {r.status === "done" && r.elapsedMs !== null ? (
                  <span className="flex items-baseline gap-2">
                    <Time className={`${large ? "text-xl" : "text-base"} font-semibold text-ink`}>{ft(r.elapsedMs)}</Time>
                    {r.deltaMs !== null && <Time className={`text-xs ${deltaTone(r.deltaMs)}`}>{deltaText(r.deltaMs, tenths)}</Time>}
                  </span>
                ) : r.status === "skipped" ? (
                  <span className="text-xs text-ink-3">skipping</span>
                ) : (
                  <span className="flex items-baseline gap-2">
                    {/* A late start runs on their own clock; show it so it isn't mistaken for the group's. */}
                    {phase.kind === "running" && r.startMs !== null && r.startMs !== phase.startMs && (
                      <span className="flex items-baseline gap-1">
                        <span className="text-[10px] font-semibold tracking-wide text-gold-text uppercase">late start</span>
                        <Time className="text-sm font-semibold text-ink">{formatElapsed(Math.max(0, now - r.startMs))}</Time>
                      </span>
                    )}
                    {/* With finishes waiting, a tap names the oldest: say which time it gives. Else the goal
                        (no room for that and a late clock on a phone tile: the late clock wins). */}
                    {pendingLaps.length > 0 && r.status === "running" ? (
                      <Time className={`${large ? "text-base" : "text-sm"} font-semibold text-brand-text`}>→ {nextLapFor(r)}</Time>
                    ) : (
                      r.goalMs !== null &&
                      !(phase.kind === "running" && r.startMs !== null && r.startMs !== phase.startMs) && <Time className={`${large ? "text-sm" : "text-xs"} text-ink-3`}>goal {formatElapsed(r.goalMs, "seconds")}</Time>
                    )}
                  </span>
                )}
              </button>
              <button type="button" onClick={() => setSheetFor(id)} className={`absolute right-1 rounded p-1.5 text-ink-3 ${large ? "top-1/2 -translate-y-1/2" : "top-1"} hover:bg-surface-2 hover:text-ink`} aria-label={`More for ${nameOf.get(id)}`}>
                <MoreHorizontal className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {makeUps.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Make-ups</div>
          <div className={`grid gap-2 ${large ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
            {makeUps.map(({ id, r, i }) => (
              <div key={`${id}:${i}`} className="relative">
                <button
                  type="button"
                  onPointerDown={notePointerDown}
                  onClick={() => finish(id, r.repId)}
                  className="flex h-20 w-full flex-col items-start justify-between rounded-lg border border-line-strong bg-surface px-3 py-2 text-left shadow-card active:bg-brand-soft"
                >
                  <span className="line-clamp-1 pr-6 text-[15px] font-semibold text-ink">{nameOf.get(id) ?? "?"}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="text-[11px] font-medium text-ink-2">Rep {i + 1}</span>
                    {r.startMs !== null && <Time className="text-sm font-semibold text-ink">{formatElapsed(Math.max(0, now - r.startMs))}</Time>}
                    {r.goalMs !== null && <Time className="text-xs text-ink-3">goal {formatElapsed(r.goalMs, "seconds")}</Time>}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => r.ownStartEventId && send({ type: "void", targetEventId: r.ownStartEventId })}
                  className="absolute top-1 right-1 rounded p-1.5 text-[11px] text-ink-3 hover:bg-surface-2 hover:text-ink"
                  aria-label={`Cancel ${nameOf.get(id)}'s make-up`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* After an early rest: who's still out on the last rep, tapped in from here. */}
      {stillOut.length > 0 && phase.kind === "rest" && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-gold-text uppercase">Still out on rep {phase.afterRepIndex + 1}</div>
          <div className={`grid gap-2 ${large ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3"}`}>
            {stillOut.map(({ id, r }) => (
              <button
                key={id}
                type="button"
                onPointerDown={notePointerDown}
                onClick={() => finish(id, r.repId)}
                className="flex h-16 flex-col items-start justify-between rounded-lg border border-gold/50 bg-surface px-3 py-2 text-left active:bg-brand-soft"
              >
                <span className="line-clamp-1 text-[15px] font-semibold text-ink">{nameOf.get(id) ?? "?"}</span>
                {pendingLaps.length > 0 ? (
                  <Time className="text-sm font-semibold text-brand-text">→ {nextLapFor(r)}</Time>
                ) : (
                  r.goalMs !== null && <Time className="text-xs text-ink-3">goal {formatElapsed(r.goalMs, "seconds")}</Time>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The last rep's finishers in order, or every rep so far. */}
      {phase.kind !== "running" && finishedRows.length > 0 && (
        <Card>
          {/* The last rep in finish order, or every rep so far for this group: the numbers to talk about while they rest. */}
          <div className="flex items-center justify-between gap-2 border-b border-line py-1.5 pr-1.5 pl-4">
            <span className="text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{allReps && lastIndex > 0 ? `Reps 1–${lastIndex + 1}` : `Rep ${lastIndex + 1}`}</span>
            {lastIndex > 0 && (
              <Segmented
                size="sm"
                joined
                className="w-36"
                value={allReps ? "all" : "last"}
                onChange={(v) => setResultsPref(v === "all" ? "all" : null)}
                options={[
                  { value: "last", label: `Rep ${lastIndex + 1}` },
                  { value: "all", label: "All reps" },
                ]}
              />
            )}
          </div>
          {allReps && lastIndex > 0 ? (
            <GroupRepsGrid
              rows={[...finishedRows, ...stillOut, ...notRunning].map(({ id }) => ({ id, name: nameOf.get(id) ?? "?", list: state.athletes.get(id)!.slice(0, lastIndex + 1) }))}
              reps={reps}
              ft={ft}
              tenths={tenths}
              onOpen={setSheetFor}
            />
          ) : (
          <div className="divide-y divide-line">
            <div className="flex items-center gap-3 px-4 pt-1.5 pb-1 text-[11px] font-semibold text-ink-3">
              <span className="flex-1" />
              <span className="w-10 text-right">Goal</span>
              <span className="w-12 text-right">Time</span>
              <span className="w-12 text-right">+/−</span>
            </div>
            {finishedRows.map(({ id, r }) => (
              <button key={id} type="button" onClick={() => setSheetFor(id)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-ink">{nameOf.get(id) ?? "?"}</span>
                <Time className="w-10 text-right text-[13px] text-ink-3">{r.goalMs !== null ? ft(r.goalMs, "seconds") : ""}</Time>
                <Time className="w-12 text-right font-semibold text-ink">{r.elapsedMs !== null ? ft(r.elapsedMs) : "—"}</Time>
                <Time className={`w-12 text-right text-[13px] ${r.deltaMs !== null ? deltaTone(r.deltaMs) : "text-ink-3"}`}>{r.deltaMs !== null ? deltaText(r.deltaMs, tenths) : ""}</Time>
              </button>
            ))}
            {notRunning.map(({ id, r }) => (
              <button key={id} type="button" onClick={() => setSheetFor(id)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-ink-3 hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate">{nameOf.get(id) ?? "?"}</span>
                <span>{r.status === "skipped" ? "skipped" : r.status === "unfinished" ? "no time" : "done for today"}</span>
              </button>
            ))}
          </div>
          )}
        </Card>
      )}

      {/* Between reps: who's going next, for skips, moves and stops before the start. */}
      {upNext.length > 0 && !plan.finishedAt && (
        <Card>
          <div className="border-b border-line px-4 py-2 text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Running rep {repIndex + 1}</div>
          <div className="divide-y divide-line">
            {upNext.map(({ id, r }) => (
              <button key={id} type="button" onClick={() => setSheetFor(id)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-ink">{nameOf.get(id) ?? "?"}</span>
                {r.status === "skipped" ? <span className="text-[13px] text-ink-3">skipping</span> : r.goalMs !== null && <Time className="text-[13px] text-ink-3">goal {formatElapsed(r.goalMs, "seconds")}</Time>}
              </button>
            ))}
          </div>
        </Card>
      )}

      {repsError && !repsOpen && <Alert tone="danger">{repsError}</Alert>}

      {repsOpen && (
        <Sheet title="More" subtitle={`${group.name} · ${reps.length} reps in the plan`} onClose={() => setRepsOpen(false)}>
          <div className="space-y-2">
            <SectionLabel className="mb-1">Runners</SectionLabel>
            <button
              type="button"
              onClick={() => {
                setRepsOpen(false);
                setMarking(true);
              }}
              className="flex w-full items-center gap-2 rounded-md border border-line px-3 py-3 text-left text-sm text-ink hover:bg-surface-2"
            >
              <ListChecks className="size-4 text-ink-2" />
              Mark runners: done for today, skipped…
            </button>
            {phase.kind !== "done" && notInWorkout.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setRepsOpen(false);
                  setAdding(true);
                }}
                className="flex w-full items-center gap-2 rounded-md border border-line px-3 py-3 text-left text-sm text-ink hover:bg-surface-2"
              >
                <UserPlus className="size-4 text-ink-2" />
                Add a runner to {group.name}
              </button>
            )}
            <SectionLabel className="mt-4 mb-1">Reps</SectionLabel>
            <button type="button" disabled={changingReps} onClick={() => changeReps("add")} className="w-full rounded-md border border-line px-3 py-3 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-50">
              Add rep {reps.length + 1}: {lastRep.label}
              <span className="mt-0.5 block text-[13px] text-ink-2">
                After rep {reps.length}, with the usual rest before it.
                {goingOthers.length > 0 && ` ${listNames(goingOthers.map((g) => g.name))} ${goingOthers.length === 1 ? "is" : "are"} still going and will run it too.`}
                {finishedOthers.length > 0 && ` ${listNames(finishedOthers.map((g) => g.name))} ${finishedOthers.length === 1 ? "has" : "have"} finished and won't.`}
              </span>
            </button>
            <button
              type="button"
              disabled={changingReps || lastRepStarted || reps.length === 1}
              onClick={() => changeReps("drop")}
              className="w-full rounded-md border border-line px-3 py-3 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-50"
            >
              Drop rep {reps.length}
              <span className="mt-0.5 block text-[13px] text-ink-2">
                {lastRepStarted ? "A group has started it. To stop one group early, end it below." : reps.length === 1 ? "It's the only rep." : "Nobody has started it yet."}
              </span>
            </button>
            {lastRunIndex >= 0 && lastRunIndex < reps.length - 1 && (
              <button
                type="button"
                onClick={() => {
                  endGroup();
                  setRepsOpen(false);
                }}
                className="w-full rounded-md border border-line px-3 py-3 text-left text-sm text-ink hover:bg-surface-2"
              >
                End {group.name} after rep {lastRunIndex + 1}
                <span className="mt-0.5 block text-[13px] text-ink-2">
                  {phase.kind === "running" ? "The rep running now is their last" : "No more reps for them"}; reps {lastRunIndex + 2}–{reps.length} aren&rsquo;t run. Other groups carry on. You can undo it.
                </span>
              </button>
            )}
            {repsError && <Alert tone="danger">{repsError}</Alert>}
          </div>
        </Sheet>
      )}

      {sheetFor && sheetRep && (
        <AthleteActions
          name={nameOf.get(sheetFor) ?? "?"}
          rep={sheetRep[phase.kind === "running" ? repIndex : Math.max(0, lastIndex)]}
          repNumber={phase.kind === "running" ? repIndex + 1 : Math.max(0, lastIndex) + 1}
          next={phase.kind === "done" ? null : { index: repIndex, entry: sheetRep[repIndex] }}
          running={phase.kind === "running"}
          groupStartMs={startMsNow}
          otherGroups={plan.groups.filter((g) => g.id !== group.id)}
          onClose={() => setSheetFor(null)}
          act={(type, extra) => {
            send({ athleteId: sheetFor, groupId: group.id, ...extra, type, at: Date.now() });
            setSheetFor(null);
          }}
          reps={reps}
          soFar={sheetRep.slice(0, Math.max(phase.kind === "running" ? repIndex : lastIndex + 1, 0))}
          list={sheetRep}
          onAddTime={(r, ms) => setRepTime(send, sheetFor, r, ms)}
          ft={ft}
        />
      )}

      {/* The thumb's corner of the screen: Undo for the last tap (wrong-runner taps happen in packs), and,
          while a rep is on, a big Finish button to hit without looking as a pack comes across. (Stored as "lap" events.) */}
      {(lastTap || (lapOpen && !plan.finishedAt)) && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-2xl flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {lastTap && (
          <div className="flex items-center gap-3 rounded-full border border-line-strong bg-surface py-1.5 pr-1.5 pl-4 shadow-sheet">
            <span className="text-sm text-ink">
              {lastTap.lapText ? (
                <>
                  <span className="font-semibold">{lastTap.name}</span> gets <span className="font-semibold">{lastTap.lapText}</span>
                </>
              ) : (
                <>
                  Tapped <span className="font-semibold">{lastTap.name}</span>
                </>
              )}
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={() => {
                send({ type: "void", targetEventId: lastTap.eventId });
                setLastTap(null);
              }}
            >
              Undo
            </Button>
          </div>
          )}
          {lapOpen && !plan.finishedAt && (
            <button
              type="button"
              onPointerDown={notePointerDown}
              onClick={takeLap}
              className="flex h-16 w-full items-center justify-center gap-3 rounded-xl bg-ink text-bg shadow-sheet select-none active:bg-ink/80"
            >
              <span className="text-xl font-semibold">Finish</span>
              {pendingLaps.length > 0 && <span className="rounded-full bg-bg/20 px-2.5 py-0.5 text-sm font-medium">{pendingLaps.length} to name</span>}
            </button>
          )}
        </div>
      )}

      {marking && (
        <MarkRunnersSheet
          reps={reps}
          runners={allIds
            .filter((id) => state.athletes.get(id)!.some((r) => r.groupId === group.id))
            .map((id) => ({ id, name: nameOf.get(id) ?? "?", list: state.athletes.get(id)! }))
            .sort((a, b) => a.name.localeCompare(b.name))}
          initialRepIndex={Math.min(repIndex, reps.length - 1)}
          onApply={(evs) => evs.forEach((e) => send(e))}
          onClose={() => setMarking(false)}
        />
      )}

      {adding && (
        <Sheet title="Add a runner" subtitle={`Joins ${group.name} from rep ${joinIndex + 1}`} onClose={() => setAdding(false)}>
          <div className="max-h-[60dvh] divide-y divide-line overflow-y-auto">
            {notInWorkout.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  send({ type: "move", athleteId: p.id, groupId: group.id, repId: reps[joinIndex].id });
                  setAdding(false);
                }}
                className="block w-full py-2.5 text-left text-sm text-ink hover:bg-surface-2"
              >
                {p.name}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {viewOpen && (
        <Sheet title="This screen" subtitle="Remembered on this phone." onClose={() => setViewOpen(false)}>
          <SectionLabel className="mb-1.5">Order</SectionLabel>
          <div className="grid gap-2">
            {(
              [
                { value: "goal", label: "Goal", hint: "Fastest goal first. Stays the same every rep." },
                { value: "last", label: "Last rep", hint: "The order they came in on the rep before, so packs stay together." },
                { value: "name", label: "A–Z", hint: "By first name." },
              ] as const
            ).map((o) => (
              <ChoiceRow
                key={o.value}
                active={order === o.value}
                label={o.label}
                hint={o.hint}
                onClick={() => {
                  setOrderPref(o.value === "goal" ? null : o.value);
                  setViewOpen(false);
                }}
              />
            ))}
          </div>
          <SectionLabel className="mt-5 mb-1.5">Tiles</SectionLabel>
          <div className="space-y-2">
            <ChoiceRow active={large} label="Large tiles" hint="One name per row, bigger text." onClick={() => setLargePref(large ? null : "1")} />
            <ChoiceRow
              active={sink}
              label="Finished runners move down"
              hint="A second after your last tap, so nothing moves while you're tapping a pack. Ends fastest to slowest."
              onClick={() => setSinkPref(sink ? "off" : null)}
            />
          </div>
          <SectionLabel className="mt-5 mb-1.5">Countdown</SectionLabel>
          <ChoiceRow
            active={alerts}
            label="Beep at 10 s and at Go"
            hint="Before each timed rest ends, so you can watch the runners. Turn the phone's sound up."
            onClick={() => {
              unlockAudio();
              setAlertPref(alerts ? "off" : null);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

/**
 * Every rep so far for the group, one row per runner: times coloured against
 * goal like the team grid, with the average. Tap a name for their actions.
 */
function GroupRepsGrid({
  rows,
  reps,
  ft,
  tenths,
  onOpen,
}: {
  rows: { id: string; name: string; list: AthleteRep[] }[];
  reps: FlatRep[];
  ft: (ms: number, precision?: "seconds" | "tenths") => string;
  tenths: boolean;
  onOpen: (id: string) => void;
}) {
  const n = rows[0]?.list.length ?? 0;
  const [deltasPref, setDeltasPref] = useLocalValue(SHOW_DELTAS_KEY);
  const showDeltas = deltasPref !== "off";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] font-semibold text-ink-3">
            <th className="sticky left-0 bg-surface px-4 py-1.5 text-left font-semibold">
              <Switch checked={showDeltas} onChange={(on) => setDeltasPref(on ? null : "off")} label="+/−" />
            </th>
            <th className="px-2 py-1.5 text-right font-semibold">Goal</th>
            {reps.slice(0, n).map((r, i) => (
              <th key={r.id} className="px-1 py-1.5 text-right font-semibold">
                {i + 1}
              </th>
            ))}
            <th className="border-l border-line px-3 py-1.5 text-right font-semibold whitespace-nowrap">Avg{reps.slice(0, n).some((r) => r.meters !== reps[0].meters) ? ` / ${reps[0].label}` : ""}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, name, list }) => {
            const avg = summarize(reps, list).avgPaceMsPerKm;
            const goal = list.find((r) => r.goalMs !== null)?.goalMs ?? null;
            return (
              <tr key={id} className="border-b border-line last:border-0">
                <td className="sticky left-0 bg-surface p-0">
                  <button type="button" onClick={() => onOpen(id)} className="block max-w-32 truncate px-4 py-1.5 text-left text-ink hover:underline">
                    {name.split(" ")[0]}
                  </button>
                </td>
                <td className="px-2 py-1 text-right">
                  <Time className="text-[13px] text-ink-3">{goal !== null ? ft(goal, "seconds") : "—"}</Time>
                </td>
                {list.map((r) => (
                  <td key={r.repId} className="px-0.5 py-1 text-right">
                    {r.status === "done" && r.elapsedMs !== null ? (
                      <RepCell time={ft(r.elapsedMs)} delta={showDeltas && r.deltaMs !== null ? deltaText(r.deltaMs, tenths) : null} tone={repCellTone(r.deltaMs)} typed={!!r.typedEventId} />
                    ) : (
                      <span className="px-1 text-xs text-ink-3">{r.status === "skipped" ? "skip" : r.status === "unfinished" ? "no time" : r.status === "stopped" ? "done" : r.status === "running" ? "now" : "·"}</span>
                    )}
                  </td>
                ))}
                <td className="border-l border-line px-3 py-1 text-right">
                  <Time className="text-[13px] font-semibold text-ink">{avg !== null ? ft((avg * reps[0].meters) / 1000) : "—"}</Time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChoiceRow({ active, label, hint, onClick }: { active: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border px-4 py-2 text-left ${active ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-2"}`}
    >
      <span>
        <span className="block text-base font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink-2">{hint}</span>
      </span>
      {active && <Check className="size-4 shrink-0 text-brand-text" />}
    </button>
  );
}

/** "Ajani", "Ajani and Joe", "Ajani, Joe and Will". */
const listNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** First names, unless two share one: then full names, so "Emma and Emma" can't happen. */
const shortNames = (full: string[]) => {
  const first = full.map((n) => n.split(" ")[0]);
  return full.map((n, i) => (first.filter((f) => f === first[i]).length > 1 ? n : first[i]));
};

/** "Addyson's", "James'". */
const possessive = (first: string) => (/s$/i.test(first) ? `${first}'` : `${first}'s`);

/** What can happen to one runner mid-workout. */
function AthleteActions({
  name,
  rep,
  repNumber,
  next,
  running,
  groupStartMs,
  otherGroups,
  onClose,
  act,
  reps,
  soFar,
  list,
  onAddTime,
  ft,
}: {
  name: string;
  /** The rep on screen: running now, or the one just run. */
  rep: AthleteRep;
  repNumber: number;
  /** The rep that's up (running now or next). */
  next: { index: number; entry: AthleteRep } | null;
  running: boolean;
  /** When the group started the rep on screen, to say how late a late start was. */
  groupStartMs: number | null;
  otherGroups: { id: string; name: string }[];
  onClose: () => void;
  act: (type: "void" | "edit" | "skip" | "stop" | "rejoin" | "move" | "rep_start" | "finish", extra: { repId?: string; targetEventId?: string; timeMs?: number; groupId?: string }) => void;
  reps: FlatRep[];
  /** Their reps before the one on screen (for make-ups of skipped ones). */
  soFar: AthleteRep[];
  /** Every rep of theirs, for the breakdown under the actions. */
  list: AthleteRep[];
  /** A typed time for any rep: fix one, or add one that has none. The sheet stays open for the next. */
  onAddTime: (rep: AthleteRep, elapsedMs: number) => void;
  ft: (ms: number) => string;
}) {
  const btn = "w-full rounded-md border border-line px-3 py-3 text-left text-sm text-ink hover:bg-surface-2";
  const upId = next ? reps[next.index].id : null;
  const first = name.split(" ")[0];
  return (
    <Sheet title={name} subtitle={rep.status === "done" && rep.elapsedMs !== null ? `Rep ${repNumber}: ${ft(rep.elapsedMs)}` : `Rep ${repNumber}`} onClose={onClose}>
      {/* What to do now first (that's why it's open mid-workout); their whole workout below, where any rep can be fixed. */}
      <div className="space-y-2">
        {rep.status === "done" && rep.finishEventId && (
          <button type="button" className={btn} onClick={() => act("void", { targetEventId: rep.finishEventId! })}>
            Undo the finish (still running)
            <span className="mt-0.5 block text-[13px] text-ink-2">Tapped the wrong runner? This puts them back on the course.</span>
          </button>
        )}
        {running && rep.status === "running" && !rep.ownStartEventId && (
          <button type="button" className={btn} onClick={() => act("rep_start", { repId: rep.repId })}>
            Start {possessive(first)} clock now
            <span className="mt-0.5 block text-[13px] text-ink-2">For a late start. The group&rsquo;s clock keeps running.</span>
          </button>
        )}
        {/* Already on their own clock: say so, and offer the two ways out rather than a second start. */}
        {running && rep.status === "running" && rep.ownStartEventId && (
          <>
            <p className="rounded-md bg-gold-soft px-3 py-2 text-[13px] text-ink">
              {first} is on their own clock: started {groupStartMs !== null && rep.startMs !== null ? `${formatElapsed(Math.max(0, rep.startMs - groupStartMs), "seconds")} after the group` : "late"}.
            </p>
            <button type="button" className={btn} onClick={() => act("void", { targetEventId: rep.ownStartEventId! })}>
              Back to the group&rsquo;s clock
              <span className="mt-0.5 block text-[13px] text-ink-2">They didn&rsquo;t start late after all.</span>
            </button>
            <button type="button" className={btn} onClick={() => act("rep_start", { repId: rep.repId })}>
              Restart {possessive(first)} clock now
              <span className="mt-0.5 block text-[13px] text-ink-2">Their clock was started too early.</span>
            </button>
          </>
        )}
        {/* A rep they skipped, run now on their own clock while the group carries on (or after it's done). */}
        {soFar
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => r.status === "skipped")
          .map(({ r, i }) => (
            <button key={r.repId} type="button" className={btn} onClick={() => act("rep_start", { repId: r.repId })}>
              Run rep {i + 1} now (make-up)
              <span className="mt-0.5 block text-[13px] text-ink-2">They skipped it. Starts their own clock; tap them in when they finish.</span>
            </button>
          ))}
        {next && upId && next.entry.status === "skipped" && next.entry.skipEventId && (
          <button type="button" className={btn} onClick={() => act("void", { targetEventId: next.entry.skipEventId! })}>
            Don&rsquo;t skip rep {next.index + 1}
            <span className="mt-0.5 block text-[13px] text-ink-2">They&rsquo;re running it after all.</span>
          </button>
        )}
        {next && upId && next.entry.status !== "done" && next.entry.status !== "stopped" && next.entry.status !== "skipped" && (
          <button type="button" className={btn} onClick={() => act("skip", { repId: upId })}>
            Skip rep {next.index + 1}
          </button>
        )}
        {next && upId && next.entry.status !== "stopped" && (
          <button type="button" className={btn} onClick={() => act("stop", { repId: upId })}>
            Done for today
          </button>
        )}
        {next && upId && next.entry.status === "stopped" && (
          <button type="button" className={btn} onClick={() => act("rejoin", { repId: upId })}>
            Back in from rep {next.index + 1}
          </button>
        )}
        {next &&
          upId &&
          otherGroups.map((g) => (
            <button key={g.id} type="button" className={btn} onClick={() => act("move", { repId: running ? (reps[next.index + 1]?.id ?? upId) : upId, groupId: g.id })}>
              Move to {g.name}
            </button>
          ))}
      </div>
      <SectionLabel className="mt-5 mb-2">Their workout</SectionLabel>
      <AthleteBreakdown reps={reps} list={list} last={null} onAddTime={onAddTime} />
    </Sheet>
  );
}

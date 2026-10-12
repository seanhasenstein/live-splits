"use client";

import { Check, MoreHorizontal, Play, SlidersHorizontal, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Input, SectionLabel, Segmented, Sheet, Time } from "@/components/ui";
import { useClock } from "@/lib/client/clock";
import { useLocalValue } from "@/lib/client/use-local-value";
import { useWakeLock } from "@/lib/client/use-wake-lock";
import { useTimeFormat } from "@/lib/client/time-format";
import { useWorkoutEvents } from "@/lib/client/use-workout-events";
import type { Workout } from "@/lib/db/schema";
import { describeRest } from "@/lib/workout-plan";
import { type AthleteRep, replayWorkout } from "@/lib/workout-replay";
import { formatElapsed, parseTypedTime } from "@/lib/time";

type Plan = Pick<Workout, "sets" | "groups" | "athletes"> & { finishedAt: string | null };

/**
 * When a tap happened: the finger landing, not the lift (see the race tap
 * screen). iOS pauses the event timestamp clock while asleep, so wall time.
 */
let lastPointerDownMs = 0;
const notePointerDown = () => {
  lastPointerDownMs = Date.now();
};
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
const deltaTone = (ms: number) => (Math.abs(ms) < 500 ? "text-ink-2" : ms < 0 ? "text-brand-text" : "text-danger");

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
  const { events, plan, send, online, loaded, unsent } = useWorkoutEvents(workoutId, initialPlan, groupId);
  const group = plan.groups.find((g) => g.id === groupId) ?? plan.groups[0];
  const state = useMemo(() => replayWorkout(plan, events), [plan, events]);
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [orderPref, setOrderPref] = useLocalValue(ORDER_KEY);
  const order: TileOrder = orderPref === "last" || orderPref === "name" ? orderPref : "goal";
  const [largePref, setLargePref] = useLocalValue(LARGE_KEY);
  const large = largePref === "1";

  // The clocks: server time, ticking at tenths.
  // Keyed on the offset, not the clock object (a new one each render would restart the ticker).
  const offsetMs = clock.sync?.offsetMs ?? 0;
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now() + offsetMs);
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
  const repIndex = phase.kind === "running" ? phase.repIndex : phase.kind === "rest" ? phase.afterRepIndex + 1 : phase.kind === "before" ? 0 : reps.length - 1;
  const rep = reps[repIndex];
  const lastIndex = phase.kind === "rest" ? phase.afterRepIndex : phase.kind === "running" ? phase.repIndex : phase.kind === "done" ? reps.length - 1 : -1;
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
  const tiles = phase.kind === "running" ? sortRows(rowsAt(repIndex).filter(({ r }) => r.status !== "stopped"), repIndex) : [];
  const finishedRows = lastIndex >= 0 ? rowsAt(lastIndex).filter(({ r }) => r.status === "done").sort((a, b) => (a.r.finishMs ?? 0) - (b.r.finishMs ?? 0)) : [];
  const notRunning = lastIndex >= 0 ? rowsAt(lastIndex).filter(({ r }) => r.status === "skipped" || r.status === "stopped" || r.status === "unfinished") : [];
  // Runners still out when the coach started the rest: they can still be tapped in for that rep.
  const stillOut = phase.kind === "rest" ? sortRows(rowsAt(phase.afterRepIndex).filter(({ r }) => r.status === "running"), phase.afterRepIndex) : [];
  const upNext = phase.kind !== "running" && phase.kind !== "done" ? sortRows(rowsAt(repIndex).filter(({ r }) => r.status === "pending"), repIndex) : [];

  // Starting the next rep while someone is still out on the last one leaves them with no time for it,
  // so it takes a second tap that says who. (A time can still be added for them afterwards.)
  const [startArmed, setStartArmed] = useState(false);
  useEffect(() => {
    if (!startArmed) return;
    const t = setTimeout(() => setStartArmed(false), 4000);
    return () => clearTimeout(t);
  }, [startArmed]);
  const startRep = () => {
    if (stillOut.length > 0 && !startArmed) return setStartArmed(true);
    setStartArmed(false);
    send({ type: "rep_start", groupId: group.id, repId: rep.id, at: tapTime() });
  };
  const finish = (athleteId: string, repId = rep.id) => send({ type: "finish", groupId: group.id, athleteId, repId, at: tapTime() });
  // Starting the rest early takes two taps: the first arms it for a few seconds, so a stray tap mid-rep does nothing.
  const [restArmed, setRestArmed] = useState(false);
  useEffect(() => {
    if (!restArmed) return;
    const t = setTimeout(() => setRestArmed(false), 3000);
    return () => clearTimeout(t);
  }, [restArmed]);
  const startRest = () => {
    if (!restArmed) return setRestArmed(true);
    setRestArmed(false);
    send({ type: "rest_start", groupId: group.id, repId: rep.id, at: tapTime() });
  };
  // Nudge the rep's start when the clock went a moment late or early: an edit to the start, from where it is now.
  const startEventId = phase.kind === "running" || phase.kind === "rest" ? phase.startEventId : null;
  const startMsNow = phase.kind === "running" ? phase.startMs : null;
  const nudgeStart = (deltaMs: number) => startEventId && startMsNow !== null && send({ type: "edit", targetEventId: startEventId, timeMs: startMsNow + deltaMs });
  const [adjusting, setAdjusting] = useState(false);

  // After an early rest the rep clock keeps going for whoever is still out: coaches call those times.
  const outRepStartMs = phase.kind === "rest" && stillOut.length > 0 ? (state.groupLog.get(group.id)?.find((l) => l.repIndex === phase.afterRepIndex)?.startMs ?? null) : null;

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
      clockLabel = phase.rest ? `${describeRest(phase.rest)} · resting` : "Resting";
      clockValue = formatElapsed(Math.max(0, now - phase.restStartedMs)).replace(/\.\d$/, "");
    }
  }

  const sheetRep = sheetFor ? state.athletes.get(sheetFor) : null;
  const notInWorkout = people.filter((p) => !state.athletes.has(p.id));

  return (
    <div className="space-y-3">
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
        <Button variant="secondary" size="sm" onClick={() => setViewOpen(true)} className="shrink-0">
          <SlidersHorizontal className="size-3.5" />
          <span className="text-ink-2">Order:</span> {ORDER_LABEL[order]}
        </Button>
      </div>
      {(!online || unsent > 0) && (
        <Alert tone="gold">{!online ? `Offline: ${unsent} tap${unsent === 1 ? "" : "s"} saved on this phone, sending when the connection's back.` : `Sending ${unsent}…`}</Alert>
      )}

      {/* Where the group is, and the one clock that matters right now. */}
      <Card className="px-4 py-4">
        <div className="text-[13px] font-medium text-ink-2">
          {phase.kind === "done" ? "All reps done" : `${repLabel(repIndex)} · ${rep.label}`}
          {phase.kind !== "done" && rep.restAfter && phase.kind === "running" && <span className="text-ink-3"> · then {describeRest(rep.restAfter)}</span>}
        </div>
        {phase.kind === "running" || phase.kind === "rest" ? (
          <div className="mt-1 flex items-end justify-between gap-4">
            {outRepStartMs !== null && (
              <div className="min-w-0">
                <div className="text-[11px] font-semibold tracking-[0.08em] text-gold-text uppercase">Rep {phase.kind === "rest" ? phase.afterRepIndex + 1 : ""} clock</div>
                <Time className="block text-5xl leading-tight font-semibold tracking-tight text-ink">{formatElapsed(Math.max(0, now - outRepStartMs))}</Time>
              </div>
            )}
            <div className={outRepStartMs !== null ? "text-right" : ""}>
              <div className={`text-[11px] font-semibold tracking-[0.08em] uppercase ${clockTone === "text-ink" ? "text-ink-2" : clockTone}`}>{clockLabel}</div>
              <Time className={`block leading-tight font-semibold tracking-tight ${outRepStartMs !== null ? "text-3xl" : "text-5xl"} ${clockTone}`}>{clockValue}</Time>
            </div>
          </div>
        ) : phase.kind === "before" ? (
          <p className="mt-1 text-sm text-ink-2">{loaded ? "Start the clock when the group goes." : "Loading…"}</p>
        ) : null}
        {phase.kind === "running" && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant={adjusting ? "ink" : "secondary"} className="h-11" disabled={!startEventId} onClick={() => setAdjusting((a) => !a)} aria-expanded={adjusting}>
              Fix the clock
            </Button>
            <Button variant={restArmed ? "gold" : "secondary"} className="h-11" onPointerDown={notePointerDown} onClick={startRest}>
              {restArmed ? "Tap again to rest" : "Start rest"}
            </Button>
          </div>
        )}
        {phase.kind === "running" && restArmed && <p className="mt-2 text-[13px] text-ink-2">Starts the rest before everyone&rsquo;s in. Anyone still out can be tapped in after.</p>}
        {phase.kind === "running" && adjusting && (
          <div className="mt-3 rounded-lg bg-surface-2 p-3">
            <p className="mb-2 text-[13px] text-ink-2">Started the clock late or early? Add or take off seconds.</p>
            <div className="grid grid-cols-4 gap-2">
              {[-5, -1, 1, 5].map((d) => (
                <Button key={d} variant="secondary" className="h-11 font-mono text-base" onClick={() => nudgeStart(-d * 1000)}>
                  {d > 0 ? "+" : "−"}
                  {Math.abs(d)}s
                </Button>
              ))}
            </div>
          </div>
        )}
        {phase.kind !== "running" && phase.kind !== "done" && (
          <>
            {startArmed && (
              <p className="mt-3 rounded-md bg-gold-soft px-3 py-2 text-[13px] text-ink">
                {listNames(shortNames(stillOut.map(({ id }) => nameOf.get(id) ?? "?")))} {stillOut.length === 1 ? "is" : "are"} still out on rep {repIndex}. Starting rep {repIndex + 1} leaves{" "}
                {stillOut.length === 1 ? "them" : "them each"} with no time for rep {repIndex}. You can add one later by tapping their name.
              </p>
            )}
            <Button size="lg" variant={startArmed ? "gold" : "primary"} className="mt-3 h-14 w-full text-base" onPointerDown={notePointerDown} onClick={startRep}>
              <Play className="size-5" />
              {startArmed ? `Tap again to start rep ${repIndex + 1}` : `Start rep ${repIndex + 1}`}
            </Button>
          </>
        )}
      </Card>

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
                  r.status === "running" ? "border-line bg-surface active:bg-brand-soft" : "border-transparent bg-surface-2"
                }`}
              >
                <span className={`line-clamp-2 leading-tight font-semibold ${large ? "text-xl" : "pr-6 text-[15px]"} ${r.status === "running" ? "text-ink" : "text-ink-2"}`}>{nameOf.get(id) ?? "?"}</span>
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
                    {r.goalMs !== null && <Time className={`${large ? "text-sm" : "text-xs"} text-ink-3`}>goal {formatElapsed(r.goalMs, "seconds")}</Time>}
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

      {/* This rep's (or the last rep's) finishers, in order. */}
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
                {r.goalMs !== null && <Time className="text-xs text-ink-3">goal {formatElapsed(r.goalMs, "seconds")}</Time>}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase.kind !== "running" && finishedRows.length > 0 && (
        <Card>
          <div className="border-b border-line px-4 py-2 text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{`Rep ${lastIndex + 1}`}</div>
          <div className="divide-y divide-line">
            {finishedRows.map(({ id, r }) => (
              <button key={id} type="button" onClick={() => setSheetFor(id)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-ink">{nameOf.get(id) ?? "?"}</span>
                <Time className="font-semibold text-ink">{r.elapsedMs !== null ? ft(r.elapsedMs) : "—"}</Time>
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
        </Card>
      )}

      {/* Between reps: who's going next, for skips, moves and stops before the start. */}
      {upNext.length > 0 && (
        <Card>
          <div className="border-b border-line px-4 py-2 text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Running rep {repIndex + 1}</div>
          <div className="divide-y divide-line">
            {upNext.map(({ id, r }) => (
              <button key={id} type="button" onClick={() => setSheetFor(id)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-ink">{nameOf.get(id) ?? "?"}</span>
                {r.goalMs !== null && <Time className="text-[13px] text-ink-3">goal {formatElapsed(r.goalMs, "seconds")}</Time>}
              </button>
            ))}
          </div>
        </Card>
      )}

      {phase.kind !== "done" && notInWorkout.length > 0 && (
        <Button variant="ghost" className="w-full text-ink-2" onClick={() => setAdding(true)}>
          <UserPlus className="size-4" />
          Add a runner
        </Button>
      )}

      {sheetFor && sheetRep && (
        <AthleteActions
          name={nameOf.get(sheetFor) ?? "?"}
          rep={sheetRep[phase.kind === "running" ? repIndex : Math.max(0, lastIndex)]}
          repNumber={phase.kind === "running" ? repIndex + 1 : lastIndex + 1}
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
        />
      )}

      {adding && (
        <Sheet title="Add a runner" subtitle={`Joins ${group.name} from rep ${repIndex + 1}`} onClose={() => setAdding(false)}>
          <div className="max-h-[60dvh] divide-y divide-line overflow-y-auto">
            {notInWorkout.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  send({ type: "move", athleteId: p.id, groupId: group.id, repId: rep.id });
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
        <Sheet title="Runners" subtitle="Remembered on this phone." onClose={() => setViewOpen(false)}>
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
          <ChoiceRow active={large} label="Large tiles" hint="One name per row, bigger text." onClick={() => setLargePref(large ? null : "1")} />
        </Sheet>
      )}
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
  reps: { id: string }[];
}) {
  const [fixing, setFixing] = useState(false);
  const [typed, setTyped] = useState(rep.elapsedMs !== null ? formatElapsed(rep.elapsedMs) : "");
  const typedMs = parseTypedTime(typed);
  const btn = "w-full rounded-md border border-line px-3 py-3 text-left text-sm text-ink hover:bg-surface-2";
  const upId = next ? reps[next.index].id : null;
  const first = name.split(" ")[0];
  return (
    <Sheet title={name} subtitle={rep.status === "done" && rep.elapsedMs !== null ? `Rep ${repNumber}: ${formatElapsed(rep.elapsedMs)}` : `Rep ${repNumber}`} onClose={onClose}>
      <div className="space-y-2">
        {rep.status === "done" && rep.finishEventId && !fixing && (
          <>
            <button type="button" className={btn} onClick={() => setFixing(true)}>
              Fix this time
            </button>
            <button type="button" className={btn} onClick={() => act("void", { targetEventId: rep.finishEventId! })}>
              Undo the finish (still running)
            </button>
          </>
        )}
        {rep.status === "unfinished" && rep.startMs !== null && !fixing && (
          <button type="button" className={btn} onClick={() => setFixing(true)}>
            Add their time
            <span className="mt-0.5 block text-[13px] text-ink-2">The group went on before they were tapped in. Type it from a watch.</span>
          </button>
        )}
        {fixing && rep.startMs !== null && (
          <div className="space-y-2">
            <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="decimal" className="h-12 font-mono text-xl" aria-label="Rep time" />
            <p className="text-[13px] text-ink-2">{typed.trim() ? (typedMs !== null ? `= ${formatElapsed(typedMs)}` : "Not a time yet") : "Digits are enough: 116 is 1:16, 116.4 is 1:16.4."}</p>
            <Button
              className="w-full"
              disabled={typedMs === null}
              onClick={() =>
                rep.finishEventId ? act("edit", { targetEventId: rep.finishEventId, timeMs: rep.startMs! + typedMs! }) : act("finish", { repId: rep.repId, timeMs: rep.startMs! + typedMs! })
              }
            >
              Save {typedMs !== null ? formatElapsed(typedMs) : ""}
            </Button>
          </div>
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
    </Sheet>
  );
}

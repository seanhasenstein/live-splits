"use client";

import { MoreHorizontal, Play, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Input, LinkButton, Segmented, Sheet, Time } from "@/components/ui";
import { useClock } from "@/lib/client/clock";
import { useWakeLock } from "@/lib/client/use-wake-lock";
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

/** "+1.4" / "−2.0": a rep against its goal, to the tenth (a 400 is won and lost in tenths); a minute or more as m:ss. */
function deltaText(ms: number): string {
  const t = Math.round(ms / 100) / 10;
  if (t === 0) return "±0.0";
  const abs = Math.abs(t);
  return `${t > 0 ? "+" : "−"}${abs >= 60 ? formatElapsed(abs * 1000) : abs.toFixed(1)}`;
}
const deltaTone = (ms: number) => (Math.round(ms / 100) === 0 ? "text-ink-2" : ms < 0 ? "text-brand-text" : "text-danger");

export function WorkoutRecorder({
  workoutId,
  workoutName,
  initialPlan,
  people,
  initialGroupId,
}: {
  workoutId: string;
  workoutName: string;
  initialPlan: Plan;
  /** Everyone on the roster, for names and for adding a late arrival. */
  people: { id: string; name: string }[];
  initialGroupId: string | null;
}) {
  useWakeLock();
  const clock = useClock();
  const { events, plan, send, online, loaded, unsent } = useWorkoutEvents(workoutId, initialPlan);
  const [groupId, setGroupId] = useState(() => (initialGroupId && initialPlan.groups.some((g) => g.id === initialGroupId) ? initialGroupId : initialPlan.groups[0].id));
  const group = plan.groups.find((g) => g.id === groupId) ?? plan.groups[0];
  const state = useMemo(() => replayWorkout(plan, events), [plan, events]);
  const nameOf = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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
  // Every tile stays where it is for the whole rep: one vanishing would slide the next under the coach's thumb.
  const tiles =
    phase.kind === "running"
      ? rowsAt(repIndex)
          .filter(({ r }) => r.status !== "stopped")
          .sort((a, b) => (a.r.goalMs ?? Infinity) - (b.r.goalMs ?? Infinity) || (nameOf.get(a.id) ?? "").localeCompare(nameOf.get(b.id) ?? ""))
      : [];
  const finishedRows = lastIndex >= 0 ? rowsAt(lastIndex).filter(({ r }) => r.status === "done").sort((a, b) => (a.r.finishMs ?? 0) - (b.r.finishMs ?? 0)) : [];
  const notRunning = lastIndex >= 0 ? rowsAt(lastIndex).filter(({ r }) => r.status === "skipped" || r.status === "stopped") : [];
  const upNext = phase.kind !== "running" && phase.kind !== "done" ? rowsAt(repIndex).filter(({ r }) => r.status === "pending") : [];

  const startRep = () => send({ type: "rep_start", groupId: group.id, repId: rep.id, at: tapTime() });
  const finish = (athleteId: string) => send({ type: "finish", groupId: group.id, athleteId, repId: rep.id, at: tapTime() });

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
          <>
            <div className={`mt-1 text-[11px] font-semibold tracking-[0.08em] uppercase ${clockTone === "text-ink" ? "text-ink-2" : clockTone}`}>{clockLabel}</div>
            <Time className={`block text-5xl leading-tight font-semibold tracking-tight ${clockTone}`}>{clockValue}</Time>
          </>
        ) : phase.kind === "before" ? (
          <p className="mt-1 text-sm text-ink-2">{loaded ? "Start the clock when the group goes." : "Loading…"}</p>
        ) : null}
        {phase.kind !== "running" && phase.kind !== "done" && (
          <Button size="lg" className="mt-3 h-14 w-full text-base" onPointerDown={notePointerDown} onClick={startRep}>
            <Play className="size-5" />
            Start {phase.kind === "before" ? "rep 1" : `rep ${repIndex + 1}`}
          </Button>
        )}
      </Card>

      {/* Tap as they finish. A finished tile shows the time and stays put; tap it again for fixes. */}
      {tiles.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map(({ id, r }) => (
            <div key={id} className="relative">
              <button
                type="button"
                onPointerDown={r.status === "running" ? notePointerDown : undefined}
                onClick={() => (r.status === "running" ? finish(id) : setSheetFor(id))}
                className={`flex h-20 w-full flex-col items-start justify-between rounded-lg border px-3 py-2 text-left ${
                  r.status === "running" ? "border-line bg-surface active:bg-brand-soft" : "border-transparent bg-surface-2"
                }`}
              >
                <span className={`line-clamp-2 pr-6 text-[15px] leading-tight font-semibold ${r.status === "running" ? "text-ink" : "text-ink-2"}`}>{nameOf.get(id) ?? "?"}</span>
                {r.status === "done" && r.elapsedMs !== null ? (
                  <span className="flex items-baseline gap-2">
                    <Time className="text-base font-semibold text-ink">{formatElapsed(r.elapsedMs)}</Time>
                    {r.deltaMs !== null && <Time className={`text-xs ${deltaTone(r.deltaMs)}`}>{deltaText(r.deltaMs)}</Time>}
                  </span>
                ) : r.status === "skipped" ? (
                  <span className="text-xs text-ink-3">skipping</span>
                ) : (
                  r.goalMs !== null && <Time className="text-xs text-ink-3">goal {formatElapsed(r.goalMs, "seconds")}</Time>
                )}
              </button>
              <button type="button" onClick={() => setSheetFor(id)} className="absolute top-1 right-1 rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={`More for ${nameOf.get(id)}`}>
                <MoreHorizontal className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* This rep's (or the last rep's) finishers, in order. */}
      {phase.kind !== "running" && finishedRows.length > 0 && (
        <Card>
          <div className="border-b border-line px-4 py-2 text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{`Rep ${lastIndex + 1}`}</div>
          <div className="divide-y divide-line">
            {finishedRows.map(({ id, r }) => (
              <button key={id} type="button" onClick={() => setSheetFor(id)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate text-ink">{nameOf.get(id) ?? "?"}</span>
                <Time className="font-semibold text-ink">{r.elapsedMs !== null ? formatElapsed(r.elapsedMs) : "—"}</Time>
                <Time className={`w-12 text-right text-[13px] ${r.deltaMs !== null ? deltaTone(r.deltaMs) : "text-ink-3"}`}>{r.deltaMs !== null ? deltaText(r.deltaMs) : ""}</Time>
              </button>
            ))}
            {notRunning.map(({ id, r }) => (
              <button key={id} type="button" onClick={() => setSheetFor(id)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-ink-3 hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate">{nameOf.get(id) ?? "?"}</span>
                <span>{r.status === "skipped" ? "skipped" : "out"}</span>
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

      <div className="flex flex-wrap gap-2">
        {phase.kind !== "done" && notInWorkout.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" />
            Add a runner
          </Button>
        )}
        <LinkButton href={`/workouts/${workoutId}`} variant="secondary" size="sm">
          Results
        </LinkButton>
      </div>

      {sheetFor && sheetRep && (
        <AthleteActions
          name={nameOf.get(sheetFor) ?? "?"}
          rep={sheetRep[phase.kind === "running" ? repIndex : Math.max(0, lastIndex)]}
          repNumber={phase.kind === "running" ? repIndex + 1 : lastIndex + 1}
          next={phase.kind === "done" ? null : { index: repIndex, entry: sheetRep[repIndex] }}
          running={phase.kind === "running"}
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

      <p className="text-center text-xs text-ink-3">{workoutName}</p>
    </div>
  );
}

/** What can happen to one runner mid-workout. */
function AthleteActions({
  name,
  rep,
  repNumber,
  next,
  running,
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
  otherGroups: { id: string; name: string }[];
  onClose: () => void;
  act: (type: "void" | "edit" | "skip" | "stop" | "rejoin" | "move" | "rep_start", extra: { repId?: string; targetEventId?: string; timeMs?: number; groupId?: string }) => void;
  reps: { id: string }[];
}) {
  const [fixing, setFixing] = useState(false);
  const [typed, setTyped] = useState(rep.elapsedMs !== null ? formatElapsed(rep.elapsedMs) : "");
  const typedMs = parseTypedTime(typed);
  const btn = "w-full rounded-md border border-line px-3 py-3 text-left text-sm text-ink hover:bg-surface-2";
  const upId = next ? reps[next.index].id : null;
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
        {fixing && rep.startMs !== null && (
          <div className="space-y-2">
            <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="decimal" className="h-12 font-mono text-xl" aria-label="Rep time" />
            <p className="text-[13px] text-ink-2">{typed.trim() ? (typedMs !== null ? `= ${formatElapsed(typedMs)}` : "Not a time yet") : "Digits are enough: 116 is 1:16, 116.4 is 1:16.4."}</p>
            <Button className="w-full" disabled={typedMs === null} onClick={() => act("edit", { targetEventId: rep.finishEventId!, timeMs: rep.startMs! + typedMs! })}>
              Save {typedMs !== null ? formatElapsed(typedMs) : ""}
            </Button>
          </div>
        )}
        {running && rep.status === "running" && (
          <button type="button" className={btn} onClick={() => act("rep_start", { repId: rep.repId })}>
            Started late: start their clock now
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
    </Sheet>
  );
}

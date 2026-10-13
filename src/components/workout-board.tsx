"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Segmented, Switch, Time } from "@/components/ui";
import { setRepTime, WorkoutAthleteSheet } from "@/components/workout-athlete-sheet";
import { MarkRunnersSheet } from "@/components/workout-mark-sheet";
import { differsFromTap, RepCell, repCellTitle, SHOW_DELTAS_KEY } from "@/components/workout-rep-cell";
import { useLocalValue } from "@/lib/client/use-local-value";
import { groupTint, ON_GOAL_MS, repCellTone } from "@/components/workout-tint";
import { offsetForTap, useClock } from "@/lib/client/clock";
import { useTimeFormat } from "@/lib/client/time-format";
import { useWorkoutEvents } from "@/lib/client/use-workout-events";
import type { Surface, Workout } from "@/lib/db/schema";
import type { LastTime } from "@/lib/workouts";
import { type GroupPhase, type GroupRepLog, replayWorkout, summarize } from "@/lib/workout-replay";
import { formatElapsed, parseDuration } from "@/lib/time";

type Plan = Pick<Workout, "sets" | "groups" | "athletes"> & { finishedAt: string | null };
type Person = { id: string; name: string; gender: "M" | "F" | "X"; level: string };

const signed = (ms: number, digits: 0 | 1) => {
  const v = Math.round(ms / 10 ** (3 - digits)) / 10 ** digits;
  if (v === 0) return "±0";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
};

/**
 * The whole team's workout: athletes × reps, each time coloured against the
 * runner's goal (green under, red over, plain within a second), with average
 * pace, average vs goal, spread and fade. Live while it's being timed.
 */
export function WorkoutBoard({
  workoutId,
  initialPlan,
  people,
  lastTimes,
  surface,
}: {
  workoutId: string;
  initialPlan: Plan;
  people: Person[];
  lastTimes: Record<string, LastTime>;
  surface: Surface;
}) {
  const { events, plan, recording, send } = useWorkoutEvents(workoutId, initialPlan);
  const { ft, team } = useTimeFormat();
  const digits = team === "tenths" ? 1 : 0;
  const clock = useClock();
  const offsetMs = clock.sync?.offsetMs ?? 0;
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now() + offsetForTap()); // the same offset the taps are stamped with
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [offsetMs]);
  const state = useMemo(() => replayWorkout(plan, events), [plan, events]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  // One filter: everyone, a group ("g:<id>"), or girls or boys.
  const [filter, setFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  // Flags on any rep (whatever the filter: they're the whole workout's to-do list), in rep order.
  const toCheck = [...state.athletes.entries()]
    .flatMap(([id, list]) => list.map((r, i) => ({ id, i, r })))
    .filter(({ r }) => r.flag !== null)
    .sort((a, b) => a.i - b.i || (byId.get(a.id)?.name ?? "").localeCompare(byId.get(b.id)?.name ?? ""));
  const differing = [...state.athletes.values()].flat().filter(differsFromTap).length;
  const [marking, setMarking] = useState(false);
  const [deltasPref, setDeltasPref] = useLocalValue(SHOW_DELTAS_KEY);
  const showDeltas = deltasPref !== "off";

  const reps = state.reps;
  const anyTimed = [...state.athletes.values()].some((list) => list.some((r) => r.status === "done"));
  const genders = [...new Set(people.filter((p) => state.athletes.has(p.id)).map((p) => p.gender))];
  const options = [
    { value: "all", label: "Everyone" },
    ...(plan.groups.length > 1 ? plan.groups.map((g) => ({ value: `g:${g.id}`, label: g.name })) : []),
    ...(genders.length > 1 ? [{ value: "F", label: "Girls" }, { value: "M", label: "Boys" }] : []),
  ];

  const rows = [...state.athletes.entries()]
    .filter(([id, list]) => filter === "all" || (filter.startsWith("g:") ? list.some((r) => r.groupId === filter.slice(2)) : byId.get(id)?.gender === filter))
    .map(([id, list]) => ({ id, list, summary: summarize(reps, list), goalMs: list.find((r) => r.goalMs !== null)?.goalMs ?? null }))
    // Fastest on average first; nobody-timed-yet by goal. While typing times in, a fixed order (by goal,
    // then name) instead: re-sorting as each time saved would move "the next runner down" under the cursor.
    .sort((a, b) =>
      entering
        ? (a.goalMs ?? Infinity) - (b.goalMs ?? Infinity) || (byId.get(a.id)?.name ?? "").localeCompare(byId.get(b.id)?.name ?? "")
        : (a.summary.avgPaceMsPerKm ?? Infinity) - (b.summary.avgPaceMsPerKm ?? Infinity) || (a.goalMs ?? Infinity) - (b.goalMs ?? Infinity),
    );

  const paceFor = (msPerKm: number | null) => (msPerKm === null ? "—" : ft((msPerKm * reps[0].meters) / 1000));
  const shownGroups = plan.groups.filter((g) => !filter.startsWith("g:") || filter === `g:${g.id}`);
  // The rest each group took after each rep, as a row under the grid: read down a column for "rep 3, then 1:12 of rest".
  const restRows = shownGroups.map((g) => ({ g, log: new Map((state.groupLog.get(g.id) ?? []).map((l) => [l.repIndex, l])) })).filter(({ log }) => [...log.values()].some((l) => l.restMs !== null));

  return (
    <div className="space-y-3">
      {options.length > 1 && <Segmented value={filter} onChange={setFilter} options={options} scroll />}
      {/* Where each group is right now: the same clocks the timing phones show. Picking a group shows just its clocks. */}
      {/* Once the workout is ended there's nothing live to show: the grid is the summary. */}
      {!plan.finishedAt && (
      <div className={`grid gap-2 ${shownGroups.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {shownGroups.map((g) => (
          <GroupStatus
            key={g.id}
            name={plan.groups.length > 1 ? g.name : "Group"}
            phase={state.groups.get(g.id)!}
            log={state.groupLog.get(g.id) ?? []}
            reps={reps}
            now={now}
            timers={[...new Set(recording.filter((r) => r.groupId === g.id).map((r) => r.name))]}
          />
        ))}
      </div>
      )}
      {/* Times flagged to check: the list to work through after practice. */}
      {toCheck.length > 0 && (
        <Card>
          <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold text-ink">
              <span className="text-gold-text">⚑</span> To check ({toCheck.length})
            </span>
            <span className="text-[12px] text-ink-3">Fix the time if needed, then mark it checked.</span>
          </div>
          <div className="divide-y divide-line">
            {toCheck.map(({ id, i, r }) => (
              <div key={`${id}:${i}`} className="flex items-center gap-3 px-4 py-2 text-sm">
                <button type="button" onClick={() => setOpenId(id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-medium text-ink hover:underline">
                    {byId.get(id)?.name ?? "?"} <span className="font-normal text-ink-2">· rep {i + 1}</span>
                  </span>
                  <span className="block truncate text-[12px] text-ink-3">
                    {[r.flag!.reason ? `${r.flag!.reason[0].toUpperCase()}${r.flag!.reason.slice(1)}` : "Flagged", r.flag!.by].filter(Boolean).join(" · ")}
                  </span>
                </button>
                <Time className="font-semibold text-ink">{r.status === "done" && r.elapsedMs !== null ? ft(r.elapsedMs) : "—"}</Time>
                <Button variant="secondary" size="sm" onClick={() => r.flag!.eventIds.forEach((id) => send({ type: "void", targetEventId: id }))}>
                  Checked
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Typing times in from the paper sheet (or a watch): every cell becomes a box. */}
      <div className="flex items-center justify-end gap-2">
        {entering && (
          <span className="mr-auto text-[13px] text-ink-2">
            Type each time: 45 is 45 s, 116 is 1:16. Enter goes down the column. Typed times win over taps.
            {differing > 0 && <span className="text-gold-text"> {differing} typed time{differing === 1 ? " differs" : "s differ"} from the tap by more than a second (outlined).</span>}
          </span>
        )}
        {!entering && (
          <Button variant="secondary" size="sm" onClick={() => setMarking(true)}>
            Mark runners
          </Button>
        )}
        <Button variant={entering ? "primary" : "secondary"} size="sm" onClick={() => setEntering((e) => !e)}>
          {entering ? "Done entering" : "Enter times"}
        </Button>
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] font-semibold tracking-[0.06em] text-ink-2 uppercase">
                <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-semibold">
                  {/* The +/− switch lives in the corner: it's about the table, and the corner is otherwise empty. */}
                  <span className="flex items-center justify-between gap-3">
                    Athlete
                    <Switch checked={showDeltas} onChange={(on) => setDeltasPref(on ? null : "off")} label="+/−" className="tracking-normal normal-case" />
                  </span>
                </th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">Goal</th>
                {reps.map((r, i) => (
                  <th key={r.id} className={`px-2 py-2 text-right font-semibold whitespace-nowrap ${r.number === 1 && i > 0 ? "border-l border-line" : ""}`}>
                    {reps.some((x) => x.setIndex > 0) ? `${r.setIndex + 1}.${r.number}` : r.number}
                  </th>
                ))}
                <th className="border-l border-line px-2 py-2 text-right font-semibold whitespace-nowrap">Avg / {reps[0].label}</th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">vs goal</th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap" title="Slowest minus fastest, per rep distance">Spread</th>
                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap" title="Second half against the first: + means they slowed">Fade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ id, list, summary, goalMs }, rowIndex) => (
                <tr key={id} data-row={rowIndex} className="border-b border-line last:border-0">
                  <td className="sticky left-0 z-10 bg-surface p-0">
                    <button type="button" onClick={() => setOpenId(id)} className="block w-full px-3 py-1.5 text-left hover:bg-surface-2">
                      <span className="block max-w-36 truncate font-medium text-ink">{byId.get(id)?.name ?? "?"}</span>
                      <span className="block text-[11px] text-ink-3">{plan.groups.length > 1 ? (plan.groups.find((g) => g.id === list.at(-1)?.groupId)?.name ?? "") : byId.get(id)?.level}</span>
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Time className="text-ink-2">{goalMs !== null ? ft(goalMs, "seconds") : "—"}</Time>
                  </td>
                  {list.map((r, i) => (
                    <td key={r.repId} className={`px-1 py-1 text-right ${reps[i].number === 1 && i > 0 ? "border-l border-line" : ""}`}>
                      {entering && r.status !== "running" ? (
                        <TimeInput
                          cell={`${rowIndex}:${i}`}
                          label={`${byId.get(id)?.name ?? "Runner"}, rep ${i + 1}`}
                          valueMs={r.status === "done" ? r.elapsedMs : null}
                          ft={ft}
                          onSave={(ms) => setRepTime(send, id, r, ms)}
                          onClear={r.typedEventId ? () => send({ type: "void", targetEventId: r.typedEventId! }) : null}
                          mark={differsFromTap(r) ? "differs" : r.flag ? "flagged" : null}
                          hint={repCellTitle(r, ft)}
                        />
                      ) : r.status === "done" && r.elapsedMs !== null ? (
                        <RepCell time={ft(r.elapsedMs)} delta={showDeltas && r.deltaMs !== null ? signed(r.deltaMs, digits) : null} tone={repCellTone(r.deltaMs)} typed={!!r.typedEventId} flagged={!!r.flag} differs={differsFromTap(r)} title={repCellTitle(r, ft)} />
                      ) : r.status === "skipped" ? (
                        <span className="px-1.5 text-xs whitespace-nowrap text-ink-3">skipped</span>
                      ) : r.status === "stopped" ? (
                        <span className="px-1.5 text-xs text-ink-3" title="Done for today">done</span>
                      ) : r.status === "unfinished" ? (
                        <span className="px-1.5 text-xs whitespace-nowrap text-ink-3">no time</span>
                      ) : r.status === "not_run" ? (
                        <span className="px-1.5 text-ink-3" title="The group ended before this rep">—</span>
                      ) : r.status === "running" ? (
                        <span className="px-1.5 text-xs text-gold-text">running</span>
                      ) : (
                        <span className="px-1.5 text-ink-3">·</span>
                      )}
                    </td>
                  ))}
                  <td className="border-l border-line px-2 py-1.5 text-right">
                    <Time className="font-semibold text-ink">{paceFor(summary.avgPaceMsPerKm)}</Time>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Time className={summary.avgDeltaMs === null ? "text-ink-3" : Math.abs(summary.avgDeltaMs) <= ON_GOAL_MS ? "text-ink-2" : summary.avgDeltaMs < 0 ? "text-brand-text" : "text-danger"}>
                      {summary.avgDeltaMs === null ? "—" : signed(summary.avgDeltaMs, digits)}
                    </Time>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Time className="text-ink-2">{summary.spreadMsPerKm === null ? "—" : ((summary.spreadMsPerKm * reps[0].meters) / 1000 / 1000).toFixed(digits)}</Time>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Time className={summary.fadeMsPerKm === null ? "text-ink-3" : summary.fadeMsPerKm > 0 ? "text-danger" : "text-brand-text"}>
                      {summary.fadeMsPerKm === null ? "—" : signed((summary.fadeMsPerKm * reps[0].meters) / 1000, digits)}
                    </Time>
                  </td>
                </tr>
              ))}
            </tbody>
            {restRows.length > 0 && (
              <tfoot>
                {restRows.map(({ g, log }, n) => (
                  <tr key={g.id} className={`bg-surface-2/60 ${n === 0 ? "border-t-2 border-line" : "border-t border-line"}`}>
                    <td className="sticky left-0 z-10 bg-surface-2 px-3 py-1.5">
                      <span className="block font-medium text-ink-2">Rest after</span>
                      {plan.groups.length > 1 && <span className="block text-[11px] text-ink-3">{g.name}</span>}
                    </td>
                    <td />
                    {reps.map((r, i) => {
                      const l = log.get(i);
                      const over = l?.restMs != null && l.plannedRestMs !== null ? l.restMs - l.plannedRestMs : null;
                      return (
                        <td key={r.id} className={`px-2 py-1.5 text-right align-top ${r.number === 1 && i > 0 ? "border-l border-line" : ""}`}>
                          {l?.restMs != null ? (
                            <>
                              <Time className={`block ${over !== null && over > 10_000 ? "text-gold-text" : "text-ink-2"}`}>{formatElapsed(l.restMs, "seconds")}</Time>
                              {over !== null && Math.abs(over) >= 5_000 && (
                                <Time className="block text-[11px] text-ink-3">
                                  {over > 0 ? "+" : "−"}
                                  {Math.abs(over) >= 60_000 ? formatElapsed(Math.abs(over), "seconds") : Math.round(Math.abs(over) / 1000)}
                                </Time>
                              )}
                            </>
                          ) : null}
                        </td>
                      );
                    })}
                    <td colSpan={4} className="border-l border-line" />
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        </div>
      </Card>
      {marking && (
        <MarkRunnersSheet
          reps={reps}
          runners={rows.map(({ id, list }) => ({ id, name: byId.get(id)?.name ?? "?", list })).sort((a, b) => a.name.localeCompare(b.name))}
          // The latest rep anyone has actually run (a done-for-today mark covers every later rep, so it doesn't count).
          initialRepIndex={Math.max(0, ...rows.flatMap(({ list }) => list.map((r, i) => (r.status === "done" || r.status === "running" || r.status === "unfinished" ? i : 0))))}
          onApply={(evs) => evs.forEach((e) => send(e))}
          onClose={() => setMarking(false)}
        />
      )}
      {openId && state.athletes.get(openId) && (
        <WorkoutAthleteSheet
          name={byId.get(openId)?.name ?? "?"}
          groupName={plan.groups.length > 1 ? (plan.groups.find((g) => g.id === state.athletes.get(openId)!.at(-1)?.groupId)?.name ?? null) : null}
          reps={reps}
          list={state.athletes.get(openId)!}
          last={lastTimes[openId] ?? null}
          surface={surface}
          onAddTime={(r, ms) => setRepTime(send, openId, r, ms)}
          onChecked={(r) => r.flag?.eventIds.forEach((id) => send({ type: "void", targetEventId: id }))}
          onClose={() => setOpenId(null)}
        />
      )}
      <p className="text-xs leading-relaxed text-ink-3">
        {anyTimed
          ? `Green is faster than goal, red slower; within a second is on goal. A dotted underline marks a typed time. The small number under each time is how far off goal it was (the +/− switch at the top of the grid turns it off). "Skipped": didn't run that rep. "No time": started it but the group went on before they finished. "Done": done for today. "—": the group ended before that rep. Avg, spread and fade are per ${reps[0].label}, so reps of other distances compare fairly. Spread: slowest minus fastest. Fade: the second half against the first. "Rest after" is the rest each group took, from its last runner in to the next start, with how far off the plan it was; amber is more than 10 s long. Tap a name for that runner's reps.`
          : "Times appear here as the reps are timed."}
      </p>
    </div>
  );
}

/**
 * One group right now: who's timing it, and its clocks, each saying what it times:
 * "Running rep 6 of 12" while it runs; "Resting" between (with the next start);
 * both while someone is still out after an early rest.
 */
function GroupStatus({ name, phase, log, reps, now, timers }: { name: string; phase: GroupPhase; log: GroupRepLog[]; reps: ReturnType<typeof replayWorkout>["reps"]; now: number; timers: string[] }) {
  const sets = reps.some((r) => r.setIndex > 0);
  // Reps count through the whole workout ("rep 5 of 12"); with sets, which set it's in goes alongside.
  const repNo = (i: number) => String(i + 1);
  const setNote = (i: number) => (sets ? <span className="font-normal text-ink-2"> · set {reps[i].setIndex + 1}</span> : null);
  // The rep clock runs while the rep does, and on through the rest while anyone is still out.
  const repStartMs = phase.kind === "running" ? phase.startMs : phase.kind === "rest" && phase.stillOut ? (log.find((l) => l.repIndex === phase.afterRepIndex)?.startMs ?? null) : null;
  const leftMs = phase.kind === "rest" && phase.nextStartMs !== null ? phase.nextStartMs - now : null;
  const pastDue = leftMs !== null && leftMs <= 0;
  // A quiet tint says where the group is: green running, amber resting, red once the next rep is past due,
  // dashed before it starts, grey when done. The words are in the clock labels, not badges.
  const card = groupTint(phase, now);
  const headline =
    phase.kind === "running" ? (
      <>
        Rep {repNo(phase.repIndex)} <span className="font-normal text-ink-2">of {reps.length}</span>
        {setNote(phase.repIndex)}
      </>
    ) : phase.kind === "rest" ? (
      <>
        Between reps {repNo(phase.afterRepIndex)} <span className="font-normal text-ink-2">and</span> {repNo(phase.afterRepIndex + 1)}
      </>
    ) : phase.kind === "done" ? (
      phase.endedEarlyAfter !== null ? (
        <>
          Done after rep {repNo(phase.endedEarlyAfter)} <span className="font-normal text-ink-2">of {reps.length}</span>
        </>
      ) : (
        <>Done: all {reps.length} reps</>
      )
    ) : (
      <>
        Not started <span className="font-normal text-ink-2">· rep 1 is {reps[0].label}</span>
      </>
    );
  return (
    <div className={`rounded-lg border px-4 py-3 shadow-card ${card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-2">{name}</div>
          <div className="mt-0.5 text-lg leading-tight font-semibold text-ink">{headline}</div>
          {phase.kind === "rest" && phase.holdEventId && <div className="text-[13px] text-ink-2">On hold: no countdown</div>}
          {(phase.kind === "running" || phase.kind === "rest") && <div className="mt-1.5 text-[12px] text-ink-3">{timers.length > 0 ? `Timed by ${timers.join(", ")}` : "No one timing right now"}</div>}
        </div>
        <div className="flex shrink-0 gap-5 text-right">
          {repStartMs !== null && <Clock label={phase.kind === "rest" ? `Running, ${phase.stillOut} out` : "Running"} value={formatElapsed(Math.max(0, now - repStartMs))} />}
          {phase.kind === "rest" && (
            <Clock
              label={phase.holdEventId ? "Resting, on hold" : "Resting"}
              value={formatElapsed(Math.max(0, now - phase.restStartedMs)).replace(/\.\d$/, "")}
              tone={pastDue ? "text-danger" : "text-ink"}
              note={leftMs === null ? null : leftMs > 0 ? `next rep in ${formatElapsed(leftMs).replace(/\.\d$/, "")}` : `next rep ${formatElapsed(-leftMs).replace(/\.\d$/, "")} past due`}
              noteTone={pastDue ? "text-danger" : leftMs !== null && leftMs <= 10_000 ? "text-gold-text" : "text-ink-3"}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Clock({ label, value, tone = "text-ink", note = null, noteTone = "text-ink-3" }: { label: string; value: string; tone?: string; note?: string | null; noteTone?: string }) {
  return (
    <div>
      <div className="text-[12px] font-medium text-ink-2 first-letter:uppercase">{label}</div>
      <Time className={`block text-2xl leading-tight font-semibold tracking-tight ${tone}`}>{value}</Time>
      {note && <span className={`block text-[11px] ${noteTone}`}>{note}</span>}
    </div>
  );
}

/**
 * One cell of the grid in Enter times mode: type a time, Enter (or leaving the box) saves it and
 * Enter moves down to the next runner on the same rep, the way a paper sheet is read. Clearing a
 * typed time takes it back out; a tapped time can't be cleared here (the box puts it back).
 * While the box has focus it keeps what's being typed, whatever the other phones send meanwhile.
 */
function TimeInput({
  cell,
  label,
  valueMs,
  ft,
  onSave,
  onClear,
  mark,
  hint,
}: {
  cell: string;
  label: string;
  valueMs: number | null;
  ft: (ms: number) => string;
  onSave: (ms: number) => void;
  onClear: (() => void) | null;
  /** Worth a second look while entering: flagged at practice, or the paper disagrees with the tap. */
  mark: "flagged" | "differs" | null;
  hint?: string;
}) {
  const shown = valueMs !== null ? ft(valueMs) : "";
  const [draft, setDraft] = useState<string | null>(null); // null: not editing, show the saved time
  const text = draft ?? shown;
  const bad = text.trim() !== "" && parseDuration(text) === null;
  // Saves what's in the box at that moment (read from the box itself: a quick "type, Enter" can land
  // before the typing has re-rendered, and the draft from the last render would be stale).
  const commit = (value: string) => {
    if (draft === null) return;
    setDraft(null);
    if (!value.trim()) {
      if (valueMs !== null && onClear) onClear();
      return;
    }
    const parsed = parseDuration(value);
    if (parsed !== null && (valueMs === null || ft(parsed) !== ft(valueMs))) onSave(parsed);
  };
  return (
    <input
      data-cell={cell}
      value={text}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        setDraft(shown);
        e.target.select();
      }}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        // The next box down on this rep, skipping rows with none (a runner still running it).
        const [row, col] = cell.split(":").map(Number);
        let next: HTMLInputElement | null = null;
        for (let r = row + 1; r < row + 200 && !next; r++) {
          next = document.querySelector<HTMLInputElement>(`[data-cell="${r}:${col}"]`);
          if (!next && !document.querySelector(`[data-row="${r}"]`)) break;
        }
        if (next) next.focus();
        else e.currentTarget.blur();
      }}
      inputMode="decimal"
      aria-label={`${label} time`}
      aria-invalid={bad}
      title={hint}
      className={`h-8 w-16 rounded border px-1.5 text-right font-mono text-[13px] text-ink outline-none focus:border-brand ${
        bad ? "border-danger bg-surface" : mark ? "border-gold bg-gold-soft" : "border-line-strong bg-surface"
      }`}
    />
  );
}

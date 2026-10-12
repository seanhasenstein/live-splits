"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, LiveDot, Segmented, Time } from "@/components/ui";
import { useClock } from "@/lib/client/clock";
import { useTimeFormat } from "@/lib/client/time-format";
import { useWorkoutEvents } from "@/lib/client/use-workout-events";
import type { Workout } from "@/lib/db/schema";
import { describeRest } from "@/lib/workout-plan";
import { type GroupPhase, type GroupRepLog, replayWorkout, summarize } from "@/lib/workout-replay";
import { formatElapsed } from "@/lib/time";

type Plan = Pick<Workout, "sets" | "groups" | "athletes"> & { finishedAt: string | null };
type Person = { id: string; name: string; gender: "M" | "F" | "X"; level: string };

/** Within this of the goal counts as on it: a tap is good to a few tenths, and a coach reads ±1 s as "right on". */
const ON_GOAL_MS = 1000;

const cellTone = (delta: number | null) =>
  delta === null ? "text-ink" : Math.abs(delta) <= ON_GOAL_MS ? "text-ink" : delta < 0 ? "bg-brand-soft text-brand-text" : "bg-danger-soft text-danger";

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
export function WorkoutBoard({ workoutId, initialPlan, people }: { workoutId: string; initialPlan: Plan; people: Person[] }) {
  const { events, plan } = useWorkoutEvents(workoutId, initialPlan);
  const { ft, team } = useTimeFormat();
  const digits = team === "tenths" ? 1 : 0;
  const clock = useClock();
  const offsetMs = clock.sync?.offsetMs ?? 0;
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now() + offsetMs);
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [offsetMs]);
  const state = useMemo(() => replayWorkout(plan, events), [plan, events]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const [filter, setFilter] = useState<string>("all");

  const reps = state.reps;
  const anyTimed = [...state.athletes.values()].some((list) => list.some((r) => r.status === "done"));
  const groupFilters = plan.groups.length > 1 ? plan.groups.map((g) => ({ value: `g:${g.id}`, label: g.name })) : [];
  const genders = [...new Set(people.filter((p) => state.athletes.has(p.id)).map((p) => p.gender))];
  const options = [{ value: "all", label: "Everyone" }, ...groupFilters, ...(genders.length > 1 ? [{ value: "F", label: "Girls" }, { value: "M", label: "Boys" }] : [])];

  const rows = [...state.athletes.entries()]
    .filter(([id, list]) => {
      if (filter === "all") return true;
      if (filter.startsWith("g:")) return list.some((r) => r.groupId === filter.slice(2));
      return byId.get(id)?.gender === filter;
    })
    .map(([id, list]) => ({ id, list, summary: summarize(reps, list), goalMs: list.find((r) => r.goalMs !== null)?.goalMs ?? null }))
    // Fastest on average first; nobody-timed-yet by goal.
    .sort((a, b) => (a.summary.avgPaceMsPerKm ?? Infinity) - (b.summary.avgPaceMsPerKm ?? Infinity) || (a.goalMs ?? Infinity) - (b.goalMs ?? Infinity));

  const paceFor = (msPerKm: number | null) => (msPerKm === null ? "—" : ft((msPerKm * reps[0].meters) / 1000));

  return (
    <div className="space-y-3">
      {options.length > 1 && <Segmented value={filter} onChange={setFilter} options={options} />}
      {/* Where each group is right now: the same clocks the timing phones show. Picking a group shows just its clocks. */}
      <div className="grid gap-2 sm:grid-cols-2">
        {plan.groups
          .filter((g) => !filter.startsWith("g:") || filter === `g:${g.id}`)
          .map((g) => (
            <GroupStatus key={g.id} name={plan.groups.length > 1 ? g.name : "Group"} phase={state.groups.get(g.id)!} log={state.groupLog.get(g.id) ?? []} reps={reps} now={now} />
          ))}
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] font-semibold tracking-[0.06em] text-ink-2 uppercase">
                <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-semibold">Athlete</th>
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
              {rows.map(({ id, list, summary, goalMs }) => (
                <tr key={id} className="border-b border-line last:border-0">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-1.5">
                    <div className="max-w-36 truncate font-medium text-ink">{byId.get(id)?.name ?? "?"}</div>
                    <div className="text-[11px] text-ink-3">{plan.groups.length > 1 ? (plan.groups.find((g) => g.id === list.at(-1)?.groupId)?.name ?? "") : byId.get(id)?.level}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Time className="text-ink-2">{goalMs !== null ? ft(goalMs, "seconds") : "—"}</Time>
                  </td>
                  {list.map((r, i) => (
                    <td key={r.repId} className={`px-1 py-1 text-right ${reps[i].number === 1 && i > 0 ? "border-l border-line" : ""}`}>
                      {r.status === "done" && r.elapsedMs !== null ? (
                        <Time className={`inline-block rounded px-1.5 py-0.5 ${cellTone(r.deltaMs)}`}>{ft(r.elapsedMs)}</Time>
                      ) : r.status === "skipped" ? (
                        <span className="px-1.5 text-xs whitespace-nowrap text-ink-3">skipped</span>
                      ) : r.status === "stopped" ? (
                        <span className="px-1.5 text-xs text-ink-3" title="Done for today">done</span>
                      ) : r.status === "unfinished" ? (
                        <span className="px-1.5 text-xs whitespace-nowrap text-ink-3">no time</span>
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
          </table>
        </div>
      </Card>
      <p className="text-xs leading-relaxed text-ink-3">
        {anyTimed
          ? `Green is faster than goal, red slower; within a second is on goal. "Skipped": didn't run that rep. "No time": started it but the group went on before they finished. "Done": done for today. Avg, spread and fade are per ${reps[0].label}, so reps of other distances compare fairly. Spread: slowest minus fastest. Fade: the second half against the first. A rest shown in amber ran more than 10 s past the plan.`
          : "Times appear here as the reps are timed."}
      </p>
    </div>
  );
}

/** "Rep 3 of 12 · 0:45.2" while it runs; "Resting · next in 0:23" between; and the rests actually taken. */
function GroupStatus({ name, phase, log, reps, now }: { name: string; phase: GroupPhase; log: GroupRepLog[]; reps: ReturnType<typeof replayWorkout>["reps"]; now: number }) {
  const label = (i: number) => (reps.some((r) => r.setIndex > 0) ? `Set ${reps[i].setIndex + 1} · rep ${reps[i].number}` : `Rep ${reps[i].number} of ${reps[i].setSize}`);
  const rests = log.filter((l) => l.restMs !== null);
  // The rep clock runs while the rep does, and on through the rest while anyone is still out.
  const repStartMs = phase.kind === "running" ? phase.startMs : phase.kind === "rest" && phase.stillOut ? (log.find((l) => l.repIndex === phase.afterRepIndex)?.startMs ?? null) : null;
  const repNo = phase.kind === "running" ? phase.repIndex + 1 : phase.kind === "rest" ? phase.afterRepIndex + 1 : 0;
  return (
    <Card className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            {phase.kind === "running" && <LiveDot />}
            {name}
          </div>
          <div className="text-[13px] text-ink-2">
            {phase.kind === "before" ? "Not started" : phase.kind === "done" ? "All reps done" : phase.kind === "running" ? `${label(phase.repIndex)} · running` : `Resting after ${label(phase.afterRepIndex).toLowerCase()}${phase.rest ? ` · ${describeRest(phase.rest)}` : ""}`}
          </div>
        </div>
        <div className="flex shrink-0 gap-4 text-right">
          {/* Every clock says what it's timing, so a number on its own is never a guess. */}
          {repStartMs !== null && <Clock label={`Rep ${repNo}`} value={formatElapsed(Math.max(0, now - repStartMs))} />}
          {phase.kind === "rest" && (
            <Clock
              label="Rest"
              value={formatElapsed(Math.max(0, now - phase.restStartedMs)).replace(/\.\d$/, "")}
              tone={phase.nextStartMs !== null && now > phase.nextStartMs ? "text-danger" : "text-ink"}
              note={
                phase.nextStartMs === null
                  ? null
                  : now < phase.nextStartMs
                    ? `next in ${formatElapsed(phase.nextStartMs - now).replace(/\.\d$/, "")}`
                    : `${formatElapsed(now - phase.nextStartMs).replace(/\.\d$/, "")} over`
              }
            />
          )}
        </div>
      </div>
      {rests.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 border-t border-line pt-2 text-[12px] text-ink-2">
          <span className="text-ink-3">Rests</span>
          {rests.map((l) => {
            const over = l.plannedRestMs !== null ? l.restMs! - l.plannedRestMs : null;
            return (
              <Time key={l.repIndex} className={over !== null && over > 10_000 ? "text-gold-text" : ""}>
                {formatElapsed(l.restMs!, "seconds")}
                {over !== null && Math.abs(over) >= 5_000 && ` (${over > 0 ? "+" : "−"}${Math.abs(over) >= 60_000 ? formatElapsed(Math.abs(over), "seconds") : Math.round(Math.abs(over) / 1000)})`}
              </Time>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Clock({ label, value, tone = "text-ink", note = null }: { label: string; value: string; tone?: string; note?: string | null }) {
  return (
    <div>
      <div className="text-[10px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{label}</div>
      <Time className={`block text-2xl leading-tight font-semibold tracking-tight ${tone}`}>{value}</Time>
      {note && <span className="text-[11px] text-ink-3">{note}</span>}
    </div>
  );
}

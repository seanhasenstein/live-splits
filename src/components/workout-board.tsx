"use client";

import { useMemo, useState } from "react";
import { Card, Segmented, Time } from "@/components/ui";
import { useWorkoutEvents } from "@/lib/client/use-workout-events";
import type { Workout } from "@/lib/db/schema";
import { replayWorkout, summarize } from "@/lib/workout-replay";
import { formatElapsed } from "@/lib/time";

type Plan = Pick<Workout, "sets" | "groups" | "athletes"> & { finishedAt: string | null };
type Person = { id: string; name: string; gender: "M" | "F" | "X"; level: string };

/** Within this of the goal counts as on it: a tap is good to a few tenths, and a coach reads ±1 s as "right on". */
const ON_GOAL_MS = 1000;

const cellTone = (delta: number | null) =>
  delta === null ? "text-ink" : Math.abs(delta) <= ON_GOAL_MS ? "text-ink" : delta < 0 ? "bg-brand-soft text-brand-text" : "bg-danger-soft text-danger";

const signed = (ms: number, digits = 1) => {
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

  const paceFor = (msPerKm: number | null) => (msPerKm === null ? "—" : formatElapsed((msPerKm * reps[0].meters) / 1000));

  return (
    <div className="space-y-3">
      {options.length > 1 && <Segmented value={filter} onChange={setFilter} options={options} />}
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
                    <Time className="text-ink-2">{goalMs !== null ? formatElapsed(goalMs, "seconds") : "—"}</Time>
                  </td>
                  {list.map((r, i) => (
                    <td key={r.repId} className={`px-1 py-1 text-right ${reps[i].number === 1 && i > 0 ? "border-l border-line" : ""}`}>
                      {r.status === "done" && r.elapsedMs !== null ? (
                        <Time className={`inline-block rounded px-1.5 py-0.5 ${cellTone(r.deltaMs)}`}>{formatElapsed(r.elapsedMs)}</Time>
                      ) : r.status === "skipped" ? (
                        <span className="px-1.5 text-xs text-ink-3">skip</span>
                      ) : r.status === "stopped" ? (
                        <span className="px-1.5 text-xs text-ink-3">—</span>
                      ) : r.status === "running" ? (
                        <span className="px-1.5 text-xs text-gold-text">out</span>
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
                      {summary.avgDeltaMs === null ? "—" : signed(summary.avgDeltaMs)}
                    </Time>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Time className="text-ink-2">{summary.spreadMsPerKm === null ? "—" : (summary.spreadMsPerKm * reps[0].meters) / 1000 / 1000 < 0.05 ? "0.0" : ((summary.spreadMsPerKm * reps[0].meters) / 1000 / 1000).toFixed(1)}</Time>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Time className={summary.fadeMsPerKm === null ? "text-ink-3" : summary.fadeMsPerKm > 0 ? "text-danger" : "text-brand-text"}>
                      {summary.fadeMsPerKm === null ? "—" : signed((summary.fadeMsPerKm * reps[0].meters) / 1000)}
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
          ? `Green is faster than goal, red slower; within a second is on goal. Avg, spread and fade are per ${reps[0].label}, so reps of other distances compare fairly. Spread: slowest minus fastest. Fade: the second half against the first.`
          : "Times appear here as the reps are timed."}
      </p>
    </div>
  );
}

import type { Precision, Workout } from "@/lib/db/schema";
import { conditionsText, describePlan, describeRest, describeTotal, EFFORT_LABEL, surfaceOf, surfaceText } from "@/lib/workout-plan";
import { type AthleteRep, summarize, type WorkoutState } from "@/lib/workout-replay";
import { formatElapsed, formatLocalDateLong } from "@/lib/time";

/** "+2" / "−1" (or tenths) for a difference; "" when there's none. */
function signed(ms: number | null, precision: Precision): string {
  if (ms === null) return "";
  const digits = precision === "tenths" ? 1 : 0;
  const v = Math.round(ms / 10 ** (3 - digits)) / 10 ** digits;
  return v === 0 ? "0" : `${v > 0 ? "+" : "-"}${Math.abs(v).toFixed(digits)}`;
}

/** A rep's cell: its time, or a word for why there isn't one; blank when it hasn't happened. */
function cell(r: AthleteRep, precision: Precision): string {
  if (r.status === "done" && r.elapsedMs !== null) return formatElapsed(r.elapsedMs, precision);
  if (r.status === "skipped") return "skipped";
  if (r.status === "stopped") return "done for today";
  if (r.status === "unfinished") return "no time";
  if (r.status === "not_run") return "not run";
  return "";
}

/**
 * A workout as a spreadsheet, laid out like the paper sheet: a header that says what it was, one row
 * per runner (goal, each rep, average, vs goal, spread, fade), and the rest each group took.
 */
export function buildWorkoutCsvRows({
  workout,
  state,
  names,
  precision,
}: {
  workout: Pick<Workout, "name" | "date" | "place" | "surface" | "approximateDistances" | "conditions" | "effort" | "sets" | "groups">;
  state: WorkoutState;
  names: Map<string, string>;
  precision: Precision;
}): string[][] {
  const reps = state.reps;
  const base = reps[0];
  const per = (msPerKm: number | null) => (msPerKm === null ? null : (msPerKm * base.meters) / 1000);
  const sets = reps.some((r) => r.setIndex > 0);
  const groupName = new Map(workout.groups.map((g) => [g.id, g.name]));
  const groupOrder = new Map(workout.groups.map((g, i) => [g.id, i]));
  const firstRest = workout.sets[0].reps.length > 1 ? describeRest(workout.sets[0].reps[0].rest) : null;

  const header: string[][] = [
    [workout.name],
    [[formatLocalDateLong(workout.date), workout.place, surfaceText(surfaceOf(workout)), workout.conditions.length ? conditionsText(workout.conditions) : null, EFFORT_LABEL[workout.effort]].filter(Boolean).join(" · ")],
    [[describePlan(workout.sets), firstRest, `${describeTotal(reps.reduce((n, r) => n + r.meters, 0))} total`].filter(Boolean).join(" · ")],
    [`Times in ${precision === "tenths" ? "m:ss.t" : "m:ss (whole seconds)"}. vs goal and fade in seconds (+ slower, - faster); spread is slowest minus fastest. Averages per ${base.label}.`],
    [],
  ];

  const columns = ["Runner", "Group", "Goal", ...reps.map((r, i) => (sets ? `${r.setIndex + 1}.${r.number}` : `Rep ${i + 1}`)), `Avg / ${base.label}`, "vs goal", "Spread", "Fade", "To check"];

  const rows = [...state.athletes.entries()]
    .map(([id, list]) => ({ id, list, summary: summarize(reps, list), group: list.at(-1)?.groupId ?? workout.groups[0].id, goalMs: list.find((r) => r.goalMs !== null)?.goalMs ?? null }))
    // By group, then fastest on average (nobody timed: by goal).
    .sort(
      (a, b) =>
        (groupOrder.get(a.group) ?? 0) - (groupOrder.get(b.group) ?? 0) ||
        (a.summary.avgPaceMsPerKm ?? Infinity) - (b.summary.avgPaceMsPerKm ?? Infinity) ||
        (a.goalMs ?? Infinity) - (b.goalMs ?? Infinity),
    )
    .map(({ id, list, summary, group, goalMs }) => [
      names.get(id) ?? "?",
      groupName.get(group) ?? "",
      goalMs !== null ? formatElapsed(goalMs, "seconds") : "",
      ...list.map((r) => cell(r, precision)),
      per(summary.avgPaceMsPerKm) !== null ? formatElapsed(per(summary.avgPaceMsPerKm)!, precision) : "",
      signed(summary.avgDeltaMs, precision),
      per(summary.spreadMsPerKm) !== null ? (per(summary.spreadMsPerKm)! / 1000).toFixed(precision === "tenths" ? 1 : 0) : "",
      signed(per(summary.fadeMsPerKm), precision),
      // Times flagged at practice and not yet checked: "Rep 3 (guess); Rep 5".
      list
        .map((r, i) => (r.flag ? `Rep ${i + 1}${r.flag.reason ? ` (${r.flag.reason})` : ""}` : null))
        .filter(Boolean)
        .join("; "),
    ]);

  // The rest each group took after each rep, under that rep's column.
  const rests = workout.groups
    .map((g) => ({ g, log: new Map((state.groupLog.get(g.id) ?? []).map((l) => [l.repIndex, l])) }))
    .filter(({ log }) => [...log.values()].some((l) => l.restMs !== null))
    .map(({ g, log }) => ["Rest after", g.name, "", ...reps.map((_, i) => (log.get(i)?.restMs != null ? formatElapsed(log.get(i)!.restMs!, "seconds") : "")), "", "", "", "", ""]);

  return [...header, columns, ...rows, ...(rests.length ? [[], ...rests] : [])];
}

import { z } from "zod";
import { DistanceUnit, Rest, type RepSet, WorkoutEffort, WorkoutGroup } from "@/lib/db/schema";
import { distanceValue } from "@/lib/distance";

/**
 * What the plan form edits: sets as "count × distance" with the rest after
 * each rep and after the set. Expanded into stored reps with stable ids, so a
 * plan edited mid-workout keeps lining up with the events already recorded.
 */
export const PlanSetInput = z.object({
  /** An existing set's id when editing; omitted for a new set. */
  id: z.string().min(1).optional(),
  count: z.int().min(1).max(50),
  value: z.number().positive().max(100_000),
  unit: DistanceUnit,
  rest: Rest,
  restAfter: Rest.nullable(),
});
export type PlanSetInput = z.infer<typeof PlanSetInput>;

export const WorkoutPayload = z.object({
  name: z.string().trim().min(1, "Give the workout a name").max(120),
  date: z.iso.date(),
  place: z.string().trim().max(120).nullable(),
  approximateDistances: z.boolean(),
  effort: WorkoutEffort,
  sets: z.array(PlanSetInput).min(1, "Add at least one set").max(30),
  groups: z.array(WorkoutGroup).min(1).max(12),
  athletes: z
    .array(z.object({ athleteId: z.string().min(1), groupId: z.string().min(1), goalPaceMsPerKm: z.int().positive().max(3_600_000).nullable() }))
    .max(200),
  notes: z.string().trim().max(2000).nullable(),
});
export type WorkoutPayload = z.infer<typeof WorkoutPayload>;

export function expandSets(sets: PlanSetInput[], newId: () => string): RepSet[] {
  return sets.map((s, i) => {
    const id = s.id ?? newId();
    return {
      id,
      reps: Array.from({ length: s.count }, (_, n) => ({ id: `${id}-r${n + 1}`, distance: distanceValue(s.value, s.unit), rest: s.rest })),
      restAfter: i === sets.length - 1 ? null : s.restAfter,
    };
  });
}

/** Back from stored sets to the form: every rep in a set shares distance and rest by construction. */
export function toSetInputs(sets: RepSet[]): PlanSetInput[] {
  return sets.map((s) => ({ id: s.id, count: s.reps.length, value: s.reps[0].distance.value, unit: s.reps[0].distance.unit, rest: s.reps[0].rest, restAfter: s.restAfter }));
}

/** "12 × 400m" / "3 × (4 × 400m)": one line for lists. */
export function describePlan(sets: RepSet[]): string {
  const one = (s: RepSet) => {
    const d = s.reps[0].distance;
    const label = d.unit === "m" ? `${d.value}m` : d.unit === "km" ? `${d.value}K` : `${d.value} ${d.unit}`;
    return s.reps.length === 1 ? label : `${s.reps.length} × ${label}`;
  };
  // Identical sets read as a repeat.
  const same = sets.every((s) => one(s) === one(sets[0]));
  if (sets.length > 1 && same) return `${sets.length} × (${one(sets[0])})`;
  return sets.map(one).join(", ");
}

export const EFFORT_LABEL: Record<WorkoutEffort, string> = {
  vo2: "VO₂ / intervals",
  threshold: "Threshold",
  tempo: "Tempo",
  race: "Race pace",
  custom: "Custom",
};

/** "60 s rest", "on the 3:00", "200m jog", "until go". */
export function describeRest(rest: Rest): string {
  // How coaches say it: "45 s", "90 s", "2 min", "2:30".
  const t = (ms: number) => {
    const s = Math.round(ms / 1000);
    if (s % 60 === 0) return `${s / 60} min`;
    return s < 120 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  if (rest.kind === "time") return `${t(rest.ms)} rest`;
  if (rest.kind === "interval") return `on the ${t(rest.everyMs)}`;
  if (rest.kind === "jog") return `${rest.meters}m jog`;
  return "rest until go";
}

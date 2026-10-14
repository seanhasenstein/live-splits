import { z } from "zod";
import { Condition, DistanceUnit, Rest, type RepSet, Surface, WorkoutEffort, WorkoutGroup } from "@/lib/db/schema";
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
  surface: Surface,
  conditions: z.array(Condition).max(6),
  effort: WorkoutEffort,
  sets: z.array(PlanSetInput).min(1, "Add at least one set").max(30),
  groups: z.array(WorkoutGroup).min(1).max(12),
  athletes: z
    .array(z.object({ athleteId: z.string().min(1), groupId: z.string().min(1), goalPaceMsPerKm: z.int().positive().max(3_600_000).nullable() }))
    .max(200),
  notes: z.string().trim().max(2000).nullable(),
  /** Guest runners for this workout only (no athlete record); ids made on the device, "guest_…". */
  guests: z
    .array(
      z.object({
        id: z.string().regex(/^guest_[A-Za-z0-9]+$/),
        name: z.string().trim().min(1, "Give each guest a name").max(40),
gender: z.enum(["F", "M", "X"]).optional(),
        // Only for a guest added mid-practice (not in `athletes`): their goal lives here.
        goalPaceMsPerKm: z.int().positive().max(3_599_999).nullable().optional(),
      }),
    )
    .max(40)
    .default([]),
  /** The template this was started from, kept on a new workout. */
  templateId: z.string().min(1).nullable().optional(),
  /** Also save (or update) a template with these reps, under the workout's name. */
  saveAsTemplate: z.boolean().optional(),
  /** When editing: the workout's updatedAt the form started from, so a change made meanwhile (a rep added at the track) isn't overwritten. */
  expectedUpdatedAt: z.int().optional(),
}).refine((p) => new Set(p.sets.map((s) => s.id).filter(Boolean)).size === p.sets.filter((s) => s.id).length, "Two sets share an id");
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

/** Total distance of the reps, the way coaches count it: "4,800m", or km past 10K. */
export function describeTotal(meters: number): string {
  const m = Math.round(meters);
  return m < 10_000 ? `${m.toLocaleString("en-US")}m` : `${(m / 1000).toFixed(1)} km`;
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
  if (rest.kind === "time") return rest.from === "first" ? `${t(rest.ms)} rest from the first in` : rest.from === "middle" ? `${t(rest.ms)} rest from the middle in` : `${t(rest.ms)} rest`;
  if (rest.kind === "interval") return `on the ${t(rest.everyMs)}`;
  if (rest.kind === "jog") return `${rest.meters}m jog`;
  return "rest until go";
}

/**
 * One more rep at the end, like the last one (the "one more" a coach springs on
 * the team). The old last rep now rests before it with its own between-reps rest.
 * Ids follow the set's pattern, so the log keeps lining up.
 */
export function addRepAtEnd(sets: RepSet[]): RepSet[] {
  const last = sets[sets.length - 1];
  const tail = last.reps[last.reps.length - 1];
  const taken = new Set(sets.flatMap((s) => s.reps.map((r) => r.id)));
  let n = last.reps.length + 1;
  while (taken.has(`${last.id}-r${n}`)) n++;
  return [...sets.slice(0, -1), { ...last, reps: [...last.reps, { ...tail, id: `${last.id}-r${n}` }] }];
}

/** The plan without its last rep (a set left empty goes too); null when it's the only rep. */
export function dropLastRep(sets: RepSet[]): RepSet[] | null {
  const last = sets[sets.length - 1];
  if (last.reps.length > 1) return [...sets.slice(0, -1), { ...last, reps: last.reps.slice(0, -1) }];
  if (sets.length === 1) return null;
  const rest = sets.slice(0, -1);
  return [...rest.slice(0, -1), { ...rest[rest.length - 1], restAfter: null }];
}

export const SURFACE_LABEL: Record<Surface, string> = { track: "Track", grass: "Grass", road: "Road", trail: "Trail" };
const SURFACE_PHRASE: Record<Surface, string> = { track: "on the track", grass: "on grass", road: "on the road", trail: "on trails" };

/** A workout's surface; older ones only had "approximate distances", which meant grass. */
export const surfaceOf = (w: { surface?: Surface | null; approximateDistances: boolean }): Surface => w.surface ?? (w.approximateDistances ? "grass" : "track");

/** "on the track", "on grass", … */
export const surfaceText = (s: Surface) => SURFACE_PHRASE[s];

export const CONDITION_LABEL: Record<Condition, string> = { hot: "Hot", cold: "Cold", windy: "Windy", rain: "Rain", muddy: "Muddy", hilly: "Hilly" };

/** "hot, windy", always in the same order whatever order they were tagged in. */
export const conditionsText = (c: Condition[]) =>
  Condition.options
    .filter((x) => c.includes(x))
    .map((x) => CONDITION_LABEL[x].toLowerCase())
    .join(", ");

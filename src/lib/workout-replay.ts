import type { Rest, Workout, WorkoutEffort, WorkoutEvent } from "@/lib/db/schema";

/**
 * Replays a workout's event log into what every screen shows: where each
 * group is (running a rep, resting, done), and every athlete's time on every
 * rep against their goal. Pure: the record screen, the team grid and the
 * athlete sheet all read from this, and it's tested without a database.
 *
 * Rules, in the order they're applied:
 * - A void removes the event it points at, whenever it arrives; an edit sets
 *   the time of the event it points at (the latest edit wins).
 * - Group membership: everyone starts in their planned group; a `move` puts an
 *   athlete in another group from that rep on (a late arrival is a move).
 * - `stop` takes an athlete out from that rep on; `rejoin` puts them back.
 * - A rep starts for an athlete at their own `rep_start` (a staggered start)
 *   if there is one, else at their group's.
 * - A finish is a fact: it beats a skip for the same rep. A stop applies to
 *   reps not run.
 */

export type FlatRep = {
  id: string;
  index: number;
  setIndex: number;
  /** 1-based within its set. */
  number: number;
  setSize: number;
  meters: number;
  label: string;
  /** What follows this rep: its own rest, or the set's rest after the last rep of a set. Null after the last rep. */
  restAfter: Rest | null;
};

/** The plan as one ordered list of reps. */
export function flattenPlan(workout: Pick<Workout, "sets">): FlatRep[] {
  const out: FlatRep[] = [];
  workout.sets.forEach((set, setIndex) => {
    set.reps.forEach((rep, i) => {
      const lastInSet = i === set.reps.length - 1;
      const lastOverall = setIndex === workout.sets.length - 1 && lastInSet;
      out.push({
        id: rep.id,
        index: out.length,
        setIndex,
        number: i + 1,
        setSize: set.reps.length,
        meters: rep.distance.meters,
        label: rep.distance.unit === "m" ? `${rep.distance.value}m` : `${rep.distance.value} ${rep.distance.unit}`,
        restAfter: lastOverall ? null : lastInSet ? set.restAfter : rep.rest,
      });
    });
  });
  return out;
}

/**
 * "unfinished": they started it but the group went on to the next rep with no finish for them.
 * "not_run": their group ended before this rep.
 */
export type AthleteRepStatus = "pending" | "running" | "done" | "skipped" | "stopped" | "unfinished" | "not_run";

export type AthleteRep = {
  repId: string;
  status: AthleteRepStatus;
  groupId: string;
  startMs: number | null;
  finishMs: number | null;
  /** finish − start, when both are known and in order. */
  elapsedMs: number | null;
  goalMs: number | null;
  /** elapsed − goal: negative is faster. */
  deltaMs: number | null;
  /** The finish event, for edits and undo. */
  finishEventId: string | null;
  /** Their own start (a late start), when they have one: undo it to go back to the group's clock. */
  ownStartEventId: string | null;
  /** Skipped with the group, then run later on their own ("make-up"). */
  makeUp: boolean;
};

export type GroupPhase =
  | { kind: "before"; nextRepIndex: 0 }
  | { kind: "running"; repIndex: number; startMs: number; startEventId: string | null }
  | {
      kind: "rest";
      afterRepIndex: number;
      restStartedMs: number;
      nextStartMs: number | null;
      rest: Rest | null;
      startEventId: string | null;
      stillOut: number;
      /** The coach put this rest on hold (no countdown); the event, to undo it. */
      holdEventId: string | null;
    }
  | { kind: "done"; endedEarlyAfter: number | null; endEventId: string | null };

/** What a group actually did on each rep it started: when it went, when the rest began, and how long the rest really was. */
export type GroupRepLog = {
  repIndex: number;
  startMs: number;
  /** When the rest after it began: the coach's "start rest", else the last runner in. Null while the rep is still on. */
  restStartMs: number | null;
  /** The next rep's start, once it has one. */
  nextStartMs: number | null;
  /** Rest actually taken: next start − rest start. */
  restMs: number | null;
  /** What the plan said, in ms, for a fixed or on-the-clock rest (an on-the-clock rest is what's left of the interval). */
  plannedRestMs: number | null;
};

export type WorkoutState = {
  reps: FlatRep[];
  /** Per athlete, one entry per rep in plan order. */
  athletes: Map<string, AthleteRep[]>;
  /** Per group: where it is now. */
  groups: Map<string, GroupPhase>;
  /** Per group: each rep it has started, with the rest that followed. */
  groupLog: Map<string, GroupRepLog[]>;
  /** Which group an athlete is in at a rep. */
  groupAt: (athleteId: string, repIndex: number) => string;
};

const timeOf = (e: Pick<WorkoutEvent, "timeMs" | "serverTimeMs">) => e.timeMs ?? e.serverTimeMs;

export function replayWorkout(workout: Pick<Workout, "sets" | "groups" | "athletes">, events: WorkoutEvent[]): WorkoutState {
  const reps = flattenPlan(workout);
  const repIndex = new Map(reps.map((r) => [r.id, r.index]));

  // Voids first, whatever order they arrived in; then edits, latest wins.
  const voided = new Set(events.filter((e) => e.type === "void" && e.targetEventId).map((e) => e.targetEventId!));
  const live = events.filter((e) => e.type !== "void" && !voided.has(e.clientEventId));
  const editedTime = new Map<string, number>();
  for (const e of [...live].filter((e) => e.type === "edit" && e.targetEventId && e.timeMs !== null).sort((a, b) => a.serverTimeMs - b.serverTimeMs)) {
    editedTime.set(e.targetEventId!, e.timeMs!);
  }
  const at = (e: WorkoutEvent) => editedTime.get(e.clientEventId) ?? timeOf(e);
  const ordered = live.filter((e) => e.type !== "edit" && (e.repId === null || repIndex.has(e.repId))).sort((a, b) => a.serverTimeMs - b.serverTimeMs);
  const repOf = (e: WorkoutEvent) => (e.repId ? repIndex.get(e.repId)! : -1);

  // Group membership by rep: the planned group, then moves in rep order (ties: the later move wins).
  const planned = new Map(workout.athletes.map((a) => [a.athleteId, a.groupId]));
  const moves = ordered.filter((e) => e.type === "move" && e.athleteId && e.groupId).sort((a, b) => repOf(a) - repOf(b) || a.serverTimeMs - b.serverTimeMs);
  const groupAt = (athleteId: string, ri: number): string => {
    let g = planned.get(athleteId) ?? workout.groups[0].id;
    for (const m of moves) if (m.athleteId === athleteId && repOf(m) <= ri) g = m.groupId!;
    return g;
  };
  // Everyone the log mentions (a late arrival moved in) counts, as well as the planned athletes.
  const athleteIds = [...new Set([...workout.athletes.map((a) => a.athleteId), ...moves.map((m) => m.athleteId!)])];
  const goalPace = new Map(workout.athletes.map((a) => [a.athleteId, a.goalPaceMsPerKm]));
  // A late arrival is only "in" from the rep they were moved in at.
  const joinedAt = new Map<string, number>();
  for (const id of athleteIds) if (!planned.has(id)) joinedAt.set(id, Math.min(...moves.filter((m) => m.athleteId === id).map(repOf)));

  // Starts: the group's latest start for a rep, and any athlete's own.
  const groupStart = new Map<string, number>(); // `${groupId}:${ri}`
  const groupStartEvent = new Map<string, string>();
  const ownStart = new Map<string, number>(); // `${athleteId}:${ri}`
  const ownStartEvent = new Map<string, string>();
  for (const e of ordered.filter((e) => e.type === "rep_start")) {
    if (e.athleteId) {
      ownStart.set(`${e.athleteId}:${repOf(e)}`, at(e));
      ownStartEvent.set(`${e.athleteId}:${repOf(e)}`, e.clientEventId);
    }
    else if (e.groupId) {
      groupStart.set(`${e.groupId}:${repOf(e)}`, at(e));
      groupStartEvent.set(`${e.groupId}:${repOf(e)}`, e.clientEventId);
    }
  }
  const restStart = new Map<string, number>(); // `${groupId}:${ri}`: the coach started the rest early
  for (const e of ordered.filter((e) => e.type === "rest_start" && e.groupId)) restStart.set(`${e.groupId}:${repOf(e)}`, at(e));
  const holds = new Map<string, string>(); // `${groupId}:${ri}` -> event: the rest after it is on hold
  for (const e of ordered.filter((e) => e.type === "hold" && e.groupId)) holds.set(`${e.groupId}:${repOf(e)}`, e.clientEventId);
  const groupEnd = new Map<string, { ri: number; eventId: string }>(); // the group's last rep, when it ended early (latest wins)
  for (const e of ordered.filter((e) => e.type === "group_end" && e.groupId)) groupEnd.set(e.groupId!, { ri: repOf(e), eventId: e.clientEventId });
  // A group's rep counts as over once it has started a later one.
  const lastStarted = new Map<string, number>();
  for (const key of groupStart.keys()) {
    const [g, ri] = [key.slice(0, key.lastIndexOf(":")), Number(key.slice(key.lastIndexOf(":") + 1))];
    lastStarted.set(g, Math.max(lastStarted.get(g) ?? -1, ri));
  }
  const finishes = new Map<string, WorkoutEvent>(); // `${athleteId}:${ri}`, latest
  for (const e of ordered.filter((e) => e.type === "finish" && e.athleteId)) finishes.set(`${e.athleteId}:${repOf(e)}`, e);
  const skipped = new Set<string>(); // `${athleteId}:${ri}` or `group:${groupId}:${ri}`
  for (const e of ordered.filter((e) => e.type === "skip")) {
    if (e.athleteId) skipped.add(`${e.athleteId}:${repOf(e)}`);
    else if (e.groupId) skipped.add(`group:${e.groupId}:${repOf(e)}`);
  }
  const stopEvents = ordered.filter((e) => (e.type === "stop" || e.type === "rejoin") && e.athleteId).sort((a, b) => repOf(a) - repOf(b) || a.serverTimeMs - b.serverTimeMs);
  const stoppedAt = (athleteId: string, ri: number) => {
    let stopped = false;
    for (const e of stopEvents) if (e.athleteId === athleteId && repOf(e) <= ri) stopped = e.type === "stop";
    return stopped;
  };

  const athletes = new Map<string, AthleteRep[]>();
  for (const id of athleteIds) {
    const list: AthleteRep[] = reps.map((rep) => {
      const groupId = groupAt(id, rep.index);
      const startMs = ownStart.get(`${id}:${rep.index}`) ?? groupStart.get(`${groupId}:${rep.index}`) ?? null;
      const fin = finishes.get(`${id}:${rep.index}`);
      const finishMs = fin ? at(fin) : null;
      const elapsedMs = startMs !== null && finishMs !== null && finishMs > startMs ? finishMs - startMs : null;
      const pace = goalPace.get(id) ?? null;
      const goalMs = pace !== null ? Math.round((pace * rep.meters) / 1000) : null;
      const notYetIn = (joinedAt.get(id) ?? 0) > rep.index;
      const wasSkipped = skipped.has(`${id}:${rep.index}`) || skipped.has(`group:${groupId}:${rep.index}`);
      // A make-up: they skipped the rep with the group and ran it later on their own clock.
      const makeUp = wasSkipped && ownStart.has(`${id}:${rep.index}`);
      const status: AthleteRepStatus =
        fin && finishMs !== null
          ? "done"
          : notYetIn || stoppedAt(id, rep.index)
            ? "stopped"
            : makeUp
              ? "running"
              : wasSkipped
              ? "skipped"
              : startMs !== null
                ? (lastStarted.get(groupId) ?? -1) > rep.index
                  ? "unfinished"
                  : "running"
                : (groupEnd.get(groupId)?.ri ?? Infinity) < rep.index
                  ? "not_run"
                  : "pending";
      return {
        repId: rep.id,
        status,
        groupId,
        startMs,
        finishMs,
        elapsedMs,
        goalMs,
        deltaMs: elapsedMs !== null && goalMs !== null ? elapsedMs - goalMs : null,
        finishEventId: fin?.clientEventId ?? null,
        ownStartEventId: ownStartEvent.get(`${id}:${rep.index}`) ?? null,
        makeUp,
      };
    });
    athletes.set(id, list);
  }

  // Where each group is: the last rep it started, and whether everyone in it has come in.
  const groups = new Map<string, GroupPhase>();
  for (const g of workout.groups) {
    const started = reps.filter((r) => groupStart.has(`${g.id}:${r.index}`) || athleteIds.some((id) => groupAt(id, r.index) === g.id && ownStart.has(`${id}:${r.index}`)));
    const current = started.at(-1);
    if (!current) {
      groups.set(g.id, { kind: "before", nextRepIndex: 0 });
      continue;
    }
    const end = groupEnd.get(g.id);
    const endsHere = end?.ri === current.index;
    const members = athleteIds.filter((id) => groupAt(id, current.index) === g.id).map((id) => athletes.get(id)![current.index]);
    const startMs = groupStart.get(`${g.id}:${current.index}`) ?? Math.min(...members.map((m) => m.startMs ?? Infinity));
    const startEventId = groupStartEvent.get(`${g.id}:${current.index}`) ?? null;
    const stillOut = members.filter((m) => m.status === "running" || m.status === "pending").length;
    const earlyRest = restStart.get(`${g.id}:${current.index}`);
    // The last rep (planned, or the coach ended the group here) has no rest after it: it runs until everyone's in.
    if (stillOut > 0 && (earlyRest === undefined || endsHere)) {
      groups.set(g.id, { kind: "running", repIndex: current.index, startMs, startEventId });
      continue;
    }
    if ((current.index === reps.length - 1 || endsHere) && stillOut === 0) {
      groups.set(g.id, { kind: "done", endedEarlyAfter: endsHere && current.index < reps.length - 1 ? current.index : null, endEventId: endsHere ? end!.eventId : null });
      continue;
    }
    const restStartedMs = earlyRest ?? restBegan(members, startMs);
    const rest = current.restAfter;
    const holdEventId = holds.get(`${g.id}:${current.index}`) ?? null;
    const nextStartMs = holdEventId ? null : rest?.kind === "time" ? restStartedMs + rest.ms : rest?.kind === "interval" ? startMs + rest.everyMs : null;
    groups.set(g.id, { kind: "rest", afterRepIndex: current.index, restStartedMs, nextStartMs, rest, startEventId, stillOut, holdEventId });
  }

  // The rests a group actually took, rep by rep.
  const groupLog = new Map<string, GroupRepLog[]>();
  for (const g of workout.groups) {
    const log: GroupRepLog[] = [];
    for (const r of reps) {
      const startMs = groupStart.get(`${g.id}:${r.index}`);
      if (startMs === undefined) continue;
      const members = athleteIds.filter((id) => groupAt(id, r.index) === g.id).map((id) => athletes.get(id)![r.index]);
      const allIn = members.every((m) => m.status !== "running" && m.status !== "pending");
      const early = restStart.get(`${g.id}:${r.index}`);
      const restStartMs = early ?? (allIn || (lastStarted.get(g.id) ?? -1) > r.index ? restBegan(members, startMs) : null);
      const next = reps[r.index + 1] ? groupStart.get(`${g.id}:${r.index + 1}`) : undefined;
      const rest = r.restAfter;
      // A rest on hold had no plan to keep to.
      const plannedRestMs = holds.has(`${g.id}:${r.index}`) ? null : rest?.kind === "time" ? rest.ms : rest?.kind === "interval" && restStartMs !== null ? Math.max(0, startMs + rest.everyMs - restStartMs) : null;
      log.push({
        repIndex: r.index,
        startMs,
        restStartMs,
        nextStartMs: next ?? null,
        restMs: next !== undefined && restStartMs !== null ? next - restStartMs : null,
        plannedRestMs,
      });
    }
    groupLog.set(g.id, log);
  }

  return { reps, athletes, groups, groupAt, groupLog };
}

/** The rest begins when the last runner comes in (the group's rep is over then), else at the start when nobody ran. */
function restBegan(members: AthleteRep[], startMs: number): number {
  const finished = members.map((m) => m.finishMs).filter((v): v is number => v !== null);
  return finished.length ? Math.max(...finished) : startMs;
}

export type AthleteSummary = {
  done: number;
  /** Average pace over the reps run, ms per km. */
  avgPaceMsPerKm: number | null;
  /** Average of (elapsed − goal) over reps with a goal. */
  avgDeltaMs: number | null;
  /** Slowest pace minus fastest, ms per km: how even the reps were. */
  spreadMsPerKm: number | null;
  /** Average pace of the second half of the reps run minus the first half: positive means they slowed. */
  fadeMsPerKm: number | null;
};

export function summarize(reps: FlatRep[], list: AthleteRep[]): AthleteSummary {
  const run = list.map((r, i) => ({ r, meters: reps[i].meters })).filter(({ r }) => r.status === "done" && r.elapsedMs !== null);
  if (run.length === 0) return { done: 0, avgPaceMsPerKm: null, avgDeltaMs: null, spreadMsPerKm: null, fadeMsPerKm: null };
  const paces = run.map(({ r, meters }) => (r.elapsedMs! * 1000) / meters);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const deltas = run.map(({ r }) => r.deltaMs).filter((d): d is number => d !== null);
  const half = Math.floor(paces.length / 2);
  return {
    done: run.length,
    avgPaceMsPerKm: Math.round(avg(paces)),
    avgDeltaMs: deltas.length ? Math.round(avg(deltas)) : null,
    spreadMsPerKm: paces.length > 1 ? Math.round(Math.max(...paces) - Math.min(...paces)) : null,
    fadeMsPerKm: half > 0 ? Math.round(avg(paces.slice(paces.length - half)) - avg(paces.slice(0, half))) : null,
  };
}

/**
 * A starting goal pace from a runner's 5K, by what the workout is for, before
 * the coach adjusts it: VO₂ reps a little faster than 5K pace, threshold and
 * tempo slower, race pace at it. Rough rules of thumb, meant to be edited.
 */
export const EFFORT_FACTOR: Record<Exclude<WorkoutEffort, "custom">, number> = {
  vo2: 0.96,
  race: 1.0,
  threshold: 1.07,
  tempo: 1.12,
};

export function goalPaceFrom5K(fiveKMs: number, effort: WorkoutEffort): number | null {
  if (effort === "custom") return null;
  return Math.round((fiveKMs / 5) * EFFORT_FACTOR[effort]);
}

import type { AthleteRaceStatus, Race, TapType } from "@/lib/db/schema";

/**
 * Replays a race's tap log into the state the screens show. Pure: works on
 * server taps and on taps still sitting in a device's outbox.
 */

/** The fields replay needs; server taps and outbox taps both have them. */
export type TapLike = {
  clientTapId: string;
  type: TapType;
  checkpointId: string | null;
  athleteId: string | null;
  targetTapId: string | null;
  serverTimeMs: number;
  timeMs: number | null;
  estimate: boolean;
  missed: boolean;
  status?: AthleteRaceStatus | null;
  createdBy?: { name: string };
};

export type AthleteStatus = {
  tapId: string;
  status: AthleteRaceStatus;
  /** dnf: the last checkpoint they passed, when known. */
  afterCheckpointId: string | null;
  by: string | null;
};

export type Mark = {
  /** clientTapId of the tap that created this mark (name_tap, assign, or a missed edit). */
  tapId: string;
  checkpointId: string;
  athleteId: string;
  /** Null when missed. */
  timeMs: number | null;
  estimate: boolean;
  missed: boolean;
  edited: boolean;
  voided: boolean;
  /** When this mark was last given to its athlete; the newest wins per athlete. */
  assignedAt: number;
  fromSlotId: string | null;
  by: string | null;
};

export type Slot = {
  tapId: string;
  checkpointId: string;
  timeMs: number;
  voided: boolean;
  by: string | null;
};

export type SlotWithNames = Slot & {
  /** Athletes currently assigned to this capture (a pack can share one). */
  athleteIds: string[];
};

export type CheckpointState = {
  /** Unassigned capture slots, oldest first. */
  pending: Slot[];
  /** Every live capture slot at this checkpoint, oldest first, with who's on it. */
  slots: SlotWithNames[];
  /** Each athlete's current mark at this checkpoint. */
  byAthlete: Map<string, Mark>;
};

export type RaceState = Map<string, CheckpointState>;

/** Event order: the (corrected) moment of the action, then id for determinism. */
export function sortTaps<T extends TapLike>(taps: T[]): T[] {
  return [...taps].sort((a, b) => a.serverTimeMs - b.serverTimeMs || a.clientTapId.localeCompare(b.clientTapId));
}

export function replay(race: Pick<Race, "checkpoints">, taps: TapLike[]): RaceState {
  const marks = new Map<string, Mark>();
  const slots = new Map<string, Slot>();

  // A clock resync can order an undo/assign/edit a few ms before the tap it points at.
  // Events whose target hasn't been seen yet are retried after everything else.
  const sorted = sortTaps(taps);
  const deferred: TapLike[] = [];
  const apply = (t: TapLike, canDefer: boolean) => {
    if (t.targetTapId && canDefer && !marks.has(t.targetTapId) && !slots.has(t.targetTapId)) {
      deferred.push(t);
      return;
    }
    applyOne(t);
  };

  for (const t of sorted) apply(t, true);
  for (const t of deferred) apply(t, false);

  return collect(race, marks, slots);

  function applyOne(t: TapLike) {
    const time = t.timeMs ?? t.serverTimeMs;
    const by = t.createdBy?.name ?? null;
    switch (t.type) {
      case "capture":
        if (t.checkpointId) slots.set(t.clientTapId, { tapId: t.clientTapId, checkpointId: t.checkpointId, timeMs: time, voided: false, by });
        break;

      case "name_tap":
        if (t.checkpointId && t.athleteId) {
          marks.set(t.clientTapId, {
            tapId: t.clientTapId,
            checkpointId: t.checkpointId,
            athleteId: t.athleteId,
            timeMs: time,
            estimate: t.estimate,
            missed: false,
            edited: false,
            voided: false,
            assignedAt: t.serverTimeMs,
            fromSlotId: null,
            by,
          });
        }
        break;

      case "assign": {
        const slot = t.targetTapId ? slots.get(t.targetTapId) : undefined;
        if (slot && !slot.voided && t.athleteId) {
          marks.set(t.clientTapId, {
            tapId: t.clientTapId,
            checkpointId: slot.checkpointId,
            athleteId: t.athleteId,
            timeMs: slot.timeMs,
            estimate: t.estimate,
            missed: false,
            edited: false,
            voided: false,
            assignedAt: t.serverTimeMs,
            fromSlotId: slot.tapId,
            by,
          });
        }
        break;
      }

      case "edit": {
        const m = t.targetTapId ? marks.get(t.targetTapId) : undefined;
        if (m) {
          if (t.athleteId && t.athleteId !== m.athleteId) {
            m.athleteId = t.athleteId;
            m.assignedAt = t.serverTimeMs;
            m.edited = true;
          }
          if (t.timeMs !== null) {
            m.timeMs = t.timeMs;
            m.missed = false;
            m.edited = true;
          }
          if (t.estimate) m.estimate = true;
          if (t.missed) {
            m.missed = true;
            m.timeMs = null;
            m.edited = true;
          }
        } else if (!t.targetTapId && t.missed && t.checkpointId && t.athleteId) {
          marks.set(t.clientTapId, {
            tapId: t.clientTapId,
            checkpointId: t.checkpointId,
            athleteId: t.athleteId,
            timeMs: null,
            estimate: false,
            missed: true,
            edited: false,
            voided: false,
            assignedAt: t.serverTimeMs,
            fromSlotId: null,
            by,
          });
        }
        break;
      }

      case "void": {
        if (!t.targetTapId) break;
        const m = marks.get(t.targetTapId);
        if (m) m.voided = true;
        const s = slots.get(t.targetTapId);
        if (s) {
          s.voided = true;
          for (const mark of marks.values()) if (mark.fromSlotId === s.tapId) mark.voided = true;
        }
        break;
      }

      default:
        break; // gun and tick don't affect checkpoint state
    }
  }
}

function collect(race: Pick<Race, "checkpoints">, marks: Map<string, Mark>, slots: Map<string, Slot>): RaceState {
  const state: RaceState = new Map(race.checkpoints.map((c) => [c.id, { pending: [], slots: [], byAthlete: new Map() }]));
  for (const m of marks.values()) {
    if (m.voided) continue;
    const cp = state.get(m.checkpointId);
    if (!cp) continue;
    const current = cp.byAthlete.get(m.athleteId);
    if (!current || m.assignedAt > current.assignedAt) cp.byAthlete.set(m.athleteId, m);
  }
  // A slot's names are the athletes whose *current* mark came from it.
  const namesBySlot = new Map<string, string[]>();
  for (const cp of state.values()) {
    for (const m of cp.byAthlete.values()) {
      if (m.fromSlotId) namesBySlot.set(m.fromSlotId, [...(namesBySlot.get(m.fromSlotId) ?? []), m.athleteId]);
    }
  }
  for (const s of slots.values()) {
    if (s.voided) continue;
    const cp = state.get(s.checkpointId);
    if (!cp) continue;
    const athleteIds = namesBySlot.get(s.tapId) ?? [];
    cp.slots.push({ ...s, athleteIds });
    if (athleteIds.length === 0) cp.pending.push(s);
  }
  for (const cp of state.values()) {
    cp.pending.sort((a, b) => a.timeMs - b.timeMs);
    cp.slots.sort((a, b) => a.timeMs - b.timeMs);
  }
  return state;
}

/**
 * Each athlete's race status (DNS / DNR / DNF) from the log: the newest status
 * tap wins, and voiding it clears the status. Kept apart from the checkpoint
 * replay because a status belongs to the athlete, not a checkpoint.
 */
export function replayStatuses(taps: TapLike[]): Map<string, AthleteStatus> {
  // Newest status tap per athlete first; then voids, whatever order a clock resync put them in.
  const out = new Map<string, AthleteStatus & { at: number }>();
  for (const t of sortTaps(taps)) {
    if (t.type === "status" && t.athleteId && t.status) {
      out.set(t.athleteId, { tapId: t.clientTapId, status: t.status, afterCheckpointId: t.checkpointId, by: t.createdBy?.name ?? null, at: t.serverTimeMs });
    }
  }
  const voided = new Set(taps.filter((t) => t.type === "void" && t.targetTapId).map((t) => t.targetTapId!));
  // Clearing the current status puts them back in the race; an older one doesn't come back.
  for (const [athleteId, s] of out) if (voided.has(s.tapId)) out.delete(athleteId);
  return new Map([...out].map(([id, s]) => [id, { tapId: s.tapId, status: s.status, afterCheckpointId: s.afterCheckpointId, by: s.by }]));
}

/** Whether an athlete with this status is still expected at checkpoint `cpIndex`. */
export function expectedAt(status: AthleteStatus | undefined, cpIndex: number, checkpoints: { id: string }[]): boolean {
  if (!status) return true;
  if (status.status !== "dnf") return false;
  const after = status.afterCheckpointId ? checkpoints.findIndex((c) => c.id === status.afterCheckpointId) : -1;
  return cpIndex <= after;
}

export const STATUS_LABEL: Record<AthleteRaceStatus, string> = { dns: "DNS", dnr: "DNR", dnf: "DNF" };
export const STATUS_LONG: Record<AthleteRaceStatus, string> = { dns: "Did not start", dnr: "Did not run", dnf: "Did not finish" };

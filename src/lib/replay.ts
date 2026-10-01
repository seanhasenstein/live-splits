import type { Race, TapType } from "@/lib/db/schema";

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
  createdBy?: { name: string };
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

export type CheckpointState = {
  /** Unassigned capture slots, oldest first. */
  pending: Slot[];
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

  for (const t of sortTaps(taps)) {
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

  const state: RaceState = new Map(race.checkpoints.map((c) => [c.id, { pending: [], byAthlete: new Map() }]));
  const assignedSlots = new Set<string>();
  for (const m of marks.values()) {
    if (m.voided) continue;
    if (m.fromSlotId) assignedSlots.add(m.fromSlotId);
    const cp = state.get(m.checkpointId);
    if (!cp) continue;
    const current = cp.byAthlete.get(m.athleteId);
    if (!current || m.assignedAt > current.assignedAt) cp.byAthlete.set(m.athleteId, m);
  }
  for (const s of slots.values()) {
    if (s.voided || assignedSlots.has(s.tapId)) continue;
    state.get(s.checkpointId)?.pending.push(s);
  }
  for (const cp of state.values()) cp.pending.sort((a, b) => a.timeMs - b.timeMs);
  return state;
}

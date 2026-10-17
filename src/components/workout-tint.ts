import type { GroupPhase } from "@/lib/workout-replay";

/**
 * A group's state as a quiet card tint, the same on the workout page and the
 * record screen: green running, amber resting, red once the next rep is past
 * due, plain on hold, dashed before it starts, grey when done.
 */
export function groupTint(phase: GroupPhase, now: number): string {
  if (phase.kind === "running") return "border-brand/20 bg-brand-soft/30";
  if (phase.kind === "rest") {
    if (phase.holdEventId) return "border-line bg-surface";
    return phase.nextStartMs !== null && now >= phase.nextStartMs ? "border-danger/25 bg-danger-soft/40" : "border-gold/25 bg-gold-soft/30";
  }
  if (phase.kind === "done") return "border-line bg-surface-2";
  return "border-dashed border-line-strong bg-surface";
}

/** Within this of the goal counts as on it: a tap is good to a few tenths, and a coach reads ±1 s as "right on". */
export const ON_GOAL_MS = 1000;

/** A rep time's cell against the runner's goal: green under, red over, plain within a second. */
export const repCellTone = (delta: number | null) =>
  delta === null ? "text-ink" : Math.abs(delta) <= ON_GOAL_MS ? "text-ink" : delta < 0 ? "bg-brand-soft text-brand-text" : "bg-danger-soft text-danger";

/** How long the status card flashes when the countdown passes 10 s to go, and Go. */
export const FLASH_MS = 700;

/** "soon" just after 10 s to go, "go" just after the next rep is due, else null. */
export function countdownFlash(nextStartMs: number | null, now: number): "soon" | "go" | null {
  if (nextStartMs === null) return null;
  if (now >= nextStartMs && now < nextStartMs + FLASH_MS) return "go";
  if (now >= nextStartMs - 10_000 && now < nextStartMs - 10_000 + FLASH_MS) return "soon";
  return null;
}

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

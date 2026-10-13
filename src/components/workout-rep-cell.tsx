import { Time } from "@/components/ui";
import type { AthleteRep } from "@/lib/workout-replay";

/** A typed time more than a second off the tap underneath it: the paper and the phone disagree. */
export const differsFromTap = (r: AthleteRep) => r.typedEventId !== null && r.tappedElapsedMs !== null && r.elapsedMs !== null && Math.abs(r.elapsedMs - r.tappedElapsedMs) > 1000;

/** What a rep cell says on hover/long-press: typed, the tap it overrode, a flag. */
export function repCellTitle(r: AthleteRep, ft: (ms: number) => string): string | undefined {
  const bits = [
    r.typedEventId ? (r.tappedElapsedMs !== null ? `Typed in (tapped ${ft(r.tappedElapsedMs)})` : "Typed in") : null,
    r.flag ? `Flagged to check${r.flag.reason ? `: ${r.flag.reason}` : ""} (${r.flag.by})` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : undefined;
}

/**
 * A rep's time with its +/− underneath: the colour says faster or slower, the number says by how much.
 * Typed times are dotted-underlined; a ⚑ marks one flagged to check; an amber outline, a typed time that
 * disagrees with its tap by more than a second (the paper cross-check).
 */
export function RepCell({
  time,
  delta,
  tone,
  typed = false,
  flagged = false,
  differs = false,
  title,
}: {
  time: string;
  delta: string | null;
  tone: string;
  typed?: boolean;
  flagged?: boolean;
  differs?: boolean;
  title?: string;
}) {
  return (
    <span className={`inline-flex flex-col items-end rounded px-1.5 py-0.5 leading-tight ${tone} ${differs ? "outline-2 outline-gold" : ""}`} title={title}>
      <Time className={`text-[13px] ${typed ? "underline decoration-dotted underline-offset-2" : ""}`}>
        {flagged && <span className="mr-0.5 text-gold-text">⚑</span>}
        {time}
      </Time>
      {delta !== null && <Time className="text-[10px] opacity-75">{delta}</Time>}
    </span>
  );
}

/** The +/− under each time, on or off, remembered on this phone; one switch for the record screen and the workout page. On unless turned off. */
export const SHOW_DELTAS_KEY = "ls_workout_deltas";

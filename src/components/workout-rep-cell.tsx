import { Time } from "@/components/ui";

/** A rep's time with its +/− underneath: the colour says faster or slower, the number says by how much. */
export function RepCell({ time, delta, tone, typed = false }: { time: string; delta: string | null; tone: string; typed?: boolean }) {
  return (
    <span className={`inline-flex flex-col items-end rounded px-1.5 py-0.5 leading-tight ${tone}`} title={typed ? "Typed in" : undefined}>
      {/* A typed time (from a watch or paper) is dotted-underlined, so it's told apart from a tap. */}
      <Time className={`text-[13px] ${typed ? "underline decoration-dotted underline-offset-2" : ""}`}>{time}</Time>
      {delta !== null && <Time className="text-[10px] opacity-75">{delta}</Time>}
    </span>
  );
}

/** The +/− under each time, on or off, remembered on this phone; one switch for the record screen and the workout page. On unless turned off. */
export const SHOW_DELTAS_KEY = "ls_workout_deltas";

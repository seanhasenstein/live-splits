import { Time } from "@/components/ui";

/** A rep's time with its +/− underneath: the colour says faster or slower, the number says by how much. */
export function RepCell({ time, delta, tone }: { time: string; delta: string | null; tone: string }) {
  return (
    <span className={`inline-flex flex-col items-end rounded px-1.5 py-0.5 leading-tight ${tone}`}>
      <Time className="text-[13px]">{time}</Time>
      {delta !== null && <Time className="text-[10px] opacity-75">{delta}</Time>}
    </span>
  );
}

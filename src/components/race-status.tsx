"use client";

import { Check, Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { LiveDot, Stat, Time } from "@/components/ui";
import { formatElapsed } from "@/lib/time";

/**
 * The race's state as a full-width bar: amber not started, red in progress
 * with the running clock, solid green finished. Shared by the board and the
 * record screen.
 */
export function RaceStatusBar({
  name,
  finished,
  gunTimeMs,
  now,
}: {
  /** Race name, shown in the bar when given. */
  name?: string;
  finished: boolean;
  gunTimeMs: number | null;
  now: () => number | null;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (finished || !gunTimeMs) return;
    const t = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, [finished, gunTimeMs]);

  const prefix = name ? <span className="text-sm font-semibold">{name} ·</span> : null;

  if (finished) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-brand-ink sm:justify-start">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-ink/20">
          <Check className="size-3" strokeWidth={3} />
        </span>
        {prefix}
        <span className="text-sm font-semibold">Race finished</span>
      </div>
    );
  }
  if (!gunTimeMs)
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-gold/50 bg-gold-soft px-3 py-2 text-gold-text sm:justify-start">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-gold/30">
          <Flag className="size-3" />
        </span>
        {prefix}
        <span className="text-sm font-semibold">Not started</span>
        <span className="text-sm opacity-80">· waiting for the gun</span>
      </div>
    );
  const n = now();
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-2.5 rounded-lg border border-danger/40 bg-danger-soft px-3 py-1.5 text-danger sm:justify-start">
      <LiveDot className="bg-danger" />
      {prefix}
      <span className="text-sm font-semibold">In progress</span>
      <Time className="text-2xl font-semibold tracking-tight text-ink">{n === null ? "—" : formatElapsed(n - gunTimeMs)}</Time>
    </div>
  );
}

/** Per-checkpoint "recorded / total" strip in the PDFs' stat style. */
export function CheckpointCounts({
  counts,
  total,
  loaded,
  finished,
  activeId,
}: {
  /** n = recorded here; out = not expected here (DNS/DNR/DNF), shown beneath and counted as accounted for. */
  counts: { id: string; label: string; n: number; out?: number }[];
  total: number;
  loaded: boolean;
  finished: boolean;
  /** Highlights the checkpoint being recorded. */
  activeId?: string;
}) {
  return (
    <div className="flex divide-x divide-line rounded-lg border border-line bg-surface shadow-card">
      {counts.map((c) => {
        const out = c.out ?? 0;
        const accounted = c.n + out;
        const complete = loaded && accounted === total && total > 0;
        const short = loaded && finished && accounted < total;
        const active = c.id === activeId;
        const label = short ? `${c.label} · ${total - accounted} missing` : out > 0 ? `${c.label} · ${out} out` : c.label;
        return (
          <div
            key={c.id}
            className={`flex-1 px-3 py-2.5 text-center sm:flex-none sm:px-5 sm:text-left ${active ? "bg-surface-2 first:rounded-l-lg last:rounded-r-lg" : ""}`}
          >
            <Stat value={loaded ? `${accounted}/${total}` : "—"} label={label} tone={complete ? "brand" : short ? "gold" : "ink"} />
          </div>
        );
      })}
    </div>
  );
}

/** "+0:12" / "−0:04": slower / faster. Green faster, red slower, as timing apps do. */
export function DeltaText({ ms, suffix = "" }: { ms: number; suffix?: string }) {
  const rounded = Math.round(ms / 1000) * 1000;
  if (rounded === 0) return <span className="text-ink-3">±0:00{suffix}</span>;
  const faster = rounded < 0;
  return (
    <span className={`font-medium ${faster ? "text-brand-bright" : "text-danger"}`}>
      {faster ? "−" : "+"}
      {formatElapsed(Math.abs(rounded)).replace(/\.\d$/, "")}
      {suffix}
    </span>
  );
}

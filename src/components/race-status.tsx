"use client";

import { Award, Check, Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { LiveDot, Stat, Time } from "@/components/ui";
import { RECORD_LABEL, type RecordBadge } from "@/lib/records";
import { formatElapsed } from "@/lib/time";

/**
 * The race's state as a full-width bar: amber not started, red in progress
 * with the running clock, solid green finished. Shared by the board and the
 * record screen.
 */
/** Elapsed since the gun, ticking at tenths: the one race clock, wherever it's shown. */
export function RunningClock({ gunTimeMs, now, className }: { gunTimeMs: number; now: () => number | null; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, []);
  const n = now();
  return <Time className={className}>{n === null ? "—" : formatElapsed(n - gunTimeMs)}</Time>;
}

export function RaceStatusBar({
  name,
  finished,
  gunTimeMs,
  now,
  official,
}: {
  /** Race name, shown in the bar when given. */
  name?: string;
  finished: boolean;
  gunTimeMs: number | null;
  now: () => number | null;
  /** Official times are on the board (imported, or live from the timing company's feed), or "none": app taps only. */
  official?: "imported" | "division" | "live" | "none";
}) {
  const prefix = name ? <span className="truncate text-sm font-semibold">{name} ·</span> : null;

  if (finished) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-brand-ink sm:justify-start">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-ink/20">
          <Check className="size-3" strokeWidth={3} />
        </span>
        {prefix}
        <span className="shrink-0 text-sm font-semibold">Race finished</span>
        {official && <OfficialPill kind={official} className="bg-brand-ink/20 text-brand-ink" />}
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
        <span className="shrink-0 text-sm font-semibold">Not started</span>
        <span className="hidden truncate text-sm opacity-80 min-[400px]:inline">· waiting for the gun</span>
      </div>
    );
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-2.5 rounded-lg border border-danger/40 bg-danger-soft px-3 py-1.5 text-danger sm:justify-start">
      <LiveDot className="bg-danger" />
      {prefix}
      <span className="shrink-0 text-sm font-semibold">In progress</span>
      <RunningClock gunTimeMs={gunTimeMs} now={now} className="shrink-0 text-2xl font-semibold tracking-tight text-ink" />
      {official && <OfficialPill kind={official} className="bg-danger/15 text-danger" />}
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
  /** n = recorded here; out = not expected here (DNS/DNR/DNF); missed = passed without a time. Both count as accounted for. */
  counts: { id: string; label: string; n: number; out?: number; missed?: number }[];
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
        const missed = c.missed ?? 0;
        const accounted = c.n + out + missed;
        const complete = loaded && accounted === total && total > 0;
        const short = loaded && finished && accounted < total;
        const active = c.id === activeId;
        const notes = [out > 0 ? `${out} out` : null, missed > 0 ? `${missed} missed` : null].filter(Boolean);
        const label = short ? `${c.label} · ${total - accounted} missing` : notes.length ? `${c.label} · ${notes.join(", ")}` : c.label;
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

/** Sits at the right end of the status bar, as loud as the state itself. */
function OfficialPill({ kind, className }: { kind: "imported" | "division" | "live" | "none"; className: string }) {
  if (kind === "none")
    return <span className="ml-auto shrink-0 rounded-md bg-current/15 px-2 py-1 text-[11px] font-semibold tracking-[0.06em] uppercase opacity-90">Unofficial times</span>;
  return (
    <span className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold tracking-[0.06em] uppercase ${className}`}>
      {kind === "live" ? <LiveDot className="bg-current" /> : <Award className="size-3.5" />}
      {kind === "live" ? "Official · live" : kind === "division" ? "Official times · division places" : "Official results"}
    </span>
  );
}

/**
 * PR / SB / Course PR. Solid once the mats say so; outlined while
 * it rests on app taps. How close the call is belongs in words on the sheet.
 */
export function RecordPill({ badge, size = "sm", className = "" }: { badge: RecordBadge; size?: "sm" | "md"; className?: string }) {
  const text = RECORD_LABEL[badge.kind].short;
  const title = `${RECORD_LABEL[badge.kind].long}${badge.unofficial ? " (unofficial, pending official results)" : ""}`;
  // sm sits beside a name in a table: a tag, not a button-sized block. md beside the sheet's big finish time.
  // A little wider than tall, with softer corners, so the small one reads as a tag rather than a dot.
  const dims = size === "md" ? "h-7 rounded-md px-2.5 text-[13px]" : "h-4 rounded-[5px] px-1.5 text-[9px]";
  // School colors for the records that matter most: PR green, SB shield gold. A course PR is a quiet gray, so
  // from across the tent it doesn't read as a PR. Outlined until official results say so.
  const look = {
    pr: badge.unofficial ? "border border-brand text-brand-text" : "bg-brand text-brand-ink",
    sb: badge.unofficial ? "border border-gold text-gold-text" : "bg-gold text-gold-ink",
    course: badge.unofficial ? "border border-line-strong text-ink-2" : "bg-surface-2 text-ink ring-1 ring-line ring-inset",
    meet: badge.unofficial ? "border border-line-strong text-ink-2" : "bg-surface-2 text-ink ring-1 ring-line ring-inset",
  }[badge.kind];
  return (
    <span title={title} className={`inline-flex shrink-0 items-center font-semibold tracking-[0.04em] uppercase ${dims} ${look} ${className}`}>
      {text}
    </span>
  );
}

/** DNS / DNR / DNF beside a name, the same size as a RecordPill and in muted gray: a fact, not an achievement. */
export function StatusPill({ label, title, className = "" }: { label: string; title?: string; className?: string }) {
  return (
    <span title={title} className={`inline-flex h-4 shrink-0 items-center rounded-[5px] bg-surface-2 px-1.5 text-[9px] font-semibold tracking-[0.04em] text-ink-2 uppercase ${className}`}>
      {label}
    </span>
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

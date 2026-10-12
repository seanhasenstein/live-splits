"use client";

import { useState } from "react";
import { Button, Input, SectionLabel, Sheet, Time } from "@/components/ui";
import { ON_GOAL_MS } from "@/components/workout-tint";
import { useTimeFormat } from "@/lib/client/time-format";
import { type AthleteRep, type FlatRep, summarize } from "@/lib/workout-replay";
import { formatDateWithYear, formatElapsed, parseTypedTime } from "@/lib/time";
import type { LastTime } from "@/lib/workouts";


const tone = (delta: number | null) => (delta === null || Math.abs(delta) <= ON_GOAL_MS ? "text-ink-2" : delta < 0 ? "text-brand-text" : "text-danger");

/**
 * One runner's workout: how it went in four numbers, their reps against
 * their goal, and each rep with the rest they actually got after it (their
 * finish to their next start, which a straggler feels as a shorter rest).
 * A rep with no time, or a wrong one, can be fixed from here.
 */
export function WorkoutAthleteSheet({
  name,
  groupName,
  reps,
  list,
  last,
  onGrass,
  onAddTime,
  onClose,
}: {
  name: string;
  groupName: string | null;
  reps: FlatRep[];
  list: AthleteRep[];
  /** Their last run of the same reps, if any. */
  last: LastTime | null;
  /** Today's workout is on grass. */
  onGrass: boolean;
  /** A typed time for a rep: a new finish, or an edit to the one there. */
  onAddTime: (repId: string, groupId: string, timeMs: number, finishEventId: string | null) => void;
  onClose: () => void;
}) {
  const { ft } = useTimeFormat();
  const base = reps[0];
  const goalMs = list.find((r) => r.goalMs !== null)?.goalMs ?? null;
  const goalPerBase = goalMs !== null ? (goalMs * base.meters) / reps[list.findIndex((r) => r.goalMs !== null)].meters : null;
  return (
    <Sheet title={name} subtitle={[groupName, goalPerBase !== null ? `goal ${ft(goalPerBase, "seconds")} per ${base.label}` : "no goal"].filter(Boolean).join(" · ")} onClose={onClose}>
      <AthleteBreakdown reps={reps} list={list} last={last} onGrass={onGrass} onAddTime={onAddTime} />
    </Sheet>
  );
}

/**
 * The body of a runner's sheet, shared by the workout page and the record
 * screen: four numbers, last time, the chart, and every rep (tap one to fix
 * or add its time).
 */
export function AthleteBreakdown({
  reps,
  list,
  last,
  onGrass,
  onAddTime,
}: {
  reps: FlatRep[];
  list: AthleteRep[];
  last: LastTime | null;
  onGrass: boolean;
  onAddTime: (repId: string, groupId: string, timeMs: number, finishEventId: string | null) => void;
}) {
  const { ft, team } = useTimeFormat();
  const tenths = team === "tenths";
  const s = summarize(reps, list);
  const base = reps[0];
  const per = (msPerKm: number | null) => (msPerKm === null ? null : (msPerKm * base.meters) / 1000);
  const goalMs = list.find((r) => r.goalMs !== null)?.goalMs ?? null;
  const goalPerBase = goalMs !== null ? (goalMs * base.meters) / reps[list.findIndex((r) => r.goalMs !== null)].meters : null;
  const signed = (ms: number) => {
    const v = tenths ? Math.round(ms / 100) / 10 : Math.round(ms / 1000);
    return v === 0 ? "±0" : `${v > 0 ? "+" : "−"}${tenths ? Math.abs(v).toFixed(1) : Math.abs(v)}`;
  };
  const sets = reps.some((r) => r.setIndex > 0);
  const [editing, setEditing] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const typedMs = parseTypedTime(typed);
  // Reps not run yet fold into one line at the end.
  const shown = list.findLastIndex((r) => r.status !== "pending" && r.status !== "not_run") + 1;
  const endedEarly = list.slice(shown).some((r) => r.status === "not_run");

  // Each rep's time over the first rep's distance, so a 200 and a 400 sit on one scale.
  const points = list.map((r, i) => (r.status === "done" && r.elapsedMs !== null ? { i, ms: (r.elapsedMs * base.meters) / reps[i].meters, delta: r.deltaMs } : null)).filter((p) => p !== null);

  return (
    <>
      <div className="grid grid-cols-4 gap-2 border-b border-line pb-3">
        <Stat value={per(s.avgPaceMsPerKm) !== null ? ft(per(s.avgPaceMsPerKm)!) : "—"} label={`Avg / ${base.label}`} />
        <Stat value={s.avgDeltaMs !== null ? signed(s.avgDeltaMs) : "—"} label="vs goal" className={tone(s.avgDeltaMs)} />
        <Stat value={per(s.spreadMsPerKm) !== null ? (per(s.spreadMsPerKm)! / 1000).toFixed(tenths ? 1 : 0) : "—"} label="Spread" />
        <Stat value={per(s.fadeMsPerKm) !== null ? signed(per(s.fadeMsPerKm)!) : "—"} label="Fade" className={s.fadeMsPerKm === null ? "" : s.fadeMsPerKm > 0 ? "text-danger" : "text-brand-text"} />
      </div>

      {last && (
        <p className="border-b border-line py-2.5 text-[13px] text-ink-2">
          <span className="font-medium text-ink">Last time</span> ({formatDateWithYear(last.date)}{last.approximateDistances !== onGrass ? (last.approximateDistances ? ", on grass" : ", not on grass") : ""}): {per(last.avgPaceMsPerKm) !== null ? `${ft(per(last.avgPaceMsPerKm)!)} average per ${base.label}` : "no times"}
          {last.avgDeltaMs !== null && `, ${signed(last.avgDeltaMs)} vs goal then`}
          {per(last.avgPaceMsPerKm) !== null && per(s.avgPaceMsPerKm) !== null && (() => {
            const d = per(s.avgPaceMsPerKm)! - per(last.avgPaceMsPerKm)!;
            const v = tenths ? Math.round(d / 100) / 10 : Math.round(d / 1000);
            return v === 0 ? ". Same average today." : <span className={v < 0 ? "text-brand-text" : "text-danger"}>{`. ${Math.abs(v)} s ${v < 0 ? "faster" : "slower"} today.`}</span>;
          })()}
        </p>
      )}

      {points.length >= 2 && <RepChart points={points} goalMs={goalPerBase} reps={reps} ft={ft} baseLabel={base.label} />}

      <SectionLabel className="mt-3 mb-1">Reps</SectionLabel>
      <div className="divide-y divide-line">
        {list.slice(0, shown).map((r, i) => {
          const next = list[i + 1];
          // Their own rest: in from this rep to the start of their next one.
          const restMs = r.status === "done" && r.finishMs !== null && next?.startMs != null && next.startMs > r.finishMs ? next.startMs - r.finishMs : null;
          const canType = (r.status === "done" || r.status === "unfinished") && r.startMs !== null;
          return (
            <div key={r.repId}>
              <button
                type="button"
                disabled={!canType}
                onClick={() => {
                  setEditing(editing === i ? null : i);
                  setTyped(r.elapsedMs !== null ? formatElapsed(r.elapsedMs) : "");
                }}
                className="flex w-full items-baseline gap-3 py-2 text-left text-sm enabled:hover:bg-surface-2"
              >
                <span className="w-16 shrink-0 text-ink-3">
                  {sets ? `${reps[i].setIndex + 1}.${reps[i].number}` : `Rep ${reps[i].number}`}
                  {reps[i].meters !== base.meters && <span className="block text-[11px]">{reps[i].label}</span>}
                </span>
                <span className="flex-1">
                  {r.status === "done" && r.elapsedMs !== null ? (
                    <Time className="font-semibold text-ink">{ft(r.elapsedMs)}</Time>
                  ) : (
                    <span className="text-ink-3">
                      {r.status === "unfinished" ? "no time · tap to add" : r.status === "skipped" ? "skipped" : r.status === "stopped" ? "done for today" : r.status === "running" ? "running" : "·"}
                    </span>
                  )}
                  {last?.repMs[i] != null && <Time className="block text-[11px] text-ink-3">last time {ft(last.repMs[i]!)}</Time>}
                </span>
                <Time className={`w-12 text-right text-[13px] ${tone(r.deltaMs)}`}>{r.status === "done" && r.deltaMs !== null ? signed(r.deltaMs) : ""}</Time>
                <Time className="w-20 text-right text-[13px] text-ink-3">{restMs !== null ? `${formatElapsed(restMs, "seconds")} rest` : ""}</Time>
              </button>
              {editing === i && canType && (
                <div className="space-y-2 pb-3">
                  <Input autoFocus onFocus={(e) => e.target.select()} value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="decimal" className="h-11! font-mono text-lg!" aria-label={`Rep ${i + 1} time`} />
                  <p className="text-[13px] text-ink-2">{typed.trim() ? (typedMs !== null ? `= ${formatElapsed(typedMs)}` : "Not a time yet") : "Digits are enough: 116 is 1:16, 116.4 is 1:16.4."}</p>
                  <Button
                    className="w-full"
                    disabled={typedMs === null}
                    onClick={() => {
                      onAddTime(r.repId, r.groupId, r.startMs! + typedMs!, r.finishEventId);
                      setEditing(null);
                    }}
                  >
                    Save {typedMs !== null ? formatElapsed(typedMs) : ""}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        {shown < list.length && (
          <p className="py-2 text-sm text-ink-3">
            {shown === list.length - 1 ? `Rep ${shown + 1}` : `Reps ${shown + 1}–${list.length}`} {endedEarly ? "not run: the group ended early" : "to come"}
          </p>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-3">
        Rest is theirs: from when they came in to when they started the next rep. Tap a time to fix it, or a &ldquo;no time&rdquo; to add one from a watch.
      </p>
    </>
  );
}

function Stat({ value, label, className = "" }: { value: string; label: string; className?: string }) {
  return (
    <div className="min-w-0">
      <Time className={`block truncate text-lg leading-none font-semibold ${className || "text-ink"}`}>{value}</Time>
      <span className="mt-1 block truncate text-[11px] font-medium text-ink-2">{label}</span>
    </div>
  );
}

/** Each rep against the goal line; faster is higher, like the race charts. Green under goal, red over. */
function RepChart({ points, goalMs, reps, ft, baseLabel }: { points: { i: number; ms: number; delta: number | null }[]; goalMs: number | null; reps: FlatRep[]; ft: (ms: number) => string; baseLabel: string }) {
  const W = 320;
  const H = 110;
  const padX = 14;
  const padTop = 12;
  const padBottom = 20;
  const values = [...points.map((p) => p.ms), ...(goalMs !== null ? [goalMs] : [])];
  const lo = Math.min(...values);
  const span = Math.max(Math.max(...values) - lo, 4_000); // never flatter than 4 s
  const x = (i: number) => padX + (reps.length === 1 ? (W - 2 * padX) / 2 : (i * (W - 2 * padX)) / (reps.length - 1));
  const y = (ms: number) => padTop + ((ms - lo) / span) * (H - padTop - padBottom);
  const path = points.map((p, n) => `${n === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.ms).toFixed(1)}`).join(" ");
  const dot = (d: number | null) => (d === null || Math.abs(d) <= ON_GOAL_MS ? "fill-ink" : d < 0 ? "fill-brand" : "fill-danger");
  return (
    <div className="border-b border-line py-2">
      <div className="flex items-baseline justify-between">
        <SectionLabel>Reps against goal</SectionLabel>
        <span className="text-[11px] text-ink-3">per {baseLabel} · higher is faster</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-28 w-full" role="img" aria-label={points.map((p) => `rep ${p.i + 1} ${ft(p.ms)}`).join(", ")}>
        {goalMs !== null && (
          <>
            <line x1={padX} x2={W - padX} y1={y(goalMs)} y2={y(goalMs)} className="stroke-ink-3" strokeDasharray="3 3" />
            <text x={W - padX} y={y(goalMs) - 3} textAnchor="end" className="fill-ink-2 text-[9px] font-semibold">
              goal {ft(goalMs)}
            </text>
          </>
        )}
        <path d={path} fill="none" className="stroke-ink-3" strokeWidth="1.5" />
        {points.map((p) => (
          <circle key={p.i} cx={x(p.i)} cy={y(p.ms)} r={3.5} className={dot(p.delta)} />
        ))}
        {reps.map((r, i) => (
          <text key={r.id} x={x(i)} y={H - 6} textAnchor="middle" className="fill-ink-3 text-[9px]">
            {i + 1}
          </text>
        ))}
      </svg>
    </div>
  );
}

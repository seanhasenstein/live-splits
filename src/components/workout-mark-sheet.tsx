"use client";

import { useState } from "react";
import { Button, Checkbox, SectionLabel, Segmented, Select, Sheet } from "@/components/ui";
import type { AthleteRep, FlatRep } from "@/lib/workout-replay";

export type MarkEvent = { type: "stop" | "skip" | "rejoin" | "void"; athleteId?: string; groupId?: string; repId?: string; targetEventId?: string };

type Mark = "stop" | "skip" | "rejoin" | "unskip";

const MARKS: { value: Mark; label: string; hint: (rep: number) => string }[] = [
  { value: "stop", label: "Done for today", hint: (n) => `From rep ${n} on. Any time they already have stays.` },
  { value: "skip", label: "Skipped", hint: (n) => `Didn't run rep ${n}. A time typed in later still counts.` },
  { value: "rejoin", label: "Back in", hint: (n) => `Running again from rep ${n}, after done for today.` },
  { value: "unskip", label: "Not skipped", hint: (n) => `Takes back a skip of rep ${n}.` },
];

/**
 * Mark several runners at once on any rep, past ones included: done for today (the runner who
 * quit mid-rep nobody had time to mark), skipped, back in, or a skip taken back.
 */
export function MarkRunnersSheet({
  reps,
  runners,
  initialRepIndex,
  onApply,
  onClose,
}: {
  reps: FlatRep[];
  runners: { id: string; name: string; list: AthleteRep[] }[];
  initialRepIndex: number;
  onApply: (events: MarkEvent[]) => void;
  onClose: () => void;
}) {
  const [repIndex, setRepIndex] = useState(initialRepIndex);
  const [mark, setMark] = useState<Mark>("stop");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  // Only the runners the mark can change on that rep.
  const eligible = runners.filter(({ list }) => {
    const r = list[repIndex];
    if (!r) return false;
    if (mark === "stop") return r.status !== "stopped";
    if (mark === "skip") return r.status !== "done" && r.status !== "skipped" && r.status !== "stopped";
    if (mark === "rejoin") return r.status === "stopped";
    return r.status === "skipped" && r.skipEventId !== null;
  });
  const chosen = eligible.filter(({ id }) => picked.has(id));
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const apply = () => {
    const rep = reps[repIndex];
    onApply(
      chosen.map(({ id, list }) => {
        const r = list[repIndex];
        return mark === "unskip" ? { type: "void" as const, targetEventId: r.skipEventId! } : { type: mark, athleteId: id, groupId: r.groupId, repId: rep.id };
      }),
    );
    onClose();
  };
  const hint = MARKS.find((m) => m.value === mark)!.hint(repIndex + 1);
  return (
    <Sheet title="Mark runners" subtitle="Several at once, on any rep." onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-[auto_1fr] items-center gap-3">
          <SectionLabel>Rep</SectionLabel>
          <Select value={String(repIndex)} onChange={(e) => setRepIndex(Number(e.target.value))} aria-label="Rep">
            {reps.map((r, i) => (
              <option key={r.id} value={i}>
                Rep {i + 1} · {r.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Segmented value={mark} onChange={setMark} options={MARKS.map((m) => ({ value: m.value, label: m.label }))} scroll size="sm" />
          <p className="mt-1.5 text-[13px] text-ink-2">{hint}</p>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <SectionLabel>Runners</SectionLabel>
            {eligible.length > 1 && (
              <button type="button" className="text-[13px] font-medium text-brand-text hover:underline" onClick={() => setPicked(chosen.length === eligible.length ? new Set() : new Set(eligible.map((r) => r.id)))}>
                {chosen.length === eligible.length ? "None" : "All"}
              </button>
            )}
          </div>
          {eligible.length === 0 ? (
            <p className="text-sm text-ink-3">Nobody to mark that way on rep {repIndex + 1}.</p>
          ) : (
            <div className="max-h-[40dvh] space-y-1 overflow-y-auto">
              {eligible.map(({ id, name }) => (
                <Checkbox key={id} label={name} checked={picked.has(id)} onChange={() => toggle(id)} className="rounded-md px-1 py-1.5 hover:bg-surface-2" />
              ))}
            </div>
          )}
        </div>
        <Button className="w-full" disabled={chosen.length === 0} onClick={apply}>
          {chosen.length === 0 ? "Pick runners" : `Mark ${chosen.length} runner${chosen.length === 1 ? "" : "s"}: ${MARKS.find((m) => m.value === mark)!.label.toLowerCase()}`}
        </Button>
      </div>
    </Sheet>
  );
}

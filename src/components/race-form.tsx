"use client";

import { useActionState, useState } from "react";
import type { FormState } from "@/app/actions/races";
import { Button, ErrorText, Field, Input, Select } from "@/components/ui";
import type { DistanceUnit, Gender, Program } from "@/lib/db/schema";
import type { RacePayload } from "@/lib/race-form";

type DistanceOption = { id: string; label: string; value: number; unit: DistanceUnit };
type RosterEntry = { id: string; name: string; gender: Gender; defaultLevelId: string };
type Checkpoint = RacePayload["checkpoints"][number];

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  program: Program["settings"];
  distances: DistanceOption[];
  roster: RosterEntry[];
  race: RacePayload | null;
};

const UNITS: DistanceUnit[] = ["mi", "km", "m"];

function defaultCheckpoints(distance: DistanceOption | undefined): Checkpoint[] {
  return [
    { id: null, label: "Mile 1", value: 1, unit: "mi", kind: "split" },
    { id: null, label: "Mile 2", value: 2, unit: "mi", kind: "split" },
    { id: null, label: "Finish", value: distance?.value ?? 5, unit: distance?.unit ?? "km", kind: "finish" },
  ];
}

export function RaceForm({ action, program, distances, roster, race }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const defaultDistance = distances.find((d) => d.id === "xc-5000m") ?? distances[0];
  const firstCategory = program.raceCategories[0];

  const [name, setName] = useState(race?.name ?? firstCategory?.label ?? "");
  const [categoryId, setCategoryId] = useState(race?.raceCategoryId ?? firstCategory?.id ?? "");
  const [levelIds, setLevelIds] = useState<string[]>(race?.levelIds ?? program.levels.map((l) => l.id));
  const [distanceId, setDistanceId] = useState(race?.distanceId ?? defaultDistance?.id ?? "");
  const [scheduledStart, setScheduledStart] = useState(race?.scheduledStart ?? "");
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(race?.checkpoints ?? defaultCheckpoints(defaultDistance));
  const [lineup, setLineup] = useState<Map<string, string>>(new Map(race?.lineup.map((l) => [l.athleteId, l.levelId])));
  const [showAll, setShowAll] = useState(false);

  const category = program.raceCategories.find((c) => c.id === categoryId);
  const visibleRoster = roster.filter((a) => showAll || !category?.gender || a.gender === category.gender);
  const hiddenCount = roster.length - visibleRoster.length;

  const payload: RacePayload = {
    name,
    raceCategoryId: categoryId,
    levelIds,
    distanceId,
    scheduledStart: scheduledStart || null,
    checkpoints,
    lineup: [...lineup].map(([athleteId, levelId]) => ({ athleteId, levelId })),
  };

  const pickCategory = (id: string) => {
    const next = program.raceCategories.find((c) => c.id === id);
    // A fresh race named after its category follows the category.
    if (!race && (name === "" || name === category?.label)) setName(next?.label ?? "");
    setCategoryId(id);
  };

  const pickDistance = (id: string) => {
    const next = distances.find((d) => d.id === id);
    setDistanceId(id);
    if (next) {
      setCheckpoints((cps) => cps.map((c) => (c.kind === "finish" ? { ...c, value: next.value, unit: next.unit } : c)));
    }
  };

  const toggleLevel = (id: string) =>
    setLevelIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const updateCheckpoint = (i: number, patch: Partial<Checkpoint>) =>
    setCheckpoints((cps) => cps.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const toggleAthlete = (a: RosterEntry) =>
    setLineup((m) => {
      const next = new Map(m);
      if (next.has(a.id)) next.delete(a.id);
      else next.set(a.id, levelIds.includes(a.defaultLevelId) ? a.defaultLevelId : levelIds[0]);
      return next;
    });

  const selectAllVisible = () =>
    setLineup((m) => {
      const next = new Map(m);
      for (const a of visibleRoster) {
        if (!next.has(a.id)) next.set(a.id, levelIds.includes(a.defaultLevelId) ? a.defaultLevelId : levelIds[0]);
      }
      return next;
    });

  return (
    <form action={formAction}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <Field label="Race name">
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select value={categoryId} onChange={(e) => pickCategory(e.target.value)}>
            {program.raceCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Distance">
          <Select value={distanceId} onChange={(e) => pickDistance(e.target.value)}>
            {distances.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Levels in this race">
          <div className="flex gap-4 py-2">
            {program.levels.map((l) => (
              <label key={l.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={levelIds.includes(l.id)} onChange={() => toggleLevel(l.id)} className="size-4 accent-green" />
                {l.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Scheduled start">
          <Input type="time" value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)} />
        </Field>
      </div>

      <Field label="Checkpoints" hint="Where managers stand. The finish is optional; remove it if nobody will tap finishers.">
        <div className="space-y-2">
          {checkpoints.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={c.label}
                onChange={(e) => updateCheckpoint(i, { label: e.target.value })}
                placeholder="Label"
                className="flex-1"
              />
              <Input
                type="number"
                step="any"
                min={0}
                value={c.value}
                onChange={(e) => updateCheckpoint(i, { value: Number(e.target.value) })}
                className="w-20 text-right tabular-nums"
              />
              <Select value={c.unit} onChange={(e) => updateCheckpoint(i, { unit: e.target.value as DistanceUnit })} className="w-20">
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
              <span className="w-12 text-xs text-green/60">{c.kind === "finish" ? "finish" : "split"}</span>
              <button
                type="button"
                onClick={() => setCheckpoints((cps) => cps.filter((_, j) => j !== i))}
                className="px-1 text-lg leading-none text-green/50 hover:text-red-700"
                aria-label={`Remove ${c.label}`}
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="px-3 py-1.5 text-xs"
              onClick={() =>
                setCheckpoints((cps) => [
                  ...cps,
                  { id: null, label: `Mile ${cps.filter((c) => c.kind === "split").length + 1}`, value: cps.filter((c) => c.kind === "split").length + 1, unit: "mi", kind: "split" },
                ])
              }
            >
              Add split
            </Button>
            {!checkpoints.some((c) => c.kind === "finish") && (
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                onClick={() => {
                  const d = distances.find((x) => x.id === distanceId);
                  setCheckpoints((cps) => [...cps, { id: null, label: "Finish", value: d?.value ?? 5, unit: d?.unit ?? "km", kind: "finish" }]);
                }}
              >
                Add finish
              </Button>
            )}
          </div>
        </div>
      </Field>

      <Field label={`Athletes (${lineup.size} running)`}>
        <div className="mb-2 flex items-center justify-between text-xs">
          <button type="button" onClick={selectAllVisible} className="underline underline-offset-2">
            Select all shown
          </button>
          {hiddenCount > 0 && (
            <button type="button" onClick={() => setShowAll(true)} className="text-green/60 underline underline-offset-2">
              Show {hiddenCount} more
            </button>
          )}
        </div>
        <ul className="divide-y divide-green/15 rounded border border-green/30 bg-white">
          {visibleRoster.map((a) => {
            const running = lineup.has(a.id);
            return (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                <label className="flex flex-1 items-center gap-3">
                  <input type="checkbox" checked={running} onChange={() => toggleAthlete(a)} className="size-5 accent-green" />
                  <span className={running ? "font-bold" : ""}>{a.name}</span>
                </label>
                {running && levelIds.length > 1 && (
                  <select
                    value={lineup.get(a.id)}
                    onChange={(e) => setLineup((m) => new Map(m).set(a.id, e.target.value))}
                    className="rounded border border-green/30 bg-white px-2 py-1 text-sm"
                  >
                    {levelIds.map((l) => (
                      <option key={l} value={l}>
                        {program.levels.find((x) => x.id === l)?.abbreviation ?? l}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      </Field>

      <ErrorText>{state.error}</ErrorText>
      <Button type="submit" disabled={pending} className="w-full py-3.5">
        {pending ? "Saving…" : race ? "Save race" : "Create race"}
      </Button>
    </form>
  );
}

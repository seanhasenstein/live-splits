"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useState } from "react";
import type { FormState } from "@/app/actions/races";
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, LinkButton, Select } from "@/components/ui";
import type { DistanceUnit, Gender, Program } from "@/lib/db/schema";
import type { RacePayload } from "@/lib/race-form";

type DistanceOption = { id: string; label: string; value: number; unit: DistanceUnit };
type RosterEntry = { id: string; name: string; gender: Gender; defaultLevelId: string };
type Checkpoint = RacePayload["checkpoints"][number];

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  cancelHref: string;
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

export function RaceForm({ action, cancelHref, program, distances, roster, race }: Props) {
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
    if (next) setCheckpoints((cps) => cps.map((c) => (c.kind === "finish" ? { ...c, value: next.value, unit: next.unit } : c)));
  };

  const toggleLevel = (id: string) => {
    const removing = levelIds.includes(id);
    const next = removing ? levelIds.filter((x) => x !== id) : [...levelIds, id];
    if (next.length === 0) return; // a race needs at least one level
    setLevelIds(next);
    // Athletes on a removed level move to the first remaining one.
    if (removing) setLineup((m) => new Map([...m].map(([a, l]) => [a, l === id ? next[0] : l])));
  };
  const updateCheckpoint = (i: number, patch: Partial<Checkpoint>) => setCheckpoints((cps) => cps.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const levelFor = (a: RosterEntry) => (levelIds.includes(a.defaultLevelId) ? a.defaultLevelId : levelIds[0]);

  const toggleAthlete = (a: RosterEntry) =>
    setLineup((m) => {
      const next = new Map(m);
      if (next.has(a.id)) next.delete(a.id);
      else next.set(a.id, levelFor(a));
      return next;
    });

  const selectAllVisible = () =>
    setLineup((m) => {
      const next = new Map(m);
      for (const a of visibleRoster) if (!next.has(a.id)) next.set(a.id, levelFor(a));
      return next;
    });

  const splitCount = checkpoints.filter((c) => c.kind === "split").length;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <Card>
        <CardBody className="space-y-4 border-t-0">
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
            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Levels in this race</span>
              <div className="flex h-10 items-center gap-4">
                {program.levels.map((l) => (
                  <Checkbox key={l.id} label={l.label} checked={levelIds.includes(l.id)} onChange={() => toggleLevel(l.id)} />
                ))}
              </div>
            </div>
            <Field label="Scheduled start">
              <Input type="time" value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)} />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Checkpoints" description="The finish is optional; remove it if nobody will tap finishers." />
        <CardBody className="space-y-2">
          {checkpoints.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={c.label} onChange={(e) => updateCheckpoint(i, { label: e.target.value })} placeholder="Label" className="min-w-0 flex-1" />
              <Input
                type="number"
                step="any"
                min={0}
                value={c.value}
                onChange={(e) => updateCheckpoint(i, { value: Number(e.target.value) })}
                className="w-20 text-right"
              />
              <Select value={c.unit} onChange={(e) => updateCheckpoint(i, { unit: e.target.value as DistanceUnit })} className="w-20">
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
              <span className="w-10 text-xs text-ink-3">{c.kind}</span>
              <Button variant="ghost" size="sm" onClick={() => setCheckpoints((cps) => cps.filter((_, j) => j !== i))} aria-label={`Remove ${c.label}`} className="px-1.5">
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCheckpoints((cps) => [...cps, { id: null, label: `Mile ${splitCount + 1}`, value: splitCount + 1, unit: "mi", kind: "split" }])}
            >
              <Plus className="size-3.5" />
              Split
            </Button>
            {!checkpoints.some((c) => c.kind === "finish") && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const d = distances.find((x) => x.id === distanceId);
                  setCheckpoints((cps) => [...cps, { id: null, label: "Finish", value: d?.value ?? 5, unit: d?.unit ?? "km", kind: "finish" }]);
                }}
              >
                <Plus className="size-3.5" />
                Finish
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Athletes · ${lineup.size} running`}
          description={hiddenCount > 0 ? `Showing ${category?.label ?? ""} athletes.` : undefined}
          action={
            <div className="flex gap-1">
              {hiddenCount > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                  Show {hiddenCount} more
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={selectAllVisible}>
                Select all
              </Button>
            </div>
          }
        />
        <div className="divide-y divide-line border-t border-line">
          {visibleRoster.map((a) => {
            const running = lineup.has(a.id);
            return (
              <div key={a.id} className="flex items-center gap-3 px-4 py-2">
                <Checkbox
                  label={<span className={running ? "font-medium text-ink" : "text-ink-2"}>{a.name}</span>}
                  checked={running}
                  onChange={() => toggleAthlete(a)}
                  className="h-9 flex-1"
                />
                {running && levelIds.length > 1 && (
                  <select
                    value={lineup.get(a.id)}
                    onChange={(e) => setLineup((m) => new Map(m).set(a.id, e.target.value))}
                    className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]"
                  >
                    {levelIds.map((l) => (
                      <option key={l} value={l}>
                        {program.levels.find((x) => x.id === l)?.abbreviation ?? l}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <div className="flex justify-end gap-2">
        <LinkButton href={cancelHref} variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : race ? "Save race" : "Create race"}
        </Button>
      </div>
    </form>
  );
}

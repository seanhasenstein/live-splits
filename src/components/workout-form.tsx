"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { saveWorkoutAction } from "@/app/actions/workouts";
import { Alert, Button, Card, CardBody, CardHeader, Checkbox, CheckboxCard, Field, Input, LinkButton, SectionLabel, Select } from "@/components/ui";
import type { DistanceUnit, Rest, WorkoutEffort } from "@/lib/db/schema";
import { toMeters } from "@/lib/distance";
import { describePlan, describeTotal, EFFORT_LABEL, type PlanSetInput, type WorkoutPayload } from "@/lib/workout-plan";
import { goalPaceFrom5K } from "@/lib/workout-replay";
import { formatDuration, formatElapsed, parseDuration } from "@/lib/time";

export type RosterRow = { id: string; name: string; gender: "M" | "F" | "X"; level: string };

/** What the form starts from: an existing workout, or blanks. */
export type WorkoutFormValues = Omit<WorkoutPayload, "sets"> & { sets: PlanSetInput[] };

/** "timeFirst" / "timeMiddle": a fixed rest counted from the first or the middle runner in (stored as kind "time" with from). */
type RestDraft = { kind: Rest["kind"] | "timeFirst" | "timeMiddle"; text: string };
type SetDraft = { key: string; id?: string; count: string; value: string; unit: DistanceUnit; rest: RestDraft; restAfter: RestDraft };

const restToDraft = (r: Rest | null): RestDraft =>
  !r ? { kind: "time", text: "" } : r.kind === "time" ? { kind: r.from === "first" ? "timeFirst" : r.from === "middle" ? "timeMiddle" : "time", text: formatDuration(r.ms) } : r.kind === "interval" ? { kind: "interval", text: formatDuration(r.everyMs) } : r.kind === "jog" ? { kind: "jog", text: String(r.meters) } : { kind: "open", text: "" };

/** A draft rest back to the model; null when it can't be read. */
function draftToRest(d: RestDraft): Rest | null {
  if (d.kind === "open") return { kind: "open" };
  if (d.kind === "jog") {
    const m = Number(d.text);
    return Number.isFinite(m) && m > 0 ? { kind: "jog", meters: m } : null;
  }
  const ms = parseDuration(d.text);
  if (ms === null) return null;
  return d.kind === "time" ? { kind: "time", ms } : d.kind === "timeFirst" ? { kind: "time", ms, from: "first" } : d.kind === "timeMiddle" ? { kind: "time", ms, from: "middle" } : { kind: "interval", everyMs: ms };
}

/** The form's sets in the stored shape, for describePlan. */
const asSets = (plan: PlanSetInput[]) =>
  plan.map((s) => ({ id: "", reps: Array.from({ length: s.count }, () => ({ id: "", distance: { value: s.value, unit: s.unit, meters: toMeters(s.value, s.unit) }, rest: s.rest })), restAfter: s.restAfter }));

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

export function WorkoutForm({
  workoutId,
  initial,
  roster,
  fiveK,
  cancelHref,
}: {
  workoutId: string | null;
  initial: WorkoutFormValues;
  roster: RosterRow[];
  /** 5K season best and PR per athlete, for proposing goals. */
  fiveK: Record<string, { sb: number | null; pr: number | null }>;
  cancelHref: string;
}) {
  const [name, setName] = useState(initial.name);
  const [date, setDate] = useState(initial.date);
  const [place, setPlace] = useState(initial.place ?? "");
  const [approx, setApprox] = useState(initial.approximateDistances);
  const [effort, setEffort] = useState<WorkoutEffort>(initial.effort);
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [sets, setSets] = useState<SetDraft[]>(() =>
    initial.sets.map((s) => ({ key: nextKey(), id: s.id, count: String(s.count), value: String(s.value), unit: s.unit, rest: restToDraft(s.rest), restAfter: restToDraft(s.restAfter) })),
  );
  const [groups, setGroups] = useState(initial.groups);
  // Everyone on the roster has a row; `in` says whether they're running today.
  const [athletes, setAthletes] = useState(() => {
    const byId = new Map(initial.athletes.map((a) => [a.athleteId, a]));
    const fresh = initial.athletes.length === 0;
    return roster.map((r) => {
      const a = byId.get(r.id);
      return { athleteId: r.id, in: fresh || !!a, groupId: a?.groupId ?? initial.groups[0].id, goal: a?.goalPaceMsPerKm ?? null };
    });
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The plan as the model would store it, when every field reads.
  const plan = useMemo(() => {
    const out: PlanSetInput[] = [];
    for (const [i, s] of sets.entries()) {
      const count = Number(s.count);
      const value = Number(s.value);
      const rest = draftToRest(s.rest);
      const restAfter = i === sets.length - 1 ? null : draftToRest(s.restAfter);
      if (!Number.isInteger(count) || count < 1 || !(value > 0) || !rest || (i < sets.length - 1 && !restAfter)) return null;
      out.push({ id: s.id, count, value, unit: s.unit, rest, restAfter });
    }
    return out;
  }, [sets]);
  // Goals are paces; the form shows them as a time for the workout's first rep distance.
  const mainMeters = plan?.[0] ? toMeters(plan[0].value, plan[0].unit) : sets[0] ? toMeters(Number(sets[0].value) || 400, sets[0].unit) : 400;
  const mainLabel = sets[0] ? `${sets[0].value}${sets[0].unit === "m" ? "m" : sets[0].unit === "km" ? "K" : ` ${sets[0].unit}`}` : "rep";
  const totalMeters = plan ? plan.reduce((n, s) => n + s.count * toMeters(s.value, s.unit), 0) : null;
  const goalText = (pace: number | null) => (pace === null ? "" : formatDuration(Math.round((pace * mainMeters) / 1000)));
  // What's typed in each goal field, for the distance it was typed against; when the first rep's
  // distance changes, the fields show the same paces as times over the new distance.
  const [typed, setTyped] = useState<{ meters: number; text: Record<string, string> }>({ meters: 0, text: {} });
  const goalDraft = (athleteId: string, pace: number | null) => (typed.meters === mainMeters && athleteId in typed.text ? typed.text[athleteId] : goalText(pace));

  const setGoalFromText = (athleteId: string, text: string) => {
    setTyped((t) => ({ meters: mainMeters, text: { ...(t.meters === mainMeters ? t.text : {}), [athleteId]: text } }));
    const ms = parseDuration(text);
    setAthletes((list) => list.map((a) => (a.athleteId === athleteId ? { ...a, goal: ms === null ? null : Math.round((ms * 1000) / mainMeters) } : a)));
  };
  const fillGoals = (only: "empty" | "all") => {
    const next = athletes.map((a) => {
      const basis = fiveK[a.athleteId]?.sb ?? fiveK[a.athleteId]?.pr ?? null;
      if (basis === null || (only === "empty" && a.goal !== null)) return a;
      // A goal a coach would say: whole seconds for the first rep's distance.
      const pace = goalPaceFrom5K(basis, effort);
      return { ...a, goal: pace === null ? null : Math.round((Math.round((pace * mainMeters) / 1000 / 1000) * 1000 * 1000) / mainMeters) };
    });
    setAthletes(next);
    setTyped({ meters: 0, text: {} });
  };

  const updateSet = (key: string, patch: Partial<SetDraft>) => setSets((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const save = () => {
    if (!plan) return setError("Check the reps: every set needs a count, a distance and its rests.");
    const included = athletes.filter((a) => a.in);
    if (included.length === 0) return setError("Pick who's running.");
    const payload: WorkoutPayload = {
      name: name.trim() || describePlan(asSets(plan)),
      date,
      place: place.trim() || null,
      approximateDistances: approx,
      effort,
      sets: plan,
      groups,
      athletes: included.map((a) => ({ athleteId: a.athleteId, groupId: groups.some((g) => g.id === a.groupId) ? a.groupId : groups[0].id, goalPaceMsPerKm: a.goal })),
      notes: notes.trim() || null,
      templateId: initial.templateId ?? null,
      expectedUpdatedAt: initial.expectedUpdatedAt,
      saveAsTemplate,
    };
    setError(null);
    start(async () => {
      const res = await saveWorkoutAction(workoutId, JSON.stringify(payload));
      if (res?.error) setError(res.error);
    });
  };

  const nameOf = new Map(roster.map((r) => [r.id, r]));
  const fmt5K = (ms: number | null) => (ms === null ? null : formatElapsed(ms, "seconds"));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Workout" />
        <CardBody className="space-y-4">
          <Field label="Name" hint="Leave blank to name it after the reps.">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={plan ? describePlan(asSets(plan)) : "12 × 400m"} maxLength={120} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Purpose">
              <Select value={effort} onChange={(e) => setEffort(e.target.value as WorkoutEffort)}>
                {(Object.keys(EFFORT_LABEL) as WorkoutEffort[]).map((k) => (
                  <option key={k} value={k}>
                    {EFFORT_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Where">
            <Input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="School grounds" maxLength={120} />
          </Field>
          <CheckboxCard title="On grass" description="Distances are rough there, so times compare best with other grass days." checked={approx} onChange={setApprox} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Reps" description={plan && totalMeters !== null ? `${describePlan(asSets(plan))} · ${describeTotal(totalMeters)} total` : "Sets of reps, each with the rest that follows."} />
        <CardBody flush className="divide-y divide-line">
          {sets.map((s, i) => (
            <div key={s.key} className="space-y-3 px-4 py-4">
              <div className="flex items-end gap-2">
                <div className="w-20">
                  <Field label={sets.length > 1 ? `Set ${i + 1}` : "Reps"}>
                    <Input value={s.count} onChange={(e) => updateSet(s.key, { count: e.target.value })} inputMode="numeric" aria-label="How many reps" />
                  </Field>
                </div>
                <span className="pb-2.5 text-ink-2">×</span>
                <div className="w-24">
                  <Field label="Distance">
                    <Input value={s.value} onChange={(e) => updateSet(s.key, { value: e.target.value })} inputMode="decimal" aria-label="Rep distance" />
                  </Field>
                </div>
                <div className="w-20">
                  <Select value={s.unit} onChange={(e) => updateSet(s.key, { unit: e.target.value as DistanceUnit })} aria-label="Unit">
                    <option value="m">m</option>
                    <option value="km">km</option>
                    <option value="mi">mi</option>
                  </Select>
                </div>
                <div className="flex-1" />
                {sets.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setSets((list) => list.filter((x) => x.key !== s.key))} aria-label={`Remove set ${i + 1}`}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
              <RestField label="Rest between reps" value={s.rest} onChange={(rest) => updateSet(s.key, { rest })} />
              {i < sets.length - 1 && <RestField label="Rest after the set" value={s.restAfter} onChange={(restAfter) => updateSet(s.key, { restAfter })} />}
            </div>
          ))}
          <div className="px-4 py-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const last = sets.at(-1);
                setSets([...sets.map((x, i) => (i === sets.length - 1 && !x.restAfter.text ? { ...x, restAfter: { kind: "time" as const, text: "180" } } : x)), { key: nextKey(), count: last?.count ?? "4", value: last?.value ?? "400", unit: last?.unit ?? "m", rest: last?.rest ?? { kind: "time", text: "60" }, restAfter: { kind: "time", text: "" } }]);
              }}
            >
              <Plus className="size-4" />
              Add a set
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Groups"
          description="Each group starts on its own and has its own clocks, so one group's rest never holds another up."
          action={
            <Button variant="secondary" size="sm" onClick={() => setGroups((g) => [...g, { id: `g${Date.now().toString(36)}`, name: `Group ${g.length + 1}` }])}>
              <Plus className="size-4" />
              Add group
            </Button>
          }
        />
        <CardBody className="space-y-2">
          {groups.length > 1 && <p className="text-[13px] text-ink-2">Name them so whoever&rsquo;s timing knows which is theirs: &ldquo;Varsity boys&rdquo;, &ldquo;Coach Mike&rsquo;s group&rdquo;. The name is on their timing screen.</p>}
          {groups.map((g) => {
            const count = athletes.filter((a) => a.in && a.groupId === g.id).length;
            return (
              <div key={g.id} className="flex items-center gap-2">
                <Input
                  value={g.name}
                  onChange={(e) => setGroups((list) => list.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)))}
                  className="min-w-0 flex-1"
                  aria-label="Group name"
                  placeholder="Group name"
                  maxLength={40}
                />
                <span className="w-20 shrink-0 text-right text-[13px] text-ink-3">
                  {count} runner{count === 1 ? "" : "s"}
                </span>
                {groups.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setGroups((list) => list.filter((x) => x.id !== g.id));
                      setAthletes((list) => list.map((a) => (a.groupId === g.id ? { ...a, groupId: groups.find((x) => x.id !== g.id)!.id } : a)));
                    }}
                    className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
                    aria-label={`Remove ${g.name}`}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Who's running"
          description={`Goal per ${mainLabel}. Proposed from each runner's 5K (season best, else PR) at ${EFFORT_LABEL[effort]}; type over any of them. Other distances scale from the same pace.`}
          action={
            effort !== "custom" && (
              <Button variant="secondary" size="sm" onClick={() => fillGoals(athletes.some((a) => a.in && a.goal === null) ? "empty" : "all")}>
                {/* Fills the blanks and keeps what's typed; once every goal is set, it refills them all. */}
                {athletes.some((a) => a.in && a.goal === null) ? "Fill goals from 5Ks" : "Refill goals from 5Ks"}
              </Button>
            )
          }
        />
        {(["F", "M", "X"] as const).map((gender) => {
          const rows = athletes.filter((a) => nameOf.get(a.athleteId)?.gender === gender);
          if (rows.length === 0) return null;
          const all = rows.every((a) => a.in);
          return (
            <CardBody key={gender} flush>
              <div className="flex items-center justify-between bg-surface-2 px-4 py-1.5">
                <SectionLabel>{gender === "F" ? "Girls" : gender === "M" ? "Boys" : "Other"}</SectionLabel>
                <button type="button" onClick={() => setAthletes((list) => list.map((a) => (nameOf.get(a.athleteId)?.gender === gender ? { ...a, in: !all } : a)))} className="text-[13px] text-ink-2 hover:text-ink">
                  {all ? "None" : "All"}
                </button>
              </div>
              <div className="divide-y divide-line">
                {rows.map((a) => {
                  const r = nameOf.get(a.athleteId)!;
                  const basis = fiveK[a.athleteId];
                  const draft = goalDraft(a.athleteId, a.goal);
                  const parsed = parseDuration(draft);
                  return (
                    <div key={a.athleteId} className={`flex items-center gap-3 px-4 py-2 ${a.in ? "" : "opacity-50"}`}>
                      <input
                        type="checkbox"
                        checked={a.in}
                        onChange={(e) => setAthletes((list) => list.map((x) => (x.athleteId === a.athleteId ? { ...x, in: e.target.checked } : x)))}
                        className="size-4 shrink-0 accent-brand"
                        aria-label={`${r.name} is running`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{r.name}</div>
                        <div className="truncate text-xs text-ink-3">
                          {r.level}
                          {basis?.sb !== null && basis?.sb !== undefined ? ` · 5K SB ${fmt5K(basis.sb)}` : basis?.pr ? ` · 5K PR ${fmt5K(basis.pr)}` : " · no 5K yet"}
                        </div>
                      </div>
                      {groups.length > 1 && a.in && (
                        <Select value={a.groupId} onChange={(e) => setAthletes((list) => list.map((x) => (x.athleteId === a.athleteId ? { ...x, groupId: e.target.value } : x)))} className="w-28" aria-label={`${r.name}'s group`}>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </Select>
                      )}
                      {a.in && (
                        <div className="w-20 shrink-0">
                          <Input
                            value={draft}
                            onChange={(e) => setGoalFromText(a.athleteId, e.target.value)}
                            placeholder="goal"
                            inputMode="decimal"
                            className={`text-right font-mono ${draft && parsed === null ? "border-danger!" : ""}`}
                            aria-label={`${r.name}'s goal per ${mainLabel}`}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardBody>
          );
        })}
      </Card>

      <Card>
        <CardBody className="border-t-0">
          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink" placeholder="Warm-up, cool-down, what to focus on" />
          </Field>
        </CardBody>
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <Checkbox className="mr-auto" checked={saveAsTemplate} onChange={(e) => setSaveAsTemplate(e.target.checked)} label="Also save the reps as a template" />
        <LinkButton href={cancelHref} variant="secondary">
          Cancel
        </LinkButton>
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : workoutId ? "Save workout" : "Create workout"}
        </Button>
      </div>
    </div>
  );
}

function RestField({ label, value, onChange }: { label: string; value: RestDraft; onChange: (v: RestDraft) => void }) {
  const unit = value.kind === "jog" ? "m" : value.kind === "open" ? null : "sec or m:ss";
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Field label={label}>
          <Select value={value.kind} onChange={(e) => onChange({ kind: e.target.value as RestDraft["kind"], text: value.text })}>
            <option value="time">Rest from the last one in</option>
            <option value="timeMiddle">Rest from the middle one in</option>
            <option value="timeFirst">Rest from the first one in</option>
            <option value="interval">On the clock, every</option>
            <option value="jog">Jog</option>
            <option value="open">Until the coach says go</option>
          </Select>
        </Field>
      </div>
      {unit && (
        <div className="w-28">
          <Input value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} placeholder={unit} inputMode="decimal" aria-label={`${label}: ${unit}`} />
        </div>
      )}
    </div>
  );
}

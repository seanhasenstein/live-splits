"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { commitImportAction, loadResultsAction, type LoadState } from "@/app/actions/import";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, SectionLabel, Segmented, Select, Time } from "@/components/ui";
import type { Athlete } from "@/lib/db/schema";
import { isOurTeam, matchAthlete } from "@/lib/results/match";
import type { ParsedContest } from "@/lib/results/parse";
import { formatElapsed } from "@/lib/time";

/** gender null = a combined race (boys and girls together), which takes one contest per gender. */
type RaceInfo = { id: string; name: string; athleteIds: string[]; hasOfficial: boolean; gender: "F" | "M" | "X" | null };
type RosterAthlete = Pick<Athlete, "_id" | "displayName" | "officialName" | "aliases">;

const NOT_OURS = "__not_ours__";

export function ImportWizard({ meetId, races, athletes, teamAliases, resultsUrl }: { meetId: string; races: RaceInfo[]; athletes: RosterAthlete[]; teamAliases: string[]; resultsUrl: string | null }) {
  const [kind, setKind] = useState<"url" | "text" | "pdf">("url");
  const [state, load, loading] = useActionState(loadResultsAction.bind(null, meetId), {} as LoadState);

  if (state.contests) return <Mapping meetId={meetId} loaded={state} races={races} athletes={athletes} teamAliases={teamAliases} />;

  return (
    <form action={load}>
      <input type="hidden" name="kind" value={kind} />
      <Card>
        <CardBody className="space-y-4 border-t-0">
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: "url", label: "Link" },
              { value: "text", label: "Paste text" },
              { value: "pdf", label: "PDF" },
            ]}
          />
          {kind === "url" && (
            <Field label="Results links" hint="A Badger State Timing or XM Timing meet page (every race at once), or single-race links (RACE RESULT feed, Arrow Live Results page), one per line — several for a combined race.">
              <textarea
                name="url"
                defaultValue={resultsUrl ?? ""}
                placeholder="https://www.badgerstatetiming.live/…"
                required
                rows={2}
                className="control w-full rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-sm text-ink"
              />
            </Field>
          )}
          {kind === "text" && (
            <>
              <Field label="Race name">
                <Input name="name" placeholder="Girls Division 3" />
              </Field>
              <Field label="Results text" hint="Copy the individual results table, including its header line (Pl, Name, Gr, Team, Mile 1, …, Finish).">
                <textarea name="text" rows={10} required className="control w-full rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-[13px] text-ink" />
              </Field>
            </>
          )}
          {kind === "pdf" && (
            <Field label="Results PDFs" hint="One PDF per results contest. Pick several at once for a combined race (boys and girls JV together).">
              <input name="file" type="file" accept="application/pdf" multiple required className="block w-full text-sm text-ink file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink" />
            </Field>
          )}
          {state.error && <Alert tone="danger">{state.error}</Alert>}
        </CardBody>
        <CardBody className="flex justify-end py-3">
          <Button type="submit" disabled={loading}>
            {loading ? "Reading…" : "Read results"}
          </Button>
        </CardBody>
      </Card>
    </form>
  );
}

type Plan = {
  raceId: string;
  /** entryIndex → athleteId, or NOT_OURS. Only our-team rows and manually claimed rows appear. */
  picks: Record<number, string>;
  /** Lineup athletes with no row that should be recorded as DNS. */
  dns: Record<string, boolean>;
};

function guessRace(contestName: string, races: RaceInfo[]): string {
  const n = contestName.toLowerCase();
  return races.find((r) => n.includes(r.name.toLowerCase()))?.id ?? races[0]?.id ?? "";
}

function Mapping({ meetId, loaded, races, athletes, teamAliases }: { meetId: string; loaded: LoadState; races: RaceInfo[]; athletes: RosterAthlete[]; teamAliases: string[] }) {
  const contests = loaded.contests!;
  const [plans, setPlans] = useState<Record<number, Plan | null>>(() => {
    const out: Record<number, Plan | null> = {};
    // A meet page often lists the same race twice (a combined contest and the division
    // contest). Smallest first, keep a contest unless its runners of ours already appear in
    // a kept contest for that race: the division results win over the combined ones, while
    // a boys contest and a girls contest both feeding one combined JV race are both kept.
    const kept = new Set<number>();
    const seenByRace = new Map<string, Set<string>>();
    [...contests.keys()]
      .filter((ci) => contests[ci].entries.some((e) => isOurTeam(e.team, teamAliases)))
      .sort((a, b) => contests[a].entries.length - contests[b].entries.length)
      .forEach((ci) => {
        const raceId = guessRace(contests[ci].name, races);
        const seen = seenByRace.get(raceId) ?? new Set<string>();
        const names = contests[ci].entries.filter((e) => isOurTeam(e.team, teamAliases)).map((e) => e.name.toLowerCase());
        if (names.some((n) => seen.has(n))) return;
        names.forEach((n) => seen.add(n));
        seenByRace.set(raceId, seen);
        kept.add(ci);
      });
    contests.forEach((c, ci) => {
      const ours = c.entries.map((e, i) => ({ e, i })).filter(({ e }) => isOurTeam(e.team, teamAliases));
      if (ours.length === 0 || !kept.has(ci)) {
        out[ci] = null; // nothing of ours, or a duplicate of a kept contest; skipped unless the coach opts in
        return;
      }
      const picks: Record<number, string> = {};
      for (const { e, i } of ours) {
        const m = matchAthlete(e, athletes as Athlete[]);
        picks[i] = m.athlete?._id ?? "";
      }
      out[ci] = { raceId: guessRace(c.name, races), picks, dns: {} };
    });
    return out;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const commit = () => {
    const payloadPlans = Object.entries(plans).flatMap(([ci, plan]) => {
      if (!plan) return [];
      const contest = contests[Number(ci)];
      const assignments = Object.entries(plan.picks)
        .filter(([, athleteId]) => athleteId && athleteId !== NOT_OURS)
        .map(([entryIndex, athleteId]) => ({ entryIndex: Number(entryIndex), athleteId }));
      const newAliases = assignments.flatMap(({ entryIndex, athleteId }) => {
        const a = athletes.find((x) => x._id === athleteId)!;
        const name = contest.entries[entryIndex].name;
        const known = [a.displayName, a.officialName, ...a.aliases].map((s) => s.toLowerCase());
        return known.includes(name.toLowerCase()) ? [] : [{ athleteId, alias: name }];
      });
      return [{ raceId: plan.raceId, contestIndex: Number(ci), assignments, dnsAthleteIds: Object.entries(plan.dns).filter(([, v]) => v).map(([id]) => id), newAliases }];
    });
    if (payloadPlans.length === 0) return setError("Nothing to import: no contest is mapped to a race.");
    // Send only the contests being imported; the rest of the meet's field would be dead weight.
    const used = [...new Set(payloadPlans.map((p) => p.contestIndex))].sort((a, b) => a - b);
    const slim = used.map((ci) => contests[ci]);
    const remap = new Map(used.map((ci, i) => [ci, i]));
    const plansSlim = payloadPlans.map((p) => ({ ...p, contestIndex: remap.get(p.contestIndex)! }));
    start(async () => {
      const result = await commitImportAction(meetId, JSON.stringify({ raw: JSON.stringify(slim), sourceUrl: loaded.sourceUrl ?? null, contests: slim, plans: plansSlim }));
      if (result?.error) setError(result.error);
    });
  };

  // Who is already placed in each race across every contest, so a combined race's second
  // contest doesn't list the first contest's runners as missing.
  const assignedByRace = new Map<string, Set<string>>();
  for (const plan of Object.values(plans)) {
    if (!plan) continue;
    const set = assignedByRace.get(plan.raceId) ?? new Set<string>();
    for (const v of Object.values(plan.picks)) if (v && v !== NOT_OURS) set.add(v);
    assignedByRace.set(plan.raceId, set);
  }

  return (
    <div className="space-y-4">
      {contests.map((c, ci) => (
        <ContestCard
          key={ci}
          contest={c}
          plan={plans[ci]}
          races={races}
          athletes={athletes}
          teamAliases={teamAliases}
          assignedInRace={plans[ci] ? (assignedByRace.get(plans[ci].raceId) ?? new Set()) : new Set()}
          onChange={(p) => setPlans((all) => ({ ...all, [ci]: p }))}
        />
      ))}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => location.reload()}>
          Start over
        </Button>
        <Button onClick={commit} disabled={pending}>
          {pending ? "Importing…" : "Import results"}
        </Button>
      </div>
    </div>
  );
}

function ContestCard({
  contest,
  plan,
  races,
  athletes,
  teamAliases,
  assignedInRace,
  onChange,
}: {
  contest: ParsedContest;
  plan: Plan | null;
  races: RaceInfo[];
  athletes: RosterAthlete[];
  teamAliases: string[];
  /** Athletes placed in this plan's race by any contest. */
  assignedInRace: Set<string>;
  onChange: (p: Plan | null) => void;
}) {
  const ours = useMemo(() => contest.entries.map((e, i) => ({ e, i })).filter(({ e }) => isOurTeam(e.team, teamAliases)), [contest, teamAliases]);
  const race = races.find((r) => r.id === plan?.raceId);
  const missing = race ? race.athleteIds.filter((id) => !assignedInRace.has(id)) : [];
  const nameOf = (id: string) => athletes.find((a) => a._id === id)?.displayName ?? id;

  if (!plan) {
    return (
      <Card>
        <CardHeader
          title={contest.name}
          description={`${contest.entries.length} runners · ${ours.length === 0 ? "none from our team" : `${ours.length} of ours · skipped (another contest covers this race)`}`}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const picks: Record<number, string> = {};
                for (const { e, i } of ours) picks[i] = matchAthlete(e, athletes as Athlete[]).athlete?._id ?? "";
                onChange({ raceId: guessRace(contest.name, races), picks, dns: {} });
              }}
            >
              Include
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={contest.name}
        description={`${contest.entries.length} runners · ${ours.length} of ours · mats: ${contest.splitLabels.join(", ") || "none"}`}
        action={
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Skip
          </Button>
        }
      />
      <CardBody className="space-y-4">
        <Field label="Import into">
          <Select value={plan.raceId} onChange={(e) => onChange({ ...plan, raceId: e.target.value, dns: {} })}>
            {races.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.hasOfficial ? " (has official results; will be replaced)" : ""}
                {r.gender === null ? " · combined" : ""}
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <SectionLabel className="mb-1.5">Our runners in these results</SectionLabel>
          <div className="divide-y divide-line rounded-lg border border-line">
            {ours.map(({ e, i }) => {
              const m = matchAthlete(e, athletes as Athlete[]);
              const value = plan.picks[i] ?? "";
              return (
                <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-ink">{e.name}</span>
                    <span className="tnum ml-2 text-[13px] text-ink-2">
                      {e.status === "finished" ? `${e.place ?? "—"} · ${e.finishMs !== null ? formatElapsed(e.finishMs) : "—"}` : e.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.kind === "exact" && <Badge tone="brand">matched</Badge>}
                    {m.kind === "alias" && <Badge tone="brand">known spelling</Badge>}
                    {value && value !== NOT_OURS && race && !race.athleteIds.includes(value) && <Badge tone="gold">added to lineup</Badge>}
                    {m.kind === "last-name" && !value && <Badge tone="gold">check</Badge>}
                    {m.kind === "none" && !value && (
                      <Badge tone="danger" dot>
                        pick
                      </Badge>
                    )}
                    <select
                      value={value || (m.kind === "last-name" ? "" : value)}
                      onChange={(ev) => onChange({ ...plan, picks: { ...plan.picks, [i]: ev.target.value } })}
                      className="control h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]"
                    >
                      <option value="">Who is this?</option>
                      {(m.kind === "last-name" ? [...m.candidates, ...athletes.filter((a) => !m.candidates.includes(a as Athlete))] : athletes).map((a) => (
                        <option key={a._id} value={a._id}>
                          {a.displayName}
                        </option>
                      ))}
                      <option value={NOT_OURS}>Not one of ours</option>
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-ink-3">A new spelling you confirm is remembered for next time. A runner who isn&rsquo;t in this race&rsquo;s lineup is added to it.</p>
        </div>

        {missing.length > 0 && (
          <div>
            <SectionLabel className="mb-1.5">In the lineup but not in the results</SectionLabel>
            <div className="divide-y divide-line rounded-lg border border-line">
              {missing.map((id) => (
                <label key={id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="font-medium text-ink">{nameOf(id)}</span>
                  <span className="flex items-center gap-2 text-[13px] text-ink-2">
                    <input type="checkbox" className="checkbox" checked={!!plan.dns[id]} onChange={(ev) => onChange({ ...plan, dns: { ...plan.dns, [id]: ev.target.checked } })} />
                    Record as did not start
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        <Time className="block text-xs text-ink-3">
          Official finishes: {ours.filter(({ e }) => e.finishMs !== null).length} · official mat splits: {ours.reduce((n, { e }) => n + Object.keys(e.splits).length, 0)}
        </Time>
      </CardBody>
    </Card>
  );
}

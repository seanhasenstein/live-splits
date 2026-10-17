"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { commitImportAction, loadResultsAction, type LoadState } from "@/app/actions/import";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, SectionLabel, Segmented, Select, Time } from "@/components/ui";
import type { Athlete } from "@/lib/db/schema";
import { guessRace, isOurTeam, matchAthlete } from "@/lib/results/match";
import { type ParsedContest, restrictToDivision } from "@/lib/results/parse";
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
  /** The sheet scored divisions as one field: keep only these teams and let the app rank them. Null: places as printed. */
  divisionTeams: string[] | null;
};

function Mapping({ meetId, loaded, races, athletes, teamAliases }: { meetId: string; loaded: LoadState; races: RaceInfo[]; athletes: RosterAthlete[]; teamAliases: string[] }) {
  const contests = loaded.contests!;
  const [plans, setPlans] = useState<Record<number, Plan | null>>(() => {
    const out: Record<number, Plan | null> = {};
    // A meet page often lists the same race twice (a combined contest and the division
    // contest). Smallest first, keep a contest unless its runners of ours already appear in
    // a kept contest for that race: the division results win over the combined ones, while
    // a boys contest and a girls contest both feeding one combined JV race are both kept.
    // With several contests to choose from, one whose name fits none of the races (a middle
    // school race at a high school meet) starts skipped; a lone contest just goes to the first race.
    const raceFor = (name: string) => guessRace(name, races) ?? (contests.length === 1 ? (races[0]?.id ?? null) : null);
    const kept = new Set<number>();
    const seenByRace = new Map<string, Set<string>>();
    [...contests.keys()]
      .filter((ci) => contests[ci].entries.some((e) => isOurTeam(e.team, teamAliases)))
      .sort((a, b) => contests[a].entries.length - contests[b].entries.length)
      .forEach((ci) => {
        const raceId = raceFor(contests[ci].name);
        if (raceId === null) return;
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
      out[ci] = { raceId: raceFor(c.name)!, picks, dns: {}, divisionTeams: null };
    });
    return out;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const commit = () => {
    // Every flagged runner needs an answer first: a wrong guess is a result on the wrong athlete.
    for (const [ci, plan] of Object.entries(plans)) {
      if (!plan) continue;
      const open = Object.entries(plan.picks).filter(([, v]) => v === "").map(([i]) => contests[Number(ci)].entries[Number(i)].name);
      if (open.length > 0) return setError(`Say who ${open.join(", ")} ${open.length === 1 ? "is" : "are"} (or mark them not one of ours) in ${contests[Number(ci)].name}.`);
    }
    const targeted = new Map<string, number>();
    for (const plan of Object.values(plans)) if (plan) targeted.set(plan.raceId, (targeted.get(plan.raceId) ?? 0) + 1);
    for (const [raceId, n] of targeted) {
      const race = races.find((r) => r.id === raceId);
      if (n > 1 && race && race.gender !== null && race.gender !== "X") return setError(`${race.name} isn't a combined race; pick one set of results for it and skip the other.`);
    }
    // A contest cut down to a division is sent as that smaller field, with the row picks moved along.
    const sent = new Map<number, ParsedContest>();
    const payloadPlans = Object.entries(plans).flatMap(([ci, plan]) => {
      if (!plan) return [];
      const restricted = plan.divisionTeams ? restrictToDivision(contests[Number(ci)], plan.divisionTeams) : null;
      const contest = restricted?.contest ?? contests[Number(ci)];
      sent.set(Number(ci), contest);
      const assignments = Object.entries(plan.picks)
        .filter(([, athleteId]) => athleteId && athleteId !== NOT_OURS)
        .flatMap(([entryIndex, athleteId]) => {
          const i = restricted ? restricted.indexMap.get(Number(entryIndex)) : Number(entryIndex);
          return i === undefined ? [] : [{ entryIndex: i, athleteId }];
        });
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
    const slim = used.map((ci) => sent.get(ci)!);
    const remap = new Map(used.map((ci, i) => [ci, i]));
    const plansSlim = payloadPlans.map((p) => ({ ...p, contestIndex: remap.get(p.contestIndex)! }));
    setError(null);
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
          description={`${contest.entries.length} runners · ${
            ours.length === 0
              ? "none from our team"
              : `${ours.length} of ours · skipped (${guessRace(contest.name, races) === null ? "doesn't look like one of this meet's races" : "another contest covers this race"})`
          }`}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const picks: Record<number, string> = {};
                for (const { e, i } of ours) picks[i] = matchAthlete(e, athletes as Athlete[]).athlete?._id ?? "";
                onChange({ raceId: guessRace(contest.name, races) ?? races[0]?.id ?? "", picks, dns: {}, divisionTeams: null });
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
                      {e.status === "finished" ? `${e.place ?? "—"} · ${e.finishMs !== null ? formatElapsed(e.finishMs, contest.precision) : "—"}` : e.status.toUpperCase()}
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
        <DivisionPicker contest={contest} teamAliases={teamAliases} teams={plan.divisionTeams} onChange={(divisionTeams) => onChange({ ...plan, divisionTeams })} />
        <Time className="block text-xs text-ink-3">
          Official finishes: {ours.filter(({ e }) => e.finishMs !== null).length} · official mat splits: {ours.reduce((n, { e }) => n + Object.keys(e.splits).length, 0)}
        </Time>
      </CardBody>
    </Card>
  );
}

/**
 * For a sheet that scored two divisions as one field: which teams are in ours.
 * The app then ranks them by time; the sheet's places are dropped.
 */
function DivisionPicker({ contest, teamAliases, teams, onChange }: { contest: ParsedContest; teamAliases: string[]; teams: string[] | null; onChange: (teams: string[] | null) => void }) {
  const [open, setOpen] = useState(false);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of contest.entries) if (e.team) m.set(e.team, (m.get(e.team) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [contest]);
  const ourTeams = counts.filter(([t]) => isOurTeam(t, teamAliases)).map(([t]) => t);
  if (!open && !teams) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          onChange(ourTeams.length ? ourTeams : null);
        }}
        className="text-left text-[13px] text-ink-2 underline decoration-line underline-offset-2 hover:text-ink">
        Divisions ran together and these places are for the whole field? Pick our division&rsquo;s teams.
      </button>
    );
  }
  // Once open, what's ticked is exactly the plan; an emptied set shows as "0 of M kept", not as the default again.
  const chosen = new Set(teams ?? []);
  const preview = restrictToDivision(contest, [...chosen]).contest;
  const toggle = (t: string) => {
    const next = new Set(chosen);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    onChange(next.size ? [...next] : null);
  };
  return (
    <div className="rounded-md border border-line bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-ink">Our division&rsquo;s teams</div>
          <div className="text-[13px] text-ink-2">
            Times stay official; places are ranked by the app within these teams and shown as &ldquo;division place&rdquo;. {preview.entries.length} of {contest.entries.length} runners kept.
          </div>
        </div>
        <Button
          size="sm"
          variant="subtle"
          onClick={() => {
            setOpen(false);
            onChange(null);
          }}
        >
          Use the sheet&rsquo;s places
        </Button>
      </div>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        {counts.map(([t, n]) => (
          <Checkbox key={t} label={`${t} (${n})`} checked={chosen.has(t)} onChange={() => toggle(t)} />
        ))}
      </div>
    </div>
  );
}

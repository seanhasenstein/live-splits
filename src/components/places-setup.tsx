"use client";

import { Check, Plus, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { setRacePlacesAction, type TeamSuggestion, teamSuggestionsAction } from "@/app/actions/races";
import { Alert, Button, Input, SectionLabel, Select, Sheet } from "@/components/ui";
import type { AwardLine, RacePlaces, TrackedTeam } from "@/lib/db/schema";
import { PLACE_COLORS, placeColor, shortLabel, teamKey } from "@/lib/race-places";

const MAX_TEAMS = 6;

/**
 * A race's place counting: on or off, the teams that get their own button, the
 * and whether everyone sees places or only coaches and managers.
 */
export function PlacesSetupSheet({ raceId, raceName, initial, onClose, onSaved }: { raceId: string; raceName: string; initial: RacePlaces | null; onClose: () => void; onSaved: () => void }) {
  const [on, setOn] = useState(initial?.on ?? true);
  const [teams, setTeams] = useState<TrackedTeam[]>(initial?.teams ?? []);
  // Award lines aren't shown anywhere any more; whatever a race had is kept as is.
  const awards: AwardLine[] = initial?.awards ?? [];
  const [isPublic, setPublic] = useState(initial?.public ?? false);
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<TeamSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    let cancelled = false;
    teamSuggestionsAction(raceId)
      .then((s) => !cancelled && setSuggestions(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [raceId]);

  const taken = new Set(teams.map((t) => teamKey(t.name)));
  const addTeam = (name: string) => {
    const clean = name.trim();
    if (!clean || teams.length >= MAX_TEAMS) return;
    if (taken.has(teamKey(clean))) return setError(`${clean} is already on the list.`);
    // A team tracked before keeps its label, color and other spellings.
    const known = suggestions.find((s) => teamKey(s.name) === teamKey(clean));
    const used = new Set(teams.map((t) => t.color));
    const color = known?.color && !used.has(known.color) ? known.color : (Object.keys(PLACE_COLORS).find((c) => !used.has(c)) ?? "gray");
    const id = `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setTeams((list) => [...list, { id, name: known?.name ?? clean, short: known?.short ?? shortLabel(clean), color, aliases: known?.aliases ?? [] }]);
    setDraft("");
    setError(null);
  };
  const update = (id: string, patch: Partial<TrackedTeam>) => setTeams((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const save = () => {
    startSaving(async () => {
      const r = await setRacePlacesAction(raceId, { on, teams: teams.map((t) => ({ ...t, short: t.short.trim() || shortLabel(t.name) })), awards, public: isPublic });
      if (r.error) return setError(r.error);
      onSaved();
    });
  };

  return (
    <Sheet title="Places" subtitle={raceName} onClose={onClose}>
      <div className="space-y-5">
        <ToggleRow checked={on} onChange={setOn} label="Count places in this race" hint="Adds team buttons to Record splits. Places show at any checkpoint where someone counts." />

        {on && (
          <>
            <div>
              <SectionLabel className="mb-1">Teams to track</SectionLabel>
              <p className="mb-2 text-xs text-ink-2">Each gets its own button. Up to {MAX_TEAMS}; everyone else is Other.</p>
              <div className="space-y-2">
                {teams.map((t) => (
                  <div key={t.id} className="flex items-start gap-2 rounded-lg border border-line p-2">
                    {/* The button as it will look on the record screen. */}
                    <span className="flex w-16 shrink-0 self-stretch items-center justify-center rounded-md text-base font-bold" style={{ background: placeColor(t.color).bg, color: placeColor(t.color).ink }}>
                      {t.short || shortLabel(t.name)}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Input value={t.name} onChange={(e) => update(t.id, { name: e.target.value })} maxLength={60} aria-label="Team name" />
                      <div className="flex gap-1.5">
                        <Input value={t.short} onChange={(e) => update(t.id, { short: e.target.value.toUpperCase().slice(0, 6) })} className="w-20! text-center font-semibold" aria-label={`${t.name}'s button label`} />
                        <Select value={t.color} onChange={(e) => update(t.id, { color: e.target.value })} className="min-w-0 flex-1" aria-label={`${t.name}'s color`}>
                          {Object.entries(PLACE_COLORS).map(([key, c]) => (
                            <option key={key} value={key}>
                              {c.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                    <button type="button" onClick={() => setTeams((list) => list.filter((x) => x.id !== t.id))} className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label={`Remove ${t.name}`}>
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
              {teams.length < MAX_TEAMS && (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addTeam(draft);
                  }}
                >
                  <Input value={draft} onChange={(e) => setDraft(e.target.value)} list={`teams-${raceId}`} placeholder="Team name, e.g. Kimberly" maxLength={60} className="min-w-0 flex-1" aria-label="Add a team" />
                  <datalist id={`teams-${raceId}`}>
                    {suggestions
                      .filter((s) => !taken.has(teamKey(s.name)))
                      .map((s) => (
                        <option key={s.name} value={s.name} />
                      ))}
                  </datalist>
                  <Button type="submit" variant="secondary" disabled={!draft.trim()}>
                    <Plus className="size-4" />
                    Add
                  </Button>
                </form>
              )}
              {suggestions.some((s) => s.tracked && !taken.has(teamKey(s.name))) && teams.length < MAX_TEAMS && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="text-xs text-ink-3">Tracked before:</span>
                  {suggestions
                    .filter((s) => s.tracked && !taken.has(teamKey(s.name)))
                    .slice(0, 8)
                    .map((s) => (
                      <button key={s.name} type="button" onClick={() => addTeam(s.name)} className="rounded-full border border-line px-2 py-0.5 text-xs text-ink hover:bg-surface-2">
                        + {s.name}
                      </button>
                    ))}
                </div>
              )}
            </div>

            <ToggleRow
              checked={isPublic}
              onChange={setPublic}
              label="Show places to everyone"
              hint={isPublic ? "Parents and runners see places and scores on Live results." : "Only coaches and managers see places. Official finish places always show."}
            />
          </>
        )}

        {error && <Alert tone="danger">{error}</Alert>}
        <Button size="lg" className="w-full" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Sheet>
  );
}

function ToggleRow({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border px-4 py-2 text-left ${checked ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-2"}`}
    >
      <span>
        <span className="block text-base font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink-2">{hint}</span>
      </span>
      <span className={`flex size-5 shrink-0 items-center justify-center rounded border ${checked ? "border-brand bg-brand text-brand-ink" : "border-line-strong"}`}>{checked && <Check className="size-3.5" />}</span>
    </button>
  );
}

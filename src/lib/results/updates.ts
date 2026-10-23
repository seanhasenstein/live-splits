import { normalizeName } from "./match";

/**
 * What a timing company changed since we imported a race: re-read the same link and compare it with
 * the field we stored. Matched by name and team (the same person can't move teams mid-meet; a fixed
 * team is a removal plus an addition, which is what it looks like to us too).
 */

export type FieldRow = { name: string; team: string | null; place: number | null; status: string; timeMs: number | null };
export type FieldChange =
  | { kind: "changed"; name: string; team: string | null; what: string[] }
  | { kind: "added"; name: string; team: string | null; place: number | null; timeMs: number | null; status: string }
  | { kind: "removed"; name: string; team: string | null };

const keyOf = (r: FieldRow) => `${normalizeName(r.name)}|${(r.team ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
const sec = (ms: number | null) => (ms === null ? null : Math.floor(ms / 1000));

/** `places: false` for a division race: its stored places are the app's ranking within our division, not the timer's. */
export function diffField(stored: FieldRow[], fresh: FieldRow[], fmt: (ms: number) => string, options: { places?: boolean } = {}): FieldChange[] {
  if (options.places === false) {
    // Only our division's teams are stored: compare those, without places.
    const teams = new Set(stored.map((r) => (r.team ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")));
    stored = stored.map((r) => ({ ...r, place: null }));
    fresh = fresh.filter((r) => teams.has((r.team ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""))).map((r) => ({ ...r, place: null }));
  }
  const before = new Map(stored.map((r) => [keyOf(r), r]));
  const after = new Map(fresh.map((r) => [keyOf(r), r]));
  const out: FieldChange[] = [];
  for (const [k, now] of after) {
    const was = before.get(k);
    if (!was) {
      out.push({ kind: "added", name: now.name, team: now.team, place: now.place, timeMs: now.timeMs, status: now.status });
      continue;
    }
    const what: string[] = [];
    if (was.status !== now.status) what.push(`${was.status.toUpperCase()} → ${now.status.toUpperCase()}`);
    // Whole seconds, as the reports show them: a tenths re-rounding isn't news.
    if (now.status === "finished" && sec(was.timeMs) !== sec(now.timeMs)) what.push(`time ${was.timeMs === null ? "—" : fmt(was.timeMs)} → ${now.timeMs === null ? "—" : fmt(now.timeMs)}`);
    if (was.place !== now.place) what.push(`place ${was.place ?? "—"} → ${now.place ?? "—"}`);
    if (what.length) out.push({ kind: "changed", name: now.name, team: now.team, what });
  }
  for (const [k, was] of before) if (!after.has(k)) out.push({ kind: "removed", name: was.name, team: was.team });
  // Changes in place order, then additions, then removals.
  const rank = (c: FieldChange) => (c.kind === "changed" ? 0 : c.kind === "added" ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

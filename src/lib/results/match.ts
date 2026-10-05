import type { Athlete } from "@/lib/db/schema";
import type { ParsedEntry } from "./parse";

/** Lowercase, no accents or punctuation, single spaces: "D'Angelo  Ruiz" → "dangelo ruiz". */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does a results row belong to our team? Matches any alias as a prefix (timing sites append "HS", "High School"…). */
export function isOurTeam(team: string | null, aliases: string[]): boolean {
  if (!team) return false;
  const t = normalizeName(team);
  return aliases.some((a) => {
    const n = normalizeName(a);
    return t === n || t.startsWith(`${n} `);
  });
}

export type MatchKind = "exact" | "alias" | "last-name" | "none";

export type Match = { athlete: Athlete | null; kind: MatchKind; candidates: Athlete[] };

/**
 * Find our athlete for a results row. Exact display/official name or a known
 * alias wins. A unique last-name match is offered as a suggestion (first names
 * get misspelled; last names rarely do) but still needs confirmation.
 */
export function matchAthlete(entry: ParsedEntry, athletes: Athlete[]): Match {
  const target = normalizeName(entry.name);
  for (const a of athletes) {
    if (normalizeName(a.displayName) === target || normalizeName(a.officialName) === target) return { athlete: a, kind: "exact", candidates: [a] };
  }
  for (const a of athletes) {
    if (a.aliases.some((alias) => normalizeName(alias) === target)) return { athlete: a, kind: "alias", candidates: [a] };
  }
  const last = normalizeName(entry.lastName);
  const byLast = last ? athletes.filter((a) => normalizeName(a.displayName).endsWith(` ${last}`) || normalizeName(a.officialName).endsWith(` ${last}`)) : [];
  if (byLast.length === 1) return { athlete: null, kind: "last-name", candidates: byLast };
  return { athlete: null, kind: "none", candidates: byLast };
}

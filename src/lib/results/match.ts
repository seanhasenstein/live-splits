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
  if (byLast.length > 1) return { athlete: null, kind: "none", candidates: byLast };
  // A surname typed a letter or two off ("Stoede" for Stroede) with the same first name.
  const first = normalizeName(entry.firstName);
  const near = first
    ? athletes.filter((a) => {
        const [f, ...rest] = normalizeName(a.displayName).split(" ");
        return f === first && rest.length > 0 && editDistance(rest.join(" "), last) <= 2;
      })
    : [];
  return { athlete: null, kind: "none", candidates: near };
}

/** Levenshtein distance, for near-miss surnames. */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const GENDER_WORDS: Record<string, "F" | "M"> = { girls: "F", girl: "F", women: "F", womens: "F", boys: "M", boy: "M", men: "M", mens: "M" };

/** Words of a race or contest name; file names split on their dashes too. */
function raceWords(name: string): string[] {
  return normalizeName(name.replace(/[^A-Za-z0-9]+/g, " ")).split(" ").filter(Boolean);
}

/**
 * Competition levels named in a race or contest name. "Junior" alone says
 * nothing ("Junior Academy Invite"); "junior varsity" is JV and "junior high"
 * is middle school. Open / frosh-soph races are their own level.
 */
function levelsOf(words: string[]): Set<string> {
  const text = ` ${words.join(" ")} `;
  const levels = new Set<string>();
  if (/ (jv\d?|jv [a-c]|jv[a-c]|junior varsity|jr varsity|junior v) /.test(text)) levels.add("jv");
  else if (/ varsity /.test(text)) levels.add("varsity");
  if (/ (ms|jh|middle school|junior high|jr high) /.test(text)) levels.add("ms");
  if (/ (open|frosh|soph|fr so|f s|freshman|freshmen|sophomore|sophomores|c team|reserve|\d{1,2}(st|nd|rd|th) grade|grade \d{1,2}) /.test(text)) levels.add("open");
  return levels;
}

export function guessRace<T extends { id: string; name: string; gender?: "F" | "M" | "X" | null }>(contestName: string, races: T[]): string | null {
  const contestWords = raceWords(contestName);
  const contest = new Set(contestWords);
  const contestLevels = levelsOf(contestWords);
  const contestGenders = new Set(contestWords.flatMap((w) => (GENDER_WORDS[w] ? [GENDER_WORDS[w]] : [])));
  let best: { id: string; score: number } | null = null;
  for (const race of races) {
    const words = raceWords(race.name);
    let score = 0;
    for (const w of new Set(words)) if (contest.has(w)) score += 1;
    if (` ${contestWords.join(" ")} `.includes(` ${words.join(" ")} `)) score += 3;
    const raceLevels = levelsOf(words);
    if (raceLevels.size && contestLevels.size) score += [...raceLevels].some((l) => contestLevels.has(l)) ? 1 : -5; // "JV" ↔ "Junior Varsity"
    const raceGender = race.gender === "F" || race.gender === "M" ? race.gender : null;
    if (raceGender && contestGenders.size && !contestGenders.has(raceGender)) score -= 5;
    if (score > 0 && (!best || score > best.score)) best = { id: race.id, score };
  }
  return best?.id ?? null;
}

/**
 * Whether a race runs boys and girls together, so it can take a boys contest and a girls one.
 * The race category says so when it has no gender, but a combined race is often set up under a
 * gendered category: its name ("Boys & Girls JV") or a lineup with both counts too, as on the board.
 */
export function isCombinedRace(race: { name: string; athleteIds: string[] }, categoryGender: "F" | "M" | "X" | null, genderOf: (athleteId: string) => string | undefined): boolean {
  if (categoryGender === null || categoryGender === "X") return true;
  if (/\b(boys?|men)\b.*\b(girls?|women)\b|\b(girls?|women)\b.*\b(boys?|men)\b|\b(combined|coed|co-ed|mixed)\b/i.test(race.name)) return true;
  const genders = new Set(race.athleteIds.map(genderOf));
  return genders.has("F") && genders.has("M");
}

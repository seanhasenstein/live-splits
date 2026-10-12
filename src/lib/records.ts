/**
 * Which record a finish time sets, given what the runner had to beat. Pure,
 * so the board and the sheet agree and it can be tested without a database.
 */

export type BestsIn = {
  pr: { ms: number } | null;
  sb: { ms: number } | null;
  course: { ms: number } | null;
  meet: { ms: number } | null;
};

export type RecordKind = "pr" | "sb" | "course" | "meet";

export const RECORD_LABEL: Record<RecordKind, { short: string; long: string }> = {
  pr: { short: "PR", long: "personal record" },
  sb: { short: "SB", long: "season best" },
  course: { short: "Course PR", long: "course record for them" },
  meet: { short: "Meet PR", long: "their best at this meet" },
};

/** An app-tapped finish within this of the record could go either way once the mats speak. */
export const UNCERTAIN_MS = 2000;

export type RecordBadge = {
  /** The strongest record set: a PR is also a season best, so only PR shows. */
  kind: RecordKind;
  /** Everything it set, strongest first. */
  all: RecordKind[];
  /** From app taps rather than official results: provisional until the import. */
  unofficial: boolean;
  /** Unofficial and inside UNCERTAIN_MS of the old mark: shown with a question mark. */
  uncertain: boolean;
  /** The mark beaten, for "previous best 16:52". */
  previousMs: number;
};

const ORDER: RecordKind[] = ["pr", "sb", "course", "meet"];

/**
 * Equal to the old mark counts: it's as good as they've ever run. No badge
 * without a previous mark to beat — a first race at a distance is a result,
 * not a record.
 */
export function recordBadge(finishMs: number | null, bests: BestsIn | undefined, official: boolean): RecordBadge | null {
  if (finishMs === null || !bests) return null;
  const all = ORDER.filter((k) => {
    const b = bests[k];
    return b !== null && finishMs <= b.ms;
  });
  if (all.length === 0) return null;
  const kind = all[0];
  const previousMs = bests[kind]!.ms;
  return { kind, all, unofficial: !official, uncertain: !official && previousMs - finishMs < UNCERTAIN_MS, previousMs };
}

import type { HistoryRow } from "./history";

/**
 * Season Times: every athlete by every meet of the season, the grid that goes on the bulletin
 * board after each meet. Pure, so it can be tested without a database.
 */

export type SeasonMeet = { id: string; name: string; shortName?: string | null; date: string };
export type SeasonAthlete = { id: string; name: string; gender: string; grade: number | null };

export type SeasonColumn = { meetId: string; label: string; date: string; future: boolean; latest: boolean };
export type SeasonCell = {
  ms: number;
  jv: boolean;
  /** Equal to their season best to the second (so a runner can carry it across meets). */
  best: boolean;
  /** At or under that meet's varsity letter standard for their gender. */
  letter: boolean;
} | null;
export type SeasonRow = { athlete: SeasonAthlete; cells: SeasonCell[]; bestMs: number | null; races: number };

export function buildSeasonTimes(input: {
  meets: SeasonMeet[];
  athletes: SeasonAthlete[];
  rows: HistoryRow[];
  distanceId: string | null;
  today: string;
  /** Each meet's varsity letter standard by gender, in ms, where known. */
  letterMs?: Record<string, Partial<Record<string, number>>>;
}): { columns: SeasonColumn[]; byGender: Record<string, SeasonRow[]> } {
  const sec = (ms: number) => Math.floor(ms / 1000);
  const meets = [...input.meets].sort((a, b) => a.date.localeCompare(b.date));
  // A meet with results is past whatever its date; one without, on or after today, is still to come.
  const withResults = new Set(input.rows.map((r) => r.meetId));
  const latestId = [...meets].reverse().find((m) => withResults.has(m.id))?.id ?? null;
  const columns = meets.map((m) => ({ meetId: m.id, label: m.shortName ?? shortMeetName(m.name), date: m.date, future: !withResults.has(m.id) && m.date >= input.today, latest: m.id === latestId }));

  const timed = input.rows.filter((r) => r.finishMs !== null && r.status === "finished" && (input.distanceId === null || r.distanceId === input.distanceId));
  const byGender: Record<string, SeasonRow[]> = {};
  for (const athlete of input.athletes) {
    const mine = timed.filter((r) => r.athleteId === athlete.id);
    const best = mine.filter((r) => r.counts).reduce<HistoryRow | null>((b, r) => (b === null || r.finishMs! < b.finishMs! ? r : b), null);
    const cells = columns.map((c): SeasonCell => {
      // Two races at one meet (rare): the faster one.
      const here = mine.filter((r) => r.meetId === c.meetId).sort((a, b) => a.finishMs! - b.finishMs!)[0];
      if (!here) return null;
      const standard = input.letterMs?.[c.meetId]?.[athlete.gender];
      return {
        ms: here.finishMs!,
        jv: here.levelId === "jv",
        best: best !== null && here.counts && sec(here.finishMs!) === sec(best.finishMs!),
        letter: standard !== undefined && sec(here.finishMs!) <= sec(standard),
      };
    });
    (byGender[athlete.gender] ??= []).push({ athlete, cells, bestMs: best?.finishMs ?? null, races: mine.length });
  }
  // Rows: the latest meet's varsity runners first, then everyone else, then anyone with fewer than
  // three races this season; each group by season best (none last), then name.
  const latest = columns.findIndex((c) => c.latest);
  const group = (r: SeasonRow) => (latest >= 0 && r.cells[latest] && !r.cells[latest]!.jv ? 0 : r.races >= 3 ? 1 : 2);
  for (const rows of Object.values(byGender)) rows.sort((a, b) => group(a) - group(b) || (a.bestMs ?? Infinity) - (b.bestMs ?? Infinity) || a.athlete.name.localeCompare(b.athlete.name));
  return { columns, byGender };
}

const GENERIC = /\b(invite|invitational|meet|classic|championships?|conference|cross country|xc|annual|\d+(st|nd|rd|th)|the|wiaa|division \d|d\d|20\d\d)\b/gi;

/**
 * A column-width name for a meet: "Kettle Moraine Lutheran Invite" → "KML", "Big East Conference
 * Championship" → "Big East", "WIAA Division 3 Sectional" → "Sectional", "KML Charger Classic" →
 * "KML", "Crusader Challenge" → "Crusader". Three or more words left become initials; two stay as
 * words when they're short, else the first word. A meet's own short name always wins.
 */
export function shortMeetName(name: string): string {
  const words = name.replace(GENERIC, " ").replace(/[^\p{L}\p{N}' -]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return name.trim().slice(0, 12);
  if (words.length >= 3) return words.map((w) => w[0].toUpperCase()).join("");
  // An acronym leads ("KML Charger"), or two words are too wide for a grid column ("Crusader Challenge"): the first word.
  if (words.length === 2 && (/^[A-Z]{2,}$/.test(words[0]) || words.join(" ").length > 10)) return words[0];
  return words.join(" ");
}

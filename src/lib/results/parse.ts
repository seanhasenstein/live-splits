import { parseElapsed } from "@/lib/time";

/**
 * Official results from a timing company, in one shape regardless of source.
 * Adapters turn a vendor's JSON / text / PDF text into ParsedContest[].
 */

export type ParsedStatus = "finished" | "dnf" | "dns" | "dq";

export type ParsedEntry = {
  firstName: string;
  lastName: string;
  /** "First Last" as the timing company printed it. */
  name: string;
  team: string | null;
  grade: number | null;
  bib: string | null;
  place: number | null;
  status: ParsedStatus;
  finishMs: number | null;
  /** Cumulative times at named mats, e.g. { "Mile 1": 302300 }. */
  splits: Record<string, number>;
};

export type ParsedContest = {
  name: string;
  distanceMeters: number | null;
  /** Mat labels in course order, e.g. ["Mile 1", "Mile 2"]. */
  splitLabels: string[];
  entries: ParsedEntry[];
  /** Where it came from, for the import record. */
  source: { kind: "raceresult" | "text"; url?: string };
};

const STATUS_WORDS: Record<string, ParsedStatus> = { DNF: "dnf", DNS: "dns", DQ: "dq", DNR: "dns" };

function placeAndStatus(raw: unknown): { place: number | null; status: ParsedStatus } {
  if (typeof raw === "number") return { place: raw, status: "finished" };
  const text = String(raw ?? "").trim().toUpperCase();
  if (text in STATUS_WORDS) return { place: null, status: STATUS_WORDS[text] };
  const n = Number(text);
  return Number.isInteger(n) && n > 0 ? { place: n, status: "finished" } : { place: null, status: "finished" };
}

const toGrade = (raw: unknown): number | null => {
  const n = Number(String(raw ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 13 ? n : null;
};

/** RACE RESULT per-contest JSON (api.raceresult.com/<event>/<key>): columns Place, Bib, Firstname, Lastname, Team, Grade, <mat>, <mat>_Rank, Finish. */
export function parseRaceResultJson(rows: Record<string, unknown>[], contestName: string, url?: string): ParsedContest {
  const columns = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) columns.add(k);
  const reserved = new Set(["Place", "Bib", "Firstname", "Lastname", "Team", "Grade", "Finish", "Points"]);
  const splitLabels = [...columns].filter((c) => !reserved.has(c) && !c.endsWith("_Rank") && !c.endsWith("_Points"));

  const entries = rows.map((r): ParsedEntry => {
    const { place, status } = placeAndStatus(r.Place);
    const firstName = String(r.Firstname ?? "").trim();
    const lastName = String(r.Lastname ?? "").trim();
    const splits: Record<string, number> = {};
    for (const label of splitLabels) {
      const ms = parseElapsed(String(r[label] ?? ""));
      if (ms !== null) splits[label] = ms;
    }
    const finishMs = parseElapsed(String(r.Finish ?? ""));
    return {
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
      team: r.Team ? String(r.Team).trim() : null,
      grade: toGrade(r.Grade),
      bib: r.Bib != null && String(r.Bib) !== "" ? String(r.Bib) : null,
      place,
      status: status === "finished" && finishMs === null ? "dnf" : status,
      finishMs,
      splits,
    };
  });
  return { name: contestName, distanceMeters: null, splitLabels, entries, source: { kind: "raceresult", url } };
}

const TIME_RE = /^\d{1,2}:\d{2}(?:\.\d{1,2})?$/;

/**
 * Mat labels from the header text between "Team" and "Finish". PDF text often
 * collapses spacing ("Mile 1 Mile 2"), so a word followed by a number-ish
 * token is one label: "Mile 1", "Mile 2", "2K", "3 km".
 */
export function headerLabels(between: string): string[] {
  if (!between) return [];
  if (/\s{2,}/.test(between)) return between.split(/\s{2,}/).map((t) => t.trim()).filter(Boolean);
  const tokens = between.split(/\s+/).filter(Boolean);
  const labels: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (/^[A-Za-z]+$/.test(t) && next && /^\d/.test(next)) {
      labels.push(`${t} ${next}`);
      i++;
    } else labels.push(t);
  }
  return labels;
}

/**
 * Results pasted as text (or extracted from a PDF): one athlete per line,
 *   "<place|DNF> <name> <grade> <team> <time> <time> ... <finish> [pts]"
 * Mat labels come from a header line containing "Name" and "Finish"
 * (e.g. "Pl Name Gr Team Mile 1 Mile 2 Finish Pts"); otherwise "Split 1", "Split 2"….
 */
export function parseResultsText(text: string, contestName = "Pasted results"): ParsedContest {
  const lines = text.split(/\r?\n/);
  let splitLabels: string[] | null = null;
  const entries: ParsedEntry[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (splitLabels === null && /\bName\b/i.test(line) && /\bFinish\b/i.test(line)) {
      // Header: everything between "Team" and "Finish" is the mat labels.
      const m = line.match(/\bTeam\b(.*?)\bFinish\b/i);
      splitLabels = headerLabels((m?.[1] ?? "").trim());
      continue;
    }
    const tokens = line.split(/\s+/);
    const { place, status } = placeAndStatus(tokens[0]);
    if (place === null && status === "finished") continue; // not a result row
    // Times are the trailing tokens that look like m:ss.t; an optional points integer may follow.
    const rest = tokens.slice(1);
    let end = rest.length;
    if (/^\d+$/.test(rest[end - 1] ?? "")) end--; // points
    let start = end;
    while (start > 0 && TIME_RE.test(rest[start - 1])) start--;
    const times = rest.slice(start, end).map((t) => parseElapsed(t) ?? 0);
    if (times.length === 0) continue; // team-score rows and other numeric lines have no times
    const before = rest.slice(0, start);
    // "<name words> <grade> <team words>": grade is the first bare 1-2 digit token.
    const gradeIdx = before.findIndex((t) => /^\d{1,2}$/.test(t));
    const nameWords = gradeIdx >= 0 ? before.slice(0, gradeIdx) : before;
    const team = gradeIdx >= 0 ? before.slice(gradeIdx + 1).join(" ") : null;
    if (nameWords.length === 0) continue;
    const labels = splitLabels ?? times.slice(0, -1).map((_, i) => `Split ${i + 1}`);
    const finished = status === "finished";
    const matTimes = finished ? times.slice(0, Math.max(0, times.length - 1)) : times;
    const splits: Record<string, number> = {};
    matTimes.forEach((ms, i) => {
      if (labels[i]) splits[labels[i]] = ms;
    });
    const [firstName, ...lastParts] = nameWords;
    entries.push({
      firstName,
      lastName: lastParts.join(" "),
      name: nameWords.join(" "),
      team,
      grade: gradeIdx >= 0 ? toGrade(before[gradeIdx]) : null,
      bib: null,
      place,
      status,
      finishMs: finished ? (times.at(-1) ?? null) : null,
      splits,
    });
  }
  return { name: contestName, distanceMeters: null, splitLabels: splitLabels ?? [], entries, source: { kind: "text" } };
}

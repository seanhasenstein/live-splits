import type { Precision } from "@/lib/db/schema";
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
  source: { kind: "raceresult" | "arrow" | "athleticlive" | "text"; url?: string };
  /** Decimals the sheet carries: whole seconds, tenths, hundredths. Never shown finer than this. */
  precision: Precision;
  /** Set when the field was cut down to a division's teams and places recomputed by the app (see restrictToDivision). */
  division?: { teams: string[] };
};

/**
 * A division's results out of a combined race the timing company scored as
 * one field: keep only these teams and rank the finishers again by time.
 * Times stay official; places become the app's, and the contest says so.
 * Ties on the clock share a place, the next place skipping, as the sheets
 * do. `indexMap` says where each kept entry went, for row assignments made
 * against the full field.
 */
export function restrictToDivision(contest: ParsedContest, teams: string[]): { contest: ParsedContest; indexMap: Map<number, number> } {
  const keep = new Set(teams.map((t) => t.trim().toLowerCase()));
  const kept = contest.entries.map((e, i) => ({ e, i })).filter(({ e }) => e.team && keep.has(e.team.trim().toLowerCase()));
  const finishers = kept.filter(({ e }) => e.status === "finished" && e.finishMs !== null).sort((a, b) => a.e.finishMs! - b.e.finishMs! || a.i - b.i);
  const place = new Map<number, number>();
  finishers.forEach(({ e, i }, rank) => {
    const prev = finishers[rank - 1];
    place.set(i, prev && prev.e.finishMs === e.finishMs ? place.get(prev.i)! : rank + 1);
  });
  // Field order: finishers by place, then everyone else as the sheet had them.
  const ordered = [...finishers, ...kept.filter(({ e }) => !(e.status === "finished" && e.finishMs !== null))];
  const indexMap = new Map(ordered.map(({ i }, n) => [i, n]));
  return {
    contest: { ...contest, name: `${contest.name} · division`, entries: ordered.map(({ e, i }) => ({ ...e, place: place.get(i) ?? null })), division: { teams } },
    indexMap,
  };
}

/** The finest precision any of these time strings carries ("16:16" → seconds, "17:09.87" → hundredths). */
export function precisionOf(times: Iterable<string>): Precision {
  let digits = 0;
  for (const t of times) {
    const d = t.match(/\.(\d+)\s*$/)?.[1].length ?? 0;
    if (d > digits) digits = d;
  }
  return (["seconds", "tenths", "hundredths", "thousandths"] as const)[Math.min(digits, 3)];
}

const STATUS_WORDS: Record<string, ParsedStatus> = { DNF: "dnf", DNS: "dns", DQ: "dq", DNR: "dns" };

function placeAndStatus(raw: unknown): { place: number | null; status: ParsedStatus } {
  if (typeof raw === "number") return { place: Number.isInteger(raw) && raw > 0 ? raw : null, status: "finished" };
  const text = String(raw ?? "").trim().toUpperCase();
  if (text in STATUS_WORDS) return { place: null, status: STATUS_WORDS[text] };
  const n = Number(text.replace(/(?<=\d)(st|nd|rd|th)$/i, "")); // "1st", "22nd"
  return Number.isInteger(n) && n > 0 ? { place: n, status: "finished" } : { place: null, status: "finished" };
}

const YEAR_GRADE: Record<string, number> = { FR: 9, SO: 10, JR: 11, SR: 12 };

const toGrade = (raw: unknown): number | null => {
  const text = String(raw ?? "").trim();
  const year = YEAR_GRADE[text.replace(/\.$/, "").toUpperCase()];
  if (year) return year;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 13 ? n : null;
};

/** A grade column value: "9"–"12", or a class year printed in capitals ("JR"; "Jr." is a name suffix). */
const isGradeToken = (t: string) => /^\d{1,2}$/.test(t) || /^(FR|SO|JR|SR)\.?$/.test(t);

/** RACE RESULT per-contest JSON (api.raceresult.com/<event>/<key>): columns Place, Bib, Firstname, Lastname, Team, Grade, <mat>, <mat>_Rank, Finish. */
export function parseRaceResultJson(rows: Record<string, unknown>[], contestName: string, url?: string, options: { live?: boolean } = {}): ParsedContest {
  const columns = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) columns.add(k);
  const reserved = new Set(["Place", "Bib", "Firstname", "Lastname", "Team", "Grade", "Finish", "Points"]);
  const splitLabels = [...columns].filter((c) => !reserved.has(c) && !c.endsWith("_Rank") && !c.endsWith("_Points"));

  const timeStrings: string[] = [];
  const entries = rows.map((r): ParsedEntry => {
    const { place, status } = placeAndStatus(r.Place);
    const firstName = String(r.Firstname ?? "").trim();
    for (const label of [...splitLabels, "Finish"]) timeStrings.push(String(r[label] ?? ""));
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
      // Final results: a row with no finish and no status word is a DNF. Live: they just haven't finished yet.
      status: status === "finished" && finishMs === null && !options.live ? "dnf" : status,
      finishMs,
      splits,
    };
  });
  return { name: contestName, distanceMeters: null, splitLabels, entries, source: { kind: "raceresult", url }, precision: precisionOf(timeStrings) };
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
 *   "<place|DNF> [overall place] <name> <grade|FR..SR> <team> <time> <time> ... <finish> [pts|(pts)]"
 * Places may be ordinals ("1st"); a bare number between the place and the name
 * is the runner's place in the combined race when results were split into
 * divisions afterwards, and is skipped.
 * Mat labels come from a header line containing "Name" and "Finish"
 * (e.g. "Pl Name Gr Team Mile 1 Mile 2 Finish Pts"); otherwise "Split 1", "Split 2"….
 */
export function parseResultsText(text: string, contestName = "Pasted results"): ParsedContest {
  const lines = text.split(/\r?\n/);
  let splitLabels: string[] | null = null;
  const entries: ParsedEntry[] = [];
  const timeStrings: string[] = [];

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
    // Points, "(13)" for a displacer: after a finish, or after a DNF's last split; "DNF Sam Who 11" keeps its grade.
    if (/^\(?\d+\)?$/.test(rest[end - 1] ?? "") && (status === "finished" || TIME_RE.test(rest[end - 2] ?? ""))) end--;
    let start = end;
    while (start > 0 && TIME_RE.test(rest[start - 1])) start--;
    const times = rest.slice(start, end).map((t) => parseElapsed(t) ?? 0);
    timeStrings.push(...rest.slice(start, end));
    let before = rest.slice(0, start);
    // An overall-place column before the name: a bare number (or a dash), then name words, then the grade.
    if (/^(\d+|[-–—])$/.test(before[0] ?? "") && before.length > 2 && !isGradeToken(before[1]) && before.slice(1).some(isGradeToken)) before = before.slice(1);
    // "<name words> <grade> <team words>": the first grade-like token, except that a number right
    // after a class year is the grade and the class year a name suffix ("SMITH JR 11 Team"); a number
    // later in the team name ("SR St. Mary 2") isn't.
    const yearIdx = before.findIndex((t) => isGradeToken(t) && !/^\d/.test(t));
    const numericIdx = before.findIndex((t) => /^\d{1,2}$/.test(t));
    const gradeIdx = numericIdx >= 0 && (yearIdx < 0 || numericIdx < yearIdx || numericIdx === yearIdx + 1) ? numericIdx : yearIdx;
    // Team-score rows and other numeric lines have no times; a DNF/DNS row without one still needs a grade
    // to count, so a legend line ("DNF = Did Not Finish") doesn't become a runner.
    if (times.length === 0 && (status === "finished" || gradeIdx < 0)) continue;
    const nameWords = gradeIdx >= 0 ? before.slice(0, gradeIdx) : before;
    const team = gradeIdx >= 0 ? before.slice(gradeIdx + 1).join(" ") : null;
    if (nameWords.length === 0) continue;
    const finished = status === "finished";
    // Every time but the finish is a mat split; a non-finisher's times are all splits.
    const matTimes = finished ? times.slice(0, Math.max(0, times.length - 1)) : times;
    const labels = splitLabels ?? matTimes.map((_, i) => `Split ${i + 1}`);
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
  return { name: contestName, distanceMeters: null, splitLabels: splitLabels ?? [], entries, source: { kind: "text" }, precision: precisionOf(timeStrings) };
}

/**
 * AthleticLIVE (athletic.net's live results, used by Trackside Timing and other timers): one race's
 * document, `ind_res_list/_doc/<race id>`, the same JSON its race page reads. `r` holds one row per
 * runner: place `p`, the mark as printed `m` and in ms `im`, and the athlete `a` (first `fn`, last `l`,
 * grade `y`, bib `cm`, team `t.n`). `live`: a row without a finish is still running, not a DNF.
 */
export function parseAthleticLiveJson(doc: unknown, pageUrl: string, options: { live?: boolean } = {}): ParsedContest {
  type Row = { p?: unknown; m?: unknown; im?: unknown; a?: { n?: unknown; fn?: unknown; l?: unknown; y?: unknown; cm?: unknown; t?: { n?: unknown; f?: unknown } } };
  const src = ((doc ?? {}) as { _source?: { n?: unknown; ab?: unknown; r?: unknown } })._source ?? {};
  const rows: Row[] = Array.isArray(src.r) ? (src.r as Row[]) : [];
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
  const timeStrings: string[] = [];
  const entries = rows.flatMap((r): ParsedEntry[] => {
    const firstName = str(r.a?.fn);
    const lastName = str(r.a?.l);
    const name = `${firstName} ${lastName}`.trim() || str(r.a?.n);
    if (!name) return [];
    const mark = str(r.m);
    const fromPlace = placeAndStatus(str(r.p));
    // A status can sit in the place or in the mark ("DNF").
    const status = fromPlace.status !== "finished" ? fromPlace.status : placeAndStatus(mark).status;
    const ms = typeof r.im === "number" && r.im > 0 ? Math.round(r.im) : status === "finished" ? parseElapsed(mark) : null;
    const finishMs = status === "finished" ? ms : null;
    if (finishMs !== null) timeStrings.push(mark);
    return [
      {
        firstName,
        lastName,
        name,
        team: str(r.a?.t?.n) || str(r.a?.t?.f) || null,
        grade: toGrade(r.a?.y),
        bib: str(r.a?.cm) || null,
        place: status === "finished" && finishMs !== null ? fromPlace.place : null,
        // Final results: no finish and no status word is a DNF. Live: they just haven't finished yet.
        status: status === "finished" && finishMs === null && !options.live ? "dnf" : status,
        finishMs,
        splits: {},
      },
    ];
  });
  const meters = str(src.ab).match(/^(\d+(?:\.\d+)?)\s*m$/i);
  return {
    name: str(src.n) || "AthleticLIVE race",
    distanceMeters: meters ? Number(meters[1]) : null,
    splitLabels: [],
    entries,
    source: { kind: "athleticlive", url: pageUrl },
    precision: precisionOf(timeStrings),
  };
}

/** A column-per-cell header ("Place Points Bib Name School Gender Grade Time Pace"), told apart from the "… Finish" layouts above. */
export const COLUMN_HEADER_RE = /^\s*Place\b(?=.*\bName\b)(?=.*\b(?:School|Team)\b)(?=.*\bTime\b)(?!.*\bFinish\b).*$/im;

const RACE_HEADING_RE = /\b(boys|girls|men|women|varsity|jv|junior|open|middle|elementary)\b/i;

/**
 * Column-per-cell results: Trackside Timing's "All Contests" PDF (AthleticLIVE). One header row of
 * column names, then a heading line ("Boys Varsity") before each race's rows. The text must have a
 * tab between the PDF's text items: without them a name and a school run together with no way to
 * tell where one ends ("Eddy Giebler Sheboygan Area Lutheran"). One contest per heading.
 */
export function parseColumnResults(text: string, fallbackName: string): ParsedContest[] {
  const contests: ParsedContest[] = [];
  let cols: { place: number; name: number; team: number; grade: number; time: number; bib: number; points: number; count: number } | null = null;
  let current: { name: string; entries: ParsedEntry[]; times: string[] } | null = null;
  // A line that may name a race. It only starts one if the next runner is first: a page footer can
  // name the meet ("Lakeshore Boys & Girls Invite") in the middle of a race.
  let heading: string | null = null;
  const close = () => {
    if (current && current.entries.length > 0)
      contests.push({ name: current.name, distanceMeters: null, splitLabels: [], entries: current.entries, source: { kind: "text" }, precision: precisionOf(current.times) });
  };

  for (const line of text.split(/\r?\n/)) {
    const cells = line.split("\t").map((c) => c.trim()).filter(Boolean);
    if (cells.length === 0) continue;
    const lower = cells.map((c) => c.toLowerCase());
    if (lower.includes("name") && lower.includes("time") && lower.includes("place")) {
      const at = (...names: string[]) => lower.findIndex((c) => names.includes(c));
      cols = { place: at("place"), name: at("name"), team: at("school", "team"), grade: at("grade", "gr", "yr", "year"), time: at("time"), bib: at("bib"), points: at("points", "pts"), count: cells.length };
      continue;
    }
    if (!cols) continue;
    if (cells.length === 1 && RACE_HEADING_RE.test(cells[0]) && placeAndStatus(cells[0]).place === null) {
      heading = cells[0];
      continue;
    }
    const { place, status } = placeAndStatus(cells[cols.place]);
    // A DNF has no time or pace at the end of its row ("DNF -- 9839 Sam Who Team"); a non-scorer's points can be blank rather than "(n/a)".
    const row =
      status !== "finished" && cells.length < cols.count && cols.time >= cells.length
        ? [...cells, ...Array<string>(cols.count - cells.length).fill("")]
        : cells.length === cols.count - 1 && cols.points >= 0
          ? [...cells.slice(0, cols.points), "", ...cells.slice(cols.points)]
          : cells;
    if (row.length !== cols.count) continue;
    if (place === null && status === "finished") continue;
    const timeText = row[cols.time] ?? "";
    // A walker's hour-plus finish ("1:14:38.4") counts too.
    const finishMs = /^\d{1,2}(?::\d{2}){1,2}(?:\.\d{1,3})?$/.test(timeText) ? parseElapsed(timeText) : null;
    if (status === "finished" && finishMs === null) continue;
    const nameWords = (row[cols.name] ?? "").split(/\s+/).filter(Boolean);
    if (nameWords.length === 0) continue;
    if (heading !== null && (current === null || place === 1)) {
      close();
      current = { name: heading, entries: [], times: [] };
    }
    heading = null;
    current ??= { name: fallbackName, entries: [], times: [] };
    if (finishMs !== null) current.times.push(timeText);
    const [firstName, ...lastParts] = nameWords;
    current.entries.push({
      firstName,
      lastName: lastParts.join(" "),
      name: nameWords.join(" "),
      team: cols.team >= 0 ? row[cols.team] || null : null,
      grade: cols.grade >= 0 ? toGrade(row[cols.grade]) : null,
      bib: cols.bib >= 0 ? row[cols.bib]?.replace(/^#/, "") || null : null,
      place,
      status,
      finishMs: status === "finished" ? finishMs : null,
      splits: {},
    });
  }
  close();
  return contests;
}

export const stripTags = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/**
 * Arrow Live Results (used by XM Timing): the `/Results/pvResults` partial is
 * a table of Place, Bib#, Name, Team, Gender, Age, Finish (hh:mm:ss.cc). No
 * mat splits and no grade. The page updates live, so with `live` a row without
 * a finish is still running rather than a DNF.
 */
export function parseArrowResultsHtml(html: string, contestName: string, url?: string, options: { live?: boolean } = {}): ParsedContest {
  const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? "";
  const entries: ParsedEntry[] = [];
  const timeStrings: string[] = [];
  for (const row of body.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 7) continue;
    const { place, status } = placeAndStatus(stripTags(cells[0]));
    // The name cell carries a "#bib" for phones plus the linked name; take the link text.
    const name = stripTags(cells[2].match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? cells[2].replace(/#\d+/, ""));
    if (!name) continue;
    const words = name.split(" ");
    const finishText = stripTags(cells[6]).split(" ")[0] ?? "";
    const finishMs = /^\d/.test(finishText) ? parseElapsed(finishText) : null;
    if (finishMs !== null) timeStrings.push(finishText);
    entries.push({
      firstName: words[0] ?? "",
      lastName: words.slice(1).join(" "),
      name,
      team: stripTags(cells[3]) || null,
      grade: null,
      bib: stripTags(cells[1]) || null,
      place,
      status: status === "finished" && finishMs === null && !options.live ? "dnf" : status,
      finishMs,
      splits: {},
    });
  }
  return { name: contestName, distanceMeters: null, splitLabels: [], entries, source: { kind: "arrow", url }, precision: precisionOf(timeStrings) };
}

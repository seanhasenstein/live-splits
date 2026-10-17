import { parseElapsed } from "@/lib/time";
import { METERS_PER_MILE } from "@/lib/pace";

/**
 * The team's own post-meet split sheets, one PDF for years of meets: per
 * meet a header line "Meet name, Month Dth YYYY", a summary line per race,
 * then a table per gender — name, one segment time per stretch of the
 * course ("Mile 1", "Mile 2", "Mile 3.1"), Finish, Place ("39th JV" for the
 * JV race), Letter. Segment times add up to the finish; a blank row is an
 * athlete who didn't run; "DNF" marks where someone dropped out.
 */

export type HistoryRow = {
  name: string;
  gender: "M" | "F";
  level: "varsity" | "jv";
  /** Cumulative time from the gun at each split checkpoint, by label ("Mile 1", "Mile 2"). The finish is separate. */
  splits: Record<string, number>;
  finishMs: number | null;
  place: number | null;
  status: "finished" | "dnf" | "dns";
  letter: boolean;
  /** The segment times didn't add up to the finish (a collapsed empty cell, a cumulative sheet): splits were dropped. */
  splitsUnreadable: boolean;
};

export type HistoryMeet = {
  name: string;
  /** ISO local date. */
  date: string;
  /** Split checkpoints before the finish, in course order, with their distance from the start. */
  checkpoints: { label: string; meters: number }[];
  /** Course length, from the last column's label ("Mile 3.1" → 5 km) when it reads as a distance. */
  distanceMeters: number | null;
  rows: HistoryRow[];
  /** The race summary lines, kept for the review screen. */
  summaries: string[];
};

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "August 28th 2025" → "2025-08-28". */
export function parseLongDate(text: string): string | null {
  const m = text.trim().match(/^([A-Za-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/);
  if (!m) return null;
  const word = m[1].toLowerCase();
  const month = MONTHS.findIndex((name) => name === word || (word.length >= 3 && name.startsWith(word)));
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** "Mile 1" → 1609 m, "Mile 3.1" → 4989 m (the 5K finish is read as 5000 by the caller), "2K" → 2000 m. */
function metersOf(label: string): number | null {
  const mi = label.match(/^mile\s+(\d+(?:\.\d+)?)$/i) ?? label.match(/^(\d+(?:\.\d+)?)\s*mi(?:le)?s?$/i);
  if (mi) return Number(mi[1]) * METERS_PER_MILE;
  const km = label.match(/^(\d+(?:\.\d+)?)\s*k(?:m)?$/i);
  if (km) return Number(km[1]) * 1000;
  return null;
}

const ROUND_DISTANCES = [5000, 4000, 3000, 2000, 6000, 8000, 10000, 3218.688];

/**
 * The sheet's last column names the full course ("Mile 3.1"): snap it to the
 * race distance it means. "Mile 3" on a high-school sheet is a 5K too — the
 * column is the last stretch, not a survey — so anything within 5% of 5000 m
 * is a 5K.
 */
function courseMeters(lastLabel: string): number | null {
  const m = metersOf(lastLabel);
  if (m === null) return null;
  if (Math.abs(5000 - m) / 5000 <= 0.05) return 5000;
  const near = ROUND_DISTANCES.find((d) => Math.abs(d - m) / d < 0.02);
  return near ?? Math.round(m);
}

export function parseSplitsHistory(text: string): HistoryMeet[] {
  const meets: HistoryMeet[] = [];
  let meet: HistoryMeet | null = null;
  let gender: "M" | "F" | null = null;
  let labels: string[] = []; // segment columns between the gender column and Finish
  let letterCol = -1;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^-- \d+ of \d+ --$/.test(line.trim())) continue;

    // "Kettle Moraine Lutheran Invite, August 28th 2025"
    const head = line.match(/^(.+?),\s+([A-Za-z]+\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4})$/);
    if (head && !line.includes("\t")) {
      const date = parseLongDate(head[2]);
      if (date) {
        const name = head[1].trim();
        meet = meets.find((m) => m.name === name && m.date === date) ?? null;
        if (!meet) {
          meet = { name, date, checkpoints: [], distanceMeters: null, rows: [], summaries: [] };
          meets.push(meet);
        }
        gender = null;
        continue;
      }
    }
    if (!meet) continue;

    const cells = line.split("\t").map((c) => c.trim());
    // Table header: "Boys | Mile 1 | Mile 2 | Mile 3.1 | Finish | Place | Letter"
    if (cells.length >= 3 && /^(boys|girls|men|women)$/i.test(cells[0]) && cells.some((c) => /^finish$/i.test(c))) {
      gender = /^(boys|men)$/i.test(cells[0]) ? "M" : "F";
      const finishCol = cells.findIndex((c) => /^finish$/i.test(c));
      labels = cells.slice(1, finishCol);
      letterCol = cells.findIndex((c) => /^letter$/i.test(c));
      if (meet.checkpoints.length === 0 && labels.length > 0) {
        meet.checkpoints = labels.slice(0, -1).flatMap((label) => {
          const meters = metersOf(label);
          return meters === null ? [] : [{ label, meters }];
        });
        meet.distanceMeters = courseMeters(labels[labels.length - 1]);
      }
      continue;
    }
    // Race summary lines: "Boys Varsity - 110 Pts. 5th Place. 9 Teams. …" (tabs or not)
    if (/^(boys|girls|men|women)\b.*\b(pts|place|teams|runners)\b/i.test(cells[0]) && !cells.some((c) => TIME_OR_STATUS.test(c))) {
      meet.summaries.push(line.trim());
      continue;
    }
    if (!gender || cells.length < 2) continue; // a blank row (name only): didn't run
    // A result row has a time or a status right after the name; anything else with tabs (a footer) isn't one.
    if (!TIME_OR_STATUS.test(cells[1])) continue;

    const name = cells[0];
    // Read the cells by what they are, not where they sit: the text layer drops empty cells, so a missing
    // Mile 2 shifts everything left. Times in order, then a place ("16th", "39th JV"), then the letter.
    const rest = cells.slice(1);
    const timeCells = rest.filter((c) => /^\d+:\d{2}(\.\d+)?$/.test(c)).map((c) => parseElapsed(c)!);
    const placeText = rest.find((c) => /^\d+(st|nd|rd|th)\b/i.test(c)) ?? "";
    const dns = rest.some((c) => /^dns$/i.test(c));
    const dnf = !dns && rest.some((c) => /^dnf$/i.test(c));
    const finishMs = dns || dnf ? null : (timeCells.at(-1) ?? null);
    const segMs: (number | null)[] = dns || dnf ? timeCells : timeCells.slice(0, -1);
    // Segment times accumulate; the last segment ends at the finish, so only the earlier ones are splits.
    // The segments must add up to the finish: a collapsed empty cell or a sheet printed cumulative would
    // otherwise put wrong numbers in a runner's history, so then the splits are dropped and the row says so.
    let splitsUnreadable = false;
    let cumulative: number[] = [];
    if (finishMs !== null) {
      // One time per segment column, then the finish.
      const complete = segMs.length === labels.length && segMs.every((v): v is number => v !== null);
      const sum = complete ? (segMs as number[]).reduce((a, b) => a + b, 0) : NaN;
      if (complete && Math.abs(sum - finishMs) <= 2_000) {
        cumulative = (segMs as number[]).reduce<number[]>((acc, v) => [...acc, (acc.at(-1) ?? 0) + v], []);
      } else if (complete && Math.abs((segMs as number[])[segMs.length - 1] - finishMs) <= 2_000 && (segMs as number[]).every((v, i) => i === 0 || v > (segMs as number[])[i - 1])) {
        cumulative = segMs as number[]; // printed cumulative rather than as segments
      } else {
        splitsUnreadable = true;
      }
    } else {
      // A DNF: whatever segments were run, in order, until the first gap.
      for (const v of segMs) {
        if (v === null) break;
        cumulative.push((cumulative.at(-1) ?? 0) + v);
      }
    }
    const splits: Record<string, number> = {};
    for (let i = 0; i < labels.length - 1 && i < cumulative.length; i++) {
      if (meet.checkpoints.some((c) => c.label === labels[i])) splits[labels[i]] = cumulative[i];
    }
    const placeNum = Number(placeText.match(/^(\d+)/)?.[1]);
    meet.rows.push({
      name,
      gender,
      level: /\bjv\b/i.test(placeText) ? "jv" : "varsity",
      splits,
      finishMs: dnf || dns ? null : finishMs,
      place: !dnf && !dns && Number.isInteger(placeNum) && placeNum > 0 ? placeNum : null,
      status: dns ? "dns" : dnf || finishMs === null ? "dnf" : "finished",
      letter: letterCol >= 0 && /^yes$/i.test(cells[letterCol] ?? ""),
      splitsUnreadable,
    });
  }
  // A runner whose level the sheet never said (a DNF with no place) ran where they ran the rest of that meet's
  // season: the level they appear at most elsewhere in the file, else varsity.
  const levelByName = new Map<string, Map<"varsity" | "jv", number>>();
  for (const m of meets) for (const r of m.rows) if (r.place !== null) {
    const c = levelByName.get(r.name) ?? new Map<"varsity" | "jv", number>();
    c.set(r.level, (c.get(r.level) ?? 0) + 1);
    levelByName.set(r.name, c);
  }
  for (const m of meets) for (const r of m.rows) if (r.place === null && r.status !== "finished") {
    const c = levelByName.get(r.name);
    if (c) r.level = [...c].sort((a, b) => b[1] - a[1])[0][0];
  }
  return meets;
}

const TIME_OR_STATUS = /^(\d+:\d{2}(\.\d+)?|dnf|dns)$/i;

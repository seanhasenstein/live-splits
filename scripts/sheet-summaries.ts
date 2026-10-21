/**
 * Save each race's team numbers and letter standard ("76 Pts. 2nd Place. 12 Teams. 79 Runners.
 * Letter standard 52nd · 19:47") from the team's split sheets onto meets imported before imports
 * saved them. Imports from now on save them themselves. Only races that don't have them yet are
 * touched (or ones saved without a letter standard); a race is found by gender and level ("Boys
 * Varsity"). When a sheet didn't print a letter standard, the varsity race gets one from the sheet's
 * LETTER marks: the slowest of our runners marked LETTER, which reproduces exactly who lettered.
 *
 * By default it reads the sheets the app already kept: every split-sheet import stored the meet as
 * it was read, summary lines included, linked to the meet it created. No PDFs needed.
 *
 *   pnpm db:sheet-summaries                       # dry run, from the stored imports
 *   pnpm db:sheet-summaries --yes                 # saves it
 *   pnpm db:sheet-summaries <sheet.pdf> … [--yes] # from PDFs instead (a meet is found by its date)
 *
 * Point it at another database the same way as the other scripts:
 *   MONGODB_URI=… MONGODB_DB=… pnpm db:sheet-summaries --yes
 */
import { readFileSync } from "node:fs";
import { PDFParse } from "pdf-parse";
import { getClient, getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { type HistoryMeet, letterFromMarks, parseSplitsHistory, type SheetSummary, sheetSummaryFor } from "@/lib/results/splits-history";
import { formatElapsed } from "@/lib/time";

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const write = args.includes("--yes");
  const files = args.filter((a) => a !== "--yes");
  const db = await getDb();

  // Each sheet's meet, with the app's meet it belongs to.
  const sheets: { meetId: string | null; sheet: HistoryMeet }[] = [];
  if (files.length > 0) {
    for (const file of files) {
      const text = (await new PDFParse({ data: new Uint8Array(readFileSync(file)) }).getText()).text;
      for (const sheet of parseSplitsHistory(text)) sheets.push({ meetId: null, sheet });
    }
  } else {
    for (const imp of await collection(db, "imports").find({ source: "manual", deletedAt: null }).toArray()) {
      try {
        const sheet = JSON.parse(imp.raw) as HistoryMeet;
        if (Array.isArray(sheet.summaries) && imp.meetId) sheets.push({ meetId: imp.meetId, sheet });
      } catch {
        // Pasted results text, not a split sheet.
      }
    }
    console.log(`${sheets.length} split-sheet imports on file.`);
  }

  let saved = 0;
  let none = 0;
  for (const { meetId, sheet } of sheets) {
    const meets = meetId ? await collection(db, "meets").find({ _id: meetId, deletedAt: null }).toArray() : await collection(db, "meets").find({ date: sheet.date, deletedAt: null }).toArray();
    if (meets.length !== 1) {
      console.log(`${sheet.name} (${sheet.date}): ${meets.length} matching meets in the app; skipped.`);
      continue;
    }
    const meet = meets[0];
    for (const race of await collection(db, "races").find({ meetId: meet._id, deletedAt: null }).toArray()) {
      if (race.sheetSummary?.letter) continue;
      let summary: SheetSummary | null = race.sheetSummary ?? sheetSummaryFor(sheet.summaries, race.name);
      // No standard printed (or not kept): the varsity race's standard from the sheet's LETTER marks.
      const gender = /^\s*(boys|men)\b/i.test(race.name) ? "M" : /^\s*(girls|women)\b/i.test(race.name) ? "F" : null;
      if (!summary?.letter && gender && race.levelIds.includes("varsity")) {
        const ms = letterFromMarks(sheet.rows, gender);
        if (ms !== null) summary = { points: null, place: null, teams: null, runners: null, ...summary, letter: { place: null, ms } };
      }
      if (!summary || (race.sheetSummary && !summary.letter)) {
        if (!race.sheetSummary) none++;
        continue;
      }
      const letter = summary.letter ? `, letter ${summary.letter.place ?? "(from LETTER marks)"} · ${formatElapsed(summary.letter.ms, "seconds")}` : "";
      console.log(`${meet.date} ${meet.name} · ${race.name}: ${summary.points ?? "—"} pts, place ${summary.place ?? "—"} of ${summary.teams ?? "—"}, ${summary.runners ?? "—"} runners${letter}`);
      if (write) await collection(db, "races").updateOne({ _id: race._id }, { $set: { sheetSummary: summary, updatedAt: new Date() } });
      saved++;
    }
  }
  if (none > 0) console.log(`${none} race${none === 1 ? "" : "s"} had no summary line on the sheet (a combined race, or one that didn't score).`);
  console.log(write ? `Saved ${saved} race${saved === 1 ? "" : "s"}.` : `Dry run: ${saved} race${saved === 1 ? "" : "s"} would be saved. Add --yes to save.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

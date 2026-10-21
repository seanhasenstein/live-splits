/**
 * Save each race's team numbers and letter standard from the team's split sheets onto meets already
 * imported (imports from now on save them themselves). Only races that don't have them yet are
 * touched; a meet is found by its date, a race by its name ("Boys Varsity").
 *
 *   pnpm db:sheet-summaries <sheet.pdf> [more.pdf …]         # dry run: shows what it would save
 *   pnpm db:sheet-summaries <sheet.pdf> [more.pdf …] --yes   # saves it
 *
 * Point it at another database the same way as the other scripts:
 *   MONGODB_URI=… MONGODB_DB=… pnpm db:sheet-summaries <sheet.pdf> --yes
 */
import { readFileSync } from "node:fs";
import { PDFParse } from "pdf-parse";
import { getClient, getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { parseSplitsHistory, sheetSummaryFor } from "@/lib/results/splits-history";
import { formatElapsed } from "@/lib/time";

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const write = args.includes("--yes");
  const files = args.filter((a) => a !== "--yes");
  if (files.length === 0) throw new Error("Usage: pnpm db:sheet-summaries <sheet.pdf> [more.pdf …] [--yes]");
  const db = await getDb();
  let saved = 0;
  for (const file of files) {
    const text = (await new PDFParse({ data: new Uint8Array(readFileSync(file)) }).getText()).text;
    for (const m of parseSplitsHistory(text)) {
      const meets = await collection(db, "meets").find({ date: m.date, deletedAt: null }).toArray();
      if (meets.length !== 1) {
        console.log(`${m.name} (${m.date}): ${meets.length} meets on that date in the app; skipped.`);
        continue;
      }
      const races = await collection(db, "races").find({ meetId: meets[0]._id, deletedAt: null }).toArray();
      for (const race of races) {
        if (race.sheetSummary) continue;
        const summary = sheetSummaryFor(m.summaries, race.name);
        if (!summary) continue;
        const letter = summary.letter ? `, letter ${summary.letter.place} · ${formatElapsed(summary.letter.ms, "seconds")}` : "";
        console.log(`${meets[0].name} (${m.date}) · ${race.name}: ${summary.points ?? "—"} pts, place ${summary.place ?? "—"} of ${summary.teams ?? "—"}, ${summary.runners ?? "—"} runners${letter}`);
        if (write) await collection(db, "races").updateOne({ _id: race._id }, { $set: { sheetSummary: summary, updatedAt: new Date() } });
        saved++;
      }
    }
  }
  console.log(write ? `Saved ${saved} race${saved === 1 ? "" : "s"}.` : `Dry run: ${saved} race${saved === 1 ? "" : "s"} would be saved. Add --yes to save.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

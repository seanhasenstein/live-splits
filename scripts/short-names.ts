/**
 * Short names link the same meet across years (KML, Parkside, County…), whatever the meet called
 * itself that year. This suggests one for every meet, writes them to a file you edit, then saves
 * the file.
 *
 *   pnpm db:short-names suggest short-names.json          # writes suggestions (nothing saved)
 *   pnpm db:short-names apply short-names.json            # dry run: what would change
 *   pnpm db:short-names apply short-names.json --yes      # saves them
 *
 * Suggestions: meets on the same course at about the same point in the season (within 12 days) in
 * different years are taken to be the same meet and get one name: the meet's own short name if any
 * year has one, else the most common name made from their titles. Edit any you'd call differently
 * (in the file, "shortName"); set it to null to leave a meet without one.
 *
 * Point it at another database the same way as the other scripts:
 *   MONGODB_URI=… MONGODB_DB=… pnpm db:short-names apply short-names.json --yes
 */
import { readFileSync, writeFileSync } from "node:fs";
import { getClient, getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";
import { shortMeetName } from "@/lib/reports/season-times";

type Row = { meetId: string; date: string; name: string; venue: string | null; shortName: string | null; current: string | null };

const dayOfSeason = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 7, 1)) / 86_400_000); // days since Aug 1
};

/**
 * A name from the meet's title. Sectionals and State move every year, so they're named for what they
 * are; otherwise "Lancer Invite @ UW Parkside" says where it is after the "@".
 */
const nameFor = (name: string) => {
  if (/\bsectional/i.test(name)) return "Sectional";
  if (/\bstate\b/i.test(name)) return "State";
  const at = name.split(/\s+@\s+/);
  return shortMeetName(at.length > 1 ? at[1].replace(/^(UW|the)\s+/i, "") : name);
};

async function main() {
  const [mode, file, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
  const write = rest.includes("--yes");
  if ((mode !== "suggest" && mode !== "apply") || !file) throw new Error("Usage: pnpm db:short-names suggest <file.json> | apply <file.json> [--yes]");
  const db = await getDb();
  const meets = await collection(db, "meets").find({ deletedAt: null }).sort({ date: 1 }).toArray();
  const venues = new Map((await collection(db, "venues").find({}).toArray()).map((v) => [v._id, v.name]));

  if (mode === "suggest") {
    // Group the same meet across years: same course, about the same point in the season, different years.
    const group = new Map<string, number>();
    let next = 0;
    for (const m of meets) {
      const mate = meets.find((o) => o._id !== m._id && group.has(o._id) && o.courseId && o.courseId === m.courseId && o.date.slice(0, 4) !== m.date.slice(0, 4) && Math.abs(dayOfSeason(o.date) - dayOfSeason(m.date)) <= 12);
      group.set(m._id, mate ? group.get(mate._id)! : next++);
    }
    const label = new Map<number, string>();
    for (const g of new Set(group.values())) {
      const members = meets.filter((m) => group.get(m._id) === g);
      const own = members.find((m) => m.shortName)?.shortName;
      if (own) {
        label.set(g, own);
        continue;
      }
      const counts = new Map<string, number>();
      for (const m of members) counts.set(nameFor(m.name), (counts.get(nameFor(m.name)) ?? 0) + 1);
      label.set(g, [...counts].sort((a, b) => b[1] - a[1])[0][0]);
    }
    const rows: Row[] = meets.map((m) => ({ meetId: m._id, date: m.date, name: m.name, venue: m.venueId ? (venues.get(m.venueId) ?? null) : null, shortName: label.get(group.get(m._id)!)!, current: m.shortName ?? null }));
    writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
    for (const r of rows) console.log(`${r.date}  ${(r.shortName ?? "—").padEnd(12)} ${r.name}${r.venue ? ` · ${r.venue}` : ""}`);
    console.log(`\nWrote ${rows.length} suggestions to ${file}. Edit "shortName" where you'd call a meet differently, then run apply.`);
    return;
  }

  const rows = JSON.parse(readFileSync(file, "utf8")) as Row[];
  const byId = new Map(meets.map((m) => [m._id, m]));
  let changes = 0;
  for (const r of rows) {
    const m = byId.get(r.meetId);
    if (!m) {
      console.log(`${r.date} ${r.name}: not in this database; skipped.`);
      continue;
    }
    const shortName = typeof r.shortName === "string" && r.shortName.trim() ? (r.shortName as string).trim().slice(0, 16) : null;
    if ((m.shortName ?? null) === shortName) continue;
    console.log(`${m.date}  ${m.name}: ${m.shortName ?? "—"} → ${shortName ?? "—"}`);
    if (write) await collection(db, "meets").updateOne({ _id: m._id }, { $set: { shortName, updatedAt: new Date() } });
    changes++;
  }
  console.log(write ? `Saved ${changes} short name${changes === 1 ? "" : "s"}.` : `Dry run: ${changes} change${changes === 1 ? "" : "s"}. Add --yes to save.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

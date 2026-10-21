/**
 * Loads team logos from a folder of images, one per team, named for the team
 * (cedar-grove-belgium.png, st-mary-springs.png). Each is trimmed and fit in 256×256.
 *
 *   pnpm db:logos sectional-meet-logos           # dry run: what would load, and which teams in our results match
 *   pnpm db:logos sectional-meet-logos --yes     # saves them (replacing a team's logo if it had one)
 *
 * Coaches can also add or replace one at a time on the Team logos page (Season → Team logos).
 * Point it at another database the same way as the other scripts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { getClient, getDb, newId } from "@/lib/db/client";
import { COLLECTIONS, collection } from "@/lib/db/collections";
import { logoPng } from "@/lib/logo-image";
import { logoKey } from "@/lib/logos";

const IMAGES = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const titleOf = (file: string) =>
  file
    .replace(extname(file), "")
    .split(/[-_\s]+/)
    .map((w) => (w.length <= 2 && w !== "st" ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");

async function main() {
  const [dir, ...flags] = process.argv.slice(2);
  if (!dir) throw new Error("Usage: pnpm db:logos <folder> [--yes]");
  const yes = flags.includes("--yes");
  const db = await getDb();
  const school = await collection(db, "schools").findOne({ deletedAt: null });
  if (!school) throw new Error("No school in this database");

  // Teams in our imported results, to show which logos will be used.
  const names = await collection(db, "raceEntries").distinct("teamName", { schoolId: school._id, deletedAt: null });
  const seen = new Map<string, string>();
  for (const n of names) if (n) seen.set(logoKey(n), n);

  const files = readdirSync(dir).filter((f) => IMAGES.has(extname(f).toLowerCase()));
  const actor = { type: "system" as const, id: null, name: "db:logos" };
  for (const f of files) {
    const name = titleOf(f);
    const key = logoKey(name);
    const match = seen.get(key);
    console.log(`${f.padEnd(32)} ${name.padEnd(28)} ${match ? `matches "${match}"` : "no match in results yet"}`);
    if (!yes) continue;
    const png = (await logoPng(readFileSync(join(dir, f)))).toString("base64");
    const now = new Date();
    await collection(db, "teamLogos").updateOne(
      { schoolId: school._id, key },
      {
        $set: { name: match ?? name, png, updatedAt: now, updatedBy: actor, deletedAt: null },
        $setOnInsert: { _id: newId(), schoolId: school._id, key, schemaVersion: COLLECTIONS.teamLogos.version, source: "manual", createdAt: now, createdBy: actor },
      },
      { upsert: true },
    );
  }
  console.log(yes ? `Saved ${files.length} logo(s).` : `Dry run: ${files.length} logo(s). Add --yes to save them.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

/**
 * Copy a whole database into a separate one: prod into a local copy, to see real meets in development.
 * A full copy, not a merge: athletes, meets, races, results, rosters, seasons, venues and courses
 * reference each other by id, so they move together, every one of them. Every collection the source
 * has is copied (documents and indexes) except `sessions`, which holds people's sign-ins.
 *
 *   SOURCE_URI=… SOURCE_DB=… TARGET_DB=… pnpm db:copy           # dry run: what would be copied
 *   SOURCE_URI=… SOURCE_DB=… TARGET_DB=… pnpm db:copy --yes     # copies
 *
 * TARGET_URI defaults to MONGODB_URI from .env.local (your dev cluster). The target database must be
 * empty, or pass --replace to drop and recopy the collections it shares with the source. It refuses
 * to write into the source database.
 */
import { MongoClient } from "mongodb";

const SKIP = new Set(["sessions"]);
const BATCH = 1000;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name}. Usage: SOURCE_URI=… SOURCE_DB=… TARGET_DB=… pnpm db:copy [--yes] [--replace]`);
  return v;
}

/** The cluster a connection string points at, for telling source and target apart. */
const hostOf = (uri: string) => new URL(uri.replace(/^mongodb(\+srv)?:\/\//, "http://")).host.toLowerCase();

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--yes");
  const replace = args.includes("--replace");
  const sourceUri = required("SOURCE_URI");
  const sourceDb = required("SOURCE_DB");
  const targetUri = process.env.TARGET_URI ?? required("MONGODB_URI");
  const targetDb = required("TARGET_DB");
  if (hostOf(sourceUri) === hostOf(targetUri) && sourceDb === targetDb) throw new Error("The target is the source database. Pick another TARGET_DB.");

  const source = new MongoClient(sourceUri);
  const target = hostOf(sourceUri) === hostOf(targetUri) ? source : new MongoClient(targetUri);
  try {
    await source.connect();
    if (target !== source) await target.connect();
    const from = source.db(sourceDb);
    const to = target.db(targetDb);

    const names = (await from.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith("system.")).sort();
    if (names.length === 0) throw new Error(`${sourceDb} has no collections. Check SOURCE_URI and SOURCE_DB.`);
    let existing: Set<string>;
    try {
      existing = new Set((await to.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    } catch (err) {
      if (/not allowed|not authorized|unauthorized/i.test(String(err))) {
        throw new Error(`The target database user can't use ${targetDb}. In Atlas → Database Access, give that user readWrite on ${targetDb} (or use a user that has it), then run this again.`);
      }
      throw err;
    }
    const clash = names.filter((n) => !SKIP.has(n) && existing.has(n));
    if (clash.length > 0 && !replace) throw new Error(`${targetDb} already has ${clash.join(", ")}. Pick an empty TARGET_DB, or pass --replace to drop and recopy them.`);

    console.log(`${write ? "Copying" : "Dry run:"} ${hostOf(sourceUri)}/${sourceDb} → ${hostOf(targetUri)}/${targetDb}`);
    const counts: Record<string, number> = {};
    for (const name of names) {
      const n = await from.collection(name).countDocuments();
      counts[name] = n;
      console.log(`  ${name.padEnd(22)} ${String(n).padStart(7)}${SKIP.has(name) ? "  (skipped: sign-ins)" : ""}`);
    }
    if (!write) {
      console.log("Add --yes to copy.");
      return;
    }

    for (const name of names) {
      if (SKIP.has(name)) continue;
      if (existing.has(name)) await to.collection(name).drop();
      // Indexes first (unique ones then guard the copy too), then the documents in batches.
      const indexes = (await from.collection(name).listIndexes().toArray()).filter((ix) => ix.name !== "_id_");
      await to.createCollection(name);
      for (const ix of indexes) {
        // Everything but the bookkeeping fields (v, ns) carries over: unique, sparse, partial filters, TTLs.
        const options = Object.fromEntries(Object.entries(ix).filter(([k]) => !["key", "v", "ns"].includes(k)));
        await to.collection(name).createIndex(ix.key, options);
      }
      let copied = 0;
      let batch: Record<string, unknown>[] = [];
      for await (const doc of from.collection(name).find({})) {
        batch.push(doc);
        if (batch.length >= BATCH) {
          await to.collection(name).insertMany(batch, { ordered: true });
          copied += batch.length;
          batch = [];
        }
      }
      if (batch.length > 0) {
        await to.collection(name).insertMany(batch, { ordered: true });
        copied += batch.length;
      }
      const check = await to.collection(name).countDocuments();
      if (check !== counts[name]) throw new Error(`${name}: copied ${check} of ${counts[name]}. Run again with --replace.`);
      console.log(`  ${name.padEnd(22)} ${String(copied).padStart(7)} copied, ${indexes.length} index${indexes.length === 1 ? "" : "es"}`);
    }
    console.log(`Done. Point the app at it with MONGODB_DB=${targetDb} in .env.local.`);
  } finally {
    await source.close();
    if (target !== source) await target.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

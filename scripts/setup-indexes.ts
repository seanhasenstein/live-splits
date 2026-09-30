/** Create all indexes. Idempotent. Run with `pnpm db:indexes`. */
import { getClient, getDb } from "@/lib/db/client";
import { INDEXES, ensureIndexes } from "@/lib/db/indexes";

async function main() {
  await ensureIndexes(await getDb());
  for (const [name, indexes] of Object.entries(INDEXES)) {
    console.log(`${name}: ${indexes.length} index(es)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => (await getClient()).close());

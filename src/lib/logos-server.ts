import "server-only";
import type { Actor } from "@/lib/db/schema";
import { getDb, newId } from "@/lib/db/client";
import { COLLECTIONS, collection } from "@/lib/db/collections";
import { logoPng } from "./logo-image";
import { logoKey } from "./logos";

/** The school's team logos by key, each with a version for its URL. */
export async function getLogoVersions(schoolId: string): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await collection(db, "teamLogos")
    .find({ schoolId, deletedAt: null }, { projection: { key: 1, updatedAt: 1 } })
    .toArray();
  return new Map(rows.map((r) => [r.key, r.updatedAt.getTime()]));
}

/** Saves (or replaces) a team's logo. */
export async function saveLogo(schoolId: string, name: string, image: Buffer, actor: Actor): Promise<{ key: string }> {
  const key = logoKey(name);
  if (!key) throw new Error("A team name is needed");
  const png = (await logoPng(image)).toString("base64");
  const db = await getDb();
  const now = new Date();
  await collection(db, "teamLogos").updateOne(
    { schoolId, key },
    {
      $set: { name, png, updatedAt: now, updatedBy: actor, deletedAt: null },
      $setOnInsert: { _id: newId(), schoolId, key, schemaVersion: COLLECTIONS.teamLogos.version, source: "manual", createdAt: now, createdBy: actor },
    },
    { upsert: true },
  );
  return { key };
}

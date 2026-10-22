import { getDb } from "@/lib/db/client";
import { collection } from "@/lib/db/collections";

/**
 * A team logo as a PNG. Open to anyone (logos are on every school's website, and shared results
 * pages show them); the URL's ?v= changes when a logo is replaced, so it caches for good.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/logos/[schoolId]/[key]">) {
  const { schoolId, key } = await params;
  const logo = await collection(await getDb(), "teamLogos").findOne({ schoolId, key, deletedAt: null }, { projection: { png: 1 } });
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(logo.png, "base64"), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" } });
}

import { getSession, isSchoolWide } from "@/lib/auth/session";
import { search } from "@/lib/search";

/** `?q=` → our athletes, meets and other schools' runners that match. School-wide coaches and viewers. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!isSchoolWide(session)) return new Response("Not found", { status: 404 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 80);
  return Response.json({ hits: await search(session!.schoolId, q) }, { headers: { "Cache-Control": "no-store" } });
}

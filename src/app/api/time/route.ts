/** Clock sync: devices compare this to their own clock (see lib/client/clock.ts). */
export async function GET() {
  return Response.json({ serverTimeMs: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}

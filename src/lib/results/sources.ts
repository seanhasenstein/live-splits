import "server-only";
import { type ParsedContest, parseRaceResultJson, parseResultsText } from "./parse";

/**
 * Turn what a coach hands us (a URL, pasted text, a PDF) into contests.
 * Vendors supported by URL: RACE RESULT (api.raceresult.com) and Badger State
 * Timing meet pages (which list their contests' RACE RESULT feeds).
 */

export class SourceError extends Error {}

const FETCH_TIMEOUT_MS = 15000;

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new SourceError(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new SourceError(`${new URL(url).host} answered ${res.status}`);
  return res.text();
}

/** One RACE RESULT contest feed: a JSON array of rows. */
export async function fromRaceResultUrl(url: string, contestName = "RACE RESULT contest"): Promise<ParsedContest> {
  const rows = await getJson<Record<string, unknown>[]>(url);
  if (!Array.isArray(rows)) throw new SourceError("That RACE RESULT link didn't return a results list.");
  return parseRaceResultJson(rows, contestName, url);
}

/**
 * Badger State Timing meet page. The page is a client-side app over a public
 * Supabase project; its contests carry their RACE RESULT feed URLs. The anon
 * key is read from the page's bundle each time, so a key rotation on their
 * side just means re-reading it.
 */
export async function fromBadgerStateUrl(pageUrl: string): Promise<ParsedContest[]> {
  const u = new URL(pageUrl);
  const slug = u.pathname.replace(/^\/+|\/+$/g, "");
  if (!slug) throw new SourceError("That Badger State Timing link has no meet in it.");

  const html = await getText(`${u.origin}/${slug}`);
  const bundlePath = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1];
  if (!bundlePath) throw new SourceError("Couldn't read the Badger State Timing page.");
  const bundle = await getText(`${u.origin}${bundlePath}`);
  const key = bundle.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9._-]+/)?.[0];
  const supabase = bundle.match(/https:\/\/[a-z]+\.supabase\.co/)?.[0];
  if (!key || !supabase) throw new SourceError("Badger State Timing's page changed; the results feed couldn't be found.");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  const race = await getJson<{ id: string }[]>(`${supabase}/rest/v1/race_data?select=id&slug=eq.${encodeURIComponent(slug)}`, headers);
  if (!race[0]) throw new SourceError("No meet with that address on Badger State Timing.");
  const contests = await getJson<{ id: string; name: string; distance: number | null; individual_results_url: string | null; race_order: number }[]>(
    `${supabase}/rest/v1/xc_contests?select=id,name,distance,individual_results_url,race_order&race_id=eq.${race[0].id}&order=race_order`,
    headers,
  );

  const out: ParsedContest[] = [];
  for (const c of contests) {
    if (!c.individual_results_url) continue;
    try {
      const parsed = await fromRaceResultUrl(c.individual_results_url, c.name);
      out.push({ ...parsed, distanceMeters: c.distance ?? null });
    } catch {
      // A contest without published results yet; skip it rather than fail the meet.
    }
  }
  if (out.length === 0) throw new SourceError("That meet has no published results yet.");
  return out;
}

export async function fromUrl(url: string): Promise<ParsedContest[]> {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new SourceError("That doesn't look like a link.");
  }
  if (u.host === "api.raceresult.com") return [await fromRaceResultUrl(u.toString())];
  if (u.host.endsWith("badgerstatetiming.live")) return fromBadgerStateUrl(u.toString());
  throw new SourceError(`No importer for ${u.host} yet. Paste the results as text or upload the PDF instead.`);
}

export async function fromPdf(data: Uint8Array, contestName: string): Promise<ParsedContest> {
  const { PDFParse } = await import("pdf-parse");
  const text = (await new PDFParse({ data }).getText()).text;
  return parseResultsText(text, contestName);
}

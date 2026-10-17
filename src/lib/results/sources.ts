import "server-only";
import { COLUMN_HEADER_RE, type ParsedContest, parseArrowResultsHtml, parseColumnResults, parseRaceResultJson, parseResultsText, stripTags } from "./parse";

/**
 * Turn what a coach hands us (a URL, pasted text, a PDF) into contests.
 * Vendors supported by URL: RACE RESULT (api.raceresult.com) and Badger State
 * Timing meet pages (which list their contests' RACE RESULT feeds).
 */

export class SourceError extends Error {}

const FETCH_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const RACE_RESULT_HOST = "api.raceresult.com";
const BADGER_HOSTS = new Set(["badgerstatetiming.live", "www.badgerstatetiming.live"]);
const ARROW_HOSTS = new Set(["arrowliveresults.com", "www.arrowliveresults.com"]);
const XM_HOSTS = new Set(["xmtiming.com", "www.xmtiming.com"]);
const ANY_KNOWN_HOST = (h: string) => h === RACE_RESULT_HOST || BADGER_HOSTS.has(h) || ARROW_HOSTS.has(h) || XM_HOSTS.has(h) || h.endsWith(".supabase.co");

/** Fetch from a known host; a redirect must land on a known https host too, and the body is capped. */
async function getResponse(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  const landed = new URL(res.url || url);
  if (landed.protocol !== "https:" || !ANY_KNOWN_HOST(landed.host)) throw new SourceError(`${new URL(url).host} redirected somewhere the app can't read.`);
  if (!res.ok) throw new SourceError(`${new URL(url).host} answered ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new SourceError(`${landed.host} sent too much data.`);
  return res;
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return (await (await getResponse(url, headers)).json()) as T;
}

async function getText(url: string): Promise<string> {
  const text = await (await getResponse(url)).text();
  if (text.length > MAX_BODY_BYTES) throw new SourceError(`${new URL(url).host} sent too much data.`);
  return text;
}

/** Hosts whose race pages can be polled live during a race. */
export function isLiveFeedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.host === RACE_RESULT_HOST || ARROW_HOSTS.has(u.host));
  } catch {
    return false;
  }
}

/** Only fetch from the timing companies we know, over https: links come from coaches and from their pages. */
function checkHost(url: string, allowed: (host: string) => boolean): URL {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new SourceError("That doesn't look like a link.");
  }
  if (u.protocol !== "https:" || !allowed(u.host)) throw new SourceError(`Links to ${u.host} can't be read.`);
  return u;
}

/** One RACE RESULT contest feed: a JSON array of rows. `live`: rows without a finish are still running, not DNF. */
export async function fromRaceResultUrl(url: string, contestName = "RACE RESULT contest", options: { live?: boolean } = {}): Promise<ParsedContest> {
  const u = checkHost(url, (h) => h === RACE_RESULT_HOST);
  const rows = await getJson<Record<string, unknown>[]>(u.toString());
  if (!Array.isArray(rows)) throw new SourceError("That RACE RESULT link didn't return a results list.");
  return parseRaceResultJson(rows, contestName, u.toString(), options);
}

/**
 * Badger State Timing meet page. The page is a client-side app over a public
 * Supabase project; its contests carry their RACE RESULT feed URLs. The anon
 * key is read from the page's bundle each time, so a key rotation on their
 * side just means re-reading it.
 */
export async function fromBadgerStateUrl(pageUrl: string): Promise<ParsedContest[]> {
  const u = checkHost(pageUrl, (h) => BADGER_HOSTS.has(h));
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

/**
 * One Arrow Live Results race page (XM Timing). The page embeds its event id;
 * the rows come from a partial view that the page itself polls.
 */
/** An Arrow page's event never changes; remembered so live polling fetches only the rows. */
const arrowEvents = new Map<string, { eventId: string; title: string }>();

export async function fromArrowUrl(pageUrl: string, options: { live?: boolean } = {}): Promise<ParsedContest> {
  const u = checkHost(pageUrl, (h) => ARROW_HOSTS.has(h));
  let event = arrowEvents.get(u.toString());
  if (!event) {
    const html = await getText(u.toString());
    const eventId = html.match(/var\s+EventId\s*=\s*(\d+)/)?.[1];
    if (!eventId) throw new SourceError("That Arrow Live Results page has no event on it.");
    const title = stripTags(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "").slice(0, 200) || `Arrow event ${eventId}`;
    event = { eventId, title };
    arrowEvents.set(u.toString(), event);
  }
  const rows = await getText(`${u.origin}/Results/pvResults?pEventId=${event.eventId}&pDivision=Overall&pChipTime=false`);
  return parseArrowResultsHtml(rows, event.title, u.toString(), options);
}

/** An XM Timing meet page lists one Arrow page per race; read them all, a few at a time. */
export async function fromXmTimingUrl(pageUrl: string): Promise<ParsedContest[]> {
  const u = checkHost(pageUrl, (h) => XM_HOSTS.has(h));
  const html = await getText(u.toString());
  const links = [...new Set([...html.matchAll(/https?:\/\/(?:www\.)?arrowliveresults\.com\/[A-Za-z0-9_-]+/g)].map((m) => m[0].replace(/^http:/, "https:")))].slice(0, 30);
  if (links.length === 0) throw new SourceError("That XM Timing page has no results links yet.");
  const out: (ParsedContest | null)[] = new Array(links.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < links.length) {
      const i = next++;
      try {
        const contest = await fromArrowUrl(links[i]);
        if (contest.entries.length > 0) out[i] = contest; // an empty page is a race not run yet
      } catch {
        // A race not published yet; skip it rather than fail the meet.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, links.length) }, worker));
  const contests = out.filter((c): c is ParsedContest => c !== null);
  if (contests.length === 0) throw new SourceError("That meet has no published results yet.");
  return contests;
}

/** A single race feed by its link, for live polling: RACE RESULT or Arrow. */
export async function fromFeedUrl(url: string, contestName: string | undefined, options: { live?: boolean } = {}): Promise<ParsedContest> {
  const u = checkHost(url, (h) => h === RACE_RESULT_HOST || ARROW_HOSTS.has(h));
  return ARROW_HOSTS.has(u.host) ? fromArrowUrl(u.toString(), options) : fromRaceResultUrl(u.toString(), contestName, options);
}

export async function fromUrl(url: string): Promise<ParsedContest[]> {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new SourceError("That doesn't look like a link.");
  }
  // A bare feed link has no contest name; the key in the URL at least tells two apart.
  if (u.host === RACE_RESULT_HOST) return [await fromRaceResultUrl(u.toString(), `RACE RESULT contest ${u.pathname.split("/").filter(Boolean).at(-1)?.slice(0, 6) ?? ""}`.trim())];
  if (BADGER_HOSTS.has(u.host)) return fromBadgerStateUrl(u.toString());
  if (ARROW_HOSTS.has(u.host)) return [await fromArrowUrl(u.toString())];
  if (XM_HOSTS.has(u.host)) return fromXmTimingUrl(u.toString());
  throw new SourceError(`No importer for ${u.host} yet. Paste the results as text or upload the PDF instead.`);
}

/**
 * pdf-parse's build news up a DOMMatrix while loading, and takes it from
 * @napi-rs/canvas, whose native binary isn't shipped to the serverless build.
 * Text extraction never draws, so inert stand-ins are enough.
 */
function polyfillCanvasGlobals() {
  const g = globalThis as Record<string, unknown>;
  if (!g.DOMMatrix) {
    g.DOMMatrix = class DOMMatrix {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      constructor(init?: number[]) {
        if (init?.length === 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      }
      translate() {
        return this;
      }
      scale() {
        return this;
      }
      invertSelf() {
        return this;
      }
      multiplySelf() {
        return this;
      }
      preMultiplySelf() {
        return this;
      }
    };
  }
  if (!g.Path2D) g.Path2D = class Path2D { addPath() {} };
  if (!g.ImageData) g.ImageData = class ImageData {};
}

/**
 * The text of a PDF, as pdf.js lays it out (tabs between columns). `itemJoiner` goes between every
 * text item instead, for layouts whose columns sit too close for a tab.
 */
export async function fromPdfText(data: Uint8Array, itemJoiner?: string): Promise<string> {
  polyfillCanvasGlobals();
  const { PDFParse } = await import("pdf-parse");
  // pdf.js may take over the buffer; a copy leaves the caller's for a second read.
  return (await new PDFParse({ data: data.slice() }).getText(itemJoiner ? { itemJoiner } : undefined)).text;
}

/** Usually one contest per PDF; an every-race PDF (Trackside's "All Contests") gives one per race. */
export async function fromPdf(data: Uint8Array, contestName: string): Promise<ParsedContest[]> {
  const text = await fromPdfText(data);
  // Team results ("1. Ozaukee - 78 Points" over each team's runners) would read as runners with their pace as the finish.
  if (/^\s*\d+\.\s.+\s-\s*\d+\s+Points\s*$/m.test(text))
    throw new SourceError("That's the team results PDF. Import the individual (overall) results instead; the app works out team scores from them.");
  if (COLUMN_HEADER_RE.test(text)) {
    const contests = parseColumnResults(await fromPdfText(data, "\t"), contestName);
    if (contests.length > 0) return contests;
  }
  return [parseResultsText(text, contestName)];
}

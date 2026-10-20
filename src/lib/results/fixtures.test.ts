/**
 * Real vendor output, with other schools' athletes and teams replaced by made-up
 * names (structure untouched), run through the parsers and the fetch chain.
 * Regenerate a fixture from a fresh download when a vendor changes its format.
 */
import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { isOurTeam } from "./match";
import { COLUMN_HEADER_RE, parseArrowResultsHtml, parseAthleticLiveJson, parseColumnResults, parseRaceResultJson, parseResultsText } from "./parse";
import { athleticLiveRaceId, fromFeedUrl, fromUrl, isLiveFeedUrl, SourceError } from "./sources";

const F = `${process.cwd()}/src/lib/results/fixtures`;
const read = (name: string) => readFileSync(`${F}/${name}`, "utf8");
const ALIASES = ["Sheboygan Lutheran", "Sheboygan Area Lutheran"];

test("Arrow Live Results partial (XM Timing): 136 finishers, bibs, hundredths", () => {
  const c = parseArrowResultsHtml(read("arrow-pvresults.html"), "Boys Varsity - Sm School", "https://www.arrowliveresults.com/X");
  expect(c.entries).toHaveLength(136);
  expect(c.entries.map((e) => e.place)).toEqual(c.entries.map((_, i) => i + 1));
  expect(c.entries[0]).toMatchObject({ name: "Eddy Giebler", team: "Sheboygan Lutheran", bib: "1251", place: 1, status: "finished", finishMs: 17 * 60_000 + 9_870, grade: null, splits: {} });
  expect(c.entries.filter((e) => isOurTeam(e.team, ALIASES))).toHaveLength(7);
  expect(c.entries.every((e) => e.finishMs !== null && e.name.includes(" "))).toBe(true);
  expect(c.source).toEqual({ kind: "arrow", url: "https://www.arrowliveresults.com/X" });
  expect(c.precision).toBe("hundredths");
});

test("RACE RESULT contest JSON (Badger State Timing): mat columns, DNF, grades", () => {
  const c = parseRaceResultJson(JSON.parse(read("raceresult-contest.json")), "Girls Division 3");
  expect(c.splitLabels).toEqual(["Mile 1", "Mile 2"]);
  expect(c.entries).toHaveLength(221);
  const ours = c.entries.filter((e) => isOurTeam(e.team, ALIASES));
  expect(ours).toHaveLength(10);
  expect(ours.find((e) => e.lastName === "Faucher")).toMatchObject({ place: 26, grade: 10, bib: "1375", finishMs: 21 * 60_000 + 49_000, splits: { "Mile 1": 7 * 60_000 + 2_300, "Mile 2": 14 * 60_000 + 10_900 } });
  const dnf = c.entries.filter((e) => e.status === "dnf");
  expect(dnf).toHaveLength(1);
  expect(dnf[0].finishMs).toBeNull();
  expect(Object.keys(dnf[0].splits)).toEqual(["Mile 1"]);
  expect(c.precision).toBe("tenths");
});

test("Badger State PDF text: header gives mat labels, team-score rows skipped, DNF without points", () => {
  const c = parseResultsText(read("badger-pdf-text.txt"), "Boys Division 3");
  expect(c.splitLabels).toEqual(["Mile 1", "Mile 2"]);
  expect(c.entries).toHaveLength(244);
  expect(c.entries.find((e) => e.name === "Eddy Giebler")).toMatchObject({ place: 2, grade: 11, team: "Sheboygan Area Lutheran", finishMs: 16 * 60_000 + 23_800, splits: { "Mile 1": 4 * 60_000 + 57_700, "Mile 2": 10 * 60_000 + 19_900 } });
  // Team-score rows ("1 Northfield 63 3 7 14 …") carry no times and must not become runners.
  expect(c.entries.some((e) => e.name === "Northfield" || e.team === "")).toBe(false);
  expect(c.entries.filter((e) => e.status === "dnf").length).toBeGreaterThan(0);
  expect(c.entries.every((e) => e.grade !== null)).toBe(true);
  expect(c.precision).toBe("tenths");
});

test("hand-split division PDF text: ordinals, OVR column, class years, displacer points", () => {
  const c = parseResultsText(read("hand-split-pdf-text.txt"), "Boys Varsity Small School");
  expect(c.entries).toHaveLength(61);
  expect(c.entries.map((e) => e.place)).toEqual(c.entries.map((_, i) => i + 1));
  expect(c.entries[0]).toMatchObject({ name: "Eddy Giebler", grade: 11, team: "Sheboygan Lutheran", finishMs: 16 * 60_000 + 16_000 });
  expect(c.entries.find((e) => e.name === "Joe Vanic")).toMatchObject({ place: 14, grade: 12 }); // "(13)" displacer points
  expect(c.entries.every((e) => e.grade !== null && e.team && e.finishMs !== null)).toBe(true);
  expect(c.splitLabels).toEqual([]);
  expect(c.precision).toBe("seconds"); // whole seconds on the sheet: shown as "16:16", never "16:16.0"
});

test("Trackside every-race PDF (read with a tab per text item): one contest per race, name and school apart", () => {
  const text = read("trackside-all-contests-pdf-text.txt");
  expect(COLUMN_HEADER_RE.test(text.replace(/\t/g, " "))).toBe(true);
  const cs = parseColumnResults(text, "fallback");
  expect(cs.map((c) => [c.name, c.entries.length])).toEqual([["Boys Varsity", 143], ["Girls Varsity", 123], ["Boys JV", 75], ["Girls JV", 60]]);
  for (const c of cs) expect(c.entries.map((e) => e.place)).toEqual(c.entries.map((_, i) => i + 1)); // across page breaks
  expect(cs[0].entries[0]).toMatchObject({ name: "Eddy Giebler", team: "Sheboygan Area Lutheran", grade: 11, bib: "1834", place: 1, status: "finished", finishMs: 16 * 60_000 + 52_200, splits: {} });
  expect(cs[1].entries.at(-1)).toMatchObject({ place: 123, finishMs: 3600_000 + 14 * 60_000 + 38_400 }); // an hour-plus finish
  expect(cs.flatMap((c) => c.entries).filter((e) => isOurTeam(e.team, ALIASES))).toHaveLength(26);
  expect(cs.every((c) => c.precision === "tenths" && c.entries.every((e) => e.team && e.grade !== null && e.finishMs !== null))).toBe(true);
});

test("the column layout's header doesn't claim the Finish-column PDFs", () => {
  expect(COLUMN_HEADER_RE.test(read("badger-pdf-text.txt"))).toBe(false);
  expect(COLUMN_HEADER_RE.test(read("hand-split-pdf-text.txt"))).toBe(false);
});

test("AthleticLIVE race document (Trackside Timing): places, names, teams, grades, bibs, ms finishes", () => {
  const c = parseAthleticLiveJson(JSON.parse(read("athleticlive-race.json")), "https://results.tracksidetiming.com/meets/1/events/xc/1001");
  expect(c.name).toBe("Boys Varsity");
  expect(c.distanceMeters).toBe(5000);
  expect(c.entries).toHaveLength(58);
  expect(c.entries.map((e) => e.place)).toEqual(c.entries.map((_, i) => i + 1));
  expect(c.entries[1]).toMatchObject({ name: "Eddy Giebler", firstName: "Eddy", lastName: "Giebler", team: "Sheboygan Area Lutheran", grade: 10, bib: "7817", status: "finished", finishMs: 16 * 60_000 + 41_900 });
  expect(c.entries.at(-1)?.finishMs).toBe(41 * 60_000 + 26_100);
  expect(c.precision).toBe("tenths");
  expect(c.source).toEqual({ kind: "athleticlive", url: "https://results.tracksidetiming.com/meets/1/events/xc/1001" });
  expect(c.entries.filter((e) => isOurTeam(e.team, ALIASES))).toHaveLength(1);
});

test("AthleticLIVE statuses: a DNF in the place or the mark; no finish is a DNF in final results, still running live", () => {
  const doc = { _source: { n: "Girls JV", ab: "5000m", r: [
    { p: "1", m: "19:02.3", im: 1142300, a: { fn: "Alex", l: "Abbott", y: "11", t: { n: "North Academy" } } },
    { p: "DNF", m: "", im: 0, a: { fn: "Blake", l: "Barlow", y: "09", t: { n: "South Academy" } } },
    { p: "", m: "DNS", a: { fn: "Casey", l: "Cole", y: "10", t: { n: "East Academy" } } },
    { p: "", m: "", a: { fn: "Drew", l: "Dalton", y: "12", t: { n: "West Academy" } } },
  ] } };
  const final = parseAthleticLiveJson(doc, "x");
  expect(final.entries.map((e) => [e.name, e.status, e.place, e.finishMs])).toEqual([
    ["Alex Abbott", "finished", 1, 1142300],
    ["Blake Barlow", "dnf", null, null],
    ["Casey Cole", "dns", null, null],
    ["Drew Dalton", "dnf", null, null],
  ]);
  expect(parseAthleticLiveJson(doc, "x", { live: true }).entries[3]).toMatchObject({ status: "finished", finishMs: null, place: null });
});

test("AthleticLIVE race links: the race id on any timer's domain, never a meet page", () => {
  expect(athleticLiveRaceId("https://results.tracksidetiming.com/meets/79348/events/xc/2933040")).toBe("2933040");
  expect(athleticLiveRaceId("https://dakotatiming.anet.live/meets/5/events/xc/77/")).toBe("77");
  expect(athleticLiveRaceId("https://results.tracksidetiming.com/meets/79348")).toBeNull();
  expect(athleticLiveRaceId("http://results.tracksidetiming.com/meets/1/events/xc/2")).toBeNull();
  expect(isLiveFeedUrl("https://results.tracksidetiming.com/meets/79348/events/xc/2933040")).toBe(true);
});

// ---- The fetch chain, with the network replaced by fixtures.

type Served = Record<string, string | { status: number; body?: string; redirect?: string }>;

function serve(routes: Served) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1];
      if (hit === undefined) return new Response("not found", { status: 404 });
      if (typeof hit === "string") return new Response(hit, { status: 200 });
      // A redirect the client has already followed: the response reports where it landed.
      const res = new Response(hit.body ?? "", { status: hit.status });
      if (hit.redirect) Object.defineProperty(res, "url", { value: hit.redirect });
      return res;
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const ARROW = "https://www.arrowliveresults.com";
const arrowRoutes = (): Served => ({
  [`${ARROW}/Results/pvResults?pEventId=24584`]: read("arrow-pvresults.html"),
  [`${ARROW}/Results/pvResults?pEventId=`]: "<table><tbody></tbody></table>", // any other event: not run yet
  [`${ARROW}/BoysVarsitySmSchool2026SampleInvite`]: read("arrow-page.html"),
  [`${ARROW}/GirlsVarsitySmSchool2026SampleInvite`]: read("arrow-page.html").replace("24584", "24585").replace("Boys Varsity", "Girls Varsity"),
  [`${ARROW}/BoysJVSmSchool2026SampleInvite`]: "<html><title>Not published</title></html>", // no EventId
});

test("an Arrow race page: event id from the page, rows from the partial, title as the name", async () => {
  const calls = serve(arrowRoutes());
  const [c] = await fromUrl(`${ARROW}/BoysVarsitySmSchool2026SampleInvite`);
  expect(c.name).toBe("Boys Varsity - Sm School - 2026 Sample Invite");
  expect(c.entries).toHaveLength(136);
  expect(calls).toEqual([`${ARROW}/BoysVarsitySmSchool2026SampleInvite`, `${ARROW}/Results/pvResults?pEventId=24584&pDivision=Overall&pChipTime=false`]);
  // The page is remembered; a live poll fetches only the rows.
  await fromUrl(`${ARROW}/BoysVarsitySmSchool2026SampleInvite`);
  expect(calls).toHaveLength(3);
});

test("an XM Timing meet page: every Arrow link, http upgraded, empty and unpublished races skipped", async () => {
  serve({ "https://www.xmtiming.com/sample-invite-2026": read("xm-meet-page.html"), ...arrowRoutes() });
  const contests = await fromUrl("https://www.xmtiming.com/sample-invite-2026");
  // Boys Varsity twice (two slugs on the page), Girls Varsity empty, Boys JV unpublished.
  expect(contests.map((c) => c.name)).toEqual(["Boys Varsity - Sm School - 2026 Sample Invite", "Boys Varsity - Sm School - 2026 Sample Invite"]);
  expect(contests.every((c) => c.entries.length === 136)).toBe(true);
});

test("a Badger State meet page: bundle key and feed, contests in race order, unpublished ones skipped", async () => {
  const B = "https://www.badgerstatetiming.live";
  const S = "https://fixture.supabase.co/rest/v1";
  const calls = serve({
    [`${B}/sample-classic`]: read("badger-page.html"),
    [`${B}/assets/index-a1b2c3d4.js`]: read("badger-bundle.js"),
    [`${S}/race_data?select=id&slug=eq.sample-classic`]: JSON.stringify([{ id: "race-1" }]),
    [`${S}/xc_contests?`]: JSON.stringify([
      { id: "c1", name: "Girls Division 3", distance: 5000, individual_results_url: "https://api.raceresult.com/1/G", race_order: 1 },
      { id: "c2", name: "Boys Division 3", distance: 5000, individual_results_url: null, race_order: 2 },
    ]),
    "https://api.raceresult.com/1/G": read("raceresult-contest.json"),
  });
  const contests = await fromUrl(`${B}/sample-classic`);
  expect(contests.map((c) => [c.name, c.distanceMeters, c.entries.length])).toEqual([["Girls Division 3", 5000, 221]]);
  expect(contests[0].source).toEqual({ kind: "raceresult", url: "https://api.raceresult.com/1/G" });
  // The Supabase key travels only to Supabase.
  const feedCall = (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit?][]).find(([u]) => u.startsWith("https://api.raceresult.com"));
  expect(feedCall?.[1]?.headers).toEqual({});
  expect(calls.filter((u) => u.startsWith(S))).toHaveLength(2);
});

test("a redirect off the known hosts, or a huge body, is refused", async () => {
  serve({ [`${ARROW}/Redirected`]: { status: 200, body: read("arrow-page.html"), redirect: "https://evil.example/landing" } });
  await expect(fromUrl(`${ARROW}/Redirected`)).rejects.toThrow(/redirected somewhere/);
  serve({ [`${ARROW}/Huge`]: "x".repeat(9 * 1024 * 1024) });
  await expect(fromUrl(`${ARROW}/Huge`)).rejects.toBeInstanceOf(SourceError);
});

test("several links at once: a bad one names itself", async () => {
  serve(arrowRoutes());
  await expect(fromUrl(`${ARROW}/BoysJVSmSchool2026SampleInvite`)).rejects.toThrow(/no event on it/);
});

test("an AthleticLIVE race page: fetched from AthleticLIVE's storage by its id, never from the page's host", async () => {
  const DOCS = "https://athleticlive.blob.core.windows.net/$web/ind_res_list/_doc/";
  const calls = serve({ [`${DOCS}1001`]: read("athleticlive-race.json") });
  const page = "https://results.tracksidetiming.com/meets/1/events/xc/1001";
  const [c] = await fromUrl(page);
  expect(c.entries).toHaveLength(58);
  expect(calls).toEqual([`${DOCS}1001`]);
  const live = await fromFeedUrl(page, undefined, { live: true });
  expect(live.entries[0].finishMs).toBe(16 * 60_000 + 4_500);
  await expect(fromUrl("https://results.tracksidetiming.com/meets/1")).rejects.toThrow(/race itself/);
});

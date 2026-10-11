import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { guessRace, isOurTeam, matchAthlete, normalizeName } from "./match";
import { headerLabels, parseArrowResultsHtml, parseRaceResultJson, parseResultsText } from "./parse";

// Real, unsanitized results stay out of git; these two tests run only where they exist.
// The committed, sanitized copies are covered in fixtures.test.ts.
const dir = `${process.cwd()}/data/results/2026-10-02-nightfall-classic`;
const withRealData = test.skipIf(!existsSync(dir));
const ALIASES = ["Sheboygan Lutheran", "Sheboygan Area Lutheran"];

withRealData("RACE RESULT json: columns, mats, DNF, our rows", () => {
  const rows = JSON.parse(readFileSync(`${dir}/girls-raceresult.json`, "utf8"));
  const c = parseRaceResultJson(rows, "Girls Division 3");
  expect(c.splitLabels).toEqual(["Mile 1", "Mile 2"]);
  expect(c.entries).toHaveLength(221);
  const elanore = c.entries.find((e) => e.lastName === "Faucher")!;
  expect(elanore).toMatchObject({ place: 26, status: "finished", grade: 10, bib: "1375", finishMs: 21 * 60_000 + 49_000 });
  expect(elanore.splits).toEqual({ "Mile 1": 7 * 60_000 + 2_300, "Mile 2": 14 * 60_000 + 10_900 });
  const dnf = c.entries.find((e) => e.status === "dnf")!;
  expect(dnf.lastName).toBe("Gregory");
  expect(dnf.finishMs).toBeNull();
  expect(Object.keys(dnf.splits)).toEqual(["Mile 1"]);
  expect(c.entries.filter((e) => isOurTeam(e.team, ALIASES))).toHaveLength(10);
});

withRealData("pdf text: header gives mat labels; rows parse incl. DNF without points", () => {
  const text = readFileSync(`${dir}/boys.txt`, "utf8");
  const c = parseResultsText(text, "Boys Division 3");
  expect(c.splitLabels).toEqual(["Mile 1", "Mile 2"]);
  const eddy = c.entries.find((e) => e.name === "Eddy Giebler")!;
  expect(eddy).toMatchObject({ place: 2, grade: 11, team: "Sheboygan Area Lutheran", finishMs: 16 * 60_000 + 23_800 });
  expect(eddy.splits).toEqual({ "Mile 1": 4 * 60_000 + 57_700, "Mile 2": 10 * 60_000 + 19_900 });
  const dnf = c.entries.filter((e) => e.status === "dnf");
  expect(dnf.map((e) => e.name)).toEqual(["Fritz Hoffmann", "Cole Staehler"]);
  expect(dnf[0].splits).toEqual({ "Mile 1": 5 * 60_000 + 35_100, "Mile 2": 11 * 60_000 + 47_000 });
  // Team-score lines ("3 Sheboygan Area Lutheran 125 2 8 28 …") must not become athletes.
  expect(c.entries.some((e) => e.name.includes("Area Lutheran"))).toBe(false);
  expect(c.entries.filter((e) => isOurTeam(e.team, ALIASES))).toHaveLength(17);
});

test("matching: exact, alias, last-name suggestion, none", () => {
  const athlete = (displayName: string, aliases: string[] = []) =>
    ({ _id: displayName, displayName, officialName: displayName, aliases }) as never;
  const roster = [athlete("Patrick Stroede"), athlete("James Schulze", ["Jimmy Schulze"]), athlete("Lucy Leibham"), athlete("Will Leibham")];
  const entry = (name: string) => ({ name, firstName: name.split(" ")[0], lastName: name.split(" ").slice(1).join(" ") }) as never;
  expect(matchAthlete(entry("Patrick Stroede"), roster).kind).toBe("exact");
  expect(matchAthlete(entry("Jimmy Schulze"), roster)).toMatchObject({ kind: "alias", athlete: { displayName: "James Schulze" } });
  const typo = matchAthlete(entry("Patrick Stoede"), roster);
  expect(typo.kind).toBe("none"); // no last-name match either; coach picks
  const lucy = matchAthlete(entry("Lucie Leibham"), roster);
  expect(lucy.kind).toBe("none"); // two Leibhams: not unique
  expect(lucy.candidates.map((a) => a.displayName)).toEqual(["Lucy Leibham", "Will Leibham"]);
  expect(matchAthlete(entry("Jim Schulze"), roster)).toMatchObject({ kind: "last-name", candidates: [{ displayName: "James Schulze" }] });
  expect(normalizeName("D'Angelo  RUIZ-Pérez")).toBe("dangelo ruizperez");
});

test("team alias matching tolerates suffixes", () => {
  expect(isOurTeam("Sheboygan Area Lutheran HS", ALIASES)).toBe(true);
  expect(isOurTeam("Sheboygan Lutheran", ALIASES)).toBe(true);
  expect(isOurTeam("Manitowoc Lutheran", ALIASES)).toBe(false);
});

test("header labels survive collapsed spacing", () => {
  expect(headerLabels("Mile 1 Mile 2")).toEqual(["Mile 1", "Mile 2"]);
  expect(headerLabels("Mile 1        Mile 2")).toEqual(["Mile 1", "Mile 2"]);
  expect(headerLabels("2K 4K")).toEqual(["2K", "4K"]);
  expect(headerLabels("")).toEqual([]);
});

test("live feed: a row with no finish yet is still running; an explicit DNF stays DNF", () => {
  const rows = [
    { Place: "", Bib: "12", Firstname: "Ava", Lastname: "Lee", Team: "Sheboygan Lutheran", Grade: "10", "Mile 1": "7:23.4", Finish: "" },
    { Place: "DNF", Bib: "13", Firstname: "Bo", Lastname: "Ray", Team: "Sheboygan Lutheran", Grade: "11", "Mile 1": "7:30.0", Finish: "" },
  ];
  const live = parseRaceResultJson(rows, "Girls", undefined, { live: true });
  expect(live.entries[0]).toMatchObject({ status: "finished", finishMs: null, splits: { "Mile 1": 7 * 60_000 + 23_400 } });
  expect(live.entries[1].status).toBe("dnf");
  // Final results: the same unfinished row is a DNF.
  expect(parseRaceResultJson(rows, "Girls").entries[0].status).toBe("dnf");
});

const arrowRows = (finish: string) => `<Table class="table table-striped"><thead><tr><th>Place</th><th>Bib#</th><th>Name</th><th>Team</th><th>Gender</th><th>Age</th><th>Finish</th></tr></thead><tbody>
<tr><td class="smallColumn">1</td><td class="smallColumn">1251</td><td><span class="visible-xs">#1251</span><a href="/ParticipantDetails/Details?pParticipantID=1">Eddy Giebler</a></td><td class="hidden-xs">Sheboygan Lutheran</td><td>M</td><td>0</td><td>00:17:09.87<br><text class="hidden-xs"></text></td></tr>
<tr><td class="smallColumn"></td><td class="smallColumn">222</td><td><a href="/ParticipantDetails/Details?pParticipantID=2">Brynlee Van Der Schmidt</a></td><td class="hidden-xs">Cedar Grove-Belgium</td><td>F</td><td>0</td><td>${finish}</td></tr>
</tbody></Table>`;

test("parses Arrow Live Results rows", () => {
  const c = parseArrowResultsHtml(arrowRows(""), "Boys Varsity - Sm School", "https://www.arrowliveresults.com/X");
  expect(c.source).toEqual({ kind: "arrow", url: "https://www.arrowliveresults.com/X" });
  expect(c.entries[0]).toMatchObject({ name: "Eddy Giebler", firstName: "Eddy", lastName: "Giebler", team: "Sheboygan Lutheran", bib: "1251", place: 1, status: "finished", finishMs: 17 * 60000 + 9870, grade: null });
  expect(c.entries[1]).toMatchObject({ name: "Brynlee Van Der Schmidt", lastName: "Van Der Schmidt", place: null, finishMs: null, status: "dnf" });
  // Mid-race the same row is a runner still out on the course.
  expect(parseArrowResultsHtml(arrowRows(""), "Boys Varsity", undefined, { live: true }).entries[1].status).toBe("finished");
  expect(parseArrowResultsHtml(arrowRows("DNF"), "Boys Varsity").entries[1]).toMatchObject({ status: "dnf", finishMs: null });
});

test("parses division results split out by hand: ordinal places, overall-place column, class years, displacer points", () => {
  const text = [
    "P L A C E O V R N A M E 	Y R T E A M 	T I M E 	P T S",
    "1st 	3 Eddy Giebler 	JR Sheboygan Lutheran 	16:16 	1",
    "14th 	30 Joe Vanic 	SR Sheboygan Lutheran 	18:23 	(13)",
    "15th 	32 Ezra Nowak 	SO Coleman 	18:25",
    "2nd Sheboygan Lutheran 	1 	3 	8 	11 	12 	(13) 	(15) 	35",
    "DNF 	— Sam Smith 	FR Oconto",
    "DNF = Did Not Finish",
    "16th 	33 Robert Smith Jr. 	11 Ozaukee 	18:30",
    "17th 	34 Bob Ray 	SR St. Mary 2 	18:31 	15",
    "18th 	35 JOHN SMITH JR 	11 Kewaunee 	18:32",
    "DNF 	Sam Who 	11",
    "DNF 	John Smith 	11 Team 	5:30 	0",
  ].join("\n");
  const c = parseResultsText(text);
  expect(c.entries.map((e) => [e.place, e.name, e.grade, e.team, e.finishMs, e.status])).toEqual([
    [1, "Eddy Giebler", 11, "Sheboygan Lutheran", 16 * 60000 + 16000, "finished"],
    [14, "Joe Vanic", 12, "Sheboygan Lutheran", 18 * 60000 + 23000, "finished"],
    [15, "Ezra Nowak", 10, "Coleman", 18 * 60000 + 25000, "finished"],
    [null, "Sam Smith", 9, "Oconto", null, "dnf"],
    [16, "Robert Smith Jr.", 11, "Ozaukee", 18 * 60000 + 30000, "finished"],
    [17, "Bob Ray", 12, "St. Mary 2", 18 * 60000 + 31000, "finished"],
    [18, "JOHN SMITH JR", 11, "Kewaunee", 18 * 60000 + 32000, "finished"],
    [null, "Sam Who", 11, "", null, "dnf"],
    [null, "John Smith", 11, "Team", null, "dnf"],
  ]);
  expect(c.entries.at(-1)?.splits).toEqual({ "Split 1": 330000 });
  expect(c.splitLabels).toEqual([]);
});

test("guesses the race from a contest or file name", () => {
  const races = [
    { id: "gv", name: "Girls Varsity", gender: "F" as const },
    { id: "bv", name: "Boys Varsity", gender: "M" as const },
    { id: "jv", name: "Boys & Girls JV", gender: "X" as const },
  ];
  expect(guessRace("Girls Varsity - Sm School - 2026 Mishicot Bremser Invite", races)).toBe("gv");
  expect(guessRace("Boys JV - Lg School - 2026 Mishicot Bremser Invite", races)).toBe("jv");
  expect(guessRace("Girls JV - Sm School - 2026 Mishicot Bremser Invite", races)).toBe("jv");
  expect(guessRace("xc-small-school-results-boys-jv-russ-fameree-10-9-26.pdf", races)).toBe("jv");
  expect(guessRace("xc-small-school-results-girls-varsity-russ-fameree-10-9-26.pdf", races)).toBe("gv");
  expect(guessRace("Boys MS Combined - 2026 Mishicot Bremser Invite", races)).toBeNull(); // nothing fits
  expect(guessRace("RACE RESULT contest 12345", races)).toBeNull();
  // A race named just "JV" against a plain "Junior Varsity Boys" contest.
  expect(guessRace("Junior Varsity Boys 5000m", [races[1], { id: "j", name: "JV", gender: null }])).toBe("j");
  expect(guessRace("Varsity Boys 5000m", [{ id: "j", name: "JV", gender: null }, races[1]])).toBe("bv");
  // "Junior" alone is not JV; a meet name with it doesn't poison every contest.
  expect(guessRace("Junior High Boys 2 Mile", races)).toBeNull();
  expect(guessRace("Boys Varsity - Junior Academy Invite", races)).toBe("bv");
  expect(guessRace("Boys Open 5K", races)).toBeNull();
  expect(guessRace("Boys Frosh/Soph 5K", races)).toBeNull();
  expect(guessRace("Boys Fr/So 5K", races)).toBeNull();
  expect(guessRace("Boys 9th Grade 5K", races)).toBeNull();
  expect(guessRace("Boys JV2 5K", races)).toBe("jv");
});

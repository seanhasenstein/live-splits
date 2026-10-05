import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { isOurTeam, matchAthlete, normalizeName } from "./match";
import { headerLabels, parseRaceResultJson, parseResultsText } from "./parse";

const dir = `${process.cwd()}/data/results/2026-10-02-nightfall-classic`;
const ALIASES = ["Sheboygan Lutheran", "Sheboygan Area Lutheran"];

test("RACE RESULT json: columns, mats, DNF, our rows", () => {
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

test("pdf text: header gives mat labels; rows parse incl. DNF without points", () => {
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

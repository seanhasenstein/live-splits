import { expect, test } from "vitest";
import { logoKey, teamInitials } from "./logos";

test("logo keys: results spellings and file names agree", () => {
  expect(logoKey("St. Mary's Springs")).toBe(logoKey("st-mary-springs".replace(/-/g, " ")));
  expect(logoKey("Saint Mary Springs")).toBe(logoKey("St Mary Springs"));
  expect(logoKey("Cedar Grove-Belgium")).toBe(logoKey("Cedar Grove Belgium"));
  expect(logoKey("Hilbert High School")).toBe(logoKey("Hilbert"));
  expect(logoKey("Kohler")).not.toBe(logoKey("Kewaunee"));
});

test("initials: two words, else the first two letters", () => {
  expect(teamInitials("Cedar Grove-Belgium")).toBe("CG");
  expect(teamInitials("Kohler")).toBe("KO");
  expect(teamInitials("Sheboygan Christian High School")).toBe("SC");
});

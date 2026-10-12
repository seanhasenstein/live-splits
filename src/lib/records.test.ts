import { expect, test } from "vitest";
import { recordBadge } from "./records";

const m = (min: number, s = 0) => (min * 60 + s) * 1000;
const bests = { pr: { ms: m(17, 10) }, sb: { ms: m(17, 30) }, course: { ms: m(17, 45) }, meet: { ms: m(18) } };

test("the strongest record shows; the rest ride along", () => {
  expect(recordBadge(m(17, 5), bests, true)).toMatchObject({ kind: "pr", all: ["pr", "sb", "course", "meet"], unofficial: false, uncertain: false, previousMs: m(17, 10) });
  expect(recordBadge(m(17, 20), bests, true)).toMatchObject({ kind: "sb", all: ["sb", "course", "meet"] });
  expect(recordBadge(m(17, 40), bests, true)).toMatchObject({ kind: "course", all: ["course", "meet"] });
  expect(recordBadge(m(17, 55), bests, true)).toMatchObject({ kind: "meet", all: ["meet"] });
  expect(recordBadge(m(18, 30), bests, true)).toBeNull();
});

test("equal to the old mark counts", () => {
  expect(recordBadge(m(17, 10), bests, true)?.kind).toBe("pr");
});

test("no previous mark, no badge", () => {
  expect(recordBadge(m(16), { pr: null, sb: null, course: null, meet: null }, true)).toBeNull();
  expect(recordBadge(m(16), undefined, true)).toBeNull();
  expect(recordBadge(null, bests, true)).toBeNull();
});

test("an app-tapped finish is unofficial, and uncertain inside two seconds of the mark", () => {
  expect(recordBadge(m(17, 5), bests, false)).toMatchObject({ unofficial: true, uncertain: false });
  expect(recordBadge(m(17, 9), bests, false)).toMatchObject({ unofficial: true, uncertain: true }); // 1 s under the PR
  expect(recordBadge(m(17, 9), bests, true)).toMatchObject({ unofficial: false, uncertain: false }); // the mats said so
});

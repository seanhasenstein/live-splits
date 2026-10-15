import { describe, expect, it } from "vitest";
import { awardStatus, DEFAULT_AWARDS, fieldScores, racePlaces, replayTicks, scoreTeams, shortLabel, teamKey, trackedTeamFor } from "./race-places";
import { replay, type TapLike } from "./replay";

let seq = 0;
const tap = (over: Partial<TapLike> & Pick<TapLike, "type">): TapLike => ({
  clientTapId: `t${String(++seq).padStart(3, "0")}`,
  checkpointId: "m1",
  athleteId: null,
  targetTapId: null,
  serverTimeMs: 0,
  timeMs: null,
  estimate: false,
  missed: false,
  ...over,
});
const tick = (team: string, at: number, cp = "m1") => tap({ type: "tick", team, serverTimeMs: at, checkpointId: cp });
const name = (athleteId: string, at: number, cp = "m1") => tap({ type: "name_tap", athleteId, serverTimeMs: at, checkpointId: cp });
const race = { checkpoints: [{ id: "m1", label: "Mile 1", distance: { value: 1, unit: "mi" as const, meters: 1609 }, kind: "split" as const }] };
const places = (taps: TapLike[]) => racePlaces(["m1"], replay(race, taps), replayTicks(taps), null).get("m1");

describe("scoreTeams", () => {
  it("scores the top five, lets six and seven displace, and drops incomplete teams", () => {
    // C has four runners (doesn't score, taken out); A's 8th runner is dropped; A's 6th and 7th displace.
    const order = ["A", "B", "C", "A", "B", "C", "A", "B", "A", "B", "A", "C", "B", "A", "C", "A", "A"];
    const s = scoreTeams(order);
    const a = s.find((t) => t.team === "A")!;
    const b = s.find((t) => t.team === "B")!;
    expect(a.places).toEqual([1, 3, 5, 7, 9, 11, 12]);
    expect(a.points).toBe(25);
    expect(b.places).toEqual([2, 4, 6, 8, 10]);
    expect(b.points).toBe(30);
    expect(s.find((t) => t.team === "C")!.points).toBeNull();
    expect(s[0].team).toBe("A");
  });

  it("counts unknown runners as places that score for nobody", () => {
    const s = scoreTeams(["*", "A", "A", "*", "A", "A", "A"]);
    expect(s[0].places).toEqual([2, 3, 5, 6, 7]);
    expect(s[0].points).toBe(23);
  });

  it("breaks a tie with the sixth runner", () => {
    const s = scoreTeams(["A", "B", "B", "A", "A", "B", "B", "A", "A", "B", "B", "A"]);
    // A: 1,4,5,8,9 = 27, sixth 12; B: 2,3,6,7,10 = 28 → A wins outright here; flip one to tie.
    expect(s.map((t) => t.points)).toEqual([27, 28]);
    const tie = scoreTeams(["A", "B", "B", "A", "A", "B", "A", "B", "B", "A", "B", "A"]);
    // A: 1,4,5,7,10 = 27, sixth 12; B: 2,3,6,8,9 = 28.
    expect(tie[0].team).toBe("A");
  });
});

describe("racePlaces", () => {
  it("slots our name taps in by time among the team taps", () => {
    const p = places([tick("t_kim", 1000), name("emma", 2000), tick("t_kim", 3000), name("ava", 4000)])!;
    expect(p.countingAll).toBe(false);
    expect(p.place.get("emma")).toBe(2);
    expect(p.place.get("ava")).toBe(4);
  });

  it("gives overall places once Other is tapped", () => {
    const p = places([tick("other", 1000), tick("t_kim", 1500), name("emma", 2000), tick("other", 2500), name("ava", 3000)])!;
    expect(p.countingAll).toBe(true);
    expect(p.place.get("emma")).toBe(3);
    expect(p.place.get("ava")).toBe(5);
  });

  it("matches a places-only phone's Us taps to the names in the order they were tapped", () => {
    // The name phone ran a second behind: order still comes from the Us taps.
    const p = places([tick("other", 1000), tick("us", 1100), tick("t_kim", 1200), tick("us", 1300), name("emma", 2100), name("ava", 2300)])!;
    expect(p.place.get("emma")).toBe(2);
    expect(p.place.get("ava")).toBe(4);
  });

  it("keeps earlier names by time when a phone switches to places only partway", () => {
    const p = places([name("emma", 1000), tick("other", 4000), tick("us", 20_000), tick("other", 20_100), name("ava", 20_500)])!;
    expect(p.place.get("emma")).toBe(1);
    expect(p.place.get("ava")).toBe(3);
  });

  it("gives no place to names after the places phone stopped counting", () => {
    // Us A, Other, Us B, Other, then Done counting; our 7th runner is named much later.
    const p = places([tick("us", 1000), tick("other", 2000), tick("us", 3000), tick("other", 4000), name("a", 1500), name("b", 3500), name("c", 90_000)])!;
    expect(p.place.get("a")).toBe(1);
    expect(p.place.get("b")).toBe(3);
    expect(p.place.has("c")).toBe(false);
    expect(p.entries).toHaveLength(4);
  });

  it("ignores taps from before the gun", () => {
    const taps = [tick("other", 500), tick("t_kim", 600), tick("other", 2000), name("emma", 3000)];
    const p = racePlaces(["m1"], replay(race, taps), replayTicks(taps), 1000).get("m1")!;
    expect(p.place.get("emma")).toBe(2);
  });

  it("brings a removed runner back when the remove is undone", () => {
    const a = tick("other", 1000);
    const remove = tap({ type: "void", targetTapId: a.clientTapId, serverTimeMs: 5000 });
    const taps = [a, name("emma", 2000), tick("other", 2500), remove];
    expect(places(taps)!.place.get("emma")).toBe(1);
    expect(places([...taps, tap({ type: "void", targetTapId: remove.clientTapId, serverTimeMs: 6000 })])!.place.get("emma")).toBe(2);
  });

  it("keeps a place for an Us tap whose name nobody tapped", () => {
    const p = places([tick("us", 1000), tick("us", 1100), name("emma", 2000)])!;
    expect(p.entries[1]).toMatchObject({ kind: "us", athleteId: null });
    expect(p.place.get("emma")).toBe(1);
  });

  it("re-places everyone when a tap is undone, moved or relabeled", () => {
    const a = tick("other", 1000);
    const b = tick("other", 2000);
    const base = [a, b, name("emma", 3000)];
    expect(places(base)!.place.get("emma")).toBe(3);
    // Undo one Other.
    expect(places([...base, tap({ type: "void", targetTapId: a.clientTapId, serverTimeMs: 5000 })])!.place.get("emma")).toBe(2);
    // Emma was actually ahead of the second Other: move that tap behind her.
    expect(places([...base, tap({ type: "edit", targetTapId: b.clientTapId, timeMs: 3001, serverTimeMs: 5000 })])!.place.get("emma")).toBe(2);
    // It was a Kimberly runner, not an Other.
    const relabeled = places([...base, tap({ type: "edit", targetTapId: b.clientTapId, team: "t_kim", serverTimeMs: 5000 })])!;
    expect(relabeled.entries[1]).toMatchObject({ kind: "team", teamId: "t_kim" });
    // Undo of a fix puts it back.
    const fix = tap({ type: "edit", targetTapId: b.clientTapId, team: "t_kim", serverTimeMs: 5000 });
    expect(places([...base, fix, tap({ type: "void", targetTapId: fix.clientTapId, serverTimeMs: 6000 })])!.entries[1]).toMatchObject({ kind: "other" });
  });

  it("scores head to head and, when counting everyone, estimates the meet", () => {
    const taps = [
      ...["us", "t_kim", "other", "us", "t_kim", "us", "t_kim", "us", "t_kim", "other", "us", "t_kim"].map((t, i) => tick(t, 1000 + i * 100)),
    ];
    const p = places(taps)!;
    const us = p.scores.find((s) => s.team === "us")!;
    const kim = p.scores.find((s) => s.team === "t_kim")!;
    expect(us.points).toBe(1 + 3 + 5 + 7 + 9);
    expect(kim.points).toBe(2 + 4 + 6 + 8 + 10);
    const est = p.estimate!.find((s) => s.team === "us")!;
    expect(est.places).toEqual([1, 4, 6, 8, 11]);
  });

  it("has nothing for a checkpoint nobody counted", () => {
    expect(places([name("emma", 1000)])).toBeUndefined();
  });
});

describe("awardStatus", () => {
  it("says which line a place makes and how far the next one is", () => {
    expect(awardStatus(7, DEFAULT_AWARDS)).toEqual({ made: DEFAULT_AWARDS[0], next: null });
    expect(awardStatus(12, DEFAULT_AWARDS)).toEqual({ made: DEFAULT_AWARDS[1], next: { line: DEFAULT_AWARDS[0], places: 2 } });
    expect(awardStatus(34, DEFAULT_AWARDS)).toEqual({ made: null, next: { line: DEFAULT_AWARDS[2], places: 4 } });
  });
});

describe("team names", () => {
  it("matches the ways results write a school", () => {
    expect(teamKey("Kimberly High School")).toBe("kimberly");
    expect(teamKey("KIMBERLY HS")).toBe("kimberly");
    const teams = [{ id: "t_a", name: "Kimberly", short: "KIM", color: "red", aliases: [] }];
    expect(trackedTeamFor("Kimberly H.S.", teams)?.id).toBe("t_a");
    expect(trackedTeamFor("Kaukauna", teams)).toBeNull();
    expect(shortLabel("Kimberly")).toBe("KIM");
    expect(shortLabel("Little Chute High School")).toBe("LC");
  });
});

describe("fieldScores", () => {
  it("scores the official field with our school as us, whatever the spelling", () => {
    const f = (team: string | null, place: number, ours = false, status = "finished") => ({ team, place, status, ours });
    const field = [
      f("Hilbert", 1, true), f("Kimberly HS", 2), f("Hilbert High School", 3), f(null, 4), f("Kimberly", 5),
      f("Hilbert", 6, true), f("Kimberly", 7), f("Hilbert", 8, true), f("Kimberly", 9), f("Hilbert", 10, true), f("Kimberly", 11),
      f("Kaukauna", 12), f("Kimberly", 13, false, "dnf"),
      // Shares a name with one of ours, but runs for Kaukauna.
      f("Kaukauna", 14, true),
    ];
    const { scores, names } = fieldScores(field);
    const us = scores.find((s) => s.team === "us")!;
    // The unattached 4th and Kaukauna (one runner) don't score and are taken out.
    expect(us.places).toEqual([1, 3, 5, 7, 9]);
    expect(scores.find((s) => s.team === "kimberly")!.places).toEqual([2, 4, 6, 8, 10]);
    expect(scores.find((s) => s.team === "kaukauna")!.points).toBeNull();
    expect(names.get("kimberly")).toBe("Kimberly HS");
  });
});

import { describe, expect, it } from "vitest";
import { countdownFlash } from "./workout-tint";

describe("countdown flash", () => {
  it("flashes amber just after 10 s to go and red just after Go, briefly, and not for an open rest", () => {
    const go = 100_000;
    expect(countdownFlash(go, go - 10_001)).toBeNull();
    expect(countdownFlash(go, go - 10_000)).toBe("soon");
    expect(countdownFlash(go, go - 9_400)).toBe("soon");
    expect(countdownFlash(go, go - 9_300)).toBeNull();
    expect(countdownFlash(go, go)).toBe("go");
    expect(countdownFlash(go, go + 699)).toBe("go");
    expect(countdownFlash(go, go + 700)).toBeNull();
    expect(countdownFlash(null, go)).toBeNull();
  });
});

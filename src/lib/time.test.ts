import { expect, test } from "vitest";
import { coarser, formatElapsed, parseElapsed } from "./time";

test("formatElapsed at each precision truncates, never rounds", () => {
  const ms = 16 * 60_000 + 16_987;
  expect(formatElapsed(ms, "seconds")).toBe("16:16");
  expect(formatElapsed(ms, "tenths")).toBe("16:16.9");
  expect(formatElapsed(ms, "hundredths")).toBe("16:16.98");
  expect(formatElapsed(ms)).toBe("16:16.9");
  expect(formatElapsed(3_599_999, "seconds")).toBe("59:59");
  expect(formatElapsed(3_600_000, "seconds")).toBe("1:00:00");
  expect(formatElapsed(-1_500, "seconds")).toBe("-0:01");
});

test("coarser keeps a team on seconds at seconds and a sheet in seconds at seconds", () => {
  expect(coarser("seconds", "hundredths")).toBe("seconds");
  expect(coarser("tenths", "seconds")).toBe("seconds");
  expect(coarser("tenths", "hundredths")).toBe("tenths");
  expect(coarser("tenths", "tenths")).toBe("tenths");
});

test("parseElapsed round-trips whole seconds", () => {
  expect(parseElapsed("16:16")).toBe(16 * 60_000 + 16_000);
  expect(formatElapsed(parseElapsed("16:16")!, "seconds")).toBe("16:16");
});

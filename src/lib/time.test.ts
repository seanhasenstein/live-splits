import { expect, test } from "vitest";
import { coarser, formatElapsed, parseElapsed, parseTypedTime } from "./time";

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

test("parseTypedTime reads keypad digits like a microwave and colon forms as written", () => {
  expect(parseTypedTime("640")).toBe(6 * 60_000 + 40_000);
  expect(parseTypedTime("6:40")).toBe(6 * 60_000 + 40_000);
  expect(parseTypedTime("640.5")).toBe(6 * 60_000 + 40_500);
  expect(parseTypedTime("6:40.5")).toBe(6 * 60_000 + 40_500);
  expect(parseTypedTime("1234")).toBe(12 * 60_000 + 34_000);
  expect(parseTypedTime("12345")).toBe(3600_000 + 23 * 60_000 + 45_000);
  expect(parseTypedTime("1:02:03")).toBe(3600_000 + 2 * 60_000 + 3_000);
  expect(parseTypedTime("45")).toBe(45_000);
  expect(parseTypedTime("5")).toBe(5_000);
  expect(parseTypedTime("")).toBeNull();
  expect(parseTypedTime("670")).toBeNull(); // 70 seconds
  expect(parseTypedTime("6:70")).toBeNull();
  expect(parseTypedTime("6:4")).toBeNull();
  expect(parseTypedTime("abc")).toBeNull();
  expect(parseTypedTime("6.40")).toBeNull(); // a dot is tenths, not a colon
});

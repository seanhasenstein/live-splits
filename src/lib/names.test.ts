import { describe, expect, it } from "vitest";
import { shortNames } from "./names";

describe("shortNames", () => {
  it("first name when unique, then last initial, then last name, only as long as needed", () => {
    const names = shortNames([
      { id: "a", name: "Ajani Laster" },
      { id: "e1", name: "Emma Krueger" },
      { id: "e2", name: "Emma Winter" },
      { id: "e3", name: "Emma Kowalski" },
      { id: "j1", name: "Joe Vanic" },
      { id: "j2", name: "Joe Vanic" },
    ]);
    expect(names.get("a")).toBe("Ajani");
    expect(names.get("e2")).toBe("Emma W.");
    expect(names.get("e1")).toBe("Emma Krueger");
    expect(names.get("e3")).toBe("Emma Kowalski");
    expect(names.get("j1")).toBe("Joe Vanic");
  });

  it("uses the last name, not a middle name or suffix", () => {
    const names = shortNames([
      { id: "a", name: "Emma Rose Kay" },
      { id: "b", name: "Emma Winter" },
      { id: "c", name: "Joe Smith Jr." },
      { id: "d", name: "Joe Vanic" },
    ]);
    expect(names.get("a")).toBe("Emma K.");
    expect(names.get("c")).toBe("Joe S.");
  });
});

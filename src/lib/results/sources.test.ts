import { expect, test } from "vitest";
import { fromRaceResultUrl, fromUrl, SourceError } from "./sources";

// Host pinning: these must be rejected before any network request is made.
test("result links are pinned to known https hosts", async () => {
  for (const url of [
    "http://api.raceresult.com/1/ABC",
    "https://evilbadgerstatetiming.live/meet",
    "https://api.raceresult.com.evil.example/1/ABC",
    "https://localhost/x",
    "https://169.254.169.254/latest",
    "not a link",
  ]) {
    await expect(fromUrl(url)).rejects.toBeInstanceOf(SourceError);
  }
  await expect(fromRaceResultUrl("https://example.com/feed.json")).rejects.toBeInstanceOf(SourceError);
});

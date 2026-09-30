# Live Splits — Project Plan

Owner: Sean (developer + XC/track coach, Sheboygan Lutheran Crusaders)
Status: Greenfield. First milestone is a field test on **Friday, Oct 2, 2026**.

---

## 1. Context

Today, team managers stand at mile marks with stopwatches and paper sheets. They start their watches at the gun, walk to their mark, and write down cumulative times as our athletes pass. After the meet Sean types everything into an Excel workbook (cumulative mile times), which feeds a Python/WeasyPrint pipeline that produces post-meet PDFs (Meet Splits, Highlights, Course Top 30, Season Times Grid, etc.).

This app replaces the paper sheets and manual entry:
- Managers tap on their phones as athletes pass each checkpoint.
- Coaches watch splits live.
- Afterward, data exports in the format the PDF pipeline already uses.

Long-term, it grows into a full program app: seasons, athletes, meets, courses, results, records, PR/SB badges, and eventually auto-generated post-meet documents. **The data schema must be built for that future now** (see §5), even though the MVP uses only part of it.

Our splits: Mile 1, Mile 2, finish (3.1 mi / 5K; the last split is ~1.1 mi and comes from official finish time − Mile 2). Usually 2 managers, sometimes 1, sometimes a coach helps. Everyone has a phone. Cell signal has generally been fine, but it's not guaranteed.

---

## 2. Friday MVP (Oct 2, 2026)

- Night meet on a golf course. Two races: **Girls** and **Boys** (varsity + JV run together in each race).
- The meet has **timing mats at every mile**, which gives us ground truth. The app runs *alongside* paper sheets and is not relied on.
- Success = app splits within ~1s of mat splits, and managers found it usable.

### MVP scope

1. **Meet setup (coach):** create meet → two races → pick which roster athletes run in each race → checkpoints (1 mi, 2 mi, optional finish).
2. **Join codes (no accounts yet):** each meet has a **manager code** (tap) and a **coach code** (tap + fix + set gun + export). Joining asks for a first name, stored on every tap. Session in an httpOnly cookie. Plus a read-only viewer link (exists, unshared).
3. **Gun time:** anyone at the start taps "Gun" for a race, and it syncs to everyone. Editable later, including setting it from official results (official finish − tapped finish). Managers never need to hear the gun.
4. **Clock sync:** on join and periodically, compute the device ↔ server clock offset (NTP-style round trip, take the best of several samples). Every tap stores the device timestamp, offset and server-corrected timestamp. **Store absolute timestamps, never elapsed time.** Elapsed = tap − gun, calculated when displayed.
5. **Checkpoint tap screen:** the manager picks a race + checkpoint (switchable, e.g. covering Mile 1 then walking to Mile 2).
   - **Name grid:** large buttons, reordered by each athlete's order at the previous checkpoint. Tapping a name records the current time.
   - **CAPTURE bar** (full-width, bottom): each tap creates an unnamed timestamp slot. Pending slots show at the top in order ("3 unassigned: 6:02.4, 6:02.9, 6:03.3"). **When slots are pending, tapping a name fills the oldest slot. When none are pending, tapping a name records the current time.** No mode switch.
   - Double-tap guard (ignore a repeat tap on the same name within ~1s). If a name already has a time at this checkpoint, confirm "Replace 6:02.4?"
   - Confirmation: every tap flashes the button and shows a toast ("Recorded Emma — Undo") for a few seconds. iOS web can't vibrate, so it has to be visual.
   - Standing **Undo** button that reverses the last action.
   - Screen Wake Lock while on this screen.
6. **Fix tools** (tap any recorded time; managers and coaches): move to another athlete, swap two athletes, nudge ±0.5s/±1s or type a time, delete (soft), mark missed, add manually with an "estimate" flag. Delete a pending slot.
7. **Live board (coach + viewer):** per race, a table of athletes × checkpoints showing cumulative time and the split between checkpoints. Athletes who haven't passed yet are grayed out. **Polls every 2–3s** (no websockets or realtime service for MVP). After the race it's the review and fix screen.
8. **Resilience:** taps are written to local storage first (IndexedDB) and retried until the server confirms. Idempotent via a client-generated tap ID. A full offline sync engine is out of scope.
9. **CSV export** of cumulative times in **the same layout as Sean's existing Excel split workbook** (ask Sean for a sample and match its columns exactly). Edited and estimated times are flagged.
10. **Results / mat import (post-meet):** paste or upload the official results (with mat splits) → store the full field as race entries → match our athletes by name/alias → **comparison report**: per athlete, app vs mat at each checkpoint, plus mean and max absolute error.
11. **Add to home screen** (web app manifest, icons).

### Out of scope for MVP (schema supports it; build later)
Real accounts / email PIN auth · place counter ("tick every runner") · video place detection · PR/SB badges UI · history import · Top N lists · PDF generation · dark mode · realtime transport · multi-school onboarding.

---

## 3. Stack

- Latest stable **Next.js (App Router)** + **TypeScript**, standalone repo (not a monorepo for now).
- **MongoDB Atlas** (confirm driver vs Mongoose with Sean; he's used both patterns). **Zod** for validation at every API boundary.
- **Tailwind** (+ shadcn/ui if it speeds things up; restyle to the design system).
- **Vercel** hosting. pnpm.
- Future auth: **custom email PIN auth** (Sean's pattern from Officials Connection and Heddley), sent via AWS SES. Hashed PIN, short expiry, attempt and resend limits, long sessions. **Not** Auth.js magic links (links open in the wrong browser from a home-screen app, and school email scanners consume one-time links).

---

## 4. Design system — web version of "V4B Hairline / Crusader"

Mirrors Sean's post-meet PDFs.
- Colors (as CSS variables / Tailwind tokens so a dark theme is just a second token set later):
  deep green `#184A23`, gold `#C99A06`, soft gold `#E8CC91`, cream `#FAF6E9`.
- Type: Helvetica Neue (system stack fallback). **Tabular numerals everywhere times appear.**
- Hairline section titles: small green caps + thin green underline.
- Tables (`sb-table` style): 1.2pt-equivalent green header rule, 1px row separators, right-aligned numeric columns.
- Tap screen: green-on-cream name buttons (very large targets), gold for pending captures, a gold flash for confirmations. High contrast for sun and portable lights.
- Light mode only for MVP.

---

## 5. Data schema (build ALL of this now; MVP uses a subset)

### Principles
- **Configuration and calculation over hardcoding.** Anything that varies by state, level or program is data or a setting. Derived things (lists, badges, records) are **calculated from results when queried, never stored**; store an override only when you need to hand-correct something.
- **Multi-tenant from day one:** every document carries `schoolId`.
- **Every time is stored as integer milliseconds**, plus `precision` (tenths/hundredths/thousandths) and `timingMethod` (fully automatic / hand / RFID / app).
- **Sources on everything:** `source` (app, mat, athleticnet, pttiming, manual, legacy_board), `createdBy`, `updatedBy`, timestamps.
- **Soft deletes** (`deletedAt`); nothing is truly deleted.
- **`schemaVersion`** on every document type.
- **Track-ready:** results store a typed **mark**, not just a time.
- No program-defined custom fields.

### Collections

**schools** — tenant. Name, state, settings.

**programs** — school × sport (`xc`, `track_outdoor`, `track_indoor`). Settings:
- `recordsStartGrade` (default 9; results below it are stored but excluded from records)
- `defaultListLength` (e.g. 30 for Top N lists; overridable per query)
- display unit preference (mi/km)
- class year system (`hs_grade` | `ms_grade` | `college_class` | `age_group`)
- configurable **level labels** (Varsity, JV, JV2, Frosh-Soph, Open…) and **race category labels** (Girls, Boys, Women, Men, Open, Mixed…); not enums
- coach roles

**seasons** — program × label + `startDate` / `endDate` (indoor seasons span calendar years). Letter/badge rule definitions stored as data (e.g. "time under this season's per-meet cutoff").

**athletes** — one per person, across sports and seasons. `displayName` (preferred) + `officialName`, `aliases[]` (timing-site spellings), `gender`/category, `graduationYear` (nullable for alumni), optional `birthYear` (clubs), `athleticNetId`, soft-delete. No profiles for other schools' runners.

**seasonRosters** — athlete × season, default level.

**distances** — shared definitions:
```ts
{ _id: "xc-5000m", sport: "xc", value: 5, unit: "km", meters: 5000, label: "5K" }
// unit: "m" | "km" | "mi" | "yd"; meters is calculated from value+unit (3 mi = 4828.032).
// label is auto-generated but editable; display only, never used for logic.
// unique (sport, value, unit). Preload 5K, 3 mi, 6K, 8K, 10K, 4K, 2 mi, 1.5 mi; custom allowed.
```
**PRs/SBs are grouped by distance definition, never by comparing meter values** (avoids float mismatches). The same `{value, unit, meters}` shape is used for checkpoint distances and measured distances.

**venues** — physical location.

**courses** — a specific layout at a venue: typical measured distance, years active, notes. When a layout changes, it's a new course.

**meetSeries** — the annual meet as an ongoing event (e.g. Crusader Challenge, Jim Bremser Memorial). **Meet Top N ≠ course Top N**; they are separate queries.

**meets** — date stored as **local date + IANA time zone** (avoids Friday night showing up as Saturday), series, venue, course, season, weather, join codes (hashed).

**events / races** — belongs to a meet. Race category, levels included (e.g. V+JV combined), `distanceId`, optional **measured distance** (`{value, unit, meters}`, method: wheel / GPS median / certified, note; perspective only, times never adjusted), **gun time** (absolute), **checkpoints** (`[{id, label, distance}]`), heats/sections (track), team results as imported (team place, points, teams scored; scoring rules vary, so store the official numbers rather than calculating).
**Exclusions** (race level): separate flags `excludeFromPrSb`, `excludeFromCourseLists`, `excludeFromMeetLists` + required `exclusionReason`.

**results** — one per athlete per event:
- `mark: { type: "time" | "distance" | "height", value, precision, timingMethod }`
- overall place, level + level place, status (finished/DNF/DNR/DQ/DNS)
- **grade snapshot** at the time of the race (nullable, can be backfilled later)
- canonical `splits[]: { checkpointId, cumulativeMs, source, edited, estimate }`; app and mat splits are both kept, so comparing them is a query
- result-level exclusion flags + reason (override the race's flags)
- `legacy: true` for Top-30-board entries with partial data (partial date/year, course or series, name, time). When a real result is imported later, link the legacy entry to it and hide it (`supersededBy`) so lists never double-count.
- relay: `legs[]: { athleteId, order, splitMs? }`; field events: optional `attempts[]`, wind reading.
- links to its `raceEntryId`.

**raceEntries** — the **full field** of each race as published by the timing company (all schools): name, school, grade, bib, place, time, mat splits. Re-importing a corrected file replaces that race's entries without touching our athletes' results. Powers full results pages, true places at each mile, and later head-to-head and rivals.

**imports** — raw pasted/uploaded source files stored as-is, with source type and timestamp.

**taps** — append-only raw log from the app. Types: `gun`, `capture`, `assign`, `name_tap`, `edit`, `void`, `tick` (future counter mode). Fields: client tap ID (idempotency), race, checkpoint, athlete (nullable), device time, clock offset, server-corrected time, `createdBy`. **Never edited**; corrections are new events. Result splits are derived from taps.

**users / sessions / pins** — for future email PIN auth; MVP uses join-code sessions.

### Records and badges (calculated; build the query layer, UI later)
- PR (by distance definition), course PR, meet (series) PR, SB, course SB; team boards: course Top N, meet Top N, school records; per-grade records later (needs grade snapshots).
- **One shared eligibility filter** used by all of them: distance definition, `recordsStartGrade`, race + result exclusions, not deleted, not superseded. V/JV level is ignored for PR/SB.
- Top N lists take a length parameter (program default). The app tracks how far back full history goes and says "history complete from YYYY" instead of showing a misleading list.
- Badge priority on a result: PR > SB as the main badge; course/meet PR as secondary. Adjust to match the PDFs.

### Indexes (starting point)
results: `{schoolId, athleteId, distanceId, mark.value}`, `{schoolId, raceId}`; races: `{meetId}`; meets: `{schoolId, seasonId, date}`, `{courseId}`, `{meetSeriesId}`; taps: `{raceId, checkpointId, serverTime}`, unique `{clientTapId}`; raceEntries: `{raceId, place}`; athletes: `{schoolId, aliases}`; distances: unique `{sport, value, unit}`.

---

## 6. Build order

1. **Schema:** TypeScript types + Zod schemas + index setup + `SCHEMA.md` explaining each decision. Seed: school, XC program, 2026 season, distances, roster (from Sean's CSV). → Sean reviews.
2. Join codes + sessions, meet/race/checkpoint setup, gun tap, clock sync.
3. Checkpoint tap screen (name grid + CAPTURE queue + undo + guards + local queue/retry).
4. Fix tools + live board (polling).
5. CSV export matching the workbook; deploy to Vercel; **dry run** with two phones against a fake race.
6. (After Friday) results/mat import → race entries → comparison report.

Commit after each step. Keep it simple; this ships in ~2 days.

---

## 7. Need from Sean
- GitHub repo name; Atlas connection string; Vercel project.
- **XC roster CSV:** name as he wants it displayed, gender, graduation year, V/JV default, known alternate spellings. (Canonical spellings matter: e.g. Dannielle Bult, Patrick Stroede, Elanore Faucher.)
- A sample of the **Excel split workbook** so the export matches it exactly.
- Friday's meet name, venue, start times.
- MongoDB driver vs Mongoose preference.

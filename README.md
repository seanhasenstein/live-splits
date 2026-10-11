# Live Splits

Working name (set in `src/config/app.ts`). See `PLAN.md` for the full spec and
`SCHEMA.md` for the data model.

## Setup

```bash
pnpm install
cp .env.example .env.local   # then fill in MONGODB_URI, SESSION_SECRET, COACH_ACCESS_CODE
pnpm db:seed                 # indexes + school, program, season, distances, roster
pnpm dev
```

`pnpm db:seed` reads `data/roster.csv` (git-ignored; columns are listed in
`SCHEMA.md`).

## Scripts

- `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm typecheck`
- `pnpm test` — unit tests. `src/lib/results/fixtures/` holds real vendor output (Arrow/XM, RACE RESULT, Badger State PDF text, a hand-split division PDF) with other schools' names replaced, run through the parsers and the fetch chain; regenerate a fixture from a fresh download when a vendor changes its format. Two tests on unsanitized local data (`data/results/`, git-ignored) skip where it isn't present.
- `pnpm db:indexes` — create indexes (run again after pulling: new indexes were added Oct 8)
- `pnpm db:seed` — create indexes and seed
- `pnpm db:migrate` — backfill fields added since the database was seeded
- `pnpm db:clear-taps "<meet>" --yes` — wipe a meet's taps and gun times (test data)
- `pnpm db:delete-meet "<meet>" --yes` — hard-delete a test meet and everything tied to it (races, taps, imports, entries, results, its join sessions, and its venue/course/series if no other meet uses them); dry run without `--yes`. Deleting a meet in the UI only hides it (soft delete) and keeps its log.
- Any of these runs against another database with `MONGODB_URI=… MONGODB_DB=… pnpm db:…`

## How access works (MVP, no accounts)

- A coach types `COACH_ACCESS_CODE` on `/join` to get a school-level coach
  session: create meets, set up races, see/regenerate join codes.
- Each meet has a **manager code** (tap, fix, gun) and a **coach code** (same
  plus export). Coaches see them behind the meet page's **Share** button any
  time (stored encrypted), tap to copy, share `/join?code=…` links, and can
  regenerate them from the same sheet.
- The **viewer link** (`/v/<token>`) opens a read-only session for one meet.
- The **season link** (Meets → Season link; also `/v/<token>`) opens a
  read-only session for every meet: the meets list (happening now / upcoming /
  past) and each meet's live results. Share it once with parents; replacing it
  signs those viewers out.
- Sessions live in an httpOnly cookie for a year.

Polling follows the race state: 10 s before the start, 2.5 s while in progress
(15 s after 90 minutes, with a nudge to mark the race finished), 30 s once
finished, and paused while the page is hidden. The meet page refreshes at 5 s
while any race is in progress, otherwise 30 s.

Clock sync: devices sample `GET /api/time` five times and keep the shortest
round trip (`src/lib/client/clock.ts`). Every tap sends device time + offset;
the server stores both plus the corrected time. `POST /api/taps` is idempotent
on `clientTapId`.

## Venues and courses

A venue is the place (Tuscumbia Golf Course); a course is a layout there, and
a changed route is a new course, because course bests only make sense on the
same layout. The meet form asks for the venue only: the first meet at a venue
creates a course named after it; later meets reuse the venue's current layout
unless the coach picks another or adds a "New layout…". Meets can be edited
(meet page → Edit) to set this on meets created before courses existed. The
record screen's "Compare with · This course" and the "Names and tiles" sheet's "same
course" tag both key off `meets.courseId`.

## Combined races

When boys and girls JV run together, set up one race with the **Mixed**
category: the lineup offers the whole roster, managers see one list at each
checkpoint, and the live results page gets an Everyone / Girls / Boys filter.
Import maps each gender's results contest to that same race (places stay per
contest), and the CSV's Race column reads "JV Girls" / "JV Boys" so the
workbook can split them.

## Past seasons

Meets → the history button → upload the team's split-sheet PDF (one PDF for
years of meets: "Meet, Month Dth YYYY" header, a table per gender with
Mile 1 / Mile 2 / Mile 3.1 segment times, Finish, Place with "JV" for the JV
race). The review lists the meets (ticked unless already in the app), lets
you name each venue (for course bests) and decide who each unknown name is
(an existing athlete, or a new alumni with a graduation year). Everything
lands in one transaction: seasons, meets, races with Mile 1 / Mile 2 /
Finish checkpoints, results with mat splits, alumni and season rosters, and
`programs.settings.historyCompleteFromYear` moves back to the earliest
season imported.

## Official results

- **After a race:** meet page → Import results (timing company link, pasted
  text, or PDF). Official finishes and mat splits then replace app taps on
  every screen; Adjust → "Set the gun from official results" lines the app's
  splits up with the mats; the App vs official page shows the error.
  When a sheet scored two divisions as one field, the wizard's "Pick our
  division's teams" keeps those teams and ranks them by time; the race is
  flagged `placesDerived` and the board says "division place".
  Imported times keep the sheet's precision (whole seconds, tenths,
  hundredths) and are shown no finer than that, or than the program's
  `timePrecision` setting (whole seconds for the Crusaders). The record screen
  and running race clocks always show tenths.
- **During a race:** Adjust → "Live official results" links the race to the
  timing company's feed (paste their results page or a RACE RESULT contest
  link, pick the contest). While the race is in progress the taps poll carries
  official times from that feed; the server reads the feed at most every 15 s
  per race no matter how many phones are watching (`src/lib/results/live.ts`).
  Only exact and alias name matches are shown live; do the real import after.
  Be a good neighbour: let the timing company know before leaning on their feed.
- `pnpm db:migrate` backfills fields added since a database was seeded
  (`races.liveFeed`, `meets.resultsUrl`, `schools.viewerLink` and the Mixed race category are the latest).

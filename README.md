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
- `pnpm db:indexes` — create indexes
- `pnpm db:seed` — create indexes and seed
- `pnpm db:migrate` — backfill fields added since the database was seeded
- `pnpm db:clear-taps "<meet>" --yes` — wipe a meet's taps and gun times (test data)
- `pnpm db:delete-meet "<meet>" --yes` — hard-delete a test meet and everything tied to it (races, taps, imports, entries, results, its join sessions, and its venue/course/series if no other meet uses them); dry run without `--yes`. Deleting a meet in the UI only hides it (soft delete) and keeps its log.
- Any of these runs against another database with `MONGODB_URI=… MONGODB_DB=… pnpm db:…`

## How access works (MVP, no accounts)

- A coach types `COACH_ACCESS_CODE` on `/join` to get a school-level coach
  session: create meets, set up races, see/regenerate join codes.
- Each meet has a **manager code** (tap, fix, gun) and a **coach code** (same
  plus export). Coaches see them on the meet page any time (stored encrypted)
  and can share `/join?code=…` links; Regenerate replaces them.
- The **viewer link** (`/v/<token>`) opens a read-only session.
- Sessions live in an httpOnly cookie for a year.

Polling follows the race state: 10 s before the start, 2.5 s while in progress
(15 s after 90 minutes, with a nudge to mark the race finished), 30 s once
finished, and paused while the page is hidden. The meet page refreshes at 5 s
while any race is in progress, otherwise 30 s.

Clock sync: devices sample `GET /api/time` five times and keep the shortest
round trip (`src/lib/client/clock.ts`). Every tap sends device time + offset;
the server stores both plus the corrected time. `POST /api/taps` is idempotent
on `clientTapId`.

## Official results

- **After a race:** meet page → Import results (timing company link, pasted
  text, or PDF). Official finishes and mat splits then replace app taps on
  every screen; Adjust → "Set the gun from official results" lines the app's
  splits up with the mats; the App vs official page shows the error.
- **During a race:** Adjust → "Live official results" links the race to the
  timing company's feed (paste their results page or a RACE RESULT contest
  link, pick the contest). While the race is in progress the taps poll carries
  official times from that feed; the server reads the feed at most every 15 s
  per race no matter how many phones are watching (`src/lib/results/live.ts`).
  Only exact and alias name matches are shown live; do the real import after.
  Be a good neighbour: let the timing company know before leaning on their feed.
- `pnpm db:migrate` backfills fields added since a database was seeded
  (`races.liveFeed` is the latest).

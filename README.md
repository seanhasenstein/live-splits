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

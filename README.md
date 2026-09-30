# Live Splits

Working name (set in `src/config/app.ts`). See `PLAN.md` for the full spec and
`SCHEMA.md` for the data model.

## Setup

```bash
pnpm install
cp .env.example .env.local   # then fill in MONGODB_URI
pnpm db:seed                 # indexes + school, program, season, distances, roster
pnpm dev
```

`pnpm db:seed` reads `data/roster.csv` (git-ignored; columns are listed in
`SCHEMA.md`).

## Scripts

- `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm typecheck`
- `pnpm db:indexes` — create indexes
- `pnpm db:seed` — create indexes and seed

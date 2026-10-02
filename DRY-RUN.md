# Dry run and meet-day checklist

## Deploy (once)

- Vercel env vars: `MONGODB_URI`, `MONGODB_DB`, `SESSION_SECRET`, `COACH_ACCESS_CODE`
  (same values as `.env.local`, or new ones; a new `SESSION_SECRET` invalidates
  existing join codes and sessions, so regenerate the meet's codes after).
- Build command is the default (`next build`). `pnpm db:indexes` once against
  Atlas if indexes were added (they were, in step 2; already applied).

## Before Friday

1. `pnpm db:clear-taps "Nightfall Classic" --yes` to wipe the test taps and
   gun times from this week's testing.
2. On the deployed site, join with the coach access code, open the meet,
   **Regenerate codes**, and write down the manager code, coach code and
   viewer link.
3. Check the lineups on each race (Edit) once the entry list is final.

## Dry run (two phones, fake race)

1. Both phones: open the site, **Add to Home Screen**, join with the manager
   code and a first name.
2. One phone sets the gun on the meet page (Start race… → START). The other should see
   the race clock start on its Record splits screen within a few seconds.
3. Phone A at "Mile 1": tap names as they pass; try CAPTURE twice then tap two
   names; try Undo; tap a name twice (second tap within 1s is ignored; later tap
   asks to replace).
4. Phone B on the live board: times appear within ~3s; tap a time → nudge,
   move, swap, mark missed.
5. Put phone A in airplane mode, record two taps (shows "offline · 2 unsent"),
   turn it back on, confirm they arrive on phone B.
6. Coach: meet page → **CSV** for the race; open it in Excel next to the split
   workbook.
7. Afterwards, `pnpm db:clear-taps` again.

## Meet day

- Managers: join before leaving the bus (needs signal once); the screen stays
  on while the Record splits screen is open.
- Whoever is at the start starts the race clock for each race; if missed,
  the gun can be typed from the clock time or set later from official results.
- After each race, the live board is the review screen; fix there, then export.

## After the meet (in order)

1. **Athlete race status (DNS / DNR / DNF):** a status on each lineup entry,
   set from the board's Fix sheet or the race edit page and logged as a tap
   event (`dnf` after a given checkpoint). Counters become "accounted for"
   with the DNF/DNS count beneath; the board moves them to the bottom with a
   label; the CSV writes DNF/DNS in the Finish column. Results get
   `status: dnf | dns | dnr`.
2. **Results / mat import** (plan step 6): paste or upload the official
   results, store the full field as race entries, match our athletes by
   name/alias, and the app-vs-mat comparison report.
3. Field-test fixes from tonight's notes.

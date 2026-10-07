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
4. Phone B on the live results: times appear within ~3s; tap a time → nudge,
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
- After each race, the live results is the review screen; fix there, then export.

## After the meet (in order)

1. ~~Athlete race status (DNS / DNR / DNF)~~ — done Oct 6: board → Fix times
   → tap a name → DNS / DNR / DNF (with the last checkpoint passed). Logged as
   a `status` tap; counters show "n out" and count them as accounted for; the
   board moves them to the bottom with a label; the record screen tiles show
   the label; the CSV writes DNS/DNR/DNF in the Place and Finish columns.
   Official results still take precedence once imported.
2. ~~Results / mat import~~ — done Oct 5: meet page → Import results (link,
   text or PDF), official times on every screen, Adjust → gun from official
   results, and the App vs official report.
3. ~~Record-screen round from the Nightfall notes~~ — done Oct 6:
   - Packs: one Capture time can take several names (tapped within 20 s, or
     after selecting its chip); capture chips live in the bottom bar.
   - Order the names: previous checkpoint (default after the first), last
     race, season best, one earlier race, coach's order (drag on the race
     edit page), A–Z. Remembered per phone and race.
   - Tiles: previous checkpoint + last meet's time here before they pass;
     cumulative, segment, pace change and "vs last meet / this course" after.
     "Everyone's through" banner offers the next checkpoint. Large tiles.
     Last three taps in the bottom bar. First-use intro card.
4. ~~Live official results~~ — done Oct 6: Adjust → Live official results
   (link the race to the timing company's feed; polled at most every 15 s
   while in progress). Tell Badger State Timing before using it at a meet.
5. Import the season's earlier meets (links or files from the other timing
   companies) so "last race" / "season best" ordering has data.
6. ~~Prod migrate~~ — done Oct 6. Still to do: deploy, import the Nightfall
   results on prod, and open the Nightfall meet → Edit → Save once so it
   gets its course record (courses were added Oct 6).

## Backlog (not yet scheduled)

- **Course maps from GPX** (idea, Oct 7): attach a watch's GPX (file, or pull
  from Strava) to a course; scale the track to the course's measured distance
  so markers land on the real mile marks; show route + checkpoint pins +
  elevation profile / gain per segment on a branded web page and a printable
  version for the post-meet packet. Elevation gain per course also explains
  "vs this course" vs "vs last meet" deltas. After the historical import.
- **Reading bib RFID at mile marks** (idea, Oct 7): possible for passive UHF
  bibs (RACE RESULT), not for active transponders. Handhelds miss packs; a
  reliable rig is a fixed reader + antennas (~$3–4k per checkpoint) and can
  interfere with the timing company's mats, so never near a mat without
  their OK. Value is low for our team's splits; the live feed covers mats
  that exist. Revisit only if we host a meet (then it's a timing system).
  Cheaper routes to "everyone past mile 1": bib OCR from phone video, or the
  place-counter mode from PLAN.md.

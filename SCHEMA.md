# Schema

The data model from PLAN.md §5, as built. The Zod schemas in `src/lib/db/schema/`
are the single source of truth: TypeScript types are inferred from them
(`z.infer`), and the same schemas validate documents before they are written.

| File | Collections |
| --- | --- |
| `schema/common.ts` | shared pieces: ids, sources, actors, times, distances, exclusions |
| `schema/org.ts` | schools, programs, seasons, athletes, seasonRosters |
| `schema/places.ts` | distances, venues, courses, meetSeries |
| `schema/meets.ts` | meets, races |
| `schema/results.ts` | results, raceEntries, imports |
| `schema/taps.ts` | taps |
| `schema/auth.ts` | users, sessions, pins |
| `collections.ts` | collection registry: name → schema + current `schemaVersion` |
| `indexes.ts` | index definitions (`pnpm db:indexes`) |

Commands: `pnpm db:indexes` creates indexes; `pnpm db:seed` creates indexes and
seeds school, XC program, 2026 season, distances and the roster from
`data/roster.csv`. Both read `MONGODB_URI` and `MONGODB_DB` from `.env.local`.

---

## Decisions that apply everywhere

**Native MongoDB driver + Zod, no Mongoose.** One definition per collection.
`collection(db, "athletes")` returns a typed driver collection.

**Ids are strings.** `_id` and every reference is a string: an ObjectId rendered
as hex (`newId()`), or a readable slug for distances (`xc-5000m`). Strings pass
through JSON, server → client component props, cookies and IndexedDB without
conversion, and the same Zod schema works at the API boundary and the database.
Hex ObjectIds still sort by creation time.

**`schoolId` on every document.** A school's own document has `schoolId === _id`.
One exception: **distances** are shared definitions, so `schoolId` is `null` for
the preloaded set (or the school that added a custom one).

**Two kinds of time, stored differently.**
- *Durations* (marks, splits, cutoffs) are integer milliseconds (`...Ms`), with
  `precision` and `timingMethod` on marks.
- *Timing instants* (gun, taps) are integer epoch milliseconds (`gunTimeMs`,
  `deviceTimeMs`, `serverTimeMs`). Elapsed = tap − gun is plain subtraction and
  is calculated on display, never stored.
- *Audit timestamps* (`createdAt`, `updatedAt`, `deletedAt`) are BSON dates.
- *Calendar dates* (meet date, season start/end) are local date strings
  (`"2026-10-02"`); meets also carry an IANA `timeZone`.

**Audit fields.** Tenant documents carry `source`, `createdAt`, `createdBy`,
`updatedAt`, `updatedBy`, `deletedAt`. `createdBy`/`updatedBy` are an actor
`{ type: "system" | "session" | "user", id, name }`; MVP actors are join-code
sessions, so `name` is the first name given when joining.

**Soft deletes.** `deletedAt` is `null` or a date. Queries filter on
`deletedAt: null`. Taps are the exception: they are never deleted at all.

**`schemaVersion`** on every document; the current version per collection lives
in `collections.ts`. Everything is version 1.

**No defaults in document schemas.** Stored documents are complete: optional
things are explicit `null` / `[]`, so a document's type is the same going in and
coming out.

**Program labels are data with stable ids.** Levels (`varsity`, `jv`), race
categories (`girls`, `boys`) and coach roles live in `programs.settings` as
`{ id, label, ... }`. Other documents store the `id`, so a label can be renamed
without touching results.

---

## Collections

### schools
Tenant: `name`, `shortName`, `mascot`, `state`, `settings.timeZone` (default
zone for new meets), `settings.teamAliases` (how timing companies spell the
team, e.g. "Sheboygan Area Lutheran"; used to find our rows in results).

### programs
School × sport (`xc` | `track_outdoor` | `track_indoor`); unique per school.
`settings`: `recordsStartGrade`, `defaultListLength`, `displayUnit`,
`classYearSystem`, `levels[]`, `raceCategories[]`, `coachRoles[]`,
`historyCompleteFromYear` (null until history is imported; lists use it to say
"history complete from YYYY").

`raceCategories[].gender` says which athletes to offer when building a lineup
for that category (`null` = everyone, for Open/Mixed).

### seasons
Program × `label`, with explicit `startDate`/`endDate` (indoor seasons span
calendar years). `badgeRules[]` holds letter/badge rules as data. One rule kind
is defined so far, `time_under_meet_cutoff` (per-meet, per-category cutoffs),
plus `manual`. **Provisional:** this shape gets firmed up when badges are built.

### athletes
One per person across sports and seasons; ours only. `displayName`,
`officialName`, `aliases[]` (timing-site spellings, used to match imports),
`gender` (`F` | `M` | `X`), `graduationYear` (nullable), `birthYear`,
`athleticNetId`.

Grade is **not stored** on the athlete; it is calculated from `graduationYear`
and the season (`gradeForSeason` in `src/lib/grade.ts`). Results keep a
`gradeSnapshot`.

### seasonRosters
Athlete × season with `defaultLevelId`. Unique on `(seasonId, athleteId)`.

### distances
Shared definitions: `{ _id: "xc-5000m", sport, value: 5, unit: "km", meters: 5000, label: "5K" }`.
`meters` is calculated from value + unit; `label` is display only. Unique on
`(sport, value, unit)`. **PRs/SBs group by `distanceId`, never by comparing
meters.** Preloaded for XC: 5K, 3 mi, 6K, 8K, 10K, 4K, 2 mi, 1.5 mi.

The same `{ value, unit, meters }` shape (`DistanceValue`) is used for
checkpoint distances and measured distances.

### venues, courses, meetSeries
- **venues:** physical location.
- **courses:** one layout at a venue, with `typicalMeasuredDistance`
  (`DistanceValue` + `method` + `note`), `activeFromYear`/`activeToYear`. A
  changed layout is a new course.
- **meetSeries:** the annual meet as an ongoing event. Meet Top N (by series)
  and course Top N (by course) are separate queries.

### meets
`programId`, `seasonId`, optional `meetSeriesId`/`venueId`/`courseId`, `name`,
local `date` + `timeZone`, `weather`, and `joinCodes`: for each of the manager
code, coach code and viewer token, a keyed hash (`...Hash`, HMAC with
`SESSION_SECRET`; a typed code is hashed and looked up) and the value encrypted
at rest (`...Enc`, AES-256-GCM with a key derived from `SESSION_SECRET`) so
coaches can see and re-share codes from the meet page. *Changed Oct 2, 2026 from
hash-only*, because codes shown once at creation had to be tracked outside the
app. Changing `SESSION_SECRET` makes existing codes unreadable and unmatchable:
regenerate them.

### races
An event within a meet.
- `raceCategoryId`, `levelIds[]` (e.g. `["varsity", "jv"]` when run together),
  `distanceId`, `measuredDistance` (perspective only; times are never adjusted).
- `gunTimeMs` + `gunTimeSource` (`tap` | `official_results` | `manual`): the gun
  time currently in effect. Every gun tap and edit is also in the tap log.
- `finishedAt` (added Oct 2, 2026): set when a coach marks the race finished.
  Display only: the clock stops ticking and the board becomes the review
  screen. Times are never affected.
- `officialImportId` (added Oct 5, 2026): the import that supplied official
  results. When set, official times take precedence over app taps on the
  board, tiles and CSV, and those cells can't be edited.
- `checkpoints[]`: `{ id, label, distance, kind: "split" | "finish" }`. Splits
  and taps reference `id`.
- `lineup[]`: `{ athleteId, levelId }` — which of our athletes run in this
  race. This is what the tap screen's name grid shows. It lives on the race
  rather than as placeholder results, so a result only exists once there is
  something to record.
- `exclusions`: `excludeFromPrSb`, `excludeFromCourseLists`,
  `excludeFromMeetLists`, and `exclusionReason` (required if any flag is set).
- `teamScoring[]`: team place/points/teams scored exactly as published, one
  entry per scored level.
- Track-ready: `eventKind` (`run` | `relay` | `field_distance` | `field_height`),
  `sections[]` for heats, `scheduledStart` (local `"HH:mm"`).

### results
One per athlete per race.
- `mark`: `{ type: "time", value (ms), precision, timingMethod }`, or
  `{ type: "distance" | "height", value, unit: "mm" | "quarter_inch" }`. Null
  until a finish is known. **Provisional** for field events.
- `status` (`finished` | `dnf` | `dnr` | `dq` | `dns`), `place`, `levelId`,
  `levelPlace`, `gradeSnapshot`.
- `distanceId` is copied from the race so PR/SB queries need no join (and legacy
  entries without a race still group correctly).
- `splits[]`: `{ checkpointId, cumulativeMs, source, edited, estimate }`. App
  and mat splits are both kept — one entry per checkpoint per source — so the
  comparison report is a query. App splits here are a projection of the tap
  log and can be rebuilt from it at any time.
- `exclusions`: same three flags, each `true` / `false` / `null`. `null` means
  "inherit from the race"; a non-null value overrides it and requires a reason.
- Legacy Top-30-board entries: `legacy: true` + `legacyInfo` (name, partial
  date, course or series). When the real result is imported, `supersededBy`
  points to it and the legacy entry is hidden from lists.
- `raceEntryId`, relay `legs[]`, field `attempts[]`, `windMps`.

### raceEntries
The full field as published by the timing company: `name`, `teamName`, `grade`,
`bib`, `place`, `timeMs`, `splits[]`, plus `athleteId` when matched to one of
ours and `importId` for the file it came from. Re-importing soft-deletes the
race's previous entries and inserts new ones; results are not touched (their
`raceEntryId` is re-linked).

### imports
Raw pasted/uploaded source stored as-is (`raw`), with `source`, `fileName`,
`contentType`, and the meet/race it belongs to.

**Import flow** (`src/lib/results/`): a vendor adapter (RACE RESULT JSON by
URL, Badger State Timing meet pages, pasted text, PDF) produces
`ParsedContest[]`; our rows are found by `teamAliases` and matched to athletes
by name/alias (confirmed spellings are added to `athletes.aliases`); the coach
maps contests to races; `commitImport` writes `imports`, replaces the race's
`raceEntries`, upserts our `results` (official mark/place/status + `mat` splits
per checkpoint, with the app's splits snapshotted beside them), and sets
`races.officialImportId`. Lineup athletes with no row become `status: dns`.

### taps
Append-only log; never updated or deleted. Types: `gun`, `capture`, `assign`,
`name_tap`, `edit`, `void`, `status`, `tick`.

| Field | Meaning |
| --- | --- |
| `clientTapId` | generated on the device; unique index makes retries idempotent |
| `raceId`, `checkpointId`, `athleteId` | what the tap is about (`checkpointId` null for gun) |
| `targetTapId` | the earlier tap (`clientTapId`) that an `assign`, `edit` or `void` acts on |
| `deviceTimeMs`, `clockOffsetMs`, `serverTimeMs` | device clock, offset in effect, corrected time (`device + offset`) |
| `timeMs` | the time this event asserts when it isn't the moment of tapping: nudged/typed times, manual adds, gun from official results. Null = use `serverTimeMs` |
| `estimate`, `missed`, `note` | flags for manual adds and "mark missed" |
| `status` | `status` taps only: `dns` / `dnr` / `dnf` for `athleteId`; for `dnf`, `checkpointId` is the last one passed (null = not sure). Voiding the current status tap puts them back in the race. Official results, once imported, take precedence |
| `createdAt`, `createdBy` | when the server stored it, and who tapped |

How the fix tools map to events (all new rows, nothing edited):

| Action | Event |
| --- | --- |
| Tap a name | `name_tap` |
| CAPTURE, then tap a name | `capture`, then `assign` → capture |
| Undo / delete a time or a pending slot | `void` → that tap |
| Move to another athlete | `edit` → tap, with new `athleteId` |
| Swap two athletes | two `edit`s |
| Nudge or type a time | `edit` → tap, with `timeMs` |
| Mark missed | `edit` with `athleteId`, `missed: true` |
| Add manually | `name_tap` with `timeMs`, `estimate: true` |
| Set gun from official results | `gun` with `timeMs` |

### users, sessions, pins
For future email PIN auth; the MVP only writes **sessions** of kind `join_code`
(`role`: manager | coach | viewer, scoped to a `meetId`, `name` = first name,
`tokenHash` of the cookie token). `pins` holds `pinHash`, `attempts`,
`resendCount`, `expiresAt`. These carry `schoolId` like everything else, so a
user belongs to one school for now.

---

## Records and badges

Nothing derived is stored: PR, SB, course/meet PR, Top N lists and badges are
calculated from results when queried. They will all share one eligibility
filter (built with the query layer, not in step 1):

- same `distanceId`
- `gradeSnapshot >= recordsStartGrade`
- race exclusion flags, overridden by the result's non-null flags
- `deletedAt: null` and `supersededBy: null`
- level is ignored

## Indexes

| Collection | Index |
| --- | --- |
| programs | unique `{schoolId, sport}` |
| seasons | unique `{programId, label}` |
| athletes | `{schoolId, aliases}` |
| seasonRosters | unique `{seasonId, athleteId}`; `{athleteId}` |
| distances | unique `{sport, value, unit}` |
| courses | `{venueId}` |
| meets | `{schoolId, seasonId, date}`; `{courseId}`; `{meetSeriesId}` |
| races | `{meetId}` |
| results | `{schoolId, athleteId, distanceId, mark.value}`; `{schoolId, raceId}` |
| raceEntries | `{raceId, place}` |
| taps | `{raceId, checkpointId, serverTimeMs}`; unique `{clientTapId}` |
| users | unique `{schoolId, email}` |
| sessions | unique `{tokenHash}` |
| pins | `{userId}` |

## Seed

`scripts/seed.ts` is idempotent: documents are matched on a natural key
(school name; program sport; season label; distance `_id`; athlete official
name; roster season + athlete) and replaced, keeping `_id` and `createdAt`.
It ends by reading every document back through its schema.

Roster CSV columns: `display_name, official_name, gender (M/F),
graduation_year, grade_2026, default_level, aliases, athletic_net_id`.
Multiple aliases are separated with `;`. `grade_2026` is not stored; the seed
uses it to check the graduation year and stops on a mismatch.
`data/roster.csv` is git-ignored because it lists students.

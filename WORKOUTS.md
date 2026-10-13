# Workouts

Practice sessions timed rep by rep: plan it, time it on phones, review it.
Built on the same ideas as races (an append-only event log replayed into
every screen), kept in their own collections so race code is untouched.

Status: built: plan (with templates), record (one phone per group; runner
order and large tiles; two-tap rest and start; countdown beep), the team grid
(rest row per group, who's timing each group), the athlete sheet (chart, own
rests, last time on the same reps, add or fix a time), ending a workout, and
manager access by the team's workout code (time only; planning stays with
coaches). Model and replay in `src/lib/db/schema/workouts.ts` and
`src/lib/workout-replay.ts` (tested); the phone queues events locally and
syncs through `/api/workout-events` and `/api/workouts/[id]/events`.

## Shape of a workout

- **Plan**: sets of reps. Each rep has a distance and the rest after it;
  each set has a rest after it. "12 × 400, 60 s rest" is one set of twelve.
  Ladders and mixed sets are just more reps.
- **Rest kinds**: fixed time ("60 s", counted from when the group's last
  runner came in, from the first runner in (leaders get the full rest), or
  from the middle runner in (once half are in)), on the clock ("every 3:00", counted from the rep's start),
  a jog distance (nothing timed), or open (until the coach starts the next).
- **Effort**: VO₂, threshold, tempo, race pace or custom. It proposes each
  athlete's goal pace from their 5K season best (else PR): VO₂ 4% faster than
  5K pace, race at it, threshold 7% and tempo 12% slower. The coach edits any
  of them; a rep's goal time is that pace over its distance.
- **Groups**: one by default. Split into groups and each has its own start,
  clocks and recorder, so one group's long rest never holds another up.
- **Approximate distances**: on grass, rep times are the truth and paces are
  shown as rough.
- **Visibility**: staff only for now; the field exists so opening a workout to
  athletes or the team later is a setting.

## What happened: the event log

`workoutEvents`, append-only, one document per tap:

| event      | means                                                            |
|------------|------------------------------------------------------------------|
| rep_start  | a group (or one athlete, for a staggered start) started a rep    |
| finish     | an athlete finished a rep                                        |
| skip       | an athlete (or a whole group) skips a rep                        |
| stop       | an athlete is done for the day from a rep on                     |
| rejoin     | back in from a rep on, after a stop                              |
| move       | runs in another group from a rep on; also how a late arrival joins |
| edit       | change an earlier event's time                                   |
| void       | undo an earlier event                                            |
| note       | text on a rep, for a group or an athlete                         |
| hold       | a group's rest has no countdown (water break, weather)           |
| group_end  | a group stops after a rep; its later reps aren't run             |

An athlete's own rep_start is a late start, or, on a rep they skipped, a
make-up run later on their own clock. Once a workout is ended the server takes
only fixes (typed times, edits, undos, notes). Reps can be added at the end or
the last dropped mid-workout (not once a group has started it); edits from the
plan form can't remove a rep, group or runner that has times, or regroup a
runner with times (a move from the record screen does that).

Replay gives each athlete's status and time on every rep (with goal and
+/−), and where each group is: before, running a rep, resting (with when the
next rep is due), or done. Plan changes mid-workout (add or drop a rep) edit
the plan; rep ids stay stable so the log still lines up.

## Screens

**Plan** (before): name, date, place, grass or track; sets and reps with a
quick form ("12 × 400m, 60 s rest") and a list to adjust; effort; groups and
who's in each; goals, proposed from 5Ks and editable per athlete; save as a
template.

**Record** (during, one phone per group): a big rep clock while running and
a rest clock after, counting down to the next start when rest is fixed or on
the clock; the group's athletes as tiles, tap as each finishes, with the time
and +/− vs goal on the tile; "Set 2 · Rep 3 of 4 · next 400m, goal 78 s"
across the top; start rep, skip, stop, add a late arrival, move to another
group, note, undo.

**Team** (during and after): athletes × reps, each cell coloured against
goal; average pace, average vs goal, spread (even-ness) and fade (second
half vs first); filters by group, gender and level.

**Athlete sheet**: reps against the goal line, the table, and History: the
last time they ran this workout.

## Later

A detailed CSV (one row per runner per rep: time, +/- vs goal, own rest, typed
or tapped) for pivot tables across a season; the sheet-shaped CSV is built.

Rests: rest equal to the rep (1:1, 2:1: each group's rest scales with how long
the rep took); a different rest after each rep of a ladder (400-800-1200 with
1, 2, 3 min) without making each step its own set.

Goals as a % of 5K pace per group; "last time you ran this" for the whole
team; time-based reps and fartleks (record distance, not
time); laps within a rep; several recorders per group; athletes and parents seeing their own workouts.

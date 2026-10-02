# Design system

Live page: `/design` (not linked from the app). Tokens: `src/app/globals.css`.
Components: `src/components/ui/`. Screens use these and never raw hex or
one-off button styles.

## Direction

Modern product UI in the family of the references in `examples/` (Clerk,
Medusa, Catalyst, shadcn): white or near-white surfaces, 1px hairlines, soft
8–12px radii, Inter at 13–15px, muted secondary text, color used sparingly.
The school's green is the one accent; gold is reserved for things that need a
hand (pending captures, the GUN button, flashes). The shield lives in the
header. The PDFs' "big number, small label" stat treatment (`Stat`) carries
over so the app and the post-meet documents feel related.

Light by default; dark follows the system (`prefers-color-scheme`). Each
device can override it (System / Light / Dark in the session menu), stored in
`localStorage` and applied before first paint by `ThemeScript`. Every token
has both values, so no screen knows which theme it is in.

## Tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `bg` | #F7F7F5 | #121311 | page |
| `surface` | #FFFFFF | #1B1C19 | cards, sheets, inputs |
| `surface-2` | #F1F1EE | #24251F | hover, selected, secondary fills |
| `surface-3` | #FFFFFF | #363730 | raised on surface-2: selected segment |
| `line` | #E4E4E0 | #2B2C27 | hairlines |
| `line-strong` | #CFCFC9 | #3B3C36 | input borders |
| `ink` / `ink-2` / `ink-3` | #161715 / #5D5E59 / #8F908A | #F1F1EC / #A6A79F / #6F7069 | text, secondary, placeholder |
| `brand` | #184A23 | #2F7A3F | primary buttons, active, race clock |
| `brand-soft` / `brand-text` | #E7EFE6 / #1D5A2B | #1B2E1F / #7FC48C | tints, green text |
| `gold` / `gold-soft` / `gold-text` | #FECD03 / #FFF4C4 / #7A5D00 | #FECD03 / #3A3110 / #F2CF4A | attention |
| `gold-ink` | #184A23 | #184A23 | text on gold, like the shield |
| `danger` / `danger-soft` | #C0392B / #FDECEA | #E5584A / #3A1C19 | destructive, errors |

Type: Inter (`next/font`). Base 15px. Scale: 11 (tracked labels), 13 (secondary),
14 (controls), 15 (body), 20 (page title), 24 (stat), 36+ (race clock).
Tabular numerals (`.tnum`, `<Time>`) on anything that is a time.

Radii: 8px controls and buttons, 12px cards and sheets. Shadows: `shadow-card`
(barely there) and `shadow-sheet` (floating).

## Components

- `AppHeader` (shield + app name, or back link; optional title; right slot for `SessionMenu`), `Page`, `PageTitle`
- `Button` / `LinkButton` / `AnchorButton`: primary, secondary, ghost, danger, gold; sm / md / lg
- `Field`, `Input`, `Select`, `Checkbox`
- `Card`, `CardHeader`, `CardBody`, `ListRow`, `SectionLabel`, `Stat`, `Badge`, `Alert`, `EmptyState`, `Time`
- `Segmented` (pill tabs), `Sheet` (bottom sheet / dialog), `Toast` (visual only)

Tracked uppercase labels appear only where they encode structure: table headers,
stat labels, section labels. Not on buttons.

## Writing

Sentence case. Buttons say what happens ("Create meet", "Regenerate codes").
Errors say what went wrong and what to do. Empty states invite the next action.

## Details settled with Sean (Oct 2, 2026)

- Primary buttons stay green.
- Input focus: border darkens plus a faint halo; no outline ring.
- Checkbox: 18px, 4px radius, brand fill with a small check.
- Text on gold is shield green in both themes.
- Theme control is available to everyone in the session menu.

## Round 2 (Oct 2, 2026)

- Wording: "Record splits" (route `/record`), "Start race…" → START, "Race clock", "Fix times".
- Race clock card: not started → one action; running → big elapsed, small gun
  time + who started it, green tint; finished → frozen. Every change to a
  running clock lives in the Adjust sheet, with what it does spelled out, and
  removing the gun time takes two taps. Race status: `races.finishedAt`.
- Clock sync is silent unless it's wrong ("Clock not synced", "Slow connection").
- Gold is only for small attention badges. Capture is the ink button; the
  confirmation flash is solid green; pending captures are green-tinted.
- Recorded tiles carry a pencil glyph; the replace prompt is green-bordered.
- Board: cumulative by default with a Cumulative | Splits toggle (no "+"),
  per-checkpoint counters in the stat style, race clock beside the tabs,
  and fixes only in an explicit Fix times mode.
- Record and board screens have the full header (shield, meet name linking
  back, session menu).

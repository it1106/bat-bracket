# Roster Chip Result Colors — Design

**Date:** 2026-07-09
**Status:** Approved (design)

## Problem

In the stats tab, the Country section (BWF) and Club/Team section (BAT) open a
roster modal listing each player and the event(s) they're entered in. Each event
is rendered as a neutral chip. Users can't tell from these chips how a player is
doing in the tournament. This feature colors each chip by that player's result in
that event, updated **live** as rounds resolve.

## Scope

- Applies to the two roster modals only: `ClubRosterModal` (BAT) and
  `CountryRosterModal` (BWF). Both already share `components/RosterModal.tsx`, so
  this is one rendering change plus one data change.
- Out of scope: the "multi-gold players" section (also lists events) and any
  other events listing. Can be revisited later.

## Status Model

Five states, per player, per event chip:

| State    | Meaning                     | Visual                                   |
|----------|-----------------------------|------------------------------------------|
| `gold`   | Won the final               | gold left-border + subtle tint           |
| `silver` | Lost the final (runner-up)  | silver left-border + subtle tint         |
| `bronze` | Lost the semifinal          | bronze left-border + subtle tint         |
| `out`    | Eliminated, no medal        | faded grey, ~45% opacity                 |
| `in`     | Still alive / event ongoing | current neutral chip (unchanged)         |

`ChipStatus = 'gold' | 'silver' | 'bronze' | 'out' | 'in'`

### Precedence when collapsing draws

A single chip shows the collapsed event key (e.g. `MS`), which can span multiple
raw draws (`MS - Group A`, `MS - Group B`, `MS` playoff). When a player's status
differs across those draws, merge with this precedence:

```
gold > silver > bronze > in > out
```

A medal always wins. `out` is shown only when *every* draw under that event key
is eliminated and none is still alive. If the player is still alive in any draw
under the key, the chip is `in`.

## Timing / Elimination Rules

Colors update **live, mid-tournament** (user choice). Elimination detection is
"knockout-only, simple" (user choice):

- **Knockout draw:** a player is `out` the moment they lose any match that isn't a
  semi/final (in single-elimination, one loss = eliminated).
- **Group-stage draw:** *not* dimmed during the group phase. Marked `out` only
  once the group stage is fully decided **and** the player does not appear in the
  corresponding playoff draw's entries. This deliberately avoids fragile
  round-robin standings math; dimming for group players is slightly delayed until
  the group stage resolves.
- **`in`:** none of the above — still alive, or their next match hasn't been
  played yet.

## Data Derivation (server-side, `lib/tournamentStats.ts`)

Reuse the existing final/semi detection that already powers club medals
(`lastFinalByDraw`, `semiLosersByDraw` in `buildClubMedalsAndMultiGold`).

Per player, per **raw draw**:

- `gold` — in `lastFinalByDraw`, winning side
- `silver` — in `lastFinalByDraw`, losing side
- `bronze` — lost a semifinal
- `out` — knockout: lost a non-semi/final match. Group-stage: group stage fully
  decided and player absent from the playoff draw entries.
- `in` — otherwise

### Join-key normalization (critical)

Medals/matches key on the raw `match.draw` (e.g. `"MS - Group A"` or the playoff
draw name), but chips render the **collapsed** `eventName` (e.g. `"MS"`), via the
same `eventName ?? draw` collapse used in `collectPlayerEvents`,
`buildCountryRosters`, and `buildClubRosters`.

The derivation therefore:

1. Builds a `draw → ChipStatus` map per player.
2. Folds it into an `eventKey → ChipStatus` map using the same `eventName ?? draw`
   collapse, applying the precedence above when multiple draws share a key.

This guarantees the status key string is identical to the chip's event string, so
grouped events color correctly instead of silently failing to join.

## Data Model (additive — backward compatible)

- `lib/types.ts`: add optional `statusByEvent?: Record<string, ChipStatus>` to
  `StatsClubMember` and `StatsCountryMember`, keyed by the same event strings used
  in `events: string[]`. Export `ChipStatus`.
- `components/RosterModal.tsx`: add optional `statusByEvent?: Record<string,
  ChipStatus>` to `RosterRow`.
- `ClubRosterModal` and `CountryRosterModal` pass the field straight through from
  each roster member to its `RosterRow`.

Stats blobs cached before this change lack `statusByEvent`. The chip lookup falls
back to `'in'`, rendering identically to today's neutral chips. No cache
invalidation required; colors appear as blobs regenerate.

## Rendering (`components/RosterModal.tsx`)

- Each chip: `const status = row.statusByEvent?.[e] ?? 'in'`, apply class
  `country-roster-chip country-roster-chip--{status}`.
- New CSS for `--gold`, `--silver`, `--bronze` (colored left-border + subtle
  tint, readable in light and dark mode) and `--out` (faded grey). `in` keeps the
  existing `.country-roster-chip` appearance (no `--in` class needed, or a no-op
  one).
- **Legend:** a small one-line key at the top of the modal body, e.g.
  `🟡 Champion · ⚪ Runner-up · 🟤 Semifinal · faded = Out`, so colors are
  self-explanatory. Localized via the existing `useLanguage()` / `t()` mechanism.

## Testing

Unit tests in `__tests__` for the new status-derivation function:

- Gold / silver / bronze assignment from final and semi results.
- Knockout loss (non-semi/final) → `out`.
- Group-stage player still within the group phase → `in` (not dimmed).
- Group-stage player, group stage decided, not in playoff → `out`.
- Collapse precedence: medal in playoff draw + loss in a group draw → medal wins
  for the collapsed chip.
- Backward compat: a member without `statusByEvent` renders all chips as neutral
  (`in`).

## Files Touched

- `lib/types.ts` — `ChipStatus`, `statusByEvent` on the two member types.
- `lib/tournamentStats.ts` — new status-derivation function; wire into
  `buildClubRosters` / `buildCountryRosters` output.
- `components/RosterModal.tsx` — `RosterRow.statusByEvent`, chip class + legend.
- `components/ClubRosterModal.tsx`, `components/CountryRosterModal.tsx` — pass
  `statusByEvent` through.
- CSS (roster chip styles) — four new state classes.
- `__tests__/` — status-derivation unit tests.

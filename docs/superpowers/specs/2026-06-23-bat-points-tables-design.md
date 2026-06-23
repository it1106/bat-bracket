# BAT Ranking Points Tables — Design

Date: 2026-06-23
Status: Approved (approach), pending spec review

## Summary

BAT tournaments award accumulated ranking points that depend on three inputs:
the tournament **level** (1–6), the event's **age group** (Open, U19, U17, U15,
U13, U11, U9), and the **round/placement** the player reached (Winner → R33/64).
The app already scrapes each player's *official* points after BAT publishes a
weekly ranking, but those values are absent for in-progress and not-yet-scored
tournaments.

This work adds two BAT-only features built on one shared points engine:

1. **Reference viewer** — a new "Points" tab in the Leaderboards page that
   displays all six level tables for lookup.
2. **Player projection** — in the player profile's Tournament-History section,
   show the **locked-in** points a player has secured per event (the points for
   the deepest round they have reached), computed from level + age group +
   `bestFinish`.

Both are **BAT-only**. BWF tournaments and BWF player profiles never show these
points.

## Verified data model

The published 2563 (2020) tables are reproduced **exactly** by a closed-form
formula (verified against all 294 cells, 0 mismatches):

```
points(level, age, round) = round( 40000 × 0.8^(level-1) × ageFactor(age) × 0.8^round )
```

- `level`: 1–6.
- `round` index: 0 = Winner, 1 = Runner-Up, 2 = SF (3/4), 3 = QF (5/8),
  4 = R9/16, 5 = R17/32, 6 = R33/64.
- `ageFactor`: Open = 1; U19 = 0.625; each step down ×0.64 →
  U17 = 0.4, U15 = 0.256, U13 = 0.16384, U11 = 0.1048576, U9 = 0.067108864.

Because the formula is exact, the engine **generates** the tables rather than
hardcoding 294 numbers. A unit test pins the full generated grid against the
transcribed published values so any future formula change is caught.

## Architecture

One pure core module plus two thin consumers.

### Core engine — `lib/points/bat-points.ts` (pure, no I/O)

Exports:

- Types: `AgeGroup = 'Open'|'U19'|'U17'|'U15'|'U13'|'U11'|'U9'`,
  `PointsRound` (the 7 rounds above).
- `pointsFor(level: number, age: AgeGroup, round: PointsRound): number` — the
  formula.
- `ageGroupFromEvent(eventName: string): AgeGroup | null` — parses the age
  group from an event name (e.g. `"BS U15"` → `U15`, `"MS"`/`"XD"` → `Open`).
  Returns `null` for U-ages outside the table (e.g. `U7`, `U23`).
- `roundFromBestFinish(bestFinish: string): PointsRound | null` — maps
  `Champion|F|SF|QF|R16|R32|R64` to a row; returns `null` for `R128`/`RR`
  (outside the published table).
- `levelTable(level: number): Record<AgeGroup, number[]>` — the full grid for
  one level, for the viewer.
- `ROUND_LABELS` / `AGE_GROUPS` constants for rendering.

This module has no dependency on the meta sidecar, React, or fetch — it is
unit-testable in isolation.

### Feature 3 — Reference viewer (Leaderboards "Points" tab)

- `components/PointsTableReference.tsx` (client) renders the six level tables
  using `levelTable()` and the shared constants. Static content; no data fetch.
- `components/LeaderboardsView.tsx` gains a `'points'` tab. Because existing
  tabs are data-driven from `lb.boards`, the `'points'` tab is a **static** tab
  appended to the tab strip and special-cased in the body: when active, render
  `<PointsTableReference />` instead of the boards grid. The tab is **only
  shown for the BAT provider** (hidden when the BWF provider tab is active).
- i18n: add the tab label key (EN/TH) to `lib/i18n.ts`.

### Feature 2 — Player projection (Tournament History)

Data flow:

1. **SSR** (`app/player/[provider]/[slug]/page.tsx`): when `provider === 'bat'`,
   read the meta sidecar (`readMeta`) for every `tournamentId` in
   `record.tournaments`, building `tournamentLevels: Record<string, number>`
   (only entries with a known positive `level`). Pass it as a new prop to
   `PlayerProfileView`. For BWF, pass nothing.
2. **`PlayerProfileView`**: accepts optional `tournamentLevels`. In the
   Tournament-History section, for each event compute
   `pts = pointsFor(level, ageGroupFromEvent(eventName), roundFromBestFinish(bestFinish))`
   and render it next to the result. Render nothing when level/age/round is
   unavailable.

Computed points are visually distinguished from official scraped points (which
live in the separate ranking-detail section) — e.g. prefixed with `≈` or a
small "proj." marker and a tooltip ("projected from tournament level").

### Why locked-in needs no extra logic

`bestFinish` is the deepest round the player has reached. If they have won
through to the SF but the SF has not been played, `bestFinish` is already `SF`
and the SF row is their guaranteed (locked-in) placement. So
`roundFromBestFinish(bestFinish)` yields the locked-in row directly, and the
value updates naturally as the player advances and the index is rebuilt.

## Edge cases

| Case | Behavior |
|------|----------|
| BWF tournament / BWF profile | No points anywhere (feature is BAT-only). |
| Tournament level unknown (not yet fetched, or regulations omit it) | No points for that tournament. |
| Age group outside {U9…U19, Open} (e.g. U23, U7) | No points for that event. |
| `bestFinish` = `R128` or `RR` | No points (outside the published table). |
| Walkover/retirement affecting placement | Uses `bestFinish` as-is; no special points adjustment (matches "deepest round reached"). |

## Testing

- **Unit (`lib/points/bat-points.ts`)**: assert the full generated grid equals
  the transcribed published grid for all 6 levels × 7 age groups × 7 rounds
  (294 cells). Assert `ageGroupFromEvent` and `roundFromBestFinish` mappings,
  including the `null` cases (U23, R128, RR).
- **Component**: light render checks that the viewer shows six tables and that
  the projection renders a value for a known (level, event, finish) and nothing
  for unknown inputs.

## Out of scope (YAGNI)

- No "potential max if they win out" projection (locked-in only, per decision).
- No backfilling official/ranking displays with computed points.
- No persistence of computed points (derived at render time).
- No editing/overriding levels or points in the UI.

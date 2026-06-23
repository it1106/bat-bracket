# BAT Ranking Points Tables — Design

Date: 2026-06-23
Status: Approved (approach), pending spec review

## Summary

BAT tournaments award accumulated ranking points that depend on the tournament
**level** (1–6), the event's **age group** (Open, U19, U17, U15, U13, U11, U9),
and the **placement** the player earned. The app already scrapes each player's
*official* points after BAT publishes a weekly ranking, but those values are
absent for in-progress and not-yet-scored tournaments.

This work adds two BAT-only features built on one shared points engine:

1. **Reference viewer** — a new "Points" tab in the Leaderboards page that
   displays all six level tables for lookup.
2. **Player projection** — in the player profile's Tournament-History section,
   show the **locked-in** points a player has secured per event.

Both are **BAT-only**. BWF tournaments and BWF player profiles never show these
points.

## Verified points formula

The published 2563 (2020) tables are reproduced **exactly** by a closed-form
formula (verified against all 294 cells, 0 mismatches):

```
points(level, age, round) = round( 40000 × 0.8^(level-1) × ageFactor(age) × 0.8^round )
```

- `level`: 1–6.
- `round` index: 0 = Winner, 1 = Runner-Up, 2 = SF (3/4), 3 = QF (5/8),
  4 = R9/16, 5 = R17/32, 6 = R33/64. The same formula extends below 64 for the
  larger brackets that occasionally occur: 7 = R65/128, 8 = R129/256.
- `ageFactor`: Open = 1; U19 = 0.625; each step down ×0.64 →
  U17 = 0.4, U15 = 0.256, U13 = 0.16384, U11 = 0.1048576, U9 = 0.067108864.

Because the formula is exact, the engine **generates** the tables rather than
hardcoding 294 numbers. A unit test pins the full generated grid against the
transcribed published values (the 7 official rows); the R128/R256 extension
rows are asserted separately.

## Placement rule (which row a player earns)

A player's points row is **not** simply the deepest round they reached, because
a **bye is not a win** and must not earn placement credit. The rule, confirmed
with worked examples:

1. **Champion** (won the final) → **Winner** row.
2. **Won ≥ 1 match** → the player's **actual exit round** (`bestFinish`):
   `F`→Runner-Up, `SF`→SF, `QF`→Round 5/8, `R16`→Round 9/16, `R32`→Round 17/32,
   `R64`→Round 33/64. A bye earlier in the run does **not** demote a player who
   went on to win at least one match.
3. **Won 0 matches** (eliminated in their first played match) → credited as a
   **first-round loss** → the row for the draw's **opening round**, derived from
   `drawSize`: 256→Round 129/256, 128→Round 65/128, 64→Round 33/64,
   32→Round 17/32, 16→Round 9/16, 8→Round 5/8, 4→SF, 2→Runner-Up.

Definitions:
- **`wins`** counts won matches only. A **walkover-received** (`WO-W`) and a
  **retirement-received** (`RET-W`) **count as wins**. A **bye** is never a match
  and never counts. (The existing index already computes `wins` this way.)
- **First-round walkover-loss earns nothing.** If a player won 0 matches and
  their eliminating loss was a **walkover** (no-show, `WO-L`), they receive **no
  points** — `lostByWalkover` short-circuits the 0-win branch to null. A
  **retirement** (`RET-L`, started but couldn't finish) or a normal played loss
  still earns the first-round-loss row. A walkover-loss **after** at least one
  real win keeps the exit-round points (the 0-win branch isn't reached).
- **`drawSize`** is the bracket's opening-round size = the largest round present
  in the event (R256→256, R128→128, R64→64, …, Final→2). Needed **only** for the
  0-win branch; that is the branch the bye rule corrects.

Worked examples (all confirmed):
- GD U13 Lv4, bye into R32→R16 then lost, 0 wins, drawSize 32 → Round 17/32 →
  **1,100**.
- BS U15 Lv1, bye into R16 then lost, 0 wins, drawSize 32 → Round 17/32 →
  **3,355**.
- BS U15 Lv1, bye round 1 then won R16/QF/SF, lost final (3 wins) → Runner-Up →
  **8,192** (not demoted to SF).
- BS U15 Lv1, eliminated in the round of 128, 0 wins, drawSize 128 →
  Round 65/128 → **2,147**.
- BS U15 Lv1, first-round no-show (`WO-L`, 0 wins) → **0 points**.
- BS U15 Lv1, won R32 then withdrew in R16 (`WO-L`, 1 win) → Round 9/16 →
  **4,194** (exit-round points kept).
- Normal R16 loser (won their R32 match) → Round 9/16.

**Doubles/mixed:** both partners share the same `wins`, `drawSize`, and
`bestFinish`, so each receives the **same full points** automatically — never
split, no special handling.

## Per-discipline crediting (only one entry per discipline counts)

Within a single tournament, a player may enter multiple age groups in the same
discipline (e.g. BS U13 **and** BS U15). Only **one** entry per discipline
counts toward ranking: **the highest-points one** (usually, but not always, the
older age group). The other same-discipline entries are **superseded** — still
shown, but flagged as not counting.

Disciplines are independent: a player who plays BS, BD, and XD earns a counting
result in each. Grouping uses the existing `PlayerEventResult.discipline`
(`singles` | `doubles` | `mixed`), which for a given player maps 1:1 to BS/GS,
BD/GD, and XD respectively.

Example: a player who plays BS U15, BS U13, and BD U13 in one tournament gets
the higher-points BS result (U15 or U13) **plus** the BD result — two counting
results. Ties (equal points) break toward the older age group.

This applies to the projection (Feature 2): per tournament, compute each event's
points, then within each discipline mark the max-points event as **counting**
and render the rest struck-through with a "superseded" tooltip.

## Architecture

One pure core module, one index-build change to capture `drawSize`, and two
thin consumers.

### Core engine — `lib/points/bat-points.ts` (pure, no I/O)

Exports:

- Types: `AgeGroup = 'Open'|'U19'|'U17'|'U15'|'U13'|'U11'|'U9'`,
  `PointsRound` (Winner, RunnerUp, SF, QF, R16, R32, R64, R128, R256).
  `PUBLISHED_ROUNDS` = the first 7 (officially published) rows.
- `pointsFor(level, age, round): number` — the formula.
- `ageGroupFromEvent(eventName): AgeGroup | null` — `"BS U15"`→`U15`,
  `"MS"`/`"XD"`→`Open`, U-ages outside the table (U7, U23)→`null`.
- `pointsRoundFromResult(bestFinish: string, wins: number, drawSize: number | undefined, lostByWalkover = false): PointsRound | null`
  — implements the placement rule above. Returns `null` when the row can't be
  determined (group-only/`RR`, draws larger than 256, missing `drawSize` on a
  0-win result, or a first-round walkover-loss).
- `levelTable(level): Record<AgeGroup, number[]>` — the full grid for the viewer.
- `AGE_GROUPS`, `POINTS_ROUNDS`, `ROUND_LABELS` constants for rendering.

No dependency on the meta sidecar, React, or fetch — unit-testable in isolation.

### Index change — `drawSize` per event

`PlayerEventResult` gains `drawSize?: number`. In `lib/playerIndex.ts`, a
pre-pass over **all** players' match refs computes, per `${tournamentId}:${eventName}`,
the largest round size present (the full bracket is visible at index-build time;
a single player's record can't reveal byes). Each event result is annotated with
that `drawSize`. Optional field so previously-cached indexes still load (0-win
results simply show no points until the index is rebuilt; `wins ≥ 1` results are
unaffected).

### Feature 3 — Reference viewer (Leaderboards "Points" tab)

- `components/PointsTableReference.tsx` (client) renders the six level tables via
  `levelTable()`, including the R65/128 and R129/256 extension rows. Static; no
  fetch.
- `components/LeaderboardsView.tsx` gains a static `'points'` tab, shown **only
  for the BAT provider**; when active, the body renders `<PointsTableReference />`
  instead of the boards grid.
- i18n: add the tab label key (EN/TH).

### Feature 2 — Player projection (Tournament History)

1. **SSR** (`app/player/[provider]/[slug]/page.tsx`): when `provider === 'bat'`,
   read the meta sidecar for every `tournamentId` in `record.tournaments`,
   building `tournamentLevels: Record<string, number>` (positive levels only).
   Pass it to `PlayerProfileView`. For BWF, pass nothing.
2. **`PlayerProfileView`**: for each tournament, first compute every event's
   points (`round = pointsRoundFromResult(e.bestFinish, e.wins, e.drawSize)`;
   `pts = pointsFor(level, age, round)` when level + age + round are all known).
   Then, per discipline, mark the **max-points** event as counting. Render each
   event's points next to its result, marked distinct from official scraped
   points (e.g. `≈` + a "projected" tooltip); superseded same-discipline entries
   render struck-through with a "superseded — higher {discipline} result counts"
   tooltip.

## Edge cases

| Case | Behavior |
|------|----------|
| BWF tournament / BWF profile | No points anywhere (BAT-only). |
| Tournament level unknown | No points for that tournament. |
| Age group outside {U9…U19, Open} (U23, U7) | No points for that event. |
| 0 wins but `drawSize` missing (pre-rebuild index) | No points (graceful). |
| Group-only result (`RR`) / draw larger than 256 | No points. |
| 128- or 256-pax draw | Same formula, extended rows (R65/128, R129/256). |
| Walkover-received | Counts as a win (keeps actual placement). |
| First-round walkover-loss (no-show, 0 wins) | No points (`lostByWalkover`). |
| First-round retirement-loss (started, 0 wins) | First-round-loss points (competed). |
| Bye then loss (0 wins) | First-round-loss points (drawSize's opening round). |
| Doubles/mixed | Both partners get the same full points (shared inputs). |
| Multiple age groups, same discipline | Only the highest-points entry counts; others shown struck-through (superseded). Ties break to the older age group. |

## Testing

- **Unit (`lib/points/bat-points.ts`)**: full 294-cell grid; `ageGroupFromEvent`
  including `null` cases; `pointsRoundFromResult` across champion / ≥1-win exit /
  0-win-with-drawSize (the bye cases — incl. GD U13 Lv4 → Round 17/32 and the
  3-win finalist → Runner-Up) / 0-win 128/256 draws → R128/R256 /
  missing-drawSize / draws larger than 256.
- **Unit (`lib/playerIndex.ts`)**: an event whose bracket has an R32 round
  yields `drawSize: 32` on each player's event result, including a player whose
  own deepest match is R16 (byed the first round).
- **Component**: viewer renders six tables; projection renders a value for a
  known input and nothing for unknown ones.

## Out of scope (YAGNI)

- No "potential max if they win out" projection (locked-in only).
- No backfilling official ranking displays with computed points.
- No persistence of computed points (derived at render time).
- No editing/overriding levels or points in the UI.

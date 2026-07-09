# Country head-to-head matrix (stats panel)

## Goal

On BWF international tournaments (e.g. YONEX-SUNRISE India Open), where every
player carries an ISO country code instead of a club, add a country-vs-country
head-to-head matrix to the tournament stats page: top row and left column both
list the participating countries, and each intersection cell shows the row
country's win–loss record and win% against the column country.

## Placement & gating

New section titled **Country head-to-head** in
`components/TournamentStatsPanel.tsx`, rendered immediately after the existing
*Country rosters* section. Gated by the same BWF condition already used for
country rosters — `clubRosters` is empty — **plus** a guard that the computed
matrix contains at least 2 countries. Club-based (Thai domestic) tournaments
never show it.

## Data model

New optional field on `ComputedStats` (`lib/types.ts`), optional like
`schedulePreview` so stats blobs cached before this field existed still parse:

```ts
export interface StatsCountryMatrixCell { w: number; l: number }

export interface StatsCountryMatrix {
  countries: string[]  // axis order (both rows and columns)
  // cells[row][col] = the ROW country's record vs the COL country.
  // Mirror: cells[A][B] = { w, l }  ⇔  cells[B][A] = { w: l, l: w }.
  cells: Record<string, Record<string, StatsCountryMatrixCell>>
}

// on ComputedStats:
countryMatrix?: StatsCountryMatrix
```

## Computation — `buildCountryMatrix(ctxs)` in `lib/tournamentStats.ts`

Walk the decided-match contexts (`ctxs`). For each match:

1. Skip if `match.winner === null` or `match.walkover` (retired matches have a
   winner and ARE counted — matches `buildTopPlayers`).
2. Resolve each side's country: collect the `country` code of every player on
   the side. The side has a country only if all players share one identical
   non-empty code. If either side is mixed-nationality or missing a code, **skip
   the match**.
3. If both sides resolve to the same country (diagonal), **skip**.
4. Otherwise credit the win to the winner's country vs the loser's country:
   `cells[winnerCty][loserCty].w++` and `cells[loserCty][winnerCty].l++`.

Axis order: countries that appear in at least one qualifying match, sorted by
total head-to-head matches (w+l across the row) descending, then country code
ascending. Return `undefined` when fewer than 2 countries qualify (nothing
meaningful to show).

Wire into `aggregate()` alongside the other builders; assign to
`base.countryMatrix` only when defined (keep it optional in the blob).

## Render

Scrollable grid `<table>` inside a `stats-section`:

- Header row: empty corner cell, then one `<th>` per country (short code;
  `countryDisplayName(code)` as the `title` tooltip).
- Body: one row per country. First cell is the row country's code (left header).
  Each data cell shows `W–L` with the win% beneath (e.g. `3–1` / `75%`).
- Empty pairings (no matches) render blank; the diagonal is shaded and blank.
- Cells are tinted green (win% > 50) / red (win% < 50) / neutral (50%) for
  scan-ability. Win% = `w / (w + l)`, rounded to a whole number.

Sticky header row and sticky first column via CSS so labels stay visible while
scrolling a wide grid.

New i18n keys in `lib/i18n.ts` (type union + `en` + `th`):
`statsSectionCountryMatrix` (section title). Cell text is numeric/locale-neutral.

New CSS in `app/globals.css` near the existing `.stats-table` rules:
`.stats-matrix` (scroll wrapper), sticky header/first-col, `.stats-matrix-cell`
win/loss tint classes, shaded diagonal.

## Testing

Add cases to `__tests__/tournamentStats.test.ts`:

- Mixed-nationality side is skipped (no cell credited).
- Same-country (diagonal) match is skipped.
- Mirror correctness: `cells[A][B]` = `{w,l}` ⇒ `cells[B][A]` = `{w:l, l:w}`.
- Walkover excluded; retired included.
- Axis ordering by total matches, then code.
- Fewer than 2 qualifying countries ⇒ `countryMatrix` undefined.

Prefer small hand-built `MatchesData`/day-group fixtures so the country codes
and outcomes are explicit, rather than relying on the large SPRC fixture (which
is club-based and has no country codes).

## Out of scope

- No per-cell drill-down / modal (the roster modal stays as-is).
- No change to club-based tournaments.
- Doubles with cross-country partners are intentionally excluded, not
  attributed per-player.

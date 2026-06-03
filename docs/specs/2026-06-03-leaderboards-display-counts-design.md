# Leaderboards — Display Counts on Win Rate and Court Time

**Date:** 2026-06-03
**Status:** Approved
**Surface:** Leaderboards page — `headline.winPct` and `headline.courtTime` boards

## Summary

Two display tweaks on the headline leaderboards, both inside `lib/playerIndex.ts`:

1. **Highest Win Rate** — append `(wins/matches)` to the percentage. Example: `85% (17/20)`.
2. **Most Court Time** — append `(matches)` to the time. Example: `12h 30m (25)`. The count is matches with a recorded duration, not the player's overall match total.

No view changes, no i18n changes, no CSS.

## Motivation

`85%` alone hides the sample size — a player with 17/20 should read differently than 170/200. `12h 30m` alone hides the workload's denominator — was that across 20 long matches or 60 short ones? Adding the underlying count behind the headline value gives users the context they need to read the board honestly.

For court time specifically, the count must be **matches with a recorded duration**, because court time only sums matches that have one. Showing the player's total match count (which would include durationless matches) implies an average that doesn't reconcile with the displayed total time.

## Changes

### 1. `headline.winPct` display

`lib/playerIndex.ts:105` — replace the `display: fmtPct` shorthand with an inline function that reads the underlying counts directly:

```ts
display: (_n, p) =>
  `${Math.round((p.totals.wins / p.totals.matches) * 100)}% (${p.totals.wins}/${p.totals.matches})`,
```

Reads `p.totals.wins` and `p.totals.matches` instead of the rate `n` so the percentage and the parens stay in sync (no risk of `n` rounding diverging from a separately-stringified `wins/matches`).

The `value`, `qualifier` (min 20 matches), `rankField` (`winPct`), and sort comparator are unchanged.

### 2. `headline.courtTime` display — needs a new field

`courtMinutes` sums only matches with a duration. To display "matches that contributed" accurately, expose the count alongside.

**Type change** — `lib/types.ts`, inside `PlayerRecord.matchCharacter`:

```ts
matchCharacter: {
  // …existing fields…
  matchesWithDuration?: number  // count of matches whose `durationMinutes` > 0
}
```

The field is **optional** so previously-built indexes still load — matches the pattern used for `opponentsByWindow` earlier today. The display function reads it with `?? 0` fallback. New builds always populate it.

**Build change** — `lib/playerIndex.ts`, in the aggregation loop where `withDuration` is already incremented (~line 488). After the loop, assign:

```ts
rec.matchCharacter.matchesWithDuration = withDuration
```

The `withDuration` variable already exists in that loop — used today to divide `totalMin / withDuration` for `avgMatchMinutes`. We just persist the same number.

**`emptyRecord` initializer** — `lib/playerIndex.ts:183-189`, where the empty `matchCharacter` is built, add `matchesWithDuration: 0`.

**Display change** — `lib/playerIndex.ts:108`:

```ts
{ id: 'headline.courtTime', titleKey: 'lbMostCourtTime', icon: '⏱', category: 'headline',
  qualifies: p => p.matchCharacter.courtMinutes > 0,
  value: p => p.matchCharacter.courtMinutes,
  display: (n, p) => `${fmtHours(n)} (${p.matchCharacter.matchesWithDuration ?? 0})`,
  rankField: 'courtTime' },
```

`fmtHours` keeps its same definition; we just compose its output with the new count in parens.

## Tests

### Unit — `__tests__/playerIndex.leaderboards.test.ts`

Add two new tests inside the existing describe block:

```ts
it('headline.winPct display includes (wins/matches) behind the percent', () => {
  const { index, leaderboards } = buildIndex('bat', [toyota, trang])
  const board = leaderboards.boards.find(b => b.id === 'headline.winPct')!
  for (const e of board.entries) {
    const p = index.players[e.slug]
    expect(e.display).toMatch(/^\d+% \(\d+\/\d+\)$/)
    expect(e.display).toContain(`(${p.totals.wins}/${p.totals.matches})`)
  }
})

it('headline.courtTime display includes (matchesWithDuration) behind the time', () => {
  const { index, leaderboards } = buildIndex('bat', [toyota, trang])
  const board = leaderboards.boards.find(b => b.id === 'headline.courtTime')!
  for (const e of board.entries) {
    const p = index.players[e.slug]
    expect(e.display).toMatch(/ \(\d+\)$/)
    expect(e.display).toContain(`(${p.matchCharacter.matchesWithDuration})`)
    // matchesWithDuration should never exceed totals.matches
    expect(p.matchCharacter.matchesWithDuration).toBeLessThanOrEqual(p.totals.matches)
  }
})
```

### Sample-record fixtures

No required updates — the field is optional. Existing `PlayerRecord` literals in tests omit it and TypeScript is happy.

## Edge cases

- **Player with no duration data at all** — already excluded from `headline.courtTime` by the existing `qualifies: p => p.matchCharacter.courtMinutes > 0` guard. So we never display `(0)`.
- **Player with `totals.matches === 0`** — already excluded from `headline.winPct` by the existing `qualifies: p => p.totals.matches >= 20` guard. So we never display `(0/0)` and never divide by zero.
- **Stale built index without `matchesWithDuration`** — display falls back to `(0)` via the `?? 0` guard. Resolves on the next index rebuild, which fires automatically on PM2 reload (verified earlier today).

## Out of scope

- `character.deciderRecord` board (also percent-only, also could benefit). Separate request if you want it.
- `discipline.*` boards. Wins-only display; no denominator to add yet.
- View-level changes — none.
- Tooltip text updates.

## Deployment

Same flow as today's prior deploys. Boot rebuild in `instrumentation.ts` re-emits the index immediately after PM2 reload, so `matchesWithDuration` populates on production within seconds.

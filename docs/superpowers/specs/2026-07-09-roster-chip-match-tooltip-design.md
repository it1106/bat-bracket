# Roster Chip Match-Result Tooltip — Design

**Date:** 2026-07-09
**Status:** Approved (design)

## Problem

In the stats tab, clicking a country (BWF) or club (BAT) opens a roster modal
listing each player and the event(s) they're entered in as chips. The chips are
color-coded by result but give no detail. Users want to hover an event chip and
see that player's match results in that event, most recent first.

## Scope

- Adds a hover/focus tooltip to each event chip in `RosterModal` (shared by
  `ClubRosterModal` and `CountryRosterModal`).
- Reuses the match data the stats generator already holds — **no new upstream
  (BAT/BWF) fetches** and no new client API. The results ride along in the
  cached stats blob.
- Out of scope: results for players with only unplayed matches (they get no
  tooltip), walkover matches (no score to show), and any change to the existing
  top-players section.

## Data Delivery

Embed per-player results in the stats blob (chosen over lazy-fetch). The stats
route already fetches the full match data and `buildTopPlayers` already computes
`StatsPlayerResult[]` for every player before discarding all but the top 12. We
retain that data for roster players instead of discarding it. Upstream calls are
unchanged; only the cached blob grows (~250–400 KB uncompressed on a large
~1,340-match tournament; gzips well; server-cached).

## Data Model

`StatsPlayerResult` already exists in `lib/types.ts`:

```typescript
export interface StatsPlayerResult {
  event: string        // stored here as the COLLAPSED eventName ?? draw
  round: string        // raw round; rendered via abbrevRoundL at display time
  won: boolean
  opponent: string[]   // opposing team player names, seed-stripped
  scores: MatchScore[] // PLAYER-perspective: t1 is always the player's side
  retired?: boolean
}
```

Add an optional field to both member types (additive → old blobs still parse;
missing ⇒ no tooltip):

```typescript
// on StatsClubMember and StatsCountryMember:
results?: StatsPlayerResult[]
```

Add the same optional `results?: StatsPlayerResult[]` to `RosterRow` in
`RosterModal.tsx`, passed through by `ClubRosterModal` and `CountryRosterModal`.

## Derivation (`lib/tournamentStats.ts`)

New `buildPlayerResultsByPlayer(ctxs: MatchCtx[]): Map<string, StatsPlayerResult[]>`:

- Iterate `ctxs`; skip matches with `winner === null` or `walkover` (same filter
  as `buildTopPlayers`).
- For each side, reuse the top-players orientation logic: flip scores for team 2
  so `t1` is the player's own side; seed-strip opponent names via `extractSeed`.
- Store `event` as the **collapsed** key `match.eventName ?? match.draw` (so it
  matches the chip string / `statusByEvent` keys — grouped events collapse to the
  parent, e.g. `MS`).
- Include `retired: match.retired || undefined`.

**Ordering — "latest first":** after collecting each player's results, sort by
date descending, then round depth (deepest first) as a tiebreak:

- Primary: `dateIso` of the match, descending. (`MatchCtx` carries `dateIso`.)
- Tiebreak: `roundSize(round)` ascending (Final = 2 sorts before SF = 4 … so
  deepest round first). Group/round-robin rounds (`roundSize` sentinel 512) sink
  after knockout rounds of the same date, which is acceptable.

Because the whole per-player list is sorted newest-first, filtering it to a
single event in the UI preserves newest-first order for that event.

**Wiring:** in `aggregate()`, compute
`const resultsByPlayer = buildPlayerResultsByPlayer(ctxs)` and pass it to
`buildClubRosters` and `buildCountryRosters` (both call sites — the empty-data
early return and the main path), which set `member.results =
resultsByPlayer.get(playerId)`. This mirrors the existing `statusByPlayer`
wiring.

## Tooltip Rendering (`components/RosterModal.tsx`)

- Each event chip becomes hover/focus interactive: add `tabIndex={0}` and wrap it
  so a tooltip element is a child (CSS-driven show on `:hover`/`:focus-within`,
  mirroring the panel's existing `stats-roster-tip` / `stats-medal-tip`).
- For chip event `E`, compute `const lines = row.results?.filter(r => r.event === E) ?? []`.
  If `lines.length === 0`, render the chip without a tooltip.
- Each tooltip line renders: round via `abbrevRoundL(r.round, lang)`, a `W`/`L`
  indicator, `vs` + opponent(s) joined with ` / `, and the score — each set as
  `${s.t1}-${s.t2}` space-separated. Append `(ret.)` when `r.retired`.
- A small event label header (the chip's `E`) tops the tooltip for clarity.
- `useLanguage()` supplies `lang` for `abbrevRoundL`. New i18n key
  `rosterTooltipVs` is unnecessary — `vs` is language-neutral; the only localized
  piece is the round abbreviation, already handled by `abbrevRoundL`.

CSS in `app/globals.css`: a `.country-roster-chip` tooltip wrapper + popup styled
like the existing roster/medal tips (absolute-positioned, appears on hover/focus,
scrolls if long, readable in light/dark).

## Testing

- **Aggregation** (`__tests__/`, via `aggregate()`): a roster member's `results`
  are present, keyed by the collapsed event, sorted newest-first, scores in the
  player's perspective, walkovers excluded, retired flagged.
- **Component** (`__tests__/RosterModal.test.tsx`): render a `RosterRow` with
  `results`; assert the chip's tooltip DOM lists the expected lines in
  newest-first order with correct round/W-L/opponent/score formatting; a chip
  whose event has no results renders no tooltip element.

## Files Touched

- `lib/types.ts` — `results?` on `StatsClubMember` and `StatsCountryMember`.
- `lib/tournamentStats.ts` — `buildPlayerResultsByPlayer`; wire into `aggregate`
  and both roster builders.
- `components/RosterModal.tsx` — `RosterRow.results`; chip tooltip rendering.
- `components/ClubRosterModal.tsx`, `components/CountryRosterModal.tsx` — pass
  `results` through.
- `app/globals.css` — chip tooltip styles.
- `__tests__/` — aggregation + component tests.

## Backward Compatibility

`results` is optional. Stats blobs cached before this change lack it → chips
render exactly as today with no tooltip. No cache invalidation; tooltips appear
as blobs regenerate.

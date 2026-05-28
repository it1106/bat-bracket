# Live Profile & Leaderboard Updates From In-Progress Tournaments

**Date:** 2026-05-28
**Status:** Approved design

## Problem

Player profiles (win/loss, tournament history, recent form) and the leaderboards
only reflect tournaments that have *fully completed*. The player index that backs
both surfaces ingests a tournament only once its full match schedule is pinned to
`.cache/full/<id>.json`, which happens exactly when every match-day is in the past
(`isAllPast`). While a tournament is in progress, none of its results count —
even matches that have already finished.

We want completed matches inside an in-progress tournament to count toward
win/loss, tournament history, and recent form, without waiting for the whole
tournament to finish.

## Decisions

These were settled during brainstorming:

- **Freshness: ~15 min.** There is no real-time signal from upstream; a finished
  match is discovered by re-scraping. We reuse the existing 15-minute discovery
  tick, which already fetches every active tournament. No tighter polling.
- **Both surfaces update live.** Win/loss and recent form are the leaderboard
  inputs, so a single index path feeds both profiles and leaderboards. In-progress
  results move leaderboard standings too.
- **No visual distinction.** In-progress tournament results flow into totals
  identically to completed ones. No `inProgress` flag, no badge — no type changes
  for presentation.

## Approach

Feed active (not-yet-pinned) tournaments' **resolved matches** into the same
`rebuildAll` path that already builds the player index, and run that rebuild on
every discovery tick. The existing `sourceVersion` gate
(`lib/player-index-rebuild.ts:123`) makes a rebuild a no-op when nothing changed,
so "run every tick" stays cheap — it only does real work when a match has actually
resolved since the last rebuild.

A match is considered resolved when `winner !== null || walkover || retired`
(the same predicate `isDayComplete` uses). Unplayed matches contribute nothing.

## Components & Changes

### 1. Resolved-match filter in the aggregator — safety-critical

**File:** `lib/playerIndex.ts`

`matchOutcome` (`playerIndex.ts:207`) computes `won = m.winner === side` and, for a
non-walkover/non-retired match, returns `'W'` or `'L'`. When `m.winner === null`,
both sides evaluate to `won === false`, so **both teams are scored a loss**. This
is currently harmless because only fully-resolved data is ingested (pinned full
caches and `isDayComplete` day caches). Once active tournaments are in scope, their
scheduled-but-unplayed matches would each register as a double loss.

Add a guard in the match loop (`playerIndex.ts:304-313`) that skips any match where
`winner === null && !walkover && !retired` before calling `registerSide` and before
incrementing `totalMatches`. Define a small `isResolvedMatch(m)` helper mirroring the
`isDayComplete` per-match check so the two predicates stay consistent.

This guard is the single most important change: it is the difference between
"in-progress results count correctly" and "every unplayed match silently corrupts
two players' records."

### 2. Capture the active-tournament fetch instead of discarding it

**File:** `lib/matches-full-cache.ts`

`prewarmMatchesFullCache` already fetches every active tournament's full schedule
on each tick via `ensureFullCachePersisted`, then discards it — the function only
writes to disk when `isAllPast` and otherwise returns `'active'`
(`matches-full-cache.ts:40-44`).

- Change `ensureFullCachePersisted` to return `{ status: FullCacheStatus; data: MatchesData | null }`
  instead of just `FullCacheStatus`, so callers receive the parsed schedule even
  for active tournaments.
- Change `prewarmMatchesFullCache` to return
  `{ newlyPinned: string[]; activeData: Map<string, MatchesData> }`, where
  `activeData` holds the in-memory schedule for every tournament whose status was
  `'active'` and which has data.

This adds **no new scraping** — it keeps the bytes already fetched. The function's
return shape changes, so its three callers (boot, tick, manual route) must be
updated.

### 3. Ingest active tournaments in the rebuild

**File:** `lib/player-index-rebuild.ts`

- `rebuildAll` gains an optional `activeData?: Map<string, MatchesData>` field in
  its `opts` argument.
- In the candidate loop (`player-index-rebuild.ts:65-116`), a tournament is usable
  if it has a pinned full cache **or** appears in `activeData`. Replace the
  `const full = await readFullCache(entry.id); if (!full) continue` gate with a
  fallback to `activeData.get(entry.id.toUpperCase())`.
- Merged-groups assembly for an active tournament:
  - **Past days** (`dateIso < todayIso`): read the pinned day cache; if absent,
    use the existing `ensureDay` fetch (which pins it for next time).
  - **Current day** (`dateIso === currentDate`'s day): use the current-day
    `groups` from the in-memory `activeData` entry, stamped with that day's
    `dateIso`. Reuses the prewarm fetch — no second live fetch for today.
  - **Future days** (`dateIso > todayIso`): skip — they carry no resolved matches
    and fetching them is wasted work.
- **Skip active tournaments with zero resolved matches** when building `inputs`, so
  a tournament that has started its schedule but played nothing yet does not cause
  rebuild churn.
- **`computeSourceVersion`** (`player-index-rebuild.ts:188`): fold a resolved-match
  count into each input's signature alongside `JSON.stringify(data).length`. The
  length already changes when scores/winner are added, but a winner-flip that
  preserves length would otherwise be missed; the resolved count closes that gap.

The pinned-tournament path is otherwise unchanged.

### 4. Fire the rebuild when active tournaments exist

**File:** `instrumentation.ts`

- The discovery tick currently rebuilds only when `newlyPinned.length > 0`
  (`instrumentation.ts:77-82`). Change the gate to
  `newlyPinned.length > 0 || activeData.size > 0`, and thread `activeData` from the
  prewarm return into `rebuildAll({ ensureDay, activeData })`.
- Boot (`instrumentation.ts:18, 30`) captures the prewarm return the same way and
  passes `activeData` into its `rebuildAll` call.

Because `rebuildAll` no-ops on an unchanged `sourceVersion`, firing every tick when
an active tournament exists is safe — the cost is one source-version hash unless a
match actually resolved.

### 5. Manual rebuild route

**File:** `app/api/players/rebuild/route.ts`

Run `prewarmMatchesFullCache` first and pass its `activeData` into `rebuildAll`, so
a manually triggered rebuild also reflects in-progress events rather than only
pinned tournaments.

## Data Flow (after change)

1. Discovery tick fires (every 15 min, outside the 00:00–08:00 quiet window).
2. `prewarmMatchesFullCache` fetches each tournament's schedule:
   - all-past → pinned to `.cache/full`, added to `newlyPinned`;
   - still active → schedule captured into `activeData`.
3. If anything newly pinned **or** any active tournament exists, `rebuildAll` runs.
4. For each candidate (pinned or active), groups are merged from pinned day caches +
   (for active) the live current-day groups; the resolved-match filter drops
   unplayed matches.
5. `sourceVersion` is recomputed; if unchanged, rebuild is skipped. If changed, the
   index and leaderboards caches are rewritten.
6. Profiles (`/api/players/[provider]/[slug]`) and leaderboards read the updated
   index on their next request.

## Known Limitations

- **Overnight quiet window:** the tick is skipped 00:00–08:00 Bangkok time, so a
  match that finishes at 11pm will not be reflected until the ~8am tick.
- **~15 min latency** by design — there is no upstream push, and we deliberately do
  not poll faster.
- **Leaderboards fluctuate during active tournament days** — expected, since both
  surfaces update live from in-progress results.
- **Upstream result corrections** (rare) are picked up on the next rebuild, not
  immediately.

## Testing

- **Regression guard (core risk):** aggregator skips unresolved matches
  (`winner === null`, not walkover/retired) — no phantom double-losses.
- Aggregator counts resolved matches inside an otherwise-active tournament.
- `rebuildAll` ingests a tournament supplied only via `activeData` (no pinned full
  cache), merging pinned past-day caches + live current-day groups.
- `sourceVersion` changes when a new match resolves and is stable when nothing
  changed (active tournament, no new results → rebuild skipped).
- Existing pinned-only tests continue to pass — the completed-tournament path is
  untouched.

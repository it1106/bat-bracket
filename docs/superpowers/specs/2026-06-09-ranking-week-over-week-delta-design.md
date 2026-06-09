# Ranking week-over-week delta indicator

Show each ranking row's movement vs. the previous weekly publication: a small up/down arrow with the magnitude of the rank change, or a "NEW" badge when the player wasn't in last week's snapshot.

Applies to the `Ranking` tab on the Leaderboards page for both BAT and BWF Asia Jr.

## Goals

- A user looking at a ranking board can see at a glance who climbed, who fell, and by how much, week over week.
- No additional upstream HTTP calls.
- No new on-disk artifacts beyond the existing single weekly snapshot per provider.

## Non-goals

- Multi-week history or sparklines. Out of scope; revisit later if needed.
- Movement indicators on non-ranking boards (headline, discipline, character, activity). Those aren't weekly rankings.
- Reconstructing a prior rank for a player who dropped below the cached top‑500 between weeks. They render as NEW.

## Data model

Add one optional field on `RankingEntry` (`lib/types.ts`):

```ts
/** This player's rank in the immediately previous weekly publication for
 *  the same event/provider. Absent when the player wasn't in the prior
 *  snapshot (genuinely new entrant, or first-ever scrape). */
previousRank?: number
```

Add the same field on `LeaderboardEntry` so the page-level mapper can pass it through to the renderer:

```ts
/** Mirrors RankingEntry.previousRank. Populated only on ranking-category
 *  entries; other categories ignore it. */
previousRank?: number
```

Both are additive and optional. Legacy cached JSONs without the field load unchanged and render no arrow until the next refresh repopulates.

## Populating `previousRank`

One focused change in `app/api/ranking/[provider]/refresh/route.ts`, right before the existing `writeRankingCache(...)` call:

1. Load the current cache: `const prev = await readRankingCache(provider)`.
2. Build a lookup keyed by event code and slug:

   ```ts
   // Map<eventCode, Map<slug, rank>>
   const prevRanks = new Map<string, Map<string, number>>()
   for (const ev of prev?.events ?? []) {
     const inner = new Map<string, number>()
     for (const e of ev.entries) inner.set(e.slug, e.rank)
     prevRanks.set(ev.eventCode, inner)
   }
   ```

3. Two branches based on whether the new publication is a new week or a same-week re-scrape:

   - **New `publishDate`** (the common case — Tuesday for BAT, Wednesday for BWF): for each new entry, set `previousRank` from `prevRanks.get(eventCode)?.get(slug)`. Players not in the prior snapshot get no field.
   - **Same `publishDate`** as the existing cache (manual force-refresh inside the same week): copy the prior cache's `previousRank` straight through onto the matching new entries. This preserves the delta against the genuine previous week — otherwise re-refreshing within a Tuesday-to-Tuesday window would wipe it.

4. Write the cache as today.

No new file. No migration. The first publication after deployment populates `previousRank` against whatever was already cached.

### Lookup key choice: slug

Slug is the row identity already exposed by the scraper for both providers. `globalPlayerId` is BWF-only at scrape time (BAT only resolves it lazily via the discovery path) so it would make the lookup branch on provider and force a fallback. Slug is uniform.

## Page-level wiring

`app/leaderboards/page.tsx`'s `rankingEventToBoard` maps `RankingEntry` → `LeaderboardEntry`. Add one line:

```ts
previousRank: e.previousRank,
```

No other plumbing — the entry rides straight through to the renderer.

## Rendering

In `components/LeaderboardsView.tsx`, the existing `lb-rk` cell already holds the rank number. Render the delta badge inline inside that same cell so there's no new column and no grid-layout shift:

```tsx
<div className={`lb-rk ${rankClass}`}>
  {e.rank}
  {effectiveActive === 'ranking' && renderDelta(e.rank, e.previousRank)}
</div>
```

Where `renderDelta` is a tiny pure helper colocated in the same file:

- `previousRank == null` → `<span className="lb-rk-delta-new">NEW</span>`
- `previousRank === rank` → `null` (no badge; keeps the row visually quiet)
- `previousRank > rank` → `<span className="lb-rk-delta-up">▲{previousRank - rank}</span>`
- `previousRank < rank` → `<span className="lb-rk-delta-down">▼{rank - previousRank}</span>`

Gating on `effectiveActive === 'ranking'` keeps the badge off non-ranking boards even if a future bug accidentally leaks `previousRank` into them.

## Styling

Three new classes in `app/globals.css` near the existing `.lb-rk` rules:

```css
.lb-rk-delta-up   { color: var(--ok, #1a7f37);  font-size: 11px; margin-left: 4px; font-weight: 600; }
.lb-rk-delta-down { color: var(--err, #c1272d); font-size: 11px; margin-left: 4px; font-weight: 600; }
.lb-rk-delta-new  { color: var(--muted);        font-size: 10px; margin-left: 4px; font-weight: 700;
                    letter-spacing: 0.5px; }
```

Reuse existing semantic-color variables where available; the literals above are fallbacks if the variable isn't defined. Verify against the active palette and dark-mode rules during implementation.

The badge sits to the right of the rank number on the same line; the `lb-rk` cell already centers its content so no additional flex tweaking is needed.

## Edge cases

| Case | Behavior |
| --- | --- |
| First-ever scrape on a fresh deployment | No prior cache → every row renders **NEW** for one week. Self-heals on the next publication. |
| Same-`publishDate` force-refresh within the week | `previousRank` copied straight from current cache; deltas unchanged. |
| Player dropped below the cached top‑500 between weeks, then re-entered | Renders **NEW**. We genuinely don't know their prior rank. Documented limitation. |
| Player slug changed upstream (rare; alias maintenance) | Treated as NEW. Acceptable — rank-alias resolution is out of scope here. |
| New event added upstream | Per-event lookup, so existing events are unaffected; new event renders all-NEW for its first week. |
| Cached entry from a pre-feature deployment | `previousRank` absent on every row → all NEW for one cycle, same as cold-start. |

## Tests

Two test files exercise the two layers:

1. **Cache-population test** (extend `__tests__/ranking-cache.test.ts` or add `__tests__/ranking-previous-rank.test.ts`):
   - No prior cache → all new entries have `previousRank` absent.
   - Prior cache with three players (A rank 5, B rank 10, C rank 20). New cache has A rank 3, B rank 10, D rank 8 (C gone, D new). After population: A `previousRank=5`, B `previousRank=10`, D `previousRank` absent.
   - Same `publishDate` re-refresh: prior cache already has `previousRank` populated → values preserved on the new entries.

2. **Renderer test** (extend `__tests__/LeaderboardsView.test.tsx`):
   - A ranking board entry with `previousRank > rank` renders `▲N` with `lb-rk-delta-up`.
   - A ranking board entry with `previousRank < rank` renders `▼N` with `lb-rk-delta-down`.
   - A ranking board entry with `previousRank == null` renders `NEW` with `lb-rk-delta-new`.
   - A ranking board entry with `previousRank === rank` renders no badge.
   - A non-ranking-category board entry that incidentally carries `previousRank` renders no badge.

## Out of scope (explicit)

- Rank history visualizations.
- Movement indicators on non-ranking boards.
- Filling in prior ranks for players who fell below the cached depth.
- Localization of the **NEW** label (English-only string for now; revisit when other strings on this page get translated).

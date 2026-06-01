# Player Ranking Detail on Player Profile

**Date:** 2026-06-01
**Status:** Approved design

## Problem

The player profile (`/player/bat/<slug>`) shows a "Current Ranking" summary —
one line per ranking event the player appears in, with rank/points/tournaments
count. That answers *"where do they stand?"* but not *"which tournaments got
them there?"*. BAT publishes the full breakdown at
`https://bat.tournamentsoftware.com/ranking/player.aspx?id=<rankingId>&player=<playerId>`
(e.g., รวิณ: `?id=51869&player=3903158`) but it isn't surfaced anywhere in the
app.

We want each profile to show the tournaments that contribute to each ranking
the player is on, split into three tabs (Singles / Doubles / Mixed). The
display must respect BAT's actual scoring rules:

- 52-week rolling window
- Only the top-10 highest-pointing tournaments count
- A row in one age group can count toward an *older* age group's ranking
  (e.g., a U15 result counting toward the U23 ranking via age progression)
- An asterisk (actually a marker `<img>` whose `title` lists the rankings it
  counts toward) marks the rows that contribute

## Decisions

Settled during brainstorming:

- **Placement.** Inline tabs in the existing `PlayerProfileView`, beneath the
  current "Current Ranking" summary. Three tabs: Singles / Doubles / Mixed.
- **Cache strategy.** On-demand fetch, keyed by `publishDate`. Cache file is
  *correct-by-construction*: the Tuesday scheduler updates the global ranking's
  `publishDate`, every per-player cache silently invalidates on the next read
  because its stamped `publishDate` no longer matches. No fixed TTL.
- **Within each tab, group by ranking category.** Each block answers "where do
  the points for *this* ranking come from": header with rank + total, top-10
  contributors, optional "show N more" for the non-counting rows in the same
  discipline.
- **Persist a flat array on disk, derive blocks on the client.** A single
  source-page row can count toward 2+ rankings; pre-grouping on disk would
  duplicate rows. Grouping is cheap, testable client-side work.
- **Bake `rankingId` into the global `bat-ranking.json` envelope.** The `id=`
  URL parameter changes weekly. Parsing it once from the overview page during
  the existing weekly refresh keeps the URL construction deterministic
  (vs. relying on BAT redirect behavior we'd then need to test).
- **Lazy `globalPlayerId` discovery.** The `player=3903158` ID in the URL is a
  *global* ID, different from the per-tournament `playerId` we already store
  in `sampleRef`. First request for a player resolves it via the existing
  `/sport/player.aspx → extractProfileUrl()` flow, then caches it forever
  (the global ID is stable per player).

## Approach

A self-contained per-player scraper + route + UI, mirroring the existing
`bat-ranking-scraper` / `profile-extra` patterns.

```
User opens /player/bat/<slug>
         │
         ▼
[1] Server component reads player record + current bat-ranking.json
       │  (already does this — unchanged)
       ▼
[2] Server component:
       a. Reads bat-player-id-map.json[slug] → globalPlayerId | null | unseen
       b. If globalPlayerId is known: reads
          .cache/players/bat-ranking-detail/<globalPlayerId>.json
       │      │
       │      └─ Cache miss OR cached publishDate ≠ current publishDate ──┐
       │                                                                 ▼
       │                                                  [Cache stale → no SSR data]
       │
       ▼
[3] Page renders. Existing summary stays as-is. New "Ranking detail" section:
       - SSR cache hit → tabs populate immediately
       - SSR cache miss → tabs show skeleton + fire client-side fetch
         to /api/players/ranking-detail?slug=<slug>
         │
         ▼
[4] /api/players/ranking-detail:
       a. Resolve globalPlayerId for this slug from lookup cache, OR
          run /sport/player.aspx → extractProfileUrl() once and persist
       b. Fetch /ranking/player.aspx?id=<currentRankingId>&player=<globalPlayerId>
       c. Parse with bat-ranking-player-scraper → typed structure
       d. Write .cache/players/bat-ranking-detail/<globalPlayerId>.json
          stamped with the current publishDate
       e. Return JSON → client hydrates the tabs
```

## Components & Changes

### 1. `lib/types.ts` — new interfaces

```ts
/** One row in the per-player ranking detail page. */
export interface BatRankingPlayerTournament {
  tournamentName: string
  tournamentId: string | null            // BAT GUID parsed from row link if present
  sourceEvent: string                    // e.g., "BS U15", "MD U17", "XD U23"
  week: string                           // "YYYY-WW"
  result: string                         // e.g., "5/8", "17/32"
  points: number
  /** Ranking categories this row counts toward, parsed from the marker img's
   *  title attribute. Empty array if not used in any top-10. */
  countsTowardRankings: string[]
}

export interface BatRankingPlayerDetail {
  globalPlayerId: string                 // BAT's stable "player=" URL param
  publishDate: string                    // matched on read to invalidate
  scrapedAt: string
  tournaments: BatRankingPlayerTournament[]
}

export interface BatRankingPlayerDetailCache {
  version: 1
  detail:
    | BatRankingPlayerDetail
    | { globalPlayerId: null; scrapedAt: string; publishDate: string; reason: string }
}
```

Extend the existing `BatRanking` envelope with `rankingId: string` and bump
the cache version `10 → 11` in `lib/bat-ranking-cache.ts`. The Tuesday
scheduler I just deployed will refresh once and write v11; v10 envelopes get
rejected.

### 2. `lib/bat-ranking-player-scraper.ts` — pure HTML → typed

Mirrors `lib/bat-ranking-scraper.ts`. Exports:

```ts
export function parseRankingPlayerPage(html: string): {
  tournaments: BatRankingPlayerTournament[]
}
```

Parses each row's six cells (tournament, event, week, result, points, matches
link) plus the optional seventh-cell marker `<img>`. When the marker is
present, its `title` attribute is split into a `countsTowardRankings: string[]`
(e.g., `"Used for: U23 Men's singles, U19 Boys singles"` → `["U23 Men's
singles", "U19 Boys singles"]`).

Handles HTML format drift gracefully:
- Missing marker → empty `countsTowardRankings`. Row still appears.
- Missing tournamentId in href → `tournamentId: null`. Row still appears
  without a clickable link.
- Zero rows from a 200-OK page → logged at the route level as a parser
  regression signal (see Failure Modes).

### 3. `lib/bat-ranking-scraper.ts` — add `parseRankingId()`

```ts
/** Extract the weekly ranking id from the overview page. The category links
 *  on the overview HTML use `category.aspx?id=<rankingId>&category=<N>`;
 *  that <rankingId> is what the per-player URL needs. */
export function parseRankingId(html: string): string
```

Wired into the existing `app/api/bat-ranking/refresh/route.ts` so the field
is populated on every successful refresh.

### 4. `lib/bat-ranking-player-cache.ts` — read/write per-player detail

Mirrors `lib/bat-player-extra-cache.ts`. Writes
`.cache/players/bat-ranking-detail/<globalPlayerId>.json`. Atomic
write-then-rename like the existing caches. Reader rejects mismatched
`version` and returns `null` on parse error so a corrupt file degrades to a
fresh fetch rather than a crash.

### 5. `lib/bat-player-id-map.ts` — slug → globalPlayerId map

A single small JSON file at `.cache/players/bat-player-id-map.json` of shape
`{ version: 1, players: Record<slug, { globalPlayerId: string | null; reason?: string }> }`.
Append-only on success. On discovery failure we persist `{ globalPlayerId:
null, reason }` so the next page view doesn't re-trigger a failed scrape.

### 6. `lib/bat-ranking-player-view.ts` — pure derived view

```ts
export interface RankingDetailBlock {
  rankingEventName: string                          // "U23 Men's singles"
  rankingEventCode: string                          // "U23_MS"
  playerRank: number                                // from currentRanking
  totalPoints: number                               // from currentRanking
  topTen: BatRankingPlayerTournament[]              // counts toward this ranking
  otherRows: BatRankingPlayerTournament[]           // same discipline, doesn't count here
}

export function groupForTab(
  detail: BatRankingPlayerDetail,
  currentRanking: BatRanking,
  discipline: 'singles' | 'doubles' | 'mixed',
): RankingDetailBlock[]
```

`discipline` filter is derived from `sourceEvent` regex (e.g., `BS`/`GS` →
singles; `BD`/`GD`/`MD`/`WD` → doubles; `XD` → mixed). One pass; pure.

### 7. `app/api/players/ranking-detail/route.ts` — GET endpoint

```
GET /api/players/ranking-detail?slug=<slug>
  → { detail: BatRankingPlayerDetail }
  | { error: string }
```

Logic:
1. Read `bat-ranking-player-cache` for the slug's `globalPlayerId`. If hit
   and `publishDate` matches current ranking's, return immediately.
2. Resolve `globalPlayerId` (lookup map → `/sport/player.aspx` →
   `extractProfileUrl()` → persist). On failure, persist sentinel + return
   `{error}`.
3. `batFetch('ranking-player-detail', ...)` the
   `/ranking/player.aspx?id=<rankingId>&player=<globalPlayerId>` URL.
4. Parse with `bat-ranking-player-scraper`.
5. Persist + return.

Concurrency dedup: in-process `Map<globalPlayerId, Promise<Detail>>` keyed by
in-flight fetches. Cleared on settle. Prevents a Tuesday-morning bookmark
reload thundering-herd.

### 8. `app/player/[provider]/[slug]/page.tsx` — SSR pipe-through

Reads the per-player detail cache same way it already reads `bat-ranking.json`.
Passes `initialDetail?: BatRankingPlayerDetail` and the (already-fetched)
`currentRanking: BatRanking` into `PlayerProfileView`. No fetch from the
server component — if cache is stale, the client component does the fetch.

### 9. `components/PlayerProfileView.tsx` — mount the new section

Adds, beneath the existing "Current Ranking" block (only when `batRanking?.length`
and `provider === 'bat'`):

```tsx
<RankingDetailTabs
  slug={record.key.slug}
  initialDetail={initialDetail}
  currentRanking={currentRanking}
/>
```

Nothing else in `PlayerProfileView` changes.

### 10. `components/RankingDetailTabs.tsx` — NEW client component

Owns: active tab state, fetch lifecycle. One `useEffect` for the fetch. Calls
`groupForTab()` to derive blocks for the active tab. Tracks
`'ranking_detail_viewed'` (once per mount, after data lands) and
`'ranking_detail_tab_changed'` on switch.

### 11. `components/RankingDetailBlock.tsx` — NEW presentational

Header: ranking event name + `Rank #N` + `total pts`. Body: top-10 rows.
"Show N more rows that don't count" toggle (same `stats-show-toggle` pattern
we just used on Top Clubs by Medals).

### 12. `components/TournamentRow.tsx` — NEW small presentational

Tournament name (link if `tournamentId`), event chip, week, result, points.
Used inside `RankingDetailBlock`.

### 13. `lib/i18n.ts` — new keys

`rankingDetailTitle`, `rankingDetailTabSingles`, `rankingDetailTabDoubles`,
`rankingDetailTabMixed`, `rankingDetailRankLabel`, `rankingDetailShowMore`,
`rankingDetailShowLess`, `rankingDetailLoadFailed`, `rankingDetailRetry`,
`rankingDetailEmpty`. EN + TH.

## Failure Modes

| Failure | Behavior |
|---|---|
| BAT upstream 5xx during scrape | Route returns 502; client shows inline retry. Existing "Current Ranking" summary remains visible. |
| BAT upstream 404 | Route returns 404; client renders empty state. Cache a `null` sentinel keyed to the current `publishDate` so we don't re-hit on every page view; expires when `publishDate` changes. |
| `globalPlayerId` discovery fails | Persist `{globalPlayerId: null, reason}` in the slug→id map. Skip the new section for this slug. |
| Parser returns zero rows from a 200-OK page | Cache the empty result with a 24h fallback TTL (the only TTL in the design) so a parser fix can recover without waiting for next Tuesday. Log `[ranking-detail/parse] zero rows playerId=X` at warn. |
| Concurrent first-view requests for same player | In-process `Promise` dedup map. Second caller awaits the first's promise. |
| BAT HTML drift removes marker img | Scraper treats every row as `countsTowardRankings: []` (degrades to "all rows in otherRows"). Renders, no crash. Snapshot test on a known fixture catches the drift on next CI. |
| Non-BAT player (provider=bwf) | Section is omitted at render time (same gate as existing "Current Ranking"). |
| BAT player not in any ranking | Both sections are omitted. No fetch. |

## Testing

- **`__tests__/bat-ranking-player-scraper.test.ts`** — pure. Fixture: a
  committed copy of รวิณ's page at
  `__tests__/fixtures/bat-ranking-player.html`. Asserts: row count, the
  multi-ranking case (a row whose `countsTowardRankings` has 2+ entries),
  unmarked rows, the empty-page edge case, the malformed-title-attribute
  graceful fallback.
- **`__tests__/bat-ranking-player-view.test.ts`** — pure `groupForTab()`.
  Asserts each tab filters by discipline correctly, each block's `topTen`
  length ≤ 10, `otherRows` contains exactly the same-discipline rows that
  *don't* list this ranking, rank/points come from `currentRanking`.
- **`__tests__/api-players-ranking-detail-route.test.ts`** — mocks
  `batFetch`. Cases: publishDate-key cache hit short-circuits, publishDate
  mismatch refetches, sentinel for unknown player doesn't retry within the
  same `publishDate`, dedup map collapses concurrent calls, BAT 502
  passes through as 502, parser zero-rows triggers the 24h fallback path.
- **`__tests__/bat-ranking-player-cache.test.ts`** — read/write roundtrip,
  version mismatch returns null, corrupt JSON returns null.
- **`__tests__/bat-ranking-scraper.test.ts`** — extend with one test for
  `parseRankingId()` from the existing overview-page fixture.

## Cache Versioning

| Cache | Current | New | Reason |
|---|---|---|---|
| `bat-ranking.json` (envelope) | v10 | **v11** | Adds `rankingId` field. The Tuesday scheduler refresh re-writes on first run; v10 envelopes are rejected (existing pattern). |
| `bat-ranking-detail/<id>.json` | — | **v1** | New cache. |
| `bat-player-id-map.json` | — | **v1** | New cache. |

**Deploy-time blackout window — already handled.** After this deploy, the
v10 envelope on disk is rejected by the new `readBatRankingCache` (which
expects v11). The boot kick added in commit `12a6469` already covers this:
`readBatRankingCache → null` makes `cacheAgeMs = null`, which the scheduler
treats as "always kick". So within ~45 s of PM2 reload the v11 envelope is
written and the leaderboards / "Current Ranking" sections recover. No
additional one-shot curl needed at deploy time.

## Scope Boundaries (YAGNI)

Explicitly *not* in this design:

- No bulk pre-scrape on Tuesday refresh (Approach B was rejected — uneven
  coverage and a 5-10 min upstream burst for marginal value).
- No "Ranking detail" surface for BWF players (no equivalent BWF source).
- No alert when a player's *own* ranking changes (could be added later;
  current alert is at the global "new ranking published" granularity).
- No sortable / filterable rows. Block order = ranking event ordering from
  `bat-ranking.json`; row order within `topTen` = points desc.
- No image-share treatment for the detail section (existing share buttons
  on the page remain unchanged).

# BAT Ranking Integration — Design Spec

**Date:** 2026-05-25  
**Status:** Approved

## Overview

Integrate the official "Badminton Thailand Junior Ranking" from
`bat.tournamentsoftware.com/ranking` into the leaderboards page and player
profile modal. Rankings are published every Tuesday; we store only the most
recent snapshot.

## Scope

- Scrape and cache BAT Junior Ranking (all disciplines: MS, WS, MD, WD, MXD)
- Show top 50 players per discipline in a new "Ranking" category tab within the
  BAT provider tab
- Show a player's current ranking position(s) in their BAT profile modal
- Manual refresh via a POST endpoint
- No BWF involvement — this is strictly BAT data

## Data Model

### New types in `lib/types.ts`

```ts
export interface BatRankingEntry {
  rank: number
  name: string
  slug: string      // nameToSlug(name) — best-effort link to BAT player index
  club: string
  points: number
}

export interface BatRankingEvent {
  eventCode: string   // "MS" | "WS" | "MD" | "WD" | "MXD"
  eventName: string   // display label, e.g. "Men's Singles"
  entries: BatRankingEntry[]   // top 50 only
}

export interface BatRanking {
  scrapedAt: string    // ISO timestamp
  publishDate: string  // date string parsed from the ranking page
  events: BatRankingEvent[]
}
```

`LeaderboardCategory` gains `| 'ranking'`:

```ts
export type LeaderboardCategory = 'headline' | 'discipline' | 'character' | 'activity' | 'ranking'
```

### Cache location

`.cache/players/bat-ranking.json`

Read/write via new `lib/bat-ranking-cache.ts`.

## Architecture

### `lib/bat-ranking-cache.ts` (new)

- `readBatRankingCache(): Promise<BatRanking | null>`
- `writeBatRankingCache(data: BatRanking): Promise<void>`

Follows the same atomic write pattern (`tmp → rename`) as `player-index-cache.ts`.

### `lib/bat-ranking-scraper.ts` (new)

Pure transform module — no I/O, returns `BatRanking`.

- Accepts raw HTML string as input
- Filters to "Badminton Thailand Junior Ranking" section (skips "Open Ranking")
- Parses discipline tables: rank, player name, club, points
- Trims to top 50 entries per event
- Computes `slug` via `nameToSlug()` from `lib/playerIndex.ts`
- Returns `BatRanking` with `publishDate` extracted from the page

Fetch is done by the caller (the API route) using `batFetch()`.

### `/api/bat-ranking/refresh` (new route)

`POST /api/bat-ranking/refresh`

1. Calls `batFetch('ranking', BAT_RANKING_URL)`
2. Passes response HTML to the scraper
3. Writes result via `writeBatRankingCache()`
4. Returns `{ scrapedAt, eventsFound: number }`

No auth required — only accessible from the server itself (not exposed via the
public Vercel deployment; used on `ezebat.lan` only).

## Leaderboards Integration

### `app/leaderboards/page.tsx`

Add a third parallel read alongside `bat` and `bwf` leaderboard caches:

```ts
const [bat, bwf, ranking] = await Promise.all([
  readLeaderboardsCache('bat'),
  readLeaderboardsCache('bwf'),
  readBatRankingCache(),
])
```

Map `ranking.events` → `LeaderboardBoard[]` with `category: 'ranking'`.
Inject these boards into the BAT `Leaderboards.boards` array before rendering.

Each `BatRankingEvent` → one `LeaderboardBoard`:
- `id`: `ranking-${eventCode.toLowerCase()}`
- `titleKey`: event name used directly as title (no i18n key — official names)
- `icon`: discipline-appropriate emoji (🏸)
- `category`: `'ranking'`
- `entries`: top 50 `BatRankingEntry` mapped to `LeaderboardEntry`

### `components/LeaderboardsView.tsx`

Add "Ranking" tab to `CATEGORIES`:

```ts
{ id: 'ranking', key: 'lbRanking' }
```

The tab is always present in the list but only contains boards when the active
provider is BAT. For BWF the tab renders empty (same pattern as other categories
that may have no boards).

Add `lbRanking` translation key to `lib/i18n.ts`.

## Player Profile Integration

### Lookup

In the player page or API route (whichever assembles the profile data), read
`readBatRankingCache()` and find all entries where `entry.slug === slug` across
all events. Only runs when `provider === 'bat'`.

Result: a small array of `{ eventName: string; rank: number; points: number }`.

### Display

In `components/PlayerProfileView.tsx` (or `PlayerModal.tsx`), add a "Current
Ranking" section below the existing stats. Only rendered when the array is
non-empty. Example:

```
Current Ranking
  Men's Singles    #12  (1,250 pts)
  Men's Doubles    #8   (1,480 pts)
```

If the ranking cache is absent or the player has no entries, this section is
silently omitted — no error state needed.

## Name Matching Strategy

`nameToSlug()` is applied to the ranking player name at scrape time. Since BAT
tournament data and BAT ranking data both originate from the same
TournamentSoftware platform, names should match in most cases. No fuzzy matching
is needed in v1 — if `slug` doesn't map to a known player, the entry renders as
a non-linked row (same visual style, just no `<Link>`).

## What Is Not In Scope

- Historical ranking snapshots (only most recent is stored)
- Automated cron scheduling (manual refresh endpoint only)
- BWF ranking (completely separate system, not touched)
- Combined (BAT+BWF) ranking boards

## Files Touched

| File | Change |
|------|--------|
| `lib/types.ts` | Add `BatRankingEntry`, `BatRankingEvent`, `BatRanking`; extend `LeaderboardCategory` |
| `lib/bat-ranking-cache.ts` | New — read/write cache |
| `lib/bat-ranking-scraper.ts` | New — HTML parser, pure function |
| `app/api/bat-ranking/refresh/route.ts` | New — POST refresh endpoint |
| `app/leaderboards/page.tsx` | Read ranking cache, inject boards |
| `components/LeaderboardsView.tsx` | Add Ranking tab |
| `lib/i18n.ts` | Add `lbRanking` key |
| `components/PlayerProfileView.tsx` | Add Current Ranking section |
| `app/api/players/[provider]/[slug]/route.ts` | Pass ranking data to profile |

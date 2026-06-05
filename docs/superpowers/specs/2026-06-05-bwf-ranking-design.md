# BWF Ranking — Design

**Status:** Proposed
**Author:** Ed Chuchaisri (with Claude)
**Date:** 2026-06-05
**Related:**
- `docs/superpowers/specs/2026-05-25-bat-ranking-design.md`
- `docs/superpowers/specs/2026-06-01-player-ranking-detail-design.md`
- `docs/superpowers/specs/2026-05-25-bat-bwf-leaderboard-integration-design.md`

## Goal

Add BWF Ranking to the leaderboards page and to player profiles, mirroring the existing BAT Ranking UX. Upstream:
`https://www.tournamentsoftware.com/ranking/ranking.aspx?rid=186`.

Two surfaces, both already exist for BAT and should appear identically for BWF:

1. **Leaderboards → BWF tab → Ranking sub-tab.** One board per BWF ranking event, top 30 entries (collapsed to 10), publication date shown.
2. **Player profile (BWF provider) → Current Ranking section + Ranking Detail tabs.** The Ranking Detail panel shows per-discipline (singles/doubles/mixed) top-10 contributing tournaments and "others", with expiry-tier highlighting — identical to the BAT detail UI.

## Non-Goals

- Combined-provider Ranking tab. (Combined provider currently lacks any Ranking surface; that stays.)
- Backfilling BAT entries with `globalPlayerId` to retire the BAT 3-hop discovery. (BAT path is unchanged.)
- Career/YTD stats banner for BWF profiles. (Out of scope; that lives in `profile-extra` and is BAT-only today.)
- Auto-incrementing the leaderboards UI to render any new "Ranking" board styling. The existing renderer already special-cases `category === 'ranking'`.

## Background — what we found about upstream

- `www.tournamentsoftware.com` and `bat.tournamentsoftware.com` serve the *same* HTML for ranking pages — same CSS classes (`rank`, `rankingpoints`, `rankingdate`), same `category.aspx?id=X&category=Y` and `player.aspx?id=X&player=N` URL shapes, same "Used for:" marker on per-player rows.
- Two cosmetic differences:
  - Overview header cells: BAT uses `<th colspan="9">`, BWF uses `<th colspan="8">`. The current regex hardcodes 9 — must relax to `\d+`.
  - Publish date format: BAT renders Thai Buddhist Era `DD/M/YYYY` (e.g. `26/5/2569`); BWF (forced to LCID 2057 en-GB) renders Gregorian `DD/MM/YYYY` (e.g. `03/06/2026`).
- `www.tournamentsoftware.com` enforces a cookie wall via 302→`/cookiewall/?...`. A static request cookie `st=l=2057&exp=46542&c=1&cp=23` bypasses it cleanly; no Chromium needed.
- `BWF` publishes weekly, but on **Wednesday**, not Tuesday. (Captured publishDate `03/06/2026` = Wed 3 June.) Polling window must be Wed-keyed, not Tue.
- A player's numeric ranking `player=<id>` is already in the category-page HTML next to their row. So for BWF we capture it during the scrape and skip the 3-hop discovery dance that BAT needs. Consequence: BWF Ranking Detail is available only for players who appear in the top-N of some BWF ranking event — same constraint that's already in force for BAT, because today's player page only renders `RankingDetailTabs` when `batRanking.length > 0`.

## Architecture

### File layout

Refactor existing `bat-ranking-*` files into a provider-agnostic `lib/ranking/` package. New files:

```
lib/ranking/
  config.ts                 # PROVIDER_CONFIG: { bat, bwf } — URLs, headers, cookie, schedule, dateFormat
  scraper.ts                # parseRankingOverview, parseCategoryPage, parseRankingPlayerPage (provider-agnostic)
  cache.ts                  # readRankingCache(provider), writeRankingCache(provider, data) — file per provider
  player-cache.ts           # readRankingPlayerDetail({provider, globalPlayerId}), write* — file per provider per player
  scheduler.ts              # decideTick, decideBootKick (parametrized on schedule.dayOfWeek)
  player-view.ts            # topRowsForTab, otherRowsForTab, computeExpiryCutoffs, weekKeyFromPublishDate(s, dateFormat)
  fetch.ts                  # rankingFetch(provider, kind, url) — wraps batFetch, injects provider headers/cookie

app/api/
  ranking/[provider]/refresh/route.ts        # replaces app/api/bat-ranking/refresh
  players/ranking-detail/route.ts            # accepts ?provider=bat|bwf

components/
  RankingDetailTabs.tsx                      # add `provider: ProviderTag` prop; use it in fetch URL + analytics

app/leaderboards/page.tsx                    # read both ranking caches; attach to bat/bwf provider boards
app/player/[provider]/[slug]/page.tsx        # read provider-matched ranking cache + detail
instrumentation.ts                           # start one ranking poll per provider
```

The old `bat-ranking-*` files are deleted (their imports rewritten — every existing call site moves to the parameterized API).

### Provider config

```ts
// lib/ranking/config.ts
export interface RankingProviderConfig {
  provider: ProviderTag                      // 'bat' | 'bwf'
  overviewUrl: string                        // ranking.aspx?rid=...
  categoryUrl: (rankingId: string, catId: string) => string   // includes ?ps=50
  playerUrl:   (rankingId: string, playerId: string) => string
  headers: Record<string, string>            // UA, and Cookie for BWF
  dateFormat: 'thai-be' | 'en-gb'            // governs publishDate parsing + week-key derivation
  pollSchedule: {
    dayOfWeek: number                        // 0=Sun..6=Sat — BAT=2, BWF=3
    startHour: number                        // inclusive — both 8
    endHour: number                          // inclusive — both 23
    staleBootKickMs: number                  // both 6 days
  }
}

const UA_BAT = { 'User-Agent': 'Mozilla/5.0 ... Chrome/124' }
const UA_BWF = {
  'User-Agent': 'Mozilla/5.0 ... Chrome/124',
  'Cookie': 'st=l=2057&exp=46542&c=1&cp=23',
}

export const PROVIDER_CONFIG: Record<'bat' | 'bwf', RankingProviderConfig> = {
  bat: {
    provider: 'bat',
    overviewUrl: 'https://bat.tournamentsoftware.com/ranking/ranking.aspx?rid=188',
    categoryUrl: (rid, cat) => `https://bat.tournamentsoftware.com/ranking/category.aspx?id=${rid}&category=${cat}&ps=50`,
    playerUrl:   (rid, pid) => `https://bat.tournamentsoftware.com/ranking/player.aspx?id=${rid}&player=${pid}`,
    headers: UA_BAT,
    dateFormat: 'thai-be',
    pollSchedule: { dayOfWeek: 2, startHour: 8, endHour: 23, staleBootKickMs: 6 * 86_400_000 },
  },
  bwf: {
    provider: 'bwf',
    overviewUrl: 'https://www.tournamentsoftware.com/ranking/ranking.aspx?rid=186',
    categoryUrl: (rid, cat) => `https://www.tournamentsoftware.com/ranking/category.aspx?id=${rid}&category=${cat}&ps=50`,
    playerUrl:   (rid, pid) => `https://www.tournamentsoftware.com/ranking/player.aspx?id=${rid}&player=${pid}`,
    headers: UA_BWF,
    dateFormat: 'en-gb',
    pollSchedule: { dayOfWeek: 3, startHour: 8, endHour: 23, staleBootKickMs: 6 * 86_400_000 },
  },
}
```

Scheduler signatures change accordingly:

```ts
decideTick({ clock, schedule }: { clock: BangkokClock; schedule: PollSchedule }): SchedulerAction
decideBootKick({ clock, schedule, cacheAgeMs }: { /* … */ }): SchedulerAction
```

### Data flow — refresh

```
scheduler tick (instrumentation, per provider)
  → peek overview URL (provider headers)
  → parsePublishDate(html, config.dateFormat)
  → unchanged? skip
  → changed? POST /api/ranking/{provider}/refresh?force=true
        → fetch overview, parse categories[] + rankingId
        → for each category: fetch category.aspx, parseCategoryPage
        → each RankingEntry includes globalPlayerId (for BWF; '' for BAT)
        → atomic write .cache/players/ranking-{provider}.json
        → "all categories empty → preserve cache" guard same as today
```

### Data flow — read

```
GET /leaderboards
  → readRankingCache('bat'), readRankingCache('bwf')
  → leaderboards page maps each provider's events → boards (category='ranking')
  → already-existing client renderer picks up new boards

GET /player/{provider}/{slug}
  → SSR reads ranking cache for matching provider
  → playerRankings[] (renamed from batRanking[]) built from entries whose slug matches
  → for BWF: globalPlayerId already on the matching entry → pre-fetch detail if cached
  → RankingDetailTabs renders iff playerRankings.length > 0 (per-provider)

GET /api/players/ranking-detail?provider=bwf&slug=…
  → readRankingCache('bwf') → find entries.slug === slug → take entry.globalPlayerId
  → no globalPlayerId? 404 (not in any BWF ranking)
  → readRankingPlayerDetail('bwf', globalPlayerId) → cache hit?
  → miss: fetch player.aspx with provider headers, parse, write detail cache

GET /api/players/ranking-detail?provider=bat&slug=…
  → unchanged: existing 3-hop discovery path
```

### Type changes (`lib/types.ts`)

Additive, no breaking renames:

```ts
export interface RankingEntry {              // formerly BatRankingEntry
  rank: number; name: string; slug: string; club: string
  points: number; tournaments: number
  globalPlayerId?: string                    // NEW — populated by BWF scrape; '' on BAT
}
export interface RankingEvent { eventCode: string; eventName: string; entries: RankingEntry[] }
export interface Ranking {
  provider: ProviderTag                       // NEW — 'bat' | 'bwf'
  scrapedAt: string
  publishDate: string                        // raw upstream string (BE for BAT, Gregorian DD/MM/YYYY for BWF)
  rankingId: string
  events: RankingEvent[]
}
// Aliases retained for one cycle so external callers don't break:
export type BatRankingEntry = RankingEntry
export type BatRankingEvent = RankingEvent
export type BatRanking      = Ranking
```

Overview-cache envelope version bumps from v11 → v12 (gains `provider`). Per-player detail cache (v1, `BatRankingPlayerDetailCache`) is unchanged in shape — only its on-disk directory moves to `ranking-detail/{provider}/{id}.json`. Old v11 overview envelopes (no `provider`) are rejected on read; the boot kick re-populates immediately.

## Component & API contracts

### `POST /api/ranking/{provider}/refresh`

- Params: path `provider` ∈ `{bat, bwf}`. Query `?force=true` overrides 24h TTL.
- Looks up `PROVIDER_CONFIG[provider]`. Unknown provider → 400.
- Behavior: identical to today's `bat-ranking/refresh` (TTL guard, overview fetch, parse, per-category fan-out, "all empty → preserve" guard, atomic write).
- Difference: per-category fetch headers come from the provider config (BWF carries the cookie wall bypass).

### `GET /api/players/ranking-detail?provider={bat|bwf}&slug={slug}`

- Adds `provider` query param (defaults to `bat` for backward-compat with existing client calls).
- `bat` path: unchanged 3-hop discovery via `bat-player-id-map`.
- `bwf` path:
  1. `readRankingCache('bwf')` → walk events, find any entry with `entry.slug === slug`, take its `globalPlayerId`.
  2. None found → 404 with `"not in any BWF ranking"`.
  3. Found → cache check against current publishDate → fetch + cache if miss.

### `RankingDetailTabs` component

Add `provider: ProviderTag` prop:
- `useEffect` fetch URL: `/api/players/ranking-detail?provider={provider}&slug=…`.
- Analytics: `track('ranking_detail_viewed', { provider, slug, discipline })`.
- The discipline classifier, dedup, expiry, sort — all unchanged (already provider-agnostic).

### `app/leaderboards/page.tsx`

```ts
const [bat, bwf, batRanking, bwfRanking] = await Promise.all([
  readLeaderboardsCache('bat'),
  readLeaderboardsCache('bwf'),
  readRankingCache('bat'),
  readRankingCache('bwf'),
])
const providers: Leaderboards[] = []
if (bat) providers.push({ ...bat, boards: [...bat.boards, ...rankingEventsToBoards(batRanking)] })
if (bwf) providers.push({ ...bwf, boards: [...bwf.boards, ...rankingEventsToBoards(bwfRanking)] })
return <LeaderboardsView
  leaderboards={providers.length ? providers : [EMPTY]}
  rankingPublishDates={{ bat: batRanking?.publishDate, bwf: bwfRanking?.publishDate }} />
```

`LeaderboardsView` extends to take a per-provider `rankingPublishDates` map so the "as of" line shows the active provider's date.

### `app/player/[provider]/[slug]/page.tsx`

Generalize the existing BAT-only block: read `ranking-{provider}.json`, build `rankings[]`, look up `globalPlayerId` for the slug; SSR-fetch detail only when fresh; render `RankingDetailTabs` with the matched provider.

## Sharp edges

1. **Cookie wall bypass.** Every BWF ranking fetch uses static `Cookie: st=l=2057&exp=46542&c=1&cp=23`. Encoded once in `PROVIDER_CONFIG.bwf.headers`. The cookie value embeds an `exp` epoch from 2027 — well past today; we extend on the next maintenance pass if it ever lapses.

2. **`colspan` regex.** Today: `/<th[^>]*colspan="9"[^>]*>.../i`. Change: `/<th[^>]*colspan="\d+"[^>]*>.../i`. BAT (9) and BWF (8) both match. Existing BAT parser tests must still pass after the change.

3. **Publish-date format dispatcher.** New `parsePublishDate(s, format)`:
   - `'thai-be'`: existing regex, requires year ≥ 2400.
   - `'en-gb'`: matches `DD/MM/YYYY` exactly; requires year < 2400 (rejecting BE-shaped values keeps the dispatcher honest).
   - Both return a UTC `Date | null`.
   - `weekKeyFromPublishDate(s, format)` calls the dispatcher.
   - `expiringWithinWeeksCutoff(s, weeksOut, format)` — same signature, threads `format` through.

4. **Scheduler runs twice.** `instrumentation.ts` starts one `setInterval` per provider config. Boot kick fires per-provider so a fresh deploy with stale BWF cache and warm BAT cache (or vice-versa) catches up correctly.

5. **BWF cookie wall on the detail route too.** `player.aspx` lives behind the same wall — `rankingFetch('bwf', ...)` carries the cookie automatically, so this is transparent in the route handler.

6. **Slug overlap.** Provider-scoped indexes already keep BAT and BWF separate; player routes are `/player/{provider}/{slug}`. No new collision surface.

## Test plan

- `__tests__/ranking-scraper.test.ts`: replaces `bat-ranking-scraper.test.ts`. Fixtures for both providers (`fixtures/ranking-overview-bat.html`, `fixtures/ranking-overview-bwf.html`, `fixtures/ranking-category-bat.html`, `fixtures/ranking-category-bwf.html`). Asserts:
  - Overview parses events, publishDate, rankingId for both.
  - BWF entries carry non-empty `globalPlayerId`.
  - Both `colspan` values handled.

- `__tests__/ranking-scheduler.test.ts`: parametrized over provider configs (Tue=BAT, Wed=BWF). Covers `decideTick` and `decideBootKick`.

- `__tests__/ranking-player-view.test.ts`: extends the existing test file. New cases for `weekKeyFromPublishDate('03/06/2026', 'en-gb')` and `expiringWithinWeeksCutoff('03/06/2026', 1, 'en-gb')`. Existing BE tests pinned via `'thai-be'`.

- `__tests__/ranking-cookie-wall.test.ts`: small unit asserting that the BWF provider config emits a Cookie header containing `st=l=2057` and the BAT one doesn't.

- Smoke (manual): force `POST /api/ranking/bwf/refresh?force=true` in dev; verify cache file shape, leaderboards page shows BWF Ranking tab with ~40 boards, clicking a top-ranked BWF player opens Ranking Detail.

## Migration & rollout

- Single PR. Atomic from the user's perspective.
- Cache file move: writes go to a *new* canonical path `.cache/players/ranking-{provider}.json`. The old `.cache/players/bat-ranking.json` is best-effort deleted by `readRankingCache('bat')` on first miss to avoid leaving a stale orphan; if delete fails (permissions), we log and ignore — the file is harmless.
- Per-player detail moves from `.cache/players/bat-ranking-detail/<id>.json` to `.cache/players/ranking-detail/{provider}/<id>.json`. Old directory similarly cleaned on first miss.
- Old `bat-ranking-*.ts` files deleted in the same PR. Every import migrated.
- No DB, no env-var change.
- Rollback: revert PR. The reverted code reads from the old `bat-ranking.json` path. If we already deleted that file in the new run, the reverted boot kick repopulates it on the next Tuesday window (or immediately via the staleness boot-kick path, since `cacheAgeMs === null` triggers a peek).

## What we are NOT doing

- Retrofitting BAT to capture `globalPlayerId` during scrape (3-hop discovery stays for BAT).
- Combined-provider Ranking tab.
- Career/YTD stats for BWF profiles.
- Changing leaderboards collapse/expand behavior or rank-row styling.

# Minimal BWF Player Profile

**Status:** Proposed
**Author:** Ed Chuchaisri (with Claude)
**Date:** 2026-06-05
**Related:**
- `docs/superpowers/specs/2026-06-05-bwf-ranking-design.md`
- `docs/superpowers/specs/2026-06-05-bwf-ranking-by-event-design.md`

## Goal

Render a profile page for BWF-ranked players who are absent from our local player index. Today the player page returns 404 for ~37% of BWF leaderboard clicks (182 of 486 ranked BWF players are not in `index-bwf.json`). After this change, those clicks land on a stripped-down profile showing the data we *do* have: name, country, the player's BWF rankings, and the BWF Ranking Detail panel.

## Non-Goals

- Rendering minimal profiles for BAT. BAT's slug↔globalPlayerId discovery requires a `sampleRef` from a played tournament, which non-indexed BAT-ranked players do not have. The BAT path keeps its existing `notFound()` behavior.
- Inventing match data (totals, recent form, opponents, partners) for players we have no match data for. The minimal profile shows only what the BWF ranking cache directly provides.
- Adding "minimal" entries to the BWF player index. The index stays match-driven; the dispatch happens at the page route.
- Changing the leaderboards page. Ranking rows stay clickable; they now reach a real page instead of a 404.

## Background — why 37% of BWF leaderboard clicks 404

The player page route does:

```ts
const index = await readIndexCache('bwf')
if (!index?.players[slug]) notFound()
```

`index-bwf.json` is built only from BWF tournaments we've actually scraped (the ones in `public/tournaments.txt`, which are mostly Thai-relevant junior international events). The BWF leaderboard Ranking tab pulls from `ranking-bwf.json`, which is the full BWF junior international ranking — players from anywhere who played in any BWF-counted tournament, not just the ones we scrape.

Confirmed from production:
- BWF ranking: 486 unique players
- BWF index: 551 players (some indexed players never made the top-50 of any ranking event)
- Overlap: 304
- **Ranked-but-not-indexed: 182 → all 404 today**

Example: ZHANG Jia Lun (BWF `globalPlayerId=8934872`) is #1 in Boy's singles U15 and #24 in Boy's singles U17, but `index-bwf.json` has no entry for `zhang_jia_lun`.

The ranking entry itself has everything we need to render something useful:

```jsonc
{
  "rank": 1, "name": "ZHANG Jia Lun", "slug": "zhang_jia_lun",
  "club": "China", "points": 4600, "tournaments": 0,
  "globalPlayerId": "8934872"
}
```

(Note: BWF's `club` field is the player's country, not a club. Index-based BWF records store country in a separate field for the same reason.)

## Architecture

The page route dispatches between two rendering paths based on whether the slug exists in the index. The full `PlayerProfileView` is unchanged. A new, small `MinimalPlayerProfile` component handles the index-miss case.

```
Page route decision:
  let rankings = collect from ranking-bwf.json by slug
  let record   = read from index-bwf.json by slug

  if record:                         → <PlayerProfileView>          (existing)
  else if rankings.length > 0:       → <MinimalPlayerProfile>       (NEW)
  else:                              → notFound()                   (existing fallthrough)
```

The "collect ranking entries by slug" loop is the same code path used today inside `if (currentRanking)`. We just hoist it above the dispatch so both branches share it. The SSR pre-fetch of `initialDetail` likewise moves above the dispatch.

### File changes

- `app/player/[provider]/[slug]/page.tsx` — hoist the ranking-entry collection and SSR pre-fetch above the dispatch; add the index-miss branch
- `components/MinimalPlayerProfile.tsx` (new, ~80 lines) — renders header + Current Ranking + RankingDetailTabs
- `__tests__/minimal-player-profile.test.tsx` (new) — render-shape unit test
- `lib/types.ts` — no change. We reuse `RankingPlayerRank`, `RankingPlayerDetail`, `Ranking`, `ProviderTag`.

### `MinimalPlayerProfile` contract

```ts
interface MinimalPlayerProfileProps {
  provider: ProviderTag          // typed open; in practice always 'bwf' today
  slug: string
  displayName: string            // ranking entry's `name`
  country: string                // ranking entry's `club` (BWF puts country here)
  playerRankings: RankingPlayerRank[]   // already non-empty when we render
  rankingPublishDate?: string
  initialDetail?: RankingPlayerDetail
  currentRanking?: Ranking | null
}
```

Renders:

1. **Back link.** Same `← Back` link + `goBack()` handler as the full profile (history fallback to `/leaderboards` when the user landed here directly). Implemented inline in the component, not extracted into a shared file — it's two lines.

2. **Header (`<div className="pp-hdr">`).**
   ```tsx
   <h1>{displayName}</h1>
   <div className="pp-meta">
     {country && <span>🌐 <strong>{country}</strong></span>}
   </div>
   ```
   We deliberately do NOT render the "🏸 N tournaments · M matches" line that the full profile shows — we don't have those numbers.

3. **Current Ranking section.** Direct copy of the existing JSX block from `PlayerProfileView.tsx` lines ~170-186 (the `<div className="pp-section pp-ranking-section">…</div>` block). Reuses the same `weekKeyFromPublishDate` helper.

4. **Ranking Detail panel.**
   ```tsx
   <RankingDetailTabs
     provider={provider}
     slug={slug}
     initialDetail={initialDetail}
     rankingPublishDate={rankingPublishDate}
     currentRanking={currentRanking}
   />
   ```

No KPI row, no By Event Type, no Tournament history, no Recent form, no Match character, no Opponents, no Partners. Those all need match data we don't have for these players.

### Page route changes

`app/player/[provider]/[slug]/page.tsx` — restructure:

```ts
export default async function PlayerPage({ params }: Props) {
  const provider = params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) notFound()

  const [index, currentRanking] = await Promise.all([
    readIndexCache(provider),
    readRankingCache(provider),
  ])
  const record = index?.players[params.slug]

  // Collect ranking-cache entries for this slug regardless of index hit.
  // (Today this only runs inside the `if (currentRanking)` block; we hoist
  // it so the index-miss branch can use it.)
  const playerRankings: RankingPlayerRank[] = []
  let rankingName = ''
  let rankingCountry = ''
  let bwfGlobalPlayerId = ''
  if (currentRanking) {
    for (const ev of currentRanking.events) {
      const entry = ev.entries.find(e => e.slug === params.slug)
      if (entry) {
        playerRankings.push({
          eventName: ev.eventName, rank: entry.rank, points: entry.points, tournaments: entry.tournaments,
        })
        if (entry.globalPlayerId) bwfGlobalPlayerId = entry.globalPlayerId
        if (!rankingName) rankingName = entry.name
        if (!rankingCountry) rankingCountry = entry.club
      }
    }
  }

  // 404 only when the slug is absent from BOTH index and ranking.
  if (!record && playerRankings.length === 0) notFound()

  // SSR pre-fetch initialDetail when we have an id. Runs for both branches.
  let initialDetail: RankingPlayerDetail | undefined
  let globalPlayerId = ''
  if (provider === 'bat') {
    const idEntry = await readPlayerIdEntry(params.slug)
    globalPlayerId = idEntry?.globalPlayerId ?? ''
  } else if (provider === 'bwf') {
    globalPlayerId = bwfGlobalPlayerId
  }
  if (globalPlayerId && currentRanking) {
    const cached = await readRankingPlayerDetail(provider, globalPlayerId)
    if (cached?.detail && cached.detail.publishDate === currentRanking.publishDate) {
      initialDetail = cached.detail
    }
  }

  const rankingPublishDate = currentRanking?.publishDate || undefined

  if (record) {
    return (
      <PlayerProfileView
        record={record}
        playerRankings={playerRankings.length ? playerRankings : undefined}
        rankingPublishDate={rankingPublishDate}
        initialDetail={initialDetail}
        currentRanking={currentRanking}
      />
    )
  }

  return (
    <MinimalPlayerProfile
      provider={provider}
      slug={params.slug}
      displayName={rankingName}
      country={rankingCountry}
      playerRankings={playerRankings}
      rankingPublishDate={rankingPublishDate}
      initialDetail={initialDetail}
      currentRanking={currentRanking}
    />
  )
}
```

The minimal-profile branch reaches: `Promise.all` (one extra readRankingCache call avoided by reusing the existing read) + the same ranking-loop + the same SSR pre-fetch + a smaller component. Same I/O cost as today's full-profile path.

## Sharp edges

1. **BWF `club` field is country, not club.** The render uses `🌐` (globe icon) and labels it visually as a country, matching how indexed BWF profiles show country. We don't try to be clever about provider-specific semantics in the component — the page route is the layer that knows BWF vs BAT and passes the field as `country`.

2. **`displayName` from the *first* ranking event.** A player can appear in multiple events with identical `name` strings (same upstream entry). The "first" choice is deterministic given the iteration order of `currentRanking.events`, which is the order BWF prints them — stable across publish dates.

3. **BAT slug absent from index.** The new branch *can* fire for BAT if a BAT-ranked player's slug somehow misses the index. In that case we render minimally with `country=''` (BAT entries don't have a country in the ranking cache). The Ranking Detail panel still works because the BAT branch of the detail route does its own discovery from the slug. This is a corner case — the BAT ranking entries we observed all map to indexed players — and the resulting page is still better than a 404.

4. **`tournaments: 0` in the ranking entry.** BWF reports this as the count of tournaments contributing to the ranking, not the player's total. For Zhang Jia Lun U17 it's `0` while he has actual ranking points — that's BWF's own bug. We don't render this field on the minimal profile, so it can't mislead.

5. **Empty country.** If for some reason the ranking entry's `club` is empty, the `country && <span>...</span>` guard hides the row. The header shows just the name.

6. **Hydration warning risk.** The page route hands `MinimalPlayerProfile` everything it needs by props. The component is a client component because it uses `useRouter` and the language context (same as `PlayerProfileView`). No state inferred from window globals — no hydration warning surface.

## Test plan

- `__tests__/minimal-player-profile.test.tsx` — Jest + RTL render with synthetic props:
  - Header renders displayName and country
  - Current Ranking section lists each `playerRankings` entry with rank, tournaments count, points
  - `<RankingDetailTabs>` receives the matched provider/slug/initialDetail/currentRanking props
- Manual smoke against prod (once shipped): visit `https://ezebat.lan/player/bwf/zhang_jia_lun`. Expect:
  - Header: `ZHANG Jia Lun` · `🌐 China`
  - Current Ranking: two rows — `Boy's singles U15 #1 4,600 pts`, `Boy's singles U17 #24 1,380 pts`
  - Ranking Detail panel renders the per-event sections from yesterday's PR

## What we are NOT doing

- Adding stub entries to `index-bwf.json` at build time. Keeps the index match-driven.
- Refactoring `PlayerProfileView` to share its header with `MinimalPlayerProfile` via an extracted component. The header is small; the deduplication isn't worth the abstraction.
- Touching the leaderboards page. Rows stay `<Link>`s; they now reach a real page for the 182 affected slugs.
- Special-casing combined-provider profiles.
- Caching the `displayName`/`country` extracted from the ranking. They're computed fresh on each request from the already-in-memory `currentRanking`.

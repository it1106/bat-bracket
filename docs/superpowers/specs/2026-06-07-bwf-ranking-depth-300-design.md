# BWF Ranking Ingestion Depth → Top 300

**Date:** 2026-06-07
**Status:** Approved (design)

## Problem

BWF (Badminton Asia Junior) player profiles drop a player's singles ranking
once the player falls outside the ingested window. Example: Dolthada Chanbai
is **#175 in Boy's Singles U17** on tournamentsoftware, but his batmatch.app
profile shows no singles ranking — only doubles (#66).

Root cause is in `app/api/ranking/[provider]/refresh/route.ts`:

```js
const TARGET    = provider === 'bwf' ? 100 : 500
const MAX_PAGES = provider === 'bwf' ? 1   : 5
```

BWF scrapes **one page (100 entries) per category**. Because ties are
front-loaded near the top of the BWF junior tables, those 100 entries only
reach ~rank 74 in BS U17. A player's rank is derived by finding their entry in
this ingested set (`page.tsx` server-side loop over `currentRanking.events`),
so anyone past the cutoff gets no rank for that event. Chanbai (#175,
~entry 179) is excluded → no singles ranking.

## What is already built (no change needed)

- **Leaderboard caps at top 100 for BWF:** `app/leaderboards/page.tsx`
  `RANKING_BOARD_LIMIT = { bat: 30, bwf: 100 }`, applied via
  `ev.entries.slice(0, RANKING_BOARD_LIMIT[provider])`.
- **Top 10 with "show more":** `components/LeaderboardsView.tsx`
  `BOARD_COLLAPSED_LIMIT = 10` plus a per-board expand/collapse toggle.

The original request ("calculate from top 300, show top 100, top 10 with show
more") therefore reduces to a single behavioural change: **ingest deeper for
BWF.** The display side is already correct.

## Decisions

- **Depth = 300 entries (3 pages).** Counted by rows, not rank-number. Ties are
  front-loaded, so 300 entries lands at ~rank 295 — comfortably past #175.
- **Scope: BWF only.** BAT already ingests up to 500; leave it untouched.
- **Leaderboard cap: BWF only, already in place** (top 100). Unchanged.
- **Payload: lean.** The 300-deep cache is kept server-side for rank lookup,
  but the full per-event entry list must NOT be serialized to the client.

## Design

### 1. Deepen BWF ingestion (required)

`app/api/ranking/[provider]/refresh/route.ts`:

```js
const TARGET    = provider === 'bwf' ? 300 : 500   // was 100
const MAX_PAGES = provider === 'bwf' ? 3   : 5     // was 1
```

Update the stale comment above the constants (it currently says BWF needs only
one page because "we only surface the top 10 on the leaderboards").

Effect: the BWF ranking cache stores up to 300 entries per category. The
existing server-side loop in `app/player/[provider]/[slug]/page.tsx` that builds
`playerRankings` now finds deep players, so:

- The "BWF Badminton Asia Ranking" list in `PlayerProfileView` /
  `MinimalPlayerProfile` (already rendered from `playerRankings`) gains the
  missing singles row automatically.

### 2. Keep the client payload flat (lean)

Today `currentRanking` (the full ranking cache: every event × every entry) is
threaded to the client through four levels — `page.tsx` →
`PlayerProfileView`/`MinimalPlayerProfile` → `RankingDetailTabs` →
`BwfRankingSection` — solely so `BwfRankingSection.lookupRank` can find the
player's own rank for the section header (`#175 · 230 pts`).

`BwfRankingSection.lookupRank` is the **only** client-side reader of
`currentRanking` (verified: the profile components just pass it through; the
`t.events.map` in `PlayerProfileView` is an unrelated tournament object). With
300 entries this blob would triple in size on every BWF player page.

**Change:** stop shipping `currentRanking` to the client and feed the section
header rank from the already-computed `playerRankings` instead.

- `app/player/[provider]/[slug]/page.tsx`: derive a small
  `rankByEvent: Record<string, number>` from `playerRankings`
  (`{ [eventName]: rank }`). Stop passing `currentRanking` to the profile
  components. (The full cache is still read server-side for the
  `playerRankings` loop — only the client prop is dropped.)
- `components/PlayerProfileView.tsx` and `components/MinimalPlayerProfile.tsx`:
  replace the `currentRanking` prop with `rankByEvent`; pass it to
  `RankingDetailTabs`.
- `components/RankingDetailTabs.tsx`: replace the `currentRanking` prop with
  `rankByEvent`; pass it to `BwfRankingSection`.
- `components/BwfRankingSection.tsx`: remove the `currentRanking` prop and
  `lookupRank`; accept `rankByEvent` and compute
  `myRank = rankByEvent[section.eventName] ?? null`.

This is strictly leaner than the "cap shipped list to 100" option discussed:
because `BwfRankingSection` was the sole consumer, dropping the prop removes the
blob entirely while keeping the header rank correct for deep players (#175).

**Correctness note:** the rank MUST come from `playerRankings` (server-computed
over the full 300). Merely trimming a shipped list without replacing
`lookupRank` would make deep players silently lose their header rank while still
appearing in the ranking list — a visible inconsistency.

### 3. Tests

- `__tests__/api-ranking-refresh-route.test.ts` — no current assertions on BWF
  depth, but re-run after the constant change.
- Grep for any test referencing `currentRanking` props on
  `RankingDetailTabs` / `BwfRankingSection` / profile components and update to
  the `rankByEvent` shape.
- Run the full suite; do not claim done until green.

## Out of scope

- BAT ingestion depth (already 500).
- Leaderboard display limits (already correct).
- Any change to rank numbers themselves — ranks are taken verbatim from
  tournamentsoftware; this change only widens which players are ingested.

## Risk / cost

- BWF refresh makes ~3× the category fetches (≈9 categories × 3 pages = ~27
  requests vs ~9). Runs on the weekly poll; acceptable.
- A player ranked beyond ~300 entries deep will still not show — accepted.

# BAT+BWF Unified Leaderboard Integration

**Date:** 2026-05-25  
**Status:** Approved

## Goal

Merge BAT and BWF player stats into a single unified leaderboard. A Thai player who competes in both BAT domestic tournaments and BWF events gets combined win counts, titles, court time, etc. in one leaderboard entry.

## Approach

Build-time merge into a new `combined` provider. BAT and BWF indexes remain intact. A merge step runs after both are built and writes `index-combined.json` + `leaderboards-combined.json`. The leaderboard page prefers the combined cache.

---

## Section 1: Types & Provider Extension

### `ProviderTag`
Extended from `'bat' | 'bwf'` to `'bat' | 'bwf' | 'combined'`.

### `LeaderboardEntry`
Gains an optional field:
```typescript
provider?: ProviderTag
```
When present, overrides `leaderboards.provider` for that entry's profile link. Required because combined boards mix BAT-canonical entries (`/player/bat/...`) and BWF-only entries (`/player/bwf/...`).

### `IdentityMatch` (new type in `lib/types.ts`)
```typescript
export interface IdentityMatch {
  batSlug: string
  bwfSlug: string
  confidence: number     // 0–1
  method: 'fuzzy'
  override?: boolean     // manually confirmed — not re-inferred
  rejected?: boolean     // manually marked false positive — skipped
}

export interface PlayerIdentityMap {
  generatedAt: string
  matches: IdentityMatch[]
}
```

---

## Section 2: Fuzzy Name Matching (`lib/player-identity.ts`)

### Scope
Only BWF players with `country === 'THA'` are candidates. BAT is Thai domestic, so cross-provider matches are Thai nationals only.

### Algorithm (per BAT player)
1. Collect BWF candidates filtered to `country === 'THA'`
2. Compute **Jaro-Winkler distance** on the full name string. Thai romanization preserves leading characters, which Jaro-Winkler weights more heavily — good fit for this domain.
3. Compute **best-token-pair score**: tokenize both names, find the highest Jaro-Winkler score across all token pairs. Handles partial-name overlaps.
4. Try all `altNames` variants on the BAT side; use the highest score found.
5. Final score = `max(jaro_winkler_full, best_token_pair)`
6. Accept if score ≥ 0.75; take the highest-scoring BWF candidate per BAT player.

### Identity Map File
Location: `.cache/players/player-identity-map.json`

```json
{
  "generatedAt": "2026-05-25T00:00:00.000Z",
  "matches": [
    {
      "batSlug": "สมชาย_ใจดี",
      "bwfSlug": "somchai_jaidee",
      "confidence": 0.91,
      "method": "fuzzy"
    },
    {
      "batSlug": "...",
      "bwfSlug": "...",
      "confidence": 0.78,
      "method": "fuzzy",
      "rejected": true
    }
  ]
}
```

On each rebuild: auto-inferred entries are re-generated fresh. Entries with `override: true` or `rejected: true` are loaded first and take precedence — they are never overwritten by inference.

---

## Section 3: Merge Logic (`lib/player-index-merge.ts`)

### Matched players (BAT slug ↔ BWF slug)
| Field | Resolution |
|---|---|
| `key` | `{ provider: 'bat', slug: batSlug }` — BAT is canonical |
| `displayName` | BAT displayName (Thai) |
| `altNames` | Union of both |
| `clubs` | From BAT |
| `country` | From BWF |
| `totals` | All fields summed |
| `byDiscipline` | wins/losses/titles/finals/semis summed per discipline |
| `titles`, `finals`, `semis` | Union sorted by `tournamentDateIso` descending |
| `tournaments` | Union sorted by date |
| `recentForm` | Merge, sort by `scheduledDateIso` descending, take top 10 |
| `matchCharacter` | Sum `courtMinutes`, `threeSetterCount`, `threeSetterWins`, `comebackWins`, `firstGameLost`, `matchesLast90`; re-derive rates; keep the longer `longestMatchRef`; keep the Final or more-recent `comebackWinRef` |
| `opponents` / `partners` | Merge maps by slug, sum meetings/wins/losses, re-sort, top 12 |
| `ranks` | Recomputed after all merging |

### BAT-only players
Included as-is. `LeaderboardEntry.provider = 'bat'`.

### BWF-only players (country=THA, no BAT match)
Included as-is. `LeaderboardEntry.provider = 'bwf'`. `primaryClub` falls back to `country` (no BAT club data available).

### BWF players with country ≠ THA
Excluded from combined index — no BAT footprint.

### Output
`buildIndex` variant returns `{ index: PlayerIndex, leaderboards: Leaderboards }` with `provider: 'combined'`, written to `index-combined.json` and `leaderboards-combined.json`.

---

## Section 4: Rebuild Integration (`lib/player-index-rebuild.ts`)

After the existing BAT and BWF build loops:

```
if both bat and bwf indexes exist on disk:
  load existing identity map (preserving overrides/rejections)
  run fuzzy matcher → new inferences
  merge: new inferences + existing overrides/rejections → updated map
  save .cache/players/player-identity-map.json
  run merge step → combined index + leaderboards
  write index-combined.json + leaderboards-combined.json
  add 'combined' to rebuilt[]
else if only bat index exists:
  skip combined build (no BWF data to merge)
  leaderboard page falls back to bat cache
```

The combined step is skipped if neither BAT nor BWF was rebuilt and the identity map is unchanged — same `sourceVersion` hashing pattern as today. If only one provider's index exists on disk, the combined build is skipped entirely and the leaderboard page falls back gracefully.

`player-index-cache.ts` gains:
- `readIdentityMap(): Promise<PlayerIdentityMap | null>`
- `writeIdentityMap(map: PlayerIdentityMap): Promise<void>`

The existing `readIndexCache` / `writeLeaderboardsCache` work for `'combined'` once `ProviderTag` is extended.

---

## Section 5: UI Changes

### `app/leaderboards/page.tsx`
Prefer combined cache, fall back gracefully:
```typescript
const combined = await readLeaderboardsCache('combined')
const bat = await readLeaderboardsCache('bat')
const bwf = await readLeaderboardsCache('bwf')
const lb = combined ?? bat ?? bwf ?? { ...empty }
```

### `components/LeaderboardsView.tsx`
Two small changes:
1. **Subtitle:** `combined` provider renders `"BAT+BWF"` instead of `"COMBINED"`:
   ```typescript
   const providerLabel = leaderboards.provider === 'combined' ? 'BAT+BWF' : leaderboards.provider.toUpperCase()
   ```
2. **Profile link:** use per-entry provider when present:
   ```typescript
   href={`/player/${e.provider ?? leaderboards.provider}/${e.slug}`}
   ```

No other UI changes — boards, tabs, and card layout are unchanged.

---

## Files Touched

| File | Change |
|---|---|
| `lib/types.ts` | Extend `ProviderTag`; add `IdentityMatch`, `PlayerIdentityMap`; add `provider?` to `LeaderboardEntry` |
| `lib/player-identity.ts` | New — fuzzy matcher |
| `lib/player-index-merge.ts` | New — merge two PlayerIndexes into combined |
| `lib/player-index-cache.ts` | Add `readIdentityMap` / `writeIdentityMap` |
| `lib/player-index-rebuild.ts` | Add combined build step after BAT+BWF |
| `app/leaderboards/page.tsx` | Prefer combined cache |
| `components/LeaderboardsView.tsx` | Subtitle label + per-entry provider link |

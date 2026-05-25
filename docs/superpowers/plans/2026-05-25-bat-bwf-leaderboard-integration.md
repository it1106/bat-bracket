# BAT+BWF Unified Leaderboard Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge BAT and BWF player stats into a single unified leaderboard where Thai players who compete in both get combined stats.

**Architecture:** Build-time merge — after BAT and BWF indexes are built, a fuzzy name-matcher identifies the same player across both systems, and a merge step produces `index-combined.json` + `leaderboards-combined.json`. The leaderboard page prefers the combined cache.

**Tech Stack:** TypeScript, Jest, Next.js (App Router), no new external dependencies (Jaro-Winkler implemented inline).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/types.ts` | Modify | Extend `ProviderTag`; add `IdentityMatch`, `PlayerIdentityMap`; add `provider?` to `LeaderboardEntry` |
| `lib/playerIndex.ts` | Modify | Extract `buildLeaderboards()` as exported function for reuse |
| `lib/player-identity.ts` | Create | Jaro-Winkler fuzzy matcher + `buildIdentityMap()` |
| `lib/player-index-cache.ts` | Modify | Add `readIdentityMap` / `writeIdentityMap` |
| `lib/player-index-merge.ts` | Create | `buildCombinedIndex()` — merges two PlayerIndexes using an identity map |
| `lib/player-index-rebuild.ts` | Modify | Add combined build step after BAT+BWF loop |
| `app/leaderboards/page.tsx` | Modify | Prefer combined cache, fall back to bat → bwf |
| `components/LeaderboardsView.tsx` | Modify | Per-entry provider link; "BAT+BWF" subtitle label |
| `__tests__/player-identity.test.ts` | Create | Tests for fuzzy matcher and buildIdentityMap |
| `__tests__/player-index-merge.test.ts` | Create | Tests for buildCombinedIndex |
| `__tests__/player-index-cache.test.ts` | Modify | Add identity map round-trip tests |
| `__tests__/player-index-rebuild.test.ts` | Modify | Add combined build step test |
| `__tests__/LeaderboardsView.test.tsx` | Modify | Cover combined provider subtitle + per-entry provider link |

---

## Task 1: Extend types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add `'combined'` to `ProviderTag`, extend `LeaderboardEntry`, add identity types**

  In `lib/types.ts`, make these three changes:

  Change line:
  ```typescript
  export type ProviderTag = 'bat' | 'bwf'
  ```
  to:
  ```typescript
  export type ProviderTag = 'bat' | 'bwf' | 'combined'
  ```

  In `LeaderboardEntry`, add one optional field after `qualifier?`:
  ```typescript
  export interface LeaderboardEntry {
    rank: number
    slug: string
    name: string
    primaryClub: string
    value: number
    display: string
    qualifier?: string
    provider?: ProviderTag   // per-entry override for profile link; used by combined leaderboard
  }
  ```

  Add two new interfaces at the bottom of `lib/types.ts`:
  ```typescript
  export interface IdentityMatch {
    batSlug: string
    bwfSlug: string
    confidence: number       // 0–1
    method: 'fuzzy'
    override?: boolean       // manually confirmed — not re-inferred on next build
    rejected?: boolean       // manually marked false positive — always skipped
  }

  export interface PlayerIdentityMap {
    generatedAt: string
    matches: IdentityMatch[]
  }
  ```

- [ ] **Step 2: Verify existing tests still pass**

  ```bash
  npx jest --testPathPattern="playerIndex|leaderboards|player-index-cache" --no-coverage
  ```
  Expected: all passing (type changes are backwards-compatible — `provider?` is optional, `'combined'` extends the union).

- [ ] **Step 3: Commit**

  ```bash
  git add lib/types.ts
  git commit -m "feat(types): extend ProviderTag with combined; add IdentityMatch types; add LeaderboardEntry.provider"
  ```

---

## Task 2: Extract `buildLeaderboards` from `playerIndex.ts`

**Files:**
- Modify: `lib/playerIndex.ts`

The leaderboard-building code inside `buildIndex` (lines 423–500) needs to be a standalone exported function so `buildCombinedIndex` (Task 5) can call it without re-implementing the 12 specs.

- [ ] **Step 1: Extract the leaderboard block into an exported function**

  In `lib/playerIndex.ts`, add this import to the top (it's already imported, just confirming):
  ```typescript
  import type {
    Discipline, MatchEntry, ProviderTag,
    PlayerIndex, PlayerRecord, PlayerMatchRef, PlayerIndexTournamentInput,
    Leaderboards, LeaderboardBoard, DisciplineSummary, PlayerEventResult, PlayerRanks,
  } from './types'
  ```

  Add this new exported function **before** `buildIndex`:
  ```typescript
  export function buildLeaderboards(
    provider: ProviderTag,
    players: Record<string, PlayerRecord>,
  ): Leaderboards {
    const leaderboards: Leaderboards = {
      version: 1, provider,
      generatedAt: FIXED_GENERATED_AT,
      sourceVersion: '',
      boards: [],
    }

    type Spec = {
      id: string; titleKey: string; icon: string;
      category: LeaderboardBoard['category']; qualifier?: string;
      qualifies: (p: PlayerRecord) => boolean;
      value: (p: PlayerRecord) => number;
      display: (n: number, p: PlayerRecord) => string;
      rankField: keyof PlayerRanks;
    }
    const fmtPct = (n: number) => `${Math.round(n * 100)}%`
    const fmtHours = (n: number) => {
      if (n < 60) return `${n}m`
      const h = Math.floor(n / 60); const m = n % 60
      return m === 0 ? `${h}h` : `${h}h ${m}m`
    }
    const fmtInt = (n: number) => `${n}`

    const specs: Spec[] = [
      { id: 'headline.titles', titleKey: 'lbMostTitles', icon: '🏆', category: 'headline',
        qualifies: () => true, value: p => p.titles.length, display: fmtInt, rankField: 'titles' },
      { id: 'headline.wins', titleKey: 'lbMostWins', icon: '🥇', category: 'headline',
        qualifies: () => true, value: p => p.totals.wins, display: fmtInt, rankField: 'wins' },
      { id: 'headline.winPct', titleKey: 'lbHighestWinPct', icon: '📊', category: 'headline', qualifier: 'min20',
        qualifies: p => p.totals.matches >= 20,
        value: p => p.totals.wins / Math.max(1, p.totals.matches),
        display: fmtPct, rankField: 'winPct' },
      { id: 'headline.courtTime', titleKey: 'lbMostCourtTime', icon: '⏱', category: 'headline',
        qualifies: p => p.matchCharacter.courtMinutes > 0,
        value: p => p.matchCharacter.courtMinutes, display: fmtHours, rankField: 'courtTime' },
      { id: 'discipline.singles.wins', titleKey: 'lbBestSingles', icon: '🎯', category: 'discipline', qualifier: 'min10',
        qualifies: p => (p.byDiscipline.singles.wins + p.byDiscipline.singles.losses) >= 10,
        value: p => p.byDiscipline.singles.wins, display: fmtInt, rankField: 'bestSingles' },
      { id: 'discipline.doubles.wins', titleKey: 'lbBestDoubles', icon: '🤝', category: 'discipline', qualifier: 'min10',
        qualifies: p => (p.byDiscipline.doubles.wins + p.byDiscipline.doubles.losses) >= 10,
        value: p => p.byDiscipline.doubles.wins, display: fmtInt, rankField: 'bestDoubles' },
      { id: 'discipline.mixed.wins', titleKey: 'lbBestMixed', icon: '🧑‍🤝‍🧑', category: 'discipline', qualifier: 'min10',
        qualifies: p => (p.byDiscipline.mixed.wins + p.byDiscipline.mixed.losses) >= 10,
        value: p => p.byDiscipline.mixed.wins, display: fmtInt, rankField: 'bestMixed' },
      { id: 'character.threeSetterWins', titleKey: 'lbThreeSetterWins', icon: '🔥', category: 'character',
        qualifies: () => true, value: p => p.matchCharacter.threeSetterWins, display: fmtInt, rankField: 'threeSetterWins' },
      { id: 'character.comebacks', titleKey: 'lbComebackWins', icon: '🔁', category: 'character',
        qualifies: () => true, value: p => p.matchCharacter.comebackWins, display: fmtInt, rankField: 'comebackWins' },
      { id: 'character.deciderRecord', titleKey: 'lbDeciderRecord', icon: '⚖️', category: 'character', qualifier: 'min5',
        qualifies: p => p.matchCharacter.threeSetterCount >= 5,
        value: p => p.matchCharacter.threeSetterWins / Math.max(1, p.matchCharacter.threeSetterCount),
        display: fmtPct, rankField: 'deciderRecord' },
      { id: 'activity.matchesLast90', titleKey: 'lbMatchesLast90', icon: '📅', category: 'activity',
        qualifies: p => p.matchCharacter.matchesLast90 > 0,
        value: p => p.matchCharacter.matchesLast90, display: fmtInt, rankField: 'matchesLast90' },
      { id: 'activity.tournamentsEntered', titleKey: 'lbTournamentsEntered', icon: '🏟', category: 'activity',
        qualifies: () => true, value: p => p.tournaments.length, display: fmtInt, rankField: 'tournamentsEntered' },
    ]

    const boards: LeaderboardBoard[] = []
    const playerList = Object.values(players)
    for (const spec of specs) {
      const scored = playerList
        .filter(spec.qualifies)
        .map(p => ({ p, v: spec.value(p) }))
        .filter(x => x.v > 0)
        .sort((a, b) => b.v - a.v || a.p.key.slug.localeCompare(b.p.key.slug))
        .slice(0, 25)
      const entries = scored.map((x, i) => ({
        rank: i + 1,
        slug: x.p.key.slug,
        name: x.p.displayName,
        primaryClub: x.p.clubs[0] || x.p.country || '',
        value: x.v,
        display: spec.display(x.v, x.p),
        qualifier: spec.qualifier,
      }))
      boards.push({ id: spec.id, titleKey: spec.titleKey, icon: spec.icon, category: spec.category, qualifier: spec.qualifier, entries })
      for (const e of entries) {
        players[e.slug].ranks[spec.rankField] = e.rank
      }
    }

    leaderboards.boards = boards
    return leaderboards
  }
  ```

- [ ] **Step 2: Replace the leaderboard block inside `buildIndex` with a call to `buildLeaderboards`**

  In `buildIndex`, replace the entire section from `const leaderboards: Leaderboards = {` through `leaderboards.boards = boards` (lines ~412–500) with:

  ```typescript
  const leaderboards = buildLeaderboards(provider, players)
  ```

  The `return { index, leaderboards }` line stays as-is.

- [ ] **Step 3: Verify all leaderboard tests still pass**

  ```bash
  npx jest --testPathPattern="playerIndex.leaderboards" --no-coverage
  ```
  Expected: all passing (behaviour identical, just refactored).

- [ ] **Step 4: Commit**

  ```bash
  git add lib/playerIndex.ts
  git commit -m "refactor(playerIndex): extract buildLeaderboards as exported function"
  ```

---

## Task 3: Implement fuzzy name matcher

**Files:**
- Create: `lib/player-identity.ts`
- Create: `__tests__/player-identity.test.ts`

- [ ] **Step 1: Write failing tests**

  Create `__tests__/player-identity.test.ts`:
  ```typescript
  import { computeSimilarity, buildIdentityMap } from '@/lib/player-identity'
  import type { PlayerIndex, PlayerRecord, PlayerIdentityMap } from '@/lib/types'

  function mkRecord(slug: string, name: string, country?: string, altNames: string[] = []): PlayerRecord {
    return {
      key: { provider: country ? 'bwf' : 'bat', slug },
      displayName: name, altNames, clubs: [], country,
      totals: { matches: 0, wins: 0, losses: 0, walkoversReceived: 0, walkoversGiven: 0, retirementsReceived: 0, retirementsGiven: 0 },
      byDiscipline: {
        singles: { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 },
        doubles: { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 },
        mixed:   { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 },
      },
      titles: [], finals: [], semis: [], tournaments: [], recentForm: [],
      matchCharacter: { courtMinutes: 0, avgMatchMinutes: 0, longestMatchMinutes: 0, longestMatchRef: null, threeSetterCount: 0, threeSetterRate: 0, threeSetterWins: 0, comebackWins: 0, firstGameLost: 0, comebackWinRef: null, matchesLast90: 0 },
      opponents: [], partners: [], ranks: {},
    }
  }

  function mkIndex(records: PlayerRecord[], provider: 'bat' | 'bwf'): PlayerIndex {
    const players: Record<string, PlayerRecord> = {}
    for (const r of records) players[r.key.slug] = r
    return { version: 1, provider, generatedAt: 'T', sourceVersion: 'v', sources: [], totalPlayers: records.length, totalMatches: 0, players }
  }

  describe('computeSimilarity', () => {
    it('returns 1 for identical strings', () => {
      expect(computeSimilarity('somchai', 'somchai')).toBe(1)
    })

    it('returns high score for close romanized names', () => {
      expect(computeSimilarity('somchai jaidee', 'somchai jaidee')).toBeGreaterThanOrEqual(0.75)
    })

    it('returns low score for unrelated names', () => {
      expect(computeSimilarity('somchai', 'ratchanok')).toBeLessThan(0.75)
    })

    it('is case-insensitive', () => {
      expect(computeSimilarity('Somchai', 'somchai')).toBe(1)
    })

    it('uses token-pair score to match partial name overlap', () => {
      // "wanchai" token vs "wanchai intanon" — the "wanchai" token alone should score high
      expect(computeSimilarity('wanchai', 'wanchai intanon')).toBeGreaterThanOrEqual(0.75)
    })
  })

  describe('buildIdentityMap', () => {
    it('matches a BAT player to a BWF player above threshold', () => {
      const bat = mkIndex([mkRecord('somchai_jaidee', 'Somchai Jaidee')], 'bat')
      const bwf = mkIndex([mkRecord('somchai_jaidee_bwf', 'Somchai Jaidee', 'THA')], 'bwf')
      const map = buildIdentityMap(bat, bwf, null)
      expect(map.matches).toHaveLength(1)
      expect(map.matches[0].batSlug).toBe('somchai_jaidee')
      expect(map.matches[0].bwfSlug).toBe('somchai_jaidee_bwf')
      expect(map.matches[0].confidence).toBeGreaterThanOrEqual(0.75)
    })

    it('does not match BAT players against non-THA BWF players', () => {
      const bat = mkIndex([mkRecord('lee_chong_wei', 'Lee Chong Wei')], 'bat')
      const bwf = mkIndex([mkRecord('lee_chong_wei_bwf', 'Lee Chong Wei', 'MAS')], 'bwf')
      const map = buildIdentityMap(bat, bwf, null)
      expect(map.matches).toHaveLength(0)
    })

    it('does not match when similarity is below 0.75', () => {
      const bat = mkIndex([mkRecord('player_a', 'Aaaa Bbbb')], 'bat')
      const bwf = mkIndex([mkRecord('player_b', 'Zzzz Xxxx', 'THA')], 'bwf')
      const map = buildIdentityMap(bat, bwf, null)
      expect(map.matches).toHaveLength(0)
    })

    it('preserves existing override entries and does not re-infer them', () => {
      const bat = mkIndex([mkRecord('somchai_jaidee', 'Somchai Jaidee')], 'bat')
      const bwf = mkIndex([mkRecord('sc_jaidee', 'Somchai Jaidee', 'THA')], 'bwf')
      const existing: PlayerIdentityMap = {
        generatedAt: 'T',
        matches: [{ batSlug: 'somchai_jaidee', bwfSlug: 'manual_override', confidence: 1, method: 'fuzzy', override: true }],
      }
      const map = buildIdentityMap(bat, bwf, existing)
      const m = map.matches.find(x => x.batSlug === 'somchai_jaidee')
      expect(m?.bwfSlug).toBe('manual_override')
      expect(m?.override).toBe(true)
    })

    it('preserves rejected entries', () => {
      const bat = mkIndex([mkRecord('somchai_jaidee', 'Somchai Jaidee')], 'bat')
      const bwf = mkIndex([mkRecord('sc_jaidee', 'Somchai Jaidee', 'THA')], 'bwf')
      const existing: PlayerIdentityMap = {
        generatedAt: 'T',
        matches: [{ batSlug: 'somchai_jaidee', bwfSlug: 'sc_jaidee', confidence: 0.9, method: 'fuzzy', rejected: true }],
      }
      const map = buildIdentityMap(bat, bwf, existing)
      const m = map.matches.find(x => x.batSlug === 'somchai_jaidee')
      expect(m?.rejected).toBe(true)
    })
  })
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  npx jest __tests__/player-identity.test.ts --no-coverage
  ```
  Expected: FAIL — `Cannot find module '@/lib/player-identity'`

- [ ] **Step 3: Implement `lib/player-identity.ts`**

  Create `lib/player-identity.ts`:
  ```typescript
  import type { PlayerIndex, PlayerIdentityMap, IdentityMatch } from './types'

  function jaro(s1: string, s2: string): number {
    if (s1 === s2) return 1
    const l1 = s1.length, l2 = s2.length
    if (l1 === 0 || l2 === 0) return 0
    const matchDist = Math.max(Math.floor(Math.max(l1, l2) / 2) - 1, 0)
    const s1m = new Array<boolean>(l1).fill(false)
    const s2m = new Array<boolean>(l2).fill(false)
    let matches = 0
    for (let i = 0; i < l1; i++) {
      const start = Math.max(0, i - matchDist)
      const end = Math.min(i + matchDist + 1, l2)
      for (let j = start; j < end; j++) {
        if (s2m[j] || s1[i] !== s2[j]) continue
        s1m[i] = true; s2m[j] = true; matches++; break
      }
    }
    if (matches === 0) return 0
    let trans = 0, k = 0
    for (let i = 0; i < l1; i++) {
      if (!s1m[i]) continue
      while (!s2m[k]) k++
      if (s1[i] !== s2[k]) trans++
      k++
    }
    return (matches / l1 + matches / l2 + (matches - trans / 2) / matches) / 3
  }

  function jaroWinkler(s1: string, s2: string): number {
    const j = jaro(s1, s2)
    let prefix = 0
    for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
      if (s1[i] === s2[i]) prefix++; else break
    }
    return j + prefix * 0.1 * (1 - j)
  }

  function bestTokenPairScore(a: string, b: string): number {
    const ta = a.split(/\s+/).filter(Boolean)
    const tb = b.split(/\s+/).filter(Boolean)
    let best = 0
    for (const x of ta) for (const y of tb) {
      const s = jaroWinkler(x, y)
      if (s > best) best = s
    }
    return best
  }

  export function computeSimilarity(a: string, b: string): number {
    const al = a.toLowerCase().trim()
    const bl = b.toLowerCase().trim()
    return Math.max(jaroWinkler(al, bl), bestTokenPairScore(al, bl))
  }

  const THRESHOLD = 0.75

  export function buildIdentityMap(
    batIndex: PlayerIndex,
    bwfIndex: PlayerIndex,
    existing: PlayerIdentityMap | null,
  ): PlayerIdentityMap {
    // Preserve overrides and rejections; they take precedence over fresh inference
    const pinned = new Map<string, IdentityMatch>()
    for (const m of existing?.matches ?? []) {
      if (m.override || m.rejected) pinned.set(m.batSlug, m)
    }

    const bwfTha = Object.values(bwfIndex.players).filter(p => p.country === 'THA')

    const matches: IdentityMatch[] = [...pinned.values()]

    for (const batPlayer of Object.values(batIndex.players)) {
      if (pinned.has(batPlayer.key.slug)) continue

      const batNames = [batPlayer.displayName, ...batPlayer.altNames].filter(Boolean)
      let bestScore = 0
      let bestBwfSlug = ''

      for (const bwfPlayer of bwfTha) {
        const bwfNames = [bwfPlayer.displayName, ...bwfPlayer.altNames].filter(Boolean)
        for (const bn of batNames) {
          for (const wn of bwfNames) {
            const score = computeSimilarity(bn, wn)
            if (score > bestScore) { bestScore = score; bestBwfSlug = bwfPlayer.key.slug }
          }
        }
      }

      if (bestScore >= THRESHOLD && bestBwfSlug) {
        matches.push({ batSlug: batPlayer.key.slug, bwfSlug: bestBwfSlug, confidence: bestScore, method: 'fuzzy' })
      }
    }

    return { generatedAt: '__GENERATED_AT__', matches }
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  ```bash
  npx jest __tests__/player-identity.test.ts --no-coverage
  ```
  Expected: all PASS

- [ ] **Step 5: Commit**

  ```bash
  git add lib/player-identity.ts __tests__/player-identity.test.ts
  git commit -m "feat(player-identity): Jaro-Winkler fuzzy matcher and buildIdentityMap"
  ```

---

## Task 4: Add identity map to cache

**Files:**
- Modify: `lib/player-index-cache.ts`
- Modify: `__tests__/player-index-cache.test.ts`

- [ ] **Step 1: Add failing tests for identity map round-trip**

  In `__tests__/player-index-cache.test.ts`, add after the existing `'round-trips leaderboards'` test:
  ```typescript
  import {
    readIndexCache, writeIndexCache,
    readLeaderboardsCache, writeLeaderboardsCache,
    readIdentityMap, writeIdentityMap,
    __setPlayersRootForTesting,
  } from '@/lib/player-index-cache'
  import type { PlayerIndex, Leaderboards, PlayerIdentityMap } from '@/lib/types'
  ```
  (Update the existing import line at the top of the file to include `readIdentityMap, writeIdentityMap`.)

  Add these tests inside the existing `describe('player-index-cache', ...)` block:
  ```typescript
  it('returns null for identity map when file is missing', async () => {
    expect(await readIdentityMap()).toBeNull()
  })

  it('round-trips an identity map', async () => {
    const map: PlayerIdentityMap = {
      generatedAt: '2026-05-25T00:00:00.000Z',
      matches: [
        { batSlug: 'bat_slug', bwfSlug: 'bwf_slug', confidence: 0.92, method: 'fuzzy' },
        { batSlug: 'other', bwfSlug: 'other_bwf', confidence: 0.80, method: 'fuzzy', override: true },
      ],
    }
    await writeIdentityMap(map)
    const out = await readIdentityMap()
    expect(out?.matches).toHaveLength(2)
    expect(out?.matches[1].override).toBe(true)
  })
  ```

- [ ] **Step 2: Run tests to confirm the new ones fail**

  ```bash
  npx jest __tests__/player-index-cache.test.ts --no-coverage
  ```
  Expected: FAIL — `readIdentityMap is not a function`

- [ ] **Step 3: Add identity map functions to `lib/player-index-cache.ts`**

  Add after the existing `lbPath` function:
  ```typescript
  function identityMapPath(): string { return path.join(root, 'player-identity-map.json') }
  ```

  Add at the bottom of the file, after `writeLeaderboardsCache`:
  ```typescript
  export async function readIdentityMap(): Promise<import('./types').PlayerIdentityMap | null> {
    return readJsonMemo<import('./types').PlayerIdentityMap>(identityMapPath())
  }

  export async function writeIdentityMap(map: import('./types').PlayerIdentityMap): Promise<void> {
    await writeJson(identityMapPath(), map)
  }
  ```

  Add `PlayerIdentityMap` to the import at the top of `lib/player-index-cache.ts`:
  ```typescript
  import type { PlayerIndex, Leaderboards, ProviderTag, PlayerIdentityMap } from './types'
  ```

  Then replace the inline `import('./types').PlayerIdentityMap` references with just `PlayerIdentityMap`.

- [ ] **Step 4: Run tests to confirm they pass**

  ```bash
  npx jest __tests__/player-index-cache.test.ts --no-coverage
  ```
  Expected: all PASS

- [ ] **Step 5: Commit**

  ```bash
  git add lib/player-index-cache.ts __tests__/player-index-cache.test.ts
  git commit -m "feat(player-index-cache): add readIdentityMap / writeIdentityMap"
  ```

---

## Task 5: Implement combined index builder

**Files:**
- Create: `lib/player-index-merge.ts`
- Create: `__tests__/player-index-merge.test.ts`

- [ ] **Step 1: Write failing tests**

  Create `__tests__/player-index-merge.test.ts`:
  ```typescript
  import { buildCombinedIndex } from '@/lib/player-index-merge'
  import type { PlayerIndex, PlayerRecord, PlayerIdentityMap } from '@/lib/types'

  function mkRecord(slug: string, opts: {
    provider?: 'bat' | 'bwf'
    country?: string
    wins?: number
    losses?: number
    matches?: number
    titles?: number
    courtMinutes?: number
    avgMatchMinutes?: number
    threeSetterCount?: number
    threeSetterWins?: number
    matchesLast90?: number
  } = {}): PlayerRecord {
    const wins = opts.wins ?? 0
    const losses = opts.losses ?? 0
    const matches = opts.matches ?? wins + losses
    const titles = opts.titles ?? 0
    return {
      key: { provider: opts.provider ?? 'bat', slug },
      displayName: slug, altNames: [], clubs: opts.provider === 'bat' ? ['Club A'] : [], country: opts.country,
      totals: { matches, wins, losses, walkoversReceived: 0, walkoversGiven: 0, retirementsReceived: 0, retirementsGiven: 0 },
      byDiscipline: {
        singles: { wins, losses, titles, finals: 0, semis: 0 },
        doubles: { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 },
        mixed:   { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 },
      },
      titles: Array.from({ length: titles }, (_, i) => ({
        tournamentId: `t${i}`, eventId: 'e1', eventName: 'MS', discipline: 'singles' as const,
        bestFinish: 'Champion' as const, wins: 1, losses: 0, tournamentDateIso: `2026-0${i + 1}-01`,
      })),
      finals: [], semis: [], tournaments: [], recentForm: [],
      matchCharacter: {
        courtMinutes: opts.courtMinutes ?? 0, avgMatchMinutes: opts.avgMatchMinutes ?? 0,
        longestMatchMinutes: 0, longestMatchRef: null,
        threeSetterCount: opts.threeSetterCount ?? 0, threeSetterRate: 0,
        threeSetterWins: opts.threeSetterWins ?? 0,
        comebackWins: 0, firstGameLost: 0, comebackWinRef: null,
        matchesLast90: opts.matchesLast90 ?? 0,
      },
      opponents: [], partners: [], ranks: {},
    }
  }

  function mkIndex(records: PlayerRecord[], provider: 'bat' | 'bwf'): PlayerIndex {
    const players: Record<string, PlayerRecord> = {}
    for (const r of records) players[r.key.slug] = r
    return { version: 1, provider, generatedAt: 'T', sourceVersion: 'v1', sources: [], totalPlayers: records.length, totalMatches: 0, players }
  }

  const emptyMap: PlayerIdentityMap = { generatedAt: 'T', matches: [] }

  describe('buildCombinedIndex', () => {
    it('merges matched players summing wins and losses', () => {
      const bat = mkIndex([mkRecord('player_a', { provider: 'bat', wins: 10, losses: 5 })], 'bat')
      const bwf = mkIndex([mkRecord('player_bwf', { provider: 'bwf', country: 'THA', wins: 3, losses: 2 })], 'bwf')
      const map: PlayerIdentityMap = {
        generatedAt: 'T',
        matches: [{ batSlug: 'player_a', bwfSlug: 'player_bwf', confidence: 0.9, method: 'fuzzy' }],
      }
      const { index } = buildCombinedIndex(bat, bwf, map)
      expect(index.players['player_a'].totals.wins).toBe(13)
      expect(index.players['player_a'].totals.losses).toBe(7)
    })

    it('merged player uses BAT slug as canonical key', () => {
      const bat = mkIndex([mkRecord('bat_slug', { provider: 'bat', wins: 5, losses: 2 })], 'bat')
      const bwf = mkIndex([mkRecord('bwf_slug', { provider: 'bwf', country: 'THA', wins: 2, losses: 1 })], 'bwf')
      const map: PlayerIdentityMap = {
        generatedAt: 'T',
        matches: [{ batSlug: 'bat_slug', bwfSlug: 'bwf_slug', confidence: 0.9, method: 'fuzzy' }],
      }
      const { index } = buildCombinedIndex(bat, bwf, map)
      expect(index.players['bat_slug']).toBeDefined()
      expect(index.players['bwf_slug']).toBeUndefined()
    })

    it('BAT-only player passes through unchanged', () => {
      const bat = mkIndex([mkRecord('bat_only', { provider: 'bat', wins: 8, losses: 3 })], 'bat')
      const bwf = mkIndex([], 'bwf')
      const { index } = buildCombinedIndex(bat, bwf, emptyMap)
      expect(index.players['bat_only'].totals.wins).toBe(8)
    })

    it('BWF-only Thai player is included', () => {
      const bat = mkIndex([], 'bat')
      const bwf = mkIndex([mkRecord('thai_only', { provider: 'bwf', country: 'THA', wins: 5, losses: 2 })], 'bwf')
      const { index } = buildCombinedIndex(bat, bwf, emptyMap)
      expect(index.players['thai_only']).toBeDefined()
    })

    it('BWF player with country != THA is excluded', () => {
      const bat = mkIndex([], 'bat')
      const bwf = mkIndex([mkRecord('idn_player', { provider: 'bwf', country: 'IDN', wins: 10, losses: 2 })], 'bwf')
      const { index } = buildCombinedIndex(bat, bwf, emptyMap)
      expect(index.players['idn_player']).toBeUndefined()
    })

    it('rejected match is not merged', () => {
      const bat = mkIndex([mkRecord('bat_p', { provider: 'bat', wins: 5, losses: 1 })], 'bat')
      const bwf = mkIndex([mkRecord('bwf_p', { provider: 'bwf', country: 'THA', wins: 3, losses: 1 })], 'bwf')
      const map: PlayerIdentityMap = {
        generatedAt: 'T',
        matches: [{ batSlug: 'bat_p', bwfSlug: 'bwf_p', confidence: 0.9, method: 'fuzzy', rejected: true }],
      }
      const { index } = buildCombinedIndex(bat, bwf, map)
      expect(index.players['bat_p'].totals.wins).toBe(5)
    })

    it('leaderboard entries for BAT/merged players have provider=bat', () => {
      const bat = mkIndex([mkRecord('bat_p', { provider: 'bat', wins: 20, losses: 5, matches: 25 })], 'bat')
      const bwf = mkIndex([], 'bwf')
      const { leaderboards } = buildCombinedIndex(bat, bwf, emptyMap)
      const winsBoard = leaderboards.boards.find(b => b.id === 'headline.wins')
      expect(winsBoard?.entries[0]?.provider).toBe('bat')
    })

    it('leaderboard entries for BWF-only Thai players have provider=bwf', () => {
      const bat = mkIndex([], 'bat')
      const bwf = mkIndex([mkRecord('thai_p', { provider: 'bwf', country: 'THA', wins: 20, losses: 5, matches: 25 })], 'bwf')
      const { leaderboards } = buildCombinedIndex(bat, bwf, emptyMap)
      const winsBoard = leaderboards.boards.find(b => b.id === 'headline.wins')
      expect(winsBoard?.entries[0]?.provider).toBe('bwf')
    })

    it('merged player titles are unioned', () => {
      const bat = mkIndex([mkRecord('bat_p', { provider: 'bat', wins: 10, losses: 2, titles: 2 })], 'bat')
      const bwf = mkIndex([mkRecord('bwf_p', { provider: 'bwf', country: 'THA', wins: 5, losses: 1, titles: 1 })], 'bwf')
      const map: PlayerIdentityMap = {
        generatedAt: 'T',
        matches: [{ batSlug: 'bat_p', bwfSlug: 'bwf_p', confidence: 0.9, method: 'fuzzy' }],
      }
      const { index } = buildCombinedIndex(bat, bwf, map)
      expect(index.players['bat_p'].titles).toHaveLength(3)
    })

    it('combined index has provider=combined', () => {
      const bat = mkIndex([], 'bat')
      const bwf = mkIndex([], 'bwf')
      const { index } = buildCombinedIndex(bat, bwf, emptyMap)
      expect(index.provider).toBe('combined')
    })
  })
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  npx jest __tests__/player-index-merge.test.ts --no-coverage
  ```
  Expected: FAIL — `Cannot find module '@/lib/player-index-merge'`

- [ ] **Step 3: Implement `lib/player-index-merge.ts`**

  Create `lib/player-index-merge.ts`:
  ```typescript
  import { createHash } from 'crypto'
  import type {
    PlayerIndex, PlayerRecord, Leaderboards, PlayerIdentityMap,
    DisciplineSummary, PlayerMatchRef, OpponentRecord, PartnerRecord,
  } from './types'
  import { buildLeaderboards } from './playerIndex'

  function mergeDisc(a: DisciplineSummary, b: DisciplineSummary): DisciplineSummary {
    return { wins: a.wins + b.wins, losses: a.losses + b.losses, titles: a.titles + b.titles, finals: a.finals + b.finals, semis: a.semis + b.semis }
  }

  function mergeRecentForm(a: PlayerMatchRef[], b: PlayerMatchRef[]): PlayerMatchRef[] {
    return [...a, ...b]
      .sort((x, y) => (y.scheduledDateIso || '').localeCompare(x.scheduledDateIso || ''))
      .slice(0, 10)
  }

  function mergeMatchCharacter(
    a: PlayerRecord['matchCharacter'],
    b: PlayerRecord['matchCharacter'],
    mergedTotals: PlayerRecord['totals'],
  ): PlayerRecord['matchCharacter'] {
    const courtMinutes = a.courtMinutes + b.courtMinutes
    const withDurA = a.avgMatchMinutes > 0 ? Math.round(a.courtMinutes / a.avgMatchMinutes) : 0
    const withDurB = b.avgMatchMinutes > 0 ? Math.round(b.courtMinutes / b.avgMatchMinutes) : 0
    const withDur = withDurA + withDurB
    const avgMatchMinutes = withDur > 0 ? Math.round(courtMinutes / withDur) : 0
    const threeSetterCount = a.threeSetterCount + b.threeSetterCount
    const threeSetterWins = a.threeSetterWins + b.threeSetterWins
    const decidedMatches = mergedTotals.matches - mergedTotals.walkoversReceived - mergedTotals.walkoversGiven
    const threeSetterRate = decidedMatches > 0 ? threeSetterCount / decidedMatches : 0
    const longestMatchMinutes = Math.max(a.longestMatchMinutes, b.longestMatchMinutes)
    const longestMatchRef = a.longestMatchMinutes >= b.longestMatchMinutes ? a.longestMatchRef : b.longestMatchRef
    const comebackWins = a.comebackWins + b.comebackWins
    let comebackWinRef = a.comebackWinRef
    if (!comebackWinRef) { comebackWinRef = b.comebackWinRef }
    else if (b.comebackWinRef) {
      if (b.comebackWinRef.round === 'Final' && a.comebackWinRef?.round !== 'Final') comebackWinRef = b.comebackWinRef
      else if ((b.comebackWinRef.scheduledDateIso || '') > (a.comebackWinRef?.scheduledDateIso || '')) comebackWinRef = b.comebackWinRef
    }
    return {
      courtMinutes, avgMatchMinutes, longestMatchMinutes, longestMatchRef,
      threeSetterCount, threeSetterRate, threeSetterWins,
      comebackWins, firstGameLost: a.firstGameLost + b.firstGameLost,
      comebackWinRef, matchesLast90: a.matchesLast90 + b.matchesLast90,
    }
  }

  function mergeOpponents(a: OpponentRecord[], b: OpponentRecord[]): OpponentRecord[] {
    const map = new Map<string, OpponentRecord>()
    for (const r of [...a, ...b]) {
      const e = map.get(r.slug)
      if (!e) { map.set(r.slug, { ...r }); continue }
      e.meetings += r.meetings; e.wins += r.wins; e.losses += r.losses
    }
    return Array.from(map.values())
      .sort((x, y) => y.meetings - x.meetings || y.wins - x.wins || x.slug.localeCompare(y.slug))
      .slice(0, 12)
  }

  function mergePartners(a: PartnerRecord[], b: PartnerRecord[]): PartnerRecord[] {
    const map = new Map<string, PartnerRecord>()
    for (const r of [...a, ...b]) {
      const e = map.get(r.slug)
      if (!e) { map.set(r.slug, { ...r }); continue }
      e.matchesTogether += r.matchesTogether; e.wins += r.wins; e.losses += r.losses
    }
    return Array.from(map.values())
      .sort((x, y) => y.matchesTogether - x.matchesTogether || y.wins - x.wins || x.slug.localeCompare(y.slug))
      .slice(0, 12)
  }

  function mergePlayerRecords(bat: PlayerRecord, bwf: PlayerRecord): PlayerRecord {
    const totals = {
      matches: bat.totals.matches + bwf.totals.matches,
      wins: bat.totals.wins + bwf.totals.wins,
      losses: bat.totals.losses + bwf.totals.losses,
      walkoversReceived: bat.totals.walkoversReceived + bwf.totals.walkoversReceived,
      walkoversGiven: bat.totals.walkoversGiven + bwf.totals.walkoversGiven,
      retirementsReceived: bat.totals.retirementsReceived + bwf.totals.retirementsReceived,
      retirementsGiven: bat.totals.retirementsGiven + bwf.totals.retirementsGiven,
    }
    const altNames = [...new Set([...bat.altNames, bwf.displayName, ...bwf.altNames])].filter(n => n !== bat.displayName)
    const sortByDate = <T extends { tournamentDateIso: string }>(arr: T[]) =>
      arr.sort((a, b) => b.tournamentDateIso.localeCompare(a.tournamentDateIso))
    return {
      key: bat.key,
      displayName: bat.displayName,
      altNames,
      clubs: bat.clubs,
      country: bwf.country,
      totals,
      byDiscipline: {
        singles: mergeDisc(bat.byDiscipline.singles, bwf.byDiscipline.singles),
        doubles: mergeDisc(bat.byDiscipline.doubles, bwf.byDiscipline.doubles),
        mixed:   mergeDisc(bat.byDiscipline.mixed,   bwf.byDiscipline.mixed),
      },
      titles:      sortByDate([...bat.titles,      ...bwf.titles]),
      finals:      sortByDate([...bat.finals,      ...bwf.finals]),
      semis:       sortByDate([...bat.semis,        ...bwf.semis]),
      tournaments: sortByDate([...bat.tournaments, ...bwf.tournaments]),
      recentForm: mergeRecentForm(bat.recentForm, bwf.recentForm),
      matchCharacter: mergeMatchCharacter(bat.matchCharacter, bwf.matchCharacter, totals),
      opponents: mergeOpponents(bat.opponents, bwf.opponents),
      partners:  mergePartners(bat.partners,  bwf.partners),
      ranks: {},
    }
  }

  export function buildCombinedIndex(
    batIndex: PlayerIndex,
    bwfIndex: PlayerIndex,
    identityMap: PlayerIdentityMap,
  ): { index: PlayerIndex; leaderboards: Leaderboards } {
    const bwfToBat = new Map<string, string>()
    const batToBwf = new Map<string, string>()
    for (const m of identityMap.matches) {
      if (m.rejected) continue
      bwfToBat.set(m.bwfSlug, m.batSlug)
      batToBwf.set(m.batSlug, m.bwfSlug)
    }

    const players: Record<string, PlayerRecord> = {}
    const batSlugs = new Set(Object.keys(batIndex.players))

    for (const [slug, batPlayer] of Object.entries(batIndex.players)) {
      const bwfSlug = batToBwf.get(slug)
      const bwfPlayer = bwfSlug ? bwfIndex.players[bwfSlug] : undefined
      players[slug] = bwfPlayer ? mergePlayerRecords(batPlayer, bwfPlayer) : { ...batPlayer }
    }

    for (const [slug, bwfPlayer] of Object.entries(bwfIndex.players)) {
      if (bwfPlayer.country !== 'THA') continue
      if (bwfToBat.has(slug)) continue
      players[slug] = { ...bwfPlayer }
    }

    const index: PlayerIndex = {
      version: 1,
      provider: 'combined',
      generatedAt: '__GENERATED_AT__',
      sourceVersion: '',
      sources: [...batIndex.sources, ...bwfIndex.sources],
      totalPlayers: Object.keys(players).length,
      totalMatches: batIndex.totalMatches + bwfIndex.totalMatches,
      players,
    }

    const leaderboards = buildLeaderboards('combined', players)

    for (const board of leaderboards.boards) {
      for (const entry of board.entries) {
        entry.provider = batSlugs.has(entry.slug) ? 'bat' : 'bwf'
      }
    }

    return { index, leaderboards }
  }

  export function combinedSourceVersion(batSV: string, bwfSV: string): string {
    return createHash('sha256').update(`combined|${batSV}|${bwfSV}`).digest('hex')
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  ```bash
  npx jest __tests__/player-index-merge.test.ts --no-coverage
  ```
  Expected: all PASS

- [ ] **Step 5: Commit**

  ```bash
  git add lib/player-index-merge.ts __tests__/player-index-merge.test.ts
  git commit -m "feat(player-index-merge): buildCombinedIndex merges BAT+BWF player stats"
  ```

---

## Task 6: Wire combined build into `rebuildAll`

**Files:**
- Modify: `lib/player-index-rebuild.ts`
- Modify: `__tests__/player-index-rebuild.test.ts`

- [ ] **Step 1: Add failing test for combined build**

  In `__tests__/player-index-rebuild.test.ts`, add to the mock setup at the top:
  ```typescript
  jest.mock('../lib/player-index-cache', () => ({
    readIndexCache: jest.fn(),
    writeIndexCache: jest.fn(),
    writeLeaderboardsCache: jest.fn(),
    readIdentityMap: jest.fn(),
    writeIdentityMap: jest.fn(),
  }))
  ```
  (Replace the existing `jest.mock('../lib/player-index-cache', ...)` block with this expanded version.)

  Add to the existing imports:
  ```typescript
  import { readIndexCache, writeIndexCache, writeLeaderboardsCache, readIdentityMap, writeIdentityMap } from '@/lib/player-index-cache'
  ```
  (Update the existing import line.)

  Add `beforeEach` reset for the new mocks (add inside the existing `beforeEach`):
  ```typescript
  ;(readIdentityMap as jest.Mock).mockResolvedValue(null)
  ;(writeIdentityMap as jest.Mock).mockResolvedValue(undefined)
  ```

  Add this test at the end of the `describe('rebuildAll', ...)` block:
  ```typescript
  it('builds combined index when both bat and bwf rebuild', async () => {
    ;(listAllTournaments as jest.Mock).mockReturnValue([
      { id: 'ID_BAT', provider: 'bat', done: false },
      { id: 'ID_BWF', provider: 'bwf', done: false },
    ])
    ;(readFullCache as jest.Mock).mockResolvedValue({ days: [], groups: [], currentDate: '2026-05-01' })
    ;(readClubsCache as jest.Mock).mockResolvedValue({})
    ;(readIndexCache as jest.Mock).mockResolvedValue(null)
    const out = await rebuildAll()
    expect(out.rebuilt).toContain('combined')
    expect(writeIdentityMap).toHaveBeenCalled()
    expect(writeLeaderboardsCache).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'combined' })
    )
  })
  ```

- [ ] **Step 2: Run tests to confirm the new one fails**

  ```bash
  npx jest __tests__/player-index-rebuild.test.ts --no-coverage
  ```
  Expected: existing tests PASS, new combined test FAIL.

- [ ] **Step 3: Add combined step to `lib/player-index-rebuild.ts`**

  Add these imports at the top:
  ```typescript
  import { readIdentityMap, writeIdentityMap } from '@/lib/player-index-cache'
  import { buildIdentityMap } from '@/lib/player-identity'
  import { buildCombinedIndex, combinedSourceVersion } from '@/lib/player-index-merge'
  import type { PlayerIndex } from '@/lib/types'
  ```

  Inside `rebuildAll`, just after the `for (const provider of PROVIDERS)` loop ends (after `rebuilt.push(provider)` / the catch), and before `return { rebuilt, skipped }`, add:

  ```typescript
  // Combined step: runs if both bat and bwf indexes are available
  try {
    const batIdx = builtIndexes.get('bat') ?? await readIndexCache('bat')
    const bwfIdx = builtIndexes.get('bwf') ?? await readIndexCache('bwf')
    if (batIdx && bwfIdx) {
      const existingMap = await readIdentityMap()
      const identityMap = buildIdentityMap(batIdx, bwfIdx, existingMap)
      identityMap.generatedAt = new Date().toISOString()
      await writeIdentityMap(identityMap)

      const sv = combinedSourceVersion(batIdx.sourceVersion, bwfIdx.sourceVersion)
      const existingCombined = await readIndexCache('combined')
      if (existingCombined && existingCombined.sourceVersion === sv) {
        skipped.push('combined')
      } else {
        const { index, leaderboards } = buildCombinedIndex(batIdx, bwfIdx, identityMap)
        const now = new Date().toISOString()
        index.generatedAt = now
        leaderboards.generatedAt = now
        index.sourceVersion = sv
        leaderboards.sourceVersion = sv
        await writeIndexCache(index)
        await writeLeaderboardsCache(leaderboards)
        rebuilt.push('combined')
      }
    } else {
      skipped.push('combined')
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[player-index-rebuild] failed provider=combined err=${msg}`)
    skipped.push('combined')
  }
  ```

  Also add a `builtIndexes` map at the top of the inner async function, and populate it in the loop. Find where `await writeIndexCache(index)` is called and add `builtIndexes.set(provider, index)` before it:

  At the start of the inner async function (just after `const rebuilt: ProviderTag[] = []`):
  ```typescript
  const builtIndexes = new Map<ProviderTag, PlayerIndex>()
  ```

  In the loop, after `const { index, leaderboards } = buildIndex(provider, inputs)` and before `await writeIndexCache(index)`:
  ```typescript
  builtIndexes.set(provider, index)
  ```

- [ ] **Step 4: Run all rebuild tests**

  ```bash
  npx jest __tests__/player-index-rebuild.test.ts --no-coverage
  ```
  Expected: all PASS

- [ ] **Step 5: Commit**

  ```bash
  git add lib/player-index-rebuild.ts __tests__/player-index-rebuild.test.ts
  git commit -m "feat(rebuild): add combined BAT+BWF build step to rebuildAll"
  ```

---

## Task 7: Update UI — leaderboard page and view

**Files:**
- Modify: `app/leaderboards/page.tsx`
- Modify: `components/LeaderboardsView.tsx`
- Modify: `__tests__/LeaderboardsView.test.tsx`
- Modify: `app/api/leaderboards/route.ts`

- [ ] **Step 1: Update `app/leaderboards/page.tsx` to prefer combined cache**

  Replace the entire file content with:
  ```typescript
  import { readLeaderboardsCache } from '@/lib/player-index-cache'
  import LeaderboardsView from '@/components/LeaderboardsView'
  import type { Leaderboards } from '@/lib/types'

  export default async function LeaderboardsPage() {
    const combined = await readLeaderboardsCache('combined')
    const bat = await readLeaderboardsCache('bat')
    const bwf = await readLeaderboardsCache('bwf')
    const lb: Leaderboards = combined ?? bat ?? bwf ?? {
      version: 1, provider: 'bat', generatedAt: 'never', sourceVersion: '', boards: [],
    }
    return <LeaderboardsView leaderboards={lb} />
  }

  export const dynamic = 'force-dynamic'
  ```

- [ ] **Step 2: Update `components/LeaderboardsView.tsx`**

  Find the subtitle line:
  ```tsx
  <div className="lb-sub">{leaderboards.provider.toUpperCase()} · {leaderboards.boards.length} boards</div>
  ```
  Replace with:
  ```tsx
  <div className="lb-sub">{leaderboards.provider === 'combined' ? 'BAT+BWF' : leaderboards.provider.toUpperCase()} · {leaderboards.boards.length} boards</div>
  ```

  Find the profile link inside the entries map:
  ```tsx
  <Link key={e.slug} href={`/player/${leaderboards.provider}/${e.slug}`}
  ```
  Replace with:
  ```tsx
  <Link key={e.slug} href={`/player/${e.provider ?? leaderboards.provider}/${e.slug}`}
  ```

- [ ] **Step 3: Update `app/api/leaderboards/route.ts` to accept `combined`**

  Find:
  ```typescript
  const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])
  ```
  Replace with:
  ```typescript
  const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf', 'combined'])
  ```

- [ ] **Step 4: Update `__tests__/LeaderboardsView.test.tsx`**

  Add these two tests inside the existing `describe('LeaderboardsView', ...)` block:
  ```typescript
  it('shows BAT+BWF subtitle for combined provider', () => {
    const combined = { ...sample, provider: 'combined' as const }
    renderLB(combined)
    expect(screen.getByText(/BAT\+BWF/)).toBeTruthy()
  })

  it('uses per-entry provider for profile links', () => {
    const withProvider = {
      ...sample,
      provider: 'combined' as const,
      boards: [{
        ...sample.boards[0],
        entries: [
          { rank: 1, slug: 'a', name: 'Anuwat', primaryClub: 'Bangkok BC', value: 12, display: '12', provider: 'bat' as const },
          { rank: 2, slug: 'b', name: 'Boon', primaryClub: 'Hat Yai', value: 9, display: '9', provider: 'bwf' as const },
        ],
      }],
    }
    renderLB(withProvider)
    const links = document.querySelectorAll('a[href*="/player/"]')
    const hrefs = Array.from(links).map(l => l.getAttribute('href'))
    expect(hrefs).toContain('/player/bat/a')
    expect(hrefs).toContain('/player/bwf/b')
  })
  ```

- [ ] **Step 5: Run all affected tests**

  ```bash
  npx jest __tests__/LeaderboardsView.test.tsx __tests__/api-leaderboards-route.test.ts --no-coverage
  ```
  Expected: all PASS

- [ ] **Step 6: Run full test suite to check for regressions**

  ```bash
  npx jest --no-coverage
  ```
  Expected: all PASS

- [ ] **Step 7: Commit**

  ```bash
  git add app/leaderboards/page.tsx components/LeaderboardsView.tsx app/api/leaderboards/route.ts __tests__/LeaderboardsView.test.tsx
  git commit -m "feat(leaderboards): prefer combined BAT+BWF cache; per-entry provider links"
  ```

---

## Verification

After all tasks complete, trigger a rebuild and check the leaderboard:

```bash
# Rebuild indexes (requires both bat and bwf tournament data to be cached)
curl -X POST http://localhost:3000/api/players/rebuild

# Confirm combined cache was written
ls -la .cache/players/
# Expected: index-combined.json  leaderboards-combined.json  player-identity-map.json

# Check the identity map to see matches
cat .cache/players/player-identity-map.json | npx --yes prettier --parser json | head -40

# Visit the leaderboard page
open http://localhost:3000/leaderboards
# Expected: subtitle shows "BAT+BWF · 12 boards"
```

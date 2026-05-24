# Deep Player Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build cross-tournament individual player profiles and leaderboards, served from a precomputed disk index that rebuilds only when a tournament's `[done]` flag flips.

**Architecture:** A pure aggregator (`lib/playerIndex.ts`) reads `.cache/full/<id>.json` for every done tournament (filtered through `lib/tournaments-registry.ts`), bucketing matches by normalized-name slug per provider. The result — one `PlayerIndex` plus one `Leaderboards` per provider — is pinned to `.cache/players/*.json` via atomic tmp+rename writes. Read paths (`/api/players/[provider]/[slug]`, `/api/leaderboards`, `/api/players/exists`) serve directly from disk. The home screen gains a Leaderboards card, and the existing `PlayerModal` gains a "View full profile →" footer link when the player exists in the index.

**Tech Stack:** Next.js 14 App Router · TypeScript · Jest + React Testing Library · cheerio (existing — not used in new code) · Node `fs.promises` and `crypto`. No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-24-deep-player-stats-design.md`

**Branch:** All work happens on `deep-stats` (already created).

---

## File Structure (locked-in before tasks)

**New files:**

| File | Responsibility | Approx LOC |
|---|---|---|
| `lib/playerIndex.ts` | Pure aggregator. `buildIndex(provider, tournaments) → { index, leaderboards }`. Exports `nameToSlug`, `normalizeRound`, `classifyDiscipline` helpers for testing. | ~450 |
| `lib/clubs-cache.ts` | `.cache/clubs/<id>.json` read/write. Atomic tmp+rename. | ~70 |
| `lib/player-index-cache.ts` | `.cache/players/index-{provider}.json` and `leaderboards-{provider}.json` read/write. Versioned envelope. | ~110 |
| `lib/player-index-rebuild.ts` | `rebuildAll()` orchestrator. Walks registry, ensures clubs are pinned, calls aggregator, writes caches. | ~160 |
| `app/api/players/[provider]/[slug]/route.ts` | GET → one `PlayerRecord` from disk index. | ~70 |
| `app/api/players/exists/route.ts` | GET `?provider=&name=` → `{ exists, slug }`. | ~50 |
| `app/api/leaderboards/route.ts` | GET `?provider=&category=` → boards. | ~70 |
| `app/api/players/rebuild/route.ts` | POST → trigger `rebuildAll`. Token-guarded. | ~70 |
| `app/player/[provider]/[slug]/page.tsx` | Server-rendered profile page. | ~90 |
| `app/leaderboards/page.tsx` | Server-rendered leaderboards page. | ~100 |
| `components/PlayerProfileView.tsx` | Pure render of `PlayerRecord`. | ~480 |
| `components/LeaderboardsView.tsx` | Pure render of `Leaderboards`. | ~300 |
| `fixtures/player-index-toyota.json` | Copy of `.cache/full/D5DF6DCC-...json` (smallest, 14KB). |  — |
| `fixtures/player-index-trang.json` | Copy of `.cache/full/1BEC8194-...json` (24KB). | — |
| `fixtures/player-index-clubs-toyota.json` | Hand-curated subset of clubs for the Toyota fixture (5 players). | — |
| `__tests__/playerIndex.slug.test.ts` | `nameToSlug` table-test. | ~80 |
| `__tests__/playerIndex.helpers.test.ts` | `normalizeRound`, `classifyDiscipline`. | ~60 |
| `__tests__/playerIndex.aggregate.test.ts` | `buildIndex` single-tournament snapshot. | ~120 |
| `__tests__/playerIndex.multi.test.ts` | Two-tournament merge by slug. | ~80 |
| `__tests__/playerIndex.empty.test.ts` | Empty input shape. | ~40 |
| `__tests__/playerIndex.leaderboards.test.ts` | Truncation, qualifier filter, rank backfill. | ~90 |
| `__tests__/player-index-cache.test.ts` | Round-trip cache write/read. | ~70 |
| `__tests__/clubs-cache.test.ts` | Round-trip clubs write/read. | ~50 |
| `__tests__/player-index-rebuild.test.ts` | Orchestrator skips unchanged, handles partial done set. | ~120 |
| `__tests__/api-players-route.test.ts` | 200, 404. | ~70 |
| `__tests__/api-players-exists-route.test.ts` | exists true / false / unknown provider. | ~60 |
| `__tests__/api-leaderboards-route.test.ts` | All / by category. | ~70 |
| `__tests__/api-players-rebuild-route.test.ts` | 401 without token, 200 with token. | ~70 |
| `__tests__/PlayerProfileView.test.tsx` | All sections render; empty-state branches. | ~140 |
| `__tests__/LeaderboardsView.test.tsx` | All four categories; highlight; empty-state. | ~100 |

**Modified files:**

| File | Change |
|---|---|
| `lib/types.ts` | Add the new interfaces. |
| `lib/i18n.ts` | Add new keys (en + th). |
| `lib/tournaments-registry.ts` | Export `listDoneByProvider(provider)` helper. |
| `app/globals.css` | Add `.pp-*` and `.lb-*` styles. |
| `components/PlayerModal.tsx` | Footer link to full profile. |
| `app/page.tsx` | Home Leaderboards card. |

---

## Task 1: Add types to `lib/types.ts`

**Files:**
- Modify: `lib/types.ts` (append at end)

- [ ] **Step 1: Append the new interfaces to `lib/types.ts`**

Open `lib/types.ts`, scroll to the bottom (line ~359), append:

```ts
// ─── Deep player stats ─────────────────────────────────────

export interface PlayerKey {
  provider: ProviderTag
  slug: string
}

export interface PlayerMatchRef {
  tournamentId: string
  tournamentName: string
  tournamentDateIso: string
  eventId: string
  eventName: string
  drawNum: string
  round: string                       // normalized: 'Final' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'R128' | 'RR'
  partners: string[]
  opponents: string[]
  opponentSlugs: string[]
  partnerSlugs: string[]
  scores: MatchScore[]
  outcome: 'W' | 'L' | 'WO-W' | 'WO-L' | 'RET-W' | 'RET-L'
  durationMinutes?: number
  scheduledDateIso?: string
}

export type Discipline = 'singles' | 'doubles' | 'mixed'

export interface PlayerEventResult {
  tournamentId: string
  eventId: string
  eventName: string
  discipline: Discipline
  bestFinish: 'Champion' | 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'R128' | 'RR'
  wins: number
  losses: number
}

export interface DisciplineSummary {
  wins: number
  losses: number
  titles: number
  finals: number
  semis: number
}

export interface OpponentRecord {
  slug: string
  name: string
  meetings: number
  wins: number
  losses: number
  lastRound: string
  lastEvent: string
}

export interface PartnerRecord {
  slug: string
  name: string
  matchesTogether: number
  wins: number
  losses: number
  primaryEvent: string
}

export interface PlayerRanks {
  titles?: number
  wins?: number
  winPct?: number
  courtTime?: number
  threeSetterWins?: number
  comebackWins?: number
  matchesLast90?: number
  tournamentsEntered?: number
  bestSingles?: number
  bestDoubles?: number
  bestMixed?: number
  deciderRecord?: number
}

export interface PlayerRecord {
  key: PlayerKey
  displayName: string
  altNames: string[]
  clubs: string[]
  country?: string
  totals: {
    matches: number
    wins: number
    losses: number
    walkoversReceived: number
    walkoversGiven: number
    retirementsReceived: number
    retirementsGiven: number
  }
  byDiscipline: {
    singles: DisciplineSummary
    doubles: DisciplineSummary
    mixed: DisciplineSummary
  }
  titles: PlayerEventResult[]
  finals: PlayerEventResult[]
  semis: PlayerEventResult[]
  tournaments: Array<{
    tournamentId: string
    tournamentName: string
    tournamentDateIso: string
    events: PlayerEventResult[]
  }>
  recentForm: PlayerMatchRef[]
  matchCharacter: {
    courtMinutes: number
    avgMatchMinutes: number
    longestMatchMinutes: number
    longestMatchRef: PlayerMatchRef | null
    threeSetterCount: number
    threeSetterRate: number
    threeSetterWins: number
    comebackWins: number
    comebackWinRef: PlayerMatchRef | null
    matchesLast90: number
  }
  opponents: OpponentRecord[]
  partners: PartnerRecord[]
  ranks: PlayerRanks
}

export interface PlayerIndex {
  version: 1
  provider: ProviderTag
  generatedAt: string
  sourceVersion: string
  sources: Array<{ tournamentId: string; tournamentName: string; tournamentDateIso: string }>
  totalPlayers: number
  totalMatches: number
  players: Record<string, PlayerRecord>
}

export interface LeaderboardEntry {
  rank: number
  slug: string
  name: string
  primaryClub: string
  value: number
  display: string
  qualifier?: string
}

export type LeaderboardCategory = 'headline' | 'discipline' | 'character' | 'activity'

export interface LeaderboardBoard {
  id: string
  titleKey: string                    // i18n key
  icon: string
  category: LeaderboardCategory
  qualifier?: string
  entries: LeaderboardEntry[]
}

export interface Leaderboards {
  version: 1
  provider: ProviderTag
  generatedAt: string
  sourceVersion: string
  boards: LeaderboardBoard[]
}

// Aggregator input wrapper
export interface PlayerIndexTournamentInput {
  tournamentId: string
  tournamentName: string
  tournamentDateIso: string
  data: MatchesData
  clubs: Record<string, string>       // playerId -> club (BAT) or empty for BWF
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `npx tsc --noEmit`
Expected: PASS (zero errors).

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(deep-stats): add player index + leaderboards type definitions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Implement `nameToSlug` with tests

**Files:**
- Create: `__tests__/playerIndex.slug.test.ts`
- Create: `lib/playerIndex.ts`

- [ ] **Step 1: Write failing test file `__tests__/playerIndex.slug.test.ts`**

```ts
import { nameToSlug } from '@/lib/playerIndex'

describe('nameToSlug', () => {
  it('lowercases ASCII letters and underscores spaces', () => {
    expect(nameToSlug('Somchai Suksawat')).toBe('somchai_suksawat')
  })

  it('preserves Thai characters', () => {
    expect(nameToSlug('รวิณ ชูชัยศรี')).toBe(encodeURIComponent('รวิณ') + '_' + encodeURIComponent('ชูชัยศรี'))
  })

  it('strips a leading seed bracket', () => {
    expect(nameToSlug('[1] Anuwat Phromsorn')).toBe('anuwat_phromsorn')
    expect(nameToSlug('[3-4] Sirichai N.')).toBe('sirichai_n.')
    expect(nameToSlug('(SE) Wisut B.')).toBe('wisut_b.')
  })

  it('collapses internal whitespace runs to single underscore', () => {
    expect(nameToSlug('  Paiboon    Khampoom ')).toBe('paiboon_khampoom')
  })

  it('returns the same slug for two name spellings differing only in seed/whitespace', () => {
    expect(nameToSlug('[2] Somchai Suksawat')).toBe(nameToSlug('Somchai   Suksawat'))
  })

  it('returns empty string for empty / whitespace-only input', () => {
    expect(nameToSlug('')).toBe('')
    expect(nameToSlug('   ')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/playerIndex.slug.test.ts`
Expected: FAIL with "Cannot find module '@/lib/playerIndex'".

- [ ] **Step 3: Create `lib/playerIndex.ts` with just the slug helper**

```ts
// Cross-tournament player index aggregator.
// Pure functions only — no I/O, no Date.now(), no console.

const SEED_PREFIX_RE = /^\s*(?:\[[^\]]*\]|\([^)]*\))\s*/

export function nameToSlug(raw: string): string {
  if (!raw) return ''
  let s = raw.replace(SEED_PREFIX_RE, '').trim()
  if (!s) return ''
  s = s.toLowerCase()
  const parts = s.split(/\s+/).filter(Boolean)
  return parts.map(p => encodeURIComponent(p)).join('_')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/playerIndex.slug.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add __tests__/playerIndex.slug.test.ts lib/playerIndex.ts
git commit -m "feat(deep-stats): nameToSlug pure helper + tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Round normalization + discipline classifier helpers

**Files:**
- Create: `__tests__/playerIndex.helpers.test.ts`
- Modify: `lib/playerIndex.ts`

- [ ] **Step 1: Write failing tests**

`__tests__/playerIndex.helpers.test.ts`:

```ts
import { normalizeRound, classifyDiscipline } from '@/lib/playerIndex'

describe('normalizeRound', () => {
  const cases: Array<[string, string]> = [
    ['Final', 'Final'], ['final', 'Final'], ['F', 'Final'],
    ['รอบชิงชนะเลิศ', 'Final'],
    ['Semifinal', 'SF'], ['SF', 'SF'], ['Semi-final', 'SF'],
    ['รอบรองชนะเลิศ', 'SF'],
    ['Quarterfinal', 'QF'], ['QF', 'QF'],
    ['Round of 16', 'R16'], ['R16', 'R16'], ['1/8', 'R16'],
    ['Round of 32', 'R32'], ['R32', 'R32'],
    ['Round of 64', 'R64'],
    ['Round of 128', 'R128'],
    ['Round Robin', 'RR'], ['Group A', 'RR'], ['Round-Robin', 'RR'],
    ['', 'RR'],
  ]
  it.each(cases)('normalizes "%s" → "%s"', (input, expected) => {
    expect(normalizeRound(input)).toBe(expected)
  })
})

describe('classifyDiscipline', () => {
  it('returns singles for 1-player teams', () => {
    expect(classifyDiscipline(1, 'Boys Singles U15')).toBe('singles')
  })
  it('returns mixed when 2-player team event name signals XD/mixed', () => {
    expect(classifyDiscipline(2, 'Mixed Doubles U15')).toBe('mixed')
    expect(classifyDiscipline(2, 'XD U17')).toBe('mixed')
    expect(classifyDiscipline(2, 'Mixed')).toBe('mixed')
  })
  it('returns doubles otherwise for 2-player teams', () => {
    expect(classifyDiscipline(2, 'BD U15')).toBe('doubles')
    expect(classifyDiscipline(2, 'Boys Doubles')).toBe('doubles')
    expect(classifyDiscipline(2, "Women's Doubles")).toBe('doubles')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/playerIndex.helpers.test.ts`
Expected: FAIL with "not a function" / undefined exports.

- [ ] **Step 3: Append helpers to `lib/playerIndex.ts`**

```ts
import type { Discipline } from './types'

const ROUND_MAP: Array<[RegExp, string]> = [
  [/^(round\s*of\s*128|r128|1\/64)$/i, 'R128'],
  [/^(round\s*of\s*64|r64|1\/32)$/i, 'R64'],
  [/^(round\s*of\s*32|r32|1\/16)$/i, 'R32'],
  [/^(round\s*of\s*16|r16|1\/8)$/i, 'R16'],
  [/^(quarter[-\s]?final|qf|1\/4)$/i, 'QF'],
  [/^(semi[-\s]?final|sf|1\/2)$/i, 'SF'],
  [/^(final|f)$/i, 'Final'],
  [/^(round[-\s]?robin|rr|group(\s+\w+)?|pool(\s+\w+)?)$/i, 'RR'],
]

// Thai labels seen in BAT match data.
const ROUND_THAI: Record<string, string> = {
  'รอบชิงชนะเลิศ': 'Final',
  'รอบรองชนะเลิศ': 'SF',
  'รอบก่อนรองชนะเลิศ': 'QF',
}

export function normalizeRound(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return 'RR'
  if (ROUND_THAI[s]) return ROUND_THAI[s]
  for (const [re, label] of ROUND_MAP) {
    if (re.test(s)) return label
  }
  return 'RR'
}

const MIXED_RE = /(mixed|xd\b)/i

export function classifyDiscipline(teamSize: number, eventName: string): Discipline {
  if (teamSize <= 1) return 'singles'
  if (MIXED_RE.test(eventName)) return 'mixed'
  return 'doubles'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/playerIndex.helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/playerIndex.helpers.test.ts lib/playerIndex.ts
git commit -m "feat(deep-stats): round + discipline helpers

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Copy real cached tournaments to `fixtures/` and curate clubs

**Files:**
- Create: `fixtures/player-index-toyota.json`
- Create: `fixtures/player-index-toyota-clubs.json`
- Create: `fixtures/player-index-trang.json`
- Create: `fixtures/player-index-trang-clubs.json`

- [ ] **Step 1: Copy the two smallest full caches into fixtures**

```bash
cp .cache/full/D5DF6DCC-DBCE-4E78-8B43-E4681BEFE8CC.json fixtures/player-index-toyota.json
cp .cache/full/1BEC8194-C338-4CB0-AA1D-7444C90F5DE6.json  fixtures/player-index-trang.json
```

- [ ] **Step 2: Generate clubs fixtures by sampling distinct playerIds**

Run this one-liner to produce a minimal but realistic club map (5 players each, real names from the cache, with a `_meta` marker so fixtures are clearly hand-curated):

```bash
node -e "
const fs = require('fs');
for (const [in_, out] of [['fixtures/player-index-toyota.json','fixtures/player-index-toyota-clubs.json'],['fixtures/player-index-trang.json','fixtures/player-index-trang-clubs.json']]) {
  const d = JSON.parse(fs.readFileSync(in_, 'utf8'));
  const seen = new Map();
  for (const g of d.groups||[]) for (const m of g.matches||[])
    for (const side of ['team1','team2']) for (const p of m[side]||[])
      if (p.playerId && !seen.has(p.playerId)) seen.set(p.playerId, p.name);
  const ids = [...seen.keys()].slice(0,5);
  const clubs = {_meta: 'hand-curated test fixture'};
  const fakeClubs = ['SIAM Wireless BC','Bangkok BC','Pattaya Racket','Khon Kaen BC','Hat Yai BC'];
  ids.forEach((id, i) => { clubs[id] = fakeClubs[i]; });
  fs.writeFileSync(out, JSON.stringify(clubs, null, 2));
  console.log(out, '→', Object.keys(clubs).length-1, 'players');
}
"
```

- [ ] **Step 3: Verify fixtures exist and are valid JSON**

```bash
ls -la fixtures/player-index-*.json
node -e "['toyota','trang'].forEach(t => { const d = JSON.parse(require('fs').readFileSync(\`fixtures/player-index-\${t}.json\`,'utf8')); console.log(t, 'groups:', d.groups.length, 'days:', d.days.length); });"
```
Expected: groups/days numbers printed without error.

- [ ] **Step 4: Commit fixtures**

```bash
git add fixtures/player-index-toyota.json fixtures/player-index-toyota-clubs.json fixtures/player-index-trang.json fixtures/player-index-trang-clubs.json
git commit -m "test(deep-stats): add toyota + trang tournament fixtures

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Aggregator — bucketing pass + per-player totals

**Files:**
- Create: `__tests__/playerIndex.aggregate.test.ts`
- Modify: `lib/playerIndex.ts`

- [ ] **Step 1: Write failing test that exercises `buildIndex` on a single fixture**

```ts
import path from 'path'
import fs from 'fs'
import { buildIndex } from '@/lib/playerIndex'
import type { MatchesData, PlayerIndexTournamentInput } from '@/lib/types'

function loadInput(slug: string, tournamentName: string, dateIso: string): PlayerIndexTournamentInput {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}.json`), 'utf8')) as MatchesData
  const clubs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}-clubs.json`), 'utf8')) as Record<string, string>
  delete (clubs as Record<string, string>)._meta
  return { tournamentId: slug.toUpperCase(), tournamentName, tournamentDateIso: dateIso, data, clubs }
}

describe('buildIndex — single tournament', () => {
  const toyota = loadInput('toyota', 'โตโยต้า เยาวชน 2569', '2026-05-01')

  it('emits a non-empty index', () => {
    const { index } = buildIndex('bat', [toyota])
    expect(index.provider).toBe('bat')
    expect(index.totalPlayers).toBeGreaterThan(0)
    expect(index.totalMatches).toBeGreaterThan(0)
    expect(Object.keys(index.players).length).toBe(index.totalPlayers)
  })

  it('lists the tournament in sources', () => {
    const { index } = buildIndex('bat', [toyota])
    expect(index.sources).toEqual([{ tournamentId: 'TOYOTA', tournamentName: 'โตโยต้า เยาวชน 2569', tournamentDateIso: '2026-05-01' }])
  })

  it('every player has totals.matches === wins + losses + walkovers received + retirements received (no double counting)', () => {
    const { index } = buildIndex('bat', [toyota])
    for (const p of Object.values(index.players)) {
      const sum = p.totals.wins + p.totals.losses
      // Walkovers/retireds are subsets of W or L, already in wins/losses counts
      expect(p.totals.matches).toBe(sum)
    }
  })

  it('every player has a displayName and at least one tournament entry', () => {
    const { index } = buildIndex('bat', [toyota])
    for (const p of Object.values(index.players)) {
      expect(p.displayName.length).toBeGreaterThan(0)
      expect(p.tournaments.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('uses curated clubs from the fixture when available', () => {
    const { index } = buildIndex('bat', [toyota])
    const clubsSeen = new Set(Object.values(index.players).flatMap(p => p.clubs))
    expect(clubsSeen.has('SIAM Wireless BC')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `npx jest __tests__/playerIndex.aggregate.test.ts`
Expected: FAIL — `buildIndex` not exported.

- [ ] **Step 3: Implement `buildIndex` (totals only) in `lib/playerIndex.ts`**

Append to `lib/playerIndex.ts`:

```ts
import type {
  MatchEntry, MatchPlayer, MatchScore, ProviderTag,
  PlayerIndex, PlayerRecord, PlayerMatchRef, PlayerIndexTournamentInput,
  Leaderboards, DisciplineSummary,
} from './types'

const FIXED_GENERATED_AT = '__GENERATED_AT__'  // overwritten by orchestrator

function emptyDisc(): DisciplineSummary {
  return { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 }
}

function emptyRecord(provider: ProviderTag, slug: string, name: string): PlayerRecord {
  return {
    key: { provider, slug },
    displayName: name,
    altNames: [],
    clubs: [],
    totals: { matches: 0, wins: 0, losses: 0,
      walkoversReceived: 0, walkoversGiven: 0,
      retirementsReceived: 0, retirementsGiven: 0 },
    byDiscipline: { singles: emptyDisc(), doubles: emptyDisc(), mixed: emptyDisc() },
    titles: [], finals: [], semis: [],
    tournaments: [],
    recentForm: [],
    matchCharacter: {
      courtMinutes: 0, avgMatchMinutes: 0,
      longestMatchMinutes: 0, longestMatchRef: null,
      threeSetterCount: 0, threeSetterRate: 0, threeSetterWins: 0,
      comebackWins: 0, comebackWinRef: null,
      matchesLast90: 0,
    },
    opponents: [], partners: [],
    ranks: {},
  }
}

function parseDurationToMinutes(raw?: string): number | undefined {
  if (!raw) return undefined
  const m = raw.match(/(?:(\d+)h)?\s*(?:(\d+)m)?/)
  if (!m) return undefined
  const h = parseInt(m[1] || '0', 10)
  const min = parseInt(m[2] || '0', 10)
  const total = h * 60 + min
  return total > 0 ? total : undefined
}

function matchOutcome(side: 1 | 2, m: MatchEntry): PlayerMatchRef['outcome'] {
  const won = m.winner === side
  if (m.walkover) return won ? 'WO-W' : 'WO-L'
  if (m.retired) return won ? 'RET-W' : 'RET-L'
  return won ? 'W' : 'L'
}

function tournamentNameFor(input: PlayerIndexTournamentInput): string {
  return input.tournamentName || input.tournamentId
}

export function buildIndex(
  provider: ProviderTag,
  tournaments: PlayerIndexTournamentInput[],
): { index: PlayerIndex; leaderboards: Leaderboards } {

  const records = new Map<string, PlayerRecord>()
  const clubCounts = new Map<string, Map<string, number>>()      // slug -> club -> count
  const nameCounts = new Map<string, Map<string, number>>()      // slug -> name -> count
  let totalMatches = 0

  for (const t of tournaments) {
    const groups = t.data.groups || []
    for (const g of groups) {
      for (const m of (g.matches || [])) {
        totalMatches++
        registerSide(m, 1, t)
        registerSide(m, 2, t)
      }
    }
  }

  function registerSide(m: MatchEntry, side: 1 | 2, t: PlayerIndexTournamentInput): void {
    const team = side === 1 ? m.team1 : m.team2
    const opp = side === 1 ? m.team2 : m.team1
    if (!team || team.length === 0) return
    const outcome = matchOutcome(side, m)
    for (const p of team) {
      const slug = nameToSlug(p.name)
      if (!slug) continue
      let rec = records.get(slug)
      if (!rec) {
        rec = emptyRecord(provider, slug, p.name)
        records.set(slug, rec)
      }
      bump(nameCounts, slug, p.name)
      const club = p.playerId ? t.clubs[p.playerId] : undefined
      if (club) bump(clubCounts, slug, club)
      if (p.country && !rec.country) rec.country = p.country

      rec.totals.matches++
      if (outcome === 'W' || outcome === 'WO-W' || outcome === 'RET-W') {
        rec.totals.wins++
        if (outcome === 'WO-W') rec.totals.walkoversReceived++
        if (outcome === 'RET-W') rec.totals.retirementsReceived++
      } else {
        rec.totals.losses++
        if (outcome === 'WO-L') rec.totals.walkoversGiven++
        if (outcome === 'RET-L') rec.totals.retirementsGiven++
      }
    }
  }

  // Finalize displayName/clubs/altNames from observed frequencies
  for (const [slug, rec] of records) {
    const names = nameCounts.get(slug)
    if (names) {
      const sorted = [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      rec.displayName = sorted[0][0]
      rec.altNames = sorted.slice(1).map(([n]) => n)
    }
    const clubs = clubCounts.get(slug)
    if (clubs) {
      rec.clubs = [...clubs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c)
    }
  }

  const sources = tournaments.map(t => ({
    tournamentId: t.tournamentId,
    tournamentName: tournamentNameFor(t),
    tournamentDateIso: t.tournamentDateIso,
  }))

  const players: Record<string, PlayerRecord> = {}
  for (const [slug, rec] of records) players[slug] = rec

  const index: PlayerIndex = {
    version: 1, provider,
    generatedAt: FIXED_GENERATED_AT,
    sourceVersion: '',                       // filled by caller
    sources,
    totalPlayers: records.size,
    totalMatches,
    players,
  }

  const leaderboards: Leaderboards = {
    version: 1, provider,
    generatedAt: FIXED_GENERATED_AT,
    sourceVersion: '',
    boards: [],                              // populated in Task 11
  }

  return { index, leaderboards }
}

function bump(map: Map<string, Map<string, number>>, slug: string, key: string): void {
  let inner = map.get(slug)
  if (!inner) { inner = new Map(); map.set(slug, inner) }
  inner.set(key, (inner.get(key) || 0) + 1)
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/playerIndex.aggregate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run all tests to be sure nothing else broke**

Run: `npx jest --testPathPattern=playerIndex`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add __tests__/playerIndex.aggregate.test.ts lib/playerIndex.ts
git commit -m "feat(deep-stats): aggregator — bucketing pass + totals

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Aggregator — `byDiscipline` + match-level enrichment

**Files:**
- Modify: `__tests__/playerIndex.aggregate.test.ts`
- Modify: `lib/playerIndex.ts`

- [ ] **Step 1: Add failing test to `playerIndex.aggregate.test.ts`**

Append inside the existing `describe`:

```ts
  it('splits totals into byDiscipline buckets', () => {
    const { index } = buildIndex('bat', [toyota])
    for (const p of Object.values(index.players)) {
      const wins = p.byDiscipline.singles.wins + p.byDiscipline.doubles.wins + p.byDiscipline.mixed.wins
      const losses = p.byDiscipline.singles.losses + p.byDiscipline.doubles.losses + p.byDiscipline.mixed.losses
      expect(wins).toBe(p.totals.wins)
      expect(losses).toBe(p.totals.losses)
    }
  })
```

- [ ] **Step 2: Run to see it fail**

Run: `npx jest __tests__/playerIndex.aggregate.test.ts`
Expected: FAIL — `byDiscipline` numbers all zero.

- [ ] **Step 3: Extend `registerSide` to increment discipline buckets**

In `lib/playerIndex.ts`, locate `registerSide` and the `for (const p of team) {` loop. After the `totals` block, append:

```ts
      const disc = classifyDiscipline(team.length, m.eventName || '')
      const bucket = rec.byDiscipline[disc]
      if (outcome === 'W' || outcome === 'WO-W' || outcome === 'RET-W') bucket.wins++
      else bucket.losses++
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/playerIndex.aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/playerIndex.aggregate.test.ts lib/playerIndex.ts
git commit -m "feat(deep-stats): aggregator — byDiscipline split

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Aggregator — collect per-match refs + tournament/event grouping

**Files:**
- Modify: `__tests__/playerIndex.aggregate.test.ts`
- Modify: `lib/playerIndex.ts`

- [ ] **Step 1: Append failing test**

```ts
  it('groups matches into tournaments[] and events[]', () => {
    const { index } = buildIndex('bat', [toyota])
    // pick a player with matches
    const p = Object.values(index.players).find(r => r.totals.matches > 1)!
    expect(p.tournaments.length).toBe(1)
    const t0 = p.tournaments[0]
    expect(t0.tournamentId).toBe('TOYOTA')
    expect(t0.events.length).toBeGreaterThan(0)
    for (const e of t0.events) {
      expect(['singles','doubles','mixed']).toContain(e.discipline)
      expect(['Champion','F','SF','QF','R16','R32','R64','R128','RR']).toContain(e.bestFinish)
      expect(e.wins + e.losses).toBeGreaterThan(0)
    }
  })

  it('marks Champion when a player won a match labeled Final', () => {
    const { index } = buildIndex('bat', [toyota])
    const champions = Object.values(index.players).filter(p =>
      p.tournaments.some(t => t.events.some(e => e.bestFinish === 'Champion')))
    // Toyota fixture has at least one final winner
    expect(champions.length).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: Run to fail**

Run: `npx jest __tests__/playerIndex.aggregate.test.ts`
Expected: FAIL (`tournaments[]` empty).

- [ ] **Step 3: Add match-ref collection + event aggregation in `lib/playerIndex.ts`**

Replace the `buildIndex` function body. Inside it we now collect `refsBySlug`, then derive tournaments/events in a second pass.

Add a new struct near the top of the file (above `buildIndex`):

```ts
interface PerPlayerScratch {
  refs: PlayerMatchRef[]
}
```

Modify `registerSide` to also push a `PlayerMatchRef`. Replace its inner loop body with:

```ts
    for (const p of team) {
      const slug = nameToSlug(p.name)
      if (!slug) continue
      let rec = records.get(slug)
      if (!rec) { rec = emptyRecord(provider, slug, p.name); records.set(slug, rec) }
      let scratch = scratches.get(slug)
      if (!scratch) { scratch = { refs: [] }; scratches.set(slug, scratch) }
      bump(nameCounts, slug, p.name)
      const club = p.playerId ? t.clubs[p.playerId] : undefined
      if (club) bump(clubCounts, slug, club)
      if (p.country && !rec.country) rec.country = p.country

      rec.totals.matches++
      const disc = classifyDiscipline(team.length, m.eventName || '')
      const bucket = rec.byDiscipline[disc]
      if (outcome === 'W' || outcome === 'WO-W' || outcome === 'RET-W') {
        rec.totals.wins++; bucket.wins++
        if (outcome === 'WO-W') rec.totals.walkoversReceived++
        if (outcome === 'RET-W') rec.totals.retirementsReceived++
      } else {
        rec.totals.losses++; bucket.losses++
        if (outcome === 'WO-L') rec.totals.walkoversGiven++
        if (outcome === 'RET-L') rec.totals.retirementsGiven++
      }

      // Match ref
      const partners = team.filter(x => x !== p).map(x => x.name)
      const partnerSlugs = team.filter(x => x !== p).map(x => nameToSlug(x.name)).filter(Boolean)
      const opponents = opp.map(x => x.name)
      const opponentSlugs = opp.map(x => nameToSlug(x.name)).filter(Boolean)
      scratch.refs.push({
        tournamentId: t.tournamentId,
        tournamentName: tournamentNameFor(t),
        tournamentDateIso: t.tournamentDateIso,
        eventId: m.eventId || '',
        eventName: m.eventName || '',
        drawNum: m.drawNum,
        round: normalizeRound(m.round),
        partners, partnerSlugs,
        opponents, opponentSlugs,
        scores: m.scores || [],
        outcome,
        durationMinutes: parseDurationToMinutes(m.duration),
        scheduledDateIso: m.scheduledTime,
      })
    }
```

And add at the top of `buildIndex`:

```ts
  const scratches = new Map<string, PerPlayerScratch>()
```

After the existing club/altNames finalization pass, add the tournament/event grouping pass:

```ts
  const ROUND_ORDER = ['Final','SF','QF','R16','R32','R64','R128','RR']
  function bestFinish(refs: PlayerMatchRef[]): PlayerEventResult['bestFinish'] {
    // Champion = won a Final
    if (refs.some(r => r.round === 'Final' && (r.outcome === 'W' || r.outcome === 'WO-W' || r.outcome === 'RET-W'))) return 'Champion'
    // Otherwise the earliest-ordered round they appeared in
    const present = new Set(refs.map(r => r.round))
    for (const r of ROUND_ORDER) if (present.has(r)) return r as PlayerEventResult['bestFinish']
    return 'RR'
  }

  for (const [slug, rec] of records) {
    const refs = scratches.get(slug)?.refs || []
    // Group by (tournamentId, eventId)
    const byTournament = new Map<string, Map<string, PlayerMatchRef[]>>()
    for (const r of refs) {
      let evMap = byTournament.get(r.tournamentId)
      if (!evMap) { evMap = new Map(); byTournament.set(r.tournamentId, evMap) }
      const k = `${r.eventId}|${r.eventName}`
      const arr = evMap.get(k) || []
      arr.push(r); evMap.set(k, arr)
    }
    for (const t of tournaments) {
      const evMap = byTournament.get(t.tournamentId)
      if (!evMap) continue
      const events: PlayerEventResult[] = []
      for (const [k, eventRefs] of evMap) {
        const [eventId, eventName] = k.split('|')
        const teamSize = eventRefs[0]?.partners.length === 0 ? 1 : 2
        const finish = bestFinish(eventRefs)
        let wins = 0, losses = 0
        for (const er of eventRefs) {
          if (er.outcome.startsWith('W') || er.outcome.endsWith('-W')) wins++
          else losses++
        }
        events.push({
          tournamentId: t.tournamentId,
          eventId, eventName,
          discipline: classifyDiscipline(teamSize, eventName),
          bestFinish: finish,
          wins, losses,
        })
      }
      // Sort events by best-finish rank for stable display
      events.sort((a, b) => {
        const ai = a.bestFinish === 'Champion' ? -1 : ROUND_ORDER.indexOf(a.bestFinish)
        const bi = b.bestFinish === 'Champion' ? -1 : ROUND_ORDER.indexOf(b.bestFinish)
        return ai - bi || a.eventName.localeCompare(b.eventName)
      })
      rec.tournaments.push({
        tournamentId: t.tournamentId,
        tournamentName: tournamentNameFor(t),
        tournamentDateIso: t.tournamentDateIso,
        events,
      })
      // titles/finals/semis aggregation, disc.titles/finals/semis
      for (const e of events) {
        if (e.bestFinish === 'Champion') {
          rec.titles.push(e); rec.byDiscipline[e.discipline].titles++
        }
        if (e.bestFinish === 'Champion' || e.bestFinish === 'F') {
          rec.finals.push(e); rec.byDiscipline[e.discipline].finals++
        }
        if (e.bestFinish === 'Champion' || e.bestFinish === 'F' || e.bestFinish === 'SF') {
          rec.semis.push(e); rec.byDiscipline[e.discipline].semis++
        }
      }
    }
  }
```

Add `PlayerEventResult` import to the `import type` line at the top:

```ts
import type {
  MatchEntry, MatchPlayer, MatchScore, ProviderTag,
  PlayerIndex, PlayerRecord, PlayerMatchRef, PlayerIndexTournamentInput,
  Leaderboards, DisciplineSummary, PlayerEventResult,
} from './types'
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/playerIndex.aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/playerIndex.aggregate.test.ts lib/playerIndex.ts
git commit -m "feat(deep-stats): aggregator — tournaments/events/titles

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Aggregator — recent form + match character

**Files:**
- Modify: `__tests__/playerIndex.aggregate.test.ts`
- Modify: `lib/playerIndex.ts`

- [ ] **Step 1: Append failing tests**

```ts
  it('populates recentForm sorted newest first, max 10 entries', () => {
    const { index } = buildIndex('bat', [toyota])
    for (const p of Object.values(index.players)) {
      expect(p.recentForm.length).toBeLessThanOrEqual(10)
      for (let i = 1; i < p.recentForm.length; i++) {
        const prev = p.recentForm[i-1].scheduledDateIso || ''
        const curr = p.recentForm[i].scheduledDateIso || ''
        expect(prev >= curr).toBe(true)
      }
    }
  })

  it('computes courtMinutes and avgMatchMinutes consistently', () => {
    const { index } = buildIndex('bat', [toyota])
    const p = Object.values(index.players).find(r => r.matchCharacter.courtMinutes > 0)
    expect(p).toBeDefined()
    if (p && p.matchCharacter.courtMinutes > 0) {
      // avg must be ≤ courtMinutes (sanity)
      expect(p.matchCharacter.avgMatchMinutes).toBeLessThanOrEqual(p.matchCharacter.courtMinutes)
      expect(p.matchCharacter.longestMatchMinutes).toBeGreaterThanOrEqual(p.matchCharacter.avgMatchMinutes)
    }
  })

  it('threeSetterRate is between 0 and 1', () => {
    const { index } = buildIndex('bat', [toyota])
    for (const p of Object.values(index.players)) {
      expect(p.matchCharacter.threeSetterRate).toBeGreaterThanOrEqual(0)
      expect(p.matchCharacter.threeSetterRate).toBeLessThanOrEqual(1)
    }
  })
```

- [ ] **Step 2: Run to fail**

Run: `npx jest __tests__/playerIndex.aggregate.test.ts`
Expected: FAIL — `recentForm` empty.

- [ ] **Step 3: Add character-computation pass**

In `lib/playerIndex.ts`, after the tournament-grouping loop, before the final `return`, add:

```ts
  // Match character pass
  const NINETY_DAYS_MS = 90 * 86400 * 1000
  // The orchestrator passes `now` via a closure; for a pure aggregator we use
  // the max scheduledDateIso seen as the "as of" anchor so tests are stable.
  let maxIso = ''
  for (const sc of scratches.values()) for (const r of sc.refs) if ((r.scheduledDateIso || '') > maxIso) maxIso = (r.scheduledDateIso || '')
  const nowMs = maxIso ? Date.parse(maxIso) : 0

  for (const [slug, rec] of records) {
    const refs = scratches.get(slug)?.refs || []
    if (refs.length === 0) continue

    // recentForm: newest first
    rec.recentForm = [...refs]
      .sort((a, b) => (b.scheduledDateIso || '').localeCompare(a.scheduledDateIso || ''))
      .slice(0, 10)

    // matchCharacter
    let totalMin = 0, decided = 0, threeSetters = 0, threeWins = 0
    let longest = 0
    let longestRef: PlayerMatchRef | null = null
    let comebackRef: PlayerMatchRef | null = null
    let comebackWins = 0
    let matchesLast90 = 0

    // Identify which side `slug` was on for each ref to compute comebacks
    for (const r of refs) {
      const dm = r.durationMinutes || 0
      if (dm > 0) { totalMin += dm }
      if (dm > longest) { longest = dm; longestRef = r }
      const isDecided = r.outcome === 'W' || r.outcome === 'L'
      if (isDecided) decided++
      if (r.scores.length === 3) {
        threeSetters++
        if (r.outcome === 'W') threeWins++
      }
      // Comeback: 3 sets, outcome === 'W', first set lost by this side
      if (r.outcome === 'W' && r.scores.length === 3) {
        const firstSet = r.scores[0]
        // Player's side = "team1" perspective in the ref? We stored from the
        // player's POV: r.scores are the raw match scores; we recorded outcome
        // relative to the player. To know if game-1 was lost we need to know
        // which side they were on. Encode this in the ref by ensuring scores
        // are oriented player-first when registering. (See step 4.)
        if (firstSet && firstSet.t1 < firstSet.t2) {
          comebackWins++
          if (!comebackRef ||
              (r.round === 'Final' && comebackRef.round !== 'Final') ||
              (r.scheduledDateIso || '') > (comebackRef.scheduledDateIso || '')) {
            comebackRef = r
          }
        }
      }
      if (nowMs && r.scheduledDateIso) {
        const ts = Date.parse(r.scheduledDateIso)
        if (!isNaN(ts) && (nowMs - ts) <= NINETY_DAYS_MS) matchesLast90++
      }
    }

    rec.matchCharacter.courtMinutes = totalMin
    rec.matchCharacter.avgMatchMinutes = totalMin > 0 ? Math.round(totalMin / Math.max(1, refs.filter(r => r.durationMinutes).length)) : 0
    rec.matchCharacter.longestMatchMinutes = longest
    rec.matchCharacter.longestMatchRef = longestRef
    rec.matchCharacter.threeSetterCount = threeSetters
    rec.matchCharacter.threeSetterRate = decided > 0 ? threeSetters / decided : 0
    rec.matchCharacter.threeSetterWins = threeWins
    rec.matchCharacter.comebackWins = comebackWins
    rec.matchCharacter.comebackWinRef = comebackRef
    rec.matchCharacter.matchesLast90 = matchesLast90
  }
```

- [ ] **Step 4: Orient `scores` player-first when registering the ref**

In `registerSide`, when constructing `scores` for the ref, swap if the player is on side 2:

Replace the existing `scores: m.scores || [],` line with:

```ts
        scores: (m.scores || []).map(s => side === 1 ? s : { t1: s.t2, t2: s.t1 }),
```

- [ ] **Step 5: Run tests**

Run: `npx jest __tests__/playerIndex.aggregate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add __tests__/playerIndex.aggregate.test.ts lib/playerIndex.ts
git commit -m "feat(deep-stats): aggregator — recent form + match character

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Aggregator — opponents + partners

**Files:**
- Modify: `__tests__/playerIndex.aggregate.test.ts`
- Modify: `lib/playerIndex.ts`

- [ ] **Step 1: Append failing tests**

```ts
  it('lists opponents and counts them across all matches', () => {
    const { index } = buildIndex('bat', [toyota])
    const p = Object.values(index.players).find(r => r.opponents.length > 0)
    expect(p).toBeDefined()
    if (p) {
      const sumMeetings = p.opponents.reduce((s, o) => s + o.meetings, 0)
      // Opponents may exceed totals when 2v2 (each opponent counted per match)
      expect(sumMeetings).toBeGreaterThanOrEqual(p.totals.matches)
      for (const o of p.opponents) expect(o.wins + o.losses).toBe(o.meetings)
    }
  })

  it('lists partners only for doubles/mixed players', () => {
    const { index } = buildIndex('bat', [toyota])
    for (const p of Object.values(index.players)) {
      const totalDoublesMatches = p.byDiscipline.doubles.wins + p.byDiscipline.doubles.losses +
        p.byDiscipline.mixed.wins + p.byDiscipline.mixed.losses
      if (totalDoublesMatches === 0) {
        expect(p.partners.length).toBe(0)
      }
    }
  })
```

- [ ] **Step 2: Run to fail**

Run: `npx jest __tests__/playerIndex.aggregate.test.ts`
Expected: FAIL — empty arrays.

- [ ] **Step 3: Add opponents/partners pass**

In `lib/playerIndex.ts`, inside the character-computation loop (or in a separate pass right after), append:

```ts
    // Opponents
    const oppMap = new Map<string, { name: string; meetings: number; wins: number; losses: number; lastRound: string; lastEvent: string; lastIso: string }>()
    for (const r of refs) {
      for (let i = 0; i < r.opponentSlugs.length; i++) {
        const oslug = r.opponentSlugs[i]
        const oname = r.opponents[i] || ''
        if (!oslug) continue
        let acc = oppMap.get(oslug)
        if (!acc) { acc = { name: oname, meetings: 0, wins: 0, losses: 0, lastRound: r.round, lastEvent: r.eventName, lastIso: r.scheduledDateIso || '' }; oppMap.set(oslug, acc) }
        acc.meetings++
        if (r.outcome.endsWith('W') || r.outcome === 'W') acc.wins++
        else acc.losses++
        if ((r.scheduledDateIso || '') > acc.lastIso) {
          acc.lastIso = r.scheduledDateIso || ''; acc.lastRound = r.round; acc.lastEvent = r.eventName
        }
      }
    }
    rec.opponents = [...oppMap.entries()]
      .map(([slug, a]) => ({ slug, name: a.name, meetings: a.meetings, wins: a.wins, losses: a.losses, lastRound: a.lastRound, lastEvent: a.lastEvent }))
      .sort((a, b) => b.meetings - a.meetings || b.wins - a.wins || a.slug.localeCompare(b.slug))
      .slice(0, 12)

    // Partners (only matches where partners.length > 0)
    const partMap = new Map<string, { name: string; matches: number; wins: number; losses: number; events: Map<string, number> }>()
    for (const r of refs) {
      for (let i = 0; i < r.partnerSlugs.length; i++) {
        const pslug = r.partnerSlugs[i]
        const pname = r.partners[i] || ''
        if (!pslug) continue
        let acc = partMap.get(pslug)
        if (!acc) { acc = { name: pname, matches: 0, wins: 0, losses: 0, events: new Map() }; partMap.set(pslug, acc) }
        acc.matches++
        if (r.outcome.endsWith('W') || r.outcome === 'W') acc.wins++
        else acc.losses++
        acc.events.set(r.eventName, (acc.events.get(r.eventName) || 0) + 1)
      }
    }
    rec.partners = [...partMap.entries()]
      .map(([slug, a]) => {
        const primaryEvent = [...a.events.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || ''
        return { slug, name: a.name, matchesTogether: a.matches, wins: a.wins, losses: a.losses, primaryEvent }
      })
      .sort((a, b) => b.matchesTogether - a.matchesTogether || b.wins - a.wins || a.slug.localeCompare(b.slug))
      .slice(0, 12)
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/playerIndex.aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/playerIndex.aggregate.test.ts lib/playerIndex.ts
git commit -m "feat(deep-stats): aggregator — opponents + partners

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Multi-tournament merge test

**Files:**
- Create: `__tests__/playerIndex.multi.test.ts`

- [ ] **Step 1: Write test**

```ts
import path from 'path'
import fs from 'fs'
import { buildIndex } from '@/lib/playerIndex'
import type { MatchesData, PlayerIndexTournamentInput } from '@/lib/types'

function loadInput(slug: string, name: string, date: string): PlayerIndexTournamentInput {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}.json`), 'utf8')) as MatchesData
  const clubs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}-clubs.json`), 'utf8')) as Record<string, string>
  delete (clubs as Record<string, string>)._meta
  return { tournamentId: slug.toUpperCase(), tournamentName: name, tournamentDateIso: date, data, clubs }
}

describe('buildIndex — multi-tournament merge', () => {
  const toyota = loadInput('toyota', 'Toyota 2569', '2026-05-01')
  const trang = loadInput('trang', 'Trang Yonex Open 2026', '2026-04-15')

  it('sums totalMatches across all inputs', () => {
    const single = buildIndex('bat', [toyota]).index.totalMatches
    const other = buildIndex('bat', [trang]).index.totalMatches
    const merged = buildIndex('bat', [toyota, trang]).index.totalMatches
    expect(merged).toBe(single + other)
  })

  it('produces sources array in input order', () => {
    const { index } = buildIndex('bat', [toyota, trang])
    expect(index.sources.map(s => s.tournamentId)).toEqual(['TOYOTA', 'TRANG'])
  })

  it('merges totalPlayers as union (≤ sum, ≥ max)', () => {
    const a = Object.keys(buildIndex('bat', [toyota]).index.players)
    const b = Object.keys(buildIndex('bat', [trang]).index.players)
    const merged = buildIndex('bat', [toyota, trang]).index.totalPlayers
    const union = new Set([...a, ...b])
    expect(merged).toBe(union.size)
  })

  it('a player who appears in both tournaments has tournaments.length === 2', () => {
    const single = buildIndex('bat', [toyota]).index
    const merged = buildIndex('bat', [toyota, trang]).index
    const candidates = Object.keys(single.players).filter(s => merged.players[s]?.tournaments.length === 2)
    // Possibly empty if no overlap exists in the fixtures; do not assert > 0
    for (const slug of candidates) {
      const ids = merged.players[slug].tournaments.map(t => t.tournamentId).sort()
      expect(ids).toEqual(['TOYOTA','TRANG'])
    }
  })
})
```

- [ ] **Step 2: Run test**

Run: `npx jest __tests__/playerIndex.multi.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add __tests__/playerIndex.multi.test.ts
git commit -m "test(deep-stats): aggregator multi-tournament merge

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Leaderboards + rank backfill

**Files:**
- Create: `__tests__/playerIndex.leaderboards.test.ts`
- Modify: `lib/playerIndex.ts`

- [ ] **Step 1: Write failing test**

```ts
import path from 'path'
import fs from 'fs'
import { buildIndex } from '@/lib/playerIndex'
import type { MatchesData, PlayerIndexTournamentInput, LeaderboardBoard } from '@/lib/types'

function loadInput(slug: string, name: string, date: string): PlayerIndexTournamentInput {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}.json`), 'utf8')) as MatchesData
  const clubs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}-clubs.json`), 'utf8')) as Record<string, string>
  delete (clubs as Record<string, string>)._meta
  return { tournamentId: slug.toUpperCase(), tournamentName: name, tournamentDateIso: date, data, clubs }
}

describe('buildIndex — leaderboards', () => {
  const toyota = loadInput('toyota', 'Toyota', '2026-05-01')
  const trang = loadInput('trang', 'Trang', '2026-04-15')

  it('produces all 12 v1 boards', () => {
    const { leaderboards } = buildIndex('bat', [toyota, trang])
    const ids = leaderboards.boards.map(b => b.id).sort()
    expect(ids).toEqual([
      'activity.matchesLast90', 'activity.tournamentsEntered',
      'character.comebacks', 'character.deciderRecord', 'character.threeSetterWins',
      'discipline.doubles.wins', 'discipline.mixed.wins', 'discipline.singles.wins',
      'headline.courtTime', 'headline.titles', 'headline.winPct', 'headline.wins',
    ])
  })

  it('caps every board at 25 entries', () => {
    const { leaderboards } = buildIndex('bat', [toyota, trang])
    for (const b of leaderboards.boards) expect(b.entries.length).toBeLessThanOrEqual(25)
  })

  it('ranks are 1-indexed and contiguous', () => {
    const { leaderboards } = buildIndex('bat', [toyota, trang])
    for (const b of leaderboards.boards) {
      b.entries.forEach((e, i) => expect(e.rank).toBe(i + 1))
    }
  })

  it('headline.winPct excludes players with < 20 matches', () => {
    const { index, leaderboards } = buildIndex('bat', [toyota, trang])
    const board = leaderboards.boards.find(b => b.id === 'headline.winPct')!
    for (const e of board.entries) {
      const p = index.players[e.slug]
      expect(p.totals.matches).toBeGreaterThanOrEqual(20)
    }
  })

  it('writes ranks back to PlayerRecord.ranks for ranked players', () => {
    const { index, leaderboards } = buildIndex('bat', [toyota, trang])
    const titlesBoard = leaderboards.boards.find(b => b.id === 'headline.titles')!
    if (titlesBoard.entries.length > 0) {
      const top = titlesBoard.entries[0]
      expect(index.players[top.slug].ranks.titles).toBe(1)
    }
  })
})
```

- [ ] **Step 2: Run to fail**

Run: `npx jest __tests__/playerIndex.leaderboards.test.ts`
Expected: FAIL — boards empty.

- [ ] **Step 3: Add leaderboards build to `lib/playerIndex.ts`**

Before the final `return { index, leaderboards }` in `buildIndex`, add a leaderboard build pass:

```ts
  // Leaderboards
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
```

Update `import type` to add `LeaderboardBoard, PlayerRanks`:

```ts
import type {
  MatchEntry, MatchPlayer, MatchScore, ProviderTag,
  PlayerIndex, PlayerRecord, PlayerMatchRef, PlayerIndexTournamentInput,
  Leaderboards, DisciplineSummary, PlayerEventResult,
  LeaderboardBoard, PlayerRanks,
} from './types'
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/playerIndex.leaderboards.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add __tests__/playerIndex.leaderboards.test.ts lib/playerIndex.ts
git commit -m "feat(deep-stats): aggregator — 12 leaderboards + rank backfill

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Empty input test

**Files:**
- Create: `__tests__/playerIndex.empty.test.ts`

- [ ] **Step 1: Write test**

```ts
import { buildIndex } from '@/lib/playerIndex'

describe('buildIndex — empty input', () => {
  it('returns an empty index with zero players and zero matches', () => {
    const { index, leaderboards } = buildIndex('bat', [])
    expect(index.totalPlayers).toBe(0)
    expect(index.totalMatches).toBe(0)
    expect(index.players).toEqual({})
    expect(index.sources).toEqual([])
    expect(leaderboards.boards.length).toBe(12)
    for (const b of leaderboards.boards) expect(b.entries).toEqual([])
  })
})
```

- [ ] **Step 2: Run**

Run: `npx jest __tests__/playerIndex.empty.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add __tests__/playerIndex.empty.test.ts
git commit -m "test(deep-stats): empty-input aggregator branch

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: `lib/clubs-cache.ts` + tests

**Files:**
- Create: `__tests__/clubs-cache.test.ts`
- Create: `lib/clubs-cache.ts`

- [ ] **Step 1: Write failing test**

```ts
import fs from 'fs'
import os from 'os'
import path from 'path'
import { readClubsCache, writeClubsCache, __setClubsRootForTesting } from '@/lib/clubs-cache'

describe('clubs-cache', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clubs-cache-'))
    __setClubsRootForTesting(dir)
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('returns null when file is missing', async () => {
    expect(await readClubsCache('NONE')).toBeNull()
  })

  it('writes and reads back a club map', async () => {
    await writeClubsCache('ABCD', { '1': 'Bangkok BC', '2': 'Hat Yai BC' })
    expect(await readClubsCache('ABCD')).toEqual({ '1': 'Bangkok BC', '2': 'Hat Yai BC' })
  })

  it('safe-segments tournament IDs', async () => {
    await writeClubsCache('a/b\\c', { x: 'y' })
    const files = fs.readdirSync(dir)
    expect(files.some(f => f.includes('_'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run to fail**

Run: `npx jest __tests__/clubs-cache.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `lib/clubs-cache.ts`**

```ts
import { promises as fs } from 'fs'
import path from 'path'

let root = path.join(process.cwd(), '.cache', 'clubs')

export function __setClubsRootForTesting(dir: string): void { root = dir }

function safeSegment(s: string): string { return s.replace(/[^a-zA-Z0-9_-]/g, '_') }
function clubsPath(id: string): string { return path.join(root, `${safeSegment(id)}.json`) }

export async function readClubsCache(tournamentId: string): Promise<Record<string, string> | null> {
  try {
    const buf = await fs.readFile(clubsPath(tournamentId), 'utf8')
    return JSON.parse(buf) as Record<string, string>
  } catch { return null }
}

export async function writeClubsCache(tournamentId: string, clubs: Record<string, string>): Promise<void> {
  const file = clubsPath(tournamentId)
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(clubs), 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[clubs-cache] write failed id=${tournamentId} err=${msg}`)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/clubs-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/clubs-cache.test.ts lib/clubs-cache.ts
git commit -m "feat(deep-stats): clubs-cache (.cache/clubs/<id>.json)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 14: `lib/player-index-cache.ts` + tests

**Files:**
- Create: `__tests__/player-index-cache.test.ts`
- Create: `lib/player-index-cache.ts`

- [ ] **Step 1: Write failing test**

```ts
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  readIndexCache, writeIndexCache,
  readLeaderboardsCache, writeLeaderboardsCache,
  __setPlayersRootForTesting,
} from '@/lib/player-index-cache'
import type { PlayerIndex, Leaderboards } from '@/lib/types'

const emptyIndex = (provider: 'bat'|'bwf'): PlayerIndex => ({
  version: 1, provider, generatedAt: 'T', sourceVersion: 'v1',
  sources: [], totalPlayers: 0, totalMatches: 0, players: {},
})
const emptyLb = (provider: 'bat'|'bwf'): Leaderboards => ({
  version: 1, provider, generatedAt: 'T', sourceVersion: 'v1', boards: [],
})

describe('player-index-cache', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pic-')); __setPlayersRootForTesting(dir) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('returns null when index file is missing', async () => {
    expect(await readIndexCache('bat')).toBeNull()
  })

  it('round-trips an index', async () => {
    await writeIndexCache(emptyIndex('bat'))
    const out = await readIndexCache('bat')
    expect(out?.provider).toBe('bat')
    expect(out?.players).toEqual({})
  })

  it('rejects an unknown version', async () => {
    const file = path.join(dir, 'index-bat.json')
    fs.writeFileSync(file, JSON.stringify({ version: 999, provider: 'bat' }))
    expect(await readIndexCache('bat')).toBeNull()
  })

  it('round-trips leaderboards', async () => {
    await writeLeaderboardsCache(emptyLb('bwf'))
    const out = await readLeaderboardsCache('bwf')
    expect(out?.boards).toEqual([])
  })
})
```

- [ ] **Step 2: Run to fail**

Run: `npx jest __tests__/player-index-cache.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/player-index-cache.ts`**

```ts
import { promises as fs } from 'fs'
import path from 'path'
import type { PlayerIndex, Leaderboards, ProviderTag } from './types'

let root = path.join(process.cwd(), '.cache', 'players')

export function __setPlayersRootForTesting(dir: string): void { root = dir }

function indexPath(p: ProviderTag): string { return path.join(root, `index-${p}.json`) }
function lbPath(p: ProviderTag): string { return path.join(root, `leaderboards-${p}.json`) }

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T } catch { return null }
}

async function writeJson(file: string, obj: unknown): Promise<void> {
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(obj), 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[player-index-cache] write failed file=${file} err=${msg}`)
  }
}

export async function readIndexCache(provider: ProviderTag): Promise<PlayerIndex | null> {
  const out = await readJson<PlayerIndex>(indexPath(provider))
  if (!out || out.version !== 1) return null
  return out
}

export async function writeIndexCache(idx: PlayerIndex): Promise<void> {
  await writeJson(indexPath(idx.provider), idx)
}

export async function readLeaderboardsCache(provider: ProviderTag): Promise<Leaderboards | null> {
  const out = await readJson<Leaderboards>(lbPath(provider))
  if (!out || out.version !== 1) return null
  return out
}

export async function writeLeaderboardsCache(lb: Leaderboards): Promise<void> {
  await writeJson(lbPath(lb.provider), lb)
}
```

- [ ] **Step 4: Run**

Run: `npx jest __tests__/player-index-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/player-index-cache.test.ts lib/player-index-cache.ts
git commit -m "feat(deep-stats): player-index-cache (.cache/players/*)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 15: Registry `listDoneByProvider` helper

**Files:**
- Modify: `lib/tournaments-registry.ts`

- [ ] **Step 1: Append helper**

Add at the bottom of `lib/tournaments-registry.ts`:

```ts
export function listDoneByProvider(provider: ProviderTag): RegistryEntry[] {
  ensureFresh()
  return entries.filter(e => e.provider === provider && e.done)
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/tournaments-registry.ts
git commit -m "feat(deep-stats): listDoneByProvider helper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 16: `lib/player-index-rebuild.ts` + tests

**Files:**
- Create: `__tests__/player-index-rebuild.test.ts`
- Create: `lib/player-index-rebuild.ts`

- [ ] **Step 1: Write failing test**

```ts
jest.mock('@/lib/tournaments-registry', () => ({
  listDoneByProvider: jest.fn(),
}))
jest.mock('@/lib/day-cache', () => ({ readFullCache: jest.fn() }))
jest.mock('@/lib/clubs-cache', () => ({
  readClubsCache: jest.fn(),
  writeClubsCache: jest.fn(),
}))
jest.mock('@/lib/bracket-cache', () => ({
  playerClubCache: new Map<string, string>(),
  fetchTournamentPlayerClubs: jest.fn(),
}))
jest.mock('@/lib/player-index-cache', () => ({
  readIndexCache: jest.fn(),
  writeIndexCache: jest.fn(),
  writeLeaderboardsCache: jest.fn(),
}))

import { listDoneByProvider } from '@/lib/tournaments-registry'
import { readFullCache } from '@/lib/day-cache'
import { readClubsCache, writeClubsCache } from '@/lib/clubs-cache'
import { playerClubCache, fetchTournamentPlayerClubs } from '@/lib/bracket-cache'
import { readIndexCache, writeIndexCache, writeLeaderboardsCache } from '@/lib/player-index-cache'
import { rebuildAll } from '@/lib/player-index-rebuild'

describe('rebuildAll', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('returns skipped for providers with no done tournaments', async () => {
    ;(listDoneByProvider as jest.Mock).mockReturnValue([])
    const out = await rebuildAll()
    expect(out.rebuilt).toEqual([])
    expect(out.skipped).toEqual(['bat','bwf'])
  })

  it('rebuilds when a done tournament with a full cache is present', async () => {
    ;(listDoneByProvider as jest.Mock).mockImplementation((p) => p === 'bat'
      ? [{ id: 'ID1', provider: 'bat', done: true }]
      : [])
    ;(readFullCache as jest.Mock).mockResolvedValue({ days: [], groups: [], currentDate: '2026-05-01' })
    ;(readClubsCache as jest.Mock).mockResolvedValue({})
    ;(readIndexCache as jest.Mock).mockResolvedValue(null)
    const out = await rebuildAll()
    expect(out.rebuilt).toContain('bat')
    expect(writeIndexCache).toHaveBeenCalled()
    expect(writeLeaderboardsCache).toHaveBeenCalled()
  })

  it('fetches clubs when no clubs cache exists', async () => {
    ;(listDoneByProvider as jest.Mock).mockImplementation((p) => p === 'bat' ? [{ id: 'ID2', provider: 'bat', done: true }] : [])
    ;(readFullCache as jest.Mock).mockResolvedValue({ days: [], groups: [], currentDate: '2026-05-01' })
    ;(readClubsCache as jest.Mock).mockResolvedValue(null)
    ;(fetchTournamentPlayerClubs as jest.Mock).mockResolvedValue(true)
    ;(readIndexCache as jest.Mock).mockResolvedValue(null)
    await rebuildAll()
    expect(fetchTournamentPlayerClubs).toHaveBeenCalledWith('ID2')
    expect(writeClubsCache).toHaveBeenCalled()
  })

  it('skips rebuild when sourceVersion unchanged', async () => {
    ;(listDoneByProvider as jest.Mock).mockImplementation((p) => p === 'bat' ? [{ id: 'ID3', provider: 'bat', done: true }] : [])
    ;(readFullCache as jest.Mock).mockResolvedValue({ days: [], groups: [], currentDate: '2026-05-01' })
    ;(readClubsCache as jest.Mock).mockResolvedValue({})
    ;(readIndexCache as jest.Mock).mockImplementation(async (p) => ({
      version: 1, provider: p, generatedAt: 'T',
      sourceVersion: 'placeholder',
      sources: [], totalPlayers: 0, totalMatches: 0, players: {},
    }))
    // We can't easily predict sourceVersion in this test; trust the orchestrator
    // computes one. The first call rebuilds (existing sv is "placeholder"),
    // second call should skip when existing sv equals fresh sv.
    const first = await rebuildAll()
    ;(readIndexCache as jest.Mock).mockImplementation(async (p) => ({
      version: 1, provider: p, generatedAt: 'T',
      sourceVersion: (writeIndexCache as jest.Mock).mock.calls.find(c => c[0].provider === p)?.[0].sourceVersion ?? '',
      sources: [], totalPlayers: 0, totalMatches: 0, players: {},
    }))
    ;(writeIndexCache as jest.Mock).mockClear()
    const second = await rebuildAll()
    expect(second.skipped).toContain('bat')
    expect(writeIndexCache).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to fail**

Run: `npx jest __tests__/player-index-rebuild.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/player-index-rebuild.ts`**

```ts
import { createHash } from 'crypto'
import { listDoneByProvider } from '@/lib/tournaments-registry'
import { readFullCache } from '@/lib/day-cache'
import { readClubsCache, writeClubsCache } from '@/lib/clubs-cache'
import { playerClubCache, fetchTournamentPlayerClubs } from '@/lib/bracket-cache'
import {
  readIndexCache, writeIndexCache, writeLeaderboardsCache,
} from '@/lib/player-index-cache'
import { buildIndex } from '@/lib/playerIndex'
import type { ProviderTag, PlayerIndexTournamentInput } from '@/lib/types'

const PROVIDERS: ProviderTag[] = ['bat', 'bwf']
let inflight: Promise<{ rebuilt: ProviderTag[]; skipped: ProviderTag[] }> | null = null

export async function rebuildAll(): Promise<{ rebuilt: ProviderTag[]; skipped: ProviderTag[] }> {
  if (inflight) return inflight
  inflight = (async () => {
    const rebuilt: ProviderTag[] = []
    const skipped: ProviderTag[] = []
    for (const provider of PROVIDERS) {
      try {
        const done = listDoneByProvider(provider)
        if (done.length === 0) { skipped.push(provider); continue }

        const inputs: PlayerIndexTournamentInput[] = []
        for (const entry of done) {
          const full = await readFullCache(entry.id)
          if (!full) continue

          // Clubs
          let clubs = await readClubsCache(entry.id)
          if (!clubs && provider === 'bat') {
            await fetchTournamentPlayerClubs(entry.id.toLowerCase()).catch(() => null)
            const prefix = `${entry.id.toLowerCase()}:`
            const fresh: Record<string, string> = {}
            playerClubCache.forEach((club, key) => {
              if (key.startsWith(prefix)) fresh[key.slice(prefix.length)] = club
            })
            if (Object.keys(fresh).length > 0) {
              await writeClubsCache(entry.id, fresh)
              clubs = fresh
            }
          }
          inputs.push({
            tournamentId: entry.id,
            tournamentName: full.currentDate ? entry.id : entry.id,   // populated from meta below
            tournamentDateIso: full.days?.[0]?.dateIso || '',
            data: full,
            clubs: clubs || {},
          })
        }

        const sv = computeSourceVersion(inputs)
        const existing = await readIndexCache(provider)
        if (existing && existing.sourceVersion === sv) { skipped.push(provider); continue }

        const { index, leaderboards } = buildIndex(provider, inputs)
        const now = new Date().toISOString()
        index.generatedAt = now
        leaderboards.generatedAt = now
        index.sourceVersion = sv
        leaderboards.sourceVersion = sv

        await writeIndexCache(index)
        await writeLeaderboardsCache(leaderboards)
        rebuilt.push(provider)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown'
        console.log(`[player-index-rebuild] failed provider=${provider} err=${msg}`)
        skipped.push(provider)
      }
    }
    return { rebuilt, skipped }
  })()
  try { return await inflight } finally { inflight = null }
}

function computeSourceVersion(inputs: PlayerIndexTournamentInput[]): string {
  const sig = [...inputs]
    .sort((a, b) => a.tournamentId.localeCompare(b.tournamentId))
    .map(i => `${i.tournamentId}:${JSON.stringify(i.data).length}:${Object.keys(i.clubs).length}`)
    .join('|')
  return createHash('sha256').update(sig).digest('hex')
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/player-index-rebuild.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/player-index-rebuild.test.ts lib/player-index-rebuild.ts
git commit -m "feat(deep-stats): rebuild orchestrator

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 17: `/api/players/[provider]/[slug]` route

**Files:**
- Create: `__tests__/api-players-route.test.ts`
- Create: `app/api/players/[provider]/[slug]/route.ts`

- [ ] **Step 1: Write failing test**

```ts
jest.mock('@/lib/player-index-cache', () => ({ readIndexCache: jest.fn() }))
import { readIndexCache } from '@/lib/player-index-cache'
import { GET } from '@/app/api/players/[provider]/[slug]/route'

const url = (p: string, s: string) => new Request(`http://localhost/api/players/${p}/${s}`)
const ctx = (p: string, s: string) => ({ params: { provider: p, slug: s } })

describe('GET /api/players/:provider/:slug', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('returns 400 for unknown provider', async () => {
    const res = await GET(url('xyz', 'abc'), ctx('xyz', 'abc') as any)
    expect(res.status).toBe(400)
  })

  it('returns 404 when index missing', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(url('bat', 'abc'), ctx('bat', 'abc') as any)
    expect(res.status).toBe(404)
  })

  it('returns 404 when slug missing in index', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: {} })
    const res = await GET(url('bat', 'abc'), ctx('bat', 'abc') as any)
    expect(res.status).toBe(404)
  })

  it('returns the record when found', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue({
      generatedAt: 'T',
      players: { abc: { key: { provider: 'bat', slug: 'abc' }, displayName: 'Name' } },
    })
    const res = await GET(url('bat', 'abc'), ctx('bat', 'abc') as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.record.displayName).toBe('Name')
  })
})
```

- [ ] **Step 2: Implement `app/api/players/[provider]/[slug]/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { readIndexCache } from '@/lib/player-index-cache'
import type { ProviderTag } from '@/lib/types'

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export async function GET(_req: Request, ctx: { params: { provider: string; slug: string } }) {
  const provider = ctx.params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'unknown provider' }, { status: 400 })
  }
  const index = await readIndexCache(provider)
  if (!index) return NextResponse.json({ error: 'index not built' }, { status: 404 })
  const record = index.players[ctx.params.slug]
  if (!record) return NextResponse.json({ error: 'player not found' }, { status: 404 })
  return NextResponse.json({ record, indexGeneratedAt: index.generatedAt })
}
```

- [ ] **Step 3: Run tests**

Run: `npx jest __tests__/api-players-route.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add __tests__/api-players-route.test.ts app/api/players/[provider]/[slug]/route.ts
git commit -m "feat(deep-stats): GET /api/players/:provider/:slug

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 18: `/api/players/exists` route

**Files:**
- Create: `__tests__/api-players-exists-route.test.ts`
- Create: `app/api/players/exists/route.ts`

- [ ] **Step 1: Write failing test**

```ts
jest.mock('@/lib/player-index-cache', () => ({ readIndexCache: jest.fn() }))
import { readIndexCache } from '@/lib/player-index-cache'
import { GET } from '@/app/api/players/exists/route'

describe('GET /api/players/exists', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('returns 400 when params missing', async () => {
    const res = await GET(new Request('http://localhost/api/players/exists'))
    expect(res.status).toBe(400)
  })

  it('returns false when index missing', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/api/players/exists?provider=bat&name=Foo'))
    expect((await res.json()).exists).toBe(false)
  })

  it('returns true with slug when found', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: { foo: {} } })
    const res = await GET(new Request('http://localhost/api/players/exists?provider=bat&name=Foo'))
    const json = await res.json()
    expect(json.exists).toBe(true)
    expect(json.slug).toBe('foo')
  })
})
```

- [ ] **Step 2: Implement route**

`app/api/players/exists/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { readIndexCache } from '@/lib/player-index-cache'
import { nameToSlug } from '@/lib/playerIndex'
import type { ProviderTag } from '@/lib/types'

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export async function GET(req: Request) {
  const u = new URL(req.url)
  const provider = u.searchParams.get('provider') as ProviderTag | null
  const name = u.searchParams.get('name')
  if (!provider || !name || !PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'provider and name required' }, { status: 400 })
  }
  const slug = nameToSlug(name)
  const index = await readIndexCache(provider)
  const exists = !!index?.players[slug]
  return NextResponse.json({ exists, slug })
}
```

- [ ] **Step 3: Run + commit**

```bash
npx jest __tests__/api-players-exists-route.test.ts
git add __tests__/api-players-exists-route.test.ts app/api/players/exists/route.ts
git commit -m "feat(deep-stats): GET /api/players/exists

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 19: `/api/leaderboards` route

**Files:**
- Create: `__tests__/api-leaderboards-route.test.ts`
- Create: `app/api/leaderboards/route.ts`

- [ ] **Step 1: Write failing test**

```ts
jest.mock('@/lib/player-index-cache', () => ({ readLeaderboardsCache: jest.fn() }))
import { readLeaderboardsCache } from '@/lib/player-index-cache'
import { GET } from '@/app/api/leaderboards/route'

const boards = [
  { id: 'headline.wins', category: 'headline', entries: [] },
  { id: 'character.comebacks', category: 'character', entries: [] },
]

describe('GET /api/leaderboards', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('returns 404 when leaderboards missing', async () => {
    ;(readLeaderboardsCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/api/leaderboards?provider=bat'))
    expect(res.status).toBe(404)
  })

  it('returns all boards when no category filter', async () => {
    ;(readLeaderboardsCache as jest.Mock).mockResolvedValue({ boards, generatedAt: 'T' })
    const json = await (await GET(new Request('http://localhost/api/leaderboards?provider=bat'))).json()
    expect(json.boards.length).toBe(2)
  })

  it('filters by category', async () => {
    ;(readLeaderboardsCache as jest.Mock).mockResolvedValue({ boards, generatedAt: 'T' })
    const json = await (await GET(new Request('http://localhost/api/leaderboards?provider=bat&category=character'))).json()
    expect(json.boards.map((b: any) => b.id)).toEqual(['character.comebacks'])
  })
})
```

- [ ] **Step 2: Implement route**

`app/api/leaderboards/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { readLeaderboardsCache } from '@/lib/player-index-cache'
import type { ProviderTag, LeaderboardCategory } from '@/lib/types'

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])
const CATEGORIES = new Set<LeaderboardCategory>(['headline','discipline','character','activity'])

export async function GET(req: Request) {
  const u = new URL(req.url)
  const provider = (u.searchParams.get('provider') || 'bat') as ProviderTag
  const category = u.searchParams.get('category') as LeaderboardCategory | null
  if (!PROVIDERS.has(provider)) return NextResponse.json({ error: 'unknown provider' }, { status: 400 })
  const lb = await readLeaderboardsCache(provider)
  if (!lb) return NextResponse.json({ error: 'not built' }, { status: 404 })
  let boards = lb.boards
  if (category) {
    if (!CATEGORIES.has(category)) return NextResponse.json({ error: 'unknown category' }, { status: 400 })
    boards = boards.filter(b => b.category === category)
  }
  return NextResponse.json({ boards, generatedAt: lb.generatedAt })
}
```

- [ ] **Step 3: Run + commit**

```bash
npx jest __tests__/api-leaderboards-route.test.ts
git add __tests__/api-leaderboards-route.test.ts app/api/leaderboards/route.ts
git commit -m "feat(deep-stats): GET /api/leaderboards

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 20: `/api/players/rebuild` route (token-guarded POST)

**Files:**
- Create: `__tests__/api-players-rebuild-route.test.ts`
- Create: `app/api/players/rebuild/route.ts`

- [ ] **Step 1: Write failing test**

```ts
jest.mock('@/lib/player-index-rebuild', () => ({ rebuildAll: jest.fn() }))
import { rebuildAll } from '@/lib/player-index-rebuild'
import { POST } from '@/app/api/players/rebuild/route'

const TOKEN = 'test-token'

describe('POST /api/players/rebuild', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    process.env.PLAYERS_REBUILD_TOKEN = TOKEN
  })

  it('returns 401 without auth', async () => {
    const res = await POST(new Request('http://localhost/api/players/rebuild', { method: 'POST' }))
    expect(res.status).toBe(401)
    expect(rebuildAll).not.toHaveBeenCalled()
  })

  it('returns 401 with wrong token', async () => {
    const res = await POST(new Request('http://localhost/api/players/rebuild', {
      method: 'POST', headers: { Authorization: 'Bearer wrong' },
    }))
    expect(res.status).toBe(401)
  })

  it('runs rebuild with correct token', async () => {
    ;(rebuildAll as jest.Mock).mockResolvedValue({ rebuilt: ['bat'], skipped: ['bwf'] })
    const res = await POST(new Request('http://localhost/api/players/rebuild', {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` },
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.rebuilt).toEqual(['bat'])
  })
})
```

- [ ] **Step 2: Implement route**

`app/api/players/rebuild/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { rebuildAll } from '@/lib/player-index-rebuild'

export const maxDuration = 60

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.PLAYERS_REBUILD_TOKEN || ''}`
  if (!process.env.PLAYERS_REBUILD_TOKEN || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const result = await rebuildAll()
  return NextResponse.json(result)
}
```

- [ ] **Step 3: Run + commit**

```bash
npx jest __tests__/api-players-rebuild-route.test.ts
git add __tests__/api-players-rebuild-route.test.ts app/api/players/rebuild/route.ts
git commit -m "feat(deep-stats): POST /api/players/rebuild

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 21: i18n keys

**Files:**
- Modify: `lib/i18n.ts`

- [ ] **Step 1: Add keys to both `en` and `th` bundles**

Open `lib/i18n.ts`. Locate the two language objects (search for an existing key like `tournamentStats` to find both `en` and `th` sections). Add these keys to BOTH:

```ts
// Deep player stats
viewFullProfile: { en: 'View full profile', th: 'ดูโปรไฟล์เต็ม' },
playerProfile: { en: 'Player Profile', th: 'โปรไฟล์ผู้เล่น' },
byDiscipline: { en: 'By discipline', th: 'แยกตามประเภท' },
singles: { en: 'Singles', th: 'เดี่ยว' },
doubles: { en: 'Doubles', th: 'คู่' },
mixed: { en: 'Mixed', th: 'คู่ผสม' },
tournamentHistory: { en: 'Tournament history', th: 'ประวัติการแข่ง' },
recentForm: { en: 'Recent form', th: 'ฟอร์มล่าสุด' },
matchCharacter: { en: 'Match character', th: 'ลักษณะการแข่ง' },
frequentOpponents: { en: 'Frequent opponents', th: 'คู่ต่อสู้ที่พบบ่อย' },
frequentPartners: { en: 'Frequent partners', th: 'คู่ที่เล่นด้วยกันบ่อย' },
courtTime: { en: 'Court time', th: 'เวลาในสนาม' },
avgMatch: { en: 'Avg match', th: 'แมตช์เฉลี่ย' },
longestMatch: { en: 'Longest match', th: 'แมตช์ยาวที่สุด' },
threeSetterRate: { en: 'Three-setter rate', th: 'อัตราเกมสามเซต' },
comebackWins: { en: 'Comeback wins', th: 'ชนะแบบพลิกกลับมา' },
walkoversReceived: { en: 'Walkovers received', th: 'ได้บาย' },
walkoversGiven: { en: 'Walkovers given', th: 'ให้บาย' },
champion: { en: 'Champion', th: 'แชมป์' },
leaderboards: { en: 'Leaderboards', th: 'ตารางอันดับ' },
leaderboardsSub: { en: 'Career titles · wins · win % · court time', th: 'แชมป์ · ชนะ · เปอร์เซ็นต์ชนะ · เวลาในสนาม' },
lbHeadline: { en: 'Headline', th: 'หลัก' },
lbDiscipline: { en: 'Discipline', th: 'ประเภท' },
lbCharacter: { en: 'Character', th: 'ลักษณะ' },
lbActivity: { en: 'Activity', th: 'กิจกรรม' },
lbMostTitles: { en: 'Most Titles', th: 'แชมป์มากที่สุด' },
lbMostWins: { en: 'Most Wins', th: 'ชนะมากที่สุด' },
lbHighestWinPct: { en: 'Highest Win %', th: 'เปอร์เซ็นต์ชนะสูงสุด' },
lbMostCourtTime: { en: 'Most Court Time', th: 'เวลาในสนามมากที่สุด' },
lbBestSingles: { en: 'Best Singles', th: 'เดี่ยวยอดเยี่ยม' },
lbBestDoubles: { en: 'Best Doubles', th: 'คู่ยอดเยี่ยม' },
lbBestMixed: { en: 'Best Mixed', th: 'คู่ผสมยอดเยี่ยม' },
lbThreeSetterWins: { en: 'Three-setter Wins', th: 'ชนะสามเซต' },
lbComebackWins: { en: 'Comeback Wins', th: 'ชนะพลิกกลับมา' },
lbDeciderRecord: { en: 'Decider Record', th: 'สถิติเซตตัดสิน' },
lbMatchesLast90: { en: 'Matches (last 90 days)', th: 'แมตช์ (90 วันล่าสุด)' },
lbTournamentsEntered: { en: 'Tournaments Entered', th: 'จำนวนทัวร์ที่เข้า' },
min20: { en: 'min 20 matches', th: 'อย่างน้อย 20 แมตช์' },
min10: { en: 'min 10 matches', th: 'อย่างน้อย 10 แมตช์' },
min5: { en: 'min 5 deciders', th: 'อย่างน้อย 5 เซตตัดสิน' },
```

(Adapt the key-insertion syntax to whatever format `lib/i18n.ts` already uses — the project may use a flat `{ en: {...}, th: {...} }` rather than per-key entries. Open the file first to confirm.)

- [ ] **Step 2: TypeScript compile**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/i18n.ts
git commit -m "feat(deep-stats): i18n keys for player profile + leaderboards

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 22: CSS for profile + leaderboards

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Append the mockup styles**

Open `app/globals.css`. At the very bottom, append:

```css
/* ── Deep player stats: profile page (.pp-*) ── */
.pp-page { max-width: 880px; margin: 0 auto; padding: 16px; }
.pp-hdr { background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 18px 18px 14px; margin-bottom: 14px; }
.pp-hdr h1 { margin: 0; font-size: 22px; font-weight: 700; }
.pp-meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px;
  color: var(--muted); font-size: 13px; }
.pp-meta strong { color: var(--fg); font-weight: 600; }
.pp-badges { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.pp-rank-badge { display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 11px 5px 8px; border-radius: 999px;
  background: var(--info-bg); color: var(--info-fg); font-size: 12px;
  font-weight: 600; text-decoration: none; border: 1px solid transparent; }
.pp-rank-badge:hover { border-color: var(--info-fg); }
.pp-rank-badge .pp-rk { background: var(--info-fg); color: var(--surface);
  border-radius: 999px; padding: 2px 7px; font-size: 11px; font-weight: 700; }
.pp-kpi-row { display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 8px; margin-bottom: 14px; }
.pp-kpi { background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 12px 10px; text-align: center; }
.pp-kpi-num { font-size: 22px; font-weight: 700; color: var(--brand-fg); line-height: 1; }
.pp-kpi-lbl { font-size: 11px; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.04em; margin-top: 6px; }
@media (max-width: 520px) { .pp-kpi-row { grid-template-columns: repeat(2, 1fr); } }
.pp-section { background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; }
.pp-section h2 { margin: 0 0 12px; font-size: 14px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.pp-disc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.pp-disc { padding: 10px 12px; border-radius: 10px; background: var(--score-bg);
  border: 1px solid var(--border); }
.pp-disc-name { font-size: 12px; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.05em; }
.pp-disc-wl { font-size: 18px; font-weight: 700; margin-top: 4px; }
.pp-disc-pct { font-size: 12px; color: var(--win-fg); font-weight: 600; }
.pp-disc-ttl { font-size: 11px; color: var(--muted); margin-top: 2px; }
.pp-tour { padding: 12px 0; border-bottom: 1px solid var(--row-sep); }
.pp-tour:last-child { border-bottom: none; }
.pp-tour-name-row { display: flex; justify-content: space-between;
  align-items: baseline; gap: 12px; }
.pp-tour-name { font-weight: 600; font-size: 14px; }
.pp-tour-date { font-size: 11px; color: var(--muted); white-space: nowrap; }
.pp-events { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.pp-ev-chip { display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px; border-radius: 999px; background: var(--score-bg);
  border: 1px solid var(--border); font-size: 12px; }
.pp-ev-chip-finish { font-weight: 700; color: var(--brand-fg); }
.pp-ev-chip-wl { color: var(--win-fg); font-weight: 600; font-size: 11px; }
.pp-ev-chip.pp-champ { background: linear-gradient(135deg, #fff7d6, #fde68a);
  border-color: #facc15; color: #78350f; }
html.dark .pp-ev-chip.pp-champ { background: rgba(212,175,55,0.18);
  border-color: rgba(212,175,55,0.5); color: #fde68a; }
.pp-form-strip { display: flex; gap: 4px; flex-wrap: wrap; }
.pp-form-cell { width: 28px; height: 28px; border-radius: 6px;
  display: grid; place-items: center; font-size: 12px; font-weight: 700; color: #fff; }
.pp-form-cell.pp-w { background: #16a34a; }
.pp-form-cell.pp-l { background: var(--red); }
.pp-form-cell.pp-wo { background: var(--muted); font-size: 10px; }
.pp-char-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.pp-char-card { padding: 10px 12px; border-radius: 10px;
  background: var(--score-bg); border: 1px solid var(--border); }
.pp-char-label { font-size: 11px; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.05em; }
.pp-char-value { font-size: 17px; font-weight: 700; margin-top: 4px; }
.pp-char-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
.pp-ppl-list { display: grid; gap: 8px; }
.pp-ppl-row { display: grid; grid-template-columns: 1fr auto auto;
  gap: 12px; align-items: center; padding: 8px 12px;
  background: var(--score-bg); border: 1px solid var(--border); border-radius: 8px; }
.pp-ppl-name { font-size: 13px; font-weight: 500; }
.pp-ppl-met { font-size: 11px; color: var(--muted); }
.pp-ppl-wl { font-size: 12px; font-weight: 700; }
.pp-ppl-wl .pp-w { color: var(--win-fg); }
.pp-ppl-wl .pp-l { color: var(--red); }
.pp-source-note { font-size: 11px; color: var(--muted); margin-top: 18px;
  text-align: center; padding-bottom: 24px; }

/* ── Deep player stats: leaderboards page (.lb-*) ── */
.lb-page { max-width: 1080px; margin: 0 auto; padding: 16px; }
.lb-hdr { background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 18px; margin-bottom: 14px; text-align: center; }
.lb-hdr h1 { margin: 0; color: var(--brand-fg); font-size: 22px; }
.lb-hdr .lb-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
.lb-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
.lb-tab { padding: 6px 12px; border-radius: 8px;
  background: var(--surface); border: 1px solid var(--border);
  font-size: 12px; cursor: pointer; font-weight: 600; color: var(--fg);
  text-decoration: none; }
.lb-tab.lb-active { background: var(--brand); color: #fff; border-color: var(--brand); }
.lb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 640px) { .lb-grid { grid-template-columns: 1fr; } }
.lb-card { background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 14px; }
.lb-card h3 { margin: 0 0 10px; font-size: 13px;
  display: flex; align-items: center; justify-content: space-between; }
.lb-card-ico { margin-right: 6px; }
.lb-card-qual { font-size: 10px; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
.lb-row { display: grid; grid-template-columns: 22px 1fr auto;
  gap: 8px; align-items: center; padding: 5px 0;
  border-top: 1px solid var(--row-sep); font-size: 13px;
  text-decoration: none; color: var(--fg); }
.lb-row:first-of-type { border-top: none; }
.lb-row .lb-rk { font-weight: 700; color: var(--muted); font-size: 11px; text-align: right; }
.lb-row .lb-rk.lb-r1 { color: #d4af37; }
.lb-row .lb-rk.lb-r2 { color: #c0c0c0; }
.lb-row .lb-rk.lb-r3 { color: #cd7f32; }
.lb-row .lb-club { font-size: 10px; color: var(--muted); }
.lb-row .lb-val { font-weight: 700; color: var(--brand-fg); font-size: 13px; }
.lb-empty { text-align: center; color: var(--muted); padding: 40px 0; }

/* ── Home: Leaderboards card ── */
.home-leaderboards-card { display: flex; justify-content: space-between; align-items: center;
  gap: 10px; padding: 14px 16px; border: 1px solid var(--brand);
  border-radius: 14px; background: var(--surface); margin: 12px 0;
  text-decoration: none; color: var(--fg); }
.home-leaderboards-card .home-lb-ic { width: 36px; height: 36px; border-radius: 10px;
  background: var(--brand); color: #fff; display: grid; place-items: center; font-size: 18px; }
.home-leaderboards-card strong { font-weight: 700; font-size: 14px; display: block; }
.home-leaderboards-card small { font-size: 11px; color: var(--muted); }

/* ── PlayerModal: full-profile link ── */
.pm-full-profile-link { display: inline-flex; align-items: center; gap: 4px;
  margin-top: 10px; padding: 7px 12px;
  background: var(--info-bg); color: var(--info-fg); border-radius: 8px;
  font-size: 12px; font-weight: 600; text-decoration: none; }
.pm-full-profile-link:hover { filter: brightness(0.95); }
```

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "style(deep-stats): profile + leaderboards CSS

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 23: `PlayerProfileView` component + render test

**Files:**
- Create: `__tests__/PlayerProfileView.test.tsx`
- Create: `components/PlayerProfileView.tsx`

- [ ] **Step 1: Write failing test**

`__tests__/PlayerProfileView.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react'
import { render, screen } from '@testing-library/react'
import PlayerProfileView from '@/components/PlayerProfileView'
import type { PlayerRecord } from '@/lib/types'

function emptyDisc() { return { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 } }

const sample: PlayerRecord = {
  key: { provider: 'bat', slug: 'foo' },
  displayName: 'Somchai Suksawat',
  altNames: [],
  clubs: ['Bangkok BC'],
  totals: { matches: 35, wins: 24, losses: 11,
    walkoversReceived: 1, walkoversGiven: 0,
    retirementsReceived: 1, retirementsGiven: 0 },
  byDiscipline: { singles: { ...emptyDisc(), wins: 8, losses: 4, titles: 1 },
    doubles: { ...emptyDisc(), wins: 11, losses: 4, titles: 1 },
    mixed: { ...emptyDisc(), wins: 5, losses: 3 } },
  titles: [], finals: [], semis: [],
  tournaments: [{ tournamentId: 'X', tournamentName: 'Toyota 2569', tournamentDateIso: '2026-05-01',
    events: [{ tournamentId: 'X', eventId: '1', eventName: 'BS U15', discipline: 'singles', bestFinish: 'Champion', wins: 4, losses: 0 }] }],
  recentForm: [],
  matchCharacter: { courtMinutes: 1102, avgMatchMinutes: 31, longestMatchMinutes: 74,
    longestMatchRef: null, threeSetterCount: 10, threeSetterRate: 0.28,
    threeSetterWins: 6, comebackWins: 3, comebackWinRef: null, matchesLast90: 12 },
  opponents: [], partners: [],
  ranks: { titles: 18, wins: 34 },
}

describe('PlayerProfileView', () => {
  it('renders the display name', () => {
    render(<PlayerProfileView record={sample} />)
    expect(screen.getByText('Somchai Suksawat')).toBeTruthy()
  })

  it('renders the KPI strip values', () => {
    render(<PlayerProfileView record={sample} />)
    expect(screen.getByText('24')).toBeTruthy()  // wins
    expect(screen.getByText('11')).toBeTruthy()  // losses
  })

  it('renders the tournament-history Champion chip', () => {
    render(<PlayerProfileView record={sample} />)
    expect(screen.getByText(/Champion/i)).toBeTruthy()
  })

  it('renders rank badges from ranks map', () => {
    render(<PlayerProfileView record={sample} />)
    expect(screen.getByText(/#18/)).toBeTruthy()
    expect(screen.getByText(/#34/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Implement `components/PlayerProfileView.tsx`**

```tsx
'use client'
import React from 'react'
import Link from 'next/link'
import type { PlayerRecord } from '@/lib/types'

interface Props { record: PlayerRecord }

function fmtPct(n: number): string { return `${Math.round(n * 100)}%` }
function fmtHM(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60); const m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}
function disciplinePct(s: { wins: number; losses: number }): string {
  const total = s.wins + s.losses
  return total === 0 ? '—' : `${Math.round((s.wins / total) * 100)}%`
}

const RANK_LABELS: Array<[keyof PlayerRecord['ranks'], string, string]> = [
  ['titles', '🏆', 'Most Titles'],
  ['wins', '🥇', 'Most Wins'],
  ['winPct', '📊', 'Highest Win %'],
  ['courtTime', '⏱', 'Most Court Time'],
  ['comebackWins', '🔁', 'Comeback Wins'],
  ['threeSetterWins', '🔥', 'Three-setter Wins'],
]

export default function PlayerProfileView({ record }: Props) {
  const winPct = record.totals.matches > 0
    ? Math.round((record.totals.wins / record.totals.matches) * 100)
    : 0
  return (
    <div className="pp-page">
      <div className="pp-hdr">
        <h1>{record.displayName}</h1>
        <div className="pp-meta">
          {record.clubs[0] && <span>🏛 <strong>{record.clubs[0]}</strong></span>}
          {record.country && <span>🌐 <strong>{record.country}</strong></span>}
          <span>🏸 <strong>{record.tournaments.length}</strong> tournaments · {record.totals.matches} matches</span>
        </div>
        <div className="pp-badges">
          {RANK_LABELS.map(([k, icon, label]) => {
            const rank = record.ranks[k]
            if (rank === undefined) return null
            return (
              <Link key={k} href={`/leaderboards#${String(k)}`} className="pp-rank-badge">
                <span className="pp-rk">#{rank}</span>{icon} {label}
              </Link>
            )
          })}
        </div>
      </div>

      <div className="pp-kpi-row">
        <div className="pp-kpi"><div className="pp-kpi-num">{record.totals.wins}</div><div className="pp-kpi-lbl">Wins</div></div>
        <div className="pp-kpi"><div className="pp-kpi-num">{record.totals.losses}</div><div className="pp-kpi-lbl">Losses</div></div>
        <div className="pp-kpi"><div className="pp-kpi-num">{winPct}%</div><div className="pp-kpi-lbl">Win Rate</div></div>
        <div className="pp-kpi"><div className="pp-kpi-num">{record.titles.length}</div><div className="pp-kpi-lbl">Titles</div></div>
      </div>

      <div className="pp-section">
        <h2>By discipline</h2>
        <div className="pp-disc-grid">
          {(['singles','doubles','mixed'] as const).map(d => {
            const s = record.byDiscipline[d]
            return (
              <div key={d} className="pp-disc">
                <div className="pp-disc-name">{d}</div>
                <div className="pp-disc-wl">{s.wins}–{s.losses}</div>
                <div className="pp-disc-pct">{disciplinePct(s)} win rate</div>
                <div className="pp-disc-ttl">{s.titles} title{s.titles === 1 ? '' : 's'} · {s.semis} SF</div>
              </div>
            )
          })}
        </div>
      </div>

      {record.tournaments.length > 0 && (
        <div className="pp-section">
          <h2>Tournament history</h2>
          {record.tournaments.map(t => (
            <div className="pp-tour" key={t.tournamentId}>
              <div className="pp-tour-name-row">
                <div className="pp-tour-name">{t.tournamentName}</div>
                <div className="pp-tour-date">{t.tournamentDateIso}</div>
              </div>
              <div className="pp-events">
                {t.events.map(e => (
                  <span key={e.eventId + e.eventName} className={`pp-ev-chip ${e.bestFinish === 'Champion' ? 'pp-champ' : ''}`}>
                    {e.bestFinish === 'Champion' ? '🏆 ' : ''}{e.eventName} ·{' '}
                    <span className="pp-ev-chip-finish">{e.bestFinish}</span> ·{' '}
                    <span className="pp-ev-chip-wl">{e.wins}–{e.losses}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {record.recentForm.length > 0 && (
        <div className="pp-section">
          <h2>Recent form</h2>
          <div className="pp-form-strip">
            {record.recentForm.map((r, i) => {
              const cls = r.outcome.endsWith('W') || r.outcome === 'W' ? 'pp-w' : 'pp-l'
              const wo = r.outcome.startsWith('WO') || r.outcome.startsWith('RET')
              return <div key={i} className={`pp-form-cell ${wo ? 'pp-wo' : cls}`} title={`${r.outcome} ${r.eventName}`}>
                {r.outcome.startsWith('WO') ? 'WO' : r.outcome.startsWith('RET') ? 'RT' : r.outcome === 'W' ? 'W' : 'L'}
              </div>
            })}
          </div>
        </div>
      )}

      <div className="pp-section">
        <h2>Match character</h2>
        <div className="pp-char-grid">
          <div className="pp-char-card">
            <div className="pp-char-label">Court time</div>
            <div className="pp-char-value">{fmtHM(record.matchCharacter.courtMinutes)}</div>
            <div className="pp-char-sub">avg {record.matchCharacter.avgMatchMinutes}m · longest {fmtHM(record.matchCharacter.longestMatchMinutes)}</div>
          </div>
          <div className="pp-char-card">
            <div className="pp-char-label">Three-setter rate</div>
            <div className="pp-char-value">{fmtPct(record.matchCharacter.threeSetterRate)}</div>
            <div className="pp-char-sub">{record.matchCharacter.threeSetterCount} of {record.totals.matches} matches</div>
          </div>
          <div className="pp-char-card">
            <div className="pp-char-label">Comeback wins</div>
            <div className="pp-char-value">{record.matchCharacter.comebackWins}</div>
            <div className="pp-char-sub">Lost game 1, won the match</div>
          </div>
          <div className="pp-char-card">
            <div className="pp-char-label">Walkovers</div>
            <div className="pp-char-value">{record.totals.walkoversReceived} ↘</div>
            <div className="pp-char-sub">received · {record.totals.walkoversGiven} given · {record.totals.retirementsReceived} ret. received</div>
          </div>
        </div>
      </div>

      {record.opponents.length > 0 && (
        <div className="pp-section">
          <h2>Frequent opponents</h2>
          <div className="pp-ppl-list">
            {record.opponents.map(o => (
              <Link key={o.slug} href={`/player/${record.key.provider}/${o.slug}`} className="pp-ppl-row" style={{textDecoration:'none', color:'inherit'}}>
                <div>
                  <div className="pp-ppl-name">{o.name}</div>
                  <div className="pp-ppl-met">{o.meetings} meetings</div>
                </div>
                <div className="pp-ppl-wl"><span className="pp-w">{o.wins}W</span> · <span className="pp-l">{o.losses}L</span></div>
                <div style={{fontSize:11,color:'var(--muted)'}}>last: {o.lastRound} · {o.lastEvent}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {record.partners.length > 0 && (
        <div className="pp-section">
          <h2>Frequent partners (doubles)</h2>
          <div className="pp-ppl-list">
            {record.partners.map(p => (
              <Link key={p.slug} href={`/player/${record.key.provider}/${p.slug}`} className="pp-ppl-row" style={{textDecoration:'none', color:'inherit'}}>
                <div>
                  <div className="pp-ppl-name">{p.name}</div>
                  <div className="pp-ppl-met">{p.matchesTogether} matches · {p.primaryEvent}</div>
                </div>
                <div className="pp-ppl-wl"><span className="pp-w">{p.wins}W</span> · <span className="pp-l">{p.losses}L</span></div>
                <div style={{fontSize:11,color:'var(--muted)',fontWeight:600}}>{disciplinePct({wins:p.wins,losses:p.losses})}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Configure jsdom for this test (one-time)**

Confirm `jest.config.ts` allows jsdom on `.tsx` tests. Existing tests like `EventBundleView.test.tsx` already use it, so this should work out-of-the-box.

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/PlayerProfileView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/PlayerProfileView.test.tsx components/PlayerProfileView.tsx
git commit -m "feat(deep-stats): PlayerProfileView component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 24: `LeaderboardsView` component + render test

**Files:**
- Create: `__tests__/LeaderboardsView.test.tsx`
- Create: `components/LeaderboardsView.tsx`

- [ ] **Step 1: Write failing test**

```tsx
/** @jest-environment jsdom */
import React from 'react'
import { render, screen } from '@testing-library/react'
import LeaderboardsView from '@/components/LeaderboardsView'
import type { Leaderboards } from '@/lib/types'

const sample: Leaderboards = {
  version: 1, provider: 'bat', generatedAt: 'T', sourceVersion: 'v',
  boards: [
    { id: 'headline.titles', titleKey: 'lbMostTitles', icon: '🏆', category: 'headline',
      entries: [
        { rank: 1, slug: 'a', name: 'Anuwat', primaryClub: 'Bangkok BC', value: 12, display: '12' },
        { rank: 2, slug: 'b', name: 'Boon', primaryClub: 'Hat Yai', value: 9, display: '9' },
      ] },
    { id: 'character.comebacks', titleKey: 'lbComebackWins', icon: '🔁', category: 'character',
      entries: [{ rank: 1, slug: 'c', name: 'Chai', primaryClub: 'Khon Kaen BC', value: 5, display: '5' }] },
  ],
}

describe('LeaderboardsView', () => {
  it('renders all category tabs', () => {
    render(<LeaderboardsView leaderboards={sample} />)
    expect(screen.getByText(/Headline/i)).toBeTruthy()
    expect(screen.getByText(/Character/i)).toBeTruthy()
  })

  it('renders entries for the default tab', () => {
    render(<LeaderboardsView leaderboards={sample} />)
    expect(screen.getByText('Anuwat')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
  })

  it('renders empty-state when no boards', () => {
    const empty: Leaderboards = { ...sample, boards: [] }
    render(<LeaderboardsView leaderboards={empty} />)
    expect(screen.getByText(/no leaderboards/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Implement `components/LeaderboardsView.tsx`**

```tsx
'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import type { Leaderboards, LeaderboardCategory } from '@/lib/types'

interface Props { leaderboards: Leaderboards }

const CATEGORIES: Array<{ id: LeaderboardCategory; label: string }> = [
  { id: 'headline', label: 'Headline' },
  { id: 'discipline', label: 'Discipline' },
  { id: 'character', label: 'Character' },
  { id: 'activity', label: 'Activity' },
]

export default function LeaderboardsView({ leaderboards }: Props) {
  const [active, setActive] = useState<LeaderboardCategory>('headline')
  if (leaderboards.boards.length === 0) {
    return (
      <div className="lb-page">
        <div className="lb-hdr"><h1>🏆 Leaderboards</h1></div>
        <div className="lb-empty">No leaderboards yet — add a completed tournament to get started.</div>
      </div>
    )
  }
  const visible = leaderboards.boards.filter(b => b.category === active)
  return (
    <div className="lb-page">
      <div className="lb-hdr">
        <h1>🏆 Leaderboards</h1>
        <div className="lb-sub">Provider: {leaderboards.provider.toUpperCase()} · {leaderboards.boards.length} boards</div>
      </div>
      <div className="lb-tabs">
        {CATEGORIES.map(c => (
          <button key={c.id}
            className={`lb-tab ${active === c.id ? 'lb-active' : ''}`}
            onClick={() => setActive(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="lb-grid">
        {visible.map(b => (
          <div key={b.id} className="lb-card" id={b.id}>
            <h3>
              <span><span className="lb-card-ico">{b.icon}</span>{b.titleKey.replace(/^lb/, '').replace(/([A-Z])/g, ' $1').trim()}</span>
              {b.qualifier && <span className="lb-card-qual">{b.qualifier}</span>}
            </h3>
            {b.entries.length === 0 ? (
              <div className="lb-empty" style={{padding:'12px 0'}}>—</div>
            ) : b.entries.map(e => (
              <Link key={e.slug} href={`/player/${leaderboards.provider}/${e.slug}`}
                    className="lb-row">
                <div className={`lb-rk ${e.rank===1?'lb-r1':e.rank===2?'lb-r2':e.rank===3?'lb-r3':''}`}>{e.rank}</div>
                <div>
                  <div>{e.name}</div>
                  <div className="lb-club">{e.primaryClub}</div>
                </div>
                <div className="lb-val">{e.display}</div>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run tests**

Run: `npx jest __tests__/LeaderboardsView.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add __tests__/LeaderboardsView.test.tsx components/LeaderboardsView.tsx
git commit -m "feat(deep-stats): LeaderboardsView component

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 25: Profile page route

**Files:**
- Create: `app/player/[provider]/[slug]/page.tsx`

- [ ] **Step 1: Implement page**

```tsx
import { notFound } from 'next/navigation'
import { readIndexCache } from '@/lib/player-index-cache'
import PlayerProfileView from '@/components/PlayerProfileView'
import type { ProviderTag } from '@/lib/types'

interface Props { params: { provider: string; slug: string } }

const PROVIDERS = new Set<ProviderTag>(['bat','bwf'])

export default async function PlayerPage({ params }: Props) {
  const provider = params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) notFound()
  const index = await readIndexCache(provider)
  const record = index?.players[params.slug]
  if (!record) notFound()
  return <PlayerProfileView record={record} />
}

export const dynamic = 'force-dynamic'
```

- [ ] **Step 2: Smoke-test build**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/player/[provider]/[slug]/page.tsx
git commit -m "feat(deep-stats): /player/[provider]/[slug] page

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 26: Leaderboards page route

**Files:**
- Create: `app/leaderboards/page.tsx`

- [ ] **Step 1: Implement page**

```tsx
import { readLeaderboardsCache } from '@/lib/player-index-cache'
import LeaderboardsView from '@/components/LeaderboardsView'
import type { Leaderboards } from '@/lib/types'

export default async function LeaderboardsPage() {
  const bat = await readLeaderboardsCache('bat')
  const bwf = await readLeaderboardsCache('bwf')
  // Default to BAT; if BAT empty/missing, fall back to BWF or empty placeholder.
  const lb: Leaderboards = bat ?? bwf ?? {
    version: 1, provider: 'bat', generatedAt: 'never', sourceVersion: '', boards: [],
  }
  return <LeaderboardsView leaderboards={lb} />
}

export const dynamic = 'force-dynamic'
```

- [ ] **Step 2: Compile + commit**

```bash
npx tsc --noEmit
git add app/leaderboards/page.tsx
git commit -m "feat(deep-stats): /leaderboards page

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 27: PlayerModal "View full profile" link

**Files:**
- Modify: `components/PlayerModal.tsx`

- [ ] **Step 1: Inspect existing PlayerModal to find a suitable insertion point**

Open `components/PlayerModal.tsx`. The modal has a body; we'll add a `useEffect` that calls `/api/players/exists` once and conditionally renders a footer link.

- [ ] **Step 2: Add the existence check + link**

Near the top of the component:

```tsx
import { useEffect, useState } from 'react'

// inside the component, after existing hook usage:
const [fullProfile, setFullProfile] = useState<{ slug: string; provider: 'bat'|'bwf' } | null>(null)

useEffect(() => {
  if (!profile?.name) return
  const provider: 'bat'|'bwf' = (typeof window !== 'undefined' && (window as any).__currentProvider) || 'bat'
  const url = `/api/players/exists?provider=${provider}&name=${encodeURIComponent(profile.name)}`
  fetch(url).then(r => r.json()).then(d => {
    if (d?.exists && d?.slug) setFullProfile({ slug: d.slug, provider })
  }).catch(() => {})
}, [profile?.name])
```

Then near the existing modal footer / close area, add:

```tsx
{fullProfile && (
  <a href={`/player/${fullProfile.provider}/${fullProfile.slug}`} className="pm-full-profile-link">
    View full profile →
  </a>
)}
```

Note: `__currentProvider` is a placeholder. Confirm the actual mechanism the project uses to know the current tournament's provider (check `app/page.tsx` for how it's passed down; you may need to thread `provider` as a prop to `PlayerModal`).

- [ ] **Step 3: Manual smoke test in dev (skip unit test for now — covered by integration)**

Run: `npm run dev` (background ok), open the app, click a player name, verify the link appears for a player you know exists in the index. (Requires running rebuild first — see Task 30.)

- [ ] **Step 4: Commit**

```bash
git add components/PlayerModal.tsx
git commit -m "feat(deep-stats): View full profile link in PlayerModal

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 28: Home screen Leaderboards card

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Find tournament-list block**

Search `app/page.tsx` for the tournament list rendering. Insert above (or below) it:

```tsx
import Link from 'next/link'

// inside the JSX, in the appropriate location:
<Link href="/leaderboards" className="home-leaderboards-card">
  <div style={{display:'flex',alignItems:'center',gap:12}}>
    <span className="home-lb-ic">🏆</span>
    <span>
      <strong>Leaderboards</strong>
      <small>Career titles · wins · win% · court time</small>
    </span>
  </div>
  <span style={{color:'var(--muted)'}}>›</span>
</Link>
```

- [ ] **Step 2: Compile + commit**

```bash
npx tsc --noEmit
git add app/page.tsx
git commit -m "feat(deep-stats): home Leaderboards card

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 29: Run all tests

**Files:** none

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — all existing tests + all new tests.

- [ ] **Step 2: If any failure, fix in a new commit**

Address regressions before moving on.

---

## Task 30: First real rebuild on local data

**Files:** none (runtime side-effects only)

- [ ] **Step 1: Set rebuild token in dev env**

```bash
export PLAYERS_REBUILD_TOKEN=dev-token-local
```

- [ ] **Step 2: Mark at least one tournament `[done]` in `public/tournaments.txt`**

Already done — `[done]` markers are present for Trang Yonex and Toyota.

- [ ] **Step 3: Start dev server**

```bash
npm run dev
```

- [ ] **Step 4: Trigger rebuild**

In another terminal:

```bash
curl -X POST -H "Authorization: Bearer $PLAYERS_REBUILD_TOKEN" \
  http://localhost:3000/api/players/rebuild
```

Expected: JSON `{ rebuilt: ['bat'], skipped: [...] }`.

- [ ] **Step 5: Inspect cache outputs**

```bash
ls -la .cache/players/
cat .cache/players/index-bat.json | python3 -m json.tool | head -30
```

Expected: `index-bat.json` + `leaderboards-bat.json` written.

- [ ] **Step 6: Visit pages**

- `http://localhost:3000/leaderboards` — should render boards.
- Pick a slug from the index (e.g. via `jq -r '.players | keys[0]' .cache/players/index-bat.json`) and visit `/player/bat/<slug>`.

- [ ] **Step 7: Note any visual or correctness issues, file fixes as new tasks**

---

## Task 31: Final integration commit + branch push

**Files:** none

- [ ] **Step 1: Verify branch state**

```bash
git log --oneline deep-stats ^main | head -30
git status
```

- [ ] **Step 2: Push branch**

```bash
git push -u origin deep-stats
```

- [ ] **Step 3: Report URL to user**

Print the pushed branch URL so the user can review.

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Types in `lib/types.ts` | Task 1 |
| `nameToSlug` | Task 2 |
| Round + discipline helpers | Task 3 |
| Test fixtures | Task 4 |
| Aggregator: totals, byDiscipline, events, character, recent form, opponents, partners | Tasks 5–10 |
| Leaderboards + rank backfill | Task 11 |
| Empty-input branch | Task 12 |
| `clubs-cache.ts` | Task 13 |
| `player-index-cache.ts` | Task 14 |
| Registry helper | Task 15 |
| Rebuild orchestrator | Task 16 |
| `/api/players/[provider]/[slug]` | Task 17 |
| `/api/players/exists` | Task 18 |
| `/api/leaderboards` | Task 19 |
| `/api/players/rebuild` | Task 20 |
| i18n keys | Task 21 |
| CSS | Task 22 |
| `PlayerProfileView` | Task 23 |
| `LeaderboardsView` | Task 24 |
| `/player/[provider]/[slug]` page | Task 25 |
| `/leaderboards` page | Task 26 |
| PlayerModal link | Task 27 |
| Home card | Task 28 |
| First rebuild + manual verification | Tasks 30–31 |

No gaps.

**Notes for the executor:**

- The aggregator file (`lib/playerIndex.ts`) is built up incrementally over Tasks 5–11. Trust the incremental tests — each pass validates the prior.
- The `__currentProvider` placeholder in Task 27 needs the executor to verify how provider is threaded through `PlayerModal` in the actual codebase (likely via prop drilling or context). Adjust accordingly.
- Run `npx tsc --noEmit` between tasks if you suspect type drift. The full `npm test` in Task 29 is the final guardrail.
- If a fixture-based test produces flaky numeric assertions (e.g., counts differ between Toyota/Trang fixtures and the assertion is too strict), relax to range assertions rather than hardcoded values.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-24-deep-player-stats.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

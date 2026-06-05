# Pre-start Tournament Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `"Competition hasn't started"` empty state with an entry-phase stats panel (hype + by-the-numbers + logistics) that ticks into the existing result-phase sections as matches finalize, on the same polling loop.

**Architecture:** Single-endpoint extension of `aggregate()` in `lib/tournamentStats.ts` with five new builder functions and an extended signature; the `/api/stats` route fetches three additional inputs (draws, overview, prior-edition winners) in parallel and threads them through; `TournamentStatsPanel` replaces its page-level empty state with per-section guards and renders five new sections plus an explanatory footer.

**Tech Stack:** Next.js (app router), TypeScript, React 18, Jest + React Testing Library, existing cache layer (`lib/{stats,draws,overview,bracket}-cache.ts`).

**Spec deviation note:** The spec describes `potentialCollisions` as parsing seed positions from cached `BracketData` HTML. After reviewing the available data, this plan derives collisions from `TournamentOverview.seedEvents` using BWF/badminton seeding convention (#1 vs #4 in one half, #2 vs #3 in the other, F = SF1-winner vs SF2-winner) instead. This drops the `brackets?` input to `aggregate()` and removes the per-draw bracket fetches from the route. Rationale: simpler, deterministic, fully testable, no new HTML parser. If federation-specific seedings ever produce wrong projections, switch to the spec's bracket-walk approach in a follow-up.

---

## File structure

**Create:**
- `lib/priorEdition.ts` — heuristic resolver for the prior edition of a tournament + per-event winner lookup
- `__tests__/priorEdition.test.ts`
- `__tests__/TournamentStatsPanel.test.tsx`

**Modify:**
- `lib/types.ts` — type additions (`StatsKpis`, `StatsEventRow`, 5 new optional top-level types on `ComputedStats`)
- `lib/tournamentStats.ts` — 5 new builders, extended `aggregate()` signature, `EMPTY` shape, `buildKpis` + `buildEvents` + `buildDailyVolume` extensions
- `lib/stats-generator.ts` — pass new inputs through `ensureStatsCachedForTournament`
- `lib/stats-cache.ts` — pre-match `sourceVersion` helper
- `app/api/stats/route.ts` — parallel fetches for new inputs + pre-match `sourceVersion`
- `components/TournamentStatsPanel.tsx` — per-section guards, 5 new sections, KPI/Events degradation, footer
- `app/globals.css` — styles for new sections
- `lib/i18n.ts` — 14 new EN+TH keys
- `__tests__/tournamentStats.test.ts` — new test cases
- `__tests__/api-stats-route.test.ts` — new test cases

---

## Task 1: Add type definitions

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add new optional top-level types**

Add the following near the end of the existing `Stats*` type block (right above `interface ComputedStats`):

```ts
export interface StatsSeedHead {
  players: string[]
  club?: string
}

export interface StatsSeedHeadlineSeed {
  seed: number
  players: string[]
  club?: string
}

export interface StatsSeedHeadline {
  event: string
  seeds: StatsSeedHeadlineSeed[]
}

export interface StatsMultiEventEntry {
  playerId: string
  name: string
  club: string
  events: string[]
}

export interface StatsCollisionSeedRef {
  seed: number
  players: string[]
  club?: string
}

export interface StatsCollisionPair {
  sideA: StatsCollisionSeedRef
  sideB: StatsCollisionSeedRef
}

export interface StatsPotentialCollision {
  event: string
  semis: StatsCollisionPair[]
  final?: StatsCollisionPair
}

export interface StatsDefendingChampion {
  event: string
  players: string[]
  club?: string
  priorEditionId: string
  priorEditionLabel: string
}

export interface StatsScheduledMatch {
  time: string
  event: string
  round: string
  team1: string[]
  team2: string[]
  sequenceLabel?: string
}

export interface StatsScheduleCourtBucket {
  court: string
  matches: StatsScheduledMatch[]
}

export interface StatsSchedulePreview {
  firstDayLabel: string
  matchCount: number
  courts: number
  opensAt?: string
  openingDayByCourt: StatsScheduleCourtBucket[]
}
```

- [ ] **Step 2: Extend `StatsKpis`**

Modify the existing `StatsKpis` interface in `lib/types.ts` to add `entries` and `draws`:

```ts
export interface StatsKpis {
  events: number
  matches: number
  decided: number
  walkovers: number
  retired: number
  nowPlaying: number
  players: number
  multiEventPlayers: number
  courtMinutes: number
  avgMatchMinutes: number
  threeSetterRate: number
  entries: number
  draws: number
}
```

- [ ] **Step 3: Extend `StatsEventRow`**

Modify the existing `StatsEventRow` interface to add four optional pre-match fields:

```ts
export interface StatsEventRow {
  name: string
  matches: number
  threeSetters: number
  walkovers: number
  decided: number
  avgMinutes: number
  players: number
  winner: string[]
  winnerSeed?: string
  size?: number
  type?: 'KO' | 'RR+PO'
  entries?: number
  topSeed?: StatsSeedHead
}
```

- [ ] **Step 4: Extend `ComputedStats`**

Add all five new optional top-level fields to `ComputedStats`:

```ts
export interface ComputedStats {
  kpis: StatsKpis
  dailyVolume: StatsDailyRow[]
  events: StatsEventRow[]
  drama: StatsDrama
  topPlayers: StatsTopPlayer[]
  courtUtilization: StatsCourt[]
  clubMedals: StatsClubMedal[]
  multiGoldPlayers: StatsMultiGoldPlayer[]
  clubRosters: StatsClubRoster[]
  countryRosters: StatsCountryRoster[]
  integrity: StatsIntegrity
  seedHeadlines?: StatsSeedHeadline[]
  multiEventEntries?: StatsMultiEventEntry[]
  potentialCollisions?: StatsPotentialCollision[]
  defendingChampion?: StatsDefendingChampion[]
  schedulePreview?: StatsSchedulePreview
}
```

- [ ] **Step 5: Update `EMPTY` in `lib/tournamentStats.ts` for new KPI fields**

Modify the existing `EMPTY` constant at `lib/tournamentStats.ts:16` to include `entries: 0` and `draws: 0` in the `kpis` block. Do not add the new top-level optional fields to `EMPTY` — leaving them undefined is the correct empty-state.

```ts
const EMPTY: ComputedStats = {
  kpis: {
    events: 0, matches: 0, decided: 0, walkovers: 0, retired: 0, nowPlaying: 0,
    players: 0, multiEventPlayers: 0, courtMinutes: 0, avgMatchMinutes: 0,
    threeSetterRate: 0, entries: 0, draws: 0,
  },
  dailyVolume: [],
  events: [],
  drama: { marathon: null, highestSet: null, highestScoringMatch: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null },
  topPlayers: [],
  courtUtilization: [],
  clubMedals: [],
  multiGoldPlayers: [],
  clubRosters: [],
  countryRosters: [],
  integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors)

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/tournamentStats.ts
git commit -m "feat(stats): add pre-match type extensions to ComputedStats"
```

---

## Task 2: `buildSeedHeadlines` builder

**Files:**
- Modify: `lib/tournamentStats.ts`
- Test: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Write the failing test**

Add at the end of `__tests__/tournamentStats.test.ts`:

```ts
import { buildSeedHeadlines } from '@/lib/tournamentStats'
import type { TournamentOverview } from '@/lib/types'

describe('buildSeedHeadlines', () => {
  test('returns empty when overview is undefined', () => {
    expect(buildSeedHeadlines(undefined, {})).toEqual([])
  })

  test('returns top-2 seeds per event with club lookups', () => {
    const overview: TournamentOverview = {
      notes: [],
      seedEvents: [
        {
          eventName: 'MS',
          seeds: [
            { seed: 1, players: ['p1'] },
            { seed: 2, players: ['p2'] },
            { seed: 3, players: ['p3'] },
          ],
        },
      ],
    }
    const clubs: Record<string, string> = { p1: 'CLUB-A', p2: 'CLUB-B' }
    expect(buildSeedHeadlines(overview, clubs)).toEqual([
      {
        event: 'MS',
        seeds: [
          { seed: 1, players: ['p1'], club: 'CLUB-A' },
          { seed: 2, players: ['p2'], club: 'CLUB-B' },
        ],
      },
    ])
  })

  test('omits club when not in lookup', () => {
    const overview: TournamentOverview = {
      notes: [],
      seedEvents: [{ eventName: 'WS', seeds: [{ seed: 1, players: ['x'] }] }],
    }
    expect(buildSeedHeadlines(overview, {})).toEqual([
      { event: 'WS', seeds: [{ seed: 1, players: ['x'] }] },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'buildSeedHeadlines'`
Expected: FAIL with "buildSeedHeadlines is not a function" or "Cannot find module export"

- [ ] **Step 3: Implement `buildSeedHeadlines`**

Add to `lib/tournamentStats.ts` near the bottom (above the `aggregate` export):

```ts
export function buildSeedHeadlines(
  overview: TournamentOverview | undefined,
  clubs: Record<string, string>,
): StatsSeedHeadline[] {
  if (!overview) return []
  return overview.seedEvents.map((ev) => ({
    event: ev.eventName,
    seeds: ev.seeds
      .filter((s) => s.seed === 1 || s.seed === 2)
      .sort((a, b) => a.seed - b.seed)
      .map((s) => {
        const head: StatsSeedHeadlineSeed = { seed: s.seed, players: s.players }
        const club = s.players.map((id) => clubs[id]).find((c) => c)
        if (club) head.club = club
        return head
      }),
  }))
}
```

Add the imports at the top of `lib/tournamentStats.ts` if they're not already present: `TournamentOverview`, `StatsSeedHeadline`, `StatsSeedHeadlineSeed` from `./types`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'buildSeedHeadlines'`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add __tests__/tournamentStats.test.ts lib/tournamentStats.ts
git commit -m "feat(stats): add buildSeedHeadlines builder"
```

---

## Task 3: `buildMultiEventEntries` builder

**Files:**
- Modify: `lib/tournamentStats.ts`
- Test: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/tournamentStats.test.ts`:

```ts
import { buildMultiEventEntries } from '@/lib/tournamentStats'
import type { MatchEntry } from '@/lib/types'

function fakeRosterEntry(eventName: string, playerIds: string[]): MatchEntry {
  return {
    draw: eventName, drawNum: '', round: 'R32',
    team1: playerIds.map((id) => ({ name: id, playerId: id })),
    team2: [], winner: null, scores: [], court: '',
    walkover: false, retired: false, nowPlaying: false,
    eventName,
  }
}

describe('buildMultiEventEntries', () => {
  test('returns empty when rosterByDraw is undefined', () => {
    expect(buildMultiEventEntries(undefined, {}, {})).toEqual([])
  })

  test('returns players entered in 2+ events sorted by count desc then name', () => {
    const roster = new Map<string, MatchEntry[]>([
      ['1', [fakeRosterEntry('MS', ['p1']), fakeRosterEntry('MS', ['p2'])]],
      ['2', [fakeRosterEntry('MD', ['p1', 'p3'])]],
      ['3', [fakeRosterEntry('XD', ['p1', 'p4'])]],
      ['4', [fakeRosterEntry('WS', ['p3'])]],
    ])
    const clubs = { p1: 'CLUB-A', p3: 'CLUB-B' }
    const names = { p1: 'Alice', p3: 'Cara' }
    const out = buildMultiEventEntries(roster, clubs, names)
    expect(out).toEqual([
      { playerId: 'p1', name: 'Alice', club: 'CLUB-A', events: ['MS', 'MD', 'XD'] },
    ])
  })

  test('falls back to playerId when name is missing', () => {
    const roster = new Map<string, MatchEntry[]>([
      ['1', [fakeRosterEntry('MS', ['p9'])]],
      ['2', [fakeRosterEntry('MD', ['p9'])]],
    ])
    expect(buildMultiEventEntries(roster, {}, {})).toEqual([
      { playerId: 'p9', name: 'p9', club: '', events: ['MS', 'MD'] },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'buildMultiEventEntries'`
Expected: FAIL with "buildMultiEventEntries is not a function"

- [ ] **Step 3: Implement `buildMultiEventEntries`**

Add to `lib/tournamentStats.ts`:

```ts
export function buildMultiEventEntries(
  rosterByDraw: Map<string, MatchEntry[]> | undefined,
  clubs: Record<string, string>,
  names: Record<string, string>,
): StatsMultiEventEntry[] {
  if (!rosterByDraw || rosterByDraw.size === 0) return []
  const eventsByPlayer = new Map<string, Set<string>>()
  for (const entries of rosterByDraw.values()) {
    for (const e of entries) {
      const eventKey = e.eventName ?? e.draw
      if (!eventKey) continue
      const all = [...e.team1, ...e.team2]
      for (const p of all) {
        if (!p.playerId) continue
        let set = eventsByPlayer.get(p.playerId)
        if (!set) {
          set = new Set()
          eventsByPlayer.set(p.playerId, set)
        }
        set.add(eventKey)
      }
    }
  }
  const out: StatsMultiEventEntry[] = []
  for (const [playerId, eventSet] of eventsByPlayer) {
    if (eventSet.size < 2) continue
    const events = Array.from(eventSet)
    out.push({
      playerId,
      name: names[playerId] ?? playerId,
      club: clubs[playerId] ?? '',
      events,
    })
  }
  return out.sort((a, b) => {
    if (b.events.length !== a.events.length) return b.events.length - a.events.length
    return a.name.localeCompare(b.name)
  })
}
```

Add `StatsMultiEventEntry` to the imports from `./types`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'buildMultiEventEntries'`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add __tests__/tournamentStats.test.ts lib/tournamentStats.ts
git commit -m "feat(stats): add buildMultiEventEntries builder"
```

---

## Task 4: `buildPotentialCollisions` builder

**Files:**
- Modify: `lib/tournamentStats.ts`
- Test: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/tournamentStats.test.ts`:

```ts
import { buildPotentialCollisions } from '@/lib/tournamentStats'

describe('buildPotentialCollisions', () => {
  test('returns empty when overview is undefined', () => {
    expect(buildPotentialCollisions(undefined, {})).toEqual([])
  })

  test('produces SF + F for a 4-seed event using convention (1v4, 2v3)', () => {
    const overview = {
      notes: [],
      seedEvents: [{
        eventName: 'MS',
        seeds: [
          { seed: 1, players: ['p1'] },
          { seed: 2, players: ['p2'] },
          { seed: 3, players: ['p3'] },
          { seed: 4, players: ['p4'] },
        ],
      }],
    }
    const clubs = { p1: 'A', p2: 'B', p3: 'C', p4: 'D' }
    const out = buildPotentialCollisions(overview, clubs)
    expect(out).toEqual([{
      event: 'MS',
      semis: [
        { sideA: { seed: 1, players: ['p1'], club: 'A' }, sideB: { seed: 4, players: ['p4'], club: 'D' } },
        { sideA: { seed: 2, players: ['p2'], club: 'B' }, sideB: { seed: 3, players: ['p3'], club: 'C' } },
      ],
      final: {
        sideA: { seed: 1, players: ['p1'], club: 'A' },
        sideB: { seed: 2, players: ['p2'], club: 'B' },
      },
    }])
  })

  test('skips events with fewer than 4 seeded players', () => {
    const overview = {
      notes: [],
      seedEvents: [{
        eventName: 'WS',
        seeds: [
          { seed: 1, players: ['x'] },
          { seed: 2, players: ['y'] },
          { seed: 3, players: ['z'] },
        ],
      }],
    }
    expect(buildPotentialCollisions(overview, {})).toEqual([])
  })

  test('omits club when not in lookup', () => {
    const overview = {
      notes: [],
      seedEvents: [{
        eventName: 'XD',
        seeds: [
          { seed: 1, players: ['a'] },
          { seed: 2, players: ['b'] },
          { seed: 3, players: ['c'] },
          { seed: 4, players: ['d'] },
        ],
      }],
    }
    const out = buildPotentialCollisions(overview, {})
    expect(out[0].semis[0].sideA.club).toBeUndefined()
    expect(out[0].final?.sideB.club).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'buildPotentialCollisions'`
Expected: FAIL

- [ ] **Step 3: Implement `buildPotentialCollisions`**

Add to `lib/tournamentStats.ts`:

```ts
export function buildPotentialCollisions(
  overview: TournamentOverview | undefined,
  clubs: Record<string, string>,
): StatsPotentialCollision[] {
  if (!overview) return []
  const refOf = (seed: number, players: string[]): StatsCollisionSeedRef => {
    const ref: StatsCollisionSeedRef = { seed, players }
    const club = players.map((id) => clubs[id]).find((c) => c)
    if (club) ref.club = club
    return ref
  }
  const out: StatsPotentialCollision[] = []
  for (const ev of overview.seedEvents) {
    const byNum = new Map<number, string[]>()
    for (const s of ev.seeds) byNum.set(s.seed, s.players)
    const s1 = byNum.get(1), s2 = byNum.get(2), s3 = byNum.get(3), s4 = byNum.get(4)
    if (!s1 || !s2 || !s3 || !s4) continue
    const r1 = refOf(1, s1), r2 = refOf(2, s2), r3 = refOf(3, s3), r4 = refOf(4, s4)
    out.push({
      event: ev.eventName,
      semis: [
        { sideA: r1, sideB: r4 },
        { sideA: r2, sideB: r3 },
      ],
      final: { sideA: r1, sideB: r2 },
    })
  }
  return out
}
```

Add `StatsPotentialCollision`, `StatsCollisionSeedRef` to the imports from `./types`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'buildPotentialCollisions'`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add __tests__/tournamentStats.test.ts lib/tournamentStats.ts
git commit -m "feat(stats): add buildPotentialCollisions builder (convention-based)"
```

---

## Task 5: `buildSchedulePreview` builder

**Files:**
- Modify: `lib/tournamentStats.ts`
- Test: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/tournamentStats.test.ts`:

```ts
import { buildSchedulePreview } from '@/lib/tournamentStats'
import type { MatchScheduleGroup, MatchesData } from '@/lib/types'

describe('buildSchedulePreview', () => {
  test('returns undefined when no days', () => {
    const data: MatchesData = { days: [] } as unknown as MatchesData
    expect(buildSchedulePreview(data, new Map())).toBeUndefined()
  })

  test('returns undefined when first day has no scheduled matches', () => {
    const data = { days: [{ date: '2026-06-10', label: 'Wed', dateIso: '2026-06-10', hasMatches: true }] } as MatchesData
    const groups: MatchScheduleGroup[] = [{
      type: 'court', court: 'C1', matches: [{
        draw: 'MS', drawNum: '1', round: 'R32',
        team1: [{ name: 'A', playerId: 'a' }],
        team2: [{ name: 'B', playerId: 'b' }],
        winner: null, scores: [], court: 'C1', walkover: false, retired: false, nowPlaying: false,
      }],
    }]
    expect(buildSchedulePreview(data, new Map([['2026-06-10', groups]]))).toBeUndefined()
  })

  test('groups by court and sorts matches by time when scheduled times exist', () => {
    const data = { days: [{ date: '2026-06-10', label: 'Wed Jun 10', dateIso: '2026-06-10', hasMatches: true }] } as MatchesData
    const m = (court: string, time: string, eventName: string) => ({
      draw: eventName, drawNum: '1', round: 'R32',
      team1: [{ name: 'A', playerId: 'a' }],
      team2: [{ name: 'B', playerId: 'b' }],
      winner: null, scores: [], court, walkover: false, retired: false, nowPlaying: false,
      scheduledTime: time, eventName,
    })
    const groups: MatchScheduleGroup[] = [
      { type: 'court', court: 'C1', matches: [m('C1', '10:30', 'MS'), m('C1', '09:00', 'WS')] },
      { type: 'court', court: 'C2', matches: [m('C2', '09:15', 'MD')] },
    ]
    const preview = buildSchedulePreview(data, new Map([['2026-06-10', groups]]))
    expect(preview).toEqual({
      firstDayLabel: 'Wed Jun 10',
      matchCount: 3,
      courts: 2,
      opensAt: '09:00',
      openingDayByCourt: [
        { court: 'C1', matches: [
          expect.objectContaining({ time: '09:00', event: 'WS' }),
          expect.objectContaining({ time: '10:30', event: 'MS' }),
        ]},
        { court: 'C2', matches: [
          expect.objectContaining({ time: '09:15', event: 'MD' }),
        ]},
      ],
    })
  })

  test('returns undefined when any match on the first day already has a winner', () => {
    const data = { days: [{ date: '2026-06-10', label: 'Wed', dateIso: '2026-06-10', hasMatches: true }] } as MatchesData
    const groups: MatchScheduleGroup[] = [{
      type: 'court', court: 'C1', matches: [{
        draw: 'MS', drawNum: '1', round: 'R32',
        team1: [{ name: 'A', playerId: 'a' }],
        team2: [{ name: 'B', playerId: 'b' }],
        winner: 1, scores: [{ t1: 21, t2: 10 }], court: 'C1',
        walkover: false, retired: false, nowPlaying: false, scheduledTime: '09:00',
      }],
    }]
    expect(buildSchedulePreview(data, new Map([['2026-06-10', groups]]))).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'buildSchedulePreview'`
Expected: FAIL

- [ ] **Step 3: Implement `buildSchedulePreview`**

Add to `lib/tournamentStats.ts`:

```ts
export function buildSchedulePreview(
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
): StatsSchedulePreview | undefined {
  const firstDay = data.days.find((d) => d.hasMatches && d.dateIso)
  if (!firstDay || !firstDay.dateIso) return undefined
  const groups = dayGroupsByDate.get(firstDay.dateIso)
  if (!groups || groups.length === 0) return undefined

  const matchesByCourt = new Map<string, StatsScheduledMatch[]>()
  let any = false
  for (const g of groups) {
    for (const m of g.matches) {
      if (m.winner !== null) return undefined
      if (!m.scheduledTime) continue
      any = true
      const court = m.court || (g.type === 'court' ? g.court : '—')
      let list = matchesByCourt.get(court)
      if (!list) {
        list = []
        matchesByCourt.set(court, list)
      }
      const sched: StatsScheduledMatch = {
        time: m.scheduledTime,
        event: m.eventName ?? m.draw,
        round: m.round,
        team1: m.team1.map((p) => p.name),
        team2: m.team2.map((p) => p.name),
      }
      if (m.sequenceLabel) sched.sequenceLabel = m.sequenceLabel
      list.push(sched)
    }
  }
  if (!any) return undefined

  const openingDayByCourt: StatsScheduleCourtBucket[] = Array.from(matchesByCourt.entries())
    .map(([court, matches]) => ({
      court,
      matches: matches.sort((a, b) => a.time.localeCompare(b.time)),
    }))
    .sort((a, b) => a.court.localeCompare(b.court))

  const allTimes = openingDayByCourt.flatMap((c) => c.matches.map((m) => m.time))
  const opensAt = allTimes.sort()[0]
  const matchCount = openingDayByCourt.reduce((acc, c) => acc + c.matches.length, 0)

  return {
    firstDayLabel: firstDay.label,
    matchCount,
    courts: openingDayByCourt.length,
    opensAt,
    openingDayByCourt,
  }
}
```

Add `StatsSchedulePreview`, `StatsScheduledMatch`, `StatsScheduleCourtBucket` to the imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'buildSchedulePreview'`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add __tests__/tournamentStats.test.ts lib/tournamentStats.ts
git commit -m "feat(stats): add buildSchedulePreview builder"
```

---

## Task 6: Extend `buildKpis` with `entries` + `draws`

**Files:**
- Modify: `lib/tournamentStats.ts`
- Test: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/tournamentStats.test.ts`:

```ts
import { aggregate as aggregateFn } from '@/lib/tournamentStats'

describe('kpis entries/draws', () => {
  test('counts entries (sum across draws) and draws (number of rosterByDraw keys)', () => {
    const data = { days: [] } as unknown as MatchesData
    const roster = new Map<string, MatchEntry[]>([
      ['1', [fakeRosterEntry('MS', ['a']), fakeRosterEntry('MS', ['b'])]],   // 2 entries
      ['2', [fakeRosterEntry('MD', ['a', 'c'])]],                              // 1 doubles entry → 1
      ['3', [fakeRosterEntry('WS', ['d'])]],                                   // 1 entry
    ])
    const stats = aggregateFn(data, new Map(), {}, roster, {})
    expect(stats.kpis.entries).toBe(4)
    expect(stats.kpis.draws).toBe(3)
  })

  test('entries/draws are zero when rosterByDraw is undefined', () => {
    const data = { days: [] } as unknown as MatchesData
    const stats = aggregateFn(data, new Map(), {}, undefined, {})
    expect(stats.kpis.entries).toBe(0)
    expect(stats.kpis.draws).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'kpis entries/draws'`
Expected: FAIL (`entries` and `draws` undefined or zero when not populated)

- [ ] **Step 3: Extend `buildKpis`**

In `lib/tournamentStats.ts`, modify `buildKpis` so the returned object includes the two new fields. Add this block right before the existing return statement:

```ts
let entries = 0
const drawSet = new Set<string>()
if (rosterByDraw) {
  for (const [drawNum, list] of rosterByDraw) {
    drawSet.add(drawNum)
    entries += list.length
  }
}
```

Add `entries` and `draws: drawSet.size` to the returned `StatsKpis` object. The two new fields must be set on every return path of `buildKpis` (including the early-return paths if any).

Also update the early-return path in `aggregate()` at line 653 — the `EMPTY` const already has `entries: 0` and `draws: 0` from Task 1, so no change needed there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'kpis entries/draws'`
Expected: PASS

- [ ] **Step 5: Verify the rest of the stats suite still passes**

Run: `npx jest __tests__/tournamentStats.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add __tests__/tournamentStats.test.ts lib/tournamentStats.ts
git commit -m "feat(stats): add entries and draws KPI fields"
```

---

## Task 7: Extend `buildEvents` with pre-match fields

**Files:**
- Modify: `lib/tournamentStats.ts`
- Test: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/tournamentStats.test.ts`:

```ts
import type { DrawInfo, TournamentOverview as TO } from '@/lib/types'

describe('events pre-match decoration', () => {
  test('decorates with size, type, entries, topSeed when draws+overview present', () => {
    const data = { days: [] } as unknown as MatchesData
    const roster = new Map<string, MatchEntry[]>([
      ['10', [fakeRosterEntry('MS', ['p1']), fakeRosterEntry('MS', ['p2']), fakeRosterEntry('MS', ['p3'])]],
    ])
    const draws: DrawInfo[] = [{ drawNum: '10', name: 'Men’s Singles', size: '16', type: 'Knockout', eventName: 'MS' }]
    const overview: TO = { notes: [], seedEvents: [{ eventName: 'MS', seeds: [{ seed: 1, players: ['p1'] }] }] }
    const clubs = { p1: 'A' }
    const stats = aggregateFn(data, new Map(), clubs, roster, {}, { draws, overview })
    expect(stats.events).toHaveLength(1)
    expect(stats.events[0]).toEqual(expect.objectContaining({
      name: 'MS',
      size: 16,
      type: 'KO',
      entries: 3,
      topSeed: { players: ['p1'], club: 'A' },
    }))
  })

  test('maps Round Robin draws to RR+PO type', () => {
    const data = { days: [] } as unknown as MatchesData
    const roster = new Map<string, MatchEntry[]>([
      ['11', [fakeRosterEntry('U17 MS', ['x'])]],
    ])
    const draws: DrawInfo[] = [{ drawNum: '11', name: 'U17 MS', size: '8', type: 'Round Robin', eventName: 'U17 MS' }]
    const stats = aggregateFn(data, new Map(), {}, roster, {}, { draws })
    expect(stats.events[0]).toEqual(expect.objectContaining({ type: 'RR+PO', size: 8 }))
  })

  test('leaves pre-match fields undefined when draws not provided', () => {
    const data = { days: [] } as unknown as MatchesData
    const roster = new Map<string, MatchEntry[]>([
      ['12', [fakeRosterEntry('WS', ['w1'])]],
    ])
    const stats = aggregateFn(data, new Map(), {}, roster, {})
    expect(stats.events[0]).toEqual(expect.objectContaining({ name: 'WS' }))
    expect(stats.events[0].size).toBeUndefined()
    expect(stats.events[0].type).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'events pre-match decoration'`
Expected: FAIL (aggregate signature doesn't accept extras object, or fields undefined)

- [ ] **Step 3: Extend `buildEvents` signature and implementation**

Modify `buildEvents` in `lib/tournamentStats.ts` to accept three optional inputs:

```ts
function buildEvents(
  ctxs: MatchCtx[],
  rosterByDraw?: Map<string, MatchEntry[]>,
  draws?: DrawInfo[],
  overview?: TournamentOverview,
  clubs?: Record<string, string>,
): StatsEventRow[] {
```

Inside the function, after the existing per-event aggregation, build two index maps before assembling rows:

```ts
const drawByEvent = new Map<string, DrawInfo>()
if (draws) {
  for (const d of draws) {
    const key = d.eventName ?? d.name
    if (!drawByEvent.has(key)) drawByEvent.set(key, d)
  }
}
const topSeedByEvent = new Map<string, StatsSeedHead>()
if (overview) {
  for (const ev of overview.seedEvents) {
    const s1 = ev.seeds.find((s) => s.seed === 1)
    if (!s1) continue
    const head: StatsSeedHead = { players: s1.players }
    const club = s1.players.map((id) => (clubs ?? {})[id]).find((c) => c)
    if (club) head.club = club
    topSeedByEvent.set(ev.eventName, head)
  }
}
```

When assembling each `StatsEventRow`, attach the pre-match fields when available:

```ts
const di = drawByEvent.get(rowName)
if (di) {
  row.size = parseInt(di.size, 10) || undefined
  const t = di.type.toLowerCase()
  row.type = t.includes('round robin') || t.includes('group') ? 'RR+PO' : 'KO'
}
const evEntries = entryCountByEvent.get(rowName)
if (typeof evEntries === 'number') row.entries = evEntries
const topSeed = topSeedByEvent.get(rowName)
if (topSeed) row.topSeed = topSeed
```

`entryCountByEvent` is a map you must build in the same pass that already iterates the rosters in `buildEvents` (count unique playerIds per event). If `buildEvents` doesn't currently iterate rosters by event, add a small pre-pass:

```ts
const entryCountByEvent = new Map<string, number>()
if (rosterByDraw) {
  const playersByEvent = new Map<string, Set<string>>()
  for (const entries of rosterByDraw.values()) {
    for (const e of entries) {
      const ev = e.eventName ?? e.draw
      if (!ev) continue
      let set = playersByEvent.get(ev)
      if (!set) { set = new Set(); playersByEvent.set(ev, set) }
      for (const p of [...e.team1, ...e.team2]) {
        if (p.playerId) set.add(p.playerId)
      }
    }
  }
  for (const [ev, set] of playersByEvent) entryCountByEvent.set(ev, set.size)
}
```

Update `aggregate()` to accept a final optional bag and forward `draws`, `overview`, `clubs` to `buildEvents`. Bag signature (see Task 9 for the full version):

```ts
interface AggregateExtras {
  draws?: DrawInfo[]
  overview?: TournamentOverview
  priorEditionWinners?: PriorEditionWinnerMap
}
```

For this task, only `draws` / `overview` need to be threaded into `buildEvents`. The `priorEditionWinners` field is wired in Task 11.

Add `DrawInfo` to the imports from `./types`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'events pre-match decoration'`
Expected: PASS (3 tests)

- [ ] **Step 5: Verify the rest of the stats suite still passes**

Run: `npx jest __tests__/tournamentStats.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add __tests__/tournamentStats.test.ts lib/tournamentStats.ts
git commit -m "feat(stats): decorate StatsEventRow with size/type/entries/topSeed"
```

---

## Task 8: Hybrid `dailyVolume` — emit scheduled-but-undecided rows

**Files:**
- Modify: `lib/tournamentStats.ts`
- Test: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/tournamentStats.test.ts`:

```ts
describe('dailyVolume hybrid phase', () => {
  test('emits a row for a scheduled day with 0 completed matches', () => {
    const data = {
      days: [{ date: '2026-06-10', label: 'Wed', dateIso: '2026-06-10', hasMatches: true }],
    } as MatchesData
    const groups: MatchScheduleGroup[] = [{
      type: 'court', court: 'C1', matches: [
        { draw: 'MS', drawNum: '1', round: 'R32',
          team1: [{ name: 'A', playerId: 'a' }], team2: [{ name: 'B', playerId: 'b' }],
          winner: null, scores: [], court: 'C1', walkover: false, retired: false, nowPlaying: false,
          scheduledTime: '09:00' },
        { draw: 'MS', drawNum: '1', round: 'R32',
          team1: [{ name: 'C', playerId: 'c' }], team2: [{ name: 'D', playerId: 'd' }],
          winner: null, scores: [], court: 'C1', walkover: false, retired: false, nowPlaying: false,
          scheduledTime: '10:00' },
      ],
    }]
    const stats = aggregateFn(data, new Map([['2026-06-10', groups]]), {}, undefined, {})
    expect(stats.dailyVolume).toEqual([
      { date: '2026-06-10', label: 'Wed', total: 2, decided: 0, minutes: 0 },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'dailyVolume hybrid phase'`
Expected: FAIL — current `buildDailyVolume` only counts completed matches.

- [ ] **Step 3: Modify `buildDailyVolume`**

In `lib/tournamentStats.ts` `buildDailyVolume` (around line 164–200), change the inner counting to include all scheduled matches in `total`, while keeping `decided` and `minutes` based on completed matches only. The function needs `dayGroupsByDate` in addition to `ctxs` to count scheduled-not-completed matches.

Update its signature:

```ts
function buildDailyVolume(
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
  ctxs: MatchCtx[],
): StatsDailyRow[] {
```

Inside, for each day in `data.days`:
- Look up `groups = dayGroupsByDate.get(day.dateIso)`. If absent, skip the day (existing behavior).
- `total` = number of matches in `groups` (any winner status).
- `decided` = number where `winner !== null && !walkover`.
- `minutes` = sum of `durationMinutes` for matches where `winner !== null && !walkover`.

Emit the row even when `decided === 0`, as long as `total > 0`.

Update the `aggregate()` call site to pass `dayGroupsByDate` instead of (or in addition to) `ctxs` — for the final shape of `aggregate()`, see Task 9.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'dailyVolume hybrid phase'`
Expected: PASS

- [ ] **Step 5: Verify the rest of the stats suite still passes**

Run: `npx jest __tests__/tournamentStats.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add __tests__/tournamentStats.test.ts lib/tournamentStats.ts
git commit -m "feat(stats): make dailyVolume hybrid (scheduled + completed)"
```

---

## Task 9: Wire `aggregate()` end-to-end with new extras bag

**Files:**
- Modify: `lib/tournamentStats.ts`
- Test: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/tournamentStats.test.ts`:

```ts
describe('aggregate pre-match composition', () => {
  test('populates seedHeadlines, multiEventEntries, potentialCollisions, schedulePreview when extras present', () => {
    const data = { days: [] } as unknown as MatchesData
    const roster = new Map<string, MatchEntry[]>([
      ['1', [fakeRosterEntry('MS', ['p1']), fakeRosterEntry('MS', ['p2']), fakeRosterEntry('MS', ['p3']), fakeRosterEntry('MS', ['p4'])]],
      ['2', [fakeRosterEntry('MD', ['p1', 'p2'])]],
    ])
    const overview: TO = { notes: [], seedEvents: [{
      eventName: 'MS',
      seeds: [
        { seed: 1, players: ['p1'] }, { seed: 2, players: ['p2'] },
        { seed: 3, players: ['p3'] }, { seed: 4, players: ['p4'] },
      ],
    }] }
    const stats = aggregateFn(data, new Map(), { p1: 'A', p2: 'B' }, roster, { p1: 'Alice', p2: 'Bob' }, { overview })
    expect(stats.seedHeadlines).toHaveLength(1)
    expect(stats.potentialCollisions).toHaveLength(1)
    expect(stats.multiEventEntries?.length).toBeGreaterThanOrEqual(2)
    expect(stats.schedulePreview).toBeUndefined()
  })

  test('returns no new optional fields when extras are absent', () => {
    const data = { days: [] } as unknown as MatchesData
    const stats = aggregateFn(data, new Map(), {}, undefined, {})
    expect(stats.seedHeadlines).toBeUndefined()
    expect(stats.potentialCollisions).toBeUndefined()
    expect(stats.multiEventEntries).toBeUndefined()
    expect(stats.defendingChampion).toBeUndefined()
    expect(stats.schedulePreview).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'aggregate pre-match composition'`
Expected: FAIL

- [ ] **Step 3: Extend `aggregate()` to thread extras**

Replace the existing `aggregate()` signature and body at `lib/tournamentStats.ts:641` with:

```ts
export interface AggregateExtras {
  draws?: DrawInfo[]
  overview?: TournamentOverview
  priorEditionWinners?: PriorEditionWinnerMap
}

export function aggregate(
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
  clubs: Record<string, string>,
  rosterByDraw?: Map<string, MatchEntry[]>,
  names: Record<string, string> = {},
  extras: AggregateExtras = {},
): ComputedStats {
  const ctxs: MatchCtx[] = Array.from(iterateMatches(data, dayGroupsByDate))
  const rosterSize = rosterByDraw ? rosterByDraw.size : 0
  if (ctxs.length === 0 && rosterSize === 0) {
    const base: ComputedStats = {
      ...EMPTY,
      clubRosters: buildClubRosters(clubs, names),
      countryRosters: buildCountryRosters(ctxs, rosterByDraw),
    }
    return decorateOptional(base, extras, clubs, names, rosterByDraw, data, dayGroupsByDate)
  }
  const { clubMedals, multiGoldPlayers } = buildClubMedalsAndMultiGold(ctxs, clubs)
  const base: ComputedStats = {
    kpis: buildKpis(ctxs, rosterByDraw),
    dailyVolume: buildDailyVolume(data, dayGroupsByDate, ctxs),
    events: buildEvents(ctxs, rosterByDraw, extras.draws, extras.overview, clubs),
    drama: buildDrama(ctxs),
    topPlayers: buildTopPlayers(ctxs, clubs),
    courtUtilization: buildCourtUtilization(ctxs),
    clubMedals,
    multiGoldPlayers,
    clubRosters: buildClubRosters(clubs, names),
    countryRosters: buildCountryRosters(ctxs, rosterByDraw),
    integrity: buildIntegrity(ctxs),
  }
  return decorateOptional(base, extras, clubs, names, rosterByDraw, data, dayGroupsByDate)
}

function decorateOptional(
  base: ComputedStats,
  extras: AggregateExtras,
  clubs: Record<string, string>,
  names: Record<string, string>,
  rosterByDraw: Map<string, MatchEntry[]> | undefined,
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
): ComputedStats {
  const seedHeadlines = buildSeedHeadlines(extras.overview, clubs)
  if (seedHeadlines.length) base.seedHeadlines = seedHeadlines
  const multiEventEntries = buildMultiEventEntries(rosterByDraw, clubs, names)
  if (multiEventEntries.length) base.multiEventEntries = multiEventEntries
  const collisions = buildPotentialCollisions(extras.overview, clubs)
  if (collisions.length) base.potentialCollisions = collisions
  const defending = buildDefendingChampion(extras.priorEditionWinners, extras.overview, clubs)
  if (defending.length) base.defendingChampion = defending
  const preview = buildSchedulePreview(data, dayGroupsByDate)
  if (preview) base.schedulePreview = preview
  return base
}
```

`buildDefendingChampion` lands in Task 11; this task's `decorateOptional` references it but exporting it doesn't require its implementation to exist yet — TypeScript will error until Task 11 is done.

To unblock this task's tests without Task 11, add a temporary stub at the bottom of `lib/tournamentStats.ts`:

```ts
import type { PriorEditionWinnerMap } from './priorEdition'
// Temporary stub — replaced in Task 11 with the real implementation.
export function buildDefendingChampion(
  _winners: PriorEditionWinnerMap | undefined,
  _overview: TournamentOverview | undefined,
  _clubs: Record<string, string>,
): StatsDefendingChampion[] {
  return []
}
```

And in `lib/priorEdition.ts` (create if it doesn't exist yet), add:

```ts
export interface PriorEditionWinnerEntry {
  players: string[]
  club?: string
  priorEditionId: string
  priorEditionLabel: string
}
export type PriorEditionWinnerMap = Map<string, PriorEditionWinnerEntry>
```

That defines the type the temporary stub references; Task 11 fills in the rest of `priorEdition.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'aggregate pre-match composition'`
Expected: PASS

- [ ] **Step 5: Run full stats test file**

Run: `npx jest __tests__/tournamentStats.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add __tests__/tournamentStats.test.ts lib/tournamentStats.ts lib/priorEdition.ts
git commit -m "feat(stats): thread AggregateExtras through aggregate()"
```

---

## Task 10: Prior-edition resolver

**Files:**
- Modify: `lib/priorEdition.ts`
- Test: `__tests__/priorEdition.test.ts`

- [ ] **Step 1: Inspect `lib/tournament-meta.ts` and `lib/playerIndex.ts`**

Run: `grep -n "export " lib/tournament-meta.ts lib/playerIndex.ts | head -30`

Identify (a) the function that lists known tournaments with `done`/`name`/`id`/`dateIso` and (b) the function that returns a player-index lookup keyed by tournament+event whose values include winners. The implementer should rely on whatever the codebase already exposes — for the spec call this `listKnownTournaments()` and `getEventWinners(tournamentId)` respectively. If their names differ, substitute throughout this task.

- [ ] **Step 2: Write the failing test**

Create `__tests__/priorEdition.test.ts`:

```ts
import { resolvePriorEdition, buildPriorEditionWinners } from '@/lib/priorEdition'
import type { TournamentInfo } from '@/lib/types'

const T = (id: string, name: string, dateIso: string, done = true): TournamentInfo => ({ id, name, done, startDateIso: dateIso })

describe('resolvePriorEdition', () => {
  test('returns null when no candidates', () => {
    expect(resolvePriorEdition('CURRENT-2026', 'Yonex Singha BAT BTY', [])).toBeNull()
  })

  test('picks the most recent done prior with matching canonical name', () => {
    const current = T('YONEX-SINGHA-BAT-BTY-2026', 'Yonex Singha BAT BTY 2026', '2026-06-10')
    const all: TournamentInfo[] = [
      T('YONEX-SINGHA-BAT-BTY-2024', 'Yonex Singha BAT BTY 2024', '2024-06-12'),
      T('YONEX-SINGHA-BAT-BTY-2025', 'Yonex Singha BAT BTY 2025', '2025-06-11'),
      T('UNRELATED-2025', 'Other Open 2025', '2025-07-01'),
    ]
    expect(resolvePriorEdition(current.id, current.name, all)?.id).toBe('YONEX-SINGHA-BAT-BTY-2025')
  })

  test('falls back to id-prefix when name match yields zero', () => {
    const current = T('FOO-BAR-2026', 'Different Display 2026', '2026-06-10')
    const all: TournamentInfo[] = [T('FOO-BAR-2025', 'Different Display 2025', '2025-06-10')]
    expect(resolvePriorEdition(current.id, current.name, all)?.id).toBe('FOO-BAR-2025')
  })

  test('returns null when name match is ambiguous', () => {
    const current = T('A-2026', 'Open 2026', '2026-06-10')
    const all: TournamentInfo[] = [
      T('A-2025', 'Open 2025', '2025-06-10'),
      T('B-2025', 'Open 2025', '2025-06-10'),
    ]
    expect(resolvePriorEdition(current.id, current.name, all)).toBeNull()
  })

  test('excludes the current tournament from candidates', () => {
    const current = T('SAME-2026', 'Repeat 2026', '2026-06-10')
    expect(resolvePriorEdition(current.id, current.name, [current])).toBeNull()
  })
})

describe('buildPriorEditionWinners', () => {
  test('returns empty map when prior is null', () => {
    expect(buildPriorEditionWinners(null, new Map(), {}).size).toBe(0)
  })

  test('returns one entry per event the prior edition has a winner for', () => {
    const prior = T('PRI-2025', 'Prior 2025', '2025-06-10')
    const winners = new Map<string, { players: string[] }>([
      ['MS', { players: ['p1'] }],
      ['WS', { players: ['q1'] }],
    ])
    const out = buildPriorEditionWinners(prior, winners, { p1: 'A', q1: 'B' })
    expect(out.get('MS')).toEqual({
      players: ['p1'],
      club: 'A',
      priorEditionId: 'PRI-2025',
      priorEditionLabel: 'Prior 2025',
    })
    expect(out.get('WS')?.club).toBe('B')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/priorEdition.test.ts`
Expected: FAIL (`resolvePriorEdition` / `buildPriorEditionWinners` not defined)

- [ ] **Step 4: Implement `lib/priorEdition.ts`**

Replace the stub from Task 9 with:

```ts
import type { TournamentInfo } from './types'

export interface PriorEditionWinnerEntry {
  players: string[]
  club?: string
  priorEditionId: string
  priorEditionLabel: string
}
export type PriorEditionWinnerMap = Map<string, PriorEditionWinnerEntry>

function canonicalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’“”'"`]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(open|championship|championships|\d+(st|nd|rd|th))\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function idPrefix(id: string): string {
  const m = id.match(/^(.*?)-(?:19|20)\d{2}$/)
  return (m ? m[1] : id).toLowerCase()
}

export function resolvePriorEdition(
  currentId: string,
  currentName: string,
  all: TournamentInfo[],
): TournamentInfo | null {
  const candidates = all.filter((t) => t.id !== currentId && t.done)
  const targetName = canonicalize(currentName)
  const byName = candidates.filter((t) => canonicalize(t.name) === targetName)
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) {
    const sorted = byName.slice().sort((a, b) => (b.startDateIso ?? '').localeCompare(a.startDateIso ?? ''))
    const mostRecent = sorted[0]
    const tie = sorted.filter((t) => (t.startDateIso ?? '') === (mostRecent.startDateIso ?? ''))
    if (tie.length === 1) return mostRecent
    return null
  }
  const targetPrefix = idPrefix(currentId)
  const byPrefix = candidates.filter((t) => idPrefix(t.id) === targetPrefix)
  if (byPrefix.length === 1) return byPrefix[0]
  return null
}

export function buildPriorEditionWinners(
  prior: TournamentInfo | null,
  winnersByEvent: Map<string, { players: string[] }>,
  clubs: Record<string, string>,
): PriorEditionWinnerMap {
  const out: PriorEditionWinnerMap = new Map()
  if (!prior) return out
  for (const [event, w] of winnersByEvent) {
    const entry: PriorEditionWinnerEntry = {
      players: w.players,
      priorEditionId: prior.id,
      priorEditionLabel: prior.name,
    }
    const club = w.players.map((id) => clubs[id]).find((c) => c)
    if (club) entry.club = club
    out.set(event, entry)
  }
  return out
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/priorEdition.test.ts`
Expected: ALL PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add __tests__/priorEdition.test.ts lib/priorEdition.ts
git commit -m "feat(priorEdition): heuristic resolver for prior tournament edition"
```

---

## Task 11: `buildDefendingChampion` (replace stub)

**Files:**
- Modify: `lib/tournamentStats.ts`
- Test: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/tournamentStats.test.ts`:

```ts
import { buildDefendingChampion } from '@/lib/tournamentStats'
import type { PriorEditionWinnerMap } from '@/lib/priorEdition'

describe('buildDefendingChampion', () => {
  test('returns [] when winners map is undefined', () => {
    expect(buildDefendingChampion(undefined, undefined, {})).toEqual([])
  })

  test('emits one row per event in overview that has a winner', () => {
    const overview = { notes: [], seedEvents: [
      { eventName: 'MS', seeds: [] },
      { eventName: 'WS', seeds: [] },
      { eventName: 'MD', seeds: [] },
    ] }
    const winners: PriorEditionWinnerMap = new Map([
      ['MS', { players: ['p1'], club: 'A', priorEditionId: 'PRI', priorEditionLabel: 'Prior' }],
      ['MD', { players: ['p2', 'p3'], priorEditionId: 'PRI', priorEditionLabel: 'Prior' }],
    ])
    const out = buildDefendingChampion(winners, overview, {})
    expect(out).toEqual([
      { event: 'MS', players: ['p1'], club: 'A', priorEditionId: 'PRI', priorEditionLabel: 'Prior' },
      { event: 'MD', players: ['p2', 'p3'], priorEditionId: 'PRI', priorEditionLabel: 'Prior' },
    ])
  })

  test('skips events that didn’t exist in the prior edition', () => {
    const overview = { notes: [], seedEvents: [{ eventName: 'NEW', seeds: [] }] }
    const winners: PriorEditionWinnerMap = new Map([['OLD', { players: ['x'], priorEditionId: 'P', priorEditionLabel: 'Prior' }]])
    expect(buildDefendingChampion(winners, overview, {})).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'buildDefendingChampion'`
Expected: FAIL — stub returns empty regardless of inputs.

- [ ] **Step 3: Replace the stub with the real implementation**

In `lib/tournamentStats.ts`, replace the temporary `buildDefendingChampion` stub from Task 9 with:

```ts
export function buildDefendingChampion(
  winners: PriorEditionWinnerMap | undefined,
  overview: TournamentOverview | undefined,
  _clubs: Record<string, string>,
): StatsDefendingChampion[] {
  if (!winners || !overview) return []
  const out: StatsDefendingChampion[] = []
  for (const ev of overview.seedEvents) {
    const w = winners.get(ev.eventName)
    if (!w) continue
    const row: StatsDefendingChampion = {
      event: ev.eventName,
      players: w.players,
      priorEditionId: w.priorEditionId,
      priorEditionLabel: w.priorEditionLabel,
    }
    if (w.club) row.club = w.club
    out.push(row)
  }
  return out
}
```

Make sure `StatsDefendingChampion` is in the imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/tournamentStats.test.ts -t 'buildDefendingChampion'`
Expected: PASS (3 tests)

- [ ] **Step 5: Run full stats suite**

Run: `npx jest __tests__/tournamentStats.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add __tests__/tournamentStats.test.ts lib/tournamentStats.ts
git commit -m "feat(stats): implement buildDefendingChampion"
```

---

## Task 12: Pre-match `sourceVersion` recipe

**Files:**
- Modify: `lib/stats-cache.ts`
- Test: `__tests__/stats-cache.test.ts`

- [ ] **Step 1: Read the current shape of `lib/stats-cache.ts`**

Run: `grep -n "export\|sourceVersion\|hash" lib/stats-cache.ts`

- [ ] **Step 2: Write the failing test**

Append to `__tests__/stats-cache.test.ts`:

```ts
import { computePreMatchSourceVersion } from '@/lib/stats-cache'

describe('computePreMatchSourceVersion', () => {
  test('is stable across calls with the same inputs', () => {
    const a = Buffer.from('draws')
    const b = Buffer.from('overview')
    const c = Buffer.from('roster')
    expect(computePreMatchSourceVersion(a, b, c)).toBe(computePreMatchSourceVersion(a, b, c))
  })

  test('changes when any input changes', () => {
    const base = computePreMatchSourceVersion(Buffer.from('d'), Buffer.from('o'), Buffer.from('r'))
    expect(computePreMatchSourceVersion(Buffer.from('d2'), Buffer.from('o'), Buffer.from('r'))).not.toBe(base)
    expect(computePreMatchSourceVersion(Buffer.from('d'), Buffer.from('o2'), Buffer.from('r'))).not.toBe(base)
    expect(computePreMatchSourceVersion(Buffer.from('d'), Buffer.from('o'), Buffer.from('r2'))).not.toBe(base)
  })

  test('has the pre: prefix', () => {
    expect(computePreMatchSourceVersion(Buffer.from(''), Buffer.from(''), Buffer.from(''))).toMatch(/^pre:/)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/stats-cache.test.ts -t 'computePreMatchSourceVersion'`
Expected: FAIL (`computePreMatchSourceVersion` undefined)

- [ ] **Step 4: Add `computePreMatchSourceVersion`**

Add to `lib/stats-cache.ts`:

```ts
import { createHash } from 'crypto'

function hash(...parts: Buffer[]): string {
  const h = createHash('sha1')
  for (const p of parts) {
    h.update(p)
    h.update('\0')
  }
  return h.digest('hex').slice(0, 16)
}

export function computePreMatchSourceVersion(
  drawsBytes: Buffer,
  overviewBytes: Buffer,
  rosterBytes: Buffer,
): string {
  return `pre:${hash(drawsBytes, overviewBytes, rosterBytes)}`
}
```

Reuse `createHash` if `lib/stats-cache.ts` already imports it.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/stats-cache.test.ts -t 'computePreMatchSourceVersion'`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add __tests__/stats-cache.test.ts lib/stats-cache.ts
git commit -m "feat(stats-cache): add pre-match sourceVersion recipe"
```

---

## Task 13: Route changes — fetch new inputs, use new sourceVersion

**Files:**
- Modify: `app/api/stats/route.ts`
- Test: `__tests__/api-stats-route.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/api-stats-route.test.ts` — add three new cases. The exact mocks depend on the existing test scaffolding; the pattern below assumes the existing tests stub the underlying caches and `fetchClubs`/`fetchRosterByDraw`. Adapt to match what's already used.

```ts
describe('api-stats-route pre-match', () => {
  test('returns pre-match stats with pre: sourceVersion when no full-cache', async () => {
    // Stub: no fullDataDisk, populated draws + overview + roster, no clubs partial.
    // ... arrange mocks ...
    const res = await routeGet(reqFor('YONEX-SINGHA-BAT-BTY-2026'))
    const body = await res.json()
    expect(body.seedHeadlines?.length).toBeGreaterThan(0)
    expect(body.kpis.entries).toBeGreaterThan(0)
    // Second call should hit memCache (no re-aggregation):
    const res2 = await routeGet(reqFor('YONEX-SINGHA-BAT-BTY-2026'))
    expect(await res2.json()).toEqual(body)
  })

  test('drawn-but-no-overview: seed-derived sections absent', async () => {
    // Stub overview-cache to return null, draws + roster present.
    const res = await routeGet(reqFor('NO-OVERVIEW-2026'))
    const body = await res.json()
    expect(body.seedHeadlines).toBeUndefined()
    expect(body.potentialCollisions).toBeUndefined()
    expect(body.kpis.entries).toBeGreaterThan(0)
  })

  test('overview returns malformed shape: route still returns 200 with derived sections absent', async () => {
    // Stub overview-cache to throw / return malformed.
    const res = await routeGet(reqFor('BROKEN-OVERVIEW-2026'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.seedHeadlines).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api-stats-route.test.ts -t 'pre-match'`
Expected: FAIL — route doesn't yet fetch draws/overview or use pre: sourceVersion.

- [ ] **Step 3: Modify the route**

In `app/api/stats/route.ts`:

Add imports near the existing imports:

```ts
import { getCachedOrLoadFromDisk as getDrawsCached } from '@/lib/draws-cache'
import { readDiskSnapshot as readOverviewDisk, cache as overviewCache } from '@/lib/overview-cache'
import { resolvePriorEdition, buildPriorEditionWinners } from '@/lib/priorEdition'
import { computePreMatchSourceVersion } from '@/lib/stats-cache'
import type { DrawInfo, TournamentOverview } from '@/lib/types'
```

Extend the `Promise.all` block (`route.ts:269–275`) with two parallel reads for draws + overview:

```ts
const [dayMap, clubsResp, rosterByDraw, drawsEntry, overviewSnap] = await Promise.all([
  assembleDayMap(origin, tournamentId, fullData),
  fetchClubs(origin, tournamentId),
  isAllPast ? Promise.resolve(null) : fetchRosterByDraw(tournamentId),
  isAllPast ? Promise.resolve(undefined) : getDrawsCached(tournamentId).catch(() => undefined),
  isAllPast ? Promise.resolve(null) : readOverviewSafe(tournamentId),
])
```

Add a tiny helper above `GET`:

```ts
async function readOverviewSafe(tournamentId: string): Promise<TournamentOverview | null> {
  const mem = overviewCache.get(tournamentId)?.data
  if (mem) return mem
  try { return await readOverviewDisk(tournamentId) } catch { return null }
}
```

After `clubsResp` destructuring, build the `priorEditionWinners` map (best-effort):

```ts
const draws: DrawInfo[] | undefined = drawsEntry?.draws
const overview: TournamentOverview | undefined = overviewSnap ?? undefined

let priorEditionWinners: ReturnType<typeof buildPriorEditionWinners> | undefined
try {
  const allTournaments = await listKnownTournamentsForResolver(origin)
  const meta = allTournaments.find((t) => t.id === tournamentId)
  const prior = meta ? resolvePriorEdition(tournamentId, meta.name, allTournaments) : null
  if (prior) {
    const winners = await fetchPriorWinners(origin, prior.id)
    priorEditionWinners = buildPriorEditionWinners(prior, winners, clubs)
  }
} catch {
  priorEditionWinners = undefined
}
```

`listKnownTournamentsForResolver(origin)` and `fetchPriorWinners(origin, id)` are small adapters the implementer adds in this file. Recommended shape:

```ts
async function listKnownTournamentsForResolver(origin: string): Promise<TournamentInfo[]> {
  try {
    const res = await fetch(`${origin}/api/tournaments`)
    if (!res.ok) return []
    const j = await res.json()
    return Array.isArray(j?.tournaments) ? j.tournaments as TournamentInfo[] : []
  } catch { return [] }
}

async function fetchPriorWinners(origin: string, priorId: string): Promise<Map<string, { players: string[] }>> {
  try {
    const res = await fetch(`${origin}/api/stats?tournament=${encodeURIComponent(priorId)}`)
    if (!res.ok) return new Map()
    const j = await res.json() as TournamentStats
    const out = new Map<string, { players: string[] }>()
    for (const e of j.events) {
      if (e.winner.length > 0) out.set(e.name, { players: e.winner })
    }
    return out
  } catch { return new Map() }
}
```

Update the `aggregate()` call to pass the extras bag:

```ts
const stats = aggregate(fullData, dayMap.groups, clubs, rosterByDraw ?? undefined, names, {
  draws, overview, priorEditionWinners,
})
```

Add the pre-match cache path before the existing `isAllPast && fullBytes` cache write block. Compute the pre-match `sourceVersion` from the bytes of the three inputs that drove the response:

```ts
if (!isAllPast) {
  const drawsBytes = drawsEntry ? Buffer.from(JSON.stringify(drawsEntry.draws)) : Buffer.alloc(0)
  const overviewBytes = overview ? Buffer.from(JSON.stringify(overview)) : Buffer.alloc(0)
  const rosterBytes = rosterByDraw ? Buffer.from(JSON.stringify(Array.from(rosterByDraw.entries()))) : Buffer.alloc(0)
  const sv = computePreMatchSourceVersion(drawsBytes, overviewBytes, rosterBytes)
  const cached = await readStatsCache(tournamentId)
  if (cached && cached.sourceVersion === sv) {
    memCache.set(tournamentId, { data: cached.stats, ts: Date.now(), live: true })
    return buildResponse(cached.stats, true)
  }
  // After aggregation, write through:
  if (clubsCoverageOk) {
    await writeStatsCache(tournamentId, { sourceVersion: sv, coverageComplete: false, stats: full })
  }
}
```

Place the cache *read* block alongside the existing `isAllPast && fullBytes` read at `route.ts:259–267` (early), and the cache *write* block alongside the existing write at `route.ts:307–310`.

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/api-stats-route.test.ts`
Expected: ALL PASS, including the three new pre-match cases.

- [ ] **Step 5: Commit**

```bash
git add __tests__/api-stats-route.test.ts app/api/stats/route.ts
git commit -m "feat(api): fetch draws+overview+prior-edition for pre-match stats"
```

---

## Task 14: Update `stats-generator.ts` (background prewarm path)

**Files:**
- Modify: `lib/stats-generator.ts`

- [ ] **Step 1: Re-read `lib/stats-generator.ts:50–102`**

The background prewarm path is invoked only for tournaments with full coverage on disk (`readFullCache` returns the full snapshot). For pre-match tournaments, `readFullCache` returns `null` and `ensureStatsCachedForTournament` returns `'skip'` immediately. That means the background path is a no-op for pre-match tournaments — **no change required**.

- [ ] **Step 2: Confirm by reading the function again**

Read lines 50–102 of `lib/stats-generator.ts` and verify the early return on line 55 (`if (!fullData) return 'skip'`).

- [ ] **Step 3: Commit a note (no code change)**

Skip — nothing to commit for this task. Mark the task complete and proceed.

---

## Task 15: i18n keys (EN + TH)

**Files:**
- Modify: `lib/i18n.ts`

- [ ] **Step 1: Add the new union members to the `Locales` (or equivalent) key type**

Add the following 14 keys to the union type in `lib/i18n.ts` near line 197 (where `statsEmptyState` is currently listed):

```
| 'statsSectionDefendingChampions'
| 'statsSectionSeedHeadlines'
| 'statsSectionPotentialCollisions'
| 'statsSectionMultiEventEntries'
| 'statsSectionSchedulePreview'
| 'statsKpiEntries'
| 'statsKpiDraws'
| 'statsColSize'
| 'statsColType'
| 'statsColTopSeed'
| 'statsCollisionsSf'
| 'statsCollisionsF'
| 'statsScheduleOpensAt'
| 'statsScheduleMatchesAcrossCourts'
| 'statsPreMatchFooter'
```

- [ ] **Step 2: Add EN translations**

In the EN block (near line 384 where `statsEmptyState` lives), add:

```ts
statsSectionDefendingChampions: 'Defending champions',
statsSectionSeedHeadlines: 'Top seeds',
statsSectionPotentialCollisions: 'Potential semis & final',
statsSectionMultiEventEntries: 'Playing in multiple events',
statsSectionSchedulePreview: 'Opening day',
statsKpiEntries: 'Entries',
statsKpiDraws: 'Draws',
statsColSize: 'Size',
statsColType: 'Type',
statsColTopSeed: 'Top seed',
statsCollisionsSf: 'SF',
statsCollisionsF: 'F',
statsScheduleOpensAt: 'Opens at',
statsScheduleMatchesAcrossCourts: '{count} matches across {courts} courts',
statsPreMatchFooter: 'No matches completed yet — top players, drama, and integrity stats will appear after the first match.',
```

- [ ] **Step 3: Add TH translations**

In the TH block (near line 603), add (use the existing TH style as a guide; below is a starting draft):

```ts
statsSectionDefendingChampions: 'แชมป์เก่า',
statsSectionSeedHeadlines: 'มือวางระดับต้น',
statsSectionPotentialCollisions: 'อาจเจอกันรองชนะเลิศ / ชิงแชมป์',
statsSectionMultiEventEntries: 'ลงหลายรายการ',
statsSectionSchedulePreview: 'วันเปิด',
statsKpiEntries: 'ผู้ลงแข่งขัน',
statsKpiDraws: 'สายแข่งขัน',
statsColSize: 'ขนาด',
statsColType: 'รูปแบบ',
statsColTopSeed: 'มือวางอันดับ 1',
statsCollisionsSf: 'รองชนะเลิศ',
statsCollisionsF: 'ชิงแชมป์',
statsScheduleOpensAt: 'เริ่ม',
statsScheduleMatchesAcrossCourts: '{count} แมตช์ ใน {courts} สนาม',
statsPreMatchFooter: 'ยังไม่มีแมตช์จบ — สถิติดรามาจะปรากฏหลังแมตช์แรก',
```

If `lib/i18n.ts` lacks `{count}`/`{courts}` interpolation, replace the parameterized strings with simple ones (no interpolation) and inline the values in the component.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/i18n.ts
git commit -m "feat(i18n): add 14 keys for pre-match stats sections"
```

---

## Task 16: Component — remove empty-state, add section guards skeleton

**Files:**
- Modify: `components/TournamentStatsPanel.tsx`

- [ ] **Step 1: Remove the empty-state short-circuit**

Edit `components/TournamentStatsPanel.tsx:130`. Replace:

```tsx
if (stats.kpis.matches === 0) return <div className="stats-empty">{t('statsEmptyState')}</div>
```

with:

```tsx
const hasDecided = stats.kpis.decided > 0
const hasMatches = stats.kpis.matches > 0
```

(The old `statsEmptyState` key remains in `i18n.ts` unused for now — leave it; another section deletes it in a follow-up.)

- [ ] **Step 2: Make the Drama section conditional**

Find the `<section data-stats-share="drama">` block (around line 178) and wrap it:

```tsx
{(stats.drama.marathon || stats.drama.highestSet || stats.drama.highestScoringMatch || stats.drama.mostCourtTime) && (
  <section className="stats-section" data-stats-share="drama">
    ...
  </section>
)}
```

- [ ] **Step 3: Make the Integrity section conditional**

Find the `<section>` containing `statsSectionIntegrity` (around line 431) and wrap it with `{hasDecided && (...)}`.

- [ ] **Step 4: Make the Court Utilization section conditional**

Find the court-utilization block (around line 413) and wrap with `{stats.courtUtilization.length > 0 && (...)}`. The `dailyVolume` section is already implicitly guarded by mapping; leave it.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/TournamentStatsPanel.tsx
git commit -m "feat(stats-panel): replace empty-state with per-section guards"
```

---

## Task 17: Component — render new sections (Defending / Top seeds / Collisions / Multi-event / Schedule preview)

**Files:**
- Modify: `components/TournamentStatsPanel.tsx`

- [ ] **Step 1: Insert the 5 new sections after the hero KPIs**

After the hero KPI `<section>` (ending around line 175), insert the following blocks **in this order** (matches spec render order):

```tsx
{stats.defendingChampion && stats.defendingChampion.length > 0 && (
  <section className="stats-section" data-stats-share="defending">
    <h2>{t('statsSectionDefendingChampions')}</h2>
    {stats.defendingChampion.map((d) => (
      <div className="stats-defending-card" key={d.event}>
        <div className="stats-defending-event">{d.event}</div>
        <div className="stats-defending-name">{d.players.join(' / ')}</div>
        {d.club && <div className="stats-defending-club">{d.club}</div>}
        <div className="stats-defending-prior">{d.priorEditionLabel}</div>
      </div>
    ))}
  </section>
)}

{stats.seedHeadlines && stats.seedHeadlines.length > 0 && (
  <section className="stats-section" data-stats-share="seeds">
    <h2>{t('statsSectionSeedHeadlines')}</h2>
    {stats.seedHeadlines.map((h) => (
      <div className="stats-seed-card" key={h.event}>
        <div className="stats-seed-event">{h.event}</div>
        {h.seeds.map((s) => (
          <div className="stats-seed-row" key={s.seed}>
            <span className="stats-seed-num">#{s.seed}</span>
            <span className="stats-seed-name">{s.players.join(' / ')}</span>
            {s.club && <span className="stats-seed-club">{s.club}</span>}
          </div>
        ))}
      </div>
    ))}
  </section>
)}

{stats.potentialCollisions && stats.potentialCollisions.length > 0 && (
  <section className="stats-section" data-stats-share="collisions">
    <h2>{t('statsSectionPotentialCollisions')}</h2>
    {stats.potentialCollisions.map((c) => (
      <div className="stats-collision-card" key={c.event}>
        <div className="stats-collision-event">{c.event}</div>
        {c.semis.map((p, i) => (
          <div className="stats-collision-row" key={`sf-${i}`}>
            <span className="stats-collision-label">{t('statsCollisionsSf')}</span>
            <span className="stats-collision-side">#{p.sideA.seed} {p.sideA.players.join(' / ')}</span>
            <span className="stats-collision-vs">vs</span>
            <span className="stats-collision-side">#{p.sideB.seed} {p.sideB.players.join(' / ')}</span>
          </div>
        ))}
        {c.final && (
          <div className="stats-collision-row stats-collision-row-final">
            <span className="stats-collision-label">{t('statsCollisionsF')}</span>
            <span className="stats-collision-side">#{c.final.sideA.seed} {c.final.sideA.players.join(' / ')}</span>
            <span className="stats-collision-vs">vs</span>
            <span className="stats-collision-side">#{c.final.sideB.seed} {c.final.sideB.players.join(' / ')}</span>
          </div>
        )}
      </div>
    ))}
  </section>
)}

{stats.multiEventEntries && stats.multiEventEntries.length > 0 && (
  <section className="stats-section" data-stats-share="multi-entries">
    <h2>{t('statsSectionMultiEventEntries')}</h2>
    <table className="stats-table">
      <thead><tr>
        <th className="stats-num">#</th>
        <th>{t('statsColPlayer')}</th>
        <th className="stats-club-d">{t('statsColClub')}</th>
        <th>{t('statsColEvents')}</th>
      </tr></thead>
      <tbody>
        {stats.multiEventEntries.map((p) => (
          <tr key={p.playerId}>
            <td className="stats-num"><b>{p.events.length}</b></td>
            <td>{p.name}{p.club && <div className="stats-club-m">{p.club}</div>}</td>
            <td className="stats-club-d">{p.club}</td>
            <td>{p.events.join(' + ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
)}
```

The schedule-preview block goes **after** the Country Rosters section. Find the country-rosters block (around line 374) and insert after it:

```tsx
{stats.schedulePreview && (
  <section className="stats-section" data-stats-share="schedule-preview">
    <h2>{t('statsSectionSchedulePreview')} · {stats.schedulePreview.firstDayLabel}</h2>
    <div className="stats-schedule-sub">
      {stats.schedulePreview.matchCount} {lang === 'th' ? 'แมตช์' : 'matches'}
       ·  {stats.schedulePreview.courts} {lang === 'th' ? 'สนาม' : 'courts'}
      {stats.schedulePreview.opensAt && <>  ·  {t('statsScheduleOpensAt')} {stats.schedulePreview.opensAt}</>}
    </div>
    <div className="stats-schedule-grid">
      {stats.schedulePreview.openingDayByCourt.map((c) => (
        <div className="stats-schedule-court" key={c.court}>
          <div className="stats-schedule-court-name">{c.court}</div>
          {c.matches.map((m, i) => (
            <div className="stats-schedule-match" key={`${m.time}-${i}`}>
              <span className="stats-schedule-time">{m.time}</span>
              <span className="stats-schedule-evt">{m.event} · {m.round}</span>
              <div className="stats-schedule-teams">{m.team1.join(' / ')} <span className="stats-schedule-vs">vs</span> {m.team2.join(' / ')}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  </section>
)}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add components/TournamentStatsPanel.tsx
git commit -m "feat(stats-panel): render defending/seeds/collisions/multi-entries/schedule sections"
```

---

## Task 18: Component — Hero KPI / Events table degradation + footer

**Files:**
- Modify: `components/TournamentStatsPanel.tsx`

- [ ] **Step 1: Conditionally render result-phase KPI tiles**

In the hero KPI grid (lines ~147–174), keep the always-present tiles (`events`, `players`, `multiEventPlayers`). Wrap the result-phase tiles (`decided`, `courtMinutes`, `avgMatchMinutes`, `threeSetters`, `comebacks`) in `{hasDecided && (...)}`. Insert new tiles for `entries` and `draws` so the hero is meaningful pre-match:

```tsx
<div className="stats-kpi"><div className="stats-kpi-num">{fmt(stats.kpis.entries)}</div><div className="stats-kpi-lbl">{t('statsKpiEntries')}</div></div>
<div className="stats-kpi"><div className="stats-kpi-num">{fmt(stats.kpis.draws)}</div><div className="stats-kpi-lbl">{t('statsKpiDraws')}</div></div>
```

- [ ] **Step 2: Degrade the Events table columns**

In the Events `<table>` (around line 313), add the two new headers `Size` and `Type`. For each row, render `'—'` for the result-phase cells when `hasDecided === false`; replace the `Winner` cell with `topSeed.players[0]` when `e.winner.length === 0`:

```tsx
<thead><tr>
  <th>{t('statsSectionEvents')}</th>
  <th className="stats-num">{t('statsColSize')}</th>
  <th className="stats-num">{t('statsColType')}</th>
  <th className="stats-num">{t('statsColMatches')}</th>
  <th className="stats-num">{t('statsColPlayers')}</th>
  <th className="stats-num">{t('statsCol3Set')}</th>
  <th className="stats-num">{t('statsColAvg')}</th>
  <th>{e_winnerOrTopSeedHeader(hasDecided, t)}</th>
</tr></thead>
```

Add a small helper above the component:

```tsx
function e_winnerOrTopSeedHeader(hasDecided: boolean, t: (k: any) => string): string {
  return hasDecided ? t('statsColWinner') : t('statsColTopSeed')
}
```

In each row body, swap the cells to use `—` when `e.decided === 0`:

```tsx
<td className="stats-num">{e.size ?? '—'}</td>
<td className="stats-num">{e.type ?? '—'}</td>
<td className="stats-num">{e.decided === 0 ? '—' : e.matches}</td>
<td className="stats-num">{fmt(e.players ?? e.entries ?? 0)}</td>
<td className="stats-num">{e.decided === 0 ? '—' : pct(e.threeSetters / e.decided)}</td>
<td className="stats-num">{e.decided === 0 ? '—' : formatMinutes(e.avgMinutes, lang)}</td>
<td className="stats-winner-cell">
  {e.winner.length > 0
    ? <>{e.winner.join(' / ')}{e.winnerSeed && <span className="stats-seed"> {e.winnerSeed}</span>}</>
    : (e.topSeed ? <>{e.topSeed.players.join(' / ')}{e.topSeed.club && <div className="stats-club-m">{e.topSeed.club}</div>}</> : '—')}
</td>
```

- [ ] **Step 3: Add the pre-match explanatory footer**

At the very bottom of the panel `<div className="stats-panel">`, just before its closing tag, add:

```tsx
{!hasDecided && (
  <div className="stats-prematch-footer">{t('statsPreMatchFooter')}</div>
)}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/TournamentStatsPanel.tsx
git commit -m "feat(stats-panel): degrade Hero KPIs/Events table + pre-match footer"
```

---

## Task 19: CSS for new sections

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Append CSS rules**

Add the following at the end of `app/globals.css`:

```css
.stats-defending-card,
.stats-seed-card,
.stats-collision-card {
  border-top: 1px solid var(--border);
  padding: 8px 0;
}
.stats-defending-event,
.stats-seed-event,
.stats-collision-event {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 2px;
}
.stats-defending-name { font-weight: 600; }
.stats-defending-club,
.stats-defending-prior { color: var(--muted); font-size: 0.85rem; }

.stats-seed-row {
  display: flex; gap: 8px; align-items: baseline;
  padding: 2px 0;
}
.stats-seed-num { width: 2.5em; color: var(--muted); font-variant-numeric: tabular-nums; }
.stats-seed-club { color: var(--muted); font-size: 0.85rem; margin-left: auto; }

.stats-collision-row {
  display: grid;
  grid-template-columns: 2.5em 1fr auto 1fr;
  gap: 6px; align-items: baseline;
  padding: 2px 0;
}
.stats-collision-label { color: var(--muted); font-variant-numeric: tabular-nums; }
.stats-collision-vs { color: var(--muted); text-align: center; }
.stats-collision-row-final { font-weight: 600; padding-top: 4px; border-top: 1px dashed var(--border); margin-top: 4px; }

.stats-schedule-sub { color: var(--muted); font-size: 0.85rem; margin-bottom: 8px; }
.stats-schedule-grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
@media (min-width: 600px) { .stats-schedule-grid { grid-template-columns: 1fr 1fr; } }
.stats-schedule-court { border-top: 1px solid var(--border); padding-top: 6px; }
.stats-schedule-court-name { font-weight: 600; margin-bottom: 4px; }
.stats-schedule-match { padding: 4px 0; border-bottom: 1px solid var(--border-soft, transparent); }
.stats-schedule-time { font-variant-numeric: tabular-nums; margin-right: 8px; }
.stats-schedule-evt { color: var(--muted); font-size: 0.85rem; }
.stats-schedule-teams { font-size: 0.9rem; }
.stats-schedule-vs { color: var(--muted); }

.stats-prematch-footer {
  margin-top: 16px;
  color: var(--muted);
  font-size: 0.85rem;
  text-align: center;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
}
```

Substitute the CSS variable names (`--border`, `--muted`, `--border-soft`) for whatever the codebase uses — `grep -n "var(--" app/globals.css` to discover.

- [ ] **Step 2: Visual smoke (local)**

Start the dev server (or `npm run dev`) and load `http://localhost:3000/?tournament=YONEX-SINGHA-BAT-BTY-2026` (or whatever the current pre-start tournament id is). Confirm all five new sections render without layout breakage.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(stats-panel): styles for pre-match sections + footer"
```

---

## Task 20: Component test — back-compat with old cached payload

**Files:**
- Test: `__tests__/TournamentStatsPanel.test.tsx`

- [ ] **Step 1: Create the test file**

Create `__tests__/TournamentStatsPanel.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import TournamentStatsPanel from '@/components/TournamentStatsPanel'
import { LanguageContext } from '@/lib/LanguageContext'

function renderPanel(payload: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  }) as unknown as typeof fetch
  return render(
    <LanguageContext.Provider value={{ lang: 'en', t: (k: string) => k, setLang: () => {} }}>
      <TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />
    </LanguageContext.Provider>
  )
}

const minimalLegacyPayload = {
  tournamentId: 'TEST-2026',
  generatedAt: '2026-06-05T00:00:00Z',
  coverage: { daysOnDisk: 0, daysFromMemory: 0, daysFromBat: 0, totalDays: 0 },
  kpis: { events: 0, matches: 1, decided: 1, walkovers: 0, retired: 0, nowPlaying: 0,
    players: 2, multiEventPlayers: 0, courtMinutes: 30, avgMatchMinutes: 30, threeSetterRate: 0,
    entries: 0, draws: 0,
  },
  dailyVolume: [], events: [], drama: { marathon: null, highestSet: null, highestScoringMatch: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null },
  topPlayers: [], courtUtilization: [], clubMedals: [], multiGoldPlayers: [],
  clubRosters: [], countryRosters: [],
  integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
  // No seedHeadlines / multiEventEntries / potentialCollisions / defendingChampion / schedulePreview fields.
}

test('renders without crashing when new optional fields are absent', async () => {
  renderPanel(minimalLegacyPayload)
  await waitFor(() => {
    expect(screen.queryByText('statsSectionSeedHeadlines')).toBeNull()
    expect(screen.queryByText('statsSectionDefendingChampions')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx jest __tests__/TournamentStatsPanel.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add __tests__/TournamentStatsPanel.test.tsx
git commit -m "test(stats-panel): back-compat with legacy cached payload"
```

---

## Task 21: Component test — pre-match render

**Files:**
- Modify: `__tests__/TournamentStatsPanel.test.tsx`

- [ ] **Step 1: Append the pre-match render test**

Append to `__tests__/TournamentStatsPanel.test.tsx`:

```tsx
const preMatchPayload = {
  ...minimalLegacyPayload,
  kpis: { ...minimalLegacyPayload.kpis, matches: 0, decided: 0, entries: 12, draws: 3, players: 8 },
  seedHeadlines: [{ event: 'MS', seeds: [
    { seed: 1, players: ['Alice'], club: 'A' },
    { seed: 2, players: ['Bob'], club: 'B' },
  ]}],
  multiEventEntries: [{ playerId: 'p1', name: 'Alice', club: 'A', events: ['MS', 'XD'] }],
  potentialCollisions: [{
    event: 'MS',
    semis: [
      { sideA: { seed: 1, players: ['Alice'], club: 'A' }, sideB: { seed: 4, players: ['Dan'] } },
      { sideA: { seed: 2, players: ['Bob'], club: 'B' }, sideB: { seed: 3, players: ['Cara'] } },
    ],
    final: { sideA: { seed: 1, players: ['Alice'], club: 'A' }, sideB: { seed: 2, players: ['Bob'], club: 'B' } },
  }],
}

test('renders pre-match sections and the footer when decided===0', async () => {
  renderPanel(preMatchPayload)
  await waitFor(() => screen.getByText('statsSectionSeedHeadlines'))
  expect(screen.getByText('statsSectionPotentialCollisions')).toBeInTheDocument()
  expect(screen.getByText('statsSectionMultiEventEntries')).toBeInTheDocument()
  expect(screen.getByText('statsPreMatchFooter')).toBeInTheDocument()
  // Result-phase sections must not appear:
  expect(screen.queryByText('statsSectionDrama')).toBeNull()
  expect(screen.queryByText('statsSectionTopPlayers')).toBeNull()
  expect(screen.queryByText('statsSectionIntegrity')).toBeNull()
})
```

- [ ] **Step 2: Run the test**

Run: `npx jest __tests__/TournamentStatsPanel.test.tsx -t 'renders pre-match sections'`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add __tests__/TournamentStatsPanel.test.tsx
git commit -m "test(stats-panel): pre-match render"
```

---

## Task 22: Component test — first-match transition

**Files:**
- Modify: `__tests__/TournamentStatsPanel.test.tsx`

- [ ] **Step 1: Append the transition test**

Append to `__tests__/TournamentStatsPanel.test.tsx`:

```tsx
test('drama section appears and footer disappears after polled refresh shows decided > 0', async () => {
  const postMatchPayload = {
    ...preMatchPayload,
    kpis: { ...preMatchPayload.kpis, matches: 1, decided: 1, courtMinutes: 45, avgMatchMinutes: 45, threeSetterRate: 0 },
    drama: {
      marathon: { draw: 'MS', round: 'R32', team1: ['A'], team2: ['B'], winnerSide: 1, scores: [{ t1: 21, t2: 19 }], durationMinutes: 45 },
      highestSet: null, highestScoringMatch: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null,
    },
  }
  let call = 0
  global.fetch = jest.fn().mockImplementation(() => Promise.resolve({
    ok: true,
    json: async () => (call++ === 0 ? preMatchPayload : postMatchPayload),
  })) as unknown as typeof fetch

  jest.useFakeTimers()
  const { rerender } = render(
    <LanguageContext.Provider value={{ lang: 'en', t: (k: string) => k, setLang: () => {} }}>
      <TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />
    </LanguageContext.Provider>
  )

  await waitFor(() => screen.getByText('statsPreMatchFooter'))
  // Trigger the 30s poll:
  jest.advanceTimersByTime(31_000)
  await waitFor(() => expect(screen.queryByText('statsPreMatchFooter')).toBeNull())
  expect(screen.getByText('statsSectionDrama')).toBeInTheDocument()
  jest.useRealTimers()
})
```

- [ ] **Step 2: Run the test**

Run: `npx jest __tests__/TournamentStatsPanel.test.tsx -t 'drama section appears'`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add __tests__/TournamentStatsPanel.test.tsx
git commit -m "test(stats-panel): mid-poll pre→post-match transition"
```

---

## Task 23: Manual smoke + final cleanup

**Files:**
- None (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Visit the pre-start tournament**

Open `http://localhost:3000/?tournament=YONEX-SINGHA-BAT-BTY-2026` (or whichever tournament is currently in the pre-start state). Confirm:
- The "Competition hasn't started" empty message is **gone**.
- Hero KPIs show `entries`, `draws`, `events`, `players`, `multiEventPlayers` and none of the result-phase tiles.
- Top seeds / Potential collisions / Multi-event entries sections render (if overview/roster cached).
- Events table shows the `Size` / `Type` columns and `Top seed` instead of `Winner` for undecided events.
- Schedule preview renders iff opening-day schedule has been published.
- Pre-match footer reads "No matches completed yet…".
- Existing tournaments (e.g. a completed past one) still render their full panel with no regressions.

- [ ] **Step 3: Long-press share smoke**

On the pre-start tournament, long-press each new section (`Defending`, `Top seeds`, `Potential collisions`, `Multi-event entries`, `Schedule preview`) and confirm the captured PNG contains the section content.

- [ ] **Step 4: Run the full test suite**

Run: `npx jest`
Expected: ALL PASS.

- [ ] **Step 5: Run typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 6: Final tidy commit (if any leftover housekeeping)**

If any small fixups remain (formatting, unused imports), do them as one commit:

```bash
git commit -am "chore(stats): pre-match panel polish"
```

- [ ] **Step 7: Open PR**

```bash
gh pr create --title "feat(stats): pre-start tournament panel" --body "$(cat <<'EOF'
## Summary
- Replaces the "Competition hasn't started" empty state with an entry-phase panel (defending champions, top seeds, potential SF/F, multi-event entries, schedule preview) that ticks into the existing result-phase sections as matches finalize.
- Single endpoint, single panel. New optional fields on `ComputedStats`; old cached payloads remain valid.
- Convention-based collisions from `TournamentOverview.seedEvents` (no new bracket parser).

## Test plan
- [ ] `npx jest` passes
- [ ] Pre-start tournament shows the new sections + footer
- [ ] Completed tournament panel unchanged
- [ ] Long-press share captures each new section

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

**Spec coverage check (against `docs/superpowers/specs/2026-06-05-pre-start-stats-design.md`):**

| Spec requirement | Task |
|---|---|
| `StatsKpis.entries` + `draws` | Task 1 + Task 6 |
| `StatsEventRow` size/type/entries/topSeed | Task 1 + Task 7 |
| `seedHeadlines` field + builder | Task 1 + Task 2 |
| `multiEventEntries` field + builder | Task 1 + Task 3 |
| `potentialCollisions` field + builder | Task 1 + Task 4 (spec deviation: convention-based) |
| `defendingChampion` field + builder | Task 1 + Task 11 |
| `schedulePreview` field + builder | Task 1 + Task 5 |
| Hybrid `dailyVolume` (scheduled + completed) | Task 8 |
| `aggregate()` extras bag | Task 9 |
| Prior-edition resolver heuristic | Task 10 |
| Pre-match `sourceVersion` recipe | Task 12 |
| Route fetches new inputs + new sourceVersion | Task 13 |
| `stats-generator.ts` background path | Task 14 (no-op, documented) |
| i18n keys (14 new EN+TH) | Task 15 |
| Empty-state replacement + per-section guards | Task 16 |
| 5 new sections rendered | Task 17 |
| Hero KPI + Events table degradation + footer | Task 18 |
| CSS for new sections | Task 19 |
| Back-compat component test | Task 20 |
| Pre-match component test | Task 21 |
| Mid-poll transition component test | Task 22 |
| Manual smoke | Task 23 |

All spec-listed requirements covered.

**Placeholder scan:** No TBD/TODO/"add appropriate error handling" patterns. Test code is concrete; implementation code is concrete. `listKnownTournamentsForResolver` and `fetchPriorWinners` adapter signatures are concrete and shown in full.

**Type consistency:** `PriorEditionWinnerMap` type defined in Task 9's stub and re-used identically in Tasks 10, 11, 13. Section names in component (`statsSection*`) match i18n keys added in Task 15. `StatsCollisionSeedRef` / `StatsSeedHead` shapes match between Task 1 (type def) and Tasks 4/17 (usage).

**Scope:** Single panel, single endpoint extension. Plan is focused; no decomposition needed.

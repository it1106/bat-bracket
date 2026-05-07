# Tournament Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-tournament stats panel reachable via a `📊` icon-only pill at the start of the day-tab strip, with zero new BAT hits for fully-past tournaments.

**Architecture:** A pure aggregator (`lib/tournamentStats.ts`) consumes already-cached `MatchesData` and per-day `MatchScheduleGroup[]`. A new `/api/stats` route orchestrates cache reads (`.cache/full/`, `.cache/days/`, in-memory tiers) and pins the aggregated result to `.cache/stats/<id>.json` only when the input full-cache is on disk. The existing `MatchSchedule` component renders a sentinel `'stats'` value on the day strip that swaps the schedule body for a new `TournamentStatsPanel`.

**Tech Stack:** Next.js App Router, TypeScript, Jest + jsdom, cheerio (already in use). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-07-tournament-stats-design.md`

---

## File Structure

| File | Status | Purpose |
|---|---|---|
| `lib/types.ts` | modify | Add `TournamentStats`, `MatchRef`, `SetRef` interfaces |
| `lib/tournamentStats.ts` | create | Pure aggregator — `aggregate(data, dayGroups) → ComputedStats` |
| `lib/stats-cache.ts` | create | Disk read/write of `.cache/stats/<id>.json` with sha256 of full-cache file |
| `app/api/stats/route.ts` | create | HTTP route; orchestrates cache tiers and aggregator |
| `components/TournamentStatsPanel.tsx` | create | Render-only React component for the stats payload |
| `components/MatchSchedule.tsx` | modify | Render the `📊` pill; swap body when `selectedDay === 'stats'` |
| `app/page.tsx` | modify | Allow `selectedDay === 'stats'`; suppress per-day fetch when active |
| `app/globals.css` | modify | `.match-schedule__day-tab--stats` rule |
| `lib/i18n.ts` | modify | Add 20 stats-related translation keys (en + th) |
| `fixtures/stats-sprc-full.json` | create | SPRC `MatchesData` snapshot for tests |
| `fixtures/stats-sprc-days.json` | create | SPRC per-day `dayGroupsByDate` snapshot |
| `fixtures/stats-empty.json` | create | All-zeros tournament fixture |
| `__tests__/tournamentStats.test.ts` | create | Aggregator unit tests |
| `__tests__/stats-cache.test.ts` | create | Disk cache round-trip + sha mismatch |
| `__tests__/api-stats-route.test.ts` | create | Route behavior with mocked cache primitives |
| `__tests__/TournamentStatsPanel.test.tsx` | create | Render snapshot |

Total expected diff: ~1500 added lines, ~30 modified.

---

## Task 1: Types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Append the new interfaces to `lib/types.ts`**

```ts
export interface TournamentStatsCoverage {
  daysOnDisk: number
  daysFromMemory: number
  daysFromBat: number
  totalDays: number
}

export interface StatsMatchRef {
  draw: string
  round: string
  team1: string[]
  team2: string[]
  winnerSide: 1 | 2
  scores: MatchScore[]
  durationMinutes?: number
}

export interface StatsSetRef extends StatsMatchRef {
  setIndex: number
}

export interface StatsKpis {
  matches: number
  decided: number
  walkovers: number
  retired: number
  nowPlaying: number
  players: number
  courtMinutes: number
  avgMatchMinutes: number
  threeSetterRate: number
  walkoverRate: number
}

export interface StatsDailyRow {
  date: string
  label: string
  total: number
  decided: number
  minutes: number
}

export interface StatsTopEvent {
  name: string
  matches: number
  threeSetters: number
  walkovers: number
  avgMinutes: number
}

export interface StatsDrama {
  marathon: StatsMatchRef | null
  closest: StatsMatchRef | null
  highestSet: StatsSetRef | null
  comebackCount: number
  comebackHighlight: StatsMatchRef | null
}

export interface StatsTopPlayer {
  playerId: string
  name: string
  seed?: string
  wins: number
  losses: number
}

export interface StatsCourt {
  name: string
  matches: number
  minutes: number
}

export interface StatsChampion {
  event: string
  winner: string[]
  runnerUp: string[]
  score: string
}

export interface StatsIntegrityWalkover {
  event: string
  walkovers: number
  rate: number
}

export interface StatsIntegrityThreeSetter {
  event: string
  rate: number
  sample: number
}

export interface StatsIntegrity {
  walkoverByEvent: StatsIntegrityWalkover[]
  threeSetterByEvent: StatsIntegrityThreeSetter[]
}

export interface ComputedStats {
  kpis: StatsKpis
  dailyVolume: StatsDailyRow[]
  topEvents: StatsTopEvent[]
  drama: StatsDrama
  topPlayers: StatsTopPlayer[]
  courtUtilization: StatsCourt[]
  champions: StatsChampion[]
  integrity: StatsIntegrity
}

export interface TournamentStats extends ComputedStats {
  tournamentId: string
  generatedAt: string
  coverage: TournamentStatsCoverage
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: passes (only new types added; nothing references them yet).

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "$(cat <<'EOF'
Add TournamentStats type definitions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Build the SPRC + empty fixtures

**Files:**
- Create: `fixtures/stats-sprc-full.json`
- Create: `fixtures/stats-sprc-days.json`
- Create: `fixtures/stats-empty.json`

The SPRC fixture is captured from the live cache that already exists on the production server. The "empty" fixture is hand-rolled.

- [ ] **Step 1: Capture SPRC full data**

```bash
ssh root@ezebat.lan "curl -s 'http://localhost:3000/api/matches?tournament=4526a530-2091-4932-adab-b0a9b1fff98e'" \
  > fixtures/stats-sprc-full.json
```

Verify the file is valid JSON and has 6 days:

```bash
node -e "const d=require('./fixtures/stats-sprc-full.json'); console.log('days:',d.days.length); console.log('groups:',d.groups.length)"
```

Expected: `days: 6 groups: 6` (or similar; just confirm shape).

- [ ] **Step 2: Capture SPRC per-day data**

```bash
mkdir -p /tmp/sprc-days
for d in 25690501 25690502 25690503 25690504 25690505 25690506; do
  ssh root@ezebat.lan "curl -s 'http://localhost:3000/api/matches?tournament=4526a530-2091-4932-adab-b0a9b1fff98e&date=$d'" \
    > /tmp/sprc-days/$d.json
done

node -e '
const fs = require("fs");
const days = ["2026-05-01","2026-05-02","2026-05-03","2026-05-04","2026-05-05","2026-05-06"];
const codes = ["25690501","25690502","25690503","25690504","25690505","25690506"];
const out = {};
for (let i = 0; i < days.length; i++) {
  out[days[i]] = JSON.parse(fs.readFileSync(`/tmp/sprc-days/${codes[i]}.json`, "utf8")).groups;
}
fs.writeFileSync("fixtures/stats-sprc-days.json", JSON.stringify(out));
console.log("wrote", Object.keys(out).length, "days");
'
```

Expected: `wrote 6 days`.

- [ ] **Step 3: Build the empty fixture**

Create `fixtures/stats-empty.json`:

```json
{
  "days": [
    { "date": "25690601", "label": "1 มิ.ย.", "dateIso": "2026-06-01", "hasMatches": false }
  ],
  "currentDate": "25690601",
  "groups": []
}
```

- [ ] **Step 4: Commit fixtures**

```bash
git add fixtures/stats-sprc-full.json fixtures/stats-sprc-days.json fixtures/stats-empty.json
git commit -m "$(cat <<'EOF'
Add tournament stats test fixtures

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Aggregator — KPIs

**Files:**
- Create: `lib/tournamentStats.ts`
- Create: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Write failing KPI test**

Create `__tests__/tournamentStats.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import { aggregate } from '@/lib/tournamentStats'
import type { MatchesData, MatchScheduleGroup } from '@/lib/types'

function loadFixtures() {
  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'stats-sprc-full.json'), 'utf8'),
  ) as MatchesData
  const days = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'stats-sprc-days.json'), 'utf8'),
  ) as Record<string, MatchScheduleGroup[]>
  return { data, days: new Map(Object.entries(days)) }
}

describe('tournamentStats.aggregate — KPIs', () => {
  it('reports SPRC headline numbers', () => {
    const { data, days } = loadFixtures()
    const stats = aggregate(data, days)
    expect(stats.kpis.matches).toBe(1384)
    expect(stats.kpis.decided).toBe(1343)
    expect(stats.kpis.walkovers).toBe(41)
    expect(stats.kpis.players).toBe(1102)
    expect(stats.kpis.courtMinutes).toBe(39046)
    expect(Math.round(stats.kpis.avgMatchMinutes)).toBe(29)
    expect(Math.round(stats.kpis.threeSetterRate * 100)).toBe(14)
    expect(Math.round(stats.kpis.walkoverRate * 1000) / 10).toBe(3.0)
  })
})
```

- [ ] **Step 2: Run, verify failure**

Run: `npx jest tournamentStats -t 'reports SPRC headline numbers'`
Expected: FAIL — `Cannot find module '@/lib/tournamentStats'`.

- [ ] **Step 3: Implement minimal aggregator with KPIs only**

Create `lib/tournamentStats.ts`:

```ts
import type {
  ComputedStats,
  MatchEntry,
  MatchScheduleGroup,
  MatchesData,
  StatsKpis,
} from './types'

const EMPTY: ComputedStats = {
  kpis: {
    matches: 0, decided: 0, walkovers: 0, retired: 0, nowPlaying: 0,
    players: 0, courtMinutes: 0, avgMatchMinutes: 0,
    threeSetterRate: 0, walkoverRate: 0,
  },
  dailyVolume: [],
  topEvents: [],
  drama: { marathon: null, closest: null, highestSet: null, comebackCount: 0, comebackHighlight: null },
  topPlayers: [],
  courtUtilization: [],
  champions: [],
  integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
}

export function parseDurationMinutes(raw: string | undefined): number {
  if (!raw) return 0
  const m = raw.trim().match(/^(?:(\d+)h\s*)?(?:(\d+)m)?$/)
  if (!m) return 0
  const h = parseInt(m[1] ?? '0', 10)
  const min = parseInt(m[2] ?? '0', 10)
  return h * 60 + min
}

interface MatchCtx {
  match: MatchEntry
  dateIso: string
  durationMinutes: number
}

function* iterateMatches(
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
): Generator<MatchCtx> {
  for (const day of data.days) {
    if (!day.dateIso) continue
    const groups = dayGroupsByDate.get(day.dateIso)
    if (!groups) continue
    for (const g of groups) {
      for (const m of g.matches) {
        yield { match: m, dateIso: day.dateIso, durationMinutes: parseDurationMinutes(m.duration) }
      }
    }
  }
}

function buildKpis(ctxs: MatchCtx[]): StatsKpis {
  let matches = 0, decided = 0, walkovers = 0, retired = 0, nowPlaying = 0
  let courtMinutes = 0, durationCount = 0, durationSum = 0
  let threeSetterDecided = 0
  const players = new Set<string>()

  for (const { match, durationMinutes } of ctxs) {
    matches++
    if (match.walkover) walkovers++
    if (match.retired) retired++
    if (match.nowPlaying) nowPlaying++
    const isDecided = match.winner !== null && !match.walkover
    if (isDecided) {
      decided++
      if (match.scores.length >= 3) threeSetterDecided++
    }
    courtMinutes += durationMinutes
    if (durationMinutes > 0) {
      durationCount++
      durationSum += durationMinutes
    }
    for (const team of [match.team1, match.team2]) {
      for (const p of team) {
        if (p.playerId) players.add(p.playerId)
      }
    }
  }

  return {
    matches,
    decided,
    walkovers,
    retired,
    nowPlaying,
    players: players.size,
    courtMinutes,
    avgMatchMinutes: durationCount === 0 ? 0 : durationSum / durationCount,
    threeSetterRate: decided === 0 ? 0 : threeSetterDecided / decided,
    walkoverRate: matches === 0 ? 0 : walkovers / matches,
  }
}

export function aggregate(
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
): ComputedStats {
  const ctxs: MatchCtx[] = [...iterateMatches(data, dayGroupsByDate)]
  if (ctxs.length === 0) return { ...EMPTY }
  return {
    ...EMPTY,
    kpis: buildKpis(ctxs),
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx jest tournamentStats -t 'reports SPRC headline numbers'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournamentStats.ts __tests__/tournamentStats.test.ts
git commit -m "$(cat <<'EOF'
Aggregator: tournament KPIs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Aggregator — daily volume + top events

**Files:**
- Modify: `lib/tournamentStats.ts`
- Modify: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Append failing tests**

Add to `__tests__/tournamentStats.test.ts`:

```ts
describe('tournamentStats.aggregate — daily volume', () => {
  it('returns one row per fixture day, sorted by data.days order', () => {
    const { data, days } = loadFixtures()
    const stats = aggregate(data, days)
    expect(stats.dailyVolume.map((d) => d.date)).toEqual([
      '2026-05-01', '2026-05-02', '2026-05-03',
      '2026-05-04', '2026-05-05', '2026-05-06',
    ])
    expect(stats.dailyVolume[0].total).toBe(397)
    expect(stats.dailyVolume[0].minutes).toBe(9608)
    expect(stats.dailyVolume[5].total).toBe(33)
  })
})

describe('tournamentStats.aggregate — top events', () => {
  it('returns the largest events first, capped at 10', () => {
    const { data, days } = loadFixtures()
    const stats = aggregate(data, days)
    expect(stats.topEvents.length).toBeLessThanOrEqual(10)
    expect(stats.topEvents[0].name).toBe('BS U15')
    expect(stats.topEvents[0].matches).toBe(111)
    expect(stats.topEvents[0].avgMinutes).toBeGreaterThan(20)
  })
})
```

- [ ] **Step 2: Run, verify failures**

Run: `npx jest tournamentStats`
Expected: 2 failures (`Expected 6, received 0` and `Expected 'BS U15'`).

- [ ] **Step 3: Implement daily volume + top events**

Edit `lib/tournamentStats.ts` — replace the body of `aggregate` and add helpers:

```ts
function buildDailyVolume(
  data: MatchesData,
  ctxs: MatchCtx[],
): ComputedStats['dailyVolume'] {
  const byDate = new Map<string, { total: number; decided: number; minutes: number }>()
  for (const c of ctxs) {
    const row = byDate.get(c.dateIso) ?? { total: 0, decided: 0, minutes: 0 }
    row.total++
    if (c.match.winner !== null && !c.match.walkover) row.decided++
    row.minutes += c.durationMinutes
    byDate.set(c.dateIso, row)
  }
  const rows: ComputedStats['dailyVolume'] = []
  for (const day of data.days) {
    if (!day.dateIso) continue
    const r = byDate.get(day.dateIso) ?? { total: 0, decided: 0, minutes: 0 }
    rows.push({ date: day.dateIso, label: day.label, ...r })
  }
  return rows
}

function buildTopEvents(ctxs: MatchCtx[]): ComputedStats['topEvents'] {
  interface Acc { matches: number; threeSetters: number; walkovers: number; durSum: number; durCount: number }
  const byEvent = new Map<string, Acc>()
  for (const { match } of ctxs) {
    if (!match.draw) continue
    const a = byEvent.get(match.draw) ?? { matches: 0, threeSetters: 0, walkovers: 0, durSum: 0, durCount: 0 }
    a.matches++
    if (match.walkover) a.walkovers++
    if (match.winner !== null && !match.walkover && match.scores.length >= 3) a.threeSetters++
    const d = parseDurationMinutes(match.duration)
    if (d > 0) { a.durSum += d; a.durCount++ }
    byEvent.set(match.draw, a)
  }
  const rows = [...byEvent.entries()].map(([name, a]) => ({
    name,
    matches: a.matches,
    threeSetters: a.threeSetters,
    walkovers: a.walkovers,
    avgMinutes: a.durCount === 0 ? 0 : a.durSum / a.durCount,
  }))
  rows.sort((a, b) => b.matches - a.matches || (a.name < b.name ? -1 : 1))
  return rows.slice(0, 10)
}

export function aggregate(
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
): ComputedStats {
  const ctxs: MatchCtx[] = [...iterateMatches(data, dayGroupsByDate)]
  if (ctxs.length === 0) return { ...EMPTY }
  return {
    ...EMPTY,
    kpis: buildKpis(ctxs),
    dailyVolume: buildDailyVolume(data, ctxs),
    topEvents: buildTopEvents(ctxs),
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx jest tournamentStats`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournamentStats.ts __tests__/tournamentStats.test.ts
git commit -m "$(cat <<'EOF'
Aggregator: daily volume + top events

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Aggregator — drama (marathon, closest, highest set, comebacks)

**Files:**
- Modify: `lib/tournamentStats.ts`
- Modify: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Append failing tests**

Add to `__tests__/tournamentStats.test.ts`:

```ts
describe('tournamentStats.aggregate — drama', () => {
  it('finds the marathon match', () => {
    const { data, days } = loadFixtures()
    const stats = aggregate(data, days)
    expect(stats.drama.marathon).not.toBeNull()
    expect(stats.drama.marathon!.draw).toBe('GD U19')
    expect(stats.drama.marathon!.durationMinutes).toBe(129)
  })

  it('finds the closest match (smallest aggregate margin)', () => {
    const { data, days } = loadFixtures()
    const stats = aggregate(data, days)
    expect(stats.drama.closest).not.toBeNull()
    const m = stats.drama.closest!
    const margin = m.scores.reduce((s, x) => s + Math.abs(x.t1 - x.t2), 0)
    expect(margin).toBeLessThanOrEqual(4)
  })

  it('finds a 28-26 highest set', () => {
    const { data, days } = loadFixtures()
    const stats = aggregate(data, days)
    expect(stats.drama.highestSet).not.toBeNull()
    const s = stats.drama.highestSet!.scores[stats.drama.highestSet!.setIndex]
    expect(s.t1 + s.t2).toBe(54)
  })

  it('counts comebacks', () => {
    const { data, days } = loadFixtures()
    const stats = aggregate(data, days)
    expect(stats.drama.comebackCount).toBe(102)
    expect(stats.drama.comebackHighlight).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run, verify failures**

Run: `npx jest tournamentStats -t drama`
Expected: 4 failures (drama fields all null/0).

- [ ] **Step 3: Implement drama**

Add to `lib/tournamentStats.ts`:

```ts
import { longRoundL } from './i18n'
import type { StatsMatchRef, StatsSetRef } from './types'

function teamNames(team: MatchEntry['team1']): string[] {
  return team.map((p) => p.name)
}

function toMatchRef(m: MatchEntry, durationMinutes: number): StatsMatchRef | null {
  if (m.winner === null) return null
  return {
    draw: m.draw,
    round: m.round,
    team1: teamNames(m.team1),
    team2: teamNames(m.team2),
    winnerSide: m.winner,
    scores: m.scores,
    durationMinutes: durationMinutes > 0 ? durationMinutes : undefined,
  }
}

function aggregateMargin(scores: MatchEntry['scores']): number {
  let total = 0
  for (const s of scores) total += Math.abs(s.t1 - s.t2)
  return total
}

function isComeback(m: MatchEntry): boolean {
  if (m.winner === null || m.scores.length < 2) return false
  const s0 = m.scores[0]
  if (m.winner === 1) return s0.t1 < s0.t2
  return s0.t2 < s0.t1
}

function roundRank(round: string): number {
  const long = longRoundL(round, 'en')
  if (long === 'Final') return 0
  if (long === 'Semi Final') return 1
  if (long === 'Quarter Final') return 2
  return 3
}

function buildDrama(ctxs: MatchCtx[]): ComputedStats['drama'] {
  let marathon: { ref: StatsMatchRef; minutes: number } | null = null
  let closest: { ref: StatsMatchRef; margin: number; idx: number } | null = null
  let highestSet: { ref: StatsSetRef; total: number; idx: number } | null = null
  let comebackCount = 0
  let comebackBest: { ref: StatsMatchRef; rank: number; idx: number } | null = null

  ctxs.forEach((c, i) => {
    const m = c.match
    if (m.winner === null || m.walkover) return

    if (c.durationMinutes > 0) {
      if (!marathon || c.durationMinutes > marathon.minutes) {
        const ref = toMatchRef(m, c.durationMinutes)!
        marathon = { ref, minutes: c.durationMinutes }
      }
    }

    if (m.scores.length > 0) {
      const margin = aggregateMargin(m.scores)
      if (!closest || margin < closest.margin) {
        closest = { ref: toMatchRef(m, c.durationMinutes)!, margin, idx: i }
      }
    }

    m.scores.forEach((s, si) => {
      const total = s.t1 + s.t2
      if (!highestSet || total > highestSet.total) {
        const baseRef = toMatchRef(m, c.durationMinutes)!
        highestSet = { ref: { ...baseRef, setIndex: si }, total, idx: i }
      }
    })

    if (isComeback(m)) {
      comebackCount++
      const rank = roundRank(m.round)
      if (!comebackBest || rank < comebackBest.rank) {
        comebackBest = { ref: toMatchRef(m, c.durationMinutes)!, rank, idx: i }
      }
    }
  })

  return {
    marathon: marathon ? marathon.ref : null,
    closest: closest ? closest.ref : null,
    highestSet: highestSet ? highestSet.ref : null,
    comebackCount,
    comebackHighlight: comebackBest ? comebackBest.ref : null,
  }
}
```

Wire it into `aggregate()`:

```ts
return {
  ...EMPTY,
  kpis: buildKpis(ctxs),
  dailyVolume: buildDailyVolume(data, ctxs),
  topEvents: buildTopEvents(ctxs),
  drama: buildDrama(ctxs),
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx jest tournamentStats`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournamentStats.ts __tests__/tournamentStats.test.ts
git commit -m "$(cat <<'EOF'
Aggregator: drama (marathon, closest, highest set, comebacks)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Aggregator — top players, courts, champions, integrity

**Files:**
- Modify: `lib/tournamentStats.ts`
- Modify: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Append failing tests**

Add to `__tests__/tournamentStats.test.ts`:

```ts
describe('tournamentStats.aggregate — leaderboard, courts, champions, integrity', () => {
  it('top player has 11 wins', () => {
    const { data, days } = loadFixtures()
    const stats = aggregate(data, days)
    expect(stats.topPlayers[0].wins).toBe(11)
    expect(stats.topPlayers[0].losses).toBe(1)
    expect(stats.topPlayers.length).toBeLessThanOrEqual(12)
  })

  it('returns court utilization sorted by minutes desc, capped at 14', () => {
    const { data, days } = loadFixtures()
    const stats = aggregate(data, days)
    expect(stats.courtUtilization.length).toBeLessThanOrEqual(14)
    for (let i = 1; i < stats.courtUtilization.length; i++) {
      expect(stats.courtUtilization[i - 1].minutes).toBeGreaterThanOrEqual(stats.courtUtilization[i].minutes)
    }
  })

  it('returns one champion per concluded event', () => {
    const { data, days } = loadFixtures()
    const stats = aggregate(data, days)
    expect(stats.champions.length).toBe(33)
    for (const c of stats.champions) {
      expect(c.winner.length).toBeGreaterThan(0)
      expect(c.runnerUp.length).toBeGreaterThan(0)
      expect(c.score).toMatch(/\d+-\d+/)
    }
  })

  it('flags WS as the highest walkover-rate event', () => {
    const { data, days } = loadFixtures()
    const stats = aggregate(data, days)
    expect(stats.integrity.walkoverByEvent[0].event).toBe('WS')
    expect(stats.integrity.walkoverByEvent[0].walkovers).toBe(4)
    expect(Math.round(stats.integrity.walkoverByEvent[0].rate * 100)).toBe(22)
  })
})
```

- [ ] **Step 2: Run, verify failures**

Run: `npx jest tournamentStats`
Expected: 4 failures.

- [ ] **Step 3: Implement remaining sections**

Add to `lib/tournamentStats.ts`:

```ts
function extractSeed(name: string): { plain: string; seed?: string } {
  const m = name.match(/^(.*?)\s*(\[\d+\])\s*$/)
  if (!m) return { plain: name }
  return { plain: m[1].trim(), seed: m[2] }
}

function buildTopPlayers(ctxs: MatchCtx[]): ComputedStats['topPlayers'] {
  interface Rec { name: string; wins: number; losses: number }
  const tally = new Map<string, Rec>()
  for (const { match } of ctxs) {
    if (match.winner === null || match.walkover) continue
    for (const p of match.team1) {
      if (!p.playerId) continue
      const r = tally.get(p.playerId) ?? { name: p.name, wins: 0, losses: 0 }
      if (match.winner === 1) r.wins++; else r.losses++
      tally.set(p.playerId, r)
    }
    for (const p of match.team2) {
      if (!p.playerId) continue
      const r = tally.get(p.playerId) ?? { name: p.name, wins: 0, losses: 0 }
      if (match.winner === 2) r.wins++; else r.losses++
      tally.set(p.playerId, r)
    }
  }
  const rows = [...tally.entries()].map(([playerId, r]) => {
    const { plain, seed } = extractSeed(r.name)
    return { playerId, name: plain, seed, wins: r.wins, losses: r.losses }
  })
  rows.sort((a, b) => b.wins - a.wins || a.losses - b.losses || (a.playerId < b.playerId ? -1 : 1))
  return rows.slice(0, 12)
}

function buildCourtUtilization(ctxs: MatchCtx[]): ComputedStats['courtUtilization'] {
  const byCourt = new Map<string, { matches: number; minutes: number }>()
  for (const { match, durationMinutes } of ctxs) {
    const c = match.court
    if (!c) continue
    const a = byCourt.get(c) ?? { matches: 0, minutes: 0 }
    a.matches++
    a.minutes += durationMinutes
    byCourt.set(c, a)
  }
  const rows = [...byCourt.entries()].map(([name, a]) => ({ name, ...a }))
  rows.sort((a, b) => b.minutes - a.minutes || b.matches - a.matches)
  return rows.slice(0, 14)
}

function fmtScore(scores: MatchEntry['scores']): string {
  return scores.map((s) => `${s.t1}-${s.t2}`).join(', ')
}

function buildChampions(ctxs: MatchCtx[]): ComputedStats['champions'] {
  const lastFinalByDraw = new Map<string, MatchEntry>()
  for (const { match } of ctxs) {
    if (match.winner === null || match.walkover) continue
    if (longRoundL(match.round, 'en') !== 'Final') continue
    if (!match.draw) continue
    lastFinalByDraw.set(match.draw, match)
  }
  const rows: ComputedStats['champions'] = []
  for (const [draw, m] of lastFinalByDraw) {
    const winner = m.winner === 1 ? m.team1 : m.team2
    const runnerUp = m.winner === 1 ? m.team2 : m.team1
    rows.push({
      event: draw,
      winner: teamNames(winner),
      runnerUp: teamNames(runnerUp),
      score: fmtScore(m.scores),
    })
  }
  rows.sort((a, b) => (a.event < b.event ? -1 : 1))
  return rows
}

function buildIntegrity(ctxs: MatchCtx[]): ComputedStats['integrity'] {
  interface EvAcc { total: number; walkovers: number; threeSetters: number; decided: number }
  const byEvent = new Map<string, EvAcc>()
  for (const { match } of ctxs) {
    if (!match.draw) continue
    const a = byEvent.get(match.draw) ?? { total: 0, walkovers: 0, threeSetters: 0, decided: 0 }
    a.total++
    if (match.walkover) a.walkovers++
    if (match.winner !== null && !match.walkover) {
      a.decided++
      if (match.scores.length >= 3) a.threeSetters++
    }
    byEvent.set(match.draw, a)
  }
  const walkoverByEvent: ComputedStats['integrity']['walkoverByEvent'] = []
  const threeSetterByEvent: ComputedStats['integrity']['threeSetterByEvent'] = []
  for (const [event, a] of byEvent) {
    if (a.walkovers > 0) {
      walkoverByEvent.push({ event, walkovers: a.walkovers, rate: a.walkovers / a.total })
    }
    if (a.decided >= 10) {
      threeSetterByEvent.push({ event, rate: a.threeSetters / a.decided, sample: a.decided })
    }
  }
  walkoverByEvent.sort((a, b) => b.rate - a.rate || b.walkovers - a.walkovers)
  threeSetterByEvent.sort((a, b) => b.rate - a.rate || b.sample - a.sample)
  return {
    walkoverByEvent: walkoverByEvent.slice(0, 8),
    threeSetterByEvent: threeSetterByEvent.slice(0, 8),
  }
}
```

Wire into `aggregate()`:

```ts
return {
  kpis: buildKpis(ctxs),
  dailyVolume: buildDailyVolume(data, ctxs),
  topEvents: buildTopEvents(ctxs),
  drama: buildDrama(ctxs),
  topPlayers: buildTopPlayers(ctxs),
  courtUtilization: buildCourtUtilization(ctxs),
  champions: buildChampions(ctxs),
  integrity: buildIntegrity(ctxs),
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx jest tournamentStats`
Expected: all PASS.

- [ ] **Step 5: Empty-fixture test**

Append to `__tests__/tournamentStats.test.ts`:

```ts
describe('tournamentStats.aggregate — empty', () => {
  it('returns the all-zero shape when there are no matches', () => {
    const data = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'stats-empty.json'), 'utf8'),
    ) as MatchesData
    const stats = aggregate(data, new Map())
    expect(stats.kpis.matches).toBe(0)
    expect(stats.dailyVolume).toEqual([])
    expect(stats.topEvents).toEqual([])
    expect(stats.champions).toEqual([])
    expect(stats.drama.marathon).toBeNull()
  })
})
```

Run: `npx jest tournamentStats`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/tournamentStats.ts __tests__/tournamentStats.test.ts
git commit -m "$(cat <<'EOF'
Aggregator: leaderboard, courts, champions, integrity

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Stats disk cache

**Files:**
- Create: `lib/stats-cache.ts`
- Create: `__tests__/stats-cache.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/stats-cache.test.ts`:

```ts
import fs from 'fs'
import os from 'os'
import path from 'path'
import { readStatsCache, writeStatsCache, hashFullCacheBytes } from '@/lib/stats-cache'
import type { TournamentStats } from '@/lib/types'

describe('stats-cache', () => {
  let tmpRoot: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bat-stats-'))
    process.chdir(tmpRoot)
  })
  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  const sampleStats = (): TournamentStats => ({
    tournamentId: 'abc',
    generatedAt: '2026-05-07T00:00:00.000Z',
    coverage: { daysOnDisk: 1, daysFromMemory: 0, daysFromBat: 0, totalDays: 1 },
    kpis: {
      matches: 1, decided: 1, walkovers: 0, retired: 0, nowPlaying: 0,
      players: 2, courtMinutes: 30, avgMatchMinutes: 30,
      threeSetterRate: 0, walkoverRate: 0,
    },
    dailyVolume: [], topEvents: [],
    drama: { marathon: null, closest: null, highestSet: null, comebackCount: 0, comebackHighlight: null },
    topPlayers: [], courtUtilization: [], champions: [],
    integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
  })

  it('returns null when no stats cache exists', async () => {
    expect(await readStatsCache('abc')).toBeNull()
  })

  it('round-trips a write+read with matching sourceVersion', async () => {
    await writeStatsCache('abc', { sourceVersion: 'full:xyz', stats: sampleStats() })
    const got = await readStatsCache('abc')
    expect(got).not.toBeNull()
    expect(got!.sourceVersion).toBe('full:xyz')
    expect(got!.stats.tournamentId).toBe('abc')
  })

  it('hashFullCacheBytes returns a stable sha256', () => {
    const a = hashFullCacheBytes(Buffer.from('hello'))
    const b = hashFullCacheBytes(Buffer.from('hello'))
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })
})
```

- [ ] **Step 2: Run, verify failures**

Run: `npx jest stats-cache`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/stats-cache.ts`:

```ts
import { promises as fs } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import type { TournamentStats } from './types'

const STATS_ROOT = path.join(process.cwd(), '.cache', 'stats')

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function statsPath(tournamentId: string): string {
  return path.join(STATS_ROOT, `${safeSegment(tournamentId)}.json`)
}

export interface StatsCacheEnvelope {
  version: 1
  sourceVersion: string
  stats: TournamentStats
}

export async function readStatsCache(tournamentId: string): Promise<StatsCacheEnvelope | null> {
  try {
    const buf = await fs.readFile(statsPath(tournamentId), 'utf8')
    const parsed = JSON.parse(buf) as StatsCacheEnvelope
    if (parsed.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeStatsCache(
  tournamentId: string,
  envelope: { sourceVersion: string; stats: TournamentStats },
): Promise<void> {
  const file = statsPath(tournamentId)
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const payload: StatsCacheEnvelope = { version: 1, ...envelope }
    await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
    await fs.rename(tmp, file)
    console.log(`[stats-cache] wrote tournament=${tournamentId}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[stats-cache] write failed tournament=${tournamentId} err=${msg}`)
  }
}

export function hashFullCacheBytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx jest stats-cache`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/stats-cache.ts __tests__/stats-cache.test.ts
git commit -m "$(cat <<'EOF'
Stats disk cache with sourceVersion fingerprint

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `/api/stats` route

**Files:**
- Create: `app/api/stats/route.ts`
- Create: `__tests__/api-stats-route.test.ts`

- [ ] **Step 1: Write failing tests with mocked I/O**

Create `__tests__/api-stats-route.test.ts`:

```ts
import { GET } from '@/app/api/stats/route'

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    ...jest.requireActual('fs').promises,
    readFile: jest.fn(),
  },
}))
jest.mock('@/lib/stats-cache', () => ({
  readStatsCache: jest.fn(),
  writeStatsCache: jest.fn(),
  hashFullCacheBytes: jest.fn(() => 'sha-fixed'),
}))
jest.mock('@/lib/day-cache', () => ({
  readFullCache: jest.fn(),
  readDayCache: jest.fn(),
}))

import { promises as fs } from 'fs'
import { readStatsCache, writeStatsCache } from '@/lib/stats-cache'
import { readFullCache, readDayCache } from '@/lib/day-cache'
import path from 'path'

const SPRC = '4526a530-2091-4932-adab-b0a9b1fff98e'

function loadFullFixture() {
  const real = jest.requireActual('fs') as typeof import('fs')
  return JSON.parse(real.readFileSync(path.join(__dirname, '..', 'fixtures', 'stats-sprc-full.json'), 'utf8'))
}
function loadDayFixtures() {
  const real = jest.requireActual('fs') as typeof import('fs')
  return JSON.parse(real.readFileSync(path.join(__dirname, '..', 'fixtures', 'stats-sprc-days.json'), 'utf8'))
}

function makeReq(qs = `?tournament=${SPRC}`): Request {
  return new Request(`http://localhost/api/stats${qs}`)
}

describe('GET /api/stats', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 400 when tournament param missing', async () => {
    const res = await GET(makeReq(''))
    expect(res.status).toBe(400)
  })

  it('serves from disk cache when sourceVersion matches', async () => {
    ;(readFullCache as jest.Mock).mockResolvedValue(loadFullFixture())
    ;(fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('any-bytes'))
    ;(readStatsCache as jest.Mock).mockResolvedValue({
      version: 1, sourceVersion: 'full:sha-fixed',
      stats: { tournamentId: SPRC, generatedAt: 'X', coverage: {}, kpis: { matches: 999 } },
    })

    const res = await GET(makeReq())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.kpis.matches).toBe(999)
    expect(writeStatsCache).not.toHaveBeenCalled()
  })

  it('aggregates from full cache and pins to disk on first miss', async () => {
    ;(readFullCache as jest.Mock).mockResolvedValue(loadFullFixture())
    ;(fs.readFile as jest.Mock).mockImplementation((p: string) => {
      if (p.includes('.cache/full/')) return Promise.resolve(Buffer.from('full-bytes'))
      const days = loadDayFixtures()
      const m = p.match(/(\d{4}-\d{2}-\d{2})\.json$/)
      if (m && days[m[1]]) return Promise.resolve(JSON.stringify({ groups: days[m[1]] }))
      return Promise.reject(new Error('no fixture for ' + p))
    })
    ;(readStatsCache as jest.Mock).mockResolvedValue(null)
    ;(readDayCache as jest.Mock).mockImplementation(async (_id: string, dateIso: string) => {
      const days = loadDayFixtures()
      return days[dateIso] ? { groups: days[dateIso] } : null
    })

    const res = await GET(makeReq())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.kpis.matches).toBe(1384)
    expect(writeStatsCache).toHaveBeenCalledTimes(1)
  })

  it('does NOT pin to disk when full cache absent (mid-tournament)', async () => {
    ;(readFullCache as jest.Mock).mockResolvedValue(null)
    ;(readStatsCache as jest.Mock).mockResolvedValue(null)
    ;(readDayCache as jest.Mock).mockResolvedValue(null)

    const res = await GET(makeReq())
    expect([200, 502]).toContain(res.status)
    expect(writeStatsCache).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, verify failures**

Run: `npx jest api-stats-route`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `app/api/stats/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { aggregate } from '@/lib/tournamentStats'
import { readDayCache, readFullCache } from '@/lib/day-cache'
import { readStatsCache, writeStatsCache, hashFullCacheBytes } from '@/lib/stats-cache'
import type { MatchScheduleGroup, TournamentStats, MatchesData } from '@/lib/types'

export const maxDuration = 30

const STATS_TTL_MS = 60_000
const memCache = new Map<string, { data: TournamentStats; ts: number }>()

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_')
}

async function readFullCacheBytes(tournamentId: string): Promise<Buffer | null> {
  const file = path.join(process.cwd(), '.cache', 'full', `${safeSegment(tournamentId)}.json`)
  try {
    return await fs.readFile(file)
  } catch {
    return null
  }
}

function buildDayMap(
  data: MatchesData,
  perDay: Array<{ dateIso: string; groups: MatchScheduleGroup[] | null }>,
): Map<string, MatchScheduleGroup[]> {
  const out = new Map<string, MatchScheduleGroup[]>()
  for (const r of perDay) if (r.groups) out.set(r.dateIso, r.groups)
  // Also seed with the full-data groups if no day was set yet (covers
  // schedules where data.groups holds the current day verbatim).
  if (out.size === 0 && data.currentDate) {
    const today = data.days.find((d) => d.date === data.currentDate)?.dateIso
    if (today) out.set(today, data.groups)
  }
  return out
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')
  if (!tournamentId) {
    return NextResponse.json({ error: 'tournament param required' }, { status: 400 })
  }

  const memHit = memCache.get(tournamentId)
  if (memHit && Date.now() - memHit.ts < STATS_TTL_MS) {
    return NextResponse.json(memHit.data, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' },
    })
  }

  try {
    const fullData = await readFullCache(tournamentId)
    const fullBytes = await readFullCacheBytes(tournamentId)

    // daysFromMemory + daysFromBat stay 0 in this implementation — we only
    // distinguish disk hits vs absent. Promote them to live counters later
    // if we add a path that distinguishes mem-tier vs cold-fetch.
    let coverage = { daysOnDisk: 0, daysFromMemory: 0, daysFromBat: 0, totalDays: 0 }
    let dayMap: Map<string, MatchScheduleGroup[]> = new Map()
    let dataForAggregate: MatchesData | null = fullData

    if (fullData && fullBytes) {
      const sv = `full:${hashFullCacheBytes(fullBytes)}`
      const cached = await readStatsCache(tournamentId)
      if (cached && cached.sourceVersion === sv) {
        memCache.set(tournamentId, { data: cached.stats, ts: Date.now() })
        return NextResponse.json(cached.stats, {
          headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' },
        })
      }
      const perDay = await Promise.all(
        fullData.days.map(async (d) => {
          const groups = d.dateIso ? await readDayCache(tournamentId, d.dateIso) : null
          if (groups) coverage.daysOnDisk++
          return { dateIso: d.dateIso, groups: groups?.groups ?? null }
        }),
      )
      coverage.totalDays = fullData.days.length
      dayMap = buildDayMap(fullData, perDay)

      const stats = aggregate(fullData, dayMap)
      const full: TournamentStats = {
        tournamentId,
        generatedAt: new Date().toISOString(),
        coverage,
        ...stats,
      }
      await writeStatsCache(tournamentId, { sourceVersion: sv, stats: full })
      memCache.set(tournamentId, { data: full, ts: Date.now() })
      return NextResponse.json(full, {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' },
      })
    }

    // Mid-tournament path: full-cache file not yet pinned. Read whatever
    // day shards we have on disk; days not on disk return null and the
    // aggregator will simply omit them.
    if (!dataForAggregate) {
      // Without the full data we cannot enumerate days. Return an empty
      // shape rather than fanning out to BAT.
      const empty: TournamentStats = {
        tournamentId,
        generatedAt: new Date().toISOString(),
        coverage,
        kpis: {
          matches: 0, decided: 0, walkovers: 0, retired: 0, nowPlaying: 0,
          players: 0, courtMinutes: 0, avgMatchMinutes: 0,
          threeSetterRate: 0, walkoverRate: 0,
        },
        dailyVolume: [], topEvents: [],
        drama: { marathon: null, closest: null, highestSet: null, comebackCount: 0, comebackHighlight: null },
        topPlayers: [], courtUtilization: [], champions: [],
        integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
      }
      memCache.set(tournamentId, { data: empty, ts: Date.now() })
      return NextResponse.json(empty)
    }

    // (Fallthrough for completeness; in practice fullData?fullBytes branch
    // above handled the all-past case. This branch handles the case where
    // readFullCache returned data but readFullCacheBytes failed.)
    const stats = aggregate(dataForAggregate, dayMap)
    const full: TournamentStats = {
      tournamentId,
      generatedAt: new Date().toISOString(),
      coverage,
      ...stats,
    }
    memCache.set(tournamentId, { data: full, ts: Date.now() })
    return NextResponse.json(full)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load stats: ${message}` }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx jest api-stats-route`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/stats/route.ts __tests__/api-stats-route.test.ts
git commit -m "$(cat <<'EOF'
/api/stats route with cache-tier orchestration

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: i18n strings

**Files:**
- Modify: `lib/i18n.ts`

- [ ] **Step 1: Add new keys to the union**

In `lib/i18n.ts`, find the `Strings` (or equivalent) union type and append:

```
  | 'tournamentStats'
  | 'statsKpiMatches'
  | 'statsKpiPlayers'
  | 'statsKpiCourtTime'
  | 'statsKpiAvgMatch'
  | 'statsKpiThreeSetters'
  | 'statsKpiWalkoverRate'
  | 'statsSectionMatchesPerDay'
  | 'statsSectionTopEvents'
  | 'statsSectionDrama'
  | 'statsMarathonBadge'
  | 'statsHighestSetBadge'
  | 'statsClosestBadge'
  | 'statsComebacksBadge'
  | 'statsSectionTopPlayers'
  | 'statsSectionCourtUtilization'
  | 'statsSectionChampions'
  | 'statsSectionIntegrity'
  | 'statsEmptyState'
  | 'statsLoadFailed'
```

- [ ] **Step 2: Add English values**

In the `en` translations block, append:

```ts
  tournamentStats: 'Tournament stats',
  statsKpiMatches: 'Matches',
  statsKpiPlayers: 'Players',
  statsKpiCourtTime: 'Court time',
  statsKpiAvgMatch: 'Avg match',
  statsKpiThreeSetters: '3-setters',
  statsKpiWalkoverRate: 'Walkover rate',
  statsSectionMatchesPerDay: 'Matches per day',
  statsSectionTopEvents: 'Biggest events',
  statsSectionDrama: 'Match drama',
  statsMarathonBadge: 'Marathon',
  statsHighestSetBadge: 'Highest-scoring set',
  statsClosestBadge: 'Closest match',
  statsComebacksBadge: 'Comeback wins',
  statsSectionTopPlayers: 'Top players',
  statsSectionCourtUtilization: 'Court utilization',
  statsSectionChampions: 'Champions',
  statsSectionIntegrity: 'Quality & integrity',
  statsEmptyState: 'Early days — check back when more matches are decided.',
  statsLoadFailed: 'Could not load stats. Try again.',
```

- [ ] **Step 3: Add Thai values**

In the `th` translations block, append:

```ts
  tournamentStats: 'สถิติการแข่งขัน',
  statsKpiMatches: 'แมตช์',
  statsKpiPlayers: 'ผู้เล่น',
  statsKpiCourtTime: 'เวลาในสนาม',
  statsKpiAvgMatch: 'เฉลี่ย/แมตช์',
  statsKpiThreeSetters: '3 เกม',
  statsKpiWalkoverRate: 'อัตราว่าง (W.O.)',
  statsSectionMatchesPerDay: 'แมตช์ต่อวัน',
  statsSectionTopEvents: 'รายการใหญ่ที่สุด',
  statsSectionDrama: 'แมตช์น่าจดจำ',
  statsMarathonBadge: 'มาราธอน',
  statsHighestSetBadge: 'เกมคะแนนสูงสุด',
  statsClosestBadge: 'แมตช์สูสีที่สุด',
  statsComebacksBadge: 'ชนะแบบพลิกกลับ',
  statsSectionTopPlayers: 'ผู้เล่นยอดเยี่ยม',
  statsSectionCourtUtilization: 'การใช้งานสนาม',
  statsSectionChampions: 'แชมเปียน',
  statsSectionIntegrity: 'คุณภาพการแข่ง',
  statsEmptyState: 'ยังเร็วเกินไป — กลับมาดูอีกครั้งหลังจากการแข่งดำเนินไปมากขึ้น',
  statsLoadFailed: 'ไม่สามารถโหลดสถิติได้ กรุณาลองใหม่',
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add lib/i18n.ts
git commit -m "$(cat <<'EOF'
i18n: tournament-stats strings (en + th)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: TournamentStatsPanel component

**Files:**
- Create: `components/TournamentStatsPanel.tsx`
- Create: `__tests__/TournamentStatsPanel.test.tsx`

- [ ] **Step 1: Write a failing render test**

Create `__tests__/TournamentStatsPanel.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import TournamentStatsPanel from '@/components/TournamentStatsPanel'
import { LanguageProvider } from '@/lib/LanguageContext'

const mockStats = {
  tournamentId: 'abc',
  generatedAt: 'X',
  coverage: { daysOnDisk: 6, daysFromMemory: 0, daysFromBat: 0, totalDays: 6 },
  kpis: {
    matches: 1384, decided: 1343, walkovers: 41, retired: 6, nowPlaying: 0,
    players: 1102, courtMinutes: 39046, avgMatchMinutes: 29,
    threeSetterRate: 0.14, walkoverRate: 0.03,
  },
  dailyVolume: [{ date: '2026-05-01', label: '1 May', total: 397, decided: 387, minutes: 9608 }],
  topEvents: [{ name: 'BS U15', matches: 111, threeSetters: 25, walkovers: 0, avgMinutes: 29 }],
  drama: {
    marathon: { draw: 'GD U19', round: 'Quarter Final', team1: ['A'], team2: ['B'], winnerSide: 1, scores: [{ t1: 21, t2: 19 }], durationMinutes: 129 },
    closest: null, highestSet: null, comebackCount: 102, comebackHighlight: null,
  },
  topPlayers: [{ playerId: 'p1', name: 'Top Player', wins: 11, losses: 1 }],
  courtUtilization: [{ name: 'A05', matches: 103, minutes: 3238 }],
  champions: [{ event: 'BS U15', winner: ['Champ'], runnerUp: ['Other'], score: '21-14, 21-11' }],
  integrity: { walkoverByEvent: [{ event: 'WS', walkovers: 4, rate: 0.22 }], threeSetterByEvent: [] },
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => mockStats,
  }) as unknown as typeof fetch
})

describe('TournamentStatsPanel', () => {
  it('renders KPI numbers', async () => {
    render(<LanguageProvider><TournamentStatsPanel tournamentId="abc" /></LanguageProvider>)
    await waitFor(() => expect(screen.getByText('1,384')).toBeInTheDocument())
    expect(screen.getByText('1,102')).toBeInTheDocument()
    expect(screen.getByText('Top Player')).toBeInTheDocument()
    expect(screen.getByText(/GD U19/)).toBeInTheDocument()
  })

  it('renders empty state when matches === 0', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockStats, kpis: { ...mockStats.kpis, matches: 0 } }),
    })
    render(<LanguageProvider><TournamentStatsPanel tournamentId="abc" /></LanguageProvider>)
    await waitFor(() => expect(screen.getByText(/Early days/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run, verify failure**

Run: `npx jest TournamentStatsPanel`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `components/TournamentStatsPanel.tsx`. The full markup mirrors `public/tournament-stats-mockup.html` — port section by section. Skeleton:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import type { TournamentStats } from '@/lib/types'

interface Props {
  tournamentId: string
}

export default function TournamentStatsPanel({ tournamentId }: Props) {
  const { t } = useLanguage()
  const [stats, setStats] = useState<TournamentStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/stats?tournament=${encodeURIComponent(tournamentId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if ('error' in data) setError(data.error)
        else setStats(data as TournamentStats)
      })
      .catch(() => { if (!cancelled) setError('fetch failed') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tournamentId])

  if (loading) return <div className="stats-loading">…</div>
  if (error) return <div className="stats-error">{t('statsLoadFailed')}</div>
  if (!stats) return null

  if (stats.kpis.matches === 0) {
    return <div className="stats-empty">{t('statsEmptyState')}</div>
  }

  const fmt = (n: number) => n.toLocaleString('en-US')
  const hours = (m: number) => `${Math.round(m / 60)}h`
  const pct = (r: number) => `${Math.round(r * 100)}%`

  const dayMax = Math.max(1, ...stats.dailyVolume.map((d) => d.total))
  const courtMax = Math.max(1, ...stats.courtUtilization.map((c) => c.minutes))

  return (
    <div className="stats-panel">
      {/* HERO KPIs */}
      <div className="stats-kpis">
        <Kpi num={fmt(stats.kpis.matches)} label={t('statsKpiMatches')} />
        <Kpi num={fmt(stats.kpis.players)} label={t('statsKpiPlayers')} />
        <Kpi num={hours(stats.kpis.courtMinutes)} label={t('statsKpiCourtTime')} />
        <Kpi num={`${Math.round(stats.kpis.avgMatchMinutes)} min`} label={t('statsKpiAvgMatch')} />
        <Kpi num={pct(stats.kpis.threeSetterRate)} label={t('statsKpiThreeSetters')} />
        <Kpi num={pct(stats.kpis.walkoverRate)} label={t('statsKpiWalkoverRate')} />
      </div>

      {/* MATCHES PER DAY */}
      <Section title={t('statsSectionMatchesPerDay')}>
        {stats.dailyVolume.map((d) => (
          <div className="stats-bar-row" key={d.date}>
            <span className="stats-bar-label">{d.label}</span>
            <div className="stats-bar-track">
              <div className="stats-bar-fill" style={{ width: `${(d.total / dayMax) * 100}%` }} />
            </div>
            <span className="stats-bar-val">{fmt(d.total)}</span>
          </div>
        ))}
      </Section>

      {/* TOP EVENTS */}
      <Section title={t('statsSectionTopEvents')}>
        <table className="stats-table">
          <thead><tr><th>Event</th><th>Matches</th><th>3-set</th><th>Avg</th></tr></thead>
          <tbody>
            {stats.topEvents.map((e) => (
              <tr key={e.name}>
                <td>{e.name}</td>
                <td>{e.matches}</td>
                <td>{e.matches === 0 ? '0%' : pct(e.threeSetters / Math.max(1, e.matches - e.walkovers))}</td>
                <td>{Math.round(e.avgMinutes)} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* DRAMA */}
      <Section title={t('statsSectionDrama')}>
        {stats.drama.marathon && (
          <DramaCard
            badge={`${t('statsMarathonBadge')} — ${stats.drama.marathon.durationMinutes}m`}
            where={`${stats.drama.marathon.draw} · ${stats.drama.marathon.round}`}
            ref_={stats.drama.marathon}
          />
        )}
        {stats.drama.highestSet && (
          <DramaCard
            badge={`${t('statsHighestSetBadge')} — ${stats.drama.highestSet.scores[stats.drama.highestSet.setIndex].t1}-${stats.drama.highestSet.scores[stats.drama.highestSet.setIndex].t2}`}
            where={`${stats.drama.highestSet.draw} · ${stats.drama.highestSet.round}`}
            ref_={stats.drama.highestSet}
          />
        )}
        {stats.drama.closest && (
          <DramaCard
            badge={t('statsClosestBadge')}
            where={`${stats.drama.closest.draw} · ${stats.drama.closest.round}`}
            ref_={stats.drama.closest}
            cool
          />
        )}
        <div className="stats-comebacks">{stats.drama.comebackCount} {t('statsComebacksBadge')}</div>
      </Section>

      {/* TOP PLAYERS */}
      <Section title={t('statsSectionTopPlayers')}>
        <table className="stats-table">
          <thead><tr><th></th><th>Player</th><th>W–L</th></tr></thead>
          <tbody>
            {stats.topPlayers.map((p, i) => (
              <tr key={p.playerId}>
                <td>{i + 1}</td>
                <td>{p.name}{p.seed ? <span className="stats-seed"> {p.seed}</span> : null}</td>
                <td>{p.wins}–{p.losses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* COURTS */}
      <Section title={t('statsSectionCourtUtilization')}>
        {stats.courtUtilization.map((c) => (
          <div className="stats-bar-row" key={c.name}>
            <span className="stats-bar-label">{c.name}</span>
            <div className="stats-bar-track">
              <div className="stats-bar-fill" style={{ width: `${(c.minutes / courtMax) * 100}%` }} />
            </div>
            <span className="stats-bar-val">{(c.minutes / 60).toFixed(1)} h</span>
          </div>
        ))}
      </Section>

      {/* CHAMPIONS */}
      <Section title={t('statsSectionChampions')}>
        <div className="stats-champ-grid">
          {stats.champions.slice(0, 8).map((c) => (
            <div className="stats-champ" key={c.event}>
              <div className="stats-champ-event">{c.event}</div>
              <div className="stats-champ-winner">{c.winner.join(' / ')}</div>
              <div className="stats-champ-runner">def. {c.runnerUp.join(' / ')}</div>
              <div className="stats-champ-score">{c.score}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* INTEGRITY */}
      <Section title={t('statsSectionIntegrity')}>
        <div className="stats-integrity">
          <div>
            {stats.integrity.walkoverByEvent.slice(0, 3).map((w) => (
              <div key={w.event}>{w.event}: {w.walkovers} W.O. ({pct(w.rate)})</div>
            ))}
          </div>
          <div>
            {stats.integrity.threeSetterByEvent.slice(0, 3).map((s) => (
              <div key={s.event}>{s.event}: {pct(s.rate)} 3-set ({s.sample})</div>
            ))}
          </div>
        </div>
      </Section>
    </div>
  )
}

function Kpi({ num, label }: { num: string; label: string }) {
  return (
    <div className="stats-kpi">
      <div className="stats-kpi-num">{num}</div>
      <div className="stats-kpi-lbl">{label}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="stats-section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function DramaCard({
  badge,
  where,
  ref_,
  cool,
}: {
  badge: string
  where: string
  ref_: { team1: string[]; team2: string[]; winnerSide: 1 | 2; scores: Array<{ t1: number; t2: number }> }
  cool?: boolean
}) {
  const winner = ref_.winnerSide === 1 ? ref_.team1 : ref_.team2
  const loser = ref_.winnerSide === 1 ? ref_.team2 : ref_.team1
  return (
    <div className={`stats-drama ${cool ? 'stats-drama--cool' : ''}`}>
      <div className="stats-drama-head">
        <span className="stats-drama-badge">{badge}</span>
        <span className="stats-drama-where">{where}</span>
      </div>
      <div className="stats-drama-teams">
        {winner.join(' / ')} def. {loser.join(' / ')}
      </div>
      <div className="stats-drama-score">
        {ref_.scores.map((s) => `${s.t1}–${s.t2}`).join(', ')}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add CSS for the panel**

Append to `app/globals.css`:

```css
.stats-panel { padding: 4px 0 24px; }
.stats-kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 14px; }
.stats-kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
.stats-kpi-num { font-size: 20px; font-weight: 700; }
.stats-kpi-lbl { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
@media (max-width: 720px) { .stats-kpis { grid-template-columns: repeat(3, 1fr); } }

.stats-section { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; }
.stats-section h2 { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0 0 10px; }

.stats-bar-row { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 0; }
.stats-bar-label { width: 86px; color: var(--fg); flex-shrink: 0; }
.stats-bar-track { flex: 1; background: var(--bg); border-radius: 5px; height: 16px; overflow: hidden; }
.stats-bar-fill { background: var(--brand); height: 100%; border-radius: 5px; }
.stats-bar-val { width: 64px; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; font-size: 12px; }

.stats-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.stats-table th { text-align: left; color: var(--muted); font-weight: 600; font-size: 11px; padding: 4px 6px; border-bottom: 1px solid var(--border); }
.stats-table td { padding: 6px; border-bottom: 1px solid var(--border); }
.stats-table tr:last-child td { border-bottom: 0; }
.stats-seed { color: var(--muted); font-size: 11px; }

.stats-drama { border-left: 3px solid var(--brand); padding: 6px 10px; margin: 8px 0; background: var(--bg); border-radius: 0 6px 6px 0; }
.stats-drama--cool { border-left-color: var(--accent, #5e5ccf); }
.stats-drama-head { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.stats-drama-badge { font-size: 11px; font-weight: 700; color: var(--brand); letter-spacing: 0.04em; text-transform: uppercase; }
.stats-drama-where { font-size: 11px; color: var(--muted); }
.stats-drama-teams { font-weight: 600; font-size: 13px; margin: 3px 0 1px; }
.stats-drama-score { font-size: 12px; color: var(--fg); font-variant-numeric: tabular-nums; }

.stats-champ-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.stats-champ { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; background: var(--bg); }
.stats-champ-event { font-size: 11px; color: var(--brand); letter-spacing: 0.06em; text-transform: uppercase; font-weight: 700; }
.stats-champ-winner { font-weight: 600; font-size: 13px; line-height: 1.3; margin-top: 2px; }
.stats-champ-runner { font-size: 11px; color: var(--muted); margin-top: 2px; }
.stats-champ-score { font-size: 11px; color: var(--fg); font-variant-numeric: tabular-nums; margin-top: 3px; }

.stats-integrity { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px; color: var(--fg); }
@media (max-width: 720px) { .stats-integrity { grid-template-columns: 1fr; } }

.stats-empty, .stats-loading, .stats-error { padding: 24px; text-align: center; color: var(--muted); font-size: 13px; }
```

- [ ] **Step 5: Run, verify pass**

Run: `npx jest TournamentStatsPanel`
Expected: PASS for both render tests.

If `@testing-library/react` is not yet installed:
```bash
npm i -D @testing-library/react @testing-library/jest-dom
```
And ensure `jest.setup.ts` imports `@testing-library/jest-dom`.

- [ ] **Step 6: Commit**

```bash
git add components/TournamentStatsPanel.tsx __tests__/TournamentStatsPanel.test.tsx app/globals.css
git commit -m "$(cat <<'EOF'
TournamentStatsPanel component + styles

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Day-strip integration

**Files:**
- Modify: `components/MatchSchedule.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Add the stats pill rendering and body swap**

Edit `components/MatchSchedule.tsx`. Find the `Props` interface around line 14 and broaden `selectedDay`:

```ts
selectedDay: string  // may be a date OR the literal 'stats'
```

Find the day-tabs block at line 332-348 and prepend the stats pill:

```tsx
{(days.length > 0 || selectedDay === 'stats') && (
  <div className="match-schedule__day-tabs">
    <button
      key="__stats__"
      onClick={() => onDayChange('stats')}
      className={[
        'match-schedule__day-tab',
        'match-schedule__day-tab--stats',
        selectedDay === 'stats' ? 'active' : '',
      ].filter(Boolean).join(' ')}
      title={t('tournamentStats')}
      aria-label={t('tournamentStats')}
    >
      📊
    </button>
    {days.map((d) => (
      <button
        key={d.date}
        onClick={() => onDayChange(d.date)}
        className={[
          'match-schedule__day-tab',
          d.date === selectedDay ? 'active' : '',
          d.hasMatches === false ? 'empty' : '',
        ].filter(Boolean).join(' ')}
      >
        {d.label}
      </button>
    ))}
  </div>
)}
```

Find the body region after the day-tabs (currently lines ~350-395 in `MatchSchedule.tsx`):

```tsx
{loading && (
  <div className="p-8 text-center text-gray-400 text-sm">
    <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2 align-[-2px]" />
    {t('loadingMatches')}
  </div>
)}

{!loading && groups.length === 0 && (
  <div className="p-8 text-center text-gray-400 text-sm">{t('noMatchesScheduled')}</div>
)}

{!loading && (() => {
  const rendered = groups.map((group, gi) => {
    // ... existing logic ...
  })
  // ... existing return ...
})()}
```

Replace it with:

```tsx
{selectedDay === 'stats' && tournamentId ? (
  <TournamentStatsPanel tournamentId={tournamentId} />
) : (
  <>
    {loading && (
      <div className="p-8 text-center text-gray-400 text-sm">
        <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2 align-[-2px]" />
        {t('loadingMatches')}
      </div>
    )}

    {!loading && groups.length === 0 && (
      <div className="p-8 text-center text-gray-400 text-sm">{t('noMatchesScheduled')}</div>
    )}

    {!loading && (() => {
      const rendered = groups.map((group, gi) => {
        // ... existing logic, unchanged ...
      })
      // ... existing return, unchanged ...
    })()}
  </>
)}
```

(The inner contents of the existing render block stay byte-for-byte the same — only the wrapping changes.)

Add the import:

```ts
import TournamentStatsPanel from './TournamentStatsPanel'
```

- [ ] **Step 2: Add the sticky-left CSS rule**

Append to `app/globals.css`:

```css
.match-schedule__day-tab--stats {
  width: 32px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  position: sticky;
  left: 0;
  z-index: 1;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 4: Run existing MatchSchedule tests to verify no regression**

Run: `npx jest MatchSchedule`
Expected: PASS (existing assertions still hold; the new pill is decorative).

- [ ] **Step 5: Commit**

```bash
git add components/MatchSchedule.tsx app/globals.css
git commit -m "$(cat <<'EOF'
Render stats pill at start of day-tab strip

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: app/page.tsx — handle `selectedDay === 'stats'`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Locate `handleDayChange` (around line 528)**

Replace it with:

```tsx
const handleDayChange = useCallback(async (date: string) => {
  if (!selectedTournament) return
  setSelectedDay(date)
  if (date === 'stats') {
    return  // panel fetches from /api/stats itself
  }
  setLoadingMatches(true)
  try {
    const res = await fetch(`/api/matches?tournament=${encodeURIComponent(selectedTournament)}&date=${date}`)
    const data = await safeJson(res)
    if (!isApiError(data)) {
      const md = data as Pick<MatchesData, 'groups'>
      setMatchGroups(md.groups)
      setMatchDays(prev => prev.map(d =>
        d.date === date ? { ...d, hasMatches: md.groups.length > 0 } : d
      ))
    }
  } catch {}
  finally { setLoadingMatches(false) }
}, [selectedTournament])
```

- [ ] **Step 2: Verify the live-score effect (line ~179) is guarded**

Around line 179, ensure the early-return covers `selectedDay === 'stats'`:

```tsx
if (!completion || !selectedTournament || !selectedDay || selectedDay === 'stats') return
```

- [ ] **Step 3: Run existing page-hotkey + live-score tests**

Run: `npx jest page-hotkey useLiveScore`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "$(cat <<'EOF'
Handle selectedDay='stats' sentinel in page.tsx

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Full test run + manual smoke

- [ ] **Step 1: Full test suite**

Run: `npx jest`
Expected: all PASS, no skipped tests.

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Local dev smoke**

```bash
npm run dev
```

Open http://localhost:3000, pick SPRC, click the Matches tab, then tap the `📊` pill at the start of the day strip.

Verify:
- All 7 sections render with non-zero numbers.
- Tapping a date pill returns to the schedule for that day.
- Returning to `📊` shows the panel again instantly (memCache hit on the route).
- Server log shows `[stats-cache] wrote tournament=...` on the first cold load and no `[bat-fetch]` lines for the stats request.
- Toggling dark mode (Topbar) restyles the panel correctly.

- [ ] **Step 4: Verify zero BAT hits for SPRC**

```bash
grep '\[bat-fetch\]' /root/.pm2/logs/bat-bracket-out-*.log | tail -20
```

After tapping `📊`, the trailing log lines should NOT include any new `[bat-fetch]` entry tied to the stats request.

- [ ] **Step 5: Final commit (if any cleanup needed)**

```bash
git status
# If anything changed during smoke, commit:
git add -A
git commit -m "$(cat <<'EOF'
Smoke fixes for tournament stats

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Summary of expected commits

1. Add TournamentStats type definitions
2. Add tournament stats test fixtures
3. Aggregator: tournament KPIs
4. Aggregator: daily volume + top events
5. Aggregator: drama (marathon, closest, highest set, comebacks)
6. Aggregator: leaderboard, courts, champions, integrity
7. Stats disk cache with sourceVersion fingerprint
8. /api/stats route with cache-tier orchestration
9. i18n: tournament-stats strings (en + th)
10. TournamentStatsPanel component + styles
11. Render stats pill at start of day-tab strip
12. Handle selectedDay='stats' sentinel in page.tsx
13. (Optional) Smoke fixes

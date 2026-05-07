# Tournament Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-tournament stats panel reachable via a `📊` icon-only pill at the start of the day-tab strip, with zero new BAT hits for fully-past tournaments.

**Architecture:** A pure aggregator (`lib/tournamentStats.ts`) consumes already-cached `MatchesData` + `MatchScheduleGroup[]` + `playerId→club` map. A new `/api/stats` route orchestrates cache reads (`.cache/full/`, `.cache/days/`, in-memory tiers) and pins the aggregated result to `.cache/stats/<id>.json` only when the input full-cache is on disk. The existing `MatchSchedule` component renders a sentinel `'stats'` value on the day strip that swaps the schedule body for a new `TournamentStatsPanel`. Club data is fetched once via the existing `/api/clubs` route (cached in process memory after pre-warm).

**Tech Stack:** Next.js App Router, TypeScript, Jest + jsdom, cheerio (already in use). No new dependencies.

**Reference mockups:** `public/tournament-stats-mockup.html` (English) and `public/tournament-stats-mockup-th.html` (Thai). The component must match the section order and layout of these mockups.

---

## File Structure

| File | Status | Purpose |
|---|---|---|
| `lib/types.ts` | modify | Add `TournamentStats` and sub-shapes |
| `lib/tournamentStats.ts` | create | Pure aggregator with KPIs / drama / events / players / courts / medals / etc. |
| `lib/stats-cache.ts` | create | Read/write `.cache/stats/<id>.json` with sha256 fingerprint |
| `app/api/stats/route.ts` | create | Cache-aware orchestrator; calls `/api/clubs` internally for club map |
| `components/TournamentStatsPanel.tsx` | create | Render-only React component |
| `components/MatchSchedule.tsx` | modify | Render `📊` pill; swap body when `selectedDay === 'stats'` |
| `app/page.tsx` | modify | Allow `selectedDay === 'stats'` sentinel |
| `app/globals.css` | modify | `.match-schedule__day-tab--stats` rule + panel styles + mobile media queries |
| `lib/i18n.ts` | modify | New keys (~25) for stats labels (en + th) |
| `fixtures/stats-sprc-full.json` | create | SPRC `MatchesData` snapshot |
| `fixtures/stats-sprc-days.json` | create | SPRC per-day `Record<dateIso, groups[]>` |
| `fixtures/stats-sprc-clubs.json` | create | SPRC `Record<playerId, clubName>` |
| `fixtures/stats-empty.json` | create | All-zeros tournament fixture |
| `__tests__/tournamentStats.test.ts` | create | Aggregator unit tests |
| `__tests__/stats-cache.test.ts` | create | Disk cache round-trip + sha mismatch |
| `__tests__/api-stats-route.test.ts` | create | Route behavior with mocked I/O |
| `__tests__/TournamentStatsPanel.test.tsx` | create | Render + empty-state tests |

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
  events: number          // distinct draw labels
  matches: number
  decided: number
  walkovers: number
  retired: number
  nowPlaying: number
  players: number         // unique playerIds (>0 in any match)
  multiEventPlayers: number   // players appearing in 2+ distinct draw labels
  courtMinutes: number
  avgMatchMinutes: number
  threeSetterRate: number
}

export interface StatsDailyRow {
  date: string
  label: string
  total: number
  decided: number
  minutes: number
}

export interface StatsEventRow {
  name: string
  matches: number
  threeSetters: number
  walkovers: number
  decided: number
  avgMinutes: number
  winner: string[]      // empty if no Final yet
  winnerSeed?: string   // "[1]" if extracted from name
}

export interface StatsCourtTimePlayer {
  playerId: string
  name: string
  seed?: string
  minutes: number
  matches: number
  events: string[]      // sorted draw labels
}

export interface StatsDrama {
  marathon: StatsMatchRef | null
  highestSet: StatsSetRef | null
  comebackCount: number
  comebackHighlight: StatsMatchRef | null
  mostCourtTime: StatsCourtTimePlayer | null
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

export interface StatsClubMedal {
  club: string
  gold: number
  silver: number
  bronze: number
}

export interface StatsMultiGoldPlayer {
  playerId: string
  name: string
  seed?: string
  club: string
  events: string[]   // sorted draw labels
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
  events: StatsEventRow[]               // ALL events, sorted by discipline order
  drama: StatsDrama
  topPlayers: StatsTopPlayer[]
  courtUtilization: StatsCourt[]
  clubMedals: StatsClubMedal[]
  multiGoldPlayers: StatsMultiGoldPlayer[]
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
Expected: passes.

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

## Task 2: Capture SPRC fixtures

**Files:**
- Create: `fixtures/stats-sprc-full.json`
- Create: `fixtures/stats-sprc-days.json`
- Create: `fixtures/stats-sprc-clubs.json`
- Create: `fixtures/stats-empty.json`

- [ ] **Step 1: Capture full + per-day from production**

```bash
ssh root@ezebat.lan "curl -s 'http://localhost:3000/api/matches?tournament=4526a530-2091-4932-adab-b0a9b1fff98e'" \
  > fixtures/stats-sprc-full.json

mkdir -p /tmp/sprc-days
for d in 25690501 25690502 25690503 25690504 25690505 25690506; do
  ssh root@ezebat.lan "curl -s 'http://localhost:3000/api/matches?tournament=4526a530-2091-4932-adab-b0a9b1fff98e&date=$d'" > /tmp/sprc-days/$d.json
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

- [ ] **Step 2: Capture club map**

```bash
ssh root@ezebat.lan "curl -s 'http://localhost:3000/api/clubs?tournament=4526a530-2091-4932-adab-b0a9b1fff98e'" \
  > fixtures/stats-sprc-clubs.json
node -e 'const d=require("./fixtures/stats-sprc-clubs.json"); console.log("entries:", Object.keys(d).length)'
```

Expected: `entries: 1102`.

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
git add fixtures/stats-sprc-full.json fixtures/stats-sprc-days.json fixtures/stats-sprc-clubs.json fixtures/stats-empty.json
git commit -m "$(cat <<'EOF'
Add tournament stats test fixtures (SPRC + empty)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Aggregator — module skeleton + KPIs

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

const FIX = path.join(__dirname, '..', 'fixtures')

function loadSprc() {
  const data = JSON.parse(fs.readFileSync(path.join(FIX, 'stats-sprc-full.json'), 'utf8')) as MatchesData
  const daysObj = JSON.parse(fs.readFileSync(path.join(FIX, 'stats-sprc-days.json'), 'utf8')) as Record<string, MatchScheduleGroup[]>
  const days = new Map(Object.entries(daysObj))
  const clubs = JSON.parse(fs.readFileSync(path.join(FIX, 'stats-sprc-clubs.json'), 'utf8')) as Record<string, string>
  return { data, days, clubs }
}

describe('tournamentStats — KPIs', () => {
  it('reports SPRC headline numbers', () => {
    const { data, days, clubs } = loadSprc()
    const stats = aggregate(data, days, clubs)
    expect(stats.kpis.events).toBe(33)
    expect(stats.kpis.matches).toBe(1384)
    expect(stats.kpis.decided).toBe(1343)
    expect(stats.kpis.walkovers).toBe(41)
    expect(stats.kpis.players).toBe(1102)
    expect(stats.kpis.multiEventPlayers).toBe(839)
    expect(stats.kpis.courtMinutes).toBe(39046)
    expect(Math.round(stats.kpis.avgMatchMinutes)).toBe(29)
    expect(Math.round(stats.kpis.threeSetterRate * 100)).toBe(14)
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest tournamentStats`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement aggregator with KPIs only**

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
    events: 0, matches: 0, decided: 0, walkovers: 0, retired: 0, nowPlaying: 0,
    players: 0, multiEventPlayers: 0, courtMinutes: 0, avgMatchMinutes: 0,
    threeSetterRate: 0,
  },
  dailyVolume: [],
  events: [],
  drama: { marathon: null, highestSet: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null },
  topPlayers: [],
  courtUtilization: [],
  clubMedals: [],
  multiGoldPlayers: [],
  integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
}

export function parseDurationMinutes(raw: string | undefined): number {
  if (!raw) return 0
  const m = raw.trim().match(/^(?:(\d+)h\s*)?(?:(\d+)m)?$/)
  if (!m) return 0
  return parseInt(m[1] ?? '0', 10) * 60 + parseInt(m[2] ?? '0', 10)
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
  const events = new Set<string>()
  const playerEvents = new Map<string, Set<string>>()

  for (const { match, durationMinutes } of ctxs) {
    matches++
    if (match.draw) events.add(match.draw)
    if (match.walkover) walkovers++
    if (match.retired) retired++
    if (match.nowPlaying) nowPlaying++
    if (match.winner !== null && !match.walkover) {
      decided++
      if (match.scores.length >= 3) threeSetterDecided++
    }
    courtMinutes += durationMinutes
    if (durationMinutes > 0) {
      durationCount++
      durationSum += durationMinutes
    }
    for (const p of [...match.team1, ...match.team2]) {
      if (!p.playerId) continue
      players.add(p.playerId)
      if (match.draw) {
        const set = playerEvents.get(p.playerId) ?? new Set<string>()
        set.add(match.draw)
        playerEvents.set(p.playerId, set)
      }
    }
  }

  let multiEventPlayers = 0
  for (const set of playerEvents.values()) if (set.size >= 2) multiEventPlayers++

  return {
    events: events.size,
    matches,
    decided,
    walkovers,
    retired,
    nowPlaying,
    players: players.size,
    multiEventPlayers,
    courtMinutes,
    avgMatchMinutes: durationCount === 0 ? 0 : durationSum / durationCount,
    threeSetterRate: decided === 0 ? 0 : threeSetterDecided / decided,
  }
}

export function aggregate(
  data: MatchesData,
  dayGroupsByDate: Map<string, MatchScheduleGroup[]>,
  clubs: Record<string, string>,
): ComputedStats {
  const ctxs: MatchCtx[] = [...iterateMatches(data, dayGroupsByDate)]
  if (ctxs.length === 0) return { ...EMPTY }
  return {
    ...EMPTY,
    kpis: buildKpis(ctxs),
  }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npx jest tournamentStats`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tournamentStats.ts __tests__/tournamentStats.test.ts
git commit -m "Aggregator: KPIs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Aggregator — daily volume

**Files:**
- Modify: `lib/tournamentStats.ts`
- Modify: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Append failing test**

```ts
describe('tournamentStats — daily volume', () => {
  it('one row per day with counts and minutes', () => {
    const { data, days, clubs } = loadSprc()
    const stats = aggregate(data, days, clubs)
    expect(stats.dailyVolume.map((d) => d.date)).toEqual([
      '2026-05-01','2026-05-02','2026-05-03','2026-05-04','2026-05-05','2026-05-06',
    ])
    expect(stats.dailyVolume[0].total).toBe(397)
    expect(stats.dailyVolume[0].minutes).toBe(9608)
    expect(stats.dailyVolume[5].total).toBe(33)
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest tournamentStats -t 'daily volume'`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `lib/tournamentStats.ts`:

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
```

Wire into `aggregate`:

```ts
return {
  ...EMPTY,
  kpis: buildKpis(ctxs),
  dailyVolume: buildDailyVolume(data, ctxs),
}
```

- [ ] **Step 4: PASS, commit**

Run: `npx jest tournamentStats`
Expected: PASS.

```bash
git add lib/tournamentStats.ts __tests__/tournamentStats.test.ts
git commit -m "Aggregator: daily volume

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Aggregator — events (custom sort + winner)

**Files:**
- Modify: `lib/tournamentStats.ts`
- Modify: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('tournamentStats — events', () => {
  it('returns all 33 SPRC events in custom discipline order', () => {
    const { data, days, clubs } = loadSprc()
    const stats = aggregate(data, days, clubs)
    expect(stats.events.length).toBe(33)
    expect(stats.events.slice(0, 5).map((e) => e.name)).toEqual(['MS', 'WS', 'MD', 'WD', 'XD'])
    expect(stats.events.slice(5, 10).map((e) => e.name)).toEqual(['BS U19', 'GS U19', 'BD U19', 'GD U19', 'XD U19'])
    expect(stats.events[stats.events.length - 1].name).toMatch(/U9/)
  })

  it('annotates each event with winner names from its Final', () => {
    const { data, days, clubs } = loadSprc()
    const stats = aggregate(data, days, clubs)
    const bs15 = stats.events.find((e) => e.name === 'BS U15')!
    expect(bs15.matches).toBe(111)
    expect(bs15.winner.length).toBe(1)
    expect(bs15.winner[0]).toContain('จิรภัทร')
    const md = stats.events.find((e) => e.name === 'MD')!
    expect(md.winner.length).toBe(2)
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest tournamentStats -t 'events'`

- [ ] **Step 3: Implement**

Add to `lib/tournamentStats.ts`:

```ts
import { longRoundL } from './i18n'

const OPEN_ORDER = ['MS', 'WS', 'MD', 'WD', 'XD'] as const
const DISCIPLINES = ['BS', 'GS', 'BD', 'GD', 'XD'] as const
const AGE_BANDS = [19, 17, 15, 13, 11, 9] as const

const EVENT_RANK = (() => {
  const order: string[] = [...OPEN_ORDER]
  for (const age of AGE_BANDS) for (const d of DISCIPLINES) order.push(`${d} U${age}`)
  const map = new Map<string, number>()
  order.forEach((name, i) => map.set(name, i))
  return map
})()

function eventRank(name: string): number {
  return EVENT_RANK.get(name) ?? 999
}

function isFinal(round: string): boolean {
  return longRoundL(round, 'en') === 'Final'
}

function teamNames(team: MatchEntry['team1']): string[] {
  return team.map((p) => p.name)
}

function buildEvents(ctxs: MatchCtx[]): ComputedStats['events'] {
  interface Acc {
    matches: number; threeSetters: number; walkovers: number; decided: number;
    durSum: number; durCount: number;
    lastFinal: MatchEntry | null;
  }
  const byEvent = new Map<string, Acc>()
  for (const { match } of ctxs) {
    if (!match.draw) continue
    const a = byEvent.get(match.draw) ?? {
      matches: 0, threeSetters: 0, walkovers: 0, decided: 0,
      durSum: 0, durCount: 0, lastFinal: null,
    }
    a.matches++
    if (match.walkover) a.walkovers++
    if (match.winner !== null && !match.walkover) {
      a.decided++
      if (match.scores.length >= 3) a.threeSetters++
    }
    const d = parseDurationMinutes(match.duration)
    if (d > 0) { a.durSum += d; a.durCount++ }
    if (match.winner !== null && !match.walkover && isFinal(match.round)) {
      a.lastFinal = match
    }
    byEvent.set(match.draw, a)
  }
  const rows = [...byEvent.entries()].map(([name, a]): ComputedStats['events'][number] => {
    const winner = a.lastFinal
      ? teamNames(a.lastFinal.winner === 1 ? a.lastFinal.team1 : a.lastFinal.team2)
      : []
    return {
      name,
      matches: a.matches,
      threeSetters: a.threeSetters,
      walkovers: a.walkovers,
      decided: a.decided,
      avgMinutes: a.durCount === 0 ? 0 : a.durSum / a.durCount,
      winner,
    }
  })
  rows.sort((a, b) => eventRank(a.name) - eventRank(b.name) || (a.name < b.name ? -1 : 1))
  return rows
}
```

Wire in:

```ts
return {
  ...EMPTY,
  kpis: buildKpis(ctxs),
  dailyVolume: buildDailyVolume(data, ctxs),
  events: buildEvents(ctxs),
}
```

- [ ] **Step 4: PASS, commit**

```bash
git add lib/tournamentStats.ts __tests__/tournamentStats.test.ts
git commit -m "Aggregator: events with custom sort + winners

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Aggregator — drama (marathon, highest set, comebacks, most court time)

**Files:**
- Modify: `lib/tournamentStats.ts`
- Modify: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('tournamentStats — drama', () => {
  it('finds the marathon match', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.drama.marathon).not.toBeNull()
    expect(s.drama.marathon!.draw).toBe('GD U19')
    expect(s.drama.marathon!.durationMinutes).toBe(129)
  })
  it('finds a 28-26 highest set', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.drama.highestSet).not.toBeNull()
    const set = s.drama.highestSet!.scores[s.drama.highestSet!.setIndex]
    expect(set.t1 + set.t2).toBe(54)
  })
  it('counts 102 comebacks', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.drama.comebackCount).toBe(102)
  })
  it('finds most-court-time player', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.drama.mostCourtTime).not.toBeNull()
    expect(s.drama.mostCourtTime!.name).toContain('พิมพ์ชนก')
    expect(s.drama.mostCourtTime!.minutes).toBe(7 * 60 + 33)
    expect(s.drama.mostCourtTime!.events.sort()).toEqual(['GD U19', 'GS U19'])
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```ts
import type { StatsMatchRef, StatsSetRef, StatsCourtTimePlayer } from './types'

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

function isComeback(m: MatchEntry): boolean {
  if (m.winner === null || m.scores.length < 2) return false
  const s0 = m.scores[0]
  return m.winner === 1 ? s0.t1 < s0.t2 : s0.t2 < s0.t1
}

function roundRank(round: string): number {
  const long = longRoundL(round, 'en')
  if (long === 'Final') return 0
  if (long === 'Semi Final') return 1
  if (long === 'Quarter Final') return 2
  return 3
}

const SEED_RE = /^(.*?)\s*(\[\d+\])\s*$/

function extractSeed(name: string): { plain: string; seed?: string } {
  const m = name.match(SEED_RE)
  return m ? { plain: m[1].trim(), seed: m[2] } : { plain: name }
}

function buildDrama(ctxs: MatchCtx[]): ComputedStats['drama'] {
  let marathon: { ref: StatsMatchRef; minutes: number } | null = null
  let highestSet: { ref: StatsSetRef; total: number } | null = null
  let comebackCount = 0
  let comebackBest: { ref: StatsMatchRef; rank: number } | null = null
  const courtTime = new Map<string, { name: string; minutes: number; matches: number; events: Set<string> }>()

  for (const { match, durationMinutes } of ctxs) {
    if (match.winner === null || match.walkover) continue
    if (durationMinutes > 0) {
      if (!marathon || durationMinutes > marathon.minutes) {
        marathon = { ref: toMatchRef(match, durationMinutes)!, minutes: durationMinutes }
      }
    }
    for (let si = 0; si < match.scores.length; si++) {
      const s = match.scores[si]
      const total = s.t1 + s.t2
      if (!highestSet || total > highestSet.total) {
        highestSet = { ref: { ...toMatchRef(match, durationMinutes)!, setIndex: si }, total }
      }
    }
    if (isComeback(match)) {
      comebackCount++
      const rank = roundRank(match.round)
      if (!comebackBest || rank < comebackBest.rank) {
        comebackBest = { ref: toMatchRef(match, durationMinutes)!, rank }
      }
    }
    if (durationMinutes > 0) {
      for (const p of [...match.team1, ...match.team2]) {
        if (!p.playerId) continue
        const r = courtTime.get(p.playerId) ?? { name: p.name, minutes: 0, matches: 0, events: new Set<string>() }
        r.minutes += durationMinutes
        r.matches++
        if (match.draw) r.events.add(match.draw)
        courtTime.set(p.playerId, r)
      }
    }
  }

  let mostCourtTime: StatsCourtTimePlayer | null = null
  for (const [playerId, r] of courtTime) {
    if (!mostCourtTime || r.minutes > mostCourtTime.minutes) {
      const { plain, seed } = extractSeed(r.name)
      mostCourtTime = {
        playerId, name: plain, seed,
        minutes: r.minutes, matches: r.matches,
        events: [...r.events].sort(),
      }
    }
  }

  return {
    marathon: marathon ? marathon.ref : null,
    highestSet: highestSet ? highestSet.ref : null,
    comebackCount,
    comebackHighlight: comebackBest ? comebackBest.ref : null,
    mostCourtTime,
  }
}
```

Wire into `aggregate`:

```ts
return {
  ...EMPTY,
  kpis: buildKpis(ctxs),
  dailyVolume: buildDailyVolume(data, ctxs),
  events: buildEvents(ctxs),
  drama: buildDrama(ctxs),
}
```

- [ ] **Step 4: PASS, commit**

```bash
git add lib/tournamentStats.ts __tests__/tournamentStats.test.ts
git commit -m "Aggregator: drama (marathon, highest set, comebacks, most court time)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Aggregator — top players + court utilization + integrity

**Files:**
- Modify: `lib/tournamentStats.ts`
- Modify: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('tournamentStats — top players', () => {
  it('top player has 11 wins', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.topPlayers[0].wins).toBe(11)
    expect(s.topPlayers[0].losses).toBe(1)
    expect(s.topPlayers.length).toBeLessThanOrEqual(12)
  })
})

describe('tournamentStats — courts + integrity', () => {
  it('court utilization sorted by minutes desc, capped at 14', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.courtUtilization.length).toBeLessThanOrEqual(14)
    for (let i = 1; i < s.courtUtilization.length; i++) {
      expect(s.courtUtilization[i - 1].minutes).toBeGreaterThanOrEqual(s.courtUtilization[i].minutes)
    }
  })
  it('flags WS as the highest walkover-rate event', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.integrity.walkoverByEvent[0].event).toBe('WS')
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```ts
function buildTopPlayers(ctxs: MatchCtx[]): ComputedStats['topPlayers'] {
  interface Rec { name: string; wins: number; losses: number }
  const tally = new Map<string, Rec>()
  for (const { match } of ctxs) {
    if (match.winner === null || match.walkover) continue
    const winSide = match.winner
    for (const p of match.team1) {
      if (!p.playerId) continue
      const r = tally.get(p.playerId) ?? { name: p.name, wins: 0, losses: 0 }
      if (winSide === 1) r.wins++; else r.losses++
      tally.set(p.playerId, r)
    }
    for (const p of match.team2) {
      if (!p.playerId) continue
      const r = tally.get(p.playerId) ?? { name: p.name, wins: 0, losses: 0 }
      if (winSide === 2) r.wins++; else r.losses++
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
  const by = new Map<string, { matches: number; minutes: number }>()
  for (const { match, durationMinutes } of ctxs) {
    if (!match.court) continue
    const a = by.get(match.court) ?? { matches: 0, minutes: 0 }
    a.matches++
    a.minutes += durationMinutes
    by.set(match.court, a)
  }
  const rows = [...by.entries()].map(([name, a]) => ({ name, ...a }))
  rows.sort((a, b) => b.minutes - a.minutes || b.matches - a.matches)
  return rows.slice(0, 14)
}

function buildIntegrity(ctxs: MatchCtx[]): ComputedStats['integrity'] {
  interface EvAcc { total: number; walkovers: number; threeSetters: number; decided: number }
  const by = new Map<string, EvAcc>()
  for (const { match } of ctxs) {
    if (!match.draw) continue
    const a = by.get(match.draw) ?? { total: 0, walkovers: 0, threeSetters: 0, decided: 0 }
    a.total++
    if (match.walkover) a.walkovers++
    if (match.winner !== null && !match.walkover) {
      a.decided++
      if (match.scores.length >= 3) a.threeSetters++
    }
    by.set(match.draw, a)
  }
  const wo: ComputedStats['integrity']['walkoverByEvent'] = []
  const three: ComputedStats['integrity']['threeSetterByEvent'] = []
  for (const [event, a] of by) {
    if (a.walkovers > 0) wo.push({ event, walkovers: a.walkovers, rate: a.walkovers / a.total })
    if (a.decided >= 10) three.push({ event, rate: a.threeSetters / a.decided, sample: a.decided })
  }
  wo.sort((a, b) => b.rate - a.rate || b.walkovers - a.walkovers)
  three.sort((a, b) => b.rate - a.rate || b.sample - a.sample)
  return { walkoverByEvent: wo.slice(0, 8), threeSetterByEvent: three.slice(0, 8) }
}
```

Wire into `aggregate`:

```ts
return {
  ...EMPTY,
  kpis: buildKpis(ctxs),
  dailyVolume: buildDailyVolume(data, ctxs),
  events: buildEvents(ctxs),
  drama: buildDrama(ctxs),
  topPlayers: buildTopPlayers(ctxs),
  courtUtilization: buildCourtUtilization(ctxs),
  integrity: buildIntegrity(ctxs),
}
```

- [ ] **Step 4: PASS, commit**

```bash
git add lib/tournamentStats.ts __tests__/tournamentStats.test.ts
git commit -m "Aggregator: top players + court utilization + integrity

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Aggregator — club medals + multi-gold players

**Files:**
- Modify: `lib/tournamentStats.ts`
- Modify: `__tests__/tournamentStats.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('tournamentStats — medals', () => {
  it('top club has 27 golds', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.clubMedals[0].club).toBe('บ้านทองหยอด')
    expect(s.clubMedals[0].gold).toBe(27)
    expect(s.clubMedals[0].silver).toBe(19)
    expect(s.clubMedals[0].bronze).toBe(24)
    expect(s.clubMedals.length).toBeLessThanOrEqual(10)
  })

  it('finds 7 multi-gold players', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.multiGoldPlayers.length).toBe(7)
    for (const p of s.multiGoldPlayers) expect(p.events.length).toBeGreaterThanOrEqual(2)
  })
})

describe('tournamentStats — empty', () => {
  it('zero matches → all empty arrays', () => {
    const empty = JSON.parse(fs.readFileSync(path.join(FIX, 'stats-empty.json'), 'utf8')) as MatchesData
    const s = aggregate(empty, new Map(), {})
    expect(s.kpis.matches).toBe(0)
    expect(s.events).toEqual([])
    expect(s.clubMedals).toEqual([])
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement medals + multi-gold**

```ts
function isSemiFinal(round: string): boolean {
  return longRoundL(round, 'en') === 'Semi Final'
}

function buildClubMedalsAndMultiGold(
  ctxs: MatchCtx[],
  clubs: Record<string, string>,
): { clubMedals: ComputedStats['clubMedals']; multiGoldPlayers: ComputedStats['multiGoldPlayers'] } {
  const lastFinalByDraw = new Map<string, MatchEntry>()
  const semiLosersByDraw = new Map<string, MatchEntry[]>()

  for (const { match } of ctxs) {
    if (match.winner === null || match.walkover) continue
    if (!match.draw) continue
    if (isFinal(match.round)) {
      lastFinalByDraw.set(match.draw, match)
    } else if (isSemiFinal(match.round)) {
      const arr = semiLosersByDraw.get(match.draw) ?? []
      arr.push(match)
      semiLosersByDraw.set(match.draw, arr)
    }
  }

  const medals = new Map<string, { gold: number; silver: number; bronze: number }>()
  const goldsByPlayer = new Map<string, { name: string; events: string[] }>()

  const credit = (club: string, kind: 'gold' | 'silver' | 'bronze') => {
    const r = medals.get(club) ?? { gold: 0, silver: 0, bronze: 0 }
    r[kind]++
    medals.set(club, r)
  }
  const clubOf = (pid: string) => (clubs[pid] ?? '').trim() || '—'

  for (const [draw, m] of lastFinalByDraw) {
    const win = m.winner === 1 ? m.team1 : m.team2
    const lose = m.winner === 1 ? m.team2 : m.team1
    for (const p of win) {
      if (!p.playerId) continue
      credit(clubOf(p.playerId), 'gold')
      const g = goldsByPlayer.get(p.playerId) ?? { name: p.name, events: [] }
      g.events.push(draw)
      goldsByPlayer.set(p.playerId, g)
    }
    for (const p of lose) if (p.playerId) credit(clubOf(p.playerId), 'silver')
  }
  for (const semis of semiLosersByDraw.values()) {
    for (const m of semis) {
      const lose = m.winner === 1 ? m.team2 : m.team1
      for (const p of lose) if (p.playerId) credit(clubOf(p.playerId), 'bronze')
    }
  }

  const clubMedals: ComputedStats['clubMedals'] = [...medals.entries()]
    .map(([club, r]) => ({ club, ...r }))
    .filter((r) => r.club !== '—')
    .sort((a, b) =>
      b.gold - a.gold ||
      b.silver - a.silver ||
      b.bronze - a.bronze ||
      (a.club < b.club ? -1 : 1),
    )
    .slice(0, 10)

  const multiGoldPlayers: ComputedStats['multiGoldPlayers'] = [...goldsByPlayer.entries()]
    .filter(([, r]) => r.events.length >= 2)
    .map(([playerId, r]) => {
      const { plain, seed } = extractSeed(r.name)
      return {
        playerId,
        name: plain,
        seed,
        club: clubOf(playerId),
        events: r.events.slice().sort(),
      }
    })
    .sort((a, b) => b.events.length - a.events.length || (a.name < b.name ? -1 : 1))

  return { clubMedals, multiGoldPlayers }
}
```

Wire into `aggregate`:

```ts
const { clubMedals, multiGoldPlayers } = buildClubMedalsAndMultiGold(ctxs, clubs)
return {
  ...EMPTY,
  kpis: buildKpis(ctxs),
  dailyVolume: buildDailyVolume(data, ctxs),
  events: buildEvents(ctxs),
  drama: buildDrama(ctxs),
  topPlayers: buildTopPlayers(ctxs),
  courtUtilization: buildCourtUtilization(ctxs),
  clubMedals,
  multiGoldPlayers,
  integrity: buildIntegrity(ctxs),
}
```

- [ ] **Step 4: PASS, commit**

```bash
git add lib/tournamentStats.ts __tests__/tournamentStats.test.ts
git commit -m "Aggregator: club medals + multi-gold players + empty fixture test

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Stats disk cache

**Files:**
- Create: `lib/stats-cache.ts`
- Create: `__tests__/stats-cache.test.ts`

- [ ] **Step 1: Write failing tests**

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

  const sample = (): TournamentStats => ({
    tournamentId: 'abc', generatedAt: 'X',
    coverage: { daysOnDisk: 1, daysFromMemory: 0, daysFromBat: 0, totalDays: 1 },
    kpis: { events: 0, matches: 0, decided: 0, walkovers: 0, retired: 0, nowPlaying: 0,
      players: 0, multiEventPlayers: 0, courtMinutes: 0, avgMatchMinutes: 0, threeSetterRate: 0 },
    dailyVolume: [], events: [],
    drama: { marathon: null, highestSet: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null },
    topPlayers: [], courtUtilization: [], clubMedals: [], multiGoldPlayers: [],
    integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
  })

  it('returns null when file missing', async () => {
    expect(await readStatsCache('abc')).toBeNull()
  })
  it('round-trips write+read', async () => {
    await writeStatsCache('abc', { sourceVersion: 'full:xyz', stats: sample() })
    const got = await readStatsCache('abc')
    expect(got!.sourceVersion).toBe('full:xyz')
    expect(got!.stats.tournamentId).toBe('abc')
  })
  it('hashFullCacheBytes is stable sha256', () => {
    const a = hashFullCacheBytes(Buffer.from('hello'))
    const b = hashFullCacheBytes(Buffer.from('hello'))
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

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

- [ ] **Step 4: PASS, commit**

```bash
git add lib/stats-cache.ts __tests__/stats-cache.test.ts
git commit -m "Stats disk cache with sha256 fingerprint

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: `/api/stats` route

**Files:**
- Create: `app/api/stats/route.ts`
- Create: `__tests__/api-stats-route.test.ts`

- [ ] **Step 1: Write failing tests with mocked I/O**

```ts
import { GET } from '@/app/api/stats/route'

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: { ...jest.requireActual('fs').promises, readFile: jest.fn() },
}))
jest.mock('@/lib/stats-cache', () => ({
  readStatsCache: jest.fn(), writeStatsCache: jest.fn(), hashFullCacheBytes: jest.fn(() => 'sha-fixed'),
}))
jest.mock('@/lib/day-cache', () => ({ readFullCache: jest.fn(), readDayCache: jest.fn() }))

import { promises as fs } from 'fs'
import { readStatsCache, writeStatsCache } from '@/lib/stats-cache'
import { readFullCache, readDayCache } from '@/lib/day-cache'
import path from 'path'

const SPRC = '4526a530-2091-4932-adab-b0a9b1fff98e'

const real = jest.requireActual('fs') as typeof import('fs')
const loadFull = () => JSON.parse(real.readFileSync(path.join(__dirname, '..', 'fixtures', 'stats-sprc-full.json'), 'utf8'))
const loadDays = () => JSON.parse(real.readFileSync(path.join(__dirname, '..', 'fixtures', 'stats-sprc-days.json'), 'utf8'))
const loadClubs = () => JSON.parse(real.readFileSync(path.join(__dirname, '..', 'fixtures', 'stats-sprc-clubs.json'), 'utf8'))

const req = (qs = `?tournament=${SPRC}`) => new Request(`http://localhost/api/stats${qs}`)

describe('GET /api/stats', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => loadClubs(),
    }) as unknown as typeof fetch
  })

  it('returns 400 when missing tournament param', async () => {
    const res = await GET(req(''))
    expect(res.status).toBe(400)
  })

  it('serves from disk cache when sourceVersion matches', async () => {
    ;(readFullCache as jest.Mock).mockResolvedValue(loadFull())
    ;(fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('any'))
    ;(readStatsCache as jest.Mock).mockResolvedValue({
      version: 1, sourceVersion: 'full:sha-fixed',
      stats: { tournamentId: SPRC, generatedAt: 'X', coverage: {}, kpis: { matches: 999 } },
    })
    const res = await GET(req())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.kpis.matches).toBe(999)
    expect(writeStatsCache).not.toHaveBeenCalled()
  })

  it('aggregates and pins to disk on first miss', async () => {
    ;(readFullCache as jest.Mock).mockResolvedValue(loadFull())
    ;(fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('full-bytes'))
    ;(readStatsCache as jest.Mock).mockResolvedValue(null)
    ;(readDayCache as jest.Mock).mockImplementation(async (_id: string, dateIso: string) => {
      const d = loadDays()
      return d[dateIso] ? { groups: d[dateIso] } : null
    })
    const res = await GET(req())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.kpis.matches).toBe(1384)
    expect(json.kpis.events).toBe(33)
    expect(writeStatsCache).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

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

async function fetchClubs(origin: string, tournamentId: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${origin}/api/clubs?tournament=${encodeURIComponent(tournamentId)}`)
    if (!res.ok) return {}
    return (await res.json()) as Record<string, string>
  } catch {
    return {}
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
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

    if (fullData && fullBytes) {
      const sv = `full:${hashFullCacheBytes(fullBytes)}`
      const cached = await readStatsCache(tournamentId)
      if (cached && cached.sourceVersion === sv) {
        memCache.set(tournamentId, { data: cached.stats, ts: Date.now() })
        return NextResponse.json(cached.stats)
      }
      const dayMap = await assembleDayMap(tournamentId, fullData)
      const clubs = await fetchClubs(origin, tournamentId)
      const stats = aggregate(fullData, dayMap.groups, clubs)
      const full: TournamentStats = {
        tournamentId,
        generatedAt: new Date().toISOString(),
        coverage: { daysOnDisk: dayMap.daysOnDisk, daysFromMemory: 0, daysFromBat: 0, totalDays: fullData.days.length },
        ...stats,
      }
      await writeStatsCache(tournamentId, { sourceVersion: sv, stats: full })
      memCache.set(tournamentId, { data: full, ts: Date.now() })
      return NextResponse.json(full)
    }

    // Mid-tournament: full cache not pinned. Fall back to whatever is cached.
    if (!fullData) {
      const empty: TournamentStats = emptyStats(tournamentId)
      memCache.set(tournamentId, { data: empty, ts: Date.now() })
      return NextResponse.json(empty)
    }
    const dayMap = await assembleDayMap(tournamentId, fullData)
    const clubs = await fetchClubs(origin, tournamentId)
    const stats = aggregate(fullData, dayMap.groups, clubs)
    const full: TournamentStats = {
      tournamentId,
      generatedAt: new Date().toISOString(),
      coverage: { daysOnDisk: dayMap.daysOnDisk, daysFromMemory: 0, daysFromBat: 0, totalDays: fullData.days.length },
      ...stats,
    }
    memCache.set(tournamentId, { data: full, ts: Date.now() })
    return NextResponse.json(full)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: `Could not load stats: ${message}` }, { status: 502 })
  }
}

async function assembleDayMap(
  tournamentId: string,
  fullData: MatchesData,
): Promise<{ groups: Map<string, MatchScheduleGroup[]>; daysOnDisk: number }> {
  const groups = new Map<string, MatchScheduleGroup[]>()
  let daysOnDisk = 0
  await Promise.all(
    fullData.days.map(async (d) => {
      if (!d.dateIso) return
      const cached = await readDayCache(tournamentId, d.dateIso)
      if (cached) {
        groups.set(d.dateIso, cached.groups)
        daysOnDisk++
      }
    }),
  )
  if (groups.size === 0 && fullData.currentDate) {
    const today = fullData.days.find((d) => d.date === fullData.currentDate)?.dateIso
    if (today) groups.set(today, fullData.groups)
  }
  return { groups, daysOnDisk }
}

function emptyStats(tournamentId: string): TournamentStats {
  return {
    tournamentId, generatedAt: new Date().toISOString(),
    coverage: { daysOnDisk: 0, daysFromMemory: 0, daysFromBat: 0, totalDays: 0 },
    kpis: { events: 0, matches: 0, decided: 0, walkovers: 0, retired: 0, nowPlaying: 0,
      players: 0, multiEventPlayers: 0, courtMinutes: 0, avgMatchMinutes: 0, threeSetterRate: 0 },
    dailyVolume: [], events: [],
    drama: { marathon: null, highestSet: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null },
    topPlayers: [], courtUtilization: [], clubMedals: [], multiGoldPlayers: [],
    integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
  }
}
```

- [ ] **Step 4: PASS, commit**

```bash
git add app/api/stats/route.ts __tests__/api-stats-route.test.ts
git commit -m "/api/stats route with cache-tier orchestration + clubs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: i18n strings (en + th)

**Files:**
- Modify: `lib/i18n.ts`

- [ ] **Step 1: Add 25 new keys to the `Strings` union**

In `lib/i18n.ts`, find the `Strings` union and append:

```
  | 'tournamentStats'
  | 'statsKpiEvents'
  | 'statsKpiMatches'
  | 'statsKpiPlayers'
  | 'statsKpiCourtTime'
  | 'statsKpiAvgMatch'
  | 'statsKpiThreeSetters'
  | 'statsSectionMatchesPerDay'
  | 'statsSectionEvents'
  | 'statsSectionDrama'
  | 'statsSectionTopPlayers'
  | 'statsSectionCourtUtilization'
  | 'statsSectionClubMedals'
  | 'statsSectionMultiGold'
  | 'statsSectionIntegrity'
  | 'statsMarathonBadge'
  | 'statsHighestSetBadge'
  | 'statsComebacksBadge'
  | 'statsMostCourtTimeBadge'
  | 'statsCol3Set'
  | 'statsColAvg'
  | 'statsColMatches'
  | 'statsColWinner'
  | 'statsEmptyState'
  | 'statsLoadFailed'
```

- [ ] **Step 2: Add English values**

In the `en` block:

```ts
tournamentStats: 'Tournament stats',
statsKpiEvents: 'Events',
statsKpiMatches: 'Matches',
statsKpiPlayers: 'Players · multi-event',
statsKpiCourtTime: 'Court time',
statsKpiAvgMatch: 'Avg match',
statsKpiThreeSetters: '3-setters',
statsSectionMatchesPerDay: 'Matches per day / court time',
statsSectionEvents: 'Events',
statsSectionDrama: 'Match drama',
statsSectionTopPlayers: 'Top players (by tournament wins)',
statsSectionCourtUtilization: 'Court utilization',
statsSectionClubMedals: 'Top clubs by medals',
statsSectionMultiGold: 'Players with multiple gold medals',
statsSectionIntegrity: 'Quality & integrity',
statsMarathonBadge: 'Marathon',
statsHighestSetBadge: 'Highest-scoring set',
statsComebacksBadge: 'Comeback wins',
statsMostCourtTimeBadge: 'Most court time',
statsCol3Set: '3-set',
statsColAvg: 'Avg',
statsColMatches: 'Matches',
statsColWinner: 'Winner(s)',
statsEmptyState: 'Early days — check back when more matches are decided.',
statsLoadFailed: 'Could not load stats. Try again.',
```

- [ ] **Step 3: Add Thai values**

In the `th` block:

```ts
tournamentStats: 'สถิติการแข่งขัน',
statsKpiEvents: 'รายการ',
statsKpiMatches: 'แมตช์ทั้งหมด',
statsKpiPlayers: 'ผู้เล่น · หลายรายการ',
statsKpiCourtTime: 'เวลาสนามรวม',
statsKpiAvgMatch: 'แมตช์เฉลี่ย',
statsKpiThreeSetters: '3 เกม',
statsSectionMatchesPerDay: 'แมตช์ต่อวัน / เวลาสนาม',
statsSectionEvents: 'รายการ',
statsSectionDrama: 'แมตช์น่าจดจำ',
statsSectionTopPlayers: 'ผู้เล่นยอดเยี่ยม (ตามชัยชนะในรายการนี้)',
statsSectionCourtUtilization: 'การใช้งานสนาม',
statsSectionClubMedals: 'สโมสรยอดเยี่ยม (เรียงตามเหรียญรางวัล)',
statsSectionMultiGold: 'ผู้เล่นที่ได้เหรียญทองหลายเหรียญ',
statsSectionIntegrity: 'คุณภาพการแข่ง',
statsMarathonBadge: 'แมตช์มาราธอน',
statsHighestSetBadge: 'เกมคะแนนสูงสุด',
statsComebacksBadge: 'ชนะแบบพลิกกลับ',
statsMostCourtTimeBadge: 'ใช้สนามมากที่สุด',
statsCol3Set: '3 เกม',
statsColAvg: 'เฉลี่ย',
statsColMatches: 'แมตช์',
statsColWinner: 'ผู้ชนะ',
statsEmptyState: 'ยังเร็วเกินไป — กลับมาดูอีกครั้งหลังจากการแข่งดำเนินไปมากขึ้น',
statsLoadFailed: 'ไม่สามารถโหลดสถิติได้ กรุณาลองใหม่',
```

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit
git add lib/i18n.ts
git commit -m "i18n: tournament-stats strings (en + th)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: TournamentStatsPanel component

**Files:**
- Create: `components/TournamentStatsPanel.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Create the component**

Create `components/TournamentStatsPanel.tsx` matching the section order in `public/tournament-stats-mockup.html` exactly:

1. Hero KPIs (6: Events, Matches, Players · multi-event, Court time, Avg match, 3-setters)
2. Matches per day / court time bars
3. Match drama (4 cards: Marathon, Highest set, Comebacks, Most court time)
4. Events table (33 rows in custom order)
5. Top players + Court utilization (grid-2)
6. Top clubs by medals (table with 🥇🥈🥉)
7. Players with multiple gold medals (table)
8. Integrity & quality

Skeleton:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import type { TournamentStats } from '@/lib/types'

interface Props { tournamentId: string }

const fmt = (n: number) => n.toLocaleString('en-US')
const hours = (m: number) => `${Math.round(m / 60)}h`
const pct = (r: number) => `${Math.round(r * 100)}%`
const minStr = (m: number) => `${Math.round(m)} min`

export default function TournamentStatsPanel({ tournamentId }: Props) {
  const { t } = useLanguage()
  const [stats, setStats] = useState<TournamentStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
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
  if (stats.kpis.matches === 0) return <div className="stats-empty">{t('statsEmptyState')}</div>

  const dayMax = Math.max(1, ...stats.dailyVolume.map((d) => d.total))
  const courtMax = Math.max(1, ...stats.courtUtilization.map((c) => c.minutes))

  return (
    <div className="stats-panel">
      {/* Hero KPIs */}
      <div className="stats-kpis">
        <div className="stats-kpi"><div className="stats-kpi-num">{fmt(stats.kpis.events)}</div><div className="stats-kpi-lbl">{t('statsKpiEvents')}</div></div>
        <div className="stats-kpi"><div className="stats-kpi-num">{fmt(stats.kpis.matches)}</div><div className="stats-kpi-lbl">{t('statsKpiMatches')}</div></div>
        <div className="stats-kpi">
          <div className="stats-kpi-num">
            {fmt(stats.kpis.players)} / {fmt(stats.kpis.multiEventPlayers)}
            {stats.kpis.players > 0 && (
              <span className="stats-kpi-sub"> ({Math.round(stats.kpis.multiEventPlayers / stats.kpis.players * 100)}%)</span>
            )}
          </div>
          <div className="stats-kpi-lbl">{t('statsKpiPlayers')}</div>
        </div>
        <div className="stats-kpi"><div className="stats-kpi-num">{hours(stats.kpis.courtMinutes)}</div><div className="stats-kpi-lbl">{t('statsKpiCourtTime')}</div></div>
        <div className="stats-kpi"><div className="stats-kpi-num">{minStr(stats.kpis.avgMatchMinutes)}</div><div className="stats-kpi-lbl">{t('statsKpiAvgMatch')}</div></div>
        <div className="stats-kpi"><div className="stats-kpi-num">{pct(stats.kpis.threeSetterRate)}</div><div className="stats-kpi-lbl">{t('statsKpiThreeSetters')}</div></div>
      </div>

      {/* Matches per day */}
      <section className="stats-section">
        <h2>{t('statsSectionMatchesPerDay')}</h2>
        {stats.dailyVolume.map((d) => (
          <div className="stats-bar-row" key={d.date}>
            <span className="stats-bar-label">{d.label}</span>
            <div className="stats-bar-track"><div className="stats-bar-fill" style={{ width: `${(d.total / dayMax) * 100}%` }} /></div>
            <span className="stats-bar-val">{fmt(d.total)}<span className="stats-bar-secondary">{hours(d.minutes)}</span></span>
          </div>
        ))}
      </section>

      {/* Drama */}
      <section className="stats-section">
        <h2>{t('statsSectionDrama')}</h2>
        {stats.drama.marathon && (
          <DramaCard
            badge={`★ ${t('statsMarathonBadge')} — ${formatDuration(stats.drama.marathon.durationMinutes!)}`}
            where={`${stats.drama.marathon.draw} · ${stats.drama.marathon.round}`}
            ref_={stats.drama.marathon}
          />
        )}
        {stats.drama.highestSet && (
          <DramaCard
            badge={`★ ${t('statsHighestSetBadge')} — ${stats.drama.highestSet.scores[stats.drama.highestSet.setIndex].t1}–${stats.drama.highestSet.scores[stats.drama.highestSet.setIndex].t2}`}
            where={`${stats.drama.highestSet.draw} · ${stats.drama.highestSet.round}`}
            ref_={stats.drama.highestSet}
          />
        )}
        <div className="stats-drama stats-drama--cool">
          <div className="stats-drama-head">
            <span className="stats-drama-badge">{stats.drama.comebackCount} {t('statsComebacksBadge')}</span>
            {stats.drama.comebackHighlight && (
              <span className="stats-drama-where">{stats.drama.comebackHighlight.draw} · {stats.drama.comebackHighlight.round}</span>
            )}
          </div>
          {stats.drama.comebackHighlight && (
            <div className="stats-drama-teams">
              {(stats.drama.comebackHighlight.winnerSide === 1 ? stats.drama.comebackHighlight.team1 : stats.drama.comebackHighlight.team2).join(' / ')}
            </div>
          )}
        </div>
        {stats.drama.mostCourtTime && (
          <div className="stats-drama">
            <div className="stats-drama-head">
              <span className="stats-drama-badge">★ {t('statsMostCourtTimeBadge')} — {formatDuration(stats.drama.mostCourtTime.minutes)}</span>
              <span className="stats-drama-where">{stats.drama.mostCourtTime.events.join(' + ')} · {stats.drama.mostCourtTime.matches} matches</span>
            </div>
            <div className="stats-drama-teams">
              {stats.drama.mostCourtTime.name}
              {stats.drama.mostCourtTime.seed && <span className="stats-seed"> {stats.drama.mostCourtTime.seed}</span>}
            </div>
          </div>
        )}
      </section>

      {/* Events */}
      <section className="stats-section">
        <h2>{t('statsSectionEvents')}</h2>
        <table className="stats-table stats-event-list">
          <thead><tr><th>{t('statsSectionEvents')}</th><th>{t('statsColMatches')}</th><th>{t('statsCol3Set')}</th><th>{t('statsColAvg')}</th><th>{t('statsColWinner')}</th></tr></thead>
          <tbody>
            {stats.events.map((e) => (
              <tr key={e.name}>
                <td className="stats-evname">{e.name}</td>
                <td>{e.matches}</td>
                <td>{e.matches === 0 ? '0%' : pct(e.threeSetters / Math.max(1, e.decided))}</td>
                <td>{minStr(e.avgMinutes)}</td>
                <td className="stats-winner-cell">{e.winner.join(' / ')}{e.winnerSeed && <span className="stats-seed"> {e.winnerSeed}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Top players + Courts */}
      <div className="stats-grid-2">
        <section className="stats-section">
          <h2>{t('statsSectionTopPlayers')}</h2>
          <table className="stats-table">
            <thead><tr><th></th><th>Player</th><th>W–L</th></tr></thead>
            <tbody>
              {stats.topPlayers.map((p, i) => (
                <tr key={p.playerId}>
                  <td className="stats-rank">{i + 1}</td>
                  <td>{p.name}{p.seed && <span className="stats-seed"> {p.seed}</span>}</td>
                  <td className="stats-wl"><b>{p.wins}</b>–<i>{p.losses}</i></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="stats-section">
          <h2>{t('statsSectionCourtUtilization')}</h2>
          {stats.courtUtilization.map((c) => (
            <div className="stats-court-row" key={c.name}>
              <span className="stats-court-nm">{c.name.split(' - ').pop() ?? c.name}</span>
              <div className="stats-bar-track"><div className="stats-bar-fill" style={{ width: `${(c.minutes / courtMax) * 100}%` }} /></div>
              <span className="stats-court-v">{(c.minutes / 60).toFixed(1)} h</span>
            </div>
          ))}
        </section>
      </div>

      {/* Club Medals */}
      <section className="stats-section">
        <h2>{t('statsSectionClubMedals')}</h2>
        <table className="stats-table">
          <thead><tr><th></th><th>Club</th><th>🥇</th><th>🥈</th><th>🥉</th></tr></thead>
          <tbody>
            {stats.clubMedals.map((c, i) => (
              <tr key={c.club}>
                <td className="stats-rank">{i + 1}</td>
                <td>{c.club}</td>
                <td><b>{c.gold}</b></td>
                <td>{c.silver}</td>
                <td>{c.bronze}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Multi-Gold Players */}
      {stats.multiGoldPlayers.length > 0 && (
        <section className="stats-section">
          <h2>{t('statsSectionMultiGold')}</h2>
          <table className="stats-table">
            <thead><tr><th>🥇</th><th>Player</th><th>Club</th><th>Events</th></tr></thead>
            <tbody>
              {stats.multiGoldPlayers.map((p) => (
                <tr key={p.playerId}>
                  <td><b>{p.events.length}</b></td>
                  <td>{p.name}{p.seed && <span className="stats-seed"> {p.seed}</span>}</td>
                  <td>{p.club}</td>
                  <td>{p.events.join(' + ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Integrity */}
      <section className="stats-section">
        <h2>{t('statsSectionIntegrity')}</h2>
        <div className="stats-grid-2">
          <div>
            <div>Walkovers: <b>{stats.kpis.walkovers}</b> / Retired: <b>{stats.kpis.retired}</b></div>
            {stats.integrity.walkoverByEvent.slice(0, 4).map((w) => (
              <div key={w.event}>{w.event}: {w.walkovers} W.O. ({pct(w.rate)})</div>
            ))}
          </div>
          <div>
            <div>3-setters by event:</div>
            {stats.integrity.threeSetterByEvent.slice(0, 4).map((s) => (
              <div key={s.event}>{s.event}: {pct(s.rate)} ({s.sample})</div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function DramaCard({ badge, where, ref_ }: { badge: string; where: string; ref_: { team1: string[]; team2: string[]; winnerSide: 1 | 2; scores: Array<{ t1: number; t2: number }> } }) {
  const winner = ref_.winnerSide === 1 ? ref_.team1 : ref_.team2
  const loser = ref_.winnerSide === 1 ? ref_.team2 : ref_.team1
  return (
    <div className="stats-drama">
      <div className="stats-drama-head">
        <span className="stats-drama-badge">{badge}</span>
        <span className="stats-drama-where">{where}</span>
      </div>
      <div className="stats-drama-teams">{winner.join(' / ')} def. {loser.join(' / ')}</div>
      <div className="stats-drama-score">{ref_.scores.map((s) => `${s.t1}–${s.t2}`).join(', ')}</div>
    </div>
  )
}
```

- [ ] **Step 2: Add the stats CSS to `app/globals.css`**

Append to `app/globals.css` (copy from the mockup file's `<style>` block, with class names prefixed `stats-` to avoid collisions). Specifically copy:

- `.stats-panel`, `.stats-kpis`, `.stats-kpi*` rules
- `.stats-section`, `.stats-grid-2`
- `.stats-bar-row`, `.stats-bar-track`, `.stats-bar-fill`, `.stats-bar-val`, `.stats-bar-secondary`
- `.stats-drama*` rules
- `.stats-table`, `.stats-rank`, `.stats-seed`, `.stats-wl`
- `.stats-court-row`, `.stats-court-nm`, `.stats-court-v`
- `.stats-evname`, `.stats-winner-cell`
- `.stats-loading`, `.stats-empty`, `.stats-error`
- The full `@media (max-width: 480px)` block from the mockup

Reference the mockup file `public/tournament-stats-mockup.html` lines ~140-230 for exact rules. Translate `--ink` → `--fg`, `--rule` → `--border`, `--brand` already matches.

- [ ] **Step 3: Commit**

```bash
git add components/TournamentStatsPanel.tsx app/globals.css
git commit -m "TournamentStatsPanel component + styles

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: Day-strip integration (📊 pill)

**Files:**
- Modify: `components/MatchSchedule.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Modify `MatchSchedule.tsx`**

Find the day-tabs block (around line 332):

```tsx
{days.length > 0 && (
  <div className="match-schedule__day-tabs">
    {days.map((d) => (
      <button .../>
    ))}
  </div>
)}
```

Replace with:

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

Find the body section (lines ~350-395 with loading/groups rendering) and wrap it:

```tsx
{selectedDay === 'stats' && tournamentId ? (
  <TournamentStatsPanel tournamentId={tournamentId} />
) : (
  <>
    {loading && (...)}
    {!loading && groups.length === 0 && (...)}
    {!loading && (() => { ... })()}
  </>
)}
```

(Keep all existing inner content unchanged — only wrap.)

Add the import at top:

```tsx
import TournamentStatsPanel from './TournamentStatsPanel'
```

- [ ] **Step 2: Add the pill CSS**

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

- [ ] **Step 3: Type-check + run existing tests**

```bash
npx tsc --noEmit
npx jest MatchSchedule
```

Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
git add components/MatchSchedule.tsx app/globals.css
git commit -m "Day-strip integration: 📊 pill swaps body for stats panel

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 14: `app/page.tsx` — handle `'stats'` sentinel

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Update `handleDayChange` (around line 528)**

Replace with:

```tsx
const handleDayChange = useCallback(async (date: string) => {
  if (!selectedTournament) return
  setSelectedDay(date)
  if (date === 'stats') return
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

- [ ] **Step 2: Guard the live-score effect**

Around line 179, the early-return condition:

```tsx
if (!completion || !selectedTournament || !selectedDay || selectedDay === 'stats') return
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add app/page.tsx
git commit -m "page.tsx: handle selectedDay='stats' sentinel

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 15: Component render test + full smoke

**Files:**
- Create: `__tests__/TournamentStatsPanel.test.tsx`

- [ ] **Step 1: Write render tests**

Create `__tests__/TournamentStatsPanel.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import TournamentStatsPanel from '@/components/TournamentStatsPanel'
import { LanguageProvider } from '@/lib/LanguageContext'

const mockStats = {
  tournamentId: 'abc', generatedAt: 'X',
  coverage: { daysOnDisk: 6, daysFromMemory: 0, daysFromBat: 0, totalDays: 6 },
  kpis: { events: 33, matches: 1384, decided: 1343, walkovers: 41, retired: 6, nowPlaying: 0,
    players: 1102, multiEventPlayers: 839, courtMinutes: 39046, avgMatchMinutes: 29, threeSetterRate: 0.14 },
  dailyVolume: [{ date: '2026-05-01', label: '1 May', total: 397, decided: 387, minutes: 9608 }],
  events: [{ name: 'BS U15', matches: 111, threeSetters: 25, walkovers: 0, decided: 110, avgMinutes: 29, winner: ['Champ'] }],
  drama: { marathon: null, highestSet: null, comebackCount: 102, comebackHighlight: null, mostCourtTime: null },
  topPlayers: [{ playerId: 'p1', name: 'Top Player', wins: 11, losses: 1 }],
  courtUtilization: [{ name: 'A05', matches: 103, minutes: 3238 }],
  clubMedals: [{ club: 'บ้านทองหยอด', gold: 27, silver: 19, bronze: 24 }],
  multiGoldPlayers: [],
  integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => mockStats }) as unknown as typeof fetch
})

describe('TournamentStatsPanel', () => {
  it('renders KPIs and main sections', async () => {
    render(<LanguageProvider><TournamentStatsPanel tournamentId="abc" /></LanguageProvider>)
    await waitFor(() => expect(screen.getByText('1,384')).toBeInTheDocument())
    expect(screen.getByText(/1,102 \/ 839/)).toBeInTheDocument()
    expect(screen.getByText('Top Player')).toBeInTheDocument()
    expect(screen.getByText('บ้านทองหยอด')).toBeInTheDocument()
  })

  it('renders empty state when matches === 0', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true, json: async () => ({ ...mockStats, kpis: { ...mockStats.kpis, matches: 0 } }),
    })
    render(<LanguageProvider><TournamentStatsPanel tournamentId="abc" /></LanguageProvider>)
    await waitFor(() => expect(screen.getByText(/Early days/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Install testing-library if missing**

```bash
npm i -D @testing-library/react @testing-library/jest-dom 2>&1 | tail -3
```

- [ ] **Step 3: Run all tests**

```bash
npx jest
```

Expected: all PASS.

- [ ] **Step 4: Type-check + build**

```bash
npx tsc --noEmit
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Local dev smoke**

```bash
npm run dev
```

Open http://localhost:3000, pick SPRC, tap the `📊` pill.
Expected:
- All 8 sections render with non-zero numbers
- Tapping a date pill returns to schedule
- Returning to 📊 is instant (memCache)
- Server log shows `[stats-cache] wrote tournament=...` once, no `[bat-fetch]` lines

- [ ] **Step 6: Commit, push, and PR**

```bash
git add __tests__/TournamentStatsPanel.test.tsx
git commit -m "TournamentStatsPanel render tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push -u origin stats
```

Then create a PR for review.

---

## Summary of expected commits

1. Add TournamentStats type definitions
2. Add tournament stats test fixtures (SPRC + empty)
3. Aggregator: KPIs
4. Aggregator: daily volume
5. Aggregator: events with custom sort + winners
6. Aggregator: drama (marathon, highest set, comebacks, most court time)
7. Aggregator: top players + court utilization + integrity
8. Aggregator: club medals + multi-gold players + empty fixture test
9. Stats disk cache with sha256 fingerprint
10. /api/stats route with cache-tier orchestration + clubs
11. i18n: tournament-stats strings (en + th)
12. TournamentStatsPanel component + styles
13. Day-strip integration: 📊 pill swaps body for stats panel
14. page.tsx: handle selectedDay='stats' sentinel
15. TournamentStatsPanel render tests

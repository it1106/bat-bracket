# Event Breakdown Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Event Breakdown" matrix to the BWF stats page showing, per country, how many teams exited at each knockout round (R128…F, Champion), filterable by event via a dropdown.

**Architecture:** Server-side `buildEventBreakdown(ctxs)` in `lib/tournamentStats.ts` computes per-event → per-country → per-round team counts (with an active/eliminated split) into a new optional `eventBreakdown` field on `ComputedStats`. A new client component `EventBreakdownTable` renders it below the Country Head-to-Head section. Cache version bumps v13→v14.

**Tech Stack:** TypeScript, Next.js 14 (App Router), React client components, Jest.

## Global Constraints

- Team identity = sorted, comma-joined `playerId`s of a side within an event; a doubles pair counts once.
- Country attribution: the country shared by all team members; if mixed, the first player's country; if none, `—` (hidden by the client).
- Only knockout rounds are bucketed (`isKnockoutRound`). Grouped/RR group-phase exits are omitted in v1.
- Round buckets ordered first-round→title: by `roundSize` descending (R128=128 … F=2), with synthetic `Champion` last.
- Active teams (no loss, not champion) are placed in their current round (pending match's round, else one round deeper than deepest win) and counted as `active` (rendered green), not `done`.
- All new user-facing copy added to BOTH `en` and `th` maps in `lib/i18n.ts`.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## File Structure

- **Modify** `lib/types.ts` — add `StatsEventBreakdownCell`, `StatsEventBreakdown`; add optional `eventBreakdown` to `ComputedStats`.
- **Modify** `lib/tournamentStats.ts` — add `buildEventBreakdown` + helpers; call it in `aggregate()`.
- **Modify** `lib/stats-cache.ts` — bump version 13→14.
- **Modify** `lib/i18n.ts` — 5 new keys (EN + TH).
- **Create** `components/EventBreakdownTable.tsx` — the matrix UI.
- **Modify** `components/TournamentStatsPanel.tsx` — render the section below Head-to-Head.
- **Modify** `app/globals.css` — green active-count class.
- **Test** `__tests__/tournamentStats.test.ts` — `buildEventBreakdown` behavior.
- **Test** `__tests__/EventBreakdownTable.test.tsx` — rendering + All aggregation.

---

## Task 1: Types + empty payload field + cache bump

**Files:**
- Modify: `lib/types.ts` (add types near `StatsCountryMatrix`, extend `ComputedStats`)
- Modify: `lib/stats-cache.ts` (version 13→14)
- Test: `__tests__/tournamentStats.test.ts`

**Interfaces:**
- Produces: `StatsEventBreakdownCell { done: number; active: number }`,
  `StatsEventBreakdown { events: {key:string;label:string}[]; columns: string[];
  columnsByEvent: Record<string,string[]>; counts: Record<string, Record<string,
  Record<string, StatsEventBreakdownCell>>> }`, and `ComputedStats.eventBreakdown?: StatsEventBreakdown`.

- [ ] **Step 1: Add the types to `lib/types.ts`**

Insert after the `StatsCountryMatrix`-related interfaces (near line 420):

```ts
export interface StatsEventBreakdownCell {
  done: number   // teams eliminated AT this round
  active: number // teams still in, currently in this round (rendered green)
}

export interface StatsEventBreakdown {
  // Dropdown options ordered by event rank. key = collapsed event key
  // (eventName ?? draw); label = display string (e.g. "BS U17").
  events: { key: string; label: string }[]
  // Ordered bucket union across all events (the "All" view columns).
  columns: string[]
  // Ordered buckets present within each event key.
  columnsByEvent: Record<string, string[]>
  // counts[eventKey][country][bucket] = cell. Sparse; omit zero cells.
  counts: Record<string, Record<string, Record<string, StatsEventBreakdownCell>>>
}
```

- [ ] **Step 2: Extend `ComputedStats` in `lib/types.ts`**

Add the field alongside `countryMatrix?`:

```ts
  // BWF-only: per-country team distribution across knockout rounds. Absent
  // for club-based tournaments or when no knockout events exist.
  eventBreakdown?: StatsEventBreakdown
```

- [ ] **Step 3: Bump the stats-cache version in `lib/stats-cache.ts`**

Add a comment line before the interface and change all three `13`s to `14`:

```ts
// v14 adds eventBreakdown (per-country team counts by knockout round). v13
// envelopes lack it, so the Event Breakdown matrix would be empty until
// recomputed.
```
Then: `version: 14` (interface), `if (parsed.version !== 14) return null`, and `{ version: 14, ...envelope }`.

- [ ] **Step 4: Write the failing test (empty tournament yields an empty structure)**

Add to `__tests__/tournamentStats.test.ts` inside the existing `describe('tournamentStats — empty', ...)` block, a new `it`:

```ts
  it('exposes an empty eventBreakdown when there are no matches', () => {
    const empty = JSON.parse(
      fs.readFileSync(path.join(FIX, 'stats-empty.json'), 'utf8'),
    ) as MatchesData
    const s = aggregate(empty, new Map(), {})
    expect(s.eventBreakdown).toEqual({ events: [], columns: [], columnsByEvent: {}, counts: {} })
  })
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx jest __tests__/tournamentStats.test.ts -t "empty eventBreakdown"`
Expected: FAIL — `s.eventBreakdown` is `undefined`.

- [ ] **Step 6: Add an empty default so it compiles and the empty case passes**

In `lib/tournamentStats.ts`, add to the `EMPTY: ComputedStats` object literal (near line 34):

```ts
  eventBreakdown: { events: [], columns: [], columnsByEvent: {}, counts: {} },
```

And in `aggregate()`, add to the non-empty `base` object literal (near the `integrity:` line, ~1268):

```ts
    eventBreakdown: { events: [], columns: [], columnsByEvent: {}, counts: {} },
```

(The real computation replaces this in Task 2.)

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx jest __tests__/tournamentStats.test.ts -t "empty eventBreakdown"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/types.ts lib/stats-cache.ts lib/tournamentStats.ts __tests__/tournamentStats.test.ts
git commit -m "feat(stats): scaffold eventBreakdown payload field + cache v14

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `buildEventBreakdown` aggregation

**Files:**
- Modify: `lib/tournamentStats.ts` (add helpers + `buildEventBreakdown`; call in `aggregate()`)
- Test: `__tests__/tournamentStats.test.ts`

**Interfaces:**
- Consumes: `MatchCtx[]` (from `iterateMatches`), helpers `isKnockoutRound`, `isFinal`, `roundSize`, `abbrevRoundL`, `eventRank`.
- Produces: `buildEventBreakdown(ctxs: MatchCtx[]): StatsEventBreakdown` — the real structure that replaces the empty default in `base`.

- [ ] **Step 1: Write the failing tests**

Add a new describe block to `__tests__/tournamentStats.test.ts` (self-contained fixture; mirrors the BWF medals test). Round strings `Quarter final` / `Semi final` / `Final` normalize to `QF`/`SF`/`F`.

```ts
describe('tournamentStats — event breakdown', () => {
  const data: MatchesData = {
    days: [{ date: '20260519', label: '19/05', dateIso: '2026-05-19', hasMatches: true }],
    currentDate: '20260519',
    groups: [],
  }
  type P = { c: string; id: string }
  const pl = (p: P) => ({ name: p.id, playerId: p.id, country: p.c })
  const THA = (id: string): P => ({ c: 'THA', id })
  const INA = (id: string): P => ({ c: 'INA', id })
  const MAS = (id: string): P => ({ c: 'MAS', id })
  const JPN = (id: string): P => ({ c: 'JPN', id })
  const KOR = (id: string): P => ({ c: 'KOR', id })
  const CHN = (id: string): P => ({ c: 'CHN', id })
  // draw, round, team1, team2, winner (null = pending)
  const M = (draw: string, round: string, t1: P[], t2: P[], winner: 1 | 2 | null): MatchEntry => ({
    draw, drawNum: '1', round,
    team1: t1.map(pl), team2: t2.map(pl),
    winner,
    scores: winner === null ? [] : [{ t1: 21, t2: 15 }, { t1: 21, t2: 18 }],
    court: 'C1', walkover: false, retired: false, nowPlaying: false,
  })
  const dayGroups: MatchScheduleGroup[] = [{
    type: 'time' as const, time: '09:00',
    matches: [
      // MS singles, 4-draw: THA champion, MAS runner-up, INA two SF losers.
      M('MS', 'Semi final', [THA('t1')], [INA('i1')], 1),
      M('MS', 'Semi final', [MAS('m1')], [INA('i2')], 1),
      M('MS', 'Final', [THA('t1')], [MAS('m1')], 1),
      // MD doubles, 4-draw: THA pair champion, MAS pair runner-up, INA two SF pairs.
      M('MD', 'Semi final', [THA('t1'), THA('t2')], [INA('a1'), INA('a2')], 1),
      M('MD', 'Semi final', [MAS('m1'), MAS('m2')], [INA('b1'), INA('b2')], 1),
      M('MD', 'Final', [THA('t1'), THA('t2')], [MAS('m1'), MAS('m2')], 1),
      // WS singles, 4-draw, IN PROGRESS: SF1 done, SF2 pending, no final yet.
      M('WS', 'Semi final', [THA('w1')], [JPN('j1')], 1),   // THA won SF -> active in F
      M('WS', 'Semi final', [KOR('k1')], [CHN('c1')], null), // both active in SF
      // BS singles, deeper draw: a single QF result to introduce a QF column.
      M('BS', 'Quarter final', [THA('b1')], [INA('x1')], 1), // b1 active in SF, x1 out at QF
    ],
  }]
  const days = new Map([['2026-05-19', dayGroups]])
  const eb = () => aggregate(data, days, {}).eventBreakdown!

  it('buckets singles: champion, runner-up, SF losers per country', () => {
    const c = eb().counts['MS']
    expect(c['THA']['Champion']).toEqual({ done: 1, active: 0 })
    expect(c['MAS']['F']).toEqual({ done: 1, active: 0 })
    expect(c['INA']['SF']).toEqual({ done: 2, active: 0 })
  })

  it('counts a doubles pair as one team (dedup)', () => {
    const c = eb().counts['MD']
    expect(c['THA']['Champion']).toEqual({ done: 1, active: 0 })
    expect(c['MAS']['F']).toEqual({ done: 1, active: 0 })
    expect(c['INA']['SF']).toEqual({ done: 2, active: 0 }) // two pairs, not four players
  })

  it('places active teams in their current round as active (green)', () => {
    const c = eb().counts['WS']
    expect(c['THA']['F']).toEqual({ done: 0, active: 1 }) // won SF -> active in Final
    expect(c['JPN']['SF']).toEqual({ done: 1, active: 0 }) // lost SF
    expect(c['KOR']['SF']).toEqual({ done: 0, active: 1 }) // pending SF
    expect(c['CHN']['SF']).toEqual({ done: 0, active: 1 })
  })

  it('produces dynamic, ordered column unions', () => {
    const r = eb()
    // BS introduces QF; overall union ordered first-round -> title.
    expect(r.columns).toEqual(['QF', 'SF', 'F', 'Champion'])
    // MS (4-draw) omits QF.
    expect(r.columnsByEvent['MS']).toEqual(['SF', 'F', 'Champion'])
    expect(r.columnsByEvent['BS']).toEqual(['QF', 'SF'])
  })

  it('lists events ordered by event rank with labels', () => {
    const evs = eb().events.map((e) => e.key)
    expect(evs).toEqual(['MS', 'WS', 'MD', 'BS']) // OPEN_ORDER: MS,WS,MD,WD,XD; BS is a discipline band
    expect(eb().events[0]).toEqual({ key: 'MS', label: 'MS' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/tournamentStats.test.ts -t "event breakdown"`
Expected: FAIL — buckets are all empty (`counts['MS']` is `undefined`).

- [ ] **Step 3: Implement helpers + `buildEventBreakdown`**

Add to `lib/tournamentStats.ts` (place near the other builders, e.g. after `buildClubMedalsAndMultiGold`). Import note: `MatchPlayer` and `abbrevRoundL` are already imported at the top of the file.

```ts
// ---- Event Breakdown ----

const CHAMPION_BUCKET = 'Champion'

// Order buckets first-round -> title. roundSize gives R128=128 … F=2; the
// synthetic Champion sorts last (sentinel 1, "deeper" than the final).
function bucketOrderKey(bucket: string): number {
  return bucket === CHAMPION_BUCKET ? 1 : roundSize(bucket)
}
function sortBuckets(buckets: Iterable<string>): string[] {
  return Array.from(new Set(buckets)).sort((a, b) => bucketOrderKey(b) - bucketOrderKey(a))
}

// Label for a knockout draw size (F/SF/QF/R{n}); size<=1 is the champion.
function bucketForSize(size: number): string {
  if (size <= 1) return CHAMPION_BUCKET
  if (size === 2) return 'F'
  if (size === 4) return 'SF'
  if (size === 8) return 'QF'
  return `R${size}`
}

interface EbTeamAcc {
  country: string
  wonFinal: boolean
  lossRound?: string
  pendingRound?: string
  deepestWonSize: number // smallest roundSize won; Infinity if none won
}

function buildEventBreakdown(ctxs: MatchCtx[]): StatsEventBreakdown {
  const countryByPid = new Map<string, string>()
  for (const { match } of ctxs) {
    for (const p of [...match.team1, ...match.team2]) {
      if (p.playerId && p.country && !countryByPid.has(p.playerId)) {
        countryByPid.set(p.playerId, p.country)
      }
    }
  }
  const countryOfTeam = (team: MatchPlayer[]): string => {
    const cs = team
      .map((p) => (p.country ?? countryByPid.get(p.playerId) ?? '').trim())
      .filter(Boolean)
    if (cs.length === 0) return '—'
    return cs.every((c) => c === cs[0]) ? cs[0] : cs[0] // shared, else first player's
  }
  const teamKeyOf = (team: MatchPlayer[]): string =>
    team.map((p) => p.playerId).filter(Boolean).slice().sort().join(',')

  const byEvent = new Map<string, Map<string, EbTeamAcc>>()
  const accOf = (event: string, team: MatchPlayer[]): EbTeamAcc | null => {
    const key = teamKeyOf(team)
    if (!key) return null
    let teams = byEvent.get(event)
    if (!teams) { teams = new Map(); byEvent.set(event, teams) }
    let a = teams.get(key)
    if (!a) {
      a = { country: countryOfTeam(team), wonFinal: false, deepestWonSize: Infinity }
      teams.set(key, a)
    }
    return a
  }

  for (const { match } of ctxs) {
    if (!isKnockoutRound(match.round)) continue
    const event = match.eventName ?? match.draw
    if (!event) continue
    const a1 = accOf(event, match.team1)
    const a2 = accOf(event, match.team2)
    if (match.winner === null) {
      // In-progress: both sides are "in" this round. Keep the deepest.
      const keepDeeper = (a: EbTeamAcc | null) => {
        if (!a) return
        if (!a.pendingRound || roundSize(match.round) < roundSize(a.pendingRound)) {
          a.pendingRound = match.round
        }
      }
      keepDeeper(a1); keepDeeper(a2)
      continue
    }
    const winAcc = match.winner === 1 ? a1 : a2
    const loseAcc = match.winner === 1 ? a2 : a1
    if (winAcc) {
      const sz = roundSize(match.round)
      if (sz < winAcc.deepestWonSize) winAcc.deepestWonSize = sz
      if (isFinal(match.round)) winAcc.wonFinal = true
    }
    if (loseAcc) loseAcc.lossRound = match.round // one loss in single-elim
  }

  const counts: StatsEventBreakdown['counts'] = {}
  const columnsByEvent: Record<string, string[]> = {}
  const allBuckets = new Set<string>()

  for (const [event, teams] of Array.from(byEvent)) {
    const evBuckets = new Set<string>()
    for (const a of Array.from(teams.values())) {
      let bucket: string
      let active = false
      if (a.wonFinal) {
        bucket = CHAMPION_BUCKET
      } else if (a.lossRound) {
        bucket = abbrevRoundL(a.lossRound, 'en')
      } else {
        active = true
        if (a.pendingRound) bucket = abbrevRoundL(a.pendingRound, 'en')
        else if (a.deepestWonSize < Infinity) bucket = bucketForSize(a.deepestWonSize / 2)
        else continue // no signal — cannot place
      }
      evBuckets.add(bucket)
      allBuckets.add(bucket)
      const byCountry = (counts[event] ??= {})
      const byBucket = (byCountry[a.country] ??= {})
      const cell = (byBucket[bucket] ??= { done: 0, active: 0 })
      if (active) cell.active++
      else cell.done++
    }
    columnsByEvent[event] = sortBuckets(evBuckets)
  }

  const events = Object.keys(counts)
    .sort((a, b) => eventRank(a) - eventRank(b))
    .map((key) => ({ key, label: key }))

  return { events, columns: sortBuckets(allBuckets), columnsByEvent, counts }
}
```

Add the `StatsEventBreakdown` import to the existing type import block at the top of `lib/tournamentStats.ts` (the `import type { … } from './types'` list).

- [ ] **Step 4: Wire it into `aggregate()`**

Replace the placeholder line added in Task 1 (`eventBreakdown: { events: [], … }`) in the non-empty `base` object with:

```ts
    eventBreakdown: buildEventBreakdown(ctxs),
```

- [ ] **Step 5: Run the event-breakdown tests**

Run: `npx jest __tests__/tournamentStats.test.ts -t "event breakdown"`
Expected: PASS (all five `it`s).

- [ ] **Step 6: Run the full tournamentStats suite (no regressions)**

Run: `npx jest __tests__/tournamentStats.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/tournamentStats.ts __tests__/tournamentStats.test.ts
git commit -m "feat(stats): compute eventBreakdown (teams by knockout round)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: i18n strings

**Files:**
- Modify: `lib/i18n.ts` (TKey union + `en` + `th` maps)

**Interfaces:**
- Produces: keys `statsSectionEventBreakdown`, `statsEventBreakdownAll`, `statsEventBreakdownFilter`, `statsEventBreakdownTotal`, `statsEventBreakdownChampion`.

- [ ] **Step 1: Add the keys to the `TKey` union**

In the `export type TKey =` union in `lib/i18n.ts`, add (near the other `stats*` keys):

```ts
  | 'statsSectionEventBreakdown'
  | 'statsEventBreakdownAll'
  | 'statsEventBreakdownFilter'
  | 'statsEventBreakdownTotal'
  | 'statsEventBreakdownChampion'
```

- [ ] **Step 2: Add English values**

In the `en` translations map, next to `statsMedalsPerEvent`:

```ts
    statsSectionEventBreakdown: 'Event Breakdown',
    statsEventBreakdownAll: 'All events',
    statsEventBreakdownFilter: 'Event',
    statsEventBreakdownTotal: 'Total',
    statsEventBreakdownChampion: 'Champion',
```

- [ ] **Step 3: Add Thai values**

In the `th` translations map, at the matching spot:

```ts
    statsSectionEventBreakdown: 'สรุปผลแต่ละรอบ',
    statsEventBreakdownAll: 'ทุกประเภท',
    statsEventBreakdownFilter: 'ประเภท',
    statsEventBreakdownTotal: 'รวม',
    statsEventBreakdownChampion: 'แชมป์',
```

- [ ] **Step 4: Typecheck (both maps satisfy `Record<TKey, string>`)**

Run: `npx tsc --noEmit 2>&1 | grep i18n || echo "i18n OK"`
Expected: `i18n OK` (a missing key in either map would error here).

- [ ] **Step 5: Commit**

```bash
git add lib/i18n.ts
git commit -m "i18n(stats): add Event Breakdown strings (en/th)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `EventBreakdownTable` component

**Files:**
- Create: `components/EventBreakdownTable.tsx`
- Modify: `app/globals.css` (green active-count class)
- Test: `__tests__/EventBreakdownTable.test.tsx`

**Interfaces:**
- Consumes: `StatsEventBreakdown` (Task 1), i18n keys (Task 3).
- Produces: `export default function EventBreakdownTable({ data }: { data: StatsEventBreakdown })`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/EventBreakdownTable.test.tsx`. Follow the existing component-test setup (see `__tests__/CountryRosterModal.test.tsx` for the `LanguageProvider` wrapper pattern used in this repo; import it the same way).

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react'
import { LanguageProvider } from '@/lib/LanguageContext'
import EventBreakdownTable from '@/components/EventBreakdownTable'
import type { StatsEventBreakdown } from '@/lib/types'

const data: StatsEventBreakdown = {
  events: [{ key: 'MS', label: 'MS' }, { key: 'WS', label: 'WS' }],
  columns: ['SF', 'F', 'Champion'],
  columnsByEvent: { MS: ['SF', 'F', 'Champion'], WS: ['SF', 'F'] },
  counts: {
    MS: {
      THA: { Champion: { done: 1, active: 0 }, SF: { done: 1, active: 0 } },
      INA: { F: { done: 1, active: 0 } },
    },
    WS: {
      THA: { F: { done: 0, active: 1 } }, // active (green)
    },
  },
}

const renderIt = () =>
  render(
    <LanguageProvider>
      <EventBreakdownTable data={data} />
    </LanguageProvider>,
  )

describe('EventBreakdownTable', () => {
  it('aggregates All: THA totals across events, sorted by total', () => {
    renderIt()
    const rows = screen.getAllByRole('row')
    // Header + THA + INA. THA total = Champion1 + SF1 + F(active)1 = 3; INA = 1.
    const tha = rows.find((r) => within(r).queryByText('THA'))!
    expect(within(tha).getByText('3')).toBeInTheDocument() // Total column
  })

  it('renders active counts with the green class', () => {
    const { container } = renderIt()
    expect(container.querySelector('.stats-eb-active')).toHaveTextContent('1')
  })

  it('filters columns when a single event is selected', () => {
    renderIt()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'WS' } })
    // WS has no Champion column.
    expect(screen.queryByText('Champion')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/EventBreakdownTable.test.tsx`
Expected: FAIL — module `components/EventBreakdownTable` not found.

- [ ] **Step 3: Implement the component**

Create `components/EventBreakdownTable.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { countryDisplayName } from '@/lib/countryCodes'
import type { StatsEventBreakdown, StatsEventBreakdownCell } from '@/lib/types'

const fmt = (n: number) => n.toLocaleString('en-US')

function labelOf(country: string): string {
  const d = countryDisplayName(country)
  return d && d.toLowerCase() !== country.toLowerCase() ? `${d} (${country})` : country
}

function Cell({ cell }: { cell: StatsEventBreakdownCell }) {
  if (cell.done === 0 && cell.active === 0) return null
  return (
    <>
      {cell.done > 0 && <span>{fmt(cell.done)}</span>}
      {cell.active > 0 && (
        <span className="stats-eb-active">{cell.done > 0 ? ' ' : ''}{fmt(cell.active)}</span>
      )}
    </>
  )
}

export default function EventBreakdownTable({ data }: { data: StatsEventBreakdown }) {
  const { t } = useLanguage()
  const [event, setEvent] = useState<'all' | string>('all')

  const columns = event === 'all' ? data.columns : (data.columnsByEvent[event] ?? [])

  // Aggregate the current scope: country -> bucket -> summed cell.
  const scope = new Map<string, Map<string, StatsEventBreakdownCell>>()
  const eventsInScope = event === 'all' ? Object.keys(data.counts) : [event]
  for (const ev of eventsInScope) {
    const byCountry = data.counts[ev] ?? {}
    for (const [country, byBucket] of Object.entries(byCountry)) {
      if (country === '—') continue
      let m = scope.get(country)
      if (!m) { m = new Map(); scope.set(country, m) }
      for (const [bucket, cell] of Object.entries(byBucket)) {
        const cur = m.get(bucket) ?? { done: 0, active: 0 }
        m.set(bucket, { done: cur.done + cell.done, active: cur.active + cell.active })
      }
    }
  }

  const rows = Array.from(scope.entries())
    .map(([country, byBucket]) => {
      let total = 0
      for (const b of columns) {
        const c = byBucket.get(b)
        if (c) total += c.done + c.active
      }
      return { country, byBucket, total }
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || labelOf(a.country).localeCompare(labelOf(b.country)))

  if (rows.length === 0) return null

  const colLabel = (bucket: string) =>
    bucket === 'Champion' ? t('statsEventBreakdownChampion') : bucket

  return (
    <>
      <div className="stats-matrix-agesel">
        <label>
          {t('statsEventBreakdownFilter')}{' '}
          <select value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="all">{t('statsEventBreakdownAll')}</option>
            {data.events.map((ev) => (
              <option key={ev.key} value={ev.key}>{ev.label}</option>
            ))}
          </select>
        </label>
      </div>
      <table className="stats-table">
        <thead><tr>
          <th></th>
          <th>{t('statsColCountry')}</th>
          {columns.map((b) => <th key={b} className="stats-num">{colLabel(b)}</th>)}
          <th className="stats-num">{t('statsEventBreakdownTotal')}</th>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.country}>
              <td className="stats-rank">{i + 1}</td>
              <td>{labelOf(r.country)}</td>
              {columns.map((b) => (
                <td key={b} className="stats-num">
                  <Cell cell={r.byBucket.get(b) ?? { done: 0, active: 0 }} />
                </td>
              ))}
              <td className="stats-num">{fmt(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
```

- [ ] **Step 4: Add the green class to `app/globals.css`**

Append near the other `.stats-*` rules. Theme-aware green that reads on both light and dark:

```css
.stats-eb-active { color: #16a34a; font-weight: 600; }
@media (prefers-color-scheme: dark) { .stats-eb-active { color: #4ade80; } }
:root[data-theme='dark'] .stats-eb-active { color: #4ade80; }
:root[data-theme='light'] .stats-eb-active { color: #16a34a; }
```

- [ ] **Step 5: Run the component tests**

Run: `npx jest __tests__/EventBreakdownTable.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/EventBreakdownTable.tsx app/globals.css __tests__/EventBreakdownTable.test.tsx
git commit -m "feat(stats): EventBreakdownTable component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Wire the section into the stats panel

**Files:**
- Modify: `components/TournamentStatsPanel.tsx` (import + new section)

**Interfaces:**
- Consumes: `EventBreakdownTable` (Task 4), `stats.eventBreakdown` (Task 1/2), `isCountryBased` (already computed in the component), i18n key `statsSectionEventBreakdown`.

- [ ] **Step 1: Add the import**

Near the other component imports (with `CountryMatrixTable`):

```tsx
import EventBreakdownTable from '@/components/EventBreakdownTable'
```

- [ ] **Step 2: Render the section below Country Head-to-Head**

Immediately after the closing `)}` of the `{stats.countryMatrix && … }` section (around line 583), add:

```tsx
      {isCountryBased && stats.eventBreakdown && stats.eventBreakdown.events.length > 0 && (
        <section className="stats-section">
          <h2>{t('statsSectionEventBreakdown')}</h2>
          <EventBreakdownTable data={stats.eventBreakdown} />
        </section>
      )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "scripts/ravin" | grep -v "downlevelIteration" | grep -v "c.roster' is possibly" || echo "OK"`
Expected: `OK` (only the pre-existing scratch/test errors are filtered out).

- [ ] **Step 4: Commit**

```bash
git add components/TournamentStatsPanel.tsx
git commit -m "feat(stats): show Event Breakdown section below Head-to-Head

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Verify end-to-end and deploy

**Files:** none (verification + deploy)

- [ ] **Step 1: Full test suite**

Run: `npx jest`
Expected: all suites pass (existing ~1076 + new event-breakdown + component tests).

- [ ] **Step 2: Production build (move untracked scratch scripts aside first)**

```bash
ST="$(mktemp -d)"
mv scripts/ravin-age-breakdown.ts scripts/ravin-full-history.ts "$ST"/ 2>/dev/null
npm run build 2>&1 | grep -E "Compiled|Failed|Error" | head
mv "$ST"/ravin-age-breakdown.ts "$ST"/ravin-full-history.ts scripts/ 2>/dev/null
```
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Deploy on the origin (v14 cache recomputes automatically)**

```bash
ssh root@ezebat.lan "set -e; cd ~/app && git pull --ff-only && npm run build 2>&1 | tail -3 && pm2 reload bat-bracket && pm2 list | grep bat-bracket"
```
Expected: worker `online`.

- [ ] **Step 5: Verify the live payload includes eventBreakdown for Yonex Sunrise**

```bash
curl -s --max-time 28 "http://172.16.88.198:3000/api/stats?tournament=F25A7927-E9BA-47C8-959D-42A013B65592" \
 | node -e 'const s=JSON.parse(require("fs").readFileSync(0));const eb=s.eventBreakdown;console.log("events:",eb.events.map(e=>e.key).join(","));console.log("columns:",eb.columns.join(","));const t=eb.counts["MS-U19"]?.["INA"];console.log("MS-U19 INA:",JSON.stringify(t));'
```
Expected: events list matches the 14 events; `columns` includes `R128,R64,R32,R16,QF,SF,F,Champion`; INA cells present.

- [ ] **Step 6: Confirm origin + edge health**

```bash
curl -s -o /dev/null -w "origin %{http_code}\n" --max-time 12 "http://172.16.88.198:3000/"
curl -s -o /dev/null -w "apex %{http_code}\n" --max-time 15 "https://batmatch.app/"
```
Expected: `origin 200`, `apex 200` (retry apex once if transient tunnel `000`).

---

## Self-Review Notes

- **Spec coverage:** teams counting (T2 dedup test), country attribution (T2 code + `—` hidden in T4), dynamic union columns (T2 test), Total column + sort (T4), active-in-green (T2 `active` split + T4 `.stats-eb-active`), dropdown All+events (T4), BWF-only placement (T5 `isCountryBased`), cache bump (T1). Group-stage deferral is documented in the spec.
- **Types:** `StatsEventBreakdown` / `StatsEventBreakdownCell` defined in T1 and used identically in T2/T4; `buildEventBreakdown` returns that exact shape.
- **No placeholders:** every step has concrete code/commands.

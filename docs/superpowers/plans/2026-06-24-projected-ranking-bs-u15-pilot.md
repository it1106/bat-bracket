# Projected Ranking (beta) — BS U15 Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Projected Ranking (beta)" checkbox to the BS U15 ranking board that shows next week's projected ranks (add un-counted tournaments + expire out-of-window points) for the top-50 players, side-by-side with official ranks.

**Architecture:** A pure projection engine (`projection.ts`) reconstructs a player's board total from cached official detail rows + recent index results. An assembly layer (`projection-board.ts`) bridges the caches into engine inputs and ranks the cohort. A paced/resumable backfill job fills the 50 detail files; a manual token-gated route triggers it. A dedicated `/api/ranking/projected` route serves the projected board; `page.tsx` passes an SSR readiness flag; `LeaderboardsView` renders the dual columns.

**Tech Stack:** Next.js (app router), TypeScript, Jest + ts-jest, React Testing Library. Path alias `@/` → repo root.

**Spec:** `docs/superpowers/specs/2026-06-24-projected-ranking-design.md` (read it; this plan implements it).

## Global Constraints

- **BAT only.** Provider is always `'bat'`; BWF never shows projection.
- **Pilot target:** event code `U15_MS`, event name `"U15 Boys singles"` (exact string — it is the key in both `ranking-bat.json` events and detail `countsTowardRankingsParsed`).
- **Cohort:** top **50** by official `rank` on `U15_MS`. A single constant `COHORT_SIZE = 50`.
- **All-or-nothing:** never emit/render a partially-projected board. Projection runs only when all 50 cohort players have detail fresh for the current `publishDate`.
- **Ranking rule (verified):** a board total = **sum of top-10 credits toward the target event** after collapsing same-`(week, tournamentName)` rows to the single highest credit (Rule 1). Expiring a counting row promotes the next-highest remaining (Rule 2).
- **Detail freshness:** a detail is trustworthy only if `detail.publishDate === current.publishDate` AND `isDetailScrapeFresh(detail.scrapedAt)` (24h revision TTL). A `notFound` record for the current publishDate counts as resolved/ready.
- **Pace:** backfill is serial, ~1 request / 2 s with ±0.5 s jitter, circuit-breaker on sustained upstream errors, resumable (skip already-fresh), single-flight.
- **TDD + frequent commits.** Run `npx jest <file>` per task. Test caches go under `os.tmpdir()` via the `__set...RootForTesting` hooks; never touch real `.cache`.

---

### Task 1: Extract a reusable `fetchAndCacheDetail`

The detail-fetch logic is currently a private function inside the API route. Extract it verbatim into a shared module so the backfill job can reuse it. Behavior-preserving — the existing route test guards it.

**Files:**
- Create: `lib/ranking/fetch-detail.ts`
- Modify: `app/api/players/ranking-detail/route.ts` (remove the local `fetchAndCache`, import the shared one)
- Test (existing, must stay green): `__tests__/api-players-ranking-detail-route.test.ts`

**Interfaces:**
- Produces: `fetchAndCacheDetail(provider: ProviderTag, globalPlayerId: string, rankingId: string, publishDate: string): Promise<RankingPlayerDetail | { notFound: true }>` — exactly 1 upstream request; writes the detail cache on success; returns `{ notFound: true }` on a 404 (does NOT persist notFound — caller decides, preserving current route behavior).

- [ ] **Step 1: Create the shared module**

```typescript
// lib/ranking/fetch-detail.ts
import { rankingFetch } from '@/lib/ranking/fetch'
import { getRankingConfig } from '@/lib/ranking/config'
import { parseRankingPlayerPage } from '@/lib/ranking/player-scraper'
import { writeRankingPlayerDetail } from '@/lib/ranking/player-cache'
import type { RankingPlayerDetail, ProviderTag } from '@/lib/types'

/** Fetch one player's ranking-detail page and cache it. Exactly one upstream
 *  request. Returns the parsed detail (also written to the per-player cache),
 *  or `{ notFound: true }` on a 404 — the caller persists the notFound marker
 *  if it wants to (preserving the API route's prior behavior). Throws on other
 *  non-OK responses so backoff/circuit-breaker logic can react. */
export async function fetchAndCacheDetail(
  provider: ProviderTag,
  globalPlayerId: string,
  rankingId: string,
  publishDate: string,
): Promise<RankingPlayerDetail | { notFound: true }> {
  const cfg = getRankingConfig(provider)
  const url = cfg.playerUrl(rankingId, globalPlayerId)
  const res = await rankingFetch(provider, 'player-detail', url)
  if (res.status === 404) return { notFound: true }
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  const html = await res.text()
  const { tournaments } = parseRankingPlayerPage(html)
  const detail: RankingPlayerDetail = {
    globalPlayerId, publishDate, scrapedAt: new Date().toISOString(), tournaments,
  }
  await writeRankingPlayerDetail(provider, detail)
  return detail
}
```

- [ ] **Step 2: Point the route at the shared module**

In `app/api/players/ranking-detail/route.ts`: delete the local `async function fetchAndCache(...)` (lines ~84–102) and its now-unused imports if any become unused (`getRankingConfig`, `rankingFetch`, `parseRankingPlayerPage`, `writeRankingPlayerDetail` — check each; remove only those no longer referenced). Add:

```typescript
import { fetchAndCacheDetail } from '@/lib/ranking/fetch-detail'
```

Replace the call site `await fetchAndCache(providerParam, globalPlayerId, current.rankingId, current.publishDate)` with `await fetchAndCacheDetail(providerParam, globalPlayerId, current.rankingId, current.publishDate)`.

- [ ] **Step 3: Run the existing route test**

Run: `npx jest __tests__/api-players-ranking-detail-route.test.ts`
Expected: PASS (behavior unchanged).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (in particular no "declared but never read" for removed imports).

- [ ] **Step 5: Commit**

```bash
git add lib/ranking/fetch-detail.ts app/api/players/ranking-detail/route.ts
git commit -m "refactor(ranking): extract reusable fetchAndCacheDetail"
```

---

### Task 2: Pure projection engine

The heart of the feature: given a player's base rows (their results crediting the target board) and added rows (recent un-counted results, already pointed), compute the projected board total with expiry + Rule 1 + Rule 2. Pure, no I/O.

**Files:**
- Create: `lib/ranking/projection.ts`
- Test: `__tests__/ranking-projection.test.ts`

**Interfaces:**
- Consumes: `weekSortKey`, `expiringNextWeekCutoff`, `isExpiringNextWeek` from `@/lib/ranking/player-view`.
- Produces:
  - `interface ProjectionRow { week: string; sourceEvent: string; tournamentName: string; credit: number }`
  - `interface PlayerProjection { projectedTotal: number; rows: ProjectionRow[] }`
  - `projectPlayer(baseRows: ProjectionRow[], addedRows: ProjectionRow[], publishDate: string): PlayerProjection`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/ranking-projection.test.ts
import { projectPlayer, ProjectionRow } from '@/lib/ranking/projection'

// publishDate in BAT thai-be format ("D/M/BBBB"). 23/6/2569 = 2026-06-23,
// which is ISO week 2026-26. The next-publish cutoff = 52 weeks back = week
// 2025-26: rows in week <= 2025-26 expire next publish.
const PUB = '23/6/2569'

function row(week: string, credit: number, name = `T-${week}-${credit}`, src = 'BS U15'): ProjectionRow {
  return { week, sourceEvent: src, tournamentName: name, credit }
}

describe('projectPlayer', () => {
  it('sums all base rows when fewer than 10 and none expire', () => {
    const base = [row('2026-10', 5000), row('2026-12', 3000)]
    const p = projectPlayer(base, [], PUB)
    expect(p.projectedTotal).toBe(8000)
  })

  it('Rule 2 expiry: drops a row at/older than the next-publish cutoff', () => {
    const base = [row('2025-26', 9000), row('2026-12', 3000)] // 2025-26 expires
    const p = projectPlayer(base, [], PUB)
    expect(p.projectedTotal).toBe(3000)
  })

  it('Rule 2 promotion: an 11th-best row enters the top-10 when a counter expires', () => {
    // 10 fresh rows of 1000 + one fresh row of 500 (the 11th) + one expiring 9000.
    const fresh = Array.from({ length: 10 }, (_, i) => row(`2026-${10 + i}`, 1000, `A${i}`))
    const eleventh = row('2026-05', 500, 'ELEVENTH')
    const expiring = row('2025-20', 9000, 'OLD')
    const base = [...fresh, eleventh, expiring]
    // Without expiry the top-10 would be the 9000 + nine 1000s = 18000.
    // After expiry: ten 1000s + promoted 500 -> top-10 = ten 1000s = 10000.
    const p = projectPlayer(base, [], PUB)
    expect(p.projectedTotal).toBe(10000)
    expect(p.rows.some(r => r.tournamentName === 'OLD')).toBe(false)
  })

  it('Rule 1: same (week, tournamentName) collapses to the highest credit', () => {
    const base = [row('2026-11', 4000, 'SAME', 'BS U15'), row('2026-11', 6000, 'SAME', 'BS U17')]
    const p = projectPlayer(base, [], PUB)
    expect(p.projectedTotal).toBe(6000)
    expect(p.rows).toHaveLength(1)
  })

  it('adds recent results on top of base, then re-picks top-10', () => {
    const base = [row('2026-10', 5000)]
    const added = [row('2026-20', 7000, 'NEW')]
    const p = projectPlayer(base, added, PUB)
    expect(p.projectedTotal).toBe(12000)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/ranking-projection.test.ts`
Expected: FAIL ("Cannot find module '@/lib/ranking/projection'").

- [ ] **Step 3: Implement the engine**

```typescript
// lib/ranking/projection.ts
import {
  weekSortKey, expiringNextWeekCutoff, isExpiringNextWeek,
} from '@/lib/ranking/player-view'

export interface ProjectionRow {
  week: string            // "YYYY-WW"
  sourceEvent: string     // e.g. "BS U15"
  tournamentName: string
  credit: number          // credit toward the target event
}

export interface PlayerProjection {
  projectedTotal: number
  rows: ProjectionRow[]   // the surviving top-10
}

/** Numeric age from a source-event string ("BS U15" -> 15); +Inf when none. */
function ageOf(sourceEvent: string): number {
  const m = sourceEvent.match(/U(\d+)/i)
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY
}

/** Rule 1: collapse rows sharing (week, tournamentName) to a single entry,
 *  keeping the highest credit. Ties keep the older age group (immaterial to
 *  the total — mirrors upstream). */
function dedupeByTournament(rows: ProjectionRow[]): ProjectionRow[] {
  const byKey = new Map<string, ProjectionRow>()
  for (const r of rows) {
    const key = `${weekSortKey(r.week)}::${r.tournamentName.trim()}`
    const cur = byKey.get(key)
    if (!cur) { byKey.set(key, r); continue }
    let wins: boolean
    if (r.credit !== cur.credit) wins = r.credit > cur.credit
    else wins = ageOf(r.sourceEvent) > ageOf(cur.sourceEvent)
    if (wins) byKey.set(key, r)
  }
  return Array.from(byKey.values())
}

const TOP_N = 10

/** Project a single player's target-board total for next week's publication.
 *  baseRows: their official detail rows already filtered to the target event's
 *  credit. addedRows: their recent un-counted results, already pointed and
 *  deduped against the detail. publishDate: current publication (BAT thai-be). */
export function projectPlayer(
  baseRows: ProjectionRow[],
  addedRows: ProjectionRow[],
  publishDate: string,
): PlayerProjection {
  const cutoff = expiringNextWeekCutoff(publishDate, 'thai-be')
  const survivingBase = baseRows.filter(r => !isExpiringNextWeek(r.week, cutoff))
  const merged = dedupeByTournament([...survivingBase, ...addedRows])
  const top = merged
    .slice()
    .sort((a, b) => b.credit - a.credit || weekSortKey(b.week).localeCompare(weekSortKey(a.week)))
    .slice(0, TOP_N)
  return { projectedTotal: top.reduce((s, r) => s + r.credit, 0), rows: top }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/ranking-projection.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ranking/projection.ts __tests__/ranking-projection.test.ts
git commit -m "feat(ranking): pure projection engine (expire + rules 1/2)"
```

---

### Task 3: Detail backfill job

A paced, resumable, single-flight orchestrator that gap-fills the cohort's detail files. All I/O is injected so it tests with a mocked fetcher and zero delay.

**Files:**
- Create: `lib/ranking/detail-backfill.ts`
- Test: `__tests__/ranking-detail-backfill.test.ts`

**Interfaces:**
- Consumes: `RankingPlayerDetail` type; the caller wires real `fetchDetail`/`isReady`/`persistNotFound` (Task 4).
- Produces:
  - `interface BackfillResult { total: number; have: number; fetched: number; failed: string[] }`
  - `interface BackfillDeps { fetchDetail; isReady; persistNotFound; sleep?; delayMs?; jitterMs?; breakerThreshold? }`
  - `runDetailBackfill(gids: string[], deps: BackfillDeps): Promise<BackfillResult>`
  - `class BackfillBusyError extends Error`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/ranking-detail-backfill.test.ts
import { runDetailBackfill, BackfillBusyError } from '@/lib/ranking/detail-backfill'
import type { RankingPlayerDetail } from '@/lib/types'

const detail = (gid: string): RankingPlayerDetail => ({
  globalPlayerId: gid, publishDate: 'P', scrapedAt: 'now', tournaments: [],
})
const noSleep = () => Promise.resolve()

describe('runDetailBackfill', () => {
  it('skips players already ready and fetches only the gaps', async () => {
    const ready = new Set(['a'])
    const fetched: string[] = []
    const res = await runDetailBackfill(['a', 'b', 'c'], {
      isReady: async g => ready.has(g),
      fetchDetail: async g => { fetched.push(g); return detail(g) },
      persistNotFound: async () => {},
      sleep: noSleep, delayMs: 0,
    })
    expect(fetched).toEqual(['b', 'c'])
    expect(res).toMatchObject({ total: 3, fetched: 2 })
  })

  it('persists notFound and counts it as fetched, not failed', async () => {
    const nf: string[] = []
    const res = await runDetailBackfill(['x'], {
      isReady: async () => false,
      fetchDetail: async () => ({ notFound: true }),
      persistNotFound: async g => { nf.push(g) },
      sleep: noSleep, delayMs: 0,
    })
    expect(nf).toEqual(['x'])
    expect(res.failed).toEqual([])
  })

  it('collects per-player failures without aborting the run', async () => {
    const res = await runDetailBackfill(['a', 'b'], {
      isReady: async () => false,
      fetchDetail: async g => { if (g === 'a') throw new Error('boom'); return detail(g) },
      persistNotFound: async () => {},
      sleep: noSleep, delayMs: 0,
    })
    expect(res.failed).toEqual(['a'])
    expect(res.fetched).toBe(1)
  })

  it('trips the circuit breaker after consecutive failures', async () => {
    const attempted: string[] = []
    const res = await runDetailBackfill(['a', 'b', 'c', 'd'], {
      isReady: async () => false,
      fetchDetail: async g => { attempted.push(g); throw new Error('429') },
      persistNotFound: async () => {},
      sleep: noSleep, delayMs: 0, breakerThreshold: 2,
    })
    expect(attempted).toEqual(['a', 'b']) // stops after 2 consecutive failures
    expect(res.failed).toEqual(['a', 'b'])
  })

  it('rejects re-entry while a run is in flight (single-flight)', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(r => { release = r })
    const first = runDetailBackfill(['a'], {
      isReady: async () => false,
      fetchDetail: async () => { await gate; return detail('a') },
      persistNotFound: async () => {},
      sleep: noSleep, delayMs: 0,
    })
    await expect(
      runDetailBackfill(['b'], {
        isReady: async () => false, fetchDetail: async () => detail('b'),
        persistNotFound: async () => {}, sleep: noSleep, delayMs: 0,
      }),
    ).rejects.toBeInstanceOf(BackfillBusyError)
    release()
    await first
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/ranking-detail-backfill.test.ts`
Expected: FAIL ("Cannot find module '@/lib/ranking/detail-backfill'").

- [ ] **Step 3: Implement the job**

```typescript
// lib/ranking/detail-backfill.ts
import type { RankingPlayerDetail } from '@/lib/types'

export interface BackfillResult {
  total: number
  have: number     // ready before this run (skipped)
  fetched: number  // newly fetched or resolved-as-notFound this run
  failed: string[]
}

export interface BackfillDeps {
  fetchDetail: (gid: string) => Promise<RankingPlayerDetail | { notFound: true }>
  isReady: (gid: string) => Promise<boolean>
  persistNotFound: (gid: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  delayMs?: number          // base pace between fetches (default 2000)
  jitterMs?: number         // +/- jitter (default 500)
  breakerThreshold?: number // consecutive failures before aborting (default 5)
}

export class BackfillBusyError extends Error {
  constructor() { super('detail backfill already running'); this.name = 'BackfillBusyError' }
}

let running = false

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function runDetailBackfill(
  gids: string[],
  deps: BackfillDeps,
): Promise<BackfillResult> {
  if (running) throw new BackfillBusyError()
  running = true
  try {
    const sleep = deps.sleep ?? defaultSleep
    const delayMs = deps.delayMs ?? 2000
    const jitterMs = deps.jitterMs ?? 500
    const breakerThreshold = deps.breakerThreshold ?? 5

    let have = 0
    let fetched = 0
    let consecutiveFailures = 0
    const failed: string[] = []

    for (const gid of gids) {
      if (await deps.isReady(gid)) { have++; continue }
      try {
        const out = await deps.fetchDetail(gid)
        if ('notFound' in out) await deps.persistNotFound(gid)
        fetched++
        consecutiveFailures = 0
      } catch {
        failed.push(gid)
        consecutiveFailures++
        if (consecutiveFailures >= breakerThreshold) break
      }
      const jitter = (Math.random() * 2 - 1) * jitterMs
      await sleep(Math.max(0, delayMs + jitter))
    }
    return { total: gids.length, have, fetched, failed }
  } finally {
    running = false
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/ranking-detail-backfill.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/ranking/detail-backfill.ts __tests__/ranking-detail-backfill.test.ts
git commit -m "feat(ranking): paced/resumable/single-flight detail backfill job"
```

---

### Task 4: Cohort helpers + backfill admin route & script

Shared cohort/readiness helpers (used by both the backfill route and the projected route), the token-gated trigger route, and a CLI wrapper.

**Files:**
- Create: `lib/ranking/u15-cohort.ts`
- Create: `app/api/ranking/backfill-u15/route.ts`
- Create: `scripts/backfill-u15.ts`
- Test: `__tests__/ranking-u15-cohort.test.ts`

**Interfaces:**
- Consumes: `readRankingCache` (`@/lib/ranking/cache`), `readRankingPlayerDetail`, `isDetailScrapeFresh` (`@/lib/ranking/player-cache`), `fetchAndCacheDetail` (Task 1), `runDetailBackfill` (Task 3).
- Produces (from `u15-cohort.ts`):
  - `const COHORT_SIZE = 50`, `const TARGET_EVENT_CODE = 'U15_MS'`, `const TARGET_EVENT_NAME = 'U15 Boys singles'`
  - `interface CohortPlayer { slug: string; globalPlayerId: string; officialRank: number; officialPoints: number; name: string }`
  - `loadCohort(): Promise<{ rankingId: string; publishDate: string; players: CohortPlayer[] } | null>`
  - `isCohortPlayerReady(gid: string, publishDate: string): Promise<boolean>`
  - `cohortReadiness(): Promise<{ ready: boolean; have: number; total: number }>`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/ranking-u15-cohort.test.ts
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { __setRankingCacheRootForTesting } from '@/lib/ranking/cache'
import {
  __setRankingPlayerCacheRootForTesting, writeRankingPlayerDetail,
} from '@/lib/ranking/player-cache'
import { loadCohort, cohortReadiness, COHORT_SIZE } from '@/lib/ranking/u15-cohort'

async function seedRanking(dir: string) {
  const entries = Array.from({ length: 60 }, (_, i) => ({
    rank: i + 1, name: `P${i}`, slug: `p${i}`, club: 'C', points: 1000 - i,
    tournaments: 5, globalPlayerId: `g${i}`, previousRank: i + 1,
  }))
  const ranking = {
    provider: 'bat', scrapedAt: 'now', publishDate: '23/6/2569', rankingId: '52346',
    events: [{ eventCode: 'U15_MS', eventName: 'U15 Boys singles', entries }],
  }
  await fs.writeFile(path.join(dir, 'ranking-bat.json'), JSON.stringify(ranking))
}

describe('u15-cohort', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cohort-'))
    __setRankingCacheRootForTesting(dir)                       // ranking-bat.json lives here
    __setRankingPlayerCacheRootForTesting(path.join(dir, 'detail'))
    await seedRanking(dir)
  })

  it('loads exactly the top COHORT_SIZE players by rank', async () => {
    const c = await loadCohort()
    expect(c).not.toBeNull()
    expect(c!.players).toHaveLength(COHORT_SIZE)
    expect(c!.players[0]).toMatchObject({ slug: 'p0', globalPlayerId: 'g0', officialRank: 1 })
    expect(c!.publishDate).toBe('23/6/2569')
  })

  it('readiness is false until all cohort details are fresh for the publishDate', async () => {
    expect(await cohortReadiness()).toMatchObject({ ready: false, have: 0, total: COHORT_SIZE })
    for (let i = 0; i < COHORT_SIZE; i++) {
      await writeRankingPlayerDetail('bat', {
        globalPlayerId: `g${i}`, publishDate: '23/6/2569',
        scrapedAt: new Date().toISOString(), tournaments: [],
      })
    }
    expect(await cohortReadiness()).toMatchObject({ ready: true, have: COHORT_SIZE })
  })

  it('a detail from a different publishDate does not count as ready', async () => {
    await writeRankingPlayerDetail('bat', {
      globalPlayerId: 'g0', publishDate: '16/6/2569',
      scrapedAt: new Date().toISOString(), tournaments: [],
    })
    expect((await cohortReadiness()).have).toBe(0)
  })
})
```

> Verified: `lib/ranking/cache.ts` exports `__setRankingCacheRootForTesting(dir)` and `readRankingCache('bat')` reads `${root}/ranking-bat.json` — exactly what `seedRanking` writes. No new hook needed.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/ranking-u15-cohort.test.ts`
Expected: FAIL ("Cannot find module '@/lib/ranking/u15-cohort'").

- [ ] **Step 3: Implement the cohort helpers**

```typescript
// lib/ranking/u15-cohort.ts
import { readRankingCache } from '@/lib/ranking/cache'
import { readRankingPlayerDetail, isDetailScrapeFresh } from '@/lib/ranking/player-cache'

export const COHORT_SIZE = 50
export const TARGET_EVENT_CODE = 'U15_MS'
export const TARGET_EVENT_NAME = 'U15 Boys singles'

export interface CohortPlayer {
  slug: string
  globalPlayerId: string
  officialRank: number
  officialPoints: number
  name: string
}

/** Top-COHORT_SIZE U15_MS players (by rank) from the current BAT ranking,
 *  plus the rankingId/publishDate needed to fetch their details. null when no
 *  ranking is cached or the event is missing. Players without a globalPlayerId
 *  are skipped (all 500 have one in practice). */
export async function loadCohort(): Promise<
  { rankingId: string; publishDate: string; players: CohortPlayer[] } | null
> {
  const ranking = await readRankingCache('bat')
  if (!ranking) return null
  const ev = ranking.events.find(e => e.eventCode === TARGET_EVENT_CODE)
  if (!ev) return null
  const players: CohortPlayer[] = ev.entries
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .filter(e => !!e.globalPlayerId)
    .slice(0, COHORT_SIZE)
    .map(e => ({
      slug: e.slug, globalPlayerId: e.globalPlayerId!, officialRank: e.rank,
      officialPoints: e.points, name: e.name,
    }))
  return { rankingId: ranking.rankingId, publishDate: ranking.publishDate, players }
}

/** A cohort player is ready when their cached detail (or notFound marker)
 *  matches the current publishDate and the scrape is within the revision TTL. */
export async function isCohortPlayerReady(gid: string, publishDate: string): Promise<boolean> {
  const cache = await readRankingPlayerDetail('bat', gid)
  if (!cache) return false
  if (cache.detail) {
    return cache.detail.publishDate === publishDate && isDetailScrapeFresh(cache.detail.scrapedAt)
  }
  if (cache.notFound) {
    return cache.notFound.publishDate === publishDate && isDetailScrapeFresh(cache.notFound.scrapedAt)
  }
  return false
}

export async function cohortReadiness(): Promise<{ ready: boolean; have: number; total: number }> {
  const cohort = await loadCohort()
  if (!cohort) return { ready: false, have: 0, total: COHORT_SIZE }
  let have = 0
  for (const p of cohort.players) {
    if (await isCohortPlayerReady(p.globalPlayerId, cohort.publishDate)) have++
  }
  return { ready: have === cohort.players.length && cohort.players.length > 0, have, total: cohort.players.length }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest __tests__/ranking-u15-cohort.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the admin route**

```typescript
// app/api/ranking/backfill-u15/route.ts
import { NextResponse } from 'next/server'
import { loadCohort, isCohortPlayerReady } from '@/lib/ranking/u15-cohort'
import { runDetailBackfill, BackfillBusyError } from '@/lib/ranking/detail-backfill'
import { fetchAndCacheDetail } from '@/lib/ranking/fetch-detail'
import { writeRankingPlayerNotFound } from '@/lib/ranking/player-cache'

export const dynamic = 'force-dynamic'

/** Manual, token-gated trigger. GET ?token=... — fills any missing/stale
 *  detail among the top-50 U15 cohort and reports progress. Idempotent. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token')
  const expected = process.env.PLAYERS_REBUILD_TOKEN
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const cohort = await loadCohort()
  if (!cohort) return NextResponse.json({ error: 'no ranking cached' }, { status: 503 })
  try {
    const result = await runDetailBackfill(cohort.players.map(p => p.globalPlayerId), {
      isReady: gid => isCohortPlayerReady(gid, cohort.publishDate),
      fetchDetail: gid => fetchAndCacheDetail('bat', gid, cohort.rankingId, cohort.publishDate),
      persistNotFound: gid => writeRankingPlayerNotFound('bat', gid, cohort.publishDate),
    })
    return NextResponse.json({ ready: result.failed.length === 0 && result.fetched + result.have === result.total, ...result })
  } catch (e) {
    if (e instanceof BackfillBusyError) return NextResponse.json({ error: 'busy' }, { status: 409 })
    throw e
  }
}
```

- [ ] **Step 6: Add the CLI wrapper**

```typescript
// scripts/backfill-u15.ts
// Run with: npx tsx scripts/backfill-u15.ts   (requires PLAYERS_REBUILD_TOKEN
// only if you go through the route; this script calls the job directly).
import { loadCohort, isCohortPlayerReady } from '@/lib/ranking/u15-cohort'
import { runDetailBackfill } from '@/lib/ranking/detail-backfill'
import { fetchAndCacheDetail } from '@/lib/ranking/fetch-detail'
import { writeRankingPlayerNotFound } from '@/lib/ranking/player-cache'

async function main() {
  const cohort = await loadCohort()
  if (!cohort) { console.error('no ranking cached'); process.exit(1) }
  console.log(`backfilling ${cohort.players.length} U15 players for ${cohort.publishDate}`)
  const result = await runDetailBackfill(cohort.players.map(p => p.globalPlayerId), {
    isReady: gid => isCohortPlayerReady(gid, cohort.publishDate),
    fetchDetail: gid => fetchAndCacheDetail('bat', gid, cohort.rankingId, cohort.publishDate),
    persistNotFound: gid => writeRankingPlayerNotFound('bat', gid, cohort.publishDate),
  })
  console.log(JSON.stringify(result, null, 2))
}
main()
```

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add lib/ranking/u15-cohort.ts app/api/ranking/backfill-u15/route.ts scripts/backfill-u15.ts __tests__/ranking-u15-cohort.test.ts
git commit -m "feat(ranking): U15 cohort helpers + manual backfill route/script"
```

---

### Task 5: Projection assembly (board builder)

Bridges the caches into engine inputs: builds base rows from a detail, builds added rows from the index (+ tournament level/name/week), and ranks the whole cohort. Export `isoWeekString` from `player-view.ts` so the add side can derive a row's week.

**Files:**
- Modify: `lib/ranking/player-view.ts` (add `export` to `isoWeekString`)
- Create: `lib/ranking/projection-board.ts`
- Test: `__tests__/ranking-projection-board.test.ts`

**Interfaces:**
- Consumes: `projectPlayer`, `ProjectionRow` (Task 2); `CohortPlayer`, `TARGET_EVENT_NAME` (Task 4); `RankingPlayerDetail`, `PlayerIndex`, `PlayerEventResult` types; `ageGroupFromEvent`, `pointsFor`, `pointsRoundFromResult` (`@/lib/points/bat-points`); `weekSortKey`, `isoWeekString` (`@/lib/ranking/player-view`).
- Produces:
  - `buildBaseRows(detail: RankingPlayerDetail, targetEvent: string): ProjectionRow[]`
  - `buildAddedRows(events: PlayerEventResult[], baseRows: ProjectionRow[], ctx: AddCtx): ProjectionRow[]` where `interface AddCtx { levelOf: (tournamentId: string) => number | undefined; nameOf: (tournamentId: string) => string; weekOf: (tournamentId: string) => string | null }`
  - `interface ProjectedEntry { slug; name; officialRank; officialPoints; projectedRank; projectedPoints; delta }`
  - `assembleProjectedBoard(cohort, deps): Promise<ProjectedEntry[]>` (deps inject detail/index/meta access — signature in Step 5 below)

- [ ] **Step 1: Export `isoWeekString`**

In `lib/ranking/player-view.ts` change `function isoWeekString(` to `export function isoWeekString(`. (No behavior change; existing tests stay green.)

- [ ] **Step 2: Write the failing test**

```typescript
// __tests__/ranking-projection-board.test.ts
import { buildBaseRows, buildAddedRows } from '@/lib/ranking/projection-board'
import type { RankingPlayerDetail, PlayerEventResult } from '@/lib/types'

const TARGET = 'U15 Boys singles'

const detail: RankingPlayerDetail = {
  globalPlayerId: 'g', publishDate: '23/6/2569', scrapedAt: 'now',
  tournaments: [
    { tournamentName: 'A', tournamentId: null, sourceEvent: 'BS U15', week: '2026-10',
      result: '9/16', points: 4194,
      countsTowardRankings: [TARGET], countsTowardRankingsParsed: [{ eventName: TARGET, credit: 4194 }] },
    // doubles row: no credit toward the singles board -> excluded
    { tournamentName: 'A', tournamentId: null, sourceEvent: 'BD U15', week: '2026-10',
      result: '5/8', points: 3000,
      countsTowardRankings: ['U15 Boys doubles'], countsTowardRankingsParsed: [{ eventName: 'U15 Boys doubles', credit: 3000 }] },
  ],
}

describe('buildBaseRows', () => {
  it('keeps singles rows (credit = points), excludes doubles', () => {
    const rows = buildBaseRows(detail, TARGET)
    expect(rows).toEqual([{ week: '2026-10', sourceEvent: 'BS U15', tournamentName: 'A', credit: 4194 }])
  })

  it('includes a NON-counting singles row (empty parsed credit) so Rule 2 can promote it', () => {
    const withEleventh: RankingPlayerDetail = {
      ...detail,
      tournaments: [
        ...detail.tournaments,
        { tournamentName: 'OLD', tournamentId: null, sourceEvent: 'BS U15', week: '2025-50',
          result: '33/64', points: 2147, countsTowardRankings: [], countsTowardRankingsParsed: [] },
      ],
    }
    const rows = buildBaseRows(withEleventh, TARGET)
    expect(rows.find(r => r.tournamentName === 'OLD')).toMatchObject({ credit: 2147 })
  })
})

describe('buildAddedRows', () => {
  const base = buildBaseRows(detail, TARGET)
  const ctx = {
    levelOf: () => 2,
    nameOf: (id: string) => (id === 'T9' ? 'NEW EVENT' : 'A'),
    weekOf: (id: string) => (id === 'T9' ? '2026-22' : '2026-10'),
  }
  const ev = (tournamentId: string, eventName: string): PlayerEventResult => ({
    tournamentId, eventId: 'e', eventName, discipline: 'singles',
    bestFinish: 'R16', wins: 2, losses: 1, drawSize: 32,
  })

  it('adds a genuinely new singles result not present in the detail', () => {
    const rows = buildAddedRows([ev('T9', 'BS U15')], base, ctx)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ week: '2026-22', sourceEvent: 'BS U15', tournamentName: 'NEW EVENT' })
    expect(rows[0].credit).toBeGreaterThan(0)
  })

  it('skips a result already counted in the detail (same week + discipline + age)', () => {
    const rows = buildAddedRows([ev('Tdup', 'BS U15')], base, ctx) // week 2026-10, BS U15 == base row
    expect(rows).toEqual([])
  })

  it('excludes non-singles results (wrong board)', () => {
    const doubles = { ...ev('T9', 'BD U15'), discipline: 'doubles' as const }
    expect(buildAddedRows([doubles], base, ctx)).toEqual([])
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest __tests__/ranking-projection-board.test.ts`
Expected: FAIL ("Cannot find module '@/lib/ranking/projection-board'").

- [ ] **Step 4: Implement base/added builders**

```typescript
// lib/ranking/projection-board.ts
import type {
  RankingPlayerDetail, PlayerEventResult, RankingPlayerTournament,
} from '@/lib/types'
import { ProjectionRow, projectPlayer } from '@/lib/ranking/projection'
import { weekSortKey, disciplineOf } from '@/lib/ranking/player-view'
import { ageGroupFromEvent, pointsFor, pointsRoundFromResult } from '@/lib/points/bat-points'

/** Normalized identity for "the same tournament-result toward a board":
 *  ISO-week + discipline class + age number. Robust to the differing event-name
 *  formats between the detail (sourceEvent "BS U15") and the index
 *  (eventName "Boys' Singles U15"). */
function resultKey(week: string, discipline: string | null, age: string | null): string {
  return `${weekSortKey(week)}::${discipline ?? '?'}::${age ?? '?'}`
}

/** Every boys-SINGLES detail row, credit = the row's own `points`. Do NOT key
 *  on `countsTowardRankingsParsed` — that array is populated ONLY for currently-
 *  counting rows (verified on prod), so keying on it hides the 11th+ rows that
 *  Rule 2 must promote when a counting row expires, silently defeating the
 *  expire side. For the U15 pilot every cohort member is U15-eligible, so each
 *  of their singles results credits U15 at its own points. `targetEvent` is a
 *  forward-looking hook; this body assumes "every singles row credits the
 *  target", valid for the single-age-board pilot.
 *
 *  Verified: include-all-singles + top-10-by-points reproduces the official
 *  U15_MS total for 7/8 sampled >10-result players (one edge overcounts ~1k —
 *  acceptable for beta, surfaced in the dual UI). */
export function buildBaseRows(detail: RankingPlayerDetail, _targetEvent: string): ProjectionRow[] {
  const out: ProjectionRow[] = []
  for (const t of detail.tournaments as RankingPlayerTournament[]) {
    if (disciplineOf(t.sourceEvent) !== 'singles') continue
    out.push({ week: t.week, sourceEvent: t.sourceEvent, tournamentName: t.tournamentName, credit: t.points })
  }
  return out
}

export interface AddCtx {
  levelOf: (tournamentId: string) => number | undefined
  nameOf: (tournamentId: string) => string
  weekOf: (tournamentId: string) => string | null
}

/** Recent singles results from the index, pointed via the engine, excluding
 *  any already represented among `baseRows` (the official detail). Caller has
 *  already restricted `events` to one player. */
export function buildAddedRows(
  events: PlayerEventResult[],
  baseRows: ProjectionRow[],
  ctx: AddCtx,
): ProjectionRow[] {
  const seen = new Set(baseRows.map(r => resultKey(r.week, disciplineOf(r.sourceEvent), ageGroupFromEvent(r.sourceEvent))))
  const out: ProjectionRow[] = []
  for (const e of events) {
    if (e.discipline !== 'singles') continue                 // U15 Boys *singles* board
    const week = ctx.weekOf(e.tournamentId)
    if (!week) continue
    const age = ageGroupFromEvent(e.eventName)
    const key = resultKey(week, 'singles', age)
    if (seen.has(key)) continue                              // already counted officially
    const level = ctx.levelOf(e.tournamentId)
    const round = pointsRoundFromResult(e.bestFinish, e.wins, e.drawSize, e.lostByWalkover, e.active)
    const credit = level && age && round ? pointsFor(level, age, round) : null
    if (!credit) continue
    out.push({ week, sourceEvent: e.eventName, tournamentName: ctx.nameOf(e.tournamentId), credit })
  }
  return out
}
```

- [ ] **Step 5: Run the unit test, then add the board assembler**

Run: `npx jest __tests__/ranking-projection-board.test.ts`
Expected: PASS.

Then append the cohort assembler (impure orchestration; deps injected so it stays testable):

```typescript
// lib/ranking/projection-board.ts (append)
import type { CohortPlayer } from '@/lib/ranking/u15-cohort'

export interface ProjectedEntry {
  slug: string
  name: string
  officialRank: number
  officialPoints: number
  projectedRank: number
  projectedPoints: number
  delta: number          // officialRank - projectedRank (positive = moved up)
}

export interface AssembleDeps {
  publishDate: string
  detailOf: (gid: string) => Promise<RankingPlayerDetail | null>
  eventsOf: (slug: string) => PlayerEventResult[]
  addCtx: AddCtx
  targetEvent: string
}

/** Project every cohort player, re-rank by projected total, compute Δ. */
export async function assembleProjectedBoard(
  cohort: CohortPlayer[],
  deps: AssembleDeps,
): Promise<ProjectedEntry[]> {
  const scored = await Promise.all(cohort.map(async p => {
    const detail = await deps.detailOf(p.globalPlayerId)
    const base = detail ? buildBaseRows(detail, deps.targetEvent) : []
    const added = buildAddedRows(deps.eventsOf(p.slug), base, deps.addCtx)
    const { projectedTotal } = projectPlayer(base, added, deps.publishDate)
    return { p, projectedPoints: projectedTotal }
  }))
  scored.sort((a, b) => b.projectedPoints - a.projectedPoints || a.p.officialRank - b.p.officialRank)
  return scored.map((s, i) => ({
    slug: s.p.slug, name: s.p.name,
    officialRank: s.p.officialRank, officialPoints: s.p.officialPoints,
    projectedRank: i + 1, projectedPoints: s.projectedPoints,
    delta: s.p.officialRank - (i + 1),
  }))
}
```

- [ ] **Step 6: Add an assembler test**

Append to `__tests__/ranking-projection-board.test.ts`:

```typescript
import { assembleProjectedBoard } from '@/lib/ranking/projection-board'

describe('assembleProjectedBoard', () => {
  it('re-ranks by projected total and computes delta vs official', async () => {
    const cohort = [
      { slug: 'a', globalPlayerId: 'ga', officialRank: 1, officialPoints: 5000, name: 'A' },
      { slug: 'b', globalPlayerId: 'gb', officialRank: 2, officialPoints: 4000, name: 'B' },
    ]
    const details: Record<string, RankingPlayerDetail> = {
      ga: { globalPlayerId: 'ga', publishDate: '23/6/2569', scrapedAt: 'now',
        tournaments: [{ tournamentName: 'X', tournamentId: null, sourceEvent: 'BS U15', week: '2026-10',
          result: 'x', points: 1000, countsTowardRankings: [TARGET], countsTowardRankingsParsed: [{ eventName: TARGET, credit: 1000 }] }] },
      gb: { globalPlayerId: 'gb', publishDate: '23/6/2569', scrapedAt: 'now',
        tournaments: [{ tournamentName: 'Y', tournamentId: null, sourceEvent: 'BS U15', week: '2026-10',
          result: 'y', points: 9000, countsTowardRankings: [TARGET], countsTowardRankingsParsed: [{ eventName: TARGET, credit: 9000 }] }] },
    }
    const board = await assembleProjectedBoard(cohort, {
      publishDate: '23/6/2569', targetEvent: TARGET,
      detailOf: async g => details[g] ?? null,
      eventsOf: () => [],
      addCtx: { levelOf: () => undefined, nameOf: () => '', weekOf: () => null },
    })
    // b projects higher (9000) than a (1000) -> b rank 1, a rank 2.
    expect(board.map(e => e.slug)).toEqual(['b', 'a'])
    expect(board[0]).toMatchObject({ slug: 'b', projectedRank: 1, delta: 1 })  // 2 -> 1
    expect(board[1]).toMatchObject({ slug: 'a', projectedRank: 2, delta: -1 }) // 1 -> 2
  })
})
```

- [ ] **Step 7: Run, typecheck, commit**

Run: `npx jest __tests__/ranking-projection-board.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

```bash
git add lib/ranking/player-view.ts lib/ranking/projection-board.ts __tests__/ranking-projection-board.test.ts
git commit -m "feat(ranking): projection assembly (base/added rows + cohort ranking)"
```

---

### Task 6: Projected ranking route + SSR readiness flag

The client-fetched route that returns the projected board, plus the cheap SSR readiness flag wired through `page.tsx` → `LeaderboardsView`.

**Files:**
- Create: `app/api/ranking/projected/route.ts`
- Create: `lib/ranking/projection-context.ts` (builds the real `AddCtx` + `eventsOf` from caches)
- Modify: `app/leaderboards/page.tsx` (compute and pass `projectedReady`)
- Modify: `components/LeaderboardsView.tsx` (accept the `projectedReady` prop — render wiring is Task 7)
- Test: `__tests__/api-ranking-projected-route.test.ts`

**Interfaces:**
- Consumes: `loadCohort`, `cohortReadiness`, `TARGET_EVENT_NAME` (Task 4); `assembleProjectedBoard` (Task 5); `readIndexCache` (`@/lib/player-index-cache`); `readRankingPlayerDetail` (`@/lib/ranking/player-cache`); `readMeta` (`@/lib/tournament-meta`); `getLevelOverrides` (`@/lib/tournament-level-overrides`); `listAllTournaments` (`@/lib/tournaments-registry`); `isoWeekString` (`@/lib/ranking/player-view`).
- Produces: `GET /api/ranking/projected?provider=bat` → `{ ready: false, have, total }` or `{ ready: true, publishDate, entries: ProjectedEntry[] }`. From `projection-context.ts`: `buildProjectionContext(slugs: string[]): Promise<{ eventsOf; addCtx }>`.

- [ ] **Step 1: Write the failing route test**

```typescript
// __tests__/api-ranking-projected-route.test.ts
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { __setRankingCacheRootForTesting } from '@/lib/ranking/cache'
import { __setRankingPlayerCacheRootForTesting } from '@/lib/ranking/player-cache'
import { GET } from '@/app/api/ranking/projected/route'

async function seedRanking(dir: string) {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    rank: i + 1, name: `P${i}`, slug: `p${i}`, club: 'C', points: 1000 - i,
    tournaments: 5, globalPlayerId: `g${i}`, previousRank: i + 1,
  }))
  await fs.writeFile(path.join(dir, 'ranking-bat.json'), JSON.stringify({
    provider: 'bat', scrapedAt: 'now', publishDate: '23/6/2569', rankingId: '52346',
    events: [{ eventCode: 'U15_MS', eventName: 'U15 Boys singles', entries }],
  }))
}

describe('GET /api/ranking/projected', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'proj-'))
    __setRankingCacheRootForTesting(dir)
    __setRankingPlayerCacheRootForTesting(path.join(dir, 'detail'))
    await seedRanking(dir)
  })

  it('returns ready:false with progress when details are missing', async () => {
    const res = await GET(new Request('http://x/api/ranking/projected?provider=bat'))
    const body = await res.json()
    expect(body).toMatchObject({ ready: false, have: 0, total: 50 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/api-ranking-projected-route.test.ts`
Expected: FAIL ("Cannot find module '@/app/api/ranking/projected/route'").

- [ ] **Step 3: Implement the projection context builder**

```typescript
// lib/ranking/projection-context.ts
import type { PlayerEventResult, PlayerIndex } from '@/lib/types'
import { readIndexCache } from '@/lib/player-index-cache'
import { readMeta } from '@/lib/tournament-meta'
import { getLevelOverrides } from '@/lib/tournament-level-overrides'
import { listAllTournaments } from '@/lib/tournaments-registry'
import { isoWeekString } from '@/lib/ranking/player-view'
import type { AddCtx } from '@/lib/ranking/projection-board'

/** Build the per-player events accessor and the tournament level/name/week
 *  context for the add side, from the live caches. Only the tournaments that
 *  the cohort actually played are looked up (meta reads are cheap + cached). */
export async function buildProjectionContext(
  slugs: string[],
): Promise<{ eventsOf: (slug: string) => PlayerEventResult[]; addCtx: AddCtx }> {
  const index = (await readIndexCache('bat')) as PlayerIndex | null
  const eventsOf = (slug: string): PlayerEventResult[] => index?.players[slug]?.events ?? []

  // Collect the tournament ids the cohort references so meta lookups are bounded.
  const ids = new Set<string>()
  for (const slug of slugs) for (const e of eventsOf(slug)) ids.add(e.tournamentId.toUpperCase())

  const overrides = getLevelOverrides()
  const nameMap = new Map<string, string>()
  for (const t of listAllTournaments()) nameMap.set(t.id.toUpperCase(), t.name)

  const levelMap = new Map<string, number | undefined>()
  const weekMap = new Map<string, string | null>()
  await Promise.all([...ids].map(async id => {
    const meta = await readMeta(id)
    levelMap.set(id, overrides.get(id) ?? meta?.level)
    weekMap.set(id, meta?.startDateIso ? isoWeekString(new Date(meta.startDateIso)) : null)
  }))

  const addCtx: AddCtx = {
    levelOf: id => levelMap.get(id.toUpperCase()),
    nameOf: id => nameMap.get(id.toUpperCase()) ?? '',
    weekOf: id => weekMap.get(id.toUpperCase()) ?? null,
  }
  return { eventsOf, addCtx }
}
```

- [ ] **Step 4: Implement the route**

```typescript
// app/api/ranking/projected/route.ts
import { NextResponse } from 'next/server'
import { loadCohort, cohortReadiness, TARGET_EVENT_NAME } from '@/lib/ranking/u15-cohort'
import { assembleProjectedBoard } from '@/lib/ranking/projection-board'
import { buildProjectionContext } from '@/lib/ranking/projection-context'
import { readRankingPlayerDetail } from '@/lib/ranking/player-cache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const provider = new URL(req.url).searchParams.get('provider') ?? 'bat'
  if (provider !== 'bat') return NextResponse.json({ error: 'bat only' }, { status: 400 })

  const readiness = await cohortReadiness()
  if (!readiness.ready) {
    return NextResponse.json({ ready: false, have: readiness.have, total: readiness.total })
  }
  const cohort = await loadCohort()
  if (!cohort) return NextResponse.json({ error: 'no ranking cached' }, { status: 503 })

  const { eventsOf, addCtx } = await buildProjectionContext(cohort.players.map(p => p.slug))
  const entries = await assembleProjectedBoard(cohort.players, {
    publishDate: cohort.publishDate,
    targetEvent: TARGET_EVENT_NAME,
    detailOf: async gid => (await readRankingPlayerDetail('bat', gid))?.detail ?? null,
    eventsOf, addCtx,
  })
  return NextResponse.json({ ready: true, publishDate: cohort.publishDate, entries })
}
```

- [ ] **Step 5: Run the route test**

Run: `npx jest __tests__/api-ranking-projected-route.test.ts`
Expected: PASS (ready:false path; the index/meta caches are absent in the test so `buildProjectionContext` is never reached).

- [ ] **Step 6: Wire the SSR readiness flag**

In `app/leaderboards/page.tsx`: import `cohortReadiness` and add it to the `Promise.all`, then pass it through. Add near the other awaits:

```typescript
import { cohortReadiness } from '@/lib/ranking/u15-cohort'
```

Add `cohortReadiness()` to the `Promise.all([...])` destructure (BAT-only; it internally reads the BAT ranking), e.g.:

```typescript
const [bat, bwf, batRanking, bwfRanking, projectedReady] = await Promise.all([
  readLeaderboardsCache('bat'),
  readLeaderboardsCache('bwf'),
  readRankingCache('bat'),
  readRankingCache('bwf'),
  cohortReadiness(),
])
```

Pass it to the view:

```typescript
<LeaderboardsView
  leaderboards={providers.length ? providers : [EMPTY]}
  rankingPublishDates={rankingPublishDates}
  rankingIds={rankingIds}
  initialProvider={initialProvider}
  projectedReady={projectedReady}
/>
```

- [ ] **Step 7: Accept the prop in the view (type only; render in Task 7)**

In `components/LeaderboardsView.tsx`, extend `Props`:

```typescript
  /** SSR readiness of the BS U15 projection cohort (BAT only). Undefined when
   *  not computed. */
  projectedReady?: { ready: boolean; have: number; total: number };
```

And add `projectedReady` to the destructured props in the component signature. Do not render anything yet.

- [ ] **Step 8: Run full suite + typecheck**

Run: `npx jest && npx tsc --noEmit`
Expected: PASS, no type errors. (`page.tsx` is `force-dynamic`; the new await is a cheap stat of ≤50 files.)

- [ ] **Step 9: Commit**

```bash
git add app/api/ranking/projected/route.ts lib/ranking/projection-context.ts app/leaderboards/page.tsx components/LeaderboardsView.tsx __tests__/api-ranking-projected-route.test.ts
git commit -m "feat(ranking): projected board route + SSR readiness flag"
```

---

### Task 7: UI — checkbox + dual official|projected columns

Render the beta checkbox on the BS U15 board (`ranking-u15_ms`), disabled until ready; on toggle, fetch the projected route and render the dual columns.

**Files:**
- Modify: `components/LeaderboardsView.tsx`
- Modify: `app/globals.css` (or the existing leaderboard stylesheet — grep for `lb-row-ranking` to find it)
- Test: `__tests__/LeaderboardsView.test.tsx` (extend)

**Interfaces:**
- Consumes: `projectedReady` prop (Task 6); `GET /api/ranking/projected` returning `{ ready, have, total }` | `{ ready, publishDate, entries }`.
- Produces: no new exports (component-internal state).

- [ ] **Step 1: Write the failing component test**

Extend `__tests__/LeaderboardsView.test.tsx` with a block that renders the view with a `ranking-u15_ms` board and asserts the checkbox state. Match the existing test's render helpers/imports in that file.

```typescript
// add inside __tests__/LeaderboardsView.test.tsx
import { render, screen } from '@testing-library/react'
import LeaderboardsView from '@/components/LeaderboardsView'

function u15Board() {
  return {
    id: 'ranking-u15_ms', titleKey: 'U15 Boys singles', icon: '🏸', category: 'ranking',
    entries: [{ rank: 1, slug: 'p0', name: 'P0', primaryClub: 'C', value: 1000, display: '1,000 pts', previousRank: 1 }],
  }
}
function lb() {
  return [{ version: 1, provider: 'bat', generatedAt: 'now', sourceVersion: '', boards: [u15Board()] }]
}

describe('Projected Ranking (beta) checkbox', () => {
  it('is disabled with progress text when not ready', () => {
    render(<LeaderboardsView leaderboards={lb() as any}
      rankingPublishDates={{ bat: '23/6/2569' }}
      projectedReady={{ ready: false, have: 12, total: 50 }} />)
    const cb = screen.getByLabelText(/Projected Ranking/i) as HTMLInputElement
    expect(cb.disabled).toBe(true)
    expect(screen.getByText(/12\/50/)).toBeInTheDocument()
  })

  it('is enabled when ready', () => {
    render(<LeaderboardsView leaderboards={lb() as any}
      rankingPublishDates={{ bat: '23/6/2569' }}
      projectedReady={{ ready: true, have: 50, total: 50 }} />)
    const cb = screen.getByLabelText(/Projected Ranking/i) as HTMLInputElement
    expect(cb.disabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest __tests__/LeaderboardsView.test.tsx -t "Projected Ranking"`
Expected: FAIL (no checkbox rendered).

- [ ] **Step 3: Add projected state + the checkbox**

In `components/LeaderboardsView.tsx`, add component state near the other `useState`s:

```typescript
const [projectedOn, setProjectedOn] = useState(false)
const [projectedData, setProjectedData] = useState<
  { ready: true; publishDate: string; entries: ProjectedEntry[] } | null
>(null)
const [projectedLoading, setProjectedLoading] = useState(false)
```

Add the `ProjectedEntry` type import (from `@/lib/ranking/projection-board`) or declare a local matching interface. Add a helper to detect the pilot board:

```typescript
const isU15RankingBoard = (b: { id: string }) => b.id === 'ranking-u15_ms'
```

When rendering a board whose `id === 'ranking-u15_ms'` and `activeProvider === 'bat'`, render the checkbox in its header (near the title / the existing `b.category !== 'ranking'` block):

```tsx
{isU15RankingBoard(b) && activeProvider === 'bat' && projectedReady && (
  <label className="lb-projected-toggle">
    <input
      type="checkbox"
      checked={projectedOn}
      disabled={!projectedReady.ready}
      onChange={async (e) => {
        const on = e.target.checked
        setProjectedOn(on)
        if (on && !projectedData) {
          setProjectedLoading(true)
          try {
            const r = await fetch(`/api/ranking/projected?provider=bat`)
            const j = await r.json()
            if (j.ready) setProjectedData(j)
          } finally { setProjectedLoading(false) }
        }
      }}
    />
    Projected Ranking (beta)
    {!projectedReady.ready && (
      <span className="lb-projected-progress">
        {' '}backfill in progress ({projectedReady.have}/{projectedReady.total})
      </span>
    )}
  </label>
)}
```

- [ ] **Step 4: Run the checkbox tests**

Run: `npx jest __tests__/LeaderboardsView.test.tsx -t "Projected Ranking"`
Expected: PASS (both cases).

- [ ] **Step 5: Render the dual columns when projected data is present**

For the `ranking-u15_ms` board, when `projectedOn && projectedData`, render the projected rows instead of the default board rows. Add a render branch where the board's entries are mapped:

```tsx
{isU15RankingBoard(b) && projectedOn && projectedData ? (
  <table className="lb-projected-table">
    <thead>
      <tr><th></th><th colSpan={2}>Official</th><th colSpan={2}>Projected</th><th>Δ</th></tr>
      <tr><th>Player</th><th>Rank</th><th>Pts</th><th>Rank</th><th>Pts</th><th></th></tr>
    </thead>
    <tbody>
      {projectedData.entries.map((e) => (
        <tr key={e.slug}>
          <td>{e.name}</td>
          <td>{e.officialRank}</td>
          <td>{e.officialPoints.toLocaleString()}</td>
          <td>{e.projectedRank}</td>
          <td>{e.projectedPoints.toLocaleString()}</td>
          <td>{e.delta === 0
            ? '—'
            : e.delta > 0
              ? <span className="lb-rk-delta-up">▲{e.delta}</span>
              : <span className="lb-rk-delta-down">▼{-e.delta}</span>}</td>
        </tr>
      ))}
    </tbody>
  </table>
) : (
  /* existing board rows rendering for this board */
)}
```

> Wire this into the existing per-board render block (around the `b.entries.map(...)` at `components/LeaderboardsView.tsx`). Keep the existing rendering as the `else` branch so all other boards are unaffected. Reuse the existing `lb-rk-delta-up` / `lb-rk-delta-down` classes (already styled).

- [ ] **Step 6: Add minimal styles + the beta caveat tooltip**

In the leaderboard stylesheet, add:

```css
.lb-projected-toggle { display: inline-flex; align-items: center; gap: .4rem; font-size: .85em; }
.lb-projected-progress { opacity: .65; }
.lb-projected-table { width: 100%; border-collapse: collapse; }
.lb-projected-table th, .lb-projected-table td { padding: .25rem .5rem; text-align: right; }
.lb-projected-table td:first-child, .lb-projected-table th:first-child { text-align: left; }
```

Add a `title=` attribute on the label carrying the beta caveats (from spec §8): "Projection of next week's publication. Top-50 only — Δ is movement within this group. Excludes tournaments BAT counts but we haven't ingested. Right after a publish the projection nearly matches official and diverges through the week."

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npx jest && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add components/LeaderboardsView.tsx __tests__/LeaderboardsView.test.tsx app/globals.css
git commit -m "feat(ranking): BS U15 Projected Ranking (beta) checkbox + dual columns"
```

---

## Manual verification (after Task 7)

1. Ensure a BAT ranking is cached locally (`.cache/players/ranking-bat.json`).
2. Set `PLAYERS_REBUILD_TOKEN` in the env, then trigger the backfill: `npx tsx scripts/backfill-u15.ts` (or `GET /api/ranking/backfill-u15?token=...`). Watch ~50 fetches over ~2 min; the response ends with `ready: true`.
3. `npm run dev`, open `/leaderboards`, BAT provider, ranking tab, BS U15 board. The "Projected Ranking (beta)" checkbox should be enabled. Toggle it → dual Official|Projected columns with Δ arrows.
4. Spot-check one player against their profile's per-event points to confirm the projected total is sane.

---

## Self-Review (completed during planning)

- **Spec coverage:** §2 data model → Tasks 4/5; §3 rules 1&2 → Task 2 (tests name both); §4 engine → Tasks 2+5; §5 backfill → Task 3; §6 trigger → Task 4; §7 route+SSR readiness → Task 6; §8 UI → Task 7; §9 error handling → Task 3 (failures/breaker), Task 6 (ready gate); §10 testing → each task's tests; §11 out-of-scope respected (no scheduler/lease, cohort-50, no new entrants).
- **Type consistency:** `ProjectionRow`, `AddCtx`, `CohortPlayer`, `ProjectedEntry` defined once and consumed with matching shapes; `fetchAndCacheDetail`/`projectPlayer`/`runDetailBackfill`/`loadCohort`/`assembleProjectedBoard` signatures match across tasks.
- **Known fuzziness (accepted for pilot):** add-side dedup keys on `(week, discipline, age)` not exact tournament identity — a player playing two different same-age singles events in one ISO week is treated as already-counted (rare). Surfaced in the dual UI.
- **Verified bridges:** ranking-cache test hook + path (Task 4); `isExpiringNextWeek` polarity (drops `week ≤ cutoff`, Task 2); tournament names via `listAllTournaments()` not `resolveRef` (Task 6); index keyed by slug with a `discipline` field on each event (Task 5); the §2.2 reconstruction → 31,336 anchors the engine.

# Live Profile & Leaderboard Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make player profiles and leaderboards reflect *completed matches inside in-progress tournaments*, refreshed on the existing ~15-minute discovery tick.

**Architecture:** Feed active (not-yet-pinned) tournaments' resolved matches into the same `rebuildAll` player-index path that already powers profiles and leaderboards. A new resolved-match guard in the aggregator prevents unplayed matches from being scored. The active-tournament schedule is captured from the fetch the discovery tick *already* performs (no new scraping), passed into `rebuildAll`, and the tick fires whenever an active tournament exists. The existing `sourceVersion` gate keeps rebuilds a no-op when nothing changed.

**Tech Stack:** TypeScript, Next.js 14 (app router), Jest. Tests run with `npx jest`; typecheck with `npx tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-05-28-live-profile-leaderboard-updates-design.md`

---

## File Structure

- **Modify** `lib/playerIndex.ts` — add `isResolvedMatch` helper (exported) and guard the aggregation loop so only resolved matches are counted.
- **Modify** `lib/matches-full-cache.ts` — `ensureFullCachePersisted` returns `{ status, data }`; `prewarmMatchesFullCache` returns `{ newlyPinned, activeData }`.
- **Modify** `lib/player-index-rebuild.ts` — accept `activeData`, ingest active tournaments, merge live current-day groups, skip zero-resolved, fold resolved-count into `sourceVersion`.
- **Modify** `instrumentation.ts` — capture `activeData` at boot and on the tick; fire rebuild when active tournaments exist.
- **Modify** `app/api/players/rebuild/route.ts` — prewarm first, pass `activeData`.
- **Tests:** new `__tests__/playerIndex.unresolved.test.ts`; extend `__tests__/matches-full-cache.test.ts` and `__tests__/player-index-rebuild.test.ts`.

---

## Task 1: Resolved-match guard in the aggregator

This is the safety-critical change. `matchOutcome` scores a `winner === null` match as a loss for *both* sides; once active tournaments are ingested, every unplayed match would corrupt two players' records. Guard the loop so only resolved matches (`winner !== null || walkover || retired`) are counted.

**Files:**
- Modify: `lib/playerIndex.ts` (helper near `matchOutcome` at line 207; loop at lines 304-313)
- Test: `__tests__/playerIndex.unresolved.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/playerIndex.unresolved.test.ts`:

```typescript
import { buildIndex } from '@/lib/playerIndex'
import type { MatchEntry, MatchesData, PlayerIndexTournamentInput } from '@/lib/types'

const resolved: MatchEntry = {
  draw: 'MS', drawNum: '1', round: 'QF',
  team1: [{ name: 'Alice', playerId: 'a' }],
  team2: [{ name: 'Bob', playerId: 'b' }],
  winner: 1, scores: [{ t1: 21, t2: 10 }],
  court: '1', walkover: false, retired: false, nowPlaying: false,
}
const unplayed: MatchEntry = {
  draw: 'MS', drawNum: '1', round: 'SF',
  team1: [{ name: 'Carol', playerId: 'c' }],
  team2: [{ name: 'Dave', playerId: 'd' }],
  winner: null, scores: [],
  court: '2', walkover: false, retired: false, nowPlaying: false,
}

function input(matches: MatchEntry[]): PlayerIndexTournamentInput {
  const data: MatchesData = {
    days: [{ date: '2569-05-28', label: 'Day 1', dateIso: '2026-05-28' }],
    currentDate: '2569-05-28',
    groups: [{ type: 'time', time: '09:00', matches }],
  }
  return { tournamentId: 'LIVE', tournamentName: 'Live Cup', tournamentDateIso: '2026-05-28', data, clubs: {} }
}

describe('buildIndex — unresolved matches', () => {
  it('counts only resolved matches in totalMatches', () => {
    const { index } = buildIndex('bat', [input([resolved, unplayed])])
    expect(index.totalMatches).toBe(1)
  })

  it('does not create records for players in an unplayed match', () => {
    const { index } = buildIndex('bat', [input([resolved, unplayed])])
    expect(index.players['carol']).toBeUndefined()
    expect(index.players['dave']).toBeUndefined()
  })

  it('still records the resolved match as a win/loss', () => {
    const { index } = buildIndex('bat', [input([resolved, unplayed])])
    expect(index.players['alice'].totals.wins).toBe(1)
    expect(index.players['alice'].totals.losses).toBe(0)
    expect(index.players['bob'].totals.losses).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest playerIndex.unresolved -t "unplayed match" --silent`
Expected: FAIL — `carol`/`dave` records exist with a loss each (the bug this guard fixes), so `expect(index.players['carol']).toBeUndefined()` fails.

- [ ] **Step 3: Add the `isResolvedMatch` helper**

In `lib/playerIndex.ts`, immediately after `matchOutcome` (ends at line 212), add:

```typescript
// A match counts toward the index only once it has a result: a winner, a
// walkover, or a retirement. Mirrors the per-match predicate in
// day-cache.ts `isDayComplete`. Lets the aggregator ingest in-progress
// tournaments without scoring their not-yet-played matches as losses.
export function isResolvedMatch(m: MatchEntry): boolean {
  return m.winner !== null || m.walkover || m.retired
}
```

- [ ] **Step 4: Guard the aggregation loop**

In `lib/playerIndex.ts`, the loop at lines 304-313 currently reads:

```typescript
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
```

Replace the inner body so unresolved matches are skipped before any counting:

```typescript
  for (const t of tournaments) {
    const groups = t.data.groups || []
    for (const g of groups) {
      for (const m of (g.matches || [])) {
        if (!isResolvedMatch(m)) continue
        totalMatches++
        registerSide(m, 1, t)
        registerSide(m, 2, t)
      }
    }
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest playerIndex.unresolved --silent`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full aggregator suite to confirm no regression**

Run: `npx jest playerIndex --silent`
Expected: PASS — the existing fixtures contain only resolved matches, so totals are unchanged.

- [ ] **Step 7: Commit**

```bash
git add lib/playerIndex.ts __tests__/playerIndex.unresolved.test.ts
git commit -m "feat(player-index): skip unresolved matches in aggregation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Capture the active-tournament fetch

`prewarmMatchesFullCache` already fetches every active tournament's schedule each tick, then discards it. Return that data so the rebuild can consume it without a second scrape.

**Files:**
- Modify: `lib/matches-full-cache.ts`
- Test: `__tests__/matches-full-cache.test.ts` (modify)

- [ ] **Step 1: Update the existing tests to the new return shapes**

In `__tests__/matches-full-cache.test.ts`, replace the three `ensureFullCachePersisted` tests (lines 34-58) with:

```typescript
  describe('ensureFullCachePersisted', () => {
    it("returns 'cached' with the disk data when a disk cache already exists", async () => {
      ;(readFullCache as jest.Mock).mockResolvedValue({ days: [] })
      const { status, data } = await ensureFullCachePersisted('ABC', '2026-05-27')
      expect(status).toBe('cached')
      expect(data).toEqual({ days: [] })
      expect(batFetch).not.toHaveBeenCalled()
      expect(writeFullCache).not.toHaveBeenCalled()
    })

    it("returns 'pinned' and writes the cache when the tournament is all-past", async () => {
      ;(readFullCache as jest.Mock).mockResolvedValue(null)
      ;(isAllPast as jest.Mock).mockReturnValue(true)
      const { status } = await ensureFullCachePersisted('ABC', '2026-05-27')
      expect(status).toBe('pinned')
      expect(writeFullCache).toHaveBeenCalledTimes(1)
    })

    it("returns 'active' with the parsed data when a match-day is not yet past", async () => {
      ;(readFullCache as jest.Mock).mockResolvedValue(null)
      ;(isAllPast as jest.Mock).mockReturnValue(false)
      const { status, data } = await ensureFullCachePersisted('ABC', '2026-05-27')
      expect(status).toBe('active')
      expect(data).not.toBeNull()
      expect(writeFullCache).not.toHaveBeenCalled()
    })
  })
```

Then replace the two `prewarmMatchesFullCache` tests (lines 60-98) with:

```typescript
  describe('prewarmMatchesFullCache', () => {
    it('returns newly-pinned ids and the active-tournament schedules', async () => {
      ;(listAllTournaments as jest.Mock).mockReturnValue([
        { id: 'CACHED', provider: 'bat' }, // already on disk → cached
        { id: 'DONE', provider: 'bat' },   // just became all-past → pinned
        { id: 'ACTIVE', provider: 'bat' }, // still running → active
      ])
      ;(loadDiscovered as jest.Mock).mockResolvedValue({
        version: 1,
        entries: [{ id: 'disc-done', hasBracket: true }],
      })
      ;(readFullCache as jest.Mock).mockImplementation(async (id: string) =>
        id === 'CACHED' ? { days: [] } : null,
      )
      ;(isAllPast as jest.Mock).mockImplementation((data: { html: string }) =>
        data.html.includes('/DONE/') || data.html.includes('/DISC-DONE/'),
      )

      const { newlyPinned, activeData } = await prewarmMatchesFullCache()

      expect(newlyPinned).toEqual(['DONE', 'DISC-DONE'])
      expect(Array.from(activeData.keys())).toEqual(['ACTIVE'])
      expect(writeFullCache).toHaveBeenCalledTimes(2)
      const fetchedUrls = (batFetch as jest.Mock).mock.calls.map((c) => c[1] as string)
      expect(fetchedUrls.some((u) => u.includes('/CACHED/'))).toBe(false)
    })

    it('returns empty results when nothing newly completes and nothing is active', async () => {
      ;(listAllTournaments as jest.Mock).mockReturnValue([{ id: 'CACHED', provider: 'bat' }])
      ;(loadDiscovered as jest.Mock).mockResolvedValue({ version: 1, entries: [] })
      ;(readFullCache as jest.Mock).mockResolvedValue({ days: [] })

      const { newlyPinned, activeData } = await prewarmMatchesFullCache()
      expect(newlyPinned).toEqual([])
      expect(activeData.size).toBe(0)
      expect(writeFullCache).not.toHaveBeenCalled()
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest matches-full-cache --silent`
Expected: FAIL — `ensureFullCachePersisted` still returns a bare string and `prewarmMatchesFullCache` returns an array, so destructuring `{ status }` / `{ newlyPinned, activeData }` yields `undefined`.

- [ ] **Step 3: Change `ensureFullCachePersisted` to return status + data**

In `lib/matches-full-cache.ts`, add the `MatchesData` type import at the top (after the existing imports):

```typescript
import type { MatchesData } from './types'
```

Replace the function (lines 25-45) with:

```typescript
export async function ensureFullCachePersisted(
  tournamentId: string,
  todayIso: string,
): Promise<{ status: FullCacheStatus; data: MatchesData | null }> {
  const existing = await readFullCache(tournamentId)
  if (existing) return { status: 'cached', data: existing }
  const ref = resolveRef(tournamentId) ?? { id: tournamentId.toUpperCase(), provider: 'bat' as const }
  let data
  if (ref.provider !== 'bat') {
    data = await providerFor(ref).getMatchesFull(ref)
  } else {
    const url = `https://bat.tournamentsoftware.com/tournament/${tournamentId}/matches`
    const res = await batFetch('matches-full-prewarm', url, { headers: HEADERS, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data = parseMatchesFull(await res.text())
  }
  if (!data) return { status: 'active', data: null }
  await persistMetaIfChanged(tournamentId, data)
  if (!isAllPast(data, todayIso)) return { status: 'active', data }
  await writeFullCache(tournamentId, data)
  return { status: 'pinned', data }
}
```

- [ ] **Step 4: Change `prewarmMatchesFullCache` to collect active data**

In `lib/matches-full-cache.ts`, replace the function (lines 52-72) with:

```typescript
export async function prewarmMatchesFullCache(): Promise<{
  newlyPinned: string[]
  activeData: Map<string, MatchesData>
}> {
  const todayIso = getTodayIso()
  const ids = new Set<string>()
  for (const ref of listAllTournaments()) ids.add(ref.id)
  const discovered = await loadDiscovered()
  for (const e of discovered.entries) {
    if (e.hasBracket) ids.add(e.id.toUpperCase())
  }
  const newlyPinned: string[] = []
  const activeData = new Map<string, MatchesData>()
  for (const id of Array.from(ids)) {
    try {
      const { status, data } = await ensureFullCachePersisted(id, todayIso)
      if (status === 'pinned') newlyPinned.push(id)
      if (status === 'active' && data) activeData.set(id.toUpperCase(), data)
      const label = status === 'cached' ? '(cached)' : status === 'pinned' ? '(newly pinned)' : '(active)'
      console.log(`[matches-full-cache] pre-warmed: ${id} ${label}`)
    } catch (err) {
      console.warn(`[matches-full-cache] failed to pre-warm ${id}:`, err)
    }
  }
  return { newlyPinned, activeData }
}
```

Note: the docstring comment above the function (lines 47-51) still describes the return — update its last sentence to: "Returns the ids newly pinned this call plus the in-memory schedules of every still-active tournament, so callers can rebuild the player index from both."

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest matches-full-cache --silent`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/matches-full-cache.ts __tests__/matches-full-cache.test.ts
git commit -m "feat(matches-cache): return active-tournament schedules from prewarm

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Ingest active tournaments in the rebuild

`rebuildAll` gains an optional `activeData` map. A tournament is usable if it has a pinned full cache **or** appears in `activeData`. For an active one: past days from pinned day caches (or `ensureDay`), the current day from the live in-memory groups, future days skipped. Active tournaments with zero resolved matches are skipped, and the resolved-match count is folded into `sourceVersion`.

**Files:**
- Modify: `lib/player-index-rebuild.ts`
- Test: `__tests__/player-index-rebuild.test.ts` (modify)

- [ ] **Step 1: Write the failing tests**

In `__tests__/player-index-rebuild.test.ts`, the day-cache mock at line 7 currently is:

```typescript
jest.mock('../lib/day-cache', () => ({ readFullCache: jest.fn(), readDayCache: jest.fn() }))
```

Add a `today` mock immediately after it:

```typescript
jest.mock('../lib/today', () => ({ getTodayIso: jest.fn(() => '2026-05-28') }))
```

Then add this `describe` block at the end of the file, before the final closing of the outer `describe('rebuildAll', ...)`:

```typescript
  describe('active tournaments via activeData', () => {
    const liveDay = { date: '2569-05-28', label: 'Day 1', dateIso: '2026-05-28' }
    const resolved = {
      draw: 'MS', drawNum: '1', round: 'QF',
      team1: [{ name: 'Alice', playerId: 'a' }],
      team2: [{ name: 'Bob', playerId: 'b' }],
      winner: 1, scores: [{ t1: 21, t2: 10 }],
      court: '1', walkover: false, retired: false, nowPlaying: false,
    }
    const unplayed = { ...resolved, round: 'SF', winner: null, scores: [], team1: [{ name: 'Carol', playerId: 'c' }], team2: [{ name: 'Dave', playerId: 'd' }] }

    function liveData(matches: unknown[]) {
      return new Map([['LIVE', {
        days: [liveDay], currentDate: '2569-05-28',
        groups: [{ type: 'time', time: '09:00', matches }],
      }]])
    }

    it('builds an active tournament supplied only via activeData', async () => {
      ;(listAllTournaments as jest.Mock).mockReturnValue([{ id: 'LIVE', provider: 'bat', done: false }])
      ;(readFullCache as jest.Mock).mockResolvedValue(null) // not pinned
      const out = await rebuildAll({ activeData: liveData([resolved]) as never })
      expect(out.rebuilt).toContain('bat')
      expect(writeIndexCache).toHaveBeenCalled()
    })

    it('skips an active tournament with no resolved matches', async () => {
      ;(listAllTournaments as jest.Mock).mockReturnValue([{ id: 'LIVE', provider: 'bat', done: false }])
      ;(readFullCache as jest.Mock).mockResolvedValue(null)
      const out = await rebuildAll({ activeData: liveData([unplayed]) as never })
      expect(out.skipped).toContain('bat')
      expect(writeIndexCache).not.toHaveBeenCalled()
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest player-index-rebuild -t "activeData" --silent`
Expected: FAIL — `readFullCache` returns null so the current code `continue`s past `LIVE`, leaving `bat` in `skipped` and `writeIndexCache` uncalled; the first test's `expect(out.rebuilt).toContain('bat')` fails.

- [ ] **Step 3: Import the helpers in the rebuild module**

In `lib/player-index-rebuild.ts`, add to the imports near the top:

```typescript
import { getTodayIso } from '@/lib/today'
import { isResolvedMatch } from '@/lib/playerIndex'
```

(`buildIndex` is already imported from `@/lib/playerIndex` on line 11 — add `isResolvedMatch` to that import or add a separate line; either is fine.)

- [ ] **Step 4: Add `activeData` to the options type**

In `lib/player-index-rebuild.ts`, change the `rebuildAll` signature (line 38) from:

```typescript
export async function rebuildAll(opts?: { ensureDay?: EnsureDay }): Promise<{ rebuilt: ProviderTag[]; skipped: ProviderTag[] }> {
```

to:

```typescript
export async function rebuildAll(opts?: { ensureDay?: EnsureDay; activeData?: Map<string, MatchesData> }): Promise<{ rebuilt: ProviderTag[]; skipped: ProviderTag[] }> {
```

- [ ] **Step 5: Ingest active tournaments and merge live current-day groups**

In `lib/player-index-rebuild.ts`, the candidate loop body begins (lines 64-66):

```typescript
        const inputs: PlayerIndexTournamentInput[] = []
        for (const entry of Array.from(candidates.values())) {
          const full = await readFullCache(entry.id)
          if (!full) continue
```

Replace those three lines (the `const full` read and its guard) with:

```typescript
        const inputs: PlayerIndexTournamentInput[] = []
        const todayIso = getTodayIso()
        for (const entry of Array.from(candidates.values())) {
          const pinned = await readFullCache(entry.id)
          const active = pinned ? undefined : opts?.activeData?.get(entry.id.toUpperCase())
          const full = pinned ?? active
          if (!full) continue
          const isActive = !pinned
```

Then the day-walk loop (currently lines 91-102) reads:

```typescript
          const allGroups: MatchScheduleGroup[] = []
          for (const d of full.days || []) {
            if (!d.dateIso) continue
            const day = await readDayCache(entry.id, d.dateIso)
            if (day?.groups) { allGroups.push(...stamp(day.groups, d.dateIso)); continue }
            // Day not pinned yet (fresh server): fetch through the matches route,
            // which pins it for next time. No-op when no fetcher is supplied.
            if (opts?.ensureDay && d.date) {
              const groups = await opts.ensureDay(entry.id, d.date)
              if (groups) allGroups.push(...stamp(groups, d.dateIso))
            }
          }
```

Replace it with (adds the future-day skip and the live current-day branch for active tournaments):

```typescript
          const allGroups: MatchScheduleGroup[] = []
          for (const d of full.days || []) {
            if (!d.dateIso) continue
            // Active tournament: future days carry no results — skip the fetch.
            if (isActive && d.dateIso > todayIso) continue
            // Active tournament's live day: use the in-memory groups captured by
            // the prewarm fetch instead of re-fetching the same day.
            if (isActive && d.date === full.currentDate) {
              allGroups.push(...stamp(full.groups || [], d.dateIso))
              continue
            }
            const day = await readDayCache(entry.id, d.dateIso)
            if (day?.groups) { allGroups.push(...stamp(day.groups, d.dateIso)); continue }
            // Day not pinned yet (fresh server): fetch through the matches route,
            // which pins it for next time. No-op when no fetcher is supplied.
            if (opts?.ensureDay && d.date) {
              const groups = await opts.ensureDay(entry.id, d.date)
              if (groups) allGroups.push(...stamp(groups, d.dateIso))
            }
          }
```

- [ ] **Step 6: Skip active tournaments with no resolved matches**

In `lib/player-index-rebuild.ts`, immediately after `const mergedData: MatchesData = { ...full, groups: allGroups }` (currently line 107), add:

```typescript
          // An active tournament that has started its schedule but played no
          // matches yet contributes nothing — don't let it churn the index.
          if (isActive && !mergedData.groups.some(g => g.matches.some(isResolvedMatch))) continue
```

- [ ] **Step 7: Fold the resolved-match count into the source version**

In `lib/player-index-rebuild.ts`, `computeSourceVersion` (lines 188-194) currently reads:

```typescript
function computeSourceVersion(inputs: PlayerIndexTournamentInput[]): string {
  const sig = [...inputs]
    .sort((a, b) => a.tournamentId.localeCompare(b.tournamentId))
    .map(i => `${i.tournamentId}:${JSON.stringify(i.data).length}:${Object.keys(i.clubs).length}`)
    .join('|')
  return createHash('sha256').update(`v${SCHEMA_VERSION}|${sig}`).digest('hex')
}
```

Replace with:

```typescript
function computeSourceVersion(inputs: PlayerIndexTournamentInput[]): string {
  const sig = [...inputs]
    .sort((a, b) => a.tournamentId.localeCompare(b.tournamentId))
    .map(i => {
      // Count resolved matches so a winner-flip that preserves the JSON length
      // (e.g. a live result that didn't add characters) still bumps the version.
      let resolved = 0
      for (const g of i.data.groups || []) for (const m of g.matches || []) if (isResolvedMatch(m)) resolved++
      return `${i.tournamentId}:${JSON.stringify(i.data).length}:${Object.keys(i.clubs).length}:${resolved}`
    })
    .join('|')
  return createHash('sha256').update(`v${SCHEMA_VERSION}|${sig}`).digest('hex')
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx jest player-index-rebuild --silent`
Expected: PASS — both new `activeData` tests pass and the existing rebuild tests still pass (the pinned path is unchanged; `isActive` is false for them).

- [ ] **Step 9: Commit**

```bash
git add lib/player-index-rebuild.ts __tests__/player-index-rebuild.test.ts
git commit -m "feat(player-index): ingest in-progress tournaments into rebuild

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Fire the rebuild when active tournaments exist

Wire the new return shape through `instrumentation.ts`: capture `activeData` at boot and on the discovery tick, and rebuild when something newly pinned *or* any active tournament exists.

**Files:**
- Modify: `instrumentation.ts`

(No unit test — `instrumentation.ts` is a Next.js runtime hook with no test harness. Verified via typecheck and the full suite.)

- [ ] **Step 1: Capture activeData at boot**

In `instrumentation.ts`, the boot IIFE currently calls `await prewarmMatchesFullCache()` on line 18 (return ignored) and rebuilds on line 30. Change line 18 from:

```typescript
      await prewarmMatchesFullCache()
```

to:

```typescript
      const { activeData: bootActiveData } = await prewarmMatchesFullCache()
```

Then change the boot rebuild call (line 30) from:

```typescript
        const result = await rebuildAll({ ensureDay: makeOriginDayFetcher(origin) })
```

to:

```typescript
        const result = await rebuildAll({ ensureDay: makeOriginDayFetcher(origin), activeData: bootActiveData })
```

- [ ] **Step 2: Update the discovery tick gate**

In `instrumentation.ts`, the tick body (lines 77-82) currently reads:

```typescript
          const newlyPinned = await prewarmMatchesFullCache()
          if (newlyPinned.length > 0) {
            console.log(`[auto-rebuild] tournaments completed: ${newlyPinned.join(', ')}`)
            const result = await rebuildAll({ ensureDay: makeOriginDayFetcher(origin) })
            console.log(`[auto-rebuild] player index rebuilt: ${JSON.stringify(result)}`)
          }
```

Replace with:

```typescript
          const { newlyPinned, activeData } = await prewarmMatchesFullCache()
          if (newlyPinned.length > 0 || activeData.size > 0) {
            if (newlyPinned.length > 0) {
              console.log(`[auto-rebuild] tournaments completed: ${newlyPinned.join(', ')}`)
            }
            const result = await rebuildAll({ ensureDay: makeOriginDayFetcher(origin), activeData })
            console.log(`[auto-rebuild] player index rebuilt: ${JSON.stringify(result)}`)
          }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add instrumentation.ts
git commit -m "feat(instrumentation): rebuild player index while tournaments are active

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Manual rebuild route picks up active tournaments

`POST /api/players/rebuild` should also reflect in-progress events: prewarm first, then pass `activeData` into `rebuildAll`.

**Files:**
- Modify: `app/api/players/rebuild/route.ts`

- [ ] **Step 1: Update the route**

Replace the body of `app/api/players/rebuild/route.ts` with:

```typescript
import { NextResponse } from 'next/server'
import { rebuildAll, makeOriginDayFetcher } from '@/lib/player-index-rebuild'
import { prewarmMatchesFullCache } from '@/lib/matches-full-cache'

export const maxDuration = 60

export async function POST(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.PLAYERS_REBUILD_TOKEN || ''}`
  if (!process.env.PLAYERS_REBUILD_TOKEN || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const origin = new URL(req.url).origin
  const { activeData } = await prewarmMatchesFullCache()
  const result = await rebuildAll({ ensureDay: makeOriginDayFetcher(origin), activeData })
  return NextResponse.json(result)
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/players/rebuild/route.ts
git commit -m "feat(api): manual player-index rebuild includes active tournaments

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the entire test suite**

Run: `npx jest --silent`
Expected: PASS — all suites green.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx next lint`
Expected: no new errors in the modified files.

- [ ] **Step 4: Final confirmation**

Confirm each of these holds before declaring done:
- Aggregator skips unresolved matches (Task 1 tests pass).
- `prewarmMatchesFullCache` returns `{ newlyPinned, activeData }` (Task 2 tests pass).
- `rebuildAll` ingests a tournament supplied only via `activeData` and skips zero-resolved ones (Task 3 tests pass).
- `instrumentation.ts` and the manual route compile and pass `tsc` (Tasks 4-5).
- Full suite + typecheck green (Steps 1-2).
```

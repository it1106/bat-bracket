# Ranking week-over-week delta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an inline up/down arrow with magnitude next to each rank on the BAT and BWF ranking leaderboards, and a "NEW" badge for entries the prior week's snapshot didn't include.

**Architecture:** Bake an optional `previousRank` field into each cached `RankingEntry` at refresh time by diffing against the existing cache file before overwriting it. The leaderboards page passes the field through to a small renderer addition inside `LeaderboardsView`. No new on-disk artifacts; legacy caches without the field render no arrow until the next weekly publication repopulates.

**Tech Stack:** Next.js 14 App Router (TypeScript), Jest + Testing Library (jsdom for component tests), plain CSS variables in `app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-06-09-ranking-week-over-week-delta-design.md`

---

## File Structure

**Create:**
- `lib/ranking/previous-rank.ts` — pure helper `mergePreviousRanks(prev, next): RankingEvent[]` that diffs the old cache against new events and stamps `previousRank` on each new entry. Pure so it's unit-testable without filesystem or HTTP.
- `__tests__/ranking-previous-rank.test.ts` — tests for the helper.

**Modify:**
- `lib/types.ts` — add optional `previousRank?: number` to `RankingEntry` and `LeaderboardEntry`.
- `app/api/ranking/[provider]/refresh/route.ts` — read the existing cache, call `mergePreviousRanks` on the new events, write the merged result.
- `app/leaderboards/page.tsx` — pass `previousRank` through `rankingEventToBoard`.
- `components/LeaderboardsView.tsx` — render the delta badge inside the existing `lb-rk` cell on ranking-category rows.
- `app/globals.css` — add three new classes (`lb-rk-delta-up`, `lb-rk-delta-down`, `lb-rk-delta-new`) near the existing `.lb-rk` rules.
- `__tests__/LeaderboardsView.test.tsx` — add a `describe('ranking delta badge', ...)` block.

---

## Task 1: Add `previousRank` field to types

**Why first:** Every subsequent task references the field. Adding it now makes the later helper + renderer code type-check on first try.

**Files:**
- Modify: `lib/types.ts:633-650` (`RankingEntry`)
- Modify: `lib/types.ts:599-612` (`LeaderboardEntry`)

- [ ] **Step 1: Add the field to `RankingEntry`**

In `lib/types.ts`, locate the `RankingEntry` interface (around line 633). After the existing `countryFlagUrl?` field, add:

```ts
  /** This player's rank in the immediately previous weekly publication for
   *  the same event/provider. Absent when the player wasn't in the prior
   *  snapshot (genuinely new entrant, or first-ever scrape). */
  previousRank?: number
```

- [ ] **Step 2: Add the field to `LeaderboardEntry`**

In the same file, locate `LeaderboardEntry` (around line 599). After the existing `flagUrl?` field, add:

```ts
  /** Mirrors RankingEntry.previousRank. Populated only on ranking-category
   *  entries; other categories ignore it. */
  previousRank?: number
```

- [ ] **Step 3: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: No errors. (The field is optional, so no existing call sites break.)

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add optional previousRank on RankingEntry and LeaderboardEntry"
```

---

## Task 2: Create the `mergePreviousRanks` pure helper

**Why a separate module:** Pure functions are trivially unit-testable. The refresh route handler is awkward to test (filesystem, fetch, side effects), so the logic lives outside it.

**Files:**
- Create: `lib/ranking/previous-rank.ts`
- Test: `__tests__/ranking-previous-rank.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/ranking-previous-rank.test.ts`:

```ts
import { mergePreviousRanks } from '@/lib/ranking/previous-rank'
import type { Ranking, RankingEvent } from '@/lib/types'

const ranking = (publishDate: string, events: RankingEvent[]): Ranking => ({
  provider: 'bat',
  scrapedAt: '2026-06-09T10:00:00Z',
  publishDate,
  rankingId: '51771',
  events,
})

const ev = (eventCode: string, entries: Array<{ rank: number; slug: string; previousRank?: number }>): RankingEvent => ({
  eventCode,
  eventName: eventCode,
  entries: entries.map(e => ({
    rank: e.rank, name: e.slug, slug: e.slug, club: 'C',
    points: 0, tournaments: 0,
    ...(e.previousRank !== undefined ? { previousRank: e.previousRank } : {}),
  })),
})

describe('mergePreviousRanks', () => {
  it('leaves all entries without previousRank when no prior cache exists', () => {
    const next = [ev('MS', [{ rank: 1, slug: 'a' }, { rank: 2, slug: 'b' }])]
    const merged = mergePreviousRanks(null, next, '20/5/2569')
    expect(merged[0].entries[0].previousRank).toBeUndefined()
    expect(merged[0].entries[1].previousRank).toBeUndefined()
  })

  it('stamps previousRank from the prior cache when publishDate differs', () => {
    const prev = ranking('13/5/2569', [
      ev('MS', [{ rank: 5, slug: 'a' }, { rank: 10, slug: 'b' }, { rank: 20, slug: 'c' }]),
    ])
    const next = [ev('MS', [{ rank: 3, slug: 'a' }, { rank: 10, slug: 'b' }, { rank: 8, slug: 'd' }])]
    const merged = mergePreviousRanks(prev, next, '20/5/2569')
    const byslug = Object.fromEntries(merged[0].entries.map(e => [e.slug, e.previousRank]))
    expect(byslug).toEqual({ a: 5, b: 10, d: undefined })
  })

  it('carries previousRank straight through on same-publishDate re-refresh', () => {
    const prev = ranking('20/5/2569', [
      ev('MS', [{ rank: 5, slug: 'a', previousRank: 12 }, { rank: 6, slug: 'b', previousRank: 4 }]),
    ])
    const next = [ev('MS', [{ rank: 5, slug: 'a' }, { rank: 6, slug: 'b' }])]
    const merged = mergePreviousRanks(prev, next, '20/5/2569')
    const byslug = Object.fromEntries(merged[0].entries.map(e => [e.slug, e.previousRank]))
    expect(byslug).toEqual({ a: 12, b: 4 })
  })

  it('handles a new event upstream by leaving its entries without previousRank', () => {
    const prev = ranking('13/5/2569', [ev('MS', [{ rank: 1, slug: 'a' }])])
    const next = [ev('MS', [{ rank: 1, slug: 'a' }]), ev('WS', [{ rank: 1, slug: 'z' }])]
    const merged = mergePreviousRanks(prev, next, '20/5/2569')
    expect(merged[1].entries[0].previousRank).toBeUndefined()
    expect(merged[0].entries[0].previousRank).toBe(1)
  })

  it('isolates per-event lookups (same slug in different events does not bleed)', () => {
    const prev = ranking('13/5/2569', [
      ev('MS', [{ rank: 7, slug: 'shared' }]),
      ev('WS', [{ rank: 99, slug: 'shared' }]),
    ])
    const next = [ev('MS', [{ rank: 4, slug: 'shared' }])]
    const merged = mergePreviousRanks(prev, next, '20/5/2569')
    expect(merged[0].entries[0].previousRank).toBe(7)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/ranking-previous-rank.test.ts`
Expected: FAIL with `Cannot find module '@/lib/ranking/previous-rank'`.

- [ ] **Step 3: Implement the helper**

Create `lib/ranking/previous-rank.ts`:

```ts
import type { Ranking, RankingEvent } from '@/lib/types'

/**
 * Stamp `previousRank` onto each entry in `next` by looking up the matching
 * (eventCode, slug) in `prev`. Two regimes:
 *
 *  - `prev.publishDate !== nextPublishDate` (new week): take rank from prev.
 *  - `prev.publishDate === nextPublishDate` (same-week force-refresh): copy
 *    prev's `previousRank` through, so re-refreshing inside a week doesn't
 *    wipe the genuine prior-week delta.
 *
 * Pure: returns a fresh array of events; does not mutate inputs.
 */
export function mergePreviousRanks(
  prev: Ranking | null,
  next: RankingEvent[],
  nextPublishDate: string,
): RankingEvent[] {
  if (!prev) return next.map(cloneEvent)
  const sameWeek = prev.publishDate === nextPublishDate
  const lookup = new Map<string, Map<string, number>>()
  for (const ev of prev.events) {
    const inner = new Map<string, number>()
    for (const e of ev.entries) {
      const v = sameWeek ? e.previousRank : e.rank
      if (typeof v === 'number') inner.set(e.slug, v)
    }
    lookup.set(ev.eventCode, inner)
  }
  return next.map(ev => ({
    ...ev,
    entries: ev.entries.map(e => {
      const pr = lookup.get(ev.eventCode)?.get(e.slug)
      return pr === undefined ? { ...e } : { ...e, previousRank: pr }
    }),
  }))
}

function cloneEvent(ev: RankingEvent): RankingEvent {
  return { ...ev, entries: ev.entries.map(e => ({ ...e })) }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/ranking-previous-rank.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ranking/previous-rank.ts __tests__/ranking-previous-rank.test.ts
git commit -m "feat(ranking): mergePreviousRanks helper for week-over-week deltas"
```

---

## Task 3: Wire the helper into the refresh route

**Files:**
- Modify: `app/api/ranking/[provider]/refresh/route.ts` (around lines 11 and 89)

- [ ] **Step 1: Add the import**

In `app/api/ranking/[provider]/refresh/route.ts`, find the imports near the top (around line 11). Add this import line below the existing cache import:

```ts
import { mergePreviousRanks } from '@/lib/ranking/previous-rank'
```

- [ ] **Step 2: Merge before writing**

In the same file, locate the block that writes the cache (around lines 84–91):

```ts
    // Don't overwrite a populated cache with nothing.
    if (events.length === 0) {
      console.log(`[ranking/${provider}/refresh] all categories empty; cache preserved`)
      return NextResponse.json({ error: 'no entries scraped; cache preserved' }, { status: 502 })
    }

    const scrapedAt = new Date().toISOString()
    await writeRankingCache({ provider, scrapedAt, publishDate, rankingId, events })
```

Replace the last two lines with:

```ts
    const scrapedAt = new Date().toISOString()
    const prev = await readRankingCache(provider)
    const eventsWithPrev = mergePreviousRanks(prev, events, publishDate)
    await writeRankingCache({ provider, scrapedAt, publishDate, rankingId, events: eventsWithPrev })
```

Note: `readRankingCache` is already imported in this file (line 11), so no second import is needed.

- [ ] **Step 3: Type-check and run the full test suite**

Run: `npx tsc --noEmit && npx jest`
Expected: All tests pass. The existing route test (`__tests__/api-ranking-refresh-route.test.ts`) should still pass because `mergePreviousRanks(null, events, publishDate)` returns `events` cloned, with no `previousRank` stamped on anything — behaviorally unchanged when there's no prior cache.

- [ ] **Step 4: Commit**

```bash
git add app/api/ranking/[provider]/refresh/route.ts
git commit -m "feat(ranking): stamp previousRank on refresh by diffing prior cache"
```

---

## Task 4: Pass `previousRank` through the page-level mapper

**Files:**
- Modify: `app/leaderboards/page.tsx:18-32` (`rankingEventToBoard`)

- [ ] **Step 1: Add the passthrough line**

In `app/leaderboards/page.tsx`, locate the `rankingEventToBoard` function (lines 18–40). Inside the `entries` map, add `previousRank` to the returned object. The whole `.map(e => ({ ... }))` block becomes:

```ts
  const entries: LeaderboardEntry[] = ev.entries.slice(0, RANKING_BOARD_LIMIT[provider]).map(e => ({
    rank: e.rank,
    slug: e.slug,
    name: e.name,
    primaryClub: e.club,
    value: e.points,
    display: e.points.toLocaleString() + ' pts',
    extra: e.tournaments > 0 ? `${e.tournaments} tn` : undefined,
    flagUrl: provider === 'bwf' ? e.countryFlagUrl : undefined,
    previousRank: e.previousRank,
  }))
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/leaderboards/page.tsx
git commit -m "feat(leaderboards): pass previousRank through to entries"
```

---

## Task 5: Render the delta badge

**Files:**
- Modify: `components/LeaderboardsView.tsx` (around line 269 — the `lb-rk` cell)
- Test: `__tests__/LeaderboardsView.test.tsx`

- [ ] **Step 1: Write the failing test**

In `__tests__/LeaderboardsView.test.tsx`, after the existing `describe('LeaderboardsView', ...)` block (which ends somewhere around line 100+), append a new describe block. First read the file to find the right insertion point (after the closing `})` of the existing describe):

```tsx
describe('LeaderboardsView ranking delta badge', () => {
  const makeRankingBoard = (entries: Array<{ rank: number; slug: string; previousRank?: number }>) => ({
    version: 1 as const,
    provider: 'bat' as const,
    generatedAt: 'T',
    sourceVersion: 'v',
    boards: [{
      id: 'ranking-ms',
      titleKey: "Men's Singles",
      icon: '🏸',
      category: 'ranking' as const,
      entries: entries.map(e => ({
        rank: e.rank,
        slug: e.slug,
        name: `Player ${e.slug}`,
        primaryClub: 'Club',
        value: 100,
        display: '100 pts',
        previousRank: e.previousRank,
      })),
    }],
  })

  it('renders an up arrow with magnitude when the player climbed', () => {
    renderLB(makeRankingBoard([{ rank: 3, slug: 'a', previousRank: 7 }]))
    const badge = screen.getByText('▲4')
    expect(badge.className).toContain('lb-rk-delta-up')
  })

  it('renders a down arrow with magnitude when the player fell', () => {
    renderLB(makeRankingBoard([{ rank: 9, slug: 'a', previousRank: 5 }]))
    const badge = screen.getByText('▼4')
    expect(badge.className).toContain('lb-rk-delta-down')
  })

  it('renders a NEW badge when previousRank is absent', () => {
    renderLB(makeRankingBoard([{ rank: 1, slug: 'a' }]))
    const badge = screen.getByText('NEW')
    expect(badge.className).toContain('lb-rk-delta-new')
  })

  it('renders nothing when rank is unchanged', () => {
    renderLB(makeRankingBoard([{ rank: 4, slug: 'a', previousRank: 4 }]))
    expect(screen.queryByText(/▲|▼|NEW/)).toBeNull()
  })

  it('does not render a badge on non-ranking-category boards even when previousRank is present', () => {
    const lb: Leaderboards = {
      version: 1, provider: 'bat', generatedAt: 'T', sourceVersion: 'v',
      boards: [{
        id: 'headline.titles', titleKey: 'lbMostTitles', icon: '🏆', category: 'headline',
        entries: [{
          rank: 1, slug: 'a', name: 'Anuwat', primaryClub: 'BKK', value: 12, display: '12',
          previousRank: 5,
        }],
      }],
    }
    renderLB(lb)
    expect(screen.queryByText(/▲|▼|NEW/)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx jest __tests__/LeaderboardsView.test.tsx -t "ranking delta badge"`
Expected: FAIL on all 5 new tests (badges don't render yet).

- [ ] **Step 3: Add the renderer**

In `components/LeaderboardsView.tsx`, at the top of the file (just below the imports, before the `interface SearchHit` line), add a small pure helper:

```tsx
function renderRankDelta(rank: number, previousRank: number | undefined): React.ReactElement | null {
  if (previousRank === undefined) {
    return <span className="lb-rk-delta-new">NEW</span>
  }
  if (previousRank === rank) return null
  if (previousRank > rank) {
    return <span className="lb-rk-delta-up">▲{previousRank - rank}</span>
  }
  return <span className="lb-rk-delta-down">▼{rank - previousRank}</span>
}
```

Then, in the JSX around line 269, locate the existing `lb-rk` div:

```tsx
                      <div className={`lb-rk ${e.rank === 1 ? 'lb-r1' : e.rank === 2 ? 'lb-r2' : e.rank === 3 ? 'lb-r3' : ''}`}>{e.rank}</div>
```

Replace it with:

```tsx
                      <div className={`lb-rk ${e.rank === 1 ? 'lb-r1' : e.rank === 2 ? 'lb-r2' : e.rank === 3 ? 'lb-r3' : ''}`}>
                        {e.rank}
                        {effectiveActive === 'ranking' && renderRankDelta(e.rank, e.previousRank)}
                      </div>
```

The gate on `effectiveActive === 'ranking'` keeps the badge off non-ranking boards. `effectiveActive` is already in scope at this point in the component.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx jest __tests__/LeaderboardsView.test.tsx -t "ranking delta badge"`
Expected: PASS, all 5 new tests.

- [ ] **Step 5: Run the full LeaderboardsView test file to verify nothing regressed**

Run: `npx jest __tests__/LeaderboardsView.test.tsx`
Expected: PASS, all tests (existing + new).

- [ ] **Step 6: Commit**

```bash
git add components/LeaderboardsView.tsx __tests__/LeaderboardsView.test.tsx
git commit -m "feat(leaderboards): render week-over-week delta badge on ranking rows"
```

---

## Task 6: Add the badge CSS

**Files:**
- Modify: `app/globals.css` (around line 2710 — alongside the existing `.lb-rk` rules)

- [ ] **Step 1: Add the three new classes**

In `app/globals.css`, locate the existing `.lb-row .lb-rk.lb-r3` line (around line 2713). Immediately after it, add:

```css
.lb-row .lb-rk-delta-up   { color: var(--win-fg); font-size: 10px; margin-left: 3px; font-weight: 700; }
.lb-row .lb-rk-delta-down { color: var(--red);    font-size: 10px; margin-left: 3px; font-weight: 700; }
.lb-row .lb-rk-delta-new  { color: var(--muted);  font-size:  9px; margin-left: 3px; font-weight: 700; letter-spacing: 0.5px; }
```

These reuse existing theme variables (`--win-fg`, `--red`, `--muted`), so they work in both light and dark mode and inside the `.ms-share-capture` wrapper without further changes.

The existing `.lb-rk` rule has `text-align: right`, which means the badge sits to the right of the rank number on the same line — the layout the spec calls for.

- [ ] **Step 2: Verify in the dev server**

Start the dev server: `npm run dev`
Open: `http://localhost:3000/leaderboards`
Click the **Ranking** tab. Confirm:
- Rows where the player held the same rank show no badge.
- Rows where the player climbed show a green `▲N`.
- Rows where the player fell show a red `▼N`.
- Rows with no prior-week data show a gray `NEW`.
- The non-ranking tabs (Headline, Discipline, Character, Activity) show no badges at all.
- Toggling dark mode keeps all colors legible.

On a fresh deployment (no prior cache yet) every row will show `NEW` until the next weekly publication — that's expected per the spec.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style(leaderboards): color rules for ranking delta badges"
```

---

## Task 7: Run the full test suite

- [ ] **Step 1: Final verification**

Run: `npx jest`
Expected: All tests pass.

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Manual smoke**

If not already done in Task 6 Step 2, start `npm run dev` and click through:
- `/leaderboards` → Ranking tab on BAT
- Switch to BWF provider → Ranking tab — confirm same badge behavior

---

## Done

The Ranking tab on Leaderboards now shows `▲N` / `▼N` / `NEW` next to each rank for both BAT and BWF, computed against the previous weekly publication. The delta updates automatically every Tuesday (BAT) / Wednesday (BWF) when the scheduler picks up the new `publishDate`.

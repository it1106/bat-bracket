# Playing-Order Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render an "Up next" / "N away" pill in `.ms-meta` for each upcoming match in the selected day, anchored on the latest now-playing match (or, if none is live, the latest completed match).

**Architecture:** A pure `computePlayingOrder(groups, liveByCourt)` walker produces a `Map<matchKey, position>` keyed by `${gi}-${mi}` using the **absolute** (unfiltered) match index. `MatchSchedule.tsx` calls it via `useMemo`, threads the absolute `mi` through its filtered render loop, and renders a single `<span class="ms-order-pill">` as the last child of `.ms-meta`. Two design tokens drive light/dark coloring.

**Tech Stack:** TypeScript, Next.js 14 (app router, client components), React 18, Jest 30 + `@testing-library/react`, plain CSS in `app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-04-26-playing-order-design.md`

---

## File Structure

### New files

- **`lib/playingOrder.ts`** — exports one pure function `computePlayingOrder(inputs)` returning `Map<string, number>`. No React, no DOM.
- **`__tests__/playingOrder.test.ts`** — Jest unit tests covering anchor selection, skip rules, both group types, and live-detection signals.

### Modified files

- **`lib/i18n.ts`** — add `'playingOrderNext'` and `'playingOrderAway'` keys to `TKey` and to both `en` / `th` dictionaries.
- **`app/globals.css`** — add four design tokens (`--order-pill-bg`, `--order-pill-fg`, `--order-pill-next-bg`, `--order-pill-next-fg`) to `:root` and `html.dark`, plus `.ms-order-pill` and `.ms-order-pill--next` rules near the existing `.ms-meta` block.
- **`components/MatchSchedule.tsx`** — call `computePlayingOrder` via `useMemo`, fix the filter map to pass **absolute** `mi` instead of filtered `mi`, render the pill as the last child of `.ms-meta`.
- **`__tests__/MatchSchedule.live.test.tsx`** — add a `describe('MatchSchedule — playing order')` block.

---

## Important context for the implementer

### Existing match-key convention has a latent filter bug

The current `renderMatch` builds `matchKey = \`${gi}-${mi}\`` where `mi` is the **filtered** index from `filtered.map((m, mi) => …)` at `components/MatchSchedule.tsx:238`. But `findFirstUnplayed` in `lib/useFirstUnplayed.ts:20–36` returns the **absolute** `mi` (index into `groups[gi].matches`). When `playerQuery` is active and removes a row before the target, the two `mi` values diverge and the existing fast-forward feature silently fails to recognize the target row. We fix this incidentally in Task 4 by switching the render loop to pass absolute `mi`. After the fix, both `targetKey` and the new `playingOrder` map agree with the rendered keys regardless of filter state.

### Live detection

A match is "currently playing" when **either** `m.nowPlaying === true` **or** `liveByCourt && matchLiveCourt(m, liveByCourt) !== null`. Re-use the existing `matchLiveCourt` from `lib/live-score.ts`. Don't reinvent the join.

### Walking order

`groups[i].matches[j]` in scraper-emitted order is the user-visible order. Concatenate flat — `groups.flatMap(g => g.matches)` — for the anchor walk. Group type (`'time'` vs `'court'`) doesn't affect the order; it only affects the section header rendered above each group.

---

## Task 1: Pure `computePlayingOrder` function + unit tests

**Files:**
- Create: `lib/playingOrder.ts`
- Create: `__tests__/playingOrder.test.ts`

- [ ] **Step 1: Write the unit test file with all cases (initially failing)**

Create `__tests__/playingOrder.test.ts` with the following content:

```ts
import { computePlayingOrder } from '@/lib/playingOrder'
import type { MatchScheduleGroup, MatchEntry } from '@/lib/types'
import type { CourtLive } from '@/lib/live-score'

function entry(over: Partial<MatchEntry> = {}): MatchEntry {
  return {
    draw: 'WS', drawNum: '1', round: 'QF',
    team1: [{ name: 'Alpha', playerId: '100' }],
    team2: [{ name: 'Beta', playerId: '200' }],
    winner: null, scores: [],
    court: 'Court - 3', walkover: false, retired: false, nowPlaying: false,
    ...over,
  }
}

function timeGroup(time: string, matches: MatchEntry[]): MatchScheduleGroup {
  return { type: 'time', time, matches }
}

function courtGroup(court: string, matches: MatchEntry[]): MatchScheduleGroup {
  return { type: 'court', court, matches }
}

function live(over: Partial<CourtLive> = {}): CourtLive {
  return {
    courtKey: '3', courtName: 'Court 3', matchId: 1, event: 'WS', playerIds: ['100', '200'],
    setScores: [], current: null, serving: 0, winner: 0,
    team1Points: 0, team2Points: 0, durationSec: 0,
    ...over,
  }
}

describe('computePlayingOrder', () => {
  it('returns an empty map for empty groups', () => {
    const result = computePlayingOrder({ groups: [], liveByCourt: null })
    expect(result.size).toBe(0)
  })

  it('returns an empty map when no match is live and no match has a winner', () => {
    const groups = [timeGroup('10:00', [entry(), entry(), entry()])]
    expect(computePlayingOrder({ groups, liveByCourt: null }).size).toBe(0)
  })

  it('anchors on the highest-index now-playing match and numbers the rest 1..N', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ winner: 1 }),                  // 0-0  done
        entry({ nowPlaying: true }),           // 0-1  live (not the latest)
        entry({ nowPlaying: true }),           // 0-2  ANCHOR (latest live)
        entry(),                               // 0-3  position 1 → "Up next"
        entry(),                               // 0-4  position 2
        entry(),                               // 0-5  position 3
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.get('0-3')).toBe(1)
    expect(result.get('0-4')).toBe(2)
    expect(result.get('0-5')).toBe(3)
    // Anchor and earlier rows get no entry
    expect(result.has('0-0')).toBe(false)
    expect(result.has('0-1')).toBe(false)
    expect(result.has('0-2')).toBe(false)
  })

  it('falls back to the highest-index completed match when nothing is live', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ winner: 1 }),                  // 0-0  done
        entry({ winner: 2 }),                  // 0-1  ANCHOR (latest done)
        entry(),                               // 0-2  position 1
        entry(),                               // 0-3  position 2
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.get('0-2')).toBe(1)
    expect(result.get('0-3')).toBe(2)
    expect(result.has('0-0')).toBe(false)
    expect(result.has('0-1')).toBe(false)
  })

  it('does not assign a pill to live matches earlier than the anchor', () => {
    // Two live matches; anchor is the *latest* one (highest index). Earlier live
    // matches and everything before the anchor get no pill. Forward walk picks
    // up only rows after the anchor.
    const groups = [
      timeGroup('10:00', [
        entry({ winner: 1 }),                  // 0-0  done, before anchor → no pill
        entry({ nowPlaying: true }),           // 0-1  live (earlier), before anchor → no pill
        entry({ nowPlaying: true }),           // 0-2  ANCHOR (latest live)
        entry(),                               // 0-3  position 1
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.has('0-0')).toBe(false)
    expect(result.has('0-1')).toBe(false)
    expect(result.has('0-2')).toBe(false)
    expect(result.get('0-3')).toBe(1)
  })

  it('skips already-completed stragglers after the anchor', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ nowPlaying: true }),           // 0-0  ANCHOR
        entry(),                               // 0-1  position 1
        entry({ winner: 1 }),                  // 0-2  done straggler, no position
        entry(),                               // 0-3  position 2
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.get('0-1')).toBe(1)
    expect(result.has('0-2')).toBe(false)
    expect(result.get('0-3')).toBe(2)
  })

  it('skips walkovers; they do not consume a position', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ nowPlaying: true }),           // 0-0  ANCHOR
        entry(),                               // 0-1  position 1
        entry({ walkover: true, winner: null }), // 0-2  walkover (not yet awarded)
        entry({ walkover: true, winner: 2 }),  // 0-3  walkover (already awarded — skipped by winner check anyway)
        entry(),                               // 0-4  position 2
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.get('0-1')).toBe(1)
    expect(result.has('0-2')).toBe(false)
    expect(result.has('0-3')).toBe(false)
    expect(result.get('0-4')).toBe(2)
  })

  it('detects "live" via liveByCourt when nowPlaying is false', () => {
    const groups = [
      timeGroup('10:00', [
        entry(),                               // 0-0  no winner, not nowPlaying — but live via SignalR
        entry(),                               // 0-1  position 1
      ]),
    ]
    const liveByCourt = new Map<string, CourtLive>([['3', live()]])
    const result = computePlayingOrder({ groups, liveByCourt })
    expect(result.get('0-1')).toBe(1)
    expect(result.has('0-0')).toBe(false)
  })

  it('detects "live" via m.nowPlaying when liveByCourt is null', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ nowPlaying: true }),           // 0-0  ANCHOR via nowPlaying
        entry(),                               // 0-1  position 1
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.get('0-1')).toBe(1)
  })

  it('numbers positions contiguously regardless of skipped rows between them', () => {
    const groups = [
      timeGroup('10:00', [
        entry({ nowPlaying: true }),           // 0-0  ANCHOR (only live match)
        entry({ winner: 1 }),                  // 0-1  done straggler → skip
        entry(),                               // 0-2  position 1
        entry({ walkover: true }),             // 0-3  walkover → skip
        entry({ winner: 2 }),                  // 0-4  done straggler → skip
        entry(),                               // 0-5  position 2
      ]),
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    expect(result.get('0-2')).toBe(1)
    expect(result.has('0-3')).toBe(false)
    expect(result.has('0-4')).toBe(false)
    expect(result.get('0-5')).toBe(2)
  })

  it('walks across multiple groups in order (court-grouped layout)', () => {
    const groups = [
      courtGroup('Court 1', [entry({ nowPlaying: true }), entry()]),  // 0-0 live (earlier), 0-1 before anchor
      courtGroup('Court 2', [entry({ nowPlaying: true }), entry()]),  // 1-0 ANCHOR (latest live), 1-1 position 1
      courtGroup('Court 3', [entry()]),                                // 2-0 position 2
    ]
    const result = computePlayingOrder({ groups, liveByCourt: null })
    // Anchor is the highest-index live: flat index 2 = (gi=1, mi=0).
    // Rows before the anchor (0-0, 0-1, 1-0) get no entry.
    expect(result.has('0-0')).toBe(false)
    expect(result.has('0-1')).toBe(false)
    expect(result.has('1-0')).toBe(false)
    expect(result.get('1-1')).toBe(1)
    expect(result.get('2-0')).toBe(2)
  })

  it('returns empty when only group is empty', () => {
    const groups = [timeGroup('10:00', [])]
    expect(computePlayingOrder({ groups, liveByCourt: null }).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests; expect a module-not-found failure**

Run: `npm test -- __tests__/playingOrder.test.ts`

Expected: All tests fail with `Cannot find module '@/lib/playingOrder'`.

- [ ] **Step 3: Create the implementation**

Create `lib/playingOrder.ts` with this content:

```ts
import type { MatchScheduleGroup, MatchEntry } from './types'
import { matchLiveCourt, type CourtLive } from './live-score'

export interface PlayingOrderInputs {
  groups: MatchScheduleGroup[]
  liveByCourt: Map<string, CourtLive> | null
}

function isLiveMatch(
  m: MatchEntry,
  liveByCourt: Map<string, CourtLive> | null,
): boolean {
  if (m.nowPlaying) return true
  if (liveByCourt && matchLiveCourt(m, liveByCourt) !== null) return true
  return false
}

interface FlatRef {
  gi: number
  mi: number
  m: MatchEntry
}

function flatten(groups: MatchScheduleGroup[]): FlatRef[] {
  const out: FlatRef[] = []
  for (let gi = 0; gi < groups.length; gi++) {
    const matches = groups[gi].matches
    for (let mi = 0; mi < matches.length; mi++) {
      out.push({ gi, mi, m: matches[mi] })
    }
  }
  return out
}

/**
 * Returns a Map<matchKey, queuePosition> where matchKey = `${gi}-${mi}` (absolute
 * indices into groups[gi].matches, NOT filtered render indices) and queuePosition
 * is 1-based. Matches not in the map get no pill.
 *
 * Anchor selection:
 *   1. Highest-index match where isLiveMatch() is true.
 *   2. Else highest-index match with winner !== null.
 *   3. Else no anchor → empty map.
 *
 * Walk forward from the anchor; skip live matches, completed stragglers, and
 * walkovers. Each remaining match gets the next position starting at 1.
 */
export function computePlayingOrder(
  inputs: PlayingOrderInputs,
): Map<string, number> {
  const { groups, liveByCourt } = inputs
  const flat = flatten(groups)
  if (flat.length === 0) return new Map()

  // Find anchor index in the flat array
  let anchorIdx = -1
  for (let i = flat.length - 1; i >= 0; i--) {
    if (isLiveMatch(flat[i].m, liveByCourt)) {
      anchorIdx = i
      break
    }
  }
  if (anchorIdx === -1) {
    for (let i = flat.length - 1; i >= 0; i--) {
      if (flat[i].m.winner !== null) {
        anchorIdx = i
        break
      }
    }
  }
  if (anchorIdx === -1) return new Map()

  const result = new Map<string, number>()
  let position = 0
  for (let i = anchorIdx + 1; i < flat.length; i++) {
    const { gi, mi, m } = flat[i]
    if (isLiveMatch(m, liveByCourt)) continue
    if (m.winner !== null) continue
    if (m.walkover) continue
    position += 1
    result.set(`${gi}-${mi}`, position)
  }
  return result
}
```

- [ ] **Step 4: Run tests; expect all pass**

Run: `npm test -- __tests__/playingOrder.test.ts`

Expected: All 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/playingOrder.ts __tests__/playingOrder.test.ts
git commit -m "Add computePlayingOrder pure function + tests"
```

---

## Task 2: Add i18n keys

**Files:**
- Modify: `lib/i18n.ts`

- [ ] **Step 1: Add the two keys to the `TKey` union**

In `lib/i18n.ts`, find the existing union ending with `'jumpToNext'` and `'winRate'` (lines ~127–128). Add two new entries to the union after `'jumpToNext'`:

```ts
  | 'jumpToNext'
  | 'playingOrderNext'
  | 'playingOrderAway'
  | 'winRate'
```

- [ ] **Step 2: Add the English translations**

In the `en` dictionary (in `lib/i18n.ts`, after `jumpToNext: 'Next match ↓',`), add:

```ts
    jumpToNext: 'Next match ↓',
    playingOrderNext: 'Up next',
    playingOrderAway: '{n} away',
    winRate: 'Win rate',
```

- [ ] **Step 3: Add the Thai translations**

In the `th` dictionary, find the corresponding `jumpToNext` line and add the same two new keys directly after it:

```ts
    jumpToNext: 'แมตช์ถัดไป ↓',
    playingOrderNext: 'ถัดไป',
    playingOrderAway: 'อีก {n} แมตช์',
    winRate: 'อัตราการชนะ',
```

(If the existing Thai `jumpToNext` value differs from `'แมตช์ถัดไป ↓'`, leave it untouched — only add the two new lines.)

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`

Expected: Exits 0 (the union enforces both dictionaries to contain both keys).

- [ ] **Step 5: Commit**

```bash
git add lib/i18n.ts
git commit -m "Add playingOrderNext / playingOrderAway i18n keys"
```

---

## Task 3: CSS design tokens and pill styles

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add the four design tokens to `:root`**

In `app/globals.css`, locate the existing `:root` block (starts at line 10). Inside the block, after the existing `--info-fg` line, add:

```css
  --info-fg: #1d4ed8;
  --order-pill-bg: #eef2f6;
  --order-pill-fg: #1a1a1a;
  --order-pill-next-bg: #f59e0b;
  --order-pill-next-fg: #1a1a1a;
}
```

- [ ] **Step 2: Add the dark-mode overrides**

In the `html.dark` block (starts at line 30), inside the block, after the existing `--info-fg` line, add:

```css
  --info-fg: #79c0ff;
  --order-pill-bg: rgba(125, 133, 144, 0.18);
  --order-pill-fg: #e6edf3;
  --order-pill-next-bg: #d29922;
  --order-pill-next-fg: #0d1117;
}
```

- [ ] **Step 3: Add the pill rules near the existing `.ms-meta` block**

Find the `.ms-meta` rule in `app/globals.css` (around line 1161). Immediately AFTER the closing `}` of the `.ms-now-playing` keyframes block (`@keyframes ms-pulse { … }`, around line 1201), add:

```css
.ms-order-pill {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--order-pill-bg);
  color: var(--order-pill-fg);
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.5;
}
.ms-order-pill--next {
  background: var(--order-pill-next-bg);
  color: var(--order-pill-next-fg);
}
```

- [ ] **Step 4: Verify CSS by running the build**

Run: `npm run build`

Expected: Build succeeds without CSS errors. (If lint complains about token order or naming, adjust to match the surrounding token style — same hex format, same indentation.)

- [ ] **Step 5: Commit**

```bash
git add app/globals.css
git commit -m "Add .ms-order-pill styles and design tokens"
```

---

## Task 4: Wire `computePlayingOrder` into `MatchSchedule`, render the pill, fix filter index

**Files:**
- Modify: `components/MatchSchedule.tsx`
- Modify: `__tests__/MatchSchedule.live.test.tsx`

- [ ] **Step 1: Add component-level tests for the pill rendering (initially failing)**

Append a new `describe` block to `__tests__/MatchSchedule.live.test.tsx` (after the existing `describe('MatchSchedule — jump to next', …)` closes around line 187). Add:

```ts
// ── Playing-order tests ─────────────────────────────────────────────────

describe('MatchSchedule — playing order', () => {
  function multiGroup(matches: MatchEntry[]): MatchScheduleGroup[] {
    return [{ type: 'time', time: '10:00', matches }]
  }

  it('renders "Up next" pill on the first eligible match after a live anchor', () => {
    const matches = [
      entry({ winner: 1, nowPlaying: false, scores: [{ t1: 21, t2: 15 }] }),
      entry({ nowPlaying: true, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
    ]
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={multiGroup(matches)}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery=""
        />
      </LanguageProvider>,
    )
    const pills = container.querySelectorAll('.ms-order-pill')
    expect(pills.length).toBe(2)
    expect(pills[0]).toHaveClass('ms-order-pill--next')
    expect(pills[0]?.textContent).toBe('Up next')
    expect(pills[1]).not.toHaveClass('ms-order-pill--next')
    expect(pills[1]?.textContent).toBe('2 away')
  })

  it('renders "N away" with the correct number on later positions', () => {
    const matches = [
      entry({ nowPlaying: true, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
    ]
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={multiGroup(matches)}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery=""
        />
      </LanguageProvider>,
    )
    const texts = Array.from(container.querySelectorAll('.ms-order-pill')).map(
      (el) => el.textContent,
    )
    expect(texts).toEqual(['Up next', '2 away', '3 away'])
  })

  it('renders no pill on live, completed, or walkover rows', () => {
    const matches = [
      entry({ nowPlaying: true, scores: [] }),                      // anchor
      entry({ nowPlaying: false, scores: [] }),                     // up next
      entry({ winner: 1, nowPlaying: false, scores: [{ t1: 21, t2: 0 }] }),  // straggler
      entry({ walkover: true, nowPlaying: false, scores: [] }),     // walkover
      entry({ nowPlaying: false, scores: [] }),                     // 2 away
    ]
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={multiGroup(matches)}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery=""
        />
      </LanguageProvider>,
    )
    const pills = container.querySelectorAll('.ms-order-pill')
    expect(pills.length).toBe(2)
    expect(Array.from(pills).map((p) => p.textContent)).toEqual(['Up next', '2 away'])
  })

  it('renders no pill anywhere when the day has no anchor', () => {
    const matches = [
      entry({ nowPlaying: false, scores: [] }),
      entry({ nowPlaying: false, scores: [] }),
    ]
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={multiGroup(matches)}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery=""
        />
      </LanguageProvider>,
    )
    expect(container.querySelectorAll('.ms-order-pill').length).toBe(0)
  })

  it('keeps positions stable when a player filter hides earlier rows', () => {
    // Three unplayed matches after the anchor; filter hides the middle one.
    const matches = [
      entry({ nowPlaying: true, scores: [] }),                                              // anchor
      entry({ nowPlaying: false, team1: [{ name: 'Alpha', playerId: '1' }], scores: [] }),  // pos 1
      entry({ nowPlaying: false, team1: [{ name: 'Beta',  playerId: '2' }], scores: [] }),  // pos 2 (filtered out)
      entry({ nowPlaying: false, team1: [{ name: 'Alpha', playerId: '3' }], scores: [] }),  // pos 3
    ]
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={multiGroup(matches)}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery="alpha"
        />
      </LanguageProvider>,
    )
    const texts = Array.from(container.querySelectorAll('.ms-order-pill')).map(
      (el) => el.textContent,
    )
    // Visible pills are positions 1 and 3 — number is stable, not renumbered against filtered list
    expect(texts).toEqual(['Up next', '3 away'])
  })
})
```

- [ ] **Step 2: Run tests; expect failure**

Run: `npm test -- __tests__/MatchSchedule.live.test.tsx`

Expected: The 5 new "playing order" tests fail (no `.ms-order-pill` rendered yet). Existing tests continue to pass.

- [ ] **Step 3: Wire `computePlayingOrder` into `MatchSchedule.tsx`**

Edit `components/MatchSchedule.tsx`:

(a) Add the import at the top of the file (after the existing `useFirstUnplayed` import on line 6):

```ts
import { useFirstUnplayed } from '@/lib/useFirstUnplayed'
import { computePlayingOrder } from '@/lib/playingOrder'
```

(b) Add `useMemo` to the React import. Find the existing React imports (this file currently does not import `useMemo` directly). Add a new import line near the top:

```ts
import { useMemo } from 'react'
```

(Place it before the `import type { MatchScheduleGroup, … } from '@/lib/types'` line so React imports come first.)

(c) After the `useFirstUnplayed` hook call (around line 87–88), add:

```ts
  const { targetKey, registerTargetRef, isTargetInView, scrollToTarget } =
    useFirstUnplayed(groups, playerQuery, playerClubMap)
  const playingOrder = useMemo(
    () => computePlayingOrder({ groups, liveByCourt: liveByCourt ?? null }),
    [groups, liveByCourt],
  )
```

(d) In `renderMatch` (around lines 98–195), inside the function body, near where `matchKey` is computed (line 99), add a position lookup and a small render helper. After the `const matchKey = …` line:

```ts
    const matchKey = `${gi}-${mi}`
    const isTarget = matchKey === targetKey
    const position = playingOrder.get(matchKey) ?? null
```

(e) Inside the `<div className="ms-meta">` JSX block (around lines 123–142), append the pill as the last child of `.ms-meta`, immediately after the existing H2H button block:

```tsx
        {m.h2hUrl && onH2HClick && (
          <button
            className="ms-h2h-inline"
            onClick={() => onH2HClick(m.h2hUrl!)}
            title={t('h2hButton')}
          >{t('h2hButton')}</button>
        )}
        {position !== null && (
          <span
            className={`ms-order-pill${position === 1 ? ' ms-order-pill--next' : ''}`}
          >
            {position === 1
              ? t('playingOrderNext')
              : t('playingOrderAway').replace('{n}', String(position))}
          </span>
        )}
      </div>
```

(f) Fix the render loop to pass **absolute** `mi` instead of filtered `mi`. In the JSX at line 238, change:

```tsx
              {filtered.map((m, mi) => renderMatch(m, gi, mi, group.type === 'time'))}
```

to:

```tsx
              {filtered.map((m) => {
                const absMi = group.matches.indexOf(m)
                return renderMatch(m, gi, absMi, group.type === 'time')
              })}
```

(`indexOf` is O(n) per row; group sizes are small (≤ ~50 matches per group in practice), so the resulting O(n²) per group is harmless. Don't optimize unless a profile says to.)

- [ ] **Step 4: Run tests; expect all pass**

Run: `npm test -- __tests__/MatchSchedule.live.test.tsx __tests__/playingOrder.test.ts __tests__/findFirstUnplayed.test.ts`

Expected: All tests pass — both the new playing-order tests and the existing live-overlay, jump-to-next, and findFirstUnplayed tests. (The `findFirstUnplayed` tests already use absolute `mi`, so they remain green; the absolute-mi fix in step 3(f) actually aligns the render path with what `findFirstUnplayed` was already returning.)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`

Expected: Entire suite is green.

- [ ] **Step 6: Run typecheck and build**

Run: `npx tsc --noEmit && npm run build`

Expected: Both exit 0.

- [ ] **Step 7: Commit**

```bash
git add components/MatchSchedule.tsx __tests__/MatchSchedule.live.test.tsx
git commit -m "Render playing-order pill on upcoming matches"
```

---

## Task 5: Manual verification

**Files:** none (verification only)

These checks aren't automated — run through them in a browser to catch visual or live-state issues the unit/component tests can't see.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Open http://localhost:3000 and navigate to a tournament with an in-progress day.

- [ ] **Step 2: Desktop visual check (≥ 901 px viewport)**

Confirm:
- An amber "Up next" pill appears on the first eligible upcoming match after the latest live row.
- Subsequent upcoming matches show gray "2 away", "3 away", … pills.
- The pill sits below the court line in the meta column, matching mockup A.
- The pill does not push the meta column wider than its 150 px grid track. (Resize the browser; the pill should not cause horizontal scroll.)
- Live rows still show the LIVE badge and green now-playing dot, with no pill.
- Completed rows show the existing winner medal, with no pill.
- Walkover rows show the walkover badge, with no pill.

- [ ] **Step 3: Mobile visual check (≤ 900 px viewport)**

Use DevTools to switch to a mobile viewport. Confirm:
- The pill flows inline at the end of the meta row, after the H2H button.
- Pill text doesn't wrap awkwardly with Thai text active.
- The card layout (per `.ms-match` flex column) still renders cleanly.

- [ ] **Step 4: Dark-mode contrast**

Toggle dark mode (existing theme toggle). Confirm:
- Both the gray pill and the amber pill remain readable against the surrounding background.
- The amber "Up next" pill remains visually distinct from the LIVE badge.

- [ ] **Step 5: Locale switch**

Toggle to Thai (existing language toggle). Confirm:
- The first eligible row shows `ถัดไป`.
- Subsequent rows show `อีก 2 แมตช์`, `อีก 3 แมตช์`, etc.
- Numbers in the Thai string substitute correctly.

- [ ] **Step 6: Live-state transition**

Pick a match that is about to finish, or simulate by reloading after a live state change. Confirm:
- When a live match completes, the next render's anchor advances and pills shift forward by one.
- The previously "Up next" row becomes the new live row (or, if it isn't picked up live yet, becomes a winner row); the next pill in the queue assumes "Up next".

- [ ] **Step 7: Player filter**

In the search box, type a player's name who has multiple upcoming matches. Confirm:
- Pills on the visible filtered rows show the **whole-day** position numbers (skipping numbers belonging to filtered-out rows is fine — see the test "keeps positions stable" in Task 4).
- Clearing the filter restores the full schedule with the same numbers.

- [ ] **Step 8: Day-tab switch**

Switch to a future day. Confirm:
- No anchor exists → no pills render. (Or, if the tournament backend ever pre-marks matches as nowPlaying, an anchor would exist; either is acceptable.)

Switch back to today. Confirm pills reappear correctly.

If any step fails or surfaces a regression, return to the appropriate task and fix.

- [ ] **Step 9: Final commit (only if any tweaks were made during verification)**

If steps 2–8 surfaced a fix:

```bash
git add -A
git commit -m "Tweak playing-order pill based on manual verification"
```

If no tweaks needed, no commit.

---

## Done criteria

- All Jest tests pass (`npm test`).
- `npx tsc --noEmit` and `npm run build` both succeed.
- Manual verification in §Task 5 passes on both desktop and mobile, light and dark, English and Thai.
- The branch contains 4–5 focused commits (one per task), each green.

# Frequent Opponents Time-Window Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five time-window tabs — **30 Days · 90 Days · 180 Days · 1 Year · All Time** — to the *Frequent opponents* section on the player profile. Each tab filters the top-12 opponent list to meetings within that window only. Default tab is **All Time** (no regression).

**Architecture:** Precompute one top-12 `OpponentRecord[]` per window during index build (the same place today's lifetime list is computed: `lib/playerIndex.ts:526-546`). Ship the buckets as a new optional `opponentsByWindow` field on `PlayerRecord`. The view holds `useState<OpponentTimeWindow>` and swaps which array it renders on tab click. The legacy `record.opponents` field is preserved (set to `byWindow.all`) so stale indexes still work.

**Tech Stack:** TypeScript, Next.js 14 (app router), React 18, Jest + React Testing Library, plain CSS (`app/globals.css`).

**Spec:** `docs/specs/2026-06-03-frequent-opponents-time-filter-design.md`

---

## File Structure

- **Modify** `lib/types.ts` — add `OpponentTimeWindow` type and `opponentsByWindow?` field on `PlayerRecord`.
- **Modify** `lib/playerIndex.ts` — extract opponent aggregation into an exported pure helper `buildOpponentsByWindow`; wire it into `buildIndex`.
- **Create** `__tests__/playerIndex.opponentsByWindow.test.ts` — unit test for the helper with controlled synthetic refs.
- **Modify** `lib/i18n.ts` — add six new `TKey` keys + EN/TH translations.
- **Modify** `components/PlayerProfileView.tsx` — wire `useLanguage`, add tab state, replace the existing opponents block.
- **Modify** `__tests__/PlayerProfileView.test.tsx` — extend with tab-switching test cases.
- **Modify** `app/globals.css` — add `.pp-section-head`, `.pp-time-tabs`, `.pp-time-tab`, `.pp-time-tab.active`, `.pp-empty`.

`PlayerRecord.opponents` is preserved (kept identical to the `all`-bucket list) so older built indexes and any caller that reads `.opponents` continue to work without changes.

The branch already exists: `feat/frequent-opponents-time-filter` (the spec lives there). All tasks below land on that branch.

---

## Task 1: Schema — add `OpponentTimeWindow` + `opponentsByWindow?` field

**Files:**
- Modify: `lib/types.ts` (insert type alias near `Discipline` ~line 416; add field on `PlayerRecord` after line 522)

- [ ] **Step 1: Add the type alias and the record field**

In `lib/types.ts`, add the type alias directly *after* the existing `export type Discipline = …` line (currently line 416):

```ts
export type OpponentTimeWindow = '30d' | '90d' | '180d' | '1y' | 'all'
```

Then inside `PlayerRecord`, directly *after* the existing `opponents: OpponentRecord[]` line (currently `lib/types.ts:522`), add:

```ts
  /** Top-12 opponents bucketed by time window. The `all` bucket is identical
   *  to `opponents` (kept for backward-compat); windowed buckets contain
   *  only meetings whose `scheduledDateIso` falls inside the window,
   *  measured backward from the latest match in the dataset. Optional so a
   *  previously-built index still loads — readers fall back to `opponents`
   *  for the `all` tab and render an empty list for windowed tabs. */
  opponentsByWindow?: Record<OpponentTimeWindow, OpponentRecord[]>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes (no new errors). If there is a pre-existing error in `__tests__/bat-ranking-cache.test.ts:15` from the previous tournament-tooltips work, it should be the same as before — no regressions.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(player-record): add OpponentTimeWindow + opponentsByWindow field

Optional bucketed top-12 lists keyed by time window. The 'all' bucket
mirrors PlayerRecord.opponents so existing readers stay correct.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Failing unit test for the opponent-windowing helper

**Files:**
- Create: `__tests__/playerIndex.opponentsByWindow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/playerIndex.opponentsByWindow.test.ts` with this exact content:

```ts
import { buildOpponentsByWindow } from '@/lib/playerIndex'
import type { PlayerMatchRef, OpponentRecord, OpponentTimeWindow } from '@/lib/types'

const DAY_MS = 86_400_000
const NOW = Date.parse('2026-06-01T00:00:00Z')  // latest match anchor
function iso(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY_MS).toISOString().slice(0, 10)
}

function ref(p: {
  opp: string, oppSlug: string, daysAgo: number, outcome: PlayerMatchRef['outcome'],
  round?: string, eventName?: string,
}): PlayerMatchRef {
  return {
    tournamentId: 'T', tournamentName: 'T', tournamentDateIso: iso(p.daysAgo),
    eventId: 'E', eventName: p.eventName ?? 'BS', drawNum: '1',
    round: p.round ?? 'R16',
    partners: [], opponents: [p.opp], opponentSlugs: [p.oppSlug],
    partnerSlugs: [], scores: [{ t1: 21, t2: 19 }, { t1: 21, t2: 18 }],
    outcome: p.outcome,
    scheduledDateIso: iso(p.daysAgo),
  }
}

describe('buildOpponentsByWindow', () => {
  it('returns a list per window keyed 30d/90d/180d/1y/all', () => {
    const out = buildOpponentsByWindow([], NOW)
    const keys: OpponentTimeWindow[] = ['30d', '90d', '180d', '1y', 'all']
    for (const k of keys) expect(Array.isArray(out[k])).toBe(true)
  })

  it('bucket "all" matches the lifetime aggregate', () => {
    const refs = [
      ref({ opp: 'A', oppSlug: 'a', daysAgo: 10, outcome: 'W' }),
      ref({ opp: 'A', oppSlug: 'a', daysAgo: 200, outcome: 'L' }),
      ref({ opp: 'B', oppSlug: 'b', daysAgo: 400, outcome: 'W' }),
    ]
    const out = buildOpponentsByWindow(refs, NOW)
    const a = out.all.find(o => o.slug === 'a')!
    const b = out.all.find(o => o.slug === 'b')!
    expect(a.meetings).toBe(2); expect(a.wins).toBe(1); expect(a.losses).toBe(1)
    expect(b.meetings).toBe(1); expect(b.wins).toBe(1); expect(b.losses).toBe(0)
  })

  it('windows exclude meetings outside their cutoff', () => {
    const refs = [
      ref({ opp: 'A', oppSlug: 'a', daysAgo: 10,  outcome: 'W' }), // in every window
      ref({ opp: 'B', oppSlug: 'b', daysAgo: 60,  outcome: 'L' }), // 90d/180d/1y/all
      ref({ opp: 'C', oppSlug: 'c', daysAgo: 120, outcome: 'W' }), // 180d/1y/all
      ref({ opp: 'D', oppSlug: 'd', daysAgo: 250, outcome: 'L' }), // 1y/all
      ref({ opp: 'E', oppSlug: 'e', daysAgo: 400, outcome: 'W' }), // all only
    ]
    const out = buildOpponentsByWindow(refs, NOW)
    expect(out['30d'].map(o => o.slug).sort()).toEqual(['a'])
    expect(out['90d'].map(o => o.slug).sort()).toEqual(['a', 'b'])
    expect(out['180d'].map(o => o.slug).sort()).toEqual(['a', 'b', 'c'])
    expect(out['1y'].map(o => o.slug).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(out.all.map(o => o.slug).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('lastRound/lastEvent reflect the most recent meeting within the window', () => {
    // Two meetings with opponent X: older in window, newer outside.
    const refs = [
      ref({ opp: 'X', oppSlug: 'x', daysAgo: 20,  outcome: 'W', round: 'R16', eventName: 'BS' }),
      ref({ opp: 'X', oppSlug: 'x', daysAgo: 150, outcome: 'W', round: 'Final', eventName: 'XD' }),
    ]
    const out = buildOpponentsByWindow(refs, NOW)
    const x30 = out['30d'].find(o => o.slug === 'x')!
    const xAll = out.all.find(o => o.slug === 'x')!
    expect(x30.lastRound).toBe('R16');   expect(x30.lastEvent).toBe('BS')
    expect(xAll.lastRound).toBe('R16');  expect(xAll.lastEvent).toBe('BS')
  })

  it('refs missing scheduledDateIso are excluded from windowed buckets but kept in "all"', () => {
    const undatedRef: PlayerMatchRef = {
      ...ref({ opp: 'U', oppSlug: 'u', daysAgo: 5, outcome: 'W' }),
      scheduledDateIso: undefined,
    }
    const out = buildOpponentsByWindow([undatedRef], NOW)
    expect(out['30d']).toHaveLength(0)
    expect(out['90d']).toHaveLength(0)
    expect(out.all.map(o => o.slug)).toEqual(['u'])
  })

  it('caps every bucket at top 12 by meetings desc, wins desc, slug asc', () => {
    const refs: PlayerMatchRef[] = []
    for (let i = 0; i < 20; i++) {
      const slug = `p${String(i).padStart(2, '0')}`
      // p00 = 20 meetings, p01 = 19, …
      const meetings = 20 - i
      for (let m = 0; m < meetings; m++) {
        refs.push(ref({ opp: slug, oppSlug: slug, daysAgo: 5, outcome: 'W' }))
      }
    }
    const out = buildOpponentsByWindow(refs, NOW)
    expect(out.all).toHaveLength(12)
    expect(out['30d']).toHaveLength(12)
    expect(out.all[0].slug).toBe('p00')
    expect(out.all[11].slug).toBe('p11')
  })

  it('returns five empty arrays when nowMs is 0', () => {
    const out = buildOpponentsByWindow([], 0)
    for (const k of ['30d', '90d', '180d', '1y', 'all'] as OpponentTimeWindow[]) {
      expect(out[k]).toEqual([])
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/playerIndex.opponentsByWindow.test.ts`
Expected: FAIL — `buildOpponentsByWindow is not a function` (or import error). This proves the test wires up before the helper exists.

- [ ] **Step 3: Commit**

```bash
git add __tests__/playerIndex.opponentsByWindow.test.ts
git commit -m "test(player-index): failing tests for buildOpponentsByWindow

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Extract & implement the `buildOpponentsByWindow` helper

**Files:**
- Modify: `lib/playerIndex.ts` (add helper above `buildIndex`; replace inline aggregation at 526-546 in the next task)

- [ ] **Step 1: Add the helper as an exported pure function**

`lib/playerIndex.ts` is documented as "Pure functions only — no I/O, no `Date.now()`, no `console`" (see the comment at the top of the file). The helper must respect that — take `nowMs` as a parameter, don't call `Date.now()`.

Add this helper somewhere ABOVE `buildIndex` (suggested: directly above `export function buildIndex(`). Keep `import type` for new types in the top-of-file import block.

```ts
const DAY_MS = 86_400_000
const OPPONENT_WINDOW_DAYS: Record<Exclude<OpponentTimeWindow, 'all'>, number> = {
  '30d': 30, '90d': 90, '180d': 180, '1y': 365,
}

/** Pure: returns top-12 OpponentRecord[] per time window.
 *  Windows are measured backward from `nowMs` (the latest match date in the
 *  dataset). Refs without a parseable `scheduledDateIso` are excluded from
 *  windowed buckets but included in the `all` bucket. */
export function buildOpponentsByWindow(
  refs: PlayerMatchRef[],
  nowMs: number,
): Record<OpponentTimeWindow, OpponentRecord[]> {
  const windows: OpponentTimeWindow[] = ['30d', '90d', '180d', '1y', 'all']
  const buckets: Record<OpponentTimeWindow, OpponentRecord[]> = {
    '30d': [], '90d': [], '180d': [], '1y': [], all: [],
  }
  for (const w of windows) {
    const cutoff = w === 'all'
      ? Number.NEGATIVE_INFINITY
      : nowMs - OPPONENT_WINDOW_DAYS[w] * DAY_MS
    const oppMap = new Map<string, {
      name: string; meetings: number; wins: number; losses: number;
      lastRound: string; lastEvent: string; lastIso: string;
    }>()
    for (const r of refs) {
      const iso = r.scheduledDateIso || ''
      if (w !== 'all') {
        if (!iso) continue
        const ts = Date.parse(iso)
        if (isNaN(ts) || ts < cutoff) continue
      }
      for (let i = 0; i < r.opponentSlugs.length; i++) {
        const oslug = r.opponentSlugs[i]
        const oname = r.opponents[i] || ''
        if (!oslug) continue
        let acc = oppMap.get(oslug)
        if (!acc) {
          acc = { name: oname, meetings: 0, wins: 0, losses: 0,
            lastRound: r.round, lastEvent: r.eventName, lastIso: iso }
          oppMap.set(oslug, acc)
        }
        acc.meetings++
        if (r.outcome === 'W' || r.outcome === 'WO-W' || r.outcome === 'RET-W') acc.wins++
        else acc.losses++
        if (iso > acc.lastIso) {
          acc.lastIso = iso; acc.lastRound = r.round; acc.lastEvent = r.eventName
        }
      }
    }
    buckets[w] = Array.from(oppMap.entries())
      .map(([slug, a]) => ({ slug, name: a.name, meetings: a.meetings,
        wins: a.wins, losses: a.losses, lastRound: a.lastRound, lastEvent: a.lastEvent }))
      .sort((a, b) => b.meetings - a.meetings || b.wins - a.wins || a.slug.localeCompare(b.slug))
      .slice(0, 12)
  }
  return buckets
}
```

Update the top-of-file `import type` block to include `OpponentRecord` and `OpponentTimeWindow`. The existing block is around `lib/playerIndex.ts:4-9`. Find the line listing `PlayerIndex, PlayerRecord, PlayerMatchRef, …` and add the two new names there, e.g.:

```ts
import type {
  Discipline, MatchEntry, ProviderTag,
  PlayerIndex, PlayerRecord, PlayerMatchRef, PlayerIndexTournamentInput,
  Leaderboards, LeaderboardBoard, DisciplineSummary, PlayerEventResult, PlayerRanks,
  PlayerTournamentMatch,
  OpponentRecord, OpponentTimeWindow,
} from './types'
```

- [ ] **Step 2: Run the new test to verify it passes**

Run: `npx jest __tests__/playerIndex.opponentsByWindow.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 3: Run the existing playerIndex tests to confirm no regression**

Run: `npx jest playerIndex`
Expected: all `playerIndex.*` tests still pass. The helper isn't yet wired into `buildIndex`, so the existing aggregate test still uses the inline logic — it should be unaffected.

- [ ] **Step 4: Commit**

```bash
git add lib/playerIndex.ts
git commit -m "feat(player-index): add buildOpponentsByWindow pure helper

Computes top-12 OpponentRecord[] per {30d,90d,180d,1y,all} window,
measured backward from the dataset's latest match (nowMs). Refs
missing scheduledDateIso are excluded from windowed buckets, included
in 'all' — preserves the existing lifetime-totals behavior.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Wire the helper into `buildIndex`

**Files:**
- Modify: `lib/playerIndex.ts:526-546` (replace inline opponent aggregation)

- [ ] **Step 1: Replace the inline aggregation with a helper call**

Find the existing block in `lib/playerIndex.ts` (around lines 526-546) that starts with the comment `// Opponents` and ends with `.slice(0, 12)`. Replace it with:

```ts
    // Opponents — top-12 per time window, plus a backward-compat `opponents`
    // alias pointing at the all-time bucket. nowMs is the dataset's latest
    // match (computed above), so values stay stable across rebuilds.
    const oppByWindow = buildOpponentsByWindow(refs, nowMs)
    rec.opponentsByWindow = oppByWindow
    rec.opponents = oppByWindow.all
```

- [ ] **Step 2: Run the full playerIndex test suite**

Run: `npx jest playerIndex`
Expected: every `playerIndex.*` test passes. The existing aggregate tests still pass because `rec.opponents` is now `oppByWindow.all`, which preserves the prior shape (top 12, same comparator).

- [ ] **Step 3: Confirm via a quick fixture-driven assertion**

Add a single assertion to the existing aggregate test file `__tests__/playerIndex.aggregate.test.ts` — locate the existing `describe('buildIndex — single tournament'` block and add this test case at the end of it (before the closing `})`):

```ts
  it('emits opponentsByWindow with an "all" bucket identical to opponents', () => {
    const { index } = buildIndex('bat', [toyota])
    const sampleSlug = Object.keys(index.players).find(s => index.players[s].opponents.length > 0)!
    const p = index.players[sampleSlug]
    expect(p.opponentsByWindow).toBeDefined()
    expect(p.opponentsByWindow!.all).toEqual(p.opponents)
  })
```

Run: `npx jest playerIndex.aggregate`
Expected: PASS (new test passes; all others unchanged).

- [ ] **Step 4: Commit**

```bash
git add lib/playerIndex.ts __tests__/playerIndex.aggregate.test.ts
git commit -m "feat(player-index): bucket opponents by time window in buildIndex

Replaces the single inline aggregation pass with a call to
buildOpponentsByWindow. PlayerRecord.opponents stays identical to the
'all' bucket so any reader of .opponents keeps working.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Add i18n keys (TKey union + EN/TH dictionaries)

**Files:**
- Modify: `lib/i18n.ts` — three locations:
  - `TKey` union (currently around line 215-300): add new key names
  - EN dictionary entry for `'en'` (entry containing `frequentOpponents: 'Frequent opponents'` ~line 408)
  - TH dictionary entry for `'th'` (entry containing `frequentOpponents: 'คู่ต่อสู้ที่พบบ่อย'` ~line 618)

- [ ] **Step 1: Extend the `TKey` union**

Find the line in the `TKey` union containing `| 'frequentOpponents'` (around `lib/i18n.ts:223`). Directly *after* `| 'frequentPartners'` add:

```ts
  | 'opponentsWin30d' | 'opponentsWin90d' | 'opponentsWin180d'
  | 'opponentsWin1y' | 'opponentsWinAll' | 'opponentsEmptyWindow'
```

- [ ] **Step 2: Add EN translations**

Find the line `frequentPartners: 'Frequent partners',` in the English block (~line 409). Directly *after* it, add:

```ts
    opponentsWin30d: '30 Days',
    opponentsWin90d: '90 Days',
    opponentsWin180d: '180 Days',
    opponentsWin1y: '1 Year',
    opponentsWinAll: 'All Time',
    opponentsEmptyWindow: 'No opponents in this period',
```

- [ ] **Step 3: Add TH translations**

Find the line `frequentPartners: '…',` in the Thai block (~line 619). Directly *after* it, add:

```ts
    opponentsWin30d: '30 วัน',
    opponentsWin90d: '90 วัน',
    opponentsWin180d: '180 วัน',
    opponentsWin1y: '1 ปี',
    opponentsWinAll: 'ทั้งหมด',
    opponentsEmptyWindow: 'ไม่มีคู่ต่อสู้ในช่วงเวลานี้',
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes. If the dictionary type requires every `TKey` to be present in both languages, both blocks now contain the new keys so no type errors fire.

- [ ] **Step 5: Commit**

```bash
git add lib/i18n.ts
git commit -m "i18n(profile): add opponents time-window labels + empty-window string

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Failing UI test for the tab behavior

**Files:**
- Modify: `__tests__/PlayerProfileView.test.tsx`

- [ ] **Step 1: Add a helper factory + four new test cases**

Open `__tests__/PlayerProfileView.test.tsx`. Just above the existing `describe('PlayerProfileView', …` block, add the import for `userEvent` and add a small factory to build a sample with opponents:

```ts
import userEvent from '@testing-library/user-event'
```

Then, inside the existing `describe('PlayerProfileView', …)`, add these test cases at the end of the block (before its closing `})`):

```ts
  function withOpponents(extra: Partial<PlayerRecord> = {}): PlayerRecord {
    const lifetime = [
      { slug: 'lifetime-foe', name: 'Lifetime Foe', meetings: 5, wins: 3, losses: 2, lastRound: 'F', lastEvent: 'BS' },
    ]
    const recent = [
      { slug: 'recent-foe', name: 'Recent Foe', meetings: 2, wins: 1, losses: 1, lastRound: 'R16', lastEvent: 'BS' },
    ]
    return {
      ...sample,
      opponents: lifetime,
      opponentsByWindow: {
        '30d': recent, '90d': recent, '180d': recent, '1y': lifetime, all: lifetime,
      },
      ...extra,
    }
  }

  it('defaults to the All Time tab and renders the lifetime list', () => {
    render(<PlayerProfileView record={withOpponents()} />)
    expect(screen.getByText('Lifetime Foe')).toBeTruthy()
    const allTab = screen.getByRole('tab', { name: 'All Time' })
    expect(allTab.getAttribute('aria-selected')).toBe('true')
  })

  it('switching to 30 Days shows the windowed list', async () => {
    const user = userEvent.setup()
    render(<PlayerProfileView record={withOpponents()} />)
    await user.click(screen.getByRole('tab', { name: '30 Days' }))
    expect(screen.getByText('Recent Foe')).toBeTruthy()
    expect(screen.queryByText('Lifetime Foe')).toBeNull()
  })

  it('empty window shows the empty-state message but keeps the tab strip', async () => {
    const empty = withOpponents({
      opponentsByWindow: {
        '30d': [], '90d': [], '180d': [], '1y': [], all: [
          { slug: 'a', name: 'A', meetings: 1, wins: 1, losses: 0, lastRound: 'F', lastEvent: 'BS' },
        ],
      },
    })
    const user = userEvent.setup()
    render(<PlayerProfileView record={empty} />)
    await user.click(screen.getByRole('tab', { name: '30 Days' }))
    expect(screen.getByText('No opponents in this period')).toBeTruthy()
    // Tab strip remains so the user can switch back
    expect(screen.getByRole('tab', { name: 'All Time' })).toBeTruthy()
  })

  it('legacy record without opponentsByWindow still renders lifetime list on All Time tab', () => {
    const legacy: PlayerRecord = {
      ...sample,
      opponents: [
        { slug: 'legacy', name: 'Legacy Foe', meetings: 7, wins: 4, losses: 3, lastRound: 'SF', lastEvent: 'XD' },
      ],
      // opponentsByWindow intentionally omitted
    }
    render(<PlayerProfileView record={legacy} />)
    expect(screen.getByText('Legacy Foe')).toBeTruthy()
  })
```

- [ ] **Step 2: Confirm `@testing-library/user-event` is already installed**

Run: `grep "user-event" /Users/ed/AI/BATBracket/package.json`

If it is **not** listed, install it as a devDependency (matching versions of `@testing-library/*` already pinned in the file):

```bash
npm install --save-dev @testing-library/user-event@^14
```

If it **is** already listed, skip the install. Either way, don't commit a `package-lock.json` change unless an install actually happened.

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npx jest PlayerProfileView`
Expected: FAIL — the first three new tests fail (no tab role exists yet), the legacy test passes coincidentally (the existing component already renders `record.opponents`).

- [ ] **Step 4: Commit**

```bash
git add __tests__/PlayerProfileView.test.tsx package.json package-lock.json 2>/dev/null
git commit -m "test(profile): failing tests for opponents time-window tabs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

(If `package.json`/`package-lock.json` weren't modified, `git add` will silently drop them — that's fine.)

---

## Task 7: Implement the tabs UI in `PlayerProfileView`

**Files:**
- Modify: `components/PlayerProfileView.tsx`

- [ ] **Step 1: Update imports**

Open `components/PlayerProfileView.tsx`. Replace the existing top imports (lines 1-7) with:

```tsx
'use client'
import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { PlayerRecord, PlayerRanks, PlayerStats, WLRecord, OpponentTimeWindow } from '@/lib/types'
import { weekKeyFromPublishDate } from '@/lib/bat-ranking-player-view'
import { useLanguage } from '@/lib/LanguageContext'
import RankingDetailTabs from './RankingDetailTabs'
```

The only new lines: `OpponentTimeWindow` added to the type import, and the `useLanguage` import.

- [ ] **Step 2: Add the constant + acquire `t()`**

Just below the `RANK_LABELS` constant (around line 32-40), add the windows constant:

```tsx
const OPPONENT_WINDOWS: Array<{ key: OpponentTimeWindow; labelKey:
  'opponentsWin30d' | 'opponentsWin90d' | 'opponentsWin180d' | 'opponentsWin1y' | 'opponentsWinAll' }> = [
  { key: '30d',  labelKey: 'opponentsWin30d'  },
  { key: '90d',  labelKey: 'opponentsWin90d'  },
  { key: '180d', labelKey: 'opponentsWin180d' },
  { key: '1y',   labelKey: 'opponentsWin1y'   },
  { key: 'all',  labelKey: 'opponentsWinAll'  },
]
```

Inside the `PlayerProfileView` component body, near the top (just after the `useRouter` call, around line 47), add:

```tsx
  const { t } = useLanguage()
  const [oppTab, setOppTab] = useState<OpponentTimeWindow>('all')
```

- [ ] **Step 3: Replace the Frequent Opponents block**

Find the current block (lines 336-352) starting with `{record.opponents.length > 0 && (` and ending with the closing `)}` before the Frequent Partners block. Replace **the entire block** with:

```tsx
      {(() => {
        const hasAny =
          (record.opponentsByWindow?.all.length ?? record.opponents.length) > 0
        if (!hasAny) return null
        const list =
          record.opponentsByWindow?.[oppTab] ??
          (oppTab === 'all' ? record.opponents : [])
        return (
          <div className="pp-section">
            <div className="pp-section-head">
              <h2>{t('frequentOpponents')}</h2>
              <div className="pp-time-tabs" role="tablist" aria-label={t('frequentOpponents')}>
                {OPPONENT_WINDOWS.map(w => (
                  <button
                    key={w.key}
                    type="button"
                    role="tab"
                    aria-selected={oppTab === w.key}
                    className={`pp-time-tab${oppTab === w.key ? ' active' : ''}`}
                    onClick={() => setOppTab(w.key)}
                  >{t(w.labelKey)}</button>
                ))}
              </div>
            </div>
            {list.length > 0 ? (
              <div className="pp-ppl-list">
                {list.map(o => (
                  <Link key={o.slug} href={`/player/${record.key.provider}/${o.slug}`} className="pp-ppl-row">
                    <div>
                      <div className="pp-ppl-name">{o.name}</div>
                      <div className="pp-ppl-met">{o.meetings} meetings</div>
                    </div>
                    <div className="pp-ppl-wl"><span className="pp-w">{o.wins}W</span> · <span className="pp-l">{o.losses}L</span></div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>last: {o.lastRound} · {o.lastEvent}</div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="pp-empty">{t('opponentsEmptyWindow')}</div>
            )}
          </div>
        )
      })()}
```

The Frequent Partners block directly below is **unchanged**.

- [ ] **Step 4: Run the UI test suite**

Run: `npx jest PlayerProfileView`
Expected: all five test cases pass (the four new ones + the existing display-name test).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add components/PlayerProfileView.tsx
git commit -m "feat(profile): time-window tabs for Frequent opponents

Adds five tabs (30 Days / 90 Days / 180 Days / 1 Year / All Time)
above the opponents list. Default = All Time, no first-paint
regression. Stale indexes without opponentsByWindow gracefully fall
back to the lifetime list on the All Time tab.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: CSS — tab pills + section header + empty state

**Files:**
- Modify: `app/globals.css` (append in the `.pp-*` block ending around line 2596, before the `.lb-page` block at line 2599)

- [ ] **Step 1: Append new selectors**

Insert these rules in `app/globals.css` directly *after* the existing `.pp-source-note` rule (around line 2596) and *before* the `/* ── Deep player stats: leaderboards page (.lb-*) ── */` comment (around line 2598):

```css
.pp-section-head { display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.pp-section-head h2 { margin: 0; }

.pp-time-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.pp-time-tab { padding: 3px 10px; border-radius: 999px;
  border: 1px solid var(--border); background: transparent;
  font-size: 11px; font-weight: 600; color: var(--muted); cursor: pointer;
  letter-spacing: 0.03em; text-transform: uppercase;
  transition: background 0.15s, color 0.15s, border-color 0.15s; }
.pp-time-tab:hover { background: var(--bg); color: var(--fg); }
.pp-time-tab.active { background: var(--brand); border-color: var(--brand); color: #fff; }

.pp-empty { padding: 12px 8px; font-size: 12px; color: var(--muted);
  text-align: center; font-style: italic; }
```

Note the existing `.pp-section h2` rule (line 2518-2519) gives `margin: 0 0 12px`; we override to `margin: 0` only when the h2 is the direct child of `.pp-section-head`, so the flex header spaces children evenly without a stale bottom-margin on the heading.

- [ ] **Step 2: Visual check (optional, recommended)**

Run the dev server: `npm run dev`, open `http://localhost:3000/player/bat/<some-slug>`, confirm:

1. Tabs render to the right of the "Frequent opponents" heading on desktop, wrap below on narrow viewports.
2. Active tab is filled brand color; inactive tabs are ghost.
3. Clicking each tab swaps the list instantly.
4. A tab with no meetings shows "No opponents in this period" in muted italic, with the tab strip still visible.
5. Dark mode (toggle theme): contrast still readable; brand color works for the active pill.

This step is optional in the sense that the unit tests cover the behavior, but a 30-second visual smoke is worth doing once.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style(profile): pp-time-tabs pill row + empty-state styling

Mirrors the .h2h-filter-tab pattern but slightly smaller — the tabs
sit on the same row as the section heading on desktop, wrap below
on narrow viewports.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Final verification

**Files:** none modified — verification only.

- [ ] **Step 1: Full Jest suite**

Run: `npx jest`
Expected: all tests pass. Pay particular attention to any `playerIndex.*` or `PlayerProfileView` test — if any fails, fix before proceeding.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. Pre-existing errors (if any) should match what was there before this feature.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build completes; the `/player/[provider]/[slug]` route still appears as dynamic; no new lint errors beyond the pre-existing `MatchSchedule.tsx` `<img>` warning.

- [ ] **Step 4: Push the branch (no merge yet)**

```bash
git push -u origin feat/frequent-opponents-time-filter
```

The user will choose whether to open a PR or merge straight to main (matching how they handled prior label-rename work).

- [ ] **Step 5: Note for deploy**

The first deploy after merge needs the existing build step on the server (`npm run build`) so the index is re-emitted with `opponentsByWindow`. Until that runs, the page renders via the graceful-degrade path: All Time tab works (uses legacy `opponents` field), other tabs show empty-state. This is documented in the spec and matches the rest of the project's deploy posture, so no `DEPLOY.md` change is needed.

---

## Out of scope (recorded so we don't scope-creep)

- Same tabs for *Frequent partners*. Easy follow-up if desired.
- URL query-string sync (`?window=30d`).
- Additional windows beyond the five (e.g., 7d, 60d, 2y).
- Filter combinator (window × discipline).
- Real-world `Date.now()` anchor — we use the dataset's `maxIso` snapshot.

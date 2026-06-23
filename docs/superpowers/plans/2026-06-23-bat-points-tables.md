# BAT Ranking Points Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a BAT-only ranking-points engine, a "Points" reference tab on the Leaderboards page, and per-event locked-in points on the player profile — applying the rule that a bye is not a win.

**Architecture:** One pure, fully-tested core module (`lib/points/bat-points.ts`) generates points from a verified formula and decides a player's points row from `bestFinish` + `wins` + `drawSize`. The player index is extended to record `drawSize` per event (needed only for the 0-win/bye branch). Two thin consumers: a static `PointsTableReference` in a new Leaderboards tab, and the player profile fed tournament levels from the meta sidecar.

**Tech Stack:** TypeScript, Next.js 14 (App Router), React, Jest + @testing-library/react.

## Global Constraints

- **BAT-only.** BWF tournaments and BWF player profiles must never show these points. Enforced by: the Points tab renders only when the BAT provider is active; the SSR builds the levels map only when `provider === 'bat'`.
- **Points formula (verified against all 294 published cells, 0 mismatches):** `Math.round(40000 * 0.8**(level-1) * ageFactor(age) * 0.8**roundIndex)`.
  - ageFactor: Open=1, U19=0.625, then ×0.64 per step down (U17, U15, U13, U11, U9).
  - roundIndex: Winner=0, Runner-Up=1, SF=2, QF=3, R16=4, R32=5, R64=6.
- **Placement rule:** Champion → Winner. Won ≥1 match → actual exit round (`bestFinish`). Won 0 matches → first-round loss, row from `drawSize` (64→R64row, 32→R32row, 16→R16row, 8→QF, 4→SF, 2→RunnerUp). Walkover-received counts as a win; a bye never does. Doubles/mixed partners share inputs → identical full points.
- Run tests with `npx jest <path>`. Tests live in `__tests__/`.
- Commit after each task. Do not push or deploy (the user runs deploy explicitly).

---

### Task 1: Core points engine

**Files:**
- Create: `lib/points/bat-points.ts`
- Test: `__tests__/bat-points.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no I/O).
- Produces:
  - `type AgeGroup = 'Open'|'U19'|'U17'|'U15'|'U13'|'U11'|'U9'`
  - `type PointsRound = 'Winner'|'RunnerUp'|'SF'|'QF'|'R16'|'R32'|'R64'`
  - `const AGE_GROUPS: AgeGroup[]` (display order Open→U9)
  - `const POINTS_ROUNDS: PointsRound[]` (Winner→R64)
  - `const ROUND_LABELS: Record<PointsRound, string>`
  - `pointsFor(level: number, age: AgeGroup, round: PointsRound): number`
  - `levelTable(level: number): Record<AgeGroup, number[]>` (each array is 7 values in `POINTS_ROUNDS` order)
  - `ageGroupFromEvent(eventName: string): AgeGroup | null`
  - `pointsRoundFromResult(bestFinish: string, wins: number, drawSize: number | undefined): PointsRound | null`

- [ ] **Step 1: Write the failing test**

Create `__tests__/bat-points.test.ts`:

```ts
import {
  pointsFor, levelTable, ageGroupFromEvent, pointsRoundFromResult,
  AGE_GROUPS, POINTS_ROUNDS,
  type AgeGroup,
} from '@/lib/points/bat-points'

// Published 2563 grid transcribed from the official tables.
// rows order: Winner, Runner-Up, SF(3/4), QF(5/8), R9/16, R17/32, R33/64
const PUBLISHED: Record<number, Record<AgeGroup, number[]>> = {
  1: { Open:[40000,32000,25600,20480,16384,13107,10486], U19:[25000,20000,16000,12800,10240,8192,6554], U17:[16000,12800,10240,8192,6554,5243,4194], U15:[10240,8192,6554,5243,4194,3355,2684], U13:[6554,5243,4194,3355,2684,2147,1718], U11:[4194,3355,2684,2147,1718,1374,1100], U9:[2684,2147,1718,1374,1100,880,704] },
  2: { Open:[32000,25600,20480,16384,13107,10486,8389], U19:[20000,16000,12800,10240,8192,6554,5243], U17:[12800,10240,8192,6554,5243,4194,3355], U15:[8192,6554,5243,4194,3355,2684,2147], U13:[5243,4194,3355,2684,2147,1718,1374], U11:[3355,2684,2147,1718,1374,1100,880], U9:[2147,1718,1374,1100,880,704,563] },
  3: { Open:[25600,20480,16384,13107,10486,8389,6711], U19:[16000,12800,10240,8192,6554,5243,4194], U17:[10240,8192,6554,5243,4194,3355,2684], U15:[6554,5243,4194,3355,2684,2147,1718], U13:[4194,3355,2684,2147,1718,1374,1100], U11:[2684,2147,1718,1374,1100,880,704], U9:[1718,1374,1100,880,704,563,450] },
  4: { Open:[20480,16384,13107,10486,8389,6711,5369], U19:[12800,10240,8192,6554,5243,4194,3355], U17:[8192,6554,5243,4194,3355,2684,2147], U15:[5243,4194,3355,2684,2147,1718,1374], U13:[3355,2684,2147,1718,1374,1100,880], U11:[2147,1718,1374,1100,880,704,563], U9:[1374,1100,880,704,563,450,360] },
  5: { Open:[16384,13107,10486,8389,6711,5369,4295], U19:[10240,8192,6554,5243,4194,3355,2684], U17:[6554,5243,4194,3355,2684,2147,1718], U15:[4194,3355,2684,2147,1718,1374,1100], U13:[2684,2147,1718,1374,1100,880,704], U11:[1718,1374,1100,880,704,563,450], U9:[1100,880,704,563,450,360,288] },
  6: { Open:[13107,10486,8389,6711,5369,4295,3436], U19:[8192,6554,5243,4194,3355,2684,2147], U17:[5243,4194,3355,2684,2147,1718,1374], U15:[3355,2684,2147,1718,1374,1100,880], U13:[2147,1718,1374,1100,880,704,563], U11:[1374,1100,880,704,563,450,360], U9:[880,704,563,450,360,288,231] },
}

describe('bat-points formula', () => {
  it('reproduces every published cell exactly', () => {
    for (let level = 1; level <= 6; level++) {
      for (const age of AGE_GROUPS) {
        POINTS_ROUNDS.forEach((round, i) => {
          expect(pointsFor(level, age, round)).toBe(PUBLISHED[level][age][i])
        })
      }
    }
  })

  it('levelTable returns the full grid for a level', () => {
    expect(levelTable(2)).toEqual(PUBLISHED[2])
  })
})

describe('ageGroupFromEvent', () => {
  it('parses U-age events', () => {
    expect(ageGroupFromEvent('BS U15')).toBe('U15')
    expect(ageGroupFromEvent('XD U19')).toBe('U19')
    expect(ageGroupFromEvent("Boy's singles U9")).toBe('U9')
  })
  it('treats events without a U-age as Open', () => {
    expect(ageGroupFromEvent('MS')).toBe('Open')
    expect(ageGroupFromEvent('XD')).toBe('Open')
  })
  it('returns null for U-ages outside the table', () => {
    expect(ageGroupFromEvent('XD U23')).toBeNull()
    expect(ageGroupFromEvent('BS U7')).toBeNull()
  })
})

describe('pointsRoundFromResult', () => {
  it('returns Winner for a champion regardless of wins/drawSize', () => {
    expect(pointsRoundFromResult('Champion', 4, 32)).toBe('Winner')
  })
  it('uses the actual exit round once the player has won a match', () => {
    expect(pointsRoundFromResult('F', 3, 32)).toBe('RunnerUp')   // bye'd finalist not demoted
    expect(pointsRoundFromResult('QF', 1, 32)).toBe('QF')        // bye'd quarterfinalist not demoted
    expect(pointsRoundFromResult('R16', 1, 32)).toBe('R16')      // normal R16 loser (won R32)
  })
  it('credits a 0-win player as a first-round loss from drawSize', () => {
    expect(pointsRoundFromResult('R16', 0, 32)).toBe('R32')      // bye into R16 then lost, 32-draw
    expect(pointsRoundFromResult('R16', 0, 16)).toBe('R16')      // genuine first-round loss in a 16-draw
    expect(pointsRoundFromResult('R32', 0, 64)).toBe('R64')      // two byes then lost, 64-draw
  })
  it('returns null when a row cannot be determined', () => {
    expect(pointsRoundFromResult('R16', 0, undefined)).toBeNull() // 0 wins, drawSize missing
    expect(pointsRoundFromResult('R128', 1, 128)).toBeNull()      // off table
    expect(pointsRoundFromResult('RR', 1, undefined)).toBeNull()  // group-only
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/bat-points.test.ts`
Expected: FAIL — cannot find module `@/lib/points/bat-points`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/points/bat-points.ts`:

```ts
// Pure BAT ranking-points engine. The 2563 (2020) accumulated-points tables
// are reproduced exactly by a closed-form formula (verified against all 294
// published cells), so we generate values rather than hardcode them.

export type AgeGroup = 'Open' | 'U19' | 'U17' | 'U15' | 'U13' | 'U11' | 'U9'

// Table rows, best → worst.
export type PointsRound = 'Winner' | 'RunnerUp' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64'

export const AGE_GROUPS: AgeGroup[] = ['Open', 'U19', 'U17', 'U15', 'U13', 'U11', 'U9']
export const POINTS_ROUNDS: PointsRound[] = ['Winner', 'RunnerUp', 'SF', 'QF', 'R16', 'R32', 'R64']

export const ROUND_LABELS: Record<PointsRound, string> = {
  Winner: 'Winner',
  RunnerUp: 'Runner-Up',
  SF: 'round 3/4',
  QF: 'Round 5/8',
  R16: 'Round 9/16',
  R32: 'Round 17/32',
  R64: 'Round 33/64',
}

const BASE = 40000

// Open=1, U19=0.625, then ×0.64 per step down.
const AGE_FACTOR: Record<AgeGroup, number> = {
  Open: 1,
  U19: 0.625,
  U17: 0.625 * 0.64,
  U15: 0.625 * 0.64 ** 2,
  U13: 0.625 * 0.64 ** 3,
  U11: 0.625 * 0.64 ** 4,
  U9: 0.625 * 0.64 ** 5,
}

const ROUND_INDEX: Record<PointsRound, number> = {
  Winner: 0, RunnerUp: 1, SF: 2, QF: 3, R16: 4, R32: 5, R64: 6,
}

export function pointsFor(level: number, age: AgeGroup, round: PointsRound): number {
  return Math.round(BASE * 0.8 ** (level - 1) * AGE_FACTOR[age] * 0.8 ** ROUND_INDEX[round])
}

export function levelTable(level: number): Record<AgeGroup, number[]> {
  const out = {} as Record<AgeGroup, number[]>
  for (const age of AGE_GROUPS) {
    out[age] = POINTS_ROUNDS.map((r) => pointsFor(level, age, r))
  }
  return out
}

const AGE_FROM_NUM: Record<number, AgeGroup> = {
  9: 'U9', 11: 'U11', 13: 'U13', 15: 'U15', 17: 'U17', 19: 'U19',
}

// Parse the age group from an event name. "BS U15" → U15; "MS"/"XD" → Open;
// U-ages outside the table (U7, U23) → null.
export function ageGroupFromEvent(eventName: string): AgeGroup | null {
  const m = eventName.match(/U\s*(\d{1,2})/i)
  if (!m) return 'Open'
  return AGE_FROM_NUM[Number(m[1])] ?? null
}

// bestFinish (actual exit round) → row, used once the player has won a match.
// R128 / RR fall outside the published table.
const ROUND_FROM_FINISH: Record<string, PointsRound> = {
  Champion: 'Winner', F: 'RunnerUp', SF: 'SF', QF: 'QF', R16: 'R16', R32: 'R32', R64: 'R64',
}

// drawSize (the draw's opening-round size) → the first-round-loss row, used for
// a 0-win player. 128+ is off table.
const SIZE_TO_ROUND: Record<number, PointsRound> = {
  2: 'RunnerUp', 4: 'SF', 8: 'QF', 16: 'R16', 32: 'R32', 64: 'R64',
}

// Decide the points row for a player's result, applying the bye rule:
//  - Champion → Winner.
//  - Won ≥1 match → the round they actually reached (bestFinish). A bye earlier
//    in the run does not demote a player who went on to win a match.
//  - Won 0 matches → first-round loss, credited at the draw's opening round
//    (this is the only branch the bye rule corrects, and the only one needing
//    drawSize). Walkovers-received already count toward `wins`; byes never do.
// Returns null when no row applies (off-table round, group-only, or a 0-win
// result with no drawSize available).
export function pointsRoundFromResult(
  bestFinish: string,
  wins: number,
  drawSize: number | undefined,
): PointsRound | null {
  if (bestFinish === 'Champion') return 'Winner'
  if (wins <= 0) return drawSize ? SIZE_TO_ROUND[drawSize] ?? null : null
  return ROUND_FROM_FINISH[bestFinish] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/bat-points.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/points/bat-points.ts __tests__/bat-points.test.ts
git commit -m "feat(points): BAT ranking-points engine (formula + bye-aware placement)"
```

---

### Task 2: Capture `drawSize` per event in the player index

**Files:**
- Modify: `lib/types.ts` (add `drawSize?` to `PlayerEventResult`)
- Modify: `lib/playerIndex.ts`
- Test: `__tests__/playerIndex.drawSize.test.ts`

**Interfaces:**
- Consumes: existing `buildIndex(provider, tournaments)` and `MatchEntry`/`PlayerMatchRef` rounds (normalized to `R128|R64|R32|R16|QF|SF|Final|RR`).
- Produces: `PlayerEventResult.drawSize?: number` — the event's opening-round size (largest round present across all players' matches in that event). Used by `pointsRoundFromResult`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/playerIndex.drawSize.test.ts`:

```ts
import { buildIndex } from '@/lib/playerIndex'
import type { MatchEntry, MatchesData, PlayerIndexTournamentInput } from '@/lib/types'

// A 32-draw event: at least one R32 match exists (Carol beats Dave), and Alice
// byed the first round — her only match is an R16 loss. drawSize must be read
// from the whole bracket (32), not from Alice's own deepest round (R16).
const r32: MatchEntry = {
  draw: 'BS U15', drawNum: '9', round: 'R32',
  team1: [{ name: 'Carol', playerId: 'c' }],
  team2: [{ name: 'Dave', playerId: 'd' }],
  winner: 1, scores: [{ t1: 21, t2: 10 }, { t1: 21, t2: 9 }],
  court: '1', walkover: false, retired: false, nowPlaying: false,
}
const r16: MatchEntry = {
  draw: 'BS U15', drawNum: '9', round: 'R16',
  team1: [{ name: 'Carol', playerId: 'c' }],
  team2: [{ name: 'Alice', playerId: 'a' }],
  winner: 1, scores: [{ t1: 21, t2: 15 }, { t1: 21, t2: 18 }],
  court: '1', walkover: false, retired: false, nowPlaying: false,
}

function input(matches: MatchEntry[]): PlayerIndexTournamentInput {
  const data: MatchesData = {
    days: [{ date: '2569-05-28', label: 'Day 1', dateIso: '2026-05-28' }],
    currentDate: '2569-05-28',
    groups: [{ type: 'time', time: '09:00', matches }],
  }
  return { tournamentId: 'T1', tournamentName: 'Test Open', tournamentDateIso: '2026-05-28', data, clubs: {} }
}

describe('buildIndex — drawSize per event', () => {
  const { index } = buildIndex('bat', [input([r32, r16])])

  it('records the bracket opening size (32) for a byed first-round player', () => {
    const ev = index.players['alice'].tournaments[0].events[0]
    expect(ev.drawSize).toBe(32)
    expect(ev.wins).toBe(0)
  })

  it('records the same drawSize for a player who played the R32 round', () => {
    const ev = index.players['carol'].tournaments[0].events[0]
    expect(ev.drawSize).toBe(32)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/playerIndex.drawSize.test.ts`
Expected: FAIL — `ev.drawSize` is `undefined`.

- [ ] **Step 3: Add the field to the type**

In `lib/types.ts`, in `interface PlayerEventResult` (after `wins` / `losses`), add:

```ts
  /** Opening-round size of the event's bracket (largest round present:
   *  R64→64, R32→32, …, Final→2). Drives the bye-aware first-round-loss
   *  points row. Optional so previously-cached indexes still load. */
  drawSize?: number
```

- [ ] **Step 4: Compute drawSize in the index builder**

In `lib/playerIndex.ts`, add this map near the top-level `ROUND_MAP` (after line ~42):

```ts
const ROUND_SIZE: Record<string, number> = {
  Final: 2, SF: 4, QF: 8, R16: 16, R32: 32, R64: 64, R128: 128,
}
```

Inside `buildIndex`, immediately before the final per-player loop
`for (const [slug, rec] of Array.from(records.entries())) {`, add a pre-pass over
every player's refs to find each event's largest round:

```ts
  // Per-event opening-round size, read from the whole bracket. A single
  // player's refs can omit early rounds (byes), so we scan all players.
  const drawSizeByEvent = new Map<string, number>()
  for (const sc of Array.from(scratches.values())) {
    for (const r of sc.refs) {
      const sz = ROUND_SIZE[r.round]
      if (!sz) continue
      const key = `${r.tournamentId}:${r.eventName}`
      if (sz > (drawSizeByEvent.get(key) ?? 0)) drawSizeByEvent.set(key, sz)
    }
  }
```

Then, in the per-event assembly, change the `events.push({ ... })` object (the
one with `bestFinish: finish, wins, losses,`) to include drawSize when known:

```ts
        const drawSize = drawSizeByEvent.get(`${t.tournamentId}:${eventName}`)
        events.push({
          tournamentId: t.tournamentId,
          eventId,
          eventName,
          discipline: classifyDiscipline(teamSize, eventName),
          bestFinish: finish,
          wins, losses,
          ...(drawSize && { drawSize }),
        })
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/playerIndex.drawSize.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the existing playerIndex suite to confirm no regressions**

Run: `npx jest playerIndex`
Expected: PASS (all existing playerIndex.* tests still green).

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/playerIndex.ts __tests__/playerIndex.drawSize.test.ts
git commit -m "feat(points): record per-event drawSize in the player index"
```

---

### Task 3: Points reference table component

**Files:**
- Create: `components/PointsTableReference.tsx`
- Test: `__tests__/points-table-reference.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `levelTable`, `AGE_GROUPS`, `POINTS_ROUNDS`, `ROUND_LABELS` from `lib/points/bat-points`.
- Produces: `export default function PointsTableReference(): JSX.Element` — renders all six level tables. No props.

- [ ] **Step 1: Write the failing test**

Create `__tests__/points-table-reference.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import PointsTableReference from '@/components/PointsTableReference'

describe('PointsTableReference', () => {
  it('renders all six level tables', () => {
    render(<PointsTableReference />)
    for (const lv of ['Lv1', 'Lv2', 'Lv3', 'Lv4', 'Lv5', 'Lv6']) {
      expect(screen.getByText(lv)).toBeInTheDocument()
    }
  })

  it('shows the known Lv1 Open Winner value', () => {
    render(<PointsTableReference />)
    expect(screen.getAllByText('40,000').length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/points-table-reference.test.tsx`
Expected: FAIL — cannot find module `@/components/PointsTableReference`.

- [ ] **Step 3: Write minimal implementation**

Create `components/PointsTableReference.tsx`:

```tsx
import { levelTable, AGE_GROUPS, POINTS_ROUNDS, ROUND_LABELS } from '@/lib/points/bat-points'

const LEVELS = [1, 2, 3, 4, 5, 6]

export default function PointsTableReference() {
  return (
    <div className="pts-ref">
      {LEVELS.map((lv) => {
        const grid = levelTable(lv)
        return (
          <div className="pts-ref-block" key={lv}>
            <h3 className="pts-ref-title">Lv{lv}</h3>
            <div className="pts-ref-scroll">
              <table className="pts-ref-table">
                <thead>
                  <tr>
                    <th>Rounds</th>
                    {AGE_GROUPS.map((age) => (
                      <th key={age}>{age}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {POINTS_ROUNDS.map((round, i) => (
                    <tr key={round}>
                      <th scope="row">{ROUND_LABELS[round]}</th>
                      {AGE_GROUPS.map((age) => (
                        <td key={age}>{grid[age][i].toLocaleString('en-US')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/points-table-reference.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Add minimal styles**

Append to `app/globals.css`:

```css
/* Points reference tables (Leaderboards → Points tab) */
.pts-ref { display: flex; flex-direction: column; gap: 20px; }
.pts-ref-title { margin: 0 0 6px; font-size: 14px; font-weight: 700; color: var(--fg); }
.pts-ref-scroll { overflow-x: auto; }
.pts-ref-table { border-collapse: collapse; font-size: 12px; min-width: 560px; }
.pts-ref-table th, .pts-ref-table td {
  border: 1px solid var(--border); padding: 4px 8px; text-align: right; white-space: nowrap;
}
.pts-ref-table thead th { background: var(--surface-2, #f3f4f6); text-align: center; }
.pts-ref-table tbody th[scope="row"] { text-align: left; font-weight: 600; }
```

- [ ] **Step 6: Commit**

```bash
git add components/PointsTableReference.tsx __tests__/points-table-reference.test.tsx app/globals.css
git commit -m "feat(points): reference table component for all six levels"
```

---

### Task 4: Wire the "Points" tab into Leaderboards (BAT only)

**Files:**
- Modify: `lib/i18n.ts` (add `lbPoints` to the `TKey` union and to the `en` + `th` dictionaries)
- Modify: `components/LeaderboardsView.tsx`

**Interfaces:**
- Consumes: `PointsTableReference` (Task 3); `lbPoints` i18n key.
- Produces: a `'points'` tab visible only when the active provider is `bat`; when active, the body renders `<PointsTableReference />` instead of the boards grid.

- [ ] **Step 1: Add the i18n key**

In `lib/i18n.ts`, add `lbPoints` to the `TKey` union next to the other `lb*` keys (around line 248):

```ts
  | 'lbHeadline' | 'lbDiscipline' | 'lbCharacter' | 'lbActivity' | 'lbRanking'
  | 'lbPoints'
```

In the English dictionary (near `lbRanking: 'Ranking',`):

```ts
    lbPoints: 'Points',
```

In the Thai dictionary (near its `lbRanking` entry):

```ts
    lbPoints: 'ตารางคะแนน',
```

- [ ] **Step 2: Import the component and widen the active-tab state**

In `components/LeaderboardsView.tsx`:

Add the import near the other component imports:

```ts
import PointsTableReference from './PointsTableReference'
```

Add a local tab-id type above the component (near `CATEGORIES`, around line 45):

```ts
type ActiveTab = LeaderboardCategory | 'points'
```

Change the `active` state (line ~71) from:

```ts
  const [active, setActive] = useState<LeaderboardCategory>('ranking')
```

to:

```ts
  const [active, setActive] = useState<ActiveTab>('ranking')
```

- [ ] **Step 3: Compute a points-tab flag and guard the existing body**

Replace the `effectiveActive` line (line ~177) with these two lines:

```ts
  const pointsActive = active === 'points' && activeProvider === 'bat'
  const effectiveActive = pointsActive
    ? active
    : (availableCategories.some(c => c.id === active) ? (active as LeaderboardCategory) : availableCategories[0]?.id ?? (active as LeaderboardCategory))
```

- [ ] **Step 4: Render the Points tab button (BAT only)**

In the `<div className="lb-tabs">` block (around line 229), after the `availableCategories.map(...)` buttons and before the closing `</div>`, add:

```tsx
        {activeProvider === 'bat' && (
          <button
            className={`lb-tab ${pointsActive ? 'lb-active' : ''}`}
            onClick={() => setActive('points')}>
            {t('lbPoints')}
          </button>
        )}
```

- [ ] **Step 5: Branch the body to the reference tables**

Change the ranking sub-header guard (line ~238) from `{effectiveActive === 'ranking' && activeRankingPublishDate && (` to:

```tsx
      {!pointsActive && effectiveActive === 'ranking' && activeRankingPublishDate && (
```

Immediately before `<div className="lb-grid">` add:

```tsx
      {pointsActive && <PointsTableReference />}
```

Change the grid opener from `<div className="lb-grid">` to:

```tsx
      {!pointsActive && <div className="lb-grid">
```

…and find the `</div>` that closes `lb-grid` and change it to `</div>}`.

- [ ] **Step 6: Typecheck and run the suite**

Run: `npx tsc --noEmit 2>&1 | grep -v 'scripts/ravin' | grep -E 'LeaderboardsView|i18n|points' || echo "no errors in touched files"`
Expected: `no errors in touched files`.

Run: `npx jest __tests__/points-table-reference.test.tsx __tests__/bat-points.test.ts`
Expected: PASS.

- [ ] **Step 7: Manual verification**

Run `npm run dev`, open `http://localhost:3000/leaderboards`. With the BAT provider active, confirm a "Points" tab appears, clicking it shows six level tables, and switching to the BWF provider tab hides "Points". Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add lib/i18n.ts components/LeaderboardsView.tsx
git commit -m "feat(points): Points reference tab on Leaderboards (BAT only)"
```

---

### Task 5: Player-profile locked-in points projection

**Files:**
- Modify: `app/player/[provider]/[slug]/page.tsx` (build `tournamentLevels` for BAT, pass to the view)
- Modify: `components/PlayerProfileView.tsx` (accept `tournamentLevels`, render per-event points)
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `readMeta` from `lib/tournament-meta`; `pointsFor`, `ageGroupFromEvent`, `pointsRoundFromResult` from `lib/points/bat-points`; `PlayerEventResult.drawSize` (Task 2).
- Produces: `PlayerProfileView` prop `tournamentLevels?: Record<string, number>` (tournamentId → level). When present, the Tournament-History event chips show `≈<points> pts` for computable BAT events.

- [ ] **Step 1: Build the levels map in SSR**

In `app/player/[provider]/[slug]/page.tsx`, add the import:

```ts
import { readMeta } from '@/lib/tournament-meta'
```

Inside `if (record) {` (just before its `return (`), build the map (BAT only;
meta files are keyed by upper-case GUID):

```ts
    let tournamentLevels: Record<string, number> | undefined
    if (provider === 'bat') {
      const pairs = await Promise.all(
        record.tournaments.map(async (t) => {
          const meta = await readMeta(t.tournamentId.toUpperCase())
          return [t.tournamentId, meta?.level] as const
        }),
      )
      tournamentLevels = {}
      for (const [id, lvl] of pairs) {
        if (typeof lvl === 'number' && lvl > 0) tournamentLevels[id] = lvl
      }
    }
```

Add this prop to the `<PlayerProfileView ... />` element:

```tsx
        tournamentLevels={tournamentLevels}
```

- [ ] **Step 2: Accept the prop in PlayerProfileView**

In `components/PlayerProfileView.tsx`, add the import:

```ts
import { pointsFor, ageGroupFromEvent, pointsRoundFromResult, AGE_GROUPS } from '@/lib/points/bat-points'
```

Add to the `Props` interface (after `countryFlagUrl?: string`):

```ts
  /** BAT tournamentId → level (1-6). Present only for BAT profiles; drives the
   *  locked-in points shown per event. Absent for BWF. */
  tournamentLevels?: Record<string, number>
```

Add `tournamentLevels` to the destructured params (line ~58):

```ts
export default function PlayerProfileView({ record, playerRankings, rankingPublishDate, initialDetail, currentRanking, countryFlagUrl, tournamentLevels }: Props) {
```

- [ ] **Step 3: Precompute points + per-discipline "counts" per tournament**

The Tournament-History list maps `t.events` inside `[...record.tournaments]
.sort(...).map(t => ( <div className="pp-tour" ...> ... ))`. Convert that outer
arrow to a block body so we can precompute per tournament. Change:

```tsx
            .map(t => (
            <div className="pp-tour" key={t.tournamentId}>
```

to:

```tsx
            .map(t => {
            // Points per event, then per discipline the max-points event is the
            // one that counts toward ranking (others are superseded). Ties break
            // to the older age group (lower AGE_GROUPS index).
            const lvl = tournamentLevels?.[t.tournamentId]
            const evPts = new Map<string, number | null>()
            const bestByDisc = new Map<string, { key: string; pts: number; ageRank: number }>()
            for (const e of t.events) {
              const key = e.eventId + e.eventName
              const ageG = ageGroupFromEvent(e.eventName)
              const round = pointsRoundFromResult(e.bestFinish, e.wins, e.drawSize)
              const pts = lvl && ageG && round ? pointsFor(lvl, ageG, round) : null
              evPts.set(key, pts)
              if (pts != null) {
                const ageRank = ageG ? AGE_GROUPS.indexOf(ageG) : 99
                const cur = bestByDisc.get(e.discipline)
                if (!cur || pts > cur.pts || (pts === cur.pts && ageRank < cur.ageRank)) {
                  bestByDisc.set(e.discipline, { key, pts, ageRank })
                }
              }
            }
            return (
            <div className="pp-tour" key={t.tournamentId}>
```

Then add the matching close: the outer map currently ends with `))` after the
tournament `</div>`. Change that `))` to `)})`.

In the inner `t.events.map(e => { ... })` block, after the `const medalClass =
...` assignment, add:

```ts
                  const evKey = e.eventId + e.eventName
                  const evPoints = evPts.get(evKey) ?? null
                  const counts = bestByDisc.get(e.discipline)?.key === evKey
```

In the returned chip JSX, after the W–L span (line ~284), add:

```tsx
                      <span className="pp-ev-chip-wl">{e.wins}–{e.losses}</span>
                      {evPoints != null && (
                        <> · <span
                          className={`pp-ev-chip-pts ${counts ? '' : 'pp-ev-chip-pts-superseded'}`}
                          title={counts ? 'Projected ranking points (from tournament level)' : 'Superseded — a higher-scoring result in this discipline counts toward ranking'}
                        >≈{evPoints.toLocaleString('en-US')} pts</span></>
                      )}
```

- [ ] **Step 4: Add a minimal style for the points span**

Append to `app/globals.css`:

```css
.pp-ev-chip-pts { color: var(--muted); font-variant-numeric: tabular-nums; }
.pp-ev-chip-pts-superseded { text-decoration: line-through; opacity: 0.6; }
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v 'scripts/ravin' | grep -E 'PlayerProfileView|player/\[provider\]' || echo "no errors in touched files"`
Expected: `no errors in touched files`.

- [ ] **Step 6: Rebuild the player index, then verify**

The `drawSize` field (Task 2) only appears in a freshly built index. Rebuild it,
then check a player:

Run: `npm run dev`. Trigger an index rebuild via the app's existing rebuild route
(`curl -s -X POST http://localhost:3000/api/players/rebuild`), then open a BAT
player who has a tournament shown with a level badge (e.g. `(L2)`). In Tournament
history, confirm:
- A 0-win event with a first-round bye shows the first-round-loss points (e.g. a
  bye-into-R16 loss in a Level 2 32-draw U17 event shows ≈4,194 = the Round
  17/32 row for Lv2 U17).
- A normal R16 loss (≥1 win) shows the Round 9/16 value.
- Events with unknown level/age/round show no points.
Open a BWF player and confirm no points appear anywhere. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add app/player/[provider]/[slug]/page.tsx components/PlayerProfileView.tsx app/globals.css
git commit -m "feat(points): locked-in points per event on player profile (BAT only)"
```

---

## Self-Review

**Spec coverage:**
- Formula + generated tables → Task 1 (+ test pins 294 cells). ✓
- Bye-aware placement (champion / ≥1-win exit / 0-win first-round) → Task 1 `pointsRoundFromResult` (+ tests for the bye finalist, bye QF, bye-into-R16, two-bye 64-draw). ✓
- Walkover counts as win → relies on existing `wins` (WO-W) semantics; no change needed; asserted indirectly via the ≥1-win branch. ✓
- drawSize from the full bracket → Task 2 (+ test with a byed player). ✓
- Reference viewer, BAT-only tab → Tasks 3 + 4. ✓
- Player projection, locked-in, BAT-only, SSR level map → Task 5. ✓
- Doubles/mixed same points → inherent (partners share wins/drawSize/bestFinish); no special code. ✓
- Edge cases (unknown level/age, off-table, missing drawSize, RR, BWF) → Task 1 returns null + Task 5 conditional render + provider gating. ✓

**Placeholder scan:** none — every step carries concrete code/commands.

**Type consistency:** `AgeGroup`, `PointsRound`, `pointsFor`, `levelTable`, `ageGroupFromEvent`, `pointsRoundFromResult(bestFinish, wins, drawSize)`, `PlayerEventResult.drawSize`, `tournamentLevels` are used identically across tasks. `levelTable`'s `Record<AgeGroup, number[]>` (arrays in `POINTS_ROUNDS` order) matches the `PUBLISHED` shape in Task 1 and the indexing in Task 3.

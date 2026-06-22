# Top Players W-L Hover Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hover/focus tooltip on the W-L cell in the *Top players (by tournament wins)* stats table that lists the player's match-by-match results for the tournament.

**Architecture:** Extend `StatsTopPlayer` with an optional `results[]` array, populate it inside the existing tally loop in `buildTopPlayers` (off the identical filter so counts can't drift), bump the stats cache version so envelopes recompute, then render a `WLCell` component cloned from the existing `MedalCell`/`RosterCell` tooltip pattern. Pure additive change — no new API surface.

**Tech Stack:** TypeScript, React (Next.js client component), Jest + @testing-library/react, plain CSS (`app/globals.css`).

---

## Spec

`docs/superpowers/specs/2026-06-21-top-players-wl-tooltip-design.md`

## File Structure

- `lib/types.ts` — add `StatsPlayerResult` interface; add `results?` to `StatsTopPlayer`.
- `lib/tournamentStats.ts` — populate `results` in `buildTopPlayers`; add a `roundSize` sort helper; import `abbrevRoundL`.
- `lib/stats-cache.ts` — bump cache version 10 → 11.
- `components/TournamentStatsPanel.tsx` — add `WLCell`, use it at the W-L cell; import `abbrevRoundL` and `StatsPlayerResult`.
- `app/globals.css` — add `stats-wl-cell` / `stats-wl-tip` / `stats-wl-tip-row` styles.
- `__tests__/tournamentStats.test.ts` — reconciliation + orientation assertions (uses existing SPRC fixture).
- `__tests__/TournamentStatsPanel.test.tsx` — renders tooltip rows; back-compat with absent `results`.

---

## Task 1: Add the data model

**Files:**
- Modify: `lib/types.ts:257-264` (the `StatsTopPlayer` interface)

- [ ] **Step 1: Add `StatsPlayerResult` and extend `StatsTopPlayer`**

In `lib/types.ts`, replace the existing `StatsTopPlayer` interface (currently lines 257-264) with:

```ts
export interface StatsPlayerResult {
  event: string        // match.draw, e.g. "MD", "BS U15"
  round: string        // raw round string; rendered via abbrevRoundL at display time
  won: boolean
  opponent: string[]   // opposing team player names, seed-stripped
  scores: MatchScore[] // PLAYER-perspective: t1 is always the player's side
  retired?: boolean    // retired matches still count in W-L; flagged for a "(ret.)" marker
}

export interface StatsTopPlayer {
  playerId: string
  name: string
  seed?: string
  club: string
  wins: number
  losses: number
  results?: StatsPlayerResult[]
}
```

`MatchScore` is already defined in this file (lines 58-61) — no import needed.

- [ ] **Step 2: Type-check**

Run: `cd /Users/ed/AI/BATBracket && npx tsc --noEmit`
Expected: PASS (no errors). The field is optional, so existing `topPlayers: []` init sites and test fixtures remain valid.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(stats): add StatsPlayerResult model for W-L tooltip"
```

---

## Task 2: Populate `results` in `buildTopPlayers`

**Files:**
- Modify: `lib/tournamentStats.ts:459-496` (`buildTopPlayers`) and the import block at the top
- Test: `__tests__/tournamentStats.test.ts` (append to the existing "top players" describe block, ~line 103-111)

- [ ] **Step 1: Write the failing test**

In `__tests__/tournamentStats.test.ts`, inside the existing `describe('tournamentStats — top players', ...)` block, add these tests after the existing `it('top player has 11 wins', ...)`:

```ts
  it('attaches per-match results that reconcile with the W-L record', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    for (const p of s.topPlayers) {
      expect(p.results).toBeDefined()
      const won = p.results!.filter((r) => r.won).length
      const lost = p.results!.filter((r) => !r.won).length
      expect(won).toBe(p.wins)
      expect(lost).toBe(p.losses)
    }
  })

  it('orders a player results by event then round depth (shallow first)', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    const top = s.topPlayers[0]
    expect(top.results!.length).toBe(top.wins + top.losses)
    // Within a single event, the Final (if present) is never the first row.
    const byEvent = new Map<string, typeof top.results>()
    for (const r of top.results!) {
      const arr = byEvent.get(r.event) ?? []
      arr!.push(r)
      byEvent.set(r.event, arr!)
    }
    for (const arr of byEvent.values()) {
      const finalIdx = arr!.findIndex((r) => r.round.toLowerCase().includes('final') || r.round === 'F')
      if (finalIdx >= 0 && arr!.length > 1) expect(finalIdx).toBe(arr!.length - 1)
    }
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/ed/AI/BATBracket && npx jest tournamentStats -t "results"`
Expected: FAIL — `p.results` is `undefined` (`expect(received).toBeDefined()`).

- [ ] **Step 3: Add the `abbrevRoundL` import and a `roundSize` helper**

In `lib/tournamentStats.ts`, change the first import line:

```ts
import { longRoundL } from './i18n'
```

to:

```ts
import { abbrevRoundL, longRoundL } from './i18n'
```

Then add this helper immediately above `function buildTopPlayers` (just before line 459):

```ts
// Bracket size of a round, used to sort a player's results shallow→deep
// (R128 first … Final last). abbrevRoundL normalizes any locale/spelling to
// F / SF / QF / R{n}; unknown rounds (e.g. round-robin) sink to the front.
function roundSize(round: string): number {
  const a = abbrevRoundL(round, 'en')
  if (a === 'F') return 2
  if (a === 'SF') return 4
  if (a === 'QF') return 8
  const m = /^R(\d+)$/.exec(a)
  if (m) return Number(m[1])
  return Number.POSITIVE_INFINITY
}
```

- [ ] **Step 4: Collect results inside the tally loop**

In `buildTopPlayers`, replace the whole function body (lines 459-496) with the version below. Changes from the original: `Rec` gains a `results` array; both team loops push a `StatsPlayerResult` using the same `winner !== null && !walkover` guard; scores are oriented to the player's side; opponents are seed-stripped; each player's results are sorted before emit.

```ts
function buildTopPlayers(ctxs: MatchCtx[], clubs: Record<string, string>): ComputedStats['topPlayers'] {
  interface Rec { name: string; wins: number; losses: number; results: StatsPlayerResult[] }
  const tally = new Map<string, Rec>()
  const countryByPid = new Map<string, string>()

  const recordSide = (
    players: MatchPlayer[],
    side: 1 | 2,
    winSide: 1 | 2,
    opponents: MatchPlayer[],
    scores: MatchScore[],
    match: MatchEntry,
  ) => {
    const oriented = side === 1 ? scores : scores.map((s) => ({ t1: s.t2, t2: s.t1 }))
    const opponent = opponents.map((p) => extractSeed(p.name).plain)
    for (const p of players) {
      if (!p.playerId) continue
      const r = tally.get(p.playerId) ?? { name: p.name, wins: 0, losses: 0, results: [] }
      const won = winSide === side
      if (won) r.wins++; else r.losses++
      r.results.push({
        event: match.draw,
        round: match.round,
        won,
        opponent,
        scores: oriented,
        retired: match.retired || undefined,
      })
      tally.set(p.playerId, r)
      if (p.country && !countryByPid.has(p.playerId)) countryByPid.set(p.playerId, p.country)
    }
  }

  for (const { match } of ctxs) {
    if (match.winner === null || match.walkover) continue
    const winSide = match.winner
    recordSide(match.team1, 1, winSide, match.team2, match.scores, match)
    recordSide(match.team2, 2, winSide, match.team1, match.scores, match)
  }

  const clubOf = (pid: string) => {
    const c = (clubs[pid] ?? '').trim()
    if (c) return c
    const country = (countryByPid.get(pid) ?? '').trim()
    return country || '—'
  }
  const rows = Array.from(tally.entries()).map(([playerId, r]) => {
    const { plain, seed } = extractSeed(r.name)
    const results = r.results.slice().sort((a, b) =>
      eventRank(a.event) - eventRank(b.event) ||
      (a.event < b.event ? -1 : a.event > b.event ? 1 : 0) ||
      roundSize(b.round) - roundSize(a.round),
    )
    return { playerId, name: plain, seed, club: clubOf(playerId), wins: r.wins, losses: r.losses, results }
  })
  rows.sort((a, b) => b.wins - a.wins || a.losses - b.losses || (a.playerId < b.playerId ? -1 : 1))
  return rows.slice(0, 12)
}
```

Add `StatsPlayerResult` and `MatchPlayer` to the existing `import type { ... } from './types'` block near the top of the file if they are not already imported. (`MatchEntry`, `MatchScore` are already imported; verify and add only what's missing.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/ed/AI/BATBracket && npx jest tournamentStats`
Expected: PASS — all `tournamentStats` tests, including the two new ones and the unchanged `top player has 11 wins`.

- [ ] **Step 6: Type-check**

Run: `cd /Users/ed/AI/BATBracket && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/tournamentStats.ts __tests__/tournamentStats.test.ts
git commit -m "feat(stats): build per-match results for top players"
```

---

## Task 3: Bump the stats cache version

**Files:**
- Modify: `lib/stats-cache.ts:27-48` (version comment, `version: 10`, and the `!== 10` guard in `readStatsCache`)

- [ ] **Step 1: Add a version comment**

In `lib/stats-cache.ts`, after the existing `// v10 ...` comment block (ends ~line 31, just before `// Bumping the version...`), insert:

```ts
// v11 adds results[] (match-by-match) to each topPlayers row, powering the
// W-L hover tooltip. v10 envelopes have no results, so the tooltip would be
// empty until re-aggregated.
```

- [ ] **Step 2: Change the version literal**

In the `StatsCacheEnvelope` interface, change:

```ts
  version: 10
```

to:

```ts
  version: 11
```

- [ ] **Step 3: Update the read guard**

In `readStatsCache`, change:

```ts
    if (parsed.version !== 10) return null
```

to:

```ts
    if (parsed.version !== 11) return null
```

- [ ] **Step 4: Update the cache test**

Run: `cd /Users/ed/AI/BATBracket && npx jest stats-cache`
Expected: it may FAIL if `__tests__/stats-cache.test.ts` hardcodes `version: 10`. If it does, open that test and update every `version: 10` literal to `version: 11`. Re-run until PASS. If it already passes, no change needed.

- [ ] **Step 5: Commit**

```bash
git add lib/stats-cache.ts __tests__/stats-cache.test.ts
git commit -m "feat(stats): bump cache to v11 for top-player results"
```

---

## Task 4: Render the WLCell tooltip

**Files:**
- Modify: `components/TournamentStatsPanel.tsx` — imports (lines 1-8), the W-L `<td>` (line 308), and add a `WLCell` component near `MedalCell` (after line 578)
- Test: `__tests__/TournamentStatsPanel.test.tsx` (append a new describe block)

- [ ] **Step 1: Write the failing test**

In `__tests__/TournamentStatsPanel.test.tsx`, add at the end of the file a payload + test. Reuse `minimalLegacyPayload` (already defined near the top) as the base:

```ts
const topPlayersPayload = {
  ...minimalLegacyPayload,
  topPlayers: [
    {
      playerId: 'p1',
      name: 'Alpha',
      club: 'Club A',
      wins: 2,
      losses: 1,
      results: [
        { event: 'MD', round: 'QF', won: true, opponent: ['Smith', 'Lee'], scores: [{ t1: 21, t2: 18 }, { t1: 21, t2: 15 }] },
        { event: 'MD', round: 'SF', won: true, opponent: ['Tan', 'Wong'], scores: [{ t1: 19, t2: 21 }, { t1: 21, t2: 17 }, { t1: 21, t2: 12 }] },
        { event: 'MD', round: 'Final', won: false, opponent: ['Cho', 'Park'], scores: [{ t1: 18, t2: 21 }, { t1: 17, t2: 21 }] },
      ],
    },
  ],
}

describe('TournamentStatsPanel — top players W-L tooltip', () => {
  test('renders a tooltip row per match with opponent and score', async () => {
    fetchOnce(topPlayersPayload)
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    await waitFor(() => {
      expect(screen.getByText('Smith / Lee')).toBeInTheDocument()
    })
    expect(screen.getByText('21–18, 21–15')).toBeInTheDocument()
    expect(screen.getByText('Cho / Park')).toBeInTheDocument()
  })

  test('renders plain W-L with no tooltip when results are absent', async () => {
    const noResults = {
      ...minimalLegacyPayload,
      topPlayers: [{ playerId: 'p1', name: 'Alpha', club: 'Club A', wins: 5, losses: 0 }],
    }
    fetchOnce(noResults)
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument()
    })
    expect(document.querySelector('.stats-wl-tip')).toBeNull()
  })
})
```

Note the en-dash `–` (U+2013) in the score assertion — `WLCell` joins scores with `–`, matching the existing W-L cell.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/ed/AI/BATBracket && npx jest TournamentStatsPanel -t "tooltip"`
Expected: FAIL — "Smith / Lee" not found (cell still renders only the bare W-L number).

- [ ] **Step 3: Add imports**

In `components/TournamentStatsPanel.tsx`, update the type import (line 8) to include `StatsPlayerResult`:

```ts
import type { StatsClubMedalist, StatsPlayerResult, TournamentStats } from '@/lib/types'
```

And add an i18n import below the existing imports (after line 8):

```ts
import { abbrevRoundL } from '@/lib/i18n'
```

- [ ] **Step 4: Add the `WLCell` component**

In `components/TournamentStatsPanel.tsx`, add this component immediately after `MedalCell` (after line 578, before `function DramaCard`):

```tsx
function WLCell({
  wins,
  losses,
  results,
  lang,
}: {
  wins: number
  losses: number
  results?: StatsPlayerResult[]
  lang: 'en' | 'th'
}) {
  const cell = <><b>{wins}</b>–<i>{losses}</i></>
  if (!results || results.length === 0) return cell
  return (
    <span className="stats-wl-cell" tabIndex={0}>
      {cell}
      <span className="stats-wl-tip" role="tooltip">
        {results.map((r, i) => (
          <span className="stats-wl-tip-row" key={i}>
            <span className="stats-wl-tip-where">{r.event} · {abbrevRoundL(r.round, lang)}</span>
            <span className={`stats-wl-tip-res ${r.won ? 'is-win' : 'is-loss'}`}>{r.won ? 'W' : 'L'}</span>
            <span className="stats-wl-tip-opp">
              {r.opponent.join(' / ')}{r.retired ? ' (ret.)' : ''}
            </span>
            <span className="stats-wl-tip-score">{r.scores.map((s) => `${s.t1}–${s.t2}`).join(', ')}</span>
          </span>
        ))}
      </span>
    </span>
  )
}
```

- [ ] **Step 5: Use `WLCell` at the W-L cell**

Replace the W-L `<td>` (currently line 308):

```tsx
                <td className="stats-num stats-wl"><b>{p.wins}</b>–<i>{p.losses}</i></td>
```

with:

```tsx
                <td className="stats-num stats-wl">
                  <WLCell wins={p.wins} losses={p.losses} results={p.results} lang={lang} />
                </td>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /Users/ed/AI/BATBracket && npx jest TournamentStatsPanel`
Expected: PASS — new tooltip tests plus the existing back-compat tests.

- [ ] **Step 7: Type-check**

Run: `cd /Users/ed/AI/BATBracket && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add components/TournamentStatsPanel.tsx __tests__/TournamentStatsPanel.test.tsx
git commit -m "feat(stats): W-L hover tooltip with match-by-match results"
```

---

## Task 5: Style the tooltip

**Files:**
- Modify: `app/globals.css` — add after the `stats-roster-*` block (after line 2303)

- [ ] **Step 1: Add the CSS**

In `app/globals.css`, insert after line 2303 (`.stats-share-capture .stats-roster-tip { display: none !important; }`):

```css
.stats-wl-cell {
  position: relative;
  display: inline-block;
  cursor: help;
  outline: none;
}
.stats-wl-tip {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 30;
  display: none;
  flex-direction: column;
  gap: 3px;
  min-width: 280px;
  max-width: 380px;
  max-height: 320px;
  overflow-y: auto;
  padding: 8px 10px;
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  font-size: 12px;
  font-weight: normal;
  text-align: left;
  white-space: normal;
}
.stats-wl-cell:hover .stats-wl-tip,
.stats-wl-cell:focus .stats-wl-tip,
.stats-wl-cell:focus-within .stats-wl-tip {
  display: flex;
}
.stats-wl-tip-row {
  display: grid;
  grid-template-columns: auto 14px 1fr auto;
  gap: 8px;
  align-items: baseline;
  line-height: 1.35;
}
.stats-wl-tip-where {
  color: var(--muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.stats-wl-tip-res { font-weight: 700; text-align: center; }
.stats-wl-tip-res.is-win { color: #16a34a; }
.stats-wl-tip-res.is-loss { color: #dc2626; }
.stats-wl-tip-opp {
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats-wl-tip-score {
  color: var(--muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.stats-share-capture .stats-wl-tip { display: none !important; }
```

- [ ] **Step 2: Visually verify**

Run: `cd /Users/ed/AI/BATBracket && npm run dev`
Open a finished tournament's stats panel, scroll to *Top players*, hover a W-L cell. Confirm:
- A tooltip appears with one row per match: `event · round`, green **W** / red **L**, opponent, scores.
- Scores read player-first (the player's own points are the left number on both wins and losses).
- A finalist with many matches scrolls inside the tooltip.
- Keyboard: Tab to the cell → tooltip shows (focus-within).

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style(stats): W-L results tooltip layout"
```

---

## Final Verification

- [ ] **Full test suite**

Run: `cd /Users/ed/AI/BATBracket && npx jest`
Expected: PASS (all suites).

- [ ] **Type-check + lint**

Run: `cd /Users/ed/AI/BATBracket && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Reconciliation spot-check (manual)**

In the running app, pick a finalist row: the number of tooltip rows equals wins+losses, W rows equal `wins`, L rows equal `losses`. Confirm walkovers do not appear and retired matches show "(ret.)".

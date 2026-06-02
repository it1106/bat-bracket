# Tournament History pill tooltips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hovering (or tapping on touch devices) a per-event pill in Tournament History pops a tooltip listing the player's matches in that event of that tournament — round, opponents, partners, scores — sorted with the deepest round first.

**Architecture:** Persist the player's match list per `(tournamentId, eventId)` directly inside `PlayerRecord` in the existing player index. The index-rebuild loop already iterates every match per player per event (`lib/playerIndex.ts:362-407`); today the per-match refs are discarded after best-finish/wins-losses aggregation. We instead trim each ref to the four fields the tooltip needs (`round`, `opponents`, `partners`, `scores`, `outcome`), sort by round depth, and persist. The view component renders the tooltip inline — no extra fetch, no new API route. Mobile uses the same tap-toggle pattern as Recent Form.

**Tech Stack:** TypeScript, Next.js 14 (app router), React 18, Jest, plain CSS (`app/globals.css`).

---

## File Structure

- **Modify** `lib/types.ts` — add `PlayerTournamentMatch` type and `tournamentMatches` field on `PlayerRecord`.
- **Modify** `lib/playerIndex.ts` — populate `tournamentMatches` inside the existing per-player tournament-grouping loop.
- **Create** `__tests__/playerIndex.tournamentMatches.test.ts` — fixture-driven test verifying the new field is populated, trimmed, keyed, and sorted.
- **Modify** `components/PlayerProfileView.tsx` — render tooltip span inside each event chip; add tap-toggle state.
- **Modify** `app/globals.css` — `.pp-ev-tip` styles mirroring `.pp-form-tip`.

The index file grows from ~25.6 MB toward ~33 MB for BAT (6,800 tournament-event rows × ~5 matches × ~200 B trimmed). The SSR payload grows ~6 KB per profile (≤ 6 tournaments × ~5 matches × ~200 B). Both budgets cleared during design.

---

## Task 1: Schema — add `PlayerTournamentMatch` and `tournamentMatches` field

**Files:**
- Modify: `lib/types.ts:386-491` (insert `PlayerTournamentMatch` near `PlayerMatchRef`; add `tournamentMatches` to `PlayerRecord`)

- [ ] **Step 1: Add the trimmed match type and the record field**

Insert directly *after* the `PlayerMatchRef` interface (currently ending at `lib/types.ts:402`):

```ts
/** A per-tournament-per-event match summary used by the Tournament History
 *  tooltip on the player profile. Trimmed from PlayerMatchRef to keep the
 *  SSR payload tight: tournamentId/eventId live in the lookup key, and the
 *  tooltip displays neither slugs nor schedule date. */
export interface PlayerTournamentMatch {
  round: string
  partners: string[]
  opponents: string[]
  scores: MatchScore[]
  outcome: 'W' | 'L' | 'WO-W' | 'WO-L' | 'RET-W' | 'RET-L'
}
```

Then inside `PlayerRecord` (currently `lib/types.ts:459-`), directly after the existing `recentForm` line (around `lib/types.ts:491`), add:

```ts
  /** Keyed `${tournamentId}:${eventId}` → matches in that event of that
   *  tournament, sorted deepest round first (Final → SF → … → RR). Pulled
   *  inline by the Tournament History chip tooltip. Optional so a fresh
   *  install that hasn't yet rebuilt the index still loads. */
  tournamentMatches?: Record<string, PlayerTournamentMatch[]>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: same pre-existing error in `__tests__/bat-ranking-cache.test.ts:15` as before this change, no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(player-record): add PlayerTournamentMatch + tournamentMatches lookup

Trimmed per-event match list that the Tournament History tooltip will
consume. Optional on PlayerRecord so previously-built index files keep
loading until a rebuild lands.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Failing test for the index builder

**Files:**
- Create: `__tests__/playerIndex.tournamentMatches.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/playerIndex.tournamentMatches.test.ts`:

```ts
import path from 'path'
import fs from 'fs'
import { buildIndex } from '@/lib/playerIndex'
import type { MatchesData, PlayerIndexTournamentInput } from '@/lib/types'

// Reuse the Toyota fixture already used by playerIndex.aggregate.test.ts.
function loadInput(slug: string, tournamentName: string, dateIso: string): PlayerIndexTournamentInput {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}.json`), 'utf8')) as MatchesData
  const clubs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}-clubs.json`), 'utf8')) as Record<string, string>
  delete (clubs as Record<string, string>)._meta
  return { tournamentId: slug.toUpperCase(), tournamentName, tournamentDateIso: dateIso, data, clubs }
}

describe('buildIndex — tournamentMatches lookup', () => {
  const toyota = loadInput('toyota', 'โตโยต้า เยาวชน 2569', '2026-05-01')

  it('populates tournamentMatches for every event the player participated in', () => {
    const { index } = buildIndex('bat', [toyota])
    // Pick any player who appears in record.tournaments → must have a matching key
    for (const p of Object.values(index.players)) {
      for (const t of p.tournaments) {
        for (const e of t.events) {
          const key = `${t.tournamentId}:${e.eventId}`
          const matches = p.tournamentMatches?.[key]
          expect(matches).toBeDefined()
          expect(matches!.length).toBeGreaterThan(0)
          // win+loss counts agree with the aggregate
          const wins = matches!.filter(m => m.outcome === 'W' || m.outcome === 'WO-W' || m.outcome === 'RET-W').length
          const losses = matches!.length - wins
          expect(wins).toBe(e.wins)
          expect(losses).toBe(e.losses)
        }
      }
    }
  })

  it('orders matches with the deepest round first', () => {
    const { index } = buildIndex('bat', [toyota])
    // Find a player who reached at least the Final (Champion or runner-up) so
    // we have an unambiguous deepest-round expectation.
    const finalist = Object.values(index.players).find(p =>
      p.tournaments.some(t => t.events.some(e => e.bestFinish === 'Champion' || e.bestFinish === 'F')),
    )
    expect(finalist).toBeDefined()
    for (const t of finalist!.tournaments) {
      for (const e of t.events) {
        if (e.bestFinish !== 'Champion' && e.bestFinish !== 'F') continue
        const matches = finalist!.tournamentMatches?.[`${t.tournamentId}:${e.eventId}`]
        expect(matches).toBeDefined()
        // First entry must be the Final.
        expect(matches![0].round).toBe('Final')
      }
    }
  })

  it('only retains the trimmed fields on each entry', () => {
    const { index } = buildIndex('bat', [toyota])
    const allowed = new Set(['round', 'partners', 'opponents', 'scores', 'outcome'])
    for (const p of Object.values(index.players)) {
      for (const matches of Object.values(p.tournamentMatches ?? {})) {
        for (const m of matches) {
          for (const k of Object.keys(m)) expect(allowed.has(k)).toBe(true)
        }
      }
    }
  })

  it('keys are unique within a player and follow the tournamentId:eventId shape', () => {
    const { index } = buildIndex('bat', [toyota])
    for (const p of Object.values(index.players)) {
      if (!p.tournamentMatches) continue
      const keys = Object.keys(p.tournamentMatches)
      expect(new Set(keys).size).toBe(keys.length)
      for (const k of keys) expect(k).toMatch(/^[^:]+:[^:]+$/)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/playerIndex.tournamentMatches.test.ts`
Expected: FAIL — `tournamentMatches` is undefined on every record.

- [ ] **Step 3: Commit**

```bash
git add __tests__/playerIndex.tournamentMatches.test.ts
git commit -m "test(player-index): pin tournamentMatches contract (failing)

Asserts the lookup is populated, ordered deepest-round-first, trimmed
to {round, partners, opponents, scores, outcome}, and keyed with the
\`tournamentId:eventId\` composite.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Populate `tournamentMatches` in the index builder

**Files:**
- Modify: `lib/playerIndex.ts:360-407` (inside the existing per-player tournament-grouping loop)

- [ ] **Step 1: Add the trimmer + sorter helper above `bestFinishFor`**

Locate the `bestFinishFor` function block at `lib/playerIndex.ts:349-358`. Directly *before* it, add this helper (and import `PlayerTournamentMatch` from `./types` — the existing import line at the top of the file already pulls several names from `./types`; add `PlayerTournamentMatch` to that list):

```ts
  // Sort key for "latest match first" inside an event. Final maps to the
  // same depth as bestFinish 'F' so ROUND_ORDER stays the single source of
  // truth. PlayerMatchRef.round uses the long-form 'Final'; everything else
  // already matches ROUND_ORDER's short form ('SF', 'QF', 'R16', ...). Group
  // Stage / RR rounds fall off the end with Infinity so they sort last.
  function roundDepth(round: string): number {
    if (round === 'Final') return 0
    const i = ROUND_ORDER.indexOf(round as PlayerEventResult['bestFinish'])
    return i < 0 ? Number.POSITIVE_INFINITY : i
  }

  function trimMatch(r: PlayerMatchRef): PlayerTournamentMatch {
    return {
      round: r.round,
      partners: r.partners,
      opponents: r.opponents,
      scores: r.scores,
      outcome: r.outcome,
    }
  }
```

Note: `ROUND_ORDER` is defined a few lines below (`lib/playerIndex.ts:349`). Moving the helpers above its definition would compile fine for `function`-declared helpers (hoisted) **but** the closure-captured `ROUND_ORDER` resolves at call time, so placement before/after is functionally equivalent. Place them *above* `bestFinishFor` so reviewers see the sort key beside the depth array it queries — but the line **after** the `const ROUND_ORDER = [...]` declaration. Concretely: insert immediately after `lib/playerIndex.ts:349` (the `ROUND_ORDER` line) and before `bestFinishFor`.

- [ ] **Step 2: Initialise the new lookup at the top of the per-player loop**

Locate the per-player loop opening at `lib/playerIndex.ts:360`:

```ts
  for (const [slug, rec] of Array.from(records.entries())) {
    const refs = scratches.get(slug)?.refs || []
    const byTournament = new Map<string, Map<string, PlayerMatchRef[]>>()
```

Immediately after the `const byTournament = ...` line, add:

```ts
    const tournamentMatches: Record<string, PlayerTournamentMatch[]> = {}
```

- [ ] **Step 3: Persist per-event sorted matches**

Locate the existing per-event loop body inside the tournament loop (`lib/playerIndex.ts:380-396`):

```ts
      for (const [eventName, eventRefs] of Array.from(evMap.entries())) {
        const teamSize = eventRefs[0]?.partners.length === 0 ? 1 : 2
        const finish = bestFinishFor(eventRefs)
        let wins = 0, losses = 0
        for (const er of eventRefs) {
          if (er.outcome === 'W' || er.outcome === 'WO-W' || er.outcome === 'RET-W') wins++
          else losses++
        }
        events.push({
          tournamentId: t.tournamentId,
          eventId: eventRefs[0].eventId,
          eventName,
          discipline: classifyDiscipline(teamSize, eventName),
          bestFinish: finish,
          wins, losses,
        })
      }
```

Replace it with (the only change is the new `tournamentMatches[key]` write right after the `events.push`):

```ts
      for (const [eventName, eventRefs] of Array.from(evMap.entries())) {
        const teamSize = eventRefs[0]?.partners.length === 0 ? 1 : 2
        const finish = bestFinishFor(eventRefs)
        let wins = 0, losses = 0
        for (const er of eventRefs) {
          if (er.outcome === 'W' || er.outcome === 'WO-W' || er.outcome === 'RET-W') wins++
          else losses++
        }
        const eventId = eventRefs[0].eventId
        events.push({
          tournamentId: t.tournamentId,
          eventId,
          eventName,
          discipline: classifyDiscipline(teamSize, eventName),
          bestFinish: finish,
          wins, losses,
        })
        // Persist per-event matches for the Tournament History tooltip,
        // sorted deepest round first. Within the same round (only possible
        // for RR/Group Stage rows) keep an arbitrary-but-stable order by
        // falling back to the original ref order.
        const sorted = [...eventRefs]
          .map((r, idx) => ({ r, idx }))
          .sort((a, b) => {
            const da = roundDepth(a.r.round)
            const db = roundDepth(b.r.round)
            if (da !== db) return da - db
            return a.idx - b.idx
          })
          .map(x => trimMatch(x.r))
        tournamentMatches[`${t.tournamentId}:${eventId}`] = sorted
      }
```

- [ ] **Step 4: Attach the lookup to the record after both tournament/event loops**

Locate the existing `rec.tournaments.push(...)` block (`lib/playerIndex.ts:402-407`) and immediately *after* the closing `}` of the outer `for (const t of tournaments)` loop (i.e. **once per player**, not once per tournament), add:

```ts
    if (Object.keys(tournamentMatches).length > 0) {
      rec.tournamentMatches = tournamentMatches
    }
```

Skipping the write when the lookup is empty keeps the JSON file from ballooning with `"tournamentMatches": {}` per player.

- [ ] **Step 5: Run the new test to verify it passes**

Run: `npx jest __tests__/playerIndex.tournamentMatches.test.ts`
Expected: PASS — all 4 specs green.

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `npx jest`
Expected: All previously-green tests still green (704 + 4 new = 708 passing).

- [ ] **Step 7: Commit**

```bash
git add lib/playerIndex.ts
git commit -m "feat(player-index): persist per-event matches for tooltip

Inside the existing tournament-grouping loop, sort each event's refs
by round depth (Final → SF → … → RR) and write the trimmed match list
to rec.tournamentMatches keyed by \`tournamentId:eventId\`. Skipped
when empty so the JSON file size is paid only by players with history.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3a: Bump SCHEMA_VERSION so the deploy forces a rebuild

The `rebuildAll` early-out at `lib/player-index-rebuild.ts:143` skips when `existing.sourceVersion === sv`. Without a kick, an in-place deploy leaves the existing v11 index on disk forever and the new `tournamentMatches` field never lands. The codebase's documented mechanism for this is the `SCHEMA_VERSION` constant a few lines below — bump it whenever the PlayerRecord shape changes.

**Files:**
- Modify: `lib/player-index-rebuild.ts:206`

- [ ] **Step 1: Bump the constant**

```ts
const SCHEMA_VERSION = 12
```

(The comment above it on lines 203-205 already explains why we do this — no comment edit needed.)

- [ ] **Step 2: Sanity-run the tests**

Run: `npx jest __tests__/playerIndex.tournamentMatches.test.ts __tests__/playerIndex.aggregate.test.ts`
Expected: green. The bump is invisible to `buildIndex`'s output — it only changes the hash `rebuildAll` uses to detect schema deltas.

- [ ] **Step 3: Commit**

```bash
git add lib/player-index-rebuild.ts
git commit -m "chore(player-index): SCHEMA_VERSION 11→12 for tournamentMatches

Bumps the per-deploy rebuild signal so existing v11 index files are
re-emitted with the new tournamentMatches lookup populated. Cache
reader continues to accept the same envelope shape (version: 1), so
there's no downtime window between PM2 reload and rebuild completion.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Render the tooltip on each event chip

**Files:**
- Modify: `components/PlayerProfileView.tsx:40-219` (add tap-toggle state and render tooltip span inside chip)

- [ ] **Step 1: Add the tap-toggle state alongside `openForm`**

Locate the existing `useState` block early in the component body. Look for `openForm`. Above or below it, add:

```tsx
  const [openTour, setOpenTour] = useState<string | null>(null)
```

This holds the active chip key (`${tournamentId}:${eventId}`) for the tap-toggle path on touch devices.

- [ ] **Step 2: Build the per-match line and render the tooltip inside each chip**

Locate the existing event chip render block at `components/PlayerProfileView.tsx:198-216`:

```tsx
              <div className="pp-events">
                {t.events.map(e => {
                  // Podium tint: …
                  const medalClass = e.bestFinish === 'Champion' ? 'pp-champ'
                    : e.bestFinish === 'F' ? 'pp-runnerup'
                    : e.bestFinish === 'SF' ? 'pp-third'
                    : 'pp-noplace'
                  return (
                    <span key={e.eventId + e.eventName} className={`pp-ev-chip ${medalClass}`}>
                      {e.bestFinish === 'Champion' ? '🏆 ' : ''}{e.eventName} ·{' '}
                      <span className="pp-ev-chip-finish">{e.bestFinish}</span> ·{' '}
                      <span className="pp-ev-chip-wl">{e.wins}–{e.losses}</span>
                    </span>
                  )
                })}
              </div>
```

Replace it with:

```tsx
              <div className="pp-events">
                {t.events.map(e => {
                  const medalClass = e.bestFinish === 'Champion' ? 'pp-champ'
                    : e.bestFinish === 'F' ? 'pp-runnerup'
                    : e.bestFinish === 'SF' ? 'pp-third'
                    : 'pp-noplace'
                  const tipKey = `${t.tournamentId}:${e.eventId}`
                  const matches = record.tournamentMatches?.[tipKey] ?? []
                  // Mirror the recentForm tip format: one line per match with
                  // round, verb prefix, opponents, optional partner suffix,
                  // and the comma-joined scores (or walkover/retired tag).
                  const tip = matches.length === 0 ? '' : matches.map(m => {
                    const won = m.outcome === 'W' || m.outcome === 'WO-W' || m.outcome === 'RET-W'
                    const verb = won ? 'def.' : 'lost to'
                    const opp = m.opponents.length > 0 ? m.opponents.join(' / ') : '—'
                    const partnerLine = m.partners.length > 0 ? ` (w/ ${m.partners.join(' / ')})` : ''
                    const scoreLine = m.scores.length > 0
                      ? m.scores.map(s => `${s.t1}-${s.t2}`).join(', ')
                      : (m.outcome.startsWith('WO') ? 'walkover' : m.outcome.startsWith('RET') ? 'retired' : '')
                    return `${m.round}: ${verb} ${opp}${partnerLine}\n  ${scoreLine}`
                  }).join('\n')
                  const isOpen = openTour === tipKey
                  const hasTip = tip.length > 0
                  return (
                    <span
                      key={e.eventId + e.eventName}
                      className={`pp-ev-chip ${medalClass} ${hasTip ? 'pp-ev-chip-has-tip' : ''} ${isOpen ? 'pp-ev-open' : ''}`}
                      onClick={hasTip ? () => setOpenTour(isOpen ? null : tipKey) : undefined}
                    >
                      {e.bestFinish === 'Champion' ? '🏆 ' : ''}{e.eventName} ·{' '}
                      <span className="pp-ev-chip-finish">{e.bestFinish}</span> ·{' '}
                      <span className="pp-ev-chip-wl">{e.wins}–{e.losses}</span>
                      {hasTip && <span className="pp-ev-tip" role="tooltip">{tip}</span>}
                    </span>
                  )
                })}
              </div>
```

- [ ] **Step 3: Confirm typecheck stays green**

Run: `npx tsc --noEmit`
Expected: same pre-existing error in `__tests__/bat-ranking-cache.test.ts:15` as before; no new errors.

- [ ] **Step 4: Run the full suite**

Run: `npx jest`
Expected: 708 passing (no test should regress from the JSX-only change).

- [ ] **Step 5: Commit**

```bash
git add components/PlayerProfileView.tsx
git commit -m "feat(profile): tournament-history pill tooltip

Each event chip on the Tournament History pill row now exposes a
tooltip listing every match the player played in that event of that
tournament — round, verb, opponents, optional partner, scores —
sorted deepest round first. Hover on desktop, tap-toggle on touch
(same pattern as Recent Form). Chips without recorded matches stay
inert so legacy index payloads degrade silently.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Style the tooltip

**Files:**
- Modify: `app/globals.css:2535-2555` (extend the existing `.pp-ev-chip` block)

- [ ] **Step 1: Add the tooltip styles after the existing chip rules**

Locate the last `.pp-ev-chip.pp-noplace` block at `app/globals.css:2552-2555`. Immediately after `html.dark .pp-ev-chip.pp-noplace { … }` and before the `.pp-form-strip` block, add:

```css
.pp-ev-chip.pp-ev-chip-has-tip { position: relative; cursor: pointer; }
.pp-ev-tip { display: none; position: absolute; left: 0; top: calc(100% + 6px);
  z-index: 20; min-width: 240px; max-width: 360px; padding: 8px 10px;
  border-radius: 8px; background: var(--fg); color: var(--bg);
  font-size: 11px; font-weight: 400; line-height: 1.5; text-align: left;
  white-space: pre-line; box-shadow: 0 4px 12px rgba(0,0,0,0.25); }
.pp-ev-chip.pp-ev-chip-has-tip:hover .pp-ev-tip,
.pp-ev-chip.pp-ev-open .pp-ev-tip { display: block; }
```

- [ ] **Step 2: Smoke-test in the browser**

Run: `npm run build && pm2 reload bat-bracket` on `ezebat.lan` (or `npm run dev` locally on `:3000`).

Open any player profile (e.g. `/player/bat/<slug>` for a player who reached at least the Final of a known tournament). Hover an event chip; verify:
- Tooltip appears below the chip.
- Each match line shows `Round: verb Opponent — score`, latest round at the top.
- Champion/F/SF tints still render correctly.

On mobile (or DevTools touch emulation), tap a chip; tooltip toggles. Tapping again or another chip closes/reassigns.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style(profile): tooltip for tournament-history pills

Mirrors .pp-form-tip but wider (240–360px) to fit the multi-match
listing. Hover-or-tap toggle via .pp-ev-open mirrors the Recent Form
form-cell pattern.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Branch, PR, merge, deploy

- [ ] **Step 1: From a clean main, create the feature branch and verify**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/profile-tournament-tooltip
# All five task commits should land on this branch from earlier steps. If
# you did the work directly on main, rebase the commits onto the new
# branch and reset main to origin/main before pushing.
npx jest          # expect 708/708
npx tsc --noEmit  # expect only the pre-existing bat-ranking-cache test error
```

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/profile-tournament-tooltip
gh pr create --base main --head feat/profile-tournament-tooltip \
  --title "feat(profile): tournament-history pill tooltips" \
  --body "Hovering (or tapping) a Tournament History event chip now opens a tooltip listing every match the player played in that event of that tournament — round, verb, opponents, optional partner, scores — sorted deepest round first.

Implementation: the index-rebuild loop in lib/playerIndex.ts already iterates every match per player per event; we now persist the trimmed list as record.tournamentMatches keyed by \`tournamentId:eventId\`. Tooltip rendered inline on the existing chip, mobile tap-toggle mirrors Recent Form.

Index file grows ~25.6 MB → ~33 MB (BAT); SSR payload per profile grows ~6 KB.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: Merge and deploy**

```bash
gh pr merge --merge --delete-branch
git checkout main && git pull --ff-only
ssh root@ezebat.lan "set -e; cd ~/app && git pull --ff-only && npm run build && pm2 reload bat-bracket && pm2 list | grep bat-bracket"
```

- [ ] **Step 4: Verify the boot rebuild repopulated the index**

The `SCHEMA_VERSION` bump in Task 3a forces `rebuildAll` to skip its `existing.sourceVersion === sv` early-out on this boot — so the rebuild kicked off by `instrumentation.ts:30` will rewrite the index file with the new field. It runs asynchronously during boot (an `await rebuildAll(...)` inside the boot IIFE at `instrumentation.ts:17-51`).

Tail the log until the boot rebuild line lands (look for `[player-index] boot rebuild`), then check disk:

```bash
ssh root@ezebat.lan "python3 -c '
import json
with open(\"/root/app/.cache/players/index-bat.json\") as f:
    idx = json.load(f)
keys = [k for k,v in idx[\"players\"].items() if v.get(\"tournamentMatches\")]
print(\"players with tournamentMatches:\", len(keys), \"/\", len(idx[\"players\"]))
'"
```

Expected: most active players have `tournamentMatches` populated. (Older index files written before the rebuild will not — they're refreshed on the next `rebuildAll` run.)

- [ ] **Step 5: Smoke-test in production**

Open `https://<prod-host>/player/bat/<slug>` for a player who reached at least a Final, hover an event chip; confirm tooltip renders the expected matches in the expected order.

---

## Notes on edge cases

- **Empty match list:** chips for tournaments whose `tournamentMatches[key]` is missing (e.g., a player record produced by a pre-deploy build of the index) render with no tooltip and no cursor change. They become tooltip-bearing on the next index rebuild.
- **Group-stage events (`bestFinish === 'RR'`):** all matches sort with `roundDepth = Infinity`, so they fall to the bottom in their original ref order. Acceptable since the round name in each line already disambiguates.
- **Doubles/mixed events:** `r.partners` is non-empty; the tooltip line gains a `(w/ …)` suffix. Singles events have `partners: []` and skip the suffix — matches Recent Form's behaviour.
- **Active tournament's in-progress today:** today's matches aren't pinned per the disk-pin discussion paused earlier. They appear in the tooltip only after that day pins (or after PM2 reload while `prewarmMatchesFullCache` still holds them in `activeData`).

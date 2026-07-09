# Roster Chip Match-Result Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hovering an event chip in the country/club roster modal shows that player's match results in that event, newest first (round · W/L · opponent · score).

**Architecture:** The stats generator already holds every match; `buildTopPlayers` already builds `StatsPlayerResult[]` per player and discards all but 12. A new `buildPlayerResultsByPlayer(ctxs)` retains that data for all players (keyed by collapsed event, pre-sorted newest-first) and attaches `results` to each roster member. `RosterModal` renders a CSS hover/focus tooltip per chip from `member.results`. No new upstream fetches; additive/backward-compatible field.

**Tech Stack:** TypeScript, Next.js (React), Jest + @testing-library/react. Existing helpers in `lib/tournamentStats.ts`: `extractSeed`, `roundSize`, `MatchCtx` (`{ match, dateIso, durationMinutes }`). Display helper `abbrevRoundL` from `lib/i18n.ts`.

## Global Constraints

- `results` is **optional** (`?`) on `StatsClubMember`, `StatsCountryMember`, and `RosterRow` — pre-existing cached stats blobs must still parse and render chips with no tooltip.
- A result's `event` is stored as the **collapsed** key `match.eventName ?? match.draw` (same collapse as `events` and `statusByEvent`), so it joins to the chip string (e.g. `MS`).
- Scores are stored **player-perspective**: `t1` is always the player's own side (flip team-2 scores).
- Only decided, non-walkover matches produce results (`match.winner !== null && !match.walkover`); retired matches are included with `retired: true`.
- Ordering is **newest-first**: date (`ctx.dateIso`) descending, tie-broken by round depth (deepest round first via `roundSize` ascending).
- The tooltip element must be a **sibling** of the chip span, not a child — the `--out` chip uses `opacity: 0.45`, which would dim a nested tooltip.

---

### Task 1: Per-player match results in the stats blob

**Files:**
- Modify: `lib/types.ts` (add `results?` to `StatsClubMember` ~line 315 and `StatsCountryMember` ~line 332)
- Modify: `lib/tournamentStats.ts` (add `buildPlayerResultsByPlayer`; thread through `buildClubRosters`, `buildCountryRosters`, and `aggregate`)
- Test: `__tests__/roster-match-results.test.ts` (new)

**Interfaces:**
- Consumes: existing `StatsPlayerResult`, `MatchEntry`, `MatchPlayer`, `MatchCtx`, `RosterDraw`; helpers `extractSeed`, `roundSize`.
- Produces:
  - `StatsClubMember.results?: StatsPlayerResult[]` and `StatsCountryMember.results?: StatsPlayerResult[]`
  - `buildPlayerResultsByPlayer(ctxs: MatchCtx[]): Map<string, StatsPlayerResult[]>`
  - `aggregate(...)` output now populates `results` on every `clubRosters[].roster[]` and `countryRosters[].roster[]` entry.

- [ ] **Step 1: Add the optional `results` field to both member types**

In `lib/types.ts`, `StatsClubMember`:

```typescript
export interface StatsClubMember {
  name: string
  events: string[]
  playerId?: string
  statusByEvent?: Record<string, ChipStatus>
  // Player's decided matches (all events), newest-first, player-perspective
  // scores. Optional so blobs cached before this field existed still parse.
  results?: StatsPlayerResult[]
}
```

`StatsCountryMember` (add the same field + comment):

```typescript
export interface StatsCountryMember {
  name: string
  events: string[]
  playerId?: string
  statusByEvent?: Record<string, ChipStatus>
  results?: StatsPlayerResult[]
}
```

`StatsPlayerResult` already exists (do not redefine it).

- [ ] **Step 2: Write the failing aggregation test**

Create `__tests__/roster-match-results.test.ts`:

```typescript
import { aggregate } from '@/lib/tournamentStats'
import type { MatchEntry, MatchesData, MatchScheduleGroup, MatchPlayer, MatchScore } from '@/lib/types'

function match(
  draw: string,
  round: string,
  t1: MatchPlayer[],
  t2: MatchPlayer[],
  winner: 1 | 2 | null,
  scores: MatchScore[],
  opts: { eventName?: string; walkover?: boolean; retired?: boolean } = {},
): MatchEntry {
  return {
    draw, drawNum: draw, round,
    team1: t1, team2: t2, winner, scores,
    court: '', walkover: opts.walkover ?? false, retired: opts.retired ?? false, nowPlaying: false,
    ...(opts.eventName ? { eventName: opts.eventName } : {}),
  }
}

const som = { name: 'Somchai', playerId: '1', country: 'THA' }
const xa = { name: 'Xa', playerId: 'x', country: 'THA' }
const ya = { name: 'Ya', playerId: 'y', country: 'THA' }
const za = { name: 'Za', playerId: 'z', country: 'THA' }
const wa = { name: 'Wa', playerId: 'w', country: 'THA' }

function build(matches: MatchEntry[], dateIso = '2026-07-01') {
  const group: MatchScheduleGroup = { type: 'time', time: '10:00', matches }
  const data: MatchesData = {
    days: [{ date: '01/07', label: '01/07', dateIso, hasMatches: true }],
    currentDate: dateIso, groups: [group],
  }
  return aggregate(data, new Map([[dateIso, [group]]]), {})
}

function resultsOf(stats: ReturnType<typeof aggregate>, event: string) {
  const tha = stats.countryRosters.find((c) => c.country === 'THA')!
  const m = tha.roster!.find((x) => x.playerId === '1')!
  return (m.results ?? []).filter((r) => r.event === event)
}

describe('buildPlayerResultsByPlayer via aggregate', () => {
  it('orders a player\'s event results newest-first (deepest round), excludes walkovers, flags results won/lost', () => {
    const stats = build([
      match('MS', 'Quarter Final', [som], [xa], 1, [{ t1: 21, t2: 10 }, { t1: 21, t2: 15 }]),
      match('MS', 'Semi Final', [som], [ya], 1, [{ t1: 21, t2: 18 }, { t1: 21, t2: 16 }]),
      match('MS', 'Final', [som], [za], 2, [{ t1: 19, t2: 21 }, { t1: 15, t2: 21 }]),
      match('MS', 'Round 1', [som], [wa], 1, [], { walkover: true }), // excluded
    ])
    const r = resultsOf(stats, 'MS')
    expect(r.map((x) => x.round)).toEqual(['Final', 'Semi Final', 'Quarter Final'])
    expect(r.map((x) => x.won)).toEqual([false, true, true])
    expect(r[0].opponent).toEqual(['Za'])
    expect(r[0].scores).toEqual([{ t1: 19, t2: 21 }, { t1: 15, t2: 21 }])
  })

  it('stores scores in the player\'s perspective when the player is team 2', () => {
    const stats = build([
      match('MD', 'Quarter Final', [xa], [som], 2, [{ t1: 15, t2: 21 }]),
    ])
    const r = resultsOf(stats, 'MD')
    expect(r).toHaveLength(1)
    expect(r[0].won).toBe(true)
    expect(r[0].scores).toEqual([{ t1: 21, t2: 15 }]) // flipped to Somchai's side
  })

  it('keys results by the collapsed event name for grouped formats', () => {
    const stats = build([
      match('MS - Group A', 'Round Robin', [som], [xa], 1, [{ t1: 21, t2: 12 }], { eventName: 'MS' }),
    ])
    expect(resultsOf(stats, 'MS')).toHaveLength(1)
    expect(resultsOf(stats, 'MS - Group A')).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest __tests__/roster-match-results.test.ts`
Expected: FAIL — `member.results` is `undefined`, so `resultsOf` returns `[]` and the `toEqual` assertions fail.

- [ ] **Step 4: Add `buildPlayerResultsByPlayer`**

In `lib/tournamentStats.ts`, add this function just above `buildEventStatusByPlayer` (search for `interface StatusAcc`). It reuses the orientation/seed-strip logic from `buildTopPlayers`:

```typescript
// playerId -> that player's decided matches, newest-first. Scores are stored in
// the player's perspective (t1 = their side). Event uses the collapsed key so it
// joins to the roster chip string. Walkovers are excluded (no score); retired
// matches are kept and flagged. Mirrors buildTopPlayers' orientation logic.
function buildPlayerResultsByPlayer(ctxs: MatchCtx[]): Map<string, StatsPlayerResult[]> {
  interface Acc { result: StatsPlayerResult; dateIso: string }
  const byPlayer = new Map<string, Acc[]>()

  const record = (
    players: MatchPlayer[],
    side: 1 | 2,
    match: MatchEntry,
    opponents: MatchPlayer[],
    dateIso: string,
  ) => {
    const oriented = side === 1 ? match.scores : match.scores.map((s) => ({ t1: s.t2, t2: s.t1 }))
    const opponent = opponents.map((p) => extractSeed(p.name).plain)
    const event = match.eventName ?? match.draw
    for (const p of players) {
      if (!p.playerId) continue
      const list = byPlayer.get(p.playerId) ?? []
      list.push({
        result: {
          event,
          round: match.round,
          won: match.winner === side,
          opponent,
          scores: oriented,
          retired: match.retired || undefined,
        },
        dateIso,
      })
      byPlayer.set(p.playerId, list)
    }
  }

  for (const { match, dateIso } of ctxs) {
    if (match.winner === null || match.walkover) continue
    record(match.team1, 1, match, match.team2, dateIso)
    record(match.team2, 2, match, match.team1, dateIso)
  }

  const out = new Map<string, StatsPlayerResult[]>()
  for (const [pid, accs] of Array.from(byPlayer)) {
    accs.sort((a, b) =>
      b.dateIso.localeCompare(a.dateIso) ||                    // date descending (newest first)
      roundSize(a.result.round) - roundSize(b.result.round),  // deepest round first (F=2 < SF=4 < …)
    )
    out.set(pid, accs.map((a) => a.result))
  }
  return out
}
```

Add `StatsPlayerResult` to the `./types` import block at the top of the file if it is not already imported (it is imported today — verify the line `StatsPlayerResult,` exists in the `import type { … } from './types'` block; no change needed if present).

- [ ] **Step 5: Thread the results map through both roster builders**

In `buildClubRosters`, add a parameter and set the field. Change the signature:

```typescript
function buildClubRosters(
  clubs: Record<string, string>,
  names: Record<string, string>,
  eventsByPlayer: Map<string, string[]>,
  statusByPlayer: Map<string, Record<string, ChipStatus>>,
  resultsByPlayer: Map<string, StatsPlayerResult[]>,
): StatsClubRoster[] {
```

And the member push (currently ends with `statusByEvent: statusByPlayer.get(pid) })`):

```typescript
    list.push({ name: names[pid] ?? `#${pid}`, playerId: pid, events: eventsByPlayer.get(pid) ?? [], statusByEvent: statusByPlayer.get(pid), results: resultsByPlayer.get(pid) })
```

In `buildCountryRosters`, add the parameter after `statusByPlayer`:

```typescript
function buildCountryRosters(
  ctxs: MatchCtx[],
  statusByPlayer: Map<string, Record<string, ChipStatus>>,
  resultsByPlayer: Map<string, StatsPlayerResult[]>,
  rosterByDraw?: Map<string, RosterDraw>,
): StatsCountryRoster[] {
```

And the member push (currently sets `statusByEvent: statusByPlayer.get(playerId),`):

```typescript
    list.push({
      name,
      playerId,
      events: Array.from(events).sort((a, b) => eventRank(a) - eventRank(b) || a.localeCompare(b)),
      statusByEvent: statusByPlayer.get(playerId),
      results: resultsByPlayer.get(playerId),
    })
```

- [ ] **Step 6: Compute and pass the map in `aggregate`**

In `aggregate`, right after the existing `const statusByPlayer = buildEventStatusByPlayer(ctxs, rosterByDraw)` line, add:

```typescript
  const resultsByPlayer = buildPlayerResultsByPlayer(ctxs)
```

Update BOTH `buildClubRosters` call sites (the empty-data early return and the main path) to pass it last:

```typescript
    clubRosters: buildClubRosters(clubs, names, eventsByPlayer, statusByPlayer, resultsByPlayer),
```

Update BOTH `buildCountryRosters` call sites (note the new parameter goes before `rosterByDraw`):

```typescript
    countryRosters: buildCountryRosters(ctxs, statusByPlayer, resultsByPlayer, rosterByDraw),
```

- [ ] **Step 7: Run the new test to verify it passes**

Run: `npx jest __tests__/roster-match-results.test.ts`
Expected: PASS (all three cases green).

- [ ] **Step 8: Run existing stats tests + typecheck**

Run: `npx jest __tests__/tournamentStats.test.ts __tests__/country-roster.test.ts __tests__/club-roster.test.ts __tests__/roster-chip-status.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` reports no errors in `lib/tournamentStats.ts` or `lib/types.ts` (pre-existing errors in `scripts/ravin-*.ts` are unrelated and may be ignored).

- [ ] **Step 9: Commit**

```bash
git add lib/types.ts lib/tournamentStats.ts __tests__/roster-match-results.test.ts
git commit -m "feat(stats): attach per-player match results to roster members"
```

---

### Task 2: Chip hover tooltip in the roster modal

**Files:**
- Modify: `components/RosterModal.tsx` (add `results?` to `RosterRow`, wrap chips with a tooltip)
- Modify: `components/ClubRosterModal.tsx`, `components/CountryRosterModal.tsx` (pass `results` through)
- Modify: `app/globals.css` (chip tooltip styles)
- Test: `__tests__/RosterModal.test.tsx` (add a describe block)

**Interfaces:**
- Consumes: `StatsPlayerResult` from `lib/types`; `member.results` from Task 1; `abbrevRoundL` from `lib/i18n`.
- Produces: `RosterRow.results?: StatsPlayerResult[]`; each chip with results renders `.country-roster-chip-wrap` > (`.country-roster-chip`, `.country-roster-chip-tip` > `.country-roster-chip-tip-row` × N).

- [ ] **Step 1: Write the failing component test**

Add to the end of `__tests__/RosterModal.test.tsx` (uses the existing `render`, `LanguageProvider`, `RosterRow` imports at the top of that file):

```typescript
describe('RosterModal chip match tooltip', () => {
  const rows: RosterRow[] = [
    {
      name: 'P', playerId: '1', events: ['MS', 'XD', 'WS'],
      statusByEvent: { MS: 'out', XD: 'gold', WS: 'in' },
      results: [
        { event: 'MS', round: 'Final', won: false, opponent: ['A. Lee'], scores: [{ t1: 19, t2: 21 }, { t1: 21, t2: 17 }, { t1: 18, t2: 21 }] },
        { event: 'MS', round: 'Semi Final', won: true, opponent: ['B. Chan'], scores: [{ t1: 21, t2: 14 }, { t1: 21, t2: 16 }] },
        { event: 'XD', round: 'Final', won: true, opponent: ['C', 'D'], scores: [{ t1: 21, t2: 10 }, { t1: 21, t2: 9 }], retired: true },
      ],
    },
  ]

  function renderTip() {
    return render(
      <LanguageProvider>
        <RosterModal open title="KBA" count={1} rows={rows} onClose={() => {}} />
      </LanguageProvider>,
    )
  }

  const wrapFor = (label: string) =>
    Array.from(document.querySelectorAll('.country-roster-chip-wrap')).find(
      (w) => w.querySelector('.country-roster-chip')?.textContent === label,
    )

  it('lists that event\'s matches newest-first with round/W-L/opponent/score', () => {
    renderTip()
    const tipRows = wrapFor('MS')!.querySelectorAll('.country-roster-chip-tip-row')
    expect(tipRows).toHaveLength(2)
    expect(tipRows[0].querySelector('.ct-round')!.textContent).toBe('F')
    expect(tipRows[0].querySelector('.ct-wl')!.textContent).toBe('L')
    expect(tipRows[0].querySelector('.ct-opp')!.textContent).toContain('A. Lee')
    expect(tipRows[0].querySelector('.ct-score')!.textContent).toBe('19-21 21-17 18-21')
    expect(tipRows[1].querySelector('.ct-round')!.textContent).toBe('SF')
    expect(tipRows[1].querySelector('.ct-wl')!.textContent).toBe('W')
  })

  it('marks retired matches and joins doubles opponents', () => {
    renderTip()
    const row = wrapFor('XD')!.querySelector('.country-roster-chip-tip-row')!
    expect(row.querySelector('.ct-opp')!.textContent).toContain('C / D')
    expect(row.querySelector('.ct-score')!.textContent).toContain('(ret.)')
  })

  it('renders no tooltip for an event with no results', () => {
    renderTip()
    expect(wrapFor('WS')!.querySelector('.country-roster-chip-tip')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/RosterModal.test.tsx -t "chip match tooltip"`
Expected: FAIL — `.country-roster-chip-wrap` does not exist yet, so `wrapFor(...)` is `undefined` and dereferencing it throws.

- [ ] **Step 3: Add `results` to `RosterRow` and import `abbrevRoundL` + `lang`**

In `components/RosterModal.tsx`, update the imports and interface:

```typescript
import { useLanguage } from '@/lib/LanguageContext'
import type { ChipStatus, StatsPlayerResult } from '@/lib/types'
import { isActive, isEnded, isMedaled } from '@/lib/rosterStatus'
import { abbrevRoundL } from '@/lib/i18n'
```

```typescript
export interface RosterRow {
  name: string
  events: string[]
  playerId?: string
  statusByEvent?: Record<string, ChipStatus>
  // Player's decided matches (all events), newest-first, player-perspective.
  results?: StatsPlayerResult[]
}
```

Pull `lang` from the language hook (currently `const { t } = useLanguage()`):

```typescript
  const { t, lang } = useLanguage()
```

- [ ] **Step 4: Render the chip wrapper + tooltip**

In `components/RosterModal.tsx`, replace the chip-mapping block (currently):

```typescript
                      ? r.events.map((e) => {
                          const status: ChipStatus = r.statusByEvent?.[e] ?? 'in'
                          return (
                            <span className={`country-roster-chip country-roster-chip--${status}`} key={e}>{e}</span>
                          )
                        })
```

with:

```typescript
                      ? r.events.map((e) => {
                          const status: ChipStatus = r.statusByEvent?.[e] ?? 'in'
                          const lines = (r.results ?? []).filter((res) => res.event === e)
                          return (
                            <span className="country-roster-chip-wrap" key={e} tabIndex={lines.length ? 0 : undefined}>
                              <span className={`country-roster-chip country-roster-chip--${status}`}>{e}</span>
                              {lines.length > 0 && (
                                <span className="country-roster-chip-tip" role="tooltip">
                                  {lines.map((res, i) => (
                                    <span className="country-roster-chip-tip-row" key={i}>
                                      <span className="ct-round">{abbrevRoundL(res.round, lang)}</span>
                                      <span className={`ct-wl ct-wl--${res.won ? 'w' : 'l'}`}>{res.won ? 'W' : 'L'}</span>
                                      <span className="ct-opp">vs {res.opponent.join(' / ')}</span>
                                      <span className="ct-score">
                                        {res.scores.map((s) => `${s.t1}-${s.t2}`).join(' ')}{res.retired ? ' (ret.)' : ''}
                                      </span>
                                    </span>
                                  ))}
                                </span>
                              )}
                            </span>
                          )
                        })
```

- [ ] **Step 5: Pass `results` through both caller modals**

In `components/ClubRosterModal.tsx`, add `results` to the mapped row (currently maps `name, playerId, events, statusByEvent`):

```typescript
  const rows: RosterRow[] = roster.roster
    ? roster.roster.map((m) => ({ name: m.name, playerId: m.playerId, events: m.events, statusByEvent: m.statusByEvent, results: m.results }))
    : roster.members.map((name) => ({ name, events: [] }))
```

In `components/CountryRosterModal.tsx`, the same addition:

```typescript
  const rows: RosterRow[] = roster.roster
    ? roster.roster.map((m) => ({ name: m.name, playerId: m.playerId, events: m.events, statusByEvent: m.statusByEvent, results: m.results }))
    : roster.members.map((name) => ({ name, events: [] }))
```

- [ ] **Step 6: Add the tooltip CSS**

In `app/globals.css`, immediately after the `.country-roster-chip--out { opacity: 0.45; }` rule, add:

```css
.country-roster-chip-wrap {
  position: relative;
  display: inline-flex;
  outline: none;
}
.country-roster-chip-tip {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 30;
  display: none;
  flex-direction: column;
  gap: 3px;
  min-width: 180px;
  max-width: 300px;
  max-height: 320px;
  overflow-y: auto;
  padding: 8px 10px;
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
}
.country-roster-chip-wrap:hover .country-roster-chip-tip,
.country-roster-chip-wrap:focus-within .country-roster-chip-tip {
  display: flex;
}
.country-roster-chip-tip-row { display: flex; align-items: baseline; gap: 6px; }
.ct-round { min-width: 24px; color: var(--muted); }
.ct-wl { font-weight: 600; }
.ct-wl--w { color: #2e9e57; }
.ct-wl--l { color: #c0504d; }
.ct-opp { flex: 1; color: var(--fg); }
.ct-score { color: var(--muted); font-variant-numeric: tabular-nums; }
.stats-share-capture .country-roster-chip-tip { display: none !important; }
```

- [ ] **Step 7: Run the component tests to verify they pass**

Run: `npx jest __tests__/RosterModal.test.tsx`
Expected: PASS (existing chip/status/filter tests plus the new tooltip tests).

- [ ] **Step 8: Run the caller-modal tests + full suite + typecheck**

Run: `npx jest __tests__/ClubRosterModal.test.tsx __tests__/CountryRosterModal.test.tsx __tests__/TournamentStatsPanel.test.tsx && npx jest && npx tsc --noEmit`
Expected: PASS; no type errors in the touched files.

- [ ] **Step 9: Commit**

```bash
git add components/RosterModal.tsx components/ClubRosterModal.tsx components/CountryRosterModal.tsx app/globals.css __tests__/RosterModal.test.tsx
git commit -m "feat(stats): hover an event chip to see that player's match results"
```

---

## Self-Review

**Spec coverage:**
- Embed per-player results, no upstream fetch → Task 1 (`buildPlayerResultsByPlayer` from `ctxs`). ✓
- `results?` additive on both member types + `RosterRow` → Task 1 Step 1, Task 2 Step 3. ✓
- Collapsed event key → Task 1 Step 4 (`match.eventName ?? match.draw`) + test Step 2 case 3. ✓
- Player-perspective scores, walkovers excluded, retired flagged → Task 1 Step 4 + tests. ✓
- Newest-first ordering (date desc, deepest round tiebreak) → Task 1 Step 4 sort + test case 1. ✓
- Tooltip content (round/W-L/opponent/score, retired marker, `/`-joined doubles) → Task 2 Step 4 + tests. ✓
- Tooltip is a sibling of the chip (not dimmed by `--out` opacity) → Task 2 Step 4 markup + Step 6 CSS. ✓
- No results → no tooltip → Task 2 Step 4 (`lines.length > 0` guard) + test case 3. ✓
- Both club and country modals → Task 1 Step 5 (both builders) + Task 2 Step 5 (both callers). ✓
- Backward compatibility (optional field) → Task 1 Step 1, Task 2 Step 3. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `buildPlayerResultsByPlayer` returns `Map<string, StatsPlayerResult[]>`, consumed as `resultsByPlayer` by both builders and set as `results` on members; `RosterRow.results` and `member.results` share the `StatsPlayerResult[]` type; tooltip reads `res.event/round/won/opponent/scores/retired` — all fields present on `StatsPlayerResult`. CSS class names (`country-roster-chip-wrap`, `country-roster-chip-tip`, `country-roster-chip-tip-row`, `ct-round/ct-wl/ct-opp/ct-score`) match between Task 2 Step 4 markup and Step 6 CSS and the Step 1 test selectors. ✓

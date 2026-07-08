# Roster Chip Result Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Color each event chip in the Club (BAT) and Country (BWF) roster modals by the player's live tournament result — gold (champion), silver (runner-up), bronze (semifinal loss), faded grey (eliminated), neutral (still in).

**Architecture:** A new server-side derivation (`buildEventStatusByPlayer` in `lib/tournamentStats.ts`) reuses the existing final/semi detection to produce a `playerId → { eventKey → ChipStatus }` map, keyed by the same collapsed `eventName` the roster builders already use so the status keys match the chip strings exactly. That map is folded onto each roster member as an additive optional `statusByEvent` field. `RosterModal` reads it and applies a per-status CSS class, plus a small legend. Old cached stats blobs lack the field and fall back to the neutral `in` look.

**Tech Stack:** TypeScript, Next.js (React), Jest + @testing-library/react. Existing helpers: `abbrevLevelL`/`abbrevRoundL`, `longRoundL`, `isFinal`, `isSemiFinal` in `lib/tournamentStats.ts`; i18n via `lib/i18n.ts` + `useLanguage()`.

## Global Constraints

- `ChipStatus = 'gold' | 'silver' | 'bronze' | 'out' | 'in'` — this exact union, defined once in `lib/types.ts`.
- The `statusByEvent` field is **optional** (`?`) on both member types and on `RosterRow`. Never make it required — pre-existing cached stats blobs must still parse and render as neutral (`in`).
- Status keys MUST use the collapsed event key `eventName ?? drawName` (same rule as `collectPlayerEvents`/`buildCountryRosters`), so a chip labelled `MS` joins its status even when the underlying draws are `MS - Group A` + `MS`.
- Precedence when a player's collapsed event resolves from multiple draws: a medal always wins; `out` only when the player has no medal and is genuinely eliminated; otherwise `in`.
- Elimination rule ("knockout-only, simple"): in a knockout draw, a completed loss in any non-semi/final round ⇒ `out`. In a group-stage draw, a group-phase loss never dims; a group player is `out` only once the event's playoff draw is seeded and that player is absent from it.
- Add every new i18n key to BOTH the `en` and `th` blocks in `lib/i18n.ts` and to the key union type, or the build fails.

---

### Task 1: Server-side status derivation + wiring into roster builders

**Files:**
- Modify: `lib/types.ts` (add `ChipStatus`, add `statusByEvent?` to `StatsClubMember` ~line 315-319 and `StatsCountryMember` ~line 332-337)
- Modify: `lib/tournamentStats.ts` (add `isKnockoutRound`, add `buildEventStatusByPlayer`, thread the map through `buildClubRosters` + `buildCountryRosters`, call it in `aggregate`)
- Test: `__tests__/roster-chip-status.test.ts` (new)

**Interfaces:**
- Consumes: existing `MatchEntry`, `MatchPlayer`, `RosterDraw`, `MatchCtx`; existing helpers `isFinal`, `isSemiFinal`, `abbrevRoundL`.
- Produces:
  - `type ChipStatus = 'gold' | 'silver' | 'bronze' | 'out' | 'in'` (exported from `lib/types.ts`)
  - `StatsClubMember.statusByEvent?: Record<string, ChipStatus>` and `StatsCountryMember.statusByEvent?: Record<string, ChipStatus>`
  - `aggregate(...)` output now populates `statusByEvent` on every `clubRosters[].roster[]` and `countryRosters[].roster[]` entry.

- [ ] **Step 1: Add the `ChipStatus` type and the optional member fields**

In `lib/types.ts`, add the type near the other stats types (e.g. just above `StatsClubMember` around line 314):

```typescript
// Live tournament result of one player in one event, used to color roster chips.
export type ChipStatus = 'gold' | 'silver' | 'bronze' | 'out' | 'in'
```

Add the field to `StatsClubMember`:

```typescript
export interface StatsClubMember {
  name: string
  events: string[]
  playerId?: string
  // Per-event live result (champion/runner-up/semifinal/eliminated/still-in),
  // keyed by the same collapsed event string used in `events`. Optional so
  // stats blobs cached before this field existed still parse (missing ⇒ 'in').
  statusByEvent?: Record<string, ChipStatus>
}
```

Add the identical field (same comment) to `StatsCountryMember`:

```typescript
export interface StatsCountryMember {
  name: string
  events: string[]
  // BWF playerId, used to look up date-of-birth/age for the country modal.
  playerId?: string
  statusByEvent?: Record<string, ChipStatus>
}
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/roster-chip-status.test.ts`:

```typescript
import { aggregate, type RosterDraw } from '@/lib/tournamentStats'
import type { MatchEntry, MatchesData, MatchScheduleGroup, MatchPlayer } from '@/lib/types'

// Build one match. `round`/`eventName`/`winner` override the round-robin-free
// defaults so we can model finals, semis, knockout rounds and group draws.
function match(
  draw: string,
  round: string,
  t1: MatchPlayer[],
  t2: MatchPlayer[],
  winner: 1 | 2 | null,
  eventName?: string,
): MatchEntry {
  return {
    draw, drawNum: draw, round,
    team1: t1, team2: t2,
    winner, scores: [],
    court: '', walkover: false, retired: false, nowPlaying: false,
    ...(eventName ? { eventName } : {}),
  }
}

// THA squad, one player per outcome we want to assert on.
const champ = { name: 'Champ', playerId: 'c', country: 'THA' }
const runner = { name: 'Runner', playerId: 'r', country: 'THA' }
const semi = { name: 'Semi', playerId: 's', country: 'THA' }
const early = { name: 'Early', playerId: 'e', country: 'THA' }
const alive = { name: 'Alive', playerId: 'a', country: 'THA' }
const foe = { name: 'Foe', playerId: 'f', country: 'THA' }

function statusFor(stats: ReturnType<typeof aggregate>, pid: string, event: string) {
  const tha = stats.countryRosters.find((c) => c.country === 'THA')!
  const m = tha.roster!.find((x) => x.playerId === pid)!
  return m.statusByEvent?.[event]
}

function knockoutData(): { data: MatchesData; days: Map<string, MatchScheduleGroup[]> } {
  const group: MatchScheduleGroup = {
    type: 'time', time: '10:00',
    matches: [
      // Final: Champ beats Runner
      match('MS', 'Final', [champ], [runner], 1),
      // Semi: Champ beats Semi (Semi ⇒ bronze); Runner beats Foe (Foe already out via QF below)
      match('MS', 'Semi Final', [champ], [semi], 1),
      match('MS', 'Semi Final', [runner], [foe], 1),
      // Quarter Final: Champ beats Early (Early ⇒ out); Alive wins their QF ⇒ still in
      match('MS', 'Quarter Final', [champ], [early], 1),
      match('MS', 'Quarter Final', [alive], [foe], 1),
    ],
  }
  const data: MatchesData = {
    days: [{ date: '01/07', label: '01/07', dateIso: '2026-07-01', hasMatches: true }],
    currentDate: '2026-07-01',
    groups: [group],
  }
  return { data, days: new Map([['2026-07-01', [group]]]) }
}

describe('roster chip status — knockout event', () => {
  it('assigns gold/silver/bronze/out/in from bracket results', () => {
    const { data, days } = knockoutData()
    const stats = aggregate(data, days, {})
    expect(statusFor(stats, 'c', 'MS')).toBe('gold')
    expect(statusFor(stats, 'r', 'MS')).toBe('silver')
    expect(statusFor(stats, 's', 'MS')).toBe('bronze')
    expect(statusFor(stats, 'e', 'MS')).toBe('out')
    expect(statusFor(stats, 'a', 'MS')).toBe('in')
  })
})

describe('roster chip status — group stage', () => {
  it('keeps group players in during the group phase, out once the playoff is seeded and they missed it', () => {
    const qwin = { name: 'Qwin', playerId: 'qw', country: 'THA' }
    const qout = { name: 'Qout', playerId: 'qo', country: 'THA' }
    const opp = { name: 'Opp', playerId: 'op', country: 'THA' }

    // Group phase only: nobody dimmed yet (no playoff draw seeded).
    const groupsOnly: MatchScheduleGroup = {
      type: 'time', time: '09:00',
      matches: [
        match('WS - Group A', 'Round Robin', [qwin], [qout], 1, 'WS'),
      ],
    }
    const dataG: MatchesData = {
      days: [{ date: '01/07', label: '01/07', dateIso: '2026-07-01', hasMatches: true }],
      currentDate: '2026-07-01', groups: [groupsOnly],
    }
    const statsG = aggregate(dataG, new Map([['2026-07-01', [groupsOnly]]]), {})
    expect(statusFor(statsG, 'qo', 'WS')).toBe('in') // group loss does NOT dim
    expect(statusFor(statsG, 'qw', 'WS')).toBe('in')

    // Playoff seeded (a 'WS' draw exists) with qwin but not qout ⇒ qout out.
    const withPlayoff: MatchScheduleGroup = {
      type: 'time', time: '09:00',
      matches: [
        match('WS - Group A', 'Round Robin', [qwin], [qout], 1, 'WS'),
        match('WS', 'Semi Final', [qwin], [opp], null, 'WS'),
      ],
    }
    const dataP: MatchesData = {
      days: [{ date: '01/07', label: '01/07', dateIso: '2026-07-01', hasMatches: true }],
      currentDate: '2026-07-01', groups: [withPlayoff],
    }
    const statsP = aggregate(dataP, new Map([['2026-07-01', [withPlayoff]]]), {})
    expect(statusFor(statsP, 'qo', 'WS')).toBe('out')  // eliminated in groups, absent from playoff
    expect(statusFor(statsP, 'qw', 'WS')).toBe('in')   // reached playoff, still playing
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest __tests__/roster-chip-status.test.ts`
Expected: FAIL — `statusByEvent` is `undefined`, so every `statusFor(...)` returns `undefined` and the `toBe('gold')` assertions fail.

- [ ] **Step 4: Add the round classifier and the derivation function**

In `lib/tournamentStats.ts`, add `abbrevRoundL` to the existing import from `./i18n` (line 1 currently imports `abbrevRoundL, longRoundL` — it is already imported, so no change needed). Add `ChipStatus` to the type import block from `./types`.

Add the classifier next to `isFinal`/`isSemiFinal` (around line 106):

```typescript
// A round that belongs to a single-elimination bracket (F/SF/QF/R{n}). Group /
// round-robin rounds normalize to something else and return false, so a loss in
// them never counts as a knockout elimination.
function isKnockoutRound(round: string): boolean {
  const a = abbrevRoundL(round, 'en')
  return a === 'F' || a === 'SF' || a === 'QF' || /^R\d+$/.test(a)
}
```

Add the derivation function (place it just above `buildClubRosters`, ~line 741):

```typescript
interface StatusAcc {
  medal?: 'gold' | 'silver' | 'bronze'
  koLoss: boolean     // completed loss in a knockout (non-SF/F) round
  inPlayoff: boolean  // appears in the draw whose name equals the collapsed event
}

// playerId -> { collapsed eventKey -> ChipStatus }. Reuses the same
// `eventName ?? draw` collapse as the roster builders so status keys line up
// with the chip strings. Medals come from finals/semis (walkovers included,
// matching buildClubMedalsAndMultiGold). "out" is knockout-only: a knockout
// loss, or — for grouped formats — a group player absent from a seeded playoff
// draw. Everyone else is "in".
function buildEventStatusByPlayer(
  ctxs: MatchCtx[],
  rosterByDraw?: Map<string, RosterDraw>,
): Map<string, Record<string, ChipStatus>> {
  const perPlayer = new Map<string, Map<string, StatusAcc>>()
  const hasGroupDraw = new Set<string>()   // eventKeys that have a "<event> - Group X" sub-draw
  const playoffSeeded = new Set<string>()  // eventKeys whose "<event>" (playoff) draw exists
  const medalRank = { gold: 3, silver: 2, bronze: 1 } as const

  const accOf = (pid: string, ev: string): StatusAcc => {
    let byE = perPlayer.get(pid)
    if (!byE) { byE = new Map(); perPlayer.set(pid, byE) }
    let a = byE.get(ev)
    if (!a) { a = { koLoss: false, inPlayoff: false }; byE.set(ev, a) }
    return a
  }
  const setMedal = (pid: string, ev: string, m: 'gold' | 'silver' | 'bronze') => {
    const a = accOf(pid, ev)
    if (!a.medal || medalRank[m] > medalRank[a.medal]) a.medal = m
  }

  const walk = (
    drawName: string,
    eventName: string | undefined,
    team1: MatchPlayer[],
    team2: MatchPlayer[],
    round: string,
    winner: 1 | 2 | null,
  ) => {
    const ev = eventName ?? drawName
    const isGroupDraw = drawName !== ev
    if (isGroupDraw) hasGroupDraw.add(ev)
    else playoffSeeded.add(ev)
    for (const p of [...team1, ...team2]) {
      if (!p.playerId) continue
      const a = accOf(p.playerId, ev)
      if (!isGroupDraw) a.inPlayoff = true
    }
    if (winner === null) return
    const win = winner === 1 ? team1 : team2
    const lose = winner === 1 ? team2 : team1
    if (isFinal(round)) {
      for (const p of win) if (p.playerId) setMedal(p.playerId, ev, 'gold')
      for (const p of lose) if (p.playerId) setMedal(p.playerId, ev, 'silver')
    } else if (isSemiFinal(round)) {
      for (const p of lose) if (p.playerId) setMedal(p.playerId, ev, 'bronze')
    } else if (!isGroupDraw && isKnockoutRound(round)) {
      for (const p of lose) if (p.playerId) accOf(p.playerId, ev).koLoss = true
    }
  }

  for (const { match } of ctxs) {
    walk(match.draw, match.eventName, match.team1, match.team2, match.round, match.winner)
  }
  if (rosterByDraw) {
    for (const [drawName, draw] of Array.from(rosterByDraw)) {
      for (const m of draw.entries) {
        walk(drawName, draw.eventName, m.team1, m.team2, m.round, m.winner)
      }
    }
  }

  const resolve = (ev: string, a: StatusAcc): ChipStatus => {
    if (a.medal) return a.medal
    if (a.koLoss) return 'out'
    // Grouped format: group stage resolved (playoff seeded) and this player
    // never reached the playoff ⇒ eliminated in the group phase.
    if (hasGroupDraw.has(ev) && playoffSeeded.has(ev) && !a.inPlayoff) return 'out'
    return 'in'
  }

  const out = new Map<string, Record<string, ChipStatus>>()
  for (const [pid, byE] of Array.from(perPlayer)) {
    const rec: Record<string, ChipStatus> = {}
    for (const [ev, a] of Array.from(byE)) rec[ev] = resolve(ev, a)
    out.set(pid, rec)
  }
  return out
}
```

- [ ] **Step 5: Thread the status map through both roster builders**

Change `buildClubRosters` (current signature ~line 741) to accept the status map and attach it:

```typescript
function buildClubRosters(
  clubs: Record<string, string>,
  names: Record<string, string>,
  eventsByPlayer: Map<string, string[]>,
  statusByPlayer: Map<string, Record<string, ChipStatus>>,
): StatsClubRoster[] {
  const membersByClub = new Map<string, StatsClubMember[]>()
  for (const [pid, club] of Object.entries(clubs)) {
    if (!club) continue
    const list = membersByClub.get(club) ?? []
    list.push({
      name: names[pid] ?? `#${pid}`,
      playerId: pid,
      events: eventsByPlayer.get(pid) ?? [],
      statusByEvent: statusByPlayer.get(pid),
    })
    membersByClub.set(club, list)
  }
  // ...rest of the function unchanged...
```

In `buildCountryRosters` (~line 770), add a `statusByPlayer` parameter and attach it where each member is pushed (~line 809):

```typescript
function buildCountryRosters(
  ctxs: MatchCtx[],
  statusByPlayer: Map<string, Record<string, ChipStatus>>,
  rosterByDraw?: Map<string, RosterDraw>,
): StatsCountryRoster[] {
  // ...unchanged collection loops...
  for (const [playerId, { country, name, events }] of Array.from(playerInfo.entries())) {
    const list = rosterByCountry.get(country) ?? []
    list.push({
      name,
      playerId,
      events: Array.from(events).sort((a, b) => eventRank(a) - eventRank(b) || a.localeCompare(b)),
      statusByEvent: statusByPlayer.get(playerId),
    })
    rosterByCountry.set(country, list)
  }
  // ...rest unchanged...
```

- [ ] **Step 6: Call the derivation in `aggregate` and pass it to both builders**

In `aggregate` (~line 900), compute the map right after `eventsByPlayer`:

```typescript
  const eventsByPlayer = collectPlayerEvents(ctxs, rosterByDraw)
  const statusByPlayer = buildEventStatusByPlayer(ctxs, rosterByDraw)
```

Update BOTH call sites of `buildClubRosters` (the empty-data early return ~line 908 and the main path ~line 923):

```typescript
    clubRosters: buildClubRosters(clubs, names, eventsByPlayer, statusByPlayer),
```

Update BOTH call sites of `buildCountryRosters` (~line 909 and ~line 924) — note the new parameter goes before `rosterByDraw`:

```typescript
    countryRosters: buildCountryRosters(ctxs, statusByPlayer, rosterByDraw),
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx jest __tests__/roster-chip-status.test.ts`
Expected: PASS (both describe blocks green).

- [ ] **Step 8: Run the existing stats tests to confirm no regressions**

Run: `npx jest __tests__/tournamentStats.test.ts __tests__/country-roster.test.ts __tests__/club-roster.test.ts`
Expected: PASS (the new optional field doesn't change existing assertions).

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add lib/types.ts lib/tournamentStats.ts __tests__/roster-chip-status.test.ts
git commit -m "feat(stats): derive per-player event result status for roster chips"
```

---

### Task 2: Color the chips + legend in the roster modals

**Files:**
- Modify: `components/RosterModal.tsx` (add `statusByEvent` to `RosterRow`, apply chip class, render legend)
- Modify: `components/ClubRosterModal.tsx` (pass `statusByEvent` through the fallback + rich rows)
- Modify: `components/CountryRosterModal.tsx` (pass `statusByEvent` through the fallback + rich rows)
- Modify: `lib/i18n.ts` (four legend keys in the union type + `en` + `th`)
- Modify: `app/globals.css` (four chip state classes + legend styles)
- Test: `__tests__/RosterModal.test.tsx` (add cases)

**Interfaces:**
- Consumes: `ChipStatus` from `lib/types.ts`; `StatsClubMember.statusByEvent` / `StatsCountryMember.statusByEvent` produced by Task 1.
- Produces: `RosterRow.statusByEvent?: Record<string, ChipStatus>`; chips rendered with class `country-roster-chip country-roster-chip--<status>`.

- [ ] **Step 1: Add the i18n legend keys**

In `lib/i18n.ts`, add four keys to the union type block (next to `rosterNoMatches`, ~line 205):

```typescript
  | 'rosterLegendChampion'
  | 'rosterLegendRunnerUp'
  | 'rosterLegendSemifinal'
  | 'rosterLegendOut'
```

Add to the `en` block (next to `rosterNoMatches`, ~line 446):

```typescript
    rosterLegendChampion: 'Champion',
    rosterLegendRunnerUp: 'Runner-up',
    rosterLegendSemifinal: 'Semifinal',
    rosterLegendOut: 'Out',
```

Add to the `th` block (next to the Thai `rosterNoMatches`, ~line 733):

```typescript
    rosterLegendChampion: 'แชมป์',
    rosterLegendRunnerUp: 'รองแชมป์',
    rosterLegendSemifinal: 'รอบรองฯ',
    rosterLegendOut: 'ตกรอบ',
```

- [ ] **Step 2: Write the failing component test**

Add to `__tests__/RosterModal.test.tsx` (after the existing `describe` blocks):

```typescript
describe('RosterModal chip status colors', () => {
  const coloredRows: RosterRow[] = [
    { name: 'Gold', playerId: 'g', events: ['MS'], statusByEvent: { MS: 'gold' } },
    { name: 'Silver', playerId: 's', events: ['WS'], statusByEvent: { WS: 'silver' } },
    { name: 'Bronze', playerId: 'b', events: ['XD'], statusByEvent: { XD: 'bronze' } },
    { name: 'Out', playerId: 'o', events: ['MD'], statusByEvent: { MD: 'out' } },
    { name: 'Plain', playerId: 'p', events: ['GD'] },
  ]

  function renderColored() {
    return render(
      <LanguageProvider>
        <RosterModal open title="KBA" count={coloredRows.length} rows={coloredRows} onClose={() => {}} />
      </LanguageProvider>,
    )
  }

  const chipClass = (text: string) =>
    Array.from(document.querySelectorAll('.country-roster-chip'))
      .find((el) => el.textContent === text)?.className ?? ''

  it('applies a per-status class to each chip', () => {
    renderColored()
    expect(chipClass('MS')).toContain('country-roster-chip--gold')
    expect(chipClass('WS')).toContain('country-roster-chip--silver')
    expect(chipClass('XD')).toContain('country-roster-chip--bronze')
    expect(chipClass('MD')).toContain('country-roster-chip--out')
  })

  it('falls back to the neutral "in" status when statusByEvent is missing', () => {
    renderColored()
    const cls = chipClass('GD')
    expect(cls).toContain('country-roster-chip')
    expect(cls).toContain('country-roster-chip--in')
  })

  it('renders a legend', () => {
    renderColored()
    expect(document.querySelector('.roster-legend')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest __tests__/RosterModal.test.tsx`
Expected: FAIL — chips have no `--gold`/`--silver`/etc. class and `.roster-legend` doesn't exist.

- [ ] **Step 4: Add `statusByEvent` to `RosterRow` and apply the chip class + legend**

In `components/RosterModal.tsx`, extend the interface and imports:

```typescript
import type { ChipStatus } from '@/lib/types'

export interface RosterRow {
  name: string
  events: string[]
  playerId?: string
  // Per-event result keyed by the same strings in `events`. Missing ⇒ 'in'.
  statusByEvent?: Record<string, ChipStatus>
}
```

Replace the chip render (the `r.events.map(...)` block, ~line 85) so each chip picks up its status class:

```typescript
                      ? r.events.map((e) => {
                          const status: ChipStatus = r.statusByEvent?.[e] ?? 'in'
                          return (
                            <span className={`country-roster-chip country-roster-chip--${status}`} key={e}>{e}</span>
                          )
                        })
```

Add the legend inside the filter `pm-section` (right after the filter `<input>`, before the list section):

```tsx
        <div className="pm-section roster-legend">
          <span className="roster-legend-item"><span className="country-roster-chip country-roster-chip--gold roster-legend-swatch" />{t('rosterLegendChampion')}</span>
          <span className="roster-legend-item"><span className="country-roster-chip country-roster-chip--silver roster-legend-swatch" />{t('rosterLegendRunnerUp')}</span>
          <span className="roster-legend-item"><span className="country-roster-chip country-roster-chip--bronze roster-legend-swatch" />{t('rosterLegendSemifinal')}</span>
          <span className="roster-legend-item"><span className="country-roster-chip country-roster-chip--out roster-legend-swatch" />{t('rosterLegendOut')}</span>
        </div>
```

- [ ] **Step 5: Pass `statusByEvent` through both caller modals**

In `components/ClubRosterModal.tsx`, update the row mapping (~line 19):

```typescript
  const rows: RosterRow[] = roster.roster
    ? roster.roster.map((m) => ({ name: m.name, playerId: m.playerId, events: m.events, statusByEvent: m.statusByEvent }))
    : roster.members.map((name) => ({ name, events: [] }))
```

In `components/CountryRosterModal.tsx`, update the row mapping (~line 43):

```typescript
  const rows: RosterRow[] = roster.roster
    ? roster.roster.map((m) => ({ name: m.name, playerId: m.playerId, events: m.events, statusByEvent: m.statusByEvent }))
    : roster.members.map((name) => ({ name, events: [] }))
```

- [ ] **Step 6: Add the CSS state + legend styles**

In `app/globals.css`, right after the `.country-roster-chip` rule (~line 2428), add:

```css
.country-roster-chip--in { /* neutral default, no override */ }
.country-roster-chip--gold {
  border-color: #c9a227;
  border-left: 3px solid #c9a227;
  background: rgba(201, 162, 39, 0.14);
  color: var(--fg);
}
.country-roster-chip--silver {
  border-color: #9aa3ad;
  border-left: 3px solid #9aa3ad;
  background: rgba(154, 163, 173, 0.16);
  color: var(--fg);
}
.country-roster-chip--bronze {
  border-color: #b0764a;
  border-left: 3px solid #b0764a;
  background: rgba(176, 118, 74, 0.16);
  color: var(--fg);
}
.country-roster-chip--out {
  opacity: 0.45;
}
.roster-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--muted);
  align-items: center;
}
.roster-legend-item { display: inline-flex; align-items: center; gap: 4px; }
.roster-legend-swatch {
  width: 14px;
  height: 14px;
  padding: 0;
  border-radius: 4px;
}
```

- [ ] **Step 7: Run the component test to verify it passes**

Run: `npx jest __tests__/RosterModal.test.tsx`
Expected: PASS.

- [ ] **Step 8: Run the caller-modal tests + typecheck**

Run: `npx jest __tests__/ClubRosterModal.test.tsx __tests__/CountryRosterModal.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add components/RosterModal.tsx components/ClubRosterModal.tsx components/CountryRosterModal.tsx lib/i18n.ts app/globals.css __tests__/RosterModal.test.tsx
git commit -m "feat(stats): color roster chips by result with a legend"
```

---

## Self-Review

**Spec coverage:**
- Five-state model (gold/silver/bronze/out/in) → Task 1 Step 1 (`ChipStatus`), Task 2 Steps 4/6 (rendering + CSS). ✓
- Precedence (medal > in > out; medal wins across draws) → Task 1 Step 4 (`resolve` order + `medalRank`). ✓
- Join-key normalization (chip `eventName` vs medal `draw`) → Task 1 Step 4 (`ev = eventName ?? drawName`). ✓ (test: group case asserts `WS` key resolves).
- Live timing + knockout-only elimination, group players not dimmed mid-phase → Task 1 Step 4 (`isKnockoutRound` guard, `hasGroupDraw`/`playoffSeeded`) + Task 1 Step 2 group test. ✓
- Additive/backward-compatible field → Task 1 Step 1 (`?` optional) + Task 2 Step 2 fallback test. ✓
- Both club and country modals → Task 1 Step 5 (both builders) + Task 2 Step 5 (both callers). ✓
- Legend, localized → Task 2 Steps 1/4/6. ✓
- Tests for gold/silver/bronze, knockout-loss out, group-in, group-out, precedence, backward compat → Task 1 Step 2 + Task 2 Step 2. ✓

**Known limitation (documented, accepted per "knockout-only, simple"):** if a group stage finishes but the playoff draw is not yet seeded (a brief transient), qualified group players read as `in` rather than `out`; they never wrongly flip to `out` because `playoffSeeded` gates the group-elimination branch.

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `ChipStatus` union identical everywhere; `statusByEvent?: Record<string, ChipStatus>` identical on both member types and `RosterRow`; `buildEventStatusByPlayer` returns `Map<string, Record<string, ChipStatus>>` consumed as `statusByPlayer` by both builders; CSS class name `country-roster-chip--<status>` matches the four defined classes plus the no-op `--in`. ✓

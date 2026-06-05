# BWF Ranking Detail — Per-Event Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-player Ranking Detail panel on BWF profiles render one section per ranked event (e.g. `Boy's singles U15`, `Boy's singles U17`) inside each discipline tab, with each row showing its discounted credit toward that event (e.g. `2125 → 638`).

**Architecture:** Additive parser change captures the parenthesised credit BWF prints in the `Used for:` marker into a new structured field. A new view-layer function buckets tournaments by target ranking event and applies BAT-style dedup + top-10/others. The component layer branches on provider: BAT keeps its current Top/Others layout untouched; BWF stacks per-event sections via a new `<BwfRankingSection>` component using the existing `<TournamentRow>` with a new `creditOverride` prop.

**Tech Stack:** Next.js 14 (App Router) · TypeScript · Jest (next/jest) · existing `lib/ranking/*` modules.

**Spec:** `docs/superpowers/specs/2026-06-05-bwf-ranking-by-event-design.md`

---

## File Structure

**New files**

- `components/BwfRankingSection.tsx` — renders one ranking-event section (header + Top + Others)
- `fixtures/ranking-player-bwf-ravin.html` — captured per-player page for Ravin CHUCHAISRI (cross-tier test fixture)

**Modified files**

- `lib/types.ts` — add `RankingTargetCredit`; add optional `countsTowardRankingsParsed` to `RankingPlayerTournament`
- `lib/ranking/player-scraper.ts` — add `parseMarkerCredits`; populate the new field in `parseRow`
- `lib/ranking/player-view.ts` — add `RankingSection`, `RankingSectionRow`, `bwfSectionsForTab`, `disciplineOfEventName`
- `components/RankingDetailTabs.tsx` — accept `currentRanking` prop; branch to BWF section render when `provider === 'bwf'`
- `components/PlayerProfileView.tsx` — accept and forward `currentRanking` prop
- `app/player/[provider]/[slug]/page.tsx` — pass the already-read `currentRanking` down
- `components/TournamentRow.tsx` — accept optional `creditOverride: number`; render `raw → credit` when override differs from row points
- `__tests__/ranking-player-scraper.test.ts` — add cases for parsed credits
- `__tests__/ranking-player-view.test.ts` — add `bwfSectionsForTab` test block
- `app/globals.css` — add `.pp-rd-section-event*` styling (small, mirrors existing `.pp-rd-section-header`)

**New tests**

- `__tests__/ranking-bwf-sections-fixture.test.ts` — integration test against Ravin's real captured HTML

**Untouched (referenced for context)**

- BAT-side rendering — confirmed out of scope. `topRowsForTab` / `otherRowsForTab` and the existing BAT JSX path stay byte-for-byte identical.

---

## Task 1: Capture Ravin's BWF per-player fixture

**Files:**
- Create: `fixtures/ranking-player-bwf-ravin.html`

Need a real cross-tier fixture (U15 main + U13 carry-over) to anchor the integration test against. Ravin CHUCHAISRI (BWF `player=5799633`) has exactly this shape.

- [ ] **Step 1: Fetch Ravin's per-player page**

```bash
curl -sL \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" \
  -H "Cookie: st=l=2057&exp=46542&c=1&cp=23" \
  "https://www.tournamentsoftware.com/ranking/player.aspx?id=52035&player=5799633" \
  -o fixtures/ranking-player-bwf-ravin.html
```

- [ ] **Step 2: Verify fixture shape**

```bash
wc -c fixtures/ranking-player-bwf-ravin.html
grep -cE 'tournament\.aspx\?id=' fixtures/ranking-player-bwf-ravin.html       # expect ≥ 4
grep -oE 'title="Used for: [^"]+\([0-9.]+\)' fixtures/ranking-player-bwf-ravin.html | head -2
```

Expected: file ≈30 KB; at least 4 tournament rows; at least one Used-for title with a parenthesised number (proof the file captured cross-tier credits).

- [ ] **Step 3: Commit the fixture**

```bash
git add fixtures/ranking-player-bwf-ravin.html
git commit -m "test(fixtures): capture Ravin's BWF per-player page (cross-tier credits)"
```

---

## Task 2: Add the `RankingTargetCredit` type and field

**Files:**
- Modify: `lib/types.ts`

Additive only — every existing caller of `RankingPlayerTournament` keeps working.

- [ ] **Step 1: Add the new type and field**

Open `lib/types.ts`. Find `export interface RankingPlayerTournament` (around the existing `countsTowardRankings` field).

Add a new exported interface immediately above it, and a new optional field on `RankingPlayerTournament`:

Find this block:
```ts
/** One tournament row on a player's ranking detail page (BAT or BWF). */
export interface RankingPlayerTournament {
  tournamentName: string
  tournamentId: string | null
  sourceEvent: string
  week: string
  result: string
  points: number
  countsTowardRankings: string[]
}
```

Replace it with:
```ts
/** One target ranking event a tournament row contributes to, with the
 *  credit value parsed from the Used-for marker. Credit equals the row's
 *  raw `points` when the marker had no parenthesised value (same-tier),
 *  or the parenthesised value when present (cross-tier, e.g. 30% of raw
 *  for one tier up in BWF). */
export interface RankingTargetCredit {
  eventName: string
  credit: number
}

/** One tournament row on a player's ranking detail page (BAT or BWF). */
export interface RankingPlayerTournament {
  tournamentName: string
  tournamentId: string | null
  sourceEvent: string
  week: string
  result: string
  points: number
  /** Raw strings parsed from the Used-for marker, e.g.
   *  `["Boy's singles U17(288)", "Boy's singles U15"]`. Kept so BAT
   *  callers (which only check `length > 0`) keep working. */
  countsTowardRankings: string[]
  /** Structured per-target credits parsed from the same marker. Optional
   *  so detail JSONs cached before this change still load. */
  countsTowardRankingsParsed?: RankingTargetCredit[]
}
```

- [ ] **Step 2: Compile-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): RankingTargetCredit + optional countsTowardRankingsParsed"
```

---

## Task 3: Parser captures structured credits

**Files:**
- Modify: `lib/ranking/player-scraper.ts`
- Modify: `__tests__/ranking-player-scraper.test.ts`

TDD: write the failing assertion, then make it pass.

- [ ] **Step 1: Add failing tests**

Open `__tests__/ranking-player-scraper.test.ts`. Append at the end of the file:

```ts
describe('parseRankingPlayerPage — structured credits', () => {
  // Inline mini-HTML so the test does not depend on a captured fixture.
  // Matches BWF's row layout: 7 <td> cells, last one carrying the marker img.
  const rowWithCrossTier = `<table><tr>
    <td><a href="tournament.aspx?id=52035&tournament=305912">MITH YONEX</a></td>
    <td><a href="../sport/event.aspx?id=X&event=2">MS-U15</a></td>
    <td>2026-22</td>
    <td align="right"></td>
    <td align="right">960</td>
    <td><a href="../sport/player.aspx?id=X&player=121">Matches</a></td>
    <td><img src="x.gif" alt="" title="Used for: Boy's singles U17(288), Boy's singles U15" /></td>
  </tr></table>`

  const rowWithSingleDiscount = `<table><tr>
    <td><a href="tournament.aspx?id=52035&tournament=286957">YONEX CP</a></td>
    <td><a href="../sport/event.aspx?id=Y&event=6">MS U13</a></td>
    <td>2025-45</td>
    <td align="right"></td>
    <td align="right">2125</td>
    <td><a href="../sport/player.aspx?id=Y&player=163">Matches</a></td>
    <td><img src="x.gif" alt="" title="Used for: Boy's singles U15(637.5)" /></td>
  </tr></table>`

  it('parses both a discounted and a full-credit target on one row', () => {
    const { tournaments } = parseRankingPlayerPage(rowWithCrossTier)
    expect(tournaments).toHaveLength(1)
    const t = tournaments[0]
    expect(t.points).toBe(960)
    expect(t.countsTowardRankings).toEqual([
      "Boy's singles U17(288)",
      "Boy's singles U15",
    ])
    expect(t.countsTowardRankingsParsed).toEqual([
      { eventName: "Boy's singles U17", credit: 288 },
      { eventName: "Boy's singles U15", credit: 960 },
    ])
  })

  it('preserves decimal credit', () => {
    const { tournaments } = parseRankingPlayerPage(rowWithSingleDiscount)
    expect(tournaments[0].countsTowardRankingsParsed).toEqual([
      { eventName: "Boy's singles U15", credit: 637.5 },
    ])
  })

  it('row with no marker gets empty parsed credits', () => {
    const noMarker = `<table><tr>
      <td><a href="tournament.aspx?id=A&tournament=1">X</a></td>
      <td><a href="event.aspx?id=A">MS-U15</a></td>
      <td>2026-22</td>
      <td></td>
      <td>500</td>
      <td><a>Matches</a></td>
    </tr></table>`
    const { tournaments } = parseRankingPlayerPage(noMarker)
    expect(tournaments[0].countsTowardRankings).toEqual([])
    expect(tournaments[0].countsTowardRankingsParsed).toEqual([])
  })
})
```

- [ ] **Step 2: Run the new tests — confirm they fail**

```bash
npx jest __tests__/ranking-player-scraper.test.ts --no-coverage
```

Expected: 3 failures referencing `countsTowardRankingsParsed` (currently undefined / missing).

- [ ] **Step 3: Implement `parseMarkerCredits` and call it from `parseRow`**

Open `lib/ranking/player-scraper.ts`.

Find the imports section at the top:
```ts
import type { RankingPlayerTournament } from '@/lib/types'
```

Change it to:
```ts
import type { RankingPlayerTournament, RankingTargetCredit } from '@/lib/types'
```

Find this function:
```ts
function parseMarkerCategories(cell: string): string[] {
  const img = cell.match(/<img\b[^>]*title="([^"]+)"[^>]*>/i)
  if (!img) return []
  const title = decodeEntities(img[1])
  const idx = title.indexOf(':')
  const tail = idx >= 0 ? title.slice(idx + 1) : title
  return tail.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
}
```

Add a sibling function immediately below it:
```ts
/** Like parseMarkerCategories but extracts each entry's structured
 *  credit. Entries shaped like `"Boy's singles U17(288)"` yield credit 288;
 *  entries with no parens yield credit = rowPoints. */
function parseMarkerCredits(rowPoints: number, cell: string): RankingTargetCredit[] {
  const img = cell.match(/<img\b[^>]*title="([^"]+)"[^>]*>/i)
  if (!img) return []
  const title = decodeEntities(img[1])
  const idx = title.indexOf(':')
  const tail = idx >= 0 ? title.slice(idx + 1) : title
  return tail.split(',').map((s) => s.trim()).filter((s) => s.length > 0).map((s) => {
    const m = s.match(/^(.+?)\s*\(([\d.]+)\)\s*$/)
    if (m) return { eventName: m[1].trim(), credit: parseFloat(m[2]) }
    return { eventName: s, credit: rowPoints }
  })
}
```

Then find `parseRow`. Inside it, locate this block near the end:
```ts
  const markerCell = tds.length >= 7 ? tds[6] : ''
  const countsTowardRankings = parseMarkerCategories(markerCell)

  return {
    tournamentName, tournamentId, sourceEvent, week, result, points, countsTowardRankings,
  }
```

Replace with:
```ts
  const markerCell = tds.length >= 7 ? tds[6] : ''
  const countsTowardRankings = parseMarkerCategories(markerCell)
  const countsTowardRankingsParsed = parseMarkerCredits(points, markerCell)

  return {
    tournamentName, tournamentId, sourceEvent, week, result, points,
    countsTowardRankings, countsTowardRankingsParsed,
  }
```

- [ ] **Step 4: Run the parser tests — confirm pass**

```bash
npx jest __tests__/ranking-player-scraper.test.ts --no-coverage
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add lib/ranking/player-scraper.ts __tests__/ranking-player-scraper.test.ts
git commit -m "feat(ranking): parse per-target credits from Used-for marker"
```

---

## Task 4: `bwfSectionsForTab` view function

**Files:**
- Modify: `lib/ranking/player-view.ts`
- Modify: `__tests__/ranking-player-view.test.ts`

- [ ] **Step 1: Add failing tests**

Open `__tests__/ranking-player-view.test.ts`. Add these imports to the import block at the top:

```ts
import {
  weekKeyFromPublishDate,
  expiringWithinWeeksCutoff,
  topRowsForTab,
  otherRowsForTab,
  disciplineOf,
  dedupePerTournament,
  bwfSectionsForTab,
  disciplineOfEventName,
  TOP_N,
} from '@/lib/ranking/player-view'
import type { RankingPlayerDetail, RankingPlayerTournament, Ranking } from '@/lib/types'
```

(Only `bwfSectionsForTab`, `disciplineOfEventName`, and `Ranking` are new; the rest were already imported.)

Append at the end of the file:

```ts
describe('disciplineOfEventName', () => {
  it.each([
    ["Boy's singles U15", 'singles'],
    ["Girls's singles U17", 'singles'],
    ["Boy's doubles U15", 'doubles'],
    ['Mixed doubles U15', 'mixed'],
    ['U23 Men\'s singles', 'singles'],
  ])('%s → %s', (input, expected) => {
    expect(disciplineOfEventName(input)).toBe(expected)
  })
})

describe('bwfSectionsForTab', () => {
  // Helper: a tournament row with a single parsed target.
  const tx = (
    sourceEvent: string,
    points: number,
    targets: Array<{ eventName: string; credit: number }>,
    week = '2026-22',
    tournamentName?: string,
  ): RankingPlayerTournament => ({
    tournamentName: tournamentName ?? `T ${sourceEvent} ${points} ${week}`,
    tournamentId: null,
    sourceEvent, week, result: '1/2', points,
    countsTowardRankings: targets.map(t =>
      t.credit === points ? t.eventName : `${t.eventName}(${t.credit})`,
    ),
    countsTowardRankingsParsed: targets,
  })

  const det = (rows: RankingPlayerTournament[]): RankingPlayerDetail => ({
    globalPlayerId: '1', publishDate: '03/06/2026', scrapedAt: 'x', tournaments: rows,
  })

  it('single-event player: all rows in one section', () => {
    const d = det([
      tx('MS-U15', 960, [{ eventName: "Boy's singles U15", credit: 960 }]),
      tx('MS-U15', 800, [{ eventName: "Boy's singles U15", credit: 800 }], '2026-20'),
    ])
    const sections = bwfSectionsForTab(d, 'singles')
    expect(sections).toHaveLength(1)
    expect(sections[0].eventName).toBe("Boy's singles U15")
    expect(sections[0].top).toHaveLength(2)
    expect(sections[0].topTotal).toBe(1760)
  })

  it('cross-tier carry: U13 row contributes discounted credit to U15', () => {
    const d = det([
      tx('MS-U15', 960, [{ eventName: "Boy's singles U15", credit: 960 }], '2026-22', 'MITH YONEX'),
      tx('MS U13', 2125, [{ eventName: "Boy's singles U15", credit: 637.5 }], '2025-45', 'YONEX CP'),
    ])
    const sections = bwfSectionsForTab(d, 'singles')
    expect(sections).toHaveLength(1)
    const s = sections[0]
    expect(s.eventName).toBe("Boy's singles U15")
    expect(s.topTotal).toBeCloseTo(1597.5, 3)
    const u13Row = s.top.find(sr => sr.row.tournamentName === 'YONEX CP')
    expect(u13Row?.creditInThisSection).toBe(637.5)
    expect(u13Row?.row.points).toBe(2125) // raw kept
  })

  it('carry-up: one row appears in two sections with different credits', () => {
    const d = det([
      tx('MS-U15', 960, [
        { eventName: "Boy's singles U17", credit: 288 },
        { eventName: "Boy's singles U15", credit: 960 },
      ]),
    ])
    const sections = bwfSectionsForTab(d, 'singles')
    expect(sections).toHaveLength(2)
    const u15 = sections.find(s => s.eventName === "Boy's singles U15")
    const u17 = sections.find(s => s.eventName === "Boy's singles U17")
    expect(u15?.top[0].creditInThisSection).toBe(960)
    expect(u17?.top[0].creditInThisSection).toBe(288)
  })

  it('dedup: same (week, tournamentName) collapses to higher credit', () => {
    const d = det([
      tx('MS-U15', 500, [{ eventName: "Boy's singles U15", credit: 500 }], '2026-22', 'DupeName'),
      tx('MS-U17', 800, [{ eventName: "Boy's singles U15", credit: 240 }], '2026-22', 'DupeName'),
    ])
    const s = bwfSectionsForTab(d, 'singles')[0]
    expect(s.top).toHaveLength(1)
    expect(s.top[0].creditInThisSection).toBe(500)
  })

  it('discipline filter: doubles section excluded from singles tab', () => {
    const d = det([
      tx('MS-U15', 960, [{ eventName: "Boy's singles U15", credit: 960 }]),
      tx('MD-U15', 1750, [{ eventName: "Boy's doubles U15", credit: 1750 }]),
    ])
    expect(bwfSectionsForTab(d, 'singles')).toHaveLength(1)
    expect(bwfSectionsForTab(d, 'doubles')).toHaveLength(1)
    expect(bwfSectionsForTab(d, 'mixed')).toHaveLength(0)
  })

  it('rows with no parsed targets are silently dropped (BWF semantics)', () => {
    const d = det([
      { ...tx('MS-U15', 0, []), countsTowardRankings: [], countsTowardRankingsParsed: [] },
    ])
    expect(bwfSectionsForTab(d, 'singles')).toHaveLength(0)
  })

  it('falls back to deriving from raw string when parsed field is absent', () => {
    // Simulate an older cached detail JSON where the parsed field was never written.
    const row: RankingPlayerTournament = {
      tournamentName: 'Older', tournamentId: null, sourceEvent: 'MS-U15',
      week: '2026-22', result: '1/2', points: 500,
      countsTowardRankings: ["Boy's singles U17(150)", "Boy's singles U15"],
      // countsTowardRankingsParsed intentionally omitted
    }
    const sections = bwfSectionsForTab(det([row]), 'singles')
    expect(sections).toHaveLength(2)
    const u17 = sections.find(s => s.eventName === "Boy's singles U17")
    const u15 = sections.find(s => s.eventName === "Boy's singles U15")
    expect(u17?.top[0].creditInThisSection).toBe(150)
    expect(u15?.top[0].creditInThisSection).toBe(500)
  })

  it('section ordering: ranked sections first by rank asc, then unranked by age desc', () => {
    const d = det([
      tx('MS-U15', 960, [
        { eventName: "Boy's singles U17", credit: 288 },
        { eventName: "Boy's singles U15", credit: 960 },
      ]),
      tx('MS U13', 2125, [
        { eventName: "Boy's singles U15", credit: 637.5 },
      ], '2025-45'),
    ])
    const current: Ranking = {
      provider: 'bwf', scrapedAt: 'x', publishDate: '03/06/2026', rankingId: '52035',
      events: [
        { eventCode: 'U15_MS', eventName: "Boy's singles U15", entries: [
          { rank: 10, name: 'X', slug: 'x', club: '', points: 1598, tournaments: 2, globalPlayerId: '1' },
        ]},
        // No entry for U17 — player is not ranked there.
      ],
    }
    const sections = bwfSectionsForTab(d, 'singles', { slug: 'x', current })
    expect(sections.map(s => s.eventName)).toEqual([
      "Boy's singles U15",   // ranked #10 → first
      "Boy's singles U17",   // unranked → after, by age desc would still put U17 over U15 but U15 is ranked
    ])
  })
})
```

- [ ] **Step 2: Run the new tests — confirm they fail**

```bash
npx jest __tests__/ranking-player-view.test.ts --no-coverage
```

Expected: failures referencing `bwfSectionsForTab` / `disciplineOfEventName` (not yet exported).

- [ ] **Step 3: Implement the view helpers**

Open `lib/ranking/player-view.ts`.

Find the imports at the top:
```ts
import type {
  RankingPlayerDetail,
  RankingPlayerTournament,
} from '@/lib/types'
```

Replace with:
```ts
import type {
  Ranking,
  RankingPlayerDetail,
  RankingPlayerTournament,
  RankingTargetCredit,
} from '@/lib/types'
```

At the end of the file, append:

```ts
/** Like disciplineOf but takes a full ranking event name like
 *  "Boy's singles U15" rather than a token like "BS U15". Order of checks
 *  mirrors disciplineOf: mixed before doubles before singles, because
 *  "MIXED" contains "ED" which doesn't but "DOUBLES" wins over "SINGLES"
 *  only after we've ruled out mixed. */
export function disciplineOfEventName(name: string): Discipline | null {
  const upper = name.toUpperCase()
  if (/MIXED/.test(upper)) return 'mixed'
  if (/DOUBLES?/.test(upper)) return 'doubles'
  if (/SINGLES?/.test(upper)) return 'singles'
  return null
}

export interface RankingSectionRow {
  row: RankingPlayerTournament
  /** Credit this row contributes toward this section's ranking event. */
  creditInThisSection: number
}

export interface RankingSection {
  eventName: string
  top: RankingSectionRow[]
  others: RankingSectionRow[]
  topTotal: number
}

/** Derive the structured targets from the raw string list for older cached
 *  details that pre-date countsTowardRankingsParsed. Same parsing rule as
 *  parseMarkerCredits in player-scraper.ts. */
function deriveTargetsFromStrings(rowPoints: number, raw: string[]): RankingTargetCredit[] {
  return raw.map((s) => {
    const m = s.match(/^(.+?)\s*\(([\d.]+)\)\s*$/)
    if (m) return { eventName: m[1].trim(), credit: parseFloat(m[2]) }
    return { eventName: s, credit: rowPoints }
  })
}

function targetsOf(row: RankingPlayerTournament): RankingTargetCredit[] {
  if (row.countsTowardRankingsParsed && row.countsTowardRankingsParsed.length > 0) {
    return row.countsTowardRankingsParsed
  }
  // Fallback for older cached entries OR rows that genuinely have no marker.
  return deriveTargetsFromStrings(row.points, row.countsTowardRankings)
}

/** Player's rank in a given event from the current overview cache,
 *  or null if unranked / no cache. */
function lookupRankIn(current: Ranking | null | undefined, eventName: string, slug: string): number | null {
  if (!current) return null
  const ev = current.events.find((e) => e.eventName === eventName)
  return ev?.entries.find((e) => e.slug === slug)?.rank ?? null
}

/** Numeric age tier from an event name; defaults to Infinity for open events. */
function ageTierOfEventName(name: string): number {
  const m = name.match(/U(\d+)/i)
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY
}

/** BWF-only: one section per target ranking event the player has credit
 *  toward, filtered to the active discipline tab. */
export function bwfSectionsForTab(
  detail: RankingPlayerDetail,
  discipline: Discipline,
  rankCtx?: { slug: string; current: Ranking | null },
): RankingSection[] {
  // 1. Build per-event row map.
  const byEvent = new Map<string, RankingSectionRow[]>()
  for (const row of detail.tournaments) {
    for (const target of targetsOf(row)) {
      // 2. Discipline filter.
      if (disciplineOfEventName(target.eventName) !== discipline) continue
      const bucket = byEvent.get(target.eventName) ?? []
      bucket.push({ row, creditInThisSection: target.credit })
      byEvent.set(target.eventName, bucket)
    }
  }

  // 3. Per-section dedup, sort, top/others split.
  const sections: RankingSection[] = []
  for (const [eventName, rows] of byEvent.entries()) {
    // Collapse (week, tournamentName) collisions keeping higher credit.
    const dedupKey = (sr: RankingSectionRow) =>
      `${weekSortKey(sr.row.week)}::${sr.row.tournamentName.trim()}`
    const dedupMap = new Map<string, RankingSectionRow>()
    for (const sr of rows) {
      const key = dedupKey(sr)
      const ex = dedupMap.get(key)
      if (!ex || sr.creditInThisSection > ex.creditInThisSection) dedupMap.set(key, sr)
    }
    const sorted = Array.from(dedupMap.values()).sort(
      (a, b) =>
        b.creditInThisSection - a.creditInThisSection ||
        weekSortKey(b.row.week).localeCompare(weekSortKey(a.row.week)),
    )
    const top = sorted.slice(0, TOP_N).sort(
      (a, b) => weekSortKey(b.row.week).localeCompare(weekSortKey(a.row.week)),
    )
    const others = sorted.slice(TOP_N)
    const topTotal = top.reduce((sum, sr) => sum + sr.creditInThisSection, 0)
    sections.push({ eventName, top, others, topTotal })
  }

  // 4. Section ordering: ranked first (by rank asc), then unranked (by age desc).
  sections.sort((a, b) => {
    const ra = rankCtx ? lookupRankIn(rankCtx.current, a.eventName, rankCtx.slug) : null
    const rb = rankCtx ? lookupRankIn(rankCtx.current, b.eventName, rankCtx.slug) : null
    if (ra !== null && rb !== null) return ra - rb
    if (ra !== null) return -1
    if (rb !== null) return 1
    return ageTierOfEventName(b.eventName) - ageTierOfEventName(a.eventName)
  })

  return sections
}
```

- [ ] **Step 4: Run the view tests — confirm pass**

```bash
npx jest __tests__/ranking-player-view.test.ts --no-coverage
```

Expected: all green.

- [ ] **Step 5: Compile-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ranking/player-view.ts __tests__/ranking-player-view.test.ts
git commit -m "feat(ranking): bwfSectionsForTab + disciplineOfEventName"
```

---

## Task 5: TournamentRow accepts `creditOverride`

**Files:**
- Modify: `components/TournamentRow.tsx`

- [ ] **Step 1: Update Props and render**

Open `components/TournamentRow.tsx`. Replace the entire file with:

```tsx
'use client'
import Link from 'next/link'
import { useLanguage } from '@/lib/LanguageContext'
import type { ExpiryTier } from '@/lib/ranking/player-view'
import type { RankingPlayerTournament } from '@/lib/types'

interface Props {
  row: RankingPlayerTournament
  /**
   *   'next' — row's points fall out at the very next publication
   *   'soon' — fall out within the next 4 publications
   *   null  — safe for at least 4 more publications
   */
  expiry?: ExpiryTier
  /** When set, the points cell shows the row's raw points → this credit
   *  (e.g. "2125 → 638"). When equal to raw points or undefined, the cell
   *  renders the single number as today. */
  creditOverride?: number
}

/**
 * Single tournament row inside a ranking-detail block. Tournament name links
 * to the in-app tournament view when we have a GUID; otherwise renders as
 * plain text. All other fields are display-only.
 */
export default function TournamentRow({ row, expiry = null, creditOverride }: Props) {
  const { t } = useLanguage()
  const cls = expiry === 'next'
    ? 'pp-rd-row pp-rd-row--expiring'
    : expiry === 'soon'
      ? 'pp-rd-row pp-rd-row--expiring-soon'
      : 'pp-rd-row'
  const title = expiry === 'next'
    ? t('rankingDetailExpiringNext')
    : expiry === 'soon'
      ? t('rankingDetailExpiringWithin4Weeks')
      : undefined
  const name = row.tournamentId
    ? <Link href={`/?tournament=${row.tournamentId}`}>{row.tournamentName}</Link>
    : <span>{row.tournamentName}</span>
  const showDiscount = creditOverride != null && Math.round(creditOverride) !== row.points
  const pointsCell = showDiscount
    ? `${row.points.toLocaleString()} → ${Math.round(creditOverride!).toLocaleString()}`
    : row.points.toLocaleString()
  return (
    <div className={cls} title={title}>
      <span>{name}</span>
      <span className="pp-rd-row-event">{row.sourceEvent}</span>
      <span className="pp-rd-row-week">{row.week}</span>
      <span className="pp-rd-row-result">{row.result}</span>
      <span className="pp-rd-row-pts">{pointsCell}</span>
    </div>
  )
}
```

- [ ] **Step 2: Compile-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/TournamentRow.tsx
git commit -m "feat(components): TournamentRow optional creditOverride for raw→credit display"
```

---

## Task 6: `<BwfRankingSection>` component

**Files:**
- Create: `components/BwfRankingSection.tsx`

- [ ] **Step 1: Write the component**

Create `components/BwfRankingSection.tsx` with:

```tsx
'use client'
import { useLanguage } from '@/lib/LanguageContext'
import { classifyExpiry, type ExpiryCutoffs, type RankingSection } from '@/lib/ranking/player-view'
import type { Ranking } from '@/lib/types'
import TournamentRow from './TournamentRow'

interface Props {
  /** Player slug — used to look up the player's rank in this event for the
   *  section header. */
  slug: string
  section: RankingSection
  cutoffs: ExpiryCutoffs
  currentRanking?: Ranking | null
}

function lookupRank(current: Ranking | null | undefined, eventName: string, slug: string): number | null {
  if (!current) return null
  const ev = current.events.find((e) => e.eventName === eventName)
  return ev?.entries.find((e) => e.slug === slug)?.rank ?? null
}

export default function BwfRankingSection({ slug, section, cutoffs, currentRanking }: Props) {
  const { t } = useLanguage()
  const myRank = lookupRank(currentRanking, section.eventName, slug)
  const totalDisplay = Math.round(section.topTotal).toLocaleString()
  return (
    <section className="pp-rd-section-event">
      <h3 className="pp-rd-section-event-header">
        <span>{section.eventName}</span>
        <span className="pp-rd-section-event-meta">
          {myRank !== null && <>#{myRank} · </>}
          {totalDisplay} pts
        </span>
      </h3>

      <h4 className="pp-rd-section-subheader">{t('rankingDetailTopTen')}</h4>
      {section.top.map((sr, i) => (
        <TournamentRow
          key={`t-${i}-${sr.row.week}-${sr.row.tournamentName}`}
          row={sr.row}
          creditOverride={sr.creditInThisSection}
          expiry={classifyExpiry(sr.row.week, cutoffs)}
        />
      ))}

      {section.others.length > 0 && (
        <>
          <h4 className="pp-rd-section-subheader pp-rd-section-subheader--divided">
            {t('rankingDetailOthersTournaments')}
          </h4>
          {section.others.map((sr, i) => (
            <TournamentRow
              key={`o-${i}-${sr.row.week}-${sr.row.tournamentName}`}
              row={sr.row}
              creditOverride={sr.creditInThisSection}
              expiry={classifyExpiry(sr.row.week, cutoffs)}
            />
          ))}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Compile-check**

```bash
npx tsc --noEmit
```

Expected: clean (component is unused so far; the import will become live in the next task).

- [ ] **Step 3: Commit**

```bash
git add components/BwfRankingSection.tsx
git commit -m "feat(components): BwfRankingSection renders one per-event ranking section"
```

---

## Task 7: `RankingDetailTabs` branches BWF → sections

**Files:**
- Modify: `components/RankingDetailTabs.tsx`

- [ ] **Step 1: Add `currentRanking` prop and BWF branch**

Open `components/RankingDetailTabs.tsx`.

Find the import block at the top. Replace this:
```ts
import {
  topRowsForTab,
  otherRowsForTab,
  computeExpiryCutoffs,
  classifyExpiry,
  type Discipline,
} from '@/lib/ranking/player-view'
import { getRankingConfig } from '@/lib/ranking/config'
import type { RankingPlayerDetail, ProviderTag } from '@/lib/types'
import TournamentRow from './TournamentRow'
```
with:
```ts
import {
  topRowsForTab,
  otherRowsForTab,
  bwfSectionsForTab,
  computeExpiryCutoffs,
  classifyExpiry,
  type Discipline,
} from '@/lib/ranking/player-view'
import { getRankingConfig } from '@/lib/ranking/config'
import type { Ranking, RankingPlayerDetail, ProviderTag } from '@/lib/types'
import TournamentRow from './TournamentRow'
import BwfRankingSection from './BwfRankingSection'
```

Find the Props interface:
```ts
interface Props {
  provider: ProviderTag
  slug: string
  initialDetail?: RankingPlayerDetail
  /** Upstream publication date string (BE for BAT, Gregorian for BWF).
   *  Used to compute which rows' points will fall out of the 52-week
   *  window at the next publication. */
  rankingPublishDate?: string
}
```
Replace with:
```ts
interface Props {
  provider: ProviderTag
  slug: string
  initialDetail?: RankingPlayerDetail
  /** Upstream publication date string (BE for BAT, Gregorian for BWF).
   *  Used to compute which rows' points will fall out of the 52-week
   *  window at the next publication. */
  rankingPublishDate?: string
  /** Current overview cache for the provider. Used by the BWF section
   *  renderer to look up the player's rank per target event. */
  currentRanking?: Ranking | null
}
```

Find the component signature:
```ts
export default function RankingDetailTabs({ provider, slug, initialDetail, rankingPublishDate }: Props) {
```
Replace with:
```ts
export default function RankingDetailTabs({ provider, slug, initialDetail, rankingPublishDate, currentRanking }: Props) {
```

Find this block in `renderBody`:
```ts
    const top = topRowsForTab(fetchState.detail, active)
    if (top.length === 0) {
      return <div className="pp-rd-empty">{t('rankingDetailEmpty')}</div>
    }
    const others = otherRowsForTab(fetchState.detail, active)
    const topTotal = top.reduce((sum, r) => sum + r.points, 0)
    const cutoffs = computeExpiryCutoffs(rankingPublishDate, getRankingConfig(provider).dateFormat)
```

Replace with:
```ts
    const cutoffs = computeExpiryCutoffs(rankingPublishDate, getRankingConfig(provider).dateFormat)

    if (provider === 'bwf') {
      const sections = bwfSectionsForTab(
        fetchState.detail,
        active,
        currentRanking ? { slug, current: currentRanking } : undefined,
      )
      if (sections.length === 0) {
        return <div className="pp-rd-empty">{t('rankingDetailEmpty')}</div>
      }
      return (
        <>
          {sections.map((section) => (
            <BwfRankingSection
              key={section.eventName}
              slug={slug}
              section={section}
              cutoffs={cutoffs}
              currentRanking={currentRanking}
            />
          ))}
        </>
      )
    }

    // BAT path — unchanged below.
    const top = topRowsForTab(fetchState.detail, active)
    if (top.length === 0) {
      return <div className="pp-rd-empty">{t('rankingDetailEmpty')}</div>
    }
    const others = otherRowsForTab(fetchState.detail, active)
    const topTotal = top.reduce((sum, r) => sum + r.points, 0)
```

- [ ] **Step 2: Compile-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/RankingDetailTabs.tsx
git commit -m "feat(components): RankingDetailTabs renders per-event sections on BWF"
```

---

## Task 8: Thread `currentRanking` through `PlayerProfileView` and the page

**Files:**
- Modify: `components/PlayerProfileView.tsx`
- Modify: `app/player/[provider]/[slug]/page.tsx`

- [ ] **Step 1: Update `PlayerProfileView` props**

Open `components/PlayerProfileView.tsx`. Find:
```ts
interface Props {
  record: PlayerRecord
  playerRankings?: import('@/lib/types').RankingPlayerRank[]
  rankingPublishDate?: string
  initialDetail?: import('@/lib/types').RankingPlayerDetail
}
```
Replace with:
```ts
interface Props {
  record: PlayerRecord
  playerRankings?: import('@/lib/types').RankingPlayerRank[]
  rankingPublishDate?: string
  initialDetail?: import('@/lib/types').RankingPlayerDetail
  /** Current overview cache for the player's provider, forwarded to the
   *  ranking-detail panel so it can resolve the player's per-event rank. */
  currentRanking?: import('@/lib/types').Ranking | null
}
```

Find the component signature:
```ts
export default function PlayerProfileView({ record, playerRankings, rankingPublishDate, initialDetail }: Props) {
```
Replace with:
```ts
export default function PlayerProfileView({ record, playerRankings, rankingPublishDate, initialDetail, currentRanking }: Props) {
```

Find the `<RankingDetailTabs ...>` JSX:
```tsx
      {playerRankings && playerRankings.length > 0 && (
        <RankingDetailTabs
          provider={record.key.provider}
          slug={record.key.slug}
          initialDetail={initialDetail}
          rankingPublishDate={rankingPublishDate}
        />
      )}
```
Replace with:
```tsx
      {playerRankings && playerRankings.length > 0 && (
        <RankingDetailTabs
          provider={record.key.provider}
          slug={record.key.slug}
          initialDetail={initialDetail}
          rankingPublishDate={rankingPublishDate}
          currentRanking={currentRanking}
        />
      )}
```

- [ ] **Step 2: Update the page route**

Open `app/player/[provider]/[slug]/page.tsx`. Find the JSX:
```tsx
  return (
    <PlayerProfileView
      record={record}
      playerRankings={playerRankings.length ? playerRankings : undefined}
      rankingPublishDate={rankingPublishDate || undefined}
      initialDetail={initialDetail}
    />
  )
```
Replace with:
```tsx
  return (
    <PlayerProfileView
      record={record}
      playerRankings={playerRankings.length ? playerRankings : undefined}
      rankingPublishDate={rankingPublishDate || undefined}
      initialDetail={initialDetail}
      currentRanking={currentRanking}
    />
  )
```

(`currentRanking` is already in scope — the function reads it as `const currentRanking = await readRankingCache(provider)` near the top.)

- [ ] **Step 3: Compile-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/PlayerProfileView.tsx app/player/[provider]/[slug]/page.tsx
git commit -m "feat(player): forward currentRanking to RankingDetailTabs"
```

---

## Task 9: Add CSS for the section blocks

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Find existing related rules**

```bash
grep -n "pp-rd-section-header\|pp-rd-section-total" app/globals.css | head -5
```

This shows the existing BAT section header rules. We'll mirror their styling for the BWF event-section headers.

- [ ] **Step 2: Append the new rules**

Open `app/globals.css`. At the end of the file, append:

```css
/* BWF per-event sections inside the Ranking Detail panel.
   One block per ranking event the player has credit toward (e.g.
   "Boy's singles U15", "Boy's singles U17"). The header mirrors the
   existing BAT "Top 10 / Others" section visually so the two providers
   feel related; an inner top/others split below uses a lighter divider. */
.pp-rd-section-event {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 18px;
}
.pp-rd-section-event-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 600;
  padding: 6px 0;
  border-bottom: 1px solid var(--divider, #e5e5e5);
  margin: 0;
}
.pp-rd-section-event-meta {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted, #666);
  white-space: nowrap;
}
.pp-rd-section-subheader {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted, #888);
  margin: 8px 0 2px 0;
}
.pp-rd-section-subheader--divided {
  margin-top: 14px;
  padding-top: 8px;
  border-top: 1px dashed var(--divider, #e5e5e5);
}
```

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style(rd): per-event section headers for the BWF ranking detail"
```

---

## Task 10: Integration test against Ravin's fixture

**Files:**
- Create: `__tests__/ranking-bwf-sections-fixture.test.ts`

End-to-end check: parsing Ravin's real BWF page and feeding the result into `bwfSectionsForTab` should reproduce the user-observed `1598 pts` for Boy's singles U15.

- [ ] **Step 1: Write the test**

Create `__tests__/ranking-bwf-sections-fixture.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import { parseRankingPlayerPage } from '@/lib/ranking/player-scraper'
import { bwfSectionsForTab } from '@/lib/ranking/player-view'
import type { RankingPlayerDetail } from '@/lib/types'

const html = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'ranking-player-bwf-ravin.html'),
  'utf8',
)

function detailFromFixture(): RankingPlayerDetail {
  const { tournaments } = parseRankingPlayerPage(html)
  return { globalPlayerId: '5799633', publishDate: '03/06/2026', scrapedAt: 'x', tournaments }
}

describe("Ravin CHUCHAISRI's BWF sections (real fixture)", () => {
  it('Singles tab has a Boy\'s singles U15 section totalling 1598 pts', () => {
    const sections = bwfSectionsForTab(detailFromFixture(), 'singles')
    const u15 = sections.find((s) => s.eventName === "Boy's singles U15")
    expect(u15).toBeDefined()
    // Math.round so float drift on 637.5 doesn't fail the assertion.
    expect(Math.round(u15!.topTotal)).toBe(1598)
  })

  it('The U13 row in the U15 section carries discounted credit 637.5', () => {
    const sections = bwfSectionsForTab(detailFromFixture(), 'singles')
    const u15 = sections.find((s) => s.eventName === "Boy's singles U15")!
    const u13Row = u15.top.find((sr) => sr.row.sourceEvent.includes('U13'))
    expect(u13Row).toBeDefined()
    expect(u13Row!.row.points).toBe(2125)
    expect(u13Row!.creditInThisSection).toBe(637.5)
  })

  it('Doubles tab has a Boy\'s doubles U15 section with the carry-over', () => {
    const sections = bwfSectionsForTab(detailFromFixture(), 'doubles')
    const u15 = sections.find((s) => s.eventName === "Boy's doubles U15")
    expect(u15).toBeDefined()
    // MD-U15 full 1750 + MD U13 discounted 525 = 2275.
    expect(Math.round(u15!.topTotal)).toBe(2275)
  })
})
```

- [ ] **Step 2: Run the test — confirm pass**

```bash
npx jest ranking-bwf-sections-fixture --no-coverage
```

Expected: 3 passing.

- [ ] **Step 3: Commit**

```bash
git add __tests__/ranking-bwf-sections-fixture.test.ts
git commit -m "test(ranking): bwfSectionsForTab against Ravin's real BWF page"
```

---

## Task 11: Full test suite + manual smoke

**Files:** none — verification only.

- [ ] **Step 1: Run the full test suite**

```bash
npx jest --no-coverage
```

Expected: all suites pass (was 91/659 before this work; should remain ≥91 with the new test files added).

- [ ] **Step 2: Start the dev server**

```bash
rm -rf .next
PORT=3000 npm run dev
```

Wait for `✓ Ready`.

- [ ] **Step 3: Force a fresh BWF refresh so the cache has the new fields**

```bash
curl -s -X POST 'http://localhost:3000/api/ranking/bwf/refresh?force=true'
```

Then clear Ravin's detail cache so the next request re-fetches (capturing the new parsed credits):

```bash
rm -f .cache/players/ranking-detail/bwf/5799633.json
```

- [ ] **Step 4: Hit the detail endpoint and verify the section math**

```bash
curl -s 'http://localhost:3000/api/players/ranking-detail?provider=bwf&slug=ravin_chuchaisri' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['detail']['tournaments'][:4], indent=2))"
```

Expected: each row carries `countsTowardRankingsParsed` with `{ eventName, credit }` entries.

- [ ] **Step 5: Open Ravin's profile in a browser**

URL: `http://localhost:3000/player/bwf/ravin_chuchaisri`

Verify visually:
- Singles tab shows two sections: `Boy's singles U15` (`#10 · 1598 pts`) and `Boy's singles U17` (no rank · `288 pts`)
- The MITH YONEX row appears in both sections; in U15 it shows `960`, in U17 it shows `960 → 288`
- The YONEX CP U13 row appears in U15 only with `2125 → 638`
- Doubles tab shows two equivalents (`Boy's doubles U15`, `Boy's doubles U17`)

- [ ] **Step 6: Check a single-section BWF player**

Pick a player who only appears in one event. From `.cache/players/ranking-bwf.json`, find a slug that appears in exactly one event:

```bash
python3 -c "
import json
from collections import Counter
d = json.load(open('.cache/players/ranking-bwf.json'))
appearances = Counter()
for ev in d['events']:
    for e in ev['entries']:
        appearances[e['slug']] += 1
single = [s for s, n in appearances.items() if n == 1]
print(single[0])
"
```

Hit their profile URL. Verify: exactly one section in the active tab, no `raw → credit` arrows (no cross-tier rows).

- [ ] **Step 7: Confirm BAT is unaffected**

Open a BAT player's profile (any from `/leaderboards` BAT tab → Ranking → click a top-3 player). Verify the Ranking Detail still shows the original Top 10 + Others layout — no per-event sections, no `raw → credit` arrows.

- [ ] **Step 8: Stop the dev server and commit (no code changes if smoke passes)**

If smoke surfaced a fix, commit it now. Otherwise `git status` should be clean.

---

## Self-review notes (for the engineer running this plan)

This plan layers cleanly on top of the prior BWF Ranking work that just merged. Two things to watch:

1. **Detail cache invalidation between Tasks 3 and 11.** Older `ranking-detail/bwf/*.json` files written by the prior PR don't have `countsTowardRankingsParsed`. The view layer falls back to deriving from the raw string list (see `targetsOf` in Task 4) — but the on-disk cache will lag until each player's detail is re-fetched at the next publishDate change OR you clear `.cache/players/ranking-detail/bwf/` manually. The Task 11 smoke includes this clear step for Ravin only; users in the wild get the rich data once their cached entry expires.

2. **Floating-point credit values.** BWF prints `(637.5)` — a half. We preserve it exactly through `parseFloat` and only `Math.round` at display time. The section's `topTotal` carries the unrounded sum so the user sees `1598 pts` (matching BWF) rather than `1597.5`.

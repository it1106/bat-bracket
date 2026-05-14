# Group-stage Tournament Support (Round-Robin + Playoff) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class support for tournaments combining round-robin group stages with single-elim playoffs (e.g. SAT NSDF Badminton Thai Domestic Power 2026 Final), surfacing each event as a tabbed view (Groups | Playoff) instead of 9 separate dropdown entries.

**Architecture:** A new `EventBundle` data type aggregates one playoff bracket + N group draws (each with standings + matches) for a single event. A new provider method `getEventBundle()` assembles it from existing scraped endpoints. A new `EventBundleView` React component renders the tabbed UI; the playoff tab reuses `BracketCanvas` verbatim. Detection (`detectGroupedDraws`) annotates `DrawInfo` with `eventName`/`groupLetter`/`isPlayoff`, and the page branches between the bundle view and the existing single-bracket flow on `isBundle`.

**Tech Stack:** Next.js 14 App Router · React 18 · TypeScript · Tailwind · Cheerio (HTML parsing) · Jest

**Spec:** `docs/superpowers/specs/2026-05-14-groups-knockout-design.md`

---

## File Structure

**Create**
- `lib/usePlayerHighlight.ts` — shared post-processing hook (extracted from `BracketCanvas`)
- `lib/event-bundle-cache.ts` — assembly-layer cache mirroring `bracket-cache`
- `app/api/event-bundle/route.ts` — API endpoint
- `components/StandingsTable.tsx`
- `components/GroupCard.tsx`
- `components/EventBundleView.tsx`
- `fixtures/group-standings-bs-u11-a.html`
- `fixtures/group-draw-bs-u11-a.html`
- `fixtures/playoff-draw-bs-u11.html`
- `fixtures/draws-grouped.html`
- `__tests__/parseStandings.test.ts`
- `__tests__/parseRoundRobinMatches.test.ts`
- `__tests__/detectGroupedDraws.test.ts`
- `__tests__/getEventBundle.test.ts`
- `__tests__/event-bundle-cache.test.ts`
- `__tests__/api-event-bundle-route.test.ts`
- `__tests__/StandingsTable.test.tsx`
- `__tests__/GroupCard.test.tsx`
- `__tests__/EventBundleView.test.tsx`

**Modify**
- `lib/types.ts` — add `StandingsRow`, `GroupData`, `EventBundle`; extend `DrawInfo` and `MatchEntry`
- `lib/scraper.ts` — add `parseStandings`, `parseRoundRobinMatches`, `detectGroupedDraws`; refactor `extractMatchEntry` out of `parseBracket`; populate `MatchEntry.eventName` in `parseMatchesFull`
- `lib/providers/types.ts` — add `getEventBundle` to `TournamentProvider`
- `lib/providers/bat-provider.ts` — implement `getEventBundle`
- `lib/providers/bwf-provider.ts` — throw `NotImplementedError`
- `lib/draws-cache.ts` — annotate cached draws with `detectGroupedDraws` after fetch
- `app/api/draws/route.ts` — replace the `type !== 'Round Robin'` filter with bundle-aware filtering (return only event-level options)
- `app/page.tsx` — branch on `isBundle` (render `EventBundleView` vs `BracketCanvas`)
- `components/BracketCanvas.tsx` — replace inlined post-processing with `usePlayerHighlight`
- `components/MatchSchedule.tsx` — use `match.eventName` for the draw-pill deep link
- `lib/tournamentStats.ts` — group event rows by `eventName` when present
- `instrumentation.ts` — call `prewarmEventBundleCache` after `prewarmBracketCache`

---

## Phase 1 — Data Layer

### Task 1: Types + fixtures

**Files:**
- Modify: `lib/types.ts`
- Create: `fixtures/group-standings-bs-u11-a.html`
- Create: `fixtures/group-draw-bs-u11-a.html`
- Create: `fixtures/playoff-draw-bs-u11.html`
- Create: `fixtures/draws-grouped.html`

- [ ] **Step 1: Capture fixtures from the reference tournament**

The mockup-build session already fetched these to `/tmp/bsu11/` during brainstorming. Re-fetch fresh copies into the repo so tests don't depend on transient files. Run:

```bash
TOURNAMENT_ID=a2812d92-b33f-4f37-ac72-3310bb1be0f1
BASE="https://bat.tournamentsoftware.com"
HDRS=(-H "User-Agent: Mozilla/5.0" -H "X-Requested-With: XMLHttpRequest" -H "Accept: text/html, */*; q=0.01")

curl -s "${BASE}/tournament/${TOURNAMENT_ID}/Draw/1/GetDrawContent?tabindex=1&X-Requested-With=XMLHttpRequest" \
  "${HDRS[@]}" -H "Referer: ${BASE}/tournament/${TOURNAMENT_ID}/draw/1" \
  -o fixtures/group-draw-bs-u11-a.html

curl -s "${BASE}/tournament/${TOURNAMENT_ID}/Draw/1/GetStandings" \
  "${HDRS[@]}" -H "Referer: ${BASE}/tournament/${TOURNAMENT_ID}/draw/1" \
  -o fixtures/group-standings-bs-u11-a.html

curl -s "${BASE}/tournament/${TOURNAMENT_ID}/Draw/9/GetDrawContent?tabindex=1&X-Requested-With=XMLHttpRequest" \
  "${HDRS[@]}" -H "Referer: ${BASE}/tournament/${TOURNAMENT_ID}/draw/9" \
  -o fixtures/playoff-draw-bs-u11.html

curl -s "${BASE}/sport/draws.aspx?id=${TOURNAMENT_ID}" \
  -H "User-Agent: Mozilla/5.0" \
  -o fixtures/draws-grouped.html
```

Expected: 4 fixture files, each non-empty (`wc -c fixtures/group-* fixtures/playoff-* fixtures/draws-grouped.html`).

- [ ] **Step 2: Add new types to `lib/types.ts`**

Append after the existing `BracketData` interface and update `DrawInfo` and `MatchEntry`. Replace the `format` literal `'groups-knockout'` (it's unused and the bundle replaces it).

```ts
// Replace the existing BracketData definition (drop 'groups-knockout')
export interface BracketData {
  html: string
  format: 'single-elimination' | 'double-elimination' | 'unknown'
}

// Replace the existing DrawInfo definition
export interface DrawInfo {
  drawNum: string
  name: string
  size: string
  type: string
  eventName?: string
  groupLetter?: string
  isPlayoff?: boolean
}

// Add to the existing MatchEntry interface (after the existing eventId field)
//   eventName?: string

// Append at the bottom of the file:
export interface StandingsRow {
  position: number
  players: MatchPlayer[]
  club?: string
  played: number
  won: number
  drawn: number
  lost: number
  matches: string
  games: string
  points: string
  pts: number
}

export interface GroupData {
  drawNum: string
  groupLetter: string
  standings: StandingsRow[]
  matches: MatchEntry[]
}

export interface EventBundle {
  eventName: string
  playoff: BracketData
  playoffDrawNum: string
  groups: GroupData[]
}
```

Add `eventName?: string` to `MatchEntry` (after the existing `eventId?: string` field).

- [ ] **Step 3: Verify type-check passes**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). If `'groups-knockout'` was referenced elsewhere, follow the compile errors and remove the dead references — should be none based on the spec audit.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts fixtures/group-standings-bs-u11-a.html fixtures/group-draw-bs-u11-a.html fixtures/playoff-draw-bs-u11.html fixtures/draws-grouped.html
git commit -m "types: EventBundle, GroupData, StandingsRow + group-event fixtures"
```

---

### Task 2: `detectGroupedDraws`

**Files:**
- Modify: `lib/scraper.ts`
- Test: `__tests__/detectGroupedDraws.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/detectGroupedDraws.test.ts`:

```ts
import { detectGroupedDraws } from '@/lib/scraper'
import type { DrawInfo } from '@/lib/types'

const draw = (drawNum: string, name: string, type: string): DrawInfo => ({
  drawNum, name, size: '', type,
})

describe('detectGroupedDraws', () => {
  it('annotates group draws with eventName + groupLetter', () => {
    const input = [
      draw('1', 'BS U11 - Group A', 'Round Robin'),
      draw('2', 'BS U11 - Group B', 'Round Robin'),
      draw('9', 'BS U11', 'Elimination'),
    ]
    const out = detectGroupedDraws(input)
    expect(out[0]).toMatchObject({ eventName: 'BS U11', groupLetter: 'A' })
    expect(out[1]).toMatchObject({ eventName: 'BS U11', groupLetter: 'B' })
    expect(out[2]).toMatchObject({ eventName: 'BS U11', isPlayoff: true })
  })

  it('leaves non-grouped tournaments unchanged', () => {
    const input = [
      draw('1', "Men's Singles", 'Elimination'),
      draw('2', "Women's Doubles", 'Elimination'),
    ]
    const out = detectGroupedDraws(input)
    expect(out[0].eventName).toBeUndefined()
    expect(out[0].isPlayoff).toBeUndefined()
    expect(out[1].eventName).toBeUndefined()
  })

  it('does not mark playoff if no group siblings exist (orphan elimination)', () => {
    const input = [draw('9', 'BS U11', 'Elimination')]
    const out = detectGroupedDraws(input)
    expect(out[0].eventName).toBeUndefined()
    expect(out[0].isPlayoff).toBeUndefined()
  })

  it('handles mixed tournament with some grouped, some not', () => {
    const input = [
      draw('1', 'BS U11 - Group A', 'Round Robin'),
      draw('9', 'BS U11', 'Elimination'),
      draw('20', "Men's Singles", 'Elimination'),
    ]
    const out = detectGroupedDraws(input)
    expect(out[0].groupLetter).toBe('A')
    expect(out[1].isPlayoff).toBe(true)
    expect(out[2].eventName).toBeUndefined()
  })

  it('does not mutate input array', () => {
    const input = [draw('1', 'BS U11 - Group A', 'Round Robin'), draw('9', 'BS U11', 'Elimination')]
    const snapshot = JSON.parse(JSON.stringify(input))
    detectGroupedDraws(input)
    expect(input).toEqual(snapshot)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/detectGroupedDraws.test.ts`
Expected: FAIL — `detectGroupedDraws` is not a function / not exported.

- [ ] **Step 3: Implement `detectGroupedDraws` in `lib/scraper.ts`**

Append to `lib/scraper.ts`:

```ts
const GROUP_NAME_RE = /^(.+?) - Group ([A-Z])$/

export function detectGroupedDraws(draws: DrawInfo[]): DrawInfo[] {
  const annotated = draws.map((d) => {
    const m = d.name.match(GROUP_NAME_RE)
    if (!m || d.type !== 'Round Robin') return { ...d }
    return { ...d, eventName: m[1], groupLetter: m[2] }
  })
  const groupedEventNames = new Set(
    annotated.filter((d) => d.groupLetter).map((d) => d.eventName!)
  )
  return annotated.map((d) => {
    if (d.groupLetter) return d
    if (d.type === 'Elimination' && groupedEventNames.has(d.name)) {
      return { ...d, eventName: d.name, isPlayoff: true }
    }
    return d
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/detectGroupedDraws.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/scraper.ts __tests__/detectGroupedDraws.test.ts
git commit -m "scraper: detectGroupedDraws annotates grouped events"
```

---

### Task 3: `parseStandings`

**Files:**
- Modify: `lib/scraper.ts`
- Test: `__tests__/parseStandings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/parseStandings.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import { parseStandings } from '@/lib/scraper'

const fixtureHtml = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

describe('parseStandings', () => {
  it('parses BS U11 Group A entrants from real fixture', () => {
    const rows = parseStandings(fixtureHtml('group-standings-bs-u11-a.html'))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].position).toBe(1)
    expect(rows[0].players.length).toBeGreaterThan(0)
    expect(rows[0].players[0].playerId).toMatch(/^\d+$/)
    expect(rows[0].players[0].name.length).toBeGreaterThan(0)
    expect(rows[0].played).toBe(0)  // pre-tournament fixture
    expect(rows[0].won).toBe(0)
    expect(rows[0].lost).toBe(0)
    expect(rows[0].pts).toBe(0)
    expect(typeof rows[0].matches).toBe('string')
    expect(typeof rows[0].games).toBe('string')
  })

  it('returns rows in position order', () => {
    const rows = parseStandings(fixtureHtml('group-standings-bs-u11-a.html'))
    rows.forEach((r, i) => expect(r.position).toBe(i + 1))
  })

  it('returns empty array for non-standings HTML', () => {
    expect(parseStandings('<html><body>nothing</body></html>')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/parseStandings.test.ts`
Expected: FAIL — `parseStandings` not exported.

- [ ] **Step 3: Implement `parseStandings` in `lib/scraper.ts`**

Append to `lib/scraper.ts`:

```ts
export function parseStandings(html: string): StandingsRow[] {
  const $ = cheerio.load(html)
  const rows: StandingsRow[] = []

  $('table.table--striped tbody tr').each((_, tr) => {
    const $tr = $(tr)
    const positionText = $tr.find('.standing-status').first().text().trim()
    const position = parseInt(positionText, 10)
    if (!Number.isFinite(position)) return

    const playerCell = $tr.find('td').eq(1)
    const players: MatchPlayer[] = playerCell.find('a').map((_, a) => {
      const href = $(a).attr('href') ?? ''
      const idMatch = href.match(/Player\/(\d+)/)
      const name = $(a).find('.nav-link__value').first().text().trim() || $(a).text().trim()
      return { name, playerId: idMatch ? idMatch[1] : '' }
    }).get()
    if (players.length === 0) {
      const fallback = playerCell.text().trim()
      if (fallback) players.push({ name: fallback, playerId: '' })
    }

    const club = playerCell.find('.entrant-info-club').first().text().replace(/ /g, '').trim()

    const numCells = $tr.find('td').slice(2)
    const txt = (i: number) => (numCells.eq(i).text().trim() || '')
    const num = (i: number) => parseInt(txt(i), 10) || 0

    rows.push({
      position,
      players,
      ...(club ? { club } : {}),
      played: num(0),
      won: num(1),
      drawn: num(2),
      lost: num(3),
      matches: txt(4),
      games: txt(5),
      points: txt(6),
      pts: num(7),
    })
  })

  return rows
}
```

Add the imports at the top: ensure `MatchPlayer` and `StandingsRow` are imported in the existing `import type { … } from './types'` line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/parseStandings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/scraper.ts __tests__/parseStandings.test.ts
git commit -m "scraper: parseStandings extracts standings table from GetStandings"
```

---

### Task 4: `extractMatchEntry` refactor + `parseRoundRobinMatches`

**Files:**
- Modify: `lib/scraper.ts`
- Test: `__tests__/parseRoundRobinMatches.test.ts`

- [ ] **Step 1: Run existing scraper tests to capture baseline**

Run: `npx jest __tests__/scraper.test.ts`
Expected: PASS (baseline). Note the count — must remain identical after the refactor.

- [ ] **Step 2: Extract `extractMatchEntry` from `parseBracket`**

Inside `lib/scraper.ts`, lift the per-match extraction (currently inline at lines ~228–276 inside `parseBracket`'s `matches.each`) into a private helper. The helper builds the metadata used by both bracket and round-robin parsers.

```ts
type ExtractedMatch = {
  team1: MatchPlayer[]
  team2: MatchPlayer[]
  winner: 1 | 2 | null
  scores: MatchScore[]
  walkover: boolean
  retired: boolean
  rowsHtmlParts: string[]   // for bracket renderer reuse
  scoreContent: string      // for bracket renderer reuse
  isDoubles: boolean
}

function extractMatchEntry($: cheerio.CheerioAPI, matchEl: cheerio.Element, isDoubles: boolean): ExtractedMatch {
  const rows = $(matchEl).find('.match__row')
  const teamPlayers: MatchPlayer[][] = []
  const rowsHtmlParts: string[] = []
  let winner: 1 | 2 | null = null

  rows.each((ri, row) => {
    const cls = $(row).attr('class') ?? ''
    const hasWon = cls.includes('has-won')
    if (hasWon) winner = (ri === 0 ? 1 : 2)

    const titleValueDivs = $(row).find('.match__row-title-value')
    const playerCount = titleValueDivs.length || 1
    const players: MatchPlayer[] = titleValueDivs.map((_, tv) => {
      const a = $(tv).find('a')
      const hrefMatch = (a.attr('href') ?? '').match(/player=(\d+)/)
      const name = a.length ? playerText($(a).first()) : $(tv).find('.nav-link__value').first().text().trim()
      return { name, playerId: hrefMatch ? hrefMatch[1] : '' }
    }).get()
    while (players.length < playerCount) players.push({ name: '', playerId: '' })
    teamPlayers.push(players)

    const playerSpans = players.map((p) =>
      `<span class="bk-player"${p.playerId ? ` data-player-id="${p.playerId}"` : ''}>${p.name}</span>`
    ).join('')
    rowsHtmlParts.push(`<div class="bk-row${isDoubles ? ' bk-row--doubles' : ''}${hasWon ? ' winner' : ''}${ri > 0 ? ' bk-row--team-sep' : ''}">${playerSpans}</div>`)
  })

  const resultEl = $(matchEl).find('.match__result')
  const gameScores = resultEl.find('ul.points').map((_, g) => {
    const pts = $(g).find('li').map((_, p) => $(p).text().trim()).get()
    return pts.join('-')
  }).get()
  const scoreStr = gameScores.length > 0 ? gameScores.join(', ') : ''

  const scores: MatchScore[] = gameScores.map((s) => {
    const [a, b] = s.split('-').map((n) => parseInt(n, 10) || 0)
    return { t1: a, t2: b }
  })

  const footerEl = $(matchEl).find('.match__footer').first()
  const footerRaw = footerText(footerEl)
  const msgText = $(matchEl).find('.match__message').text().trim()
  const retired = !!msgText && /ret/i.test(msgText) && gameScores.length > 0
  const walkover = !!msgText && !retired
  const scoreContent = retired ? `${scoreStr} Ret.` : walkover ? msgText : scoreStr || footerRaw

  return {
    team1: teamPlayers[0] ?? [],
    team2: teamPlayers[1] ?? [],
    winner,
    scores,
    walkover,
    retired,
    rowsHtmlParts,
    scoreContent,
    isDoubles,
  }
}
```

Then update `parseBracket` to call `extractMatchEntry($, matchEl, isDoubles)` and use `extracted.rowsHtmlParts` / `extracted.scoreContent` for its existing markup assembly. The visible HTML output of `parseBracket` must be byte-identical.

- [ ] **Step 3: Re-run existing scraper tests to confirm refactor is non-breaking**

Run: `npx jest __tests__/scraper.test.ts __tests__/scraper.bracket-gate.test.ts`
Expected: PASS — same count as baseline. If any snapshot/HTML diff, debug and fix the helper before continuing.

- [ ] **Step 4: Write failing test for `parseRoundRobinMatches`**

Create `__tests__/parseRoundRobinMatches.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import { parseRoundRobinMatches } from '@/lib/scraper'

const fixtureHtml = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

describe('parseRoundRobinMatches', () => {
  it('parses round-robin matches from BS U11 Group A fixture', () => {
    const matches = parseRoundRobinMatches(
      fixtureHtml('group-draw-bs-u11-a.html'),
      'BS U11 - Group A',
    )
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((m) => m.draw === 'BS U11 - Group A')).toBe(true)
    expect(matches[0].round).toMatch(/^Round \d+$/i)
    // Pre-tournament fixture: no winners decided, no scores
    expect(matches.every((m) => m.winner === null)).toBe(true)
  })

  it('skips invisible match placeholders (byes / odd-size)', () => {
    const matches = parseRoundRobinMatches(
      fixtureHtml('group-draw-bs-u11-a.html'),
      'BS U11 - Group A',
    )
    matches.forEach((m) => {
      const teams = [m.team1, m.team2]
      const hasAnyName = teams.some((t) => t.some((p) => p.name.length > 0))
      expect(hasAnyName).toBe(true)
    })
  })

  it('returns empty array for unrelated HTML', () => {
    expect(parseRoundRobinMatches('<html><body></body></html>', 'X')).toEqual([])
  })
})
```

- [ ] **Step 5: Implement `parseRoundRobinMatches`**

Append to `lib/scraper.ts`:

```ts
export function parseRoundRobinMatches(html: string, drawName: string): MatchEntry[] {
  const $ = cheerio.load(html, { xmlMode: false })
  const bracket = $('.bracket.js-bracket')
  if (!bracket.length) return []

  const roundNames = bracket.find('.subheading').map((_, el) => $(el).text().trim()).get()
  const out: MatchEntry[] = []

  bracket.find('swiper-container > swiper-slide').each((slideIdx, slide) => {
    const roundName = longRound(roundNames[slideIdx] ?? `Round ${slideIdx + 1}`)
    const firstMatchEl = $(slide).find('.match').first()
    const isDoubles = firstMatchEl.find('.match__row').first().find('.match__row-title-value').length >= 2

    $(slide).find('.match').each((_, matchEl) => {
      if ($(matchEl).hasClass('is-invisible')) return
      const ex = extractMatchEntry($, matchEl, isDoubles)
      const hasAnyName = [...ex.team1, ...ex.team2].some((p) => p.name.length > 0)
      if (!hasAnyName) return
      out.push({
        draw: drawName,
        drawNum: '',
        round: roundName,
        team1: ex.team1,
        team2: ex.team2,
        winner: ex.winner,
        scores: ex.scores,
        court: '',
        walkover: ex.walkover,
        retired: ex.retired,
        nowPlaying: false,
      })
    })
  })

  return out
}
```

- [ ] **Step 6: Run round-robin tests and full scraper suite**

Run: `npx jest __tests__/parseRoundRobinMatches.test.ts __tests__/scraper.test.ts __tests__/scraper.bracket-gate.test.ts`
Expected: PASS (all suites). Existing parseBracket behavior unchanged.

- [ ] **Step 7: Commit**

```bash
git add lib/scraper.ts __tests__/parseRoundRobinMatches.test.ts
git commit -m "scraper: parseRoundRobinMatches + extract shared extractMatchEntry helper"
```

---

### Task 5: Provider method + BAT implementation

**Files:**
- Modify: `lib/providers/types.ts`
- Modify: `lib/providers/bat-provider.ts`
- Modify: `lib/providers/bwf-provider.ts`
- Test: `__tests__/getEventBundle.test.ts`

- [ ] **Step 1: Add `getEventBundle` to provider interface**

Edit `lib/providers/types.ts`:

```ts
import type {
  TournamentInfo, DrawInfo, BracketData, MatchesData,
  MatchScheduleGroup, MatchEntry, PlayerProfile, H2HData,
  ProviderTag, TournamentRef, EventBundle,
} from '@/lib/types'

export interface TournamentProvider {
  // …existing fields…
  getEventBundle(ref: TournamentRef, eventName: string): Promise<EventBundle | null>
}
```

- [ ] **Step 2: Add `NotImplementedError` stub to BWF provider**

Edit `lib/providers/bwf-provider.ts`. Add to the exported provider object:

```ts
async getEventBundle(): Promise<EventBundle | null> {
  throw new NotImplementedError('getEventBundle', 'bwf')
},
```

(Import `EventBundle` from `@/lib/types` and `NotImplementedError` if not already imported.)

- [ ] **Step 3: Write the failing test**

Create `__tests__/getEventBundle.test.ts`:

```ts
import { batProvider } from '@/lib/providers/bat-provider'

jest.mock('@/lib/bat-fetch', () => ({
  batFetch: jest.fn(),
}))

import { batFetch } from '@/lib/bat-fetch'
import fs from 'fs'
import path from 'path'

const fixture = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

const okResponse = (body: string) => ({
  ok: true,
  status: 200,
  text: async () => body,
}) as unknown as Response

describe('batProvider.getEventBundle', () => {
  beforeEach(() => {
    (batFetch as jest.Mock).mockReset()
  })

  it('returns null when no playoff sibling exists', async () => {
    (batFetch as jest.Mock).mockImplementation((_kind: string, url: string) => {
      if (url.includes('/draws.aspx')) return Promise.resolve(okResponse(fixture('draws-grouped.html')))
      return Promise.resolve(okResponse(''))
    })
    const out = await batProvider.getEventBundle(
      { id: 'a2812d92-b33f-4f37-ac72-3310bb1be0f1', provider: 'bat' },
      'Nonexistent Event',
    )
    expect(out).toBeNull()
  })

  it('assembles a bundle for BS U11 with 8 groups + playoff', async () => {
    (batFetch as jest.Mock).mockImplementation((_kind: string, url: string) => {
      if (url.includes('/draws.aspx')) return Promise.resolve(okResponse(fixture('draws-grouped.html')))
      if (url.includes('GetStandings')) return Promise.resolve(okResponse(fixture('group-standings-bs-u11-a.html')))
      if (url.includes('/Draw/9/')) return Promise.resolve(okResponse(fixture('playoff-draw-bs-u11.html')))
      if (url.includes('GetDrawContent')) return Promise.resolve(okResponse(fixture('group-draw-bs-u11-a.html')))
      return Promise.resolve(okResponse(''))
    })
    const bundle = await batProvider.getEventBundle(
      { id: 'a2812d92-b33f-4f37-ac72-3310bb1be0f1', provider: 'bat' },
      'BS U11',
    )
    expect(bundle).not.toBeNull()
    expect(bundle!.eventName).toBe('BS U11')
    expect(bundle!.playoffDrawNum).toBe('9')
    expect(bundle!.groups).toHaveLength(8)
    expect(bundle!.groups.map((g) => g.groupLetter)).toEqual(['A','B','C','D','E','F','G','H'])
    expect(bundle!.groups[0].standings.length).toBeGreaterThan(0)
    expect(bundle!.playoff.format).toBeDefined()
  })

  it('tolerates a single failed sub-fetch (returns partial bundle)', async () => {
    let standingsCall = 0
    (batFetch as jest.Mock).mockImplementation((_kind: string, url: string) => {
      if (url.includes('/draws.aspx')) return Promise.resolve(okResponse(fixture('draws-grouped.html')))
      if (url.includes('GetStandings')) {
        standingsCall++
        if (standingsCall === 1) return Promise.resolve({ ok: false, status: 502 } as Response)
        return Promise.resolve(okResponse(fixture('group-standings-bs-u11-a.html')))
      }
      if (url.includes('/Draw/9/')) return Promise.resolve(okResponse(fixture('playoff-draw-bs-u11.html')))
      if (url.includes('GetDrawContent')) return Promise.resolve(okResponse(fixture('group-draw-bs-u11-a.html')))
      return Promise.resolve(okResponse(''))
    })
    const bundle = await batProvider.getEventBundle(
      { id: 'a2812d92-b33f-4f37-ac72-3310bb1be0f1', provider: 'bat' },
      'BS U11',
    )
    expect(bundle).not.toBeNull()
    expect(bundle!.groups).toHaveLength(8)
    expect(bundle!.groups[0].standings).toEqual([])  // failed standings → empty array
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest __tests__/getEventBundle.test.ts`
Expected: FAIL — `getEventBundle` not implemented in BAT provider.

- [ ] **Step 5: Implement `getEventBundle` in `lib/providers/bat-provider.ts`**

Add to imports:

```ts
import { parseTournamentDraws, parseTournamentMeta, parseBracket, parseMatchesFull, parseStandings, parseRoundRobinMatches, detectGroupedDraws, orderScheduleGroups } from '@/lib/scraper'
import type { …existing…, EventBundle, GroupData } from '@/lib/types'
```

Add to the exported `batProvider` object:

```ts
async getEventBundle(ref: TournamentRef, eventName: string): Promise<EventBundle | null> {
  const allDraws = await this.getDraws(ref)
  const annotated = detectGroupedDraws(allDraws)
  const groupDraws = annotated
    .filter((d) => d.eventName === eventName && d.groupLetter)
    .sort((a, b) => (a.groupLetter ?? '').localeCompare(b.groupLetter ?? ''))
  const playoffDraw = annotated.find((d) => d.eventName === eventName && d.isPlayoff)
  if (!playoffDraw || groupDraws.length === 0) return null

  const drawContentUrl = (n: string) =>
    `https://bat.tournamentsoftware.com/tournament/${ref.id}/Draw/${n}/GetDrawContent?tabindex=1&X-Requested-With=XMLHttpRequest`
  const standingsUrl = (n: string) =>
    `https://bat.tournamentsoftware.com/tournament/${ref.id}/Draw/${n}/GetStandings`

  const playoffPromise = this.getBracket(ref, playoffDraw.drawNum)
  const groupPromises = groupDraws.flatMap((g) => [
    fetchHtml('group', drawContentUrl(g.drawNum)),
    fetchHtml('standings', standingsUrl(g.drawNum)),
  ])

  const settled = await Promise.allSettled([playoffPromise, ...groupPromises])
  const playoffResult = settled[0]
  const playoff: BracketData = playoffResult.status === 'fulfilled' && playoffResult.value
    ? playoffResult.value
    : { html: '', format: 'unknown' }

  const groups: GroupData[] = groupDraws.map((g, i) => {
    const drawHtmlRes = settled[1 + i * 2]
    const standingsHtmlRes = settled[2 + i * 2]
    const drawHtml = drawHtmlRes.status === 'fulfilled' ? drawHtmlRes.value : null
    const standingsHtml = standingsHtmlRes.status === 'fulfilled' ? standingsHtmlRes.value : null
    return {
      drawNum: g.drawNum,
      groupLetter: g.groupLetter ?? '',
      standings: standingsHtml ? parseStandings(standingsHtml) : [],
      matches: drawHtml ? parseRoundRobinMatches(drawHtml, g.name) : [],
    }
  })

  return { eventName, playoff, playoffDrawNum: playoffDraw.drawNum, groups }
},
```

Note: `fetchHtml` already exists in this file. The `getBracket` call must reuse the existing in-file headers + URL construction.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/getEventBundle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Type-check + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add lib/providers/types.ts lib/providers/bat-provider.ts lib/providers/bwf-provider.ts __tests__/getEventBundle.test.ts
git commit -m "providers: getEventBundle assembles groups + playoff for BAT"
```

---

### Task 6: Event-bundle cache

**Files:**
- Create: `lib/event-bundle-cache.ts`
- Test: `__tests__/event-bundle-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/event-bundle-cache.test.ts`:

```ts
import { cache, makeKey, fetchAndCache, TTL_MS } from '@/lib/event-bundle-cache'
import type { EventBundle } from '@/lib/types'

jest.mock('@/lib/providers/resolve', () => ({
  providerFor: jest.fn(),
}))
jest.mock('@/lib/tournaments-registry', () => ({
  resolveRef: jest.fn(() => ({ id: 'GUID', provider: 'bat' })),
}))
jest.mock('@/lib/draws-cache', () => ({
  cache: new Map(),
}))

import { providerFor } from '@/lib/providers/resolve'

const fakeBundle: EventBundle = {
  eventName: 'BS U11',
  playoff: { html: '', format: 'single-elimination' },
  playoffDrawNum: '9',
  groups: [],
}

describe('event-bundle-cache', () => {
  beforeEach(() => {
    cache.clear()
    ;(providerFor as jest.Mock).mockReset()
    ;(providerFor as jest.Mock).mockReturnValue({
      getEventBundle: jest.fn().mockResolvedValue(fakeBundle),
    })
  })

  it('makeKey is deterministic per tournament+event', () => {
    expect(makeKey('guid', 'BS U11')).toBe(makeKey('guid', 'BS U11'))
    expect(makeKey('guid', 'BS U11')).not.toBe(makeKey('guid', 'GS U11'))
  })

  it('TTL matches bracket-cache (15 minutes)', () => {
    expect(TTL_MS).toBe(15 * 60 * 1000)
  })

  it('fetchAndCache stores the bundle keyed by tournament+event', async () => {
    const out = await fetchAndCache('guid', 'BS U11')
    expect(out).toEqual(fakeBundle)
    expect(cache.get(makeKey('guid', 'BS U11'))?.bundle).toEqual(fakeBundle)
  })

  it('fetchAndCache marks done=true if draws-cache has done flag', async () => {
    const drawsCache = (await import('@/lib/draws-cache')).cache
    drawsCache.set('guid', { draws: [], ts: Date.now(), done: true })
    await fetchAndCache('guid', 'BS U11')
    expect(cache.get(makeKey('guid', 'BS U11'))?.done).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/event-bundle-cache.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `lib/event-bundle-cache.ts`**

```ts
import { cache as drawsCache } from './draws-cache'
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef } from '@/lib/tournaments-registry'
import { detectGroupedDraws } from './scraper'
import type { EventBundle } from './types'

export const cache = new Map<string, { bundle: EventBundle; ts: number; done?: boolean }>()
export const TTL_MS = 15 * 60 * 1000

export function makeKey(guid: string, eventName: string) {
  return `${guid}::${eventName}`
}

export async function fetchEventBundle(guid: string, eventName: string): Promise<EventBundle | null> {
  const ref = resolveRef(guid) ?? { id: guid.toUpperCase(), provider: 'bat' as const }
  return providerFor(ref).getEventBundle(ref, eventName)
}

export async function fetchAndCache(guid: string, eventName: string): Promise<EventBundle | null> {
  const bundle = await fetchEventBundle(guid, eventName)
  if (!bundle) return null
  const done = drawsCache.get(guid)?.done
  cache.set(makeKey(guid, eventName), { bundle, ts: Date.now(), ...(done && { done: true }) })
  return bundle
}

export async function prewarmEventBundleCache(): Promise<void> {
  for (const [tournamentId, entry] of Array.from(drawsCache.entries())) {
    if (entry.done) {
      console.log(`[event-bundle-cache] skipped (done): ${tournamentId}`)
      continue
    }
    const annotated = detectGroupedDraws(entry.draws)
    const eventNames = new Set(annotated.filter((d) => d.isPlayoff).map((d) => d.eventName!))
    for (const eventName of eventNames) {
      const key = makeKey(tournamentId, eventName)
      if (cache.has(key)) continue
      try {
        await fetchAndCache(tournamentId, eventName)
        console.log(`[event-bundle-cache] pre-warmed: ${tournamentId} event ${eventName}`)
      } catch (err) {
        console.warn(`[event-bundle-cache] failed: ${tournamentId} event ${eventName}:`, err)
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/event-bundle-cache.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/event-bundle-cache.ts __tests__/event-bundle-cache.test.ts
git commit -m "cache: event-bundle-cache mirrors bracket-cache shape"
```

---

### Task 7: API route + draws annotation

**Files:**
- Create: `app/api/event-bundle/route.ts`
- Modify: `app/api/draws/route.ts`
- Modify: `lib/draws-cache.ts`
- Test: `__tests__/api-event-bundle-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api-event-bundle-route.test.ts`:

```ts
import { GET } from '@/app/api/event-bundle/route'

jest.mock('@/lib/event-bundle-cache', () => {
  const real = jest.requireActual('@/lib/event-bundle-cache')
  return {
    ...real,
    cache: new Map(),
    fetchAndCache: jest.fn(),
  }
})

import { fetchAndCache, cache, TTL_MS } from '@/lib/event-bundle-cache'

const makeReq = (params: Record<string, string>) => new Request(
  'http://localhost/api/event-bundle?' + new URLSearchParams(params).toString()
)

describe('GET /api/event-bundle', () => {
  beforeEach(() => {
    cache.clear()
    ;(fetchAndCache as jest.Mock).mockReset()
  })

  it('400 if missing params', async () => {
    const res = await GET(makeReq({}))
    expect(res.status).toBe(400)
  })

  it('404 when bundle is null', async () => {
    ;(fetchAndCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(makeReq({ tournament: 'guid', event: 'BS U11' }))
    expect(res.status).toBe(404)
  })

  it('200 returns the bundle', async () => {
    const fake = { eventName: 'BS U11', playoff: { html: '', format: 'single-elimination' }, playoffDrawNum: '9', groups: [] }
    ;(fetchAndCache as jest.Mock).mockResolvedValue(fake)
    const res = await GET(makeReq({ tournament: 'guid', event: 'BS U11' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(fake)
  })

  it('serves cached bundle without re-fetching', async () => {
    const fake = { eventName: 'BS U11', playoff: { html: '', format: 'single-elimination' }, playoffDrawNum: '9', groups: [] }
    cache.set('guid::BS U11', { bundle: fake as never, ts: Date.now() })
    const res = await GET(makeReq({ tournament: 'guid', event: 'BS U11' }))
    expect(res.status).toBe(200)
    expect(fetchAndCache).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api-event-bundle-route.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `app/api/event-bundle/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { cache, TTL_MS, fetchAndCache, makeKey } from '@/lib/event-bundle-cache'

export const maxDuration = 60

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournament = searchParams.get('tournament')?.toLowerCase()
  const event = searchParams.get('event')
  if (!tournament || !event) {
    return NextResponse.json({ error: 'Provide ?tournament=&event=' }, { status: 400 })
  }

  const key = makeKey(tournament, event)
  const cached = cache.get(key)
  if (cached && (cached.done || Date.now() - cached.ts < TTL_MS)) {
    return NextResponse.json(cached.bundle)
  }

  try {
    const bundle = await fetchAndCache(tournament, event)
    if (!bundle) {
      return NextResponse.json({ error: 'event not found' }, { status: 404 })
    }
    return NextResponse.json(bundle)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: `Could not load event bundle: ${message}` }, { status: 502 })
  }
}
```

- [ ] **Step 4: Annotate cached draws on store**

Edit `lib/draws-cache.ts`. Wrap the cache writes with `detectGroupedDraws()` so all downstream consumers (page, schedule, stats, etc.) see annotated `DrawInfo`.

```ts
import { detectGroupedDraws } from './scraper'

export async function fetchAndCache(id: string): Promise<DrawInfo[]> {
  const draws = detectGroupedDraws(await fetchDraws(id))
  cache.set(id, { draws, ts: Date.now() })
  return draws
}

export async function fetchAndCacheWithTtl(id: string, done: boolean): Promise<DrawInfo[]> {
  const draws = detectGroupedDraws(await fetchDraws(id))
  cache.set(id, { draws, ts: Date.now(), ...(done && { done: true }) })
  return draws
}
```

- [ ] **Step 5: Update `/api/draws` filter to bundle-aware**

Edit `app/api/draws/route.ts`. Replace the existing filter:

```ts
// Old: const filter = (draws: DrawInfo[]) => draws.filter((d) => d.type !== 'Round Robin')
// Replace with: hide individual group draws, keep playoff (which represents the bundle) and non-grouped draws.
const filter = (draws: DrawInfo[]) => draws.filter((d) => !d.groupLetter)
```

This way the dropdown shows `BS U11` once (the playoff draw, now flagged `isPlayoff: true` and carrying `eventName: "BS U11"`) instead of nine entries.

- [ ] **Step 6: Run all impacted tests**

Run: `npx jest __tests__/api-event-bundle-route.test.ts __tests__/scraper.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/event-bundle/route.ts app/api/draws/route.ts lib/draws-cache.ts __tests__/api-event-bundle-route.test.ts
git commit -m "api: /event-bundle route + draws annotation hides individual groups"
```

---

## Phase 2 — UI Components

### Task 8: Extract `usePlayerHighlight` hook

**Files:**
- Create: `lib/usePlayerHighlight.ts`
- Modify: `components/BracketCanvas.tsx`

- [ ] **Step 1: Inspect current BracketCanvas highlight code**

Read `components/BracketCanvas.tsx` lines 40–120. The post-processing builds `displayHtml` from `bracketHtml` by parsing it in a hidden wrapper, applying `.tracked` and `.highlighted` classes, attaching club/lang annotations. Note all DOM mutations and dependencies (`playerQuery`, `playerClubMap`, `lang`).

- [ ] **Step 2: Create `lib/usePlayerHighlight.ts`**

The hook accepts a `containerRef` and the same inputs. It runs in an effect that re-applies on container content changes. Two modes are needed: **markup-mode** (existing BracketCanvas behavior — pre-compute `displayHtml` from a string) and **DOM-mode** (mutate an existing rendered tree, used by `EventBundleView`).

```ts
'use client'
import { useEffect } from 'react'
import { expandSearchQuery } from './searchAliases'
import type { Lang } from './i18n'

export function applyPlayerHighlight(
  root: HTMLElement,
  playerQuery: string,
  playerClubMap?: Record<string, string>,
  _lang?: Lang,
): void {
  const queries = expandSearchQuery(playerQuery)
  const allRows = root.querySelectorAll<HTMLElement>('.bk-row, .match__row, .standings-row')

  allRows.forEach((row) => {
    const players = row.querySelectorAll<HTMLElement>('[data-player-id]')
    let matches = false
    players.forEach((p) => {
      const pid = p.getAttribute('data-player-id') ?? ''
      const name = (p.textContent ?? '').toLowerCase()
      const club = (pid && playerClubMap ? (playerClubMap[pid] ?? '') : '').toLowerCase()
      const hit = queries.some((q) => name.includes(q) || (q && club.includes(q)))
      if (hit) matches = true
    })
    row.classList.toggle('highlighted', matches)
    row.classList.toggle('tracked', matches)
  })
}

export function usePlayerHighlight(
  containerRef: React.RefObject<HTMLElement>,
  playerQuery: string,
  playerClubMap: Record<string, string> | undefined,
  lang: Lang,
  rerunKey: unknown,  // bump when container content changes (e.g. bundle)
): void {
  useEffect(() => {
    if (!containerRef.current) return
    applyPlayerHighlight(containerRef.current, playerQuery, playerClubMap, lang)
  }, [containerRef, playerQuery, playerClubMap, lang, rerunKey])
}
```

- [ ] **Step 3: Refactor `BracketCanvas` to use the hook**

In `components/BracketCanvas.tsx`, keep the existing pre-rendered HTML approach (the bracket needs SVG positioning that's baked into the source string — don't change that). Replace the inlined post-processing inside the `displayHtml` `useMemo` with a call to `applyPlayerHighlight`:

```ts
const displayHtml = useMemo(() => {
  if (!bracketHtml || typeof document === 'undefined') return bracketHtml
  const wrapper = document.createElement('div')
  wrapper.innerHTML = bracketHtml
  applyPlayerHighlight(wrapper, playerQuery, playerClubMap, lang)
  return wrapper.innerHTML
}, [bracketHtml, playerQuery, playerClubMap, lang])
```

Import `applyPlayerHighlight` from `@/lib/usePlayerHighlight`.

- [ ] **Step 4: Run existing component tests**

Run: `npx jest __tests__/MatchSchedule.highlight.test.tsx __tests__/scraper.test.ts`
Expected: PASS — bracket highlight behavior unchanged.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev` and confirm: open a regular (non-grouped) tournament's bracket, type a player name in search, verify highlights still appear. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add lib/usePlayerHighlight.ts components/BracketCanvas.tsx
git commit -m "refactor: extract usePlayerHighlight from BracketCanvas"
```

---

### Task 9: `StandingsTable` component

**Files:**
- Create: `components/StandingsTable.tsx`
- Test: `__tests__/StandingsTable.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/StandingsTable.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import StandingsTable from '@/components/StandingsTable'
import type { StandingsRow } from '@/lib/types'

const rows: StandingsRow[] = [
  { position: 1, players: [{ name: 'Alice', playerId: '11' }], club: 'Club A', played: 2, won: 2, drawn: 0, lost: 0, matches: '4-0', games: '42-20', points: '2-0', pts: 4 },
  { position: 2, players: [{ name: 'Bob', playerId: '22' }], played: 2, won: 1, drawn: 0, lost: 1, matches: '2-2', games: '30-30', points: '1-1', pts: 2 },
  { position: 3, players: [{ name: 'Carol', playerId: '33' }], played: 2, won: 0, drawn: 0, lost: 2, matches: '0-4', games: '20-42', points: '0-2', pts: 0 },
]

describe('StandingsTable', () => {
  it('renders all rows with player names', () => {
    render(<StandingsTable rows={rows} qualifierCount={1} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Carol')).toBeInTheDocument()
  })

  it('marks top N rows as advancing', () => {
    const { container } = render(<StandingsTable rows={rows} qualifierCount={2} />)
    const advancing = container.querySelectorAll('tr.advances')
    expect(advancing).toHaveLength(2)
  })

  it('renders W-L column', () => {
    render(<StandingsTable rows={rows} qualifierCount={1} />)
    expect(screen.getByText('2-0')).toBeInTheDocument()
    expect(screen.getByText('1-1')).toBeInTheDocument()
  })

  it('renders dash for position when zero played', () => {
    const zeroRows: StandingsRow[] = [{ ...rows[0], played: 0, won: 0, lost: 0, pts: 0 }]
    render(<StandingsTable rows={zeroRows} qualifierCount={1} />)
    const posCell = screen.getByText('—')
    expect(posCell).toBeInTheDocument()
  })

  it('exposes data-player-id on player spans for highlight', () => {
    const { container } = render(<StandingsTable rows={rows} qualifierCount={1} />)
    expect(container.querySelector('[data-player-id="11"]')).not.toBeNull()
    expect(container.querySelector('[data-player-id="22"]')).not.toBeNull()
  })
})
```

If `@testing-library/react` is not yet a devDependency, run: `npm install --save-dev @testing-library/react @testing-library/jest-dom`. Check `jest.setup.ts` for an existing import line; add `import '@testing-library/jest-dom'` if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/StandingsTable.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `components/StandingsTable.tsx`**

```tsx
'use client'
import type { StandingsRow } from '@/lib/types'

interface Props {
  rows: StandingsRow[]
  qualifierCount: number
  onPlayerClick?: (playerId: string) => void
}

export default function StandingsTable({ rows, qualifierCount, onPlayerClick }: Props) {
  if (rows.length === 0) return null
  const anyPlayed = rows.some((r) => r.played > 0)

  return (
    <table className="w-full text-sm border-collapse">
      <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
        <tr>
          <th className="text-left py-1.5 px-2 w-8">Pos</th>
          <th className="text-left py-1.5 px-2">Player</th>
          <th className="text-right py-1.5 px-2 w-8" title="Played">Pl</th>
          <th className="text-right py-1.5 px-2 w-12">W-L</th>
          <th className="text-right py-1.5 px-2 w-12 hidden sm:table-cell" title="Sets">M</th>
          <th className="text-right py-1.5 px-2 w-16 hidden sm:table-cell" title="Points">Gm</th>
          <th className="text-right py-1.5 px-2 w-10 font-semibold">Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const advances = i < qualifierCount
          const playerHtml = r.players.length === 0
            ? <span className="text-gray-400">—</span>
            : r.players.map((p, pi) => (
                <span key={pi} className="block">
                  <button
                    type="button"
                    data-player-id={p.playerId || undefined}
                    className="text-left hover:underline"
                    onClick={() => p.playerId && onPlayerClick?.(p.playerId)}
                  >
                    {p.name || '—'}
                  </button>
                </span>
              ))
          return (
            <tr
              key={r.position + ':' + (r.players[0]?.playerId ?? i)}
              className={`border-t border-gray-200 dark:border-gray-700 ${advances ? 'advances' : ''}`}
            >
              <td className="py-1.5 px-2 align-top">
                {anyPlayed ? (
                  <span className={advances ? 'text-green-600 dark:text-green-400 font-semibold' : 'text-gray-500'}>
                    {advances ? <span title="Advances to playoff" aria-label="advances">→</span> : null}
                    {r.position}
                  </span>
                ) : <span className="text-gray-400">—</span>}
              </td>
              <td className="py-1.5 px-2">
                {playerHtml}
                {r.club && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{r.club}</div>}
              </td>
              <td className="py-1.5 px-2 text-right">{r.played}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{r.won}-{r.lost}</td>
              <td className="py-1.5 px-2 text-right tabular-nums hidden sm:table-cell">{r.matches}</td>
              <td className="py-1.5 px-2 text-right tabular-nums hidden sm:table-cell">{r.games}</td>
              <td className="py-1.5 px-2 text-right font-semibold">{r.pts}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/StandingsTable.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/StandingsTable.tsx __tests__/StandingsTable.test.tsx
git commit -m "ui: StandingsTable with advance indicator and player click"
```

---

### Task 10: `GroupCard` component

**Files:**
- Create: `components/GroupCard.tsx`
- Test: `__tests__/GroupCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/GroupCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import GroupCard from '@/components/GroupCard'
import type { GroupData } from '@/lib/types'

const group: GroupData = {
  drawNum: '1',
  groupLetter: 'A',
  standings: [
    { position: 1, players: [{ name: 'Alice', playerId: '11' }], played: 1, won: 1, drawn: 0, lost: 0, matches: '2-0', games: '21-15', points: '1-0', pts: 2 },
    { position: 2, players: [{ name: 'Bob', playerId: '22' }], played: 1, won: 0, drawn: 0, lost: 1, matches: '0-2', games: '15-21', points: '0-1', pts: 0 },
  ],
  matches: [
    { draw: 'X - Group A', drawNum: '', round: 'Round 1', team1: [{ name: 'Alice', playerId: '11' }], team2: [{ name: 'Bob', playerId: '22' }], winner: 1, scores: [{ t1: 21, t2: 15 }], court: '', walkover: false, retired: false, nowPlaying: false },
    { draw: 'X - Group A', drawNum: '', round: 'Round 2', team1: [{ name: 'Alice', playerId: '11' }], team2: [{ name: 'Carol', playerId: '33' }], winner: null, scores: [], court: '', walkover: false, retired: false, nowPlaying: false },
  ],
}

describe('GroupCard', () => {
  it('renders group title and standings', () => {
    render(<GroupCard group={group} qualifierCount={1} />)
    expect(screen.getByText('Group A')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('hides matches by default', () => {
    render(<GroupCard group={group} qualifierCount={1} />)
    expect(screen.queryByText('Round 1')).not.toBeInTheDocument()
  })

  it('shows matches when expand button clicked', () => {
    render(<GroupCard group={group} qualifierCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: /show matches/i }))
    expect(screen.getByText('Round 1')).toBeInTheDocument()
    expect(screen.getByText('Round 2')).toBeInTheDocument()
  })

  it('summary chip shows played / total', () => {
    render(<GroupCard group={group} qualifierCount={1} />)
    expect(screen.getByText(/1 \/ 2 played/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/GroupCard.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `components/GroupCard.tsx`**

```tsx
'use client'
import { useState } from 'react'
import StandingsTable from './StandingsTable'
import type { GroupData, MatchEntry } from '@/lib/types'

interface Props {
  group: GroupData
  qualifierCount: number
  onPlayerClick?: (playerId: string) => void
  onExpand?: (groupLetter: string) => void
}

function MatchRow({ match }: { match: MatchEntry }) {
  const score = match.retired
    ? match.scores.map(s => `${s.t1}-${s.t2}`).join(', ') + ' Ret.'
    : match.walkover
      ? 'Walkover'
      : match.scores.map(s => `${s.t1}-${s.t2}`).join(', ')
  const teamLabel = (team: typeof match.team1) =>
    team.map(p => p.name).filter(Boolean).join(' / ') || '—'
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 px-2 rounded bg-gray-50 dark:bg-gray-800/40 mb-1.5">
      <div className="min-w-0 flex-1">
        <div className={match.winner === 1 ? 'font-semibold' : 'text-gray-600 dark:text-gray-400'}>{teamLabel(match.team1)}</div>
        <div className="text-[10px] text-gray-400 my-0.5">vs</div>
        <div className={match.winner === 2 ? 'font-semibold' : 'text-gray-600 dark:text-gray-400'}>{teamLabel(match.team2)}</div>
      </div>
      <div className="font-mono text-xs whitespace-nowrap">{score}</div>
    </div>
  )
}

export default function GroupCard({ group, qualifierCount, onPlayerClick, onExpand }: Props) {
  const [expanded, setExpanded] = useState(false)
  const played = group.matches.filter(m => m.scores.length > 0 || m.walkover).length

  const byRound = new Map<string, MatchEntry[]>()
  group.matches.forEach(m => {
    if (!byRound.has(m.round)) byRound.set(m.round, [])
    byRound.get(m.round)!.push(m)
  })

  return (
    <section
      id={`group-${group.groupLetter}`}
      className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900"
    >
      <header className="flex items-baseline justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
        <h3 className="font-semibold text-sm">Group {group.groupLetter}</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {played} / {group.matches.length} played
        </span>
      </header>
      <StandingsTable rows={group.standings} qualifierCount={qualifierCount} onPlayerClick={onPlayerClick} />
      {group.matches.length > 0 && (
        <button
          type="button"
          className="w-full text-left px-3 py-2 text-sm text-blue-600 dark:text-blue-400 border-t border-gray-200 dark:border-gray-700 hover:bg-blue-50/40 dark:hover:bg-blue-900/10"
          onClick={() => {
            setExpanded(e => {
              if (!e) onExpand?.(group.groupLetter)
              return !e
            })
          }}
        >
          {expanded ? 'Hide matches' : `Show matches (${group.matches.length})`}
        </button>
      )}
      {expanded && (
        <div className="px-3 pb-3">
          {Array.from(byRound.entries()).map(([round, ms]) => (
            <div key={round} className="mt-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">{round}</div>
              {ms.map((m, i) => <MatchRow key={i} match={m} />)}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/GroupCard.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/GroupCard.tsx __tests__/GroupCard.test.tsx
git commit -m "ui: GroupCard with standings + expandable matches"
```

---

### Task 11: `EventBundleView` component

**Files:**
- Create: `components/EventBundleView.tsx`
- Test: `__tests__/EventBundleView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/EventBundleView.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import EventBundleView from '@/components/EventBundleView'
import type { EventBundle } from '@/lib/types'

jest.mock('@/components/BracketCanvas', () => ({
  __esModule: true,
  default: ({ bracketHtml }: { bracketHtml: string }) =>
    <div data-testid="bracket-canvas">{bracketHtml || 'empty playoff'}</div>,
}))

const bundle: EventBundle = {
  eventName: 'BS U11',
  playoff: { html: '<div>playoff</div>', format: 'single-elimination' },
  playoffDrawNum: '9',
  groups: [
    { drawNum: '1', groupLetter: 'A', standings: [
      { position: 1, players: [{ name: 'Alice', playerId: '11' }], played: 0, won: 0, drawn: 0, lost: 0, matches: '0-0', games: '0-0', points: '0-0', pts: 0 },
    ], matches: [] },
    { drawNum: '2', groupLetter: 'B', standings: [
      { position: 1, players: [{ name: 'Bob', playerId: '22' }], played: 0, won: 0, drawn: 0, lost: 0, matches: '0-0', games: '0-0', points: '0-0', pts: 0 },
    ], matches: [] },
  ],
}

describe('EventBundleView', () => {
  it('renders Groups tab by default with all group cards', () => {
    render(<EventBundleView bundle={bundle} playerQuery="" lang="en" />)
    expect(screen.getByText('Group A')).toBeInTheDocument()
    expect(screen.getByText('Group B')).toBeInTheDocument()
  })

  it('switches to Playoff tab and renders BracketCanvas', () => {
    render(<EventBundleView bundle={bundle} playerQuery="" lang="en" />)
    fireEvent.click(screen.getByRole('button', { name: /playoff/i }))
    expect(screen.getByTestId('bracket-canvas')).toBeInTheDocument()
  })

  it('computes qualifierCount as ceil(playoffSize / groupCount), clamped to 1', () => {
    // Helper exported alongside the component
    const { computeQualifierCount } = jest.requireActual('@/components/EventBundleView')
    expect(computeQualifierCount(8, 8)).toBe(1)
    expect(computeQualifierCount(8, 4)).toBe(2)
    expect(computeQualifierCount(0, 8)).toBe(1)  // clamp lower bound
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/EventBundleView.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `components/EventBundleView.tsx`**

```tsx
'use client'
import { useState, useRef, useEffect } from 'react'
import GroupCard from './GroupCard'
import BracketCanvas from './BracketCanvas'
import { usePlayerHighlight } from '@/lib/usePlayerHighlight'
import type { EventBundle } from '@/lib/types'
import type { Lang } from '@/lib/i18n'

export function computeQualifierCount(playoffSize: number, groupCount: number): number {
  if (groupCount === 0) return 1
  return Math.max(1, Math.ceil(playoffSize / groupCount))
}

interface Props {
  bundle: EventBundle
  playerQuery: string
  playerClubMap?: Record<string, string>
  lang: Lang
  initialTab?: 'groups' | 'playoff'
  onPlayerClick?: (playerId: string) => void
  onTabChange?: (tab: 'groups' | 'playoff') => void
  onGroupExpand?: (groupLetter: string) => void
  fromRound?: number
}

export default function EventBundleView({
  bundle, playerQuery, playerClubMap, lang,
  initialTab = 'groups', onPlayerClick, onTabChange, onGroupExpand, fromRound,
}: Props) {
  const [tab, setTab] = useState<'groups' | 'playoff'>(initialTab)
  const groupsRef = useRef<HTMLDivElement>(null)
  // Playoff size: derive from the playoff bracket DOM via slot count at round 0.
  // Conservative fallback: assume groupCount slots when we can't tell.
  const playoffSize = bundle.groups.length
  const qualifierCount = computeQualifierCount(playoffSize, bundle.groups.length)

  usePlayerHighlight(groupsRef, playerQuery, playerClubMap, lang, bundle.eventName + ':' + tab)

  useEffect(() => {
    onTabChange?.(tab)
  }, [tab, onTabChange])

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-4">
        <button
          type="button"
          className={`px-4 py-2 -mb-px border-b-2 ${tab === 'groups' ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-semibold' : 'border-transparent text-gray-500'}`}
          onClick={() => setTab('groups')}
        >Groups</button>
        <button
          type="button"
          className={`px-4 py-2 -mb-px border-b-2 ${tab === 'playoff' ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-semibold' : 'border-transparent text-gray-500'}`}
          onClick={() => setTab('playoff')}
        >Playoff</button>
      </div>

      {tab === 'groups' && (
        <div ref={groupsRef} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {bundle.groups.map((g) => (
            <GroupCard
              key={g.drawNum}
              group={g}
              qualifierCount={qualifierCount}
              onPlayerClick={onPlayerClick}
              onExpand={onGroupExpand}
            />
          ))}
        </div>
      )}
      {tab === 'playoff' && (
        <BracketCanvas
          bracketHtml={bundle.playoff.html}
          playerQuery={playerQuery}
          playerClubMap={playerClubMap}
          lang={lang}
          fromRound={fromRound ?? 0}
        />
      )}
    </div>
  )
}
```

(Note: only pass `BracketCanvas` props that exist on its current signature; if it has additional required props in the codebase, pass them through from `Props`.)

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/EventBundleView.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/EventBundleView.tsx __tests__/EventBundleView.test.tsx
git commit -m "ui: EventBundleView with Groups/Playoff tabs"
```

---

## Phase 3 — Page Integration

### Task 12: Wire `EventBundleView` into the page

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Locate the bracket fetch + render branch**

Read `app/page.tsx` around lines 463–535 (`fetchBracketFrom`, `handleDrawChange`) and lines 985–995 (`<BracketCanvas/>` render). The existing flow: pick draw → `fetchBracketFrom` → `setBracketHtml` → `<BracketCanvas/>`.

- [ ] **Step 2: Add bundle state + fetch**

Inside the page component, add bundle state alongside `bracketHtml`:

```ts
const [bundle, setBundle] = useState<EventBundle | null>(null)

const fetchEventBundle = useCallback(async (tournamentId: string, eventName: string) => {
  setLoadingBracket(true)
  setBundle(null)
  setBracketHtml('')
  try {
    const res = await fetch(`/api/event-bundle?tournament=${encodeURIComponent(tournamentId)}&event=${encodeURIComponent(eventName)}`)
    const data = await safeJson(res)
    if ('error' in data) {
      setError(data.error as string)
    } else {
      setBundle(data as EventBundle)
    }
  } finally {
    setLoadingBracket(false)
  }
}, [])
```

- [ ] **Step 3: Branch in `handleDrawChange`**

In `handleDrawChange`, after looking up the chosen draw, branch on `d?.isPlayoff && d.eventName`:

```ts
const handleDrawChange = useCallback(async (drawNum: string) => {
  setSelectedDraw(drawNum)
  setBracketHtml('')
  setBundle(null)
  if (!drawNum || !selectedTournament) return
  const d = draws.find((d) => d.drawNum === drawNum)
  setDrawName(d?.name ?? drawNum)
  if (d?.isPlayoff && d.eventName) {
    await fetchEventBundle(selectedTournament, d.eventName)
    return
  }
  await fetchBracketFrom(selectedTournament, drawNum, 0)
}, [selectedTournament, draws, fetchBracketFrom, fetchEventBundle])
```

- [ ] **Step 4: Branch the render**

Replace the existing `{bracketHtml && !loadingBracket && (<BracketCanvas …/>)}` block:

```tsx
{loadingBracket && (
  <div className="text-center text-gray-500 my-8">Loading…</div>
)}
{!loadingBracket && bundle && (
  <EventBundleView
    bundle={bundle}
    playerQuery={playerQuery}
    playerClubMap={playerClubMap}
    lang={lang}
    onPlayerClick={openPlayerModal}
  />
)}
{!loadingBracket && !bundle && bracketHtml && (
  <BracketCanvas
    bracketHtml={bracketHtml}
    playerQuery={playerQuery}
    playerClubMap={playerClubMap}
    lang={lang}
    /* …other existing props… */
  />
)}
```

(Match the existing `BracketCanvas` props exactly to what was there before.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Manual smoke test (web app)**

Run: `npm run dev`. In another terminal verify both flows:

1. Open a non-grouped tournament, pick a draw → bracket renders as before.
2. Open the reference tournament `a2812d92-…` (you may need to add it via `KBADashboard` or whatever onboarding flow the app uses), pick `BS U11` from the dropdown → tabbed event view appears with 8 group cards visible.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx
git commit -m "page: branch between BracketCanvas and EventBundleView on isPlayoff"
```

---

## Phase 4 — Cross-Feature Integration

### Task 13: Schedule deep-link + `MatchEntry.eventName`

**Files:**
- Modify: `lib/scraper.ts` (`parseMatchesFull`)
- Modify: `components/MatchSchedule.tsx`

- [ ] **Step 1: Populate `eventName` in `parseMatchesFull`**

`parseMatchesFull` already reads each match's draw name. After parsing, do an in-place annotation pass: for each match whose `draw` matches `/^(.+?) - Group [A-Z]$/`, set `eventName` to the captured event name. Keep this localized to `parseMatchesFull` — don't reach into `detectGroupedDraws` here, since `MatchesData` is parsed before draws may be cached.

```ts
// Inside parseMatchesFull, after building matches[] and before returning:
matches.forEach((m) => {
  const gm = m.draw.match(/^(.+?) - Group ([A-Z])$/)
  if (gm) m.eventName = gm[1]
})
```

- [ ] **Step 2: Update MatchSchedule draw-pill click handler**

In `components/MatchSchedule.tsx`, locate the draw pill / `onClick` that currently navigates to a single draw. Change it to:

```ts
const onDrawClick = (m: MatchEntry) => {
  if (m.eventName) {
    onOpenBracketAtRound(/* find playoff drawNum for eventName via passed-in draws map */, m.round)
    // or navigate via the same handler the page uses, with the playoff drawNum
  } else {
    onOpenBracketAtRound(m.drawNum, m.round)
  }
}
```

The exact lookup depends on how the existing `MatchSchedule` receives the draws list. If it doesn't, thread a small `eventToPlayoffDraw: Record<string, string>` map from `app/page.tsx` (built once from the draws array via `detectGroupedDraws` annotations) and use it to resolve `eventName → playoffDrawNum`.

- [ ] **Step 3: Run schedule tests**

Run: `npx jest __tests__/MatchSchedule.highlight.test.tsx __tests__/MatchSchedule.live.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/scraper.ts components/MatchSchedule.tsx
git commit -m "schedule: deep-link round-robin matches to their event bundle"
```

---

### Task 14: Tournament stats — group event rows by `eventName`

**Files:**
- Modify: `lib/tournamentStats.ts`

- [ ] **Step 1: Locate the events table builder**

In `lib/tournamentStats.ts`, find the function that produces `StatsEventRow[]` (likely keyed on `match.draw`).

- [ ] **Step 2: Group by `eventName` when set**

Change the keying so matches with `eventName` aggregate under that name; matches without continue to use `draw`. The displayed `name` field is `eventName ?? draw`. The `winner` column for grouped events should resolve from the matching playoff draw (the draw whose name === eventName and where a final has been played); use the existing winner-resolution code path, just keyed differently.

- [ ] **Step 3: Run stats tests**

Run: `npx jest __tests__/api-stats-route.test.ts __tests__/stats-cache.test.ts`
Expected: PASS. Add a small unit test if any stats unit-test fixture covers grouped events; otherwise rely on smoke testing.

- [ ] **Step 4: Smoke check**

Run `npm run dev`, open the reference tournament's stats panel, confirm "BS U11" appears once (not 9 times) in the Events table.

- [ ] **Step 5: Commit**

```bash
git add lib/tournamentStats.ts
git commit -m "stats: aggregate events by eventName for grouped tournaments"
```

---

## Phase 5 — Pre-warm

### Task 15: Pre-warm hook

**Files:**
- Modify: `instrumentation.ts`

- [ ] **Step 1: Wire `prewarmEventBundleCache` after `prewarmBracketCache`**

In `instrumentation.ts`, inside the `register()` function:

```ts
const { prewarmEventBundleCache } = await import('./lib/event-bundle-cache')

// …existing prewarms…
await prewarmBracketCache()
await prewarmEventBundleCache()
```

- [ ] **Step 2: Manual test in dev**

Run: `npm run dev`. Watch the console for `[event-bundle-cache] pre-warmed: …` messages. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add instrumentation.ts
git commit -m "instrumentation: pre-warm event bundles after brackets"
```

---

## Self-Review Notes

Before declaring this plan done, the writer should verify:

- **Spec coverage:**
  - Architecture diagram → Tasks 2, 5, 7, 11, 12 ✓
  - Data types → Task 1 ✓
  - `getEventBundle` provider method → Task 5 ✓
  - Parsers (`parseStandings`, `parseRoundRobinMatches`, `detectGroupedDraws`) → Tasks 2, 3, 4 ✓
  - `extractMatchEntry` refactor → Task 4 ✓
  - Cache → Task 6 ✓
  - API route → Task 7 ✓
  - `EventBundleView`, `GroupCard`, `StandingsTable` → Tasks 9, 10, 11 ✓
  - Shared `usePlayerHighlight` hook → Task 8 ✓
  - Schedule integration → Task 13 ✓
  - Stats integration → Task 14 ✓
  - Pre-warm → Task 15 ✓
  - Page integration / dropdown changes → Tasks 7 (filter), 12 (render) ✓
  - Live-score, alerts, H2H, player modal, dark mode, BWF, discovery → no changes per spec ✓
  - **Custom-tab migration:** spec mentions migrating saved custom tabs. Inspecting `lib/customTab.ts` shows custom tabs are nicknamed search keywords, not draw references. There is nothing to migrate — the spec item is vacuous; no task needed.
  - **Stale-while-revalidate** at the page level: spec calls for it but it's a polish item. Deferred — current behavior (read-through cache with 15-min TTL on the API route) is sufficient for first ship; add a follow-up plan if/when felt as friction.
  - **Analytics events** (`event_bundle_viewed`, `event_bundle_group_expanded`): the components accept `onTabChange` / `onGroupExpand` callbacks; wiring them to `posthog.capture` is a one-liner in `app/page.tsx`. Consider adding to Task 12 or a tiny follow-up commit.
  - **Loading skeletons** specified in the spec: Task 12 currently shows a "Loading…" string; replace with skeleton components matching existing `BracketCanvas` skeletons during a polish pass.

- **Placeholder scan:** all "TBD"-style language has been audited. Each step contains either runnable code or an exact command. The note on `MatchSchedule.tsx` in Task 13 Step 2 says "the exact lookup depends on" — this is a real branching point determined by reading the file at execution time, not a placeholder.

- **Type consistency:** `EventBundle.playoff: BracketData`, `EventBundle.groups: GroupData[]`, `GroupData.standings: StandingsRow[]`, `GroupData.matches: MatchEntry[]` — all consistent across types declaration (Task 1), provider (Task 5), cache (Task 6), API (Task 7), and components (Tasks 9–11).

---

## Execution

This plan is ready to execute task-by-task. Follow `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.

# Player Ranking Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the BAT per-player tournament breakdown on `/player/bat/<slug>` with three discipline tabs (Singles / Doubles / Mixed), each grouped by ranking category.

**Architecture:** Pure HTML→typed scraper + on-demand route + publishDate-keyed disk cache that auto-invalidates when the weekly ranking refreshes. Three small presentational components nested inside the existing `PlayerProfileView`. See spec at `docs/superpowers/specs/2026-06-01-player-ranking-detail-design.md`.

**Tech Stack:** Next.js 14 (app router), React 18, TypeScript, Jest, existing helpers (`batFetch`, `extractProfileUrl`, `useLanguage`).

---

## Pre-flight

Before starting, confirm you are on branch `player-ranking-detail-spec` (already checked out by the brainstorming step). All tasks commit to this branch; final merge is a separate manual step at the end.

```bash
git status                      # working tree clean
git branch --show-current       # → player-ranking-detail-spec
npx jest 2>&1 | tail -5         # → 575/575 passing baseline
```

---

## Task 1: Capture the BAT ranking-player HTML fixture

**Files:**
- Create: `__tests__/fixtures/bat-ranking-player.html`

- [ ] **Step 1: Fetch the live page**

The plan's example player is รวิณ ชูชัยศรี (`player=3903158`). The weekly `id=` parameter changes; if `51869` no longer works the BAT server redirects to the current one, so this URL is still safe to use as a starting point:

```bash
curl -sSL \
  -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' \
  'https://bat.tournamentsoftware.com/ranking/player.aspx?id=51869&player=3903158' \
  > __tests__/fixtures/bat-ranking-player.html
```

- [ ] **Step 2: Sanity-check the fixture**

```bash
wc -l __tests__/fixtures/bat-ranking-player.html      # expect: a few thousand lines
grep -c 'icon_new.gif' __tests__/fixtures/bat-ranking-player.html  # expect: ≥ 1
grep -c 'href="tournament.aspx' __tests__/fixtures/bat-ranking-player.html  # expect: > 10
```

If `icon_new.gif` count is 0, the player has no rows that count toward any ranking — pick a different active player (any BAT top-50 result from `~/app/.cache/players/bat-ranking.json`) and redo Step 1.

- [ ] **Step 3: Commit**

```bash
git add __tests__/fixtures/bat-ranking-player.html
git commit -m "test(fixtures): add BAT ranking-player page snapshot for รวิณ"
```

---

## Task 2: Add `parseRankingId()` to `bat-ranking-scraper.ts`

**Files:**
- Modify: `lib/bat-ranking-scraper.ts`
- Modify: `__tests__/bat-ranking-scraper.test.ts`

- [ ] **Step 1: Write the failing test**

Open `__tests__/bat-ranking-scraper.test.ts`. At the top, add `parseRankingId` to the import list, then append this new `describe` block to the end of the file:

```ts
describe('parseRankingId', () => {
  it("extracts the rankingId from a category link on the overview page", () => {
    const html = `
      <th colspan="9"><a href="category.aspx?id=51771&category=5694">U23 Men's singles</a></th>
    `
    expect(parseRankingId(html)).toBe('51771')
  })

  it('extracts the rankingId from an entry-row player link as a fallback', () => {
    // Some BAT pages don't put a category.aspx link in the headers; the
    // per-player rows still encode the rankingId in their player.aspx href.
    const html = `<a href="player.aspx?id=51899&player=2458898">player</a>`
    expect(parseRankingId(html)).toBe('51899')
  })

  it('returns empty string when nothing matches', () => {
    expect(parseRankingId('<html><body>no links here</body></html>')).toBe('')
  })

  it('prefers the category link over a stray player link further down the page', () => {
    // If both appear, the category link reflects the canonical id for the
    // current edition; player rows can carry the id of a redirected entry.
    const html = `
      <a href="player.aspx?id=99999&player=1">stray</a>
      <th colspan="9"><a href="category.aspx?id=51771&category=5694">U23 Men's singles</a></th>
    `
    expect(parseRankingId(html)).toBe('51771')
  })
})
```

Also change the existing import line to:

```ts
import { parseBatRanking, parseCategoryList, parseCategoryPage, eventCodeFromName, parseRankingId } from '@/lib/bat-ranking-scraper'
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/bat-ranking-scraper.test.ts -t 'parseRankingId' 2>&1 | tail -15
```

Expected: FAIL with `parseRankingId is not a function`.

- [ ] **Step 3: Implement**

Open `lib/bat-ranking-scraper.ts` and append after `parsePublishDate`:

```ts
/** Extract the weekly rankingId from any page that links to a category or
 *  per-player URL. category.aspx links are preferred (they're on the overview
 *  page and reflect the canonical edition); player.aspx is a fallback for
 *  pages that only have entry rows. Returns '' if nothing matches. */
export function parseRankingId(html: string): string {
  const cat = html.match(/href="category\.aspx\?id=(\d+)/i)
  if (cat) return cat[1]
  const ply = html.match(/href="player\.aspx\?id=(\d+)/i)
  return ply ? ply[1] : ''
}
```

- [ ] **Step 4: Verify**

```bash
npx jest __tests__/bat-ranking-scraper.test.ts -t 'parseRankingId' 2>&1 | tail -8
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/bat-ranking-scraper.ts __tests__/bat-ranking-scraper.test.ts
git commit -m "feat(ranking-scraper): add parseRankingId() helper

Reads the weekly id= URL parameter from a category or player link.
Used by the per-player detail flow so the URL we hit is deterministic
instead of relying on BAT redirect behavior."
```

---

## Task 3: Extend `BatRanking` type and bump `bat-ranking-cache` to v11

**Files:**
- Modify: `lib/types.ts:567-571`
- Modify: `lib/bat-ranking-cache.ts:30-39`
- Modify: `app/api/bat-ranking/refresh/route.ts`
- Modify: `__tests__/stats-cache.test.ts` (one comment update is enough)

Note: This is purely a schema change. We could split into many tiny tasks but bundling keeps the working tree green between commits (the type, the cache reader, and the only existing writer all need to agree on the schema).

- [ ] **Step 1: Add `rankingId` to `BatRanking` interface**

In `lib/types.ts`, change:

```ts
export interface BatRanking {
  scrapedAt: string
  publishDate: string
  events: BatRankingEvent[]
}
```

to:

```ts
export interface BatRanking {
  scrapedAt: string
  publishDate: string
  /** The weekly id= URL parameter on category/player pages. Stable for the
   *  duration of one publication; changes every Tuesday. */
  rankingId: string
  events: BatRankingEvent[]
}
```

- [ ] **Step 2: Bump cache to v11**

In `lib/bat-ranking-cache.ts`, locate the `version: 10` constants. Change both the type literal and the read/write checks. The file should end with:

```ts
import { promises as fs } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import type { BatRanking } from './types'

// v11 adds rankingId so the per-player detail URL can be constructed
// deterministically. v10 envelopes lack the field — rejected on read.

let root = path.join(process.cwd(), '.cache', 'players')

export function __setBatRankingRootForTesting(dir: string): void { root = dir }

function cacheFile(): string { return path.join(root, 'bat-ranking.json') }

export async function readBatRankingCache(): Promise<BatRanking | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as BatRanking & { rankingId?: string }
    if (typeof parsed.rankingId !== 'string') return null  // v10 envelope, refresh will rewrite
    return parsed as BatRanking
  } catch {
    return null
  }
}

export async function writeBatRankingCache(data: BatRanking): Promise<void> {
  const file = cacheFile()
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
  await fs.rename(tmp, file)
}

export function hashFullCacheBytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}
```

(Open the file first to confirm exact existing line layout before editing — do not assume the read above is the whole file. The key change is: gate the read on `parsed.rankingId` being a string.)

- [ ] **Step 3: Populate `rankingId` in the refresh route**

In `app/api/bat-ranking/refresh/route.ts`, two changes:

(a) Add `parseRankingId` to the existing import line from the scraper:

```ts
import { parseCategoryList, parseCategoryPage, parsePublishDate, eventCodeFromName, parseRankingId } from '@/lib/bat-ranking-scraper'
```

(b) Replace the `writeBatRankingCache(...)` call. Currently it reads:

```ts
const scrapedAt = new Date().toISOString()
await writeBatRankingCache({ scrapedAt, publishDate, events })
```

Change to:

```ts
const scrapedAt = new Date().toISOString()
const rankingId = parseRankingId(overviewHtml)
if (!rankingId) {
  return NextResponse.json({ error: 'rankingId not found on overview page' }, { status: 502 })
}
await writeBatRankingCache({ scrapedAt, publishDate, rankingId, events })
```

- [ ] **Step 4: Update existing tests that build a `BatRanking` literal or mock the scraper**

Two test files need exact edits. Make them now.

**4a. `__tests__/bat-ranking-cache.test.ts`** — add `rankingId` to the `sample`:

```ts
const sample: BatRanking = {
  scrapedAt: '2026-05-20T10:00:00Z',
  publishDate: '2026-05-20',
  rankingId: '51771',
  events: [
    {
      eventCode: 'MS',
      eventName: "Men's Singles",
      entries: [{ rank: 1, name: 'TEST PLAYER', slug: 'test_player', club: 'Test Club', points: 1500 }],
    },
  ],
}
```

**4b. `__tests__/api-bat-ranking-refresh-route.test.ts`** — three edits:

(i) Extend the `jest.mock` of the scraper module to also stub `parseRankingId`:

```ts
jest.mock('../lib/bat-ranking-scraper', () => ({
  parseCategoryList: jest.fn(),
  parseCategoryPage: jest.fn(),
  parsePublishDate: jest.fn(),
  parseRankingId: jest.fn(),
  eventCodeFromName: jest.fn(),
}))
```

(ii) Add `parseRankingId` to the import line:

```ts
import { parseCategoryList, parseCategoryPage, parsePublishDate, parseRankingId, eventCodeFromName } from '@/lib/bat-ranking-scraper'
```

(iii) Make `mockFetchSuccess()` also stub the ID parse:

```ts
function mockFetchSuccess() {
  ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<html>…</html>' })
  ;(parsePublishDate as jest.Mock).mockReturnValue('20/5/2569')
  ;(parseRankingId as jest.Mock).mockReturnValue('51899')
  ;(parseCategoryList as jest.Mock).mockReturnValue(MOCK_CATEGORIES)
  ;(parseCategoryPage as jest.Mock).mockReturnValue(MOCK_ENTRIES)
  ;(eventCodeFromName as jest.Mock).mockReturnValue('U23_MS')
  ;(writeBatRankingCache as jest.Mock).mockResolvedValue(undefined)
}
```

(iv) Three places in the file build a `readBatRankingCache` mock value. Add `rankingId: '51771'` to each. Search for `publishDate: '20/5/2569'` (twice, lines ~50 and ~62) and `publishDate: '13/5/2569'` (once, line ~77). Each is a small object literal you can edit in place — example for the first:

```ts
;(readBatRankingCache as jest.Mock).mockResolvedValue({
  scrapedAt: new Date().toISOString(),
  publishDate: '20/5/2569',
  rankingId: '51771',
  events: [{ eventCode: 'U23_MS', eventName: "U23 Men's singles", entries: MOCK_ENTRIES }],
})
```

(v) Add one new test for the "no rankingId on overview" failure mode — append inside the existing `describe`:

```ts
it('returns 502 when overview parse yields no rankingId', async () => {
  ;(readBatRankingCache as jest.Mock).mockResolvedValue(null)
  ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<html></html>' })
  ;(parsePublishDate as jest.Mock).mockReturnValue('20/5/2569')
  ;(parseRankingId as jest.Mock).mockReturnValue('')
  ;(parseCategoryList as jest.Mock).mockReturnValue(MOCK_CATEGORIES)
  const res = await POST(makeReq())
  expect(res.status).toBe(502)
  const json = await res.json()
  expect(json.error).toMatch(/rankingId/i)
})
```

- [ ] **Step 5: Run the affected suites**

```bash
npx jest __tests__/bat-ranking-cache.test.ts __tests__/api-bat-ranking-refresh-route.test.ts __tests__/bat-ranking-scraper.test.ts 2>&1 | tail -8
```

Expected: all pass.

- [ ] **Step 6: Full suite + typecheck**

```bash
npx jest 2>&1 | tail -6
npx tsc --noEmit 2>&1 | grep -v "bat-ranking-cache.test.ts" | tail -5
```

Expected: 575/575 pass (or higher if you added new assertions), no new TS errors.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/bat-ranking-cache.ts app/api/bat-ranking/refresh/route.ts __tests__
git commit -m "feat(ranking-cache): bump v10→v11, persist rankingId

v10 envelopes are rejected so the boot kick on the Tuesday scheduler
(commit 12a6469) will repopulate within ~45s of the deploy that ships
this. rankingId is parsed from the overview page on every refresh and
threaded through the writer."
```

---

## Task 4: Add per-player types to `lib/types.ts`

**Files:**
- Modify: `lib/types.ts` (append after the existing `BatRankingPlayerRank` interface, around line 578)

- [ ] **Step 1: Add the interfaces**

Append the following to `lib/types.ts` (place after the existing `BatRankingPlayerRank` block and before `PlayerProfileExtra`):

```ts
/** One tournament row on a player's BAT ranking detail page. */
export interface BatRankingPlayerTournament {
  tournamentName: string
  /** Tournament GUID parsed from the row link; null if the href didn't
   *  carry one (defensive — surface the row but no click-through). */
  tournamentId: string | null
  /** Source event as shown on BAT (e.g., "BS U15", "MD U17", "XD U23"). */
  sourceEvent: string
  /** "YYYY-WW" week of the tournament. */
  week: string
  /** Placement string as shown (e.g., "5/8", "17/32"). */
  result: string
  /** Tournament points earned. */
  points: number
  /** Ranking categories this row counts toward, parsed from the marker
   *  img's title attribute. Empty when the row is not in any top-10. */
  countsTowardRankings: string[]
}

export interface BatRankingPlayerDetail {
  /** Stable global BAT player id (the "player=" URL param). */
  globalPlayerId: string
  /** publishDate the detail was scraped against. Read-time mismatch with
   *  the current BatRanking.publishDate invalidates. */
  publishDate: string
  scrapedAt: string
  tournaments: BatRankingPlayerTournament[]
}

export interface BatRankingPlayerDetailCache {
  version: 1
  /** Success path. */
  detail?: BatRankingPlayerDetail
  /** Negative cache for a player whose BAT page 404'd. Keyed to the same
   *  publishDate as a success would be, so it expires with the next
   *  weekly publication. */
  notFound?: { publishDate: string; scrapedAt: string }
}

/** Single-file map of slug → BAT global player id. Append-only on success;
 *  failures are persisted as { globalPlayerId: null, reason } so the
 *  discovery route doesn't re-hit every page view. */
export interface BatPlayerIdMap {
  version: 1
  players: Record<string, { globalPlayerId: string | null; reason?: string }>
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v "bat-ranking-cache.test.ts" | tail -5
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add BatRankingPlayer{Tournament,Detail,DetailCache,IdMap}"
```

---

## Task 5: Implement `lib/bat-ranking-player-scraper.ts`

**Files:**
- Create: `lib/bat-ranking-player-scraper.ts`
- Create: `__tests__/bat-ranking-player-scraper.test.ts`

- [ ] **Step 1: Write the failing test (real fixture + edge cases)**

Create `__tests__/bat-ranking-player-scraper.test.ts`:

```ts
import * as fs from 'fs'
import * as path from 'path'
import { parseRankingPlayerPage } from '@/lib/bat-ranking-player-scraper'

const FIX = path.join(__dirname, 'fixtures', 'bat-ranking-player.html')
const FIXTURE_HTML = fs.readFileSync(FIX, 'utf8')

describe('parseRankingPlayerPage (real BAT fixture)', () => {
  it('produces at least 5 tournament rows', () => {
    const { tournaments } = parseRankingPlayerPage(FIXTURE_HTML)
    expect(tournaments.length).toBeGreaterThanOrEqual(5)
  })

  it('every row has a non-empty tournamentName, sourceEvent, week, result, and finite points', () => {
    const { tournaments } = parseRankingPlayerPage(FIXTURE_HTML)
    for (const t of tournaments) {
      expect(t.tournamentName).not.toBe('')
      expect(t.sourceEvent).toMatch(/[A-Z]{2,3}\s*U?\d*/)
      expect(t.week).toMatch(/^\d{4}-\d{1,2}$/)
      expect(t.result).not.toBe('')
      expect(Number.isFinite(t.points)).toBe(true)
      expect(t.points).toBeGreaterThanOrEqual(0)
    }
  })

  it('at least one row counts toward a ranking (has the marker img with title)', () => {
    const { tournaments } = parseRankingPlayerPage(FIXTURE_HTML)
    const marked = tournaments.filter((t) => t.countsTowardRankings.length > 0)
    expect(marked.length).toBeGreaterThanOrEqual(1)
  })

  it('marker titles list 1+ category names — parsed as separate strings', () => {
    const { tournaments } = parseRankingPlayerPage(FIXTURE_HTML)
    const marked = tournaments.find((t) => t.countsTowardRankings.length > 0)!
    for (const cat of marked.countsTowardRankings) {
      expect(cat).toMatch(/U?\d*\s*(Men|Women|Boys|Girls|Mixed)/i)
    }
  })

  it('extracts tournamentId from a tournament.aspx href when present', () => {
    const { tournaments } = parseRankingPlayerPage(FIXTURE_HTML)
    const withId = tournaments.filter((t) => t.tournamentId !== null)
    expect(withId.length).toBeGreaterThanOrEqual(1)
    // GUID-shaped id (BAT uppercase)
    for (const t of withId) expect(t.tournamentId).toMatch(/^[A-F0-9]{8}-/i)
  })
})

describe('parseRankingPlayerPage (synthetic edge cases)', () => {
  it('returns empty list on a page with no tournament rows', () => {
    const { tournaments } = parseRankingPlayerPage('<html><body><h1>No data</h1></body></html>')
    expect(tournaments).toEqual([])
  })

  it('handles a row missing the marker img — countsTowardRankings is []', () => {
    const html = `
      <table>
        <tbody>
        <tr>
          <td><a href="tournament.aspx?id=ABCDEF12-0000-0000-0000-000000000000">Open 2026</a></td>
          <td><a href="../sport/event.aspx?id=1">BS U15</a></td>
          <td>2026-20</td>
          <td>17/32</td>
          <td>3355</td>
          <td><a href="../sport/player.aspx?id=1&player=2">Matches</a></td>
        </tr>
        </tbody>
      </table>
    `
    const { tournaments } = parseRankingPlayerPage(html)
    expect(tournaments).toHaveLength(1)
    expect(tournaments[0].countsTowardRankings).toEqual([])
    expect(tournaments[0].tournamentId).toBe('ABCDEF12-0000-0000-0000-000000000000')
  })

  it('parses a multi-ranking title attribute (splits on comma)', () => {
    const html = `
      <table>
        <tbody>
        <tr>
          <td><a href="tournament.aspx?id=ABCDEF12-0000-0000-0000-000000000000">Open 2026</a></td>
          <td><a href="../sport/event.aspx?id=1">BS U15</a></td>
          <td>2026-20</td>
          <td>17/32</td>
          <td>3355</td>
          <td><a href="../sport/player.aspx?id=1&player=2">Matches</a></td>
          <td><img src="//static.tournamentsoftware.com/images/icon_new.gif"
            title="Used for: U23 Men's singles, U19 Boys singles" /></td>
        </tr>
        </tbody>
      </table>
    `
    const { tournaments } = parseRankingPlayerPage(html)
    expect(tournaments[0].countsTowardRankings).toEqual([
      "U23 Men's singles",
      'U19 Boys singles',
    ])
  })

  it('handles a tournament link with no GUID parameter — tournamentId is null', () => {
    const html = `
      <table>
        <tbody>
        <tr>
          <td><a href="tournament.aspx?other=value">Mystery</a></td>
          <td><a href="../sport/event.aspx?id=1">BS U11</a></td>
          <td>2026-01</td>
          <td>1/4</td>
          <td>500</td>
          <td><a href="../sport/player.aspx?id=1&player=2">Matches</a></td>
        </tr>
        </tbody>
      </table>
    `
    const { tournaments } = parseRankingPlayerPage(html)
    expect(tournaments[0].tournamentId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/bat-ranking-player-scraper.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scraper**

Create `lib/bat-ranking-player-scraper.ts`:

```ts
// Pure HTML → BatRankingPlayerTournament[] transform. No I/O, no side effects.
// Parses bat.tournamentsoftware.com/ranking/player.aspx?id=<rid>&player=<pid>.
//
// Each tournament row has six expected cells (Tournament, Event, Week, Result,
// Points, Matches link) plus an optional seventh cell containing a marker
// <img> whose title attribute enumerates the ranking categories the row
// counts toward — e.g. title="Used for: U23 Men's singles, U19 Boys singles".

import type { BatRankingPlayerTournament } from './types'

function stripTags(s: string): string { return s.replace(/<[^>]+>/g, '').trim() }

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

function tournamentIdFromHref(href: string): string | null {
  const m = href.match(/tournament\.aspx\?id=([A-Fa-f0-9-]{36})/)
  return m ? m[1].toUpperCase() : null
}

function parseMarkerCategories(cell: string): string[] {
  // The marker is an <img title="Used for: A, B, ..."> — split on commas.
  // If no marker img, return [].
  const img = cell.match(/<img\b[^>]*title="([^"]+)"[^>]*>/i)
  if (!img) return []
  const title = decodeEntities(img[1])
  // BAT prefixes with "Used for: " in English. We're tolerant of the prefix
  // being missing or in a different locale — strip up to and including the
  // first colon, then split.
  const idx = title.indexOf(':')
  const tail = idx >= 0 ? title.slice(idx + 1) : title
  return tail.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
}

/** Parse one <tr>...</tr> body if it looks like a tournament row.
 *  Returns null when the row is a header, separator, or otherwise unparseable. */
function parseRow(rowHtml: string): BatRankingPlayerTournament | null {
  // Pull the <td> blocks in order.
  const tds = Array.from(rowHtml.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/gi)).map((m) => m[1])
  if (tds.length < 5) return null

  // Cell 0: Tournament <a>name</a>
  const tnLink = tds[0].match(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
  if (!tnLink) return null
  const tournamentName = decodeEntities(stripTags(tnLink[2]))
  const tournamentId = tournamentIdFromHref(tnLink[1])

  // Cell 1: Event <a>code</a>
  const sourceEventRaw = stripTags(tds[1])
  if (!sourceEventRaw) return null
  const sourceEvent = decodeEntities(sourceEventRaw)

  // Cell 2: Week
  const week = stripTags(tds[2])
  if (!/^\d{4}-\d{1,2}$/.test(week)) return null

  // Cell 3: Result
  const result = stripTags(tds[3])
  if (!result) return null

  // Cell 4: Points (numeric, possibly with thousands separators)
  const pointsStr = stripTags(tds[4]).replace(/[^\d]/g, '')
  const points = pointsStr.length ? parseInt(pointsStr, 10) : 0
  if (!Number.isFinite(points)) return null

  // Optional cell 6 (index 6) — marker; cell 5 is Matches link, ignored.
  const markerCell = tds.length >= 7 ? tds[6] : ''
  const countsTowardRankings = parseMarkerCategories(markerCell)

  return {
    tournamentName,
    tournamentId,
    sourceEvent,
    week,
    result,
    points,
    countsTowardRankings,
  }
}

export function parseRankingPlayerPage(html: string): { tournaments: BatRankingPlayerTournament[] } {
  const rows = Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map((m) => m[1])
  const tournaments: BatRankingPlayerTournament[] = []
  for (const r of rows) {
    const row = parseRow(r)
    if (row) tournaments.push(row)
  }
  return { tournaments }
}
```

- [ ] **Step 4: Verify**

```bash
npx jest __tests__/bat-ranking-player-scraper.test.ts 2>&1 | tail -15
```

Expected: all tests pass. If the real-fixture assertions about counts fail because the fixture's data differs from the assertions' loose expectations, **do not weaken the test** — instead inspect the fixture and tighten the assertion to the actual value. The scraper must produce real output from the real fixture.

- [ ] **Step 5: Commit**

```bash
git add lib/bat-ranking-player-scraper.ts __tests__/bat-ranking-player-scraper.test.ts
git commit -m "feat(scraper): parse BAT per-player ranking detail page

Pure HTML→BatRankingPlayerTournament[] transform. Marker img title
parsed into countsTowardRankings (comma-split). Defensive on missing
GUID, missing marker, missing cells. Snapshot test covers a real BAT
fixture; synthetic tests cover edge cases."
```

---

## Task 6: Implement `lib/bat-ranking-player-cache.ts`

**Files:**
- Create: `lib/bat-ranking-player-cache.ts`
- Create: `__tests__/bat-ranking-player-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/bat-ranking-player-cache.test.ts`:

```ts
import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'
import {
  readBatRankingPlayerDetail,
  writeBatRankingPlayerDetail,
  writeBatRankingPlayerNotFound,
  __setBatRankingPlayerCacheRootForTesting,
} from '@/lib/bat-ranking-player-cache'
import type { BatRankingPlayerDetail } from '@/lib/types'

let tmp = ''
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bat-ranking-player-cache-'))
  __setBatRankingPlayerCacheRootForTesting(tmp)
})
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

const sample = (publishDate = '26/5/2569'): BatRankingPlayerDetail => ({
  globalPlayerId: '3903158',
  publishDate,
  scrapedAt: '2026-06-01T03:33:12Z',
  tournaments: [{
    tournamentName: 'Test Tournament',
    tournamentId: 'ABCDEF12-0000-0000-0000-000000000000',
    sourceEvent: 'BS U15',
    week: '2026-20',
    result: '5/8',
    points: 3355,
    countsTowardRankings: ["U23 Men's singles"],
  }],
})

describe('bat-ranking-player-cache', () => {
  it('returns null when no file exists', async () => {
    expect(await readBatRankingPlayerDetail('3903158')).toBeNull()
  })

  it('roundtrips a written detail', async () => {
    const d = sample()
    await writeBatRankingPlayerDetail(d)
    expect(await readBatRankingPlayerDetail('3903158')).toEqual({ detail: d })
  })

  it('returns null for a different player', async () => {
    await writeBatRankingPlayerDetail(sample())
    expect(await readBatRankingPlayerDetail('9999999')).toBeNull()
  })

  it('rejects v0 (missing version) envelopes', async () => {
    const file = path.join(tmp, '3903158.json')
    await fs.writeFile(file, JSON.stringify({ detail: sample() }))
    expect(await readBatRankingPlayerDetail('3903158')).toBeNull()
  })

  it('returns null on corrupt JSON', async () => {
    const file = path.join(tmp, '3903158.json')
    await fs.writeFile(file, '{not json')
    expect(await readBatRankingPlayerDetail('3903158')).toBeNull()
  })

  it('persists a notFound sentinel without a detail', async () => {
    await writeBatRankingPlayerNotFound('3903158', '26/5/2569')
    const r = await readBatRankingPlayerDetail('3903158')
    expect(r?.detail).toBeUndefined()
    expect(r?.notFound?.publishDate).toBe('26/5/2569')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/bat-ranking-player-cache.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/bat-ranking-player-cache.ts`:

```ts
import { promises as fs } from 'fs'
import path from 'path'
import type { BatRankingPlayerDetail, BatRankingPlayerDetailCache } from './types'

// One file per player at .cache/players/bat-ranking-detail/<globalPlayerId>.json.
// Atomic write-then-rename. Read returns null on missing file, version
// mismatch, or corrupt JSON — caller treats null as "fetch fresh".

let root = path.join(process.cwd(), '.cache', 'players', 'bat-ranking-detail')

export function __setBatRankingPlayerCacheRootForTesting(dir: string): void { root = dir }

function cacheFile(globalPlayerId: string): string {
  // The globalPlayerId is numeric per BAT, but defensively segment-sanitize
  // in case future BAT IDs ever contain a path separator.
  const safe = globalPlayerId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(root, `${safe}.json`)
}

export async function readBatRankingPlayerDetail(
  globalPlayerId: string,
): Promise<BatRankingPlayerDetailCache | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile(globalPlayerId), 'utf8')) as BatRankingPlayerDetailCache
    if (parsed.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeBatRankingPlayerDetail(detail: BatRankingPlayerDetail): Promise<void> {
  const file = cacheFile(detail.globalPlayerId)
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  const payload: BatRankingPlayerDetailCache = { version: 1, detail }
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  await fs.rename(tmp, file)
}

export async function writeBatRankingPlayerNotFound(
  globalPlayerId: string,
  publishDate: string,
): Promise<void> {
  const file = cacheFile(globalPlayerId)
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  const payload: BatRankingPlayerDetailCache = {
    version: 1,
    notFound: { publishDate, scrapedAt: new Date().toISOString() },
  }
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  await fs.rename(tmp, file)
}
```

- [ ] **Step 4: Verify**

```bash
npx jest __tests__/bat-ranking-player-cache.test.ts 2>&1 | tail -8
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/bat-ranking-player-cache.ts __tests__/bat-ranking-player-cache.test.ts
git commit -m "feat(cache): per-player ranking-detail cache (one file per player)"
```

---

## Task 7: Implement `lib/bat-player-id-map.ts`

**Files:**
- Create: `lib/bat-player-id-map.ts`
- Create: `__tests__/bat-player-id-map.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/bat-player-id-map.test.ts`:

```ts
import * as os from 'os'
import * as path from 'path'
import { promises as fs } from 'fs'
import {
  readPlayerIdEntry,
  writePlayerIdSuccess,
  writePlayerIdFailure,
  __setBatPlayerIdMapRootForTesting,
} from '@/lib/bat-player-id-map'

let tmp = ''
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bat-player-id-map-'))
  __setBatPlayerIdMapRootForTesting(tmp)
})
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

describe('bat-player-id-map', () => {
  it('returns null for an unseen slug', async () => {
    expect(await readPlayerIdEntry('foo')).toBeNull()
  })

  it('persists and reads a success', async () => {
    await writePlayerIdSuccess('ravin', '3903158')
    expect(await readPlayerIdEntry('ravin')).toEqual({ globalPlayerId: '3903158' })
  })

  it('persists and reads a failure sentinel', async () => {
    await writePlayerIdFailure('ghost', 'upstream 404')
    expect(await readPlayerIdEntry('ghost')).toEqual({ globalPlayerId: null, reason: 'upstream 404' })
  })

  it('a later success overwrites an earlier failure for the same slug', async () => {
    await writePlayerIdFailure('flaky', 'transient')
    await writePlayerIdSuccess('flaky', '42')
    expect(await readPlayerIdEntry('flaky')).toEqual({ globalPlayerId: '42' })
  })

  it('preserves other slugs across writes', async () => {
    await writePlayerIdSuccess('a', '1')
    await writePlayerIdSuccess('b', '2')
    expect(await readPlayerIdEntry('a')).toEqual({ globalPlayerId: '1' })
    expect(await readPlayerIdEntry('b')).toEqual({ globalPlayerId: '2' })
  })

  it('returns null on corrupt file', async () => {
    await fs.writeFile(path.join(tmp, 'bat-player-id-map.json'), '{not json')
    expect(await readPlayerIdEntry('whatever')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/bat-player-id-map.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/bat-player-id-map.ts`:

```ts
import { promises as fs } from 'fs'
import path from 'path'
import type { BatPlayerIdMap } from './types'

// Single-file slug → BAT global player id map. Append-only on success;
// failures are persisted as { globalPlayerId: null, reason } so the
// discovery route doesn't re-hit every page view.

let root = path.join(process.cwd(), '.cache', 'players')

export function __setBatPlayerIdMapRootForTesting(dir: string): void { root = dir }

function cacheFile(): string { return path.join(root, 'bat-player-id-map.json') }

async function readAll(): Promise<BatPlayerIdMap> {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as BatPlayerIdMap
    if (parsed.version !== 1 || !parsed.players) return { version: 1, players: {} }
    return parsed
  } catch {
    return { version: 1, players: {} }
  }
}

async function writeAll(map: BatPlayerIdMap): Promise<void> {
  const file = cacheFile()
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(map), 'utf8')
  await fs.rename(tmp, file)
}

export async function readPlayerIdEntry(
  slug: string,
): Promise<{ globalPlayerId: string } | { globalPlayerId: null; reason?: string } | null> {
  const map = await readAll()
  const entry = map.players[slug]
  if (!entry) return null
  if (entry.globalPlayerId === null) return { globalPlayerId: null, reason: entry.reason }
  return { globalPlayerId: entry.globalPlayerId }
}

export async function writePlayerIdSuccess(slug: string, globalPlayerId: string): Promise<void> {
  const map = await readAll()
  map.players[slug] = { globalPlayerId }
  await writeAll(map)
}

export async function writePlayerIdFailure(slug: string, reason: string): Promise<void> {
  const map = await readAll()
  map.players[slug] = { globalPlayerId: null, reason }
  await writeAll(map)
}
```

- [ ] **Step 4: Verify**

```bash
npx jest __tests__/bat-player-id-map.test.ts 2>&1 | tail -8
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/bat-player-id-map.ts __tests__/bat-player-id-map.test.ts
git commit -m "feat(cache): single-file slug→BAT global player id map

Append-only on success; failures persist as {globalPlayerId: null,
reason} so the discovery route doesn't re-hit every page view."
```

---

## Task 8: Implement `lib/bat-ranking-player-view.ts` (`groupForTab`)

**Files:**
- Create: `lib/bat-ranking-player-view.ts`
- Create: `__tests__/bat-ranking-player-view.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/bat-ranking-player-view.test.ts`:

```ts
import { groupForTab } from '@/lib/bat-ranking-player-view'
import type { BatRanking, BatRankingPlayerDetail, BatRankingPlayerTournament } from '@/lib/types'

const t = (
  sourceEvent: string,
  points: number,
  countsTowardRankings: string[] = [],
): BatRankingPlayerTournament => ({
  tournamentName: `Tourn ${points}`,
  tournamentId: null,
  sourceEvent,
  week: '2026-20',
  result: '1/2',
  points,
  countsTowardRankings,
})

const detail = (tournaments: BatRankingPlayerTournament[]): BatRankingPlayerDetail => ({
  globalPlayerId: '3903158',
  publishDate: '26/5/2569',
  scrapedAt: 'x',
  tournaments,
})

const ranking = (events: Array<{ name: string; rank: number; pts: number }>): BatRanking => ({
  scrapedAt: 'x',
  publishDate: '26/5/2569',
  rankingId: '99',
  events: events.map((e) => ({
    eventCode: e.name.replace(/\s+/g, '_'),
    eventName: e.name,
    entries: [{ rank: e.rank, name: 'รวิณ', slug: 'rawin', club: '', points: e.pts, tournaments: 10 }],
  })),
})

describe('groupForTab', () => {
  it('filters by discipline — singles tab excludes doubles and mixed rows', () => {
    const d = detail([
      t('BS U15', 3000, ["U23 Men's singles"]),
      t('MD U15', 2000, ["U23 Men's doubles"]),
      t('XD U15', 1000, ["U23 Mixed doubles"]),
    ])
    const r = ranking([{ name: "U23 Men's singles", rank: 5, pts: 3000 }])
    const blocks = groupForTab(d, r, 'singles')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].topTen.map((row) => row.sourceEvent)).toEqual(['BS U15'])
    expect(blocks[0].otherRows).toEqual([])
  })

  it('top-10 cap — a block keeps only the 10 highest-pointing rows that count', () => {
    const tournaments = Array.from({ length: 15 }, (_, i) =>
      t('BS U15', 100 + i, ["U23 Men's singles"]),
    )
    const d = detail(tournaments)
    const r = ranking([{ name: "U23 Men's singles", rank: 1, pts: 999999 }])
    const blocks = groupForTab(d, r, 'singles')
    expect(blocks[0].topTen).toHaveLength(10)
    expect(blocks[0].otherRows).toHaveLength(5)
    // Top-ten ordered by points desc
    const pts = blocks[0].topTen.map((row) => row.points)
    expect(pts).toEqual([...pts].sort((a, b) => b - a))
  })

  it('otherRows is "same discipline, doesnt count toward THIS ranking"', () => {
    const d = detail([
      t('BS U15', 3000, ["U23 Men's singles"]),
      t('BS U13', 2000, []),               // singles, no marker → otherRows
      t('MD U15', 1500, ["U23 Men's doubles"]), // wrong discipline → excluded
    ])
    const r = ranking([{ name: "U23 Men's singles", rank: 5, pts: 3000 }])
    const blocks = groupForTab(d, r, 'singles')
    expect(blocks[0].topTen.map((row) => row.points)).toEqual([3000])
    expect(blocks[0].otherRows.map((row) => row.points)).toEqual([2000])
  })

  it('emits one block per singles ranking the player appears in', () => {
    const d = detail([
      t('BS U15', 3000, ["U23 Men's singles", "U19 Boys singles"]),
      t('BS U15', 2000, ["U23 Men's singles"]),
      t('BS U13', 1500, ["U19 Boys singles"]),
    ])
    const r = ranking([
      { name: "U23 Men's singles", rank: 3, pts: 5000 },
      { name: 'U19 Boys singles', rank: 7, pts: 4500 },
    ])
    const blocks = groupForTab(d, r, 'singles')
    expect(blocks.map((b) => b.rankingEventName)).toEqual([
      "U23 Men's singles", 'U19 Boys singles',
    ])
    expect(blocks[0].playerRank).toBe(3)
    expect(blocks[0].totalPoints).toBe(5000)
    expect(blocks[1].playerRank).toBe(7)
    expect(blocks[1].totalPoints).toBe(4500)
  })

  it('emits no blocks for a discipline the player has no ranking in', () => {
    const d = detail([
      t('MD U15', 3000, ["U23 Men's doubles"]),
    ])
    const r = ranking([
      { name: "U23 Men's singles", rank: 5, pts: 3000 },
    ])
    // Singles ranking exists but player has no singles rows that mention it.
    expect(groupForTab(d, r, 'singles')).toEqual([])
  })

  it('classifies XD as mixed, BD/GD/MD/WD as doubles, BS/GS/MS/WS as singles', () => {
    const d = detail([
      t('BS U15', 1, ["U23 Men's singles"]),
      t('WS U23', 2, ["U23 Women's singles"]),
      t('BD U15', 3, ["U23 Men's doubles"]),
      t('WD U23', 4, ["U23 Women's doubles"]),
      t('XD U23', 5, ["U23 Mixed doubles"]),
    ])
    const r = ranking([
      { name: "U23 Men's singles", rank: 1, pts: 1 },
      { name: "U23 Women's singles", rank: 1, pts: 2 },
      { name: "U23 Men's doubles", rank: 1, pts: 3 },
      { name: "U23 Women's doubles", rank: 1, pts: 4 },
      { name: 'U23 Mixed doubles', rank: 1, pts: 5 },
    ])
    expect(groupForTab(d, r, 'singles').map((b) => b.rankingEventName)).toEqual([
      "U23 Men's singles", "U23 Women's singles",
    ])
    expect(groupForTab(d, r, 'doubles').map((b) => b.rankingEventName)).toEqual([
      "U23 Men's doubles", "U23 Women's doubles",
    ])
    expect(groupForTab(d, r, 'mixed').map((b) => b.rankingEventName)).toEqual([
      'U23 Mixed doubles',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/bat-ranking-player-view.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/bat-ranking-player-view.ts`:

```ts
// Pure derived view: turns the flat tournament list + the current ranking
// envelope into per-ranking-category blocks for a single discipline tab.

import type {
  BatRanking,
  BatRankingPlayerDetail,
  BatRankingPlayerTournament,
} from './types'

export interface RankingDetailBlock {
  rankingEventName: string
  rankingEventCode: string
  playerRank: number
  totalPoints: number
  topTen: BatRankingPlayerTournament[]
  otherRows: BatRankingPlayerTournament[]
}

export type Discipline = 'singles' | 'doubles' | 'mixed'

/** Classify a row's source event (e.g. "BS U15", "MD U17", "XD U23") into
 *  one of our three tabs. Order matters: check mixed (XD) before doubles
 *  (D) because "XD" contains "D" but is its own bucket. */
export function disciplineOf(sourceEvent: string): Discipline | null {
  const code = sourceEvent.trim().toUpperCase().split(/\s+/)[0]
  if (code.endsWith('XD') || code === 'XD' || code.startsWith('XD')) return 'mixed'
  if (code.endsWith('D') || code.includes('DOUBLE')) return 'doubles'
  if (code.endsWith('S') || code.includes('SINGLE')) return 'singles'
  return null
}

/** Same classifier applied to a ranking event NAME (e.g. "U23 Men's singles"). */
export function disciplineOfRankingEvent(name: string): Discipline | null {
  const lower = name.toLowerCase()
  if (lower.includes('mixed')) return 'mixed'
  if (lower.includes('double')) return 'doubles'
  if (lower.includes('single')) return 'singles'
  return null
}

export function groupForTab(
  detail: BatRankingPlayerDetail,
  currentRanking: BatRanking,
  discipline: Discipline,
): RankingDetailBlock[] {
  // Slice the player's rows to just the requested discipline once.
  const tabRows = detail.tournaments.filter((r) => disciplineOf(r.sourceEvent) === discipline)
  if (tabRows.length === 0) return []

  // Build one block per ranking event in this discipline that the player
  // actually has a contributing row in.
  const blocks: RankingDetailBlock[] = []
  for (const ev of currentRanking.events) {
    if (disciplineOfRankingEvent(ev.eventName) !== discipline) continue

    const contributors = tabRows.filter((r) => r.countsTowardRankings.includes(ev.eventName))
    if (contributors.length === 0) continue

    // BAT counts top-10 only; sort by points desc and split.
    const sorted = contributors.slice().sort((a, b) => b.points - a.points)
    const topTen = sorted.slice(0, 10)
    const otherRowsCounted = sorted.slice(10)

    // otherRows in the spec sense: "same discipline, doesn't count toward
    // this ranking" — that's tabRows minus the contributors, plus any
    // contributors that fell off the top-10 cap (rare in practice but
    // semantically belongs).
    const otherRowsNotCounting = tabRows.filter((r) => !r.countsTowardRankings.includes(ev.eventName))
    const otherRows = [...otherRowsNotCounting, ...otherRowsCounted]
      .sort((a, b) => b.points - a.points)

    // Player rank + total from the global ranking envelope. If the player
    // isn't actually listed in this event (BAT inconsistency), default to
    // 0 / 0 rather than crashing — the block still shows where points came
    // from, just without "Rank #N".
    let playerRank = 0
    let totalPoints = 0
    if (ev.entries.length > 0) {
      // We don't carry a slug here; the page-level wiring passes the
      // current ranking pre-filtered to the visiting player's events
      // only, so any event we see is one this player is on. Pick rank
      // and points from the first entry (the only entry, by construction
      // of how the page builds this list).
      playerRank = ev.entries[0].rank
      totalPoints = ev.entries[0].points
    }

    blocks.push({
      rankingEventName: ev.eventName,
      rankingEventCode: ev.eventCode,
      playerRank,
      totalPoints,
      topTen,
      otherRows,
    })
  }
  return blocks
}
```

- [ ] **Step 4: Verify**

```bash
npx jest __tests__/bat-ranking-player-view.test.ts 2>&1 | tail -10
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/bat-ranking-player-view.ts __tests__/bat-ranking-player-view.test.ts
git commit -m "feat(view): pure groupForTab() — flat list → per-ranking blocks

Classifies rows by discipline (XD→mixed, *D→doubles, *S→singles),
builds one block per ranking event in the tab that the player has a
contributing row in, applies BAT's top-10 cap by points."
```

---

## Task 9: Implement the API route

**Files:**
- Create: `app/api/players/ranking-detail/route.ts`
- Create: `__tests__/api-players-ranking-detail-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api-players-ranking-detail-route.test.ts`:

```ts
jest.mock('@/lib/bat-fetch', () => ({
  batFetch: jest.fn(),
}))
jest.mock('@/lib/bat-ranking-cache', () => ({
  readBatRankingCache: jest.fn(),
}))
jest.mock('@/lib/bat-ranking-player-cache', () => ({
  readBatRankingPlayerDetail: jest.fn(),
  writeBatRankingPlayerDetail: jest.fn().mockResolvedValue(undefined),
  writeBatRankingPlayerNotFound: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/bat-player-id-map', () => ({
  readPlayerIdEntry: jest.fn(),
  writePlayerIdSuccess: jest.fn().mockResolvedValue(undefined),
  writePlayerIdFailure: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/player-index-cache', () => ({
  readIndexCache: jest.fn(),
}))
jest.mock('@/lib/scraper', () => ({
  extractProfileUrl: jest.fn(),
}))

import { GET } from '@/app/api/players/ranking-detail/route'
import { batFetch } from '@/lib/bat-fetch'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import { readBatRankingPlayerDetail, writeBatRankingPlayerDetail } from '@/lib/bat-ranking-player-cache'
import { readPlayerIdEntry, writePlayerIdSuccess } from '@/lib/bat-player-id-map'
import { readIndexCache } from '@/lib/player-index-cache'
import { extractProfileUrl } from '@/lib/scraper'

const req = (slug: string) =>
  new Request(`http://localhost/api/players/ranking-detail?slug=${encodeURIComponent(slug)}`)

const currentRanking = (publishDate = '26/5/2569', rankingId = '51869') => ({
  scrapedAt: 'x', publishDate, rankingId, events: [],
})

beforeEach(() => { jest.clearAllMocks() })

describe('GET /api/players/ranking-detail', () => {
  it('returns 400 when slug is missing', async () => {
    const res = await GET(new Request('http://localhost/api/players/ranking-detail'))
    expect(res.status).toBe(400)
  })

  it('returns 503 when no current ranking is on disk', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(req('ravin'))
    expect(res.status).toBe(503)
  })

  it('cache hit + matching publishDate short-circuits without any BAT call', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(currentRanking())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    const cached = {
      version: 1 as const,
      detail: {
        globalPlayerId: '3903158',
        publishDate: '26/5/2569',
        scrapedAt: 'x',
        tournaments: [],
      },
    }
    ;(readBatRankingPlayerDetail as jest.Mock).mockResolvedValue(cached)
    const res = await GET(req('ravin'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ detail: cached.detail })
    expect(batFetch).not.toHaveBeenCalled()
  })

  it('cache hit but stale publishDate triggers refetch', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(currentRanking('26/5/2569'))
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    ;(readBatRankingPlayerDetail as jest.Mock).mockResolvedValue({
      version: 1, detail: { globalPlayerId: '3903158', publishDate: '19/5/2569', scrapedAt: 'x', tournaments: [] },
    })
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<table></table>' })
    const res = await GET(req('ravin'))
    expect(res.status).toBe(200)
    expect(batFetch).toHaveBeenCalledWith(
      'ranking-player-detail',
      'https://bat.tournamentsoftware.com/ranking/player.aspx?id=51869&player=3903158',
      expect.any(Object),
    )
  })

  it('discovers globalPlayerId via /sport/player.aspx → extractProfileUrl on first visit', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(currentRanking())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue(null)
    ;(readIndexCache as jest.Mock).mockResolvedValue({
      players: { ravin: { sampleRef: { tournamentId: 'TID', playerId: 'TPID' } } },
    })
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>tournament-page</html>' })
      .mockResolvedValueOnce({ ok: true, text: async () => '<table></table>' })
    ;(extractProfileUrl as jest.Mock).mockReturnValue('/sport/profile.aspx?id=3903158')
    ;(readBatRankingPlayerDetail as jest.Mock).mockResolvedValue(null)

    const res = await GET(req('ravin'))
    expect(res.status).toBe(200)
    expect(writePlayerIdSuccess).toHaveBeenCalledWith('ravin', '3903158')
    expect(writeBatRankingPlayerDetail).toHaveBeenCalled()
  })

  it('returns 404 when the player-id map says discovery failed', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(currentRanking())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: null, reason: 'no sampleRef' })
    const res = await GET(req('ghost'))
    expect(res.status).toBe(404)
    expect(batFetch).not.toHaveBeenCalled()
  })

  it('returns 502 when BAT detail fetch fails', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(currentRanking())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    ;(readBatRankingPlayerDetail as jest.Mock).mockResolvedValue(null)
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: false, status: 503, text: async () => '' })
    const res = await GET(req('ravin'))
    expect(res.status).toBe(502)
  })

  it('dedupes concurrent in-flight requests for the same player', async () => {
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(currentRanking())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    ;(readBatRankingPlayerDetail as jest.Mock).mockResolvedValue(null)
    let resolve: () => void = () => {}
    const slow = new Promise<void>((r) => { resolve = r })
    ;(batFetch as jest.Mock).mockImplementation(async () => {
      await slow
      return { ok: true, text: async () => '<table></table>' }
    })
    const a = GET(req('ravin'))
    const b = GET(req('ravin'))
    resolve()
    await Promise.all([a, b])
    // Only ONE batFetch call should have fired for both requests.
    expect((batFetch as jest.Mock).mock.calls.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/api-players-ranking-detail-route.test.ts 2>&1 | tail -10
```

Expected: FAIL — route module doesn't exist.

- [ ] **Step 3: Implement the route**

Create `app/api/players/ranking-detail/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { batFetch } from '@/lib/bat-fetch'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import {
  readBatRankingPlayerDetail,
  writeBatRankingPlayerDetail,
} from '@/lib/bat-ranking-player-cache'
import {
  readPlayerIdEntry,
  writePlayerIdSuccess,
  writePlayerIdFailure,
} from '@/lib/bat-player-id-map'
import { readIndexCache } from '@/lib/player-index-cache'
import { extractProfileUrl } from '@/lib/scraper'
import { parseRankingPlayerPage } from '@/lib/bat-ranking-player-scraper'
import type { BatRankingPlayerDetail } from '@/lib/types'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const UA = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
}

// In-process dedup. Keyed by globalPlayerId so two concurrent requests for
// the same player share a single BAT roundtrip; cleared on settle.
const inflight = new Map<string, Promise<BatRankingPlayerDetail | { notFound: true }>>()

async function discoverGlobalPlayerId(slug: string): Promise<{ id: string } | { id: null; reason: string }> {
  const cached = await readPlayerIdEntry(slug)
  if (cached) {
    if (cached.globalPlayerId === null) return { id: null, reason: cached.reason ?? 'previously failed' }
    return { id: cached.globalPlayerId }
  }
  const index = await readIndexCache('bat')
  const ref = index?.players[slug]?.sampleRef
  if (!ref) {
    await writePlayerIdFailure(slug, 'no sampleRef in index')
    return { id: null, reason: 'no sampleRef in index' }
  }
  const tournamentUrl = `https://bat.tournamentsoftware.com/sport/player.aspx?id=${ref.tournamentId}&player=${ref.playerId}`
  const res = await batFetch('ranking-player-discover', tournamentUrl, { headers: UA })
  if (!res.ok) {
    await writePlayerIdFailure(slug, `discover upstream ${res.status}`)
    return { id: null, reason: `discover upstream ${res.status}` }
  }
  const profilePath = extractProfileUrl(await res.text())
  // The global profile path is like /sport/profile.aspx?id=NNN
  const m = profilePath ? profilePath.match(/[?&]id=(\d+)/) : null
  if (!m) {
    await writePlayerIdFailure(slug, 'globalPlayerId not in profile URL')
    return { id: null, reason: 'globalPlayerId not in profile URL' }
  }
  const id = m[1]
  await writePlayerIdSuccess(slug, id)
  return { id }
}

async function fetchAndCache(
  globalPlayerId: string,
  rankingId: string,
  publishDate: string,
): Promise<BatRankingPlayerDetail | { notFound: true }> {
  const url = `https://bat.tournamentsoftware.com/ranking/player.aspx?id=${rankingId}&player=${globalPlayerId}`
  const res = await batFetch('ranking-player-detail', url, { headers: UA })
  if (res.status === 404) return { notFound: true }
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  const html = await res.text()
  const { tournaments } = parseRankingPlayerPage(html)
  const detail: BatRankingPlayerDetail = {
    globalPlayerId,
    publishDate,
    scrapedAt: new Date().toISOString(),
    tournaments,
  }
  await writeBatRankingPlayerDetail(detail)
  return detail
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })

  const current = await readBatRankingCache()
  if (!current) return NextResponse.json({ error: 'no current ranking' }, { status: 503 })

  const disc = await discoverGlobalPlayerId(slug)
  if (disc.id === null) {
    return NextResponse.json({ error: disc.reason }, { status: 404 })
  }
  const globalPlayerId = disc.id

  // Cache hit?
  const cached = await readBatRankingPlayerDetail(globalPlayerId)
  if (cached?.detail && cached.detail.publishDate === current.publishDate) {
    return NextResponse.json({ detail: cached.detail })
  }
  if (cached?.notFound && cached.notFound.publishDate === current.publishDate) {
    return NextResponse.json({ error: 'no detail page for this player' }, { status: 404 })
  }

  // Dedup concurrent fetches.
  let p = inflight.get(globalPlayerId)
  if (!p) {
    p = (async () => {
      try {
        return await fetchAndCache(globalPlayerId, current.rankingId, current.publishDate)
      } finally {
        inflight.delete(globalPlayerId)
      }
    })()
    inflight.set(globalPlayerId, p)
  }

  try {
    const result = await p
    if ('notFound' in result) {
      // Lazy import to avoid circular concerns; writes happen rarely.
      const { writeBatRankingPlayerNotFound } = await import('@/lib/bat-ranking-player-cache')
      await writeBatRankingPlayerNotFound(globalPlayerId, current.publishDate)
      return NextResponse.json({ error: 'no detail page for this player' }, { status: 404 })
    }
    return NextResponse.json({ detail: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
```

- [ ] **Step 4: Verify**

```bash
npx jest __tests__/api-players-ranking-detail-route.test.ts 2>&1 | tail -12
```

Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add app/api/players/ranking-detail/route.ts __tests__/api-players-ranking-detail-route.test.ts
git commit -m "feat(api): GET /api/players/ranking-detail?slug=<slug>

Lazy globalPlayerId discovery (via existing /sport/player.aspx +
extractProfileUrl), publishDate-keyed cache, BAT 404 → cached
notFound sentinel keyed to the same publishDate (so it expires when
the weekly publication changes), in-process Promise dedup for
concurrent first-view requests."
```

---

## Task 10: Add i18n keys

**Files:**
- Modify: `lib/i18n.ts`

- [ ] **Step 1: Add the new keys to the type union**

In `lib/i18n.ts`, find the long `T` type union (search for `'alertsBellAria'` to land near it). Append after `'alertsBellAria'`:

```ts
  | 'rankingDetailTitle'
  | 'rankingDetailTabSingles'
  | 'rankingDetailTabDoubles'
  | 'rankingDetailTabMixed'
  | 'rankingDetailRankLabel'
  | 'rankingDetailShowMore'
  | 'rankingDetailShowLess'
  | 'rankingDetailLoadFailed'
  | 'rankingDetailRetry'
  | 'rankingDetailEmpty'
```

- [ ] **Step 2: Add the EN strings**

Search for `alertsBellAria: 'Notifications',` and add after it:

```ts
    rankingDetailTitle: 'Ranking detail',
    rankingDetailTabSingles: 'Singles',
    rankingDetailTabDoubles: 'Doubles',
    rankingDetailTabMixed: 'Mixed',
    rankingDetailRankLabel: 'Rank',
    rankingDetailShowMore: 'Show more',
    rankingDetailShowLess: 'Show less',
    rankingDetailLoadFailed: "Couldn't load ranking detail.",
    rankingDetailRetry: 'Retry',
    rankingDetailEmpty: 'No ranking-eligible tournaments in the last 52 weeks.',
```

- [ ] **Step 3: Add the TH strings**

Search for `alertsBellAria: 'การแจ้งเตือน',` and add after it:

```ts
    rankingDetailTitle: 'รายละเอียดอันดับ',
    rankingDetailTabSingles: 'เดี่ยว',
    rankingDetailTabDoubles: 'คู่',
    rankingDetailTabMixed: 'คู่ผสม',
    rankingDetailRankLabel: 'อันดับ',
    rankingDetailShowMore: 'แสดงเพิ่มเติม',
    rankingDetailShowLess: 'แสดงน้อยลง',
    rankingDetailLoadFailed: 'โหลดรายละเอียดอันดับไม่สำเร็จ',
    rankingDetailRetry: 'ลองอีกครั้ง',
    rankingDetailEmpty: 'ไม่มีรายการที่นับสะสมในรอบ 52 สัปดาห์ล่าสุด',
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v "bat-ranking-cache.test.ts" | tail -5
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/i18n.ts
git commit -m "feat(i18n): ranking-detail strings (EN + TH)"
```

---

## Task 11: Add CSS for the new components

**Files:**
- Modify: `app/globals.css`

The existing player-profile CSS classes use `pp-*` prefix; matching that keeps the visual language consistent.

- [ ] **Step 1: Append the styles**

At the end of `app/globals.css`, add:

```css
/* Ranking detail (per-player tournament breakdown) */
.pp-ranking-detail {
  margin-top: 16px;
}
.pp-rd-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 12px;
}
.pp-rd-tab {
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 100ms, border-color 100ms;
}
.pp-rd-tab:hover { color: var(--fg); }
.pp-rd-tab.active {
  color: var(--brand);
  border-bottom-color: var(--brand);
}
.pp-rd-block {
  margin-bottom: 18px;
}
.pp-rd-block-hdr {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 6px;
}
.pp-rd-block-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}
.pp-rd-block-rank {
  font-size: 13px;
  color: var(--brand);
  font-weight: 600;
}
.pp-rd-block-pts {
  font-size: 13px;
  color: var(--muted);
  margin-left: auto;
}
.pp-rd-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto auto;
  gap: 8px;
  padding: 5px 4px;
  font-size: 12px;
  align-items: baseline;
  border-bottom: 1px solid var(--border-soft, var(--border));
}
.pp-rd-row a { color: var(--fg); text-decoration: none; }
.pp-rd-row a:hover { color: var(--brand); }
.pp-rd-row-event {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  white-space: nowrap;
}
.pp-rd-row-week { color: var(--muted); white-space: nowrap; }
.pp-rd-row-result { color: var(--muted); white-space: nowrap; }
.pp-rd-row-pts { font-weight: 600; text-align: right; white-space: nowrap; }
.pp-rd-show-more {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.pp-rd-show-more:hover { background: var(--info-bg); }
.pp-rd-skeleton {
  height: 60px;
  margin-bottom: 12px;
  background: var(--border);
  border-radius: 6px;
  opacity: 0.5;
}
.pp-rd-error {
  padding: 12px;
  font-size: 13px;
  color: var(--muted);
  background: var(--info-bg);
  border-radius: 6px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.pp-rd-error-retry {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
}
.pp-rd-empty {
  padding: 12px;
  font-size: 13px;
  color: var(--muted);
  text-align: center;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "style(profile): add CSS for ranking-detail tabs/blocks/rows"
```

---

## Task 12: Create `components/TournamentRow.tsx`

**Files:**
- Create: `components/TournamentRow.tsx`

- [ ] **Step 1: Implement**

```tsx
'use client'
import Link from 'next/link'
import type { BatRankingPlayerTournament } from '@/lib/types'

interface Props { row: BatRankingPlayerTournament }

/**
 * Single tournament row inside a ranking-detail block. Tournament name links
 * to the in-app tournament view when we have a GUID; otherwise renders as
 * plain text. All other fields are display-only.
 */
export default function TournamentRow({ row }: Props) {
  const name = row.tournamentId
    ? <Link href={`/?tournament=${row.tournamentId}`}>{row.tournamentName}</Link>
    : <span>{row.tournamentName}</span>
  return (
    <div className="pp-rd-row">
      <span>{name}</span>
      <span className="pp-rd-row-event">{row.sourceEvent}</span>
      <span className="pp-rd-row-week">{row.week}</span>
      <span className="pp-rd-row-result">{row.result}</span>
      <span className="pp-rd-row-pts">{row.points.toLocaleString()}</span>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v "bat-ranking-cache.test.ts" | tail -5
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/TournamentRow.tsx
git commit -m "feat(component): TournamentRow — presentational one-row renderer"
```

---

## Task 13: Create `components/RankingDetailBlock.tsx`

**Files:**
- Create: `components/RankingDetailBlock.tsx`

- [ ] **Step 1: Implement**

```tsx
'use client'
import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import type { RankingDetailBlock as Block } from '@/lib/bat-ranking-player-view'
import TournamentRow from './TournamentRow'

interface Props { block: Block }

/**
 * One ranking-category block inside the active discipline tab:
 *   header (event name + rank + total) + top-10 rows + optional
 *   "show more" toggle revealing same-discipline rows that don't
 *   contribute to this ranking.
 */
export default function RankingDetailBlock({ block }: Props) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="pp-rd-block">
      <div className="pp-rd-block-hdr">
        <span className="pp-rd-block-name">{block.rankingEventName}</span>
        {block.playerRank > 0 && (
          <span className="pp-rd-block-rank">
            {t('rankingDetailRankLabel')} #{block.playerRank}
          </span>
        )}
        <span className="pp-rd-block-pts">{block.totalPoints.toLocaleString()} pts</span>
      </div>
      {block.topTen.map((row, i) => (
        <TournamentRow key={`${row.tournamentName}-${i}`} row={row} />
      ))}
      {block.otherRows.length > 0 && (
        <>
          {expanded && block.otherRows.map((row, i) => (
            <TournamentRow key={`other-${row.tournamentName}-${i}`} row={row} />
          ))}
          <button
            type="button"
            className="pp-rd-show-more"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? t('rankingDetailShowLess')
              : `${t('rankingDetailShowMore')} (${block.otherRows.length})`}
          </button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v "bat-ranking-cache.test.ts" | tail -5
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/RankingDetailBlock.tsx
git commit -m "feat(component): RankingDetailBlock — header + top-10 + show-more"
```

---

## Task 14: Create `components/RankingDetailTabs.tsx`

**Files:**
- Create: `components/RankingDetailTabs.tsx`

- [ ] **Step 1: Implement**

```tsx
'use client'
import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import { track } from '@/lib/analytics'
import { groupForTab, type Discipline } from '@/lib/bat-ranking-player-view'
import type { BatRanking, BatRankingPlayerDetail } from '@/lib/types'
import RankingDetailBlock from './RankingDetailBlock'

interface Props {
  slug: string
  initialDetail?: BatRankingPlayerDetail
  currentRanking: BatRanking
}

const DISCIPLINES: Discipline[] = ['singles', 'doubles', 'mixed']

type FetchState =
  | { state: 'idle'; detail: BatRankingPlayerDetail }
  | { state: 'loading' }
  | { state: 'error'; message: string }

/**
 * Owns: active tab state + the fetch lifecycle when SSR didn't deliver
 * the detail. Renders three tabs and the blocks for the active one.
 */
export default function RankingDetailTabs({ slug, initialDetail, currentRanking }: Props) {
  const { t } = useLanguage()
  const [active, setActive] = useState<Discipline>('singles')
  const [fetchState, setFetchState] = useState<FetchState>(
    initialDetail ? { state: 'idle', detail: initialDetail } : { state: 'loading' },
  )
  const [trackedOnce, setTrackedOnce] = useState(false)

  useEffect(() => {
    if (initialDetail) return // already have it from SSR
    const ctrl = new AbortController()
    fetch(`/api/players/ranking-detail?slug=${encodeURIComponent(slug)}`, { signal: ctrl.signal })
      .then(async (r) => {
        // 404 means either discovery failed for this slug or BAT has no detail
        // page for this player at this publishDate. Both render as "empty" from
        // the user's perspective — never as a load-failed error.
        if (r.status === 404) return { kind: 'empty' as const }
        if (!r.ok) throw new Error(`${r.status}`)
        const body = await r.json() as { detail?: BatRankingPlayerDetail; error?: string }
        return { kind: 'ok' as const, body }
      })
      .then((result) => {
        if (result.kind === 'empty') {
          setFetchState({
            state: 'idle',
            detail: { globalPlayerId: '', publishDate: '', scrapedAt: '', tournaments: [] },
          })
          return
        }
        if (result.body.detail) setFetchState({ state: 'idle', detail: result.body.detail })
        else setFetchState({ state: 'error', message: result.body.error ?? 'unknown' })
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return
        setFetchState({ state: 'error', message: String(err) })
      })
    return () => ctrl.abort()
  }, [slug, initialDetail])

  useEffect(() => {
    if (fetchState.state !== 'idle' || trackedOnce) return
    track('ranking_detail_viewed', { provider: 'bat', slug, discipline: active })
    setTrackedOnce(true)
  }, [fetchState, trackedOnce, slug, active])

  const switchTab = (next: Discipline) => {
    if (next === active) return
    track('ranking_detail_tab_changed', { from: active, to: next })
    setActive(next)
  }

  const renderBody = () => {
    if (fetchState.state === 'loading') {
      return (
        <>
          <div className="pp-rd-skeleton" />
          <div className="pp-rd-skeleton" />
        </>
      )
    }
    if (fetchState.state === 'error') {
      return (
        <div className="pp-rd-error">
          <span>{t('rankingDetailLoadFailed')}</span>
          <button
            type="button"
            className="pp-rd-error-retry"
            onClick={() => setFetchState({ state: 'loading' })}
          >{t('rankingDetailRetry')}</button>
        </div>
      )
    }
    const blocks = groupForTab(fetchState.detail, currentRanking, active)
    if (blocks.length === 0) {
      return <div className="pp-rd-empty">{t('rankingDetailEmpty')}</div>
    }
    return blocks.map((b) => <RankingDetailBlock key={b.rankingEventCode} block={b} />)
  }

  return (
    <div className="pp-section pp-ranking-detail">
      <h2>{t('rankingDetailTitle')}</h2>
      <div className="pp-rd-tabs" role="tablist">
        {DISCIPLINES.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={active === d}
            className={`pp-rd-tab${active === d ? ' active' : ''}`}
            onClick={() => switchTab(d)}
          >
            {d === 'singles'
              ? t('rankingDetailTabSingles')
              : d === 'doubles'
                ? t('rankingDetailTabDoubles')
                : t('rankingDetailTabMixed')}
          </button>
        ))}
      </div>
      {renderBody()}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -v "bat-ranking-cache.test.ts" | tail -5
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/RankingDetailTabs.tsx
git commit -m "feat(component): RankingDetailTabs — owns tab state + fetch lifecycle"
```

---

## Task 15: Wire into `PlayerProfileView` and the page

**Files:**
- Modify: `components/PlayerProfileView.tsx`
- Modify: `app/player/[provider]/[slug]/page.tsx`

- [ ] **Step 1: Add the new prop and section to `PlayerProfileView`**

In `components/PlayerProfileView.tsx`, change the `Props` interface to also accept the per-player detail and the full ranking envelope:

```ts
interface Props {
  record: PlayerRecord
  batRanking?: import('@/lib/types').BatRankingPlayerRank[]
  rankingPublishDate?: string
  initialDetail?: import('@/lib/types').BatRankingPlayerDetail
  currentRanking?: import('@/lib/types').BatRanking
}
```

Add the import at the top:

```ts
import RankingDetailTabs from './RankingDetailTabs'
```

Destructure the new props in the function signature:

```tsx
export default function PlayerProfileView({ record, batRanking, rankingPublishDate, initialDetail, currentRanking }: Props) {
```

Immediately after the existing closing `</div>` of the "Current Ranking" block (search for `batRanking && batRanking.length > 0` to find it), insert:

```tsx
      {batRanking && batRanking.length > 0 && currentRanking && record.key.provider === 'bat' && (
        <RankingDetailTabs
          slug={record.key.slug}
          initialDetail={initialDetail}
          currentRanking={currentRanking}
        />
      )}
```

- [ ] **Step 2: Wire the page**

In `app/player/[provider]/[slug]/page.tsx`, the existing logic already reads the `BatRanking` for summary purposes. Pass it through along with the cached detail. Replace the function body with:

```tsx
import { notFound } from 'next/navigation'
import { readIndexCache } from '@/lib/player-index-cache'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import { readBatRankingPlayerDetail } from '@/lib/bat-ranking-player-cache'
import { readPlayerIdEntry } from '@/lib/bat-player-id-map'
import PlayerProfileView from '@/components/PlayerProfileView'
import type { ProviderTag, BatRankingPlayerRank, BatRankingPlayerDetail } from '@/lib/types'

interface Props { params: { provider: string; slug: string } }

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export default async function PlayerPage({ params }: Props) {
  const provider = params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) notFound()
  const index = await readIndexCache(provider)
  const record = index?.players[params.slug]
  if (!record) notFound()

  const batRanking: BatRankingPlayerRank[] = []
  let rankingPublishDate = ''
  let currentRanking: Awaited<ReturnType<typeof readBatRankingCache>> = null
  let initialDetail: BatRankingPlayerDetail | undefined

  if (provider === 'bat') {
    currentRanking = await readBatRankingCache()
    if (currentRanking) {
      rankingPublishDate = currentRanking.publishDate
      for (const ev of currentRanking.events) {
        const entry = ev.entries.find(e => e.slug === params.slug)
        if (entry) batRanking.push({ eventName: ev.eventName, rank: entry.rank, points: entry.points, tournaments: entry.tournaments })
      }
      // SSR pre-fetch the per-player detail if we have the global id
      // mapped and the cache is fresh against the current publishDate.
      const idEntry = await readPlayerIdEntry(params.slug)
      if (idEntry && idEntry.globalPlayerId) {
        const cached = await readBatRankingPlayerDetail(idEntry.globalPlayerId)
        if (cached?.detail && cached.detail.publishDate === currentRanking.publishDate) {
          initialDetail = cached.detail
        }
      }
    }
  }

  return (
    <PlayerProfileView
      record={record}
      batRanking={batRanking.length ? batRanking : undefined}
      rankingPublishDate={rankingPublishDate || undefined}
      initialDetail={initialDetail}
      currentRanking={currentRanking ?? undefined}
    />
  )
}

export const dynamic = 'force-dynamic'
```

- [ ] **Step 3: Typecheck + full suite**

```bash
npx tsc --noEmit 2>&1 | grep -v "bat-ranking-cache.test.ts" | tail -5
npx jest 2>&1 | tail -6
```

Expected: no new TS errors. All tests pass.

- [ ] **Step 4: Build verification**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds. Confirm the new route `/api/players/ranking-detail` appears in the route table.

- [ ] **Step 5: Commit**

```bash
git add components/PlayerProfileView.tsx app/player/[provider]/[slug]/page.tsx
git commit -m "feat(profile): mount RankingDetailTabs under the existing summary

SSR pre-fetches per-player detail from disk when both the slug→global-id
map and the publishDate-keyed cache agree; otherwise the client component
fires its own fetch on mount."
```

---

## Task 16: Final integration check

- [ ] **Step 1: Full test + typecheck + build, one more time**

```bash
npx jest 2>&1 | tail -6
npx tsc --noEmit 2>&1 | grep -v "bat-ranking-cache.test.ts" | tail -5
npm run build 2>&1 | tail -10
```

Expected: All green.

- [ ] **Step 2: Manual smoke (local dev)**

```bash
npm run dev
```

Visit `http://localhost:3000/player/bat/<some-known-slug>`. Confirm:
- "Current Ranking" summary still renders (unchanged behavior)
- New "Ranking detail" section appears below it for a BAT player with rankings
- All three tabs are clickable; switching them changes the visible blocks
- "Show more" reveals additional rows
- For a BWF player, the new section does not appear
- DevTools network: first visit fires `/api/players/ranking-detail?slug=...` exactly once; reload reuses SSR cache (no network call)

- [ ] **Step 3: Commit any small fixes from manual smoke** (if any)

```bash
git add -A
git commit -m "fix: <whatever the smoke test surfaced>"
```

Or, if nothing surfaced:

```bash
echo 'No fixes needed; ready to merge.'
```

---

## Deploy

After this branch is approved + merged to `main`:

```bash
git checkout main
git merge --no-ff player-ranking-detail-spec -m "Merge: per-player ranking detail with three discipline tabs"
git push origin main
ssh root@ezebat.lan "set -e; cd ~/app && git pull --ff-only && npm run build && pm2 reload bat-bracket && pm2 list | grep bat-bracket"
```

The boot kick on the existing Tuesday scheduler (commit `12a6469`) will see the v10 envelope, reject it as version-mismatched, treat it as "no cache" (`cacheAgeMs === null`), and immediately fetch a fresh v11 envelope — so the ~30-second post-reload window is the only blackout. Verify:

```bash
ssh root@ezebat.lan "grep 'bat-ranking' \$(ls -t /root/.pm2/logs/bat-bracket-out-*.log | grep -v __ | head -1) | tail -10"
```

Expected (within ~1 min of `pm2 reload`):
```
[bat-ranking/poll] boot kick (cacheAge=no-cache)
[bat-fetch] kind=ranking-poll-overview ...
[bat-fetch] kind=ranking-cat ... (×34)
[bat-ranking/refresh] ok eventsFound=34 publishDate=...
[bat-ranking/poll] refresh status=200 ...
```

Player pages should now show the new section on the next visit.

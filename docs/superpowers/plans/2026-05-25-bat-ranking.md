# BAT Ranking Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the official "Badminton Thailand Junior Ranking" from `bat.tournamentsoftware.com/ranking` — show it as a new Ranking category tab in the BAT leaderboards page and show a player's current rank in their profile.

**Architecture:** Standalone ranking cache (`.cache/players/bat-ranking.json`) with independent refresh lifecycle. A scraper module parses the ranking page HTML and writes `BatRanking` to cache. The leaderboards page reads both the existing leaderboard cache and the ranking cache, then injects `category:'ranking'` boards into the BAT leaderboards before rendering. Player profile reads the same cache to show per-event ranks.

**Tech Stack:** Next.js 14 App Router, TypeScript, Jest, `batFetch` wrapper (already in `lib/bat-fetch.ts`), `nameToSlug` from `lib/playerIndex.ts`

---

## File Map

| File | Change |
|------|--------|
| `lib/types.ts` | Add `BatRankingEntry`, `BatRankingEvent`, `BatRanking`, `BatRankingPlayerRank`; extend `LeaderboardCategory` |
| `lib/bat-ranking-cache.ts` | **New** — read/write `.cache/players/bat-ranking.json` |
| `lib/bat-ranking-scraper.ts` | **New** — pure HTML → `BatRanking` transform |
| `app/api/bat-ranking/refresh/route.ts` | **New** — POST refresh endpoint |
| `app/leaderboards/page.tsx` | Read ranking cache, inject boards into BAT leaderboards |
| `components/LeaderboardsView.tsx` | Add Ranking tab to `CATEGORIES` |
| `lib/i18n.ts` | Add `lbRanking`, `currentRanking` keys to `TKey` and both dicts |
| `components/PlayerProfileView.tsx` | Accept `batRanking` prop, render Current Ranking section |
| `app/player/[provider]/[slug]/page.tsx` | Read ranking cache, pass matched entries to `PlayerProfileView` |
| `app/api/players/[provider]/[slug]/route.ts` | Include `batRanking` entries in response |
| `app/api/players/exists/route.ts` | Include `batRanking` entries in response (used by PlayerModal) |
| `components/PlayerModal.tsx` | Display Current Ranking rows when ranking data is present |
| `__tests__/bat-ranking-cache.test.ts` | **New** |
| `__tests__/bat-ranking-scraper.test.ts` | **New** |
| `__tests__/api-bat-ranking-refresh-route.test.ts` | **New** |

---

### Task 1: Add types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Extend `LeaderboardCategory` and add ranking types**

In `lib/types.ts`, make these changes:

Change line 528:
```ts
export type LeaderboardCategory = 'headline' | 'discipline' | 'character' | 'activity' | 'ranking'
```

Add after the existing `Leaderboards` interface (after line 545):
```ts
export interface BatRankingEntry {
  rank: number
  name: string
  slug: string      // nameToSlug(name) — best-effort link to BAT player index
  club: string
  points: number
}

export interface BatRankingEvent {
  eventCode: string   // e.g. "MS", "WS", "MD", "WD", "MXD"
  eventName: string   // display label, e.g. "Men's Singles"
  entries: BatRankingEntry[]
}

export interface BatRanking {
  scrapedAt: string
  publishDate: string
  events: BatRankingEvent[]
}

// Subset used when displaying a player's ranking on their profile
export interface BatRankingPlayerRank {
  eventName: string
  rank: number
  points: number
}
```

- [ ] **Step 2: Run tests to confirm nothing is broken**

```bash
npm test -- --testPathPattern="playerIndex|leaderboards" --no-coverage 2>&1 | tail -5
```
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(bat-ranking): add BatRanking types and extend LeaderboardCategory"
```

---

### Task 2: Create cache module

**Files:**
- Create: `lib/bat-ranking-cache.ts`
- Create: `__tests__/bat-ranking-cache.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/bat-ranking-cache.test.ts`:
```ts
import fs from 'fs'
import os from 'os'
import path from 'path'
import { readBatRankingCache, writeBatRankingCache, __setBatRankingRootForTesting } from '@/lib/bat-ranking-cache'
import type { BatRanking } from '@/lib/types'

const sample: BatRanking = {
  scrapedAt: '2026-05-20T10:00:00Z',
  publishDate: '2026-05-20',
  events: [
    {
      eventCode: 'MS',
      eventName: "Men's Singles",
      entries: [{ rank: 1, name: 'TEST PLAYER', slug: 'test_player', club: 'Test Club', points: 1500 }],
    },
  ],
}

describe('bat-ranking-cache', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brc-'))
    __setBatRankingRootForTesting(dir)
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('returns null when file is missing', async () => {
    expect(await readBatRankingCache()).toBeNull()
  })

  it('round-trips ranking data', async () => {
    await writeBatRankingCache(sample)
    const out = await readBatRankingCache()
    expect(out?.publishDate).toBe('2026-05-20')
    expect(out?.events[0].eventCode).toBe('MS')
    expect(out?.events[0].entries[0].slug).toBe('test_player')
  })

  it('overwrites previous data on second write', async () => {
    await writeBatRankingCache(sample)
    const updated = { ...sample, publishDate: '2026-05-27' }
    await writeBatRankingCache(updated)
    const out = await readBatRankingCache()
    expect(out?.publishDate).toBe('2026-05-27')
  })
})
```

- [ ] **Step 2: Run test to see it fail**

```bash
npm test -- --testPathPattern="bat-ranking-cache" --no-coverage 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module '@/lib/bat-ranking-cache'`

- [ ] **Step 3: Implement the cache module**

Create `lib/bat-ranking-cache.ts`:
```ts
import { promises as fs } from 'fs'
import path from 'path'
import type { BatRanking } from './types'

let root = path.join(process.cwd(), '.cache', 'players')

export function __setBatRankingRootForTesting(dir: string): void { root = dir }

function cacheFile(): string { return path.join(root, 'bat-ranking.json') }

export async function readBatRankingCache(): Promise<BatRanking | null> {
  try {
    return JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as BatRanking
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
```

- [ ] **Step 4: Run test to see it pass**

```bash
npm test -- --testPathPattern="bat-ranking-cache" --no-coverage 2>&1 | tail -5
```
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/bat-ranking-cache.ts __tests__/bat-ranking-cache.test.ts
git commit -m "feat(bat-ranking): add bat-ranking-cache read/write module"
```

---

### Task 3: Inspect ranking page HTML

This task has no code. Its purpose is to get an accurate HTML fixture for the scraper tests.

**Files:** none

- [ ] **Step 1: Fetch the ranking page and save a local HTML sample**

Run this command on the `ezebat.lan` server (or locally):
```bash
curl -s 'https://bat.tournamentsoftware.com/ranking' -o /tmp/bat-ranking.html
wc -l /tmp/bat-ranking.html
```

- [ ] **Step 2: Find the Junior Ranking section**

```bash
grep -n -i "junior\|open ranking\|Men's Singles\|Women's Singles" /tmp/bat-ranking.html | head -30
```

Note:
- What heading text identifies the "Junior Ranking" section vs "Open Ranking" section
- What HTML element and class wraps each discipline table (e.g., `<h3>`, `<table class="...">`)
- What columns appear and in what order (rank / name / club / points)
- Whether points are a separate column or computed
- What the `publishDate` looks like (e.g., "Published: Tuesday 20 May 2025")

- [ ] **Step 3: Record findings**

Before Task 4, note:
- The exact heading string for the Junior Ranking (e.g., `"Badminton Thailand Junior Ranking"`)
- The HTML tag/class that wraps each event table
- The column order in the `<thead>` row
- The publish date format

These findings drive the test HTML fixture in Task 4.

---

### Task 4: Write scraper

**Files:**
- Create: `lib/bat-ranking-scraper.ts`
- Create: `__tests__/bat-ranking-scraper.test.ts`

> **Note:** The HTML fixture below is a template based on typical TournamentSoftware structure.
> Before writing the tests, update `SAMPLE_HTML` to match what you found in Task 3.
> The scraper regex/string patterns must match your actual observations.

- [ ] **Step 1: Write failing tests**

Create `__tests__/bat-ranking-scraper.test.ts`:
```ts
import { parseBatRanking } from '@/lib/bat-ranking-scraper'

// Update this fixture to match the actual page HTML found in Task 3.
const SAMPLE_HTML = `
<html><body>
<h2>Open Ranking</h2>
<h3>Men's Singles</h3>
<table class="ruler">
<thead><tr><th>#</th><th>Member</th><th>Club</th><th>Points</th></tr></thead>
<tbody>
<tr><td>1</td><td><a href="/player/1">OPEN PLAYER</a></td><td>Open Club</td><td>5000</td></tr>
</tbody>
</table>

<h2>Badminton Thailand Junior Ranking</h2>
<p>Published: Tuesday, 20 May 2025</p>
<h3>Men's Singles</h3>
<table class="ruler">
<thead><tr><th>#</th><th>Member</th><th>Club</th><th>Points</th></tr></thead>
<tbody>
<tr><td>1</td><td><a href="/player/10">SOMCHAI JAIDEE</a></td><td>KASEMSAK BADMINTON</td><td>1500</td></tr>
<tr><td>2</td><td><a href="/player/11">ANON SOMKIAT</a></td><td>BAD CLUB</td><td>1200</td></tr>
</tbody>
</table>
<h3>Women's Singles</h3>
<table class="ruler">
<thead><tr><th>#</th><th>Member</th><th>Club</th><th>Points</th></tr></thead>
<tbody>
<tr><td>1</td><td><a href="/player/20">MALAI SRIWAN</a></td><td>SIAM SPORT</td><td>1400</td></tr>
</tbody>
</table>
</body></html>
`

describe('parseBatRanking', () => {
  it('skips the Open Ranking section and only parses Junior Ranking', () => {
    const result = parseBatRanking(SAMPLE_HTML)
    const names = result.events.flatMap(e => e.entries.map(x => x.name))
    expect(names).not.toContain('OPEN PLAYER')
    expect(names).toContain('SOMCHAI JAIDEE')
  })

  it('parses multiple events', () => {
    const result = parseBatRanking(SAMPLE_HTML)
    expect(result.events.length).toBe(2)
    expect(result.events[0].eventName).toBe("Men's Singles")
    expect(result.events[1].eventName).toBe("Women's Singles")
  })

  it('parses rank, name, club, points correctly', () => {
    const result = parseBatRanking(SAMPLE_HTML)
    const entry = result.events[0].entries[0]
    expect(entry.rank).toBe(1)
    expect(entry.name).toBe('SOMCHAI JAIDEE')
    expect(entry.club).toBe('KASEMSAK BADMINTON')
    expect(entry.points).toBe(1500)
  })

  it('computes slug via nameToSlug', () => {
    const result = parseBatRanking(SAMPLE_HTML)
    expect(result.events[0].entries[0].slug).toBe('somchai_jaidee')
  })

  it('caps entries at 50 per event', () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      `<tr><td>${i + 1}</td><td><a href="#">PLAYER ${i + 1}</a></td><td>Club</td><td>${1000 - i * 10}</td></tr>`
    ).join('\n')
    const html = `
      <h2>Badminton Thailand Junior Ranking</h2>
      <h3>Men's Singles</h3>
      <table class="ruler"><thead><tr><th>#</th><th>Member</th><th>Club</th><th>Points</th></tr></thead>
      <tbody>${rows}</tbody></table>`
    const result = parseBatRanking(html)
    expect(result.events[0].entries.length).toBe(50)
  })

  it('extracts publishDate from the page', () => {
    const result = parseBatRanking(SAMPLE_HTML)
    expect(result.publishDate).toBe('Tuesday, 20 May 2025')
  })

  it('returns empty events array when Junior Ranking section is absent', () => {
    const result = parseBatRanking('<html><body><h2>Open Ranking</h2></body></html>')
    expect(result.events).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to see them fail**

```bash
npm test -- --testPathPattern="bat-ranking-scraper" --no-coverage 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module '@/lib/bat-ranking-scraper'`

- [ ] **Step 3: Implement the scraper**

Create `lib/bat-ranking-scraper.ts`:
```ts
// Pure HTML → BatRanking transform. No I/O, no side effects.
// HTML selectors are based on Task 3 inspection. Adjust if the page structure differs.

import type { BatRanking, BatRankingEntry, BatRankingEvent } from './types'
import { nameToSlug } from './playerIndex'

const JUNIOR_SECTION_RE = /Badminton\s+Thailand\s+Junior\s+Ranking/i

// Matches a publish-date line, e.g. "Published: Tuesday, 20 May 2025"
const PUBLISH_DATE_RE = /Published[:\s]+([^\n<]{5,40})/i

// Matches an <h3>...</h3> event heading
const EVENT_HEADING_RE = /<h3[^>]*>(.*?)<\/h3>/gi

// Matches a complete <table ...>...</table> block
const TABLE_RE = /<table[^>]*>[\s\S]*?<\/table>/gi

// Matches a <tr>...</tr> inside tbody
const ROW_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/gi

// Strips all HTML tags
function stripTags(s: string): string { return s.replace(/<[^>]+>/g, '').trim() }

// Parse all <td> text values from a single row string
function parseCells(row: string): string[] {
  const cells: string[] = []
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi
  let m: RegExpExecArray | null
  while ((m = tdRe.exec(row)) !== null) cells.push(stripTags(m[1]))
  return cells
}

function parseTable(tableHtml: string): BatRankingEntry[] {
  const entries: BatRankingEntry[] = []
  const bodyMatch = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i)
  if (!bodyMatch) return entries
  const bodyHtml = bodyMatch[1]
  ROW_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ROW_RE.exec(bodyHtml)) !== null) {
    const cells = parseCells(m[1])
    if (cells.length < 4) continue
    const rank = parseInt(cells[0], 10)
    const name = cells[1].trim()
    const club = cells[2].trim()
    const points = parseInt(cells[3].replace(/[^\d]/g, ''), 10)
    if (!name || isNaN(rank)) continue
    entries.push({ rank, name, slug: nameToSlug(name), club, points: isNaN(points) ? 0 : points })
    if (entries.length >= 50) break
  }
  return entries
}

function eventCodeFromName(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('mixed')) return 'MXD'
  if (n.includes('men') && n.includes('double')) return 'MD'
  if (n.includes('women') && n.includes('double')) return 'WD'
  if (n.includes('men')) return 'MS'
  if (n.includes('women')) return 'WS'
  return name.replace(/\s+/g, '_').toUpperCase().slice(0, 5)
}

export function parseBatRanking(html: string): BatRanking {
  const scrapedAt = new Date().toISOString()

  // Find the publish date
  const dateMatch = PUBLISH_DATE_RE.exec(html)
  const publishDate = dateMatch ? dateMatch[1].trim() : ''

  // Find the start of the Junior Ranking section
  const juniorMatch = JUNIOR_SECTION_RE.exec(html)
  if (!juniorMatch) return { scrapedAt, publishDate, events: [] }
  const juniorHtml = html.slice(juniorMatch.index)

  // Collect alternating (heading, table) pairs from the junior section
  const events: BatRankingEvent[] = []

  // Collect all headings and their positions
  const headings: Array<{ name: string; pos: number }> = []
  EVENT_HEADING_RE.lastIndex = 0
  let hm: RegExpExecArray | null
  while ((hm = EVENT_HEADING_RE.exec(juniorHtml)) !== null) {
    headings.push({ name: stripTags(hm[1]), pos: hm.index + hm[0].length })
  }

  // Collect all tables and their positions
  const tables: Array<{ html: string; pos: number }> = []
  TABLE_RE.lastIndex = 0
  let tm: RegExpExecArray | null
  while ((tm = TABLE_RE.exec(juniorHtml)) !== null) {
    tables.push({ html: tm[0], pos: tm.index })
  }

  // Pair each heading with the first table that comes after it
  for (const heading of headings) {
    const table = tables.find(t => t.pos > heading.pos)
    if (!table) continue
    const entries = parseTable(table.html)
    if (entries.length === 0) continue
    events.push({
      eventCode: eventCodeFromName(heading.name),
      eventName: heading.name,
      entries,
    })
  }

  return { scrapedAt, publishDate, events }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern="bat-ranking-scraper" --no-coverage 2>&1 | tail -10
```
Expected: all pass. If any fail due to HTML fixture mismatch, update `SAMPLE_HTML` in the test file to match the actual page structure found in Task 3, and adjust the regex patterns in the scraper accordingly.

- [ ] **Step 5: Commit**

```bash
git add lib/bat-ranking-scraper.ts __tests__/bat-ranking-scraper.test.ts
git commit -m "feat(bat-ranking): add bat-ranking-scraper HTML parser"
```

---

### Task 5: Create refresh API route

**Files:**
- Create: `app/api/bat-ranking/refresh/route.ts`
- Create: `__tests__/api-bat-ranking-refresh-route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/api-bat-ranking-refresh-route.test.ts`:
```ts
jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/bat-ranking-cache', () => ({ writeBatRankingCache: jest.fn() }))
jest.mock('../lib/bat-ranking-scraper', () => ({ parseBatRanking: jest.fn() }))

import { batFetch } from '@/lib/bat-fetch'
import { writeBatRankingCache } from '@/lib/bat-ranking-cache'
import { parseBatRanking } from '@/lib/bat-ranking-scraper'
import { POST } from '@/app/api/bat-ranking/refresh/route'

const SAMPLE_RANKING = {
  scrapedAt: '2026-05-20T10:00:00Z',
  publishDate: '2026-05-20',
  events: [{ eventCode: 'MS', eventName: "Men's Singles", entries: [] }],
}

describe('POST /api/bat-ranking/refresh', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('returns 200 with eventsFound on success', async () => {
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<html>…</html>' })
    ;(parseBatRanking as jest.Mock).mockReturnValue(SAMPLE_RANKING)
    ;(writeBatRankingCache as jest.Mock).mockResolvedValue(undefined)

    const res = await POST(new Request('http://localhost/api/bat-ranking/refresh', { method: 'POST' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.eventsFound).toBe(1)
    expect(json.scrapedAt).toBe('2026-05-20T10:00:00Z')
  })

  it('returns 502 when batFetch fails', async () => {
    ;(batFetch as jest.Mock).mockResolvedValue({ ok: false, status: 503, text: async () => '' })
    const res = await POST(new Request('http://localhost/api/bat-ranking/refresh', { method: 'POST' }))
    expect(res.status).toBe(502)
  })

  it('returns 502 when batFetch throws', async () => {
    ;(batFetch as jest.Mock).mockRejectedValue(new Error('timeout'))
    const res = await POST(new Request('http://localhost/api/bat-ranking/refresh', { method: 'POST' }))
    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 2: Run tests to see them fail**

```bash
npm test -- --testPathPattern="api-bat-ranking" --no-coverage 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module '@/app/api/bat-ranking/refresh/route'`

- [ ] **Step 3: Create the route**

```bash
mkdir -p app/api/bat-ranking/refresh
```

Create `app/api/bat-ranking/refresh/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { batFetch } from '@/lib/bat-fetch'
import { parseBatRanking } from '@/lib/bat-ranking-scraper'
import { writeBatRankingCache } from '@/lib/bat-ranking-cache'

const BAT_RANKING_URL = 'https://bat.tournamentsoftware.com/ranking'

export async function POST(_req: Request) {
  try {
    const res = await batFetch('ranking', BAT_RANKING_URL)
    if (!res.ok) {
      console.log(`[bat-ranking/refresh] upstream error status=${res.status}`)
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 })
    }
    const html = await res.text()
    const ranking = parseBatRanking(html)
    await writeBatRankingCache(ranking)
    console.log(`[bat-ranking/refresh] ok eventsFound=${ranking.events.length} publishDate=${ranking.publishDate}`)
    return NextResponse.json({ scrapedAt: ranking.scrapedAt, eventsFound: ranking.events.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[bat-ranking/refresh] error err=${msg}`)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern="api-bat-ranking" --no-coverage 2>&1 | tail -5
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/bat-ranking/refresh/route.ts __tests__/api-bat-ranking-refresh-route.test.ts
git commit -m "feat(bat-ranking): add POST /api/bat-ranking/refresh endpoint"
```

---

### Task 6: Wire ranking into leaderboards

**Files:**
- Modify: `lib/i18n.ts`
- Modify: `app/leaderboards/page.tsx`
- Modify: `components/LeaderboardsView.tsx`

- [ ] **Step 1: Add i18n keys**

In `lib/i18n.ts`:

On the `TKey` union (line 217), change:
```ts
  | 'lbHeadline' | 'lbDiscipline' | 'lbCharacter' | 'lbActivity'
```
to:
```ts
  | 'lbHeadline' | 'lbDiscipline' | 'lbCharacter' | 'lbActivity' | 'lbRanking'
  | 'currentRanking'
```

In the `en` dict, after `lbActivity: 'Activity',` (line 383), add:
```ts
    lbRanking: 'Ranking',
    currentRanking: 'Current Ranking',
```

In the `th` dict, after `lbActivity: 'กิจกรรม',` (line 566), add:
```ts
    lbRanking: 'อันดับ',
    currentRanking: 'อันดับปัจจุบัน',
```

- [ ] **Step 2: Run tests to confirm i18n compiles**

```bash
npm test -- --testPathPattern="playerIndex|leaderboards" --no-coverage 2>&1 | tail -5
```
Expected: pass.

- [ ] **Step 3: Update leaderboards page**

Replace the full contents of `app/leaderboards/page.tsx` with:
```tsx
import { readLeaderboardsCache } from '@/lib/player-index-cache'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import LeaderboardsView from '@/components/LeaderboardsView'
import type { Leaderboards, BatRankingEvent, LeaderboardEntry, LeaderboardBoard } from '@/lib/types'

const EMPTY: Leaderboards = { version: 1, provider: 'bat', generatedAt: 'never', sourceVersion: '', boards: [] }

function rankingEventToBoard(ev: BatRankingEvent): LeaderboardBoard {
  const entries: LeaderboardEntry[] = ev.entries.map(e => ({
    rank: e.rank,
    slug: e.slug,
    name: e.name,
    primaryClub: e.club,
    value: e.points,
    display: e.points.toLocaleString() + ' pts',
  }))
  return {
    id: `ranking-${ev.eventCode.toLowerCase()}`,
    titleKey: ev.eventName,
    icon: '🏸',
    category: 'ranking',
    entries,
  }
}

export default async function LeaderboardsPage() {
  const [bat, bwf, ranking] = await Promise.all([
    readLeaderboardsCache('bat'),
    readLeaderboardsCache('bwf'),
    readBatRankingCache(),
  ])

  const providers: Leaderboards[] = []

  if (bat) {
    const rankingBoards: LeaderboardBoard[] = ranking?.events.map(rankingEventToBoard) ?? []
    providers.push({ ...bat, boards: [...bat.boards, ...rankingBoards] })
  }

  if (bwf) providers.push(bwf)

  return <LeaderboardsView leaderboards={providers.length ? providers : [EMPTY]} />
}

export const dynamic = 'force-dynamic'
```

- [ ] **Step 4: Update LeaderboardsView**

In `components/LeaderboardsView.tsx`, change `CATEGORIES` (line 10–15):
```ts
const CATEGORIES: Array<{ id: LeaderboardCategory; key: TKey }> = [
  { id: 'headline', key: 'lbHeadline' },
  { id: 'discipline', key: 'lbDiscipline' },
  { id: 'character', key: 'lbCharacter' },
  { id: 'activity', key: 'lbActivity' },
  { id: 'ranking', key: 'lbRanking' },
]
```

- [ ] **Step 5: Run full test suite**

```bash
npm test --no-coverage 2>&1 | tail -10
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/i18n.ts app/leaderboards/page.tsx components/LeaderboardsView.tsx
git commit -m "feat(bat-ranking): wire ranking into leaderboards page as Ranking tab"
```

---

### Task 7: Wire ranking into player profile

**Files:**
- Modify: `app/api/players/[provider]/[slug]/route.ts`
- Modify: `app/player/[provider]/[slug]/page.tsx`
- Modify: `components/PlayerProfileView.tsx`

- [ ] **Step 1: Update player API route**

Replace `app/api/players/[provider]/[slug]/route.ts` with:
```ts
import { NextResponse } from 'next/server'
import { readIndexCache } from '@/lib/player-index-cache'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import type { ProviderTag, BatRankingPlayerRank } from '@/lib/types'

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export async function GET(_req: Request, ctx: { params: { provider: string; slug: string } }) {
  const provider = ctx.params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'unknown provider' }, { status: 400 })
  }
  const index = await readIndexCache(provider)
  if (!index) return NextResponse.json({ error: 'index not built' }, { status: 404 })
  const record = index.players[ctx.params.slug]
  if (!record) return NextResponse.json({ error: 'player not found' }, { status: 404 })

  let batRanking: BatRankingPlayerRank[] = []
  if (provider === 'bat') {
    const ranking = await readBatRankingCache()
    if (ranking) {
      for (const ev of ranking.events) {
        const entry = ev.entries.find(e => e.slug === ctx.params.slug)
        if (entry) batRanking.push({ eventName: ev.eventName, rank: entry.rank, points: entry.points })
      }
    }
  }

  return NextResponse.json({ record, indexGeneratedAt: index.generatedAt, batRanking })
}
```

- [ ] **Step 2: Update player server page**

Replace `app/player/[provider]/[slug]/page.tsx` with:
```tsx
import { notFound } from 'next/navigation'
import { readIndexCache } from '@/lib/player-index-cache'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import PlayerProfileView from '@/components/PlayerProfileView'
import type { ProviderTag, BatRankingPlayerRank } from '@/lib/types'

interface Props { params: { provider: string; slug: string } }

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export default async function PlayerPage({ params }: Props) {
  const provider = params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) notFound()
  const index = await readIndexCache(provider)
  const record = index?.players[params.slug]
  if (!record) notFound()

  let batRanking: BatRankingPlayerRank[] = []
  if (provider === 'bat') {
    const ranking = await readBatRankingCache()
    if (ranking) {
      for (const ev of ranking.events) {
        const entry = ev.entries.find(e => e.slug === params.slug)
        if (entry) batRanking.push({ eventName: ev.eventName, rank: entry.rank, points: entry.points })
      }
    }
  }

  return <PlayerProfileView record={record} batRanking={batRanking.length ? batRanking : undefined} />
}

export const dynamic = 'force-dynamic'
```

- [ ] **Step 3: Update PlayerProfileView to accept and display batRanking**

In `components/PlayerProfileView.tsx`:

Change the `Props` interface (line 6):
```ts
interface Props {
  record: PlayerRecord
  batRanking?: import('@/lib/types').BatRankingPlayerRank[]
}
```

Change the component signature (line 28):
```ts
export default function PlayerProfileView({ record, batRanking }: Props) {
```

Add this block after the closing `</div>` of the `pp-badges` section (after line 68, before `</div>` of `pp-hdr`), or as a new `pp-section` near the top of the profile — add it right before the `pp-kpi-row` div (before line 72):
```tsx
      {batRanking && batRanking.length > 0 && (
        <div className="pp-section pp-ranking-section">
          <h2>Current Ranking</h2>
          <div className="pp-ranking-list">
            {batRanking.map(r => (
              <div key={r.eventName} className="pp-ranking-row">
                <span className="pp-ranking-event">{r.eventName}</span>
                <span className="pp-ranking-pos">#{r.rank}</span>
                <span className="pp-ranking-pts">{r.points.toLocaleString()} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 4: Add CSS for ranking rows**

In `app/globals.css`, add near the end of the existing `.pp-*` rules:
```css
.pp-ranking-section { margin-bottom: 8px; }
.pp-ranking-list { display: flex; flex-direction: column; gap: 4px; }
.pp-ranking-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0; border-bottom: 1px solid var(--border);
}
.pp-ranking-event { flex: 1; font-size: 14px; }
.pp-ranking-pos { font-weight: 700; font-size: 15px; min-width: 36px; text-align: right; }
.pp-ranking-pts { font-size: 12px; color: var(--muted); min-width: 70px; text-align: right; }
```

- [ ] **Step 5: Run full test suite**

```bash
npm test --no-coverage 2>&1 | tail -10
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/api/players/[provider]/[slug]/route.ts app/player/[provider]/[slug]/page.tsx components/PlayerProfileView.tsx app/globals.css
git commit -m "feat(bat-ranking): show current ranking on BAT player profile"
```

---

### Task 8: End-to-end smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Trigger a ranking refresh**

```bash
curl -s -X POST http://localhost:3000/api/bat-ranking/refresh | jq .
```
Expected output:
```json
{ "scrapedAt": "...", "eventsFound": 5 }
```
(or however many disciplines the Junior Ranking has)

If `eventsFound` is 0, the HTML structure didn't match. Go back to Task 3, re-inspect the actual page HTML, update `SAMPLE_HTML` in the test file and the regex patterns in the scraper, then re-run Task 4.

- [ ] **Step 2: Check the leaderboards page**

Open `http://localhost:3000/leaderboards` in a browser. Confirm:
- The Ranking tab appears alongside Headline / Discipline / Character / Activity
- The Ranking tab shows cards for each discipline (Men's Singles, Women's Singles, etc.)
- Each card shows up to 50 players with name, club, and points

- [ ] **Step 3: Check a player profile**

Find a player who appears in the ranking (pick rank #1 from any event). Navigate to their profile at `/player/bat/<slug>`. Confirm:
- "Current Ranking" section appears near the top of the profile
- It shows the correct event name, rank, and points

- [ ] **Step 4: Check the player modal**

Open a tournament with live/recent matches, click a BAT player name to open the modal. Confirm:
- "Current Ranking" row appears below the "View full profile" link (only for players found in the ranking)
- Format: `🏸 Men's Singles · #12 · 1,250 pts`

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(bat-ranking): complete BAT Junior Ranking integration"
```

---

### Task 7b: Show ranking in PlayerModal

The `PlayerModal` is a quick-view overlay triggered from the match schedule. It already fetches `/api/players/exists` to resolve the player slug. We extend that endpoint to return ranking entries for BAT players, then display them in the modal.

**Files:**
- Modify: `app/api/players/exists/route.ts`
- Modify: `components/PlayerModal.tsx`
- Modify: `__tests__/api-players-exists-route.test.ts`

- [ ] **Step 1: Read the existing exists-route test to understand its mock setup**

```bash
cat __tests__/api-players-exists-route.test.ts
```

- [ ] **Step 2: Update the exists API route**

Replace `app/api/players/exists/route.ts` with:
```ts
import { NextResponse } from 'next/server'
import { readIndexCache } from '@/lib/player-index-cache'
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
import { nameToSlug } from '@/lib/playerIndex'
import type { ProviderTag, BatRankingPlayerRank } from '@/lib/types'

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export async function GET(req: Request) {
  const u = new URL(req.url)
  const provider = u.searchParams.get('provider') as ProviderTag | null
  const name = u.searchParams.get('name')
  if (!provider || !name || !PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'provider and name required' }, { status: 400 })
  }
  const slug = nameToSlug(name)
  const index = await readIndexCache(provider)
  const exists = !!index?.players[slug]

  let batRanking: BatRankingPlayerRank[] = []
  if (provider === 'bat') {
    const ranking = await readBatRankingCache()
    if (ranking) {
      for (const ev of ranking.events) {
        const entry = ev.entries.find(e => e.slug === slug)
        if (entry) batRanking.push({ eventName: ev.eventName, rank: entry.rank, points: entry.points })
      }
    }
  }

  return NextResponse.json({ exists, slug, batRanking })
}
```

- [ ] **Step 3: Add a test for the new batRanking field**

Open `__tests__/api-players-exists-route.test.ts` and add a new test inside the existing `describe` block. First check what mocks are already in place — the file mocks `player-index-cache`. Add a mock for `bat-ranking-cache` at the top, then add the test.

At the top of the file, after the existing mock for `player-index-cache`, add:
```ts
jest.mock('../lib/bat-ranking-cache', () => ({ readBatRankingCache: jest.fn() }))
import { readBatRankingCache } from '@/lib/bat-ranking-cache'
```

Add this test inside the `describe` block:
```ts
  it('returns batRanking entries for a BAT player found in ranking cache', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: { test_player: {} } })
    ;(readBatRankingCache as jest.Mock).mockResolvedValue({
      scrapedAt: 'T', publishDate: 'D',
      events: [
        { eventCode: 'MS', eventName: "Men's Singles", entries: [{ rank: 5, name: 'Test Player', slug: 'test_player', club: 'Club', points: 900 }] },
      ],
    })
    const res = await GET(new Request('http://localhost/api/players/exists?provider=bat&name=Test+Player'))
    const json = await res.json()
    expect(json.batRanking).toEqual([{ eventName: "Men's Singles", rank: 5, points: 900 }])
  })

  it('returns empty batRanking for BWF players', async () => {
    ;(readIndexCache as jest.Mock).mockResolvedValue({ players: { test_player: {} } })
    ;(readBatRankingCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/api/players/exists?provider=bwf&name=Test+Player'))
    const json = await res.json()
    expect(json.batRanking).toEqual([])
  })
```

- [ ] **Step 4: Run the exists route tests**

```bash
npm test -- --testPathPattern="api-players-exists" --no-coverage 2>&1 | tail -10
```
Expected: all pass.

- [ ] **Step 5: Update PlayerModal to store and display ranking**

In `components/PlayerModal.tsx`, change the `fullProfile` state (line 29) from:
```ts
  const [fullProfile, setFullProfile] = useState<{ slug: string; provider: ProviderTag } | null>(null)
```
to:
```ts
  const [fullProfile, setFullProfile] = useState<{ slug: string; provider: ProviderTag; batRanking: import('@/lib/types').BatRankingPlayerRank[] } | null>(null)
```

Change the fetch callback (lines 43–46) from:
```ts
      .then(d => { if (d?.exists && d?.slug) setFullProfile({ slug: d.slug, provider: p }) })
```
to:
```ts
      .then(d => { if (d?.exists && d?.slug) setFullProfile({ slug: d.slug, provider: p, batRanking: d.batRanking ?? [] }) })
```

Add the ranking display block right after the `fullProfile` link anchor (after the closing `</a>` of the `pm-full-profile-link`, around line 92):
```tsx
              {fullProfile && fullProfile.batRanking.length > 0 && (
                <div className="pm-ranking">
                  {fullProfile.batRanking.map(r => (
                    <span key={r.eventName} className="pm-ranking-row">
                      🏸 {r.eventName} · <strong>#{r.rank}</strong> · {r.points.toLocaleString()} pts
                    </span>
                  ))}
                </div>
              )}
```

- [ ] **Step 6: Add CSS for pm-ranking**

In `app/globals.css`, add after the `.pp-ranking-*` rules added in Task 7:
```css
.pm-ranking { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.pm-ranking-row { font-size: 12px; color: var(--muted); }
.pm-ranking-row strong { color: var(--fg); }
```

- [ ] **Step 7: Run full test suite**

```bash
npm test --no-coverage 2>&1 | tail -10
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add app/api/players/exists/route.ts components/PlayerModal.tsx app/globals.css __tests__/api-players-exists-route.test.ts
git commit -m "feat(bat-ranking): show current ranking in player modal"
```

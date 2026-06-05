# BWF Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add BWF Ranking to the leaderboards page and to player profiles, mirroring the existing BAT Ranking UX, by refactoring the `bat-ranking-*` modules into provider-parameterized modules under `lib/ranking/`.

**Architecture:** Move BAT-specific URL/cookie/schedule/date-format details into a `PROVIDER_CONFIG` map. Share the HTML parser, scheduler, cache shape, per-player view, and the `RankingDetailTabs` UI across BAT and BWF. The numeric `player=<id>` for BWF is captured on each `RankingEntry` during the category scrape, so BWF skips the 3-hop BAT discovery path; BWF Ranking Detail is only available for players who appear in the top-N of some BWF event (same behavior already in force for BAT players today). Instrumentation runs one weekly poll per provider — BAT on Tuesday, BWF on Wednesday — both in a Bangkok 08:00–23:00 window.

**Tech Stack:** Next.js 14 (App Router) · TypeScript · Jest (next/jest) · plain `fetch` via the existing `batFetch` wrapper · `.cache/players/` on disk · Bangkok-local cron in `instrumentation.ts`.

**Spec:** `docs/superpowers/specs/2026-06-05-bwf-ranking-design.md`

---

## File Structure

**New files**

- `lib/ranking/config.ts` — `PROVIDER_CONFIG` (URLs, headers, schedule, dateFormat) + types
- `lib/ranking/fetch.ts` — `rankingFetch(provider, kind, url)` wrapping `batFetch` and injecting provider headers
- `lib/ranking/scraper.ts` — provider-agnostic HTML parsers (`parseRankingOverview`, `parseCategoryPage`, `parseCategoryList`, `parsePublishDate`, `parseRankingId`, `eventCodeFromName`)
- `lib/ranking/cache.ts` — `readRankingCache(provider)`, `writeRankingCache(provider, data)` with on-first-miss legacy cleanup
- `lib/ranking/scheduler.ts` — `decideTick({clock, schedule})`, `decideBootKick({clock, schedule, cacheAgeMs})`
- `lib/ranking/player-view.ts` — `topRowsForTab`, `otherRowsForTab`, `computeExpiryCutoffs`, `weekKeyFromPublishDate(s, dateFormat)`, `expiringWithinWeeksCutoff(s, weeks, dateFormat)`
- `lib/ranking/player-scraper.ts` — `parseRankingPlayerPage(html)` (provider-agnostic; same shape as today's `bat-ranking-player-scraper`)
- `lib/ranking/player-cache.ts` — `readRankingPlayerDetail(provider, id)`, `writeRankingPlayerDetail(provider, detail)`, `writeRankingPlayerNotFound(provider, id, publishDate)`
- `app/api/ranking/[provider]/refresh/route.ts` — replaces `app/api/bat-ranking/refresh`
- `fixtures/ranking-overview-bwf.html` — captured `ranking.aspx?rid=186` HTML
- `fixtures/ranking-category-bwf.html` — captured `category.aspx?id=…&category=…&ps=50` HTML
- `fixtures/ranking-player-bwf.html` — captured `player.aspx?id=…&player=…` HTML
- `__tests__/ranking-scraper.test.ts` — supersedes `bat-ranking-scraper.test.ts`
- `__tests__/ranking-cache.test.ts` — supersedes `bat-ranking-cache.test.ts`
- `__tests__/ranking-scheduler.test.ts` — supersedes `bat-ranking-scheduler.test.ts`
- `__tests__/ranking-player-view.test.ts` — supersedes `bat-ranking-player-view.test.ts`
- `__tests__/ranking-player-scraper.test.ts` — supersedes `bat-ranking-player-scraper.test.ts`
- `__tests__/ranking-player-cache.test.ts` — supersedes `bat-ranking-player-cache.test.ts`
- `__tests__/api-ranking-refresh-route.test.ts` — supersedes `api-bat-ranking-refresh-route.test.ts`

**Modified files**

- `lib/types.ts` — add `Ranking`, `RankingEntry`, `RankingEvent` with `provider` field; add aliases
- `app/api/players/ranking-detail/route.ts` — accept `?provider=bat|bwf`, branch on provider
- `app/leaderboards/page.tsx` — read both ranking caches; attach to bat/bwf provider boards
- `app/player/[provider]/[slug]/page.tsx` — provider-aware ranking lookup
- `components/RankingDetailTabs.tsx` — new `provider: ProviderTag` prop
- `components/LeaderboardsView.tsx` — accept per-provider `rankingPublishDates`
- `instrumentation.ts` — start one ranking poll per provider
- `__tests__/api-players-ranking-detail-route.test.ts` — extend with provider query

**Deleted files**

- `lib/bat-ranking-scraper.ts`, `lib/bat-ranking-cache.ts`, `lib/bat-ranking-scheduler.ts`, `lib/bat-ranking-player-scraper.ts`, `lib/bat-ranking-player-cache.ts`, `lib/bat-ranking-player-view.ts`
- `app/api/bat-ranking/refresh/route.ts` (directory removed)
- `__tests__/bat-ranking-scraper.test.ts`, `__tests__/bat-ranking-cache.test.ts`, `__tests__/bat-ranking-scheduler.test.ts`, `__tests__/bat-ranking-player-cache.test.ts`, `__tests__/bat-ranking-player-scraper.test.ts`, `__tests__/bat-ranking-player-view.test.ts`, `__tests__/api-bat-ranking-refresh-route.test.ts`

**Untouched (referenced for context)**

- `lib/bat-fetch.ts` — kept as-is; `rankingFetch` calls it underneath
- `lib/bat-player-id-map.ts` — kept; BAT-only 3-hop discovery still uses it

---

## Task 1: Capture upstream fixtures

**Files:**
- Create: `fixtures/ranking-overview-bwf.html`
- Create: `fixtures/ranking-category-bwf.html`
- Create: `fixtures/ranking-player-bwf.html`

The parser tests need real upstream HTML to anchor against, so capture them once and check them in.

- [ ] **Step 1: Fetch the BWF overview page**

Run:
```bash
curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" \
  -H "Cookie: st=l=2057&exp=46542&c=1&cp=23" \
  "https://www.tournamentsoftware.com/ranking/ranking.aspx?rid=186" \
  -o fixtures/ranking-overview-bwf.html
```

Expected: file ≈150 KB. Verify with:
```bash
grep -c rankingpoints fixtures/ranking-overview-bwf.html       # expect > 100
grep -oE 'rankingdate[^<]*</span>' fixtures/ranking-overview-bwf.html | head -1
grep -oE 'category\.aspx\?id=[0-9]+' fixtures/ranking-overview-bwf.html | head -1
```

- [ ] **Step 2: Note the rankingId and one category id from the overview**

Run:
```bash
grep -oE 'category\.aspx\?id=([0-9]+)&category=([0-9]+)' fixtures/ranking-overview-bwf.html | head -1
```

Expected output shape: `category.aspx?id=52035&category=2344`. Note both numbers — the next two fetches use them.

- [ ] **Step 3: Fetch one BWF category page**

Substitute the rankingId and categoryId from Step 2:
```bash
curl -sL -A "Mozilla/5.0 ... Chrome/124.0.0.0 Safari/537.36" \
  -H "Cookie: st=l=2057&exp=46542&c=1&cp=23" \
  "https://www.tournamentsoftware.com/ranking/category.aspx?id=52035&category=2344&ps=50" \
  -o fixtures/ranking-category-bwf.html
```

Expected: file ≈70 KB. Verify:
```bash
grep -c 'class="rank"' fixtures/ranking-category-bwf.html       # expect 50
```

- [ ] **Step 4: Fetch one BWF per-player page**

Pick any numeric `player=<id>` from the category fixture:
```bash
grep -oE 'player\.aspx\?id=[0-9]+&player=[0-9]+' fixtures/ranking-category-bwf.html | head -1
```

Then fetch it (substitute the values):
```bash
curl -sL -A "Mozilla/5.0 ... Chrome/124.0.0.0 Safari/537.36" \
  -H "Cookie: st=l=2057&exp=46542&c=1&cp=23" \
  "https://www.tournamentsoftware.com/ranking/player.aspx?id=52035&player=<id>" \
  -o fixtures/ranking-player-bwf.html
```

Expected: file ≈30 KB. Verify:
```bash
grep -cE 'tournament\.aspx\?id=' fixtures/ranking-player-bwf.html  # > 0
grep -cE 'title="Used for' fixtures/ranking-player-bwf.html        # > 0
```

- [ ] **Step 5: Commit the fixtures**

```bash
git add fixtures/ranking-overview-bwf.html fixtures/ranking-category-bwf.html fixtures/ranking-player-bwf.html
git commit -m "test(fixtures): add BWF ranking page HTML captures"
```

---

## Task 2: Additive type changes in `lib/types.ts`

**Files:**
- Modify: `lib/types.ts`

Introduce the new ranking types up-front so subsequent tasks can import them without churn. Keep the old `Bat*` names as aliases for one cycle so nothing breaks before downstream tasks land.

- [ ] **Step 1: Replace the BAT ranking interfaces with generalized ones**

In `lib/types.ts`, find the block starting `export interface BatRankingEntry` and replace through `export interface BatRanking` with:

```ts
export interface RankingEntry {
  rank: number
  name: string
  slug: string
  club: string
  points: number
  tournaments: number
  /** Numeric `player=<id>` URL param scraped directly from the row link.
   *  Populated by the BWF scraper (always non-empty). BAT scraper leaves
   *  this empty and falls back to its 3-hop discovery path at detail-fetch
   *  time. */
  globalPlayerId?: string
}

export interface RankingEvent {
  eventCode: string
  eventName: string
  entries: RankingEntry[]
}

export interface Ranking {
  /** Which provider this snapshot is for. Added at v12; legacy v11 files
   *  (without `provider`) are rejected on read and repopulated by the boot
   *  kick. */
  provider: ProviderTag
  scrapedAt: string
  publishDate: string
  rankingId: string
  events: RankingEvent[]
}

// Backward-compat aliases so callers can be migrated in a follow-up task
// without a giant churn here. Remove once every site is renamed.
export type BatRankingEntry = RankingEntry
export type BatRankingEvent = RankingEvent
export type BatRanking      = Ranking
```

- [ ] **Step 2: Rename the per-player detail types similarly**

Find `BatRankingPlayerTournament`, `BatRankingPlayerDetail`, `BatRankingPlayerDetailCache`, `BatRankingPlayerRank`. Rename them by dropping the `Bat` prefix and add aliases:

```ts
export interface RankingPlayerRank {
  eventName: string
  rank: number
  points: number
  tournaments: number
}

export interface RankingPlayerTournament {
  tournamentName: string
  tournamentId: string | null
  sourceEvent: string
  week: string
  result: string
  points: number
  countsTowardRankings: string[]
}

export interface RankingPlayerDetail {
  globalPlayerId: string
  publishDate: string
  scrapedAt: string
  tournaments: RankingPlayerTournament[]
}

export interface RankingPlayerDetailCache {
  version: 1
  detail?: RankingPlayerDetail
  notFound?: { publishDate: string; scrapedAt: string }
}

export type BatRankingPlayerRank        = RankingPlayerRank
export type BatRankingPlayerTournament  = RankingPlayerTournament
export type BatRankingPlayerDetail      = RankingPlayerDetail
export type BatRankingPlayerDetailCache = RankingPlayerDetailCache
```

- [ ] **Step 3: Run TypeScript build to confirm no breaks**

Run:
```bash
npx tsc --noEmit
```

Expected: clean. (If errors appear, they are usually because the aliases above don't match a property — re-check the rename.)

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "refactor(types): rename Bat ranking types to provider-agnostic Ranking*"
```

---

## Task 3: Provider config and fetch wrapper

**Files:**
- Create: `lib/ranking/config.ts`
- Create: `lib/ranking/fetch.ts`

- [ ] **Step 1: Write `lib/ranking/config.ts`**

```ts
import type { ProviderTag } from '@/lib/types'

export interface PollSchedule {
  /** Bangkok day-of-week: 0=Sun..6=Sat. BAT=Tue=2, BWF=Wed=3. */
  dayOfWeek: number
  /** Inclusive start hour (Bangkok local). */
  startHour: number
  /** Inclusive end hour. */
  endHour: number
  /** Cache older than this on boot triggers an immediate peek regardless
   *  of day-of-week (6 days = one day of safety margin under weekly
   *  upstream cadence). */
  staleBootKickMs: number
}

export type DateFormat = 'thai-be' | 'en-gb'

export interface RankingProviderConfig {
  provider: 'bat' | 'bwf'
  overviewUrl: string
  categoryUrl: (rankingId: string, categoryId: string) => string
  playerUrl:   (rankingId: string, globalPlayerId: string) => string
  headers: Record<string, string>
  dateFormat: DateFormat
  pollSchedule: PollSchedule
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000

const BAT_BASE = 'https://bat.tournamentsoftware.com/ranking'
const BWF_BASE = 'https://www.tournamentsoftware.com/ranking'

export const PROVIDER_CONFIG: Record<'bat' | 'bwf', RankingProviderConfig> = {
  bat: {
    provider: 'bat',
    overviewUrl: `${BAT_BASE}/ranking.aspx?rid=188`,
    categoryUrl: (rid, cat) => `${BAT_BASE}/category.aspx?id=${rid}&category=${cat}&ps=50`,
    playerUrl:   (rid, pid) => `${BAT_BASE}/player.aspx?id=${rid}&player=${pid}`,
    headers: { 'User-Agent': UA },
    dateFormat: 'thai-be',
    pollSchedule: { dayOfWeek: 2, startHour: 8, endHour: 23, staleBootKickMs: SIX_DAYS_MS },
  },
  bwf: {
    provider: 'bwf',
    overviewUrl: `${BWF_BASE}/ranking.aspx?rid=186`,
    categoryUrl: (rid, cat) => `${BWF_BASE}/category.aspx?id=${rid}&category=${cat}&ps=50`,
    playerUrl:   (rid, pid) => `${BWF_BASE}/player.aspx?id=${rid}&player=${pid}`,
    // www.tournamentsoftware.com 302s to /cookiewall unless an `st` cookie is
    // present. cp=23 = purposes 1|2|4|16 (full opt-in); l=2057 = en-GB locale
    // so the publish date renders as unambiguous DD/MM/YYYY.
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Cookie': 'st=l=2057&exp=46542&c=1&cp=23',
    },
    dateFormat: 'en-gb',
    pollSchedule: { dayOfWeek: 3, startHour: 8, endHour: 23, staleBootKickMs: SIX_DAYS_MS },
  },
}

export function getRankingConfig(provider: ProviderTag): RankingProviderConfig {
  if (provider !== 'bat' && provider !== 'bwf') {
    throw new Error(`unsupported ranking provider: ${provider}`)
  }
  return PROVIDER_CONFIG[provider]
}
```

- [ ] **Step 2: Write `lib/ranking/fetch.ts`**

```ts
import { batFetch } from '@/lib/bat-fetch'
import { getRankingConfig } from './config'
import type { ProviderTag } from '@/lib/types'

/** Thin wrapper around batFetch that injects the provider's headers (UA
 *  for BAT, UA + cookiewall-bypass cookie for BWF). `kind` is the tag
 *  recorded in [bat-fetch] log lines — prefix with `ranking-{provider}-`
 *  so logs distinguish the two upstreams.  */
export async function rankingFetch(
  provider: ProviderTag,
  kind: string,
  url: string,
): Promise<Response> {
  const cfg = getRankingConfig(provider)
  return batFetch(`ranking-${provider}-${kind}`, url, { headers: cfg.headers })
}
```

- [ ] **Step 3: Compile-check**

Run:
```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/ranking/config.ts lib/ranking/fetch.ts
git commit -m "feat(ranking): add provider config and fetch wrapper"
```

---

## Task 4: Provider-agnostic HTML scraper

**Files:**
- Create: `lib/ranking/scraper.ts`
- Create: `__tests__/ranking-scraper.test.ts`
- Test: `__tests__/ranking-scraper.test.ts`

Port `lib/bat-ranking-scraper.ts` into `lib/ranking/scraper.ts` with two functional changes:
- Relax `colspan="9"` → `colspan="\d+"` so BWF (`colspan="8"`) parses too
- Capture each row's `player.aspx?...player=<NUMERIC>` into `RankingEntry.globalPlayerId`

Write tests against both BAT and BWF fixtures.

- [ ] **Step 1: Write the failing test file**

Create `__tests__/ranking-scraper.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import {
  parseRankingOverview,
  parseCategoryList,
  parseCategoryPage,
  parseRankingId,
  parsePublishDate,
  eventCodeFromName,
} from '@/lib/ranking/scraper'

const fix = (name: string) =>
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8')

describe('parseRankingOverview', () => {
  it('parses BAT overview (colspan=9, BE date)', () => {
    // Inline mini-fixture so the test does not depend on a captured BAT file;
    // structure mirrors fixtures/ranking-overview-bwf.html minus the cookie
    // wall lines.
    const html = `<html><body>
<h3>X <span class="rankingdate">(19/5/2569)</span></h3>
<table class="ruler">
  <tr><th colspan="9"><a href="category.aspx?id=51771&category=5694">U23 Men's singles</a></th>
      <th class="right"><a href="category.aspx?id=51771&category=5694">More</a></th></tr>
  <tr><td class="rank"><div>1</div></td><td>&nbsp;</td><td>&nbsp;</td>
      <td><a href="player.aspx?id=51771&player=2458898">PLAYER A</a></td>
      <td><a href="/player-profile/X" class="icon profile"></a></td>
      <td>1</td><td class="left">2008</td>
      <td class="right rankingpoints">146240</td>
      <td class="right">13</td>
      <td><a href="category.aspx?id=51771&category=5694&ogid=Z">Club A</a></td></tr>
</table></body></html>`
    const r = parseRankingOverview(html, 'thai-be')
    expect(r.publishDate).toBe('19/5/2569')
    expect(r.rankingId).toBe('51771')
    expect(r.events).toHaveLength(1)
    expect(r.events[0].eventName).toBe("U23 Men's singles")
    expect(r.events[0].entries[0].name).toBe('PLAYER A')
    expect(r.events[0].entries[0].points).toBe(146240)
    expect(r.events[0].entries[0].tournaments).toBe(13)
  })

  it('parses BWF overview (colspan=8, Gregorian date)', () => {
    const r = parseRankingOverview(fix('ranking-overview-bwf.html'), 'en-gb')
    expect(r.publishDate).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/)
    expect(r.rankingId).toBeTruthy()
    expect(r.events.length).toBeGreaterThan(5)
    expect(r.events[0].entries.length).toBeGreaterThan(0)
  })
})

describe('parseCategoryPage', () => {
  it('captures globalPlayerId from BWF rows', () => {
    const entries = parseCategoryPage(fix('ranking-category-bwf.html'))
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) {
      expect(e.globalPlayerId).toMatch(/^\d+$/)
    }
  })
})

describe('parseCategoryList', () => {
  it('returns BWF category list from overview <th> headers', () => {
    const cats = parseCategoryList(fix('ranking-overview-bwf.html'))
    expect(cats.length).toBeGreaterThan(5)
    expect(cats[0].id).toMatch(/^\d+$/)
    expect(cats[0].name.length).toBeGreaterThan(0)
  })
})

describe('eventCodeFromName', () => {
  it.each([
    ["U23 Men's singles", 'U23_MS'],
    ["Boy's singles U17", 'U17_MS'],
    ["Girls's doubles U15", 'U15_WD'],
    ['Mixed doubles U17',  'U17_MXD'],
  ])('%s → %s', (input, expected) => {
    expect(eventCodeFromName(input)).toBe(expected)
  })
})

describe('parsePublishDate', () => {
  it('reads BAT-style rankingdate span', () => {
    expect(parsePublishDate('<span class="rankingdate">(19/5/2569)</span>')).toBe('19/5/2569')
  })
  it('reads BWF-style rankingdate span', () => {
    expect(parsePublishDate('<span class="rankingdate">(03/06/2026)</span>')).toBe('03/06/2026')
  })
})

describe('parseRankingId', () => {
  it('finds id= on first category.aspx link', () => {
    expect(parseRankingId('<a href="category.aspx?id=51771&category=1">x</a>')).toBe('51771')
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:
```bash
npx jest ranking-scraper --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/ranking/scraper'`.

- [ ] **Step 3: Implement `lib/ranking/scraper.ts`**

Port the BAT scraper with the two functional changes. Create `lib/ranking/scraper.ts`:

```ts
// Pure HTML → Ranking transform. No I/O, no side effects.
// Parses both bat.tournamentsoftware.com/ranking/* and
// www.tournamentsoftware.com/ranking/* — same HTML shape, two cosmetic
// differences:
//   - <th colspan="N"> wraps each event header. BAT=9, BWF=8.
//   - rankingdate is BE for BAT, Gregorian for BWF — we keep the raw
//     string here; the player-view module parses it for week-key math.

import type { Ranking, RankingEntry, RankingEvent, ProviderTag } from '@/lib/types'
import type { DateFormat } from './config'
import { nameToSlug } from '@/lib/playerIndex'

function stripTags(s: string): string { return s.replace(/<[^>]+>/g, '').trim() }

function playerLinkText(cell: string): string {
  const m = cell.match(/<a\s[^>]*href="player\.aspx[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
  return m ? stripTags(m[1]) : ''
}

function playerIdFromCell(cell: string): string {
  const m = cell.match(/<a\s[^>]*href="player\.aspx\?[^"]*\bplayer=(\d+)/i)
  return m ? m[1] : ''
}

function lastLinkText(cell: string): string {
  const matches = Array.from(cell.matchAll(/<a\s[^>]*>([\s\S]*?)<\/a>/gi))
  if (matches.length === 0) return stripTags(cell)
  return stripTags(matches[matches.length - 1][1])
}

function parseEntries(html: string, limit = 50): RankingEntry[] {
  const rankRowRe = /<tr[^>]*>([\s\S]*?<td\s+class="rank"[\s\S]*?)<\/tr>/gi
  const entries: RankingEntry[] = []
  let m: RegExpExecArray | null

  while ((m = rankRowRe.exec(html)) !== null) {
    const row = m[1]
    const rankMatch = row.match(/<td\s+class="rank"[^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/)
    if (!rankMatch) continue
    const rank = parseInt(rankMatch[1].trim(), 10)
    if (isNaN(rank)) continue

    const ptsMatch = row.match(/<td\s+class="right rankingpoints"[^>]*>([\s\S]*?)<\/td>/i)
    const points = ptsMatch ? parseInt(ptsMatch[1].replace(/[^\d]/g, ''), 10) : 0

    const name = playerLinkText(row)
    if (!name) continue
    const globalPlayerId = playerIdFromCell(row)

    const tds = Array.from(row.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/gi))
    const club = tds.length > 0 ? lastLinkText(tds[tds.length - 1][1]) : ''
    const tournaments = tds.length >= 2
      ? parseInt(stripTags(tds[tds.length - 2][1]).replace(/[^\d]/g, ''), 10) || 0
      : 0

    entries.push({
      rank, name, slug: nameToSlug(name), club,
      points: isNaN(points) ? 0 : points,
      tournaments,
      globalPlayerId: globalPlayerId || undefined,
    })
    if (entries.length >= limit) break
  }
  return entries
}

export function eventCodeFromName(name: string): string {
  const upper = name.toUpperCase()
  const ageMatch = upper.match(/\b(U\d+)\b/)
  const age = ageMatch ? ageMatch[1] : ''
  let disc = 'XX'
  if (/(MIXED|XD)/.test(upper)) disc = 'MXD'
  else if (/(WOME|GIRL)/.test(upper) && /(DOUBLE)/.test(upper)) disc = 'WD'
  else if (/(MEN|BOY)/.test(upper) && /(DOUBLE)/.test(upper)) disc = 'MD'
  else if (/(WOME|GIRL)/.test(upper)) disc = 'WS'
  else if (/(MEN|BOY)/.test(upper)) disc = 'MS'
  return age ? `${age}_${disc}` : disc
}

export function parseCategoryList(html: string): Array<{ id: string; name: string }> {
  const thRe = /<th[^>]*>([\s\S]*?)<\/th>/gi
  const seen = new Set<string>()
  const result: Array<{ id: string; name: string }> = []
  let th: RegExpExecArray | null
  while ((th = thRe.exec(html)) !== null) {
    const m = th[1].match(/category\.aspx\?id=\d+&category=(\d+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!m) continue
    const id = m[1]
    const name = stripTags(m[2])
    if (!name || name === 'More' || seen.has(id)) continue
    seen.add(id)
    result.push({ id, name })
  }
  return result
}

export function parseCategoryPage(html: string): RankingEntry[] {
  return parseEntries(html, 50)
}

export function parsePublishDate(html: string): string {
  const m = html.match(/<span\s+class="rankingdate"[^>]*>\(([^)]+)\)<\/span>/i)
  return m ? m[1].trim() : ''
}

export function parseRankingId(html: string): string {
  const cat = html.match(/href="category\.aspx\?id=(\d+)/i)
  if (cat) return cat[1]
  const ply = html.match(/href="player\.aspx\?id=(\d+)/i)
  return ply ? ply[1] : ''
}

/** Parse the full overview into a Ranking envelope.
 *  Caller passes the provider so the envelope carries it; date-format is
 *  used only to attach validation expectations — the raw publishDate
 *  string is stored as-is so downstream parsers can re-validate.  */
export function parseRankingOverview(
  html: string,
  _dateFormat: DateFormat,
  provider: ProviderTag = 'bat',
): Ranking {
  const scrapedAt = new Date().toISOString()
  const publishDate = parsePublishDate(html)
  const rankingId = parseRankingId(html)

  const tableMatch = html.match(/<table\s[^>]*class="ruler"[^>]*>([\s\S]*?)<\/table>/i)
  if (!tableMatch) return { provider, scrapedAt, publishDate, rankingId, events: [] }
  const tableContent = tableMatch[1]

  // RELAXED: colspan="\d+" — BAT uses 9, BWF uses 8. Same parser handles both.
  const headerRe = /<th[^>]*colspan="\d+"[^>]*>[\s\S]*?<a\s[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/th>/gi
  const headers: Array<{ name: string; end: number }> = []
  let hm: RegExpExecArray | null
  while ((hm = headerRe.exec(tableContent)) !== null) {
    const name = stripTags(hm[1])
    if (name && name !== 'More') headers.push({ name, end: hm.index + hm[0].length })
  }

  const events: RankingEvent[] = []
  for (let i = 0; i < headers.length; i++) {
    const { name, end } = headers[i]
    const chunkEnd = i + 1 < headers.length
      ? tableContent.lastIndexOf('<tr', headers[i + 1].end - headers[i + 1].name.length - 20)
      : tableContent.length
    const chunk = tableContent.slice(end, chunkEnd)
    const entries = parseEntries(chunk)
    if (entries.length > 0) {
      events.push({ eventCode: eventCodeFromName(name), eventName: name, entries })
    }
  }

  return { provider, scrapedAt, publishDate, rankingId, events }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx jest ranking-scraper --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ranking/scraper.ts __tests__/ranking-scraper.test.ts
git commit -m "feat(ranking): provider-agnostic HTML scraper with globalPlayerId capture"
```

---

## Task 5: Provider-agnostic player-view (with date-format dispatch)

**Files:**
- Create: `lib/ranking/player-view.ts`
- Create: `__tests__/ranking-player-view.test.ts`

Port `lib/bat-ranking-player-view.ts`. The substantive change: `weekKeyFromPublishDate` and `expiringWithinWeeksCutoff` take an extra `dateFormat: DateFormat` parameter; the helper `parsePublishDateString` branches on it.

- [ ] **Step 1: Write the failing test**

Create `__tests__/ranking-player-view.test.ts`:

```ts
import {
  weekKeyFromPublishDate,
  expiringWithinWeeksCutoff,
  expiringNextWeekCutoff,
  computeExpiryCutoffs,
  classifyExpiry,
  topRowsForTab,
  otherRowsForTab,
  disciplineOf,
  dedupePerTournament,
  TOP_N,
} from '@/lib/ranking/player-view'
import type { RankingPlayerDetail, RankingPlayerTournament } from '@/lib/types'

describe('weekKeyFromPublishDate', () => {
  it('handles Thai BE (BAT)', () => {
    expect(weekKeyFromPublishDate('26/5/2569', 'thai-be')).toBe('2026-22')
  })
  it('handles Gregorian DD/MM/YYYY (BWF)', () => {
    // 3 June 2026 = ISO week 23
    expect(weekKeyFromPublishDate('03/06/2026', 'en-gb')).toBe('2026-23')
  })
  it('rejects CE-shaped value in thai-be mode', () => {
    expect(weekKeyFromPublishDate('03/06/2026', 'thai-be')).toBeNull()
  })
  it('rejects BE-shaped value in en-gb mode', () => {
    expect(weekKeyFromPublishDate('26/5/2569', 'en-gb')).toBeNull()
  })
})

describe('expiringWithinWeeksCutoff', () => {
  it('BAT 1-week cutoff (BE input)', () => {
    expect(expiringWithinWeeksCutoff('26/5/2569', 1, 'thai-be')).toBe('2025-22')
  })
  it('BWF 1-week cutoff (Gregorian input)', () => {
    expect(expiringWithinWeeksCutoff('03/06/2026', 1, 'en-gb')).toBe('2025-23')
  })
})

describe('topRowsForTab + otherRowsForTab', () => {
  const t = (sourceEvent: string, points: number, week = '2026-20'): RankingPlayerTournament => ({
    tournamentName: `T ${sourceEvent} ${points}`,
    tournamentId: null,
    sourceEvent, week, result: '1/2', points,
    countsTowardRankings: [],
  })
  const detail = (tournaments: RankingPlayerTournament[]): RankingPlayerDetail => ({
    globalPlayerId: '1', publishDate: '26/5/2569', scrapedAt: 'x', tournaments,
  })

  it('returns top-N by points, newest first', () => {
    const rows = Array.from({ length: TOP_N + 2 }, (_, i) =>
      t('BS U15', 1000 - i * 10, `2026-${20 - i}`),
    )
    const d = detail(rows)
    const top = topRowsForTab(d, 'singles')
    expect(top).toHaveLength(TOP_N)
    expect(top[0].week >= top[1].week).toBe(true)
  })

  it('classifies discipline by event code prefix', () => {
    expect(disciplineOf('XD U13')).toBe('mixed')
    expect(disciplineOf('MD U17')).toBe('doubles')
    expect(disciplineOf('BS U15')).toBe('singles')
    expect(disciplineOf('GD U15')).toBe('doubles')
  })

  it('dedupePerTournament: marked wins over higher unmarked', () => {
    const a: RankingPlayerTournament = { ...t('BS U15', 1000), tournamentName: 'Open', countsTowardRankings: [] }
    const b: RankingPlayerTournament = { ...t('BS U13', 800),  tournamentName: 'Open', countsTowardRankings: ['BS U13'] }
    const out = dedupePerTournament([a, b])
    expect(out).toHaveLength(1)
    expect(out[0].sourceEvent).toBe('BS U13')
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
npx jest ranking-player-view --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/ranking/player-view.ts`**

Port `lib/bat-ranking-player-view.ts`. Apply these changes to the BAT version:
- Rename imported types from `BatRankingPlayer*` → `RankingPlayer*`
- Replace `parseBatPublishDate(s)` with `parsePublishDateString(s, format)`
- Add `format: DateFormat` parameter to: `weekKeyFromPublishDate`, `expiringWithinWeeksCutoff`, `expiringNextWeekCutoff`, `computeExpiryCutoffs`

Create the file with this implementation (full content, since most of it is moved verbatim):

```ts
import type {
  RankingPlayerDetail,
  RankingPlayerTournament,
} from '@/lib/types'
import type { DateFormat } from './config'

export type Discipline = 'singles' | 'doubles' | 'mixed'
export const TOP_N = 10
export const EXPIRY_SOON_HORIZON_WEEKS = 4

export function disciplineOf(sourceEvent: string): Discipline | null {
  const code = sourceEvent.trim().toUpperCase().split(/\s+/)[0]
  if (code.endsWith('XD') || code === 'XD' || code.startsWith('XD')) return 'mixed'
  if (code.endsWith('D') || code.includes('DOUBLE')) return 'doubles'
  if (code.endsWith('S') || code.includes('SINGLE')) return 'singles'
  return null
}

export function weekSortKey(week: string): string {
  const idx = week.indexOf('-')
  if (idx < 0) return week
  const y = week.slice(0, idx)
  const w = week.slice(idx + 1)
  return `${y}-${w.padStart(2, '0')}`
}

export function ageGroupRank(sourceEvent: string): number {
  const m = sourceEvent.match(/U(\d+)/i)
  if (!m) return Number.POSITIVE_INFINITY
  return parseInt(m[1], 10)
}

/** Parse a publish-date string into a UTC Date, branching on the provider's
 *  date format. Each branch rejects values that look like the other format
 *  so a typo or upstream locale change can't silently drift dates by 543
 *  years. Returns null on malformed input. */
function parsePublishDateString(s: string, format: DateFormat): Date | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const year = parseInt(m[3], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (format === 'thai-be') {
    if (year < 2400) return null
    return new Date(Date.UTC(year - 543, month - 1, day))
  }
  // en-gb
  if (year >= 2400) return null
  return new Date(Date.UTC(year, month - 1, day))
}

function isoWeekString(d: Date): string {
  const t = new Date(d.getTime())
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-${week}`
}

export function weekKeyFromPublishDate(s: string, format: DateFormat): string | null {
  const d = parsePublishDateString(s, format)
  if (!d) return null
  return isoWeekString(d)
}

export function expiringWithinWeeksCutoff(
  publishDate: string,
  weeksOut: number,
  format: DateFormat,
): string | null {
  if (!Number.isInteger(weeksOut) || weeksOut < 1) return null
  const d = parsePublishDateString(publishDate, format)
  if (!d) return null
  const cutoff = new Date(d.getTime() - (53 - weeksOut) * 7 * 86400000)
  return isoWeekString(cutoff)
}

export function expiringNextWeekCutoff(publishDate: string, format: DateFormat): string | null {
  return expiringWithinWeeksCutoff(publishDate, 1, format)
}

export function isExpiringNextWeek(week: string, cutoff: string | null): boolean {
  if (!cutoff) return false
  return weekSortKey(week).localeCompare(weekSortKey(cutoff)) <= 0
}

export interface ExpiryCutoffs { next: string | null; soon: string | null }
export type ExpiryTier = 'next' | 'soon' | null

export function computeExpiryCutoffs(
  publishDate: string | undefined | null,
  format: DateFormat,
): ExpiryCutoffs {
  if (!publishDate) return { next: null, soon: null }
  return {
    next: expiringWithinWeeksCutoff(publishDate, 1, format),
    soon: expiringWithinWeeksCutoff(publishDate, EXPIRY_SOON_HORIZON_WEEKS, format),
  }
}

export function classifyExpiry(week: string, cutoffs: ExpiryCutoffs): ExpiryTier {
  const w = weekSortKey(week)
  if (cutoffs.next && w.localeCompare(weekSortKey(cutoffs.next)) <= 0) return 'next'
  if (cutoffs.soon && w.localeCompare(weekSortKey(cutoffs.soon)) <= 0) return 'soon'
  return null
}

export function dedupePerTournament(
  rows: RankingPlayerTournament[],
): RankingPlayerTournament[] {
  const byKey = new Map<string, RankingPlayerTournament>()
  const isMarked = (r: RankingPlayerTournament) => r.countsTowardRankings.length > 0
  for (const r of rows) {
    const key = `${weekSortKey(r.week)}::${r.tournamentName.trim()}`
    const existing = byKey.get(key)
    if (!existing) { byKey.set(key, r); continue }
    const rM = isMarked(r), eM = isMarked(existing)
    let rWins: boolean
    if (rM !== eM) rWins = rM
    else if (r.points !== existing.points) rWins = r.points > existing.points
    else rWins = ageGroupRank(r.sourceEvent) > ageGroupRank(existing.sourceEvent)
    if (rWins) byKey.set(key, r)
  }
  return Array.from(byKey.values())
}

function disciplineRowsByPointsDesc(
  detail: RankingPlayerDetail,
  discipline: Discipline,
): RankingPlayerTournament[] {
  const inTab = detail.tournaments.filter(
    (r) => disciplineOf(r.sourceEvent) === discipline,
  )
  if (inTab.length === 0) return []
  return dedupePerTournament(inTab)
    .slice()
    .sort((a, b) => b.points - a.points || weekSortKey(b.week).localeCompare(weekSortKey(a.week)))
}

export function topRowsForTab(detail: RankingPlayerDetail, discipline: Discipline): RankingPlayerTournament[] {
  return disciplineRowsByPointsDesc(detail, discipline)
    .slice(0, TOP_N)
    .sort((a, b) => weekSortKey(b.week).localeCompare(weekSortKey(a.week)))
}

export function otherRowsForTab(detail: RankingPlayerDetail, discipline: Discipline): RankingPlayerTournament[] {
  return disciplineRowsByPointsDesc(detail, discipline).slice(TOP_N)
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest ranking-player-view --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ranking/player-view.ts __tests__/ranking-player-view.test.ts
git commit -m "feat(ranking): provider-agnostic player-view with date-format dispatch"
```

---

## Task 6: Provider-agnostic player-scraper

**Files:**
- Create: `lib/ranking/player-scraper.ts`
- Create: `__tests__/ranking-player-scraper.test.ts`

The per-player-page HTML shape is identical across BAT and BWF. Port verbatim, renaming types.

- [ ] **Step 1: Write the failing test**

Create `__tests__/ranking-player-scraper.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import { parseRankingPlayerPage } from '@/lib/ranking/player-scraper'

const bwfHtml = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'ranking-player-bwf.html'),
  'utf8',
)

describe('parseRankingPlayerPage', () => {
  it('parses tournaments from BWF per-player page', () => {
    const { tournaments } = parseRankingPlayerPage(bwfHtml)
    expect(tournaments.length).toBeGreaterThan(0)
    const first = tournaments[0]
    expect(first.tournamentName.length).toBeGreaterThan(0)
    expect(first.week).toMatch(/^\d{4}-\d{1,2}$/)
    expect(first.points).toBeGreaterThanOrEqual(0)
  })

  it('captures "Used for" marker categories', () => {
    const { tournaments } = parseRankingPlayerPage(bwfHtml)
    const marked = tournaments.find(t => t.countsTowardRankings.length > 0)
    expect(marked).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
npx jest ranking-player-scraper --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/ranking/player-scraper.ts`**

Port `lib/bat-ranking-player-scraper.ts` verbatim, replacing `BatRankingPlayerTournament` with `RankingPlayerTournament`. The full file:

```ts
import type { RankingPlayerTournament } from '@/lib/types'

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
  const img = cell.match(/<img\b[^>]*title="([^"]+)"[^>]*>/i)
  if (!img) return []
  const title = decodeEntities(img[1])
  const idx = title.indexOf(':')
  const tail = idx >= 0 ? title.slice(idx + 1) : title
  return tail.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
}

function parseRow(rowHtml: string): RankingPlayerTournament | null {
  const tds = Array.from(rowHtml.matchAll(/<td(?:\s[^>]*)?>([\s\S]*?)<\/td>/gi)).map((m) => m[1])
  if (tds.length < 5) return null

  const tnLink = tds[0].match(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
  if (!tnLink) return null
  const tournamentName = decodeEntities(stripTags(tnLink[2]))
  const tournamentId = tournamentIdFromHref(tnLink[1])

  const sourceEventRaw = stripTags(tds[1])
  if (!sourceEventRaw) return null
  const sourceEvent = decodeEntities(sourceEventRaw)

  const week = stripTags(tds[2])
  if (!/^\d{4}-\d{1,2}$/.test(week)) return null

  const result = stripTags(tds[3])
  if (!result) return null

  const pointsStr = stripTags(tds[4]).replace(/[^\d]/g, '')
  const points = pointsStr.length ? parseInt(pointsStr, 10) : 0
  if (!Number.isFinite(points)) return null

  const markerCell = tds.length >= 7 ? tds[6] : ''
  const countsTowardRankings = parseMarkerCategories(markerCell)

  return {
    tournamentName, tournamentId, sourceEvent, week, result, points, countsTowardRankings,
  }
}

export function parseRankingPlayerPage(html: string): { tournaments: RankingPlayerTournament[] } {
  const rows = Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map((m) => m[1])
  const tournaments: RankingPlayerTournament[] = []
  for (const r of rows) {
    const row = parseRow(r)
    if (row) tournaments.push(row)
  }
  return { tournaments }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest ranking-player-scraper --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ranking/player-scraper.ts __tests__/ranking-player-scraper.test.ts
git commit -m "feat(ranking): provider-agnostic player-scraper"
```

---

## Task 7: Parameterized scheduler

**Files:**
- Create: `lib/ranking/scheduler.ts`
- Create: `__tests__/ranking-scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/ranking-scheduler.test.ts`:

```ts
import { decideTick, decideBootKick, publishDateChanged } from '@/lib/ranking/scheduler'
import { PROVIDER_CONFIG } from '@/lib/ranking/config'

const BAT = PROVIDER_CONFIG.bat.pollSchedule
const BWF = PROVIDER_CONFIG.bwf.pollSchedule
const FRESH = 60 * 60 * 1000

describe('decideTick', () => {
  it('BAT peeks on Tuesday inside window', () => {
    expect(decideTick({ clock: { dayOfWeek: 2, hour: 10, minute: 0 }, schedule: BAT }))
      .toBe('peek-and-maybe-refresh')
  })
  it('BAT skips on Wednesday inside window', () => {
    expect(decideTick({ clock: { dayOfWeek: 3, hour: 10, minute: 0 }, schedule: BAT }))
      .toBe('skip')
  })
  it('BWF peeks on Wednesday inside window', () => {
    expect(decideTick({ clock: { dayOfWeek: 3, hour: 10, minute: 0 }, schedule: BWF }))
      .toBe('peek-and-maybe-refresh')
  })
  it('BWF skips on Tuesday inside would-be window', () => {
    expect(decideTick({ clock: { dayOfWeek: 2, hour: 10, minute: 0 }, schedule: BWF }))
      .toBe('skip')
  })
  it('skips before 08:00 on the right day', () => {
    expect(decideTick({ clock: { dayOfWeek: 2, hour: 7, minute: 59 }, schedule: BAT })).toBe('skip')
  })
  it('endpoints are inclusive', () => {
    expect(decideTick({ clock: { dayOfWeek: 2, hour: 23, minute: 30 }, schedule: BAT }))
      .toBe('peek-and-maybe-refresh')
  })
})

describe('decideBootKick', () => {
  it('inside window peeks regardless of cache age', () => {
    expect(decideBootKick({ clock: { dayOfWeek: 2, hour: 12, minute: 0 }, schedule: BAT, cacheAgeMs: FRESH }))
      .toBe('peek-and-maybe-refresh')
  })
  it('cold cache (null) always peeks', () => {
    expect(decideBootKick({ clock: { dayOfWeek: 0, hour: 12, minute: 0 }, schedule: BAT, cacheAgeMs: null }))
      .toBe('peek-and-maybe-refresh')
  })
  it('stale cache (> 6d) peeks even off-window', () => {
    expect(decideBootKick({ clock: { dayOfWeek: 0, hour: 12, minute: 0 }, schedule: BAT, cacheAgeMs: 7 * 86400000 }))
      .toBe('peek-and-maybe-refresh')
  })
  it('fresh cache off-window skips', () => {
    expect(decideBootKick({ clock: { dayOfWeek: 0, hour: 12, minute: 0 }, schedule: BAT, cacheAgeMs: FRESH }))
      .toBe('skip')
  })
})

describe('publishDateChanged', () => {
  it('treats whitespace-only diffs as unchanged', () => {
    expect(publishDateChanged('19/5/2569', ' 19/5/2569 ')).toBe(false)
  })
  it('treats empty upstream as no-op (no change)', () => {
    expect(publishDateChanged('19/5/2569', '')).toBe(false)
  })
  it('returns true on real change', () => {
    expect(publishDateChanged('19/5/2569', '26/5/2569')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
npx jest ranking-scheduler --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/ranking/scheduler.ts`**

```ts
import type { BangkokClock } from '@/lib/today'
import type { PollSchedule } from './config'

export type SchedulerAction = 'skip' | 'peek-and-maybe-refresh'

export interface SchedulerInputs {
  clock: BangkokClock
  schedule: PollSchedule
}

export interface BootKickInputs extends SchedulerInputs {
  /** Time since the cache was written, in ms. Pass `null` when there is no
   *  cache at all (cold server) — that should always kick. */
  cacheAgeMs: number | null
}

export function decideTick({ clock, schedule }: SchedulerInputs): SchedulerAction {
  if (clock.dayOfWeek !== schedule.dayOfWeek) return 'skip'
  if (clock.hour < schedule.startHour) return 'skip'
  if (clock.hour > schedule.endHour) return 'skip'
  return 'peek-and-maybe-refresh'
}

export function decideBootKick(inputs: BootKickInputs): SchedulerAction {
  if (decideTick(inputs) === 'peek-and-maybe-refresh') return 'peek-and-maybe-refresh'
  if (inputs.cacheAgeMs === null) return 'peek-and-maybe-refresh'
  if (inputs.cacheAgeMs > inputs.schedule.staleBootKickMs) return 'peek-and-maybe-refresh'
  return 'skip'
}

export function publishDateChanged(cached: string | null, upstream: string): boolean {
  if (!upstream) return false
  return (cached ?? '').trim() !== upstream.trim()
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest ranking-scheduler --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ranking/scheduler.ts __tests__/ranking-scheduler.test.ts
git commit -m "feat(ranking): provider-parameterized scheduler"
```

---

## Task 8: Provider-keyed overview cache

**Files:**
- Create: `lib/ranking/cache.ts`
- Create: `__tests__/ranking-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/ranking-cache.test.ts`:

```ts
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  readRankingCache,
  writeRankingCache,
  __setRankingCacheRootForTesting,
} from '@/lib/ranking/cache'
import type { Ranking } from '@/lib/types'

const sample = (provider: 'bat' | 'bwf'): Ranking => ({
  provider,
  scrapedAt: '2026-05-20T10:00:00Z',
  publishDate: provider === 'bat' ? '20/5/2569' : '20/05/2026',
  rankingId: '51771',
  events: [{
    eventCode: 'MS', eventName: "Men's Singles",
    entries: [{ rank: 1, name: 'X', slug: 'x', club: 'C', points: 1500, tournaments: 1 }],
  }],
})

describe('ranking-cache', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkc-'))
    __setRankingCacheRootForTesting(dir)
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('returns null when file is missing', async () => {
    expect(await readRankingCache('bat')).toBeNull()
    expect(await readRankingCache('bwf')).toBeNull()
  })

  it('round-trips per provider, independently', async () => {
    await writeRankingCache(sample('bat'))
    await writeRankingCache(sample('bwf'))
    expect((await readRankingCache('bat'))?.provider).toBe('bat')
    expect((await readRankingCache('bwf'))?.provider).toBe('bwf')
  })

  it('rejects legacy v11 envelope (no provider field)', async () => {
    const legacy = { ...sample('bat') } as Partial<Ranking>
    delete (legacy as any).provider
    fs.writeFileSync(path.join(dir, 'ranking-bat.json'), JSON.stringify(legacy))
    expect(await readRankingCache('bat')).toBeNull()
  })

  it('removes the legacy bat-ranking.json on a bat-cache miss', async () => {
    const legacyPath = path.join(dir, 'bat-ranking.json')
    fs.writeFileSync(legacyPath, '{}')
    expect(await readRankingCache('bat')).toBeNull()
    expect(fs.existsSync(legacyPath)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
npx jest ranking-cache --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/ranking/cache.ts`**

```ts
import { promises as fs } from 'fs'
import path from 'path'
import type { Ranking, ProviderTag } from '@/lib/types'

// v12 adds `provider`. v11 envelopes lack it — rejected on read so the
// boot kick (instrumentation.ts) repopulates immediately.
let root = path.join(process.cwd(), '.cache', 'players')

export function __setRankingCacheRootForTesting(dir: string): void { root = dir }

function cacheFile(provider: ProviderTag): string {
  return path.join(root, `ranking-${provider}.json`)
}
function legacyBatFile(): string { return path.join(root, 'bat-ranking.json') }

async function bestEffortDelete(file: string): Promise<void> {
  try { await fs.unlink(file) } catch { /* missing or no perms — ignore */ }
}

export async function readRankingCache(provider: ProviderTag): Promise<Ranking | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile(provider), 'utf8')) as Ranking
    if (parsed.provider !== provider) return null
    return parsed
  } catch {
    // First miss on BAT also tries to sweep the legacy file so it doesn't sit
    // forever as a stale orphan after the rename. Best-effort: ignore errors.
    if (provider === 'bat') await bestEffortDelete(legacyBatFile())
    return null
  }
}

export async function writeRankingCache(data: Ranking): Promise<void> {
  const file = cacheFile(data.provider)
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
  await fs.rename(tmp, file)
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest ranking-cache --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ranking/cache.ts __tests__/ranking-cache.test.ts
git commit -m "feat(ranking): provider-keyed overview cache with legacy cleanup"
```

---

## Task 9: Provider-keyed per-player detail cache

**Files:**
- Create: `lib/ranking/player-cache.ts`
- Create: `__tests__/ranking-player-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/ranking-player-cache.test.ts`:

```ts
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  readRankingPlayerDetail,
  writeRankingPlayerDetail,
  writeRankingPlayerNotFound,
  __setRankingPlayerCacheRootForTesting,
} from '@/lib/ranking/player-cache'

describe('ranking player cache', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-'))
    __setRankingPlayerCacheRootForTesting(dir)
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('returns null on miss', async () => {
    expect(await readRankingPlayerDetail('bwf', '12345')).toBeNull()
  })

  it('round-trips a detail per provider', async () => {
    await writeRankingPlayerDetail('bwf', {
      globalPlayerId: '12345', publishDate: '03/06/2026', scrapedAt: 'now', tournaments: [],
    })
    const out = await readRankingPlayerDetail('bwf', '12345')
    expect(out?.detail?.globalPlayerId).toBe('12345')
  })

  it('writes a notFound stub', async () => {
    await writeRankingPlayerNotFound('bwf', '99', '03/06/2026')
    const out = await readRankingPlayerDetail('bwf', '99')
    expect(out?.notFound?.publishDate).toBe('03/06/2026')
  })

  it('stores BAT and BWF in separate sub-directories', async () => {
    await writeRankingPlayerDetail('bat', {
      globalPlayerId: '7', publishDate: '03/6/2569', scrapedAt: 'now', tournaments: [],
    })
    await writeRankingPlayerDetail('bwf', {
      globalPlayerId: '7', publishDate: '03/06/2026', scrapedAt: 'now', tournaments: [],
    })
    const bat = await readRankingPlayerDetail('bat', '7')
    const bwf = await readRankingPlayerDetail('bwf', '7')
    expect(bat?.detail?.publishDate).toBe('03/6/2569')
    expect(bwf?.detail?.publishDate).toBe('03/06/2026')
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
npx jest ranking-player-cache --no-coverage
```

Expected: FAIL.

- [ ] **Step 3: Implement `lib/ranking/player-cache.ts`**

```ts
import { promises as fs } from 'fs'
import path from 'path'
import type { RankingPlayerDetail, RankingPlayerDetailCache, ProviderTag } from '@/lib/types'

let root = path.join(process.cwd(), '.cache', 'players', 'ranking-detail')

export function __setRankingPlayerCacheRootForTesting(dir: string): void { root = dir }

function dirFor(provider: ProviderTag): string { return path.join(root, provider) }

function cacheFile(provider: ProviderTag, globalPlayerId: string): string {
  const safe = globalPlayerId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(dirFor(provider), `${safe}.json`)
}

export async function readRankingPlayerDetail(
  provider: ProviderTag,
  globalPlayerId: string,
): Promise<RankingPlayerDetailCache | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(cacheFile(provider, globalPlayerId), 'utf8'),
    ) as RankingPlayerDetailCache
    if (parsed.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeRankingPlayerDetail(
  provider: ProviderTag,
  detail: RankingPlayerDetail,
): Promise<void> {
  const file = cacheFile(provider, detail.globalPlayerId)
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  const payload: RankingPlayerDetailCache = { version: 1, detail }
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  await fs.rename(tmp, file)
}

export async function writeRankingPlayerNotFound(
  provider: ProviderTag,
  globalPlayerId: string,
  publishDate: string,
): Promise<void> {
  const file = cacheFile(provider, globalPlayerId)
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  const payload: RankingPlayerDetailCache = {
    version: 1,
    notFound: { publishDate, scrapedAt: new Date().toISOString() },
  }
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  await fs.rename(tmp, file)
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest ranking-player-cache --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ranking/player-cache.ts __tests__/ranking-player-cache.test.ts
git commit -m "feat(ranking): provider-keyed per-player detail cache"
```

---

## Task 10: Refresh route `/api/ranking/[provider]/refresh`

**Files:**
- Create: `app/api/ranking/[provider]/refresh/route.ts`
- Create: `__tests__/api-ranking-refresh-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api-ranking-refresh-route.test.ts`:

```ts
import fs from 'fs'
import os from 'os'
import path from 'path'
import { POST } from '@/app/api/ranking/[provider]/refresh/route'
import { __setRankingCacheRootForTesting } from '@/lib/ranking/cache'

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrf-'))
  __setRankingCacheRootForTesting(dir)
})

describe('POST /api/ranking/[provider]/refresh', () => {
  it('rejects unknown provider', async () => {
    const req = new Request('http://x/api/ranking/foo/refresh', { method: 'POST' })
    const res = await POST(req, { params: { provider: 'foo' } })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
npx jest api-ranking-refresh --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `app/api/ranking/[provider]/refresh/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { rankingFetch } from '@/lib/ranking/fetch'
import { getRankingConfig } from '@/lib/ranking/config'
import {
  parseCategoryList,
  parseCategoryPage,
  parsePublishDate,
  eventCodeFromName,
  parseRankingId,
} from '@/lib/ranking/scraper'
import { readRankingCache, writeRankingCache } from '@/lib/ranking/cache'
import type { RankingEvent, ProviderTag } from '@/lib/types'

const TTL_MS = 24 * 60 * 60 * 1000

interface Ctx { params: { provider: string } }

export async function POST(req: Request, ctx: Ctx) {
  const provider = ctx.params.provider as ProviderTag
  if (provider !== 'bat' && provider !== 'bwf') {
    return NextResponse.json({ error: 'unknown provider' }, { status: 400 })
  }
  const cfg = getRankingConfig(provider)
  const force = new URL(req.url).searchParams.get('force') === 'true'

  if (!force) {
    const cached = await readRankingCache(provider)
    if (cached) {
      const ageMs = Date.now() - new Date(cached.scrapedAt).getTime()
      if (ageMs < TTL_MS) {
        return NextResponse.json({
          skipped: true,
          reason: `cached data is only ${(ageMs / 3_600_000).toFixed(1)}h old (TTL 24h). Use ?force=true to override.`,
          scrapedAt: cached.scrapedAt,
          eventsFound: cached.events.length,
        })
      }
    }
  }

  try {
    const overviewRes = await rankingFetch(provider, 'overview', cfg.overviewUrl)
    if (!overviewRes.ok) {
      return NextResponse.json({ error: `upstream ${overviewRes.status}` }, { status: 502 })
    }
    const overviewHtml = await overviewRes.text()
    const publishDate = parsePublishDate(overviewHtml)
    const categories = parseCategoryList(overviewHtml)
    const rankingId = parseRankingId(overviewHtml)

    if (categories.length === 0) {
      return NextResponse.json({ error: 'no categories found on overview page' }, { status: 502 })
    }
    if (!rankingId) {
      return NextResponse.json({ error: 'rankingId not found on overview page' }, { status: 502 })
    }

    const events: RankingEvent[] = []
    for (const cat of categories) {
      const url = cfg.categoryUrl(rankingId, cat.id)
      try {
        const res = await rankingFetch(provider, 'cat', url)
        if (!res.ok) continue
        const html = await res.text()
        const entries = parseCategoryPage(html)
        if (entries.length > 0) {
          events.push({ eventCode: eventCodeFromName(cat.name), eventName: cat.name, entries })
        }
      } catch { /* skip failed categories */ }
    }

    if (events.length === 0) {
      console.log(`[ranking/${provider}/refresh] all categories empty; cache preserved`)
      return NextResponse.json({ error: 'no entries scraped; cache preserved' }, { status: 502 })
    }

    const scrapedAt = new Date().toISOString()
    await writeRankingCache({ provider, scrapedAt, publishDate, rankingId, events })
    console.log(`[ranking/${provider}/refresh] ok eventsFound=${events.length} publishDate=${publishDate}`)
    return NextResponse.json({ scrapedAt, eventsFound: events.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.log(`[ranking/${provider}/refresh] error err=${msg}`)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest api-ranking-refresh --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/ranking/[provider]/refresh/route.ts __tests__/api-ranking-refresh-route.test.ts
git commit -m "feat(ranking): /api/ranking/[provider]/refresh route"
```

---

## Task 11: Migrate `ranking-detail` route to be provider-aware

**Files:**
- Modify: `app/api/players/ranking-detail/route.ts`
- Modify: `__tests__/api-players-ranking-detail-route.test.ts`

The BAT detail path is unchanged (still uses `bat-player-id-map` for the 3-hop discovery). The BWF path looks up `globalPlayerId` directly from `ranking-bwf.json`.

- [ ] **Step 1: Rewrite the test file to mock the new module paths**

The existing file `jest.mock`s the old `bat-ranking-cache` / `bat-ranking-player-cache` modules. After the route migration in Step 3 those mocks no longer intercept anything (the route imports from the new `lib/ranking/*` paths). Replace the entire file with the version below — it keeps every existing BAT test case verbatim (renamed function references) and appends the new BWF cases.

Replace the entire contents of `__tests__/api-players-ranking-detail-route.test.ts` with:

```ts
jest.mock('../lib/bat-fetch', () => ({
  batFetch: jest.fn(),
}))
jest.mock('../lib/ranking/cache', () => ({
  readRankingCache: jest.fn(),
}))
jest.mock('../lib/ranking/player-cache', () => ({
  readRankingPlayerDetail: jest.fn(),
  writeRankingPlayerDetail: jest.fn().mockResolvedValue(undefined),
  writeRankingPlayerNotFound: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../lib/ranking/fetch', () => ({
  rankingFetch: jest.fn(),
}))
jest.mock('../lib/bat-player-id-map', () => ({
  readPlayerIdEntry: jest.fn(),
  writePlayerIdSuccess: jest.fn().mockResolvedValue(undefined),
  writePlayerIdFailure: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../lib/player-index-cache', () => ({
  readIndexCache: jest.fn(),
}))
jest.mock('../lib/scraper', () => ({
  extractProfileUrl: jest.fn(),
}))

import { GET } from '@/app/api/players/ranking-detail/route'
import { batFetch } from '@/lib/bat-fetch'
import { readRankingCache } from '@/lib/ranking/cache'
import { readRankingPlayerDetail, writeRankingPlayerDetail } from '@/lib/ranking/player-cache'
import { rankingFetch } from '@/lib/ranking/fetch'
import { readPlayerIdEntry, writePlayerIdSuccess } from '@/lib/bat-player-id-map'
import { readIndexCache } from '@/lib/player-index-cache'
import { extractProfileUrl } from '@/lib/scraper'

const batReq = (slug: string) =>
  new Request(`http://localhost/api/players/ranking-detail?slug=${encodeURIComponent(slug)}`)
const bwfReq = (slug: string) =>
  new Request(`http://localhost/api/players/ranking-detail?provider=bwf&slug=${encodeURIComponent(slug)}`)

const batCurrent = (publishDate = '26/5/2569', rankingId = '51869') => ({
  provider: 'bat' as const, scrapedAt: 'x', publishDate, rankingId, events: [],
})
const bwfCurrent = (
  publishDate = '03/06/2026',
  rankingId = '52035',
  entries: Array<{ slug: string; globalPlayerId?: string }> = [],
) => ({
  provider: 'bwf' as const, scrapedAt: 'x', publishDate, rankingId,
  events: [{
    eventCode: 'U17_MS', eventName: "Boy's singles U17",
    entries: entries.map((e, i) => ({
      rank: i + 1, name: e.slug.toUpperCase(), slug: e.slug, club: '',
      points: 100, tournaments: 1, globalPlayerId: e.globalPlayerId,
    })),
  }],
})

beforeEach(() => { jest.clearAllMocks() })

describe('GET /api/players/ranking-detail (BAT)', () => {
  it('returns 400 when slug is missing', async () => {
    const res = await GET(new Request('http://localhost/api/players/ranking-detail'))
    expect(res.status).toBe(400)
  })

  it('returns 503 when no current ranking is on disk', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(null)
    const res = await GET(batReq('ravin'))
    expect(res.status).toBe(503)
  })

  it('cache hit + matching publishDate short-circuits without any BAT call', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    const cached = {
      version: 1 as const,
      detail: { globalPlayerId: '3903158', publishDate: '26/5/2569', scrapedAt: 'x', tournaments: [] },
    }
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue(cached)
    const res = await GET(batReq('ravin'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ detail: cached.detail })
    expect(batFetch).not.toHaveBeenCalled()
    expect(rankingFetch).not.toHaveBeenCalled()
  })

  it('cache hit but stale publishDate triggers refetch', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent('26/5/2569'))
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue({
      version: 1, detail: { globalPlayerId: '3903158', publishDate: '19/5/2569', scrapedAt: 'x', tournaments: [] },
    })
    ;(rankingFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<table></table>' })
    const res = await GET(batReq('ravin'))
    expect(res.status).toBe(200)
    expect(rankingFetch).toHaveBeenCalledWith(
      'bat',
      'player-detail',
      'https://bat.tournamentsoftware.com/ranking/player.aspx?id=51869&player=3903158',
    )
  })

  it('discovers globalPlayerId via the 3-hop chain on first visit', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue(null)
    ;(readIndexCache as jest.Mock).mockResolvedValue({
      players: { ravin: { sampleRef: { tournamentId: 'TID', playerId: 'TPID' } } },
    })
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>tournament-page</html>' })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><a href="/player-profile/abcdef12-3456-7890-abcd-ef1234567890/ranking">Ranking</a></html>',
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><a href="/ranking/player.aspx?id=51869&amp;player=3903158">Detail</a></html>',
      })
    ;(rankingFetch as jest.Mock).mockResolvedValueOnce({ ok: true, text: async () => '<table></table>' })
    ;(extractProfileUrl as jest.Mock).mockReturnValue('/player/b06eafc7-fdae-450f-909e-317c6770352d/YmFzZTY0OjQ2MjY2NTM0')
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue(null)

    const res = await GET(batReq('ravin'))
    expect(res.status).toBe(200)
    expect(writePlayerIdSuccess).toHaveBeenCalledWith('ravin', '3903158')
    expect(writeRankingPlayerDetail).toHaveBeenCalled()
    expect(rankingFetch).toHaveBeenLastCalledWith(
      'bat',
      'player-detail',
      'https://bat.tournamentsoftware.com/ranking/player.aspx?id=51869&player=3903158',
    )
  })

  it('persists a failure sentinel when the global page lacks the /player-profile/.../ranking link', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue(null)
    ;(readIndexCache as jest.Mock).mockResolvedValue({
      players: { ravin: { sampleRef: { tournamentId: 'TID', playerId: 'TPID' } } },
    })
    ;(batFetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>tournament-page</html>' })
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>nothing useful here</html>' })
    ;(extractProfileUrl as jest.Mock).mockReturnValue('/player/abc/YmFzZTY0OjEx')
    const res = await GET(batReq('ravin'))
    expect(res.status).toBe(404)
  })

  it('returns 404 when the player-id map says discovery failed', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: null, reason: 'no sampleRef' })
    const res = await GET(batReq('ghost'))
    expect(res.status).toBe(404)
    expect(batFetch).not.toHaveBeenCalled()
  })

  it('returns 502 when BAT detail fetch fails', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue(null)
    ;(rankingFetch as jest.Mock).mockResolvedValue({ ok: false, status: 503, text: async () => '' })
    const res = await GET(batReq('ravin'))
    expect(res.status).toBe(502)
  })

  it('dedupes concurrent in-flight requests for the same player', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(batCurrent())
    ;(readPlayerIdEntry as jest.Mock).mockResolvedValue({ globalPlayerId: '3903158' })
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue(null)
    let resolve: () => void = () => {}
    const slow = new Promise<void>((r) => { resolve = r })
    ;(rankingFetch as jest.Mock).mockImplementation(async () => {
      await slow
      return { ok: true, text: async () => '<table></table>' }
    })
    const a = GET(batReq('ravin'))
    const b = GET(batReq('ravin'))
    resolve()
    await Promise.all([a, b])
    expect((rankingFetch as jest.Mock).mock.calls.length).toBe(1)
  })
})

describe('GET /api/players/ranking-detail (BWF)', () => {
  it('returns 400 on unknown provider', async () => {
    const req = new Request('http://localhost/api/players/ranking-detail?provider=foo&slug=x')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when slug not in any BWF ranking event', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(bwfCurrent())
    const res = await GET(bwfReq('ghost'))
    expect(res.status).toBe(404)
    expect(rankingFetch).not.toHaveBeenCalled()
  })

  it('returns cached detail when slug appears in ranking and detail is fresh', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(
      bwfCurrent('03/06/2026', '52035', [{ slug: 'x', globalPlayerId: '999' }]),
    )
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue({
      version: 1, detail: { globalPlayerId: '999', publishDate: '03/06/2026', scrapedAt: 'x', tournaments: [] },
    })
    const res = await GET(bwfReq('x'))
    expect(res.status).toBe(200)
    expect(rankingFetch).not.toHaveBeenCalled()
  })

  it('fetches the per-player page via rankingFetch when detail cache is stale', async () => {
    ;(readRankingCache as jest.Mock).mockResolvedValue(
      bwfCurrent('03/06/2026', '52035', [{ slug: 'x', globalPlayerId: '999' }]),
    )
    ;(readRankingPlayerDetail as jest.Mock).mockResolvedValue(null)
    ;(rankingFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => '<table></table>' })
    const res = await GET(bwfReq('x'))
    expect(res.status).toBe(200)
    expect(rankingFetch).toHaveBeenCalledWith(
      'bwf',
      'player-detail',
      'https://www.tournamentsoftware.com/ranking/player.aspx?id=52035&player=999',
    )
    expect(writeRankingPlayerDetail).toHaveBeenCalledWith('bwf', expect.objectContaining({ globalPlayerId: '999' }))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest api-players-ranking-detail-route --no-coverage
```

Expected: FAIL — current route ignores `provider`.

- [ ] **Step 3: Migrate the route handler**

Replace the entire contents of `app/api/players/ranking-detail/route.ts` with:

```ts
import { NextResponse } from 'next/server'
import { batFetch } from '@/lib/bat-fetch'
import { readRankingCache } from '@/lib/ranking/cache'
import {
  readRankingPlayerDetail,
  writeRankingPlayerDetail,
  writeRankingPlayerNotFound,
} from '@/lib/ranking/player-cache'
import {
  readPlayerIdEntry,
  writePlayerIdSuccess,
  writePlayerIdFailure,
} from '@/lib/bat-player-id-map'
import { readIndexCache } from '@/lib/player-index-cache'
import { extractProfileUrl } from '@/lib/scraper'
import { parseRankingPlayerPage } from '@/lib/ranking/player-scraper'
import { rankingFetch } from '@/lib/ranking/fetch'
import { getRankingConfig } from '@/lib/ranking/config'
import type { RankingPlayerDetail, ProviderTag } from '@/lib/types'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const UA = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
}

const inflight = new Map<string, Promise<RankingPlayerDetail | { notFound: true }>>()

async function discoverBatGlobalPlayerId(slug: string): Promise<{ id: string } | { id: null; reason: string }> {
  // Unchanged 3-hop BAT-only discovery. Kept intact from previous implementation.
  const cached = await readPlayerIdEntry(slug)
  if (cached) {
    if (cached.globalPlayerId === null) return { id: null, reason: cached.reason ?? 'previously failed' }
    return { id: cached.globalPlayerId }
  }
  const index = await readIndexCache('bat')
  const ref = index?.players[slug]?.sampleRef
  if (!ref) { await writePlayerIdFailure(slug, 'no sampleRef in index'); return { id: null, reason: 'no sampleRef in index' } }

  const tournamentUrl = `https://bat.tournamentsoftware.com/sport/player.aspx?id=${ref.tournamentId}&player=${ref.playerId}`
  const res1 = await batFetch('ranking-player-discover-1', tournamentUrl, { headers: UA })
  if (!res1.ok) { const r = `hop 1 upstream ${res1.status}`; await writePlayerIdFailure(slug, r); return { id: null, reason: r } }
  const profilePath = extractProfileUrl(await res1.text())
  if (!profilePath) { const r = 'no profile link on per-tournament page'; await writePlayerIdFailure(slug, r); return { id: null, reason: r } }

  const profileUrl = profilePath.startsWith('http') ? profilePath : `https://bat.tournamentsoftware.com${profilePath}`
  const res2 = await batFetch('ranking-player-discover-2', profileUrl, { headers: UA })
  if (!res2.ok) { const r = `hop 2 upstream ${res2.status}`; await writePlayerIdFailure(slug, r); return { id: null, reason: r } }
  const html2 = await res2.text()
  const rankingPagePath = html2.match(/\/player-profile\/[a-f0-9-]+\/ranking/i)?.[0]
  if (!rankingPagePath) { const r = 'no /player-profile/.../ranking link on global page'; await writePlayerIdFailure(slug, r); return { id: null, reason: r } }

  const res3 = await batFetch('ranking-player-discover-3', `https://bat.tournamentsoftware.com${rankingPagePath}`, { headers: UA })
  if (!res3.ok) { const r = `hop 3 upstream ${res3.status}`; await writePlayerIdFailure(slug, r); return { id: null, reason: r } }
  const html3 = await res3.text()
  const m = html3.match(/\/ranking\/player\.aspx\?[^"]*\bplayer=(\d+)/i)
  if (!m) { const r = 'no numeric global player id on ranking page'; await writePlayerIdFailure(slug, r); return { id: null, reason: r } }
  await writePlayerIdSuccess(slug, m[1])
  return { id: m[1] }
}

/** Look up the cached globalPlayerId for a slug in the BWF ranking. Returns
 *  null when the player is not in the top-N of any BWF event (no discovery
 *  fallback for BWF — different host, no slug↔id bridge). */
async function lookupBwfGlobalPlayerId(slug: string): Promise<string | null> {
  const cache = await readRankingCache('bwf')
  if (!cache) return null
  for (const ev of cache.events) {
    const hit = ev.entries.find(e => e.slug === slug && e.globalPlayerId)
    if (hit?.globalPlayerId) return hit.globalPlayerId
  }
  return null
}

async function fetchAndCache(
  provider: ProviderTag,
  globalPlayerId: string,
  rankingId: string,
  publishDate: string,
): Promise<RankingPlayerDetail | { notFound: true }> {
  const cfg = getRankingConfig(provider)
  const url = cfg.playerUrl(rankingId, globalPlayerId)
  const res = await rankingFetch(provider, 'player-detail', url)
  if (res.status === 404) return { notFound: true }
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  const html = await res.text()
  const { tournaments } = parseRankingPlayerPage(html)
  const detail: RankingPlayerDetail = {
    globalPlayerId, publishDate, scrapedAt: new Date().toISOString(), tournaments,
  }
  await writeRankingPlayerDetail(provider, detail)
  return detail
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug')
  const providerParam = (url.searchParams.get('provider') ?? 'bat') as ProviderTag
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })
  if (providerParam !== 'bat' && providerParam !== 'bwf') {
    return NextResponse.json({ error: 'unknown provider' }, { status: 400 })
  }

  const current = await readRankingCache(providerParam)
  if (!current) return NextResponse.json({ error: 'no current ranking' }, { status: 503 })

  let globalPlayerId: string
  if (providerParam === 'bat') {
    const disc = await discoverBatGlobalPlayerId(slug)
    if (disc.id === null) return NextResponse.json({ error: disc.reason }, { status: 404 })
    globalPlayerId = disc.id
  } else {
    const id = await lookupBwfGlobalPlayerId(slug)
    if (!id) return NextResponse.json({ error: 'not in any BWF ranking' }, { status: 404 })
    globalPlayerId = id
  }

  const cached = await readRankingPlayerDetail(providerParam, globalPlayerId)
  if (cached?.detail && cached.detail.publishDate === current.publishDate) {
    return NextResponse.json({ detail: cached.detail })
  }
  if (cached?.notFound && cached.notFound.publishDate === current.publishDate) {
    return NextResponse.json({ error: 'no detail page for this player' }, { status: 404 })
  }

  const dedupKey = `${providerParam}:${globalPlayerId}`
  let p = inflight.get(dedupKey)
  if (!p) {
    p = (async () => {
      try {
        return await fetchAndCache(providerParam, globalPlayerId, current.rankingId, current.publishDate)
      } finally {
        inflight.delete(dedupKey)
      }
    })()
    inflight.set(dedupKey, p)
  }

  try {
    const result = await p
    if ('notFound' in result) {
      await writeRankingPlayerNotFound(providerParam, globalPlayerId, current.publishDate)
      return NextResponse.json({ error: 'no detail page for this player' }, { status: 404 })
    }
    return NextResponse.json({ detail: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest api-players-ranking-detail-route --no-coverage
```

Expected: PASS (both pre-existing BAT tests and the new BWF tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/players/ranking-detail/route.ts __tests__/api-players-ranking-detail-route.test.ts
git commit -m "feat(api): ranking-detail route accepts ?provider=bat|bwf"
```

---

## Task 12: `RankingDetailTabs` takes a `provider` prop

**Files:**
- Modify: `components/RankingDetailTabs.tsx`

- [ ] **Step 1: Add `provider` to the Props interface and use it**

Open `components/RankingDetailTabs.tsx`. Apply these targeted edits:

Replace the import lines:
```ts
import {
  topRowsForTab,
  otherRowsForTab,
  computeExpiryCutoffs,
  classifyExpiry,
  type Discipline,
} from '@/lib/bat-ranking-player-view'
import type { BatRankingPlayerDetail } from '@/lib/types'
```
with:
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
```

Replace the `interface Props` block with:
```ts
interface Props {
  provider: ProviderTag
  slug: string
  initialDetail?: RankingPlayerDetail
  /** Upstream publication date string (BE for BAT, Gregorian for BWF). Used
   *  to compute which rows' points will fall out of the 52-week window. */
  rankingPublishDate?: string
}
```

Replace `BatRankingPlayerDetail` with `RankingPlayerDetail` wherever it appears in the file (in the `FetchState` union).

In the component signature, change `({ slug, initialDetail, rankingPublishDate })` to `({ provider, slug, initialDetail, rankingPublishDate })`.

In the useEffect, change the fetch URL from:
```ts
fetch(`/api/players/ranking-detail?slug=${encodeURIComponent(slug)}`, ...
```
to:
```ts
fetch(`/api/players/ranking-detail?provider=${provider}&slug=${encodeURIComponent(slug)}`, ...
```

Change the analytics call from:
```ts
track('ranking_detail_viewed', { provider: 'bat', slug, discipline: active })
```
to:
```ts
track('ranking_detail_viewed', { provider, slug, discipline: active })
```

Change the `computeExpiryCutoffs(rankingPublishDate)` call to thread the provider's date format:
```ts
const cutoffs = computeExpiryCutoffs(rankingPublishDate, getRankingConfig(provider).dateFormat)
```

- [ ] **Step 2: Compile-check**

```bash
npx tsc --noEmit
```

Expected: errors only in the *callers* of `RankingDetailTabs` (missing `provider` prop) — fixed in the next task.

- [ ] **Step 3: Commit**

```bash
git add components/RankingDetailTabs.tsx
git commit -m "refactor(components): RankingDetailTabs takes a provider prop"
```

---

## Task 13: Player page wires through provider for ranking lookup

**Files:**
- Modify: `app/player/[provider]/[slug]/page.tsx`

- [ ] **Step 1: Replace the file contents**

Replace `app/player/[provider]/[slug]/page.tsx` with:

```tsx
import { notFound } from 'next/navigation'
import { readIndexCache } from '@/lib/player-index-cache'
import { readRankingCache } from '@/lib/ranking/cache'
import { readRankingPlayerDetail } from '@/lib/ranking/player-cache'
import { readPlayerIdEntry } from '@/lib/bat-player-id-map'
import PlayerProfileView from '@/components/PlayerProfileView'
import type { ProviderTag, RankingPlayerRank, RankingPlayerDetail } from '@/lib/types'

interface Props { params: { provider: string; slug: string } }

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export default async function PlayerPage({ params }: Props) {
  const provider = params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) notFound()
  const index = await readIndexCache(provider)
  const record = index?.players[params.slug]
  if (!record) notFound()

  const playerRankings: RankingPlayerRank[] = []
  let rankingPublishDate = ''
  let initialDetail: RankingPlayerDetail | undefined

  const currentRanking = await readRankingCache(provider)
  if (currentRanking) {
    rankingPublishDate = currentRanking.publishDate
    let bwfGlobalPlayerId = ''
    for (const ev of currentRanking.events) {
      const entry = ev.entries.find(e => e.slug === params.slug)
      if (entry) {
        playerRankings.push({
          eventName: ev.eventName, rank: entry.rank, points: entry.points, tournaments: entry.tournaments,
        })
        if (entry.globalPlayerId) bwfGlobalPlayerId = entry.globalPlayerId
      }
    }

    // SSR pre-fetch the per-player detail when we already know the id and the
    // cache is fresh against the current publishDate. BAT gets its id from
    // the slug↔id map (built by the 3-hop discovery on first request); BWF
    // gets it from the entry we just scanned (no discovery needed).
    let globalPlayerId = ''
    if (provider === 'bat') {
      const idEntry = await readPlayerIdEntry(params.slug)
      globalPlayerId = idEntry?.globalPlayerId ?? ''
    } else if (provider === 'bwf') {
      globalPlayerId = bwfGlobalPlayerId
    }
    if (globalPlayerId) {
      const cached = await readRankingPlayerDetail(provider, globalPlayerId)
      if (cached?.detail && cached.detail.publishDate === currentRanking.publishDate) {
        initialDetail = cached.detail
      }
    }
  }

  return (
    <PlayerProfileView
      record={record}
      playerRankings={playerRankings.length ? playerRankings : undefined}
      rankingPublishDate={rankingPublishDate || undefined}
      initialDetail={initialDetail}
    />
  )
}

export const dynamic = 'force-dynamic'
```

- [ ] **Step 2: Update `PlayerProfileView` to accept the renamed prop and pass `provider` down**

Open `components/PlayerProfileView.tsx`. Replace:
```ts
import { weekKeyFromPublishDate } from '@/lib/bat-ranking-player-view'
```
with:
```ts
import { weekKeyFromPublishDate } from '@/lib/ranking/player-view'
import { getRankingConfig } from '@/lib/ranking/config'
```

Replace the `Props` interface block:
```ts
interface Props {
  record: PlayerRecord
  batRanking?: import('@/lib/types').BatRankingPlayerRank[]
  rankingPublishDate?: string
  initialDetail?: import('@/lib/types').BatRankingPlayerDetail
}
```
with:
```ts
interface Props {
  record: PlayerRecord
  playerRankings?: import('@/lib/types').RankingPlayerRank[]
  rankingPublishDate?: string
  initialDetail?: import('@/lib/types').RankingPlayerDetail
}
```

In the component signature, change `{ record, batRanking, rankingPublishDate, initialDetail }` to `{ record, playerRankings, rankingPublishDate, initialDetail }`.

Replace the line:
```ts
const rankingWeekKey = rankingPublishDate ? weekKeyFromPublishDate(rankingPublishDate) : null
```
with:
```ts
const rankingWeekKey = rankingPublishDate
  ? weekKeyFromPublishDate(rankingPublishDate, getRankingConfig(record.key.provider).dateFormat)
  : null
```

Replace every reference to `batRanking` with `playerRankings`. There are three: in the two `{batRanking && ...}` JSX guards and the `batRanking.map(...)`.

Replace the `record.key.provider === 'bat'` guard around `<RankingDetailTabs ...>` with no provider restriction (the panel now works for both providers):
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

- [ ] **Step 3: Compile-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/player/[provider]/[slug]/page.tsx components/PlayerProfileView.tsx
git commit -m "refactor(player): provider-aware ranking lookup and detail SSR"
```

---

## Task 14: Leaderboards page reads both ranking caches

**Files:**
- Modify: `app/leaderboards/page.tsx`
- Modify: `components/LeaderboardsView.tsx`

- [ ] **Step 1: Update leaderboards page**

Replace `app/leaderboards/page.tsx` with:

```tsx
import { readLeaderboardsCache } from '@/lib/player-index-cache'
import { readRankingCache } from '@/lib/ranking/cache'
import LeaderboardsView from '@/components/LeaderboardsView'
import type {
  Leaderboards, Ranking, RankingEvent, LeaderboardEntry, LeaderboardBoard, ProviderTag,
} from '@/lib/types'

const EMPTY: Leaderboards = { version: 1, provider: 'bat', generatedAt: 'never', sourceVersion: '', boards: [] }

const RANKING_BOARD_LIMIT = 30

function rankingEventToBoard(ev: RankingEvent): LeaderboardBoard {
  const entries: LeaderboardEntry[] = ev.entries.slice(0, RANKING_BOARD_LIMIT).map(e => ({
    rank: e.rank,
    slug: e.slug,
    name: e.name,
    primaryClub: e.club,
    value: e.points,
    display: e.points.toLocaleString() + ' pts',
    extra: `${e.tournaments} tn`,
  }))
  return {
    id: `ranking-${ev.eventCode.toLowerCase()}`,
    titleKey: ev.eventName,
    icon: '🏸',
    category: 'ranking',
    entries,
  }
}

function attachRanking(base: Leaderboards | null, ranking: Ranking | null): Leaderboards | null {
  if (!base) return null
  const rankingBoards = ranking?.events.map(rankingEventToBoard) ?? []
  return { ...base, boards: [...base.boards, ...rankingBoards] }
}

export default async function LeaderboardsPage() {
  const [bat, bwf, batRanking, bwfRanking] = await Promise.all([
    readLeaderboardsCache('bat'),
    readLeaderboardsCache('bwf'),
    readRankingCache('bat'),
    readRankingCache('bwf'),
  ])

  const providers: Leaderboards[] = []
  const withBat = attachRanking(bat, batRanking)
  if (withBat) providers.push(withBat)
  const withBwf = attachRanking(bwf, bwfRanking)
  if (withBwf) providers.push(withBwf)

  const rankingPublishDates: Partial<Record<ProviderTag, string>> = {}
  if (batRanking?.publishDate) rankingPublishDates.bat = batRanking.publishDate
  if (bwfRanking?.publishDate) rankingPublishDates.bwf = bwfRanking.publishDate

  return (
    <LeaderboardsView
      leaderboards={providers.length ? providers : [EMPTY]}
      rankingPublishDates={rankingPublishDates}
    />
  )
}

export const dynamic = 'force-dynamic'
```

- [ ] **Step 2: Update `LeaderboardsView` to take per-provider publish dates**

Open `components/LeaderboardsView.tsx`. Replace:
```ts
import { weekKeyFromPublishDate } from '@/lib/bat-ranking-player-view'
```
with:
```ts
import { weekKeyFromPublishDate } from '@/lib/ranking/player-view'
import { getRankingConfig } from '@/lib/ranking/config'
```

Replace the Props interface:
```ts
interface Props { leaderboards: Leaderboards[]; rankingPublishDate?: string }
```
with:
```ts
interface Props { leaderboards: Leaderboards[]; rankingPublishDates?: Partial<Record<ProviderTag, string>> }
```

Change the component signature destructure from `{ leaderboards, rankingPublishDate }` to `{ leaderboards, rankingPublishDates }`.

Replace the two lines computing the week key:
```ts
const rankingWeekKey = rankingPublishDate ? weekKeyFromPublishDate(rankingPublishDate) : null
```
with:
```ts
const activeRankingPublishDate = rankingPublishDates?.[activeProvider]
const rankingWeekKey = activeRankingPublishDate
  ? weekKeyFromPublishDate(activeRankingPublishDate, getRankingConfig(activeProvider).dateFormat)
  : null
```

In the JSX where the "as of" line renders, change:
```tsx
{effectiveActive === 'ranking' && rankingPublishDate && (
  <div className="lb-sub lb-ranking-asof">{t('lbRankingAsOf')} {rankingPublishDate}{rankingWeekKey && ` (${rankingWeekKey})`}</div>
)}
```
to:
```tsx
{effectiveActive === 'ranking' && activeRankingPublishDate && (
  <div className="lb-sub lb-ranking-asof">{t('lbRankingAsOf')} {activeRankingPublishDate}{rankingWeekKey && ` (${rankingWeekKey})`}</div>
)}
```

- [ ] **Step 3: Compile-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/leaderboards/page.tsx components/LeaderboardsView.tsx
git commit -m "feat(leaderboards): read both provider ranking caches"
```

---

## Task 15: Instrumentation runs one ranking poll per provider

**Files:**
- Modify: `instrumentation.ts`

- [ ] **Step 1: Replace the BAT-only ranking polling block**

Open `instrumentation.ts`. Find the comment that begins `// BAT ranking weekly refresh.` and the block ending at `setInterval(rankingTick, 30 * 60 * 1000)`.

Replace that entire block (down to and including `setInterval(rankingTick, 30 * 60 * 1000)` for BAT) with the provider-loop version:

```ts
// Ranking weekly refresh — one poll per provider. Each upstream publishes
// once a week (BAT on Tuesday, BWF on Wednesday in BKK time); we cheaply
// peek the overview page every 30 min inside the configured window and
// only fire the full per-category refresh when publishDate changes.
// See lib/ranking/scheduler.ts for the decision logic.
const { decideTick, decideBootKick, publishDateChanged } = await import('./lib/ranking/scheduler')
const { PROVIDER_CONFIG } = await import('./lib/ranking/config')
const { getBangkokClock } = await import('./lib/today')
const { rankingFetch } = await import('./lib/ranking/fetch')
const { parsePublishDate } = await import('./lib/ranking/scraper')
const { readRankingCache } = await import('./lib/ranking/cache')

const peekAndMaybeRefresh = async (provider: 'bat' | 'bwf') => {
  const cfg = PROVIDER_CONFIG[provider]
  try {
    const overviewRes = await rankingFetch(provider, 'poll-overview', cfg.overviewUrl)
    if (!overviewRes.ok) {
      console.log(`[ranking/${provider}/poll] overview status=${overviewRes.status}, skipping`)
      return
    }
    const html = await overviewRes.text()
    const upstreamPublishDate = parsePublishDate(html)
    const cached = await readRankingCache(provider)
    const cachedPublishDate = cached?.publishDate ?? null
    if (!publishDateChanged(cachedPublishDate, upstreamPublishDate)) {
      console.log(`[ranking/${provider}/poll] publishDate unchanged (${upstreamPublishDate || 'unparsable'}), no refresh`)
      return
    }
    console.log(`[ranking/${provider}/poll] new publishDate: ${cachedPublishDate ?? '(none)'} -> ${upstreamPublishDate}, triggering refresh`)
    const refreshRes = await fetch(`${origin}/api/ranking/${provider}/refresh?force=true`, { method: 'POST' })
    const body = await refreshRes.text()
    console.log(`[ranking/${provider}/poll] refresh status=${refreshRes.status} body=${body.slice(0, 200)}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.warn(`[ranking/${provider}/poll] tick failed: ${msg}`)
  }
}

for (const provider of ['bat', 'bwf'] as const) {
  const cfg = PROVIDER_CONFIG[provider]
  const tick = async () => {
    const action = decideTick({ clock: getBangkokClock(), schedule: cfg.pollSchedule })
    if (action === 'skip') return
    await peekAndMaybeRefresh(provider)
  }
  setTimeout(async () => {
    const cached = await readRankingCache(provider)
    const cacheAgeMs = cached ? Date.now() - new Date(cached.scrapedAt).getTime() : null
    const action = decideBootKick({ clock: getBangkokClock(), schedule: cfg.pollSchedule, cacheAgeMs })
    if (action === 'peek-and-maybe-refresh') {
      const ageHrs = cacheAgeMs === null ? 'no-cache' : `${(cacheAgeMs / 3_600_000).toFixed(1)}h`
      console.log(`[ranking/${provider}/poll] boot kick (cacheAge=${ageHrs})`)
      await peekAndMaybeRefresh(provider)
    }
  }, 45_000)
  setInterval(tick, 30 * 60 * 1000)
}
```

- [ ] **Step 2: Compile-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add instrumentation.ts
git commit -m "feat(instrumentation): run one ranking poll per provider"
```

---

## Task 16: Delete legacy BAT-ranking modules

**Files:**
- Delete: `lib/bat-ranking-cache.ts`
- Delete: `lib/bat-ranking-scheduler.ts`
- Delete: `lib/bat-ranking-scraper.ts`
- Delete: `lib/bat-ranking-player-cache.ts`
- Delete: `lib/bat-ranking-player-scraper.ts`
- Delete: `lib/bat-ranking-player-view.ts`
- Delete: `app/api/bat-ranking/refresh/route.ts` (and parent `bat-ranking/` directory)
- Delete: `__tests__/bat-ranking-cache.test.ts`
- Delete: `__tests__/bat-ranking-scheduler.test.ts`
- Delete: `__tests__/bat-ranking-scraper.test.ts`
- Delete: `__tests__/bat-ranking-player-cache.test.ts`
- Delete: `__tests__/bat-ranking-player-scraper.test.ts`
- Delete: `__tests__/bat-ranking-player-view.test.ts`
- Delete: `__tests__/api-bat-ranking-refresh-route.test.ts`

The old files are now superseded by `lib/ranking/*` and `app/api/ranking/[provider]/refresh/`. The provider-agnostic type aliases stay on `lib/types.ts` for one more cycle so external code that imported `BatRanking*` still type-checks.

- [ ] **Step 1: Verify nothing in app/lib/components/tests still imports the old paths**

Run:
```bash
grep -rn "bat-ranking-\|api/bat-ranking" app lib components __tests__ instrumentation.ts 2>/dev/null
```

Expected: no output. (If anything still imports, fix the import to point at `lib/ranking/...` before deleting.)

- [ ] **Step 2: Delete the legacy library files**

```bash
git rm lib/bat-ranking-cache.ts lib/bat-ranking-scheduler.ts lib/bat-ranking-scraper.ts \
  lib/bat-ranking-player-cache.ts lib/bat-ranking-player-scraper.ts lib/bat-ranking-player-view.ts
```

- [ ] **Step 3: Delete the legacy API route**

```bash
git rm app/api/bat-ranking/refresh/route.ts
rmdir app/api/bat-ranking/refresh app/api/bat-ranking 2>/dev/null || true
```

- [ ] **Step 4: Delete the legacy tests**

```bash
git rm __tests__/bat-ranking-cache.test.ts __tests__/bat-ranking-scheduler.test.ts \
  __tests__/bat-ranking-scraper.test.ts __tests__/bat-ranking-player-cache.test.ts \
  __tests__/bat-ranking-player-scraper.test.ts __tests__/bat-ranking-player-view.test.ts \
  __tests__/api-bat-ranking-refresh-route.test.ts
```

- [ ] **Step 5: Run the full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass. (Other test files might transitively import `@/lib/bat-ranking-*`; if any fail with `Cannot find module`, update the import and re-run.)

- [ ] **Step 6: Run TypeScript build**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(ranking): remove legacy bat-ranking-* modules"
```

---

## Task 17: Manual smoke test

**Files:** none — verification only.

- [ ] **Step 1: Start the dev server**

Run:
```bash
PORT=3000 npm run dev
```

Wait for `[bat-ranking-detail]` not to appear in logs (the old route is gone). Confirm two boot kicks fire (or are skipped because cache is fresh):

Expected log lines (approximate):
```
[ranking/bat/poll] boot kick (cacheAge=...)
[ranking/bwf/poll] boot kick (cacheAge=no-cache)
[ranking/bwf/refresh] ok eventsFound=… publishDate=03/06/2026
```

- [ ] **Step 2: Force a BWF refresh and inspect the cache**

```bash
curl -X POST 'http://localhost:3000/api/ranking/bwf/refresh?force=true'
ls -la .cache/players/ranking-bwf.json
jq '.provider, .publishDate, (.events|length), .events[0].entries[0].globalPlayerId' .cache/players/ranking-bwf.json
```

Expected: `"bwf"`, a Gregorian publish date, an event count > 5, and a non-empty numeric `globalPlayerId` on the first entry.

- [ ] **Step 3: Open the leaderboards page**

In a browser: `http://localhost:3000/leaderboards`. Click the **BWF** provider tab, then the **Ranking** sub-tab. Verify ~40 boards render with top-10 visible and "Show top 30" expand toggle.

- [ ] **Step 4: Click into a top-ranked BWF player**

From any BWF ranking board, click the #1 player. Expected: Current Ranking section appears at the top of the profile, the Ranking Detail tabs (Singles / Doubles / Mixed) render, and the active tab shows their top tournaments with points.

- [ ] **Step 5: Confirm BAT still works**

Click the **BAT** provider tab. Verify the Ranking sub-tab shows ~34 BAT boards. Click a BAT player and verify the BAT Ranking Detail (the existing path through `bat-player-id-map`) still loads.

- [ ] **Step 6: Final commit (if any pending changes)**

```bash
git status
# If clean, no commit needed. If smoke uncovered a fix, commit it now.
```

---

## Self-review notes (for the engineer running this plan)

This plan retires `lib/bat-ranking-*` in favor of provider-parameterized modules under `lib/ranking/`. Two things to keep in mind while executing:

1. **Order matters around Task 16.** Tasks 2–15 leave the old `lib/bat-ranking-*` files in place AND the new `lib/ranking/*` files alongside them. The aliases on `lib/types.ts` (Task 2) prevent type breakage during this overlap. Task 16 is the cleanup. Do not run Task 16 before 15 is committed and tests pass.

2. **`grep` before deleting in Task 16.** The Step 1 grep is intentionally repeated — if any new code in this plan accidentally imports an old path, finishing the deletion will break the build. Fix forward, don't `git checkout`.

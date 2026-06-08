# TBD Opponent Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the potential opponents ("A or B") inline on the empty side of a scheduled match when one player/team is waiting for the winner of a previous-round match.

**Architecture:** Add a bracket-HTML parser (`parseBracketFeeders`) that emits the two child matches per round-`R+1` slot. Cache per draw alongside the existing sibling lookup. In the schedule enrichment path (BAT only), use elimination-based side selection to determine which child match holds the populated player and stamp `tbdOpponents` from the *other* child. The MatchSchedule component renders this as a dimmer "A or B" line in the empty team slot.

**Tech Stack:** Next.js 14, React, TypeScript, Cheerio (HTML parsing), Jest (unit + jsdom rendering), Tailwind / global CSS.

**Spec:** `docs/superpowers/specs/2026-06-08-tbd-opponent-design.md`

---

## File Structure

**Created:**
- `__tests__/parseBracketFeeders.test.ts` — unit tests for the new parser, using a captured BAT bracket fixture.
- `__tests__/enrich-bracket-context.test.ts` — unit tests for the side-selection logic inside the schedule enrichment.
- `__tests__/MatchSchedule.tbdOpp.test.tsx` — rendering tests for the new UI branch.
- `fixtures/bracket-bat-ysb-bsu13.html` — captured BS U13 bracket HTML from the YONEX-SINGHA-BAT tournament (the spec's worked example).

**Modified:**
- `lib/scraper.ts` — add `parseBracketFeeders` plus `extractMatchTeams` and `extractFlatPlayerIds` helpers.
- `lib/bracket-cache.ts` — add `feederLookupCache` to the shared state and exports.
- `lib/types.ts` — add `tbdOpponents?: MatchPlayer[][]` to `MatchEntry`.
- `app/api/matches/route.ts` — rename `enrichWithSiblings` → `enrichBracketContext`, build feeder lookup in the same pass, stamp `tbdOpponents`.
- `components/MatchSchedule.tsx` — render `tbdOpponents` on empty team slots (desktop + mobile board).
- `lib/i18n.ts` — add `tbdOr` translation key.
- `app/globals.css` — add `.ms-tbd-opp` and `.ms-tbd-or` styles.
- `__tests__/api-matches-stale-fallback.test.ts` — extend the `lib/scraper` mock to stub `parseBracketFeeders` so the unrelated stale-fallback tests keep passing (does the same for the new parser as the file already does for `parseBracketSiblings`).
- `__tests__/api-matches-stale-fallback.test.ts` — extend the `lib/bracket-cache` mock to add `feederLookupCache`.

---

## Task 0: Capture the BAT bracket fixture

This MUST run first. All later tests assert against player IDs and names from
this fixture; without it the unit tests are guessing.

**Files:**
- Create: `fixtures/bracket-bat-ysb-bsu13.html`

- [ ] **Step 1: Identify the tournament slug and draw number**

The tournament is YONEX-SINGHA-BAT (the BAT Junior International 2026 event).
Find its slug by browsing `https://bat.tournamentsoftware.com/` and locating
the event. Then locate the BS U13 draw — its URL will look like
`https://bat.tournamentsoftware.com/tournament/<slug>/draw/<drawNum>`.

The bracket HTML endpoint we want is the same draw URL — that page contains
the bracket DOM that `parseBracket`/`parseBracketSiblings` parse.

- [ ] **Step 2: Download the bracket HTML**

Use curl (or open the URL in a browser, view-source, save). With a
browser-like UA matches what `bat-fetch.ts` sends. Example with curl:

```bash
curl -s \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' \
  -H 'Accept: text/html, */*; q=0.01' \
  'https://bat.tournamentsoftware.com/tournament/<slug>/draw/<drawNum>' \
  > fixtures/bracket-bat-ysb-bsu13.html
```

- [ ] **Step 3: Verify the fixture is a bracket page**

```bash
grep -c 'bracket-round__match-group-wrapper' fixtures/bracket-bat-ysb-bsu13.html
```

Expected: a positive integer (typically 15–63 depending on draw size). If 0,
re-fetch — the page might be the schedule view instead of the bracket view.

- [ ] **Step 4: Locate the worked example's player IDs**

Open the fixture and find the three players from the spec:
- ธัชธรรม์ เหมาะประสิทธิ์ (R64 player on 20/06)
- รณกร (R128 player waiting to play Wong Hao Feng RYAN)
- Wong Hao Feng RYAN (R128 player)

Each will appear as a link like `<a href="...&player=12345">`. Capture the
numeric player ID from each link. Record them — they'll be the literal
assertions in the parser test.

Example helper:

```bash
grep -oE 'player=([0-9]+)[^>]*>[^<]*ธัชธรรม' fixtures/bracket-bat-ysb-bsu13.html | head -3
grep -oE 'player=([0-9]+)[^>]*>[^<]*รณกร' fixtures/bracket-bat-ysb-bsu13.html | head -3
grep -oE 'player=([0-9]+)[^>]*>[^<]*Wong Hao Feng RYAN' fixtures/bracket-bat-ysb-bsu13.html | head -3
```

- [ ] **Step 5: Commit the fixture**

```bash
git add fixtures/bracket-bat-ysb-bsu13.html
git commit -m "test: add YONEX-SINGHA-BAT BS U13 bracket fixture"
```

---

## Task 1: Add `extractMatchTeams` and `extractFlatPlayerIds` helpers

**Files:**
- Modify: `lib/scraper.ts`

These helpers underpin `parseBracketFeeders`. They're pure functions over a
`.match` element from the bracket DOM. Build and test them in isolation first
so the larger parser test has solid building blocks.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/scraper.test.ts`:

```ts
import { extractMatchTeams, extractFlatPlayerIds } from '@/lib/scraper'
import * as cheerio from 'cheerio'

describe('extractMatchTeams', () => {
  it('returns two teams from a populated singles match element', () => {
    const html = `
      <div class="match">
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=11">Alpha</a></div>
        </div>
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=22">Beta</a></div>
        </div>
      </div>`
    const $ = cheerio.load(html)
    const teams = extractMatchTeams($, $('.match')[0])
    expect(teams).toEqual([
      [{ name: 'Alpha', playerId: '11' }],
      [{ name: 'Beta', playerId: '22' }],
    ])
  })

  it('drops teams whose players all have empty names (bye row)', () => {
    const html = `
      <div class="match">
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=11">Alpha</a></div>
        </div>
        <div class="match__row">
          <div class="match__row-title-value"><a></a></div>
        </div>
      </div>`
    const $ = cheerio.load(html)
    const teams = extractMatchTeams($, $('.match')[0])
    expect(teams).toEqual([[{ name: 'Alpha', playerId: '11' }]])
  })

  it('returns two players per team for doubles', () => {
    const html = `
      <div class="match">
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=11">A1</a></div>
          <div class="match__row-title-value"><a href="?player=12">A2</a></div>
        </div>
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=21">B1</a></div>
          <div class="match__row-title-value"><a href="?player=22">B2</a></div>
        </div>
      </div>`
    const $ = cheerio.load(html)
    const teams = extractMatchTeams($, $('.match')[0])
    expect(teams).toEqual([
      [{ name: 'A1', playerId: '11' }, { name: 'A2', playerId: '12' }],
      [{ name: 'B1', playerId: '21' }, { name: 'B2', playerId: '22' }],
    ])
  })
})

describe('extractFlatPlayerIds', () => {
  it('returns all player IDs across both rows', () => {
    const html = `
      <div class="match">
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=11">Alpha</a></div>
        </div>
        <div class="match__row">
          <div class="match__row-title-value"><a href="?player=22">Beta</a></div>
        </div>
      </div>`
    const $ = cheerio.load(html)
    expect(extractFlatPlayerIds($, $('.match')[0])).toEqual(['11', '22'])
  })

  it('skips links without a player= query parameter', () => {
    const html = `
      <div class="match">
        <div class="match__row">
          <div class="match__row-title-value"><a href="/no-id">No</a></div>
        </div>
      </div>`
    const $ = cheerio.load(html)
    expect(extractFlatPlayerIds($, $('.match')[0])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/scraper.test.ts -t 'extractMatchTeams|extractFlatPlayerIds'
```

Expected: FAIL with "extractMatchTeams is not a function" (and similar for
`extractFlatPlayerIds`).

- [ ] **Step 3: Implement the helpers in `lib/scraper.ts`**

Add near the existing `parseBracketSiblings`:

```ts
// Extracts each row's named players from a bracket .match element.
// Returns MatchPlayer[][] where the outer array is teams (rows) and the
// inner is players within that team. Drops slots with empty names and
// drops whole teams that end up empty (bye rows).
//
// Used by parseBracketFeeders to expose the two teams of a prior-round
// child match as candidate opponents.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractMatchTeams($: cheerio.CheerioAPI, matchEl: any): MatchPlayer[][] {
  const teams: MatchPlayer[][] = []
  $(matchEl).find('.match__row').each((_, row) => {
    const players: MatchPlayer[] = []
    $(row).find('.match__row-title-value').each((_, tv) => {
      const a = $(tv).find('a')
      const name = a.find('.nav-link__value').length
        ? a.find('.nav-link__value').first().text().trim()
        : a.text().trim()
      const hrefMatch = (a.attr('href') ?? '').match(/player=(\d+)/)
      if (name) players.push({ name, playerId: hrefMatch ? hrefMatch[1] : '' })
    })
    if (players.length > 0) teams.push(players)
  })
  return teams
}

// Flat list of every player ID inside a .match element (both rows).
// Same shape as parseBracketSiblings's inner walk — used to build the
// join key against the schedule's matchPlayerKey.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractFlatPlayerIds($: cheerio.CheerioAPI, matchEl: any): string[] {
  const ids: string[] = []
  $(matchEl).find('.match__row a').each((_, a) => {
    const hrefMatch = ($(a).attr('href') ?? '').match(/player=(\d+)/)
    if (hrefMatch) ids.push(hrefMatch[1])
  })
  return ids
}
```

Both functions need access to the `MatchPlayer` type, which is already
imported at the top of `lib/scraper.ts`. Verify by searching the file:

```bash
grep -n "MatchPlayer" lib/scraper.ts | head -3
```

If `MatchPlayer` isn't imported, add it:

```ts
import type { ..., MatchPlayer, ... } from './types'
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/scraper.test.ts -t 'extractMatchTeams|extractFlatPlayerIds'
```

Expected: all six tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scraper.ts __tests__/scraper.test.ts
git commit -m "feat(scraper): extractMatchTeams and extractFlatPlayerIds helpers"
```

---

## Task 2: Add `parseBracketFeeders` parser

**Files:**
- Modify: `lib/scraper.ts`
- Create: `__tests__/parseBracketFeeders.test.ts`

- [ ] **Step 1: Write the failing test against the fixture**

Create `__tests__/parseBracketFeeders.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import { parseBracketFeeders } from '@/lib/scraper'

const fixtureHtml = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

// IMPORTANT: Replace these IDs with the real values from Task 0 step 4.
const THATCHATHAM_ID = '<thatchatham-player-id>'   // ธัชธรรม์
const RONAKORN_ID    = '<ronakorn-player-id>'      // รณกร
const RYAN_ID        = '<ryan-player-id>'          // Wong Hao Feng RYAN

describe('parseBracketFeeders', () => {
  it('returns empty array when no bracket markup is present', () => {
    expect(parseBracketFeeders('<html><body>not a bracket</body></html>')).toEqual([])
  })

  it('emits one entry per R+1 slot with both child matches attached', () => {
    const html = fixtureHtml('bracket-bat-ysb-bsu13.html')
    const entries = parseBracketFeeders(html)

    // The R64 match containing ธัชธรรม์ — find the entry whose flat
    // players list contains his ID.
    const r64 = entries.find((e) => e.players.includes(THATCHATHAM_ID))
    expect(r64).toBeDefined()
    expect(r64!.childMatches).toHaveLength(2)

    // One child contains ธัชธรรม์; the other contains รณกร + RYAN.
    const childIds = r64!.childMatches.map((child) =>
      child.flat().map((p) => p.playerId),
    )
    const selfChild = childIds.find((ids) => ids.includes(THATCHATHAM_ID))
    const otherChild = childIds.find((ids) => !ids.includes(THATCHATHAM_ID))
    expect(selfChild).toBeDefined()
    expect(otherChild).toBeDefined()
    expect(otherChild!.sort()).toEqual([RONAKORN_ID, RYAN_ID].sort())
  })

  it('emits sorted player IDs as the join key', () => {
    const html = fixtureHtml('bracket-bat-ysb-bsu13.html')
    const entries = parseBracketFeeders(html)
    for (const e of entries) {
      const sorted = [...e.players].sort()
      expect(e.players).toEqual(sorted)
    }
  })
})
```

**Before running:** replace the three `<...-player-id>` placeholders with
the actual numeric IDs captured in Task 0 Step 4.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/parseBracketFeeders.test.ts
```

Expected: FAIL with "parseBracketFeeders is not a function" (or
"undefined").

- [ ] **Step 3: Implement `parseBracketFeeders` in `lib/scraper.ts`**

Add immediately after `parseBracketSiblings`:

```ts
// For each round-R+1 slot in a bracket, returns the two R-round child
// matches whose winners feed it. Side selection (which child holds the
// populated player, which holds the candidate opponents) is done by
// elimination at stamp time in the schedule enricher — not here.
//
// `players` is the sorted flat list of player IDs for the R+1 match,
// used to join against the schedule's matchPlayerKey.
// `childMatches` is exactly the 2 R-round matches in the wrapper that
// feeds this R+1 slot, each as MatchPlayer[][] (teams × players).
export function parseBracketFeeders(
  html: string,
): Array<{ players: string[]; childMatches: MatchPlayer[][][] }> {
  const $ = cheerio.load(html, { xmlMode: false })
  const bracket = $('.bracket.js-bracket')
  if (!bracket.length) return []

  const slides = bracket.find('swiper-container > swiper-slide')
    .filter((_, slide) =>
      $(slide).find('.bracket-round__match-group-wrapper').length > 0,
    )

  const result: Array<{ players: string[]; childMatches: MatchPlayer[][][] }> = []

  for (let r = 0; r < slides.length - 1; r++) {
    const rSlide  = slides.eq(r)
    const r1Slide = slides.eq(r + 1)

    const rGroups = rSlide.find('.bracket-round__match-group-wrapper')
    // Flat list of every R+1 match in DOM order; index `gi` is the R+1
    // match fed by rGroups[gi].
    const r1Matches = r1Slide.find('.bracket-round__match-group-wrapper .match')

    rGroups.each((gi, group) => {
      const childMatchEls = $(group).find('.match')
      if (childMatchEls.length !== 2) return

      const childMatches: MatchPlayer[][][] = []
      childMatchEls.each((_, child) => {
        childMatches.push(extractMatchTeams($, child))
      })

      const r1Match = r1Matches.eq(gi)
      if (!r1Match.length) return
      const r1PlayerIds = extractFlatPlayerIds($, r1Match[0]).slice().sort()
      if (r1PlayerIds.length === 0) return

      result.push({ players: r1PlayerIds, childMatches })
    })
  }

  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/parseBracketFeeders.test.ts
```

Expected: all three tests PASS. If the worked-example test fails, double-check
the player IDs and re-inspect the fixture to confirm the bracket structure
matches expectations.

- [ ] **Step 5: Commit**

```bash
git add lib/scraper.ts __tests__/parseBracketFeeders.test.ts
git commit -m "feat(scraper): parseBracketFeeders for prior-round opponents"
```

---

## Task 3: Add `feederLookupCache` to `lib/bracket-cache.ts`

**Files:**
- Modify: `lib/bracket-cache.ts`

The cache holds, per draw, a Map from "R+1 join key" to the unfiltered pair
of child matches. Mirrors how `siblingLookupCache` is structured today.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/bracket-cache.test.ts`:

```ts
import { feederLookupCache } from '@/lib/bracket-cache'
import type { MatchPlayer } from '@/lib/types'

describe('feederLookupCache', () => {
  it('exposes a globalThis-backed Map shared across imports', () => {
    expect(feederLookupCache).toBeInstanceOf(Map)
  })

  it('round-trips a per-draw feeder lookup', () => {
    const childMatches: MatchPlayer[][][] = [
      [[{ name: 'A1', playerId: '11' }]],
      [[{ name: 'B1', playerId: '21' }]],
    ]
    const lookup = new Map<string, MatchPlayer[][][]>([['11,21', childMatches]])
    feederLookupCache.set('TID:1', { lookup, ts: 12345 })
    const got = feederLookupCache.get('TID:1')
    expect(got?.ts).toBe(12345)
    expect(got?.lookup.get('11,21')).toEqual(childMatches)
    feederLookupCache.delete('TID:1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/bracket-cache.test.ts -t 'feederLookupCache'
```

Expected: FAIL with "feederLookupCache is not exported" (or similar).

- [ ] **Step 3: Add the cache to `lib/bracket-cache.ts`**

Update the `BracketCacheState` interface (around line 25) to include the new
map:

```ts
interface BracketCacheState {
  cache: Map<string, BracketCacheEntry>
  rawHtmlCache: Map<string, string>
  playerClubCache: Map<string, string>
  playerNameCache: Map<string, string>
  siblingLookupCache: Map<string, { lookup: Map<string, string>; ts: number }>
  feederLookupCache: Map<
    string,
    { lookup: Map<string, import('./types').MatchPlayer[][][]>; ts: number }
  >
  dirty: boolean
  flushTimer: NodeJS.Timeout | null
}
```

Update the `state` initializer (around line 35) to include the new map:

```ts
const state: BracketCacheState = globalState.__bracketCacheState ??= {
  cache: new Map(),
  rawHtmlCache: new Map(),
  playerClubCache: new Map(),
  playerNameCache: new Map(),
  siblingLookupCache: new Map(),
  feederLookupCache: new Map(),
  dirty: false,
  flushTimer: null,
}
```

Add the export next to `siblingLookupCache` (around line 122):

```ts
export const feederLookupCache = state.feederLookupCache
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/bracket-cache.test.ts -t 'feederLookupCache'
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bracket-cache.ts __tests__/bracket-cache.test.ts
git commit -m "feat(bracket-cache): add feederLookupCache"
```

---

## Task 4: Extend `MatchEntry` type with `tbdOpponents`

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Update the type**

In `lib/types.ts`, locate `MatchEntry` (around line 63). After the existing
`siblingPlayerIds?: string` line, add:

```ts
  // Potential opponents from the bracket's prior round when one side of the
  // match has no players yet (waiting on a previous-round match to resolve).
  // Length 1 means the other prior-round side was a bye or itself TBD.
  tbdOpponents?: MatchPlayer[][]
```

- [ ] **Step 2: Verify TypeScript still compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. (A pre-existing benign error is OK; no new errors from
this change.)

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add tbdOpponents to MatchEntry"
```

---

## Task 5: Build feeder side-selection in schedule enrichment

**Files:**
- Modify: `app/api/matches/route.ts`
- Create: `__tests__/enrich-bracket-context.test.ts`

The side-selection logic — given a schedule entry with exactly one team empty
and the two cached child matches, decide which child holds the candidates —
is the trickiest piece. Extract it as a pure helper so it can be tested
without mocking the whole route.

- [ ] **Step 1: Write the failing test**

Create `__tests__/enrich-bracket-context.test.ts`:

```ts
import { selectTbdCandidates } from '@/app/api/matches/route'
import type { MatchPlayer } from '@/lib/types'

const p = (id: string, name = id): MatchPlayer => ({ name, playerId: id })

describe('selectTbdCandidates', () => {
  const childA = [[p('1'), p('2')]]                // team that's Alpha + Beta
  const childB = [[p('3')], [p('4')]]              // teams 3 vs 4

  it('returns candidates from the OTHER child when populated player is in child A', () => {
    const result = selectTbdCandidates([p('1')], [childA, childB])
    expect(result).toEqual([[p('3')], [p('4')]])
  })

  it('returns candidates from the OTHER child when populated player is in child B', () => {
    const result = selectTbdCandidates([p('3')], [childA, childB])
    expect(result).toEqual([[p('1'), p('2')]])
  })

  it('returns null when populated player appears in neither child', () => {
    const result = selectTbdCandidates([p('99')], [childA, childB])
    expect(result).toBeNull()
  })

  it('returns null when populated player appears in both children', () => {
    const both = [[[p('5')]], [[p('5'), p('6')]]]
    const result = selectTbdCandidates([p('5')], both)
    expect(result).toBeNull()
  })

  it('filters out empty teams from the candidate result', () => {
    const childWithEmpty = [[p('7')], []]            // one real team, one empty
    const result = selectTbdCandidates([p('1')], [[[p('1')]], childWithEmpty])
    expect(result).toEqual([[p('7')]])
  })

  it('returns null when filtered candidates would be empty', () => {
    const bothEmpty: MatchPlayer[][][] = [[[p('1')]], []]
    const result = selectTbdCandidates([p('1')], bothEmpty)
    expect(result).toBeNull()
  })

  it('returns null when childMatches does not have exactly 2 entries', () => {
    expect(selectTbdCandidates([p('1')], [[[p('1')]]] as MatchPlayer[][][])).toBeNull()
    expect(selectTbdCandidates([p('1')], [] as MatchPlayer[][][])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/enrich-bracket-context.test.ts
```

Expected: FAIL with "selectTbdCandidates is not exported".

- [ ] **Step 3: Export `selectTbdCandidates` from `app/api/matches/route.ts`**

Add this helper near the top of `app/api/matches/route.ts`, between
`matchPlayerKey` and `enrichWithSiblings`:

```ts
// Given the populated team of a R+1 schedule match and the two R-round
// child matches that feed it, return the candidate opponents — the OTHER
// child's teams — or null when the side is ambiguous (populated player in
// neither child, or in both).
export function selectTbdCandidates(
  populated: import('@/lib/types').MatchPlayer[],
  childMatches: import('@/lib/types').MatchPlayer[][][],
): import('@/lib/types').MatchPlayer[][] | null {
  if (childMatches.length !== 2) return null

  const populatedIds = new Set(
    populated.map((p) => p.playerId).filter(Boolean),
  )
  if (populatedIds.size === 0) return null

  const selfIdxs: number[] = []
  for (let i = 0; i < 2; i++) {
    const childIds = childMatches[i].flat().map((p) => p.playerId).filter(Boolean)
    if (childIds.some((id) => populatedIds.has(id))) selfIdxs.push(i)
  }
  if (selfIdxs.length !== 1) return null

  const otherIdx = selfIdxs[0] === 0 ? 1 : 0
  const candidates = childMatches[otherIdx].filter((team) => team.length > 0)
  if (candidates.length === 0) return null
  return candidates
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/enrich-bracket-context.test.ts
```

Expected: all seven tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/matches/route.ts __tests__/enrich-bracket-context.test.ts
git commit -m "feat(matches): selectTbdCandidates side-selection helper"
```

---

## Task 6: Wire feeder enrichment into the per-day matches route

**Files:**
- Modify: `app/api/matches/route.ts`
- Modify: `__tests__/api-matches-stale-fallback.test.ts` (update mocks)

This task hooks `parseBracketFeeders` + `selectTbdCandidates` into the
existing per-draw bracket walk. The existing `enrichWithSiblings` is renamed
to `enrichBracketContext` (since it now does both jobs) and the new logic
shares the same try/catch, the same per-draw error suppression, and the
same `rawHtmlCache` lookup.

- [ ] **Step 1: Update the stale-fallback test mocks first**

Edit `__tests__/api-matches-stale-fallback.test.ts`:

In the `lib/bracket-cache` mock (around line 27), add `feederLookupCache`:

```ts
jest.mock('../lib/bracket-cache', () => ({
  cache: { get: jest.fn(() => null) },
  rawHtmlCache: { get: jest.fn(() => null) },
  siblingLookupCache: { get: jest.fn(() => null), set: jest.fn() },
  feederLookupCache: { get: jest.fn(() => null), set: jest.fn() },
  fetchAndCache: jest.fn().mockResolvedValue(undefined),
  makeBracketKey: jest.fn((t: string, d: string) => `${t}:${d}`),
}))
```

In the `lib/scraper` mock (around line 34), add `parseBracketFeeders`:

```ts
jest.mock('../lib/scraper', () => ({
  parseMatchesFull: jest.fn(() => ({
    days: [{ date: '25690602', label: '02/06', dateIso: '2026-06-02', hasMatches: true }],
    currentDate: '25690602',
    groups: [{ type: 'time', time: '10:00', matches: [] }],
  })),
  parseMatchesPartial: jest.fn(() => ({
    groups: [{ type: 'time', time: '10:00', matches: [] }],
  })),
  parseBracketSiblings: jest.fn(() => []),
  parseBracketFeeders: jest.fn(() => []),
}))
```

- [ ] **Step 2: Verify the stale-fallback tests still pass with the new mocks**

```bash
npx jest __tests__/api-matches-stale-fallback.test.ts
```

Expected: all tests PASS. They should — we just added stubs for new
imports that the route doesn't yet reference.

- [ ] **Step 3: Rename `enrichWithSiblings` and extend it for feeders**

In `app/api/matches/route.ts`:

Update the import (around line 3) to include `parseBracketFeeders` and
`feederLookupCache`:

```ts
import { parseMatchesFull, parseMatchesPartial, parseBracketSiblings, parseBracketFeeders } from '@/lib/scraper'
import { cache as bracketCache, fetchAndCache, rawHtmlCache, siblingLookupCache, feederLookupCache, makeBracketKey } from '@/lib/bracket-cache'
```

Add `MatchPlayer` to the type import (around line 10):

```ts
import type { MatchScheduleGroup, MatchEntry, MatchesData, MatchPlayer } from '@/lib/types'
```

Rename the function (`enrichWithSiblings` → `enrichBracketContext`) and
extend it. Replace the entire body (lines ~99–157) with:

```ts
// For each unique drawNum in `groups`, pull the bracket from cache (or fetch
// it), extract sibling pairs AND feeder candidates, and stamp
// `siblingPlayerIds` + `tbdOpponents` onto each schedule match. Failures per
// draw are swallowed so one broken bracket doesn't sink the whole schedule.
async function enrichBracketContext(
  tournamentId: string,
  groups: MatchScheduleGroup[],
): Promise<void> {
  const drawNums = new Set<string>()
  for (const g of groups) {
    for (const m of g.matches) {
      if (m.drawNum) drawNums.add(m.drawNum)
    }
  }
  if (drawNums.size === 0) return

  const siblingByDraw = new Map<string, Map<string, string>>()
  const feederByDraw = new Map<string, Map<string, MatchPlayer[][][]>>()

  await Promise.all(
    Array.from(drawNums).map(async (drawNum) => {
      try {
        const key = makeBracketKey(tournamentId, drawNum)
        let html = rawHtmlCache.get(key)
        if (!html) {
          await fetchAndCache(tournamentId, drawNum)
          html = rawHtmlCache.get(key)
        }
        if (!html) return

        const bracketTs = bracketCache.get(key)?.ts ?? 0

        // Siblings (existing logic).
        const cachedSibling = siblingLookupCache.get(key)
        let siblingLookup = cachedSibling && cachedSibling.ts === bracketTs ? cachedSibling.lookup : null
        if (!siblingLookup) {
          const pairs = parseBracketSiblings(html)
          siblingLookup = new Map<string, string>()
          for (const p of pairs) {
            siblingLookup.set(p.players.join(','), p.siblingPlayers.join(','))
          }
          if (siblingLookup.size > 0) siblingLookupCache.set(key, { lookup: siblingLookup, ts: bracketTs })
        }
        if (siblingLookup.size > 0) siblingByDraw.set(drawNum, siblingLookup)

        // Feeders (new).
        const cachedFeeder = feederLookupCache.get(key)
        let feederLookup = cachedFeeder && cachedFeeder.ts === bracketTs ? cachedFeeder.lookup : null
        if (!feederLookup) {
          const entries = parseBracketFeeders(html)
          feederLookup = new Map<string, MatchPlayer[][][]>()
          for (const e of entries) feederLookup.set(e.players.join(','), e.childMatches)
          if (feederLookup.size > 0) feederLookupCache.set(key, { lookup: feederLookup, ts: bracketTs })
        }
        if (feederLookup.size > 0) feederByDraw.set(drawNum, feederLookup)
      } catch {
        // ignore — this draw just won't have sibling/feeder info
      }
    }),
  )

  for (const g of groups) {
    for (const m of g.matches) {
      if (!m.drawNum) continue
      const key = matchPlayerKey(m)
      if (!key) continue

      const siblingLookup = siblingByDraw.get(m.drawNum)
      if (siblingLookup) {
        const sibling = siblingLookup.get(key)
        if (sibling) m.siblingPlayerIds = sibling
      }

      const feederLookup = feederByDraw.get(m.drawNum)
      if (feederLookup) {
        const onlyOneSideEmpty =
          (m.team1.length === 0) !== (m.team2.length === 0)
        if (onlyOneSideEmpty) {
          const childMatches = feederLookup.get(key)
          if (childMatches) {
            const populated = m.team1.length > 0 ? m.team1 : m.team2
            const candidates = selectTbdCandidates(populated, childMatches)
            if (candidates) m.tbdOpponents = candidates
          }
        }
      }
    }
  }
}
```

Update the call site (around line 245) from `enrichWithSiblings` to
`enrichBracketContext`:

```ts
await enrichBracketContext(tournamentId, data.groups)
```

- [ ] **Step 4: Verify all `/api/matches` route tests still pass**

```bash
npx jest __tests__/api-matches-stale-fallback.test.ts
```

Expected: all PASS. (The mocks now stub `parseBracketFeeders` so the
extended enrichment doesn't crash; the stale-fallback paths haven't
changed.)

- [ ] **Step 5: Add an end-to-end test for the new enrichment**

Append to `__tests__/enrich-bracket-context.test.ts`:

```ts
// (Other imports at the top of the file already.)

// This is a behavioral test against the worked example: feed a schedule
// match for ธัชธรรม์'s R64 with empty team2 plus the cached feeder lookup
// from parseBracketFeeders, and verify selectTbdCandidates produces the
// expected pair.
import fs from 'fs'
import path from 'path'
import { parseBracketFeeders } from '@/lib/scraper'

// Same IDs as in __tests__/parseBracketFeeders.test.ts (Task 2).
const THATCHATHAM_ID = '<thatchatham-player-id>'
const RONAKORN_ID    = '<ronakorn-player-id>'
const RYAN_ID        = '<ryan-player-id>'

describe('enrichBracketContext (worked example via selectTbdCandidates)', () => {
  it('resolves ธัชธรรม์ R64 to รณกร + Wong Hao Feng RYAN as TBD opponents', () => {
    const html = fs.readFileSync(
      path.join(process.cwd(), 'fixtures', 'bracket-bat-ysb-bsu13.html'),
      'utf-8',
    )
    const entries = parseBracketFeeders(html)
    const r64 = entries.find((e) => e.players.includes(THATCHATHAM_ID))
    expect(r64).toBeDefined()

    const populated = [p(THATCHATHAM_ID, 'ธัชธรรม์')]
    const candidates = selectTbdCandidates(populated, r64!.childMatches)
    expect(candidates).not.toBeNull()
    const flatIds = candidates!.flat().map((q) => q.playerId).sort()
    expect(flatIds).toEqual([RONAKORN_ID, RYAN_ID].sort())
  })
})
```

Replace the placeholder IDs as in Task 2.

- [ ] **Step 6: Run new test**

```bash
npx jest __tests__/enrich-bracket-context.test.ts
```

Expected: PASS — including the worked-example case.

- [ ] **Step 7: Commit**

```bash
git add app/api/matches/route.ts __tests__/api-matches-stale-fallback.test.ts __tests__/enrich-bracket-context.test.ts
git commit -m "feat(matches): enrich schedule with tbdOpponents from bracket"
```

---

## Task 7: Add `tbdOr` i18n key

**Files:**
- Modify: `lib/i18n.ts`

- [ ] **Step 1: Add the key to the type union**

In `lib/i18n.ts`, locate the union starting around line 100. Insert after
`'vsMatch'`:

```ts
  | 'vsMatch'
  | 'tbdOr'
```

- [ ] **Step 2: Add the English translation**

Find the English translations block (around line 305 where `walkover` lives).
Add near `vsMatch`:

```ts
    vsMatch: 'vs.',
    tbdOr: 'or',
```

- [ ] **Step 3: Add the Thai translation**

Find the Thai block (around line 544 where `vsMatch` is `'พบ'`). Add:

```ts
    vsMatch: 'พบ',
    tbdOr: 'หรือ',
```

- [ ] **Step 4: Verify TypeScript still compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors. If TypeScript complains that a translation table
is missing the key, you didn't add it to both EN and TH; fix and re-run.

- [ ] **Step 5: Commit**

```bash
git add lib/i18n.ts
git commit -m "i18n: add tbdOr (\"or\" / \"หรือ\") for TBD opponent line"
```

---

## Task 8: Render `tbdOpponents` in `MatchSchedule.tsx`

**Files:**
- Modify: `components/MatchSchedule.tsx`
- Create: `__tests__/MatchSchedule.tbdOpp.test.tsx`

- [ ] **Step 1: Write the failing rendering test**

Create `__tests__/MatchSchedule.tbdOpp.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react'
import MatchSchedule from '@/components/MatchSchedule'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { MatchScheduleGroup, MatchEntry, MatchPlayer } from '@/lib/types'

const player = (name: string, playerId = name): MatchPlayer => ({ name, playerId })

function entry(opts: {
  team1?: MatchPlayer[]
  team2?: MatchPlayer[]
  tbdOpponents?: MatchPlayer[][]
}): MatchEntry {
  return {
    draw: 'BS U13', drawNum: '1', round: 'R64',
    team1: opts.team1 ?? [],
    team2: opts.team2 ?? [],
    winner: null, scores: [],
    court: '', walkover: false, retired: false,
    nowPlaying: false,
    tbdOpponents: opts.tbdOpponents,
  }
}

const group = (m: MatchEntry): MatchScheduleGroup =>
  ({ type: 'time', time: '10:00', matches: [m] })

const renderMS = (m: MatchEntry) =>
  render(
    <LanguageProvider>
      <MatchSchedule
        groups={[group(m)]}
        days={[]} selectedDay="" onDayChange={() => {}}
        loading={false} playerQuery=""
      />
    </LanguageProvider>,
  )

describe('MatchSchedule — tbdOpponents', () => {
  it('renders two candidates joined by " or " when team2 is empty and two candidates exist', () => {
    const m = entry({
      team1: [player('Alpha')],
      tbdOpponents: [[player('Cathy')], [player('Dale')]],
    })
    const { container } = renderMS(m)
    const tbd = container.querySelector('.ms-team--2 .ms-tbd-opp')
    expect(tbd).not.toBeNull()
    expect(tbd!.textContent).toContain('Cathy')
    expect(tbd!.textContent).toContain('Dale')
    expect(container.querySelector('.ms-tbd-or')).not.toBeNull()
  })

  it('renders without an "or" separator when only one candidate is provided', () => {
    const m = entry({
      team1: [player('Alpha')],
      tbdOpponents: [[player('Cathy')]],
    })
    const { container } = renderMS(m)
    const tbd = container.querySelector('.ms-team--2 .ms-tbd-opp')
    expect(tbd).not.toBeNull()
    expect(tbd!.textContent).toContain('Cathy')
    expect(container.querySelector('.ms-tbd-or')).toBeNull()
  })

  it('joins doubles partners with "/"', () => {
    const m = entry({
      team1: [player('Alpha1'), player('Alpha2')],
      tbdOpponents: [[player('C1'), player('C2')], [player('D1'), player('D2')]],
    })
    const { container } = renderMS(m)
    const tbd = container.querySelector('.ms-team--2 .ms-tbd-opp')
    expect(tbd).not.toBeNull()
    // The "/" between partners surfaces in the rendered text.
    expect(tbd!.textContent).toContain('C1/C2')
    expect(tbd!.textContent).toContain('D1/D2')
  })

  it('renders on team1 when team1 is empty and team2 is populated', () => {
    const m = entry({
      team2: [player('Beta')],
      tbdOpponents: [[player('Cathy')], [player('Dale')]],
    })
    const { container } = renderMS(m)
    expect(container.querySelector('.ms-team--1 .ms-tbd-opp')).not.toBeNull()
    expect(container.querySelector('.ms-team--2 .ms-tbd-opp')).toBeNull()
  })

  it('does NOT render anything special when tbdOpponents is absent', () => {
    const m = entry({ team1: [player('Alpha')], team2: [], tbdOpponents: undefined })
    const { container } = renderMS(m)
    expect(container.querySelector('.ms-tbd-opp')).toBeNull()
  })

  it('does NOT render anything special when both sides are empty', () => {
    const m = entry({
      tbdOpponents: [[player('Cathy')], [player('Dale')]],
    })
    const { container } = renderMS(m)
    expect(container.querySelector('.ms-tbd-opp')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/MatchSchedule.tbdOpp.test.tsx
```

Expected: FAIL — `.ms-tbd-opp` not found in any rendered output.

- [ ] **Step 3: Implement the rendering branch**

In `components/MatchSchedule.tsx`, define a small helper inside the
component, just above `renderMatch` (after `nameCls`/`flag`/`teamTooltip`):

```tsx
  const renderTbdOpp = (candidates: MatchPlayer[][]) => (
    <div className="ms-tbd-opp">
      {candidates.map((team, i) => (
        <span key={i}>
          {i > 0 && <span className="ms-tbd-or"> {t('tbdOr')} </span>}
          {team.map((p, j) => (
            <span key={j}>
              {j > 0 && '/'}
              <span>{p.name}</span>
            </span>
          ))}
        </span>
      ))}
    </div>
  )
```

Add `MatchPlayer` to the type import at the top of the file:

```ts
import type { MatchScheduleGroup, MatchDay, MatchEntry, MatchPlayer } from '@/lib/types'
```

In `renderMatch`, replace the desktop team1 block (around line 319):

```tsx
      <div className={`ms-team ms-team--1 ms-d${m.winner === 1 ? ' winner' : ''}`}>
        {m.team1.length === 0 && m.team2.length > 0 && m.tbdOpponents && m.tbdOpponents.length > 0
          ? renderTbdOpp(m.tbdOpponents)
          : m.team1.map((p, i) => (
              <div key={i}>{flag(p)}<span className={nameCls(p)} title={teamTooltip(p)} onClick={onPlayerClick && p.playerId ? (e) => { e.stopPropagation(); recordMatchView(m); onPlayerClick(p.playerId) } : undefined}>{medal(1)}{p.name}</span>{i === 0 && m.winner === 1 && <span className="ms-team-dot" aria-label="winner" />}</div>
            ))}
      </div>
```

And the desktop team2 block (around line 352):

```tsx
      <div className={`ms-team ms-team--2 ms-d${m.winner === 2 ? ' winner' : ''}`}>
        {m.team2.length === 0 && m.team1.length > 0 && m.tbdOpponents && m.tbdOpponents.length > 0
          ? renderTbdOpp(m.tbdOpponents)
          : m.team2.map((p, i) => (
              <div key={i}>{flag(p)}<span className={nameCls(p)} title={teamTooltip(p)} onClick={onPlayerClick && p.playerId ? (e) => { e.stopPropagation(); recordMatchView(m); onPlayerClick(p.playerId) } : undefined}>{medal(2)}{p.name}</span>{i === 0 && m.winner === 2 && <span className="ms-team-dot" aria-label="winner" />}</div>
            ))}
      </div>
```

And the mobile `.ms-board` rows (around lines 359 and 379). For each
`.ms-board-players` block, swap the `m.team1.map(...)` / `m.team2.map(...)`
with the same conditional pattern:

Team 1 board row:

```tsx
          <div className="ms-board-players">
            {m.team1.length === 0 && m.team2.length > 0 && m.tbdOpponents && m.tbdOpponents.length > 0
              ? renderTbdOpp(m.tbdOpponents)
              : m.team1.map((p, i) => <div key={i}>{flag(p)}<span className={nameCls(p)} onClick={onPlayerClick && p.playerId ? (e) => { e.stopPropagation(); recordMatchView(m); onPlayerClick(p.playerId) } : undefined}>{medal(1)}{p.name}</span></div>)}
          </div>
```

Team 2 board row:

```tsx
          <div className="ms-board-players">
            {m.team2.length === 0 && m.team1.length > 0 && m.tbdOpponents && m.tbdOpponents.length > 0
              ? renderTbdOpp(m.tbdOpponents)
              : m.team2.map((p, i) => <div key={i}>{flag(p)}<span className={nameCls(p)} onClick={onPlayerClick && p.playerId ? (e) => { e.stopPropagation(); recordMatchView(m); onPlayerClick(p.playerId) } : undefined}>{medal(2)}{p.name}</span></div>)}
          </div>
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/MatchSchedule.tbdOpp.test.tsx
```

Expected: all six tests PASS.

- [ ] **Step 5: Run the existing MatchSchedule tests to confirm no regression**

```bash
npx jest __tests__/MatchSchedule
```

Expected: every MatchSchedule test PASSES (including `.highlight` and
`.live`).

- [ ] **Step 6: Commit**

```bash
git add components/MatchSchedule.tsx __tests__/MatchSchedule.tbdOpp.test.tsx
git commit -m "feat(MatchSchedule): render tbdOpponents as \"A or B\" line"
```

---

## Task 9: Add CSS for `.ms-tbd-opp`

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add the styles**

Append to `app/globals.css`, near the other `.ms-*` styles (after the
`.ms-team-dot` block around line 1645 is a good spot):

```css
.ms-tbd-opp {
  font-style: italic;
  opacity: 0.7;
  font-size: 0.9em;
}
.ms-tbd-or {
  opacity: 0.85;
}
```

- [ ] **Step 2: Smoke-test in the running app (manual)**

Skip a strict automated test here — CSS rendering needs a real browser.
This is verified manually in Task 10.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style(MatchSchedule): dim/italic style for TBD opponent line"
```

---

## Task 10: Manual verification in the live app

**Files:** none.

- [ ] **Step 1: Run the dev server**

```bash
npm run dev
```

Wait for it to report a port (typically 3000).

- [ ] **Step 2: Navigate to the YONEX-SINGHA-BAT tournament's schedule**

In a browser: `http://localhost:3000/?t=<YONEX-SINGHA-BAT-slug>`

Switch to the day tab for **20/06**.

- [ ] **Step 3: Find ธัชธรรม์'s BS U13 R64 match**

Scroll to the BS U13 R64 match scheduled for ธัชธรรม์ เหมาะประสิทธิ์ /
วรสุภาพ. Confirm:
- The empty side shows "รณกร or Wong Hao Feng RYAN" (Eng) or
  "รณกร หรือ Wong Hao Feng RYAN" (Thai).
- The text is visibly dimmer/italic/smaller than the populated side.
- The mobile board view (narrow viewport) also shows the line in the
  empty player row.

- [ ] **Step 4: Spot-check at least one other draw**

Switch to another draw (e.g. WS U13) and confirm:
- Matches with both sides populated render unchanged.
- Matches with both sides TBD render unchanged (no spurious "A or B").
- Round-robin or qualifier matches render unchanged.

- [ ] **Step 5: Toggle language and re-verify**

Click the language toggle (English ↔ Thai). Confirm the separator switches
between "or" and "หรือ".

- [ ] **Step 6: Switch to dark mode and re-verify**

Confirm the TBD line is still legible against the dark background. If it
reads as too dim, file a follow-up to switch from opacity to a
`--color-text-muted` token (called out in the spec).

- [ ] **Step 7: Stop the dev server**

Ctrl-C to terminate `npm run dev`.

---

## Self-Review Notes

- **Spec coverage:** every section of the spec maps to a task — parser
  (Task 2), helpers (Task 1), cache (Task 3), type (Task 4), side-selection
  (Task 5), enrichment wiring (Task 6), i18n (Task 7), rendering (Task 8),
  CSS (Task 9), manual verification (Task 10). Fixture capture is Task 0.
- **Type consistency:** `MatchPlayer[][][]` is the cache shape; the
  parser emits `childMatches: MatchPlayer[][][]`; `selectTbdCandidates`
  consumes the same and emits `MatchPlayer[][]` which matches
  `tbdOpponents`. Verified.
- **Test approach:** every change is TDD with a failing test first. The
  fixture capture in Task 0 is a prerequisite for Tasks 2 and 6 because
  those tests assert specific player IDs from the YONEX-SINGHA-BAT BS U13
  bracket. If Task 0 can't be completed (tournament inaccessible), fall
  back to a synthetic minimal bracket HTML fixture, but adapt the assertions
  accordingly.

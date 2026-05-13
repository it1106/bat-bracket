# BWF Provider — Phase 1 (MVP: Draws + Schedule) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow BWF tournaments to appear in BATBracket via `@bwf <url>` lines in `public/tournaments.txt`. After Phase 1, BWF tournaments render in the list, show their draws/brackets, and display the day-by-day match schedule. Live scores, player profiles, H2H, stats, alerts, and share-as-image are deferred to phases 2–5 (separate plans).

**Architecture:** A new `TournamentProvider` interface decouples cache modules from upstream data sources. `BatProvider` is a thin pass-through wrapper around existing `lib/scraper.ts` + `lib/bat-fetch.ts` (no logic moved → guarantees BAT byte-identity). `BwfProvider` uses a persistent headless Chromium context (`@sparticuz/chromium` + `playwright-core`) to defeat Cloudflare bot protection and call BWF's JSON API at `extranet-lv.bwfbadminton.com`. A sidecar JSON file maps URL → IDs so users only paste a URL.

**Tech Stack:** TypeScript, Next.js 14, Jest, Playwright Core, @sparticuz/chromium, cheerio (existing).

**Spec:** `docs/superpowers/specs/2026-05-13-bwf-provider-design.md`

**Hard constraints (re-stated from spec, do not violate):**
1. BAT behavior must be unchanged. Existing tests pass without modification.
2. No BWF failure path may disturb BAT. Every BWF entry catches and degrades to null/empty/cached.
3. `@bwf <url>` is the only user-visible BWF syntax. IDs are auto-resolved.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/types.ts` | **modify** | Add `ProviderTag`, `TournamentRef`; add optional `provider?: ProviderTag` on `TournamentInfo` |
| `lib/providers/types.ts` | **create** | `TournamentProvider` interface |
| `lib/providers/resolve.ts` | **create** | `providerFor(ref)` dispatch helper |
| `lib/providers/bat-provider.ts` | **create** | Pass-through wrapper around `lib/scraper.ts` + `lib/bat-fetch.ts` |
| `lib/providers/bwf-provider.ts` | **create** | `BwfProvider` class implementing the interface (phase-1 methods only) |
| `lib/providers/bwf/sidecar.ts` | **create** | Read/write `public/bwf-cache.json`; in-memory `Map<guid, entry>` |
| `lib/providers/bwf/cf-context.ts` | **create** | Persistent Chromium singleton + CF challenge solving + token extraction |
| `lib/providers/bwf/api-client.ts` | **create** | Typed wrappers for 4 BWF endpoints needed in phase 1 |
| `lib/providers/bwf/parsers.ts` | **create** | Pure: BWF JSON → app types (`TournamentInfo`, `DrawInfo[]`, `MatchesData`) |
| `lib/providers/bwf/bracket-html.ts` | **create** | Pure: BWF draw-data JSON → BAT-style bracket HTML string |
| `lib/providers/bwf/url-resolver.ts` | **create** | Pure: BWF tournament page HTML → `{ tmtId, tournamentCode, slug, name, dates }` |
| `lib/tournaments-txt.ts` | **create** | Extracted parser (was `parseTournamentsTxt` in `app/api/tournaments/route.ts`), now provider-aware |
| `lib/tournaments-registry.ts` | **create** | `listAllTournaments()` + `resolveRef(id)` over tournaments.txt + sidecar |
| `app/api/tournaments/route.ts` | **modify** | Import parser from `lib/tournaments-txt.ts`; add `@bwf` line handling |
| `lib/draws-cache.ts` | **modify** | Dispatch via `providerFor(ref)`; iterate registry in prewarm |
| `lib/matches-full-cache.ts` | **modify** | Same dispatch pattern |
| `lib/bracket-cache.ts` | **modify** | Same dispatch pattern |
| `lib/day-cache.ts` | **modify** | Same dispatch pattern |
| `instrumentation.ts` | **modify** | Call `primeBwfContextIfNeeded()` after existing prewarmers |
| `scripts/capture-bwf-fixtures.ts` | **create** | One-off: capture canned JSON fixtures from real BWF API |
| `fixtures/bwf/tournament-detail.json` | **create** | Hand-crafted (refreshed by capture script) |
| `fixtures/bwf/tournament-draws.json` | **create** | Hand-crafted |
| `fixtures/bwf/tournament-draw-data.json` | **create** | Hand-crafted |
| `fixtures/bwf/day-matches.json` | **create** | Hand-crafted |
| `fixtures/bwf/tournament-page.html` | **create** | Truncated copy of the BWF tournament page for URL-resolver tests |
| `__tests__/bwf-sidecar.test.ts` | **create** | Unit tests for sidecar |
| `__tests__/bwf-parsers.test.ts` | **create** | Unit tests for parsers |
| `__tests__/bwf-bracket-html.test.ts` | **create** | Snapshot test for bracket HTML constructor |
| `__tests__/bwf-url-resolver.test.ts` | **create** | Unit tests for URL resolver |
| `__tests__/bwf-cf-context.test.ts` | **create** | Unit tests for CF context state machine (mocked Playwright) |
| `__tests__/providers-resolve.test.ts` | **create** | Unit tests for dispatch helper |
| `__tests__/tournaments-txt.test.ts` | **create** | Snapshot test guaranteeing BAT-line output is unchanged |
| `__tests__/tournaments-registry.test.ts` | **create** | Unit tests for registry |

---

## Section A — Pure Foundations (no Chromium, all unit-testable)

### Task 1: Add `ProviderTag` and `TournamentRef` to `lib/types.ts`

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add the new types and extend `TournamentInfo`**

Open `lib/types.ts`. After the existing `TournamentInfo` interface (around line 21), add:

```ts
export type ProviderTag = 'bat' | 'bwf'

export interface TournamentRef {
  id: string
  provider: ProviderTag
}
```

Then modify the existing `TournamentInfo` interface to add an optional `provider` field. The current definition is:

```ts
export interface TournamentInfo {
  id: string
  name: string
  done?: boolean
  startDateIso?: string
}
```

Change to:

```ts
export interface TournamentInfo {
  id: string
  name: string
  done?: boolean
  startDateIso?: string
  provider?: ProviderTag
}
```

- [ ] **Step 2: Type-check the project**

Run: `npx tsc --noEmit`
Expected: no new errors. The optional field is backward-compatible with every existing call site.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "types: add ProviderTag, TournamentRef, optional provider on TournamentInfo"
```

---

### Task 2: Hand-craft BWF test fixtures

**Files:**
- Create: `fixtures/bwf/tournament-detail.json`
- Create: `fixtures/bwf/tournament-draws.json`
- Create: `fixtures/bwf/tournament-draw-data.json`
- Create: `fixtures/bwf/day-matches.json`
- Create: `fixtures/bwf/tournament-page.html`

These fixtures encode the JSON shape observed in the BWF page source (the Vue templates document each field). They will be refreshed by `scripts/capture-bwf-fixtures.ts` later, but hand-crafted versions let us TDD parsers immediately.

- [ ] **Step 1: Create `fixtures/bwf/tournament-detail.json`**

```json
{
  "results": {
    "id": 5726,
    "name": "MITH YONEX Pathumthanee U13 U15 U17 International Junior 2026",
    "slug": "mith-yonex-pathumthanee-u13-u15-u17-international-junior-2026",
    "tournament_code": "6E65C36E-497D-42D2-8F4E-78A2D30D9893",
    "date": "19 - 24 May",
    "start_date": "2026-05-19",
    "end_date": "2026-05-24",
    "venue_name": "Spirit Stadium",
    "venue_address1": "Khlong Si, Khlong Luang, Pathum Thani, Thailand"
  }
}
```

- [ ] **Step 2: Create `fixtures/bwf/tournament-draws.json`**

```json
{
  "results": [
    {
      "value": "11",
      "text": "BS U13",
      "type": 0,
      "stage_type": 1,
      "stage_name": "Main",
      "stage_order": 1,
      "size": 32,
      "doubles": false
    },
    {
      "value": "12",
      "text": "GS U13",
      "type": 0,
      "stage_type": 1,
      "stage_name": "Main",
      "stage_order": 2,
      "size": 32,
      "doubles": false
    },
    {
      "value": "13",
      "text": "BD U13",
      "type": 0,
      "stage_type": 1,
      "stage_name": "Main",
      "stage_order": 3,
      "size": 16,
      "doubles": true
    }
  ]
}
```

- [ ] **Step 3: Create `fixtures/bwf/tournament-draw-data.json`**

This is one round of a 4-player single-elimination draw, with one completed match and one pending.

```json
{
  "drawsize": 4,
  "drawendcol": 2,
  "gameTypeId": 1,
  "results": {
    "0-0": {
      "match": {
        "code": "M1",
        "team1": {
          "countryCode": "THA",
          "countryFlagUrl": "https://example/tha.svg",
          "players": [
            { "id": "111", "nameDisplay": "Somchai Saetang", "nameShort": "S. Saetang", "slug": "somchai-saetang", "countryCode": "THA", "countryFlagUrl": "https://example/tha.svg" }
          ]
        },
        "team2": {
          "countryCode": "INA",
          "countryFlagUrl": "https://example/ina.svg",
          "players": [
            { "id": "222", "nameDisplay": "Budi Putra", "nameShort": "B. Putra", "slug": "budi-putra", "countryCode": "INA", "countryFlagUrl": "https://example/ina.svg" }
          ]
        },
        "team1seed": 1,
        "team2seed": null,
        "winner": 1,
        "score": [ { "home": 21, "away": 15 }, { "home": 21, "away": 19 } ],
        "scoreStatus": 0,
        "matchStatus": "F",
        "courtName": "Court 1",
        "oopRound": 3,
        "matchTime": "2026-05-19T10:00:00Z",
        "drawName": "BS U13",
        "roundName": "SF",
        "matchTypeId": 11,
        "duration": "42"
      }
    },
    "0-1": {
      "match": {
        "code": "M2",
        "team1": {
          "countryCode": "MAS",
          "countryFlagUrl": "https://example/mas.svg",
          "players": [
            { "id": "333", "nameDisplay": "Ali Rahman", "nameShort": "A. Rahman", "slug": "ali-rahman", "countryCode": "MAS", "countryFlagUrl": "https://example/mas.svg" }
          ]
        },
        "team2": {
          "countryCode": "SGP",
          "countryFlagUrl": "https://example/sgp.svg",
          "players": [
            { "id": "444", "nameDisplay": "Lee Wei", "nameShort": "L. Wei", "slug": "lee-wei", "countryCode": "SGP", "countryFlagUrl": "https://example/sgp.svg" }
          ]
        },
        "team1seed": null,
        "team2seed": 2,
        "winner": 0,
        "score": [],
        "scoreStatus": 0,
        "matchStatus": "N",
        "courtName": "Court 2",
        "oopRound": 4,
        "matchTime": "2026-05-19T11:00:00Z",
        "drawName": "BS U13",
        "roundName": "SF",
        "matchTypeId": 11
      }
    },
    "1-0": {
      "match": {
        "code": "MF",
        "team1": { "countryCode": null, "players": [] },
        "team2": { "countryCode": null, "players": [] },
        "team1seed": null,
        "team2seed": null,
        "winner": 0,
        "score": [],
        "scoreStatus": 0,
        "matchStatus": "N",
        "drawName": "BS U13",
        "roundName": "F",
        "matchTypeId": 11
      }
    }
  },
  "matches": []
}
```

- [ ] **Step 4: Create `fixtures/bwf/day-matches.json`**

```json
[
  {
    "code": "M1",
    "matchTime": "2026-05-19T10:00:00Z",
    "courtCode": "1",
    "courtName": "Court 1",
    "locationName": "Spirit Stadium",
    "oopRound": 3,
    "drawName": "BS U13",
    "roundName": "SF",
    "matchTypeId": 11,
    "winner": 1,
    "scoreStatus": 0,
    "matchStatus": "F",
    "score": [ { "home": 21, "away": 15 }, { "home": 21, "away": 19 } ],
    "duration": "42",
    "team1": {
      "countryCode": "THA",
      "countryFlagUrl": "https://example/tha.svg",
      "players": [ { "id": "111", "nameDisplay": "Somchai Saetang", "nameShort": "S. Saetang", "slug": "somchai-saetang", "countryCode": "THA", "countryFlagUrl": "https://example/tha.svg" } ]
    },
    "team2": {
      "countryCode": "INA",
      "countryFlagUrl": "https://example/ina.svg",
      "players": [ { "id": "222", "nameDisplay": "Budi Putra", "nameShort": "B. Putra", "slug": "budi-putra", "countryCode": "INA", "countryFlagUrl": "https://example/ina.svg" } ]
    },
    "team1seed": 1,
    "team2seed": null
  },
  {
    "code": "M2",
    "matchTime": "2026-05-19T11:00:00Z",
    "courtCode": "2",
    "courtName": "Court 2",
    "locationName": "Spirit Stadium",
    "oopRound": 4,
    "drawName": "BS U13",
    "roundName": "SF",
    "matchTypeId": 11,
    "winner": 0,
    "scoreStatus": 0,
    "matchStatus": "N",
    "score": [],
    "team1": {
      "countryCode": "MAS",
      "countryFlagUrl": "https://example/mas.svg",
      "players": [ { "id": "333", "nameDisplay": "Ali Rahman", "nameShort": "A. Rahman", "slug": "ali-rahman", "countryCode": "MAS", "countryFlagUrl": "https://example/mas.svg" } ]
    },
    "team2": {
      "countryCode": "SGP",
      "countryFlagUrl": "https://example/sgp.svg",
      "players": [ { "id": "444", "nameDisplay": "Lee Wei", "nameShort": "L. Wei", "slug": "lee-wei", "countryCode": "SGP", "countryFlagUrl": "https://example/sgp.svg" } ]
    },
    "team1seed": null,
    "team2seed": 2
  }
]
```

- [ ] **Step 5: Create `fixtures/bwf/tournament-page.html`**

This is the minimum HTML needed to test `url-resolver.ts`. Only the literals in the bottom Vue config block matter.

```html
<!DOCTYPE html>
<html><head><title>Tournament | MITH YONEX Pathumthanee U13 U15 U17 International Junior 2026</title></head>
<body>
  <script type="text/javascript">
    var app = new Vue({
        el: '#app',
        data: {
            mainTmtId: 5726,
            tmtId: 5726,
            tournamentCode: '6E65C36E-497D-42D2-8F4E-78A2D30D9893',
            tournamentSlug: 'mith-yonex-pathumthanee-u13-u15-u17-international-junior-2026',
            tmtType: 0,
            token: "2|NaXRu9JnMpSdb8l86BkJxj6gzKJofnhmExwr8EWkQtHoattDAGimsSYhpM22a61e1crjTjfIGTKfhzxA",
            selectedDate: '2026-05-19'
        }
    });
  </script>
  <div class="live-date">19  - 24 May</div>
  <div class="live-venue">Spirit Stadium, Khlong Si, Khlong Luang,</div>
</body></html>
```

- [ ] **Step 6: Commit**

```bash
git add fixtures/bwf/
git commit -m "test: add hand-crafted BWF fixtures for parser TDD"
```

---

### Task 3: Sidecar module (read/write `public/bwf-cache.json`)

**Files:**
- Create: `lib/providers/bwf/sidecar.ts`
- Test: `__tests__/bwf-sidecar.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/bwf-sidecar.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  loadSidecar,
  saveSidecarEntry,
  lookupByGuid,
  lookupByUrl,
  resetSidecarForTesting,
} from '@/lib/providers/bwf/sidecar'

describe('bwf sidecar', () => {
  let tmpDir: string
  let tmpFile: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwf-sidecar-'))
    tmpFile = path.join(tmpDir, 'bwf-cache.json')
    resetSidecarForTesting(tmpFile)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loads empty when file missing', () => {
    expect(loadSidecar()).toEqual({})
  })

  it('writes and reads back an entry', () => {
    saveSidecarEntry('https://example/x', {
      tmtId: 5726,
      tournamentCode: 'AAAA1111-2222-3333-4444-555555555555',
      slug: 'x',
      name: 'X',
      startDateIso: '2026-05-19',
      endDateIso: '2026-05-24',
      resolvedAt: '2026-05-13T00:00:00Z',
    })
    expect(lookupByUrl('https://example/x')?.tmtId).toBe(5726)
    expect(lookupByGuid('AAAA1111-2222-3333-4444-555555555555')?.slug).toBe('x')
  })

  it('lookupByGuid is case-insensitive', () => {
    saveSidecarEntry('https://example/y', {
      tmtId: 1, tournamentCode: 'BBBB2222-2222-3333-4444-555555555555',
      slug: 'y', name: 'Y', startDateIso: '2026-05-19', endDateIso: '2026-05-24', resolvedAt: 'x',
    })
    expect(lookupByGuid('bbbb2222-2222-3333-4444-555555555555')).toBeTruthy()
  })

  it('returns empty object on corrupt JSON', () => {
    fs.writeFileSync(tmpFile, 'not json {{{')
    expect(loadSidecar()).toEqual({})
  })

  it('persists across instances', () => {
    saveSidecarEntry('https://example/z', {
      tmtId: 1, tournamentCode: 'CCCC3333-2222-3333-4444-555555555555',
      slug: 'z', name: 'Z', startDateIso: '2026-05-19', endDateIso: '2026-05-24', resolvedAt: 'x',
    })
    resetSidecarForTesting(tmpFile)
    expect(lookupByUrl('https://example/z')?.tmtId).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/bwf-sidecar.test.ts`
Expected: All tests fail with module-not-found errors.

- [ ] **Step 3: Implement the sidecar**

Create `lib/providers/bwf/sidecar.ts`:

```ts
import fs from 'fs'
import path from 'path'

export interface SidecarEntry {
  tmtId: number
  tournamentCode: string  // GUID, uppercase canonical
  slug: string
  name: string
  startDateIso: string
  endDateIso: string
  resolvedAt: string
}

export type Sidecar = Record<string, SidecarEntry>  // keyed by URL

let filePath: string = path.join(process.cwd(), 'public', 'bwf-cache.json')
let memCache: Sidecar | null = null
let byGuid: Map<string, SidecarEntry> = new Map()

export function resetSidecarForTesting(newPath: string): void {
  filePath = newPath
  memCache = null
  byGuid = new Map()
}

export function loadSidecar(): Sidecar {
  if (memCache) return memCache
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    memCache = JSON.parse(raw) as Sidecar
  } catch {
    memCache = {}
  }
  rebuildGuidIndex()
  return memCache
}

function rebuildGuidIndex(): void {
  byGuid = new Map()
  if (!memCache) return
  for (const entry of Object.values(memCache)) {
    byGuid.set(entry.tournamentCode.toUpperCase(), entry)
  }
}

export function saveSidecarEntry(url: string, entry: SidecarEntry): void {
  const cache = loadSidecar()
  cache[url] = { ...entry, tournamentCode: entry.tournamentCode.toUpperCase() }
  memCache = cache
  rebuildGuidIndex()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(cache, null, 2))
}

export function lookupByUrl(url: string): SidecarEntry | null {
  return loadSidecar()[url] ?? null
}

export function lookupByGuid(guid: string): SidecarEntry | null {
  loadSidecar()
  return byGuid.get(guid.toUpperCase()) ?? null
}

export function listAllSidecar(): SidecarEntry[] {
  return Object.values(loadSidecar())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/bwf-sidecar.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/providers/bwf/sidecar.ts __tests__/bwf-sidecar.test.ts
git commit -m "feat: BWF sidecar module for URL -> tmtId/tournamentCode mapping"
```

---

### Task 4: Parsers — `parseTournamentDetail` and `parseDraws`

**Files:**
- Create: `lib/providers/bwf/parsers.ts`
- Test: `__tests__/bwf-parsers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/bwf-parsers.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import {
  parseTournamentDetail,
  parseDraws,
} from '@/lib/providers/bwf/parsers'

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'fixtures', 'bwf', name), 'utf-8'))

describe('parseTournamentDetail', () => {
  it('maps BWF JSON to TournamentInfo', () => {
    const info = parseTournamentDetail(fixture('tournament-detail.json'))
    expect(info).toEqual({
      id: '6E65C36E-497D-42D2-8F4E-78A2D30D9893',
      name: 'MITH YONEX Pathumthanee U13 U15 U17 International Junior 2026',
      provider: 'bwf',
      startDateIso: '2026-05-19',
    })
  })

  it('returns null on missing results', () => {
    expect(parseTournamentDetail({})).toBeNull()
    expect(parseTournamentDetail({ results: null })).toBeNull()
  })
})

describe('parseDraws', () => {
  it('maps BWF draws to DrawInfo[]', () => {
    const draws = parseDraws(fixture('tournament-draws.json'))
    expect(draws).toHaveLength(3)
    expect(draws[0]).toEqual({
      drawNum: '11',
      name: 'BS U13',
      size: '32',
      type: 'Main',
    })
  })

  it('returns empty array on missing results', () => {
    expect(parseDraws({})).toEqual([])
    expect(parseDraws({ results: null })).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/bwf-parsers.test.ts`
Expected: Tests fail because `parsers.ts` does not exist yet.

- [ ] **Step 3: Implement the first two parsers**

Create `lib/providers/bwf/parsers.ts`:

```ts
import type { TournamentInfo, DrawInfo } from '@/lib/types'

interface BwfTournamentDetailResponse {
  results?: {
    id?: number
    name?: string
    slug?: string
    tournament_code?: string
    start_date?: string
    end_date?: string
  } | null
}

interface BwfDrawListResponse {
  results?: Array<{
    value: string
    text: string
    type?: number
    stage_name?: string
    size?: number
    doubles?: boolean
  }> | null
}

export function parseTournamentDetail(json: unknown): TournamentInfo | null {
  const r = (json as BwfTournamentDetailResponse).results
  if (!r || !r.tournament_code || !r.name) return null
  return {
    id: r.tournament_code.toUpperCase(),
    name: r.name,
    provider: 'bwf',
    ...(r.start_date && { startDateIso: r.start_date }),
  }
}

export function parseDraws(json: unknown): DrawInfo[] {
  const r = (json as BwfDrawListResponse).results
  if (!Array.isArray(r)) return []
  return r.map((d) => ({
    drawNum: String(d.value),
    name: d.text,
    size: d.size != null ? String(d.size) : '',
    type: d.stage_name ?? '',
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/bwf-parsers.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/providers/bwf/parsers.ts __tests__/bwf-parsers.test.ts
git commit -m "feat(bwf): parseTournamentDetail + parseDraws"
```

---

### Task 5: Parser — `parseDrawData` (matches from a single draw)

**Files:**
- Modify: `lib/providers/bwf/parsers.ts`
- Modify: `__tests__/bwf-parsers.test.ts`

- [ ] **Step 1: Append failing tests**

Add to `__tests__/bwf-parsers.test.ts`:

```ts
import { parseDrawData } from '@/lib/providers/bwf/parsers'

describe('parseDrawData', () => {
  it('maps BWF draw cells to MatchEntry[]', () => {
    const matches = parseDrawData(
      fixture('tournament-draw-data.json'),
      { drawNum: '11', drawName: 'BS U13' },
    )
    // Two real matches + one empty placeholder bye is filtered out
    expect(matches).toHaveLength(2)
    const finished = matches[0]
    expect(finished.draw).toBe('BS U13')
    expect(finished.drawNum).toBe('11')
    expect(finished.round).toBe('SF')
    expect(finished.team1[0]).toEqual({ name: 'Somchai Saetang', playerId: '111' })
    expect(finished.team2[0]).toEqual({ name: 'Budi Putra', playerId: '222' })
    expect(finished.winner).toBe(1)
    expect(finished.scores).toEqual([{ t1: 21, t2: 15 }, { t1: 21, t2: 19 }])
    expect(finished.walkover).toBe(false)
    expect(finished.retired).toBe(false)
    expect(finished.court).toBe('Court 1')
    expect(finished.duration).toBe('42')
    expect(finished.nowPlaying).toBe(false)
  })

  it('marks nowPlaying when matchStatus is in-progress', () => {
    const matches = parseDrawData(
      {
        drawsize: 2, drawendcol: 2, gameTypeId: 1,
        results: {
          '0-0': {
            match: {
              team1: { players: [{ id: '1', nameDisplay: 'A' }] },
              team2: { players: [{ id: '2', nameDisplay: 'B' }] },
              winner: 0, score: [{ home: 5, away: 3 }],
              scoreStatus: 0, matchStatus: 'P',
              roundName: 'F', drawName: 'X', courtName: 'C1',
            },
          },
        }, matches: [],
      },
      { drawNum: '99', drawName: 'X' },
    )
    expect(matches[0].nowPlaying).toBe(true)
  })

  it('marks walkover and retired correctly', () => {
    const wo = parseDrawData(
      {
        drawsize: 2, drawendcol: 2, gameTypeId: 1,
        results: { '0-0': { match: {
          team1: { players: [{ id: '1', nameDisplay: 'A' }] },
          team2: { players: [{ id: '2', nameDisplay: 'B' }] },
          winner: 1, score: [], scoreStatus: 1, matchStatus: 'F',
          roundName: 'F', drawName: 'X',
        } } }, matches: [],
      },
      { drawNum: '99', drawName: 'X' },
    )[0]
    expect(wo.walkover).toBe(true)
    expect(wo.retired).toBe(false)

    const ret = parseDrawData(
      {
        drawsize: 2, drawendcol: 2, gameTypeId: 1,
        results: { '0-0': { match: {
          team1: { players: [{ id: '1', nameDisplay: 'A' }] },
          team2: { players: [{ id: '2', nameDisplay: 'B' }] },
          winner: 2, score: [{ home: 21, away: 19 }, { home: 8, away: 0 }],
          scoreStatus: 2, matchStatus: 'F',
          roundName: 'F', drawName: 'X',
        } } }, matches: [],
      },
      { drawNum: '99', drawName: 'X' },
    )[0]
    expect(ret.retired).toBe(true)
    expect(ret.walkover).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/bwf-parsers.test.ts`
Expected: 3 new tests fail (existing 4 still pass).

- [ ] **Step 3: Implement `parseDrawData`**

Append to `lib/providers/bwf/parsers.ts`:

```ts
import type { MatchEntry, MatchPlayer, MatchScore } from '@/lib/types'

interface BwfPlayer {
  id?: string | number
  nameDisplay?: string
}

interface BwfTeam {
  players?: BwfPlayer[]
  countryCode?: string | null
  countryFlagUrl?: string | null
}

interface BwfMatch {
  team1?: BwfTeam
  team2?: BwfTeam
  team1seed?: number | null
  team2seed?: number | null
  winner?: 0 | 1 | 2
  score?: Array<{ home: number; away: number }>
  scoreStatus?: 0 | 1 | 2 | 3
  matchStatus?: string  // 'N' none, 'P' in progress, 'F' finished, 'O' off court...
  roundName?: string
  drawName?: string
  courtName?: string | null
  oopRound?: number
  matchTime?: string
  duration?: string
  code?: string
  matchTypeId?: number
}

interface BwfDrawDataResponse {
  drawsize?: number
  drawendcol?: number
  gameTypeId?: number
  results?: Record<string, { match: BwfMatch }>
  matches?: BwfMatch[]
}

const NOW_PLAYING_STATUSES = new Set(['C', 'P', 'W', 'H'])

function mapPlayers(team: BwfTeam | undefined): MatchPlayer[] {
  if (!team?.players) return []
  return team.players.map((p) => ({
    name: p.nameDisplay ?? '',
    playerId: String(p.id ?? ''),
  }))
}

function mapScores(score: BwfMatch['score']): MatchScore[] {
  if (!Array.isArray(score)) return []
  return score.map((s) => ({ t1: s.home, t2: s.away }))
}

function isEmptyTeam(team: BwfTeam | undefined): boolean {
  return !team?.players || team.players.length === 0
}

export function parseDrawData(
  json: unknown,
  context: { drawNum: string; drawName: string },
): MatchEntry[] {
  const data = json as BwfDrawDataResponse
  const cells = data.results ?? {}
  const out: MatchEntry[] = []

  for (const key of Object.keys(cells)) {
    let m: BwfMatch
    try {
      m = cells[key].match
    } catch (err) {
      console.warn(`[bwf-parser] skipping malformed cell ${key}`)
      continue
    }

    // Filter out bye/empty placeholder cells
    if (isEmptyTeam(m.team1) && isEmptyTeam(m.team2)) continue

    try {
      const winner = m.winner === 1 || m.winner === 2 ? m.winner : null
      const status = m.scoreStatus ?? 0
      const matchStatus = m.matchStatus ?? 'N'
      const entry: MatchEntry = {
        draw: m.drawName ?? context.drawName,
        drawNum: context.drawNum,
        round: m.roundName ?? '',
        team1: mapPlayers(m.team1),
        team2: mapPlayers(m.team2),
        winner,
        scores: mapScores(m.score),
        court: m.courtName ?? '',
        walkover: status === 1,
        retired: status === 2,
        nowPlaying: NOW_PLAYING_STATUSES.has(matchStatus),
        ...(m.duration && { duration: m.duration }),
        ...(m.matchTime && { scheduledTime: m.matchTime }),
      }
      out.push(entry)
    } catch (err) {
      console.warn(`[bwf-parser] skipping match in cell ${key}:`, err)
    }
  }

  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/bwf-parsers.test.ts`
Expected: 7 tests pass total.

- [ ] **Step 5: Commit**

```bash
git add lib/providers/bwf/parsers.ts __tests__/bwf-parsers.test.ts
git commit -m "feat(bwf): parseDrawData maps draw cells to MatchEntry[]"
```

---

### Task 6: Parser — `parseDayMatches`

**Files:**
- Modify: `lib/providers/bwf/parsers.ts`
- Modify: `__tests__/bwf-parsers.test.ts`

- [ ] **Step 1: Append failing test**

Add to `__tests__/bwf-parsers.test.ts`:

```ts
import { parseDayMatches } from '@/lib/providers/bwf/parsers'

describe('parseDayMatches', () => {
  it('maps day matches to MatchScheduleGroup[] grouped by court', () => {
    const groups = parseDayMatches(fixture('day-matches.json'))
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({
      type: 'court',
      court: 'Court 1',
      matches: [
        expect.objectContaining({
          round: 'SF',
          team1: [{ name: 'Somchai Saetang', playerId: '111' }],
          winner: 1,
        }),
      ],
    })
    expect(groups[1].court).toBe('Court 2')
  })

  it('returns empty array on non-array input', () => {
    expect(parseDayMatches(null)).toEqual([])
    expect(parseDayMatches({})).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx jest __tests__/bwf-parsers.test.ts`
Expected: New test fails.

- [ ] **Step 3: Implement `parseDayMatches`**

Append to `lib/providers/bwf/parsers.ts`:

```ts
import type { MatchScheduleGroup } from '@/lib/types'

function dayMatchToEntry(m: BwfMatch & { drawName?: string; courtName?: string }): MatchEntry {
  const winner = m.winner === 1 || m.winner === 2 ? m.winner : null
  const status = m.scoreStatus ?? 0
  const matchStatus = m.matchStatus ?? 'N'
  return {
    draw: m.drawName ?? '',
    drawNum: '',
    round: m.roundName ?? '',
    team1: mapPlayers(m.team1),
    team2: mapPlayers(m.team2),
    winner,
    scores: mapScores(m.score),
    court: m.courtName ?? '',
    walkover: status === 1,
    retired: status === 2,
    nowPlaying: NOW_PLAYING_STATUSES.has(matchStatus),
    ...(m.duration && { duration: m.duration }),
    ...(m.matchTime && { scheduledTime: m.matchTime }),
  }
}

export function parseDayMatches(json: unknown): MatchScheduleGroup[] {
  if (!Array.isArray(json)) return []
  const byCourt = new Map<string, MatchEntry[]>()
  for (const m of json as BwfMatch[]) {
    try {
      const court = m.courtName ?? ''
      if (!byCourt.has(court)) byCourt.set(court, [])
      byCourt.get(court)!.push(dayMatchToEntry(m))
    } catch (err) {
      console.warn('[bwf-parser] skipping day match:', err)
    }
  }
  return Array.from(byCourt.entries()).map(([court, matches]) => ({
    type: 'court' as const,
    court,
    matches,
  }))
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/bwf-parsers.test.ts`
Expected: 9 tests pass total.

- [ ] **Step 5: Commit**

```bash
git add lib/providers/bwf/parsers.ts __tests__/bwf-parsers.test.ts
git commit -m "feat(bwf): parseDayMatches groups by court"
```

---

### Task 7: Bracket HTML constructor

**Files:**
- Create: `lib/providers/bwf/bracket-html.ts`
- Test: `__tests__/bwf-bracket-html.test.ts`

Goal: from a BWF `tournament-draw-data` response, produce a single HTML string with the same outer structure BAT's bracket renders. The BAT bracket HTML lives in `fixtures/bracket.html` — read that for shape reference.

- [ ] **Step 1: Read the BAT bracket structure**

Before coding, read `fixtures/bracket.html` to understand BAT's bracket markup. Note class names: `tournament-brackets`, `bracket`, `round`, `match`, `team1`, `team2`, `team-win`. The constructor must produce equivalent class names so the existing CSS in `app/globals.css` renders both identically.

- [ ] **Step 2: Write a snapshot test**

Create `__tests__/bwf-bracket-html.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import { buildBracketHtml } from '@/lib/providers/bwf/bracket-html'

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'fixtures', 'bwf', name), 'utf-8'))

describe('buildBracketHtml', () => {
  it('produces a stable HTML string for a known draw', () => {
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    expect(html).toMatchSnapshot()
  })

  it('returns "no data" placeholder when results are empty', () => {
    const html = buildBracketHtml({ drawsize: 0, drawendcol: 0, results: {} }, 'X')
    expect(html).toContain('No data')
  })

  it('marks the winner team with team-win class', () => {
    const html = buildBracketHtml(fixture('tournament-draw-data.json'), 'BS U13')
    // Match M1 has winner=1, so team1 should be team-win
    expect(html).toMatch(/team1[^"]*team-win/)
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npx jest __tests__/bwf-bracket-html.test.ts`
Expected: All fail.

- [ ] **Step 4: Implement the constructor**

Create `lib/providers/bwf/bracket-html.ts`:

```ts
interface BwfMatch {
  team1?: { players?: Array<{ id?: string | number; nameDisplay?: string; countryFlagUrl?: string | null }>; countryCode?: string | null }
  team2?: { players?: Array<{ id?: string | number; nameDisplay?: string; countryFlagUrl?: string | null }>; countryCode?: string | null }
  team1seed?: number | null
  team2seed?: number | null
  winner?: 0 | 1 | 2
  score?: Array<{ home: number; away: number }>
  scoreStatus?: number
  roundName?: string
  courtName?: string | null
  matchTime?: string
}

interface BwfDrawDataResponse {
  drawsize?: number
  drawendcol?: number
  results?: Record<string, { match: BwfMatch }>
}

const ROUND_ORDER = [256, 128, 64, 32, 16, 8, 4, 2, 1]

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function teamHtml(team: BwfMatch['team1'], seed: number | null | undefined, isWin: boolean, teamLabel: 'team1' | 'team2'): string {
  const cls = `${teamLabel}${isWin ? ' team-win' : ''}`
  if (!team || !team.players || team.players.length === 0) {
    return `<div class="${cls} bye"></div>`
  }
  const names = team.players
    .map((p) => `<span class="player-name" data-player="${esc(String(p.id ?? ''))}">${esc(p.nameDisplay ?? '')}</span>`)
    .join('')
  const seedStr = seed ? ` <span class="seed">(${seed})</span>` : ''
  return `<div class="${cls}">${names}${seedStr}</div>`
}

function scoreHtml(scores: BwfMatch['score']): string {
  if (!scores || scores.length === 0) return ''
  return `<div class="scores">${scores.map((s) => `<span>${s.home}-${s.away}</span>`).join('')}</div>`
}

export function buildBracketHtml(json: unknown, drawName: string): string {
  const data = json as BwfDrawDataResponse
  const results = data.results
  if (!results || Object.keys(results).length === 0) {
    return '<div class="tournament-brackets"><div class="no-data">No data available.</div></div>'
  }

  const drawsize = data.drawsize ?? 0
  const drawendcol = data.drawendcol ?? 1
  const rounds = ROUND_ORDER.filter((r) => r <= drawsize && r >= drawendcol)

  const cols = rounds
    .map((roundSize, colIdx) => {
      const matchesInCol: string[] = []
      for (let i = 0; i < roundSize; i++) {
        const key = `${colIdx}-${i}`
        const cell = results[key]
        if (!cell) { matchesInCol.push('<div class="match"></div>'); continue }
        const m = cell.match
        const winner = m.winner === 1 || m.winner === 2 ? m.winner : null
        const html =
          `<div class="match" data-round="${esc(m.roundName ?? '')}">` +
          `<div class="match-inner-wrapper">` +
          teamHtml(m.team1, m.team1seed, winner === 1, 'team1') +
          teamHtml(m.team2, m.team2seed, winner === 2, 'team2') +
          scoreHtml(m.score) +
          `</div></div>`
        matchesInCol.push(html)
      }
      const header = `<div class="round-col-header">${esc(roundLabel(roundSize))}</div>`
      return `<div class="round">${header}${matchesInCol.join('')}</div>`
    })
    .join('')

  return `<div class="tournament-brackets" data-draw="${esc(drawName)}"><div class="bracket">${cols}</div></div>`
}

function roundLabel(size: number): string {
  switch (size) {
    case 1: return 'Final'
    case 2: return 'Semi Final'
    case 4: return 'Quarter Final'
    default: return `Round of ${size * 2}`
  }
}
```

- [ ] **Step 5: Run tests, accept snapshot**

Run: `npx jest __tests__/bwf-bracket-html.test.ts -u`
Expected: All 3 tests pass; snapshot written to `__tests__/__snapshots__/bwf-bracket-html.test.ts.snap`.

- [ ] **Step 6: Commit**

```bash
git add lib/providers/bwf/bracket-html.ts __tests__/bwf-bracket-html.test.ts __tests__/__snapshots__/bwf-bracket-html.test.ts.snap
git commit -m "feat(bwf): bracket HTML constructor matching BAT shape"
```

---

### Task 8: URL resolver (page HTML → IDs/slug/name/dates)

**Files:**
- Create: `lib/providers/bwf/url-resolver.ts`
- Test: `__tests__/bwf-url-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/bwf-url-resolver.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import { extractMetaFromPageHtml } from '@/lib/providers/bwf/url-resolver'

const html = () => fs.readFileSync(path.join(process.cwd(), 'fixtures', 'bwf', 'tournament-page.html'), 'utf-8')

describe('extractMetaFromPageHtml', () => {
  it('extracts tmtId, tournamentCode, slug, name, dates, token', () => {
    const meta = extractMetaFromPageHtml(html())
    expect(meta).toEqual({
      tmtId: 5726,
      tournamentCode: '6E65C36E-497D-42D2-8F4E-78A2D30D9893',
      slug: 'mith-yonex-pathumthanee-u13-u15-u17-international-junior-2026',
      name: 'MITH YONEX Pathumthanee U13 U15 U17 International Junior 2026',
      token: '2|NaXRu9JnMpSdb8l86BkJxj6gzKJofnhmExwr8EWkQtHoattDAGimsSYhpM22a61e1crjTjfIGTKfhzxA',
    })
  })

  it('returns null when key fields missing', () => {
    expect(extractMetaFromPageHtml('<html></html>')).toBeNull()
  })

  it('returns null when only some fields present', () => {
    expect(extractMetaFromPageHtml('<script>var tmtId = 1;</script>')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx jest __tests__/bwf-url-resolver.test.ts`
Expected: All fail (module missing).

- [ ] **Step 3: Implement**

Create `lib/providers/bwf/url-resolver.ts`:

```ts
export interface BwfPageMeta {
  tmtId: number
  tournamentCode: string
  slug: string
  name: string
  token: string
}

const RX = {
  // matches `tmtId: 5726,` or `mainTmtId: 5726,` (use mainTmtId — more authoritative)
  tmtId: /\bmainTmtId\s*:\s*(\d+)/,
  tournamentCode: /\btournamentCode\s*:\s*['"]([0-9A-Fa-f-]{36})['"]/,
  slug: /\btournamentSlug\s*:\s*['"]([^'"]+)['"]/,
  // title looks like: <title>Tournament | MITH YONEX ...</title>
  name: /<title>\s*[^|<]*\|\s*([^<]+?)\s*<\/title>/,
  token: /\btoken\s*:\s*["']([^"']+)["']/,
}

export function extractMetaFromPageHtml(html: string): BwfPageMeta | null {
  const tmtId = RX.tmtId.exec(html)?.[1]
  const tournamentCode = RX.tournamentCode.exec(html)?.[1]
  const slug = RX.slug.exec(html)?.[1]
  const name = RX.name.exec(html)?.[1]
  const token = RX.token.exec(html)?.[1]
  if (!tmtId || !tournamentCode || !slug || !name || !token) return null
  return {
    tmtId: Number(tmtId),
    tournamentCode: tournamentCode.toUpperCase(),
    slug,
    name,
    token,
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/bwf-url-resolver.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/providers/bwf/url-resolver.ts __tests__/bwf-url-resolver.test.ts
git commit -m "feat(bwf): extract tmtId/tournamentCode/slug/name/token from page HTML"
```

---

### Task 9: Provider interface + dispatch helper

**Files:**
- Create: `lib/providers/types.ts`
- Create: `lib/providers/resolve.ts`
- Test: `__tests__/providers-resolve.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/providers-resolve.test.ts`:

```ts
import { providerFor } from '@/lib/providers/resolve'

describe('providerFor', () => {
  it('returns bat provider for bat ref', () => {
    const p = providerFor({ id: 'X', provider: 'bat' })
    expect(p.tag).toBe('bat')
  })

  it('returns bwf provider for bwf ref', () => {
    const p = providerFor({ id: 'Y', provider: 'bwf' })
    expect(p.tag).toBe('bwf')
  })
})
```

- [ ] **Step 2: Run, verify failure**

Run: `npx jest __tests__/providers-resolve.test.ts`
Expected: fail (module missing).

- [ ] **Step 3: Create the interface**

Create `lib/providers/types.ts`:

```ts
import type {
  TournamentInfo, DrawInfo, BracketData, MatchesData,
  MatchScheduleGroup, MatchEntry, PlayerProfile, H2HData,
  ProviderTag, TournamentRef,
} from '@/lib/types'

export interface TournamentProvider {
  tag: ProviderTag
  getMeta(ref: TournamentRef): Promise<TournamentInfo | null>
  getDraws(ref: TournamentRef): Promise<DrawInfo[]>
  getBracket(ref: TournamentRef, drawNum: string): Promise<BracketData | null>
  getMatchesFull(ref: TournamentRef): Promise<MatchesData | null>
  getDayMatches(ref: TournamentRef, dateIso: string): Promise<MatchScheduleGroup[]>
  getPlayer(ref: TournamentRef, playerId: string): Promise<PlayerProfile | null>
  getH2H(ref: TournamentRef, p1: string, p2: string): Promise<H2HData | null>
  getLiveScore(ref: TournamentRef, matchId: string): Promise<MatchEntry | null>
}

export class NotImplementedError extends Error {
  constructor(method: string, provider: ProviderTag) {
    super(`${provider} provider has not implemented ${method} yet`)
  }
}
```

- [ ] **Step 4: Create stub providers and the dispatch helper**

Create `lib/providers/bat-provider.ts` (real implementation comes in Task 12; for now, just enough for the dispatch test):

```ts
import type { TournamentProvider } from './types'

export const batProvider: TournamentProvider = {
  tag: 'bat',
  async getMeta() { return null },
  async getDraws() { return [] },
  async getBracket() { return null },
  async getMatchesFull() { return null },
  async getDayMatches() { return [] },
  async getPlayer() { return null },
  async getH2H() { return null },
  async getLiveScore() { return null },
}
```

Create `lib/providers/bwf-provider.ts` (real implementation in Task 13):

```ts
import type { TournamentProvider } from './types'

export const bwfProvider: TournamentProvider = {
  tag: 'bwf',
  async getMeta() { return null },
  async getDraws() { return [] },
  async getBracket() { return null },
  async getMatchesFull() { return null },
  async getDayMatches() { return [] },
  async getPlayer() { return null },
  async getH2H() { return null },
  async getLiveScore() { return null },
}
```

Create `lib/providers/resolve.ts`:

```ts
import type { TournamentRef } from '@/lib/types'
import type { TournamentProvider } from './types'
import { batProvider } from './bat-provider'
import { bwfProvider } from './bwf-provider'

export function providerFor(ref: TournamentRef): TournamentProvider {
  return ref.provider === 'bwf' ? bwfProvider : batProvider
}
```

- [ ] **Step 5: Run tests**

Run: `npx jest __tests__/providers-resolve.test.ts`
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/providers/types.ts lib/providers/resolve.ts lib/providers/bat-provider.ts lib/providers/bwf-provider.ts __tests__/providers-resolve.test.ts
git commit -m "feat: TournamentProvider interface + dispatch helper (stub impls)"
```

---

## Section B — Chromium Integration

### Task 10: CF context module (Playwright singleton)

**Files:**
- Create: `lib/providers/bwf/cf-context.ts`
- Test: `__tests__/bwf-cf-context.test.ts`

This is the trickiest task. The state machine is unit-testable with mocked Playwright; the real Chromium path is exercised in the integration test (Task 19).

- [ ] **Step 1: Write failing unit tests for the state machine**

Create `__tests__/bwf-cf-context.test.ts`:

```ts
import { _resetForTesting, _setDriverForTesting, primeIfNeeded, request, _internals } from '@/lib/providers/bwf/cf-context'

interface MockFetchCall { url: string; method: string }

function makeMockDriver() {
  const calls: { goto: string[]; fetch: MockFetchCall[]; close: number; launch: number } = {
    goto: [], fetch: [], close: 0, launch: 0,
  }
  let nextResponses: Array<{ status: number; body?: unknown }> = []
  let nextPageHtml = '<html><script>var tmtId = 1; var tournamentCode = "AAAA1111-2222-3333-4444-555555555555"; var tournamentSlug = "x"; var token = "tok-1";</script><title>X | Name</title></html>'

  return {
    calls,
    setNextResponses(rs: Array<{ status: number; body?: unknown }>) { nextResponses = [...rs] },
    setNextPageHtml(html: string) { nextPageHtml = html },
    driver: {
      async launch() {
        calls.launch++
        return {
          async newPage() {
            return {
              async goto(url: string) { calls.goto.push(url) },
              async content() { return nextPageHtml },
              async close() { /* noop */ },
            }
          },
          request: {
            async fetch(url: string, opts: { method: string }) {
              calls.fetch.push({ url, method: opts.method })
              const r = nextResponses.shift() ?? { status: 200, body: {} }
              return {
                status: () => r.status,
                json: async () => r.body,
              }
            },
          },
          async close() { calls.close++ },
        }
      },
    },
  }
}

describe('cf-context state machine', () => {
  beforeEach(() => { _resetForTesting() })

  it('prime launches Chromium and extracts token', async () => {
    const m = makeMockDriver()
    _setDriverForTesting(m.driver as any)
    await primeIfNeeded()
    expect(m.calls.launch).toBe(1)
    expect(m.calls.goto.length).toBeGreaterThanOrEqual(1)
    expect(_internals.getToken()).toBe('tok-1')
  })

  it('prime is mutex-protected (concurrent callers share one launch)', async () => {
    const m = makeMockDriver()
    _setDriverForTesting(m.driver as any)
    await Promise.all([primeIfNeeded(), primeIfNeeded(), primeIfNeeded()])
    expect(m.calls.launch).toBe(1)
  })

  it('request returns parsed JSON on 200', async () => {
    const m = makeMockDriver()
    m.setNextResponses([{ status: 200, body: { ok: true } }])
    _setDriverForTesting(m.driver as any)
    const r = await request<{ ok: boolean }>('POST', '/api/x', { a: 1 })
    expect(r).toEqual({ ok: true })
    expect(m.calls.fetch[0].url).toBe('https://extranet-lv.bwfbadminton.com/api/x')
  })

  it('retries once on 401 after re-extracting token', async () => {
    const m = makeMockDriver()
    m.setNextResponses([{ status: 401 }, { status: 200, body: { ok: true } }])
    _setDriverForTesting(m.driver as any)
    const r = await request<{ ok: boolean }>('POST', '/api/x')
    expect(r).toEqual({ ok: true })
    expect(m.calls.fetch.length).toBe(2)
    expect(m.calls.goto.length).toBeGreaterThanOrEqual(2) // initial prime + reload
  })

  it('retries once on 403 by re-priming the context', async () => {
    const m = makeMockDriver()
    m.setNextResponses([{ status: 403 }, { status: 200, body: { ok: true } }])
    _setDriverForTesting(m.driver as any)
    const r = await request<{ ok: boolean }>('POST', '/api/x')
    expect(r).toEqual({ ok: true })
    expect(m.calls.launch).toBeGreaterThanOrEqual(2)
  })

  it('throws on persistent 5xx', async () => {
    const m = makeMockDriver()
    m.setNextResponses([{ status: 502 }])
    _setDriverForTesting(m.driver as any)
    await expect(request('POST', '/api/x')).rejects.toThrow(/502/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/bwf-cf-context.test.ts`
Expected: All fail (module missing).

- [ ] **Step 3: Implement the CF context**

Create `lib/providers/bwf/cf-context.ts`:

```ts
import { extractMetaFromPageHtml } from './url-resolver'

// Minimal interface that abstracts over Playwright's BrowserContext for testability
export interface ChromiumDriver {
  launch(): Promise<DriverContext>
}

export interface DriverContext {
  newPage(): Promise<DriverPage>
  request: {
    fetch(url: string, opts: { method: string; headers?: Record<string, string>; data?: unknown }): Promise<DriverResponse>
  }
  close(): Promise<void>
}

export interface DriverPage {
  goto(url: string): Promise<void>
  content(): Promise<string>
  close(): Promise<void>
}

export interface DriverResponse {
  status(): number
  json<T = unknown>(): Promise<T>
}

const PRIME_TTL_MS = 25 * 60_000
const PROBE_URL = 'https://bwfbadminton.com/tournament/5726/mith-yonex-pathumthanee-u13-u15-u17-international-junior-2026/'
const PRIMER_URL = 'https://bwfbadminton.com/calendar/'

let context: DriverContext | null = null
let token: string | null = null
let lastPrime = 0
let primePromise: Promise<void> | null = null
let driver: ChromiumDriver | null = null

export function _resetForTesting(): void {
  context = null; token = null; lastPrime = 0; primePromise = null; driver = null
}

export function _setDriverForTesting(d: ChromiumDriver): void { driver = d }

export const _internals = { getToken: () => token, getLastPrime: () => lastPrime }

async function getRealDriver(): Promise<ChromiumDriver> {
  // Lazy import so unit tests don't pull in Playwright.
  const { chromium } = await import('playwright-core')
  const sparticuz = await import('@sparticuz/chromium')
  return {
    async launch() {
      const browser = await chromium.launch({
        args: sparticuz.default.args,
        executablePath: await sparticuz.default.executablePath(),
        headless: true,
      })
      const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-US',
      })
      // Adapt Playwright BrowserContext to DriverContext (interfaces are compatible)
      return ctx as unknown as DriverContext
    },
  }
}

async function prime(): Promise<void> {
  if (!driver) driver = await getRealDriver()
  if (context) { try { await context.close() } catch {} }
  context = await driver.launch()
  // 1. Bank cf_clearance cookie
  const primerPage = await context.newPage()
  await primerPage.goto(PRIMER_URL)
  await primerPage.close()
  // 2. Open a tournament page to extract the token
  await refreshToken()
  lastPrime = Date.now()
  console.log('[bwf-cf] primed: token=' + (token ? 'extracted' : 'missing'))
}

async function refreshToken(): Promise<void> {
  if (!context) throw new Error('no context')
  const page = await context.newPage()
  await page.goto(PROBE_URL)
  const html = await page.content()
  await page.close()
  const meta = extractMetaFromPageHtml(html)
  if (!meta) throw new Error('cannot extract token from probe page')
  token = meta.token
}

export async function primeIfNeeded(): Promise<void> {
  if (context && Date.now() - lastPrime < PRIME_TTL_MS) return
  if (primePromise) return primePromise
  primePromise = (async () => {
    try { await prime() } finally { primePromise = null }
  })()
  return primePromise
}

export async function request<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  await primeIfNeeded()
  const url = `https://extranet-lv.bwfbadminton.com${path}`
  const start = Date.now()

  const doFetch = async () => context!.request.fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'https://bwfbadminton.com',
      Referer: 'https://bwfbadminton.com/',
    },
    data: body,
  })

  let res = await doFetch()

  if (res.status() === 401) {
    console.log('[bwf-cf] 401, refreshing token')
    await refreshToken()
    res = await doFetch()
  }
  if (res.status() === 403) {
    console.log('[bwf-cf] 403, re-priming')
    await prime()
    res = await doFetch()
  }
  if (res.status() >= 400) {
    const ms = Date.now() - start
    console.log(`[bwf-fetch] path=${path} status=${res.status()} ms=${ms} FAIL`)
    throw new Error(`BWF API ${res.status()} for ${path}`)
  }
  const ms = Date.now() - start
  console.log(`[bwf-fetch] path=${path} status=${res.status()} ms=${ms}`)
  return res.json<T>()
}

export async function fetchPageHtml(url: string): Promise<string> {
  await primeIfNeeded()
  const page = await context!.newPage()
  try {
    await page.goto(url)
    return await page.content()
  } finally {
    await page.close()
  }
}

// Dev HMR survival: cache on globalThis
if (typeof globalThis !== 'undefined') {
  const g = globalThis as unknown as { __bwfCf?: { context: typeof context; token: typeof token; lastPrime: typeof lastPrime } }
  if (g.__bwfCf) {
    context = g.__bwfCf.context
    token = g.__bwfCf.token
    lastPrime = g.__bwfCf.lastPrime
  } else {
    g.__bwfCf = { context, token, lastPrime }
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx jest __tests__/bwf-cf-context.test.ts`
Expected: 6 tests pass.

If a test fails because of the globalThis HMR block interfering, wrap that block in `if (process.env.NODE_ENV !== 'test')`.

- [ ] **Step 5: Commit**

```bash
git add lib/providers/bwf/cf-context.ts __tests__/bwf-cf-context.test.ts
git commit -m "feat(bwf): CF context state machine with mutex + 401/403 retry"
```

---

### Task 11: API client (typed endpoint wrappers)

**Files:**
- Create: `lib/providers/bwf/api-client.ts`

No standalone tests for this — it's a thin wrapper. It's covered by the integration test (Task 19) and the `BwfProvider` test indirectly.

- [ ] **Step 1: Implement**

Create `lib/providers/bwf/api-client.ts`:

```ts
import { request } from './cf-context'

export interface TournamentDetailParams { tmtId: number }
export interface TournamentDrawsParams { tmtId: number; tmtType?: number; tmtTab?: string }
export interface TournamentDrawDataParams { tmtId: number; drawId: string; tmtType?: number; tmtTab?: string; isPara?: boolean }
export interface DayMatchesParams { tournamentCode: string; date: string; order?: 1 | 2; court?: number }

export async function fetchTournamentDetail(p: TournamentDetailParams): Promise<unknown> {
  return request('POST', '/api/vue-tournament-detail', { tmtId: p.tmtId })
}

export async function fetchTournamentDraws(p: TournamentDrawsParams): Promise<unknown> {
  return request('POST', '/api/vue-tournament-draws', {
    tmtId: p.tmtId,
    tmtType: p.tmtType ?? 0,
    tmtTab: p.tmtTab ?? 'draw',
  })
}

export async function fetchTournamentDrawData(p: TournamentDrawDataParams): Promise<unknown> {
  return request('POST', '/api/vue-tournament-draw-data', {
    tmtId: p.tmtId,
    tmtType: p.tmtType ?? 0,
    tmtTab: p.tmtTab ?? 'draw',
    drawId: p.drawId,
    isPara: p.isPara ?? false,
  })
}

export async function fetchDayMatches(p: DayMatchesParams): Promise<unknown> {
  const params = new URLSearchParams({
    tournamentCode: p.tournamentCode,
    date: p.date,
    order: String(p.order ?? 2),
    court: String(p.court ?? 0),
  })
  return request('GET', `/api/tournaments/day-matches?${params}`)
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/providers/bwf/api-client.ts
git commit -m "feat(bwf): typed API client for 4 phase-1 endpoints"
```

---

## Section C — Compose, Wire, Integrate

### Task 12: Real `BatProvider` (pass-through wrapper)

**Files:**
- Modify: `lib/providers/bat-provider.ts`

This task replaces the stub from Task 9 with a real wrapper. The wrapper imports the existing BAT code and calls it directly — no logic moved, no rewrites.

- [ ] **Step 1: Read existing BAT call patterns**

Read these files to confirm the BAT signatures the wrapper must call:
- `lib/scraper.ts` — `parseTournaments`, `parseTournamentDraws`, `parseBracket`, `parseTournamentMeta`, `parseMatchesPartial`, etc.
- `lib/bat-fetch.ts` — `batFetch(kind, url, init)`
- `lib/draws-cache.ts` — for the BAT URL shape used in fetches
- `lib/bracket-cache.ts` — same
- `lib/matches-full-cache.ts` — same

- [ ] **Step 2: Implement the wrapper**

Replace the stub in `lib/providers/bat-provider.ts`:

```ts
import * as cheerio from 'cheerio'
import { batFetch } from '@/lib/bat-fetch'
import {
  parseTournamentDraws,
  parseTournamentMeta,
  parseBracket,
  parseMatchesPartial,
  orderScheduleGroups,
} from '@/lib/scraper'
import type {
  TournamentInfo, DrawInfo, BracketData, MatchesData,
  MatchScheduleGroup, MatchEntry, PlayerProfile, H2HData,
  TournamentRef,
} from '@/lib/types'
import type { TournamentProvider } from './types'
import { NotImplementedError } from './types'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

async function fetchHtml(kind: string, url: string): Promise<string | null> {
  const res = await batFetch(kind, url, { headers: HEADERS })
  if (!res.ok) return null
  return res.text()
}

export const batProvider: TournamentProvider = {
  tag: 'bat',
  async getMeta(ref: TournamentRef): Promise<TournamentInfo | null> {
    const html = await fetchHtml('meta', `https://bat.tournamentsoftware.com/sport/draws.aspx?id=${ref.id}`)
    if (!html) return null
    const info = parseTournamentMeta(html)
    if (!info) return null
    return { id: ref.id, name: info.name, provider: 'bat' }
  },
  async getDraws(ref: TournamentRef): Promise<DrawInfo[]> {
    const html = await fetchHtml('draws', `https://bat.tournamentsoftware.com/sport/draws.aspx?id=${ref.id}`)
    if (!html) return []
    return parseTournamentDraws(html)
  },
  async getBracket(ref: TournamentRef, drawNum: string): Promise<BracketData | null> {
    const html = await fetchHtml('bracket', `https://bat.tournamentsoftware.com/sport/draw.aspx?id=${ref.id}&draw=${drawNum}`)
    if (!html) return null
    return parseBracket(html)
  },
  async getMatchesFull(ref: TournamentRef): Promise<MatchesData | null> {
    const html = await fetchHtml('matches-full', `https://bat.tournamentsoftware.com/sport/matches.aspx?id=${ref.id}`)
    if (!html) return null
    const partial = parseMatchesPartial(html)
    if (!partial) return null
    return { ...partial, groups: orderScheduleGroups(partial.groups) }
  },
  async getDayMatches(ref: TournamentRef, dateIso: string): Promise<MatchScheduleGroup[]> {
    const full = await this.getMatchesFull(ref)
    if (!full) return []
    // existing BAT semantics: filter groups for the given dateIso
    const day = full.days.find((d) => d.dateIso === dateIso)
    if (!day) return []
    return full.groups
  },
  async getPlayer(_ref: TournamentRef, _playerId: string): Promise<PlayerProfile | null> {
    // Phase 1 stub: BAT player profile is read from BAT directly elsewhere (`lib/playerStats.ts`).
    // The dispatch helper is not yet wired into player routes — keep BAT behavior identical for now.
    throw new NotImplementedError('getPlayer', 'bat')
  },
  async getH2H(): Promise<H2HData | null> {
    throw new NotImplementedError('getH2H', 'bat')
  },
  async getLiveScore(): Promise<MatchEntry | null> {
    throw new NotImplementedError('getLiveScore', 'bat')
  },
}
```

Note: `getPlayer`, `getH2H`, `getLiveScore` throw `NotImplementedError` for BAT because those routes are NOT yet dispatched through the provider in phase 1. They still call BAT directly via existing code. This is intentional — phase 1 only dispatches `getMeta`/`getDraws`/`getBracket`/`getMatchesFull`/`getDayMatches`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `parseBracket`/`parseMatchesPartial` signatures don't match exactly, adjust the wrapper to match the real signatures from `lib/scraper.ts` (use the same arguments the existing callers in `lib/bracket-cache.ts` and `lib/matches-full-cache.ts` pass).

- [ ] **Step 4: Commit**

```bash
git add lib/providers/bat-provider.ts
git commit -m "feat: BatProvider pass-through wrapper (no logic moved)"
```

---

### Task 13: Real `BwfProvider` (composes parsers + api-client + sidecar)

**Files:**
- Modify: `lib/providers/bwf-provider.ts`

- [ ] **Step 1: Implement**

Replace the stub from Task 9 with:

```ts
import { lookupByGuid } from './bwf/sidecar'
import {
  fetchTournamentDetail,
  fetchTournamentDraws,
  fetchTournamentDrawData,
  fetchDayMatches,
} from './bwf/api-client'
import {
  parseTournamentDetail,
  parseDraws,
  parseDrawData,
  parseDayMatches,
} from './bwf/parsers'
import { buildBracketHtml } from './bwf/bracket-html'
import type {
  TournamentInfo, DrawInfo, BracketData, MatchesData,
  MatchScheduleGroup, MatchEntry, PlayerProfile, H2HData,
  TournamentRef,
} from '@/lib/types'
import type { TournamentProvider } from './types'
import { NotImplementedError } from './types'

function resolveOrThrow(ref: TournamentRef) {
  const entry = lookupByGuid(ref.id)
  if (!entry) throw new Error(`[bwf] no sidecar entry for ${ref.id}`)
  return entry
}

export const bwfProvider: TournamentProvider = {
  tag: 'bwf',
  async getMeta(ref) {
    try {
      const { tmtId } = resolveOrThrow(ref)
      const json = await fetchTournamentDetail({ tmtId })
      return parseTournamentDetail(json)
    } catch (err) {
      console.warn('[bwf] getMeta failed:', err)
      return null
    }
  },
  async getDraws(ref) {
    try {
      const { tmtId } = resolveOrThrow(ref)
      const json = await fetchTournamentDraws({ tmtId })
      return parseDraws(json)
    } catch (err) {
      console.warn('[bwf] getDraws failed:', err)
      return []
    }
  },
  async getBracket(ref, drawNum) {
    try {
      const { tmtId } = resolveOrThrow(ref)
      const drawsJson = await fetchTournamentDraws({ tmtId })
      const drawInfo = parseDraws(drawsJson).find((d) => d.drawNum === drawNum)
      const drawName = drawInfo?.name ?? drawNum
      const data = await fetchTournamentDrawData({ tmtId, drawId: drawNum })
      const html = buildBracketHtml(data, drawName)
      return { html, format: 'single-elimination' as const }
    } catch (err) {
      console.warn('[bwf] getBracket failed:', err)
      return null
    }
  },
  async getMatchesFull(ref): Promise<MatchesData | null> {
    try {
      const entry = resolveOrThrow(ref)
      // Compute the day list from sidecar dates; build groups by hitting day-matches per day
      const days = enumerateDays(entry.startDateIso, entry.endDateIso)
      const allGroups: MatchScheduleGroup[] = []
      for (const dateIso of days) {
        const json = await fetchDayMatches({ tournamentCode: entry.tournamentCode, date: dateIso })
        const groups = parseDayMatches(json)
        allGroups.push(...groups)
      }
      return {
        days: days.map((dateIso) => ({
          date: dateIso, label: dateIso.slice(5), dateIso, hasMatches: true,
        })),
        currentDate: days[0] ?? '',
        groups: allGroups,
      }
    } catch (err) {
      console.warn('[bwf] getMatchesFull failed:', err)
      return null
    }
  },
  async getDayMatches(ref, dateIso) {
    try {
      const entry = resolveOrThrow(ref)
      const json = await fetchDayMatches({ tournamentCode: entry.tournamentCode, date: dateIso })
      return parseDayMatches(json)
    } catch (err) {
      console.warn('[bwf] getDayMatches failed:', err)
      return []
    }
  },
  async getPlayer(): Promise<PlayerProfile | null> { throw new NotImplementedError('getPlayer', 'bwf') },
  async getH2H(): Promise<H2HData | null> { throw new NotImplementedError('getH2H', 'bwf') },
  async getLiveScore(): Promise<MatchEntry | null> { throw new NotImplementedError('getLiveScore', 'bwf') },
}

function enumerateDays(startIso: string, endIso: string): string[] {
  const out: string[] = []
  const start = new Date(startIso + 'T00:00:00Z')
  const end = new Date(endIso + 'T00:00:00Z')
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/providers/bwf-provider.ts
git commit -m "feat: BwfProvider composes parsers + api-client + sidecar"
```

---

### Task 14: Extract tournaments.txt parser (with BAT-isolation snapshot)

**Files:**
- Create: `lib/tournaments-txt.ts`
- Modify: `app/api/tournaments/route.ts`
- Create: `__tests__/tournaments-txt.test.ts`

This is the **critical BAT-isolation step.** We must guarantee `parseTournamentsTxt` produces identical output for non-`@bwf` lines.

- [ ] **Step 1: Capture the current parser output as a baseline**

Write a one-off baseline-capture script. Run this in a fresh shell to dump the current parser's output:

```bash
cd /Users/ed/AI/BATBracket
node --input-type=module -e "
  const route = await import('./app/api/tournaments/route.ts');
  // route.ts doesn't export the parser; we read the same logic inline
  const fs = await import('fs');
  const path = await import('path');
  const content = fs.readFileSync(path.join(process.cwd(), 'public', 'tournaments.txt'), 'utf-8');
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const DENY_RE = /^#\s*deny\s+([A-Fa-f0-9-]{36})/;
  const denySet = new Set();
  const manualEntries = [];
  for (const l of lines) {
    const m = DENY_RE.exec(l);
    if (m) { denySet.add(m[1].toUpperCase()); continue; }
    if (l.startsWith('#')) continue;
    const sp = l.indexOf(' ');
    if (sp === -1) { manualEntries.push({ id: l.toUpperCase(), name: l }); continue; }
    const id = l.slice(0, sp).toUpperCase();
    const rest = l.slice(sp + 1).trim();
    const done = rest.endsWith('[done]');
    const name = done ? rest.slice(0, -6).trim() : rest;
    manualEntries.push({ id, name, ...(done && { done: true }) });
  }
  console.log(JSON.stringify({ manualEntries, denySet: [...denySet] }, null, 2));
"
```

Save the output as the expected baseline for the test (it'll be embedded inline below — capture it now so the test's expected value reflects today's tournaments.txt).

- [ ] **Step 2: Write the failing test**

Create `__tests__/tournaments-txt.test.ts`. Use the actual baseline from Step 1 — the example below is illustrative; replace `EXPECTED_BAT_OUTPUT` with the real output.

```ts
import { parseTournamentsTxt } from '@/lib/tournaments-txt'

const MIXED_INPUT = `
# BAT Thailand Tournament IDs
# Format: GUID Tournament Name

4526a530-2091-4932-adab-b0a9b1fff98e SPRC - CALTEX BADMINTON CHAMPIONSHIP 2026
1BEC8194-C338-4CB0-AA1D-7444C90F5DE6 Trang Yonex Open 2026 Presented by Pumpui [done]
D5DF6DCC-DBCE-4E78-8B43-E4681BEFE8CC โตโยต้า เยาวชนชิงชนะเลิศแห่งประเทศไทย ประจำปี 2569 [done]
# deny 11111111-2222-3333-4444-555555555555

@bwf https://bwfbadminton.com/tournament/5726/mith-yonex-pathumthanee-u13-u15-u17-international-junior-2026/
@bwf https://bwfbadminton.com/tournament/5670/baoji-china-masters-2026/ [done]
`.trim()

describe('parseTournamentsTxt', () => {
  it('BAT-shaped lines produce identical output to legacy parser', () => {
    const { manualEntries, denySet } = parseTournamentsTxt(MIXED_INPUT)
    // Filter to BAT entries (no @bwf processing yet, just verifying BAT lines unchanged)
    const batEntries = manualEntries.filter((e) => !e.provider || e.provider === 'bat')
    expect(batEntries).toEqual([
      { id: '4526A530-2091-4932-ADAB-B0A9B1FFF98E', name: 'SPRC - CALTEX BADMINTON CHAMPIONSHIP 2026' },
      { id: '1BEC8194-C338-4CB0-AA1D-7444C90F5DE6', name: 'Trang Yonex Open 2026 Presented by Pumpui', done: true },
      { id: 'D5DF6DCC-DBCE-4E78-8B43-E4681BEFE8CC', name: 'โตโยต้า เยาวชนชิงชนะเลิศแห่งประเทศไทย ประจำปี 2569', done: true },
    ])
    expect([...denySet]).toEqual(['11111111-2222-3333-4444-555555555555'])
  })

  it('emits @bwf entries with provider=bwf when sidecar has entry', () => {
    // The parser doesn't resolve URLs by itself in tests — it relies on the sidecar.
    // Mock the sidecar via the dependency-injection hook.
    const { manualEntries } = parseTournamentsTxt(MIXED_INPUT, {
      lookupByUrl: (url) => {
        if (url.includes('5726')) return {
          tmtId: 5726, tournamentCode: 'AAAA1111-2222-3333-4444-555555555555',
          slug: 'x', name: 'MITH 2026', startDateIso: '2026-05-19', endDateIso: '2026-05-24', resolvedAt: 'x',
        }
        if (url.includes('5670')) return {
          tmtId: 5670, tournamentCode: 'BBBB2222-2222-3333-4444-555555555555',
          slug: 'y', name: 'BAOJI 2026', startDateIso: '2026-04-01', endDateIso: '2026-04-06', resolvedAt: 'x',
        }
        return null
      },
    })
    const bwf = manualEntries.filter((e) => e.provider === 'bwf')
    expect(bwf).toEqual([
      { id: 'AAAA1111-2222-3333-4444-555555555555', name: 'MITH 2026', provider: 'bwf' },
      { id: 'BBBB2222-2222-3333-4444-555555555555', name: 'BAOJI 2026', provider: 'bwf', done: true },
    ])
  })

  it('skips @bwf lines with no sidecar entry (fire-and-forget resolution)', () => {
    const resolved: string[] = []
    const { manualEntries } = parseTournamentsTxt(MIXED_INPUT, {
      lookupByUrl: () => null,
      onUnresolved: (url) => { resolved.push(url) },
    })
    expect(manualEntries.filter((e) => e.provider === 'bwf')).toEqual([])
    expect(resolved).toHaveLength(2)
  })
})
```

- [ ] **Step 3: Run, verify fail**

Run: `npx jest __tests__/tournaments-txt.test.ts`
Expected: All fail (module missing).

- [ ] **Step 4: Create the extracted parser**

Create `lib/tournaments-txt.ts`:

```ts
import { lookupByUrl as defaultLookupByUrl } from '@/lib/providers/bwf/sidecar'
import type { SidecarEntry } from '@/lib/providers/bwf/sidecar'
import type { TournamentInfo } from '@/lib/types'

export interface ParsedTxt {
  manualEntries: TournamentInfo[]
  denySet: Set<string>
}

export interface ParseDeps {
  lookupByUrl?: (url: string) => SidecarEntry | null
  onUnresolved?: (url: string) => void
}

const DENY_RE = /^#\s*deny\s+([A-Fa-f0-9-]{36})/
const BWF_RE = /^@bwf\s+(https?:\/\/\S+?)\s*(?:\[done\])?\s*$/
const BWF_DONE_RE = /^@bwf\s+\S+\s+\[done\]\s*$/

export function parseTournamentsTxt(content: string, deps: ParseDeps = {}): ParsedTxt {
  const lookup = deps.lookupByUrl ?? defaultLookupByUrl
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

  const denySet = new Set<string>()
  const manualEntries: TournamentInfo[] = []

  for (const l of lines) {
    // 1. deny line (existing branch, unchanged)
    const denyMatch = DENY_RE.exec(l)
    if (denyMatch) {
      denySet.add(denyMatch[1].toUpperCase())
      continue
    }
    // 2. @bwf line (NEW)
    if (l.startsWith('@bwf')) {
      const m = BWF_RE.exec(l)
      if (!m) continue
      const url = m[1]
      const done = BWF_DONE_RE.test(l)
      const entry = lookup(url)
      if (!entry) {
        deps.onUnresolved?.(url)
        continue
      }
      manualEntries.push({
        id: entry.tournamentCode.toUpperCase(),
        name: entry.name,
        provider: 'bwf',
        startDateIso: entry.startDateIso,
        ...(done && { done: true }),
      })
      continue
    }
    // 3. comment line (existing branch, unchanged)
    if (l.startsWith('#')) continue
    // 4. BAT GUID line (existing branch, unchanged)
    const spaceIdx = l.indexOf(' ')
    if (spaceIdx === -1) {
      manualEntries.push({ id: l.toUpperCase(), name: l })
      continue
    }
    const id = l.slice(0, spaceIdx).toUpperCase()
    const rest = l.slice(spaceIdx + 1).trim()
    const manualDone = rest.endsWith('[done]')
    const name = manualDone ? rest.slice(0, -6).trim() : rest
    manualEntries.push({ id, name, ...(manualDone && { done: true }) })
  }

  return { manualEntries, denySet }
}
```

- [ ] **Step 5: Update the route to import the extracted parser**

Modify `app/api/tournaments/route.ts`. Replace the `function parseTournamentsTxt(): ParsedTxt { ... }` body and the `ParsedTxt` interface (lines 14–54) with:

```ts
import { parseTournamentsTxt as parseFromTxt, type ParsedTxt } from '@/lib/tournaments-txt'
import { resolveBwfUrl } from '@/lib/providers/bwf/url-resolver-runtime'  // see note below
import { readFileSync } from 'fs'
import { join } from 'path'

function parseTournamentsTxt(): ParsedTxt {
  try {
    const content = readFileSync(join(process.cwd(), 'public', 'tournaments.txt'), 'utf-8')
    return parseFromTxt(content, {
      onUnresolved: (url) => { resolveBwfUrl(url).catch(() => {}) },
    })
  } catch {
    return { manualEntries: [], denySet: new Set() }
  }
}
```

`resolveBwfUrl` is a thin runtime helper. Create `lib/providers/bwf/url-resolver-runtime.ts`:

```ts
import { fetchPageHtml } from './cf-context'
import { extractMetaFromPageHtml } from './url-resolver'
import { saveSidecarEntry, lookupByUrl } from './sidecar'

const inFlight = new Set<string>()

export async function resolveBwfUrl(url: string): Promise<void> {
  if (lookupByUrl(url) || inFlight.has(url)) return
  inFlight.add(url)
  try {
    const html = await fetchPageHtml(url)
    const meta = extractMetaFromPageHtml(html)
    if (!meta) {
      console.warn('[bwf-resolve] could not extract meta from', url)
      return
    }
    // Date range: parse from page (e.g. "19 - 24 May") with the calendar year from current date.
    // For phase-1 we leave start/end as a best-effort placeholder — see Task 15 follow-up.
    saveSidecarEntry(url, {
      tmtId: meta.tmtId,
      tournamentCode: meta.tournamentCode,
      slug: meta.slug,
      name: meta.name,
      startDateIso: '',
      endDateIso: '',
      resolvedAt: new Date().toISOString(),
    })
    console.log('[bwf-resolve] resolved', url, '→ tmtId=' + meta.tmtId)
  } catch (err) {
    console.warn('[bwf-resolve] failed for', url, err)
  } finally {
    inFlight.delete(url)
  }
}
```

- [ ] **Step 6: Run tests**

Run: `npx jest __tests__/tournaments-txt.test.ts`
Expected: 3 tests pass.

Also run the FULL test suite to confirm BAT tests still pass:

Run: `npx jest`
Expected: all existing tests pass, plus the new ones.

- [ ] **Step 7: Commit**

```bash
git add lib/tournaments-txt.ts lib/providers/bwf/url-resolver-runtime.ts app/api/tournaments/route.ts __tests__/tournaments-txt.test.ts
git commit -m "feat: extract tournaments.txt parser, add @bwf line handling"
```

---

### Task 15: Parse BWF date range during URL resolution

**Files:**
- Modify: `lib/providers/bwf/url-resolver.ts`
- Modify: `__tests__/bwf-url-resolver.test.ts`
- Modify: `lib/providers/bwf/url-resolver-runtime.ts`

In Task 14 we left `startDateIso`/`endDateIso` empty as placeholders. Now extract the real date range from the page HTML. The fixture page has `<div class="live-date">19  - 24 May</div>`. The tournament year is implied by the slug/title (`...-2026`).

- [ ] **Step 1: Append failing test**

Add to `__tests__/bwf-url-resolver.test.ts`:

```ts
import { extractDatesFromPageHtml } from '@/lib/providers/bwf/url-resolver'

describe('extractDatesFromPageHtml', () => {
  it('extracts start/end dates from live-date div and slug year', () => {
    const html = `
      <html><body>
        <div class="live-date">19  - 24 May</div>
        <script>var app = new Vue({ data: { tournamentSlug: 'foo-2026' } });</script>
      </body></html>
    `
    expect(extractDatesFromPageHtml(html)).toEqual({
      startDateIso: '2026-05-19',
      endDateIso: '2026-05-24',
    })
  })

  it('handles cross-month range like "30 Apr - 5 May"', () => {
    const html = `<div class="live-date">30 Apr - 5 May</div><script>var x = { tournamentSlug: 'q-2026' }</script>`
    expect(extractDatesFromPageHtml(html)).toEqual({
      startDateIso: '2026-04-30',
      endDateIso: '2026-05-05',
    })
  })

  it('returns null on unparseable date', () => {
    expect(extractDatesFromPageHtml('<div>nope</div>')).toBeNull()
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npx jest __tests__/bwf-url-resolver.test.ts`
Expected: 3 new tests fail.

- [ ] **Step 3: Implement `extractDatesFromPageHtml`**

Append to `lib/providers/bwf/url-resolver.ts`:

```ts
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

const SAME_MONTH = /class="live-date">\s*(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,9})/
const CROSS_MONTH = /class="live-date">\s*(\d{1,2})\s+([A-Za-z]{3,9})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,9})/
const YEAR_FROM_SLUG = /tournamentSlug\s*:\s*['"][^'"]*?(\d{4})['"]/

export function extractDatesFromPageHtml(html: string): { startDateIso: string; endDateIso: string } | null {
  const year = YEAR_FROM_SLUG.exec(html)?.[1]
  if (!year) return null

  const cross = CROSS_MONTH.exec(html)
  if (cross) {
    const m1 = MONTHS[cross[2].slice(0, 3).toLowerCase()]
    const m2 = MONTHS[cross[4].slice(0, 3).toLowerCase()]
    if (!m1 || !m2) return null
    return {
      startDateIso: `${year}-${m1}-${cross[1].padStart(2, '0')}`,
      endDateIso: `${year}-${m2}-${cross[3].padStart(2, '0')}`,
    }
  }

  const same = SAME_MONTH.exec(html)
  if (same) {
    const m = MONTHS[same[3].slice(0, 3).toLowerCase()]
    if (!m) return null
    return {
      startDateIso: `${year}-${m}-${same[1].padStart(2, '0')}`,
      endDateIso: `${year}-${m}-${same[2].padStart(2, '0')}`,
    }
  }

  return null
}
```

- [ ] **Step 4: Wire into runtime resolver**

Modify `lib/providers/bwf/url-resolver-runtime.ts`. Replace the `saveSidecarEntry` call body inside `resolveBwfUrl`:

```ts
const dates = extractDatesFromPageHtml(html)
saveSidecarEntry(url, {
  tmtId: meta.tmtId,
  tournamentCode: meta.tournamentCode,
  slug: meta.slug,
  name: meta.name,
  startDateIso: dates?.startDateIso ?? '',
  endDateIso: dates?.endDateIso ?? '',
  resolvedAt: new Date().toISOString(),
})
```

Add the import at the top:

```ts
import { extractMetaFromPageHtml, extractDatesFromPageHtml } from './url-resolver'
```

- [ ] **Step 5: Run tests**

Run: `npx jest __tests__/bwf-url-resolver.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/providers/bwf/url-resolver.ts lib/providers/bwf/url-resolver-runtime.ts __tests__/bwf-url-resolver.test.ts
git commit -m "feat(bwf): parse start/end dates from tournament page"
```

---

### Task 16: Tournaments registry (id → provider lookup)

**Files:**
- Create: `lib/tournaments-registry.ts`
- Test: `__tests__/tournaments-registry.test.ts`

Cache modules need to map `string id` → `TournamentRef` without re-parsing tournaments.txt every call. The registry centralizes this.

- [ ] **Step 1: Write failing test**

Create `__tests__/tournaments-registry.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import os from 'os'
import { resolveRef, listAllTournaments, _refreshRegistryForTesting } from '@/lib/tournaments-registry'
import { resetSidecarForTesting, saveSidecarEntry } from '@/lib/providers/bwf/sidecar'

describe('tournaments registry', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'))
    fs.mkdirSync(path.join(tmpDir, 'public'))
    resetSidecarForTesting(path.join(tmpDir, 'public', 'bwf-cache.json'))
    saveSidecarEntry('https://bwfbadminton.com/tournament/5726/x/', {
      tmtId: 5726,
      tournamentCode: 'AAAA1111-2222-3333-4444-555555555555',
      slug: 'x', name: 'X', startDateIso: '2026-05-19', endDateIso: '2026-05-24', resolvedAt: 'x',
    })
    fs.writeFileSync(path.join(tmpDir, 'public', 'tournaments.txt'),
      `BBBB2222-2222-3333-4444-555555555555 BAT Test\n@bwf https://bwfbadminton.com/tournament/5726/x/\n`,
    )
    _refreshRegistryForTesting(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('resolves BAT GUID to a bat ref', () => {
    expect(resolveRef('BBBB2222-2222-3333-4444-555555555555')).toEqual({
      id: 'BBBB2222-2222-3333-4444-555555555555', provider: 'bat',
    })
  })

  it('resolves BWF GUID to a bwf ref', () => {
    expect(resolveRef('AAAA1111-2222-3333-4444-555555555555')).toEqual({
      id: 'AAAA1111-2222-3333-4444-555555555555', provider: 'bwf',
    })
  })

  it('lookup is case-insensitive on GUID', () => {
    expect(resolveRef('aaaa1111-2222-3333-4444-555555555555')?.provider).toBe('bwf')
  })

  it('lists all tournaments with provider tags', () => {
    const all = listAllTournaments()
    expect(all).toEqual(expect.arrayContaining([
      { id: 'BBBB2222-2222-3333-4444-555555555555', provider: 'bat', done: false },
      { id: 'AAAA1111-2222-3333-4444-555555555555', provider: 'bwf', done: false },
    ]))
  })

  it('returns bat by default for unknown IDs (backward-compat)', () => {
    expect(resolveRef('CCCC3333-2222-3333-4444-555555555555')?.provider).toBe('bat')
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npx jest __tests__/tournaments-registry.test.ts`
Expected: All fail.

- [ ] **Step 3: Implement**

Create `lib/tournaments-registry.ts`:

```ts
import fs from 'fs'
import path from 'path'
import { parseTournamentsTxt } from '@/lib/tournaments-txt'
import { listAllSidecar } from '@/lib/providers/bwf/sidecar'
import type { TournamentRef } from '@/lib/types'

interface RegistryEntry extends TournamentRef { done: boolean }

let entries: RegistryEntry[] = []
let byGuid: Map<string, RegistryEntry> = new Map()
let rootDir: string = process.cwd()
let lastBuilt = 0

export function _refreshRegistryForTesting(cwd: string): void {
  rootDir = cwd
  buildNow()
}

function buildNow(): void {
  entries = []
  byGuid = new Map()
  try {
    const txt = fs.readFileSync(path.join(rootDir, 'public', 'tournaments.txt'), 'utf-8')
    const parsed = parseTournamentsTxt(txt)
    for (const e of parsed.manualEntries) {
      const ref: RegistryEntry = {
        id: e.id.toUpperCase(),
        provider: e.provider ?? 'bat',
        done: e.done ?? false,
      }
      entries.push(ref)
      byGuid.set(ref.id, ref)
    }
    // Sidecar may have entries that aren't in tournaments.txt yet (e.g., resolved but not flushed)
    for (const s of listAllSidecar()) {
      const id = s.tournamentCode.toUpperCase()
      if (!byGuid.has(id)) {
        const ref: RegistryEntry = { id, provider: 'bwf', done: false }
        entries.push(ref)
        byGuid.set(id, ref)
      }
    }
  } catch (err) {
    console.warn('[registry] build failed:', err)
  }
  lastBuilt = Date.now()
}

const REFRESH_MS = 30_000

function ensureFresh(): void {
  if (Date.now() - lastBuilt > REFRESH_MS) buildNow()
}

export function resolveRef(id: string): TournamentRef | null {
  ensureFresh()
  const upper = id.toUpperCase()
  const e = byGuid.get(upper)
  if (e) return { id: e.id, provider: e.provider }
  // Backward-compat: unknown IDs default to BAT (existing BAT tournaments still work)
  return { id: upper, provider: 'bat' }
}

export function listAllTournaments(): RegistryEntry[] {
  ensureFresh()
  return [...entries]
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/tournaments-registry.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/tournaments-registry.ts __tests__/tournaments-registry.test.ts
git commit -m "feat: tournaments registry maps id -> {provider, done}"
```

---

### Task 17: Wire `lib/draws-cache.ts` to dispatch

**Files:**
- Modify: `lib/draws-cache.ts`

- [ ] **Step 1: Read the current shape**

Re-read `lib/draws-cache.ts` (lines 1-73) — note: `fetchDraws(id)` calls `batFetch` + `parseTournamentDraws` directly, and `readTournamentIds()` is a duplicated inline parser.

- [ ] **Step 2: Replace with provider-aware code**

Replace `lib/draws-cache.ts` entirely:

```ts
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef, listAllTournaments } from '@/lib/tournaments-registry'
import type { DrawInfo } from './types'

export const cache = new Map<string, { draws: DrawInfo[]; ts: number; done?: boolean }>()
export const TTL_MS = 30 * 60 * 1000

export async function fetchDraws(id: string, timeoutMs = 45000): Promise<DrawInfo[]> {
  const ref = resolveRef(id) ?? { id: id.toUpperCase(), provider: 'bat' as const }
  return providerFor(ref).getDraws(ref)
}

export async function fetchAndCache(id: string): Promise<DrawInfo[]> {
  const draws = await fetchDraws(id)
  cache.set(id, { draws, ts: Date.now() })
  return draws
}

export async function fetchAndCacheWithTtl(id: string, done: boolean): Promise<DrawInfo[]> {
  const draws = await fetchDraws(id)
  cache.set(id, { draws, ts: Date.now(), ...(done && { done: true }) })
  return draws
}

export async function prewarmDrawsCache(): Promise<void> {
  for (const ref of listAllTournaments()) {
    try {
      await fetchAndCacheWithTtl(ref.id, ref.done)
      console.log(`[draws-cache] pre-warmed: ${ref.id} (${ref.provider})${ref.done ? ' (done)' : ''}`)
    } catch (err) {
      console.warn(`[draws-cache] failed to pre-warm ${ref.id}:`, err)
    }
  }
}
```

Notice: the BAT path is preserved because `providerFor({ id, provider: 'bat' })` returns `batProvider`, which calls existing `lib/scraper.ts` + `lib/bat-fetch.ts`. The on-disk cache key (`id`) and the in-memory `cache` Map shape are unchanged.

- [ ] **Step 3: Run all tests, confirm no regressions**

Run: `npx jest`
Expected: all tests pass. If existing BAT tests fail (e.g., because they directly call `fetchDraws` and expect the BAT URL to be hit), investigate carefully — by design, BAT behavior should be byte-identical.

- [ ] **Step 4: Commit**

```bash
git add lib/draws-cache.ts
git commit -m "refactor: draws-cache dispatches through TournamentProvider"
```

---

### Task 18: Wire `bracket-cache.ts`, `matches-full-cache.ts`, `day-cache.ts`

**Files:**
- Modify: `lib/bracket-cache.ts`
- Modify: `lib/matches-full-cache.ts`
- Modify: `lib/day-cache.ts`

Apply the same pattern as Task 17. For each module:
1. Replace direct `batFetch` + parser calls with `providerFor(resolveRef(id)).getX(ref)`.
2. Replace inline `readTournamentIds()` (if present) with `listAllTournaments()`.
3. Keep the in-memory cache and on-disk cache file shapes identical.

- [ ] **Step 1: Modify `lib/bracket-cache.ts`**

Read the current file first. The fetch function is similar to `fetchDraws`. Apply the pattern:

```ts
// before (illustrative)
export async function fetchBracket(id: string, drawNum: string): Promise<BracketData> {
  const url = `https://bat.tournamentsoftware.com/sport/draw.aspx?id=${id}&draw=${drawNum}`
  const res = await batFetch('bracket', url, { headers: HEADERS })
  const html = await res.text()
  return parseBracket(html)
}

// after
import { providerFor } from '@/lib/providers/resolve'
import { resolveRef } from '@/lib/tournaments-registry'

export async function fetchBracket(id: string, drawNum: string): Promise<BracketData | null> {
  const ref = resolveRef(id) ?? { id: id.toUpperCase(), provider: 'bat' as const }
  return providerFor(ref).getBracket(ref, drawNum)
}
```

Keep `prewarmBracketCache()`, `cache`, and `TTL_MS` exports unchanged in shape; just update the iteration source from `readTournamentIds()` to `listAllTournaments()`.

- [ ] **Step 2: Modify `lib/matches-full-cache.ts`** with the same pattern, calling `getMatchesFull(ref)`.

- [ ] **Step 3: Modify `lib/day-cache.ts`** with the same pattern, calling `getDayMatches(ref, dateIso)`.

- [ ] **Step 4: Run all tests**

Run: `npx jest`
Expected: all tests pass.

- [ ] **Step 5: Smoke-test BAT path manually**

Start the dev server and visit `/tournament/<existing-BAT-guid>` (use one of the existing entries in `public/tournaments.txt`). Confirm that draws, bracket, and schedule all render exactly as before.

```bash
npm run dev
# Then open http://localhost:3000 in a browser, navigate to an existing BAT tournament
```

- [ ] **Step 6: Commit**

```bash
git add lib/bracket-cache.ts lib/matches-full-cache.ts lib/day-cache.ts
git commit -m "refactor: bracket/matches-full/day caches dispatch through providers"
```

---

### Task 19: `instrumentation.ts` prewarm hook

**Files:**
- Modify: `instrumentation.ts`

- [ ] **Step 1: Add the prime call**

Modify `instrumentation.ts`. Find the IIFE that prewarms caches (around line 11-15) and add the BWF priming call after it:

```ts
;(async () => {
  await prewarmMatchesFullCache()
  await prewarmDrawsCache()
  await prewarmBracketCache()
  // BWF: prime Chromium context so first user request doesn't pay cold-start.
  try {
    const { primeIfNeeded } = await import('./lib/providers/bwf/cf-context')
    await primeIfNeeded()
    console.log('[instrumentation] BWF CF context primed')
  } catch (err) {
    console.warn('[instrumentation] BWF prime failed (BWF tournaments will 503 until manual retry):', err)
  }
})().catch((err) => console.warn('[instrumentation] prewarm error:', err))
```

Failure is non-fatal — BAT continues working even if Chromium can't launch.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add instrumentation.ts
git commit -m "feat: prime BWF Chromium context at server startup"
```

---

### Task 20: Capture-fixtures script

**Files:**
- Create: `scripts/capture-bwf-fixtures.ts`

Optional one-off script to refresh canned fixtures from a real BWF tournament. Not run automatically.

- [ ] **Step 1: Create the script**

```ts
// scripts/capture-bwf-fixtures.ts
// Run with: npx tsx scripts/capture-bwf-fixtures.ts
// Captures JSON fixtures from BWF API for tournament 5726.

import fs from 'fs'
import path from 'path'
import { primeIfNeeded } from '@/lib/providers/bwf/cf-context'
import {
  fetchTournamentDetail,
  fetchTournamentDraws,
  fetchTournamentDrawData,
  fetchDayMatches,
} from '@/lib/providers/bwf/api-client'

const TMT_ID = 5726
const TOURNAMENT_CODE = '6E65C36E-497D-42D2-8F4E-78A2D30D9893'
const DRAW_ID = '11'  // BS U13 from tournament-draws fixture
const DATE = '2026-05-19'
const OUT = path.join(process.cwd(), 'fixtures', 'bwf')

async function main() {
  await primeIfNeeded()
  fs.mkdirSync(OUT, { recursive: true })

  const detail = await fetchTournamentDetail({ tmtId: TMT_ID })
  fs.writeFileSync(path.join(OUT, 'tournament-detail.real.json'), JSON.stringify(detail, null, 2))
  console.log('captured tournament-detail.real.json')

  const draws = await fetchTournamentDraws({ tmtId: TMT_ID })
  fs.writeFileSync(path.join(OUT, 'tournament-draws.real.json'), JSON.stringify(draws, null, 2))
  console.log('captured tournament-draws.real.json')

  const drawData = await fetchTournamentDrawData({ tmtId: TMT_ID, drawId: DRAW_ID })
  fs.writeFileSync(path.join(OUT, 'tournament-draw-data.real.json'), JSON.stringify(drawData, null, 2))
  console.log('captured tournament-draw-data.real.json')

  const day = await fetchDayMatches({ tournamentCode: TOURNAMENT_CODE, date: DATE })
  fs.writeFileSync(path.join(OUT, 'day-matches.real.json'), JSON.stringify(day, null, 2))
  console.log('captured day-matches.real.json')
}

main().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Commit**

```bash
git add scripts/capture-bwf-fixtures.ts
git commit -m "chore(bwf): one-off fixture capture script"
```

The script captures to `*.real.json` (not the same names as the test fixtures) so it doesn't accidentally overwrite the hand-crafted ones. If you want to update hand-crafted fixtures from a real capture, manually inspect and copy `*.real.json` → original name.

---

### Task 21: End-to-end smoke test

**Files:**
- Modify: `public/tournaments.txt`

This is the final validation. No code changes — just running the system against a real BWF tournament.

- [ ] **Step 1: Add a BWF tournament to tournaments.txt**

Append to `public/tournaments.txt`:

```
@bwf https://bwfbadminton.com/tournament/5726/mith-yonex-pathumthanee-u13-u15-u17-international-junior-2026/
```

- [ ] **Step 2: Start dev server**

```bash
npm run dev
```

- [ ] **Step 3: Confirm prewarm logs**

In the dev server output, look for:
- `[bwf-cf] primed: token=extracted`
- `[bwf-resolve] resolved https://bwfbadminton.com/tournament/5726/... → tmtId=5726`
- `[draws-cache] pre-warmed: 6E65C36E-... (bwf)`

If the resolve log doesn't appear within ~30 seconds, hit `/api/tournaments` in the browser to trigger the fire-and-forget resolution.

- [ ] **Step 4: Verify the tournament appears**

Open `http://localhost:3000/api/tournaments` in the browser. The MITH YONEX tournament should appear in the response with `provider: "bwf"`.

- [ ] **Step 5: Verify the UI**

Navigate to the main page. Click into the MITH YONEX tournament. Verify:
- Tournament name displays correctly
- Draws list shows (BS U13, GS U13, etc.)
- Click a draw — bracket renders in the same visual style as a BAT bracket
- Click match schedule — date tabs show, day matches appear grouped by court

- [ ] **Step 6: Verify BAT is unaffected**

Open any existing BAT tournament (e.g., SPRC CALTEX BADMINTON CHAMPIONSHIP 2026). Verify:
- Draws, bracket, schedule, stats — all render exactly as before this change
- Tournament list ordering is unchanged
- No console errors

- [ ] **Step 7: Verify CF refresh**

Leave the server running for 30 minutes. Tail the logs and confirm:
- `[bwf-cf]` logs every 25 minutes when TTL elapses
- No 403 retries needed in steady-state

- [ ] **Step 8: Commit (or revert) the BWF tournament entry**

If you want to keep the MITH YONEX tournament in `tournaments.txt`:

```bash
git add public/tournaments.txt
git commit -m "tournaments: add MITH YONEX U13/U15/U17 International Junior 2026 (BWF)"
```

Otherwise revert.

- [ ] **Step 9: Final type-check + test run**

```bash
npx tsc --noEmit && npx jest
```
Expected: no type errors; all tests pass.

---

## Self-Review Notes (from plan author)

This plan covers Phase 1 of the spec exclusively. Phases 2–5 (live scores, player profiles, H2H, stats, alerts, share-as-image) will be planned separately after Phase 1 lands and any hidden assumptions surface.

Spec coverage check:
- Hard constraint #1 (BAT byte-identity): Task 14 snapshot test + Task 17/18 smoke; `BatProvider` keeps existing scraper/bat-fetch calls verbatim.
- Hard constraint #2 (no BWF failure disturbs BAT): every BwfProvider method catches and degrades to null/empty (Task 13); instrumentation prime failure is non-fatal (Task 19).
- Hard constraint #3 (single URL entry): Task 14 + Task 15 + the runtime resolver implement auto-resolution from URL.
- Architecture (provider abstraction): Tasks 9, 12, 13.
- CF context lifecycle: Task 10 (with mocked-driver unit tests for the state machine; Task 21 exercises the real Chromium path).
- Data flow + sidecar: Tasks 3, 14, 15, 16.
- Error handling matrix: Implemented in Tasks 10 (401/403/5xx), 13 (try/catch per method), 19 (non-fatal prime), 14 (corrupt sidecar via Task 3 tests).
- Testing strategy: Unit tests cover parsers/sidecar/URL-resolver/CF-state-machine/registry/dispatch (Tasks 3-10, 14, 16). Integration test = manual smoke at Task 21. Fixture capture script at Task 20.

Tasks deliberately deferred to later phases:
- `getPlayer`, `getH2H`, `getLiveScore` are stubbed with `NotImplementedError` in both providers. The API routes for those features continue to call BAT directly (existing behavior unchanged). Wiring them through the provider is Phase 2.
- `stats-cache.ts` and `live-score.ts` are NOT modified in Phase 1 — they continue to call BAT directly. Phase 3 and Phase 2 respectively will wire them.

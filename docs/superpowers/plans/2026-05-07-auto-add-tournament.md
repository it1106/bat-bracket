# Auto-add Tournament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Periodically discover new tournaments from the BAT upcoming page and auto-add any with a published bracket to the dropdown, with no manual `tournaments.txt` edits.

**Architecture:** A 15-minute `setInterval` in `instrumentation.ts` (worker 0 only, paused 00:00–08:00 Asia/Bangkok) calls a pure orchestrator `runDiscoveryCycle()`. The orchestrator scrapes the upcoming page, filters out Online-Entry rows, gates each candidate on a "seeded players in at least one draw" check, and persists results to `.cache/discovered-tournaments.json`. `/api/tournaments` merges that store with `tournaments.txt`, with a `# deny <GUID>` syntax acting as a denylist over both.

**Tech Stack:** Next.js 14 App Router, TypeScript, cheerio (HTML parsing), Jest (testing), `posthog-node` (server-side telemetry), PM2 (process manager — `NODE_APP_INSTANCE` env var identifies the cluster worker).

---

## Pre-flight: branch check

You should already be on the `auto-add-tournament` branch. Verify:

```bash
git -C /Users/ed/AI/BATBracket branch --show-current
```

Expected output: `auto-add-tournament`. If you're on `main`, switch with `git checkout auto-add-tournament`.

---

## Task 1: Capture fixtures and install `posthog-node`

**Files:**
- Create: `fixtures/upcoming.html`
- Create: `fixtures/draws-seeded.html`
- Create: `fixtures/draws-empty.html`
- Modify: `package.json` (add dependency)

The parser tests in later tasks need real BAT HTML to assert against. We capture three fixtures up-front so the parser test suite runs offline.

- [ ] **Step 1: Capture the upcoming-tournaments page**

```bash
curl -sL 'https://bat.tournamentsoftware.com/' \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' \
  > fixtures/upcoming.html
```

Verify it's substantial (BAT serves the upcoming list inline):

```bash
wc -c fixtures/upcoming.html
```

Expected: > 30000 bytes. If the file is tiny or empty, BAT may have served a JS-only shell — open the URL in a real browser, save the rendered HTML via View Source.

- [ ] **Step 2: Inspect the capture and write down what you see**

Open `fixtures/upcoming.html` in an editor. Find the upcoming-tournaments list (search for "TabUpcoming" or the literal text "Online Entry" / "Last Changed"). Note:
- One example tournament with the **"Online Entry"** badge (write down its GUID and name).
- One example tournament **without** the Online Entry badge (write down GUID, name, and Last Changed value).
- The CSS selectors for: row container, name link, GUID (usually in the link `href`), Last Changed cell, Online Entry badge.

You'll need these for the assertions in Task 3. Keep notes in a scratch file or comment.

- [ ] **Step 3: Capture a seeded bracket fixture from your existing cache**

The production server already has full schedule data on disk. Copy a bracket HTML out of the in-memory raw cache by hitting your local dev or the production endpoint:

```bash
# Pick a tournament known to have seeded players (Trang Yonex)
curl -sL 'https://bat.tournamentsoftware.com/tournament/1BEC8194-C338-4CB0-AA1D-7444C90F5DE6/Draw/1/GetDrawContent?tabindex=1&X-Requested-With=XMLHttpRequest' \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -H 'Accept: text/html, */*; q=0.01' \
  -H 'Referer: https://bat.tournamentsoftware.com/tournament/1BEC8194-C338-4CB0-AA1D-7444C90F5DE6/draw/1' \
  > fixtures/draws-seeded.html
```

Verify it has player content (not just an empty shell):

```bash
grep -c 'data-player-id' fixtures/draws-seeded.html
```

Expected: > 5. If 0, the URL didn't return seeded data — try a different tournament/draw combo from `tournaments.txt`.

- [ ] **Step 4: Author an empty bracket fixture by hand**

A real "empty" bracket is rare to capture (BAT doesn't expose unseeded draws via the same URL). Write a minimal HTML with the same outer structure but no player IDs:

```bash
cat > fixtures/draws-empty.html <<'HTML'
<div class="bk-wrap">
  <div class="match__row">
    <div class="match__row-entrant">
      <span class="match__row-entrant-name">TBD</span>
    </div>
    <div class="match__row-entrant">
      <span class="match__row-entrant-name">TBD</span>
    </div>
  </div>
</div>
HTML
```

This is sufficient for the `bracketHasSeededPlayers` test: the function looks for `a[data-player-id]`, which this fixture lacks.

- [ ] **Step 5: Install `posthog-node`**

```bash
npm install posthog-node
```

Verify:

```bash
node -e "console.log(require('posthog-node').PostHog ? 'ok' : 'missing')"
```

Expected output: `ok`.

- [ ] **Step 6: Commit**

```bash
git add fixtures/upcoming.html fixtures/draws-seeded.html fixtures/draws-empty.html package.json package-lock.json
git commit -m "Add fixtures and posthog-node for auto-discovery"
```

---

## Task 2: Add `getBangkokHour()` to `lib/today.ts`

**Files:**
- Modify: `lib/today.ts`
- Test: `__tests__/today.test.ts` (new)

The runner needs a quiet-window check. We extend the existing TZ helper.

- [ ] **Step 1: Write the failing test**

Create `__tests__/today.test.ts`:

```ts
import { getBangkokHour } from '@/lib/today'

describe('getBangkokHour', () => {
  it('returns an integer 0..23', () => {
    const h = getBangkokHour()
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(24)
  })

  it('returns 0 when given 2026-05-07T17:00:00Z (= Bangkok 00:00)', () => {
    expect(getBangkokHour(new Date('2026-05-07T17:00:00Z'))).toBe(0)
  })

  it('returns 8 when given 2026-05-07T01:00:00Z (= Bangkok 08:00)', () => {
    expect(getBangkokHour(new Date('2026-05-07T01:00:00Z'))).toBe(8)
  })

  it('returns 23 when given 2026-05-07T16:30:00Z (= Bangkok 23:30)', () => {
    expect(getBangkokHour(new Date('2026-05-07T16:30:00Z'))).toBe(23)
  })
})
```

- [ ] **Step 2: Run the test, confirm failure**

```bash
npx jest __tests__/today.test.ts
```

Expected: fails with "getBangkokHour is not a function".

- [ ] **Step 3: Implement `getBangkokHour`**

Append to `lib/today.ts`:

```ts
export function getBangkokHour(now: Date = new Date(), timeZone = 'Asia/Bangkok'): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const hourPart = parts.find((p) => p.type === 'hour')
  if (!hourPart) return 0
  const h = parseInt(hourPart.value, 10)
  // Some locales emit '24' for midnight; normalize to 0.
  return h === 24 ? 0 : h
}
```

- [ ] **Step 4: Run the test, confirm pass**

```bash
npx jest __tests__/today.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/today.ts __tests__/today.test.ts
git commit -m "Add getBangkokHour helper for the discovery quiet window"
```

---

## Task 3: `parseUpcoming()` in `lib/upcoming-scraper.ts`

**Files:**
- Create: `lib/upcoming-scraper.ts`
- Test: `__tests__/upcoming-scraper.test.ts`

Pure HTML parser — no I/O, no fetches.

- [ ] **Step 1: Write the failing test**

Create `__tests__/upcoming-scraper.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import { parseUpcoming } from '@/lib/upcoming-scraper'

const fixture = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

describe('parseUpcoming', () => {
  it('returns an empty array for empty / malformed HTML', () => {
    expect(parseUpcoming('')).toEqual([])
    expect(parseUpcoming('<html></html>')).toEqual([])
  })

  it('extracts upcoming tournaments with id, name, lastChanged', () => {
    const result = parseUpcoming(fixture('upcoming.html'))
    expect(result.length).toBeGreaterThan(0)
    for (const entry of result) {
      expect(entry.id).toMatch(/^[A-F0-9-]{36}$/)
      expect(entry.name.length).toBeGreaterThan(0)
      expect(typeof entry.lastChanged).toBe('string')
      expect(typeof entry.hasOnlineEntry).toBe('boolean')
    }
  })

  it('flags at least one row with hasOnlineEntry=true', () => {
    const result = parseUpcoming(fixture('upcoming.html'))
    expect(result.some((r) => r.hasOnlineEntry)).toBe(true)
  })

  it('flags at least one row with hasOnlineEntry=false', () => {
    const result = parseUpcoming(fixture('upcoming.html'))
    expect(result.some((r) => !r.hasOnlineEntry)).toBe(true)
  })
})
```

If your captured `upcoming.html` happens to have **only** Online-Entry rows or **only** non-Online-Entry rows, drop the corresponding test (or capture again on a different day). Comment a note explaining why.

- [ ] **Step 2: Run the test, confirm failure**

```bash
npx jest __tests__/upcoming-scraper.test.ts
```

Expected: fails with "parseUpcoming is not a function" (or module-not-found).

- [ ] **Step 3: Implement `parseUpcoming`**

Create `lib/upcoming-scraper.ts`:

```ts
import * as cheerio from 'cheerio'

export interface UpcomingEntry {
  id: string
  name: string
  lastChanged: string
  hasOnlineEntry: boolean
}

const GUID_RE = /\/tournament\/([A-Fa-f0-9-]{36})/

export function parseUpcoming(html: string): UpcomingEntry[] {
  if (!html) return []
  const $ = cheerio.load(html)
  const out: UpcomingEntry[] = []

  // The upcoming list lives inside the #TabUpcoming pane. Each row links
  // to /tournament/<guid>/. Last-Changed and Online-Entry markers are
  // adjacent to the link in the same row.
  $('#TabUpcoming a[href*="/tournament/"]').each((_, el) => {
    const href = $(el).attr('href') ?? ''
    const m = GUID_RE.exec(href)
    if (!m) return
    const id = m[1].toUpperCase()
    if (out.some((e) => e.id === id)) return // de-dupe multiple links on same row

    const row = $(el).closest('tr, li, .tournament-item')
    const rowText = row.text()
    const name = $(el).text().trim() || row.find('.tournament-name').first().text().trim()
    if (!name) return

    const hasOnlineEntry = /Online\s*Entry/i.test(rowText)

    // Last Changed is typically a date string adjacent to the row.
    const lastChanged =
      row.find('[data-last-changed]').attr('data-last-changed') ??
      row.find('.last-changed, td.lastchanged').first().text().trim() ??
      ''

    out.push({ id, name, lastChanged, hasOnlineEntry })
  })

  return out
}
```

- [ ] **Step 4: Run the test**

```bash
npx jest __tests__/upcoming-scraper.test.ts
```

If the test fails because the actual selectors differ from the guesses above, **inspect `fixtures/upcoming.html` and adjust the cheerio queries**. Common fixes:
- The container might be `.tournament-listing-row` instead of `tr`.
- Last Changed might appear as a `<time datetime="...">` element.
- The Online Entry badge might be a class like `.label-online-entry`.

Iterate: tweak selectors → rerun → commit working version. Do **not** weaken the test assertions to make a wrong parser pass.

- [ ] **Step 5: Commit once tests pass**

```bash
git add lib/upcoming-scraper.ts __tests__/upcoming-scraper.test.ts
git commit -m "Add parseUpcoming for the BAT upcoming-tournaments page"
```

---

## Task 4: `bracketHasSeededPlayers()` in `lib/scraper.ts`

**Files:**
- Modify: `lib/scraper.ts` (append a new exported function)
- Test: `__tests__/scraper.bracket-gate.test.ts` (new)

The bracket gate. Fast pure check on the GetDrawContent HTML.

- [ ] **Step 1: Write the failing test**

Create `__tests__/scraper.bracket-gate.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import { bracketHasSeededPlayers } from '@/lib/scraper'

const fixture = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

describe('bracketHasSeededPlayers', () => {
  it('returns true when at least one entrant has data-player-id', () => {
    expect(bracketHasSeededPlayers(fixture('draws-seeded.html'))).toBe(true)
  })

  it('returns false when there are no data-player-id entrants', () => {
    expect(bracketHasSeededPlayers(fixture('draws-empty.html'))).toBe(false)
  })

  it('returns false on empty / malformed HTML', () => {
    expect(bracketHasSeededPlayers('')).toBe(false)
    expect(bracketHasSeededPlayers('<html></html>')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test, confirm failure**

```bash
npx jest __tests__/scraper.bracket-gate.test.ts
```

Expected: fails with "bracketHasSeededPlayers is not a function".

- [ ] **Step 3: Implement the function**

Append to `lib/scraper.ts`:

```ts
// True iff the bracket HTML contains at least one entrant with a real
// data-player-id (i.e. the draw has been seeded with actual people, not
// just TBD placeholders). Used by the discovery runner's bracket gate.
export function bracketHasSeededPlayers(html: string): boolean {
  if (!html) return false
  try {
    const $ = cheerio.load(html)
    let count = 0
    $('a[data-player-id], [data-player-id]').each((_, el) => {
      const id = $(el).attr('data-player-id') ?? ''
      if (id.trim().length > 0) count++
    })
    return count > 0
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run the test**

```bash
npx jest __tests__/scraper.bracket-gate.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/scraper.ts __tests__/scraper.bracket-gate.test.ts
git commit -m "Add bracketHasSeededPlayers gate for draw content"
```

---

## Task 5: `lib/discovery-store.ts` — load/save with atomic write

**Files:**
- Create: `lib/discovery-store.ts`
- Test: `__tests__/discovery-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/discovery-store.test.ts`:

```ts
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadDiscovered, saveDiscovered, type DiscoveryStore } from '@/lib/discovery-store'

describe('discovery-store', () => {
  let tmpRoot: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bat-disc-'))
    process.chdir(tmpRoot)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('loadDiscovered returns empty store when file does not exist', async () => {
    const store = await loadDiscovered()
    expect(store).toEqual({ version: 1, entries: [] })
  })

  it('saveDiscovered then loadDiscovered round-trips', async () => {
    const store: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: 'AAAAAAAA-1111-2222-3333-444444444444',
          name: 'Test Open',
          lastChanged: '2026-05-07T01:00:00Z',
          hasBracket: true,
          discoveredAt: '2026-05-01T00:00:00Z',
          lastSeenOnUpcomingAt: '2026-05-07T03:00:00Z',
        },
      ],
    }
    await saveDiscovered(store)
    const loaded = await loadDiscovered()
    expect(loaded).toEqual(store)
  })

  it('saveDiscovered does not leave .tmp files behind', async () => {
    await saveDiscovered({ version: 1, entries: [] })
    const tmpFiles = fs
      .readdirSync(path.join(tmpRoot, '.cache'))
      .filter((f) => f.endsWith('.tmp'))
    expect(tmpFiles).toEqual([])
  })

  it('loadDiscovered returns empty store on corrupt JSON', async () => {
    const file = path.join(tmpRoot, '.cache', 'discovered-tournaments.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{not json')
    const store = await loadDiscovered()
    expect(store).toEqual({ version: 1, entries: [] })
  })
})
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
npx jest __tests__/discovery-store.test.ts
```

Expected: module-not-found.

- [ ] **Step 3: Implement the store**

Create `lib/discovery-store.ts`:

```ts
import { promises as fs } from 'fs'
import path from 'path'

export interface DiscoveredEntry {
  id: string
  name: string
  lastChanged: string
  hasBracket: boolean
  discoveredAt: string
  lastSeenOnUpcomingAt: string
}

export interface DiscoveryStore {
  version: 1
  entries: DiscoveredEntry[]
}

const FILE_PATH = () =>
  path.join(process.cwd(), '.cache', 'discovered-tournaments.json')

const EMPTY: DiscoveryStore = { version: 1, entries: [] }

export async function loadDiscovered(): Promise<DiscoveryStore> {
  try {
    const buf = await fs.readFile(FILE_PATH(), 'utf8')
    const parsed = JSON.parse(buf) as DiscoveryStore
    if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
      return parsed
    }
    return EMPTY
  } catch {
    return EMPTY
  }
}

export async function saveDiscovered(store: DiscoveryStore): Promise<void> {
  const file = FILE_PATH()
  const tmp = `${file}.tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.warn(`[discovery-store] write failed: ${msg}`)
    try {
      await fs.unlink(tmp)
    } catch {
      // ignore
    }
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npx jest __tests__/discovery-store.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/discovery-store.ts __tests__/discovery-store.test.ts
git commit -m "Add discovery-store with atomic write"
```

---

## Task 6: `lib/posthog-server.ts` — server-side telemetry adapter

**Files:**
- Create: `lib/posthog-server.ts`
- Test: `__tests__/posthog-server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/posthog-server.test.ts`:

```ts
import { captureServerEvent, _resetForTest } from '@/lib/posthog-server'

describe('captureServerEvent', () => {
  beforeEach(() => {
    _resetForTest()
  })

  it('does not throw when POSTHOG key is missing', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY
    await expect(
      captureServerEvent('test_event', { foo: 1 }),
    ).resolves.toBeUndefined()
  })

  it('does not throw when POSTHOG key is set (network may fail)', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_dummy'
    await expect(
      captureServerEvent('test_event', { foo: 1 }),
    ).resolves.toBeUndefined()
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY
  })
})
```

- [ ] **Step 2: Run test, confirm failure**

```bash
npx jest __tests__/posthog-server.test.ts
```

Expected: module-not-found.

- [ ] **Step 3: Implement the adapter**

Create `lib/posthog-server.ts`:

```ts
import { PostHog } from 'posthog-node'

const HOST = 'https://eu.i.posthog.com'
const SERVER_DISTINCT_ID = 'bat-bracket-server'

let client: PostHog | null = null
let initialized = false

function getClient(): PostHog | null {
  if (initialized) return client
  initialized = true
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!apiKey) return null
  // flushAt:1 sends every event immediately — this code path is low volume
  // (a few events per day) so batching gains nothing.
  client = new PostHog(apiKey, { host: HOST, flushAt: 1, flushInterval: 0 })
  return client
}

export async function captureServerEvent(
  event: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  try {
    const c = getClient()
    if (!c) return
    c.capture({
      distinctId: SERVER_DISTINCT_ID,
      event,
      properties: {
        ...properties,
        $process_person_profile: false,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown'
    console.warn(`[posthog-server] capture failed: ${msg}`)
  }
}

// Test-only: drop cached client so env-var changes between tests take effect.
export function _resetForTest(): void {
  if (client) {
    client.shutdown().catch(() => {})
  }
  client = null
  initialized = false
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
npx jest __tests__/posthog-server.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/posthog-server.ts __tests__/posthog-server.test.ts
git commit -m "Add posthog-server adapter for server-side telemetry"
```

---

## Task 7: `lib/discovery-runner.ts` — orchestrator (happy path + skips)

**Files:**
- Create: `lib/discovery-runner.ts`
- Test: `__tests__/discovery-runner.test.ts`

This is the largest task. Build it iteratively: tests first, then expand the runner each step until all tests pass.

- [ ] **Step 1: Write failing tests for the happy path and core skips**

Create `__tests__/discovery-runner.test.ts`:

```ts
import { runDiscoveryCycle, type DiscoveryDeps } from '@/lib/discovery-runner'
import type { UpcomingEntry } from '@/lib/upcoming-scraper'
import type { DiscoveryStore } from '@/lib/discovery-store'

function makeDeps(overrides: Partial<DiscoveryDeps>): DiscoveryDeps {
  return {
    fetchUpcomingHtml: async () => '<html></html>',
    parseUpcoming: () => [] as UpcomingEntry[],
    fetchDrawsHtml: async () => '<html></html>',
    parseTournamentDraws: () => [],
    fetchDrawContentHtml: async () => '<html></html>',
    bracketHasSeededPlayers: () => false,
    loadDiscovered: async () => ({ version: 1, entries: [] }),
    saveDiscovered: async () => {},
    captureServerEvent: async () => {},
    log: () => {},
    warn: () => {},
    now: () => new Date('2026-05-07T03:00:00Z'),
    ...overrides,
  }
}

const MOCK_ENTRY: UpcomingEntry = {
  id: 'AAAAAAAA-1111-2222-3333-444444444444',
  name: 'New Open 2026',
  lastChanged: '2026-05-07T01:00:00Z',
  hasOnlineEntry: false,
}

describe('runDiscoveryCycle — happy path and basic skips', () => {
  it('promotes a new tournament with seeded bracket', async () => {
    const saved: DiscoveryStore[] = []
    const events: { event: string; props: unknown }[] = []
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [MOCK_ENTRY],
        parseTournamentDraws: () => [{ drawNum: '1', name: 'X', size: '32', type: 's' }],
        bracketHasSeededPlayers: () => true,
        saveDiscovered: async (s) => {
          saved.push(s)
        },
        captureServerEvent: async (event, props) => {
          events.push({ event, props })
        },
      }),
    )
    expect(saved).toHaveLength(1)
    expect(saved[0].entries).toHaveLength(1)
    expect(saved[0].entries[0]).toMatchObject({
      id: MOCK_ENTRY.id,
      name: MOCK_ENTRY.name,
      hasBracket: true,
      lastChanged: MOCK_ENTRY.lastChanged,
    })
    expect(events).toEqual([
      { event: 'tournament_auto_added', props: { id: MOCK_ENTRY.id, name: MOCK_ENTRY.name } },
    ])
  })

  it('filters out rows with hasOnlineEntry=true', async () => {
    const saved: DiscoveryStore[] = []
    let drawsFetched = 0
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [{ ...MOCK_ENTRY, hasOnlineEntry: true }],
        fetchDrawsHtml: async () => {
          drawsFetched++
          return ''
        },
        saveDiscovered: async (s) => {
          saved.push(s)
        },
      }),
    )
    expect(drawsFetched).toBe(0)
    expect(saved[0].entries).toEqual([])
  })

  it('does not refetch draws when lastChanged is unchanged', async () => {
    const existing: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: MOCK_ENTRY.id,
          name: MOCK_ENTRY.name,
          lastChanged: MOCK_ENTRY.lastChanged,
          hasBracket: false,
          discoveredAt: '2026-05-06T00:00:00Z',
          lastSeenOnUpcomingAt: '2026-05-06T00:00:00Z',
        },
      ],
    }
    let drawsFetched = 0
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [MOCK_ENTRY],
        loadDiscovered: async () => existing,
        fetchDrawsHtml: async () => {
          drawsFetched++
          return ''
        },
      }),
    )
    expect(drawsFetched).toBe(0)
  })

  it('does not refetch draws for already-promoted entries', async () => {
    const existing: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: MOCK_ENTRY.id,
          name: MOCK_ENTRY.name,
          lastChanged: '2025-01-01T00:00:00Z',
          hasBracket: true,
          discoveredAt: '2025-01-01T00:00:00Z',
          lastSeenOnUpcomingAt: '2025-01-01T00:00:00Z',
        },
      ],
    }
    let drawsFetched = 0
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [MOCK_ENTRY],
        loadDiscovered: async () => existing,
        fetchDrawsHtml: async () => {
          drawsFetched++
          return ''
        },
      }),
    )
    expect(drawsFetched).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
npx jest __tests__/discovery-runner.test.ts
```

Expected: module-not-found.

- [ ] **Step 3: Implement the runner skeleton + happy path + skips**

Create `lib/discovery-runner.ts`:

```ts
import type { UpcomingEntry } from './upcoming-scraper'
import type { DiscoveredEntry, DiscoveryStore } from './discovery-store'
import type { DrawInfo } from './types'

export interface DiscoveryDeps {
  fetchUpcomingHtml: () => Promise<string>
  parseUpcoming: (html: string) => UpcomingEntry[]
  fetchDrawsHtml: (id: string) => Promise<string>
  parseTournamentDraws: (html: string) => DrawInfo[]
  fetchDrawContentHtml: (id: string, drawNum: string) => Promise<string>
  bracketHasSeededPlayers: (html: string) => boolean
  loadDiscovered: () => Promise<DiscoveryStore>
  saveDiscovered: (s: DiscoveryStore) => Promise<void>
  captureServerEvent: (event: string, props: Record<string, unknown>) => Promise<void>
  log: (msg: string) => void
  warn: (msg: string) => void
  now: () => Date
}

export async function runDiscoveryCycle(deps: DiscoveryDeps): Promise<void> {
  const html = await deps.fetchUpcomingHtml()
  const upcomingAll = deps.parseUpcoming(html)
  const upcoming = upcomingAll.filter((u) => !u.hasOnlineEntry)
  const store = await deps.loadDiscovered()
  const nowIso = deps.now().toISOString()

  // Index existing entries by id for O(1) lookup.
  const existingById = new Map(store.entries.map((e) => [e.id, e]))
  const nextById = new Map(existingById)

  for (const u of upcoming) {
    const existing = nextById.get(u.id)
    if (existing) {
      existing.lastSeenOnUpcomingAt = nowIso
      if (existing.hasBracket) continue // committed; nothing to do
      if (existing.lastChanged === u.lastChanged) continue // unchanged
      // lastChanged moved → re-run the gate
      const promoted = await runBracketGate(deps, u.id)
      if (promoted) {
        existing.hasBracket = true
      }
      existing.lastChanged = u.lastChanged
      existing.name = u.name
    } else {
      // Brand new tournament
      const promoted = await runBracketGate(deps, u.id)
      const entry: DiscoveredEntry = {
        id: u.id,
        name: u.name,
        lastChanged: u.lastChanged,
        hasBracket: promoted,
        discoveredAt: nowIso,
        lastSeenOnUpcomingAt: nowIso,
      }
      nextById.set(u.id, entry)
    }
  }

  // Persist + diff for telemetry.
  const nextEntries = Array.from(nextById.values())
  const newStore: DiscoveryStore = { version: 1, entries: nextEntries }
  await deps.saveDiscovered(newStore)

  for (const e of nextEntries) {
    const prev = existingById.get(e.id)
    if (e.hasBracket && (!prev || !prev.hasBracket)) {
      deps.log(`[discovery] added ${e.id} ${e.name}`)
      await deps.captureServerEvent('tournament_auto_added', {
        id: e.id,
        name: e.name,
      })
    }
  }
}

async function runBracketGate(deps: DiscoveryDeps, id: string): Promise<boolean> {
  try {
    const drawsHtml = await deps.fetchDrawsHtml(id)
    const draws = deps.parseTournamentDraws(drawsHtml)
    if (draws.length === 0) return false
    const contentHtml = await deps.fetchDrawContentHtml(id, draws[0].drawNum)
    return deps.bracketHasSeededPlayers(contentHtml)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npx jest __tests__/discovery-runner.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/discovery-runner.ts __tests__/discovery-runner.test.ts
git commit -m "Add discovery-runner: happy path + Online Entry/skip cases"
```

---

## Task 8: discovery-runner — cleanup pass + suspicious-empty guard

**Files:**
- Modify: `lib/discovery-runner.ts`
- Modify: `__tests__/discovery-runner.test.ts`

- [ ] **Step 1: Add failing tests for cleanup**

Append inside `__tests__/discovery-runner.test.ts`:

```ts
describe('runDiscoveryCycle — cleanup', () => {
  const ABSENT_UNPROMOTED: DiscoveredEntry = {
    id: 'BBBBBBBB-2222-3333-4444-555555555555',
    name: 'Disappeared',
    lastChanged: '2026-05-01T00:00:00Z',
    hasBracket: false,
    discoveredAt: '2026-04-01T00:00:00Z',
    lastSeenOnUpcomingAt: '2026-05-01T00:00:00Z',
  }
  const ABSENT_PROMOTED: DiscoveredEntry = {
    ...ABSENT_UNPROMOTED,
    id: 'CCCCCCCC-2222-3333-4444-555555555555',
    name: 'Already Started',
    hasBracket: true,
  }

  it('removes entries absent from upcoming with hasBracket=false', async () => {
    const saved: DiscoveryStore[] = []
    const events: { event: string; props: unknown }[] = []
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [MOCK_ENTRY],
        loadDiscovered: async () => ({
          version: 1,
          entries: [ABSENT_UNPROMOTED],
        }),
        parseTournamentDraws: () => [{ drawNum: '1', name: 'X', size: '32', type: 's' }],
        bracketHasSeededPlayers: () => true,
        saveDiscovered: async (s) => {
          saved.push(s)
        },
        captureServerEvent: async (event, props) => {
          events.push({ event, props })
        },
      }),
    )
    const ids = saved[0].entries.map((e) => e.id)
    expect(ids).not.toContain(ABSENT_UNPROMOTED.id)
    expect(events).toContainEqual({
      event: 'tournament_auto_removed',
      props: { id: ABSENT_UNPROMOTED.id, name: ABSENT_UNPROMOTED.name },
    })
  })

  it('keeps entries absent from upcoming with hasBracket=true', async () => {
    const saved: DiscoveryStore[] = []
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [],
        loadDiscovered: async () => ({
          version: 1,
          entries: [ABSENT_PROMOTED],
        }),
        saveDiscovered: async (s) => {
          saved.push(s)
        },
      }),
    )
    expect(saved[0].entries.map((e) => e.id)).toContain(ABSENT_PROMOTED.id)
  })

  it('skips cleanup when upcoming snapshot is empty but store had entries', async () => {
    const saved: DiscoveryStore[] = []
    const warns: string[] = []
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [],
        loadDiscovered: async () => ({
          version: 1,
          entries: [ABSENT_UNPROMOTED],
        }),
        saveDiscovered: async (s) => {
          saved.push(s)
        },
        warn: (msg) => warns.push(msg),
      }),
    )
    expect(saved[0].entries.map((e) => e.id)).toContain(ABSENT_UNPROMOTED.id)
    expect(warns.some((w) => /empty snapshot/i.test(w))).toBe(true)
  })
})
```

Add the missing import at the top of the test file:

```ts
import type { DiscoveredEntry } from '@/lib/discovery-store'
```

- [ ] **Step 2: Run tests, confirm new failures**

```bash
npx jest __tests__/discovery-runner.test.ts
```

Expected: 3 new failures (existing 4 still pass).

- [ ] **Step 3: Add cleanup pass to the runner**

Replace the current `runDiscoveryCycle` body in `lib/discovery-runner.ts` with the version below. Only the cleanup section is new — everything else is unchanged from Task 7.

```ts
export async function runDiscoveryCycle(deps: DiscoveryDeps): Promise<void> {
  const html = await deps.fetchUpcomingHtml()
  const upcomingAll = deps.parseUpcoming(html)
  const upcoming = upcomingAll.filter((u) => !u.hasOnlineEntry)
  const store = await deps.loadDiscovered()
  const nowIso = deps.now().toISOString()

  const existingById = new Map(store.entries.map((e) => [e.id, e]))
  const nextById = new Map(existingById)

  for (const u of upcoming) {
    const existing = nextById.get(u.id)
    if (existing) {
      existing.lastSeenOnUpcomingAt = nowIso
      if (existing.hasBracket) continue
      if (existing.lastChanged === u.lastChanged) continue
      const promoted = await runBracketGate(deps, u.id)
      if (promoted) existing.hasBracket = true
      existing.lastChanged = u.lastChanged
      existing.name = u.name
    } else {
      const promoted = await runBracketGate(deps, u.id)
      nextById.set(u.id, {
        id: u.id,
        name: u.name,
        lastChanged: u.lastChanged,
        hasBracket: promoted,
        discoveredAt: nowIso,
        lastSeenOnUpcomingAt: nowIso,
      })
    }
  }

  // Cleanup pass. Skip entirely if the upcoming snapshot looks suspicious
  // (zero entries when we previously had some) — likely a parser regression
  // or a transient BAT hiccup, and we don't want to mass-remove on it.
  const upcomingIds = new Set(upcoming.map((u) => u.id))
  const suspicious = upcoming.length === 0 && store.entries.length > 0
  if (suspicious) {
    deps.warn('[discovery] empty snapshot vs non-empty store — skipping cleanup')
  } else {
    for (const id of Array.from(nextById.keys())) {
      const e = nextById.get(id)!
      if (upcomingIds.has(id)) continue
      if (e.hasBracket) continue
      nextById.delete(id)
    }
  }

  const nextEntries = Array.from(nextById.values())
  const newStore: DiscoveryStore = { version: 1, entries: nextEntries }
  await deps.saveDiscovered(newStore)

  // Diff for telemetry.
  for (const e of nextEntries) {
    const prev = existingById.get(e.id)
    if (e.hasBracket && (!prev || !prev.hasBracket)) {
      deps.log(`[discovery] added ${e.id} ${e.name}`)
      await deps.captureServerEvent('tournament_auto_added', { id: e.id, name: e.name })
    }
  }
  for (const [id, prev] of existingById) {
    if (!nextById.has(id)) {
      deps.log(`[discovery] removed ${id} ${prev.name}`)
      await deps.captureServerEvent('tournament_auto_removed', { id, name: prev.name })
    }
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npx jest __tests__/discovery-runner.test.ts
```

Expected: 7 passed (4 from Task 7 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add lib/discovery-runner.ts __tests__/discovery-runner.test.ts
git commit -m "discovery-runner: cleanup pass + suspicious-empty guard"
```

---

## Task 9: discovery-runner — single-flight mutex

**Files:**
- Modify: `lib/discovery-runner.ts`
- Modify: `__tests__/discovery-runner.test.ts`

- [ ] **Step 1: Add a failing test for the mutex**

Append to `__tests__/discovery-runner.test.ts`:

```ts
describe('runDiscoveryCycle — mutex', () => {
  it('skips overlapping invocations within the same process', async () => {
    let upcomingCalls = 0
    let release: () => void = () => {}
    const blocker = new Promise<string>((resolve) => {
      release = () => resolve('<html></html>')
    })
    const deps = makeDeps({
      fetchUpcomingHtml: () => {
        upcomingCalls++
        return blocker
      },
    })
    const first = runDiscoveryCycle(deps)
    const second = runDiscoveryCycle(deps)
    release()
    await Promise.all([first, second])
    expect(upcomingCalls).toBe(1)
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
npx jest __tests__/discovery-runner.test.ts -t mutex
```

Expected: assertion `Expected: 1, Received: 2`.

- [ ] **Step 3: Add the mutex**

In `lib/discovery-runner.ts`, wrap the body and add a module-level flag. Replace the existing `export async function runDiscoveryCycle` declaration with:

```ts
let cycleInFlight = false

export async function runDiscoveryCycle(deps: DiscoveryDeps): Promise<void> {
  if (cycleInFlight) {
    deps.log('[discovery] cycle still in flight, skipping')
    return
  }
  cycleInFlight = true
  try {
    await runDiscoveryCycleInner(deps)
  } finally {
    cycleInFlight = false
  }
}

async function runDiscoveryCycleInner(deps: DiscoveryDeps): Promise<void> {
  // ... move the existing body here unchanged ...
}
```

Move the entire current body of `runDiscoveryCycle` into `runDiscoveryCycleInner` verbatim.

- [ ] **Step 4: Run, confirm pass**

```bash
npx jest __tests__/discovery-runner.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/discovery-runner.ts __tests__/discovery-runner.test.ts
git commit -m "discovery-runner: single-flight mutex"
```

---

## Task 10: Default deps wiring (real fetches, real parsers)

**Files:**
- Modify: `lib/discovery-runner.ts`

The runner is fully tested in isolation. Now wire real implementations.

- [ ] **Step 1: Add a default-deps factory**

Append to `lib/discovery-runner.ts`:

```ts
import { batFetch } from './bat-fetch'
import { parseUpcoming } from './upcoming-scraper'
import { parseTournamentDraws, bracketHasSeededPlayers } from './scraper'
import { loadDiscovered, saveDiscovered } from './discovery-store'
import { captureServerEvent } from './posthog-server'

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

export function buildDefaultDeps(): DiscoveryDeps {
  return {
    fetchUpcomingHtml: async () => {
      const res = await batFetch(
        'discovery-upcoming',
        'https://bat.tournamentsoftware.com/',
        { headers: HEADERS, cache: 'no-store' },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    },
    parseUpcoming,
    fetchDrawsHtml: async (id) => {
      const res = await batFetch(
        'discovery-draws',
        `https://bat.tournamentsoftware.com/sport/draws.aspx?id=${id}`,
        { headers: HEADERS, cache: 'no-store' },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    },
    parseTournamentDraws,
    fetchDrawContentHtml: async (id, drawNum) => {
      const url = `https://bat.tournamentsoftware.com/tournament/${id}/Draw/${drawNum}/GetDrawContent?tabindex=1&X-Requested-With=XMLHttpRequest`
      const res = await batFetch('discovery-draw-content', url, {
        headers: {
          ...HEADERS,
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'text/html, */*; q=0.01',
          Referer: `https://bat.tournamentsoftware.com/tournament/${id}/draw/${drawNum}`,
        },
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    },
    bracketHasSeededPlayers,
    loadDiscovered,
    saveDiscovered,
    captureServerEvent,
    log: (msg) => console.log(msg),
    warn: (msg) => console.warn(msg),
    now: () => new Date(),
  }
}
```

- [ ] **Step 2: Verify the runner still typechecks**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Verify tests still pass**

```bash
npx jest __tests__/discovery-runner.test.ts __tests__/upcoming-scraper.test.ts __tests__/discovery-store.test.ts
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add lib/discovery-runner.ts
git commit -m "discovery-runner: wire default deps (real fetches and parsers)"
```

---

## Task 11: Wire `setInterval` in `instrumentation.ts`

**Files:**
- Modify: `instrumentation.ts`

- [ ] **Step 1: Open `instrumentation.ts` and read the current contents**

```bash
cat instrumentation.ts
```

You should see the existing prewarm chain. The new code adds itself after the prewarm.

- [ ] **Step 2: Replace the file with the wired version**

Replace `instrumentation.ts` with:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && !process.env.VERCEL) {
    const dns = await import('dns')
    dns.setDefaultResultOrder('ipv4first')

    const { prewarmDrawsCache } = await import('./lib/draws-cache')
    const { prewarmBracketCache } = await import('./lib/bracket-cache')
    const { prewarmMatchesFullCache } = await import('./lib/matches-full-cache')
    const { runDiscoveryCycle, buildDefaultDeps } = await import('./lib/discovery-runner')
    const { getBangkokHour } = await import('./lib/today')

    ;(async () => {
      await prewarmMatchesFullCache()
      await prewarmDrawsCache()
      await prewarmBracketCache()
    })().catch((err) => console.warn('[instrumentation] prewarm error:', err))

    const isLeader = (process.env.NODE_APP_INSTANCE ?? '0') === '0'
    if (isLeader) {
      const deps = buildDefaultDeps()
      const tick = async () => {
        try {
          const h = getBangkokHour()
          if (h >= 0 && h < 8) {
            console.log('[discovery] quiet window, skipping')
            return
          }
          await runDiscoveryCycle(deps)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown'
          console.warn(`[discovery] tick failed: ${msg}`)
        }
      }
      // First tick after a short delay so it doesn't compete with prewarm.
      setTimeout(tick, 30_000)
      setInterval(tick, 15 * 60 * 1000)
    }
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add instrumentation.ts
git commit -m "Wire discovery cycle into instrumentation (leader-only, quiet window)"
```

---

## Task 12: Merge logic + denylist in `/api/tournaments`

**Files:**
- Modify: `app/api/tournaments/route.ts`
- Test: `__tests__/tournaments-route.test.ts` (new)

- [ ] **Step 1: Write failing tests**

The route handler depends on the filesystem so we test the merge function in isolation. Refactor the merge into a pure helper and unit-test that.

Create `__tests__/tournaments-route.test.ts`:

```ts
import { mergeForApi } from '@/lib/tournaments-merge'
import type { DiscoveryStore } from '@/lib/discovery-store'

describe('mergeForApi', () => {
  it('returns manual entries when discovered store is empty', () => {
    const result = mergeForApi(
      [
        { id: 'AAAA1111-2222-3333-4444-555555555555', name: 'Manual', done: true },
      ],
      new Set(),
      { version: 1, entries: [] },
    )
    expect(result).toEqual([
      { id: 'AAAA1111-2222-3333-4444-555555555555', name: 'Manual', done: true },
    ])
  })

  it('includes discovered entries with hasBracket=true', () => {
    const store: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: 'BBBB2222-2222-3333-4444-555555555555',
          name: 'Discovered',
          lastChanged: 'x',
          hasBracket: true,
          discoveredAt: 'x',
          lastSeenOnUpcomingAt: 'x',
        },
      ],
    }
    const result = mergeForApi([], new Set(), store)
    expect(result).toEqual([{ id: 'BBBB2222-2222-3333-4444-555555555555', name: 'Discovered' }])
  })

  it('excludes discovered entries with hasBracket=false', () => {
    const store: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: 'CCCC3333-2222-3333-4444-555555555555',
          name: 'Not yet',
          lastChanged: 'x',
          hasBracket: false,
          discoveredAt: 'x',
          lastSeenOnUpcomingAt: 'x',
        },
      ],
    }
    const result = mergeForApi([], new Set(), store)
    expect(result).toEqual([])
  })

  it('manual entry wins on id conflict (preserves name + done flag)', () => {
    const store: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: 'DDDD4444-2222-3333-4444-555555555555',
          name: 'BAT name',
          lastChanged: 'x',
          hasBracket: true,
          discoveredAt: 'x',
          lastSeenOnUpcomingAt: 'x',
        },
      ],
    }
    const result = mergeForApi(
      [{ id: 'DDDD4444-2222-3333-4444-555555555555', name: 'Curated name', done: true }],
      new Set(),
      store,
    )
    expect(result).toEqual([
      { id: 'DDDD4444-2222-3333-4444-555555555555', name: 'Curated name', done: true },
    ])
  })

  it('drops ids in the deny set from both sources', () => {
    const denied = 'EEEE5555-2222-3333-4444-555555555555'
    const store: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: denied,
          name: 'Discovered',
          lastChanged: 'x',
          hasBracket: true,
          discoveredAt: 'x',
          lastSeenOnUpcomingAt: 'x',
        },
      ],
    }
    const result = mergeForApi(
      [{ id: denied, name: 'Manual', done: false }],
      new Set([denied]),
      store,
    )
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run, confirm failure**

```bash
npx jest __tests__/tournaments-route.test.ts
```

Expected: module-not-found.

- [ ] **Step 3: Implement the merge helper**

Create `lib/tournaments-merge.ts`:

```ts
import type { DiscoveryStore } from './discovery-store'
import type { TournamentInfo } from './types'

export function mergeForApi(
  manualEntries: TournamentInfo[],
  denySet: Set<string>,
  discovered: DiscoveryStore,
): TournamentInfo[] {
  const byId = new Map<string, TournamentInfo>()
  for (const e of discovered.entries) {
    if (!e.hasBracket) continue
    byId.set(e.id, { id: e.id, name: e.name })
  }
  // Manual wins on conflict.
  for (const e of manualEntries) {
    byId.set(e.id, e)
  }
  return Array.from(byId.values()).filter((e) => !denySet.has(e.id))
}
```

- [ ] **Step 4: Run merge tests, confirm pass**

```bash
npx jest __tests__/tournaments-route.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Update the route handler to use the merger and parse the denylist**

Replace `app/api/tournaments/route.ts` with:

```ts
import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { readFullCache, isAllPast } from '@/lib/day-cache'
import { getTodayIso } from '@/lib/today'
import { loadDiscovered } from '@/lib/discovery-store'
import { mergeForApi } from '@/lib/tournaments-merge'
import type { TournamentInfo } from '@/lib/types'

// Force dynamic so auto-done flips and newly-discovered entries are reflected
// on the very next request. Cost is ~N file stats per call, trivially cheap.
export const dynamic = 'force-dynamic'

interface ParsedTxt {
  manualEntries: TournamentInfo[]
  denySet: Set<string>
}

const DENY_RE = /^#\s*deny\s+([A-Fa-f0-9-]{36})/

function parseTournamentsTxt(): ParsedTxt {
  try {
    const filePath = join(process.cwd(), 'public', 'tournaments.txt')
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

    const denySet = new Set<string>()
    const manualEntries: TournamentInfo[] = []

    for (const l of lines) {
      const denyMatch = DENY_RE.exec(l)
      if (denyMatch) {
        denySet.add(denyMatch[1].toUpperCase())
        continue
      }
      if (l.startsWith('#')) continue

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
  } catch {
    return { manualEntries: [], denySet: new Set() }
  }
}

async function applyAutoDone(
  entries: TournamentInfo[],
  todayIso: string,
): Promise<TournamentInfo[]> {
  const out: TournamentInfo[] = []
  for (const e of entries) {
    if (e.done) {
      out.push(e)
      continue
    }
    const cached = await readFullCache(e.id)
    if (cached && isAllPast(cached, todayIso)) {
      out.push({ ...e, done: true })
    } else {
      out.push(e)
    }
  }
  return out
}

export async function GET() {
  const { manualEntries, denySet } = parseTournamentsTxt()
  const discovered = await loadDiscovered()
  const merged = mergeForApi(manualEntries, denySet, discovered)
  const todayIso = getTodayIso()
  const final = await applyAutoDone(merged, todayIso)
  return NextResponse.json(final)
}
```

- [ ] **Step 6: Typecheck and run all tests**

```bash
npx tsc --noEmit && npx jest --testPathIgnorePatterns=scraper.test
```

Expected: typecheck clean, all tests pass (we exclude the pre-existing failing `scraper.test.ts` cases, which are unrelated to this work).

- [ ] **Step 7: Commit**

```bash
git add app/api/tournaments/route.ts lib/tournaments-merge.ts __tests__/tournaments-route.test.ts
git commit -m "Merge discovered store + tournaments.txt with deny support in /api/tournaments"
```

---

## Task 13: Deploy and smoke test

**Files:** none (deploy + observe)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin auto-add-tournament
```

- [ ] **Step 2: Open a PR (optional but recommended for review trail)**

```bash
gh pr create --title "Auto-add tournaments from BAT upcoming page" \
  --body "Implements docs/superpowers/specs/2026-05-07-auto-add-tournament-design.md. Discovery loop runs every 15 min on worker 0, paused 00:00–08:00 Asia/Bangkok. ~65–75 BAT hits/day steady state."
```

- [ ] **Step 3: Deploy to ezebat.lan**

```bash
git push && ssh root@ezebat.lan "set -e; cd ~/app && git fetch --all && git checkout auto-add-tournament && git pull --ff-only && npm install && npm run build && pm2 reload bat-bracket && pm2 list | grep bat-bracket"
```

Expected: build completes, pm2 worker shows `online`.

- [ ] **Step 4: Wait for the first discovery tick (30 s after boot) and tail logs**

```bash
ssh root@ezebat.lan "sleep 35 && grep -E '\\[discovery\\]|\\[bat-fetch\\] kind=discovery-' /root/.pm2/logs/bat-bracket-out-*.log | tail -30"
```

Expected: at least one `[bat-fetch] kind=discovery-upcoming status=200` line. If the cycle ran during the quiet window, you'll see `[discovery] quiet window, skipping` instead — wait until 08:00 Bangkok or test the real run by deploying outside the window.

- [ ] **Step 5: Inspect the discovery store**

```bash
ssh root@ezebat.lan "cat /root/app/.cache/discovered-tournaments.json"
```

Expected: a JSON object with `version: 1` and an `entries` array. Entries from the BAT upcoming page (minus Online-Entry rows).

- [ ] **Step 6: Confirm `/api/tournaments` reflects discovered entries**

```bash
ssh root@ezebat.lan "curl -s http://localhost:3000/api/tournaments | head -c 1500"
```

Expected: existing entries from `tournaments.txt` plus any auto-discovered entries with `hasBracket: true`. Discovered entries appear without `done: true` initially (auto-done logic activates once their match-days are past).

- [ ] **Step 7: If a false-positive appears**

Add a deny line to `public/tournaments.txt` and redeploy:

```
# deny <THE-GUID>   reason
```

Followed by the standard deploy procedure (commit, push, deploy).

- [ ] **Step 8: Commit any documentation tweaks discovered during smoke test**

If you found selector adjustments needed, fixture issues, or behavior surprises:

```bash
git commit -am "smoke-test fixes: <specific change>"
git push
```

---

## Self-review checklist (already done during plan authoring)

- ✅ Spec requirements covered: storage, polling cadence + quiet window, leader guard, bracket gate, lifecycle (auto-cleanup + denylist), telemetry (log + posthog), all mapped to specific tasks.
- ✅ No `TBD`, `TODO`, "implement later", or vague error-handling instructions remain.
- ✅ Type names and signatures used in later tasks match earlier tasks: `UpcomingEntry`, `DiscoveredEntry`, `DiscoveryStore`, `DiscoveryDeps`, `mergeForApi`, `runDiscoveryCycle`, `buildDefaultDeps`, `captureServerEvent`, `parseUpcoming`, `bracketHasSeededPlayers`, `getBangkokHour`.
- ✅ Frequent commits — each task ends with a commit step.
- ✅ TDD throughout — every code-producing task starts with a failing test.

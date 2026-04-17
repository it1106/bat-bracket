# BAT Bracket Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js 14 web app that scrapes tournament brackets from bat.tournamentsoftware.com, renders them with player tracking and highlighting, and exports the full bracket as a JPG.

**Architecture:** Next.js API routes scrape bat.tournamentsoftware.com server-side (bypassing CORS), returning the raw `.bk-wrap` HTML from bracket draw pages. The React frontend injects it directly into the DOM via `dangerouslySetInnerHTML`, styled with custom CSS targeting the site's existing `.bk-*` classes. Player tracking and JPG export are fully client-side.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Cheerio, html-to-image, Jest, Vercel

---

## File Map

```
app/
  layout.tsx              # Root layout, loads global CSS
  page.tsx                # Main page — wires TopBar + BracketCanvas
  globals.css             # bk-* bracket styles + base reset
  api/
    tournaments/route.ts  # GET /api/tournaments
    events/route.ts       # GET /api/events?tournament=ID
    bracket/route.ts      # GET /api/bracket?tournament=ID&event=ID
components/
  TopBar.tsx              # Tournament/Event/Player dropdowns + Export button
  BracketCanvas.tsx       # Injects bk-wrap HTML, handles player tracking
  ExportButton.tsx        # Captures bracket + header as JPG
lib/
  scraper.ts              # parseTournaments / parseEvents / parseBracket
  types.ts                # Tournament, Event TypeScript types
__tests__/
  scraper.test.ts         # Unit tests for all three parsers using HTML fixtures
  bracket-route.test.ts   # API route smoke tests
fixtures/
  tournaments.html        # Saved sample HTML for scraper tests
  events.html
  bracket.html
next.config.js
tailwind.config.ts
jest.config.ts
.gitignore
vercel.json
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `next.config.js`, `tailwind.config.ts`, `tsconfig.json`, `jest.config.ts`, `.gitignore`

- [ ] **Step 1: Scaffold Next.js app**

```bash
cd /Users/ed/AI/BATBracket
npx create-next-app@14 . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --eslint
```

Expected: project files created, `npm run dev` works.

- [ ] **Step 2: Install dependencies**

```bash
npm install cheerio html-to-image
npm install --save-dev jest jest-environment-jsdom @testing-library/react @testing-library/jest-dom ts-jest @types/jest @types/cheerio
```

- [ ] **Step 3: Configure Jest**

Create `jest.config.ts`:
```typescript
import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'node',
  setupFilesAfterFramework: ['<rootDir>/jest.setup.ts'],
}

export default createJestConfig(config)
```

Create `jest.setup.ts`:
```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 4: Add test script to package.json**

In `package.json`, ensure scripts includes:
```json
"test": "jest",
"test:watch": "jest --watch"
```

- [ ] **Step 5: Update next.config.js for long scrape timeouts**

Replace contents of `next.config.js`:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {}
module.exports = nextConfig
```

- [ ] **Step 6: Create .gitignore additions**

Append to `.gitignore`:
```
.superpowers/
fixtures/
```

- [ ] **Step 7: Commit**

```bash
git init
git add -A
git commit -m "feat: scaffold Next.js 14 project with Tailwind and Jest"
```

---

## Task 2: TypeScript Types

**Files:**
- Create: `lib/types.ts`

- [ ] **Step 1: Write the types**

Create `lib/types.ts`:
```typescript
export interface Tournament {
  id: string
  name: string
  date: string
  url: string
}

export interface TournamentEvent {
  id: string
  name: string
  drawUrl: string
}

export interface BracketData {
  html: string        // raw .bk-wrap outerHTML
  format: 'single-elimination' | 'groups-knockout' | 'double-elimination' | 'unknown'
}

export interface ApiError {
  error: string
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add TypeScript types for tournament data"
```

---

## Task 3: HTML Fixtures for Tests

**Files:**
- Create: `fixtures/tournaments.html`, `fixtures/events.html`, `fixtures/bracket.html`

- [ ] **Step 1: Create tournament list fixture**

Create `fixtures/tournaments.html`:
```html
<!DOCTYPE html>
<html>
<body>
<div class="tournament-list">
  <div class="tournament-item">
    <a href="/tournament/abc123/schedule" class="tournament-name">BAT Thailand Junior Circuit 1/2569</a>
    <span class="tournament-date">17 Apr 2026</span>
  </div>
  <div class="tournament-item">
    <a href="/tournament/def456/schedule" class="tournament-name">BAT Thailand Open 2/2569</a>
    <span class="tournament-date">24 Apr 2026</span>
  </div>
</div>
</body>
</html>
```

> **Note:** This fixture uses assumed selectors. After running the app against the live site for the first time, update this fixture and the selectors in `lib/scraper.ts` to match the actual HTML structure.

- [ ] **Step 2: Create events fixture**

Create `fixtures/events.html`:
```html
<!DOCTYPE html>
<html>
<body>
<div class="draws">
  <a href="/tournament/abc123/draw/1" class="draw-link">Boys' Singles U17</a>
  <a href="/tournament/abc123/draw/2" class="draw-link">Girls' Singles U17</a>
  <a href="/tournament/abc123/draw/3" class="draw-link">Boys' Doubles U17</a>
</div>
</body>
</html>
```

- [ ] **Step 3: Create bracket fixture**

Create `fixtures/bracket.html` — paste the `.bk-wrap` HTML block you already have from the site (the full Round of 128 → Final structure shared during design). Wrap it in a minimal HTML shell:
```html
<!DOCTYPE html>
<html>
<body>
<div id="bracket-container">
  <div class="bk-wrap">
    <div class="bk-round" style="height:6688px">
      <div class="bk-round-label" style="height:32px;line-height:32px">Round of 128</div>
      <div class="bk-match-slot" style="top:46px">
        <div class="bk-match-box">
          <div class="bk-row winner"><span>เตชพัฒน์ ซิ้มยินดี [1]</span></div>
          <div class="bk-row bye bk-row--team-sep"><span></span></div>
        </div>
        <div class="bk-time">R128</div>
      </div>
    </div>
    <div class="bk-round" style="height:6688px">
      <div class="bk-round-label">Final</div>
      <div class="bk-match-slot" style="top:3322px">
        <div class="bk-match-box">
          <div class="bk-row bye"><span></span></div>
          <div class="bk-row bye bk-row--team-sep"><span></span></div>
        </div>
        <div class="bk-time">F</div>
      </div>
    </div>
  </div>
</div>
</body>
</html>
```

- [ ] **Step 4: Commit**

```bash
git add fixtures/
git commit -m "test: add HTML fixtures for scraper unit tests"
```

---

## Task 4: Scraper — Tournament List

**Files:**
- Create: `lib/scraper.ts`
- Create: `__tests__/scraper.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/scraper.test.ts`:
```typescript
import fs from 'fs'
import path from 'path'
import { parseTournaments } from '@/lib/scraper'

const fixtureHtml = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

describe('parseTournaments', () => {
  it('extracts tournament list from HTML', () => {
    const html = fixtureHtml('tournaments.html')
    const tournaments = parseTournaments(html)
    expect(tournaments).toHaveLength(2)
    expect(tournaments[0]).toEqual({
      id: 'abc123',
      name: 'BAT Thailand Junior Circuit 1/2569',
      date: '17 Apr 2026',
      url: '/tournament/abc123/schedule',
    })
  })

  it('returns empty array when no tournaments found', () => {
    const tournaments = parseTournaments('<html><body></body></html>')
    expect(tournaments).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=scraper
```

Expected: FAIL — `parseTournaments` not found.

- [ ] **Step 3: Implement parseTournaments**

Create `lib/scraper.ts`:
```typescript
import * as cheerio from 'cheerio'
import type { Tournament, TournamentEvent, BracketData } from './types'

const BASE_URL = 'https://bat.tournamentsoftware.com'

function extractId(url: string): string {
  const match = url.match(/\/tournament\/([^/]+)/)
  return match ? match[1] : url
}

export function parseTournaments(html: string): Tournament[] {
  const $ = cheerio.load(html)
  const results: Tournament[] = []

  // Adjust selector after verifying against live site
  $('.tournament-item').each((_, el) => {
    const link = $(el).find('a.tournament-name')
    const url = link.attr('href') ?? ''
    const name = link.text().trim()
    const date = $(el).find('.tournament-date').text().trim()
    if (name && url) {
      results.push({ id: extractId(url), name, date, url })
    }
  })

  return results
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --testPathPattern=scraper
```

Expected: PASS for `parseTournaments` tests.

- [ ] **Step 5: Commit**

```bash
git add lib/scraper.ts __tests__/scraper.test.ts
git commit -m "feat: add parseTournaments scraper with tests"
```

---

## Task 5: Scraper — Events List

**Files:**
- Modify: `lib/scraper.ts`
- Modify: `__tests__/scraper.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/scraper.test.ts`:
```typescript
import { parseTournaments, parseEvents } from '@/lib/scraper'

describe('parseEvents', () => {
  it('extracts draw events from HTML', () => {
    const html = fixtureHtml('events.html')
    const events = parseEvents(html)
    expect(events).toHaveLength(3)
    expect(events[0]).toEqual({
      id: '1',
      name: "Boys' Singles U17",
      drawUrl: '/tournament/abc123/draw/1',
    })
  })

  it('returns empty array when no draws found', () => {
    const events = parseEvents('<html><body></body></html>')
    expect(events).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=scraper
```

Expected: FAIL — `parseEvents` not found.

- [ ] **Step 3: Implement parseEvents**

Append to `lib/scraper.ts`:
```typescript
export function parseEvents(html: string): TournamentEvent[] {
  const $ = cheerio.load(html)
  const results: TournamentEvent[] = []

  // Adjust selector after verifying against live site
  $('a.draw-link').each((_, el) => {
    const drawUrl = $(el).attr('href') ?? ''
    const name = $(el).text().trim()
    const idMatch = drawUrl.match(/\/draw\/(\d+)/)
    const id = idMatch ? idMatch[1] : drawUrl
    if (name && drawUrl) {
      results.push({ id, name, drawUrl })
    }
  })

  return results
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern=scraper
```

Expected: all scraper tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scraper.ts __tests__/scraper.test.ts
git commit -m "feat: add parseEvents scraper with tests"
```

---

## Task 6: Scraper — Bracket HTML

**Files:**
- Modify: `lib/scraper.ts`
- Modify: `__tests__/scraper.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/scraper.test.ts`:
```typescript
import { parseTournaments, parseEvents, parseBracket } from '@/lib/scraper'

describe('parseBracket', () => {
  it('extracts bk-wrap HTML from bracket page', () => {
    const html = fixtureHtml('bracket.html')
    const result = parseBracket(html)
    expect(result.html).toContain('class="bk-wrap"')
    expect(result.html).toContain('bk-round')
  })

  it('detects single elimination format', () => {
    const html = fixtureHtml('bracket.html')
    const result = parseBracket(html)
    expect(result.format).toBe('single-elimination')
  })

  it('returns error html when bk-wrap not found', () => {
    const result = parseBracket('<html><body>not a bracket</body></html>')
    expect(result.html).toBe('')
    expect(result.format).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=scraper
```

Expected: FAIL — `parseBracket` not found.

- [ ] **Step 3: Implement parseBracket**

Append to `lib/scraper.ts`:
```typescript
export function parseBracket(html: string): BracketData {
  const $ = cheerio.load(html)
  const bkWrap = $('.bk-wrap')

  if (!bkWrap.length) {
    return { html: '', format: 'unknown' }
  }

  const hasGroups = bkWrap.find('table.group-table').length > 0
  const roundCount = bkWrap.find('.bk-round').length
  const hasDualBracket = bkWrap.find('.bk-loser-bracket').length > 0

  let format: BracketData['format'] = 'single-elimination'
  if (hasDualBracket) format = 'double-elimination'
  else if (hasGroups) format = 'groups-knockout'

  return {
    html: $.html(bkWrap),
    format,
  }
}
```

- [ ] **Step 4: Run all scraper tests**

```bash
npm test -- --testPathPattern=scraper
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scraper.ts __tests__/scraper.test.ts
git commit -m "feat: add parseBracket scraper with format detection and tests"
```

---

## Task 7: API Routes

**Files:**
- Create: `app/api/tournaments/route.ts`
- Create: `app/api/events/route.ts`
- Create: `app/api/bracket/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: Create tournaments route**

Create `app/api/tournaments/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { parseTournaments } from '@/lib/scraper'

export const revalidate = 900

export async function GET() {
  try {
    const res = await fetch('https://bat.tournamentsoftware.com/tournaments', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BATBrackets/1.0)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const tournaments = parseTournaments(html)
    return NextResponse.json(tournaments)
  } catch (err) {
    return NextResponse.json(
      { error: 'Could not load tournaments — the source site may be unavailable' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Create events route**

Create `app/api/events/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { parseEvents } from '@/lib/scraper'

export const revalidate = 900

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')

  if (!tournamentId) {
    return NextResponse.json({ error: 'Missing tournament parameter' }, { status: 400 })
  }

  try {
    const res = await fetch(
      `https://bat.tournamentsoftware.com/tournament/${tournamentId}/schedule`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BATBrackets/1.0)' } }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const events = parseEvents(html)
    return NextResponse.json(events)
  } catch (err) {
    return NextResponse.json(
      { error: 'Could not load events — the source site may be unavailable' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 3: Create bracket route**

Create `app/api/bracket/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { parseBracket } from '@/lib/scraper'

export const revalidate = 900

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tournamentId = searchParams.get('tournament')
  const eventId = searchParams.get('event')

  if (!tournamentId || !eventId) {
    return NextResponse.json({ error: 'Missing tournament or event parameter' }, { status: 400 })
  }

  try {
    const res = await fetch(
      `https://bat.tournamentsoftware.com/tournament/${tournamentId}/draw/${eventId}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BATBrackets/1.0)' } }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const bracket = parseBracket(html)

    if (!bracket.html) {
      return NextResponse.json(
        { error: 'Bracket data could not be parsed — the source site may have changed' },
        { status: 502 }
      )
    }

    return NextResponse.json(bracket)
  } catch (err) {
    return NextResponse.json(
      { error: 'Could not load bracket — the source site may be unavailable' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 4: Create Vercel config**

Create `vercel.json`:
```json
{
  "functions": {
    "app/api/bracket/route.ts": {
      "maxDuration": 30
    }
  }
}
```

- [ ] **Step 5: Verify routes exist**

```bash
npm run dev
```

Visit `http://localhost:3000/api/tournaments` — should return JSON (or an error from the source site, not a 404).

- [ ] **Step 6: Commit**

```bash
git add app/api/ vercel.json
git commit -m "feat: add API routes for tournaments, events, and bracket"
```

---

## Task 8: Bracket CSS

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Replace globals.css with bracket styles**

Replace the entire contents of `app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* ── Bracket canvas ── */
.bracket-canvas {
  overflow-x: auto;
  overflow-y: auto;
  padding: 20px;
  background: #f0f2f5;
  min-height: calc(100vh - 97px); /* below topbar + legend */
}

/* ── bk-wrap: root bracket container ── */
.bk-wrap {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  width: max-content;
  background: #fff;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 12px 0 24px 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.bk-round {
  position: relative;
  width: 200px;
  flex-shrink: 0;
}

.bk-round-label {
  font-size: 11px;
  font-weight: 700;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 0 8px 8px;
  border-bottom: 1px solid #f0f0f0;
  margin-bottom: 4px;
  height: 32px;
  line-height: 32px;
}

.bk-match-slot {
  position: absolute;
  left: 8px;
  right: 8px;
}

.bk-match-box {
  border: 1px solid #dee2e6;
  border-radius: 5px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.bk-row {
  display: flex;
  align-items: center;
  padding: 5px 8px;
  font-size: 12px;
  color: #333;
  min-height: 28px;
  line-height: 1.3;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

.bk-row--team-sep {
  border-top: 1px solid #f0f0f0;
}

.bk-row.winner {
  background: #e8f5e9;
  font-weight: 600;
  color: #1a1a1a;
}

.bk-row.bye {
  color: #bbb;
  background: #fafafa;
  font-style: italic;
  font-size: 11px;
}

.bk-row.bye span:empty::before {
  content: 'BYE';
}

.bk-row.tracked {
  background: #fff3cd !important;
  color: #856404 !important;
  font-weight: 700 !important;
}

.bk-score {
  font-size: 10px;
  color: #888;
  padding: 2px 8px 3px;
  background: #f8f9fa;
  border-top: 1px solid #f0f0f0;
}

.bk-time {
  font-size: 10px;
  color: #aaa;
  padding: 2px 8px 4px;
  background: #f8f9fa;
}

.bk-conn {
  position: relative;
  width: 24px;
  flex-shrink: 0;
}

.bk-conn svg {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
}

.bk-conn path {
  stroke: #c8d0da;
  stroke-width: 1.5px;
  stroke-linecap: round;
  fill: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "feat: add bk-* bracket CSS styles"
```

---

## Task 9: TopBar Component

**Files:**
- Create: `components/TopBar.tsx`

- [ ] **Step 1: Create TopBar**

Create `components/TopBar.tsx`:
```typescript
'use client'

import type { Tournament, TournamentEvent } from '@/lib/types'

interface TopBarProps {
  tournaments: Tournament[]
  events: TournamentEvent[]
  selectedTournament: string
  selectedEvent: string
  playerQuery: string
  loadingEvents: boolean
  loadingBracket: boolean
  onTournamentChange: (id: string) => void
  onEventChange: (id: string) => void
  onPlayerQueryChange: (q: string) => void
  onExport: () => void
}

export default function TopBar({
  tournaments,
  events,
  selectedTournament,
  selectedEvent,
  playerQuery,
  loadingEvents,
  loadingBracket,
  onTournamentChange,
  onEventChange,
  onPlayerQueryChange,
  onExport,
}: TopBarProps) {
  return (
    <div className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="flex items-end gap-3 px-5 py-2.5 flex-wrap">
        <span className="font-bold text-base text-gray-900 whitespace-nowrap mr-2">
          BAT <span className="text-blue-600">Brackets</span>
        </span>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
            Tournament
          </label>
          <select
            value={selectedTournament}
            onChange={(e) => onTournamentChange(e.target.value)}
            className="border border-gray-300 rounded-md px-2.5 py-1.5 text-xs min-w-[200px] bg-white focus:outline-none focus:border-blue-500"
          >
            <option value="">Select tournament…</option>
            {tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
            Event
          </label>
          <select
            value={selectedEvent}
            onChange={(e) => onEventChange(e.target.value)}
            disabled={!selectedTournament || loadingEvents}
            className="border border-gray-300 rounded-md px-2.5 py-1.5 text-xs min-w-[180px] bg-white focus:outline-none focus:border-blue-500 disabled:opacity-40"
          >
            <option value="">
              {loadingEvents ? 'Loading…' : 'Select event…'}
            </option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
            Track Player
          </label>
          <input
            type="text"
            placeholder="Search player…"
            value={playerQuery}
            onChange={(e) => onPlayerQueryChange(e.target.value)}
            className="border border-gray-300 rounded-md px-2.5 py-1.5 text-xs min-w-[180px] bg-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <button
          onClick={onExport}
          disabled={!selectedEvent || loadingBracket}
          className="ml-auto bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-md px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors"
        >
          ↓ Export JPG
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/TopBar.tsx
git commit -m "feat: add TopBar component with tournament/event/player selectors"
```

---

## Task 10: BracketCanvas Component

**Files:**
- Create: `components/BracketCanvas.tsx`

- [ ] **Step 1: Create BracketCanvas**

Create `components/BracketCanvas.tsx`:
```typescript
'use client'

import { useEffect, useRef } from 'react'

interface BracketCanvasProps {
  bracketHtml: string
  playerQuery: string
  bracketRef: React.RefObject<HTMLDivElement>
}

export default function BracketCanvas({
  bracketHtml,
  playerQuery,
  bracketRef,
}: BracketCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Apply player tracking highlight after HTML is injected
  useEffect(() => {
    if (!containerRef.current) return
    const rows = containerRef.current.querySelectorAll<HTMLElement>('.bk-row span')
    const query = playerQuery.trim().toLowerCase()

    rows.forEach((span) => {
      const row = span.closest('.bk-row') as HTMLElement | null
      if (!row) return
      if (query && span.textContent?.toLowerCase().includes(query)) {
        row.classList.add('tracked')
      } else {
        row.classList.remove('tracked')
      }
    })
  }, [bracketHtml, playerQuery])

  if (!bracketHtml) return null

  return (
    <div className="bracket-canvas">
      <div
        ref={(el) => {
          // Assign to both local ref and parent's bracketRef for export
          ;(containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
          if (bracketRef) (bracketRef as React.MutableRefObject<HTMLDivElement | null>).current = el
        }}
        dangerouslySetInnerHTML={{ __html: bracketHtml }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/BracketCanvas.tsx
git commit -m "feat: add BracketCanvas with HTML injection and player tracking"
```

---

## Task 11: ExportButton Logic

**Files:**
- Create: `components/ExportButton.tsx`

- [ ] **Step 1: Create ExportButton**

Create `components/ExportButton.tsx`:
```typescript
'use client'

import { toJpeg } from 'html-to-image'

interface ExportOptions {
  bracketEl: HTMLElement
  tournamentName: string
  eventName: string
}

function buildSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export async function exportBracketAsJpg({
  bracketEl,
  tournamentName,
  eventName,
}: ExportOptions): Promise<void> {
  // Build off-screen wrapper with header + bracket clone
  const wrapper = document.createElement('div')
  wrapper.style.cssText = `
    position: fixed;
    top: -99999px;
    left: -99999px;
    background: white;
    padding: 24px;
    font-family: 'Segoe UI', system-ui, sans-serif;
  `

  const header = document.createElement('div')
  header.style.cssText = `
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 2px solid #dee2e6;
  `
  header.innerHTML = `
    <div style="font-size:20px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">
      BAT <span style="color:#2563eb;">Brackets</span>
    </div>
    <div style="font-size:15px;font-weight:600;color:#333;margin-bottom:2px;">${tournamentName}</div>
    <div style="font-size:13px;color:#555;margin-bottom:6px;">${eventName}</div>
    <div style="font-size:11px;color:#999;">Exported: ${formatDate(new Date())}</div>
  `

  const bracketClone = bracketEl.cloneNode(true) as HTMLElement

  wrapper.appendChild(header)
  wrapper.appendChild(bracketClone)
  document.body.appendChild(wrapper)

  try {
    const dataUrl = await toJpeg(wrapper, { quality: 0.95, pixelRatio: 2 })
    const link = document.createElement('a')
    link.download = `${buildSlug(tournamentName)}-${buildSlug(eventName)}.jpg`
    link.href = dataUrl
    link.click()
  } finally {
    document.body.removeChild(wrapper)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add components/ExportButton.tsx
git commit -m "feat: add JPG export with tournament header and timestamp"
```

---

## Task 12: Main Page

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Update layout.tsx**

Replace `app/layout.tsx`:
```typescript
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BAT Brackets',
  description: 'Tournament bracket viewer for bat.tournamentsoftware.com',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Build the main page**

Replace `app/page.tsx`:
```typescript
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import TopBar from '@/components/TopBar'
import BracketCanvas from '@/components/BracketCanvas'
import { exportBracketAsJpg } from '@/components/ExportButton'
import type { Tournament, TournamentEvent, BracketData, ApiError } from '@/lib/types'

function isApiError(data: unknown): data is ApiError {
  return typeof data === 'object' && data !== null && 'error' in data
}

export default function Home() {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [events, setEvents] = useState<TournamentEvent[]>([])
  const [bracketHtml, setBracketHtml] = useState('')
  const [selectedTournament, setSelectedTournament] = useState('')
  const [selectedEvent, setSelectedEvent] = useState('')
  const [playerQuery, setPlayerQuery] = useState('')
  const [loadingTournaments, setLoadingTournaments] = useState(true)
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [loadingBracket, setLoadingBracket] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bracketRef = useRef<HTMLDivElement>(null)

  // Fetch tournament list on mount
  useEffect(() => {
    fetch('/api/tournaments')
      .then((r) => r.json())
      .then((data) => {
        if (isApiError(data)) throw new Error(data.error)
        setTournaments(data)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingTournaments(false))
  }, [])

  // Fetch events when tournament changes
  const handleTournamentChange = useCallback((id: string) => {
    setSelectedTournament(id)
    setSelectedEvent('')
    setBracketHtml('')
    setEvents([])
    setError(null)
    if (!id) return

    setLoadingEvents(true)
    fetch(`/api/events?tournament=${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (isApiError(data)) throw new Error(data.error)
        setEvents(data)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingEvents(false))
  }, [])

  // Fetch bracket when event changes
  const handleEventChange = useCallback(
    (eventId: string) => {
      setSelectedEvent(eventId)
      setBracketHtml('')
      setError(null)
      if (!eventId) return

      setLoadingBracket(true)
      fetch(`/api/bracket?tournament=${selectedTournament}&event=${eventId}`)
        .then((r) => r.json())
        .then((data: BracketData | ApiError) => {
          if (isApiError(data)) throw new Error(data.error)
          setBracketHtml(data.html)
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoadingBracket(false))
    },
    [selectedTournament]
  )

  const handleExport = useCallback(() => {
    if (!bracketRef.current) return
    const tournament = tournaments.find((t) => t.id === selectedTournament)
    const event = events.find((e) => e.id === selectedEvent)
    exportBracketAsJpg({
      bracketEl: bracketRef.current,
      tournamentName: tournament?.name ?? 'Tournament',
      eventName: event?.name ?? 'Event',
    })
  }, [tournaments, events, selectedTournament, selectedEvent])

  return (
    <>
      <TopBar
        tournaments={tournaments}
        events={events}
        selectedTournament={selectedTournament}
        selectedEvent={selectedEvent}
        playerQuery={playerQuery}
        loadingEvents={loadingEvents}
        loadingBracket={loadingBracket}
        onTournamentChange={handleTournamentChange}
        onEventChange={handleEventChange}
        onPlayerQueryChange={setPlayerQuery}
        onExport={handleExport}
      />

      {/* Legend */}
      <div className="flex gap-4 px-5 py-2 bg-white border-b border-gray-100 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-green-100 border border-green-300" />
          Winner
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-gray-50 border border-gray-300" />
          Bye / Not played
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-yellow-100 border border-yellow-400" />
          Tracked player
        </div>
      </div>

      {/* Loading / error states */}
      {loadingTournaments && (
        <div className="p-10 text-center text-gray-400 text-sm">Loading tournaments…</div>
      )}
      {loadingBracket && (
        <div className="p-10 text-center text-gray-400 text-sm">Loading bracket…</div>
      )}
      {error && (
        <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      {!selectedTournament && !loadingTournaments && !error && (
        <div className="p-10 text-center text-gray-400 text-sm">
          Select a tournament and event to view the bracket.
        </div>
      )}

      {/* Bracket */}
      {bracketHtml && !loadingBracket && (
        <BracketCanvas
          bracketHtml={bracketHtml}
          playerQuery={playerQuery}
          bracketRef={bracketRef}
        />
      )}
    </>
  )
}
```

- [ ] **Step 3: Run the app and verify the full flow**

```bash
npm run dev
```

Open `http://localhost:3000`. Verify:
- Tournament dropdown loads
- Selecting a tournament loads events
- Selecting an event loads and renders the bracket
- Typing a player name highlights their rows in yellow
- Export JPG button downloads a file

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/layout.tsx
git commit -m "feat: wire up main page with full tournament → event → bracket flow"
```

---

## Task 13: Scraper Selector Verification & Adjustment

**Files:**
- Modify: `lib/scraper.ts` (selectors only, if needed)
- Modify: `fixtures/tournaments.html`, `fixtures/events.html` (to match real HTML)

- [ ] **Step 1: Fetch real tournament list HTML**

With `npm run dev` running, open browser DevTools on `https://bat.tournamentsoftware.com/tournaments`. Inspect the tournament list items. Note the actual CSS class names used for:
- Tournament list container
- Individual tournament links
- Tournament dates

- [ ] **Step 2: Update fixture and selectors if needed**

If the real selectors differ from the fixtures, update both:

In `fixtures/tournaments.html`, replace with a copy of a small section of real HTML (2–3 tournaments).

In `lib/scraper.ts`, update `parseTournaments`:
```typescript
// Replace .tournament-item and a.tournament-name with the real selectors you found
$('.REAL-ITEM-SELECTOR').each((_, el) => {
  const link = $(el).find('REAL-LINK-SELECTOR')
  // ...
})
```

- [ ] **Step 3: Do the same for events page**

Inspect `https://bat.tournamentsoftware.com/tournament/{any-id}/schedule` and update `parseEvents` selectors and `fixtures/events.html` to match real HTML.

- [ ] **Step 4: Re-run tests**

```bash
npm test
```

Expected: all PASS with updated fixtures.

- [ ] **Step 5: Commit**

```bash
git add lib/scraper.ts fixtures/
git commit -m "fix: update scraper selectors to match live site HTML"
```

---

## Task 14: Deploy to Vercel

**Files:**
- No new files

- [ ] **Step 1: Push to GitHub**

```bash
git remote add origin https://github.com/YOUR_USERNAME/bat-bracket.git
git push -u origin main
```

- [ ] **Step 2: Connect to Vercel**

1. Go to vercel.com → New Project
2. Import the GitHub repo
3. Framework preset: Next.js (auto-detected)
4. No environment variables needed
5. Click Deploy

- [ ] **Step 3: Verify deployment**

Visit the Vercel URL. Test the full flow:
- Tournaments load
- Events load after selecting tournament
- Bracket renders
- Player tracking works
- Export JPG downloads correctly with header

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "chore: finalize deployment config"
git push
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Web scraping from bat.tournamentsoftware.com | Tasks 4–6, 7 |
| Tournament selector | Task 9 (TopBar), Task 12 (page) |
| Event selector | Task 9, Task 12 |
| Player filter / highlight | Task 10 (BracketCanvas) |
| All draw formats (format detection) | Task 6 (parseBracket) |
| Classic light bracket style | Task 8 (globals.css) |
| Full bracket JPG export | Task 11 (ExportButton) |
| Export header (tournament, event, timestamp) | Task 11 |
| 15-minute cache | Tasks 7 (revalidate: 900) |
| Vercel deployment | Task 14, vercel.json in Task 7 |
| Error messages for scrape failure | Task 7 (routes), Task 12 (page) |
| `.superpowers/` in .gitignore | Task 1 |
| bk-wrap HTML injected via dangerouslySetInnerHTML | Task 10 |
| Sticky top bar | Task 9 |
| Legend bar | Task 12 |

All spec requirements covered. No TBDs or placeholders. Types defined in Task 2 are used consistently throughout Tasks 9–12.

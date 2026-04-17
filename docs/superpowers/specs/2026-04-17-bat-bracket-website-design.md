# BAT Bracket Website — Design Spec

**Date:** 2026-04-17  
**Status:** Approved

---

## Overview

A deployed web app that scrapes tournament bracket data from bat.tournamentsoftware.com and renders it as a clean, scrollable bracket UI. Users select a tournament, event, and optionally a player to track. The full bracket can be exported as a JPG image.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| Scraping | Cheerio (static HTML); Playwright + `@sparticuz/chromium` fallback for JS-rendered pages (Vercel-compatible) |
| Export | `html-to-image` (browser-side) |
| Deployment | Vercel free tier |

No database. No authentication. No environment variables required at launch.

---

## Architecture

### API Routes

| Route | Purpose |
|---|---|
| `GET /api/tournaments` | Scrapes bat.tournamentsoftware.com/tournaments for tournament list (name, ID, date) |
| `GET /api/events?tournament=ID` | Scrapes tournament detail page for event/draw categories |
| `GET /api/bracket?tournament=ID&event=ID` | Scrapes the draw page and returns the full `.bk-wrap` HTML block |

All API routes use Next.js `revalidate: 900` (15-minute cache). Vercel serverless function `maxDuration` set to 30s to accommodate slow scrape responses.

### Data Flow

1. App loads → fetch tournament list from `/api/tournaments`
2. User selects tournament → fetch events from `/api/events`
3. User selects event → fetch bracket HTML from `/api/bracket`
4. React injects the `.bk-wrap` HTML into the DOM via `dangerouslySetInnerHTML` (safe here — source is a known, controlled site)
5. CSS applies classic light styling to `.bk-*` class selectors
6. Optional: user types a player name → all `.bk-row` elements are scanned, matching rows get a `tracked` class highlight
7. Export: user clicks button → `html-to-image` captures the full bracket as JPG

### Draw Format Detection

The scraper inspects the structure of the returned HTML:
- `.bk-round` columns only → single elimination
- Group tables + `.bk-round` columns → groups + knockout
- Dual bracket structure → double elimination

The frontend renders whatever structure the scraper returns — no separate rendering logic per format.

---

## UI Layout

### Top Bar (sticky)

Left to right:
- **Logo:** "BAT Brackets"
- **Tournament** dropdown (populated from `/api/tournaments`)
- **Event** dropdown (populated after tournament selected, from `/api/events`)
- **Track Player** text input (filters by player name, highlights their path)
- **Export JPG** button (right-aligned, green)

### Bracket Canvas

- Full-width, horizontally and vertically scrollable area below the top bar
- Contains the `.bk-wrap` div injected from the API response
- Custom CSS targets `.bk-*` class selectors from the source site's HTML structure

### Legend Bar (between top bar and canvas)

Small row showing: green = winner, gray = bye/not played, yellow = tracked player.

---

## Bracket Styling (Classic Light)

The source site uses these CSS classes — we apply our own styles to each:

| Class | Style |
|---|---|
| `.bk-wrap` | White background, flex row, rounded card with shadow |
| `.bk-round` | Fixed width (~200px), relative position |
| `.bk-round-label` | Small uppercase gray label |
| `.bk-match-slot` | Absolutely positioned per source-computed `top:` value |
| `.bk-match-box` | White card, border, border-radius, subtle shadow |
| `.bk-row` | Flex row, 12px font, 28px min-height |
| `.bk-row.winner` | Green background (`#e8f5e9`), bold |
| `.bk-row.bye` | Light gray background, italic "BYE" text |
| `.bk-row.tracked` | Yellow background (`#fff3cd`), bold — applied client-side |
| `.bk-score` | Small gray text below match box |
| `.bk-time` | Smaller gray text, round label + date/time |
| `.bk-conn svg path` | Gray connector lines (`#c8d0da`), 1.5px stroke |

---

## Player Tracking

- User types a name into the Track Player input
- Client-side: scan all `.bk-row span` elements for text match (case-insensitive, partial match)
- Add `.tracked` class to matching rows
- `.tracked` overrides `.winner` and default row styles with yellow highlight
- No re-fetch required — purely DOM manipulation

---

## JPG Export

1. User clicks "Export JPG"
2. A temporary off-screen wrapper is created containing:
   - **Header block:**
     - "BAT Brackets" logo text
     - Tournament name
     - Event name
     - "Exported: DD MMM YYYY, HH:MM" (user's local timezone)
   - The full `.bk-wrap` element (cloned)
3. `htmlToJpeg(wrapper, { quality: 0.95, pixelRatio: 2 })` captures the full DOM tree
4. Downloaded as `{tournament-slug}-{event-slug}.jpg`
5. Wrapper is removed from DOM after capture

Pixel ratio 2× ensures crisp text on retina displays. Thai characters render correctly since fonts are already loaded in the browser.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Scrape fails (network error) | API returns 500; UI shows "Could not load data — the source site may be unavailable" |
| HTML structure changed | Parser returns empty/partial data; UI shows "Bracket data could not be parsed — the source site may have changed" |
| No matches yet (future tournament) | Bracket renders with bye/empty slots as-is from source |
| Player not found in bracket | Track Player input shows "No matches found" below the field |

---

## Deployment

- GitHub repo → connected to Vercel
- Auto-deploys on push to `main`
- No environment variables required
- Vercel serverless function config: `maxDuration: 30` for bracket API route
- Add `.superpowers/` to `.gitignore`

---

## Out of Scope

- User accounts or saved preferences
- Push notifications for live match updates
- Mobile-optimized layout (bracket is inherently wide; horizontal scroll on mobile is acceptable)
- Any draw formats beyond what bat.tournamentsoftware.com produces

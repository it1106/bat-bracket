# Unified Product Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire PostHog Cloud (EU) into the BAT Bracket Next.js app so both `bat-bracket.vercel.app` and `ezebat.lan` feed a single dashboard with bracket-specific custom events.

**Architecture:** Client-side `posthog-js` SDK only, initialized inside a new `PostHogProvider` that wraps the existing `LanguageProvider`/`ThemeProvider`. A `track()` helper in `lib/analytics.ts` is the only import surface other code uses. Provider no-ops silently when `NEXT_PUBLIC_POSTHOG_KEY` is unset.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Jest (jsdom), `posthog-js`.

**Spec:** `docs/superpowers/specs/2026-04-27-unified-product-analytics-design.md`

---

## File map

**New:**
- `lib/analytics.ts` — `track(event, props)` and `registerGlobals(props)` helpers; no-op when posthog uninitialized
- `lib/PostHogProvider.tsx` — `'use client'` provider; initializes posthog and keeps global properties in sync with language/theme
- `__tests__/analytics.test.ts` — verifies the helper no-ops when uninitialized
- `.env.example` — documents the two env vars

**Modified:**
- `package.json`, `package-lock.json` — adds `posthog-js`
- `app/layout.tsx` — wraps `<PostHogProvider>` inside the existing context providers
- `app/page.tsx` — fires tournament/draw/player/H2H/language/theme events
- `components/MatchSchedule.tsx` — fires `match_viewed` with per-session dedup on first per-match interaction

The `posthog-js` package is imported only from `lib/analytics.ts` and `lib/PostHogProvider.tsx`. All other call sites import the `track` helper.

---

## Task 1: Install `posthog-js` and document env vars

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `.env.example`

- [ ] **Step 1: Install posthog-js**

```bash
npm install posthog-js@^1.205.0
```

Expected: `posthog-js` added to `dependencies` in `package.json`; `package-lock.json` updated.

- [ ] **Step 2: Create `.env.example`**

Create `.env.example` at repo root:

```
# PostHog Cloud project API key (browser-shipped). Leave unset to disable analytics.
NEXT_PUBLIC_POSTHOG_KEY=

# PostHog ingestion host. Defaults to EU when unset.
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
```

- [ ] **Step 3: Verify the build still succeeds**

```bash
npm run build
```

Expected: build succeeds (no code changes yet, just deps).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: install posthog-js and document analytics env vars"
```

---

## Task 2: `lib/analytics.ts` helper with TDD

**Files:**
- Create: `lib/analytics.ts`
- Test: `__tests__/analytics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/analytics.test.ts`:

```ts
/** @jest-environment jsdom */
import posthog from 'posthog-js'
import { track, registerGlobals } from '@/lib/analytics'

describe('analytics helper', () => {
  it('track() does not throw and does not call posthog when uninitialized', () => {
    const spy = jest.spyOn(posthog, 'capture').mockImplementation(() => undefined as any)
    expect(() => track('some_event', { foo: 1 })).not.toThrow()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('registerGlobals() does not throw and does not call posthog when uninitialized', () => {
    const spy = jest.spyOn(posthog, 'register').mockImplementation(() => undefined as any)
    expect(() => registerGlobals({ foo: 'bar' })).not.toThrow()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- analytics
```

Expected: FAIL with `Cannot find module '@/lib/analytics'`.

- [ ] **Step 3: Implement the helper**

Create `lib/analytics.ts`:

```ts
'use client'

import posthog from 'posthog-js'

type Props = Record<string, unknown>

function isLoaded(): boolean {
  return Boolean((posthog as unknown as { __loaded?: boolean }).__loaded)
}

export function track(event: string, properties?: Props): void {
  if (!isLoaded()) return
  posthog.capture(event, properties)
}

export function registerGlobals(properties: Props): void {
  if (!isLoaded()) return
  posthog.register(properties)
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- analytics
```

Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/analytics.ts __tests__/analytics.test.ts
git commit -m "feat: analytics helper with no-op when posthog uninitialized"
```

---

## Task 3: `PostHogProvider` and layout integration

**Files:**
- Create: `lib/PostHogProvider.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Create `lib/PostHogProvider.tsx`**

```tsx
'use client'

import { useEffect, type ReactNode } from 'react'
import posthog from 'posthog-js'
import { useLanguage } from './LanguageContext'
import { useTheme } from './ThemeContext'
import { registerGlobals } from './analytics'

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com'

function detectDeployment(): 'vercel' | 'self-hosted' {
  if (typeof window === 'undefined') return 'self-hosted'
  return window.location.host.endsWith('.vercel.app') ? 'vercel' : 'self-hosted'
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  const { lang } = useLanguage()
  const { theme } = useTheme()

  useEffect(() => {
    if (!KEY) return
    if ((posthog as unknown as { __loaded?: boolean }).__loaded) return
    // TODO(consent): add cookie banner if EU traffic exceeds ~5%
    posthog.init(KEY, {
      api_host: HOST,
      capture_pageview: true,
      autocapture: false,
      persistence: 'localStorage',
      loaded: () => {
        posthog.register({ app_deployment: detectDeployment() })
      },
    })
  }, [])

  useEffect(() => {
    registerGlobals({ app_language: lang, app_theme: theme })
  }, [lang, theme])

  return <>{children}</>
}
```

- [ ] **Step 2: Wrap children in `app/layout.tsx`**

Modify `app/layout.tsx`. Add import near the top, after the existing `lib/` imports:

```tsx
import { PostHogProvider } from '@/lib/PostHogProvider'
```

Replace the body content:

```tsx
<body>
  <LanguageProvider>
    <ThemeProvider>
      <PostHogProvider>
        {children}
      </PostHogProvider>
    </ThemeProvider>
  </LanguageProvider>
  <Analytics />
  <SpeedInsights />
</body>
```

- [ ] **Step 3: Verify the build**

```bash
npm run build
```

Expected: build succeeds, no TypeScript errors.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all existing tests still pass; the analytics test still passes.

- [ ] **Step 5: Commit**

```bash
git add lib/PostHogProvider.tsx app/layout.tsx
git commit -m "feat: PostHogProvider initializes SDK and registers global properties"
```

---

## Task 4: Fire `tournament_opened` and `draw_opened`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Import the helper**

In `app/page.tsx`, add to the imports near the top (alongside other `@/lib/...` imports):

```tsx
import { track } from '@/lib/analytics'
```

- [ ] **Step 2: Add `tournament_opened` effect**

In `app/page.tsx`, find the localStorage-restore effect (search for `// Restore previously selected tournament` near line 287). Add a new `useEffect` immediately after it:

```tsx
useEffect(() => {
  if (!selectedTournament) return
  const t = tournaments.find((x) => x.id === selectedTournament)
  track('tournament_opened', {
    tournament_id: selectedTournament,
    tournament_name: t?.name ?? '',
  })
}, [selectedTournament, tournaments])
```

- [ ] **Step 3: Add `draw_opened` effect**

Immediately after the `tournament_opened` effect, add:

```tsx
useEffect(() => {
  if (!selectedDraw) return
  const d = draws.find((x) => x.drawNum === selectedDraw)
  track('draw_opened', {
    tournament_id: selectedTournament,
    tournament_name: tournamentName,
    draw_id: selectedDraw,
    draw_name: d?.name ?? '',
  })
}, [selectedDraw, draws, selectedTournament, tournamentName])
```

- [ ] **Step 4: Verify the build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: track tournament_opened and draw_opened events"
```

---

## Task 5: Fire `player_profile_viewed` and `h2h_viewed`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Track inside `handlePlayerClick`**

In `app/page.tsx`, replace the existing `handlePlayerClick` (currently around lines 372-382):

```tsx
const handlePlayerClick = useCallback(async (playerId: string) => {
  if (!selectedTournament) return
  track('player_profile_viewed', {
    player_id: playerId,
    tournament_id: selectedTournament,
  })
  setModalProfile(null)
  setModalLoading(true)
  try {
    const res = await fetch(`/api/player?tournament=${encodeURIComponent(selectedTournament)}&player=${encodeURIComponent(playerId)}`)
    const data = await safeJson(res) as PlayerProfile | ApiError
    if (!isApiError(data)) setModalProfile(data)
  } catch {}
  finally { setModalLoading(false) }
}, [selectedTournament])
```

- [ ] **Step 2: Track inside `handleH2HClick`**

Replace the existing `handleH2HClick` (currently around lines 389-398):

```tsx
const handleH2HClick = useCallback(async (h2hUrl: string) => {
  track('h2h_viewed', {
    tournament_id: selectedTournament,
    match_id: h2hUrl,
  })
  setH2hData(null)
  setH2hLoading(true)
  try {
    const res = await fetch(`/api/h2h?path=${encodeURIComponent(h2hUrl)}`)
    const data = await safeJson(res) as H2HData | ApiError
    if (!isApiError(data)) setH2hData(data)
  } catch {}
  finally { setH2hLoading(false) }
}, [selectedTournament])
```

(Note: `selectedTournament` is added to the dep array; previously the array was empty.)

- [ ] **Step 3: Verify the build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: track player_profile_viewed and h2h_viewed events"
```

---

## Task 6: Fire `match_viewed` with per-session dedup from `MatchSchedule`

**Files:**
- Modify: `components/MatchSchedule.tsx`
- Modify: `app/page.tsx` (pass `tournamentId` prop)

- [ ] **Step 1: Add the new prop and helpers in `MatchSchedule.tsx`**

In `components/MatchSchedule.tsx`:

a. Add to existing imports (`useRef` may already be imported from `react` — keep one combined import):

```tsx
import { useMemo, useRef } from 'react'
import { track } from '@/lib/analytics'
import type { MatchEntry } from '@/lib/types'
```

(Verify whether `MatchEntry` and `useRef` are already imported and merge as needed.)

b. In the `Props` interface (top of file), add:

```tsx
tournamentId?: string
```

c. Update the function signature destructure to include `tournamentId`:

```tsx
export default function MatchSchedule({ groups, days, selectedDay, onDayChange, loading, playerQuery, onEventClick, playerClubMap, onPlayerClick, onH2HClick, liveByCourt, tournamentId }: Props) {
```

d. Inside the component body, near the top (before any return statement), add:

```tsx
const seenMatchIds = useRef<Set<string>>(new Set())

const matchKey = (m: MatchEntry): string => {
  const a = m.team1[0]?.playerId ?? ''
  const b = m.team2[0]?.playerId ?? ''
  return `${m.drawNum}|${m.round}|${a}|${b}`
}

const recordMatchView = (m: MatchEntry): void => {
  const id = matchKey(m)
  if (seenMatchIds.current.has(id)) return
  seenMatchIds.current.add(id)
  track('match_viewed', {
    tournament_id: tournamentId,
    match_id: id,
    round_name: m.round,
    draw_id: m.drawNum,
    is_live: !!m.nowPlaying,
    is_completed: m.winner !== null,
  })
}
```

- [ ] **Step 2: Wrap each per-match click handler**

In `components/MatchSchedule.tsx`:

a. The event-badge click (currently around line 134):

Before:
```tsx
onClick={onEventClick && m.drawNum ? () => onEventClick(m.drawNum, m.round) : undefined}
```

After:
```tsx
onClick={onEventClick && m.drawNum ? () => { recordMatchView(m); onEventClick(m.drawNum, m.round) } : undefined}
```

b. The H2H button click (currently around line 145):

Before:
```tsx
onClick={() => onH2HClick(m.h2hUrl!)}
```

After:
```tsx
onClick={() => { recordMatchView(m); onH2HClick(m.h2hUrl!) }}
```

c. The four player-name `onClick`s (currently around lines 162, 174, 181, 196 — they all share the same shape):

Before:
```tsx
onClick={onPlayerClick && p.playerId ? () => onPlayerClick(p.playerId) : undefined}
```

After (apply to all four occurrences):
```tsx
onClick={onPlayerClick && p.playerId ? () => { recordMatchView(m); onPlayerClick(p.playerId) } : undefined}
```

- [ ] **Step 3: Pass `tournamentId` from `app/page.tsx`**

In `app/page.tsx`, find every `<MatchSchedule ...>` JSX usage (search for `<MatchSchedule`). For each, add:

```tsx
tournamentId={selectedTournament}
```

- [ ] **Step 4: Verify the build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Run the existing MatchSchedule test**

```bash
npm test -- MatchSchedule
```

Expected: existing `MatchSchedule.live.test.tsx` still passes (it already mounts the component without `tournamentId`, which is fine because the prop is optional).

- [ ] **Step 6: Commit**

```bash
git add components/MatchSchedule.tsx app/page.tsx
git commit -m "feat: track match_viewed on first per-match interaction"
```

---

## Task 7: Fire `language_changed` and `theme_changed`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Wrap the language toggle button**

In `app/page.tsx`, find the language toggle button (around line 556 — search for `onClick={toggleLang}`). Replace:

```tsx
onClick={toggleLang}
```

With:

```tsx
onClick={() => {
  const next = lang === 'en' ? 'th' : 'en'
  track('language_changed', { from: lang, to: next })
  toggleLang()
}}
```

- [ ] **Step 2: Wrap the theme toggle button**

Find the theme toggle button (around line 547 — search for `onClick={toggleTheme}`). Replace:

```tsx
onClick={toggleTheme}
```

With:

```tsx
onClick={() => {
  const next = theme === 'dark' ? 'light' : 'dark'
  track('theme_changed', { from: theme, to: next })
  toggleTheme()
}}
```

- [ ] **Step 3: Wrap the keyboard-shortcut theme toggle**

Find the hotkey-driven `toggleTheme()` call (around line 197 — inside a `useEffect` keyboard handler). Replace the single `toggleTheme()` line with:

```tsx
const next = theme === 'dark' ? 'light' : 'dark'
track('theme_changed', { from: theme, to: next })
toggleTheme()
```

(`theme` is already in scope via the `useTheme()` hook at the top of the component.)

- [ ] **Step 4: Verify the build**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Run the test suite**

```bash
npm test
```

Expected: all tests pass — particularly `page-hotkey.test.tsx` and `ThemeContext.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git commit -m "feat: track language_changed and theme_changed events"
```

---

## Task 8: Manual end-to-end verification

This task has no code changes. It is a verification gate before merging.

- [ ] **Step 1: Set up a PostHog Cloud project**

In PostHog Cloud (EU region) at https://eu.posthog.com, create a project. Copy its Project API Key (`phc_...`).

- [ ] **Step 2: Configure local env**

Create `.env.local` at repo root (gitignored by Next.js convention):

```
NEXT_PUBLIC_POSTHOG_KEY=phc_<your_project_key>
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
```

- [ ] **Step 3: Run the dev server**

```bash
npm run dev
```

Open http://localhost:3000.

- [ ] **Step 4: Exercise events and watch PostHog Live Events**

Open PostHog → Activity → Live Events in another tab. Then in the app:

1. Wait for initial load → expect one `$pageview` with `app_deployment=self-hosted`, `app_language=en`, `app_theme=light`, plus enriched `country`, `device_type`, `os`, `browser`.
2. Pick a tournament → expect `tournament_opened` with `tournament_id`, `tournament_name`.
3. Pick a draw → expect `draw_opened` with `tournament_id`, `tournament_name`, `draw_id`, `draw_name`.
4. In the Matches tab, click a player on a match → expect `match_viewed` then `player_profile_viewed`. Click the same player on the same match again → expect only `player_profile_viewed`.
5. Click the H2H button on a different match → expect `match_viewed` then `h2h_viewed`.
6. Toggle the language button → expect `language_changed` with `from=en`, `to=th`. Subsequent events should carry `app_language=th`.
7. Toggle the theme button → expect `theme_changed` with `from=light`, `to=dark`. Subsequent events should carry `app_theme=dark`.

- [ ] **Step 5: Note the result**

If any expected event is missing or has wrong properties, return to the relevant earlier task and fix. Otherwise, the implementation is verified end-to-end.

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `posthog-js` installed | Task 1 |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` env vars | Tasks 1, 3 |
| Provider no-ops without key | Tasks 2, 3 |
| `lib/analytics.ts` `track()` helper | Task 2 |
| Jest test for no-op behavior | Task 2 |
| `lib/PostHogProvider.tsx` + layout integration | Task 3 |
| `app_deployment` global property derived from host | Task 3 |
| `app_language` / `app_theme` global properties re-registered on change | Task 3 |
| `// TODO(consent)` comment | Task 3 |
| `$pageview` auto-capture | Task 3 (via `capture_pageview: true`) |
| `tournament_opened` event | Task 4 |
| `draw_opened` event | Task 4 |
| `player_profile_viewed` event | Task 5 |
| `h2h_viewed` event | Task 5 |
| `match_viewed` event with per-session dedup | Task 6 |
| `language_changed` / `theme_changed` events | Task 7 |
| Manual verification via Live Events | Task 8 |

**Out of plan, by design:** rollout to ezebat.lan / Vercel and the consent banner — those are in the spec but are operational/deferred concerns, not code tasks.

# Feature Announcement Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-time inline banner promoting the multi-tab Custom search feature, dismissible per browser, with a generic storage layer for future announcements.

**Architecture:** Tiny `lib/announcements.ts` module wraps `localStorage` reads/writes under `batbracket.announcements.<id>` and exports the announcement id and Thai text constants. A small `<AnnouncementBanner>` component reads the dismissed flag, renders an info-style banner with a `✕` close, and fires PostHog events. The page renders one instance gated on `selectedTournament`.

**Tech Stack:** Next.js 14 client component, React 18 hooks, TypeScript, Tailwind CSS, Jest + @testing-library/react, PostHog `track()`.

**Spec:** `docs/superpowers/specs/2026-05-04-feature-announcement-design.md`

---

## File Map

- **Create** `lib/announcements.ts` — `isAnnouncementDismissed`, `dismissAnnouncement`, plus the `ANN_CUSTOM_TABS_MULTI` id and `ANN_CUSTOM_TABS_MULTI_TEXT_TH` text constants
- **Create** `__tests__/announcements.test.ts` — unit tests for the storage helpers
- **Create** `components/AnnouncementBanner.tsx` — banner UI + analytics + dismiss behavior
- **Modify** `app/page.tsx` — render one `<AnnouncementBanner>` between the toolbar and the tab strip

---

## Task 1: Storage helper module

**Files:**
- Create: `lib/announcements.ts`
- Create: `__tests__/announcements.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/announcements.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import {
  isAnnouncementDismissed,
  dismissAnnouncement,
  ANN_CUSTOM_TABS_MULTI,
  ANN_CUSTOM_TABS_MULTI_TEXT_TH,
} from '@/lib/announcements'

beforeEach(() => {
  localStorage.clear()
})

describe('announcements storage', () => {
  it('returns false when nothing is stored', () => {
    expect(isAnnouncementDismissed('any-id')).toBe(false)
  })

  it('round-trips a dismissal', () => {
    dismissAnnouncement('an-id')
    expect(isAnnouncementDismissed('an-id')).toBe(true)
  })

  it('isolates ids', () => {
    dismissAnnouncement('first')
    expect(isAnnouncementDismissed('first')).toBe(true)
    expect(isAnnouncementDismissed('second')).toBe(false)
  })

  it('writes under the batbracket.announcements.<id> key', () => {
    dismissAnnouncement('demo')
    expect(localStorage.getItem('batbracket.announcements.demo')).toBe('1')
  })

  it('exports the custom-tabs announcement metadata', () => {
    expect(ANN_CUSTOM_TABS_MULTI).toBe('customTabs2026-05')
    expect(ANN_CUSTOM_TABS_MULTI_TEXT_TH).toContain('ฟีเจอร์ใหม่')
    expect(ANN_CUSTOM_TABS_MULTI_TEXT_TH).toContain('custom search')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/announcements.test.ts`
Expected: All tests fail with "Cannot find module '@/lib/announcements'".

- [ ] **Step 3: Write the helper module**

Create `lib/announcements.ts`:

```ts
export const ANN_CUSTOM_TABS_MULTI = 'customTabs2026-05'
export const ANN_CUSTOM_TABS_MULTI_TEXT_TH =
  '🎉 ฟีเจอร์ใหม่ : สร้าง custom search ได้ถึง 3 ชุด กดเครื่องหมาย + บน tab bar เพื่อทดลองใช้งาน'

const KEY_PREFIX = 'batbracket.announcements.'

export function isAnnouncementDismissed(id: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(KEY_PREFIX + id) === '1'
  } catch {
    return false
  }
}

export function dismissAnnouncement(id: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY_PREFIX + id, '1')
  } catch {}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/announcements.test.ts`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/announcements.ts __tests__/announcements.test.ts
git commit -m "$(cat <<'COMMIT'
feat(announcements): add localStorage helper + multi-tab text constants

Generic per-id dismiss flag under batbracket.announcements.<id>.
Reusable for future feature announcements.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 2: `<AnnouncementBanner>` component

**Files:**
- Create: `components/AnnouncementBanner.tsx`

- [ ] **Step 1: Write the component**

Create `components/AnnouncementBanner.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { isAnnouncementDismissed, dismissAnnouncement } from '@/lib/announcements'
import { track } from '@/lib/analytics'

interface Props {
  id: string
  text: string
  visible?: boolean
}

export default function AnnouncementBanner({ id, text, visible = true }: Props) {
  const [dismissed, setDismissed] = useState(true) // assume dismissed until we know
  const [hydrated, setHydrated] = useState(false)
  const [shownTracked, setShownTracked] = useState(false)

  useEffect(() => {
    setDismissed(isAnnouncementDismissed(id))
    setHydrated(true)
  }, [id])

  const isDisplaying = hydrated && !dismissed && visible

  useEffect(() => {
    if (!isDisplaying || shownTracked) return
    track('announcement_shown', { id })
    setShownTracked(true)
  }, [isDisplaying, shownTracked, id])

  if (!isDisplaying) return null

  const onClose = () => {
    dismissAnnouncement(id)
    setDismissed(true)
    track('announcement_dismissed', { id })
  }

  return (
    <div className="flex items-center gap-2 px-5 py-1.5 bg-[var(--info-bg)] border-b border-[var(--border)] text-xs text-[var(--info-fg)]">
      <span lang="th" className="flex-1">{text}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="ปิด"
        className="inline-flex items-center justify-center w-4 h-4 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)] text-[11px] leading-none"
      >✕</button>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run the full test suite to confirm nothing else broke**

Run: `npx jest --testPathIgnorePatterns=__tests__/scraper.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/AnnouncementBanner.tsx
git commit -m "$(cat <<'COMMIT'
feat(announcements): add AnnouncementBanner component

One-time inline banner with ✕ close. Reads/writes the dismissed flag
via lib/announcements and fires announcement_shown / announcement_dismissed
PostHog events.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 3: Render the banner in `app/page.tsx`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add imports**

In `app/page.tsx`, add (next to the other component imports near the top, around line 9–10):

```tsx
import AnnouncementBanner from '@/components/AnnouncementBanner'
import {
  ANN_CUSTOM_TABS_MULTI,
  ANN_CUSTOM_TABS_MULTI_TEXT_TH,
} from '@/lib/announcements'
```

- [ ] **Step 2: Render the banner above the tab strip**

Find the `{/* View mode tabs */}` block (currently around line 713). Insert the banner immediately before it.

The current code is:

```tsx
      {/* View mode tabs */}
      {selectedTournament && (
```

Change to:

```tsx
      <AnnouncementBanner
        id={ANN_CUSTOM_TABS_MULTI}
        text={ANN_CUSTOM_TABS_MULTI_TEXT_TH}
        visible={!!selectedTournament}
      />

      {/* View mode tabs */}
      {selectedTournament && (
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: No new warnings.

- [ ] **Step 5: Run tests**

Run: `npx jest --testPathIgnorePatterns=__tests__/scraper.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Manual smoke test**

Start the dev server: `npm run dev` (background). Open `http://localhost:3000/`.

Verify:
1. Before picking a tournament: no banner visible.
2. Pick a tournament. Thai banner appears at the top of the page (above the Bracket / Match Schedule / Live tabs): `🎉 ฟีเจอร์ใหม่ : สร้าง custom search ได้ถึง 3 ชุด กดเครื่องหมาย + บน tab bar เพื่อทดลองใช้งาน`.
3. The banner reads in Thai even when the language toggle is set to EN.
4. Click `✕`. Banner disappears.
5. Reload. Banner does not reappear.
6. In devtools: `localStorage.removeItem('batbracket.announcements.customTabs2026-05')`. Reload. Pick a tournament. Banner appears again.
7. Stop the dev server: `pkill -f "next dev"`.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx
git commit -m "$(cat <<'COMMIT'
feat(announcements): show multi-tab announcement banner once per browser

Renders above the view-mode tabs, gated on a tournament being selected.
Thai-only payload regardless of the language toggle.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
COMMIT
)"
```

---

## Verification Summary

After all tasks:

1. `npx jest --testPathIgnorePatterns=__tests__/scraper.test.ts` passes (5 new announcement tests + existing).
2. `npx tsc --noEmit` passes.
3. `npm run lint` passes with no new warnings.
4. Manual smoke (Task 3 Step 6) verifies the banner shows after tournament selection, dismisses on `✕`, and stays dismissed across reload.

## Out of Scope (per spec)

- Multi-language announcement bodies.
- Auto-dismiss / fade animations.
- Multiple simultaneous banners.
- "Try it now" CTA button.
- Server-side feature flags.

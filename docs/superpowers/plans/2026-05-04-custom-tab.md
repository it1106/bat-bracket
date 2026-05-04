# Custom Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single user-configurable tab that filters the Match Schedule by a saved keyword (nickname + keyword stored in localStorage), reusing the existing search pipeline and `<MatchSchedule>` layout.

**Architecture:** Storage module owns the localStorage shape. The page extends `ViewMode` to `'custom'`, hydrates the saved tab, and renders either a `+` button or the configured tab in the existing tab strip. The Custom view re-uses `<MatchSchedule>` with `playerQuery` set to the saved keyword and a new `highlightMatches={false}` prop. A new modal handles create / edit / delete.

**Tech Stack:** Next.js 14 App Router (client component), React 18 hooks, TypeScript, Tailwind CSS, Jest + @testing-library/react. PostHog `track()` for analytics.

**Spec:** `docs/superpowers/specs/2026-05-04-custom-tab-design.md`

---

## File Map

- **Create** `lib/customTab.ts` — load/save/clear `{ nickname, keyword }` under `batbracket.customTab`
- **Create** `__tests__/customTab.test.ts` — unit tests for the storage module
- **Create** `components/CustomTabModal.tsx` — modal for create / edit / delete
- **Create** `__tests__/MatchSchedule.highlight.test.tsx` — verifies `highlightMatches={false}` suppresses the yellow highlight class
- **Modify** `lib/i18n.ts` — add 10 new translation keys (en + th)
- **Modify** `components/MatchSchedule.tsx:97-144` — add `highlightMatches?: boolean` prop, use it in `nameCls`
- **Modify** `app/page.tsx` — extend `ViewMode`, hydrate `customTab`, render tab + modal + view branch, hide search cluster when on Custom tab

---

## Task 1: Storage module

**Files:**
- Create: `lib/customTab.ts`
- Create: `__tests__/customTab.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/customTab.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
import { loadCustomTab, saveCustomTab, clearCustomTab } from '@/lib/customTab'

beforeEach(() => {
  localStorage.clear()
})

describe('customTab storage', () => {
  it('returns null when nothing is stored', () => {
    expect(loadCustomTab()).toBeNull()
  })

  it('round-trips a saved tab', () => {
    saveCustomTab({ nickname: 'My Club', keyword: 'kba & BS U15' })
    expect(loadCustomTab()).toEqual({ nickname: 'My Club', keyword: 'kba & BS U15' })
  })

  it('clearCustomTab removes the saved value', () => {
    saveCustomTab({ nickname: 'x', keyword: 'y' })
    clearCustomTab()
    expect(loadCustomTab()).toBeNull()
  })

  it('returns null when JSON is malformed', () => {
    localStorage.setItem('batbracket.customTab', '{not json')
    expect(loadCustomTab()).toBeNull()
  })

  it('returns null when stored value is the wrong shape', () => {
    localStorage.setItem('batbracket.customTab', JSON.stringify({ nickname: 'x' }))
    expect(loadCustomTab()).toBeNull()
  })

  it('returns null when stored fields are empty strings', () => {
    localStorage.setItem('batbracket.customTab', JSON.stringify({ nickname: '', keyword: '' }))
    expect(loadCustomTab()).toBeNull()
  })

  it('writes under the batbracket.customTab key', () => {
    saveCustomTab({ nickname: 'x', keyword: 'y' })
    expect(localStorage.getItem('batbracket.customTab')).toBe(JSON.stringify({ nickname: 'x', keyword: 'y' }))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/customTab.test.ts`
Expected: All tests fail with "Cannot find module '@/lib/customTab'".

- [ ] **Step 3: Implement the storage module**

Create `lib/customTab.ts`:

```ts
export interface CustomTab {
  nickname: string
  keyword: string
}

const STORAGE_KEY = 'batbracket.customTab'

function isValid(v: unknown): v is CustomTab {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.nickname === 'string' && o.nickname.length > 0
    && typeof o.keyword === 'string' && o.keyword.length > 0
}

export function loadCustomTab(): CustomTab | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    return isValid(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveCustomTab(tab: CustomTab): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tab))
  } catch {}
}

export function clearCustomTab(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/customTab.test.ts`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/customTab.ts __tests__/customTab.test.ts
git commit -m "feat(custom-tab): add localStorage module for saved keyword"
```

---

## Task 2: i18n keys

**Files:**
- Modify: `lib/i18n.ts:70-275`

- [ ] **Step 1: Extend the TKey union**

In `lib/i18n.ts`, append to the `TKey` union (after `'searchHelp'` on line 135):

```ts
  | 'customTab'
  | 'customTabCreate'
  | 'customTabEdit'
  | 'customTabName'
  | 'customTabKeyword'
  | 'customTabAddTooltip'
  | 'customTabSave'
  | 'customTabCancel'
  | 'customTabDelete'
  | 'customTabDeleteConfirm'
```

- [ ] **Step 2: Add English strings**

In the `en` block of `dict` (after `searchHelp` on line 205), add:

```ts
    customTab: 'Custom',
    customTabCreate: 'New Custom Tab',
    customTabEdit: 'Edit Custom Tab',
    customTabName: 'Tab name',
    customTabKeyword: 'Search keywords',
    customTabAddTooltip: 'Add custom tab',
    customTabSave: 'Save',
    customTabCancel: 'Cancel',
    customTabDelete: 'Delete',
    customTabDeleteConfirm: 'Confirm delete',
```

- [ ] **Step 3: Add Thai strings**

In the `th` block of `dict` (after `searchHelp` on line 274), add:

```ts
    customTab: 'กำหนดเอง',
    customTabCreate: 'สร้างแท็บกำหนดเอง',
    customTabEdit: 'แก้ไขแท็บกำหนดเอง',
    customTabName: 'ชื่อแท็บ',
    customTabKeyword: 'คำค้นหา',
    customTabAddTooltip: 'เพิ่มแท็บกำหนดเอง',
    customTabSave: 'บันทึก',
    customTabCancel: 'ยกเลิก',
    customTabDelete: 'ลบ',
    customTabDeleteConfirm: 'ยืนยันการลบ',
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors. (If TypeScript reports missing keys in either dict block, add the missing strings.)

- [ ] **Step 5: Commit**

```bash
git add lib/i18n.ts
git commit -m "feat(custom-tab): add i18n keys for custom tab UI"
```

---

## Task 3: `highlightMatches` prop on `<MatchSchedule>`

**Files:**
- Modify: `components/MatchSchedule.tsx:14-29` (Props interface)
- Modify: `components/MatchSchedule.tsx:97` (destructuring)
- Modify: `components/MatchSchedule.tsx:139-144` (`nameCls` helper)
- Create: `__tests__/MatchSchedule.highlight.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/MatchSchedule.highlight.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react'
import MatchSchedule from '@/components/MatchSchedule'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { MatchScheduleGroup, MatchEntry } from '@/lib/types'

function entry(): MatchEntry {
  return {
    draw: 'WS', drawNum: '1', round: 'QF',
    team1: [{ name: 'Alpha', playerId: '100' }],
    team2: [{ name: 'Beta', playerId: '200' }],
    winner: null, scores: [],
    court: '', walkover: false, retired: false,
    nowPlaying: false,
  }
}

const group = (m: MatchEntry): MatchScheduleGroup => ({ type: 'time', time: '10:00', matches: [m] })

describe('MatchSchedule — highlightMatches prop', () => {
  it('applies ms-player-highlight when highlightMatches is unset (default true) and query matches', () => {
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={[group(entry())]}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery="alpha"
        />
      </LanguageProvider>,
    )
    expect(container.querySelector('.ms-player-highlight')).not.toBeNull()
  })

  it('suppresses ms-player-highlight when highlightMatches={false} even with a matching query', () => {
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={[group(entry())]}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery="alpha"
          highlightMatches={false}
        />
      </LanguageProvider>,
    )
    expect(container.querySelector('.ms-player-highlight')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/MatchSchedule.highlight.test.tsx`
Expected: The second test fails because `highlightMatches` is not yet a prop and the highlight class is still applied. The first test may pass (current behavior already adds the class for matching queries).

- [ ] **Step 3: Add the prop to the Props interface**

In `components/MatchSchedule.tsx`, update the `Props` interface (around lines 14-29). Add the new prop after `excludeCompleted`:

```ts
  excludeCompleted?: boolean
  highlightMatches?: boolean
  showJumpToNext?: boolean
```

- [ ] **Step 4: Destructure the new prop with default `true`**

Update the function signature on line 97:

```ts
export default function MatchSchedule({ groups, days, selectedDay, onDayChange, loading, playerQuery, excludeCompleted = false, highlightMatches = true, showJumpToNext = true, onEventClick, playerClubMap, onPlayerClick, onH2HClick, liveByCourt, tournamentId }: Props) {
```

- [ ] **Step 5: Use the prop inside `nameCls`**

Replace the existing `nameCls` block (lines 139-144) with:

```ts
  const nameCls = (p: { name: string; playerId: string }) => {
    const cls: string[] = []
    if (onPlayerClick && p.playerId) cls.push('pm-player-link')
    if (highlightMatches && queries.length > 0 && playerMatchesQuery(p, queries, playerClubMap)) cls.push('ms-player-highlight')
    return cls.join(' ')
  }
```

- [ ] **Step 6: Run the new test to verify it passes**

Run: `npx jest __tests__/MatchSchedule.highlight.test.tsx`
Expected: Both tests pass.

- [ ] **Step 7: Run the full test suite to verify no regressions**

Run: `npx jest`
Expected: All tests pass (including the existing `MatchSchedule.live.test.tsx` and `customTab.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add components/MatchSchedule.tsx __tests__/MatchSchedule.highlight.test.tsx
git commit -m "feat(matches): add highlightMatches prop to MatchSchedule"
```

---

## Task 4: `CustomTabModal` component

**Files:**
- Create: `components/CustomTabModal.tsx`

- [ ] **Step 1: Write the modal component**

Create `components/CustomTabModal.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import type { CustomTab } from '@/lib/customTab'

interface Props {
  open: boolean
  mode: 'create' | 'edit'
  initial: CustomTab | null
  onClose: () => void
  onSave: (tab: CustomTab) => void
  onDelete?: () => void
}

export default function CustomTabModal({ open, mode, initial, onClose, onSave, onDelete }: Props) {
  const { t } = useLanguage()
  const [nickname, setNickname] = useState('')
  const [keyword, setKeyword] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const nicknameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setNickname(initial?.nickname ?? '')
    setKeyword(initial?.keyword ?? '')
    setConfirmingDelete(false)
    // Focus the first field on open
    const id = window.setTimeout(() => nicknameRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open, initial])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const trimmedNick = nickname.trim()
  const trimmedKw = keyword.trim()
  const canSave = trimmedNick.length > 0 && trimmedKw.length > 0

  const submit = () => {
    if (!canSave) return
    onSave({ nickname: trimmedNick, keyword: trimmedKw })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const title = mode === 'create' ? t('customTabCreate') : t('customTabEdit')

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <button className="pm-close" onClick={onClose} aria-label={t('close')}>✕</button>
        <div className="pm-header">
          <div className="pm-section-title">{title}</div>
        </div>

        <div className="pm-section">
          <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1">
            {t('customTabName')}
          </label>
          <input
            ref={nicknameRef}
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full border border-[var(--border)] rounded-md px-2.5 py-1.5 text-sm bg-[var(--surface)] text-[var(--fg)] focus:outline-none focus:border-[var(--brand)]"
            maxLength={40}
          />
        </div>

        <div className="pm-section">
          <label className="flex items-center gap-1 text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1">
            {t('customTabKeyword')}
            <span className="relative inline-flex">
              <button
                type="button"
                onMouseEnter={() => setHelpOpen(true)}
                onMouseLeave={() => setHelpOpen(false)}
                onClick={() => setHelpOpen((o) => !o)}
                aria-label={t('searchHelp')}
                className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[var(--muted)] text-[9px] font-bold text-[var(--muted)] leading-none hover:bg-[var(--border)] hover:text-[var(--fg)] cursor-help"
              >?</button>
              {helpOpen && (
                <div className="absolute left-0 top-full mt-1 z-[60] w-[300px] p-2.5 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--fg)] text-xs leading-relaxed shadow-lg normal-case tracking-normal font-normal">
                  {t('searchHelp')}
                </div>
              )}
            </span>
          </label>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="kba & BS U15"
            className="w-full border border-[var(--border)] rounded-md px-2.5 py-1.5 text-sm bg-[var(--surface)] text-[var(--fg)] focus:outline-none focus:border-[var(--brand)]"
          />
        </div>

        <div className="pm-section flex items-center justify-between gap-2">
          <div>
            {mode === 'edit' && onDelete && !confirmingDelete && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1.5"
              >{t('customTabDelete')}</button>
            )}
            {mode === 'edit' && onDelete && confirmingDelete && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onDelete}
                  className="text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md px-2.5 py-1.5"
                >{t('customTabDeleteConfirm')}</button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--fg)] px-2 py-1.5"
                >{t('customTabCancel')}</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--fg)] px-3 py-1.5"
            >{t('customTabCancel')}</button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSave}
              className="text-xs font-semibold bg-[var(--brand)] hover:opacity-90 disabled:opacity-40 text-white rounded-md px-3.5 py-1.5"
            >{t('customTabSave')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run the test suite to confirm nothing else broke**

Run: `npx jest`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/CustomTabModal.tsx
git commit -m "feat(custom-tab): add CustomTabModal component"
```

---

## Task 5: Wire the Custom tab into `app/page.tsx`

**Files:**
- Modify: `app/page.tsx:1-16` (imports)
- Modify: `app/page.tsx:76` (`ViewMode` type)
- Modify: `app/page.tsx:78-118` (state declarations)
- Modify: `app/page.tsx:210-217` (hydration `useEffect`)
- Modify: `app/page.tsx:594-635` (search-bar visibility)
- Modify: `app/page.tsx:679-718` (tab strip)
- Modify: `app/page.tsx:797-814` (view branch — add Custom view + render modal)

- [ ] **Step 1: Add imports**

In `app/page.tsx`, add to the imports (next to the other component imports near line 9):

```ts
import CustomTabModal from '@/components/CustomTabModal'
import { loadCustomTab, saveCustomTab, clearCustomTab, type CustomTab } from '@/lib/customTab'
```

- [ ] **Step 2: Extend the `ViewMode` type**

Replace line 76:

```ts
type ViewMode = 'bracket' | 'matches' | 'live' | 'custom'
```

- [ ] **Step 3: Add Custom-tab state**

Add three new `useState` calls inside `Home()` near the other view-mode state (after line 98 `const [viewMode, setViewMode] = useState<ViewMode>('matches')`):

```ts
  const [customTab, setCustomTab] = useState<CustomTab | null>(null)
  const [customModalOpen, setCustomModalOpen] = useState(false)
  const [customModalMode, setCustomModalMode] = useState<'create' | 'edit'>('create')
```

- [ ] **Step 4: Hydrate from localStorage**

Extend the existing hydration `useEffect` (lines 210-217). Replace it with:

```ts
  useEffect(() => {
    try {
      const stored = localStorage.getItem('batbracket.highlightResults')
      if (stored === 'true' || stored === 'false') setHighlightResults(stored === 'true')
      // excludeCompleted intentionally does not persist; clear any legacy value
      localStorage.removeItem('batbracket.excludeCompleted')
    } catch {}
    setCustomTab(loadCustomTab())
  }, [])
```

- [ ] **Step 5: Hide the search cluster on the Custom tab**

The Player-search block in `app/page.tsx` is bounded by:
- Opening: line 572 `{/* Player search */}` immediately followed by `<div className="flex flex-col gap-1">` on line 573.
- Closing: the matching `</div>` on line 636 (immediately before the `{/* Right-side controls: ... */}` comment).

Wrap that whole block in `{viewMode !== 'custom' && ( ... )}`. The result is:

```tsx
          {/* Player search */}
          {viewMode !== 'custom' && (
            <div className="flex flex-col gap-1">
              {/* ... existing label row, input, Highlight + Exclude completed labels — unchanged ... */}
            </div>
          )}
```

Do not modify any of the contents inside the wrapped `<div>`; only add the surrounding conditional.

- [ ] **Step 6: Add the Custom tab / `+` button to the tab strip**

In the tab strip (after the Live tab block that ends around line 716, before the closing `</div>` of the strip on line 717), add:

```tsx
          {customTab ? (
            <button
              onClick={() => setViewMode('custom')}
              className={`group inline-flex items-center gap-1 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                viewMode === 'custom'
                  ? 'border-[var(--brand)] text-[var(--brand-fg)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
              }`}
            >
              <span className="truncate max-w-[160px]">{customTab.nickname}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={t('customTabEdit')}
                title={t('customTabEdit')}
                onClick={(e) => {
                  e.stopPropagation()
                  setCustomModalMode('edit')
                  setCustomModalOpen(true)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    e.preventDefault()
                    setCustomModalMode('edit')
                    setCustomModalOpen(true)
                  }
                }}
                className="inline-flex items-center justify-center w-4 h-4 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)] text-[11px] leading-none cursor-pointer"
              >✎</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setCustomModalMode('create')
                setCustomModalOpen(true)
              }}
              aria-label={t('customTabAddTooltip')}
              title={t('customTabAddTooltip')}
              className="px-3 py-2.5 text-xs font-semibold border-b-2 border-transparent text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            >+</button>
          )}
```

- [ ] **Step 7: Add the Custom view branch**

Find the `viewMode === 'matches'` block (around lines 798-814). After the closing `)}` of that block (around line 814) and before the `viewMode === 'live'` block (around line 817), insert:

```tsx
      {/* Custom view */}
      {viewMode === 'custom' && customTab && (
        <MatchSchedule
          groups={matchGroups}
          days={matchDays}
          selectedDay={selectedDay}
          onDayChange={handleDayChange}
          loading={loadingMatches}
          playerQuery={customTab.keyword}
          excludeCompleted={false}
          highlightMatches={false}
          onEventClick={handleOpenBracketAtRound}
          playerClubMap={playerClubMap}
          onPlayerClick={handlePlayerClick}
          onH2HClick={handleH2HClick}
          liveByCourt={liveByCourt}
          tournamentId={selectedTournament}
        />
      )}
```

- [ ] **Step 8: Render the modal**

In `app/page.tsx`, the JSX root has two existing modals — `<PlayerModal>` (around line 837) and `<H2HModal>` (around line 848) — followed by `<ScrollToTopButton />` (line 856) and the closing `</>`. Insert the `CustomTabModal` immediately after the `<H2HModal>` block and before `<ScrollToTopButton />`:

```tsx
      <CustomTabModal
        open={customModalOpen}
        mode={customModalMode}
        initial={customModalMode === 'edit' ? customTab : null}
        onClose={() => setCustomModalOpen(false)}
        onSave={(tab) => {
          const isCreate = customTab === null
          saveCustomTab(tab)
          setCustomTab(tab)
          setCustomModalOpen(false)
          if (isCreate) {
            setViewMode('custom')
            track('custom_tab_created', {
              keyword_len: tab.keyword.length,
              has_and: tab.keyword.includes('&'),
              has_or: tab.keyword.includes('|'),
            })
          } else {
            track('custom_tab_edited', {
              keyword_len: tab.keyword.length,
              has_and: tab.keyword.includes('&'),
              has_or: tab.keyword.includes('|'),
            })
          }
        }}
        onDelete={() => {
          clearCustomTab()
          setCustomTab(null)
          setCustomModalOpen(false)
          if (viewMode === 'custom') setViewMode('matches')
          track('custom_tab_deleted', {})
        }}
      />
```

- [ ] **Step 9: Track view activation**

Add a `useEffect` near the other view-mode effects (e.g., next to the `viewMode === 'live'` reset effect at line 133):

```ts
  useEffect(() => {
    if (viewMode !== 'custom') return
    track('custom_tab_viewed', { tournament_id: selectedTournament })
  }, [viewMode, selectedTournament])
```

- [ ] **Step 10: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 11: Lint**

Run: `npm run lint`
Expected: No new errors or warnings introduced.

- [ ] **Step 12: Run the full test suite**

Run: `npx jest`
Expected: All tests pass.

- [ ] **Step 13: Manual smoke test**

Run: `npm run dev` (or whatever the project's dev server is — check `package.json` if unsure).
Expected:
- Open the app, select a tournament. The tab strip shows Bracket / Matches / Live / `+`.
- Click `+`. Modal opens with empty fields, Save disabled.
- Type "My Club" and "kba" → Save enables. Click Save. Modal closes; the `+` is replaced by a "My Club" tab with a pencil icon, and the Custom view is now active.
- The Match Schedule layout renders, filtered by `kba`. The main search box is hidden.
- Click the pencil. Modal re-opens with the saved values. Change to "kba & BS U15" and Save. View updates.
- Click the pencil again, click Delete → Confirm delete. Modal closes; tab disappears and `+` returns; view returns to Matches.
- Reload the page (after re-creating the tab). The Custom tab persists; clicking it shows the saved filter.

- [ ] **Step 14: Commit**

```bash
git add app/page.tsx
git commit -m "feat(custom-tab): wire Custom tab into the page (state, tab strip, modal, view)"
```

---

## Verification Summary

After all tasks, the following invariants must hold:

1. `npx jest` passes (existing tests + new `customTab.test.ts` and `MatchSchedule.highlight.test.tsx`).
2. `npx tsc --noEmit` passes.
3. `npm run lint` does not introduce new warnings.
4. Manual flow in Task 5 Step 13 works end-to-end.
5. The Custom tab returns the same set of matches as typing the equivalent keyword into the main search box on the Matches tab (parity check by switching tabs back and forth).

## Out of Scope (per spec)

- Multiple custom tabs.
- Drag-to-reorder tabs.
- URL-shareable custom tabs.
- Per-tournament keywords.
- Custom highlight color / layout variants.

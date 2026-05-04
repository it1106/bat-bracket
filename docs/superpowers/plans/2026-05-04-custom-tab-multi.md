# Custom Tab Multi-Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Custom tab feature to support up to three tabs with drag-to-reorder, 10-character nickname truncation, and one-time migration from the v1 single-tab storage shape.

**Architecture:** Rewrite `lib/customTab.ts` to hold `CustomTab[]` under a new key (`batbracket.customTabs`) with id-based add/update/delete/reorder operations and a one-time migration from the legacy singular key. Extract a `CustomTabButton` component owning truncation + native HTML5 DnD. Update `app/page.tsx` state to track an array plus the active tab id, render one button per tab with a conditional `+`, and resolve the active id to a keyword for the existing `<MatchSchedule>` view branch.

**Tech Stack:** Next.js 14 App Router (client component), React 18 hooks, TypeScript, Tailwind CSS, Jest + @testing-library/react, native HTML5 Drag and Drop, PostHog `track()`.

**Spec:** `docs/superpowers/specs/2026-05-04-custom-tab-multi-design.md`

---

## File Map

- **Modify** `lib/customTab.ts` — rewrite from singular API to array API + migration
- **Modify** `__tests__/customTab.test.ts` — replace tests with array + migration coverage
- **Create** `components/CustomTabButton.tsx` — single tab button with truncation + DnD
- **Modify** `app/page.tsx` — multi-tab state, mapping, save/delete/reorder handlers, view branch
- **Modify** Playwright smoke (`/tmp/smoke_custom_tab.py`) for manual verification

---

## Task 1: Rewrite storage module

The v1 module exports `loadCustomTab` / `saveCustomTab` / `clearCustomTab` keyed on a singular `{nickname, keyword}` object. The new module exports an array-based API and migrates from the legacy key on first load.

**Files:**
- Modify: `lib/customTab.ts`
- Modify: `__tests__/customTab.test.ts`

- [ ] **Step 1: Replace the test file with new coverage**

Overwrite `__tests__/customTab.test.ts` with:

```ts
/**
 * @jest-environment jsdom
 */
import {
  loadCustomTabs,
  saveCustomTabs,
  addCustomTab,
  updateCustomTab,
  deleteCustomTab,
  reorderCustomTabs,
  MAX_CUSTOM_TABS,
} from '@/lib/customTab'

const STORAGE_KEY = 'batbracket.customTabs'
const LEGACY_KEY = 'batbracket.customTab'

beforeEach(() => {
  localStorage.clear()
})

describe('customTab storage — array API', () => {
  it('returns [] when nothing is stored', () => {
    expect(loadCustomTabs()).toEqual([])
  })

  it('round-trips an array', () => {
    const tabs = [
      { id: 't_a', nickname: 'A', keyword: 'a' },
      { id: 't_b', nickname: 'B', keyword: 'b' },
    ]
    saveCustomTabs(tabs)
    expect(loadCustomTabs()).toEqual(tabs)
  })

  it('returns [] when JSON is malformed', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadCustomTabs()).toEqual([])
  })

  it('filters out entries with empty nickname or keyword', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { id: 't_a', nickname: 'A', keyword: 'a' },
      { id: 't_b', nickname: '', keyword: 'b' },
      { id: 't_c', nickname: 'C', keyword: '' },
      { id: 't_d', nickname: 'D', keyword: 'd' },
    ]))
    expect(loadCustomTabs()).toEqual([
      { id: 't_a', nickname: 'A', keyword: 'a' },
      { id: 't_d', nickname: 'D', keyword: 'd' },
    ])
  })

  it('caps to MAX_CUSTOM_TABS', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `t_${i}`, nickname: `N${i}`, keyword: `k${i}` }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(many))
    expect(loadCustomTabs()).toHaveLength(MAX_CUSTOM_TABS)
  })

  it('regenerates duplicate ids', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { id: 'dup', nickname: 'A', keyword: 'a' },
      { id: 'dup', nickname: 'B', keyword: 'b' },
    ]))
    const loaded = loadCustomTabs()
    expect(loaded).toHaveLength(2)
    expect(loaded[0].id).not.toEqual(loaded[1].id)
  })
})

describe('customTab storage — mutators', () => {
  it('addCustomTab appends a new tab with a non-empty id', () => {
    const created = addCustomTab({ nickname: 'A', keyword: 'a' })
    expect(created).not.toBeNull()
    expect(created!.id).toMatch(/^t_/)
    expect(loadCustomTabs()).toEqual([{ id: created!.id, nickname: 'A', keyword: 'a' }])
  })

  it('addCustomTab returns null at MAX_CUSTOM_TABS', () => {
    addCustomTab({ nickname: 'A', keyword: 'a' })
    addCustomTab({ nickname: 'B', keyword: 'b' })
    addCustomTab({ nickname: 'C', keyword: 'c' })
    expect(addCustomTab({ nickname: 'D', keyword: 'd' })).toBeNull()
    expect(loadCustomTabs()).toHaveLength(MAX_CUSTOM_TABS)
  })

  it('updateCustomTab mutates by id', () => {
    const created = addCustomTab({ nickname: 'A', keyword: 'a' })!
    updateCustomTab(created.id, { nickname: 'A2', keyword: 'a2' })
    expect(loadCustomTabs()[0]).toEqual({ id: created.id, nickname: 'A2', keyword: 'a2' })
  })

  it('updateCustomTab is a no-op for unknown id', () => {
    addCustomTab({ nickname: 'A', keyword: 'a' })
    updateCustomTab('does-not-exist', { nickname: 'X', keyword: 'x' })
    expect(loadCustomTabs()[0].nickname).toBe('A')
  })

  it('deleteCustomTab removes by id', () => {
    const a = addCustomTab({ nickname: 'A', keyword: 'a' })!
    addCustomTab({ nickname: 'B', keyword: 'b' })
    deleteCustomTab(a.id)
    const remaining = loadCustomTabs()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].nickname).toBe('B')
  })

  it('reorderCustomTabs writes the requested order', () => {
    const a = addCustomTab({ nickname: 'A', keyword: 'a' })!
    const b = addCustomTab({ nickname: 'B', keyword: 'b' })!
    const c = addCustomTab({ nickname: 'C', keyword: 'c' })!
    reorderCustomTabs([c.id, a.id, b.id])
    expect(loadCustomTabs().map((t) => t.nickname)).toEqual(['C', 'A', 'B'])
  })
})

describe('customTab storage — legacy migration', () => {
  it('migrates a valid legacy single tab', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ nickname: 'old', keyword: 'kw' }))
    const tabs = loadCustomTabs()
    expect(tabs).toHaveLength(1)
    expect(tabs[0].nickname).toBe('old')
    expect(tabs[0].keyword).toBe('kw')
    expect(tabs[0].id).toMatch(/^t_/)
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('discards a corrupt legacy value but still removes the key', () => {
    localStorage.setItem(LEGACY_KEY, '{not json')
    expect(loadCustomTabs()).toEqual([])
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('discards a wrong-shape legacy value', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ nickname: '', keyword: '' }))
    expect(loadCustomTabs()).toEqual([])
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('migration is idempotent (second load reads only new key)', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ nickname: 'old', keyword: 'kw' }))
    loadCustomTabs()
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(loadCustomTabs()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/customTab.test.ts`
Expected: All tests fail because the new exports (`loadCustomTabs`, `saveCustomTabs`, `addCustomTab`, etc., and `MAX_CUSTOM_TABS`) do not exist yet.

- [ ] **Step 3: Replace `lib/customTab.ts` with the new implementation**

Overwrite `lib/customTab.ts`:

```ts
export interface CustomTab {
  id: string
  nickname: string
  keyword: string
}

export const MAX_CUSTOM_TABS = 3

const STORAGE_KEY = 'batbracket.customTabs'
const LEGACY_KEY = 'batbracket.customTab'

function genId(): string {
  return 't_' + Math.random().toString(36).slice(2, 10)
}

function isValidEntry(v: unknown): v is { id: unknown; nickname: string; keyword: string } {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.nickname === 'string' && o.nickname.length > 0
    && typeof o.keyword === 'string' && o.keyword.length > 0
}

function normalize(arr: unknown): CustomTab[] {
  if (!Array.isArray(arr)) return []
  const out: CustomTab[] = []
  const seen = new Set<string>()
  for (const item of arr) {
    if (!isValidEntry(item)) continue
    let id = typeof item.id === 'string' && item.id.length > 0 ? item.id : genId()
    if (seen.has(id)) id = genId()
    seen.add(id)
    out.push({ id, nickname: item.nickname, keyword: item.keyword })
    if (out.length >= MAX_CUSTOM_TABS) break
  }
  return out
}

function readRaw(): CustomTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    return normalize(JSON.parse(raw))
  } catch {
    return []
  }
}

function migrateLegacy(current: CustomTab[]): CustomTab[] {
  const legacy = localStorage.getItem(LEGACY_KEY)
  if (legacy === null) return current
  let migrated: CustomTab[] = current
  try {
    const parsed = JSON.parse(legacy)
    if (
      typeof parsed === 'object' && parsed !== null
      && typeof (parsed as { nickname?: unknown }).nickname === 'string'
      && typeof (parsed as { keyword?: unknown }).keyword === 'string'
      && (parsed as { nickname: string }).nickname.length > 0
      && (parsed as { keyword: string }).keyword.length > 0
    ) {
      const tab: CustomTab = {
        id: genId(),
        nickname: (parsed as { nickname: string }).nickname,
        keyword: (parsed as { keyword: string }).keyword,
      }
      migrated = normalize([tab, ...current])
    }
  } catch {}
  try { localStorage.removeItem(LEGACY_KEY) } catch {}
  if (migrated !== current) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)) } catch {}
  }
  return migrated
}

export function loadCustomTabs(): CustomTab[] {
  if (typeof window === 'undefined') return []
  const current = readRaw()
  return migrateLegacy(current)
}

export function saveCustomTabs(tabs: CustomTab[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.slice(0, MAX_CUSTOM_TABS)))
  } catch {}
}

export function addCustomTab(input: { nickname: string; keyword: string }): CustomTab | null {
  const tabs = loadCustomTabs()
  if (tabs.length >= MAX_CUSTOM_TABS) return null
  const created: CustomTab = { id: genId(), nickname: input.nickname, keyword: input.keyword }
  saveCustomTabs([...tabs, created])
  return created
}

export function updateCustomTab(id: string, patch: { nickname: string; keyword: string }): void {
  const tabs = loadCustomTabs()
  const next = tabs.map((t) => (t.id === id ? { ...t, ...patch } : t))
  saveCustomTabs(next)
}

export function deleteCustomTab(id: string): void {
  const tabs = loadCustomTabs()
  saveCustomTabs(tabs.filter((t) => t.id !== id))
}

export function reorderCustomTabs(orderedIds: string[]): void {
  const tabs = loadCustomTabs()
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const seen = new Set<string>()
  const reordered: CustomTab[] = []
  for (const id of orderedIds) {
    const t = byId.get(id)
    if (t && !seen.has(id)) { reordered.push(t); seen.add(id) }
  }
  for (const t of tabs) {
    if (!seen.has(t.id)) reordered.push(t)
  }
  saveCustomTabs(reordered)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/customTab.test.ts`
Expected: All ~17 tests pass.

- [ ] **Step 5: Confirm `npx tsc --noEmit` reports the expected break**

Run: `npx tsc --noEmit`
Expected: Failures pointing to `app/page.tsx` consuming the removed `loadCustomTab` / `saveCustomTab` / `clearCustomTab` exports. This is expected — Task 3 fixes them. Do not commit yet; the tree is intentionally broken between Task 1 and Task 3.

- [ ] **Step 6: Commit (with a marker that the next task fixes types)**

The Task-1 commit on its own breaks `app/page.tsx`'s type-check. To keep the history bisectable, defer the commit until Tasks 2 and 3 also have implementations ready. Stage Task 1's files but do not commit yet:

```bash
git add lib/customTab.ts __tests__/customTab.test.ts
```

A single commit for Tasks 1+2+3 happens at the end of Task 3 (the wiring task), since the three changes are inherently coupled.

---

## Task 2: `<CustomTabButton>` component

A small component owning per-tab rendering: truncation, the click target, the pencil icon, and native HTML5 DnD wiring.

**Files:**
- Create: `components/CustomTabButton.tsx`

- [ ] **Step 1: Write the component**

Create `components/CustomTabButton.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useLanguage } from '@/lib/LanguageContext'
import type { CustomTab } from '@/lib/customTab'

interface Props {
  tab: CustomTab
  active: boolean
  onActivate: () => void
  onEdit: () => void
  onDropTab: (draggedId: string) => void
}

const MAX_VISIBLE = 10

function displayName(nickname: string): string {
  if (nickname.length <= MAX_VISIBLE) return nickname
  return nickname.slice(0, MAX_VISIBLE) + '…'
}

export default function CustomTabButton({ tab, active, onActivate, onEdit, onDropTab }: Props) {
  const { t } = useLanguage()
  const [dragging, setDragging] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  return (
    <button
      onClick={onActivate}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', tab.id)
        e.dataTransfer.effectAllowed = 'move'
        setDragging(true)
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDragEnter={() => setDragOver(true)}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const draggedId = e.dataTransfer.getData('text/plain')
        if (draggedId && draggedId !== tab.id) onDropTab(draggedId)
      }}
      title={tab.nickname}
      className={`group inline-flex items-center gap-1 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-grab ${
        active
          ? 'border-[var(--brand)] text-[var(--brand-fg)]'
          : 'border-transparent text-[var(--muted)] hover:text-[var(--fg)]'
      } ${dragging ? 'opacity-60' : ''} ${dragOver ? 'bg-[var(--border)]' : ''}`}
    >
      <span>{displayName(tab.nickname)}</span>
      <span
        role="button"
        tabIndex={0}
        draggable={false}
        aria-label={t('customTabEdit')}
        title={t('customTabEdit')}
        onClick={(e) => {
          e.stopPropagation()
          onEdit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation()
            e.preventDefault()
            onEdit()
          }
        }}
        onDragStart={(e) => { e.preventDefault(); e.stopPropagation() }}
        className="inline-flex items-center justify-center w-4 h-4 rounded text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--border)] text-[11px] leading-none cursor-pointer"
      >✎</span>
    </button>
  )
}
```

- [ ] **Step 2: Type-check the component in isolation**

Run: `npx tsc --noEmit`
Expected: Still failures from `app/page.tsx` (Task 3 fixes them) but no new errors originating in `CustomTabButton.tsx`. Visually scan the output and confirm the only red errors are in `app/page.tsx`.

- [ ] **Step 3: Stage the file**

```bash
git add components/CustomTabButton.tsx
```

(No commit yet — combined with Task 3.)

---

## Task 3: Wire multi-tab into `app/page.tsx`

Replace the single-tab state and rendering with array-based state, mapping over tabs, and updated handlers.

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Update imports**

Replace the existing two custom-tab-related imports.

Find:

```tsx
import CustomTabModal from '@/components/CustomTabModal'
import ScrollToTopButton from '@/components/ScrollToTopButton'
import { loadCustomTab, saveCustomTab, clearCustomTab, type CustomTab } from '@/lib/customTab'
```

Replace with:

```tsx
import CustomTabModal from '@/components/CustomTabModal'
import CustomTabButton from '@/components/CustomTabButton'
import ScrollToTopButton from '@/components/ScrollToTopButton'
import {
  loadCustomTabs,
  addCustomTab,
  updateCustomTab,
  deleteCustomTab,
  reorderCustomTabs,
  MAX_CUSTOM_TABS,
  type CustomTab,
} from '@/lib/customTab'
```

- [ ] **Step 2: Replace the custom-tab state declarations**

Find:

```tsx
  const [customTab, setCustomTab] = useState<CustomTab | null>(null)
  const [customModalOpen, setCustomModalOpen] = useState(false)
  const [customModalMode, setCustomModalMode] = useState<'create' | 'edit'>('create')
```

Replace with:

```tsx
  const [customTabs, setCustomTabs] = useState<CustomTab[]>([])
  const [activeCustomTabId, setActiveCustomTabId] = useState<string | null>(null)
  const [customModalOpen, setCustomModalOpen] = useState(false)
  const [customModalMode, setCustomModalMode] = useState<'create' | 'edit'>('create')
  const [customModalEditId, setCustomModalEditId] = useState<string | null>(null)
```

- [ ] **Step 3: Update the hydration effect**

Find:

```tsx
    setCustomTab(loadCustomTab())
  }, [])
```

Replace with:

```tsx
    setCustomTabs(loadCustomTabs())
  }, [])

  // If the active custom tab is deleted out from under us, fall back to Matches.
  useEffect(() => {
    if (viewMode !== 'custom') return
    if (!activeCustomTabId) return
    if (customTabs.some((t) => t.id === activeCustomTabId)) return
    setViewMode('matches')
    setActiveCustomTabId(null)
  }, [viewMode, activeCustomTabId, customTabs])
```

- [ ] **Step 4: Update the analytics view-tracking effect**

The existing effect at the top of the file fires `custom_tab_viewed` when `viewMode === 'custom'`. Add the active id (so multiple tabs are distinguishable in analytics).

Find:

```tsx
  useEffect(() => {
    if (viewMode !== 'custom') return
    track('custom_tab_viewed', { tournament_id: selectedTournament })
  }, [viewMode, selectedTournament])
```

Replace with:

```tsx
  useEffect(() => {
    if (viewMode !== 'custom') return
    if (!activeCustomTabId) return
    track('custom_tab_viewed', { tournament_id: selectedTournament, tab_id: activeCustomTabId })
  }, [viewMode, selectedTournament, activeCustomTabId])
```

- [ ] **Step 5: Replace the tab strip block**

Find the entire block that begins with `{customTab ? (` and ends with the matching `)}` before `</div>` of the tab strip (currently around lines 730–771):

```tsx
          {customTab ? (
            <button
              onClick={() => setViewMode('custom')}
              ...
            >+</button>
          )}
```

Replace it with:

```tsx
          {customTabs.map((tab) => (
            <CustomTabButton
              key={tab.id}
              tab={tab}
              active={viewMode === 'custom' && activeCustomTabId === tab.id}
              onActivate={() => {
                setViewMode('custom')
                setActiveCustomTabId(tab.id)
              }}
              onEdit={() => {
                setCustomModalMode('edit')
                setCustomModalEditId(tab.id)
                setCustomModalOpen(true)
              }}
              onDropTab={(draggedId) => {
                if (draggedId === tab.id) return
                const filtered = customTabs.filter((t) => t.id !== draggedId)
                const insertAt = filtered.findIndex((t) => t.id === tab.id)
                const dragged = customTabs.find((t) => t.id === draggedId)
                if (!dragged || insertAt < 0) return
                const next = [...filtered.slice(0, insertAt), dragged, ...filtered.slice(insertAt)]
                reorderCustomTabs(next.map((t) => t.id))
                setCustomTabs(loadCustomTabs())
              }}
            />
          ))}
          {customTabs.length < MAX_CUSTOM_TABS && (
            <button
              onClick={() => {
                setCustomModalMode('create')
                setCustomModalEditId(null)
                setCustomModalOpen(true)
              }}
              aria-label={t('customTabAddTooltip')}
              title={t('customTabAddTooltip')}
              className="px-3 py-2.5 text-xs font-semibold border-b-2 border-transparent text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            >+</button>
          )}
```

- [ ] **Step 6: Replace the Custom view branch**

Find:

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

Replace with:

```tsx
      {/* Custom view */}
      {viewMode === 'custom' && activeCustomTabId && (() => {
        const active = customTabs.find((t) => t.id === activeCustomTabId)
        if (!active) return null
        return (
          <MatchSchedule
            groups={matchGroups}
            days={matchDays}
            selectedDay={selectedDay}
            onDayChange={handleDayChange}
            loading={loadingMatches}
            playerQuery={active.keyword}
            excludeCompleted={false}
            highlightMatches={false}
            onEventClick={handleOpenBracketAtRound}
            playerClubMap={playerClubMap}
            onPlayerClick={handlePlayerClick}
            onH2HClick={handleH2HClick}
            liveByCourt={liveByCourt}
            tournamentId={selectedTournament}
          />
        )
      })()}
```

- [ ] **Step 7: Replace the modal handler block**

Find the existing `<CustomTabModal ... />` block (currently around lines 931–965) and replace the entire element with:

```tsx
      <CustomTabModal
        open={customModalOpen}
        mode={customModalMode}
        initial={
          customModalMode === 'edit' && customModalEditId
            ? customTabs.find((t) => t.id === customModalEditId) ?? null
            : null
        }
        onClose={() => setCustomModalOpen(false)}
        onSave={(input) => {
          if (customModalMode === 'create') {
            const created = addCustomTab(input)
            if (created) {
              const next = loadCustomTabs()
              setCustomTabs(next)
              setActiveCustomTabId(created.id)
              setViewMode('custom')
              track('custom_tab_created', {
                count: next.length,
                keyword_len: input.keyword.length,
                has_and: input.keyword.includes('&'),
                has_or: input.keyword.includes('|'),
              })
            }
          } else if (customModalEditId) {
            updateCustomTab(customModalEditId, input)
            setCustomTabs(loadCustomTabs())
            track('custom_tab_edited', {
              keyword_len: input.keyword.length,
              has_and: input.keyword.includes('&'),
              has_or: input.keyword.includes('|'),
            })
          }
          setCustomModalOpen(false)
        }}
        onDelete={
          customModalMode === 'edit' && customModalEditId
            ? () => {
                const idToDelete = customModalEditId
                deleteCustomTab(idToDelete)
                const remaining = loadCustomTabs()
                setCustomTabs(remaining)
                if (activeCustomTabId === idToDelete) {
                  setActiveCustomTabId(null)
                  setViewMode('matches')
                }
                setCustomModalOpen(false)
                track('custom_tab_deleted', { remaining: remaining.length })
              }
            : undefined
        }
      />
```

The `CustomTabModal` component already accepts `initial: CustomTab | null` and uses only `nickname` and `keyword` from it; the new `CustomTab` shape adds an `id` field which the modal harmlessly ignores. No change to `components/CustomTabModal.tsx` is required.

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 9: Lint**

Run: `npm run lint`
Expected: No new warnings.

- [ ] **Step 10: Run the test suite**

Run: `npx jest --testPathIgnorePatterns=__tests__/scraper.test.ts`
Expected: All tests pass (the two pre-existing scraper failures are unrelated and ignored).

- [ ] **Step 11: Commit Tasks 1 + 2 + 3 together**

```bash
git add lib/customTab.ts __tests__/customTab.test.ts components/CustomTabButton.tsx app/page.tsx
git commit -m "$(cat <<'EOF'
feat(custom-tab): support up to 3 tabs with reorder + truncation

Replace the singular {nickname, keyword} storage shape with an array
keyed by id under batbracket.customTabs. Add one-time migration from
the v1 batbracket.customTab key. Render up to MAX_CUSTOM_TABS=3 tabs
with native HTML5 drag-to-reorder, hide the + button at the limit,
truncate nicknames to 10 chars + ellipsis (full name in tooltip).
Active tab does not persist across reload.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Manual smoke test (Playwright)

Verify the end-to-end flow including migration and reorder.

**Files:**
- Create: `/tmp/smoke_custom_tabs_multi.py`

- [ ] **Step 1: Start the dev server in the background**

Run: `npm run dev` (background). Wait for `Ready`. The server may pick port 3001 if 3000 is in use; the script reads the port from the user.

- [ ] **Step 2: Write the Playwright script**

Create `/tmp/smoke_custom_tabs_multi.py`:

```python
"""Smoke test for the multi-tab Custom feature."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000/"


def select_first_tournament(page):
    page.wait_for_selector('select')
    selects = page.locator('select').all()
    options = selects[0].locator('option').all()
    target_value = None
    for o in options:
        v = o.get_attribute('value')
        if v:
            target_value = v
            break
    assert target_value, "no tournament options found"
    selects[0].select_option(target_value)
    page.wait_for_load_state('networkidle')


def open_create_modal(page):
    page.locator('button[aria-label="Add custom tab"]').click()
    page.wait_for_selector('text=New Custom Tab', timeout=3000)


def fill_and_save(page, nick, kw):
    inputs = page.locator('.pm-modal input[type="text"]').all()
    inputs[0].fill(nick)
    inputs[1].fill(kw)
    page.locator('button', has_text='Save').last.click()
    page.wait_for_timeout(300)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda exc: errors.append(f"PAGE: {exc}"))
    page.on('console', lambda m: errors.append(f"CONSOLE {m.type}: {m.text}") if m.type == 'error' else None)

    print("0. Seed legacy single-tab in localStorage to verify migration...")
    page.goto(URL)
    page.evaluate("localStorage.setItem('batbracket.customTab', JSON.stringify({nickname: 'Legacy', keyword: 'gamma'}))")
    page.reload()
    page.wait_for_load_state('networkidle')
    select_first_tournament(page)
    page.wait_for_timeout(1500)
    legacy_btn = page.locator('button[title="Legacy"]')
    assert legacy_btn.count() == 1, f"legacy tab missing after migration, count={legacy_btn.count()}"
    assert page.evaluate("localStorage.getItem('batbracket.customTab')") is None, "legacy key should be removed"
    arr = page.evaluate("JSON.parse(localStorage.getItem('batbracket.customTabs'))")
    assert len(arr) == 1 and arr[0]['nickname'] == 'Legacy', f"new key should hold migrated tab, got {arr}"
    print("   ✓ Legacy tab migrated; legacy key cleared")

    print("1. Add second and third tabs...")
    open_create_modal(page)
    fill_and_save(page, "ClubMembersFavorites", "alpha")  # 19 chars → truncated
    open_create_modal(page)
    fill_and_save(page, "U15", "beta")
    page.wait_for_timeout(200)

    print("2. + button should be hidden at 3 tabs...")
    assert page.locator('button[aria-label="Add custom tab"]').count() == 0, "+ button should be hidden at limit"
    print("   ✓ + hidden")

    print("3. Truncated label visible...")
    truncated_btn = page.locator('button[title="ClubMembersFavorites"]')
    assert truncated_btn.count() == 1
    label = truncated_btn.inner_text()
    assert 'ClubMember' in label and '…' in label, f"expected truncated label, got '{label}'"
    print(f"   ✓ Label '{label.strip().split(chr(10))[0]}' (full name in title)")

    print("4. Reorder — drag the third tab onto the first...")
    third = page.locator('button[title="U15"]')
    first = page.locator('button[title="Legacy"]')
    third.drag_to(first)
    page.wait_for_timeout(300)
    arr = page.evaluate("JSON.parse(localStorage.getItem('batbracket.customTabs'))")
    nicknames = [t['nickname'] for t in arr]
    assert nicknames[0] == 'U15', f"expected U15 first after reorder, got {nicknames}"
    print(f"   ✓ Reorder persisted: {nicknames}")

    print("5. Activate a tab, then delete it — view should fall back to Matches...")
    page.locator('button[title="Legacy"]').click()
    page.wait_for_timeout(200)
    pencils_legacy = page.locator('button[title="Legacy"] span[aria-label="Edit Custom Tab"]')
    pencils_legacy.click()
    page.wait_for_selector('text=Edit Custom Tab', timeout=3000)
    page.locator('button', has_text='Delete').first.click()
    page.wait_for_timeout(150)
    page.locator('button', has_text='Confirm delete').click()
    page.wait_for_timeout(300)
    assert page.locator('button[title="Legacy"]').count() == 0, "deleted tab should be gone"
    # Search input is hidden on Custom — its presence means we returned to Matches
    assert page.locator('input[placeholder="Player, club, or event"]').count() == 1, "should be back on a non-Custom view"
    print("   ✓ Deleted active tab; fell back to Matches")

    print("6. Reload — active tab should NOT persist; tabs themselves should...")
    page.locator('button[title="U15"]').click()
    page.wait_for_timeout(200)
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    assert page.locator('input[placeholder="Player, club, or event"]').count() == 1, "should land on Matches after reload"
    assert page.locator('button[title="U15"]').count() == 1, "tabs should still be present"
    print("   ✓ Reload lands on Matches; tabs preserved")

    print("7. Cleanup...")
    page.evaluate("localStorage.removeItem('batbracket.customTabs')")
    page.evaluate("localStorage.removeItem('batbracket.customTab')")

    if errors:
        print(f"\n⚠ {len(errors)} console/page errors:")
        for e in errors[:5]:
            print(f"   {e}")
    else:
        print("\n✓ No console errors")
    print("\nALL CHECKS PASSED")
    browser.close()
```

- [ ] **Step 3: Run the smoke test**

Run: `python3 /tmp/smoke_custom_tabs_multi.py http://localhost:3000/` (or `:3001/` if dev picked the alt port).
Expected: All 7 checks print `✓` and the script ends with `ALL CHECKS PASSED`. No console errors.

- [ ] **Step 4: Stop the dev server**

```bash
pkill -f "next dev"
```

- [ ] **Step 5: No commit**

The smoke script lives in `/tmp` and is not committed. If you want to keep it, copy to `__tests__/` or `scripts/` first.

---

## Verification Summary

After all tasks:

1. `npx jest --testPathIgnorePatterns=__tests__/scraper.test.ts` passes (storage tests + existing).
2. `npx tsc --noEmit` passes.
3. `npm run lint` passes.
4. Playwright smoke (Task 4) prints `ALL CHECKS PASSED`.
5. Migration is verified end-to-end: a `batbracket.customTab` value seeded before reload becomes a single entry in `batbracket.customTabs` and the legacy key is gone.
6. The `+` button is hidden when 3 tabs exist; reappears after a delete.
7. Drag-to-reorder updates `batbracket.customTabs` in place.
8. Reload lands on Matches even when the user was on a custom tab.

## Out of Scope (per spec)

- Mobile / touch DnD.
- Persisting which custom tab was active across reload.
- More than 3 tabs.
- URL sharing / cross-device sync.
- Visual drop-position indicators between tabs.

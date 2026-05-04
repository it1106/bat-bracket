# Custom Tab — Multi-Tab Extension Design

Extend the existing Custom tab feature from one tab to up to three, with drag-to-reorder and 10-character nickname truncation in the tab strip.

**Builds on:** `docs/superpowers/specs/2026-05-04-custom-tab-design.md`

## Background

The Custom tab shipped with single-tab support. Users want multiple saved searches — e.g., one tab for their club, one for an age group they follow, one for a specific event. Three is enough; the tab strip stays readable at that size.

## Goals

- Up to three Custom tabs, each with its own `{ nickname, keyword }`.
- Tab labels truncated to 10 characters + `…` in the strip; full nickname in the browser tooltip.
- Drag-to-reorder tabs (desktop only; mobile DnD is out of scope).
- One-time migration: existing single-tab users keep their tab on first load after the upgrade.
- Active tab does not persist across reload — reload defaults to the Matches tab.

## Non-Goals

- More than three tabs.
- Mobile drag-and-drop.
- Sharing tabs via URL or syncing across devices.
- Per-tournament keywords or rich (regex/glob) search syntax.
- Persisting which tab was active across reload.
- Renaming tabs inline (rename happens through the existing modal).

## User Flow

1. **First load after upgrade.** A user with one saved tab still sees that tab in the strip — the storage migrates transparently.
2. **Adding a tab.** When `customTabs.length < 3`, a `+` button appears at the end of the tab strip. Clicking it opens the create modal as today; saving inserts the new tab at the end and switches to it. When the count reaches 3, the `+` disappears.
3. **Editing.** Each tab has its own pencil icon. Clicking it opens the modal pre-filled with that tab's values.
4. **Deleting.** Inside the edit modal, Delete + Confirm removes the tab. If the deleted tab was active, the view falls back to Matches.
5. **Reordering (desktop).** Click and hold a tab, drag it onto another tab to drop it before that one. The new order persists immediately.
6. **Reload.** Tabs and their order persist. The active tab does not — the user lands on Matches.

## Architecture

### Storage layer — `lib/customTab.ts` (rewritten)

```ts
export interface CustomTab {
  id: string
  nickname: string
  keyword: string
}

export const MAX_CUSTOM_TABS = 3

export function loadCustomTabs(): CustomTab[]
export function saveCustomTabs(tabs: CustomTab[]): void
export function addCustomTab(input: { nickname: string; keyword: string }): CustomTab | null
export function updateCustomTab(id: string, patch: { nickname: string; keyword: string }): void
export function deleteCustomTab(id: string): void
export function reorderCustomTabs(orderedIds: string[]): void
```

- New localStorage key: `batbracket.customTabs`, holding `CustomTab[]` as JSON.
- Legacy key: `batbracket.customTab` (singular `{nickname, keyword}` from v1) is migrated on first call to `loadCustomTabs` and then removed.
- `loadCustomTabs` filters out malformed entries (missing/empty `nickname` or `keyword`), trims to `MAX_CUSTOM_TABS`, regenerates duplicate ids, and returns `[]` on JSON parse failure.
- ID generation: `'t_' + Math.random().toString(36).slice(2, 10)`. Collision odds are negligible for ≤3 ids; the loader still re-IDs duplicates defensively.
- `addCustomTab` returns `null` when already at `MAX_CUSTOM_TABS`. The page hides the `+` button at the limit, so this is defensive.
- `updateCustomTab` is a no-op for an unknown id.
- `deleteCustomTab` filters by id; no-op for an unknown id.
- `reorderCustomTabs` accepts the desired id order and writes the array in that order. Ids not present in storage are ignored; any storage ids missing from the input are appended at the end (defensive — DnD code passes the full set).

### Migration

Inside `loadCustomTabs`:

```
1. Try to read STORAGE_KEY ('batbracket.customTabs').
2. If LEGACY_KEY exists:
   - Parse it; if it's a valid {nickname, keyword} object, prepend {id: gen(), ...} to the in-memory array (cap to MAX).
   - Remove LEGACY_KEY.
   - Write the merged array to STORAGE_KEY.
3. Return the validated array.
```

The migration is idempotent — once `LEGACY_KEY` is gone, subsequent loads skip step 2.

### Page-level state — `app/page.tsx`

Replaces the v1 `customTab`/`customModalMode` pair with:

```ts
const [customTabs, setCustomTabs] = useState<CustomTab[]>([])
const [activeCustomTabId, setActiveCustomTabId] = useState<string | null>(null)
const [customModalOpen, setCustomModalOpen] = useState(false)
const [customModalMode, setCustomModalMode] = useState<'create' | 'edit'>('create')
const [customModalEditId, setCustomModalEditId] = useState<string | null>(null)
```

Hydration on mount: `setCustomTabs(loadCustomTabs())`. `activeCustomTabId` starts at `null` and is only set when the user clicks a custom tab — so a reload always lands the user back on Matches.

Cleanup effect (handles the case where the active tab disappears, e.g., during a future race condition):

```ts
useEffect(() => {
  if (viewMode !== 'custom') return
  if (!activeCustomTabId) return
  if (customTabs.some((t) => t.id === activeCustomTabId)) return
  setViewMode('matches')
  setActiveCustomTabId(null)
}, [viewMode, activeCustomTabId, customTabs])
```

### Tab strip & `<CustomTabButton>` component

A new `components/CustomTabButton.tsx` extracts the per-tab rendering — the inline JSX in v1 grew with DnD wiring, and pulling it into its own component keeps the page tab strip readable.

```tsx
interface Props {
  tab: CustomTab
  active: boolean
  onActivate: () => void
  onEdit: () => void
  onReorderTo: (draggedId: string) => void  // dropped on this tab
}
```

Render shape: a `<button>` with `draggable={true}` and DnD handlers, containing:
- truncated nickname text (`tab.nickname.length > 10 ? tab.nickname.slice(0, 10) + '…' : tab.nickname`)
- `title={tab.nickname}` for the full-name tooltip
- a pencil `<span role="button">` with `draggable={false}`, `onClick` calling `e.stopPropagation()` then `onEdit()`

The page maps over `customTabs` and renders one `<CustomTabButton>` per tab. The `+` button is rendered only when `customTabs.length < MAX_CUSTOM_TABS`.

Truncation rule: 10 characters + `…` (max 11 visible). Examples:
- `"My Players"` (10 chars) → `"My Players"`
- `"My Club Favorites"` (17 chars) → `"My Club Fa…"`

### Drag-and-drop reordering

Native HTML5 DnD on the tab `<button>`:

- `onDragStart`: `e.dataTransfer.setData('text/plain', tab.id)`, `e.dataTransfer.effectAllowed = 'move'`.
- `onDragOver`: `e.preventDefault()` to allow drop.
- `onDrop`: read the dragged id, compute a new order with the dragged tab inserted **before** the drop target, call `reorderCustomTabs(newIds)`, and `setCustomTabs(loadCustomTabs())`.
- Visual feedback: `cursor-grab` on the tab; while dragging, set `opacity-60` on the dragged element via local state.
- The pencil span has `draggable={false}` and `onClick` stops propagation, so users can edit without triggering drag.

If a user drops a tab on itself, the order is unchanged.

Mobile / touch: native HTML5 DnD does not fire on iOS Safari touch. Acceptable for v1; mobile users still create / edit / delete. Documented as a known limitation.

### Modal — `components/CustomTabModal.tsx`

No structural change. The component already takes `initial: CustomTab | null` (was the singular type, now the new shape — same fields). The parent computes `initial` from `customModalEditId`:

```ts
const editing = customModalEditId
  ? customTabs.find((t) => t.id === customModalEditId) ?? null
  : null
<CustomTabModal
  open={customModalOpen}
  mode={customModalMode}
  initial={editing}
  onSave={...}
  onDelete={editing ? () => { ... } : undefined}
/>
```

The modal still emits `{ nickname, keyword }` on save; the parent decides whether to call `addCustomTab` (create) or `updateCustomTab(editing.id, ...)` (edit), and `deleteCustomTab(editing.id)` on delete. The modal continues to enforce non-empty trimmed fields and `maxLength={40}` on nickname.

### Save / delete handlers

```ts
onSave: (input) => {
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
}

onDelete: () => {
  if (!customModalEditId) return
  deleteCustomTab(customModalEditId)
  const remaining = loadCustomTabs()
  setCustomTabs(remaining)
  if (activeCustomTabId === customModalEditId) {
    setActiveCustomTabId(null)
    setViewMode('matches')
  }
  setCustomModalOpen(false)
  track('custom_tab_deleted', { remaining: remaining.length })
}
```

### Custom view branch

Replaces the v1 single-tab branch:

```tsx
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

The search-bar visibility rule (`viewMode !== 'custom'`) is unchanged.

## Data Flow

```
localStorage
  batbracket.customTabs (canonical)
  batbracket.customTab  (legacy, removed after first load)
        │
        │ loadCustomTabs() on mount
        ▼
page state: customTabs: CustomTab[], activeCustomTabId: string | null
        │
        ├── Tab strip → maps to CustomTabButton (one per tab) + optional '+' button
        │       │
        │       ├── click body → setActiveCustomTabId, setViewMode('custom')
        │       ├── click pencil → open modal in edit mode for that id
        │       └── drop another tab on this one → reorderCustomTabs(newIds)
        │
        └── viewMode === 'custom'
                  │  resolves activeCustomTabId → active tab → keyword
                  ▼
            <MatchSchedule playerQuery={active.keyword} ... />
```

## Edge Cases

- **Migrated tab.** Old key is read once, wrapped in an array with a generated id, written under the new key, and the old key is removed. Idempotent on subsequent loads.
- **Corrupted JSON / wrong shape.** Loader returns `[]` (or a filtered subset). The next save overwrites with valid JSON.
- **`addCustomTab` at the limit.** Returns `null`. The `+` button is hidden at the limit, so this is purely defensive.
- **Active tab deleted.** Cleanup `useEffect` resets `viewMode` to `'matches'` and clears `activeCustomTabId`.
- **Duplicate nicknames.** Allowed by design (no uniqueness enforcement).
- **Drag onto self.** No-op.
- **Mobile touch.** HTML5 DnD doesn't fire; reordering is unavailable on mobile. All other operations work.
- **Tournament/event change while on a custom tab.** Keyword is global, not per-tournament. The active tab keeps its keyword; the view re-renders with whatever matches the new tournament's data.

## Analytics

Same event names as v1, with two added/changed properties:

- `custom_tab_created` — `{ count, keyword_len, has_and, has_or }` where `count` is the new total (1, 2, or 3).
- `custom_tab_edited` — `{ keyword_len, has_and, has_or }`.
- `custom_tab_deleted` — `{ remaining }` where `remaining` is the count after deletion.
- `custom_tab_viewed` — `{ tournament_id }` (unchanged).

Raw keyword text is not logged.

## Testing

Unit tests in `__tests__/customTab.test.ts` (extended):

- `loadCustomTabs` returns `[]` when nothing is stored / when JSON is malformed / when shape is wrong.
- `saveCustomTabs` round-trips an array.
- `addCustomTab` returns the created tab with a non-empty `id`; appends to the end; returns `null` at `MAX_CUSTOM_TABS`.
- `updateCustomTab` mutates by id; no-op for unknown id.
- `deleteCustomTab` removes by id.
- `reorderCustomTabs` writes the array in the supplied id order.
- **Migration test:** seed `batbracket.customTab` with `{nickname: 'x', keyword: 'y'}`, call `loadCustomTabs`, expect a 1-element array with `nickname: 'x'`, `keyword: 'y'`, and a non-empty `id`. Confirm the legacy key has been removed.
- **Migration corrupt:** seed `batbracket.customTab` with `'{not json'`, call `loadCustomTabs`, expect `[]` and the legacy key removed.

Component-level: existing `MatchSchedule.highlight.test.tsx` is unaffected.

Manual smoke check (Playwright): an updated version of the v1 smoke covering create-three / reorder / delete-active / migration. The DnD case uses Playwright's `page.dragAndDrop` API which simulates synthetic events that the native handlers do see.

## Out of Scope

- More than three tabs.
- Drag-to-reorder on mobile / touch.
- Persisting which custom tab was active across reload.
- Drag-from-a-handle UX (the whole tab is the drag handle).
- Visual indicators for drop position between tabs (we use "drop on a tab → insert before").

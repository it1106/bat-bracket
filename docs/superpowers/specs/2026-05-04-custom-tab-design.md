# Custom Tab — Design

A user-configurable view tab that filters the Match Schedule by a saved search keyword.

## Background

The app currently exposes three view modes — Bracket, Match Schedule, Live Matches — driven by a single global search box (`playerQuery` in `app/page.tsx`). Search uses `parseSearchQuery` / `expandSearchQuery` from `lib/searchAliases.ts` with `&` (AND) and `|` (OR) operators plus alias expansion.

Power users repeatedly type the same query (e.g., to track their club's players across tournaments). This design adds a single Custom tab whose filter is persisted in localStorage so the user doesn't have to retype.

## Goals

- One Custom tab, hidden until configured, that filters matches by a saved keyword.
- Filtering uses the same `parseSearchQuery` pipeline as the main search box (no divergence).
- Configuration (nickname + keyword) persists across reloads via localStorage.
- Reuse `<MatchSchedule>` as-is for layout — same day tabs, time grouping, live score, click-to-bracket, H2H behavior.

## Non-Goals

- Multiple custom tabs / a saved-searches list.
- Cross-device sync, URL sharing, or per-tournament keywords.
- New search syntax. The Custom tab uses the existing query syntax.
- Different layout from the Matches view.
- Custom highlighting or completion-toggle behavior on this tab.

## User Flow

1. User sees Bracket / Matches / Live tabs, plus a small `+` button at the end of the tab strip.
2. User clicks `+`. A modal opens with two fields — **Tab name** and **Search keywords** — and a Save button (disabled until both are non-empty).
3. User enters e.g. `My Club` and `kba & BS U15`, clicks Save. The `+` button is replaced by a tab labeled `My Club` with a small pencil icon. The Custom tab becomes the active view and shows matches filtered by `kba & BS U15`.
4. User can click the pencil to re-open the modal in edit mode (with current values pre-filled). The modal exposes a Delete button. Deleting removes the tab; if the user was on the Custom tab, the view falls back to Matches.

## Architecture

### Storage layer — `lib/customTab.ts` (new)

```ts
export interface CustomTab {
  nickname: string
  keyword: string
}

export function loadCustomTab(): CustomTab | null
export function saveCustomTab(tab: CustomTab): void
export function clearCustomTab(): void
```

- Stored as JSON under localStorage key `batbracket.customTab` (matches the `batbracket.*` prefix used elsewhere).
- `loadCustomTab` returns `null` when the key is absent, when JSON parsing fails, or when the parsed value is not an object with non-empty `nickname` and `keyword` strings. Wrapped in try/catch for SSR / disabled-storage safety.
- `saveCustomTab` trusts its input (UI enforces non-empty trimmed fields) and JSON-stringifies under the same key.
- `clearCustomTab` removes the key.

### Page-level state — `app/page.tsx`

Existing state extended:

```ts
type ViewMode = 'bracket' | 'matches' | 'live' | 'custom'
const [customTab, setCustomTab] = useState<CustomTab | null>(null)
const [customModalOpen, setCustomModalOpen] = useState(false)
const [customModalMode, setCustomModalMode] = useState<'create' | 'edit'>('create')
```

Hydration: the existing `useEffect` that loads localStorage values gains a call to `loadCustomTab()` and stores the result in `customTab`.

Tab strip (currently `app/page.tsx:679-718`):
- After the Live tab, render either:
  - **Custom tab button** (when `customTab !== null`) — labeled `customTab.nickname`, with a pencil icon (~16×16px, always visible) on the right that opens the modal in `'edit'` mode. The tab body sets `viewMode='custom'`. Same active/inactive styling as other tabs.
  - **`+` button** (when `customTab === null`) — styled as a muted tab; opens the modal in `'create'` mode.

Search-bar visibility: the existing `playerQuery` input + Highlight + Exclude completed cluster (around `app/page.tsx:594-635`) is rendered only when `viewMode !== 'custom'`. On the Custom tab, only tournament/event selectors remain in the toolbar.

Fallback: if `viewMode === 'custom'` and the user deletes the custom tab, set `viewMode = 'matches'`.

### Custom view — reusing `<MatchSchedule>`

Parallel to the existing `viewMode === 'matches'` branch:

```tsx
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

The `parseSearchQuery` / `matchesQuery` filtering pipeline runs identically to the Matches view, so behavior parity is automatic. Live scores apply the same way.

### `<MatchSchedule>` change

Add an optional prop:

```ts
highlightMatches?: boolean  // default true
```

Inside `MatchSchedule.tsx`, the existing `nameCls` helper currently adds `ms-player-highlight` whenever `queries.length > 0`. The condition becomes `highlightMatches !== false && queries.length > 0`. The Bracket, Matches, and Live views continue to default to `true`; only the Custom view passes `false`.

### Modal — `components/CustomTabModal.tsx` (new)

```tsx
interface Props {
  open: boolean
  mode: 'create' | 'edit'
  initial: CustomTab | null  // null in 'create' mode
  onClose: () => void
  onSave: (tab: CustomTab) => void
  onDelete?: () => void  // shown only in 'edit' mode
}
```

Layout (centered, dark backdrop; follows the existing `H2HModal` / `PlayerModal` patterns):

- Header: title (`customTabCreate` / `customTabEdit`), close `✕` button.
- **Tab name** input.
- **Search keywords** input with a `?` tooltip reusing the existing `searchHelp` i18n string.
- Footer: `Delete` button on the left (edit mode only); `Cancel` and `Save` on the right.

Behavior:
- Both inputs are trimmed before submit. Save is disabled until both fields are non-empty (after trim).
- Enter submits when valid; Esc closes without saving.
- Delete button shows an inline two-step confirm (Delete? → Confirm / Cancel) — no second dialog.
- The parent owns persistence: on save it calls `saveCustomTab(...)` and `setCustomTab(...)`; on delete it calls `clearCustomTab()` and `setCustomTab(null)` and may flip `viewMode` to `'matches'`.

### i18n keys to add (`lib/i18n.ts`)

| key                       | en                                       | th (placeholder)                       |
| ------------------------- | ---------------------------------------- | -------------------------------------- |
| `customTab`               | Custom                                   | กำหนดเอง                               |
| `customTabCreate`         | New Custom Tab                           | สร้างแท็บกำหนดเอง                      |
| `customTabEdit`           | Edit Custom Tab                          | แก้ไขแท็บกำหนดเอง                      |
| `customTabName`           | Tab name                                 | ชื่อแท็บ                               |
| `customTabKeyword`        | Search keywords                          | คำค้นหา                                |
| `customTabAddTooltip`     | Add custom tab                           | เพิ่มแท็บกำหนดเอง                      |
| `customTabSave`           | Save                                     | บันทึก                                 |
| `customTabCancel`         | Cancel                                   | ยกเลิก                                 |
| `customTabDelete`         | Delete                                   | ลบ                                     |
| `customTabDeleteConfirm`  | Confirm delete                           | ยืนยันการลบ                            |

Translation strings to be reviewed by the user; placeholders above are starting points.

## Data Flow

```
localStorage (batbracket.customTab)
        │  loadCustomTab() on mount
        ▼
page.tsx state: customTab
        │
        ├── Tab strip: shows Custom tab or '+' button
        │
        ├── Modal save → saveCustomTab() + setCustomTab()
        ├── Modal delete → clearCustomTab() + setCustomTab(null)
        │
        ▼
viewMode === 'custom'
        │  passes customTab.keyword as playerQuery
        ▼
<MatchSchedule>
        │  parseSearchQuery / matchesQuery (unchanged logic)
        ▼
filtered matches rendered
```

## Edge Cases

- **Corrupted JSON in localStorage**: `loadCustomTab` returns `null`, treating it as unset; the next save overwrites with valid JSON.
- **localStorage disabled / SSR**: load returns `null`; saves silently no-op via try/catch. The Custom tab is not visible until storage works.
- **Keyword that matches no current matches**: the existing `searchNotFound` empty state inside `MatchSchedule` handles this.
- **Tournament/event change while on Custom tab**: keyword is global, not per-tournament. View re-renders against the new tournament's matches; if nothing matches, empty state shows.
- **Delete while viewing Custom**: parent flips `viewMode = 'matches'` after `setCustomTab(null)`.
- **Day-tab state**: `selectedDay` is shared with the Matches view (already single state on the page); switching tabs preserves the selected day.

## Analytics

Add the following `track()` calls (pattern from `lib/analytics.ts`):

- `custom_tab_created` — `{ keyword_len, has_and, has_or }`
- `custom_tab_edited` — `{ keyword_len, has_and, has_or }`
- `custom_tab_deleted` — `{}`
- `custom_tab_viewed` — `{ tournament_id }` (fired on tab activation)

Raw keyword text is not logged (may contain real player names).

## Testing

Unit tests (Jest, alongside existing `__tests__/`):

- `__tests__/customTab.test.ts` — `loadCustomTab` returns null when absent / when JSON is malformed / when shape is wrong; `saveCustomTab` round-trips; `clearCustomTab` removes the key.

Component-level: existing `MatchSchedule` tests stay green. Add a small test verifying that `MatchSchedule` does **not** apply `ms-player-highlight` when `highlightMatches={false}` even with a non-empty query.

Manual verification (UI not covered by automated tests in this project):

- Create / edit / delete flow.
- Persistence across reload.
- Custom tab respects day tabs, live updates, click-to-open-bracket, and H2H buttons.
- Main search bar hidden on Custom tab; reappears when switching to other tabs.
- No yellow highlight on Custom tab.
- Custom tab matches the same set of matches as the equivalent typed query in the main search box (parity check).

## Out of Scope

- Multiple custom tabs.
- Drag-to-reorder tabs.
- Sharing custom tabs via URL.
- Per-tournament keywords.
- Custom highlight color or layout variants.

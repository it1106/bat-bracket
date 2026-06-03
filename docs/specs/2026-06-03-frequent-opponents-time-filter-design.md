# Frequent Opponents — Time-Window Filter

**Date:** 2026-06-03
**Status:** Approved (pending implementation)
**Surface:** Player profile page (`components/PlayerProfileView.tsx`)

## Summary

Add five time-window tabs — **30 Days · 90 Days · 180 Days · 1 Year · All Time** — to the *Frequent opponents* section on the player profile. Each tab shows the player's top opponents within that window only. Default tab is **All Time** (preserves current behavior). The *Frequent partners* section is unchanged.

## Motivation

Today the section shows lifetime aggregates only. A player's current rivals — who they actually played this month — get drowned out by historical opponents from years ago. Adding time tabs surfaces *who you've been playing lately* without losing access to the lifetime view.

## User-visible behavior

- Section heading now sits next to a horizontal pill-style tab strip: `30 Days · 90 Days · 180 Days · 1 Year · All Time`.
- Selected tab is filled; others ghost. Pattern mirrors the existing `.h2h-filter-tabs` in `H2HModal.tsx`.
- Switching tabs is instant — no spinner, no fetch. Each tab swaps the underlying list of up to 12 rows.
- Per-row UI is unchanged (name, meetings count, W/L, "last: round · event"). The *last* fields now reflect the most recent meeting **within the active window**, not lifetime.
- Empty window shows a message ("No opponents in this period") with the tab strip still visible so the user can switch back.
- Default tab on page load: **All Time** — no regression for users who just want lifetime numbers.

## Time anchor

Windows are measured relative to the **latest match in the dataset** (`maxIso`, the same anchor already used by `matchCharacter.matchesLast90`). Not `Date.now()`.

**Why:** values stay stable between index rebuilds, and quiet weekends don't slowly empty the 30-day tab. Consistent with the rest of the profile.

| Window | Cutoff (ms before `maxIso`) |
|---|---|
| 30d  | 30 × 86_400_000  |
| 90d  | 90 × 86_400_000  |
| 180d | 180 × 86_400_000 |
| 1y   | 365 × 86_400_000 |
| all  | `-Infinity` (no cutoff) |

Refs without a `scheduledDateIso` are excluded from windowed buckets but **included** in the `all` bucket — preserves today's behavior where lifetime totals don't drop matches just because their date is missing.

## Architecture

**Approach: precomputed buckets at index build time.** Same pattern used today for `recentForm`, `matchCharacter`, and the existing top-12 `opponents` list.

Alternatives rejected:
- *Ship raw meetings, filter client-side* — bigger payload (every meeting, not just survivors), reimplements aggregation in the browser, loses the bounded top-12 envelope.
- *On-demand API endpoint* — adds a spinner on every tab click for a millisecond computation, plus a new cached route to invalidate.

## Data shape

`lib/types.ts`:

```ts
export type OpponentTimeWindow = '30d' | '90d' | '180d' | '1y' | 'all'

export interface PlayerRecord {
  // ...existing fields unchanged...
  opponents: OpponentRecord[]                            // lifetime (= opponentsByWindow.all); KEPT for backward-compat
  opponentsByWindow?: Record<OpponentTimeWindow, OpponentRecord[]>
}

// PlayerIndex.version is left at 1 — opponentsByWindow is purely
// additive and optional, so no version gate is needed. Old indexes
// still load and degrade gracefully (see "Graceful degrade" below).
```

- `opponentsByWindow` is **optional** on `PlayerRecord` so previously-built indexes still load. The cache reader (`lib/player-index-cache.ts`) is unchanged.
- `OpponentRecord` shape itself is unchanged. Each window's rows carry that window's own `lastRound`/`lastEvent` (most recent meeting within the window).

## Build logic

Replaces the single aggregation pass at `lib/playerIndex.ts:526-546`.

1. Reuse the existing `nowMs` snapshot (`maxIso` of all refs).
2. Compute `cutoffMs[w]` for each window (see table above).
3. For each window `w`:
   a. Run the existing `oppMap` loop, but **skip** refs whose `Date.parse(scheduledDateIso)` is `NaN` or less than `cutoffMs[w]` — except the `all` bucket, which includes refs unconditionally (matches today).
   b. Sort by the existing comparator (`meetings desc, wins desc, slug asc`) and `.slice(0, 12)`.
4. Assign:
   ```ts
   rec.opponentsByWindow = byWindow
   rec.opponents = byWindow.all  // same array reference, preserves the existing field
   ```

**Cost:** five passes over `refs` instead of one. Each pass is O(refs.length); aggregate is small (most players have <500 refs). Build-time only — no runtime impact.

## Component changes

`components/PlayerProfileView.tsx`, replacing the existing `record.opponents.length > 0 && (…)` block (~line 336):

```tsx
const WINDOWS: Array<{ key: OpponentTimeWindow; labelKey: TKey }> = [
  { key: '30d',  labelKey: 'opponentsWin30d'  },
  { key: '90d',  labelKey: 'opponentsWin90d'  },
  { key: '180d', labelKey: 'opponentsWin180d' },
  { key: '1y',   labelKey: 'opponentsWin1y'   },
  { key: 'all',  labelKey: 'opponentsWinAll'  },
]

const [oppTab, setOppTab] = useState<OpponentTimeWindow>('all')

const oppList =
  record.opponentsByWindow?.[oppTab] ??
  (oppTab === 'all' ? record.opponents : [])

const hasAnyOpponents =
  (record.opponentsByWindow?.all.length ?? record.opponents.length) > 0

{hasAnyOpponents && (
  <div className="pp-section">
    <div className="pp-section-head">
      <h2>{t('frequentOpponents')}</h2>
      <div className="pp-time-tabs" role="tablist" aria-label={t('frequentOpponents')}>
        {WINDOWS.map(w => (
          <button
            key={w.key}
            role="tab"
            aria-selected={oppTab === w.key}
            className={`pp-time-tab${oppTab === w.key ? ' active' : ''}`}
            onClick={() => setOppTab(w.key)}
          >{t(w.labelKey)}</button>
        ))}
      </div>
    </div>
    {oppList.length > 0 ? (
      <div className="pp-ppl-list">
        {oppList.map(o => /* same Link row as today */)}
      </div>
    ) : (
      <div className="pp-empty">{t('opponentsEmptyWindow')}</div>
    )}
  </div>
)}
```

**Section visibility rule:** if the player has any opponents at all (lifetime), the section renders — even if the currently-selected window is empty. So a user who lands on All Time, sees opponents, and clicks 30 Days gets the empty message instead of a vanished section.

**Graceful degrade:** when `opponentsByWindow` is absent (stale v1 index):
- `all` tab → renders `record.opponents` as today
- other tabs → render empty-state

## i18n keys (new)

`lib/i18n.ts`:

| Key | EN | TH |
|---|---|---|
| `opponentsWin30d`      | 30 Days                     | 30 วัน |
| `opponentsWin90d`      | 90 Days                     | 90 วัน |
| `opponentsWin180d`    | 180 Days                    | 180 วัน |
| `opponentsWin1y`       | 1 Year                      | 1 ปี |
| `opponentsWinAll`      | All Time                    | ทั้งหมด |
| `opponentsEmptyWindow` | No opponents in this period | ไม่มีคู่ต่อสู้ในช่วงเวลานี้ |

Add the keys to both the `TKey` union and the EN/TH dictionaries.

## Styling

Add `.pp-time-tabs`, `.pp-time-tab`, `.pp-time-tab.active`, and `.pp-empty` to the stylesheet co-located with the rest of the `.pp-*` selectors (locate via grep on `.pp-section`). Visual treatment mirrors `.h2h-filter-tabs` / `.h2h-filter-tab.active` so the page feels cohesive. Tab strip uses `flex-wrap: wrap` so the five pills don't overflow on narrow viewports — they wrap below the heading.

## Edge cases

- **No `scheduledDateIso`** on a ref → excluded from windowed buckets, included in `all`. Documented behavior.
- **Empty index / `nowMs === 0`** → all windowed buckets empty, `all` bucket empty too. Section is hidden via the `hasAnyOpponents` guard. No tabs shown to a player with zero opponents.
- **Top-12 differs per window** — opponent #13 lifetime can be #1 in 30d. Intentional; that's the feature.
- **Stale v1 index** → graceful degrade as described. Production deploy needs an index rebuild (existing process — `npm run build` on the server already runs it; mentioned in `DEPLOY.md`).
- **Sorting stability** — keep the existing comparator for every window so ordering rules are consistent across tabs.

## Testing

- **Unit** (`__tests__/playerIndex.*` — check existing pattern):
  - Synthetic refs spanning 0-400 days back from `maxIso`: assert each bucket's contents (counts, W/L, lastRound, opponents-only-outside-window absent).
  - `rec.opponents` deep-equals `rec.opponentsByWindow.all` (note in test which one).
  - Refs missing `scheduledDateIso` excluded from windowed buckets, included in `all`.
- **Component** (`__tests__/PlayerProfileView.*` if existing pattern allows):
  - Default tab is `all`; renders the all-time list.
  - Clicking each tab updates `aria-selected` and swaps the rendered list.
  - Empty bucket → empty-state message renders, tab strip remains visible.
  - Legacy record (no `opponentsByWindow`) still renders all-time list on initial mount.

If those test files don't exist or use a different convention, add tests where they fit; don't create lone test files in a new style.

## Out of scope

- Same tabs for the *Frequent partners* section. Easy follow-up; deferred.
- URL query-string sync (`?window=30d`). Could be added later.
- "Filter by discipline within a window" combinator.
- Different anchor (real `Date.now()`).
- More windows (60d, 2y, etc.) — five is enough for now.

## Deployment

Standard flow per `DEPLOY.md`. The first deploy after merging must run the existing build step on the server (`npm run build`) so the index gets re-emitted in v2 format; until that's done, the page renders via the graceful-degrade fallback (All Time works, other tabs show empty).

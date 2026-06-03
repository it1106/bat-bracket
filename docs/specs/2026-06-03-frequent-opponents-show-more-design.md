# Frequent Opponents — Collapse to Top 10 with Show More

**Date:** 2026-06-03
**Status:** Approved
**Surface:** Player profile page — Frequent opponents section
**Builds on:** `2026-06-03-frequent-opponents-time-filter-design.md`

## Summary

Collapse the Frequent opponents list to top 10 per window with a "Show more" / "Show less" toggle that reveals the full top 25. Reset to collapsed state on tab switch. Mirrors the existing leaderboards show-more affordance.

## Motivation

The opponents section currently shows up to 12 rows per window — too long for a profile glance, and the 12-cap is also a weak ceiling for power users who want to see the deeper list. Collapsing to 10 by default makes the section scannable, and bumping the data cap to 25 gives "Show more" something meaningful to reveal.

## Changes

### Data layer — `lib/playerIndex.ts`

`buildOpponentsByWindow` currently slices each per-window bucket to top 12. Bump to top 25:

```ts
.slice(0, 25)
```

The comparator stays identical (`meetings desc, wins desc, slug asc`).

### View — `components/PlayerProfileView.tsx`

Add state and a toggle inside the existing Frequent opponents IIFE block:

```tsx
const [oppExpanded, setOppExpanded] = useState(false)
const COLLAPSED_LIMIT = 10

const visibleList = oppExpanded ? list : list.slice(0, COLLAPSED_LIMIT)
const hasMore = list.length > COLLAPSED_LIMIT
```

The map iterates `visibleList`. Below the list, render a Show-more button when `hasMore`:

```tsx
{hasMore && (
  <button
    type="button"
    className="pp-show-more"
    onClick={() => setOppExpanded(v => !v)}
  >{oppExpanded ? t('leaderboardsShowLess') : t('leaderboardsShowMore')}</button>
)}
```

### Tab-switch reset

The existing `setOppTab(w.key)` click handler also resets the expanded state:

```tsx
onClick={() => { setOppTab(w.key); setOppExpanded(false) }}
```

Explicit reset; no `useEffect` deduction. Switching back to a previously-expanded tab starts collapsed — matches user's "Reset on tab switch" decision.

### i18n

Reuse existing keys — no new entries:
- `leaderboardsShowMore` — EN: "Show more", TH: "ดูเพิ่มเติม"
- `leaderboardsShowLess` — EN: "Show less", TH: "ย่อ"

### CSS — `app/globals.css`

Add one rule in the `.pp-*` block:

```css
.pp-show-more { display: block; margin: 10px auto 0; padding: 4px 12px;
  background: transparent; border: none; cursor: pointer;
  font-size: 12px; font-weight: 600; color: var(--brand-fg);
  letter-spacing: 0.03em; }
.pp-show-more:hover { text-decoration: underline; }
```

Text-link aesthetic — centered, muted accent color. Avoids competing visually with the tab pills above.

## Edge cases

- **Bucket has ≤10 rows** — render all, no button. Behavior unchanged for sparse players.
- **Bucket has 11-25 rows** — collapsed by default; button reveals the rest.
- **Stale index (no `opponentsByWindow`)** — `record.opponents` is still capped at 25 (since same helper computes it). Existing v1 indexes won't have the new cap until rebuild — they keep showing up to 12. The first deploy will trigger boot rebuild (verified earlier today), so this resolves within seconds.
- **Switching tabs while expanded** — explicit reset on click. User starts at 10 in the new tab.

## Tests

### Unit (`__tests__/playerIndex.opponentsByWindow.test.ts`)

Update the existing "caps at top 12" test to assert top 25. Synthetic input becomes 30 opponents (was 20); assert bucket length 25 and that `p00` … `p24` are present in `meetings desc` order.

### Component (`__tests__/PlayerProfileView.test.tsx`)

Two new cases:
- A record with 15 opponents in `all` bucket: renders 10 by default; Show-more button visible; clicking renders all 15.
- A record with 8 opponents: renders all 8; no Show-more button in the DOM.

## Out of scope

- Frequent Partners section. Cap stays at 12; no show-more. Separate request.
- Persisting the expanded state across tab switches (explicitly opt-out per design Q&A).
- URL-state for `?expand=opp` or similar.

## Deployment

Same flow as the parent feature. The boot-time `rebuildAll` in `instrumentation.ts` re-emits the index on every restart, so the top-25 buckets populate immediately after PM2 reload.

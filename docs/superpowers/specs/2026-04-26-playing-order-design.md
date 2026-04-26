# Playing-Order Indicator on Match Schedule — Design Spec

**Date:** 2026-04-26
**Branch:** `playing-order`
**Status:** Draft — awaiting review

## Summary

Add a small "queue position" pill to each upcoming `.ms-match` in the Match Schedule, telling the spectator how many matches must play before this one. The count is **whole-day**: it anchors on the latest now-playing match (or, if none is live, the latest completed match) and walks forward through the day's listed match order, ignoring matches that don't represent real play (live matches themselves, completed stragglers, walkovers).

The first eligible match after the anchor reads `Up next` (amber pill); subsequent matches read `2 away`, `3 away`, … (gray pills). The feature is purely a render-time decoration — no data-model changes, no backend work, no `app/page.tsx` changes.

## 1. User-facing behavior

- **Target.** Every match in the currently selected day that:
  - has no winner (`winner === null`), AND
  - is not itself currently playing (no LIVE badge / `nowPlaying` dot), AND
  - is not a walkover (`walkover === false`).
- **Pill text.**
  - Position 1 → `Up next` / `ถัดไป` (amber pill, `var(--warning)` background, dark text).
  - Position N ≥ 2 → `N away` / `อีก N แมตช์` (gray pill, `var(--bg-tertiary)`-equivalent background, foreground text).
- **Placement.** Pill is a single `<span>` rendered as the last child of the existing `.ms-meta` element. The flex cascade handles both layouts:
  - **Desktop** (≥ 901 px): `.ms-meta` is `flex-direction: column`, so the pill stacks below the existing court / now-playing line, matching mockup A.
  - **Mobile** (≤ 900 px): `.ms-meta` is `flex-direction: row`, so the same pill flows inline at the end of the meta row, after the H2H button if present.
- **No anchor available.** If the day has no live matches *and* no completed matches, no pills render anywhere.
- **Live and completed matches.** Already-rendered indicators (LIVE badge, green `nowPlaying` dot, `🥇`/`🏸` winner medals) are unchanged. The pill is additive and never appears on a live or completed row.

## 2. Anchor selection

Walk the day's matches in display order — a flat sequence built by concatenating `groups[i].matches[*]`, in the order returned by the scraper. The flat order matches what the user sees on screen.

Pick the anchor index by these rules, in order:

1. If any match in the flat list is currently playing — i.e., `m.nowPlaying === true` **or** `liveByCourt` resolves a live entry for it via `matchLiveCourt(m, liveByCourt)` — then `anchorIdx` = the **highest** such index.
2. Else, if any match has a non-null `winner` (excluding walkovers, since they didn't physically play) — then `anchorIdx` = the **highest** such index.
3. Else — no anchor; the function returns an empty result and no pills are rendered anywhere.

"Currently playing" is detected with the same `isLive` logic the existing render path already uses (`live = liveByCourt ? matchLiveCourt(m, liveByCourt) : null; isLive = live !== null`), OR-ed with the scraper's `m.nowPlaying`. This matches the LIVE-badge/now-dot rendering rule already in `MatchSchedule.tsx`, so the visual state and the anchor agree.

## 3. Counting algorithm

After picking `anchorIdx`, walk forward `i = anchorIdx + 1 … flat.length - 1`:

- If `flat[i]` is currently playing (same `isLive || nowPlaying` check) → **skip**, no pill on it. (It's live, not queued.)
- Else if `flat[i].winner !== null` → **skip**, no pill on it. (Completed straggler from a court running ahead of others.)
- Else if `flat[i].walkover === true` → **skip**, no pill on it. (Walkovers don't consume a queue position.)
- Otherwise → assign `position = position + 1` (where `position` starts at 0), record `flat[i] → position`, and render the pill on that row.

Return value is a `Map<string, number>` keyed by a stable per-match key (`${gi}-${mi}`, matching the convention `useFirstUnplayed` already uses) with values 1, 2, 3, ….

## 4. Architecture

One new pure module, one new test file, one component touched, CSS additions, two i18n keys.

### `lib/playingOrder.ts` (new)

Exports a single pure function:

```ts
export interface PlayingOrderInputs {
  groups: MatchScheduleGroup[]
  liveByCourt: LiveByCourt | null
}

/**
 * Returns a Map<matchKey, queuePosition> where matchKey = `${gi}-${mi}`
 * and queuePosition is 1-based. Matches not in the map get no pill.
 */
export function computePlayingOrder(
  inputs: PlayingOrderInputs,
): Map<string, number>
```

- Pure, no React, no DOM. Unit-testable in isolation.
- Re-uses the project's existing `matchLiveCourt` helper to detect live state, so live detection stays consistent with rendering.
- Walks `groups` once; O(N) where N = total matches in the day.
- Returns an empty map when no anchor exists.

### `__tests__/playingOrder.test.ts` (new)

See §6 for test cases.

### `components/MatchSchedule.tsx` (modified)

Two minimal additions:

1. Near the top of the component (alongside the existing `useFirstUnplayed` hook call):
   ```ts
   const playingOrder = useMemo(
     () => computePlayingOrder({ groups, liveByCourt }),
     [groups, liveByCourt],
   )
   ```
2. Inside `renderMatch(m, mi, gi, showCourt)` (the `gi` parameter is already added by the fast-forward feature), compute `const position = playingOrder.get(\`${gi}-${mi}\`) ?? null` and render the pill as a direct child of the existing `<div className="ms-meta">`, placed at the end of the meta children (after the H2H button).
   - On desktop, `.ms-meta` is `flex-direction: column`, so the pill stacks below the court/now-playing line as its own visual row.
   - On mobile (≤ 900 px), `.ms-meta` flips to `flex-direction: row`, so the same pill flows inline at the end of the meta row. No additional wrapper or markup branch is needed; the pill is a single span and the existing flex cascade handles both layouts.

The pill JSX is:

```tsx
{position !== null && (
  <span className={`ms-order-pill${position === 1 ? ' ms-order-pill--next' : ''}`}>
    {position === 1
      ? t('playingOrderNext')
      : t('playingOrderAway').replace('{n}', String(position))}
  </span>
)}
```

The project's `t(key)` helper (`lib/i18n.ts:257` `translate(key, lang)`, exposed via `useLanguage().t`) returns a plain string with no parameter substitution, so `{n}` is replaced inline at the call site.

No prop changes. `app/page.tsx` is untouched.

### `app/globals.css` (modified)

The existing `:root` and `html.dark` blocks (top of `globals.css`, ~lines 10–47) gain four new design tokens, paired light/dark:

| Token | Light | Dark |
| --- | --- | --- |
| `--order-pill-bg` | `#eef2f6` | `rgba(125, 133, 144, 0.18)` |
| `--order-pill-fg` | `--fg` (inherit) | `--fg` (inherit) |
| `--order-pill-next-bg` | `#f59e0b` | `#d29922` |
| `--order-pill-next-fg` | `#1a1a1a` | `#0d1117` |

(Final hex values are illustrative — the dark-mode amber follows the `--track-fg` palette already in use, the dark-mode gray follows `--muted` at low alpha. Light values track the existing neutral palette; an implementer may swap them for closer-existing tokens during implementation.)

New rules co-located with the existing `.ms-meta` block:

```css
.ms-order-pill {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--order-pill-bg);
  color: var(--order-pill-fg);
  white-space: nowrap;
  flex-shrink: 0;
}
.ms-order-pill--next {
  background: var(--order-pill-next-bg);
  color: var(--order-pill-next-fg);
}
```

No animation. The pill inherits all transitions from the surrounding meta cell.

### `lib/i18n.ts` (modified)

Add two keys to the `TKey` union (alongside the existing `'jumpToNext'`, `'winRate'`, etc. at lines 127–128) and to both the `en` and `th` dictionaries:

| Key | English | Thai |
| --- | --- | --- |
| `playingOrderNext` | `Up next` | `ถัดไป` |
| `playingOrderAway` | `{n} away` | `อีก {n} แมตช์` |

The `{n}` token is a literal placeholder substituted at the call site (the `t` helper does not interpolate). The TypeScript union enforces both locales contain both keys.

## 5. Edge cases and behaviors

- **Live match anchor disappears.** When the SignalR live state retracts (the live match finishes and `liveByCourt` no longer resolves it), the next render recomputes with the new state. If `m.nowPlaying` from the scraped HTML still says it's live, rule (1) still applies; if both signals say it's done, rule (2) takes over and the same match becomes the completed-anchor. Pills shift forward by one accordingly.
- **Multiple live matches at once.** Common — every court in play has a live match. The anchor is the highest-index live match (the one furthest down the displayed day). All other live matches keep their LIVE badge but get no pill. Matches between earlier live matches and the anchor are *behind* the anchor and get no pill either, by construction (the loop only walks forward from `anchorIdx + 1`).
- **A completed straggler appears after the live anchor.** Court 4 finished its first three matches before Court 1 finished its first; the listed order shows Court 4's third match after Court 1's first (which is now live). Court 4's third match is then "after the anchor" but already has a winner — rule (skip on `winner !== null`) fires and it gets no pill; positions advance only on the unplayed rows.
- **Walkovers in the queue.** Skipped from positions, no pill, but otherwise rendered as today (with the walkover badge on the losing team's row).
- **Player-search filter active.** The filter hides rows from view but does *not* affect the anchor or position numbers — those are computed against the full day's data, so a hidden row "between" two visible rows still consumes a position. Rationale: numbers stay stable as the user types/clears the filter, matching what they'd see on a venue scoreboard.
- **Day-tab switch.** Switching days re-renders with new `groups`; `useMemo` recomputes; pills update to the new day's anchor and queue.
- **No matches in the day.** `groups` is empty; the function returns an empty map; nothing renders. Same outcome as no-anchor.
- **The match selected by the existing fast-forward target.** No interaction. The fast-forward target may or may not also have a position pill — both are independent decorations.
- **Tracked-match highlight.** `.ms-match--tracked` background still applies; the pill sits on top of it without restyling.
- **Reduced motion.** No animations are introduced by this feature, so `prefers-reduced-motion` is a no-op.

## 6. Testing

### Unit — `__tests__/playingOrder.test.ts` (new)

- Returns an empty map for empty `groups`.
- Returns an empty map when no match is live and no match has a winner (start of day).
- Picks the **highest-index** live match as the anchor when multiple matches are live (across courts).
- Falls back to the highest-index completed match when no match is live.
- Skips matches that are themselves live; their pills are absent and they don't consume a position.
- Skips already-completed stragglers after the anchor; they don't consume a position.
- Skips walkovers; they don't consume a position.
- Detects "live" via `liveByCourt` (SignalR) when `nowPlaying` is `false` — a live match found via the live signal anchors correctly.
- Detects "live" via `m.nowPlaying` when `liveByCourt` is `null`.
- Position numbering is contiguous (1, 2, 3, …) regardless of how many rows were skipped between eligible ones.
- Works for both `type: 'time'` and `type: 'court'` groupings.

### Component — extending `__tests__/MatchSchedule.live.test.tsx` (or a sibling file)

- Renders `Up next` text on the first eligible row after the anchor.
- Renders `N away` text with the correct number on subsequent eligible rows.
- Renders no pill on live, completed, or walkover rows.
- Renders no pill anywhere when no anchor exists.
- Pill text honors locale switch (`en` → `Up next`, `th` → `ถัดไป`).
- Pill receives `.ms-order-pill--next` modifier only on position 1.

### Manual verification (noted in plan, not automated)

- Visual fidelity matches mockup A on desktop and on mobile (≤ 900 px).
- Dark mode contrast for both the gray and amber pills is acceptable.
- Pill does not push the meta column wider than 150 px on desktop (the grid column is fixed-width — confirm pill text doesn't overflow with long Thai strings).
- Pill repositions correctly as live state ticks in/out via SignalR.

## 7. Out of scope

- Per-court countdowns (whole-day was explicitly chosen).
- ETA in minutes — the pill shows position only, not predicted start time.
- Any change to the LIVE badge, `nowPlaying` dot, walkover badge, or winner medal.
- Cross-day reasoning (e.g., "Up next for tomorrow").
- A "you" / "your match" pill variant tied to the player-search filter — out of scope for v1; current pill is identical for all viewers.

## 8. Rollout

Single-branch, single-PR change on `playing-order`. No feature flag — additive and fails closed: when `computePlayingOrder` returns an empty map (no anchor, no eligible matches, etc.), no pill ever renders and the schedule looks identical to today.

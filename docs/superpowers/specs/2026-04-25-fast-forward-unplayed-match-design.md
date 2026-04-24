# Fast-Forward to First Unplayed Match — Design Spec

**Date:** 2026-04-25
**Branch:** `live-score` (likely to branch off for implementation)
**Status:** Draft — awaiting review

## Summary

Add a floating "jump to next" control to the Match Schedule that scrolls the user to the first unplayed match on the currently selected day. Use case: a spectator at the venue has scrolled past finished matches and wants to skip ahead to what is happening now or up next. The button is a small, self-contained UI affordance that appears only when the target match is off-screen and disappears once the user has scrolled it into view.

The feature is encapsulated inside `components/MatchSchedule.tsx`; no prop changes reach `app/page.tsx`, so both the default Match Schedule tab and the Live Matches tab (which re-uses the same component) inherit it automatically.

## 1. User-facing behavior

- **Trigger.** A fixed floating button, bottom-right of the viewport. Label is an i18n-aware short string (`t('jumpToNext')`, rendered as e.g. "Next match ↓" in English).
- **Visibility.** The button is visible only when:
  1. The selected day has at least one unplayed match (respecting the active player-search filter), AND
  2. The target unplayed match is **not** currently intersecting the viewport.

  When the user scrolls the target into view, the button disappears. When they scroll away from it, it reappears. If the current day has no unplayed matches remaining, the button never shows.
- **On tap.** The target match is smooth-scrolled into the middle of the viewport, and the target's `.ms-match` row plays a short background-color pulse (~1.2 s) so the eye catches it.
- **Repeat taps.** Replay the flash animation every time. Scroll is a no-op if the target is already centered.
- **Player filter interaction.** When the player-search filter is active, the target is the first unplayed match among filtered results. The filter and the fast-forward compose naturally, answering "when is player X next playing?".
- **Day scope.** The feature operates within the currently selected day only. If today's matches are all finished, the button stays hidden — no cross-day jump in v1.
- **Reduced motion.** When `prefers-reduced-motion: reduce` is set, the smooth scroll becomes an instant jump and the flash animation is suppressed.

## 2. Target definition

A match qualifies as the "first unplayed" target when, walking `groups` in display order, it is the first `MatchEntry` satisfying:

- `matchesQuery(entry, playerQuery, clubMap)` returns `true` (the same filter used by `MatchSchedule`'s render loop), AND
- `winner === null`, AND
- `walkover === false`.

Live and `nowPlaying` matches have `winner === null` in the schedule data, so they naturally qualify — this matches the spectator use case ("land on whatever is most interesting right now"). Walkovers are excluded defensively; in practice they carry a `winner`, but guarding on the flag avoids a data-quirk treating a walkover as "next".

Display order matches what the user sees: when `groups` are time-grouped (typical), first = earliest time slot's first match; when court-grouped, first = first court's first match.

## 3. Architecture

Three new artifacts, one component modified:

### `lib/useFirstUnplayed.ts` (new)

Exports one pure function and one React hook.

```ts
export function findFirstUnplayed(
  groups: MatchScheduleGroup[],
  playerQuery: string,
  clubMap?: Record<string, string>,
): { gi: number; mi: number } | null

export function useFirstUnplayed(
  groups: MatchScheduleGroup[],
  playerQuery: string,
  clubMap?: Record<string, string>,
): {
  targetKey: string | null
  registerTargetRef: (el: HTMLElement | null) => void
  isTargetInView: boolean
  scrollToTarget: () => void
}
```

- `findFirstUnplayed` is a pure walk over `groups.flatMap(g => g.matches)` with the predicates in §2. No DOM, no React. Unit-testable in isolation.
- `useFirstUnplayed` computes `targetKey = \`${gi}-${mi}\`` (or `null`) on every render — the input size is small.
- `registerTargetRef` is a stable callback that stores the DOM node in a ref. On every change of either the stored node or `targetKey`, the hook tears down the previous `IntersectionObserver` and creates a new one on the new node with the default root/viewport.
- `isTargetInView` starts `true` (pessimistic: button hidden on mount until the observer has reported at least once) and updates on each observer callback. When `targetKey` is `null`, it stays `true`.
- `scrollToTarget` calls `el.scrollIntoView({ behavior: 'smooth', block: 'center' })` (or `'auto'` for reduced-motion), then toggles `.ms-jump-flash` on the element using the same `remove → force reflow → add` trick that `LiveScore` uses, so repeat taps replay the animation.

### `components/JumpToNextButton.tsx` (new)

```tsx
interface Props {
  visible: boolean
  onClick: () => void
}
```

- Stateless. Returns `null` when `!visible` (so no tab stop is present when hidden).
- Fixed position, bottom-right, above any existing bottom UI. Styled via a new `ms-jump-next` CSS class. Small pill, rounded, high-contrast; a brief fade/slide-in transition when becoming visible.
- Label is pulled via the existing `useLanguage().t('jumpToNext')`. New i18n key added to `lib/i18n.ts` for English and Thai.
- `<button type="button">` with `aria-label` tied to the i18n string. No custom keyboard handling — native button semantics.

### `components/MatchSchedule.tsx` (modified)

Changes, in order inside the component body:

1. Call the hook near the top:
   ```ts
   const { targetKey, registerTargetRef, isTargetInView, scrollToTarget } =
     useFirstUnplayed(groups, playerQuery, playerClubMap)
   ```
2. `renderMatch(m, mi, showCourt)` gains a `gi: number` parameter so it can build `\`${gi}-${mi}\`` and compare to `targetKey`.
3. On the root `<div className="ms-match">`, the existing `key={mi}` becomes `key={\`${gi}-${mi}\`}` to remain unique across groups, and a conditional `ref={isTarget ? registerTargetRef : undefined}` is attached where `isTarget = \`${gi}-${mi}\` === targetKey`.
4. At the end of the component's return, render:
   ```tsx
   <JumpToNextButton
     visible={targetKey !== null && !isTargetInView}
     onClick={scrollToTarget}
   />
   ```

No prop changes. `app/page.tsx` is untouched; both `MatchSchedule` instances it renders (the default schedule at line 590 and the Live Matches tab at line 607) inherit the feature.

### `app/globals.css` (or co-located stylesheet — confirmed during implementation)

Two additions:

- `.ms-jump-next` — fixed positioning, pill styling, a `transform: translateY(...)` + `opacity` transition for the appear/disappear animation.
- `.ms-jump-flash` — a ~1.2 s background-color keyframe animation on `.ms-match`. Guard both behaviors with an `@media (prefers-reduced-motion: reduce)` block that disables the transition and the keyframe animation.

### `lib/i18n.ts` (modified)

Add `jumpToNext` key for the `en` and `th` dictionaries. Copy TBD at implementation time (suggested English: "Next match ↓").

## 4. Edge cases and behaviors

- **Target unmounts mid-session.** When the user types into the player filter and the matched target row leaves the DOM, the stored ref node goes null; the hook disconnects the old observer, finds a new target (or none), and either re-registers or hides the button. This happens on the next render — no explicit cleanup needed beyond the observer teardown.
- **Target already on-screen at first render.** On mount, `isTargetInView` is `true`; the observer's first callback (synchronous after registration) confirms this and the button stays hidden. If the target is partially or fully outside the viewport, the same callback flips the state and the button appears.
- **Day-tab switch.** Switching days re-renders `MatchSchedule` with a new `groups` array, a new target is computed, the old ref node is gone, and the hook re-registers.
- **Live-score updates.** A live-score push does not alter `winner`, so the target identity is stable across ticks. The `.ms-jump-flash` class lives on `.ms-match` while `.is-flashing` (the score flash) lives on inner score spans — they animate independently without collision.
- **Multiple `MatchSchedule` instances in the DOM.** Both the default and Live Matches tab render a `MatchSchedule`, but only one is visible at a time (the other's parent is unmounted or `display: none`). If both were ever mounted at once, both would compute their own target and render their own floating button — acceptable because only one is interactive.
- **Mobile safe-area.** `.ms-jump-next` uses `env(safe-area-inset-bottom)` in its `bottom` spacing so it clears the iOS home indicator.

## 5. Out of scope

- Cross-day jump (when current day is fully played). Deferred; the button simply hides.
- Smart labels on the button ("3 matches until target", "Live now ↓", etc.). A single static label.
- Auto-scroll on page load. Explicit user tap only.
- Collapsing completed time groups above the target. The target is scrolled into view; finished matches remain visible above it.
- Any change to `page.tsx` logic, tournament scraping, or data model.

## 6. Testing

### Unit — `__tests__/findFirstUnplayed.test.ts` (new)

- Returns `null` for empty `groups`.
- Returns `null` when every match has a non-null `winner`.
- Returns the first `winner === null` match across multiple time groups (validates walking order).
- Skips walkover rows even if `winner === null`.
- When `playerQuery` is active, returns the first unplayed match **among filtered results**, not the first unplayed overall.
- Player-name filter and club-via-`clubMap` filter both work.
- Works for `type: 'time'` and `type: 'court'` groupings.
- A live/`nowPlaying` match with `winner === null` is a valid target (spectator spec).

### Component — extending `__tests__/MatchSchedule.live.test.tsx` (or a sibling file)

- Button is not rendered when there are no unplayed matches.
- Button renders when an unplayed match exists and the mocked `IntersectionObserver` reports `isIntersecting: false` for the target.
- Button hides when the observer reports `isIntersecting: true`.
- Clicking the button calls `scrollIntoView` on the target element (spied).
- Clicking the button adds `ms-jump-flash` to the target element.
- Switching the player filter to a non-matching query hides the button (no target).

### Manual verification (noted in plan, not automated)

- Reduced-motion disables smooth scroll and flash.
- On mobile, the floating button clears the iOS home indicator.
- Flash animation replays on repeat taps.
- Button does not obscure the H2H or player-profile modals when either is open (if it does, raise/lower `z-index` accordingly).

## 7. Rollout

Single-branch, single-PR change. No feature flag — the feature is additive and fails closed (when no unplayed match exists or when `IntersectionObserver` is unsupported, the button simply never shows).

`IntersectionObserver` is supported by all target browsers (Next.js `browserslist` defaults cover it). No polyfill added.

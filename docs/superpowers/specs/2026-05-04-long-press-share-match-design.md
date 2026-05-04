# Long-press a match row to share as image

## Problem

Mobile users (often courtside) want to send a match's score and context to a friend via LINE/Messages/Photos. Today the only way is to take a screenshot, crop it, and share — three steps. There's no per-match share affordance.

## Goal

On mobile, long-pressing a `.ms-match` row produces a branded image of just that match and opens the system share sheet, ready for one-tap sending.

## Scope

- **In:** mobile only (touch devices). One match row at a time.
- **Out:** desktop gesture (right-click, mouse hold). Sharing arbitrary subsets of the schedule. Sharing brackets (already covered by `ExportButton`). Custom share-optimised layouts (future).

## User flow

1. User holds a finger on a match row for ~500ms.
2. The row gently scales down (`scale(0.98)`) during the hold to confirm the gesture is registering.
3. At 500ms, the device vibrates briefly and the system share sheet opens with a generated JPEG attached.
4. User picks a destination (LINE, Photos, Messages, …) and the image is sent.
5. If the user releases before 500ms, the row snaps back and the existing tap behaviour (lock-toggle) runs unchanged.

## Architecture

Two new modules plus minimal wiring in `MatchSchedule.tsx`:

| Module | Responsibility |
| --- | --- |
| `lib/useLongPressShare.ts` | React hook. Detects long-press on a ref'd element. Manages press feedback class, timer, scroll-cancellation, click suppression. Calls `onFire` callback. |
| `lib/shareMatchAsImage.ts` | Pure async function. Clones the match element off-screen, strips highlights, injects a branded header, renders to JPEG via `html-to-image`, opens share sheet (or falls back to download). |
| `components/MatchSchedule.tsx` | Wires the hook to each rendered row. Adds one prop (`tournamentName`). |
| `app/globals.css` | Adds `.ms-match--pressing` scale animation and `user-select: none` on `.ms-match`. |

The capture flow mirrors the existing pattern in `components/ExportButton.tsx` (force light mode, reset transforms, capture, restore in `finally`).

## Component contracts

### `lib/useLongPressShare.ts`

```ts
interface UseLongPressShareOptions {
  onFire: () => void
  holdMs?: number          // default 500
  moveSlopPx?: number      // default 10
  pressClass?: string      // default 'ms-match--pressing'
}

export function useLongPressShare(
  ref: React.RefObject<HTMLElement>,
  options: UseLongPressShareOptions,
): void
```

**State machine:**

```
idle ──touchstart──▶ pressing ──holdMs──▶ fired
                       │ │ │
                       │ │ └─touchcancel──▶ idle
                       │ └───touchmove>slop─▶ idle
                       └─────touchend before holdMs─▶ idle
```

**Behaviour:**
- On `touchstart`: add `pressClass` to the element, start timer, record start Y coordinate.
- On `touchmove`: if `|currentY - startY| > moveSlopPx`, cancel.
- On `touchend` / `touchcancel`: clear timer, remove `pressClass`. If timer fired, suppress the next `click` event on the element (capture phase, one-shot).
- On timer fire: remove `pressClass`, `navigator.vibrate?.(15)`, call `onFire()`, arm click-suppression.
- On `contextmenu`: `preventDefault()` (suppresses iOS Safari's native long-press menu).
- Mouse events are not handled — no-op on desktop.
- All listeners and timers cleaned up on unmount and on ref change.

### `lib/shareMatchAsImage.ts`

```ts
interface ShareMatchOptions {
  matchEl: HTMLElement
  tournamentName: string
  eventName: string
}

export async function shareMatchAsImage(opts: ShareMatchOptions): Promise<void>
```

**Sequence:**

1. Snapshot existing state for restore: `<html>.dark` class, in case we need to flip it.
2. Force light mode: remove `dark` class from `<html>` if present.
3. Build off-screen wrapper:
   ```
   position: fixed; left: -9999px; top: 0; width: 380px;
   background: #fff; font-family: 'Segoe UI', system-ui, sans-serif;
   ```
4. Inject branded header (same content as `ExportButton.tsx:43-51`, ~16px wordmark instead of 20px): "BAT Unofficial Scores" wordmark, "Check BAT official website for accuracy" disclaimer, tournament name, event name, export timestamp.
5. Clone `matchEl` with `cloneNode(true)`. On the clone, remove classes: `ms-match--active`, `ms-match--next-opp`, `ms-match--tracked`, `ms-match--pressing`. On all descendants, remove `ms-player-highlight`.
6. Append clone to wrapper, wrapper to `document.body`.
7. Wait two `requestAnimationFrame`s.
8. `toJpeg(wrapper, { quality: 0.95, pixelRatio: 2, backgroundColor: '#ffffff' })`.
9. Convert dataURL → Blob → File (`image/jpeg`).
10. Filename: `${slug(tournamentName)}-${slug(eventName)}-${timestamp}.jpg`, where `timestamp` is `Date.now()`. Length-capped at 80 chars total.
11. If `navigator.canShare?.({ files: [file] })`: `await navigator.share({ files: [file], title, text })`.
12. Else: download fallback via `<a download>` click (same pattern as `ExportButton.tsx:89-92`).
13. `finally`: remove wrapper from DOM, restore `dark` class.

**Errors:**
- `AbortError` from `navigator.share` (user cancelled): swallow.
- Any other share rejection: fall through to download fallback.
- `toJpeg` throws: `console.warn` and return. The codebase has no toast infrastructure, and this is a convenience gesture — silent failure plus a console log is acceptable. Live row is untouched (we cloned), so no visual recovery needed beyond `finally`.

### `MatchSchedule.tsx` integration

**New prop:**
```ts
tournamentName?: string   // human-readable, for share image header
```

**Inside `renderMatch`:**
- Create a row-scoped `useRef<HTMLDivElement>(null)`.
- Merge it with the existing conditional `registerTargetRef` via a small `mergeRefs` helper or callback ref.
- Call `useLongPressShare(rowRef, { onFire: () => { ... } })`.
- `onFire` calls `shareMatchAsImage` and emits `track('match_shared_as_image', {...})` analytics.
- Existing `onClick`, `onMouseEnter`, `onMouseLeave` are unchanged.

The hook is invoked inside `renderMatch`, which means one hook per rendered match. This is fine — `renderMatch` is called from a `.map` and the call order is stable per render. (Alternatively the hook could be lifted; this is simpler and the row component is short enough.)

### CSS additions (`app/globals.css`)

Add near the existing `.ms-match` rules:

```css
.ms-match {
  /* existing rules unchanged */
  transition: transform 180ms ease-out;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

.ms-match--pressing {
  transform: scale(0.98);
  transition: transform 480ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .ms-match--pressing { transform: none; }
}
```

## Captured image content

- Branded header: BAT wordmark, disclaimer, tournament name, event name (`m.draw`), export timestamp.
- Cloned match row: meta column (event/round/court/badges/order pill), team names, scores. The mobile `.ms-board` block is part of the clone and renders normally because the wrapper is narrower than 900px.
- Stripped: lock highlight, next-opp tint, tracked highlight, player search highlight, hover background.
- Light mode regardless of app theme.

## Analytics

One new event:

```ts
track('match_shared_as_image', {
  tournament_id,
  match_id,
  round_name,
  draw_id,
})
```

Same shape as the existing `match_viewed` event in `MatchSchedule.tsx:122`.

## Internationalisation

No new translated strings. The branded header reuses the existing English copy from `ExportButton.tsx` (the bracket export uses the same English copy regardless of app language). Failure handling is a silent `console.warn`.

## Browser support

- iOS Safari 15.4+ supports Web Share API with files — primary target.
- Android Chrome supports it broadly — primary target.
- Older iOS / unsupported browsers fall through to download. Downloads on iOS Safari go to Files (not Photos), but that's still a usable share path.
- Desktop is untouched.

## Testing

**Unit tests** (`__tests__/useLongPressShare.test.ts`):
- 500ms hold fires `onFire`.
- Release before 500ms does not fire.
- `touchmove` >10px does not fire.
- `touchcancel` does not fire.
- Synthetic click after fire is suppressed once, then normal clicks pass.
- Listeners and timer cleaned up on unmount.

Implemented with `@testing-library/react` and `jest.useFakeTimers()`. Synthesise touch events by dispatching `TouchEvent`-shaped objects.

**Unit tests** (`__tests__/shareMatchAsImage.test.ts`):
- Mocks `html-to-image`'s `toJpeg` and `navigator.share` / `navigator.canShare`.
- Dark mode is removed before `toJpeg` is called and restored after.
- Highlight classes are stripped on the cloned row; the original passed-in element is untouched.
- When `navigator.canShare` returns false, the download fallback runs.
- `AbortError` from `navigator.share` is swallowed.
- Wrapper is removed from `document.body` even when `toJpeg` throws.

**Manual test checklist** (verified during implementation):
- iOS Safari 15.4+: long-press fires share sheet; saving to Photos works.
- Android Chrome: long-press fires share sheet; sharing to LINE works.
- Desktop: long-press is a no-op; click-to-lock and hover-to-highlight unchanged.
- Scrolling the page over a match row does not trigger capture.
- Tapping a player name still navigates / opens player detail.
- Tapping the H2H button still opens H2H.
- Dark mode app theme still produces a light-themed shared image.
- Captured image strips lock/next-opp/tracked/search highlights.
- `prefers-reduced-motion` disables the press animation.

We do **not** test:
- The actual rendered pixels (jsdom can't run canvas).
- The CSS animation visually.
- Cross-browser share-sheet variants.

## Out of scope (future)

- Custom share-optimised layout (bigger fonts, square aspect, background graphic).
- Sharing multiple matches at once.
- Desktop right-click → share.
- Per-language share text in the share sheet body.

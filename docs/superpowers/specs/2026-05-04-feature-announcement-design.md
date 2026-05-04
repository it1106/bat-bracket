# Feature Announcement Banner — Design

A one-time inline banner at the top of the page promoting the new multi-tab Custom search feature. Generic enough to be reused for future announcements.

## Background

The multi-tab Custom search just shipped. Existing users won't discover it on their own — the `+` button next to the Live tab is easy to miss. We want a small, dismissible banner that runs once per browser to point them at it.

The same primitive will likely be useful for future feature announcements, so the storage layer is generic from day one (matches Q6 = A).

## Goals

- One-time inline banner shown to every browser visiting the app, dismissible per-browser.
- Banner displays only after a tournament is selected (so it lands when the tab strip is visible).
- Body text is hardcoded Thai regardless of the active language.
- Reusable: future announcements get a new id and text without code changes to the banner component.

## Non-Goals

- Multi-language announcement bodies (Q4 explicitly chose Thai-only for this one).
- Auto-dismiss / timed fade.
- Multiple simultaneous announcements (the system supports it by id, but there's only one banner rendered).
- "Try it now" CTA buttons that open modals.
- Reset / un-dismiss UI for users (manual via devtools only).

## User Flow

1. User visits the app for the first time after the deploy. Toolbar appears, no tabs yet (no tournament selected). No banner.
2. User picks a tournament. The tab strip renders. The banner appears at the top with the Thai announcement text and a small `✕`.
3. User clicks `✕`. Banner disappears immediately. A flag is written to localStorage.
4. User reloads, or comes back another day. Banner does not reappear.

## Architecture

### Storage layer — `lib/announcements.ts` (new)

```ts
export function isAnnouncementDismissed(id: string): boolean
export function dismissAnnouncement(id: string): void

export const ANN_CUSTOM_TABS_MULTI = 'customTabs2026-05'
export const ANN_CUSTOM_TABS_MULTI_TEXT_TH =
  '🎉 ฟีเจอร์ใหม่ : สร้าง custom search ได้ถึง 3 ชุด กดเครื่องหมาย + บน tab bar เพื่อทดลองใช้งาน'
```

- LocalStorage key per announcement: `batbracket.announcements.${id}`. Stored value is the literal string `'1'`; presence indicates dismissed.
- Both functions wrap a `typeof window === 'undefined'` guard and a try/catch (SSR / disabled storage safety, matching existing `batbracket.*` modules).
- `isAnnouncementDismissed` returns `false` whenever storage isn't available. Trade-off: users without localStorage see the banner every visit. Acceptable.
- No `undismissAnnouncement` — once dismissed, dismissed forever in that browser. Reset path: clear localStorage in devtools.

The id and text constants are colocated with the helper so the announcement metadata lives in one place.

### Component — `components/AnnouncementBanner.tsx` (new)

```tsx
interface Props {
  id: string
  text: string
  visible?: boolean  // when false, renders null. Default true.
}
```

Behavior:
- On mount, reads `isAnnouncementDismissed(id)` into a local `dismissed` state.
- Renders `null` when `dismissed === true` or `visible === false`.
- On the first render where it would actually display (i.e., `!dismissed && visible !== false`), fires `track('announcement_shown', { id })` exactly once.
- On `✕` click: calls `dismissAnnouncement(id)`, sets local state to dismissed, fires `track('announcement_dismissed', { id })`.

Layout (inline, full-width, follows the existing `bracketRoundHint`-style banner):

```
┌──────────────────────────────────────────────────────────────────┐
│  🎉 ฟีเจอร์ใหม่ : สร้าง custom search ได้ถึง 3 ชุด ...     ✕  │
└──────────────────────────────────────────────────────────────────┘
```

- Tailwind: `bg-[var(--info-bg)]`, `text-[var(--info-fg)]`, `border-b border-[var(--border)]`, padding `px-5 py-1.5`, text size `text-xs` — same recipe as the existing bracket hint banner.
- The text span has `lang="th"` so Thai shaping/fonts apply regardless of the document's `<html lang>`.
- `✕` button: positioned right, `text-[var(--muted)] hover:text-[var(--fg)]`, ~16×16, `aria-label="ปิด"` (matches the existing `close` Thai string).

Component intentionally has no language-toggle behavior — for this announcement the parent passes Thai text and that's what shows.

### Page integration — `app/page.tsx`

Single addition: render the banner immediately above the View-mode tabs block (around line 681 in the current file). The banner sits between the sticky toolbar and the tabs.

```tsx
<AnnouncementBanner
  id={ANN_CUSTOM_TABS_MULTI}
  text={ANN_CUSTOM_TABS_MULTI_TEXT_TH}
  visible={!!selectedTournament}
/>
```

The `visible` prop satisfies the Q2 = B gate. No other state changes; no new effects in `Home()`.

## Data Flow

```
mount → AnnouncementBanner(id, text, visible)
          │
          ├── isAnnouncementDismissed(id)?
          │       │
          │       └── true  → render null
          │       └── false → render banner (if visible !== false)
          │                     │
          │                     ├── on first visible render → track('announcement_shown')
          │                     └── on ✕ click:
          │                            → dismissAnnouncement(id)  // localStorage write
          │                            → track('announcement_dismissed')
          │                            → setState dismissed = true → render null
```

## Edge Cases

- **localStorage disabled / SSR.** `isAnnouncementDismissed` returns `false`; `dismissAnnouncement` no-ops. Banner shows every render in this case — accepted limitation.
- **User without a tournament selected.** Parent passes `visible={false}`; banner renders null. When they pick a tournament, banner appears.
- **Re-mount due to language toggle.** The local `dismissed` state resets, but `isAnnouncementDismissed` is read again on mount — so the dismissed flag survives.
- **Two browser tabs open simultaneously.** Each tab has its own state; dismissing in tab A doesn't immediately hide it in tab B until tab B re-mounts the banner (e.g., on reload). Acceptable for a one-time announcement.
- **Future announcements.** Add a new id constant and text, render another `<AnnouncementBanner>`. No code changes to the helper or component.

## Analytics

- `announcement_shown` — `{ id }` — fired once per banner instance when it first renders in the visible+undismissed state.
- `announcement_dismissed` — `{ id }` — fired on `✕` click.

## Testing

Unit tests in `__tests__/announcements.test.ts` (new):

- `isAnnouncementDismissed` returns `false` when nothing is stored.
- `dismissAnnouncement` followed by `isAnnouncementDismissed` returns `true`.
- Different ids are isolated (dismissing one doesn't affect another).
- Storage key format matches `batbracket.announcements.<id>`.

Manual verification:
- Banner appears after picking a tournament.
- `✕` hides it.
- Reload → still hidden.
- Clear `batbracket.announcements.customTabs2026-05` → banner appears again.
- Banner text reads in Thai even when the language toggle is set to English.

## Out of Scope

- Multi-language announcement support.
- Stacking multiple banners.
- Animation / fade transitions.
- A "What's new?" history page.
- Server-side feature flags or remote announcement configuration.

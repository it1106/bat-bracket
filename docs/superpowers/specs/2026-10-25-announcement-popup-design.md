# Editable Announcement Popup — Design

Replace the sliding marquee announcement banner with a one-time modal popup,
and make its text editable from `/bmstats` so changing it no longer needs a
deploy.

## Background

Today's announcement system (see
`docs/superpowers/specs/2026-05-04-feature-announcement-design.md`) ships the
text as a hardcoded constant in `lib/announcements.ts`:

```ts
export const ANN_CUSTOM_TABS_MULTI = 'customTabs2026-05'
export const ANN_CUSTOM_TABS_MULTI_TEXT_TH = '🎉 ฟีเจอร์ใหม่ : …'
```

It renders as a dismissible marquee strip between the toolbar and the view-mode
tab bar, gated on `visible={!!selectedTournament}`, with dismissal stored per
announcement id under `batbracket.announcements.<id>`.

Two problems:

1. **Changing the text requires a code change and a deploy.** The site owner
   wants to type a new announcement into a box on `/bmstats` and have it go
   live.
2. **The marquee is the wrong shape for it.** A scrolling strip is easy to miss
   and reads as decoration. The owner wants a popup that a visitor has to
   acknowledge once with an OK button.

## Goals

- The announcement text is edited in a textbox on `/bmstats` and reaches
  visitors without a deploy.
- Clearing the box turns the popup off entirely.
- Changing the text makes the popup show again to **everyone**, including people
  who already clicked OK on the previous text.
- Saving the *same* text again does not re-show the popup to anyone.
- One-time per visitor per text: popup appears, visitor clicks OK, it is gone
  until the text changes.

## Non-Goals

- Multi-language announcements. One text field, one language, whatever the owner
  types (today's announcements are Thai).
- Rich text, links, or HTML in the announcement. Plain text only.
- Scheduling (start/end dates), targeting, or multiple simultaneous
  announcements.
- A "what's new" history page, or any record of past announcements.
- Server-side tracking of who has seen what. Dismissal stays per-browser.
- Preserving the existing marquee as an option.

## Anti-Goals

These would make the feature a failure even if it worked:

- A popup that reappears on every page load because a dismissal did not stick.
  Any path that closes the popup must persist.
- Visitors who already dismissed the May custom-tabs banner being shown a popup
  about it again after this ships.
- The popup interrupting the owner while they are editing the text on
  `/bmstats`.

## Constraints

- Next.js 14 App Router, React 18, TypeScript, Tailwind plus the hand-written
  CSS in `app/globals.css`. No new dependencies.
- The app runs under PM2 on one host as a cluster of two workers
  (`ecosystem.config.js`: `instances: 2`, `exec_mode: 'cluster'`). Server-side
  state lives in files under `.cache/`, outside Git so a deploy does not touch
  it. Two workers share that file, which the `AliasStore` pattern already
  handles: the mtime-keyed memo picks up another worker's write on its next
  `statSync`, and the pid-suffixed temp-file-plus-rename write stays atomic.
- `/bmstats` is already login-gated by `lib/bmstats-auth.ts`
  (`BMSTATS_PASSWORD` + signed cookie). The announcement editor sits behind the
  same session; there is no second authorization concept to introduce.
- Analytics is PostHog via `track()` in `lib/analytics.ts`, a no-op when
  PostHog has not loaded.

## Prior Art In This Repo

The whole feature is a second instance of a pattern that already exists for
search aliases. **Follow it rather than inventing a parallel one:**

| Layer | Search aliases (copy this) |
|---|---|
| Store | `lib/search-aliases-store.ts` — `AliasStore` class, file under `.cache/`, mtime-keyed memo, unreadable/missing file falls back to defaults |
| Admin API | `app/api/bmstats/aliases/route.ts` — `isLoggedIn()` gate, `NO_STORE` header const, `denied()` helper, responds with the full current state after every change |
| Public API | `app/api/search-aliases/route.ts` — unauthenticated GET, `dynamic = 'force-dynamic'`, `Cache-Control: no-store` |
| Client loader | `components/SearchAliasesLoader.tsx` — `'use client'`, fetches once on mount, renders `null`, failure leaves the built-in behaviour |
| Admin UI | `AliasEditor` in `components/BmStats.tsx` — `<Card title>`, `bms-note` / `bms-login-input` / `bms-login-button` / `bms-login-error` classes, `busy` state, single `error` string |

The modal shape also already exists. **Reuse it:** `.pm-overlay` + `.pm-modal` +
`.pm-close` from `app/globals.css:818-854`, driven as in
`components/CustomTabModal.tsx` — overlay click closes, inner `onClick`
`stopPropagation`, Escape wired through a `useEffect` keydown listener.
`components/PlayerModal.tsx`, `H2HModal.tsx` and `RosterModal.tsx` are further
examples of the same three lines.

## Architecture

### Server store — `lib/announcement-store.ts` (new)

Modelled directly on `AliasStore`.

- File: `.cache/announcement.json`, shape `{ text: string, id: string, updatedAt: number }`.
- `read(): { text: string; id: string; updatedAt: number } | null` — `null`
  means **no announcement** (file missing, unreadable, malformed, or stored text
  empty after trimming). A `null` read is the off state; it is not an error.
- `write(text: string)` — trims, and when the trimmed text is empty **deletes**
  the file (or writes the empty state) so the popup is off. Otherwise computes
  the id and writes all three fields.
- Same mtime-keyed memo as `AliasStore`, so repeat reads do not hit the disk on
  every request.
- Same `fs.mkdirSync(dirname, { recursive: true })` before the first write.

**The id is how "text changed, show it again" works, and the server owns it.**
`id = sha256(trimmedText).slice(0, 12)` using Node's `crypto`. Consequences,
all of them intended:

- Different text → different id → the popup shows again to everyone.
- The same text saved twice → the same id → nobody is re-shown it.
- Text reverted to a previous wording → the id returns to its earlier value.
  Anyone who dismissed that exact wording and has not dismissed anything since
  will not see it again; everyone else will. Accepted: reverting is rare, and
  this falls out of content-addressing. Not worth a monotonic counter, which
  would re-show the popup on every no-op save.

Clients never compare texts or compute ids. They compare ids only.

### Validation

In the store, so both routes share it (mirrors `validateAlias`):

```ts
export function validateAnnouncement(text: unknown): { text: string } | { error: string }
```

- Must be a string, otherwise `{ error: 'The announcement must be text.' }`.
- Trimmed.
- `MAX_ANNOUNCEMENT = 500` characters after trimming; over that,
  `{ error: 'The announcement can be at most 500 characters.' }`.
- The empty string is **valid** and means off.

No character blacklist. Unlike aliases, the text is not fed to the search
parser, so `&` and `|` are fine. It is rendered as a text node, never as HTML.

### Admin API — `app/api/bmstats/announcement/route.ts` (new)

`export const dynamic = 'force-dynamic'`. Both methods behind `isLoggedIn()`,
using the same `NO_STORE` / `denied()` shape as the aliases route, and both
answer with the full current state so the editor never has to guess:

```
GET  → 200 { announcement: { text, id, updatedAt } | null }
POST { text } → 200 { announcement: … | null }   // same body shape as GET
              → 400 { error }                     // validation
              → 401 { error: 'login required' }
```

Clearing is `POST { text: '' }` — no separate DELETE, because "off" is just the
empty value. Log the change the way the aliases route does:
`console.log('[bmstats] announcement set id=… len=…')`.

### Public API — `app/api/announcement/route.ts` (new)

`export const dynamic = 'force-dynamic'`, unauthenticated, `no-store`:

```
GET → 200 { announcement: { id, text } | null }
```

`updatedAt` is deliberately not exposed publicly — visitors have no use for it.

### Popup — `components/AnnouncementPopup.tsx` (new, replaces `AnnouncementBanner.tsx`)

`'use client'`, no props. On mount:

1. Read the last-seen id from localStorage (see below).
2. `fetch('/api/announcement', { cache: 'no-store' })`.
3. Show the modal when the response has an announcement **and** its `id` differs
   from the stored last-seen id. Otherwise render `null`.

A failed or empty fetch renders nothing — an unreachable endpoint must never
produce an empty popup.

Markup: the `.pm-overlay` / `.pm-modal` / `.pm-close` structure, with
`role="dialog"`, `aria-modal="true"` and an `aria-label`, Escape wired as in
`CustomTabModal`, `maxWidth: 420` on the modal. The text renders as a plain text
node with `whitespace-pre-wrap` (the textarea produces real line breaks, and
they should survive) and `lang` left unset so it inherits the document. A
primary **OK** button, and the standard `.pm-close` ✕ in the corner.

**Every close path counts as OK and persists:** the OK button, the ✕, Escape,
and a backdrop click all write the id and fire the same analytics event. Written
down because the alternative — only OK persisting — means an accidental Escape
leaves the popup reappearing on every page load, which is an anti-goal above.
The trade-off is that a stray Escape can make someone miss the announcement;
that is the better failure.

Focus: move focus to the OK button on open, the way `CustomTabModal` focuses its
first input via a zero-delay `setTimeout`. No focus trap — none of the existing
modals has one, and adding one here alone would be inconsistent.

### Client dismissal state — `lib/announcements.ts` (rewritten)

The file stays, its contents are replaced:

```ts
export function lastSeenAnnouncement(): string | null
export function markAnnouncementSeen(id: string): void
```

**One** localStorage key, `batbracket.announcementSeen`, holding the id of the
last announcement the visitor acknowledged. Not one key per id: with editable
text there is no bounded set of ids, and a key per id would leave dead keys in
every visitor's browser forever. A single key also gives the "changed text
re-shows" behaviour for free, since any id that is not the stored one shows.

Both functions keep the existing `typeof window === 'undefined'` guard and
try/catch. With storage unavailable, `lastSeenAnnouncement()` returns `null` and
the popup shows on every load — the same accepted limitation the banner had.

The old `batbracket.announcements.*` keys are simply abandoned. They are left in
place rather than migrated: migrating would mean mapping a dead constant's id
onto a new scheme to suppress an announcement that is not going to be seeded
anyway.

### Admin UI — `AnnouncementEditor` in `components/BmStats.tsx`

A new `<Card title="Announcement">`, shaped like `AliasEditor` directly above or
below it in the same list at the bottom of the component. Same `busy` /
`error` / single-`apply`-helper structure, same `bms-*` classes.

Contents:

- A `bms-note` explaining it in the owner's terms: the text pops up once for
  each visitor; changing it shows it again to everyone; an empty box turns it
  off; visitors see the change on their next page load.
- A `<textarea>` (4 rows) pre-filled from `GET`, with a character counter
  against the 500 limit.
- **Save** — `POST { text }`, disabled while busy or while the textarea is
  unchanged from what was loaded.
- **Clear** — `POST { text: '' }`, disabled while busy or already off.
- A status line: **On** with the last-updated time (formatted the way the rest
  of `BmStats.tsx` formats timestamps), or **Off**.
- Errors in `bms-login-error` with `role="alert"`.

A `bms-announcement-textarea` rule goes next to the other `bms-*` rules in
`app/globals.css` if the existing input classes do not cover a textarea.

### Mount point — `app/layout.tsx`

`<AnnouncementPopup />` mounts next to `<SearchAliasesLoader />` in the layout,
so the announcement reaches visitors on every page rather than only the home
page, and the old `visible={!!selectedTournament}` gate is dropped.

**This is my call, not the owner's, and it is the one most worth checking.** The
reasoning: the gate existed only because the May announcement pointed at the tab
bar, which does not render until a tournament is picked. Arbitrary announcement
text has no such dependency, and gating it would silently hide announcements
from anyone who lands on `/leaderboards` or a player page. The alternatives are
to keep it on the home page with the gate, or on the home page without it.

The popup must **not** render on `/bmstats` (anti-goal: interrupting the owner
mid-edit). The component checks the current path via `usePathname()` and renders
`null` under `/bmstats`.

## Data Flow

```
owner types in textarea on /bmstats
   └─ POST /api/bmstats/announcement { text }
        └─ isLoggedIn? ─no→ 401
           validateAnnouncement ─error→ 400
             └─ store.write(text)
                  trimmed empty → off state
                  otherwise     → { text, id: sha256(text)[0..12], updatedAt }
                  └─ .cache/announcement.json
                       └─ responds { announcement } → editor re-renders status

visitor loads any page
   └─ AnnouncementPopup mounts
        ├─ path starts with /bmstats → null
        ├─ lastSeenAnnouncement()  (localStorage batbracket.announcementSeen)
        └─ GET /api/announcement → { announcement: { id, text } | null }
             ├─ null, or fetch failed        → null
             ├─ id === lastSeen              → null
             └─ otherwise → modal
                  └─ OK / ✕ / Escape / backdrop
                       ├─ markAnnouncementSeen(id)
                       ├─ track('announcement_dismissed', { id })
                       └─ close
```

## Deploy Day Behaviour

**The popup ships off, and the store is not seeded from
`ANN_CUSTOM_TABS_MULTI_TEXT_TH`.** My call. Seeding would compute a new id for
the May custom-tabs text and hand a popup about a months-old feature to every
visitor, including everyone who already closed the banner — an anti-goal above.
`.cache/announcement.json` does not exist after the deploy, `read()` returns
`null`, and nothing shows until the owner types something into the box.

## Removals

Part of the work, not cleanup to be left behind:

- `components/AnnouncementBanner.tsx` — deleted, replaced by
  `AnnouncementPopup.tsx`.
- The marquee CSS, `app/globals.css:257-282` — the `.announcement-marquee`
  block, the `@keyframes announcement-marquee`, the hover pause, and the
  `prefers-reduced-motion` override.
- `ANN_CUSTOM_TABS_MULTI` and `ANN_CUSTOM_TABS_MULTI_TEXT_TH`.
- `isAnnouncementDismissed` / `dismissAnnouncement`.
- The banner call site at `app/page.tsx:1272-1276`, and the now-unused imports
  at `app/page.tsx:23` and `30-31`.
- `track('announcement_shown')` — see Analytics.

## Analytics

- `announcement_dismissed` — `{ id }` — kept, fired on every close path.
- `announcement_shown` — **dropped.** It existed to measure a banner nobody had
  to acknowledge. A popup is shown-then-acknowledged in one gesture, so the
  dismissed event carries the same information, and keeping both would mean two
  events per visitor per announcement with no extra signal. Left to the builder
  to keep it instead if that turns out to be wrong; nothing else depends on it.

## Testing

Unit tests, replacing `__tests__/announcements.test.ts` (which asserts the
dead constants and the old per-id key format and cannot survive):

**`__tests__/announcements.test.ts`** (rewritten, jsdom) — the client helpers:
- `lastSeenAnnouncement()` returns `null` with nothing stored.
- `markAnnouncementSeen('abc')` then `lastSeenAnnouncement() === 'abc'`.
- A second `markAnnouncementSeen` replaces the first rather than adding a key.
- The value lands under `batbracket.announcementSeen`.

**`__tests__/announcement-store.test.ts`** (new, node) — point the store at a
temp dir, the way the existing store tests do:
- A missing file reads as `null`.
- Write then read round-trips the text.
- The id is stable across two writes of the same text, and differs for different
  text.
- Leading/trailing whitespace is trimmed, and text differing only in surrounding
  whitespace produces the same id.
- Whitespace-only text reads back as `null` (off).
- Malformed JSON reads as `null` rather than throwing.
- `validateAnnouncement` rejects non-strings and over-length text, and accepts
  the empty string.

Manual verification against the dev server:
- `/bmstats` logged out shows no announcement card content; logged in, the card
  loads with the current state.
- Save text → reload the home page → popup appears with that text, line breaks
  intact.
- OK → gone. Reload → still gone.
- Change the text on `/bmstats` → reload the home page → popup appears again
  without clearing localStorage.
- Save the same text again → reload → no popup.
- Clear the box → status reads Off → reload → no popup.
- Escape and a backdrop click both stick across a reload.
- The popup does not appear on `/bmstats` itself.
- Appears on `/leaderboards` and a player page too.
- Light and dark themes both legible.

## Left To The Builder

- Exact copy for the `bms-note`, the status line, the button labels and the
  popup's `aria-label`. `/bmstats` is English; the announcement text itself is
  whatever the owner types.
- Precise popup padding, type scale and button styling within the existing
  `.pm-modal` conventions.
- Whether `validateAnnouncement` and `MAX_ANNOUNCEMENT` live in
  `lib/announcement-store.ts` or beside the client helpers — as long as the
  routes share one implementation and nothing server-only is imported into
  client code.
- Whether the store is a class with an injectable path (like `AliasStore`) or a
  module with a settable root (like `lib/clubs-cache.ts`). Either is consistent;
  it must be testable against a temp dir without touching this repo's `.cache`.
- Whether to keep `track('announcement_shown')`.

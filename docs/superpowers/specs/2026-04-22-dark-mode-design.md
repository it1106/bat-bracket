# Dark Mode — Design Spec

**Date:** 2026-04-22
**Branch:** `dark-mode`
**Status:** Draft — awaiting review

## Summary

Add a light/dark theme toggle to BATBracket. Palette is drawn from the GitHub Dark family (inspired by the `CoreUI/` reference template's own `data-coreui-theme` approach, translated to BATBracket's non-Bootstrap stack). Users get an icon button in the top bar and a `d` keyboard shortcut. Preference persists in `localStorage`; default is Light.

## 1. User-facing behavior

- **Toggle button.** Icon-only button in the top-bar right-side cluster, positioned immediately left of the `EN|TH` toggle. Shows `🌙` in light mode, `☀` in dark mode. `aria-label="Toggle dark mode"`; `title` is localized (`Dark mode` / `โหมดมืด` and `Light mode` / `โหมดสว่าง`).
- **Hotkey.** `d` toggles the theme. Ignored when (a) any modifier key is held (`Ctrl`, `Meta`, `Alt`), so browser shortcuts like `Cmd+D` still bookmark, and (b) an `INPUT`, `TEXTAREA`, or `contentEditable` element has focus. Same guard shape as the existing `/` search hotkey in `app/page.tsx:69-79`.
- **Default.** First-time visitors get the Light theme regardless of OS preference (no `prefers-color-scheme` auto-detection).
- **Persistence.** After any user interaction with the toggle or hotkey, the choice is written to `localStorage['bat-theme']` as `'light'` or `'dark'` and restored on every subsequent visit.

## 2. Architecture

- **Single toggle point.** The `<html>` element gets `class="dark"` in dark mode and nothing (or bare) in light mode. Everything else cascades through CSS variables.
- **Token layer.** Defined in `app/globals.css` inside `@layer base`:
  - `:root { … }` holds all light-mode token values.
  - `html.dark { … }` overrides the same tokens with dark-mode values.
- **Consumption.** Existing rules in `globals.css` (hundreds of hardcoded hex values across `.bk-*`, `.pm-*`, `.ms-*`, `.h2h-*`, `.match__*`) are rewritten to reference `var(--*)`. Inline Tailwind utility classes in TSX files use arbitrary values like `bg-[var(--surface)]`, `text-[var(--fg)]`, `border-[var(--border)]`. No `.dark` descendant selectors needed — the CSS-variable cascade handles both themes with one rule per selector.
- **State management.** A small `ThemeProvider` context in `lib/ThemeContext.tsx` (~40 lines) mirrors the pattern of the existing `lib/LanguageContext`. Exposes `theme: 'light' | 'dark'`, `toggleTheme()`, and `setTheme(t)`. On mount it reads `document.documentElement.classList.contains('dark')` to initialize.
- **Zero-flash on load (FOUC prevention).** A tiny inline `<script>` is injected into `<head>` from `app/layout.tsx`. Before React hydrates, it reads `localStorage['bat-theme']` and sets the `dark` class on `<html>` if needed. This prevents a light-to-dark flash on dark-mode reloads.
- **SSR safety.** The provider never reads `localStorage` during render. All storage access happens in `useEffect` or event handlers.

## 3. Palette tokens

All hex values below are final. Token names are the full set consumed by the rewritten `globals.css`.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#f0f2f5` | `#0d1117` | page background (bracket canvas, match schedule) |
| `--surface` | `#ffffff` | `#161b22` | top bar, match boxes, modals, `.ms-list` |
| `--fg` | `#1a1a1a` | `#e6edf3` | primary text |
| `--muted` | `#888888` | `#7d8590` | round labels, subtitles, placeholder hints |
| `--border` | `#e5e7eb` | `#30363d` | dividers, select borders, input borders |
| `--brand` | `#25316B` | `#1f6feb` | filled buttons/pills, active tab indicators |
| `--brand-fg` | `#25316B` | `#58a6ff` | brand-colored text on backgrounds |
| `--red` | `#BE1D2E` | `#ff7b72` | `appTitle2` accent |
| `--win-bg` | `#e8f5e9` | `rgba(46,160,67,.15)` | winner row background |
| `--win-fg` | `#166534` | `#7ee787` | winner text |
| `--track-bg` | `#fff3cd` | `rgba(210,153,34,.18)` | tracked player background |
| `--track-fg` | `#856404` | `#d29922` | tracked player text |
| `--score-bg` | `#f8f9fa` | `#0d1117` | match footer score strip |
| `--row-sep` | `#f0f0f0` | `#21262d` | thin row dividers inside match boxes |
| `--match-border` | `#696969` | `#30363d` | bracket match-box outer border |
| `--info-bg` | `#eff6ff` | `rgba(56,139,253,.15)` | info banner background ("Viewing from …") |
| `--info-fg` | `#1d4ed8` | `#79c0ff` | info banner text |

**`--brand` vs `--brand-fg`:** `--brand` is used when the color is a *fill* (e.g. an active tab pill's background or a button's `background-color`). `--brand-fg` is used when the color is a *foreground* text color rendered on top of `--surface` or `--bg` (e.g. an event name, a link label). In light mode both map to `#25316B` (identical); in dark they split — `--brand` is `#1f6feb` (fills look clean), `--brand-fg` is `#58a6ff` (meets WCAG AA on the dark surface).

Brand color `#25316B` is preserved unchanged in light mode so the current BAT visual identity is untouched.

## 4. Affected files

### New files

- **`lib/ThemeContext.tsx`** — `ThemeProvider`, `useTheme()`, `toggleTheme()`. Patterned after `lib/LanguageContext`.
- **`public/dark-mode-mockup.html`** — standalone interactive preview (see §5).

### Modified files

- **`app/layout.tsx`** — wrap `children` in `<ThemeProvider>` nested inside `<LanguageProvider>`. Add the no-flash inline `<script>` tag in `<head>`.
- **`app/globals.css`** — add the `:root` and `html.dark` token blocks at the top of `@layer base`. Replace every hardcoded color in the custom classes (`.bk-*`, `.pm-*`, `.ms-*`, `.h2h-*`, `.match__*`, `.swiper-bracket-header`, `.subheading`, `.bracket`, `.match-schedule*`) with `var(--*)` references. This is the largest change by line count but entirely mechanical.
- **`app/page.tsx`** —
  - Replace inline Tailwind color utilities with `var(--*)` arbitrary forms: `bg-white` → `bg-[var(--surface)]`, `text-gray-900` → `text-[var(--fg)]`, `border-gray-200` → `border-[var(--border)]`, `text-gray-400` → `text-[var(--muted)]`, `bg-blue-50 border-blue-200 text-blue-700` (the "Viewing from" banner) → `bg-[var(--info-bg)] border-[var(--border)] text-[var(--info-fg)]`. The legend's `bg-green-100/border-green-300/bg-yellow-100/border-yellow-400` keep their Tailwind values — they're explicit legend swatches meant to match the light-mode look and carry no semantic theming.
  - Add the theme-toggle `<button>` in the right-side cluster alongside the existing EN/TH toggle.
  - Add a second `useEffect` that listens for `keydown` on `d`, guarded the same way the `/` handler is (ignore modifiers and focused form elements).
- **`components/BracketCanvas.tsx`, `components/MatchSchedule.tsx`, `components/PlayerModal.tsx`, `components/H2HModal.tsx`** — audit for inline hex values and inline Tailwind color utilities; swap to tokens. Most of these components get their colors from `globals.css`, so changes should be minimal.
- **`components/ExportButton.tsx`** — export must always render the bracket in **light** mode regardless of current theme, so shared/printed JPGs look consistent. Implementation: before invoking `html-to-image`, either (a) temporarily remove `dark` from `document.documentElement.classList` for the duration of the capture and restore after, or (b) render into an offscreen clone wrapped in an element that overrides the tokens back to light values. Option (a) is simpler; option (b) avoids a visible single-frame light flash for the user. Decision deferred to the implementation plan — both satisfy the requirement.
- **`lib/i18n.ts`** — add two new keys used only by the toggle's `title` tooltip: `darkMode` ("Dark mode" / "โหมดมืด") and `lightMode` ("Light mode" / "โหมดสว่าง").

### Explicitly NOT modified

- **`components/TopBar.tsx`** — dead code. Not imported by `app/page.tsx`. Leave untouched to avoid scope creep.
- **`tailwind.config.ts`** — no `darkMode: 'class'` needed; we do not use `dark:` variants.

## 5. Interactive mockup — `public/dark-mode-mockup.html`

A standalone HTML file with no build step, previewable at `http://localhost:3000/dark-mode-mockup.html` via the existing `npm run dev`. Follows the pattern established by `public/h2h-mockup.html` and `public/player-stats-mockup.html`.

### Content

- Top bar: tournament/draw selects, search input, EN/TH toggle, and the new theme-toggle button.
- Match Schedule pane: four sample rows covering the distinct states — one Now Playing (with pulsing dot), one winner-highlighted, one tracked-player-highlighted, one unplayed.
- Bracket pane: three rounds (QF → SF → F) with connector lines, at least one `has-won` row and one `highlighted` (tracked) row.
- Player Modal open over the content, showing the stats banner, three stat cells, events pills, and two match rows.

### Inlined styling

Inlines both the light `:root` and dark `html.dark` token blocks and the relevant `.ms-*`, `.bk-*`, `.pm-*`, `.match__*` rules rewritten to reference the tokens. The mockup is a source of truth for the final token values — whatever looks right in the mockup is what gets copied into `app/globals.css` during implementation.

### Interactive behavior

- Theme-toggle button adds/removes `dark` on `<html>` and writes `localStorage['bat-theme']`.
- `d` hotkey toggles (guarded to ignore when focus is inside the search input).
- EN/TH toggle flips a small set of sample labels (to sanity-check Thai text under both themes).
- "Open Player Modal" / close button demonstrates modal overlay theming.

### Purpose

Lets the reviewer poke at the real look-and-feel before any app code is touched. Token adjustments happen in the mockup first, then get copied into `globals.css` during implementation.

## 6. Testing

- **Unit test — `__tests__/ThemeContext.test.tsx`.** Renders a consumer component. Asserts:
  - On mount with empty `localStorage`, `theme === 'light'`.
  - After `toggleTheme()`, `theme === 'dark'`, `document.documentElement.classList.contains('dark')` is `true`, and `localStorage['bat-theme'] === 'dark'`.
  - On a fresh mount with `localStorage['bat-theme'] === 'dark'` (simulated), initial `theme === 'dark'`.
- **Hotkey test.** Either a new file or an extension of an existing page test. Asserts pressing `d` with no focused input toggles theme; asserts pressing `d` while an `<input>` is focused does not toggle.
- **No-flash script.** Manual verification only (reload with `dark` persisted — no light flash). Not automatable without Playwright, which isn't in the repo.
- **Lint / type-check.** Existing `npm run lint` and `tsc` must pass.

Visual-regression testing is out of scope; the interactive mockup serves that role manually before merge.

## 7. Out of scope

- "Auto" mode or `prefers-color-scheme` following.
- Cross-device theme sync (no backend involved).
- Theming the exported JPG (always light — deliberate, see §4).
- Changing existing brand colors or any layout.
- Adding Tailwind plugins or modifying `tailwind.config.ts`.
- Touching `components/TopBar.tsx` (dead code).
- Per-component dark-mode overrides beyond what the token set supports.

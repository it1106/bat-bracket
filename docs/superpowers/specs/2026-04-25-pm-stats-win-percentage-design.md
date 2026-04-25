# Design: Win-Loss % in PlayerModal Stats

**Date:** 2026-04-25
**Scope:** Add a career win-loss percentage to every record (Career banner + Singles / Doubles / Mixed cells) inside `.pm-modal`'s stats block.

## Goal

Players currently see W–L counts (e.g. `127–48 (22–8)`). We want to surface the corresponding win rate so a player's strength is legible at a glance, without dropping or distorting the existing layout.

## Visual Design — Win Bar

Adopted from `public/player-stats-winloss-mockup.html`, Option B.

**Banner (Career):**

- Existing: `127–48` (28px) and `(22–8)` (13px) on one line.
- Add directly underneath:
  - A 6px-tall track (`rgba(255,255,255,0.15)`) with a green fill (`linear-gradient(90deg, #4ade80 0%, #22c55e 100%)`) sized to the win rate.
  - A row of 10px caption text (opacity 0.85): `Win rate` on the left, bold 12px `73%` on the right.

**Cells (Singles / Doubles / Mixed):**

- Existing: cell label + W–L value + `(YTD)` row.
- Add at the bottom of each cell:
  - A 4px-tall track (`var(--rule)`) with a green fill (`var(--win)`).
  - A 10px muted caption beneath the bar showing `74%` (no "win rate" prefix in cells; the bar already implies it, and cell width is tight).

YTD stays as plain text in parentheses on every record. Only career W–L drives a bar.

## Data

The data already exists on `PlayerProfile.stats` (`lib/types.ts:122-137`). No scraper, no API change.

Add a small helper inside `PlayerModal.tsx` (alongside the existing `fmt`):

```ts
function pct(r: { wins: number; losses: number }): number | null {
  const total = r.wins + r.losses
  if (total === 0) return null
  return Math.round((r.wins / total) * 100)
}
```

Render rules:

- If `pct(...)` returns `null` (player has zero career matches in that category), omit both the bar and the caption for that record. The cell label, W–L `0–0`, and `(0–0)` stay so the cell still occupies its grid slot.
- The bar's fill uses `width: ${pct}%` inline. CSS handles colors and track styles.

## Files Touched

- `components/PlayerModal.tsx` — add `pct` helper; render bar + caption inside the existing banner and each of the three cells.
- `app/globals.css` — extend the existing `.pm-stats-*` block (`app/globals.css:495-566`):
  - New rules: `.pm-stats-banner-bar`, `.pm-stats-banner-bar-fill`, `.pm-stats-banner-bar-caption`, `.pm-stats-banner-bar-pct`, `.pm-stats-cell-bar`, `.pm-stats-cell-bar-fill`, `.pm-stats-cell-pct`.
  - Banner padding-bottom adjusts from `14px` to leave room for the bar row.
- `lib/i18n.ts` — add `winRate` translation key (`Win rate` / `อัตราการชนะ`) and union-type entry.

## Edge Cases

- **No matches in a category** (`wins + losses === 0`): omit bar + caption only; preserve W–L text and cell shape.
- **All wins / all losses**: bar renders at 100% / 0%; caption shows the integer. No special styling.
- **Dark mode**: track switches via existing `--rule` token; banner track is alpha-white so it works on both gradients without override.
- **Mobile**: cells stay in their 3-column grid; bar inherits the cell's interior padding so width follows the cell. Existing `.pm-modal` mobile breakpoint at `app/globals.css:714` needs no change.

## Out of Scope

- YTD percentage (deferred — single source of truth on the bar avoids visual noise; YTD text already conveys recent activity).
- Trend arrows / sparklines.
- Doubles-partner-specific win rates.
- Surface or opponent-class breakdowns.

## Acceptance

- A profile with non-zero career matches shows four bars (banner + three cells), each correctly proportioned to its W–L.
- A profile with zero career matches in some categories renders correctly: cells without data show no bar/caption but keep their label and `0–0` rows.
- English and Thai both render the banner caption (`Win rate` / `อัตราการชนะ`).
- Dark mode toggle (existing) does not break colors or contrast.
- Layout height on the banner grows by ~22px; cell heights grow by ~16px. Modal still fits within `max-height: 85vh`.

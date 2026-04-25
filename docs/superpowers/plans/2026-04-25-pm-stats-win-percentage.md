# PlayerModal Stats — Win-Loss % Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a career win-rate bar (Option B from `public/player-stats-winloss-mockup.html`) under each W-L record in the `.pm-modal` stats block.

**Architecture:** Pure-function helper computes the percentage from `PlayerStats` data already on `PlayerProfile`. `PlayerModal.tsx` renders a thin progress bar + numeric caption inside the existing banner and three discipline cells. New CSS classes extend the existing `.pm-stats-*` block. One i18n key for the banner caption. Records with zero matches omit the bar but keep their W-L text.

**Tech Stack:** Next.js 14, React 18, TypeScript, Jest, plain CSS in `app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-04-25-pm-stats-win-percentage-design.md`

---

## File Structure

**Created:**
- `lib/playerStats.ts` — `pct()` pure helper (≤10 lines).
- `__tests__/playerStats.test.ts` — Jest unit tests for `pct`.

**Modified:**
- `lib/i18n.ts` — add `winRate` translation key (en + th) and union member.
- `components/PlayerModal.tsx` — render the bar + caption in the banner and in each of the three cells.
- `app/globals.css` — add `.pm-stats-banner-bar*` and `.pm-stats-cell-bar*` rules; small padding tweak on `.pm-stats-banner`.

The `pct` helper goes in `lib/` (not in `PlayerModal.tsx` as the spec hinted) so it has a dedicated test file. The spec's intent — a small, single-purpose helper — is preserved.

---

## Task 1: `pct` helper + unit tests (TDD)

**Files:**
- Create: `lib/playerStats.ts`
- Test: `__tests__/playerStats.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/playerStats.test.ts`:

```ts
import { pct } from '@/lib/playerStats'

describe('pct', () => {
  it('returns null when there are no matches', () => {
    expect(pct({ wins: 0, losses: 0 })).toBeNull()
  })

  it('returns 100 when all wins', () => {
    expect(pct({ wins: 5, losses: 0 })).toBe(100)
  })

  it('returns 0 when all losses', () => {
    expect(pct({ wins: 0, losses: 3 })).toBe(0)
  })

  it('rounds to nearest integer', () => {
    // 1 / (1+2) = 0.3333… → 33
    expect(pct({ wins: 1, losses: 2 })).toBe(33)
    // 127 / (127+48) = 72.57… → 73
    expect(pct({ wins: 127, losses: 48 })).toBe(73)
    // 2 / (2+1) = 0.6666… → 67
    expect(pct({ wins: 2, losses: 1 })).toBe(67)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/playerStats.test.ts`
Expected: FAIL with "Cannot find module '@/lib/playerStats'".

- [ ] **Step 3: Implement the helper**

Create `lib/playerStats.ts`:

```ts
import type { WLRecord } from './types'

export function pct(record: WLRecord): number | null {
  const total = record.wins + record.losses
  if (total === 0) return null
  return Math.round((record.wins / total) * 100)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/playerStats.test.ts`
Expected: PASS, 4/4 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/playerStats.ts __tests__/playerStats.test.ts
git commit -m "Add pct() helper for win-loss percentage"
```

---

## Task 2: i18n key `winRate`

**Files:**
- Modify: `lib/i18n.ts`

- [ ] **Step 1: Add the key to the `TKey` union**

In `lib/i18n.ts`, find the `TKey` union (around line 121–128). Add `winRate` after `jumpToNext`:

```ts
  | 'jumpToNext'
  | 'winRate'
```

- [ ] **Step 2: Add the English value**

In the `en` dictionary (around line 189), after `jumpToNext: 'Next match ↓',`:

```ts
    jumpToNext: 'Next match ↓',
    winRate: 'Win rate',
```

- [ ] **Step 3: Add the Thai value**

In the `th` dictionary (around line 250), after `jumpToNext: 'แมตช์ถัดไป ↓',`:

```ts
    jumpToNext: 'แมตช์ถัดไป ↓',
    winRate: 'อัตราการชนะ',
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/i18n.ts
git commit -m "Add winRate translation key"
```

---

## Task 3: Banner — render bar + caption (TSX + CSS)

**Files:**
- Modify: `components/PlayerModal.tsx:75-99`
- Modify: `app/globals.css:501-530`

- [ ] **Step 1: Add `pct` import to `PlayerModal.tsx`**

Near the top of `components/PlayerModal.tsx`, after the existing type import:

```ts
import type { PlayerProfile, MatchEntry } from '@/lib/types'
import { useLanguage } from '@/lib/LanguageContext'
import { pct } from '@/lib/playerStats'
```

- [ ] **Step 2: Render the banner bar + caption**

In `components/PlayerModal.tsx`, locate the `pm-stats-banner` block (around line 80–86). Replace:

```tsx
                    <div className="pm-stats-banner">
                      <div className="pm-stats-banner-label">{t('statsCareer')}</div>
                      <div className="pm-stats-banner-value">
                        <span className="pm-stats-banner-career">{fmt(s.total.career)}</span>
                        <span className="pm-stats-banner-ytd">({fmt(s.total.ytd)})</span>
                      </div>
                    </div>
```

with:

```tsx
                    <div className="pm-stats-banner">
                      <div className="pm-stats-banner-label">{t('statsCareer')}</div>
                      <div className="pm-stats-banner-value">
                        <span className="pm-stats-banner-career">{fmt(s.total.career)}</span>
                        <span className="pm-stats-banner-ytd">({fmt(s.total.ytd)})</span>
                      </div>
                      {(() => {
                        const p = pct(s.total.career)
                        if (p === null) return null
                        return (
                          <>
                            <div className="pm-stats-banner-bar">
                              <div className="pm-stats-banner-bar-fill" style={{ width: `${p}%` }} />
                            </div>
                            <div className="pm-stats-banner-bar-caption">
                              <span>{t('winRate')}</span>
                              <span className="pm-stats-banner-bar-pct">{p}%</span>
                            </div>
                          </>
                        )
                      })()}
                    </div>
```

- [ ] **Step 3: Add CSS for the banner bar**

In `app/globals.css`, locate the `.pm-stats-banner` rule (line 501). Update its `padding` from `14px` to `14px 14px 12px` so the bar has breathing room. Then add the following rules immediately after `.pm-stats-banner-ytd { … }` (around line 530):

```css
.pm-stats-banner-bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.15);
  overflow: hidden;
  margin-top: 10px;
}
.pm-stats-banner-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #4ade80 0%, #22c55e 100%);
  border-radius: 999px;
}
.pm-stats-banner-bar-caption {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
  font-size: 10px;
  letter-spacing: 0.06em;
  opacity: 0.85;
  font-variant-numeric: tabular-nums;
}
.pm-stats-banner-bar-pct {
  font-size: 12px;
  font-weight: 800;
  opacity: 1;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual visual check**

If the dev server isn't running: `npm run dev`. Open `http://localhost:3000`, click into a player profile that has stats. Confirm:
- Banner shows existing `127–48 (22–8)` row.
- Below it, a thin green bar fills the correct portion of the track.
- Below the bar, `Win rate` on the left and bold `73%` on the right.
- Toggle dark mode via the existing toggle — bar stays visible against the gradient.
- Toggle Thai via the existing toggle — caption reads `อัตราการชนะ`.

- [ ] **Step 6: Commit**

```bash
git add components/PlayerModal.tsx app/globals.css
git commit -m "Add win-rate bar to player stats banner"
```

---

## Task 4: Cells — render bar + caption (TSX + CSS)

**Files:**
- Modify: `components/PlayerModal.tsx:87-95`
- Modify: `app/globals.css:531-566`

- [ ] **Step 1: Render the cell bar + caption**

In `components/PlayerModal.tsx`, locate the cells loop (around line 87–95). Replace:

```tsx
                    <div className="pm-stats-cells">
                      {(['singles','doubles','mixed'] as const).map((k) => (
                        <div key={k} className="pm-stats-cell">
                          <div className="pm-stats-cell-label">{t(`stats${k.charAt(0).toUpperCase()+k.slice(1)}` as 'statsSingles'|'statsDoubles'|'statsMixed')}</div>
                          <div className="pm-stats-cell-value">{fmt(s[k].career)}</div>
                          <div className="pm-stats-cell-ytd">({fmt(s[k].ytd)})</div>
                        </div>
                      ))}
                    </div>
```

with:

```tsx
                    <div className="pm-stats-cells">
                      {(['singles','doubles','mixed'] as const).map((k) => {
                        const p = pct(s[k].career)
                        return (
                          <div key={k} className="pm-stats-cell">
                            <div className="pm-stats-cell-label">{t(`stats${k.charAt(0).toUpperCase()+k.slice(1)}` as 'statsSingles'|'statsDoubles'|'statsMixed')}</div>
                            <div className="pm-stats-cell-value">{fmt(s[k].career)}</div>
                            <div className="pm-stats-cell-ytd">({fmt(s[k].ytd)})</div>
                            {p !== null && (
                              <>
                                <div className="pm-stats-cell-bar">
                                  <div className="pm-stats-cell-bar-fill" style={{ width: `${p}%` }} />
                                </div>
                                <div className="pm-stats-cell-pct">{p}%</div>
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
```

- [ ] **Step 2: Add CSS for the cell bar**

In `app/globals.css`, after the `.pm-stats-cell-ytd { … }` rule (around line 566), add:

```css
.pm-stats-cell-bar {
  height: 4px;
  border-radius: 999px;
  background: var(--border);
  overflow: hidden;
  margin: 6px 4px 2px;
}
.pm-stats-cell-bar-fill {
  height: 100%;
  background: #22c55e;
  border-radius: 999px;
}
html[data-theme="dark"] .pm-stats-cell-bar-fill {
  background: #4ade80;
}
.pm-stats-cell-pct {
  font-size: 10px;
  color: var(--muted);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
```

Note: confirm the dark-mode selector matches what `ThemeContext` actually toggles. If the codebase uses a `body.dark` class instead of `[data-theme="dark"]`, adjust to match. Quick check:

Run: `grep -E "data-theme|body\.dark|\.dark " lib/ThemeContext.tsx app/globals.css | head`
Then update the selector in the CSS above to match the convention found.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual visual check**

With dev server running, reopen a player profile. Confirm:
- Each of Singles / Doubles / Mixed cells shows: label, `64–22`, `(11–4)`, a thin green bar, and `74%` on the line below.
- Bar widths look correct (e.g. 74% fills roughly three-quarters of the cell).
- A player with `0–0` in some category (e.g. a singles-only player visible in Mixed): that cell shows label + `0–0` + `(0–0)` and **no bar / no percent line**, while other categories still show theirs.
- Dark mode: bar fill stays vivid; track stays visible.
- Mobile width (≤480px): cells still fit in 3-column grid; bars don't overflow.

- [ ] **Step 5: Commit**

```bash
git add components/PlayerModal.tsx app/globals.css
git commit -m "Add win-rate bars to player stats cells"
```

---

## Task 5: Final verification + cleanup

**Files:** none modified — this is the integration check.

- [ ] **Step 1: Full test run**

Run: `npm test -- --watchAll=false`
Expected: all suites green, including the new `playerStats.test.ts`.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build sanity**

Run: `npm run build`
Expected: build completes successfully. (No new pages — only component edits.)

- [ ] **Step 4: Visual regression sweep**

With `npm run dev` running, tour the modal once more for each combination:
- Light mode, English — banner + 3 cells all show bars and %.
- Light mode, Thai — banner caption reads `อัตราการชนะ`; cells show `%` only.
- Dark mode, English — bars visible in both gradient banner and on `--border`-coloured cell tracks.
- Dark mode, Thai — same as above.
- A player with zero matches in at least one category — that category's cell shows no bar/percent; layout still grid-aligned.
- Mobile breakpoint (~375px width via dev tools) — cells stay in 3 columns; nothing overflows; banner bar caption row stays on one line.

- [ ] **Step 5: Final review**

Open the live `.pm-modal` next to `public/player-stats-winloss-mockup.html` (Option B card) and confirm parity. Differences acceptable if they're due to live data; flag any unexpected layout deltas.

No commit for this task — verification only.

---

## Self-Review Notes

- Spec coverage: all four bullets in the spec's "Files Touched" section map to Tasks 1–4 (i18n → Task 2; `PlayerModal.tsx` and `globals.css` → Tasks 3 + 4; helper deferred to `lib/playerStats.ts` → Task 1).
- Edge cases: zero-match category handled in Task 4 Step 1 (`p !== null && …`) and in Task 3 Step 2 (banner null guard).
- Translations: `winRate` added in Task 2, used in Task 3 Step 2 only (cells intentionally show numeric % only — see spec "Cells" section).
- Dark mode: banner bar uses alpha-white track (works on both gradient variants); cell bar has an explicit dark-mode override in Task 4 Step 2 with a verification step to match the project's actual dark-mode selector.
- Acceptance criteria from the spec are exercised by Task 5's visual sweep (full-data player, zero-match player, both languages, both themes, mobile width).

# BWF Ranking Detail — Per-Event Sections

**Status:** Proposed
**Author:** Ed Chuchaisri (with Claude)
**Date:** 2026-06-05
**Related:**
- `docs/superpowers/specs/2026-06-05-bwf-ranking-design.md` (foundational BWF ranking work)
- `docs/superpowers/specs/2026-06-01-player-ranking-detail-design.md` (BAT ranking detail UI)

## Goal

Make the per-player Ranking Detail panel on BWF player profiles reflect BWF's actual ranking algorithm: a player can be ranked in multiple age-group events per discipline, and tournament points from a lower age group contribute to higher age-group rankings at 30% credit. The panel must show one section per ranked event in the active discipline tab, each listing the contributing tournaments at their effective credit value.

## Non-Goals

- Restructuring the BAT Ranking Detail panel. BAT's three-tab Top/Others layout stays exactly as-is.
- Adding any Ranking Detail surface to the Combined provider.
- Bumping the on-disk cache envelope version. The new parsed credits are derived at view time from existing string data.
- Showing rows that count toward a higher-age ranking we don't compute (e.g., players ranked in U17 only, with no U15 entry of their own).

## Background

BWF encodes everything in the `Used for:` marker on each tournament row of `ranking/player.aspx?id=<rid>&player=<id>`. Confirmed from Ravin CHUCHAISRI's real page (`player=5799633`):

| Row source event | Row points | Used for: text                                                 |
|------------------|-----------:|----------------------------------------------------------------|
| MS-U15           | 960        | `Boy's singles U17(288), Boy's singles U15`                    |
| MD-U15           | 1750       | `Boy's doubles U17(525), Boy's doubles U15`                    |
| MS U13           | 2125       | `Boy's singles U15(637.5)`                                     |
| MD U13           | 1750       | `Boy's doubles U15(525)`                                       |

Rules read from the data:

1. The row's **points** column is the *raw* score earned at the tournament.
2. The `Used for:` text lists one or more ranking events the row contributes to.
3. **Parenthesised number** = credit toward that event. When absent, credit equals raw points.
4. The 30% factor (e.g. 960 → 288, 2125 → 637.5) shows up only for cross-tier targets (one age group above the row's source). Same-tier targets carry full points.

Sum of Ravin's BS U15 contributing rows: 960 + 637.5 = 1597.5 ≈ **1598 pts**, matching the overview rank-#10 entry.

So we do **no point math ourselves** — the page gives us per-target credits directly. Our job is parse + display.

## Architecture

The change spans parser → view → UI. BAT call sites are untouched.

### File changes

```
lib/types.ts                              # add RankingTargetCredit + optional field on RankingPlayerTournament
lib/ranking/player-scraper.ts             # parse parenthesised credit into a new structured field
lib/ranking/player-view.ts                # add bwfSectionsForTab() and supporting types
components/RankingDetailTabs.tsx          # branch on provider: BAT unchanged, BWF stacks sections
components/BwfRankingSection.tsx          # NEW: renders one section's Top + Others
components/TournamentRow.tsx              # add optional creditOverride prop
app/player/[provider]/[slug]/page.tsx     # pass provider's Ranking.events through
components/PlayerProfileView.tsx          # thread the new prop down
```

No new API route. No on-disk envelope change. Cache schema is unchanged; only the in-memory derived view is new.

### Provider branch

`RankingDetailTabs` already takes a `provider: ProviderTag` prop (from the prior BWF work). Inside `renderBody()`:

```ts
const top = topRowsForTab(detail, active)             // existing BAT path
if (provider === 'bat') {
  // unchanged: single Top tournaments section + Others section
}
// provider === 'bwf':
const sections = bwfSectionsForTab(detail, active, currentRanking)
if (sections.length === 0) return <Empty />
return sections.map(s => <BwfRankingSection section={s} cutoffs={cutoffs} />)
```

The BAT path stays byte-for-byte identical to today (zero behaviour change for BAT users).

## Types and parser

### `lib/types.ts` (additive)

```ts
export interface RankingTargetCredit {
  /** Event name as printed in the Used-for title, e.g. "Boy's singles U15". */
  eventName: string
  /** Credit value contributed to that event. Equals the row's raw `points`
   *  when no parenthesised value was given. */
  credit: number
}

export interface RankingPlayerTournament {
  // ...existing fields unchanged...
  /** Raw strings parsed from the Used-for marker, e.g.
   *  `["Boy's singles U17(288)", "Boy's singles U15"]`. Kept so BAT call
   *  sites (which only test for length > 0) keep working unchanged. */
  countsTowardRankings: string[]
  /** Structured per-target credits parsed from the same marker. Optional
   *  so previously cached BAT/BWF detail JSONs still load. */
  countsTowardRankingsParsed?: RankingTargetCredit[]
}
```

### `lib/ranking/player-scraper.ts`

Existing `parseMarkerCategories(cell)` keeps returning `string[]` unchanged. A new sibling, `parseMarkerCredits(rowPoints, cell)`, returns `RankingTargetCredit[]`. Both walk the same `<img title="Used for: ...">` content.

```ts
function parseMarkerCredits(rowPoints: number, cell: string): RankingTargetCredit[] {
  const img = cell.match(/<img\b[^>]*title="([^"]+)"[^>]*>/i)
  if (!img) return []
  const title = decodeEntities(img[1])
  const idx = title.indexOf(':')
  const tail = idx >= 0 ? title.slice(idx + 1) : title
  return tail.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    // "Boy's singles U17(288)"  → { eventName: "Boy's singles U17", credit: 288 }
    // "Boy's singles U15"       → { eventName: "Boy's singles U15", credit: rowPoints }
    const m = s.match(/^(.+?)\s*\(([\d.]+)\)\s*$/)
    if (m) return { eventName: m[1].trim(), credit: parseFloat(m[2]) }
    return { eventName: s, credit: rowPoints }
  })
}
```

`parseRow` populates both `countsTowardRankings` and `countsTowardRankingsParsed`. BAT pages produce parsed credits too, but they all equal the row's raw points (no parens in BAT markers) — harmless for BAT call sites that ignore the new field.

## View layer

### `lib/ranking/player-view.ts`

```ts
export interface RankingSectionRow {
  row: RankingPlayerTournament
  /** Credit this row contributes toward this section's ranking event.
   *  Differs from row.points whenever BWF discounts (e.g. cross-tier). */
  creditInThisSection: number
}

export interface RankingSection {
  /** Target ranking event name as printed by BWF, e.g. "Boy's singles U15". */
  eventName: string
  /** Top tournaments (up to TOP_N) ordered newest week first. */
  top: RankingSectionRow[]
  /** Remaining contributing tournaments, ordered by credit desc. */
  others: RankingSectionRow[]
  /** Sum of top[].creditInThisSection — equals BWF's published ranking points. */
  topTotal: number
}

export function bwfSectionsForTab(
  detail: RankingPlayerDetail,
  discipline: Discipline,
  /** Player's slug + current Ranking, used only to look up the player's
   *  rank per target event for section ordering. Both optional — without
   *  them, sections fall back to age-group-desc ordering. */
  rankCtx?: { slug: string; current: Ranking | null },
): RankingSection[]
```

Algorithm (per-tab):

1. **Build the per-event row map.** Iterate `detail.tournaments`. For each row, iterate its `countsTowardRankingsParsed` (falling back to deriving from `countsTowardRankings` if the field is missing — for backward compatibility with caches written before this change). For each parsed target, push `{ row, creditInThisSection: target.credit }` into a map keyed by `target.eventName`.
2. **Filter to the active discipline.** Drop map entries whose event name's discipline (computed via `disciplineOf(eventName)`) doesn't match `discipline`.
3. **Dedup per section.** Within each surviving section, collapse `(weekSortKey(row.week), row.tournamentName)` collisions by keeping the higher `creditInThisSection`. Mirrors BAT's `dedupePerTournament` invariant; protects against the rare case where a tournament had both a U15 and a U17 entry for the same player and both target the same ranking.
4. **Build top + others.** Sort by `creditInThisSection` desc (tie → newer week). `top` = first `TOP_N`, re-sorted newest-week-first. `others` = remainder, sorted by credit desc. `topTotal` = sum of `top[].creditInThisSection`.
5. **Order sections.** If `rankCtx` is provided, look up the player's rank for each section's `eventName` against `rankCtx.current.events[*].entries` by `entry.slug === rankCtx.slug`. Sort ranked-first by rank asc; place unranked sections after, ordered by age-group desc (U23 above U19 above U17 above U15 above U13). Without `rankCtx`, age-desc alone.

Pure function. No I/O. Stable under repeated calls.

The existing `topRowsForTab` and `otherRowsForTab` remain — BAT keeps using them.

## UI

### `RankingDetailTabs.tsx`

Add one new prop:

```ts
interface Props {
  provider: ProviderTag
  slug: string
  initialDetail?: RankingPlayerDetail
  rankingPublishDate?: string
  currentRanking?: Ranking | null    // NEW: for BWF section ordering
}
```

Inside `renderBody()`, branch:

```tsx
if (provider === 'bwf') {
  const sections = bwfSectionsForTab(
    fetchState.detail, active,
    currentRanking ? { slug, current: currentRanking } : undefined,
  )
  if (sections.length === 0) return <div className="pp-rd-empty">{t('rankingDetailEmpty')}</div>
  return <>
    {sections.map(section => (
      <BwfRankingSection
        key={section.eventName}
        slug={slug}
        section={section}
        cutoffs={cutoffs}
        currentRanking={currentRanking}
      />
    ))}
  </>
}
// existing BAT path stays
```

### `BwfRankingSection.tsx` (new)

Renders one `RankingSection`. Header: `eventName` (optional `#rank · 1598 pts` when the player appears in `currentRanking`). Body: a `Top tournaments` heading + Top rows; a `Other tournaments` heading + Others rows.

```tsx
interface Props {
  slug: string                       // player slug, used to look up rank
  section: RankingSection
  cutoffs: ExpiryCutoffs
  currentRanking?: Ranking | null
}

function lookupRank(current: Ranking | null | undefined, eventName: string, slug: string): number | null {
  const ev = current?.events.find(e => e.eventName === eventName)
  return ev?.entries.find(e => e.slug === slug)?.rank ?? null
}

export default function BwfRankingSection({ slug, section, cutoffs, currentRanking }: Props) {
  const { t } = useLanguage()
  const myRank = lookupRank(currentRanking, section.eventName, slug)
  return (
    <section className="pp-rd-section-event">
      <h3 className="pp-rd-section-event-header">
        <span>{section.eventName}</span>
        <span className="pp-rd-section-event-meta">
          {myRank != null && <>#{myRank} · </>}
          {section.topTotal.toLocaleString()} pts
        </span>
      </h3>

      <h4 className="pp-rd-section-subheader">{t('rankingDetailTopTen')}</h4>
      {section.top.map((sr, i) => (
        <TournamentRow
          key={`t-${i}`}
          row={sr.row}
          creditOverride={sr.creditInThisSection}
          expiry={classifyExpiry(sr.row.week, cutoffs)}
        />
      ))}

      {section.others.length > 0 && (
        <>
          <h4 className="pp-rd-section-subheader pp-rd-section-subheader--divided">
            {t('rankingDetailOthersTournaments')}
          </h4>
          {section.others.map((sr, i) => (
            <TournamentRow
              key={`o-${i}`}
              row={sr.row}
              creditOverride={sr.creditInThisSection}
              expiry={classifyExpiry(sr.row.week, cutoffs)}
            />
          ))}
        </>
      )}
    </section>
  )
}
```

`lookupRank` is a small helper that finds the slug in `currentRanking.events[eventName === section.eventName].entries` and returns the rank — `null` if not ranked.

### `TournamentRow.tsx`

Add one optional prop:

```ts
interface Props {
  row: RankingPlayerTournament
  expiry?: ExpiryTier
  creditOverride?: number   // NEW
}
```

When `creditOverride != null && creditOverride !== row.points`, the points cell renders `<raw> → <credit>` (e.g. `2125 → 638`). Otherwise it renders the single existing value. Discount rounding follows BWF's own display: `Math.round(credit)` for the right-hand number (so 637.5 → 638 in the UI, matching what the user sees on the leaderboard total).

### Page wiring

`app/player/[provider]/[slug]/page.tsx` already reads `currentRanking` from `readRankingCache(provider)`. Pass it through:

```tsx
<PlayerProfileView
  record={record}
  playerRankings={...}
  rankingPublishDate={...}
  initialDetail={initialDetail}
  currentRanking={currentRanking}    // NEW
/>
```

`PlayerProfileView` threads it into `<RankingDetailTabs currentRanking={currentRanking} />`. No other component cares about the new prop, and the prop type is `Ranking | null` so the existing nullable read path stays safe.

## Sharp edges

1. **Backward compat with cached detail JSONs.** A `RankingPlayerDetail` written before this change has rows with no `countsTowardRankingsParsed`. The view layer must accept this and re-parse from `countsTowardRankings` strings on the fly. Easiest: a one-liner `parseTargetString(raw, rowPoints)` that handles a single entry like `"Boy's singles U17(288)"`. If both fields are present, prefer the structured one.

2. **Empty / unmarked rows.** A row whose Used-for marker is empty (`countsTowardRankings.length === 0`) does not appear in any section. The earlier "Others" bucket in the BAT view *includes* such rows — for BWF we intentionally drop them because they contribute nothing. Document this in the function comment.

3. **`topTotal` vs published rank points.** Should be exactly equal in practice; minor float drift (the 637.5 case) is acceptable. We use `Math.round` when displaying the section total to match BWF's printed rank value.

4. **Discipline classifier on full event names.** `disciplineOf` today operates on tokens like `"BS U15"`, not on full strings like `"Boy's singles U15"`. We need either a new classifier that handles the full form, or a small normaliser (`"Boy's singles U15"` → `"BS U15"`) before calling the existing one. Recommend: add a new `disciplineOfEventName(name)` that handles `"singles" → singles`, `"doubles" → doubles`, `"mixed" → mixed`. Smaller surface than retro-fitting the old one.

5. **Sections without any current ranking match.** Possible when the player has historical rows targeting an event they're no longer ranked in (e.g., aged out of U13). We still render the section — the row data shows what would have counted — but the header shows `eventName · {topTotal} pts` with no `#rank`. This matches what BWF's own page does.

## Test plan

- `__tests__/ranking-player-scraper.test.ts` — new cases:
  - `parseMarkerCredits` of `"Boy's singles U17(288), Boy's singles U15"` with rowPoints=960 returns `[{eventName: "Boy's singles U17", credit: 288}, {eventName: "Boy's singles U15", credit: 960}]`.
  - Decimal credit preserved: `(637.5)` parses to `637.5`.
  - Empty / missing marker returns `[]`.

- `__tests__/ranking-player-view.test.ts` — new `describe('bwfSectionsForTab')`:
  - Single-event player: only U15 entries → one section, all rows in it, topTotal = sum of credits.
  - Cross-tier carry: U15 row + U13 row both targeting U15 → one U15 section, U13 row's credit is the parens value (not raw).
  - Carry-up: a U15 row targeting both U17 (discounted) and U15 (full) → two sections, same row appears in both with different credits.
  - Dedup: two rows with same (week, tournamentName) targeting the same event → kept entry is the one with the higher credit.
  - Section ordering: with a `current` argument, the player's rank #10 in U15 vs unranked in U17 → U15 section first.

- `__tests__/ranking-bwf-ravin-fixture.test.ts` — capture `fixtures/ranking-player-ravin-bwf.html` and assert: parser produces 4 tournament rows; `bwfSectionsForTab(detail, 'singles')` produces a `Boy's singles U15` section with `topTotal === 1598` (after rounding); the U13 row appears with `creditInThisSection === 637.5`.

- Visual smoke (manual): open Ravin's BWF profile in dev, confirm Singles tab renders a U15 section showing the MITH YONEX U15 row (960 pts) and the YONEX CP U13 row with `2125 → 638`. Confirm Doubles tab renders the equivalent BD U15 section.

## What we are NOT doing

- Touching BAT's Ranking Detail UI. Confirmed out of scope.
- Adding a Combined-provider Ranking Detail.
- Changing the on-disk cache schema or invalidating existing caches.
- Showing sections for events where the player has no contributing rows (would just be empty).
- Recomputing or validating BWF's discount math ourselves — we trust the page.

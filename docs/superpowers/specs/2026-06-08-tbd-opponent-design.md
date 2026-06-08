# TBD Opponent Hint in Match Schedule

**Date:** 2026-06-08

## Summary

When a scheduled match has one team populated and the other empty (because the
opponent is the winner of a not-yet-played previous-round match), show the two
potential opponents inline as "A or B" — read from the bracket HTML.

Concrete example: in YONEX-SINGHA-BAT, BS U13 R64 on 20/06,
ธัชธรรม์ เหมาะประสิทธิ์ / วรสุภาพ is scheduled but the opposing slot is empty
because it waits on the R128 match between รณกร and Wong Hao Feng RYAN. After
this change, the empty side renders as "รณกร or Wong Hao Feng RYAN" (dimmer,
italic, smaller), so the user knows who could face ธัชธรรม์.

## Scope

- **In scope:** BAT only. Single-elimination brackets. One round back only.
  Render only when exactly one team is empty.
- **Out of scope:** BWF provider, recursive resolution through multiple rounds,
  interactive hover/click highlight of the source match, search/filter matching
  against TBD candidate names, round-robin / qualifier rounds.

## Architecture

Two new pieces; both reuse infrastructure already built for `siblingPlayerIds`:

1. **`parseBracketFeeders(html)` in `lib/scraper.ts`** — a new bracket walker
   that returns, per round-`R+1` slot, the named players from the two
   `R`-round matches that feed it.
2. **Schedule enrichment in `app/api/matches/route.ts`** — extend the existing
   per-draw bracket walk (currently `enrichWithSiblings`, renamed to
   `enrichBracketContext`) to also build a feeder lookup and stamp
   `tbdOpponents` onto matching schedule entries.

No new BAT fetches. The bracket HTML is already pulled and cached for siblings;
feeders are extracted from the same HTML.

## Data Layer

### `parseBracketFeeders` (new, `lib/scraper.ts`)

```ts
export function parseBracketFeeders(
  html: string,
): Array<{ players: string[]; childMatches: MatchPlayer[][][] }>
```

Returns one entry per round-`R+1` slot:
- `players` — sorted player IDs of the R+1 match (same join-key shape as
  `parseBracketSiblings` produces, so the two share `matchPlayerKey`).
- `childMatches` — the **two** R-round child matches whose winners feed
  this R+1 slot. Shape per match: `MatchPlayer[][]` (the two teams of that
  match, with empty/bye teams filtered out and slots with empty names
  dropped from each team). Length of outer array is exactly 2 (or 0 if the
  wrapper isn't a standard pair, in which case the slot is omitted entirely).

**Positional rule** (verified against `parseBracket`):
- Round R has `2N` matches grouped into `N` `.bracket-round__match-group-wrapper`
  elements (2 matches per wrapper).
- Round R+1 has `N` matches — one per R wrapper.
- R wrapper at index `gi` contains 2 matches whose winners feed the two
  slots of R+1 match at flat-index `gi`.

We do **not** rely on the "match 0 → top slot" positional convention —
side selection is done by elimination at stamp time (see below).

**Algorithm:**

```
slides = bracket.find('swiper-container > swiper-slide')
           .filter(slide => slide.find('.bracket-round__match-group-wrapper').length > 0)

for r in 0 .. slides.length - 2:
  rGroups   = slides[r].find('.bracket-round__match-group-wrapper')
  r1Matches = slides[r+1].find('.bracket-round__match-group-wrapper .match')  // flat

  for gi in 0 .. rGroups.length - 1:
    rChildMatches = rGroups[gi].find('.match')             // 2 matches
    if rChildMatches.length !== 2: continue
    childMatchesData = rChildMatches.map(extractMatchTeams) // per match: MatchPlayer[][]

    r1Match = r1Matches[gi]
    r1PlayerIds = extractFlatPlayerIds(r1Match).sort()
    if r1PlayerIds.length === 0: continue
    emit { players: r1PlayerIds, childMatches: childMatchesData }
```

Helpers:
- `extractMatchTeams(matchEl)` walks `.match__row` (one per team) and for
  each row collects `{ name, playerId }` from each `.match__row a`,
  dropping slots whose `name` is empty. Then drops whole teams that
  end up empty. Returns `MatchPlayer[][]` of length 0, 1, or 2.
- `extractFlatPlayerIds(matchEl)` mirrors `parseBracketSiblings`'s player
  walk — all `.match__row a` inside the match, flat — used purely as a
  join key against the schedule's `matchPlayerKey`.

**Side selection happens at stamp time, not parse time.** The parser emits
both child matches; the enricher figures out which one is the "self" match
(the one containing the populated R+1 player) by elimination, and treats
the *other* as the source of the TBD candidates. This avoids relying on
DOM ordering as a load-bearing assumption.

### Cache addition in `lib/bracket-cache.ts`

```ts
export const feederLookupCache = new Map<
  string,                                              // bracketKey (tournament:drawNum)
  { lookup: Map<string, MatchPlayer[][][]>; ts: number }
>()
```

- Key: same `bracketKey` as `siblingLookupCache`.
- Value: `lookup` maps the R+1 match's sorted-player-ID join key →
  `childMatches` (the unfiltered pair of child matches, each as
  `MatchPlayer[][]`). Stamped with the owning `bracketCache` entry's
  `ts` for invalidation on bracket refresh, same pattern
  `siblingLookupCache` uses today.

Storing both child matches per R+1 slot (rather than pre-selecting a side)
lets the enricher do elimination-based side selection without re-parsing.

### Type extension in `lib/types.ts`

Add to `MatchEntry`:

```ts
// Potential opponents from the bracket's prior round when one side of the
// match has no players yet (waiting on a previous-round match to resolve).
// Length 1 means the other prior-round side was a bye.
tbdOpponents?: MatchPlayer[][]
```

Length semantics:
- 0 elements → no usable feeders. Treated as undefined; UI renders nothing
  special.
- 1 element → only one prior-round source has named players (the other was
  a bye or itself TBD). UI renders just that one team without an "or".
- 2 elements → both prior-round sources are real matches. UI renders
  "A or B".

## Schedule Enrichment

### Refactor `app/api/matches/route.ts`

Rename `enrichWithSiblings` → `enrichBracketContext`. Same per-draw loop,
same per-draw error suppression, same `siblingLookupCache` warming — plus
the new feeder lookup built from the same HTML in the same pass:

```ts
const cachedFeeder = feederLookupCache.get(key)
let feederLookup = cachedFeeder && cachedFeeder.ts === bracketTs ? cachedFeeder.lookup : null
if (!feederLookup) {
  const entries = parseBracketFeeders(html)
  feederLookup = new Map<string, MatchPlayer[][][]>()
  for (const e of entries) feederLookup.set(e.players.join(','), e.childMatches)
  if (feederLookup.size > 0) feederLookupCache.set(key, { lookup: feederLookup, ts: bracketTs })
}
if (feederLookup.size > 0) feederByDraw.set(drawNum, feederLookup)
```

Per-match stamping (after the existing sibling stamp) uses
elimination-based side selection:

```ts
const onlyOneSideEmpty =
  (m.team1.length === 0) !== (m.team2.length === 0)
if (onlyOneSideEmpty) {
  const childMatches = feederByDraw.get(m.drawNum)?.get(matchPlayerKey(m))
  if (childMatches && childMatches.length === 2) {
    const populated = m.team1.length > 0 ? m.team1 : m.team2
    const populatedIds = new Set(populated.map((p) => p.playerId).filter(Boolean))

    // Identify the "self" child match: the one whose players overlap the
    // populated R+1 side. The OTHER child match is the source of the
    // TBD candidates.
    const selfIdxs = childMatches
      .map((child, i) => ({
        i,
        ids: child.flat().map((p) => p.playerId).filter(Boolean),
      }))
      .filter(({ ids }) => ids.some((id) => populatedIds.has(id)))
      .map(({ i }) => i)

    // Skip if ambiguous: 0 matches (populated player not in either child;
    // e.g. byes / unusual seeding) or 2 matches (data error). Better to
    // omit than to display a wrong pairing.
    if (selfIdxs.length === 1) {
      const otherIdx = selfIdxs[0] === 0 ? 1 : 0
      const candidates = childMatches[otherIdx].filter((team) => team.length > 0)
      if (candidates.length > 0) m.tbdOpponents = candidates
    }
  }
}
```

`matchPlayerKey(m)` is the existing helper (sorted, comma-joined player IDs).
When one side is empty, the key derives from the populated side only — which
is exactly what `parseBracketFeeders` emits as `players` for R+1 matches.

### Skip conditions

- `ref.provider !== 'bat'` → entire enrichment already skipped on non-BAT
  paths today; no change needed.
- `m.team1.length === m.team2.length` (both empty or both populated) → skip
  the per-match stamping.
- No bracket HTML and `fetchAndCache` fails → existing try/catch swallows
  the per-draw error; no TBD line for that draw.

### Where it runs

- Per-day branch (BAT only), after `parseMatchesPartial`. Future-day
  schedules — where TBD slots actually appear — flow through this branch.
- **Not** on the full-schedule path (BWF / cold full fetch). Same as siblings
  today. The client backfills by fetching the per-day endpoint for
  `currentDate`, which does run `enrichBracketContext`.

## Rendering

### `components/MatchSchedule.tsx`

`renderMatch` currently renders each team unconditionally:

```tsx
<div className="ms-team ms-team--2 ms-d">
  {m.team2.map((p, i) => <div>...{p.name}...</div>)}
</div>
```

When `m.team2.length === 0 && m.tbdOpponents`, render the candidate list
instead:

```tsx
<div className="ms-team ms-team--2 ms-d">
  <div className="ms-tbd-opp">
    {m.tbdOpponents.map((team, i) => (
      <span key={i}>
        {i > 0 && <span className="ms-tbd-or"> {t('tbdOr')} </span>}
        {team.map((p, j) => (
          <span key={j}>
            {j > 0 && '/'}
            <span>{p.name}</span>
          </span>
        ))}
      </span>
    ))}
  </div>
</div>
```

Same shape on the mobile `.ms-board` row (the second renderer block in
`renderMatch`) so the compact view also gets the TBD line.

### Render gating

A TBD line is rendered only when **all three** conditions hold:

1. The side's `team*.length === 0`.
2. The *other* side has at least one player (so we don't double-render
   on a both-empty match).
3. `m.tbdOpponents` exists and has at least one candidate.

### No interactions

- Names are plain `<span>`s, not links.
- No hover, no click, no scroll-to.
- `nameCls` and the player-onClick handler are deliberately **not** applied —
  TBD candidates aren't yet that match's players, and applying highlights
  would conflict with the dimmed visual style.

### i18n entry in `lib/i18n.ts`

```ts
tbdOr: { en: 'or', th: 'หรือ' }
```

### CSS in `app/globals.css`

```css
.ms-tbd-opp {
  font-style: italic;
  opacity: 0.7;
  font-size: 0.9em;
}
.ms-tbd-or { opacity: 0.85; }
```

Opacity-based dimming works in both light and dark mode (consistent with how
other `.ms-*` muted styles handle theme variation). Verify against existing
tokens during implementation; if opacity reads poorly in dark mode, switch
to a `--color-text-muted` variable.

## Edge Cases

| Case | Behavior |
|---|---|
| Both teams empty | Skip — no TBD line. |
| Both teams populated | Skip — no TBD line. |
| Prior round (the source child match) has a bye on one side | That team filters to 0 players and is dropped → `candidates` has 1 entry, rendered as just "A" with no " or ". |
| Prior round (the source child match) itself fully TBD (R128 waiting on R256) | Both teams of the source match filter to 0 players → `candidates = []` → no TBD line. Matches "one round back only" scope. |
| Populated R+1 player not in either child match (unusual seed / direct entry) | `selfIdxs.length === 0` → skip silently, no TBD line. Better to omit than guess. |
| Populated R+1 player in both child matches (data error) | `selfIdxs.length === 2` → skip silently, no TBD line. |
| Match not in the bracket (round-robin, qualifier) | `feederLookup.get(key)` misses → no TBD line. |
| Bracket fetch fails for one draw | Per-draw try/catch swallows the error; other draws unaffected. |
| Doubles, only one of the prior pair is a named team | Candidates list has 1 entry (the named team); rendered without " or ". |
| Live data updates (R128 finishes mid-day) | SignalR-triggered `fresh=1` refetch re-runs enrichment. Once R64 gets a populated team2, the `onlyOneSideEmpty` gate fails → `tbdOpponents` not set → UI shows the real opponent. |
| Doubles ID-key mismatch between schedule and bracket | Same risk as siblings today. `matchPlayerKey` sorts and joins consistently across both code paths; mismatches mean no TBD line, not wrong data. |

## Failure Modes & Blast Radius

- **`parseBracketFeeders` positional rule off for some layout** → R wrapper
  `gi` doesn't actually feed R+1 match flat-index `gi`. Manifests as wrong
  "A or B" names. Detectable visually; non-destructive. Note that the
  *positional* assumption is only about the R-to-R+1 mapping (wrapper to
  match by index) — the within-wrapper top/bottom convention is sidestepped
  by elimination-based side selection.
- **Elimination ambiguity** — if a populated R+1 player appears in neither
  child match (e.g. unusual seeding paths) or both (data error), we skip
  the TBD line. Safe by design.
- **Memory footprint** — one `Map<bracketKey, ...>` entry per draw, similar
  size to `siblingLookupCache`. Negligible.
- **No new upstream fetches** — bracket HTML and parser already run for siblings.

## Testing

**Capture the fixture first.** Before implementing, capture the actual
YONEX-SINGHA-BAT BS U13 bracket HTML from `rawHtmlCache` (or a live BAT
fetch) and commit it as a fixture. The test assertions below are what
discriminate a correct positional implementation from an incorrect one;
they're worthless without a real-world example to lock in.

- **Unit test `parseBracketFeeders`** against the captured bracket fixture.
  Locate the R+1 slot whose `players` contains ธัชธรรม์'s player ID.
  Assert that exactly one of the two emitted `childMatches` contains
  ธัชธรรม์'s ID, and the other contains รณกร's and Wong Hao Feng RYAN's
  IDs (each as a separate team of length 1, since singles).
- **Unit test `enrichBracketContext`'s side selection.** With a synthetic
  feeder lookup, verify:
  - Exactly one side empty + populated player in child[0] → `tbdOpponents`
    = teams of child[1].
  - Exactly one side empty + populated player in child[1] → `tbdOpponents`
    = teams of child[0].
  - Populated player in neither → no `tbdOpponents`.
  - Populated player in both → no `tbdOpponents`.
  - Both sides populated → no `tbdOpponents`.
  - Both sides empty → no `tbdOpponents`.
- **Unit test rendering** — `MatchSchedule` renders the candidate names
  with the i18n "or" separator for 2-candidate cases and drops the
  separator for 1-candidate cases. Doubles teams render with "/" between
  partners.
- **Manual verification** — pull up the BS U13 schedule for 20/06 of the
  YONEX-SINGHA-BAT tournament in the live app, confirm the TBD line on
  ธัชธรรม์'s R64 match shows "รณกร หรือ Wong Hao Feng RYAN" (Thai) or
  "รณกร or Wong Hao Feng RYAN" (English).

## Files Touched

- `lib/scraper.ts` — add `parseBracketFeeders` plus `extractMatchTeams`
  and `extractFlatPlayerIds` helpers.
- `lib/bracket-cache.ts` — add `feederLookupCache` export.
- `lib/types.ts` — add `tbdOpponents?: MatchPlayer[][]` to `MatchEntry`.
- `app/api/matches/route.ts` — rename `enrichWithSiblings` →
  `enrichBracketContext`, extend per-draw loop to also build feeder lookup,
  add per-match stamping with the one-side-empty gate.
- `components/MatchSchedule.tsx` — render `tbdOpponents` in empty team
  slots on both desktop and mobile renderers.
- `lib/i18n.ts` — add `tbdOr` translation.
- `app/globals.css` — add `.ms-tbd-opp` and `.ms-tbd-or` styles.
- `__tests__/...` — new tests for `parseBracketFeeders`,
  `enrichBracketContext`, and the rendering branch.

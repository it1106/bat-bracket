# TBD Opponent Hint — Both Sides

**Date:** 2026-06-09

**Status:** ❌ Not feasible with current data sources. Spec retained for the
historical record. Implementation was attempted in-session against this
spec, then reverted after manual verification confirmed the schedule data
lacks the information required to join both-empty matches to the bracket.

**Builds on:** `docs/superpowers/specs/2026-06-08-tbd-opponent-design.md`

## Why this isn't feasible

The single-empty case works because the populated team's player IDs serve
as the join key into `feederLookupCache` — the cache maps
`sortedPlayerIds → childMatches`, and `parseBracketFeeders` emits R+1
slot entries keyed on those player IDs.

For a **both-empty** schedule entry, there are no player IDs to join
against the bracket:

- The schedule HTML for an unscheduled / unplayed future-round match
  carries only `draw`, `round`, and (sometimes) `court`/`time`. No
  bracket-position identifier, no slot number, no `data-match-id`.
- The bracket HTML carries no `datetime` and no court/hall information
  on any match (verified against `fixtures/bracket-bat-ysb-bsu13.html`),
  so `(court, scheduledTime)` is not a viable join either.
- Multiple R32 matches in the same draw share `round=Round of 32`, so
  `(drawNum, round)` collides — no way to discriminate which R32 slot
  a given schedule entry corresponds to.

The architecture below assumed `enrichBracketContext` could locate the
bracket entry for a both-empty schedule entry. It can't. The architecture
itself is sound; the join is the blocker.

## Original spec follows (preserved for context)

---

## Summary

Extend the TBD opponent hint so that a scheduled match whose **both** sides
are empty (waiting on two prior-round matches) renders candidate opponents
on both slots. Top slot displays the top child match's teams; bottom slot
displays the bottom child match's teams — same "A or B" inline style.

Concrete example: in YONEX-SINGHA-BAT BS U13, a R32 match scheduled before
both feeding R64 matches have been played should render as
"(R64 top candidates) vs (R64 bottom candidates)" rather than two empty
slots.

## Scope

- **In scope:** BAT only. Single-elimination brackets. One round back only.
  When both sides are empty, stamp candidates on both slots using positional
  convention (top child → team1, bottom child → team2).
- **Out of scope:** BWF provider, recursive resolution through multiple
  rounds, interactive hover/click highlight, search/filter matching against
  TBD candidate names, round-robin / qualifier rounds. (Same as parent spec.)

## Architecture

No new bracket fetching. No new parser. The existing `parseBracketFeeders`
already emits `childMatches: MatchPlayer[][][]` per R+1 slot — two child
matches, each as `MatchPlayer[][]`. The cache shape is unchanged.

The only conceptual change is **side selection**: today the enricher picks
the candidates from a single child (the "other" child by elimination)
because exactly one side of the schedule entry is empty. When both sides
are empty, elimination doesn't apply — there's no populated player to
discriminate against. We use the BAT bracket's positional convention
instead: child[0] (the top match in DOM order) feeds the top slot of the
R+1 match (team1); child[1] feeds the bottom slot (team2).

This convention is **already load-bearing** in `lib/scraper.ts`'s
`parseBracket` (lines 448–452: `mi === 0 ? slot1Top : slot2Top`). We are
not introducing a new fragile assumption — we are using the same one
elsewhere in the codebase.

## Data Layer

### Type change in `lib/types.ts`

Replace the unified `tbdOpponents` field with per-slot fields:

```ts
// Before
tbdOpponents?: MatchPlayer[][]

// After
tbdOpponentsTeam1?: MatchPlayer[][]
tbdOpponentsTeam2?: MatchPlayer[][]
```

Length semantics per field are unchanged: 0 elements → treated as
undefined; 1 element → renders without "or"; 2 elements → "A or B".

### No changes to:

- `lib/scraper.ts` (`parseBracketFeeders`, `extractMatchTeams`,
  `extractFlatPlayerIds`).
- `lib/bracket-cache.ts` (`feederLookupCache`).
- `lib/tbdOpponents.ts` (`selectTbdCandidates`).

## Schedule Enrichment

### Replace the per-match block in `enrichBracketContext`

In `app/api/matches/route.ts`, the existing per-match stamping block:

```ts
const feederLookup = feederByDraw.get(m.drawNum)
if (feederLookup) {
  const onlyOneSideEmpty =
    (m.team1.length === 0) !== (m.team2.length === 0)
  if (onlyOneSideEmpty) {
    const childMatches = feederLookup.get(key)
    if (childMatches) {
      const populated = m.team1.length > 0 ? m.team1 : m.team2
      const candidates = selectTbdCandidates(populated, childMatches)
      if (candidates) m.tbdOpponents = candidates
    }
  }
}
```

Becomes:

```ts
const feederLookup = feederByDraw.get(m.drawNum)
if (feederLookup) {
  const childMatches = feederLookup.get(key)
  if (childMatches && childMatches.length === 2) {
    const t1Empty = m.team1.length === 0
    const t2Empty = m.team2.length === 0

    if (t1Empty !== t2Empty) {
      // Exactly one side empty — elimination (unchanged behavior).
      const populated = t1Empty ? m.team2 : m.team1
      const candidates = selectTbdCandidates(populated, childMatches)
      if (candidates) {
        if (t1Empty) m.tbdOpponentsTeam1 = candidates
        else m.tbdOpponentsTeam2 = candidates
      }
    } else if (t1Empty && t2Empty) {
      // Both sides empty — positional convention.
      // child[0] = top child match → feeds team1 (top slot).
      // child[1] = bottom child match → feeds team2 (bottom slot).
      const top = childMatches[0].filter((team) => team.length > 0)
      const bot = childMatches[1].filter((team) => team.length > 0)
      if (top.length > 0) m.tbdOpponentsTeam1 = top
      if (bot.length > 0) m.tbdOpponentsTeam2 = bot
    }
    // Both sides populated → no TBD line.
  }
}
```

### Skip conditions

Unchanged from parent spec:

- `ref.provider !== 'bat'` → entire enrichment skipped on non-BAT paths.
- No bracket HTML and `fetchAndCache` fails → per-draw try/catch swallows.
- `feederLookup.get(key)` misses (round-robin, qualifier, no bracket match)
  → no TBD line on either side.

## Rendering

### `components/MatchSchedule.tsx`

Each slot reads its own per-side field. The "*other side has at least one
player*" gate from the parent spec is **removed** — it existed only to
prevent the unified field from rendering on a both-empty match. Per-side
fields make the per-side presence check sufficient.

**Desktop team1 (currently around `MatchSchedule.tsx:319`):**

```tsx
<div className={`ms-team ms-team--1 ms-d${m.winner === 1 ? ' winner' : ''}`}>
  {m.team1.length === 0 && m.tbdOpponentsTeam1 && m.tbdOpponentsTeam1.length > 0
    ? renderTbdOpp(m.tbdOpponentsTeam1)
    : m.team1.map(...) /* unchanged */}
</div>
```

**Desktop team2 (around line 354):**

```tsx
<div className={`ms-team ms-team--2 ms-d${m.winner === 2 ? ' winner' : ''}`}>
  {m.team2.length === 0 && m.tbdOpponentsTeam2 && m.tbdOpponentsTeam2.length > 0
    ? renderTbdOpp(m.tbdOpponentsTeam2)
    : m.team2.map(...) /* unchanged */}
</div>
```

**Mobile board rows (around lines 380 and 400):** same per-side conditional,
identical shape, reading the same per-side field as the desktop row.

`renderTbdOpp` is unchanged. i18n key `tbdOr` and CSS `.ms-tbd-opp` /
`.ms-tbd-or` are unchanged.

### Render gating

A TBD line renders for a given side iff:

1. That side's `team*.length === 0`.
2. That side's `tbdOpponentsTeam*` is defined and has at least one element.

No cross-side checks. Both sides can render independently.

## Edge Cases

| Case | Behavior |
|---|---|
| Both teams populated | No TBD line either side. |
| Exactly one side empty | Elimination via `selectTbdCandidates`; only that side stamps a field. (Same as today.) |
| Both empty, both children have named teams | Both sides stamp their respective candidates → "(A or B) vs (C or D)". |
| Both empty, top child fully TBD | `tbdOpponentsTeam1` stays undefined (top is filtered to 0 teams) → team1 renders the empty `team1.map`. team2 renders its candidates. |
| Both empty, top child has a bye on one side | `tbdOpponentsTeam1` has 1 entry → renders as "A" without " or ". |
| BAT bracket flips top/bottom DOM order | Sides displayed swapped — non-destructive, visible. Same risk profile as `parseBracket`. |
| Live update — top child completes mid-day | SignalR refetch re-runs enrichment. Once team1 has a player, the `team1.length === 0` gate fails, `tbdOpponentsTeam1` is omitted, team1 renders the real player. team2 still TBD shows its candidates. |
| Match not in the bracket (round-robin, qualifier) | `feederLookup.get(key)` misses → no TBD line either side. |
| Bracket fetch fails for one draw | Per-draw try/catch swallows the error; other draws unaffected. |

## Failure Modes & Blast Radius

- **Mistaken positional mapping for one bracket layout** → swapped names on
  both-empty matches. Detectable visually; non-destructive. Same risk
  profile as `parseBracket` today (which already relies on the convention).
- **Memory footprint** — unchanged. Same `feederLookupCache` data, same
  per-draw entries.
- **No new upstream fetches** — bracket HTML already pulled.
- **Field rename of `tbdOpponents` → `tbdOpponentsTeam1` / `tbdOpponentsTeam2`**
  — call sites are limited to the route, the MatchSchedule component, and
  its tests. Grep before editing.

## Testing

- **Update `__tests__/MatchSchedule.tbdOpp.test.tsx`:**
  - Rename `tbdOpponents` references throughout to the side-specific fields.
  - Update the test currently asserting "both empty → no TBD line": its new
    behavior is "both empty + both per-side fields set → both sides render
    candidate lists, with distinct candidates on each side".
  - Add a new test for the single-empty case with the new field (to lock in
    that we stamp only the empty side's field, not both).
- **Update `__tests__/enrich-bracket-context.test.ts`:**
  - `selectTbdCandidates` tests are unchanged.
  - Add a positional-convention assertion using the fixture: pick any
    R+1 slot from `parseBracketFeeders(html)`, simulate a schedule entry
    with both teams empty matching that slot's `players` key, run the
    new enrichment block, verify `tbdOpponentsTeam1` mirrors child[0]'s
    teams (filtered) and `tbdOpponentsTeam2` mirrors child[1]'s teams.
- **Manual verification** — locate a real both-empty future-round match
  in the live app (R32 scheduled in advance, both R64 feeders pending),
  confirm both sides render distinct candidate lists.

## Files Touched

- `lib/types.ts` — rename `tbdOpponents` → per-side fields.
- `app/api/matches/route.ts` — replace the per-match TBD stamping block.
- `components/MatchSchedule.tsx` — update 4 render sites (desktop + mobile
  for team1 and team2) to read the per-side fields.
- `__tests__/enrich-bracket-context.test.ts` — add both-empty positional test.
- `__tests__/MatchSchedule.tbdOpp.test.tsx` — rename fields; update
  both-empty case; add single-empty assertion.

No changes to `lib/scraper.ts`, `lib/bracket-cache.ts`, `lib/tbdOpponents.ts`,
`lib/i18n.ts`, `app/globals.css`, or the captured fixture.

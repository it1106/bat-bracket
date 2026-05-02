# Next Opponent Highlight

**Branch:** next-opp  
**Date:** 2026-05-02

## Summary

When a user hovers or clicks a `.ms-match` card in the Match Schedule, highlight the specific next-round match that the winner would play in, should they advance.

## Data Layer

### `buildNextOppMap(groups: MatchScheduleGroup[]): Map<string, string>`

A pure function local to `MatchSchedule.tsx`. Returns a map of `matchKey → nextOppMatchKey`.

**Algorithm:**
1. Walk all groups and matches. For each, record `{ key: "${gi}-${mi}", drawNum, round }`.
2. Group records by `drawNum`, then by `round`.
3. Within each draw, sort rounds by match count descending (most matches = earliest/first round).
4. For consecutive round pairs `(R, R+1)`:
   - Match at position `p` (0-indexed by appearance order) in R → position `floor(p/2)` in R+1.
   - If `floor(p/2)` is out of bounds in R+1, skip (bracket size mismatch — rare edge case).
5. Final round (last in sorted list) gets no mapping.

**Assumption:** Within a given draw+round, matches appear in the schedule in bracket order. This holds in the common case (tournament schedule mirrors the bracket). If it doesn't hold for a particular draw, the feature highlights a wrong match gracefully — no crash, no broken UI.

**matchKey scheme:** unchanged from existing code — `"${gi}-${mi}"` where `gi` is group index and `mi` is the absolute match index within `groups[gi].matches`.

## State

Two new `useState` fields in `MatchSchedule`:

| Field | Type | Lifecycle |
|---|---|---|
| `hoveredKey` | `string \| null` | Set on `mouseenter`, cleared on `mouseleave` |
| `lockedKey` | `string \| null` | Toggled on click (same key → null; new key → set); cleared by ESC |

**Derived values (no extra state):**
- `activeKey = lockedKey ?? hoveredKey`
- `nextOppKey = activeKey ? nextOppMap.get(activeKey) ?? null : null`

## Interactions

- **mouseenter** `.ms-match` → `setHoveredKey(matchKey)`
- **mouseleave** `.ms-match` → `setHoveredKey(null)`
- **click** `.ms-match` → toggle `lockedKey` (same key → clear; different → set)
- **ESC keydown** (global, within component) → `setLockedKey(null)`

The existing click handlers on `.ms-event`, player names, H2H button, and order pill are on child elements and are unaffected. The new click handler is on the `.ms-match` wrapper div.

## Visual

Two new CSS classes in `globals.css`:

### `.ms-match--active`
The source match (hovered or locked). Subtle left-border accent in the primary color to indicate it is the reference point. Low visual weight — should not distract from the score/players.

### `.ms-match--next-opp`
The target (next-round) match. Amber/yellow tinted background + colored border. Clearly distinct from the active source. Should be visible when scrolling to find the target match.

Dark-mode variants for both classes.

## Scope

- Changes confined to `MatchSchedule.tsx` and `globals.css`.
- No changes to types, API routes, or other components.
- No new API calls.

## Out of Scope

- Exact bracket-position cross-referencing via bracket HTML (Approach 2).
- Showing the "previous round" match that fed into the current match.
- Highlighting when a player is searched/filtered.

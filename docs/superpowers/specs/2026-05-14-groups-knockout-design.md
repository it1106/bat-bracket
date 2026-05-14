# Group-stage tournament support (groups + knockout)

**Status:** design
**Date:** 2026-05-14
**Reference tournament:** SAT NSDF Badminton Thai Domestic Power 2026 Final
(`a2812d92-b33f-4f37-ac72-3310bb1be0f1`)

## Summary

Add first-class support for tournaments that combine round-robin group stages
with single-elimination playoffs. Each "event" (e.g. `BS U11`) consists of N
round-robin **group draws** (each with 2–4 players) plus one **playoff draw**
(8-slot single elimination). On BAT these appear as separate rows in the draws
table, named `<Event>` (Elimination, type "Playoff") and
`<Event> - Group A`…`Group H` (Round Robin, type "Main Draw").

The reference tournament has 4 age divisions × 5 events × 9 draws = ~180 draw
rows that need to be presented as 20 navigable events.

## Goals

- Browse all events in the dropdown without drowning in 180 entries.
- See the full state of an event (all groups + playoff) on a single page.
- Standings table per group with W/L/Pts and "advances" indicator.
- Round-robin matches integrate with the existing schedule, live-score, search,
  share-as-image, and dark-mode features without per-feature special cases.
- **Zero behavior change** for tournaments that don't use group stages.

## Non-goals

- BWF provider support for grouped events. The BWF provider throws
  `NotImplementedError` from `getEventBundle`; group-stage formats on BWF are
  out of scope for this phase. The dropdown for BWF tournaments never produces
  a bundle option, so this method is never called in practice.
- Group-stage formats other than `<Event> - Group X` naming (BAT's only
  observed convention).
- Long-press "share whole group as image" (Phase 2).
- Custom "next opponent" logic for round-robin matches (no sibling concept
  exists in round-robin).

## User decisions captured during brainstorming

| Decision | Choice |
|---|---|
| Scope | Full first-class support |
| Event view layout | Tabs (`Groups` \| `Playoff`) |
| Groups tab layout | Standings always visible; matches collapsed by default, expandable per group |
| Dropdown | Event-level only (collapsed); navigation to specific groups happens inside the Groups tab |
| Playoff renderer | Reuse existing `BracketCanvas` / `parseBracket` verbatim (playoff is a normal single-elim bracket) |

## Architecture

```
draws list  ──►  detectGroupedDraws  ──►  annotated DrawInfo[]
                                              │
                                              ▼
                                       eventOptions[]
                                              │
                          ┌───────────────────┴───────────────────┐
                          ▼                                       ▼
                  isBundle: false                          isBundle: true
                          │                                       │
                          ▼                                       ▼
                  /api/bracket  ──►  BracketCanvas         /api/event-bundle  ──►  EventBundleView
                                                                    │
                                                                    ▼
                                                            ┌───────┴───────┐
                                                            ▼               ▼
                                                       Groups tab      Playoff tab
                                                       (GroupCard×N)   (BracketCanvas, reuse)
```

The detection step runs once on the draws list and adds `eventName`,
`groupLetter`, `isPlayoff` to each `DrawInfo`. Everything downstream (dropdown,
fetch, render) branches on whether the selected option `isBundle`. Non-grouped
events follow exactly the existing single-bracket code path.

## Data types

Added to `lib/types.ts`:

```ts
export interface StandingsRow {
  position: number
  players: MatchPlayer[]   // 1 entry for singles, 2 for doubles
  club?: string            // shared club for the entrant, optional
  played: number
  won: number
  drawn: number
  lost: number
  matches: string          // raw "M" col, e.g. "4-1"
  games: string            // raw "Gm" col, e.g. "84-66"
  points: string           // raw "Points" col (BAT shows two cells: Points + Pts)
  pts: number              // standings points from "Pts" col
}

export interface GroupData {
  drawNum: string
  groupLetter: string      // "A".."H"
  standings: StandingsRow[]
  matches: MatchEntry[]    // round-robin matches; round = "Round 1/2/3..."
}

export interface EventBundle {
  eventName: string        // e.g. "BS U11"
  playoff: BracketData     // existing BracketData (format: 'single-elimination')
  playoffDrawNum: string
  groups: GroupData[]      // sorted A → H
}
```

`DrawInfo` is extended (all new fields optional):

```ts
export interface DrawInfo {
  drawNum: string
  name: string
  size: string
  type: string
  eventName?: string       // populated when this draw belongs to a grouped event
  groupLetter?: string     // "A" if name matches "<event> - Group A"
  isPlayoff?: boolean      // true for the parent Elimination draw of a grouped event
}
```

`MatchEntry` gains an optional `eventName?: string` so the schedule view can
deep-link round-robin matches into the right event bundle.

The `'groups-knockout'` literal already declared in `BracketData['format']` is
**not** used by this design — bundles are first-class objects, not a bracket
format. The literal will be removed when the bundle types land, to avoid
suggesting two parallel ways to model the same thing.

## Provider abstraction

Add to `lib/providers/types.ts`:

```ts
getEventBundle(ref: TournamentRef, eventName: string): Promise<EventBundle | null>
```

`bat-provider.ts` implements it; `bwf-provider.ts` throws `NotImplementedError`
(matching the convention used by `getPlayer`, `getH2H`, etc.).

The BAT implementation:

1. Calls `getDraws(ref)` (cached upstream).
2. Annotates with `detectGroupedDraws()`.
3. Filters to draws where `eventName === <input>`. Asserts exactly one
   `isPlayoff: true` and at least one `groupLetter`. Otherwise returns `null`.
4. `Promise.allSettled` over: 1× playoff bracket fetch + N× group bracket
   fetches + N× standings fetches.
5. Assembles `GroupData[]` (sorted by `groupLetter`) and the `EventBundle`.
6. Returns the bundle. Per-piece failures are tolerated (see "Loading, errors,
   edge cases").

A new API route `app/api/event-bundle/route.ts` exposes this:

- Query params: `tournament` (GUID), `event` (event name).
- Response: `EventBundle` JSON, or `{ error: string }` with status 404 / 502.
- Mirrors the shape and error handling of `app/api/bracket/route.ts`.

## Parsers

All in `lib/scraper.ts`. Each is a pure function over an HTML string.

### `parseStandings(html: string): StandingsRow[]`

Walks `table.table--striped tbody tr` from a `GetStandings` response.

- **Position** from `.standing-status` text. Skips rows without a numeric
  position (header artifacts).
- **Players** from the second `<td>`: each `<a href="…/Player/{id}">` becomes
  a `MatchPlayer`. Doubles produce two players per row. Walkover/withdrawn
  entrants without an `<a>` fall back to plain text with empty `playerId`.
- **Club** from `.entrant-info-club` (optional).
- **Numeric cells** by header position: `Pl`, `W`, `D`, `L`, `M`, `Gm`,
  `Points`, `Pts`. `M` and `Gm` and `Points` are kept as strings (BAT shows
  them in tally form like `"4-1"`, `"84-66"`); `Pl/W/D/L/Pts` are parsed to
  integers (`NaN` → `0`).
- Returns rows in the order BAT presents them (already sorted by position).

### `parseRoundRobinMatches(html: string, drawName: string): MatchEntry[]`

Walks the `swiper-bracket` markup of a round-robin `GetDrawContent` response
and returns a flat list of matches.

- Subheading text per slide gives the round name (e.g. `"Round 1"`),
  normalized via the existing `longRound()` helper.
- Iterates `swiper-slide > .match` elements. Skips `.match.is-invisible` (bye
  placeholders).
- Per-match fields populated identically to `parseBracket`: player names + IDs
  (via existing `playerText()` helper), scores from `.match__result ul.points`,
  walkover/retired flags from `.match__message`, footer text fallback.
- `draw` field is the passed-in `drawName` (e.g. `"BS U11 - Group A"`).
- `round` field is the slide subheading.
- Slot positioning math (`topBase`, `slotPitch`, SVG connectors) is **not**
  applied — round-robin needs no bracket geometry.

**Refactor**: extract the per-match field extraction in `parseBracket`
(currently inlined in lines ~228–276) into a private helper
`extractMatchEntry($, matchEl, roundName, drawName): Pick<MatchEntry, …>` and
call it from both `parseBracket` and `parseRoundRobinMatches`. Eliminates
duplication; ensures score/player/walkover handling stays consistent.

### `detectGroupedDraws(draws: DrawInfo[]): DrawInfo[]`

Pure function. Returns a new array; original draws unchanged.

- Regex `/^(.+?) - Group ([A-Z])$/` against each `name`. Match → annotate
  `eventName` (capture 1) and `groupLetter` (capture 2). Sanity-check
  `type === 'Round Robin'`; if not, leave the draw unannotated and warn.
- Build the set of distinct `eventName`s that have ≥1 group draw.
- For each such event, find the sibling draw whose `name === eventName` and
  `type === 'Elimination'`. Mark it `isPlayoff: true`, `eventName: <self>`.
- Draws not matching either pattern are returned unchanged. This is the
  invariant that makes the change invisible to non-grouped tournaments and to
  any "regular" event inside a tournament that happens to mix formats.

Called once inside `app/api/draws/route.ts` so all downstream consumers see
annotated `DrawInfo`.

## Caching

New cache module `lib/event-bundle-cache.ts`, peer of `lib/bracket-cache.ts`.

```ts
export const cache = new Map<string, { bundle: EventBundle; ts: number; done?: boolean }>()
export const TTL_MS = 15 * 60 * 1000
export function makeKey(guid: string, eventName: string): string
export async function fetchEventBundle(guid: string, eventName: string): Promise<EventBundle>
export async function fetchAndCache(guid: string, eventName: string): Promise<EventBundle>
export async function prewarmEventBundleCache(): Promise<void>
```

Two-level caching:

1. **`bat-fetch` (HTTP layer)** continues caching individual URL responses (the
   17 underlying calls per bundle). No change to `bat-fetch.ts`.
2. **`event-bundle-cache` (assembly layer)** caches the assembled object so the
   page-level renderer doesn't re-parse 17 documents on every navigation. Same
   `done` short-circuit pattern as `bracket-cache`.

**Pre-warm**: `prewarmEventBundleCache` runs after `prewarmDrawsCache`.
For each cached tournament's draws list, run `detectGroupedDraws()` and warm
the bundle for each unique `eventName` whose draws form a bundle. For
non-grouped events the existing `prewarmBracketCache` continues to warm
individual draws (unchanged).

**Memory**: per tournament, an `EventBundle` is ~9 brackets' worth of HTML +
~80 standings rows. For a 20-event tournament that's ~9× the existing
per-tournament `bracket-cache` weight. Acceptable; `done`-flag short-circuits
historical tournaments.

**Stale-while-revalidate**: the page-level fetch path renders any cached
bundle immediately and triggers a background refresh if the cached `ts` is
older than `TTL_MS / 2`. New behavior introduced by this change; if
`bracket-cache` ever wants the same treatment, the same pattern can be lifted
into a shared helper later.

## UI components

Three new client components in `components/`. Naming follows existing
conventions (PascalCase `.tsx`).

### `EventBundleView.tsx`

Top-level renderer when `isBundle` is true.

- Props: `bundle: EventBundle`, plus the same `playerQuery`, `playerClubMap`,
  `lang`, theme wiring that `BracketCanvas` accepts.
- Renders a tab strip (`Groups` | `Playoff`).
  - Active tab from `?tab=groups|playoff`, default `groups`.
  - The existing `?from=` round param is forwarded to the Playoff tab only.
- **Groups tab**: renders one `<GroupCard/>` per group, sorted A→H.
  - Mobile: single column.
  - ≥720px: two-column grid.
- **Playoff tab**: renders `<BracketCanvas bracketHtml={bundle.playoff.html} … />`
  with all existing props (zoom, jump-to-round, share-as-image, dim-loser,
  search highlight) — the playoff is a normal single-elim bracket and reuses
  the existing renderer 1:1.
- Tab switch fires PostHog `event_bundle_viewed` with `{ tournamentId,
  eventName, tab }`.

### `GroupCard.tsx`

One group section. Standings always visible; matches collapsible.

- Header: `Group X` title + summary chip (`<played> / <total> played`).
- `<StandingsTable rows={group.standings} qualifierCount={…}/>` always rendered.
- "Show matches (N)" button toggles a matches list inline below.
  - Expanded state lives in component-local React state; not persisted.
  - On expand, fires PostHog `event_bundle_group_expanded`.
- Matches list inside the expanded panel: grouped by `round` ("Round 1",
  "Round 2", …); each row shows opponents + score + status badge (live /
  walkover / retired). Same row component / interaction pattern as
  `MatchSchedule.tsx` rows (live-score badge, long-press to share).

### `StandingsTable.tsx`

Compact standings table.

- Mobile columns: `Pos | Player | Pl | W-L | Pts`.
- ≥`sm:` breakpoint adds `M` and `Gm` columns (raw "4-1" / "84-66" strings).
- Top-N rows get a green "→" indicator in the position cell. `qualifierCount`
  prop chosen by caller (default `1`; see "Open decisions").
- Player name spans emit `data-player-id="…"` so the existing player highlight
  logic works without a special case.
- Clicking a player name opens the existing `<PlayerModal/>` (BAT only —
  gated on `provider === 'bat'`, same as today's bracket player click).
- Empty/zero-played groups: position column shows `–` instead of `1/2/3` until
  any match is played.

### Shared post-processing

The DOM post-processing currently inside `BracketCanvas` (player highlight,
club annotation, language switching) is lifted into a hook
`lib/usePlayerHighlight.ts` (matches the existing `lib/use*.ts` hook convention):

```ts
function usePlayerHighlight(
  containerRef: RefObject<HTMLElement>,
  query: string,
  playerClubMap: Map<string, string>,
  lang: Lang,
): void
```

`BracketCanvas` and `EventBundleView` both call this hook against their
respective container refs. Player spans in the standings table and the
expanded matches list participate automatically because they emit the same
`data-player-id` attribute.

## Integration with existing features

| Feature | Change |
|---|---|
| Schedule view (`MatchSchedule.tsx`) | Draw pill click branches: if `match.eventName` is set, navigate to `?event=<name>&tab=groups#group-X`. Otherwise current behavior. Requires populating `eventName` on each `MatchEntry` during `parseMatchesFull` (lookup against `detectGroupedDraws` annotations). |
| Live score (`useLiveScore.ts`) | No change. Used inside `GroupCard` matches list and on Playoff tab. |
| Alerts (`lib/alerts.ts`) | No change. Group matches appear in `MatchesData` indistinguishably from any other match. |
| Tournament stats (`lib/tournamentStats.ts`) | One change: when summarizing the events table, group rows by `eventName` (when set) so a grouped event shows once with combined match count rather than 9 rows. Winner column for grouped events comes from the playoff bracket. |
| Custom tabs (`lib/customTab.ts`, `CustomTabModal.tsx`) | Saved entity for grouped events is `{ tournamentId, eventName, isBundle: true }`. On load, an existing `{ tournamentId, drawNum }` entry whose draw is now part of a bundle is silently promoted to the parent event entry. Best-effort; falls back to single-draw view if `eventName` no longer resolves. |
| Next-opp (`lib/nextOpp.ts`) | No change. Skips matches whose `draw` is part of a bundle (no sibling concept). The "next opp" UI affordance simply doesn't render for round-robin matches. |
| H2H, Player Modal, Player Stats | No change (player-level features). |
| Search / player highlight | Shared via `usePlayerHighlight` hook (see above). |
| Share-as-image (`lib/shareMatchAsImage.ts`) | No change for individual matches. Group-level "share whole group" is Phase 2. |
| Dark mode | New components use the existing `dark:` Tailwind classes; same patterns as `MatchSchedule.tsx` and `TournamentStatsPanel.tsx`. |
| Discovery, announcements, BWF provider | Untouched. |

## Loading, errors, edge cases

**Initial-fetch loading**: render the tab strip immediately. Show 8 skeleton
group cards on the Groups tab and a single bracket skeleton on the Playoff
tab. Replace with real content when `/api/event-bundle` resolves.

**Per-piece resilience inside `getEventBundle`**: `Promise.allSettled`, not
`Promise.all`. Fallback rules:

- Group bracket fetch fails → render the group card with standings only and a
  small "Matches unavailable" notice.
- Group standings fetch fails → render the group card with the matches list
  and an inferred standings stub (entrant names from match data, no W-L).
- Playoff fetch fails → Playoff tab shows an inline error with a retry
  button. Groups tab is unaffected.
- No playoff sibling found for a set of group draws → log warn, return `null`
  from `getEventBundle`. The dropdown falls back to listing the orphaned
  draws individually.

**Empty mid-tournament states**:

- Group with 0 played matches → standings rendered with all zeros and `–` in
  the position column.
- Playoff with all byes pre-knockout → existing `parseBracket` already handles
  empty player slots; renders blank rows. No change needed (verified against
  the reference tournament's current state).
- Group with byes / odd size → `match.is-invisible` rows filtered by the
  round-robin parser.

**TTL-expiry refetch**: stale-while-revalidate at the page level (see Caching).

**Live updates**: `useLiveScore` updates individual match cards in place
(DOM mutation, not bundle re-fetch). When a match flips from live → final,
schedule a one-shot bundle refresh on a 30s debounce so the standings catch
up without thrashing.

**API errors**: `/api/event-bundle` returns `{ error: string }`. 404 for
"event not found" (returned `null`); 502 + retry-after for transient fetch
failures.

**Analytics**: two new PostHog events:
- `event_bundle_viewed` — `{ tournamentId, eventName, tab }`
- `event_bundle_group_expanded` — `{ tournamentId, eventName, groupLetter }`

Mirrors the pattern in `lib/analytics.ts`.

## Testing

New fixtures under `fixtures/`:

- `group-standings-bs-u11-a.html` — one `GetStandings` response.
- `group-draw-bs-u11-a.html` — one `GetDrawContent` round-robin response.
- `playoff-draw-bs-u11.html` — empty playoff with byes.
- `draws-grouped.html` — full draws table for the reference tournament.

New unit tests under `__tests__/`:

- `parseStandings.test.ts` — singles row, doubles row, withdrawn entrant,
  zero-played row, missing club.
- `parseRoundRobinMatches.test.ts` — empty match (`is-invisible`), unplayed
  pairing, completed pairing with scores, walkover, retired.
- `detectGroupedDraws.test.ts` — grouped event with playoff, grouped event
  with no playoff (orphan), non-grouped tournament passes through unchanged,
  mixed tournament (some events grouped, some not).
- `getEventBundle.test.ts` — happy path, missing playoff returns null, one
  failed sub-fetch produces partial bundle.

Existing tests should continue to pass; the only modifications to existing
parsers are the `extractMatchEntry` refactor (covered by existing
`parseBracket` tests).

## Open decisions

These are flagged for the implementation phase, not decided here.

1. **Qualifier count per group** for the "→" advance indicator. The reference
   tournament has 8 groups and an 8-slot playoff → top-1 advances. Default to
   `qualifierCount = 1` if uncertain. Rule: `qualifierCount = ceil(playoffSize
   / groupCount)`, clamped to group size. Confirm during implementation by
   inspecting one or two more tournaments.

2. **Custom tab migration**. Auto-promote existing single-draw saved tabs to
   event-level bundles on load, with a fallback to single-draw view if the
   event name no longer resolves. Open: whether to surface a one-time toast
   announcing the change. Default: silent migration.

3. **"Share whole group as image"** as a long-press affordance on a
   `GroupCard` header. Phase 2; not a blocker for initial release.

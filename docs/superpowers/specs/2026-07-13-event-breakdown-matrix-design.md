# Event Breakdown Matrix — Design

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan

## Summary

Add a new "Event Breakdown" matrix to the BWF (country-based) tournament stats
page, directly below the Country Head-to-Head section. Rows are countries;
columns are the knockout rounds that occur, ordered from the first round to the
title: `R128 | R64 | R32 | R16 | QF | SF | F | Champion` (only rounds that
actually exist are shown). Each cell shows how many **teams** from that country
exited at that round (a doubles/mixed pair counts as one team; a singles player
is a team of one). A dropdown defaults to **All** events and lists every event
+ age group in the tournament (e.g. `BS U15`, `GS U15`, `BD U15`, …); selecting
one filters the matrix to that event.

## Goals

- Show, per country, the distribution of how far its teams progressed in each
  event, from earliest round to Champion.
- Let the user filter by a single event/age group or view all events combined.
- Correctly count **teams** (not individual players), so a losing doubles pair
  is one entry, not two.
- Represent still-active teams in a live tournament by placing them in the
  round they are currently in, rendered in green.

## Non-Goals

- No full-page / modal expanded view (the Head-to-Head matrix has one; this does
  not). Inline table only.
- No per-player drill-down or tooltips in v1.
- No new upstream (BAT/BWF) fetches; derived entirely from data already
  aggregated for the stats page.

## Counting Model (decisions)

- **Unit = team.** Team identity is the sorted, comma-joined `playerId`s of the
  pair (or the single player for singles) within an event. A doubles pair
  eliminated in QF contributes `1` to that country's QF cell.
- **Country attribution.** A team is attributed to the country shared by all of
  its players. For the rare mixed-nationality pair (players from different
  countries), attribute to the first player's country (deterministic by team
  order). Teams whose country cannot be resolved are grouped under `—` and
  hidden by the client, mirroring the medal/roster tables.
- **Columns = dynamic union.** Only rounds that occur are shown. For **All**,
  the union of buckets across every event (e.g. `R128` appears because
  `MS-U19` is a 128 draw, even though other events start at `R64`). For a single
  event, only that draw's rounds. Plus a trailing **Total** column.
- **Active teams (live tournaments).** A team that has neither lost nor won the
  final is *active*; it is placed in the round it is currently in (its pending
  match's round, else one round deeper than its deepest win) and rendered in
  **green**. A round column may therefore contain both eliminated teams (lost
  that round, normal color) and active teams (in that round, green).

## Round Buckets

Normalize every round with the existing `abbrevRoundL(round, 'en')` →
`F | SF | QF | R{n}`. Add a synthetic **Champion** bucket for the team that won
the final. Ordering (first round → title): sort by `roundSize` descending
(`R128`=128 … `QF`=8, `SF`=4, `F`=2), with `Champion` last (sentinel size `1`).

Grouped (RR+PO) events (deferred to a follow-up): only knockout-playoff
matches are bucketed. A team eliminated in the group phase (reached no playoff
match) is omitted from the matrix in v1. BWF junior Grand Prix events are pure
knockout (confirmed: every Yonex Sunrise event is `type: 'KO'`), so this gap
affects no current tournament. A later revision can add a leading **Group**
column using the existing group-elimination logic in
`buildEventStatusByPlayer`.

## Architecture

Chosen approach: **server-side precomputed structure** (`eventBreakdown`) added
to the stats payload, rendered by a new client component. Rejected: client-side
`players ÷ 2` (wrong for split-nationality pairs) and a per-player `teamByEvent`
key (pushes bucketing into the component, still needs a cache bump). Team
identity and country attribution are only reliably available server-side where
full match+team data lives.

### Data flow

`aggregate()` (lib/tournamentStats.ts) → `stats.eventBreakdown` → `/api/stats`
payload → `<EventBreakdownTable>` (new component) in `TournamentStatsPanel`.

### Server: `buildEventBreakdown(ctxs, rosterByDraw?)`

New function in `lib/tournamentStats.ts`, called from `aggregate()` and its
result assigned to `ComputedStats.eventBreakdown`. Reuses existing helpers:
`abbrevRoundL`, `roundSize`, `isFinal`, `isSemiFinal`, `isKnockoutRound`, and
the `eventName ?? draw` event-key collapse plus `countryByPid` fallback used by
the other builders.

Algorithm, per event key (`eventName ?? draw`):

1. Gather knockout matches for the event. Group by **team** (sorted playerIds of
   each side present in each match).
2. For each team, walk its matches and derive:
   - `wonFinal` — won a match where `isFinal(round)`.
   - `lossRound` — the round of the match it lost (single-elim ⇒ at most one).
   - `pendingRound` — round of a match with `winner === null` it appears in.
   - `deepestWonSize` — smallest `roundSize` among rounds it won.
3. Bucket:
   - `wonFinal` → `Champion` (done).
   - else `lossRound` present → `abbrevRoundL(lossRound)` (done).
   - else → **active**; bucket = `pendingRound` if present, else
     `nextDeeper(deepestWon)` (halve `roundSize`; `SF`→`F`, `F`→`Champion`).
4. Resolve the team's country (shared → that; mixed → first player's; none →
   `—`). Increment `counts[event][country][bucket].done` (or `.active`).

Also produce: the ordered **events** list (dropdown, sorted by existing
`eventRank`), the per-event ordered bucket list, and the overall ordered union.

### Types (`lib/types.ts`)

```ts
export interface StatsEventBreakdownCell { done: number; active: number }

export interface StatsEventBreakdown {
  // Dropdown options, ordered by event rank. `key` = collapsed event key,
  // `label` = display string (e.g. "BS U17").
  events: { key: string; label: string }[]
  // Ordered bucket union across all events (for the "All" view).
  columns: string[]
  // Ordered buckets present in each event.
  columnsByEvent: Record<string, string[]>
  // counts[eventKey][country][bucket] = cell. Sparse.
  counts: Record<string, Record<string, Record<string, StatsEventBreakdownCell>>>
}
```

`TournamentStats` / `ComputedStats` gain `eventBreakdown: StatsEventBreakdown`.
Empty tournaments yield `{ events: [], columns: [], columnsByEvent: {},
counts: {} }`.

### Client: `EventBreakdownTable` (`components/EventBreakdownTable.tsx`)

Props: `{ data: StatsEventBreakdown }`. Local state: `selectedEvent: 'all' |
string` (default `'all'`).

- **Dropdown**: `All` + one option per `data.events` (label shown).
- **Columns**: `selectedEvent === 'all' ? data.columns :
  data.columnsByEvent[selectedEvent]`, plus a trailing **Total** column.
- **Rows**: countries with ≥1 team in scope (for `All`, union across events;
  aggregate cells by summing `done`/`active` across events per country per
  bucket). Exclude `—`. Sort by total teams (done+active across visible
  columns) descending, ties alphabetical by display name
  (`countryDisplayName`).
- **Cell**: `done` in default color; if `active > 0`, the active count is shown
  in green in the same cell. A cell with both shows the eliminated count
  (normal) and the active count (green). `0`/absent renders blank.
- **Total column**: sum of `done + active` for the row across visible columns.
- Reuses existing `.stats-table` / `.stats-num` styling. A new small class
  (e.g. `.stats-active-count`) provides the green color, theme-aware.

### Panel wiring (`components/TournamentStatsPanel.tsx`)

Render below the Country Head-to-Head `<section>`, gated the same country-based
way and on non-empty data:

```tsx
{stats.eventBreakdown && stats.eventBreakdown.events.length > 0 && (
  <section className="stats-section">
    <h2>{t('statsSectionEventBreakdown')}</h2>
    <EventBreakdownTable data={stats.eventBreakdown} />
  </section>
)}
```

### i18n (`lib/i18n.ts`, EN + TH)

New keys: `statsSectionEventBreakdown` ("Event Breakdown"),
`statsEventBreakdownAll` ("All events"), `statsEventBreakdownFilter` ("Event"),
`statsEventBreakdownTotal` ("Total"), `statsEventBreakdownChampion`
("Champion"). Round abbreviations already come from `abbrevRoundL`.

### Cache

Bump `StatsCacheEnvelope` version `13 → 14` in `lib/stats-cache.ts` (interface,
read guard, write) with a comment noting v13 envelopes lack `eventBreakdown`.

## Testing

`__tests__/tournamentStats.test.ts` — `buildEventBreakdown` via `aggregate()`
on a small country-based fixture (same style as the existing BWF medals test):

- **Singles** event: champion → `Champion`, runner-up → `F`, both SF losers →
  `SF`, a QF loser → `QF`; counts are per country.
- **Doubles** event: a losing pair contributes `1` (team dedup), not `2`;
  champion pair → `Champion` counts `1`.
- **Dynamic columns**: a 128-draw event and a 64-draw event together yield an
  `All` union including `R128`; the 64-draw event's `columnsByEvent` omits it.
- **Active team**: a team whose deepest match is a win with the next round
  unplayed (or a `winner === null` match) lands in the next round's cell as
  `active`, not `done`.
- **Country attribution**: same-country pair attributed once; a team with an
  unresolved country is grouped under `—`.

Optional `__tests__/EventBreakdownTable.test.tsx` for the `All` aggregation,
dynamic columns, Total column, and green active rendering.

## Rollout

Single deploy: server aggregation + payload field + client component + cache
bump. On deploy, v13 stats caches recompute to v14 and the section appears for
BWF tournaments. No migration, no upstream changes.

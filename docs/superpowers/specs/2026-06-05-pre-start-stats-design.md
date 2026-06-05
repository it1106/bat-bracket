# Pre-start Tournament Stats

## Problem

When a tournament's brackets are published but no matches have started — the
current state of `YONEX-SINGHA-BAT-BTY` — `TournamentStatsPanel` short-circuits
on `kpis.matches === 0` and shows `"Competition hasn't started. Check back
when more matches are decided"`. The visitor sees nothing despite all the entry
lists, seeds, draws, clubs, and (often) the opening-day schedule already being
fetched and cached server-side.

This spec replaces that empty state with a panel that fills in three sections
worth of pre-match content — hype, by-the-numbers, logistics — and gracefully
fills in the existing result-derived sections as matches finalize, on the same
polling loop.

## Goals

- Show useful, accurate content for any tournament whose brackets are up but
  whose first match hasn't completed.
- One source of truth: `/api/stats` continues to be the only stats endpoint,
  `TournamentStatsPanel` continues to be the only stats surface, and the
  panel evolves smoothly as matches finalize without a client-side handoff.
- Cached-payload back-compat: old `TournamentStats` envelopes from before this
  change deserialize and render correctly.
- No section guesses or invents data. When inputs are missing, the section
  hides; explanatory copy at the bottom of the panel tells the visitor which
  sections will appear once matches start.

## Non-goals

- No prediction or seeding-suggestion logic beyond bracket-position math.
- No new endpoints.
- No defending-champion lookup for tournaments without a resolvable prior
  edition — it just doesn't render.
- No QF-level potential-collision rendering (SF + F only).
- No automatic regeneration of pre-existing cached stats; the new
  `sourceVersion` recipe naturally invalidates them on next request.

## Architecture

Approach A from brainstorming: extend the existing generator and panel rather
than adding a parallel pre-stats pipeline.

`stats-generator.ts` / `tournamentStats.ts` split their work into two phases:

- **Entry phase** — runs whenever `draws` + entry lists exist. Populates
  events, players, multi-event entries, clubs/countries, seeds, draw sizes,
  per-event headline (top seed + draw size + type), potential SF/F collisions,
  defending champion (if resolvable), schedule preview (if published).
- **Result phase** — runs only on draws with completed matches. Populates the
  existing fields: drama, top players by W/L, club medals, multi-gold,
  court utilization, integrity.
- **Hybrid** — `dailyVolume` spans both phases. Entry phase emits one row per
  scheduled day with `total = scheduled count` and `minutes = 0`. Result
  phase upgrades each row's `decided`/`minutes` as completions come in.

`TournamentStatsPanel.tsx` removes the `kpis.matches === 0` page-level empty
state and replaces it with per-section guards. A small subdued footer at the
bottom of the panel reads "No matches completed yet — top players, drama,
and integrity stats will appear after the first match" while
`kpis.decided === 0`.

The cache contract is unchanged in shape. `TournamentStats` gains optional
fields. `sourceVersion` gets a new pre-match recipe (`pre:<hashes>`) so
pre-match cache entries don't collide with post-match ones for the same
tournament id.

## Data model

### `StatsKpis` additions (back-compat: existing fields untouched)

```ts
entries: number   // sum of unique players across all event draws — same player counted
                  // once per event entry
draws:   number   // total draws (knockout + group + playoffs)
```

`players`, `multiEventPlayers`, `events`, `nowPlaying` are already
pre-match-meaningful with current logic; no change.

`matches`, `decided`, `walkovers`, `retired`, `courtMinutes`,
`avgMatchMinutes`, `threeSetterRate` remain 0 pre-match and the panel's
section guards handle that.

### `StatsEventRow` changes (back-compat: existing fields untouched)

```ts
+ size:    number              // draw size from DrawInfo
+ type:    'KO' | 'RR+PO'      // knockout vs round-robin + playoff
+ entries: number              // unique players entered in this event
+ topSeed?: StatsSeedHead      // { players: string[]; club?: string }
```

Existing fields (`matches`, `threeSetters`, `walkovers`, `decided`, `avgMinutes`,
`players`, `winner`, `winnerSeed`) stay; pre-match they read 0 / empty.

### New top-level fields on `ComputedStats` (all optional)

```ts
seedHeadlines?: StatsSeedHeadline[]
// One row per event, top 2 seeds plus their club. Built from
// TournamentOverview.seedEvents.
// { event: string; seeds: Array<{ seed: number; players: string[]; club?: string }> }

multiEventEntries?: StatsMultiEventEntry[]
// Players entered in 2+ events.
// { playerId; name; club; events: string[] }
// Sorted by event count desc, then by name.

potentialCollisions?: StatsPotentialCollision[]
// For each knockout draw, the bracket-derived "if seeds hold" matchups.
// { event: string;
//   semis: Array<{ sideA: SeedRef; sideB: SeedRef }>;  // 0..2 rows
//   final?: { sideA: SeedRef; sideB: SeedRef } }       // present only when both semis present
// SeedRef = { seed: number; players: string[]; club?: string }
// Skips draws with fewer than 4 placed seeds.

defendingChampion?: StatsDefendingChampion[]
// One row per event where prior-edition winner is resolvable from player-index.
// { event: string; players: string[]; club?: string;
//   priorEditionId: string; priorEditionLabel: string }
// Empty array (or undefined) when prior edition can't be resolved.

schedulePreview?: StatsSchedulePreview
// Populated only when day caches carry scheduledTime but no winners yet.
// { firstDayLabel: string; matchCount: number; courts: number; opensAt?: string;
//   openingDayByCourt: Array<{ court: string; matches: StatsScheduledMatch[] }> }
// StatsScheduledMatch = { time: string; event: string; round: string;
//   team1: string[]; team2: string[]; sequenceLabel?: string }
```

`StatsDrama` unchanged — all fields already nullable, stays null pre-match.
`TournamentStatsCoverage` unchanged.

## Component / render layout

`TournamentStatsPanel.tsx` is mostly subtraction. The single
`if (stats.kpis.matches === 0) return …` at line 130 is replaced with
per-section guards. Render order:

1. **Hero KPIs** — always renders.
   Pre-match tiles: `entries`, `draws`, `events`, `players`, `multiEventPlayers`.
   Result-phase tiles (`decided`, `courtTime`, `avgMatch`, `threeSetters`,
   `comebacks`) render only when `kpis.decided > 0`.
2. **Defending champions** — renders when `defendingChampion?.length > 0`.
   Card per event: event name, prior winner(s), club, prior edition label.
   `data-stats-share="defending"`.
3. **Top seeds at a glance** — renders when `seedHeadlines?.length > 0`.
   Compact card per event: seed 1, seed 2, club.
   `data-stats-share="seeds"`.
4. **Potential semis & final** — renders when `potentialCollisions?.length > 0`.
   Per knockout draw: SF rows + F row. Draw drops silently when fewer than
   4 seeds placed. `data-stats-share="collisions"`.
5. **Multi-event entries** — renders when `multiEventEntries?.length > 0`.
   Same table shape as today's `multiGoldPlayers` ("Playing in multiple
   events"). `data-stats-share="multi-entries"`.
6. **Drama** — renders only when at least one of the four drama sub-cards
   is non-null. Pre-match: hidden entirely (was previously gated by the
   page-level empty state).
7. **Club Medals / Top Players / Multi-Gold** — already conditional on their
   arrays having content; pre-match they naturally hide. No code change.
8. **Events table** — always renders. Pre-match the columns degrade:
   `Matches` / `3-set %` / `Avg` show "—"; `Winner` header becomes
   "Top seed" and shows `topSeed.players[0]`. New columns `Size` and `Type`.
9. **Club Rosters / Country Rosters** — already work pre-match. No change.
10. **Schedule preview** — renders when `schedulePreview` is present. Header
    "Opening day · [label]", subhead "X matches across Y courts, opens at HH:MM".
    Body: one column per court, time-ordered.
    `data-stats-share="schedule-preview"`.
11. **Matches per day** — renders when `dailyVolume.length > 0`. Same
    component. Generator emits rows for scheduled (but undecided) days too,
    where `total` is the scheduled count and `minutes` is 0; the bar uses
    scheduled volume.
12. **Court utilization** — renders when `courtUtilization.length > 0`.
    Purely actual minutes; pre-match the array is empty and the section hides.
13. **Integrity** — renders when `kpis.decided > 0`. Pre-match: hidden.

**Pre-match explanatory footer** — when `kpis.decided === 0`, render a small
subdued note at the bottom of the panel: "No matches completed yet — top
players, drama, and integrity stats will appear after the first match."

**Long-press share** — each new section gets a unique `data-stats-share` key
(`defending`, `seeds`, `collisions`, `multi-entries`, `schedule-preview`).
The existing `useLongPress` wiring picks them up unchanged.

## Data flow & graceful degradation

`aggregate()` at `lib/tournamentStats.ts:641` is the extension point. It
already receives `rosterByDraw` on the pre-match path (`route.ts:274`).

### New inputs to `aggregate()`

```ts
draws?: DrawInfo[]
overview?: TournamentOverview
brackets?: Map<string, BracketData>      // keyed by drawNum
priorEditionWinners?: PriorEditionLookup // pre-resolved by the route
```

All optional. Each new top-level field has its own derivation function
(`buildSeedHeadlines`, `buildPotentialCollisions`, `buildMultiEventEntries`,
`buildDefendingChampion`, `buildSchedulePreview`) and each returns an empty
array / undefined when its inputs are missing. Losing one section can't
break the others.

### Route changes (`app/api/stats/route.ts`)

1. The existing `coverageComplete` gate already trivially passes for
   pre-match (`fullData.days.length === 0`). No change.
2. After the existing `fetchRosterByDraw(tournamentId)` block, fetch in
   parallel:
   - `draws-cache.getCachedOrLoadFromDisk(tournamentId)`
   - `overview-cache` snapshot read
   - For each `DrawInfo`, a `bracket-cache` read (concurrency-capped at 4)
   - `resolvePriorEditionWinners(tournamentId)` (see below)
3. Pass them all to `aggregate()`. Each block swallows errors and returns
   `null` / empty; `aggregate()` treats `null` exactly like "no data."

### Defending-champion resolution

Heuristic (route, not generator). BAT tournament ids don't reliably encode
the edition number, so prior-edition matching is best-effort:

1. From `tournament-meta`, collect candidates whose canonical display name
   (`Tournament.name`, lowercased, stripped of punctuation, year tokens, and
   common edition tokens such as `nd`/`rd`/`th`/`open`) matches the current
   tournament's canonical name. Restrict to `done === true` and exclude the
   current id.
2. If exactly one candidate remains, it's the prior edition. If zero
   candidates remain, fall back to lexicographic prefix match on
   `tournamentId` (the existing `YONEX-SINGHA-BAT-BTY-…` convention). If more
   than one candidate remains after both passes, emit empty — wrong
   attribution is worse than no attribution.
3. For each event in the current tournament, look up the resolved prior
   edition's `winner` via player-index. If the event didn't exist in the
   prior edition, skip that event.

When the resolution returns empty, the entire defending-champions section
hides — no "unknown" placeholders rendered.

### Schedule preview

`buildSchedulePreview` reads `MatchesData.days`. For the first day with
`hasMatches`, it inspects day-cache groups. If `scheduledTime` is present but
`winner` is null on every match, that day's groupings form the preview. If
no day-cache for that date or no `scheduledTime`, returns `undefined`.

### Caching

- `stats-cache` keyed on `sourceVersion` continues working unchanged for
  post-match tournaments (`sourceVersion = "full:<hash>"`).
- Pre-match recipe: `sourceVersion = "pre:<draws-hash>:<overview-hash>:<roster-hash>"`.
  The route computes it from input bytes it already has in hand.
- TTL: pre-match uses `STATS_TTL_MS_LIVE` since both states evolve.

### Pre-match failure modes

| Missing input | Visible effect |
|---|---|
| `draws` (cache miss) | Events table loses `size`/`type` columns. Collisions section hides. |
| `overview` (no seed list yet) | Seed headlines + collisions hide. Defending champion unaffected. |
| Single bracket fetch fails | That event drops from collisions only. Others survive. |
| Prior edition unresolvable / ambiguous | Defending champion section hides entirely. |
| Clubs map < 50% coverage | Existing behavior preserved — `ensureStatsCachedForTournament` returns `skip` (no disk pin), route still returns the in-memory result. |
| `rosterByDraw` empty | `entries`/`players` show 0. Hero KPIs render 0; explanatory footer carries it. |

### Polling

The panel's existing 30s `setInterval` is unchanged. Late entries,
withdrawals, schedule drops, and the first match completing all surface on
the next tick.

## i18n keys to add

EN + TH for each. Keys, mirroring existing naming:

```
statsSectionDefendingChampions
statsSectionSeedHeadlines
statsSectionPotentialCollisions
statsSectionMultiEventEntries
statsSectionSchedulePreview
statsKpiEntries
statsKpiDraws
statsColSize
statsColType
statsColTopSeed
statsCollisionsSf
statsCollisionsF
statsScheduleOpensAt
statsScheduleMatchesAcrossCourts
statsPreMatchFooter
```

EN copy guidance: short, lowercase headers consistent with current panel
(`"By the numbers"`, `"Drama"`, etc.). TH copy follows existing translation
conventions in `lib/i18n.ts`.

## Testing

### Unit (`__tests__/tournamentStats.test.ts`)

1. **Empty everything** — `aggregate({ days: [] }, new Map(), {}, undefined, {})`
   returns the existing empty shape with all new optional fields absent
   (regression guard).
2. **Entry-phase only** — empty `dayGroupsByDate`, non-empty `rosterByDraw`,
   `overview`, `draws`, `brackets`. Assert `kpis.entries`, `kpis.draws`,
   `kpis.players`, `kpis.events` populated; `kpis.decided === 0`;
   `seedHeadlines`, `multiEventEntries`, `potentialCollisions` populated;
   `topPlayers`, `drama.*`, `clubMedals`, `dailyVolume`, `courtUtilization`
   empty / null.
3. **Mixed phase** — entries plus a partial day of completed matches.
   Both phases' fields coexist correctly.
4. **Potential collisions** — 4-seed knockout fixture: `[1] A` vs `[4] D` and
   `[2] B` vs `[3] C`. Output is exactly two SF rows + one F row with the
   right pairings. Second fixture with 3 seeds: under-populated half drops,
   no crash.
5. **Defending champion** — given a `priorEditionWinners` map, per-event rows
   render; missing events drop silently.
6. **Schedule preview** — day data with `scheduledTime` set and no winners
   yields `schedulePreview.openingDayByCourt` grouped by court, time-ordered.
   Without scheduled times, returns `undefined`.
7. **Roster-only fallback** — preserves the existing
   `ctxs.length === 0 && rosterSize === 0` early-return path at
   `tournamentStats.ts:652`.

### Route (`__tests__/api-stats-route.test.ts`)

1. **Pre-match `sourceVersion`** — mock empty `fullBytes`, populated draws +
   overview + roster. Response uses the `pre:…` salt; a second call with
   the same inputs hits the cache.
2. **Drawn-but-no-overview** — overview cache miss returns `null`. Seed-derived
   sections absent, draws-derived sections present, no 500.
3. **Bracket fetch failure for one draw** — only that draw drops from
   `potentialCollisions`; others survive.

### Component (`__tests__/TournamentStatsPanel.test.tsx`, new file)

1. **Pre-match render** — fetch stub returns a payload with
   `kpis.decided === 0` and `kpis.entries > 0`. Hero shows the new pre-match
   tiles; defending / seeds / collisions / multi-event / events / rosters
   render; drama / top-players / multi-gold / integrity do **not** render;
   explanatory footer is present.
2. **First match completes mid-poll** — initial fetch pre-match, second fetch
   has one completed match. Drama section appears; footer disappears; no
   React errors.
3. **Back-compat cached payload** — payload lacks all new optional fields
   entirely. Panel renders the old way; no `undefined.map` crashes.

### Manual smoke (not automated)

- Pull up `YONEX-SINGHA-BAT-BTY` on staging with this branch; confirm the
  empty state is replaced and the right sections appear.
- Long-press each new share-target section and confirm the captured PNG
  includes the section.

## Out of scope

- Predictive seeding / projected medalists.
- Player-photo rendering in the hype section.
- Push notifications when the schedule drops.
- Backfilling pre-match stats into historical (finished) tournaments — the
  pre-match phase only runs while results are absent.

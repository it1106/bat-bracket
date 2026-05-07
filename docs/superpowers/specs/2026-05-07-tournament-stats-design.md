# Tournament Stats — Design

A per-tournament stats panel surfaced as a `📊` icon-only pill at the start of the day-tab strip in the existing Matches view. The panel shows headline KPIs, daily volume, top events, match-drama callouts, a player leaderboard, court utilization, champions, and integrity metrics — all derived from data the existing `/api/matches` cache tiers already capture.

## Background

The `MatchSchedule` component already loads every-day match data lazily via `/api/matches?tournament=X&date=Y`. Two on-disk caches make most reads free:

- `.cache/days/<tournamentId>/<YYYY-MM-DD>.json` — pinned permanently when a single day's matches are all resolved.
- `.cache/full/<tournamentId>.json` — pinned permanently once the tournament is wholly past.

For SPRC (May 1–6 2026, today is May 7) the full cache plus all six day caches are on disk. A stats page that aggregates these files therefore costs **zero BAT hits** for past tournaments and only piggybacks on existing fetches mid-tournament.

## Goals

- Show 7 stat sections (KPIs, daily volume, top events, drama callouts, player leaderboard, court utilization, champions, integrity) on a per-tournament basis.
- Reachable via an icon-only `📊` pill rendered as the first item in the day-tab strip of the Matches view.
- Zero new BAT hits for fully-past tournaments. Mid-tournament reuses the same cache tiers as `/api/matches`.
- Aggregated payload caches both in memory (60 s) and, once derivable from the immutable `.cache/full/`, on disk forever.
- 1100+ players × 1300+ matches must aggregate in under 100 ms per tournament server-side.

## Non-Goals

- Seed-based "upset" detection. Seeds aren't in `MatchEntry` and adding an entry-list scraper is out of scope.
- Club leaderboards. Would require batched per-player profile fetches.
- Stats inside the Bracket view. Bracket is event-scoped, stats is tournament-scoped.
- Cross-tournament aggregations.
- Live websocket updates of stats while watching. The 60 s mem-cache TTL is good enough; no SignalR wiring.
- Localization beyond what `lib/i18n.ts` already supports for existing copy. New strings get `en` + `th`.

## Settings — recap of brainstorming Q&A

| Decision | Choice |
|---|---|
| Navigation | First slot of the day-tab strip in Matches view (Option 3 — icon-only `📊`). |
| v1 scope | All sections from the visual mockup (`public/tournament-stats-mockup.html`). |
| Data source | Reuse `/api/matches` cache tiers; never fetch BAT directly from stats code. |
| Computation | Server-side aggregation in a new `/api/stats` route. Client renders a small JSON payload. |
| Result caching | In-memory map (60 s TTL) for active tournaments. Pin to `.cache/stats/<id>.json` only when `.cache/full/<id>.json` exists. |
| Activation gate | Pill always visible; panel shows an "early days" empty state until ≥ 10 matches are decided. |

## Architecture

### Components

| File | Role | Lines (target) |
|---|---|---|
| `lib/tournamentStats.ts` (new) | Pure aggregator. `aggregate(data: MatchesData, dayGroupsByDate: Map<string, MatchScheduleGroup[]>) → TournamentStats`. No I/O. | < 250 |
| `lib/stats-cache.ts` (new) | Read/write `.cache/stats/<id>.json` with atomic tmp+rename. Mirrors `lib/day-cache.ts`. | < 60 |
| `app/api/stats/route.ts` (new) | Cache-aware orchestrator. See Data Flow below. | < 120 |
| `components/TournamentStatsPanel.tsx` (new) | Pure render of `TournamentStats`. No fetching. | < 350 |
| `components/MatchSchedule.tsx` (modified) | Render the `📊` pill at the start of `.match-schedule__day-tabs`. When selected, swap the schedule body for `<TournamentStatsPanel>`. | +40 |
| `app/page.tsx` (modified) | Allow `selectedDay === 'stats'` as a sentinel; suppress per-day fetches when stats is active. Lift the new `tournamentStats` state up so it persists across day switches. | +30 |
| `app/globals.css` (modified) | `.match-schedule__day-tab--stats` rule (28 px square, icon centered, sticky-leftmost on horizontal scroll). | +20 |
| `lib/i18n.ts` (modified) | New keys (≤ 30) for stat-section labels. Both `en` + `th` values. | +60 |
| `lib/types.ts` (modified) | Add `TournamentStats` interface plus the per-section sub-shapes. | +60 |

### New fixtures

| Fixture | Used by |
|---|---|
| `fixtures/stats-sprc-full.json` | Full `MatchesData` snapshot from SPRC (already produced during brainstorming; copy from `/tmp/sprc-25690501.json` etc., concatenated). |
| `fixtures/stats-empty.json` | Tournament with zero played matches — empty-state branch. |
| `fixtures/stats-mid-tournament.json` | Half-played tournament — partial-aggregate branch. |

## Data Model

### `TournamentStats` (returned by `/api/stats`)

```ts
export interface TournamentStats {
  tournamentId: string
  generatedAt: string                    // ISO timestamp
  coverage: {
    daysOnDisk: number                   // how many days came from cache
    daysFromMemory: number               // ... vs in-memory matches cache
    daysFromBat: number                  // ... vs cold BAT fetch
    totalDays: number
  }

  kpis: {
    matches: number
    decided: number                      // matches with winner !== null
    walkovers: number
    retired: number
    nowPlaying: number
    players: number                      // unique playerIds
    courtMinutes: number                 // sum of parsed durations
    avgMatchMinutes: number              // mean over matches with duration
    threeSetterRate: number              // 0..1, of decided matches
    walkoverRate: number                 // 0..1, of all matches
  }

  dailyVolume: Array<{
    date: string                         // YYYY-MM-DD
    label: string                        // localized day label
    total: number
    decided: number
    minutes: number
  }>

  topEvents: Array<{
    name: string                         // draw label, e.g. "BS U15"
    matches: number
    threeSetters: number
    walkovers: number
    avgMinutes: number
  }>

  drama: {
    marathon: MatchRef | null            // longest decided match
    closest: MatchRef | null             // smallest aggregate point margin
    highestSet: SetRef | null            // single set with highest t1+t2
    comebackCount: number                // lost set 1, won match
    comebackHighlight: MatchRef | null   // representative comeback (a final preferred)
  }

  topPlayers: Array<{
    playerId: string
    name: string
    seed?: string                        // "[1]" if present in name
    wins: number
    losses: number
  }>

  courtUtilization: Array<{
    name: string                         // e.g. "ยิมส์ 1 - A05"
    matches: number
    minutes: number
  }>

  champions: Array<{                     // events whose Final has a winner
    event: string                        // draw label
    winner: string[]                     // player names
    runnerUp: string[]
    score: string                        // "21-17, 21-15"
  }>

  integrity: {
    walkoverByEvent: Array<{ event: string; walkovers: number; rate: number }>
    threeSetterByEvent: Array<{ event: string; rate: number; sample: number }>
  }
}

interface MatchRef {
  draw: string
  round: string
  team1: string[]
  team2: string[]
  winnerSide: 1 | 2
  scores: Array<{ t1: number; t2: number }>
  durationMinutes?: number
}

interface SetRef extends MatchRef {
  setIndex: number                       // which game produced the highlighted set
}
```

### `.cache/stats/<id>.json`

The serialized `TournamentStats` plus a `sourceVersion` field stamping the input fingerprint:

```json
{
  "version": 1,
  "sourceVersion": "full:<sha256-of-full-cache-bytes>",
  "stats": { ... }
}
```

`sourceVersion` lets the route invalidate the disk cache automatically if `.cache/full/<id>.json` changes (which only happens when the tournament's `isAllPast` first flips true and the file is rewritten).

## Data Flow — `/api/stats?tournament=X`

The route maintains a module-scoped `Map<string, { data: TournamentStats; ts: number }>` (`memCache`) with a 60 s TTL, mirroring `matchesFullCache` in `app/api/matches/route.ts`. The caller wraps the aggregator with timestamp + coverage instrumentation.

```
1. memCache.get(tournamentId) within 60 s? → return.

2. fullDisk = readFullCache(tournamentId)
   if fullDisk:
     sv = "full:" + sha256(rawFile)
     statsDisk = readStatsCache(tournamentId)
     if statsDisk && statsDisk.sourceVersion === sv:
       memCache.set(tournamentId, statsDisk.stats)
       return statsDisk.stats
     stats = aggregate(fullDisk, mapByDateFromFullCache(fullDisk))
     writeStatsCache(tournamentId, { sourceVersion: sv, stats })
     memCache.set(tournamentId, stats)
     return stats

3. // Mid-tournament — full cache not yet written.
   fullData = readMatchesFullViaExistingPath(tournamentId)
     // same code path as /api/matches with no date param —
     // hits its 60s mem cache; falls through to BAT only on cold hit.

4. dayGroupsByDate = new Map<string, MatchScheduleGroup[]>()
   for each day in fullData.days:
     groups = readDayCache(tournamentId, day.dateIso)            // disk
            ?? matchesDayMem.get(`${id}:${day.dateIso}`)          // 60s mem
            ?? readMatchesPartialViaExistingPath(id, day.date)    // shared path
     dayGroupsByDate.set(day.dateIso, groups)

5. stats = aggregate(fullData, dayGroupsByDate)
   memCache.set(tournamentId, stats)            // 60s
   // Do NOT pin to disk; full-cache isn't immutable yet.
   return stats
```

### Aggregator contract

`aggregate(data: MatchesData, dayGroupsByDate: Map<string, MatchScheduleGroup[]>) → Omit<TournamentStats, 'tournamentId' | 'generatedAt' | 'coverage'>`

The route attaches `tournamentId`, `generatedAt`, and `coverage` (whose three counters the route increments as it picks each day's source tier) before returning. The aggregator never touches these.

- Pure: no `Date.now()`, no `console.log`, no I/O. `generatedAt` is set by the caller.
- Iterates each day's groups exactly once.
- Match counted by its appearance under `dayGroupsByDate.get(dateIso).matches[]`. Order across days follows `data.days[]`.
- Players keyed by `playerId` only — names that lack a `playerId` are excluded from leaderboard, players, and player-events sets but still counted toward total `matches`.
- Duration parsed via existing format (`/(?:(\d+)h\s*)?(?:(\d+)m)?/`). `0` minutes → omitted from averages.
- Champions = matches with `round === 'Final'` (case-insensitive, after locale normalization), `winner !== null`, `walkover === false`. The aggregator returns one entry per draw; if a draw has multiple "Final" rows (3rd-place playoff, group final, etc.) the latest one in iteration order wins.

### Integration with day-tab

`selectedDay` becomes `string | 'stats'`. In `MatchSchedule.tsx`:

```tsx
{days.length > 0 && (
  <div className="match-schedule__day-tabs">
    <button
      className={`match-schedule__day-tab match-schedule__day-tab--stats ${selectedDay === 'stats' ? 'active' : ''}`}
      onClick={() => onDayChange('stats')}
      title={t('tournamentStats')}
      aria-label={t('tournamentStats')}
    >
      📊
    </button>
    {days.map((d) => (
      <button ... />
    ))}
  </div>
)}

{selectedDay === 'stats' ? (
  <TournamentStatsPanel tournamentId={tournamentId} />
) : (
  // existing groups rendering
)}
```

`app/page.tsx` short-circuits the per-day fetch effect when `selectedDay === 'stats'` and resets `selectedDay` to `currentDate` whenever a different tournament is chosen.

## Edge Cases

| Scenario | Handling |
|---|---|
| Tournament with zero played matches | KPIs all zero; daily volume rendered with all zeros; sections that need at least one decided match (drama, leaderboard, champions) render an "Early days — check back when more matches are decided." empty state. |
| Day with only walkovers | Counted in `matches` and `walkovers`; excluded from `decided`, drama callouts, durations. |
| Match with empty `playerId` (free-text entrants) | Counted in totals, excluded from `players` set and leaderboards. Champions still shown using player names. |
| Duration string is `0m` or missing | Excluded from `courtMinutes`, `avgMatchMinutes`, court-utilization minutes. Match still counts toward court matches. |
| Match `walkover === true` AND `winner !== null` | Counted as walkover; not decided. |
| Multiple "Final" rows in one draw | Last-iterated wins. Bronze-medal matches typically don't carry the "Final" label, so this rarely fires. |
| BAT mid-cycle outage | If full-data fetch fails, `/api/stats` returns `{ error }` 502. The panel shows a generic retry banner. The pill itself still renders. |
| Tournament with > 50 events / > 5000 matches | Aggregator still O(N); top-N truncation lists capped at 10 (events), 12 (top players), 14 (courts), 8 (champions sample) on the server before serialization. |
| Today's day cache absent (live tournament) | Falls through to in-memory matches cache, then to BAT once. Same hit pattern as opening Matches view normally. |
| `generatedAt` skew across PM2 workers | Each worker has its own 60 s mem cache; viewers may see two valid cached results with `generatedAt` 60 s apart. Acceptable. |

## Error Handling

| Failure | Behavior |
|---|---|
| `aggregate` throws on malformed shape | Caller catches, returns 502 with `{ error }`. Panel shows banner. |
| `.cache/full/` read succeeds but JSON parse fails | Treat as absent; fall through to mid-tournament path. |
| `.cache/stats/` read fails on a fresh disk | Treat as absent; recompute and write. |
| Atomic write of `.cache/stats/` fails | Log warn; skip pinning; mem cache still serves the value for 60 s. |
| Per-day cache read fails (corrupt JSON) | That day contributes zero matches; aggregation continues. Logged once per call. |
| User's tournament list contains a stale id with no BAT data | `readMatchesFullViaExistingPath` returns `{ days: [], groups: [] }`; aggregator returns the all-zero shape; panel shows empty state. |

## Testing

### Unit (fixture-based, no network)

| Test file | Coverage |
|---|---|
| `__tests__/tournamentStats.test.ts` | Snapshot-test `aggregate(fixtures/stats-sprc-full.json)` against expected `TournamentStats` JSON. Field-by-field assertions on KPIs, daily volume top entry, marathon's draw + duration, top player, champion count. |
| `__tests__/tournamentStats.empty.test.ts` | `aggregate(fixtures/stats-empty.json)` returns the all-zero shape; drama / leaderboard / champions empty arrays. |
| `__tests__/tournamentStats.mid.test.ts` | `aggregate(fixtures/stats-mid-tournament.json)` — partial coverage; champions array shorter than total events. |
| `__tests__/stats-cache.test.ts` | Round-trip write/read; missing file → null; sourceVersion mismatch → null. |

### Behavior (mocked I/O)

`__tests__/api-stats-route.test.ts` mocks the cache primitives:

1. Cold read, full cache on disk, no stats cache → aggregate, write stats cache, return.
2. Warm read, stats cache matches sourceVersion → return without re-aggregating.
3. Warm read, stats cache stale (sourceVersion mismatch) → recompute.
4. Mid-tournament, no full cache → mid-tournament path; stats cache NOT written.
5. Aggregator throw → 502 with `{ error }`.
6. Same-second concurrent calls → only one aggregation; mem cache shared.

### Render (component, jsdom)

`__tests__/TournamentStatsPanel.test.tsx`:
- Renders all sections from a stats fixture.
- Empty-state branch when KPIs all zero.
- Loading skeleton while fetch in flight.

### Integration (manual)

Post-deploy:
- Open SPRC → tap `📊`. Verify zero `[bat-fetch]` log lines from the request.
- Open an in-progress tournament → tap `📊`. Verify per-day cache fetches (already cached) plus the matches-full fetch hit memory, not BAT.
- Tap a date pill → schedule reappears within one frame; tap `📊` again → cached panel.

## Implementation Notes

- **Aggregator location**. `lib/tournamentStats.ts` exports `aggregate` plus the duration-parser and "is final" helpers it depends on. Helpers stay private to the module unless `MatchSchedule` already needs them (it doesn't). Reuse the existing `i18n.longRoundL` for round-name comparison.
- **Champion detection**. Use `m.round` after passing through the `ROUND_TRANSLATIONS` map already in `lib/scraper.ts` (export it if not yet exported). A match is the event final iff its translated round equals "Final" and the draw has no later-occurring "Final" entry. Last-occurrence wins.
- **Comeback highlight**. Prefer a comeback that occurs in a Final, then a Semifinal, then any. This makes the highlight feel headline-worthy.
- **Top-player tie-breaker**. Order by wins desc, losses asc, `playerId` asc.
- **Court name normalization**. Aggregate by raw `court` string. The mockup shortens `"ยิมส์ 1 - A05"` to `"A05"` for the bar label — that's a render-side decision, not aggregation. Server returns the full string.
- **Number-formatting**. `651h`, `29 min`, `14%` are render-side. Aggregator returns raw integers and rates in `[0, 1]`.
- **Theming**. The panel relies on the same CSS variables (`--surface`, `--bg`, `--brand`, etc.) the existing mockups use. No new variables.
- **Pill sticky-left behavior**. `.match-schedule__day-tab--stats { position: sticky; left: 0; background: var(--surface); }` so the pill stays visible while a long day strip horizontally scrolls. (The current strip uses `flex-wrap: wrap`, so on desktop wrap-mode this CSS no-ops; it kicks in only when a future change adds horizontal scrolling for narrow mobile.)
- **Bundle cost**. `TournamentStatsPanel` is plain HTML/CSS. No charting lib; bars are CSS widths derived from `Math.max(rawValues)`. Component should compile to < 8 KB minified.
- **Analytics**. Reuse `track('tournament_stats_viewed', { tournament_id })` on first paint. PostHog events flow through the existing `lib/analytics.ts`.
- **Pre-warm**. The `/api/stats` route is NOT included in the boot pre-warm chain. Cold fetch on first viewer is acceptable (well under 100 ms when full-cache exists).
- **i18n keys to add**. `tournamentStats`, `statsKpiMatches`, `statsKpiPlayers`, `statsKpiCourtTime`, `statsKpiAvgMatch`, `statsKpiThreeSetters`, `statsKpiWalkoverRate`, `statsSectionMatchesPerDay`, `statsSectionTopEvents`, `statsSectionDrama`, `statsMarathonBadge`, `statsHighestSetBadge`, `statsClosestBadge`, `statsComebacksBadge`, `statsSectionTopPlayers`, `statsSectionCourtUtilization`, `statsSectionChampions`, `statsSectionIntegrity`, `statsEmptyState`, `statsLoadFailed`. Each gets an `en` and a `th` value.

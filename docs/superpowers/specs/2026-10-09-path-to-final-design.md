# Path to the Final

**Date:** 2026-10-09

## Summary

From a player's window, open a panel that lists every round of the player's
knockout draw, from their first round to the final. Played rounds show the real
opponent and score. Future rounds show the most likely opponent with the past
record against them, and a "+N others" line that expands to everyone who could
reach that slot.

It is for players, parents and coaches at a tournament who want to know who
stands between them and the final, and how those meetings have gone before.

Concrete example: in a 32-draw, a player who has won their R32 match sees

| Round | Row |
|-------|-----|
| R32 | beat A 21-15 21-18 |
| R16 | vs B, 14:30 court 3 · record 1–2 |
| QF | likely C [3/4] · first meeting · +3 others |
| SF | likely D [2] · record 0–1 · +7 others |
| Final | likely E [1] · first meeting · +15 others |

## Decisions already made

- **Placement:** a panel listing each round. No highlighting on the bracket
  itself.
- **Later rounds:** one favourite per round, expandable to all candidates.
- **Past record:** counted from BATMatch's own indexed match history, not from
  BAT's H2H page.

## Scope

- **In scope:** BAT only. Single-elimination draws. Singles and doubles. Thai
  and English.
- **Out of scope:** the BWF provider (its brackets come from a different
  source; a follow-up). Group-stage and round-robin draws. Highlighting the
  route on the bracket canvas. Win probabilities or any prediction beyond
  "favourite by seed, then ranking". Fetching BAT's official H2H page.

## Architecture

Three new pieces. None of them contacts BAT beyond what the bracket cache
already does, and none keeps anything new in memory.

1. **`buildBracketPath` (new, `lib/bracketPath.ts`)** — a pure function that
   walks a bracket's rounds and returns one player's route.
2. **`GET /api/path` (new, `app/api/path/route.ts`)** — reads the cached
   bracket, calls the walker, then adds seeds, ranking positions and past
   records.
3. **`PathToFinalModal` (new, `components/PathToFinalModal.tsx`)** — the panel,
   opened from a button in `components/PlayerModal.tsx`.

The walker is separate from the route so it can be tested against the bracket
fixtures with no caches involved.

## Data layer

### Bracket rounds (new parser output, `lib/scraper.ts`)

The existing feeder parser (`parseBracketFeeders`) only reports slots that
already hold a player, so it cannot describe an empty future round. Add:

```ts
export interface BracketSlotMatch {
  teams: MatchPlayer[][]        // 0, 1 or 2 teams; empty rows dropped
  seeds: Array<string | undefined>  // per team, as printed: "2", "3/4"
  winner: 1 | 2 | null          // index into the two rows, when decided
  scores: MatchScore[]
  walkover: boolean
  retired: boolean
  time?: string                 // "HH:MM" from the match footer
  date?: string                 // as BAT prints it
  court?: string
}

export interface BracketRound {
  name: string                  // normalised: R64, R32, R16, QF, SF, Final
  matches: BracketSlotMatch[]   // DOM order
}

export function parseBracketRounds(html: string): BracketRound[]
```

It walks the same `swiper-slide` / `.bracket-round__match-group-wrapper`
structure `feedersFrom` walks, and reuses `extractMatchTeams` and
`extractMatchSchedule`. Position is the relationship: match `i` of round `r`
is fed by matches `2i` and `2i+1` of round `r-1`. This is the same index rule
`feedersFrom` relies on.

BAT prints a seed as a suffix on the player's name in the bracket itself
(`ภูมิพิพัชญ์ พึ่งโพธิ์สภ [2]` in `fixtures/bracket-bat-ysb-bsu13.html`). The
parser lifts that mark into `seeds` and stores the name without it, using the
same pattern as `stripSeed` in `lib/playerIndex.ts`. Seeds therefore need no
second data source.

Returns `[]` when the markup has no bracket.

### `buildBracketPath` (new, `lib/bracketPath.ts`)

```ts
export interface PathRound {
  round: string
  status: 'won' | 'lost' | 'next' | 'future' | 'bye'
  opponent?: MatchPlayer[]          // known opponent (won, lost, next)
  scores?: MatchScore[]
  walkover?: boolean
  retired?: boolean
  time?: string
  date?: string
  court?: string
  candidates?: Array<{ team: MatchPlayer[]; seed?: string }>
                                    // future, or next with opponent undecided
}

export interface BracketPath {
  team: MatchPlayer[]               // the player, with partner in doubles
  eliminated: boolean
  champion: boolean
  rounds: PathRound[]
}

export function buildBracketPath(
  rounds: BracketRound[],
  playerId: string,
): BracketPath | null
```

Rules:

- Find the earliest round with a match containing `playerId`. `null` when the
  player is not in the bracket.
- Follow the player forward by position (`i → floor(i / 2)`).
- A match the player is in, decided, gives `won` or `lost`. After `lost` the
  route stops and `eliminated` is true.
- A match the player is in with no opposing team and no result is `bye` when
  the opposing feeder subtree holds no players at all, otherwise `next` with
  `candidates`.
- A round the player has not reached yet is `future`.
- **Candidates** for a slot are the teams that can still come out of the
  opposite feeder subtree: if that feeder match is decided, its winner only;
  if it has two teams and no result, both; if it is empty, recurse into its
  own feeders. A team that has already lost is never a candidate.
- Winning the last round sets `champion`.

### Favourite and past record (in the route)

For each `candidates` list the route attaches, per team:

- **Seed** — already on the candidate, read from the bracket by
  `parseBracketRounds`. Compared by its leading number, so "3/4" ranks as 3.
- **Ranking position** — from `readRankingCache('bat')`, in the ranking event
  that matches the draw, joined by slug, using the existing helpers in
  `lib/ranking/pair-lookup.ts`. Absent when the draw has no matching ranking
  event.
- **Past record** — see below.

**Favourite rule**, in order: lowest seed number among the candidates; else
best ranking position; else no favourite. A tie on seed (shared seeds such as
3/4) falls through to ranking; a tie that survives both means no favourite.
When there is no favourite the row shows the count only.

Candidates are returned sorted: favourite first, then by seed, ranking
position, name.

**Past record** comes from the BAT player index (`readIndexCache('bat')`):

- Look up the player's record by `nameToSlug(name)`.
- Scan every match in `tournamentMatches`. A match counts when the slug set of
  its `opponents` equals the slug set of the candidate team. In doubles the
  slug set of `partners` must also equal the player's current partner, so the
  record is between the same two pairs.
- `W`, `WO-W`, `RET-W` count as wins; the rest as losses.
- Result: `{ wins, losses }`, or `null` when the player has no index record or
  no `tournamentMatches`. `{0, 0}` is a real answer and renders as "first
  meeting"; `null` renders nothing.

### `GET /api/path`

Query: `tournament` (BAT guid), `draw` (draw number), `player` (BAT player id).

```ts
interface PathCandidate {
  team: MatchPlayer[]
  seed?: string                 // as printed, e.g. "1" or "3/4"
  rank?: number
  record: { wins: number; losses: number } | null
  favourite: boolean
}

interface PathRoundOut extends Omit<PathRound, 'candidates'> {
  record?: { wins: number; losses: number } | null   // for a known opponent
  candidates?: PathCandidate[]
}

interface PathResponse {
  team: MatchPlayer[]
  eliminated: boolean
  champion: boolean
  rounds: PathRoundOut[]
  stale: boolean                // bracket served from a copy past its TTL
}
```

- The route first calls `ensureBracketsLoaded(guid, drawNum)`, so a finished
  tournament's bracket is read from its file on disk and not fetched again.
  It then takes the HTML from `bracketHtmlForSchedule(guid, drawNum)`, sharing
  the bracket cache, its background refresh and its outage fallback. The only
  BAT request this can cause is the single bracket fetch that function already
  makes when no copy is held at all.
- `stale` is true when the bracket's cache entry
  (`cache.get(makeBracketKey(guid, drawNum))`) is not marked done and its `ts`
  is older than `ttlMsFor(entry)`.
- `404` when the draw has no bracket, the bracket has no rounds, or the player
  is not in it. `400` on missing params.
- Sent with the same stale headers the bracket route uses
  (`lib/stale-headers.ts`) when the copy is stale.
- Wrapped in the request timer and counted in site requests like the other
  API routes.

## UI

### Entry point

`PlayerModal` shows the player's matches for the selected tournament, and
each match carries its `draw` name and `drawNum`. The distinct draws among
`profile.matches` are the draws the player is in. Add one "Path to final"
button per such draw, labelled with the draw name when there is more than
one. Clicking it opens `PathToFinalModal` with
`{ tournamentId, drawNum, playerId }`.

The button is shown only when `provider` is `bat` and the draw is a knockout
draw. `PlayerModal` gets the tournament's draw list (`DrawInfo[]`, which the
page already loads through `/api/draws`) as a new prop and hides the button
for any draw whose `type` is not an elimination draw, and for grouped draws
(`groupLetter` set). A player with no matches yet in the tournament gets no
button.

### `PathToFinalModal`

- Header: player name (and partner), event name.
- One row per round, in play order, using the existing round labels
  (`longRoundL`).
- Row content by `status`:
  - `won` / `lost` — opponent, score, the existing walkover / retired pills,
    win or loss marker.
  - `bye` — "Bye".
  - `next` with a known opponent — opponent, time and court when present, past
    record.
  - `next` or `future` with candidates — favourite with seed and record, then
    "+N others". Tapping expands the full candidate list inline, each with
    seed, ranking position and record. With no favourite: "N possible
    opponents", same expansion.
- After a `lost` row: a single "Out in {round}" line, no further rows.
- `champion`: a "Champion" line after the final.
- Footer note: the record covers tournaments tracked on BATMatch.
- Tapping an opponent's name calls the existing `onPlayerClick`.
- Loading and error states match `H2HModal`. The stale-data notice is the
  existing `StaleCacheBanner` wording.
- Phone-first: one column, rows wrap, modal scrolls.

### Strings

New `th` and `en` entries in `lib/i18n.ts`: button label, panel title,
"likely", "+N others", "N possible opponents", "first meeting", "record",
"bye", "out in {round}", "champion", footer note.

### Analytics

One PostHog event when the panel opens (`path_to_final_opened`, with
tournament id and event name), through `lib/analytics.ts`, so its use can be
compared with other features.

## Error handling

| Case | Behaviour |
|------|-----------|
| Bracket not cached and BAT down | Route returns 404; panel shows the standard "could not load" message |
| Bracket stale | Panel renders and shows the stale notice |
| Draw is a group stage | Button not shown |
| Player index or ranking cache missing | Rows render without record or ranking; favourite falls back to seed only |
| Draw has no seeds | Favourite falls back to ranking |
| Opposite subtree entirely empty | Row is `bye` |
| Draw published with no entrants | 404, as the bracket has no players |

## Testing

- `__tests__/parseBracketRounds.test.ts` — against `bracket-bat-ysb-bsu13.html`,
  `bracket-bat-bsu9.html`, `bracket-bat-themall-bdu17.html` (doubles) and
  `bracket-bat-unentered.html`: round names, match counts halving per round,
  decided winners, empty slots, seed marks lifted off names.
- `__tests__/bracketPath.test.ts` — hand-built `BracketRound[]` inputs: player
  in round 1; first-round bye; mid-tournament with `won` then `next`; opponent
  undecided; candidates across two and three rounds; eliminated player;
  champion; losers excluded from candidates; doubles; unknown player returns
  `null`.
- `__tests__/path-favourite.test.ts` — seed beats ranking; shared seed falls
  to ranking; no data gives no favourite; sort order.
- `__tests__/path-record.test.ts` — singles count; doubles requires the same
  partner; walkover and retirement outcomes; no index record gives `null`.
- `__tests__/api-path-route.test.ts` — 400, 404, a full response from a
  fixture bracket, stale flag.
- `__tests__/PathToFinalModal.test.tsx` — each row state, expand and collapse,
  both languages.
- `npm test` and `npm run lint` pass.

## Open points for the implementation plan

- Exact name matching between a draw and its ranking event. The plan must
  check this against real cached data; the join degrades to "no ranking" when
  it misses, so a miss is never an error.
- How BAT prints a shared seed in a bracket ("3/4" is assumed; the fixtures
  on hand only show single numbers).
- The exact `DrawInfo.type` text BAT prints for an elimination draw, read
  from `fixtures/draws-seeded.html` and `fixtures/draws-grouped.html`.
- Where in `PlayerModal` the button sits on a narrow screen.

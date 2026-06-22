# Top Players W-L hover tooltip — Design

**Date:** 2026-06-21
**Component:** Tournament Stats → *Top players (by tournament wins)*

## Goal

Hovering (or keyboard-focusing) the **W-L** cell in the *Top players* table shows a
tooltip listing that player's match-by-match results for the tournament — the
matches that add up to the displayed win-loss record.

Each tooltip row reads, e.g.:

```
MD · QF   W  vs Smith/Lee     21-18, 21-15
MD · SF   W  vs Tan/Wong      19-21, 21-17, 21-12
MD · F    L  vs Cho/Park      18-21, 21-19, 17-21
```

## Behavior decisions

- **Content:** match-by-match (event · round, W/L, opponent, set scores).
- **Long lists:** the tooltip scrolls (`max-height` + `overflow-y: auto`), mirroring
  the existing roster-name tooltip. Every match is shown — no cap.
- **Trigger / a11y:** hover + focus + focus-within, same as `MedalCell`/`RosterCell`
  (`tabIndex={0}`, `role="tooltip"`).
- **Share screenshots:** the tooltip is hidden in captured images
  (`.stats-share-capture` rule), consistent with the medal/roster tips.

## Reconciliation invariant (most important constraint)

`buildTopPlayers` counts a match into a player's W-L **only when**
`match.winner !== null && !match.walkover` (current code, `lib/tournamentStats.ts`).
This **includes retired matches** (they have a winner and are not walkovers) and
**excludes walkovers**.

The `results` array MUST be built off the *exact same condition, inside the same
tally loop*, so it never drifts from the count.

**Invariant:** for every row, `results.filter(r => r.won).length === wins` and
`results.filter(r => !r.won).length === losses`.

## 1. Data model — `lib/types.ts`

Add an **optional** field to `StatsTopPlayer` (optional keeps existing test
fixtures and the two `topPlayers: []` init sites valid; the cache bump forces
recompute regardless):

```ts
export interface StatsPlayerResult {
  event: string        // match.draw
  round: string        // raw round string; rendered via abbrevRoundL at display time
  won: boolean
  opponent: string[]   // opposing team player names, seed-stripped
  scores: MatchScore[] // PLAYER-perspective orientation (see below)
  retired?: boolean    // these still count in W-L; flagged so UI can mark "(ret.)"
}

export interface StatsTopPlayer {
  playerId: string
  name: string
  seed?: string
  club: string
  wins: number
  losses: number
  results?: StatsPlayerResult[]   // NEW
}
```

## 2. Builder — `buildTopPlayers` in `lib/tournamentStats.ts`

Inside the existing `team1`/`team2` loops (same `winner !== null && !walkover`
guard), in addition to incrementing wins/losses, push a result onto the player's
record. For a player on `playerSide` (1 or 2):

- `won = winSide === playerSide`
- `opponent` = the **other** team's names, run through `extractSeed` /
  `stripSeedSuffix` (not raw `name`).
- **Score orientation:** `match.scores` are stored team1-perspective (`t1`/`t2`).
  If the player is on **team2**, swap each score to `{ t1: s.t2, t2: s.t1 }` so a
  win reads `21-18` rather than `18-21`. team1 players use scores as-is.
- `retired = match.retired || undefined`

Extend the per-player record (`Rec`) with `results: StatsPlayerResult[]`.

**Sort** each player's `results` before emitting: by event
(`eventRank(event)`, then event name as tiebreak), then by round depth
shallow→deep (R128 → … → QF → SF → F). Reuse a round-depth notion consistent with
the rest of the codebase (`abbrevRoundL` normalizes to `F`/`SF`/`QF`/`R{n}`; depth
can be derived from that — `F` deepest). Event groups follow the same discipline
ordering used elsewhere in the panel (`eventRank`).

Emit `results` on each row object alongside the existing fields.

## 3. Cache — `lib/stats-cache.ts`

Bump `StatsCacheEnvelope.version` **10 → 11** and update the two `version`
literals in `readStatsCache` (the `!== 10` guard). Add a comment line documenting:
"v11 adds results[] (match-by-match) to each topPlayers row for the W-L hover
tooltip." Older envelopes are invalidated and recompute with the new field.

## 4. Render — `components/TournamentStatsPanel.tsx`

Add a `WLCell` component modeled on `MedalCell`:

```tsx
function WLCell({ wins, losses, results, lang }: {
  wins: number; losses: number; results?: StatsPlayerResult[]; lang: 'en' | 'th'
}) {
  const cell = <><b>{wins}</b>–<i>{losses}</i></>
  if (!results || results.length === 0) return cell   // empty-state guard
  return (
    <span className="stats-wl-cell" tabIndex={0}>
      {cell}
      <span className="stats-wl-tip" role="tooltip">
        {results.map((r, i) => (
          <span className="stats-wl-tip-row" key={i}>
            <span className="stats-wl-tip-where">{r.event} · {abbrevRoundL(r.round, lang)}</span>
            <span className={`stats-wl-tip-res ${r.won ? 'is-win' : 'is-loss'}`}>
              {r.won ? 'W' : 'L'}
            </span>
            <span className="stats-wl-tip-opp">{r.opponent.join(' / ')}{r.retired ? ' (ret.)' : ''}</span>
            <span className="stats-wl-tip-score">{r.scores.map(s => `${s.t1}–${s.t2}`).join(', ')}</span>
          </span>
        ))}
      </span>
    </span>
  )
}
```

Replace the cell at the current line 308:

```tsx
<td className="stats-num stats-wl">
  <WLCell wins={p.wins} losses={p.losses} results={p.results} lang={lang} />
</td>
```

Import `abbrevRoundL` from `@/lib/i18n` and `StatsPlayerResult` from `@/lib/types`.
W/L labels and "(ret.)" use the existing `lang` for any localization (Thai: ชนะ/แพ้
optional — keep "W"/"L" if simplest; decide during implementation, default to W/L).

## 5. CSS — `app/globals.css`

Add `stats-wl-cell` / `stats-wl-tip` / `stats-wl-tip-row` classes near the
`stats-medal-*` / `stats-roster-*` blocks. Reuse the surface/border/shadow tokens.
Differences from the narrow roster/medal tips:

- Wider tip (rows carry where + result + opponent + scores), e.g.
  `min-width: 280px; max-width: 380px`.
- Scroll: `max-height: 320px; overflow-y: auto` (same as roster tip).
- Row layout: a grid/flex row aligning the four spans; scores right-aligned,
  tabular-nums; muted "where" column; `.is-win` / `.is-loss` color accents.
- Hover/focus/focus-within reveal rule, matching the existing tips.
- `.stats-share-capture .stats-wl-tip { display: none !important; }`.

## Out of scope

- No change to the per-event/round-path alternative formats.
- No new API surface — `results` rides the existing `/api/stats` payload.
- Multi-Gold and Events tables unchanged.

## Verification

- Type-check / build passes.
- For a finished tournament: pick a finalist row; confirm tooltip row count ===
  wins+losses, W rows === wins, L rows === losses.
- Confirm scores read player-first on both team1 and team2 rows (spot-check a
  loss where the player was on team2).
- Confirm retired matches appear and are flagged; walkovers do **not** appear.
- Empty `results` (or old cache pre-recompute) renders the plain W-L with no
  tooltip and no crash.
- Tooltip scrolls when long; hidden in share-capture screenshots.

# Live Score — Design Spec

**Date:** 2026-04-24
**Branch:** `live-score`
**Status:** Draft — awaiting review

## Summary

Augment the Match Schedule with real-time live scores for matches that are currently in progress. Live data is pushed by the public `livescore.tournamentsoftware.com` SignalR hub (ASP.NET classic SignalR 2.x). Only a subset of tournaments publish a live feed; for the rest, the app looks and behaves exactly as it does today. No server-side change, no new Next.js route, no new npm dependency.

## 1. User-facing behavior

- **Where it appears.** Inside the existing Match Schedule view (the default view). Static match cards are unchanged; a match flagged `nowPlaying` that also has a matching live-feed entry gets an overlay.
- **What the overlay shows.**
  - A small red **LIVE** badge rendered before the event code (e.g. `[LIVE] WS`).
  - Inside the score cell, completed games render in the existing text style (e.g. `21‑15`). The in-progress game is appended in red (e.g. `, 11‑9`). Between games — when the feed reports no current game — only completed sets show; the LIVE badge remains.
  - On mobile, the same pattern: LIVE badge in the card meta row, and the in-progress per-row points render in red inside the existing scoreboard cells.
- **Freshness.** Updates arrive via WebSocket push. No user action needed. The schedule scrape's own `nowPlaying` green pulse is replaced visually by the red LIVE badge when the overlay applies; it persists as-is for `nowPlaying` matches whose live data does not validate (or for tournaments without a feed).
- **No new controls.** No toggle, no opt-in UI — live mode activates automatically when applicable, and silently falls back when not.

## 2. Architecture

- **SignalR transport.** ASP.NET classic SignalR 2.x speaks a documented protocol: a `GET /signalr/negotiate` returns a `ConnectionToken`, followed by a WebSocket to `/signalr/connect?transport=webSockets&connectionToken=…&connectionData=[{"name":"scoreboardHub"}]&clientProtocol=1.5`. The client invokes `joinScoreboardNew(<tournamentGUID>)`. The server pushes `sendScoreboard(data)` and periodic `heartbeat()` frames. Shutdown is an `abort` frame plus socket close.
- **Single client module: `lib/live-score.ts`.** Self-contained SignalR 2.x client, zero runtime dependencies (no jQuery SignalR bundle, no `@microsoft/signalr`). It speaks the protocol directly over the browser `WebSocket` and `fetch` APIs. Exposes an `EventEmitter`-like API:
  - `connect(tournamentId: string): void`
  - `disconnect(): void`
  - `on('scoreboard', (courts: CourtLive[]) => void)`
  - `on('state', (state: 'idle' | 'negotiating' | 'subscribed' | 'active' | 'reconnecting' | 'disabled') => void)`
  - Also exports a pure helper `matchLiveCourt(entry: MatchEntry, map: Map<string, CourtLive>): CourtLive | null` for use by the view layer.
- **React hook: `lib/useLiveScore.ts`.** Owns one instance of the client at a time. Input: `tournamentId: string | null` and a `gateOpen: boolean` flag (see §2.1). Output: `Map<string, CourtLive>` keyed by normalized court name. Opens the connection when both inputs are truthy; tears it down when either flips. Handles visibility changes and reconnect/back-off internally.
- **Integration point: `app/page.tsx`.** Derives `gateOpen = matchGroups.some(g => g.matches.some(m => m.nowPlaying))` and calls `useLiveScore(selectedTournament, gateOpen)`. Passes the resulting map down to `MatchSchedule` as a new prop `liveByCourt?: Map<string, CourtLive>`.
- **Rendering: `components/MatchSchedule.tsx`.** For each match with `nowPlaying === true`, calls `matchLiveCourt(match, liveByCourt)`. If the helper returns non-null, renders the LIVE badge and the in-progress score in the new `set-live` class. Otherwise renders exactly as today. `React.memo` wrapping is not adopted unless profiling shows waste; the update frequency (≤1 Hz per push in practice) is low.

### 2.1 Connection gate

The hook opens a WebSocket only when both:

1. A tournament is selected, AND
2. The current `matchGroups` contains at least one match with `nowPlaying === true`, AND
3. The tournament id is not in the in-memory `unsupported` set.

The `unsupported` set is a module-level `Set<string>`. It is populated the first time a connection reaches the `subscribed` state for a tournament and then receives an empty `CS[]` for 8 consecutive seconds. That tournament is skipped for the remainder of the page session. The set is not persisted.

## 3. SignalR payload → `CourtLive`

Upstream payload (observed in `/visual-livescore/<GUID>` HTML):

```
{
  S:  number,        // sport code
  CS: Court[]        // one entry per court
}

Court = {
  CID: number, N: string,
  MID: number,       // match id; <= 0 means idle
  E: string, R: string,
  W: 0|1|2, D: number,
  T1: Team, T2: Team,
  SCS: { W:0|1|2, T1:number, T2:number }[],
  LSC: { GMNO:number, STNO:number, T1:number, T2:number } | null,
  SW: boolean, SW1: boolean, SW2: boolean,
  MST: boolean
}

Team = {
  ID: number, N: string, F: string, P: number,
  P1ID, P1N, P1F, P1ABR,
  P2ID, P2N, P2F, P2ABR,
  P3ID, P3N, P3F, P3ABR
}
```

Normalized to `CourtLive`:

```ts
interface CourtLive {
  courtKey: string                             // normalize(N)
  matchId: number                              // MID (>0 only)
  playerIds: string[]                          // non-empty P{1,2,3}ID as strings, both teams
  setScores: { t1: number; t2: number; winner: 0 | 1 | 2 }[]  // from SCS
  current: { gameNo: number; setNo: number; t1: number; t2: number } | null  // from LSC
  serving: 0 | 1 | 2                           // inferred from LSC
  winner: 0 | 1 | 2                            // W
  team1Points: number                          // T1.P
  team2Points: number                          // T2.P
  durationSec: number                          // D
}
```

Courts with `MID <= 0` are omitted from the output map entirely.

## 4. Court-to-match matching

```ts
function normalize(courtName: string): string {
  return courtName.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function matchLiveCourt(
  m: MatchEntry,
  map: Map<string, CourtLive>,
): CourtLive | null {
  if (!m.nowPlaying || !m.court) return null
  const key = normalize(m.court)
  const live = map.get(key)
  if (!live) return null
  const schedIds = new Set(
    [...m.team1, ...m.team2].map(p => p.playerId).filter(Boolean),
  )
  const overlap = live.playerIds.some(id => schedIds.has(id))
  return overlap ? live : null
}
```

`normalize` canonicalizes differences like `"Court - 3"` vs `"Court 3"` vs `"3"`. Player-ID overlap requires at least one `playerId` to be shared between the scheduled match and the live court, protecting against back-to-back matches on the same court during a transition window.

## 5. Connection lifecycle

States: `idle → negotiating → subscribed → active → reconnecting → disabled` (terminal for this session).

- **`idle`.** No connection. Entered when the hook has no tournament id, or the gate is closed, or the tournament is in `unsupported`.
- **`negotiating`.** `fetch('…/signalr/negotiate?clientProtocol=1.5&connectionData=[{"name":"scoreboardHub"}]&VClientID=…')`, 10 s timeout. On success, transitions to `subscribed` after opening the WebSocket and sending `joinScoreboardNew`. A 4xx response (e.g. a rotated `VClientID`) transitions directly to `disabled` — no retry. A 5xx or network/timeout failure transitions to `reconnecting`.
- **`subscribed`.** Socket is open, subscription sent. If 8 s pass without a non-empty `CS[]`, add tournament to `unsupported` and transition to `disabled`. Otherwise, the first non-empty push transitions to `active`.
- **`active`.** Normal operation. Fires `'scoreboard'` on each `sendScoreboard`. A missed heartbeat for > 35 s triggers `reconnecting`.
- **`reconnecting`.** Exponential back-off: 1, 2, 4, 8, 15 s (capped). Max 5 consecutive attempts before transitioning to `disabled`.
- **`disabled`.** Terminal for this tournament in this session. The hook will not reconnect, including on visibility-change, until the user selects a different tournament (or reloads the page). Entering `disabled` also adds the tournament id to the `unsupported` set so re-selecting the same id in the session is an immediate no-op.

**Visibility handling.** `document.visibilityState === 'hidden'` for > 60 s sends `abort` and closes the socket; returning to visible reopens from `negotiating`, unless the tournament is in `disabled` (in which case the hook stays idle).

**Tournament switch / unmount.** Always sends `abort` (per SignalR 2.x spec) and closes cleanly.

**Unsupported `VClientID`.** The hard-coded value `NYrnY8LtCyasfDWQHf9KFBsdfgCwjpvWQ4JHTNtJg` is copied verbatim from the upstream HTML, which serves it unauthenticated to all visitors. If upstream rotates it, the negotiate call 4xx's; per the `negotiating` state above, this transitions directly to `disabled` without a user-visible error.

## 6. Affected files

### New files

- **`lib/live-score.ts`** — SignalR 2.x client, payload normalization, `matchLiveCourt` helper, `CourtLive` type.
- **`lib/useLiveScore.ts`** — React hook wrapping the client.
- **`__tests__/live-score.test.ts`** — unit tests for the client, the normalizer, and the matcher.
- **`__tests__/useLiveScore.test.tsx`** — hook lifecycle tests (gate, reconnect, visibility, soft-disable).

### Modified files

- **`lib/types.ts`** — export `CourtLive`.
- **`app/page.tsx`** — compute `gateOpen`, call `useLiveScore`, pass `liveByCourt` into `MatchSchedule`.
- **`components/MatchSchedule.tsx`** — accept `liveByCourt?: Map<string, CourtLive>`. Call `matchLiveCourt` per row. When a live record is returned: render the `LIVE` badge and the `set-live` span, and **suppress** the existing `ms-now-playing` green pulse for that row. When no live record is returned: render today's green pulse as a fallback (preserves current behavior for non-live tournaments, between-court-transitions, and matches the feed doesn't validate).
- **`app/globals.css`** — add styles:
  - `.ms-live-badge { … background: #ef4444; color: #fff; padding: 1px 5px; border-radius: 3px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; margin-right: 6px; }` plus a dark-mode override that keeps the badge legible (`color` stays white; background unchanged).
  - `.ms-score .set-live { color: #ef4444; font-weight: 700; }` plus dark-mode override `html.dark .ms-score .set-live { color: #ff7b72; }` (reuses the `--red` token's dark value from the existing dark-mode palette).
  - `.ms-board-set.live` mobile equivalent with the same two-theme coloring.
- **`lib/i18n.ts`** — add one key, `live` ("LIVE" / "สด"), used as the badge text.

### Explicitly NOT modified

- **Server / Next.js API routes.** No new route. No change to `/api/matches`. Live data flows directly from browser to upstream over WebSocket.
- **`next.config.js`, `vercel.json`.** No Edge/serverless config change needed.
- **Dark-mode palette.** Reuses existing `--red` tokens where applicable; does not introduce new color tokens.
- **Bracket view.** Live scores do not appear on the bracket canvas in this iteration; only the Match Schedule view.

## 7. Testing

### Unit — `__tests__/live-score.test.ts`

- **SignalR client protocol.** Mock `global.fetch` and `global.WebSocket`:
  - Negotiate URL includes `clientProtocol=1.5`, `connectionData=[{"name":"scoreboardHub"}]`, and the `VClientID` query.
  - After negotiate, WS is opened to `/signalr/connect` with the returned `connectionToken`.
  - On `open`, the client sends `{"H":"scoreboardHub","M":"joinScoreboardNew","A":["<GUID>"],"I":0}`.
  - Incoming `{"C":"…","M":[{"H":"scoreboardHub","M":"sendScoreboard","A":[payload]}]}` fires `'scoreboard'` with normalized courts.
  - Incoming `{"M":[{"M":"heartbeat"}]}` updates internal `lastHeartbeat`; no event emitted.
  - Two heartbeats missed (>35 s via fake timers) triggers `reconnecting`.
  - `disconnect()` sends `abort` frame then closes the socket.
- **Payload mapping.** Table-driven:
  - Active single match: `MID>0`, one completed `SCS`, live `LSC` → `setScores.length === 1`, `current` populated.
  - No active match: `MID <= 0` → omitted from output.
  - Between games: `LSC === null` with non-empty `SCS` → `current === null`.
  - Triples (`P3ID > 0`) → `playerIds` includes P3.
  - Missing numeric fields default to 0; missing optional fields default to `null`.
- **Matcher (`matchLiveCourt`).** Cases:
  - `nowPlaying:true` + normalized court hits + at least one `playerId` in common → returns live.
  - `nowPlaying:true` + court hits + no `playerId` overlap → returns null.
  - `nowPlaying:true` + no court key match → returns null.
  - `nowPlaying:false` → returns null regardless.
  - Empty `court` string on match → returns null.

### Unit — `__tests__/useLiveScore.test.tsx`

- `renderHook` with `tournamentId=null` → no connection attempt.
- `rerender` with a tournament id + gate open → client.connect called once.
- `rerender` with gate flipping false → disconnect called.
- Soft-disable: simulate `subscribed` + 8 s empty → next mount with same id stays idle.
- Visibility hidden for 60 s disconnects; visible re-negotiates.

### Component — `components/MatchSchedule` (extend existing tests)

- `nowPlaying:true` match + matching live record → renders `.ms-live-badge` and `.set-live` span containing the current set's `t1-t2`.
- `nowPlaying:true` match + no live record → renders today's green `.ms-now-playing` pulse, no `.ms-live-badge`.
- `nowPlaying:true` match + live record with `current === null` (between games) → renders `.ms-live-badge` but no `.set-live` (only completed sets shown).

### Integration (manual)

Run `npm run dev`, select tournament `D5DF6DCC-DBCE-4E78-8B43-E4681BEFE8CC` during a live session. Verify:

1. LIVE badge appears on matches reported as in-progress.
2. Score updates without refreshing.
3. Switching tournaments closes the WebSocket (DevTools → Network → WS).
4. Leaving a `nowPlaying`-less tournament does not open a WebSocket.
5. A tournament without a live feed never re-attempts connection after the 8-second soft-disable.

CI does not depend on upstream SignalR. All automated tests mock the socket.

## 8. Out of scope

- Bracket-view live score display. Live updates are Match Schedule only in this iteration.
- Per-player subscription (e.g. "notify me when this player starts").
- Court-by-court scoreboard view (like the official Visual LiveScore page).
- Service / rally direction indicators, per-shot statistics, charts.
- Desktop/mobile push notifications.
- Server-side relay of SignalR data or an `/api/livescore` Next.js route.
- Persisting `unsupported` tournaments across sessions.
- Historical live-score replay.

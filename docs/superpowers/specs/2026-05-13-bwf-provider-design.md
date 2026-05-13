# BWF Provider — Adding Badminton World Federation Tournament Support

**Date:** 2026-05-13
**Status:** Design approved
**Implementer scope:** New code under `lib/providers/`; additive changes to `app/api/tournaments/route.ts`, `instrumentation.ts`, `lib/types.ts`, and existing cache modules.

## Goal

Allow BWF tournaments (e.g. `https://bwfbadminton.com/tournament/5726/...`) to appear in BATBracket alongside BAT tournaments by adding a single `@bwf <url>` line to `public/tournaments.txt`. End goal is feature parity with BAT (draws, schedules, live scores, player profiles, H2H, stats, alerts, share-as-image). MVP is draws + match schedule.

## Hard Constraints

1. **BAT behavior must be unchanged** — no observable change for any existing BAT tournament: identical API responses, identical cache file contents, identical UI rendering. Existing tests must pass without modification. Source code in modified cache modules will gain a new dispatch branch, but the BAT path falls through unchanged; in `app/api/tournaments/route.ts`, the existing branches that handle GUID lines, `# deny`, and comments are kept **source byte-identical** so a diff makes the additive nature obvious.
2. **No BWF failure may disturb BAT** — every BWF entry point catches errors and degrades to null/empty/cached; BAT calls never traverse BWF code.
3. **One tournaments.txt entry per BWF tournament** — no manual ID lookup; the system extracts `tmtId` + `tournamentCode` from the public URL on first sight.

## Background

BWF runs on a separate platform from BAT (Thailand). Key findings from investigation:

- BWF's public site (`bwfbadminton.com`) is a Vue.js SPA backed by a JSON API at `https://extranet-lv.bwfbadminton.com`.
- The API uses Bearer token auth; the token is embedded in every tournament page's HTML inside the Vue config block.
- BWF identifies tournaments by both:
  - `tmtId` — numeric (e.g., `5726`), used by `/api/vue-tournament-*` POST endpoints
  - `tournamentCode` — GUID (e.g., `6E65C36E-497D-42D2-8F4E-78A2D30D9893`), used by `/api/tournaments/*` GET endpoints
- All BWF endpoints sit behind Cloudflare bot protection that JA3-fingerprints the TLS handshake. `curl` and Node `fetch` both get HTTP 403 regardless of valid Bearer token + browser-realistic headers. Real Chromium passes the JS challenge.
- BWF's JSON shape maps almost 1:1 to BATBracket's existing types (`MatchEntry`, `BracketData`, `MatchesData`, etc.).

## Architecture

### Provider abstraction

New interface `lib/providers/types.ts`:

```ts
export type ProviderTag = 'bat' | 'bwf'

export interface TournamentRef {
  id: string          // GUID for both providers
  provider: ProviderTag
}

export interface TournamentProvider {
  tag: ProviderTag
  getMeta(ref: TournamentRef): Promise<TournamentInfo | null>
  getDraws(ref: TournamentRef): Promise<DrawInfo[]>
  getBracket(ref: TournamentRef, drawNum: string): Promise<BracketData | null>
  getMatchesFull(ref: TournamentRef): Promise<MatchesData | null>
  getDayMatches(ref: TournamentRef, dateIso: string): Promise<MatchScheduleGroup[]>
  getPlayer(ref: TournamentRef, playerId: string): Promise<PlayerProfile | null>
  getH2H(ref: TournamentRef, p1: string, p2: string): Promise<H2HData | null>
  getLiveScore(ref: TournamentRef, matchId: string): Promise<MatchEntry | null>
}
```

Dispatch helper `lib/providers/resolve.ts`:

```ts
export function providerFor(ref: TournamentRef): TournamentProvider {
  return ref.provider === 'bwf' ? bwfProvider : batProvider
}
```

`BatProvider` is a pure pass-through wrapper around existing `lib/scraper.ts` + `lib/bat-fetch.ts`. No logic is moved or rewritten — the wrapper just forwards calls. This is what guarantees BAT byte-identity.

### File layout

```
lib/providers/
  types.ts                 — TournamentProvider interface, ProviderTag, TournamentRef
  resolve.ts               — providerFor() dispatch helper
  bat-provider.ts          — pass-through wrapper (imports lib/scraper.ts, lib/bat-fetch.ts)
  bwf-provider.ts          — BwfProvider class implementing TournamentProvider
  bwf/
    cf-context.ts          — Persistent Chromium singleton with CF challenge solving
    api-client.ts          — Typed wrappers for ~10 BWF API endpoints
    parsers.ts             — Pure functions: BWF JSON → app types
    url-resolver.ts        — Public URL → { tmtId, tournamentCode, slug, name, dates }
```

External files modified (additive only):

```
app/api/tournaments/route.ts  — Parser recognizes @bwf URL lines
instrumentation.ts            — Calls cf-context.primeIfNeeded() at server startup
lib/types.ts                  — TournamentInfo gets optional `provider?: ProviderTag` field
public/bwf-cache.json         — Sidecar (created at runtime; not committed initially)
```

Cache modules touched (dispatch-only changes; behavior unchanged for BAT IDs):

```
lib/draws-cache.ts
lib/matches-full-cache.ts
lib/bracket-cache.ts
lib/day-cache.ts
lib/stats-cache.ts
lib/live-score.ts
```

## CF Context Lifecycle

### State

```ts
let context: BrowserContext | null = null
let token: string | null = null
let lastPrime: number = 0
let primePromise: Promise<void> | null = null
const PRIME_TTL_MS = 25 * 60_000
```

### prime()

1. Launch headless Chromium via `@sparticuz/chromium` (already in `package.json`).
2. Create a `BrowserContext` with realistic UA + locale.
3. `goto('https://bwfbadminton.com/calendar/')` to bank the `cf_clearance` cookie. CF's JS challenge auto-solves in real Chromium.
4. Open any BWF tournament page; regex-extract `token: "..."` from the rendered HTML.
5. Store `context`, `token`, `lastPrime = Date.now()`.

A mutex (`primePromise`) ensures concurrent first-callers share one launch.

### request(method, path, body?)

```ts
async function request<T>(method, path, body?): Promise<T> {
  if (!context || Date.now() - lastPrime > PRIME_TTL_MS) await prime()
  const res = await context!.request.fetch(
    `https://extranet-lv.bwfbadminton.com${path}`,
    { method, headers: { Authorization: `Bearer ${token}` }, data: body }
  )
  if (res.status() === 401) { await refreshToken(); /* retry once */ }
  if (res.status() === 403) { await prime(); /* retry once */ }
  return res.json()
}
```

### Lifecycle hooks

- **Startup**: `instrumentation.ts` calls `primeIfNeeded()` after the existing cache prewarmers. Failure is logged but non-fatal — BWF endpoints return null/empty until the next prime succeeds.
- **Refresh**: opportunistic on every request via TTL check; reactive on 401/403.
- **Shutdown**: SIGTERM handler closes context.
- **Dev HMR**: cache singleton on `globalThis.__bwfCf` to survive Next.js module reloads.

### Resource budget

- ~150MB Chromium + ~50MB context = ~200MB resident
- Single context handles all BWF requests across all tournaments
- ~5s cold start; ~50ms steady-state per request

## Data Flow

### ID mapping

BWF tournaments use **`tournamentCode` (GUID) as their public `id`**. The numeric `tmtId` lives only inside `BwfProvider`, looked up from the sidecar's in-memory map keyed by GUID.

Consequences:
- UI routes (`/tournament/[id]`) work unchanged.
- Cache files (keyed by GUID) work unchanged.
- All API routes work unchanged.
- BAT and BWF GUIDs are drawn from disjoint distributions — no collision risk.

### Sidecar (`public/bwf-cache.json`)

```json
{
  "https://bwfbadminton.com/tournament/5726/mith-yonex-...-2026/": {
    "tmtId": 5726,
    "tournamentCode": "6E65C36E-497D-42D2-8F4E-78A2D30D9893",
    "slug": "mith-yonex-pathumthanee-u13-u15-u17-international-junior-2026",
    "name": "MITH YONEX Pathumthanee U13 U15 U17 International Junior 2026",
    "startDateIso": "2026-05-19",
    "endDateIso": "2026-05-24",
    "resolvedAt": "2026-05-13T04:30:00Z"
  }
}
```

`BwfProvider` keeps an in-memory `Map<guid, sidecarEntry>` rebuilt from the file at startup and on file change.

### URL resolution flow

Runs once per new `@bwf <url>` entry:

1. `tournaments.txt` parser sees `@bwf <url>` → check sidecar.
2. Cache miss → `urlResolver.resolve(url)`:
   - `cf-context.fetchPage(url)` returns rendered HTML.
   - Regex against rendered HTML extracts `tmtId`, `tournamentCode`, `slug`, `name`, and date range from the embedded Vue config (the literals in the `var app = new Vue(...)` block).
   - Writes entry to sidecar; returns record.
3. If `@bwf` URL is not yet resolved when `/api/tournaments` is called, **fire-and-forget the resolution and skip the entry this request**. The next request sees it. This avoids blocking the tournament list on first hit.

### Steady-state request flow (example: `GET /api/draws/[id]`)

```
[route handler]
  ↓ TournamentInfo says provider = 'bwf'
[lib/draws-cache.ts]
  ↓ cache miss
[lib/providers/resolve.ts → providerFor(ref) → bwfProvider]
  ↓
[BwfProvider.getDraws(ref)]
  ↓ lookup ref.id (GUID) in sidecar map → tmtId
[bwf/api-client.ts]
  ↓ POST /api/vue-tournament-draws { tmtId, tmtType: 0 }
[bwf/cf-context.request()]
  ↓
[bwf/parsers.ts]  BWF JSON → DrawInfo[]
  ↓
[draws-cache.ts]  writes cache, returns
```

For BAT IDs, the same `draws-cache.ts` falls through to its existing code path — byte-identical to today.

### Provider tag propagation

`TournamentInfo` gets one optional field:

```ts
interface TournamentInfo {
  id: string
  name: string
  provider?: ProviderTag      // ← new, optional; absent means 'bat'
  // ...existing fields untouched
}
```

The frontend reads `provider` from the `/api/tournaments` response and can branch on it for tiny UI differences (country flag vs Thai club logo). The bulk of the UI is provider-agnostic and unchanged.

### tournaments.txt parser change

`app/api/tournaments/route.ts:21-54` — additive only.

New branch matching:

```
^@bwf\s+(https?://\S+)(\s+\[done\])?\s*$
```

Behavior:
- Look up URL in sidecar.
- Found → emit `TournamentInfo { id: tournamentCode, name, provider: 'bwf', done?: true }`.
- Not found → fire-and-forget `urlResolver.resolve(url)`, skip entry this request.

Existing branches (GUID lines, `# deny`, comments) are **byte-identical** to current code. A snapshot test verifies the parser's output for a mixed file matches the current implementation for every BAT-shaped line.

## Error Handling

### Failure matrix

| Source | Action | User-visible effect |
|---|---|---|
| Chromium launch fails | Set `bwfDisabled = true`; log once at startup. BAT routes unaffected. | BWF tournaments hidden until restart |
| `prime()` exception | Degraded with 60s backoff; first request after backoff retries. Cached BWF data still serves. | Live data 503s briefly; cache works |
| 401 from API | Reload any BWF tournament page in the existing context, re-extract token from the rendered HTML, retry the original call once | Transparent |
| 403 from API | Tear down context, `prime()`, retry once | Transparent (~3-5s added latency) |
| 5xx / network timeout | No retry; cache module serves stale if available, else null/empty | Stale data or "no data" message |
| Parser schema mismatch | Try/catch per draw/match in `parsers.ts`; log offending payload, drop item, return partial result | Some matches missing |
| Sidecar JSON corrupt | Log, treat as empty in-memory; resolution kicks in lazily | Self-heals on next request |
| URL resolver fails | Log offending URL, skip that `@bwf` line | One tournament missing from list |

### Logging convention

Matches the existing `[bat-fetch]` pattern in `lib/bat-fetch.ts`:

- `[bwf-cf]` — CF context lifecycle (prime success/fail, refresh, 403 recovery)
- `[bwf-fetch]` — API calls: `kind=draws tmtId=5726 status=200 ms=87`
- `[bwf-parser]` — schema mismatches (always include the offending JSON path)
- `[bwf-resolve]` — URL resolution events

### Cached-fallback is free

Because BWF reuses existing cache modules, BWF API outages cause cache miss → null upstream → the cache module serves the last known good data from disk. No new code needed — same behavior BAT gets when `tournamentsoftware.com` flakes.

### Concurrency

- `primePromise` mutex around `prime()`.
- 401/403 recovery is debounced — at most one re-prime in flight at a time.
- API calls are issued concurrently against the shared context (Playwright `context.request` is safe for our usage).

### Non-goals

- No automatic alerts/notifications on BWF failure (logs only).
- No fallback mirror / VPN / proxy.
- No request queueing during degraded state — fail fast, cache serves stale.

## Testing

### Unit tests (Jest, no network)

- `parsers.test.ts` — canned BWF JSON fixtures → assert mapped types. One fixture per endpoint: detail, draws-list, draw-data, day-matches, podium.
- `url-resolver.test.ts` — captured BWF HTML → assert extracted `tmtId`/`tournamentCode`/`slug`/`name`/dates.
- `sidecar.test.ts` — read/write, in-memory cache invalidation, corrupt-file handling.
- `tournaments-txt-parser.test.ts` — **critical for BAT isolation.** Feeds a mixed file (BAT GUIDs, comments, `# deny` lines, and `@bwf` lines) and asserts: (a) the `manualEntries` array produced for every non-`@bwf` line matches a committed snapshot of the pre-change parser's output, and (b) `denySet` is identical. New assertions are added for `@bwf` lines without disturbing the existing ones.
- `resolve.test.ts` — dispatch helper.
- `bracket-html.test.ts` — snapshot the constructed bracket HTML for a fixture (catches accidental output changes since we chose option #1: parser constructs HTML).

### Integration test (Jest, opt-in)

`bwf-live.test.ts`, skipped unless `RUN_BWF_LIVE=1`:
- Real Chromium, primes CF context, hits each endpoint against tournament 5726, asserts response shape.
- Catches BWF schema drift early. Run locally before each release.

### No e2e UI tests for BWF

The app has no e2e tests today; adding them just for BWF would be inconsistent.

### Manual smoke-test checklist (post-deploy)

1. Add `@bwf <url>` to tournaments.txt, restart server, confirm tournament appears within ~10s.
2. Click into tournament, see draws populated.
3. Click into a draw, see bracket rendered in style identical to a BAT bracket.
4. Click match schedule, see correct date tabs and match cards.
5. Wait 30 min, confirm CF refresh logs cleanly (no 403 retries needed).
6. Open an existing BAT tournament, confirm zero change.

### Fixture capture

`scripts/capture-bwf-fixtures.ts` (one-off, kept in repo): primes CF context, hits each endpoint for tournament 5726, writes responses to `__tests__/fixtures/bwf/<endpoint>.json`. Re-run when fixtures need refresh.

## Implementation Phasing

Each phase is independently shippable.

### Phase 1 — MVP (draws + schedule). ~3 days.

- `lib/providers/types.ts`, `resolve.ts`, `bat-provider.ts` (pass-through wrapper)
- `lib/providers/bwf/`: `cf-context.ts`, `api-client.ts`, `url-resolver.ts`, `parsers.ts` (four endpoints: detail, draws, draw-data, day-matches)
- `BwfProvider` implements: `getMeta`, `getDraws`, `getBracket` (HTML construction), `getMatchesFull`, `getDayMatches`. Others throw `NotImplementedError`.
- `app/api/tournaments/route.ts` parser extension + sidecar (`public/bwf-cache.json`)
- `instrumentation.ts` prime call
- Dispatch wiring in `draws-cache.ts`, `matches-full-cache.ts`, `bracket-cache.ts`, `day-cache.ts`, `app/api/tournaments/route.ts`
- Unit tests for parsers, URL resolver, tournaments.txt parser (BAT-isolation snapshot)
- **Done when:** `@bwf <url>` → tournament appears, draws render, schedule shows by date.

### Phase 2 — Live + player + H2H. ~2 days.

- API endpoints: `vue-tournament-live`, `draw/players`, player profile (API or scrape)
- `BwfProvider.getLiveScore`, `getPlayer`, `getH2H` (within-tournament only)
- Wire `lib/live-score.ts` + `lib/useLiveScore.ts` dispatch
- **Done when:** mid-tournament BWF match shows live scores; player profile renders within-tournament stats.

### Phase 3 — Stats + podium. ~1 day.

- `vue-tournament-podium` parser
- Wire `lib/tournamentStats.ts` to call provider for BWF
- **Done when:** stats dashboard works on a finished BWF tournament; podium shows.

### Phase 4 — Alerts + share-as-image. ~1 day.

- Verify `lib/alerts.ts` is already provider-agnostic (matches flow through `getMatchesFull`)
- `lib/shareMatchAsImage.ts` country-flag handling for BWF
- **Done when:** BWF matches trigger alerts; share-as-image looks right.

### Phase 5 — Polish. ~1 day.

- UI tweaks (country flags vs club logos)
- README + CLAUDE.md updates
- Fixture capture script run
- Optional: structured `BracketData` follow-up if HTML construction proves brittle

**Total: ~1 week of focused work.**

## Resolved Design Decisions

- **`BracketData` shape:** Keep current `{ html, format }`; `BwfProvider.getBracket` constructs equivalent HTML in `parsers.ts`. UI stays untouched. Structured tree is a deferred option (#2) for a future phase.
- **Player ID namespace:** BWF uses numeric, BAT uses GUID — they cannot collide. Cross-provider H2H is explicitly out of scope; H2H within BWF tournaments works, H2H within BAT tournaments works, but a player who appears in both providers will have two profiles with no cross-link.
- **Discovery:** BWF tournaments are NOT auto-discovered (BAT has a Thailand scanner via `discovery-runner.ts`; BWF stays manual via `@bwf` lines).
- **Country flags vs Thai club logos:** BWF gives `countryFlagUrl`; BAT path uses Thai club. Phase 4 adds a tiny conditional in share templates; tournament list / match cards may need similar minor branches.
- **Cache TTLs:** Same as BAT initially. Adjust later if BWF rate limits become an issue.
- **Token storage:** Re-extracted from page HTML on each `prime()`. Not persisted to disk.

## Non-Goals

- Team tournaments (`tmtType=1`: Thomas/Sudirman Cup) — explicitly out of scope. Only `tmtType=0` (individual events) supported.
- Cross-provider features (H2H spanning BAT+BWF, unified player profiles, merged stats).
- BWF tournament discovery / calendar scanning.
- Caching the bearer token to disk.
- Automatic alerts/notifications on BWF integration failures.

# Preload Stats Cache for Completed Tournaments

**Date:** 2026-06-03
**Status:** Approved
**Surface:** `/api/stats` for past tournaments. Server-side preload at boot + every 15-min tick.

## Summary

Every completed tournament should have its aggregated stats sitting on disk before any user opens the panel. Today the aggregation is lazy — the first visitor pays 1–3 seconds. After this change, a server-side preload writes the stats cache during boot and during the existing 15-min discovery tick.

## Motivation

Today's count on production:

- `.cache/full/` — **6** pinned tournaments (full match data captured)
- `.cache/stats/` — **4** stats envelopes

Two completed tournaments have no stats file. The first user to visit them pays the cost of: reading full data, fetching clubs, optionally fetching rosters, calling `aggregate(...)`, and writing the cache. Below the cache TTL their request is fine; above it (any forgotten-about old tournament) the cost is fresh.

We already have hooks at boot and every 15 min that handle the player-index rebuild (`instrumentation.ts:30, 82`). Add a sibling pass that handles the stats cache.

## Architecture

New module `lib/stats-generator.ts` exposes one function:

```ts
ensureStatsCachedForTournament(tournamentId: string, origin: string): Promise<'wrote' | 'fresh' | 'skip'>
```

- `'wrote'` — a new stats envelope was just written
- `'fresh'` — existing envelope is current against the full-cache bytes, nothing to do
- `'skip'` — preconditions not met (no pin, incomplete day coverage, or partial clubs map)

The function is the disk-only twin of the `/api/stats` route's hot path. It reuses the existing `aggregate`, `readDayCache`, `readFullCache`, `hashFullCacheBytes`, `writeStatsCache`, and `readStatsCache` primitives. It does not invent new caching semantics — same envelope shape, same gates.

Why a new module vs. extracting from the route? Two reasons:
1. The route's GET handler intermixes HTTP concerns (request parsing, response headers, `NextResponse`) with the aggregation pipeline. Pulling out a pure async function avoids importing Next.js types from `instrumentation.ts`.
2. The boot/tick caller doesn't need any of the `memCache` short-TTL bookkeeping that lives in the route — that's request-side hygiene, not preload concern.

## What `ensureStatsCachedForTournament` does

1. **Read full cache from disk.** If `.cache/full/<id>.json` is missing → return `'skip'` (tournament not pinned yet).
2. **Hash the full-cache bytes** → `sourceVersion = "full:<sha256>"`.
3. **Check existing envelope.** If `readStatsCache(id)` returns a valid v10 envelope with the same `sourceVersion` → return `'fresh'`.
4. **Build `dayMap` from disk only.** For each `dateIso` in `fullData.days`, read the day cache. If any day is missing → `coverageComplete = false`. **Skip** writing in that case (`return 'skip'`) — matches today's route behavior on partial coverage.
5. **Fetch clubs** via internal HTTP to `${origin}/api/clubs?tournament=...&with=names`. This is exactly the same call the route makes; `/api/clubs` itself reads from disk for pinned tournaments, so the round-trip is cheap.
6. **Aggregate.** `rosterByDraw` is `undefined` for pinned tournaments (matches the route's `isAllPast ? null : fetchRosterByDraw(...)` branch).
7. **Apply the clubs-coverage guard** (`clubsCount / players >= 0.5`). If failed → return `'skip'`.
8. **Write the envelope.** `writeStatsCache(id, { sourceVersion, coverageComplete: true, stats: full })`.

## Two callers in `instrumentation.ts`

### Boot backfill

Inside the existing boot IIFE, after the `rebuildAll` call (around `instrumentation.ts:30`):

```ts
try {
  const { ensureStatsCachedForTournament } = await import('./lib/stats-generator')
  const fullDir = path.join(process.cwd(), '.cache', 'full')
  const files = await fs.promises.readdir(fullDir).catch(() => [])
  const ids = files
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, '').toUpperCase())
  let wrote = 0, fresh = 0, skip = 0
  for (const id of ids) {
    const res = await ensureStatsCachedForTournament(id, origin)
    if (res === 'wrote') wrote++
    else if (res === 'fresh') fresh++
    else skip++
  }
  console.log(`[stats-cache] boot preload: wrote=${wrote} fresh=${fresh} skip=${skip} total=${ids.length}`)
} catch (err) {
  console.warn('[stats-cache] boot preload failed:', err)
}
```

Single try/catch so a generation error never blocks the rest of the boot. Sequential iteration (not `Promise.all`) — small list, no concurrency benefit, and serial keeps the I/O storm low.

### Tick backfill

Inside `tick()`, immediately after the `rebuildAll(...)` call (around `instrumentation.ts:82`):

```ts
if (newlyPinned.length > 0) {
  const { ensureStatsCachedForTournament } = await import('./lib/stats-generator')
  for (const id of newlyPinned) {
    const res = await ensureStatsCachedForTournament(id.toUpperCase(), origin)
    console.log(`[stats-cache] tick newlyPinned id=${id} status=${res}`)
  }
}
```

Only acts on newly-pinned tournaments — no rescan of the full directory, since boot already covered the steady state. Each `newlyPinned` id is `'wrote'` on first call and `'fresh'` on subsequent calls (defensive — should not happen since `newlyPinned` is one-shot per tournament).

## What does NOT change

- `app/api/stats/route.ts` — same lazy aggregation logic and same `memCache` TTL behavior. Acts as a safety net for any race window between pin and the next preload tick.
- `lib/stats-cache.ts` envelope shape, version, or guards. The version is still 10; the preload writes the same envelope the route writes.
- The 15-min tick cadence or any other timer.

## Tests

New unit test file `__tests__/stats-generator.test.ts`:

1. **Skip when no full cache** — call against an unknown tournament id, expect `'skip'`, expect no file created at `.cache/stats/<id>.json`.
2. **Wrote when full cache exists, day caches complete** — set up a temp `.cache` dir with a fixture full file + matching day caches + a clubs API stub. Expect `'wrote'`. Expect file at the stats path. Expect file content has `version: 10`, `coverageComplete: true`, and the `sourceVersion` matches `full:<sha256>`.
3. **Fresh on second call** — repeat the wrote scenario, call again, expect `'fresh'`, expect `mtime` unchanged.
4. **Skip when day coverage incomplete** — fixture with one day cache file missing. Expect `'skip'`, no file.

Each test uses a per-test temp dir (`tmpdir/...`) via the existing pattern in `__tests__/day-cache-*.test.ts` or `__tests__/bracket-cache.test.ts`. The clubs API is stubbed by mocking `global.fetch` (matching the pattern in `__tests__/api-players-rebuild-route.test.ts`).

No `instrumentation.ts` tests — project convention is to keep that file untested glue.

## Deployment

Standard. First deploy after this lands will fire the boot backfill on PM2 reload, which should bring the two missing stats caches (`6E65C36E`, `A2812D92`) onto disk within seconds, then settle into the steady-state pattern at the next 15-min tick. Verifiable by re-running:

```bash
ssh root@ezebat.lan 'ls /root/app/.cache/full/ /root/app/.cache/stats/ | sort'
```

— both directories should list the same UUIDs after one boot cycle.

## Out of scope

- Pre-warming stats for *active* tournaments. Mid-tournament data churns on every match completion; pre-aggregating it would waste work. Lazy is correct there.
- Backfilling envelopes from version 9 → 10. The version bump in `stats-cache.ts:33` already invalidates older envelopes (read returns null → next call regenerates). That continues to work.
- Removing the route's lazy path. Cheap safety net; keep it.

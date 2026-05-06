# Auto-add Tournament — Design

A periodic in-process job that watches the BAT upcoming-tournaments page and auto-promotes any tournament with a published bracket into the dropdown, without manual `tournaments.txt` edits.

## Background

`public/tournaments.txt` is hand-curated and committed to git. Every new tournament currently requires an admin to ssh in, edit the file, redeploy, and remove the `[done]` flag once it ends. Auto-done detection (shipped 2026-05-07) eliminated half of that workflow; this spec eliminates the other half.

The BAT site exposes `/Home/DoTournamentSearch?Page=1&SelectedTab=Upcoming` listing every accepting / upcoming tournament. Each row carries:
- a tournament name and GUID,
- an "Online Entry" badge for tournaments still accepting registrations.

Tournaments showing "Online Entry" never have a bracket published yet, so we filter them out. For each remaining candidate that isn't already promoted (`hasBracket: false`), we directly probe the draws page each cycle. When at least one draw has seeded (non-TBD) players, we flip `hasBracket: true` and stop probing it.

(An earlier draft of this spec proposed gating the draws probe on a "Last Changed" timestamp from the upcoming list. Investigation during implementation showed that field doesn't exist on the upcoming list — it's only on per-tournament detail pages — and adding a detail-page fetch to read it was net-equal in cost to just probing the draws page directly. We dropped the optimization.)

## Goals

- New tournaments with published brackets appear in the dropdown automatically, within ~15 minutes of publication.
- Manual entries in `tournaments.txt` continue to work unchanged.
- A `# deny <GUID>` comment in `tournaments.txt` permanently excludes a tournament from both the manual and auto-discovered sources.
- Existing auto-done logic continues to function for both manual and auto-discovered entries.
- No new infra (cron, database, queue). Uses the existing `instrumentation.ts` background-task pattern.

## Non-Goals

- Discovering tournaments outside the BAT upcoming page (e.g. external feeds, Facebook posts).
- Approval queue UI. Auto-discovered tournaments appear immediately; admin overrides via `# deny` if needed.
- Tournament name editorialization (we trust the BAT-published name).
- Cross-cluster coordination beyond a single PM2 instance.

## Settings — recap of brainstorming Q&A

| Decision | Choice |
|---|---|
| Storage location | Separate writable JSON file at `.cache/discovered-tournaments.json`, merged with `tournaments.txt` at API time. |
| Polling cadence | 15 minutes during active hours. |
| Quiet window | Skip cycles between 00:00 and 08:00 Asia/Bangkok. The interval still ticks; the runner returns immediately during the quiet window with a single log line per skipped tick. Active window is 16 h/day → 64 cycles/day. |
| Where the cron runs | `setInterval` inside `instrumentation.ts`, leader-guarded by `NODE_APP_INSTANCE === '0'`. |
| Bracket gate criterion | At least one draw has seeded (non-TBD) players. |
| Probe strategy | Probe the draws page directly each cycle for any candidate where `hasBracket: false`. Skip already-promoted tournaments entirely. (The Last-Changed timestamp originally proposed as a gate isn't on the upcoming list — it's only on per-tournament detail pages, so the indirection saved nothing.) |
| Lifecycle / removal | Auto-cleanup if absent from upcoming AND `hasBracket: false`. Once `hasBracket: true`, never removed. Denylist via `# deny <GUID>` lines in `tournaments.txt`. |
| Notifications | Server log line + PostHog server-side event for every add/remove. |

## Architecture

### Components

| File | Role | Lines (target) |
|---|---|---|
| `lib/upcoming-scraper.ts` (new) | Pure parser. `parseUpcoming(html) → UpcomingEntry[]`. | < 60 |
| `lib/discovery-store.ts` (new) | Read/write `.cache/discovered-tournaments.json` with atomic tmp+rename. | < 80 |
| `lib/discovery-runner.ts` (new) | Orchestrator. `runDiscoveryCycle()` does the full per-tick logic. | < 150 |
| `lib/posthog-server.ts` (new) | Adapter around `posthog-node`. One helper: `captureServerEvent(event, properties)`. | < 50 |
| `lib/scraper.ts` (modified) | Add `bracketHasSeededPlayers(html) → boolean` for the bracket gate. Existing placeholder `parseTournaments()` is left untouched (different page, unused). | +20 |
| `instrumentation.ts` (modified) | Install `setInterval(runDiscoveryCycle, 15 * 60_000)` after the prewarm chain, guarded by leader check. | +15 |
| `app/api/tournaments/route.ts` (modified) | Replace inline parser with `mergeForApi()`. Parse `# deny <GUID>` lines and apply denylist. | +30 |
| `package.json` (modified) | Add `posthog-node` dep. | — |

### New fixtures

| Fixture | Used by |
|---|---|
| `fixtures/upcoming.html` | upcoming-scraper test |
| `fixtures/draws-seeded.html` | bracket-gate test (positive case) |
| `fixtures/draws-empty.html` | bracket-gate test (negative / TBD-only case) |

## Data Model

### `.cache/discovered-tournaments.json`

```json
{
  "version": 1,
  "entries": [
    {
      "id": "C0FFEE12-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
      "name": "Some Open 2026",
      "hasBracket": true,
      "discoveredAt": "2026-05-01T03:00:00Z",
      "lastSeenOnUpcomingAt": "2026-05-07T03:00:00Z"
    }
  ]
}
```

- `id`: Uppercase GUID. Same casing as `tournaments.txt` and `safeSegment` of `lib/day-cache.ts`.
- `hasBracket`: Monotonic latch. Once `true`, never flips back to `false`. Once set, the runner skips re-probing this entry every cycle.
- `discoveredAt`: First-seen timestamp. Forensic only.
- `lastSeenOnUpcomingAt`: Updated every cycle the GUID appears on the upcoming snapshot. Used by cleanup to distinguish "new" from "absent".
- `version: 1`: Wrapper for future migrations.

### `tournaments.txt` denylist additions

```
# deny <GUID>            optional free-text reason
```

The existing parser already skips `#`-prefixed lines. We additionally scan `#`-prefixed lines for `^# deny\s+([A-F0-9-]+)/i` and collect those GUIDs into a deny `Set`. Other `#` lines remain ordinary comments.

### Merge order in `/api/tournaments`

1. Parse `tournaments.txt` → `{ manualEntries, denySet }`.
2. Parse `.cache/discovered-tournaments.json` → `discoveredEntries`, filter to `hasBracket: true` only.
3. Union by `id` (uppercase). On conflict, manual wins.
4. Drop any `id ∈ denySet`.
5. Apply existing auto-done detection (`readFullCache` + `isAllPast`) per entry.
6. Return JSON.

## Data Flow — One Discovery Cycle

```
1. setInterval tick (15 min, worker 0 only)
   If Asia/Bangkok hour ∈ [0, 8) → log "[discovery] quiet window, skipping" and return.
   Skip if previous cycle still in flight (mutex flag).

2. GET https://bat.tournamentsoftware.com/Home/DoTournamentSearch?Page=1&SelectedTab=Upcoming
   parseUpcoming(html) → UpcomingEntry[]
   Filter: drop entries where hasOnlineEntry === true.

3. Load discovered-tournaments.json (or empty store on first run).

4. For each filtered upcoming entry:
   a. Find existing record by id.
   b. Update lastSeenOnUpcomingAt = now.
   c. If existing.hasBracket === true → continue (committed; skip probe).
   d. Otherwise (new entry OR existing with hasBracket=false) → run bracket gate.
   e. New record? Set discoveredAt = now.

5. Bracket gate (step 4d):
   GET /sport/draws.aspx?id=<guid>
   If 0 draws returned → "not yet"; record stays with hasBracket=false.
   Else: GET first draw's GetDrawContent. If bracketHasSeededPlayers(html) →
   promote: hasBracket = true.
   On any HTTP failure during this step → leave the record state unchanged;
   the next cycle retries.

6. Cleanup pass:
   For each entry in store NOT in this cycle's upcoming snapshot:
     If hasBracket === false → remove.
     Else (hasBracket === true) → keep untouched.

7. Diff old store vs new store:
   For each newly-promoted (hasBracket: false → true):
     console.log('[discovery] added <id> <name>')
     captureServerEvent('tournament_auto_added', { id, name })
   For each removed:
     console.log('[discovery] removed <id> <name>')
     captureServerEvent('tournament_auto_removed', { id, name })

8. Atomic write of new discovered-tournaments.json (tmp + rename).
```

### Key invariants

- **`hasBracket: true` is monotonic.** Means a published-then-removed bracket still appears (acceptable); a transient parse failure doesn't cause a tournament to vanish.
- **Cleanup never touches `hasBracket: true` records.** Auto-done logic transitions them when their match-days fall in the past.
- **Cycles are idempotent.** Re-running the same cycle with the same inputs produces the same store.
- **Single-flight per worker, leader-only across workers.** No concurrent BAT fetches from this loop.

## Error Handling

| Failure | Behavior |
|---|---|
| Upcoming-page fetch fails | Catch, warn, abort cycle. Store untouched. |
| `parseUpcoming` returns 0 entries when prior cycle had >0 | Skip cleanup pass this cycle (defensive against parse regressions). |
| `draws.aspx` fetch fails for one tournament | Per-tournament catch; skip gate this cycle; `lastChanged` not updated, so next cycle retries. |
| `GetDrawContent` fetch fails | Same per-tournament catch. |
| `bracketHasSeededPlayers` throws | Treated as `false`. |
| Discovery store read fails | Start with empty store, don't crash. |
| Atomic write fails | Log warn, leave previous file intact. |
| PostHog send fails | Swallow with `.catch()`. Telemetry never breaks a cycle. |
| Cycle still running at next tick | Mutex skips the new tick with a log line. |
| Catastrophic exception | Top-level try/catch in the `setInterval` callback. |

The leader-only guard prevents multiple PM2 workers; the mutex prevents two cycles overlapping in the same worker. No filesystem-level lock needed.

## Testing

### Unit (fixture-based, no network)

| Test file | Coverage |
|---|---|
| `__tests__/upcoming-scraper.test.ts` | `parseUpcoming(fixtures/upcoming.html)` → expected entries. Online-Entry rows have `hasOnlineEntry: true`. Empty/malformed page returns `[]` without throwing. |
| `__tests__/scraper.bracket-gate.test.ts` | `bracketHasSeededPlayers(fixtures/draws-seeded.html) === true`; `bracketHasSeededPlayers(fixtures/draws-empty.html) === false`. |
| `__tests__/discovery-store.test.ts` | Round-trip write/read. Missing file → empty store. Atomic write leaves no `.tmp` files. |

### Behavior (mocked I/O)

`__tests__/discovery-runner.test.ts` mocks `batFetch`, the parsers, and the store, asserting each scenario:

1. First run, store empty, one upcoming with seeded bracket → entry written with `hasBracket: true`, log emitted, telemetry called.
2. Online Entry filter → row is ignored.
3. `lastChanged` unchanged → no draws fetch; only `lastSeenOnUpcomingAt` updated.
4. `lastChanged` moved, no draws yet → `lastChanged` updated, `hasBracket` stays false, no telemetry.
5. `lastChanged` moved, draws exist but unseeded → same as #4.
6. `lastChanged` moved, draws + seeded → `hasBracket: false → true`, log + telemetry fire.
7. Already-promoted → no draws fetch; `lastSeenOnUpcomingAt` updated.
8. Cleanup, absent + `hasBracket: false` → entry removed, log + telemetry fire.
9. Cleanup, absent + `hasBracket: true` → entry retained.
10. Suspicious empty snapshot → cleanup skipped, store unchanged, warn logged.
11. Mutex → second invocation while first in flight returns immediately.

### Integration (post-deploy smoke)

Not automated. After first deploy:
- `tail -f /root/.pm2/logs/bat-bracket-out-*.log | grep '\[discovery\]'` to watch the first few cycles.
- Inspect `.cache/discovered-tournaments.json` for shape + content.
- Confirm `/api/tournaments` doesn't surface false positives.

### Explicitly out of scope for tests

- Live BAT page selectors (validated by the saved fixture; if BAT changes its layout, the fixture-based test fails loudly — that's the intended signal to update selectors).
- End-to-end live HTTP integration tests.

## Implementation Notes

- `posthog-node` config: reuse `NEXT_PUBLIC_POSTHOG_KEY` env var; init the client lazily on first event; call `await client.shutdown()` on `process.on('beforeExit')` so buffered events flush. (Same project as the client-side SDK; events appear in the existing PostHog dashboard.)
- Selectors for `parseUpcoming` and `bracketHasSeededPlayers` are unknown at design time; they will be reverse-engineered from a captured fixture during implementation. Fixture capture itself is part of the implementation plan.
- "First-tick" delay: `setInterval` waits one full interval before firing. Implementation should call `runDiscoveryCycle()` once immediately (after a small delay so it doesn't compete with the prewarm chain), then start the interval.
- Network setup: the existing `dns.setDefaultResultOrder('ipv4first')` in `instrumentation.ts` already covers the upcoming-page fetch — no additional config needed.
- Quiet-window check uses the same `Intl.DateTimeFormat` / `Asia/Bangkok` pattern as `lib/today.ts`. A small helper `getBangkokHour() → 0–23` may live in `lib/today.ts` for symmetry with `getTodayIso()`.
- BAT hit budget. Per cycle: 1 upcoming-list fetch + (≤ 2 × |unpromoted candidates|) draws/draw-content fetches. With today's 3 non-Online-Entry candidates, all unpromoted, that's `1 + 6 = 7` hits/cycle worst case. As candidates promote (hasBracket=true), they're skipped → eventual steady state is 1 hit/cycle plus burst when new candidates appear. Active window is 64 cycles/day → **~64–448 hits/day total** depending on how many unpromoted candidates exist. Once everything is promoted, ~64/day floor.
- The runner stays scheduler-agnostic: `runDiscoveryCycle()` is a plain async function. The `setInterval` wrapper lives in `instrumentation.ts`. Ad-hoc invocation (e.g. for debugging) is just a one-liner script.

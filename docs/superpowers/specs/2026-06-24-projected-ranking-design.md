# Projected Ranking (beta) — Design Spec (BS U15 pilot)

**Date:** 2026-06-24
**Status:** Approved direction; ready for implementation plan.
**Builds on:** the shipped BAT points feature and the held-feature context in
`docs/projected-ranking-beta-context.md` (read that first for background).

---

## 1. Goal

On the Leaderboards **ranking** tab, add a **"Projected Ranking (beta)"**
checkbox that shows a projection of **next week's** BAT publication for a single
event board: it **adds** points from recent tournaments not yet in the official
ranking, **removes** points expiring out of the rolling 52-week window,
re-ranks, and shows up/down movement vs. the official ranks.

**Pilot scope (locked):** the mechanism is complete (add + expire), but the
pilot renders and backfills **only the BS U15 board** (`U15_MS`, 500 players).
Whole-board rollout is a later flag flip — out of scope for this spec.

---

## 2. Data model (verified against production)

Three caches feed the projection. All facts below were checked on `ezebat.lan`.

### 2.1 Official ranking — `.cache/players/ranking-bat.json`
Per-event arrays of opaque totals. `U15_MS` has **500 entries, all with
`globalPlayerId`**, `publishDate` `23/6/2569`. Each entry:
`{rank, points, slug, name, globalPlayerId, previousRank, tournaments, ...}` —
a total only, no breakdown.

### 2.2 Per-player detail — `.cache/players/ranking-detail/bat/<gid>.json`
Populated on demand (333 of 2,269 players cached as of 2026-06-23). Shape
(`RankingPlayerDetailCache` → `detail.tournaments: RankingPlayerTournament[]`).
Each row:
- `tournamentName`, `tournamentId` (**often `null`** — do not rely on it),
  `sourceEvent` (e.g. `"BS U15"`, `"BS U17"`), `week` (`"YYYY-WW"`, e.g.
  `"2026-19"`), `result` (`"17/32"`), `points`.
- `countsTowardRankings: string[]` — raw "used-for" markers.
- `countsTowardRankingsParsed?: RankingTargetCredit[]` —
  `[{eventName, credit}]`, the **per-board credit** this result contributes.

**Crucial — the cross-age crediting model (verified):** a result credits the
player's own age-group board **and all older boards**, with the same `credit`
value. A detail row stores **all** of a player's results (one sample: 30 rows
for a player whose official `tournaments` count is 14), so the rows ranked
11th+ are present and **can be promoted when a counting row expires**. This is
what makes the *expire* side achievable from cached data.

**Verification done:** for `gid 4200007`, summing the **top-10 credits toward
`"U15 Boys singles"`** reproduced the official `U15_MS` total of **31,336**
exactly. This is the canonical reconstruction the projection engine mirrors.

### 2.3 Our match index — `.cache/players/index-bat.json`
~9 tournaments, 2026-04-17 → 2026-06-19. Source for the **add** side via the
shipped points engine. (Auto-rebuilds when tournaments complete.)

---

## 3. The ranking rule (corrected)

A board's ranking is **top-10 credits toward that specific event, summed** —
**not** a per-discipline "highest-entry-counts" dedup (that rule is for the
profile points *display* and does **not** apply here). The only collapse that
applies is `dedupePerTournament` (same `(week, tournamentName)` → keep the
marked / higher-points / older-age row), which is already encoded in
`lib/ranking/player-view.ts`.

So, per player, for the target board `"U15 Boys singles"`:
1. Take detail rows whose `countsTowardRankingsParsed` has a credit entry for
   the target event (equivalently: that player's singles results eligible for
   this board), using that **credit** value.
2. `dedupePerTournament`.
3. Top-10 by credit, summed = the board total. (Validated; see §2.2.)

---

## 4. Projection engine — `lib/ranking/projection.ts` (pure, unit-tested)

Pure function. Inputs: one player's detail rows, that player's recent index
results (pre-pointed), the current `publishDate`, and the target event name.
Output: `{ projectedTotal, projectedRows, addedRows, expiredRows }`. No I/O,
no fetches.

Algorithm, per player, for `"U15 Boys singles"`:

1. **Base rows.** From detail, keep rows with a credit toward the target event;
   value = that credit. (Detail rows already carry the cross-tier credit, so use
   the stored `credit`, which may legitimately differ from raw `points` for
   cross-tier cases.)
2. **Expire.** Drop rows whose `week` falls outside the **next-publish** window,
   using `expiringNextWeekCutoff(publishDate, 'thai-be')` +
   `isExpiringNextWeek` from `player-view.ts` (the `53 - weeksOut` cutoff,
   `weeksOut = 1`).
3. **Add.** From the index, take this player's un-counted target-eligible
   results, point each via the shipped engine (`pointsRoundFromResult` +
   `pointsFor` at the result's **source-event age group** — verified: credit =
   points computed at the source event, credited to all eligible boards), and
   include the resulting credit.
   - **Dedup against detail (add-side):** a result is "already counted" — and
     therefore skipped — if a detail row matches on **`(weekSortKey(week),
     sourceEvent, trimmed tournamentName)`**. `tournamentId` is unusable
     (null), so it is **not** part of the key.
4. **Merge + dedup.** Concatenate base (post-expire) + added; run
   `dedupePerTournament`.
5. **Top-10 by credit, sum** → projected board total.

Reuse from `player-view.ts`: `weekSortKey`, `dedupePerTournament`,
`expiringNextWeekCutoff`, `isExpiringNextWeek`, `TOP_N`. Do **not** reuse
`topRowsForTab` — it selects by discipline+`points`, whereas the projection
selects by per-event `credit`.

Board assembly: run the per-player projection across the existing 500 entries,
re-sort by projected total → projected rank, compute Δ vs official rank.

**New entrants (locked):** the pilot projects **only the existing 500** ranked
players. A player who appears only in the index (never officially ranked) is
**not** added to the projected board. Rationale: the backfill set and the
"500/500 ready" gate are keyed to the official 500; admitting new entrants is a
whole-board-rollout concern.

---

## 5. Detail backfill job — `lib/ranking/detail-backfill.ts`

Orchestrator that gap-fills missing/stale details for a given id list.

- **Input:** `globalPlayerId[]` + current `publishDate`.
- **Per player:** if detail is missing or stale for `publishDate`, call the
  existing `fetchAndCache` from `app/api/players/ranking-detail/route.ts`
  (**exactly 1 upstream request/player**, since every id is known).
- **Pacing:** serial (concurrency 1), ~1 request / 2 s with ±0.5 s jitter
  (~17 min for 500). Backoff + circuit-breaker on 429/5xx/timeouts.
- **Single-flight:** a simple in-process lock (pilot is manually triggered; no
  cross-process lease needed yet).
- **Resumable / gap-fill:** the per-publication disk cache is the ledger; a
  re-run only fetches what's missing/stale. Skip players already fresh for the
  current `publishDate`.
- **Returns:** `{ total, have, fetched, failed: gid[] }`. Per-player failures
  are collected, not fatal.

**Cost (verified for `U15_MS`):** 500 unique players, all with `globalPlayerId`
→ **~430–500 one-time fetches** (500 minus whatever slice of the already-cached
333 fall in this board) and **~500 per weekly publication** to reset the
baseline.

---

## 6. Trigger — manual admin route (locked)

`app/api/ranking/backfill-u15/route.ts`, token-gated
(`PLAYERS_REBUILD_TOKEN`-style):
- Reads `U15_MS` entries from `ranking-bat.json`, hands their 500 ids +
  `publishDate` to the backfill job.
- Idempotent: re-running fetches only the gaps.
- Returns `{ ready: have === total, have, total, fetched, failed }`.
- Thin `scripts/backfill-u15.ts` wrapper for CLI use.

**No scheduler/lease wiring in the pilot.** Building the backfill job as a
standalone unit keeps the later `publishDateChanged` hook a small change.

---

## 7. API projected mode — extend `/api/leaderboards`

For `event=U15_MS` + `projected=1`:
1. **Readiness gate:** confirm all 500 `U15_MS` players have detail fresh for
   the current `publishDate`. If not → `{ ready: false, have, total }` (no
   projection computed).
2. If ready → run the projection engine across the 500, return both official
   and projected entries: `{ ready: true, publishDate, entries: [{ slug, name,
   officialRank, officialPoints, projectedRank, projectedPoints, delta }] }`.

All-or-nothing per board — never a half-projected payload.

---

## 8. UI — `components/LeaderboardsView.tsx`

- **Checkbox** "Projected Ranking (beta)" next to the "Published x (week)"
  label, **rendered only for the `U15_MS` board** during the pilot.
- **Disabled until ready:** while `ready: false`, the checkbox is disabled with
  `backfill in progress (N/500)`. Enabled once 500/500.
- **Dual side-by-side render** when checked (chosen layout):

  ```
  BS U15            Official | Projected
   Player          Rank Pts  | Rank Pts   Δ
   ปาณชัย บ.         1   146k |  1  146k   —
   ณณฐ ต.            4   113k |  2  120k   ▲2
   ปริญญา พ.         3   118k |  3  118k   ▼1
  ```

  Official `rank/pts` retained; projected `rank/pts` + Δ arrow added. Audit-
  friendly so divergence from official is visible (a guard against a wrong
  reconstruction).
- **Beta tooltip caveats:** (a) tournaments BAT counts but we haven't ingested;
  (b) cross-tier crediting nuances; (c) **post-publish convergence** — right
  after a Tuesday publish the projection ≈ official (nothing has expired yet,
  few un-counted events), diverging as the week progresses; (d) after each
  publish the 24h detail TTL makes all 500 stale, so the checkbox is dark for
  the ~17 min re-backfill (relevant once the weekly hook lands; for the manual
  pilot, the operator re-runs the route).
- **BAT only** (BWF never shows this).

---

## 9. Error handling

- **Backfill:** per-player failures collected (`failed[]`), run continues;
  circuit-breaker pauses on sustained upstream errors; resumable on restart.
- **API:** missing/stale details → `ready: false`; UI keeps the checkbox
  disabled. Never emit a partial projection.
- **Engine:** pure, total functions. A player with no eligible index results
  simply keeps their base rows (minus expiry). A row lacking a parsed credit
  for the target event is skipped (it credits other boards only).

---

## 10. Testing

- **Engine (heaviest):** add-only, expire-only, add+expire, top-10 re-pick with
  promotion of an 11th row when a counting row expires, `dedupePerTournament`
  collapse, add-side dedup by `(week, sourceEvent, tournamentName)`, cross-tier
  credit ≠ points, the §2.2 reconstruction (top-10 credits → 31,336) as a
  golden test against a captured `gid 4200007` fixture.
- **Backfill job:** mocked fetcher — gap-fill, resume, failure collection,
  single-flight, pacing/backoff invoked.
- **API:** contract test for the `ready: false` gate (one missing detail →
  no projection) and the ready payload shape.

---

## 11. Out of scope (later rollout)

Whole-board (all 35 events / 2,269 players) projection; scheduler/lease-driven
auto-backfill hooked to `publishDateChanged` + the 24h `DETAIL_REVISION_TTL_MS`;
new-entrant admission; weekly off-peak throttle tuning.

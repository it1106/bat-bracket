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
pilot renders and backfills only the **top 50 players (by official rank) of the
BS U15 board** (`U15_MS`). Widening to the full 500, then to all boards, is a
later flag flip — out of scope for this spec.

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

## 3. The ranking rule (two rules, both verified)

A board's ranking is **the sum of a player's top-10 credits toward that
specific event** — after collapsing same-tournament duplicates. Two collapse
rules apply; the broader "highest-entry-counts per discipline" rule from the
profile points *display* (e.g. keep BS U15 over BS U13 across the whole
history) does **not** apply to an event ranking.

**Rule 1 — same tournament, same discipline, different age group → keep only
the highest-points entry.** If a player enters one tournament in two singles
draws (e.g. plays up: BS U15 *and* BS U17), only the higher-points result
counts toward the board; the other is dropped. This is `dedupePerTournament`
(`lib/ranking/player-view.ts`), keyed on `(weekSortKey(week),
trimmed tournamentName)` within a single discipline, keeping the
marked / higher-points entry (the equal-points tiebreak direction is immaterial
to the total).

*Verified on prod:* across the 333 cached details there are **597**
same-tournament/same-discipline cross-age singles pairs, and in every one
**exactly the higher-points row is marked as counting** (e.g. gid 2458856,
นครสวรรค์ 2025: BS U17 8192 counts, BS U19 5243 dropped).

**Rule 2 — top-10 by credit, with promotion on expiry.** Only the best 10
(post-Rule-1) credits sum to the total. When a counting result expires out of
the window, the **next-highest remaining** result is promoted into the top-10
(this is why the detail's 11th+ rows must be retained — see §2.2).

So, per player, for the target board `"U15 Boys singles"`:
1. Take **every boys-singles detail row**, value = the row's own `points`. (The
   `countsTowardRankingsParsed` array lists only *currently-counting* rows, so it
   can't be the filter — see §4 step 1.)
2. Apply Rule 1 (`dedupePerTournament`).
3. Sum the top-10 by points = the board total. (Validated → 31,336; and 7/8
   sampled >10-result players reproduce exactly; see §2.2.)

---

## 4. Projection engine — `lib/ranking/projection.ts` (pure, unit-tested)

Pure function. Inputs: one player's detail rows, that player's recent index
results (pre-pointed), the current `publishDate`, and the target event name.
Output: `{ projectedTotal, projectedRows, addedRows, expiredRows }`. No I/O,
no fetches.

Algorithm, per player, for `"U15 Boys singles"`:

1. **Base rows.** From detail, keep **every boys-singles row**, value = the
   row's own `points`. Do **not** key on `countsTowardRankingsParsed` — that
   array is populated only for *currently-counting* rows (verified on prod), so
   keying on it would hide the 11th+ rows Rule 2 must promote on expiry, gutting
   the expire side. For the U15 pilot every cohort member is U15-eligible, so
   each of their singles results credits U15 at its own points. *Verified:*
   include-all-singles + top-10-by-points reproduces the official `U15_MS` total
   for 7/8 sampled >10-result players (one edge overcounts ~1k — acceptable for
   beta, visible in the dual UI).
2. **Expire (Rule 2 removal).** Drop rows whose `week` falls outside the
   **next-publish** window, using `expiringNextWeekCutoff(publishDate,
   'thai-be')` + `isExpiringNextWeek` from `player-view.ts` (the
   `53 - weeksOut` cutoff, `weeksOut = 1`). These rows leave the candidate set,
   freeing top-10 slots for promotion in step 5.
3. **Add.** From the index, take this player's un-counted target-eligible
   results, point each via the shipped engine (`pointsRoundFromResult` +
   `pointsFor` at the result's **source-event age group** — verified: credit =
   points computed at the source event, credited to all eligible boards), and
   include the resulting credit.
   - **Live / in-progress tournaments are included automatically.** The index
     already ingests active tournaments as `active: true` events with the
     **next-round-floor** points (the shipped "still-in-draw" feature: a player
     who wins their QF immediately floors at SF points), and the auto-rebuild
     tick (`instrumentation.ts`) re-runs whenever an active tournament has new
     resolved matches. So a player advancing mid-tournament is reflected in the
     projection **within ~15 min** (the discovery cadence; paused 00:00–08:00
     Bangkok) — not only after the tournament ends. No extra live-data path:
     the projection reads the on-disk index, which carries this already.
   - **Dedup against detail (add-side):** a result is "already counted" — and
     therefore skipped — if a detail row matches on **`(weekSortKey(week),
     sourceEvent, trimmed tournamentName)`**. `tournamentId` is unusable
     (null), so it is **not** part of the key. (Note: this is keyed on
     `sourceEvent` so a genuinely new played-up draw at an already-present
     tournament is *not* falsely skipped — Rule 1 then resolves it in step 4.)
4. **Merge + dedup (Rule 1).** Concatenate base (post-expire) + added; run
   `dedupePerTournament` so same-tournament/cross-age entries collapse to the
   single highest.
5. **Top-10 by credit, sum → projected board total (Rule 2 promotion).** With
   expired rows gone (step 2), any previously-11th result now within the best
   10 is automatically promoted by this re-pick.

Reuse from `player-view.ts`: `weekSortKey`, `dedupePerTournament`,
`expiringNextWeekCutoff`, `isExpiringNextWeek`, `TOP_N`. Do **not** reuse
`topRowsForTab` — it selects by discipline+`points`, whereas the projection
selects by per-event `credit`.

Board assembly: run the per-player projection across the **top 50 official
entries**, re-sort by projected total → projected rank, compute Δ vs official
rank (within those 50).

**Fixed cohort (locked):** the pilot projects **only the top-50-by-official-
rank cohort** and re-ranks them among themselves. Two consequences, both
accepted for the pilot and surfaced in the beta caveat:
- A player outside the top 50 (official rank ≥ 51) who would project into the
  top 50 **cannot** appear — we don't backfill or evaluate them. So Δ is
  "movement within the top 50," not absolute board position.
- A player who appears only in the index (never officially ranked) is likewise
  **not** added. Admitting outside/new players is a rollout concern.

---

## 5. Detail backfill job — `lib/ranking/detail-backfill.ts`

Orchestrator that gap-fills missing/stale details for a given id list.

- **Input:** `globalPlayerId[]` + current `publishDate`.
- **Per player:** if detail is missing or stale for `publishDate`, call the
  existing `fetchAndCache` from `app/api/players/ranking-detail/route.ts`
  (**exactly 1 upstream request/player**, since every id is known).
- **Pacing:** serial (concurrency 1), ~1 request / 2 s with ±0.5 s jitter
  (~2 min for 50; the pace scales unchanged if widened to 500 ≈ 17 min).
  Backoff + circuit-breaker on 429/5xx/timeouts.
- **Single-flight:** a simple in-process lock (pilot is manually triggered; no
  cross-process lease needed yet).
- **Resumable / gap-fill:** the per-publication disk cache is the ledger; a
  re-run only fetches what's missing/stale. Skip players already fresh for the
  current `publishDate`.
- **Returns:** `{ total, have, fetched, failed: gid[] }`. Per-player failures
  are collected, not fatal.

**Cost (pilot):** the top 50 `U15_MS` players, all with `globalPlayerId`
→ **≤ 50 one-time fetches** (fewer if some already cached) and **≤ 50 per
weekly publication** to reset the baseline (~2 min). The full `U15_MS` board
would be ~430–500; the whole board ~1,945 — both out of scope here.

---

## 6. Trigger — manual admin route (locked)

`app/api/ranking/backfill-u15/route.ts`, token-gated
(`PLAYERS_REBUILD_TOKEN`-style):
- Reads the **top 50** `U15_MS` entries (by `rank`) from `ranking-bat.json`,
  hands their ids + `publishDate` to the backfill job. (Cohort size is a single
  constant — bump it to widen the pilot.)
- Idempotent: re-running fetches only the gaps.
- Returns `{ ready: have === total, have, total, fetched, failed }`.
- Thin `scripts/backfill-u15.ts` wrapper for CLI use.

**No scheduler/lease wiring in the pilot.** Building the backfill job as a
standalone unit keeps the later `publishDateChanged` hook a small change.

---

## 7. API projected mode — dedicated route

> **Correction (2026-06-24):** the ranking tab is **not** served by
> `/api/leaderboards` (that route serves the precomputed leaderboards cache,
> which has no ranking-category boards). The ranking boards are built **SSR in
> `app/leaderboards/page.tsx`** from `ranking-bat.json` (`rankingEventToBoard`,
> board id `ranking-u15_ms`). So projection gets its **own route**, fetched by
> the client when the checkbox is toggled — `/api/leaderboards` is untouched.

**Readiness flag (SSR, cheap):** `page.tsx` runs a stat+freshness check on the
50 cohort detail files and passes `projectedReady = { ready, have, total }` to
the view, so the checkbox can render disabled (`N/50`) without any fetch.

**Projected route** `app/api/ranking/projected/route.ts`, `GET ?provider=bat`
(pilot is U15-only; the event is implicit):
1. **Readiness gate:** confirm all 50 cohort players have detail fresh for the
   current `publishDate`. If not → `{ ready: false, have, total }` (no
   projection computed).
2. If ready → run the projection across the 50, return both official and
   projected entries: `{ ready: true, publishDate, entries: [{ slug, name,
   officialRank, officialPoints, projectedRank, projectedPoints, delta }] }`.
   These 50 rows carry their own official+projected ranks, **independent of the
   30-cap official board** — the UI renders them directly in projected mode.

All-or-nothing per board — never a half-projected payload.

---

## 8. UI — `components/LeaderboardsView.tsx`

- **Checkbox** "Projected Ranking (beta)" next to the "Published x (week)"
  label, **rendered only for the `U15_MS` board** during the pilot. When checked
  the board is limited to the **top-50 cohort** (see §4).
- **Disabled until ready:** the SSR `projectedReady` flag (§7) renders the
  checkbox disabled with `backfill in progress (N/50)` until 50/50 — no fetch
  needed for the disabled state. Toggling on (when ready) fetches the projected
  route and swaps in the dual columns.
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
  publish the 24h detail TTL makes the cohort stale, so the checkbox is dark for
  the ~2 min re-backfill (relevant once the weekly hook lands; for the manual
  pilot, the operator re-runs the route); (e) **top-50 only** — Δ is movement
  within the pilot cohort, not absolute board position; (f) **live updates** —
  in-progress tournaments count at their next-round floor and refresh within
  ~15 min of a result, so the projection moves during play, not only after a
  tournament ends.
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

- **Engine (heaviest):** add-only, expire-only, add+expire; **Rule 1** —
  same-tournament/same-discipline cross-age collapse keeps the higher-points
  entry; **Rule 2** — expiring a counting row promotes the next-highest 11th row
  into the top-10; add-side dedup by `(week, sourceEvent, tournamentName)`
  (and that a genuinely new played-up draw at an already-present tournament is
  *not* skipped, then Rule 1 resolves it); cross-tier credit ≠ points; the §2.2
  reconstruction (top-10 credits → 31,336) as a golden test against a captured
  `gid 4200007` fixture.
- **Backfill job:** mocked fetcher — gap-fill, resume, failure collection,
  single-flight, pacing/backoff invoked.
- **API:** the cohort is exactly the top-50 by official rank; `ready: false`
  gate (one missing detail → no projection); ready payload shape.

---

## 11. Out of scope (later rollout)

Widening the U15 pilot from top-50 to the full 500; whole-board (all 35 events
/ 2,269 players) projection; scheduler/lease-driven auto-backfill hooked to
`publishDateChanged` + the 24h `DETAIL_REVISION_TTL_MS`; admitting players from
outside the cohort and brand-new entrants; weekly off-peak throttle tuning.

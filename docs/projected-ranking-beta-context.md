# Projected Ranking (beta) — Context & Handoff

**Status:** ON HOLD (paused by user 2026-06-23, before spec/design approval).
**Purpose of this doc:** capture everything needed to resume the feature without
re-deriving context. Also records the *shipped* BAT points feature it builds on.

---

## 1. Background: the shipped BAT points feature (LIVE)

The projected-ranking feature builds directly on a points system that is already
implemented, merged to `main`, and deployed to production (`ezebat.lan`).

**What it does**
- Every BAT tournament awards ranking points by **level (1–6) × age group
  (Open, U19…U9) × placement round**.
- Tournament **level** is parsed from each tournament's regulations page and
  shown as `(L2)` after the name in the tournament dropdown.
- A **Points reference tab** on the Leaderboards page (BAT provider only) shows
  all six level tables.
- **Player profiles** show projected locked-in points per event in the
  Tournament-History section (`≈X pts`, struck-through when superseded).

**Verified points rules (all encoded + unit-tested)**
- Formula (exact, 294/294 published cells):
  `round(40000 × 0.8^(level−1) × ageFactor(age) × 0.8^roundIndex)`.
  - ageFactor: Open=1, U19=0.625, then ×0.64 per step down (U17…U9).
  - roundIndex: Winner=0, Runner-Up=1, SF=2, QF=3, R16=4, R32=5, R64=6,
    R128=7, R256=8 (128/256-pax brackets extend the same formula).
- **Placement rule** (`pointsRoundFromResult`):
  - Champion → Winner row.
  - Won ≥1 match → actual exit round (`bestFinish`).
  - Won 0 matches → first-round loss, row from `drawSize` (the draw's opening
    round). A bye is never a win, so byeing in then losing = first-round-loss.
  - **First-round walkover-loss (no-show, `WO-L`, 0 wins) → 0 points.**
    Retirement (`RET-L`) or a played loss still earns the first-round row.
    Walkover-*received* (`WO-W`) counts as a win.
- **Per discipline, only the highest-points entry counts** toward ranking
  (e.g. BS U15 + BS U13 → keep the higher BS; BD counts separately). Ties break
  to the older age group.
- Doubles/mixed partners each get the **same full points** (shared inputs).
- BAT-only throughout (BWF profiles/tabs never show these points).

**Key files (shipped)**
- `lib/points/bat-points.ts` — pure engine: `pointsFor`, `levelTable`,
  `ageGroupFromEvent`, `pointsRoundFromResult`, `AGE_GROUPS`, `POINTS_ROUNDS`,
  `PUBLISHED_ROUNDS`, `ROUND_LABELS`.
- `lib/playerIndex.ts` — computes per-event `drawSize` and `lostByWalkover`;
  `ROUND_MAP`/`ROUND_SIZE`/`ROUND_ORDER` recognize R128/R256.
- `lib/types.ts` — `PlayerEventResult` gained `drawSize?`, `lostByWalkover?`;
  `bestFinish` union gained `R256`.
- `lib/tournament-meta.ts` — per-tournament sidecar (`.cache/meta/<GUID>.json`)
  carrying `startDateIso`, `level`, `levelChecked`; `patchMeta`.
- `lib/providers/bat-level-runtime.ts` — background regulations fetch →
  `level` (parses `Level N` / `ระดับ N`; regulations are an AJAX-only partial,
  needs `X-Requested-With: XMLHttpRequest`).
- `components/PointsTableReference.tsx` — the six-level reference tables.
- `components/LeaderboardsView.tsx` — BAT-only "Points" tab.
- `components/PlayerProfileView.tsx` — per-event projected points + supersede.
- `app/player/[provider]/[slug]/page.tsx` — SSR builds `tournamentLevels` map.
- `lib/player-index-rebuild.ts` — `SCHEMA_VERSION` (currently **13**; bump when
  `PlayerRecord`/`PlayerEventResult` shape changes so a deploy's boot rebuild
  actually re-runs instead of skipping).

**Specs/plans (committed)**
- `docs/superpowers/specs/2026-06-23-bat-points-tables-design.md`
- `docs/superpowers/plans/2026-06-23-bat-points-tables.md`

**Deploy notes**
- Host `ezebat.lan`, PM2 process `bat-bracket`, code at `/root/app`. See
  `DEPLOY.md`. One-liner:
  `git push && ssh root@ezebat.lan "set -e; cd ~/app && git pull --ff-only && npm run build && pm2 reload bat-bracket && pm2 list | grep bat-bracket"`
- The player index rebuilds on boot (`instrumentation.ts`) but **skips unless
  the source/schema version changed** — bump `SCHEMA_VERSION` when the record
  shape changes, or the new fields won't populate.
- Player-index rebuild route `/api/players/rebuild` needs `PLAYERS_REBUILD_TOKEN`
  (not set locally; rebuild normally happens via boot/auto-rebuild).

---

## 2. The held feature: Projected Ranking (beta)

### Goal (user's words, refined)
Add a checkbox next to the "Published x (week)" label on the Leaderboards
**ranking** tab, called **"Projected Ranking (beta)"**. When checked, show a
projection of **next week's** ranking publication:
- **Add** tournaments not yet accounted for (recent/completed events whose
  points aren't in the official ranking yet).
- **Remove** points from tournaments that **expire** out of the rolling window.
- Re-rank, with **up/down indicators relative to the last officially published
  ranks**.
- **BAT only.**

### How BAT ranking works (confirmed from code)
- An event ranking = a player's **best ~10 results (TOP_N=10)** in that
  **discipline/event**, summed over a **rolling 52-week window**.
- Expiry/age math lives in `lib/ranking/player-view.ts`
  (`expiringWithinWeeksCutoff`, `computeExpiryCutoffs`, `classifyExpiry`,
  `weekSortKey`, `dedupePerTournament`, `topRowsForTab`). The window cutoff uses
  `53 - weeksOut` publishing weeks.
- A player's per-tournament breakdown ("detail") is one row list
  (`RankingPlayerDetail.tournaments`: `{week, points, sourceEvent, result,
  countsTowardRankings[...]}`), fetched per `globalPlayerId` per publication.

### Data reality (the crux — checked on the production server)
- Official ranking (`.cache/players/ranking-bat.json`): **35 events, 12,798
  entries, 2,269 unique players**, publishDate `23/6/2569`. Each entry is just
  `{rank, points, slug, globalPlayerId, previousRank, ...}` — an **opaque
  total**, no breakdown. **Every entry already has `globalPlayerId`.**
- Per-player detail cache (`.cache/players/ranking-detail/bat/`): only **324**
  players (~2.5%) — populated **on demand** when a profile is viewed.
- Our own match index (`.cache/players/index-bat.json`): only **9 tournaments,
  2026-04-17 → 2026-06-19 (~2 months)**, 3,602 players. **Far short of 52
  weeks.**

**Consequence:**
- **"Add un-counted tournaments"** → feasible for everyone, from our **player
  index + points engine** (no extra BAT fetches; the index already auto-rebuilds
  when tournaments complete).
- **"Expire old points"** → needs each player's **year-long official
  breakdown**, which we have for only 324/2,269. Index reconstruction can't
  substitute (only ~2 months of history). So **exact expiry at whole-board scale
  requires a per-player detail backfill.**

### Chosen direction (analysis done; NOT yet approved/locked)
Backfill all BAT player details so the full **add + expire** whole-board
projection is possible.

**Fetch cost (verified):** `fetchAndCache` in
`app/api/players/ranking-detail/route.ts` does **exactly 1 upstream request per
player** when `globalPlayerId` is known — and all 12,798 entries already have it,
so **no 3-hop discovery** is needed.
- **One-time catch-up: ~1,945 fetches** (2,269 unique − 324 cached).
- **Ongoing: ~2,269 per weekly publication** to reset the official baseline.

**Cadence (important nuance):**
- A **new tournament mid-week costs 0 detail fetches** — the "add" side comes
  from our index. New tournaments are un-counted *by definition* until the next
  publication.
- A **new weekly publication** is the only thing that invalidates details
  (old points officially expire, recent ones get absorbed, ranks shift). Hook
  the backfill to the scheduler's existing `publishDateChanged`
  (`lib/ranking/scheduler.ts`, BAT Tuesday window) + the 24h revision TTL
  (`DETAIL_REVISION_TTL_MS` in `lib/ranking/player-cache.ts`).

| Event | Detail backfill? | Fetches |
|---|---|---|
| Now (catch-up) | one-time | ~1,945 |
| New tournament mid-week | no | 0 (index handles "add") |
| New weekly publication | yes | ~2,269 |
| In-place edition revision | opportunistic (24h TTL) | partial |

**Polite backfill strategy (to avoid looking like a scrape):**
- Serial (concurrency 1), ~1 request / 2 s with ±0.5 s jitter (catch-up ≈ 1h);
  weekly refresh slower (1 per 3–5 s) over a multi-hour off-peak (early-morning
  Bangkok) window.
- **Gap-fill only:** skip players whose detail is fresh for the current
  `publishDate`; on-demand profile views already populate the cache, shrinking
  the batch.
- **Single-flight:** only the lease-holding worker runs it (lease/heartbeat
  already in `instrumentation.ts`).
- **Backoff + circuit-breaker** on 429/5xx/timeouts; `batFetch` handshake
  timeout already prevents pile-ups.
- **Resumable:** the per-publication disk cache is the progress ledger; an
  interrupted run resumes by re-scanning for missing/stale.
- Context: the app already pre-warms every tournament bracket on boot and pulls
  ~1.3 MB match payloads, so a paced trickle of small ranking-page GETs is
  lighter than normal operation.

### Projection math (once details are available)
Per player, per discipline/event:
1. Start from official detail rows.
2. **Drop** rows expiring next week (`expiringNextWeekCutoff` / shift window +1).
3. **Add** the player's results from our recent (un-counted) tournaments,
   pointed via the engine (`pointsRoundFromResult` + `pointsFor`), respecting
   the per-discipline "highest entry counts" rule.
4. Re-pick **top-10**, sum → projected event total.
5. Re-sort entries → projected rank; compute **up/down vs. official
   `previousRank`/current rank**.

### Open decisions when resuming
- Final go/no-go on the backfill-powered full projection (vs. add-only, vs.
  on-demand-only). User was leaning toward the accurate full version but had not
  locked it.
- Throttle aggressiveness for the weekly refresh (accept partial staleness right
  after a publication?).
- UI: exact placement/label of the checkbox; how to render arrows in projected
  mode; how to show "this board is still backfilling / partially projected".
- Accuracy caveats to surface in the beta label (e.g. tournaments BAT counts but
  we haven't ingested; cross-tier crediting nuances).

### Next steps when resuming
1. Lock the direction (AskUserQuestion in the held conversation).
2. `superpowers:brainstorming` → finish design sections → write spec to
   `docs/superpowers/specs/YYYY-MM-DD-projected-ranking-design.md`.
3. `superpowers:writing-plans` → implementation plan.
4. Likely task breakdown: (a) detail backfill job (paced/single-flight/resumable,
   scheduler-hooked); (b) projection engine (pure, reuses points engine +
   player-view expiry helpers); (c) `/api/leaderboards` projected mode; (d)
   LeaderboardsView checkbox + arrows; (e) tests throughout.

### Relevant existing files to reuse
- `lib/ranking/player-view.ts` — expiry cutoffs, top-N, dedupe, discipline class.
- `lib/ranking/player-cache.ts` — detail cache (per provider/globalPlayerId).
- `lib/ranking/cache.ts` — `ranking-<provider>.json` (entries with previousRank).
- `lib/ranking/scheduler.ts` — `publishDateChanged`, `shouldRefresh`.
- `app/api/players/ranking-detail/route.ts` — `fetchAndCache` (1 fetch/player).
- `lib/points/bat-points.ts` — points engine (the "add" side).
- `lib/playerIndex.ts` / `index-bat.json` — everyone's recent results.
- `instrumentation.ts` — boot/auto-rebuild, lease/heartbeat, schedulers.

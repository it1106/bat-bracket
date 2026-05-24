# Deep Player Stats — Design

Cross-tournament individual player stats. Two surfaces: a per-player profile page (`/player/{provider}/{slug}`) and a site-wide leaderboards page (`/leaderboards`). Both are served from a precomputed index pinned to `.cache/players/`, rebuilt only when a tournament's `[done]` flag flips.

## Background

The app currently has rich per-tournament stats (`/api/stats`) and a contextual in-tournament `PlayerModal` (`/api/player`), but nothing aggregates a single player's results across multiple tournaments. The cached `.cache/full/<id>.json` files for tournaments marked `[done]` in `public/tournaments.txt` contain every match — players, opponents, partners, scores, durations, courts. That data is sufficient to build a player-centric view without any new BAT/BWF fetches.

## Goals

- A `/player/{provider}/{slug}` page per known player showing: core W/L + discipline split, tournament-by-tournament history with best finish per event, titles & finals, recent form, match-character stats (court time, three-setters, comebacks, walkovers), frequent opponents, frequent partners.
- A `/leaderboards` page with four tab categories (Headline, Discipline, Character, Activity) — boards detailed under Data Model below.
- Zero new BAT/BWF fetches: aggregation reads only `.cache/full/`.
- Done-tournaments only contribute to the index. In-progress tournaments are excluded so career stats are stable.
- Profile page loads in < 80 ms server-side from the pinned index.
- Each provider (BAT and BWF) has its own separate index. No cross-provider player merging.
- An existing `PlayerModal` (in-tournament) gains a "View full profile →" link when the player exists in the index for the current provider.
- The home/tournament-picker screen gains a "Leaderboards" card linking to `/leaderboards`.

## Non-Goals

- Live in-tournament increments to player stats. Profile/leaderboards reflect only matches from tournaments that have flipped `[done]`.
- Cross-provider identity matching. A player who appears in both a BAT and a BWF tournament is two separate profiles.
- Backfill of historical tournaments not already in `.cache/full/`. The feature grows organically as tournaments are added.
- Seed-aware metrics (upsets, ranking changes). Seeds aren't reliably present in `MatchEntry`.
- Per-player avatar / bio / age. YOB requires a BAT global-profile fetch and isn't worth the cost yet.
- Authentication, "favorite player" subscriptions, or notifications.

## Settings — recap of brainstorming Q&A

| Decision | Choice |
|---|---|
| Artifact | Both per-player profile pages AND a cross-tournament leaderboards page. |
| Coverage | Only tournaments already cached in `.cache/full/`. No backfill. |
| Providers | Both BAT and BWF, with completely separate indexes per provider. |
| Identity (BAT) | Normalized name only. Lowercase, trim, collapse whitespace, strip seed brackets. Accept collision risk. |
| Identity (BWF) | Same — normalized name only. |
| Profile stat tiers | All four — core+discipline, tournament history+titles, match character, opponents+partners. |
| Leaderboards | All four categories — Headline, Discipline, Character, Activity. |
| Build model | Approach A — pre-built, pinned, done-tournaments only. |
| Profile entry point | Keep PlayerModal, add "View full profile →" link footer. |
| Leaderboards entry point | New top-level card on the home/tournament-picker screen → `/leaderboards`. |

## Architecture

```
                            done tournaments only
  public/tournaments.txt ─▶  registry filter ─▶  .cache/full/<id>.json
                                                       │
                                                       ▼
                                       lib/playerIndex.ts (pure)
                                       buildIndex(provider, tournaments)
                                                       │
                                                       ▼
                                       .cache/players/
                                         index-bat.json
                                         index-bwf.json
                                         leaderboards-bat.json
                                         leaderboards-bwf.json
                                                       │
                                                       ▼
                       /api/players/[provider]/[slug]  /api/leaderboards
                                                       │
                                                       ▼
                       app/player/[provider]/[slug]    app/leaderboards
                                                       ▲
                       components/PlayerModal (link) ──┘
                       app/page.tsx (home card) ───────┘
```

### Files (new)

| File | Role | Target LOC |
|---|---|---|
| `lib/playerIndex.ts` | Pure aggregator. `buildIndex(provider, tournaments) → { index, leaderboards }`. No I/O, no time. | < 400 |
| `lib/player-index-cache.ts` | Atomic read/write of the four JSONs (`index-{provider}.json`, `leaderboards-{provider}.json`) + sourceVersion stamp. Mirrors `lib/stats-cache.ts`. | < 100 |
| `lib/player-index-rebuild.ts` | Orchestrator. Walks `.cache/full/`, filters by `done` flag from registry, ensures clubs are pinned, calls aggregator, writes caches. | < 160 |
| `lib/clubs-cache.ts` | Read/write `.cache/clubs/<id>.json` (one-shot club roster per done tournament). | < 80 |
| `app/api/players/[provider]/[slug]/route.ts` | GET → one `PlayerRecord` from disk index. 404 if absent. | < 80 |
| `app/api/players/exists/route.ts` | GET `?provider=&name=` → `{ exists: boolean; slug: string }`. Used by PlayerModal to decide whether to render the link. | < 60 |
| `app/api/leaderboards/route.ts` | GET `?provider=&category=` → all boards in that category, or all categories if `category` omitted. | < 80 |
| `app/api/players/rebuild/route.ts` | POST → triggers rebuild. Guarded by `PLAYERS_REBUILD_TOKEN` env. | < 80 |
| `app/player/[provider]/[slug]/page.tsx` | Server-rendered profile page. Reads cache directly via `lib/player-index-cache.ts` — no self-fetch. | < 100 |
| `app/leaderboards/page.tsx` | Server-rendered leaderboards page with category tab switcher. | < 120 |
| `components/PlayerProfileView.tsx` | Pure render of `PlayerRecord`. All sections. Light/dark themed via existing CSS vars. | < 500 |
| `components/LeaderboardsView.tsx` | Pure render of `Leaderboards`. Tabbed by category. | < 320 |

### Files (modified)

| File | Change | Delta |
|---|---|---|
| `components/PlayerModal.tsx` | Footer link "View full profile →" when `/api/players/exists` returns true. Lazy-fetched once per modal open. | +35 |
| `app/page.tsx` (home) | Add "Leaderboards" home-card above tournament list (or below, see Implementation Notes). Conditional render if `/leaderboards` data is non-empty. | +30 |
| `lib/types.ts` | Add `PlayerKey`, `PlayerRecord`, `PlayerIndex`, `Leaderboards`, `LeaderboardEntry`, `PlayerMatchRef`, `PlayerEventResult`, `OpponentRecord`, `PartnerRecord` interfaces. | +140 |
| `lib/i18n.ts` | New keys (en + th) for profile and leaderboard labels. ≤ 40 new keys. | +80 |
| `app/globals.css` | Profile/leaderboard page styles. Mirrors mockup at `.superpowers/brainstorm/.../player-stats-mockup.html`. | +160 |
| `lib/tournaments-registry.ts` | Export `isDone(id)` helper (currently the `done` flag is internal to the registry's entries array). | +10 |

### New fixtures

| Fixture | Used by |
|---|---|
| `fixtures/player-index-trang-fixture.json` | Cached full snapshot of one BAT tournament (Trang Yonex 2026, smallest of the three done). Drives aggregator unit tests. |
| `fixtures/player-index-expected.json` | Expected `PlayerIndex` shape after aggregating the above. Field-by-field snapshot test. |
| `fixtures/player-index-multi.json` | Two cached tournaments together — exercises cross-tournament merging by normalized name. |
| `fixtures/player-index-empty.json` | Zero done tournaments — exercises empty index shape. |

## Data Model

### Identity

```ts
export type ProviderTag = 'bat' | 'bwf'  // already exists

export interface PlayerKey {
  provider: ProviderTag
  slug: string        // URL-safe normalized name
}
```

**Slug derivation** (pure, deterministic — single function `nameToSlug(raw)`):

1. Trim outer whitespace.
2. Strip leading seed bracket like `[1]`, `[3-4]`, `(SE)`.
3. Lowercase ASCII letters. (Thai characters are case-insensitive; left intact.)
4. Collapse internal whitespace runs to a single underscore.
5. URI-encode characters outside `[a-z0-9_-]` plus Thai vowels/consonants left as-is via `encodeURIComponent`. (Final output is URL-safe.)

Two distinct names that normalize to the same slug merge into the same `PlayerRecord` per provider — the documented identity tradeoff.

### `PlayerMatchRef`

A flattened, profile-friendly view of one `MatchEntry`. Stored denormalized inside each `PlayerRecord` so the profile page never has to cross-reference matches by ID.

```ts
export interface PlayerMatchRef {
  tournamentId: string
  tournamentName: string
  tournamentDateIso: string         // start date of the tournament
  eventId: string
  eventName: string                 // e.g. "BS U15"
  drawNum: string
  round: string                     // normalized to English ("Final", "SF", "QF", "R16", "R32"…)
  partners: string[]                // teammate names (empty for singles)
  opponents: string[]               // names of opposing team
  opponentSlugs: string[]           // slugs of opposing team
  partnerSlugs: string[]            // slugs of teammates
  scores: MatchScore[]              // already in types.ts
  outcome: 'W' | 'L' | 'WO-W' | 'WO-L' | 'RET-W' | 'RET-L'
  durationMinutes?: number
  scheduledDateIso?: string         // for "recent form" ordering
}
```

### `PlayerEventResult`

```ts
export interface PlayerEventResult {
  tournamentId: string
  eventId: string
  eventName: string
  discipline: 'singles' | 'doubles' | 'mixed'
  bestFinish: 'Champion' | 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'R128' | 'RR'
  wins: number
  losses: number
}
```

`bestFinish` is the round of the player's *last* match in that event. If they won the Final, it's "Champion". `RR` = round-robin / group stage exited without making the playoff. The aggregator computes this from the `round` of the player's terminal match in the event.

### `PlayerRecord`

```ts
export interface PlayerRecord {
  key: PlayerKey
  displayName: string                 // most-common literal name across tournaments
  altNames: string[]                  // distinct other spellings observed
  clubs: string[]                     // distinct clubs observed (most-common first)
  country?: string                    // BWF only

  totals: {
    matches: number
    wins: number
    losses: number
    walkoversReceived: number
    walkoversGiven: number
    retirementsReceived: number
    retirementsGiven: number
  }

  byDiscipline: {
    singles: { wins: number; losses: number; titles: number; finals: number; semis: number }
    doubles: { wins: number; losses: number; titles: number; finals: number; semis: number }
    mixed:   { wins: number; losses: number; titles: number; finals: number; semis: number }
  }

  titles: PlayerEventResult[]                // bestFinish === 'Champion'
  finals: PlayerEventResult[]                // bestFinish in ('F', 'Champion')
  semis: PlayerEventResult[]                 // bestFinish in ('SF', 'F', 'Champion')

  tournaments: Array<{
    tournamentId: string
    tournamentName: string
    tournamentDateIso: string
    events: PlayerEventResult[]
  }>

  recentForm: PlayerMatchRef[]               // last 10 matches, newest first

  matchCharacter: {
    courtMinutes: number
    avgMatchMinutes: number
    longestMatchMinutes: number
    longestMatchRef: PlayerMatchRef | null
    threeSetterCount: number
    threeSetterRate: number                  // 0..1 of decided matches
    comebackWins: number                     // lost game 1, won match
    comebackWinRef: PlayerMatchRef | null    // best (latest, prefer Final round)
  }

  opponents: OpponentRecord[]                // top 12, sorted by encounters desc
  partners: PartnerRecord[]                  // top 12 doubles/mixed partners

  ranks: {                                   // pre-computed ranks across all boards
    titles?: number
    wins?: number
    winPct?: number                          // null unless ≥ 20 matches
    courtTime?: number
    threeSetterWins?: number
    comebackWins?: number
    matchesLast90?: number
    tournamentsEntered?: number
    bestSingles?: number
    bestDoubles?: number
    bestMixed?: number
  }
}

export interface OpponentRecord {
  slug: string
  name: string
  meetings: number
  wins: number
  losses: number
  lastRound: string
  lastEvent: string
}

export interface PartnerRecord {
  slug: string
  name: string
  matchesTogether: number
  wins: number
  losses: number
  primaryEvent: string                       // most-common event with this partner
}
```

### `PlayerIndex` (per provider)

```ts
export interface PlayerIndex {
  version: 1
  provider: ProviderTag
  generatedAt: string
  sourceVersion: string                      // sha256 of sorted (tournamentId, fileHash) list
  sources: Array<{ tournamentId: string; tournamentName: string; tournamentDateIso: string }>
  totalPlayers: number
  totalMatches: number
  players: Record<string, PlayerRecord>      // keyed by slug
}
```

### `Leaderboards` (per provider)

```ts
export interface LeaderboardEntry {
  rank: number
  slug: string
  name: string
  primaryClub: string                        // first entry from PlayerRecord.clubs
  value: number                              // numeric leaderboard value
  display: string                            // pre-formatted ("142", "84%", "847h 12m")
  qualifier?: string                         // e.g. "20+ matches"
}

export interface LeaderboardBoard {
  id: string                                 // e.g. "headline.titles"
  title: string                              // i18n key, NOT translated; client localizes
  icon: string                               // emoji used in mockup
  category: 'headline' | 'discipline' | 'character' | 'activity'
  qualifier?: string                         // e.g. "min 20 matches"
  entries: LeaderboardEntry[]                // top 25
}

export interface Leaderboards {
  version: 1
  provider: ProviderTag
  generatedAt: string
  sourceVersion: string                      // matches PlayerIndex.sourceVersion
  boards: LeaderboardBoard[]
}
```

#### Board catalogue (v1)

| ID | Category | Metric | Qualifier |
|---|---|---|---|
| `headline.titles` | Headline | titles count desc | — |
| `headline.wins` | Headline | wins count desc | — |
| `headline.winPct` | Headline | win % desc | min 20 matches |
| `headline.courtTime` | Headline | courtMinutes desc | — |
| `discipline.singles.wins` | Discipline | singles wins desc | min 10 singles matches |
| `discipline.doubles.wins` | Discipline | doubles wins desc | min 10 doubles matches |
| `discipline.mixed.wins` | Discipline | mixed wins desc | min 10 mixed matches |
| `character.threeSetterWins` | Character | three-setter wins desc | — |
| `character.comebacks` | Character | comeback wins desc | — |
| `character.deciderRecord` | Character | deciding-set win pct desc | min 5 deciders |
| `activity.matchesLast90` | Activity | matches in last 90 days desc | — |
| `activity.tournamentsEntered` | Activity | distinct tournaments desc | — |

Each board is capped at 25 entries server-side.

## Data Flow

### Build pipeline — `buildIndex(provider, tournaments)`

Pure function in `lib/playerIndex.ts`. Inputs:

- `provider: ProviderTag`
- `tournaments: Array<{ tournamentId, tournamentName, tournamentDateIso, data: MatchesData }>`
  — only those with `done === true` and matching provider.

Algorithm:

1. **Pass 1 — bucketing.** Walk every match in every tournament's `data.groups[].matches[]`. For each match, for each player on each side, push a `PlayerMatchRef` into a `Map<slug, PlayerMatchRef[]>`. Also track per-slug observed name strings and clubs (via `playerClubCache` lookups already done by the cache writer — clubs are absent in `.cache/full/` payload itself for BAT, but the writer stores them as a sibling key; see Implementation Notes).
2. **Pass 2 — per-player aggregation.** For each `(slug, refs)` pair, derive `PlayerRecord`:
   - `totals`, `byDiscipline` — counted across `refs`.
   - `tournaments[].events[]` — group by `(tournamentId, eventId)`. `bestFinish` = round of the player's latest match in that event; "Champion" if they won the Final.
   - `titles`/`finals`/`semis` — filter from the above.
   - `recentForm` — sort `refs` by `scheduledDateIso` desc; take 10.
   - `matchCharacter` — sums and rates over `refs`. Comeback = match with `scores[0]` where player's side lost the first game and `outcome === 'W'`.
   - `opponents` — count via `opponentSlugs[]`. Top 12. Sort by meetings desc, then wins desc.
   - `partners` — count via `partnerSlugs[]`. Top 12. Sort similarly.
3. **Pass 3 — leaderboard build.** For each `LeaderboardBoard`, take the relevant scalar from every `PlayerRecord`, filter by qualifier, sort, take top 25.
4. **Pass 4 — rank backfill.** Walk each board's top-25 and write `PlayerRecord.ranks.{boardKey} = rank` for those players. (Players outside top 25 have no rank in that board.)
5. **Output.** `{ index: PlayerIndex, leaderboards: Leaderboards }`. Both share the same `sourceVersion`.

### Rebuild orchestration — `lib/player-index-rebuild.ts`

```
export async function rebuildAll(): Promise<{ rebuilt: ProviderTag[]; skipped: ProviderTag[] }>

1. const registry = listAllTournaments()
2. for each provider in ['bat', 'bwf']:
     done = registry.filter(e => e.provider === provider && e.done)
     tournaments = []
     for entry in done:
       full = readFullCache(entry.id)   // .cache/full/<id>.json
       if (!full) continue              // tournament not yet cached fully — skip
       tournaments.push({ tournamentId, tournamentName, tournamentDateIso, data: full })
     sv = sha256(stringify(sorted [(id, fileMtime)]))
     existing = readIndexCache(provider)
     if (existing?.sourceVersion === sv) { skipped.push(provider); continue }
     { index, leaderboards } = buildIndex(provider, tournaments)
     writeIndexCache(provider, index)
     writeLeaderboardsCache(provider, leaderboards)
     rebuilt.push(provider)
3. return { rebuilt, skipped }
```

Rebuild triggers (in priority order):

1. `POST /api/players/rebuild` with `Authorization: Bearer ${PLAYERS_REBUILD_TOKEN}`. Always runs.
2. Cold-start auto-check on first read of `/api/players/...` or `/api/leaderboards`: if the on-disk index's `sourceVersion` is stale relative to current source files, kick off a background rebuild (don't block the request — serve stale once, fresh next time).
3. Manual: `node scripts/rebuild-player-index.ts` (a thin wrapper around `rebuildAll`).

No cron in v1. Most tournaments transition to `[done]` manually via a human editing `public/tournaments.txt`; the human can hit the rebuild endpoint at that moment, or rely on the cold-start auto-check.

### Read path — `/api/players/[provider]/[slug]`

```
1. cache = readIndexCache(provider)     // disk
2. if (!cache) return 404 { error: 'index not built' }
3. record = cache.players[slug]
4. if (!record) return 404 { error: 'player not found' }
5. return { record, indexGeneratedAt: cache.generatedAt }
```

### Read path — `/api/leaderboards`

```
1. cache = readLeaderboardsCache(provider ?? 'bat')
2. if (category) return cache.boards.filter(b => b.category === category)
3. return cache.boards
```

### Read path — `/api/players/exists?provider=&name=`

```
1. slug = nameToSlug(name)
2. cache = readIndexCache(provider)
3. return { exists: !!cache?.players[slug], slug }
```

This route does not load the full record — only checks key presence. PlayerModal calls it once per modal open to decide whether to render the link.

## UI Integration

### Profile page (`app/player/[provider]/[slug]/page.tsx`)

Server component. Reads cache via `lib/player-index-cache.ts`. Renders `<PlayerProfileView record={record} />`. 404 page if record missing.

URL examples:
- `/player/bat/somchai_suksawat`
- `/player/bwf/li_shi_feng`

### Leaderboards page (`app/leaderboards/page.tsx`)

Server component. Reads `readLeaderboardsCache('bat')` and `readLeaderboardsCache('bwf')`. Renders `<LeaderboardsView batBoards={…} bwfBoards={…} />`. Page-level provider toggle defaults to whichever has more data (or BAT if equal).

### `PlayerModal.tsx` modification

On mount, `useEffect` fires `/api/players/exists?provider=&name=`. Result cached in component state. If `exists`, render footer block:

```tsx
{fullProfileSlug && (
  <a href={`/player/${currentProvider}/${fullProfileSlug}`} className="pm-full-profile-link">
    {t('viewFullProfile')} →
  </a>
)}
```

If the call fails or returns `exists: false`, no footer.

### Home screen modification (`app/page.tsx`)

A new render block above the tournament list (or styled as a featured card; final placement decided during implementation by reading the surrounding JSX):

```tsx
{showLeaderboardsCard && (
  <Link href="/leaderboards" className="home-leaderboards-card">
    <span className="home-card-icon">🏆</span>
    <span>
      <strong>{t('leaderboards')}</strong>
      <small>{t('leaderboardsSub')}</small>
    </span>
  </Link>
)}
```

`showLeaderboardsCard` is true when `/api/leaderboards?provider=bat` returns a non-empty boards array OR similarly for `bwf`. To avoid an extra fetch on home, the home page server-renders this with a direct cache read.

## Edge Cases

| Scenario | Handling |
|---|---|
| No done tournaments yet | `rebuildAll` writes an empty `PlayerIndex { players: {} }` and empty `Leaderboards { boards: [] }`. Home card hides. `/leaderboards` shows an empty state. `/player/...` always 404s. |
| Player appears in only one tournament | Profile renders normally; opponents/partners may be sparse. No special casing. |
| Player has zero doubles matches | `byDiscipline.doubles` shows `0–0` with `—%`. `partners` array empty; section renders an empty-state line. |
| Match has empty playerId (free-text entry) | Identity collapses to name slug as usual. Still indexed. |
| Two distinct people normalize to same slug | They merge (documented identity tradeoff). v1 accepts this; future enhancement could disambiguate via club. |
| `bestFinish` is "Champion" but `walkover === true` for the final | Still counted as a title. Walkovers do happen for finals; the player did win the event. |
| Tournament cached but registry entry missing | Skipped (rebuild only walks registry entries with `done`). |
| Tournament marked `[done]` but `.cache/full/<id>.json` missing | Skipped silently. Logged once. |
| `sha256` of source files unchanged between rebuilds | `rebuildAll` skips that provider. |
| Profile page hit before first rebuild ever | 404 with body `{ error: 'player not found' }`. UI shows the same 404 page as a missing slug. |
| Concurrent requests during background rebuild | All reads see the previous index; no locking. Atomic write via tmp+rename guarantees no torn reads. |
| BWF player with same name as BAT player | Two completely separate profiles at `/player/bat/...` and `/player/bwf/...`. No cross-linking. |
| Leaderboards cache exists but PlayerIndex missing | Treated as inconsistency; `/leaderboards` still renders from leaderboards cache, but rank-badge clicks may 404. Rebuild fixes. |
| Player has 19 matches → win% board excludes them | Per qualifier. Other boards may still include them. Their profile-page rank-badge for `winPct` omitted (per `ranks.winPct` being undefined). |

## Error Handling

| Failure | Behavior |
|---|---|
| Aggregator throws on malformed match data | `rebuildAll` catches per-provider; that provider stays at last-known-good index. Logs error. |
| Cache write fails (disk full, perms) | Log; in-memory index NOT updated. Next request triggers retry on next rebuild. |
| Cache read fails (corrupt JSON) | Treat as missing → 404. Rebuild fixes. |
| `/api/players/exists` fails | PlayerModal silently hides the footer link. Never surfaces an error to user. |
| Rebuild endpoint hit without correct token | 401 `{ error: 'unauthorized' }`. |
| Rebuild endpoint hit while rebuild already in progress | Module-scoped `rebuildLock: Promise<…> | null` — second caller awaits the same promise. No double work. |

## Testing

### Unit (fixture-based, no network)

| Test file | Coverage |
|---|---|
| `__tests__/playerIndex.test.ts` | Snapshot-test `buildIndex('bat', [trang])` against `fixtures/player-index-expected.json`. Field-by-field assertions on totals, byDiscipline, titles count, opponents top-1, partners top-1, recentForm count. |
| `__tests__/playerIndex.multi.test.ts` | `buildIndex('bat', [trang, sprc])` merges a player's totals across both tournaments. |
| `__tests__/playerIndex.empty.test.ts` | `buildIndex('bat', [])` returns the empty shape (players: {}, leaderboards.boards: each with []). |
| `__tests__/playerIndex.leaderboards.test.ts` | Top-25 truncation, qualifier filtering (win% requires ≥ 20 matches), rank backfill into PlayerRecord.ranks. |
| `__tests__/playerIndex.slug.test.ts` | `nameToSlug` table-test: Thai names, seed prefixes, double-spaces, mixed scripts. |
| `__tests__/player-index-cache.test.ts` | Round-trip write/read; missing file → null; sourceVersion mismatch → null. |
| `__tests__/player-index-rebuild.test.ts` | Mocked I/O. Skips providers with no done tournaments. Skips when sourceVersion unchanged. Handles partial done set. |

### API route (mocked I/O)

`__tests__/api-players-route.test.ts`, `api-leaderboards-route.test.ts`, `api-players-exists-route.test.ts`, `api-players-rebuild-route.test.ts`. Standard cases: 200, 404, 401 (rebuild auth), category filter.

### Render (component, jsdom)

`__tests__/PlayerProfileView.test.tsx`:
- Renders all sections from a fixture record.
- Empty-state branches: no doubles, no opponents, no recent form.
- Champion chip styling.
- Rank-badge clicks navigate to correct leaderboard with hash anchor.

`__tests__/LeaderboardsView.test.tsx`:
- Renders all four categories.
- "You" highlight (when a query parameter `highlight=<slug>` is present).
- Empty-state when no boards.

### Integration (manual)

Post-deploy:
- Hit `/api/players/rebuild` with the token. Confirm `.cache/players/*.json` written.
- Open `/leaderboards` — verify all four category tabs render boards.
- Open a known player's profile via the modal link — verify all sections render.
- Toggle light/dark — verify no contrast regressions.
- Verify zero new `[bat-fetch]` log lines from any of the above.

## Implementation Notes

- **Provider scoping in registry.** `lib/tournaments-registry.ts` already tracks `provider` per entry. The rebuild orchestrator filters by `(provider, done === true)`. We export a `listDoneByProvider(provider)` helper.
- **Club source.** BAT `.cache/full/<id>.json` payloads carry player names but not clubs. Clubs live in `playerClubCache` (in-memory, populated by bracket scraping / `fetchTournamentPlayerClubs` in `lib/bracket-cache.ts`). For each done tournament, the rebuild orchestrator pins clubs to `.cache/clubs/<id>.json` once: if that file doesn't exist, the rebuild calls `fetchTournamentPlayerClubs(id)` and serializes the prefix-filtered entries from `playerClubCache` to disk. On subsequent rebuilds the disk file is reused — done tournaments don't change. (`fetchTournamentPlayerClubs` is one cheap HTTP call per tournament; happens off the request path during rebuild only.) BWF carries `country` on `MatchPlayer` directly — used as the "club" equivalent for that provider; no clubs fetch needed.
- **Round normalization.** Reuse the `ROUND_TRANSLATIONS` map already in `lib/scraper.ts` (export if not yet exported). After normalization, the round set is finite: `Final`, `SF`, `QF`, `R16`, `R32`, `R64`, `R128`, plus `RR` / `Group Stage`.
- **Discipline detection.** `team1.length === 1` → singles. `team1.length === 2` → doubles or mixed; classified as mixed if the `eventName` matches `/mixed|XD/i`, else doubles.
- **Deciding-set win pct.** Decider = match with 3 sets where `outcome === 'W'` and game 3 went to the player's side. Computed as `winsInDecider / totalDeciders`.
- **Last-90-days window.** `Date.now() - 90 * 86400 * 1000` at rebuild time. Stored as an absolute count on `PlayerRecord.matchCharacter`-adjacent field (or `ranks.matchesLast90`).
- **Sorting determinism.** Every sort breaks ties by `slug` ascending so the index is byte-stable across rebuilds when input hasn't changed.
- **Atomic writes.** Use the same tmp+rename pattern as `lib/stats-cache.ts`. Disk paths: `.cache/players/index-bat.json`, `.cache/players/index-bwf.json`, `.cache/players/leaderboards-bat.json`, `.cache/players/leaderboards-bwf.json`.
- **PlayerModal lookup.** The modal already knows the current tournament's provider via context. It calls `/api/players/exists?provider=<tag>&name=<encodeURIComponent(displayName)>`. If `exists`, render the link. Cache the result in `useRef` so re-opens are instant.
- **i18n keys to add.** `viewFullProfile`, `playerProfile`, `tournamentHistory`, `recentForm`, `matchCharacter`, `frequentOpponents`, `frequentPartners`, `byDiscipline`, `singles`, `doubles`, `mixed`, `title`, `titles`, `final`, `finals`, `semifinal`, `semifinals`, `courtTime`, `avgMatch`, `longestMatch`, `threeSetterRate`, `comebackWins`, `walkoversReceived`, `walkoversGiven`, `retirementsReceived`, `champion`, `runnerUp`, `leaderboards`, `leaderboardsSub`, `lbHeadline`, `lbDiscipline`, `lbCharacter`, `lbActivity`, `lbMostTitles`, `lbMostWins`, `lbHighestWinPct`, `lbMostCourtTime`, `lbBestSingles`, `lbBestDoubles`, `lbBestMixed`, `lbThreeSetterWins`, `lbCombackWins`, `lbDeciderRecord`, `lbMatchesLast90`, `lbTournamentsEntered`, `min20`, `min10`, `min5`. Each gets both `en` and `th`.
- **CSS organization.** Profile and leaderboards styles live under existing `app/globals.css` as `.pp-*` and `.lb-*` prefixes. No new CSS files. Visual treatment matches `.superpowers/brainstorm/82948-1779590351/content/player-stats-mockup.html`.
- **Mockup retention.** The mockup HTML lives in `.superpowers/brainstorm/...` — already gitignored by superpowers; nothing to commit.
- **Analytics.** Two new events via existing `lib/analytics.ts`: `player_profile_viewed` (with `provider`, `slug`) and `leaderboards_viewed` (with `provider`, `category`).
- **Bundle cost.** Both view components are plain HTML/CSS; no charts. Should compile to under 12 KB minified each.
- **Pre-warm.** Not included in the boot pre-warm chain. Cold cache reads are < 80 ms.

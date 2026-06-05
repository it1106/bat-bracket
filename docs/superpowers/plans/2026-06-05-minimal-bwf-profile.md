# Minimal BWF Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop returning 404 when a BWF-ranked player has no entry in the local BWF player index. Render a stripped-down profile (header + Current Ranking + Ranking Detail) for these players using the data the BWF ranking cache already carries.

**Architecture:** The page route dispatches between the existing full `PlayerProfileView` (when the index has the slug) and a new `MinimalPlayerProfile` component (when the slug is absent from the index but present in `ranking-{provider}.json`). 404 still fires when both lookups miss. The ranking-entry collection loop and SSR detail pre-fetch are hoisted above the dispatch so both branches share them.

**Tech Stack:** Next.js 14 (App Router) · TypeScript · Jest + React Testing Library (next/jest) · existing `components/RankingDetailTabs` and `lib/ranking/*` modules.

**Spec:** `docs/superpowers/specs/2026-06-05-minimal-bwf-profile-design.md`

---

## File Structure

**New files**

- `components/MinimalPlayerProfile.tsx` — renders header + Current Ranking section + RankingDetailTabs for non-indexed ranked players
- `__tests__/minimal-player-profile.test.tsx` — render-shape unit test

**Modified files**

- `app/player/[provider]/[slug]/page.tsx` — hoist ranking collection + SSR pre-fetch above the dispatch; add the index-miss branch that renders `MinimalPlayerProfile`

**Untouched (referenced for context)**

- `components/PlayerProfileView.tsx` — unchanged
- `components/RankingDetailTabs.tsx` — unchanged (already accepts `provider`, `slug`, `initialDetail`, `rankingPublishDate`, `currentRanking`)
- `lib/types.ts` — unchanged (reusing `RankingPlayerRank`, `RankingPlayerDetail`, `Ranking`, `ProviderTag`)

---

## Task 0a: Rename leaderboard provider tab "BWF" → "BWF Asia"

**Files:**
- Modify: `components/LeaderboardsView.tsx`

- [ ] **Step 1: Update the provider label map**

Open `components/LeaderboardsView.tsx`. Find:
```ts
const PROVIDER_LABELS: Record<ProviderTag, string> = {
  bat: 'BAT',
  bwf: 'BWF',
  combined: 'BAT+BWF',
}
```
Change the `bwf` value:
```ts
const PROVIDER_LABELS: Record<ProviderTag, string> = {
  bat: 'BAT',
  bwf: 'BWF Asia',
  combined: 'BAT+BWF',
}
```

- [ ] **Step 2: Verify the change compiles**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/LeaderboardsView.tsx
git commit -m "feat(leaderboards): rename BWF tab to 'BWF Asia'"
```

---

## Task 0b: Sort BWF Ranking Detail sections by age desc

**Files:**
- Modify: `lib/ranking/player-view.ts`
- Modify: `__tests__/ranking-player-view.test.ts`

Today `bwfSectionsForTab` orders ranked sections by rank asc, with unranked falling back to age desc. Result for Ravin: U15 (ranked #10) appears above U17 (unranked). User wants pure age desc — higher age group first — regardless of rank. So U17 above U15 above U13 universally.

- [ ] **Step 1: Update the existing section-ordering test**

Open `__tests__/ranking-player-view.test.ts`. Find the test starting:
```ts
  it('section ordering: ranked sections first by rank asc, then unranked by age desc', () => {
```
Replace its entire body with:

```ts
  it('section ordering: pure age desc — higher age group first regardless of rank', () => {
    const d = det([
      tx('MS-U15', 960, [
        { eventName: "Boy's singles U17", credit: 288 },
        { eventName: "Boy's singles U15", credit: 960 },
      ]),
      tx('MS U13', 2125, [
        { eventName: "Boy's singles U15", credit: 637.5 },
      ], '2025-45'),
    ])
    const current: Ranking = {
      provider: 'bwf', scrapedAt: 'x', publishDate: '03/06/2026', rankingId: '52035',
      events: [
        { eventCode: 'U15_MS', eventName: "Boy's singles U15", entries: [
          { rank: 10, name: 'X', slug: 'x', club: '', points: 1598, tournaments: 2, globalPlayerId: '1' },
        ]},
        // No entry for U17 — player is not ranked there, but U17 still sorts above U15.
      ],
    }
    const sections = bwfSectionsForTab(d, 'singles', { slug: 'x', current })
    expect(sections.map(s => s.eventName)).toEqual([
      "Boy's singles U17",   // higher age → first, even though player is unranked here
      "Boy's singles U15",   // ranked #10 → second
    ])
  })
```

Also update the test's title (the `it('...')` first arg) to match the new expectation, as shown above.

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx jest __tests__/ranking-player-view.test.ts --no-coverage
```

Expected: that one test fails (current implementation returns U15 first). Other 22 tests still pass.

- [ ] **Step 3: Simplify the sort logic**

Open `lib/ranking/player-view.ts`. Find the block:
```ts
  // 3. Section ordering: ranked first (rank asc), then unranked (age desc).
  sections.sort((a, b) => {
    const ra = rankCtx ? lookupRankIn(rankCtx.current, a.eventName, rankCtx.slug) : null
    const rb = rankCtx ? lookupRankIn(rankCtx.current, b.eventName, rankCtx.slug) : null
    if (ra !== null && rb !== null) return ra - rb
    if (ra !== null) return -1
    if (rb !== null) return 1
    return ageTierOfEventName(b.eventName) - ageTierOfEventName(a.eventName)
  })
```
Replace with:
```ts
  // 3. Section ordering: pure age desc — higher age group first. The
  //  player's per-event rank is shown in the section header but does
  //  NOT drive ordering, so a section the player dominates doesn't
  //  jump above one they're carry-over-ranked in.
  sections.sort((a, b) => ageTierOfEventName(b.eventName) - ageTierOfEventName(a.eventName))
```

The `rankCtx` parameter is still consumed by the rank lookup in the caller (`BwfRankingSection` looks up rank for the header) — only the internal sort changes. We keep `rankCtx` in the signature for backward compatibility with the existing call site in `RankingDetailTabs.tsx`; remove the now-unused `lookupRankIn` and `rankCtx` references from this function ONLY (do not delete `lookupRankIn` — it has zero callers after this change. Remove it.)

Concrete second edit: also remove the now-dead `lookupRankIn` helper from the file (a small lint hint will flag it):

Find and delete:
```ts
function lookupRankIn(current: Ranking | null | undefined, eventName: string, slug: string): number | null {
  if (!current) return null
  const ev = current.events.find((e) => e.eventName === eventName)
  return ev?.entries.find((e) => e.slug === slug)?.rank ?? null
}
```

And remove the now-unused `Ranking` import if nothing else in the file references it. Check first:
```bash
grep -n "\\bRanking\\b" lib/ranking/player-view.ts
```
If the only remaining hit is the import line and the `rankCtx` parameter type, keep `Ranking` in the import — it's still used by the parameter type. (`bwfSectionsForTab` still accepts `rankCtx?: { slug: string; current: Ranking | null }` so callers don't break.)

- [ ] **Step 4: Re-run the tests**

```bash
npx jest __tests__/ranking-player-view.test.ts --no-coverage
```

Expected: all 23 tests pass.

- [ ] **Step 5: Confirm the fixture test still passes**

```bash
npx jest ranking-bwf-sections-fixture --no-coverage
```

Expected: 3 pass (the U15 / U17 / doubles assertions don't depend on which section is listed first).

- [ ] **Step 6: Compile-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add lib/ranking/player-view.ts __tests__/ranking-player-view.test.ts
git commit -m "feat(ranking): sort BWF detail sections by age desc"
```

---

## Task 0c: Rename "Current Ranking" heading on the full BWF profile

**Files:**
- Modify: `components/PlayerProfileView.tsx`

Indexed BWF players (e.g. Ravin) show the same Current Ranking block — rename their heading too so the BWF surface is consistent. BAT players keep "Current Ranking".

- [ ] **Step 1: Make the heading provider-aware**

Open `components/PlayerProfileView.tsx`. Find:
```tsx
          <h2>Current Ranking{rankingPublishDate && (
            <span className="pp-stats-note">as of {rankingPublishDate}{rankingWeekKey && ` (${rankingWeekKey})`}</span>
          )}</h2>
```
Replace with:
```tsx
          <h2>{record.key.provider === 'bwf' ? 'BWF Badminton Asia Ranking' : 'Current Ranking'}{rankingPublishDate && (
            <span className="pp-stats-note">as of {rankingPublishDate}{rankingWeekKey && ` (${rankingWeekKey})`}</span>
          )}</h2>
```

- [ ] **Step 2: Compile-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/PlayerProfileView.tsx
git commit -m "feat(player): rename Current Ranking → BWF Badminton Asia Ranking on BWF profiles"
```

---

## Task 1: `MinimalPlayerProfile` component

**Files:**
- Create: `components/MinimalPlayerProfile.tsx`

The component takes everything it needs by props. It's a client component because it uses `useRouter` for the back-button fallback and the language context for the "as of" string.

- [ ] **Step 1: Write the component**

Create `components/MinimalPlayerProfile.tsx` with this exact content:

```tsx
'use client'
import React from 'react'
import { useRouter } from 'next/navigation'
import { weekKeyFromPublishDate } from '@/lib/ranking/player-view'
import { getRankingConfig } from '@/lib/ranking/config'
import { useLanguage } from '@/lib/LanguageContext'
import RankingDetailTabs from './RankingDetailTabs'
import type {
  ProviderTag,
  Ranking,
  RankingPlayerDetail,
  RankingPlayerRank,
} from '@/lib/types'

interface Props {
  /** Provider tag for the URL space (in practice always 'bwf' today, but
   *  the BAT branch can theoretically fall through here too if a BAT
   *  player's slug is missing from the index — render minimally rather
   *  than 404). */
  provider: ProviderTag
  slug: string
  displayName: string
  /** Country derived from the ranking entry's `club` field. BWF stores
   *  the player's country there; an empty string hides the row. */
  country: string
  playerRankings: RankingPlayerRank[]
  rankingPublishDate?: string
  initialDetail?: RankingPlayerDetail
  currentRanking?: Ranking | null
}

/**
 * A stripped-down profile rendered when a player is BWF-ranked but absent
 * from our local player index (we never scraped any tournament they
 * played). Shows only what the ranking cache directly provides: name,
 * country, the rank/points per event, and the Ranking Detail panel.
 *
 * Match-driven sections (KPIs, Tournament history, Recent form, Opponents,
 * etc.) are omitted — we don't have that data for these players.
 */
export default function MinimalPlayerProfile({
  provider,
  slug,
  displayName,
  country,
  playerRankings,
  rankingPublishDate,
  initialDetail,
  currentRanking,
}: Props) {
  const router = useRouter()
  useLanguage() // currently unused; reserved for future i18n on the header
  const rankingWeekKey = rankingPublishDate
    ? weekKeyFromPublishDate(rankingPublishDate, getRankingConfig(provider).dateFormat)
    : null

  const goBack = (e: React.MouseEvent) => {
    e.preventDefault()
    if (window.history.length > 1) router.back()
    else router.push('/leaderboards')
  }

  return (
    <div className="pp-page">
      <a href="/leaderboards" className="pp-back" onClick={goBack}>← Back</a>
      <div className="pp-hdr">
        <h1>{displayName}</h1>
        <div className="pp-meta">
          {country && <span>🌐 <strong>{country}</strong></span>}
        </div>
      </div>

      {playerRankings.length > 0 && (
        <div className="pp-section pp-ranking-section">
          <h2>{provider === 'bwf' ? 'BWF Badminton Asia Ranking' : 'Current Ranking'}{rankingPublishDate && (
            <span className="pp-stats-note">as of {rankingPublishDate}{rankingWeekKey && ` (${rankingWeekKey})`}</span>
          )}</h2>
          <div className="pp-ranking-list">
            {playerRankings.map(r => (
              <div key={r.eventName} className="pp-ranking-row">
                <span className="pp-ranking-event">{r.eventName}</span>
                <span className="pp-ranking-pos">#{r.rank}</span>
                <span className="pp-ranking-tn">{r.tournaments} tn</span>
                <span className="pp-ranking-pts">{r.points.toLocaleString()} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <RankingDetailTabs
        provider={provider}
        slug={slug}
        initialDetail={initialDetail}
        rankingPublishDate={rankingPublishDate}
        currentRanking={currentRanking}
      />
    </div>
  )
}
```

- [ ] **Step 2: Compile-check**

Run:
```bash
npx tsc --noEmit
```

Expected: clean. (Component is unused so far; adding it to the route is Task 3.)

- [ ] **Step 3: Commit**

```bash
git add components/MinimalPlayerProfile.tsx
git commit -m "feat(components): MinimalPlayerProfile for non-indexed ranked players"
```

---

## Task 2: Render-shape test for `MinimalPlayerProfile`

**Files:**
- Create: `__tests__/minimal-player-profile.test.tsx`

We mock `RankingDetailTabs` so the test focuses on what `MinimalPlayerProfile` itself renders (header + Current Ranking + that the right props flow into the detail panel).

- [ ] **Step 1: Verify React Testing Library is available**

Run:
```bash
grep -E '"@testing-library/react"|jest-environment-jsdom' package.json
```

Expected: both present. If not, the test will fail with a clear import error and you can add them; jest.config.ts already uses next/jest which configures jsdom on demand via `// @jest-environment jsdom`.

- [ ] **Step 2: Write the test**

Create `__tests__/minimal-player-profile.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import MinimalPlayerProfile from '@/components/MinimalPlayerProfile'
import type { Ranking, RankingPlayerRank } from '@/lib/types'

// Mock useRouter — the component reads it for the back button, but we
// don't trigger that branch in this test.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}))

// Mock the language context so we don't need a provider wrapper.
jest.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}))

// Mock RankingDetailTabs so we can assert on the props without rendering
// the whole tab UI (it has its own tests).
const detailTabsMock = jest.fn(() => <div data-testid="ranking-detail-tabs" />)
jest.mock('@/components/RankingDetailTabs', () => ({
  __esModule: true,
  default: (props: unknown) => detailTabsMock(props),
}))

const baseRankings: RankingPlayerRank[] = [
  { eventName: "Boy's singles U15", rank: 1, points: 4600, tournaments: 0 },
  { eventName: "Boy's singles U17", rank: 24, points: 1380, tournaments: 0 },
]

const baseRanking: Ranking = {
  provider: 'bwf', scrapedAt: 'x', publishDate: '03/06/2026', rankingId: '52035', events: [],
}

beforeEach(() => { detailTabsMock.mockClear() })

describe('MinimalPlayerProfile', () => {
  it('renders the display name', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="zhang_jia_lun"
        displayName="ZHANG Jia Lun"
        country="China"
        playerRankings={baseRankings}
        rankingPublishDate="03/06/2026"
        currentRanking={baseRanking}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ZHANG Jia Lun')
  })

  it('renders the country with the globe icon', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="zhang_jia_lun"
        displayName="ZHANG Jia Lun"
        country="China"
        playerRankings={baseRankings}
        currentRanking={baseRanking}
      />,
    )
    expect(screen.getByText('China')).toBeInTheDocument()
    // The globe glyph is part of the row.
    const meta = screen.getByText('China').closest('span')
    expect(meta?.textContent).toContain('🌐')
  })

  it('hides the country row when country is empty', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="x"
        displayName="X"
        country=""
        playerRankings={baseRankings}
        currentRanking={baseRanking}
      />,
    )
    expect(screen.queryByText('🌐')).not.toBeInTheDocument()
  })

  it('lists each ranking entry with rank, tournaments, and points', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="zhang_jia_lun"
        displayName="ZHANG Jia Lun"
        country="China"
        playerRankings={baseRankings}
        rankingPublishDate="03/06/2026"
        currentRanking={baseRanking}
      />,
    )
    expect(screen.getByText("Boy's singles U15")).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('4,600 pts')).toBeInTheDocument()
    expect(screen.getByText("Boy's singles U17")).toBeInTheDocument()
    expect(screen.getByText('#24')).toBeInTheDocument()
    expect(screen.getByText('1,380 pts')).toBeInTheDocument()
  })

  it('omits the BWF Badminton Asia Ranking section when there are no rankings', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="x"
        displayName="X"
        country="China"
        playerRankings={[]}
        currentRanking={baseRanking}
      />,
    )
    expect(screen.queryByText('BWF Badminton Asia Ranking')).not.toBeInTheDocument()
  })

  it('uses the BWF heading when provider is bwf', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="x"
        displayName="X"
        country="China"
        playerRankings={baseRankings}
        currentRanking={baseRanking}
      />,
    )
    expect(screen.getByText(/BWF Badminton Asia Ranking/)).toBeInTheDocument()
  })

  it('forwards detail-panel props to RankingDetailTabs', () => {
    const initialDetail = {
      globalPlayerId: '8934872',
      publishDate: '03/06/2026',
      scrapedAt: 'x',
      tournaments: [],
    }
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="zhang_jia_lun"
        displayName="ZHANG Jia Lun"
        country="China"
        playerRankings={baseRankings}
        rankingPublishDate="03/06/2026"
        initialDetail={initialDetail}
        currentRanking={baseRanking}
      />,
    )
    expect(detailTabsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'bwf',
        slug: 'zhang_jia_lun',
        initialDetail,
        rankingPublishDate: '03/06/2026',
        currentRanking: baseRanking,
      }),
    )
    expect(screen.getByTestId('ranking-detail-tabs')).toBeInTheDocument()
  })

  it('shows the "as of" date with week key in the header', () => {
    render(
      <MinimalPlayerProfile
        provider="bwf"
        slug="x"
        displayName="X"
        country="China"
        playerRankings={baseRankings}
        rankingPublishDate="03/06/2026"
        currentRanking={baseRanking}
      />,
    )
    // 3 June 2026 = ISO week 23.
    expect(screen.getByText(/as of 03\/06\/2026 \(2026-23\)/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the test**

```bash
npx jest minimal-player-profile --no-coverage
```

Expected: all 7 pass.

If `@testing-library/react` is not installed, the run errors with `Cannot find module '@testing-library/react'`. Install it then re-run:
```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom jest-environment-jsdom
```

- [ ] **Step 4: Commit**

```bash
git add __tests__/minimal-player-profile.test.tsx
# If you had to install testing-library above, add package.json + lockfile too:
git add package.json package-lock.json 2>/dev/null
git commit -m "test(components): MinimalPlayerProfile render-shape tests"
```

---

## Task 3: Page route dispatches between full and minimal

**Files:**
- Modify: `app/player/[provider]/[slug]/page.tsx`

Restructure the route so we (1) collect ranking entries before deciding which component to render, (2) only 404 when the slug is absent from BOTH the index and the ranking cache, and (3) dispatch to `MinimalPlayerProfile` for the index-miss-but-ranked case.

- [ ] **Step 1: Replace the file contents**

Replace `app/player/[provider]/[slug]/page.tsx` with:

```tsx
import { notFound } from 'next/navigation'
import { readIndexCache } from '@/lib/player-index-cache'
import { readRankingCache } from '@/lib/ranking/cache'
import { readRankingPlayerDetail } from '@/lib/ranking/player-cache'
import { readPlayerIdEntry } from '@/lib/bat-player-id-map'
import PlayerProfileView from '@/components/PlayerProfileView'
import MinimalPlayerProfile from '@/components/MinimalPlayerProfile'
import type { ProviderTag, RankingPlayerRank, RankingPlayerDetail } from '@/lib/types'

interface Props { params: { provider: string; slug: string } }

const PROVIDERS = new Set<ProviderTag>(['bat', 'bwf'])

export default async function PlayerPage({ params }: Props) {
  const provider = params.provider as ProviderTag
  if (!PROVIDERS.has(provider)) notFound()

  // Read both caches in parallel — the minimal-profile branch needs the
  // ranking cache even when the index lookup misses.
  const [index, currentRanking] = await Promise.all([
    readIndexCache(provider),
    readRankingCache(provider),
  ])
  const record = index?.players[params.slug]

  // Collect this slug's ranking entries regardless of index hit.
  const playerRankings: RankingPlayerRank[] = []
  let rankingName = ''
  let rankingCountry = ''
  let bwfGlobalPlayerId = ''
  if (currentRanking) {
    for (const ev of currentRanking.events) {
      const entry = ev.entries.find(e => e.slug === params.slug)
      if (entry) {
        playerRankings.push({
          eventName: ev.eventName,
          rank: entry.rank,
          points: entry.points,
          tournaments: entry.tournaments,
        })
        if (entry.globalPlayerId) bwfGlobalPlayerId = entry.globalPlayerId
        if (!rankingName) rankingName = entry.name
        if (!rankingCountry) rankingCountry = entry.club
      }
    }
  }

  // 404 only when nothing is known about this slug.
  if (!record && playerRankings.length === 0) notFound()

  // SSR pre-fetch the per-player detail when we know the id and the cache
  // is fresh against the current publishDate. BAT gets its id from the
  // slug↔id map (built by the 3-hop discovery on first request); BWF gets
  // it directly from the matching ranking entry (no discovery needed).
  let initialDetail: RankingPlayerDetail | undefined
  let globalPlayerId = ''
  if (provider === 'bat') {
    const idEntry = await readPlayerIdEntry(params.slug)
    globalPlayerId = idEntry?.globalPlayerId ?? ''
  } else if (provider === 'bwf') {
    globalPlayerId = bwfGlobalPlayerId
  }
  if (globalPlayerId && currentRanking) {
    const cached = await readRankingPlayerDetail(provider, globalPlayerId)
    if (cached?.detail && cached.detail.publishDate === currentRanking.publishDate) {
      initialDetail = cached.detail
    }
  }

  const rankingPublishDate = currentRanking?.publishDate || undefined

  if (record) {
    return (
      <PlayerProfileView
        record={record}
        playerRankings={playerRankings.length ? playerRankings : undefined}
        rankingPublishDate={rankingPublishDate}
        initialDetail={initialDetail}
        currentRanking={currentRanking}
      />
    )
  }

  return (
    <MinimalPlayerProfile
      provider={provider}
      slug={params.slug}
      displayName={rankingName}
      country={rankingCountry}
      playerRankings={playerRankings}
      rankingPublishDate={rankingPublishDate}
      initialDetail={initialDetail}
      currentRanking={currentRanking}
    />
  )
}

export const dynamic = 'force-dynamic'
```

- [ ] **Step 2: Compile-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Full test suite still green**

```bash
npx jest --no-coverage
```

Expected: 93 suites / 686 tests pass (was 92 / 678 before — the new test file adds 1 suite / 8 tests).

- [ ] **Step 4: Commit**

```bash
git add app/player/[provider]/[slug]/page.tsx
git commit -m "feat(player): render minimal profile for non-indexed BWF-ranked players"
```

---

## Task 4: Manual smoke test

**Files:** none — verification only.

- [ ] **Step 1: Restart the dev server**

```bash
rm -rf .next
PORT=3000 npm run dev
```

Wait for `✓ Ready`.

- [ ] **Step 2: Hit Zhang Jia Lun's profile**

Open in a browser: `http://localhost:3000/player/bwf/zhang_jia_lun`

Expected:
- HTTP 200, not 404
- Header: `ZHANG Jia Lun` with `🌐 China` underneath
- Section heading: `BWF Badminton Asia Ranking` (not `Current Ranking`)
- Two rows in the heading section:
  - `Boy's singles U17  #24  0 tn  1,380 pts`
  - `Boy's singles U15  #1  0 tn  4,600 pts`
- Ranking Detail panel renders the per-event sections, ordered **U17 above U15** (higher age desc, even though U15 is the higher-ranked event)
- No KPIs, no Tournament history, no Recent form, no Opponents — those sections are absent (correct: we have no match data)

- [ ] **Step 3: Confirm the indexed BWF path still works**

Open: `http://localhost:3000/player/bwf/ravin_chuchaisri`

Expected:
- Full profile renders (header with tournament/match counts, By Event Type, Tournament history, Recent form, etc.) — sections present
- The ranking heading reads `BWF Badminton Asia Ranking` (NOT `Current Ranking`)
- The Ranking Detail panel's Singles tab lists the U17 section ABOVE the U15 section (age desc)

- [ ] **Step 4: Confirm a totally unknown slug still 404s**

```bash
curl -s -o /dev/null -w "%{http_code}\n" 'http://localhost:3000/player/bwf/this_player_does_not_exist'
```

Expected: `404`.

- [ ] **Step 5: Confirm BAT remains unchanged**

Open any BAT player profile from the BAT leaderboard. The full `PlayerProfileView` should render exactly as before, with the heading reading `Current Ranking` (NOT the BWF wording).

- [ ] **Step 5a: Confirm the leaderboard tab is renamed**

Open `http://localhost:3000/leaderboards`. The provider tab strip should read `BAT | BWF Asia` (NOT `BAT | BWF`).

- [ ] **Step 6: Stop the dev server**

Ctrl-C the `npm run dev` process.

No commit if smoke passes cleanly.

---

## Self-review notes (for the engineer running this plan)

Two things worth highlighting:

1. **Task 3 hoists code, doesn't duplicate it.** The ranking-collection loop and SSR pre-fetch already exist inside the `if (currentRanking)` block today. Task 3 lifts them above the dispatch. The new behavior is purely the index-miss branch.

2. **Task 2 may need `@testing-library/react`.** The codebase doesn't use RTL anywhere else (other component tests use Jest snapshot testing or pure logic tests). Step 1 of Task 2 checks for it. If missing, install at the test-write step rather than bouncing through a separate task — it's the same commit anyway.

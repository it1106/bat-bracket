# Path to the Final Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a player's window, open a panel listing every round of their knockout draw with the real or likely opponent and the past record against them.

**Architecture:** A new bracket parser returns every round as a position-indexed list of matches. A pure walker turns that into one player's route with the candidates for each future round. A new `GET /api/path` route adds ranking positions, past records and a favourite, and a new modal renders it from a button in the player window.

**Tech Stack:** Next.js 14 (app router), React 18, TypeScript, cheerio, Jest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-09-path-to-final-design.md`

## Global Constraints

- BAT provider only. Single-elimination draws only. Never shown for BWF, group-stage or round-robin draws.
- No new BAT requests. The only BAT call this feature may cause is the one bracket fetch `bracketHtmlForSchedule` already makes when it holds no copy.
- Nothing new is kept in server memory: no new module-level caches or maps.
- Every user-visible string has both an `en` and a `th` entry in `lib/i18n.ts` and a key in the `TKey` union.
- Past records come only from the BAT player index (`readIndexCache('bat')`), never from BAT's H2H page.
- A missing ranking, index or draw list is never an error: the row renders without that piece.
- Match the surrounding code: no semicolons, single quotes, two-space indent, `@/` import alias.
- Run tests with `npx jest <file>`; the whole suite with `npm test`; lint with `npm run lint`.

## Facts about BAT bracket markup (verified against `fixtures/`)

The executor does not need to rediscover these.

- A bracket is `.bracket.js-bracket`. Each round is a `swiper-container > swiper-slide`; a slide with no `.bracket-round__match-group-wrapper` is not a round. Round names are the `.subheading` texts, indexed by slide: `Round of 128`, `Round of 64`, …, `Quarter final`, `Semi final`, `Final`.
- Every `.match` has exactly two `.match__row` elements, even when a side is empty.
- **Row position is the feeder relation.** Match `i` of round `r` is fed by matches `2i` (its row 0) and `2i+1` (its row 1) of round `r-1`. Verified: 19/19, 32/32 and 7/7 placed players line up in the three BAT fixtures.
- A bye is a decided match: the player's row has class `has-won`, the other row holds the text `Bye` and no player link, and there are no scores.
- A seed is a suffix on the player's name: `ภูมิพิพัชญ์ พึ่งโพธิ์สภ [2]`.
- The footer holds the schedule (`ส. 20/6/2569 12:00`) and, in the item with `.icon-marker`, the venue (`Green Hall`).
- A draw's `DrawInfo.type` is `Elimination` or `Round Robin`. It can be missing.
- BAT ranking event codes are `MS`, `WS`, `MD`, `WD`, `MXD` (open) and `U{age}_MS` … `U{age}_MXD` (junior). Draw names are `BS U15`, `GS U13`, `BD U17`, `GD U11`, `XD U15`, `MS`, `WS`, `MD`, `WD`, `XD`.

## File Structure

| File | Responsibility |
|------|----------------|
| `lib/types.ts` (modify) | `BracketSlotMatch`, `BracketRound` |
| `lib/scraper.ts` (modify) | `parseBracketRounds(html)` |
| `lib/bracketPath.ts` (create) | `buildBracketPath` — pure route walker |
| `lib/pathEnrich.ts` (create) | ranking code for a draw, team rank, pair record, favourite and sort; response types |
| `lib/pathDraws.ts` (create) | which of a player's draws get the button |
| `app/api/path/route.ts` (create) | `GET /api/path` |
| `components/PathToFinalModal.tsx` (create) | the panel |
| `components/PlayerModal.tsx` (modify) | the button |
| `app/page.tsx` (modify) | state, analytics, rendering the panel |
| `lib/i18n.ts` (modify) | strings |
| `app/globals.css` (modify) | `.ptf-*` styles |

## Review Focus

1. **Doubles looked up by the second-named partner, or the first partner has no index record.** The route and record must still be found. (Tasks 2 and 3.)
2. **The bracket lags a result:** the player has won but BAT has not yet placed them in the next round. That round must read as their next match, not a distant future one. (Task 2.)
3. **A name stored with a seed mark in the index or ranking** (`Name [2]`). Record and rank joins must still match. (Task 3.)
4. **A malformed bracket** where a round does not have twice the matches of the next. The walker must return fewer candidates, not throw. (Task 2.)
5. **The request fails or the panel is reopened for another draw.** The panel must show the error message instead of loading forever, and must not show the previous draw's rows. (Task 5.)

---

### Task 1: `parseBracketRounds`

**Files:**
- Modify: `lib/types.ts` (append after the `MatchScore` interface)
- Modify: `lib/scraper.ts` (add after `feedersFrom`, before the `extractMatchSchedule` comment)
- Test: `__tests__/parseBracketRounds.test.ts`

**Interfaces:**
- Consumes: existing private helpers in `lib/scraper.ts`: `extractMatchEntry($, matchEl)` → `{ team1, team2, winner, scores, walkover, retired, scheduledTime }`, `extractMatchSchedule($, matchEl)` → `{ date, time } | null`, `playerText(el)`.
- Produces:
  ```ts
  // lib/types.ts
  export interface BracketSlotMatch {
    teams: [MatchPlayer[], MatchPlayer[]]
    seeds: [string | undefined, string | undefined]
    winner: 1 | 2 | null
    scores: MatchScore[]
    walkover: boolean
    retired: boolean
    time?: string
    date?: string
    court?: string
  }
  export interface BracketRound { name: string; matches: BracketSlotMatch[] }
  // lib/scraper.ts
  export function parseBracketRounds(html: string): BracketRound[]
  ```

- [ ] **Step 1: Write the failing test**

Create `__tests__/parseBracketRounds.test.ts`:

```ts
import fs from 'fs'
import path from 'path'
import { parseBracketRounds } from '@/lib/scraper'

const fixtureHtml = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

const SEED_2_ID = '3417' // ภูมิพิพัชญ์ พึ่งโพธิ์สภ [2]

describe('parseBracketRounds', () => {
  it('returns [] when there is no bracket markup', () => {
    expect(parseBracketRounds('<html><body>nope</body></html>')).toEqual([])
  })

  it('returns every round with its name, halving in size', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-ysb-bsu13.html'))
    expect(rounds.map((r) => r.name)).toEqual([
      'Round of 128', 'Round of 64', 'Round of 32', 'Round of 16',
      'Quarter final', 'Semi final', 'Final',
    ])
    expect(rounds.map((r) => r.matches.length)).toEqual([64, 32, 16, 8, 4, 2, 1])
  })

  it('keeps both rows of every match, empty or not', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-ysb-bsu13.html'))
    for (const r of rounds) for (const m of r.matches) {
      expect(m.teams).toHaveLength(2)
      expect(m.seeds).toHaveLength(2)
    }
    // The final has nobody in it yet.
    expect(rounds[6].matches[0].teams).toEqual([[], []])
  })

  it('reads a bye as a decided match with an empty losing row', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-ysb-bsu13.html'))
    const decided = rounds[0].matches.filter((m) => m.winner !== null)
    expect(decided).toHaveLength(19)
    for (const m of decided) {
      const w = m.winner! - 1
      expect(m.teams[w].length).toBeGreaterThan(0)
      expect(m.teams[1 - w]).toEqual([])
      expect(m.scores).toEqual([])
    }
  })

  it('lifts the seed off the name', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-ysb-bsu13.html'))
    const all = rounds.flatMap((r) => r.matches)
    const hits = all.flatMap((m) => m.teams.map((team, side) => ({ team, seed: m.seeds[side] })))
      .filter((x) => x.team.some((p) => p.playerId === SEED_2_ID))
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) {
      expect(h.seed).toBe('2')
      expect(h.team[0].name).not.toMatch(/\[/)
    }
    for (const m of all) for (const team of m.teams) for (const p of team) {
      expect(p.name).not.toMatch(/\[[^\]]*\]\s*$/)
      expect(p.playerId).not.toBe('')
    }
  })

  it('places each next-round player on the row its feeder match points at', () => {
    for (const f of ['bracket-bat-ysb-bsu13.html', 'bracket-bat-bsu9.html', 'bracket-bat-themall-bdu17.html']) {
      const rounds = parseBracketRounds(fixtureHtml(f))
      let checked = 0
      rounds[1].matches.forEach((m, i) => {
        m.teams.forEach((team, side) => {
          if (team.length === 0) return
          const feeder = rounds[0].matches[2 * i + side]
          const feederIds = feeder.teams.flat().map((p) => p.playerId)
          for (const p of team) expect(feederIds).toContain(p.playerId)
          checked++
        })
      })
      expect(checked).toBeGreaterThan(0)
    }
  })

  it('reads the schedule and venue from the footer', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-ysb-bsu13.html'))
    const m = rounds[1].matches.find((x) => x.teams.flat().some((p) => p.playerId === SEED_2_ID))!
    expect(m.date).toBe('20/6/2569')
    expect(m.time).toBe('12:00')
    expect(m.court).toBe('Green Hall')
  })

  it('reads doubles teams and their scores', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-themall-bdu17.html'))
    const played = rounds[0].matches.filter((m) => m.winner !== null && m.teams[0].length > 0 && m.teams[1].length > 0)
    expect(played.length).toBeGreaterThan(0)
    for (const m of played) {
      expect(m.teams[0]).toHaveLength(2)
      expect(m.teams[1]).toHaveLength(2)
      expect(m.scores.length).toBeGreaterThanOrEqual(2)
      expect(m.scores[0].t1 + m.scores[0].t2).toBeGreaterThan(0)
    }
  })

  it('returns empty rows for a draw published with no entrants', () => {
    const rounds = parseBracketRounds(fixtureHtml('bracket-bat-unentered.html'))
    expect(rounds.map((r) => r.matches.length)).toEqual([8, 4, 2, 1])
    expect(rounds.flatMap((r) => r.matches).every((m) => m.teams[0].length === 0 && m.teams[1].length === 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/parseBracketRounds.test.ts`
Expected: FAIL — `parseBracketRounds` is not exported from `@/lib/scraper`.

- [ ] **Step 3: Add the types**

In `lib/types.ts`, directly after the `MatchScore` interface, add:

```ts
/** One match slot of a knockout bracket, as the bracket page prints it.
 *  `teams` and `seeds` always hold both rows, in page order, so the row index
 *  is meaningful: row `s` of match `i` is fed by match `2i + s` of the round
 *  before. An unfilled row, or the "Bye" row of a bye, is an empty array. */
export interface BracketSlotMatch {
  teams: [MatchPlayer[], MatchPlayer[]]
  /** The seed printed after a name ("2", "3/4"), per row. */
  seeds: [string | undefined, string | undefined]
  winner: 1 | 2 | null
  scores: MatchScore[]
  walkover: boolean
  retired: boolean
  /** "HH:MM" from the match footer. */
  time?: string
  /** The date as BAT prints it, Buddhist-era year: "20/6/2569". */
  date?: string
  /** The venue or court named in the footer. */
  court?: string
}

export interface BracketRound {
  /** The round name as BAT prints it: "Round of 64", "Quarter final", "Final". */
  name: string
  matches: BracketSlotMatch[]
}
```

- [ ] **Step 4: Implement the parser**

In `lib/scraper.ts`, add `BracketRound` and `BracketSlotMatch` to the existing `import type { … } from './types'` line. Then add, directly after the closing brace of `feedersFrom`:

```ts
const BRACKET_SEED_RE = /\s*\[([^\]]+)\]\s*$/

// One bracket .match as a position-keeping slot: both rows are kept even when
// empty, because the row index says which feeder match fills it. Only linked
// players count, so the "Bye" row of a bye comes out empty.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function slotMatchFrom($: cheerio.CheerioAPI, matchEl: any): BracketSlotMatch {
  const ex = extractMatchEntry($, matchEl)
  const teams: [MatchPlayer[], MatchPlayer[]] = [[], []]
  const seeds: [string | undefined, string | undefined] = [undefined, undefined]

  $(matchEl).find('.match__row').each((ri, row) => {
    if (ri > 1) return
    $(row).find('.match__row-title-value').each((_, tv) => {
      const a = $(tv).find('a').first()
      const idMatch = (a.attr('href') ?? '').match(/player=(\d+)/)
      if (!idMatch) return
      const raw = playerText(a)
      const seed = raw.match(BRACKET_SEED_RE)
      if (seed && !seeds[ri]) seeds[ri] = seed[1].trim()
      const name = raw.replace(BRACKET_SEED_RE, '').trim()
      if (name) teams[ri].push({ name, playerId: idMatch[1] })
    })
  })

  const schedule = extractMatchSchedule($, matchEl)
  const court = $(matchEl).find('.match__footer-list-item')
    .filter((_, li) => $(li).find('.icon-marker').length > 0)
    .first().find('.nav-link__value').text().trim()

  return {
    teams,
    seeds,
    winner: ex.winner,
    scores: ex.scores,
    walkover: ex.walkover,
    retired: ex.retired,
    ...(schedule?.time && { time: schedule.time }),
    ...(schedule?.date && { date: schedule.date }),
    ...(court && { court }),
  }
}

// Every round of a knockout bracket, each as its matches in page order.
// Position is the relationship between rounds: match `i` of round `r` is fed
// by matches `2i` (its first row) and `2i + 1` (its second row) of round
// `r - 1` — the same index rule parseBracketFeeders relies on. Unlike the
// feeder walk, this keeps slots nobody has reached yet, which is what a
// player's path to the final is made of.
export function parseBracketRounds(html: string): BracketRound[] {
  const $ = cheerio.load(html, { xmlMode: false })
  const bracket = $('.bracket.js-bracket')
  if (!bracket.length) return []

  const roundNames = bracket.find('.subheading').map((_, el) => $(el).text().trim()).get()
  const rounds: BracketRound[] = []
  bracket.find('swiper-container > swiper-slide').each((slideIdx, slide) => {
    const matchEls = $(slide).find('.bracket-round__match-group-wrapper .match')
    if (matchEls.length === 0) return
    const matches: BracketSlotMatch[] = []
    matchEls.each((_, m) => { matches.push(slotMatchFrom($, m)) })
    rounds.push({ name: roundNames[slideIdx] ?? '', matches })
  })
  return rounds
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest __tests__/parseBracketRounds.test.ts`
Expected: PASS, 9 tests.

If "reads doubles teams and their scores" fails on `scores`, print `rounds[0].matches[0]` and compare with `extractMatchEntry`'s score parsing (`.match__result ul.points li`); the bracket fixture is the source of truth, fix the parser, not the test.

- [ ] **Step 6: Run the existing scraper tests**

Run: `npx jest __tests__/scraper.test.ts __tests__/parseBracketFeeders.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/scraper.ts __tests__/parseBracketRounds.test.ts
git commit -m "feat(path): parse a bracket into position-indexed rounds"
```

---

### Task 2: `buildBracketPath`

**Files:**
- Create: `lib/bracketPath.ts`
- Test: `__tests__/bracketPath.test.ts`

**Interfaces:**
- Consumes: `BracketRound`, `BracketSlotMatch`, `MatchPlayer`, `MatchScore` from `@/lib/types` (Task 1).
- Produces:
  ```ts
  export interface PathTeam { team: MatchPlayer[]; seed?: string }
  export interface PathRound {
    round: string
    status: 'won' | 'lost' | 'next' | 'future' | 'bye'
    opponent?: MatchPlayer[]
    opponentSeed?: string
    scores?: MatchScore[]
    walkover?: boolean
    retired?: boolean
    time?: string
    date?: string
    court?: string
    candidates?: PathTeam[]
  }
  export interface BracketPath {
    team: MatchPlayer[]
    seed?: string
    eliminated: boolean
    champion: boolean
    rounds: PathRound[]
  }
  export function buildBracketPath(rounds: BracketRound[], playerId: string): BracketPath | null
  ```
  `scores` on a `won` or `lost` row are from the player's point of view: `t1` is the player's side.

- [ ] **Step 1: Write the failing test**

Create `__tests__/bracketPath.test.ts`:

```ts
import { buildBracketPath } from '@/lib/bracketPath'
import type { BracketRound, BracketSlotMatch, MatchPlayer } from '@/lib/types'

const P = (id: string): MatchPlayer => ({ name: `P${id}`, playerId: id })

function m(
  a: string[],
  b: string[],
  winner: 1 | 2 | null = null,
  extra: Partial<BracketSlotMatch> = {},
): BracketSlotMatch {
  return {
    teams: [a.map(P), b.map(P)],
    seeds: [undefined, undefined],
    winner,
    // Row 0 is t1, so the winning row holds the 21s.
    scores: !winner || a.length === 0 || b.length === 0
      ? []
      : winner === 1
        ? [{ t1: 21, t2: 10 }, { t1: 21, t2: 12 }]
        : [{ t1: 10, t2: 21 }, { t1: 12, t2: 21 }],
    walkover: false,
    retired: false,
    ...extra,
  }
}

const E = () => m([], [])

/** An 8-player draw: quarter finals, semi finals, final. */
function draw(qf: BracketSlotMatch[], sf: BracketSlotMatch[] = [E(), E()], f: BracketSlotMatch[] = [E()]): BracketRound[] {
  return [
    { name: 'Quarter final', matches: qf },
    { name: 'Semi final', matches: sf },
    { name: 'Final', matches: f },
  ]
}

const ids = (teams: Array<{ team: MatchPlayer[] }> | undefined) =>
  (teams ?? []).map((t) => t.team.map((p) => p.playerId).join('+'))

const FRESH = () => [m(['1'], ['2']), m(['3'], ['4']), m(['5'], ['6']), m(['7'], ['8'])]

describe('buildBracketPath', () => {
  it('returns null for a player who is not in the bracket', () => {
    expect(buildBracketPath(draw(FRESH()), '99')).toBeNull()
    expect(buildBracketPath(draw(FRESH()), '')).toBeNull()
    expect(buildBracketPath([], '1')).toBeNull()
  })

  it('lays out a fresh draw: next match, then candidates doubling each round', () => {
    const path = buildBracketPath(draw(FRESH()), '1')!
    expect(path.team.map((p) => p.playerId)).toEqual(['1'])
    expect(path.eliminated).toBe(false)
    expect(path.champion).toBe(false)
    expect(path.rounds.map((r) => [r.round, r.status])).toEqual([
      ['Quarter final', 'next'], ['Semi final', 'future'], ['Final', 'future'],
    ])
    expect(path.rounds[0].opponent!.map((p) => p.playerId)).toEqual(['2'])
    expect(path.rounds[0].candidates).toBeUndefined()
    expect(ids(path.rounds[1].candidates)).toEqual(['3', '4'])
    expect(ids(path.rounds[2].candidates)).toEqual(['5', '6', '7', '8'])
  })

  it('takes candidates from the other row when the player sits in the second feeder', () => {
    const path = buildBracketPath(draw(FRESH()), '4')!
    expect(path.rounds[0].opponent!.map((p) => p.playerId)).toEqual(['3'])
    expect(ids(path.rounds[1].candidates)).toEqual(['1', '2'])
    const p7 = buildBracketPath(draw(FRESH()), '7')!
    expect(ids(p7.rounds[2].candidates)).toEqual(['1', '2', '3', '4'])
  })

  it('reads a first-round bye', () => {
    const qf = [m(['1'], [], 1), m(['3'], ['4']), m(['5'], ['6']), m(['7'], ['8'])]
    const path = buildBracketPath(draw(qf, [m(['1'], []), E()]), '1')!
    expect(path.rounds[0]).toEqual({ round: 'Quarter final', status: 'bye' })
    expect(path.rounds[1].status).toBe('next')
    expect(path.rounds[1].opponent).toBeUndefined()
    expect(ids(path.rounds[1].candidates)).toEqual(['3', '4'])
  })

  it('shows a played round, then the known next opponent', () => {
    const qf = [m(['1'], ['2'], 1), m(['3'], ['4'], 2), m(['5'], ['6']), m(['7'], ['8'])]
    const sf = [m(['1'], ['4'], null, { time: '14:30', date: '20/6/2569', court: 'Court 3' }), E()]
    const path = buildBracketPath(draw(qf, sf), '1')!
    expect(path.rounds[0].status).toBe('won')
    expect(path.rounds[0].opponent!.map((p) => p.playerId)).toEqual(['2'])
    expect(path.rounds[0].scores).toEqual([{ t1: 21, t2: 10 }, { t1: 21, t2: 12 }])
    expect(path.rounds[1]).toMatchObject({ status: 'next', time: '14:30', date: '20/6/2569', court: 'Court 3' })
    expect(path.rounds[1].opponent!.map((p) => p.playerId)).toEqual(['4'])
    expect(path.rounds[2].status).toBe('future')
  })

  it('turns scores to the player\'s point of view', () => {
    const qf = [m(['2'], ['1'], 2, { scores: [{ t1: 10, t2: 21 }, { t1: 12, t2: 21 }] }), m(['3'], ['4']), m(['5'], ['6']), m(['7'], ['8'])]
    const path = buildBracketPath(draw(qf), '1')!
    expect(path.rounds[0].status).toBe('won')
    expect(path.rounds[0].scores).toEqual([{ t1: 21, t2: 10 }, { t1: 21, t2: 12 }])
  })

  it('treats the round after a win as next even when the bracket has not placed the player yet', () => {
    const qf = [m(['1'], ['2'], 1), m(['3'], ['4']), m(['5'], ['6']), m(['7'], ['8'])]
    const path = buildBracketPath(draw(qf), '1')!
    expect(path.rounds.map((r) => r.status)).toEqual(['won', 'next', 'future'])
    expect(ids(path.rounds[1].candidates)).toEqual(['3', '4'])
  })

  it('never lists a team that has already lost', () => {
    const qf = [m(['1'], ['2']), m(['3'], ['4'], 1), m(['5'], ['6'], 2), m(['7'], ['8'])]
    const path = buildBracketPath(draw(qf), '1')!
    expect(ids(path.rounds[1].candidates)).toEqual(['3'])
    expect(ids(path.rounds[2].candidates)).toEqual(['6', '7', '8'])
  })

  it('stops at the round the player lost', () => {
    const qf = [m(['1'], ['2'], 2), m(['3'], ['4']), m(['5'], ['6']), m(['7'], ['8'])]
    const path = buildBracketPath(draw(qf, [m(['2'], []), E()]), '1')!
    expect(path.eliminated).toBe(true)
    expect(path.rounds).toHaveLength(1)
    expect(path.rounds[0].status).toBe('lost')
    expect(path.rounds[0].scores).toEqual([{ t1: 10, t2: 21 }, { t1: 12, t2: 21 }])
  })

  it('marks the champion', () => {
    const qf = [m(['1'], ['2'], 1), m(['3'], ['4'], 1), m(['5'], ['6'], 1), m(['7'], ['8'], 1)]
    const sf = [m(['1'], ['3'], 1), m(['5'], ['7'], 2)]
    const path = buildBracketPath(draw(qf, sf, [m(['1'], ['7'], 1)]), '1')!
    expect(path.champion).toBe(true)
    expect(path.eliminated).toBe(false)
    expect(path.rounds.map((r) => r.status)).toEqual(['won', 'won', 'won'])
  })

  it('carries walkover and retirement flags', () => {
    const qf = [m(['1'], ['2'], 1, { walkover: true, scores: [] }), m(['3'], ['4']), m(['5'], ['6']), m(['7'], ['8'])]
    const path = buildBracketPath(draw(qf), '1')!
    expect(path.rounds[0]).toMatchObject({ status: 'won', walkover: true, retired: false })
  })

  it('finds a doubles pair by either partner', () => {
    const qf = [m(['1', '9'], ['2', '8']), m(['3'], ['4']), m(['5'], ['6']), m(['7'], ['8'])]
    for (const id of ['1', '9']) {
      const path = buildBracketPath(draw(qf), id)!
      expect(path.team.map((p) => p.playerId)).toEqual(['1', '9'])
      expect(path.rounds[0].opponent!.map((p) => p.playerId)).toEqual(['2', '8'])
    }
  })

  it('carries seeds onto the player, the opponent and the candidates', () => {
    const qf = [
      m(['1'], ['2'], null, { seeds: ['1', undefined] }),
      m(['3'], ['4'], null, { seeds: [undefined, '3/4'] }),
      m(['5'], ['6']), m(['7'], ['8'], null, { seeds: [undefined, '2'] }),
    ]
    const p1 = buildBracketPath(draw(qf), '1')!
    expect(p1.seed).toBe('1')
    expect(p1.rounds[1].candidates).toEqual([{ team: [P('3')] }, { team: [P('4')], seed: '3/4' }])
    const p2 = buildBracketPath(draw(qf), '2')!
    expect(p2.seed).toBeUndefined()
    expect(p2.rounds[0].opponentSeed).toBe('1')
  })

  it('calls a round a bye when nobody can come through the other side', () => {
    const qf = [m(['1'], ['2']), E(), m(['5'], ['6']), m(['7'], ['8'])]
    const path = buildBracketPath(draw(qf), '1')!
    expect(path.rounds[1]).toEqual({ round: 'Semi final', status: 'bye' })
    expect(path.rounds[2].status).toBe('future')
  })

  it('lists a team already placed in a later round as the only candidate', () => {
    const qf = [m(['1'], ['2']), m(['3'], [], 1), m(['5'], ['6']), m(['7'], ['8'])]
    const path = buildBracketPath(draw(qf, [m([], ['3']), E()]), '1')!
    expect(path.rounds[1].status).toBe('future')
    expect(ids(path.rounds[1].candidates)).toEqual(['3'])
  })

  it('does not throw on a bracket with a round that is too short', () => {
    const rounds: BracketRound[] = [
      { name: 'Quarter final', matches: [m(['1'], ['2']), m(['3'], ['4']), m(['5'], ['6'])] },
      { name: 'Semi final', matches: [E(), E()] },
      { name: 'Final', matches: [E()] },
    ]
    const path = buildBracketPath(rounds, '1')!
    expect(ids(path.rounds[2].candidates)).toEqual(['5', '6'])
    const short: BracketRound[] = [
      { name: 'Quarter final', matches: FRESH() },
      { name: 'Semi final', matches: [E()] },
      { name: 'Final', matches: [E()] },
    ]
    expect(() => buildBracketPath(short, '7')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/bracketPath.test.ts`
Expected: FAIL — cannot find module `@/lib/bracketPath`.

- [ ] **Step 3: Implement the walker**

Create `lib/bracketPath.ts`:

```ts
import type { BracketRound, MatchPlayer, MatchScore } from './types'

export interface PathTeam {
  team: MatchPlayer[]
  seed?: string
}

export interface PathRound {
  round: string
  status: 'won' | 'lost' | 'next' | 'future' | 'bye'
  /** The opponent, when the bracket already names one. */
  opponent?: MatchPlayer[]
  opponentSeed?: string
  /** From the player's point of view: `t1` is the player's side. */
  scores?: MatchScore[]
  walkover?: boolean
  retired?: boolean
  time?: string
  date?: string
  court?: string
  /** Everyone who can still fill the opposing row, when it is not decided. */
  candidates?: PathTeam[]
}

export interface BracketPath {
  /** The player, with their partner in doubles, as the bracket lists them. */
  team: MatchPlayer[]
  seed?: string
  eliminated: boolean
  champion: boolean
  rounds: PathRound[]
}

type Side = 0 | 1

const holds = (team: MatchPlayer[], playerId: string) => team.some((p) => p.playerId === playerId)

const teamOf = (team: MatchPlayer[], seed: string | undefined): PathTeam =>
  seed ? { team, seed } : { team }

/** The teams that can still occupy row `side` of match `i` in round `r`.
 *  A row already filled is that team. Otherwise the answer comes from the
 *  feeder match `2i + side` of the round before: its winner if it is decided,
 *  or else whoever can still fill either of its rows. A team that has lost is
 *  never returned, because a decided feeder only ever yields its winner. */
function possibleFrom(rounds: BracketRound[], r: number, i: number, side: Side): PathTeam[] {
  const match = rounds[r]?.matches[i]
  if (!match) return []
  if (match.teams[side].length > 0) return [teamOf(match.teams[side], match.seeds[side])]
  if (r === 0) return []

  const feederIdx = 2 * i + side
  const feeder = rounds[r - 1].matches[feederIdx]
  if (!feeder) return []
  if (feeder.winner !== null) {
    const w = (feeder.winner - 1) as Side
    return feeder.teams[w].length > 0 ? [teamOf(feeder.teams[w], feeder.seeds[w])] : []
  }
  return [
    ...possibleFrom(rounds, r - 1, feederIdx, 0),
    ...possibleFrom(rounds, r - 1, feederIdx, 1),
  ]
}

/** One player's route through a knockout bracket, from the round they enter
 *  to the final. Null when the player is not in the bracket. */
export function buildBracketPath(rounds: BracketRound[], playerId: string): BracketPath | null {
  if (!playerId) return null

  let r = -1
  let i = -1
  let side: Side = 0
  search: for (let ri = 0; ri < rounds.length; ri++) {
    const matches = rounds[ri].matches
    for (let mi = 0; mi < matches.length; mi++) {
      for (const s of [0, 1] as Side[]) {
        if (holds(matches[mi].teams[s], playerId)) { r = ri; i = mi; side = s; break search }
      }
    }
  }
  if (r < 0) return null

  const entry = rounds[r].matches[i]
  const team = entry.teams[side]
  const seed = entry.seeds[side]
  const out: PathRound[] = []
  let eliminated = false
  let champion = false
  // Once one round is still to be played, every round after it is further off.
  let pending = false

  for (; r < rounds.length; r++) {
    const match = rounds[r].matches[i]
    if (!match) break
    const round = rounds[r].name
    const placed: Side | null = holds(match.teams[0], playerId) ? 0 : holds(match.teams[1], playerId) ? 1 : null
    const mine: Side = placed ?? side
    const other = (1 - mine) as Side
    const schedule = {
      ...(match.time && { time: match.time }),
      ...(match.date && { date: match.date }),
      ...(match.court && { court: match.court }),
    }

    if (placed !== null && match.winner !== null) {
      const won = match.winner - 1 === mine
      if (won && match.teams[other].length === 0) {
        out.push({ round, status: 'bye' })
      } else {
        out.push({
          round,
          status: won ? 'won' : 'lost',
          opponent: match.teams[other],
          ...(match.seeds[other] && { opponentSeed: match.seeds[other] }),
          scores: mine === 0 ? match.scores : match.scores.map((s) => ({ t1: s.t2, t2: s.t1 })),
          walkover: match.walkover,
          retired: match.retired,
          ...schedule,
        })
      }
      if (!won) { eliminated = true; break }
      if (r === rounds.length - 1) champion = true
    } else {
      const candidates = possibleFrom(rounds, r, i, other)
      if (candidates.length === 0) {
        out.push({ round, status: 'bye' })
      } else if (!pending && match.teams[other].length > 0) {
        out.push({
          round,
          status: 'next',
          opponent: match.teams[other],
          ...(match.seeds[other] && { opponentSeed: match.seeds[other] }),
          ...schedule,
        })
        pending = true
      } else {
        out.push({ round, status: pending ? 'future' : 'next', candidates, ...schedule })
        pending = true
      }
    }

    side = (i % 2) as Side
    i = Math.floor(i / 2)
  }

  return { team, ...(seed && { seed }), eliminated, champion, rounds: out }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/bracketPath.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Check the walker against a real bracket**

Add this test to the end of the `describe` in `__tests__/bracketPath.test.ts`, with these imports at the top of the file:

```ts
import fs from 'fs'
import nodePath from 'path'
import { parseBracketRounds } from '@/lib/scraper'
```

```ts
  it('walks a real 128-draw from a seeded player with a first-round bye', () => {
    const html = fs.readFileSync(nodePath.join(process.cwd(), 'fixtures', 'bracket-bat-ysb-bsu13.html'), 'utf-8')
    const path = buildBracketPath(parseBracketRounds(html), '3417')!
    expect(path.seed).toBe('2')
    expect(path.rounds.map((r) => r.round)).toEqual([
      'Round of 128', 'Round of 64', 'Round of 32', 'Round of 16',
      'Quarter final', 'Semi final', 'Final',
    ])
    expect(path.rounds[0].status).toBe('bye')
    expect(path.rounds[1].status).toBe('next')
    expect(path.rounds[1].candidates!.length).toBe(2)
    expect(path.rounds.slice(2).every((r) => r.status === 'future')).toBe(true)
    // The far half of a 128-draw: 64 slots less the byes.
    const final = path.rounds[6].candidates!
    expect(final.length).toBeGreaterThan(32)
    expect(final.length).toBeLessThanOrEqual(64)
    expect(final.some((c) => c.seed === '1')).toBe(true)
    expect(final.some((c) => c.team.some((p) => p.playerId === '3417'))).toBe(false)
  })
```

Run: `npx jest __tests__/bracketPath.test.ts`
Expected: PASS, 17 tests. If `rounds[1].candidates.length` is 1, the seeded player's Round of 64 opponent comes from a decided or bye feeder; change that one assertion to `toBeGreaterThanOrEqual(1)` and leave the rest.

- [ ] **Step 6: Commit**

```bash
git add lib/bracketPath.ts __tests__/bracketPath.test.ts
git commit -m "feat(path): walk a bracket into one player's route to the final"
```

---

### Task 3: Ranking, record and favourite helpers

**Files:**
- Create: `lib/pathEnrich.ts`
- Test: `__tests__/pathEnrich.test.ts`

**Interfaces:**
- Consumes: `PathRound`, `PathTeam` from `@/lib/bracketPath` (Task 2); `nameToSlug` from `@/lib/playerIndex`; `PlayerIndex`, `Ranking`, `MatchPlayer` from `@/lib/types`.
- Produces:
  ```ts
  export interface PathRecord { wins: number; losses: number }
  export interface PathCandidate {
    team: MatchPlayer[]
    seed?: string
    rank?: number
    record: PathRecord | null
    favourite: boolean
  }
  export interface PathRoundOut extends Omit<PathRound, 'candidates'> {
    record?: PathRecord | null
    candidates?: PathCandidate[]
  }
  export interface PathResponse {
    team: MatchPlayer[]
    seed?: string
    eliminated: boolean
    champion: boolean
    rounds: PathRoundOut[]
    stale: boolean
  }
  export function rankingEventCodeForDraw(drawName: string): string | null
  export function teamRank(ranking: Ranking | null, eventCode: string, team: MatchPlayer[]): number | undefined
  export function pairRecord(index: PlayerIndex | null, team: MatchPlayer[], opponent: MatchPlayer[]): PathRecord | null
  export function seedNumber(seed: string | undefined): number | undefined
  export function rankCandidates(candidates: Array<Omit<PathCandidate, 'favourite'>>): PathCandidate[]
  ```

- [ ] **Step 1: Write the failing test**

Create `__tests__/pathEnrich.test.ts`:

```ts
import {
  rankingEventCodeForDraw, teamRank, pairRecord, seedNumber, rankCandidates,
} from '@/lib/pathEnrich'
import { nameToSlug } from '@/lib/playerIndex'
import type { MatchPlayer, PlayerIndex, PlayerTournamentMatch, Ranking } from '@/lib/types'

const P = (name: string, playerId = '1'): MatchPlayer => ({ name, playerId })

describe('rankingEventCodeForDraw', () => {
  it.each([
    ['BS U15', 'U15_MS'], ['GS U13', 'U13_WS'], ['BD U17', 'U17_MD'],
    ['GD U11', 'U11_WD'], ['XD U15', 'U15_MXD'], ['bs u9', 'U9_MS'],
    ['MS', 'MS'], ['WS', 'WS'], ['MD', 'MD'], ['WD', 'WD'], ['XD', 'MXD'],
    ['  BS U15  ', 'U15_MS'], ['BS U15 (Main Draw)', 'U15_MS'],
  ])('%s -> %s', (draw, code) => {
    expect(rankingEventCodeForDraw(draw)).toBe(code)
  })

  it.each(['BS', 'GD', 'Team Event', 'BS U15 - Group A', ''])('%s has no ranking event', (draw) => {
    expect(rankingEventCodeForDraw(draw)).toBeNull()
  })
})

function ranking(): Ranking {
  const row = (rank: number, names: string[]) => ({
    rank, name: names[0], slug: nameToSlug(names[0]), club: '', points: 0, tournaments: 0,
    ...(names.length > 1 && { players: names.map((n) => ({ name: n, slug: nameToSlug(n) })) }),
  })
  return {
    provider: 'bat', scrapedAt: '', publishDate: '', rankingId: '',
    events: [
      { eventCode: 'U15_MS', eventName: 'U15 Boys singles', entries: [row(1, ['Anan Dee']), row(7, ['Somchai Jai'])] },
      { eventCode: 'U15_MD', eventName: 'U15 Boys doubles', entries: [row(3, ['Anan Dee', 'Somchai Jai']), row(9, ['Anan Dee', 'Krit Wong'])] },
    ],
  } as unknown as Ranking
}

describe('teamRank', () => {
  it('finds a singles player by name', () => {
    expect(teamRank(ranking(), 'U15_MS', [P('Somchai Jai')])).toBe(7)
  })
  it('matches a name however it is cased or spaced', () => {
    expect(teamRank(ranking(), 'U15_MS', [P('  somchai   JAI ')])).toBe(7)
  })
  it('finds a pair in either order, and only that pair', () => {
    expect(teamRank(ranking(), 'U15_MD', [P('Somchai Jai'), P('Anan Dee')])).toBe(3)
    expect(teamRank(ranking(), 'U15_MD', [P('Anan Dee'), P('Krit Wong')])).toBe(9)
    expect(teamRank(ranking(), 'U15_MD', [P('Somchai Jai'), P('Krit Wong')])).toBeUndefined()
  })
  it('is undefined for an unknown event, an unranked player or no ranking', () => {
    expect(teamRank(ranking(), 'U19_MS', [P('Anan Dee')])).toBeUndefined()
    expect(teamRank(ranking(), 'U15_MS', [P('Nobody Here')])).toBeUndefined()
    expect(teamRank(null, 'U15_MS', [P('Anan Dee')])).toBeUndefined()
  })
})

function index(players: Record<string, PlayerTournamentMatch[] | null>): PlayerIndex {
  const out: Record<string, unknown> = {}
  for (const [name, matches] of Object.entries(players)) {
    out[nameToSlug(name)] = matches === null ? {} : { tournamentMatches: { 't1:e1': matches } }
  }
  return { players: out } as unknown as PlayerIndex
}

const tm = (opponents: string[], outcome: PlayerTournamentMatch['outcome'], partners: string[] = []): PlayerTournamentMatch =>
  ({ round: 'QF', partners, opponents, scores: [], outcome })

describe('pairRecord', () => {
  it('counts singles meetings', () => {
    const idx = index({ 'Anan Dee': [tm(['Somchai Jai'], 'W'), tm(['Somchai Jai'], 'L'), tm(['Somchai Jai'], 'W'), tm(['Krit Wong'], 'L')] })
    expect(pairRecord(idx, [P('Anan Dee')], [P('Somchai Jai')])).toEqual({ wins: 2, losses: 1 })
  })

  it('counts walkovers and retirements on the side they fell', () => {
    const idx = index({ 'Anan Dee': [tm(['Somchai Jai'], 'WO-W'), tm(['Somchai Jai'], 'RET-W'), tm(['Somchai Jai'], 'WO-L'), tm(['Somchai Jai'], 'RET-L')] })
    expect(pairRecord(idx, [P('Anan Dee')], [P('Somchai Jai')])).toEqual({ wins: 2, losses: 2 })
  })

  it('answers 0-0 for a known player who has never met the opponent', () => {
    const idx = index({ 'Anan Dee': [tm(['Krit Wong'], 'W')] })
    expect(pairRecord(idx, [P('Anan Dee')], [P('Somchai Jai')])).toEqual({ wins: 0, losses: 0 })
  })

  it('answers null when there is nothing to count from', () => {
    expect(pairRecord(null, [P('Anan Dee')], [P('Somchai Jai')])).toBeNull()
    expect(pairRecord(index({}), [P('Anan Dee')], [P('Somchai Jai')])).toBeNull()
    expect(pairRecord(index({ 'Anan Dee': null }), [P('Anan Dee')], [P('Somchai Jai')])).toBeNull()
    expect(pairRecord(index({ 'Anan Dee': [] }), [], [P('Somchai Jai')])).toBeNull()
  })

  it('counts doubles only between the same two pairs', () => {
    const idx = index({
      'Anan Dee': [
        tm(['Krit Wong', 'Pim Suk'], 'W', ['Somchai Jai']),
        tm(['Pim Suk', 'Krit Wong'], 'L', ['Somchai Jai']),
        tm(['Krit Wong', 'Pim Suk'], 'W', ['Other Partner']),
        tm(['Krit Wong', 'Someone Else'], 'W', ['Somchai Jai']),
      ],
    })
    expect(pairRecord(idx, [P('Anan Dee'), P('Somchai Jai')], [P('Krit Wong'), P('Pim Suk')]))
      .toEqual({ wins: 1, losses: 1 })
  })

  it('does not count a singles meeting towards a doubles record', () => {
    const idx = index({ 'Anan Dee': [tm(['Krit Wong'], 'W')] })
    expect(pairRecord(idx, [P('Anan Dee'), P('Somchai Jai')], [P('Krit Wong'), P('Pim Suk')]))
      .toEqual({ wins: 0, losses: 0 })
  })

  it('uses the partner\'s history when the first-named player has none', () => {
    const idx = index({ 'Somchai Jai': [tm(['Krit Wong', 'Pim Suk'], 'W', ['Anan Dee'])] })
    expect(pairRecord(idx, [P('Anan Dee'), P('Somchai Jai')], [P('Krit Wong'), P('Pim Suk')]))
      .toEqual({ wins: 1, losses: 0 })
  })

  it('matches names stored with a seed mark', () => {
    const idx = index({ 'Anan Dee': [tm(['Somchai Jai [2]'], 'W'), tm(['[3/4] Somchai Jai'], 'L')] })
    expect(pairRecord(idx, [P('Anan Dee [1]')], [P('Somchai Jai')])).toEqual({ wins: 1, losses: 1 })
  })
})

describe('seedNumber', () => {
  it('reads the leading number', () => {
    expect(seedNumber('2')).toBe(2)
    expect(seedNumber('3/4')).toBe(3)
    expect(seedNumber(' 5-8 ')).toBe(5)
  })
  it('is undefined when there is none', () => {
    expect(seedNumber(undefined)).toBeUndefined()
    expect(seedNumber('')).toBeUndefined()
    expect(seedNumber('WC')).toBeUndefined()
  })
})

describe('rankCandidates', () => {
  const c = (name: string, seed?: string, rank?: number) => ({
    team: [P(name)], record: null, ...(seed && { seed }), ...(rank !== undefined && { rank }),
  })
  const fav = (list: ReturnType<typeof rankCandidates>) => list.filter((x) => x.favourite).map((x) => x.team[0].name)
  const order = (list: ReturnType<typeof rankCandidates>) => list.map((x) => x.team[0].name)

  it('returns [] for no candidates', () => {
    expect(rankCandidates([])).toEqual([])
  })

  it('makes a lone candidate the favourite', () => {
    expect(fav(rankCandidates([c('A')]))).toEqual(['A'])
  })

  it('prefers the lowest seed over any ranking', () => {
    const out = rankCandidates([c('A', undefined, 1), c('B', '4', 50), c('C', '2', 90)])
    expect(fav(out)).toEqual(['C'])
    expect(order(out)).toEqual(['C', 'B', 'A'])
  })

  it('breaks a shared seed by ranking', () => {
    const out = rankCandidates([c('A', '3/4', 20), c('B', '3/4', 11), c('C', undefined, 1)])
    expect(fav(out)).toEqual(['B'])
    expect(order(out)).toEqual(['B', 'A', 'C'])
  })

  it('falls back to ranking when nobody is seeded', () => {
    const out = rankCandidates([c('A', undefined, 30), c('B'), c('C', undefined, 12)])
    expect(fav(out)).toEqual(['C'])
    expect(order(out)).toEqual(['C', 'A', 'B'])
  })

  it('names no favourite when seed and ranking cannot separate them', () => {
    expect(fav(rankCandidates([c('B', '3/4'), c('A', '3/4')]))).toEqual([])
    expect(fav(rankCandidates([c('B', '3/4', 9), c('A', '3/4', 9)]))).toEqual([])
    expect(fav(rankCandidates([c('B'), c('A')]))).toEqual([])
  })

  it('sorts the rest by seed, then ranking, then name', () => {
    const out = rankCandidates([c('Zed'), c('Amy'), c('Bob', undefined, 40), c('Cat', '5'), c('Dan', '1')])
    expect(order(out)).toEqual(['Dan', 'Cat', 'Bob', 'Amy', 'Zed'])
  })

  it('keeps every field it was given', () => {
    const out = rankCandidates([{ team: [P('A')], seed: '1', rank: 4, record: { wins: 2, losses: 1 } }])
    expect(out[0]).toEqual({ team: [P('A')], seed: '1', rank: 4, record: { wins: 2, losses: 1 }, favourite: true })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/pathEnrich.test.ts`
Expected: FAIL — cannot find module `@/lib/pathEnrich`.

- [ ] **Step 3: Implement the helpers**

Create `lib/pathEnrich.ts`:

```ts
import type { MatchPlayer, PlayerIndex, Ranking } from './types'
import type { PathRound } from './bracketPath'
import { nameToSlug } from './playerIndex'

export interface PathRecord {
  wins: number
  losses: number
}

export interface PathCandidate {
  team: MatchPlayer[]
  seed?: string
  rank?: number
  /** Null when there is no history to count from; 0–0 is a real answer. */
  record: PathRecord | null
  favourite: boolean
}

export interface PathRoundOut extends Omit<PathRound, 'candidates'> {
  /** Past record against a known next opponent. */
  record?: PathRecord | null
  candidates?: PathCandidate[]
}

export interface PathResponse {
  team: MatchPlayer[]
  seed?: string
  eliminated: boolean
  champion: boolean
  rounds: PathRoundOut[]
  /** The bracket this was built from is past its refresh time. */
  stale: boolean
}

const DRAW_RE = /^(BS|GS|BD|GD|XD|MS|WS|MD|WD)(?:\s+U\s*(\d+))?$/i
const DISCIPLINE: Record<string, string> = {
  BS: 'MS', GS: 'WS', BD: 'MD', GD: 'WD', XD: 'MXD', MS: 'MS', WS: 'WS', MD: 'MD', WD: 'WD',
}
// Boys'/girls' draws exist only by age group; without one there is no
// ranking event to point at.
const JUNIOR_ONLY = new Set(['BS', 'GS', 'BD', 'GD'])

/** The BAT ranking event a draw's players are ranked in: "BS U15" → "U15_MS",
 *  "XD" → "MXD". Null for a draw with no ranking of its own. */
export function rankingEventCodeForDraw(drawName: string): string | null {
  const m = drawName.replace(/\s*\([^)]*\)\s*$/, '').trim().match(DRAW_RE)
  if (!m) return null
  const kind = m[1].toUpperCase()
  const age = m[2]
  if (!age) return JUNIOR_ONLY.has(kind) ? null : DISCIPLINE[kind]
  return `U${age}_${DISCIPLINE[kind]}`
}

/** An order-free key for a set of names. nameToSlug drops seed marks and
 *  folds case and spacing, so the bracket, the index and the ranking agree. */
function slugKey(names: string[]): string {
  return names.map((n) => nameToSlug(n)).filter(Boolean).sort().join('|')
}

/** The team's position in a ranking event: the row naming exactly these
 *  players. Undefined when the event or the row is not there. */
export function teamRank(ranking: Ranking | null, eventCode: string, team: MatchPlayer[]): number | undefined {
  const ev = ranking?.events.find((e) => e.eventCode === eventCode)
  if (!ev) return undefined
  const want = slugKey(team.map((p) => p.name))
  if (!want) return undefined
  const row = ev.entries.find((e) => {
    const members = e.players && e.players.length > 0 ? e.players.map((p) => p.name) : [e.name]
    return slugKey(members) === want
  })
  return row?.rank
}

/** Past meetings between two teams, from the matches the player index holds.
 *  In doubles both pairs must be the same two players. */
export function pairRecord(
  index: PlayerIndex | null,
  team: MatchPlayer[],
  opponent: MatchPlayer[],
): PathRecord | null {
  if (!index || team.length === 0 || opponent.length === 0) return null
  // Either partner's history holds the pair's matches; use whoever has one.
  const self = team.find((p) => index.players[nameToSlug(p.name)]?.tournamentMatches)
  if (!self) return null
  const matches = index.players[nameToSlug(self.name)].tournamentMatches!

  const partners = slugKey(team.filter((p) => p !== self).map((p) => p.name))
  const opp = slugKey(opponent.map((p) => p.name))
  let wins = 0
  let losses = 0
  for (const list of Object.values(matches)) {
    for (const m of list) {
      if (slugKey(m.opponents) !== opp) continue
      if (slugKey(m.partners) !== partners) continue
      if (m.outcome === 'W' || m.outcome === 'WO-W' || m.outcome === 'RET-W') wins++
      else losses++
    }
  }
  return { wins, losses }
}

/** The number a seed sorts by: "3/4" → 3. */
export function seedNumber(seed: string | undefined): number | undefined {
  const n = parseInt((seed ?? '').trim(), 10)
  return Number.isNaN(n) ? undefined : n
}

type Unranked = Omit<PathCandidate, 'favourite'>

/** Index of the favourite: the lowest seed; a shared lowest seed, or no seeds
 *  at all, is settled by ranking position; -1 when nothing separates them. */
function favouriteIndex(c: Unranked[]): number {
  if (c.length === 0) return -1
  if (c.length === 1) return 0
  const seeds = c.map((x) => seedNumber(x.seed))
  const known = seeds.filter((s): s is number => s !== undefined)
  const all = c.map((_, i) => i)
  const pool = known.length > 0 ? all.filter((i) => seeds[i] === Math.min(...known)) : all
  if (pool.length === 1) return pool[0]

  const ranked = pool.filter((i) => c[i].rank !== undefined)
  if (ranked.length === 0) return -1
  const best = Math.min(...ranked.map((i) => c[i].rank!))
  const top = ranked.filter((i) => c[i].rank === best)
  return top.length === 1 ? top[0] : -1
}

/** Marks the favourite and sorts: favourite first, then by seed, ranking
 *  position and name, with the unseeded and unranked last. */
export function rankCandidates(candidates: Unranked[]): PathCandidate[] {
  const fav = favouriteIndex(candidates)
  const far = Number.POSITIVE_INFINITY
  return candidates
    .map((c, i) => ({ ...c, favourite: i === fav }))
    .sort((a, b) =>
      Number(b.favourite) - Number(a.favourite) ||
      (seedNumber(a.seed) ?? far) - (seedNumber(b.seed) ?? far) ||
      (a.rank ?? far) - (b.rank ?? far) ||
      (a.team[0]?.name ?? '').localeCompare(b.team[0]?.name ?? ''))
}
```

Note on the sort: `Infinity - Infinity` is `NaN`, and `NaN || x` falls through to `x`, which is the wanted behaviour when both sides lack a seed or a rank.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/pathEnrich.test.ts`
Expected: PASS.

- [ ] **Step 5: Check the draw-name mapping against the real ranking cache**

This settles the spec's open point. Run:

```bash
node -e "
const r=require('./.cache/players/ranking-bat.json');
console.log(r.events.map(e=>e.eventCode).join(' '))"
```

Expected: codes of the form `MS WS MD WD MXD U19_MS … U9_WD`. If the file is absent on this machine, skip this step. If the codes have a different shape, change `rankingEventCodeForDraw` and its test table to produce the printed codes, and say so in the commit message.

- [ ] **Step 6: Commit**

```bash
git add lib/pathEnrich.ts __tests__/pathEnrich.test.ts
git commit -m "feat(path): rank, past record and favourite for path candidates"
```

---

### Task 4: `GET /api/path`

**Files:**
- Create: `app/api/path/route.ts`
- Test: `__tests__/api-path-route.test.ts`

**Interfaces:**
- Consumes: `parseBracketRounds` (Task 1); `buildBracketPath` (Task 2); `pairRecord`, `rankCandidates`, `rankingEventCodeForDraw`, `teamRank`, `PathResponse`, `PathRoundOut` (Task 3); from `@/lib/bracket-cache`: `cache`, `ttlMsFor`, `makeBracketKey`, `bracketHtmlForSchedule(guid, drawNum): Promise<string | undefined>`, `ensureBracketsLoaded(guid, drawNum): Promise<void>`; `readIndexCache(provider)` from `@/lib/player-index-cache`; `readRankingCache(provider)` from `@/lib/ranking/cache`; `getCachedOrDisk(id)` from `@/lib/draws-cache`; `resolveRef(guid)` from `@/lib/tournaments-registry`; `staleHeaders()` from `@/lib/stale-headers`.
- Produces: `GET /api/path?tournament=<guid>&draw=<drawNum>&player=<playerId>` → `200 PathResponse`, `400 { error }`, `404 { error }`.

Request timing and the site-request count need no code: `instrumentation.ts` installs the timer for every `/api/*` route and `routeOf` labels this one `path`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api-path-route.test.ts`:

```ts
import fs from 'fs'
import nodePath from 'path'

jest.mock('../lib/bracket-cache', () => ({
  cache: new Map(),
  ttlMsFor: () => 30 * 60_000,
  makeBracketKey: (guid: string, drawNum: string) => `${guid.toLowerCase()}:${drawNum}`,
  bracketHtmlForSchedule: jest.fn(),
  ensureBracketsLoaded: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../lib/player-index-cache', () => ({ readIndexCache: jest.fn().mockResolvedValue(null) }))
jest.mock('../lib/ranking/cache', () => ({ readRankingCache: jest.fn().mockResolvedValue(null) }))
jest.mock('../lib/draws-cache', () => ({ getCachedOrDisk: jest.fn().mockResolvedValue(undefined) }))
jest.mock('../lib/tournaments-registry', () => ({ resolveRef: jest.fn().mockReturnValue(undefined) }))
jest.mock('../lib/stale-headers', () => ({
  staleHeaders: () => ({ 'Cache-Control': 'no-store', 'X-Stale-Cache': '1' }),
}))

import { GET } from '@/app/api/path/route'
import { cache, bracketHtmlForSchedule, ensureBracketsLoaded } from '@/lib/bracket-cache'
import { readIndexCache } from '@/lib/player-index-cache'
import { readRankingCache } from '@/lib/ranking/cache'
import { getCachedOrDisk } from '@/lib/draws-cache'
import { resolveRef } from '@/lib/tournaments-registry'
import { parseBracketRounds } from '@/lib/scraper'
import { nameToSlug } from '@/lib/playerIndex'
import { seedNumber, type PathResponse } from '@/lib/pathEnrich'

const HTML = fs.readFileSync(nodePath.join(process.cwd(), 'fixtures', 'bracket-bat-bsu9.html'), 'utf-8')
const TID = 'aaaaaaaa-0000-0000-0000-000000000001'

const htmlMock = bracketHtmlForSchedule as jest.Mock
const indexMock = readIndexCache as jest.Mock
const rankingMock = readRankingCache as jest.Mock
const drawsMock = getCachedOrDisk as jest.Mock
const refMock = resolveRef as jest.Mock

// A first-round match with two players and no result yet.
const ROUNDS = parseBracketRounds(HTML)
const OPEN = ROUNDS[0].matches.find((m) => m.winner === null && m.teams[0].length > 0 && m.teams[1].length > 0)!
const PLAYER = OPEN.teams[0][0]
const OPPONENT = OPEN.teams[1][0]

const get = (qs: string) => GET(new Request(`http://x/api/path?${qs}`))
const ok = () => get(`tournament=${TID}&draw=5&player=${PLAYER.playerId}`)

beforeEach(() => {
  ;(cache as Map<string, unknown>).clear()
  htmlMock.mockReset().mockResolvedValue(HTML)
  indexMock.mockReset().mockResolvedValue(null)
  rankingMock.mockReset().mockResolvedValue(null)
  drawsMock.mockReset().mockResolvedValue(undefined)
  refMock.mockReset().mockReturnValue(undefined)
  ;(ensureBracketsLoaded as jest.Mock).mockClear()
})

describe('GET /api/path', () => {
  it('needs all three params', async () => {
    for (const qs of ['', `tournament=${TID}&draw=5`, `tournament=${TID}&player=1`, 'draw=5&player=1']) {
      expect((await get(qs)).status).toBe(400)
    }
  })

  it('is 404 for a player who is not in the draw', async () => {
    expect((await get(`tournament=${TID}&draw=5&player=999999`)).status).toBe(404)
  })

  it('is 404 when there is no bracket', async () => {
    htmlMock.mockResolvedValue(undefined)
    expect((await ok()).status).toBe(404)
  })

  it('is 404 when the bracket cannot be fetched', async () => {
    htmlMock.mockRejectedValue(new Error('HTTP 500'))
    expect((await ok()).status).toBe(404)
  })

  it('is 404 for a BWF tournament, without touching the bracket', async () => {
    refMock.mockReturnValue({ id: TID, provider: 'bwf' })
    expect((await ok()).status).toBe(404)
    expect(htmlMock).not.toHaveBeenCalled()
  })

  it('is 404 for a round-robin or grouped draw', async () => {
    drawsMock.mockResolvedValue({ draws: [{ drawNum: '5', name: 'BS U9', size: '4', type: 'Round Robin' }], ts: 0 })
    expect((await ok()).status).toBe(404)
    drawsMock.mockResolvedValue({ draws: [{ drawNum: '5', name: 'BS U9 - Group A', size: '4', type: 'Elimination', groupLetter: 'A' }], ts: 0 })
    expect((await ok()).status).toBe(404)
    expect(htmlMock).not.toHaveBeenCalled()
  })

  it('loads a finished tournament from disk before reading the bracket', async () => {
    await ok()
    expect(ensureBracketsLoaded).toHaveBeenCalledWith(TID, '5')
  })

  it('returns the route with the next opponent and ranked candidates', async () => {
    const res = await ok()
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Stale-Cache')).toBeNull()
    const body = (await res.json()) as PathResponse
    expect(body.team[0].playerId).toBe(PLAYER.playerId)
    expect(body.eliminated).toBe(false)
    expect(body.champion).toBe(false)
    expect(body.stale).toBe(false)
    expect(body.rounds.map((r) => r.round)).toEqual(ROUNDS.map((r) => r.name))

    const first = body.rounds[0]
    expect(first.status).toBe('next')
    expect(first.opponent![0].playerId).toBe(OPPONENT.playerId)
    expect(first.record).toBeNull()

    const final = body.rounds[body.rounds.length - 1]
    expect(final.status).toBe('future')
    expect(final.candidates!.length).toBeGreaterThan(4)
    // The far half of a seeded draw holds seed 1 or seed 2: that is the favourite.
    const seeds = final.candidates!.map((c) => seedNumber(c.seed)).filter((s): s is number => s !== undefined)
    expect(final.candidates![0].favourite).toBe(true)
    expect(seedNumber(final.candidates![0].seed)).toBe(Math.min(...seeds))
    expect(final.candidates!.filter((c) => c.favourite)).toHaveLength(1)
    expect(final.candidates!.every((c) => c.record === null)).toBe(true)
  })

  it('adds the past record from the player index', async () => {
    indexMock.mockResolvedValue({
      players: {
        [nameToSlug(PLAYER.name)]: {
          tournamentMatches: {
            't:e': [
              { round: 'QF', partners: [], opponents: [OPPONENT.name], scores: [], outcome: 'W' },
              { round: 'SF', partners: [], opponents: [OPPONENT.name], scores: [], outcome: 'L' },
            ],
          },
        },
      },
    })
    const body = (await (await ok()).json()) as PathResponse
    expect(body.rounds[0].record).toEqual({ wins: 1, losses: 1 })
    const final = body.rounds[body.rounds.length - 1]
    expect(final.candidates!.every((c) => c.record && c.record.wins === 0 && c.record.losses === 0)).toBe(true)
  })

  it('adds ranking positions when the draw maps to a ranking event', async () => {
    const semi = (await (await ok()).json() as PathResponse).rounds.find((r) => r.candidates && r.candidates.length >= 2)!
    const target = semi.candidates![1].team[0]
    drawsMock.mockResolvedValue({ draws: [{ drawNum: '5', name: 'BS U9', size: '32', type: 'Elimination' }], ts: 0 })
    rankingMock.mockResolvedValue({
      events: [{ eventCode: 'U9_MS', eventName: 'U9 Boys singles', entries: [{ rank: 4, name: target.name, slug: nameToSlug(target.name) }] }],
    })
    const body = (await (await ok()).json()) as PathResponse
    const all = body.rounds.flatMap((r) => r.candidates ?? [])
    const hit = all.filter((c) => c.team[0].playerId === target.playerId)
    expect(hit.length).toBeGreaterThan(0)
    for (const c of hit) expect(c.rank).toBe(4)
  })

  it('still answers when the index and ranking reads fail', async () => {
    indexMock.mockRejectedValue(new Error('ENOENT'))
    rankingMock.mockRejectedValue(new Error('ENOENT'))
    const res = await ok()
    expect(res.status).toBe(200)
    expect(((await res.json()) as PathResponse).rounds[0].record).toBeNull()
  })

  it('marks a bracket past its refresh time as stale', async () => {
    ;(cache as Map<string, unknown>).set(`${TID}:5`, { bracket: { html: '' }, ts: Date.now() - 60 * 60_000 })
    const res = await ok()
    expect(res.headers.get('X-Stale-Cache')).toBe('1')
    expect(((await res.json()) as PathResponse).stale).toBe(true)
  })

  it('does not call a fresh or finished bracket stale', async () => {
    ;(cache as Map<string, unknown>).set(`${TID}:5`, { bracket: { html: '' }, ts: Date.now() - 60_000 })
    expect(((await (await ok()).json()) as PathResponse).stale).toBe(false)
    ;(cache as Map<string, unknown>).set(`${TID}:5`, { bracket: { html: '' }, ts: 0, done: true })
    expect(((await (await ok()).json()) as PathResponse).stale).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/api-path-route.test.ts`
Expected: FAIL — cannot find module `@/app/api/path/route`.

- [ ] **Step 3: Implement the route**

Create `app/api/path/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { cache, ttlMsFor, makeBracketKey, bracketHtmlForSchedule, ensureBracketsLoaded } from '@/lib/bracket-cache'
import { parseBracketRounds } from '@/lib/scraper'
import { buildBracketPath } from '@/lib/bracketPath'
import {
  pairRecord, rankCandidates, rankingEventCodeForDraw, teamRank,
  type PathResponse, type PathRoundOut,
} from '@/lib/pathEnrich'
import { readIndexCache } from '@/lib/player-index-cache'
import { readRankingCache } from '@/lib/ranking/cache'
import { getCachedOrDisk } from '@/lib/draws-cache'
import { resolveRef } from '@/lib/tournaments-registry'
import { staleHeaders } from '@/lib/stale-headers'

export const maxDuration = 30

// One player's path to the final of a knockout draw: the rounds they have
// played, their next match, and who could stand in each round after it.
// Built from the bracket this server already holds — it asks BAT for nothing
// beyond the one fetch bracketHtmlForSchedule makes for a bracket never seen.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const guid = (searchParams.get('tournament') ?? '').toLowerCase()
  const drawNum = searchParams.get('draw') ?? ''
  const playerId = searchParams.get('player') ?? ''
  if (!guid || !drawNum || !playerId) {
    return NextResponse.json({ error: 'tournament, draw and player params required' }, { status: 400 })
  }
  const notFound = (error: string) => NextResponse.json({ error }, { status: 404 })

  const ref = resolveRef(guid)
  if (ref && ref.provider !== 'bat') return notFound('Path is only available for BAT tournaments')

  // The draw list says what kind of draw this is and what it is called. It is
  // read from what is already held; when it is not there, the bracket decides.
  const drawInfo = (await getCachedOrDisk(guid).catch(() => undefined))?.draws.find((d) => d.drawNum === drawNum)
  if (drawInfo && (drawInfo.groupLetter || (drawInfo.type && !/^elimination$/i.test(drawInfo.type.trim())))) {
    return notFound('Not a knockout draw')
  }

  let html: string | undefined
  try {
    // A finished tournament's brackets live on disk until someone opens one.
    await ensureBracketsLoaded(guid, drawNum)
    html = await bracketHtmlForSchedule(guid, drawNum)
  } catch {
    html = undefined
  }
  if (!html) return notFound('No bracket for this draw')

  const path = buildBracketPath(parseBracketRounds(html), playerId)
  if (!path) return notFound('Player is not in this draw')

  const [index, ranking] = await Promise.all([
    readIndexCache('bat').catch(() => null),
    readRankingCache('bat').catch(() => null),
  ])
  const eventCode = drawInfo ? rankingEventCodeForDraw(drawInfo.name) : null

  const rounds: PathRoundOut[] = path.rounds.map((round) => {
    const { candidates, ...rest } = round
    const out: PathRoundOut = { ...rest }
    if (round.status === 'next' && round.opponent) {
      out.record = pairRecord(index, path.team, round.opponent)
    }
    if (candidates) {
      out.candidates = rankCandidates(candidates.map((c) => {
        const rank = eventCode ? teamRank(ranking, eventCode, c.team) : undefined
        return {
          team: c.team,
          ...(c.seed && { seed: c.seed }),
          ...(rank !== undefined && { rank }),
          record: pairRecord(index, path.team, c.team),
        }
      }))
    }
    return out
  })

  const entry = cache.get(makeBracketKey(guid, drawNum))
  const stale = !!entry && !entry.done && Date.now() - entry.ts >= ttlMsFor(entry)

  const body: PathResponse = {
    team: path.team,
    ...(path.seed && { seed: path.seed }),
    eliminated: path.eliminated,
    champion: path.champion,
    rounds,
    stale,
  }
  return NextResponse.json(body, stale ? { headers: staleHeaders() } : undefined)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/api-path-route.test.ts`
Expected: PASS, 13 tests.

If TypeScript rejects `ref.provider` or `entry.done`, open `lib/tournaments-registry.ts` (`resolveRef`) and `lib/bracket-cache.ts` (`BracketCacheEntry`) and use the field names they declare; do not change those files.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/path/route.ts __tests__/api-path-route.test.ts
git commit -m "feat(path): serve a player's path to the final at /api/path"
```

---

### Task 5: Strings and `PathToFinalModal`

**Files:**
- Modify: `lib/i18n.ts` (the `TKey` union, the `en` dictionary, the `th` dictionary)
- Create: `components/PathToFinalModal.tsx`
- Modify: `app/globals.css` (append)
- Test: `__tests__/PathToFinalModal.test.tsx`

**Interfaces:**
- Consumes: `PathResponse`, `PathCandidate`, `PathRecord`, `PathRoundOut` (types only) from `@/lib/pathEnrich`; `useLanguage()` → `{ t, longRound }` from `@/lib/LanguageContext`; `GET /api/path` (Task 4).
- Produces:
  ```ts
  interface Props {
    tournamentId: string
    drawNum: string
    drawName: string
    playerId: string
    onClose: () => void
    onPlayerClick?: (playerId: string) => void
  }
  export default function PathToFinalModal(props: Props): JSX.Element
  ```
  New `TKey`s: `pathToFinal`, `pathLikely`, `pathOthers`, `pathPossible`, `pathFirstMeeting`, `pathRecord`, `pathRank`, `pathSeed`, `pathBye`, `pathWon`, `pathLost`, `pathOut`, `pathChampion`, `pathRecordNote`, `pathLoadFailed`.

- [ ] **Step 1: Add the strings**

In `lib/i18n.ts`, add to the `TKey` union, after `| 'close'`:

```ts
  | 'pathToFinal'
  | 'pathLikely'
  | 'pathOthers'
  | 'pathPossible'
  | 'pathFirstMeeting'
  | 'pathRecord'
  | 'pathRank'
  | 'pathSeed'
  | 'pathBye'
  | 'pathWon'
  | 'pathLost'
  | 'pathOut'
  | 'pathChampion'
  | 'pathRecordNote'
  | 'pathLoadFailed'
```

In the `en` dictionary, after the `close: 'Close',` line:

```ts
    pathToFinal: 'Path to final',
    pathLikely: 'Likely',
    pathOthers: '+{n} others',
    pathPossible: '{n} possible opponents',
    pathFirstMeeting: 'First meeting',
    pathRecord: 'Record {w}–{l}',
    pathRank: 'Rank {n}',
    pathSeed: 'Seed {n}',
    pathBye: 'Bye',
    pathWon: 'Won',
    pathLost: 'Lost',
    pathOut: 'Out in {round}',
    pathChampion: 'Champion',
    pathRecordNote: 'Records count matches in tournaments tracked on BATMatch.',
    pathLoadFailed: 'Could not load the path for this draw.',
```

In the `th` dictionary, after the `close: 'ปิด',` line:

```ts
    pathToFinal: 'เส้นทางสู่รอบชิง',
    pathLikely: 'คาดว่าเจอ',
    pathOthers: '+อีก {n} ราย',
    pathPossible: 'คู่แข่งที่เป็นไปได้ {n} ราย',
    pathFirstMeeting: 'ยังไม่เคยเจอกัน',
    pathRecord: 'สถิติ {w}–{l}',
    pathRank: 'อันดับ {n}',
    pathSeed: 'มือวาง {n}',
    pathBye: 'บาย',
    pathWon: 'ชนะ',
    pathLost: 'แพ้',
    pathOut: 'ตกรอบ {round}',
    pathChampion: 'แชมป์',
    pathRecordNote: 'สถิติการพบกันนับเฉพาะรายการที่ BATMatch เก็บข้อมูล',
    pathLoadFailed: 'ไม่สามารถโหลดเส้นทางของสายนี้ได้',
```

Run: `npx tsc --noEmit`
Expected: no errors (the dictionaries are typed by `TKey`, so a key missing from either language fails here).

- [ ] **Step 2: Write the failing test**

Create `__tests__/PathToFinalModal.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PathToFinalModal from '@/components/PathToFinalModal'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { PathResponse } from '@/lib/pathEnrich'
import type { MatchPlayer } from '@/lib/types'

const P = (name: string, playerId: string): MatchPlayer => ({ name, playerId })

const BASE: PathResponse = {
  team: [P('Anan Dee', '1')],
  seed: '5',
  eliminated: false,
  champion: false,
  stale: false,
  rounds: [
    { round: 'Round of 32', status: 'bye' },
    {
      round: 'Round of 16', status: 'won', opponent: [P('Beam Kla', '2')],
      scores: [{ t1: 21, t2: 15 }, { t1: 21, t2: 18 }], walkover: false, retired: false,
    },
    {
      round: 'Quarter final', status: 'next', opponent: [P('Chai Yo', '3')], opponentSeed: '4',
      time: '14:30', court: 'Court 3', record: { wins: 1, losses: 2 },
    },
    {
      round: 'Semi final', status: 'future',
      candidates: [
        { team: [P('Dan Sri', '4')], seed: '1', rank: 2, record: { wins: 0, losses: 0 }, favourite: true },
        { team: [P('Ek Chai', '5')], rank: 30, record: { wins: 3, losses: 0 }, favourite: false },
        { team: [P('Fah Sai', '6')], record: null, favourite: false },
      ],
    },
    {
      round: 'Final', status: 'future',
      candidates: [
        { team: [P('Gun Dee', '7')], record: null, favourite: false },
        { team: [P('Hong Tae', '8')], record: null, favourite: false },
      ],
    },
  ],
}

function mockFetch(body: unknown, ok = true) {
  const fn = jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 404, json: async () => body })
  global.fetch = fn as unknown as typeof fetch
  return fn
}

function renderModal(extra: Partial<React.ComponentProps<typeof PathToFinalModal>> = {}) {
  return render(
    <LanguageProvider>
      <PathToFinalModal
        tournamentId="T1" drawNum="5" drawName="BS U15" playerId="1"
        onClose={() => {}} {...extra}
      />
    </LanguageProvider>,
  )
}

const rows = () => Array.from(document.querySelectorAll('.ptf-row'))
const rowText = (i: number) => rows()[i].textContent!.replace(/\s+/g, ' ').trim()

beforeEach(() => { localStorage.clear() })

describe('PathToFinalModal', () => {
  it('asks the path route for this player and draw', async () => {
    const fetchMock = mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    expect(fetchMock).toHaveBeenCalledWith('/api/path?tournament=T1&draw=5&player=1')
  })

  it('shows loading, then the header', async () => {
    mockFetch(BASE)
    renderModal()
    expect(document.querySelector('.pm-loading')).not.toBeNull()
    await screen.findByText('Quarter Final')
    expect(document.querySelector('.pm-loading')).toBeNull()
    expect(document.querySelector('.ptf-title')!.textContent).toContain('Anan Dee')
    expect(document.querySelector('.ptf-title')!.textContent).toContain('BS U15')
  })

  it('renders one row per round, in order, with long round names', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    expect(Array.from(document.querySelectorAll('.ptf-round')).map((e) => e.textContent)).toEqual([
      'Round of 32', 'Round of 16', 'Quarter Final', 'Semi Final', 'Final',
    ])
  })

  it('renders a bye, a win with its score, and the next match', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    expect(rowText(0)).toContain('Bye')
    expect(rowText(1)).toContain('Won')
    expect(rowText(1)).toContain('Beam Kla')
    expect(rowText(1)).toContain('21–15, 21–18')
    expect(rowText(2)).toContain('Chai Yo')
    expect(rowText(2)).toContain('Seed 4')
    expect(rowText(2)).toContain('14:30')
    expect(rowText(2)).toContain('Court 3')
    expect(rowText(2)).toContain('Record 1–2')
  })

  it('shows the favourite and a count of the others', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    expect(rowText(3)).toContain('Likely')
    expect(rowText(3)).toContain('Dan Sri')
    expect(rowText(3)).toContain('Seed 1')
    expect(rowText(3)).toContain('First meeting')
    expect(rowText(3)).toContain('+2 others')
    expect(rowText(3)).not.toContain('Ek Chai')
  })

  it('shows only a count when there is no favourite', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    expect(rowText(4)).toContain('2 possible opponents')
    expect(rowText(4)).not.toContain('Likely')
    expect(rowText(4)).not.toContain('Gun Dee')
  })

  it('expands and collapses the full candidate list', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    fireEvent.click(screen.getByText('+2 others'))
    expect(rowText(3)).toContain('Ek Chai')
    expect(rowText(3)).toContain('Rank 30')
    expect(rowText(3)).toContain('Record 3–0')
    expect(rowText(3)).toContain('Fah Sai')
    expect(rowText(4)).not.toContain('Gun Dee')
    fireEvent.click(screen.getByText('+2 others'))
    expect(rowText(3)).not.toContain('Ek Chai')
    fireEvent.click(screen.getByText('2 possible opponents'))
    expect(rowText(4)).toContain('Gun Dee')
    expect(rowText(4)).toContain('Hong Tae')
  })

  it('says nothing about a record it does not have', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    fireEvent.click(screen.getByText('2 possible opponents'))
    expect(rowText(4)).not.toContain('Record')
    expect(rowText(4)).not.toContain('First meeting')
  })

  it('ends with an "out" line for an eliminated player', async () => {
    mockFetch({
      ...BASE, eliminated: true,
      rounds: [{
        round: 'Round of 16', status: 'lost', opponent: [P('Beam Kla', '2')],
        scores: [{ t1: 15, t2: 21 }, { t1: 18, t2: 21 }], walkover: false, retired: false,
      }],
    })
    renderModal()
    await screen.findByText('Round of 16')
    expect(rows()).toHaveLength(1)
    expect(rowText(0)).toContain('Lost')
    expect(document.querySelector('.ptf-end')!.textContent).toBe('Out in Round of 16')
  })

  it('ends with a champion line', async () => {
    mockFetch({
      ...BASE, champion: true,
      rounds: [{ round: 'Final', status: 'won', opponent: [P('Beam Kla', '2')], scores: [{ t1: 21, t2: 9 }], walkover: false, retired: false }],
    })
    renderModal()
    await screen.findByText('Final')
    expect(document.querySelector('.ptf-end')!.textContent).toBe('Champion')
  })

  it('shows a walkover or retirement pill on a played round', async () => {
    mockFetch({
      ...BASE,
      rounds: [
        { round: 'Round of 16', status: 'won', opponent: [P('Beam Kla', '2')], scores: [], walkover: true, retired: false },
        { round: 'Quarter final', status: 'won', opponent: [P('Chai Yo', '3')], scores: [{ t1: 21, t2: 10 }, { t1: 5, t2: 2 }], walkover: false, retired: true },
      ],
    })
    renderModal()
    await screen.findByText('Round of 16')
    expect(rowText(0)).toContain('Walkover')
    expect(rowText(1)).toContain('Ret.')
  })

  it('names both players of a doubles pair', async () => {
    mockFetch({
      ...BASE, team: [P('Anan Dee', '1'), P('Krit Wong', '9')],
      rounds: [{ round: 'Final', status: 'next', opponent: [P('Beam Kla', '2'), P('Chai Yo', '3')], record: null }],
    })
    renderModal()
    await screen.findByText('Final')
    expect(document.querySelector('.ptf-title')!.textContent).toContain('Anan Dee / Krit Wong')
    expect(rowText(0)).toContain('Beam Kla')
    expect(rowText(0)).toContain('Chai Yo')
  })

  it('opens an opponent when their name is tapped', async () => {
    mockFetch(BASE)
    const onPlayerClick = jest.fn()
    renderModal({ onPlayerClick })
    await screen.findByText('Quarter Final')
    fireEvent.click(screen.getByText('Chai Yo'))
    expect(onPlayerClick).toHaveBeenCalledWith('3')
  })

  it('shows the stale notice and the record note', async () => {
    mockFetch({ ...BASE, stale: true })
    renderModal()
    await screen.findByText('Quarter Final')
    expect(document.querySelector('.ptf-stale')!.textContent).toContain('BAT server is down')
    expect(document.querySelector('.ptf-note')!.textContent).toContain('tracked on BATMatch')
  })

  it('shows no stale notice for a fresh bracket', async () => {
    mockFetch(BASE)
    renderModal()
    await screen.findByText('Quarter Final')
    expect(document.querySelector('.ptf-stale')).toBeNull()
  })

  it('shows an error, not endless loading, when the route says 404', async () => {
    mockFetch({ error: 'nope' }, false)
    renderModal()
    await waitFor(() => expect(document.querySelector('.ptf-error')).not.toBeNull())
    expect(document.querySelector('.ptf-error')!.textContent).toBe('Could not load the path for this draw.')
    expect(document.querySelector('.pm-loading')).toBeNull()
  })

  it('shows an error when the request itself fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    renderModal()
    await waitFor(() => expect(document.querySelector('.ptf-error')).not.toBeNull())
  })

  it('reloads, and drops the old rows, when it is pointed at another draw', async () => {
    const fetchMock = mockFetch(BASE)
    const view = renderModal()
    await screen.findByText('Quarter Final')
    fireEvent.click(screen.getByText('+2 others'))
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ ...BASE, rounds: [{ round: 'Final', status: 'bye' }] }),
    })
    view.rerender(
      <LanguageProvider>
        <PathToFinalModal tournamentId="T1" drawNum="9" drawName="BD U15" playerId="1" onClose={() => {}} />
      </LanguageProvider>,
    )
    expect(document.querySelector('.pm-loading')).not.toBeNull()
    expect(rows()).toHaveLength(0)
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/path?tournament=T1&draw=9&player=1')
  })

  it('closes on the close button, the backdrop and Escape', async () => {
    mockFetch(BASE)
    const onClose = jest.fn()
    renderModal({ onClose })
    await screen.findByText('Quarter Final')
    fireEvent.click(document.querySelector('.pm-close')!)
    fireEvent.click(document.querySelector('.pm-overlay')!)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
    fireEvent.click(document.querySelector('.pm-modal')!)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('renders in Thai', async () => {
    localStorage.setItem('batbracket.lang', 'th')
    mockFetch(BASE)
    renderModal()
    await waitFor(() => expect(rows().length).toBe(5))
    await waitFor(() => expect(rowText(0)).toContain('บาย'))
    expect(rowText(1)).toContain('ชนะ')
    expect(rowText(2)).toContain('สถิติ 1–2')
    expect(rowText(3)).toContain('คาดว่าเจอ')
    expect(rowText(3)).toContain('ยังไม่เคยเจอกัน')
    expect(rowText(3)).toContain('+อีก 2 ราย')
    expect(rowText(4)).toContain('คู่แข่งที่เป็นไปได้ 2 ราย')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest __tests__/PathToFinalModal.test.tsx`
Expected: FAIL — cannot find module `@/components/PathToFinalModal`.

- [ ] **Step 4: Implement the modal**

Create `components/PathToFinalModal.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import type { MatchPlayer } from '@/lib/types'
import type { PathCandidate, PathRecord, PathResponse, PathRoundOut } from '@/lib/pathEnrich'
import { useLanguage } from '@/lib/LanguageContext'

interface Props {
  tournamentId: string
  drawNum: string
  drawName: string
  playerId: string
  onClose: () => void
  onPlayerClick?: (playerId: string) => void
}

export default function PathToFinalModal({ tournamentId, drawNum, drawName, playerId, onClose, onPlayerClick }: Props) {
  const { t, longRound } = useLanguage()
  const [data, setData] = useState<PathResponse | null>(null)
  const [failed, setFailed] = useState(false)
  // Which rounds have their full candidate list open, by row index.
  const [open, setOpen] = useState<Set<number>>(new Set())

  useEffect(() => {
    let live = true
    setData(null)
    setFailed(false)
    setOpen(new Set())
    const url = `/api/path?tournament=${encodeURIComponent(tournamentId)}&draw=${encodeURIComponent(drawNum)}&player=${encodeURIComponent(playerId)}`
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: PathResponse) => { if (live) setData(d) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [tournamentId, drawNum, playerId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggle = (i: number) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  const team = (players: MatchPlayer[]) => (
    <span className="ptf-team">
      {players.map((p, i) => (
        <span key={i}>
          {i > 0 && ' / '}
          {onPlayerClick && p.playerId
            ? <button type="button" className="ptf-name pm-player-link" onClick={() => onPlayerClick(p.playerId)}>{p.name}</button>
            : <span className="ptf-name">{p.name}</span>}
        </span>
      ))}
    </span>
  )

  const seed = (s: string | undefined) =>
    s ? <span className="ptf-tag">{t('pathSeed').replace('{n}', s)}</span> : null

  const record = (r: PathRecord | null | undefined) => {
    if (!r) return null
    const text = r.wins === 0 && r.losses === 0
      ? t('pathFirstMeeting')
      : t('pathRecord').replace('{w}', String(r.wins)).replace('{l}', String(r.losses))
    return <span className="ptf-record">{text}</span>
  }

  const candidate = (c: PathCandidate, key?: number) => (
    <div className="ptf-candidate" key={key}>
      {team(c.team)}
      {seed(c.seed)}
      {c.rank !== undefined && <span className="ptf-tag">{t('pathRank').replace('{n}', String(c.rank))}</span>}
      {record(c.record)}
    </div>
  )

  const schedule = (r: PathRoundOut) =>
    (r.time || r.court) ? <span className="ptf-when">{[r.time, r.court].filter(Boolean).join(' · ')}</span> : null

  const body = (r: PathRoundOut, i: number) => {
    if (r.status === 'bye') return <span className="ptf-muted">{t('pathBye')}</span>

    if (r.status === 'won' || r.status === 'lost') {
      const score = (r.scores ?? []).map((s) => `${s.t1}–${s.t2}`).join(', ')
      return (
        <>
          <span className={`ptf-result ptf-result--${r.status}`}>{t(r.status === 'won' ? 'pathWon' : 'pathLost')}</span>
          {team(r.opponent ?? [])}
          {seed(r.opponentSeed)}
          {r.walkover
            ? <span className="bk-walkover-badge">{t('walkover')}</span>
            : score && <span className="ptf-score">{score}</span>}
          {r.retired && <span className="bk-walkover-badge">{t('retired')}</span>}
        </>
      )
    }

    if (r.opponent) {
      return (
        <>
          <span className="ptf-muted">{t('vs')}</span>
          {team(r.opponent)}
          {seed(r.opponentSeed)}
          {schedule(r)}
          {record(r.record)}
        </>
      )
    }

    const list = r.candidates ?? []
    const favourite = list.find((c) => c.favourite)
    const rest = favourite ? list.filter((c) => c !== favourite) : list
    const label = favourite
      ? t('pathOthers').replace('{n}', String(rest.length))
      : t('pathPossible').replace('{n}', String(rest.length))
    return (
      <>
        {favourite && (
          <div className="ptf-favourite">
            <span className="ptf-muted">{t('pathLikely')}</span>
            {candidate(favourite)}
          </div>
        )}
        {schedule(r)}
        {rest.length > 0 && (
          <button type="button" className="ptf-more" aria-expanded={open.has(i)} onClick={() => toggle(i)}>{label}</button>
        )}
        {open.has(i) && <div className="ptf-candidates">{rest.map((c, ci) => candidate(c, ci))}</div>}
      </>
    )
  }

  const last = data?.rounds[data.rounds.length - 1]

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-modal ptf-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pm-close" onClick={onClose} aria-label={t('close')}>✕</button>

        {!data && !failed && <div className="pm-loading">{t('loading')}</div>}
        {failed && <div className="ptf-error">{t('pathLoadFailed')}</div>}

        {data && (
          <>
            <div className="pm-header">
              <div className="pm-section-title">{t('pathToFinal')}</div>
              <div className="ptf-title">
                {data.team.map((p) => p.name).join(' / ')}
                {data.seed && <> {seed(data.seed)}</>}
                <span className="ptf-draw"> · {drawName}</span>
              </div>
            </div>

            {data.stale && <div className="ptf-stale" role="status">{t('staleCacheBanner')}</div>}

            <div className="ptf-rows">
              {data.rounds.map((r, i) => (
                <div key={i} className={`ptf-row ptf-row--${r.status}`}>
                  <div className="ptf-round">{longRound(r.round)}</div>
                  <div className="ptf-body">{body(r, i)}</div>
                </div>
              ))}
            </div>

            {data.eliminated && last && (
              <div className="ptf-end">{t('pathOut').replace('{round}', longRound(last.round))}</div>
            )}
            {data.champion && <div className="ptf-end">{t('pathChampion')}</div>}

            <div className="ptf-note">{t('pathRecordNote')}</div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Add the styles**

Append to `app/globals.css`:

```css
/* Path to the final */
.ptf-modal {
  width: 560px;
  max-width: calc(100vw - 32px);
}

.ptf-title {
  font-size: calc(16px * var(--text-scale));
  font-weight: 700;
  color: var(--fg);
}

.ptf-draw {
  font-weight: 500;
  color: var(--muted);
}

.ptf-stale {
  margin: 8px 0;
  padding: 6px 10px;
  border-radius: 6px;
  background: #dc2626;
  color: #fff;
  font-size: calc(12px * var(--text-scale));
}

.ptf-rows {
  display: flex;
  flex-direction: column;
}

.ptf-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 0;
  border-top: 1px solid var(--border);
}

.ptf-row--future { opacity: 0.85; }

.ptf-round {
  font-size: calc(11px * var(--text-scale));
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--muted);
}

.ptf-body,
.ptf-favourite,
.ptf-candidate {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  font-size: calc(14px * var(--text-scale));
}

.ptf-candidates {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  margin-top: 4px;
  padding-left: 10px;
  border-left: 2px solid var(--border);
}

.ptf-name {
  font-weight: 600;
  background: none;
  border: 0;
  padding: 0;
  font-size: inherit;
  color: inherit;
  text-align: left;
}

button.ptf-name { cursor: pointer; }

.ptf-muted,
.ptf-when,
.ptf-record {
  color: var(--muted);
  font-size: calc(12px * var(--text-scale));
}

.ptf-tag {
  font-size: calc(11px * var(--text-scale));
  font-weight: 600;
  color: var(--brand-fg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 6px;
  white-space: nowrap;
}

.ptf-score { font-variant-numeric: tabular-nums; }

.ptf-result {
  font-size: calc(11px * var(--text-scale));
  font-weight: 700;
  text-transform: uppercase;
}

.ptf-result--won { color: #16a34a; }
.ptf-result--lost { color: #dc2626; }

.ptf-more {
  font-size: calc(12px * var(--text-scale));
  font-weight: 600;
  color: var(--brand-fg);
  background: none;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1px 8px;
  cursor: pointer;
}

.ptf-more:hover { background: var(--border); }

.ptf-end {
  padding: 10px 0;
  border-top: 1px solid var(--border);
  font-weight: 700;
}

.ptf-note,
.ptf-error {
  margin-top: 8px;
  color: var(--muted);
  font-size: calc(11px * var(--text-scale));
}

.ptf-error { padding: 24px 0; text-align: center; font-size: calc(13px * var(--text-scale)); }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest __tests__/PathToFinalModal.test.tsx`
Expected: PASS, 20 tests.

If "renders one row per round" fails because `longRound('Quarter final')` returns different casing than `Quarter Final`, read `longRoundL` in `lib/i18n.ts`, and change the expected strings in this test file to what it returns. Do not change `longRoundL`.

- [ ] **Step 7: Commit**

```bash
git add lib/i18n.ts components/PathToFinalModal.tsx app/globals.css __tests__/PathToFinalModal.test.tsx
git commit -m "feat(path): the path-to-final panel, in Thai and English"
```

---

### Task 6: The button in the player window, and page wiring

**Files:**
- Create: `lib/pathDraws.ts`
- Modify: `components/PlayerModal.tsx` (props; one new section after the events section)
- Modify: `app/page.tsx` (one state, one handler, two props on `<PlayerModal>`, one new modal)
- Test: `__tests__/pathDraws.test.ts`, `__tests__/PlayerModal.path.test.tsx`

**Interfaces:**
- Consumes: `PathToFinalModal` (Task 5); `MatchEntry`, `DrawInfo` from `@/lib/types`; `track(event, props)` from `@/lib/analytics`; in `app/page.tsx` the existing `draws` state (`DrawInfo[]`), `selectedTournament`, `tournaments`, `playerClickHandler`, `modalProfile`.
- Produces:
  ```ts
  // lib/pathDraws.ts
  export interface PathDraw { drawNum: string; name: string }
  export function knockoutDrawsOf(matches: MatchEntry[], draws: DrawInfo[] | undefined): PathDraw[]
  // components/PlayerModal.tsx — two new optional props
  draws?: DrawInfo[]
  onPathClick?: (drawNum: string, drawName: string) => void
  ```

- [ ] **Step 1: Write the failing helper test**

Create `__tests__/pathDraws.test.ts`:

```ts
import { knockoutDrawsOf } from '@/lib/pathDraws'
import type { DrawInfo, MatchEntry } from '@/lib/types'

const match = (drawNum: string, draw = `Draw ${drawNum}`): MatchEntry => ({
  draw, drawNum, round: 'QF', team1: [], team2: [], winner: null, scores: [],
  court: '', walkover: false, retired: false, nowPlaying: false,
})

const info = (drawNum: string, name: string, type: string, extra: Partial<DrawInfo> = {}): DrawInfo =>
  ({ drawNum, name, size: '32', type, ...extra })

const DRAWS: DrawInfo[] = [
  info('1', 'BS U15', 'Elimination'),
  info('2', 'BD U15', 'Elimination'),
  info('3', 'XD U15 - Group A', 'Round Robin', { groupLetter: 'A' }),
  info('4', 'XD U15', 'Elimination', { isPlayoff: true }),
  info('5', 'GS U15 - Group B', 'Elimination', { groupLetter: 'B' }),
]

describe('knockoutDrawsOf', () => {
  it('lists each knockout draw the player has a match in, once, in match order', () => {
    const out = knockoutDrawsOf([match('2'), match('1'), match('2'), match('1')], DRAWS)
    expect(out).toEqual([{ drawNum: '2', name: 'BD U15' }, { drawNum: '1', name: 'BS U15' }])
  })

  it('leaves out round-robin and grouped draws, keeps a playoff', () => {
    const out = knockoutDrawsOf([match('3'), match('4'), match('5')], DRAWS)
    expect(out).toEqual([{ drawNum: '4', name: 'XD U15' }])
  })

  it('accepts the type however it is cased or padded', () => {
    expect(knockoutDrawsOf([match('1')], [info('1', 'BS U15', ' elimination ')])).toHaveLength(1)
  })

  it('leaves out a draw it knows nothing about', () => {
    expect(knockoutDrawsOf([match('9')], DRAWS)).toEqual([])
    expect(knockoutDrawsOf([match('1')], undefined)).toEqual([])
    expect(knockoutDrawsOf([match('1')], [])).toEqual([])
  })

  it('leaves out a draw whose type is missing', () => {
    const noType = { drawNum: '1', name: 'MS', size: '8' } as unknown as DrawInfo
    expect(knockoutDrawsOf([match('1')], [noType])).toEqual([])
  })

  it('ignores matches with no draw number', () => {
    expect(knockoutDrawsOf([match('')], DRAWS)).toEqual([])
    expect(knockoutDrawsOf([], DRAWS)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/pathDraws.test.ts`
Expected: FAIL — cannot find module `@/lib/pathDraws`.

- [ ] **Step 3: Implement the helper**

Create `lib/pathDraws.ts`:

```ts
import type { DrawInfo, MatchEntry } from './types'

export interface PathDraw {
  drawNum: string
  name: string
}

/** The knockout draws a player has matches in — the draws a path to the final
 *  can be shown for. A draw is kept only when the tournament's draw list says
 *  it is an elimination draw; group draws and anything unknown are left out,
 *  so the button never opens onto an error. */
export function knockoutDrawsOf(matches: MatchEntry[], draws: DrawInfo[] | undefined): PathDraw[] {
  const out: PathDraw[] = []
  const seen = new Set<string>()
  for (const m of matches) {
    if (!m.drawNum || seen.has(m.drawNum)) continue
    seen.add(m.drawNum)
    const d = draws?.find((x) => x.drawNum === m.drawNum)
    if (!d || d.groupLetter) continue
    if (!/^elimination$/i.test((d.type ?? '').trim())) continue
    out.push({ drawNum: m.drawNum, name: d.name || m.draw })
  }
  return out
}
```

Run: `npx jest __tests__/pathDraws.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 4: Write the failing PlayerModal test**

Create `__tests__/PlayerModal.path.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import PlayerModal from '@/components/PlayerModal'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { DrawInfo, MatchEntry, PlayerProfile } from '@/lib/types'

const match = (drawNum: string, draw: string): MatchEntry => ({
  draw, drawNum, round: 'QF',
  team1: [{ name: 'Anan Dee', playerId: '1' }], team2: [{ name: 'Beam Kla', playerId: '2' }],
  winner: null, scores: [], court: '', walkover: false, retired: false, nowPlaying: false,
})

const profile = (matches: MatchEntry[]): PlayerProfile =>
  ({ playerId: '1', name: 'Anan Dee', club: '', yob: '', events: [], matches })

const DRAWS: DrawInfo[] = [
  { drawNum: '1', name: 'BS U15', size: '32', type: 'Elimination' },
  { drawNum: '2', name: 'BD U15', size: '16', type: 'Elimination' },
  { drawNum: '3', name: 'XD U15 - Group A', size: '4', type: 'Round Robin', groupLetter: 'A' },
]

function renderModal(extra: Partial<React.ComponentProps<typeof PlayerModal>>) {
  return render(
    <LanguageProvider>
      <PlayerModal profile={null} loading={false} onClose={() => {}} provider="bat" {...extra} />
    </LanguageProvider>,
  )
}

const buttons = () => Array.from(document.querySelectorAll('.ptf-open')).map((b) => b.textContent)

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ exists: false }) }) as unknown as typeof fetch
})

describe('PlayerModal path-to-final button', () => {
  it('shows one unlabelled button for a player in one knockout draw', () => {
    renderModal({ profile: profile([match('1', 'BS U15')]), draws: DRAWS, onPathClick: () => {} })
    expect(buttons()).toEqual(['Path to final'])
  })

  it('labels each button with its draw when there is more than one', () => {
    renderModal({ profile: profile([match('1', 'BS U15'), match('2', 'BD U15')]), draws: DRAWS, onPathClick: () => {} })
    expect(buttons()).toEqual(['Path to final · BS U15', 'Path to final · BD U15'])
  })

  it('passes the draw to the handler', () => {
    const onPathClick = jest.fn()
    renderModal({ profile: profile([match('1', 'BS U15'), match('2', 'BD U15')]), draws: DRAWS, onPathClick })
    fireEvent.click(screen.getByText('Path to final · BD U15'))
    expect(onPathClick).toHaveBeenCalledWith('2', 'BD U15')
  })

  it('shows no button for a group draw', () => {
    renderModal({ profile: profile([match('3', 'XD U15 - Group A')]), draws: DRAWS, onPathClick: () => {} })
    expect(buttons()).toEqual([])
  })

  it('shows no button for a BWF tournament', () => {
    renderModal({ profile: profile([match('1', 'BS U15')]), draws: DRAWS, onPathClick: () => {}, provider: 'bwf' })
    expect(buttons()).toEqual([])
  })

  it('shows no button without a handler or a draw list', () => {
    const first = renderModal({ profile: profile([match('1', 'BS U15')]), draws: DRAWS })
    expect(buttons()).toEqual([])
    first.unmount()
    renderModal({ profile: profile([match('1', 'BS U15')]), onPathClick: () => {} })
    expect(buttons()).toEqual([])
  })

  it('shows no button for a player with no matches yet', () => {
    renderModal({ profile: profile([]), draws: DRAWS, onPathClick: () => {} })
    expect(buttons()).toEqual([])
  })
})
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx jest __tests__/PlayerModal.path.test.tsx`
Expected: FAIL — `draws` / `onPathClick` are not props of `PlayerModal`, and no `.ptf-open` buttons render.

- [ ] **Step 6: Add the button to `PlayerModal`**

In `components/PlayerModal.tsx`:

Change the type import and add the helper import:

```ts
import type { PlayerProfile, MatchEntry, ProviderTag, DrawInfo } from '@/lib/types'
import { knockoutDrawsOf } from '@/lib/pathDraws'
```

Add to `interface Props`, after `provider?: ProviderTag`:

```ts
  /** The tournament's draws, used to tell knockout draws from group draws. */
  draws?: DrawInfo[]
  /** Opens the path to the final for one of the player's knockout draws. */
  onPathClick?: (drawNum: string, drawName: string) => void
```

Change the function signature to take them:

```ts
export default function PlayerModal({ profile, loading, onClose, onH2HClick, onPlayerClick, provider, draws, onPathClick }: Props) {
```

After the `matchInActiveEvent` definition (just before the component's `return`), add:

```ts
  // BAT knockout draws only: the path is read from a BAT bracket.
  const pathDraws = profile && onPathClick && (provider ?? 'bat') === 'bat'
    ? knockoutDrawsOf(profile.matches, draws)
    : []
```

In the JSX, directly after the closing `)}` of the `{profile.events.length > 0 && ( … )}` block and before `{profile.matches.length > 0 && (`, add:

```tsx
            {pathDraws.length > 0 && onPathClick && (
              <div className="pm-section">
                <div className="pm-events">
                  {pathDraws.map((d) => (
                    <button
                      key={d.drawNum}
                      type="button"
                      className="pm-event-pill ptf-open"
                      onClick={() => onPathClick(d.drawNum, d.name)}
                    >{pathDraws.length > 1 ? `${t('pathToFinal')} · ${d.name}` : t('pathToFinal')}</button>
                  ))}
                </div>
              </div>
            )}
```

`.pm-events` already wraps, so on a narrow screen the buttons stack onto further lines; this settles the spec's open point about placement.

- [ ] **Step 7: Run the PlayerModal tests**

Run: `npx jest __tests__/PlayerModal.path.test.tsx __tests__/pathDraws.test.ts`
Expected: PASS.

- [ ] **Step 8: Wire the page**

In `app/page.tsx`:

Add the import beside the other modal imports:

```ts
import PathToFinalModal from '@/components/PathToFinalModal'
```

Beside the `h2hData` state (`const [h2hData, setH2hData] = useState<H2HData | null>(null)`), add:

```ts
  const [pathTarget, setPathTarget] = useState<{ drawNum: string; drawName: string; playerId: string } | null>(null)
```

Directly after the `handleH2HClick` callback's closing `}, [ … ])`, add:

```ts
  const handlePathClick = useCallback((drawNum: string, drawName: string) => {
    if (!modalProfile?.playerId) return
    const t = tournaments.find((x) => x.id === selectedTournament)
    track('path_to_final_opened', {
      tournament_id: selectedTournament,
      tournament_name: t?.name ?? '',
      draw: drawName,
      draw_id: drawNum,
    })
    setPathTarget({ drawNum, drawName, playerId: modalProfile.playerId })
  }, [modalProfile, tournaments, selectedTournament])
```

On the existing `<PlayerModal … />` element (the one given `profile={modalProfile}`), add two props:

```tsx
          draws={draws}
          onPathClick={handlePathClick}
```

Directly after that `<PlayerModal>` block's closing `)}`, add:

```tsx
      {pathTarget && selectedTournament && (
        <PathToFinalModal
          tournamentId={selectedTournament}
          drawNum={pathTarget.drawNum}
          drawName={pathTarget.drawName}
          playerId={pathTarget.playerId}
          onClose={() => setPathTarget(null)}
          onPlayerClick={(id) => { setPathTarget(null); playerClickHandler?.(id) }}
        />
      )}
```

Then make sure the panel does not outlive its tournament. Find where the page clears state when the selected tournament changes (the block containing `setDraws([])`) and add `setPathTarget(null)` on the line after `setDraws([])`.

Before editing, confirm these names with:

```bash
grep -n "const \[draws, setDraws\]\|const \[modalProfile\|playerClickHandler =\|const \[selectedTournament\|setDraws(\[\])\|import { track }\|from '@/lib/analytics'" app/page.tsx
```

Expected: each name appears. `selectedTournament` is a string that is empty when nothing is selected, which the `pathTarget && selectedTournament &&` guard covers. `playerClickHandler` is undefined for a BWF tournament, hence the `?.` call.

- [ ] **Step 9: Type-check and run the page-level tests**

Run: `npx tsc --noEmit && npx jest __tests__/page-hotkey.test.tsx`
Expected: no type errors; PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/pathDraws.ts components/PlayerModal.tsx app/page.tsx __tests__/pathDraws.test.ts __tests__/PlayerModal.path.test.tsx
git commit -m "feat(path): open the path to the final from the player window"
```

---

### Task 7: Whole-feature verification

**Files:** none created. Fixes found here go in the file that owns the fault, with a test in that file's test.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: every suite passes, including the seven new ones (`parseBracketRounds`, `bracketPath`, `pathEnrich`, `api-path-route`, `PathToFinalModal`, `pathDraws`, `PlayerModal.path`).

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: no lint errors; the build lists `/api/path` among the routes.

- [ ] **Step 3: Check it in the running app**

Start the dev server (`npm run dev`, or the project's preview configuration) and open `http://localhost:3000`.

1. Pick a BAT tournament that is in play or about to start, open a knockout draw, and tap a player.
2. Confirm the player window shows a "Path to final" button, and that a player in two knockout draws shows two labelled buttons.
3. Open it. Confirm: one row per round to the final; played rounds show the real score; the next round shows the opponent, time and venue; later rounds show "Likely …" with "+N others", which expands and collapses.
4. Compare one future round's candidates by eye with the bracket view: they must be exactly the players in the opposite part of the bracket who have not lost.
5. Tap an opponent's name: the panel closes and that player's window opens.
6. Switch the language to Thai and confirm every label changes.
7. Open a player from a round-robin group draw and from a BWF tournament: no button.
8. Narrow the window to phone width (375px): rows wrap, the panel scrolls, nothing overflows sideways.

Check the browser console and the dev server log for errors after each step.

- [ ] **Step 4: Check the request costs nothing extra**

With the panel open on a draw whose bracket was already viewed, watch the dev server log while reopening the panel three times.
Expected: no new `[bat-fetch]` lines for a bracket (the route reuses the held copy).

- [ ] **Step 5: Settle the remaining open point**

The spec assumes a shared seed prints as `3/4`. In the running app or the `.cache/brackets` files, look for one:

```bash
grep -rho '\[[0-9]*/[0-9]*\]' .cache/brackets 2>/dev/null | sort | uniq -c | head
```

If shared seeds print in a form `BRACKET_SEED_RE` (`/\s*\[([^\]]+)\]\s*$/`) does not capture — for example round brackets — add that form to the regular expression in `lib/scraper.ts` with a test in `__tests__/parseBracketRounds.test.ts` built from an inline HTML snippet. If none are found, leave the code as it is and record in the commit message that no shared seed was seen.

- [ ] **Step 6: Commit anything Step 3–5 changed**

```bash
git status --short
git add -A -- lib components app __tests__
git commit -m "fix(path): corrections from checking the panel in the running app"
```

Skip the commit when nothing changed. Never add `public/bwf-cache.json`: it was modified before this work began and is not part of it.

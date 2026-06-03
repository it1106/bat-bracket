import path from 'path'
import fs from 'fs'
import { buildIndex, buildLeaderboards } from '@/lib/playerIndex'
import type { MatchesData, PlayerIndexTournamentInput, PlayerRecord } from '@/lib/types'

function disc() { return { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 } }
function synthPlayer(slug: string, name: string, opts: {
  wins: number; losses: number; courtMinutes?: number; matchesWithDuration?: number;
  threeSetterWins?: number; threeSetterCount?: number;
}): PlayerRecord {
  const matches = opts.wins + opts.losses
  return {
    key: { provider: 'bat', slug }, displayName: name, altNames: [], clubs: [],
    totals: { matches, wins: opts.wins, losses: opts.losses,
      walkoversReceived: 0, walkoversGiven: 0, retirementsReceived: 0, retirementsGiven: 0 },
    byDiscipline: { singles: disc(), doubles: disc(), mixed: disc() },
    titles: [], finals: [], semis: [], tournaments: [], recentForm: [],
    matchCharacter: {
      courtMinutes: opts.courtMinutes ?? 0, avgMatchMinutes: 0,
      longestMatchMinutes: 0, longestMatchRef: null,
      threeSetterCount: opts.threeSetterCount ?? 0,
      threeSetterRate: 0,
      threeSetterWins: opts.threeSetterWins ?? 0,
      comebackWins: 0, firstGameLost: 0, comebackWinRef: null,
      matchesLast90: 0, matchesWithDuration: opts.matchesWithDuration,
    },
    opponents: [], partners: [], ranks: {},
  }
}

function loadInput(slug: string, name: string, date: string): PlayerIndexTournamentInput {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}.json`), 'utf8')) as MatchesData
  const clubs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}-clubs.json`), 'utf8')) as Record<string, string>
  delete (clubs as Record<string, string>)._meta
  return { tournamentId: slug.toUpperCase(), tournamentName: name, tournamentDateIso: date, data, clubs }
}

describe('buildIndex — leaderboards', () => {
  const toyota = loadInput('toyota', 'Toyota', '2026-05-01')
  const trang = loadInput('trang', 'Trang', '2026-04-15')

  it('produces all 13 v1 boards', () => {
    const { leaderboards } = buildIndex('bat', [toyota, trang])
    const ids = leaderboards.boards.map(b => b.id).sort()
    expect(ids).toEqual([
      'activity.matchesLast90', 'activity.tournamentsEntered',
      'character.comebacks', 'character.deciderRecord', 'character.threeGamers', 'character.threeSetterWins',
      'discipline.doubles.wins', 'discipline.mixed.wins', 'discipline.singles.wins',
      'headline.courtTime', 'headline.titles', 'headline.winPct', 'headline.wins',
    ])
  })

  it('caps every board at 25 entries', () => {
    const { leaderboards } = buildIndex('bat', [toyota, trang])
    for (const b of leaderboards.boards) expect(b.entries.length).toBeLessThanOrEqual(25)
  })

  it('ranks are 1-indexed and contiguous', () => {
    const { leaderboards } = buildIndex('bat', [toyota, trang])
    for (const b of leaderboards.boards) {
      b.entries.forEach((e, i) => expect(e.rank).toBe(i + 1))
    }
  })

  it('headline.winPct excludes players with < 20 matches', () => {
    const { index, leaderboards } = buildIndex('bat', [toyota, trang])
    const board = leaderboards.boards.find(b => b.id === 'headline.winPct')!
    for (const e of board.entries) {
      const p = index.players[e.slug]
      expect(p.totals.matches).toBeGreaterThanOrEqual(20)
    }
  })

  it('writes ranks back to PlayerRecord.ranks for ranked players', () => {
    const { index, leaderboards } = buildIndex('bat', [toyota, trang])
    const titlesBoard = leaderboards.boards.find(b => b.id === 'headline.titles')!
    if (titlesBoard.entries.length > 0) {
      const top = titlesBoard.entries[0]
      expect(index.players[top.slug].ranks.titles).toBe(1)
    }
  })

  it('headline.winPct display includes (wins/matches) behind the percent', () => {
    const players: Record<string, PlayerRecord> = {
      a: synthPlayer('a', 'Alpha', { wins: 17, losses: 3 }),  // 20 matches, qualifies
      b: synthPlayer('b', 'Beta',  { wins: 30, losses: 10 }), // 40 matches, qualifies
      c: synthPlayer('c', 'Gamma', { wins: 5,  losses: 4 }),  // 9 matches, below qualifier
    }
    const lb = buildLeaderboards('bat', players)
    const board = lb.boards.find(b => b.id === 'headline.winPct')!
    expect(board.entries.length).toBe(2)
    for (const e of board.entries) {
      const p = players[e.slug]
      expect(e.display).toMatch(/^\d+% \(\d+\/\d+\)$/)
      expect(e.display).toContain(`(${p.totals.wins}/${p.totals.matches})`)
    }
    // Spot-check Alpha specifically: 17/20 = 85%.
    const a = board.entries.find(e => e.slug === 'a')!
    expect(a.display).toBe('85% (17/20)')
  })

  it('headline.courtTime display includes (matchesWithDuration) behind the time', () => {
    const players: Record<string, PlayerRecord> = {
      a: synthPlayer('a', 'Alpha', { wins: 15, losses: 5, courtMinutes: 750, matchesWithDuration: 20 }),
      b: synthPlayer('b', 'Beta',  { wins: 10, losses: 5, courtMinutes: 90,  matchesWithDuration: 3  }),
      c: synthPlayer('c', 'Gamma', { wins: 5,  losses: 5, courtMinutes: 0,   matchesWithDuration: 0  }), // excluded
    }
    const lb = buildLeaderboards('bat', players)
    const board = lb.boards.find(b => b.id === 'headline.courtTime')!
    expect(board.entries.length).toBe(2)
    for (const e of board.entries) {
      const p = players[e.slug]
      expect(e.display).toMatch(/ \(\d+\)$/)
      expect(e.display).toContain(`(${p.matchCharacter.matchesWithDuration ?? 0})`)
    }
    // Alpha: 750 min = 12h 30m, 20 matches with a duration.
    const a = board.entries.find(e => e.slug === 'a')!
    expect(a.display).toBe('12h 30m (20)')
  })

  it('headline.courtTime falls back to (0) when matchesWithDuration is missing', () => {
    const players: Record<string, PlayerRecord> = {
      // Note: matchesWithDuration intentionally omitted (undefined) — simulates a stale index.
      a: synthPlayer('a', 'Stale', { wins: 10, losses: 5, courtMinutes: 60 }),
    }
    const lb = buildLeaderboards('bat', players)
    const board = lb.boards.find(b => b.id === 'headline.courtTime')!
    expect(board.entries[0].display).toBe('1h (0)')
  })

  it('character.deciderRecord display includes (wins/total) behind the percent', () => {
    const players: Record<string, PlayerRecord> = {
      // 6/10 = 60%, qualifies
      a: synthPlayer('a', 'Alpha', { wins: 6, losses: 4, threeSetterWins: 6, threeSetterCount: 10 }),
      // 5/8 = 62.5% → rounds to 63%, qualifies
      b: synthPlayer('b', 'Beta',  { wins: 5, losses: 3, threeSetterWins: 5, threeSetterCount: 8 }),
      // 4 three-setters, below the min5 qualifier
      c: synthPlayer('c', 'Gamma', { wins: 2, losses: 2, threeSetterWins: 2, threeSetterCount: 4 }),
    }
    const lb = buildLeaderboards('bat', players)
    const board = lb.boards.find(b => b.id === 'character.deciderRecord')!
    expect(board.entries.length).toBe(2)
    for (const e of board.entries) {
      const p = players[e.slug]
      expect(e.display).toMatch(/^\d+% \(\d+\/\d+\)$/)
      expect(e.display).toContain(`(${p.matchCharacter.threeSetterWins}/${p.matchCharacter.threeSetterCount})`)
    }
    // Spot-check Alpha: 6/10 = 60%.
    expect(board.entries.find(e => e.slug === 'a')!.display).toBe('60% (6/10)')
    expect(board.entries.find(e => e.slug === 'b')!.display).toBe('63% (5/8)')
  })
})

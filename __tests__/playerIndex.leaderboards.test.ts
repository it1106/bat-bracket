import path from 'path'
import fs from 'fs'
import { buildIndex } from '@/lib/playerIndex'
import type { MatchesData, PlayerIndexTournamentInput } from '@/lib/types'

function loadInput(slug: string, name: string, date: string): PlayerIndexTournamentInput {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}.json`), 'utf8')) as MatchesData
  const clubs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}-clubs.json`), 'utf8')) as Record<string, string>
  delete (clubs as Record<string, string>)._meta
  return { tournamentId: slug.toUpperCase(), tournamentName: name, tournamentDateIso: date, data, clubs }
}

describe('buildIndex — leaderboards', () => {
  const toyota = loadInput('toyota', 'Toyota', '2026-05-01')
  const trang = loadInput('trang', 'Trang', '2026-04-15')

  it('produces all 12 v1 boards', () => {
    const { leaderboards } = buildIndex('bat', [toyota, trang])
    const ids = leaderboards.boards.map(b => b.id).sort()
    expect(ids).toEqual([
      'activity.matchesLast90', 'activity.tournamentsEntered',
      'character.comebacks', 'character.deciderRecord', 'character.threeSetterWins',
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
})

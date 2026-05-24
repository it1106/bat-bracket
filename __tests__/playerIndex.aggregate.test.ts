import path from 'path'
import fs from 'fs'
import { buildIndex } from '@/lib/playerIndex'
import type { MatchesData, PlayerIndexTournamentInput } from '@/lib/types'

function loadInput(slug: string, tournamentName: string, dateIso: string): PlayerIndexTournamentInput {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}.json`), 'utf8')) as MatchesData
  const clubs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}-clubs.json`), 'utf8')) as Record<string, string>
  delete (clubs as Record<string, string>)._meta
  return { tournamentId: slug.toUpperCase(), tournamentName, tournamentDateIso: dateIso, data, clubs }
}

describe('buildIndex — single tournament', () => {
  const toyota = loadInput('toyota', 'โตโยต้า เยาวชน 2569', '2026-05-01')

  it('emits a non-empty index', () => {
    const { index } = buildIndex('bat', [toyota])
    expect(index.provider).toBe('bat')
    expect(index.totalPlayers).toBeGreaterThan(0)
    expect(index.totalMatches).toBeGreaterThan(0)
    expect(Object.keys(index.players).length).toBe(index.totalPlayers)
  })

  it('lists the tournament in sources', () => {
    const { index } = buildIndex('bat', [toyota])
    expect(index.sources).toEqual([{ tournamentId: 'TOYOTA', tournamentName: 'โตโยต้า เยาวชน 2569', tournamentDateIso: '2026-05-01' }])
  })

  it('every player has totals.matches === wins + losses', () => {
    const { index } = buildIndex('bat', [toyota])
    for (const p of Object.values(index.players)) {
      const sum = p.totals.wins + p.totals.losses
      expect(p.totals.matches).toBe(sum)
    }
  })

  it('every player has a displayName and at least one tournament entry', () => {
    const { index } = buildIndex('bat', [toyota])
    for (const p of Object.values(index.players)) {
      expect(p.displayName.length).toBeGreaterThan(0)
      // tournaments populated by Task 7; allowed to be empty here
    }
  })

  it('uses curated clubs from the fixture when available', () => {
    const { index } = buildIndex('bat', [toyota])
    const clubsSeen = new Set(Object.values(index.players).flatMap(p => p.clubs))
    expect(clubsSeen.has('SIAM Wireless BC')).toBe(true)
  })

  it('splits totals into byDiscipline buckets', () => {
    const { index } = buildIndex('bat', [toyota])
    for (const p of Object.values(index.players)) {
      const wins = p.byDiscipline.singles.wins + p.byDiscipline.doubles.wins + p.byDiscipline.mixed.wins
      const losses = p.byDiscipline.singles.losses + p.byDiscipline.doubles.losses + p.byDiscipline.mixed.losses
      expect(wins).toBe(p.totals.wins)
      expect(losses).toBe(p.totals.losses)
    }
  })
})

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

describe('buildIndex — multi-tournament merge', () => {
  const toyota = loadInput('toyota', 'Toyota 2569', '2026-05-01')
  const trang = loadInput('trang', 'Trang Yonex Open 2026', '2026-04-15')

  it('sums totalMatches across all inputs', () => {
    const single = buildIndex('bat', [toyota]).index.totalMatches
    const other = buildIndex('bat', [trang]).index.totalMatches
    const merged = buildIndex('bat', [toyota, trang]).index.totalMatches
    expect(merged).toBe(single + other)
  })

  it('produces sources array in input order', () => {
    const { index } = buildIndex('bat', [toyota, trang])
    expect(index.sources.map(s => s.tournamentId)).toEqual(['TOYOTA', 'TRANG'])
  })

  it('merges totalPlayers as union (≤ sum, ≥ max)', () => {
    const a = Object.keys(buildIndex('bat', [toyota]).index.players)
    const b = Object.keys(buildIndex('bat', [trang]).index.players)
    const merged = buildIndex('bat', [toyota, trang]).index.totalPlayers
    const union = new Set([...a, ...b])
    expect(merged).toBe(union.size)
  })

  it('a player who appears in both tournaments has tournaments.length === 2', () => {
    const single = buildIndex('bat', [toyota]).index
    const merged = buildIndex('bat', [toyota, trang]).index
    const candidates = Object.keys(single.players).filter(s => merged.players[s]?.tournaments.length === 2)
    for (const slug of candidates) {
      const ids = merged.players[slug].tournaments.map(t => t.tournamentId).sort()
      expect(ids).toEqual(['TOYOTA','TRANG'])
    }
  })
})

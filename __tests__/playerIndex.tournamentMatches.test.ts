import path from 'path'
import fs from 'fs'
import { buildIndex } from '@/lib/playerIndex'
import type { MatchesData, PlayerIndexTournamentInput } from '@/lib/types'

// Reuse the Toyota fixture already used by playerIndex.aggregate.test.ts.
function loadInput(slug: string, tournamentName: string, dateIso: string): PlayerIndexTournamentInput {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}.json`), 'utf8')) as MatchesData
  const clubs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', `player-index-${slug}-clubs.json`), 'utf8')) as Record<string, string>
  delete (clubs as Record<string, string>)._meta
  return { tournamentId: slug.toUpperCase(), tournamentName, tournamentDateIso: dateIso, data, clubs }
}

describe('buildIndex — tournamentMatches lookup', () => {
  const toyota = loadInput('toyota', 'โตโยต้า เยาวชน 2569', '2026-05-01')

  it('populates tournamentMatches for every event the player participated in', () => {
    const { index } = buildIndex('bat', [toyota])
    for (const p of Object.values(index.players)) {
      for (const t of p.tournaments) {
        for (const e of t.events) {
          const key = `${t.tournamentId}:${e.eventId}`
          const matches = p.tournamentMatches?.[key]
          expect(matches).toBeDefined()
          expect(matches!.length).toBeGreaterThan(0)
          // win+loss counts agree with the aggregate
          const wins = matches!.filter(m => m.outcome === 'W' || m.outcome === 'WO-W' || m.outcome === 'RET-W').length
          const losses = matches!.length - wins
          expect(wins).toBe(e.wins)
          expect(losses).toBe(e.losses)
        }
      }
    }
  })

  it('orders matches with the deepest round first', () => {
    const { index } = buildIndex('bat', [toyota])
    // Find a player who reached at least the Final (Champion or runner-up) so
    // we have an unambiguous deepest-round expectation.
    const finalist = Object.values(index.players).find(p =>
      p.tournaments.some(t => t.events.some(e => e.bestFinish === 'Champion' || e.bestFinish === 'F')),
    )
    expect(finalist).toBeDefined()
    for (const t of finalist!.tournaments) {
      for (const e of t.events) {
        if (e.bestFinish !== 'Champion' && e.bestFinish !== 'F') continue
        const matches = finalist!.tournamentMatches?.[`${t.tournamentId}:${e.eventId}`]
        expect(matches).toBeDefined()
        // First entry must be the Final.
        expect(matches![0].round).toBe('Final')
      }
    }
  })

  it('only retains the trimmed fields on each entry', () => {
    const { index } = buildIndex('bat', [toyota])
    const allowed = new Set(['round', 'partners', 'opponents', 'scores', 'outcome'])
    for (const p of Object.values(index.players)) {
      for (const matches of Object.values(p.tournamentMatches ?? {})) {
        for (const m of matches) {
          for (const k of Object.keys(m)) expect(allowed.has(k)).toBe(true)
        }
      }
    }
  })

  it('keys are unique within a player and follow the tournamentId:eventId shape', () => {
    const { index } = buildIndex('bat', [toyota])
    for (const p of Object.values(index.players)) {
      if (!p.tournamentMatches) continue
      const keys = Object.keys(p.tournamentMatches)
      expect(new Set(keys).size).toBe(keys.length)
      for (const k of keys) expect(k).toMatch(/^[^:]+:[^:]+$/)
    }
  })
})

import fs from 'fs'
import nodePath from 'path'
import { parseBracketRounds } from '@/lib/scraper'
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
})

import { aggregate } from '@/lib/tournamentStats'
import type { MatchEntry, MatchesData, MatchScheduleGroup, MatchPlayer, MatchScore } from '@/lib/types'

function match(
  draw: string,
  round: string,
  t1: MatchPlayer[],
  t2: MatchPlayer[],
  winner: 1 | 2 | null,
  scores: MatchScore[],
  opts: { eventName?: string; walkover?: boolean; retired?: boolean } = {},
): MatchEntry {
  return {
    draw, drawNum: draw, round,
    team1: t1, team2: t2, winner, scores,
    court: '', walkover: opts.walkover ?? false, retired: opts.retired ?? false, nowPlaying: false,
    ...(opts.eventName ? { eventName: opts.eventName } : {}),
  }
}

const som = { name: 'Somchai', playerId: '1', country: 'THA' }
const xa = { name: 'Xa', playerId: 'x', country: 'THA' }
const ya = { name: 'Ya', playerId: 'y', country: 'THA' }
const za = { name: 'Za', playerId: 'z', country: 'THA' }
const wa = { name: 'Wa', playerId: 'w', country: 'THA' }

function build(matches: MatchEntry[], dateIso = '2026-07-01') {
  const group: MatchScheduleGroup = { type: 'time', time: '10:00', matches }
  const data: MatchesData = {
    days: [{ date: '01/07', label: '01/07', dateIso, hasMatches: true }],
    currentDate: dateIso, groups: [group],
  }
  return aggregate(data, new Map([[dateIso, [group]]]), {})
}

function resultsOf(stats: ReturnType<typeof aggregate>, event: string) {
  const tha = stats.countryRosters.find((c) => c.country === 'THA')!
  const m = tha.roster!.find((x) => x.playerId === '1')!
  return (m.results ?? []).filter((r) => r.event === event)
}

describe('buildPlayerResultsByPlayer via aggregate', () => {
  it('orders a player\'s event results newest-first (deepest round), excludes walkovers, flags results won/lost', () => {
    const stats = build([
      match('MS', 'Quarter Final', [som], [xa], 1, [{ t1: 21, t2: 10 }, { t1: 21, t2: 15 }]),
      match('MS', 'Semi Final', [som], [ya], 1, [{ t1: 21, t2: 18 }, { t1: 21, t2: 16 }]),
      match('MS', 'Final', [som], [za], 2, [{ t1: 19, t2: 21 }, { t1: 15, t2: 21 }]),
      match('MS', 'Round 1', [som], [wa], 1, [], { walkover: true }), // excluded
    ])
    const r = resultsOf(stats, 'MS')
    expect(r.map((x) => x.round)).toEqual(['Final', 'Semi Final', 'Quarter Final'])
    expect(r.map((x) => x.won)).toEqual([false, true, true])
    expect(r[0].opponent).toEqual(['Za'])
    expect(r[0].scores).toEqual([{ t1: 19, t2: 21 }, { t1: 15, t2: 21 }])
  })

  it('stores scores in the player\'s perspective when the player is team 2', () => {
    const stats = build([
      match('MD', 'Quarter Final', [xa], [som], 2, [{ t1: 15, t2: 21 }]),
    ])
    const r = resultsOf(stats, 'MD')
    expect(r).toHaveLength(1)
    expect(r[0].won).toBe(true)
    expect(r[0].scores).toEqual([{ t1: 21, t2: 15 }]) // flipped to Somchai's side
  })

  it('keys results by the collapsed event name for grouped formats', () => {
    const stats = build([
      match('MS - Group A', 'Round Robin', [som], [xa], 1, [{ t1: 21, t2: 12 }], { eventName: 'MS' }),
    ])
    expect(resultsOf(stats, 'MS')).toHaveLength(1)
    expect(resultsOf(stats, 'MS - Group A')).toHaveLength(0)
  })
})

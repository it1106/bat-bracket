import { buildOpponentsByWindow } from '@/lib/playerIndex'
import type { PlayerMatchRef, OpponentTimeWindow } from '@/lib/types'

const DAY_MS = 86_400_000
const NOW = Date.parse('2026-06-01T00:00:00Z')  // latest match anchor
function iso(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY_MS).toISOString().slice(0, 10)
}

function ref(p: {
  opp: string, oppSlug: string, daysAgo: number, outcome: PlayerMatchRef['outcome'],
  round?: string, eventName?: string,
}): PlayerMatchRef {
  return {
    tournamentId: 'T', tournamentName: 'T', tournamentDateIso: iso(p.daysAgo),
    eventId: 'E', eventName: p.eventName ?? 'BS', drawNum: '1',
    round: p.round ?? 'R16',
    partners: [], opponents: [p.opp], opponentSlugs: [p.oppSlug],
    partnerSlugs: [], scores: [{ t1: 21, t2: 19 }, { t1: 21, t2: 18 }],
    outcome: p.outcome,
    scheduledDateIso: iso(p.daysAgo),
  }
}

describe('buildOpponentsByWindow', () => {
  it('returns a list per window keyed 30d/90d/180d/1y/all', () => {
    const out = buildOpponentsByWindow([], NOW)
    const keys: OpponentTimeWindow[] = ['30d', '90d', '180d', '1y', 'all']
    for (const k of keys) expect(Array.isArray(out[k])).toBe(true)
  })

  it('bucket "all" matches the lifetime aggregate', () => {
    const refs = [
      ref({ opp: 'A', oppSlug: 'a', daysAgo: 10, outcome: 'W' }),
      ref({ opp: 'A', oppSlug: 'a', daysAgo: 200, outcome: 'L' }),
      ref({ opp: 'B', oppSlug: 'b', daysAgo: 400, outcome: 'W' }),
    ]
    const out = buildOpponentsByWindow(refs, NOW)
    const a = out.all.find(o => o.slug === 'a')!
    const b = out.all.find(o => o.slug === 'b')!
    expect(a.meetings).toBe(2); expect(a.wins).toBe(1); expect(a.losses).toBe(1)
    expect(b.meetings).toBe(1); expect(b.wins).toBe(1); expect(b.losses).toBe(0)
  })

  it('windows exclude meetings outside their cutoff', () => {
    const refs = [
      ref({ opp: 'A', oppSlug: 'a', daysAgo: 10,  outcome: 'W' }), // in every window
      ref({ opp: 'B', oppSlug: 'b', daysAgo: 60,  outcome: 'L' }), // 90d/180d/1y/all
      ref({ opp: 'C', oppSlug: 'c', daysAgo: 120, outcome: 'W' }), // 180d/1y/all
      ref({ opp: 'D', oppSlug: 'd', daysAgo: 250, outcome: 'L' }), // 1y/all
      ref({ opp: 'E', oppSlug: 'e', daysAgo: 400, outcome: 'W' }), // all only
    ]
    const out = buildOpponentsByWindow(refs, NOW)
    expect(out['30d'].map(o => o.slug).sort()).toEqual(['a'])
    expect(out['90d'].map(o => o.slug).sort()).toEqual(['a', 'b'])
    expect(out['180d'].map(o => o.slug).sort()).toEqual(['a', 'b', 'c'])
    expect(out['1y'].map(o => o.slug).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(out.all.map(o => o.slug).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('lastRound/lastEvent reflect the most recent meeting within the window', () => {
    // Two meetings with opponent X: newer in window, older outside.
    const refs = [
      ref({ opp: 'X', oppSlug: 'x', daysAgo: 20,  outcome: 'W', round: 'R16', eventName: 'BS' }),
      ref({ opp: 'X', oppSlug: 'x', daysAgo: 150, outcome: 'W', round: 'Final', eventName: 'XD' }),
    ]
    const out = buildOpponentsByWindow(refs, NOW)
    const x30 = out['30d'].find(o => o.slug === 'x')!
    const xAll = out.all.find(o => o.slug === 'x')!
    expect(x30.lastRound).toBe('R16');   expect(x30.lastEvent).toBe('BS')
    expect(xAll.lastRound).toBe('R16');  expect(xAll.lastEvent).toBe('BS')
  })

  it('refs missing scheduledDateIso are excluded from windowed buckets but kept in "all"', () => {
    const undatedRef: PlayerMatchRef = {
      ...ref({ opp: 'U', oppSlug: 'u', daysAgo: 5, outcome: 'W' }),
      scheduledDateIso: undefined,
    }
    const out = buildOpponentsByWindow([undatedRef], NOW)
    expect(out['30d']).toHaveLength(0)
    expect(out['90d']).toHaveLength(0)
    expect(out.all.map(o => o.slug)).toEqual(['u'])
  })

  it('caps every bucket at top 12 by meetings desc, wins desc, slug asc', () => {
    const refs: PlayerMatchRef[] = []
    for (let i = 0; i < 20; i++) {
      const slug = `p${String(i).padStart(2, '0')}`
      // p00 = 20 meetings, p01 = 19, …
      const meetings = 20 - i
      for (let m = 0; m < meetings; m++) {
        refs.push(ref({ opp: slug, oppSlug: slug, daysAgo: 5, outcome: 'W' }))
      }
    }
    const out = buildOpponentsByWindow(refs, NOW)
    expect(out.all).toHaveLength(12)
    expect(out['30d']).toHaveLength(12)
    expect(out.all[0].slug).toBe('p00')
    expect(out.all[11].slug).toBe('p11')
  })

  it('returns five empty arrays when nowMs is 0', () => {
    const out = buildOpponentsByWindow([], 0)
    for (const k of ['30d', '90d', '180d', '1y', 'all'] as OpponentTimeWindow[]) {
      expect(out[k]).toEqual([])
    }
  })
})

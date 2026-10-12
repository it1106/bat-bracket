import { duePublications, probeTargets, PROBE_CAP, type TournamentSnapshot } from '@/lib/push/publications'
import { EMPTY_PUBLISHED, type PublishedState } from '@/lib/push/published-state'

const TID = 'AAAAAAAA-0000-0000-0000-000000000001'
const TODAY = '2026-10-12'
const NOW = '2026-10-12T04:00:00.000Z'

const snap = (over: Partial<TournamentSnapshot> = {}): TournamentSnapshot => ({
  id: TID, name: 'THE MALL 2026', draws: [], days: [], ...over,
})
const seeded = (tournaments: PublishedState['tournaments'] = {}): PublishedState => ({ version: 1, seeded: true, tournaments })
const entry = (over: Partial<PublishedState['tournaments'][string]> = {}) => ({
  name: 'THE MALL 2026', firstSeenAt: NOW, announced: true, draws: [], days: [], ...over,
})
const due = (snapshots: TournamentSnapshot[], state = seeded()) =>
  duePublications({ snapshots, state, todayIso: TODAY, nowIso: NOW })

describe('duePublications — first run', () => {
  it('announces nothing and records the whole snapshot', () => {
    const r = due([snap({
      draws: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }],
      days: [{ dateIso: '2026-10-20', hasMatches: true }],
    })], EMPTY_PUBLISHED)
    expect(r.publications).toEqual([])
    expect(r.state.seeded).toBe(true)
    expect(r.state.tournaments[TID]).toEqual(expect.objectContaining({ announced: true, draws: ['1'], days: ['2026-10-20'] }))
  })
})

describe('duePublications — a new tournament', () => {
  it('announces the tournament once and records its draws and days silently', () => {
    const r = due([snap({
      draws: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }],
      days: [{ dateIso: '2026-10-20', hasMatches: true }],
    })])
    expect(r.publications).toEqual([{ kind: 'tournament', tournamentId: TID, tournamentName: 'THE MALL 2026', items: [] }])
    expect(r.state.tournaments[TID].draws).toEqual(['1'])
    expect(r.state.tournaments[TID].days).toEqual(['2026-10-20'])
    // A second pass over the same snapshot says nothing.
    expect(due([snap({ draws: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }], days: [{ dateIso: '2026-10-20', hasMatches: true }] })], r.state).publications).toEqual([])
  })
})

describe('duePublications — draws', () => {
  it('announces draws that hold entries, and again when a later batch lands', () => {
    const first = due([snap({ draws: [
      { drawNum: '1', name: 'BS U15', entrantCount: 16 },
      { drawNum: '2', name: 'GS U15', entrantCount: 8 },
      { drawNum: '3', name: 'BD U17', entrantCount: 0 },
    ] })], seeded({ [TID]: entry() }))
    expect(first.publications).toEqual([{ kind: 'bracket', tournamentId: TID, tournamentName: 'THE MALL 2026', items: ['BS U15', 'GS U15'] }])
    expect(first.state.tournaments[TID].draws).toEqual(['1', '2'])

    const second = due([snap({ draws: [
      { drawNum: '1', name: 'BS U15', entrantCount: 16 },
      { drawNum: '3', name: 'BD U17', entrantCount: 12 },
    ] })], first.state)
    expect(second.publications).toEqual([{ kind: 'bracket', tournamentId: TID, tournamentName: 'THE MALL 2026', items: ['BD U17'] }])
    expect(second.state.tournaments[TID].draws).toEqual(['1', '2', '3'])
  })

  it('never fires or records a draw whose count is zero or unknown', () => {
    const r = due([snap({ draws: [
      { drawNum: '1', name: 'BS U15', entrantCount: 0 },
      { drawNum: '2', name: 'GS U15' },
    ] })], seeded({ [TID]: entry() }))
    expect(r.publications).toEqual([])
    expect(r.state.tournaments[TID].draws).toEqual([])
  })

  it('names a repeated draw once and ignores an empty draw number', () => {
    const r = due([snap({ draws: [
      { drawNum: '1', name: 'BS U15', entrantCount: 16 },
      { drawNum: '1', name: 'BS U15', entrantCount: 16 },
      { drawNum: '', name: 'Nameless', entrantCount: 4 },
    ] })], seeded({ [TID]: entry() }))
    expect(r.publications[0].items).toEqual(['BS U15'])
    expect(r.state.tournaments[TID].draws).toEqual(['1'])
  })

  it('leaves the draws alone when they could not be read', () => {
    const r = due([snap({ draws: null })], seeded({ [TID]: entry({ draws: ['1'] }) }))
    expect(r.publications).toEqual([])
    expect(r.state.tournaments[TID].draws).toEqual(['1'])
  })
})

describe('duePublications — schedule', () => {
  it('announces new future playing days only', () => {
    const r = due([snap({ days: [
      { dateIso: '2026-10-11', hasMatches: true },
      { dateIso: TODAY, hasMatches: true },
      { dateIso: '2026-10-20', hasMatches: true },
      { dateIso: '2026-10-21', hasMatches: false },
      { dateIso: '2026-10-22' },
    ] })], seeded({ [TID]: entry() }))
    expect(r.publications).toEqual([{ kind: 'schedule', tournamentId: TID, tournamentName: 'THE MALL 2026', items: ['2026-10-20'] }])
    expect(r.state.tournaments[TID].days).toEqual(['2026-10-20'])
  })

  it('does not announce a day it has already announced', () => {
    const r = due([snap({ days: [{ dateIso: '2026-10-20', hasMatches: true }] })], seeded({ [TID]: entry({ days: ['2026-10-20'] }) }))
    expect(r.publications).toEqual([])
  })
})

describe('duePublications — names', () => {
  it('announces under the name upstream shows now, not the stored one', () => {
    const r = due([snap({ name: 'THE MALL 2026 (rescheduled)', draws: [{ drawNum: '1', name: 'BS U15', entrantCount: 16 }] })],
      seeded({ [TID]: entry({ name: 'THE MALL 2026' }) }))
    expect(r.publications[0].tournamentName).toBe('THE MALL 2026 (rescheduled)')
    expect(r.state.tournaments[TID].name).toBe('THE MALL 2026 (rescheduled)')
  })
})

describe('probeTargets', () => {
  const draws = [
    { drawNum: '1', name: 'A', entrantCount: 16 },
    { drawNum: '2', name: 'B', entrantCount: 0 },
    { drawNum: '3', name: 'C' },
    { drawNum: '4', name: 'D', entrantCount: 0 },
  ]

  it('probes un-announced draws whose count is zero or unknown, never the announced ones', () => {
    const r = probeTargets(draws, new Set(['1']), PROBE_CAP, 0)
    expect(r.drawNums).toEqual(['2', '3', '4'])
  })

  it('never probes a draw already known to hold entries', () => {
    expect(probeTargets([{ drawNum: '1', name: 'A', entrantCount: 16 }], new Set(), PROBE_CAP, 0).drawNums).toEqual([])
  })

  it('caps the batch and rotates so a later pass covers the rest', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ drawNum: String(i + 1), name: `D${i}`, entrantCount: 0 }))
    const first = probeTargets(many, new Set(), 5, 0)
    expect(first.drawNums).toEqual(['1', '2', '3', '4', '5'])
    const second = probeTargets(many, new Set(), 5, first.nextCursor)
    expect(second.drawNums).toEqual(['6', '7', '1', '2', '3'])
  })
})

import { mergeForApi, sortNewestFirst } from '@/lib/tournaments-merge'
import type { DiscoveryStore } from '@/lib/discovery-store'
import type { TournamentInfo } from '@/lib/types'

describe('mergeForApi', () => {
  it('returns manual entries when discovered store is empty', () => {
    const result = mergeForApi(
      [
        { id: 'AAAA1111-2222-3333-4444-555555555555', name: 'Manual', done: true },
      ],
      new Set(),
      { version: 1, entries: [] },
    )
    expect(result).toEqual([
      { id: 'AAAA1111-2222-3333-4444-555555555555', name: 'Manual', done: true },
    ])
  })

  it('includes discovered entries with hasBracket=true', () => {
    const store: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: 'BBBB2222-2222-3333-4444-555555555555',
          name: 'Discovered',
          hasBracket: true,
          discoveredAt: 'x',
          lastSeenOnUpcomingAt: 'x',
        },
      ],
    }
    const result = mergeForApi([], new Set(), store)
    expect(result).toEqual([{ id: 'BBBB2222-2222-3333-4444-555555555555', name: 'Discovered' }])
  })

  it('excludes discovered entries with hasBracket=false', () => {
    const store: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: 'CCCC3333-2222-3333-4444-555555555555',
          name: 'Not yet',
          hasBracket: false,
          discoveredAt: 'x',
          lastSeenOnUpcomingAt: 'x',
        },
      ],
    }
    const result = mergeForApi([], new Set(), store)
    expect(result).toEqual([])
  })

  it('manual entry wins on id conflict (preserves name + done flag)', () => {
    const store: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: 'DDDD4444-2222-3333-4444-555555555555',
          name: 'BAT name',
          hasBracket: true,
          discoveredAt: 'x',
          lastSeenOnUpcomingAt: 'x',
        },
      ],
    }
    const result = mergeForApi(
      [{ id: 'DDDD4444-2222-3333-4444-555555555555', name: 'Curated name', done: true }],
      new Set(),
      store,
    )
    expect(result).toEqual([
      { id: 'DDDD4444-2222-3333-4444-555555555555', name: 'Curated name', done: true },
    ])
  })

  it('drops ids in the deny set from both sources', () => {
    const denied = 'EEEE5555-2222-3333-4444-555555555555'
    const store: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: denied,
          name: 'Discovered',
          hasBracket: true,
          discoveredAt: 'x',
          lastSeenOnUpcomingAt: 'x',
        },
      ],
    }
    const result = mergeForApi(
      [{ id: denied, name: 'Manual', done: false }],
      new Set([denied]),
      store,
    )
    expect(result).toEqual([])
  })
})

describe('sortNewestFirst', () => {
  it('sorts by startDateIso descending (newest first)', () => {
    const input: TournamentInfo[] = [
      { id: 'A', name: 'Old', startDateIso: '2026-01-01' },
      { id: 'B', name: 'New', startDateIso: '2026-05-01' },
      { id: 'C', name: 'Mid', startDateIso: '2026-03-01' },
    ]
    const result = sortNewestFirst(input)
    expect(result.map((e) => e.id)).toEqual(['B', 'C', 'A'])
  })

  it('places entries without startDateIso at the bottom (preserving relative order)', () => {
    const input: TournamentInfo[] = [
      { id: 'A', name: 'Undated 1' },
      { id: 'B', name: 'Dated', startDateIso: '2026-05-01' },
      { id: 'C', name: 'Undated 2' },
    ]
    const result = sortNewestFirst(input)
    expect(result.map((e) => e.id)).toEqual(['B', 'A', 'C'])
  })

  it('does not mutate input', () => {
    const input: TournamentInfo[] = [
      { id: 'A', name: 'A', startDateIso: '2026-01-01' },
      { id: 'B', name: 'B', startDateIso: '2026-05-01' },
    ]
    const before = JSON.stringify(input)
    sortNewestFirst(input)
    expect(JSON.stringify(input)).toEqual(before)
  })

  it('preserves done flag during sort', () => {
    const input: TournamentInfo[] = [
      { id: 'A', name: 'A', startDateIso: '2026-01-01', done: true },
      { id: 'B', name: 'B', startDateIso: '2026-05-01' },
    ]
    const result = sortNewestFirst(input)
    expect(result[0]).toEqual({ id: 'B', name: 'B', startDateIso: '2026-05-01' })
    expect(result[1]).toEqual({ id: 'A', name: 'A', startDateIso: '2026-01-01', done: true })
  })
})

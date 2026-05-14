import { mergeForApi, sortTournamentsForDropdown } from '@/lib/tournaments-merge'
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

describe('sortTournamentsForDropdown', () => {
  it('sorts active entries by startDateIso ascending (earliest first)', () => {
    const input: TournamentInfo[] = [
      { id: 'A', name: 'Late', startDateIso: '2026-05-01' },
      { id: 'B', name: 'Early', startDateIso: '2026-01-01' },
      { id: 'C', name: 'Mid', startDateIso: '2026-03-01' },
    ]
    const result = sortTournamentsForDropdown(input)
    expect(result.map((e) => e.id)).toEqual(['B', 'C', 'A'])
  })

  it('sorts done entries by startDateIso descending (newest first)', () => {
    const input: TournamentInfo[] = [
      { id: 'A', name: 'Old', startDateIso: '2025-01-01', done: true },
      { id: 'B', name: 'Newest', startDateIso: '2025-12-01', done: true },
      { id: 'C', name: 'Mid', startDateIso: '2025-06-01', done: true },
    ]
    const result = sortTournamentsForDropdown(input)
    expect(result.map((e) => e.id)).toEqual(['B', 'C', 'A'])
  })

  it('places active entries before done entries regardless of dates', () => {
    const input: TournamentInfo[] = [
      { id: 'D1', name: 'Done recent', startDateIso: '2026-04-01', done: true },
      { id: 'A1', name: 'Active later', startDateIso: '2027-01-01' },
      { id: 'A2', name: 'Active earlier', startDateIso: '2026-06-01' },
    ]
    const result = sortTournamentsForDropdown(input)
    expect(result.map((e) => e.id)).toEqual(['A2', 'A1', 'D1'])
  })

  it('places undated entries at the bottom of their bucket (preserving relative order)', () => {
    const input: TournamentInfo[] = [
      { id: 'A1', name: 'Undated active 1' },
      { id: 'A2', name: 'Dated active', startDateIso: '2026-05-01' },
      { id: 'A3', name: 'Undated active 2' },
      { id: 'D1', name: 'Undated done 1', done: true },
      { id: 'D2', name: 'Dated done', startDateIso: '2025-05-01', done: true },
    ]
    const result = sortTournamentsForDropdown(input)
    expect(result.map((e) => e.id)).toEqual(['A2', 'A1', 'A3', 'D2', 'D1'])
  })

  it('does not mutate input', () => {
    const input: TournamentInfo[] = [
      { id: 'A', name: 'A', startDateIso: '2026-01-01' },
      { id: 'B', name: 'B', startDateIso: '2026-05-01' },
    ]
    const before = JSON.stringify(input)
    sortTournamentsForDropdown(input)
    expect(JSON.stringify(input)).toEqual(before)
  })
})

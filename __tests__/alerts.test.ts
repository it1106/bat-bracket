/**
 * @jest-environment jsdom
 */
import { getAlerts, dismissAlerts, recordTournamentSnapshot } from '@/lib/alerts'
import type { TournamentInfo } from '@/lib/types'

beforeEach(() => {
  localStorage.clear()
})

describe('alerts: pending list helpers', () => {
  it('returns [] when nothing is stored', () => {
    expect(getAlerts()).toEqual([])
  })

  it('returns [] when JSON is malformed and clears the corrupt key', () => {
    localStorage.setItem('batbracket.alerts.pending', '{not json')
    expect(getAlerts()).toEqual([])
    expect(localStorage.getItem('batbracket.alerts.pending')).toBeNull()
  })

  it('dismissAlerts() clears pending and returns []', () => {
    localStorage.setItem(
      'batbracket.alerts.pending',
      JSON.stringify([{ kind: 'tournament', id: 't:abc', tournamentId: 'abc', tournamentName: 'X', addedAt: '2026-05-09T00:00:00Z' }]),
    )
    expect(dismissAlerts()).toEqual([])
    expect(localStorage.getItem('batbracket.alerts.pending')).toBeNull()
  })
})

describe('recordTournamentSnapshot', () => {
  it('first call seeds snapshot silently and sets bootstrapped', () => {
    const list: TournamentInfo[] = [
      { id: 'A', name: 'Alpha' },
      { id: 'B', name: 'Beta' },
    ]
    expect(recordTournamentSnapshot(list)).toEqual([])
    expect(localStorage.getItem('batbracket.alerts.bootstrapped')).toBe('1')
    expect(JSON.parse(localStorage.getItem('batbracket.alerts.seenTournaments')!)).toEqual({
      A: { name: 'Alpha' },
      B: { name: 'Beta' },
    })
  })

  it('detects a newly-added non-done tournament after bootstrap', () => {
    recordTournamentSnapshot([{ id: 'A', name: 'Alpha' }])
    const after = recordTournamentSnapshot([
      { id: 'A', name: 'Alpha' },
      { id: 'B', name: 'Beta' },
    ])
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({
      kind: 'tournament',
      id: 't:B',
      tournamentId: 'B',
      tournamentName: 'Beta',
    })
  })

  it('does not alert for done tournaments', () => {
    recordTournamentSnapshot([{ id: 'A', name: 'Alpha' }])
    const after = recordTournamentSnapshot([
      { id: 'A', name: 'Alpha' },
      { id: 'C', name: 'Old', done: true },
    ])
    expect(after).toEqual([])
  })

  it('rename does not fire (id stays the same)', () => {
    recordTournamentSnapshot([{ id: 'A', name: 'Alpha' }])
    const after = recordTournamentSnapshot([{ id: 'A', name: 'Alpha (renamed)' }])
    expect(after).toEqual([])
  })

  it('is idempotent — re-running with same data does not duplicate', () => {
    recordTournamentSnapshot([{ id: 'A', name: 'Alpha' }])
    recordTournamentSnapshot([
      { id: 'A', name: 'Alpha' },
      { id: 'B', name: 'Beta' },
    ])
    const second = recordTournamentSnapshot([
      { id: 'A', name: 'Alpha' },
      { id: 'B', name: 'Beta' },
    ])
    expect(second).toHaveLength(1)
    expect(second[0].id).toBe('t:B')
  })
})

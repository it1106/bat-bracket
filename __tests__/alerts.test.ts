/**
 * @jest-environment jsdom
 */
import { getAlerts, dismissAlerts } from '@/lib/alerts'

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

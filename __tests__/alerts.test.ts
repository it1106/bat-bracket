/**
 * @jest-environment jsdom
 */
import { getAlerts, dismissAlerts, recordTournamentSnapshot, recordScheduleSnapshot, type AlertItem } from '@/lib/alerts'
import type { TournamentInfo, MatchDay } from '@/lib/types'

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

const TODAY = '2026-05-09'

function day(dateIso: string, hasMatches: boolean | undefined): MatchDay {
  return { date: dateIso, label: dateIso, dateIso, hasMatches }
}

describe('recordScheduleSnapshot', () => {
  beforeEach(() => {
    // Skip the bootstrap path so detection runs.
    recordTournamentSnapshot([])
  })

  it('alerts on a future day flipping to hasMatches=true', () => {
    recordScheduleSnapshot('T1', 'Alpha', [day('2026-05-10', false), day('2026-05-11', false)], TODAY)
    const after = recordScheduleSnapshot(
      'T1',
      'Alpha',
      [day('2026-05-10', true), day('2026-05-11', false)],
      TODAY,
    )
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({
      kind: 'schedule',
      id: 's:T1:2026-05-10',
      tournamentId: 'T1',
      tournamentName: 'Alpha',
      dateIso: '2026-05-10',
    })
  })

  it('does not alert for today or past days', () => {
    recordScheduleSnapshot('T1', 'Alpha', [day('2026-05-08', false), day(TODAY, false)], TODAY)
    const after = recordScheduleSnapshot(
      'T1',
      'Alpha',
      [day('2026-05-08', true), day(TODAY, true)],
      TODAY,
    )
    expect(after).toEqual([])
  })

  it('does not alert for hasMatches=false or undefined', () => {
    recordScheduleSnapshot('T1', 'Alpha', [day('2026-05-10', false)], TODAY)
    const after = recordScheduleSnapshot(
      'T1',
      'Alpha',
      [day('2026-05-10', false), day('2026-05-11', undefined)],
      TODAY,
    )
    expect(after).toEqual([])
  })

  it('is idempotent across re-runs', () => {
    recordScheduleSnapshot('T1', 'Alpha', [day('2026-05-10', false)], TODAY)
    const first = recordScheduleSnapshot('T1', 'Alpha', [day('2026-05-10', true)], TODAY)
    expect(first).toHaveLength(1)
    const second = recordScheduleSnapshot('T1', 'Alpha', [day('2026-05-10', true)], TODAY)
    expect(second).toHaveLength(1) // same alert, not a second one
    const pending = JSON.parse(localStorage.getItem('batbracket.alerts.pending')!)
    expect(pending).toHaveLength(1)
  })

  it('separate tournaments are tracked independently', () => {
    recordScheduleSnapshot('T1', 'Alpha', [day('2026-05-10', false)], TODAY)
    recordScheduleSnapshot('T2', 'Beta', [day('2026-05-10', false)], TODAY)
    const after = recordScheduleSnapshot('T2', 'Beta', [day('2026-05-10', true)], TODAY)
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe('s:T2:2026-05-10')
  })

  it('first call before bootstrap seeds silently', () => {
    localStorage.clear()
    const result = recordScheduleSnapshot('T1', 'Alpha', [day('2026-05-10', true)], TODAY)
    expect(result).toEqual([])
    expect(localStorage.getItem('batbracket.alerts.bootstrapped')).toBe('1')
    const seen = JSON.parse(localStorage.getItem('batbracket.alerts.seenScheduleDays')!)
    expect(seen.T1).toEqual(['2026-05-10'])
  })
})

describe('alerts: cap and resilience', () => {
  it('caps pending at 50 items, FIFO-evicting the oldest', () => {
    recordTournamentSnapshot([]) // bootstrap
    // Build 60 distinct tournament ids and add them one by one.
    for (let i = 0; i < 60; i++) {
      recordTournamentSnapshot([{ id: `T${i}`, name: `name-${i}` }])
    }
    const pending: AlertItem[] = JSON.parse(localStorage.getItem('batbracket.alerts.pending')!)
    expect(pending).toHaveLength(50)
    // First 10 should have been evicted; the surviving block should start at T10.
    expect(pending[0].id).toBe('t:T10')
    expect(pending[49].id).toBe('t:T59')
  })

  it('survives corrupted snapshot keys by clearing and re-bootstrapping', () => {
    localStorage.setItem('batbracket.alerts.seenTournaments', '<<garbage>>')
    localStorage.setItem('batbracket.alerts.bootstrapped', '1')
    const result = recordTournamentSnapshot([{ id: 'A', name: 'Alpha' }])
    // After a corrupt snapshot, "seen" is empty, so post-bootstrap we DO alert.
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t:A')
  })
})

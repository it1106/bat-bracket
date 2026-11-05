// /api/player serves BAT players by scraping BAT's own player page, and BWF
// players out of the tournament schedule we already hold.
const fetchBatPlayerProfile = jest.fn()
const fetchBwfPlayerProfile = jest.fn()
const resolveRef = jest.fn()

jest.mock('../lib/bat-player-fetch', () => ({
  fetchBatPlayerProfile: (...a: unknown[]) => fetchBatPlayerProfile(...a),
}))
// The route tells an outage from a missing player by the error's class, so
// the mock has to hand it the very class it will compare against. `var` so
// the factory, which runs with the hoisted imports, can assign to it.
/* eslint-disable no-var */
var mockScheduleUnavailable: new (m?: string) => Error
/* eslint-enable no-var */
jest.mock('../lib/bwf-player-fetch', () => {
  class ScheduleUnavailableError extends Error {}
  mockScheduleUnavailable = ScheduleUnavailableError
  return {
    fetchBwfPlayerProfile: (...a: unknown[]) => fetchBwfPlayerProfile(...a),
    ScheduleUnavailableError,
  }
})
jest.mock('../lib/tournaments-registry', () => ({
  resolveRef: (...a: unknown[]) => resolveRef(...a),
}))

import { GET } from '@/app/api/player/route'

const get = (tid: string, pid = '111') =>
  GET(new Request(`http://x/api/player?tournament=${tid}&player=${pid}`))

const profile = { playerId: '111', name: 'Somchai SAETANG', club: 'Thailand', yob: '', events: [], matches: [] }

beforeEach(() => {
  jest.clearAllMocks()
  fetchBatPlayerProfile.mockResolvedValue({ profile, source: 'fresh' })
  fetchBwfPlayerProfile.mockResolvedValue(profile)
})

describe('/api/player', () => {
  it('reads a BWF player out of the schedule instead of scraping BAT', async () => {
    resolveRef.mockReturnValue({ id: 'T1', provider: 'bwf' })

    const res = await get('T1')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: 'Somchai SAETANG', club: 'Thailand' })
    expect(fetchBwfPlayerProfile).toHaveBeenCalledWith('T1', '111')
    expect(fetchBatPlayerProfile).not.toHaveBeenCalled()
  })

  it('still scrapes BAT for a BAT tournament', async () => {
    resolveRef.mockReturnValue({ id: 'T2', provider: 'bat' })

    const res = await get('T2')

    expect(res.status).toBe(200)
    expect(fetchBatPlayerProfile).toHaveBeenCalled()
    expect(fetchBwfPlayerProfile).not.toHaveBeenCalled()
  })

  it('404s a BWF player who plays no match in the tournament', async () => {
    resolveRef.mockReturnValue({ id: 'T1', provider: 'bwf' })
    fetchBwfPlayerProfile.mockResolvedValue(null)

    const res = await get('T1', '999')

    expect(res.status).toBe(404)
  })

  // A schedule we could not read says nothing about the player, so answering
  // "not found" would be a lie the client renders as an empty panel.
  it('503s when the tournament schedule itself could not be read', async () => {
    resolveRef.mockReturnValue({ id: 'T1', provider: 'bwf' })
    fetchBwfPlayerProfile.mockRejectedValue(new mockScheduleUnavailable('nope'))

    const res = await get('T1')

    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('30')
  })

  it('500s on an error that is not an outage', async () => {
    resolveRef.mockReturnValue({ id: 'T1', provider: 'bwf' })
    fetchBwfPlayerProfile.mockRejectedValue(new Error('bug'))

    const res = await get('T1')

    expect(res.status).toBe(500)
  })
})

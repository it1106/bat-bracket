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

import fs from 'fs'
import os from 'os'
import path from 'path'
import { GET } from '@/app/api/player/route'
import { internalHeaders } from '@/lib/internal-token'

const cwd = process.cwd()
beforeAll(() => { process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'plr-'))) })
afterAll(() => { process.chdir(cwd) })

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
    resolveRef.mockReturnValue({ id: 'A97008D7-AA53-44AA-9BB7-2A6A2734EA47', provider: 'bwf' })

    const res = await get('A97008D7-AA53-44AA-9BB7-2A6A2734EA47')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: 'Somchai SAETANG', club: 'Thailand' })
    expect(fetchBwfPlayerProfile).toHaveBeenCalledWith('A97008D7-AA53-44AA-9BB7-2A6A2734EA47', '111')
    expect(fetchBatPlayerProfile).not.toHaveBeenCalled()
  })

  it('still scrapes BAT for a BAT tournament', async () => {
    resolveRef.mockReturnValue({ id: 'B97008D7-AA53-44AA-9BB7-2A6A2734EA47', provider: 'bat' })

    const res = await get('B97008D7-AA53-44AA-9BB7-2A6A2734EA47')

    expect(res.status).toBe(200)
    expect(fetchBatPlayerProfile).toHaveBeenCalled()
    expect(fetchBwfPlayerProfile).not.toHaveBeenCalled()
  })

  it('404s a BWF player who plays no match in the tournament', async () => {
    resolveRef.mockReturnValue({ id: 'A97008D7-AA53-44AA-9BB7-2A6A2734EA47', provider: 'bwf' })
    fetchBwfPlayerProfile.mockResolvedValue(null)

    const res = await get('A97008D7-AA53-44AA-9BB7-2A6A2734EA47', '999')

    expect(res.status).toBe(404)
  })

  // A schedule we could not read says nothing about the player, so answering
  // "not found" would be a lie the client renders as an empty panel.
  it('503s when the tournament schedule itself could not be read', async () => {
    resolveRef.mockReturnValue({ id: 'A97008D7-AA53-44AA-9BB7-2A6A2734EA47', provider: 'bwf' })
    fetchBwfPlayerProfile.mockRejectedValue(new mockScheduleUnavailable('nope'))

    const res = await get('A97008D7-AA53-44AA-9BB7-2A6A2734EA47')

    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('30')
  })

  it('500s on an error that is not an outage', async () => {
    resolveRef.mockReturnValue({ id: 'A97008D7-AA53-44AA-9BB7-2A6A2734EA47', provider: 'bwf' })
    fetchBwfPlayerProfile.mockRejectedValue(new Error('bug'))

    const res = await get('A97008D7-AA53-44AA-9BB7-2A6A2734EA47')

    expect(res.status).toBe(500)
  })

  // force=true skips the saved profile and scrapes BAT again. No page sends
  // it; it is for the server's own use, so it needs the server token.
  describe('force=true', () => {
    const BAT_T = 'B97008D7-AA53-44AA-9BB7-2A6A2734EA47'
    const forced = (headers?: Record<string, string>) =>
      GET(new Request(`http://x/api/player?tournament=${BAT_T}&player=111&force=true`, { headers }))

    it('is ignored from a visitor', async () => {
      resolveRef.mockReturnValue({ id: BAT_T, provider: 'bat' })
      const res = await forced()
      expect(res.status).toBe(200)
      expect(fetchBatPlayerProfile).toHaveBeenCalledWith(BAT_T, '111', { force: false })
    })

    it('is honoured with the server token', async () => {
      resolveRef.mockReturnValue({ id: BAT_T, provider: 'bat' })
      await forced(internalHeaders())
      expect(fetchBatPlayerProfile).toHaveBeenCalledWith(BAT_T, '111', { force: true })
    })
  })
})

import type { MatchesData } from '@/lib/types'

const getMatchesFull = jest.fn()
const setMatchesFull = jest.fn()
const readFullCache = jest.fn()
const fetchSchedule = jest.fn()

jest.mock('../lib/matches-full-memcache', () => ({
  getMatchesFull: (...a: unknown[]) => getMatchesFull(...a),
  setMatchesFull: (...a: unknown[]) => setMatchesFull(...a),
  MATCHES_FULL_TTL_MS: 5 * 60_000,
}))
jest.mock('../lib/day-cache', () => ({ readFullCache: (...a: unknown[]) => readFullCache(...a) }))
jest.mock('../lib/matches-full-cache', () => ({ fetchSchedule: (...a: unknown[]) => fetchSchedule(...a) }))

import { fetchBwfPlayerProfile } from '@/lib/bwf-player-fetch'

const schedule = (name: string): MatchesData => ({
  days: [],
  currentDate: '2026-05-19',
  groups: [{
    type: 'time',
    time: '09:00',
    matches: [{
      draw: 'MS-U19', drawNum: '1', round: 'R16',
      team1: [{ playerId: '111', name, country: 'THA' }],
      team2: [{ playerId: '222', name: 'Budi PUTRA', country: 'INA' }],
      winner: null, scores: [], court: '', walkover: false, retired: false, nowPlaying: false,
    }],
  }],
})

beforeEach(() => {
  jest.clearAllMocks()
  getMatchesFull.mockReturnValue(undefined)
  readFullCache.mockResolvedValue(null)
  fetchSchedule.mockResolvedValue(null)
})

describe('fetchBwfPlayerProfile', () => {
  it('reads the live in-memory schedule without touching disk or upstream', async () => {
    getMatchesFull.mockReturnValue({ data: schedule('From memory'), ts: Date.now() })

    const profile = await fetchBwfPlayerProfile('T1', '111')

    expect(profile!.name).toBe('From memory')
    expect(readFullCache).not.toHaveBeenCalled()
    expect(fetchSchedule).not.toHaveBeenCalled()
  })

  it('falls back to the pinned disk schedule of a finished tournament', async () => {
    readFullCache.mockResolvedValue(schedule('From disk'))

    const profile = await fetchBwfPlayerProfile('T1', '111')

    expect(profile!.name).toBe('From disk')
    expect(fetchSchedule).not.toHaveBeenCalled()
  })

  it('ignores an expired memory entry and uses disk instead', async () => {
    getMatchesFull.mockReturnValue({ data: schedule('Stale'), ts: Date.now() - 10 * 60_000 })
    readFullCache.mockResolvedValue(schedule('From disk'))

    const profile = await fetchBwfPlayerProfile('T1', '111')

    expect(profile!.name).toBe('From disk')
  })

  it('fetches upstream as a last resort and keeps the result in memory', async () => {
    fetchSchedule.mockResolvedValue(schedule('From upstream'))

    const profile = await fetchBwfPlayerProfile('T1', '111')

    expect(profile!.name).toBe('From upstream')
    expect(setMatchesFull).toHaveBeenCalledWith('T1', expect.anything())
  })

  it('returns null when no schedule can be had', async () => {
    expect(await fetchBwfPlayerProfile('T1', '111')).toBeNull()
  })
})

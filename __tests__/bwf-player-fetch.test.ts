import type { MatchesData } from '@/lib/types'

const getMatchesFull = jest.fn()
const setMatchesFull = jest.fn()
const readFullCache = jest.fn()
const fetchSchedule = jest.fn()
const readLastGoodFull = jest.fn()

jest.mock('../lib/matches-full-memcache', () => ({
  getMatchesFull: (...a: unknown[]) => getMatchesFull(...a),
  setMatchesFull: (...a: unknown[]) => setMatchesFull(...a),
  MATCHES_FULL_TTL_MS: 5 * 60_000,
}))
jest.mock('../lib/day-cache', () => ({ readFullCache: (...a: unknown[]) => readFullCache(...a) }))
jest.mock('../lib/matches-full-cache', () => ({ fetchSchedule: (...a: unknown[]) => fetchSchedule(...a) }))
jest.mock('../lib/schedule-last-good', () => ({ readLastGoodFull: (...a: unknown[]) => readLastGoodFull(...a) }))

import { fetchBwfPlayerProfile, ScheduleUnavailableError } from '@/lib/bwf-player-fetch'
import { _resetBackoffForTesting } from '@/lib/upstream-backoff'

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
  _resetBackoffForTesting()
  getMatchesFull.mockReturnValue(undefined)
  readFullCache.mockResolvedValue(null)
  fetchSchedule.mockResolvedValue(null)
  readLastGoodFull.mockResolvedValue(null)
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

  // A pinned schedule is a finished tournament's, so it cannot change. Without
  // this, every click on such a tournament re-read and re-parsed ~500 KB.
  it('keeps the pinned schedule in memory so the next click skips the disk', async () => {
    readFullCache.mockResolvedValue(schedule('From disk'))

    await fetchBwfPlayerProfile('T1', '111')

    expect(setMatchesFull).toHaveBeenCalledWith('T1', expect.objectContaining({ currentDate: '2026-05-19' }))
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

  it('tells a player who is not in the tournament from a tournament it cannot read', async () => {
    readFullCache.mockResolvedValue(schedule('Someone else'))

    expect(await fetchBwfPlayerProfile('T1', '999')).toBeNull()
  })
})

// For a BWF tournament this fetch is a whole-tournament pull through the
// headless browser — one call per day of the event. These keep a burst of
// clicks from turning into a burst of those.
describe('fetchBwfPlayerProfile, guarding the cold path', () => {
  it('fetches once for callers that arrive together', async () => {
    let release: (v: MatchesData) => void = () => {}
    fetchSchedule.mockReturnValue(new Promise<MatchesData>((r) => { release = r }))

    const calls = [
      fetchBwfPlayerProfile('T1', '111'),
      fetchBwfPlayerProfile('T1', '222'),
      fetchBwfPlayerProfile('T1', '111'),
    ]
    release(schedule('From upstream'))
    const profiles = await Promise.all(calls)

    expect(fetchSchedule).toHaveBeenCalledTimes(1)
    expect(profiles.map((p) => p!.playerId)).toEqual(['111', '222', '111'])
  })

  it('fetches again once the first call has finished', async () => {
    fetchSchedule.mockResolvedValue(schedule('From upstream'))

    await fetchBwfPlayerProfile('T1', '111')
    await fetchBwfPlayerProfile('T1', '111')

    expect(fetchSchedule).toHaveBeenCalledTimes(2)
  })

  it('serves what it last held instead of retrying a failed upstream', async () => {
    fetchSchedule.mockRejectedValue(new Error('Failed to fetch'))
    getMatchesFull.mockReturnValue({ data: schedule('Stale'), ts: Date.now() - 10 * 60_000 })

    const first = await fetchBwfPlayerProfile('T1', '111')
    const second = await fetchBwfPlayerProfile('T1', '111')

    expect(first!.name).toBe('Stale')
    expect(second!.name).toBe('Stale')
    expect(fetchSchedule).toHaveBeenCalledTimes(1) // the second call is inside the backoff window
  })

  it('reaches for the last good copy on disk when memory holds nothing', async () => {
    fetchSchedule.mockRejectedValue(new Error('Failed to fetch'))
    readLastGoodFull.mockResolvedValue(schedule('Last good'))

    const profile = await fetchBwfPlayerProfile('T1', '111')

    expect(profile!.name).toBe('Last good')
  })

  // The route turns this into a 503. Returning null would have read as
  // "no such player" and answered 404 for an upstream outage.
  it('says the schedule is unavailable rather than that the player is missing', async () => {
    fetchSchedule.mockRejectedValue(new Error('Failed to fetch'))

    await expect(fetchBwfPlayerProfile('T1', '111')).rejects.toBeInstanceOf(ScheduleUnavailableError)
  })

  it('says the same when upstream answers with no schedule at all', async () => {
    fetchSchedule.mockResolvedValue(null)

    await expect(fetchBwfPlayerProfile('T1', '111')).rejects.toBeInstanceOf(ScheduleUnavailableError)
  })
})

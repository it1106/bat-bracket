jest.mock('../lib/tournaments-registry', () => ({
  listAllTournaments: jest.fn(),
}))
jest.mock('../lib/discovery-store', () => ({
  loadDiscovered: jest.fn(async () => ({ version: 1, entries: [] })),
}))
jest.mock('../lib/day-cache', () => ({ readFullCache: jest.fn(), readDayCache: jest.fn() }))
jest.mock('../lib/today', () => ({ getTodayIso: jest.fn(() => '2026-05-28') }))
jest.mock('../lib/clubs-cache', () => ({
  readClubsCache: jest.fn(),
  writeClubsCache: jest.fn(),
}))
jest.mock('../lib/bracket-cache', () => ({
  playerClubCache: new Map<string, string>(),
  fetchTournamentPlayerClubs: jest.fn(),
}))
jest.mock('../lib/player-index-cache', () => ({
  readIndexCache: jest.fn(),
  writeIndexCache: jest.fn(),
  writeLeaderboardsCache: jest.fn(),
  readIdentityMap: jest.fn(),
  writeIdentityMap: jest.fn(),
  readPlayerLinks: jest.fn().mockResolvedValue([]),
}))

import { listAllTournaments } from '@/lib/tournaments-registry'
import { loadDiscovered } from '@/lib/discovery-store'
import { readFullCache } from '@/lib/day-cache'
import { readClubsCache } from '@/lib/clubs-cache'
import { fetchTournamentPlayerClubs } from '@/lib/bracket-cache'
import { readIndexCache, writeIndexCache, writeLeaderboardsCache, readIdentityMap, writeIdentityMap } from '@/lib/player-index-cache'
import { rebuildAll } from '@/lib/player-index-rebuild'

describe('rebuildAll', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(loadDiscovered as jest.Mock).mockResolvedValue({ version: 1, entries: [] })
    ;(readIdentityMap as jest.Mock).mockResolvedValue(null)
    ;(writeIdentityMap as jest.Mock).mockResolvedValue(undefined)
  })

  it('skips providers with no registry tournaments', async () => {
    ;(listAllTournaments as jest.Mock).mockReturnValue([])
    const out = await rebuildAll()
    expect(out.rebuilt).toEqual([])
    expect(out.skipped).toContain('bat')
    expect(out.skipped).toContain('bwf')
    expect(out.skipped).toContain('combined')
  })

  it('skips a provider whose tournaments have no pinned full cache', async () => {
    ;(listAllTournaments as jest.Mock).mockReturnValue([{ id: 'ID0', provider: 'bat', done: false }])
    ;(readFullCache as jest.Mock).mockResolvedValue(null)
    const out = await rebuildAll()
    expect(out.skipped).toContain('bat')
    expect(writeIndexCache).not.toHaveBeenCalled()
  })

  it('includes a past tournament with a full cache even without the [done] marker', async () => {
    ;(listAllTournaments as jest.Mock).mockReturnValue([{ id: 'ID1', provider: 'bat', done: false }])
    ;(readFullCache as jest.Mock).mockResolvedValue({ days: [], groups: [], currentDate: '2026-05-01' })
    ;(readClubsCache as jest.Mock).mockResolvedValue({})
    ;(readIndexCache as jest.Mock).mockResolvedValue(null)
    const out = await rebuildAll()
    expect(out.rebuilt).toContain('bat')
    expect(writeIndexCache).toHaveBeenCalled()
    expect(writeLeaderboardsCache).toHaveBeenCalled()
  })

  it('includes a discovered (non-registry) tournament that has a full cache', async () => {
    ;(listAllTournaments as jest.Mock).mockReturnValue([])
    ;(loadDiscovered as jest.Mock).mockResolvedValue({
      version: 1,
      entries: [{ id: 'DISC1', name: 'National Youth Games', hasBracket: true, discoveredAt: '', lastSeenOnUpcomingAt: '' }],
    })
    ;(readFullCache as jest.Mock).mockResolvedValue({ days: [], groups: [], currentDate: '2026-05-01' })
    ;(readClubsCache as jest.Mock).mockResolvedValue({})
    ;(readIndexCache as jest.Mock).mockResolvedValue(null)
    const out = await rebuildAll()
    expect(out.rebuilt).toContain('bat')
    expect(writeIndexCache).toHaveBeenCalled()
  })

  it('fetches clubs when no clubs cache exists', async () => {
    ;(listAllTournaments as jest.Mock).mockReturnValue([{ id: 'ID2', provider: 'bat', done: false }])
    ;(readFullCache as jest.Mock).mockResolvedValue({ days: [], groups: [], currentDate: '2026-05-01' })
    ;(readClubsCache as jest.Mock).mockResolvedValue(null)
    ;(fetchTournamentPlayerClubs as jest.Mock).mockResolvedValue(true)
    ;(readIndexCache as jest.Mock).mockResolvedValue(null)
    await rebuildAll()
    expect(fetchTournamentPlayerClubs).toHaveBeenCalledWith('id2')
  })

  it('builds combined index when both bat and bwf rebuild', async () => {
    ;(listAllTournaments as jest.Mock).mockReturnValue([
      { id: 'ID_BAT', provider: 'bat', done: false },
      { id: 'ID_BWF', provider: 'bwf', done: false },
    ])
    ;(readFullCache as jest.Mock).mockResolvedValue({ days: [], groups: [], currentDate: '2026-05-01' })
    ;(readClubsCache as jest.Mock).mockResolvedValue({})
    ;(readIndexCache as jest.Mock).mockResolvedValue(null)
    const out = await rebuildAll()
    expect(out.rebuilt).toContain('combined')
    expect(writeIdentityMap).toHaveBeenCalled()
    expect(writeLeaderboardsCache).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'combined' })
    )
  })

  describe('active tournaments via activeData', () => {
    const liveDay = { date: '2569-05-28', label: 'Day 1', dateIso: '2026-05-28' }
    const resolved = {
      draw: 'MS', drawNum: '1', round: 'QF',
      team1: [{ name: 'Alice', playerId: 'a' }],
      team2: [{ name: 'Bob', playerId: 'b' }],
      winner: 1, scores: [{ t1: 21, t2: 10 }],
      court: '1', walkover: false, retired: false, nowPlaying: false,
    }
    const unplayed = { ...resolved, round: 'SF', winner: null, scores: [], team1: [{ name: 'Carol', playerId: 'c' }], team2: [{ name: 'Dave', playerId: 'd' }] }

    function liveData(matches: unknown[]) {
      return new Map([['LIVE', {
        days: [liveDay], currentDate: '2569-05-28',
        groups: [{ type: 'time', time: '09:00', matches }],
      }]])
    }

    it('builds an active tournament supplied only via activeData', async () => {
      ;(listAllTournaments as jest.Mock).mockReturnValue([{ id: 'LIVE', provider: 'bat', done: false }])
      ;(readFullCache as jest.Mock).mockResolvedValue(null) // not pinned
      ;(readClubsCache as jest.Mock).mockResolvedValue({})
      const out = await rebuildAll({ activeData: liveData([resolved]) as never })
      expect(out.rebuilt).toContain('bat')
      expect(writeIndexCache).toHaveBeenCalled()
    })

    it('skips an active tournament with no resolved matches', async () => {
      ;(listAllTournaments as jest.Mock).mockReturnValue([{ id: 'LIVE', provider: 'bat', done: false }])
      ;(readFullCache as jest.Mock).mockResolvedValue(null)
      ;(readClubsCache as jest.Mock).mockResolvedValue({})
      const out = await rebuildAll({ activeData: liveData([unplayed]) as never })
      expect(out.skipped).toContain('bat')
      expect(writeIndexCache).not.toHaveBeenCalled()
    })
  })
})

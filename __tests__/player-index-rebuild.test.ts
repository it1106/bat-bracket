jest.mock('../lib/tournaments-registry', () => ({
  listDoneByProvider: jest.fn(),
}))
jest.mock('../lib/day-cache', () => ({ readFullCache: jest.fn() }))
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
}))

import { listDoneByProvider } from '@/lib/tournaments-registry'
import { readFullCache } from '@/lib/day-cache'
import { readClubsCache, writeClubsCache } from '@/lib/clubs-cache'
import { fetchTournamentPlayerClubs } from '@/lib/bracket-cache'
import { readIndexCache, writeIndexCache, writeLeaderboardsCache } from '@/lib/player-index-cache'
import { rebuildAll } from '@/lib/player-index-rebuild'

describe('rebuildAll', () => {
  beforeEach(() => { jest.resetAllMocks() })

  it('returns skipped for providers with no done tournaments', async () => {
    ;(listDoneByProvider as jest.Mock).mockReturnValue([])
    const out = await rebuildAll()
    expect(out.rebuilt).toEqual([])
    expect(out.skipped).toEqual(['bat','bwf'])
  })

  it('rebuilds when a done tournament with a full cache is present', async () => {
    ;(listDoneByProvider as jest.Mock).mockImplementation((p) => p === 'bat'
      ? [{ id: 'ID1', provider: 'bat', done: true }]
      : [])
    ;(readFullCache as jest.Mock).mockResolvedValue({ days: [], groups: [], currentDate: '2026-05-01' })
    ;(readClubsCache as jest.Mock).mockResolvedValue({})
    ;(readIndexCache as jest.Mock).mockResolvedValue(null)
    const out = await rebuildAll()
    expect(out.rebuilt).toContain('bat')
    expect(writeIndexCache).toHaveBeenCalled()
    expect(writeLeaderboardsCache).toHaveBeenCalled()
  })

  it('fetches clubs when no clubs cache exists', async () => {
    ;(listDoneByProvider as jest.Mock).mockImplementation((p) => p === 'bat' ? [{ id: 'ID2', provider: 'bat', done: true }] : [])
    ;(readFullCache as jest.Mock).mockResolvedValue({ days: [], groups: [], currentDate: '2026-05-01' })
    ;(readClubsCache as jest.Mock).mockResolvedValue(null)
    ;(fetchTournamentPlayerClubs as jest.Mock).mockResolvedValue(true)
    ;(readIndexCache as jest.Mock).mockResolvedValue(null)
    await rebuildAll()
    expect(fetchTournamentPlayerClubs).toHaveBeenCalledWith('id2')
  })
})

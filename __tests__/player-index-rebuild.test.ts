jest.mock('../lib/tournaments-registry', () => ({
  listAllTournaments: jest.fn(),
}))
jest.mock('../lib/discovery-store', () => ({
  loadDiscovered: jest.fn(async () => ({ version: 1, entries: [] })),
}))
jest.mock('../lib/day-cache', () => ({ readFullCache: jest.fn(), readDayCache: jest.fn() }))
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

import { listAllTournaments } from '@/lib/tournaments-registry'
import { loadDiscovered } from '@/lib/discovery-store'
import { readFullCache } from '@/lib/day-cache'
import { readClubsCache } from '@/lib/clubs-cache'
import { fetchTournamentPlayerClubs } from '@/lib/bracket-cache'
import { readIndexCache, writeIndexCache, writeLeaderboardsCache } from '@/lib/player-index-cache'
import { rebuildAll } from '@/lib/player-index-rebuild'

describe('rebuildAll', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(loadDiscovered as jest.Mock).mockResolvedValue({ version: 1, entries: [] })
  })

  it('skips providers with no registry tournaments', async () => {
    ;(listAllTournaments as jest.Mock).mockReturnValue([])
    const out = await rebuildAll()
    expect(out.rebuilt).toEqual([])
    expect(out.skipped).toEqual(['bat', 'bwf'])
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
})

import { recentlyAddedTournaments, NEWS_MAX } from '@/lib/tournament-news'
import type { DiscoveredEntry, DiscoveryStore } from '@/lib/discovery-store'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

const entry = (id: string, promotedAt?: string, hasBracket = true): DiscoveredEntry => ({
  id, name: `${id} name`, hasBracket, discoveredAt: hoursAgo(500), lastSeenOnUpcomingAt: hoursAgo(1),
  ...(promotedAt && { promotedAt }),
})
const store = (...entries: DiscoveredEntry[]): DiscoveryStore => ({ version: 1, entries })

describe('recentlyAddedTournaments', () => {
  it('returns recently promoted, visible tournaments, newest first, with the visible name', () => {
    const s = store(entry('A', hoursAgo(10)), entry('B', hoursAgo(2)))
    const visible = [{ id: 'A', name: 'Alpha' }, { id: 'B', name: 'Beta' }]
    expect(recentlyAddedTournaments(s, visible, NOW)).toEqual([
      { id: 'B', name: 'Beta', addedAt: hoursAgo(2) },
      { id: 'A', name: 'Alpha', addedAt: hoursAgo(10) },
    ])
  })

  it('leaves out entries without a promotion time, older than the window, or not promoted', () => {
    const s = store(entry('OLD', hoursAgo(73)), entry('LEGACY'), entry('NOPE', hoursAgo(1), false), entry('OK', hoursAgo(71)))
    const visible = ['OLD', 'LEGACY', 'NOPE', 'OK'].map((id) => ({ id, name: id }))
    expect(recentlyAddedTournaments(s, visible, NOW).map((t) => t.id)).toEqual(['OK'])
  })

  it('leaves out tournaments the dropdown does not show (denied) or marks done', () => {
    const s = store(entry('DENIED', hoursAgo(1)), entry('DONE', hoursAgo(1)))
    expect(recentlyAddedTournaments(s, [{ id: 'DONE', name: 'd', done: true }], NOW)).toEqual([])
  })

  it('caps the list', () => {
    const ids = Array.from({ length: NEWS_MAX + 3 }, (_, i) => `T${i}`)
    const s = store(...ids.map((id, i) => entry(id, hoursAgo(i + 1))))
    expect(recentlyAddedTournaments(s, ids.map((id) => ({ id, name: id })), NOW)).toHaveLength(NEWS_MAX)
  })
})

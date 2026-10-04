import { shouldRebuildIndex, LIVE_REBUILD_INTERVAL_MS } from '@/lib/index-rebuild-policy'

const NOW = Date.UTC(2026, 9, 4, 4, 0, 0)
const MIN = 60_000

describe('shouldRebuildIndex', () => {
  it('rebuilds straight away when a tournament has just finished', () => {
    expect(shouldRebuildIndex({ newlyFinished: 1, liveTournaments: 0, lastRebuildAt: NOW - MIN, now: NOW })).toBe(true)
    expect(shouldRebuildIndex({ newlyFinished: 1, liveTournaments: 2, lastRebuildAt: NOW - MIN, now: NOW })).toBe(true)
  })

  it('rebuilds at most once an hour while a tournament is in play', () => {
    const at = (minutesAgo: number) =>
      shouldRebuildIndex({ newlyFinished: 0, liveTournaments: 1, lastRebuildAt: NOW - minutesAgo * MIN, now: NOW })
    expect(at(15)).toBe(false)
    expect(at(45)).toBe(false)
    expect(at(60)).toBe(true)
    expect(at(90)).toBe(true)
    expect(LIVE_REBUILD_INTERVAL_MS).toBe(60 * MIN)
  })

  it('rebuilds for a live tournament when there has been no rebuild yet', () => {
    expect(shouldRebuildIndex({ newlyFinished: 0, liveTournaments: 1, lastRebuildAt: null, now: NOW })).toBe(true)
  })

  it('does nothing when no tournament is live and none has finished', () => {
    expect(shouldRebuildIndex({ newlyFinished: 0, liveTournaments: 0, lastRebuildAt: null, now: NOW })).toBe(false)
    expect(shouldRebuildIndex({ newlyFinished: 0, liveTournaments: 0, lastRebuildAt: NOW - 500 * MIN, now: NOW })).toBe(false)
  })
})

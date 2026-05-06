import { runDiscoveryCycle, type DiscoveryDeps } from '@/lib/discovery-runner'
import type { UpcomingEntry } from '@/lib/upcoming-scraper'
import type { DiscoveryStore } from '@/lib/discovery-store'

function makeDeps(overrides: Partial<DiscoveryDeps>): DiscoveryDeps {
  return {
    fetchUpcomingHtml: async () => '<html></html>',
    parseUpcoming: () => [] as UpcomingEntry[],
    fetchDrawsHtml: async () => '<html></html>',
    parseTournamentDraws: () => [],
    fetchDrawContentHtml: async () => '<html></html>',
    bracketHasSeededPlayers: () => false,
    loadDiscovered: async () => ({ version: 1, entries: [] }),
    saveDiscovered: async () => {},
    captureServerEvent: async () => {},
    log: () => {},
    warn: () => {},
    now: () => new Date('2026-05-07T03:00:00Z'),
    ...overrides,
  }
}

const MOCK_ENTRY: UpcomingEntry = {
  id: 'AAAAAAAA-1111-2222-3333-444444444444',
  name: 'New Open 2026',
  hasOnlineEntry: false,
}

describe('runDiscoveryCycle — happy path and basic skips', () => {
  it('promotes a new tournament with seeded bracket', async () => {
    const saved: DiscoveryStore[] = []
    const events: { event: string; props: unknown }[] = []
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [MOCK_ENTRY],
        parseTournamentDraws: () => [{ drawNum: '1', name: 'X', size: '32', type: 's' }],
        bracketHasSeededPlayers: () => true,
        saveDiscovered: async (s) => {
          saved.push(s)
        },
        captureServerEvent: async (event, props) => {
          events.push({ event, props })
        },
      }),
    )
    expect(saved).toHaveLength(1)
    expect(saved[0].entries).toHaveLength(1)
    expect(saved[0].entries[0]).toMatchObject({
      id: MOCK_ENTRY.id,
      name: MOCK_ENTRY.name,
      hasBracket: true,
    })
    expect(events).toEqual([
      { event: 'tournament_auto_added', props: { id: MOCK_ENTRY.id, name: MOCK_ENTRY.name } },
    ])
  })

  it('filters out rows with hasOnlineEntry=true', async () => {
    const saved: DiscoveryStore[] = []
    let drawsFetched = 0
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [{ ...MOCK_ENTRY, hasOnlineEntry: true }],
        fetchDrawsHtml: async () => {
          drawsFetched++
          return ''
        },
        saveDiscovered: async (s) => {
          saved.push(s)
        },
      }),
    )
    expect(drawsFetched).toBe(0)
    expect(saved[0].entries).toEqual([])
  })

  it('keeps an unpromoted entry tracked when bracket gate still fails', async () => {
    const existing: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: MOCK_ENTRY.id,
          name: MOCK_ENTRY.name,
          hasBracket: false,
          discoveredAt: '2026-05-06T00:00:00Z',
          lastSeenOnUpcomingAt: '2026-05-06T00:00:00Z',
        },
      ],
    }
    let drawsFetched = 0
    const saved: DiscoveryStore[] = []
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [MOCK_ENTRY],
        loadDiscovered: async () => existing,
        parseTournamentDraws: () => [],
        fetchDrawsHtml: async () => {
          drawsFetched++
          return ''
        },
        saveDiscovered: async (s) => {
          saved.push(s)
        },
      }),
    )
    expect(drawsFetched).toBe(1)
    expect(saved[0].entries[0].hasBracket).toBe(false)
  })

  it('does not refetch draws for already-promoted entries', async () => {
    const existing: DiscoveryStore = {
      version: 1,
      entries: [
        {
          id: MOCK_ENTRY.id,
          name: MOCK_ENTRY.name,
          hasBracket: true,
          discoveredAt: '2025-01-01T00:00:00Z',
          lastSeenOnUpcomingAt: '2025-01-01T00:00:00Z',
        },
      ],
    }
    let drawsFetched = 0
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [MOCK_ENTRY],
        loadDiscovered: async () => existing,
        fetchDrawsHtml: async () => {
          drawsFetched++
          return ''
        },
      }),
    )
    expect(drawsFetched).toBe(0)
  })
})

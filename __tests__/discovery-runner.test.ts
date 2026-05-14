import { runDiscoveryCycle, type DiscoveryDeps } from '@/lib/discovery-runner'
import type { UpcomingEntry } from '@/lib/upcoming-scraper'
import type { DiscoveredEntry, DiscoveryStore } from '@/lib/discovery-store'

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

  it('promotes a grouped tournament whose draws[0] (playoff) is empty but draws[1+] (groups) have players', async () => {
    // Reproduces the production bug: SAT NSDF Badminton Thai Domestic Power
    // 2026 Final has 9 draws per event — the playoff (Elimination, all Bye
    // until groups complete) sorts first, then 8 Round Robin groups with real
    // entrants. The old gate stopped at draws[0] and never flipped hasBracket.
    const saved: DiscoveryStore[] = []
    const probedDrawNums: string[] = []
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [MOCK_ENTRY],
        parseTournamentDraws: () => [
          { drawNum: '9', name: 'BS U11', size: '8', type: 'Elimination' },
          { drawNum: '1', name: 'BS U11 - Group A', size: '3', type: 'Round Robin' },
          { drawNum: '2', name: 'BS U11 - Group B', size: '3', type: 'Round Robin' },
        ],
        fetchDrawContentHtml: async (_id, drawNum) => {
          probedDrawNums.push(drawNum)
          // Playoff (drawNum 9) is empty Bye markup — no player IDs
          if (drawNum === '9') return '<html><body><div>Bye</div></body></html>'
          return '<html><body><a data-player-id="1185">Player A</a></body></html>'
        },
        bracketHasSeededPlayers: (html: string) => /data-player-id="\d/.test(html),
        saveDiscovered: async (s) => { saved.push(s) },
      }),
    )
    expect(saved[0].entries[0].hasBracket).toBe(true)
    // Should have probed past the empty playoff to find populated groups
    expect(probedDrawNums.length).toBeGreaterThanOrEqual(2)
    expect(probedDrawNums[0]).toBe('9')
    expect(probedDrawNums[1]).toBe('1')
  })

  it('caps probing at 5 draws when none have seeded players', async () => {
    const probedDrawNums: string[] = []
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [MOCK_ENTRY],
        parseTournamentDraws: () => Array.from({ length: 12 }, (_, i) => ({
          drawNum: String(i + 1), name: `Draw ${i + 1}`, size: '8', type: 'Elimination',
        })),
        fetchDrawContentHtml: async (_id, drawNum) => {
          probedDrawNums.push(drawNum)
          return '<html></html>'
        },
        bracketHasSeededPlayers: () => false,
        saveDiscovered: async () => {},
      }),
    )
    expect(probedDrawNums).toHaveLength(5)
  })

  it('stops probing on first success (does not over-fetch for healthy tournaments)', async () => {
    const probedDrawNums: string[] = []
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [MOCK_ENTRY],
        parseTournamentDraws: () => [
          { drawNum: '1', name: 'Singles', size: '32', type: 'Elimination' },
          { drawNum: '2', name: 'Doubles', size: '16', type: 'Elimination' },
        ],
        fetchDrawContentHtml: async (_id, drawNum) => {
          probedDrawNums.push(drawNum)
          return '<a data-player-id="42">x</a>'
        },
        bracketHasSeededPlayers: () => true,
        saveDiscovered: async () => {},
      }),
    )
    expect(probedDrawNums).toEqual(['1'])
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

describe('runDiscoveryCycle — cleanup', () => {
  const ABSENT_UNPROMOTED: DiscoveredEntry = {
    id: 'BBBBBBBB-2222-3333-4444-555555555555',
    name: 'Disappeared',
    hasBracket: false,
    discoveredAt: '2026-04-01T00:00:00Z',
    lastSeenOnUpcomingAt: '2026-05-01T00:00:00Z',
  }
  const ABSENT_PROMOTED: DiscoveredEntry = {
    ...ABSENT_UNPROMOTED,
    id: 'CCCCCCCC-2222-3333-4444-555555555555',
    name: 'Already Started',
    hasBracket: true,
  }

  it('removes entries absent from upcoming with hasBracket=false', async () => {
    const saved: DiscoveryStore[] = []
    const events: { event: string; props: unknown }[] = []
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [MOCK_ENTRY],
        loadDiscovered: async () => ({
          version: 1,
          entries: [ABSENT_UNPROMOTED],
        }),
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
    const ids = saved[0].entries.map((e) => e.id)
    expect(ids).not.toContain(ABSENT_UNPROMOTED.id)
    expect(events).toContainEqual({
      event: 'tournament_auto_removed',
      props: { id: ABSENT_UNPROMOTED.id, name: ABSENT_UNPROMOTED.name },
    })
  })

  it('keeps entries absent from upcoming with hasBracket=true', async () => {
    const saved: DiscoveryStore[] = []
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [],
        loadDiscovered: async () => ({
          version: 1,
          entries: [ABSENT_PROMOTED],
        }),
        saveDiscovered: async (s) => {
          saved.push(s)
        },
      }),
    )
    expect(saved[0].entries.map((e) => e.id)).toContain(ABSENT_PROMOTED.id)
  })

  it('skips cleanup when upcoming snapshot is empty but store had entries', async () => {
    const saved: DiscoveryStore[] = []
    const warns: string[] = []
    await runDiscoveryCycle(
      makeDeps({
        parseUpcoming: () => [],
        loadDiscovered: async () => ({
          version: 1,
          entries: [ABSENT_UNPROMOTED],
        }),
        saveDiscovered: async (s) => {
          saved.push(s)
        },
        warn: (msg) => warns.push(msg),
      }),
    )
    expect(saved[0].entries.map((e) => e.id)).toContain(ABSENT_UNPROMOTED.id)
    expect(warns.some((w) => /empty snapshot/i.test(w))).toBe(true)
  })
})

describe('runDiscoveryCycle — mutex', () => {
  it('skips overlapping invocations within the same process', async () => {
    let upcomingCalls = 0
    let release: () => void = () => {}
    const blocker = new Promise<string>((resolve) => {
      release = () => resolve('<html></html>')
    })
    const deps = makeDeps({
      fetchUpcomingHtml: () => {
        upcomingCalls++
        return blocker
      },
    })
    const first = runDiscoveryCycle(deps)
    const second = runDiscoveryCycle(deps)
    release()
    await Promise.all([first, second])
    expect(upcomingCalls).toBe(1)
  })
})

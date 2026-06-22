/** @jest-environment jsdom */
import { render, screen, waitFor, act } from '@testing-library/react'
import TournamentStatsPanel from '../components/TournamentStatsPanel'

jest.mock('../lib/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'en', t: (k: string) => k }),
}))

jest.mock('../lib/analytics', () => ({ track: jest.fn() }))
jest.mock('../lib/useLongPress', () => ({ useLongPress: jest.fn() }))
jest.mock('../lib/shareMatchAsImage', () => ({
  prewarmFontEmbedCSS: jest.fn(),
  buildFilename: jest.fn(),
  captureStatsImageFile: jest.fn(),
  shareFile: jest.fn(),
}))

function fetchOnce(payload: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  }) as unknown as typeof fetch
}

const minimalLegacyPayload = {
  tournamentId: 'TEST-2026',
  generatedAt: '2026-06-05T00:00:00Z',
  coverage: { daysOnDisk: 0, daysFromMemory: 0, daysFromBat: 0, totalDays: 0 },
  kpis: {
    events: 0, matches: 1, decided: 1, walkovers: 0, retired: 0, nowPlaying: 0,
    players: 2, multiEventPlayers: 0, courtMinutes: 30, avgMatchMinutes: 30, threeSetterRate: 0,
    entries: 0, draws: 0,
  },
  dailyVolume: [],
  events: [],
  drama: { marathon: null, highestSet: null, highestScoringMatch: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null },
  topPlayers: [],
  courtUtilization: [],
  clubMedals: [],
  multiGoldPlayers: [],
  clubRosters: [],
  countryRosters: [],
  integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
  // No new optional fields.
}

describe('TournamentStatsPanel back-compat', () => {
  test('renders without crashing when new optional fields are absent', async () => {
    fetchOnce(minimalLegacyPayload)
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    await waitFor(() => {
      expect(screen.queryByText('statsSectionDefendingChampions')).toBeNull()
    })
  })
})

const preMatchPayload = {
  ...minimalLegacyPayload,
  kpis: { ...minimalLegacyPayload.kpis, matches: 0, decided: 0, entries: 12, draws: 3, players: 8 },
}

describe('TournamentStatsPanel pre-match render', () => {
  test('renders the pre-match footer and hides result-phase sections when decided=0', async () => {
    fetchOnce(preMatchPayload)
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    await waitFor(() => screen.getByText('statsPreMatchFooter'))
    // Result-phase sections must not appear:
    expect(screen.queryByText('statsSectionDrama')).toBeNull()
    expect(screen.queryByText('statsSectionTopPlayers')).toBeNull()
    expect(screen.queryByText('statsSectionIntegrity')).toBeNull()
  })
})

describe('TournamentStatsPanel mid-poll transition', () => {
  test('drama appears and footer disappears after a polled refresh shows decided>0', async () => {
    const postMatchPayload = {
      ...preMatchPayload,
      kpis: { ...preMatchPayload.kpis, matches: 1, decided: 1, courtMinutes: 45, avgMatchMinutes: 45, threeSetterRate: 0 },
      drama: {
        marathon: { draw: 'MS', round: 'R32', team1: ['A'], team2: ['B'], winnerSide: 1, scores: [{ t1: 21, t2: 19 }], durationMinutes: 45 },
        highestSet: null, highestScoringMatch: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null,
      },
    }
    let call = 0
    global.fetch = jest.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      json: async () => (call++ === 0 ? preMatchPayload : postMatchPayload),
    })) as unknown as typeof fetch

    jest.useFakeTimers()
    try {
      await act(async () => {
        render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
      })
      await waitFor(() => screen.getByText('statsPreMatchFooter'))
      // Trigger the 30s poll:
      await act(async () => {
        jest.advanceTimersByTime(31_000)
        // Allow microtasks (the fetch.then chain) to settle.
        await Promise.resolve()
        await Promise.resolve()
      })
      await waitFor(() => expect(screen.queryByText('statsPreMatchFooter')).toBeNull())
      expect(screen.getByText('statsSectionDrama')).toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })
})

const topPlayersPayload = {
  ...minimalLegacyPayload,
  topPlayers: [
    {
      playerId: 'p1',
      name: 'Alpha',
      club: 'Club A',
      wins: 2,
      losses: 1,
      results: [
        { event: 'MD', round: 'QF', won: true, opponent: ['Smith', 'Lee'], scores: [{ t1: 21, t2: 18 }, { t1: 21, t2: 15 }] },
        { event: 'MD', round: 'SF', won: true, opponent: ['Tan', 'Wong'], scores: [{ t1: 19, t2: 21 }, { t1: 21, t2: 17 }, { t1: 21, t2: 12 }] },
        { event: 'MD', round: 'Final', won: false, opponent: ['Cho', 'Park'], scores: [{ t1: 18, t2: 21 }, { t1: 17, t2: 21 }] },
      ],
    },
  ],
}

describe('TournamentStatsPanel — top players W-L tooltip', () => {
  test('renders a tooltip row per match with opponent and score', async () => {
    fetchOnce(topPlayersPayload)
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    await waitFor(() => {
      expect(screen.getByText('Smith / Lee')).toBeInTheDocument()
    })
    expect(screen.getByText('21–18, 21–15')).toBeInTheDocument()
    expect(screen.getByText('Cho / Park')).toBeInTheDocument()
  })

  test('renders plain W-L with no tooltip when results are absent', async () => {
    const noResults = {
      ...minimalLegacyPayload,
      topPlayers: [{ playerId: 'p1', name: 'Alpha', club: 'Club A', wins: 5, losses: 0 }],
    }
    fetchOnce(noResults)
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument()
    })
    expect(document.querySelector('.stats-wl-tip')).toBeNull()
  })
})

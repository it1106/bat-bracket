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
      expect(screen.queryByText('statsSectionSeedHeadlines')).toBeNull()
      expect(screen.queryByText('statsSectionDefendingChampions')).toBeNull()
    })
  })
})

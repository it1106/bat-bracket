/**
 * @jest-environment jsdom
 */
import { act, render, screen } from '@testing-library/react'
import TournamentStatsPanel from '@/components/TournamentStatsPanel'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { TournamentStats } from '@/lib/types'

function statsBlob(over: Partial<TournamentStats> = {}): TournamentStats {
  return {
    tournamentId: 'T1',
    generatedAt: '2026-07-10T00:00:00Z',
    coverage: { daysOnDisk: 1, daysFromMemory: 0, daysFromBat: 0, totalDays: 1 },
    kpis: {
      events: 0, matches: 0, decided: 0, walkovers: 0, retired: 0, nowPlaying: 0,
      players: 0, multiEventPlayers: 0, courtMinutes: 0, avgMatchMinutes: 0, threeSetterRate: 0, draws: 0,
    },
    dailyVolume: [], events: [],
    drama: { marathon: null, highestSet: null, highestScoringMatch: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null },
    topPlayers: [], courtUtilization: [], clubMedals: [], multiGoldPlayers: [],
    clubRosters: [], countryRosters: [],
    integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
    ...over,
  }
}

async function renderPanel(stats: TournamentStats) {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => stats })
  ;(global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
  let utils!: ReturnType<typeof render>
  await act(async () => {
    utils = render(
      <LanguageProvider>
        <TournamentStatsPanel tournamentId="T1" />
      </LanguageProvider>,
    )
  })
  return utils
}

// 4 players: 2 still competing ('in' by default), 2 eliminated ('out').
const roster = [
  { name: 'A', playerId: 'a', events: ['MS U19'] },
  { name: 'B', playerId: 'b', events: ['MS U19'] },
  { name: 'C', playerId: 'c', events: ['MS U19'], statusByEvent: { 'MS U19': 'out' as const } },
  { name: 'D', playerId: 'd', events: ['MS U19'], statusByEvent: { 'MS U19': 'out' as const } },
]

describe('TournamentStatsPanel — country roster Active percentage', () => {
  it('shows the active count with its share of the roster in parentheses', async () => {
    await renderPanel(statsBlob({
      countryRosters: [{ country: 'INA', players: 4, members: ['A', 'B', 'C', 'D'], roster }],
    }))
    // 2 of 4 active → "2 (50%)".
    expect(screen.getByText('2 (50%)')).toBeInTheDocument()
  })

  it('does not add a percentage to the club roster Active column', async () => {
    await renderPanel(statsBlob({
      clubRosters: [{ club: 'KBA', players: 4, members: ['A', 'B', 'C', 'D'], roster }],
    }))
    // Club roster keeps the bare count (no percentage).
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('2 (50%)')).toBeNull()
  })
})

/**
 * @jest-environment jsdom
 */
import { act, render, screen, within } from '@testing-library/react'
import TournamentStatsPanel from '@/components/TournamentStatsPanel'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { TournamentStats } from '@/lib/types'

function statsBlob(over: Partial<TournamentStats> = {}): TournamentStats {
  return {
    tournamentId: 'T1',
    generatedAt: '2026-07-09T00:00:00Z',
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
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    headers: new Headers(),
    json: async () => stats,
  })
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

describe('TournamentStatsPanel — country head-to-head matrix', () => {
  const matrix = {
    countries: ['THA', 'MAS', 'INA'],
    cells: {
      THA: { MAS: { w: 3, l: 1 }, INA: { w: 1, l: 1 } },
      MAS: { THA: { w: 1, l: 3 } },
      INA: { THA: { w: 1, l: 1 } },
    },
  }

  it('renders a grid with the section heading and one column/row per country', async () => {
    const { container } = await renderPanel(statsBlob({ countryMatrix: matrix }))
    expect(screen.getByText('Country head-to-head')).toBeInTheDocument()
    const table = container.querySelector('.stats-matrix')!
    expect(table).toBeTruthy()
    // Column headers (sticky top row) list every country.
    const cols = Array.from(table.querySelectorAll('.stats-matrix-col')).map((e) => e.textContent)
    expect(cols).toEqual(['THA', 'MAS', 'INA'])
    // Row headers (sticky first column) list every country.
    const rows = Array.from(table.querySelectorAll('.stats-matrix-row')).map((e) => e.textContent)
    expect(rows).toEqual(['THA', 'MAS', 'INA'])
  })

  it('shows the row country win–loss and win% in each populated cell', async () => {
    const { container } = await renderPanel(statsBlob({ countryMatrix: matrix }))
    const table = container.querySelector('.stats-matrix')!
    // THA row, MAS column = 3–1 (75%).
    const thaRow = table.querySelectorAll('tbody tr')[0]
    const thaVsMas = thaRow.querySelectorAll('.stats-matrix-cell')[1] // col 0 = THA (diag), col 1 = MAS
    expect(within(thaVsMas as HTMLElement).getByText('3–1')).toBeInTheDocument()
    expect(within(thaVsMas as HTMLElement).getByText('75%')).toBeInTheDocument()
    expect(thaVsMas).toHaveClass('is-win')
  })

  it('shades the diagonal and leaves it empty', async () => {
    const { container } = await renderPanel(statsBlob({ countryMatrix: matrix }))
    const diag = container.querySelector('.stats-matrix-diag')!
    expect(diag).toBeTruthy()
    expect(diag.textContent).toBe('')
  })

  it('omits the section entirely when there is no country matrix', async () => {
    const { container } = await renderPanel(statsBlob({}))
    expect(screen.queryByText('Country head-to-head')).toBeNull()
    expect(container.querySelector('.stats-matrix')).toBeNull()
  })
})

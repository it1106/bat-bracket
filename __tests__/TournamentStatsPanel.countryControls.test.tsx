/**
 * @jest-environment jsdom
 */
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import TournamentStatsPanel from '@/components/TournamentStatsPanel'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { TournamentStats } from '@/lib/types'

function statsBlob(over: Partial<TournamentStats> = {}): TournamentStats {
  return {
    tournamentId: 'T1', generatedAt: '2026-07-10T00:00:00Z',
    coverage: { daysOnDisk: 1, daysFromMemory: 0, daysFromBat: 0, totalDays: 1 },
    kpis: { events: 0, matches: 0, decided: 0, walkovers: 0, retired: 0, nowPlaying: 0, players: 0, multiEventPlayers: 0, courtMinutes: 0, avgMatchMinutes: 0, threeSetterRate: 0, draws: 0 },
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
  await act(async () => {
    render(<LanguageProvider><TournamentStatsPanel tournamentId="T1" /></LanguageProvider>)
  })
}

const male = (n: string) => ({ name: n, playerId: n, events: ['MS U19'] })
const female = (n: string) => ({ name: n, playerId: n, events: ['WS U19'] })

// INA: 2 male + 1 female (3). THA: 1 male + 1 female (2).
const countryRosters = [
  { country: 'INA', players: 3, members: ['a', 'b', 'c'], roster: [male('a'), male('b'), female('c')] },
  { country: 'THA', players: 2, members: ['d', 'e'], roster: [male('d'), female('e')] },
]

const codesInOrder = () =>
  Array.from(document.querySelectorAll('tbody tr .stats-country-link'))
    .map((b) => (b.textContent!.match(/\(([A-Z]{3})\)|^([A-Z]{3})$/)?.[1] ?? b.textContent!.match(/([A-Z]{3})/)?.[1]))

describe('TournamentStatsPanel — country roster controls', () => {
  it('filters the roster by the gender dropdown, recomputing counts', async () => {
    await renderPanel(statsBlob({ countryRosters }))
    const gender = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(gender, { target: { value: 'male' } })
    // INA now shows 2 players (its 2 males), THA shows 1.
    const inaRow = Array.from(document.querySelectorAll('tbody tr')).find((r) => r.textContent?.includes('INA'))!
    expect(within(inaRow as HTMLElement).getByText('2')).toBeInTheDocument()
  })

  it('sorts rows when a column header is clicked', async () => {
    await renderPanel(statsBlob({ countryRosters }))
    const playersHeader = Array.from(document.querySelectorAll('th.stats-th-sort')).find((th) => /Players/.test(th.textContent ?? ''))!
    // Default order (as provided): INA, THA.
    expect(codesInOrder()).toEqual(['INA', 'THA'])
    // Click Players header → numeric columns default to descending (INA 3, THA 2).
    fireEvent.click(playersHeader)
    expect(codesInOrder()).toEqual(['INA', 'THA'])
    // Click again → ascending (THA 2, INA 3).
    fireEvent.click(playersHeader)
    expect(codesInOrder()).toEqual(['THA', 'INA'])
  })
})

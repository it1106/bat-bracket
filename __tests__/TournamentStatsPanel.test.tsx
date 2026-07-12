/** @jest-environment jsdom */
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
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

// The medal table heading switches between club and country wording based on
// whether the tournament is club-based (has clubRosters) or BWF-style (only
// countryRosters). See the isCountryBased heuristic in the panel.
describe('TournamentStatsPanel medal heading', () => {
  const medalRow = { club: 'THA', gold: 1, silver: 0, bronze: 0, goldMedalists: [], silverMedalists: [], bronzeMedalists: [] }

  test('uses club wording when the tournament has club rosters', async () => {
    fetchOnce({
      ...minimalLegacyPayload,
      clubMedals: [{ ...medalRow, club: 'ClubA' }],
      clubRosters: [{ club: 'ClubA', players: 1, members: [] }],
      countryRosters: [],
    })
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    await waitFor(() => expect(screen.getByText('statsSectionClubMedals')).toBeInTheDocument())
    expect(screen.queryByText('statsSectionCountryMedals')).toBeNull()
  })

  test('uses country wording for BWF (no clubs, has countries)', async () => {
    fetchOnce({
      ...minimalLegacyPayload,
      clubMedals: [medalRow],
      clubRosters: [],
      countryRosters: [{ country: 'THA', players: 1, members: [] }],
    })
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    await waitFor(() => expect(screen.getByText('statsSectionCountryMedals')).toBeInTheDocument())
    expect(screen.queryByText('statsSectionClubMedals')).toBeNull()
  })
})

// The "count once per event" checkbox collapses duplicated medals: a doubles
// or mixed win credits 2 medalists but only 1 event. Per-event is the DEFAULT
// (checkbox checked); unchecking reveals the raw per-medalist counts. Counts
// are derived client-side from the medalists arrays (distinct events).
describe('TournamentStatsPanel medals per-event toggle', () => {
  const goldCell = () =>
    document.querySelector('[data-stats-share="club-medals"] tbody td.stats-num b')

  async function renderWithDoublesGold() {
    fetchOnce({
      ...minimalLegacyPayload,
      clubMedals: [{
        club: 'THA', gold: 2, silver: 0, bronze: 0,
        goldMedalists: [
          { playerId: 'a', name: 'A', event: 'BD U15' },
          { playerId: 'b', name: 'B', event: 'BD U15' },
        ],
        silverMedalists: [], bronzeMedalists: [],
      }],
      clubRosters: [],
      countryRosters: [{ country: 'THA', players: 2, members: [] }],
    })
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeInTheDocument())
  }

  test('defaults to per-event counting (doubles win = 1 gold, checkbox checked)', async () => {
    await renderWithDoublesGold()
    expect(goldCell()?.textContent).toBe('1')
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  test('unchecking reveals raw per-medalist counts (doubles win = 2 golds)', async () => {
    await renderWithDoublesGold()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(goldCell()?.textContent).toBe('2')
  })
})

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

// Integration: the full seam from the Country section button through the modal
// and its lazy age fetch — the behavior the user asked for.
describe('TournamentStatsPanel — country roster modal + ages', () => {
  const countryPayload = {
    ...minimalLegacyPayload,
    countryRosters: [
      {
        country: 'THA',
        players: 1,
        members: ['Ravin CHUCHAISRI'],
        roster: [{ name: 'Ravin CHUCHAISRI', playerId: '86870', events: ['BS U15', 'BD U15'] }],
      },
    ],
  }

  test('clicking a country opens the modal and shows age + DOB tooltip', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/api/bwf/player-ages')) {
        return Promise.resolve({ ok: true, json: async () => ({ '86870': { age: 13, dob: '2013-06-06' } }) })
      }
      return Promise.resolve({ ok: true, json: async () => countryPayload })
    }) as unknown as typeof fetch

    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    // Country cell (name (code) label) renders as a button.
    const btn = await screen.findByRole('button', { name: /Thailand \(THA\)/ })
    await act(async () => { fireEvent.click(btn) })

    // Modal shows the player (in .country-roster-name), their age in parens,
    // and the DOB tooltip. (The name also appears in the count-cell tooltip,
    // so scope the assertion to the modal's row.)
    await waitFor(() => expect(screen.getByText('(13)')).toBeInTheDocument())
    const nameSpan = Array.from(document.querySelectorAll('.country-roster-name'))
      .find((el) => el.textContent?.includes('Ravin')) as HTMLElement
    expect(nameSpan).toBeTruthy()
    expect(nameSpan.getAttribute('title')).toBe('6 Jun 2013')
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/bwf/player-ages?ids=86870'))
  })
})

// Integration: clicking a club in the Club/Team section opens the club modal
// with each player's events. No age fetch (BAT has no age source here).
describe('TournamentStatsPanel — club roster modal', () => {
  const clubPayload = {
    ...minimalLegacyPayload,
    clubRosters: [
      {
        club: 'KBA',
        players: 2,
        members: ['Anan', 'Somchai'],
        roster: [
          { name: 'Anan', playerId: '3', events: ['XD'] },
          { name: 'Somchai', playerId: '1', events: ['MS', 'XD'] },
        ],
      },
    ],
  }

  test('clicking a club opens the modal listing players + events', async () => {
    fetchOnce(clubPayload)
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    const btn = await screen.findByRole('button', { name: 'KBA' })
    await act(async () => { fireEvent.click(btn) })

    await waitFor(() => {
      const names = Array.from(document.querySelectorAll('.country-roster-name')).map((el) => el.textContent)
      expect(names).toContain('Somchai')
    })
    expect(document.querySelector('.country-roster-chip')?.textContent).toBeTruthy()
    // No age fetch for BAT clubs.
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/bwf/player-ages'))
  })
})

describe('TournamentStatsPanel — club roster active/medaled counts', () => {
  const statusPayload = {
    ...minimalLegacyPayload,
    clubRosters: [
      {
        club: 'KBA',
        players: 3,
        members: ['A', 'B', 'C'],
        roster: [
          { name: 'A', playerId: '1', events: ['MS'], statusByEvent: { MS: 'in' } },   // active
          { name: 'B', playerId: '2', events: ['MS'], statusByEvent: { MS: 'gold' } }, // ended + medaled
          { name: 'C', playerId: '3', events: ['MS'], statusByEvent: { MS: 'out' } },  // ended
        ],
      },
    ],
  }

  test('shows Players / Active / Medaled columns per club', async () => {
    fetchOnce(statusPayload)
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    const btn = await screen.findByRole('button', { name: 'KBA' })
    expect(screen.getByText('statsColActive')).toBeTruthy()
    expect(screen.getByText('statsColMedaled')).toBeTruthy()

    const row = btn.closest('tr')!
    const nums = Array.from(row.querySelectorAll('.stats-num'))
    expect(nums).toHaveLength(3)
    expect(nums[0].textContent).toContain('3') // players (may include tooltip names)
    expect(nums[1].textContent).toBe('1')      // active
    expect(nums[2].textContent).toBe('1')      // medaled
  })
})

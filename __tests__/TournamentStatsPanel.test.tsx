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
    // Each cell renders the count followed by its hover popover's names, so
    // assert the count on the cell's first text node, not the whole subtree.
    const countOf = (el: Element) => el.querySelector('.stats-roster-cell')?.firstChild?.textContent
    expect(nums[0].textContent).toContain('3') // players (may include tooltip names)
    expect(countOf(nums[1])).toBe('1')         // active
    expect(countOf(nums[2])).toBe('1')         // medaled
  })

  test('Active and Medaled hover to the names behind the count', async () => {
    fetchOnce(statusPayload)
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    const btn = await screen.findByRole('button', { name: 'KBA' })
    const nums = Array.from(btn.closest('tr')!.querySelectorAll('.stats-num'))
    const tipNames = (el: Element) =>
      Array.from(el.querySelectorAll('.stats-roster-tip-row')).map((r) => r.textContent)
    expect(tipNames(nums[0])).toEqual(['A', 'B', 'C']) // every member
    expect(tipNames(nums[1])).toEqual(['A'])           // still in
    expect(tipNames(nums[2])).toEqual(['B'])           // medaled
  })

  test('a zero count renders bare, with no empty popover to open', async () => {
    fetchOnce({
      ...minimalLegacyPayload,
      clubRosters: [{
        club: 'KBA',
        players: 1,
        members: ['C'],
        roster: [{ name: 'C', playerId: '3', events: ['MS'], statusByEvent: { MS: 'out' } }],
      }],
    })
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    const btn = await screen.findByRole('button', { name: 'KBA' })
    const nums = Array.from(btn.closest('tr')!.querySelectorAll('.stats-num'))
    expect(nums[1].textContent).toBe('0')                              // active
    expect(nums[1].querySelector('.stats-roster-cell')).toBeNull()
    expect(nums[2].textContent).toBe('0')                              // medaled
    expect(nums[2].querySelector('.stats-roster-cell')).toBeNull()
  })
})

describe('TournamentStatsPanel — club roster sorting', () => {
  // Arrives in the API's own order (clubs ranked by squad size). Each club's
  // players/active/medaled deliberately rank differently so a sort on one
  // column cannot be mistaken for a sort on another.
  const member = (name: string, status: 'in' | 'gold' | 'out') =>
    ({ name, playerId: name, events: ['MS'], statusByEvent: { MS: status } })
  const sortPayload = {
    ...minimalLegacyPayload,
    clubRosters: [
      // players 4, active 1, medaled 0
      { club: 'Big', players: 4, members: ['b1', 'b2', 'b3', 'b4'],
        roster: [member('b1', 'in'), member('b2', 'out'), member('b3', 'out'), member('b4', 'out')] },
      // players 3, active 3, medaled 0
      { club: 'Mid', players: 3, members: ['m1', 'm2', 'm3'],
        roster: [member('m1', 'in'), member('m2', 'in'), member('m3', 'in')] },
      // players 2, active 0, medaled 2
      { club: 'Small', players: 2, members: ['s1', 's2'],
        roster: [member('s1', 'gold'), member('s2', 'gold')] },
    ],
  }

  async function renderClubs(payload: unknown = sortPayload) {
    fetchOnce(payload)
    await act(async () => {
      render(<TournamentStatsPanel tournamentId="TEST-2026" tournamentName="Test 2026" />)
    })
    await screen.findByText('statsSectionClubRosters')
  }

  const header = (label: string) =>
    Array.from(document.querySelectorAll('th.stats-th-sort'))
      .find((th) => (th.textContent ?? '').startsWith(label))!

  const clubOrder = () =>
    Array.from(document.querySelectorAll('.stats-table'))
      .find((tbl) => tbl.querySelector('th.stats-th-sort'))!
      .querySelectorAll('tbody .stats-country-link')

  const clubs = () => Array.from(clubOrder()).map((b) => b.textContent)

  it('leaves the incoming order alone until a header is clicked', async () => {
    await renderClubs()
    expect(clubs()).toEqual(['Big', 'Mid', 'Small'])
    expect(header('statsColPlayers').getAttribute('aria-sort')).toBe('none')
  })

  it('sorts by players, biggest first, then flips on a second click', async () => {
    await renderClubs()
    await act(async () => { fireEvent.click(header('statsColPlayers')) })
    expect(clubs()).toEqual(['Big', 'Mid', 'Small'])
    expect(header('statsColPlayers').getAttribute('aria-sort')).toBe('descending')
    await act(async () => { fireEvent.click(header('statsColPlayers')) })
    expect(clubs()).toEqual(['Small', 'Mid', 'Big'])
    expect(header('statsColPlayers').getAttribute('aria-sort')).toBe('ascending')
  })

  it('sorts by active count, which is not the players order', async () => {
    await renderClubs()
    await act(async () => { fireEvent.click(header('statsColActive')) })
    expect(clubs()).toEqual(['Mid', 'Big', 'Small'])
    await act(async () => { fireEvent.click(header('statsColActive')) })
    expect(clubs()).toEqual(['Small', 'Big', 'Mid'])
  })

  it('sorts by medaled count, which is not the players order either', async () => {
    await renderClubs()
    await act(async () => { fireEvent.click(header('statsColMedaled')) })
    expect(clubs()[0]).toBe('Small')
  })

  it('moves the arrow to whichever column is sorting', async () => {
    await renderClubs()
    await act(async () => { fireEvent.click(header('statsColActive')) })
    expect(header('statsColActive').getAttribute('aria-sort')).toBe('descending')
    expect(header('statsColPlayers').getAttribute('aria-sort')).toBe('none')
    expect(header('statsColMedaled').getAttribute('aria-sort')).toBe('none')
  })

  it('sorts before the top-10 slice, so the collapsed table shows the real top 10', async () => {
    // 12 clubs: squad size descending, medal count ascending. Sorting by
    // medaled must surface clubs that the default top-10 would have cut.
    const many = Array.from({ length: 12 }, (_, i) => ({
      club: `C${i}`,
      players: 12 - i,
      members: [`p${i}`],
      roster: [member(`p${i}`, i >= 10 ? 'gold' : 'out')],
    }))
    await renderClubs({ ...minimalLegacyPayload, clubRosters: many })
    expect(clubs()).toHaveLength(10)
    expect(clubs()).not.toContain('C11')
    await act(async () => { fireEvent.click(header('statsColMedaled')) })
    expect(clubs().slice(0, 2).sort()).toEqual(['C10', 'C11'])
  })
})

/** @jest-environment jsdom */
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import LeaderboardsView from '@/components/LeaderboardsView'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { Leaderboards } from '@/lib/types'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}))

const renderLB = (lb: Leaderboards | Leaderboards[]) =>
  render(<LanguageProvider><LeaderboardsView leaderboards={Array.isArray(lb) ? lb : [lb]} /></LanguageProvider>)

const sample: Leaderboards = {
  version: 1, provider: 'bat', generatedAt: 'T', sourceVersion: 'v',
  boards: [
    { id: 'headline.titles', titleKey: 'lbMostTitles', icon: '🏆', category: 'headline',
      entries: [
        { rank: 1, slug: 'a', name: 'Anuwat', primaryClub: 'Bangkok BC', value: 12, display: '12' },
        { rank: 2, slug: 'b', name: 'Boon', primaryClub: 'Hat Yai', value: 9, display: '9' },
      ] },
    { id: 'character.comebacks', titleKey: 'lbComebackWins', icon: '🔁', category: 'character',
      entries: [{ rank: 1, slug: 'c', name: 'Chai', primaryClub: 'Khon Kaen BC', value: 5, display: '5' }] },
  ],
}

const sampleBwf: Leaderboards = {
  version: 1, provider: 'bwf', generatedAt: 'T', sourceVersion: 'v',
  boards: [
    { id: 'headline.titles', titleKey: 'lbMostTitles', icon: '🏆', category: 'headline',
      entries: [
        { rank: 1, slug: 'ratchanok', name: 'Ratchanok', primaryClub: 'Thailand', value: 5, display: '5' },
      ] },
  ],
}

describe('LeaderboardsView', () => {
  it('renders all category tabs', () => {
    renderLB(sample)
    expect(screen.getByText(/Headline/i)).toBeTruthy()
    expect(screen.getByText(/3 Gamers/i)).toBeTruthy()
  })

  it('renders entries for the default tab', () => {
    renderLB(sample)
    expect(screen.getByText('Anuwat')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
  })

  it('renders empty-state when no boards', () => {
    const empty: Leaderboards = { ...sample, boards: [] }
    renderLB(empty)
    expect(screen.getByText(/no leaderboards/i)).toBeTruthy()
  })

  it('shows provider tabs when multiple providers supplied', () => {
    renderLB([sample, sampleBwf])
    expect(screen.getByText('BAT')).toBeTruthy()
    expect(screen.getByText('BWF Asia Jr.')).toBeTruthy()
  })

  it('switches provider when tab clicked', () => {
    renderLB([sample, sampleBwf])
    expect(screen.queryByText('Ratchanok')).toBeNull()
    fireEvent.click(screen.getByText('BWF Asia Jr.'))
    expect(screen.getByText('Ratchanok')).toBeTruthy()
  })

  it('shows BAT+BWF label for combined provider tab', () => {
    const combined = { ...sample, provider: 'combined' as const }
    renderLB([sample, combined])
    expect(screen.getByText('BAT+BWF')).toBeTruthy()
  })

  it('uses per-entry provider for profile links', () => {
    const withProvider = {
      ...sample,
      provider: 'combined' as const,
      boards: [{
        ...sample.boards[0],
        entries: [
          { rank: 1, slug: 'a', name: 'Anuwat', primaryClub: 'Bangkok BC', value: 12, display: '12', provider: 'bat' as const },
          { rank: 2, slug: 'b', name: 'Boon', primaryClub: 'Hat Yai', value: 9, display: '9', provider: 'bwf' as const },
        ],
      }],
    }
    renderLB(withProvider)
    const links = document.querySelectorAll('a[href*="/player/"]')
    const hrefs = Array.from(links).map(l => l.getAttribute('href'))
    expect(hrefs).toContain('/player/bat/a')
    expect(hrefs).toContain('/player/bwf/b')
  })
})

describe('LeaderboardsView ranking delta badge', () => {
  const makeRankingBoard = (entries: Array<{ rank: number; slug: string; previousRank?: number }>): Leaderboards => ({
    version: 1,
    provider: 'bat',
    generatedAt: 'T',
    sourceVersion: 'v',
    boards: [{
      id: 'ranking-ms',
      titleKey: "Men's Singles",
      icon: '🏸',
      category: 'ranking',
      entries: entries.map(e => ({
        rank: e.rank,
        slug: e.slug,
        name: `Player ${e.slug}`,
        primaryClub: 'Club',
        value: 100,
        display: '100 pts',
        previousRank: e.previousRank,
      })),
    }],
  })

  it('renders an up arrow with magnitude when the player climbed', () => {
    renderLB(makeRankingBoard([{ rank: 3, slug: 'a', previousRank: 7 }]))
    const badge = screen.getByText('▲4')
    expect(badge.className).toContain('lb-rk-delta-up')
  })

  it('renders a down arrow with magnitude when the player fell', () => {
    renderLB(makeRankingBoard([{ rank: 9, slug: 'a', previousRank: 5 }]))
    const badge = screen.getByText('▼4')
    expect(badge.className).toContain('lb-rk-delta-down')
  })

  it('renders a NEW badge when previousRank is absent', () => {
    renderLB(makeRankingBoard([{ rank: 1, slug: 'a' }]))
    const badge = screen.getByText('NEW')
    expect(badge.className).toContain('lb-rk-delta-new')
  })

  it('renders an em dash when rank is unchanged', () => {
    renderLB(makeRankingBoard([{ rank: 4, slug: 'a', previousRank: 4 }]))
    const badge = screen.getByText('—')
    expect(badge.className).toContain('lb-rk-delta-same')
    expect(screen.queryByText(/▲|▼|NEW/)).toBeNull()
  })

  it('does not render a badge on non-ranking-category boards even when previousRank is present', () => {
    const lb: Leaderboards = {
      version: 1, provider: 'bat', generatedAt: 'T', sourceVersion: 'v',
      boards: [{
        id: 'headline.titles', titleKey: 'lbMostTitles', icon: '🏆', category: 'headline',
        entries: [{
          rank: 1, slug: 'a', name: 'Anuwat', primaryClub: 'BKK', value: 12, display: '12',
          previousRank: 5,
        }],
      }],
    }
    renderLB(lb)
    expect(screen.queryByText(/▲|▼|NEW|—/)).toBeNull()
  })
})

describe('Next Ranking (beta) checkbox', () => {
  const u15LB: Leaderboards = {
    version: 1, provider: 'bat', generatedAt: 'T', sourceVersion: 'v',
    boards: [
      { id: 'ranking-u15_ms', titleKey: 'U15 Boys singles', icon: '🏸', category: 'ranking',
        entries: [{ rank: 1, slug: 'p0', name: 'P0', primaryClub: 'C', value: 1000, display: '1,000 pts', previousRank: 1 }] },
      { id: 'ranking-u15_ws', titleKey: 'U15 Girls singles', icon: '🏸', category: 'ranking',
        entries: [{ rank: 1, slug: 'w0', name: 'W0', primaryClub: 'C', value: 1000, display: '1,000 pts', previousRank: 1 }] },
      { id: 'ranking-u15_md', titleKey: 'U15 Boys doubles', icon: '🏸', category: 'ranking',
        entries: [{ rank: 1, slug: 'd0', name: 'D0', primaryClub: 'C', value: 1000, display: '1,000 pts', previousRank: 1 }] },
    ],
  }
  const renderWith = (ready: { ready: boolean; have: number; total: number }) =>
    render(
      <LanguageProvider>
        <LeaderboardsView
          leaderboards={[u15LB]}
          rankingPublishDates={{ bat: '23/6/2569' }}
          projectedReady={ready}
        />
      </LanguageProvider>,
    )

  it('renders a checkbox on every projected U15 board, disabled with progress when not ready', () => {
    renderWith({ ready: false, have: 12, total: 250 })
    const cbs = screen.getAllByLabelText(/Next Ranking/i) as HTMLInputElement[]
    expect(cbs).toHaveLength(3)            // boys + girls singles, boys doubles
    expect(cbs.every(cb => cb.disabled)).toBe(true)
    expect(screen.getAllByText(/12\/250/).length).toBeGreaterThan(0)
  })

  it('offers the projection on the doubles board too', () => {
    renderWith({ ready: true, have: 250, total: 250 })
    const doublesCard = screen.getByText('U15 Boys doubles').closest('.lb-card')!
    expect(doublesCard.querySelector('input[type="checkbox"]')).not.toBeNull()
  })

  it('is enabled when ready', () => {
    renderWith({ ready: true, have: 250, total: 250 })
    const cbs = screen.getAllByLabelText(/Next Ranking/i) as HTMLInputElement[]
    expect(cbs.every(cb => !cb.disabled)).toBe(true)
  })

  it('fetches the per-board event and shows only the top 30 rows', async () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      slug: `p${i}`, name: `Player ${i}`,
      officialRank: i + 1, officialPoints: 5000 - i,
      projectedRank: i + 1, projectedPoints: 5000 - i, delta: 0,
    }))
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({ ready: true, publishDate: '23/6/2569', event: 'U15_MS', entries }),
    })
    ;(global as unknown as { fetch: jest.Mock }).fetch = fetchMock

    renderWith({ ready: true, have: 250, total: 250 })
    const cb = screen.getAllByLabelText(/Next Ranking/i)[0] as HTMLInputElement // boys singles
    await act(async () => { fireEvent.click(cb) })

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('event=U15_MS'))
    expect(screen.getByText('Player 29')).toBeTruthy()
    expect(screen.queryByText('Player 30')).toBeNull()
    expect(screen.queryByText('Player 49')).toBeNull()
  })
})

describe('Winners tab', () => {
  const winnerRow = (
    rank: number, slug: string, name: string,
    tournamentName: string, tournamentDateIso: string,
    partners?: Array<{ name: string; slug: string }>,
  ) => ({
    rank, slug, name, primaryClub: 'Bangkok BC',
    value: Number(tournamentDateIso.replace(/-/g, '')),
    display: tournamentDateIso, tournamentName, tournamentDateIso,
    ...(partners ? { partners } : {}),
  })

  const winnersLB: Leaderboards = {
    version: 1, provider: 'bat', generatedAt: 'T', sourceVersion: 'v',
    boards: [
      { id: 'headline.titles', titleKey: 'lbMostTitles', icon: '🏆', category: 'headline',
        entries: [{ rank: 1, slug: 'a', name: 'Anuwat', primaryClub: 'Bangkok BC', value: 12, display: '12' }] },
      { id: 'winners-2026-bs-u13', titleKey: 'BS U13', icon: '🏆', category: 'winners',
        entries: [winnerRow(1, 'n', 'Nattapon', 'Trang Open 2026', '2026-04-17')] },
      { id: 'winners-2025-bs-u13', titleKey: 'BS U13', icon: '🏆', category: 'winners',
        entries: [winnerRow(1, 'a', 'Anuwat', 'THE MALL 2025', '2025-10-03')] },
      { id: 'winners-2025-xd-u17', titleKey: 'XD U17', icon: '🏆', category: 'winners',
        entries: [winnerRow(1, 'a', 'Anuwat', 'THE MALL 2025', '2025-10-03', [{ name: 'Boon', slug: 'b' }])] },
    ],
  }

  const openWinners = () => {
    renderLB(winnersLB)
    fireEvent.click(screen.getByText(/^Winners$/i))
  }

  it('offers a Winners tab', () => {
    renderLB(winnersLB)
    expect(screen.getByText(/^Winners$/i)).toBeTruthy()
  })

  it('shows the newest year by default and its event boards', () => {
    openWinners()
    expect(screen.getByText('Trang Open 2026')).toBeTruthy()
    expect(screen.queryByText('THE MALL 2025')).toBeNull()
  })

  it('switches year and swaps the boards', () => {
    openWinners()
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } })
    // Both 2025 boards (BS U13, XD U17) were won at the same tournament.
    expect(screen.getAllByText('THE MALL 2025').length).toBe(2)
    expect(screen.getByText('XD U17')).toBeTruthy()
    expect(screen.queryByText('Trang Open 2026')).toBeNull()
  })

  it('lists only the years present in the data, newest first', () => {
    openWinners()
    const opts = Array.from(
      (screen.getByLabelText('Year') as HTMLSelectElement).options,
    ).map(o => o.value)
    expect(opts).toEqual(['2026', '2025'])
  })

  it('links both champions of a doubles title', () => {
    openWinners()
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2025' } })
    const card = screen.getByText('XD U17').closest('.lb-card')!
    const hrefs = Array.from(card.querySelectorAll('a[href*="/player/"]'))
      .map(a => a.getAttribute('href'))
    expect(hrefs).toEqual(expect.arrayContaining(['/player/bat/a', '/player/bat/b']))
  })

  it('shows a trophy instead of a rank number on winners rows', () => {
    openWinners()
    const card = screen.getByText('BS U13').closest('.lb-card')!
    expect(card.querySelector('.lb-rk-n')).toBeNull()
    expect(card.querySelector('.lb-rk-trophy')).not.toBeNull()
  })

  it('hides the Winners tab when no winners boards exist', () => {
    renderLB(sample)
    expect(screen.queryByText(/^Winners$/i)).toBeNull()
  })
})

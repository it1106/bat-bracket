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

  it('renders a checkbox on every U15 board, disabled with progress when not ready', () => {
    renderWith({ ready: false, have: 12, total: 250 })
    const cbs = screen.getAllByLabelText(/Next Ranking/i) as HTMLInputElement[]
    expect(cbs).toHaveLength(2)            // boys singles + boys doubles boards
    expect(cbs.every(cb => cb.disabled)).toBe(true)
    expect(screen.getAllByText(/12\/250/).length).toBeGreaterThan(0)
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

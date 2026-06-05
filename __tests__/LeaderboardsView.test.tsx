/** @jest-environment jsdom */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
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

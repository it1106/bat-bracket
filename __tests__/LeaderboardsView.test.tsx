/** @jest-environment jsdom */
import React from 'react'
import { render, screen } from '@testing-library/react'
import LeaderboardsView from '@/components/LeaderboardsView'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { Leaderboards } from '@/lib/types'

const renderLB = (lb: Leaderboards) =>
  render(<LanguageProvider><LeaderboardsView leaderboards={lb} /></LanguageProvider>)

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

describe('LeaderboardsView', () => {
  it('renders all category tabs', () => {
    renderLB(sample)
    expect(screen.getByText(/Headline/i)).toBeTruthy()
    expect(screen.getByText(/Character/i)).toBeTruthy()
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

  it('shows BAT+BWF subtitle for combined provider', () => {
    const combined = { ...sample, provider: 'combined' as const }
    renderLB(combined)
    expect(screen.getByText(/BAT\+BWF/)).toBeTruthy()
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

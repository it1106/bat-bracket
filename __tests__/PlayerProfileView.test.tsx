/** @jest-environment jsdom */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import PlayerProfileView from '@/components/PlayerProfileView'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { PlayerRecord } from '@/lib/types'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}))

function renderProfile(record: PlayerRecord) {
  return render(
    <LanguageProvider>
      <PlayerProfileView record={record} />
    </LanguageProvider>,
  )
}

// PlayerProfileView fetches /api/players/profile-extra on mount; stub it.
beforeAll(() => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, json: async () => ({}) })) as unknown as typeof fetch
})

function emptyDisc() { return { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 } }

const sample: PlayerRecord = {
  key: { provider: 'bat', slug: 'foo' },
  displayName: 'Somchai Suksawat',
  altNames: [],
  clubs: ['Bangkok BC'],
  totals: { matches: 35, wins: 24, losses: 11,
    walkoversReceived: 1, walkoversGiven: 0,
    retirementsReceived: 1, retirementsGiven: 0 },
  byDiscipline: { singles: { ...emptyDisc(), wins: 8, losses: 4, titles: 1 },
    doubles: { ...emptyDisc(), wins: 11, losses: 4, titles: 1 },
    mixed: { ...emptyDisc(), wins: 5, losses: 3 } },
  titles: [], finals: [], semis: [],
  tournaments: [{ tournamentId: 'X', tournamentName: 'Toyota 2569', tournamentDateIso: '2026-05-01',
    events: [{ tournamentId: 'X', eventId: '1', eventName: 'BS U15', discipline: 'singles', bestFinish: 'Champion', wins: 4, losses: 0 }] }],
  recentForm: [],
  matchCharacter: { courtMinutes: 1102, avgMatchMinutes: 31, longestMatchMinutes: 74,
    longestMatchRef: null, threeSetterCount: 10, threeSetterRate: 0.28,
    threeSetterWins: 6, comebackWins: 3, firstGameLost: 5, comebackWinRef: null, matchesLast90: 12 },
  opponents: [], partners: [],
  ranks: { titles: 18, wins: 34 },
}

describe('PlayerProfileView', () => {
  it('renders the display name', () => {
    renderProfile(sample)
    expect(screen.getByText('Somchai Suksawat')).toBeTruthy()
  })

  it('renders the KPI strip values', () => {
    renderProfile(sample)
    expect(screen.getByText('24')).toBeTruthy()
    expect(screen.getByText('11')).toBeTruthy()
  })

  it('renders the tournament-history Champion chip', () => {
    renderProfile(sample)
    expect(screen.getByText(/Champion/i)).toBeTruthy()
  })

  it('renders rank badges from ranks map', () => {
    renderProfile(sample)
    expect(screen.getByText(/#18/)).toBeTruthy()
    expect(screen.getByText(/#34/)).toBeTruthy()
  })

  function withOpponents(extra: Partial<PlayerRecord> = {}): PlayerRecord {
    const lifetime = [
      { slug: 'lifetime-foe', name: 'Lifetime Foe', meetings: 5, wins: 3, losses: 2, lastRound: 'F', lastEvent: 'BS' },
    ]
    const recent = [
      { slug: 'recent-foe', name: 'Recent Foe', meetings: 2, wins: 1, losses: 1, lastRound: 'R16', lastEvent: 'BS' },
    ]
    return {
      ...sample,
      opponents: lifetime,
      opponentsByWindow: {
        '30d': recent, '90d': recent, '180d': recent, '1y': lifetime, all: lifetime,
      },
      ...extra,
    }
  }

  it('defaults to the All Time tab and renders the lifetime list', () => {
    renderProfile(withOpponents())
    expect(screen.getByText('Lifetime Foe')).toBeTruthy()
    const allTab = screen.getByRole('tab', { name: 'All Time' })
    expect(allTab.getAttribute('aria-selected')).toBe('true')
  })

  it('switching to 30 Days shows the windowed list', () => {
    renderProfile(withOpponents())
    fireEvent.click(screen.getByRole('tab', { name: '30 Days' }))
    expect(screen.getByText('Recent Foe')).toBeTruthy()
    expect(screen.queryByText('Lifetime Foe')).toBeNull()
  })

  it('empty window shows the empty-state message but keeps the tab strip', () => {
    const empty = withOpponents({
      opponentsByWindow: {
        '30d': [], '90d': [], '180d': [], '1y': [], all: [
          { slug: 'a', name: 'A', meetings: 1, wins: 1, losses: 0, lastRound: 'F', lastEvent: 'BS' },
        ],
      },
    })
    renderProfile(empty)
    fireEvent.click(screen.getByRole('tab', { name: '30 Days' }))
    expect(screen.getByText('No opponents in this period')).toBeTruthy()
    // Tab strip remains so the user can switch back
    expect(screen.getByRole('tab', { name: 'All Time' })).toBeTruthy()
  })

  it('legacy record without opponentsByWindow still renders lifetime list on All Time tab', () => {
    const legacy: PlayerRecord = {
      ...sample,
      opponents: [
        { slug: 'legacy', name: 'Legacy Foe', meetings: 7, wins: 4, losses: 3, lastRound: 'SF', lastEvent: 'XD' },
      ],
      // opponentsByWindow intentionally omitted
    }
    renderProfile(legacy)
    expect(screen.getByText('Legacy Foe')).toBeTruthy()
  })

  it('collapses opponents to top 10 with a Show more toggle', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => ({
      slug: `foe-${i}`, name: `Foe ${String(i).padStart(2, '0')}`,
      meetings: 15 - i, wins: 15 - i, losses: 0, lastRound: 'R16', lastEvent: 'BS',
    }))
    const rec: PlayerRecord = {
      ...sample,
      opponents: fifteen,
      opponentsByWindow: { '30d': fifteen, '90d': fifteen, '180d': fifteen, '1y': fifteen, all: fifteen },
    }
    renderProfile(rec)
    // Collapsed: 10 visible, 11+ hidden.
    expect(screen.getByText('Foe 00')).toBeTruthy()
    expect(screen.getByText('Foe 09')).toBeTruthy()
    expect(screen.queryByText('Foe 10')).toBeNull()
    expect(screen.queryByText('Foe 14')).toBeNull()
    // Show more click → all 15 visible.
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByText('Foe 14')).toBeTruthy()
    // Toggle flips to Show less.
    expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy()
  })

  it('omits the Show more button when the list is at or below the cap', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({
      slug: `s-${i}`, name: `Short ${i}`, meetings: 8 - i, wins: 8 - i, losses: 0,
      lastRound: 'R16', lastEvent: 'BS',
    }))
    const rec: PlayerRecord = {
      ...sample,
      opponents: eight,
      opponentsByWindow: { '30d': eight, '90d': eight, '180d': eight, '1y': eight, all: eight },
    }
    renderProfile(rec)
    expect(screen.getByText('Short 0')).toBeTruthy()
    expect(screen.getByText('Short 7')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('switching tabs while expanded resets the list back to top 10', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => ({
      slug: `foe-${i}`, name: `Foe ${String(i).padStart(2, '0')}`,
      meetings: 15 - i, wins: 15 - i, losses: 0, lastRound: 'R16', lastEvent: 'BS',
    }))
    const rec: PlayerRecord = {
      ...sample,
      opponents: fifteen,
      opponentsByWindow: { '30d': fifteen, '90d': fifteen, '180d': fifteen, '1y': fifteen, all: fifteen },
    }
    renderProfile(rec)
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByText('Foe 14')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '30 Days' }))
    expect(screen.queryByText('Foe 14')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy()
  })
})

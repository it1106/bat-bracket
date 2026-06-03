/** @jest-environment jsdom */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import PlayerProfileView from '@/components/PlayerProfileView'
import type { PlayerRecord } from '@/lib/types'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}))

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
    render(<PlayerProfileView record={sample} />)
    expect(screen.getByText('Somchai Suksawat')).toBeTruthy()
  })

  it('renders the KPI strip values', () => {
    render(<PlayerProfileView record={sample} />)
    expect(screen.getByText('24')).toBeTruthy()
    expect(screen.getByText('11')).toBeTruthy()
  })

  it('renders the tournament-history Champion chip', () => {
    render(<PlayerProfileView record={sample} />)
    expect(screen.getByText(/Champion/i)).toBeTruthy()
  })

  it('renders rank badges from ranks map', () => {
    render(<PlayerProfileView record={sample} />)
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
    render(<PlayerProfileView record={withOpponents()} />)
    expect(screen.getByText('Lifetime Foe')).toBeTruthy()
    const allTab = screen.getByRole('tab', { name: 'All Time' })
    expect(allTab.getAttribute('aria-selected')).toBe('true')
  })

  it('switching to 30 Days shows the windowed list', () => {
    render(<PlayerProfileView record={withOpponents()} />)
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
    render(<PlayerProfileView record={empty} />)
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
    render(<PlayerProfileView record={legacy} />)
    expect(screen.getByText('Legacy Foe')).toBeTruthy()
  })
})

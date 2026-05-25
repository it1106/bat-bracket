/** @jest-environment jsdom */
import React from 'react'
import { render, screen } from '@testing-library/react'
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
})

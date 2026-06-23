/** @jest-environment jsdom */
import React from 'react'
import { render, screen } from '@testing-library/react'
import PlayerProfileView from '@/components/PlayerProfileView'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { PlayerRecord, PlayerEventResult } from '@/lib/types'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}))

beforeAll(() => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, json: async () => ({}) })) as unknown as typeof fetch
})

function emptyDisc() { return { wins: 0, losses: 0, titles: 0, finals: 0, semis: 0 } }

function recordWith(events: PlayerEventResult[]): PlayerRecord {
  return {
    key: { provider: 'bat', slug: 'foo' },
    displayName: 'Test Player',
    altNames: [], clubs: ['BC'],
    totals: { matches: 1, wins: 0, losses: 1, walkoversReceived: 0, walkoversGiven: 0, retirementsReceived: 0, retirementsGiven: 0 },
    byDiscipline: { singles: emptyDisc(), doubles: emptyDisc(), mixed: emptyDisc() },
    titles: [], finals: [], semis: [],
    tournaments: [{ tournamentId: 'T', tournamentName: 'BAT Open', tournamentDateIso: '2026-05-01', events }],
    recentForm: [],
    matchCharacter: { courtMinutes: 0, avgMatchMinutes: 0, longestMatchMinutes: 0, longestMatchRef: null, threeSetterCount: 0, threeSetterRate: 0, threeSetterWins: 0, comebackWins: 0, firstGameLost: 0, comebackWinRef: null, matchesLast90: 0 },
    opponents: [], partners: [], ranks: {},
  }
}

function renderWith(events: PlayerEventResult[], levels?: Record<string, number>) {
  return render(
    <LanguageProvider>
      <PlayerProfileView record={recordWith(events)} tournamentLevels={levels} />
    </LanguageProvider>,
  )
}

describe('PlayerProfileView — projected points', () => {
  it('credits a bye-then-R16-loss as a first-round loss (BS U15 Lv1, 32-draw → 3,355)', () => {
    renderWith(
      [{ tournamentId: 'T', eventId: '1', eventName: 'BS U15', discipline: 'singles', bestFinish: 'R16', wins: 0, losses: 1, drawSize: 32 }],
      { T: 1 },
    )
    expect(screen.getByText(/≈3,355 pts/)).toBeTruthy()
  })

  it('shows no points when the tournament level is unknown', () => {
    renderWith(
      [{ tournamentId: 'T', eventId: '1', eventName: 'BS U15', discipline: 'singles', bestFinish: 'R16', wins: 0, losses: 1, drawSize: 32 }],
      undefined,
    )
    expect(screen.queryByText(/pts/)).toBeNull()
  })

  it('supersedes the lower same-discipline entry, keeps the other discipline', () => {
    renderWith(
      [
        // Two singles entries: U15 (R16 loss, 0 wins, 32-draw → R32 row = 3355)
        // and U13 (Champion, 16-draw → Winner = 6554). U13 wins → it counts;
        // U15 is superseded.
        { tournamentId: 'T', eventId: '1', eventName: 'BS U15', discipline: 'singles', bestFinish: 'R16', wins: 0, losses: 1, drawSize: 32 },
        { tournamentId: 'T', eventId: '2', eventName: 'BS U13', discipline: 'singles', bestFinish: 'Champion', wins: 4, losses: 0, drawSize: 16 },
        // A doubles entry counts independently.
        { tournamentId: 'T', eventId: '3', eventName: 'BD U13', discipline: 'doubles', bestFinish: 'SF', wins: 2, losses: 1, drawSize: 16 },
      ],
      { T: 1 },
    )
    const counting = document.querySelectorAll('.pp-ev-chip-pts:not(.pp-ev-chip-pts-superseded)')
    const superseded = document.querySelectorAll('.pp-ev-chip-pts-superseded')
    // BS U13 (singles winner) and BD U13 (doubles) count; BS U15 is superseded.
    expect(counting.length).toBe(2)
    expect(superseded.length).toBe(1)
    expect(superseded[0].textContent).toMatch(/3,355/)
  })
})

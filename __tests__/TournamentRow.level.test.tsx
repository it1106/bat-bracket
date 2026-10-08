/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import TournamentRow from '../components/TournamentRow'
import type { RankingPlayerTournament } from '../lib/types'

jest.mock('../lib/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}))

const ID = '01BB8E3F-818C-4B90-94A5-9FB03D0D15A9'

function row(over: Partial<RankingPlayerTournament> = {}): RankingPlayerTournament {
  return {
    tournamentName: 'Test Open 2026',
    tournamentId: ID,
    sourceEvent: 'BS U15',
    week: '2026-20',
    result: '',
    points: 1000,
    ...over,
  } as RankingPlayerTournament
}

describe('TournamentRow level suffix', () => {
  it('appends the level in parentheses, matching the tournament dropdown', () => {
    render(<TournamentRow row={row()} tournamentLevels={{ [ID]: 2 }} />)
    const link = screen.getByRole('link', { name: 'Test Open 2026 (L2)' })
    // The level is display-only — the link still carries the bare name.
    expect(link.getAttribute('href')).toBe(`/?tournament=${ID}&name=${encodeURIComponent('Test Open 2026')}`)
  })

  it('renders the bare name when the level is unknown', () => {
    render(<TournamentRow row={row()} tournamentLevels={{}} />)
    expect(screen.getByRole('link', { name: 'Test Open 2026' })).toBeTruthy()
  })

  it('renders the bare name when the row has no tournament id', () => {
    render(<TournamentRow row={row({ tournamentId: null })} tournamentLevels={{ [ID]: 2 }} />)
    expect(screen.getByText('Test Open 2026')).toBeTruthy()
  })
})

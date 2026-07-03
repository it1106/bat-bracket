/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CountryRosterModal from '@/components/CountryRosterModal'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { StatsCountryRoster } from '@/lib/types'

const roster: StatsCountryRoster = {
  country: 'THA',
  players: 2,
  members: ['Anan', 'Somchai'],
  roster: [
    { name: 'Anan', playerId: '1', events: ['XD'] },
    { name: 'Somchai', playerId: '2', events: ['MS', 'XD'] },
  ],
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      '1': { age: 15, dob: '2011-01-02' },
      '2': { age: 13, dob: '2013-06-06' },
    }),
  }) as unknown as typeof fetch
})
afterEach(() => { jest.restoreAllMocks() })

function renderModal(r: StatsCountryRoster | null, onClose = () => {}) {
  return render(
    <LanguageProvider>
      <CountryRosterModal roster={r} onClose={onClose} />
    </LanguageProvider>,
  )
}

describe('CountryRosterModal', () => {
  it('renders nothing when roster is null', () => {
    const { container } = renderModal(null)
    expect(container.querySelector('.pm-overlay')).toBeNull()
  })

  it('shows each player age in parens and a DOB hover tooltip', async () => {
    const { container } = renderModal(roster)
    await waitFor(() => expect(screen.getByText('(13)')).toBeInTheDocument())
    expect(screen.getByText('(15)')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/bwf/player-ages?ids='))
    // Somchai's name span carries the formatted DOB as its title (tooltip).
    const somchai = Array.from(container.querySelectorAll('.country-roster-name'))
      .find((el) => el.textContent?.includes('Somchai')) as HTMLElement
    expect(somchai.getAttribute('title')).toBe('6 Jun 2013')
  })

  it('shows the full country name, player count, and each player with events', () => {
    renderModal(roster)
    expect(screen.getByText(/Thailand \(THA\)/)).toBeInTheDocument()
    expect(screen.getByText('Somchai')).toBeInTheDocument()
    expect(screen.getByText('Anan')).toBeInTheDocument()
    // Somchai's two events render as chips.
    expect(screen.getAllByText('XD').length).toBe(2)
    expect(screen.getByText('MS')).toBeInTheDocument()
  })

  it('closes on Escape and on overlay click', () => {
    const onClose = jest.fn()
    const { container } = renderModal(roster, onClose)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(container.querySelector('.pm-overlay')!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('falls back to bare names when roster.roster is absent (old cache)', () => {
    renderModal({ country: 'INA', players: 1, members: ['Budi'] })
    expect(screen.getByText('Budi')).toBeInTheDocument()
    expect(screen.getByText(/Indonesia \(INA\)/)).toBeInTheDocument()
  })
})

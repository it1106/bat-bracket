/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import CountryRosterModal from '@/components/CountryRosterModal'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { StatsCountryRoster } from '@/lib/types'

const roster: StatsCountryRoster = {
  country: 'THA',
  players: 2,
  members: ['Anan', 'Somchai'],
  roster: [
    { name: 'Anan', events: ['XD'] },
    { name: 'Somchai', events: ['MS', 'XD'] },
  ],
}

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

/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import ClubRosterModal from '@/components/ClubRosterModal'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { StatsClubRoster } from '@/lib/types'

const roster: StatsClubRoster = {
  club: 'KBA',
  players: 2,
  members: ['Anan', 'Somchai'],
  roster: [
    { name: 'Anan', playerId: '3', events: ['XD'] },
    { name: 'Somchai', playerId: '1', events: ['MS', 'XD'] },
  ],
}

function renderModal(r: StatsClubRoster | null, onClose = () => {}) {
  return render(
    <LanguageProvider>
      <ClubRosterModal roster={r} onClose={onClose} />
    </LanguageProvider>,
  )
}

describe('ClubRosterModal', () => {
  it('renders nothing when roster is null', () => {
    const { container } = renderModal(null)
    expect(container.querySelector('.pm-overlay')).toBeNull()
  })

  it('shows the club name, player count, and each player with events', () => {
    renderModal(roster)
    expect(screen.getByText(/KBA/)).toBeInTheDocument()
    expect(screen.getByText('Somchai')).toBeInTheDocument()
    expect(screen.getByText('Anan')).toBeInTheDocument()
    // Somchai's two events render as chips (XD appears for both players).
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
    renderModal({ club: 'BTY', players: 1, members: ['Malee'] })
    expect(screen.getByText('Malee')).toBeInTheDocument()
    expect(screen.getByText(/BTY/)).toBeInTheDocument()
  })
})

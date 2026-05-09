/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import AlertBell from '@/components/AlertBell'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { AlertItem } from '@/lib/alerts'

function renderBell(alerts: AlertItem[], onDismiss = jest.fn()) {
  return render(
    <LanguageProvider>
      <AlertBell alerts={alerts} onDismiss={onDismiss} />
    </LanguageProvider>,
  )
}

const sample: AlertItem[] = [
  { kind: 'tournament', id: 't:A', tournamentId: 'A', tournamentName: 'Alpha', addedAt: '2026-05-09T00:00:00Z' },
  { kind: 'schedule', id: 's:B:2026-05-12', tournamentId: 'B', tournamentName: 'Beta', dateIso: '2026-05-12', addedAt: '2026-05-09T00:00:00Z' },
]

describe('AlertBell', () => {
  it('renders inert when alerts are empty', () => {
    renderBell([])
    const bell = screen.getByRole('button', { name: /Notifications/i })
    expect(bell).toHaveAttribute('aria-disabled', 'true')
    expect(bell.querySelector('.alert-bell-dot')).toBeNull()
    expect(bell.querySelector('.alert-bell-pulse')).toBeNull()
  })

  it('renders dot + pulse when there are alerts and dropdown is closed', () => {
    renderBell(sample)
    const bell = screen.getByRole('button', { name: /Notifications/i })
    expect(bell).not.toHaveAttribute('aria-disabled', 'true')
    expect(bell.querySelector('.alert-bell-dot')).not.toBeNull()
    expect(bell.querySelector('.alert-bell-pulse')).not.toBeNull()
  })

  it('opens the dropdown on click and removes the pulse', () => {
    renderBell(sample)
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }))
    expect(screen.getByRole('dialog', { name: /Notifications/i })).toBeInTheDocument()
    expect(screen.getByText('New tournaments')).toBeInTheDocument()
    expect(screen.getByText('New Schedule Published')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(document.querySelector('.alert-bell-pulse')).toBeNull()
  })

  it('calls onDismiss when an item is clicked', () => {
    const onDismiss = jest.fn()
    renderBell(sample, onDismiss)
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }))
    fireEvent.click(screen.getByText('Alpha'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss on Escape', () => {
    const onDismiss = jest.fn()
    renderBell(sample, onDismiss)
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss on outside click', () => {
    const onDismiss = jest.fn()
    renderBell(sample, onDismiss)
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }))
    fireEvent.mouseDown(document.body)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

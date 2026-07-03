/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import RosterModal, { type RosterRow } from '@/components/RosterModal'
import { LanguageProvider } from '@/lib/LanguageContext'

const rows: RosterRow[] = [
  { name: 'Somchai', playerId: '1', events: ['MS', 'XD'] },
  { name: 'Anan', playerId: '3', events: ['BD U15'] },
  { name: 'Malee', playerId: '2', events: ['WS'] },
]

function renderModal(extra: Partial<React.ComponentProps<typeof RosterModal>> = {}) {
  return render(
    <LanguageProvider>
      <RosterModal open title="KBA" count={rows.length} rows={rows} onClose={() => {}} {...extra} />
    </LanguageProvider>,
  )
}

const visibleNames = () =>
  Array.from(document.querySelectorAll('.country-roster-name')).map((el) => el.textContent?.replace(/\s+/g, ' ').trim())

describe('RosterModal filter', () => {
  it('shows all rows with an empty query', () => {
    renderModal()
    expect(visibleNames()).toEqual(['Somchai', 'Anan', 'Malee'])
  })

  it('filters by player name (case-insensitive)', () => {
    renderModal()
    fireEvent.change(document.querySelector('.roster-filter-input')!, { target: { value: 'mal' } })
    expect(visibleNames()).toEqual(['Malee'])
  })

  it('filters by event code', () => {
    renderModal()
    fireEvent.change(document.querySelector('.roster-filter-input')!, { target: { value: 'u15' } })
    expect(visibleNames()).toEqual(['Anan'])
  })

  it('shows a no-matches message when nothing matches', () => {
    renderModal()
    fireEvent.change(document.querySelector('.roster-filter-input')!, { target: { value: 'zzz' } })
    expect(visibleNames()).toEqual([])
    expect(document.querySelector('.country-roster-empty')?.textContent).toBeTruthy()
  })

  it('renders a per-row name suffix and title when provided', () => {
    renderModal({
      nameSuffix: (r) => (r.playerId === '1' ? <span> (13)</span> : null),
      nameTitle: (r) => (r.playerId === '1' ? '6 Jun 2013' : undefined),
    })
    const somchai = Array.from(document.querySelectorAll('.country-roster-name'))
      .find((el) => el.textContent?.includes('Somchai')) as HTMLElement
    expect(somchai.textContent).toContain('(13)')
    expect(somchai.getAttribute('title')).toBe('6 Jun 2013')
  })

  it('closes on Escape and overlay click', () => {
    const onClose = jest.fn()
    const { container } = renderModal({ onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(container.querySelector('.pm-overlay')!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

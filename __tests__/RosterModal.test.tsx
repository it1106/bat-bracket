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

describe('RosterModal chip status colors', () => {
  const coloredRows: RosterRow[] = [
    { name: 'Gold', playerId: 'g', events: ['MS'], statusByEvent: { MS: 'gold' } },
    { name: 'Silver', playerId: 's', events: ['WS'], statusByEvent: { WS: 'silver' } },
    { name: 'Bronze', playerId: 'b', events: ['XD'], statusByEvent: { XD: 'bronze' } },
    { name: 'Out', playerId: 'o', events: ['MD'], statusByEvent: { MD: 'out' } },
    { name: 'Plain', playerId: 'p', events: ['GD'] },
  ]

  function renderColored() {
    return render(
      <LanguageProvider>
        <RosterModal open title="KBA" count={coloredRows.length} rows={coloredRows} onClose={() => {}} />
      </LanguageProvider>,
    )
  }

  const chipClass = (text: string) =>
    Array.from(document.querySelectorAll('.country-roster-chip'))
      .find((el) => el.textContent === text)?.className ?? ''

  it('applies a per-status class to each chip', () => {
    renderColored()
    expect(chipClass('MS')).toContain('country-roster-chip--gold')
    expect(chipClass('WS')).toContain('country-roster-chip--silver')
    expect(chipClass('XD')).toContain('country-roster-chip--bronze')
    expect(chipClass('MD')).toContain('country-roster-chip--out')
  })

  it('falls back to the neutral "in" status when statusByEvent is missing', () => {
    renderColored()
    const cls = chipClass('GD')
    expect(cls).toContain('country-roster-chip')
    expect(cls).toContain('country-roster-chip--in')
  })

  it('does not render the status color legend', () => {
    renderColored()
    expect(document.querySelector('.roster-legend-swatch')).toBeNull()
  })
})

describe('RosterModal active filter', () => {
  const elimRows: RosterRow[] = [
    { name: 'AllOut', playerId: 'a', events: ['MD'], statusByEvent: { MD: 'out' } },
    { name: 'BothOut', playerId: 'b', events: ['MS', 'WS'], statusByEvent: { MS: 'out', WS: 'out' } },
    { name: 'Mixed', playerId: 'm', events: ['MS', 'WS'], statusByEvent: { MS: 'out', WS: 'gold' } },
    { name: 'NoStatus', playerId: 'n', events: ['GD'] },
    { name: 'StillIn', playerId: 'i', events: ['XD'], statusByEvent: { XD: 'in' } },
  ]

  function renderElim(open = true) {
    return render(
      <LanguageProvider>
        <RosterModal open={open} title="KBA" count={elimRows.length} rows={elimRows} onClose={() => {}} />
      </LanguageProvider>,
    )
  }

  const checkbox = () => screen.getByRole('checkbox', { name: /Active/i }) as HTMLInputElement
  const eliminatedBox = () => screen.getByRole('checkbox', { name: /Eliminated/i }) as HTMLInputElement
  const headerText = () => document.querySelector('.pm-section-title')?.textContent ?? ''

  it('renders an Active checkbox, unchecked by default', () => {
    renderElim()
    expect(checkbox().checked).toBe(false)
    expect(visibleNames()).toEqual(['AllOut', 'BothOut', 'Mixed', 'NoStatus', 'StillIn'])
  })

  it('hides players eliminated in every event when checked', () => {
    renderElim()
    fireEvent.click(checkbox())
    expect(visibleNames()).toEqual(['Mixed', 'NoStatus', 'StillIn'])
  })

  it('shows the total count unchecked and the active count when checked', () => {
    renderElim()
    expect(headerText()).toContain('5') // total roster size
    fireEvent.click(checkbox())
    expect(headerText()).toContain('3') // active players (2 fully eliminated hidden)
  })

  it('keeps the active count independent of the text query', () => {
    renderElim()
    fireEvent.click(checkbox())
    fireEvent.change(document.querySelector('.roster-filter-input')!, { target: { value: 'mixed' } })
    expect(visibleNames()).toEqual(['Mixed'])
    expect(headerText()).toContain('3') // headline still reflects all active players, not the search
  })

  it('keeps players with a non-out event visible', () => {
    renderElim()
    fireEvent.click(checkbox())
    expect(visibleNames()).toContain('Mixed')
  })

  it('keeps players with no status data visible', () => {
    renderElim()
    fireEvent.click(checkbox())
    expect(visibleNames()).toContain('NoStatus')
  })

  it('combines the text query and the active filter (AND)', () => {
    renderElim()
    fireEvent.change(document.querySelector('.roster-filter-input')!, { target: { value: 'ms' } })
    expect(visibleNames()).toEqual(['BothOut', 'Mixed'])
    fireEvent.click(checkbox())
    expect(visibleNames()).toEqual(['Mixed'])
  })

  it('renders an Eliminated checkbox after Active, unchecked by default', () => {
    renderElim()
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    expect(boxes).toHaveLength(2)
    expect(eliminatedBox().checked).toBe(false)
    // Order: Active first, Eliminated second.
    expect(boxes[0]).toBe(checkbox())
    expect(boxes[1]).toBe(eliminatedBox())
  })

  it('shows only fully-eliminated players when Eliminated is checked', () => {
    renderElim()
    fireEvent.click(eliminatedBox())
    expect(visibleNames()).toEqual(['AllOut', 'BothOut'])
    expect(headerText()).toContain('2') // eliminated players
  })

  it('shows everyone when both Active and Eliminated are checked', () => {
    renderElim()
    fireEvent.click(checkbox())
    fireEvent.click(eliminatedBox())
    expect(visibleNames()).toEqual(['AllOut', 'BothOut', 'Mixed', 'NoStatus', 'StillIn'])
    expect(headerText()).toContain('5')
  })

  it('resets the checkbox to off when the modal is reopened', () => {
    const { rerender } = renderElim(true)
    fireEvent.click(checkbox())
    expect(checkbox().checked).toBe(true)
    const remount = (open: boolean) =>
      rerender(
        <LanguageProvider>
          <RosterModal open={open} title="KBA" count={elimRows.length} rows={elimRows} onClose={() => {}} />
        </LanguageProvider>,
      )
    remount(false)
    remount(true)
    expect(checkbox().checked).toBe(false)
  })
})

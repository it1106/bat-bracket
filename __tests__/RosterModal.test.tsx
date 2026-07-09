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

describe('RosterModal status filters', () => {
  // Playing: still in.  Champ: event over, medaled.  Out: event over, no medal.
  // StillMedal: won one event, still playing another.  NoData: no status ⇒ still in.
  const statusRows: RosterRow[] = [
    { name: 'Playing', playerId: 'p', events: ['MS'], statusByEvent: { MS: 'in' } },
    { name: 'Champ', playerId: 'c', events: ['MS'], statusByEvent: { MS: 'gold' } },
    { name: 'Out', playerId: 'o', events: ['WS'], statusByEvent: { WS: 'out' } },
    { name: 'StillMedal', playerId: 's', events: ['MS', 'MD'], statusByEvent: { MS: 'gold', MD: 'in' } },
    { name: 'NoData', playerId: 'n', events: ['GD'] },
  ]

  function renderStatus(open = true) {
    return render(
      <LanguageProvider>
        <RosterModal open={open} title="KBA" count={statusRows.length} rows={statusRows} onClose={() => {}} />
      </LanguageProvider>,
    )
  }

  const activeBox = () => screen.getByRole('checkbox', { name: /Active/i }) as HTMLInputElement
  const endedBox = () => screen.getByRole('checkbox', { name: /Ended/i }) as HTMLInputElement
  const medaledBox = () => screen.getByRole('checkbox', { name: /Medaled/i }) as HTMLInputElement
  const headerText = () => document.querySelector('.pm-section-title')?.textContent ?? ''

  it('renders Active, Ended, Medaled checkboxes in order, unchecked by default', () => {
    renderStatus()
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    expect(boxes).toHaveLength(3)
    expect(boxes.map((b) => b.checked)).toEqual([false, false, false])
    expect(boxes[0]).toBe(activeBox())
    expect(boxes[1]).toBe(endedBox())
    expect(boxes[2]).toBe(medaledBox())
    expect(visibleNames()).toEqual(['Playing', 'Champ', 'Out', 'StillMedal', 'NoData'])
    expect(headerText()).toContain('5')
  })

  it('Active shows players with an ongoing event (medalists still playing count, finished ones do not)', () => {
    renderStatus()
    fireEvent.click(activeBox())
    expect(visibleNames()).toEqual(['Playing', 'StillMedal', 'NoData'])
    expect(headerText()).toContain('3')
  })

  it('Ended shows players whose events are all concluded (eliminated and finished medalists)', () => {
    renderStatus()
    fireEvent.click(endedBox())
    expect(visibleNames()).toEqual(['Champ', 'Out'])
    expect(headerText()).toContain('2')
  })

  it('Medaled shows only players who won a medal, even if still playing', () => {
    renderStatus()
    fireEvent.click(medaledBox())
    expect(visibleNames()).toEqual(['Champ', 'StillMedal'])
    expect(headerText()).toContain('2')
  })

  it('unions the checked categories', () => {
    renderStatus()
    fireEvent.click(activeBox())
    fireEvent.click(medaledBox())
    // active ∪ medaled = {Playing, StillMedal, NoData} ∪ {Champ, StillMedal}
    expect(visibleNames()).toEqual(['Playing', 'Champ', 'StillMedal', 'NoData'])
    expect(headerText()).toContain('4')
  })

  it('keeps the category count independent of the text query', () => {
    renderStatus()
    fireEvent.click(activeBox())
    fireEvent.change(document.querySelector('.roster-filter-input')!, { target: { value: 'playing' } })
    expect(visibleNames()).toEqual(['Playing'])
    expect(headerText()).toContain('3') // headline still reflects all active players, not the search
  })

  it('resets the checkboxes to off when the modal is reopened', () => {
    const { rerender } = renderStatus(true)
    fireEvent.click(activeBox())
    fireEvent.click(medaledBox())
    expect(activeBox().checked).toBe(true)
    const remount = (open: boolean) =>
      rerender(
        <LanguageProvider>
          <RosterModal open={open} title="KBA" count={statusRows.length} rows={statusRows} onClose={() => {}} />
        </LanguageProvider>,
      )
    remount(false)
    remount(true)
    expect(activeBox().checked).toBe(false)
    expect(medaledBox().checked).toBe(false)
  })
})

describe('RosterModal chip match tooltip', () => {
  const rows: RosterRow[] = [
    {
      name: 'P', playerId: '1', events: ['MS', 'XD', 'WS'],
      statusByEvent: { MS: 'out', XD: 'gold', WS: 'in' },
      results: [
        { event: 'MS', round: 'Final', won: false, opponent: ['A. Lee'], scores: [{ t1: 19, t2: 21 }, { t1: 21, t2: 17 }, { t1: 18, t2: 21 }] },
        { event: 'MS', round: 'Semi Final', won: true, opponent: ['B. Chan'], scores: [{ t1: 21, t2: 14 }, { t1: 21, t2: 16 }] },
        { event: 'XD', round: 'Final', won: true, opponent: ['C', 'D'], scores: [{ t1: 21, t2: 10 }, { t1: 21, t2: 9 }], retired: true },
      ],
    },
  ]

  function renderTip() {
    return render(
      <LanguageProvider>
        <RosterModal open title="KBA" count={1} rows={rows} onClose={() => {}} />
      </LanguageProvider>,
    )
  }

  const wrapFor = (label: string) =>
    Array.from(document.querySelectorAll('.country-roster-chip-wrap')).find(
      (w) => w.querySelector('.country-roster-chip')?.textContent === label,
    )

  it('lists that event\'s matches newest-first with round/W-L/opponent/score', () => {
    renderTip()
    const tipRows = wrapFor('MS')!.querySelectorAll('.country-roster-chip-tip-row')
    expect(tipRows).toHaveLength(2)
    expect(tipRows[0].querySelector('.ct-round')!.textContent).toBe('F')
    expect(tipRows[0].querySelector('.ct-wl')!.textContent).toBe('L')
    expect(tipRows[0].querySelector('.ct-opp')!.textContent).toContain('A. Lee')
    expect(tipRows[0].querySelector('.ct-score')!.textContent).toBe('19-21 21-17 18-21')
    expect(tipRows[1].querySelector('.ct-round')!.textContent).toBe('SF')
    expect(tipRows[1].querySelector('.ct-wl')!.textContent).toBe('W')
  })

  it('marks retired matches and joins doubles opponents', () => {
    renderTip()
    const row = wrapFor('XD')!.querySelector('.country-roster-chip-tip-row')!
    expect(row.querySelector('.ct-opp')!.textContent).toContain('C / D')
    expect(row.querySelector('.ct-score')!.textContent).toContain('(ret.)')
  })

  it('renders no tooltip for an event with no results', () => {
    renderTip()
    expect(wrapFor('WS')!.querySelector('.country-roster-chip-tip')).toBeNull()
  })
})

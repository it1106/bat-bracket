/**
 * @jest-environment jsdom
 */
import { render, screen, within, fireEvent } from '@testing-library/react'
import CountryMatrixTable from '@/components/CountryMatrixTable'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { StatsCountryMatrix } from '@/lib/types'

const matrix: StatsCountryMatrix = {
  countries: ['THA', 'MAS', 'INA'],
  cells: {
    THA: { MAS: { w: 3, l: 1 }, INA: { w: 1, l: 1 } },
    MAS: { THA: { w: 1, l: 3 } },
    INA: { THA: { w: 1, l: 1 } },
  },
}

function renderTable(m: StatsCountryMatrix = matrix) {
  return render(
    <LanguageProvider>
      <CountryMatrixTable matrix={m} />
    </LanguageProvider>,
  )
}

describe('CountryMatrixTable', () => {
  it('renders a column and row header per country', () => {
    const { container } = renderTable()
    const cols = Array.from(container.querySelectorAll('.stats-matrix-col')).map((e) => e.textContent)
    expect(cols).toEqual(['THA', 'MAS', 'INA'])
    const rows = Array.from(container.querySelectorAll('.stats-matrix-row')).map((e) => e.textContent)
    expect(rows).toEqual(['THA', 'MAS', 'INA'])
  })

  it('shows the row country win–loss and win% in a populated cell', () => {
    const { container } = renderTable()
    const thaRow = container.querySelectorAll('tbody tr')[0]
    const thaVsMas = thaRow.querySelectorAll('.stats-matrix-cell')[1] as HTMLElement // 0=diag THA, 1=MAS
    expect(within(thaVsMas).getByText('3–1')).toBeInTheDocument()
    expect(within(thaVsMas).getByText('75%')).toBeInTheDocument()
    expect(thaVsMas).toHaveClass('is-win')
  })

  it('shades the diagonal and leaves it empty', () => {
    const { container } = renderTable()
    const diag = container.querySelector('.stats-matrix-diag')!
    expect(diag.textContent).toBe('')
  })

  it('adds an Overall column with each country aggregate record and win%', () => {
    const { container } = renderTable()
    // Header carries the Overall label.
    expect(container.querySelector('.stats-matrix-total-col')?.textContent).toBe('Overall')
    // THA overall = 4–2 (67%), the last cell of the THA row.
    const thaRow = container.querySelectorAll('tbody tr')[0]
    const total = thaRow.querySelector('.stats-matrix-total') as HTMLElement
    expect(within(total).getByText('4–2')).toBeInTheDocument()
    expect(within(total).getByText('67%')).toBeInTheDocument()
    // MAS overall = 1–3 (25%).
    const masRow = container.querySelectorAll('tbody tr')[1]
    const masTotal = masRow.querySelector('.stats-matrix-total') as HTMLElement
    expect(within(masTotal).getByText('1–3')).toBeInTheDocument()
    expect(within(masTotal).getByText('25%')).toBeInTheDocument()
  })

  it('renders no dropdowns when the matrix has no buckets', () => {
    const { container } = renderTable()
    expect(container.querySelector('.stats-matrix-agesel')).toBeNull()
  })

  it('cells are not clickable when the blob carries no per-match list', () => {
    const { container } = renderTable()
    expect(container.querySelector('.stats-matrix-clickable')).toBeNull()
  })
})

describe('CountryMatrixTable — cell modal', () => {
  const withMatches: StatsCountryMatrix = {
    countries: ['THA', 'INA'],
    cells: { THA: { INA: { w: 1, l: 1 } }, INA: { THA: { w: 1, l: 1 } } },
    matches: [
      { country1: 'THA', country2: 'INA', team1: ['Somchai'], team2: ['Budi'], winnerSide: 1, scores: [{ t1: 21, t2: 17 }, { t1: 21, t2: 13 }], draw: 'BS U17', round: 'R16', ageGroup: 'U17', gender: 'male', discipline: 'singles' },
      { country1: 'INA', country2: 'THA', team1: ['Sri'], team2: ['Nan'], winnerSide: 1, scores: [{ t1: 21, t2: 10 }, { t1: 21, t2: 8 }], draw: 'WS U19', round: 'QF', ageGroup: 'U19', gender: 'female', discipline: 'singles' },
    ],
  }

  it('opens a modal listing the score lines when a cell is clicked', () => {
    const { container } = renderTable(withMatches)
    const thaRow = container.querySelectorAll('tbody tr')[0]
    const thaVsIna = thaRow.querySelector('.stats-matrix-clickable') as HTMLElement
    expect(thaVsIna).toBeTruthy()
    fireEvent.click(thaVsIna)
    // Modal shows both THA↔INA matches, oriented THA-first.
    expect(screen.getByText('Somchai')).toBeInTheDocument()
    expect(screen.getByText('Budi')).toBeInTheDocument()
    expect(screen.getByText('Sri')).toBeInTheDocument()
    // Header summarizes THA's record vs INA (1–1).
    expect(container.querySelector('.cmx-modal-sub')?.textContent).toBe('1–1')
  })

  it('closes the modal on the close button', () => {
    const { container } = renderTable(withMatches)
    fireEvent.click(container.querySelector('.stats-matrix-clickable') as HTMLElement)
    expect(screen.getByText('Somchai')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Close'))
    expect(screen.queryByText('Somchai')).toBeNull()
  })
})

describe('CountryMatrixTable — age + gender + event dropdowns', () => {
  // Buckets: U19 male singles (THA 4–0 INA), U17 female doubles (INA 3–0 THA),
  // U19 mixed/genderless (INA 2–0 THA).
  const withBuckets: StatsCountryMatrix = {
    countries: ['THA', 'INA'],
    cells: { THA: { INA: { w: 4, l: 5 } }, INA: { THA: { w: 5, l: 4 } } },
    buckets: [
      { ageGroup: 'U19', gender: 'male', event: 'singles', countries: ['THA', 'INA'], cells: { THA: { INA: { w: 4, l: 0 } }, INA: { THA: { w: 0, l: 4 } } } },
      { ageGroup: 'U19', event: 'mixed', countries: ['INA', 'THA'], cells: { INA: { THA: { w: 2, l: 0 } }, THA: { INA: { w: 0, l: 2 } } } },
      { ageGroup: 'U17', gender: 'female', event: 'doubles', countries: ['INA', 'THA'], cells: { INA: { THA: { w: 3, l: 0 } }, THA: { INA: { w: 0, l: 3 } } } },
    ],
  }

  // The first real opponent cell of a country's row (skipping the shaded
  // diagonal and the trailing Overall total), located by row header so the
  // tie-broken axis order can't flip which index is the diagonal.
  const firstCellOfRow = (container: HTMLElement, country: string) => {
    const row = Array.from(container.querySelectorAll('tbody tr')).find(
      (tr) => tr.querySelector('.stats-matrix-row')?.textContent === country,
    )!
    return row.querySelector('.stats-matrix-cell:not(.stats-matrix-diag):not(.stats-matrix-total)') as HTMLElement
  }

  it('defaults to the all aggregate', () => {
    const { container } = renderTable(withBuckets)
    // THA row, first opponent cell = THA vs INA = 4–5.
    expect(within(firstCellOfRow(container, 'THA')).getByText('4–5')).toBeInTheDocument()
  })

  it('offers age, gender (male/female only), and event (singles/doubles/mixed) dropdowns', () => {
    renderTable(withBuckets)
    const [ageSel, genderSel, eventSel] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    expect(Array.from(ageSel.options).map((o) => o.value)).toEqual(['all', 'U19', 'U17'])
    expect(Array.from(genderSel.options).map((o) => o.value)).toEqual(['all', 'male', 'female'])
    expect(Array.from(eventSel.options).map((o) => o.value)).toEqual(['all', 'singles', 'doubles', 'mixed'])
  })

  it('filters by age alone', () => {
    const { container } = renderTable(withBuckets)
    const [ageSel] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(ageSel, { target: { value: 'U17' } })
    // U17 has only the female doubles bucket: INA beat THA 3–0.
    expect(within(firstCellOfRow(container, 'INA')).getByText('3–0')).toBeInTheDocument()
  })

  it('filters by gender alone, excluding genderless mixed', () => {
    const { container } = renderTable(withBuckets)
    const [, genderSel] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(genderSel, { target: { value: 'male' } })
    // Only the U19 male singles bucket (mixed is excluded): THA beat INA 4–0.
    expect(within(firstCellOfRow(container, 'THA')).getByText('4–0')).toBeInTheDocument()
  })

  it('filters by event=mixed (the genderless XD bucket)', () => {
    const { container } = renderTable(withBuckets)
    const [, , eventSel] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(eventSel, { target: { value: 'mixed' } })
    // U19 mixed: INA beat THA 2–0.
    expect(within(firstCellOfRow(container, 'INA')).getByText('2–0')).toBeInTheDocument()
  })

  it('gender=Male + event=Mixed yields no data (male mixed does not exist)', () => {
    const { container } = renderTable(withBuckets)
    const [, genderSel, eventSel] = screen.getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(genderSel, { target: { value: 'male' } })
    fireEvent.change(eventSel, { target: { value: 'mixed' } })
    expect(container.querySelector('.stats-matrix')).toBeNull()
    expect(screen.getByText('No country head-to-head data for this tournament.')).toBeInTheDocument()
  })
})

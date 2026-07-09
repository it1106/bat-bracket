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

  it('renders no age dropdown when the matrix has no age groups', () => {
    const { container } = renderTable()
    expect(container.querySelector('.stats-matrix-agesel')).toBeNull()
  })
})

describe('CountryMatrixTable — age-group dropdown', () => {
  const withAges: StatsCountryMatrix = {
    countries: ['THA', 'INA'],
    cells: { THA: { INA: { w: 5, l: 5 } }, INA: { THA: { w: 5, l: 5 } } },
    ageGroups: [
      { ageGroup: 'U19', countries: ['THA', 'INA'], cells: { THA: { INA: { w: 4, l: 0 } }, INA: { THA: { w: 0, l: 4 } } } },
      { ageGroup: 'U17', countries: ['INA', 'THA'], cells: { INA: { THA: { w: 3, l: 0 } }, THA: { INA: { w: 0, l: 3 } } } },
    ],
  }

  it('defaults to the all-ages aggregate', () => {
    const { container } = renderTable(withAges)
    const thaVsIna = container.querySelectorAll('tbody tr')[0].querySelectorAll('.stats-matrix-cell')[1] as HTMLElement
    expect(within(thaVsIna).getByText('5–5')).toBeInTheDocument()
  })

  it('offers an option per age group plus all-ages', () => {
    renderTable(withAges)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    const opts = Array.from(select.options).map((o) => o.value)
    expect(opts).toEqual(['all', 'U19', 'U17'])
  })

  it('swaps the grid to the selected age group', () => {
    const { container } = renderTable(withAges)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'U19' } })
    // U19: THA beat INA 4–0.
    const thaVsIna = container.querySelectorAll('tbody tr')[0].querySelectorAll('.stats-matrix-cell')[1] as HTMLElement
    expect(within(thaVsIna).getByText('4–0')).toBeInTheDocument()
  })
})

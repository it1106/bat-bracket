/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, within } from '@testing-library/react'
import { LanguageProvider } from '@/lib/LanguageContext'
import EventBreakdownTable from '@/components/EventBreakdownTable'
import type { StatsEventBreakdown } from '@/lib/types'

const data: StatsEventBreakdown = {
  events: [{ key: 'MS', label: 'MS' }, { key: 'WS', label: 'WS' }, { key: 'XD U17', label: 'XD U17' }],
  columns: ['SF', 'F', 'Champion'],
  columnsByEvent: { MS: ['SF', 'F', 'Champion'], WS: ['SF', 'F'], 'XD U17': ['SF'] },
  counts: {
    MS: {
      THA: {
        Champion: { done: 1, active: 0, teams: [{ names: ['Somchai', 'Anan'], event: 'MS', active: false }] },
        SF: { done: 1, active: 0, teams: [{ names: ['Chai'], event: 'MS', active: false }] },
      },
      INA: { F: { done: 1, active: 0, teams: [{ names: ['Budi'], event: 'MS', active: false }] } },
    },
    WS: {
      THA: { F: { done: 0, active: 1, teams: [{ names: ['Nari'], event: 'WS', active: true }] } }, // active (green)
    },
    'XD U17': {
      KOR: { SF: { done: 1, active: 0, teams: [{ names: ['Mixy', 'Paira'], event: 'XD U17', active: false }] } },
    },
  },
}

const renderIt = () =>
  render(
    <LanguageProvider>
      <EventBreakdownTable data={data} />
    </LanguageProvider>,
  )

describe('EventBreakdownTable', () => {
  it('aggregates All: THA totals across events, sorted by total', () => {
    renderIt()
    const rows = screen.getAllByRole('row')
    // Header + THA + INA. THA total = Champion1 + SF1 + F(active)1 = 3; INA = 1.
    // Country label is the display name, e.g. "Thailand (THA)" — match by code.
    const tha = rows.find((r) => within(r).queryByText(/THA/))!
    expect(within(tha).getByText('3')).toBeInTheDocument() // Total column
  })

  it('renders active counts with the green class', () => {
    const { container } = renderIt()
    expect(container.querySelector('.stats-eb-active')).toHaveTextContent('1')
  })

  it('filters columns when a single event is selected', () => {
    renderIt()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'WS' } })
    // WS has no Champion column.
    expect(screen.queryByText('Champion')).not.toBeInTheDocument()
  })

  it('renders per-team names + event in the hover tooltip', () => {
    renderIt()
    // Tooltip DOM is always present (shown via CSS on hover); a doubles pair
    // joins with " / " and carries its event label.
    expect(screen.getByText('Somchai / Anan')).toBeInTheDocument()
    const active = screen.getByText('Nari')
    expect(active).toHaveClass('stats-eb-active') // still-in team is green
  })

  it('shows each cell as a percentage of the country total on a 2nd line', () => {
    renderIt()
    // INA has a single team (F), so its one cell is 100% of INA's total.
    const ina = screen.getAllByRole('row').find((r) => within(r).queryByText(/INA/))!
    const p = within(ina).getByText('100%')
    expect(p).toHaveClass('stats-eb-pct')
  })

  it('male filter aggregates only B*/M* events and excludes mixed (XD)', () => {
    renderIt()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'male' } })
    // MS is the only male event: INA (MS) stays; WS's Nari and XD's KOR team go.
    expect(screen.getByText('Budi')).toBeInTheDocument()
    expect(screen.queryByText('Nari')).not.toBeInTheDocument()
    expect(screen.queryByText('Mixy / Paira')).not.toBeInTheDocument()
  })

  it('female filter excludes mixed (XD) too', () => {
    renderIt()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'female' } })
    // WS is the only female event; the mixed XD team must not appear.
    expect(screen.getByText('Nari')).toBeInTheDocument()
    expect(screen.queryByText('Mixy / Paira')).not.toBeInTheDocument()
    expect(screen.queryByText('Champion')).not.toBeInTheDocument() // WS has no champion
  })
})

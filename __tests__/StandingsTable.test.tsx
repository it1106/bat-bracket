/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import StandingsTable from '../components/StandingsTable'
import type { StandingsRow } from '../lib/types'

const rows: StandingsRow[] = [
  { position: 1, players: [{ name: 'Alice', playerId: '11' }], club: 'Club A', played: 2, won: 2, drawn: 0, lost: 0, matches: '4-0', games: '42-20', points: '2-0', pts: 4 },
  { position: 2, players: [{ name: 'Bob', playerId: '22' }], played: 2, won: 1, drawn: 0, lost: 1, matches: '2-2', games: '30-30', points: '1-1', pts: 2 },
  { position: 3, players: [{ name: 'Carol', playerId: '33' }], played: 2, won: 0, drawn: 0, lost: 2, matches: '0-4', games: '20-42', points: '0-2', pts: 0 },
]

describe('StandingsTable', () => {
  it('renders all rows with player names', () => {
    render(<StandingsTable rows={rows} qualifierCount={1} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Carol')).toBeInTheDocument()
  })

  it('marks top N rows as advancing', () => {
    const { container } = render(<StandingsTable rows={rows} qualifierCount={2} />)
    const advancing = container.querySelectorAll('tr.advances')
    expect(advancing).toHaveLength(2)
  })

  it('renders W-L column', () => {
    render(<StandingsTable rows={rows} qualifierCount={1} />)
    expect(screen.getByText('2-0')).toBeInTheDocument()
    expect(screen.getByText('1-1')).toBeInTheDocument()
  })

  it('renders dash for position when zero played', () => {
    const zeroRows: StandingsRow[] = [{ ...rows[0], played: 0, won: 0, lost: 0, pts: 0 }]
    render(<StandingsTable rows={zeroRows} qualifierCount={1} />)
    const posCell = screen.getByText('—')
    expect(posCell).toBeInTheDocument()
  })

  it('exposes data-player-id on player spans for highlight', () => {
    const { container } = render(<StandingsTable rows={rows} qualifierCount={1} />)
    expect(container.querySelector('[data-player-id="11"]')).not.toBeNull()
    expect(container.querySelector('[data-player-id="22"]')).not.toBeNull()
  })
})

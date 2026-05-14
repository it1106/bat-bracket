/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import GroupCard from '../components/GroupCard'
import type { GroupData } from '../lib/types'

const group: GroupData = {
  drawNum: '1',
  groupLetter: 'A',
  standings: [
    { position: 1, players: [{ name: 'Alice', playerId: '11' }], played: 1, won: 1, drawn: 0, lost: 0, matches: '2-0', games: '21-15', points: '1-0', pts: 2 },
    { position: 2, players: [{ name: 'Bob', playerId: '22' }], played: 1, won: 0, drawn: 0, lost: 1, matches: '0-2', games: '15-21', points: '0-1', pts: 0 },
  ],
  matches: [
    { draw: 'X - Group A', drawNum: '', round: 'Round 1', team1: [{ name: 'Alice', playerId: '11' }], team2: [{ name: 'Bob', playerId: '22' }], winner: 1, scores: [{ t1: 21, t2: 15 }], court: '', walkover: false, retired: false, nowPlaying: false },
    { draw: 'X - Group A', drawNum: '', round: 'Round 2', team1: [{ name: 'Alice', playerId: '11' }], team2: [{ name: 'Carol', playerId: '33' }], winner: null, scores: [], court: '', walkover: false, retired: false, nowPlaying: false },
  ],
}

describe('GroupCard', () => {
  it('renders group title and standings', () => {
    render(<GroupCard group={group} qualifierCount={1} />)
    expect(screen.getByText('Group A')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('hides matches by default', () => {
    render(<GroupCard group={group} qualifierCount={1} />)
    expect(screen.queryByText('Round 1')).not.toBeInTheDocument()
  })

  it('shows matches when expand button clicked', () => {
    render(<GroupCard group={group} qualifierCount={1} />)
    fireEvent.click(screen.getByRole('button', { name: /show matches/i }))
    expect(screen.getByText('Round 1')).toBeInTheDocument()
    expect(screen.getByText('Round 2')).toBeInTheDocument()
  })

  it('summary chip shows played / total', () => {
    render(<GroupCard group={group} qualifierCount={1} />)
    expect(screen.getByText(/1 \/ 2 played/i)).toBeInTheDocument()
  })
})

/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import PlayerModal from '@/components/PlayerModal'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { DrawInfo, MatchEntry, PlayerProfile } from '@/lib/types'

const match = (drawNum: string, draw: string): MatchEntry => ({
  draw, drawNum, round: 'QF',
  team1: [{ name: 'Anan Dee', playerId: '1' }], team2: [{ name: 'Beam Kla', playerId: '2' }],
  winner: null, scores: [], court: '', walkover: false, retired: false, nowPlaying: false,
})

const profile = (matches: MatchEntry[]): PlayerProfile =>
  ({ playerId: '1', name: 'Anan Dee', club: '', yob: '', events: [], matches })

const DRAWS: DrawInfo[] = [
  { drawNum: '1', name: 'BS U15', size: '32', type: 'Elimination' },
  { drawNum: '2', name: 'BD U15', size: '16', type: 'Elimination' },
  { drawNum: '3', name: 'XD U15 - Group A', size: '4', type: 'Round Robin', groupLetter: 'A' },
]

function renderModal(extra: Partial<React.ComponentProps<typeof PlayerModal>>) {
  return render(
    <LanguageProvider>
      <PlayerModal profile={null} loading={false} onClose={() => {}} provider="bat" {...extra} />
    </LanguageProvider>,
  )
}

const buttons = () => Array.from(document.querySelectorAll('.ptf-open')).map((b) => b.textContent)

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ exists: false }) }) as unknown as typeof fetch
})

describe('PlayerModal path-to-final button', () => {
  it('shows one unlabelled button for a player in one knockout draw', () => {
    renderModal({ profile: profile([match('1', 'BS U15')]), draws: DRAWS, onPathClick: () => {} })
    expect(buttons()).toEqual(['Path to final'])
  })

  it('labels each button with its draw when there is more than one', () => {
    renderModal({ profile: profile([match('1', 'BS U15'), match('2', 'BD U15')]), draws: DRAWS, onPathClick: () => {} })
    expect(buttons()).toEqual(['Path to final · BS U15', 'Path to final · BD U15'])
  })

  it('passes the draw to the handler', () => {
    const onPathClick = jest.fn()
    renderModal({ profile: profile([match('1', 'BS U15'), match('2', 'BD U15')]), draws: DRAWS, onPathClick })
    fireEvent.click(screen.getByText('Path to final · BD U15'))
    expect(onPathClick).toHaveBeenCalledWith('2', 'BD U15')
  })

  it('shows no button for a group draw', () => {
    renderModal({ profile: profile([match('3', 'XD U15 - Group A')]), draws: DRAWS, onPathClick: () => {} })
    expect(buttons()).toEqual([])
  })

  it('shows no button for a BWF tournament', () => {
    renderModal({ profile: profile([match('1', 'BS U15')]), draws: DRAWS, onPathClick: () => {}, provider: 'bwf' })
    expect(buttons()).toEqual([])
  })

  it('shows no button without a handler or a draw list', () => {
    const first = renderModal({ profile: profile([match('1', 'BS U15')]), draws: DRAWS })
    expect(buttons()).toEqual([])
    first.unmount()
    renderModal({ profile: profile([match('1', 'BS U15')]), onPathClick: () => {} })
    expect(buttons()).toEqual([])
  })

  it('shows no button for a player with no matches yet', () => {
    renderModal({ profile: profile([]), draws: DRAWS, onPathClick: () => {} })
    expect(buttons()).toEqual([])
  })
})

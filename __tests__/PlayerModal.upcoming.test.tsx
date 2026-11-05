/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import PlayerModal from '@/components/PlayerModal'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { MatchEntry, PlayerProfile } from '@/lib/types'

const base: MatchEntry = {
  draw: 'MS U17', drawNum: '16', round: 'R16',
  team1: [{ name: 'Hang Marcus', playerId: '1' }],
  team2: [{ name: 'Chern Jonas', playerId: '2' }],
  winner: null, scores: [], court: '', walkover: false, retired: false, nowPlaying: false,
}

const profile = (m: Partial<MatchEntry>): PlayerProfile =>
  ({ playerId: '1', name: 'Hang Marcus', club: '', yob: '', events: [], matches: [{ ...base, ...m }] })

function renderModal(p: PlayerProfile) {
  return render(
    <LanguageProvider>
      <PlayerModal profile={p} loading={false} onClose={() => {}} provider="bwf" />
    </LanguageProvider>,
  )
}

// Desktop and mobile layouts are both in the DOM (CSS picks one), so each
// piece appears twice. Count the rendered text rather than assert a single one.
const texts = (sel: string) => Array.from(document.querySelectorAll(sel)).map((e) => e.textContent)

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ exists: false }) }) as unknown as typeof fetch
})

describe('PlayerModal, a match still to be played', () => {
  it('shows the start time as a day and time, not a raw timestamp', () => {
    renderModal(profile({ scheduledTime: '2026-11-05 12:00:00' }))
    expect(screen.queryByText(/2026-11-05 12:00:00/)).toBeNull()
    expect(screen.getAllByText(/05\/11\/26 12:00/).length).toBeGreaterThan(0)
  })

  it('shows the court and the match number', () => {
    renderModal(profile({ scheduledTime: '2026-11-05 12:00:00', court: 'Court 2', sequenceLabel: '6. Followed by' }))
    expect(texts('.pm-match-court')).toContain('Court 2')
    expect(texts('.pm-match-oop')).toContain('M6')
  })

  it('shows neither when the order of play says the court is TBA', () => {
    renderModal(profile({ scheduledTime: '2026-11-05 16:00:00', court: 'Court 3', sequenceLabel: '15. Court and time TBA' }))
    expect(texts('.pm-match-court')).toEqual([])
    expect(texts('.pm-match-oop')).toEqual([])
  })

  it('leaves a played match showing its score, with no court', () => {
    renderModal(profile({
      winner: 1, court: 'Court 2', sequenceLabel: '6. Followed by', duration: '38 mins',
      scores: [{ t1: 21, t2: 14 }, { t1: 21, t2: 11 }],
    }))
    expect(texts('.pm-match-court')).toEqual([])
    expect(texts('.pm-match-oop')).toEqual([])
    expect(screen.getAllByText('21–14, 21–11').length).toBeGreaterThan(0)
  })
})

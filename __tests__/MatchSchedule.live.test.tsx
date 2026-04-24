/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import MatchSchedule from '@/components/MatchSchedule'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { MatchScheduleGroup, MatchEntry } from '@/lib/types'
import type { CourtLive } from '@/lib/live-score'

function entry(over: Partial<MatchEntry> = {}): MatchEntry {
  return {
    draw: 'WS', drawNum: '1', round: 'QF',
    team1: [{ name: 'Alpha', playerId: '100' }],
    team2: [{ name: 'Beta', playerId: '200' }],
    winner: null, scores: [{ t1: 21, t2: 15 }],
    court: 'Court - 3', walkover: false, retired: false,
    nowPlaying: true,
    ...over,
  }
}

const group = (m: MatchEntry): MatchScheduleGroup => ({ type: 'time', time: '10:00', matches: [m] })

const live = (over: Partial<CourtLive> = {}): CourtLive => ({
  courtKey: '3', matchId: 42, playerIds: ['100', '200'],
  setScores: [{ t1: 21, t2: 15, winner: 1 }],
  current: { gameNo: 2, setNo: 1, t1: 11, t2: 9 },
  serving: 0, winner: 0,
  team1Points: 0, team2Points: 0, durationSec: 0,
  ...over,
})

function renderWith(m: MatchEntry, liveByCourt?: Map<string, CourtLive>) {
  return render(
    <LanguageProvider>
      <MatchSchedule
        groups={[group(m)]}
        days={[]} selectedDay="" onDayChange={() => {}}
        loading={false} playerQuery=""
        liveByCourt={liveByCourt}
      />
    </LanguageProvider>,
  )
}

describe('MatchSchedule — live overlay', () => {
  it('renders LIVE badge and set-live span when a live record matches', () => {
    renderWith(entry(), new Map([['3', live()]]))
    expect(screen.getAllByText('LIVE')[0]).toHaveClass('ms-live-badge')
    const liveSet = screen.getByText('11-9')
    expect(liveSet).toHaveClass('set-live')
  })

  it('suppresses the green ms-now-playing pulse when a live record matches', () => {
    const { container } = renderWith(entry(), new Map([['3', live()]]))
    expect(container.querySelector('.ms-now-playing')).toBeNull()
  })

  it('keeps the green pulse when no live record matches', () => {
    const { container } = renderWith(entry(), new Map())
    expect(container.querySelector('.ms-now-playing')).not.toBeNull()
    expect(screen.queryByText('LIVE')).toBeNull()
  })

  it('shows LIVE badge but no set-live span between games (current=null)', () => {
    renderWith(entry(), new Map([['3', live({ current: null })]]))
    expect(screen.getAllByText('LIVE').length).toBeGreaterThan(0)
    expect(document.querySelector('.set-live')).toBeNull()
  })

  it('does not render LIVE when the match is nowPlaying but player IDs do not overlap', () => {
    const unrelated = live({ playerIds: ['555'] })
    renderWith(entry(), new Map([['3', unrelated]]))
    expect(screen.queryByText('LIVE')).toBeNull()
  })
})

/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react'
import MatchSchedule from '@/components/MatchSchedule'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { MatchScheduleGroup, MatchEntry } from '@/lib/types'

function entry(): MatchEntry {
  return {
    draw: 'WS', drawNum: '1', round: 'QF',
    team1: [{ name: 'Alpha', playerId: '100' }],
    team2: [{ name: 'Beta', playerId: '200' }],
    winner: null, scores: [],
    court: '', walkover: false, retired: false,
    nowPlaying: false,
  }
}

const group = (m: MatchEntry): MatchScheduleGroup => ({ type: 'time', time: '10:00', matches: [m] })

describe('MatchSchedule — highlightMatches prop', () => {
  it('applies ms-player-highlight when highlightMatches is unset (default true) and query matches', () => {
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={[group(entry())]}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery="alpha"
        />
      </LanguageProvider>,
    )
    expect(container.querySelector('.ms-player-highlight')).not.toBeNull()
  })

  it('suppresses ms-player-highlight when highlightMatches={false} even with a matching query', () => {
    const { container } = render(
      <LanguageProvider>
        <MatchSchedule
          groups={[group(entry())]}
          days={[]} selectedDay="" onDayChange={() => {}}
          loading={false} playerQuery="alpha"
          highlightMatches={false}
        />
      </LanguageProvider>,
    )
    expect(container.querySelector('.ms-player-highlight')).toBeNull()
  })
})

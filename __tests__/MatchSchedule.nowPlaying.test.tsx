/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react'
import MatchSchedule from '@/components/MatchSchedule'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { MatchScheduleGroup, MatchEntry } from '@/lib/types'

function entry(nowPlaying: boolean): MatchEntry {
  return {
    draw: 'WS', drawNum: '1', round: 'QF',
    team1: [{ name: 'Alpha', playerId: '100' }],
    team2: [{ name: 'Beta', playerId: '200' }],
    winner: null, scores: [],
    court: '', walkover: false, retired: false,
    nowPlaying,
  }
}

function renderSchedule(m: MatchEntry) {
  const groups: MatchScheduleGroup[] = [{ type: 'time', time: '10:00', matches: [m] }]
  return render(
    <LanguageProvider>
      <MatchSchedule
        groups={groups}
        days={[]} selectedDay="" onDayChange={() => {}}
        loading={false} playerQuery=""
      />
    </LanguageProvider>,
  )
}

describe('MatchSchedule — now playing', () => {
  it('follows the green LED with a "Now Playing" pill', () => {
    const { container } = renderSchedule(entry(true))
    const led = container.querySelector('.ms-now-playing')
    expect(led).not.toBeNull()
    const pill = led!.nextElementSibling
    expect(pill).toHaveClass('ms-now-playing-pill')
    expect(pill).toHaveTextContent('Now Playing')
  })

  it('shows neither for a match that is not being played', () => {
    const { container } = renderSchedule(entry(false))
    expect(container.querySelector('.ms-now-playing')).toBeNull()
    expect(container.querySelector('.ms-now-playing-pill')).toBeNull()
  })
})

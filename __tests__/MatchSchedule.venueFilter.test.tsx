/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import MatchSchedule from '@/components/MatchSchedule'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { MatchEntry, MatchScheduleGroup } from '@/lib/types'

function entry(court: string, name: string, winner: MatchEntry['winner'] = null): MatchEntry {
  return {
    draw: 'WS', drawNum: '1', round: 'QF',
    team1: [{ name, playerId: `${name}-1` }],
    team2: [{ name: `${name} opp`, playerId: `${name}-2` }],
    winner, scores: winner === null ? [] : [{ t1: 21, t2: 10 }],
    court, walkover: false, retired: false,
    nowPlaying: false,
  }
}

// Two gyms interleaved in the same time slots, the way a multi-venue BAT day
// prints them: slot 9:00 is already played, so the queue starts at 9:30.
const groups: MatchScheduleGroup[] = [
  {
    type: 'time', time: '9:00',
    matches: [entry('Gym6 - A1', 'SixDone', 1), entry('Gym4 - B1', 'FourDone', 1)],
  },
  {
    type: 'time', time: '9:30',
    matches: [entry('Gym6 - A1', 'SixOne'), entry('Gym4 - B1', 'FourOne')],
  },
  {
    type: 'time', time: '10:00',
    matches: [entry('Gym6 - A2', 'SixTwo'), entry('Gym4 - B2', 'FourTwo')],
  },
]

function renderSchedule(g: MatchScheduleGroup[] = groups) {
  return render(
    <LanguageProvider>
      <MatchSchedule
        groups={g}
        days={[]} selectedDay="" onDayChange={() => {}}
        loading={false} playerQuery=""
      />
    </LanguageProvider>,
  )
}

// The queue pill of the match whose team1 player is `name`.
function pillFor(container: HTMLElement, name: string): string | null {
  const span = Array.from(container.querySelectorAll('.ms-match')).find((el) =>
    el.textContent?.includes(name),
  )
  return span?.querySelector('.ms-order-pill')?.textContent ?? null
}

describe('MatchSchedule — venue filter', () => {
  it('offers every venue plus "all venues"', () => {
    renderSchedule()
    const select = screen.getByLabelText('Venue') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'All venues', 'Gym6', 'Gym4',
    ])
  })

  it('stays hidden for a single-venue event', () => {
    renderSchedule([{ type: 'time', time: '9:00', matches: [entry('Gym6 - A1', 'Only')] }])
    expect(screen.queryByLabelText('Venue')).toBeNull()
  })

  it('shows only the selected venue’s matches', () => {
    const { container } = renderSchedule()
    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'Gym4' } })
    expect(container.textContent).toContain('FourOne')
    expect(container.textContent).not.toContain('SixOne')
  })

  it('counts the queue within the selected venue only', () => {
    const { container } = renderSchedule()
    // All venues: the two gyms share one queue, so Gym4's 10:00 match is 4th.
    expect(pillFor(container, 'SixOne')).toBe('Up next')
    expect(pillFor(container, 'FourTwo')).toBe('4 away')

    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: 'Gym4' } })
    expect(pillFor(container, 'FourOne')).toBe('Up next')
    expect(pillFor(container, 'FourTwo')).toBe('2 away')
  })
})

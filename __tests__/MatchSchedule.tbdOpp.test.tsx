/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react'
import MatchSchedule from '@/components/MatchSchedule'
import { LanguageProvider } from '@/lib/LanguageContext'
import type { MatchScheduleGroup, MatchEntry, MatchPlayer } from '@/lib/types'

const player = (name: string, playerId = name): MatchPlayer => ({ name, playerId })

function entry(opts: {
  team1?: MatchPlayer[]
  team2?: MatchPlayer[]
  tbdOpponents?: MatchPlayer[][]
}): MatchEntry {
  return {
    draw: 'BS U13',
    drawNum: '1',
    round: 'R64',
    team1: opts.team1 ?? [],
    team2: opts.team2 ?? [],
    winner: null,
    scores: [],
    court: '',
    walkover: false,
    retired: false,
    nowPlaying: false,
    tbdOpponents: opts.tbdOpponents,
  }
}

const group = (m: MatchEntry): MatchScheduleGroup => ({
  type: 'time',
  time: '10:00',
  matches: [m],
})

const renderMS = (m: MatchEntry) =>
  render(
    <LanguageProvider>
      <MatchSchedule
        groups={[group(m)]}
        days={[]}
        selectedDay=""
        onDayChange={() => {}}
        loading={false}
        playerQuery=""
      />
    </LanguageProvider>,
  )

describe('MatchSchedule — tbdOpponents', () => {
  it('renders two candidates joined by " or " when team2 is empty and two candidates exist', () => {
    const m = entry({
      team1: [player('Alpha')],
      tbdOpponents: [[player('Cathy')], [player('Dale')]],
    })
    const { container } = renderMS(m)
    const tbd = container.querySelector('.ms-team--2 .ms-tbd-opp')
    expect(tbd).not.toBeNull()
    expect(tbd!.textContent).toContain('Cathy')
    expect(tbd!.textContent).toContain('Dale')
    expect(container.querySelector('.ms-tbd-or')).not.toBeNull()
  })

  it('renders without an "or" separator when only one candidate is provided', () => {
    const m = entry({
      team1: [player('Alpha')],
      tbdOpponents: [[player('Cathy')]],
    })
    const { container } = renderMS(m)
    const tbd = container.querySelector('.ms-team--2 .ms-tbd-opp')
    expect(tbd).not.toBeNull()
    expect(tbd!.textContent).toContain('Cathy')
    expect(container.querySelector('.ms-tbd-or')).toBeNull()
  })

  it('joins doubles partners with "/"', () => {
    const m = entry({
      team1: [player('Alpha1'), player('Alpha2')],
      tbdOpponents: [[player('C1'), player('C2')], [player('D1'), player('D2')]],
    })
    const { container } = renderMS(m)
    const tbd = container.querySelector('.ms-team--2 .ms-tbd-opp')
    expect(tbd).not.toBeNull()
    expect(tbd!.textContent).toContain('C1/C2')
    expect(tbd!.textContent).toContain('D1/D2')
  })

  it('renders on team1 when team1 is empty and team2 is populated', () => {
    const m = entry({
      team2: [player('Beta')],
      tbdOpponents: [[player('Cathy')], [player('Dale')]],
    })
    const { container } = renderMS(m)
    expect(container.querySelector('.ms-team--1 .ms-tbd-opp')).not.toBeNull()
    expect(container.querySelector('.ms-team--2 .ms-tbd-opp')).toBeNull()
  })

  it('does NOT render anything special when tbdOpponents is absent', () => {
    const m = entry({ team1: [player('Alpha')], team2: [], tbdOpponents: undefined })
    const { container } = renderMS(m)
    expect(container.querySelector('.ms-tbd-opp')).toBeNull()
  })

  it('does NOT render anything special when both sides are empty', () => {
    const m = entry({
      tbdOpponents: [[player('Cathy')], [player('Dale')]],
    })
    const { container } = renderMS(m)
    expect(container.querySelector('.ms-tbd-opp')).toBeNull()
  })
})

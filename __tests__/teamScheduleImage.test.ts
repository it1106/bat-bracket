/**
 * @jest-environment jsdom
 */
import { buildTeamScheduleNode } from '@/lib/teamScheduleImage'
import type { TeamScheduleRow } from '@/lib/teamSchedule'

jest.mock('html-to-image', () => ({
  toJpeg: jest.fn(async () => 'data:image/jpeg;base64,AAAA'),
  getFontEmbedCSS: jest.fn(async () => ''),
}))

function row(over: Partial<TeamScheduleRow>): TeamScheduleRow {
  return {
    when: '9:00', court: 'Court - 3', order: '', event: 'BS U15', round: 'Round of 16',
    team: ['Ren'], opponent: ['Opp'], opponentCandidates: [],
    bothSides: false, status: 'upcoming', result: '', nextTime: '',
    ...over,
  }
}

const labels = { nowPlaying: 'Now playing', disclaimer: 'Unofficial', playsAgain: 'Plays again', or: 'or' }

// The match rows are the picture's only flex lines.
const lines = (root: HTMLElement) =>
  Array.from(root.children).filter((c) => (c as HTMLElement).style.display === 'flex') as HTMLElement[]

describe('buildTeamScheduleNode', () => {
  it('numbers the rows from 1 in a leading column', () => {
    const root = buildTeamScheduleNode({
      tournamentName: 'Open', teamLabel: 'Ren', dateLabel: 'Sat 3 Oct', labels,
      rows: [row({ when: '9:00' }), row({ when: '10:30' }), row({ when: '', order: 'Match 7' })],
    })
    expect(lines(root).map((line) => line.firstElementChild?.textContent)).toEqual(['1', '2', '3'])
    // The index is its own column: the time still follows it.
    expect(lines(root)[0].children[1].textContent).toContain('9:00')
    expect(lines(root)[2].children[1].textContent).toContain('Match 7')
  })
})

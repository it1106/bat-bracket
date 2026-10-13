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

  // The header line, when there is one, sits between the team · date line and
  // the disclaimer; it is the only non-flex child carrying a place.
  const header = (root: HTMLElement) => Array.from(root.children).map((c) => c.textContent)
  const place = (root: HTMLElement, i: number) => lines(root)[i].children[1].textContent

  it('puts the place in the header, and off the rows, when every row shares it', () => {
    const root = buildTeamScheduleNode({
      tournamentName: 'Open', teamLabel: 'Ren', dateLabel: 'Sat 3 Oct', labels,
      rows: [row({ court: 'Hall A' }), row({ when: '10:30', court: 'Hall A' })],
    })
    expect(header(root)).toContain('Hall A')
    expect(place(root, 0)).not.toContain('Hall A')
    expect(place(root, 1)).not.toContain('Hall A')
  })

  it('gives every row its own place, and no header, when the day is split', () => {
    const root = buildTeamScheduleNode({
      tournamentName: 'Open', teamLabel: 'Ren', dateLabel: 'Sat 3 Oct', labels,
      // The majority place used to be hoisted, leaving these two rows blank.
      rows: [row({ court: 'Hall A' }), row({ when: '10:30', court: 'Hall A' }), row({ when: '11:30', court: 'Hall B' })],
    })
    expect(header(root)).not.toContain('Hall A')
    expect(place(root, 0)).toContain('Hall A')
    expect(place(root, 1)).toContain('Hall A')
    expect(place(root, 2)).toContain('Hall B')
  })

  it('shows a lone row its place rather than hoisting it', () => {
    const root = buildTeamScheduleNode({
      tournamentName: 'Open', teamLabel: 'Ren', dateLabel: 'Sat 3 Oct', labels,
      rows: [row({ court: 'Hall A' })],
    })
    expect(header(root)).not.toContain('Hall A')
    expect(place(root, 0)).toContain('Hall A')
  })

  it('adds no header when no row has a place', () => {
    const root = buildTeamScheduleNode({
      tournamentName: 'Open', teamLabel: 'Ren', dateLabel: 'Sat 3 Oct', labels,
      rows: [row({ court: '' }), row({ when: '10:30', court: '' })],
    })
    expect(header(root).filter((t) => t === '')).toHaveLength(0)
  })
})

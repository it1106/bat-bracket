import { ALL_VENUES, collectVenues, filterGroupsByVenue, venueOfCourt } from '@/lib/venues'
import type { MatchEntry, MatchScheduleGroup } from '@/lib/types'

function entry(court: string, name = 'Alpha'): MatchEntry {
  return {
    draw: 'WS', drawNum: '1', round: 'QF',
    team1: [{ name, playerId: '100' }],
    team2: [{ name: 'Beta', playerId: '200' }],
    winner: null, scores: [],
    court, walkover: false, retired: false,
    nowPlaying: false,
  }
}

describe('venueOfCourt', () => {
  it('takes the part before the first " - "', () => {
    expect(venueOfCourt('ยิมฯ 6 สนาม - A1')).toBe('ยิมฯ 6 สนาม')
    expect(venueOfCourt('ยิมฯ 4 สนาม - B2')).toBe('ยิมฯ 4 สนาม')
  })

  it('keeps a hyphenated court number out of the venue', () => {
    expect(venueOfCourt('Gym6 - A-02')).toBe('Gym6')
  })

  it('reads a court-less row as its venue', () => {
    expect(venueOfCourt('ยิมฯ 6 สนาม')).toBe('ยิมฯ 6 สนาม')
    expect(venueOfCourt('Gym4')).toBe('Gym4')
  })

  it('has no venue for an empty court or the "Now playing" stub', () => {
    expect(venueOfCourt('')).toBeNull()
    expect(venueOfCourt(undefined)).toBeNull()
    expect(venueOfCourt('   ')).toBeNull()
    expect(venueOfCourt('Now playing')).toBeNull()
    expect(venueOfCourt('now playing')).toBeNull()
  })
})

describe('collectVenues', () => {
  it('lists each venue once, in the order the schedule first names it', () => {
    const groups: MatchScheduleGroup[] = [
      { type: 'time', time: '9:00', matches: [entry('ยิมฯ 6 สนาม - A1'), entry('ยิมฯ 4 สนาม - B1')] },
      { type: 'time', time: '9:30', matches: [entry('ยิมฯ 4 สนาม - B2'), entry('ยิมฯ 6 สนาม'), entry('')] },
    ]
    expect(collectVenues(groups)).toEqual(['ยิมฯ 6 สนาม', 'ยิมฯ 4 สนาม'])
  })

  it('is empty for a single-venue event with no venue in the court names', () => {
    const groups: MatchScheduleGroup[] = [{ type: 'time', time: '9:00', matches: [entry('')] }]
    expect(collectVenues(groups)).toEqual([])
  })
})

describe('filterGroupsByVenue', () => {
  const groups: MatchScheduleGroup[] = [
    { type: 'time', time: '9:00', matches: [entry('ยิมฯ 6 สนาม - A1', 'Six'), entry('ยิมฯ 4 สนาม - B1', 'Four')] },
    { type: 'time', time: '9:30', matches: [entry('ยิมฯ 4 สนาม - B2', 'FourAgain')] },
    { type: 'time', time: '10:00', matches: [entry('Now playing', 'Live')] },
  ]

  it('returns the groups untouched for "all venues"', () => {
    expect(filterGroupsByVenue(groups, ALL_VENUES)).toBe(groups)
  })

  it('keeps only the selected venue, dropping groups left empty', () => {
    const out = filterGroupsByVenue(groups, 'ยิมฯ 6 สนาม')
    expect(out.map((g) => (g.type === 'time' ? g.time : g.court))).toEqual(['9:00', '10:00'])
    expect(out[0].matches.map((m) => m.team1[0].name)).toEqual(['Six'])
  })

  it('keeps rows whose venue is unknown in every venue view', () => {
    for (const venue of ['ยิมฯ 6 สนาม', 'ยิมฯ 4 สนาม']) {
      const out = filterGroupsByVenue(groups, venue)
      expect(out.some((g) => g.matches.some((m) => m.team1[0].name === 'Live'))).toBe(true)
    }
  })

  it('leaves the input groups alone', () => {
    filterGroupsByVenue(groups, 'ยิมฯ 6 สนาม')
    expect(groups[0].matches).toHaveLength(2)
  })
})

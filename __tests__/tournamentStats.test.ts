import fs from 'fs'
import path from 'path'
import { aggregate } from '@/lib/tournamentStats'
import type { MatchEntry, MatchesData, MatchScheduleGroup } from '@/lib/types'

const FIX = path.join(__dirname, '..', 'fixtures')

function loadSprc() {
  const data = JSON.parse(fs.readFileSync(path.join(FIX, 'stats-sprc-full.json'), 'utf8')) as MatchesData
  const daysObj = JSON.parse(
    fs.readFileSync(path.join(FIX, 'stats-sprc-days.json'), 'utf8'),
  ) as Record<string, MatchScheduleGroup[]>
  const days = new Map(Object.entries(daysObj))
  const clubs = JSON.parse(fs.readFileSync(path.join(FIX, 'stats-sprc-clubs.json'), 'utf8')) as Record<string, string>
  return { data, days, clubs }
}

describe('tournamentStats — KPIs', () => {
  it('reports SPRC headline numbers', () => {
    const { data, days, clubs } = loadSprc()
    const stats = aggregate(data, days, clubs)
    expect(stats.kpis.events).toBe(33)
    expect(stats.kpis.matches).toBe(1384)
    expect(stats.kpis.decided).toBe(1343)
    expect(stats.kpis.walkovers).toBe(41)
    expect(stats.kpis.players).toBe(1102)
    expect(stats.kpis.multiEventPlayers).toBe(839)
    expect(stats.kpis.courtMinutes).toBe(39051)
    expect(Math.round(stats.kpis.avgMatchMinutes)).toBe(29)
    expect(Math.round(stats.kpis.threeSetterRate * 100)).toBe(14)
  })
})

describe('tournamentStats — daily volume', () => {
  it('one row per day with counts and minutes', () => {
    const { data, days, clubs } = loadSprc()
    const stats = aggregate(data, days, clubs)
    expect(stats.dailyVolume.map((d) => d.date)).toEqual([
      '2026-05-01', '2026-05-02', '2026-05-03',
      '2026-05-04', '2026-05-05', '2026-05-06',
    ])
    expect(stats.dailyVolume[0].total).toBe(397)
    expect(stats.dailyVolume[0].minutes).toBe(9608)
    expect(stats.dailyVolume[5].total).toBe(33)
  })
})

describe('tournamentStats — events', () => {
  it('returns all 33 SPRC events in custom discipline order', () => {
    const { data, days, clubs } = loadSprc()
    const stats = aggregate(data, days, clubs)
    expect(stats.events.length).toBe(33)
    expect(stats.events.slice(0, 5).map((e) => e.name)).toEqual(['MS', 'WS', 'MD', 'WD', 'XD'])
    expect(stats.events.slice(5, 10).map((e) => e.name)).toEqual(['BS U19', 'GS U19', 'BD U19', 'GD U19', 'XD U19'])
    expect(stats.events[stats.events.length - 1].name).toMatch(/U9/)
  })

  it('annotates each event with winner names', () => {
    const { data, days, clubs } = loadSprc()
    const stats = aggregate(data, days, clubs)
    const bs15 = stats.events.find((e) => e.name === 'BS U15')!
    expect(bs15.matches).toBe(111)
    expect(bs15.winner.length).toBe(1)
    expect(bs15.winner[0]).toContain('จิรภัทร')
    const md = stats.events.find((e) => e.name === 'MD')!
    expect(md.winner.length).toBe(2)
  })
})

describe('tournamentStats — drama', () => {
  it('finds the marathon match', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.drama.marathon).not.toBeNull()
    expect(s.drama.marathon!.draw).toBe('GD U19')
    expect(s.drama.marathon!.durationMinutes).toBe(129)
  })

  it('finds a 28-26 highest set', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.drama.highestSet).not.toBeNull()
    const set = s.drama.highestSet!.scores[s.drama.highestSet!.setIndex]
    expect(set.t1 + set.t2).toBe(54)
  })

  it('counts 102 comebacks', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.drama.comebackCount).toBe(102)
  })

  it('finds most-court-time player', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.drama.mostCourtTime).not.toBeNull()
    expect(s.drama.mostCourtTime!.name).toContain('พิมพ์ชนก')
    expect(s.drama.mostCourtTime!.minutes).toBe(7 * 60 + 33)
    expect(s.drama.mostCourtTime!.events.sort()).toEqual(['GD U19', 'GS U19'])
  })
})

describe('tournamentStats — top players', () => {
  it('top player has 11 wins', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.topPlayers[0].wins).toBe(11)
    expect(s.topPlayers[0].losses).toBe(0)
    expect(s.topPlayers.length).toBeLessThanOrEqual(12)
  })
})

describe('tournamentStats — courts + integrity', () => {
  it('court utilization sorted by minutes desc, capped at 14', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.courtUtilization.length).toBeLessThanOrEqual(14)
    for (let i = 1; i < s.courtUtilization.length; i++) {
      expect(s.courtUtilization[i - 1].minutes).toBeGreaterThanOrEqual(s.courtUtilization[i].minutes)
    }
  })

  it('flags WS as the highest walkover-rate event', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.integrity.walkoverByEvent[0].event).toBe('WS')
  })
})

describe('tournamentStats — medals', () => {
  it('top club has 27 golds', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.clubMedals[0].club).toBe('บ้านทองหยอด')
    expect(s.clubMedals[0].gold).toBe(27)
    expect(s.clubMedals[0].silver).toBe(19)
    expect(s.clubMedals[0].bronze).toBe(24)
    // No longer capped at 10 — the UI handles top-10 + "show more".
    // Every credited club should appear in the medal table.
    expect(s.clubMedals.length).toBeGreaterThan(0)
  })

  it('finds 7 multi-gold players', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    expect(s.multiGoldPlayers.length).toBe(7)
    for (const p of s.multiGoldPlayers) expect(p.events.length).toBeGreaterThanOrEqual(2)
  })
})

describe('tournamentStats — empty', () => {
  it('zero matches → all empty arrays', () => {
    const empty = JSON.parse(
      fs.readFileSync(path.join(FIX, 'stats-empty.json'), 'utf8'),
    ) as MatchesData
    const s = aggregate(empty, new Map(), {})
    expect(s.kpis.matches).toBe(0)
    expect(s.events).toEqual([])
    expect(s.clubMedals).toEqual([])
    expect(s.drama.marathon).toBeNull()
  })
})

// Live tournament reality: per-day matches only surface the events that have
// been scheduled so far (singles in early days), while the full draw roster
// lists every event including doubles that start mid-week. The roster input
// to aggregate() must drive both the events count and the multi-event player
// count, otherwise the panel undercounts both for the first several days.
describe('tournamentStats — roster augments live counts', () => {
  function entry(draw: string, ids: string[]): MatchEntry {
    return {
      draw,
      drawNum: '',
      round: 'R1',
      team1: [{ name: ids[0], playerId: ids[0] }],
      team2: [{ name: ids[1], playerId: ids[1] }],
      winner: null,
      scores: [],
      court: '',
      walkover: false,
      retired: false,
      nowPlaying: false,
    }
  }
  function doublesEntry(draw: string, ids: string[]): MatchEntry {
    return {
      draw,
      drawNum: '',
      round: 'R1',
      team1: [
        { name: ids[0], playerId: ids[0] },
        { name: ids[1], playerId: ids[1] },
      ],
      team2: [
        { name: ids[2], playerId: ids[2] },
        { name: ids[3], playerId: ids[3] },
      ],
      winner: null,
      scores: [],
      court: '',
      walkover: false,
      retired: false,
      nowPlaying: false,
    }
  }

  const emptyData: MatchesData = {
    days: [{ date: '20260519', label: '19/05', dateIso: '2026-05-19', hasMatches: true }],
    currentDate: '20260519',
    groups: [],
  }
  // Played-matches view: only MS-U13 has happened so far. P1 beats P2.
  const dayGroups: MatchScheduleGroup[] = [{
    type: 'time' as const,
    time: '09:00',
    matches: [{
      draw: 'MS-U13', drawNum: '1', round: 'R1',
      team1: [{ name: 'P1', playerId: 'P1' }],
      team2: [{ name: 'P2', playerId: 'P2' }],
      winner: 1, scores: [{ t1: 21, t2: 18 }, { t1: 21, t2: 15 }],
      court: 'Court 1', walkover: false, retired: false, nowPlaying: false,
      duration: '32 mins',
    }],
  }]
  const days = new Map([['2026-05-19', dayGroups]])

  it('without roster: events count and multi-event count reflect played matches only', () => {
    const s = aggregate(emptyData, days, {})
    expect(s.kpis.events).toBe(1)
    expect(s.kpis.players).toBe(2)
    expect(s.kpis.multiEventPlayers).toBe(0)
    expect(s.events.map((e) => e.name)).toEqual(['MS-U13'])
  })

  it('with roster: events count covers all registered draws, multi-event picks up crossovers', () => {
    // Full draw roster: 3 events. P1 is entered in MS-U13 + MD-U13 + XD-U13.
    // P2 is in MS-U13 + MD-U13. P3, P4 are roster-only.
    const roster = new Map<string, MatchEntry[]>([
      ['MS-U13', [entry('MS-U13', ['P1', 'P2'])]],
      ['MD-U13', [doublesEntry('MD-U13', ['P1', 'P2', 'P3', 'P4'])]],
      ['XD-U13', [doublesEntry('XD-U13', ['P1', 'P5', 'P6', 'P7'])]],
    ])
    const s = aggregate(emptyData, days, {}, roster)
    expect(s.kpis.events).toBe(3)
    expect(s.kpis.players).toBe(7)
    // P1 in 3 draws, P2 in 2 draws → 2 multi-event players
    expect(s.kpis.multiEventPlayers).toBe(2)
    // Matches/duration/decided stay played-only
    expect(s.kpis.matches).toBe(1)
    expect(s.kpis.decided).toBe(1)
    expect(s.kpis.courtMinutes).toBe(32)
    // Events table seeded with all roster events; MS-U13 carries the played match
    const eventNames = s.events.map((e) => e.name).sort()
    expect(eventNames).toEqual(['MD-U13', 'MS-U13', 'XD-U13'])
    const ms = s.events.find((e) => e.name === 'MS-U13')!
    expect(ms.matches).toBe(1)
    expect(ms.decided).toBe(1)
    expect(ms.players).toBe(2)
    const md = s.events.find((e) => e.name === 'MD-U13')!
    expect(md.matches).toBe(0)
    // Roster-seeded count: MD-U13 has 4 entrants, XD-U13 has 4.
    expect(md.players).toBe(4)
    const xd = s.events.find((e) => e.name === 'XD-U13')!
    expect(xd.players).toBe(4)
  })

  it('roster alone (no played matches) populates events and players', () => {
    const roster = new Map<string, MatchEntry[]>([
      ['WD-U17', [doublesEntry('WD-U17', ['A', 'B', 'C', 'D'])]],
    ])
    const s = aggregate(emptyData, new Map(), {}, roster)
    expect(s.kpis.events).toBe(1)
    expect(s.kpis.players).toBe(4)
    expect(s.kpis.matches).toBe(0)
    expect(s.events.map((e) => e.name)).toEqual(['WD-U17'])
    expect(s.events[0].players).toBe(4)
  })
})

// SAT NSDF-style grouped tournaments split each event into N round-robin
// groups whose draw names are "<event> - Group X". match.eventName carries
// the parent event so buildEvents collapses them; buildKpis must do the
// same or the headline events count inflates by the group multiplier
// (e.g. 20 events × 8 groups → "160 events" in the panel).
describe('tournamentStats — grouped events collapse to parent', () => {
  const data: MatchesData = {
    days: [{ date: '20260525', label: '25/05', dateIso: '2026-05-25', hasMatches: true }],
    currentDate: '20260525',
    groups: [],
  }
  function gm(draw: string, eventName: string, p1: string, p2: string): MatchEntry {
    return {
      draw, drawNum: '', round: 'R1', eventName,
      team1: [{ name: p1, playerId: p1 }],
      team2: [{ name: p2, playerId: p2 }],
      winner: null, scores: [],
      court: '', walkover: false, retired: false, nowPlaying: false,
    }
  }
  const dayGroups: MatchScheduleGroup[] = [{
    type: 'time' as const,
    time: '09:00',
    matches: [
      gm('BS U17 - Group A', 'BS U17', 'P1', 'P2'),
      gm('BS U17 - Group B', 'BS U17', 'P3', 'P4'),
      gm('GS U17 - Group A', 'GS U17', 'P5', 'P6'),
    ],
  }]
  const days = new Map([['2026-05-25', dayGroups]])

  it('counts the parent event once across all groups', () => {
    const s = aggregate(data, days, {})
    expect(s.kpis.events).toBe(2)
    expect(s.events.map((e) => e.name).sort()).toEqual(['BS U17', 'GS U17'])
    // Unique-player count rolls up across groups too: BS U17 sees P1–P4.
    const bs = s.events.find((e) => e.name === 'BS U17')!
    expect(bs.players).toBe(4)
    const gs = s.events.find((e) => e.name === 'GS U17')!
    expect(gs.players).toBe(2)
  })
})

// ─── Pre-match builders ──────────────────────────────────────
import { buildSeedHeadlines } from '@/lib/tournamentStats'
import type { TournamentOverview } from '@/lib/types'

describe('buildSeedHeadlines', () => {
  test('returns empty when overview is undefined', () => {
    expect(buildSeedHeadlines(undefined, {})).toEqual([])
  })

  test('returns top-2 seeds per event with club lookups', () => {
    const overview: TournamentOverview = {
      notes: [],
      seedEvents: [
        {
          eventName: 'MS',
          seeds: [
            { seed: 1, players: ['p1'] },
            { seed: 2, players: ['p2'] },
            { seed: 3, players: ['p3'] },
          ],
        },
      ],
    }
    const clubs: Record<string, string> = { p1: 'CLUB-A', p2: 'CLUB-B' }
    expect(buildSeedHeadlines(overview, clubs)).toEqual([
      {
        event: 'MS',
        seeds: [
          { seed: 1, players: ['p1'], club: 'CLUB-A' },
          { seed: 2, players: ['p2'], club: 'CLUB-B' },
        ],
      },
    ])
  })

  test('omits club when not in lookup', () => {
    const overview: TournamentOverview = {
      notes: [],
      seedEvents: [{ eventName: 'WS', seeds: [{ seed: 1, players: ['x'] }] }],
    }
    expect(buildSeedHeadlines(overview, {})).toEqual([
      { event: 'WS', seeds: [{ seed: 1, players: ['x'] }] },
    ])
  })
})

import { buildMultiEventEntries } from '@/lib/tournamentStats'

function fakeRosterEntry(eventName: string, playerIds: string[]): MatchEntry {
  return {
    draw: eventName, drawNum: '', round: 'R32',
    team1: playerIds.map((id) => ({ name: id, playerId: id })),
    team2: [], winner: null, scores: [], court: '',
    walkover: false, retired: false, nowPlaying: false,
    eventName,
  }
}

describe('buildMultiEventEntries', () => {
  test('returns empty when rosterByDraw is undefined', () => {
    expect(buildMultiEventEntries(undefined, {}, {})).toEqual([])
  })

  test('returns players entered in 2+ events sorted by count desc then name', () => {
    const roster = new Map<string, MatchEntry[]>([
      ['1', [fakeRosterEntry('MS', ['p1']), fakeRosterEntry('MS', ['p2'])]],
      ['2', [fakeRosterEntry('MD', ['p1', 'p3'])]],
      ['3', [fakeRosterEntry('XD', ['p1', 'p4'])]],
      ['4', [fakeRosterEntry('WS', ['p3'])]],
    ])
    const clubs = { p1: 'CLUB-A', p3: 'CLUB-B' }
    const names = { p1: 'Alice', p3: 'Cara' }
    const out = buildMultiEventEntries(roster, clubs, names)
    expect(out).toEqual([
      { playerId: 'p1', name: 'Alice', club: 'CLUB-A', events: ['MS', 'MD', 'XD'] },
      { playerId: 'p3', name: 'Cara', club: 'CLUB-B', events: ['MD', 'WS'] },
    ])
  })

  test('falls back to playerId when name is missing', () => {
    const roster = new Map<string, MatchEntry[]>([
      ['1', [fakeRosterEntry('MS', ['p9'])]],
      ['2', [fakeRosterEntry('MD', ['p9'])]],
    ])
    expect(buildMultiEventEntries(roster, {}, {})).toEqual([
      { playerId: 'p9', name: 'p9', club: '', events: ['MS', 'MD'] },
    ])
  })
})

import { buildPotentialCollisions } from '@/lib/tournamentStats'

describe('buildPotentialCollisions', () => {
  test('returns empty when overview is undefined', () => {
    expect(buildPotentialCollisions(undefined, {})).toEqual([])
  })

  test('produces SF + F for a 4-seed event using convention (1v4, 2v3)', () => {
    const overview: TournamentOverview = {
      notes: [],
      seedEvents: [{
        eventName: 'MS',
        seeds: [
          { seed: 1, players: ['p1'] },
          { seed: 2, players: ['p2'] },
          { seed: 3, players: ['p3'] },
          { seed: 4, players: ['p4'] },
        ],
      }],
    }
    const clubs = { p1: 'A', p2: 'B', p3: 'C', p4: 'D' }
    const out = buildPotentialCollisions(overview, clubs)
    expect(out).toEqual([{
      event: 'MS',
      semis: [
        { sideA: { seed: 1, players: ['p1'], club: 'A' }, sideB: { seed: 4, players: ['p4'], club: 'D' } },
        { sideA: { seed: 2, players: ['p2'], club: 'B' }, sideB: { seed: 3, players: ['p3'], club: 'C' } },
      ],
      final: {
        sideA: { seed: 1, players: ['p1'], club: 'A' },
        sideB: { seed: 2, players: ['p2'], club: 'B' },
      },
    }])
  })

  test('skips events with fewer than 4 seeded players', () => {
    const overview: TournamentOverview = {
      notes: [],
      seedEvents: [{
        eventName: 'WS',
        seeds: [
          { seed: 1, players: ['x'] },
          { seed: 2, players: ['y'] },
          { seed: 3, players: ['z'] },
        ],
      }],
    }
    expect(buildPotentialCollisions(overview, {})).toEqual([])
  })

  test('omits club when not in lookup', () => {
    const overview: TournamentOverview = {
      notes: [],
      seedEvents: [{
        eventName: 'XD',
        seeds: [
          { seed: 1, players: ['a'] },
          { seed: 2, players: ['b'] },
          { seed: 3, players: ['c'] },
          { seed: 4, players: ['d'] },
        ],
      }],
    }
    const out = buildPotentialCollisions(overview, {})
    expect(out[0].semis[0].sideA.club).toBeUndefined()
    expect(out[0].final?.sideB.club).toBeUndefined()
  })
})

import { buildSchedulePreview } from '@/lib/tournamentStats'

describe('buildSchedulePreview', () => {
  test('returns undefined when no days', () => {
    const data: MatchesData = { days: [] } as unknown as MatchesData
    expect(buildSchedulePreview(data, new Map())).toBeUndefined()
  })

  test('returns undefined when first day has no scheduled matches', () => {
    const data = { days: [{ date: '2026-06-10', label: 'Wed', dateIso: '2026-06-10', hasMatches: true }] } as MatchesData
    const groups: MatchScheduleGroup[] = [{
      type: 'court', court: 'C1', matches: [{
        draw: 'MS', drawNum: '1', round: 'R32',
        team1: [{ name: 'A', playerId: 'a' }],
        team2: [{ name: 'B', playerId: 'b' }],
        winner: null, scores: [], court: 'C1', walkover: false, retired: false, nowPlaying: false,
      }],
    }]
    expect(buildSchedulePreview(data, new Map([['2026-06-10', groups]]))).toBeUndefined()
  })

  test('groups by court and sorts matches by time when scheduled times exist', () => {
    const data = { days: [{ date: '2026-06-10', label: 'Wed Jun 10', dateIso: '2026-06-10', hasMatches: true }] } as MatchesData
    const m = (court: string, time: string, eventName: string) => ({
      draw: eventName, drawNum: '1', round: 'R32',
      team1: [{ name: 'A', playerId: 'a' }],
      team2: [{ name: 'B', playerId: 'b' }],
      winner: null, scores: [], court, walkover: false, retired: false, nowPlaying: false,
      scheduledTime: time, eventName,
    })
    const groups: MatchScheduleGroup[] = [
      { type: 'court', court: 'C1', matches: [m('C1', '10:30', 'MS'), m('C1', '09:00', 'WS')] },
      { type: 'court', court: 'C2', matches: [m('C2', '09:15', 'MD')] },
    ]
    const preview = buildSchedulePreview(data, new Map([['2026-06-10', groups]]))
    expect(preview).toEqual({
      firstDayLabel: 'Wed Jun 10',
      matchCount: 3,
      courts: 2,
      opensAt: '09:00',
      openingDayByCourt: [
        { court: 'C1', matches: [
          expect.objectContaining({ time: '09:00', event: 'WS' }),
          expect.objectContaining({ time: '10:30', event: 'MS' }),
        ]},
        { court: 'C2', matches: [
          expect.objectContaining({ time: '09:15', event: 'MD' }),
        ]},
      ],
    })
  })

  test('returns undefined when any match on the first day already has a winner', () => {
    const data = { days: [{ date: '2026-06-10', label: 'Wed', dateIso: '2026-06-10', hasMatches: true }] } as MatchesData
    const groups: MatchScheduleGroup[] = [{
      type: 'court', court: 'C1', matches: [{
        draw: 'MS', drawNum: '1', round: 'R32',
        team1: [{ name: 'A', playerId: 'a' }],
        team2: [{ name: 'B', playerId: 'b' }],
        winner: 1, scores: [{ t1: 21, t2: 10 }], court: 'C1',
        walkover: false, retired: false, nowPlaying: false, scheduledTime: '09:00',
      }],
    }]
    expect(buildSchedulePreview(data, new Map([['2026-06-10', groups]]))).toBeUndefined()
  })
})

describe('kpis entries/draws', () => {
  test('counts entries (sum across draws) and draws (number of rosterByDraw keys)', () => {
    const data = { days: [] } as unknown as MatchesData
    const roster = new Map<string, MatchEntry[]>([
      ['1', [fakeRosterEntry('MS', ['a']), fakeRosterEntry('MS', ['b'])]],
      ['2', [fakeRosterEntry('MD', ['a', 'c'])]],
      ['3', [fakeRosterEntry('WS', ['d'])]],
    ])
    const stats = aggregate(data, new Map(), {}, roster, {})
    expect(stats.kpis.entries).toBe(4)
    expect(stats.kpis.draws).toBe(3)
  })

  test('entries/draws are zero when rosterByDraw is undefined', () => {
    const data = { days: [] } as unknown as MatchesData
    const stats = aggregate(data, new Map(), {}, undefined, {})
    expect(stats.kpis.entries).toBe(0)
    expect(stats.kpis.draws).toBe(0)
  })
})

import type { DrawInfo } from '@/lib/types'

describe('events pre-match decoration', () => {
  test('decorates with size, type, entries, topSeed when draws+overview present', () => {
    const data = { days: [] } as unknown as MatchesData
    // rosterByDraw is keyed by draw NAME (matches production: roster.set(d.name, ...))
    const roster = new Map<string, MatchEntry[]>([
      ['MS', [fakeRosterEntry('MS', ['p1']), fakeRosterEntry('MS', ['p2']), fakeRosterEntry('MS', ['p3'])]],
    ])
    const draws: DrawInfo[] = [{ drawNum: '10', name: 'MS', size: '16', type: 'Knockout', eventName: 'MS' }]
    const overview: TournamentOverview = { notes: [], seedEvents: [{ eventName: 'MS', seeds: [{ seed: 1, players: ['p1'] }] }] }
    const clubs = { p1: 'A' }
    const stats = aggregate(data, new Map(), clubs, roster, {}, { draws, overview })
    expect(stats.events).toHaveLength(1)
    expect(stats.events[0]).toEqual(expect.objectContaining({
      name: 'MS',
      size: 16,
      type: 'KO',
      entries: 3,
      topSeed: { players: ['p1'], club: 'A' },
    }))
  })

  test('maps Round Robin draws to RR+PO type', () => {
    const data = { days: [] } as unknown as MatchesData
    const roster = new Map<string, MatchEntry[]>([
      ['U17 MS', [fakeRosterEntry('U17 MS', ['x'])]],
    ])
    const draws: DrawInfo[] = [{ drawNum: '11', name: 'U17 MS', size: '8', type: 'Round Robin', eventName: 'U17 MS' }]
    const stats = aggregate(data, new Map(), {}, roster, {}, { draws })
    expect(stats.events[0]).toEqual(expect.objectContaining({ type: 'RR+PO', size: 8 }))
  })

  test('leaves pre-match fields undefined when draws not provided', () => {
    const data = { days: [] } as unknown as MatchesData
    const roster = new Map<string, MatchEntry[]>([
      ['WS', [fakeRosterEntry('WS', ['w1'])]],
    ])
    const stats = aggregate(data, new Map(), {}, roster, {})
    expect(stats.events[0]).toEqual(expect.objectContaining({ name: 'WS' }))
    expect(stats.events[0].size).toBeUndefined()
    expect(stats.events[0].type).toBeUndefined()
  })
})

import { buildDefendingChampion } from '@/lib/tournamentStats'
import type { PriorEditionWinnerMap } from '@/lib/priorEdition'

describe('buildDefendingChampion', () => {
  test('returns [] when winners map is undefined', () => {
    expect(buildDefendingChampion(undefined, undefined, {})).toEqual([])
  })

  test('emits one row per event in overview that has a winner', () => {
    const overview: TournamentOverview = { notes: [], seedEvents: [
      { eventName: 'MS', seeds: [] },
      { eventName: 'WS', seeds: [] },
      { eventName: 'MD', seeds: [] },
    ] }
    const winners: PriorEditionWinnerMap = new Map([
      ['MS', { players: ['p1'], club: 'A', priorEditionId: 'PRI', priorEditionLabel: 'Prior' }],
      ['MD', { players: ['p2', 'p3'], priorEditionId: 'PRI', priorEditionLabel: 'Prior' }],
    ])
    const out = buildDefendingChampion(winners, overview, {})
    expect(out).toEqual([
      { event: 'MS', players: ['p1'], club: 'A', priorEditionId: 'PRI', priorEditionLabel: 'Prior' },
      { event: 'MD', players: ['p2', 'p3'], priorEditionId: 'PRI', priorEditionLabel: 'Prior' },
    ])
  })

  test('skips events that didn’t exist in the prior edition', () => {
    const overview: TournamentOverview = { notes: [], seedEvents: [{ eventName: 'NEW', seeds: [] }] }
    const winners: PriorEditionWinnerMap = new Map([['OLD', { players: ['x'], priorEditionId: 'P', priorEditionLabel: 'Prior' }]])
    expect(buildDefendingChampion(winners, overview, {})).toEqual([])
  })
})

describe('dailyVolume hybrid phase', () => {
  test('emits a row for a scheduled day with 0 completed matches', () => {
    const data = {
      days: [{ date: '2026-06-10', label: 'Wed', dateIso: '2026-06-10', hasMatches: true }],
    } as MatchesData
    const groups: MatchScheduleGroup[] = [{
      type: 'court', court: 'C1', matches: [
        { draw: 'MS', drawNum: '1', round: 'R32',
          team1: [{ name: 'A', playerId: 'a' }], team2: [{ name: 'B', playerId: 'b' }],
          winner: null, scores: [], court: 'C1', walkover: false, retired: false, nowPlaying: false,
          scheduledTime: '09:00' },
        { draw: 'MS', drawNum: '1', round: 'R32',
          team1: [{ name: 'C', playerId: 'c' }], team2: [{ name: 'D', playerId: 'd' }],
          winner: null, scores: [], court: 'C1', walkover: false, retired: false, nowPlaying: false,
          scheduledTime: '10:00' },
      ],
    }]
    const stats = aggregate(data, new Map([['2026-06-10', groups]]), {}, undefined, {})
    expect(stats.dailyVolume).toEqual([
      { date: '2026-06-10', label: 'Wed', total: 2, decided: 0, minutes: 0 },
    ])
  })
})

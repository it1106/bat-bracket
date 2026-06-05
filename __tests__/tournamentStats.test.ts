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

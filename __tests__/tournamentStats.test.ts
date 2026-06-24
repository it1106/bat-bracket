import fs from 'fs'
import path from 'path'
import { aggregate, type RosterDraw } from '@/lib/tournamentStats'
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

  it('attaches per-match results that reconcile with the W-L record', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    for (const p of s.topPlayers) {
      expect(p.results).toBeDefined()
      const won = p.results!.filter((r) => r.won).length
      const lost = p.results!.filter((r) => !r.won).length
      expect(won).toBe(p.wins)
      expect(lost).toBe(p.losses)
    }
  })

  it('orients scores to the player perspective', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    let checked = 0
    for (const p of s.topPlayers) {
      for (const r of p.results!) {
        if (r.retired || r.scores.length === 0) continue
        // Winner takes the last game; oriented scores put the player on t1.
        const last = r.scores[r.scores.length - 1]
        if (r.won) expect(last.t1).toBeGreaterThan(last.t2)
        else expect(last.t1).toBeLessThan(last.t2)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0) // guard against a vacuous pass
  })

  it('orders a player results by event then round depth (shallow first)', () => {
    const { data, days, clubs } = loadSprc()
    const s = aggregate(data, days, clubs)
    const top = s.topPlayers[0]
    expect(top.results!.length).toBe(top.wins + top.losses)
    // Bracket "size" of a round: larger = shallower (R128 huge, Final = 2).
    const size = (round: string): number => {
      const r = round.toLowerCase()
      if (r === 'final') return 2
      if (r.includes('semi')) return 4
      if (r.includes('quarter')) return 8
      const m = /(\d+)/.exec(r)
      return m ? Number(m[1]) : Number.POSITIVE_INFINITY
    }
    // Within each event group, rounds run shallow→deep (sizes non-increasing).
    const byEvent = new Map<string, typeof top.results>()
    for (const r of top.results!) {
      const arr = byEvent.get(r.event) ?? []
      arr!.push(r)
      byEvent.set(r.event, arr!)
    }
    for (const arr of Array.from(byEvent.values())) {
      for (let i = 1; i < arr!.length; i++) {
        expect(size(arr![i].round)).toBeLessThanOrEqual(size(arr![i - 1].round))
      }
    }
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

// YONEX-SINGHA-BAT-BTY 2026 regression: GD U19's Final was decided by a
// walkover (winner set, walkover=true). The bracket page shows the champion,
// but the stats panel showed "pending" because winner/medal detection skipped
// walkover matches. A walkover final still crowns a champion (gold/silver) and
// a walkover semi still earns the loser bronze — only the play-derived stats
// (decided, three-setters, drama) should exclude walkovers.
describe('tournamentStats — walkover final still crowns a champion', () => {
  const data: MatchesData = {
    days: [{ date: '20260519', label: '19/05', dateIso: '2026-05-19', hasMatches: true }],
    currentDate: '20260519',
    groups: [],
  }
  const dbl = (
    round: string,
    t1: [string, string],
    t2: [string, string],
    winner: 1 | 2,
    walkover: boolean,
  ): MatchEntry => ({
    draw: 'GD U19', drawNum: '1', round,
    team1: [{ name: t1[0], playerId: t1[0] }, { name: t1[1], playerId: t1[1] }],
    team2: [{ name: t2[0], playerId: t2[0] }, { name: t2[1], playerId: t2[1] }],
    winner,
    scores: walkover ? [] : [{ t1: 21, t2: 12 }, { t1: 21, t2: 14 }],
    court: 'Court 1', walkover, retired: false, nowPlaying: false,
  })
  const dayGroups: MatchScheduleGroup[] = [{
    type: 'time' as const,
    time: '09:00',
    matches: [
      dbl('Semi final', ['A1', 'A2'], ['C1', 'C2'], 1, false),
      dbl('Semi final', ['B1', 'B2'], ['D1', 'D2'], 1, false),
      // Final: B beats A by walkover (A withdrew)
      dbl('Final', ['A1', 'A2'], ['B1', 'B2'], 2, true),
    ],
  }]
  const days = new Map([['2026-05-19', dayGroups]])
  const clubs: Record<string, string> = {
    A1: 'ClubA', A2: 'ClubA', B1: 'ClubB', B2: 'ClubB',
    C1: 'ClubC', C2: 'ClubC', D1: 'ClubD', D2: 'ClubD',
  }

  it('shows the walkover winner in the events table', () => {
    const s = aggregate(data, days, clubs)
    const gd = s.events.find((e) => e.name === 'GD U19')!
    expect(gd.winner).toEqual(['B1', 'B2'])
  })

  it('still excludes the walkover from the decided count', () => {
    const s = aggregate(data, days, clubs)
    const gd = s.events.find((e) => e.name === 'GD U19')!
    expect(gd.matches).toBe(3)
    expect(gd.decided).toBe(2) // two semis; walkover final excluded
  })

  it('credits gold/silver for the walkover final and bronze for semi losers', () => {
    const s = aggregate(data, days, clubs)
    // Medals are credited per medalist, so each doubles pair contributes 2.
    const byClub = Object.fromEntries(s.clubMedals.map((m) => [m.club, m]))
    expect(byClub['ClubB']?.gold).toBe(2)
    expect(byClub['ClubA']?.silver).toBe(2)
    expect(byClub['ClubC']?.bronze).toBe(2)
    expect(byClub['ClubD']?.bronze).toBe(2)
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
    const roster = new Map<string, RosterDraw>([
      ['MS-U13', { entries: [entry('MS-U13', ['P1', 'P2'])] }],
      ['MD-U13', { entries: [doublesEntry('MD-U13', ['P1', 'P2', 'P3', 'P4'])] }],
      ['XD-U13', { entries: [doublesEntry('XD-U13', ['P1', 'P5', 'P6', 'P7'])] }],
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
    const roster = new Map<string, RosterDraw>([
      ['WD-U17', { entries: [doublesEntry('WD-U17', ['A', 'B', 'C', 'D'])] }],
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

  // YONEX-SINGHA-BAT-BTY 2026 regression: GD U9 lists as 3 draws on the BAT
  // sport/draws page ("GD U9", "GD U9 - Group A", "GD U9 - Group B") but is
  // 1 event. The roster path stamps eventName on each RosterDraw via
  // detectGroupedDraws — buildKpis/buildEvents must read it instead of the
  // raw draw name, otherwise the headline events count inflates.
  it('roster path collapses grouped draws via eventName', () => {
    const mk = (draw: string, eventName: string, p1: string, p2: string): MatchEntry => ({
      draw, drawNum: '', round: '',
      team1: [{ name: p1, playerId: p1 }], team2: [{ name: p2, playerId: p2 }],
      winner: null, scores: [], court: '',
      walkover: false, retired: false, nowPlaying: false, eventName,
    })
    const roster = new Map<string, RosterDraw>([
      ['GD U9', { eventName: 'GD U9', entries: [mk('GD U9', 'GD U9', 'a', 'b')] }],
      ['GD U9 - Group A', { eventName: 'GD U9', entries: [] }],
      ['GD U9 - Group B', { eventName: 'GD U9', entries: [] }],
      ['MS', { eventName: 'MS', entries: [mk('MS', 'MS', 'x', 'y')] }],
    ])
    const s = aggregate({ days: [] } as unknown as MatchesData, new Map(), {}, roster)
    expect(s.kpis.events).toBe(2)
    expect(s.kpis.draws).toBe(4)
    expect(s.events.map((e) => e.name).sort()).toEqual(['GD U9', 'MS'])
  })
})

// ─── Pre-match builders ──────────────────────────────────────
import type { TournamentOverview } from '@/lib/types'

function fakeRosterEntry(eventName: string, playerIds: string[]): MatchEntry {
  return {
    draw: eventName, drawNum: '', round: 'R32',
    team1: playerIds.map((id) => ({ name: id, playerId: id })),
    team2: [], winner: null, scores: [], court: '',
    walkover: false, retired: false, nowPlaying: false,
    eventName,
  }
}

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

describe('kpis draws', () => {
  test('counts draws (number of rosterByDraw keys, raw — not collapsed by eventName)', () => {
    const data = { days: [] } as unknown as MatchesData
    const roster = new Map<string, RosterDraw>([
      ['1', { entries: [fakeRosterEntry('MS', ['a']), fakeRosterEntry('MS', ['b'])] }],
      ['2', { entries: [fakeRosterEntry('MD', ['a', 'c'])] }],
      ['3', { entries: [fakeRosterEntry('WS', ['d'])] }],
    ])
    const stats = aggregate(data, new Map(), {}, roster, {})
    expect(stats.kpis.draws).toBe(3)
  })

  test('draws is zero when rosterByDraw is undefined', () => {
    const data = { days: [] } as unknown as MatchesData
    const stats = aggregate(data, new Map(), {}, undefined, {})
    expect(stats.kpis.draws).toBe(0)
  })
})

import type { DrawInfo } from '@/lib/types'

describe('events pre-match decoration', () => {
  test('decorates with size, type, entries, topSeed when draws+overview present', () => {
    const data = { days: [] } as unknown as MatchesData
    // rosterByDraw is keyed by draw NAME (matches production: roster.set(d.name, ...))
    const roster = new Map<string, RosterDraw>([
      ['MS', { entries: [fakeRosterEntry('MS', ['p1']), fakeRosterEntry('MS', ['p2']), fakeRosterEntry('MS', ['p3'])] }],
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
    const roster = new Map<string, RosterDraw>([
      ['U17 MS', { entries: [fakeRosterEntry('U17 MS', ['x'])] }],
    ])
    const draws: DrawInfo[] = [{ drawNum: '11', name: 'U17 MS', size: '8', type: 'Round Robin', eventName: 'U17 MS' }]
    const stats = aggregate(data, new Map(), {}, roster, {}, { draws })
    expect(stats.events[0]).toEqual(expect.objectContaining({ type: 'RR+PO', size: 8 }))
  })

  test('leaves pre-match fields undefined when draws not provided', () => {
    const data = { days: [] } as unknown as MatchesData
    const roster = new Map<string, RosterDraw>([
      ['WS', { entries: [fakeRosterEntry('WS', ['w1'])] }],
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
    expect(buildDefendingChampion(undefined, undefined)).toEqual([])
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
    const out = buildDefendingChampion(winners, overview)
    expect(out).toEqual([
      { event: 'MS', players: ['p1'], club: 'A', priorEditionId: 'PRI', priorEditionLabel: 'Prior' },
      { event: 'MD', players: ['p2', 'p3'], priorEditionId: 'PRI', priorEditionLabel: 'Prior' },
    ])
  })

  test('skips events that didn’t exist in the prior edition', () => {
    const overview: TournamentOverview = { notes: [], seedEvents: [{ eventName: 'NEW', seeds: [] }] }
    const winners: PriorEditionWinnerMap = new Map([['OLD', { players: ['x'], priorEditionId: 'P', priorEditionLabel: 'Prior' }]])
    expect(buildDefendingChampion(winners, overview)).toEqual([])
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

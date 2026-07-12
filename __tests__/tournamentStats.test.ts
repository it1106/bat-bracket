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

// BWF international tournaments (e.g. YONEX Sunraise) carry no club affiliations
// — every player is tagged with a country code instead. The medal table must
// fall back to that country the way top-players/rosters already do, otherwise
// every medalist is grouped under '—' and filtered out, hiding the table.
describe('tournamentStats — medals fall back to country for BWF', () => {
  const data: MatchesData = {
    days: [{ date: '20260519', label: '19/05', dateIso: '2026-05-19', hasMatches: true }],
    currentDate: '20260519',
    groups: [],
  }
  type P = { c: string; id: string }
  const pl = (p: P) => ({ name: p.id, playerId: p.id, country: p.c })
  const sgl = (round: string, t1: P, t2: P, winner: 1 | 2): MatchEntry => ({
    draw: 'MS', drawNum: '1', round,
    team1: [pl(t1)], team2: [pl(t2)],
    winner,
    scores: [{ t1: 21, t2: 15 }, { t1: 21, t2: 18 }],
    court: 'Court 1', walkover: false, retired: false, nowPlaying: false,
  })
  const THA = (id: string): P => ({ c: 'THA', id })
  const INA = (id: string): P => ({ c: 'INA', id })
  const MAS = (id: string): P => ({ c: 'MAS', id })
  const JPN = (id: string): P => ({ c: 'JPN', id })
  const dayGroups: MatchScheduleGroup[] = [{
    type: 'time' as const,
    time: '09:00',
    matches: [
      sgl('Semi final', THA('t1'), MAS('m1'), 1),
      sgl('Semi final', INA('i1'), JPN('j1'), 1),
      sgl('Final', THA('t1'), INA('i1'), 1),
    ],
  }]
  const days = new Map([['2026-05-19', dayGroups]])

  it('groups medals by country when the clubs map is empty', () => {
    const s = aggregate(data, days, {})
    const byCountry = Object.fromEntries(s.clubMedals.map((m) => [m.club, m]))
    expect(byCountry['THA']?.gold).toBe(1)
    expect(byCountry['INA']?.silver).toBe(1)
    expect(byCountry['MAS']?.bronze).toBe(1)
    expect(byCountry['JPN']?.bronze).toBe(1)
    // No medalist should be dropped under the '—' placeholder.
    expect(s.clubMedals.some((m) => m.club === '—')).toBe(false)
  })
})

// Badminton awards two bronzes per event (both losing semifinalists). When one
// country sweeps both, the panel's "medals" mode must still count two — it dedups
// by team, not event. Regression for the Yonex Sunrise "19 instead of 28" bug.
describe('tournamentStats — bronze medalists carry distinct team keys', () => {
  const data: MatchesData = {
    days: [{ date: '20260519', label: '19/05', dateIso: '2026-05-19', hasMatches: true }],
    currentDate: '20260519',
    groups: [],
  }
  type P = { c: string; id: string }
  const pl = (p: P) => ({ name: p.id, playerId: p.id, country: p.c })
  const dbl = (round: string, t1: [P, P], t2: [P, P], winner: 1 | 2): MatchEntry => ({
    draw: 'MD', drawNum: '1', round,
    team1: t1.map(pl), team2: t2.map(pl),
    winner,
    scores: [{ t1: 21, t2: 15 }, { t1: 21, t2: 18 }],
    court: 'Court 1', walkover: false, retired: false, nowPlaying: false,
  })
  const THA = (id: string): P => ({ c: 'THA', id })
  const INA = (id: string): P => ({ c: 'INA', id })
  const MAS = (id: string): P => ({ c: 'MAS', id })
  // One doubles event: THA beats INA-pair-A in one semi, MAS beats INA-pair-B in
  // the other → INA takes both bronzes with two distinct pairs.
  const dayGroups: MatchScheduleGroup[] = [{
    type: 'time' as const,
    time: '09:00',
    matches: [
      dbl('Semi final', [THA('t1'), THA('t2')], [INA('a1'), INA('a2')], 1),
      dbl('Semi final', [MAS('m1'), MAS('m2')], [INA('b1'), INA('b2')], 1),
      dbl('Final', [THA('t1'), THA('t2')], [MAS('m1'), MAS('m2')], 1),
    ],
  }]
  const days = new Map([['2026-05-19', dayGroups]])

  it('gives INA two distinct bronze team keys in one event; a pair shares one key', () => {
    const s = aggregate(data, days, {})
    const ina = s.clubMedals.find((m) => m.club === 'INA')!
    // Raw server count: 4 medalists (two pairs of two players).
    expect(ina.bronze).toBe(4)
    // Each doubles pair shares one team key → two distinct team keys total.
    const teamKeys = new Set(ina.bronzeMedalists.map((m) => m.team))
    expect(teamKeys.size).toBe(2)
    // Deduping by event alone would wrongly collapse the sweep to one.
    expect(new Set(ina.bronzeMedalists.map((m) => m.event)).size).toBe(1)
    // Every pair's two players carry the same key.
    for (const m of ina.bronzeMedalists) {
      const mate = ina.bronzeMedalists.find((x) => x.team === m.team && x.playerId !== m.playerId)
      expect(mate).toBeDefined()
    }
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

  it('exposes an empty eventBreakdown when there are no matches', () => {
    const empty = JSON.parse(
      fs.readFileSync(path.join(FIX, 'stats-empty.json'), 'utf8'),
    ) as MatchesData
    const s = aggregate(empty, new Map(), {})
    expect(s.eventBreakdown).toEqual({ events: [], columns: [], columnsByEvent: {}, counts: {} })
  })
})

// BWF international tournaments tag every player with a country code. The
// country head-to-head matrix aggregates decided cross-country matches into a
// symmetric grid: cells[A][B] is A's record vs B. Mixed-nationality pairs and
// same-country (diagonal) matches are excluded.
describe('tournamentStats — country head-to-head matrix', () => {
  type P = { c: string; id: string }
  const pl = (p: P) => ({ name: p.id, playerId: p.id, country: p.c })
  const match = (
    t1: P[],
    t2: P[],
    winner: 1 | 2,
    opts: { walkover?: boolean; retired?: boolean; draw?: string } = {},
  ): MatchEntry => ({
    draw: opts.draw ?? (t1.length > 1 ? 'MD' : 'MS'), drawNum: '1', round: 'R16',
    team1: t1.map(pl), team2: t2.map(pl),
    winner,
    scores: opts.walkover ? [] : [{ t1: 21, t2: 15 }, { t1: 21, t2: 18 }],
    court: 'Court 1',
    walkover: !!opts.walkover, retired: !!opts.retired, nowPlaying: false,
  })

  const THA = (id: string): P => ({ c: 'THA', id })
  const INA = (id: string): P => ({ c: 'INA', id })
  const MAS = (id: string): P => ({ c: 'MAS', id })

  function build(matches: MatchEntry[]) {
    const data: MatchesData = {
      days: [{ date: '20260519', label: '19/05', dateIso: '2026-05-19', hasMatches: true }],
      currentDate: '20260519',
      groups: [],
    }
    const days = new Map<string, MatchScheduleGroup[]>([
      ['2026-05-19', [{ type: 'time', time: '09:00', matches }]],
    ])
    return aggregate(data, days, {})
  }

  const stats = build([
    match([THA('t1')], [INA('i1')], 1),                 // THA beats INA (singles)
    match([THA('t2')], [INA('i2')], 2),                 // INA beats THA (singles)
    match([THA('t3'), THA('t4')], [MAS('m1'), MAS('m2')], 1), // THA beats MAS (doubles)
    match([THA('t5'), INA('i3')], [MAS('m3'), MAS('m4')], 1),  // mixed-nationality side → skip
    match([THA('t6')], [THA('t7')], 1),                 // same country (diagonal) → skip
    match([THA('t8')], [INA('i4')], 1, { walkover: true }),    // walkover → excluded
    match([MAS('m5')], [INA('i5')], 1, { retired: true }),     // retired → counted
  ])

  it('credits winner/loser countries symmetrically (mirror)', () => {
    const m = stats.countryMatrix!
    expect(m.cells.THA.INA).toEqual({ w: 1, l: 1 })
    expect(m.cells.INA.THA).toEqual({ w: 1, l: 1 })
  })

  it('excludes mixed-nationality pairs and walkovers', () => {
    // THA vs MAS is only the one doubles win; the mixed THA/INA match is skipped.
    expect(stats.countryMatrix!.cells.THA.MAS).toEqual({ w: 1, l: 0 })
    expect(stats.countryMatrix!.cells.MAS.THA).toEqual({ w: 0, l: 1 })
  })

  it('counts retired matches (they have a winner)', () => {
    expect(stats.countryMatrix!.cells.MAS.INA).toEqual({ w: 1, l: 0 })
    expect(stats.countryMatrix!.cells.INA.MAS).toEqual({ w: 0, l: 1 })
  })

  it('never records the diagonal (same country)', () => {
    expect(stats.countryMatrix!.cells.THA?.THA).toBeUndefined()
  })

  it('orders the axis by total matches desc, then code asc', () => {
    // THA:3, INA:3, MAS:2 → tie broken alphabetically (INA before THA).
    expect(stats.countryMatrix!.countries).toEqual(['INA', 'THA', 'MAS'])
  })

  it('is undefined when fewer than two countries have cross-country matches', () => {
    const s = build([match([THA('a')], [THA('b')], 1)]) // only a diagonal match
    expect(s.countryMatrix).toBeUndefined()
  })

  it('is undefined for club-based tournaments (no country codes)', () => {
    const { data, days, clubs } = loadSprc()
    expect(aggregate(data, days, clubs).countryMatrix).toBeUndefined()
  })

  // Per-(age, gender, event) leaf buckets: the matrix carries one sub-matrix per
  // (age band, gender, event) so the UI can filter by each axis independently,
  // merging the matching buckets. Age from "U<n>"; event from the draw (X*=mixed,
  // else 2nd letter S=singles / D=doubles); gender from the first letter
  // (B/M=male, G/W=female). Mixed (XD) has no gender. The top-level matrix stays
  // the all aggregate (default view).
  describe('leaf buckets (age × gender × event)', () => {
    const grouped = build([
      match([THA('a1')], [INA('b1')], 1, { draw: 'BS U17' }),                       // U17 male singles:   THA>INA
      match([THA('a2'), THA('a2b')], [MAS('c1'), MAS('c1b')], 1, { draw: 'BD U17' }), // U17 male doubles:   THA>MAS
      match([INA('b2')], [MAS('c2')], 1, { draw: 'WS-U19' }),                        // U19 female singles: INA>MAS
      match([INA('b3'), INA('b3b')], [THA('a3'), THA('a3b')], 1, { draw: 'XD-U19' }), // U19 mixed (genderless): INA>THA
    ])
    const byKey = (ag: string, ev: string, g?: string) =>
      grouped.countryMatrix!.buckets!.find((b) => b.ageGroup === ag && b.event === ev && b.gender === g)!

    it('exposes one bucket per leaf; mixed carries no gender', () => {
      expect(grouped.countryMatrix!.buckets!.map((b) => `${b.ageGroup}/${b.gender ?? '-'}/${b.event}`)).toEqual([
        'U19/female/singles', 'U19/-/mixed', 'U17/male/singles', 'U17/male/doubles',
      ])
    })

    it('each bucket holds only its own (age, gender, event) matches', () => {
      expect(byKey('U17', 'singles', 'male').cells.THA.INA).toEqual({ w: 1, l: 0 })
      expect(byKey('U17', 'doubles', 'male').cells.THA.MAS).toEqual({ w: 1, l: 0 })
      expect(byKey('U19', 'singles', 'female').cells.INA.MAS).toEqual({ w: 1, l: 0 })
      expect(byKey('U19', 'mixed', undefined).cells.INA.THA).toEqual({ w: 1, l: 0 })
    })

    it('keeps the top-level matrix as the all aggregate', () => {
      // THA vs INA across all buckets: 1 win (U17 male singles) and 1 loss (U19 mixed).
      expect(grouped.countryMatrix!.cells.THA.INA).toEqual({ w: 1, l: 1 })
    })

    it('omits buckets when there is only one leaf (no filter choice)', () => {
      const single = build([
        match([THA('a')], [INA('b')], 1, { draw: 'BS U17' }),
        match([THA('c')], [MAS('d')], 1, { draw: 'BS U17' }), // same leaf: U17 male singles
      ])
      expect(single.countryMatrix!.buckets).toBeUndefined()
    })

    it('emits a flat cross-country match list tagged for the cell modal', () => {
      const ms = grouped.countryMatrix!.matches!
      expect(ms).toHaveLength(4) // all 4 fixture matches are cross-country & decided
      const bs = ms.find((m) => m.draw === 'BS U17')!
      expect(bs.country1).toBe('THA')
      expect(bs.country2).toBe('INA')
      expect(bs.team1).toEqual(['a1'])
      expect(bs.team2).toEqual(['b1'])
      expect(bs.winnerSide).toBe(1)
      expect(bs.scores.length).toBeGreaterThan(0)
      expect(bs.ageGroup).toBe('U17')
      expect(bs.gender).toBe('male')
      expect(bs.discipline).toBe('singles')
      // Mixed carries no gender and discipline 'mixed'.
      const xd = ms.find((m) => m.draw === 'XD-U19')!
      expect(xd.gender).toBeUndefined()
      expect(xd.discipline).toBe('mixed')
    })
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

// Regression: the BWF live day feed emits ABBREVIATED round codes ("QF", "SF",
// "F") for the knockout stage, whereas earlier rounds arrive as "R64"/"R32"/
// "R16". Player status (active / eliminated / medaled) classifies by round, so
// if the parser only understands "R{n}" and long forms, a QF/SF/F result never
// updates a player's status — they stay wrongly "active" while the h2h matrix
// (round-agnostic) already reflects the result. Status must react to the
// abbreviated codes exactly as it does to the long forms.
describe('tournamentStats — abbreviated knockout round codes update player status', () => {
  const pl = (id: string) => ({ name: id, playerId: id, country: id.startsWith('T') ? 'THA' : 'INA' })
  const m = (round: string, w: string, l: string, winner: 1 | 2): MatchEntry => ({
    draw: 'BS U17', drawNum: '1', round,
    team1: [pl(winner === 1 ? w : l)],
    team2: [pl(winner === 1 ? l : w)],
    winner,
    scores: [{ t1: 21, t2: 15 }, { t1: 21, t2: 18 }],
    court: 'Court 1', walkover: false, retired: false, nowPlaying: false,
  })
  const data: MatchesData = {
    days: [{ date: '20260711', label: '11/07', dateIso: '2026-07-11', hasMatches: true }],
    currentDate: '20260711',
    groups: [],
  }
  // T1 runs the table: beats I2 in QF, I3 in SF, I4 in F.
  const days = new Map<string, MatchScheduleGroup[]>([
    ['2026-07-11', [{ type: 'time', time: '09:00', matches: [
      m('QF', 'T1', 'I2', 1),
      m('SF', 'T1', 'I3', 1),
      m('F', 'T1', 'I4', 1),
    ] }]],
  ])
  const statusOf = (id: string): string | undefined => {
    const s = aggregate(data, days, {})
    for (const c of s.countryRosters ?? []) {
      const member = c.roster.find((r) => r.playerId === id)
      if (member) return member.statusByEvent?.['BS U17']
    }
    return undefined
  }

  it('marks a QF loser as eliminated (out), not active (in)', () => {
    expect(statusOf('I2')).toBe('out')
  })
  it('marks an SF loser with bronze', () => {
    expect(statusOf('I3')).toBe('bronze')
  })
  it('marks the Final winner gold and loser silver', () => {
    expect(statusOf('T1')).toBe('gold')
    expect(statusOf('I4')).toBe('silver')
  })
})

describe('tournamentStats — event breakdown', () => {
  const data: MatchesData = {
    days: [{ date: '20260519', label: '19/05', dateIso: '2026-05-19', hasMatches: true }],
    currentDate: '20260519',
    groups: [],
  }
  type P = { c: string; id: string }
  const pl = (p: P) => ({ name: p.id, playerId: p.id, country: p.c })
  const THA = (id: string): P => ({ c: 'THA', id })
  const INA = (id: string): P => ({ c: 'INA', id })
  const MAS = (id: string): P => ({ c: 'MAS', id })
  const JPN = (id: string): P => ({ c: 'JPN', id })
  const KOR = (id: string): P => ({ c: 'KOR', id })
  const CHN = (id: string): P => ({ c: 'CHN', id })
  // draw, round, team1, team2, winner (null = pending)
  const M = (draw: string, round: string, t1: P[], t2: P[], winner: 1 | 2 | null): MatchEntry => ({
    draw, drawNum: '1', round,
    team1: t1.map(pl), team2: t2.map(pl),
    winner,
    scores: winner === null ? [] : [{ t1: 21, t2: 15 }, { t1: 21, t2: 18 }],
    court: 'C1', walkover: false, retired: false, nowPlaying: false,
  })
  const dayGroups: MatchScheduleGroup[] = [{
    type: 'time' as const, time: '09:00',
    matches: [
      // MS singles, 4-draw: THA champion, MAS runner-up, INA two SF losers.
      M('MS', 'Semi final', [THA('t1')], [INA('i1')], 1),
      M('MS', 'Semi final', [MAS('m1')], [INA('i2')], 1),
      M('MS', 'Final', [THA('t1')], [MAS('m1')], 1),
      // MD doubles, 4-draw: THA pair champion, MAS pair runner-up, INA two SF pairs.
      M('MD', 'Semi final', [THA('t1'), THA('t2')], [INA('a1'), INA('a2')], 1),
      M('MD', 'Semi final', [MAS('m1'), MAS('m2')], [INA('b1'), INA('b2')], 1),
      M('MD', 'Final', [THA('t1'), THA('t2')], [MAS('m1'), MAS('m2')], 1),
      // WS singles, 4-draw, IN PROGRESS: SF1 done, SF2 pending, no final yet.
      M('WS', 'Semi final', [THA('w1')], [JPN('j1')], 1),   // THA won SF -> active in F
      M('WS', 'Semi final', [KOR('k1')], [CHN('c1')], null), // both active in SF
      // BS singles, deeper draw: a single QF result to introduce a QF column.
      M('BS', 'Quarter final', [THA('b1')], [INA('x1')], 1), // b1 active in SF, x1 out at QF
    ],
  }]
  const days = new Map([['2026-05-19', dayGroups]])
  const eb = () => aggregate(data, days, {}).eventBreakdown!

  it('buckets singles: champion, runner-up, SF losers per country', () => {
    const c = eb().counts['MS']
    expect(c['THA']['Champion']).toEqual({ done: 1, active: 0 })
    expect(c['MAS']['F']).toEqual({ done: 1, active: 0 })
    expect(c['INA']['SF']).toEqual({ done: 2, active: 0 })
  })

  it('counts a doubles pair as one team (dedup)', () => {
    const c = eb().counts['MD']
    expect(c['THA']['Champion']).toEqual({ done: 1, active: 0 })
    expect(c['MAS']['F']).toEqual({ done: 1, active: 0 })
    expect(c['INA']['SF']).toEqual({ done: 2, active: 0 }) // two pairs, not four players
  })

  it('places active teams in their current round as active (green)', () => {
    const c = eb().counts['WS']
    expect(c['THA']['F']).toEqual({ done: 0, active: 1 }) // won SF -> active in Final
    expect(c['JPN']['SF']).toEqual({ done: 1, active: 0 }) // lost SF
    expect(c['KOR']['SF']).toEqual({ done: 0, active: 1 }) // pending SF
    expect(c['CHN']['SF']).toEqual({ done: 0, active: 1 })
  })

  it('produces dynamic, ordered column unions', () => {
    const r = eb()
    // BS introduces QF; overall union ordered first-round -> title.
    expect(r.columns).toEqual(['QF', 'SF', 'F', 'Champion'])
    // MS (4-draw) omits QF.
    expect(r.columnsByEvent['MS']).toEqual(['SF', 'F', 'Champion'])
    expect(r.columnsByEvent['BS']).toEqual(['QF', 'SF'])
  })

  it('lists events ordered by event rank with labels', () => {
    const evs = eb().events.map((e) => e.key)
    expect(evs).toEqual(['MS', 'WS', 'MD', 'BS']) // OPEN_ORDER MS,WS,MD… then unknown BS last
    expect(eb().events[0]).toEqual({ key: 'MS', label: 'MS' })
  })
})

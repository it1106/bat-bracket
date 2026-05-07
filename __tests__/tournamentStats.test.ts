import fs from 'fs'
import path from 'path'
import { aggregate } from '@/lib/tournamentStats'
import type { MatchesData, MatchScheduleGroup } from '@/lib/types'

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
    expect(s.clubMedals.length).toBeLessThanOrEqual(10)
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

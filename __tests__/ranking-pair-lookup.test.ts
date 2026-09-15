import {
  entryIncludesPlayer, partnersIn, entriesForPlayer, entryForPairing, bestEntryForPlayer,
} from '@/lib/ranking/pair-lookup'
import { parseCategoryPage } from '@/lib/ranking/scraper'
import type { Ranking, RankingEntry, RankingEvent } from '@/lib/types'

// The real shape of BD U15: สุวิจักขณ์ มีชัย is the SECOND name at #26 (with
// รวิณ ชูชัยศรี, 9,909) and the FIRST at #48 (with กานตพนธ์ มีสุข, 6,810).
const SUWI = { name: 'สุวิจักขณ์ มีชัย', slug: 'suwi', globalPlayerId: '9688498' }
const RAWIN = { name: 'รวิณ ชูชัยศรี', slug: 'rawin', globalPlayerId: '9688686' }
const KAN = { name: 'กานตพนธ์ มีสุข', slug: 'kan', globalPlayerId: '9687606' }

const entry = (rank: number, points: number, players: typeof SUWI[]): RankingEntry => ({
  rank, points, tournaments: 2, name: players[0].name, slug: players[0].slug,
  club: 'C', globalPlayerId: players[0].globalPlayerId, players,
})
const md: RankingEvent = {
  eventCode: 'U15_MD', eventName: 'U15 Boys doubles',
  entries: [entry(26, 9909, [RAWIN, SUWI]), entry(48, 6810, [SUWI, KAN])],
} as RankingEvent
const who = { slug: 'suwi' }

describe('entryIncludesPlayer', () => {
  it('matches a player listed second, not just the row identity', () => {
    expect(entryIncludesPlayer(md.entries[0], who)).toBe(true)
    // The bug it fixes: the entry's own slug is the first player's.
    expect(md.entries[0].slug).not.toBe('suwi')
  })

  it('matches on globalPlayerId when the slug differs', () => {
    expect(entryIncludesPlayer(md.entries[0], { slug: 'other', globalPlayerId: '9688498' })).toBe(true)
  })

  it('matches on an alias slug', () => {
    expect(entryIncludesPlayer(md.entries[0], { slug: 'nope', aliasSlug: 'suwi' })).toBe(true)
  })

  it('does not match a player who is not on the row', () => {
    expect(entryIncludesPlayer(md.entries[0], { slug: 'kan' })).toBe(false)
  })

  it('treats a singles row with no players[] as its own one-member list', () => {
    const singles = { rank: 3, points: 100, tournaments: 1, name: 'S', slug: 'suwi', club: 'C' } as RankingEntry
    expect(entryIncludesPlayer(singles, who)).toBe(true)
    expect(partnersIn(singles, who)).toEqual([])
  })
})

describe('entriesForPlayer', () => {
  it('returns every pairing, best rank first', () => {
    expect(entriesForPlayer(md, who).map(e => e.rank)).toEqual([26, 48])
  })

  it('gives the summary the best rank and ITS points, not another pairing\'s', () => {
    const best = bestEntryForPlayer({ events: [md] } as Ranking, 'U15 Boys doubles', who)
    expect(best).toMatchObject({ rank: 26, points: 9909 })
    expect(partnersIn(best!, who)).toEqual(['รวิณ ชูชัยศรี'])
  })
})

describe('entryForPairing', () => {
  it('resolves each pairing to its own rank', () => {
    expect(entryForPairing(md, who, 'รวิณ ชูชัยศรี')?.rank).toBe(26)
    expect(entryForPairing(md, who, 'กานตพนธ์ มีสุข')?.rank).toBe(48)
  })

  it('tolerates a seed marker on the partner name', () => {
    expect(entryForPairing(md, who, 'รวิณ ชูชัยศรี [4]')?.rank).toBe(26)
  })

  it('returns null for a pairing that is not ranked, rather than a wrong rank', () => {
    expect(entryForPairing(md, who, 'ไม่มี คนนี้')).toBeNull()
  })

  it('asked for singles, matches only a row that names nobody else', () => {
    expect(entryForPairing(md, who, null)).toBeNull()
  })
})

describe('club parsing from a real ranking row', () => {
  const row = (rank: number, clubCell: string) => `
    <tr><td class="rank"><div>${rank}</div></td>
    <td><p><a href="player.aspx?id=1&player=11">A</a></p><p><a href="player.aspx?id=1&player=22">B</a></p></td>
    <td class="right rankingpoints">9909</td><td class="right">2</td>
    <td>${clubCell}</td></tr>`

  it('keeps both clubs when the pairing spans two, in player order', () => {
    const [e] = parseCategoryPage(row(26,
      '<a href="category.aspx?ogid=1">เกษมศักดิ์ Badminton Academy</a><br/><a href="category.aspx?ogid=2">BOY\'S CLUB</a>'))
    expect(e.clubs).toEqual(['เกษมศักดิ์ Badminton Academy', "BOY'S CLUB"])
    // The entry's own club is the FIRST player's — it used to be the last link,
    // i.e. the partner's.
    expect(e.club).toBe('เกษมศักดิ์ Badminton Academy')
  })

  it('leaves clubs unset when the pairing shares one club', () => {
    const [e] = parseCategoryPage(row(1, '<a href="category.aspx?ogid=3">บ้านทองหยอด</a>'))
    expect(e.clubs).toBeUndefined()
    expect(e.club).toBe('บ้านทองหยอด')
  })

  it('falls back to the cell text when it carries no link', () => {
    const [e] = parseCategoryPage(row(9, 'Unaffiliated'))
    expect(e.club).toBe('Unaffiliated')
    expect(e.clubs).toBeUndefined()
  })
})

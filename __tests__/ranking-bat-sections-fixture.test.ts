import fs from 'fs'
import path from 'path'
import { parseRankingPlayerPage } from '@/lib/ranking/player-scraper'
import { rankingSectionsForTab, uncreditedRowsForTab } from '@/lib/ranking/player-view'
import type { RankingPlayerDetail } from '@/lib/types'

// Live capture of https://bat.tournamentsoftware.com/ranking/player.aspx
// ?id=53559&player=9688686 (Junior series, 1/9/2569 publication). BAT stopped
// pooling age groups: this player is ranked 12th in U15 Boys singles on 30245
// pts and 306th in U17 Boys singles on 2684 — two separate lists. Pooling the
// discipline into one top-10 produced 30782 (= 30245 - 2147 + 2684), the bug
// this fixture exists to pin.
const html = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'ranking-player-bat-ravin.html'),
  'utf8',
)

function detailFromFixture(): RankingPlayerDetail {
  const { tournaments } = parseRankingPlayerPage(html)
  return { globalPlayerId: '9688686', publishDate: '1/9/2569', scrapedAt: 'x', tournaments }
}

describe("รวิณ ชูชัยศรี's BAT sections (real fixture)", () => {
  it('keeps U15 and U17 singles in separate sections with upstream totals', () => {
    const sections = rankingSectionsForTab(detailFromFixture(), 'singles')
    expect(sections.map(s => s.eventName)).toEqual(['U17 Boys singles', 'U15 Boys singles'])
    expect(sections[0].topTotal).toBe(2684)
    expect(sections[1].topTotal).toBe(30245)
  })

  it('never lets the U17 row leak into the U15 total', () => {
    const u15 = rankingSectionsForTab(detailFromFixture(), 'singles')
      .find(s => s.eventName === 'U15 Boys singles')!
    expect(u15.top).toHaveLength(9)
    expect(u15.top.every(sr => sr.row.sourceEvent === 'BS U15')).toBe(true)
    expect(u15.topTotal).not.toBe(30782)
  })

  it('splits one doubles event per pairing, matching each ranking entry', () => {
    const sections = rankingSectionsForTab(detailFromFixture(), 'doubles')
    const u15 = sections.filter(s => s.eventName === 'U15 Boys doubles')
    // Upstream's own summary table lists two U15 Boys doubles entries:
    // 9909 with สุวิจักขณ์ มีชัย and 8598 with ภาคิน ม่านมุงศิลป์. Its
    // per-event block pools them into a single 18507, which matches neither.
    expect(u15.map(s => s.topTotal)).toEqual([9909, 8598])
    expect(u15.map(s => s.doublesPartner)).toEqual(['สุวิจักขณ์ มีชัย', 'ภาคิน ม่านมุงศิลป์'])
  })

  it('suppresses the rank badge on a split doubles event only', () => {
    const doubles = rankingSectionsForTab(detailFromFixture(), 'doubles')
    expect(doubles.filter(s => s.eventName === 'U15 Boys doubles')
      .every(s => s.rankAmbiguous)).toBe(true)
    const singles = rankingSectionsForTab(detailFromFixture(), 'singles')
    expect(singles.every(s => s.rankAmbiguous)).toBe(false)
  })

  it('mixed tab carries the single XD pairing', () => {
    const mixed = rankingSectionsForTab(detailFromFixture(), 'mixed')
    expect(mixed).toHaveLength(1)
    expect(mixed[0].eventName).toBe('U15 Mixed doubles')
    expect(mixed[0].topTotal).toBe(1718)
    expect(mixed[0].rankAmbiguous).toBe(false)
  })

  it('surfaces the aged-out U13 doubles row as uncredited rather than dropping it', () => {
    const d = detailFromFixture()
    expect(rankingSectionsForTab(d, 'doubles')
      .some(s => s.eventName.includes('U13'))).toBe(false)
    const uncredited = uncreditedRowsForTab(d, 'doubles')
    expect(uncredited.map(r => r.sourceEvent)).toEqual(['BD U13'])
    expect(uncredited[0].points).toBe(2147)
  })
})

describe('BAT doubles row parsing', () => {
  it('reads the Used-for marker past the Doubles partner column', () => {
    const { tournaments } = parseRankingPlayerPage(html)
    const bd = tournaments.filter(r => r.sourceEvent === 'BD U15')
    expect(bd).toHaveLength(4)
    // The marker sits in the 8th cell on doubles rows, the 7th on singles —
    // a fixed index read every one of these as counting toward nothing.
    expect(bd.every(r => r.countsTowardRankings.includes('U15 Boys doubles'))).toBe(true)
    expect(bd.every(r => (r.doublesPartner ?? '').length > 0)).toBe(true)
  })

  it('leaves singles rows without a partner', () => {
    const { tournaments } = parseRankingPlayerPage(html)
    const bs = tournaments.filter(r => r.sourceEvent.startsWith('BS'))
    expect(bs.length).toBeGreaterThan(0)
    expect(bs.every(r => r.doublesPartner === undefined)).toBe(true)
  })
})

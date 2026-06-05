import fs from 'fs'
import path from 'path'
import { parseRankingPlayerPage } from '@/lib/ranking/player-scraper'
import { bwfSectionsForTab } from '@/lib/ranking/player-view'
import type { RankingPlayerDetail } from '@/lib/types'

const html = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'ranking-player-bwf-ravin.html'),
  'utf8',
)

function detailFromFixture(): RankingPlayerDetail {
  const { tournaments } = parseRankingPlayerPage(html)
  return { globalPlayerId: '5799633', publishDate: '03/06/2026', scrapedAt: 'x', tournaments }
}

describe("Ravin CHUCHAISRI's BWF sections (real fixture)", () => {
  it("Singles tab has a Boy's singles U15 section totalling 1598 pts", () => {
    const sections = bwfSectionsForTab(detailFromFixture(), 'singles')
    const u15 = sections.find((s) => s.eventName === "Boy's singles U15")
    expect(u15).toBeDefined()
    // Math.round so float drift on 637.5 doesn't fail the assertion.
    expect(Math.round(u15!.topTotal)).toBe(1598)
  })

  it('The U13 row in the U15 section carries discounted credit 637.5', () => {
    const sections = bwfSectionsForTab(detailFromFixture(), 'singles')
    const u15 = sections.find((s) => s.eventName === "Boy's singles U15")!
    const u13Row = u15.top.find((sr) => sr.row.sourceEvent.includes('U13'))
    expect(u13Row).toBeDefined()
    expect(u13Row!.row.points).toBe(2125)
    expect(u13Row!.creditInThisSection).toBe(637.5)
  })

  it("Doubles tab has a Boy's doubles U15 section with the carry-over", () => {
    const sections = bwfSectionsForTab(detailFromFixture(), 'doubles')
    const u15 = sections.find((s) => s.eventName === "Boy's doubles U15")
    expect(u15).toBeDefined()
    // MD-U15 full 1750 + MD U13 discounted 525 = 2275.
    expect(Math.round(u15!.topTotal)).toBe(2275)
  })
})

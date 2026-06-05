import fs from 'fs'
import path from 'path'
import {
  parseRankingOverview,
  parseCategoryList,
  parseCategoryPage,
  parseRankingId,
  parsePublishDate,
  eventCodeFromName,
} from '@/lib/ranking/scraper'

const fix = (name: string) =>
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8')

describe('parseRankingOverview', () => {
  it('parses BAT overview (colspan=9, BE date)', () => {
    const html = `<html><body>
<h3>X <span class="rankingdate">(19/5/2569)</span></h3>
<table class="ruler">
  <tr><th colspan="9"><a href="category.aspx?id=51771&category=5694">U23 Men's singles</a></th>
      <th class="right"><a href="category.aspx?id=51771&category=5694">More</a></th></tr>
  <tr><td class="rank"><div>1</div></td><td>&nbsp;</td><td>&nbsp;</td>
      <td><a href="player.aspx?id=51771&player=2458898">PLAYER A</a></td>
      <td><a href="/player-profile/X" class="icon profile"></a></td>
      <td>1</td><td class="left">2008</td>
      <td class="right rankingpoints">146240</td>
      <td class="right">13</td>
      <td><a href="category.aspx?id=51771&category=5694&ogid=Z">Club A</a></td></tr>
</table></body></html>`
    const r = parseRankingOverview(html, 'thai-be', 'bat')
    expect(r.provider).toBe('bat')
    expect(r.publishDate).toBe('19/5/2569')
    expect(r.rankingId).toBe('51771')
    expect(r.events).toHaveLength(1)
    expect(r.events[0].eventName).toBe("U23 Men's singles")
    expect(r.events[0].entries[0].name).toBe('PLAYER A')
    expect(r.events[0].entries[0].points).toBe(146240)
    expect(r.events[0].entries[0].tournaments).toBe(13)
  })

  it('parses BWF overview (colspan=8, Gregorian date)', () => {
    const r = parseRankingOverview(fix('ranking-overview-bwf.html'), 'en-gb', 'bwf')
    expect(r.provider).toBe('bwf')
    expect(r.publishDate).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/)
    expect(r.rankingId).toBeTruthy()
    expect(r.events.length).toBeGreaterThan(5)
    expect(r.events[0].entries.length).toBeGreaterThan(0)
  })
})

describe('parseCategoryPage', () => {
  it('captures globalPlayerId from BWF rows', () => {
    const entries = parseCategoryPage(fix('ranking-category-bwf.html'))
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) {
      expect(e.globalPlayerId).toMatch(/^\d+$/)
    }
  })
})

describe('parseCategoryList', () => {
  it('returns BWF category list from overview <th> headers', () => {
    const cats = parseCategoryList(fix('ranking-overview-bwf.html'))
    expect(cats.length).toBeGreaterThan(5)
    expect(cats[0].id).toMatch(/^\d+$/)
    expect(cats[0].name.length).toBeGreaterThan(0)
  })
})

describe('eventCodeFromName', () => {
  it.each([
    ["U23 Men's singles", 'U23_MS'],
    ["Boy's singles U17", 'U17_MS'],
    ["Girls's doubles U15", 'U15_WD'],
    ['Mixed doubles U17',  'U17_MXD'],
  ])('%s → %s', (input, expected) => {
    expect(eventCodeFromName(input)).toBe(expected)
  })
})

describe('parsePublishDate', () => {
  it('reads BAT-style rankingdate span', () => {
    expect(parsePublishDate('<span class="rankingdate">(19/5/2569)</span>')).toBe('19/5/2569')
  })
  it('reads BWF-style rankingdate span', () => {
    expect(parsePublishDate('<span class="rankingdate">(03/06/2026)</span>')).toBe('03/06/2026')
  })
})

describe('parseRankingId', () => {
  it('finds id= on first category.aspx link', () => {
    expect(parseRankingId('<a href="category.aspx?id=51771&category=1">x</a>')).toBe('51771')
  })
})

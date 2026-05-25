import { parseBatRanking, parseCategoryList, parseCategoryPage, eventCodeFromName } from '@/lib/bat-ranking-scraper'

// Fixture matches the actual bat.tournamentsoftware.com/ranking/ranking.aspx?rid=188 structure.
// There is ONE <table class="ruler"> containing all events. Events are separated by
// <th colspan="9"><a href="category.aspx?...">EVENT NAME</a></th> header rows.
const SAMPLE_HTML = `
<html><body>
<h3>Badminton Thailand Junior Ranking <span class="rankingdate">(19/5/2569)</span></h3>
<table class="ruler">
<tr>
  <th colspan="9"><a href="category.aspx?id=51771&category=5694">U23 Men's singles</a></th>
  <th class="right"><a href="category.aspx?id=51771&category=5694">More</a></th>
</tr>
<tr>
  <td class="rank"><div style="">1</div></td>
  <td class="rank_equal" title="Previous rank: 1">&nbsp;</td>
  <td>&nbsp;</td>
  <td><img src="flag.svg" class="intext flag"/><a href="player.aspx?id=51771&player=2458898">ปาณชัย บุญมาก</a></td>
  <td><a href="/player-profile/D99D80E9" class="icon profile" title="Profile"></a></td>
  <td>93787405</td>
  <td class="left">2008&nbsp;</td>
  <td class="right rankingpoints">146240</td>
  <td class="right">13</td>
  <td><a href="category.aspx?id=51771&category=5694&ogid=271E">Vayu Badminton Club</a></td>
</tr>
<tr>
  <td class="rank"><div style="">2</div></td>
  <td class="rank_equal">&nbsp;</td>
  <td>&nbsp;</td>
  <td><img src="flag.svg" class="intext flag"/><a href="player.aspx?id=51771&player=2270490">ปัณณทัต เปรมพันธ์พงษ์</a></td>
  <td><a href="/player-profile/212F" class="icon profile" title="Profile"></a></td>
  <td>84730463</td>
  <td class="left">2009&nbsp;</td>
  <td class="right rankingpoints">129192</td>
  <td class="right">7</td>
  <td><a href="category.aspx?id=51771&category=5694&ogid=E251">บ้านทองหยอด</a></td>
</tr>
<tr>
  <th colspan="9"><a href="category.aspx?id=51771&category=5695">U23 Women's singles</a></th>
  <th class="right"><a href="category.aspx?id=51771&category=5695">More</a></th>
</tr>
<tr>
  <td class="rank"><div style="">1</div></td>
  <td class="rank_equal">&nbsp;</td>
  <td>&nbsp;</td>
  <td><img src="flag.svg" class="intext flag"/><a href="player.aspx?id=51771&player=9999">ญาดาริณ บุณยรัตน</a></td>
  <td><a href="/player-profile/AAA" class="icon profile" title="Profile"></a></td>
  <td>82069964</td>
  <td class="left">2016&nbsp;</td>
  <td class="right rankingpoints">6340</td>
  <td class="right">5</td>
  <td><a href="category.aspx?id=51771&category=2467">BOY'S CLUB</a></td>
</tr>
</table>
</body></html>
`

describe('parseBatRanking', () => {
  it('parses multiple events from a single ruler table with event-header rows', () => {
    const result = parseBatRanking(SAMPLE_HTML)
    expect(result.events.length).toBe(2)
    expect(result.events[0].eventName).toBe("U23 Men's singles")
    expect(result.events[1].eventName).toBe("U23 Women's singles")
  })

  it('parses rank correctly from class="rank" td', () => {
    const result = parseBatRanking(SAMPLE_HTML)
    expect(result.events[0].entries[0].rank).toBe(1)
    expect(result.events[0].entries[1].rank).toBe(2)
  })

  it('parses player name from the player.aspx link', () => {
    const result = parseBatRanking(SAMPLE_HTML)
    expect(result.events[0].entries[0].name).toBe('ปาณชัย บุญมาก')
    expect(result.events[0].entries[1].name).toBe('ปัณณทัต เปรมพันธ์พงษ์')
  })

  it('parses points from rankingpoints td', () => {
    const result = parseBatRanking(SAMPLE_HTML)
    expect(result.events[0].entries[0].points).toBe(146240)
    expect(result.events[1].entries[0].points).toBe(6340)
  })

  it('parses tournaments count (td between points and club)', () => {
    const result = parseBatRanking(SAMPLE_HTML)
    expect(result.events[0].entries[0].tournaments).toBe(13)
    expect(result.events[0].entries[1].tournaments).toBe(7)
    expect(result.events[1].entries[0].tournaments).toBe(5)
  })

  it('parses club from the last td link', () => {
    const result = parseBatRanking(SAMPLE_HTML)
    expect(result.events[0].entries[0].club).toBe('Vayu Badminton Club')
    expect(result.events[1].entries[0].club).toBe("BOY'S CLUB")
  })

  it('computes slug via nameToSlug', () => {
    const result = parseBatRanking(SAMPLE_HTML)
    expect(result.events[0].entries[0].slug).toBeTruthy()
    expect(result.events[0].entries[0].slug).toContain('_')
  })

  it('extracts publishDate from rankingdate span', () => {
    const result = parseBatRanking(SAMPLE_HTML)
    expect(result.publishDate).toBe('19/5/2569')
  })

  it('caps entries at 50 per event', () => {
    const rows = Array.from({ length: 60 }, (_, i) => `
<tr>
  <td class="rank"><div style="">${i + 1}</div></td>
  <td class="rank_equal">&nbsp;</td><td>&nbsp;</td>
  <td><a href="player.aspx?id=1&player=${i}">PLAYER ${i + 1}</a></td>
  <td></td><td></td><td class="left">2005&nbsp;</td>
  <td class="right rankingpoints">${1000 - i * 10}</td>
  <td class="right">5</td>
  <td><a href="cat.aspx">Club</a></td>
</tr>`).join('\n')
    const html = `<html><body>
<h3>Badminton Thailand Junior Ranking <span class="rankingdate">(1/1/2569)</span></h3>
<table class="ruler">
<tr><th colspan="9"><a href="cat.aspx">U19 Boys singles</a></th></tr>
${rows}
</table></body></html>`
    const result = parseBatRanking(html)
    expect(result.events[0].entries.length).toBe(50)
  })

  it('returns empty events array when no ruler table found', () => {
    const result = parseBatRanking('<html><body><p>No ranking data</p></body></html>')
    expect(result.events).toEqual([])
  })

  it('skips event sections with no rank rows', () => {
    const html = `<html><body>
<h3>Badminton Thailand Junior Ranking <span class="rankingdate">(1/1/2569)</span></h3>
<table class="ruler">
<tr><th colspan="9"><a href="cat.aspx">U19 Boys singles</a></th></tr>
<tr><td colspan="10">filter dropdown here</td></tr>
</table></body></html>`
    const result = parseBatRanking(html)
    expect(result.events).toEqual([])
  })
})

describe('parseCategoryList', () => {
  it('extracts category id and name pairs from overview page', () => {
    const result = parseCategoryList(SAMPLE_HTML)
    expect(result.length).toBe(2)
    expect(result[0]).toEqual({ id: '5694', name: "U23 Men's singles" })
    expect(result[1]).toEqual({ id: '5695', name: "U23 Women's singles" })
  })

  it('deduplicates category IDs (More links share same ID)', () => {
    const html = `<table>
<th colspan="9"><a href="category.aspx?id=1&category=99">U17 Boys singles</a></th>
<th class="right"><a href="category.aspx?id=1&category=99">More</a></th>
</table>`
    const result = parseCategoryList(html)
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('U17 Boys singles')
  })
})

describe('parseCategoryPage', () => {
  it('parses entries from a single-event category page', () => {
    const html = `<table class="ruler">
<tr>
  <th colspan="2">Rank</th><th>Player</th><th>Points</th>
</tr>
<tr>
  <td class="rank"><div style="">1</div></td><td>&nbsp;</td><td>&nbsp;</td>
  <td><a href="player.aspx?id=1&player=123">ปาณชัย บุญมาก</a></td>
  <td></td><td></td><td class="left">2008</td>
  <td class="right rankingpoints">146240</td><td>13</td>
  <td><a href="club.aspx">Vayu Badminton Club</a></td>
</tr>
</table>`
    const entries = parseCategoryPage(html)
    expect(entries.length).toBe(1)
    expect(entries[0].rank).toBe(1)
    expect(entries[0].name).toBe('ปาณชัย บุญมาก')
    expect(entries[0].points).toBe(146240)
  })
})

describe('eventCodeFromName', () => {
  it('distinguishes Men from Women (Women contains "Men")', () => {
    expect(eventCodeFromName("U23 Men's singles")).toBe('U23_MS')
    expect(eventCodeFromName("U23 Women's singles")).toBe('U23_WS')
    expect(eventCodeFromName("U23 Men's doubles")).toBe('U23_MD')
    expect(eventCodeFromName("U23 Women's doubles")).toBe('U23_WD')
  })

  it('handles Boys/Girls junior naming', () => {
    expect(eventCodeFromName("U17 Boys singles")).toBe('U17_MS')
    expect(eventCodeFromName("U17 Girls singles")).toBe('U17_WS')
    expect(eventCodeFromName("U13 Boys doubles")).toBe('U13_MD')
    expect(eventCodeFromName("U13 Girls doubles")).toBe('U13_WD')
  })

  it('handles Mixed doubles', () => {
    expect(eventCodeFromName("U23 Mixed doubles")).toBe('U23_MXD')
    expect(eventCodeFromName("U15 Mixed doubles")).toBe('U15_MXD')
  })
})

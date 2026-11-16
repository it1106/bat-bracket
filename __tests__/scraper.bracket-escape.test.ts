import * as cheerio from 'cheerio'
import { parseBracket } from '@/lib/scraper'

// BAT's bracket markup, cut down to what parseBracket reads: one round of one
// match. Names, the round heading and the time arrive escaped, as BAT sends
// any text. What we build from them is put on the page as HTML, so it has to
// leave here escaped too.
function bracketPage(opts: { round?: string; name1?: string; name2?: string; time?: string }): string {
  const row = (name: string, id: string, won: boolean) =>
    `<div class="match__row${won ? ' has-won' : ''}">
       <div class="match__row-title-value">
         <a href="player.aspx?id=X&player=${id}"><span class="nav-link__value">${name}</span></a>
       </div>
     </div>`
  return `<html><body><div class="bracket js-bracket">
    <div class="subheading">${opts.round ?? 'Final'}</div>
    <swiper-container><swiper-slide>
      <div class="bracket-round__match-group-wrapper">
        <div class="match">
          ${row(opts.name1 ?? 'Player One', '11', false)}
          ${row(opts.name2 ?? 'Player Two', '22', false)}
          <div class="match__footer"><span class="nav-link__value">${opts.time ?? 'Fri 15/5/2569 10:30'}</span></div>
        </div>
      </div>
    </swiper-slide></swiper-container>
  </div></body></html>`
}

const INJECT = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
const INJECT_TEXT = '<img src=x onerror="alert(1)">'

describe('parseBracket escapes the text it takes from BAT', () => {
  it('keeps markup in a player name as text', () => {
    const { html } = parseBracket(bracketPage({ name1: `Evil ${INJECT}` }))
    const $ = cheerio.load(html)
    expect($('img')).toHaveLength(0)
    expect($('.bk-player').first().text()).toBe(`Evil ${INJECT_TEXT}`)
  })

  it('keeps markup in a round heading as text', () => {
    const { html } = parseBracket(bracketPage({ round: `Final ${INJECT}` }))
    const $ = cheerio.load(html)
    expect($('img')).toHaveLength(0)
    expect($('.bk-round-label').text()).toBe(`Final ${INJECT_TEXT}`)
  })

  it('keeps markup in the scheduled time as text', () => {
    const { html } = parseBracket(bracketPage({ time: `15/5/2569 ${INJECT}` }))
    const $ = cheerio.load(html)
    expect($('img')).toHaveLength(0)
    expect($('.bk-time').text()).toBe(`15/5/2569 ${INJECT_TEXT}`)
  })

  it('shows an ordinary name with an ampersand and an apostrophe as it is written', () => {
    const { html } = parseBracket(bracketPage({ name2: 'Tom &amp; Jerry O&#39;Neil' }))
    expect(html).toContain('Tom &amp; Jerry O&#39;Neil')
    expect(cheerio.load(html)('.bk-player').eq(1).text()).toBe("Tom & Jerry O'Neil")
  })
})

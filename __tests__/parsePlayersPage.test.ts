import { parsePlayersPage } from '@/lib/scraper'

const SAMPLE_HTML = `
<ol class="player-list">
  <li class="list__item">
    <div class="media__content">
      <h5 class="media__title">
        <a href="/sport/player.aspx?id=A2812D92-B33F-4F37-AC72-3310BB1BE0F1&amp;player=1420"
           class="nav-link media__link"><span class="nav-link__value">JAWAHAR RAGHU,</span></a>
      </h5>
      <div class="media__content-subinfo">
        <small class="media__subheading">
          <span class="nav-link"><span class="nav-link__value">รร.เทศบาลท่าโขลง 1</span></span>
        </small>
      </div>
    </div>
  </li>
  <li class="list__item">
    <div class="media__content">
      <h5 class="media__title">
        <a href="/sport/player.aspx?id=A2812D92-B33F-4F37-AC72-3310BB1BE0F1&amp;player=1197"
           class="nav-link media__link"><span class="nav-link__value">RUAN TAIYA,</span></a>
      </h5>
      <div class="media__content-subinfo">
        <small class="media__subheading">
          <span class="nav-link"><span class="nav-link__value">รร.อัสสัมชัญคอนแวนต์สีลม</span></span>
        </small>
      </div>
    </div>
  </li>
  <li class="list__item">
    <div class="media__content">
      <h5 class="media__title">
        <a href="/sport/player.aspx?id=A2812D92-B33F-4F37-AC72-3310BB1BE0F1&amp;player=999"
           class="nav-link media__link"><span class="nav-link__value">NO CLUB PLAYER,</span></a>
      </h5>
    </div>
  </li>
</ol>
`

describe('parsePlayersPage', () => {
  it('extracts playerId + club + name from the AJAX roster html', () => {
    const out = parsePlayersPage(SAMPLE_HTML)
    expect(out).toEqual([
      { playerId: '1420', club: 'รร.เทศบาลท่าโขลง 1', name: 'JAWAHAR RAGHU' },
      { playerId: '1197', club: 'รร.อัสสัมชัญคอนแวนต์สีลม', name: 'RUAN TAIYA' },
      { playerId: '999', club: '', name: 'NO CLUB PLAYER' },
    ])
  })

  it('returns empty list when no media__content blocks present', () => {
    expect(parsePlayersPage('<html><body><p>nothing</p></body></html>')).toEqual([])
  })

  it('skips blocks whose link has no player= param', () => {
    const html = `
      <div class="media__content">
        <a class="media__link" href="/elsewhere"><span class="nav-link__value">X</span></a>
      </div>
    `
    expect(parsePlayersPage(html)).toEqual([])
  })
})

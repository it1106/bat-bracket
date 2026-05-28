import { parseMatchesFull } from '@/lib/scraper'

// parseMatchesFull must NOT pre-stamp `hasMatches` from a date heuristic.
// BAT's day-tab markup carries no per-day published-or-not signal, so the
// parser cannot know whether a future day's schedule has been published.
// Leave `hasMatches` undefined here; the caller updates it to true/false
// after an actual per-day fetch (see app/page.tsx). The previous heuristic
// "future days = empty" hid genuinely-published tomorrow schedules behind
// a dimmed/disabled tab.
describe('parseMatchesFull — hasMatches is left undefined', () => {
  const html = `
    <ul>
      <li class="js-page-nav__item">
        <a class="js-tab js-date-selection-tab" data-value="25690527">
          <time datetime="2026-05-27T00:00:00"></time>
        </a>
      </li>
      <li class="js-page-nav__item">
        <a class="js-tab js-date-selection-tab" data-value="25690529">
          <time datetime="2026-05-29T00:00:00"></time>
        </a>
      </li>
    </ul>
  `

  it('does not set hasMatches=false for future days (was the SAT NSDF dimmed-tab bug)', () => {
    const { days } = parseMatchesFull(html)
    expect(days).toHaveLength(2)
    const future = days.find((d) => d.dateIso === '2026-05-29')
    expect(future).toBeDefined()
    expect(future!.hasMatches).not.toBe(false)
  })

  it('does not set hasMatches=true for past days either (lets per-day fetch be the source of truth)', () => {
    const { days } = parseMatchesFull(html)
    const past = days.find((d) => d.dateIso === '2026-05-27')
    expect(past).toBeDefined()
    expect(past!.hasMatches).toBeUndefined()
  })
})

import fs from 'fs'
import path from 'path'
import { extractMetaFromPageHtml, extractDatesFromPageHtml, extractTokenFromHtml } from '@/lib/providers/bwf/url-resolver'

const html = () => fs.readFileSync(path.join(process.cwd(), 'fixtures', 'bwf', 'tournament-page.html'), 'utf-8')

describe('extractMetaFromPageHtml', () => {
  it('extracts tmtId, tournamentCode, slug, name, token', () => {
    const meta = extractMetaFromPageHtml(html())
    expect(meta).toEqual({
      tmtId: 5726,
      tournamentCode: '6E65C36E-497D-42D2-8F4E-78A2D30D9893',
      slug: 'mith-yonex-pathumthanee-u13-u15-u17-international-junior-2026',
      name: 'MITH YONEX Pathumthanee U13 U15 U17 International Junior 2026',
      token: '2|NaXRu9JnMpSdb8l86BkJxj6gzKJofnhmExwr8EWkQtHoattDAGimsSYhpM22a61e1crjTjfIGTKfhzxA',
    })
  })

  it('returns null when key fields missing', () => {
    expect(extractMetaFromPageHtml('<html></html>')).toBeNull()
  })

  it('returns null when only some fields present', () => {
    expect(extractMetaFromPageHtml('<script>var tmtId = 1;</script>')).toBeNull()
  })
})

describe('extractTokenFromHtml', () => {
  it('extracts the HTML-entity-encoded JSON token from the reworked primer page', () => {
    // Real shape observed on https://bwfbadminton.com/calendar/ (June 2026).
    const html = '<div data-page="{&quot;version&quot;:&quot;2024.11.0&quot;,&quot;token&quot;:&quot;1df603e8c147496b9cf81eef6d5d8e92&quot;,&quot;server&quot;:1}">x</div>'
    expect(extractTokenFromHtml(html)).toBe('1df603e8c147496b9cf81eef6d5d8e92')
  })

  it('still extracts the legacy object-literal token', () => {
    expect(extractTokenFromHtml('<script>token: "2|NaXRu9JnMpSdb8"</script>')).toBe('2|NaXRu9JnMpSdb8')
  })

  it('extracts a raw (non-entity) JSON token', () => {
    expect(extractTokenFromHtml('{"token":"abc123def456"}')).toBe('abc123def456')
  })

  it('returns null when no token is present', () => {
    expect(extractTokenFromHtml('<html>no token here</html>')).toBeNull()
  })
})

describe('extractDatesFromPageHtml', () => {
  it('extracts start/end dates from live-date div and slug year', () => {
    const html = `
      <html><body>
        <div class="live-date">19  - 24 May</div>
        <script>var app = new Vue({ data: { tournamentSlug: 'foo-2026' } });</script>
      </body></html>
    `
    expect(extractDatesFromPageHtml(html)).toEqual({
      startDateIso: '2026-05-19',
      endDateIso: '2026-05-24',
    })
  })

  it('handles cross-month range like "30 Apr - 5 May"', () => {
    const html = `<div class="live-date">30 Apr - 5 May</div><script>var x = { tournamentSlug: 'q-2026' }</script>`
    expect(extractDatesFromPageHtml(html)).toEqual({
      startDateIso: '2026-04-30',
      endDateIso: '2026-05-05',
    })
  })

  it('returns null on unparseable date', () => {
    expect(extractDatesFromPageHtml('<div>nope</div>')).toBeNull()
  })
})

import fs from 'fs'
import path from 'path'
import {
  extractMetaFromPageHtml,
  extractDatesFromPageHtml,
  extractTokenFromHtml,
  parseTmtIdFromBwfUrl,
  sidecarFieldsFromDetail,
} from '@/lib/providers/bwf/url-resolver'

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

describe('parseTmtIdFromBwfUrl', () => {
  it('parses the numeric id from a /tournament/<id>/<slug>/ URL', () => {
    expect(parseTmtIdFromBwfUrl(
      'https://bwfbadminton.com/tournament/5738/yonex-sunrise-pembangunan-jaya-raya-junior-international-grand-prix-2026/',
    )).toBe(5738)
  })

  it('tolerates trailing path segments like /info', () => {
    expect(parseTmtIdFromBwfUrl('https://bwfbadminton.com/tournament/5726/mith-yonex/info')).toBe(5726)
  })

  it('returns null when there is no numeric tournament id', () => {
    expect(parseTmtIdFromBwfUrl('https://bwfbadminton.com/calendar/')).toBeNull()
    expect(parseTmtIdFromBwfUrl('https://bwfbadminton.com/tournament/abc/foo')).toBeNull()
  })
})

describe('sidecarFieldsFromDetail', () => {
  const full = {
    id: 5738,
    code: 'f25a7927-e9ba-47c8-959d-42a013b65592',
    name: 'YONEX SUNRISE Pembangunan Jaya Raya Junior International Grand Prix 2026',
    slug: 'yonex-sunrise-pembangunan-jaya-raya-junior-international-grand-prix-2026',
    start_date: '2026-07-07 00:00:00',
    end_date: '2026-07-12 00:00:00',
  }

  it('maps the vue-tournament-detail result to sidecar fields (uppercased code, ISO dates)', () => {
    expect(sidecarFieldsFromDetail(full)).toEqual({
      tmtId: 5738,
      tournamentCode: 'F25A7927-E9BA-47C8-959D-42A013B65592',
      slug: 'yonex-sunrise-pembangunan-jaya-raya-junior-international-grand-prix-2026',
      name: 'YONEX SUNRISE Pembangunan Jaya Raya Junior International Grand Prix 2026',
      startDateIso: '2026-07-07',
      endDateIso: '2026-07-12',
    })
  })

  it('leaves dates empty when the detail omits them', () => {
    const { start_date, end_date, ...noDates } = full
    const out = sidecarFieldsFromDetail(noDates)!
    expect(out.startDateIso).toBe('')
    expect(out.endDateIso).toBe('')
  })

  it('returns null when a required field (code) is missing', () => {
    const { code, ...noCode } = full
    expect(sidecarFieldsFromDetail(noCode)).toBeNull()
  })

  it('returns null for a non-object / empty result', () => {
    expect(sidecarFieldsFromDetail(null)).toBeNull()
    expect(sidecarFieldsFromDetail({})).toBeNull()
  })
})

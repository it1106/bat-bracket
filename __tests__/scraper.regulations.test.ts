import fs from 'fs'
import path from 'path'
import { hasRegulationsLink, parseOverviewNotes, parseRegulations } from '@/lib/scraper'

const fixture = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

describe('parseRegulations', () => {
  const html = parseRegulations(fixture('regulations-bat-themall.html'))

  it('returns the regulations text with its line breaks', () => {
    expect(html).toMatch(/^เก็บคะแนนสะสมในระดับ LEVEL 2<br>/)
    expect(html).toContain('ลูกขนไก่ที่ใช้ในการแข่งขันยี่ห้อ YONEX AS20<br>')
    expect(html).toMatch(/ประเภทเดี่ยวคนละ 600 บาท\/ประเภทคู่  คู่ละ 1,200  บาท$/)
  })

  it('drops the CSRF input, Close button and modal script', () => {
    expect(html).not.toMatch(/<input|<button|<script|RequestVerificationToken|Close/)
  })

  it('returns an empty string for a page without the modal (e.g. the non-XHR 404 page)', () => {
    expect(parseRegulations('<html><body><h4>404 - Page not found</h4></body></html>')).toBe('')
  })
})

describe('hasRegulationsLink', () => {
  it('detects the "View regulations" link on the tournament home page', () => {
    expect(hasRegulationsLink('<a href="/tournament/abc/Home/Regulations" class="nav-link js-asyncmodal">View regulations</a>')).toBe(true)
    expect(hasRegulationsLink('<a href="/tournament/abc/players">Players</a>')).toBe(false)
  })
})

// Regulations and notes are text a tournament organiser typed into BAT, and
// they are put on our page as HTML. Only formatting may survive.
describe('organiser text is cleaned on its way in', () => {
  const modal = (body: string) => `<div class="modal__body"><form>${body}</form></div>`
  const overview = (body: string) =>
    `<div class="alert alert--info js-alert"><div class="alert__body-inner">${body}</div></div>`

  it('regulations keep formatting and lose anything that can run', () => {
    const out = parseRegulations(modal(
      'Rules<br><b>Level 2</b><iframe src="https://evil.example"></iframe>' +
      '<a href="javascript:alert(1)">entry</a><p style="position:fixed;top:0">x</p><svg onload="alert(1)"></svg>',
    ))
    expect(out).toBe('Rules<br><b>Level 2</b><a target="_blank" rel="noopener noreferrer nofollow">entry</a><p>x</p>')
  })

  it('notes keep formatting and lose anything that can run', () => {
    const [note] = parseOverviewNotes(overview(
      '<p class="lead" id="n1">Check-in <strong>30 min</strong> early</p>' +
      '<object data="https://evil.example/x"></object><img src="javascript:alert(1)"><a href="https://example.org/map">Map</a>',
    ))
    expect(note).toBe(
      '<p>Check-in <strong>30 min</strong> early</p>' +
      '<a href="https://example.org/map" target="_blank" rel="noopener noreferrer nofollow">Map</a>',
    )
  })
})

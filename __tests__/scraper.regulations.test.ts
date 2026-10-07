import fs from 'fs'
import path from 'path'
import { hasRegulationsLink, parseRegulations } from '@/lib/scraper'

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

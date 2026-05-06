import fs from 'fs'
import path from 'path'
import { parseUpcoming } from '@/lib/upcoming-scraper'

const fixture = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf-8')

describe('parseUpcoming', () => {
  it('returns an empty array for empty / malformed HTML', () => {
    expect(parseUpcoming('')).toEqual([])
    expect(parseUpcoming('<html></html>')).toEqual([])
  })

  it('extracts upcoming tournaments with id, name, hasOnlineEntry', () => {
    const result = parseUpcoming(fixture('upcoming.html'))
    expect(result.length).toBeGreaterThan(0)
    for (const entry of result) {
      expect(entry.id).toMatch(/^[A-F0-9-]{36}$/)
      expect(entry.name.length).toBeGreaterThan(0)
      expect(typeof entry.hasOnlineEntry).toBe('boolean')
    }
  })

  it('flags at least one row with hasOnlineEntry=true', () => {
    const result = parseUpcoming(fixture('upcoming.html'))
    expect(result.some((r) => r.hasOnlineEntry)).toBe(true)
  })

  it('flags at least one row with hasOnlineEntry=false', () => {
    const result = parseUpcoming(fixture('upcoming.html'))
    expect(result.some((r) => !r.hasOnlineEntry)).toBe(true)
  })
})

/** @jest-environment node */
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  AccessLog, DIRECT, accessLine, clientOf, expiredLogs, getCountryStats, loggedUrl, recordAccess,
} from '@/lib/access-log'

const DAY = 86_400_000
// Noon in Bangkok on 5 Oct 2026.
const NOON = Date.UTC(2026, 9, 5, 5)

const entry = (over: Partial<Parameters<typeof accessLine>[0]> = {}) => ({
  now: NOON,
  ip: '203.0.113.7',
  country: 'TH',
  method: 'GET',
  url: '/api/matches?tournament=T1',
  status: 200,
  ms: 12.6,
  userAgent: 'Mozilla/5.0',
  referer: 'https://batmatch.app/',
  ...over,
})

describe('clientOf', () => {
  it('takes the address and country Cloudflare reports', () => {
    expect(clientOf({ 'cf-connecting-ip': '203.0.113.7', 'cf-ipcountry': 'th' }, '172.16.88.1'))
      .toEqual({ ip: '203.0.113.7', country: 'TH' })
    expect(clientOf({ 'cf-connecting-ip': ['2001:db8::1'], 'cf-ipcountry': 'T1' }, undefined))
      .toEqual({ ip: '2001:db8::1', country: 'T1' })
  })

  it('marks a request that did not come through Cloudflare, whatever it claims', () => {
    expect(clientOf({}, '::ffff:172.16.88.20')).toEqual({ ip: '172.16.88.20', country: DIRECT })
    expect(clientOf({ 'cf-ipcountry': 'US' }, '172.16.88.20').country).toBe(DIRECT)
    expect(clientOf({}, undefined)).toEqual({ ip: '-', country: DIRECT })
  })

  it('does not trust a malformed address or country', () => {
    expect(clientOf({ 'cf-connecting-ip': 'evil"\n{}', 'cf-ipcountry': 'TH' }, '10.0.0.1'))
      .toEqual({ ip: '10.0.0.1', country: DIRECT })
    expect(clientOf({ 'cf-connecting-ip': '203.0.113.7', 'cf-ipcountry': 'Thailand' }, undefined).country).toBe('XX')
    expect(clientOf({ 'cf-connecting-ip': '203.0.113.7' }, undefined).country).toBe('XX')
  })
})

describe('loggedUrl', () => {
  it('leaves out what was typed into a search box', () => {
    expect(loggedUrl('/api/players/search?provider=bat&q=%E0%B8%AA%E0%B8%A1&x=1')).toBe('/api/players/search?provider=bat&q=-&x=1')
    expect(loggedUrl('/api/players/search?q=somchai')).toBe('/api/players/search?q=-')
  })

  it('keeps other parameters and bounds the length', () => {
    expect(loggedUrl('/api/matches?tournament=ABC&seq=2')).toBe('/api/matches?tournament=ABC&seq=2')
    expect(loggedUrl('/' + 'a'.repeat(5000))).toHaveLength(300)
    expect(loggedUrl(undefined)).toBe('')
  })
})

describe('accessLine', () => {
  it('is one line of JSON with the fields a search needs', () => {
    expect(JSON.parse(accessLine(entry()))).toEqual({
      t: '2026-10-05T05:00:00.000Z',
      ip: '203.0.113.7',
      cc: 'TH',
      m: 'GET',
      s: 200,
      ms: 13,
      url: '/api/matches?tournament=T1',
      ua: 'Mozilla/5.0',
      ref: 'https://batmatch.app/',
    })
  })

  it('cannot be broken into two lines by what a visitor sends', () => {
    const line = accessLine(entry({ url: '/x\n{"ip":"1.2.3.4"}', userAgent: 'a"b\r\nc'.repeat(100) }))
    expect(line).not.toMatch(/[\r\n]/)
    expect(JSON.parse(line).ua.length).toBeLessThanOrEqual(200)
  })
})

describe('expiredLogs', () => {
  it('names the day files past the retention period and nothing else', () => {
    const names = ['2026-09-20.log', '2026-09-21.log', '2026-09-22.log', '2026-10-05.log', 'notes.txt', '2026-09-01.log.bak']
    expect(expiredLogs(names, NOON, 14)).toEqual(['2026-09-20.log', '2026-09-21.log'])
    expect(expiredLogs(names, NOON, 1)).toEqual(['2026-09-20.log', '2026-09-21.log', '2026-09-22.log'])
  })
})

describe('AccessLog', () => {
  let dir = ''
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-log-')) })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('writes a file per Bangkok day and deletes the expired ones', async () => {
    fs.writeFileSync(path.join(dir, '2026-09-01.log'), 'old\n')
    fs.writeFileSync(path.join(dir, '2026-10-04.log'), 'yesterday\n')
    const log = new AccessLog(dir, 14)
    log.write('a', NOON)
    log.write('b', NOON + 1000)
    log.write('c', NOON + DAY)
    await log.close()
    expect(fs.readFileSync(path.join(dir, '2026-10-05.log'), 'utf8')).toBe('a\nb\n')
    expect(fs.readFileSync(path.join(dir, '2026-10-06.log'), 'utf8')).toBe('c\n')
    expect(fs.existsSync(path.join(dir, '2026-09-01.log'))).toBe(false)
    expect(fs.readFileSync(path.join(dir, '2026-10-04.log'), 'utf8')).toBe('yesterday\n')
  })

  it('adds to a day already begun, as after a restart', async () => {
    const first = new AccessLog(dir)
    first.write('a', NOON)
    await first.close()
    const second = new AccessLog(dir)
    second.write('b', NOON)
    await second.close()
    expect(fs.readFileSync(path.join(dir, '2026-10-05.log'), 'utf8')).toBe('a\nb\n')
  })

  it('gives up quietly when it cannot write', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const blocked = path.join(dir, 'file')
    fs.writeFileSync(blocked, '')
    const log = new AccessLog(path.join(blocked, 'under-a-file'))
    expect(() => { log.write('a', NOON); log.write('b', NOON) }).not.toThrow()
    await log.close()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})

describe('country counts', () => {
  it('counts answered site requests by country, and nothing else', () => {
    const before = new Map(getCountryStats().map((c) => [c.country, c.count]))
    const added = (cc: string) => (new Map(getCountryStats().map((c) => [c.country, c.count])).get(cc) ?? 0) - (before.get(cc) ?? 0)
    recordAccess(entry({ now: Date.now(), country: 'TH' }))
    recordAccess(entry({ now: Date.now(), country: 'TH', url: '/api/bracket?x=1' }))
    recordAccess(entry({ now: Date.now(), country: 'US' }))
    // A page, a heartbeat, and a visitor who left before the answer.
    recordAccess(entry({ now: Date.now(), country: 'NL', url: '/' }))
    recordAccess(entry({ now: Date.now(), country: 'NL', url: '/api/presence' }))
    recordAccess(entry({ now: Date.now(), country: 'NL', status: 0 }))
    expect(added('TH')).toBe(2)
    expect(added('US')).toBe(1)
    expect(added('NL')).toBe(0)
    expect(getCountryStats()[0].country).toBe('TH')
  })
})

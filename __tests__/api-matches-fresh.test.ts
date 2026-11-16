// `fresh=1` on /api/matches skips the caches and asks BAT again. The page
// sends it when a live match ends; anyone else can send it too, as often as
// they like. So a visitor's fresh=1 is honoured once every few seconds per
// tournament day, everyone who asks meanwhile shares that one answer, and only
// the server's own warmer (which carries the server token) is never held back.
jest.mock('../lib/bat-fetch', () => ({ batFetch: jest.fn() }))
jest.mock('../lib/day-cache', () => ({
  readDayCache: jest.fn().mockResolvedValue(null),
  writeDayCache: jest.fn(),
  isDayComplete: jest.fn(() => false),
  shouldMemcacheDayResult: jest.fn(() => true),
  readFullCache: jest.fn().mockResolvedValue(null),
  writeFullCache: jest.fn(),
  isAllPast: jest.fn(() => false),
  fetchDayMatchGroups: jest.fn(),
}))
jest.mock('../lib/tournaments-registry', () => ({
  resolveRef: jest.fn(() => ({ id: 'TID', provider: 'bat' })),
}))
jest.mock('../lib/providers/resolve', () => ({
  providerFor: jest.fn(),
}))
jest.mock('../lib/tournament-meta', () => ({ persistMetaIfChanged: jest.fn() }))
jest.mock('../lib/schedule-last-good', () => ({
  readLastGoodDay: jest.fn().mockResolvedValue(null),
  writeLastGoodDay: jest.fn().mockResolvedValue(undefined),
  readLastGoodFull: jest.fn().mockResolvedValue(null),
  writeLastGoodFull: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../lib/today', () => ({ getTodayIso: jest.fn(() => '2026-06-02') }))
// enrichWithSiblings would otherwise trigger bracket-cache + sibling fetches.
// The route imports parseBracketSiblings + makeBracketKey etc — stub the
// minimum so the happy-path through the day branch doesn't hit upstream.
jest.mock('../lib/bracket-cache', () => ({
  cache: { get: jest.fn(() => null) },
  rawHtmlCache: { get: jest.fn(() => null) },
  siblingLookupCache: { get: jest.fn(() => null), set: jest.fn() },
  feederLookupCache: { get: jest.fn(() => null), set: jest.fn() },
  fetchAndCache: jest.fn().mockResolvedValue(undefined),
  makeBracketKey: jest.fn((t: string, d: string) => `${t}:${d}`),
}))
jest.mock('../lib/scraper', () => ({
  parseMatchesFull: jest.fn(() => ({
    days: [{ date: '25690602', label: '02/06', dateIso: '2026-06-02', hasMatches: true }],
    currentDate: '25690602',
    groups: [{ type: 'time', time: '10:00', matches: [] }],
  })),
  parseMatchesPartial: jest.fn(() => ({
    groups: [{ type: 'time', time: '10:00', matches: [] }],
  })),
  parseBracketSiblings: jest.fn(() => []),
  parseBracketFeeders: jest.fn(() => []),
  parseBracketContext: jest.fn(() => ({ siblings: [], feeders: [], nextMatches: [] })),
}))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { batFetch } from '@/lib/bat-fetch'
import { parseMatchesPartial } from '@/lib/scraper'
import { GET } from '@/app/api/matches/route'
import { internalHeaders } from '@/lib/internal-token'
import { __resetPublicFreshForTesting } from '@/lib/rate-limit'

const cwd = process.cwd()
beforeAll(() => { process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'))) })
afterAll(() => { process.chdir(cwd) })

const okHtml = () => ({ ok: true, status: 200, url: '', text: async () => '<html>ok</html>' } as unknown as Response)
const groupsAt = (time: string) => ({ groups: [{ type: 'time', time, matches: [] }] })

let n = 0
const nextTid = () => `f5e50000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const day = (id: string, opts: { fresh?: boolean; date?: string; headers?: Record<string, string> } = {}) =>
  new Request(
    `http://localhost/api/matches?tournament=${id}&date=${opts.date ?? '25690602'}${opts.fresh ? '&fresh=1' : ''}`,
    { headers: opts.headers },
  )
const timeOf = async (res: Response) => (await res.json()).groups[0].time as string

beforeEach(() => {
  ;(batFetch as jest.Mock).mockReset()
  ;(batFetch as jest.Mock).mockImplementation(async () => okHtml())
  ;(parseMatchesPartial as jest.Mock).mockReset()
  __resetPublicFreshForTesting()
})

describe('GET /api/matches?fresh=1', () => {
  it('asks BAT again for a visitor, past a warm cache', async () => {
    const id = nextTid()
    ;(parseMatchesPartial as jest.Mock).mockReturnValueOnce(groupsAt('10:00')).mockReturnValueOnce(groupsAt('10:05'))
    await GET(day(id))
    const res = await GET(day(id, { fresh: true }))
    expect(batFetch).toHaveBeenCalledTimes(2)
    expect(await timeOf(res)).toBe('10:05')
  })

  it('does not ask BAT a second time straight after, and serves what the first brought back', async () => {
    const id = nextTid()
    ;(parseMatchesPartial as jest.Mock)
      .mockReturnValueOnce(groupsAt('10:00')).mockReturnValueOnce(groupsAt('10:05')).mockReturnValue(groupsAt('never'))
    await GET(day(id))
    await GET(day(id, { fresh: true }))
    const again = await GET(day(id, { fresh: true }))
    const andAgain = await GET(day(id, { fresh: true }))
    expect(batFetch).toHaveBeenCalledTimes(2)
    expect(again.status).toBe(200)
    expect(await timeOf(again)).toBe('10:05')
    expect(await timeOf(andAgain)).toBe('10:05')
  })

  it('never lets a held-back fresh answer be cached by a browser or proxy', async () => {
    const id = nextTid()
    ;(parseMatchesPartial as jest.Mock).mockReturnValue(groupsAt('10:00'))
    await GET(day(id, { fresh: true }))
    const again = await GET(day(id, { fresh: true }))
    expect(again.headers.get('Cache-Control')).toBe('no-store')
  })

  it('holds each tournament day back on its own', async () => {
    const id = nextTid()
    ;(parseMatchesPartial as jest.Mock).mockReturnValue(groupsAt('10:00'))
    await GET(day(id, { fresh: true }))
    await GET(day(id, { fresh: true, date: '25690603' }))
    await GET(day(nextTid(), { fresh: true }))
    expect(batFetch).toHaveBeenCalledTimes(3)
  })

  it('gives everyone who asks while one fresh read is under way that read\'s answer', async () => {
    const id = nextTid()
    ;(parseMatchesPartial as jest.Mock).mockReturnValueOnce(groupsAt('10:00')).mockReturnValueOnce(groupsAt('10:05'))
    await GET(day(id))

    let release: (r: Response) => void = () => undefined
    ;(batFetch as jest.Mock).mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve }))
    const crowd = Array.from({ length: 5 }, () => GET(day(id, { fresh: true })))
    await new Promise((r) => setTimeout(r, 20))
    release(okHtml())
    const answers = await Promise.all(crowd)

    // One read for the page load, one for the whole crowd.
    expect(batFetch).toHaveBeenCalledTimes(2)
    for (const res of answers) expect(await timeOf(res)).toBe('10:05')
  })

  it('falls back to the cached copy for the crowd when the fresh read fails', async () => {
    const id = nextTid()
    ;(parseMatchesPartial as jest.Mock).mockReturnValue(groupsAt('10:00'))
    await GET(day(id))

    let fail: (e: Error) => void = () => undefined
    ;(batFetch as jest.Mock).mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { fail = reject }))
    const crowd = Array.from({ length: 3 }, () => GET(day(id, { fresh: true })))
    await new Promise((r) => setTimeout(r, 20))
    fail(new Error('connect ETIMEDOUT'))
    const answers = await Promise.all(crowd)

    expect(batFetch).toHaveBeenCalledTimes(2)
    for (const res of answers) {
      expect(res.status).toBe(200)
      expect(await timeOf(res)).toBe('10:00')
    }
  })

  it('never holds back the server\'s own warmer', async () => {
    const id = nextTid()
    ;(parseMatchesPartial as jest.Mock).mockReturnValue(groupsAt('10:00'))
    const headers = internalHeaders()
    for (let i = 0; i < 4; i++) await GET(day(id, { fresh: true, headers }))
    expect(batFetch).toHaveBeenCalledTimes(4)
  })

  it('treats a made-up token like any visitor', async () => {
    const id = nextTid()
    ;(parseMatchesPartial as jest.Mock).mockReturnValue(groupsAt('10:00'))
    internalHeaders()
    const headers = { 'x-internal-token': '0'.repeat(64) }
    for (let i = 0; i < 4; i++) await GET(day(id, { fresh: true, headers }))
    expect(batFetch).toHaveBeenCalledTimes(1)
  })
})

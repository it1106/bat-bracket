import { GET } from '@/app/api/stats/route'

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: { ...jest.requireActual('fs').promises, readFile: jest.fn() },
}))
jest.mock('../lib/stats-cache', () => ({
  readStatsCache: jest.fn(),
  writeStatsCache: jest.fn(),
  hashFullCacheBytes: jest.fn(() => 'sha-fixed'),
}))
jest.mock('../lib/day-cache', () => ({
  readFullCache: jest.fn(),
  readDayCache: jest.fn(),
}))

import { promises as fs } from 'fs'
import { readStatsCache, writeStatsCache, hashFullCacheBytes } from '@/lib/stats-cache'
import { readFullCache, readDayCache } from '@/lib/day-cache'
import path from 'path'
import type { MatchesData } from '@/lib/types'

const real = jest.requireActual('fs') as typeof import('fs')
const loadFull = () => JSON.parse(real.readFileSync(path.join(__dirname, '..', 'fixtures', 'stats-sprc-full.json'), 'utf8'))
const loadDays = () => JSON.parse(real.readFileSync(path.join(__dirname, '..', 'fixtures', 'stats-sprc-days.json'), 'utf8'))
const loadClubs = () => JSON.parse(real.readFileSync(path.join(__dirname, '..', 'fixtures', 'stats-sprc-clubs.json'), 'utf8'))

let testId = 0
const nextId = () => `test-${++testId}`

const req = (id: string, override?: string) =>
  new Request(`http://localhost/api/stats${override ?? `?tournament=${id}`}`)

describe('GET /api/stats', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(hashFullCacheBytes as jest.Mock).mockReturnValue('sha-fixed')
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => loadClubs(),
    }) as unknown as typeof fetch
  })

  it('returns 400 when missing tournament param', async () => {
    const res = await GET(req(nextId(), '?'))
    expect(res.status).toBe(400)
  })

  it('serves from disk cache when sourceVersion matches', async () => {
    const id = nextId()
    ;(readFullCache as jest.Mock).mockResolvedValue(loadFull())
    ;(fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('any'))
    ;(readStatsCache as jest.Mock).mockResolvedValue({
      version: 1,
      sourceVersion: 'full:sha-fixed',
      coverageComplete: true,
      stats: { tournamentId: id, generatedAt: 'X', coverage: {}, kpis: { matches: 999 } },
    })
    const res = await GET(req(id))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.kpis.matches).toBe(999)
    expect(writeStatsCache).not.toHaveBeenCalled()
  })

  it('aggregates and pins to disk on first miss', async () => {
    const id = nextId()
    ;(readFullCache as jest.Mock).mockResolvedValue(loadFull())
    ;(fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('full-bytes'))
    ;(readStatsCache as jest.Mock).mockResolvedValue(null)
    ;(readDayCache as jest.Mock).mockImplementation(async (_id: string, dateIso: string) => {
      const d = loadDays()
      return d[dateIso] ? { groups: d[dateIso] } : null
    })
    const res = await GET(req(id))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.kpis.matches).toBe(1384)
    expect(json.kpis.events).toBe(33)
    expect(writeStatsCache).toHaveBeenCalledTimes(1)
  })

  it('past tournament with incomplete day coverage: aggregates but does NOT pin to disk', async () => {
    const id = nextId()
    ;(readFullCache as jest.Mock).mockResolvedValue(loadFull())
    ;(fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('full-bytes'))
    ;(readStatsCache as jest.Mock).mockResolvedValue(null)
    // Simulate only 3 of 6 day shards on disk; the others are missing.
    ;(readDayCache as jest.Mock).mockImplementation(async (_id: string, dateIso: string) => {
      const d = loadDays()
      if (['2026-05-01', '2026-05-02', '2026-05-06'].includes(dateIso) && d[dateIso]) {
        return { groups: d[dateIso] }
      }
      return null
    })
    // Internal /api/matches?date= calls return empty so missing days stay missing.
    global.fetch = jest.fn(async (url: string) => {
      if (url.includes('/api/clubs')) return { ok: true, json: async () => loadClubs() } as Response
      if (url.includes('/api/matches')) return { ok: true, json: async () => ({ groups: [] }) } as Response
      return { ok: false, json: async () => ({}) } as Response
    }) as unknown as typeof fetch

    const res = await GET(req(id))
    expect(res.status).toBe(200)
    expect(writeStatsCache).not.toHaveBeenCalled()
  })

  it('pre-match: empty days + no roster → returns 200 with new optional fields absent', async () => {
    const id = nextId()
    ;(readFullCache as jest.Mock).mockResolvedValue(null)
    ;(fs.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'))
    ;(readStatsCache as jest.Mock).mockResolvedValue(null)
    // Tournament has no days yet (pre-start).
    const fullData: MatchesData = { days: [] } as unknown as MatchesData
    global.fetch = jest.fn(async (url: string) => {
      if (url.includes('/api/clubs')) return { ok: true, json: async () => ({}) } as Response
      if (url.includes('/api/matches')) return { ok: true, json: async () => fullData } as Response
      if (url.includes('/api/tournaments')) return { ok: true, json: async () => [] } as Response
      return { ok: false, json: async () => ({}) } as Response
    }) as unknown as typeof fetch

    const res = await GET(req(id))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.kpis.matches).toBe(0)
    expect(json.kpis.decided).toBe(0)
    expect(json.seedHeadlines).toBeUndefined()
    expect(json.defendingChampion).toBeUndefined()
    expect(json.schedulePreview).toBeUndefined()
    expect(writeStatsCache).not.toHaveBeenCalled()
  })

  it('mid-tournament: full disk cache absent → fetch /api/matches and aggregate, do NOT pin', async () => {
    const id = nextId()
    ;(readFullCache as jest.Mock).mockResolvedValue(null)
    ;(fs.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'))
    ;(readStatsCache as jest.Mock).mockResolvedValue(null)
    // Past-day shards are on disk; today/future fall back to /api/matches.
    ;(readDayCache as jest.Mock).mockImplementation(async (_id: string, dateIso: string) => {
      const d = loadDays()
      return d[dateIso] ? { groups: d[dateIso] } : null
    })
    // Two endpoints get hit during a mid-tournament request:
    //   - /api/clubs?tournament=…  (always)
    //   - /api/matches?tournament=…  (no date — full schedule fallback)
    const fullData = loadFull()
    const clubData = loadClubs()
    global.fetch = jest.fn(async (url: string) => {
      if (url.includes('/api/clubs')) {
        return { ok: true, json: async () => clubData } as Response
      }
      if (url.includes('/api/matches')) {
        return { ok: true, json: async () => fullData } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    }) as unknown as typeof fetch

    const res = await GET(req(id))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.kpis.matches).toBe(1384)
    expect(json.kpis.events).toBe(33)
    expect(writeStatsCache).not.toHaveBeenCalled()
  })
})

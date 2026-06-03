import fs from 'fs'
import os from 'os'
import path from 'path'
import { ensureStatsCachedForTournament } from '@/lib/stats-generator'
import { writeFullCache, writeDayCache } from '@/lib/day-cache'
import { readStatsCache } from '@/lib/stats-cache'
import type { MatchesData } from '@/lib/types'

const TID = 'TID-123'
const ORIGIN = 'http://stub.local'

function emptyMatchesData(): MatchesData {
  return {
    days: [{ date: '25690601', label: 'Mon', dateIso: '2026-06-01', hasMatches: true }],
    currentDate: '25690601',
    groups: [],
  }
}

describe('stats-generator', () => {
  let tmpRoot: string
  let originalCwd: string
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalCwd = process.cwd()
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bat-stats-gen-'))
    process.chdir(tmpRoot)
    originalFetch = global.fetch
    // Default fetch stub: return an empty clubs map. Tests that need different
    // behavior reassign global.fetch inside themselves.
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ clubs: {}, names: {} }),
    })) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.chdir(originalCwd)
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('returns skip when the tournament has no full cache on disk', async () => {
    const res = await ensureStatsCachedForTournament(TID, ORIGIN)
    expect(res).toBe('skip')
    expect(await readStatsCache(TID)).toBeNull()
  })

  it('writes the envelope when full + day caches exist', async () => {
    const full = emptyMatchesData()
    await writeFullCache(TID, full)
    await writeDayCache(TID, full.days[0].dateIso, { groups: [] })

    const res = await ensureStatsCachedForTournament(TID, ORIGIN)
    expect(res).toBe('wrote')
    const env = await readStatsCache(TID)
    expect(env).not.toBeNull()
    expect(env!.coverageComplete).toBe(true)
    expect(env!.sourceVersion).toMatch(/^full:[a-f0-9]{64}$/)
    expect(env!.stats.tournamentId).toBe(TID)
    expect(env!.stats.coverage.daysOnDisk).toBe(1)
    expect(env!.stats.coverage.totalDays).toBe(1)
  })

  it('returns fresh on second call without rewriting the file', async () => {
    const full = emptyMatchesData()
    await writeFullCache(TID, full)
    await writeDayCache(TID, full.days[0].dateIso, { groups: [] })

    expect(await ensureStatsCachedForTournament(TID, ORIGIN)).toBe('wrote')
    const statsPath = path.join(process.cwd(), '.cache', 'stats', 'TID-123.json')
    const mtimeBefore = fs.statSync(statsPath).mtimeMs

    // Small sleep so mtime resolution would catch a rewrite if one happened.
    await new Promise(r => setTimeout(r, 20))

    expect(await ensureStatsCachedForTournament(TID, ORIGIN)).toBe('fresh')
    const mtimeAfter = fs.statSync(statsPath).mtimeMs
    expect(mtimeAfter).toBe(mtimeBefore)
  })

  it('returns skip when a listed day has no day cache on disk', async () => {
    const full: MatchesData = {
      days: [
        { date: '25690601', label: 'Mon', dateIso: '2026-06-01', hasMatches: true },
        { date: '25690602', label: 'Tue', dateIso: '2026-06-02', hasMatches: true },
      ],
      currentDate: '25690601',
      groups: [],
    }
    await writeFullCache(TID, full)
    // Only write the first day's cache; the second is intentionally missing.
    await writeDayCache(TID, full.days[0].dateIso, { groups: [] })

    const res = await ensureStatsCachedForTournament(TID, ORIGIN)
    expect(res).toBe('skip')
    expect(await readStatsCache(TID)).toBeNull()
  })

  it('rewrites the envelope when full-cache bytes change', async () => {
    const full = emptyMatchesData()
    await writeFullCache(TID, full)
    await writeDayCache(TID, full.days[0].dateIso, { groups: [] })

    expect(await ensureStatsCachedForTournament(TID, ORIGIN)).toBe('wrote')
    const env1 = await readStatsCache(TID)
    expect(env1).not.toBeNull()
    const sv1 = env1!.sourceVersion

    // Mutate the full cache (add a day) → sha changes → next call rewrites.
    const full2: MatchesData = {
      ...full,
      days: [...full.days, { date: '25690602', label: 'Tue', dateIso: '2026-06-02', hasMatches: true }],
    }
    await writeFullCache(TID, full2)
    await writeDayCache(TID, full2.days[1].dateIso, { groups: [] })

    expect(await ensureStatsCachedForTournament(TID, ORIGIN)).toBe('wrote')
    const env2 = await readStatsCache(TID)
    expect(env2!.sourceVersion).not.toBe(sv1)
    expect(env2!.stats.coverage.totalDays).toBe(2)
  })
})

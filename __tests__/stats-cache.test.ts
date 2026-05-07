import fs from 'fs'
import os from 'os'
import path from 'path'
import { readStatsCache, writeStatsCache, hashFullCacheBytes } from '@/lib/stats-cache'
import type { TournamentStats } from '@/lib/types'

describe('stats-cache', () => {
  let tmpRoot: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bat-stats-'))
    process.chdir(tmpRoot)
  })
  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  const sample = (): TournamentStats => ({
    tournamentId: 'abc',
    generatedAt: 'X',
    coverage: { daysOnDisk: 1, daysFromMemory: 0, daysFromBat: 0, totalDays: 1 },
    kpis: {
      events: 0, matches: 0, decided: 0, walkovers: 0, retired: 0, nowPlaying: 0,
      players: 0, multiEventPlayers: 0, courtMinutes: 0, avgMatchMinutes: 0, threeSetterRate: 0,
    },
    dailyVolume: [],
    events: [],
    drama: { marathon: null, highestSet: null, comebackCount: 0, comebackHighlight: null, mostCourtTime: null },
    topPlayers: [],
    courtUtilization: [],
    clubMedals: [],
    multiGoldPlayers: [],
    integrity: { walkoverByEvent: [], threeSetterByEvent: [] },
  })

  it('returns null when file missing', async () => {
    expect(await readStatsCache('abc')).toBeNull()
  })

  it('round-trips write+read', async () => {
    await writeStatsCache('abc', { sourceVersion: 'full:xyz', stats: sample() })
    const got = await readStatsCache('abc')
    expect(got).not.toBeNull()
    expect(got!.sourceVersion).toBe('full:xyz')
    expect(got!.stats.tournamentId).toBe('abc')
  })

  it('hashFullCacheBytes is stable sha256', () => {
    const a = hashFullCacheBytes(Buffer.from('hello'))
    const b = hashFullCacheBytes(Buffer.from('hello'))
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })
})

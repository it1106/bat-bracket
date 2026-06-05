import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  readRankingCache,
  writeRankingCache,
  __setRankingCacheRootForTesting,
} from '@/lib/ranking/cache'
import type { Ranking } from '@/lib/types'

const sample = (provider: 'bat' | 'bwf'): Ranking => ({
  provider,
  scrapedAt: '2026-05-20T10:00:00Z',
  publishDate: provider === 'bat' ? '20/5/2569' : '20/05/2026',
  rankingId: '51771',
  events: [{
    eventCode: 'MS', eventName: "Men's Singles",
    entries: [{ rank: 1, name: 'X', slug: 'x', club: 'C', points: 1500, tournaments: 1 }],
  }],
})

describe('ranking-cache', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkc-'))
    __setRankingCacheRootForTesting(dir)
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('returns null when file is missing', async () => {
    expect(await readRankingCache('bat')).toBeNull()
    expect(await readRankingCache('bwf')).toBeNull()
  })

  it('round-trips per provider, independently', async () => {
    await writeRankingCache(sample('bat'))
    await writeRankingCache(sample('bwf'))
    expect((await readRankingCache('bat'))?.provider).toBe('bat')
    expect((await readRankingCache('bwf'))?.provider).toBe('bwf')
  })

  it('rejects legacy v11 envelope (no provider field)', async () => {
    const legacy = { ...sample('bat') } as Partial<Ranking>
    delete (legacy as { provider?: unknown }).provider
    fs.writeFileSync(path.join(dir, 'ranking-bat.json'), JSON.stringify(legacy))
    expect(await readRankingCache('bat')).toBeNull()
  })

  it('removes the legacy bat-ranking.json on a bat-cache miss', async () => {
    const legacyPath = path.join(dir, 'bat-ranking.json')
    fs.writeFileSync(legacyPath, '{}')
    expect(await readRankingCache('bat')).toBeNull()
    expect(fs.existsSync(legacyPath)).toBe(false)
  })
})

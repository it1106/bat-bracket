import fs from 'fs'
import os from 'os'
import path from 'path'
import { readBatRankingCache, writeBatRankingCache, __setBatRankingRootForTesting } from '@/lib/bat-ranking-cache'
import type { BatRanking } from '@/lib/types'

const sample: BatRanking = {
  scrapedAt: '2026-05-20T10:00:00Z',
  publishDate: '2026-05-20',
  events: [
    {
      eventCode: 'MS',
      eventName: "Men's Singles",
      entries: [{ rank: 1, name: 'TEST PLAYER', slug: 'test_player', club: 'Test Club', points: 1500 }],
    },
  ],
}

describe('bat-ranking-cache', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brc-'))
    __setBatRankingRootForTesting(dir)
  })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('returns null when file is missing', async () => {
    expect(await readBatRankingCache()).toBeNull()
  })

  it('round-trips ranking data', async () => {
    await writeBatRankingCache(sample)
    const out = await readBatRankingCache()
    expect(out?.publishDate).toBe('2026-05-20')
    expect(out?.events[0].eventCode).toBe('MS')
    expect(out?.events[0].entries[0].slug).toBe('test_player')
  })

  it('overwrites previous data on second write', async () => {
    await writeBatRankingCache(sample)
    const updated = { ...sample, publishDate: '2026-05-27' }
    await writeBatRankingCache(updated)
    const out = await readBatRankingCache()
    expect(out?.publishDate).toBe('2026-05-27')
  })
})

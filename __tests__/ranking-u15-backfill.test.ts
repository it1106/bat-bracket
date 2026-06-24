import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { __setRankingCacheRootForTesting } from '@/lib/ranking/cache'
import {
  __setRankingPlayerCacheRootForTesting, writeRankingPlayerDetail,
} from '@/lib/ranking/player-cache'
import { runU15Backfill } from '@/lib/ranking/u15-backfill'
import type { RankingPlayerDetail } from '@/lib/types'

async function seedRanking(dir: string) {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    rank: i + 1, name: `P${i}`, slug: `p${i}`, club: 'C', points: 1000 - i,
    tournaments: 5, globalPlayerId: `g${i}`, previousRank: i + 1,
  }))
  await fs.writeFile(path.join(dir, 'ranking-bat.json'), JSON.stringify({
    provider: 'bat', scrapedAt: 'now', publishDate: '30/6/2569', rankingId: '52400',
    events: [{ eventCode: 'U15_MS', eventName: 'U15 Boys singles', entries }],
  }))
}

const detail = (gid: string, publishDate: string): RankingPlayerDetail => ({
  globalPlayerId: gid, publishDate, scrapedAt: new Date().toISOString(), tournaments: [],
})

describe('runU15Backfill', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'u15bf-'))
    __setRankingCacheRootForTesting(dir)
    __setRankingPlayerCacheRootForTesting(path.join(dir, 'detail'))
    await seedRanking(dir)
  })

  it('returns an error when no ranking is cached', async () => {
    await fs.rm(path.join(dir, 'ranking-bat.json'))
    const res = await runU15Backfill({ delayMs: 0 })
    expect(res).toMatchObject({ error: expect.any(String) })
  })

  it('fetches the cohort details against the current publishDate, skipping fresh ones', async () => {
    // Pre-seed g0 as already fresh for the current publication.
    await writeRankingPlayerDetail('bat', detail('g0', '30/6/2569'))
    const fetched: string[] = []
    const res = await runU15Backfill({
      delayMs: 0, jitterMs: 0,
      fetchDetail: async (gid, _rankingId, publishDate) => { fetched.push(gid); return detail(gid, publishDate) },
    })
    expect(res).toMatchObject({ total: 50, have: 1, fetched: 49, failed: [] })
    expect(fetched).not.toContain('g0')
    expect(fetched).toContain('g49')
  })

  it('passes the cohort rankingId + publishDate through to the fetcher', async () => {
    let seen: { rankingId: string; publishDate: string } | null = null
    await runU15Backfill({
      delayMs: 0, jitterMs: 0,
      fetchDetail: async (gid, rankingId, publishDate) => { seen = { rankingId, publishDate }; return detail(gid, publishDate) },
    })
    expect(seen).toEqual({ rankingId: '52400', publishDate: '30/6/2569' })
  })
})
